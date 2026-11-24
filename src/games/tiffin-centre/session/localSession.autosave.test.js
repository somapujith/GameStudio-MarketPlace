import { afterEach, describe, expect, it, vi } from 'vitest';
import { TICK_MS, TUTORIAL_LOCAL_KEY } from '@shared/tiffin-centre/catalog.js';
import * as engineNs from '@shared/tiffin-centre/index.js';
import { chooseAutoAction } from '@shared/tiffin-centre/index.js';
import { SHIFT_KEY, loadShift, saveShift } from './autosave.js';
import { SAVE_DEBOUNCE_MS, SAVE_EVERY_TICKS, createLocalSession } from './localSession.js';
import { TUTORIAL_PENDING_KEY } from './progress.js';

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  const s = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), m, writes: 0 };
  const set = s.setItem;
  s.setItem = (k, v) => {
    if (k === SHIFT_KEY) s.writes += 1;
    set(k, v);
  };
  return s;
}

/** A manual clock and frame scheduler; `advance(ms)` runs the loop in 16 ms frames. */
function rig(extra = {}) {
  const r = { t: 1000, cb: null, handle: 0 };
  r.frames = { request: (fn) => ((r.cb = fn), ++r.handle), cancel: () => void (r.cb = null) };
  r.now = () => r.t;
  r.frame = (ms = 16) => {
    r.t += ms;
    const cb = r.cb;
    r.cb = null;
    if (cb) cb();
  };
  r.advance = (ms) => {
    for (let spent = 0; spent < ms; spent += 16) r.frame(Math.min(16, ms - spent));
  };
  r.storage = extra.storage || fakeStorage();
  r.post = vi.fn().mockResolvedValue({ ok: true });
  r.opts = { now: r.now, frames: r.frames, storage: r.storage, post: r.post, document: null, window: null, wallNow: () => 1700000000000, ...extra };
  return r;
}

/** one "turn" of a player: the bot's move (if any), then a second of time */
const botStep = (s, r) => {
  const a = chooseAutoAction(s.state, 'me');
  if (a) s.dispatch(a);
  r.advance(TICK_MS);
};
const json = (s) => JSON.stringify(s.state);

afterEach(() => vi.useRealTimers());

