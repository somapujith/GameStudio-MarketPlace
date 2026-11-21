// Dense list row: cover sleeve, name, tagline, facts, action. Used by the list view and search results.
import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { getCategory } from '@/games/registry.js';
import { paths } from '@/platform/paths.js';
import { GameIcon } from '@/platform/home/GameArt.jsx';
import { themeVars } from '@/platform/home/gameTheme.js';
import Highlight from './Highlight.jsx';
import { Facts, StatusBadge, isSoon } from './GameBits.jsx';
import { ArrowIcon } from './icons.jsx';
import { publisherArt } from './publisherArt.js';
import './publisher-catalog.css';

const BrowseRow = forwardRef(function BrowseRow({ game, query = '', index = 0, onOpen, onKeyDown }, ref) {
  const soon = isSoon(game);
  const cat = getCategory(game.category);
  const art = publisherArt(game);
  return (
    <article className={`bw-row bw-in ${soon ? 'is-soon' : ''}`} style={{ ...themeVars(game), '--i': Math.min(index, 7) }}>
      {art ? <span className="bw-row__sleeve" aria-hidden="true"><img src={art.src} alt="" width="120" height="120" loading="lazy" /><span>{art.number}</span></span> : <GameIcon game={game} size={60} className="bw-row__icon" />}
      <div className="bw-row__body">
        <div className="bw-row__top">
          {cat && <span className="bw-card__eyebrow">{cat.label}</span>}
          <StatusBadge game={game} />
        </div>
        <h3 className="bw-row__name">
          <Link ref={ref} className="bw-row__link" to={paths.game(game.id)} onClick={onOpen} onKeyDown={onKeyDown} data-result="">
            <Highlight text={game.name} query={query} />
            <span className="hub-sr">{soon ? ', coming soon' : ', live'}</span>
          </Link>
        </h3>
        {game.tagline && (
          <p className="bw-row__tag">
            <Highlight text={game.tagline} query={query} />
          </p>
        )}
        <Facts game={game} tags={2} />
      </div>
      <span className="bw-act bw-row__act" aria-hidden="true">
        <span>{soon ? 'Explore game' : 'Play now'}</span>
        <span className="bw-act__arrow"><ArrowIcon width={19} height={19} /></span>
      </span>
    </article>
  );
});

export default BrowseRow;
