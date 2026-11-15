// Stored invites: POST stores (and refreshes) a row and Web-Pushes when configured, GET lists fresh
// lobby invites addressed to me, dismiss is recipient-only. Database and Durable Objects are faked.
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

const roomCallMock = vi.fn();
const hubPushMock = vi.fn(async () => 1);
vi.mock('./hub.js', async (importOriginal) => ({
  ...(await importOriginal()),
  roomCall: (...a) => roomCallMock(...a),
  pushToUser: (...a) => hubPushMock(...a),
}));

const webPushMock = vi.fn(async () => 1);
vi.mock('./push.js', async (importOriginal) => ({ ...(await importOriginal()), sendPushToUser: (...a) => webPushMock(...a) }));

// The registry is faked so these tests do not depend on the game engine (it is being rewritten in parallel).
vi.mock('./games/index.js', () => {
  const GAME_ADAPTERS = { 'hyderabad-tycoon': { id: 'hyderabad-tycoon', name: 'Kingpin' } };
  return {
    DEFAULT_GAME_ID: 'hyderabad-tycoon',
    GAME_ADAPTERS,
    getAdapter: (id) => (typeof id === 'string' && Object.hasOwn(GAME_ADAPTERS, id) ? GAME_ADAPTERS[id] : null),
  };
});

const { signSession } = await import('./auth.js');
const { _resetForTests } = await import('./ratelimit.js');
const inv = await import('./routes/invites.js');
const worker = await miniApp({ '/api/invites': inv.default });

/** The routes under test behind the same session middleware and error mapping as worker/index.js. */
async function miniApp(routes) {
  const { Hono } = await import('hono');
  const { sessionMiddleware } = await import('./auth.js');
  const { HttpError } = await import('./db.js');
  const app = new Hono();
  app.use('*', sessionMiddleware);
  for (const [path, r] of Object.entries(routes)) app.route(path, r);
  app.onError((err, c) => (err instanceof HttpError ? c.json({ error: err.message }, err.status) : c.json({ error: 'Something went wrong.' }, 500)));
  return { fetch: (req, env, ctx) => app.fetch(req, env, ctx) };
}

const env = { JWT_SECRET: 'unit-test-secret-unit-test-secret-1234', DATABASE_URL: 'postgres://fake' };
const ME = '00000000-0000-4000-8000-0000000000a1';
const FRIEND = '00000000-0000-4000-8000-0000000000b2';
const INVITE = '11111111-2222-4333-8444-555555555555';

const userRow = (id, over = {}) => ({ id, name: id === ME ? 'Me' : 'Friend', avatar: 3, friend_code: 'HYD-ME22', is_guest: false, xp: 0, coins: 0, level: 1, ...over });
const users = new Map();

