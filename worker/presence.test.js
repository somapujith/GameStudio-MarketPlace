// Rich friend presence on the server: the pure helpers, GameRoom telling members' hubs where they sit, UserHub storing
// the room state and pushing it to friends (and clearing it when the user goes), the friends list revealing it only for
// friends and only for a still-open lobby, and invite feedback (joined / declined).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const queryMock = vi.fn(async () => []);
vi.mock('./db.js', async (importOriginal) => ({ ...(await importOriginal()), query: (...a) => queryMock(...a) }));

const setStatusMock = vi.fn(async () => true);
const pushMock = vi.fn(async () => 1);
const onlineMock = vi.fn(async () => true);
const statusMock = vi.fn(async () => null);
const roomCallMock = vi.fn(async () => ({ status: 200, data: { exists: false } }));
vi.mock('./hub.js', async (importOriginal) => ({
  ...(await importOriginal()),
  setUserRoomStatus: (...a) => setStatusMock(...a),
  pushToUser: (...a) => pushMock(...a),
  isUserOnline: (...a) => onlineMock(...a),
  getUserStatus: (...a) => statusMock(...a),
  roomCall: (...a) => roomCallMock(...a),
}));
vi.mock('./roomsdb.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasDb: (env) => !!env && !!env.DATABASE_URL,
  upsertRoomRow: vi.fn(async () => {}),
  deleteRoomRow: vi.fn(async () => {}),
  loadEquipped: vi.fn(async () => ({})),
}));
vi.mock('./match.js', async (importOriginal) => ({ ...(await importOriginal()), persistMatch: vi.fn(async () => ({ inserted: true })) }));

const P = await import('./presence.js');
const { GameRoom } = await import('./GameRoom.js');
const { UserHub } = await import('./UserHub.js');
const feedback = await import('./invitefeedback.js');
const { signSession, sessionMiddleware } = await import('./auth.js');
const { _resetForTests } = await import('./ratelimit.js');
const { HttpError } = await import('./db.js');
const friendsMod = await import('./routes/friends.js');
const invitesMod = await import('./routes/invites.js');
const { Hono } = await import('hono');

const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const user = (n) => ({ id: U(n), name: `P${n}`, avatar: n % 12 });

