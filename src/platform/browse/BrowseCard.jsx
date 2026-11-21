// Numbered game sleeve: cinematic cover, title, source facts and one launch action.
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
import { publisherArt } from './publisherArt.js';
import './publisher-catalog.css';

export default function BrowseCard({ game, query = '', index = 0 }) {
  const soon = isSoon(game);
  const cat = getCategory(game.category);
  const art = publisherArt(game);
  return (
    <article className={`bw-card bw-in ${soon ? 'is-soon' : ''}`} style={{ ...themeVars(game), '--i': Math.min(index, 7) }}>
      <div className="bw-card__media">
        {art ? <img className="bw-card__cover" src={art.src} alt="" width="720" height="480" loading="lazy" decoding="async" /> : <GameCover game={game} />}
        <StatusBadge game={game} />
        <span className="bw-card__reveal" aria-hidden="true"><span>{soon ? 'Take a look' : 'Let’s play'}</span><ArrowIcon width={24} height={24} /></span>
      </div>
      <div className="bw-card__body">
        <div className="bw-card__caption">{cat && <span className="bw-card__eyebrow">{cat.label}</span>}{art && <span className="bw-card__number">JG / {art.number}</span>}</div>
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
          <span>{soon ? 'Explore game' : 'Play now'}</span>
          <span className="bw-act__arrow"><ArrowIcon width={19} height={19} /></span>
        </span>
      </div>
    </article>
  );
}
