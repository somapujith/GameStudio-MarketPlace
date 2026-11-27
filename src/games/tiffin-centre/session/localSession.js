// Tiffin Centre: the solo session (tutorial and practice shifts). Same engine as the room server, driven here by a
// real-time loop instead of server deadlines. Implements the SESSION INTERFACE of docs/TIFFIN_CENTRE_PLAN.md section 4.
//
//   const session = createLocalSession({ mode: 'practice', level: 3, pace: 'normal', playerName: 'Asha' });
//   session.subscribe(({ state, events, tickAt }) => ...);   session.dispatch({ type: 'cook', station, slot, dish });
//
// - The loop (requestAnimationFrame, or setTimeout where there is none) adds up real time and applies one `{type:'tick'}` per
//   TICK_MS. A long gap (a throttled tab, a slow frame) is capped at MAX_CATCHUP_TICKS: the rest of the time is dropped,
//   never "caught up" in one burst. The loop stops while paused, and the session pauses itself when the page is hidden.
// - `tickAt` is the time (the clock's `now`) at which the CURRENT tick began: renderers interpolate with
//   frac = clamp((now - tickAt) / TICK_MS, 0, 1). It moves on ticks only, never on a player's action, so bars never jump back.
// - Every source of impurity (clock, frame scheduler, storage, network, seed) is injectable for tests.
//
// AUTO-SAVE (see autosave.js): the run is saved to the 'shift' slot every SAVE_EVERY_TICKS ticks, at most SAVE_DEBOUNCE_MS after a
// player action, when paused, when the page is hidden / unloading, on quit and on dispose. It is cleared when the shift ends, the
// tutorial completes or is skipped, and on restart. `createLocalSession({ resume: snapshot })` brings a saved run back PAUSED (the
// player presses Resume); a tutorial is rebuilt by replaying its journal through this very code, so the driver comes back exactly.
import { TICK_MS } from '@shared/tiffin-centre/catalog.js';
import * as realEngine from '@shared/tiffin-centre/index.js';
import { TUTORIAL_SETTINGS, createTutorialDriver } from '@shared/tiffin-centre/tutorial.js';
import {
  MAX_JOURNAL_OPS, MAX_JOURNAL_TICKS, MAX_TUTORIAL_RESTARTS, SAVE_VERSION, clearShift, describeSavedShift, loadShift, saveShift, validateSnapshot,
} from './autosave.js';
import { defaultStorage, markTutorialDone, reportTutorialDone, saveShiftResult, syncPendingTutorial } from './progress.js';

export const MAX_CATCHUP_TICKS = 5;
export const LOCAL_PLAYER_ID = 'me';
export const SAVE_EVERY_TICKS = 5;
export const SAVE_DEBOUNCE_MS = 1000;
const LOOK_GRID = 20; // head directions are noted to 1/20 rad: fine enough for "look around", coarse enough to keep the journal small
const REFUSED_FROM_PLAYERS = new Set(['tick', 'spawn', 'tutorial-flags']);

/** A fresh game seed. Impure on purpose: this is the only place the solo game asks for randomness. */
export function randomSeed() {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(new Uint32Array(1))[0];
  } catch {
    /* fall through */
  }
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

const defaultNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

function defaultFrames() {
  if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
    return { request: (fn) => requestAnimationFrame(() => fn()), cancel: (h) => cancelAnimationFrame(h) };
  }
  return { request: (fn) => setTimeout(fn, 16), cancel: (h) => clearTimeout(h) };
}

const quantLook = (look) => {
  if (!look || !Number.isFinite(look.yaw)) return null;
  const q = (n) => Math.round(n * LOOK_GRID) / LOOK_GRID;
  return { yaw: q(look.yaw), pitch: q(Number(look.pitch) || 0) };
};

/**
 * options: { mode: 'tutorial'|'practice', level, pace, playerName, avatar, seed, onTutorialComplete, onTutorialSkip, onQuit,
 *            autoStart = true,
 *            resume: a snapshot from loadShift() (mode / level / pace / seed then come FROM it; the session starts 'paused'),
 *            autosave = true, replaceSave = false (the player explicitly chose to begin anew over an existing save),
 *            onSaveConflict(info) -> 'replace' | 'keep' | undefined }
 *          plus test hooks { engine, now, frames: { request, cancel }, storage, post, document, window, setTimer, clearTimer, wallNow }.
 *
 * A fresh start while a saved shift exists NEVER overwrites it by itself: auto-save stays off (`session.saveConflict` = what is
 * saved) until the caller decides: `replaceSave: true` up front, or `onSaveConflict` answering 'replace' / 'keep', or later
 * `session.resolveSaveConflict('replace' | 'keep')`.
 */
