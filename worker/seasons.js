// Seasons (docs/ENGAGEMENT.md section 3): a points race over the matches ENDED inside the season window, with prize
// tiers paid once by an admin after the end. points = 3 * wins + games; ties: more wins, then the earlier last match.
// Only non-guest, non-banned users are ranked.
import { query, HttpError } from './db.js';
import { parseText, iso, asObject } from './admin.js';
import { rowEquipped } from './users.js';
import { parseList } from './achievements.js';
import { cosmeticById, FREE_COSMETICS } from '../shared/cosmetics.js';

export const SEASON_NAME_MAX = 60;
export const RANK_MAX = 1000;
export const PRIZE_COINS_MAX = 100_000;
export const TIERS_MAX = 20;
export const PUBLIC_TOP = 50;
export const ADMIN_TOP = 100;
export const SEASON_COLUMNS = 'id, name, starts_at, ends_at, prize_tiers, paid_at, created_at';

export const PAID_ALREADY = 'This season has already been paid out.';
export const NOT_ENDED = 'The season has not ended yet.';

/** 'scheduled' | 'active' | 'ended' | 'paid' for a seasons row at `now` (ms). */
export function seasonStatus(r, now = Date.now()) {
  if (r.paid_at) return 'paid';
  if (now < new Date(r.starts_at).getTime()) return 'scheduled';
  if (now < new Date(r.ends_at).getTime()) return 'active';
  return 'ended';
}

/** Stored prize tiers -> `[{ fromRank, toRank, coins?, itemId?, itemName? }]` (junk entries dropped). */
export function cleanTiers(raw) {
  return parseList(raw)
    .map((t) => asObject(t))
    .filter((t) => Number.isInteger(t.fromRank) && Number.isInteger(t.toRank))
    .map((t) => {
      const out = { fromRank: t.fromRank, toRank: t.toRank };
      if (Number.isInteger(t.coins) && t.coins > 0) out.coins = t.coins;
      if (typeof t.itemId === 'string') {
        out.itemId = t.itemId;
        const item = cosmeticById(t.itemId);
        if (item) out.itemName = item.name;
      }
      return out;
    });
}

/** seasons row -> Season. */
export function rowToSeason(r, now = Date.now()) {
  return {
    id: r.id,
    name: r.name,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    status: seasonStatus(r, now),
    prizeTiers: cleanTiers(r.prize_tiers),
  };
}

/** seasons row -> the admin shape (Season + createdAt, paidAt). */
export const rowToAdminSeason = (r, now = Date.now()) => ({ ...rowToSeason(r, now), createdAt: iso(r.created_at), paidAt: iso(r.paid_at) });

/** The tier that covers `rank`, or null. */
export const tierFor = (tiers, rank) => tiers.find((t) => rank >= t.fromRank && rank <= t.toRank) || null;

// ---------------------------------------------------------------- standings

// The ranked part, shared by the live standings and the payout. $1 = season start, $2 = season end (half-open window
// on matches.ended_at, which matches_ended_idx serves). One row per ranked user with rank 1..n (row_number: ranks are
// unique, so prize tiers never split a tie; the final tie-break is the user id).
const RANKED_CTE = `
agg AS (
  SELECT mp.user_id,
         count(*)::int AS games,
         (count(*) FILTER (WHERE m.winner_id = mp.user_id))::int AS wins,
         max(m.ended_at) AS last_at
    FROM matches m
    JOIN match_players mp ON mp.match_id = m.id
   WHERE m.ended_at >= $1::timestamptz AND m.ended_at < $2::timestamptz AND mp.user_id IS NOT NULL
     AND m.room_code <> 'solo'
   GROUP BY mp.user_id
), ranked AS (
  SELECT a.user_id, a.games, a.wins, a.last_at, (3 * a.wins + a.games)::int AS points,
         u.name, u.avatar, u.equipped,
         (row_number() OVER (ORDER BY 3 * a.wins + a.games DESC, a.wins DESC, a.last_at ASC, a.user_id))::int AS rank
    FROM agg a
    JOIN users u ON u.id = a.user_id
   WHERE u.is_guest = false AND u.banned_at IS NULL
)`;

