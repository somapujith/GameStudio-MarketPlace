import { Link } from 'react-router-dom';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { useNotify } from '@/platform/game/notify.js';
import { GameCover } from '../GameArt.jsx';
import { categoryLabel } from '../catalog.js';
import { playersLabel, themeVars } from '../gameTheme.js';

/**
 * The storefront game card: cover, name, tagline, fact chips, a live-table badge (only with a real open-table
 * count) and the game's own accent glow. One stretched link; a coming-soon card is dimmed, says "Soon" and has a
 * local "Notify me" toggle that sits above the link. `tables` = open tables for this game (0/undefined = no badge).
 */
export default function PlayCard({ game, tables = 0, solo = false }) {
  const soon = game.status !== 'live';
  const [notify, toggleNotify] = useNotify(game.id);
  const players = playersLabel(game.players);
  const cat = categoryLabel(game.category);

  return (
    <article className={`sh-card ${soon ? 'is-soon' : ''}`} data-solo={solo ? 'true' : 'false'} style={themeVars(game)}>
      <div className="sh-card__media">
        <GameCover game={game} className="sh-card__cover" />
        <div className="sh-card__badges">
          {soon ? (
            <span className="sh-badge sh-badge--soon">Coming soon</span>
          ) : tables > 0 ? (
            <span className="sh-badge sh-badge--live">
              <i className="st-live" aria-hidden="true" />
              {tables} table{tables === 1 ? '' : 's'} open
            </span>
          ) : null}
        </div>
      </div>
      <div className="sh-card__body">
        {cat && <span className="sh-card__cat">{cat}</span>}
        <h3 className="sh-card__title">
          <Link to={paths.game(game.id)} className="sh-card__link">
            {game.name}
          </Link>
        </h3>
        {game.tagline && <p className="sh-card__tag">{game.tagline}</p>}
        <div className="sh-card__chips">
          {players && (
            <span className="st-chip">
              <HubIcon name="users" size={13} /> {players}
            </span>
          )}
          {game.duration && (
            <span className="st-chip">
              <HubIcon name="clock" size={13} /> {game.duration}
            </span>
          )}
        </div>
        <div className="sh-card__foot">
          {soon ? (
            <button
              type="button"
              className={`sh-notify ${notify ? 'is-on' : ''}`}
              aria-pressed={notify}
              onClick={toggleNotify}
              aria-label={`${notify ? 'Stop notifying me about' : 'Notify me about'} ${game.name}`}
            >
              <HubIcon name={notify ? 'check' : 'bell'} size={14} strokeWidth={2.6} /> {notify ? 'On the list' : 'Notify me'}
            </button>
          ) : (
            <span className="sh-card__play" aria-hidden="true">
              <HubIcon name="play" size={14} /> Play
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
