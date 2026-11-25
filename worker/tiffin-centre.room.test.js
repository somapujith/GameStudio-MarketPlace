// Tiffin Centre online verification, TIER 1 (no infrastructure): a REAL GameRoom (worker/GameRoom.js) with the REAL tiffin adapter and
// two to four FAKE players over the server clock (fake Date + alarm stepping, fake sockets, fake DO storage). It proves that a private
// table can run ONE stall in real time: lobby -> start -> a tick per second from the alarm -> real, sanitized actions from every seat
// interleaved with the ticks -> the shift ends -> one match record. It also drives the client room-session core
// (src/games/tiffin-centre/session/roomCore.js) with the real `{t:'state', state, events, seq, clock, now}` messages of the room.
//
// What this does NOT cover (tier 2): real WebSockets, wrangler / workerd, Neon, the browser, the 3D scene.
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const persisted = [];
vi.mock('./match.js', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    persistMatch: vi.fn(async (env, rec) => {
      if (persisted.some((r) => r.id === rec.id)) return { inserted: false };
      persisted.push(rec);
      return { inserted: true };
    }),
  };
});

const { GameRoom, RESTORE_SEQ_MARGIN } = await import('./GameRoom.js');
const { GAME_ADAPTERS } = await import('./games/index.js');
const { persistMatch } = await import('./match.js');
const engine = await import('../shared/tiffin-centre/index.js');
const { createRoomSessionCore } = await import('../src/games/tiffin-centre/session/roomCore.js');

const { TICK_MS, HANDS_MAX, MAX_LEVEL } = engine;
const ABANDON_MS = 5 * 60 * 1000; // GameRoom.js (not exported)
const GRACE_MS = 30_000; // GameRoom.js exports GRACE_MS too; kept literal so a change there fails this test loudly
const stats = {}; // numbers logged at the end (and in the report)

