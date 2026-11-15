import { Link } from 'react-router-dom';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import { HubMark } from './hubArt.jsx';
import HubIcon from './HubIcon.jsx';
import { idToQuery } from './detailModel.js';
import useDocTitle from './useDocTitle.js';

const COPY = {
  unknown: {
    title: 'This game is not available',
    text: "We couldn't find that game. The link may be old, or the game may have moved.",
  },
  soon: {
    title: 'Coming soon',
    text: "This game isn't open yet. Check its page and tap Notify me.",
  },
  missing: {
    title: 'This game is not available',
    text: "This part of the game isn't ready yet. Try again a little later.",
  },
};

/**
 * Friendly stand-in for an unknown id, a coming-soon game, or a manifest without the requested loader.
 * `reason`: 'unknown' | 'soon' | 'missing'. `fullscreen` is for routes rendered without the hub chrome.
 * `query` (the id from a bad link) pre-fills the search link, so "hyderbad-tycoon" still finds the game.
 */
export default function Unavailable({ reason = 'unknown', game = null, fullscreen = false, query = '' }) {
  const copy = COPY[reason] || COPY.unknown;
  const title = game && reason === 'soon' ? `${game.name} is coming soon` : copy.title;
  useDocTitle(`${title} · ${BRAND.name}`, reason === 'unknown' ? { noindex: true } : undefined);
  const q = idToQuery(query);
  return (
    <section className={`hub-unavail${fullscreen ? ' hub-unavail--full' : ''}`} aria-labelledby="hub-unavail-title">
      <div className="hub-unavail__card">
        <span className="hub-unavail__art" aria-hidden="true">
          <HubMark size={64} />
        </span>
        <h1 id="hub-unavail-title" className="hub-h1">
          {title}
        </h1>
        <p className="hub-lead">{copy.text}</p>
        <div className="hub-unavail__actions">
          {game && (
            <Link to={paths.game(game.id)} className="hub-btn hub-btn--soft">
              {game.name}
            </Link>
          )}
          <Link to={paths.games()} className="hub-btn hub-btn--primary">
            <HubIcon name="gamepad" size={18} /> Browse all games
          </Link>
          <Link to={paths.search(q)} className="hub-btn hub-btn--soft">
            <HubIcon name="search" size={18} /> {q ? `Search for “${q}”` : 'Search games'}
          </Link>
        </div>
      </div>
    </section>
  );
}
