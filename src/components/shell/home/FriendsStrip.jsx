import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import { useUserEvents } from '@/lib/auth.jsx';
import { presenceOf } from '@/components/online/friendsModel.js';
import { statusText } from '@/platform/social/PresenceBits.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Ava from '@/platform/home/Ava.jsx';
import { useApi, useApiGate } from '@/platform/home/useApi.js';
import { useLive } from '@/platform/home/store/live.js';
import { CineRow, CineSection } from '@/platform/home/CineRow.jsx';
import { Note } from '@/platform/home/HomeRows.jsx';
import { useAccount } from '../hooks.js';
import FriendSheet from './FriendSheet.jsx';
import '@/styles/x-home.css'; // .xh-fsheet: the friend quick-action sheet

/**
 * Home > "Friends online": your friends as round avatars (online first, cosmetic frames, a live dot), after an Invite
 * circle. Tapping a friend opens a quick-action sheet (invite to a table / view friends). Signed-out and guest players get
 * a sign-in prompt; network trouble degrades quietly.
 */
export default function FriendsStrip() {
  const [picked, setPicked] = useState(null);
  const { account, guest, loading } = useAccount();
  const { ready } = useApiGate();
  const shared = useLive();
  const own = useApi('/api/friends', { enabled: ready && account && !shared });
  const remote = shared ? shared.friends : own;
  const { data, reload } = remote;
  // `ready` is false while auth boots and when the API is unreachable (static dev); treat the latter as offline.
  const status = account && !ready && !loading ? 'offline' : remote.status;
  // live presence pushes (online / in a lobby / playing) on top of the loaded list
  const [live, setLive] = useState({});
  useUserEvents((msg) => {
    if (msg && msg.t === 'presence' && msg.userId != null) setLive((m) => ({ ...m, [msg.userId]: presenceOf(msg) }));
  }, ['presence']);
  useEffect(() => setLive({}), [data]); // a fresh answer from the server wins over older pushes
  const loaded = Array.isArray(data?.friends) ? data.friends : [];
  const friends = useMemo(
    () =>
      loaded.map((f) => {
        const { code, gameId, ...rest } = f;
        return { ...rest, ...presenceOf(live[f.id] ? live[f.id] : f) };
      }),
    [loaded, live],
  );
  const incoming = Array.isArray(data?.incoming) ? data.incoming.length : 0;
  const sorted = [...friends].sort((a, b) => Number(!!b.online) - Number(!!a.online));
  const online = friends.filter((f) => f.online).length;

  let body;
  if (loading || (account && (status === 'loading' || status === 'idle'))) {
    body = (
      <ul className="cj-row" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="cj-person">
            <span className="cj-home-skel cj-home-skel--round" />
            <span className="cj-home-skel cj-home-skel--line" />
          </li>
        ))}
      </ul>
    );
  } else if (!account) {
    body = (
      <Note icon="users" title={guest ? 'Friends need a full account' : 'Play with friends'} text={guest ? 'Guests can join tables. Sign in with Google to add friends and see who is online.' : 'Sign in to add friends, see who is online and invite them to a table.'}>
        <Link to={paths.login(paths.hub())} className="cj-btn cj-btn--primary cj-btn--sm">
          {guest ? 'Sign in with Google' : 'Sign in'}
        </Link>
      </Note>
    );
  } else if (status === 'auth' || status === 'offline' || status === 'error') {
    body = (
      <Note live icon="wifiOff" title={status === 'auth' ? 'Session expired' : 'Friends are offline'} text={status === 'auth' ? 'Sign in again to see your friends.' : 'We cannot reach the server right now.'}>
        {status === 'auth' ? (
          <Link to={paths.login(paths.hub())} className="cj-btn cj-btn--primary cj-btn--sm">
            Sign in
          </Link>
        ) : (
          <button type="button" className="cj-btn cj-btn--sm" onClick={reload}>
            <HubIcon name="refresh" size={16} /> Retry
          </button>
        )}
      </Note>
    );
  } else if (!friends.length) {
    body = (
      <Note icon="users" title="No friends yet" text="Share your friend code or link and invite people to a table.">
        <Link to={paths.friends()} className="cj-btn cj-btn--primary cj-btn--sm">
          <HubIcon name="plus" size={16} /> Add a friend
        </Link>
      </Note>
    );
  } else {
    body = (
      <CineRow label="Friends" count={sorted.length}>
        <li>
          <Link to={paths.friends()} className="cj-person cj-home-friend cj-home-friend--invite">
            <span className="cj-home-friend__plus" aria-hidden="true">
              <HubIcon name="plus" size={26} strokeWidth={2.2} />
            </span>
            Invite
            <small>Add a friend</small>
          </Link>
        </li>
        {sorted.slice(0, 14).map((f) => {
          const line = statusText(f);
          return (
            <li key={f.id}>
              <button type="button" className={`cj-person cj-home-friend ${f.online ? 'is-online' : ''}`} aria-haspopup="dialog" aria-label={`${f.name}, ${line.toLowerCase()}. Quick actions`} onClick={() => setPicked(f)}>
                <Ava preset={f.avatar} size={72} frame={f.equipped?.frame} dot={f.online ? 'on' : 'off'} />
                <span className="cj-home-friend__name">{f.name}</span>
                <small>{line}</small>
              </button>
            </li>
          );
        })}
      </CineRow>
    );
  }

  const showCount = account && status === 'ok' && friends.length > 0;
  const extra = (
    <>
      {showCount && (
        <span className="cj-home-count">
          {online > 0 && <i className="cj-live-dot" aria-hidden="true" />} {online} online
        </span>
      )}
      {account && (
        <Link to={paths.friends()} className="cj-home-more">
          {incoming ? `${incoming} request${incoming > 1 ? 's' : ''}` : 'Manage'}
        </Link>
      )}
    </>
  );
  return (
    <CineSection id="home-friends" title="Friends online" data-tour="home-friends" className="cj-home-friends" extra={extra}>
      {body}
      {picked && <FriendSheet friend={picked} onClose={() => setPicked(null)} />}
    </CineSection>
  );
}
