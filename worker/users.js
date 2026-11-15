// User row <-> API shape mapping and simple user queries.
import { query } from './db.js';
import { levelFromXp, dailyState } from './xp.js';
import { cleanEquipped } from '../shared/cosmetics.js';

// last_daily is returned as 'YYYY-MM-DD' text (never a driver-parsed Date, so no timezone drift).
export const USER_COLUMNS =
  'id, google_sub, email, name, avatar, friend_code, is_guest, xp, coins, level, games, wins, best_worth, rent_earned, created_at, last_seen, ' +
  "daily_streak, to_char(last_daily, 'YYYY-MM-DD') AS last_daily, equipped";

/** users.equipped (jsonb) -> `{ frame?, dice?, title? }` with unknown ids dropped. */
export function rowEquipped(r) {
  let raw = r && r.equipped;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  return cleanEquipped(raw);
}

/** The daily-reward block of a user row (see dailyState in xp.js). */
export const rowDaily = (r, now = Date.now()) => dailyState({ streak: r.daily_streak, lastClaim: r.last_daily }, now);

/** user_game_stats rows -> { [gameId]: { games, wins, bestScore, rating } }. */
export function rowsToGameStats(rows) {
  const out = {};
  for (const r of rows || []) {
    out[r.game_id] = { games: r.games, wins: r.wins, bestScore: r.best_score, rating: r.rating };
  }
  return out;
}

/** The user's per-game numbers. Best effort: a failure gives {} rather than breaking /api/me or login. */
export async function loadGameStats(env, userId) {
  try {
    const rows = await query(
      env,
      'SELECT game_id, games, wins, best_score, rating FROM user_game_stats WHERE user_id = $1',
      [userId],
    );
    return rowsToGameStats(rows);
  } catch {
    return {};
  }
}

/**
 * Full profile (only ever sent to the user themselves). `gameStats` is added when given.
 * `daily` / `equipped` default sensibly for rows read before those columns existed.
 */
export function rowToUser(r, gameStats, now = Date.now()) {
  const user = {
    id: r.id,
    name: r.name,
    avatar: r.avatar,
    friendCode: r.friend_code,
    isGuest: !!r.is_guest,
    // When the account was created (ISO). The first-run tours use it to tell a new player from a returning one.
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    level: levelFromXp(r.xp),
    xp: r.xp,
    coins: r.coins,
    stats: {
      games: r.games,
      wins: r.wins,
      bestWorth: r.best_worth,
      rentEarned: Number(r.rent_earned),
    },
    daily: rowDaily(r, now),
    equipped: rowEquipped(r),
  };
  if (gameStats) user.gameStats = gameStats;
  return user;
}

/** What other players may see: no email / stats beyond level. */
export function rowToFriend(r, online = false) {
  return {
    id: r.id,
    name: r.name,
    avatar: r.avatar,
    friendCode: r.friend_code,
    online,
    level: levelFromXp(r.xp),
    equipped: rowEquipped(r),
  };
}

export async function getUserById(env, id) {
  const rows = await query(env, `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function getUserByFriendCode(env, code) {
  const rows = await query(env, `SELECT ${USER_COLUMNS} FROM users WHERE friend_code = $1`, [code]);
  return rows[0] || null;
}

/** `{id,name,avatar}` – the small identity blob pushed over sockets. */
export const identity = (r) => ({ id: r.id, name: r.name, avatar: r.avatar });
