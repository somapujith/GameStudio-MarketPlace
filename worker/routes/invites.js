// Game invites between friends (docs/HUSTLE_PLAN.md section 4).
//   POST /api/invites { code, userId }  -> { ok: true, delivered }   live push to the friend's /ws/user, a stored
//                                          row (so an offline friend still sees it) and a Web Push when configured
//   GET  /api/invites                   -> { invites: [{ id, from:{id,name,avatar}, code, gameId, gameName, createdAt }] }
//                                          addressed to me, not dismissed, < 2 h old, room still a lobby, newest first
//   POST /api/invites/:id/dismiss       -> { ok: true }   (only the recipient; pushes {t:'invite_declined',by,code} to the sender
//                                          unless the body says {joined:true}: Join consumes the invite, it is not a decline)
import { Hono } from 'hono';
import { query, HttpError } from '../db.js';
import { requireMember, requireUser } from '../auth.js';
import { identity } from '../users.js';
import { normalizeRoomCode } from '../codes.js';
import { isUuid } from '../validate.js';
import { limit } from '../ratelimit.js';
import { readJson } from '../http.js';
import { pushToUser, roomCall, background } from '../hub.js';
import { getAdapter, DEFAULT_GAME_ID } from '../games/index.js';
import { sendPushToUser, pushConfigured, inviteNotification } from '../push.js';

const invites = new Hono();

export const INVITE_FRESH_HOURS = 2;
export const INVITES_MAX = 20;

/** The message pushed to the invited friend: who, which room, and which game it is for. */
export function inviteMessage(from, code, gameId) {
  const id = gameId || DEFAULT_GAME_ID;
  const adapter = getAdapter(id);
  return { t: 'invite', from, code, gameId: id, gameName: adapter ? adapter.name : id };
}

// One live invite per (from, to, room): inviting again refreshes it (and brings it back if dismissed).
export const STORE_INVITE_SQL = `
WITH upd AS (
  UPDATE invites SET created_at = now(), dismissed = false, game_id = $4::text
   WHERE from_id = $1::uuid AND to_id = $2::uuid AND room_code = $3::text
  RETURNING id
), ins AS (
  INSERT INTO invites (from_id, to_id, room_code, game_id)
  SELECT $1::uuid, $2::uuid, $3::text, $4::text
   WHERE NOT EXISTS (SELECT 1 FROM upd)
  RETURNING id
)
SELECT id FROM upd UNION ALL SELECT id FROM ins`;

// Only rooms that are still an open lobby in the listing, that I am not already sitting in.
export const LIST_INVITES_SQL = `
SELECT i.id, i.room_code, i.game_id, i.created_at, u.id AS from_id, u.name AS from_name, u.avatar AS from_avatar
  FROM invites i
  JOIN users u ON u.id = i.from_id
  JOIN rooms r ON r.code = i.room_code
 WHERE i.to_id = $1::uuid
   AND NOT i.dismissed
   AND i.created_at > now() - interval '${INVITE_FRESH_HOURS} hours'
   AND r.status = 'lobby'
   AND r.player_count < r.max_players
   AND NOT (r.member_ids @> ARRAY[$1::uuid])
 ORDER BY i.created_at DESC
 LIMIT ${INVITES_MAX}`;

// `was_dismissed` is the state BEFORE this update (CTE snapshot), so a repeated dismiss does not notify the sender again.
export const DISMISS_INVITE_SQL = `
WITH prev AS (SELECT dismissed FROM invites WHERE id = $1::uuid AND to_id = $2::uuid)
UPDATE invites SET dismissed = true
 WHERE id = $1::uuid AND to_id = $2::uuid
RETURNING id, from_id, room_code, (SELECT dismissed FROM prev) AS was_dismissed`;

// Housekeeping: my invites that can never be shown again.
export const DROP_STALE_INVITES_SQL = `DELETE FROM invites
 WHERE to_id = $1::uuid AND created_at < now() - interval '${INVITE_FRESH_HOURS} hours'`;