// ---- pure helpers ------------------------------------------------------------------------------------------------
describe('presence helpers', () => {
  it('cleanRoomState keeps only lobby/playing with a valid code', () => {
    expect(P.cleanRoomState({ status: 'lobby', code: 'ABCD23', gameId: 'hyderabad-tycoon' })).toEqual({ status: 'lobby', code: 'ABCD23', gameId: 'hyderabad-tycoon' });
    expect(P.cleanRoomState({ status: 'playing', code: 'ABCD23' })).toEqual({ status: 'playing', code: 'ABCD23' });
    for (const bad of [null, 'x', {}, { status: 'online' }, { status: 'lobby' }, { status: 'lobby', code: 'a b' }, { status: 'offline', code: 'ABCD23' }]) {
      expect(P.cleanRoomState(bad)).toBeNull();
    }
  });

  it('effectiveStatus / presenceMessage: offline wins, extras only with a room', () => {
    expect(P.effectiveStatus(false, { status: 'lobby', code: 'ABCD23' })).toEqual({ status: 'offline' });
    expect(P.effectiveStatus(true, null)).toEqual({ status: 'online' });
    expect(P.presenceMessage(U(1), true, null)).toEqual({ t: 'presence', userId: U(1), online: true, status: 'online' });
    expect(P.presenceMessage(U(1), true, { status: 'lobby', code: 'ABCD23', gameId: 'g' })).toEqual({
      t: 'presence',
      userId: U(1),
      online: true,
      status: 'lobby',
      code: 'ABCD23',
      gameId: 'g',
    });
    expect(P.presenceMessage(U(1), false, { status: 'lobby', code: 'ABCD23' })).toEqual({ t: 'presence', userId: U(1), online: false, status: 'offline' });
  });

  it('roomMemberStates: lobby needs a live socket, playing covers every present human, finished nobody', () => {
    const room = { code: 'ABCD23', gameId: 'g', status: 'lobby', players: [{ id: 'a' }, { id: 'b' }, { id: 'c', left: true }] };
    expect([...P.roomMemberStates(room, new Set(['a']))]).toEqual([['a', { status: 'lobby', code: 'ABCD23', gameId: 'g' }]]);
    expect([...P.roomMemberStates({ ...room, status: 'playing' }, new Set(['a'])).keys()]).toEqual(['a', 'b']);
    expect(P.roomMemberStates({ ...room, status: 'finished' }, new Set(['a'])).size).toBe(0);
    expect(P.roomMemberStates(null, new Set()).size).toBe(0);
  });

  it('diffStates only reports changes and clears who left', () => {
    const lobby = { status: 'lobby', code: 'ABCD23', gameId: 'g' };
    const sent = new Map([
      ['a', lobby],
      ['b', lobby],
    ]);
    expect(
      P.diffStates(
        sent,
        new Map([
          ['a', lobby],
          ['b', lobby],
        ]),
      ),
    ).toEqual([]);
    expect(P.diffStates(sent, new Map([['a', { ...lobby, status: 'playing' }]]))).toEqual([
      ['a', { ...lobby, status: 'playing' }],
      ['b', null],
    ]);
    expect(P.diffStates(new Map(), new Map([['c', lobby]]))).toEqual([['c', lobby]]);
  });

  it('isJoinableLobby needs an existing open lobby with a free seat', () => {
    expect(P.isJoinableLobby({ exists: true, status: 'lobby', players: 2, maxPlayers: 4 }, 'ABCD23')).toBe(true);
    expect(P.isJoinableLobby({ exists: true, status: 'lobby', players: 4, maxPlayers: 4 }, 'ABCD23')).toBe(false);
    expect(P.isJoinableLobby({ exists: true, status: 'playing', players: 2, maxPlayers: 4 }, 'ABCD23')).toBe(false);
    expect(P.isJoinableLobby({ exists: false }, 'ABCD23')).toBe(false);
    expect(P.isJoinableLobby(null, 'ABCD23')).toBe(false);
  });
});

// ---- UserHub -----------------------------------------------------------------------------------------------------
function hubCtx() {
  const store = new Map();
  const sockets = [];
  return {
    store,
    sockets,
    storage: {
      get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
      put: async (k, v) => void store.set(k, structuredClone(v)),
      delete: async (k) => void store.delete(k),
      setAlarm: async () => {},
    },
    getWebSockets: () => sockets,
    acceptWebSocket: (ws) => sockets.push(ws),
    waitUntil: (p) => p,
  };
}
const hubSocket = () => ({
  readyState: 1,
  sent: [],
  send(m) {
    this.sent.push(JSON.parse(m));
  },
  serializeAttachment() {},
});
const FRIENDS = [{ fid: U(2) }, { fid: U(3) }];

