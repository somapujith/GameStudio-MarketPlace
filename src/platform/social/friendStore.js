// One shared, module-level friends store for anything that only needs to know "is this person my friend?":
// the lobby seats (6 AddFriendButtons), the add-friend panel's result rows, the Friends page. One GET /api/friends no
// matter how many components subscribe; live updates from the user socket are wired once (ref-counted) while at least
// one component is mounted. Pure transitions live in components/online/friendsModel.js (unit-tested).
import { useEffect, useSyncExternalStore } from 'react';
import { api } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { addFriend, addIncoming, applyPresence, applyRemoved, emptyFriends, normalizeFriends, relationOf } from '@/components/online/friendsModel.js';

let state = { data: null, status: 'idle' }; // status: idle | loading | ready | error
const listeners = new Set();
let inflight = null;
let users = 0; // mounted hook users
let unsubscribe = null;
let owner = null; // user id the cached data belongs to

const emit = () => listeners.forEach((l) => l());
const set = (next) => {
  state = { ...state, ...next };
  emit();
};

/** The current snapshot `{ data|null, status }` (stable between changes). */
export const getFriendState = () => state;

/** Fetch GET /api/friends once (shared promise). `force` refetches even when loaded; failures keep the old data. */
export function loadFriends({ force = false } = {}) {
  if (inflight) return inflight;
  if (!force && state.data) return Promise.resolve(state.data);
  if (!state.data) set({ status: 'loading' });
  inflight = api
    .get('/api/friends')
    .then((raw) => {
      set({ data: normalizeFriends(raw), status: 'ready' });
      return state.data;
    })
    .catch(() => {
      set({ status: state.data ? 'ready' : 'error' });
      return state.data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Another owner of the same data (the Friends page) hands its latest copy over so nobody refetches. */
export function publishFriends(data) {
  if (data && data !== state.data) set({ data, status: 'ready' });
}

/** Local optimistic updates: `updateFriends((d) => addOutgoing(d, person))`. Starts from an empty list when nothing loaded. */
export function updateFriends(fn) {
  set({ data: fn(state.data || emptyFriends()), status: state.data ? state.status : 'ready' });
}

/** Test / sign-out helper: forget everything. */
export function resetFriendStore() {
  state = { data: null, status: 'idle' };
  inflight = null;
  emit();
}

/** Socket messages that change who my friends are. */
export function handleFriendEvent(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'presence') updateIfLoaded((d) => applyPresence(d, msg.userId, msg.online, msg));
  else if (msg.t === 'friend_request') {
    updateFriends((d) => addIncoming(d, msg.from));
    loadFriends({ force: true });
  } else if (msg.t === 'friend_accepted') {
    updateFriends((d) => addFriend(d, { ...msg.by, online: true }));
    loadFriends({ force: true });
  } else if (msg.t === 'friend_removed') updateIfLoaded((d) => applyRemoved(d, msg.by));
}

function updateIfLoaded(fn) {
  if (state.data) set({ data: fn(state.data) });
}

const subscribeStore = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * `{ data, status, relationOf(userId) }`: loads the list on first use (members only) and keeps it live while mounted.
 * Pass `enabled: false` for guests / signed-out users so nothing is fetched.
 */
export function useFriendStore({ enabled = true } = {}) {
  const { subscribe, user } = useAuth();
  const uid = user && !user.isGuest ? String(user.id) : null;

  // a different account signed in: never show the previous person's friends
  if (uid && owner !== uid) {
    if (owner !== null) {
      state = { data: null, status: 'idle' };
      inflight = null;
    }
    owner = uid;
  }
  const snap = useSyncExternalStore(subscribeStore, getFriendState, getFriendState);

  useEffect(() => {
    if (!enabled) return undefined;
    users += 1;
    if (users === 1 && typeof subscribe === 'function') {
      unsubscribe = subscribe(['presence', 'friend_request', 'friend_accepted', 'friend_removed'], handleFriendEvent);
    }
    return () => {
      users -= 1;
      if (users <= 0) {
        users = 0;
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
      }
    };
  }, [enabled, subscribe]);

  useEffect(() => {
    if (enabled && uid && getFriendState().status === 'idle') loadFriends();
  }, [enabled, uid]);

  return { data: snap.data, status: snap.status, relationOf: (id) => relationOf(snap.data, id) };
}
