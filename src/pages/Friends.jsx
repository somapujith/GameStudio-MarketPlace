import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { errorMessage } from '@/lib/api.js';
import { useAuth, useUserSocket } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { canShare, shareOrCopy, useCopied } from '@/components/online/clipboard.js';
import { friendInviteMessage, friendLinkUrl, friendShareText, isRoomCode, normalizeRoomCode, parseFriendLink } from '@/components/online/codes.js';
import ConfirmDialog from '@/components/online/ConfirmDialog.jsx';
import { useInvites, usePresence } from '@/components/online/InviteBanner.jsx';
import { FriendAvatar, FriendTitle } from '@/components/online/InviteFriends.jsx';
import InviteToGameSheet from '@/components/online/InviteToGameSheet.jsx';
import { Loading } from '@/components/online/StatusPanel.jsx';
import { useToasts } from '@/components/online/Toasts.jsx';
import { countOnline, emptyFriends, handleLabel } from '@/components/online/friendsModel.js';
import AddFriendPanel from '@/platform/social/AddFriendPanel.jsx';
import FriendActionsSheet from '@/platform/social/FriendActionsSheet.jsx';
import InvitesInbox from '@/platform/social/InvitesInbox.jsx';
import PrivacyCard from '@/platform/social/PrivacyCard.jsx';
import { blockPlayer } from '@/platform/social/blockStore.js';
import { JoinButton, StatusText, canJoin, statusText } from '@/platform/social/PresenceBits.jsx';
import useFriends from '@/platform/social/useFriends.js';
import { Avatar } from '@/components/art/index.js';
import SIcon, { WhatsAppIcon } from '@/platform/social/SIcon.jsx';
import '@/styles/online.css';
import '@/styles/store-social.css';
import '@/styles/handle.css';
import '@/styles/cine.css';
import '@/styles/cine/bridge.css';
import '@/styles/cine/adda.css';

const byId = (u) => String(u.id);

/** Invite-to-room button label per feedback state (idle | sending | sent | saved | joined | declined). */
const ROOM_INVITE_LABEL = { sending: 'Sending...', sent: 'Invited', saved: 'Saved', joined: 'Joined', declined: 'Declined' };

/** The page frame: the blurred ambient field behind everything, then the page content. */
function AddaPage({ children }) {
  return (
    <div className="cj-scope cj-adda">
      <div className="cj-ambient cj-amb-art cj-adda-ambient" aria-hidden="true" />
      {children}
    </div>
  );
}

/**
 * "The Adda" as a cine page title. `tabs` are dim siblings beside it (Requests 2, Invites 1) that jump to their section;
 * `heading={false}` keeps a single h1 on the page when a gate card below carries its own.
 */
function AddaHead({ heading = true, tabs = [], children }) {
  const Title = heading ? 'h1' : 'p';
  return (
    <header className="cj-adda-head">
      <div className="cj-pagehead cj-adda-head__row">
        <Title className="cj-pagehead__title">The Adda</Title>
        {tabs.map((t) => (
          <Link key={t.hash} to={t.to} className="cj-pagehead__tab cj-adda-tab">
            {t.label}
            <span className="cj-adda-tab__n" aria-label={`, ${t.count} waiting`}>
              {t.count}
            </span>
          </Link>
        ))}
      </div>
      <div className="cj-adda-head__lede">
        <p className="cj-lede">Your people, your table. Add friends once, then invite them to any game.</p>
        {children}
      </div>
    </header>
  );
}

