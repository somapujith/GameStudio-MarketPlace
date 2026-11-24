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
import { TICK_MS } from '@shared/tiffin-centre/catalog.js';
import * as realEngine from '@shared/tiffin-centre/index.js';
import { TUTORIAL_SETTINGS, createTutorialDriver } from '@shared/tiffin-centre/tutorial.js';
import { defaultStorage, markTutorialDone, reportTutorialDone, saveShiftResult, syncPendingTutorial } from './progress.js';

export const MAX_CATCHUP_TICKS = 5;
export const LOCAL_PLAYER_ID = 'me';
const MAX_TUTORIAL_RESTARTS = 3;
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

/**
 * options: { mode: 'tutorial'|'practice', level, pace, playerName, avatar, seed, onTutorialComplete, onTutorialSkip, onQuit,
 *            autoStart = true } plus test hooks { engine, now, frames: { request, cancel }, storage, post, document }.
 */
export function createLocalSession(options = {}) {
  const mode = options.mode === 'tutorial' ? 'tutorial' : 'practice';
  const engine = options.engine || realEngine;
  const now = options.now || defaultNow;
  const frames = options.frames || defaultFrames();
  const storage = options.storage || defaultStorage();
  const post = options.post;
  const doc = options.document !== undefined ? options.document : typeof document !== 'undefined' ? document : null;
  const meId = LOCAL_PLAYER_ID;
  const player = { id: meId, name: options.playerName || 'You', avatar: options.avatar ?? null, online: true };
  const settings = mode === 'tutorial' ? { ...TUTORIAL_SETTINGS } : { level: Math.max(1, Math.trunc(Number(options.level)) || 1), pace: options.pace || 'normal' };
  const fixedSeed = options.seed !== undefined && options.seed !== null;

  let seed = fixedSeed ? options.seed : randomSeed();
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
  const subs = new Set();

  const newGame = () => engine.createGame({ players: [{ id: meId, name: player.name, avatar: player.avatar }], settings, seed });
  state = newGame();

  function notify(events = [], extra) {
    const payload = { state, events, tickAt, ...(extra || {}) };
    for (const fn of [...subs]) {
      try {
        fn(payload);
      } catch {
        /* a bad subscriber must not stop the game */
      }
    }
  }

  function applyOne(action, events) {
    const res = engine.applyAction(state, { ...action, playerId: meId });
    if (res.error) return res.error;
    state = res.state;
    for (const e of res.events) events.push(e);
    return null;
  }

  // The tutorial driver reads the new state and may answer with actions (a spawn, flags ...): apply them, let it look again.
  function pumpTutorial(events) {
    if (!driver) return;
    let seen = events.slice();
    for (let i = 0; i < 8 && !engine.isOver(state); i++) {
      const r = driver.advance(state, seen, { meId });
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
    status = state.status === 'closed' ? 'closed' : 'done';
    result = engine.result(state);
    if (mode === 'practice' && !savedPractice) {
      savedPractice = true;
      try {
        saveShiftResult(state.level, result.stars, result.money, storage);
      } catch {
        /* storage trouble must not break the results screen */
      }
    }
    return true;
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
      const res = engine.applyAction(state, { type: 'tick' });
      if (res.error) {
        acc = 0;
        break;
      }
      state = res.state;
      for (const e of res.events) events.push(e);
      n += 1;
      pumpTutorial(events);
      if (finalizeIfOver()) {
        if (status !== 'playing') break;
        n = 0; // restarted: the old events do not belong to the new game
        events.length = 0;
        notify([], { restarted: true });
        break;
      }
    }
    if (n > 0) {
      tickAt = t - acc;
      notify(events);
    }
    if (status === 'playing') schedule();
  }

  function schedule() {
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
    return true;
  }

  function resume() {
    if (status !== 'paused') return false;
    autoPaused = false;
    status = 'playing';
    last = now();
    schedule();
    notify([]);
    return true;
  }

  function restart() {
    if (disposed) return false;
    stopLoop();
    if (!fixedSeed) seed = randomSeed();
    state = newGame();
    result = null;
    savedPractice = false;
    lastError = null;
    acc = 0;
    driver = mode === 'tutorial' ? createTutorialDriver() : null;
    tutorialRestarts = 0;
    status = 'loading';
    start();
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopLoop();
    if (doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisibility);
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
    dispose();
    status = 'closed';
  }

  function onVisibility() {
    if (!doc) return;
    if (doc.hidden || doc.visibilityState === 'hidden') {
      if (pause()) autoPaused = true;
    }
  }
  if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', onVisibility);

  function dispatch(action) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string' || REFUSED_FROM_PLAYERS.has(action.type)) {
      lastError = 'That is not something you can do.';
      return false;
    }
    if (status !== 'playing') {
      lastError = status === 'paused' ? 'The game is paused.' : status === 'loading' ? 'Not started yet.' : 'The shift is over.';
      return false;
    }
    const events = [];
    const error = applyOne(action, events);
    if (error) {
      lastError = error;
      notify([], { error });
      return false;
    }
    lastError = null;
    pumpTutorial(events);
    const restarted = finalizeIfOver() && status === 'playing';
    notify(restarted ? [] : events, restarted ? { restarted: true } : undefined);
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
        /** The player pressed "Got it" (a no-op on steps that do not wait for it). */
        ack() {
          if (!driver.ack()) return false;
          const events = [];
          pumpTutorial(events);
          notify(events);
          return true;
        },
        /** Leave the tutorial unfinished: the game stops (paused), the tutorial does NOT count as done. */
        skip() {
          driver.skip();
          pause();
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
  };

  // a tutorial finished on an earlier visit but never reported (offline, signed out): try again now
  Promise.resolve(syncPendingTutorial({ storage, post })).catch(() => {});

  if (options.autoStart !== false) start();
  return session;
}
