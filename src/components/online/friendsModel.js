// Pure state transitions for the Friends page (optimistic updates + live socket events) and the invites inbox. Unit-tested.
// data = { friends: [...], incoming: [...], outgoing: [...] },
// each entry { id, name, avatar, friendCode, online, status, code?, gameId?, level, equipped: { frame?, dice?, trail?, board?, title? } }
// (`status`: 'offline' | 'online' | 'lobby' | 'playing'; `code` only for an open lobby you can join; `gameId` in a room).
import { cleanEquipped, cosmeticById } from '@shared/cosmetics.js';
import { parseFriendLink } from './codes.js';

const same = (a, b) => a != null && b != null && String(a) === String(b);
const without = (list, id) => list.filter((x) => !same(x.id, id));

export const emptyFriends = () => ({ friends: [], incoming: [], outgoing: [] });

const STATUSES = ['offline', 'online', 'lobby', 'playing'];
const CODE_RE = /^[A-Za-z0-9]{4,10}$/;

/**
 * `{ online, status, code?, gameId? }` from any payload carrying `online` and optionally the richer fields. Old servers
 * send only `online`; an unknown status, an offline user or a junk code never produce a room.
 */
export function presenceOf(p) {
  const online = !!(p && p.online);
  if (!online) return { online: false, status: 'offline' };
  const st = p && STATUSES.includes(p.status) && p.status !== 'offline' ? p.status : 'online';
  const out = { online: true, status: st };
  if (st === 'lobby' && typeof p.code === 'string' && CODE_RE.test(p.code)) out.code = p.code;
  if ((st === 'lobby' || st === 'playing') && typeof p.gameId === 'string' && p.gameId) out.gameId = p.gameId;
  if (st === 'lobby' && !out.code) out.status = 'online'; // a lobby without a code is not joinable, nothing to show
  return out;
}

