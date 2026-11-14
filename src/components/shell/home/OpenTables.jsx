import { Link } from 'react-router-dom';
import { getOpenRooms } from '@/lib/api.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { featured, gameById } from '@/platform/home/catalog.js';
import { GameIcon } from '@/platform/home/GameArt.jsx';
import { themeVars } from '@/platform/home/gameTheme.js';
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
    <Link to={paths.join(room.code)} className="xh-table" style={themeVars(game)}>
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

/**
 * "Join a table": public rooms waiting for players (polled while the tab is visible). Skeleton while loading,
 * an inviting empty state with a create CTA, and nothing at all when the server is unreachable.
 */
export default function OpenTables() {
  const { status, data } = useLoad('rooms-open', fetchOpen, { pollMs: 30_000 });
  if (status !== 'loading' && status !== 'ok') return null; // offline / error: silent

  const rooms = status === 'ok' ? joinableRooms(data?.rooms) : [];
  const host = featured();

  let body;
  if (status === 'loading') {
    body = (
      <ul className="hub-row hub-row--tight xh-tables" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="xh-table xh-table--skel">
            <span className="xh-table__top">
              <span className="hub-skel" style={{ width: 44, height: 44, borderRadius: 14 }} />
              <span className="xh-table__who">
                <span className="hub-skel hub-skel--line" style={{ width: 110 }} />
                <span className="hub-skel hub-skel--line" style={{ width: 70, height: 10 }} />
              </span>
            </span>
            <span className="hub-skel hub-skel--line" style={{ width: '80%', height: 11 }} />
            <span className="hub-skel hub-skel--line" style={{ width: '45%', height: 12 }} />
          </li>
        ))}
      </ul>
    );
  } else if (!rooms.length) {
    body = (
      <div className="xh-empty">
        <span className="xh-empty__icon" aria-hidden="true">
          <HubIcon name="table" size={26} />
        </span>
        <p className="xh-empty__text">
          <b>No open tables right now — start one</b>
          <span>Create a table and share the code, or wait here: new tables show up on their own.</span>
        </p>
        {host && (
          <Link to={paths.game(host.id)} className="hub-btn hub-btn--primary hub-btn--sm">
            <HubIcon name="plus" size={16} /> Create a table
          </Link>
        )}
      </div>
    );
  } else {
    body = (
      <ul className="hub-row hub-row--tight xh-tables" aria-label="Open tables">
        {rooms.map((r) => (
          <li key={r.code}>
            <TableCard room={r} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="hub-section xh-open" aria-labelledby="xh-open-h" aria-busy={status === 'loading' || undefined}>
      <div className="hub-section__head">
        <h2 id="xh-open-h" className="hub-section__title">
          Join a table
          {rooms.length > 0 && (
            <span className="hub-pill hub-pill--live hh2-pill-gap">
              <i className="xh-live-dot" aria-hidden="true" /> {rooms.length} open
            </span>
          )}
        </h2>
        <Link to={paths.join()} className="hub-section__more">
          Have a code?
        </Link>
      </div>
      {body}
    </section>
  );
}
