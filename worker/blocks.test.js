// Block / mute + friend-request privacy: the /api/blocks routes and every enforcement path (friend requests by code and
// by id, search, recent, by-code preview, room invites, PATCH /api/me friendRequests). The database is a small stateful
// fake that only evaluates the block / friendship clauses the SQL really contains, so removing a clause fails a test.
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const pushMock = vi.fn(async () => 1);
const roomCallMock = vi.fn();
vi.mock('./hub.js', async (importOriginal) => ({
  ...(await importOriginal()),
  pushToUser: (...a) => pushMock(...a),
  isUserOnline: async () => false,
  roomCall: (...a) => roomCallMock(...a),
}));

vi.mock('./games/index.js', () => {
  const GAME_ADAPTERS = { 'hyderabad-tycoon': { id: 'hyderabad-tycoon', name: 'Nawabi Raj' } };
  return {
    DEFAULT_GAME_ID: 'hyderabad-tycoon',
    GAME_ADAPTERS,
    getAdapter: (id) => (typeof id === 'string' && Object.hasOwn(GAME_ADAPTERS, id) ? GAME_ADAPTERS[id] : null),
  };
});

const { signSession, sessionMiddleware } = await import('./auth.js');
const { _resetForTests } = await import('./ratelimit.js');
const { HttpError } = await import('./db.js');
const { Hono } = await import('hono');
const friendsMod = await import('./routes/friends.js');
const blocksMod = await import('./routes/blocks.js');
const invitesMod = await import('./routes/invites.js');
const meMod = await import('./routes/me.js');
const { rowToUser } = await import('./users.js');

const app = new Hono();
app.use('*', sessionMiddleware);
app.route('/api/friends', friendsMod.default);
app.route('/api/blocks', blocksMod.default);
app.route('/api/invites', invitesMod.default);
app.route('/api/me', meMod.default);
app.onError((err, c) => (err instanceof HttpError ? c.json({ error: err.message }, err.status) : c.json({ error: 'Something went wrong.' }, 500)));

const env = { JWT_SECRET: 'unit-test-secret-unit-test-secret-1234', DATABASE_URL: 'postgres://fake' };
const ME = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b2';
const GUEST = '00000000-0000-4000-8000-0000000000c3';
const NOBODY = '00000000-0000-4000-8000-0000000000d4';
const GONE = '00000000-0000-4000-8000-0000000000ff';

const NAMES = { [ME]: 'Me', [BOB]: 'Bob', [GUEST]: 'Guesty', [NOBODY]: 'Nobody' };
const CODES = { [ME]: 'HYD-ME22', [BOB]: 'HYD-BQ22', [GUEST]: 'HYD-GU22', [NOBODY]: 'HYD-NP22' };
const userRow = (id, over = {}) => ({
  id,
  google_sub: 'sub-secret',
  email: 'secret@example.com',
  name: NAMES[id],
  avatar: 3,
  friend_code: CODES[id],
  is_guest: id === GUEST,
  xp: 10,
  equipped: {},
  friend_requests: 'everyone',
  ...over,
});

let users;
let blocks; // Set of `${blocker}>${blocked}`
let friendships; // [{ user_id, friend_id, status }]
let invitesRows;
const sqlLog = [];

const pairOf = (a, b) => (f) => (f.user_id === a && f.friend_id === b) || (f.user_id === b && f.friend_id === a);
const blockedPair = (a, b) => blocks.has(`${a}>${b}`) || blocks.has(`${b}>${a}`);