describe('UserHub room state', () => {
  let ctx;
  let hub;
  let me;
  beforeEach(() => {
    pushMock.mockClear();
    queryMock.mockReset();
    queryMock.mockImplementation(async () => FRIENDS);
    ctx = hubCtx();
    hub = new UserHub(ctx, {});
    ctx.store.set('userId', U(1));
    me = hubSocket();
    ctx.sockets.push(me);
  });
  const post = (path, body) => hub.fetch({ url: `https://x${path}`, method: 'POST', headers: new Headers(), json: async () => body });
  const get = async (path) => (await hub.fetch({ url: `https://x${path}`, method: 'GET', headers: new Headers() })).json();

  it('stores a lobby, pushes status/code/gameId to every accepted friend and answers /online with it', async () => {
    const res = await post('/status', { status: 'lobby', code: 'ABCD23', gameId: 'hyderabad-tycoon' });
    expect(await res.json()).toEqual({ accepted: true });
    const expected = { t: 'presence', userId: U(1), online: true, status: 'lobby', code: 'ABCD23', gameId: 'hyderabad-tycoon' };
    expect(pushMock.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [U(2), expected],
      [U(3), expected],
    ]);
    expect(await get('/online')).toEqual({ online: true, status: 'lobby', code: 'ABCD23', gameId: 'hyderabad-tycoon' });
  });

  it('does not repeat an identical status, and moves lobby -> playing -> online', async () => {
    await post('/status', { status: 'lobby', code: 'ABCD23' });
    pushMock.mockClear();
    await post('/status', { status: 'lobby', code: 'ABCD23' });
    expect(pushMock).not.toHaveBeenCalled();
    await post('/status', { status: 'playing', code: 'ABCD23' });
    expect(pushMock.mock.calls[0][2]).toMatchObject({ status: 'playing', code: 'ABCD23' });
    pushMock.mockClear();
    await post('/status', { status: 'online' });
    expect(pushMock.mock.calls[0][2]).toEqual({ t: 'presence', userId: U(1), online: true, status: 'online' });
    expect(await get('/online')).toEqual({ online: true, status: 'online' });
  });

  it('ignores a room state while the user is offline, and offline clears a stored one (after the debounce)', async () => {
    ctx.sockets.length = 0;
    expect(await (await post('/status', { status: 'lobby', code: 'ABCD23' })).json()).toEqual({ accepted: false });
    expect(ctx.store.has('room')).toBe(false);

    ctx.sockets.push(me);
    await post('/status', { status: 'playing', code: 'ABCD23' });
    pushMock.mockClear();
    me.readyState = 3; // socket gone; the alarm fires after the debounce
    await hub.alarm();
    expect(pushMock.mock.calls[0][2]).toEqual({ t: 'presence', userId: U(1), online: false, status: 'offline' });
    expect(ctx.store.has('room')).toBe(false);
    expect(await get('/online')).toEqual({ online: false, status: 'offline' });
  });

  it('a reload inside the debounce keeps the status (the alarm sees a live socket)', async () => {
    await post('/status', { status: 'lobby', code: 'ABCD23' });
    pushMock.mockClear();
    await hub.alarm();
    expect(pushMock).not.toHaveBeenCalled();
    expect(ctx.store.get('room')).toMatchObject({ status: 'lobby' });
  });

  it('rejects junk bodies as "not in a room"', async () => {
    await post('/status', { status: 'lobby', code: 'ABCD23' });
    await post('/status', { status: 'lobby', code: '<script>' });
    expect(ctx.store.has('room')).toBe(false);
  });
});

