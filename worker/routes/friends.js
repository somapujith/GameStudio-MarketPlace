import { Hono } from 'hono';
import { query, HttpError } from '../db.js';
import { requireMember } from '../auth.js';
import { getUserByFriendCode, getUserByHandle, getUserById, rowToFriend, identity } from '../users.js';
import { normalizeFriendCode } from '../codes.js';
import { isUuid, normalizeHandle } from '../validate.js';
import { limit } from '../ratelimit.js';
import { readJson } from '../http.js';
import { isUserOnline, getUserStatus, roomCall, pushToUser, background } from '../hub.js';
import { isJoinableLobby } from '../presence.js';
import { sendPushToUser, pushConfigured } from '../push.js';
import { blockRelation, NOT_BLOCKED_SQL } from './blocks.js';
import { checkAchievements } from '../achievements.js';

const friends = new Hono();

/** The Web Push for a new friend request (the service worker reads title / body / url / tag). */
export function friendRequestNotification({ fromName, fromId }) {
  return {
    title: `${fromName || 'Someone'} sent you a friend request`,
    body: 'Tap to accept or decline.',
    url: '/friends#requests',
    tag: `friend-request-${fromId}`,
  };
}

/** The Web Push for an accepted request. */
export function friendAcceptedNotification({ byName, byId }) {
  return {
    title: `${byName || 'Someone'} accepted your friend request`,
    body: 'You are friends now. Tap to invite them to a game.',
    url: '/friends',
    tag: `friend-accepted-${byId}`,
  };
}

/**
 * Tell `userId` live over their socket; when no socket took it (they are offline or the app is closed) and Web Push
 * is configured, send a Web Push instead. Best effort: nothing here can fail the request.
 */
export function notifyFriend(c, userId, message, notification) {
  background(
    c,
    (async () => {
      const delivered = await pushToUser(c.env, userId, message);
      if (delivered === 0 && pushConfigured(c.env)) await sendPushToUser(c.env, userId, notification);
    })(),
  );
}
friends.use('*', requireMember); // guests cannot use friends

/**
 * `{ online, status, code?, gameId? }` for one accepted friend. A "lobby" status is only kept (with its code) while the
 * room is still an open lobby with a free seat, checked now through the room's `/info`; otherwise it falls back to
 * plain "online" so a stale or full table is never offered. Never throws.
 */
export async function friendPresence(env, userId) {
  const online = await isUserOnline(env, userId);
  if (!online) return { online: false, status: 'offline' };
  const st = await getUserStatus(env, userId);
  if (!st || (st.status !== 'lobby' && st.status !== 'playing') || !st.code) return { online: true, status: 'online' };
  if (st.status === 'playing') return { online: true, status: 'playing', ...(st.gameId ? { gameId: st.gameId } : {}) };
  try {
    const { data } = await roomCall(env, st.code, '/info');
    if (isJoinableLobby(data, st.code)) return { online: true, status: 'lobby', code: st.code, gameId: data.gameId || st.gameId };
  } catch {
    /* room unreachable: not joinable */
  }
  return { online: true, status: 'online' };
}

// GET /api/friends -> { friends, incoming, outgoing }
//   rows: { id, name, avatar, friendCode, handle|null, online, status, code?, gameId?, level, equipped:{ frame?, dice?, title? } }
//   status: 'offline' | 'online' | 'lobby' | 'playing'; `code` only for an open lobby that still has a seat (checked
//   against the room now), `gameId` for lobby/playing. Friends only: pending requests never carry a status.
friends.get('/', async (c) => {
  const me = c.get('user');
  const rows = await query(
    c.env,
    `SELECT f.status, (f.user_id = $1) AS outgoing,
            u.id, u.name, u.avatar, u.friend_code, u.handle, u.xp, u.equipped
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
      WHERE f.user_id = $1 OR f.friend_id = $1
      ORDER BY lower(u.name), u.id`,
    [me.id],
  );
  const accepted = rows.filter((r) => r.status === 'accepted');
  const presences = await Promise.all(accepted.map((r) => friendPresence(c.env, r.id)));
  return c.json({
    friends: accepted.map((r, i) => ({ ...rowToFriend(r, presences[i].online), ...presences[i] })),
    incoming: rows.filter((r) => r.status === 'pending' && !r.outgoing).map((r) => rowToFriend(r, false)),
    outgoing: rows.filter((r) => r.status === 'pending' && r.outgoing).map((r) => rowToFriend(r, false)),
  });
});

