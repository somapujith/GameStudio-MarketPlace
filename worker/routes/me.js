import { Hono } from 'hono';
import { query } from '../db.js';
import { HttpError, isUniqueViolation } from '../db.js';
import { requireUser, requireMember, clearSessionCookie, isSecureRequest } from '../auth.js';
import { USER_COLUMNS, rowToUser, rowDaily, loadGameStats } from '../users.js';
import { validateName, parseAvatar, validateHandle } from '../validate.js';
import { limit } from '../ratelimit.js';
import { readJson } from '../http.js';
import { istDay, istYesterday, DAILY_BASE, DAILY_STEP, DAILY_CAP, dailyReward } from '../xp.js';

const me = new Hono();

// GET /api/me -> { user|null }  (also refreshes last_seen; user.gameStats = { [gameId]: { games, wins, bestScore, rating } },
// user.daily = { streak, lastClaim, canClaim, nextReward }, user.equipped = { frame?, dice?, title? })
me.get('/', async (c) => {
  const session = c.get('session');
  if (!session) return c.json({ user: null });
  const rows = await query(c.env, `UPDATE users SET last_seen = now() WHERE id = $1 RETURNING ${USER_COLUMNS}`, [session.uid]);
  if (!rows[0]) {
    c.header('Set-Cookie', clearSessionCookie(isSecureRequest(c.req.raw)));
    return c.json({ user: null });
  }
  return c.json({ user: rowToUser(rows[0], await loadGameStats(c.env, rows[0].id)) });
});

export const HANDLE_CHANGE_DAYS = 7;
const DAY_MS = 86_400_000;

/** Whole days (rounded up) until a handle may be changed again; 0 when allowed. First claim is always free. */
export function handleCooldownDays(user, now = Date.now()) {
  if (!user || !user.handle || !user.handle_changed_at) return 0;
  const left = new Date(user.handle_changed_at).getTime() + HANDLE_CHANGE_DAYS * DAY_MS - now;
  return left > 0 ? Math.ceil(left / DAY_MS) : 0;
}

// PATCH /api/me { name?, avatar?, handle? }
// handle: members only, 3-20 [a-z0-9_] (see validateHandle); 409 when taken; a claimed handle can be
// changed once per 7 days (429 with the days left). Re-sending your current handle is a no-op.
me.patch('/', requireUser, limit('me-patch', 30, 60), async (c) => {
  const body = await readJson(c);
  const sets = [];
  const params = [c.get('user').id];
  if (body.name !== undefined) {
    const v = validateName(body.name);
    if (!v.ok) throw new HttpError(400, v.error);
    params.push(v.value);
    sets.push(`name = $${params.length}`);
  }
  if (body.avatar !== undefined) {
    const a = parseAvatar(body.avatar);
    if (a == null) throw new HttpError(400, 'Avatar must be a number from 0 to 11.');
    params.push(a);
    sets.push(`avatar = $${params.length}`);
  }
  if (body.handle !== undefined) {
    const user = c.get('user');
    if (user.is_guest) throw new HttpError(403, 'Sign in with Google to pick a username.');
    const v = validateHandle(body.handle);
    if (!v.ok) throw new HttpError(400, v.error);
    if (String(user.handle || '').toLowerCase() !== v.value) {
      const days = handleCooldownDays(user);
      if (days) throw new HttpError(429, `You can change your username again in ${days} day${days === 1 ? '' : 's'}.`);
      params.push(v.value);
      sets.push(`handle = $${params.length}`, 'handle_changed_at = now()');
    }
  }
  const stats = await loadGameStats(c.env, c.get('user').id);
  if (!sets.length) return c.json({ user: rowToUser(c.get('user'), stats) });
  // `sets` only ever contains the fixed fragments built above; values are bound parameters.
  let rows;
  try {
    rows = await query(c.env, `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${USER_COLUMNS}`, params);
  } catch (err) {
    if (isUniqueViolation(err, 'handle')) throw new HttpError(409, 'That handle is taken.');
    throw err;
  }
  return c.json({ user: rowToUser(rows[0], stats) });
});

// GET /api/me/handle-available?h= -> { available, reason?: 'invalid'|'taken'|'reserved' }  (members only)
// Advisory only: the PATCH is the source of truth (the unique index decides races). Your own handle counts as available.
me.get('/handle-available', requireMember, limit('handle-available', 60, 60), async (c) => {
  const v = validateHandle(c.req.query('h') || '');
  if (!v.ok) return c.json({ available: false, reason: v.reason });
  const rows = await query(c.env, 'SELECT 1 AS taken FROM users WHERE lower(handle) = $1 AND id <> $2 LIMIT 1', [v.value, c.get('user').id]);
  return c.json(rows.length ? { available: false, reason: 'taken' } : { available: true });
});

