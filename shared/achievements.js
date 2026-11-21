// Achievements and badges (docs/ENGAGEMENT.md section 1). Pure: shared by the worker (which alone decides what is
// unlocked and pays the rewards) and the client (display copy, progress bars). Ids never change once shipped.
//
//   { id, name, description, icon /* HubIcon name */, category, goal, metric, reward: { coins?, itemId? } }
//
// metric (what is compared with `goal`, unlocked when metric >= goal):
//   wins, games    sums over user_game_stats (all games)
//   streak         users.daily_streak
//   friends        accepted friendships
//   level          from users.xp
//   referrals      referred friends who played their first match (users.referral_rewarded_at set)
//   setsCompleted  per match: distinct colour sets completed in one Nawabi Raj match (the player finished it)
//   finalWorth     per match: final net worth in one Nawabi Raj match (the player finished it)
import { cosmeticById } from './cosmetics.js';

export const ACHIEVEMENT_CATEGORIES = Object.freeze(['play', 'streak', 'collection', 'social']);
export const METRICS = Object.freeze(['wins', 'games', 'streak', 'friends', 'level', 'referrals', 'setsCompleted', 'finalWorth']);
/** Metrics that only exist for one match (checked when the match is persisted, never stored). */
export const MATCH_METRICS = Object.freeze(['setsCompleted', 'finalWorth']);

const a = (x) => Object.freeze({ ...x, reward: Object.freeze({ ...x.reward }) });

export const ACHIEVEMENTS = Object.freeze([
  a({ id: 'first-win', name: 'First Win', description: 'Win your first match.', icon: 'star', category: 'play', goal: 1, metric: 'wins', reward: { coins: 200 } }),
  a({ id: 'regular', name: 'Regular', description: 'Play 10 matches.', icon: 'gamepad', category: 'play', goal: 10, metric: 'games', reward: { coins: 300 } }),
  a({ id: 'champion', name: 'Champion', description: 'Win 10 matches.', icon: 'podium', category: 'play', goal: 10, metric: 'wins', reward: { coins: 300, itemId: 'title-champion' } }),
  a({ id: 'on-a-roll', name: 'On a Roll', description: 'Claim the daily reward 3 days in a row.', icon: 'refresh', category: 'streak', goal: 3, metric: 'streak', reward: { coins: 100 } }),
  a({ id: 'ten-day-streak', name: 'Ten Day Streak', description: 'Claim the daily reward 10 days in a row.', icon: 'clock', category: 'streak', goal: 10, metric: 'streak', reward: { coins: 500, itemId: 'frame-streak' } }),
  a({ id: 'full-set', name: 'Full Set', description: 'Complete a whole district colour set in one Nawabi Raj match.', icon: 'check', category: 'collection', goal: 1, metric: 'setsCompleted', reward: { coins: 250 } }),
  a({ id: 'set-collector', name: 'Set Collector', description: 'Complete 3 colour sets in one Nawabi Raj match.', icon: 'table', category: 'collection', goal: 3, metric: 'setsCompleted', reward: { itemId: 'title-collector' } }),
  a({ id: 'tycoon', name: 'Tycoon', description: 'Finish a Nawabi Raj match with a net worth of ₹40,00,000 or more.', icon: 'spark', category: 'collection', goal: 4_000_000, metric: 'finalWorth', reward: { coins: 400 } }),
  a({ id: 'adda-regular', name: 'Adda Regular', description: 'Have 5 friends.', icon: 'users', category: 'social', goal: 5, metric: 'friends', reward: { coins: 200 } }),
  a({ id: 'recruiter', name: 'Recruiter', description: 'Invite a friend who plays their first match.', icon: 'plus', category: 'social', goal: 1, metric: 'referrals', reward: { coins: 300, itemId: 'title-recruiter' } }),
  a({ id: 'level-10', name: 'Level 10', description: 'Reach level 10.', icon: 'bolt', category: 'play', goal: 10, metric: 'level', reward: { coins: 500 } }),
]);

export const achievementById = (id) => (typeof id === 'string' && ACHIEVEMENTS.find((x) => x.id === id)) || null;

/** The reward with the item's display name: `{ coins?, itemId?, itemName? }`. */
export function rewardOf(achievement) {
  const r = achievement.reward || {};
  const out = {};
  if (r.coins) out.coins = r.coins;
  if (r.itemId) {
    out.itemId = r.itemId;
    const item = cosmeticById(r.itemId);
    if (item) out.itemName = item.name;
  }
  return out;
}

/** Is the achievement satisfied by `metrics` (`{ [metric]: number }`; a missing metric is not satisfied)? */
export function isSatisfied(achievement, metrics) {
  const v = Number(metrics && metrics[achievement.metric]);
  return Number.isFinite(v) && v >= achievement.goal;
}

/** Achievements satisfied by `metrics` that are not in `unlocked` (an iterable of ids), catalogue order. */
export function newlySatisfied(metrics, unlocked = []) {
  const have = new Set(unlocked);
  return ACHIEVEMENTS.filter((x) => !have.has(x.id) && isSatisfied(x, metrics));
}

/**
 * Progress towards the goal for a progress bar: min(metric, goal). Per-match achievements are all or nothing
 * (goal once unlocked, else 0), because a single match decides them.
 */
export function progressOf(achievement, metrics, unlocked = false) {
  if (unlocked) return achievement.goal;
  if (MATCH_METRICS.includes(achievement.metric)) return 0;
  const v = Math.max(0, Math.floor(Number(metrics && metrics[achievement.metric]) || 0));
  return Math.min(v, achievement.goal);
}

/** The achievement whose reward is this item, or null. */
export const achievementForItem = (itemId) => ACHIEVEMENTS.find((x) => x.reward.itemId === itemId) || null;

/** Season prize items and the placing that wins them (display copy; the real tiers are set per season). */
const SEASON_HINTS = Object.freeze({
  'title-season-champ': 'Season prize: finish 1st in a season',
  'frame-season': "Season prize: finish in a season's top 10",
});

/**
 * How a non-shop item is obtained, for a locked shop card: "Unlock: Champion achievement", a season placing, or the
 * limited-event note. Null for shop items, and for a limited item while it is on sale (`live`).
 */
export function unlockHintFor(item, { live = false } = {}) {
  if (!item) return null;
  if (item.source === 'achievement') {
    const ach = achievementForItem(item.id);
    return ach ? `Unlock: ${ach.name} achievement` : 'Unlock: an achievement';
  }
  if (item.source === 'season') return SEASON_HINTS[item.id] || 'Season prize';
  if (item.source === 'event') return live ? null : 'Limited: on sale during special events';
  return null;
}
