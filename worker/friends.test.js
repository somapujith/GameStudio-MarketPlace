// Friends API additions: request by userId, name search, recent players, friend_removed push.
// Database and Durable Objects are faked (same pattern as invites.test.js).
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
vi.mock('./hub.js', async (importOriginal) => ({
  ...(await importOriginal()),
  pushToUser: (...a) => pushMock(...a),
  isUserOnline: async () => false,
}));

const { signSession, sessionMiddleware } = await import('./auth.js');
const { _resetForTests } = await import('./ratelimit.js');
const { HttpError } = await import('./db.js');
const friendsMod = await import('./routes/friends.js');
const { Hono } = await import('hono');

const app = new Hono();
app.use('*', sessionMiddleware);
app.route('/api/friends', friendsMod.default);
app.onError((err, c) => (err instanceof HttpError ? c.json({ error: err.message }, err.status) : c.json({ error: 'Something went wrong.' }, 500)));

const env = { JWT_SECRET: 'unit-test-secret-unit-test-secret-1234', DATABASE_URL: 'postgres://fake' };
const ME = '00000000-0000-4000-8000-0000000000a1';
const FRIEND = '00000000-0000-4000-8000-0000000000b2';
const GUEST = '00000000-0000-4000-8000-0000000000c3';

const userRow = (id, over = {}) => ({
  id,
  google_sub: 'sub-secret',
  email: 'secret@example.com',
  name: id === ME ? 'Me' : 'Friend',
  avatar: 3,
  friend_code: id === ME ? 'HYD-ME22' : 'HYD-FR22',
  is_guest: false,
  xp: 250,
  equipped: {},
  ...over,
});
const users = new Map();
const sqlLog = [];

