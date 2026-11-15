// The server side of the Snatch window (docs/GAME_RULES.md section 9): the action allow-list, the room-owned close timer
// (adapter.deadlines + GameRoom.plan), "nobody is auto-played in the window", sealed presses (redaction and the
// "a press is not broadcast" rule) and a reconnect in the middle of a window. Real engine, in-process fake Durable Object.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
vi.mock('./match.js', async (importOriginal) => ({ ...(await importOriginal()), persistMatch: vi.fn(async () => ({ inserted: true })) }));

const { GameRoom } = await import('./GameRoom.js');
const adapterModule = await import('./games/hyderabad-tycoon.js');
const adapter = adapterModule.default;
const { pendingActors, estimateAnimMs, SNATCH_GRACE_MS } = adapterModule;
const { sanitizeAction } = await import('./validate.js');
const { maskStateFor, hasSealedBids } = await import('./mask.js');
const engine = await import('../shared/index.js');
const { ANIM_MS } = await import('../shared/timing.js');

// ---- the pure adapter ----------------------------------------------------------------------------

const P = (n) => ({ id: `p${n}`, name: `Player ${n}`, avatar: n });

/** A 3-player game where the turn player just bought Sultan Bazaar (60,000) and the Snatch window is open. */
function snatchWindow(settings = {}) {
  let s = adapter.createGame({ players: [P(0), P(1), P(2)], settings, seed: 11 });
  s = { ...s, cfg: { ...s.cfg, debug: true } };
  const me = s.players[s.turn].id;
  let r = adapter.applyAction(s, { type: 'ROLL', playerId: me, dice: [1] });
  expect(r.error).toBeUndefined();
  expect(r.state.phase).toBe('buy');
  r = adapter.applyAction(r.state, { type: 'BUY', playerId: me });
  expect(r.error).toBeUndefined();
  return { state: r.state, events: r.events, buyer: me };
}

describe('snatch: action allow-list', () => {
  it('lets a client send SNATCH but never SNATCH_CLOSE', () => {
    expect(sanitizeAction({ type: 'SNATCH' }, 'p1')).toEqual({ type: 'SNATCH', playerId: 'p1' });
    expect(sanitizeAction({ type: 'SNATCH', playerId: 'someone-else' }, 'p1')).toEqual({ type: 'SNATCH', playerId: 'p1' });
    expect(sanitizeAction({ type: 'SNATCH_CLOSE' }, 'p1')).toBeNull();
    expect(adapter.sanitizeAction({ type: 'SNATCH_CLOSE' }, 'p1')).toBeNull();
  });
});

