import { describe, expect, it, vi } from 'vitest';
import { applyAction, createGame } from '@shared/tiffin-centre/index.js';
import { createActionLimiter, createRoomSessionCore, playersOf, roomStatus, sessionConnection } from './roomCore.js';

const ME = '42';
const newState = () => createGame({ players: [{ id: ME, name: 'Asha' }, { id: '7', name: 'Ravi' }], settings: { level: 1, pace: 'normal' }, seed: 3 });
const tick = (s) => applyAction(s, { type: 'tick' });

function setup(extra = {}) {
  const sent = [];
  const clock = { t: 0 };
  const timers = [];
  const core = createRoomSessionCore({
    meId: ME,
    send: (msg, opts) => (sent.push({ msg, opts }), true),
    leave: vi.fn(),
    now: () => clock.t,
    setTimer: (fn, ms) => timers.push({ fn, at: clock.t + ms }) && timers.length,
    clearTimer: (h) => {
      if (timers[h - 1]) timers[h - 1].dead = true;
    },
    ...extra,
  });
  const runTimers = (ms) => {
    clock.t += ms;
    for (const t of timers.splice(0)) if (!t.dead && t.at <= clock.t) t.fn();
  };
  return { core, sent, clock, timers, runTimers };
}

const room = (status = 'playing', players = [{ id: ME, name: 'Asha', avatar: 'a1', connected: true }, { id: '7', name: 'Ravi', connected: false }]) => ({ code: 'ABC234', status, players });

describe('roomStatus / helpers', () => {
  const st = newState();
  it('maps the link and the room to a session status', () => {
    expect(roomStatus({ fatal: null, connection: 'connecting', room: null, state: null })).toBe('loading');
    expect(roomStatus({ fatal: null, connection: 'open', room: room('lobby'), state: null })).toBe('loading');
    expect(roomStatus({ fatal: null, connection: 'open', room: room(), state: st })).toBe('playing');
    expect(roomStatus({ fatal: null, connection: 'connecting', room: room(), state: st })).toBe('disconnected');
    expect(roomStatus({ fatal: { kind: 'kicked' }, connection: 'closed', room: room(), state: st })).toBe('disconnected');
    expect(roomStatus({ fatal: { kind: 'join' }, connection: 'closed', room: null, state: null })).toBe('error');
    expect(roomStatus({ fatal: { kind: 'left' }, connection: 'closed', room: room(), state: st })).toBe('closed');
    expect(roomStatus({ fatal: { kind: 'closed' }, connection: 'closed', room: room('finished'), state: { ...st, status: 'done' } })).toBe('done');
    expect(roomStatus({ fatal: null, connection: 'open', room: room('lobby'), state: { ...st, status: 'done' } })).toBe('loading');
    expect(roomStatus({ fatal: null, connection: 'open', room: room(), state: { ...st, status: 'closed' } })).toBe('closed');
  });
  it('maps the connection and the players', () => {
    expect(sessionConnection('open')).toBe('open');
    expect(sessionConnection('connecting')).toBe('reconnecting');
    expect(sessionConnection('closed')).toBe('closed');
    expect(playersOf(room(), null)).toEqual([
      { id: ME, name: 'Asha', avatar: 'a1', online: true, piece: undefined, cosmetics: undefined },
      { id: '7', name: 'Ravi', avatar: null, online: false, piece: undefined, cosmetics: undefined },
    ]);
    expect(playersOf(null, st).map((p) => p.name)).toEqual(['Asha', 'Ravi']);
    expect(playersOf(null, null)).toEqual([]);
  });
});