export function createLocalSession(options = {}) {
  const engine = options.engine || realEngine;
  const now = options.now || defaultNow;
  const frames = options.frames || defaultFrames();
  const storage = options.storage || defaultStorage();
  const post = options.post;
  const doc = options.document !== undefined ? options.document : typeof document !== 'undefined' ? document : null;
  const win = options.window !== undefined ? options.window : typeof window !== 'undefined' ? window : null;
  const wallNow = options.wallNow || (() => Date.now());
  const setTimer = options.setTimer || ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer = options.clearTimer || ((h) => globalThis.clearTimeout(h));
  const meId = LOCAL_PLAYER_ID;
  const stateVersion = engine.STATE_VERSION;

  // a saved run to resume: structurally valid and usable by this engine, or we start fresh and say why
  let resumeSnap = null;
  let resumeError = null;
  if (options.resume !== undefined && options.resume !== null) {
    let usable = validateSnapshot(options.resume, { stateVersion }).ok;
    try {
      const s = usable ? options.resume.state : null;
      if (usable && (!Object.hasOwn(s.players, meId) || engine.isOver(s))) usable = false;
      if (usable && options.resume.mode === 'practice') {
        const probe = engine.applyAction(s, { type: 'tick' }); // can this engine step it at all?
        if (!probe || probe.error || !probe.state) usable = false;
      }
    } catch {
      usable = false;
    }
    if (usable) resumeSnap = JSON.parse(JSON.stringify(options.resume));
    else resumeError = 'invalid';
  }

  const mode = resumeSnap ? resumeSnap.mode : options.mode === 'tutorial' ? 'tutorial' : 'practice';
  const player = { id: meId, name: options.playerName || 'You', avatar: options.avatar ?? null, online: true };
  const settings =
    mode === 'tutorial'
      ? { ...TUTORIAL_SETTINGS }
      : resumeSnap
        ? { level: resumeSnap.level, pace: resumeSnap.pace }
        : { level: Math.max(1, Math.trunc(Number(options.level)) || 1), pace: options.pace || 'normal' };
  const fixedSeed = options.seed !== undefined && options.seed !== null;

  let seed = resumeSnap ? resumeSnap.seed : fixedSeed ? options.seed : randomSeed();
  let state = null;
  let status = 'loading';
  let tickAt = 0;
  let acc = 0;
  let last = 0;
  let handle = null;
  let lastError = null;
  let result = null;
  let driver = mode === 'tutorial' ? createTutorialDriver() : null;
  let tutorialRestarts = 0;
  let savedPractice = false;
  let autoPaused = false;
  let disposed = false;
  let resumed = false;
  let replaying = false; // rebuilding a tutorial from its journal: no notifications, no saves, no side effects
  const subs = new Set();

  // auto-save bookkeeping
  let journal = []; // tutorial only, see autosave.js
  let journalTicks = 0;
  let journalFull = false;
  let autosaveActive = options.autosave !== false;
  let saveConflict = null;
  let lastSavedTick = 0;
  let lastSaveError = null;
  let dirtyTimer = null;

  // a resumed run keeps the name and avatar its state was made with (the replay must land on the saved state exactly)
  const saved = resumeSnap ? resumeSnap.state.players[meId] : null;
  const gameName = saved ? saved.name : player.name;
  const gameAvatar = saved ? saved.avatar : player.avatar;
  const newGame = () => engine.createGame({ players: [{ id: meId, name: gameName, avatar: gameAvatar }], settings, seed });
  state = newGame();

  function notify(events = [], extra) {
    if (replaying) return;
    const payload = { state, events, tickAt, ...(extra || {}) };
    for (const fn of [...subs]) {
      try {
        fn(payload);
      } catch {
        /* a bad subscriber must not stop the game */
      }
    }
  }

  // ---- journal (tutorial) -------------------------------------------------------------------------------------------------
  function journalPush(op) {
    if (mode !== 'tutorial') return;
    if (journal.length >= MAX_JOURNAL_OPS) {
      journalFull = true;
      return;
    }
    journal.push(op);
  }
  function journalTick() {
    if (mode !== 'tutorial') return;
    journalTicks += 1;
    if (journalTicks > MAX_JOURNAL_TICKS) {
      journalFull = true;
      return;
    }
    const n = journal.length;
    if (n && typeof journal[n - 1] === 'number') journal[n - 1] += 1;
    else journalPush(1);
  }
  function journalReset() {
    journal = [];
    journalTicks = 0;
    journalFull = false;
  }

  // ---- auto-save ----------------------------------------------------------------------------------------------------------
  function clearDirty() {
    if (dirtyTimer !== null) {
      try {
        clearTimer(dirtyTimer);
      } catch {
        /* ignore */
      }
      dirtyTimer = null;
    }
  }

  /** The run as a snapshot, or null when there is nothing worth saving (over, finished tutorial, journal overflow ...). */
  function snapshotNow() {
    if (!state || engine.isOver(state) || state.tick < 1) return null; // a shift that has not begun is not worth resuming
    const snap = { v: SAVE_VERSION, savedAt: wallNow(), mode, level: state.level, pace: state.pace, seed, state, driver: null };
    if (mode === 'tutorial') {
      if (!driver || driver.done || driver.skipped || journalFull) return null;
      snap.driver = { journal, restarts: tutorialRestarts, index: driver.index, steps: driver.steps.length };
    }
    return snap;
  }

  /** Write the save now. true = it was written. Never throws. */
  function persist() {
    clearDirty();
    if (!autosaveActive || disposed || replaying) return false;
    if (status !== 'playing' && status !== 'paused') return false;
    try {
      const snap = snapshotNow();
      if (!snap) return false;
      lastSavedTick = state.tick; // also on failure: a full disk is retried every few ticks, not every frame
      const r = saveShift(snap, storage, { stateVersion });
      if (r.ok) {
        lastSaveError = null;
        return true;
      }
      lastSaveError = r.reason;
    } catch {
      lastSaveError = 'error';
    }
    return false;
  }

  /** After a player action: save within SAVE_DEBOUNCE_MS (one timer, not pushed back by later actions). */
  function markDirty() {
    if (!autosaveActive || disposed || replaying || dirtyTimer !== null) return;
    try {
      dirtyTimer = setTimer(() => {
        dirtyTimer = null;
        persist();
      }, SAVE_DEBOUNCE_MS);
    } catch {
      dirtyTimer = null;
    }
  }

  /** The run is over / abandoned on purpose: the saved copy must not come back. Only when this session owns the slot. */
  function discardSave() {
    clearDirty();
    if (autosaveActive && !replaying) clearShift(storage);
    lastSavedTick = 0;
  }

  // ---- the tutorial driver ------------------------------------------------------------------------------------------------
  function applyOne(action, events) {
    const res = engine.applyAction(state, { ...action, playerId: meId });
    if (res.error) return res.error;
    state = res.state;
    for (const e of res.events) events.push(e);
    return null;
  }

  // The tutorial driver reads the new state and may answer with actions (a spawn, flags ...): apply them, let it look again.
  let lastLook = null;
  function pumpTutorial(events) {
    if (!driver) return;
    let seen = events.slice();
    for (let i = 0; i < 8 && !engine.isOver(state); i++) {
      const r = driver.advance(state, seen, { meId, look: lastLook });
      if (r.completed) onTutorialDone();
      if (!r.actions.length) return;
      seen = [];
      for (const a of r.actions) {
        const before = events.length;
        applyOne(a, events);
        for (let k = before; k < events.length; k++) seen.push(events[k]);
      }
    }
  }

  function onTutorialDone() {
    if (replaying) return;
    discardSave(); // a finished tutorial must never be offered as "resume"
    markTutorialDone(storage);
    reportTutorialDone({ storage, post }).catch(() => {});
    if (typeof options.onTutorialComplete === 'function') {
      try {
        options.onTutorialComplete();
      } catch {
        /* ignore */
      }
    }
  }

  function stopLoop() {
    if (handle !== null) frames.cancel(handle);
    handle = null;
  }

  function finalizeIfOver() {
    if (!engine.isOver(state)) return false;
    stopLoop();
    if (mode === 'tutorial' && driver && !driver.done && !driver.skipped && tutorialRestarts < MAX_TUTORIAL_RESTARTS) {
      // the (frozen-clock) tutorial shift ran out before it was finished: begin again rather than leave a dead screen
      tutorialRestarts += 1;
      driver = createTutorialDriver();
      state = newGame();
      lastSavedTick = 0;
      acc = 0;
      last = now();
      tickAt = last;
      lastError = 'The tutorial ran out of time, so we are starting it again.';
      const events = [];
      pumpTutorial(events);
      status = 'playing';
      schedule();
      return true;
    }
    if (mode === 'tutorial' && driver && !driver.done && !driver.skipped) {
      // the tutorial shift ended (or kept ending) before the lessons were finished: never show "tutorial complete" and never tell the
      // server the tutorial is done; it is an error screen with a way to try again
      status = 'error';
      result = null;
      lastError = 'The tutorial could not be finished. Please try again.';
      discardSave();
      return true;
    }
    status = state.status === 'closed' ? 'closed' : 'done';
    result = engine.result(state);
    discardSave(); // the shift is over: nothing to resume
    if (mode === 'practice' && !savedPractice && !replaying) {
      savedPractice = true;
      try {
        saveShiftResult(state.level, result.stars, result.money, storage);
      } catch {
        /* storage trouble must not break the results screen */
      }
    }
    return true;
  }

  /**
   * One tick of the engine plus everything that follows it. 'ok' | 'restarted' (the tutorial began again) | 'ended' | 'error'.
   * The frame loop and the replay both go through here, so a replayed tutorial takes exactly the same steps as the live one.
   */
  function tickOnce(events) {
    const res = engine.applyAction(state, { type: 'tick' });
    if (res.error) return 'error';
    state = res.state;
    for (const e of res.events) events.push(e);
    journalTick();
    pumpTutorial(events);
    if (finalizeIfOver()) return status === 'playing' ? 'restarted' : 'ended';
    return 'ok';
  }

  function frame() {
    handle = null;
    if (status !== 'playing' || disposed) return;
    const t = now();
    const dt = Math.max(0, t - last);
    last = t;
    acc += Math.min(dt, TICK_MS * MAX_CATCHUP_TICKS);
    const events = [];
    let n = 0;
    while (acc >= TICK_MS && status === 'playing') {
      acc -= TICK_MS;
      const r = tickOnce(events);
      if (r === 'error') {
        acc = 0;
        break;
      }
      n += 1;
      if (r === 'restarted') {
        n = 0; // restarted: the old events do not belong to the new game
        events.length = 0;
        notify([], { restarted: true });
        break;
      }
      if (r === 'ended') break;
    }
    if (n > 0) {
      tickAt = t - acc;
      notify(events);
    }
    if (status === 'playing') {
      if (autosaveActive && (state.tick < lastSavedTick || state.tick - lastSavedTick >= SAVE_EVERY_TICKS)) persist();
      schedule();
    }
  }

  function schedule() {
    if (replaying) return;
    if (handle === null && status === 'playing' && !disposed) handle = frames.request(frame);
  }

  function start() {
    if (disposed || status !== 'loading') return;
    status = 'playing';
    last = now();
    tickAt = last;
    acc = 0;
    const events = [];
    pumpTutorial(events);
    notify(events);
    schedule();
  }

  function pause() {
    if (status !== 'playing') return false;
    stopLoop();
    status = 'paused';
    notify([]);
    persist();
    return true;
  }

  function resume() {
    if (status !== 'paused') return false;
    autoPaused = false;
    status = 'playing';
    last = now();
    tickAt = last - acc; // the bars restart where the tick left off, not a pause later
    schedule();
    notify([]);
    return true;
  }

  function resetToFresh() {
    stopLoop();
    clearDirty();
    state = newGame();
    result = null;
    savedPractice = false;
    lastError = null;
    acc = 0;
    lastLook = null;
    driver = mode === 'tutorial' ? createTutorialDriver() : null;
    tutorialRestarts = 0;
    journalReset();
    lastSavedTick = 0;
    status = 'loading';
  }

  function restart() {
    if (disposed) return false;
    discardSave(); // an explicit new start: the old save is not wanted
    if (!fixedSeed) seed = randomSeed();
    resetToFresh();
    start();
    return true;
  }

  function dispose() {
    if (disposed) return;
    persist(); // leaving the screen mid-shift keeps the shift
    disposed = true;
    stopLoop();
    clearDirty();
    if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility);
    if (win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('pagehide', flush);
      win.removeEventListener('beforeunload', flush);
    }
    subs.clear();
  }

  function quit() {
    if (typeof options.onQuit === 'function') {
      try {
        options.onQuit();
      } catch {
        /* ignore */
      }
    }
    dispose(); // saves a running / paused shift on the way out
    status = 'closed';
  }

  function flush() {
    persist();
  }

  function onVisibility() {
    if (!doc) return;
    if (doc.hidden || doc.visibilityState === 'hidden') {
      if (pause()) autoPaused = true;
      else persist();
    }
  }
  if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibility);
  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('pagehide', flush);
    win.addEventListener('beforeunload', flush);
  }

  function dispatch(action) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string' || REFUSED_FROM_PLAYERS.has(action.type)) {
      lastError = 'That is not something you can do.';
      return false;
    }
    // the tutorial teaches one thing at a time: Chotu refuses the rest (the HUD checks first and shows the same toast)
    if (driver && !driver.finished && !driver.skipped && typeof driver.allows === 'function' && !driver.allows(action.type)) {
      lastError = driver.notYet || 'Chotu says: not yet!';
      return false;
    }
    if (status !== 'playing') {
      lastError = status === 'paused' ? 'The game is paused.' : status === 'loading' ? 'Not started yet.' : 'The shift is over.';
      return false;
    }
    if (mode === 'tutorial') {
      // the journal stores exactly what the engine will see, so the live game and its replay cannot differ
      try {
        const { playerId, ...bare } = JSON.parse(JSON.stringify(action)); // eslint-disable-line no-unused-vars
        action = bare;
      } catch {
        lastError = 'That is not something you can do.';
        return false;
      }
    }
    const events = [];
    const error = applyOne(action, events);
    if (error) {
      lastError = error;
      notify([], { error });
      return false;
    }
    lastError = null;
    if (mode === 'tutorial') journalPush(['a', action]);
    pumpTutorial(events);
    const restarted = finalizeIfOver() && status === 'playing';
    notify(restarted ? [] : events, restarted ? { restarted: true } : undefined);
    if (status === 'playing') markDirty();
    return true;
  }

  const tutorial = driver
    ? {
        get steps() { return driver.steps; },
        get index() { return driver.index; },
        get step() { return driver.step; },
        get done() { return driver.done; },
        get finished() { return driver.finished; },
        get skipped() { return driver.skipped; },
        get say() { return driver.say; },
        get text() { return driver.text; },
        get te() { return driver.te; },
        get hint() { return driver.hint; },
        get notice() { return driver.notice; },
        get spotlight() { return driver.spotlight; },
        get ackable() { return driver.ackable; },
        get progress() { return driver.progress; },
        get chapter() { return driver.chapter; },
        get chapters() { return driver.chapters; },
        get recipe() { return driver.recipe; },
        get allowed() { return driver.allowed; },
        get notYet() { return driver.notYet; },
        get controls() { return driver.controls; },
        get pointer() { return driver.pointer; },
        allows(type) { return driver.allows(type); },
        /** 'touch' | 'keyboard': picks which copy variants text / hint / controls return. */
        setPointer(p) { driver.setPointer(p); },
        /** The scene's head direction ({yaw, pitch}), for the 'look around' step; applied on the next tutorial pump. */
        noteLook(look) {
          const q = quantLook(look);
          if (q === null ? lastLook === null : lastLook !== null && lastLook.yaw === q.yaw && lastLook.pitch === q.pitch) return; // nothing new
          lastLook = q;
          journalPush(q ? ['l', q.yaw, q.pitch] : ['l']);
          const events = [];
          pumpTutorial(events);
          if (events.length) notify(events);
        },
        /** The player pressed "Got it" (a no-op on steps that do not wait for it). */
        ack() {
          if (!driver.ack()) return false;
          journalPush(['k']);
          const events = [];
          pumpTutorial(events);
          notify(events);
          markDirty();
          return true;
        },
        /** Leave the tutorial unfinished: the game stops (paused), the tutorial does NOT count as done. */
        skip() {
          driver.skip();
          pause();
          discardSave(); // a skipped tutorial is not resumable
          if (typeof options.onTutorialSkip === 'function') {
            try {
              options.onTutorialSkip();
            } catch {
              /* ignore */
            }
          }
          notify([]);
          return true;
        },
      }
    : null;

  /** Rebuild a tutorial run from its journal. true only when it lands on exactly the saved state and step. */
  function replayTutorial(snap) {
    replaying = true;
    try {
      start(); // status loading -> playing, and the driver's first look
      for (const op of snap.driver.journal) {
        if (typeof op === 'number') {
          for (let i = 0; i < op; i++) {
            const r = tickOnce([]);
            if (r === 'error' || r === 'ended') return false;
          }
        } else if (op[0] === 'a') {
          if (!dispatch(op[1])) return false;
        } else if (op[0] === 'k') {
          if (!tutorial.ack()) return false;
        } else if (op[0] === 'l') {
          tutorial.noteLook(op.length === 3 ? { yaw: op[1], pitch: op[2] } : null);
        }
      }
      return (
        status === 'playing' &&
        tutorialRestarts === snap.driver.restarts &&
        driver.index === snap.driver.index &&
        JSON.stringify(state) === JSON.stringify(snap.state)
      );
    } catch {
      return false;
    } finally {
      replaying = false;
    }
  }

  /** Bring the saved run back, paused. A save this engine cannot honestly rebuild is dropped and a fresh (paused) shift stands in. */
  function doResume() {
    let ok = true;
    if (mode === 'practice') {
      state = resumeSnap.state;
      status = 'paused';
    } else {
      resetToFresh();
      ok = replayTutorial(resumeSnap);
    }
    if (!ok) {
      resumeError = 'mismatch';
      if (autosaveActive) clearShift(storage);
      resetToFresh();
      if (options.autoStart !== false) {
        start();
        pause();
      }
      return;
    }
    resumed = true;
    status = 'paused';
    stopLoop();
    lastError = null;
    acc = 0;
    last = now();
    tickAt = last;
    lastSavedTick = state.tick;
    notify([]);
  }

  const session = {
    mode,
    meId,
    players: [player],
    get state() { return state; },
    get tickAt() { return tickAt; },
    get status() { return status; },
    get connection() { return 'open'; },
    get lastError() { return lastError; },
    get result() { return result; },
    get tutorial() { return tutorial; },
    get autoPaused() { return autoPaused; },
    get paused() { return status === 'paused'; },
    /** true when this session was rebuilt from a saved shift. */
    get resumed() { return resumed; },
    /** null, or why a requested resume was refused: 'invalid' (not a usable snapshot) | 'mismatch' (the replay did not land on the save). */
    get resumeError() { return resumeError; },
    /** null, or { title, level, pace, mode, tick, shiftTicks, money, savedAt } of the older save this fresh session is NOT overwriting. */
    get saveConflict() { return saveConflict; },
    get autosaveActive() { return autosaveActive; },
    /** why the last write failed ('quota' | 'unavailable' | 'too-big' ...) or null. */
    get saveError() { return lastSaveError; },
    dispatch,
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subs.add(fn);
      return () => subs.delete(fn);
    },
    start,
    pause,
    resume,
    restart,
    quit,
    dispose,
    /** Save right now (the glue calls this when the player opens the menu, say). true = written. */
    saveNow() { return persist(); },
    /** The snapshot a save would write, or null. */
    snapshot() { return snapshotNow(); },
    /** Decide a save conflict: 'replace' starts auto-saving over the old save, 'keep' leaves it alone (this session then never saves). */
    resolveSaveConflict(choice) {
      if (!saveConflict && choice !== 'keep') return false;
      if (choice === 'replace') {
        saveConflict = null;
        autosaveActive = options.autosave !== false;
        persist();
        return true;
      }
      if (choice === 'keep') {
        saveConflict = null;
        autosaveActive = false;
        clearDirty();
        return true;
      }
      return false;
    },
  };

  // a tutorial finished on an earlier visit but never reported (offline, signed out): try again now
  Promise.resolve(syncPendingTutorial({ storage, post })).catch(() => {});

  if (resumeSnap) {
    doResume();
  } else {
    if (autosaveActive) {
      if (resumeError) {
        clearShift(storage); // a resume that could not be used: that save is junk
      } else if (options.replaceSave !== true) {
        let existing = null;
        try {
          existing = loadShift(storage, { stateVersion });
        } catch {
          existing = null;
        }
        if (existing) {
          saveConflict = describeSavedShift(existing);
          autosaveActive = false; // never overwrite until the caller decides
          if (typeof options.onSaveConflict === 'function') {
            let choice;
            try {
              choice = options.onSaveConflict(saveConflict);
            } catch {
              choice = undefined;
            }
            if (choice === 'replace' || choice === 'keep') session.resolveSaveConflict(choice);
          }
        }
      }
    }
    if (options.autoStart !== false) {
      start();
      if (resumeError) pause(); // an unusable resume never runs by itself
    }
  }
  return session;
}