/** A row of the dashed-card empty state's art: a glass circle with an icon (like an empty folder with a plus). */
function EmptyArt({ icon = 'userPlus' }) {
  return (
    <span className="cj-empty__art cj-adda-empty__art" aria-hidden="true">
      <span className="cj-adda-empty__plus">
        <SIcon name={icon} size={20} />
      </span>
    </span>
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
    <ul className="ho-list cj-adda-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="ho-row ho-skel-row cj-adda-row" aria-hidden="true">
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
      <AddaPage>
        <AddaHead />
        <div className="cj-adda-gate">
          <Loading text="Loading friends..." />
        </div>
      </AddaPage>
    );
  }
  if (!user && reachable === false) {
    return (
      <AddaPage>
        <AddaHead heading={false} />
        <section className="cj-empty cj-adda-empty" role="status" aria-labelledby="cj-adda-gate-h">
          <EmptyArt icon="refresh" />
          <h1 id="cj-adda-gate-h" className="cj-empty__title">
            You are offline
          </h1>
          <p className="cj-empty__body">Friends and invites need a connection to the server. Reconnect and try again.</p>
          <div className="cj-empty__actions">
            <button type="button" className="cj-btn cj-btn--primary" onClick={() => refresh?.()}>
              <SIcon name="refresh" size={17} /> Try again
            </button>
          </div>
        </section>
      </AddaPage>
    );
  }
  if (!user || user.isGuest) {
    const here = paths.friends() + (typeof window !== 'undefined' ? window.location.search : '');
    return (
      <AddaPage>
        <AddaHead heading={false} />
        <section className="cj-empty cj-adda-empty" aria-labelledby="cj-adda-gate-h">
          <EmptyArt />
          <h1 id="cj-adda-gate-h" className="cj-empty__title">
            {user ? 'Friends are for Google accounts' : 'Sign in to add friends'}
          </h1>
          <p className="cj-empty__body">
            {user
              ? 'Guests can host and join rooms with a code or link. Sign in with Google to add friends, see who is online and invite them to a game in one tap.'
              : 'Add friends with a friend link or their @username, see who is online and invite them to a game in one tap. Invites wait for them, even when they were offline.'}
          </p>
          <div className="cj-empty__actions">
            <Link to={paths.login(here)} className="cj-btn cj-btn--primary">
              <SIcon name="users" size={17} /> {user ? 'Sign in with Google' : 'Sign in'}
            </Link>
            <Link to={paths.join()} className="cj-btn">
              <SIcon name="table" size={17} /> Join a room with a code
            </Link>
          </div>
          <ol className="cj-adda-steps" aria-label="How the Adda works">
            <li>
              <b>1</b>
              <span>Share your friend link</span>
            </li>
            <li>
              <b>2</b>
              <span>They add you in one tap</span>
            </li>
            <li>
              <b>3</b>
              <span>Invite them to any game</span>
            </li>
          </ol>
        </section>
      </AddaPage>
    );
  }
  return <FriendsInner user={user} />;
}

