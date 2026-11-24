import { describe, expect, it, vi } from 'vitest';
import { PROGRESS_LOCAL_KEY, TICK_MS, TUTORIAL_LOCAL_KEY } from '@shared/tiffin-centre/catalog.js';
import * as realEngine from '@shared/tiffin-centre/index.js';
import { chooseAutoAction } from '@shared/tiffin-centre/index.js';
import { MAX_CATCHUP_TICKS, createLocalSession } from './localSession.js';
import { TUTORIAL_PENDING_KEY } from './progress.js';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), m };
}

/** A manual clock and frame scheduler: `advance(ms)` runs the loop in 16 ms frames. */
function rig(extra = {}) {
  const r = { t: 1000, cb: null, handle: 0, cancelled: 0 };
  r.frames = {
    request: (fn) => {
      r.cb = fn;
      return ++r.handle;
    },
    cancel: () => {
      r.cb = null;
      r.cancelled += 1;
    },
  };
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
  r.storage = fakeStorage();
  r.post = vi.fn().mockResolvedValue({ ok: true });
  r.opts = { now: r.now, frames: r.frames, storage: r.storage, post: r.post, document: null, ...extra };
  return r;
}

describe('createLocalSession (practice)', () => {
  it('implements the session interface and starts playing', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 1, pace: 'normal', playerName: 'Asha', seed: 4, ...r.opts });
    expect(s.mode).toBe('practice');
    expect(s.meId).toBe('me');
    expect(s.players).toEqual([{ id: 'me', name: 'Asha', avatar: null, online: true }]);
    expect(s.status).toBe('playing');
    expect(s.connection).toBe('open');
    expect(s.state.level).toBe(1);
    expect(s.state.tick).toBe(0);
    expect(s.tutorial).toBe(null);
    expect(s.result).toBe(null);
    expect(s.lastError).toBe(null);
  });

  it('applies one tick per TICK_MS of real time, notifies once per frame batch, and keeps tickAt on the tick boundary', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    const seen = [];
    s.subscribe((p) => seen.push(p));
    r.advance(TICK_MS - 50);
    expect(s.state.tick).toBe(0);
    expect(seen.length).toBe(0);
    r.advance(100);
    expect(s.state.tick).toBe(1);
    expect(seen.length).toBe(1);
    expect(seen[0].events.some((e) => e.type === 'tick')).toBe(true);
    // tickAt is when tick 1 began: no later than now, less than a frame behind the boundary
    expect(r.t - s.tickAt).toBeLessThan(TICK_MS);
    expect(s.tickAt).toBeGreaterThanOrEqual(1000 + TICK_MS - 1);
    r.advance(TICK_MS * 3);
    expect(s.state.tick).toBe(4);
  });

  it('caps catch-up after a long stall instead of bursting through the shift', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    r.frame(60_000); // a minute with no frame (throttled tab)
    expect(s.state.tick).toBe(MAX_CATCHUP_TICKS);
    r.frame(16);
    expect(s.state.tick).toBe(MAX_CATCHUP_TICKS);
  });

  it('pause stops the clock and actions; resume continues without a jump', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    r.advance(2500);
    const t = s.state.tick;
    expect(s.pause()).toBe(true);
    expect(s.status).toBe('paused');
    expect(s.dispatch({ type: 'move', to: 'tawa1' })).toBe(false);
    expect(s.lastError).toMatch(/paused/i);
    r.t += 60_000;
    r.frame(0);
    expect(s.state.tick).toBe(t);
    expect(s.resume()).toBe(true);
    expect(s.status).toBe('playing');
    r.advance(100);
    expect(s.state.tick).toBe(t); // the 500 ms already banked plus 100 ms is still short of a tick
    r.advance(500);
    expect(s.state.tick).toBe(t + 1);
  });

  it('pauses itself when the page is hidden', () => {
    const listeners = {};
    const doc = { hidden: false, addEventListener: (n, f) => (listeners[n] = f), removeEventListener: vi.fn() };
    const r = rig({ document: doc });
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    expect(typeof listeners.visibilitychange).toBe('function');
    doc.hidden = true;
    listeners.visibilitychange();
    expect(s.status).toBe('paused');
    expect(s.autoPaused).toBe(true);
    s.resume();
    expect(s.autoPaused).toBe(false);
    s.dispose();
    expect(doc.removeEventListener).toHaveBeenCalled();
  });

  it('dispatch adds the player, applies actions like any other (move included) and reports refusals', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    const seen = [];
    s.subscribe((p) => seen.push(p));
    expect(s.dispatch({ type: 'move', to: 'tawa1' })).toBe(true);
    expect(s.state.players.me.at).toBe('tawa1');
    expect(s.dispatch({ type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' })).toBe(true);
    expect(seen.at(-1).events[0].type).toBe('cook-start');
    expect(s.dispatch({ type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' })).toBe(false);
    expect(s.lastError).toMatch(/busy/i);
    expect(seen.at(-1).error).toMatch(/busy/i);
    expect(s.dispatch({ type: 'cook', station: 'steamer1', slot: 0, dish: 'idly' })).toBe(false);
    expect(s.dispatch({ type: 'tick' })).toBe(false); // players never drive the clock
    expect(s.dispatch({ type: 'spawn', customer: {} })).toBe(false);
    expect(s.dispatch(null)).toBe(false);
  });

  it('plays a whole shift with the bot, ends done, saves the stars and stops the loop', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 4, ...r.opts });
    let guard = 0;
    while (s.status === 'playing' && guard++ < 2000) {
      const a = chooseAutoAction(s.state, 'me');
      if (a) s.dispatch(a);
      r.advance(TICK_MS);
    }
    expect(['done', 'closed']).toContain(s.status);
    expect(s.result).not.toBe(null);
    expect(s.result.level).toBe(1);
    expect(r.cb).toBe(null); // no more frames scheduled
    const saved = JSON.parse(r.storage.getItem(PROGRESS_LOCAL_KEY));
    expect(saved.best[1].earned).toBe(s.result.money);
    expect(s.dispatch({ type: 'move', to: null })).toBe(false);
  });

  it('restart gives a fresh shift (new seed unless one was fixed) and the loop runs again', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'practice', level: 2, ...r.opts });
    const seed1 = s.state.seed;
    r.advance(3000);
    expect(s.state.tick).toBe(3);
    s.restart();
    expect(s.state.tick).toBe(0);
    expect(s.status).toBe('playing');
    expect(s.state.seed).not.toBe(seed1);
    r.advance(1100);
    expect(s.state.tick).toBe(1);

    const fixed = createLocalSession({ mode: 'practice', level: 2, seed: 99, ...rig().opts });
    fixed.restart();
    expect(fixed.state.seed).toBe(99);
  });

  it('quit stops everything', () => {
    const r = rig();
    const onQuit = vi.fn();
    const s = createLocalSession({ mode: 'practice', level: 1, seed: 1, onQuit, ...r.opts });
    s.quit();
    expect(onQuit).toHaveBeenCalled();
    expect(r.cb).toBe(null);
    r.frame(5000);
    expect(s.state.tick).toBe(0);
  });

  it('works with the real setTimeout loop under fake timers (no requestAnimationFrame in node)', () => {
    vi.useFakeTimers();
    try {
      const s = createLocalSession({ mode: 'practice', level: 1, seed: 2, now: () => Date.now(), storage: fakeStorage(), post: vi.fn().mockResolvedValue({}), document: null });
      vi.advanceTimersByTime(3200);
      expect(s.state.tick).toBe(3);
      s.quit();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createLocalSession (tutorial)', () => {
  function run(r, s, { onAction } = {}) {
    let guard = 0;
    while (!s.tutorial.finished && s.status === 'playing' && guard++ < 1500) {
      const t = s.tutorial;
      if (t.ackable) t.ack();
      else if (t.step.id === 'walk') s.dispatch({ type: 'move', to: 'tawa1' });
      else {
        const a = onAction ? onAction(s) : chooseAutoAction(s.state, 'me');
        if (a) s.dispatch(a);
      }
      r.advance(TICK_MS);
    }
  }

  it('runs the tutorial on level 0 with a driver, marks it done locally and tells the server', async () => {
    const r = rig();
    const onTutorialComplete = vi.fn();
    const s = createLocalSession({ mode: 'tutorial', playerName: 'Asha', seed: 8, onTutorialComplete, ...r.opts });
    expect(s.state.level).toBe(0);
    expect(s.tutorial.steps.length).toBeGreaterThan(10);
    expect(s.tutorial.step.id).toBe('welcome');
    expect(s.tutorial.done).toBe(false);
    expect(r.storage.getItem(TUTORIAL_LOCAL_KEY)).toBe(null);
    run(r, s);
    expect(s.tutorial.done).toBe(true);
    expect(s.tutorial.finished).toBe(true);
    expect(onTutorialComplete).toHaveBeenCalledTimes(1);
    expect(r.storage.getItem(TUTORIAL_LOCAL_KEY)).toBe('1');
    await Promise.resolve();
    await Promise.resolve();
    expect(r.post).toHaveBeenCalledWith('/api/games/tiffin-centre/tutorial/complete');
    expect(r.storage.getItem(TUTORIAL_PENDING_KEY)).toBe(null);
  });

  it('keeps the pending flag when the server cannot be told, and retries on the next session start', async () => {
    const r = rig();
    r.post.mockRejectedValue(new Error('Offline'));
    const s = createLocalSession({ mode: 'tutorial', seed: 8, ...r.opts });
    run(r, s);
    await new Promise((res) => setTimeout(res, 0));
    expect(s.tutorial.done).toBe(true);
    expect(r.storage.getItem(TUTORIAL_LOCAL_KEY)).toBe('1');
    expect(r.storage.getItem(TUTORIAL_PENDING_KEY)).toBe('1');

    r.post.mockResolvedValue({ ok: true });
    createLocalSession({ mode: 'practice', level: 1, seed: 1, ...r.opts });
    await new Promise((res) => setTimeout(res, 0));
    expect(r.post).toHaveBeenCalledTimes(2);
    expect(r.storage.getItem(TUTORIAL_PENDING_KEY)).toBe(null);
  });

  it('a player who does nothing never completes it', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'tutorial', seed: 8, ...r.opts });
    r.advance(TICK_MS * 120);
    expect(s.tutorial.done).toBe(false);
    expect(s.tutorial.step.id).toBe('welcome');
    expect(s.tutorial.hint).toMatch(/Got it/);
    expect(r.storage.getItem(TUTORIAL_LOCAL_KEY)).toBe(null);
    expect(r.post).not.toHaveBeenCalled();
  });

  it('a tutorial shift that keeps ending before the lessons are done is an error: never "tutorial complete", never the server flag', () => {
    const r = rig();
    const real = realEngine;
    // an engine whose tutorial shift is over after the first tick
    const engine = {
      ...real,
      applyAction: (st, a) => (a.type === 'tick' ? { state: { ...st, status: 'done', tick: st.tick + 1 }, events: [] } : real.applyAction(st, a)),
    };
    const s = createLocalSession({ mode: 'tutorial', seed: 8, engine, ...r.opts });
    r.advance(TICK_MS * 30);
    expect(s.status).toBe('error');
    expect(s.result).toBeNull();
    expect(s.tutorial.done).toBe(false);
    expect(s.lastError).toMatch(/could not be finished/);
    expect(r.storage.getItem(TUTORIAL_LOCAL_KEY)).toBe(null);
    expect(r.post).not.toHaveBeenCalled();
  });

  it('skip leaves the tutorial unfinished: no flag, no server call, the game stops', () => {
    const r = rig();
    const onTutorialSkip = vi.fn();
    const s = createLocalSession({ mode: 'tutorial', seed: 8, onTutorialSkip, ...r.opts });
    s.tutorial.ack();
    s.tutorial.skip();
    expect(s.tutorial.skipped).toBe(true);
    expect(s.tutorial.done).toBe(false);
    expect(onTutorialSkip).toHaveBeenCalled();
    expect(s.status).toBe('paused');
    expect(r.storage.getItem(TUTORIAL_LOCAL_KEY)).toBe(null);
    expect(r.post).not.toHaveBeenCalled();
  });

  it('exposes the live coach-mark data the HUD needs', () => {
    const r = rig();
    const s = createLocalSession({ mode: 'tutorial', seed: 8, ...r.opts });
    expect(s.tutorial.say).toMatch(/Namaste/);
    expect(typeof s.tutorial.text).toBe('string');
    expect(s.tutorial.ackable).toBe(true);
    expect(s.tutorial.progress.total).toBe(s.tutorial.steps.length);
    s.tutorial.ack();
    expect(s.tutorial.step.id).toBe('tour');
  });
});