/** Escape LIKE/ILIKE wildcards so a typed `%` or `_` matches itself (used with ESCAPE '\'). */
export const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

const SEARCH_MIN = 2;
const SEARCH_MAX = 40;
const SEARCH_LIMIT = 8;
const RECENT_LIMIT = 12;

/** A search / recent row -> the public card `{ id, name, avatar, handle|null, level, equipped, relation }` (no code, no email). */
function rowToCard(r, meId) {
  const { id, name, avatar, handle, level, equipped } = rowToFriend(r);
  const relation = friendRelation(r.rel_status ? { user_id: r.rel_user_id, status: r.rel_status } : undefined, meId);
  return { id, name, avatar, handle, level, equipped, relation };
}

// GET /api/friends/search?q= -> { results: [{ id, name, avatar, handle, level, equipped, relation }] }
// Members only, never me, max 8. "@foo" searches usernames only (exact match first, then prefix).
// A plain query matches names containing it and usernames starting with it: exact username first,
// then names starting with q, then username prefixes, then the rest.
friends.get('/search', limit('friend-search', 40, 60), async (c) => {
  const me = c.get('user');
  const q = (c.req.query('q') || '').trim();
  if (q.length < SEARCH_MIN) throw new HttpError(400, `Type at least ${SEARCH_MIN} characters to search.`);
  if (q.length > SEARCH_MAX) throw new HttpError(400, 'That search is too long.');
  const FROM = `FROM users u
       LEFT JOIN friendships f
         ON (f.user_id = $1 AND f.friend_id = u.id) OR (f.user_id = u.id AND f.friend_id = $1)`;
  const COLS = 'u.id, u.name, u.avatar, u.handle, u.xp, u.equipped, f.user_id AS rel_user_id, f.status AS rel_status';
  let rows;
  if (q.startsWith('@')) {
    const h = q.slice(1).toLowerCase();
    rows = await query(
      c.env,
      `SELECT ${COLS} ${FROM}
      WHERE u.is_guest = false AND u.id <> $1 AND lower(u.handle) LIKE $2 ESCAPE '\\'
      AND ${NOT_BLOCKED_SQL('u')}
      ORDER BY (lower(u.handle) = $3) DESC, lower(u.handle), u.id
      LIMIT ${SEARCH_LIMIT}`,
      [me.id, `${escapeLike(h)}%`, h],
    );
  } else {
    const esc = escapeLike(q);
    rows = await query(
      c.env,
      `SELECT ${COLS} ${FROM}
      WHERE u.is_guest = false AND u.id <> $1 AND (u.name ILIKE $2 ESCAPE '\\' OR lower(u.handle) LIKE $4 ESCAPE '\\')
      AND ${NOT_BLOCKED_SQL('u')}
      ORDER BY (lower(u.handle) = $5) DESC, (u.name ILIKE $3 ESCAPE '\\') DESC, (lower(u.handle) LIKE $4 ESCAPE '\\') DESC, lower(u.name), u.id
      LIMIT ${SEARCH_LIMIT}`,
      [me.id, `%${esc}%`, `${esc}%`, `${esc.toLowerCase()}%`, q.toLowerCase()],
    );
  }
  return c.json({ results: rows.map((r) => rowToCard(r, me.id)) });
});

// GET /api/friends/recent -> { players: [{ id, name, avatar, handle, level, equipped, relation:'none' }] }
// People I shared a finished match with (most recent first), minus me, guests, friends and pending requests.
friends.get('/recent', limit('friend-recent', 30, 60), async (c) => {
  const me = c.get('user');
  const rows = await query(
    c.env,
    `SELECT u.id, u.name, u.avatar, u.handle, u.xp, u.equipped, max(m.ended_at) AS last_played
       FROM match_players mine
       JOIN match_players theirs ON theirs.match_id = mine.match_id AND theirs.user_id <> mine.user_id
       JOIN matches m ON m.id = mine.match_id
       JOIN users u ON u.id = theirs.user_id
      WHERE mine.user_id = $1 AND u.is_guest = false
        AND ${NOT_BLOCKED_SQL('u')}
        AND NOT EXISTS (
          SELECT 1 FROM friendships f
           WHERE (f.user_id = $1 AND f.friend_id = u.id) OR (f.user_id = u.id AND f.friend_id = $1))
      GROUP BY u.id
      ORDER BY last_played DESC, u.id
      LIMIT ${RECENT_LIMIT}`,
    [me.id],
  );
  return c.json({ players: rows.map((r) => rowToCard(r, me.id)) });
});