/** Your friend code as a calm glass pass: the code, the link (copy, WhatsApp, share) and a QR code on demand. */
function FriendPass({ code, onNotify, onShare }) {
  const [codeCopied, copyCode] = useCopied();
  const [linkCopied, copyLink] = useCopied();
  const [qr, setQr] = useState(false);
  const link = code ? friendLinkUrl(code) : '';
  const whatsapp = code ? `https://wa.me/?text=${encodeURIComponent(friendShareText(code))}` : undefined;
  return (
    <section className="cj-adda-pass" aria-label="Your friend link">
      <div className="cj-adda-pass__top">
        <span className="cj-adda-eyebrow">Your friend code</span>
        <button
          type="button"
          className={`cj-chip cj-adda-pass__qrbtn${qr ? ' is-on' : ''}`}
          onClick={() => setQr((v) => !v)}
          aria-expanded={qr}
          aria-controls="adda-pass-qr"
          disabled={!link}
        >
          <SIcon name="qr" size={15} /> {qr ? 'Hide QR' : 'Show QR'}
        </button>
      </div>
      <div className="cj-adda-pass__code" aria-label={`Your friend code ${code}`}>
        {code || '...'}
      </div>
      <div id="adda-pass-qr" className="cj-adda-pass__qr" hidden={!qr || !link}>
        {qr && link && <QRCodeSVG value={link} size={140} level="M" marginSize={2} bgColor="#ffffff" fgColor="#0a0a0b" title={`QR code for ${link}`} />}
        <span>Scan to add me</span>
      </div>
      <div className="cj-adda-pass__link">
        <input className="cj-input cj-adda-pass__input" readOnly value={link} aria-label="Your friend link" onFocus={(e) => e.target.select()} placeholder="Your friend link" />
        <button
          type="button"
          className="cj-btn cj-btn--sm cj-adda-pass__copy"
          onClick={async () => {
            if (!(await copyLink(link))) onNotify('Could not copy the link.', 'bad');
          }}
          disabled={!link}
        >
          {linkCopied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
      <div className="cj-adda-pass__actions">
        <button type="button" className="cj-btn cj-btn--primary cj-adda-pass__share" onClick={onShare} disabled={!code}>
          <SIcon name="share" size={17} /> {canShare() ? 'Share link' : 'Copy invite'}
        </button>
        <button
          type="button"
          className="cj-btn"
          onClick={async () => {
            if (!(await copyCode(code))) onNotify('Could not copy. Select the code and copy it manually.', 'bad');
          }}
          disabled={!code}
        >
          <SIcon name={codeCopied ? 'check' : 'copy'} size={16} /> {codeCopied ? 'Copied!' : 'Copy code'}
        </button>
        <a className="cj-iconbtn cj-adda-pass__wa" href={whatsapp} target="_blank" rel="noopener noreferrer" aria-disabled={!code || undefined} aria-label="Share on WhatsApp" title="WhatsApp">
          <WhatsAppIcon size={19} />
        </a>
      </div>
      <p className="cj-adda-pass__note">Anyone who opens your link can add you in one tap. No account needed to look.</p>
    </section>
  );
}

/** A friend who is online right now, as a round portrait (like a cast circle). Tap for their quick actions. */
function OnlinePerson({ f, leaving, onOpen }) {
  return (
    <li className={`cj-adda-person${leaving ? ' is-leaving' : ''}`} aria-hidden={leaving || undefined}>
      <button
        type="button"
        className="cj-person cj-adda-person__open"
        onClick={() => onOpen(f)}
        disabled={leaving}
        aria-haspopup="dialog"
        aria-label={`${f.name}, ${statusText(f).toLowerCase()}. Open actions`}
      >
        <span className="cj-adda-person__ava">
          <Avatar preset={Number.isInteger(f.avatar) ? f.avatar : 0} size={72} />
          <span className="cj-live-dot cj-adda-person__dot" aria-hidden="true" />
        </span>
        <span className="cj-adda-person__name">{f.name}</span>
        <small>{statusText(f)}</small>
      </button>
      {canJoin(f) && <JoinButton friend={f} disabled={leaving} className="cj-btn cj-btn--primary cj-btn--sm cj-adda-person__join" />}
    </li>
  );
}

/** One friend: tap the row for their quick actions (invite to a table, copy their code, remove, block). */
function FriendRow({ f, leaving, room, roomState, busy, onOpen, onInviteRoom, onInvite, onRemove }) {
  const st = room ? roomState(f) : undefined;
  const done = st === 'sent' || st === 'saved' || st === 'joined' || st === 'declined';
  return (
    <li className={`ho-row cj-adda-row adda-friend${f.online ? ' is-online' : ''}${leaving ? ' is-leaving' : ''}`} aria-hidden={leaving || undefined}>
      <button
        type="button"
        className="cj-adda-row__open"
        onClick={() => onOpen(f)}
        disabled={leaving}
        aria-haspopup="dialog"
        aria-label={`${f.name}, ${statusText(f).toLowerCase()}, level ${f.level}. Open actions`}
      >
        <span className="cj-adda-row__ava">
          <FriendAvatar person={f} size={44} />
          <Dot online={f.online} />
        </span>
        <span className="cj-adda-row__main">
          <span className="cj-adda-row__name">{f.name}</span>
          <Handle person={f} />
          <span className="cj-adda-row__sub">
            <StatusText friend={f} /> · Lv {f.level} <FriendTitle person={f} />
          </span>
        </span>
      </button>
      <span className="cj-adda-row__actions">
        {!room && canJoin(f) && <JoinButton friend={f} disabled={leaving} className="cj-btn cj-btn--primary cj-btn--sm" />}
        {room ? (
          <button
            type="button"
            className={`cj-btn cj-btn--sm${done ? '' : ' cj-btn--primary'}`}
            onClick={() => onInviteRoom(f, room)}
            disabled={st === 'sending' || done || leaving}
            aria-label={`Invite ${f.name} to room ${room}`}
          >
            {ROOM_INVITE_LABEL[st] || 'Invite'}
          </button>
        ) : (
          <button
            type="button"
            className={`cj-btn cj-btn--sm${f.online && !canJoin(f) ? ' cj-btn--primary' : ''}`}
            onClick={() => onInvite(f)}
            disabled={leaving}
            title={f.online ? undefined : `${f.name} is offline: they will see the invite when they are back`}
            aria-label={`Invite ${f.name} to a game`}
          >
            <span className="cj-adda-narrow">Invite</span>
            <span className="cj-adda-wide">Invite to game</span>
          </button>
        )}
        <button type="button" className="cj-iconbtn cj-adda-row__remove" onClick={() => onRemove(f)} disabled={!!busy[f.id] || leaving} aria-label={`Remove ${f.name} from friends`}>
          <SIcon name="trash" size={16} />
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
  const { invites } = useInvites();
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
  const onlineShown = friendsShown.filter((s) => s.item.online);

  // dim sibling "tabs" beside the title: they jump to (and, for requests, focus) their section
  const jump = (hash) => ({ pathname: location.pathname, search: location.search, hash });
  const tabs = [
    data && d.incoming.length > 0 && { hash: '#requests', to: jump('#requests'), label: 'Requests', count: d.incoming.length },
    invites.length > 0 && { hash: '#invites', to: jump('#invites'), label: 'Invites', count: invites.length },
  ].filter(Boolean);

  const findByName = () => {
    const el = document.querySelector('.cj-adda-add input[type="search"]');
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  };

  return (
    <AddaPage>
      <AddaHead tabs={tabs}>
        {data && (
          <ul className="cj-meta cj-adda-stats" aria-label="Your Adda">
            <li>
              {d.friends.length} {d.friends.length === 1 ? 'friend' : 'friends'}
            </li>
            <li className={online > 0 ? 'is-live' : undefined}>
              {online > 0 && <span className="cj-live-dot" aria-hidden="true" />}
              {online} online
            </li>
            <li>
              {d.incoming.length} {d.incoming.length === 1 ? 'request' : 'requests'}
            </li>
          </ul>
        )}
      </AddaHead>

      <div className="cj-adda-body">
        {socketStatus === 'reconnecting' && (
          <div className="ho-banner ho-banner--warn cj-adda-banner" role="status">
            <span>Reconnecting&hellip; online dots and new invites will catch up in a moment.</span>
          </div>
        )}

        {room && (
          <div className="ho-banner ho-banner--info cj-adda-banner" role="status">
            <span>
              Inviting to room <strong>{room}</strong>. Tap Invite next to a friend. Offline friends get it when they are back.
            </span>
            <Link to={paths.lobby(room)} className="cj-btn cj-btn--sm">
              Back to lobby
            </Link>
          </div>
        )}

        <div className="cj-adda-grid">
          <div className="cj-adda-main">
            <div className="cj-adda-inbox">
              <InvitesInbox meId={user.id} />
            </div>

            {loadError ? (
              <section className="cj-adda-panel">
                <div className="ho-inline-error cj-adda-error" role="alert">
                  <span>{loadError.offline ? 'You are offline. Friends and invites need the server. We will try again when you are back.' : loadError.message}</span>
                  <button type="button" className="cj-btn cj-btn--sm" onClick={() => load()}>
                    Try again
                  </button>
                </div>
              </section>
            ) : (
              <>
                {(!data || d.incoming.length > 0) && (
                  <section id="requests" tabIndex={-1} className="cj-adda-panel cj-adda-requests" aria-labelledby="adda-req-h">
                    <div className="cj-adda-panel__head">
                      <h2 id="adda-req-h" className="cj-adda-h2">
                        Requests
                      </h2>
                      {d.incoming.length > 0 && <span className="cj-adda-count">{d.incoming.length}</span>}
                    </div>
                    {!data ? (
                      <SkeletonRows n={1} />
                    ) : (
                      <ul className="ho-list cj-adda-list" aria-label="Friend requests">
                        {incomingShown.map(({ key, item: u, leaving }) => (
                          <li key={key} className={`ho-row cj-adda-row${leaving ? ' is-leaving' : ''}`} aria-hidden={leaving || undefined}>
                            <span className="cj-adda-row__open is-static">
                              <span className="cj-adda-row__ava">
                                <FriendAvatar person={u} size={44} />
                              </span>
                              <span className="cj-adda-row__main">
                                <span className="cj-adda-row__name">{u.name}</span>
                                <Handle person={u} />
                                <span className="cj-adda-row__sub">
                                  wants to be friends · Lv {u.level} <FriendTitle person={u} />
                                </span>
                              </span>
                            </span>
                            <span className="cj-adda-row__actions">
                              <button type="button" className="cj-btn cj-btn--primary cj-btn--sm" onClick={() => f.accept(u)} disabled={!!busy[u.id] || leaving} aria-label={`Accept request from ${u.name}`}>
                                Accept
                              </button>
                              <button type="button" className="cj-btn cj-btn--sm" onClick={() => f.decline(u)} disabled={!!busy[u.id] || leaving} aria-label={`Decline request from ${u.name}`}>
                                Decline
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                {data && onlineShown.length > 0 && (
                  <section className="cj-adda-online" aria-labelledby="adda-online-h">
                    <div className="cj-adda-section__head">
                      <h2 id="adda-online-h" className="cj-section__title">
                        Online now
                      </h2>
                      <span className="cj-live-dot" aria-hidden="true" />
                    </div>
                    <ul className="cj-adda-people" aria-label="Friends online now">
                      {onlineShown.map(({ key, item, leaving }) => (
                        <OnlinePerson key={key} f={item} leaving={leaving} onOpen={setActionsFor} />
                      ))}
                    </ul>
                  </section>
                )}

                <section className="cj-adda-panel adda-friends" aria-labelledby="adda-friends-h">
                  <div className="cj-adda-panel__head">
                    <h2 id="adda-friends-h" className="cj-adda-h2">
                      Your friends
                    </h2>
                    {data && d.friends.length > 0 && <span className="cj-adda-count">{d.friends.length}</span>}
                  </div>
                  {!data ? (
                    <SkeletonRows />
                  ) : friendsShown.length === 0 ? (
                    <div className="cj-empty cj-adda-empty cj-adda-empty--inline">
                      <EmptyArt />
                      <h3 className="cj-empty__title">Start your Adda</h3>
                      <p className="cj-empty__body">
                        Share your friend link, or add a friend by name, @username or code. Friends show up here with a green dot when they are online, and you can invite them to any game.
                      </p>
                      <div className="cj-empty__actions">
                        <button type="button" className="cj-btn cj-btn--primary" onClick={share}>
                          <SIcon name="share" size={17} /> Share my link
                        </button>
                        <button type="button" className="cj-btn" onClick={findByName}>
                          <SIcon name="users" size={17} /> Find by name
                        </button>
                      </div>
                    </div>
                  ) : (
                    groups.map((g) => (
                      <div key={g.key} className={`cj-adda-group cj-adda-group--${g.key}`} role="group" aria-label={`${g.label}, ${g.count}`}>
                        <h3 className="cj-adda-group__head">
                          {g.label} <span>{g.count}</span>
                        </h3>
                        <ul className="ho-list cj-adda-list">
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
                  <section className="cj-adda-panel adda-sent" aria-labelledby="adda-sent-h">
                    <div className="cj-adda-panel__head">
                      <h2 id="adda-sent-h" className="cj-adda-h2">
                        Sent requests
                      </h2>
                      <span className="cj-adda-count">{d.outgoing.length}</span>
                    </div>
                    <ul className="ho-list cj-adda-list" aria-label="Sent requests">
                      {d.outgoing.map((u) => (
                        <li key={u.id} className="ho-row cj-adda-row">
                          <span className="cj-adda-row__open is-static">
                            <span className="cj-adda-row__ava">
                              <FriendAvatar person={u} size={44} />
                            </span>
                            <span className="cj-adda-row__main">
                              <span className="cj-adda-row__name">{u.name}</span>
                              <Handle person={u} />
                              <span className="cj-adda-row__sub">Waiting for them to accept</span>
                            </span>
                          </span>
                          <span className="cj-adda-row__actions">
                            <button type="button" className="cj-btn cj-btn--sm" onClick={() => f.cancel(u)} disabled={!!busy[u.id]} aria-label={`Cancel request to ${u.name}`}>
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

          <aside className="cj-adda-side" aria-label="Add friends">
            <FriendPass code={user.friendCode} onNotify={push} onShare={share} />

            {/* Add a friend: by name or @username, someone you just played with, or a friend code / link / @username */}
            <div className="cj-adda-panel cj-adda-add">
              <AddFriendPanel compact onDone={() => load({ silent: true })} onNotify={push} />
            </div>

            <div className="cj-adda-privacy">
              <PrivacyCard onNotify={push} />
            </div>
          </aside>
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
    </AddaPage>
  );
}
