// Solo-game runs (docs/ADDING_A_GAME.md section 9): validate a finished run reported by the client and write it once.
// Everything the client sends is hostile. The numbers are sanity-checked against the game's limits (worker/games/solo.js),
// never trusted: a determined cheater can still report a plausible score, so this is not cheat-proof.
import { query, transaction, HttpError } from './db.js';
import { soloRewards, SOLO_DAILY_CAP, levelFromXp, istDay } from './xp.js';
import { coinMultiplierAt } from './events.js';
import { boostedCoins } from './match.js';

/** Largest value any reported field may have (keeps every number inside a Postgres int). */
export const MAX_FIELD = 1_000_000_000;
export const FINISH_FIELDS = ['earned', 'seconds', 'distance', 'quests', 'fares', 'style'];
/** A run may claim at most this many seconds more than the time that really passed since /start (clock rounding). */
export const SECONDS_SLACK = 5;

/**
 * The /finish body -> `{ token, run:{ earned, seconds, distance, quests, fares, style } }`. Every number must be a
 * non-negative whole number up to MAX_FIELD (no floats, strings, NaN, negatives). Throws HttpError(400).
 */
export function parseFinishBody(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (typeof b.token !== 'string' || !b.token || b.token.length > 2048) throw new HttpError(400, 'Missing run token.');
  const run = {};
  for (const k of FINISH_FIELDS) {
    const v = b[k];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > MAX_FIELD) {
      throw new HttpError(400, `${k} must be a whole number from 0 to ${MAX_FIELD}.`);
    }
    run[k] = v;
  }
  return { token: b.token, run };
}

/**
 * Check a run against the game's plausibility limits and the token's age. `nowMs` is the server clock.
 * Throws HttpError(422) with a plain message; resolves to nothing when the run is plausible.
 */
export function assertPlausible(game, claims, run, nowMs = Date.now()) {
  const elapsed = nowMs / 1000 - claims.iat;
  if (run.seconds < game.minSeconds) throw new HttpError(422, `A run must last at least ${game.minSeconds} seconds.`);
  if (run.seconds > game.maxSeconds) throw new HttpError(422, 'That run is too long to count.');
  if (run.seconds > elapsed + SECONDS_SLACK) throw new HttpError(422, 'That run is longer than the time that has passed.');
  if (run.earned > run.seconds * game.maxEarnPerSecond + game.earnGrace) throw new HttpError(422, 'That score is too high for the time played.');
  if (run.distance > run.seconds * game.maxDistancePerSecond) throw new HttpError(422, 'That distance is too far for the time played.');
  if (run.quests > game.maxQuests) throw new HttpError(422, 'Too many quests for one run.');
}

// ---------------------------------------------------------------- persistence
//
// A finished run is stored as an ordinary one-player `matches` row so it shows up in match history, and nothing needs migrating:
//   id            the token's jti (so a token can be finished once: ON CONFLICT (id) DO NOTHING)
//   room_code     'solo' (real room codes are 6 letters/digits, so it cannot collide; seasons skip these rows)
//   win_reason    the stored outcome as JSON text: {"xp","coins","newBest"} = what this run actually PAID and whether it was a
//                 new best. It doubles as the ledger of the per-day cap and is the data a replay answers with.
//   rounds        quests;  winner_id = the player when earned >= winEarned
//   match_players one row: rank 1, final_worth = earned
// user_game_stats gets games + 1, wins + win, best_score = GREATEST(...), and the totals quests / fares / distance /
// seconds / style accumulate in `extra`. rating is left alone (solo games are unrated).
//
// Daily cap: `used` sums xp / coins already paid by this player's solo matches since the start of the current IST day (the
// same day the daily reward uses) and the run pays LEAST(its reward, cap - used): a run over the cap still saves its stats
// and pays 0 for the excess. The caller takes a per-user advisory lock in a statement of its own first, so concurrent
// finishes for one player queue up and the next statement's fresh snapshot sees the earlier run.
export const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended('solo:' || $1::text, 0))";