const clean = (u) => ({
  id: u.id,
  name: typeof u.name === 'string' && u.name ? u.name : 'Player',
  avatar: Number.isInteger(u.avatar) ? u.avatar : 0,
  friendCode: u.friendCode || '',
  handle: parseHandle(u.handle) || null,
  ...presenceOf(u),
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

const PRESENCE_KEYS = ['online', 'status', 'code', 'gameId'];
const samePresence = (a, b) => PRESENCE_KEYS.every((k) => a[k] === b[k]);

/**
 * A live `presence` message for friend `userId`. `extra` is `{ status, code, gameId }` from the message (omit it for an
 * old-style `{userId, online}` push). Returns the SAME object when nothing changed.
 */
export function applyPresence(data, userId, online, extra) {
  if (!data.friends.some((f) => same(f.id, userId))) return data;
  const next = presenceOf({ ...extra, online });
  let changed = false;
  const friends = data.friends.map((f) => {
    if (!same(f.id, userId)) return f;
    const { code, gameId, ...rest } = f;
    const merged = { ...rest, ...next };
    if (samePresence(f, merged)) return f;
    changed = true;
    return merged;
  });
  return changed ? { ...data, friends: sortFriends(friends) } : data;
}

/** The text and join target of a friend's presence: `{ text, tone, code|null }` (tone: 'off' | 'on' | 'lobby' | 'play'). */
export function statusLine(f, nameOf = (id) => id) {
  const p = presenceOf(f || {});
  if (p.status === 'lobby') return { text: 'In a lobby', tone: 'lobby', code: p.code || null };
  if (p.status === 'playing') return { text: p.gameId ? `Playing ${nameOf(p.gameId)}` : 'Playing', tone: 'play', code: null };
  if (p.status === 'online') return { text: 'Online', tone: 'on', code: null };
  return { text: 'Offline', tone: 'off', code: null };
}

/** `invite_joined` / `invite_declined` for room `code` -> `{ id, state:'joined'|'declined', name, text, tone }`, else null. */
export function inviteEventResult(msg, code) {
  if (!msg || (msg.t !== 'invite_joined' && msg.t !== 'invite_declined')) return null;
  if (!msg.by || msg.by.id == null || !code || msg.code !== code) return null;
  const name = typeof msg.by.name === 'string' && msg.by.name ? msg.by.name : 'Your friend';
  return msg.t === 'invite_joined'
    ? { id: msg.by.id, state: 'joined', name, text: `${name} joined your table`, tone: 'good' }
    : { id: msg.by.id, state: 'declined', name, text: `${name} declined your invite`, tone: 'info' };
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

/** A live `friend_removed` event (`by` is an id or `{ id }`): they are no longer a friend, nor pending either way. */
export function applyRemoved(data, by) {
  const id = by && typeof by === 'object' ? by.id : by;
  if (id == null || id === '') return data;
  if (!data.friends.some((f) => same(f.id, id)) && !data.incoming.some((f) => same(f.id, id)) && !data.outgoing.some((f) => same(f.id, id))) return data;
  return { friends: without(data.friends, id), incoming: without(data.incoming, id), outgoing: without(data.outgoing, id) };
}

/** Optimistic "I sent a request to `user`": add to outgoing unless we already know them. */
export function addOutgoing(data, user) {
  if (!user || user.id == null) return data;
  if ([...data.friends, ...data.outgoing].some((f) => same(f.id, user.id))) return data;
  return { ...data, outgoing: [...data.outgoing, clean(user)] };
}

/** How `data` knows `userId`: 'friends' | 'outgoing' | 'incoming' | 'none'. */
export function relationOf(data, userId) {
  if (!data || userId == null) return 'none';
  if (data.friends.some((f) => same(f.id, userId))) return 'friends';
  if (data.outgoing.some((f) => same(f.id, userId))) return 'outgoing';
  if (data.incoming.some((f) => same(f.id, userId))) return 'incoming';
  return 'none';
}

const RELATIONS = ['none', 'friends', 'outgoing', 'incoming'];

/**
 * Search / recent rows from the server -> well-formed people with a `relation`. Local friend data (when loaded) wins over the
 * server's relation because it is fresher (a request sent a second ago, a friend just removed). `selfId` and junk are dropped.
 */
export function mergeRelations(players, local, selfId) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(players) ? players : []) {
    if (!p || p.id == null || same(p.id, selfId) || seen.has(String(p.id))) continue;
    seen.add(String(p.id));
    const served = RELATIONS.includes(p.relation) ? p.relation : 'none';
    const mine = local ? relationOf(local, p.id) : 'none';
    out.push({ ...clean(p), relation: mine !== 'none' || local ? mine : served });
  }
  return out;
}

export const countOnline = (data) => data.friends.filter((f) => f.online).length;
export const isEmpty = (data) => !data.friends.length && !data.incoming.length && !data.outgoing.length;

// ---------------------------------------------------------------- cosmetics on a person

/** `{ frame, title, dice, trail, board }` catalogue items (or null each) for anyone with an `equipped` object. */
export function cosmeticsOf(person) {
  const eq = cleanEquipped(person && person.equipped);
  const item = (kind) => (eq[kind] ? cosmeticById(eq[kind]) : null);
  return { frame: item('frame'), title: item('title'), dice: item('dice'), trail: item('trail'), board: item('board') };
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

// ---------------------------------------------------------------- usernames (@handles)

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;
export const HANDLE_COOLDOWN_DAYS = 7;
export const HANDLE_RULES = `${HANDLE_MIN}-${HANDLE_MAX} characters: letters, numbers and single underscores, starting with a letter.`;

/** A typed username -> the lowercase handle (no "@"), or '' when it does not have the shape of one. Reserved words are the server's call. */
export function parseHandle(raw) {
  if (typeof raw !== 'string') return '';
  const h = raw.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z][a-z0-9_]{2,19}$/.test(h) && !h.includes('__') ? h : '';
}

/** "@teja" for display ('' when there is none), so rows never print "@null". */
export const handleLabel = (person) => {
  const h = person && parseHandle(person.handle);
  return h ? `@${h}` : '';
};

/**
 * What a person typed into "add by code": a friend code / friend link, or an "@username".
 * -> { kind: 'code' | 'handle', value } (code as HYD-XXXX, handle lowercase without "@") or { kind: 'invalid', value: '' }.
 * A username needs its "@" so a half-typed code is never mistaken for one.
 */
export function parseFriendInput(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s.startsWith('@')) {
    const value = parseHandle(s);
    return value ? { kind: 'handle', value } : { kind: 'invalid', value: '' };
  }
  const code = parseFriendLink(s);
  return code ? { kind: 'code', value: code } : { kind: 'invalid', value: '' };
}

/** Whole days (rounded up) until a claimed username may be changed again (the server allows one change per week); 0 when allowed. */
export function handleCooldownLeft(user, now = Date.now()) {
  if (!user || !user.handle || !user.handleChangedAt) return 0;
  const t = Date.parse(user.handleChangedAt);
  if (!Number.isFinite(t)) return 0;
  const left = t + HANDLE_COOLDOWN_DAYS * 86_400_000 - now;
  return left > 0 ? Math.ceil(left / 86_400_000) : 0;
}

/**
 * The state of the Username field: 'idle' | 'checking' | 'available' | 'taken' | 'invalid'.
 * `value` is what is typed, `current` the saved handle, `remote` the last server answer for `value`
 * ({ value, available, reason } or null while it is still being asked).
 */
export function handleStatus(value, current, remote) {
  const v = typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
  if (!v || v === (current || '')) return 'idle';
  if (!parseHandle(v)) return 'invalid';
  if (!remote || remote.value !== v) return 'checking';
  if (remote.available) return 'available';
  return remote.reason === 'taken' ? 'taken' : 'invalid';
}
