// Usernames ("@handles"): validator, PATCH /api/me { handle }, /api/me/handle-available, and the friends
// routes that find people by handle. Database and Durable Objects are faked (same pattern as friends.test.js).
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
const { validateHandle, normalizeHandle, isReservedHandle, BLOCKED_HANDLE_WORDS } = await import('./validate.js');
const { rowToUser, rowToFriend, identity } = await import('./users.js');
const meMod = await import('./routes/me.js');
const friendsMod = await import('./routes/friends.js');
const { Hono } = await import('hono');

const app = new Hono();
app.use('*', sessionMiddleware);
app.route('/api/me', meMod.default);
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
  handle: null,
  handle_changed_at: null,
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
  users.set(FRIEND, userRow(FRIEND, { handle: 'friendly', xp: 10 }));
  users.set(GUEST, userRow(GUEST, { name: 'Guesty', is_guest: true }));
  installDb();
});

describe('validateHandle', () => {
  it('accepts 3-20 chars of [a-z0-9_] starting with a letter, lowercased', () => {
    for (const ok of ['abc', 'chai_uncle', 'a1b2c3', 'x'.repeat(20), 'a_b']) {
      expect(validateHandle(ok)).toEqual({ ok: true, value: ok });
    }
  });

  it('lowercases uppercase input, trims and drops one leading @', () => {
    expect(validateHandle('Chai_Uncle')).toEqual({ ok: true, value: 'chai_uncle' });
    expect(validateHandle('  @Teja99 ')).toEqual({ ok: true, value: 'teja99' });
  });

  it('rejects bad shapes as invalid', () => {
    for (const bad of ['', 'ab', 'x'.repeat(21), '1abc', '_abc', 'a b c', 'a-b-c', 'ab@cd', 'a__b', 'tejá99', 'ab​c', '@@abc', null, undefined, 42, {}]) {
      const v = validateHandle(bad);
      expect(v.ok, String(bad)).toBe(false);
      expect(v.reason).toBe('invalid');
      expect(typeof v.error).toBe('string');
    }
  });

  it('rejects reserved names and brand / profanity words as reserved', () => {
    for (const bad of ['admin', 'Support', 'gamehub', 'kingpin', 'system', 'moderator', 'help', 'official', 'the_gamehub_team', 'kingpin_fan', 'k1ngp1n99', 'sh1t_head']) {
      const v = validateHandle(bad);
      expect(v.ok, bad).toBe(false);
      expect(v.reason, bad).toBe('reserved');
    }
  });

  it('does not catch innocent names, and the denylist is a plain extendable array', () => {
    for (const fine of ['classic', 'assassin', 'helper1', 'adminton', 'chai_wala']) expect(isReservedHandle(fine), fine).toBe(false);
    expect(Array.isArray(BLOCKED_HANDLE_WORDS)).toBe(true);
  });

  it('normalizeHandle is the lenient lookup form', () => {
    expect(normalizeHandle('@Chai_Uncle')).toBe('chai_uncle');
    expect(normalizeHandle('chai')).toBe('chai');
    expect(normalizeHandle('HYD-7K2Q')).toBe(''); // a code has a dash
    expect(normalizeHandle('a')).toBe('');
    expect(normalizeHandle(null)).toBe('');
  });
});

describe('users.js shapes', () => {
  it('expose handle (null when unset)', () => {
    expect(rowToUser(userRow(ME)).handle).toBeNull();
    expect(rowToUser(userRow(ME, { handle: 'teja' })).handle).toBe('teja');
    expect(rowToFriend(userRow(FRIEND, { handle: 'teja' })).handle).toBe('teja');
    expect(rowToFriend(userRow(FRIEND)).handle).toBeNull();
    expect(identity(userRow(ME, { handle: 'teja' }))).toEqual({ id: ME, name: 'Me', avatar: 3, handle: 'teja' });
    expect(identity({ id: ME, name: 'Me', avatar: 3 }).handle).toBeNull();
  });
});