async function call(path, { method = 'GET', as = ME, body, envOver = {} } = {}) {
  const headers = new Headers();
  if (as) headers.set('cookie', `hyd_session=${await signSession(env, { id: as, isGuest: users.get(as)?.is_guest })}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { ...env, ...envOver },
    {},
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}

const sqlLog = [];
function installDb(onQuery = () => undefined) {
  queryMock.mockImplementation(async (e, text, params = []) => {
    sqlLog.push({ text, params });
    const custom = onQuery(text, params);
    if (custom !== undefined) {
      if (custom instanceof Error) throw custom;
      return custom;
    }
    if (/FROM users WHERE id = \$1/.test(text)) {
      const row = users.get(params[0]);
      return row ? [row] : [];
    }
    if (/FROM friendships/.test(text)) return [{ x: 1 }];
    return [];
  });
}

beforeEach(() => {
  queryMock.mockReset();
  roomCallMock.mockReset();
  roomCallMock.mockResolvedValue({ status: 200, data: { exists: true, isMember: true, status: 'lobby', gameId: 'hyderabad-tycoon' } });
  hubPushMock.mockClear();
  webPushMock.mockClear();
  sqlLog.length = 0;
  _resetForTests();
  users.clear();
  users.set(ME, userRow(ME));
  users.set(FRIEND, userRow(FRIEND));
  installDb();
});

const stores = () => sqlLog.filter((q) => q.text === inv.STORE_INVITE_SQL);

describe('POST /api/invites (stored)', () => {
  it('stores the invite with parameters only and still answers { ok, delivered }', async () => {
    const res = await call('/api/invites', { method: 'POST', body: { code: 'abcd23', userId: FRIEND } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, delivered: true });
    expect(stores()).toEqual([{ text: inv.STORE_INVITE_SQL, params: [ME, FRIEND, 'ABCD23', 'hyderabad-tycoon'] }]);
    expect(inv.STORE_INVITE_SQL).not.toMatch(/ABCD23|00000000/); // nothing interpolated
    expect(webPushMock).not.toHaveBeenCalled(); // push is not configured
  });

  it('delivered=false when the friend is offline; the invite is stored anyway', async () => {
    hubPushMock.mockResolvedValueOnce(0);
    const res = await call('/api/invites', { method: 'POST', body: { code: 'ABCD23', userId: FRIEND } });
    expect(res.json).toEqual({ ok: true, delivered: false });
    expect(stores()).toHaveLength(1);
  });

  it('sends a Web Push to the invitee when VAPID is configured', async () => {
    const vapid = { VAPID_PUBLIC_KEY: 'k', VAPID_PRIVATE_KEY: 'p', VAPID_SUBJECT: 'mailto:a@b.c' };
    await call('/api/invites', { method: 'POST', body: { code: 'ABCD23', userId: FRIEND }, envOver: vapid });
    await new Promise((r) => setTimeout(r, 0));
    expect(webPushMock).toHaveBeenCalledWith(expect.objectContaining(vapid), FRIEND, {
      title: 'Me invited you to play',
      body: 'Kingpin · room ABCD23. Tap to join.',
      url: '/join/ABCD23',
      tag: 'invite-ABCD23',
    });
  });

  it('a failing invites table never breaks the live invite', async () => {
    installDb((text) => (text === inv.STORE_INVITE_SQL ? Object.assign(new Error('relation "invites" does not exist'), { code: '42P01' }) : undefined));
    const res = await call('/api/invites', { method: 'POST', body: { code: 'ABCD23', userId: FRIEND } });
    expect(res.json).toEqual({ ok: true, delivered: true });
  });

  it('still refuses guests, strangers, outsiders and started games without storing anything', async () => {
    users.set(ME, userRow(ME, { is_guest: true }));
    expect((await call('/api/invites', { method: 'POST', body: { code: 'ABCD23', userId: FRIEND } })).status).toBe(403);
    users.set(ME, userRow(ME));
    installDb((text) => (/FROM friendships/.test(text) ? [] : undefined));
    expect((await call('/api/invites', { method: 'POST', body: { code: 'ABCD23', userId: FRIEND } })).status).toBe(403);
    installDb();
    roomCallMock.mockResolvedValue({ status: 200, data: { exists: true, isMember: true, status: 'playing' } });
    expect((await call('/api/invites', { method: 'POST', body: { code: 'ABCD23', userId: FRIEND } })).status).toBe(409);
    expect(stores()).toEqual([]);
    expect(hubPushMock).not.toHaveBeenCalled();
  });

  it('the store statement refreshes an existing (from, to, room) row instead of duplicating it', () => {
    expect(inv.STORE_INVITE_SQL).toMatch(/UPDATE invites SET created_at = now\(\), dismissed = false/);
    expect(inv.STORE_INVITE_SQL).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM upd\)/);
  });
});

describe('GET /api/invites', () => {
  const row = {
    id: INVITE,
    room_code: 'ABCD23',
    game_id: 'hyderabad-tycoon',
    created_at: '2026-11-15T10:00:00Z',
    from_id: FRIEND,
    from_name: 'Friend',
    from_avatar: 5,
  };

  it('lists my invites in the documented shape', async () => {
    installDb((text) => (text === inv.LIST_INVITES_SQL ? [row, { ...row, id: 'x2', game_id: 'gone-game', room_code: 'ZZZZ99' }] : undefined));
    const res = await call('/api/invites');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      invites: [
        { id: INVITE, from: { id: FRIEND, name: 'Friend', avatar: 5 }, code: 'ABCD23', gameId: 'hyderabad-tycoon', gameName: 'Kingpin', createdAt: '2026-11-15T10:00:00.000Z' },
        { id: 'x2', from: { id: FRIEND, name: 'Friend', avatar: 5 }, code: 'ZZZZ99', gameId: 'gone-game', gameName: 'gone-game', createdAt: '2026-11-15T10:00:00.000Z' },
      ],
    });
    expect(sqlLog.find((q) => q.text === inv.LIST_INVITES_SQL).params).toEqual([ME]);
  });

  it('filters in SQL: to me, not dismissed, < 2 h, lobby rooms with a seat I am not in, newest first', () => {
    const q = inv.LIST_INVITES_SQL;
    expect(q).toMatch(/i\.to_id = \$1::uuid/);
    expect(q).toMatch(/NOT i\.dismissed/);
    expect(q).toMatch(/interval '2 hours'/);
    expect(q).toMatch(/JOIN rooms r ON r\.code = i\.room_code/);
    expect(q).toMatch(/r\.status = 'lobby'/);
    expect(q).toMatch(/NOT \(r\.member_ids @> ARRAY\[\$1::uuid\]\)/);
    expect(q).toMatch(/ORDER BY i\.created_at DESC/);
  });

  it('needs a session; an unmigrated database answers an empty list', async () => {
    expect((await call('/api/invites', { as: null })).status).toBe(401);
    installDb((text) => (text === inv.LIST_INVITES_SQL ? Object.assign(new Error('missing'), { code: '42P01' }) : undefined));
    expect((await call('/api/invites')).json).toEqual({ invites: [] });
    installDb((text) => (text === inv.LIST_INVITES_SQL ? new Error('neon down') : undefined));
    expect((await call('/api/invites')).status).toBe(500);
  });
});

describe('POST /api/invites/:id/dismiss', () => {
  it('only the recipient can dismiss', async () => {
    installDb((text, params) => (text === inv.DISMISS_INVITE_SQL ? (params[1] === ME ? [{ id: params[0] }] : []) : undefined));
    const ok = await call(`/api/invites/${INVITE}/dismiss`, { method: 'POST' });
    expect(ok.json).toEqual({ ok: true });
    expect(sqlLog.find((q) => q.text === inv.DISMISS_INVITE_SQL).params).toEqual([INVITE, ME]);
    const other = await call(`/api/invites/${INVITE}/dismiss`, { method: 'POST', as: FRIEND });
    expect(other.status).toBe(404);
    expect((await call('/api/invites/not-a-uuid/dismiss', { method: 'POST' })).status).toBe(400);
    expect((await call(`/api/invites/${INVITE}/dismiss`, { method: 'POST', as: null })).status).toBe(401);
  });
});
