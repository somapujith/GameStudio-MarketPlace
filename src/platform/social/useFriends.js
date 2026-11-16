// State and actions of the Friends page: the list from GET /api/friends, optimistic accept / decline / cancel / remove
// that roll back on failure, live updates from the user socket, and "invite to room" feedback. Pure transitions live in
// components/online/friendsModel.js (unit-tested).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, sendInvite } from '@/lib/api.js';
import { useUserEvents } from '@/lib/auth.jsx';
import { publishFriends } from './friendStore.js';
import {
  acceptLocal,
  addFriend,
  addIncoming,
  applyPresence,
  applyRemoved,
  emptyFriends,
  inviteEventResult,
  inviteFeedback,
  normalizeFriends,
  removeFriend,
  removeIncoming,
  removeOutgoing,
} from '@/components/online/friendsModel.js';

/**
 * `{ data, loadError, load, busy, accept, decline, cancel, remove, invited, inviteTo }`.
 * `data` is null until the first answer; `loadError` is `{ message, offline }` or null. `push(text, tone)` shows a toast.
 */
export default function useFriends({ push }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState({});
  const [invited, setInvited] = useState({}); // `${friendId}:${code}` -> 'sending' | 'sent' | 'saved'
  const dataRef = useRef(null);
  useEffect(() => {
    dataRef.current = data;
  });
  useEffect(() => {
    publishFriends(data); // the shared store (add-friend buttons, panel) reads the same truth
  }, [data]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadError(null);
    try {
      const raw = await api.get('/api/friends');
      setData(normalizeFriends(raw));
      setLoadError(null);
    } catch (e) {
      if (!silent) setLoadError({ message: errorMessage(e, 'Could not load your friends'), offline: !!e && e.status === 0 });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // refresh quietly when the tab regains focus or the network returns (requests may have arrived while away)
  useEffect(() => {
    const onFocus = () => load({ silent: true });
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [load]);

  useUserEvents(
    (msg) => {
      if (msg.t === 'presence') setData((d) => (d ? applyPresence(d, msg.userId, msg.online, msg) : d));
      else if (msg.t === 'friend_request') {
        setData((d) => addIncoming(d || emptyFriends(), msg.from));
        load({ silent: true });
      } else if (msg.t === 'friend_accepted') {
        setData((d) => addFriend(d || emptyFriends(), { ...msg.by, online: true }));
        if (msg.by && msg.by.name) push(`${msg.by.name} accepted your request`, 'good');
        load({ silent: true });
      } else if (msg.t === 'friend_removed') {
        setData((d) => (d ? applyRemoved(d, msg.by) : d));
      } else if (msg.t === 'invite_joined' || msg.t === 'invite_declined') {
        // answers to the invites I sent from this page: the row says "Joined" / "Declined" and a toast tells me
        const res = inviteEventResult(msg, msg.code);
        if (res) {
          setInvited((s) => ({ ...s, [`${res.id}:${msg.code}`]: res.state }));
          push(res.text, res.tone);
        }
      }
    },
    ['presence', 'friend_request', 'friend_accepted', 'friend_removed', 'invite_joined', 'invite_declined'],
  );

  /** Optimistic update + request; rolls back and resyncs on failure. */
  const mutate = useCallback(
    async (userId, optimistic, request, { success, failure }) => {
      const prev = dataRef.current;
      setBusy((b) => ({ ...b, [userId]: true }));
      if (optimistic) setData((d) => (d ? optimistic(d) : d));
      try {
        await request();
        if (success) push(success, 'good');
        load({ silent: true });
      } catch (e) {
        setData(prev);
        push(errorMessage(e, failure), 'bad');
        load({ silent: true });
      } finally {
        setBusy((b) => {
          const n = { ...b };
          delete n[userId];
          return n;
        });
      }
    },
    [load, push],
  );

  const accept = (u) =>
    mutate(u.id, (d) => acceptLocal(d, u.id), () => api.post('/api/friends/accept', { userId: u.id }), {
      success: `You and ${u.name} are friends now`,
      failure: 'Could not accept the request',
    });
  const decline = (u) =>
    mutate(u.id, (d) => removeIncoming(d, u.id), () => api.post('/api/friends/decline', { userId: u.id }), { failure: 'Could not decline the request' });
  const cancel = (u) =>
    mutate(u.id, (d) => removeOutgoing(d, u.id), () => api.del(`/api/friends/${encodeURIComponent(u.id)}`), {
      success: 'Request cancelled',
      failure: 'Could not cancel the request',
    });
  const remove = (u) =>
    mutate(u.id, (d) => removeFriend(d, u.id), () => api.del(`/api/friends/${encodeURIComponent(u.id)}`), {
      success: `${u.name} removed`,
      failure: 'Could not remove this friend',
    });

  /** Invite a friend (online or not) to room `roomCode`; honest feedback about delivery. */
  const inviteTo = async (u, roomCode) => {
    const k = `${u.id}:${roomCode}`;
    setInvited((s) => ({ ...s, [k]: 'sending' }));
    try {
      const fb = inviteFeedback(await sendInvite(roomCode, u.id), u.name);
      setInvited((s) => ({ ...s, [k]: fb.state }));
      push(fb.text, fb.tone);
    } catch (e) {
      setInvited((s) => ({ ...s, [k]: undefined }));
      push(errorMessage(e, 'Could not send the invite'), 'bad');
    }
  };

  return { data, loadError, load, busy, accept, decline, cancel, remove, invited, inviteTo };
}
