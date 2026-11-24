// List view row: a 16:9 thumbnail, the name, a meta line, the tagline and a chevron. Used by the browse list view.
import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { getCategory } from '@/games/registry.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Highlight from './Highlight.jsx';
import { ArtFill } from './GameArt.jsx';
import { Facts, StatusBadge, isSoon } from './GameBits.jsx';

const BrowseRow = forwardRef(function BrowseRow({ game, query = '', index = 0, onOpen, onKeyDown }, ref) {
  const soon = isSoon(game);
  const cat = getCategory(game.category);
  return (
    <article className={`cj-browse-row ${soon ? 'is-soon' : ''}`} style={{ '--i': Math.min(index, 7) }}>
      <span className="cj-browse-row__thumb" aria-hidden="true">
        <ArtFill game={game} />
      </span>
      <div className="cj-browse-row__body">
        <div className="cj-browse-row__top">
          <StatusBadge game={game} />
          {cat && <span className="cj-browse-row__cat">{cat.label}</span>}
        </div>
        <h3 className="cj-browse-row__name">
          <Link ref={ref} className="cj-browse-row__link" to={paths.game(game.id)} onClick={onOpen} onKeyDown={onKeyDown} data-result="">
            <Highlight text={game.name} query={query} />
            <span className="hub-sr">{soon ? ', coming soon' : ', live'}</span>
          </Link>
        </h3>
        {game.tagline && (
          <p className="cj-browse-row__tag">
            <Highlight text={game.tagline} query={query} />
          </p>
        )}
        <Facts game={game} tags={2} />
      </div>
      <span className="cj-browse-row__go" aria-hidden="true">
        <HubIcon name="chevR" size={20} />
      </span>
    </article>
  );
});

export default BrowseRow;
