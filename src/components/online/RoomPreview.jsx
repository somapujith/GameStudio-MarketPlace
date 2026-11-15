import { themeVars } from '@/platform/game/color.js';
import GameIcon from './GameIcon.jsx';
import { playerCountOf } from './codes.js';
import { gameName, gameOf } from './games.js';
import { roomGameId } from './gameRoute.js';
import { summarizeSettings } from './settings.js';
import MapTag from './MapTag.jsx';
import { mapFieldOf, mapIdOf } from './mapModel.js';
import '@/styles/store-rooms.css';

/** What the join page can honestly say about a room from GET /api/rooms/:code. Pure. */
export function previewFacts(info, game = gameOf(roomGameId(info))) {
  const gameId = roomGameId(info);
  const count = playerCountOf(info);
  const max = Number.isFinite(info && info.maxPlayers) && info.maxPlayers > 0 ? info.maxPlayers : null;
  const summary = game && info && info.settings ? summarizeSettings(game, info.settings) : '';
  return {
    gameId,
    name: gameName(gameId, game),
    host: (info && info.hostName) || '',
    count,
    max,
    summary,
    // the map the table plays on, for a game that has maps (null otherwise); a room made before maps existed is on the default map
    map: game && mapFieldOf(game.settings) ? mapIdOf(info && info.settings) : null,
    seats: max ? `${Math.min(count, max)} of ${max} seats taken` : `${count} ${count === 1 ? 'player' : 'players'} here`,
  };
}

/** Skeleton shaped like the preview, while the code is being looked up. */
export function RoomPreviewSkeleton() {
  return (
    <div className="sr-preview sr-preview--skel" aria-hidden="true">
      <div className="sr-preview__cover st-skel" />
      <div className="sr-preview__body">
        <span className="st-skel sr-skel-line sr-skel-line--s" />
        <span className="st-skel sr-skel-line sr-skel-line--l" />
        <span className="st-skel sr-skel-line sr-skel-line--m" />
      </div>
    </div>
  );
}

/**
 * The table behind a code: the game's cover and name, who hosts it, how many seats are taken and the host's settings,
 * all from the room lookup. `tone` marks a blocked table (full, started, ended) so it reads as unavailable, not broken.
 */
export default function RoomPreview({ info, tone = 'open', children }) {
  const game = gameOf(roomGameId(info));
  const f = previewFacts(info, game);
  const Cover = game && game.art && game.art.cover;
  const dots = f.max ? Array.from({ length: f.max }, (_, i) => i < f.count) : [];
  return (
    <article className={`sr-preview sr-preview--${tone}`} style={game ? themeVars(game.theme) : undefined} aria-label={`${f.name} room`}>
      <div className="sr-preview__cover" aria-hidden="true">
        {Cover ? <Cover /> : <span className="sr-preview__ph">{f.name.charAt(0).toUpperCase()}</span>}
        <GameIcon game={game} name={f.name} size={52} className="sr-preview__icon" />
      </div>
      <div className="sr-preview__body">
        <span className="st-eyebrow">{tone === 'open' ? 'Table found' : 'Table'}</span>
        <h3 className="sr-preview__game">{f.name}</h3>
        <p className="sr-preview__host">{f.host ? `Hosted by ${f.host}` : 'Open table'}</p>
        {f.map && <MapTag value={f.map} className="sr-preview__map" />}
        <div className="sr-preview__seats">
          {dots.length > 0 && (
            <span className="sr-preview__dots" aria-hidden="true">
              {dots.map((on, i) => (
                <i key={i} className={on ? 'is-on' : ''} />
              ))}
            </span>
          )}
          <span>{f.seats}</span>
        </div>
        {f.summary && <p className="sr-preview__summary">{f.summary}</p>}
        {children}
      </div>
    </article>
  );
}
