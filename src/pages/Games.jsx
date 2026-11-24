// /games: the whole catalogue with category chips, filters, sort and a poster grid / list view. The URL is the state
// (?cat=&players=&dur=&status=&sort=&view=), so every combination is shareable and Back/Forward just work.
// Cine layout (docs/CINE_UI.md): the big page title with a dim "Search" sibling, glass chips, a poster grid.
import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CATEGORIES, GAMES } from '@/games/registry.js';
import { BRAND } from '@/platform/brand.js';
import useDocTitle from '@/platform/game/useDocTitle.js';
import { paths } from '@/platform/paths.js';
import { CatIcon } from '@/platform/home/GameArt.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import BrowseCard from '@/platform/browse/BrowseCard.jsx';
import BrowseRow from '@/platform/browse/BrowseRow.jsx';
import FilterControls from '@/platform/browse/FilterControls.jsx';
import FilterSheet from '@/platform/browse/FilterSheet.jsx';
import { GridIcon, ListIcon, SlidersIcon, CloseIcon } from '@/platform/browse/icons.jsx';
import {
  SORT_OPTIONS,
  activeChips,
  activeFilterCount,
  applyFilters,
  catalogueSummary,
  facetCounts,
  isDefault,
  parseState,
  toQuery,
} from '@/platform/browse/filters.js';
import { getStoredView, setStoredView } from '@/platform/browse/storage.js';
import '@/styles/cine/browse.css';

const CAT_IDS = CATEGORIES.map((c) => c.id);

