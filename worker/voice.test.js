// Voice lines in the room (`{t:'voice', id}`): the soundboard. Ownership comes from user_items (mocked here), the broadcast goes
// to everybody including the sender, limits are per player + room-wide, and it never touches the game or its timers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

// Who owns what (userId -> ids). `ownedReads` counts database reads; `ownedFail` makes the next read throw.
const bought = new Map();
const probe = { reads: 0, fail: false };
vi.mock('./roomsdb.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadOwnedItemIds: vi.fn(async (env, userId) => {
    probe.reads += 1;
    if (probe.fail) throw new Error('neon down');
    return [...(bought.get(userId) || [])];
  }),
}));

const { GameRoom } = await import('./GameRoom.js');
const { VOICE_LIMITS } = await import('../shared/cosmetics.js');

const V = 'voice-sheru-bhai';
const NOT_OWNED = 'Buy voice lines in the shop (sign in).';
const TOO_FAST = 'Voice lines are limited: wait a few seconds.';

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
const user = (n) => ({ id: U(n), name: `P${n}`, avatar: n % 12 });

class Harness {
  constructor() {
    this.ctx = makeCtx();
    this.room = new GameRoom(this.ctx, {});
  }
  async init(host = user(1)) {
    await this.room.fetch({ url: 'https://x/init', method: 'POST', headers: new Headers(), json: async () => ({ code: 'ABCD23', host, settings: {}, maxPlayers: 4 }) });
  }
  async connect(u, guest = false) {
    const headers = new Headers({
      Upgrade: 'websocket',
      'X-User-Id': u.id,
      'X-User-Name': encodeURIComponent(u.name),
      'X-User-Avatar': String(u.avatar),
      'X-User-Guest': guest ? '1' : '0',
    });
    const before = this.ctx.sockets.length;
    const res = await this.room.fetch({ url: 'https://x/ws', method: 'GET', headers });
    expect(res.status).toBe(101);
    return this.ctx.sockets[before] || this.ctx.sockets.at(-1);
  }
  async say(ws, msg) {
    await this.room.webSocketMessage(ws, JSON.stringify(msg));
  }
  get rec() {
    return this.room.room;
  }
}

/** A lobby of three connected players; U(1) and U(2) own the voice line, U(3) does not. */
async function lobby() {
  const h = new Harness();
  await h.init();
  h.a = await h.connect(user(1));
  h.b = await h.connect(user(2));
  h.c = await h.connect(user(3));
  bought.set(U(1), new Set([V]));
  bought.set(U(2), new Set([V]));
  return h;
}

