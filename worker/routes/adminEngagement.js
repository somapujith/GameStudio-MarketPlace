// Admin endpoints for achievements and referrals (docs/ENGAGEMENT.md "Admin API"), mounted by routes/admin.js at
// /api/admin (after requireStaff): GET /achievements, POST /users/:id/achievements (admin), GET /referrals.
import { Hono } from 'hono';
import { query, HttpError } from '../db.js';
import { readJson } from '../http.js';
import { isUuid } from '../validate.js';
import { getUserById } from '../users.js';
import { background } from '../hub.js';
import { requireAdmin, parseReason, writeAudit, iso } from '../admin.js';
import { grantAchievement } from '../achievements.js';
import { ACHIEVEMENTS, achievementById, rewardOf } from '../../shared/achievements.js';

const num = (v) => Number(v) || 0;

export const adminEngagement = new Hono();

// Unlock counts by members (guests may unlock too, but rates are over members).
export const ACHIEVEMENT_COUNTS_SQL = `
SELECT a.achievement_id, count(*)::int AS unlocked
  FROM user_achievements a
  JOIN users u ON u.id = a.user_id
 WHERE u.is_guest = false
 GROUP BY a.achievement_id`;
export const MEMBERS_SQL = 'SELECT count(*)::int AS members FROM users WHERE is_guest = false';

// GET /achievements -> { achievements: [{ id, name, unlocked }], members }   staff
adminEngagement.get('/achievements', async (c) => {
  const [rows, [m]] = await Promise.all([query(c.env, ACHIEVEMENT_COUNTS_SQL), query(c.env, MEMBERS_SQL)]);
  const counts = new Map(rows.map((r) => [r.achievement_id, num(r.unlocked)]));
  return c.json({
    achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, unlocked: counts.get(a.id) || 0 })),
    members: num(m && m.members),
  });
});

// POST /users/:id/achievements { achievementId, reason } -> { unlocked: true }   admin; 409 already unlocked
// Unlocks and pays the reward exactly like a real unlock (notification + wallet / items pushes).
adminEngagement.post('/users/:id/achievements', requireAdmin, async (c) => {
  const body = await readJson(c);
  if (typeof body.achievementId !== 'string' || !body.achievementId || body.achievementId.length > 100) {
    throw new HttpError(400, 'Invalid achievement id.');
  }
  const achievement = achievementById(body.achievementId);
  if (!achievement) throw new HttpError(404, 'Unknown achievement.');
  const reason = parseReason(body.reason);
  const id = c.req.param('id');
  if (!isUuid(id)) throw new HttpError(400, 'Invalid user id.');
  const target = await getUserById(c.env, id);
  if (!target) throw new HttpError(404, 'User not found.');
  const done = await grantAchievement(c.env, target.id, achievement.id, { defer: (p) => background(c, p) });
  if (!done) throw new HttpError(409, 'Already unlocked.');
  await writeAudit(c.env, {
    admin: c.get('user'),
    action: 'achievement.grant',
    target,
    details: { reason, achievementId: achievement.id, achievementName: achievement.name, ...rewardOf(achievement) },
  });
  return c.json({ unlocked: true });
});

// Top referrers by rewarded (then invited), the latest referrals, and totals. coinsPaid = every referral gift (both sides).
export const REFERRALS_TOP_SQL = `
SELECT r.id, r.name, r.avatar, count(*)::int AS invited, count(u.referral_rewarded_at)::int AS rewarded
  FROM users u
  JOIN users r ON r.id = u.referred_by
 GROUP BY r.id, r.name, r.avatar
 ORDER BY rewarded DESC, invited DESC, r.id
 LIMIT 20`;
export const REFERRALS_RECENT_SQL = `
SELECT u.id, u.name, u.created_at, u.referral_rewarded_at, r.id AS referrer_id, r.name AS referrer_name
  FROM users u
  JOIN users r ON r.id = u.referred_by
 ORDER BY u.created_at DESC, u.id
 LIMIT 50`;
