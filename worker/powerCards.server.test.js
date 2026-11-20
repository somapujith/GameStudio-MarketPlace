// Power Cards, server side (docs/POWER_CARDS.md section 2): hands hidden per viewer, PLAY_POWER allow-listed and
// sanitised before the engine, the power events timed by the adapter. The mask / validate / timing cases need no engine
// support; the room cases drive the real GameRoom with fake sockets and put the hands into the authoritative state by
// hand (the rule-off engine never deals any), so they pass whether or not the engine's rules have landed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
vi.mock('./match.js', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, persistMatch: vi.fn(async () => ({ inserted: true })) };
});

const { GameRoom } = await import('./GameRoom.js');
const { default: adapter, estimateAnimMs, pendingActors } = await import('./games/hyderabad-tycoon.js');
const { sanitizeAction } = await import('./validate.js');
const { maskStateFor } = await import('./mask.js');
const { ANIM_MS } = await import('../shared/timing.js');

// ---- fakes (same shape as worker/room.test.js) ---------------------------------------------------------------------

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
  async connect(u) {
    const headers = new Headers({ Upgrade: 'websocket', 'X-User-Id': u.id, 'X-User-Name': encodeURIComponent(u.name), 'X-User-Avatar': String(u.avatar), 'X-User-Guest': '0' });
    const before = this.ctx.sockets.length;
    const res = await this.room.fetch({ url: 'https://x/ws', method: 'GET', headers });
    expect(res.status).toBe(101);
    return this.ctx.sockets[before] || this.ctx.sockets.at(-1);
  }
  say(ws, msg) {
    return this.room.webSocketMessage(ws, JSON.stringify(msg));
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
  vi.setSystemTime(new Date('2026-10-16T10:00:00Z').getTime());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Three seated players, game running, with hands put into the authoritative state. */
async function gameWithHands() {
  const h = new Harness();
  await h.init();
  const sockets = {};
  for (const n of [1, 2, 3]) sockets[n] = await h.connect(user(n));
  await h.say(sockets[1], { t: 'start' });
  expect(h.room.room.status).toBe('playing');
  const hands = {
    [U(1)]: [{ uid: 'secret-uid-A1', id: 'shield', exp: 7 }, { uid: 'secret-uid-A2', id: 'swap', exp: 6 }],
    [U(2)]: [{ uid: 'secret-uid-B1', id: 'steal', exp: 8 }],
    [U(3)]: [],
  };
  for (const p of h.state.players) p.hand = structuredClone(hands[p.id]);
  // prng stands in for the engine's separate card stream (it exists only when the rule is on). A new state object, as the
  // engine returns after every action: the mask caches its stripped copy per state object.
  h.room.room.state = { ...h.state, prng: 424242 };
  return { h, sockets, hands };
}

describe('broadcast state hides hands per viewer', () => {
  it('each socket gets its own hand and only stubs for the others; the prng goes to nobody', async () => {
    const { h, sockets, hands } = await gameWithHands();
    h.room.broadcastState([{ type: 'power_draw', player: U(2), source: 'turn' }]);
    for (const n of [1, 2, 3]) {
      const msg = sockets[n].last('state');
      const players = Object.fromEntries(msg.state.players.map((p) => [p.id, p]));
      expect(msg.state.prng).toBe(0);
      expect(msg.state.rng).toBe(0);
      for (const id of [U(1), U(2), U(3)]) {
        if (id === U(n)) expect(players[id].hand).toEqual(hands[id]);
        else expect(players[id].hand).toEqual(hands[id].map(() => ({ hidden: true })));
      }
      // other players' card identities appear nowhere in what this socket received
      const wire = JSON.stringify(msg);
      for (const other of [1, 2, 3].filter((m) => m !== n)) {
        for (const c of hands[U(other)]) {
          expect(wire).not.toContain(c.uid);
        }
      }
      expect(wire).not.toContain('424242');
    }
    // the public count is the length for everybody
    expect(sockets[3].last('state').state.players.find((p) => p.id === U(1)).hand).toHaveLength(2);
    // the event is public and carries no card identity
    expect(sockets[3].last('state').events).toEqual([{ type: 'power_draw', player: U(2), source: 'turn' }]);
  });

  it('a viewer who is not a player (spectator) sees every hand hidden', async () => {
    const { h } = await gameWithHands();
    const view = h.room.viewOf('somebody-not-seated');
    expect(Object.fromEntries(view.players.map((p) => [p.id, p.hand]))).toEqual({ [U(1)]: [{ hidden: true }, { hidden: true }], [U(2)]: [{ hidden: true }], [U(3)]: [] });
    expect(JSON.stringify(view)).not.toContain('secret-uid');
    expect(h.room.viewOf(undefined).players.find((p) => p.id === U(1)).hand).toEqual([{ hidden: true }, { hidden: true }]);
  });

  it('reveals every hand to everybody once the game is over, and still hides the prng', async () => {
    const { h, sockets, hands } = await gameWithHands();
    h.room.room.state = { ...h.state, phase: 'over' };
    h.room.broadcastState([]);
    for (const n of [1, 2, 3]) {
      const msg = sockets[n].last('state');
      expect(Object.fromEntries(msg.state.players.map((p) => [p.id, p.hand]))).toEqual(hands);
      expect(msg.state.prng).toBe(0);
    }
  });

  it('does not mutate the authoritative state while masking', async () => {
    const { h, hands } = await gameWithHands();
    const before = structuredClone(h.state);
    h.room.broadcastState([]);
    h.room.viewOf('x');
    expect(h.state).toEqual(before);
    expect(h.state.players.find((p) => p.id === U(1)).hand).toEqual(hands[U(1)]);
    expect(h.state.prng).toBe(424242);
  });

  it('a rule-off game (no hand field) is sent exactly as before: no hands appear', async () => {
    const h = new Harness();
    await h.init();
    const a = await h.connect(user(1));
    await h.connect(user(2));
    await h.say(a, { t: 'start' });
    h.room.broadcastState([]);
    const msg = a.last('state');
    expect(msg.state.players.some((p) => 'hand' in p)).toBe(false);
    expect('prng' in msg.state).toBe(false);
    expect(msg.state.rng).toBe(0);
  });
});

describe('PLAY_POWER through the room', () => {
  it('a malformed payload is rejected before the engine sees it', async () => {
    const { h, sockets } = await gameWithHands();
    const apply = vi.spyOn(adapter, 'applyAction');
    const seq = h.room.room.seq;
    const bad = [
      { type: 'PLAY_POWER' },
      { type: 'PLAY_POWER', card: 7 },
      { type: 'PLAY_POWER', card: 'x'.repeat(41) },
      { type: 'PLAY_POWER', card: 'bad card!' },
      { type: 'PLAY_POWER', card: 'ok', target: { id: U(2) } },
      { type: 'PLAY_POWER', card: 'ok', target: 'y'.repeat(65) },
    ];
    for (const action of bad) {
      await h.say(sockets[1], { t: 'action', action });
      expect(sockets[1].last('error').message, JSON.stringify(action)).toBe('Invalid action.');
    }
    expect(apply).not.toHaveBeenCalled();
    expect(h.room.room.seq).toBe(seq);
  });

  it('a well-formed play reaches the engine with the player id forced and extras dropped', async () => {
    const { h, sockets } = await gameWithHands();
    const apply = vi.spyOn(adapter, 'applyAction').mockReturnValue({ error: 'stub: not now' });
    await h.say(sockets[2], { t: 'action', action: { type: 'PLAY_POWER', card: 'secret-uid-B1', target: U(1), playerId: U(1), id: 'swap', exp: 99 } });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][1]).toEqual({ type: 'PLAY_POWER', card: 'secret-uid-B1', target: U(1), playerId: U(2) });
    expect(sockets[2].last('error').message).toBe('stub: not now');
  });

  it('with the rule off the engine refuses the play: an error to the sender, no state change', async () => {
    const h = new Harness();
    await h.init();
    const a = await h.connect(user(1));
    const b = await h.connect(user(2));
    await h.say(a, { t: 'start' });
    const seq = h.room.room.seq;
    const before = JSON.stringify(h.state);
    const turnId = h.state.players[h.state.turn].id;
    const sock = turnId === U(1) ? a : b;
    await h.say(sock, { t: 'action', action: { type: 'PLAY_POWER', card: 'whatever' } });
    const err = sock.last('error');
    expect(err).toBeTruthy();
    expect(typeof err.message).toBe('string');
    expect(err.message).not.toBe('Invalid action.'); // it passed validation and was refused by the rules
    expect(h.room.room.seq).toBe(seq);
    expect(JSON.stringify(h.state)).toBe(before);
  });

  it('a play outside the allow-list spelling is refused as invalid', async () => {
    const { h, sockets } = await gameWithHands();
    await h.say(sockets[1], { t: 'action', action: { type: 'play_power', card: 'x' } });
    expect(sockets[1].last('error').message).toBe('Invalid action.');
  });

  it('times a play result with the power events (stubbed engine result)', async () => {
    const { h, sockets } = await gameWithHands();
    const events = [
      { type: 'power_play', player: U(1), card: 'swap', target: U(2) },
      { type: 'move', player: U(1), teleport: true, from: 3, to: 9 },
      { type: 'move', player: U(2), teleport: true, from: 9, to: 3 },
    ];
    vi.spyOn(adapter, 'applyAction').mockImplementation((state) => ({ state: structuredClone(state), events }));
    await h.say(sockets[1], { t: 'action', action: { type: 'PLAY_POWER', card: 'secret-uid-A2', target: U(2) } });
    expect(h.room.room.animMs).toBe(ANIM_MS.powerPlay + 2 * (ANIM_MS.teleportPre + ANIM_MS.teleport));
    // every socket got the same public events; nobody learned the other card
    expect(sockets[3].last('state').events).toEqual(events);
    expect(JSON.stringify(sockets[3].last('state'))).not.toContain('secret-uid-A1');
  });
});