export const SOLO_SQL = `
WITH used AS (
  SELECT coalesce(sum(CASE WHEN m.room_code = 'solo' THEN (m.win_reason::jsonb ->> 'xp')::int END), 0)::int AS xp,
         coalesce(sum(CASE WHEN m.room_code = 'solo' THEN (m.win_reason::jsonb ->> 'coins')::int END), 0)::int AS coins
    FROM match_players mp
    JOIN matches m ON m.id = mp.match_id
   WHERE mp.user_id = $2::uuid AND m.room_code = 'solo' AND m.ended_at >= $18::timestamptz
), prev AS (
  SELECT best_score FROM user_game_stats WHERE user_id = $2::uuid AND game_id = $3::text
), pay AS (
  SELECT LEAST($14::int, GREATEST(0, $16::int - used.xp)) AS xp,
         LEAST($15::int, GREATEST(0, $17::int - used.coins)) AS coins,
         ($7::int > coalesce((SELECT best_score FROM prev), 0)) AS new_best
    FROM used
), ins AS (
  INSERT INTO matches (id, room_code, started_at, ended_at, rounds, winner_id, win_reason, player_count, game_id, coin_multiplier)
  SELECT $1::uuid, 'solo', $5::timestamptz, $6::timestamptz, $10::int,
         (SELECT x.id FROM users x WHERE x.id = $2::uuid AND $13::int = 1),
         json_build_object('xp', pay.xp, 'coins', pay.coins, 'newBest', pay.new_best)::text,
         1, $3::text, $19::numeric
    FROM pay
  ON CONFLICT (id) DO NOTHING
  RETURNING id
), mp AS (
  INSERT INTO match_players (match_id, user_id, name, is_bot, rank, final_worth, rent_earned, hotels_built)
  SELECT ins.id, (SELECT x.id FROM users x WHERE x.id = $2::uuid), $4::text, false, 1, $7::int, 0, 0
    FROM ins
  RETURNING 1
), up AS (
  UPDATE users u SET xp = u.xp + pay.xp, coins = u.coins + pay.coins
    FROM ins, pay
   WHERE u.id = $2::uuid
  RETURNING u.xp, u.coins
), gs AS (
  INSERT INTO user_game_stats (user_id, game_id, games, wins, best_score, rating, extra, updated_at)
  SELECT $2::uuid, $3::text, 1, $13::int, $7::int, 1000,
         jsonb_build_object('quests', $10::int, 'fares', $11::int, 'distance', $9::int, 'seconds', $8::int, 'style', $12::int),
         now()
    FROM ins
   WHERE EXISTS (SELECT 1 FROM users x WHERE x.id = $2::uuid)
  ON CONFLICT (user_id, game_id) DO UPDATE SET
         games = user_game_stats.games + 1,
         wins = user_game_stats.wins + EXCLUDED.wins,
         best_score = GREATEST(user_game_stats.best_score, EXCLUDED.best_score),
         extra = user_game_stats.extra || jsonb_build_object(
           'quests', coalesce((user_game_stats.extra ->> 'quests')::bigint, 0) + $10::int,
           'fares', coalesce((user_game_stats.extra ->> 'fares')::bigint, 0) + $11::int,
           'distance', coalesce((user_game_stats.extra ->> 'distance')::bigint, 0) + $9::int,
           'seconds', coalesce((user_game_stats.extra ->> 'seconds')::bigint, 0) + $8::int,
           'style', coalesce((user_game_stats.extra ->> 'style')::bigint, 0) + $12::int),
         updated_at = now()
  RETURNING games, wins, best_score
)
SELECT (SELECT count(*) FROM ins)::int AS inserted,
       (SELECT xp FROM pay) AS paid_xp, (SELECT coins FROM pay) AS paid_coins, (SELECT new_best FROM pay) AS new_best,
       (SELECT xp FROM up) AS total_xp,
       (SELECT games FROM gs) AS games, (SELECT wins FROM gs) AS wins, (SELECT best_score FROM gs) AS best_score`;

