// Seasons (docs/ENGAGEMENT.md section 3). The default export is the public /api/seasons; `adminSeasons` is mounted by
// routes/admin.js at /api/admin/seasons (reads: staff; writes and the payout: admin).
import { Hono } from 'hono';
import { query, HttpError } from '../db.js';
import { readJson } from '../http.js';
import { limit } from '../ratelimit.js';
import { isUuid } from '../validate.js';
import { background } from '../hub.js';
import { requireAdmin, writeAudit } from '../admin.js';
import { deliverPushes, pushesFromResult } from '../achievements.js';
import {
  SEASON_COLUMNS,
  CURRENT_SEASON_SQL,
  SEASON_SQL,
  PAYOUT_SQL,
  PUBLIC_TOP,
  ADMIN_TOP,
  RANK_MAX,
  PAID_ALREADY,
  NOT_ENDED,
  rowToSeason,
  rowToAdminSeason,
  cleanTiers,
  tierFor,
  loadStandings,
  payoutParams,
  parseSeasonFields,
  assertSeasonWindow,
} from '../seasons.js';

const seasons = new Hono();
seasons.use('*', limit('seasons', 60, 60));

/** The `:id` season row: 400 malformed, 404 unknown. */
async function seasonRow(c) {
  const id = c.req.param('id');
  if (!isUuid(id)) throw new HttpError(400, 'Invalid season id.');
  const [row] = await query(c.env, SEASON_SQL, [id]);
  if (!row) throw new HttpError(404, 'Season not found.');
  return row;
}

/** `{ season, standings, me }` for a seasons row and the (optional) viewer. */
async function seasonBody(env, row, viewerId) {
  if (!row) return { season: null, standings: [], me: null };
  const { standings, me } = await loadStandings(env, row, { top: PUBLIC_TOP, viewerId });
  return { season: rowToSeason(row), standings, me };
}

// GET /api/seasons/current -> { season|null, standings (top 50 + mine), me|null }   session optional
seasons.get('/current', async (c) => {
  const [row] = await query(c.env, CURRENT_SEASON_SQL);
  return c.json(await seasonBody(c.env, row || null, c.get('session')?.uid || null));
});

// GET /api/seasons/:id -> same shape (a paid season reads its stored results)
seasons.get('/:id', async (c) => {
  const row = await seasonRow(c);
  return c.json(await seasonBody(c.env, row, c.get('session')?.uid || null));
});

export default seasons;

// ---------------------------------------------------------------- admin (/api/admin/seasons)

export const adminSeasons = new Hono();

export const ADMIN_SEASONS_SQL = `SELECT ${SEASON_COLUMNS} FROM seasons ORDER BY starts_at DESC, created_at DESC LIMIT 200`;
export const SEASON_CREATE_SQL = `
INSERT INTO seasons (name, starts_at, ends_at, prize_tiers, created_by)
VALUES ($1::text, $2::timestamptz, $3::timestamptz, $4::jsonb, $5::uuid)
RETURNING ${SEASON_COLUMNS}`;
// Never after the payout (paid_at IS NULL), so a paid season's tiers and window stay what was paid.
export const SEASON_UPDATE_SQL = `
UPDATE seasons SET name = $2::text, starts_at = $3::timestamptz, ends_at = $4::timestamptz, prize_tiers = $5::jsonb
 WHERE id = $1::uuid AND paid_at IS NULL
RETURNING ${SEASON_COLUMNS}`;

const auditCopy = (s) => ({ name: s.name, startsAt: s.startsAt, endsAt: s.endsAt, prizeTiers: s.prizeTiers.map(({ itemName, ...t }) => t) });

// GET -> { seasons } (newest first)   staff
adminSeasons.get('/', async (c) => {
  const rows = await query(c.env, ADMIN_SEASONS_SQL);
  const now = Date.now();
  return c.json({ seasons: rows.map((r) => rowToAdminSeason(r, now)) });
});

// POST { name, startsAt, endsAt, prizeTiers } -> { season }   admin
adminSeasons.post('/', requireAdmin, async (c) => {
  const f = parseSeasonFields(await readJson(c), { partial: false });
  assertSeasonWindow(f.starts_at, f.ends_at);
  const me = c.get('user');
  const [row] = await query(c.env, SEASON_CREATE_SQL, [f.name, f.starts_at.toISOString(), f.ends_at.toISOString(), JSON.stringify(f.prize_tiers), me.id]);
  const season = rowToAdminSeason(row);
  await writeAudit(c.env, { admin: me, action: 'season.create', details: { id: season.id, ...auditCopy(season) } });
  return c.json({ season });
});

