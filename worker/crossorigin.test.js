// Optional cross-origin mode (SPA hosted away from the Worker): CORS allowlist, bearer sessions,
// sign-in token hand-out, WebSocket tickets, WebSocket Origin check, and the unchanged CSRF guard.
// In-process (Hono app), database and Durable Objects faked: no network.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

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

const { default: worker } = await import('./index.js');
const { signSession, signWsTicket, verifySession, verifyWsTicket, readBearer, WS_TICKET_SECONDS } = await import('./auth.js');
const { allowedOrigins, allowedOrigin, isForeignOrigin, corsEnabled } = await import('./cors.js');
const { _resetForTests } = await import('./ratelimit.js');

const SECRET = 'unit-test-secret-unit-test-secret-1234';
const APP = 'https://app.vercel.test';
const WORKER = 'https://worker.test';
const FOREIGN = 'https://evil.example';
const ME = '00000000-0000-4000-8000-0000000000a1';
const GUEST = '00000000-0000-4000-8000-0000000000c3';

const baseEnv = { JWT_SECRET: SECRET, DATABASE_URL: 'postgres://fake' };
const crossEnv = { ...baseEnv, ALLOWED_ORIGINS: ` ${APP} , *, not a url, https://other.vercel.test/ ` };

const userRow = (id, over = {}) => ({
  id,
  google_sub: null,
  email: null,
  name: id === ME ? 'Me' : 'Guest',
  avatar: 3,
  friend_code: 'HYD-ME22',
  is_guest: id !== ME,
  xp: 0,
  coins: 0,
  level: 1,
  games: 0,
  wins: 0,
  best_worth: 0,
  rent_earned: 0,
  ...over,
});
const users = new Map();

function installDb() {
  queryMock.mockImplementation(async (e, text, params = []) => {
    if (/INSERT INTO users/.test(text)) return [users.get(GUEST)];
    if (/FROM users WHERE id = \$1/.test(text)) {
      const row = users.get(params[0]);
      return row ? [row] : [];
    }
    if (/UPDATE users SET last_seen/.test(text)) return [users.get(params[0])].filter(Boolean);
    return [];
  });
}

