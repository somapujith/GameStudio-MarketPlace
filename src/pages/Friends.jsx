import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/components/art/index.js';
import { api, errorMessage, getMyRooms, sendInvite } from '@/lib/api.js';
import { useAuth, useUserEvents, useUserSocket } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { canShare, shareOrCopy, useCopied } from '@/components/online/clipboard.js';
import { friendInviteMessage, friendLinkUrl, isFriendCode, isRoomCode, normalizeFriendCode, normalizeRoomCode, parseFriendLink } from '@/components/online/codes.js';
import ConfirmDialog from '@/components/online/ConfirmDialog.jsx';
import GameIcon from '@/components/online/GameIcon.jsx';
import { gameName, gameOf } from '@/components/online/games.js';
import { FriendAvatar, FriendTitle } from '@/components/online/InviteFriends.jsx';
import { setInvitesUser, useInvites, useNow, usePresence } from '@/components/online/InviteBanner.jsx';
import InviteToGameSheet from '@/components/online/InviteToGameSheet.jsx';
import Sheet from '@/components/online/Sheet.jsx';
import { Loading } from '@/components/online/StatusPanel.jsx';
import { useToasts } from '@/components/online/Toasts.jsx';
import {
  acceptLocal,
  addFriend,
  addIncoming,
  applyPresence,
  countOnline,
  emptyFriends,
  inviteFeedback,
  normalizeFriends,
  relativeTime,
  removeFriend,
  removeIncoming,
  removeOutgoing,
} from '@/components/online/friendsModel.js';
import '@/styles/online.css';
import '@/styles/x-social.css';

const byId = (u) => String(u.id);

function SkeletonRows({ n = 3 }) {
  return (
    <ul className="ho-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="ho-row ho-skel-row" aria-hidden="true">
          <span className="ho-skel ho-skel--circle" />
          <span className="ho-skel ho-skel--line" />
        </li>
      ))}
    </ul>
  );
}

function SvgIcon({ d, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
const I = {
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7',
  close: 'M6 6l12 12M18 6L6 18',
  table: 'M4 9h16M6 9v9M18 9v9M8 5h8l4 4H4z',
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  chev: 'M9 6l6 6-6 6',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
};

// ---------------------------------------------------------------- signed-out / guest upsell

function Upsell({ user }) {
  const here = paths.friends() + (typeof window !== 'undefined' ? window.location.search : '');
  const guest = !!user;
  return (
    <div className="ho-page xs-upsell-page">
      <section className="ho-card xs-upsell" aria-labelledby="xs-upsell-title">
        <div className="xs-upsell__art" aria-hidden="true">
          <span className="xs-upsell__ava xs-upsell__ava--a">
            <Avatar preset={3} size={56} />
          </span>
          <span className="xs-upsell__ava xs-upsell__ava--b">
            <Avatar preset={7} size={64} />
          </span>
          <span className="xs-upsell__ava xs-upsell__ava--c">
            <Avatar preset={10} size={56} />
          </span>
        </div>
        <span className="ho-eyebrow xs-eyebrow">Friends</span>
        <h1 id="xs-upsell-title" className="ho-h1">
          {guest ? 'Friends are for Google accounts' : 'Sign in to add friends'}
        </h1>
        <p className="ho-muted">
          {guest
            ? 'Guests can host and join rooms with a code or link. Sign in with Google to keep friends across devices.'
            : 'Play with the same people again and again, without swapping room codes every time.'}
        </p>
        <ul className="xs-perks">
          <li>See who is online right now</li>
          <li>Invite a friend to your table in one tap</li>
          <li>Invites wait for you, even when you were offline</li>
        </ul>
        <div className="ho-status__actions">
          <Link to={paths.login(here)} className="ho-btn ho-btn--primary">
            {guest ? 'Sign in with Google' : 'Sign in'}
          </Link>
          <Link to={paths.join()} className="ho-btn ho-btn--ghost">
            Join a room with a code
          </Link>
        </div>
      </section>
    </div>
  );
}

/** /friends: the People tab. */
export default function Friends() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="ho-page">
        <Loading text="Loading friends..." />
      </div>
    );
  }
  if (!user || user.isGuest) return <Upsell user={user} />;
  return <FriendsInner user={user} />;
}