async function call(path, { method = 'GET', as = ME, body } = {}) {
  const headers = new Headers();
  if (as) headers.set('cookie', `hyd_session=${await signSession(env, { id: as, isGuest: !!users.get(as)?.is_guest })}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await app.fetch(
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    {},
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}

function installDb(onQuery = () => undefined) {
  queryMock.mockImplementation(async (e, text, params = []) => {
    sqlLog.push({ text, params });
    const custom = onQuery(text, params);
    if (custom !== undefined) return custom;
    if (/FROM users WHERE id = \$1/.test(text)) {
      const row = users.get(params[0]);
      return row ? [row] : [];
    }
    return [];
  });
}

beforeEach(() => {
  queryMock.mockReset();
  pushMock.mockClear();
  sqlLog.length = 0;
  _resetForTests();
  users.clear();
  users.set(ME, userRow(ME));
  users.set(FRIEND, userRow(FRIEND, { xp: 10 }));
  users.set(GUEST, userRow(GUEST, { name: 'Guesty', is_guest: true }));
  installDb();
});

describe('POST /api/friends/request { userId }', () => {
  const INSERT = /INSERT INTO friendships/;
  const ACCEPT = /UPDATE friendships SET status = 'accepted'/;

  it('creates a pending request and pushes friend_request', async () => {
    installDb((text) => (INSERT.test(text) ? [{ ok: 1 }] : ACCEPT.test(text) ? [] : undefined));
    const res = await call('/api/friends/request', { method: 'POST', body: { userId: FRIEND } });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.status).toBe('pending');
    expect(res.json.friend.id).toBe(FRIEND);
    expect(pushMock).toHaveBeenCalledWith(expect.anything(), FRIEND, { t: 'friend_request', from: { id: ME, name: 'Me', avatar: 3, handle: null } });
  });

  it('auto-accepts when they already asked me, and pushes friend_accepted', async () => {
    installDb((text, params) => (ACCEPT.test(text) ? (params[0] === FRIEND && params[1] === ME ? [{ ok: 1 }] : []) : undefined));
    const res = await call('/api/friends/request', { method: 'POST', body: { userId: FRIEND } });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('accepted');
    expect(pushMock).toHaveBeenCalledWith(expect.anything(), FRIEND, { t: 'friend_accepted', by: { id: ME, name: 'Me', avatar: 3, handle: null } });
  });

  it('is idempotent: an existing row reports its status and pushes nothing', async () => {
    installDb((text) => (INSERT.test(text) || ACCEPT.test(text) ? [] : /SELECT status FROM friendships/.test(text) ? [{ status: 'accepted' }] : undefined));
    const res = await call('/api/friends/request', { method: 'POST', body: { userId: FRIEND } });
    expect(res.json.status).toBe('accepted');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('refuses a bad id (400), an unknown or guest player (404) and myself (400)', async () => {
    expect((await call('/api/friends/request', { method: 'POST', body: { userId: 'nope' } })).status).toBe(400);
    expect((await call('/api/friends/request', { method: 'POST', body: { userId: 42 } })).status).toBe(400);
    expect((await call('/api/friends/request', { method: 'POST', body: { userId: '00000000-0000-4000-8000-0000000000ff' } })).status).toBe(404);
    expect((await call('/api/friends/request', { method: 'POST', body: { userId: GUEST } })).status).toBe(404);
    expect((await call('/api/friends/request', { method: 'POST', body: { userId: ME } })).status).toBe(400);
    expect(sqlLog.some((q) => INSERT.test(q.text))).toBe(false);
  });

  it('still accepts { friendCode } and still 400s with neither', async () => {
    installDb((text, params) => {
      if (/FROM users WHERE friend_code = \$1/.test(text)) return params[0] === 'HYD-FR22' ? [users.get(FRIEND)] : [];
      if (INSERT.test(text)) return [{ ok: 1 }];
      if (ACCEPT.test(text)) return [];
      return undefined;
    });
    const res = await call('/api/friends/request', { method: 'POST', body: { friendCode: 'hyd-fr22' } });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('pending');
    expect((await call('/api/friends/request', { method: 'POST', body: {} })).status).toBe(400);
  });

  it('guests cannot use it', async () => {
    expect((await call('/api/friends/request', { method: 'POST', as: GUEST, body: { userId: FRIEND } })).status).toBe(403);
    expect((await call('/api/friends/request', { method: 'POST', as: null, body: { userId: FRIEND } })).status).toBe(401);
  });
});

describe('GET /api/friends/search', () => {
  const found = (...rows) => installDb((text) => (/FROM users u/.test(text) && /ILIKE/.test(text) ? rows : undefined));
  const searchSql = () => sqlLog.find((q) => /ILIKE/.test(q.text));

  it('validates the query: 2..40 characters after trimming', async () => {
    expect((await call('/api/friends/search')).status).toBe(400);
    expect((await call('/api/friends/search?q=a')).status).toBe(400);
    expect((await call('/api/friends/search?q=%20a%20')).status).toBe(400);
    expect((await call(`/api/friends/search?q=${'x'.repeat(41)}`)).status).toBe(400);
    expect(searchSql()).toBeUndefined();
    found();
    expect((await call(`/api/friends/search?q=${'x'.repeat(40)}`)).status).toBe(200);
  });

  it('maps each row to a card with its relation', async () => {
    const row = (id, name, rel) => ({ ...userRow(id, { name }), rel_user_id: rel?.user_id ?? null, rel_status: rel?.status ?? null });
    const A = '00000000-0000-4000-8000-0000000000d1';
    const B = '00000000-0000-4000-8000-0000000000d2';
    const C = '00000000-0000-4000-8000-0000000000d3';
    const D = '00000000-0000-4000-8000-0000000000d4';
    found(
      row(A, 'Anna'),
      row(B, 'Anil', { user_id: ME, status: 'accepted' }),
      row(C, 'Ankit', { user_id: ME, status: 'pending' }),
      row(D, 'Anya', { user_id: D, status: 'pending' }),
    );
    const res = await call('/api/friends/search?q=an');
    expect(res.status).toBe(200);
    expect(res.json.results.map((r) => [r.name, r.relation])).toEqual([
      ['Anna', 'none'],
      ['Anil', 'friends'],
      ['Ankit', 'outgoing'],
      ['Anya', 'incoming'],
    ]);
    expect(res.json.results[0]).toEqual({ id: A, name: 'Anna', avatar: 3, handle: null, level: expect.any(Number), equipped: {}, relation: 'none' });
  });

  it('never leaks email, google_sub or friend_code', async () => {
    found({ ...userRow(FRIEND), rel_user_id: null, rel_status: null });
    const res = await call('/api/friends/search?q=fri');
    const text = JSON.stringify(res.json);
    expect(text).not.toMatch(/secret|sub-secret|HYD-|friendCode|friend_code|email|google/i);
    expect(Object.keys(res.json.results[0]).sort()).toEqual(['avatar', 'equipped', 'handle', 'id', 'level', 'name', 'relation']);
  });

  it('passes the term as a parameter with LIKE wildcards escaped; members only, never me, max 8', async () => {
    found();
    await call(`/api/friends/search?q=${encodeURIComponent(' 50%_off\\x ')}`);
    const q = searchSql();
    expect(q.params).toEqual([ME, '%50\\%\\_off\\\\x%', '50\\%\\_off\\\\x%', '50\\%\\_off\\\\x%', '50%_off\\x']);
    expect(q.text).not.toMatch(/off/); // nothing interpolated
    expect(q.text).toMatch(/is_guest = false/);
    expect(q.text).toMatch(/u\.id <> \$1/);
    expect(q.text).toMatch(/LIMIT 8\b/);
    expect(q.text).toMatch(/ESCAPE/);
    expect(q.text).not.toMatch(/email|google_sub/);
  });

  it('escapeLike escapes backslash, percent and underscore', () => {
    expect(friendsMod.escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    expect(friendsMod.escapeLike('plain')).toBe('plain');
  });

  it('is not shadowed by the :userId routes, needs a member and is rate-limited', async () => {
    found();
    expect((await call('/api/friends/search?q=ab')).status).toBe(200);
    expect((await call('/api/friends/search?q=ab', { as: GUEST })).status).toBe(403);
    expect((await call('/api/friends/search?q=ab', { as: null })).status).toBe(401);
    let last;
    for (let i = 0; i < 45; i++) last = await call('/api/friends/search?q=ab');
    expect(last.status).toBe(429);
  });
});

describe('GET /api/friends/recent', () => {
  it('returns recent co-players as relation:none cards (empty when nobody)', async () => {
    expect((await call('/api/friends/recent')).json).toEqual({ players: [] });
    installDb((text) => (/FROM match_players mine/.test(text) ? [{ ...userRow(FRIEND), last_played: new Date() }] : undefined));
    const res = await call('/api/friends/recent');
    expect(res.status).toBe(200);
    expect(res.json.players).toEqual([{ id: FRIEND, name: 'Friend', avatar: 3, handle: null, level: expect.any(Number), equipped: {}, relation: 'none' }]);
    expect(JSON.stringify(res.json)).not.toMatch(/secret|HYD-|friend_code/i);
  });

  it('queries by my id only, skips guests, friends and pending, caps at 12', async () => {
    await call('/api/friends/recent');
    const q = sqlLog.find((x) => /FROM match_players mine/.test(x.text));
    expect(q.params).toEqual([ME]);
    expect(q.text).toMatch(/is_guest = false/);
    expect(q.text).toMatch(/NOT EXISTS[\s\S]*friendships/);
    expect(q.text).toMatch(/ORDER BY last_played DESC/);
    expect(q.text).toMatch(/LIMIT 12\b/);
    expect(q.text).not.toMatch(/email|google_sub|friend_code/);
  });

  it('members only', async () => {
    expect((await call('/api/friends/recent', { as: GUEST })).status).toBe(403);
    expect((await call('/api/friends/recent', { as: null })).status).toBe(401);
  });
});

describe('DELETE /api/friends/:userId', () => {
  it('pushes friend_removed with my identity to the other player', async () => {
    installDb((text) => (/DELETE FROM friendships/.test(text) ? [{ ok: 1 }] : undefined));
    const res = await call(`/api/friends/${FRIEND}`, { method: 'DELETE' });
    expect(res).toEqual({ status: 200, json: { ok: true } });
    expect(pushMock).toHaveBeenCalledWith(expect.anything(), FRIEND, { t: 'friend_removed', by: { id: ME, name: 'Me', avatar: 3, handle: null } });
  });

  it('stays idempotent and silent when there was nothing to remove', async () => {
    const res = await call(`/api/friends/${FRIEND}`, { method: 'DELETE' });
    expect(res.json).toEqual({ ok: true });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('a failing push does not fail the request', async () => {
    installDb((text) => (/DELETE FROM friendships/.test(text) ? [{ ok: 1 }] : undefined));
    pushMock.mockRejectedValueOnce(new Error('hub down'));
    expect((await call(`/api/friends/${FRIEND}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('rejects a malformed id', async () => {
    expect((await call('/api/friends/not-a-uuid', { method: 'DELETE' })).status).toBe(400);
  });
});
