import { useMemo } from 'react';
import * as storage from '@/lib/storage.js';
import { claimDailyReward, errorMessage } from '@/lib/api.js';

/*
 * Thin, defensive wrappers around the lib/storage hooks. They normalise the shapes the
 * contract describes so every shell page can rely on complete objects (never undefined),
 * even for profiles saved by an older build.
 */
const noop = () => {};

export const DEFAULT_SETTINGS = {
  sfx: true,
  volume: 0.8,
  reducedMotion: false,
  theme: 'system',
  playbackSpeed: 1,
  haptics: true,
};

export const DEFAULT_PROFILE = {
  name: 'Guest',
  avatar: 0,
  xp: 0,
  level: 1,
  coins: 500,
  stats: { games: 0, wins: 0, rentEarned: 0, bestWorth: 0, propertiesBought: 0 },
  lastDailyClaim: null,
  dailyStreak: 0,
};

function pair(r) {
  return Array.isArray(r) ? [r[0], typeof r[1] === 'function' ? r[1] : noop] : [r, noop];
}

export function useSettings() {
  const [s, update] = pair(storage.useSettings?.());
  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, ...(s || {}) }), [s]);
  return [settings, update];
}

export function useProfile() {
  const [p, update] = pair(storage.useProfile?.());
  const profile = useMemo(
    () => ({ ...DEFAULT_PROFILE, ...(p || {}), stats: { ...DEFAULT_PROFILE.stats, ...(p?.stats || {}) } }),
    [p],
  );
  return [profile, update];
}

export function levelInfo(xp) {
  try {
    const li = storage.levelInfo?.(xp);
    if (li && typeof li.pct === 'number') return li;
  } catch {
    /* fall through */
  }
  // Same curve as the server: level L -> L+1 costs 100 + (L - 1) * 50 XP.
  const x = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 1;
  let start = 0;
  while (start + 100 + (level - 1) * 50 <= x) {
    start += 100 + (level - 1) * 50;
    level += 1;
  }
  const need = 100 + (level - 1) * 50;
  const into = x - start;
  return { level, into, need, pct: Math.round((into / need) * 1000) / 10 };
}

/**
 * Level, XP and coins. A signed-in player (guests included) gets the server's numbers, which finished matches
 * write; the on-device profile is only the fallback while signed out. Returns `{ xp, coins, info, level }`.
 */
export function progressOf(user, profile) {
  const serverXp = Number(user?.xp);
  const serverCoins = Number(user?.coins);
  const xp = user && Number.isFinite(serverXp) ? serverXp : Number(profile?.xp) || 0;
  const coins = user && Number.isFinite(serverCoins) ? serverCoins : Number(profile?.coins) || 0;
  const info = levelInfo(xp);
  return { xp, coins, info, level: info.level };
}

/** On-device daily claim (signed out only). `{ ok, coins, streak }` or `{ ok: false }`. */
export function claimDailyLocal() {
  try {
    return storage.claimDaily?.() || { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Server daily claim for a session (`POST /api/me/daily`), then `refresh()` so `user.coins` / `user.daily` update.
 * Resolves (never rejects) to
 *   `{ ok: true, coins: reward, streak, balance, daily, server: true }`
 *   `{ ok: false, already: true, server: true }`            already claimed today (409)
 *   `{ ok: false, error: 'message', server: true }`          offline / other failure
 */
export async function claimDailyServer({ refresh } = {}) {
  try {
    const r = (await claimDailyReward()) || {};
    try {
      await refresh?.();
    } catch {
      /* the claim itself succeeded */
    }
    return { ok: true, coins: Number(r.reward) || 0, streak: Number(r.streak) || 1, balance: Number(r.coins), daily: r.daily || null, server: true };
  } catch (e) {
    if (e?.status === 409) {
      try {
        await refresh?.();
      } catch {
        /* ignore */
      }
      return { ok: false, already: true, server: true };
    }
    return { ok: false, error: errorMessage(e, "Couldn't claim the reward. Try again."), server: true };
  }
}

/**
 * Claim today's reward.
 *   claimDaily({ user, refresh })  with a session  -> Promise of the `claimDailyServer` result
 *   claimDaily()                   no session      -> the on-device result, synchronously (older callers)
 * Prefer `useDaily().claim()` (hooks.js), which always returns a Promise and picks the right store.
 */
export function claimDaily(ctx) {
  if (ctx?.user) return claimDailyServer(ctx);
  return claimDailyLocal();
}

/**
 * Daily-reward state for the UI: the server's `user.daily` for a session, else the on-device profile.
 * `{ canClaim, streak, lastClaim, nextReward, server }` (nextReward = coins the next claim pays).
 */
export function dailyStateOf(user, profile, now = new Date()) {
  const d = user && user.daily && typeof user.daily === 'object' ? user.daily : null;
  if (user && d) {
    const streak = Math.max(0, Math.floor(Number(d.streak) || 0));
    const nextReward = Number(d.nextReward);
    return {
      canClaim: !!d.canClaim,
      streak,
      lastClaim: typeof d.lastClaim === 'string' ? d.lastClaim : null,
      nextReward: Number.isFinite(nextReward) && nextReward > 0 ? nextReward : dailyRewardFor(d.canClaim ? streak + 1 : streak),
      server: true,
    };
  }
  const last = typeof profile?.lastDailyClaim === 'string' ? profile.lastDailyClaim : null;
  const today = todayKey(now);
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const streak = Math.max(0, Math.floor(Number(profile?.dailyStreak) || 0));
  const canClaim = last !== today;
  const nextStreak = canClaim ? (last === todayKey(y) ? streak + 1 : 1) : streak;
  return { canClaim: user ? false : canClaim, streak, lastClaim: last, nextReward: dailyRewardFor(nextStreak), server: !!user };
}

/** Local calendar day as YYYY-MM-DD (the format profile.lastDailyClaim uses). */
export function todayKey(d = new Date()) {
  try {
    const k = storage.dayKey?.(d);
    if (typeof k === 'string') return k;
  } catch {
    /* fall through */
  }
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Coins granted for a given streak day (mirrors lib/storage `dailyReward`). */
export function dailyRewardFor(streak) {
  try {
    const v = storage.dailyReward?.(streak);
    if (Number.isFinite(v)) return v;
  } catch {
    /* fall through */
  }
  return 100 + 50 * Math.min(Math.max(1, Math.floor(streak) || 1), 6);
}

/** XP bar percentage 0..100 (prefers into/need; `pct` may be 0..1 or 0..100). */
export function pctOf(li) {
  const into = Number(li?.into);
  const need = Number(li?.need);
  if (Number.isFinite(into) && need > 0) return Math.max(0, Math.min(100, (into / need) * 100));
  const v = Number(li?.pct) || 0;
  return Math.max(0, Math.min(100, v <= 1 ? v * 100 : v));
}
