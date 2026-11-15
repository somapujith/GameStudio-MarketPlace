// /search?q=: live catalogue search. The field filters as you type; the URL follows (debounced, replace) so Back is
// clean and a result page is shareable. Arrow keys walk the results, Enter opens the top one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CATEGORIES, GAMES } from '@/games/registry.js';
import { BRAND } from '@/platform/brand.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { paths } from '@/platform/paths.js';
import { CatIcon } from '@/platform/home/GameArt.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import BrowseRow from '@/platform/browse/BrowseRow.jsx';
import { searchGames } from '@/platform/browse/searchGames.js';
import { browseHref } from '@/platform/browse/filters.js';
import { ClockIcon, CloseIcon, SearchIcon } from '@/platform/browse/icons.jsx';
import { getRecents, pushRecent, saveRecents } from '@/platform/browse/storage.js';
import '@/styles/store-browse.css';

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
      <section className="bw-sgroup" aria-labelledby={id}>
        <h2 id={id} className="bw-sgroup__title">
          {title}
          <span className="bw-sgroup__n">{hits.length}</span>
        </h2>
        <ul className="bw-list" role="list">
          {hits.map(({ game }) => (
            <li key={game.id} className="bw-li">
              <BrowseRow game={game} query={query} index={rowIndex++} onOpen={() => remember(query)} onKeyDown={onResultKey} />
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="hub-page bw-page st-scope">
      <header className="bw-head st-reveal">
        <span className="st-eyebrow">Search</span>
        <h1 className="bw-title">Find your next game</h1>
      </header>

      <form className="bw-search st-reveal" style={{ '--i': 1 }} role="search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="bw-q" className="hub-sr">
          Search games
        </label>
        <SearchIcon className="bw-search__ico" width={22} height={22} />
        <input
          id="bw-q"
          ref={inputRef}
          className="bw-search__input"
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
            className="bw-search__clear"
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
          <div ref={listRef} className="bw-results">
            {section('Games', liveHits, 'bw-s-live')}
            {section('Coming soon', soonHits, 'bw-s-soon')}
            <p className="bw-hint">
              <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open the top result.
            </p>
          </div>
        ) : (
          <div className="bw-empty st-card">
            <span className="bw-empty__mark" aria-hidden="true">
              <HubIcon name="search" size={30} />
            </span>
            <h2 className="bw-empty__title">No games match “{query}”</h2>
            <p className="bw-empty__text">Check the spelling, or try a category or a single word.</p>
            <ul className="bw-suggest" role="list" aria-label="Try a category">
              {cats.map((c) => (
                <li key={c.id}>
                  <Link className="hub-chip" to={browseHref({ cat: c.id })}>
                    <CatIcon cat={c} size={18} />
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="bw-empty__actions">
              <Link className="hub-btn hub-btn--primary" to={paths.games()}>
                Browse all games
              </Link>
              <button type="button" className="hub-btn hub-btn--ghost" onClick={() => setValue('')}>
                Clear search
              </button>
            </div>
          </div>
        )
      ) : (
        <>
          {recents.length > 0 && (
            <section className="bw-block st-reveal" style={{ '--i': 2 }} aria-labelledby="bw-recent">
              <div className="st-head">
                <h2 id="bw-recent" className="st-head__title bw-h">
                  Recent searches
                </h2>
                <button type="button" className="bw-textbtn" onClick={clearRecents}>
                  Clear all
                </button>
              </div>
              <ul className="bw-suggest" role="list">
                {recents.map((q) => (
                  <li key={q} className="bw-recent">
                    <button type="button" className="hub-chip bw-recent__q" onClick={() => pickSuggestion(q)}>
                      <ClockIcon width={16} height={16} />
                      {q}
                    </button>
                    <button type="button" className="bw-recent__x" aria-label={`Remove ${q} from recent searches`} onClick={() => forget(q)}>
                      <CloseIcon width={14} height={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="bw-block st-reveal" style={{ '--i': 3 }} aria-labelledby="bw-cats">
            <div className="st-head">
              <h2 id="bw-cats" className="st-head__title bw-h">
                Browse by category
              </h2>
              <Link className="st-link" to={paths.games()}>
                All games
              </Link>
            </div>
            <ul className="bw-suggest" role="list">
              {cats.map((c) => (
                <li key={c.id}>
                  <Link className="hub-chip" to={browseHref({ cat: c.id })}>
                    <CatIcon cat={c} size={18} />
                    {c.label}
                    <span className="bw-cat__n">{c.n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {liveGames.length > 0 && (
            <section className="bw-block st-reveal" style={{ '--i': 4 }} aria-labelledby="bw-playnow">
              <div className="st-head">
                <h2 id="bw-playnow" className="st-head__title bw-h">
                  Playable now
                </h2>
              </div>
              <div ref={listRef}>
                <ul className="bw-list" role="list">
                  {liveGames.slice(0, 4).map((game, i) => (
                    <li key={game.id} className="bw-li">
                      <BrowseRow game={game} index={i} onKeyDown={onResultKey} />
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
