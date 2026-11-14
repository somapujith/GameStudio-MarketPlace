// GameRoom wire additions (docs/HUSTLE_PLAN.md 3.9): the decision clock in every `state`, presence
// with the reconnect grace, lobby pieces, and cosmetics in `room.players`. Driven through a tiny
// test game ("Piece Race") so nothing here depends on Hyderabad Tycoon's rules.
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

const equipped = { value: {}, fail: false, calls: 0 };
vi.mock('./roomsdb.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasDb: (env) => !!env && !!env.DATABASE_URL,
  upsertRoomRow: vi.fn(async () => {}),
  deleteRoomRow: vi.fn(async () => {}),
  loadEquipped: vi.fn(async () => {
    equipped.calls += 1;
    if (equipped.fail) throw new Error('neon down');
    return equipped.value;
  }),
}));

const { GameRoom, TURN_MS, GRACE_MS, pieceIds } = await import('./GameRoom.js');
const { GAME_ADAPTERS } = await import('./games/index.js');

// ---- the test game -------------------------------------------------------------------------------

const START_ANIM = 1000;
const STEP_ANIM = 500;
const created = [];

const pieceRace = {
  id: 'piece-race',
  name: 'Piece Race',
  minPlayers: 2,
  maxPlayers: 3,
  defaultMaxPlayers: 3,
  defaultSettings: { target: 3 },
  pieces: ['red', 'blue', 'green'],
  startAnimMs: START_ANIM,
  validateSettings: (raw) => ({ ok: true, settings: { target: (raw && raw.target) || 3 } }),
  createGame({ players, settings }) {
    created.push(players);
    return { phase: 'play', turn: 0, target: settings.target, players: players.map((p) => ({ id: p.id, piece: p.piece ?? null, count: 0 })) };
  },
  applyAction(state, action) {
    if (state.phase !== 'play') return { state, events: [], error: 'Over.' };
    if (action.playerId !== state.players[state.turn].id) return { state, events: [], error: 'Not your turn.' };
    const s = structuredClone(state);
    s.players[s.turn].count += 1;
    const events = [{ type: 'step', player: action.playerId }];
    if (s.players[s.turn].count >= s.target) s.phase = 'over';
    else s.turn = (s.turn + 1) % s.players.length;
    return { state: s, events };
  },
  animationMs: () => STEP_ANIM,
  turnPlayerId: (s) => (s.phase === 'play' ? s.players[s.turn].id : null),
  deadlines: () => [],
  idleAction: (s, id) => (s.phase === 'play' && s.players[s.turn].id === id ? { type: 'STEP', playerId: id } : null),
  isOver: (s) => s.phase === 'over',
  result: (s) => ({ winnerId: null, reason: 'target', standings: s.players.map((p, i) => ({ id: p.id, rank: i + 1, score: p.count })) }),
  redact: (s) => s,
};

// ---- fakes (same shape as gameroom.generic.test.js) ------------------------------------------------

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
const user = (n) => ({ id: U(n), name: `P${n}`, avatar: n });

class Harness {
  constructor(env = {}) {
    this.ctx = makeCtx();
    this.room = new GameRoom(this.ctx, env);
  }
  init(body = {}) {
    return this.room.fetch({ url: 'https://x/init', method: 'POST', headers: new Headers(), json: async () => ({ code: 'PIECE2', host: user(1), gameId: 'piece-race', ...body }) });
  }
  async connect(u) {
    const headers = new Headers({ Upgrade: 'websocket', 'X-User-Id': u.id, 'X-User-Name': u.name, 'X-User-Avatar': String(u.avatar), 'X-User-Guest': '0' });
    const before = this.ctx.sockets.length;
    const res = await this.room.fetch({ url: 'https://x/ws', method: 'GET', headers });
    expect(res.status).toBe(101);
    return this.ctx.sockets[before];
  }
  say(ws, msg) {
    return this.room.webSocketMessage(ws, JSON.stringify(msg));
  }
  async drop(ws) {
    ws.readyState = 3;
    await this.room.webSocketClose(ws, 1006);
  }
  async tick() {
    vi.setSystemTime(Math.max(Date.now(), this.ctx.alarmAt));
    await this.room.alarm();
  }
  get r() {
    return this.room.room;
  }
  seat(ws, id) {
    return ws.last('room').room.players.find((p) => p.id === id);
  }
}