function installDb() {
  queryMock.mockImplementation(async (e, text, params = []) => {
    sqlLog.push({ text, params });
    if (/FROM users WHERE id = \$1/.test(text)) return users.has(params[0]) ? [users.get(params[0])] : [];
    if (/FROM users WHERE friend_code = \$1/.test(text)) return [...users.values()].filter((u) => u.friend_code === params[0]);
    if (/^\s*SELECT user_id FROM blocks/.test(text)) {
      return [...blocks]
        .map((k) => k.split('>'))
        .filter(([a, b]) => (a === params[0] && b === params[1]) || (a === params[1] && b === params[0]))
        .map(([a]) => ({ user_id: a }));
    }
    if (/INSERT INTO blocks/.test(text)) {
      blocks.add(`${params[0]}>${params[1]}`);
      return [];
    }
    if (/DELETE FROM blocks/.test(text)) {
      blocks.delete(`${params[0]}>${params[1]}`);
      return [];
    }
    if (/FROM blocks b JOIN users u/.test(text)) {
      return [...blocks]
        .map((k) => k.split('>'))
        .filter(([a]) => a === params[0])
        .reverse()
        .map(([, b]) => users.get(b));
    }
    if (/DELETE FROM friendships/.test(text)) {
      const gone = friendships.filter(pairOf(params[0], params[1]));
      friendships = friendships.filter((f) => !pairOf(params[0], params[1])(f));
      return gone.map(({ user_id, status }) => ({ user_id, status }));
    }
    if (/DELETE FROM invites/.test(text)) {
      invitesRows = invitesRows.filter((i) => !((i.from === params[0] && i.to === params[1]) || (i.from === params[1] && i.to === params[0])));
      return [];
    }
    if (/SELECT 1 AS ok FROM friendships/.test(text)) return friendships.filter(pairOf(params[0], params[1])).map(() => ({ ok: 1 }));
    if (/SELECT 1 FROM friendships/.test(text) && /status = 'accepted'/.test(text)) {
      return friendships.filter((f) => f.status === 'accepted' && pairOf(params[0], params[1])(f)).map(() => ({ x: 1 }));
    }
    if (/UPDATE friendships SET status = 'accepted'/.test(text)) {
      const f = friendships.find((x) => x.user_id === params[0] && x.friend_id === params[1] && x.status === 'pending');
      if (f) f.status = 'accepted';
      return f ? [{ ok: 1 }] : [];
    }
    if (/INSERT INTO friendships/.test(text)) {
      if (friendships.some(pairOf(params[0], params[1]))) return [];
      friendships.push({ user_id: params[0], friend_id: params[1], status: 'pending' });
      return [{ ok: 1 }];
    }
    if (/SELECT status FROM friendships/.test(text)) return friendships.filter(pairOf(params[0], params[1])).map((f) => ({ status: f.status }));
    if (/SELECT user_id, status FROM friendships/.test(text)) return friendships.filter(pairOf(params[0], params[1]));
    if (/ILIKE/.test(text)) {
      // search: honours the block clause only when the SQL has it
      const hasClause = /NOT EXISTS[\s\S]*FROM blocks/.test(text);
      return [...users.values()]
        .filter((u) => !u.is_guest && u.id !== params[0] && (!hasClause || !blockedPair(params[0], u.id)))
        .map((u) => ({ ...u, rel_user_id: null, rel_status: null }));
    }
    if (/FROM match_players mine/.test(text)) {
      const hasClause = /NOT EXISTS[\s\S]*FROM blocks/.test(text);
      return [...users.values()]
        .filter((u) => !u.is_guest && u.id !== params[0] && (!hasClause || !blockedPair(params[0], u.id)))
        .map((u) => ({ ...u, last_played: new Date() }));
    }
    if (/INSERT INTO invites|WITH upd AS/.test(text)) return [{ id: 'x' }];
    if (/UPDATE users SET/.test(text)) {
      const sets = /SET (.*) WHERE/.exec(text)[1];
      const row = { ...users.get(params[0]) };
      if (/friend_requests = \$(\d)/.test(sets)) row.friend_requests = params[Number(/friend_requests = \$(\d)/.exec(sets)[1]) - 1];
      users.set(params[0], row);
      return [row];
    }
    return [];
  });
}

