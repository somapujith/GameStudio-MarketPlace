// Admin console API: thin wrappers over `api` for `/api/admin/*` (contract: docs/ADMIN.md), plus the contract's
// limits and pure validators so the forms check exactly what the Worker checks.
//
// Failures throw the usual ApiError `{ status, message }` from api.js (status 0 = offline, 403 = not staff /
// not allowed, 409 = conflict such as a balance that would go negative).

import { api } from './api.js';

const enc = encodeURIComponent;

/** Permission keys from GET /api/admin/me. */
export const PERMS = Object.freeze({
  view: 'view',
  moderate: 'moderate',
  announce: 'announce',
  economy: 'economy',
  bulk: 'bulk',
  roles: 'roles',
});

export const ROLES = Object.freeze(['user', 'moderator', 'admin']);
export const USER_FILTERS = Object.freeze(['all', 'members', 'guests', 'banned', 'staff']);
export const USER_SORTS = Object.freeze(['newest', 'last_seen', 'coins', 'level', 'games']);
export const TONES = Object.freeze(['info', 'event', 'warning']);
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
]);

/** Contract limits (docs/ADMIN.md "Admin API"). */
export const LIMITS = Object.freeze({
  amountMax: 1_000_000,
  bulkCoinsMax: 100_000,
  reasonMin: 3,
  reasonMax: 200,
  nameMax: 24,
  notifyTitleMax: 80,
  notifyBodyMax: 500,
  grantTitleMax: 80,
  grantMessageMax: 500,
  bulkIdsMax: 500,
  announceMax: 200,
  linkLabelMax: 40,
  usersPageSize: 25,
  matchesPageSize: 20,
  actionsPageSize: 50,
});

/** Is this signed-in user staff (moderator or admin)? Guests never are. */
export function isStaff(user) {
  return !!user && !user.isGuest && (user.role === 'moderator' || user.role === 'admin');
}

/** Does `me` (GET /api/admin/me) carry permission `perm`? */
export function can(me, perm) {
  return !!me && Array.isArray(me.permissions) && me.permissions.includes(perm);
}