const T0 = new Date('2026-11-15T10:00:00Z').getTime();

beforeEach(() => {
  GAME_ADAPTERS['piece-race'] = pieceRace;
  vi.stubGlobal('WebSocketPair', class {
    constructor() {
      this[0] = new FakeSocket();
      this[1] = new FakeSocket();
    }
  });
  vi.stubGlobal('Response', FakeResponse);
  vi.stubGlobal('WebSocketRequestResponsePair', class {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  created.length = 0;
  equipped.value = {};
  equipped.fail = false;
  equipped.calls = 0;
});

afterEach(() => {
  delete GAME_ADAPTERS['piece-race'];
  delete pieceRace.pendingPlayerIds;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function started() {
  const h = new Harness();
  await h.init();
  h.a = await h.connect(user(1));
  h.b = await h.connect(user(2));
  await h.say(h.a, { t: 'start' });
  h.first = h.r.state.players[0].id;
  h.second = h.r.state.players[1].id;
  h.sock = (id) => (id === U(1) ? h.a : h.b);
  return h;
}

// ---- clock -----------------------------------------------------------------------------------------

describe('decision clock in state messages', () => {
  it('the first state counts TURN_MS after the start animation; every action restarts it after its animation', async () => {
    const h = await started();
    const s1 = h.a.last('state');
    expect(s1).toMatchObject({ seq: 1, events: [], clock: { deadline: T0 + START_ANIM + TURN_MS, waitingFor: [h.first] } });
    expect(h.b.last('state').clock).toEqual(s1.clock); // same clock for every viewer

    vi.setSystemTime(T0 + 5000);
    await h.say(h.sock(h.first), { t: 'action', action: { type: 'STEP' } });
    expect(h.a.last('state')).toMatchObject({ seq: 2, clock: { deadline: T0 + 5000 + STEP_ANIM + TURN_MS, waitingFor: [h.second] } });
    expect(h.ctx.alarmAt).toBe(T0 + 5000 + STEP_ANIM + TURN_MS); // the clock is exactly what the alarm will do
  });

  it('a reconnect snapshot carries the running clock', async () => {
    const h = await started();
    vi.setSystemTime(T0 + 20_000);
    const again = await h.connect(user(2));
    expect(again.last('state')).toMatchObject({ events: [], seq: 1, clock: { deadline: T0 + START_ANIM + TURN_MS, waitingFor: [h.first] } });
  });

  it('an idle player is auto-played at the short pace; a disconnected one after the grace', async () => {
    const h = await started();
    await h.tick(); // TURN_MS ran out: the first player is flagged idle and played for
    expect(h.r.afk[h.first]).toBe(true);
    const t1 = Date.now();
    expect(h.a.last('state').clock).toEqual({ deadline: t1 + STEP_ANIM + TURN_MS, waitingFor: [h.second] });

    await h.say(h.sock(h.second), { t: 'action', action: { type: 'STEP' } });
    const t2 = Date.now();
    expect(h.a.last('state').clock).toEqual({ deadline: t2 + 900, waitingFor: [h.first] }); // idle pace (max(900, anim))

    // the idle player comes back and acts; then the other one drops: auto-play after 15 s, not 45 s
    await h.say(h.sock(h.first), { t: 'action', action: { type: 'STEP' } });
    await h.drop(h.sock(h.second));
    expect(h.room.clockView()).toEqual({ deadline: Date.now() + GRACE_MS, waitingFor: [h.second] });
  });

  it('waitingFor lists everyone the adapter waits for; a finished game has no clock', async () => {
    const h = await started();
    pieceRace.pendingPlayerIds = (s) => (s.phase === 'play' ? [s.players[0].id, s.players[1].id, 'not-seated', s.players[0].id] : []);
    expect(h.room.clockView().waitingFor).toEqual([h.first, h.second]);
    delete pieceRace.pendingPlayerIds;
    for (let i = 0; i < 10 && h.r.status === 'playing'; i += 1) {
      const turn = h.r.state.players[h.r.state.turn].id;
      await h.say(h.sock(turn), { t: 'action', action: { type: 'STEP' } });
    }
    expect(h.r.status).toBe('finished');
    expect(h.a.last('state').clock).toEqual({ deadline: null, waitingFor: [] });
  });

  it('an adapter timer that fires first sets the deadline', async () => {
    const h = await started();
    pieceRace.deadlines = (s) => (s.phase === 'play' ? [{ key: 'shot', afterMs: 10_000, playerId: s.players[s.turn].id, action: { type: 'STEP', playerId: s.players[s.turn].id } }] : []);
    try {
      h.room.syncDeadlines();
      expect(h.room.clockView().deadline).toBe(T0 + START_ANIM + 10_000);
    } finally {
      pieceRace.deadlines = () => [];
    }
  });
});

// ---- presence --------------------------------------------------------------------------------------

describe('presence: room.players[].connected with the 15 s grace', () => {
  it('stays connected through the grace, flips when it runs out (in play), and back on reconnect', async () => {
    const h = await started();
    await h.drop(h.b);
    expect(h.seat(h.a, U(2)).connected).toBe(true); // a reload must not flap the seat
    vi.setSystemTime(Date.now() + GRACE_MS - 1000);
    await h.room.alarm();
    expect(h.seat(h.a, U(2)).connected).toBe(true);
    // the alarm lands exactly when the grace ends and tells everybody
    while (h.seat(h.a, U(2)).connected) await h.tick();
    expect(Date.now()).toBeGreaterThanOrEqual(T0 + GRACE_MS);
    expect(h.r.disc[U(2)]).toBeDefined();
    const back = await h.connect(user(2));
    expect(h.seat(back, U(2)).connected).toBe(true);
    expect(h.seat(h.a, U(1)).connected).toBe(true);
  });

  it('lobby: the same grace, before the 60 s drop', async () => {
    const h = new Harness();
    await h.init();
    const a = await h.connect(user(1));
    const b = await h.connect(user(2));
    await h.drop(b);
    expect(h.seat(a, U(2)).connected).toBe(true);
    await h.tick();
    expect(Date.now()).toBe(T0 + GRACE_MS);
    expect(h.seat(a, U(2)).connected).toBe(false);
    expect(h.r.players).toHaveLength(2); // still seated until LOBBY_GRACE_MS
  });

  it('a player who left is not shown as connected', async () => {
    const h = await started();
    await h.say(h.b, { t: 'leave' });
    expect(h.seat(h.a, U(2))).toMatchObject({ connected: false });
  });
});

// ---- pieces ----------------------------------------------------------------------------------------

describe('lobby pieces', () => {
  it('auto-assigns the first free piece on join and exposes it in room.players', async () => {
    expect(pieceIds(pieceRace)).toEqual(['red', 'blue', 'green']);
    expect(pieceIds({ pieces: [{ id: 'x' }, 'y', 'y', 3] })).toEqual(['x', 'y']);
    expect(pieceIds({})).toEqual([]);
    const h = new Harness();
    await h.init();
    const a = await h.connect(user(1));
    const b = await h.connect(user(2));
    expect(b.last('room').room.players.map((p) => [p.id, p.piece])).toEqual([
      [U(1), 'red'],
      [U(2), 'blue'],
    ]);
    expect(a.last('room').room.players[0]).toEqual({ id: U(1), name: 'P1', avatar: 1, ready: true, connected: true, piece: 'red', cosmetics: {} });
  });

  it('{t:"piece"} picks a free piece; taken, unknown and malformed ones are refused', async () => {
    const h = new Harness();
    await h.init();
    const a = await h.connect(user(1));
    const b = await h.connect(user(2));
    await h.say(b, { t: 'piece', piece: 'red' });
    expect(b.last('error').message).toBe('That piece is taken.');
    await h.say(b, { t: 'piece', piece: 'gold' });
    expect(b.last('error').message).toBe('Unknown piece.');
    await h.say(b, { t: 'piece', piece: 7 });
    expect(b.last('error').message).toBe('Unknown piece.');
    await h.say(b, { t: 'piece', piece: 'green' });
    expect(h.seat(a, U(2)).piece).toBe('green');
    await h.say(a, { t: 'piece', piece: 'blue' }); // freed by the switch
    expect(h.seat(b, U(1)).piece).toBe('blue');
    // a third player gets what is left
    const c = await h.connect(user(3));
    expect(h.seat(c, U(3)).piece).toBe('red');
  });

  it('passes the pieces to createGame and locks them once the game starts', async () => {
    const h = new Harness();
    await h.init();
    const a = await h.connect(user(1));
    const b = await h.connect(user(2));
    await h.say(b, { t: 'piece', piece: 'green' });
    await h.say(a, { t: 'start' });
    const byId = Object.fromEntries(created[0].map((p) => [p.id, p.piece]));
    expect(byId).toEqual({ [U(1)]: 'red', [U(2)]: 'green' });
    expect(Object.fromEntries(h.r.state.players.map((p) => [p.id, p.piece]))).toEqual(byId);
    await h.say(b, { t: 'piece', piece: 'blue' });
    expect(b.last('error').message).toBe('Pieces can only be chosen in the lobby.');
  });

  it('a game without pieces: piece is null, {t:"piece"} errors and createGame gets no piece key', async () => {
    const saved = pieceRace.pieces;
    delete pieceRace.pieces;
    try {
      const h = new Harness();
      await h.init();
      const a = await h.connect(user(1));
      const b = await h.connect(user(2));
      expect(h.seat(a, U(2)).piece).toBeNull();
      await h.say(b, { t: 'piece', piece: 'red' });
      expect(b.last('error').message).toBe('This game has no pieces to choose from.');
      await h.say(a, { t: 'start' });
      expect(created[0].every((p) => !('piece' in p))).toBe(true);
    } finally {
      pieceRace.pieces = saved;
    }
  });
});

// ---- cosmetics -------------------------------------------------------------------------------------

describe('cosmetics in room.players', () => {
  const db = { DATABASE_URL: 'postgres://fake' };

  it('loads users.equipped when a member joins (cleaned) and re-broadcasts the room', async () => {
    equipped.value = { frame: 'frame-nizam', dice: 'not-an-item', title: 'title-chai', extra: 'x' };
    const h = new Harness(db);
    await h.init();
    const a = await h.connect(user(1));
    await h.room.cosmeticsJob;
    expect(h.seat(a, U(1)).cosmetics).toEqual({ frame: 'frame-nizam', title: 'title-chai' });
    expect(h.r.players[0].cosmetics).toEqual({ frame: 'frame-nizam', title: 'title-chai' }); // kept in the record
    // a quick reconnect does not query again
    await h.connect(user(1));
    expect(equipped.calls).toBe(1);
  });

  it('a failed load leaves {} and never breaks the join; no database means {} without a query', async () => {
    equipped.fail = true;
    const h = new Harness(db);
    await h.init();
    const a = await h.connect(user(1));
    await h.room.cosmeticsJob;
    expect(h.seat(a, U(1)).cosmetics).toEqual({});

    const n = equipped.calls;
    const plain = new Harness();
    await plain.init();
    const p = await plain.connect(user(1));
    expect(plain.seat(p, U(1)).cosmetics).toEqual({});
    expect(equipped.calls).toBe(n);
  });
});
