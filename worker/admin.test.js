// In-process tests of the admin console API, bans and player notifications (docs/ADMIN.md), with the database and
// the Durable Objects faked (as in routes.test.js): queries are routed by their SQL text.
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
  roomCall: vi.fn(),
  pushToUser: (...a) => pushMock(...a),
  isUserOnline: async () => false,
}));

const { default: worker } = await import('./index.js');
const { signSession } = await import('./auth.js');
const { _resetForTests } = await import('./ratelimit.js');
const { effectiveRole, rowToUser } = await import('./users.js');
const { parseLinkUrl } = await import('./routes/announcements.js');
const { buildUserFilter } = await import('./routes/admin.js');
const { cleanText, parseReason } = await import('./admin.js');

const env = {
  JWT_SECRET: 'unit-test-secret-unit-test-secret-1234',
  DATABASE_URL: 'postgres://fake',
  ADMIN_EMAILS: ' Boss@Example.com , other@example.com',
  APP_NAME: 'Jalebi Games',
};
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const MOD = '00000000-0000-4000-8000-0000000000a2';
const PLAYER = '00000000-0000-4000-8000-0000000000b1';
const BOSS = '00000000-0000-4000-8000-0000000000a3';
const GUEST = '00000000-0000-4000-8000-0000000000c1';
const ADMIN2 = '00000000-0000-4000-8000-0000000000a4';
const NOBODY = '00000000-0000-4000-8000-0000000000ff';
const N1 = '10000000-0000-4000-8000-000000000001';

const userRow = (id, over = {}) => ({
  id,
  google_sub: null,
  email: null,
  name: 'Someone',
  avatar: 3,
  friend_code: 'HYD-AB22',
  handle: null,
  is_guest: false,
  xp: 250,
  coins: 500,
  level: 1,
  games: 3,
  wins: 1,
  best_worth: 80000,
  rent_earned: 1200,
  equipped: {},
  role: 'user',
  banned_at: null,
  ban_reason: null,
  created_at: '2026-11-01T10:00:00Z',
  last_seen: '2026-11-20T10:00:00Z',
  ...over,
});
const users = new Map();

const cookieFor = async (id, isGuest = false) => `hyd_session=${await signSession(env, { id, isGuest })}`;

async function call(path, { method = 'GET', as, body, headers: extra = {}, envOver = {} } = {}) {
  const headers = new Headers(extra);
  if (as) headers.set('cookie', await cookieFor(as, users.get(as)?.is_guest));
  if (body !== undefined) headers.set('content-type', 'application/json');
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { ...env, ...envOver },
    {},
  );
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, headers: res.headers };
}

const seen = [];
/** Route SQL by its text. `extra(text, params)` answers first; undefined falls through to the defaults. */
function installDb(extra = () => undefined) {
  queryMock.mockImplementation(async (e, text, params = []) => {
    seen.push({ text, params });
    const custom = extra(text, params);
    if (custom !== undefined) return typeof custom === 'function' ? custom() : custom;
    if (/FROM users WHERE id = \$1/.test(text)) {
      const row = users.get(params[0]);
      return row ? [row] : [];
    }
    if (/UPDATE users SET last_seen/.test(text)) return [users.get(params[0])].filter(Boolean);
    if (/INSERT INTO notifications/.test(text) && /VALUES/.test(text)) {
      return [{ id: N1, kind: params[1], title: params[2], body: params[3], data: JSON.parse(params[4]), read_at: null, created_at: '2026-11-21T10:00:00Z' }];
    }
    return [];
  });
}
const sqlLike = (re) => seen.filter((q) => re.test(q.text));
const flush = () => new Promise((r) => setTimeout(r, 0));
const pushesTo = (id) => pushMock.mock.calls.filter(([, uid]) => uid === id).map(([, , m]) => m);

beforeEach(() => {
  queryMock.mockReset();
  pushMock.mockClear();
  _resetForTests();
  seen.length = 0;
  users.clear();
  users.set(ADMIN, userRow(ADMIN, { name: 'Admin', role: 'admin', email: 'admin@example.com' }));
  users.set(ADMIN2, userRow(ADMIN2, { name: 'Admin Two', role: 'admin' }));
  users.set(MOD, userRow(MOD, { name: 'Mod', role: 'moderator' }));
  users.set(PLAYER, userRow(PLAYER, { name: 'Player', equipped: { frame: 'frame-lake' } }));
  users.set(BOSS, userRow(BOSS, { name: 'Boss', email: 'boss@example.com' }));
  users.set(GUEST, userRow(GUEST, { name: 'Guest', is_guest: true }));
  installDb();
});

// ---------------------------------------------------------------- roles

