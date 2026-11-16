import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, requestFriendById } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { addFriend, addOutgoing, removeOutgoing } from '@/components/online/friendsModel.js';
import { updateFriends, useFriendStore } from './friendStore.js';
import SIcon from './SIcon.jsx';
import '@/styles/social-add.css';

/**
 * "Add friend" action for a person you can see (a seat in the lobby, a search result, a recent player).
 *
 * Props: { userId, name, compact?, onSent? }  (`compact` = icon-only with an aria-label, for tight spots like a seat;
 * `onSent(status)` fires after the server accepted the request: status is 'pending' or 'accepted').
 * Renders nothing for yourself, guests, signed-out visitors and people who are already friends. Otherwise one button:
 * "Add friend" -> optimistic "Requested" (or "Friends" when the server auto-accepted a mutual request); on error a short
 * message appears next to it and the button is ready to retry. Friend state comes from the shared friendStore, so six of
 * these in the lobby cost one GET /api/friends in total and follow friend_request / friend_accepted / friend_removed live.
 */
export default function AddFriendButton({ userId, name, compact = false, onSent }) {
  const { user } = useAuth();
  const member = !!user && !user.isGuest;
  const self = member && userId != null && String(user.id) === String(userId);
  const active = member && !self && userId != null && userId !== '';
  const { data, status, relationOf } = useFriendStore({ enabled: active });
  const [done, setDone] = useState(null); // null | 'pending' | 'accepted' (this session, before the store catches up)
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const timer = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const who = name || 'this player';
  const send = useCallback(async () => {
    if (sending) return;
    const rel = relationOf(userId);
    const person = { id: userId, name: name || 'Player' };
    clearTimeout(timer.current);
    setError('');
    setSending(true);
    if (rel === 'none') updateFriends((d) => addOutgoing(d, person));
    try {
      const res = await requestFriendById(userId);
      const accepted = !!res && res.status === 'accepted';
      updateFriends((d) => (accepted ? addFriend(d, { ...person, ...(res.friend || {}), online: true }) : d));
      if (alive.current) setDone(accepted ? 'accepted' : 'pending');
      onSent?.(accepted ? 'accepted' : 'pending');
    } catch (e) {
      if (rel === 'none') updateFriends((d) => removeOutgoing(d, userId));
      if (alive.current) {
        setError(errorMessage(e, 'Could not send the request'));
        timer.current = setTimeout(() => alive.current && setError(''), 6000);
      }
    } finally {
      if (alive.current) setSending(false);
    }
  }, [sending, relationOf, userId, name, onSent]);

  if (!active) return null;
  // do not flash a button for someone who turns out to be a friend: wait for the first answer
  if (!data && (status === 'idle' || status === 'loading')) return null;

  const rel = relationOf(userId);
  if (done === 'accepted') {
    return (
      <span className={`fa-add${compact ? ' fa-add--compact' : ''}`}>
        <span className={`fa-chip fa-chip--good${compact ? ' fa-chip--icon' : ''}`} title={compact ? 'Friends' : undefined}>
          <SIcon name="check" size={15} />
          {compact ? <span className="fa-sr">{`Friends with ${who}`}</span> : 'Friends'}
        </span>
        <span className="fa-sr" role="status">{`You and ${who} are friends now`}</span>
      </span>
    );
  }
  if (rel === 'friends') return null;

  const requested = rel === 'outgoing' || done === 'pending';
  const incoming = rel === 'incoming' && !requested;
  const label = requested ? 'Requested' : incoming ? 'Accept' : 'Add friend';
  const aria = requested ? `Friend request to ${who} sent` : incoming ? `Accept friend request from ${who}` : `Add ${who} as a friend`;

  return (
    <span className={`fa-add${compact ? ' fa-add--compact' : ''}`}>
      <button
        type="button"
        className={`hub-btn hub-btn--sm fa-btn ${requested ? 'hub-btn--ghost is-done' : 'hub-btn--soft'}${compact ? ' fa-btn--icon' : ''}`}
        onClick={send}
        disabled={requested || sending}
        aria-label={compact ? aria : `${label}, ${who}`}
        aria-busy={sending || undefined}
        aria-describedby={error ? `fa-err-${userId}` : undefined}
        title={compact ? label : undefined}
      >
        <SIcon name={requested ? 'check' : 'userPlus'} size={compact ? 18 : 16} />
        {!compact && label}
      </button>
      <span className="fa-sr" role="status">
        {done === 'pending' ? `Friend request sent to ${who}` : ''}
      </span>
      {error && (
        <span id={`fa-err-${userId}`} className="fa-bubble" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
