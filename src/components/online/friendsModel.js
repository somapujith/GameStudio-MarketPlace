// Pure state transitions for the Friends page (optimistic updates + live socket events) and the invites inbox. Unit-tested.
// data = { friends: [...], incoming: [...], outgoing: [...] },
// each entry { id, name, avatar, friendCode, online, level, equipped: { frame?, dice?, title? } }.
import { cleanEquipped, cosmeticById } from '@shared/cosmetics.js';

const same = (a, b) => a != null && b != null && String(a) === String(b);
const without = (list, id) => list.filter((x) => !same(x.id, id));

export const emptyFriends = () => ({ friends: [], incoming: [], outgoing: [] });

const clean = (u) => ({
  id: u.id,
  name: typeof u.name === 'string' && u.name ? u.name : 'Player',
  avatar: Number.isInteger(u.avatar) ? u.avatar : 0,
  friendCode: u.friendCode || '',
  online: !!u.online,
  level: Number.isFinite(u.level) ? u.level : 1,
  equipped: cleanEquipped(u.equipped),
});

/** Online first, then alphabetical (case-insensitive). Returns a new array. */
export function sortFriends(list) {
  return [...list].sort((a, b) => Number(!!b.online) - Number(!!a.online) || String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
}

/** Server payload (possibly partial / junk) -> well-formed data. */
export function normalizeFriends(raw) {
  const arr = (v) => (Array.isArray(v) ? v.filter((u) => u && u.id != null).map(clean) : []);
  return {
    friends: sortFriends(arr(raw && raw.friends)),
    incoming: arr(raw && raw.incoming),
    outgoing: arr(raw && raw.outgoing),
  };
}

export function applyPresence(data, userId, online) {
  if (!data.friends.some((f) => same(f.id, userId))) return data;
  return { ...data, friends: sortFriends(data.friends.map((f) => (same(f.id, userId) ? { ...f, online: !!online } : f))) };
}

/** Add `user` to friends (deduped) and drop any pending request entries for them. */
export function addFriend(data, user) {
  if (!user || user.id == null) return data;
  const u = clean(user);
  const existing = data.friends.find((f) => same(f.id, u.id));
  const friends = existing ? data.friends.map((f) => (same(f.id, u.id) ? { ...u, ...existing, ...stripEmpty(u) } : f)) : [...data.friends, u];
  return { friends: sortFriends(friends), incoming: without(data.incoming, u.id), outgoing: without(data.outgoing, u.id) };
}

function stripEmpty(u) {
  const o = {};
  for (const [k, v] of Object.entries(u)) {
    if (v === '' || v == null) continue;
    if (k === 'equipped' && !Object.keys(v).length) continue;
    o[k] = v;
  }
  return o;
}

/** Optimistic accept: move the incoming request into friends. */
export function acceptLocal(data, userId) {
  const u = data.incoming.find((x) => same(x.id, userId));
  return u ? addFriend(data, u) : data;
}

export function removeIncoming(data, userId) {
  return { ...data, incoming: without(data.incoming, userId) };
}

export function removeOutgoing(data, userId) {
  return { ...data, outgoing: without(data.outgoing, userId) };
}

export function removeFriend(data, userId) {
  return { ...data, friends: without(data.friends, userId) };
}

/** A live `friend_request` event: add to incoming unless we already know them. */
export function addIncoming(data, from) {
  if (!from || from.id == null) return data;
  if (data.friends.some((f) => same(f.id, from.id)) || data.incoming.some((f) => same(f.id, from.id))) return data;
  return { ...data, incoming: [...data.incoming, clean({ ...from, online: true })] };
}

export const countOnline = (data) => data.friends.filter((f) => f.online).length;
export const isEmpty = (data) => !data.friends.length && !data.incoming.length && !data.outgoing.length;

// ---------------------------------------------------------------- cosmetics on a person

/** `{ frame, title }` catalogue items (or null) for anyone with an `equipped` object. */
export function cosmeticsOf(person) {
  const eq = cleanEquipped(person && person.equipped);
  return { frame: eq.frame ? cosmeticById(eq.frame) : null, title: eq.title ? cosmeticById(eq.title) : null };
}

// ---------------------------------------------------------------- invites inbox

/** Invites older than this are gone server-side too (GET /api/invites returns < 2 h). */
export const INVITE_TTL_MS = 2 * 60 * 60 * 1000;

function toMs(v) {
  if (Number.isFinite(v)) return v < 1e12 ? v * 1000 : v; // seconds or ms
  if (typeof v === 'string' && v) {
    const n = Date.parse(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Dedupe key: one entry per (room, sender). */
export const inviteKey = (inv) => `${inv && inv.code ? inv.code : ''}:${inv && inv.from && inv.from.id != null ? inv.from.id : ''}`;

/**
 * A stored invite (GET /api/invites row) or a realtime `{t:'invite', from, code, gameId, gameName}` message ->
 * `{ key, id|null, from:{id,name,avatar}, code, gameId, gameName, createdAt (ms), live }`, or null when unusable.
 */
export function normalizeInvite(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || typeof raw.code !== 'string' || !raw.code) return null;
  const f = raw.from && typeof raw.from === 'object' ? raw.from : {};
  const inv = {
    id: raw.id != null && raw.id !== '' ? String(raw.id) : null,
    from: { id: f.id != null ? f.id : null, name: typeof f.name === 'string' && f.name ? f.name : 'A friend', avatar: Number.isInteger(f.avatar) ? f.avatar : 0 },
    code: raw.code,
    gameId: typeof raw.gameId === 'string' ? raw.gameId : null,
    gameName: typeof raw.gameName === 'string' && raw.gameName ? raw.gameName : null,
    createdAt: toMs(raw.createdAt) ?? now,
    live: raw.id == null || raw.t === 'invite',
  };
  inv.key = inviteKey(inv);
  return inv;
}

/** Newest first; one per key (a stored copy wins over a live one, but keeps the newest time). Drops stale ones. */
export function mergeInvites(...lists) {
  const now = typeof lists[lists.length - 1] === 'number' ? lists.pop() : Date.now();
  const byKey = new Map();
  for (const list of lists) {
    for (const inv of Array.isArray(list) ? list : []) {
      if (!inv || !inv.key) continue;
      const prev = byKey.get(inv.key);
      if (!prev) {
        byKey.set(inv.key, inv);
        continue;
      }
      const stored = prev.id ? prev : inv.id ? inv : prev;
      const other = stored === prev ? inv : prev;
      byKey.set(inv.key, { ...other, ...stored, createdAt: Math.max(prev.createdAt, inv.createdAt), live: !stored.id });
    }
  }
  return [...byKey.values()].filter((i) => now - i.createdAt < INVITE_TTL_MS).sort((a, b) => b.createdAt - a.createdAt);
}

/** Remove one invite (by key) from a list. */
export const dropInvite = (list, key) => (Array.isArray(list) ? list.filter((i) => i.key !== key) : []);

/** "just now", "4 min ago", "1 h ago", "yesterday", "3 d ago". */
export function relativeTime(ts, now = Date.now()) {
  const t = toMs(ts);
  if (t == null) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} d ago`;
}

/**
 * Honest feedback after POST /api/invites (`{ ok, delivered }`): delivered = their app got it right now;
 * otherwise the server kept it and they will find it in their inbox later.
 */
export function inviteFeedback(res, name) {
  const who = name || 'your friend';
  if (res && res.delivered === false) return { text: "Invite saved — they'll see it when they're back", tone: 'info', state: 'saved' };
  return { text: `Invite sent to ${who}`, tone: 'good', state: 'sent' };
}

/** Online friends first (already sorted), then offline: `{ online, offline }`. */
export function groupFriends(friends) {
  const list = Array.isArray(friends) ? friends : [];
  return { online: list.filter((f) => f.online), offline: list.filter((f) => !f.online) };
}

/** Milliseconds an invite stays valid from `createdAt` (negative = already gone). */
export function inviteExpiresInMs(createdAt, now = Date.now()) {
  const t = toMs(createdAt);
  return t == null ? null : INVITE_TTL_MS - (now - t);
}

/** "expires in 1 h 40 min", "expires in 12 min", "expiring now"; '' when the time is unknown. */
export function inviteExpiryLabel(createdAt, now = Date.now()) {
  const left = inviteExpiresInMs(createdAt, now);
  if (left == null) return '';
  const min = Math.floor(left / 60000);
  if (min < 1) return 'expiring now';
  if (min < 60) return `expires in ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `expires in ${h} h ${m} min` : `expires in ${h} h`;
}

// ---------------------------------------------------------------- enter / exit lists

/**
 * Re-insert items that are animating out (`gone`: Map key -> { item, index }) into the live list, near where they were.
 * Returns [{ key, item, leaving }].
 */
export function withLeaving(items, gone, keyOf) {
  const out = (items || []).map((item) => ({ key: keyOf(item), item, leaving: false }));
  if (!gone || !gone.size) return out;
  const live = new Set(out.map((x) => x.key));
  const extra = [...gone.entries()].filter(([k]) => !live.has(k)).sort((a, b) => a[1].index - b[1].index);
  for (const [key, { item, index }] of extra) out.splice(Math.min(index, out.length), 0, { key, item, leaving: true });
  return out;
}
