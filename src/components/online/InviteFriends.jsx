import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/art/index.js';
import { api, errorMessage, sendInvite } from '@/lib/api.js';
import { useUserEvents } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { applyPresence, cosmeticsOf, inviteFeedback, normalizeFriends } from './friendsModel.js';
import '@/styles/online.css';
import '@/styles/x-social.css';

const RESEND_AFTER = 30000;

// ---------------------------------------------------------------- cosmetics (ART's components when present)

// ART ships `AvatarFrame` / `TitleChip` in components/art/cosmetics.jsx. Optional on purpose: until that file
// exists (or if it fails to load) the small fallbacks below draw the same idea, so nothing here breaks the build.
const artMods = import.meta.glob('../art/cosmetics.jsx', { eager: true });
const art = Object.values(artMods)[0] || {};

function FallbackFrame({ frame, size, children }) {
  const item = frame ? cosmeticsOf({ equipped: { frame } }).frame : null;
  if (!item) return children;
  const [a, b] = item.colors || [];
  return (
    <span className="xs-frame" style={{ '--xs-f1': a, '--xs-f2': b || a, width: size + 6, height: size + 6 }} data-frame={item.id}>
      {children}
    </span>
  );
}

function FallbackTitle({ title }) {
  const item = title ? cosmeticsOf({ equipped: { title } }).title : null;
  if (!item) return null;
  return <span className={`xs-title xs-title--${item.rarity || 'common'}`}>{item.name}</span>;
}

const Frame = typeof art.AvatarFrame === 'function' ? art.AvatarFrame : FallbackFrame;
const Title = typeof art.TitleChip === 'function' ? art.TitleChip : FallbackTitle;

/**
 * A person's avatar inside their equipped frame, with an optional online dot.
 * `person`: { avatar, equipped? } · `online`: true | false | undefined (no dot).
 */
export function FriendAvatar({ person, size = 44, online }) {
  const { frame } = cosmeticsOf(person);
  const preset = person && Number.isInteger(person.avatar) ? person.avatar : 0;
  return (
    <span className="xs-ava" style={{ '--xs-ava': `${size}px` }}>
      <Frame frame={frame ? frame.id : undefined} size={size}>
        <Avatar preset={preset} size={size} />
      </Frame>
      {online !== undefined && <span className={`xs-dot${online ? ' is-on' : ''}`} role="img" aria-label={online ? 'Online' : 'Offline'} />}
    </span>
  );
}

/** The person's equipped title chip, or nothing. */
export function FriendTitle({ person }) {
  const { title } = cosmeticsOf(person);
  return title ? <Title title={title.id} /> : null;
}

// ---------------------------------------------------------------- lobby panel

/**
 * Lobby panel: one tap invites a friend to this room (POST /api/invites; the server adds the game's name).
 * Offline friends can be invited too: the server keeps the invite and they find it in their inbox later.
 */
export default function InviteFriends({ code, gameName, onNotify }) {
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [sent, setSent] = useState({}); // userId -> 'sending' | 'sent' | 'saved'
  const timers = useRef(new Set());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const set = timers.current;
    return () => {
      alive.current = false;
      set.forEach((t) => clearTimeout(t));
      set.clear();
    };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const raw = await api.get('/api/friends');
      if (alive.current) setData(normalizeFriends(raw));
    } catch (e) {
      if (alive.current) setError(errorMessage(e, 'Could not load your friends'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useUserEvents((msg) => setData((d) => (d ? applyPresence(d, msg.userId, msg.online) : d)), ['presence']);

  const invite = async (friend) => {
    setSent((s) => ({ ...s, [friend.id]: 'sending' }));
    try {
      const res = await sendInvite(code, friend.id);
      if (!alive.current) return;
      const fb = inviteFeedback(res, friend.name);
      setSent((s) => ({ ...s, [friend.id]: fb.state }));
      onNotify?.(fb.text, fb.tone);
      const t = setTimeout(() => {
        timers.current.delete(t);
        if (alive.current) setSent((s) => ({ ...s, [friend.id]: undefined }));
      }, RESEND_AFTER);
      timers.current.add(t);
    } catch (e) {
      if (!alive.current) return;
      setSent((s) => ({ ...s, [friend.id]: undefined }));
      onNotify?.(errorMessage(e, 'Could not send the invite'), 'bad');
    }
  };

  const online = data ? data.friends.filter((f) => f.online).length : 0;

  return (
    <section className="ho-card ho-invite" aria-label={gameName ? `Invite friends to ${gameName}` : 'Invite friends'}>
      <div className="ho-card__head">
        <h2 className="ho-h2">{gameName ? `Invite friends to ${gameName}` : 'Invite friends'}</h2>
        {data && data.friends.length > 0 && <span className="ho-muted">{online} online</span>}
      </div>

      {error ? (
        <div className="ho-inline-error" role="alert">
          <span>{error}</span>
          <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={load}>
            Retry
          </button>
        </div>
      ) : !data ? (
        <ul className="ho-list" aria-busy="true" aria-label="Loading friends">
          {[0, 1].map((i) => (
            <li key={i} className="ho-row ho-skel-row" aria-hidden="true">
              <span className="ho-skel ho-skel--circle" />
              <span className="ho-skel ho-skel--line" />
            </li>
          ))}
        </ul>
      ) : data.friends.length === 0 ? (
        <p className="ho-empty">
          No friends yet. Share the link above, or <Link to={`${paths.friends()}?room=${code}`}>add friends</Link> to invite them in one tap.
        </p>
      ) : (
        <ul className="ho-list">
          {data.friends.map((f, i) => {
            const state = sent[f.id];
            const done = state === 'sent' || state === 'saved';
            return (
              <li key={f.id} className="ho-row xs-enter" style={{ '--xs-i': i }}>
                <span className="ho-row__avatar xs-rowava">
                  <FriendAvatar person={f} size={40} online={f.online} />
                </span>
                <span className="ho-row__main">
                  <span className="ho-row__name">{f.name}</span>
                  <span className="ho-row__sub xs-sub">
                    <span>{f.online ? 'Online now' : 'Offline · gets it later'}</span>
                    <FriendTitle person={f} />
                  </span>
                </span>
                <button
                  type="button"
                  className={`ho-btn ho-btn--sm ${done ? 'ho-btn--ghost' : 'ho-btn--primary'}`}
                  onClick={() => invite(f)}
                  disabled={state === 'sending' || done}
                  aria-label={`Invite ${f.name}${f.online ? '' : ' (offline: they will see it when they are back)'}`}
                >
                  {state === 'sending' ? 'Sending...' : state === 'sent' ? 'Invited' : state === 'saved' ? 'Saved' : 'Invite'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
