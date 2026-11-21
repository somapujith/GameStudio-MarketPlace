// Site-wide announcement banners (docs/ADMIN.md). The default export is the public GET /api/announcements;
// `adminAnnouncements` is mounted by routes/admin.js at /api/admin/announcements (staff, permission 'announce').
import { Hono } from 'hono';
import { query, HttpError } from '../db.js';
import { readJson } from '../http.js';
import { limit } from '../ratelimit.js';
import { isUuid } from '../validate.js';
import { parseText, requirePermission, writeAudit, iso } from '../admin.js';

export const TONES = Object.freeze(['info', 'event', 'warning']);
export const MESSAGE_MAX = 200;
export const LINK_LABEL_MAX = 40;
export const LINK_URL_MAX = 500;
export const LINK_ERROR = 'The link must be a path starting with / or an https:// address.';
export const LIVE_MAX = 3;

const ANNOUNCEMENT_COLUMNS = 'id, message, tone, link_url, link_label, starts_at, ends_at, active, created_at';

/** announcements row -> Announcement. */
export function rowToAnnouncement(r) {
  return {
    id: r.id,
    message: r.message,
    tone: TONES.includes(r.tone) ? r.tone : 'info',
    linkUrl: r.link_url || null,
    linkLabel: r.link_label || null,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    active: r.active !== false,
    createdAt: iso(r.created_at),
  };
}

/**
 * `linkUrl`: a same-site path starting with `/` (not `//` or `/\`), or an absolute `https://` URL. No whitespace or
 * control characters. Returns the string, null for "no link", or throws HttpError(400).
 */
export function parseLinkUrl(input) {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input !== 'string') throw new HttpError(400, LINK_ERROR);
  const s = input.trim();
  if (!s) return null;
  // eslint-disable-next-line no-control-regex
  if (s.length > LINK_URL_MAX || /[\s\u0000-\u001f\u007f-\u009f\\]/.test(s)) throw new HttpError(400, LINK_ERROR);
  if (s.startsWith('/')) {
    if (s.startsWith('//')) throw new HttpError(400, LINK_ERROR);
    return s;
  }
  if (!/^https:\/\//i.test(s)) throw new HttpError(400, LINK_ERROR);
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, LINK_ERROR);
  }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) throw new HttpError(400, LINK_ERROR);
  return s;
}

/** An ISO date-time (or anything Date parses) -> Date; null/'' -> null when `nullable`. */
function parseWhen(input, label, { nullable }) {
  if (input === null || input === '' || input === undefined) {
    if (nullable) return null;
    throw new HttpError(400, `${label} must be a date and time.`);
  }
  if (typeof input !== 'string' && typeof input !== 'number') throw new HttpError(400, `${label} must be a date and time.`);
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} must be a date and time.`);
  return d;
}

/**
 * Validate the POST / PATCH fields present in `body` and return them in DB terms (only the keys that were given).
 * POST: `message` is required. Unknown keys are ignored.
 */
export function parseAnnouncementFields(body, { partial }) {
  const out = {};
  if (!partial || body.message !== undefined) {
    out.message = parseText(body.message, { label: 'Message', max: MESSAGE_MAX });
  }
  if (body.tone !== undefined && body.tone !== null) {
    if (!TONES.includes(body.tone)) throw new HttpError(400, 'Tone must be info, event or warning.');
    out.tone = body.tone;
  }
  if (body.linkUrl !== undefined) out.link_url = parseLinkUrl(body.linkUrl);
  if (body.linkLabel !== undefined) {
    out.link_label = parseText(body.linkLabel, { label: 'Link label', max: LINK_LABEL_MAX, optional: true });
  }
  if (body.startsAt !== undefined && body.startsAt !== null && body.startsAt !== '') {
    out.starts_at = parseWhen(body.startsAt, 'Start', { nullable: false });
  }
  if (body.endsAt !== undefined) out.ends_at = parseWhen(body.endsAt, 'End', { nullable: true });
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw new HttpError(400, 'active must be true or false.');
    out.active = body.active;
  }
  return out;
}

function assertWindow(startsAt, endsAt) {
  if (endsAt && startsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new HttpError(400, 'The end must be after the start.');
  }
}

// ---------------------------------------------------------------- public

export const LIVE_SQL = `
SELECT ${ANNOUNCEMENT_COLUMNS}
  FROM announcements
 WHERE active = true AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
 ORDER BY starts_at DESC, created_at DESC
 LIMIT ${LIVE_MAX}`;

const announcements = new Hono();

// GET /api/announcements -> { announcements: Announcement[] }  public; live ones only, newest first, at most 3.
announcements.get('/', limit('announcements', 120, 60), async (c) => {
  const rows = await query(c.env, LIVE_SQL);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ announcements: rows.map(rowToAnnouncement) });
});

export default announcements;

// ---------------------------------------------------------------- admin (/api/admin/announcements)

export const adminAnnouncements = new Hono();
adminAnnouncements.use('*', requirePermission('announce'));

const ALL_SQL = `SELECT ${ANNOUNCEMENT_COLUMNS} FROM announcements ORDER BY created_at DESC LIMIT 200`;

// GET -> { announcements } (all, newest first; capped at 200)
adminAnnouncements.get('/', async (c) => {
  const rows = await query(c.env, ALL_SQL);
  return c.json({ announcements: rows.map(rowToAnnouncement) });
});

export const CREATE_SQL = `
INSERT INTO announcements (message, tone, link_url, link_label, starts_at, ends_at, active, created_by)
VALUES ($1::text, $2::text, $3::text, $4::text, coalesce($5::timestamptz, now()), $6::timestamptz, $7::boolean, $8::uuid)
RETURNING ${ANNOUNCEMENT_COLUMNS}`;

/** A compact copy of an announcement for the audit details. */
const auditCopy = (a) => ({ message: a.message, tone: a.tone, linkUrl: a.linkUrl, startsAt: a.startsAt, endsAt: a.endsAt, active: a.active });

// POST { message, tone?, linkUrl?, linkLabel?, startsAt?, endsAt?, active? } -> { announcement }
adminAnnouncements.post('/', async (c) => {
  const f = parseAnnouncementFields(await readJson(c), { partial: false });
  assertWindow(f.starts_at || new Date(), f.ends_at);
  const me = c.get('user');
  const [row] = await query(c.env, CREATE_SQL, [
    f.message,
    f.tone || 'info',
    f.link_url ?? null,
    f.link_label ?? null,
    f.starts_at ? f.starts_at.toISOString() : null,
    f.ends_at ? f.ends_at.toISOString() : null,
    f.active ?? true,
    me.id,
  ]);
  const announcement = rowToAnnouncement(row);
  await writeAudit(c.env, { admin: me, action: 'announcement.create', details: { id: announcement.id, ...auditCopy(announcement) } });
  return c.json({ announcement });
});

const ONE_SQL = `SELECT ${ANNOUNCEMENT_COLUMNS} FROM announcements WHERE id = $1::uuid`;

export const UPDATE_SQL = `
UPDATE announcements
   SET message = $2::text, tone = $3::text, link_url = $4::text, link_label = $5::text,
       starts_at = $6::timestamptz, ends_at = $7::timestamptz, active = $8::boolean
 WHERE id = $1::uuid
