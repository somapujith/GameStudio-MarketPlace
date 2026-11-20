import { Link } from 'react-router-dom';
import { getOpenRooms } from '@/lib/api.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { featured, gameById } from '@/platform/home/catalog.js';
import { GameIcon } from '@/platform/home/GameArt.jsx';
import { themeVars } from '@/platform/home/gameTheme.js';
import Rail from '@/platform/home/store/Rail.jsx';
import { useLive } from '@/platform/home/store/live.js';
import { joinableRooms } from './homeModel.js';
import { useLoad } from './useLoad.js';

const fetchOpen = (opts) => getOpenRooms({ limit: 10 }, opts);

function Seats({ players, max }) {
  const n = Math.max(0, Number(players) || 0);
  const m = Math.max(0, Number(max) || 0);
  if (!m) return null;
  return (
    <span className="xh-seats" aria-label={`${n} of ${m} seats taken`}>
      <span className="xh-seats__pips" aria-hidden="true">
        {Array.from({ length: Math.min(m, 8) }, (_, i) => (
          <i key={i} className={i < n ? 'is-on' : ''} />
        ))}
      </span>
      <b>
        {n}/{m}
      </b>
    </span>
  );
}

function TableCard({ room }) {
  const game = gameById(room.gameId);
  const host = String(room.hostName || '').trim() || 'A player';
  return (
    <Link to={paths.join(room.code)} className="xh-table sh-ticket" style={themeVars(game)}>
      <span className="xh-table__top">
        <GameIcon game={game} size={44} />
        <span className="xh-table__who">
          <b>{`${host}'s table`}</b>
          <small>{game?.name || 'Game table'}</small>
        </span>
      </span>
      <span className="xh-table__summary">{room.summary ? String(room.summary) : 'Standard rules'}</span>
      <span className="xh-table__foot">
        <Seats players={room.players} max={room.maxPlayers} />
        <span className="xh-table__join" aria-hidden="true">
          Join <HubIcon name="arrowR" size={15} strokeWidth={2.4} />
        </span>
      </span>
    </Link>
  );
}

function SkelTicket() {
  return (
    <li className="xh-table sh-ticket sh-ticket--skel" aria-hidden="true">
      <span className="xh-table__top">
        <span className="st-skel" style={{ width: 44, height: 44, borderRadius: 14 }} />
        <span className="xh-table__who">
          <span className="st-skel" style={{ width: 110, height: 14 }} />
          <span className="st-skel" style={{ width: 70, height: 10 }} />
        </span>
      </span>
      <span className="st-skel" style={{ width: '80%', height: 11 }} />
      <span className="st-skel" style={{ width: '45%', height: 12 }} />
    </li>
  );
}

/**
 * "Open tables": public rooms waiting for players, as a rail of ticket cards with a Join arrow. Skeleton while
 * loading, an honest empty state with a create CTA, and a calm offline state with Retry. Uses the Home page's shared
 * live numbers when mounted under <LiveProvider>, else its own (polled) request.
 */
export default function OpenTables() {
  const shared = useLive();
  const own = useLoad('rooms-open', fetchOpen, { enabled: !shared, pollMs: 30_000 });
  const { status, data, reload } = shared ? shared.open : own;
  const retry = shared ? shared.retry : reload;

  const rooms = status === 'ok' ? joinableRooms(data?.rooms) : [];
  const host = featured();

  let body;
  if (status === 'loading') {
    body = (
      <ul className="st-rail sh-rail" aria-hidden="true" data-solo="false">
        {[0, 1, 2, 3].map((i) => (
          <SkelTicket key={i} />
        ))}
      </ul>
    );
  } else if (status === 'offline' || status === 'error' || status === 'auth') {
    body = (
      <div className="sh-state" role="status">
        <span className="sh-state__icon" aria-hidden="true">
          <HubIcon name="wifiOff" size={24} />
        </span>
        <p className="sh-state__text">
          <b>Open tables are unavailable</b>
          <span>We cannot reach the server right now. Games with a code still work.</span>
        </p>
        <button type="button" className="hub-btn hub-btn--soft hub-btn--sm" onClick={retry}>
          <HubIcon name="refresh" size={16} /> Retry
        </button>
      </div>
    );
  } else if (!rooms.length) {
    body = (
      <div className="sh-state">
        <span className="sh-state__icon" aria-hidden="true">
          <HubIcon name="table" size={24} />
        </span>
        <p className="sh-state__text">
          <b>No open tables right now</b>
          <span>Start one and share the code, or wait here: new tables show up on their own.</span>
        </p>
        {host && (
          <Link to={paths.game(host.id)} className="hub-btn hub-btn--primary hub-btn--sm">
            <HubIcon name="plus" size={16} /> Create a table
          </Link>
        )}
      </div>
    );
  }

  const live = rooms.length > 0;
  const badge = live ? (
    <span className="sh-count">
      <i className="st-live" aria-hidden="true" /> {rooms.length} open
    </span>
  ) : null;

  const head = {
    eyebrow: 'Happening now',
    title: 'Open tables',
    sub: 'Pick a seat at a table that is waiting for players.',
    badge,
    moreTo: paths.join(),
    moreLabel: 'Have a code?',
  };

  return (
    <div id="sh-open" className="sh-anchor" aria-busy={status === 'loading' || undefined}>
      {live ? (
        <Rail {...head} count={rooms.length} label="Open tables">
          {rooms.map((r) => (
            <li key={r.code}>
              <TableCard room={r} />
            </li>
          ))}
        </Rail>
      ) : (
        <Rail {...head} bare>
          {body}
        </Rail>
      )}
    </div>
  );
}