describe('createRoomSessionCore', () => {
  it('is loading until a state arrives, then playing once the link is open', () => {
    const { core } = setup();
    const s = core.session;
    expect(s.mode).toBe('online');
    expect(s.meId).toBe(ME);
    expect(s.status).toBe('loading');
    expect(s.state).toBe(null);
    expect(s.tutorial).toBe(null);
    core.setConnection('open');
    core.setRoom(room());
    core.handleState({ state: newState(), events: [], seq: 1, fresh: true });
    expect(s.status).toBe('playing');
    expect(s.connection).toBe('open');
    expect(s.players.map((p) => p.name)).toEqual(['Asha', 'Ravi']);
    expect(s.room.code).toBe('ABC234');
  });

  it('flags the lobby so the screen can navigate there', () => {
    const { core } = setup();
    core.setConnection('open');
    core.setRoom(room('lobby'));
    expect(core.session.lobby).toBe(true);
    expect(core.session.status).toBe('loading');
    core.setRoom(room('playing'));
    expect(core.session.lobby).toBe(false);
  });

  it('tickAt moves on a new tick or a snapshot, not on an action echo; fresh snapshots carry no events', () => {
    const t = { v: 100 };
    const { core } = setup({ now: () => t.v });
    core.setConnection('open');
    core.setRoom(room());
    const seen = [];
    core.session.subscribe((p) => seen.push(p));
    const s0 = newState();
    core.handleState({ state: s0, events: [{ type: 'x' }], seq: 1, fresh: true });
    expect(core.session.tickAt).toBe(100);
    expect(seen.at(-1).events).toEqual([]);
    const s1 = tick(s0);
    t.v = 1100;
    core.handleState({ state: s1.state, events: s1.events, seq: 2, fresh: false });
    expect(core.session.tickAt).toBe(1100);
    expect(seen.at(-1).events).toEqual(s1.events);
    const moved = applyAction(s1.state, { type: 'move', playerId: ME, to: 'tawa1' });
    t.v = 1500;
    core.handleState({ state: moved.state, events: moved.events, seq: 3, fresh: false });
    expect(core.session.tickAt).toBe(1100); // same tick: the bars keep their phase
    expect(core.session.state).toBe(moved.state);
  });

  it('drops duplicate and out-of-order states, but takes a fresh snapshot after a reconnect', () => {
    const { core } = setup();
    core.setConnection('open');
    const a = newState();
    const b = tick(a).state;
    core.handleState({ state: b, events: [], seq: 5, fresh: true });
    core.handleState({ state: a, events: [], seq: 4, fresh: false });
    expect(core.session.state).toBe(b);
    core.handleState({ state: a, events: [], seq: 2, fresh: true });
    expect(core.session.state).toBe(a);
  });

  it('exposes the result when the shift is over', () => {
    const { core } = setup();
    core.setConnection('open');
    core.setRoom(room('finished'));
    core.handleState({ state: { ...newState(), status: 'done', stars: 2, money: 500 }, events: [], seq: 9, fresh: false });
    expect(core.session.status).toBe('done');
    expect(core.session.result.stars).toBe(2);
    expect(core.session.result.money).toBe(500);
  });

  it('dispatch sends {t:action} with queue:false and the player id; the server forces it anyway', () => {
    const { core, sent } = setup();
    core.setConnection('open');
    core.setRoom(room());
    core.handleState({ state: newState(), events: [], seq: 1, fresh: true });
    expect(core.session.dispatch({ type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' })).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].msg).toEqual({ t: 'action', action: { type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa', playerId: ME } });
    expect(sent[0].opts).toEqual({ queue: false });
  });

  it('refuses locally what the engine would refuse (nothing is sent) and anything a client may never send', () => {
    const { core, sent } = setup();
    core.setConnection('open');
    core.setRoom(room());
    core.handleState({ state: newState(), events: [], seq: 1, fresh: true });
    const seen = [];
    core.session.subscribe((p) => seen.push(p));
    expect(core.session.dispatch({ type: 'take', station: 'tawa1', slot: 0 })).toBe(false);
    expect(core.session.lastError).toMatch(/nothing/i);
    expect(seen.at(-1).error).toMatch(/nothing/i);
    expect(core.session.dispatch({ type: 'tick' })).toBe(false);
    expect(core.session.dispatch({ type: 'spawn', customer: {} })).toBe(false);
    expect(core.session.dispatch({ type: 'tutorial-flags', patience: true })).toBe(false);
    expect(core.session.dispatch(undefined)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('does not send while disconnected', () => {
    const { core, sent } = setup();
    core.setConnection('open');
    core.setRoom(room());
    core.handleState({ state: newState(), events: [], seq: 1, fresh: true });
    core.setConnection('connecting');
    expect(core.session.status).toBe('disconnected');
    expect(core.session.connection).toBe('reconnecting');
    expect(core.session.dispatch({ type: 'move', to: 'tawa1' })).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('server errors become lastError and a notification; fatal states are kept', () => {
    const { core } = setup();
    const seen = [];
    core.session.subscribe((p) => seen.push(p));
    core.setError('Not ready yet');
    expect(core.session.lastError).toBe('Not ready yet');
    expect(seen.at(-1).error).toBe('Not ready yet');
    core.setFatal({ kind: 'kicked', message: 'The host removed you from this room.' });
    expect(core.session.fatal.kind).toBe('kicked');
    expect(core.session.status).toBe('disconnected');
  });

  it('pause / resume / restart are not available online; quit leaves the room', () => {
    const leave = vi.fn();
    const { core } = setup({ leave });
    expect(core.session.pause()).toBe(false);
    expect(core.session.resume()).toBe(false);
    expect(core.session.restart()).toBe(false);
    core.session.quit();
    expect(leave).toHaveBeenCalledTimes(1);
  });
});

describe('createActionLimiter', () => {
  function limiterRig(opts = {}) {
    const sent = [];
    const clock = { t: 0 };
    const timers = [];
    const lim = createActionLimiter({
      send: (a) => (sent.push({ a, t: clock.t }), true),
      now: () => clock.t,
      setTimer: (fn, ms) => timers.push({ fn, at: clock.t + ms }),
      clearTimer: (h) => void h,
      ...opts,
    });
    const run = (ms) => {
      clock.t += ms;
      for (const t of timers.splice(0)) t.fn();
    };
    return { lim, sent, clock, run, timers };
  }

  it('sends real actions at once and coalesces a burst of moves into the newest', () => {
    const { lim, sent, run } = limiterRig();
    expect(lim.push({ type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' })).toBe(true);
    expect(sent).toHaveLength(1);
    lim.push({ type: 'move', to: 'tawa1' });
    expect(sent).toHaveLength(2); // the first move goes straight out
    for (const to of ['steamer1', 'kadai1', 'tawa2', 'chai1']) lim.push({ type: 'move', to });
    expect(sent).toHaveLength(2); // spaced out: only the newest is kept
    expect(lim.pendingCount()).toBe(1);
    run(200);
    expect(sent).toHaveLength(3);
    expect(sent[2].a.to).toBe('chai1');
    expect(lim.pendingCount()).toBe(0);
  });

  it('does not repeat a move to where we already are', () => {
    const { lim, sent, run } = limiterRig();
    lim.push({ type: 'move', to: 'tawa1' });
    run(300);
    lim.push({ type: 'move', to: 'tawa1' });
    run(300);
    expect(sent).toHaveLength(1);
  });

  it('keeps a long stream of moves and emotes under ~25 messages per 5 seconds', () => {
    const { lim, sent, clock, run } = limiterRig();
    const stops = ['tawa1', 'steamer1', 'kadai1', 'tawa2', 'chai1', 'bin', 'spot:0', 'spot:3'];
    for (let i = 0; i < 400; i++) {
      lim.push({ type: 'move', to: stops[i % stops.length] });
      if (i % 5 === 0) lim.push({ type: 'emote', e: 'fire' });
      run(25);
    }
    const windowMax = (list) => {
      let best = 0;
      for (const x of list) best = Math.max(best, list.filter((y) => y.t >= x.t && y.t < x.t + 5000).length);
      return best;
    };
    expect(clock.t).toBe(10_000);
    expect(windowMax(sent)).toBeLessThanOrEqual(25);
    expect(sent.some((m) => m.a.type === 'emote')).toBe(true);
  });

  it('refuses real actions only when almost at the server limit', () => {
    const { lim, sent } = limiterRig({ hardMax: 5 });
    for (let i = 0; i < 5; i++) expect(lim.push({ type: 'discard', hand: 0 })).toBe(true);
    expect(lim.push({ type: 'discard', hand: 0 })).toBe(false);
    expect(sent).toHaveLength(5);
  });

  it('a send the socket rejects is reported', () => {
    const lim = createActionLimiter({ send: () => false, now: () => 0 });
    expect(lim.push({ type: 'serve', customer: 1, hand: 0 })).toBe(false);
  });
});
