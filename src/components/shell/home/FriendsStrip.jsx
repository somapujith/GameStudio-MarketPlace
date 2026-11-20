import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import { useUserEvents } from '@/lib/auth.jsx';
import { presenceOf } from '@/components/online/friendsModel.js';
import { StatusText, statusText } from '@/platform/social/PresenceBits.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Ava from '@/platform/home/Ava.jsx';
import { useApi, useApiGate } from '@/platform/home/useApi.js';
import { useLive } from '@/platform/home/store/live.js';
import { useAccount } from '../hooks.js';
import { BRAND } from '@/platform/brand.js';
import IndiaArt from '@/components/art/IndiaArt.jsx';
import FriendSheet from './FriendSheet.jsx';
import Framed from './Framed.jsx';
import '@/platform/home/adda.css';

/** A friendly inline message with an optional action, used for every non-list state of the strip. */
function Prompt({ icon, title, children, action, quiet }) {
  return (
    <div className={`hh2-prompt ${quiet ? 'hh2-prompt--quiet' : ''}`}>
      <span className="hh2-prompt__icon" aria-hidden="true">
        <HubIcon name={icon} size={22} />
      </span>
      <p className="hh2-prompt__text">
        <b>{title}</b>
        <span>{children}</span>
      </p>
      {action}
    </div>
  );
}

/**
 * Home > "The Adda" strip: friends online (online first, cosmetic frames). Tapping a friend opens a quick-action sheet
 * (invite to a table / view friends). Signed-out and guest players get a sign-in prompt; network trouble degrades quietly.
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
      <ul className="hub-row hub-row--tight hh2-friends__rail" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="hh2-friend">
            <span className="hub-skel hub-skel--dot" style={{ width: 58, height: 58 }} />
            <span className="hub-skel hub-skel--line" style={{ width: 44, height: 10 }} />
          </li>
        ))}
      </ul>
    );
  } else if (!account) {
    body = (
      <Prompt
        icon="users"
        title={guest ? 'Friends need a full account' : 'Play with friends'}
        action={
          <Link to={paths.login(paths.hub())} className="hub-btn hub-btn--primary hub-btn--sm">
            {guest ? 'Sign in with Google' : 'Sign in'}
          </Link>
        }
      >
        {guest ? 'Guests can join tables. Sign in with Google to add friends and see who is online.' : 'Sign in to add friends, see who is online and invite them to a table.'}
      </Prompt>
    );
  } else if (status === 'auth' || status === 'offline' || status === 'error') {
    body = (
      <Prompt
        quiet
        icon="wifiOff"
        title={status === 'auth' ? 'Session expired' : 'Friends are offline'}
        action={
          status === 'auth' ? (
            <Link to={paths.login(paths.hub())} className="hub-btn hub-btn--primary hub-btn--sm">
              Sign in
            </Link>
          ) : (
            <button type="button" className="hub-btn hub-btn--soft hub-btn--sm" onClick={reload}>
              <HubIcon name="refresh" size={16} /> Retry
            </button>
          )
        }
      >
        {status === 'auth' ? 'Sign in again to see your friends.' : 'We cannot reach the server right now.'}
      </Prompt>
    );
  } else if (!friends.length) {
    body = (
      <Prompt
        icon="users"
        title="No friends yet"
        action={
          <Link to={paths.friends()} className="hub-btn hub-btn--primary hub-btn--sm">
            <HubIcon name="plus" size={16} /> Add a friend
          </Link>
        }
      >
        Share your friend code or link and invite people to a table.
      </Prompt>
    );
  } else {
    body = (
      <ul className="hub-row hub-row--tight hh2-friends__rail">
        <li>
          <Link to={paths.friends()} className="hh2-friend hh2-friend--invite">
            <span className="hh2-friend__plus" aria-hidden="true">
              <HubIcon name="plus" size={22} strokeWidth={2.4} />
            </span>
            <span className="hh2-friend__name">Invite</span>
          </Link>
        </li>
        {sorted.slice(0, 14).map((f) => (
          <li key={f.id}>
            <button
              type="button"
              className={`hh2-friend xh-friend ${f.online ? 'is-online' : ''}`}
              aria-haspopup="dialog"
              aria-label={`${f.name}, ${statusText(f).toLowerCase()}. Quick actions`}
              onClick={() => setPicked(f)}
            >
              <Framed frame={f.equipped?.frame} size={56}>
                <Ava preset={f.avatar} size={56} dot={f.online ? 'on' : 'off'} />
              </Framed>
              <span className="hh2-friend__name">{f.name}</span>
              {(f.status === 'lobby' || f.status === 'playing') && <StatusText friend={f} className="pr-cap" />}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  const showCount = account && status === 'ok' && friends.length > 0;
  return (
    <section data-tour="home-friends" className="hub-section hh2-friends adda-space" aria-labelledby="hh2-friends-h">
      <div className="hub-section__head">
        <h2 id="hh2-friends-h" className="hub-section__title">
          The Adda
          {showCount && <span className="hub-pill hub-pill--good hh2-pill-gap">{online} online</span>}
        </h2>
        {account && (
          <Link to={paths.friends()} className="hub-section__more">
            {incoming ? `${incoming} request${incoming > 1 ? 's' : ''}` : 'Manage'}
          </Link>
        )}
      </div>
      <div className="adda-space__layout">
        <div className="adda-table">
          <p className="adda-kicker">Good company. Better games.</p>
          {!friends.length && !loading && (
            <div className="adda-table__seats" aria-hidden="true">
              {[0, 1, 2, 3].map((seat) => <span key={seat}><HubIcon name="plus" size={18} /> Empty seat</span>)}
            </div>
          )}
          {body}
          <div className="adda-table__actions">
            <Link to={paths.game(BRAND.defaultGameId)} className="hub-btn hub-btn--primary">Create a table</Link>
            <Link to={paths.join()} className="hub-btn hub-btn--soft">Join with a code <HubIcon name="chevR" size={16} /></Link>
          </div>
        </div>
        <IndiaArt art="gully-cricket" className="adda-space__art" />
      </div>
      {picked && <FriendSheet friend={picked} onClose={() => setPicked(null)} />}
    </section>
  );
}