async function call(path, { method = 'GET', headers = {}, body, env = crossEnv, base = WORKER } = {}) {
  const h = new Headers(headers);
  if (body !== undefined) h.set('content-type', 'application/json');
  const res = await worker.fetch(
    new Request(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
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

const bearer = async (id = ME, isGuest = false) => ({ authorization: `Bearer ${await signSession(baseEnv, { id, isGuest })}` });
const cookie = async (id = ME, isGuest = false) => ({ cookie: `hyd_session=${await signSession(baseEnv, { id, isGuest })}` });

beforeEach(() => {
  queryMock.mockReset();
  _resetForTests();
  users.clear();
  users.set(ME, userRow(ME));
  users.set(GUEST, userRow(GUEST, { is_guest: true }));
  installDb();
});

// ------------------------------------------------------------------------------ the allowlist

describe('ALLOWED_ORIGINS parsing', () => {
  it('trims, normalises to exact origins, and drops "*" and junk', () => {
    expect([...allowedOrigins(crossEnv)]).toEqual([APP, 'https://other.vercel.test']);
    expect(allowedOrigins({ ALLOWED_ORIGINS: '*' }).size).toBe(0);
    expect(allowedOrigins({ ALLOWED_ORIGINS: 'https://*.vercel.app' }).size).toBe(0);
    expect(allowedOrigins({ ALLOWED_ORIGINS: 'ftp://x.test,javascript:alert(1)' }).size).toBe(0);
    expect(allowedOrigins({}).size).toBe(0);
    expect(corsEnabled(baseEnv)).toBe(false);
    expect(corsEnabled(crossEnv)).toBe(true);
  });

  it('matches exact origins only (no prefix, suffix, scheme or port tricks)', () => {
    expect(allowedOrigin(crossEnv, APP)).toBe(APP);
    expect(allowedOrigin(crossEnv, `${APP}.evil.com`)).toBeNull();
    expect(allowedOrigin(crossEnv, 'https://evil.app.vercel.test')).toBeNull();
    expect(allowedOrigin(crossEnv, 'http://app.vercel.test')).toBeNull();
    expect(allowedOrigin(crossEnv, 'https://app.vercel.test:444')).toBeNull();
    expect(allowedOrigin(crossEnv, 'null')).toBeNull();
    expect(allowedOrigin(crossEnv, undefined)).toBeNull();
  });

  it('isForeignOrigin is strict (no loopback leniency)', () => {
    expect(isForeignOrigin(undefined, `${WORKER}/api/x`)).toBe(false);
    expect(isForeignOrigin(WORKER, `${WORKER}/api/x`)).toBe(false);
    expect(isForeignOrigin(APP, `${WORKER}/api/x`)).toBe(true);
    expect(isForeignOrigin('http://localhost:4173', 'http://127.0.0.1:8787/api/x')).toBe(true);
  });
});

// ------------------------------------------------------------------------------ CORS

describe('CORS on /api/*', () => {
  it('answers an allowlisted origin with its own origin (never *), Vary, and no credentials header', async () => {
    const res = await call('/api/config', { headers: { origin: APP } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
    expect(res.headers.get('vary')).toMatch(/Origin/i);
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store'); // the security headers still apply
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('gives a foreign origin no CORS headers at all', async () => {
    const res = await call('/api/config', { headers: { origin: FOREIGN } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('adds CORS headers to error responses too (so the SPA can read a 401)', async () => {
    const res = await call('/api/rooms/mine', { headers: { origin: APP } });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
  });

  it('answers a preflight with 204 before auth, rate limiting and the database', async () => {
    const res = await call('/api/rooms', {
      method: 'OPTIONS',
      headers: { origin: APP, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type');
    expect(res.headers.get('access-control-max-age')).toBe('600');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(res.headers.get('vary')).toMatch(/Origin/i);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('does not answer a preflight from a foreign origin', async () => {
    const res = await call('/api/rooms', { method: 'OPTIONS', headers: { origin: FOREIGN, 'access-control-request-method': 'POST' } });
    expect(res.status).not.toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-methods')).toBeNull();
  });

  it('is completely inert without ALLOWED_ORIGINS (same-origin deployment unchanged)', async () => {
    const res = await call('/api/config', { headers: { origin: APP }, env: baseEnv });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('vary')).toBeNull();
    const pre = await call('/api/rooms', { method: 'OPTIONS', headers: { origin: APP }, env: baseEnv });
    expect(pre.status).not.toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
  });
});

// ------------------------------------------------------------------------------ bearer sessions

describe('bearer authentication', () => {
  it('parses Authorization headers strictly', () => {
    expect(readBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(readBearer('bearer abc')).toBe('abc');
    expect(readBearer('Basic abc')).toBeNull();
    expect(readBearer('Bearer')).toBeNull();
    expect(readBearer('Bearer a b')).toBeNull();
    expect(readBearer(undefined)).toBeNull();
  });

  it('accepts a valid bearer token (same user shape as a cookie session)', async () => {
    const res = await call('/api/me', { headers: await bearer() });
    expect(res.status).toBe(200);
    expect(res.json.user).toMatchObject({ id: ME, name: 'Me', isGuest: false });
  });

  it('still accepts the cookie (same-origin clients and no-bearer requests)', async () => {
    const viaCookie = await call('/api/me', { headers: await cookie() });
    const viaBearer = await call('/api/me', { headers: await bearer() });
    expect(viaCookie.json).toEqual(viaBearer.json);
    const noEnvCookie = await call('/api/me', { headers: await cookie(), env: baseEnv }); // no cross-origin config at all
    expect(noEnvCookie.json.user.id).toBe(ME);
  });

  it('treats a bad bearer token as signed out: 401 on protected routes, no cookie fallback', async () => {
    const bad = { authorization: 'Bearer not.a.jwt' };
    expect((await call('/api/me', { headers: bad })).json).toEqual({ user: null });
    expect((await call('/api/rooms/mine', { headers: bad })).status).toBe(401);
    const tampered = (await signSession(baseEnv, { id: ME })).slice(0, -3) + 'abc';
    expect((await call('/api/rooms/mine', { headers: { authorization: `Bearer ${tampered}` } })).status).toBe(401);
    const both = await call('/api/rooms/mine', { headers: { ...bad, ...(await cookie()) } });
    expect(both.status).toBe(401);
    const wrongSecret = await signSession({ JWT_SECRET: 'another-secret-another-secret-9999' }, { id: ME });
    expect((await call('/api/rooms/mine', { headers: { authorization: `Bearer ${wrongSecret}` } })).status).toBe(401);
  });

  it('works for guests too', async () => {
    const res = await call('/api/me', { headers: await bearer(GUEST, true) });
    expect(res.json.user).toMatchObject({ id: GUEST, isGuest: true });
  });
});

// ------------------------------------------------------------------------------ sign-in token

describe('sign-in hands out the session token only to an allowlisted cross-origin SPA', () => {
  const guest = (headers) => call('/api/auth/guest', { method: 'POST', headers, body: { name: 'Asha' } });

  it('allowlisted cross-origin: body carries a token that is a valid session for that user', async () => {
    const res = await guest({ origin: APP });
    expect(res.status).toBe(200);
    expect(typeof res.json.token).toBe('string');
    expect(await verifySession(baseEnv, res.json.token)).toEqual({ uid: GUEST, guest: true });
    expect(res.json.user.id).toBe(GUEST);
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
  });

  it('same-origin (Origin equals the Worker, or none): no token in the body, cookie still set', async () => {
    for (const headers of [{ origin: WORKER }, {}]) {
      const res = await guest(headers);
      expect(res.status).toBe(200);
      expect(res.json.token).toBeUndefined();
      expect(Object.keys(res.json)).toEqual(['user']);
      expect(res.headers.get('set-cookie')).toMatch(/^hyd_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
    }
  });

  it('same-origin even when the Worker itself is in the allowlist: still no token', async () => {
    const env = { ...baseEnv, ALLOWED_ORIGINS: `${WORKER},${APP}` };
    const res = await call('/api/auth/guest', { method: 'POST', headers: { origin: WORKER }, body: {}, env });
    expect(res.json.token).toBeUndefined();
  });

  it('foreign, non-allowlisted origin: refused, nothing issued', async () => {
    const res = await guest({ origin: FOREIGN });
    expect(res.status).toBe(403);
    expect(res.json.token).toBeUndefined();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('allowlisted origin but no ALLOWED_ORIGINS configured on this Worker: refused (default is same-origin only)', async () => {
    const res = await call('/api/auth/guest', { method: 'POST', headers: { origin: APP }, body: {}, env: baseEnv });
    expect(res.status).toBe(403);
    expect(res.json.token).toBeUndefined();
  });

  it('/api/auth/google from the allowlisted SPA reaches the verifier (rate-limited public endpoint)', async () => {
    const res = await call('/api/auth/google', { method: 'POST', headers: { origin: APP }, body: {} });
    expect(res.status).not.toBe(403); // not blocked by the CSRF guard: Google verification then rejects the empty credential
  });
});

// ------------------------------------------------------------------------------ CSRF guard

describe('CSRF guard for state-changing requests', () => {
  const patch = (headers, env = crossEnv) => call('/api/me', { method: 'PATCH', headers, body: {}, env });

  it('refuses a foreign origin even with a valid cookie or a valid bearer (exactly as before)', async () => {
    expect((await patch({ origin: FOREIGN, ...(await cookie()) })).status).toBe(403);
    expect((await patch({ origin: FOREIGN, ...(await bearer()) })).status).toBe(403);
    expect((await patch({ origin: FOREIGN, ...(await cookie()) }, baseEnv)).status).toBe(403);
    expect((await patch({ origin: 'null', ...(await cookie()) })).status).toBe(403);
  });

  it('refuses an allowlisted origin that relies on the cookie instead of a bearer token', async () => {
    expect((await patch({ origin: APP, ...(await cookie()) })).status).toBe(403);
    expect((await patch({ origin: APP })).status).toBe(403);
    expect((await patch({ origin: APP, authorization: 'Bearer not.a.jwt' })).status).toBe(403);
  });

  it('lets an allowlisted origin act with a valid bearer token', async () => {
    const res = await patch({ origin: APP, ...(await bearer()) });
    expect(res.status).toBe(200);
    expect(res.json.user.id).toBe(ME);
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
  });

  it('same-origin and origin-less requests behave as before', async () => {
    expect((await patch({ origin: WORKER, ...(await cookie()) })).status).toBe(200);
    expect((await patch({ ...(await cookie()) })).status).toBe(200);
    expect((await patch({ origin: WORKER, ...(await cookie()) }, baseEnv)).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------ WebSocket tickets

describe('WebSocket ticket tokens', () => {
  const ticketJwt = ({ aud = 'hyd-ws', iss = 'hyderabad-tycoon', exp = '60s', secret = SECRET, sub = ME } = {}) =>
    new SignJWT({ guest: false })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(new TextEncoder().encode(secret));

  it('a minted ticket verifies, and expires within a minute', async () => {
    const t = await signWsTicket(baseEnv, { id: ME, isGuest: true });
    expect(await verifyWsTicket(baseEnv, t)).toEqual({ uid: ME, guest: true });
    const payload = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
    expect(payload.aud).toBe('hyd-ws');
    expect(payload.exp - payload.iat).toBe(WS_TICKET_SECONDS);
    expect(WS_TICKET_SECONDS).toBe(60);
  });

  it('rejects an expired ticket, a wrong audience, a wrong issuer, a wrong secret and junk', async () => {
    expect(await verifyWsTicket(baseEnv, await ticketJwt({ exp: Math.floor(Date.now() / 1000) - 5 }))).toBeNull();
    expect(await verifyWsTicket(baseEnv, await ticketJwt({ aud: 'other' }))).toBeNull();
    expect(await verifyWsTicket(baseEnv, await ticketJwt({ iss: 'someone-else' }))).toBeNull();
    expect(await verifyWsTicket(baseEnv, await ticketJwt({ secret: 'another-secret-another-secret-9999' }))).toBeNull();
    expect(await verifyWsTicket(baseEnv, 'nope')).toBeNull();
    expect(await verifyWsTicket(baseEnv, '')).toBeNull();
    expect(await verifyWsTicket(baseEnv, undefined)).toBeNull();
  });

  it('a session JWT is not a ticket, and a ticket is not an API session', async () => {
    const session = await signSession(baseEnv, { id: ME });
    const ticket = await signWsTicket(baseEnv, { id: ME });
    expect(await verifyWsTicket(baseEnv, session)).toBeNull();
    expect(await verifySession(baseEnv, ticket)).toBeNull();
    // ... also over HTTP: a ticket as bearer means signed out
    expect((await call('/api/me', { headers: { authorization: `Bearer ${ticket}` } })).json).toEqual({ user: null });
    expect((await call('/api/rooms/mine', { headers: { authorization: `Bearer ${ticket}` } })).status).toBe(401);
  });

  it('POST /api/ws-ticket needs a session (bearer or cookie) and returns a fresh ticket each time', async () => {
    expect((await call('/api/ws-ticket', { method: 'POST', body: {} })).status).toBe(401);
    expect((await call('/api/ws-ticket', { method: 'POST', body: {}, headers: { authorization: 'Bearer junk' } })).status).toBe(401);

    const a = await call('/api/ws-ticket', { method: 'POST', body: {}, headers: await bearer() });
    expect(a.status).toBe(200);
    expect(a.json.expiresIn).toBe(60);
    expect(await verifyWsTicket(baseEnv, a.json.ticket)).toEqual({ uid: ME, guest: false });
    expect(a.headers.get('cache-control')).toBe('no-store');

    const viaCookie = await call('/api/ws-ticket', { method: 'POST', body: {}, headers: await cookie(GUEST, true) });
    expect(await verifyWsTicket(baseEnv, viaCookie.json.ticket)).toEqual({ uid: GUEST, guest: true });
  });

  it('cross-origin: the allowlisted SPA needs its bearer for the ticket; a foreign origin never gets one', async () => {
    const ok = await call('/api/ws-ticket', { method: 'POST', body: {}, headers: { origin: APP, ...(await bearer()) } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe(APP);
    expect((await call('/api/ws-ticket', { method: 'POST', body: {}, headers: { origin: APP, ...(await cookie()) } })).status).toBe(403);
    expect((await call('/api/ws-ticket', { method: 'POST', body: {}, headers: { origin: FOREIGN, ...(await bearer()) } })).status).toBe(403);
  });

  it('does not mint a ticket for a user that no longer exists', async () => {
    const res = await call('/api/ws-ticket', { method: 'POST', body: {}, headers: await bearer('00000000-0000-4000-8000-0000000000ff') });
    expect(res.status).toBe(401);
  });
});

// ------------------------------------------------------------------------------ WebSocket upgrade

describe('WebSocket upgrades', () => {
  const closes = [];
  const forwarded = [];
  const doEnv = (extra = {}) => ({
    ...crossEnv,
    ...extra,
    GAME_ROOM: {
      idFromName: (n) => n,
      get: (id) => ({
        fetch: async (req) => {
          forwarded.push({ id, kind: 'room', headers: Object.fromEntries(req.headers), url: req.url });
          return new Response('room-ok', { status: 200 });
        },
      }),
    },
    USER_HUB: {
      idFromName: (n) => n,
      get: (id) => ({
        fetch: async (req) => {
          forwarded.push({ id, kind: 'user', headers: Object.fromEntries(req.headers), url: req.url });
          return new Response('hub-ok', { status: 200 });
        },
      }),
    },
  });

  beforeEach(() => {
    closes.length = 0;
    forwarded.length = 0;
    vi.stubGlobal(
      'WebSocketPair',
      class {
        constructor() {
          const server = { accept() {}, close: (code, reason) => closes.push({ code, reason }) };
          return { 0: {}, 1: server };
        }
      },
    );
  });

  const ws = (path, { origin, query = '', headers = {}, env } = {}) =>
    call(`${path}${query}`, {
      headers: { upgrade: 'websocket', connection: 'Upgrade', ...(origin ? { origin } : {}), ...headers },
      env: env || doEnv(),
    });

  it('refuses a foreign Origin (403) and a non-websocket request (426)', async () => {
    const ticket = await signWsTicket(baseEnv, { id: ME });
    expect((await ws('/ws/user', { origin: FOREIGN, query: `?ticket=${ticket}` })).status).toBe(403);
    expect((await ws('/ws/room/ABCD23', { origin: FOREIGN, query: `?ticket=${ticket}` })).status).toBe(403);
    expect(forwarded).toHaveLength(0);
    const plain = await call('/ws/user', { env: doEnv() });
    expect(plain.status).toBe(426);
  });

  it('still refuses a foreign Origin when no allowlist is configured', async () => {
    const res = await ws('/ws/user', { origin: APP, env: doEnv({ ALLOWED_ORIGINS: '' }) });
    expect(res.status).toBe(403);
  });

  it('accepts the allowlisted Origin with a ticket and hands the Durable Object the trusted identity', async () => {
    const ticket = await signWsTicket(baseEnv, { id: ME, isGuest: false });
    const res = await ws('/ws/room/abcd23', { origin: APP, query: `?ticket=${ticket}` });
    expect(res.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    const f = forwarded[0];
    expect(f.kind).toBe('room');
    expect(f.id).toBe('ABCD23');
    expect(f.headers['x-user-id']).toBe(ME);
    expect(decodeURIComponent(f.headers['x-user-name'])).toBe('Me');
    expect(f.headers['x-user-guest']).toBe('0');
    expect(f.headers['x-room-code']).toBe('ABCD23');
    expect(f.url).toBe('https://internal.invalid/ws'); // the ticket / query never reach the Durable Object
    expect(JSON.stringify(f)).not.toContain(ticket);
  });

  it('works on /ws/user and for guests', async () => {
    const ticket = await signWsTicket(baseEnv, { id: GUEST, isGuest: true });
    const res = await ws('/ws/user', { origin: APP, query: `?ticket=${ticket}` });
    expect(res.status).toBe(200);
    expect(forwarded[0]).toMatchObject({ kind: 'user', id: GUEST });
    expect(forwarded[0].headers['x-user-guest']).toBe('1');
  });

  it('client-supplied identity headers can never spoof the user', async () => {
    const ticket = await signWsTicket(baseEnv, { id: ME });
    await ws('/ws/user', {
      origin: APP,
      query: `?ticket=${ticket}`,
      headers: { 'x-user-id': GUEST, 'x-user-name': 'Admin', 'x-user-guest': '1', 'x-room-code': 'ZZZZZZ' },
    });
    expect(forwarded[0].headers['x-user-id']).toBe(ME);
    expect(decodeURIComponent(forwarded[0].headers['x-user-name'])).toBe('Me');
    expect(forwarded[0].headers['x-user-guest']).toBe('0');
    expect(forwarded[0].headers['x-room-code']).toBeUndefined();
  });

  it('a ticket on one connection says nothing about another user: the identity is the ticket subject', async () => {
    const ticket = await signWsTicket(baseEnv, { id: GUEST, isGuest: true });
    await ws('/ws/user', { origin: APP, query: `?ticket=${ticket}`, headers: await cookie(ME) });
    expect(forwarded[0].id).toBe(GUEST);
  });

  it('closes with 4001 for a missing, expired, wrong-audience or session-JWT ticket (and never reaches a Durable Object)', async () => {
    const expired = await new SignJWT({ guest: false })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ME)
      .setIssuer('hyderabad-tycoon')
      .setAudience('hyd-ws')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));
    const session = await signSession(baseEnv, { id: ME });
    for (const query of ['', '?ticket=', '?ticket=junk', `?ticket=${expired}`, `?ticket=${session}`]) {
      closes.length = 0;
      await ws('/ws/user', { origin: APP, query }); // the Response(101) itself is a workerd feature: the close code is what matters
      expect(closes, `query ${query.slice(0, 20)}`).toEqual([{ code: 4001, reason: 'Please sign in first.' }]);
    }
    expect(forwarded).toHaveLength(0);
  });

  it('an invalid ticket does not fall back to the cookie', async () => {
    await ws('/ws/user', { origin: APP, query: '?ticket=junk', headers: await cookie(ME) });
    expect(closes).toEqual([{ code: 4001, reason: 'Please sign in first.' }]);
    expect(forwarded).toHaveLength(0);
  });

  it('same-origin and non-browser clients keep using the cookie (no Origin header, no ticket)', async () => {
    const res = await ws('/ws/user', { headers: await cookie(ME) });
    expect(res.status).toBe(200);
    expect(forwarded[0]).toMatchObject({ kind: 'user', id: ME });
    forwarded.length = 0;
    const same = await ws('/ws/user', { origin: WORKER, headers: await cookie(ME), env: doEnv({ ALLOWED_ORIGINS: '' }) });
    expect(same.status).toBe(200);
    expect(forwarded[0].id).toBe(ME);
  });

  it('accepts a bearer header from a non-browser client', async () => {
    const res = await ws('/ws/user', { headers: await bearer(ME) });
    expect(res.status).toBe(200);
    expect(forwarded[0].id).toBe(ME);
  });
});