describe('auto-save: when it writes', () => {
  it('saves every 5 ticks while playing', () => {
    const r = rig();
    createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    r.advance(TICK_MS * (SAVE_EVERY_TICKS - 1));
    expect(r.storage.writes).toBe(0);
    r.advance(TICK_MS);
    expect(r.storage.writes).toBe(1);
    expect(loadShift(r.storage).state.tick).toBe(SAVE_EVERY_TICKS);
    r.advance(TICK_MS * SAVE_EVERY_TICKS);
    expect(r.storage.writes).toBe(2);
    expect(loadShift(r.storage).state.tick).toBe(SAVE_EVERY_TICKS * 2);
  });

  it('saves within a second of a player action (one write for a burst of actions), not instantly', () => {
    vi.useFakeTimers();
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    let a = null;
    for (let i = 0; i < 40 && !a; i++) {
      r.advance(TICK_MS);
      a = chooseAutoAction(s.state, 'me');
    }
    expect(a).toBeTruthy();
    r.storage.writes = 0;
    expect(s.dispatch(a)).toBe(true);
    s.dispatch({ type: 'move', to: null });
    expect(r.storage.writes).toBe(0);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
    expect(r.storage.writes).toBe(0);
    vi.advanceTimersByTime(2);
    expect(r.storage.writes).toBe(1);
    expect(loadShift(r.storage).state.tick).toBe(s.state.tick);
    vi.advanceTimersByTime(5000);
    expect(r.storage.writes).toBe(1); // nothing new happened
  });

  it('a refused action does not schedule a save', () => {
    vi.useFakeTimers();
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    expect(s.dispatch({ type: 'tick' })).toBe(false);
    expect(s.dispatch({ type: 'cook', station: 'nope', slot: 9, dish: 'zzz' })).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(r.storage.writes).toBe(0);
  });

  it('saves when paused, when the page is hidden, and on pagehide / beforeunload', () => {
    const listeners = {};
    const doc = { hidden: false, addEventListener: (n, f) => (listeners[`d:${n}`] = f), removeEventListener: (n) => delete listeners[`d:${n}`] };
    const win = { addEventListener: (n, f) => (listeners[`w:${n}`] = f), removeEventListener: (n) => delete listeners[`w:${n}`] };
    const r = rig({ document: doc, window: win });
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    r.advance(TICK_MS * 2);
    s.pause();
    expect(loadShift(r.storage).state.tick).toBe(2);
    s.resume();
    r.advance(TICK_MS * 2);
    doc.hidden = true;
    listeners['d:visibilitychange']();
    expect(s.status).toBe('paused');
    expect(loadShift(r.storage).state.tick).toBe(4);
    s.resume();
    r.advance(TICK_MS);
    listeners['w:pagehide']();
    expect(loadShift(r.storage).state.tick).toBe(5);
    r.advance(TICK_MS);
    listeners['w:beforeunload']();
    expect(loadShift(r.storage).state.tick).toBe(6);
    s.dispose();
    expect(listeners['w:pagehide']).toBeUndefined();
  });

  it('keeps the shift when the player quits to the menu (and when the screen is just disposed)', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 2, seed: 4, ...r.opts });
    r.advance(TICK_MS * 3);
    s.quit();
    expect(s.status).toBe('closed');
    expect(loadShift(r.storage)).toMatchObject({ mode: 'practice', level: 2, state: { tick: 3 } });
    s.quit(); // twice is fine
    const r2 = rig();
    const s2 = createLocalSession({ mode: 'practice', level: 3, seed: 4, ...r2.opts });
    r2.advance(TICK_MS * 2);
    s2.dispose();
    expect(loadShift(r2.storage).level).toBe(3);
  });

  it('clears the save when the shift ends, and a finished shift is never saved again by quit', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    let guard = 0;
    while (s.status === 'playing' && guard++ < 2000) botStep(s, r);
    expect(['done', 'closed']).toContain(s.status);
    expect(r.storage.getItem(SHIFT_KEY)).toBe(null);
    s.quit();
    expect(r.storage.getItem(SHIFT_KEY)).toBe(null);
  });

  it('restart is an explicit new start: the old save goes', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    r.advance(TICK_MS * 6);
    expect(r.storage.getItem(SHIFT_KEY)).not.toBe(null);
    s.restart();
    expect(r.storage.getItem(SHIFT_KEY)).toBe(null);
    r.advance(TICK_MS * SAVE_EVERY_TICKS);
    expect(loadShift(r.storage).state.tick).toBe(SAVE_EVERY_TICKS);
  });

  it('autosave: false never touches the slot', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, autosave: false, ...r.opts });
    r.advance(TICK_MS * 12);
    s.pause();
    s.quit();
    expect(r.storage.writes).toBe(0);
  });
});

describe('auto-save: a save that already exists', () => {
  const existing = () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 3, seed: 9, ...r.opts });
    r.advance(TICK_MS * 6);
    s.pause();
    return { storage: r.storage, snap: loadShift(r.storage) };
  };

  it('a fresh start does NOT overwrite it until the caller decides', () => {
    const { storage, snap } = existing();
    const before = storage.getItem(SHIFT_KEY);
    const r = rig({ storage });
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    expect(s.saveConflict).toMatchObject({ level: 3, mode: 'practice', tick: snap.state.tick, title: 'Poori Morning' });
    expect(s.autosaveActive).toBe(false);
    r.advance(TICK_MS * 20);
    s.dispatch({ type: 'move', to: null });
    s.pause();
    s.quit();
    expect(storage.getItem(SHIFT_KEY)).toBe(before);
  });

  it("replaceSave: true is the player's explicit choice", () => {
    const { storage } = existing();
    const r = rig({ storage });
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, replaceSave: true, ...r.opts });
    expect(s.saveConflict).toBe(null);
    r.advance(TICK_MS * SAVE_EVERY_TICKS);
    expect(loadShift(storage).level).toBe(1);
  });

  it("onSaveConflict can answer 'replace' or 'keep' at once", () => {
    const a = existing();
    const seen = vi.fn(() => 'replace');
    const ra = rig({ storage: a.storage });
    createLocalSession({ mode: 'practice', level: 1, seed: 4, onSaveConflict: seen, ...ra.opts });
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ level: 3 }));
    ra.advance(TICK_MS * SAVE_EVERY_TICKS);
    expect(loadShift(a.storage).level).toBe(1);

    const b = existing();
    const rb = rig({ storage: b.storage });
    const sb = createLocalSession({ mode: 'practice', level: 1, seed: 4, onSaveConflict: () => 'keep', ...rb.opts });
    rb.advance(TICK_MS * 20);
    sb.quit();
    expect(loadShift(b.storage).level).toBe(3);
    expect(sb.saveConflict).toBe(null);

    const c = existing();
    const rc = rig({ storage: c.storage });
    expect(() => createLocalSession({ mode: 'practice', level: 1, seed: 4, onSaveConflict: () => { throw new Error('ui'); }, ...rc.opts })).not.toThrow();
  });

  it('resolveSaveConflict decides later', () => {
    const { storage } = existing();
    const r = rig({ storage });
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    r.advance(TICK_MS * 3);
    expect(s.resolveSaveConflict('nonsense')).toBe(false);
    expect(s.resolveSaveConflict('replace')).toBe(true);
    expect(loadShift(storage).level).toBe(1); // written at once
    expect(s.autosaveActive).toBe(true);
    expect(s.resolveSaveConflict('replace')).toBe(false); // nothing left to decide
  });

  it('a corrupt old save is not a conflict', () => {
    const storage = fakeStorage({ [SHIFT_KEY]: '{garbage' });
    const r = rig({ storage });
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    expect(s.saveConflict).toBe(null);
    expect(s.autosaveActive).toBe(true);
  });
});