// A replayed token: the stored outcome of this player's run plus the current totals.
export const REPLAY_SQL = `
SELECT mp.final_worth AS earned, m.win_reason, u.xp AS total_xp,
       coalesce(s.games, 0) AS games, coalesce(s.wins, 0) AS wins, coalesce(s.best_score, 0) AS best_score
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id
  JOIN users u ON u.id = mp.user_id
  LEFT JOIN user_game_stats s ON s.user_id = mp.user_id AND s.game_id = m.game_id
 WHERE mp.match_id = $1::uuid AND mp.user_id = $2::uuid AND m.room_code = 'solo' AND m.game_id = $3::text`;

const num = (v) => Number(v) || 0;

/** The outcome returned to the client (same shape for a first finish and a replay). */
function outcome({ duplicate, earned, newBest, bestScore, games, wins, xp, coins, totalXp }) {
  return {
    ok: true,
    duplicate,
    earned: num(earned),
    newBest: newBest === true,
    bestScore: num(bestScore),
    games: num(games),
    wins: num(wins),
    xp: num(xp),
    coins: num(coins),
    level: levelFromXp(totalXp),
  };
}

function storedOutcome(winReason) {
  try {
    const o = JSON.parse(winReason);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

/**
 * Write one finished, already validated run for `user` (a users row) with the token claims `claims`. Resolves to the response body.
 * `after(userId)` (optional) runs once, only after a first write (the achievement check: never for a replay).
 */
export async function persistSoloRun(env, { game, user, claims, run, nowMs = Date.now(), after }) {
  const endedAt = new Date(nowMs).toISOString();
  const base = soloRewards(run);
  const multiplier = await coinMultiplierAt(env, endedAt);
  const results = await transaction(env, [
    [LOCK_SQL, [user.id]],
    [
      SOLO_SQL,
      [
        claims.jti,
        user.id,
        game.id,
        user.name || 'Player',
        new Date(claims.iat * 1000).toISOString(),
        endedAt,
        run.earned,
        run.seconds,
        run.distance,
        run.quests,
        run.fares,
        run.style,
        run.earned >= game.winEarned ? 1 : 0,
        base.xp,
        boostedCoins(base.coins, multiplier),
        SOLO_DAILY_CAP.xp,
        SOLO_DAILY_CAP.coins,
        `${istDay(nowMs)}T00:00:00+05:30`,
        multiplier,
      ],
    ],
  ]);
  const row = Array.isArray(results) && Array.isArray(results[results.length - 1]) ? results[results.length - 1][0] : null;
  if (row && num(row.inserted) > 0) {
    try {
      // Level is derived from XP (also recomputed when read); keep the column in step, as match.js does.
      await query(env, 'UPDATE users SET level = $2 WHERE id = $1 AND level <> $2', [user.id, levelFromXp(row.total_xp)]);
    } catch {
      /* cosmetic */
    }
    if (typeof after === 'function') await after(user.id);
    return outcome({
      duplicate: false,
      earned: run.earned,
      newBest: row.new_best === true,
      bestScore: row.best_score,
      games: row.games,
      wins: row.wins,
      xp: row.paid_xp,
      coins: row.paid_coins,
      totalXp: row.total_xp,
    });
  }
  // The token was finished before: answer with what that run stored, award nothing.
  const rows = await query(env, REPLAY_SQL, [claims.jti, user.id, game.id]);
  const r = rows[0];
  if (!r) throw new HttpError(409, 'That run could not be saved.');
  const stored = storedOutcome(r.win_reason);
  return outcome({
    duplicate: true,
    earned: r.earned,
    newBest: stored.newBest === true,
    bestScore: r.best_score,
    games: r.games,
    wins: r.wins,
    xp: stored.xp,
    coins: stored.coins,
    totalXp: r.total_xp,
  });
}