const tick = (ms) => vi.setSystemTime(Date.now() + ms);

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
  vi.setSystemTime(new Date('2026-10-16T10:00:00Z').getTime());
  bought.clear();
  probe.reads = 0;
  probe.fail = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('{t:"voice"}: who may play', () => {
  it('an owner is heard by EVERYONE in the lobby, the sender included, with from / id / ts / seq', async () => {
    const h = await lobby();
    await h.say(h.a, { t: 'voice', id: V });
    const ts = Date.now();
    for (const ws of [h.a, h.b, h.c]) expect(ws.of('voice')).toEqual([{ t: 'voice', from: U(1), id: V, ts, seq: 1 }]);
    expect(h.a.of('error')).toHaveLength(0);
    tick(VOICE_LIMITS.cooldownMs);
    await h.say(h.a, { t: 'voice', id: V });
    expect(h.c.last('voice')).toMatchObject({ from: U(1), seq: 2 });
  });

  it('a player who does not own it is refused with a clear error and nobody hears anything', async () => {
    const h = await lobby();
    await h.say(h.c, { t: 'voice', id: V });
    expect(h.c.last('error').message).toBe(NOT_OWNED);
    for (const ws of [h.a, h.b, h.c]) expect(ws.of('voice')).toHaveLength(0);
  });

  it('ownership is per line: owning Sheru Bhai does not unlock Ladle Meow', async () => {
    const h = await lobby();
    await h.say(h.a, { t: 'voice', id: 'voice-ladle-meow' });
    expect(h.a.last('error').message).toBe(NOT_OWNED);
    bought.set(U(1), new Set([V, 'voice-ladle-meow']));
    tick(6000);
    await h.say(h.a, { t: 'voice', id: 'voice-ladle-meow' });
    expect(h.b.last('voice')).toMatchObject({ from: U(1), id: 'voice-ladle-meow' });
  });

  it('a guest without the item is refused the same way; a guest who bought it may play it', async () => {
    const h = new Harness();
    await h.init();
    const guest = await h.connect(user(4), true);
    await h.say(guest, { t: 'voice', id: V });
    expect(guest.last('error').message).toBe(NOT_OWNED);
    bought.set(U(4), new Set([V]));
    tick(6000); // past the 5 s re-check of a "not owned" answer
    await h.say(guest, { t: 'voice', id: V });
    expect(guest.last('voice')).toMatchObject({ from: U(4), id: V });
  });

  it('unknown ids and malformed payloads are rejected without a database read', async () => {
    const h = await lobby();
    for (const id of ['voice-nope', 'frame-lake', '', null, undefined, 7, {}, [V]]) {
      await h.say(h.a, { t: 'voice', id });
      expect(h.a.last('error').message).toBe('Unknown voice line.');
    }
    await h.say(h.a, { t: 'voice' });
    expect(h.a.last('error').message).toBe('Unknown voice line.');
    expect(probe.reads).toBe(0);
    expect(h.b.of('voice')).toHaveLength(0);
  });

  it('a player who is not in the room cannot play (no seat, no sound)', async () => {
    const h = await lobby();
    bought.set(U(9), new Set([V]));
    const stranger = new FakeSocket();
    stranger.serializeAttachment({ userId: U(9), name: 'X', avatar: 0, guest: false, at: Date.now() });
    h.ctx.sockets.push(stranger);
    await h.say(stranger, { t: 'voice', id: V });
    expect(stranger.last('error').message).toBe('You are not in this room.');
    expect(h.a.of('voice')).toHaveLength(0);
  });

  it('ownership is read once per player and cached; a miss re-checks at most every 5 s, so a fresh purchase works', async () => {
    const h = await lobby();
    await h.say(h.a, { t: 'voice', id: V });
    tick(VOICE_LIMITS.cooldownMs);
    await h.say(h.a, { t: 'voice', id: V });
    expect(probe.reads).toBe(1);
    await h.say(h.c, { t: 'voice', id: V }); // not owned: one read
    await h.say(h.c, { t: 'voice', id: V }); // same instant: answered from the cache
    expect(probe.reads).toBe(2);
    bought.set(U(3), new Set([V])); // bought in the shop mid-game
    await h.say(h.c, { t: 'voice', id: V });
    expect(h.c.last('error').message).toBe(NOT_OWNED); // still inside the 5 s window
    tick(5000);
    await h.say(h.c, { t: 'voice', id: V });
    expect(h.b.last('voice')).toMatchObject({ from: U(3) });
    expect(probe.reads).toBe(3);
  });

  it('a failing ownership read is a clean error, never a broadcast, and is retried next time', async () => {
    const h = await lobby();
    probe.fail = true;
    await h.say(h.a, { t: 'voice', id: V });
    expect(h.a.last('error').message).toBe('Could not check your voice lines. Try again.');
    expect(h.b.of('voice')).toHaveLength(0);
    probe.fail = false;
    await h.say(h.a, { t: 'voice', id: V });
    expect(h.b.last('voice')).toMatchObject({ from: U(1) });
  });
});