describe('PATCH /api/me { handle }', () => {
  const UPDATE = /UPDATE users SET/;
  const updated = (extra = {}) => (text, params) => {
    if (!UPDATE.test(text)) return undefined;
    return [userRow(ME, { handle: params[1], ...extra })];
  };

  it('claims a handle (lowercased) and stamps handle_changed_at', async () => {
    installDb(updated());
    const res = await call('/api/me', { method: 'PATCH', body: { handle: '@Chai_Uncle' } });
    expect(res.status).toBe(200);
    expect(res.json.user.handle).toBe('chai_uncle');
    const q = sqlLog.find((x) => UPDATE.test(x.text));
    expect(q.params).toEqual([ME, 'chai_uncle']);
    expect(q.text).toMatch(/handle = \$2, handle_changed_at = now\(\)/);
  });

  it('409 "That handle is taken." on a unique violation', async () => {
    installDb((text) => {
      if (UPDATE.test(text)) throw Object.assign(new Error('duplicate key value violates unique constraint "users_handle_uniq"'), { code: '23505', constraint: 'users_handle_uniq' });
      return undefined;
    });
    const res = await call('/api/me', { method: 'PATCH', body: { handle: 'taken_one' } });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('That handle is taken.');
  });

  it('400 for invalid and reserved handles, without touching the database', async () => {
    for (const handle of ['ab', '1abc', 'a__b', 'admin', 5]) {
      const res = await call('/api/me', { method: 'PATCH', body: { handle } });
      expect(res.status, String(handle)).toBe(400);
    }
    expect(sqlLog.some((x) => UPDATE.test(x.text))).toBe(false);
  });

  it('members only: a guest gets 403', async () => {
    const res = await call('/api/me', { method: 'PATCH', as: GUEST, body: { handle: 'guest_pro' } });
    expect(res.status).toBe(403);
    expect(sqlLog.some((x) => UPDATE.test(x.text))).toBe(false);
  });

  it('a guest can still rename without a handle', async () => {
    installDb((text) => (UPDATE.test(text) ? [userRow(GUEST, { name: 'New', is_guest: true })] : undefined));
    expect((await call('/api/me', { method: 'PATCH', as: GUEST, body: { name: 'New' } })).status).toBe(200);
  });

  it('re-sending the current handle is a no-op', async () => {
    users.set(ME, userRow(ME, { handle: 'mine', handle_changed_at: new Date().toISOString() }));
    const res = await call('/api/me', { method: 'PATCH', body: { handle: 'MINE' } });
    expect(res.status).toBe(200);
    expect(res.json.user.handle).toBe('mine');
    expect(sqlLog.some((x) => UPDATE.test(x.text))).toBe(false);
  });

  it('limits changing a claimed handle to once per 7 days (429 with the days left)', async () => {
    const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
    users.set(ME, userRow(ME, { handle: 'old_one', handle_changed_at: daysAgo(2) }));
    installDb(updated());
    let res = await call('/api/me', { method: 'PATCH', body: { handle: 'new_one' } });
    expect(res.status).toBe(429);
    expect(res.json.error).toMatch(/again in 5 days/);
    users.set(ME, userRow(ME, { handle: 'old_one', handle_changed_at: daysAgo(8) }));
    res = await call('/api/me', { method: 'PATCH', body: { handle: 'new_one' } });
    expect(res.status).toBe(200);
  });

  it('the first claim is never limited, even right after sign-up', () => {
    expect(meMod.handleCooldownDays({ handle: null, handle_changed_at: new Date().toISOString() })).toBe(0);
    expect(meMod.handleCooldownDays({ handle: 'x', handle_changed_at: null })).toBe(0);
    expect(meMod.handleCooldownDays({ handle: 'x', handle_changed_at: new Date().toISOString() })).toBe(7);
  });
});

