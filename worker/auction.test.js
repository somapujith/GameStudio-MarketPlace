// The server side of sealed auctions (docs/GAME_RULES.md section 6): the action allow-list, the room-owned window timer
// (adapter.deadlines + GameRoom.plan), "nobody is auto-played before the window ends", the public `bidIn` list next to
// the sealed amounts, and a restart in the middle of an auction. Real engine, in-process fake Durable Object.
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
const { pendingActors } = adapterModule;
const { sanitizeAction } = await import('./validate.js');
const { maskStateFor } = await import('./mask.js');
const { validateSettings } = adapter;
const engine = await import('../shared/index.js');
const { AUCTION_GRACE_MS } = await import('../shared/timing.js');

const P = (n) => ({ id: `p${n}`, name: `Player ${n}`, avatar: n });

/**
 * A sealed auction is only ever opened by the Bazaar Auction corner (tile 32) or by Snatch bidding: passing a district never
 * starts one. This puts the turn player one step before the corner with Sultan Bazaar (60,000) the only free district, so
 * the next roll lands on the corner and opens the real Bazaar auction (reason 'bazaar', minimum 30,000). Returns the state
 * ready for that ROLL (`ready`), with `dice` 'fair' and the roll's own pips worked out so the pawn starts `d` squares before it.
 */
function bazaarReady(base) {
  const s = structuredClone(base);
  s.cfg.dice = 'fair';
  s.cfg.snatches = 0;
  for (const p of s.players) p.snatches = 0;
  for (let i = 0; i < engine.BOARD_SIZE; i++) if (engine.isBuyable(engine.TILES[i]) && i !== 1) s.owners[i] = '_city';
  const me = s.players[s.turn].id;
  const probe = engine.applyAction(s, { type: 'ROLL', playerId: me });
  const d = probe.state.dice[0];
  s.players[s.turn].pos = 32 - d; // the same roll (same rng state) now ends on the corner
  return { state: s, lander: me };
}

/** 3 players; p0 lands on the Bazaar Auction corner while Sultan Bazaar (60,000) is the only free district: the sealed auction is open. */
function openAuction(settings = {}) {
  const base = adapter.createGame({ players: [P(0), P(1), P(2)], settings: { ...settings, snatches: 0 }, seed: 11 });
  const { state, lander: me } = bazaarReady(base);
  const r = adapter.applyAction(state, { type: 'ROLL', playerId: me });
  expect(r.error).toBeUndefined();
  expect(r.state.phase).toBe('auction');
  return { state: r.state, events: r.events, lander: me };
}

describe('auction: the action allow-list', () => {
  it('lets a client BID but never AUCTION_CLOSE (not even with a player id)', () => {
    expect(sanitizeAction({ type: 'BID', amount: 12000 }, 'p1')).toEqual({ type: 'BID', amount: 12000, playerId: 'p1' });
    expect(sanitizeAction({ type: 'AUCTION_CLOSE' }, 'p1')).toBeNull();
    expect(sanitizeAction({ type: 'AUCTION_CLOSE', playerId: 'p1' }, 'p1')).toBeNull();
    expect(adapter.sanitizeAction({ type: 'AUCTION_CLOSE' }, 'p1')).toBeNull();
  });
});

describe('a pass never starts an auction (server side)', () => {
  it('SKIP_BUY through the adapter just ends the step; an idle human on a district they cannot afford or do not want is passed the same way', () => {
    const base = adapter.createGame({ players: [P(0), P(1), P(2)], settings: { snatches: 1 }, seed: 11 });
    let s = { ...base, cfg: { ...base.cfg, debug: true } };
    const me = s.players[s.turn].id;
    let r = adapter.applyAction(s, { type: 'ROLL', playerId: me, dice: [1] });
    expect(r.state.phase).toBe('buy');
    r = adapter.applyAction(r.state, { type: 'SKIP_BUY', playerId: me });
    expect(r.error).toBeUndefined();
    expect(r.state.phase).toBe('manage');
    expect(r.events.map((e) => e.type)).toEqual(['skip']);
    expect(adapter.deadlines(r.state).every((d) => !String(d.key).startsWith('auction'))).toBe(true);
    // a human who runs out of time on the buy decision is auto-played by the bot chooser: a plain buy or a plain pass
    s = structuredClone({ ...base, cfg: { ...base.cfg, debug: true } });
    s.players[s.turn].cash = 1000; // cannot afford: nothing to decide, no auction
    r = adapter.applyAction(s, { type: 'ROLL', playerId: me, dice: [1] });
    expect(r.state.phase).toBe('manage');
    expect(r.events.map((e) => e.type)).not.toContain('auction_start');
    const buy = adapter.applyAction({ ...base, cfg: { ...base.cfg, debug: true } }, { type: 'ROLL', playerId: me, dice: [1] }).state;
    const idle = adapter.idleAction(buy, me);
    expect(['BUY', 'SKIP_BUY']).toContain(idle.type);
    const after = adapter.applyAction(buy, idle);
    expect(after.error).toBeUndefined();
    expect(after.events.map((e) => e.type)).not.toContain('auction_start');
  });
});

