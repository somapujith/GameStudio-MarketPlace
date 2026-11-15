// GameHub - Cloudflare Worker entry.
// Same-origin API (cookie sessions), WebSocket upgrades forwarded to Durable Objects, everything
// else served from the static bundle (ASSETS). OPTIONAL cross-origin mode (SPA hosted elsewhere,
// e.g. Vercel): set ALLOWED_ORIGINS and clients use bearer tokens + WebSocket tickets (see cors.js).
import { Hono } from 'hono';
import {
  sessionMiddleware,
  sessionFromRequest,
  readBearer,
  verifySession,
  verifyWsTicket,
  isSameOrigin,
  isSecureRequest,
  currentUser,
} from './auth.js';
import { corsMiddleware, allowedOrigin } from './cors.js';
import { apiSecurityHeaders } from './security.js';
import { HttpError } from './db.js';
import { normalizeRoomCode } from './codes.js';
import { roomStub, userHubStub } from './hub.js';
import configRoutes from './routes/config.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import friendRoutes from './routes/friends.js';
import roomRoutes from './routes/rooms.js';
import inviteRoutes from './routes/invites.js';
import leaderboardRoutes from './routes/leaderboard.js';
import gameRoutes from './routes/games.js';
import healthRoutes from './routes/health.js';
import shopRoutes from './routes/shop.js';
import pushRoutes from './routes/push.js';
import wsTicketRoutes from './routes/wsTicket.js';

export { GameRoom } from './GameRoom.js';
export { UserHub } from './UserHub.js';

const app = new Hono();

// ---- API ---------------------------------------------------------------------------
const api = new Hono();

// CORS for allowlisted origins only (no-op unless ALLOWED_ORIGINS is set). First, so a preflight is answered
// before security headers, the CSRF guard, authentication and rate limiting.
api.use('*', corsMiddleware);

// Security headers on every API response (static assets get theirs from public/_headers).
api.use('*', async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(apiSecurityHeaders(isSecureRequest(c.req.raw)))) {
    // A route may opt into short caching of public data (open tables); everything else is no-store.
    if (k === 'Cache-Control' && c.res.headers.has('Cache-Control')) continue;
    c.header(k, v);
  }
});

// Public sign-in endpoints (rate limited in routes/auth.js): an allowlisted origin may call them without a token.
const PUBLIC_AUTH_PATHS = new Set(['/api/auth/guest', '/api/auth/google']);

// CSRF defence in depth (cookies are SameSite=Lax): refuse cross-origin state changes. The only exception is an
// allowlisted origin (ALLOWED_ORIGINS, the cross-origin SPA): it may call the public sign-in endpoints, or any
// endpoint when it carries a valid bearer token (a token a foreign page cannot obtain or attach by itself).
api.use('*', async (c, next) => {
  const m = c.req.method;
  const origin = c.req.header('origin');
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || isSameOrigin(origin, c.req.url)) return next();
  if (allowedOrigin(c.env, origin)) {
    if (PUBLIC_AUTH_PATHS.has(new URL(c.req.url).pathname)) return next();
    const bearer = readBearer(c.req.header('authorization'));
    if (bearer && (await verifySession(c.env, bearer))) return next();
  }
  return c.json({ error: 'Cross-origin request refused.' }, 403);
});

// Health first: it must answer even when secrets are missing (no session parsing).
api.route('/health', healthRoutes);

api.use('*', sessionMiddleware);

api.route('/config', configRoutes);
api.route('/auth', authRoutes);
api.route('/me', meRoutes);
api.route('/friends', friendRoutes);
api.route('/games', gameRoutes);
api.route('/rooms', roomRoutes);
api.route('/invites', inviteRoutes);
api.route('/leaderboard', leaderboardRoutes);
api.route('/shop', shopRoutes);
api.route('/push', pushRoutes);
api.route('/ws-ticket', wsTicketRoutes);
api.notFound((c) => c.json({ error: 'Not found.' }, 404));

app.route('/api', api);

// ---- WebSockets ----------------------------------------------------------------------
const WS_FORWARD_HEADERS = [
  'upgrade',
  'connection',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-protocol',
  'sec-websocket-extensions',
];

/**
 * Build the request forwarded to a Durable Object. Only handshake headers are copied from
 * the client; the identity headers are set here from the verified session (never from the
 * client). Names are percent-encoded because HTTP header values must be Latin-1.
 */
function forwardRequest(request, user, extra = {}) {
  const headers = new Headers();
  for (const h of WS_FORWARD_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('X-User-Id', user.id);
  headers.set('X-User-Name', encodeURIComponent(user.name));
  headers.set('X-User-Avatar', String(user.avatar));
  headers.set('X-User-Guest', user.is_guest ? '1' : '0');
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Request('https://internal.invalid/ws', { headers });
}

/**
 * Accept a WebSocket only to close it at once with an application close code, so the
 * browser client learns *why* (4001 sign in, 4004 not found) and does not retry blindly.
 */
function closedSocket(code, reason) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

/**
 * WebSocket upgrades: when the browser sends an Origin it must be the Worker's own origin (or loopback in dev)
 * or an allowlisted origin. Clients without an Origin header (non-browser) are unaffected.
 */
async function wsGuard(c, next) {
  if ((c.req.header('upgrade') || '').toLowerCase() !== 'websocket') {
    return c.json({ error: 'Expected a WebSocket upgrade.' }, 426);
  }
  const origin = c.req.header('origin');
  if (!isSameOrigin(origin, c.req.url) && !allowedOrigin(c.env, origin)) {
    return c.json({ error: 'Cross-origin request refused.' }, 403);
  }
  await next();
}

/**
 * Identity of a WebSocket upgrade: a `?ticket=` (cross-origin clients; see POST /api/ws-ticket), else a bearer
 * header or the session cookie. A ticket that is present but invalid means "signed out" (no cookie fallback).
 * The ticket never leaves this function: the Durable Object only sees the identity headers set in forwardRequest.
 */
async function wsSession(c, next) {
  const ticket = c.req.query('ticket');
  c.set('session', ticket ? await verifyWsTicket(c.env, ticket) : await sessionFromRequest(c));
  await next();
}

app.get('/ws/room/:code', wsGuard, wsSession, async (c) => {
  const user = await currentUser(c);
  if (!user) return closedSocket(4001, 'Please sign in first.');
  const code = normalizeRoomCode(c.req.param('code'));
  if (!code) return closedSocket(4004, 'That room code is not valid.');
  return roomStub(c.env, code).fetch(forwardRequest(c.req.raw, user, { 'X-Room-Code': code }));
});

app.get('/ws/user', wsGuard, wsSession, async (c) => {
  const user = await currentUser(c);
  if (!user) return closedSocket(4001, 'Please sign in first.');
  return userHubStub(c.env, user.id).fetch(forwardRequest(c.req.raw, user));
});

// ---- errors --------------------------------------------------------------------------
function onError(err, c) {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  // Log only the message/code: errors from the DB driver must never leak parameters.
  console.error('Unhandled error:', err && err.code ? `${err.code} ${err.message}` : err && err.message);
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
}
app.onError(onError);
api.onError(onError);

const isWorkerPath = (p) => p === '/api' || p.startsWith('/api/') || p.startsWith('/ws/');

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (isWorkerPath(pathname)) return app.fetch(request, env, ctx);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
