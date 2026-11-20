// Block list (members only). Blocking hides a player from search / recent / requests / invites, and the client mutes
// them in rooms. Nothing here ever tells the blocked person: they just stop finding you.
//   GET    /api/blocks            -> { blocked: [{ id, name, avatar }] }   newest first
//   POST   /api/blocks { userId } -> { ok, blocked: { id, name, avatar } } idempotent; also ends any friendship / pending
//                                    request / room invite between us (friend_removed is pushed when a friendship existed)
//   DELETE /api/blocks/:userId    -> { ok: true }                          idempotent
import { Hono } from 'hono';
import { query, HttpError } from '../db.js';
import { requireMember } from '../auth.js';
import { getUserById, identity } from '../users.js';
import { isUuid } from '../validate.js';
import { limit } from '../ratelimit.js';
import { readJson } from '../http.js';
import { pushToUser, background } from '../hub.js';

const blocks = new Hono();
blocks.use('*', requireMember); // guests have no friends to block

/**
 * Is there a block between `meId` and `otherId`, and in which direction?
 * -> { mine: I blocked them, theirs: they blocked me }  (one query; both false when the table is empty / missing).
 */
export async function blockRelation(env, meId, otherId) {
  const rows = await query(
    env,
    `SELECT user_id FROM blocks
      WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1)`,
    [meId, otherId],
  );
  const list = Array.isArray(rows) ? rows : [];
  return { mine: list.some((r) => r.user_id === meId), theirs: list.some((r) => r.user_id === otherId) };
}

/** SQL fragment: `u.id` (an alias for the other player) has no block with $1 in either direction. */
export const NOT_BLOCKED_SQL = (alias = 'u') => `NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.user_id = $1 AND b.blocked_id = ${alias}.id) OR (b.user_id = ${alias}.id AND b.blocked_id = $1))`;

// GET /api/blocks
blocks.get('/', limit('blocks-list', 60, 60), async (c) => {
  const me = c.get('user');
  const rows = await query(
    c.env,
    `SELECT u.id, u.name, u.avatar
       FROM blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC, u.id`,
    [me.id],
  );
  return c.json({ blocked: rows.map(identity) });
});

// POST /api/blocks { userId }
blocks.post('/', limit('blocks-write', 30, 60), async (c) => {
  const me = c.get('user');
  const body = await readJson(c);
  if (!isUuid(body.userId)) throw new HttpError(400, 'Invalid user id.');
  if (body.userId === me.id) throw new HttpError(400, 'You cannot block yourself.');
  const target = await getUserById(c.env, body.userId);
  if (!target) throw new HttpError(404, 'No player found.');

  await query(c.env, `INSERT INTO blocks (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.id, target.id]);

  // End the relationship both ways: friendship, pending requests (either direction) and room invites.
  const removed = await query(
    c.env,
    `DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
     RETURNING user_id, status`,
    [me.id, target.id],
  );
  await query(c.env, `DELETE FROM invites WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)`, [me.id, target.id]).catch(
    () => undefined, // best effort (older database without the invites table)
  );
  // Their side only hears about it when something they could see disappears: a friendship, or a request I had sent them.
  // A request THEY had sent me just vanishes for me; they keep seeing "Requested" and never learn why.
  if ((Array.isArray(removed) ? removed : []).some((r) => r.status === 'accepted' || r.user_id === me.id)) {
    background(c, pushToUser(c.env, target.id, { t: 'friend_removed', by: identity(me) }));
  }
  return c.json({ ok: true, blocked: identity(target) });
});

// DELETE /api/blocks/:userId
blocks.delete('/:userId', limit('blocks-write', 30, 60), async (c) => {
  const me = c.get('user');
  const userId = c.req.param('userId');
  if (!isUuid(userId)) throw new HttpError(400, 'Invalid user id.');
  await query(c.env, `DELETE FROM blocks WHERE user_id = $1 AND blocked_id = $2`, [me.id, userId]);
  return c.json({ ok: true });
});

export default blocks;
