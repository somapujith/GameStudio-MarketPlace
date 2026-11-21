// Admin console helpers (docs/ADMIN.md): role resolution, staff / permission middleware, input validation shared by
// the admin routes, the audit-log writer and the notification creator. The routes live in routes/admin.js,
// routes/announcements.js and routes/notifications.js.
import { query, HttpError } from './db.js';
import { loadUser } from './auth.js';
import { ROLES, effectiveRole, isStaffRole, adminEmails } from './users.js';
import { pushToUser, background } from './hub.js';

export { ROLES, effectiveRole, isStaffRole, adminEmails };

// ---------------------------------------------------------------- roles + permissions

/** Permission keys by effective role (GET /api/admin/me). */
export const PERMISSIONS = Object.freeze({
  user: Object.freeze([]),
  moderator: Object.freeze(['view', 'moderate', 'announce']),
  admin: Object.freeze(['view', 'moderate', 'announce', 'economy', 'bulk', 'roles']),
});

export const permissionsFor = (role) => [...(PERMISSIONS[role] || PERMISSIONS.user)];
export const can = (role, permission) => (PERMISSIONS[role] || PERMISSIONS.user).includes(permission);

export const STAFF_ONLY = 'Staff only.';
export const NOT_ALLOWED = 'You do not have permission to do that.';

/**
 * Loads the signed-in user (401 signed out, 403 `code: 'banned'` when suspended, like requireUser) and refuses
 * anyone who is not staff (403). Sets `c.get('user')` (the row) and `c.get('role')` (the effective role).
 */
export async function requireStaff(c, next) {
  const r = await loadUser(c);
  if (r.res) return r.res;
  const role = effectiveRole(r.user, c.env);
  if (!isStaffRole(role)) return c.json({ error: STAFF_ONLY }, 403);
  c.set('user', r.user);
  c.set('role', role);
  await next();
}

/** After requireStaff: refuses a staff member whose role lacks `permission` (403). */
export function requirePermission(permission) {
  return async (c, next) => {
    if (!can(c.get('role'), permission)) return c.json({ error: NOT_ALLOWED }, 403);
    await next();
  };
}

/** After requireStaff: admins only (economy, bulk grants, roles). */
export const requireAdmin = async (c, next) => {
  if (c.get('role') !== 'admin') return c.json({ error: NOT_ALLOWED }, 403);
  await next();
};

/**
 * The moderation rules of the permission table: a moderator never acts on staff, and nobody bans themselves.
 * `verb` completes "Moderators cannot <verb> staff." Throws HttpError(403).
 */
export function assertCanModerate(c, target, { verb, selfForbidden = false } = {}) {
  const me = c.get('user');
  if (selfForbidden && target.id === me.id) throw new HttpError(403, `You cannot ${verb} yourself.`);
  if (c.get('role') !== 'admin' && isStaffRole(effectiveRole(target, c.env))) {
    throw new HttpError(403, `Moderators cannot ${verb} staff.`);
  }
}

// ---------------------------------------------------------------- validation

// C0/C1 controls, zero-width + bidi override/isolate characters, BOM, line/paragraph separators (as validate.js).
// eslint-disable-next-line no-control-regex
const INVISIBLE = new RegExp('[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]', 'g');

/**
 * Clean free text: invisible / control characters removed, whitespace collapsed (newlines kept, at most two in a
 * row, when `multiline`), trimmed. Returns the string ('' when nothing is left) or null for a non-string.
 */
export function cleanText(input, { multiline = false } = {}) {
  if (typeof input !== 'string') return null;
  let s = input.replace(/\r\n?/g, '\n').replace(INVISIBLE, ' ');
  if (multiline) {
    s = s
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    s = s.replace(/\s+/g, ' ');
  }
  return s.trim();
}

const len = (s) => [...s].length;

/**
 * Required (or optional) text between `min` and `max` characters. `label` names it in the 400 message.
 * Optional + missing/empty -> null.
 */
export function parseText(input, { label, min = 1, max, optional = false, multiline = false }) {
  if (input === undefined || input === null || (optional && input === '')) {
    if (optional) return null;
    throw new HttpError(400, `${label} is required.`);
  }
  const s = cleanText(input, { multiline });
  if (s === null) throw new HttpError(400, `${label} must be text.`);
  if (!s && optional) return null;
  if (len(s) < min || len(s) > max) {
    throw new HttpError(400, min > 1 ? `${label} must be ${min}-${max} characters.` : `${label} must be 1-${max} characters.`);
  }
  return s;
}

export const REASON_MIN = 3;
export const REASON_MAX = 200;
export const REASON_ERROR = `Give a reason (${REASON_MIN}-${REASON_MAX} characters).`;

/** A reason: 3-200 characters after trimming. `optional` lets a missing / empty one through as null. */
export function parseReason(input, { optional = false } = {}) {
  if (optional && (input === undefined || input === null || input === '')) return null;
  const s = cleanText(input);
  if (!s || len(s) < REASON_MIN || len(s) > REASON_MAX) throw new HttpError(400, REASON_ERROR);
  return s;
}

