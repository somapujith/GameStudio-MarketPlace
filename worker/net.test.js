// Connection strength in the room: `{t:'net', rtt}` reports, the `net` field of `{t:'room'}`, rate limits,
// coalesced broadcasts and the promise that none of it is ever stored. Same fake DO context as room.test.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { GameRoom, GRACE_MS } = await import('./GameRoom.js');
const { NetPresence, NET_MIN_GAP_MS, NET_STALE_MS, NET_LOST_MS, NET_BROADCAST_GAP_MS, parseNetRtt } = await import('./netpresence.js');
const validate = await import('./validate.js');

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
  const puts = [];
  const ctx = {
    store,
    sockets,
    puts,
    storage: {
      get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
      put: async (k, v) => {
        puts.push(k);
        store.set(k, structuredClone(v));
      },
      setAlarm: async () => {},
      deleteAlarm: async () => {},
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
const T0 = new Date('2026-10-16T10:00:00Z').getTime();

class Harness {
  constructor() {
    this.ctx = makeCtx();
    this.room = new GameRoom(this.ctx, {});
  }
  async init(host = user(1)) {
    await this.room.fetch({ url: 'https://x/init', method: 'POST', headers: new Headers(), json: async () => ({ code: 'ABCD23', host, settings: {}, maxPlayers: 4 }) });
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
    return this.ctx.sockets[before];
  }
  say(ws, msg) {
    return this.room.webSocketMessage(ws, typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  async drop(ws) {
    ws.readyState = 3;
    await this.room.webSocketClose(ws, 1006);
  }
  /** `net` of player n as the latest `room` message of `viewer` shows it. */
  netOf(viewer, n) {
    return viewer.last('room').room.players.find((p) => p.id === U(n)).net;
  }
}

/** A room with two connected members, the one-second broadcast window after joining already over. */
async function twoPlayers() {
  const h = new Harness();
  await h.init();
  const a = await h.connect(user(1));
  const b = await h.connect(user(2));
  await vi.advanceTimersByTimeAsync(NET_BROADCAST_GAP_MS + 10);
  h.t0 = Date.now();
  return { h, a, b };
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
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('parseNetRtt', () => {
  it('accepts finite numbers 0..20000 (rounded) and nothing else', () => {
    expect(parseNetRtt(0)).toBe(0);
    expect(parseNetRtt(87.6)).toBe(88);
    expect(parseNetRtt(20000)).toBe(20000);
    for (const bad of [-1, 20001, NaN, Infinity, -Infinity, '80', null, undefined, true, {}, [80]]) expect(parseNetRtt(bad)).toBeNull();
    expect(validate.parseNetRtt).toBe(parseNetRtt); // lives with the other message validators too
  });
});

describe('NetPresence', () => {
  it('rate-limits per member and keeps the level steady around a threshold (hysteresis)', () => {
    const n = new NetPresence();
    expect(n.report('a', 85, 1000)).toBe(true);
    expect(n.view('a', true, 1000)).toEqual({ q: 4, rtt: 85 });
    expect(n.report('a', 300, 1000 + NET_MIN_GAP_MS - 1)).toBe(false);
    expect(n.report('a', 95, 1000 + NET_MIN_GAP_MS)).toBe(true);
    expect(n.view('a', true, 3000).q).toBe(4); // 95 ms is "3" on paper, but within 12% of the 90 ms edge
    expect(n.report('a', 120, 5000)).toBe(true);
    expect(n.view('a', true, 5000).q).toBe(3);
    expect(n.report('b', 80, 1001)).toBe(true); // another member is not affected
  });

  it('shows q 0 without a socket, q null before the first report, stale after 15 s and gone after 30 s of silence', () => {
    const n = new NetPresence();
    expect(n.view('a', true, 0)).toEqual({ q: null, rtt: null });
    expect(n.view('a', false, 0)).toEqual({ q: 0, rtt: null });
    n.report('a', 150, 1000);
    expect(n.view('a', true, 1000 + NET_STALE_MS)).toEqual({ q: 3, rtt: 150 });
    expect(n.view('a', true, 1000 + NET_STALE_MS + 1)).toEqual({ q: 3, rtt: 150, stale: true });
    expect(n.view('a', true, 1000 + NET_LOST_MS)).toEqual({ q: 3, rtt: 150, stale: true });
    expect(n.view('a', true, 1000 + NET_LOST_MS + 1)).toEqual({ q: 0, rtt: null }); // open but dead: counts as gone
    expect(n.view('a', false, 1000)).toEqual({ q: 0, rtt: null });
    expect(n.nextChangeAt(new Set(['a']), 2000)).toBe(1000 + NET_STALE_MS + 1);
    expect(n.nextChangeAt(new Set(['a']), 1000 + NET_STALE_MS + 5)).toBe(1000 + NET_LOST_MS + 1);
    expect(n.nextChangeAt(new Set(['a']), 1000 + NET_LOST_MS + 5)).toBeNull();
    expect(n.nextChangeAt(new Set(), 2000)).toBeNull();
    n.prune(new Set());
    expect(n.view('a', true, 1000)).toEqual({ q: null, rtt: null });
  });

  it('signature changes with the level and staleness, not with the rtt', () => {
    const p = (q, stale, rtt) => [{ id: 'a', net: { q, rtt, ...(stale ? { stale: true } : {}) } }];
    expect(NetPresence.signature(p(3, false, 100))).toBe(NetPresence.signature(p(3, false, 170)));
    expect(NetPresence.signature(p(3, false, 100))).not.toBe(NetPresence.signature(p(2, false, 100)));
    expect(NetPresence.signature(p(3, false, 100))).not.toBe(NetPresence.signature(p(3, true, 100)));
  });
});

describe('{t:"net"} in the room', () => {
  it('a seated member reports and everyone sees it in room.players[i].net', async () => {
    const { h, a, b } = await twoPlayers();
    expect(h.netOf(a, 2)).toEqual({ q: null, rtt: null }); // connected, nothing reported yet
    await h.say(b, { t: 'net', rtt: 120 });
    expect(h.netOf(a, 2)).toEqual({ q: 3, rtt: 120 });
    expect(h.netOf(b, 2)).toEqual({ q: 3, rtt: 120 }); // the member sees their own echo too
    expect(h.netOf(a, 1)).toEqual({ q: null, rtt: null });
  });

  it('invalid reports are ignored silently: no error, no change, no broadcast', async () => {
    const { h, a, b } = await twoPlayers();
    const before = a.sent.length;
    for (const rtt of [-5, 20001, NaN, '90', null, undefined, {}, [1]]) await h.say(b, JSON.stringify({ t: 'net', rtt }));
    await h.say(b, '{"t":"net"}');
    expect(b.of('error')).toEqual([]);
    expect(a.sent.length).toBe(before);
    expect(h.netOf(a, 2)).toEqual({ q: null, rtt: null });
    await h.say(b, { t: 'net', rtt: 20000 });
    expect(h.netOf(a, 2)).toEqual({ q: 1, rtt: 20000 });
  });

  it('reports faster than one per 2 s are dropped; one after the gap is used', async () => {
    const { h, a, b } = await twoPlayers();
    await h.say(b, { t: 'net', rtt: 40 });
    expect(h.netOf(a, 2).q).toBe(4);
    await vi.advanceTimersByTimeAsync(NET_MIN_GAP_MS - 1);
    await h.say(b, { t: 'net', rtt: 900 });
    expect(h.room.net.view(U(2), true, Date.now())).toEqual({ q: 4, rtt: 40 });
    await vi.advanceTimersByTimeAsync(NET_BROADCAST_GAP_MS + 1);
    await h.say(b, { t: 'net', rtt: 900 });
    expect(h.netOf(a, 2)).toEqual({ q: 1, rtt: 900 });
  });

  it('a flood never produces errors and never eats the game-message budget', async () => {
    const { h, b } = await twoPlayers();
    for (let i = 0; i < 200; i++) await h.say(b, { t: 'net', rtt: 50 + (i % 7) });
    expect(b.of('error')).toEqual([]);
    await h.say(b, { t: 'ready', ready: true });
    expect(b.of('error')).toEqual([]); // the 40-per-5-s limit of real messages is untouched
  });

  it('ignores a socket whose user is not seated', async () => {
    const { h, a } = await twoPlayers();
    const ghost = new FakeSocket();
    ghost.serializeAttachment({ userId: U(9), name: 'G', avatar: 0, at: Date.now() });
    const before = a.sent.length;
    await h.say(ghost, { t: 'net', rtt: 10 });
    expect(a.sent.length).toBe(before);
    expect(ghost.of('error')).toEqual([]);
    expect(h.room.net.map.size).toBe(0);
  });

  it('q is 0 the moment the socket is gone, even while `connected` rides out the grace; a new socket starts measuring', async () => {
    const { h, a, b } = await twoPlayers();
    await h.say(b, { t: 'net', rtt: 60 });
    expect(h.netOf(a, 2).q).toBe(4);
    await h.drop(b);
    const seat = a.last('room').room.players.find((p) => p.id === U(2));
    expect(seat.net).toEqual({ q: 0, rtt: null });
    expect(seat.connected).toBe(true); // 30 s reconnect grace: the seat does not flap
    await vi.advanceTimersByTimeAsync(GRACE_MS + 1);
    await h.room.tick();
    expect(a.last('room').room.players.find((p) => p.id === U(2))).toMatchObject({ connected: false, net: { q: 0, rtt: null } });
    const b2 = await h.connect(user(2));
    expect(h.netOf(a, 2)).toEqual({ q: null, rtt: null }); // not the old 60 ms
    expect(b2.last('room')).toBeTruthy();
  });

  it('broadcasts when a members level changes, not when only the rtt does', async () => {
    const { h, a, b } = await twoPlayers();
    await h.say(b, { t: 'net', rtt: 40 });
    const count = () => a.of('room').length;
    const base = count();
    await vi.advanceTimersByTimeAsync(3000);
    await h.say(b, { t: 'net', rtt: 60 }); // still 4 bars
    await vi.advanceTimersByTimeAsync(3000);
    await h.say(b, { t: 'net', rtt: 85 });
    expect(count()).toBe(base);
    await vi.advanceTimersByTimeAsync(3000);
    await h.say(b, { t: 'net', rtt: 600 }); // 1 bar
    expect(count()).toBe(base + 1);
    expect(h.netOf(a, 2)).toEqual({ q: 1, rtt: 600 });
  });

  it('coalesces a burst of changes into one broadcast per second', async () => {
    const { h, a, b } = await twoPlayers();
    const c = await h.connect(user(3));
    await vi.advanceTimersByTimeAsync(NET_BROADCAST_GAP_MS + 10);
    await h.say(b, { t: 'net', rtt: 40 }); // first report: the room is broadcast at once
    const base = a.of('room').length;
    // two more members change inside the one-second window right after that broadcast
    await vi.advanceTimersByTimeAsync(400);
    await h.say(c, { t: 'net', rtt: 500 });
    expect(a.of('room').length).toBe(base); // held back: a broadcast just went out
    await vi.advanceTimersByTimeAsync(400);
    await h.say(a, { t: 'net', rtt: 200 });
    expect(a.of('room').length).toBe(base);
    await vi.advanceTimersByTimeAsync(NET_BROADCAST_GAP_MS);
    expect(a.of('room').length).toBe(base + 1); // ONE message carries both changes
    const players = a.last('room').room.players;
    expect(players.find((p) => p.id === U(3)).net.q).toBe(1);
    expect(players.find((p) => p.id === U(1)).net.q).toBe(2);
    await vi.advanceTimersByTimeAsync(NET_BROADCAST_GAP_MS * 3);
    expect(a.of('room').length).toBe(base + 1);
  });

  it('a silent but open socket turns stale after 15 s, keeping its last level', async () => {
    const { h, a, b } = await twoPlayers();
    await h.say(b, { t: 'net', rtt: 120 });
    expect(h.netOf(a, 2)).toEqual({ q: 3, rtt: 120 });
    await vi.advanceTimersByTimeAsync(NET_STALE_MS + 100);
    expect(h.netOf(a, 2)).toEqual({ q: 3, rtt: 120, stale: true });
    await vi.advanceTimersByTimeAsync(NET_LOST_MS - NET_STALE_MS); // 30 s of silence on an open socket: a dead link, counts as gone
    expect(h.netOf(a, 2)).toEqual({ q: 0, rtt: null });
    expect(a.last('room').room.players.find((p) => p.id === U(2)).connected).toBe(true); // presence/grace logic is untouched
    const count = a.of('room').length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(a.of('room').length).toBe(count); // no timer keeps spinning once everything has flipped
    await h.say(b, { t: 'net', rtt: 130 }); // a fresh report brings the member back at once
    expect(h.netOf(a, 2)).toEqual({ q: 3, rtt: 130 });
  });

  it('is presence data only: never in storage, the saved room record or the engine state', async () => {
    const { h, b } = await twoPlayers();
    await h.say(b, { t: 'net', rtt: 777 });
    await h.say(b, { t: 'ready', ready: true }); // a normal save happens
    await vi.advanceTimersByTimeAsync(5000);
    const saved = JSON.stringify(h.ctx.store.get('room'));
    expect(saved).not.toContain('777');
    expect(saved).not.toContain('"net"');
    expect(JSON.stringify(h.room.room)).not.toContain('777');
    expect(h.room.room.presenceSig).not.toContain('777');
    expect([...h.ctx.store.keys()]).toEqual(['room']);
  });

  it('a report alone writes nothing: no storage put, no lastActivity bump', async () => {
    const { h, b } = await twoPlayers();
    const puts = h.ctx.puts.length;
    const act = h.room.room.lastActivity;
    await vi.advanceTimersByTimeAsync(5000);
    await h.say(b, { t: 'net', rtt: 100 });
    expect(h.ctx.puts.length).toBe(puts);
    expect(h.room.room.lastActivity).toBe(act);
  });

  it('survives a restart of the object: empty again, refilled by the next report', async () => {
    const { h, a, b } = await twoPlayers();
    await h.say(b, { t: 'net', rtt: 100 });
    expect(h.netOf(a, 2).q).toBe(3);
    const reborn = new GameRoom(h.ctx, {}); // hibernation: same storage and sockets, no memory
    await vi.advanceTimersByTimeAsync(0);
    expect(reborn.net.map.size).toBe(0);
    expect(reborn.roomView().players.map((p) => p.net)).toEqual([{ q: null, rtt: null }, { q: null, rtt: null }]);
    await vi.advanceTimersByTimeAsync(3000);
    await reborn.webSocketMessage(b, JSON.stringify({ t: 'net', rtt: 400 }));
    expect(h.netOf(a, 2)).toEqual({ q: 1, rtt: 400 });
  });
});