export const REFERRALS_TOTALS_SQL = `
SELECT (SELECT count(*) FROM users WHERE referred_by IS NOT NULL)::int AS invited,
       (SELECT count(*) FROM users WHERE referred_by IS NOT NULL AND referral_rewarded_at IS NOT NULL)::int AS rewarded,
       (SELECT coalesce(sum((data->>'coins')::int), 0) FROM notifications
         WHERE kind = 'gift' AND data ? 'referral')::bigint AS coins_paid`;

// GET /referrals -> { top, recent, totals }   staff
adminEngagement.get('/referrals', async (c) => {
  const [top, recent, [t = {}]] = await Promise.all([
    query(c.env, REFERRALS_TOP_SQL),
    query(c.env, REFERRALS_RECENT_SQL),
    query(c.env, REFERRALS_TOTALS_SQL),
  ]);
  return c.json({
    top: top.map((r) => ({ id: r.id, name: r.name, avatar: num(r.avatar), invited: num(r.invited), rewarded: num(r.rewarded) })),
    recent: recent.map((r) => ({
      referrer: { id: r.referrer_id, name: r.referrer_name },
      invitee: { id: r.id, name: r.name },
      joinedAt: iso(r.created_at),
      rewarded: !!r.referral_rewarded_at,
    })),
    totals: { invited: num(t.invited), rewarded: num(t.rewarded), coinsPaid: num(t.coins_paid) },
  });
});

// ---------------------------------------------------------------- user detail extras (GET /users/:id)

export const DETAIL_ACHIEVEMENTS_SQL = 'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = $1::uuid ORDER BY unlocked_at DESC';
export const DETAIL_REFERRAL_SQL = `
SELECT (SELECT json_build_object('id', r.id, 'name', r.name) FROM users me JOIN users r ON r.id = me.referred_by WHERE me.id = $1::uuid) AS referrer,
       (SELECT count(*) FROM users WHERE referred_by = $1::uuid)::int AS invited_count,
       (SELECT coalesce(json_agg(json_build_object('id', x.id, 'name', x.name, 'joinedAt', x.created_at, 'rewarded', x.referral_rewarded_at IS NOT NULL)
                                 ORDER BY x.created_at DESC), '[]'::json)
          FROM (SELECT id, name, created_at, referral_rewarded_at FROM users WHERE referred_by = $1::uuid ORDER BY created_at DESC LIMIT 50) x) AS invited`;

/**
 * The engagement part of AdminUserDetail: `achievements: [{ id, name, unlockedAt }]` and
 * `referral: { referrer: { id, name }|null, invitedCount, invited: [{ id, name, joinedAt, rewarded }] (latest 50) }`.
 * Best effort (an empty block on failure, e.g. before the migration ran).
 */
export async function userEngagement(env, userId) {
  try {
    const [ach, [ref = {}]] = await Promise.all([query(env, DETAIL_ACHIEVEMENTS_SQL, [userId]), query(env, DETAIL_REFERRAL_SQL, [userId])]);
    const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? JSON.parse(v) : []);
    const referrer = typeof ref.referrer === 'string' ? JSON.parse(ref.referrer) : ref.referrer;
    return {
      achievements: ach.map((r) => ({ id: r.achievement_id, name: achievementById(r.achievement_id)?.name || r.achievement_id, unlockedAt: iso(r.unlocked_at) })),
      referral: {
        referrer: referrer && referrer.id ? { id: referrer.id, name: referrer.name } : null,
        invitedCount: num(ref.invited_count),
        invited: list(ref.invited).map((x) => ({ id: x.id, name: x.name, joinedAt: iso(x.joinedAt), rewarded: x.rewarded === true })),
      },
    };
  } catch {
    return { achievements: [], referral: { referrer: null, invitedCount: 0, invited: [] } };
  }
}