// PATCH /:id  any subset -> { season }   admin; 409 after the payout
adminSeasons.patch('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) throw new HttpError(400, 'Invalid season id.');
  const f = parseSeasonFields(await readJson(c), { partial: true });
  const cur = await seasonRow(c);
  if (cur.paid_at) throw new HttpError(409, PAID_ALREADY);
  const merged = {
    name: f.name ?? cur.name,
    starts_at: f.starts_at ?? new Date(cur.starts_at),
    ends_at: f.ends_at ?? new Date(cur.ends_at),
    prize_tiers: f.prize_tiers ?? cleanTiers(cur.prize_tiers).map(({ itemName, ...t }) => t),
  };
  assertSeasonWindow(merged.starts_at, merged.ends_at);
  const [row] = await query(c.env, SEASON_UPDATE_SQL, [
    id,
    merged.name,
    merged.starts_at.toISOString(),
    merged.ends_at.toISOString(),
    JSON.stringify(merged.prize_tiers),
  ]);
  if (!row) throw new HttpError(409, PAID_ALREADY); // paid meanwhile
  const season = rowToAdminSeason(row);
  const changed = Object.keys(f).map((k) => ({ starts_at: 'startsAt', ends_at: 'endsAt', prize_tiers: 'prizeTiers' })[k] || k);
  await writeAudit(c.env, {
    admin: c.get('user'),
    action: 'season.update',
    details: { id, changed, before: auditCopy(rowToAdminSeason(cur)), after: auditCopy(season) },
  });
  return c.json({ season });
});

// GET /:id/standings -> { season, standings (top 100), prizesPreview: [{ rank, userId, name, coins?, itemId? }] }   staff
adminSeasons.get('/:id/standings', async (c) => {
  const row = await seasonRow(c);
  const season = rowToAdminSeason(row);
  const maxPrizeRank = Math.max(0, ...season.prizeTiers.map((t) => t.toRank));
  const top = Math.min(Math.max(ADMIN_TOP, maxPrizeRank), RANK_MAX);
  const { standings } = await loadStandings(c.env, row, { top });
  const prizesPreview = [];
  for (const r of standings) {
    const t = tierFor(season.prizeTiers, r.rank);
    if (!t) continue;
    prizesPreview.push({
      rank: r.rank,
      userId: r.userId,
      name: r.name,
      ...(t.coins ? { coins: t.coins } : {}),
      ...(t.itemId ? { itemId: t.itemId, itemName: t.itemName } : {}),
    });
  }
  return c.json({ season, standings: standings.filter((r) => r.rank <= ADMIN_TOP), prizesPreview });
});

// POST /:id/payout { confirm: true } -> { paid }   admin; 409 before the end or when already paid
adminSeasons.post('/:id/payout', requireAdmin, async (c) => {
  const body = await readJson(c);
  if (body.confirm !== true) throw new HttpError(400, 'Send { confirm: true } to pay out the season.');
  const season = await seasonRow(c);
  if (season.paid_at) throw new HttpError(409, PAID_ALREADY);
  if (new Date(season.ends_at).getTime() > Date.now()) throw new HttpError(409, NOT_ENDED);
  const [row] = await query(c.env, PAYOUT_SQL, payoutParams(season));
  if (!row || Number(row.guarded) === 0) {
    // Lost a race (paid by someone else, or the tiers / end changed since the read): a fresh look decides the message.
    const [now] = await query(c.env, SEASON_SQL, [season.id]);
    if (now && !now.paid_at && new Date(now.ends_at).getTime() > Date.now()) throw new HttpError(409, NOT_ENDED);
    throw new HttpError(409, PAID_ALREADY);
  }
  const paid = Number(row.paid) || 0;
  await writeAudit(c.env, {
    admin: c.get('user'),
    action: 'season.payout',
    details: { id: season.id, name: season.name, paid, ranked: Number(row.ranked) || 0, prizeTiers: auditCopy(rowToSeason(season)).prizeTiers },
  });
  // Live pushes for the winners whose notification came back (at most PAYOUT_PUSH_MAX); the rest see it on next load.
  const pushes = pushesFromResult(row);
  const notified = new Set(pushes.filter((p) => p.messages.some((m) => m.t === 'notification')).map((p) => p.userId));
  background(c, deliverPushes(c.env, pushes.filter((p) => notified.has(p.userId))));
  return c.json({ paid });
});