describe('estimateAnimMs: power events', () => {
  it('uses the spec timings (900 / 1500 / 1400 / 700)', () => {
    expect(estimateAnimMs([{ type: 'power_draw', player: 'a', source: 'tile', tile: 7 }])).toBe(900);
    expect(estimateAnimMs([{ type: 'power_play', player: 'a', card: 'shield' }])).toBe(1500);
    expect(estimateAnimMs([{ type: 'power_trigger', player: 'a', card: 'shield', amount: 4200 }])).toBe(1400);
    expect(estimateAnimMs([{ type: 'power_expire', player: 'a', count: 2 }])).toBe(700);
  });

  it('agrees with shared/timing.js ANIM_MS once those keys exist', () => {
    expect(estimateAnimMs([{ type: 'power_draw' }])).toBe(ANIM_MS.powerDraw ?? 900);
    expect(estimateAnimMs([{ type: 'power_play' }])).toBe(ANIM_MS.powerPlay ?? 1500);
    expect(estimateAnimMs([{ type: 'power_trigger' }])).toBe(ANIM_MS.powerTrigger ?? 1400);
    expect(estimateAnimMs([{ type: 'power_expire' }])).toBe(ANIM_MS.powerExpire ?? 700);
  });

  it('adds up with the neighbouring events; a swap is the play plus two teleport moves', () => {
    const swap = [
      { type: 'power_play', player: 'a', card: 'swap', target: 'b' },
      { type: 'move', player: 'a', teleport: true },
      { type: 'move', player: 'b', teleport: true },
    ];
    expect(estimateAnimMs(swap)).toBe(1500 + 2 * (ANIM_MS.teleportPre + ANIM_MS.teleport));
    const rent = [{ type: 'power_trigger', player: 'a', card: 'double', amount: 10 }, { type: 'cash', reason: 'rent', delta: 10 }];
    expect(estimateAnimMs(rent)).toBe(1400 + ANIM_MS.rentIn);
    // draw on a card tile: the landing chain plus the draw
    expect(estimateAnimMs([{ type: 'land' }, { type: 'power_draw' }])).toBe(ANIM_MS.land + 900);
  });
});

describe('idle / AFK path with Power Cards', () => {
  it('a held hand changes neither the actor, the timers nor the idle move', async () => {
    const { h } = await gameWithHands();
    const s = h.state;
    expect(s.phase).toBe('roll');
    const turnId = s.players[s.turn].id;
    expect(pendingActors(s)).toEqual([turnId]);
    expect(adapter.turnPlayerId(s)).toBe(turnId);
    expect(adapter.deadlines(s)).toEqual([]); // no power timer
    const move = adapter.idleAction(s, turnId);
    expect(move).toBeTruthy();
    expect(move.type).not.toBe('PLAY_POWER'); // auto-play never spends a human's hidden hand
  });
});

describe('sanitizeAction and mask stay in step with the contract', () => {
  it('PLAY_POWER is allow-listed, the mask is a no-op for a state without hands', () => {
    expect(sanitizeAction({ type: 'PLAY_POWER', card: 'abc' }, U(1))).toEqual({ type: 'PLAY_POWER', card: 'abc', playerId: U(1) });
    const off = { phase: 'roll', players: [{ id: 'a' }] };
    expect(maskStateFor(off, 'a')).toBe(off);
  });
});