describe('resume: practice', () => {
  it('comes back paused with the same state, then plays on exactly like an uninterrupted run', () => {
    // the uninterrupted reference
    const ra = rig();
    const a = createLocalSession({ mode: 'practice', level: 3, seed: 21, autosave: false, ...ra.opts });
    for (let i = 0; i < 140; i++) botStep(a, ra);

    // the same run, saved and resumed at tick 60
    const rb = rig();
    const b = createLocalSession({ mode: 'practice', level: 3, seed: 21, ...rb.opts });
    for (let i = 0; i < 60; i++) botStep(b, rb);
    b.pause();
    const snap = loadShift(rb.storage);
    expect(snap.state.tick).toBe(60);

    const rc = rig({ storage: rb.storage });
    const c = createLocalSession({ resume: snap, playerName: 'Asha', ...rc.opts });
    expect(c.resumed).toBe(true);
    expect(c.resumeError).toBe(null);
    expect(c.mode).toBe('practice');
    expect(c.status).toBe('paused');
    expect(json(c)).toBe(json(b));
    expect(c.dispatch({ type: 'move', to: null })).toBe(false); // paused: never auto-runs
    rc.advance(TICK_MS * 5);
    expect(c.state.tick).toBe(60);
    expect(c.resume()).toBe(true);
    expect(c.status).toBe('playing');
    expect(c.tickAt).toBe(rc.t); // the tick clock restarted at the resume
    for (let i = 0; i < 80; i++) botStep(c, rc);
    expect(c.state.tick).toBe(140);
    expect(json(c)).toBe(json(a));
  });

  it('keeps saving after a resume, and the resumed shift can end and clear the save', () => {
    const r0 = rig();
    const s0 = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r0.opts });
    for (let i = 0; i < 30; i++) botStep(s0, r0);
    s0.quit();
    const r = rig({ storage: r0.storage });
    const s = createLocalSession({ resume: loadShift(r0.storage), ...r.opts });
    s.resume();
    for (let i = 0; i < 10; i++) botStep(s, r);
    expect(loadShift(r.storage).state.tick).toBe(40);
    let guard = 0;
    while (s.status === 'playing' && guard++ < 2000) botStep(s, r);
    expect(['done', 'closed']).toContain(s.status);
    expect(r.storage.getItem(SHIFT_KEY)).toBe(null);
  });

  it('level / pace / seed come from the save, not from the options', () => {
    const r0 = rig();
    createLocalSession({ mode: 'practice', level: 4, pace: 'rush', seed: 77, ...r0.opts });
    r0.advance(TICK_MS * 5);
    const snap = loadShift(r0.storage);
    const r = rig({ storage: r0.storage });
    const s = createLocalSession({ resume: snap, mode: 'tutorial', level: 1, pace: 'relaxed', seed: 5, ...r.opts });
    expect(s.mode).toBe('practice');
    expect(s.state.level).toBe(4);
    expect(s.state.pace).toBe('rush');
    expect(s.state.seed).toBe(77);
    expect(s.tutorial).toBe(null);
  });

  it('restart after a resume starts a new shift (the old save goes)', () => {
    const r0 = rig();
    const s0 = createLocalSession({ mode: 'practice', level: 2, seed: 4, ...r0.opts });
    r0.advance(TICK_MS * 7);
    s0.quit();
    const r = rig({ storage: r0.storage });
    const s = createLocalSession({ resume: loadShift(r0.storage), ...r.opts });
    s.restart();
    expect(s.status).toBe('playing');
    expect(s.state.tick).toBe(0);
    expect(r.storage.getItem(SHIFT_KEY)).toBe(null);
  });
});