async function call(path, { method = 'GET', as = ME, body } = {}) {
  const headers = new Headers();
  if (as) headers.set('cookie', `hyd_session=${await signSession(env, { id: as, isGuest: !!users.get(as)?.is_guest })}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, {});
  return { status: res.status, json: await res.json().catch(() => null) };
}

const reqById = (userId, as = ME) => call('/api/friends/request', { method: 'POST', as, body: { userId } });
const reqByCode = (friendCode, as = ME) => call('/api/friends/request', { method: 'POST', as, body: { friendCode } });
const block = (userId, as = ME) => call('/api/blocks', { method: 'POST', as, body: { userId } });

beforeEach(() => {
  queryMock.mockReset();
  pushMock.mockClear();
  roomCallMock.mockReset();
  roomCallMock.mockResolvedValue({ status: 200, data: { exists: true, isMember: true, status: 'lobby', gameId: 'hyderabad-tycoon' } });
  sqlLog.length = 0;
  _resetForTests();
  users = new Map([ME, BOB, GUEST, NOBODY].map((id) => [id, userRow(id, id === NOBODY ? { friend_requests: 'nobody' } : {})]));
  blocks = new Set();
  friendships = [];
  invitesRows = [];
  installDb();
});

describe('GET / POST / DELETE /api/blocks', () => {
  it('lists my blocked players as { id, name, avatar } only', async () => {
    expect((await call('/api/blocks')).json).toEqual({ blocked: [] });
    await block(BOB);
    const res = await call('/api/blocks');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ blocked: [{ id: BOB, name: 'Bob', avatar: 3, handle: null }] });
    expect(JSON.stringify(res.json)).not.toMatch(/secret|HYD-|email|google/i);
  });

  it('blocking is idempotent and answers with the blocked identity', async () => {
    const a = await block(BOB);
    const b = await block(BOB);
    expect(a).toEqual({ status: 200, json: { ok: true, blocked: { id: BOB, name: 'Bob', avatar: 3, handle: null } } });
    expect(b.status).toBe(200);
    expect(blocks.size).toBe(1);
    // always a bound-parameter insert with ON CONFLICT DO NOTHING
    const ins = sqlLog.find((q) => /INSERT INTO blocks/.test(q.text));
    expect(ins.params).toEqual([ME, BOB]);
    expect(ins.text).toMatch(/ON CONFLICT DO NOTHING/);
  });

  it('validates: bad id 400, myself 400, unknown player 404', async () => {
    expect((await block('nope')).status).toBe(400);
    expect((await call('/api/blocks', { method: 'POST', body: {} })).status).toBe(400);
    expect((await block(ME)).status).toBe(400);
    expect((await block(GONE)).status).toBe(404);
    expect(blocks.size).toBe(0);
  });

  it('a guest account can be blocked (it can chat in a room)', async () => {
    expect((await block(GUEST)).status).toBe(200);
    expect(blocks.has(`${ME}>${GUEST}`)).toBe(true);
  });

  it('unblock removes the row and is idempotent', async () => {
    await block(BOB);
    expect((await call(`/api/blocks/${BOB}`, { method: 'DELETE' })).json).toEqual({ ok: true });
    expect(blocks.size).toBe(0);
    expect((await call(`/api/blocks/${BOB}`, { method: 'DELETE' })).json).toEqual({ ok: true });
    expect((await call('/api/blocks/not-a-uuid', { method: 'DELETE' })).status).toBe(400);
  });

  it('members only', async () => {
    expect((await call('/api/blocks', { as: GUEST })).status).toBe(403);
    expect((await call('/api/blocks', { as: null })).status).toBe(401);
    expect((await block(BOB, GUEST)).status).toBe(403);
    expect((await call(`/api/blocks/${BOB}`, { method: 'DELETE', as: null })).status).toBe(401);
  });

  it('blocking a friend ends the friendship both ways and tells them friend_removed', async () => {
    friendships.push({ user_id: BOB, friend_id: ME, status: 'accepted' });
    await block(BOB);
    expect(friendships).toEqual([]);
    expect(pushMock).toHaveBeenCalledWith(expect.anything(), BOB, { t: 'friend_removed', by: { id: ME, name: 'Me', avatar: 3, handle: null } });
  });

  it('blocking drops my pending request (they see it vanish) and clears room invites', async () => {
    friendships.push({ user_id: ME, friend_id: BOB, status: 'pending' });
    invitesRows.push({ from: BOB, to: ME }, { from: ME, to: BOB });
    await block(BOB);
    expect(friendships).toEqual([]);
    expect(invitesRows).toEqual([]);
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('blocking someone who asked me is silent to them: the request just goes away', async () => {
    friendships.push({ user_id: BOB, friend_id: ME, status: 'pending' });
    await block(BOB);
    expect(friendships).toEqual([]);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('blocking a stranger pushes nothing; a failing push does not fail the request', async () => {
    await block(BOB);
    expect(pushMock).not.toHaveBeenCalled();
    friendships.push({ user_id: BOB, friend_id: ME, status: 'accepted' });
    pushMock.mockRejectedValueOnce(new Error('hub down'));
    expect((await block(BOB)).status).toBe(200);
  });
});

describe('friend requests: blocks', () => {
  it('a request to someone who blocked me looks exactly like a player that does not exist', async () => {
    blocks.add(`${BOB}>${ME}`);
    const byId = await reqById(BOB);
    const unknownId = await reqById(GONE);
    expect(byId).toEqual(unknownId);
    expect(byId.status).toBe(404);
    expect(byId.json).toEqual({ error: 'No player found.' });
    const byCode = await reqByCode('HYD-BQ22');
    const unknownCode = await reqByCode('HYD-ZZ99');
    expect(byCode).toEqual(unknownCode);
    expect(byCode.status).toBe(404);
    expect(friendships).toEqual([]);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('a block never reveals itself: same body whether blocked or merely unknown, nothing about "block" anywhere', async () => {
    blocks.add(`${BOB}>${ME}`);
    const res = await reqById(BOB);
    expect(JSON.stringify(res.json)).not.toMatch(/block|privacy|not accepting/i);
  });

  it('I cannot request someone I blocked, by id or by code, and I am told why', async () => {
    await block(BOB);
    const byId = await reqById(BOB);
    const byCode = await reqByCode('HYD-BQ22');
    for (const res of [byId, byCode]) {
      expect(res.status).toBe(403);
      expect(res.json.error).toMatch(/blocked this player/i);
    }
    expect(friendships).toEqual([]);
  });

  it('when both blocked each other, I am told about my own block (never theirs)', async () => {
    blocks.add(`${ME}>${BOB}`);
    blocks.add(`${BOB}>${ME}`);
    expect((await reqById(BOB)).json.error).toMatch(/You blocked this player/);
  });

  it('unblocking restores the ability to send a request', async () => {
    await block(BOB);
    expect((await reqById(BOB)).status).toBe(403);
    await call(`/api/blocks/${BOB}`, { method: 'DELETE' });
    const ok = await reqById(BOB);
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('pending');
    expect(pushMock).toHaveBeenCalledWith(expect.anything(), BOB, expect.objectContaining({ t: 'friend_request' }));
  });

  it('and their unblocking restores it from my side too', async () => {
    blocks.add(`${BOB}>${ME}`);
    expect((await reqById(BOB)).status).toBe(404);
    blocks.delete(`${BOB}>${ME}`);
    expect((await reqById(BOB)).status).toBe(200);
  });

  it('a blocked pair cannot accept each other through the mutual-request shortcut', async () => {
    friendships.push({ user_id: BOB, friend_id: ME, status: 'pending' });
    blocks.add(`${ME}>${BOB}`);
    expect((await reqById(BOB)).status).toBe(403);
    expect(friendships[0].status).toBe('pending');
  });
});

describe("friend requests: friendRequests 'nobody'", () => {
  it('refuses a new request, by id and by code, with a neutral message', async () => {
    for (const res of [await reqById(NOBODY), await reqByCode('HYD-NP22')]) {
      expect(res.status).toBe(403);
      expect(res.json).toEqual({ error: 'This player is not accepting requests.' });
    }
    expect(friendships).toEqual([]);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("still resolves an existing row: their own request to me is accepted even though they chose 'nobody'", async () => {
    friendships.push({ user_id: NOBODY, friend_id: ME, status: 'pending' });
    const res = await reqById(NOBODY);
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('accepted');
  });

  it('a repeat request to someone who has since closed requests stays idempotent', async () => {
    friendships.push({ user_id: ME, friend_id: NOBODY, status: 'pending' });
    const res = await reqById(NOBODY);
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('pending');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('switching back to everyone restores requests', async () => {
    expect((await reqById(NOBODY)).status).toBe(403);
    users.set(NOBODY, userRow(NOBODY, { friend_requests: 'everyone' }));
    expect((await reqById(NOBODY)).status).toBe(200);
  });

  it('a block wins over the privacy setting message (no hint that they are merely closed)', async () => {
    blocks.add(`${NOBODY}>${ME}`);
    expect((await reqById(NOBODY)).json).toEqual({ error: 'No player found.' });
  });
});

describe('search, recent and the by-code preview', () => {
  const names = (res, key) => res.json[key].map((r) => r.name).sort();

  it('search hides people who blocked me and people I blocked; unblocking brings them back', async () => {
    expect(names(await call('/api/friends/search?q=bo'), 'results')).toEqual(['Bob', 'Nobody']);
    blocks.add(`${BOB}>${ME}`);
    expect(names(await call('/api/friends/search?q=bo'), 'results')).toEqual(['Nobody']);
    blocks.clear();
    await block(NOBODY);
    expect(names(await call('/api/friends/search?q=bo'), 'results')).toEqual(['Bob']);
    await call(`/api/blocks/${NOBODY}`, { method: 'DELETE' });
    expect(names(await call('/api/friends/search?q=bo'), 'results')).toEqual(['Bob', 'Nobody']);
    // the clause is in the SQL and keyed on bound parameters only
    const q = sqlLog.filter((x) => /ILIKE/.test(x.text)).pop();
    expect(q.text).toMatch(/NOT EXISTS[\s\S]*FROM blocks b[\s\S]*b\.user_id = \$1 AND b\.blocked_id = u\.id[\s\S]*b\.user_id = u\.id AND b\.blocked_id = \$1/);
  });

  it('recent players hide both directions too', async () => {
    expect(names(await call('/api/friends/recent'), 'players')).toEqual(['Bob', 'Nobody']);
    blocks.add(`${ME}>${BOB}`);
    blocks.add(`${NOBODY}>${ME}`);
    expect((await call('/api/friends/recent')).json.players).toEqual([]);
  });

  it('by-code preview treats a block (either way) as not found, identical to an unknown code', async () => {
    expect((await call('/api/friends/by-code/HYD-BQ22')).status).toBe(200);
    blocks.add(`${BOB}>${ME}`);
    const theirs = await call('/api/friends/by-code/HYD-BQ22');
    const unknown = await call('/api/friends/by-code/HYD-ZZ99');
    expect(theirs).toEqual(unknown);
    expect(theirs.status).toBe(404);
    blocks.clear();
    await block(BOB);
    expect((await call('/api/friends/by-code/HYD-BQ22')).status).toBe(404);
    await call(`/api/blocks/${BOB}`, { method: 'DELETE' });
    expect((await call('/api/friends/by-code/HYD-BQ22')).status).toBe(200);
  });
});

describe('room invites', () => {
  const invite = (userId, as = ME) => call('/api/invites', { method: 'POST', as, body: { code: 'ABCDEF', userId } });
  const stored = () => sqlLog.some((q) => /WITH upd AS/.test(q.text));

  it('works between friends, and is refused for a blocked pair in either direction', async () => {
    friendships.push({ user_id: ME, friend_id: BOB, status: 'accepted' });
    expect((await invite(BOB)).status).toBe(200);
    expect(pushMock).toHaveBeenCalledTimes(1);
    pushMock.mockClear();
    sqlLog.length = 0;

    // even if a stale friendship row survived, a block still refuses (and never reveals itself)
    blocks.add(`${BOB}>${ME}`);
    const theirs = await invite(BOB);
    expect(theirs.status).toBe(403);
    expect(theirs.json).toEqual({ error: 'You can only invite your friends.' });
    blocks.clear();
    blocks.add(`${ME}>${BOB}`);
    expect((await invite(BOB)).status).toBe(403);
    expect((await invite(ME, BOB)).status).toBe(403); // from the blocked side too
    expect(pushMock).not.toHaveBeenCalled();
    expect(stored()).toBe(false);
    expect(roomCallMock).toHaveBeenCalledTimes(1); // only the first, allowed one reached the room
  });

  it('unblocking (and re-friending) restores invites', async () => {
    await block(BOB);
    friendships.push({ user_id: ME, friend_id: BOB, status: 'accepted' });
    expect((await invite(BOB)).status).toBe(403);
    await call(`/api/blocks/${BOB}`, { method: 'DELETE' });
    expect((await invite(BOB)).status).toBe(200);
  });

  it('the invites inbox query skips invites from blocked players (either direction)', () => {
    expect(invitesMod.LIST_INVITES_SQL).toMatch(/NOT EXISTS \(SELECT 1 FROM blocks b[\s\S]*b\.blocked_id = i\.from_id[\s\S]*b\.user_id = i\.from_id AND b\.blocked_id = \$1::uuid/);
  });
});

describe('PATCH /api/me friendRequests', () => {
  it("accepts 'everyone' and 'nobody', rejects anything else, and exposes it as friendRequests", async () => {
    const nobody = await call('/api/me', { method: 'PATCH', body: { friendRequests: 'nobody' } });
    expect(nobody.status).toBe(200);
    expect(nobody.json.user.friendRequests).toBe('nobody');
    expect(users.get(ME).friend_requests).toBe('nobody');
    const sql = sqlLog.find((q) => /UPDATE users SET/.test(q.text));
    expect(sql.text).toMatch(/friend_requests = \$2/);
    expect(sql.params).toEqual([ME, 'nobody']);
    const back = await call('/api/me', { method: 'PATCH', body: { friendRequests: 'everyone' } });
    expect(back.json.user.friendRequests).toBe('everyone');
    for (const bad of ['friends', '', null, true, 1, 'NOBODY', ['nobody']]) {
      const res = await call('/api/me', { method: 'PATCH', body: { friendRequests: bad } });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('rowToUser defaults to everyone for old rows and junk values', () => {
    const base = { id: ME, name: 'Me', avatar: 1, xp: 0 };
    expect(rowToUser(base).friendRequests).toBe('everyone');
    expect(rowToUser({ ...base, friend_requests: 'junk' }).friendRequests).toBe('everyone');
    expect(rowToUser({ ...base, friend_requests: 'nobody' }).friendRequests).toBe('nobody');
  });
});
