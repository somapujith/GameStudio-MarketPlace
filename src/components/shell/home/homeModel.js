// Pure helpers for the Games home (no React, no network): daily-reward view model on IST calendar days,
// "resume your game" pick, live table counts. Covered by home2.test.js.

export const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000; // Asia/Kolkata, UTC+5:30, no DST

/** 'YYYY-MM-DD' of the IST calendar day that contains `now` (ms). */
export function istDayKey(now = Date.now()) {
  return new Date(Number(now) + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Milliseconds until the next IST midnight (always > 0). */
export function msUntilIstMidnight(now = Date.now()) {
  const t = Number(now) + IST_OFFSET_MS;
  return (Math.floor(t / DAY_MS) + 1) * DAY_MS - t;
}

/** "5h 12m", "12m", "under a minute". */
export function fmtCountdown(ms) {
  const mins = Math.floor(Math.max(0, Number(ms) || 0) / 60_000);
  if (mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Server rule (HUSTLE_PLAN section 4): 100 + 50 * min(streak, 6) -> 150..400. */
export function dailyRewardFor(streak) {
  const s = Math.max(1, Math.floor(Number(streak)) || 1);
  return 100 + 50 * Math.min(s, 6);
}

/**
 * View model for the daily-reward card from the server's `user.daily = { streak, lastClaim, canClaim, nextReward }`.
 * Missing fields degrade to "nothing claimed yet, ready to claim" (the server still answers 409 if that is wrong).
 * -> { claimed, streak, nextStreak, todaysCoins, lost, days: [{ n, coins, done, current }] x7 }
 */
export function dailyView(daily, now = Date.now()) {
  const d = daily && typeof daily === 'object' ? daily : {};
  const streak = Math.max(0, Math.floor(Number(d.streak)) || 0);
  const last = typeof d.lastClaim === 'string' ? d.lastClaim : null;
  const today = istDayKey(now);
  const yesterday = istDayKey(Number(now) - DAY_MS);
  const claimed = typeof d.canClaim === 'boolean' ? !d.canClaim : last === today;
  const continues = last === yesterday;
  const nextStreak = claimed ? streak : continues ? streak + 1 : 1;
  const base = Math.max(1, nextStreak);
  const pos = ((base - 1) % 7) + 1;
  const served = Number(d.nextReward);
  const todaysCoins = !claimed && Number.isFinite(served) && served > 0 ? served : dailyRewardFor(base);
  const days = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    n,
    coins: dailyRewardFor(Math.max(1, base + (n - pos))),
    done: claimed ? n <= pos && streak > 0 : n < pos,
    current: !claimed && n === pos,
  }));
  return { claimed, streak, nextStreak, todaysCoins, lost: !claimed && streak > 0 && !continues && last !== today, days };
}

/** Preview track for signed-out visitors: day 1..7 rewards, nothing claimed. */
export const previewDays = () => [1, 2, 3, 4, 5, 6, 7].map((n) => ({ n, coins: dailyRewardFor(n), done: false, current: false }));

/** From `getMyRooms().rooms`: the running game first, else a lobby; null when there is nothing to resume. */
export function pickResume(rooms) {
  const list = Array.isArray(rooms) ? rooms.filter((r) => r && typeof r.code === 'string' && r.code) : [];
  const playing = list.find((r) => r.status === 'playing');
  if (playing) return { kind: 'playing', room: playing };
  const lobby = list.find((r) => r.status === 'lobby');
  return lobby ? { kind: 'lobby', room: lobby } : null;
}

/** `getGamesLive().games` -> { [gameId]: openTables }. */
export function openTablesById(games) {
  const out = {};
  if (!Array.isArray(games)) return out;
  for (const g of games) {
    const n = Math.floor(Number(g?.openTables));
    if (g && typeof g.id === 'string' && n > 0) out[g.id] = n;
  }
  return out;
}

/** Open rooms worth showing: valid code, a free seat. */
export function joinableRooms(rooms) {
  if (!Array.isArray(rooms)) return [];
  return rooms.filter((r) => {
    if (!r || typeof r.code !== 'string' || !r.code) return false;
    const p = Number(r.players);
    const m = Number(r.maxPlayers);
    return !(Number.isFinite(p) && Number.isFinite(m) && m > 0 && p >= m);
  });
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