const missingTable = (err) => err && err.code === '42P01'; // the migration has not run yet

/** A database row -> the API shape. */
export function rowToInvite(r) {
  const msg = inviteMessage(null, r.room_code, r.game_id);
  return {
    id: r.id,
    from: { id: r.from_id, name: r.from_name, avatar: r.from_avatar },
    code: r.room_code,
    gameId: msg.gameId,
    gameName: msg.gameName,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

// POST /api/invites { code, userId } -> pushes an `invite` to that friend's UserHub and stores it.
invites.post('/', requireMember, limit('invite', 30, 60), async (c) => {
  const me = c.get('user');
  const body = await readJson(c);
  const code = normalizeRoomCode(body.code);
  if (!code) throw new HttpError(400, 'Invalid room code.');
  if (!isUuid(body.userId)) throw new HttpError(400, 'Invalid user id.');

  // Only accepted friends can be invited.
  const friend = await query(
    c.env,
    `SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))`,
    [me.id, body.userId],
  );
  if (!friend.length) throw new HttpError(403, 'You can only invite your friends.');

  // The room must be an open lobby that the inviter is part of.
  const { status, data } = await roomCall(c.env, code, `/info?member=${me.id}`);
  if (status !== 200 || !data?.exists) throw new HttpError(404, 'That room does not exist.');
  if (!data.isMember) throw new HttpError(403, 'Join the room before inviting friends.');
  if (data.status !== 'lobby') throw new HttpError(409, 'That game has already started.');

  const message = inviteMessage(identity(me), code, data.gameId);
  // Stored so the friend still sees it after a reload or while offline (best effort: the live push matters most).
  try {
    await query(c.env, STORE_INVITE_SQL, [me.id, body.userId, code, message.gameId]);
  } catch (err) {
    if (!missingTable(err)) console.error('invite store failed:', err && err.code ? `${err.code} ${err.message}` : err && err.message);
  }
  const delivered = await pushToUser(c.env, body.userId, message);
  if (pushConfigured(c.env)) {
    background(c, sendPushToUser(c.env, body.userId, inviteNotification({ fromName: me.name, gameName: message.gameName, code })));
  }
  return c.json({ ok: true, delivered: delivered > 0 });
});

// GET /api/invites -> fresh invites addressed to me (guests have no friends, so theirs is always empty).
invites.get('/', requireUser, limit('invites-list', 30, 60), async (c) => {
  const me = c.get('user');
  let rows;
  try {
    rows = await query(c.env, LIST_INVITES_SQL, [me.id]);
  } catch (err) {
    if (missingTable(err)) return c.json({ invites: [] });
    throw err;
  }
  if (Math.random() < 0.1) background(c, query(c.env, DROP_STALE_INVITES_SQL, [me.id]));
  return c.json({ invites: rows.map(rowToInvite) });
});

// POST /api/invites/:id/dismiss -> hides one invite (404 unless it was addressed to me).
invites.post('/:id/dismiss', requireUser, limit('invite-dismiss', 60, 60), async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) throw new HttpError(400, 'Invalid invite id.');
  const body = await c.req.json().catch(() => ({}));
  const joined = !!body && body.joined === true; // "Join" consumes the invite: that is not a decline
  let rows;
  try {
    rows = await query(c.env, DISMISS_INVITE_SQL, [id, c.get('user').id]);
  } catch (err) {
    if (missingTable(err)) throw new HttpError(404, 'Invite not found.');
    throw err;
  }
  if (!rows.length) throw new HttpError(404, 'Invite not found.');
  // Tell the sender it was declined (best effort, once per invite).
  const row = rows[0];
  if (row.from_id && row.room_code && !row.was_dismissed && !joined) {
    background(c, pushToUser(c.env, row.from_id, { t: 'invite_declined', by: identity(c.get('user')), code: row.room_code }));
  }
  return c.json({ ok: true });
});

export default invites;
