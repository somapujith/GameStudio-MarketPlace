// Achievements (docs/ENGAGEMENT.md section 1): load a player's metrics, compare them with the catalogue in
// shared/achievements.js and unlock + reward everything newly satisfied. Unlocking is idempotent: the rows are
// inserted with ON CONFLICT DO NOTHING and only the rows actually inserted are paid, all in ONE statement (coins,
// achievement-only items and the 'achievement' notifications), so a replay or a race never pays twice.
import { query } from './db.js';
import { levelFromXp } from './xp.js';
import { pushToUser } from './hub.js';
import { rowToNotification, NOTIFICATION_COLUMNS, asObject, iso } from './admin.js';
import { ownedList } from './routes/shop.js';
import { ACHIEVEMENTS, MATCH_METRICS, achievementById, newlySatisfied, rewardOf } from '../shared/achievements.js';

const num = (v) => Number(v) || 0;
const parseList = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }
  return [];
};
export { parseList };

// ---------------------------------------------------------------- metrics

// One query for any number of users: lifetime wins / games (all games), the daily streak, xp, accepted friends,
// rewarded referrals, whether this user's own referral reward is still pending, and what is already unlocked.
export const METRICS_SQL = `
SELECT u.id, u.xp, u.daily_streak,
       coalesce(s.wins, 0)::int AS wins,
       coalesce(s.games, 0)::int AS games,
       (SELECT count(*) FROM friendships f
         WHERE f.status = 'accepted' AND (f.user_id = u.id OR f.friend_id = u.id))::int AS friends,
       (SELECT count(*) FROM users r WHERE r.referred_by = u.id AND r.referral_rewarded_at IS NOT NULL)::int AS referrals,
       (u.referred_by IS NOT NULL AND u.referral_rewarded_at IS NULL) AS referral_pending,
       coalesce((SELECT json_agg(json_build_object('id', a.achievement_id, 'at', a.unlocked_at))
                   FROM user_achievements a WHERE a.user_id = u.id), '[]'::json) AS unlocked
  FROM users u
  LEFT JOIN (SELECT user_id, sum(wins) AS wins, sum(games) AS games
               FROM user_game_stats WHERE user_id = ANY($1::uuid[]) GROUP BY user_id) s ON s.user_id = u.id
 WHERE u.id = ANY($1::uuid[])`;

/** A METRICS_SQL row -> `{ id, metrics, unlocked: Map(id -> ISO), referralPending }`. `facts` = this user's match facts. */
export function rowToMetrics(r, facts = null) {
  const metrics = {
    wins: num(r.wins),
    games: num(r.games),
    streak: num(r.daily_streak),
    friends: num(r.friends),
    level: levelFromXp(r.xp),
    referrals: num(r.referrals),
  };
  Object.assign(metrics, matchFacts(facts));
  const unlocked = new Map();
  for (const a of parseList(r.unlocked)) if (a && typeof a.id === 'string') unlocked.set(a.id, iso(a.at));
  return { id: r.id, metrics, unlocked, referralPending: r.referral_pending === true };
}

/** Metrics of these users (unknown ids are left out). */
export async function loadMetrics(env, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const rows = await query(env, METRICS_SQL, [ids]);
  return rows.map((r) => rowToMetrics(r));
}

// ---------------------------------------------------------------- unlock + reward

