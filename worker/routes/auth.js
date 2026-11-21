import { Hono } from 'hono';
import {
  verifyGoogleCredential,
  upsertGoogleUser,
  createGuestUser,
  signSession,
  sessionCookie,
  clearSessionCookie,
  isSecureRequest,
  isBanned,
  bannedBody,
} from '../auth.js';
import { allowedOrigin, isForeignOrigin } from '../cors.js';
import { limit } from '../ratelimit.js';
import { rowToUser, loadGameStats } from '../users.js';
import { readJson } from '../http.js';
import { applyReferral } from '../referrals.js';

const auth = new Hono();

/**
 * Cross-origin mode: only a request from an allowlisted origin that is NOT the Worker's own origin
 * (e.g. the Vercel-hosted SPA) gets the session JWT in the JSON body, so it can send it as a bearer token.
 * Same-origin responses never contain it: the HttpOnly cookie stays unreadable to scripts.
 */
export function exposesToken(c) {
  const origin = c.req.header('origin');
  return !!allowedOrigin(c.env, origin) && isForeignOrigin(origin, c.req.url);
}

async function startSession(c, row) {
  const token = await signSession(c.env, { id: row.id, isGuest: row.is_guest });
  c.header('Set-Cookie', sessionCookie(token, isSecureRequest(c.req.raw)));
  // A suspended account still gets its session (so /api/me keeps answering "suspended" after a reload), but the
  // sign-in itself answers 403 code 'banned' like every other endpoint that loads the user (docs/ADMIN.md "Bans").
  if (isBanned(row)) return c.json(bannedBody(row), 403);
  const body = { user: rowToUser(row, await loadGameStats(c.env, row.id), Date.now(), c.env) };
  if (exposesToken(c)) body.token = token;
  return c.json(body);
}

// POST /api/auth/google { credential, ref? }
// `ref` (a friend code from a /?ref= or /f/ link) is recorded as users.referred_by only when this call CREATED the
// account; it is ignored for an existing account and for an unknown / guest / banned / own code (docs/ENGAGEMENT.md).
auth.post('/google', limit('auth-google', 20, 60), async (c) => {
  const body = await readJson(c);
  const claims = await verifyGoogleCredential(body.credential, c.env.GOOGLE_CLIENT_ID);
  const row = await upsertGoogleUser(c.env, claims);
  if (row && row.inserted && body.ref !== undefined && body.ref !== null) {
    try {
      await applyReferral(c.env, row.id, body.ref);
    } catch (err) {
      console.error('referral not recorded:', err && err.message); // never fails the sign-in
    }
  }
  return startSession(c, row);
});

// POST /api/auth/guest { name?, avatar? }
auth.post('/guest', limit('auth-guest', 10, 60), async (c) => {
  const body = await readJson(c);
  const row = await createGuestUser(c.env, { name: body.name, avatar: body.avatar });
  return startSession(c, row);
});

// POST /api/auth/logout
auth.post('/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookie(isSecureRequest(c.req.raw)));
  return c.json({ ok: true });
});

export default auth;