// One atomic statement: only matches when today's (IST) reward has not been claimed yet, so a
// double-tap / two tabs can never claim twice. The SET expressions read the *old* row values:
// the streak continues when the last claim was yesterday, otherwise restarts at 1.
// Reward = $4 + $5 * LEAST(streak, $6)  (DAILY_BASE / DAILY_STEP / DAILY_CAP from xp.js).
export const DAILY_SQL = `
UPDATE users SET
       daily_streak = CASE WHEN last_daily = $3::date THEN daily_streak + 1 ELSE 1 END,
       coins = coins + ($4::int + $5::int * LEAST(CASE WHEN last_daily = $3::date THEN daily_streak + 1 ELSE 1 END, $6::int)),
       last_daily = $2::date
 WHERE id = $1 AND last_daily IS DISTINCT FROM $2::date
RETURNING ${USER_COLUMNS}`;

// POST /api/me/daily -> { reward, streak, coins, daily }; 409 when already claimed today (IST).
me.post('/daily', requireUser, limit('me-daily', 10, 60), async (c) => {
  const now = Date.now();
  const rows = await query(c.env, DAILY_SQL, [
    c.get('user').id,
    istDay(now),
    istYesterday(now),
    DAILY_BASE,
    DAILY_STEP,
    DAILY_CAP,
  ]);
  const row = rows[0];
  if (!row) throw new HttpError(409, 'Already claimed today.');
  const streak = Number(row.daily_streak) || 1;
  return c.json({ reward: dailyReward(streak), streak, coins: row.coins, daily: rowDaily(row, now) });
});

export const MATCHES_DEFAULT = 20;
export const MATCHES_MAX = 50;

/** `?limit=` -> 1..50 (default 20 for missing / junk). */
export function parseMatchesLimit(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return MATCHES_DEFAULT;
  return Math.min(n, MATCHES_MAX);
}

// My finished matches, newest first, each with every seat (avatar from users when the seat
// is still a user, else 0). Ids never leave the server: isMe is computed here.
export const MATCHES_SQL = `
SELECT m.id, m.game_id, m.ended_at, m.rounds, m.player_count, m.winner_id,
       mine.rank, mine.final_worth,
       (SELECT coalesce(json_agg(json_build_object(
                  'name', p.name,
                  'avatar', coalesce(u.avatar, 0),
                  'rank', p.rank,
                  'score', p.final_worth,
                  'isMe', coalesce(p.user_id = $1::uuid, false)
                ) ORDER BY p.rank, p.id), '[]'::json)
          FROM match_players p
          LEFT JOIN users u ON u.id = p.user_id
         WHERE p.match_id = m.id) AS players
  FROM match_players mine
  JOIN matches m ON m.id = mine.match_id
 WHERE mine.user_id = $1::uuid
 ORDER BY m.ended_at DESC, m.id DESC
 LIMIT $2::int`;

const iso = (v) => {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** A MATCHES_SQL row -> API shape. */
export function rowToMatch(r, meId) {
  let players = r.players;
  if (typeof players === 'string') {
    try {
      players = JSON.parse(players);
    } catch {
      players = [];
    }
  }
  return {
    id: r.id,
    gameId: r.game_id,
    endedAt: iso(r.ended_at),
    rounds: Number(r.rounds) || 0,
    playerCount: Number(r.player_count) || (Array.isArray(players) ? players.length : 0),
    rank: Number(r.rank),
    won: r.winner_id != null && r.winner_id === meId,
    score: Number(r.final_worth) || 0,
    players: (Array.isArray(players) ? players : []).map((p) => ({
      name: p.name,
      avatar: Number(p.avatar) || 0,
      rank: Number(p.rank),
      score: Number(p.score) || 0,
      isMe: p.isMe === true,
    })),
  };
}

// GET /api/me/matches?limit=20 (max 50) -> { matches: [{ id, gameId, endedAt, rounds, playerCount, rank, won, score, players }] }
me.get('/matches', requireUser, limit('me-matches', 60, 60), async (c) => {
  const user = c.get('user');
  const rows = await query(c.env, MATCHES_SQL, [user.id, parseMatchesLimit(c.req.query('limit'))]);
  return c.json({ matches: rows.map((r) => rowToMatch(r, user.id)) });
});

export default me;