// $1 = [{ user_id, achievement_id, coins, item_id, title, body, data }]. Everything below `ins` reads the rows that
// were really inserted (`won`), so an achievement that was already unlocked pays nothing. Coins are summed per user
// (one UPDATE per row); items are granted ON CONFLICT DO NOTHING; one 'achievement' notification per unlock.
// owned_before = the item rows before this statement (CTE writes are invisible to the outer query).
export const UNLOCK_SQL = `
WITH want AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb)
      AS w(user_id uuid, achievement_id text, coins int, item_id text, title text, body text, data jsonb)
), ins AS (
  INSERT INTO user_achievements (user_id, achievement_id)
  SELECT w.user_id, w.achievement_id FROM want w
   WHERE EXISTS (SELECT 1 FROM users x WHERE x.id = w.user_id)
  ON CONFLICT (user_id, achievement_id) DO NOTHING
  RETURNING user_id, achievement_id, unlocked_at
), won AS (
  SELECT w.user_id, w.achievement_id, w.coins, w.item_id, w.title, w.body, w.data, i.unlocked_at
    FROM ins i JOIN want w ON w.user_id = i.user_id AND w.achievement_id = i.achievement_id
), coin AS (
  UPDATE users u SET coins = u.coins + t.total
    FROM (SELECT user_id, sum(coins)::int AS total FROM won WHERE coins > 0 GROUP BY user_id) t
   WHERE u.id = t.user_id
  RETURNING u.id, u.coins
), item AS (
  INSERT INTO user_items (user_id, item_id, price_paid)
  SELECT user_id, item_id, 0 FROM won WHERE item_id IS NOT NULL
  ON CONFLICT (user_id, item_id) DO NOTHING
  RETURNING user_id, item_id
), notif AS (
  INSERT INTO notifications (user_id, kind, title, body, data)
  SELECT user_id, 'achievement', title, body, data FROM won
  RETURNING ${NOTIFICATION_COLUMNS}, user_id
)
SELECT coalesce((SELECT json_agg(json_build_object('userId', user_id, 'achievementId', achievement_id, 'unlockedAt', unlocked_at)) FROM won), '[]'::json) AS unlocked,
       coalesce((SELECT json_agg(json_build_object('userId', id, 'coins', coins)) FROM coin), '[]'::json) AS wallets,
       coalesce((SELECT json_agg(json_build_object('userId', user_id, 'itemId', item_id)) FROM item), '[]'::json) AS items,
       coalesce((SELECT json_agg(row_to_json(notif)) FROM notif), '[]'::json) AS notifications,
       coalesce((SELECT json_agg(json_build_object('userId', ui.user_id, 'itemId', ui.item_id))
                   FROM user_items ui WHERE ui.user_id IN (SELECT user_id FROM item)), '[]'::json) AS owned_before`;

/** The notification of an unlock: kind 'achievement', data `{ achievementId, coins?, itemId?, itemName? }`. */
export function unlockNotification(achievement) {
  const reward = rewardOf(achievement);
  return {
    title: `Achievement unlocked: ${achievement.name}`,
    body: achievement.description,
    data: { achievementId: achievement.id, ...reward },
  };
}

/** One UNLOCK_SQL row of `$1`. */
const wantRow = (userId, achievement) => {
  const n = unlockNotification(achievement);
  return {
    user_id: userId,
    achievement_id: achievement.id,
    coins: achievement.reward.coins || null,
    item_id: achievement.reward.itemId || null,
    title: n.title,
    body: n.body,
    data: n.data,
  };
};

/**
 * Push live messages, `[{ userId, messages: [...] }]`, one user's messages in order. Best effort (pushToUser never
 * throws). Resolves when all were sent.
 */
export function deliverPushes(env, pushes) {
  return Promise.all(
    (pushes || []).map(async ({ userId, messages }) => {
      for (const m of messages) await pushToUser(env, userId, m);
    }),
  );
}

/**
 * Run a push job: hand it to `defer` (e.g. `(p) => background(c, p)` or a Durable Object's `ctx.waitUntil`) or, without
 * one, await it. Never throws.
 */
export async function schedule(job, defer) {
  const safe = Promise.resolve(job).catch((err) => console.error('push failed:', err && err.message));
  if (typeof defer === 'function') {
    try {
      defer(safe);
      return;
    } catch {
      /* fall through: await it */
    }
  }
  await safe;
}

