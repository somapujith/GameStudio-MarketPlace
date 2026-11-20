import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { errorMessage } from '@/lib/api.js';
import { useAuth, useUserSocket } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { canShare, shareOrCopy, useCopied } from '@/components/online/clipboard.js';
import { friendInviteMessage, friendLinkUrl, friendShareText, isRoomCode, normalizeRoomCode, parseFriendLink } from '@/components/online/codes.js';
import ConfirmDialog from '@/components/online/ConfirmDialog.jsx';
import { usePresence } from '@/components/online/InviteBanner.jsx';
import { FriendAvatar, FriendTitle } from '@/components/online/InviteFriends.jsx';
import InviteToGameSheet from '@/components/online/InviteToGameSheet.jsx';
import StatusPanel, { Loading } from '@/components/online/StatusPanel.jsx';
import { useToasts } from '@/components/online/Toasts.jsx';
import { countOnline, emptyFriends, handleLabel } from '@/components/online/friendsModel.js';
import AddFriendPanel from '@/platform/social/AddFriendPanel.jsx';
import FriendActionsSheet from '@/platform/social/FriendActionsSheet.jsx';
import InvitesInbox from '@/platform/social/InvitesInbox.jsx';
import PrivacyCard from '@/platform/social/PrivacyCard.jsx';
import { blockPlayer } from '@/platform/social/blockStore.js';
import { JoinButton, StatusText, canJoin, statusText } from '@/platform/social/PresenceBits.jsx';
import { WhatsAppIcon } from '@/platform/social/SIcon.jsx';
import useFriends from '@/platform/social/useFriends.js';
import IndiaArt from '@/components/art/IndiaArt.jsx';
import '@/styles/online.css';
import '@/styles/x-social.css';
import '@/styles/store-social.css';
import '@/styles/hubMoments.css';
import '@/styles/handle.css';
import '@/platform/home/adda.css';

const byId = (u) => String(u.id);

/** Invite-to-room button label per feedback state (idle | sending | sent | saved | joined | declined). */
const ROOM_INVITE_LABEL = { sending: 'Sending...', sent: 'Invited', saved: 'Saved', joined: 'Joined', declined: 'Declined' };

function AddaMasthead({ heading = true, children }) {
  const Title = heading ? 'h1' : 'p';
  return (
    <header className="adda-route-head">
      <div>
        <p className="adda-kicker">Your people. Your table.</p>
        <Title className="ho-h1 adda-route-head__title">The Adda</Title>
        <p className="ho-muted">Add people once, then invite them to any game.</p>
        {children}
      </div>
      <IndiaArt art="gully-cricket" className="adda-route-head__art" />
    </header>
  );
}

function Dot({ online }) {
  return <span className={`ho-dot ho-row__dot ${online ? 'is-on' : 'is-off'}`} role="img" aria-label={online ? 'Online' : 'Offline'} />;
}

/** The person's @handle under their name, when they have one. */
function Handle({ person }) {
  const label = handleLabel(person);
  return label ? <span className="hd-handle ho-row__handle">{label}</span> : null;
}

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

/** /friends: The Adda (the People tab). */
export default function Friends() {
  const { user, loading, reachable, refresh } = useAuth();
  if (loading) {
    return (
      <div className="ho-page adda-friends-page">
        <AddaMasthead />
        <Loading text="Loading friends..." />
      </div>
    );
  }
  if (!user && reachable === false) {
    return (
      <div className="ho-page adda-friends-page">
        <AddaMasthead heading={false} />
        <StatusPanel
          icon="📡"
          tone="warn"
          title="You are offline"
          body="Friends and invites need a connection to the server. Reconnect and try again."
          actions={[{ label: 'Try again', onClick: () => refresh?.(), primary: true }]}
        />
      </div>
    );
  }
  if (!user || user.isGuest) {
    const here = paths.friends() + (typeof window !== 'undefined' ? window.location.search : '');
    return (
      <div className="ho-page adda-friends-page">
        <AddaMasthead heading={false} />
        <StatusPanel
          icon="👥"
          title={user ? 'Friends are for Google accounts' : 'Sign in to add friends'}
          body={
            user
              ? 'Guests can host and join rooms with a code or link. Sign in with Google to add friends, see who is online and invite them to a game in one tap.'
              : 'Add friends with a friend link or their @username, see who is online and invite them to a game in one tap. Invites wait for them, even when they were offline.'
          }
          actions={[
            { label: user ? 'Sign in with Google' : 'Sign in', to: paths.login(here), primary: true },
            { label: 'Join a room with a code', to: paths.join() },
          ]}
        >
          <ol className="adda-steps" aria-label="How the Adda works">
            <li><b>1</b><span>Share your friend link</span></li>
            <li><b>2</b><span>They add you in one tap</span></li>
            <li><b>3</b><span>Invite them to any game</span></li>
          </ol>
        </StatusPanel>
      </div>
    );
  }
  return <FriendsInner user={user} />;
}

