// Friend request / accepted: the live socket push stays the primary path; a Web Push goes out only when no socket
// took the message and push is configured. Best effort: a failing push never fails the request.
// Database, Durable Objects and the push sender are faked (same pattern as invites.test.js).
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

const hubPushMock = vi.fn(async () => 1);
vi.mock('./hub.js', async (importOriginal) => ({
  ...(await importOriginal()),
  pushToUser: (...a) => hubPushMock(...a),
  isUserOnline: async () => false,
}));

const webPushMock = vi.fn(async () => 1);
vi.mock('./push.js', async (importOriginal) => ({ ...(await importOriginal()), sendPushToUser: (...a) => webPushMock(...a) }));

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
const pushEnv = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:test@example.com' };
const ME = '00000000-0000-4000-8000-0000000000a1';
const FRIEND = '00000000-0000-4000-8000-0000000000b2';

const userRow = (id) => ({
  id,
  name: id === ME ? 'Me' : 'Friend',
  avatar: 3,
  friend_code: id === ME ? 'HYD-ME22' : 'HYD-FR22',
  is_guest: false,
  xp: 0,
  equipped: {},
});
const users = new Map();
const INSERT = /INSERT INTO friendships/;
const ACCEPT = /UPDATE friendships SET status = 'accepted'/;

async function call(path, { method = 'POST', as = ME, body, envOver = {} } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('cookie', `hyd_session=${await signSession(env, { id: as, isGuest: false })}`);
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers, body: JSON.stringify(body) }), { ...env, ...envOver }, {});
  return { status: res.status, json: await res.json().catch(() => null) };
}

function installDb(onQuery) {
  queryMock.mockImplementation(async (e, text, params = []) => {
    const custom = onQuery(text, params);
    if (custom !== undefined) return custom;
    if (/FROM users WHERE id = \$1/.test(text)) {
      const row = users.get(params[0]);
      return row ? [row] : [];
    }
    return [];
  });
}
const newRequestDb = () => installDb((text) => (INSERT.test(text) ? [{ ok: 1 }] : ACCEPT.test(text) ? [] : undefined));
const acceptDb = () => installDb((text) => (ACCEPT.test(text) ? [{ ok: 1 }] : undefined));

beforeEach(() => {
  queryMock.mockReset();
  hubPushMock.mockReset();
  hubPushMock.mockResolvedValue(1);
  webPushMock.mockReset();
  webPushMock.mockResolvedValue(1);
  _resetForTests();
  users.clear();
  users.set(ME, userRow(ME));
  users.set(FRIEND, userRow(FRIEND));
  newRequestDb();
});

describe('notification payloads', () => {
  it('friend request: title, body and a url straight to the Requests card', () => {
    const n = friendsMod.friendRequestNotification({ fromName: 'Asha', fromId: ME });
    expect(n.title).toBe('Asha sent you a friend request');
    expect(n.url).toBe('/friends#requests');
    expect(n.tag).toBe(`friend-request-${ME}`);
    expect(typeof n.body).toBe('string');
  });
  it('accepted: url to /friends', () => {
    const n = friendsMod.friendAcceptedNotification({ byName: 'Asha', byId: ME });
    expect(n.title).toBe('Asha accepted your friend request');
    expect(n.url).toBe('/friends');
    expect(friendsMod.friendRequestNotification({}).title).toBe('Someone sent you a friend request');
  });
});

describe('Web Push for friend requests', () => {
  it('sends a Web Push when the target has no live socket and push is configured', async () => {
    hubPushMock.mockResolvedValue(0);
    const res = await call('/api/friends/request', { body: { userId: FRIEND }, envOver: pushEnv });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('pending');
    await vi.waitFor(() => expect(webPushMock).toHaveBeenCalledTimes(1));
    const [, userId, payload] = webPushMock.mock.calls[0];
    expect(userId).toBe(FRIEND);
    expect(payload).toMatchObject({ title: 'Me sent you a friend request', url: '/friends#requests', tag: `friend-request-${ME}` });
  });

  it('does not Web Push when the live socket delivered it', async () => {
    hubPushMock.mockResolvedValue(2);
    await call('/api/friends/request', { body: { userId: FRIEND }, envOver: pushEnv });
    await vi.waitFor(() => expect(hubPushMock).toHaveBeenCalled());
    await Promise.resolve();
    expect(webPushMock).not.toHaveBeenCalled();
  });

  it('does not Web Push when push is not configured', async () => {
    hubPushMock.mockResolvedValue(0);
    await call('/api/friends/request', { body: { userId: FRIEND } });
    await vi.waitFor(() => expect(hubPushMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(webPushMock).not.toHaveBeenCalled();
  });

  it('a failing push never fails the request', async () => {
    hubPushMock.mockResolvedValue(0);
    webPushMock.mockRejectedValue(new Error('push service down'));
    const res = await call('/api/friends/request', { body: { userId: FRIEND }, envOver: pushEnv });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    await vi.waitFor(() => expect(webPushMock).toHaveBeenCalled());
  });

  it('sends nothing for an idempotent repeat of an existing request', async () => {
    hubPushMock.mockResolvedValue(0);
    installDb((text) => (INSERT.test(text) || ACCEPT.test(text) ? [] : /SELECT status FROM friendships/.test(text) ? [{ status: 'pending' }] : undefined));
    const res = await call('/api/friends/request', { body: { userId: FRIEND }, envOver: pushEnv });
    expect(res.json.status).toBe('pending');
    await new Promise((r) => setTimeout(r, 10));
    expect(hubPushMock).not.toHaveBeenCalled();
    expect(webPushMock).not.toHaveBeenCalled();
  });
});

describe('Web Push for accepted requests', () => {
  it('POST /accept: offline requester gets a Web Push to /friends', async () => {
    acceptDb();
    hubPushMock.mockResolvedValue(0);
    const res = await call('/api/friends/accept', { body: { userId: FRIEND }, envOver: pushEnv });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('accepted');
    await vi.waitFor(() => expect(webPushMock).toHaveBeenCalledTimes(1));
    const [, userId, payload] = webPushMock.mock.calls[0];
    expect(userId).toBe(FRIEND);
    expect(payload).toMatchObject({ title: 'Me accepted your friend request', url: '/friends' });
  });

  it('mutual request auto-accept: offline target gets the accepted Web Push', async () => {
    installDb((text, params) => (ACCEPT.test(text) ? (params[0] === FRIEND && params[1] === ME ? [{ ok: 1 }] : []) : undefined));
    hubPushMock.mockResolvedValue(0);
    const res = await call('/api/friends/request', { body: { userId: FRIEND }, envOver: pushEnv });
    expect(res.json.status).toBe('accepted');
    await vi.waitFor(() => expect(webPushMock).toHaveBeenCalledTimes(1));
    expect(webPushMock.mock.calls[0][2].url).toBe('/friends');
  });

  it('online requester: live socket only', async () => {
    acceptDb();
    hubPushMock.mockResolvedValue(1);
    await call('/api/friends/accept', { body: { userId: FRIEND }, envOver: pushEnv });
    await vi.waitFor(() => expect(hubPushMock).toHaveBeenCalledWith(expect.anything(), FRIEND, expect.objectContaining({ t: 'friend_accepted' })));
    await new Promise((r) => setTimeout(r, 10));
    expect(webPushMock).not.toHaveBeenCalled();
  });
});
