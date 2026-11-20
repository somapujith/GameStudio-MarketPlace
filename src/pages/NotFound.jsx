import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { liveGames } from '@/games/registry.js';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import IndiaArt from '@/components/art/IndiaArt.jsx';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { OPEN_CODE_EVENT } from '@/components/shell/nav/events.js';

/**
 * A wrong turn in the gully, with the original Indian street-print art over a search box, so a lost visitor can
 * find the game they came for (plus Browse, Home, "Have a code?" and a few games to open). Also the look the
 * "unavailable" cards share (see .hub-unavail in x-shell.css).
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
    <section className="hub-page hub-nf hub-404" aria-labelledby="hub-nf-h">
      <IndiaArt art="jaipur" className="hub-404__print" decorative />
      <p className="st-eyebrow">Error 404</p>
      <h1 id="hub-nf-h" className="hub-nf__title">
        This stall is closed
      </h1>
      <p className="hub-nf__lead">
        We couldn't find <code>{pathname}</code>. The link may be old, or the room may have closed. Search for a game instead:
      </p>

      <form className="hub-nf__search" role="search" onSubmit={submit}>
        <label htmlFor="hub-nf-q" className="hub-sr">
          Search games
        </label>
        <HubIcon name="search" size={20} className="hub-nf__mag" />
        <input
          id="hub-nf-q"
          ref={inputRef}
          className="hub-nf__input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search games"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button type="submit" className="hub-btn hub-btn--primary hub-nf__go">
          Search
        </button>
      </form>

      <div className="hub-nf__actions">
        <Link to={paths.games()} className="hub-btn hub-btn--primary hub-btn--lg">
          <HubIcon name="compass" size={20} /> Browse all games
        </Link>
        <Link to={paths.hub()} className="hub-btn hub-btn--ghost hub-btn--lg">
          <HubIcon name="home" size={20} /> Back home
        </Link>
        <button type="button" className="hub-btn hub-btn--ghost hub-btn--lg" onClick={() => window.dispatchEvent(new Event(OPEN_CODE_EVENT))}>
          <HubIcon name="hash" size={20} /> Have a code?
        </button>
      </div>

      {games.length > 0 && (
        <nav className="hub-nf__try" aria-label="Open a game">
          <span className="hub-nf__try-label">Open a game</span>
          {games.map((g) => (
            <Link key={g.id} to={paths.game(g.id)} className="st-chip hub-nf__chip">
              {g.name}
            </Link>
          ))}
        </nav>
      )}
    </section>
  );
}
