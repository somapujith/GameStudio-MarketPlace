import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/art/index.js';
import { paths } from '@/platform/paths.js';
import GameIcon from '@/components/online/GameIcon.jsx';
import { gameName, gameOf } from '@/components/online/games.js';
import { setInvitesUser, useInvites, useNow, usePresence } from '@/components/online/InviteBanner.jsx';
import { inviteExpiryLabel, relativeTime } from '@/components/online/friendsModel.js';
import SIcon from './SIcon.jsx';

/** The game-invites inbox: invites stored while you were away plus live ones, each with Join / Dismiss and an expiry. */
export default function InvitesInbox({ meId }) {
  const { invites, status, refresh, dismiss } = useInvites();
  const now = useNow(30000);
  const shown = usePresence(invites, (i) => i.key);

  useEffect(() => {
    setInvitesUser(meId); // no-op when the app-wide banner already did it
    refresh({ force: true });
  }, [meId, refresh]);

  // nothing to show: no card at all (it appears, animated, when an invite arrives)
  if (shown.length === 0 && status !== 'offline' && status !== 'error') return null;
  return (
    <section className="sc-card sc-inbox" id="invites" aria-labelledby="sc-inbox-h">
      <div className="sc-card__head">
        <h2 id="sc-inbox-h" className="sc-card__title">
          Game invites
        </h2>
        {invites.length > 0 && (
          <span className="sc-count sc-count--warn" aria-label={`${invites.length} pending`}>
            {invites.length}
          </span>
        )}
      </div>
      {status === 'offline' && (
        <div className="sc-note" role="status">
          <span>You are offline. New invites show up when you are back.</span>
          <button type="button" className="hub-btn hub-btn--ghost hub-btn--sm" onClick={() => refresh({ force: true })}>
            Retry
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="sc-note sc-note--bad" role="alert">
          <span>Could not load your invites.</span>
          <button type="button" className="hub-btn hub-btn--ghost hub-btn--sm" onClick={() => refresh({ force: true })}>
            Try again
          </button>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="sc-list" aria-label="Pending invites">
          {shown.map(({ key, item: inv, leaving }, i) => {
            const game = gameOf(inv.gameId);
            const gName = inv.gameName || (inv.gameId ? gameName(inv.gameId, game) : 'a game');
            const expiry = inviteExpiryLabel(inv.createdAt, now);
            return (
              <li key={key} className={`sc-row sc-invite sc-enter${leaving ? ' is-leaving' : ''}`} style={{ '--i': i }} aria-hidden={leaving || undefined}>
                <span className="sc-invite__icon">
                  <GameIcon game={game} name={gName} size={46} />
                  <span className="sc-invite__from">
                    <Avatar preset={inv.from.avatar} size={22} />
                  </span>
                </span>
                <span className="sc-row__main">
                  <span className="sc-invite__title">
                    <strong>{inv.from.name}</strong> invited you to <strong>{gName}</strong>
                  </span>
                  <span className="sc-row__sub">
                    <span>Room {inv.code}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={new Date(inv.createdAt).toISOString()}>{relativeTime(inv.createdAt, now)}</time>
                  </span>
                  {expiry && (
                    <span className="sc-expiry">
                      <SIcon name="clock" size={12} /> {expiry}
                    </span>
                  )}
                </span>
                <span className="sc-row__actions">
                  <Link to={paths.join(inv.code)} className="hub-btn hub-btn--primary hub-btn--sm" onClick={() => dismiss(inv, { joined: true })} tabIndex={leaving ? -1 : undefined}>
                    Join
                  </Link>
                  <button
                    type="button"
                    className="sc-iconbtn sc-tip"
                    data-tip="Dismiss"
                    onClick={() => dismiss(inv)}
                    disabled={leaving}
                    aria-label={`Dismiss invite from ${inv.from.name} to ${gName}`}
                  >
                    <SIcon name="close" />
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