export default function Games() {
  useDocTitle(`Browse games · ${BRAND.name}`);
  const [params, setParams] = useSearchParams();
  const [storedView, setStoredViewState] = useState(getStoredView);
  const [sheetOpen, setSheetOpen] = useState(false);
  const filterBtn = useRef(null);

  const state = useMemo(() => parseState(params, CAT_IDS, storedView), [params, storedView]);
  const results = useMemo(() => applyFilters(GAMES, state), [state]);
  const counts = useMemo(() => facetCounts(GAMES, state, CATEGORIES), [state]);
  const chips = useMemo(() => activeChips(state, CATEGORIES), [state]);

  // categories nobody publishes in are not worth a chip (unless the URL asked for one)
  const cats = CATEGORIES.filter((c) => c.id === state.cat || GAMES.some((g) => g.category === c.id));

  const go = (patch, opts) => setParams(toQuery({ ...state, ...patch }, { storedView }), opts);
  const clearAll = () => go({ cat: 'all', players: 'any', dur: 'any', status: 'any' });
  const setView = (view) => {
    setStoredView(view);
    setStoredViewState(view);
    setParams(toQuery({ ...state, view }, { storedView: view }), { replace: true });
  };

  const n = results.length;
  const filtered = !isDefault(state);
  const soonSuggestions = GAMES.filter((g) => g.status === 'coming_soon').slice(0, 3);
  const filterCount = activeFilterCount(state);
  const soonActive = state.status === 'soon';

  return (
    <div className="hub-page cj-browse">
      <div className="cj-browse-glow" aria-hidden="true" />
      <header className="cj-pagehead cj-browse-head">
        <h1 className="cj-pagehead__title">Browse</h1>
        <Link className="cj-pagehead__tab" to={paths.search()}>
          Search
        </Link>
      </header>
      <p className="cj-lede cj-browse-lede">
        {GAMES.some((g) => g.status !== 'coming_soon') && <i className="cj-live-dot" aria-hidden="true" />}
        {catalogueSummary(GAMES)}
      </p>

      <section className="cj-browse-controls" aria-label="Filter and sort games">
        <div className="cj-browse-cats" role="group" aria-label="Category">
          <button type="button" className="cj-chip cj-browse-cat" aria-pressed={state.cat === 'all'} onClick={() => go({ cat: 'all' })}>
            All<span className="cj-browse-cat__n">{counts.all}</span>
          </button>
          {cats.map((c) => (
            <button key={c.id} type="button" className={`cj-chip cj-browse-cat ${counts.byCat[c.id] === 0 ? 'is-empty' : ''}`} aria-pressed={state.cat === c.id} onClick={() => go({ cat: state.cat === c.id ? 'all' : c.id })}>
              <CatIcon cat={c} size={16} />
              {c.label}
              <span className="cj-browse-cat__n">{counts.byCat[c.id]}</span>
            </button>
          ))}
          <button type="button" className={`cj-chip cj-browse-cat ${counts.soon === 0 ? 'is-empty' : ''}`} aria-pressed={soonActive} onClick={() => go({ status: soonActive ? 'any' : 'soon' })}>
            <CatIcon cat={{ id: 'soon' }} size={16} />
            Coming soon<span className="cj-browse-cat__n">{counts.soon}</span>
          </button>
        </div>

        {/* wide screens: the filters sit in the page */}
        <div className="cj-browse-bar">
          <FilterControls state={state} onChange={(patch) => go(patch)} idPrefix="bf" />
        </div>

        {/* phones: one button opens the sheet, active filters show as removable chips */}
        <div className="cj-browse-phonebar">
          <button ref={filterBtn} type="button" className="cj-btn cj-btn--sm cj-browse-filterbtn" onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
            <SlidersIcon />
            Filters
            {filterCount > 0 && <span className="cj-browse-filterbtn__n">{filterCount}</span>}
          </button>
          {chips.length > 0 && (
            <ul className="cj-browse-active" role="list" aria-label="Active filters">
              {chips.map((c) => (
                <li key={c.key}>
                  <button type="button" className="cj-chip is-on" onClick={() => go({ [c.key]: c.key === 'cat' ? 'all' : 'any' })} aria-label={`Remove filter ${c.label}`}>
                    {c.label}
                    <CloseIcon width={14} height={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="cj-browse-toolbar">
          <div className="cj-browse-resultwrap">
            <p className="cj-browse-result" role="status" aria-live="polite" aria-atomic="true">
              {n === 0 ? 'No games match' : filtered ? `Showing ${n} of ${GAMES.length} games` : `${n} ${n === 1 ? 'game' : 'games'}`}
            </p>
            {filtered && (
              <button type="button" className="cj-browse-textbtn" onClick={clearAll}>
                Clear filters
              </button>
            )}
          </div>
          <label className="cj-browse-sort">
            <span>Sort</span>
            <select value={state.sort} onChange={(e) => go({ sort: e.target.value }, { replace: true })}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <HubIcon name="chevDown" size={14} />
          </label>
          <div className="cj-browse-view" role="group" aria-label="Layout">
            <button type="button" className="cj-browse-viewbtn" aria-pressed={state.view === 'grid'} aria-label="Grid view" onClick={() => setView('grid')}>
              <GridIcon />
            </button>
            <button type="button" className="cj-browse-viewbtn" aria-pressed={state.view === 'list'} aria-label="List view" onClick={() => setView('list')}>
              <ListIcon />
            </button>
          </div>
        </div>
      </section>

      {n > 0 ? (
        <ul className={state.view === 'list' ? 'cj-browse-list' : 'cj-browse-grid'} role="list">
          {results.map((game, i) => (
            <li key={game.id}>{state.view === 'list' ? <BrowseRow game={game} index={i} /> : <BrowseCard game={game} index={i} />}</li>
          ))}
        </ul>
      ) : (
        <div className="cj-empty cj-browse-empty">
          <span className="cj-empty__art" aria-hidden="true">
            <span className="cj-browse-empty__mark">
              <HubIcon name="compass" size={22} />
            </span>
          </span>
          <h2 className="cj-empty__title">No games match these filters</h2>
          <p className="cj-empty__body">Try fewer filters, or widen the number of players. New games are on the way.</p>
          <div className="cj-empty__actions">
            <button type="button" className="cj-btn cj-btn--primary" onClick={clearAll}>
              Clear filters
            </button>
            {!soonActive && soonSuggestions.length > 0 && (
              <button type="button" className="cj-btn" onClick={() => go({ cat: 'all', players: 'any', dur: 'any', status: 'soon' })}>
                See what is coming soon
              </button>
            )}
          </div>
          {soonSuggestions.length > 0 && (
            <ul className="cj-browse-suggest" role="list" aria-label="Coming soon">
              {soonSuggestions.map((g) => (
                <li key={g.id}>
                  <Link className="cj-chip" to={paths.game(g.id)}>
                    {g.name}
                    <span className="cj-browse-suggest__soon">Soon</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <FilterSheet
        open={sheetOpen}
        state={state}
        games={GAMES}
        returnFocusRef={filterBtn}
        onClose={() => setSheetOpen(false)}
        onApply={(patch) => {
          setSheetOpen(false);
          go(patch);
        }}
      />
    </div>
  );
}
