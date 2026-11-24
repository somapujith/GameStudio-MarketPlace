import { Link } from 'react-router-dom';
import { getOpenRooms } from '@/lib/api.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { featured, gameById } from '@/platform/home/catalog.js';
import { themeVars } from '@/platform/home/gameTheme.js';
import { CineRow, CineSection } from '@/platform/home/CineRow.jsx';
import { Note } from '@/platform/home/HomeRows.jsx';
import { ArtFill } from '@/platform/browse/GameArt.jsx';
import { useLive } from '@/platform/home/store/live.js';
import { joinableRooms } from './homeModel.js';
import { useLoad } from './useLoad.js';

const fetchOpen = (opts) => getOpenRooms({ limit: 10 }, opts);

function Seats({ players, max }) {
  const n = Math.max(0, Number(players) || 0);
  const m = Math.max(0, Number(max) || 0);
  if (!m) return null;
  return (
    <span className="cj-home-seats" aria-label={`${n} of ${m} seats taken`}>
      <span className="cj-home-seats__pips" aria-hidden="true">
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

/** One open table: a wide card over the game's art (host, game, rules, seats, Join). */
function TableCard({ room }) {
  const game = gameById(room.gameId);
  const host = String(room.hostName || '').trim() || 'A player';
  return (
    <Link to={paths.join(room.code)} className="cj-wide cj-home-table" style={themeVars(game)} aria-label={`Join ${host}'s table${game ? `, ${game.name}` : ''}`}>
      {game && <ArtFill game={game} />}
      <span className="cj-home-table__live">
        <i className="cj-live-dot" aria-hidden="true" /> Waiting
      </span>
      <span className="cj-wide__label cj-home-table__label">
        {`${host}'s table`}
        <small>
          {game?.name || 'Game table'}
          {room.summary ? ` · ${String(room.summary)}` : ''}
        </small>
        <span className="cj-home-table__foot">
          <Seats players={room.players} max={room.maxPlayers} />
          <span className="cj-home-table__join" aria-hidden="true">
            Join <HubIcon name="arrowR" size={14} strokeWidth={2.4} />
          </span>
        </span>
      </span>
    </Link>
  );
}

/**
 * "Open tables": public rooms waiting for players, as a row of wide cards with a Join arrow. Skeletons while loading,
 * an honest empty state with a create CTA, and a calm offline state with Retry. Uses the Home page's shared live
 * numbers when mounted under <LiveProvider>, else its own (polled) request. `#sh-open` is the anchor the live chips
 * jump to.
 */
export default function OpenTables() {
  const shared = useLive();
  const own = useLoad('rooms-open', fetchOpen, { enabled: !shared, pollMs: 30_000 });
  const { status, data, reload } = shared ? shared.open : own;
  const retry = shared ? shared.retry : reload;

  const rooms = status === 'ok' ? joinableRooms(data?.rooms) : [];
  const host = featured();

  let body;
  if (status === 'loading' || status === 'idle') {
    body = (
      <ul className="cj-row" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <span className="cj-wide cj-home-skel" />
          </li>
        ))}
      </ul>
    );
  } else if (status === 'offline' || status === 'error' || status === 'auth') {
    body = (
      <Note live icon="wifiOff" title="Open tables are unavailable" text="We cannot reach the server right now. Games with a code still work.">
        <button type="button" className="cj-btn cj-btn--sm" onClick={retry}>
          <HubIcon name="refresh" size={16} /> Retry
        </button>
      </Note>
    );
  } else if (!rooms.length) {
    body = (
      <Note icon="table" title="No open tables right now" text="Start one and share the code. New tables show up here on their own.">
        {host && (
          <Link to={paths.game(host.id)} className="cj-btn cj-btn--primary cj-btn--sm">
            <HubIcon name="plus" size={16} /> Create a table
          </Link>
        )}
      </Note>
    );
  } else {
    body = (
      <CineRow label="Open tables" count={rooms.length}>
        {rooms.map((r) => (
          <li key={r.code}>
            <TableCard room={r} />
          </li>
        ))}
      </CineRow>
    );
  }

  const extra = (
    <>
      {rooms.length > 0 && (
        <span className="cj-home-count">
          <i className="cj-live-dot" aria-hidden="true" /> {rooms.length} open
        </span>
      )}
      <Link to={paths.join()} className="cj-home-more">
        Have a code?
      </Link>
    </>
  );

  return (
    <div id="sh-open" className="cj-home-anchor" aria-busy={status === 'loading' || undefined}>
      <CineSection id="home-tables" title="Open tables" data-tour="home-tables" className="cj-home-tables" extra={extra}>
        {body}
      </CineSection>
    </div>
  );
}
