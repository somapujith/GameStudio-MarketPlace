import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { errorMessage } from '@/lib/api.js';
import { useAuth, useUserSocket } from '@/lib/auth.jsx';
import { paths } from '@/platform/paths.js';
import { canShare, shareOrCopy } from '@/components/online/clipboard.js';
import { friendInviteMessage, isRoomCode, normalizeRoomCode, parseFriendLink } from '@/components/online/codes.js';
import ConfirmDialog from '@/components/online/ConfirmDialog.jsx';
import { usePresence } from '@/components/online/InviteBanner.jsx';
import InviteToGameSheet from '@/components/online/InviteToGameSheet.jsx';
import { Loading } from '@/components/online/StatusPanel.jsx';
import { useToasts } from '@/components/online/Toasts.jsx';
import { countOnline, emptyFriends } from '@/components/online/friendsModel.js';
import AddFriendPanel from '@/platform/social/AddFriendPanel.jsx';
import FriendActionsSheet from '@/platform/social/FriendActionsSheet.jsx';
import FriendCodeCard from '@/platform/social/FriendCodeCard.jsx';
import FriendsGate from '@/platform/social/FriendsGate.jsx';
import InvitesInbox from '@/platform/social/InvitesInbox.jsx';
import PrivacyCard from '@/platform/social/PrivacyCard.jsx';
import { blockPlayer } from '@/platform/social/blockStore.js';
import { FriendsEmpty, FriendsList, IncomingRequests, RowSkeleton, SentRequests } from '@/platform/social/Rows.jsx';
import SIcon from '@/platform/social/SIcon.jsx';
import SocialHead from '@/platform/social/SocialHead.jsx';
import StateCard from '@/platform/social/StateCard.jsx';
import useFriends from '@/platform/social/useFriends.js';
import '@/styles/online.css';
import '@/styles/x-social.css';
import '@/styles/store-social.css';
import '@/styles/hubMoments.css';

const byId = (u) => String(u.id);

/** /friends: the People tab. */
export default function Friends() {
  const { user, loading, reachable, refresh } = useAuth();
  if (loading) {
    return (
      <div className="ho-page">
        <Loading text="Loading friends..." />
      </div>
    );
  }
  if (!user && reachable === false) {
    return (
      <div className="hub-page sc-page st-scope sc-gatepage">
        <StateCard
          icon="wifiOff"
          tone="warn"
          title="You are offline"
          actions={[{ label: 'Try again', icon: 'refresh', onClick: () => refresh?.(), primary: true }]}
        >
          Friends and invites need a connection to the server. Reconnect and try again.
        </StateCard>
      </div>
    );
  }
  if (!user || user.isGuest) return <FriendsGate guest={!!user} />;
  return <FriendsInner user={user} />;
}

function Card({ id, anchor, order, title, count, tone, children, className = '' }) {
  return (
    <section id={anchor} tabIndex={anchor ? -1 : undefined} className={`sc-card ${order} ${className}`.trim()} aria-labelledby={id}>
      <div className="sc-card__head">
        <h2 id={id} className="sc-card__title">
          {title}
        </h2>
        {count > 0 && <span className={`sc-count${tone ? ` sc-count--${tone}` : ''}`}>{count}</span>}
      </div>
      {children}
    </section>
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

  // phones: the actionable cards first; with nobody added yet the code card comes before the empty list
  const noFriends = !!data && d.friends.length === 0;
  const o = noFriends ? { sign: 'sc-o3', add: 'sc-o4', friends: 'sc-o5', sent: 'sc-o6' } : { friends: 'sc-o3', sent: 'sc-o4', sign: 'sc-o5', add: 'sc-o6' };

  return (
    <div className="hub-page sc-page st-scope sc-friends">
      <SocialHead
        eyebrow="People"
        title="Friends"
        sub="Add people once, then invite them to any game."
        id="sc-title"
        aside={
          data && d.friends.length > 0 ? (
            <span className="sc-livechip">
              <span className="st-live" aria-hidden="true" />
              {online} online
            </span>
          ) : null
        }
      />

      {socketStatus === 'reconnecting' && (
        <div className="sc-note sc-note--warn" role="status">
          <span>Reconnecting&hellip; online dots and new invites will catch up in a moment.</span>
        </div>
      )}

      {room && (
        <div className="sc-banner" role="status">
          <SIcon name="table" size={20} />
          <span>
            Inviting to room <strong>{room}</strong>. Tap Invite next to a friend. Offline friends get it when they are back.
          </span>
          <Link to={paths.lobby(room)} className="hub-btn hub-btn--ghost hub-btn--sm">
            Back to lobby
          </Link>
        </div>
      )}

      <div className="sc-grid">
        <div className="sc-col sc-col--main">
          <div className="sc-o1">
            <InvitesInbox meId={user.id} />
          </div>

          {loadError ? (
            <div className="sc-o2">
              <StateCard
                icon={loadError.offline ? 'wifiOff' : 'refresh'}
                tone={loadError.offline ? 'warn' : 'bad'}
                title={loadError.offline ? 'You are offline' : 'Could not load your friends'}
                actions={[{ label: 'Try again', icon: 'refresh', onClick: () => load(), primary: true }]}
              >
                {loadError.offline ? 'Friends and invites need the server. We will try again when you are back.' : loadError.message}
              </StateCard>
            </div>
          ) : (
            <>
              {(!data || d.incoming.length > 0) && (
                <Card id="sc-req-h" anchor="requests" order="sc-o2" title="Requests" count={d.incoming.length} tone="gold">
                  {!data ? <RowSkeleton n={1} /> : <IncomingRequests shown={incomingShown} busy={busy} onAccept={f.accept} onDecline={f.decline} />}
                </Card>
              )}

              <Card id="sc-friends-h" order={o.friends} title="Your friends" count={data ? d.friends.length : 0}>
                {!data ? (
                  <RowSkeleton />
                ) : friendsShown.length === 0 ? (
                  <FriendsEmpty onShare={share} canUseShare={canShare()} disabled={!user.friendCode} />
                ) : (
                  <FriendsList
                    shown={friendsShown}
                    room={room}
                    roomState={(fr) => f.invited[`${fr.id}:${room}`]}
                    busy={busy}
                    onOpen={setActionsFor}
                    onInvite={setActionsFor}
                    onInviteRoom={f.inviteTo}
                    onRemove={setConfirm}
                  />
                )}
              </Card>

              {data && d.outgoing.length > 0 && (
                <Card id="sc-sent-h" order={o.sent} title="Sent requests" count={d.outgoing.length}>
                  <SentRequests list={d.outgoing} busy={busy} onCancel={f.cancel} />
                </Card>
              )}
            </>
          )}
        </div>

        <div className="sc-col sc-col--side">
          <div className={o.sign}>
            <FriendCodeCard code={user.friendCode} onNotify={push} />
          </div>
          <div className={o.add}>
            <AddFriendPanel onDone={() => load({ silent: true })} onNotify={push} />
          </div>
          <div className="bl-o7">
            <PrivacyCard onNotify={push} />
          </div>
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
