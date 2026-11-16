// One shared, module-level block list for the signed-in member: the Friends page's "Blocked players" card, the Block
// action in the friend sheet and the in-room mute (useRoomConnection drops chat / voice lines from blocked players).
// One GET /api/blocks however many components subscribe. The pure helpers (isMutedFrom, filterMuted) are unit-tested.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getBlocks, blockUser, unblockUser } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { handleFriendEvent } from './friendStore.js';

const EMPTY_IDS = new Set();
const EMPTY = { list: [], ids: EMPTY_IDS, status: 'idle' }; // status: idle | loading | ready | error

let state = EMPTY;
const listeners = new Set();
let inflight = null;
let owner = null; // user id the cached list belongs to

const emit = () => listeners.forEach((l) => l());
const set = (next) => {
  state = { ...state, ...next };
  emit();
};

const sid = (v) => (v == null ? '' : String(v));

/** `{ id, name, avatar }` with a string id, or null for junk. */
export function normalizePerson(p) {
  if (!p || typeof p !== 'object' || p.id == null || p.id === '') return null;
  return { id: sid(p.id), name: typeof p.name === 'string' && p.name ? p.name : 'Player', avatar: Number.isInteger(p.avatar) ? p.avatar : 0 };
}

/** GET /api/blocks body -> `{ list, ids }` (junk rows dropped, duplicates collapsed). */
export function normalizeBlocks(raw) {
  const list = [];
  const ids = new Set();
  for (const r of raw && Array.isArray(raw.blocked) ? raw.blocked : []) {
    const p = normalizePerson(r);
    if (p && !ids.has(p.id)) {
      ids.add(p.id);
      list.push(p);
    }
  }
  return { list, ids };
}

/** Is `from` (a user id as sent in a room chat / voice message) on the blocked set? Never true for missing ids. */
export function isMutedFrom(from, ids) {
  if (!ids || !ids.size || from == null || from === '') return false;
  return ids.has(sid(from));
}

/**
 * Chat / voice history without the lines sent by blocked players. Returns the SAME array when nothing is hidden, so
 * a memo keyed on it does not churn. Lines without a `from` (system lines) are always kept.
 */
export function filterMuted(entries, ids) {
  if (!Array.isArray(entries) || !ids || !ids.size) return entries;
  const kept = entries.filter((e) => !(e && isMutedFrom(e.from, ids)));
  return kept.length === entries.length ? entries : kept;
}

/** The current snapshot `{ list, ids, status }` (stable between changes). */
export const getBlockState = () => state;
/** Synchronous check for non-React code (the socket handler). */
export const isBlocked = (id) => isMutedFrom(id, state.ids);

/** Fetch GET /api/blocks once (shared promise). A failure keeps what we had (and mutes nothing new). */
export function loadBlocks({ force = false } = {}) {
  if (inflight) return inflight;
  if (!force && state.status === 'ready') return Promise.resolve(state);
  if (state.status !== 'ready') set({ status: 'loading' });
  inflight = getBlocks()
    .then((raw) => {
      set({ ...normalizeBlocks(raw), status: 'ready' });
      return state;
    })
    .catch(() => {
      set({ status: state.status === 'ready' ? 'ready' : 'error' });
      return state;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Block `person` ({ id, name?, avatar? }): optimistic (they are muted at once), rolled back and rethrown when the server
 * says no. The server also ends any friendship, so the friend store forgets them too.
 */
export async function blockPlayer(person) {
  const p = normalizePerson(person);
  if (!p) throw new Error('Invalid player');
  const before = state;
  if (!state.ids.has(p.id)) set({ list: [p, ...state.list], ids: new Set([...state.ids, p.id]) });
  try {
    const res = await blockUser(p.id);
    const server = normalizePerson(res && res.blocked);
    if (server) set({ list: state.list.map((x) => (x.id === p.id ? server : x)) });
    handleFriendEvent({ t: 'friend_removed', by: { id: p.id } });
    return true;
  } catch (e) {
    set({ list: before.list, ids: before.ids });
    throw e;
  }
}

/** Unblock `id` (optimistic, rolled back on error). */
export async function unblockPlayer(id) {
  const key = sid(id);
  const before = state;
  if (state.ids.has(key)) {
    const ids = new Set(state.ids);
    ids.delete(key);
    set({ list: state.list.filter((p) => p.id !== key), ids });
  }
  try {
    await unblockUser(key);
    return true;
  } catch (e) {
    set({ list: before.list, ids: before.ids });
    throw e;
  }
}

/** Test / sign-out helper: forget everything. */
export function resetBlockStore() {
  state = EMPTY;
  inflight = null;
  owner = null;
  emit();
}

const subscribeStore = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * `{ list, ids, status }`: loads the list on first use (members only) and re-renders when it changes. Pass
 * `enabled: false` for guests / signed-out users so nothing is fetched. A different account signing in clears the cache.
 */
export function useBlocks({ enabled = true } = {}) {
  const { user } = useAuth();
  const uid = user && !user.isGuest ? String(user.id) : null;
  if (uid && owner !== uid) {
    if (owner !== null) {
      state = EMPTY;
      inflight = null;
    }
    owner = uid;
  }
  const snap = useSyncExternalStore(subscribeStore, getBlockState, getBlockState);
  const active = enabled && !!uid;
  useEffect(() => {
    if (active) loadBlocks();
  }, [active, uid]);
  return useMemo(() => (active ? snap : EMPTY), [active, snap]);
}