describe('{t:"voice"}: limits', () => {
  it('per-player cooldown: 3 s between two lines', async () => {
    const h = await lobby();
    await h.say(h.a, { t: 'voice', id: V });
    tick(VOICE_LIMITS.cooldownMs - 1);
    await h.say(h.a, { t: 'voice', id: V });
    expect(h.a.last('error').message).toBe(TOO_FAST);
    expect(h.b.of('voice')).toHaveLength(1);
    tick(1);
    await h.say(h.a, { t: 'voice', id: V });
    expect(h.b.of('voice')).toHaveLength(2);
  });

  it('per-player burst: at most 3 within 10 s, then it frees up', async () => {
    const h = await lobby();
    for (let i = 0; i < VOICE_LIMITS.burst; i += 1) {
      await h.say(h.a, { t: 'voice', id: V });
      tick(VOICE_LIMITS.cooldownMs);
    }
    expect(h.b.of('voice')).toHaveLength(3);
    await h.say(h.a, { t: 'voice', id: V }); // 9 s after the first
    expect(h.a.last('error').message).toBe(TOO_FAST);
    expect(h.b.of('voice')).toHaveLength(3);
    tick(1000 + 1); // the first one is now older than 10 s
    await h.say(h.a, { t: 'voice', id: V });
    expect(h.b.of('voice')).toHaveLength(4);
  });

  it('room-wide: at most 6 broadcasts per 5 s across all players', async () => {
    const h = new Harness();
    await h.init();
    const socks = [];
    for (let n = 1; n <= 4; n += 1) {
      socks.push(await h.connect(user(n)));
      bought.set(U(n), new Set([V]));
    }
    // 4 players, 2 lines each (the second round 3 s later, past each player's cooldown but inside the 5 s room window):
    // 8 attempts, 6 get through
    for (const s of socks) await h.say(s, { t: 'voice', id: V });
    tick(VOICE_LIMITS.cooldownMs);
    for (const s of socks) await h.say(s, { t: 'voice', id: V });
    expect(socks[0].of('voice')).toHaveLength(VOICE_LIMITS.roomMax);
    const refused = socks.flatMap((s) => s.of('error')).filter((e) => e.message === TOO_FAST);
    expect(refused.length).toBe(2);
    tick(VOICE_LIMITS.roomWindowMs);
    await h.say(socks[2], { t: 'voice', id: V });
    expect(socks[1].last('voice')).toMatchObject({ from: U(3) });
  });

  it('per-game cap: 60 per player per match, then a clear error', async () => {
    const h = await lobby();
    for (let i = 0; i < VOICE_LIMITS.perGame; i += 1) {
      await h.say(h.a, { t: 'voice', id: V });
      tick(VOICE_LIMITS.burstWindowMs + 1);
    }
    expect(h.b.of('voice')).toHaveLength(VOICE_LIMITS.perGame);
    await h.say(h.a, { t: 'voice', id: V });
    expect(h.a.last('error').message).toBe('Voice line limit reached for this game.');
    expect(h.b.last('voice').seq).toBe(VOICE_LIMITS.perGame);
    await h.say(h.b, { t: 'voice', id: V }); // somebody else is unaffected
    expect(h.a.last('voice')).toMatchObject({ from: U(2), seq: 1 });
  });
});

describe('{t:"voice"}: not a game action', () => {
  async function started() {
    const h = await lobby();
    await h.say(h.a, { t: 'start' });
    expect(h.rec.status).toBe('playing');
    return h;
  }

  it('works during a game at any time (also for the player whose turn it is not), nothing is stored', async () => {
    const h = await started();
    const other = h.rec.state.players[0].id === U(2) ? h.a : h.b; // the one who is NOT first to move
    expect([h.a, h.b]).toContain(other);
    const sender = other === h.a ? h.a : h.b;
    await h.say(sender, { t: 'voice', id: V });
    for (const ws of [h.a, h.b, h.c]) expect(ws.last('voice')).toMatchObject({ id: V });
    expect(JSON.stringify(h.rec)).not.toContain(V);
  });

  it('does not reset the turn clock, count as an action, clear idle / afk flags or change the schedule', async () => {
    const h = await started();
    const before = structuredClone({
      lastApplyAt: h.rec.lastApplyAt, animMs: h.rec.animMs, seq: h.rec.seq, idle: h.rec.idle, afk: h.rec.afk,
      disc: h.rec.disc, lastActivity: h.rec.lastActivity, state: h.rec.state, deadlines: h.rec.deadlines,
    });
    h.rec.idle = { [U(1)]: 1 };
    h.rec.afk = { [U(1)]: true };
    const alarm = h.ctx.alarmAt;
    const seenState = h.a.of('state').length;
    tick(2000);
    await h.say(h.a, { t: 'voice', id: V });
    expect(h.rec.lastApplyAt).toBe(before.lastApplyAt);
    expect(h.rec.animMs).toBe(before.animMs);
    expect(h.rec.seq).toBe(before.seq);
    expect(h.rec.idle).toEqual({ [U(1)]: 1 });
    expect(h.rec.afk).toEqual({ [U(1)]: true });
    expect(h.rec.disc).toEqual(before.disc);
    expect(h.rec.lastActivity).toBe(before.lastActivity);
    expect(h.rec.deadlines).toEqual(before.deadlines);
    expect(h.rec.state).toEqual(before.state);
    expect(h.ctx.alarmAt).toBe(alarm);
    expect(h.a.of('state')).toHaveLength(seenState); // no state broadcast
  });

  it('the per-game cap restarts with a new match (lobby and match are counted apart)', async () => {
    const h = await lobby();
    await h.say(h.a, { t: 'voice', id: V });
    expect(h.room.voiceGame.counts.get(U(1))).toBe(1);
    tick(VOICE_LIMITS.cooldownMs);
    await h.say(h.a, { t: 'start' });
    await h.say(h.a, { t: 'voice', id: V });
    expect(h.room.voiceGame.counts.get(U(1))).toBe(1);
    expect(h.a.last('voice').seq).toBe(2); // seq keeps counting for dedupe
  });
});
