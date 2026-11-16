import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { FriendAvatar } from '@/components/online/InviteFriends.jsx';
import { loadBlocks, unblockPlayer, useBlocks } from './blockStore.js';
import '@/styles/block.css';

/**
 * Friends page "Privacy" card: who may send me friend requests (everyone / nobody) and the blocked-players list with
 * Unblock. Members only (renders nothing for guests and signed-out visitors).
 * Props: { onNotify?(message, tone) }. The request setting is `user.friendRequests` and is saved with
 * `updateProfile({ friendRequests })` from useAuth(); the list comes from the shared blockStore.
 */
export default function PrivacyCard({ onNotify }) {
  const { user, updateProfile } = useAuth();
  const member = !!user && !user.isGuest;
  const { list, status } = useBlocks({ enabled: member });
  const [saving, setSaving] = useState(null); // null | 'everyone' | 'nobody' (the value being saved)
  const [busyId, setBusyId] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (!member) return null;

  const current = user.friendRequests === 'nobody' ? 'nobody' : 'everyone';
  const shown = saving || current; // the switch follows the tap at once, then the saved value
  const anyone = shown === 'everyone';

  const toggle = async () => {
    if (saving) return;
    const next = anyone ? 'nobody' : 'everyone';
    setSaving(next);
    try {
      await updateProfile({ friendRequests: next });
      onNotify?.(next === 'nobody' ? 'Friend requests are off' : 'Anyone can send you friend requests', 'good');
    } catch (e) {
      onNotify?.(errorMessage(e, 'Could not save that setting'), 'bad');
    } finally {
      if (alive.current) setSaving(null);
    }
  };

  const unblock = async (p) => {
    if (busyId) return;
    setBusyId(p.id);
    try {
      await unblockPlayer(p.id);
      onNotify?.(`${p.name} is unblocked`, 'good');
    } catch (e) {
      onNotify?.(errorMessage(e, `Could not unblock ${p.name}`), 'bad');
    } finally {
      if (alive.current) setBusyId('');
    }
  };

  return (
    <section className="sc-card bl-card" aria-labelledby="bl-title">
      <div className="sc-card__head">
        <h2 id="bl-title" className="sc-card__title">
          Privacy
        </h2>
        {list.length > 0 && <span className="sc-count">{list.length}</span>}
      </div>

      <div className="bl-setting">
        <span className="bl-setting__text">
          <span id="bl-req-label" className="bl-setting__label">
            Let anyone send me friend requests
          </span>
          <span id="bl-req-hint" className="bl-setting__hint">
            {anyone ? 'Anyone with your name or friend code can ask.' : 'Turned off: new requests are refused. Friends you already have are not affected.'}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={anyone}
          aria-labelledby="bl-req-label"
          aria-describedby="bl-req-hint"
          className={`bl-switch${anyone ? ' is-on' : ''}`}
          onClick={toggle}
          disabled={!!saving}
        >
          <span className="bl-switch__knob" aria-hidden="true" />
        </button>
      </div>

      <h3 className="bl-sub" id="bl-blocked-h">
        Blocked players
      </h3>
      {status === 'error' && list.length === 0 ? (
        <p className="bl-note" role="status">
          Could not load your blocked players.{' '}
          <button type="button" className="bl-link" onClick={() => loadBlocks({ force: true })}>
            Try again
          </button>
        </p>
      ) : status !== 'ready' && list.length === 0 ? (
        <p className="bl-note" role="status" aria-busy="true">
          Loading...
        </p>
      ) : list.length === 0 ? (
        <p className="bl-note">No one is blocked. Blocked players cannot send you requests or invites, and their chat and voice lines are hidden in rooms.</p>
      ) : (
        <ul className="bl-list" aria-labelledby="bl-blocked-h">
          {list.map((p) => (
            <li key={p.id} className="bl-row">
              <span className="bl-row__avatar">
                <FriendAvatar person={p} size={40} />
              </span>
              <span className="bl-row__name">{p.name}</span>
              <button type="button" className="hub-btn hub-btn--ghost hub-btn--sm" onClick={() => unblock(p)} disabled={busyId === p.id} aria-label={`Unblock ${p.name}`}>
                {busyId === p.id ? 'Unblocking...' : 'Unblock'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