describe('snatch: adapter timer and auto-play', () => {
  it('opens a window after a purchase when somebody holds a button', () => {
    const { state, events, buyer } = snatchWindow();
    expect(state.phase).toBe('snatch');
    expect(state.pending).toMatchObject({ type: 'snatch', buyer, tile: 1, price: 60000, ms: 5000, returnPhase: 'manage' });
    expect(state.pending.eligible.sort()).toEqual(['p0', 'p1', 'p2'].filter((id) => id !== buyer));
    expect(events.find((e) => e.type === 'snatch_open')).toMatchObject({ tile: 1, buyer, ms: 5000 });
  });

  it('exposes exactly one close deadline, keyed by turn and tile, anchored at the apply, owned by no player action', () => {
    const { state, buyer } = snatchWindow();
    const list = adapter.deadlines(state);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ afterMs: 5000 + SNATCH_GRACE_MS, playerId: buyer, action: { type: 'SNATCH_CLOSE' }, anchor: 'apply' });
    expect(SNATCH_GRACE_MS).toBe(400);
    expect(list[0].key).toMatch(/^snatch:\d+:1$/);
    expect(list[0].action.playerId).toBeUndefined();
    // the timer follows the configured window
    expect(adapter.deadlines(snatchWindow({ snatchMs: 8000 }).state)[0].afterMs).toBe(8000 + SNATCH_GRACE_MS);
    // no window, no snatch timer
    expect(adapter.deadlines(snatchWindow({ snatches: 0 }).state)).toEqual([]);
  });

  it('SNATCH_CLOSE from the timer resolves the window; applying it twice is rejected', () => {
    const { state, buyer } = snatchWindow();
    const closed = adapter.applyAction(state, adapter.deadlines(state)[0].action);
    expect(closed.error).toBeUndefined();
    expect(closed.state.phase).toBe('manage');
    expect(closed.state.owners[1]).toBe(buyer); // nobody pressed: the buyer keeps it
    expect(closed.events.find((e) => e.type === 'snatch_end')).toMatchObject({ outcome: 'none' });
    expect(adapter.deadlines(closed.state)).toEqual([]);
    expect(adapter.applyAction(closed.state, { type: 'SNATCH_CLOSE' }).error).toBe('There is nothing to snatch');
  });

  it('never auto-plays anybody during the window; the buyer is the "turn player"', () => {
    const { state, buyer } = snatchWindow();
    for (const p of state.players) expect(adapter.idleAction(state, p.id)).toBeNull();
    expect(adapter.turnPlayerId(state)).toBe(buyer);
  });

  it('waits for the eligible players who have not pressed yet', () => {
    const { state, buyer } = snatchWindow();
    const others = state.players.map((p) => p.id).filter((id) => id !== buyer);
    expect(pendingActors(state).sort()).toEqual(others.sort());
    expect(adapter.pendingPlayerIds(state).sort()).toEqual(others.sort());
    const pressed = adapter.applyAction(state, { type: 'SNATCH', playerId: others[0] });
    expect(pressed.error).toBeUndefined();
    expect(pendingActors(pressed.state)).toEqual([others[1]]);
  });

  it('never auto-plays the sealed bidding that follows two presses either: the auction timer passes the non-bidders at the end', () => {
    const { state, buyer } = snatchWindow();
    const [a, b] = state.players.map((p) => p.id).filter((id) => id !== buyer);
    let s = adapter.applyAction(state, { type: 'SNATCH', playerId: a }).state;
    s = adapter.applyAction(s, { type: 'SNATCH', playerId: b }).state;
    expect(s.phase).toBe('auction');
    expect(adapter.idleAction(s, a)).toBeNull();
    expect(adapter.idleAction(s, buyer)).toBeNull(); // the buyer is not bidding
    expect(adapter.deadlines(s)[0]).toMatchObject({ action: { type: 'AUCTION_CLOSE' }, afterMs: 15000 + 400 });
  });

  it('times the window events: a short open, a readable end, no animation for the press', () => {
    const { events } = snatchWindow();
    const open = events.filter((e) => e.type === 'snatch_open');
    expect(estimateAnimMs(open)).toBe(ANIM_MS.snatchOpen);
    expect(ANIM_MS.snatchOpen).toBeLessThanOrEqual(500);
    expect(estimateAnimMs([{ type: 'snatch_end', outcome: 'none' }])).toBe(ANIM_MS.snatchEnd);
    expect(ANIM_MS.snatchEnd).toBeGreaterThanOrEqual(1500);
    expect(estimateAnimMs([{ type: 'own', reason: 'snatch', tile: 1, owner: 'p1' }])).toBe(ANIM_MS.own);
    expect(estimateAnimMs([{ type: 'token_earned', player: 'p1', reason: 'card', snatches: 2 }])).toBe(ANIM_MS.token);
    expect(estimateAnimMs([{ type: 'snatch_token', player: 'p1', snatches: 0 }])).toBe(0); // rides on the snatch_end / own that come with it
  });
});