describe('resume: unusable saves never crash', () => {
  const goodSnap = () => {
    const r = rig();
    createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    r.advance(TICK_MS * 5);
    return loadShift(r.storage);
  };

  it('junk as a snapshot gives a fresh PAUSED shift and error "invalid"', () => {
    for (const junk of [{}, { v: 9 }, 'x', 12, [], { ...goodSnap(), state: { v: 1 } }, { ...goodSnap(), mode: 'tutorial' }]) {
      const r = rig();
      saveShift(goodSnap(), r.storage);
      const s = createLocalSession({ resume: junk, mode: 'practice', level: 1, seed: 4, ...r.opts });
      expect(s.resumed).toBe(false);
      expect(s.resumeError).toBe('invalid');
      expect(s.status).toBe('paused');
      expect(r.storage.getItem(SHIFT_KEY)).toBe(null); // the bad save is gone
      r.advance(TICK_MS * 3);
      expect(s.state.tick).toBe(0);
      expect(s.resume()).toBe(true);
    }
  });

  it('a state from a different engine version is refused', () => {
    const snap = goodSnap();
    const engineStub = { ...realEngine(), STATE_VERSION: 99 };
    const r = rig();
    const s = createLocalSession({ resume: snap, engine: engineStub, ...r.opts });
    expect(s.resumeError).toBe('invalid');
  });

  it('an engine that throws while probing the state does not escape', () => {
    const engine = { ...realEngine(), applyAction: () => { throw new Error('engine broke'); } };
    const r = rig();
    expect(() => createLocalSession({ resume: goodSnap(), engine, ...r.opts })).not.toThrow();
  });

  it('a resumed state whose player is not "me" is refused', () => {
    const snap = goodSnap();
    snap.state = { ...snap.state, players: { other: snap.state.players.me } };
    const r = rig();
    expect(createLocalSession({ resume: snap, ...r.opts }).resumeError).toBe('invalid');
  });
});

const realEngine = () => ({ ...engineNs });

