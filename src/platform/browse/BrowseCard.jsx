// Browse / search grid item: a cine poster (art, Live / Soon badge, name) with the category line and tagline under it.
// The poster is the one link (one tab stop per game); it carries `data-result` so search can walk results with arrows.
import { forwardRef } from 'react';
import { GamePoster, posterSub } from './GameArt.jsx';
import Highlight from './Highlight.jsx';

const BrowseCard = forwardRef(function BrowseCard({ game, query = '', index = 0, onOpen, onKeyDown, tables }, ref) {
  return (
    <article className="cj-browse-card" style={{ '--i': Math.min(index, 7) }}>
      <GamePoster ref={ref} game={game} query={query} onOpen={onOpen} onKeyDown={onKeyDown} tables={tables} sub={posterSub(game)} headingLevel={3} />
      {game.tagline && (
        <p className="cj-browse-card__tag">
          <Highlight text={game.tagline} query={query} />
        </p>
      )}
    </article>
  );
});

export default BrowseCard;
