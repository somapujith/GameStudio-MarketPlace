// Tiny fetch wrapper for the Worker API. Cookie session (httpOnly `hyd_session`), JSON in/out.
// Cross-origin mode (VITE_API_ORIGIN, see config.js): absolute URLs, `Authorization: Bearer <hyd_token>`, no cookies.
//
//   const { friends } = await api.get('/api/friends');
//   await api.post('/api/rooms', { maxPlayers: 4 });
//
// Failures throw an ApiError (`{ status, message }`):
//   - server errors use the server's `{ error }` text as `message`
//   - network failure / timeout / the Worker not running  ->  status 0, message 'Offline'

import { apiUrl, isCrossOrigin } from './config.js';
import { getToken, setToken, clearToken } from './token.js';

const TIMEOUT_MS = 15000;
// Sign-in endpoints: in cross-origin mode their response carries the session token.
const SIGN_IN_PATHS = new Set(['/api/auth/guest', '/api/auth/google']);

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const OFFLINE = () => new ApiError(0, 'Offline');

function fallbackMessage(status) {
  if (status === 401) return 'Please sign in first';
  if (status === 403) return 'Not allowed';
  if (status === 404) return 'Not found';
  if (status === 429) return 'Too many requests, slow down';
  if (status >= 500) return 'Server unavailable, try again';
  return `Request failed (${status})`;
}

async function request(method, path, body, { signal, timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  const cross = isCrossOrigin();
  const token = cross ? getToken() : null;
  const init = {
    method,
    // Same-origin: the httpOnly cookie. Cross-origin: never send cookies, the bearer token is the credential.
    credentials: cross ? 'omit' : 'same-origin',
    headers: { Accept: 'application/json' },
    signal: ctrl.signal,
  };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  let text = '';
  try {
    res = await fetch(apiUrl(path), init);
    text = await res.text();
  } catch {
    throw OFFLINE();
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // HTML (the SPA fallback when no Worker is running) or other junk
      data = undefined;
    }
  }

  // A 401 for a request that carried a token means it is stale: forget it (unless a newer sign-in replaced it meanwhile).
  if (res.status === 401 && token && !path.startsWith('/api/auth/') && getToken() === token) clearToken();
  if (!res.ok) {
    const msg = data && typeof data === 'object' && typeof data.error === 'string' ? data.error : '';
    // A proxy with nothing behind it answers 5xx with an empty / non-JSON body: that is "Offline", not our bug.
    if (!msg && res.status >= 500 && data === undefined) throw OFFLINE();
    throw new ApiError(res.status, msg || fallbackMessage(res.status));
  }
  if (data === undefined) {
    // 2xx but not JSON: the dev server's index.html fallback => the Worker is not reachable
    throw OFFLINE();
  }
  if (cross && SIGN_IN_PATHS.has(path) && data && typeof data.token === 'string') setToken(data.token);
  return data;
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body = {}, opts) => request('POST', path, body, opts),
  patch: (path, body = {}, opts) => request('PATCH', path, body, opts),
  del: (path, opts) => request('DELETE', path, undefined, opts),
};

const enc = encodeURIComponent;

/** GET /api/rooms/:code -> { exists, gameId, visibility, status, players (count), maxPlayers, hostName, settings, isMember }. */
export const getRoom = (code, opts) => api.get(`/api/rooms/${enc(code)}`, opts);

/**
 * POST /api/rooms -> { code, gameId }. Only the fields you pass are sent (the server fills defaults;
 * a missing `gameId` means the first game).
 */
export function createRoom({ gameId, settings, maxPlayers, visibility } = {}, opts) {
  const body = {};
  if (gameId) body.gameId = gameId;
  if (settings && typeof settings === 'object') body.settings = settings;
  if (Number.isInteger(maxPlayers)) body.maxPlayers = maxPlayers;
  if (visibility === 'public' || visibility === 'private') body.visibility = visibility;
  return api.post('/api/rooms', body, opts);
}

/** GET /api/friends/by-code/:friendCode -> { user: { id, name, avatar, handle, level, friendCode, relation } } (signed-in, non-guest). */
export const getFriendByCode = (friendCode, opts) => api.get(`/api/friends/by-code/${enc(friendCode)}`, opts);

/** GET /api/friends/search?q= (2+ chars) -> { results: [{ id, name, avatar, handle, level, equipped, relation }] } (a leading '@' searches usernames only); relation: 'none'|'friends'|'outgoing'|'incoming'. Pass `{ signal }` to cancel. */
export const searchPlayers = (q, opts) => api.get(`/api/friends/search?q=${enc(q)}`, opts);

