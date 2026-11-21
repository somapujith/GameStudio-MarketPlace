// Seasonal events (docs/ENGAGEMENT.md section 3): time-boxed switches the admin turns on. An event is live when
// `active AND starts_at <= now() < ends_at`.
//   coin_boost    { multiplier: 1.5 | 2 | 2.5 | 3 }  multiplies the MATCH coin reward (highest live one wins)
//   limited_shop  { itemIds: string[] }              those `source: 'event'` cosmetics are buyable while it is live
import { query, HttpError } from './db.js';
import { parseText, iso, asObject } from './admin.js';
import { cosmeticById } from '../shared/cosmetics.js';

export const EVENT_KINDS = Object.freeze(['coin_boost', 'limited_shop']);
export const MULTIPLIERS = Object.freeze([1.5, 2, 2.5, 3]);
export const MULTIPLIER_MAX = 3;
export const EVENT_MAX_DAYS = 31;
export const EVENT_NAME_MAX = 60;
export const EVENT_DESCRIPTION_MAX = 200;
export const LIMITED_ITEMS_MAX = 20;

export const EVENT_COLUMNS = 'id, kind, name, description, starts_at, ends_at, active, config, created_at';

/** A stored config -> the clean config of its kind. */
export function cleanConfig(kind, raw) {
  const c = asObject(raw);
  if (kind === 'coin_boost') {
    const m = Number(c.multiplier);
    return { multiplier: Number.isFinite(m) ? Math.min(Math.max(m, 1), MULTIPLIER_MAX) : 1 };
  }
  if (kind === 'limited_shop') return { itemIds: Array.isArray(c.itemIds) ? c.itemIds.filter((x) => typeof x === 'string') : [] };
  return {};
}

/** events row -> LiveEvent. */
export function rowToEvent(r) {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    description: r.description ?? null,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    config: cleanConfig(r.kind, r.config),
  };
}

/** Is an events row live at `now` (ms)? */
export function isLive(r, now = Date.now()) {
  if (!r || r.active === false) return false;
  const s = new Date(r.starts_at).getTime();
  const e = new Date(r.ends_at).getTime();
  return s <= now && now < e;
}

/** events row -> the admin shape (LiveEvent + active, createdAt, live). */
export function rowToAdminEvent(r, now = Date.now()) {
  return { ...rowToEvent(r), active: r.active !== false, createdAt: iso(r.created_at), live: isLive(r, now) };
}

export const LIVE_EVENTS_SQL = `
SELECT ${EVENT_COLUMNS}
  FROM events
 WHERE active = true AND starts_at <= now() AND ends_at > now()
 ORDER BY starts_at DESC, created_at DESC
 LIMIT 50`;

/** The live events (LiveEvent[]). */
export async function loadLiveEvents(env) {
  const rows = await query(env, LIVE_EVENTS_SQL);
  return rows.map(rowToEvent).filter((e) => EVENT_KINDS.includes(e.kind));
}

/** The highest coin_boost multiplier of a list of LiveEvents (1 when none). */
export function coinMultiplierOf(events) {
  let m = 1;
  for (const e of events || []) if (e.kind === 'coin_boost' && e.config.multiplier > m) m = e.config.multiplier;
  return m;
}

/** Item id -> the latest end (ISO) of the live limited_shop events that list it. */
export function limitedItemsOf(events) {
  const out = new Map();
  for (const e of events || []) {
    if (e.kind !== 'limited_shop') continue;
    for (const id of e.config.itemIds || []) {
      const prev = out.get(id);
      if (!prev || e.endsAt > prev) out.set(id, e.endsAt);
    }
  }
  return out;
}

// The multiplier live at a given moment (the match's ended_at).
export const COIN_MULTIPLIER_SQL = `
SELECT max((config->>'multiplier')::numeric) AS multiplier
  FROM events
 WHERE kind = 'coin_boost' AND active = true AND starts_at <= $1::timestamptz AND ends_at > $1::timestamptz
   AND jsonb_typeof(config->'multiplier') = 'number'`;