// ---- GameRoom -> hub -----------------------------------------------------------------------------------------------
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
}
class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket;
  }
}
function roomCtx() {
  const store = new Map();
  const sockets = [];
  return {
    store,
    sockets,
    storage: {
      get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
      put: async (k, v) => void store.set(k, structuredClone(v)),
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
    getWebSockets: (tag) => (tag ? sockets.filter((s) => s.tags.includes(tag)) : [...sockets]),
  };
}
class Harness {
  constructor() {
    this.ctx = roomCtx();
    this.room = new GameRoom(this.ctx, { DATABASE_URL: 'postgres://fake' });
  }
  async init(host = user(1)) {
    await this.room.fetch({ url: 'https://x/init', method: 'POST', headers: new Headers(), json: async () => ({ code: 'ABCD23', host, settings: {}, maxPlayers: 4 }) });
  }
  async connect(u, guest = '0') {
    const headers = new Headers({ Upgrade: 'websocket', 'X-User-Id': u.id, 'X-User-Name': encodeURIComponent(u.name), 'X-User-Avatar': String(u.avatar), 'X-User-Guest': guest });
    const before = this.ctx.sockets.length;
    const res = await this.room.fetch({ url: 'https://x/ws', method: 'GET', headers });
    expect(res.status).toBe(101);
    await this.room.hubJob;
    return this.ctx.sockets[before];
  }
  say(ws, msg) {
    return this.room.webSocketMessage(ws, JSON.stringify(msg));
  }
  async drop(ws) {
    ws.readyState = 3;
    await this.room.webSocketClose(ws, 1006);
    await this.room.hubJob;
  }
}
const calls = () => setStatusMock.mock.calls.map((c) => [c[1], c[2]]);

describe('GameRoom tells member hubs where they sit', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'WebSocketPair',
      class {
        constructor() {
          this[0] = new FakeSocket();
          this[1] = new FakeSocket();
        }
      },
    );
    vi.stubGlobal('Response', FakeResponse);
    vi.stubGlobal('WebSocketRequestResponsePair', class {});
    setStatusMock.mockReset();
    setStatusMock.mockImplementation(async () => true);
    pushMock.mockClear();
    queryMock.mockReset();
    queryMock.mockImplementation(async () => []);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lobby on entering, playing on start, cleared when the room finishes', async () => {
    const h = new Harness();
    await h.init();
    const a = await h.connect(user(1));
    expect(calls()).toEqual([[U(1), { status: 'lobby', code: 'ABCD23', gameId: 'hyderabad-tycoon' }]]);
    await h.connect(user(2));
    expect(calls().at(-1)).toEqual([U(2), { status: 'lobby', code: 'ABCD23', gameId: 'hyderabad-tycoon' }]);
    setStatusMock.mockClear();

    await h.say(a, { t: 'start' });
    await h.room.hubJob;
    expect(h.room.room.status).toBe('playing');
    expect(calls().map(([, s]) => s.status)).toEqual(['playing', 'playing']);
    setStatusMock.mockClear();
    await h.room.save(); // no change: nothing is re-sent
    await h.room.hubJob;
    expect(setStatusMock).not.toHaveBeenCalled();

    h.room.room.status = 'finished';
    await h.room.save();
    await h.room.hubJob;
    expect(calls().sort()).toEqual([[U(1), null], [U(2), null]].sort());
  });

  it('clears a member who leaves, is kicked, or whose socket dropped while still in the lobby', async () => {
    const h = new Harness();
    await h.init();
    const a = await h.connect(user(1));
    const b = await h.connect(user(2));
    const c = await h.connect(user(3));
    setStatusMock.mockClear();
    await h.say(b, { t: 'leave' });
    await h.room.hubJob;
    expect(calls()).toEqual([[U(2), null]]);
    setStatusMock.mockClear();
    await h.say(a, { t: 'kick', id: U(3) });
    await h.room.hubJob;
    expect(calls()).toEqual([[U(3), null]]);
    expect(c.readyState).toBe(3);
    setStatusMock.mockClear();
    await h.drop(a);
    expect(calls()).toEqual([[U(1), null]]);
    await h.connect(user(1)); // coming back tells the hub again
    expect(calls().at(-1)).toEqual([U(1), { status: 'lobby', code: 'ABCD23', gameId: 'hyderabad-tycoon' }]);
  });

  it('retries a hub that was offline (not accepted) only after the retry window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
    try {
      setStatusMock.mockImplementation(async () => false);
      const h = new Harness();
      await h.init();
      await h.connect(user(1));
      expect(setStatusMock).toHaveBeenCalledTimes(1);
      await h.room.save();
      await h.room.hubJob;
      expect(setStatusMock).toHaveBeenCalledTimes(1); // too soon
      vi.setSystemTime(Date.now() + 21_000);
      await h.room.save();
      await h.room.hubJob;
      expect(setStatusMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives a failing hub', async () => {
    setStatusMock.mockImplementation(async () => {
      throw new Error('boom');
    });
    const h = new Harness();
    await h.init();
    await expect(h.connect(user(1))).resolves.toBeDefined();
  });

  it('tells inviters when an invited friend sits down (members only, never for the host or guests)', async () => {
    queryMock.mockImplementation(async (_env, text) => (text === feedback.FULFIL_INVITES_SQL ? [{ from_id: U(1) }] : []));
    const h = new Harness();
    await h.init();
    await h.connect(user(1));
    await h.room.inviteJoined;
    expect(pushMock).not.toHaveBeenCalled(); // the host is not a "new member"
    await h.connect(user(2));
    await h.room.inviteJoined;
    expect(pushMock).toHaveBeenCalledWith(expect.anything(), U(1), { t: 'invite_joined', by: { id: U(2), name: 'P2', avatar: 2 }, code: 'ABCD23' });
    pushMock.mockClear();
    await h.connect(user(3), '1'); // guests have no friends and nobody invited them
    await h.room.inviteJoined;
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('notifyInviteJoined', () => {
  beforeEach(() => {
    pushMock.mockClear();
    queryMock.mockReset();
  });
  it('is one-shot SQL: marks fresh open invites for this room and joiner as used', () => {
    expect(feedback.FULFIL_INVITES_SQL).toMatch(/SET dismissed = true/);
    expect(feedback.FULFIL_INVITES_SQL).toMatch(/to_id = \$1::uuid AND room_code = \$2::text AND NOT dismissed/);
    expect(feedback.FULFIL_INVITES_SQL).toMatch(/RETURNING from_id/);
  });
  it('de-duplicates inviters, skips the joiner and tolerates failures', async () => {
    queryMock.mockResolvedValueOnce([{ from_id: U(1) }, { from_id: U(1) }, { from_id: U(2) }]);
    expect(await feedback.notifyInviteJoined({ DATABASE_URL: 'x' }, 'ABCD23', user(2))).toBe(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
    queryMock.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));
    expect(await feedback.notifyInviteJoined({ DATABASE_URL: 'x' }, 'ABCD23', user(2))).toBe(0);
    expect(await feedback.notifyInviteJoined({}, 'ABCD23', user(2))).toBe(0); // no database configured
  });
});

// ---- HTTP routes -----------------------------------------------------------------------------------------------------
const env = { JWT_SECRET: 'unit-test-secret-unit-test-secret-1234', DATABASE_URL: 'postgres://fake' };
const app = new Hono();
app.use('*', sessionMiddleware);
app.route('/api/friends', friendsMod.default);
app.route('/api/invites', invitesMod.default);
app.onError((err, c) => (err instanceof HttpError ? c.json({ error: err.message }, err.status) : c.json({ error: 'Something went wrong.' }, 500)));

async function call(path, { method = 'GET', as = U(1), body } = {}) {
  const headers = new Headers({ cookie: `hyd_session=${await signSession(env, { id: as, isGuest: false })}` });
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, json: await res.json() };
}
const userRow = (n) => ({ id: U(n), google_sub: 's', email: 'e@x', name: `P${n}`, avatar: 1, friend_code: `HYD-AB${n}2`, is_guest: false, xp: 0, equipped: {} });

describe('GET /api/friends status', () => {
  beforeEach(() => {
    _resetForTests();
    queryMock.mockReset();
    onlineMock.mockReset();
    statusMock.mockReset();
    roomCallMock.mockReset();
    queryMock.mockImplementation(async (_e, text) => {
      if (/FROM friendships f/.test(text)) {
        return [
          { ...userRow(2), status: 'accepted', outgoing: true },
          { ...userRow(3), status: 'accepted', outgoing: true },
          { ...userRow(4), status: 'accepted', outgoing: true },
          { ...userRow(5), status: 'pending', outgoing: false },
        ];
      }
      return [{ id: U(1), name: 'P1', avatar: 1, is_guest: false }];
    });
  });

  it('offline, online, open lobby (verified through /info) and playing', async () => {
    onlineMock.mockImplementation(async (_e, id) => id !== U(4));
    statusMock.mockImplementation(async (_e, id) =>
      id === U(2)
        ? { online: true, status: 'lobby', code: 'ABCD23', gameId: 'hyderabad-tycoon' }
        : { online: true, status: 'playing', code: 'WXYZ23', gameId: 'hyderabad-tycoon' },
    );
    roomCallMock.mockResolvedValue({ status: 200, data: { exists: true, status: 'lobby', players: 1, maxPlayers: 4, gameId: 'hyderabad-tycoon' } });
    const res = await call('/api/friends');
    const by = Object.fromEntries(res.json.friends.map((f) => [f.id, f]));
    expect(by[U(2)]).toMatchObject({ online: true, status: 'lobby', code: 'ABCD23', gameId: 'hyderabad-tycoon' });
    expect(by[U(3)]).toMatchObject({ online: true, status: 'playing', gameId: 'hyderabad-tycoon' });
    expect(by[U(3)].code).toBeUndefined(); // a running game's code is never revealed
    expect(by[U(4)]).toMatchObject({ online: false, status: 'offline' });
    expect(roomCallMock).toHaveBeenCalledTimes(1);
    expect(roomCallMock.mock.calls[0].slice(1)).toEqual(['ABCD23', '/info']);
    // pending requests carry no status at all
    expect(res.json.incoming[0].status).toBeUndefined();
    expect(res.json.incoming[0].code).toBeUndefined();
  });

  it('a lobby that started, filled up, vanished or cannot be reached falls back to plain online', async () => {
    onlineMock.mockResolvedValue(true);
    statusMock.mockResolvedValue({ online: true, status: 'lobby', code: 'ABCD23', gameId: 'g' });
    for (const answer of [
      { exists: true, status: 'playing', players: 2, maxPlayers: 4 },
      { exists: true, status: 'lobby', players: 4, maxPlayers: 4 },
      { exists: false },
    ]) {
      roomCallMock.mockResolvedValue({ status: 200, data: answer });
      const f = (await call('/api/friends')).json.friends[0];
      expect(f).toMatchObject({ online: true, status: 'online' });
      expect(f.code).toBeUndefined();
    }
    roomCallMock.mockRejectedValue(new Error('down'));
    expect((await call('/api/friends')).json.friends[0]).toMatchObject({ status: 'online' });
    statusMock.mockResolvedValue(null); // hub unreachable
    expect((await call('/api/friends')).json.friends[0]).toMatchObject({ status: 'online' });
  });
});

describe('POST /api/invites/:id/dismiss feedback', () => {
  const INVITE = '00000000-0000-4000-8000-0000000000f1';
  beforeEach(() => {
    _resetForTests();
    pushMock.mockClear();
    queryMock.mockReset();
  });
  it('tells the sender once that the invite was declined', async () => {
    queryMock.mockImplementation(async (_e, text) => (text === invitesMod.DISMISS_INVITE_SQL ? [{ id: INVITE, from_id: U(2), room_code: 'ABCD23', was_dismissed: false }] : [{ id: U(1), name: 'P1', avatar: 1, is_guest: false }]));
    expect((await call(`/api/invites/${INVITE}/dismiss`, { method: 'POST', as: U(1) })).json).toEqual({ ok: true });
    expect(pushMock).toHaveBeenCalledWith(expect.anything(), U(2), { t: 'invite_declined', by: { id: U(1), name: 'P1', avatar: expect.anything() }, code: 'ABCD23' });
  });
  it('does not notify again for an already dismissed invite', async () => {
    queryMock.mockImplementation(async (_e, text) => (text === invitesMod.DISMISS_INVITE_SQL ? [{ id: INVITE, from_id: U(2), room_code: 'ABCD23', was_dismissed: true }] : [{ id: U(1), name: 'P1', avatar: 1, is_guest: false }]));
    expect((await call(`/api/invites/${INVITE}/dismiss`, { method: 'POST', as: U(1) })).status).toBe(200);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