// Top $3 plus the viewer's own row ($4, may be null).
export const STANDINGS_SQL = `
WITH ${RANKED_CTE}
SELECT user_id, name, avatar, equipped, rank, points, wins, games
  FROM ranked
 WHERE rank <= $3::int OR user_id = $4::uuid
 ORDER BY rank`;

// A paid season: the stored final table (names / looks are today's).
export const RESULTS_SQL = `
SELECT sr.user_id, u.name, u.avatar, u.equipped, sr.rank, sr.points, sr.wins, sr.games, sr.prize
  FROM season_results sr
  JOIN users u ON u.id = sr.user_id
 WHERE sr.season_id = $1::uuid AND (sr.rank <= $2::int OR sr.user_id = $3::uuid)
 ORDER BY sr.rank`;

/** A standings row -> SeasonRow. */
export function rowToSeasonRow(r, viewerId = null) {
  const eq = rowEquipped(r);
  const equipped = {};
  if (eq.frame) equipped.frame = eq.frame;
  if (eq.title) equipped.title = eq.title;
  return {
    rank: Number(r.rank),
    userId: r.user_id,
    name: r.name,
    avatar: Number(r.avatar) || 0,
    points: Number(r.points) || 0,
    wins: Number(r.wins) || 0,
    games: Number(r.games) || 0,
    equipped,
    isMe: !!viewerId && r.user_id === viewerId,
  };
}

/**
 * `{ standings: SeasonRow[] (top `top`), me: { rank, points, wins, games }|null }` for a seasons row. A paid season
 * reads season_results; any other the live matches.
 */
export async function loadStandings(env, season, { top, viewerId = null }) {
  const rows = season.paid_at
    ? await query(env, RESULTS_SQL, [season.id, top, viewerId])
    : await query(env, STANDINGS_SQL, [iso(season.starts_at), iso(season.ends_at), top, viewerId]);
  const all = rows.map((r) => rowToSeasonRow(r, viewerId));
  const mine = all.find((r) => r.isMe) || null;
  return {
    standings: all.filter((r) => r.rank <= top || r.isMe),
    me: mine ? { rank: mine.rank, points: mine.points, wins: mine.wins, games: mine.games } : null,
  };
}

// The current season: the active one, else the most recently ended (or paid) one, else the next scheduled one.
export const CURRENT_SEASON_SQL = `
SELECT ${SEASON_COLUMNS}
  FROM seasons
 ORDER BY CASE WHEN starts_at <= now() AND ends_at > now() THEN 0 WHEN ends_at <= now() THEN 1 ELSE 2 END,
          CASE WHEN ends_at <= now() THEN ends_at END DESC NULLS LAST,
          starts_at ASC,
          created_at DESC
 LIMIT 1`;

export const SEASON_SQL = `SELECT ${SEASON_COLUMNS} FROM seasons WHERE id = $1::uuid`;

// ---------------------------------------------------------------- payout

