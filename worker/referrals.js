// Referral rewards (docs/ENGAGEMENT.md section 2). A player's referral code is their friend code. `users.referred_by`
// is set only when a Google account is CREATED with a valid ref; the first match of that account pays both sides once
// (guarded by users.referral_rewarded_at), with the referrer capped per rolling 30 days.
import { query } from './db.js';
import { normalizeFriendCode } from './codes.js';
import { parseList, pushesFromResult, deliverPushes, schedule } from './achievements.js';
import { NOTIFICATION_COLUMNS } from './admin.js';

export const REFERRAL_COINS = 250;
/** A referrer is paid for at most this many referrals per rolling window. */
export const REFERRAL_CAP = 20;
export const REFERRAL_WINDOW_DAYS = 30;

// The new account must be a Google account without a referrer; the referrer must be another non-guest, non-banned user.
export const SET_REFERRER_SQL = `
UPDATE users u SET referred_by = r.id
  FROM users r
 WHERE u.id = $1::uuid AND u.is_guest = false AND u.referred_by IS NULL
   AND r.friend_code = $2::text AND r.id <> u.id AND r.is_guest = false AND r.banned_at IS NULL
RETURNING r.id AS referrer_id`;

/**
 * Record who invited a just-created account. `ref` is the raw value from the client (a friend code, any case, with or
 * without the HYD- prefix). Unknown, malformed, self, guest and banned refs are ignored. Resolves to the referrer id
 * or null. Call it ONLY for an account created by this sign-in.
 */
export async function applyReferral(env, userId, ref) {
  if (typeof ref !== 'string' || ref.length > 40) return null;
  const code = normalizeFriendCode(ref);
  if (!code) return null;
  const rows = await query(env, SET_REFERRER_SQL, [userId, code]);
  return rows[0] ? rows[0].referrer_id : null;
}

// One statement. `claim` is the guard: it matches only once per referred user (referral_rewarded_at IS NULL), pays
// the new player in the same UPDATE (a row must not be updated by two parts of one statement), and everything else
// reads from it. The referrer is paid only when not banned and under the cap: fewer than $3 of their
// invitees were rewarded in the last $4 days (`claim`'s own write is invisible here, so this one is not counted).
// Both sides get a 'gift' notification `{ coins, referral: { name, role } }` (name = the other person).
export const REFERRAL_REWARD_SQL = `
WITH claim AS (
  UPDATE users SET referral_rewarded_at = now(), coins = coins + $2::int
   WHERE id = $1::uuid AND referral_rewarded_at IS NULL AND referred_by IS NOT NULL
  RETURNING id, name, referred_by, coins
), referrer AS (
  SELECT r.id, r.name,
         (r.banned_at IS NULL AND
          (SELECT count(*) FROM users x
            WHERE x.referred_by = r.id AND x.referral_rewarded_at > now() - make_interval(days => $4::int)) < $3::int) AS paid
    FROM users r JOIN claim ON r.id = claim.referred_by
), pay AS (
  UPDATE users u SET coins = u.coins + $2::int
    FROM referrer
   WHERE u.id = referrer.id AND referrer.paid
  RETURNING u.id, u.coins
), notif AS (
  INSERT INTO notifications (user_id, kind, title, body, data)
  SELECT claim.id, 'gift', $5::text, $6::text || coalesce(referrer.name, 'a friend') || $7::text,
         jsonb_build_object('coins', $2::int, 'referral', jsonb_build_object('name', coalesce(referrer.name, 'a friend'), 'role', 'invitee'))
    FROM claim LEFT JOIN referrer ON true
  UNION ALL
  SELECT referrer.id, 'gift', $5::text, claim.name || $8::text,
         jsonb_build_object('coins', $2::int, 'referral', jsonb_build_object('name', claim.name, 'role', 'referrer'))
    FROM referrer JOIN claim ON true
   WHERE referrer.paid
  RETURNING ${NOTIFICATION_COLUMNS}, user_id
)
SELECT (SELECT id FROM claim) AS user_id,
       (SELECT id FROM referrer) AS referrer_id,
       coalesce((SELECT paid FROM referrer), false) AS referrer_paid,
       coalesce((SELECT json_agg(json_build_object('userId', w.id, 'coins', w.coins))
                   FROM (SELECT id, coins FROM claim UNION ALL SELECT id, coins FROM pay) w), '[]'::json) AS wallets,
       coalesce((SELECT json_agg(row_to_json(notif)) FROM notif), '[]'::json) AS notifications`;

export const referralRewardParams = (userId) => [
  userId,
  REFERRAL_COINS,
  REFERRAL_CAP,
  REFERRAL_WINDOW_DAYS,
  `You received ${REFERRAL_COINS} coins`,
  'A welcome gift: you joined with ',
  "'s invite.",
  ' joined with your invite and played their first match.',
];

/**
 * Pay the first-match referral reward of `userId` (no-op unless they were referred and not yet rewarded). Resolves to
 * `{ referrerId, referrerPaid }` when it paid now, else null. Pushes `notification` + `wallet` through `defer`.
 */
export async function rewardReferral(env, userId, { defer } = {}) {
  const [row] = await query(env, REFERRAL_REWARD_SQL, referralRewardParams(userId));
  if (!row || !row.user_id) return null;
  await schedule(deliverPushes(env, pushesFromResult(row)), defer);
  return { referrerId: row.referrer_id || null, referrerPaid: row.referrer_paid === true };
}

// ---------------------------------------------------------------- reads

// GET /api/me/referrals. coinsEarned = the referrer-side referral gifts (exact: they are written by the reward statement).
export const MY_REFERRALS_SQL = `
SELECT (SELECT count(*) FROM users WHERE referred_by = $1::uuid)::int AS invited,
       (SELECT count(*) FROM users WHERE referred_by = $1::uuid AND referral_rewarded_at IS NOT NULL)::int AS rewarded,
       (SELECT coalesce(sum((data->>'coins')::int), 0) FROM notifications
         WHERE user_id = $1::uuid AND kind = 'gift' AND data->'referral'->>'role' = 'referrer')::int AS coins_earned,
       (SELECT coalesce(json_agg(json_build_object('name', x.name, 'avatar', x.avatar, 'joinedAt', x.created_at,
                                                   'rewarded', x.referral_rewarded_at IS NOT NULL) ORDER BY x.created_at DESC), '[]'::json)
          FROM (SELECT name, avatar, created_at, referral_rewarded_at FROM users
                 WHERE referred_by = $1::uuid ORDER BY created_at DESC LIMIT 10) x) AS recent`;

export const referralLink = (code) => `/?ref=${encodeURIComponent(code)}`;

/** The GET /api/me/referrals body for a user row. */
export async function myReferrals(env, user) {
  const [row = {}] = await query(env, MY_REFERRALS_SQL, [user.id]);
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  return {
    code: user.friend_code,
    link: referralLink(user.friend_code),
    invited: Number(row.invited) || 0,
    rewarded: Number(row.rewarded) || 0,
    coinsEarned: Number(row.coins_earned) || 0,
    recent: parseList(row.recent).map((r) => ({
      name: r.name,
      avatar: Number(r.avatar) || 0,
      joinedAt: iso(r.joinedAt),
      rewarded: r.rewarded === true,
    })),
  };
}
