// Seasonal events (docs/ENGAGEMENT.md section 3). The default export is the public GET /api/events/live; `adminEvents`
// is mounted by routes/admin.js at /api/admin/events (reads: staff; writes: admin).
import { Hono } from 'hono';
import { query, HttpError } from '../db.js';
import { readJson } from '../http.js';
import { limit } from '../ratelimit.js';
import { isUuid } from '../validate.js';
import { requireAdmin, writeAudit } from '../admin.js';
import {
  EVENT_COLUMNS,
  loadLiveEvents,
  coinMultiplierOf,
  rowToAdminEvent,
  parseEventFields,
  assertEvent,
  cleanConfig,
} from '../events.js';

const events = new Hono();

// GET /api/events/live -> { events: LiveEvent[], coinMultiplier }   public, cached 60 s
events.get('/live', limit('events-live', 120, 60), async (c) => {
  const live = await loadLiveEvents(c.env);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ events: live, coinMultiplier: coinMultiplierOf(live) });
});

export default events;

// ---------------------------------------------------------------- admin (/api/admin/events)

export const adminEvents = new Hono();

export const ADMIN_EVENTS_SQL = `SELECT ${EVENT_COLUMNS} FROM events ORDER BY starts_at DESC, created_at DESC LIMIT 200`;
export const EVENT_ONE_SQL = `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1::uuid`;
export const EVENT_CREATE_SQL = `
INSERT INTO events (kind, name, description, starts_at, ends_at, active, config, created_by)
VALUES ($1::text, $2::text, $3::text, $4::timestamptz, $5::timestamptz, $6::boolean, $7::jsonb, $8::uuid)
RETURNING ${EVENT_COLUMNS}`;
export const EVENT_UPDATE_SQL = `
UPDATE events
   SET kind = $2::text, name = $3::text, description = $4::text, starts_at = $5::timestamptz, ends_at = $6::timestamptz,
       active = $7::boolean, config = $8::jsonb
 WHERE id = $1::uuid
RETURNING ${EVENT_COLUMNS}`;
export const EVENT_DELETE_SQL = `DELETE FROM events WHERE id = $1::uuid RETURNING ${EVENT_COLUMNS}`;

/** A compact copy of an event for the audit details. */
const auditCopy = (e) => ({ kind: e.kind, name: e.name, startsAt: e.startsAt, endsAt: e.endsAt, active: e.active, config: e.config });

function eventId(c) {
  const id = c.req.param('id');
  if (!isUuid(id)) throw new HttpError(400, 'Invalid event id.');
  return id;
}

// GET -> { events } (newest first, at most 200)   staff
adminEvents.get('/', async (c) => {
  const rows = await query(c.env, ADMIN_EVENTS_SQL);
  const now = Date.now();
  return c.json({ events: rows.map((r) => rowToAdminEvent(r, now)) });
});

// POST { kind, name, description?, startsAt, endsAt, active?, config } -> { event }   admin
adminEvents.post('/', requireAdmin, async (c) => {
  const f = parseEventFields(await readJson(c), { partial: false });
  const config = assertEvent(f);
  const me = c.get('user');
  const [row] = await query(c.env, EVENT_CREATE_SQL, [
    f.kind,
    f.name,
    f.description ?? null,
    f.starts_at.toISOString(),
    f.ends_at.toISOString(),
    f.active ?? true,
    JSON.stringify(config),
    me.id,
  ]);
  const event = rowToAdminEvent(row);
  await writeAudit(c.env, { admin: me, action: 'event.create', details: { id: event.id, ...auditCopy(event) } });
  return c.json({ event });
});

// PATCH /:id  any subset of the POST fields -> { event }   admin
adminEvents.patch('/:id', requireAdmin, async (c) => {
  const id = eventId(c);
  const f = parseEventFields(await readJson(c), { partial: true });
  const [cur] = await query(c.env, EVENT_ONE_SQL, [id]);
  if (!cur) throw new HttpError(404, 'Event not found.');
  const merged = {
    kind: f.kind ?? cur.kind,
    name: f.name ?? cur.name,
    description: 'description' in f ? f.description : cur.description ?? null,
    starts_at: f.starts_at ?? new Date(cur.starts_at),
    ends_at: f.ends_at ?? new Date(cur.ends_at),
    active: 'active' in f ? f.active : cur.active !== false,
    config: 'config' in f ? f.config : cleanConfig(cur.kind, cur.config),
  };
  const config = assertEvent(merged);
  const [row] = await query(c.env, EVENT_UPDATE_SQL, [
    id,
    merged.kind,
    merged.name,
    merged.description,
    merged.starts_at.toISOString(),
    merged.ends_at.toISOString(),
    merged.active,
    JSON.stringify(config),
  ]);
  if (!row) throw new HttpError(404, 'Event not found.');
  const event = rowToAdminEvent(row);
  const changed = Object.keys(f).map((k) => ({ starts_at: 'startsAt', ends_at: 'endsAt' })[k] || k);
  await writeAudit(c.env, {
    admin: c.get('user'),
    action: 'event.update',
    details: { id, changed, before: auditCopy(rowToAdminEvent(cur)), after: auditCopy(event) },
  });
  return c.json({ event });
});

// DELETE /:id -> { ok: true }   admin
adminEvents.delete('/:id', requireAdmin, async (c) => {
  const id = eventId(c);
  const [row] = await query(c.env, EVENT_DELETE_SQL, [id]);
  if (!row) throw new HttpError(404, 'Event not found.');
  await writeAudit(c.env, { admin: c.get('user'), action: 'event.delete', details: { id, ...auditCopy(rowToAdminEvent(row)) } });
  return c.json({ ok: true });
});