// One statement. `guard` is the only way in: it sets paid_at once, after the end, and only while the stored tiers are
// the ones this payout was computed with ($2). Everything else reads from `guard`, so a second payout writes nothing.
// $3 = the tiers as rows (with item names for the notifications), $4 = the notification title prefix, $5 = how many
// winners' notifications / items are returned for live pushes. Items ON CONFLICT DO NOTHING; one 'gift' notification
// per winner (coins and / or an item they did not own yet).
export const PAYOUT_SQL = `
WITH guard AS (
  UPDATE seasons SET paid_at = now()
   WHERE id = $1::uuid AND paid_at IS NULL AND ends_at <= now() AND prize_tiers = $2::jsonb
  RETURNING id, name, starts_at, ends_at
), ${RANKED_CTE.replace(/\$1::timestamptz/g, '(SELECT starts_at FROM guard)').replace(/\$2::timestamptz/g, '(SELECT ends_at FROM guard)')},
tiers AS (
  SELECT * FROM jsonb_to_recordset($3::jsonb) AS t(from_rank int, to_rank int, coins int, item_id text, item_name text)
), prized AS (
  SELECT r.user_id, r.rank, r.points, r.wins, r.games, t.coins, t.item_id, t.item_name
    FROM ranked r
    LEFT JOIN tiers t ON r.rank BETWEEN t.from_rank AND t.to_rank
), res AS (
  INSERT INTO season_results (season_id, user_id, rank, points, wins, games, prize)
  SELECT $1::uuid, p.user_id, p.rank, p.points, p.wins, p.games,
         jsonb_strip_nulls(jsonb_build_object('coins', p.coins, 'itemId', p.item_id))
    FROM prized p
   WHERE EXISTS (SELECT 1 FROM guard)
  ON CONFLICT (season_id, user_id) DO NOTHING
  RETURNING user_id
), coin AS (
  UPDATE users u SET coins = u.coins + p.coins
    FROM prized p
   WHERE u.id = p.user_id AND p.coins > 0 AND EXISTS (SELECT 1 FROM guard)
  RETURNING u.id, u.coins
), item AS (
  INSERT INTO user_items (user_id, item_id, price_paid)
  SELECT p.user_id, p.item_id, 0 FROM prized p
   WHERE p.item_id IS NOT NULL AND EXISTS (SELECT 1 FROM guard)
  ON CONFLICT (user_id, item_id) DO NOTHING
  RETURNING user_id, item_id
), notif AS (
  INSERT INTO notifications (user_id, kind, title, body, data)
  SELECT p.user_id, 'gift', $4::text || (SELECT name FROM guard),
         'You finished #' || p.rank || ' in ' || (SELECT name FROM guard) || '.',
         jsonb_strip_nulls(jsonb_build_object(
           'coins', CASE WHEN c.id IS NOT NULL THEN p.coins END,
           'itemId', CASE WHEN i.user_id IS NOT NULL THEN p.item_id END,
           'itemName', CASE WHEN i.user_id IS NOT NULL THEN p.item_name END,
           'season', jsonb_build_object('id', $1::uuid, 'name', (SELECT name FROM guard), 'rank', p.rank)))
    FROM prized p
    LEFT JOIN coin c ON c.id = p.user_id
    LEFT JOIN item i ON i.user_id = p.user_id
   WHERE c.id IS NOT NULL OR i.user_id IS NOT NULL
  RETURNING id, kind, title, body, data, read_at, created_at, user_id
)
SELECT (SELECT count(*) FROM guard)::int AS guarded,
       (SELECT count(*) FROM res)::int AS ranked,
       (SELECT count(*) FROM notif)::int AS paid,
       coalesce((SELECT json_agg(json_build_object('userId', id, 'coins', coins)) FROM coin), '[]'::json) AS wallets,
       coalesce((SELECT json_agg(json_build_object('userId', user_id, 'itemId', item_id)) FROM item), '[]'::json) AS items,
       coalesce((SELECT json_agg(row_to_json(notif)) FROM (SELECT * FROM notif LIMIT $5::int) notif), '[]'::json) AS notifications,
       coalesce((SELECT json_agg(json_build_object('userId', ui.user_id, 'itemId', ui.item_id))
                   FROM user_items ui WHERE ui.user_id IN (SELECT user_id FROM item LIMIT $5::int)), '[]'::json) AS owned_before`;

export const PAYOUT_PUSH_MAX = 100;

/** The payout parameters for a seasons row (the stored tiers, as given, guard the statement). */
export function payoutParams(season) {
  const stored = season.prize_tiers === undefined || season.prize_tiers === null ? [] : season.prize_tiers;
  const raw = typeof stored === 'string' ? stored : JSON.stringify(stored);
  const tiers = cleanTiers(stored).map((t) => ({
    from_rank: t.fromRank,
    to_rank: t.toRank,
    coins: t.coins ?? null,
    item_id: t.itemId ?? null,
    item_name: t.itemName ?? null,
  }));
  return [season.id, raw, JSON.stringify(tiers), 'Season prize: ', PAYOUT_PUSH_MAX];
}

