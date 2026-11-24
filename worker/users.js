// User row <-> API shape mapping and simple user queries.
import { query } from './db.js';
import { levelFromXp, dailyState } from './xp.js';
import { hasTutorial } from './games/tutorial.js';
import { cleanEquipped } from '../shared/cosmetics.js';

// last_daily is returned as 'YYYY-MM-DD' text (never a driver-parsed Date, so no timezone drift).
export const USER_COLUMNS =
  'id, google_sub, email, name, avatar, friend_code, handle, handle_changed_at, is_guest, xp, coins, level, games, wins, best_worth, rent_earned, created_at, last_seen, ' +
  "daily_streak, to_char(last_daily, 'YYYY-MM-DD') AS last_daily, equipped, friend_requests, role, banned_at, ban_reason";

export const ROLES = Object.freeze(['user', 'moderator', 'admin']);

/** The lowercased, trimmed addresses of the comma-separated ADMIN_EMAILS Worker variable. */
export function adminEmails(env) {
  const raw = env && typeof env.ADMIN_EMAILS === 'string' ? env.ADMIN_EMAILS : '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The effective role of a user row: `users.role`, except that a signed-in (non-guest) account whose email is listed
 * in ADMIN_EMAILS is always an admin. Guests are never staff; unknown role values count as 'user'.
 */
export function effectiveRole(r, env) {
  if (!r || r.is_guest) return 'user';
  const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : '';
  if (email && adminEmails(env).includes(email)) return 'admin';
  return r.role === 'moderator' || r.role === 'admin' ? r.role : 'user';
}

export const isStaffRole = (role) => role === 'moderator' || role === 'admin';

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

/** user_game_stats.extra (jsonb: an object, or its text) -> `tutorial === true`. */
function tutorialFlag(extra) {
  let x = extra;
  if (typeof x === 'string') {
    try {
      x = JSON.parse(x);
    } catch {
      return false;
    }
  }
  return !!x && typeof x === 'object' && x.tutorial === true;
}

/**
 * user_game_stats rows -> { [gameId]: { games, wins, bestScore, rating, tutorialDone? } }. `tutorialDone` (boolean, from
 * `extra.tutorial`) is added for games that have a tutorial (worker/games/tutorial.js) only.
 */
export function rowsToGameStats(rows) {
  const out = {};
  for (const r of rows || []) {
    out[r.game_id] = { games: r.games, wins: r.wins, bestScore: r.best_score, rating: r.rating };
    if (hasTutorial(r.game_id)) out[r.game_id].tutorialDone = tutorialFlag(r.extra);
  }
  return out;
}

/** The user's per-game numbers. Best effort: a failure gives {} rather than breaking /api/me or login. */
export async function loadGameStats(env, userId) {
  try {
    const rows = await query(
      env,
      'SELECT game_id, games, wins, best_score, rating, extra FROM user_game_stats WHERE user_id = $1',
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
 * `role` is the effective role (pass the Worker `env` so ADMIN_EMAILS is honoured).
 */
export function rowToUser(r, gameStats, now = Date.now(), env = undefined) {
  const user = {
    id: r.id,
    name: r.name,
    avatar: r.avatar,
    friendCode: r.friend_code,
    handle: r.handle || null,
    handleChangedAt: r.handle_changed_at ? new Date(r.handle_changed_at).toISOString() : null,
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
    // who may send me friend requests: 'everyone' (default) | 'nobody'
    friendRequests: r.friend_requests === 'nobody' ? 'nobody' : 'everyone',
    role: effectiveRole(r, env),
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
    handle: r.handle || null,
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

/** `{id,name,avatar,handle|null}` – the small identity blob pushed over sockets. */
export const identity = (r) => ({ id: r.id, name: r.name, avatar: r.avatar, handle: r.handle || null });

/** Lookup by (already normalised, lowercase) handle. */
export async function getUserByHandle(env, handle) {
  const rows = await query(env, `SELECT ${USER_COLUMNS} FROM users WHERE lower(handle) = $1`, [handle]);
  return rows[0] || null;
}
