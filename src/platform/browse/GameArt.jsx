// Cine art pieces for a game: the painted cover filling any frame (poster 2:3, wide 16:9, hero backdrop), with the
// manifest's SVG cover as the fallback, and the poster card used by Home, Browse, Search and "More like this".
import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { getCategory } from '@/games/registry.js';
import { paths } from '@/platform/paths.js';
import { FallbackCover } from '@/platform/game/hubArt.jsx';
import { playersLabel, themeVars } from '@/platform/home/gameTheme.js';
import Highlight from './Highlight.jsx';
import { backdropArt, publisherArt } from './publisherArt.js';
import '@/styles/cine/browse.css'; // .cj-artfill / .cj-postercard (shared cine primitives)

/** Decorative art that fills its positioned parent (`object-fit: cover`). `backdrop` picks the wide title art. */
export function ArtFill({ game, backdrop = false, detail = false, eager = false, className = '' }) {
  const art = backdrop ? backdropArt(game, { detail }) : publisherArt(game);
  if (art) {
    return (
      <img
        className={`cj-artfill ${art.flip ? 'is-flipped' : ''} ${className}`.trim()}
        src={art.src}
        alt=""
        width="720"
        height="480"
        style={art.pos ? { '--pos': art.pos, '--pos-phone': art.phonePos || art.pos } : undefined}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : undefined}
        decoding="async"
      />
    );
  }
  const Cover = game?.art?.cover;
  return (
    <span className={`cj-artfill cj-artfill--svg ${className}`.trim()} style={themeVars(game)} aria-hidden="true">
      {Cover ? <Cover /> : <FallbackCover />}
    </span>
  );
}

/** "Board · 2–6 players" */
export function posterSub(game) {
  const cat = getCategory(game?.category);
  return [cat?.label, playersLabel(game?.players)].filter(Boolean).join(' · ');
}

/**
 * A 2:3 poster linking to the game page: art, a Live / Soon badge, the name over the art and (below) a dim meta line.
 * `tables` (a real open-table count) replaces the Live badge's text when positive. Search passes `query` (highlight),
 * `onOpen` and `onKeyDown` (arrow-key walking: the link carries `data-result`).
 */
export const GamePoster = forwardRef(function GamePoster({ game, query = '', tables, onOpen, onKeyDown, sub, className = '', headingLevel }, ref) {
  const soon = game?.status === 'coming_soon';
  const Name = headingLevel ? `h${headingLevel}` : 'span';
  const line = sub ?? posterSub(game);
  return (
    <div className={`cj-postercard ${soon ? 'is-soon' : ''} ${className}`.trim()}>
      <Link ref={ref} to={paths.game(game.id)} className="cj-poster" onClick={onOpen} onKeyDown={onKeyDown} data-result="">
        <ArtFill game={game} />
        {soon ? (
          <span className="cj-poster__badge">Soon</span>
        ) : (
          <span className="cj-poster__badge cj-poster__badge--live">
            <i className="cj-live-dot" aria-hidden="true" />
            {Number(tables) > 0 ? `${tables} open` : 'Live'}
          </span>
        )}
        <Name className="cj-poster__title">
          <Highlight text={game.name} query={query} />
          <span className="hub-sr">{soon ? ', coming soon' : ', live'}</span>
        </Name>
      </Link>
      {line && <p className="cj-postercard__sub">{line}</p>}
    </div>
  );
});