/** Your friend code as the Adda's paper pass: the code, the link (copy, WhatsApp, share) and a QR code on demand. */
function FriendPass({ code, onNotify, onShare }) {
  const [codeCopied, copyCode] = useCopied();
  const [linkCopied, copyLink] = useCopied();
  const [qr, setQr] = useState(false);
  const link = code ? friendLinkUrl(code) : '';
  const whatsapp = code ? `https://wa.me/?text=${encodeURIComponent(friendShareText(code))}` : undefined;
  return (
    <section className="ho-card ho-mycode adda-pass" aria-label="Your friend link">
      <div className="adda-pass__top">
        <span className="ho-eyebrow">Your friend code</span>
        <button type="button" className={`adda-pass__qrbtn${qr ? ' is-on' : ''}`} onClick={() => setQr((v) => !v)} aria-expanded={qr} aria-controls="adda-pass-qr" disabled={!link}>
          {qr ? 'Hide QR' : 'Show QR'}
        </button>
      </div>
      <div className="ho-bigcode ho-bigcode--friend" aria-label={`Your friend code ${code}`}>
        {code || '...'}
      </div>
      <div id="adda-pass-qr" className="adda-pass__qr" hidden={!qr || !link}>
        {qr && link && <QRCodeSVG value={link} size={132} level="M" marginSize={2} bgColor="#ffffff" fgColor="#0b0908" title={`QR code for ${link}`} />}
        <span>Scan to add me</span>
      </div>
      <div className="ho-linkrow">
        <input className="ho-input ho-linkrow__input" readOnly value={link} aria-label="Your friend link" onFocus={(e) => e.target.select()} placeholder="Your friend link" />
        <button
          type="button"
          className="ho-btn ho-btn--ghost"
          onClick={async () => {
            if (!(await copyLink(link))) onNotify('Could not copy the link.', 'bad');
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
            if (!(await copyCode(code))) onNotify('Could not copy. Select the code and copy it manually.', 'bad');
          }}
          disabled={!code}
        >
          {codeCopied ? 'Copied!' : 'Copy code'}
        </button>
        <a className="ho-btn ho-btn--ghost adda-pass__wa" href={whatsapp} target="_blank" rel="noopener noreferrer" aria-disabled={!code || undefined}>
          <WhatsAppIcon size={17} /> WhatsApp
        </a>
        <button type="button" className="ho-btn ho-btn--primary" onClick={onShare} disabled={!code}>
          {canShare() ? 'Share link' : 'Copy invite'}
        </button>
      </div>
      <p className="ho-help">Anyone who opens your link can add you in one tap. No account needed to look.</p>
    </section>
  );
}

