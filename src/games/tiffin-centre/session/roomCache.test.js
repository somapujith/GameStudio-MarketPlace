import { describe, expect, it, vi } from 'vitest';
import { createGame } from '@shared/tiffin-centre/index.js';
import * as engine from '@shared/tiffin-centre/index.js';
import { createRoomCache } from './autosave.js';
import { createRoomSessionCore } from './roomCore.js';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), m };
}
const stateFor = (tick = 5, ids = ['u1', 'u2']) => {
  const s = createGame({ players: ids.map((id) => ({ id, name: id })), settings: { level: 1, pace: 'normal' }, seed: 5 });
  return { ...s, tick };
};
function setup({ code = 'ABCD', meId = 'u1', storage = fakeStorage(), t = { v: 1000 }, cacheEveryMs } = {}) {
  const cache = createRoomCache(code, { storage, now: () => t.v });
  const send = vi.fn(() => true);
  const core = createRoomSessionCore({ meId, send, leave: vi.fn(), engine, now: () => t.v, cache, cacheEveryMs, setTimer: () => 0, clearTimer: () => {} });
  return { core, cache, storage, t, send };
}

describe('room session: the last good state survives a page refresh', () => {
  it('writes the state as it arrives (throttled) and never a finished one', () => {
    const { core, cache, t } = setup({ cacheEveryMs: 2000 });
    core.handleState({ state: stateFor(1), events: [], seq: 1, fresh: true });
    expect(cache.load().state.tick).toBe(1);
    t.v += 500;
    core.handleState({ state: stateFor(2), events: [], seq: 2 });
    expect(cache.load().state.tick).toBe(1); // throttled
    t.v += 2000;
    core.handleState({ state: stateFor(3), events: [], seq: 3 });
    expect(cache.load().state.tick).toBe(3);
    core.handleState({ state: { ...stateFor(4), status: 'done' }, events: [], seq: 4 });
    expect(cache.load()).toBe(null);
  });

  it('a new page load shows the stall at once, marked stale, and refuses to dispatch', () => {
    const a = setup();
    a.core.handleState({ state: stateFor(7), events: [], seq: 1, fresh: true });
    a.t.v += 5000;
    const b = setup({ storage: a.storage, t: a.t });
    const { session } = b.core;
    expect(session.state.tick).toBe(7);
    expect(session.stale).toBe(true);
    expect(session.status).toBe('disconnected');
    expect(session.tickAt).toBe(a.t.v);
    expect(session.dispatch({ type: 'move', to: 'tawa1' })).toBe(false);
    expect(b.send).not.toHaveBeenCalled();
    expect(session.lastError).toMatch(/Reconnecting/);
    b.core.setConnection('open');
    expect(session.status).toBe('disconnected'); // an open socket alone is not a fresh state
    expect(session.dispatch({ type: 'move', to: 'tawa1' })).toBe(false);
  });

  it('the first state from the server clears stale and the table plays', () => {
    const a = setup();
    a.core.handleState({ state: stateFor(7), events: [], seq: 1, fresh: true });
    const b = setup({ storage: a.storage, t: a.t });
    const seen = [];
    b.core.session.subscribe((p) => seen.push(p));
    b.core.setConnection('open');
    b.core.handleState({ state: stateFor(9), events: [{ type: 'x' }], seq: 20, fresh: true });
    expect(b.core.session.stale).toBe(false);
    expect(b.core.session.state.tick).toBe(9);
    expect(b.core.session.status).toBe('playing');
    expect(seen.at(-1).events).toEqual([]); // the jump from the cached picture is not replayed as events
    expect(b.core.session.dispatch({ type: 'move', to: 'tawa1' })).toBe(true);
  });

  it('a non-fresh first message also clears stale', () => {
    const a = setup();
    a.core.handleState({ state: stateFor(7), events: [], seq: 1, fresh: true });
    const b = setup({ storage: a.storage, t: a.t });
    b.core.setConnection('open');
    b.core.handleState({ state: stateFor(8), events: [], seq: 1 });
    expect(b.core.session.stale).toBe(false);
    expect(b.core.session.tickAt).toBe(a.t.v);
  });

  it('is cleared on leave, on a fatal that ends the visit, and when the room goes back to its lobby', () => {
    for (const act of [
      (c) => c.session.quit(),
      (c) => c.setFatal({ kind: 'kicked', message: 'x' }),
      (c) => c.setFatal({ kind: 'closed', message: 'x' }),
      (c) => c.setRoom({ status: 'lobby', players: [] }),
      (c) => c.setRoom({ status: 'finished', players: [] }),
    ]) {
      const a = setup();
      a.core.handleState({ state: stateFor(3), events: [], seq: 1, fresh: true });
      expect(a.cache.load()).not.toBe(null);
      act(a.core);
      expect(a.cache.load()).toBe(null);
    }
    const b = setup();
    b.core.handleState({ state: stateFor(3), events: [], seq: 1, fresh: true });
    b.core.setFatal({ kind: 'network', message: 'x' }); // a dropped link may come back: keep the picture
    expect(b.cache.load()).not.toBe(null);
  });

  it("another player's cached table is dropped (at once, or when the account becomes known)", () => {
    const a = setup({ meId: 'u1' });
    a.core.handleState({ state: stateFor(3), events: [], seq: 1, fresh: true });
    const other = setup({ meId: 'u3', storage: a.storage, t: a.t });
    expect(other.core.session.state).toBe(null);
    expect(other.cache.load()).toBe(null);

    const a2 = setup({ meId: 'u1' });
    a2.core.handleState({ state: stateFor(3), events: [], seq: 1, fresh: true });
    const ok = setup({ meId: '', storage: a2.storage, t: a2.t });
    const late = setup({ meId: '', storage: a2.storage, t: a2.t });
    expect(late.core.session.stale).toBe(true);
    late.core.setMe('u9');
    expect(late.core.session.state).toBe(null);
    expect(late.core.session.stale).toBe(false);
    expect(late.core.session.status).toBe('loading');
    ok.core.setMe('u1');
    expect(ok.core.session.stale).toBe(true); // the right account keeps it
  });

  it('too old, wrong room, corrupt or unavailable cache: just no cache, never an error', () => {
    const a = setup();
    a.core.handleState({ state: stateFor(3), events: [], seq: 1, fresh: true });
    const old = setup({ storage: a.storage, t: { v: a.t.v + 11 * 60 * 1000 } });
    expect(old.core.session.state).toBe(null);
    const wrong = setup({ code: 'ZZZZ', storage: a.storage, t: a.t });
    expect(wrong.core.session.state).toBe(null);
    const bad = fakeStorage();
    bad.setItem(createRoomCache('ABCD', { storage: bad }).key, '{broken');
    expect(setup({ storage: bad }).core.session.state).toBe(null);
    const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    const dead = setup({ storage: boom });
    dead.core.setConnection('open');
    expect(() => dead.core.handleState({ state: stateFor(3), events: [], seq: 1, fresh: true })).not.toThrow();
    expect(dead.core.session.status).toBe('playing');
    expect(() => dead.core.session.quit()).not.toThrow();
  });

  it('a cache that throws is only a missing cache', () => {
    const cache = { load: () => { throw new Error('a'); }, save: () => { throw new Error('b'); }, clear: () => { throw new Error('c'); } };
    const core = createRoomSessionCore({ meId: 'u1', send: () => true, leave: () => {}, cache, setTimer: () => 0, clearTimer: () => {} });
    expect(core.session.state).toBe(null);
    expect(() => core.handleState({ state: stateFor(3), events: [], seq: 1, fresh: true })).not.toThrow();
    expect(() => core.setFatal({ kind: 'left' })).not.toThrow();
    expect(() => core.session.quit()).not.toThrow();
  });

  it('without a cache nothing changes', () => {
    const core = createRoomSessionCore({ meId: 'u1', send: () => true, leave: () => {}, setTimer: () => 0, clearTimer: () => {} });
    expect(core.session.stale).toBe(false);
    core.handleState({ state: stateFor(3), events: [], seq: 1, fresh: true });
    expect(core.session.stale).toBe(false);
  });
});