// ---------------------------------------------------------------- admin validation

function parseWhen(input, label) {
  if (typeof input !== 'string' && typeof input !== 'number') throw new HttpError(400, `${label} must be a date and time.`);
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} must be a date and time.`);
  return d;
}

export const TIER_RANK_ERROR = `Each prize tier needs whole-number ranks from 1 to ${RANK_MAX} (fromRank <= toRank).`;
export const TIER_OVERLAP_ERROR = 'Prize tiers must not overlap.';
export const TIER_EMPTY_ERROR = 'Each prize tier needs coins, an item or both.';
export const TIER_COINS_ERROR = `Prize coins must be a whole number from 1 to ${PRIZE_COINS_MAX.toLocaleString('en-US')}.`;
export const TIER_ITEM_ERROR = 'Unknown prize item.';

/**
 * Validate prize tiers: an array (at most 20) of `{ fromRank, toRank, coins?, itemId? }`, ranks 1-1000, non-overlapping,
 * coins 1-100,000, items any non-free cosmetic (season items are the intended ones). Returns them sorted by rank.
 */
export function parseTiers(input) {
  if (!Array.isArray(input)) throw new HttpError(400, 'prizeTiers must be a list.');
  if (input.length > TIERS_MAX) throw new HttpError(400, `At most ${TIERS_MAX} prize tiers.`);
  const tiers = input.map((t) => {
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new HttpError(400, TIER_RANK_ERROR);
    const { fromRank, toRank } = t;
    if (!Number.isInteger(fromRank) || !Number.isInteger(toRank) || fromRank < 1 || toRank > RANK_MAX || fromRank > toRank) {
      throw new HttpError(400, TIER_RANK_ERROR);
    }
    const out = { fromRank, toRank };
    if (t.coins !== undefined && t.coins !== null) {
      if (!Number.isInteger(t.coins) || t.coins < 1 || t.coins > PRIZE_COINS_MAX) throw new HttpError(400, TIER_COINS_ERROR);
      out.coins = t.coins;
    }
    if (t.itemId !== undefined && t.itemId !== null && t.itemId !== '') {
      const item = typeof t.itemId === 'string' ? cosmeticById(t.itemId) : null;
      if (!item || FREE_COSMETICS.includes(item.id)) throw new HttpError(400, TIER_ITEM_ERROR);
      out.itemId = item.id;
    }
    if (out.coins === undefined && out.itemId === undefined) throw new HttpError(400, TIER_EMPTY_ERROR);
    return out;
  });
  tiers.sort((a, b) => a.fromRank - b.fromRank);
  for (let i = 1; i < tiers.length; i += 1) if (tiers[i].fromRank <= tiers[i - 1].toRank) throw new HttpError(400, TIER_OVERLAP_ERROR);
  return tiers;
}

/** POST / PATCH fields in DB terms (only the keys given; POST needs name, startsAt, endsAt; prizeTiers defaults to []). */
export function parseSeasonFields(body, { partial }) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = parseText(body.name, { label: 'Name', max: SEASON_NAME_MAX });
  if (!partial || body.startsAt !== undefined) out.starts_at = parseWhen(body.startsAt, 'Start');
  if (!partial || body.endsAt !== undefined) out.ends_at = parseWhen(body.endsAt, 'End');
  if (body.prizeTiers !== undefined) out.prize_tiers = parseTiers(body.prizeTiers);
  else if (!partial) out.prize_tiers = [];
  return out;
}

export function assertSeasonWindow(startsAt, endsAt) {
  if (endsAt.getTime() <= startsAt.getTime()) throw new HttpError(400, 'The end must be after the start.');
}
