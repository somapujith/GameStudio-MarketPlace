import { Link } from 'react-router-dom';
import { getMyRooms } from '@/lib/api.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { gameById } from '@/platform/home/catalog.js';
import { GameIcon } from '@/platform/home/GameArt.jsx';
import { themeVars } from '@/platform/home/gameTheme.js';
import { useAccount } from '../hooks.js';
import { pickResume } from './homeModel.js';
import { useLoad } from './useLoad.js';

const fetchMine = (opts) => getMyRooms(opts);

/**
 * "Your game is still running — Rejoin" / "Back to your table" for a signed-in player (guests too) who has a room
 * open. Renders nothing while loading, when there is no room, signed out or offline: it is a shortcut, not a section.
 */
export default function ResumeCard() {
  const { signedIn } = useAccount();
  const { status, data } = useLoad('rooms-mine', fetchMine, { enabled: signedIn, pollMs: 45_000 });
  const pick = status === 'ok' ? pickResume(data?.rooms) : null;
  if (!pick) return null;

  const { kind, room } = pick;
  const game = gameById(room.gameId);
  const playing = kind === 'playing';
  const to = playing ? paths.online(room.gameId || game?.id || '', room.code) : paths.lobby(room.code);
  const seats = Number(room.maxPlayers) > 0 ? `${Number(room.players) || 0}/${room.maxPlayers} players` : '';

  return (
    <section className={`xh-resume ${playing ? 'is-playing' : 'is-lobby'}`} style={themeVars(game)} aria-label={playing ? 'Your running game' : 'Your open table'}>
      <Link to={to} className="xh-resume__link">
        <span className="xh-resume__icon">
          <GameIcon game={game} size={48} />
          {playing && <i className="xh-live-dot xh-resume__live" aria-hidden="true" />}
        </span>
        <span className="xh-resume__text">
          <b>{playing ? 'Your game is still running' : 'Back to your table'}</b>
          <small>
            {game?.name || 'Your table'} · Room {room.code}
            {seats ? ` · ${seats}` : ''}
          </small>
        </span>
        <span className="hub-btn hub-btn--accent hub-btn--sm xh-resume__cta" aria-hidden="true">
          {playing ? (
            <>
              <HubIcon name="play" size={16} /> Rejoin
            </>
          ) : (
            <>
              Open lobby <HubIcon name="arrowR" size={16} />
            </>
          )}
        </span>
      </Link>
    </section>
  );
}