describe('auction: adapter timer and auto-play', () => {
  it('exposes exactly one close timer: keyed by the auction, 20 s plus the grace, no player action', () => {
    const { state } = openAuction();
    const list = adapter.deadlines(state);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: 'auction:1', afterMs: 20000 + AUCTION_GRACE_MS, action: { type: 'AUCTION_CLOSE' } });
    expect(list[0].action.playerId).toBeUndefined();
    expect(AUCTION_GRACE_MS).toBe(400);
    expect(adapter.deadlines(openAuction({ auctionSeconds: 45 }).state)[0].afterMs).toBe(45000 + AUCTION_GRACE_MS);
    expect(adapter.deadlines(openAuction({ auctionSeconds: 10 }).state)[0].afterMs).toBe(10000 + AUCTION_GRACE_MS);
  });

  it('the timer is gone once the auction ends, and applying the close twice is refused', () => {
    const { state } = openAuction();
    const closed = adapter.applyAction(state, adapter.deadlines(state)[0].action);
    expect(closed.error).toBeUndefined();
    expect(closed.state.phase).toBe('manage');
    expect(adapter.deadlines(closed.state)).toEqual([]);
    expect(adapter.applyAction(closed.state, { type: 'AUCTION_CLOSE' }).error).toBe('There is no auction right now');
  });

  it('a stored auction without an id (older version) still gets a timer', () => {
    const { state } = openAuction();
    delete state.pending.id;
    delete state.pending.ms;
    const [d] = adapter.deadlines(state);
    expect(d.key).toMatch(/^auction:\d+:1$/);
    expect(d.afterMs).toBe(20000 + AUCTION_GRACE_MS);
  });

  it('never auto-plays a bidder before the window ends (AFK or disconnected humans are passed by the timer)', () => {
    const { state } = openAuction();
    for (const p of state.players) expect(adapter.idleAction(state, p.id)).toBeNull();
  });

  it('waits for the players who have not bid, and the engine auto-play of a human is a pass', () => {
    const { state } = openAuction();
    expect(pendingActors(state)).toEqual(['p0', 'p1', 'p2']);
    const s = adapter.applyAction(state, { type: 'BID', playerId: 'p1', amount: 31000 }).state;
    expect(pendingActors(s)).toEqual(['p0', 'p2']);
    expect(adapter.pendingPlayerIds(s)).toEqual(['p0', 'p2']);
    expect(adapter.moveDelayMs({ type: 'BID' })).toBeLessThan(adapter.moveDelayMs({ type: 'ROLL' }));
    expect(adapter.moveDelayMs({ type: 'AUCTION_CLOSE' })).toBeGreaterThan(0);
  });

  it('is an ordinary host rule: legal 10..90 in steps of 5, anything else is refused', () => {
    expect(validateSettings({ auctionSeconds: 30 })).toMatchObject({ ok: true, settings: { auctionSeconds: 30 } });
    expect(validateSettings({}).settings.auctionSeconds).toBe(20);
    for (const bad of [5, 9, 12, 95, 100, 20.5, '20', null, true]) {
      expect(validateSettings({ auctionSeconds: bad }), String(bad)).toEqual({ ok: false, error: 'Auction timer must be a whole number from 10 to 90 seconds in steps of 5.' });
    }
  });
});