describe('failure modes while playing', () => {
  it('blocked storage (private mode) never breaks the game', () => {
    const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    const r = rig({ storage: boom });
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    for (let i = 0; i < 20; i++) botStep(s, r);
    s.pause();
    s.resume();
    expect(() => s.quit()).not.toThrow();
    expect(s.state.tick).toBe(20);
  });

  it('a full disk is reported as saveError and retried, never thrown', () => {
    const r = rig();
    const real = r.storage.setItem;
    let full = true;
    r.storage.setItem = (k, v) => {
      if (full && k === SHIFT_KEY) {
        const e = new Error('full');
        e.name = 'QuotaExceededError';
        throw e;
      }
      real(k, v);
    };
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    r.advance(TICK_MS * 5);
    expect(s.saveError).toBe('quota');
    expect(r.storage.getItem(SHIFT_KEY)).toBe(null);
    full = false;
    r.advance(TICK_MS * 5);
    expect(s.saveError).toBe(null);
    expect(loadShift(r.storage).state.tick).toBe(10);
  });

  it('a save is not written for a snapshot the validator refuses (and the old good one stays)', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    r.advance(TICK_MS * 5);
    const good = r.storage.getItem(SHIFT_KEY);
    s.state.shiftTicks = 'x'; // a broken engine state
    expect(s.saveNow()).toBe(false);
    expect(r.storage.getItem(SHIFT_KEY)).toBe(good);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
// tutorial: the real driver, the real engine, a person-like player

/** One turn of a person following Chotu: head, "Got it", the walk, then the bot (only what is allowed); then a second passes. */
function tutorialTurn(s, r) {
  const t = s.tutorial;
  if (t.step.id === 'look') s.tutorial.noteLook({ yaw: (s.state.tick % 40) * 0.1, pitch: 0 });
  if (t.ackable) t.ack();
  else if (t.step.id === 'walk') s.dispatch({ type: 'move', to: 'tawa1' });
  else {
    const a = chooseAutoAction(s.state, 'me');
    if (a && t.allows(a.type)) s.dispatch(a);
  }
  r.advance(TICK_MS);
}

function finishTutorial(s, r, maxTurns = 3000) {
  let guard = 0;
  while (!s.tutorial.finished && s.status === 'playing' && guard++ < maxTurns) tutorialTurn(s, r);
}

/** Everything the screen can read from the tutorial, for comparing two sessions. */
const tutorialView = (s) => {
  const t = s.tutorial;
  return { index: t.index, id: t.step.id, text: t.text, hint: t.hint, notice: t.notice, spotlight: t.spotlight, progress: t.progress, allowed: t.allowed, ackable: t.ackable, done: t.done, finished: t.finished };
};

describe('resume: the tutorial (replayed through the real driver)', () => {
  it.each([1, 7, 30, 90, 140, 175])('resumes after %i turns exactly: same state, same lesson, same ending', (turns) => {
    // reference: never interrupted
    const ra = rig();
    const a = createLocalSession({ mode: 'tutorial', seed: 8, autosave: false, ...ra.opts });
    for (let i = 0; i < turns; i++) tutorialTurn(a, ra);
    const midA = { json: json(a), view: tutorialView(a) };
    finishTutorial(a, ra);
    expect(a.tutorial.done).toBe(true);

    // the interrupted twin: same turns, then "close the tab" (quit saves), reopen with the save
    const rb = rig();
    const b = createLocalSession({ mode: 'tutorial', seed: 8, ...rb.opts });
    for (let i = 0; i < turns; i++) tutorialTurn(b, rb);
    b.quit();
    const snap = loadShift(rb.storage);
    expect(snap.mode).toBe('tutorial');
    expect(snap.driver.index).toBe(midA.view.index);

    const rc = rig({ storage: rb.storage });
    const c = createLocalSession({ resume: snap, playerName: 'Asha', ...rc.opts });
    expect(c.resumeError).toBe(null);
    expect(c.resumed).toBe(true);
    expect(c.status).toBe('paused');
    expect(c.mode).toBe('tutorial');
    expect(json(c)).toBe(midA.json);
    expect(tutorialView(c)).toEqual(midA.view);
    c.resume();
    finishTutorial(c, rc);
    expect(c.tutorial.done).toBe(true);
    expect(json(c)).toBe(json(a));
    expect(rc.storage.getItem(SHIFT_KEY)).toBe(null); // completed: nothing left to resume
    expect(rc.storage.getItem(TUTORIAL_LOCAL_KEY)).toBe('1');
  });

  it('can be resumed, saved again and resumed a second time (the journal survives a replay)', () => {
    const r1 = rig();
    const s1 = createLocalSession({ mode: 'tutorial', seed: 8, ...r1.opts });
    for (let i = 0; i < 70; i++) tutorialTurn(s1, r1);
    s1.quit();
    const snap1 = loadShift(r1.storage);

    const r2 = rig({ storage: r1.storage });
    const s2 = createLocalSession({ resume: snap1, ...r2.opts });
    s2.resume();
    for (let i = 0; i < 70; i++) tutorialTurn(s2, r2);
    const mid = json(s2);
    s2.quit();
    const snap2 = loadShift(r2.storage);
    expect(snap2.state.tick).toBeGreaterThan(snap1.state.tick);

    const r3 = rig({ storage: r2.storage });
    const s3 = createLocalSession({ resume: snap2, ...r3.opts });
    expect(s3.resumed).toBe(true);
    expect(json(s3)).toBe(mid);
  });

  it('a saved "Got it" and head turn are part of the journal', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'tutorial', seed: 8, ...r.opts });
    let guard = 0;
    while (s.tutorial.step.id !== 'walk' && guard++ < 300) tutorialTurn(s, r);
    expect(s.tutorial.step.id).toBe('walk');
    s.pause();
    const snap = loadShift(r.storage);
    expect(snap.driver.journal.some((op) => Array.isArray(op) && op[0] === 'k')).toBe(true);
    expect(snap.driver.journal.some((op) => Array.isArray(op) && op[0] === 'l')).toBe(true);
    const c = createLocalSession({ resume: snap, ...rig({ storage: r.storage }).opts });
    expect(c.tutorial.step.id).toBe('walk');
  });

  it('a tampered journal is detected: the save is dropped and a fresh paused tutorial stands in', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'tutorial', seed: 8, ...r.opts });
    for (let i = 0; i < 60; i++) tutorialTurn(s, r);
    s.pause();
    const snap = loadShift(r.storage);
    const cut = JSON.parse(JSON.stringify(snap));
    cut.driver.journal = cut.driver.journal.filter((op) => !(Array.isArray(op) && op[0] === 'a'));
    const r2 = rig({ storage: r.storage });
    saveShift(cut, r2.storage);
    const c = createLocalSession({ resume: cut, ...r2.opts });
    expect(c.resumed).toBe(false);
    expect(c.resumeError).toBe('mismatch');
    expect(c.status).toBe('paused');
    expect(c.state.tick).toBe(0);
    expect(c.tutorial.step.id).toBe('welcome');
    expect(r2.storage.getItem(SHIFT_KEY)).toBe(null);
    expect(c.resume()).toBe(true);
    r2.advance(TICK_MS * 3);
    expect(c.state.tick).toBe(3);

    // a wrong saved state fails the same way
    const wrong = JSON.parse(JSON.stringify(snap));
    wrong.state.money = 12345;
    const c2 = createLocalSession({ resume: wrong, ...rig().opts });
    expect(c2.resumeError).toBe('mismatch');
  });

  it('completing the tutorial clears the save, and a skipped tutorial is not resumable', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'tutorial', seed: 8, ...r.opts });
    for (let i = 0; i < 30; i++) tutorialTurn(s, r);
    expect(r.storage.getItem(SHIFT_KEY)).not.toBe(null);
    finishTutorial(s, r);
    expect(s.tutorial.done).toBe(true);
    expect(r.storage.getItem(SHIFT_KEY)).toBe(null);
    s.quit();
    expect(r.storage.getItem(SHIFT_KEY)).toBe(null); // not re-saved by the quit

    const r2 = rig();
    const s2 = createLocalSession({ mode: 'tutorial', seed: 8, ...r2.opts });
    for (let i = 0; i < 20; i++) tutorialTurn(s2, r2);
    expect(r2.storage.getItem(SHIFT_KEY)).not.toBe(null);
    s2.tutorial.skip();
    expect(r2.storage.getItem(SHIFT_KEY)).toBe(null);
    s2.quit();
    expect(r2.storage.getItem(SHIFT_KEY)).toBe(null);
  });

  it('the tutorial save stays small (journal run-length encoded)', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'tutorial', seed: 8, ...r.opts });
    for (let i = 0; i < 150; i++) tutorialTurn(s, r);
    s.pause();
    expect(r.storage.getItem(SHIFT_KEY).length).toBeLessThan(60 * 1024);
  });
});