/** How `me` relates to the other user, from their friendship row (or undefined). */
export function friendRelation(row, meId) {
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.user_id === meId ? 'outgoing' : 'incoming';
}

/** The preview card of `target` as seen by `me` (shared by by-code and by-handle). */
async function previewUser(c, me, target) {
  const rows = await query(
    c.env,
    `SELECT user_id, status FROM friendships
      WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [me.id, target.id],
  );
  const { id, name, avatar, handle, level, friendCode } = rowToFriend(target);
  return c.json({ user: { id, name, avatar, handle, level, friendCode, relation: friendRelation(rows[0], me.id) } });
}

// GET /api/friends/by-code/:friendCode -> { user:{ id, name, avatar, handle|null, level, friendCode, relation } }
// For the friend-link screen (/f/HYD-XXXX). relation: 'none' | 'friends' | 'outgoing' | 'incoming'.
friends.get('/by-code/:friendCode', limit('friend-lookup', 30, 60), async (c) => {
  const me = c.get('user');
  const code = normalizeFriendCode(c.req.param('friendCode'));
  if (!code) throw new HttpError(400, 'That friend code does not look right (e.g. HYD-7K2Q).');
  const target = await getUserByFriendCode(c.env, code);
  if (!target || target.is_guest) throw new HttpError(404, 'No player found with that friend code.');
  if (target.id === me.id) throw new HttpError(400, 'That is your own friend code.');
  const block = await blockRelation(c.env, me.id, target.id);
  if (block.mine || block.theirs) throw new HttpError(404, 'No player found with that friend code.'); // a block looks like "no such player"
  return previewUser(c, me, target);
});

// GET /api/friends/by-handle/:handle -> same shape as by-code. The handle may carry a leading "@".
friends.get('/by-handle/:handle', limit('friend-lookup', 30, 60), async (c) => {
  const me = c.get('user');
  const handle = normalizeHandle(c.req.param('handle'));
  if (!handle) throw new HttpError(400, 'That username does not look right (e.g. @chai_uncle).');
  const target = await getUserByHandle(c.env, handle);
  if (!target || target.is_guest) throw new HttpError(404, 'No player found with that username.');
  if (target.id === me.id) throw new HttpError(400, 'That is your own username.');
  const block = await blockRelation(c.env, me.id, target.id);
  if (block.mine || block.theirs) throw new HttpError(404, 'No player found with that username.'); // a block looks like "no such player"
  return previewUser(c, me, target);
});

// POST /api/friends/request { friendCode } or { userId } or { handle } ("@" optional) - idempotent; a mutual request auto-accepts.
friends.post('/request', limit('friend-request', 20, 60), async (c) => {
  const me = c.get('user');
  const body = await readJson(c);
  let target;
  let notFound; // the exact "unknown player" answer of this path: a block must be indistinguishable from it
  if (body.userId !== undefined && body.userId !== null) {
    notFound = 'No player found.';
    if (!isUuid(body.userId)) throw new HttpError(400, 'Invalid user id.');
    target = await getUserById(c.env, body.userId);
    if (!target || target.is_guest) throw new HttpError(404, notFound);
    if (target.id === me.id) throw new HttpError(400, 'You cannot add yourself.');
  } else if (body.handle !== undefined && body.handle !== null && body.friendCode === undefined) {
    notFound = 'No player found with that username.';
    const handle = normalizeHandle(body.handle);
    if (!handle) throw new HttpError(400, 'That username does not look right (e.g. @chai_uncle).');
    target = await getUserByHandle(c.env, handle);
    if (!target || target.is_guest) throw new HttpError(404, notFound);
    if (target.id === me.id) throw new HttpError(400, 'You cannot add yourself.');
  } else {
    notFound = 'No player found with that friend code.';
    const code = normalizeFriendCode(body.friendCode);
    if (!code) throw new HttpError(400, 'That friend code does not look right (e.g. HYD-7K2Q).');
    target = await getUserByFriendCode(c.env, code);
    if (!target || target.is_guest) throw new HttpError(404, notFound);
    if (target.id === me.id) throw new HttpError(400, 'That is your own friend code.');
  }

  // Blocks and privacy. Someone who blocked me looks exactly like a player that does not exist; I am told about MY block.
  const block = await blockRelation(c.env, me.id, target.id);
  if (block.mine) throw new HttpError(403, 'You blocked this player. Unblock them first to send a request.');
  if (block.theirs) throw new HttpError(404, notFound);
  if (target.friend_requests === 'nobody') {
    // Not accepting NEW requests. An existing row (their request to me, mine to them, a friendship) still resolves below.
    const known = await query(
      c.env,
      `SELECT 1 AS ok FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
      [me.id, target.id],
    );
    if (!known.length) throw new HttpError(403, 'This player is not accepting requests.');
  }

  // 1) They already asked me -> accept (mutual request).
  const accepted = await query(
    c.env,
    `UPDATE friendships SET status = 'accepted'
      WHERE user_id = $1 AND friend_id = $2 AND status = 'pending' RETURNING 1 AS ok`,
    [target.id, me.id],
  );
  if (accepted.length) {
    notifyFriend(c, target.id, { t: 'friend_accepted', by: identity(me) }, friendAcceptedNotification({ byName: me.name, byId: me.id }));
    await checkAchievements(c.env, [me.id, target.id], { defer: (p) => background(c, p) }); // adda-regular, both sides
    return c.json({ ok: true, status: 'accepted', friend: rowToFriend(target) });
  }
  // 2) New pending request; the pair-unique index makes a repeat (or a race) a no-op.
  const inserted = await query(
    c.env,
    `INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, 'pending')
     ON CONFLICT DO NOTHING RETURNING 1 AS ok`,
    [me.id, target.id],
  );
  if (inserted.length) {
    notifyFriend(c, target.id, { t: 'friend_request', from: identity(me) }, friendRequestNotification({ fromName: me.name, fromId: me.id }));
    return c.json({ ok: true, status: 'pending', friend: rowToFriend(target) });
  }
  // 3) Already existed: report its current state.
  const existing = await query(
    c.env,
    `SELECT status FROM friendships
      WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [me.id, target.id],
  );
  return c.json({ ok: true, status: existing[0]?.status || 'pending', friend: rowToFriend(target) });
});

// POST /api/friends/accept { userId }
friends.post('/accept', async (c) => {
  const me = c.get('user');
  const { userId } = await readJson(c);
  if (!isUuid(userId)) throw new HttpError(400, 'Invalid user id.');
  const updated = await query(
    c.env,
    `UPDATE friendships SET status = 'accepted'
      WHERE user_id = $1 AND friend_id = $2 AND status = 'pending' RETURNING 1 AS ok`,
    [userId, me.id],
  );
  if (!updated.length) {
    const existing = await query(
      c.env,
      `SELECT 1 FROM friendships
        WHERE status = 'accepted'
          AND ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))`,
      [me.id, userId],
    );
    if (!existing.length) throw new HttpError(404, 'No pending request from that player.');
    return c.json({ ok: true, status: 'accepted' }); // already friends: idempotent
  }
  notifyFriend(c, userId, { t: 'friend_accepted', by: identity(me) }, friendAcceptedNotification({ byName: me.name, byId: me.id }));
  await checkAchievements(c.env, [me.id, userId], { defer: (p) => background(c, p) }); // adda-regular, both sides
  const other = await getUserById(c.env, userId);
  return c.json({ ok: true, status: 'accepted', friend: other ? rowToFriend(other) : undefined });
});

// POST /api/friends/decline { userId } - drops an incoming pending request (idempotent).
friends.post('/decline', async (c) => {
  const me = c.get('user');
  const { userId } = await readJson(c);
  if (!isUuid(userId)) throw new HttpError(400, 'Invalid user id.');
  await query(c.env, `DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2 AND status = 'pending'`, [userId, me.id]);
  return c.json({ ok: true });
});

// DELETE /api/friends/:userId - unfriend, or cancel my outgoing request (idempotent).
// When a row really went away the other player's hub gets { t:'friend_removed', by } (best effort).
friends.delete('/:userId', async (c) => {
  const me = c.get('user');
  const userId = c.req.param('userId');
  if (!isUuid(userId)) throw new HttpError(400, 'Invalid user id.');
  const removed = await query(
    c.env,
    `DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1) RETURNING 1 AS ok`,
    [me.id, userId],
  );
  if (removed.length) background(c, pushToUser(c.env, userId, { t: 'friend_removed', by: identity(me) }));
  return c.json({ ok: true });
});

export default friends;
