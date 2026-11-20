// XP / level / reward maths shared by the match-persistence code and the API mapper.

/** XP needed to advance from `level` to `level + 1`. */
export const xpToNext = (level) => 100 + (level - 1) * 50;

/** Level for a lifetime XP total (level 1 at 0 XP). */
export function levelFromXp(xp) {
  let level = 1;
  let left = Math.max(0, Math.floor(Number(xp) || 0));
  while (left >= xpToNext(level)) {
    left -= xpToNext(level);
    level += 1;
    if (level >= 999) break;
  }
  return level;
}

/**
 * Rewards for one finished match, for one player.
 * rank: 1 = winner. playerCount: total seats.
 */
export function matchRewards({ won, rank, playerCount }) {
  const behind = Math.max(0, playerCount - rank);
  const xp = 30 + behind * 10 + (won ? 60 : 0);
  const coins = 40 + behind * 20 + (won ? 140 : 0);
  return { xp, coins };
}

// ---- daily reward (server-side; mirrors src/lib/storage.js `dailyReward`) -------------------------

export const DAILY_BASE = 100;
export const DAILY_STEP = 50;
export const DAILY_CAP = 6; // streak day 6+ pays the maximum (400)

/** Coins for a given streak day: 150, 200, ... capped at 400. */
export const dailyReward = (streak) => DAILY_BASE + DAILY_STEP * Math.min(Math.max(1, Math.floor(Number(streak) || 0)), DAILY_CAP);

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // Asia/Kolkata is UTC+05:30 all year (no DST)

/** The Asia/Kolkata calendar day of `now` (ms or Date) as 'YYYY-MM-DD'. */
export const istDay = (now = Date.now()) => new Date(Number(now) + IST_OFFSET_MS).toISOString().slice(0, 10);

/** The IST calendar day before `istDay(now)`. */
export const istYesterday = (now = Date.now()) => istDay(Number(now) - DAY_MS);

/** A DB date value ('YYYY-MM-DD' text, or a Date at UTC midnight) -> 'YYYY-MM-DD' | null. */
export function dayString(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * The daily-reward state shown to the user.
 *   streak     - current streak (0 when the last claim was before yesterday: the streak is broken)
 *   lastClaim  - IST day of the last claim or null
 *   canClaim   - not yet claimed today (IST)
 *   nextReward - coins of the next claim (today's when canClaim, otherwise tomorrow's)
 */
export function dailyState({ streak, lastClaim }, now = Date.now()) {
  const today = istDay(now);
  const yesterday = istYesterday(now);
  const last = dayString(lastClaim);
  const stored = Math.max(0, Math.floor(Number(streak) || 0));
  const alive = last === today || last === yesterday;
  const canClaim = last !== today;
  const next = canClaim ? (last === yesterday ? stored + 1 : 1) : stored + 1;
  return { streak: alive ? stored : 0, lastClaim: last, canClaim, nextReward: dailyReward(next) };
}