/** GET /api/friends/recent -> { players: [{ id, name, avatar, level, equipped, relation: 'none' }] } (people I played with, not yet friends). */
export const getRecentPlayers = (opts) => api.get('/api/friends/recent', opts);

/** POST /api/friends/request { userId } -> { ok, status: 'pending'|'accepted', friend } (same answer as adding by friend code). */
export const requestFriendById = (userId, opts) => api.post('/api/friends/request', { userId }, opts);

/** POST /api/friends/request { handle } -> same answer as by id / code. The leading "@" is optional. 404 unknown username, 400 yourself. */
export const requestFriendByHandle = (handle, opts) => api.post('/api/friends/request', { handle: String(handle ?? '').replace(/^@/, '') }, opts);

/** GET /api/me/handle-available?h= -> { available: boolean, reason?: 'invalid'|'taken'|'reserved' } (members only; your own handle counts as available). Pass `{ signal }` to cancel. */
export const checkHandle = (handle, opts) => api.get(`/api/me/handle-available?h=${enc(handle)}`, opts);

/** POST /api/invites: push an invite to room `code` to a friend (the server adds the game's id and name). */
export const sendInvite = (code, userId, opts) => api.post('/api/invites', { code, userId }, opts);

// ---- hub features (contract: docs/HUSTLE_PLAN.md section 4) -----------------------------------

/** GET /api/rooms/mine -> { rooms: [{ code, gameId, status:'lobby'|'playing', players, maxPlayers }] } (signed in). */
export const getMyRooms = (opts) => api.get('/api/rooms/mine', opts);

/** GET /api/rooms/open?game=&limit= -> { rooms: [{ code, gameId, hostName, players, maxPlayers, summary?, createdAt }] }. */
export function getOpenRooms({ gameId, limit = 20 } = {}, opts) {
  const q = new URLSearchParams();
  if (gameId) q.set('game', gameId);
  q.set('limit', String(limit));
  return api.get(`/api/rooms/open?${q}`, opts);
}

/** GET /api/games -> { games: [{ id, name, minPlayers, maxPlayers, openTables }] }. */
export const getGamesLive = (opts) => api.get('/api/games', opts);

/** POST /api/me/daily -> { reward, streak, coins, daily } ; 409 when already claimed today. */
export const claimDailyReward = (opts) => api.post('/api/me/daily', {}, opts);

/** GET /api/me/matches?limit= -> { matches: [{ id, gameId, endedAt, rounds, playerCount, rank, won, score, players:[{ name, avatar, rank, score, isMe }] }] }. */
export const getMyMatches = (limit = 20, opts) => api.get(`/api/me/matches?limit=${enc(limit)}`, opts);

/** GET /api/shop -> { items: [{ ...cosmetic, owned, equipped }], coins, equipped: { frame?, dice?, title? } }. */
export const getShop = (opts) => api.get('/api/shop', opts);

/** POST /api/shop/buy { itemId } -> { coins, owned: itemId[] } ; 402 not enough coins, 409 already owned. */
export const buyCosmetic = (itemId, opts) => api.post('/api/shop/buy', { itemId }, opts);

/** POST /api/shop/equip { kind, itemId|null } -> { equipped }. */
export const equipCosmetic = (kind, itemId, opts) => api.post('/api/shop/equip', { kind, itemId: itemId ?? null }, opts);

/** GET /api/invites -> { invites: [{ id, from:{ id, name, avatar }, code, gameId, gameName, createdAt }] } (fresh, room still in lobby). */
export const getInvites = (opts) => api.get('/api/invites', opts);

/** POST /api/invites/:id/dismiss -> { ok: true }. */
export const dismissInvite = (id, opts) => api.post(`/api/invites/${enc(id)}/dismiss`, {}, opts);

/** GET /api/push/key -> { key: string|null } (VAPID public key; null when push is not configured). */
export const getPushKey = (opts) => api.get('/api/push/key', opts);

/** POST /api/push/subscribe { subscription } -> { ok: true }. DELETE-style unsubscribe: POST /api/push/unsubscribe { endpoint }. */
export const pushSubscribe = (subscription, opts) => api.post('/api/push/subscribe', { subscription }, opts);
export const pushUnsubscribe = (endpoint, opts) => api.post('/api/push/unsubscribe', { endpoint }, opts);

/** Best human message for anything thrown by `api.*` (or anything else). */
export function errorMessage(err, fallback = 'Something went wrong') {
  if (err && typeof err.message === 'string' && err.message) {
    return err.status === 0 ? "You're offline or the server is unreachable" : err.message;
  }
  return fallback;
}

export default api;
