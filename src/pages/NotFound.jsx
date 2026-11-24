import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { liveGames } from '@/games/registry.js';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { OPEN_CODE_EVENT } from '@/components/shell/nav/events.js';
import '@/styles/cine.css';
import '@/styles/cine/bridge.css';
import '@/styles/cine/info.css';

/**
 * A wrong turn in the gully, as a cine empty state (dashed card, title, two pills) with a search box, so a lost visitor
 * can find the game they came for (plus Browse, Home, "Have a code?" and a few games to open).
 */
export default function NotFound() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  useDocTitle(`Page not found · ${BRAND.name}`);
  const games = liveGames().slice(0, 3);

  const submit = (e) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) {
      inputRef.current?.focus();
      return;
    }
    navigate(paths.search(term));
  };

  return (
    <section className="cj-scope cj-nf hub-page" aria-labelledby="hub-nf-h">
      <div className="cj-ambient cj-amb-art cj-nf-ambient" aria-hidden="true" />
      <div className="cj-empty cj-nf-empty">
        <span className="cj-empty__art cj-nf-art" aria-hidden="true">
          <span className="cj-nf-code">404</span>
        </span>
        <h1 id="hub-nf-h" className="cj-empty__title">
          This stall is closed
        </h1>
        <p className="cj-empty__body">
          We couldn't find <code>{pathname}</code>. The link may be old, or the room may have closed. Search for a game instead:
        </p>

        <form className="cj-nf-search" role="search" onSubmit={submit}>
          <label htmlFor="hub-nf-q" className="hub-sr">
            Search games
          </label>
          <HubIcon name="search" size={18} className="cj-nf-search__icon" />
          <input
            id="hub-nf-q"
            ref={inputRef}
            className="cj-nf-search__input"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search games"
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button type="submit" className="cj-btn cj-btn--primary cj-btn--sm">
            Search
          </button>
        </form>

        <div className="cj-empty__actions">
          <Link to={paths.games()} className="cj-btn cj-btn--primary">
            <HubIcon name="compass" size={18} /> Browse all games
          </Link>
          <Link to={paths.hub()} className="cj-btn">
            <HubIcon name="home" size={18} /> Back home
          </Link>
          <button type="button" className="cj-btn" onClick={() => window.dispatchEvent(new Event(OPEN_CODE_EVENT))}>
            <HubIcon name="hash" size={18} /> Have a code?
          </button>
        </div>

        {games.length > 0 && (
          <nav className="cj-nf-try" aria-label="Open a game">
            <span className="cj-nf-try__label">Open a game</span>
            {games.map((g) => (
              <Link key={g.id} to={paths.game(g.id)} className="cj-chip">
                {g.name}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </section>
  );
}