// ---------------------------------------------------------------- invites inbox

function InvitesInbox({ meId }) {
  const { invites, status, refresh, dismiss } = useInvites();
  const now = useNow(30000);
  const shown = usePresence(invites, (i) => i.key);

  useEffect(() => {
    setInvitesUser(meId); // no-op when the app-wide banner already did it
    refresh({ force: true });
  }, [meId, refresh]);

  const loading = (status === 'loading' || status === 'idle') && invites.length === 0;
  return (
    <section className="ho-card xs-inbox xs-o1" id="invites" aria-labelledby="xs-inbox-title">
      <div className="ho-card__head">
        <h2 id="xs-inbox-title" className="ho-h2">
          Game invites
        </h2>
        {invites.length > 0 && (
          <span className="ho-count" aria-label={`${invites.length} pending`}>
            {invites.length}
          </span>
        )}
      </div>
      {status === 'offline' && (
        <div className="xs-note" role="status">
          <span>You&rsquo;re offline. New invites show up when you&rsquo;re back.</span>
          <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={() => refresh({ force: true })}>
            Retry
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="ho-inline-error" role="alert">
          <span>Could not load your invites.</span>
          <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={() => refresh({ force: true })}>
            Try again
          </button>
        </div>
      )}
      {loading ? (
        <SkeletonRows n={1} />
      ) : shown.length === 0 ? (
        status !== 'offline' &&
        status !== 'error' && (
          <div className="xs-empty">
            <span className="xs-empty__icon" aria-hidden="true">
              <SvgIcon d={I.mail} size={22} />
            </span>
            <span>
              <strong>No invites right now</strong>
              <span>When a friend invites you to a table it lands here, even if you were offline.</span>
            </span>
          </div>
        )
      ) : (
        <ul className="ho-list xs-list" aria-label="Pending invites">
          {shown.map(({ key, item: inv, leaving }, i) => {
            const game = gameOf(inv.gameId);
            const gName = inv.gameName || (inv.gameId ? gameName(inv.gameId, game) : 'a game');
            return (
              <li key={key} className={`ho-row xs-invite xs-enter${leaving ? ' is-leaving' : ''}`} style={{ '--xs-i': i }} aria-hidden={leaving || undefined}>
                <span className="xs-invite__icon">
                  <GameIcon game={game} name={gName} size={44} />
                  <span className="xs-invite__from">
                    <Avatar preset={inv.from.avatar} size={22} />
                  </span>
                </span>
                <span className="ho-row__main">
                  <span className="xs-invite__title">
                    <strong>{inv.from.name}</strong> invited you to <strong>{gName}</strong>
                  </span>
                  <span className="ho-row__sub">
                    Room {inv.code} · <time dateTime={new Date(inv.createdAt).toISOString()}>{relativeTime(inv.createdAt, now)}</time>
                  </span>
                </span>
                <span className="ho-row__actions">
                  <Link to={paths.join(inv.code)} className="ho-btn ho-btn--primary ho-btn--sm" onClick={() => dismiss(inv)} tabIndex={leaving ? -1 : undefined}>
                    Join
                  </Link>
                  <button
                    type="button"
                    className="ho-iconbtn xs-tip"
                    data-tip="Dismiss"
                    onClick={() => dismiss(inv)}
                    disabled={leaving}
                    aria-label={`Dismiss invite from ${inv.from.name} to ${gName}`}
                  >
                    <SvgIcon d={I.close} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- quick actions for one friend

function FriendActions({ friend, room, inviteState, onInvite, onNewTable, onRemove, onNotify, onClose }) {
  const [tables, setTables] = useState(null); // null = loading, [] = none / unavailable
  const [codeCopied, copyCode] = useCopied();
  const [linkCopied, copyLink] = useCopied();

  useEffect(() => {
    if (room) {
      setTables([]);
      return undefined;
    }
    let alive = true;
    getMyRooms()
      .then((r) => {
        if (alive) setTables((r && Array.isArray(r.rooms) ? r.rooms : []).filter((x) => x && x.code && x.status === 'lobby'));
      })
      .catch(() => alive && setTables([]));
    return () => {
      alive = false;
    };
  }, [room]);

  const link = friend.friendCode ? friendLinkUrl(friend.friendCode) : '';
  const targets = room ? [{ code: room, gameId: null, here: true }] : tables || [];

  return (
    <Sheet open title={friend.name} subtitle={friend.online ? 'Online now' : 'Offline · invites wait for them'} onClose={onClose}>
      <div className="xs-qa">
        <div className="xs-qa__who">
          <FriendAvatar person={friend} size={64} online={friend.online} />
          <span className="xs-qa__meta">
            <span>Level {friend.level}</span>
            <FriendTitle person={friend} />
            {friend.friendCode && <span className="ho-chip ho-chip--static">{friend.friendCode}</span>}
          </span>
        </div>

        <ul className="xs-qa__list" aria-label={`Actions for ${friend.name}`}>
          {tables === null && (
            <li className="xs-qa__skel" aria-hidden="true">
              <span className="ho-skel ho-skel--line" />
            </li>
          )}
          {targets.map((t, i) => {
            const st = inviteState(t.code);
            const done = st === 'sent' || st === 'saved';
            const label = t.here ? `Invite to table ${t.code}` : `Invite to my table ${t.code}`;
            const sub = t.here
              ? 'The room you came from'
              : [t.gameId ? gameName(t.gameId) : '', Number.isFinite(t.players) && Number.isFinite(t.maxPlayers) ? `${t.players}/${t.maxPlayers} seats` : ''].filter(Boolean).join(' · ');
            return (
              <li key={t.code} className="xs-enter" style={{ '--xs-i': i }}>
                <button type="button" className="xs-qa__btn is-primary" onClick={() => onInvite(friend, t.code)} disabled={st === 'sending' || done}>
                  <span className="xs-qa__icon" aria-hidden="true">
                    <SvgIcon d={I.table} />
                  </span>
                  <span className="xs-qa__text">
                    <strong>{st === 'sending' ? 'Sending...' : st === 'sent' ? `Invited to ${t.code}` : st === 'saved' ? `Invite saved for ${t.code}` : label}</strong>
                    {sub && <span>{sub}</span>}
                  </span>
                </button>
              </li>
            );
          })}
          <li className="xs-enter" style={{ '--xs-i': targets.length }}>
            <button type="button" className={`xs-qa__btn${targets.length ? '' : ' is-primary'}`} onClick={() => onNewTable(friend)}>
              <span className="xs-qa__icon" aria-hidden="true">
                <SvgIcon d={I.plus} />
              </span>
              <span className="xs-qa__text">
                <strong>{targets.length ? 'Start a new table instead' : 'Invite to a new table'}</strong>
                <span>Pick a game; we open a private room and invite {friend.name}</span>
              </span>
            </button>
          </li>
          {friend.friendCode && (
            <>
              <li className="xs-enter" style={{ '--xs-i': targets.length + 1 }}>
                <button
                  type="button"
                  className="xs-qa__btn"
                  onClick={async () => {
                    if (await copyCode(friend.friendCode)) onNotify('Friend code copied', 'good');
                    else onNotify('Could not copy. Select the code and copy it manually.', 'bad');
                  }}
                >
                  <span className="xs-qa__icon" aria-hidden="true">
                    <SvgIcon d={I.copy} />
                  </span>
                  <span className="xs-qa__text">
                    <strong>{codeCopied ? 'Copied!' : 'Copy friend code'}</strong>
                    <span>{friend.friendCode}</span>
                  </span>
                </button>
              </li>
              <li className="xs-enter" style={{ '--xs-i': targets.length + 2 }}>
                <button
                  type="button"
                  className="xs-qa__btn"
                  onClick={async () => {
                    if (await copyLink(link)) onNotify('Friend link copied', 'good');
                    else onNotify('Could not copy the link.', 'bad');
                  }}
                >
                  <span className="xs-qa__icon" aria-hidden="true">
                    <SvgIcon d={I.link} />
                  </span>
                  <span className="xs-qa__text">
                    <strong>{linkCopied ? 'Copied!' : 'Copy friend link'}</strong>
                    <span>Share {friend.name}&rsquo;s profile link</span>
                  </span>
                </button>
              </li>
            </>
          )}
          <li className="xs-enter" style={{ '--xs-i': targets.length + 3 }}>
            <button type="button" className="xs-qa__btn is-danger" onClick={() => onRemove(friend)}>
              <span className="xs-qa__icon" aria-hidden="true">
                <SvgIcon d={I.trash} />
              </span>
              <span className="xs-qa__text">
                <strong>Remove friend</strong>
                <span>You can add them again with their code</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- page

function FriendsInner({ user }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const rawRoom = normalizeRoomCode(params.get('room') || '');
  const room = isRoomCode(rawRoom) ? rawRoom : '';
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null); // { message, offline }
  const [busy, setBusy] = useState({});
  const [confirm, setConfirm] = useState(null);
  const [actionsFor, setActionsFor] = useState(null); // friend whose quick actions are open
  const [inviteSheet, setInviteSheet] = useState(null); // friend picked for "Invite to a new table"
  const [invited, setInvited] = useState({}); // `${friendId}:${code}` -> 'sending' | 'sent' | 'saved'
  const [code, setCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [codeCopied, copyCode] = useCopied();
  const [linkCopied, copyLink] = useCopied();
  const { push, node } = useToasts();
  const { status: socketStatus } = useUserSocket();
  const dataRef = useRef(null);
  const addRef = useRef(null);

  useEffect(() => {
    dataRef.current = data;
  });

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

  // refresh quietly when the tab regains focus (requests may have arrived while we were away)
  useEffect(() => {
    const onFocus = () => load({ silent: true });
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [load]);

  // /friends#invites (from the app-wide "invites waiting" banner): bring the inbox into view
  useEffect(() => {
    if (location.hash !== '#invites') return;
    const t = setTimeout(() => document.getElementById('invites')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
    return () => clearTimeout(t);
  }, [location.hash]);

  // live updates from the user socket
  useUserEvents(
    (msg) => {
      if (msg.t === 'presence') setData((d) => (d ? applyPresence(d, msg.userId, msg.online) : d));
      else if (msg.t === 'friend_request') {
        setData((d) => addIncoming(d || emptyFriends(), msg.from));
        load({ silent: true });
      } else if (msg.t === 'friend_accepted') {
        setData((d) => addFriend(d || emptyFriends(), { ...msg.by, online: true }));
        if (msg.by && msg.by.name) push(`${msg.by.name} accepted your request`, 'good');
        load({ silent: true });
      }
    },
    ['presence', 'friend_request', 'friend_accepted'],
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

  const submitAdd = async (e) => {
    e.preventDefault();
    if (adding) return;
    const c = parseFriendLink(code);
    if (!isFriendCode(c)) {
      setAddError('Friend codes look like HYD-7K2Q (4 letters or numbers after HYD-). You can also paste a friend link.');
      addRef.current?.focus();
      return;
    }
    if (c === user.friendCode) {
      setAddError('That is your own code. Share it with a friend instead.');
      return;
    }
    setAdding(true);
    setAddError('');
    try {
      await api.post('/api/friends/request', { friendCode: c });
      setCode('');
      push('Friend request sent', 'good');
      load({ silent: true });
    } catch (err) {
      const msg = errorMessage(err, 'Could not send the request');
      setAddError(msg);
      push(msg, 'bad');
    } finally {
      setAdding(false);
    }
  };

  const link = user.friendCode ? friendLinkUrl(user.friendCode) : '';
  const share = async () => {
    const res = await shareOrCopy(friendInviteMessage(user.friendCode));
    if (res === 'copied') push('Friend link copied', 'good');
    else if (res === 'failed') push('Could not share. Copy your link instead.', 'bad');
  };

  const d = data || emptyFriends();
  const online = countOnline(d);
  const friendsShown = usePresence(d.friends, byId);
  const incomingShown = usePresence(d.incoming, byId);

  // an old share link (`/friends?add=HYD-7K2Q`) opens the "Add <name>?" screen instead
  const legacyAdd = parseFriendLink(params.get('add') || '');
  if (legacyAdd) return <Navigate to={paths.friendLink(legacyAdd)} replace />;

  const roomState = (f) => invited[`${f.id}:${room}`];

  return (
    <div className="ho-page ho-friends xs-friends">
      <header className="ho-head xs-head">
        <div>
          <h1 className="ho-h1">Friends</h1>
          <p className="ho-muted">Add people once, then invite them to any game.</p>
        </div>
        <div className="xs-head__pills">
          {data && d.friends.length > 0 && (
            <span className="ho-pill">
              <span className="xs-live" aria-hidden="true" />
              {online} online
            </span>
          )}
        </div>
      </header>

      {socketStatus === 'reconnecting' && (
        <div className="xs-note xs-note--warn" role="status">
          <span>Reconnecting&hellip; online dots and new invites will catch up in a moment.</span>
        </div>
      )}

      {room && (
        <div className="ho-banner ho-banner--info" role="status">
          <span>
            Inviting to room <strong>{room}</strong>. Tap Invite next to a friend. Offline friends get it when they&rsquo;re back.
          </span>
          <Link to={paths.lobby(room)} className="ho-btn ho-btn--ghost ho-btn--sm">
            Back to lobby
          </Link>
        </div>
      )}

      <div className="xs-grid">
        <div className="xs-col">
          <InvitesInbox meId={user.id} />

          <section className="ho-card ho-mycode xs-o5" aria-label="Your friend link">
            <span className="ho-eyebrow">Your friend code</span>
            <div className="ho-bigcode ho-bigcode--friend" aria-label={`Your friend code ${user.friendCode}`}>
              {user.friendCode || '...'}
            </div>
            <div className="ho-linkrow">
              <input className="ho-input ho-linkrow__input" readOnly value={link} aria-label="Your friend link" onFocus={(e) => e.target.select()} placeholder="Your friend link" />
              <button
                type="button"
                className="ho-btn ho-btn--ghost"
                onClick={async () => {
                  if (!(await copyLink(link))) push('Could not copy the link.', 'bad');
                }}
                disabled={!link}
              >
                {linkCopied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
            <div className="ho-share__actions">
              <button
                type="button"
                className="ho-btn ho-btn--ghost"
                onClick={async () => {
                  if (!(await copyCode(user.friendCode))) push('Could not copy. Select the code and copy it manually.', 'bad');
                }}
                disabled={!user.friendCode}
              >
                {codeCopied ? 'Copied!' : 'Copy code'}
              </button>
              <button type="button" className="ho-btn ho-btn--primary" onClick={share} disabled={!user.friendCode}>
                {canShare() ? 'Share link' : 'Copy invite'}
              </button>
            </div>
            <p className="ho-help">Anyone who opens your link can add you in one tap. No account needed to look.</p>
          </section>

          <section className="ho-card xs-o6" aria-label="Add a friend by code">
            <h2 className="ho-h2">Add by code</h2>
            <form onSubmit={submitAdd} noValidate className="ho-addform">
              <label className="ho-field__label" htmlFor="ho-add-code">
                Friend code or link
              </label>
              <div className="ho-addform__row">
                <input
                  id="ho-add-code"
                  ref={addRef}
                  className="ho-input ho-input--code"
                  value={code}
                  onChange={(e) => {
                    const v = e.target.value;
                    // a pasted link/code becomes the clean code; plain typing is normalised as you go
                    setCode(parseFriendLink(v) || (v.includes('/') ? v : normalizeFriendCode(v)));
                    if (addError) setAddError('');
                  }}
                  placeholder="HYD-7K2Q"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="send"
                  aria-invalid={addError ? true : undefined}
                  aria-describedby={addError ? 'ho-add-error' : undefined}
                />
                <button type="submit" className="ho-btn ho-btn--primary" disabled={adding || !code}>
                  {adding ? 'Sending...' : 'Add'}
                </button>
              </div>
              {addError && (
                <p id="ho-add-error" className="ho-inline-error" role="alert">
                  {addError}
                </p>
              )}
            </form>
          </section>
        </div>

        <div className="xs-col">
          {loadError ? (
            <section className="ho-card xs-o3">
              <div className={loadError.offline ? 'xs-offline' : 'ho-inline-error'} role="alert">
                {loadError.offline && (
                  <span className="xs-empty__icon" aria-hidden="true">
                    <SvgIcon d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.6M19 13a10 10 0 0 0-2.3-1.6M2 9.5a15 15 0 0 1 4.5-2.7M22 9.5A15 15 0 0 0 11 6" size={22} />
                  </span>
                )}
                <span>
                  {loadError.offline ? (
                    <>
                      <strong>You&rsquo;re offline</strong>
                      <span>Friends and invites need the server. We&rsquo;ll try again when you&rsquo;re back.</span>
                    </>
                  ) : (
                    loadError.message
                  )}
                </span>
                <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={() => load()}>
                  Try again
                </button>
              </div>
            </section>
          ) : (
            <>
              {(!data || d.incoming.length > 0) && (
                <section className="ho-card xs-o2" aria-labelledby="xs-req-title">
                  <div className="ho-card__head">
                    <h2 id="xs-req-title" className="ho-h2">
                      Requests
                    </h2>
                    {d.incoming.length > 0 && <span className="ho-count">{d.incoming.length}</span>}
                  </div>
                  {!data ? (
                    <SkeletonRows n={1} />
                  ) : (
                    <ul className="ho-list xs-list">
                      {incomingShown.map(({ key, item: u, leaving }, i) => (
                        <li key={key} className={`ho-row xs-req xs-enter${leaving ? ' is-leaving' : ''}`} style={{ '--xs-i': i }} aria-hidden={leaving || undefined}>
                          <span className="ho-row__avatar xs-rowava">
                            <FriendAvatar person={u} size={44} />
                          </span>
                          <span className="ho-row__main">
                            <span className="ho-row__name">{u.name}</span>
                            <span className="ho-row__sub xs-sub">
                              <span>wants to be friends</span>
                              <FriendTitle person={u} />
                            </span>
                          </span>
                          <span className="ho-row__actions">
                            <button type="button" className="ho-btn ho-btn--primary ho-btn--sm" onClick={() => accept(u)} disabled={!!busy[u.id] || leaving} aria-label={`Accept request from ${u.name}`}>
                              Accept
                            </button>
                            <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={() => decline(u)} disabled={!!busy[u.id] || leaving} aria-label={`Decline request from ${u.name}`}>
                              Decline
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <section className="ho-card xs-o3" aria-labelledby="xs-friends-title">
                <div className="ho-card__head">
                  <h2 id="xs-friends-title" className="ho-h2">
                    Your friends
                  </h2>
                  {data && d.friends.length > 0 && <span className="ho-count">{d.friends.length}</span>}
                </div>
                {!data ? (
                  <SkeletonRows />
                ) : friendsShown.length === 0 ? (
                  <div className="xs-empty xs-empty--big">
                    <span className="xs-empty__icon" aria-hidden="true">
                      <SvgIcon d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 8v6M22 11h-6" size={22} />
                    </span>
                    <span>
                      <strong>No friends yet</strong>
                      <span>Share your friend link or add someone by code. Friends show a green dot when they are online, and you can invite them to any game.</span>
                    </span>
                    <button type="button" className="ho-btn ho-btn--primary ho-btn--sm" onClick={share} disabled={!user.friendCode}>
                      {canShare() ? 'Share my link' : 'Copy my invite'}
                    </button>
                  </div>
                ) : (
                  <ul className="ho-list xs-list">
                    {friendsShown.map(({ key, item: f, leaving }, i) => {
                      const st = room ? roomState(f) : undefined;
                      const done = st === 'sent' || st === 'saved';
                      return (
                        <li key={key} className={`ho-row xs-friend xs-enter${leaving ? ' is-leaving' : ''}`} style={{ '--xs-i': i }} aria-hidden={leaving || undefined}>
                          <button
                            type="button"
                            className="xs-friend__main"
                            onClick={() => setActionsFor(f)}
                            disabled={leaving}
                            aria-haspopup="dialog"
                            aria-label={`${f.name}, ${f.online ? 'online' : 'offline'}, level ${f.level}. Open actions`}
                          >
                            <span className="ho-row__avatar xs-rowava">
                              <FriendAvatar person={f} size={44} online={f.online} />
                            </span>
                            <span className="ho-row__main">
                              <span className="ho-row__name">{f.name}</span>
                              <span className="ho-row__sub xs-sub">
                                <span className={f.online ? 'xs-on' : undefined}>{f.online ? 'Online' : 'Offline'}</span>
                                <span aria-hidden="true">·</span>
                                <span>Lv {f.level}</span>
                                <FriendTitle person={f} />
                              </span>
                            </span>
                          </button>
                          <span className="ho-row__actions">
                            {room ? (
                              <button
                                type="button"
                                className={`ho-btn ho-btn--sm ${done ? 'ho-btn--ghost' : 'ho-btn--primary'}`}
                                onClick={() => inviteTo(f, room)}
                                disabled={st === 'sending' || done || leaving}
                                aria-label={`Invite ${f.name} to room ${room}`}
                              >
                                {st === 'sending' ? 'Sending...' : st === 'sent' ? 'Invited' : st === 'saved' ? 'Saved' : 'Invite'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="ho-btn ho-btn--primary ho-btn--sm"
                                onClick={() => setActionsFor(f)}
                                disabled={leaving}
                                title={f.online ? undefined : `${f.name} is offline: they will see the invite when they are back`}
                                aria-label={`Invite ${f.name} to a game`}
                              >
                                Invite
                              </button>
                            )}
                            <button
                              type="button"
                              className="ho-iconbtn xs-tip"
                              data-tip="Remove friend"
                              onClick={() => setConfirm(f)}
                              disabled={!!busy[f.id] || leaving}
                              aria-label={`Remove ${f.name} from friends`}
                            >
                              <SvgIcon d={I.trash} />
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {data && d.outgoing.length > 0 && (
                <section className="ho-card xs-o4" aria-labelledby="xs-sent-title">
                  <div className="ho-card__head">
                    <h2 id="xs-sent-title" className="ho-h2">
                      Sent requests
                    </h2>
                    <span className="ho-count">{d.outgoing.length}</span>
                  </div>
                  <ul className="ho-list xs-list">
                    {d.outgoing.map((u, i) => (
                      <li key={u.id} className="ho-row xs-enter" style={{ '--xs-i': i }}>
                        <span className="ho-row__avatar xs-rowava">
                          <FriendAvatar person={u} size={44} />
                        </span>
                        <span className="ho-row__main">
                          <span className="ho-row__name">{u.name}</span>
                          <span className="ho-row__sub">Waiting for them to accept</span>
                        </span>
                        <span className="ho-row__actions">
                          <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={() => cancel(u)} disabled={!!busy[u.id]} aria-label={`Cancel request to ${u.name}`}>
                            Cancel
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {actionsFor && (
        <FriendActions
          friend={actionsFor}
          room={room}
          inviteState={(c) => invited[`${actionsFor.id}:${c}`]}
          onInvite={inviteTo}
          onNewTable={(f) => {
            setActionsFor(null);
            setInviteSheet(f);
          }}
          onRemove={(f) => {
            setActionsFor(null);
            setConfirm(f);
          }}
          onNotify={push}
          onClose={() => setActionsFor(null)}
        />
      )}

      {inviteSheet && <InviteToGameSheet friend={inviteSheet} onClose={() => setInviteSheet(null)} />}

      <ConfirmDialog
        open={!!confirm}
        title={confirm ? `Remove ${confirm.name}?` : ''}
        body="You will no longer see each other online or be able to invite each other. You can add them again with their code."
        confirmLabel="Remove"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const f = confirm;
          setConfirm(null);
          if (f) remove(f);
        }}
      />
      {node}
    </div>
  );
}