function qs(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---- reads ------------------------------------------------------------------------------------------------------

/** GET /api/admin/me -> { role, name, permissions: string[] } */
export const getAdminMe = (opts) => api.get('/api/admin/me', opts);

/** GET /api/admin/stats -> { users, signups, active, matches, rooms, economy, series, topCoins } */
export const getAdminStats = (opts) => api.get('/api/admin/stats', opts);

/** GET /api/admin/users?q&filter&sort&page&pageSize -> { users: AdminUserRow[], total, page, pageSize } */
export function listUsers({ q, filter, sort, page, pageSize } = {}, opts) {
  return api.get(
    `/api/admin/users${qs({
      q: q ? String(q).trim() : '',
      filter: filter && filter !== 'all' ? filter : '',
      sort: sort && sort !== 'newest' ? sort : '',
      page: page > 1 ? page : '',
      pageSize,
    })}`,
    opts,
  );
}

/** GET /api/admin/users/:id -> { user, items, friends, matches, actions, notifications, rooms } */
export const getAdminUser = (id, opts) => api.get(`/api/admin/users/${enc(id)}`, opts);

/** GET /api/admin/rooms -> { rooms: [...] } (updated in the last 24 h) */
export const listRooms = (opts) => api.get('/api/admin/rooms', opts);

/** GET /api/admin/matches?page&pageSize -> { matches, total, page, pageSize } */
export const listMatches = ({ page, pageSize } = {}, opts) => api.get(`/api/admin/matches${qs({ page: page > 1 ? page : '', pageSize })}`, opts);

/** GET /api/admin/actions?page&pageSize&targetId&adminId&action -> { actions: AuditEntry[], total, page, pageSize } */
export const listActions = ({ page, pageSize, targetId, adminId, action } = {}, opts) =>
  api.get(`/api/admin/actions${qs({ page: page > 1 ? page : '', pageSize, targetId, adminId, action })}`, opts);

/** GET /api/admin/announcements -> { announcements: Announcement[] } (all, newest first) */
export const listAnnouncements = (opts) => api.get('/api/admin/announcements', opts);

// ---- user actions -----------------------------------------------------------------------------------------------

/** POST /api/admin/users/:id/coins { amount, reason, notify } -> { coins } (409 if it would go below 0) */
export const adjustCoins = (id, { amount, reason, notify = true }, opts) => api.post(`/api/admin/users/${enc(id)}/coins`, { amount, reason, notify }, opts);

/** POST /api/admin/users/:id/xp { amount, reason } -> { xp, level } */
export const adjustXp = (id, { amount, reason }, opts) => api.post(`/api/admin/users/${enc(id)}/xp`, { amount, reason }, opts);

/** POST /api/admin/users/:id/items { itemId, reason, notify } -> { owned } */
export const grantItem = (id, { itemId, reason, notify = true }, opts) => api.post(`/api/admin/users/${enc(id)}/items`, { itemId, reason, notify }, opts);

/** DELETE /api/admin/users/:id/items/:itemId?reason= -> { owned } */
export const revokeItem = (id, itemId, reason, opts) => api.del(`/api/admin/users/${enc(id)}/items/${enc(itemId)}${qs({ reason })}`, opts);

/** POST /api/admin/users/:id/ban { reason } -> { banned: true } */
export const banUser = (id, reason, opts) => api.post(`/api/admin/users/${enc(id)}/ban`, { reason }, opts);

/** POST /api/admin/users/:id/unban { reason? } -> { banned: false } */
export const unbanUser = (id, reason, opts) => api.post(`/api/admin/users/${enc(id)}/unban`, reason ? { reason } : {}, opts);

/** POST /api/admin/users/:id/rename { name, reason } -> { name } */
export const renameUser = (id, { name, reason }, opts) => api.post(`/api/admin/users/${enc(id)}/rename`, { name, reason }, opts);

/** POST /api/admin/users/:id/reset-handle { reason } -> { handle: null } */
export const resetHandle = (id, reason, opts) => api.post(`/api/admin/users/${enc(id)}/reset-handle`, { reason }, opts);

/** POST /api/admin/users/:id/role { role } -> { role } */
export const setRole = (id, role, opts) => api.post(`/api/admin/users/${enc(id)}/role`, { role }, opts);

/** POST /api/admin/users/:id/notify { title, body? } -> { ok: true } */
export const notifyUser = (id, { title, body }, opts) => api.post(`/api/admin/users/${enc(id)}/notify`, body ? { title, body } : { title }, opts);

/** POST /api/admin/grants -> { count } */
export function bulkGrant({ audience, ids, coins, itemId, title, message, reason }, opts) {
  const body = { audience, reason };
  if (audience === 'ids') body.ids = ids;
  if (coins) body.coins = coins;
  if (itemId) body.itemId = itemId;
  if (title) body.title = title;
  if (message) body.message = message;
  return api.post('/api/admin/grants', body, opts);
}

// ---- announcements ----------------------------------------------------------------------------------------------

/** POST /api/admin/announcements -> { announcement } */
export const createAnnouncement = (fields, opts) => api.post('/api/admin/announcements', fields, opts);
/** PATCH /api/admin/announcements/:id -> { announcement } */
export const updateAnnouncement = (id, fields, opts) => api.patch(`/api/admin/announcements/${enc(id)}`, fields, opts);
/** DELETE /api/admin/announcements/:id -> { ok: true } */
export const deleteAnnouncement = (id, opts) => api.del(`/api/admin/announcements/${enc(id)}`, opts);

// ---- validators (pure; return '' when valid, else a short message) ---------------------------------------------

const len = (s) => [...String(s ?? '')].length;

export function reasonError(reason, { optional = false } = {}) {
  const r = String(reason ?? '').trim();
  if (!r) return optional ? '' : 'A reason is required.';
  if (len(r) < LIMITS.reasonMin) return `At least ${LIMITS.reasonMin} characters.`;
  if (len(r) > LIMITS.reasonMax) return `At most ${LIMITS.reasonMax} characters.`;
  return '';
}

/** A signed whole amount for coins / XP: not 0, |amount| <= 1,000,000. `raw` is the text from the input. */
export function amountError(raw, max = LIMITS.amountMax) {
  const s = String(raw ?? '').trim();
  if (!s) return 'Enter an amount.';
  if (!/^-?\d+$/.test(s)) return 'Whole numbers only.';
  const n = Number(s);
  if (n === 0) return 'Cannot be zero.';
  if (Math.abs(n) > max) return `At most ${max.toLocaleString('en-US')}.`;
  return '';
}

/** Bulk-grant coins: optional, 1..100,000 when given. */
export function bulkCoinsError(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (!/^\d+$/.test(s)) return 'Whole positive numbers only.';
  const n = Number(s);
  if (n < 1) return 'At least 1.';
  if (n > LIMITS.bulkCoinsMax) return `At most ${LIMITS.bulkCoinsMax.toLocaleString('en-US')}.`;
  return '';
}

export function nameError(name) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) return 'Name cannot be empty.';
  if (len(n) > LIMITS.nameMax) return `At most ${LIMITS.nameMax} characters.`;
  return '';
}

export function maxLenError(text, max, { required = false, label = 'This' } = {}) {
  const t = String(text ?? '').trim();
  if (!t) return required ? `${label} is required.` : '';
  if (len(t) > max) return `At most ${max} characters.`;
  return '';
}

/** `linkUrl`: empty, a same-site path starting with `/` (not `//`), or an `https://` URL. */
export function linkUrlError(url) {
  const u = String(url ?? '').trim();
  if (!u) return '';
  if (u.startsWith('/')) {
    if (u.startsWith('//') || u.startsWith('/\\')) return 'Use a single leading slash, or a full https:// link.';
    if (/\s/.test(u)) return 'Links cannot contain spaces.';
    return '';
  }
  if (!/^https:\/\//i.test(u)) return 'Use a path like /shop or a full https:// link.';
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return 'Not a valid https:// link.';
  } catch {
    return 'Not a valid https:// link.';
  }
  if (/\s/.test(u)) return 'Links cannot contain spaces.';
  return '';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => UUID_RE.test(String(s ?? '').trim());

/** Pasted ids (commas, spaces, new lines) -> { ids: unique valid uuids, bad: the rest }. */
export function parseIds(text) {
  const seen = new Set();
  const ids = [];
  const bad = [];
  for (const part of String(text ?? '').split(/[\s,;]+/)) {
    const p = part.trim();
    if (!p) continue;
    if (!isUuid(p)) {
      bad.push(p);
      continue;
    }
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    ids.push(k);
  }
  return { ids, bad };
}

export default {
  getAdminMe,
  getAdminStats,
  listUsers,
  getAdminUser,
  listRooms,
  listMatches,
  listActions,
  listAnnouncements,
};