describe('snatch: sealed presses (redaction)', () => {
  it('shows a viewer only their own press and keeps everything else untouched', () => {
    const { state, buyer } = snatchWindow();
    const [a, b] = state.players.map((p) => p.id).filter((id) => id !== buyer);
    const pressed = adapter.applyAction(state, { type: 'SNATCH', playerId: a }).state;
    expect(pressed.phase).toBe('snatch'); // b has not pressed, so the window is still open
    expect(pressed.pending.claims).toEqual([a]); // the authoritative state keeps it
    expect(adapter.redact(pressed, a).pending.claims).toEqual([a]);
    expect(adapter.redact(pressed, b).pending.claims).toEqual([]);
    expect(adapter.redact(pressed, buyer).pending.claims).toEqual([]);
    expect(adapter.redact(pressed, undefined).pending.claims).toEqual([]);
    expect(pressed.pending.claims).toEqual([a]); // never mutated
    expect(hasSealedBids(pressed)).toBe(true);
    expect(adapter.redact(pressed, b).pending).toMatchObject({ type: 'snatch', tile: 1, buyer, eligible: pressed.pending.eligible, ms: 5000 });
  });

  it('a press emits no event, so nobody learns about it before the close', () => {
    const { state, buyer } = snatchWindow();
    const a = state.players.map((p) => p.id).find((id) => id !== buyer);
    const res = adapter.applyAction(state, { type: 'SNATCH', playerId: a });
    expect(res.events).toEqual([]);
  });

  it('after two presses the claimants are public (the bidding names them); the sealed bids are still masked', () => {
    const { state, buyer } = snatchWindow();
    const [a, b] = state.players.map((p) => p.id).filter((id) => id !== buyer);
    let s = adapter.applyAction(state, { type: 'SNATCH', playerId: a }).state;
    s = adapter.applyAction(s, { type: 'SNATCH', playerId: b }).state;
    expect(s.pending).toMatchObject({ type: 'auction', snatch: true, buyer });
    expect([...s.pending.claimants].sort()).toEqual([a, b].sort());
    s = adapter.applyAction(s, { type: 'BID', playerId: a, amount: 9000 }).state;
    expect(adapter.redact(s, a).pending.bids[a]).toBe(9000);
    expect(adapter.redact(s, b).pending.bids[a]).toBe(0);
    expect(adapter.redact(s, b).pending.claimants).toEqual(s.pending.claimants);
  });

  it('never ships the random-number state or the card deck, and changes nothing else', () => {
    const { state } = snatchWindow({ snatches: 0 });
    for (const viewer of ['p0', 'p1', undefined]) {
      const view = maskStateFor(state, viewer);
      expect(view.rng).toBe(0);
      expect(view.deck).toEqual([]);
      expect({ ...view, rng: state.rng, deck: state.deck }).toEqual(state);
    }
  });
});

// ---- the room (fake Durable Object) ---------------------------------------------------------------

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.sent = [];
    this.att = null;
    this.tags = [];
  }
  send(m) {
    this.sent.push(JSON.parse(m));
  }
  close() {
    this.readyState = 3;
  }
  serializeAttachment(v) {
    this.att = structuredClone(v);
  }
  deserializeAttachment() {
    return this.att;
  }
  of(type) {
    return this.sent.filter((m) => m.t === type);
  }
  last(type) {
    return this.of(type).at(-1);
  }
}

class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket;
  }
  async json() {
    return JSON.parse(this.body);
  }
}

function makeCtx() {
  const store = new Map();
  const sockets = [];
  const ctx = {
    alarmAt: null,
    store,
    sockets,
    storage: {
      get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
      put: async (k, v) => void store.set(k, structuredClone(v)),
      setAlarm: async (t) => void (ctx.alarmAt = t),
      deleteAlarm: async () => void (ctx.alarmAt = null),
      deleteAll: async () => store.clear(),
    },
    blockConcurrencyWhile: async (fn) => fn(),
    setWebSocketAutoResponse() {},
    acceptWebSocket(ws, tags = []) {
      ws.tags = tags;
      sockets.push(ws);
    },
    getWebSockets(tag) {
      return tag ? sockets.filter((s) => s.tags.includes(tag)) : [...sockets];
    },
  };
  return ctx;
}

const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const user = (n) => ({ id: U(n), name: `P${n}`, avatar: n % 12 });
let t0;