describe('auction: what each viewer sees', () => {
  it('bidIn is public (who has bid), the amounts stay sealed, eligible/ms are shown to everyone', () => {
    let { state } = openAuction();
    state = adapter.applyAction(state, { type: 'BID', playerId: 'p1', amount: 30000 }).state;
    state = adapter.applyAction(state, { type: 'BID', playerId: 'p2', amount: 35000 }).state; // p0 has not bid: still open
    expect(state.phase).toBe('auction');
    for (const viewer of ['p0', 'p1', 'p2', undefined]) {
      const view = adapter.redact(state, viewer);
      expect(view.pending.bidIn).toEqual(['p1', 'p2']);
      expect(view.pending.eligible).toEqual(['p0', 'p1', 'p2']);
      expect(view.pending.ms).toBe(20000);
      expect(view.pending.bids).toEqual({ p1: viewer === 'p1' ? 30000 : 0, p2: viewer === 'p2' ? 35000 : 0 });
    }
    expect(state.pending.bids).toEqual({ p1: 30000, p2: 35000 }); // never mutated
    expect(maskStateFor(state, 'p0').pending.bidIn).toBe(state.pending.bidIn);
  });

  it('auction_end reveals every bid, the order and the tie flag to everybody', () => {
    let { state } = openAuction();
    state = adapter.applyAction(state, { type: 'BID', playerId: 'p1', amount: 30000 }).state;
    const r = adapter.applyAction(state, { type: 'AUCTION_CLOSE' });
    const end = r.events.find((e) => e.type === 'auction_end');
    expect(end).toMatchObject({ winner: 'p1', amount: 30000, order: ['p1', 'p0', 'p2'], tie: false, timedOut: ['p0', 'p2'], saved: 30000, bids: { p0: 0, p1: 30000, p2: 0 } });
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

/** A started 3-player room; the turn player rolls onto the Bazaar Auction corner through the room: the auction opens as in play. */
async function auctionRoom(settings = {}) {
  const h = new Harness();
  await h.init(user(1), settings, 3);
  const sockets = { [U(1)]: await h.connect(user(1)), [U(2)]: await h.connect(user(2)), [U(3)]: await h.connect(user(3)) };
  await h.say(sockets[U(1)], { t: 'start' });
  const players = h.state.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar }));
  const { state: s, lander } = bazaarReady(engine.createGame({ players, settings: { ...h.state.cfg, snatches: 0 }, seed: 5 }));
  h.room.room.state = s;
  h.room.room.lastApplyAt = Date.now();
  h.room.room.animMs = 0;
  for (const ws of Object.values(sockets)) ws.sent.length = 0;
  const res = await h.room.applyAndBroadcast({ type: 'ROLL', playerId: lander });
  expect(res.error).toBeUndefined();
  const others = players.map((p) => p.id).filter((id) => id !== lander);
  return { h, sockets, lander, others, players: players.map((p) => p.id), openedAt: h.room.room.lastApplyAt };
}

describe('auction: the room timer', () => {
  it('broadcasts the auction with the deadline counted from the end of the animation, and who is still thinking', async () => {
    const { h, sockets, players, openedAt } = await auctionRoom();
    const r = h.room.room;
    expect(h.state.phase).toBe('auction');
    const due = openedAt + r.animMs + 20000 + AUCTION_GRACE_MS;
    for (const ws of Object.values(sockets)) {
      const m = ws.last('state');
      expect(m.state.phase).toBe('auction');
      expect(m.events.map((e) => e.type)).toEqual(['dice', 'move', 'land', 'auction_start']);
      expect(m.events.at(-1)).toMatchObject({ type: 'auction_start', reason: 'bazaar', minBid: 30000 });
      expect(m.clock.deadline).toBe(due);
      expect([...m.clock.waitingFor].sort()).toEqual([...players].sort());
      expect(m.state.pending).toMatchObject({ id: 1, bidIn: [], ms: 20000, remainingMs: 20000 });
      expect(m.state.pending.eligible.sort()).toEqual([...players].sort());
    }
    expect(Object.keys(r.deadlines)).toEqual(['auction:1']);
    expect(Object.values(r.deadlines)).toEqual([openedAt + r.animMs]);
  });

  it('plans one AUCTION_CLOSE and nothing earlier: AFK or disconnected humans are not auto-passed until the window ends', async () => {
    const { h, others, openedAt } = await auctionRoom();
    const r = h.room.room;
    const due = openedAt + r.animMs + 20000 + AUCTION_GRACE_MS;
    expect(h.room.plan()).toMatchObject({ at: due, action: { type: 'AUCTION_CLOSE' }, timeout: false });
    for (const id of others) r.afk[id] = true;
    r.disc[others[0]] = openedAt - 600000;
    const plan = h.room.plan();
    expect(plan.action).toEqual({ type: 'AUCTION_CLOSE' });
    expect(plan.at).toBe(due);
    expect(h.room.clockView()).toMatchObject({ deadline: due });
    // an alarm before the end does nothing
    vi.setSystemTime(due - 2000);
    const seq = r.seq;
    await h.room.alarm();
    expect(h.state.phase).toBe('auction');
    expect(r.seq).toBe(seq);
  });

  it('fires AUCTION_CLOSE once: the non-bidders pass, the auction resolves, everyone is told, the timer is gone', async () => {
    const { h, sockets, others, players } = await auctionRoom();
    await h.say(sockets[others[0]], { t: 'action', action: { type: 'BID', amount: 40000 } });
    const seq = h.room.room.seq;
    for (const ws of Object.values(sockets)) ws.sent.length = 0;
    expect(await h.tick()).toBe(true);
    expect(h.state.phase).toBe('manage');
    expect(h.state.owners[1]).toBe(others[0]);
    expect(h.room.room.seq).toBe(seq + 1);
    for (const ws of Object.values(sockets)) {
      expect(ws.of('state')).toHaveLength(1);
      const m = ws.last('state');
      expect(m.events.map((e) => e.type)).toEqual(['auction_end', 'cash', 'own']);
      expect(m.events[0]).toMatchObject({ winner: others[0], amount: 40000, timedOut: players.filter((id) => id !== others[0]), tie: false });
      expect(m.state.pending).toBeNull();
    }
    expect(h.room.room.deadlines).toEqual({});
    // a second alarm does not close anything again
    for (const ws of Object.values(sockets)) ws.sent.length = 0;
    vi.setSystemTime(Date.now() + 30000);
    await h.room.alarm();
    expect(h.room.room.seq).toBe(seq + 1);
    for (const ws of Object.values(sockets)) expect(ws.of('error')).toHaveLength(0);
  });

  it('a window with no bid at all leaves the district unowned and says so', async () => {
    const { h, sockets } = await auctionRoom();
    for (const ws of Object.values(sockets)) ws.sent.length = 0;
    await h.tick();
    expect(h.state.owners[1]).toBeNull();
    const end = sockets[U(1)].last('state').events.find((e) => e.type === 'auction_end');
    expect(end).toMatchObject({ winner: null, amount: 0, tie: false });
    expect(end.timedOut).toHaveLength(3);
    expect(h.state.phase).toBe('manage');
  });

  it('survives a Durable Object eviction: a fresh instance closes the window at the same time, with the bids kept', async () => {
    const { h, sockets, others } = await auctionRoom();
    const startedAt = h.room.room.deadlines['auction:1']; // persisted: a bid (new lastApplyAt / animMs) never moves it
    await h.say(sockets[others[0]], { t: 'action', action: { type: 'BID', amount: 33000 } });
    const before = h.room.plan();
    const reborn = new GameRoom(h.ctx, {});
    await new Promise((r) => setImmediate(r)); // the real runtime blocks until the constructor's storage load is done
    expect(reborn.room.state.phase).toBe('auction');
    expect(reborn.room.state.pending.bidIn).toEqual([others[0]]);
    expect(reborn.room.state.pending.bids[others[0]]).toBe(33000);
    expect(reborn.plan()).toMatchObject({ at: before.at, action: { type: 'AUCTION_CLOSE' } });
    expect(before.at).toBe(startedAt + 20000 + AUCTION_GRACE_MS);
    expect(reborn.room.deadlines).toEqual({ 'auction:1': startedAt });
    h.room = reborn;
    await h.tick();
    expect(h.state.phase).toBe('manage');
    expect(h.state.owners[1]).toBe(others[0]);
  });

  it('follows the host rule: a 45 s window closes after 45 s plus the grace', async () => {
    const { h, openedAt } = await auctionRoom({ auctionSeconds: 45 });
    expect(h.state.pending.ms).toBe(45000);
    expect(h.room.plan().at).toBe(openedAt + h.room.room.animMs + 45000 + AUCTION_GRACE_MS);
  });
});

describe('auction: bids in the room', () => {
  it('a bid is broadcast to everybody: bidIn names the bidder, the amount is masked for the others; the deadline does not move', async () => {
    const { h, sockets, others } = await auctionRoom();
    const [a, b] = others;
    const deadline = sockets[a].last('state').clock.deadline;
    for (const ws of Object.values(sockets)) ws.sent.length = 0;
    await h.say(sockets[a], { t: 'action', action: { type: 'BID', amount: 34000 } });
    for (const [id, ws] of Object.entries(sockets)) {
      const m = ws.last('state');
      expect(m.state.pending.bidIn).toEqual([a]);
      expect(m.state.pending.bids[a]).toBe(id === a ? 34000 : 0);
      expect(m.clock.deadline).toBe(deadline);
      expect(m.clock.waitingFor).not.toContain(a);
      expect(m.clock.waitingFor).toContain(b);
      expect(JSON.stringify(m.events)).not.toContain('34000');
    }
    expect(h.state.pending.bids[a]).toBe(34000);
    expect(h.room.room.afk[a]).toBeUndefined();
  });

  it('the last bid resolves the auction at once and clears the timer', async () => {
    const { h, sockets, lander, others } = await auctionRoom();
    await h.say(sockets[others[0]], { t: 'action', action: { type: 'BID', amount: 34000 } });
    await h.say(sockets[others[1]], { t: 'action', action: { type: 'BID', amount: 0 } });
    expect(h.state.phase).toBe('auction');
    await h.say(sockets[lander], { t: 'action', action: { type: 'BID', amount: 45000 } });
    expect(h.state.phase).toBe('manage');
    expect(h.state.owners[1]).toBe(lander);
    expect(h.room.room.deadlines).toEqual({});
    const end = sockets[others[0]].last('state').events.find((e) => e.type === 'auction_end');
    expect(end).toMatchObject({ winner: lander, amount: 45000, order: [lander, others[0], others[1]], tie: false });
    expect(end.timedOut).toBeUndefined();
  });

  it('refuses a client AUCTION_CLOSE, a double bid and a bid after the close', async () => {
    const { h, sockets, others } = await auctionRoom();
    const [a, b] = others;
    await h.say(sockets[a], { t: 'action', action: { type: 'AUCTION_CLOSE' } });
    expect(sockets[a].last('error').message).toBe('Invalid action.');
    expect(h.state.phase).toBe('auction');
    await h.say(sockets[a], { t: 'action', action: { type: 'BID', amount: 31000 } });
    await h.say(sockets[a], { t: 'action', action: { type: 'BID', amount: 32000 } });
    expect(sockets[a].last('error').message).toBe('You already placed your bid');
    await h.tick();
    await h.say(sockets[b], { t: 'action', action: { type: 'BID', amount: 32000 } });
    expect(sockets[b].last('error').message).toBe('There is no auction right now');
  });

  it('a reconnecting player gets the open auction with the time left and their own bid only', async () => {
    const { h, sockets, others } = await auctionRoom();
    const [a, b] = others;
    const startedAt = h.room.room.deadlines['auction:1'];
    await h.say(sockets[a], { t: 'action', action: { type: 'BID', amount: 36000 } });
    await h.say(sockets[b], { t: 'action', action: { type: 'BID', amount: 38000 } });
    vi.setSystemTime(startedAt + 7000);
    await h.room.webSocketClose(sockets[a], 1001);
    const back = await h.connect(a === U(1) ? user(1) : a === U(2) ? user(2) : user(3));
    const snap = back.last('state');
    expect(snap.events).toEqual([]);
    expect(snap.state.pending.bidIn.sort()).toEqual([a, b].sort());
    expect(snap.state.pending.bids[a]).toBe(36000);
    expect(snap.state.pending.bids[b]).toBe(0);
    expect(snap.state.pending.remainingMs).toBe(13000);
    expect(snap.clock.deadline).toBe(startedAt + 20000 + AUCTION_GRACE_MS);
  });
});