describe('GET /api/me/handle-available', () => {
  const taken = (text) => (/FROM users WHERE lower\(handle\)/.test(text) ? [{ taken: 1 }] : undefined);

  it('available when nobody else has it', async () => {
    const res = await call('/api/me/handle-available?h=Fresh_Name');
    expect(res).toEqual({ status: 200, json: { available: true } });
    const q = sqlLog.find((x) => /FROM users WHERE lower\(handle\)/.test(x.text));
    expect(q.params).toEqual(['fresh_name', ME]); // lowercased, my own row excluded
  });

  it('taken / invalid / reserved reasons', async () => {
    installDb(taken);
    expect((await call('/api/me/handle-available?h=someone')).json).toEqual({ available: false, reason: 'taken' });
    expect((await call('/api/me/handle-available?h=a')).json).toEqual({ available: false, reason: 'invalid' });
    expect((await call('/api/me/handle-available')).json).toEqual({ available: false, reason: 'invalid' });
    expect((await call('/api/me/handle-available?h=admin')).json).toEqual({ available: false, reason: 'reserved' });
  });

  it('members only and rate-limited', async () => {
    expect((await call('/api/me/handle-available?h=abc', { as: GUEST })).status).toBe(403);
    expect((await call('/api/me/handle-available?h=abc', { as: null })).status).toBe(401);
    let last;
    for (let i = 0; i < 65; i++) last = await call('/api/me/handle-available?h=abc');
    expect(last.status).toBe(429);
  });
});

describe('POST /api/friends/request { handle }', () => {
  const INSERT = /INSERT INTO friendships/;
  const byHandle = (row) => (text, params) => (/FROM users WHERE lower\(handle\) = \$1/.test(text) ? (params[0] === 'friendly' ? [row] : []) : undefined);

  it('finds the player by handle (with or without @, any case) and sends the request', async () => {
    for (const h of ['friendly', '@friendly', '@Friendly']) {
      pushMock.mockClear();
      installDb((text, params) => byHandle(users.get(FRIEND))(text, params) ?? (INSERT.test(text) ? [{ ok: 1 }] : /UPDATE friendships/.test(text) ? [] : undefined));
      const res = await call('/api/friends/request', { method: 'POST', body: { handle: h } });
      expect(res.status, h).toBe(200);
      expect(res.json.status).toBe('pending');
      expect(res.json.friend.id).toBe(FRIEND);
      expect(res.json.friend.handle).toBe('friendly');
      expect(pushMock).toHaveBeenCalledWith(expect.anything(), FRIEND, { t: 'friend_request', from: { id: ME, name: 'Me', avatar: 3, handle: null } });
    }
  });

  it('400 for yourself, 404 for an unknown handle or a guest, 400 for junk', async () => {
    users.set(ME, userRow(ME, { handle: 'itsme' }));
    installDb((text, params) => (/FROM users WHERE lower\(handle\) = \$1/.test(text) ? (params[0] === 'itsme' ? [users.get(ME)] : params[0] === 'guesty' ? [users.get(GUEST)] : []) : undefined));
    expect((await call('/api/friends/request', { method: 'POST', body: { handle: '@itsme' } })).status).toBe(400);
    expect((await call('/api/friends/request', { method: 'POST', body: { handle: '@nobody' } })).status).toBe(404);
    expect((await call('/api/friends/request', { method: 'POST', body: { handle: 'guesty' } })).status).toBe(404);
    expect((await call('/api/friends/request', { method: 'POST', body: { handle: '??' } })).status).toBe(400);
    expect(sqlLog.some((x) => INSERT.test(x.text))).toBe(false);
  });

  it('a guest cannot send requests', async () => {
    expect((await call('/api/friends/request', { method: 'POST', as: GUEST, body: { handle: 'friendly' } })).status).toBe(403);
  });
});

describe('GET /api/friends/by-handle/:handle', () => {
  const lookup = (rel) => (text, params) => {
    if (/FROM users WHERE lower\(handle\) = \$1/.test(text)) return params[0] === 'friendly' ? [users.get(FRIEND)] : [];
    if (/FROM friendships/.test(text)) return rel ? [rel] : [];
    return undefined;
  };

  it('returns the profile card with my relation (leading @ optional)', async () => {
    installDb(lookup(null));
    const res = await call('/api/friends/by-handle/%40Friendly');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ user: { id: FRIEND, name: 'Friend', avatar: 3, handle: 'friendly', level: 1, friendCode: 'HYD-FR22', relation: 'none' } });
    installDb(lookup({ user_id: ME, status: 'pending' }));
    expect((await call('/api/friends/by-handle/friendly')).json.user.relation).toBe('outgoing');
    expect(JSON.stringify(res.json)).not.toMatch(/secret|google|email/i);
  });

  it('400 junk / own, 404 unknown, 403 guest, 401 anonymous', async () => {
    users.set(ME, userRow(ME, { handle: 'itsme' }));
    installDb((text, params) => (/FROM users WHERE lower\(handle\)/.test(text) ? (params[0] === 'itsme' ? [users.get(ME)] : []) : undefined));
    expect((await call('/api/friends/by-handle/hi!')).status).toBe(400);
    expect((await call('/api/friends/by-handle/itsme')).status).toBe(400);
    expect((await call('/api/friends/by-handle/nobody1')).status).toBe(404);
    expect((await call('/api/friends/by-handle/friendly', { as: GUEST })).status).toBe(403);
    expect((await call('/api/friends/by-handle/friendly', { as: null })).status).toBe(401);
  });
});