class Harness {
  constructor() {
    this.ctx = makeCtx();
    this.room = new GameRoom(this.ctx, {});
  }
  async init(host, settings, maxPlayers) {
    return this.room.fetch({ url: 'https://x/init', method: 'POST', headers: new Headers(), json: async () => ({ code: 'ABCD23', host, settings, maxPlayers }) });
  }
  async connect(u) {
    const headers = new Headers({
      Upgrade: 'websocket',
      'X-User-Id': u.id,
      'X-User-Name': encodeURIComponent(u.name),
      'X-User-Avatar': String(u.avatar),
      'X-User-Guest': '0',
    });
    const before = this.ctx.sockets.length;
    const res = await this.room.fetch({ url: 'https://x/ws', method: 'GET', headers });
    expect(res.status).toBe(101);
    return this.ctx.sockets[before] || this.ctx.sockets.at(-1);
  }
  async say(ws, msg) {
    await this.room.webSocketMessage(ws, JSON.stringify(msg));
  }
  /** Advance the fake clock to the scheduled alarm and run it. */
  async tick() {
    const at = this.ctx.alarmAt;
    if (at == null) return false;
    vi.setSystemTime(Math.max(Date.now(), at));
    await this.room.alarm();
    return true;
  }
  get state() {
    return this.room.room.state;
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocketPair', class {
    constructor() {
      this[0] = new FakeSocket();
      this[1] = new FakeSocket();
    }
  });
  vi.stubGlobal('Response', FakeResponse);
  vi.stubGlobal('WebSocketRequestResponsePair', class {});
  vi.useFakeTimers({ toFake: ['Date'] });
  t0 = new Date('2026-10-16T10:00:00Z').getTime();
  vi.setSystemTime(t0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * A started 3-player room whose state is replaced by a debug game in which the turn player stands on Sultan Bazaar
 * (tile 1), then BUY is applied through the room so the window opens exactly as in play.
 */
async function windowRoom(settings = {}) {
  const h = new Harness();
  await h.init(user(1), settings, 3);
  const sockets = { [U(1)]: await h.connect(user(1)), [U(2)]: await h.connect(user(2)), [U(3)]: await h.connect(user(3)) };
  await h.say(sockets[U(1)], { t: 'start' });
  const players = h.state.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar }));
  let s = engine.createGame({ players, settings: { ...h.state.cfg, debug: true }, seed: 5 });
  s = engine.applyAction(s, { type: 'ROLL', playerId: s.players[s.turn].id, dice: [1] }).state;
  expect(s.phase).toBe('buy');
  const buyer = s.players[s.turn].id;
  h.room.room.state = s;
  h.room.room.lastApplyAt = Date.now();
  h.room.room.animMs = 0;
  for (const ws of Object.values(sockets)) ws.sent.length = 0;
  const res = await h.room.applyAndBroadcast({ type: 'BUY', playerId: buyer });
  expect(res.error).toBeUndefined();
  const others = players.map((p) => p.id).filter((id) => id !== buyer);
  return { h, sockets, buyer, others, openedAt: Date.now() };
}