/** One friend: tap the row for their quick actions (invite to a table, copy their code, remove, block). */
function FriendRow({ f, leaving, room, roomState, busy, onOpen, onInviteRoom, onInvite, onRemove }) {
  const st = room ? roomState(f) : undefined;
  const done = st === 'sent' || st === 'saved' || st === 'joined' || st === 'declined';
  return (
    <li className={`ho-row adda-friend${leaving ? ' is-leaving' : ''}`} aria-hidden={leaving || undefined}>
      <button
        type="button"
        className="ho-row__open"
        onClick={() => onOpen(f)}
        disabled={leaving}
        aria-haspopup="dialog"
        aria-label={`${f.name}, ${statusText(f).toLowerCase()}, level ${f.level}. Open actions`}
      >
        <span className="ho-row__avatar">
          <FriendAvatar person={f} size={44} />
          <Dot online={f.online} />
        </span>
        <span className="ho-row__main">
          <span className="ho-row__name">{f.name}</span>
          <Handle person={f} />
          <span className="ho-row__sub">
            <StatusText friend={f} /> · Lv {f.level} <FriendTitle person={f} />
          </span>
        </span>
      </button>
      <span className="ho-row__actions">
        {!room && canJoin(f) && <JoinButton friend={f} disabled={leaving} className="ho-btn ho-btn--primary ho-btn--sm" />}
        {room ? (
          <button
            type="button"
            className={`ho-btn ho-btn--sm ${done ? 'ho-btn--ghost' : 'ho-btn--primary'}`}
            onClick={() => onInviteRoom(f, room)}
            disabled={st === 'sending' || done || leaving}
            aria-label={`Invite ${f.name} to room ${room}`}
          >
            {ROOM_INVITE_LABEL[st] || 'Invite'}
          </button>
        ) : (
          <button
            type="button"
            className={`ho-btn ho-btn--sm ${f.online && !canJoin(f) ? 'ho-btn--primary' : 'ho-btn--ghost'}`}
            onClick={() => onInvite(f)}
            disabled={leaving}
            title={f.online ? undefined : `${f.name} is offline: they will see the invite when they are back`}
            aria-label={`Invite ${f.name} to a game`}
          >
            <span className="ho-narrow">Invite</span>
            <span className="ho-wide">Invite to game</span>
          </button>
        )}
        <button type="button" className="ho-iconbtn" onClick={() => onRemove(f)} disabled={!!busy[f.id] || leaving} aria-label={`Remove ${f.name} from friends`}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 7h12M10 7V5h4v2M8 7l1 12h6l1-12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </span>
    </li>
  );
}