export const AMOUNT_MAX = 1_000_000;

/** A signed whole amount, not 0, |amount| <= max. */
export function parseAmount(input, max = AMOUNT_MAX) {
  if (!Number.isInteger(input) || input === 0 || Math.abs(input) > max) {
    throw new HttpError(400, `Amount must be a whole number between -${max.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}, not 0.`);
  }
  return input;
}

/** `notify?: bool = true` */
export function parseNotify(input) {
  if (input === undefined || input === null) return true;
  if (typeof input !== 'boolean') throw new HttpError(400, 'notify must be true or false.');
  return input;
}

/** `?page=` (1-based) and `?pageSize=` (default / cap) -> `{ page, pageSize, offset }`. Junk falls back to defaults. */
export function parsePage(rawPage, rawSize, { def, max }) {
  const p = Number.parseInt(rawPage, 10);
  const s = Number.parseInt(rawSize, 10);
  const page = Number.isFinite(p) && p >= 1 ? Math.min(p, 100_000) : 1;
  const pageSize = Number.isFinite(s) && s >= 1 ? Math.min(s, max) : def;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Escape a string for use inside an ILIKE pattern with `ESCAPE '\'`. */
export const escapeLike = (s) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

// ---------------------------------------------------------------- audit log

export const AUDIT_ACTIONS = Object.freeze([
  'coins',
  'xp',
  'item.grant',
  'item.revoke',
  'ban',
  'unban',
  'rename',
  'handle.reset',
  'role',
  'notify',
  'grant.bulk',
  'announcement.create',
  'announcement.update',
  'announcement.delete',
  // docs/ENGAGEMENT.md
  'event.create',
  'event.update',
  'event.delete',
  'season.create',
  'season.update',
  'season.payout',
  'achievement.grant',
]);

export const AUDIT_INSERT_SQL = `
INSERT INTO admin_actions (admin_id, admin_name, action, target_id, target_name, details)
VALUES ($1::uuid, $2::text, $3::text, $4::uuid, $5::text, $6::jsonb)
RETURNING id`;

/** Write one admin_actions row. `details` always carries the reason when one was given. */
export async function writeAudit(env, { admin, action, target = null, details = {} }) {
  await query(env, AUDIT_INSERT_SQL, [
    admin.id,
    admin.name,
    action,
    target ? target.id : null,
    target ? target.name : null,
    JSON.stringify(details),
  ]);
}

const iso = (v) => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
export { iso };

const asObject = (v) => {
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};
export { asObject };

/** admin_actions row -> AuditEntry. */
export function rowToAudit(r) {
  return {
    id: Number(r.id),
    action: r.action,
    adminId: r.admin_id || null,
    adminName: r.admin_name,
    targetId: r.target_id || null,
    targetName: r.target_name ?? null,
    details: asObject(r.details),
    createdAt: iso(r.created_at),
  };
}

// ---------------------------------------------------------------- notifications

// 'achievement': an unlocked achievement (docs/ENGAGEMENT.md), data { achievementId, coins?, itemId?, itemName? }.
export const NOTIFICATION_KINDS = Object.freeze(['gift', 'message', 'system', 'achievement']);
export const NOTIFICATION_COLUMNS = 'id, kind, title, body, data, read_at, created_at';

/** notifications row -> Notification. */
export function rowToNotification(r) {
  return {
    id: r.id,
    kind: NOTIFICATION_KINDS.includes(r.kind) ? r.kind : 'system',
    title: r.title,
    body: r.body ?? null,
    data: asObject(r.data),
    createdAt: iso(r.created_at),
    read: !!r.read_at,
  };
}

export const NOTIFICATION_INSERT_SQL = `
INSERT INTO notifications (user_id, kind, title, body, data)
VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::jsonb)
RETURNING ${NOTIFICATION_COLUMNS}`;

/** Insert one notification; resolves to the Notification shape. */
export async function createNotification(env, userId, { kind, title, body = null, data = {} }) {
  const rows = await query(env, NOTIFICATION_INSERT_SQL, [userId, kind, title, body, JSON.stringify(data)]);
  return rowToNotification(rows[0]);
}

/** Who gifts and messages appear to come from: the team, never an individual staff member. */
export const senderName = (env) => `${(env && env.APP_NAME) || 'Jalebi Games'} team`;

/**
 * After an action on one user: create a notification (unless `notification` is null) and push it plus any extra
 * live messages (`wallet`, `items`, ...) to the user's sockets in the background. A failing notification insert never
 * fails the request (the action itself has already happened).
 */
export async function tellUser(c, userId, notification, messages = []) {
  let created = null;
  if (notification) {
    try {
      created = await createNotification(c.env, userId, notification);
    } catch (err) {
      console.error('notification insert failed:', err && err.message);
    }
  }
  const out = [...(created ? [{ t: 'notification', notification: created }] : []), ...messages];
  if (out.length) background(c, Promise.all(out.map((m) => pushToUser(c.env, userId, m))));
  return created;
}