describe('snatch: the room timer', () => {
  it('broadcasts the window to everyone, with the deadline counted from the moment the state is sent', async () => {
    const { h, sockets, buyer, others, openedAt } = await windowRoom();
    const r = h.room.room;
    expect(h.state.phase).toBe('snatch');
    for (const ws of Object.values(sockets)) {
      const m = ws.last('state');
      expect(m.state.phase).toBe('snatch');
      expect(m.events.map((e) => e.type)).toEqual(['cash', 'own', 'snatch_open']);
      expect(m.clock.deadline).toBe(openedAt + 5000 + SNATCH_GRACE_MS); // not delayed by the animation of the purchase
      expect([...m.clock.waitingFor].sort()).toEqual([...others].sort());
      expect(m.state.pending.remainingMs).toBe(5000);
      expect(m.state.pending.claims).toEqual([]);
      expect(m.state.rng).toBe(0);
    }
    expect(r.animMs).toBeGreaterThan(0); // the purchase still has its animation ...
    expect(Object.values(r.deadlines)).toEqual([openedAt]); // ... but the window's clock started at the apply
    expect(Object.keys(r.deadlines)[0]).toMatch(/^snatch:\d+:1$/);
    expect(buyer).toBeTruthy();
  });

  it('plans one SNATCH_CLOSE and nothing else: nobody is auto-played, however idle or disconnected', async () => {
    const { h, others, openedAt } = await windowRoom();
    const r = h.room.room;
    let plan = h.room.plan();
    expect(plan).toMatchObject({ at: openedAt + 5000 + SNATCH_GRACE_MS, action: { type: 'SNATCH_CLOSE' }, timeout: false });
    for (const id of [...others]) r.afk[id] = true; // flagged idle
    r.disc[others[0]] = openedAt - 600000; // and long disconnected
    plan = h.room.plan();
    expect(plan.action).toEqual({ type: 'SNATCH_CLOSE' });
    expect(plan.at).toBe(openedAt + 5000 + SNATCH_GRACE_MS);
    expect(h.room.clockView()).toMatchObject({ deadline: openedAt + 5000 + SNATCH_GRACE_MS });
  });

  it('fires SNATCH_CLOSE once: the window resolves, everyone is told, the timer is gone', async () => {
    const { h, sockets, buyer, openedAt } = await windowRoom();
    const seq = h.room.room.seq;
    vi.setSystemTime(openedAt + 4000);
    await h.room.alarm();
    expect(h.state.phase).toBe('snatch'); // too early: nothing happens
    for (const ws of Object.values(sockets)) ws.sent.length = 0;
    expect(await h.tick()).toBe(true);
    expect(Date.now()).toBeGreaterThanOrEqual(openedAt + 5000 + SNATCH_GRACE_MS);
    expect(h.state.phase).toBe('manage');
    expect(h.state.owners[1]).toBe(buyer);
    expect(h.room.room.seq).toBe(seq + 1);
    for (const ws of Object.values(sockets)) {
      expect(ws.of('state')).toHaveLength(1);
      expect(ws.last('state').events.map((e) => e.type)).toEqual(['snatch_end']);
      expect(ws.last('state').events[0]).toMatchObject({ outcome: 'none', buyer });
    }
    expect(h.room.room.deadlines).toEqual({});
    // a second alarm does not close anything again
    for (const ws of Object.values(sockets)) ws.sent.length = 0;
    vi.setSystemTime(Date.now() + 1000);
    await h.room.alarm();
    expect(h.room.room.seq).toBe(seq + 1);
    for (const ws of Object.values(sockets)) expect(ws.of('error')).toHaveLength(0);
  });

  it('survives a Durable Object eviction: a fresh instance still closes the window at the same time', async () => {
    const { h, openedAt } = await windowRoom();
    const reborn = new GameRoom(h.ctx, {});
    await new Promise((r) => setImmediate(r)); // the real runtime blocks until the constructor's storage load is done
    expect(reborn.room.state.phase).toBe('snatch');
    expect(reborn.plan()).toMatchObject({ at: openedAt + 5000 + SNATCH_GRACE_MS, action: { type: 'SNATCH_CLOSE' } });
    h.room = reborn;
    await h.tick();
    expect(h.state.phase).toBe('manage');
  });

  it('follows the host rule: a 8 s window closes after 8 s plus the grace', async () => {
    const { h, openedAt } = await windowRoom({ snatchMs: 8000 });
    expect(h.state.pending.ms).toBe(8000);
    expect(h.room.plan().at).toBe(openedAt + 8000 + SNATCH_GRACE_MS);
  });
});