function FriendsInner({ user }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const rawRoom = normalizeRoomCode(params.get('room') || '');
  const room = isRoomCode(rawRoom) ? rawRoom : '';
  const { push, node } = useToasts();
  const { status: socketStatus } = useUserSocket();
  const f = useFriends({ push });
  const [confirm, setConfirm] = useState(null);
  const [blockConfirm, setBlockConfirm] = useState(null); // friend about to be blocked
  const [actionsFor, setActionsFor] = useState(null); // friend whose quick actions are open
  const [inviteSheet, setInviteSheet] = useState(null); // friend picked for "Invite to a new table"

  const { data, loadError, load, busy } = f;
  const d = data || emptyFriends();
  const online = countOnline(d);
  const friendsShown = usePresence(d.friends, byId);
  const incomingShown = usePresence(d.incoming, byId);

  // /friends#invites (from the app-wide "invites waiting" banner): bring the inbox into view
  useEffect(() => {
    if (location.hash !== '#invites') return undefined;
    const t = setTimeout(() => document.getElementById('invites')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
    return () => clearTimeout(t);
  }, [location.hash]);

  // /friends#requests (the nav badge): bring the Requests card into view and move focus to it (once per visit)
  const requestsShown = !loadError && (!data || d.incoming.length > 0);
  const focusedKey = useRef(null);
  useEffect(() => {
    if (location.hash !== '#requests' || !requestsShown || focusedKey.current === location.key) return undefined;
    const t = setTimeout(() => {
      focusedKey.current = location.key; // marked when it actually ran, so a StrictMode re-run still does it
      const el = document.getElementById('requests');
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(t);
  }, [location.hash, location.key, requestsShown]);

  // an old share link (`/friends?add=HYD-7K2Q`) opens the "Add <name>?" screen instead
  const legacyAdd = parseFriendLink(params.get('add') || '');
  if (legacyAdd) return <Navigate to={paths.friendLink(legacyAdd)} replace />;

  const share = async () => {
    const res = await shareOrCopy(friendInviteMessage(user.friendCode));
    if (res === 'copied') push('Friend link copied', 'good');
    else if (res === 'failed') push('Could not share. Copy your link instead.', 'bad');
  };

  // Online / Offline groups; rows that leave animate out (usePresence), counts come from the live rows only
  const liveFriends = friendsShown.filter((s) => !s.leaving);
  const groups = [
    { key: 'on', label: 'Online', count: liveFriends.filter((s) => s.item.online).length, items: friendsShown.filter((s) => s.item.online) },
    { key: 'off', label: 'Offline', count: liveFriends.filter((s) => !s.item.online).length, items: friendsShown.filter((s) => !s.item.online) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="ho-page ho-friends adda-friends-page">
      <AddaMasthead>
        {data && (
          <dl className="adda-stats">
            <div>
              <dt>Friends</dt>
              <dd>{d.friends.length}</dd>
            </div>
            <div className={online > 0 ? 'is-live' : undefined}>
              <dt>Online</dt>
              <dd>{online}</dd>
            </div>
            <div className={d.incoming.length > 0 ? 'is-hot' : undefined}>
              <dt>Requests</dt>
              <dd>{d.incoming.length}</dd>
            </div>
          </dl>
        )}
      </AddaMasthead>

      {socketStatus === 'reconnecting' && (
        <div className="ho-banner ho-banner--warn" role="status">
          <span>Reconnecting&hellip; online dots and new invites will catch up in a moment.</span>
        </div>
      )}

      {room && (
        <div className="ho-banner ho-banner--info" role="status">
          <span>
            Inviting to room <strong>{room}</strong>. Tap Invite next to a friend. Offline friends get it when they are back.
          </span>
          <Link to={paths.lobby(room)} className="ho-btn ho-btn--ghost ho-btn--sm">
            Back to lobby
          </Link>
        </div>
      )}

      <div className="ho-grid">
        <div className="ho-col adda-col--side">
          <FriendPass code={user.friendCode} onNotify={push} onShare={share} />

          {/* Add a friend: by name or @username, someone you just played with, or a friend code / link / @username */}
          <div className="ho-card adda-add">
            <AddFriendPanel compact onDone={() => load({ silent: true })} onNotify={push} />
          </div>

          <div className="adda-privacy">
            <PrivacyCard onNotify={push} />
          </div>
        </div>

        <div className="ho-col">
          <div className="adda-inbox">
            <InvitesInbox meId={user.id} />
          </div>

          {loadError ? (
            <section className="ho-card">
              <div className="ho-inline-error" role="alert">
                <span>{loadError.offline ? 'You are offline. Friends and invites need the server. We will try again when you are back.' : loadError.message}</span>
                <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={() => load()}>
                  Try again
                </button>
              </div>
            </section>
          ) : (
            <>
              {(!data || d.incoming.length > 0) && (
                <section id="requests" tabIndex={-1} className="ho-card adda-requests" aria-labelledby="adda-req-h">
                  <div className="ho-card__head">
                    <h2 id="adda-req-h" className="ho-h2">
                      Requests
                    </h2>
                    {d.incoming.length > 0 && <span className="ho-count">{d.incoming.length}</span>}
                  </div>
                  {!data ? (
                    <SkeletonRows n={1} />
                  ) : (
                    <ul className="ho-list" aria-label="Friend requests">
                      {incomingShown.map(({ key, item: u, leaving }) => (
                        <li key={key} className={`ho-row${leaving ? ' is-leaving' : ''}`} aria-hidden={leaving || undefined}>
                          <span className="ho-row__avatar">
                            <FriendAvatar person={u} size={44} />
                          </span>
                          <span className="ho-row__main">
                            <span className="ho-row__name">{u.name}</span>
                            <Handle person={u} />
                            <span className="ho-row__sub">
                              wants to be friends · Lv {u.level} <FriendTitle person={u} />
                            </span>
                          </span>
                          <span className="ho-row__actions">
                            <button type="button" className="ho-btn ho-btn--primary ho-btn--sm" onClick={() => f.accept(u)} disabled={!!busy[u.id] || leaving} aria-label={`Accept request from ${u.name}`}>
                              Accept
                            </button>
                            <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={() => f.decline(u)} disabled={!!busy[u.id] || leaving} aria-label={`Decline request from ${u.name}`}>
                              Decline
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <section className="ho-card adda-friends" aria-labelledby="adda-friends-h">
                <div className="ho-card__head">
                  <h2 id="adda-friends-h" className="ho-h2">
                    Your friends
                  </h2>
                  {data && d.friends.length > 0 && <span className="ho-count">{d.friends.length}</span>}
                </div>
                {!data ? (
                  <SkeletonRows />
                ) : friendsShown.length === 0 ? (
                  <p className="ho-empty">
                    No friends yet. Share your friend link, or add a friend by name, @username or code. Friends show up here with a green dot when they are online, and you can invite them to any game.
                  </p>
                ) : (
                  groups.map((g) => (
                    <div key={g.key} className={`adda-group adda-group--${g.key}`} role="group" aria-label={`${g.label}, ${g.count}`}>
                      <h3 className="adda-group__head">
                        {g.label} <span>{g.count}</span>
                      </h3>
                      <ul className="ho-list">
                        {g.items.map(({ key, item, leaving }) => (
                          <FriendRow
                            key={key}
                            f={item}
                            leaving={leaving}
                            room={room}
                            roomState={(fr) => f.invited[`${fr.id}:${room}`]}
                            busy={busy}
                            onOpen={setActionsFor}
                            onInvite={setActionsFor}
                            onInviteRoom={f.inviteTo}
                            onRemove={setConfirm}
                          />
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </section>

              {data && d.outgoing.length > 0 && (
                <section className="ho-card adda-sent" aria-labelledby="adda-sent-h">
                  <div className="ho-card__head">
                    <h2 id="adda-sent-h" className="ho-h2">
                      Sent requests
                    </h2>
                    <span className="ho-count">{d.outgoing.length}</span>
                  </div>
                  <ul className="ho-list" aria-label="Sent requests">
                    {d.outgoing.map((u) => (
                      <li key={u.id} className="ho-row">
                        <span className="ho-row__avatar">
                          <FriendAvatar person={u} size={44} />
                        </span>
                        <span className="ho-row__main">
                          <span className="ho-row__name">{u.name}</span>
                          <Handle person={u} />
                          <span className="ho-row__sub">Waiting for them to accept</span>
                        </span>
                        <span className="ho-row__actions">
                          <button type="button" className="ho-btn ho-btn--ghost ho-btn--sm" onClick={() => f.cancel(u)} disabled={!!busy[u.id]} aria-label={`Cancel request to ${u.name}`}>
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
        <FriendActionsSheet
          friend={actionsFor}
          room={room}
          inviteState={(c) => f.invited[`${actionsFor.id}:${c}`]}
          onInvite={f.inviteTo}
          onNewTable={(fr) => {
            setActionsFor(null);
            setInviteSheet(fr);
          }}
          onRemove={(fr) => {
            setActionsFor(null);
            setConfirm(fr);
          }}
          onBlock={(fr) => {
            setActionsFor(null);
            setBlockConfirm(fr);
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
          const fr = confirm;
          setConfirm(null);
          if (fr) f.remove(fr);
        }}
      />
      <ConfirmDialog
        open={!!blockConfirm}
        title={blockConfirm ? `Block ${blockConfirm.name}?` : ''}
        body="They will be removed from your friends and cannot send you requests or invites. You will not see their chat or hear their voice lines in rooms. You can unblock them under Privacy."
        confirmLabel="Block"
        danger
        onCancel={() => setBlockConfirm(null)}
        onConfirm={async () => {
          const fr = blockConfirm;
          setBlockConfirm(null);
          if (!fr) return;
          try {
            await blockPlayer(fr);
            push(`${fr.name} is blocked`, 'good');
          } catch (e) {
            push(errorMessage(e, `Could not block ${fr.name}`), 'bad');
          }
          load({ silent: true });
        }}
      />
      {node}
    </div>
  );
}