describe('roles and staff access', () => {
  it('effectiveRole: ADMIN_EMAILS (trimmed, case-insensitive) makes an admin; guests and unknown roles are users', () => {
    expect(effectiveRole(userRow(BOSS, { email: 'BOSS@example.com ' }), env)).toBe('admin');
    expect(effectiveRole(userRow(BOSS, { email: 'boss@example.com', is_guest: true }), env)).toBe('user');
    expect(effectiveRole(userRow(GUEST, { is_guest: true, role: 'admin' }), env)).toBe('user');
    expect(effectiveRole(userRow(PLAYER, { role: 'superuser' }), env)).toBe('user');
    expect(effectiveRole(userRow(MOD, { role: 'moderator' }), env)).toBe('moderator');
    expect(effectiveRole(userRow(BOSS, { email: 'boss@example.com' }), {})).toBe('user');
    expect(rowToUser(userRow(BOSS, { email: 'boss@example.com' }), undefined, Date.now(), env).role).toBe('admin');
  });

  it('signed out is 401, a player is 403, a guest is 403', async () => {
    expect((await call('/api/admin/me')).status).toBe(401);
    const res = await call('/api/admin/me', { as: PLAYER });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'Staff only.' });
    expect((await call('/api/admin/users', { as: PLAYER })).status).toBe(403);
    users.set(GUEST, userRow(GUEST, { is_guest: true, role: 'admin', email: 'boss@example.com' }));
    expect((await call('/api/admin/me', { as: GUEST })).status).toBe(403);
  });

  it('ADMIN_EMAILS grants admin (GET /api/admin/me and /api/me)', async () => {
    const res = await call('/api/admin/me', { as: BOSS });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ role: 'admin', name: 'Boss', permissions: ['view', 'moderate', 'announce', 'economy', 'bulk', 'roles'] });
    expect((await call('/api/me', { as: BOSS })).json.user.role).toBe('admin');
    expect((await call('/api/me', { as: PLAYER })).json.user.role).toBe('user');
  });

  it('a moderator gets the moderator permissions and is denied economy, bulk and role changes', async () => {
    expect((await call('/api/admin/me', { as: MOD })).json).toEqual({ role: 'moderator', name: 'Mod', permissions: ['view', 'moderate', 'announce'] });
    const coins = await call(`/api/admin/users/${PLAYER}/coins`, { method: 'POST', as: MOD, body: { amount: 10, reason: 'testing' } });
    expect(coins.status).toBe(403);
    expect(coins.json).toEqual({ error: 'You do not have permission to do that.' });
    expect((await call(`/api/admin/users/${PLAYER}/xp`, { method: 'POST', as: MOD, body: { amount: 10, reason: 'testing' } })).status).toBe(403);
    expect((await call(`/api/admin/users/${PLAYER}/items`, { method: 'POST', as: MOD, body: { itemId: 'frame-lake', reason: 'testing' } })).status).toBe(403);
    expect((await call(`/api/admin/users/${PLAYER}/items/frame-lake?reason=testing`, { method: 'DELETE', as: MOD })).status).toBe(403);
    expect((await call('/api/admin/grants', { method: 'POST', as: MOD, body: { audience: 'members', coins: 5, reason: 'testing' } })).status).toBe(403);
    expect((await call(`/api/admin/users/${PLAYER}/role`, { method: 'POST', as: MOD, body: { role: 'moderator' } })).status).toBe(403);
    expect(sqlLike(/admin_actions/)).toHaveLength(0);
  });

  it('cross-origin mutating requests are refused before anything else', async () => {
    const res = await call(`/api/admin/users/${PLAYER}/coins`, {
      method: 'POST',
      as: ADMIN,
      body: { amount: 10, reason: 'testing' },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'Cross-origin request refused.' });
    expect(sqlLike(/UPDATE users SET coins/)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- coins / xp

describe('POST /api/admin/users/:id/coins', () => {
  it('adds coins atomically, writes the audit row, notifies and pushes', async () => {
    installDb((text) => (/UPDATE users SET coins = coins \+ \$2::int/.test(text) ? [{ coins: 600 }] : undefined));
    const res = await call(`/api/admin/users/${PLAYER}/coins`, { method: 'POST', as: ADMIN, body: { amount: 100, reason: '  bug compensation  ' } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ coins: 600 });
    const [q] = sqlLike(/UPDATE users SET coins/);
    expect(q.text).toMatch(/WHERE id = \$1::uuid AND coins \+ \$2::int >= 0/);
    expect(q.text).toMatch(/INSERT INTO admin_actions[\s\S]*'coins'[\s\S]*'before', upd\.coins - \$2::int, 'after', upd\.coins/);
    expect(q.params).toEqual([PLAYER, 100, ADMIN, 'Admin', 'bug compensation']);
    const [n] = sqlLike(/INSERT INTO notifications/);
    expect(n.params.slice(0, 3)).toEqual([PLAYER, 'gift', 'You received 100 coins']);
    expect(JSON.parse(n.params[4])).toEqual({ coins: 100, from: 'Jalebi Games team' });
    await flush();
    const msgs = pushesTo(PLAYER);
    expect(msgs).toContainEqual({ t: 'wallet', coins: 600 });
    expect(msgs.find((m) => m.t === 'notification').notification).toMatchObject({ id: N1, kind: 'gift', title: 'You received 100 coins', read: false });
  });

  it('a removal is a system notification; notify: false skips it but still pushes the wallet', async () => {
    installDb((text) => (/UPDATE users SET coins/.test(text) ? [{ coins: 400 }] : undefined));
    await call(`/api/admin/users/${PLAYER}/coins`, { method: 'POST', as: ADMIN, body: { amount: -100, reason: 'abuse refund' } });
    expect(sqlLike(/INSERT INTO notifications/)[0].params.slice(1, 3)).toEqual(['system', '100 coins were removed from your balance']);
    seen.length = 0;
    pushMock.mockClear();
    await call(`/api/admin/users/${PLAYER}/coins`, { method: 'POST', as: ADMIN, body: { amount: -100, reason: 'abuse refund', notify: false } });
    expect(sqlLike(/INSERT INTO notifications/)).toHaveLength(0);
    await flush();
    expect(pushesTo(PLAYER)).toEqual([{ t: 'wallet', coins: 400 }]);
  });

  it('409 when the balance would go below 0 (no notification, no push)', async () => {
    installDb((text) => (/UPDATE users SET coins/.test(text) ? [] : undefined));
    const res = await call(`/api/admin/users/${PLAYER}/coins`, { method: 'POST', as: ADMIN, body: { amount: -10_000, reason: 'testing' } });
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: 'Not enough coins: the balance cannot go below 0.' });
    expect(sqlLike(/INSERT INTO notifications/)).toHaveLength(0);
    await flush();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('validates the amount, the reason, notify and the user id', async () => {
    const post = (body, id = PLAYER) => call(`/api/admin/users/${id}/coins`, { method: 'POST', as: ADMIN, body });
    for (const amount of [0, 1.5, '10', 1_000_001, -1_000_001, null, undefined]) {
      expect((await post({ amount, reason: 'testing' })).status, String(amount)).toBe(400);
    }
    expect((await post({ amount: 1_000_000, reason: 'testing' })).status).toBe(409); // valid; the fake UPDATE returns no row
    for (const reason of [undefined, '', '  ab  ', 'x'.repeat(201), 42]) {
      const res = await post({ amount: 5, reason });
      expect(res.status, String(reason)).toBe(400);
      expect(res.json.error).toBe('Give a reason (3-200 characters).');
    }
    expect((await post({ amount: 5, reason: 'testing', notify: 'yes' })).status).toBe(400);
    expect((await post({ amount: 5, reason: 'testing' }, 'not-a-uuid')).status).toBe(400);
    const missing = await post({ amount: 5, reason: 'testing' }, NOBODY);
    expect(missing.status).toBe(404);
    expect(missing.json).toEqual({ error: 'User not found.' });
  });
});

describe('POST /api/admin/users/:id/xp', () => {
  it('floors at 0 in SQL, returns the level and pushes the wallet', async () => {
    installDb((text) => (/UPDATE users u SET xp = GREATEST\(0, old\.xp \+ \$2::int\)/.test(text) ? [{ xp: 300, before: 250 }] : undefined));
    const res = await call(`/api/admin/users/${PLAYER}/xp`, { method: 'POST', as: ADMIN, body: { amount: 50, reason: 'event prize' } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ xp: 300, level: 3 });
    await flush();
    expect(pushesTo(PLAYER)).toContainEqual({ t: 'wallet', xp: 300, level: 3 });
    expect(sqlLike(/INSERT INTO notifications/)[0].params[2]).toBe('You received 50 XP');
  });
});

// ---------------------------------------------------------------- items

describe('items', () => {
  it('grants an item (owned list includes it) and refuses one that is already owned with 409', async () => {
    let inserted = 1;
    installDb((text) => (/INSERT INTO user_items/.test(text) ? [{ inserted, bought_before: ['dice-cyber'] }] : undefined));
    const ok = await call(`/api/admin/users/${PLAYER}/items`, { method: 'POST', as: ADMIN, body: { itemId: 'frame-lake', reason: 'testing' } });
    expect(ok.status).toBe(200);
    expect(ok.json.owned).toEqual(expect.arrayContaining(['frame-lake', 'dice-cyber', 'dice-ivory']));
    const [q] = sqlLike(/INSERT INTO user_items/);
    expect(q.text).toMatch(/ON CONFLICT \(user_id, item_id\) DO NOTHING/);
    expect(q.text).toMatch(/'item\.grant'/);
    await flush();
    expect(pushesTo(PLAYER).map((m) => m.t)).toEqual(['notification', 'items']);
    inserted = 0;
    const dup = await call(`/api/admin/users/${PLAYER}/items`, { method: 'POST', as: ADMIN, body: { itemId: 'frame-lake', reason: 'testing' } });
    expect(dup.status).toBe(409);
    expect(dup.json).toEqual({ error: 'Already owned.' });
  });

  it('refuses free and unknown items', async () => {
    const free = await call(`/api/admin/users/${PLAYER}/items`, { method: 'POST', as: ADMIN, body: { itemId: 'dice-ivory', reason: 'testing' } });
    expect(free.status).toBe(409);
    const unknown = await call(`/api/admin/users/${PLAYER}/items`, { method: 'POST', as: ADMIN, body: { itemId: 'frame-nope', reason: 'testing' } });
    expect(unknown.status).toBe(404);
    expect(unknown.json).toEqual({ error: 'Unknown item.' });
    expect((await call(`/api/admin/users/${PLAYER}/items`, { method: 'POST', as: ADMIN, body: { itemId: 7, reason: 'testing' } })).status).toBe(400);
    expect(sqlLike(/INSERT INTO user_items/)).toHaveLength(0);
  });

  it('revoke deletes the row, unequips it and 409s when not owned', async () => {
    let deleted = 1;
    installDb((text) => (/DELETE FROM user_items/.test(text) ? [{ deleted, unequipped: true, owned_before: ['frame-lake', 'dice-cyber'] }] : undefined));
    const res = await call(`/api/admin/users/${PLAYER}/items/frame-lake?reason=refund%20given`, { method: 'DELETE', as: ADMIN });
    expect(res.status).toBe(200);
    expect(res.json.owned).toContain('dice-cyber');
    expect(res.json.owned).not.toContain('frame-lake');
    const [q] = sqlLike(/DELETE FROM user_items/);
    expect(q.text).toMatch(/UPDATE users SET equipped = equipped - \$3::text[\s\S]*equipped ->> \$3::text = \$2::text/);
    expect(q.params.slice(0, 3)).toEqual([PLAYER, 'frame-lake', 'frame']);
    expect(q.params[5]).toBe('refund given');
    expect(sqlLike(/INSERT INTO notifications/)[0].params[1]).toBe('system');
    deleted = 0;
    const not = await call(`/api/admin/users/${PLAYER}/items/frame-lake?reason=testing`, { method: 'DELETE', as: ADMIN });
    expect(not.status).toBe(409);
    expect(not.json).toEqual({ error: 'Not owned.' });
    expect((await call(`/api/admin/users/${PLAYER}/items/frame-lake`, { method: 'DELETE', as: ADMIN })).status).toBe(400); // no reason
  });
});

// ---------------------------------------------------------------- bans

describe('bans', () => {
  it('ban writes the row + audit and pushes suspended; the banned user then gets 403 code banned', async () => {
    const res = await call(`/api/admin/users/${PLAYER}/ban`, { method: 'POST', as: MOD, body: { reason: 'cheating in rooms' } });
    // the fake UPDATE returns nothing -> 404; answer it properly:
    expect(res.status).toBe(404);
    installDb((text) => (/UPDATE users SET banned_at = coalesce\(banned_at, now\(\)\)/.test(text) ? [{ id: PLAYER }] : undefined));
    const ok = await call(`/api/admin/users/${PLAYER}/ban`, { method: 'POST', as: MOD, body: { reason: 'cheating in rooms' } });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ banned: true });
    const [q] = sqlLike(/UPDATE users SET banned_at = coalesce/);
    expect(q.text).toMatch(/'ban'/);
    expect(q.params).toEqual([PLAYER, 'cheating in rooms', MOD, 'Mod']);
    await flush();
    expect(pushesTo(PLAYER)).toEqual([{ t: 'suspended', reason: 'cheating in rooms' }]);

    users.set(PLAYER, userRow(PLAYER, { banned_at: '2026-11-21T10:00:00Z', ban_reason: 'cheating in rooms' }));
    installDb();
    const banned = { error: 'Your account has been suspended.', code: 'banned', reason: 'cheating in rooms' };
    const me = await call('/api/me', { as: PLAYER });
    expect(me.status).toBe(403);
    expect(me.json).toEqual(banned);
    const inbox = await call('/api/notifications', { as: PLAYER });
    expect(inbox.status).toBe(403);
    expect(inbox.json).toEqual(banned);
    expect((await call('/api/friends', { as: PLAYER })).json).toEqual(banned); // requireMember too
    // public endpoints keep working
    expect((await call('/api/announcements', { as: PLAYER })).status).toBe(200);
  });

  it('a banned user cannot open either WebSocket (4003)', async () => {
    users.set(PLAYER, userRow(PLAYER, { banned_at: '2026-11-21T10:00:00Z', ban_reason: 'x' }));
    const closes = [];
    vi.stubGlobal(
      'WebSocketPair',
      class {
        constructor() {
          return { 0: {}, 1: { accept() {}, close: (code, reason) => closes.push({ code, reason }) } };
        }
      },
    );
    const forwarded = [];
    const stub = { idFromName: (n) => n, get: () => ({ fetch: async () => (forwarded.push(1), new Response('ok')) }) };
    const headers = { upgrade: 'websocket', connection: 'Upgrade' };
    await call('/ws/user', { as: PLAYER, headers, envOver: { USER_HUB: stub, GAME_ROOM: stub } });
    await call('/ws/room/ABCD23', { as: PLAYER, headers, envOver: { USER_HUB: stub, GAME_ROOM: stub } });
    expect(closes).toEqual([
      { code: 4003, reason: 'Your account has been suspended.' },
      { code: 4003, reason: 'Your account has been suspended.' },
    ]);
    expect(forwarded).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('nobody bans themselves; a moderator cannot ban an admin (incl. an ADMIN_EMAILS one) or another moderator', async () => {
    installDb((text) => (/UPDATE users SET banned_at/.test(text) ? [{ id: 'x' }] : undefined));
    const ban = (as, id) => call(`/api/admin/users/${id}/ban`, { method: 'POST', as, body: { reason: 'testing' } });
    const self = await ban(ADMIN, ADMIN);
    expect(self.status).toBe(403);
    expect(self.json).toEqual({ error: 'You cannot ban yourself.' });
    expect((await ban(MOD, MOD)).status).toBe(403);
    const modOnAdmin = await ban(MOD, ADMIN);
    expect(modOnAdmin.status).toBe(403);
    expect(modOnAdmin.json).toEqual({ error: 'Moderators cannot ban staff.' });
    expect((await ban(MOD, BOSS)).status).toBe(403);
    users.set(PLAYER, userRow(PLAYER, { role: 'moderator' }));
    expect((await ban(MOD, PLAYER)).status).toBe(403);
    expect((await ban(ADMIN, ADMIN2)).status).toBe(200); // an admin may ban another admin
    expect((await ban(MOD, GUEST)).status).toBe(200);
    expect(sqlLike(/UPDATE users SET banned_at/)).toHaveLength(2);
  });

  it('unban, rename and reset-handle follow the moderator rules', async () => {
    installDb((text) => {
      if (/UPDATE users SET banned_at = NULL/.test(text)) return [{ id: PLAYER }];
      if (/UPDATE users SET name = \$2::text/.test(text)) return [{ name: 'Clean Name' }];
      if (/UPDATE users SET handle = NULL/.test(text)) return [{ id: PLAYER }];
      return undefined;
    });
    expect((await call(`/api/admin/users/${PLAYER}/unban`, { method: 'POST', as: MOD, body: {} })).json).toEqual({ banned: false });
    expect((await call(`/api/admin/users/${PLAYER}/unban`, { method: 'POST', as: MOD, body: { reason: 'x' } })).status).toBe(400);
    const rn = await call(`/api/admin/users/${PLAYER}/rename`, { method: 'POST', as: MOD, body: { name: '  Clean   Name ', reason: 'rude name' } });
    expect(rn.json).toEqual({ name: 'Clean Name' });
    expect(sqlLike(/UPDATE users SET name/)[0].params.slice(0, 2)).toEqual([PLAYER, 'Clean Name']);
    expect((await call(`/api/admin/users/${PLAYER}/rename`, { method: 'POST', as: MOD, body: { name: 'x'.repeat(25), reason: 'rude name' } })).status).toBe(400);
    expect((await call(`/api/admin/users/${ADMIN}/rename`, { method: 'POST', as: MOD, body: { name: 'Ok', reason: 'rude name' } })).status).toBe(403);
    expect((await call(`/api/admin/users/${PLAYER}/reset-handle`, { method: 'POST', as: MOD, body: { reason: 'rude handle' } })).json).toEqual({ handle: null });
    expect((await call(`/api/admin/users/${ADMIN}/reset-handle`, { method: 'POST', as: MOD, body: { reason: 'rude handle' } })).status).toBe(403);
  });
});

// ---------------------------------------------------------------- roles

describe('POST /api/admin/users/:id/role', () => {
  const setRole = (as, id, role) => call(`/api/admin/users/${id}/role`, { method: 'POST', as, body: { role } });

  it('an admin promotes / demotes; the audit row records before and after', async () => {
    installDb((text, params) => (/UPDATE users SET role = \$2::text/.test(text) ? [{ role: params[1] }] : undefined));
    const res = await setRole(ADMIN, PLAYER, 'moderator');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ role: 'moderator' });
    const [q] = sqlLike(/UPDATE users SET role/);
    expect(q.text).toMatch(/AND is_guest = false/);
    expect(q.params).toEqual([PLAYER, 'moderator', ADMIN, 'Admin', 'user']);
    expect((await setRole(ADMIN, MOD, 'admin')).json).toEqual({ role: 'admin' });
    // an ADMIN_EMAILS account stays admin whatever the column says
    expect((await setRole(ADMIN, BOSS, 'user')).json).toEqual({ role: 'admin' });
  });

  it('refuses your own role, guests, unknown roles and non-admins', async () => {
    installDb((text, params) => (/UPDATE users SET role/.test(text) ? [{ role: params[1] }] : undefined));
    const self = await setRole(ADMIN, ADMIN, 'user');
    expect(self.status).toBe(403);
    expect(self.json).toEqual({ error: 'You cannot change your own role.' });
    const guest = await setRole(ADMIN, GUEST, 'moderator');
    expect(guest.status).toBe(400);
    expect(guest.json).toEqual({ error: 'Guests cannot be given a role.' });
    expect((await setRole(ADMIN, PLAYER, 'owner')).status).toBe(400);
    expect((await setRole(MOD, PLAYER, 'admin')).status).toBe(403);
    expect((await setRole(MOD, PLAYER, 'moderator')).status).toBe(403);
    expect((await setRole(ADMIN, NOBODY, 'moderator')).status).toBe(404);
    expect(sqlLike(/UPDATE users SET role/)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- notify + bulk

describe('messages and bulk grants', () => {
  it('POST /users/:id/notify creates a message notification, an audit row and a push', async () => {
    const res = await call(`/api/admin/users/${PLAYER}/notify`, { method: 'POST', as: MOD, body: { title: ' Hello ', body: 'Line one\nLine two' } });
    expect(res.json).toEqual({ ok: true });
    expect(sqlLike(/INSERT INTO admin_actions/)[0].params.slice(2, 4)).toEqual(['notify', PLAYER]);
    expect(sqlLike(/INSERT INTO notifications/)[0].params.slice(1, 4)).toEqual(['message', 'Hello', 'Line one\nLine two']);
    await flush();
    expect(pushesTo(PLAYER)[0]).toMatchObject({ t: 'notification', notification: { kind: 'message', title: 'Hello' } });
    expect((await call(`/api/admin/users/${PLAYER}/notify`, { method: 'POST', as: MOD, body: { title: 'x'.repeat(81) } })).status).toBe(400);
    expect((await call(`/api/admin/users/${PLAYER}/notify`, { method: 'POST', as: MOD, body: {} })).status).toBe(400);
  });

  it('a small id audience gets live pushes; a members grant is one statement and pushes nothing', async () => {
    installDb((text, params) => {
      if (/WITH target AS/.test(text)) {
        return [
          {
            count: params[9] ? 1 : 1234,
            pushes: params[9]
              ? [{ userId: PLAYER, notification: { id: N1, kind: 'gift', title: 'You received 50 coins', body: null, data: { coins: 50 }, read_at: null, created_at: '2026-11-21T10:00:00Z' }, coins: 550, gotCoins: true, gotItem: false, owned: [] }]
              : null,
          },
        ];
      }
      return undefined;
    });
    const small = await call('/api/admin/grants', { method: 'POST', as: ADMIN, body: { audience: 'ids', ids: [PLAYER, PLAYER.toUpperCase()], coins: 50, reason: 'event prize' } });
    expect(small.json).toEqual({ count: 1 });
    const [q] = sqlLike(/WITH target AS/);
    expect(q.text).toMatch(/SELECT id FROM users WHERE id = ANY\(\$1::uuid\[\]\)/);
    expect(q.params[0]).toEqual([PLAYER]); // deduped
    expect(q.params[9]).toBe(true);
    await flush();
    expect(pushesTo(PLAYER).map((m) => m.t)).toEqual(['notification', 'wallet']);

    seen.length = 0;
    pushMock.mockClear();
    const all = await call('/api/admin/grants', { method: 'POST', as: ADMIN, body: { audience: 'members', itemId: 'frame-lake', reason: 'launch gift' } });
    expect(all.json).toEqual({ count: 1234 });
    const [b] = sqlLike(/WITH target AS/);
    expect(b.text).toMatch(/is_guest = false AND banned_at IS NULL/);
    expect(b.text).toMatch(/INSERT INTO user_items[\s\S]*SELECT t\.id, \$3::text, 0 FROM target t/);
    expect(b.text).toMatch(/INSERT INTO notifications[\s\S]*FROM granted g/);
    expect(b.params[9]).toBe(false);
    expect(seen.filter((x) => /INSERT INTO notifications/.test(x.text))).toHaveLength(1); // the set-based one only
    await flush();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('validates the bulk body', async () => {
    const post = (body) => {
      _resetForTests(); // the bulk limit is 5/min
      return call('/api/admin/grants', { method: 'POST', as: ADMIN, body: { reason: 'testing', ...body } });
    };
    expect((await post({ audience: 'everyone', coins: 5 })).status).toBe(400);
    expect((await post({ audience: 'members' })).json).toEqual({ error: 'Give coins, an item, or both.' });
    expect((await post({ audience: 'members', coins: 100_001 })).status).toBe(400);
    expect((await post({ audience: 'members', coins: 0 })).status).toBe(400);
    expect((await post({ audience: 'ids', coins: 5 })).status).toBe(400);
    expect((await post({ audience: 'ids', ids: ['nope'], coins: 5 })).status).toBe(400);
    expect((await post({ audience: 'ids', ids: Array.from({ length: 501 }, () => PLAYER), coins: 5 })).status).toBe(400);
    expect((await post({ audience: 'members', itemId: 'dice-ivory' })).status).toBe(409);
    expect((await post({ audience: 'members', coins: 5, reason: 'no' })).status).toBe(400);
    expect(sqlLike(/WITH target AS/)).toHaveLength(0);
    // 500 ids (~19.5 KB of JSON) fit the larger bulk body cap
    const many = Array.from({ length: 500 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect((await post({ audience: 'ids', ids: many, coins: 5 })).status).toBe(200);
    expect(sqlLike(/WITH target AS/)[0].params[9]).toBe(false); // more than 50: no live pushes
    // 5 bulk grants a minute
    _resetForTests();
    const codes = [];
    for (let i = 0; i < 6; i += 1) codes.push((await call('/api/admin/grants', { method: 'POST', as: ADMIN, body: { audience: 'members' } })).status);
    expect(codes).toEqual([400, 400, 400, 400, 400, 429]);
  });
});

// ---------------------------------------------------------------- reads

describe('admin reads', () => {
  it('GET /users: uuid search is an id match, text search is an escaped ILIKE, paging is capped', async () => {
    installDb((text) => {
      if (/SELECT count\(\*\)::int AS total FROM users/.test(text)) return [{ total: 1 }];
      if (/FROM users/.test(text) && /LIMIT/.test(text)) return [users.get(PLAYER)];
      return undefined;
    });
    const res = await call(`/api/admin/users?q=${PLAYER}&pageSize=500&page=2`, { as: MOD });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ total: 1, page: 2, pageSize: 100 });
    expect(res.json.users[0]).toMatchObject({ id: PLAYER, role: 'user', banned: false, level: 3, isGuest: false, friendCode: 'HYD-AB22' });
    const list = sqlLike(/FROM users WHERE id = \$1::uuid ORDER BY/)[0];
    expect(list.params).toEqual([PLAYER, 100, 100]);
    expect(buildUserFilter({ q: '50%_off\\', filter: 'all', emails: [] }).params).toEqual(['%50\\%\\_off\\\\%']);
    expect(buildUserFilter({ q: '', filter: 'staff', emails: ['a@b.c'] })).toMatchObject({ params: [['a@b.c']] });
    expect((await call('/api/admin/users?filter=nope', { as: MOD })).status).toBe(400);
    expect((await call('/api/admin/users?sort=constructor', { as: MOD })).status).toBe(400);
  });

  it('GET /stats returns the documented shape', async () => {
    installDb((text) => {
      if (/FROM users\) u/.test(text)) return [{ users_total: 10, users_members: 7, users_guests: 3, users_banned: 1, users_staff: 2, coins_total: '7000', coins_avg: '1000', items_owned: 4 }];
      if (/generate_series/.test(text)) return Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(8 + i).padStart(2, '0')}`, signups: i, active: 1, matches: 0 }));
      if (/ORDER BY coins DESC/.test(text)) return [{ id: PLAYER, name: 'Player', avatar: 3, coins: 500 }];
      return undefined;
    });
    const res = await call('/api/admin/stats', { as: MOD });
    expect(res.status).toBe(200);
    expect(res.json.users).toEqual({ total: 10, members: 7, guests: 3, banned: 1, staff: 2 });
    expect(res.json.economy).toEqual({ coinsInCirculation: 7000, avgCoins: 1000, itemsOwned: 4 });
    expect(res.json.series.days).toHaveLength(14);
    expect(res.json.series.signups[13]).toBe(13);
    expect(res.json.topCoins).toEqual([{ id: PLAYER, name: 'Player', avatar: 3, coins: 500 }]);
    expect(Object.keys(res.json)).toEqual(['users', 'signups', 'active', 'matches', 'rooms', 'economy', 'series', 'topCoins']);
  });

  it('GET /actions validates its filters', async () => {
    expect((await call('/api/admin/actions?targetId=nope', { as: MOD })).status).toBe(400);
    expect((await call('/api/admin/actions?action=drop', { as: MOD })).status).toBe(400);
    const ok = await call(`/api/admin/actions?targetId=${PLAYER}&action=ban`, { as: MOD });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ actions: [], total: 0, page: 1, pageSize: 50 });
  });

  it('GET /users/:id returns the detail blocks', async () => {
    const res = await call(`/api/admin/users/${PLAYER}`, { as: MOD });
    expect(res.status).toBe(200);
    expect(res.json.user).toMatchObject({ id: PLAYER, bannedAt: null, banReason: null, equipped: { frame: 'frame-lake' }, online: false });
    expect(Object.keys(res.json)).toEqual(['user', 'items', 'friends', 'matches', 'actions', 'notifications', 'rooms', 'achievements', 'referral']);
    expect(res.json.referral).toEqual({ referrer: null, invitedCount: 0, invited: [] });
    expect((await call(`/api/admin/users/${NOBODY}`, { as: MOD })).status).toBe(404);
  });
});

// ---------------------------------------------------------------- announcements

describe('announcements', () => {
  it('parseLinkUrl: same-site paths and https URLs only', () => {
    expect(parseLinkUrl('/shop')).toBe('/shop');
    expect(parseLinkUrl('https://example.com/x?y=1')).toBe('https://example.com/x?y=1');
    expect(parseLinkUrl('')).toBeNull();
    expect(parseLinkUrl(null)).toBeNull();
    for (const bad of ['//evil.com', '/\\evil.com', 'http://example.com', 'javascript:alert(1)', 'data:text/html,x', 'shop', 'https://', 'https://u:p@example.com', '/a b', 42]) {
      expect(() => parseLinkUrl(bad), String(bad)).toThrow(/link/);
    }
  });

  it('staff create (400 on a bad link or window), audited', async () => {
    installDb((text, params) =>
      /INSERT INTO announcements/.test(text)
        ? [{ id: N1, message: params[0], tone: params[1], link_url: params[2], link_label: params[3], starts_at: '2026-11-21T10:00:00Z', ends_at: params[5], active: params[6], created_at: '2026-11-21T10:00:00Z' }]
        : undefined,
    );
    const post = (body) => call('/api/admin/announcements', { method: 'POST', as: MOD, body });
    expect((await post({ message: 'Hi', linkUrl: '//evil.com' })).status).toBe(400);
    expect((await post({ message: 'Hi', linkUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await post({ message: '' })).status).toBe(400);
    expect((await post({ message: 'x'.repeat(201) })).status).toBe(400);
    expect((await post({ message: 'Hi', tone: 'loud' })).status).toBe(400);
    expect((await post({ message: 'Hi', linkLabel: 'x'.repeat(41) })).status).toBe(400);
    expect((await post({ message: 'Hi', startsAt: '2026-12-02T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' })).status).toBe(400);
    expect(sqlLike(/INSERT INTO announcements/)).toHaveLength(0);
    const ok = await post({ message: 'Diwali event!', tone: 'event', linkUrl: '/games/hyderabad-tycoon', linkLabel: 'Play' });
    expect(ok.status).toBe(200);
    expect(ok.json.announcement).toMatchObject({ id: N1, message: 'Diwali event!', tone: 'event', linkUrl: '/games/hyderabad-tycoon', linkLabel: 'Play', active: true, endsAt: null });
    expect(sqlLike(/INSERT INTO admin_actions/)[0].params[2]).toBe('announcement.create');
    expect((await call('/api/admin/announcements', { method: 'POST', as: PLAYER, body: { message: 'Hi' } })).status).toBe(403);
  });

  it('patch and delete 404 on an unknown id and 400 on a bad one', async () => {
    expect((await call('/api/admin/announcements/nope', { method: 'DELETE', as: MOD })).status).toBe(400);
    expect((await call(`/api/admin/announcements/${N1}`, { method: 'DELETE', as: MOD })).status).toBe(404);
    expect((await call(`/api/admin/announcements/${N1}`, { method: 'PATCH', as: MOD, body: { active: false } })).status).toBe(404);
    expect((await call(`/api/admin/announcements/${N1}`, { method: 'PATCH', as: MOD, body: { linkUrl: 'ftp://x' } })).status).toBe(400);
  });

  it('the public endpoint asks only for live ones (max 3) and is cacheable for 60 s', async () => {
    installDb((text) =>
      /FROM announcements/.test(text)
        ? [{ id: N1, message: 'Live', tone: 'info', link_url: null, link_label: null, starts_at: '2026-11-20T00:00:00Z', ends_at: null, active: true, created_at: '2026-11-20T00:00:00Z' }]
        : undefined,
    );
    const res = await call('/api/announcements');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      announcements: [{ id: N1, message: 'Live', tone: 'info', linkUrl: null, linkLabel: null, startsAt: '2026-11-20T00:00:00.000Z', endsAt: null, active: true, createdAt: '2026-11-20T00:00:00.000Z' }],
    });
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const [q] = sqlLike(/FROM announcements/);
    expect(q.text).toMatch(/WHERE active = true AND starts_at <= now\(\) AND \(ends_at IS NULL OR ends_at > now\(\)\)/);
    expect(q.text).toMatch(/LIMIT 3/);
  });
});

// ---------------------------------------------------------------- player notifications

describe('/api/notifications', () => {
  it('lists the latest notifications with the unread count', async () => {
    installDb((text) => {
      if (/SELECT count\(\*\)::int AS unread/.test(text)) return [{ unread: 2 }];
      if (/FROM notifications/.test(text)) {
        return [{ id: N1, kind: 'gift', title: 'You received 100 coins', body: null, data: '{"coins":100}', read_at: null, created_at: '2026-11-21T10:00:00Z' }];
      }
      return undefined;
    });
    expect((await call('/api/notifications')).status).toBe(401);
    const res = await call('/api/notifications', { as: GUEST });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      notifications: [{ id: N1, kind: 'gift', title: 'You received 100 coins', body: null, data: { coins: 100 }, createdAt: '2026-11-21T10:00:00.000Z', read: false }],
      unread: 2,
    });
  });

  it('marks some or all read and returns what is left unread', async () => {
    installDb((text) => (/UPDATE notifications SET read_at = now\(\)/.test(text) ? [{ unread: 1 }] : undefined));
    const some = await call('/api/notifications/read', { method: 'POST', as: PLAYER, body: { ids: [N1] } });
    expect(some.json).toEqual({ unread: 1 });
    expect(sqlLike(/UPDATE notifications/)[0].params).toEqual([PLAYER, false, [N1]]);
    await call('/api/notifications/read', { method: 'POST', as: PLAYER, body: { all: true } });
    expect(sqlLike(/UPDATE notifications/)[1].params).toEqual([PLAYER, true, []]);
    expect((await call('/api/notifications/read', { method: 'POST', as: PLAYER, body: {} })).status).toBe(400);
    expect((await call('/api/notifications/read', { method: 'POST', as: PLAYER, body: { ids: ['x'] } })).status).toBe(400);
  });
});

describe('text helpers', () => {
  it('cleanText / parseReason', () => {
    expect(cleanText('  a ​ b  ')).toBe('a b');
    expect(cleanText('one\r\n\n\n\ntwo  ', { multiline: true })).toBe('one\n\ntwo');
    expect(cleanText(5)).toBeNull();
    expect(parseReason('  abc ')).toBe('abc');
    expect(parseReason(undefined, { optional: true })).toBeNull();
    expect(() => parseReason('ab')).toThrow('Give a reason');
  });
});