/** Clamp a multiplier to [1, 3] (anything odd counts as 1). */
export function clampMultiplier(v) {
  const m = Number(v);
  if (!Number.isFinite(m) || m < 1) return 1;
  return Math.min(m, MULTIPLIER_MAX);
}

/** The coin multiplier live at `at` (ISO). Best effort: a failure means no boost (1), never a failed match write. */
export async function coinMultiplierAt(env, at) {
  try {
    const rows = await query(env, COIN_MULTIPLIER_SQL, [at]);
    return clampMultiplier(rows && rows[0] && rows[0].multiplier);
  } catch {
    return 1;
  }
}

// ---------------------------------------------------------------- admin validation

function parseWhen(input, label) {
  if (typeof input !== 'string' && typeof input !== 'number') throw new HttpError(400, `${label} must be a date and time.`);
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} must be a date and time.`);
  return d;
}

export const MULTIPLIER_ERROR = 'The multiplier must be 1.5, 2, 2.5 or 3.';
export const LIMITED_EMPTY_ERROR = 'Pick at least one limited item.';
export const LIMITED_ITEM_ERROR = 'Only limited event items can be sold in a limited shop.';

/** Validate a config for `kind`; returns the clean config or throws HttpError(400). */
export function parseConfig(kind, raw) {
  const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!c) throw new HttpError(400, 'config must be an object.');
  if (kind === 'coin_boost') {
    if (typeof c.multiplier !== 'number' || !MULTIPLIERS.includes(c.multiplier)) throw new HttpError(400, MULTIPLIER_ERROR);
    return { multiplier: c.multiplier };
  }
  if (!Array.isArray(c.itemIds) || !c.itemIds.length) throw new HttpError(400, LIMITED_EMPTY_ERROR);
  if (c.itemIds.length > LIMITED_ITEMS_MAX) throw new HttpError(400, `At most ${LIMITED_ITEMS_MAX} limited items.`);
  const ids = [];
  for (const id of c.itemIds) {
    const item = typeof id === 'string' ? cosmeticById(id) : null;
    if (!item || item.source !== 'event') throw new HttpError(400, LIMITED_ITEM_ERROR);
    if (!ids.includes(item.id)) ids.push(item.id);
  }
  return { itemIds: ids };
}

/**
 * The POST / PATCH body in DB terms (only the keys given; POST needs kind, name, startsAt, endsAt, config). The window
 * and the config are checked on the merged event by `assertEvent`.
 */
export function parseEventFields(body, { partial }) {
  const out = {};
  if (!partial || body.kind !== undefined) {
    if (!EVENT_KINDS.includes(body.kind)) throw new HttpError(400, 'Kind must be coin_boost or limited_shop.');
    out.kind = body.kind;
  }
  if (!partial || body.name !== undefined) out.name = parseText(body.name, { label: 'Name', max: EVENT_NAME_MAX });
  if (body.description !== undefined) {
    out.description = parseText(body.description, { label: 'Description', max: EVENT_DESCRIPTION_MAX, optional: true, multiline: true });
  }
  if (!partial || body.startsAt !== undefined) out.starts_at = parseWhen(body.startsAt, 'Start');
  if (!partial || body.endsAt !== undefined) out.ends_at = parseWhen(body.endsAt, 'End');
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw new HttpError(400, 'active must be true or false.');
    out.active = body.active;
  }
  if (!partial || body.config !== undefined) out.config = body.config;
  return out;
}

/** Window and config rules of a whole event `{ kind, starts_at, ends_at, config }`; returns the clean config. */
export function assertEvent(e) {
  const s = e.starts_at.getTime();
  const end = e.ends_at.getTime();
  if (end <= s) throw new HttpError(400, 'The end must be after the start.');
  if (end - s > EVENT_MAX_DAYS * 86_400_000) throw new HttpError(400, `An event can last at most ${EVENT_MAX_DAYS} days.`);
  return parseConfig(e.kind, e.config);
}