describe('the tutorial-complete POST failing offline', () => {
  it('never rejects, never throws, keeps the pending flag for the next start', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    for (const post of [vi.fn().mockRejectedValue(new Error('Offline')), vi.fn(() => { throw new Error('sync boom'); }), vi.fn(() => Promise.reject(undefined))]) {
      const r = rig({ post });
      const s = createLocalSession({ mode: 'tutorial', seed: 8, ...r.opts });
      finishTutorial(s, r);
      expect(s.tutorial.done).toBe(true);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(r.storage.getItem(TUTORIAL_PENDING_KEY)).toBe('1');
      expect(r.storage.getItem(TUTORIAL_LOCAL_KEY)).toBe('1');
      // the next session start retries (and an online post then clears the flag)
      const later = vi.fn().mockResolvedValue({ ok: true });
      createLocalSession({ mode: 'practice', level: 1, seed: 1, ...rig({ storage: r.storage, post: later }).opts });
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(later).toHaveBeenCalledTimes(1);
      expect(r.storage.getItem(TUTORIAL_PENDING_KEY)).toBe(null);
    }
    await new Promise((res) => setTimeout(res, 10));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('resume: a tutorial that ran out of time and began again', () => {
  it('replays the restart too (journal across the restart), landing on the same state', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'tutorial', seed: 8, ...r.opts });
    for (let i = 0; i < 3650; i++) r.advance(TICK_MS); // nobody plays: the frozen-clock shift runs out once
    expect(s.state.tick).toBeLessThan(200);
    s.pause();
    const snap = loadShift(r.storage);
    expect(snap.driver.restarts).toBe(1);
    const c = createLocalSession({ resume: snap, ...rig().opts });
    expect(c.resumeError).toBe(null);
    expect(json(c)).toBe(json(s));
  });
});
