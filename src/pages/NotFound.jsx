import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { liveGames } from '@/games/registry.js';
import { BRAND } from '@/platform/brand.js';
import { paths } from '@/platform/paths.js';
import HubIcon from '@/platform/game/HubIcon.jsx';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { OPEN_CODE_EVENT } from '@/components/shell/nav/events.js';

/** A hanging paper lantern: the "0" of the 404 sign. Colours come from the hub tokens. */
function Lantern() {
  return (
    <svg className="hub-nf__lantern" viewBox="0 0 100 150" focusable="false" aria-hidden="true">
      <defs>
        <radialGradient id="nfGlow" cx="50%" cy="48%" r="60%">
          <stop offset="0" style={{ stopColor: 'rgb(var(--hub-gold-rgb))' }} stopOpacity="1" />
          <stop offset="1" style={{ stopColor: 'rgb(var(--hub-gold-rgb))' }} stopOpacity=".72" />
        </radialGradient>
      </defs>
      <path d="M50 0v18" style={{ stroke: 'var(--hub-faint)' }} strokeWidth="3" strokeLinecap="round" />
      <rect x="32" y="18" width="36" height="11" rx="4" style={{ fill: 'var(--hub-faint)' }} />
      <ellipse cx="50" cy="73" rx="42" ry="46" fill="url(#nfGlow)" />
      <path d="M50 27c-14 14-14 78 0 92M50 27c14 14 14 78 0 92M14 56h72M12 90h76" fill="none" style={{ stroke: 'var(--hub-bg)' }} strokeOpacity=".28" strokeWidth="2.4" />
      <rect x="32" y="116" width="36" height="11" rx="4" style={{ fill: 'var(--hub-faint)' }} />
      <path d="M44 127v14M50 127v19M56 127v14" style={{ stroke: 'rgb(var(--hub-gold-rgb))' }} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Hub 404: a shop sign ("4 lantern 4") over a search box, so a lost visitor can find the game they came for.
 * Also the look the "unavailable" cards share (see .hub-unavail in x-shell.css).
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
    <section className="hub-page hub-nf" aria-labelledby="hub-nf-h">
      <div className="hub-nf__sign" aria-hidden="true">
        <span className="hub-nf__digit">4</span>
        <Lantern />
        <span className="hub-nf__digit">4</span>
      </div>
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
