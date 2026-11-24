// /search?q=: live catalogue search. The field filters as you type; the URL follows (debounced, replace) so Back is
// clean and a result page is shareable. Arrow keys walk the results, Enter opens the top one.
// Cine layout (docs/CINE_UI.md): the big page title with a dim "Browse" sibling, a glass field, poster grids, and the
// dashed-folder empty state.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CATEGORIES, GAMES } from '@/games/registry.js';
import { BRAND } from '@/platform/brand.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { paths } from '@/platform/paths.js';
import { CatIcon } from '@/platform/home/GameArt.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import BrowseCard from '@/platform/browse/BrowseCard.jsx';
import { GamePoster } from '@/platform/browse/GameArt.jsx';
import { searchGames } from '@/platform/browse/searchGames.js';
import { browseHref } from '@/platform/browse/filters.js';
import { ClockIcon, CloseIcon, SearchIcon } from '@/platform/browse/icons.jsx';
import { getRecents, pushRecent, saveRecents } from '@/platform/browse/storage.js';
import '@/styles/cine/browse.css';

const DEBOUNCE_MS = 250;
const MAX_Q = 80;

const live = (g) => g.status !== 'coming_soon';

export default function Search() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const urlQ = (params.get('q') ?? '').slice(0, MAX_Q);
  const [value, setValue] = useState(urlQ);
  const [recents, setRecents] = useState(getRecents);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const lastPushed = useRef(urlQ);

  const query = value.trim();
  useDocTitle(query ? `“${query}” · Search · ${BRAND.name}` : `Search · ${BRAND.name}`);

  // autofocus (without scrolling the page)
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Back/Forward, a palette link or a shared URL changed ?q= from outside: follow it
  useEffect(() => {
    if (urlQ !== lastPushed.current) {
      lastPushed.current = urlQ;
      setValue(urlQ);
    }
  }, [urlQ]);

  // typing -> URL, debounced, replacing the entry so one search is one history step
  useEffect(() => {
    const next = value.trim();
    if (next === lastPushed.current.trim()) return undefined;
    const t = setTimeout(() => {
      lastPushed.current = next;
      setParams(next ? { q: next } : {}, { replace: true });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, setParams]);

  const results = useMemo(() => (query ? searchGames(query) : []), [query]);
  const liveHits = results.filter((r) => live(r.game));
  const soonHits = results.filter((r) => !live(r.game));

  const remember = useCallback((q) => {
    setRecents((list) => {
      const next = pushRecent(list, q);
      if (next !== list) saveRecents(next);
      return next;
    });
  }, []);
  const forget = (q) =>
    setRecents((list) => {
      const next = list.filter((x) => x !== q);
      saveRecents(next);
      return next;
    });
  const clearRecents = () => {
    saveRecents([]);
    setRecents([]);
  };

  const links = () => [...(listRef.current?.querySelectorAll('a[data-result]') ?? [])];

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') {
      const first = links()[0];
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === 'Enter') {
      if (!query) return;
      e.preventDefault();
      remember(query);
      if (results[0]) navigate(paths.game(results[0].game.id));
    } else if (e.key === 'Escape' && value) {
      e.preventDefault();
      setValue('');
    }
  };

  const onResultKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') return;
    const all = links();
    const at = all.indexOf(e.currentTarget);
    e.preventDefault();
    if (e.key === 'Escape') inputRef.current?.focus();
    else if (e.key === 'ArrowDown') all[Math.min(at + 1, all.length - 1)]?.focus();
    else if (at <= 0) inputRef.current?.focus();
    else all[at - 1]?.focus();
  };

  const pickSuggestion = (q) => {
    setValue(q);
    remember(q);
    inputRef.current?.focus({ preventScroll: true });
  };

  const total = results.length;
  const liveGames = GAMES.filter(live);
  const cats = CATEGORIES.map((c) => ({ ...c, n: GAMES.filter((g) => g.category === c.id).length }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n);
  let rowIndex = 0;
  const section = (title, hits, id) =>
    hits.length > 0 && (
      <section className="cj-browse-sgroup" aria-labelledby={id}>
        <h2 id={id} className="cj-section__title cj-browse-sgroup__title">
          {title}
          <span className="cj-browse-sgroup__n">{hits.length}</span>
        </h2>
        <ul className="cj-browse-grid" role="list">
          {hits.map(({ game }) => (
            <li key={game.id}>
              <BrowseCard game={game} query={query} index={rowIndex++} onOpen={() => remember(query)} onKeyDown={onResultKey} />
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="hub-page cj-browse cj-search">
      <div className="cj-browse-glow" aria-hidden="true" />
      <header className="cj-pagehead cj-browse-head">
        <h1 className="cj-pagehead__title">Search</h1>
        <Link className="cj-pagehead__tab" to={paths.games()}>
          Browse
        </Link>
      </header>

      <form className="cj-browse-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="bw-q" className="hub-sr">
          Search games
        </label>
        <SearchIcon className="cj-browse-search__ico" width={20} height={20} />
        <input
          id="bw-q"
          ref={inputRef}
          className="cj-input cj-browse-search__input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Search by name, category or players"
          maxLength={MAX_Q}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onInputKey}
        />
        {value && (
          <button
            type="button"
            className="cj-browse-search__clear"
            aria-label="Clear search"
            onClick={() => {
              setValue('');
              inputRef.current?.focus({ preventScroll: true });
            }}
          >
            <CloseIcon width={18} height={18} />
          </button>
        )}
      </form>

      <p className="hub-sr" role="status" aria-live="polite">
        {query ? (total ? `${total} ${total === 1 ? 'result' : 'results'} for ${query}` : `No results for ${query}`) : ''}
      </p>

      {query ? (
        total > 0 ? (
          <div ref={listRef} className="cj-browse-results">
            {section('Games', liveHits, 'bw-s-live')}
            {section('Coming soon', soonHits, 'bw-s-soon')}
            <p className="cj-browse-hint">
              <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open the top result.
            </p>
          </div>
        ) : (
          <div className="cj-empty cj-browse-empty">
            <span className="cj-empty__art" aria-hidden="true">
              <span className="cj-browse-empty__mark">
                <HubIcon name="search" size={22} />
              </span>
            </span>
            <h2 className="cj-empty__title">No games match “{query}”</h2>
            <p className="cj-empty__body">Check the spelling, or try a category or a single word.</p>
            <ul className="cj-browse-suggest" role="list" aria-label="Try a category">
              {cats.map((c) => (
                <li key={c.id}>
                  <Link className="cj-chip" to={browseHref({ cat: c.id })}>
                    <CatIcon cat={c} size={16} />
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="cj-empty__actions">
              <Link className="cj-btn cj-btn--primary" to={paths.games()}>
                Browse all games
              </Link>
              <button type="button" className="cj-btn" onClick={() => setValue('')}>
                Clear search
              </button>
            </div>
          </div>
        )
      ) : (
        <>
          {recents.length > 0 && (
            <section className="cj-section cj-browse-block" aria-labelledby="bw-recent">
              <div className="cj-section__head">
                <h2 id="bw-recent" className="cj-section__title">
                  Recent searches
                </h2>
                <button type="button" className="cj-browse-textbtn" onClick={clearRecents}>
                  Clear all
                </button>
              </div>
              <ul className="cj-browse-suggest cj-browse-suggest--left" role="list">
                {recents.map((q) => (
                  <li key={q} className="cj-browse-recent">
                    <button type="button" className="cj-chip cj-browse-recent__q" onClick={() => pickSuggestion(q)}>
                      <ClockIcon width={14} height={14} />
                      {q}
                    </button>
                    <button type="button" className="cj-browse-recent__x" aria-label={`Remove ${q} from recent searches`} onClick={() => forget(q)}>
                      <CloseIcon width={12} height={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="cj-section cj-browse-block" aria-labelledby="bw-cats">
            <div className="cj-section__head">
              <h2 id="bw-cats" className="cj-section__title">
                Browse by category
              </h2>
              <Link className="cj-browse-textbtn" to={paths.games()}>
                All games
              </Link>
            </div>
            <ul className="cj-row cj-browse-tiles" role="list">
              {cats.map((c) => (
                <li key={c.id}>
                  <Link className="cj-tile" to={browseHref({ cat: c.id })}>
                    <span className="cj-tile__art cj-browse-tile__art">
                      <CatIcon cat={c} size={34} />
                    </span>
                    <span>
                      {c.label}
                      <small className="cj-browse-tile__n">
                        {c.n} {c.n === 1 ? 'game' : 'games'}
                      </small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {liveGames.length > 0 && (
            <section className="cj-section cj-browse-block" aria-labelledby="bw-playnow">
              <div className="cj-section__head">
                <h2 id="bw-playnow" className="cj-section__title">
                  Playable now
                </h2>
              </div>
              <div ref={listRef}>
                <ul className="cj-row" role="list">
                  {liveGames.slice(0, 4).map((game) => (
                    <li key={game.id}>
                      <GamePoster game={game} onKeyDown={onResultKey} />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
