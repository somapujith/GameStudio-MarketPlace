import { Link } from 'react-router-dom';
import { getCategory } from '@/games/registry.js';
import { paths } from '@/platform/paths.js';
import HubIcon from './HubIcon.jsx';
import { CategoryIcon, FallbackCover } from './hubArt.jsx';
import { themeVars } from './color.js';
import { playersLabel } from './detailModel.js';

export { playersLabel };

/** Game cover in a fixed 16:9 frame (the art component fills it). */
export function Cover({ game, className = '' }) {
  const Art = game?.art?.cover;
  return <div className={`hub-cover ${className}`.trim()}>{Art ? <Art /> : <FallbackCover />}</div>;
}

/** `/games?cat=<id>`: the browse page filtered to a category. */
export const categoryHref = (cat) => (cat ? `${paths.games()}?cat=${encodeURIComponent(cat.id)}` : paths.games());

/** The shopfront: an awning stripe in the game's colours over its cover, lit from below by the accent. */
export function HeroArt({ game, soon = false }) {
  return (
    <figure className={`gd-art${soon ? ' is-soon' : ''}`} aria-label={`${game.name} cover art`}>
      <span className="gd-art__awning" aria-hidden="true" />
      <Cover game={game} className="gd-art__cover" />
      {soon && <span className="gd-art__badge">Coming soon</span>}
    </figure>
  );
}

/**
 * Title block: category eyebrow (links to the browse page), name, tagline and fact chips. `tables` is the live
 * number of open tables (undefined while unknown); it only shows when it is a real, positive count.
 */
export function GameHead({ game, soon = false, tables }) {
  const cat = getCategory(game.category);
  const players = playersLabel(game.players);
  return (
    <header className="gd-head">
      {cat && (
        <Link to={categoryHref(cat)} className="gd-head__cat st-eyebrow" aria-label={`More ${cat.label} games`}>
          <CategoryIcon id={cat.icon} size={16} /> {cat.label}
        </Link>
      )}
      <h1 id="gd-title" className="gd-head__title">
        {game.name}
      </h1>
      {game.tagline && <p className="gd-head__tag">{game.tagline}</p>}
      <ul className="gd-facts" aria-label="Quick facts">
        {soon ? (
          <li className="st-chip gd-chip gd-chip--soon">
            <HubIcon name="spark" size={14} /> Coming soon
          </li>
        ) : (
          <li className="st-chip gd-chip gd-chip--live">
            <i className="st-live" aria-hidden="true" /> Live
          </li>
        )}
        {players && (
          <li className="st-chip gd-chip">
            <HubIcon name="users" size={14} /> {players}
          </li>
        )}
        {game.duration && (
          <li className="st-chip gd-chip">
            <HubIcon name="clock" size={14} /> {game.duration}
          </li>
        )}
        {game.ageRating && (
          <li className="st-chip gd-chip" title="Age rating">
            <HubIcon name="info" size={14} /> {game.ageRating}
          </li>
        )}
        {!soon && Number(tables) > 0 && (
          <li>
            <a href="#gd-live" className="st-chip gd-chip gd-chip--tables">
              {tables} open {Number(tables) === 1 ? 'table' : 'tables'} now
            </a>
          </li>
        )}
      </ul>
    </header>
  );
}

/** Legacy one-piece hero (art + title block) for callers that want the whole thing. */
export default function GameHero({ game, soon = false }) {
  return (
    <section className="gd-hero" style={themeVars(game.theme)} aria-labelledby="gd-title">
      <HeroArt game={game} soon={soon} />
      <GameHead game={game} soon={soon} />
    </section>
  );
}
