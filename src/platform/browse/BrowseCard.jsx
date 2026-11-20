// Catalogue tile: the game's cover under a lantern of its own accent colour, name, tagline, facts and one action.
// The whole tile is one link (the name's anchor stretches over it), so there is a single tab stop per game.
import { Link } from 'react-router-dom';
import { getCategory } from '@/games/registry.js';
import { paths } from '@/platform/paths.js';
import { GameCover } from '@/platform/home/GameArt.jsx';
import { themeVars } from '@/platform/home/gameTheme.js';
import Highlight from './Highlight.jsx';
import { Facts, StatusBadge, isSoon } from './GameBits.jsx';
import { ArrowIcon } from './icons.jsx';
import '@/styles/mappicker.css';

export default function BrowseCard({ game, query = '', index = 0 }) {
  const soon = isSoon(game);
  const cat = getCategory(game.category);
  return (
    <article className={`bw-card bw-in ${soon ? 'is-soon' : ''}`} style={{ ...themeVars(game), '--i': Math.min(index, 7) }}>
      <div className="bw-card__media">
        <GameCover game={game} />
        <StatusBadge game={game} />
      </div>
      <div className="bw-card__body">
        {cat && <span className="bw-card__eyebrow">{cat.label}</span>}
        <h3 className="bw-card__name">
          <Link className="bw-card__link" to={paths.game(game.id)}>
            <Highlight text={game.name} query={query} />
            <span className="hub-sr">{soon ? ', coming soon' : ', live'}</span>
          </Link>
        </h3>
        {game.tagline && (
          <p className="bw-card__tag">
            <Highlight text={game.tagline} query={query} />
          </p>
        )}
        {game.mapsLine && <p className="hh2-gcard__maps">{game.mapsLine}</p>}
        <Facts game={game} tags={1} />
        <span className="bw-act" aria-hidden="true">
          {soon ? 'Details' : 'Play'}
          <ArrowIcon width={16} height={16} />
        </span>
      </div>
    </article>
  );
}
