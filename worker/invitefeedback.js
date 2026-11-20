// Feedback for the inviter: when an invited friend takes a seat in the room they were invited to, the inviter's hub gets
// `{t:'invite_joined', by:{id,name,avatar}, code}`. Called by GameRoom when a NEW member sits down. One-shot per invite:
// the row is marked dismissed (it was fulfilled), so rejoining does not tell the inviter again.
import { query } from './db.js';
import { pushToUser } from './hub.js';
import { hasDb } from './roomsdb.js';

export const INVITE_FRESH_HOURS = 2; // keep in step with routes/invites.js

// Fresh, still-open invites to this room addressed to the joiner -> who sent them.
export const FULFIL_INVITES_SQL = `
UPDATE invites SET dismissed = true
 WHERE to_id = $1::uuid AND room_code = $2::text AND NOT dismissed
   AND created_at > now() - interval '${INVITE_FRESH_HOURS} hours'
RETURNING from_id`;

export const inviteJoinedMessage = (by, code) => ({
  t: 'invite_joined',
  by: { id: by.id, name: by.name, avatar: by.avatar },
  code,
});

/**
 * Fire-and-forget: tell everyone who invited `joiner` to room `code` that they arrived. Never throws; resolves to the
 * number of inviters told (the promise is also handed to `ctx.waitUntil` so the work survives the request).
 */
export function notifyInviteJoined(env, code, joiner, ctx) {
  const job = (async () => {
    if (!hasDb(env)) return 0;
    let rows;
    try {
      rows = await query(env, FULFIL_INVITES_SQL, [joiner.id, code]);
    } catch (err) {
      if (!err || err.code !== '42P01') console.error('invite feedback failed:', err && err.message); // 42P01: migration not run yet
      return 0;
    }
    const ids = [...new Set(rows.map((r) => r.from_id).filter((id) => id && id !== joiner.id))];
    await Promise.all(ids.map((id) => pushToUser(env, id, inviteJoinedMessage(joiner, code))));
    return ids.length;
  })().catch(() => 0);
  try {
    if (ctx && ctx.waitUntil) ctx.waitUntil(job);
  } catch {
    /* no execution context (tests) */
  }
  return job;
}
