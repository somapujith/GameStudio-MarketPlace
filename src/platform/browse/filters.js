// Browse model: URL <-> state, filtering, sorting, counts. Pure (no React, no DOM), so it is unit-tested.
// State shape: { cat, players, dur, status, sort, view }. The URL is the source of truth:
//   /games?cat=sports&players=2&dur=short&status=live&sort=az&view=list   (defaults are left out)

export const PLAYER_OPTIONS = [
  { id: 'any', label: 'Any' },
  { id: '2', label: '2', min: 2, max: 2 },
  { id: '3', label: '3', min: 3, max: 3 },
  { id: '4', label: '4', min: 4, max: 4 },
  { id: '5-6', label: '5–6', min: 5, max: 6 },
  { id: '7plus', label: '7+', min: 7, max: Infinity },
];

// Bands are judged on the middle of a game's duration range ("35-60 min" is about 48 min: long).
export const DURATION_OPTIONS = [
  { id: 'any', label: 'Any' },
  { id: 'short', label: 'Short', hint: 'Under 20 min', tiny: '<20 min', from: 0, to: 20 },
  { id: 'medium', label: 'Medium', hint: '20–40 min', tiny: '20–40 min', from: 20, to: 40 },
  { id: 'long', label: 'Long', hint: '40 min or more', tiny: '40+ min', from: 40, to: Infinity },
];

export const STATUS_OPTIONS = [
  { id: 'any', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'soon', label: 'Coming soon' },
];

export const SORT_OPTIONS = [
  { id: 'featured', label: 'Featured' },
  { id: 'az', label: 'A–Z' },
  { id: 'short', label: 'Shortest' },
  { id: 'players', label: 'Most players' },
];

export const DEFAULTS = Object.freeze({ cat: 'all', players: 'any', dur: 'any', status: 'any', sort: 'featured', view: 'grid' });

const ids = (opts) => opts.map((o) => o.id);
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const isSoon = (g) => g?.status === 'coming_soon';

/** Parse "35-60 min", "1 hr", "45 min - 1 hr", "about 30m", "1-2 hours" into [lo, hi] minutes, or null. */
export function parseDuration(text) {
  const s = String(text ?? '').toLowerCase();
  const found = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)?\b/g)];
  if (!found.length) return null;
  const unitOf = (u) => (u && u.startsWith('h') ? 60 : 1);
  // a number without its own unit takes the unit of the next one that has one ("1-2 hours"), else minutes
  const vals = found.map((m, i) => {
    let unit = m[2];
    for (let j = i + 1; !unit && j < found.length; j++) unit = found[j][2];
    return parseFloat(m[1].replace(',', '.')) * unitOf(unit);
  });
  const nums = vals.filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  return [Math.min(...nums), Math.max(...nums)];
}

/** Middle of the duration range in minutes, or null when the manifest string cannot be read. */
export function durationMid(game) {
  const r = parseDuration(game?.duration);
  return r ? (r[0] + r[1]) / 2 : null;
}

export function durationBand(game) {
  const mid = durationMid(game);
  if (mid == null) return null;
  return DURATION_OPTIONS.find((o) => o.from != null && mid >= o.from && mid < o.to)?.id ?? null;
}