describe('GET /api/friends/search with handles', () => {
  const searchSql = () => sqlLog.find((q) => /FROM users u/.test(q.text) && /LIKE/.test(q.text));
  const found = (...rows) => installDb((text) => (/FROM users u/.test(text) && /LIKE/.test(text) ? rows : undefined));

  it('@query matches handle exact/prefix only, exact first', async () => {
    found({ ...userRow(FRIEND, { handle: 'friendly' }), rel_user_id: null, rel_status: null });
    const res = await call('/api/friends/search?q=%40Frie_');
    expect(res.status).toBe(200);
    expect(res.json.results[0].handle).toBe('friendly');
    const q = searchSql();
    expect(q.params).toEqual([ME, 'frie\\_%', 'frie_']);
    expect(q.text).toMatch(/lower\(u\.handle\) LIKE \$2/);
    expect(q.text).not.toMatch(/u\.name ILIKE/);
    expect(q.text).toMatch(/ORDER BY \(lower\(u\.handle\) = \$3\) DESC/);
    expect(q.text).toMatch(/is_guest = false/);
  });

  it('plain queries also match handle prefixes, ranking an exact handle first', async () => {
    found();
    await call('/api/friends/search?q=Chai');
    const q = searchSql();
    expect(q.params).toEqual([ME, '%Chai%', 'Chai%', 'chai%', 'chai']);
    expect(q.text).toMatch(/u\.name ILIKE \$2[\s\S]*OR lower\(u\.handle\) LIKE \$4/);
    expect(q.text).toMatch(/ORDER BY \(lower\(u\.handle\) = \$5\) DESC/);
  });

  it('"@" alone is too short', async () => {
    expect((await call('/api/friends/search?q=%40')).status).toBe(400);
  });

  it('recent players carry their handle', async () => {
    installDb((text) => (/FROM match_players mine/.test(text) ? [{ ...userRow(FRIEND, { handle: 'friendly' }), last_played: new Date() }] : undefined));
    expect((await call('/api/friends/recent')).json.players[0].handle).toBe('friendly');
  });
});

describe('GET /api/friends rows', () => {
  it('include handle', async () => {
    installDb((text) => (/FROM friendships f/.test(text) ? [{ ...userRow(FRIEND, { handle: 'friendly' }), status: 'accepted', outgoing: true }] : undefined));
    const res = await call('/api/friends');
    expect(res.json.friends[0].handle).toBe('friendly');
    expect(sqlLog.find((x) => /FROM friendships f/.test(x.text)).text).toMatch(/u\.handle/);
  });
});

describe('db/schema.sql handles block', () => {
  it('is additive, idempotent and has no backfill', async () => {
    const { readFileSync } = await import('node:fs');
    const { splitStatements, isAdditiveStatement } = await import('../scripts/migrate.js');
    const sql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
    const stmts = splitStatements(sql);
    const has = (re) => expect(stmts.some((s) => re.test(s)), String(re)).toBe(true);
    has(/^ALTER TABLE users ADD COLUMN IF NOT EXISTS handle text$/);
    has(/^ALTER TABLE users ADD COLUMN IF NOT EXISTS handle_changed_at timestamptz$/);
    has(/^CREATE UNIQUE INDEX IF NOT EXISTS users_handle_uniq\s+ON users \(lower\(handle\)\)$/);
    for (const s of stmts.filter((x) => /handle/.test(x))) expect(isAdditiveStatement(s)).toBe(true);
    expect(stmts.some((s) => /UPDATE users/i.test(s) && /handle/i.test(s))).toBe(false);
  });
});