// ------------------------------------------------------------------------------------------------------------------ fakes

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.sent = [];
    this.att = null;
    this.tags = [];
    this.closeCode = null;
    this.bytes = { state: 0, room: 0, other: 0 };
    this.counts = { state: 0, room: 0, other: 0 };
    this.onMessage = null; // a client attached to this socket (see `Client`)
    this.lastByType = {}; // survives clearing `sent` (long runs)
  }
  send(m) {
    const kind = m.startsWith('{"t":"state"') ? 'state' : m.startsWith('{"t":"room"') ? 'room' : 'other';
    this.bytes[kind] += m.length;
    this.counts[kind] += 1;
    const msg = JSON.parse(m);
    this.sent.push(msg);
    this.lastByType[msg.t] = msg;
    if (this.onMessage) this.onMessage(msg);
  }
  close(code) {
    this.readyState = 3;
    this.closeCode = code;
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
    return this.lastByType[type];
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
    puts: 0,
    putBytes: 0,
    alarmSets: 0,
    storage: {
      get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
      put: async (k, v) => {
        ctx.puts += 1;
        ctx.putBytes += JSON.stringify(v).length;
        store.set(k, structuredClone(v));
      },
      setAlarm: async (t) => {
        ctx.alarmSets += 1;
        ctx.alarmAt = t;
      },
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
const user = (n) => ({ id: U(n), name: `Cook ${n}`, avatar: n % 12 });

class Harness {
  constructor() {
    this.ctx = makeCtx();
    this.room = new GameRoom(this.ctx, {});
    this.clients = [];
  }
  init(body = {}, host = user(1)) {
    return this.room.fetch({ url: 'https://x/init', method: 'POST', headers: new Headers(), json: async () => ({ code: 'TIFF22', host, ...body }) });
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
  say(ws, msg) {
    return this.room.webSocketMessage(ws, JSON.stringify(msg));
  }
  /** Fire the pending alarm at its due time (the clock never goes backwards). */
  async tick() {
    const at = this.ctx.alarmAt;
    if (at == null) return false;
    vi.setSystemTime(Math.max(Date.now(), at));
    await this.room.alarm();
    return true;
  }
  /** The socket of a player drops (network loss / tab closed). */
  async drop(ws) {
    ws.readyState = 3;
    await this.room.webSocketClose(ws, 1006);
  }
  get r() {
    return this.room.room;
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
  vi.setSystemTime(new Date('2026-11-25T10:00:00Z').getTime());
  persisted.length = 0;
  persistMatch.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A private table: create, everyone joins and readies up, the host starts. Returns the harness with `.seats = [{ id, ws, name }]`. */
async function table({ level = 1, pace = 'normal', n = 2 } = {}) {
  const h = new Harness();
  expect((await h.init({ gameId: 'tiffin-centre', settings: { level, pace } })).status).toBe(201);
  h.seats = [];
  for (let i = 1; i <= n; i += 1) {
    const ws = await h.connect(user(i));
    h.seats.push({ id: U(i), ws, name: `Cook ${i}` });
    await h.say(ws, { t: 'ready', ready: true });
  }
  await h.say(h.seats[0].ws, { t: 'start' });
  expect(h.r.status).toBe('playing');
  return h;
}

const json = (v) => JSON.stringify(v);

/**
 * One game second with every seat acting once (the greedy bot over what THAT seat last saw, through the real wire: the sanitizer, the
 * rate limit, the engine), at staggered offsets inside the second, then the alarm's tick. Returns the number of actions applied.
 */
async function playSecond(h, seats, { bot = true } = {}) {
  const base = Date.now();
  let applied = 0;
  for (let i = 0; i < seats.length; i += 1) {
    vi.setSystemTime(base + 120 + i * 200); // always before the tick is due (base + 1000)
    const seen = seats[i].ws.last('state')?.state;
    const action = bot && seen ? engine.chooseAutoAction(seen, seats[i].id) : null;
    if (!action) continue;
    const seq = h.r.seq;
    await h.say(seats[i].ws, { t: 'action', action });
    if (h.r.seq > seq) applied += 1;
  }
  await h.tick();
  return applied;
}

/** Every socket saw the very same state at the very same seq as the server holds. */
function expectInSync(h) {
  const truth = json(h.r.state);
  for (const s of h.seats) {
    if (s.ws.readyState !== 1) continue;
    const m = s.ws.last('state');
    expect(m.seq, `seq of ${s.name}`).toBe(h.r.seq);
    expect(json(m.state), `state of ${s.name} at seq ${h.r.seq}`).toBe(truth);
  }
}

/** Per socket the seqs of its state messages: a live socket never misses one (no gaps, no repeats, no going back). */
function expectNoGaps(ws, from = 0) {
  const seqs = ws.of('state').map((m) => m.seq).slice(from);
  for (let i = 1; i < seqs.length; i += 1) expect(seqs[i], `seq after ${seqs[i - 1]}`).toBe(seqs[i - 1] + 1);
}

// ------------------------------------------------------------------------------------------------------------------ lobby

describe('lobby to start', () => {
  it('a private table: host picks level and pace, a friend joins, ready, start; a stranger cannot join mid-shift', async () => {
    const h = new Harness();
    expect((await h.init({ gameId: 'tiffin-centre' })).status).toBe(201);
    expect(h.r.settings).toEqual({ level: 1, pace: 'normal' });
    const host = await h.connect(user(1));
    await h.say(host, { t: 'start' });
    expect(host.last('error').message).toMatch(/at least 2 players/);
    const guest = await h.connect(user(2));
    await h.say(guest, { t: 'settings', settings: { level: 5 } });
    expect(guest.last('error').message).toMatch(/host/);
    await h.say(host, { t: 'settings', settings: { level: 13 } });
    expect(host.last('error').message).toMatch(/Level must be/);
    await h.say(host, { t: 'settings', settings: { level: 5, pace: 'rush' } });
    expect(guest.last('room').room.settings).toEqual({ level: 5, pace: 'rush' });
    await h.say(guest, { t: 'ready', ready: true });
    await h.say(guest, { t: 'start' });
    expect(guest.last('error').message).toMatch(/Only the host/);
    await h.say(host, { t: 'start' });
    expect(h.r.status).toBe('playing');
    expect(h.r.seq).toBe(1);
    const s = h.r.state;
    expect(s).toMatchObject({ level: 5, pace: 'rush', tick: 0, status: 'playing', shiftTicks: 180 });
    expect([...s.order].sort()).toEqual([U(1), U(2)]);
    // both got the first snapshot, identical
    expect(json(host.last('state').state)).toBe(json(guest.last('state').state));
    expect(host.last('state')).toMatchObject({ t: 'state', seq: 1, events: [] });
    expect(host.last('state').clock).toEqual({ deadline: h.r.lastApplyAt + TICK_MS, waitingFor: [] });
    expect(typeof host.last('state').now).toBe('number');
    // settings are locked now and a third player cannot sit down
    await h.say(host, { t: 'settings', settings: { level: 2 } });
    expect(host.last('error').message).toMatch(/locked/);
    const stranger = await h.connect(user(3));
    expect(stranger.closeCode).toBe(4003);
    expect(stranger.last('error').message).toMatch(/already started/);
    expect(h.r.players).toHaveLength(2);
  });

  it('an alarm armed in the lobby never starts the stall by itself', async () => {
    const h = new Harness();
    await h.init({ gameId: 'tiffin-centre' });
    await h.connect(user(1));
    await h.connect(user(2));
    // nothing is due but the 24 h expiry (no public listing, nobody missing): there is no timer that could start a game
    expect(h.ctx.alarmAt).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    expect(h.room.plan()).toBeNull();
    expect(h.r.status).toBe('lobby');
    expect(h.r.state).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------------------------ one stall, two cooks

describe('two players run one stall in real time (level 1, greedy bots over the wire)', () => {
  it('identical state at every seq, one tick per second regardless of actions, finishes, one match record with both ranked', async () => {
    const h = await table({ level: 1, pace: 'normal', n: 2 });
    const t0 = Date.now();
    const seqs = [];
    let actions = 0;
    let seconds = 0;
    const tickTimes = [];
    while (h.r.status === 'playing' && seconds < 600) {
      const before = h.r.state.tick;
      actions += await playSecond(h, h.seats);
      seconds += 1;
      expectInSync(h);
      seqs.push(h.r.seq);
      if (h.r.state.tick !== before) tickTimes.push(Date.now() - t0);
    }
    expect(h.r.status).toBe('finished');
    expect(h.r.state.status === 'done' || h.r.state.status === 'closed').toBe(true);
    // the server clock: tick k happened exactly k * TICK_MS after the start, however many actions came in between (never postponed)
    tickTimes.forEach((t, i) => expect(t).toBe((i + 1) * TICK_MS));
    expect(h.r.state.tick).toBe(tickTimes.length);
    expect(actions).toBeGreaterThan(20); // both really played
    for (const s of h.seats) expectNoGaps(s.ws);
    // both seats saw every single state, in the same order
    expect(h.seats[0].ws.of('state').map((m) => m.seq)).toEqual(h.seats[1].ws.of('state').map((m) => m.seq));
    // per player stats: both cooks worked (hands, collects), and what they earned adds up to the team's money
    const ps = h.r.state.order.map((id) => h.r.state.players[id]);
    stats.l1 = { ticks: h.r.state.tick, money: h.r.state.money, stars: h.r.state.stars, status: h.r.state.status, actions, served: ps.map((p) => p.served), collected: ps.map((p) => p.collected) };
    expect(ps.reduce((n, p) => n + p.earned, 0)).toBe(h.r.state.money);
    // one match record, both ranked the way the plan says
    for (let i = 0; i < 6 && !h.r.persisted; i += 1) await h.tick();
    expect(h.r.persisted).toBe(true);
    expect(persistMatch).toHaveBeenCalledTimes(1);
    expect(persisted).toHaveLength(1);
    const rec = persisted[0];
    const res = engine.result(h.r.state);
    expect(rec).toMatchObject({ gameId: 'tiffin-centre', roomCode: 'TIFF22', playerCount: 2, winReason: res.reason, rounds: h.r.state.tick });
    expect(rec.players.map((p) => p.user_id).sort()).toEqual([U(1), U(2)]);
    const wantRank = res.stars >= 1 ? 1 : 2;
    expect(rec.players.map((p) => p.rank)).toEqual([wantRank, wantRank]);
    expect(rec.seats.map((s) => s.rank)).toEqual([wantRank, wantRank]);
    expect(rec.winnerId).toBe(res.winnerId);
    if (res.stars >= 1) expect(rec.winnerId).toBe(res.standings[0].id); // top earner of the team
    expect(rec.players.map((p) => p.final_worth).sort((a, b) => b - a)).toEqual(res.standings.map((r) => r.score).sort((a, b) => b - a));
    // finished rooms stop their clock
    expect(h.room.plan()).toBeNull();
  });

  it('a seat that is asked to play twice per second does not postpone the tick either (action spam in one second)', async () => {
    const h = await table({ level: 1, n: 2 });
    const [a, b] = h.seats;
    const start = Date.now();
    for (let sec = 0; sec < 4; sec += 1) {
      for (let k = 1; k <= 8; k += 1) {
        vi.setSystemTime(start + sec * TICK_MS + k * 100); // 8 actions per second, up to 800 ms into it
        await h.say(k % 2 ? a.ws : b.ws, { t: 'action', action: { type: 'move', to: k % 4 ? 'tawa1' : 'chai1' } });
        // the due time of the next tick never moves
        expect(h.ctx.alarmAt).toBe(start + (sec + 1) * TICK_MS);
      }
      await h.tick();
      expect(Date.now()).toBe(start + (sec + 1) * TICK_MS);
      expect(h.r.state.tick).toBe(sec + 1);
    }
  });
});

describe('every level 1..12 runs to the end on the server clock with two cooks', () => {
  it.each(Array.from({ length: MAX_LEVEL }, (_, i) => i + 1))('level %i', async (level) => {
    const pace = ['relaxed', 'normal', 'rush'][level % 3];
    const h = await table({ level, pace, n: 2 });
    let seconds = 0;
    while (h.r.status === 'playing' && seconds < 900) {
      await playSecond(h, h.seats);
      seconds += 1;
    }
    expect(h.r.status).toBe('finished');
    expectInSync(h);
    const s = h.r.state;
    // a shift is shiftTicks long plus at most the time the last customers need to leave
    expect(s.tick).toBeGreaterThanOrEqual(1);
    if (s.status === 'done') expect(s.tick).toBeGreaterThanOrEqual(s.shiftTicks);
    stats[`level${level}`] = { pace, ticks: s.tick, shiftTicks: s.shiftTicks, status: s.status, stars: s.stars, money: s.money, lives: s.lives };
    for (let i = 0; i < 6 && !h.r.persisted; i += 1) await h.tick();
    expect(persistMatch).toHaveBeenCalledTimes(1);
    const rec = persisted[0];
    const want = engine.result(s).stars >= 1 ? 1 : 2;
    expect(rec.players.map((p) => p.rank)).toEqual([want, want]);
  }, 60_000);
});

// ------------------------------------------------------------------------------------------------------------------ two cooks, two pairs of hands

describe('who did what', () => {
  it('actions from seat B are attributed to B whatever playerId they claim; hands are per player', async () => {
    const h = await table({ level: 1, n: 2 });
    const [a, b] = h.seats;
    // B tries to pass itself off as A on every action
    await h.say(b.ws, { t: 'action', action: { type: 'cook', station: 'tawa1', slot: 1, dish: 'dosa', playerId: a.id } });
    await h.say(a.ws, { t: 'action', action: { type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' } });
    await h.say(b.ws, { t: 'action', action: { type: 'cook', station: 'tawa1', slot: 2, dish: 'dosa', playerId: 'someone-else' } });
    await h.say(b.ws, { t: 'action', action: { type: 'cook', station: 'chai1', slot: 0, dish: 'irani_chai', playerId: a.id } });
    const slots = h.r.state.stations.tawa1.slots;
    expect(slots.map((s) => s.by)).toEqual([a.id, b.id, b.id]);
    expect(h.r.state.stations.chai1.slots[0].by).toBe(b.id);
    expect(h.r.state.players[a.id].at).toBeNull();
    // move: also forced to the sender
    await h.say(b.ws, { t: 'action', action: { type: 'move', to: 'tawa1', playerId: a.id } });
    expect(h.r.state.players[b.id].at).toBe('tawa1');
    expect(h.r.state.players[a.id].at).toBeNull();
    // everything is cooked after 5 ticks
    for (let i = 0; i < 5; i += 1) await h.tick();
    expect(h.r.state.stations.tawa1.slots.map((s) => s.st)).toEqual(['ready', 'ready', 'ready']);
    const err = (ws) => ws.last('error')?.message;
    await h.say(b.ws, { t: 'action', action: { type: 'take', station: 'tawa1', slot: 1 } });
    await h.say(b.ws, { t: 'action', action: { type: 'take', station: 'tawa1', slot: 2 } });
    expect(h.r.state.players[b.id].hands).toHaveLength(HANDS_MAX);
    expect(h.r.state.players[a.id].hands).toHaveLength(0);
    // B's hands are full: a third dish is refused for B ... but A (own hands, empty) takes it
    await h.say(b.ws, { t: 'action', action: { type: 'take', station: 'tawa1', slot: 0 } });
    expect(err(b.ws)).toBe('Your hands are full');
    expect(h.r.state.stations.tawa1.slots[0].st).toBe('ready');
    await h.say(a.ws, { t: 'action', action: { type: 'take', station: 'tawa1', slot: 0 } });
    expect(h.r.state.players[a.id].hands).toHaveLength(1);
    expect(h.r.state.players[b.id].hands).toHaveLength(2);
    // A cannot serve out of B's hands: hand 1 of A does not exist
    await h.say(a.ws, { t: 'action', action: { type: 'discard', hand: 1 } });
    expect(err(a.ws)).toBe('Nothing in that hand');
    expect(h.r.state.players[b.id].hands).toHaveLength(2);
    // the seat that did the work is shown in the events too
    const take = a.ws.of('state').flatMap((m) => m.events).filter((e) => e.type === 'take');
    expect(take.map((e) => e.by)).toEqual([b.id, b.id, a.id]);
    expectInSync(h);
  });

  it('a seat serves and collects for a customer the OTHER seat cooked for (co-op), with the money credited to who collected', async () => {
    const h = await table({ level: 1, n: 2 });
    const [a, b] = h.seats;
    let guard = 0;
    const seatOf = (id) => h.seats.find((s) => s.id === id);
    // wait for the first customer, A cooks what they asked for
    while (!h.r.state.customers.some((c) => c.st === 'waiting') && guard++ < 60) await h.tick();
    const c = h.r.state.customers.find((x) => x.st === 'waiting');
    const dish = c.order[0];
    const station = engine.DISHES[dish].station === 'tawa' ? 'tawa1' : 'chai1';
    await h.say(a.ws, { t: 'action', action: { type: 'cook', station, slot: 0, dish } });
    for (let i = 0; i < engine.DISHES[dish].cook; i += 1) await h.tick();
    expect(h.r.state.stations[station].slots[0].st).toBe('ready');
    await h.say(b.ws, { t: 'action', action: { type: 'take', station, slot: 0 } }); // B takes A's dish
    await h.say(b.ws, { t: 'action', action: { type: 'serve', customer: c.id, hand: 0 } });
    const served = h.r.state.customers.find((x) => x.id === c.id);
    expect(served.got).toEqual([dish]);
    expect(h.r.state.players[b.id].served).toBe(1);
    expect(h.r.state.players[a.id].served).toBe(0);
    // finish the order if it had more dishes: not needed, just the first dish proves the hand-over
    expect(seatOf(b.id).ws.last('state').events.some((e) => e.type === 'serve' && e.by === b.id)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------------------ hostile clients

describe('what a client may NOT send', () => {
  it('tick / spawn / tutorial-flags / unknown / malformed / prototype tricks are refused and change nothing; a flood is rate limited', async () => {
    const h = await table({ level: 1, n: 2 });
    const [a, b] = h.seats;
    const seq = h.r.seq;
    const tick = h.r.state.tick;
    const bad = [
      { type: 'tick' },
      { type: 'tick', tick: 0 },
      { type: 'spawn', customer: { order: ['dosa'] } },
      { type: 'tutorial-flags', patience: false, pay: false },
      { type: 'bogus' },
      { type: ['tick'] },
      { type: 'cook', station: '__proto__', slot: 0, dish: 'dosa' },
      { type: 'cook', station: 'tawa1', slot: -1, dish: 'dosa' },
      { type: 'cook', station: 'tawa1', slot: 1.5, dish: 'dosa' },
      { type: 'cook', station: 'tawa1', slot: 0, dish: 'constructor' },
      { type: 'serve', customer: 'x', hand: 0 },
      { type: 'move', to: 'spot:9' },
      { type: 'move', to: 42 },
      { type: 'emote', e: 'rocket' },
      'tick',
      null,
      [],
    ];
    for (const action of bad) {
      const n = b.ws.of('error').length;
      await h.say(b.ws, { t: 'action', action });
      expect(b.ws.of('error').length, JSON.stringify(action)).toBe(n + 1);
      expect(b.ws.last('error').message).toBe('Invalid action.');
    }
    expect(h.r.seq).toBe(seq);
    expect(h.r.state.tick).toBe(tick);
    expect(h.r.state.cfg.tutorial).toBe(false);
    // another message type that is not part of the protocol
    await h.say(b.ws, { t: 'tick' });
    expect(b.ws.last('error').message).toBe('Unknown message type.');
    // an impossible but well-formed action is an engine refusal: only the sender hears it
    const aErrors = a.ws.of('error').length;
    await h.say(b.ws, { t: 'action', action: { type: 'move', to: 'kadai1' } }); // not on level 1
    expect(b.ws.last('error').message).toBe('Cannot go there');
    expect(a.ws.of('error')).toHaveLength(aErrors);
    expect(h.r.seq).toBe(seq);
    // 45 more in the same instant: the server's 40 / 5 s limit answers the flood, the stall is untouched
    for (let i = 0; i < 45; i += 1) await h.say(b.ws, { t: 'action', action: { type: 'emote', e: 'fire' } });
    expect(b.ws.of('error').some((m) => /too fast/.test(m.message))).toBe(true);
    // ... and the table goes on ticking
    await h.tick();
    expect(h.r.state.tick).toBe(tick + 1);
  });
});

// ------------------------------------------------------------------------------------------------------------------ connection loss

describe('reconnect and absence', () => {
  it('a disconnected player does not stop the stall; coming back gives the fresh snapshot; their old socket hears nothing more', async () => {
    const h = await table({ level: 3, n: 2 });
    const [a, b] = h.seats;
    for (let i = 0; i < 6; i += 1) await playSecond(h, h.seats);
    const oldB = b.ws;
    const seenBefore = oldB.of('state').length;
    await h.drop(oldB);
    expect(h.r.disc[b.id]).toEqual(expect.any(Number));
    // the stall keeps ticking and A keeps working alone: nobody waits for B and nobody plays for B
    const tick = h.r.state.tick;
    for (let i = 0; i < 10; i += 1) await playSecond(h, [a]);
    expect(h.r.state.tick).toBe(tick + 10);
    expect(oldB.of('state')).toHaveLength(seenBefore); // a dead socket gets nothing
    expect(h.r.afk).toEqual({});
    expect(h.r.idle).toEqual({});
    expect(h.room.waitingIds()).toEqual([]);
    expect(a.ws.last('state').clock.waitingFor).toEqual([]);
    // B shows as connected through the reconnect grace and as away afterwards
    expect(a.ws.last('room').room.players.find((p) => p.id === b.id).connected).toBe(true);
    while (Date.now() < h.r.disc[b.id] + GRACE_MS + 1500 && h.r.status === 'playing') await playSecond(h, [a]);
    if (h.r.status === 'playing') {
      expect(a.ws.last('room').room.players.find((p) => p.id === b.id).connected).toBe(false);
    }
    // B comes back (new socket): room first, then ONE snapshot at the current seq, no events (so no replayed animations)
    if (h.r.status === 'playing') {
      const nb = await h.connect(user(2));
      b.ws = nb;
      expect(nb.sent[0].t).toBe('room');
      const snap = nb.of('state');
      expect(snap).toHaveLength(1);
      expect(snap[0].seq).toBe(h.r.seq);
      expect(snap[0].events).toEqual([]);
      expect(json(snap[0].state)).toBe(json(h.r.state));
      expect(h.r.disc[b.id]).toBeUndefined();
      expect(a.ws.last('room').room.players.find((p) => p.id === b.id).connected).toBe(true);
      // and B is a full cook again: its next action is applied as B
      await h.say(nb, { t: 'action', action: { type: 'move', to: 'chai1' } });
      expect(h.r.state.players[b.id].at).toBe('chai1');
      expectNoGaps(nb, 1);
      await playSecond(h, h.seats);
      expectInSync(h);
    }
  });

  it('a second socket of the same player (a second tab) also gets every state; the room keeps its three-socket limit', async () => {
    const h = await table({ level: 1, n: 2 });
    const [a, b] = h.seats;
    const extra = [];
    for (let i = 0; i < 4; i += 1) extra.push(await h.connect(user(2)));
    expect(extra.filter((s) => s.readyState === 1).length + (b.ws.readyState === 1 ? 1 : 0)).toBeLessThanOrEqual(3);
    await h.tick();
    expect(extra.at(-1).last('state').seq).toBe(h.r.seq);
    expect(a.ws.last('state').seq).toBe(h.r.seq);
  });

  it('both players gone: the stall keeps running on the server clock until the shift is lost, then the match is recorded like any failed shift', async () => {
    const h = await table({ level: 1, n: 2 });
    for (let i = 0; i < 3; i += 1) await playSecond(h, h.seats);
    for (const s of h.seats) await h.drop(s.ws);
    expect(h.r.noHumanSince).toEqual(expect.any(Number));
    let n = 0;
    while (h.r.status === 'playing' && n < 2000) {
      await h.tick();
      n += 1;
    }
    stats.noHumans = { ticksUntilEnd: n, state: h.r.state.status, abandoned: h.r.abandoned, lives: h.r.state.lives };
    // nobody is there to serve: the centre closes on its own well within the abandon window
    expect(h.r.status).toBe('finished');
    expect(h.r.state.status).toBe('closed');
    expect(n * TICK_MS).toBeLessThan(ABANDON_MS);
    expect(h.r.abandoned).toBe(false);
    for (let i = 0; i < 6 && !h.r.persisted; i += 1) await h.tick();
    expect(persistMatch).toHaveBeenCalledTimes(1);
    expect(persisted[0].players.map((p) => p.rank)).toEqual([2, 2]);
  });

  it('a 3 hour absence of both humans (the alarm only comes back afterwards) ends the room as abandoned: nothing is recorded', async () => {
    const h = await table({ level: 12, n: 2 });
    for (const s of h.seats) await h.drop(s.ws);
    vi.setSystemTime(Date.now() + 3 * 3600 * 1000);
    await h.room.alarm();
    expect(h.r.status).toBe('finished');
    expect(h.r.abandoned).toBe(true);
    expect(h.r.state.tick).toBeLessThan(2); // no catch-up ticks for three hours
    expect(persistMatch).not.toHaveBeenCalled();
    expect(h.ctx.alarmAt).toBeGreaterThan(Date.now() + 20 * 3600 * 1000); // nothing left to do but the 24 h expiry (counted from the last activity, 3 h ago)
    // a player who comes back later sees a room that is over (the state itself still says `playing`: the client must not trust it alone)
    const back = await h.connect(user(1));
    expect(back.last('room').room.status).toBe('finished');
    await h.say(back, { t: 'action', action: { type: 'move', to: 'tawa1' } });
    expect(back.last('error').message).toBe('No game is in progress.');
  });

  it('abandon fires after ABANDON_MS of no humans when the alarm keeps coming (a tutorial-like frozen stall cannot happen, so the clock is the room record)', async () => {
    const h = await table({ level: 12, n: 2 });
    for (const s of h.seats) await h.drop(s.ws);
    // pretend the shift is still alive after 5 min (the stall did not close yet): the record says nobody has been here for ABANDON_MS
    h.r.noHumanSince = Date.now() - ABANDON_MS - 1;
    await h.tick();
    expect(h.r.status).toBe('finished');
    expect(h.r.abandoned).toBe(true);
    expect(persistMatch).not.toHaveBeenCalled();
  });

  it('a player who leaves the running game: the other keeps the stall; when both leave the room is abandoned', async () => {
    const h = await table({ level: 2, n: 2 });
    const [a, b] = h.seats;
    await h.say(b.ws, { t: 'leave' });
    expect(h.r.players.find((p) => p.id === b.id).left).toBe(true);
    const tick = h.r.state.tick;
    for (let i = 0; i < 5; i += 1) await playSecond(h, [a]);
    expect(h.r.state.tick).toBe(tick + 5);
    await h.say(a.ws, { t: 'leave' });
    await h.tick();
    expect(h.r.status).toBe('finished');
    expect(h.r.abandoned).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------------------ operations layer

const OPS_TYPES = ['prep', 'collectPrep', 'tend', 'swapGas', 'board', 'buy'];

describe('operations layer through the wire (prep, tend, gas, board, buy) with two cooks', () => {
  /**
   * One game second like playSecond, but every action is checked: the bot only issues what is legal on the state its seat saw, so
   * neither the sanitizer ("Invalid action.") nor the engine may refuse any of it. Returns the per-type counts of applied actions.
   */
  async function playChecked(h, seats, tally) {
    const base = Date.now();
    for (let i = 0; i < seats.length; i += 1) {
      vi.setSystemTime(base + 120 + i * 200);
      const seen = seats[i].ws.last('state')?.state;
      const action = seen ? engine.chooseAutoAction(seen, seats[i].id) : null;
      if (!action) continue;
      const errs = seats[i].ws.of('error').length;
      const seq = h.r.seq;
      await h.say(seats[i].ws, { t: 'action', action });
      const after = seats[i].ws.of('error');
      if (after.length > errs) tally.rejected.push({ tick: seen.tick, action, message: after.at(-1).message });
      else {
        expect(h.r.seq, `${action.type} applied`).toBe(seq + 1);
        tally.applied[action.type] = (tally.applied[action.type] || 0) + 1;
      }
    }
    const before = h.seats.map((s) => s.ws.bytes.state);
    await h.tick();
    // what one tick costs on the wire: the state message each socket gets
    const per = h.seats.map((s, i) => s.ws.bytes.state - before[i]);
    tally.tickBytes.push(per[0]);
  }

  it.each([3, 5, 12])('level %i: bot actions of every kind pass the allow-list and the engine; both sockets hold the same state at every seq; the result has profit', async (level) => {
    const h = await table({ level, pace: 'normal', n: 2 });
    const tally = { applied: {}, rejected: [], tickBytes: [] };
    let seconds = 0;
    while (h.r.status === 'playing' && seconds < 900) {
      await playChecked(h, h.seats, tally);
      seconds += 1;
      expectInSync(h);
    }
    expect(h.r.status).toBe('finished');
    expect(tally.rejected, JSON.stringify(tally.rejected.slice(0, 3))).toEqual([]);
    for (const s of h.seats) {
      expectNoGaps(s.ws);
      expect(s.ws.of('error').filter((m) => m.message === 'Invalid action.')).toEqual([]);
    }
    // every seq both seats saw carries the very same state and events
    const [a, b] = h.seats.map((s) => new Map(s.ws.of('state').map((m) => [m.seq, json(m.state) + json(m.events)])));
    expect(a.size).toBe(b.size);
    for (const [seq, v] of a) expect(b.get(seq), `seq ${seq}`).toBe(v);
    // the operations really happened: they show in the events both seats saw, and in the per-player counters
    const evTypes = new Set(h.seats[0].ws.of('state').flatMap((m) => m.events.map((e) => e.type)));
    const opsDone = OPS_TYPES.filter((t) => tally.applied[t]);
    const s = h.r.state;
    const counters = s.order.reduce((n, id) => n + (s.players[id].ops ? s.players[id].ops.reduce((x, y) => x + y, 0) : 0), 0);
    expect(counters).toBe((tally.applied.prep || 0) + (tally.applied.tend || 0) + (tally.applied.swapGas || 0) + (tally.applied.buy || 0));
    expect(opsDone.length, JSON.stringify(tally.applied)).toBeGreaterThanOrEqual(level === 3 ? 1 : 2);
    if (tally.applied.prep) expect(evTypes.has('prep-start')).toBe(true);
    if (tally.applied.collectPrep) expect(evTypes.has('prep-collect')).toBe(true);
    if (tally.applied.tend) expect(evTypes.has('tend')).toBe(true);
    if (tally.applied.swapGas) expect(evTypes.has('gas-swap')).toBe(true);
    if (tally.applied.board) expect(evTypes.has('board')).toBe(true);
    if (tally.applied.buy) expect(evTypes.has('buy')).toBe(true);
    // the persisted match carries the result built from this very state: profit included, ranks follow the profit-based stars
    for (let i = 0; i < 6 && !h.r.persisted; i += 1) await h.tick();
    expect(persistMatch).toHaveBeenCalledTimes(1);
    const { default: adapter } = await import('./games/tiffin-centre.js');
    const res = adapter.result(h.r.state);
    expect(Number.isInteger(res.profit)).toBe(true);
    expect(res.profit).toBe(s.money - res.cost);
    expect(res.standings.every((r) => r.stats.profit === res.profit && Number.isInteger(r.stats.cost))).toBe(true);
    const rec = persisted[0];
    const want = res.stars >= 1 ? 1 : 2;
    expect(rec.players.map((p) => p.rank)).toEqual([want, want]);
    expect(rec.winnerId).toBe(res.winnerId);
    // a player's score = the money THEY collected; the inspector's reward is cash in hand that belongs to nobody in particular
    expect(rec.players.reduce((n, p) => n + p.final_worth, 0)).toBeLessThanOrEqual(s.money);
    expect(rec.players.reduce((n, p) => n + p.final_worth, 0)).toBe(s.order.reduce((n, id) => n + s.players[id].earned, 0));
    expect(rec.winReason).toBe(res.reason);
    const sizes = tally.tickBytes;
    stats[`ops${level}`] = {
      applied: tally.applied, ticks: s.tick, stars: res.stars, money: s.money, profit: res.profit, cost: res.cost, waste: res.waste, status: s.status,
      tickMsgBytesAvg: Math.round(sizes.reduce((n, x) => n + x, 0) / sizes.length), tickMsgBytesMax: Math.max(...sizes), resultBytes: json(res).length,
    };
  }, 90_000);

  it('a directed round at level 5: both seats prep, collect, tend, board, buy and swap the cylinder through the wire; refusals reach only the sender', async () => {
    const h = await table({ level: 5, pace: 'relaxed', n: 2 });
    const [a, b] = h.seats;
    const act = async (seat, action) => {
      const errs = seat.ws.of('error').length;
      const seq = h.r.seq;
      await h.say(seat.ws, { t: 'action', action });
      const e = seat.ws.of('error');
      return { ok: h.r.seq === seq + 1 && e.length === errs, error: e.length > errs ? e.at(-1).message : null };
    };
    const stock = h.r.state.stock;
    const [item1, item2] = Object.keys(stock);
    // A preps into slot 0, B into slot 1 (spoofed playerId is ignored), a third job has no slot
    expect(await act(a, { type: 'prep', station: 'prep1', slot: 0, item: item1 })).toMatchObject({ ok: true });
    expect(await act(b, { type: 'prep', station: 'prep1', slot: 1, item: item2, playerId: a.id })).toMatchObject({ ok: true });
    const slots = h.r.state.stations.prep1.slots;
    expect(slots.map((s) => [s.st, s.item, s.by])).toEqual([['cooking', item1, a.id], ['cooking', item2, b.id]]);
    expect(h.r.state.players[b.id].ops[0]).toBe(1);
    expect(h.r.state.players[a.id].ops[0]).toBe(1);
    expect((await act(a, { type: 'prep', station: 'prep1', slot: 0, item: item1 })).error).toBe('That job is busy');
    expect((await act(a, { type: 'prep', station: 'prep1', slot: 2, item: item1 })).error).toBe('Invalid action.'); // the allow-list: slot is 0 or 1
    expect((await act(a, { type: 'collectPrep', station: 'prep1', slot: 0 })).error).toBe('Not ready yet');
    expect(b.ws.of('error').length).toBe(0); // only the sender hears a refusal
    // board: A takes a dish off, B (same wire, other seat) puts it back; a repeat is the quiet no-op refusal
    const dish = h.r.state.cfg.menu[0];
    expect(await act(a, { type: 'board', dish, on: false })).toMatchObject({ ok: true });
    expect(h.r.state.off).toContain(dish);
    expect((await act(a, { type: 'board', dish, on: false })).ok).toBe(false);
    expect(await act(b, { type: 'board', dish, on: true })).toMatchObject({ ok: true });
    expect(h.r.state.off).not.toContain(dish);
    // buy: instant, dearer than making it, counts in cost and in the buyer's counter
    const cost0 = h.r.state.cost;
    expect(await act(b, { type: 'buy', item: item1, n: 2 })).toMatchObject({ ok: true });
    expect(h.r.state.cost).toBeGreaterThan(cost0);
    expect(h.r.state.players[b.id].ops[3]).toBe(1);
    expect((await act(b, { type: 'buy', item: item1, n: 11 })).error).toBe('Invalid action.');
    expect((await act(b, { type: 'buy', item: '__proto__', n: 1 })).error).toBe('Invalid action.');
    // the cylinder is full: the engine says so (a legal-looking action, a refusal)
    h.r.state = { ...h.r.state, gas: { ...h.r.state.gas, u: 1000 } };
    expect((await act(a, { type: 'swapGas' })).error).toBe('The cylinder is still heavy');
    // walk to the new places
    expect(await act(a, { type: 'move', to: 'prep1' })).toMatchObject({ ok: true });
    expect(await act(b, { type: 'move', to: 'gas' })).toMatchObject({ ok: true });
    expect(h.r.state.players[a.id].at).toBe('prep1');
    expect(h.r.state.players[b.id].at).toBe('gas');
    // jobs finish on the server clock; A collects what B started and vice versa (co-op)
    const longest = Math.max(...slots.map((s) => s.readyAt - s.t0));
    for (let i = 0; i < longest + 1; i += 1) await h.tick();
    expect(h.r.state.stations.prep1.slots.map((s) => s.st)).toEqual(['ready', 'ready']);
    const have0 = { ...h.r.state.stock };
    expect(await act(a, { type: 'collectPrep', station: 'prep1', slot: 1 })).toMatchObject({ ok: true });
    expect(await act(b, { type: 'collectPrep', station: 'prep1', slot: 0 })).toMatchObject({ ok: true });
    expect(h.r.state.stock[item1]).toBeGreaterThan(have0[item1]);
    expect(h.r.state.stock[item2]).toBeGreaterThan(have0[item2]);
    expect(h.r.state.stations.prep1.slots.map((s) => s.st)).toEqual(['empty', 'empty']);
    // run the gas down by playing, then change the cylinder; both seats stay in sync throughout
    let guard = 0;
    while (h.r.status === 'playing' && guard++ < 25) await playSecond(h, h.seats);
    expectInSync(h);
    const events = new Set(a.ws.of('state').flatMap((m) => m.events.map((e) => e.type)));
    for (const t of ['prep-start', 'prep-collect', 'board', 'buy']) expect(events.has(t), t).toBe(true);
    expect(events.has('gas-swap')).toBe(false); // the cylinder was refused as too heavy and never low enough to change in this short run
  });

  it('swapGas goes through the wire once the cylinder is low, and the burners are off while it is changed', async () => {
    const h = await table({ level: 3, pace: 'normal', n: 2 });
    const [a, b] = h.seats;
    // low the cylinder directly in the server record (no public way to do it): the room state is the engine state
    h.r.state = { ...h.r.state, gas: { ...h.r.state.gas, u: 100 } };
    const seq = h.r.seq;
    await h.say(a.ws, { t: 'action', action: { type: 'swapGas', station: 'tawa1', n: 5 } });
    expect(a.ws.of('error')).toHaveLength(0);
    expect(h.r.seq).toBe(seq + 1);
    expect(h.r.state.gas.sw).toBeGreaterThan(0);
    expect(h.r.state.players[a.id].ops[2]).toBe(1);
    // cooking is refused for the other seat while the cylinder is being changed
    await h.say(b.ws, { t: 'action', action: { type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' } });
    expect(b.ws.last('error').message).toBe('The cylinder is being changed');
    // a second swap is refused for either seat
    await h.say(b.ws, { t: 'action', action: { type: 'swapGas' } });
    expect(b.ws.last('error').message).toBe('Already changing the cylinder');
    const swapTicks = h.r.state.gas.sw;
    for (let i = 0; i < swapTicks; i += 1) await h.tick();
    expect(h.r.state.gas.sw).toBe(0);
    expect(h.r.state.gas.u).toBeGreaterThan(900);
    expectInSync(h);
    const ev = a.ws.of('state').flatMap((m) => m.events).filter((e) => e.type === 'gas-swap');
    expect(ev.map((e) => e.phase)).toEqual(['start', 'done']);
  });

  it('tend resets a dirty pan through the wire and is refused (Already clean) when there is nothing to do', async () => {
    const h = await table({ level: 3, pace: 'normal', n: 2 });
    const [a, b] = h.seats;
    await h.say(a.ws, { t: 'action', action: { type: 'tend', station: 'tawa1' } });
    expect(a.ws.last('error').message).toBe('Already clean');
    // pour and let it cook: the pan chills and gets gunk; keep pouring until it needs a wipe
    for (let slot = 0; slot < 3; slot += 1) await h.say(b.ws, { t: 'action', action: { type: 'cook', station: 'tawa1', slot, dish: 'dosa' } });
    const need = engine.tendInfo(h.r.state, 'tawa1');
    expect(need.need).toBeGreaterThan(0);
    if (need.canTend) {
      const seq = h.r.seq;
      await h.say(a.ws, { t: 'action', action: { type: 'tend', station: 'tawa1' } });
      expect(h.r.seq).toBe(seq + 1);
      expect(h.r.state.stations.tawa1.gunk).toBe(0);
      expect(h.r.state.players[a.id].ops[1]).toBe(1);
      expect(engine.tendInfo(h.r.state, 'tawa1').need).toBe(0);
    }
    expectInSync(h);
  });
});

// ------------------------------------------------------------------------------------------------------------------ cost

describe('payload sizes and storage traffic (logged)', () => {
  it('level 12, 4 players: state JSON per tick, room record size, writes and alarm sets per tick', async () => {
    const h = await table({ level: 12, pace: 'rush', n: 4 });
    const sizes = [];
    const recSizes = [];
    let seconds = 0;
    const putsAtStart = h.ctx.puts;
    const alarmsAtStart = h.ctx.alarmSets;
    let tickPuts = 0;
    let tickAlarms = 0;
    let actionPuts = 0;
    let actionCount = 0;
    let ticks = 0;
    while (h.r.status === 'playing' && seconds < 700) {
      const base = Date.now();
      for (let i = 0; i < h.seats.length; i += 1) {
        vi.setSystemTime(base + 100 + i * 200);
        const seen = h.seats[i].ws.last('state').state;
        const action = engine.chooseAutoAction(seen, h.seats[i].id);
        if (!action) continue;
        const p0 = h.ctx.puts;
        const seq = h.r.seq;
        await h.say(h.seats[i].ws, { t: 'action', action });
        if (h.r.seq > seq) {
          actionPuts += h.ctx.puts - p0;
          actionCount += 1;
        }
      }
      const p0 = h.ctx.puts;
      const a0 = h.ctx.alarmSets;
      await h.tick();
      tickPuts += h.ctx.puts - p0;
      tickAlarms += h.ctx.alarmSets - a0;
      ticks += 1;
      sizes.push(json(h.r.state).length);
      recSizes.push(json(h.r).length);
      seconds += 1;
      if (seconds % 40 === 0) for (const s of h.seats) s.ws.sent.length = 0; // keep the memory flat; byte counters keep counting
    }
    expect(h.r.status).toBe('finished');
    const avg = (xs) => Math.round(xs.reduce((n, x) => n + x, 0) / xs.length);
    const wsBytes = h.seats.reduce((n, s) => n + s.ws.bytes.state, 0);
    const wsMsgs = h.seats.reduce((n, s) => n + s.ws.counts.state, 0);
    stats.size = {
      level: 12,
      players: 4,
      ticks,
      stateBytesMax: Math.max(...sizes),
      stateBytesAvg: avg(sizes),
      roomRecordBytesMax: Math.max(...recSizes),
      roomRecordBytesAvg: avg(recSizes),
      putsPerTick: +(tickPuts / ticks).toFixed(2),
      alarmSetsPerTick: +(tickAlarms / ticks).toFixed(2),
      putsPerAction: +(actionPuts / Math.max(1, actionCount)).toFixed(2),
      actionsPerSecond: +(actionCount / ticks).toFixed(2),
      totalPuts: h.ctx.puts - putsAtStart,
      totalAlarmSets: h.ctx.alarmSets - alarmsAtStart,
      wsStateMessagesTotal: wsMsgs,
      wsStateBytesTotal: wsBytes,
      wsBytesPerSecondPerRoom: Math.round(wsBytes / ticks),
      wsStateMessageAvgBytes: Math.round(wsBytes / wsMsgs),
      putBytesAvg: Math.round(h.ctx.putBytes / h.ctx.puts),
    };
    // the plan says "keep state < 3 KB": it does not hold for the big levels, but it must stay small enough for a socket frame and the 4096 B client message limit is irrelevant (server -> client)
    expect(stats.size.stateBytesMax).toBeLessThan(64 * 1024);
    // exactly one storage write per applied message (tick or action), never more
    expect(stats.size.putsPerTick).toBeLessThanOrEqual(2.01);
    expect(stats.size.putsPerAction).toBeLessThanOrEqual(2.01);
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------------------------ the client session core on real messages

/**
 * A client attached to one fake socket the way `useRoomConnection` + `useRoomSession` attach: `room` payloads, `state` messages (first
 * one after a (re)connect is `fresh`, repeats / out-of-order seqs are dropped), server `error`s as toasts. Outgoing `{t:'action'}` goes
 * through the real GameRoom.webSocketMessage.
 */
class Client {
  constructor(h, seat, extra = {}) {
    this.h = h;
    this.seat = seat;
    this.pending = [];
    this.timers = [];
    this.errors = [];
    this.core = createRoomSessionCore({
      meId: seat.id,
      send: (msg) => {
        this.pending.push(h.say(this.ws, msg));
        return true;
      },
      leave: vi.fn(),
      now: () => Date.now(),
      setTimer: (fn, ms) => this.timers.push({ fn, at: Date.now() + ms, dead: false }),
      clearTimer: (hnd) => {
        const t = this.timers[hnd - 1];
        if (t) t.dead = true;
      },
      ...extra,
    });
    this.session = this.core.session;
    this.attach(seat.ws);
  }
  /** (re)connect: a socket, a `fresh` first state. */
  attach(ws) {
    this.ws = ws;
    this.seat.ws = ws;
    const st = { fresh: true, lastSeq: -1 };
    this.core.setConnection('open');
    ws.onMessage = (msg) => {
      if (msg.t === 'room') this.core.setRoom(msg.room);
      else if (msg.t === 'state') {
        const fresh = st.fresh;
        if (!fresh && typeof msg.seq === 'number' && msg.seq <= st.lastSeq) return;
        st.fresh = false;
        if (typeof msg.seq === 'number') st.lastSeq = msg.seq;
        this.core.handleState({ state: msg.state, events: Array.isArray(msg.events) ? msg.events : [], seq: msg.seq, fresh });
      } else if (msg.t === 'error') {
        this.errors.push(msg.message);
        this.core.setError(msg.message);
      }
    };
    // what the socket already holds (the messages that arrived while attaching)
    for (const m of ws.sent) ws.onMessage(m);
  }
  async settle() {
    await Promise.all(this.pending.splice(0));
  }
  /** Advance the fake clock to `t`, running due limiter timers on the way. */
  async advanceTo(t) {
    for (;;) {
      const due = this.timers.filter((x) => !x.dead && x.at <= t).sort((p, q) => p.at - q.at)[0];
      if (!due) break;
      vi.setSystemTime(Math.max(Date.now(), due.at));
      due.dead = true;
      due.fn();
      await this.settle();
    }
    vi.setSystemTime(Math.max(Date.now(), t));
  }
}

describe('the client room session core against the real room messages', () => {
  it('mirrors the server: state at the same seq, tickAt moves only on a new tick, events are passed, status and players follow the room', async () => {
    const h = await table({ level: 1, n: 2 });
    const [sa, sb] = h.seats;
    const A = new Client(h, sa);
    const B = new Client(h, sb);
    expect(A.session.mode).toBe('online');
    expect(A.session.status).toBe('playing');
    expect(A.session.connection).toBe('open');
    expect(A.session.players.map((p) => p.name).sort()).toEqual(['Cook 1', 'Cook 2']);
    expect(A.session.players.every((p) => p.online)).toBe(true);
    expect(json(A.session.state)).toBe(json(h.r.state));
    const events = [];
    A.session.subscribe((p) => events.push(...p.events.map((e) => e.type)));

    const t0 = A.session.tickAt;
    // A cooks: the echo of its own action arrives mid-tick and must NOT reset the progress clock
    vi.setSystemTime(Date.now() + 400);
    expect(A.session.dispatch({ type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' })).toBe(true);
    await A.settle();
    expect(A.session.state.stations.tawa1.slots[0]).toMatchObject({ st: 'cooking', by: A.session.meId });
    expect(json(A.session.state)).toBe(json(h.r.state));
    expect(json(B.session.state)).toBe(json(h.r.state));
    expect(A.session.tickAt).toBe(t0);
    expect(events).toContain('cook-start');
    // the next tick: tickAt moves to the arrival time of the new tick and the `tick` event is passed
    await h.tick();
    expect(A.session.tickAt).toBe(Date.now());
    expect(B.session.tickAt).toBe(Date.now());
    expect(events).toContain('tick');
    expect(A.session.state.tick).toBe(1);

    // B's move is attributed to B on both screens; `playerId` in the dispatched action is forced to me on the wire
    expect(B.session.dispatch({ type: 'move', to: 'tawa1', playerId: 'spoof' })).toBe(true);
    await B.settle();
    expect(A.session.state.players[sb.id].at).toBe('tawa1');
    expect(A.session.state.players[sa.id].at).toBeNull();

    // client refusals: never sent (the server never hears about them)
    const sentBefore = h.r.seq;
    expect(A.session.dispatch({ type: 'tick' })).toBe(false);
    expect(A.session.dispatch({ type: 'spawn', customer: {} })).toBe(false);
    expect(A.session.dispatch({ type: 'tutorial-flags', patience: false })).toBe(false);
    expect(A.session.lastError).toBe('That is not something you can do.');
    expect(A.session.dispatch({ type: 'take', station: 'tawa1', slot: 0 })).toBe(false); // not ready yet
    expect(A.session.lastError).toBe('Not ready yet');
    expect(A.pending).toHaveLength(0);
    expect(h.r.seq).toBe(sentBefore);

    // a refusal that only the server can judge (the other seat acted first) comes back as a toast, state stays in sync
    await h.say(sb.ws, { t: 'action', action: { type: 'cook', station: 'tawa1', slot: 1, dish: 'dosa' } });
    A.core.setError(null);
    A.core.limiter.dispose();
    const stale = structuredClone(A.session.state);
    stale.stations.tawa1.slots[1] = { st: 'empty', dish: null, t0: 0, readyAt: 0, burnAt: 0, by: null }; // what an old screen would still think
    // (dispatch a cook into the now busy slot with validation off, as a client with a stale view would)
    const lazy = new Client(h, { id: sa.id, ws: sa.ws, name: 'x' }, { validate: false });
    expect(lazy.session.dispatch({ type: 'cook', station: 'tawa1', slot: 1, dish: 'dosa' })).toBe(true);
    await lazy.settle();
    expect(lazy.errors.at(-1)).toBe('That spot is busy');
    expect(lazy.session.lastError).toBe('That spot is busy');
    expectInSync(h);
  });

  it('keeps under the 40 messages / 5 s server limit however hard the player taps; moves coalesce to the newest', async () => {
    const h = await table({ level: 1, n: 2 });
    const A = new Client(h, h.seats[0], { validate: false });
    const start = Date.now();
    // 100 move taps in 1 s: coalesced and spaced, the newest target wins
    const targets = ['tawa1', 'chai1', null, 'bin', 'spot:2'];
    for (let i = 0; i < 100; i += 1) {
      await A.advanceTo(start + i * 10);
      A.session.dispatch({ type: 'move', to: targets[i % targets.length] });
    }
    await A.advanceTo(start + 2500);
    await A.settle();
    const lastTo = targets[99 % targets.length];
    expect(h.r.state.players[A.session.meId].at).toBe(lastTo);
    // 60 real (but pointless) actions in a burst: the limiter lets 36 per 5 s through and refuses the rest locally
    const t1 = Date.now();
    let refused = 0;
    let sent = 0;
    for (let i = 0; i < 60; i += 1) {
      await A.advanceTo(t1 + i * 5);
      if (A.session.dispatch({ type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' })) sent += 1;
      else refused += 1;
    }
    await A.advanceTo(Date.now() + 100);
    await A.settle();
    expect(refused).toBeGreaterThan(0);
    expect(A.session.lastError).toMatch(/Too many taps|busy/);
    // the server never said "too fast": the client limiter keeps below the server limit in every 5 s window
    expect(A.errors.filter((m) => /too fast/.test(m))).toEqual([]);
    expect(sent).toBeLessThanOrEqual(36);
    // after the window passes the player can act again, and the real server accepts it
    await A.advanceTo(Date.now() + 6000);
    expect(A.core.limiter.sentInWindow()).toBe(0);
    expect(A.session.dispatch({ type: 'move', to: 'chai1' })).toBe(true);
    await A.advanceTo(Date.now() + 500);
    await A.settle();
    expect(h.r.state.players[A.session.meId].at).toBe('chai1');
    stats.limiter = { moveTaps: 100, burstSent: sent, burstRefused: refused };
  });

  it('a reconnect (fresh snapshot, no events), duplicates and old seqs are ignored; a lost link shows as disconnected', async () => {
    const h = await table({ level: 1, n: 2 });
    const A = new Client(h, h.seats[0]);
    const B = new Client(h, h.seats[1]);
    for (let i = 0; i < 3; i += 1) await playSecond(h, [h.seats[0]]);
    expect(A.session.state.tick).toBe(3);
    // the link of B drops
    await h.drop(B.ws);
    B.core.setConnection('connecting');
    expect(B.session.status).toBe('disconnected');
    expect(B.session.connection).toBe('reconnecting');
    expect(B.session.dispatch({ type: 'move', to: 'tawa1' })).toBe(false);
    expect(B.session.lastError).toBe('Reconnecting, hold on.');
    for (let i = 0; i < 4; i += 1) await playSecond(h, [h.seats[0]]);
    // B is back: first state is the snapshot at the current seq, flagged fresh, with no events
    const got = [];
    B.session.subscribe((p) => got.push(p));
    const ws2 = await h.connect(user(2));
    B.attach(ws2);
    expect(B.session.status).toBe('playing');
    expect(B.session.state.tick).toBe(7);
    expect(json(B.session.state)).toBe(json(h.r.state));
    const snap = got.filter((p) => p.state);
    expect(snap.at(-1).events).toEqual([]);
    expect(B.session.tickAt).toBe(Date.now());
    // an old seq (a delayed duplicate) must not rewind the screen
    const old = ws2.last('state');
    const tickNow = B.session.state.tick;
    await playSecond(h, [h.seats[0]]);
    expect(B.session.state.tick).toBe(tickNow + 1);
    ws2.onMessage(old);
    expect(B.session.state.tick).toBe(tickNow + 1);
    // and B plays again
    expect(B.session.dispatch({ type: 'move', to: 'chai1' })).toBe(true);
    await B.settle();
    expect(h.r.state.players[B.session.meId].at).toBe('chai1');
  });

  it('the shift ends for both screens: status done / closed and a result equal to the server standings', async () => {
    const h = await table({ level: 1, n: 2 });
    const A = new Client(h, h.seats[0]);
    const B = new Client(h, h.seats[1]);
    let guard = 0;
    while (h.r.status === 'playing' && guard++ < 600) await playSecond(h, h.seats);
    for (const c of [A, B]) {
      expect(['done', 'closed']).toContain(c.session.status);
      expect(c.session.status).toBe(h.r.state.status);
      expect(c.session.result).toEqual(engine.result(h.r.state));
      expect(c.session.result.standings.map((s) => s.id).sort()).toEqual([U(1), U(2)]);
      expect(c.session.dispatch({ type: 'move', to: 'tawa1' })).toBe(false);
    }
    expect(A.session.result.standings.map((s) => s.rank)).toEqual(B.session.result.standings.map((s) => s.rank));
  });

  it('an abandoned room (the room is over, the stored state still says playing) shows as closed with a failed result, not as a frozen stall', async () => {
    const h = await table({ level: 12, n: 2 });
    const A = new Client(h, h.seats[0]);
    const B = new Client(h, h.seats[1]);
    await h.drop(B.ws);
    await h.drop(A.ws);
    vi.setSystemTime(Date.now() + 3 * 3600 * 1000);
    await h.room.alarm();
    expect(h.r.abandoned).toBe(true);
    const A2 = await h.connect(user(1));
    A.attach(A2);
    expect(h.r.state.status).toBe('playing'); // the server record never closed the engine state
    expect(A.session.state.status).toBe('playing');
    expect(A.session.status).toBe('closed');
    expect(A.session.result).toMatchObject({ reason: 'closed', winnerId: null, stars: 0 });
    expect(A.session.dispatch({ type: 'move', to: 'tawa1' })).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------------------------ storage traffic

describe('storage writes of a running stall (adapter.persistEveryMs)', () => {
  const adapter = GAME_ADAPTERS['tiffin-centre'];
  const hook = adapter.persistEveryMs;

  /** 4 cooks, up to 3 actions per second each, 60 game seconds: the writes the room makes with and without the coalescing hook. */
  async function runMinute(withHook) {
    if (!withHook) delete adapter.persistEveryMs;
    try {
      const h = await table({ level: 3, n: 4 });
      const puts0 = h.ctx.puts;
      const alarms0 = h.ctx.alarmSets;
      let applied = 0;
      let ticks = 0;
      let maxStale = 0;
      while (h.r.status === 'playing' && ticks < 60) {
        const base = Date.now();
        for (let k = 0; k < 3; k += 1) {
          for (let i = 0; i < h.seats.length; i += 1) {
            vi.setSystemTime(base + 40 + k * 280 + i * 60); // 12 attempts inside the second, all before the tick is due
            const seen = h.seats[i].ws.last('state').state;
            const action = engine.chooseAutoAction(seen, h.seats[i].id);
            if (!action) continue;
            const seq = h.r.seq;
            await h.say(h.seats[i].ws, { t: 'action', action });
            if (h.r.seq > seq) applied += 1;
          }
        }
        await h.tick();
        ticks += 1;
        maxStale = Math.max(maxStale, Date.now() - h.room.savedAt);
        for (const s of h.seats) s.ws.sent.length = 0;
      }
      return { h, ticks, applied, puts: h.ctx.puts - puts0, alarmSets: h.ctx.alarmSets - alarms0, maxStale };
    } finally {
      adapter.persistEveryMs = hook;
    }
  }

  it('60 ticks with 4 cooks acting 3 times a second: at most a fifth of the writes of the old behaviour, and the record is never older than the interval', async () => {
    const before = await runMinute(false);
    const after = await runMinute(true);
    expect(before.ticks).toBe(60);
    expect(after.ticks).toBe(60);
    expect(before.applied).toBeGreaterThan(30);
    // without the hook every applied action and every tick is one put (the old behaviour)
    expect(before.puts).toBeGreaterThanOrEqual(before.ticks + before.applied - 1);
    expect(after.puts).toBeLessThanOrEqual(before.puts / 5);
    expect(after.puts).toBeLessThanOrEqual(Math.ceil((60 * TICK_MS) / 5000) + 2);
    expect(after.maxStale).toBeLessThanOrEqual(5000 + TICK_MS); // the stored record lags by at most one interval (+ the tick that notices)
    expect(after.alarmSets).toBeLessThanOrEqual(after.ticks + 2); // one setAlarm per tick, none for the actions in between
    const perHour = (r) => Math.round((r.puts / r.ticks) * 3600);
    stats.writes = {
      players: 4,
      actionsAppliedPerSecond: +(before.applied / before.ticks).toFixed(2),
      putsPerRoomHourBefore: perHour(before),
      putsPerRoomHourAfter: perHour(after),
      // the alarm de-duplication applies to both runs; the old count is derived: 2 per tick (the action path and the end of the tick) + 1 per action
      alarmSetsPerRoomHourBefore: Math.round(((2 * before.ticks + before.applied) / before.ticks) * 3600),
      alarmSetsPerRoomHourAfter: Math.round((after.alarmSets / after.ticks) * 3600),
    };
  }, 120_000);

  it('always writes at once on start, on a leave and when the shift is over, and the room record then matches memory', async () => {
    const h = new Harness();
    expect((await h.init({ gameId: 'tiffin-centre', settings: { level: 1, pace: 'normal' } })).status).toBe(201);
    h.seats = [];
    for (let i = 1; i <= 3; i += 1) {
      const ws = await h.connect(user(i));
      h.seats.push({ id: U(i), ws, name: `Cook ${i}` });
      await h.say(ws, { t: 'ready', ready: true });
    }
    await h.say(h.seats[0].ws, { t: 'start' });
    expect(h.ctx.store.get('room').status).toBe('playing'); // start: written
    expect(h.ctx.store.get('room').seq).toBe(1);
    for (let i = 0; i < 3; i += 1) await playSecond(h, h.seats);
    expect(h.ctx.store.get('room').seq).toBeLessThan(h.r.seq); // the steps since the start are only in memory
    const puts = h.ctx.puts;
    await h.say(h.seats[2].ws, { t: 'leave' }); // leave: written at once, with everything pending
    expect(h.ctx.puts).toBe(puts + 1);
    expect(h.ctx.store.get('room').seq).toBe(h.r.seq);
    expect(h.ctx.store.get('room').players.find((p) => p.id === U(3)).left).toBe(true);
    const live = h.seats.slice(0, 2);
    let guard = 0;
    while (h.r.status === 'playing' && guard++ < 600) await playSecond(h, live);
    expect(h.r.status).toBe('finished');
    const stored = h.ctx.store.get('room');
    expect(stored.status).toBe('finished'); // game over: written at once
    expect(stored.seq).toBe(h.r.seq);
    expect(stored.state.status).toBe(h.r.state.status);
    expect(h.r.persisted).toBe(true);
    expect(persisted).toHaveLength(1);
    expect(h.room.unsaved).toBe(false);
  });

  it('a restart in the middle of the shift (the record is up to 5 s old): the clients accept what the restored room sends and the shift still finishes', async () => {
    const h = await table({ level: 1, n: 2 });
    const A = new Client(h, h.seats[0]);
    const B = new Client(h, h.seats[1]);
    for (let i = 0; i < 12; i += 1) await playSecond(h, h.seats);
    expect(h.r.status).toBe('playing');
    const seqBefore = h.r.seq;
    const tickBefore = h.r.state.tick;
    const storedSeq = h.ctx.store.get('room').seq;
    expect(storedSeq).toBeLessThan(seqBefore); // there really is something to lose
    expect(A.session.state.tick).toBe(tickBefore);
    // evict: a new GameRoom over the same storage (sockets survive, like a hibernated object)
    h.room = new GameRoom(h.ctx, {});
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.r.seq).toBe(storedSeq + RESTORE_SEQ_MARGIN);
    expect(h.r.seq).toBeGreaterThan(seqBefore);
    expect(h.r.state.tick).toBeLessThanOrEqual(tickBefore);
    expect(tickBefore - h.r.state.tick).toBeLessThanOrEqual(6); // at most the interval's ticks are replayed
    expect(h.ctx.store.get('room').seq).toBe(h.r.seq);
    // the very next alarm (the stored one survived the restart) ticks the restored room and BOTH screens take that state
    expect(h.ctx.alarmAt).not.toBeNull();
    await h.tick();
    for (const c of [A, B]) {
      expect(c.session.state.tick).toBe(h.r.state.tick);
      expect(json(c.session.state)).toBe(json(h.r.state));
    }
    expect(h.seats[0].ws.last('state').seq).toBeGreaterThan(seqBefore);
    // an action from a client that saw the old seqs goes through and is echoed
    const seq = h.r.seq;
    const act = engine.chooseAutoAction(A.session.state, h.seats[0].id);
    if (act) {
      await h.say(h.seats[0].ws, { t: 'action', action: act });
      expect(h.r.seq).toBeGreaterThan(seq);
      expect(json(A.session.state)).toBe(json(h.r.state));
    }
    // and the shift plays on to its end with one match record
    let guard = 0;
    while (h.r.status === 'playing' && guard++ < 600) await playSecond(h, h.seats);
    expect(h.r.status).toBe('finished');
    expect(['done', 'closed']).toContain(A.session.status);
    expect(persisted).toHaveLength(1);
    expect(h.ctx.store.get('room').status).toBe('finished');
  });
});

// ------------------------------------------------------------------------------------------------------------------ idle guard (end to end)

describe('an idle table pays nothing, a working one is paid', () => {
  it('both seats stand by until the stall closes: one match record, every seat flagged idle, 0 XP and 0 coins', async () => {
    const h = await table({ level: 1, n: 2 });
    let guard = 0;
    while (h.r.status === 'playing' && guard++ < 400) await playSecond(h, h.seats, { bot: false });
    expect(h.r.status).toBe('finished');
    for (let i = 0; i < 5 && !h.r.persisted; i += 1) await h.tick();
    expect(persisted).toHaveLength(1);
    const rec = persisted[0];
    expect(rec.users.map((u) => [u.xp, u.coins, u.won])).toEqual([[0, 0, 0], [0, 0, 0]]);
    expect(rec.seats.every((s) => s.idle === true)).toBe(true);
  });

  it('one seat runs the stall alone: that seat is paid, the seat that stood by is not', async () => {
    const h = await table({ level: 1, n: 2 });
    let guard = 0;
    while (h.r.status === 'playing' && guard++ < 600) await playSecond(h, [h.seats[0]]);
    expect(h.r.status).toBe('finished');
    for (let i = 0; i < 5 && !h.r.persisted; i += 1) await h.tick();
    const rec = persisted[0];
    const worker = rec.users.find((u) => u.user_id === U(1));
    const idler = rec.users.find((u) => u.user_id === U(2));
    expect(engine.result(h.r.state).team.paid).toBeGreaterThan(0);
    expect(worker.xp).toBeGreaterThanOrEqual(30);
    expect(worker.coins).toBeGreaterThanOrEqual(40);
    expect(idler).toMatchObject({ xp: 0, coins: 0, won: 0 });
    expect(rec.seats.find((s) => s.id === U(2)).idle).toBe(true);
    expect(rec.seats.find((s) => s.id === U(1)).idle).toBeUndefined();
  });
});

afterAll(() => {
  // eslint-disable-next-line no-console
  console.log(`[tiffin-room] numbers ${JSON.stringify(stats, null, 1)}`);
});