/** Seats a game can be played with, as [min, max]; null when the manifest does not say. */
export function playerRange(game) {
  const min = Number(game?.players?.min);
  const max = Number(game?.players?.max);
  if (!Number.isFinite(min) && !Number.isFinite(max)) return null;
  const lo = Number.isFinite(min) && min > 0 ? min : max;
  const hi = Number.isFinite(max) && max > 0 ? max : lo;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

export function matchesPlayers(game, id) {
  if (id === 'any') return true;
  const opt = PLAYER_OPTIONS.find((o) => o.id === id);
  const range = playerRange(game);
  if (!opt || !range) return false;
  return range[0] <= opt.max && range[1] >= opt.min; // the game has a table size inside the bucket
}

/** Normalise any URLSearchParams-like input into a full, valid state. Unknown values fall back to the defaults. */
export function parseState(params, categoryIds = [], storedView = DEFAULTS.view) {
  const get = (k) => (params && typeof params.get === 'function' ? (params.get(k) ?? '').trim().toLowerCase() : '');
  let cat = get('cat');
  let status = get('status');
  if (cat === 'soon') {
    cat = 'all';
    status = 'soon'; // "Coming soon" is a status, whichever way the link was written
  }
  let players = get('players').replace(/\s/g, '').replace('–', '-');
  if (players === '7' || players === '7+') players = '7plus';
  if (players === '5' || players === '6' || players === '5–6') players = '5-6';
  return {
    cat: cat === 'all' || categoryIds.includes(cat) ? cat || 'all' : DEFAULTS.cat,
    players: pick(players, ids(PLAYER_OPTIONS), DEFAULTS.players),
    dur: pick(get('dur'), ids(DURATION_OPTIONS), DEFAULTS.dur),
    status: pick(status, ids(STATUS_OPTIONS), DEFAULTS.status),
    sort: pick(get('sort'), ids(SORT_OPTIONS), DEFAULTS.sort),
    view: pick(get('view'), ['grid', 'list'], storedView === 'list' ? 'list' : DEFAULTS.view),
  };
}

/** Query string for a state (defaults are omitted, so the plain catalogue URL stays `/games`). */
export function toQuery(state, { storedView = DEFAULTS.view } = {}) {
  const p = new URLSearchParams();
  for (const k of ['cat', 'players', 'dur', 'status', 'sort']) if (state[k] && state[k] !== DEFAULTS[k]) p.set(k, state[k]);
  // `view` is written whenever it is not the plain default (a visitor whose saved view is the list keeps it in the URL)
  if (state.view && (state.view !== DEFAULTS.view || storedView !== DEFAULTS.view)) p.set('view', state.view);
  return p;
}

/** `/games?...` for a partial state (links from search suggestions, empty states). */
export function browseHref(partial = {}) {
  const q = toQuery({ ...DEFAULTS, ...partial }, { storedView: DEFAULTS.view }).toString();
  return q ? `/games?${q}` : '/games';
}

export const isDefault = (state, keys = ['cat', 'players', 'dur', 'status']) => keys.every((k) => state[k] === DEFAULTS[k]);

/** How many of the filter-bar filters (players, time, status) are set. */
export const activeFilterCount = (state) => ['players', 'dur', 'status'].filter((k) => state[k] !== DEFAULTS[k]).length;

/** Does `game` pass the state? `skip` names filters to ignore (used to count a facet against all the others). */
export function matches(game, state, skip = []) {
  if (!skip.includes('cat') && state.cat !== 'all' && game.category !== state.cat) return false;
  if (!skip.includes('status')) {
    if (state.status === 'live' && isSoon(game)) return false;
    if (state.status === 'soon' && !isSoon(game)) return false;
  }
  if (!skip.includes('players') && !matchesPlayers(game, state.players)) return false;
  if (!skip.includes('dur') && state.dur !== 'any' && durationBand(game) !== state.dur) return false;
  return true;
}

const byCatalogue = (games) => new Map(games.map((g, i) => [g.id, i]));

export function sortGames(games, sort) {
  const order = byCatalogue(games);
  const idx = (g) => order.get(g.id);
  const live = (g) => (isSoon(g) ? 1 : 0);
  const list = [...games];
  const tie = (a, b) => idx(a) - idx(b);
  switch (sort) {
    case 'az':
      return list.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }) || tie(a, b));
    case 'short':
      return list.sort((a, b) => (durationMid(a) ?? Infinity) - (durationMid(b) ?? Infinity) || live(a) - live(b) || tie(a, b));
    case 'players':
      return list.sort((a, b) => (playerRange(b)?.[1] ?? 0) - (playerRange(a)?.[1] ?? 0) || live(a) - live(b) || tie(a, b));
    default: // featured: flagged games first, live before coming soon, then catalogue order
      return list.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || live(a) - live(b) || tie(a, b));
  }
}

export function applyFilters(games, state) {
  return sortGames(games.filter((g) => matches(g, state)), state.sort);
}

/** Chip counts: each category counts the games that pass every OTHER filter; 'soon' ignores the status filter. */
export function facetCounts(games, state, categories) {
  const byCat = {};
  for (const c of categories) byCat[c.id] = games.filter((g) => g.category === c.id && matches(g, state, ['cat'])).length;
  return {
    all: games.filter((g) => matches(g, state, ['cat'])).length,
    byCat,
    soon: games.filter((g) => isSoon(g) && matches(g, state, ['status'])).length,
  };
}

/** Removable chips for the active filters (phone filter summary). */
export function activeChips(state, categories = []) {
  const out = [];
  if (state.cat !== 'all') out.push({ key: 'cat', label: categories.find((c) => c.id === state.cat)?.label ?? state.cat });
  const label = (opts, id) => opts.find((o) => o.id === id)?.label;
  if (state.players !== 'any') out.push({ key: 'players', label: `${label(PLAYER_OPTIONS, state.players)} players` });
  if (state.dur !== 'any') out.push({ key: 'dur', label: DURATION_OPTIONS.find((o) => o.id === state.dur)?.hint ?? state.dur });
  if (state.status !== 'any') out.push({ key: 'status', label: label(STATUS_OPTIONS, state.status) });
  return out;
}

/** "5 games · 1 live now · 4 coming soon" for the page header. */
export function catalogueSummary(games) {
  const live = games.filter((g) => !isSoon(g)).length;
  const soon = games.length - live;
  const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
  const parts = [n(games.length, 'game', 'games')];
  if (live) parts.push(`${live} live now`);
  if (soon) parts.push(`${soon} coming soon`);
  return parts.join(' · ');
}