RETURNING ${ANNOUNCEMENT_COLUMNS}`;

function announcementId(c) {
  const id = c.req.param('id');
  if (!isUuid(id)) throw new HttpError(400, 'Invalid announcement id.');
  return id;
}

// PATCH /:id  any subset of the POST fields -> { announcement }
adminAnnouncements.patch('/:id', async (c) => {
  const id = announcementId(c);
  const f = parseAnnouncementFields(await readJson(c), { partial: true });
  const [cur] = await query(c.env, ONE_SQL, [id]);
  if (!cur) throw new HttpError(404, 'Announcement not found.');
  const merged = {
    message: f.message ?? cur.message,
    tone: f.tone ?? cur.tone,
    link_url: 'link_url' in f ? f.link_url : cur.link_url,
    link_label: 'link_label' in f ? f.link_label : cur.link_label,
    starts_at: f.starts_at ?? new Date(cur.starts_at),
    ends_at: 'ends_at' in f ? f.ends_at : cur.ends_at ? new Date(cur.ends_at) : null,
    active: 'active' in f ? f.active : cur.active !== false,
  };
  assertWindow(merged.starts_at, merged.ends_at);
  const [row] = await query(c.env, UPDATE_SQL, [
    id,
    merged.message,
    merged.tone,
    merged.link_url,
    merged.link_label,
    merged.starts_at.toISOString(),
    merged.ends_at ? merged.ends_at.toISOString() : null,
    merged.active,
  ]);
  if (!row) throw new HttpError(404, 'Announcement not found.');
  const announcement = rowToAnnouncement(row);
  const changed = Object.keys(f).map((k) => ({ link_url: 'linkUrl', link_label: 'linkLabel', starts_at: 'startsAt', ends_at: 'endsAt' })[k] || k);
  await writeAudit(c.env, {
    admin: c.get('user'),
    action: 'announcement.update',
    details: { id, changed, before: auditCopy(rowToAnnouncement(cur)), after: auditCopy(announcement) },
  });
  return c.json({ announcement });
});

export const DELETE_SQL = `DELETE FROM announcements WHERE id = $1::uuid RETURNING ${ANNOUNCEMENT_COLUMNS}`;

// DELETE /:id -> { ok: true }
adminAnnouncements.delete('/:id', async (c) => {
  const id = announcementId(c);
  const [row] = await query(c.env, DELETE_SQL, [id]);
  if (!row) throw new HttpError(404, 'Announcement not found.');
  await writeAudit(c.env, { admin: c.get('user'), action: 'announcement.delete', details: { id, ...auditCopy(rowToAnnouncement(row)) } });
  return c.json({ ok: true });
});