/** Per-user `notification` / `wallet` / `items` messages for the result row of a reward statement. */
export function pushesFromResult(row, { grantedItems = [] } = {}) {
  const byUser = new Map();
  const add = (userId, m) => {
    if (!userId) return;
    if (!byUser.has(userId)) byUser.set(userId, []);
    byUser.get(userId).push(m);
  };
  for (const n of parseList(row && row.notifications)) {
    const o = asObject(n);
    add(o.user_id, { t: 'notification', notification: rowToNotification(o) });
  }
  for (const w of parseList(row && row.wallets)) add(w.userId, { t: 'wallet', coins: num(w.coins) });
  const items = [...parseList(row && row.items), ...grantedItems];
  if (items.length) {
    const before = new Map();
    for (const o of parseList(row && row.owned_before)) {
      if (!before.has(o.userId)) before.set(o.userId, []);
      before.get(o.userId).push(o.itemId);
    }
    const fresh = new Map();
    for (const i of items) {
      if (!fresh.has(i.userId)) fresh.set(i.userId, []);
      fresh.get(i.userId).push(i.itemId);
    }
    for (const [userId, ids] of fresh) add(userId, { t: 'items', owned: ownedList([...(before.get(userId) || []), ...ids]) });
  }
  return [...byUser].map(([userId, messages]) => ({ userId, messages }));
}

/**
 * Unlock `grants` (`[{ userId, achievement }]`, duplicates dropped) and pay their rewards, in one statement. Resolves to
 * the unlocks that really happened: `[{ userId, achievementId, unlockedAt }]` (already unlocked ones are left out).
 * Pushes `notification` + `wallet` / `items` to each player through `defer` (or awaited).
 */
export async function unlockAchievements(env, grants, { defer } = {}) {
  const seen = new Set();
  const want = [];
  for (const g of grants || []) {
    if (!g || !g.userId || !g.achievement) continue;
    const key = `${g.userId}:${g.achievement.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    want.push(wantRow(g.userId, g.achievement));
  }
  if (!want.length) return [];
  const [row] = await query(env, UNLOCK_SQL, [JSON.stringify(want)]);
  const unlocked = parseList(row && row.unlocked).map((u) => ({ userId: u.userId, achievementId: u.achievementId, unlockedAt: iso(u.unlockedAt) }));
  if (unlocked.length) await schedule(deliverPushes(env, pushesFromResult(row)), defer);
  return unlocked;
}

/**
 * Check every achievement for these users and unlock what is newly satisfied. `facts` = `{ [userId]: { setsCompleted,
 * finalWorth } }` for the match just persisted (only players who finished it). `rows` = already loaded metrics (skips
 * the metrics query). Resolves to the unlocks.
 */
export async function evaluateAchievements(env, userIds, { facts = {}, defer, rows = null } = {}) {
  const loaded = rows || (await loadMetrics(env, userIds));
  const grants = [];
  for (const m of loaded) {
    const merged = { ...m.metrics, ...matchFacts(facts && facts[m.id]) };
    for (const a of newlySatisfied(merged, m.unlocked.keys())) grants.push({ userId: m.id, achievement: a });
  }
  return unlockAchievements(env, grants, { defer });
}

/** The per-match metrics of a facts object (only finite numbers). */
function matchFacts(f) {
  const out = {};
  if (!f) return out;
  for (const k of MATCH_METRICS) if (Number.isFinite(Number(f[k]))) out[k] = Number(f[k]);
  return out;
}

/** Best effort wrapper: evaluate and log a failure instead of throwing. */
export async function checkAchievements(env, userIds, opts = {}) {
  try {
    return await evaluateAchievements(env, userIds, opts);
  } catch (err) {
    console.error('achievement check failed:', err && err.code ? `${err.code} ${err.message}` : err && err.message);
    return [];
  }
}

/** Unlock one achievement for one user (admin grant). Resolves to true when it was unlocked now. */
export async function grantAchievement(env, userId, achievementId, { defer } = {}) {
  const achievement = achievementById(achievementId);
  if (!achievement) return false;
  const done = await unlockAchievements(env, [{ userId, achievement }], { defer });
  return done.length > 0;
}

export { ACHIEVEMENTS };