describe('snatch: sealed presses in the room', () => {
  it('a press is only sent back to the presser: no seq bump, no broadcast, the timer is untouched', async () => {
    const { h, sockets, others, openedAt } = await windowRoom();
    const [a, b] = others;
    const seq = h.room.room.seq;
    const deadlines = structuredClone(h.room.room.deadlines);
    for (const ws of Object.values(sockets)) ws.sent.length = 0;
    await h.say(sockets[a], { t: 'action', action: { type: 'SNATCH' } });
    expect(h.room.room.seq).toBe(seq);
    expect(h.room.room.deadlines).toEqual(deadlines);
    expect(sockets[a].of('state')).toHaveLength(1);
    const mine = sockets[a].last('state');
    expect(mine).toMatchObject({ events: [], seq });
    expect(mine.state.pending.claims).toEqual([a]);
    expect(mine.clock.deadline).toBe(openedAt + 5000 + SNATCH_GRACE_MS);
    for (const id of Object.keys(sockets)) if (id !== a) expect(sockets[id].sent).toEqual([]); // nobody else hears anything
    expect(h.state.pending.claims).toEqual([a]); // persisted in the authoritative state
    expect(h.room.room.afk[a]).toBeUndefined();
    // another player's view of the next state never shows it
    expect(h.room.viewOf(b).pending.claims).toEqual([]);
    expect(h.room.viewOf(a).pending.claims).toEqual([a]);
  });

  it('the close reveals the claimants and moves the district; the press is not shown before', async () => {
    const { h, sockets, buyer, others } = await windowRoom();
    const [a, b] = others;
    await h.say(sockets[a], { t: 'action', action: { type: 'SNATCH' } });
    for (const ws of Object.values(sockets)) ws.sent.length = 0;
    await h.tick(); // the timer closes the window: b never pressed
    for (const ws of Object.values(sockets)) {
      const m = ws.last('state');
      expect(m.events.map((e) => e.type)).toEqual(['snatch_end', 'own', 'snatch_token']);
      expect(m.events[0]).toMatchObject({ outcome: 'snatched', winner: a, claimants: [a], buyer });
      expect(m.state.owners[1]).toBe(a);
      expect(m.state.pending).toBeNull();
    }
    expect(h.state.players.find((p) => p.id === a).snatches).toBe(0);
    expect(h.state.players.find((p) => p.id === b).snatches).toBe(1);
  });

  it('the last eligible press resolves at once and IS broadcast (it ends the window)', async () => {
    const { h, sockets, others } = await windowRoom();
    const [a, b] = others;
    await h.say(sockets[a], { t: 'action', action: { type: 'SNATCH' } });
    const seq = h.room.room.seq;
    for (const ws of Object.values(sockets)) ws.sent.length = 0;
    await h.say(sockets[b], { t: 'action', action: { type: 'SNATCH' } });
    expect(h.room.room.seq).toBe(seq + 1);
    for (const ws of Object.values(sockets)) {
      const m = ws.last('state');
      expect(m.events.map((e) => e.type)).toEqual(['snatch_end', 'auction_start']);
      expect(m.events[0]).toMatchObject({ outcome: 'bidding' });
      expect([...m.state.pending.claimants].sort()).toEqual([a, b].sort());
    }
    expect(h.state.phase).toBe('auction');
  });

  it('refuses a double press, a press by the buyer, a client SNATCH_CLOSE and a press after the close', async () => {
    const { h, sockets, buyer, others } = await windowRoom();
    const [a] = others;
    await h.say(sockets[a], { t: 'action', action: { type: 'SNATCH' } });
    await h.say(sockets[a], { t: 'action', action: { type: 'SNATCH' } });
    expect(sockets[a].last('error').message).toBe('You already pressed Snatch');
    await h.say(sockets[buyer], { t: 'action', action: { type: 'SNATCH' } });
    expect(sockets[buyer].last('error').message).toBe('You cannot snatch this one');
    await h.say(sockets[a], { t: 'action', action: { type: 'SNATCH_CLOSE' } });
    expect(sockets[a].last('error').message).toBe('Invalid action.');
    expect(h.state.phase).toBe('snatch');
    await h.say(sockets[buyer], { t: 'action', action: { type: 'END_TURN' } });
    expect(sockets[buyer].last('error').message).toBe('Wait for the snatch window');
    await h.tick();
    await h.say(sockets[others[1]], { t: 'action', action: { type: 'SNATCH' } });
    expect(sockets[others[1]].last('error').message).toBe('There is nothing to snatch');
  });
});

describe('snatch: reconnecting in the middle of a window', () => {
  it('a fresh socket gets the open window with the time left and only its own press', async () => {
    const { h, sockets, others, openedAt } = await windowRoom();
    const [a, b] = others;
    await h.say(sockets[a], { t: 'action', action: { type: 'SNATCH' } });
    vi.setSystemTime(openedAt + 2000);
    // a reloads: the old socket is gone, a new one connects
    await h.room.webSocketClose(sockets[a], 1001);
    const back = await h.connect(a === U(1) ? user(1) : a === U(2) ? user(2) : user(3));
    const snap = back.last('state');
    expect(snap.events).toEqual([]);
    expect(snap.state.phase).toBe('snatch');
    expect(snap.state.pending.claims).toEqual([a]); // its own press survives the reload
    expect(snap.state.pending.remainingMs).toBe(3000); // the countdown resumes, it does not restart
    expect(snap.clock.deadline).toBe(openedAt + 5000 + SNATCH_GRACE_MS);
    expect(snap.now).toBe(openedAt + 2000);
    // b reconnecting sees no press of a
    const bUser = b === U(1) ? user(1) : b === U(2) ? user(2) : user(3);
    const other = await h.connect(bUser);
    expect(other.last('state').state.pending.claims).toEqual([]);
    expect(other.last('state').state.pending.remainingMs).toBe(3000);
  });

  it('after the window the snapshot is a plain state again', async () => {
    const { h, others } = await windowRoom();
    await h.tick();
    const back = await h.connect(others[0] === U(2) ? user(2) : others[0] === U(3) ? user(3) : user(1));
    expect(back.last('state').state.phase).toBe('manage');
    expect(back.last('state').state.pending).toBeNull();
  });
});
