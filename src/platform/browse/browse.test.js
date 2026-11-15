import { describe, expect, it } from 'vitest';
import { searchGames, highlightParts, editDistance, norm } from './searchGames.js';
import {
  DEFAULTS,
  activeChips,
  applyFilters,
  browseHref,
  catalogueSummary,
  durationBand,
  facetCounts,
  matchesPlayers,
  parseDuration,
  parseState,
  sortGames,
  toQuery,
} from './filters.js';
import { pushRecent } from './storage.js';

const CATS = [
  { id: 'board', label: 'Board' },
  { id: 'card', label: 'Card' },
  { id: 'sports', label: 'Sports' },
  { id: 'word', label: 'Word' },
];
const CAT_IDS = CATS.map((c) => c.id);

const mk = (id, over = {}) => ({
  id,
  name: id,
  tagline: '',
  category: 'board',
  status: 'live',
  players: { min: 2, max: 4 },
  duration: '20-30 min',
  ...over,
});

// the shipped catalogue shape: one live game and a few teasers
const TYCOON = mk('hyderabad-tycoon', { name: 'Hyderabad Tycoon', tagline: 'Own the city. Survive the madness.', description: 'Buy districts, collect rent.', players: { min: 2, max: 6 }, duration: '35-60 min', featured: true });
const LUDO = mk('ludo-lanes', { name: 'Ludo Lanes', status: 'coming_soon', tagline: 'Race four tokens home', players: { min: 2, max: 4 }, duration: '15-30 min' });
const CARROM = mk('carrom-club', { name: 'Carrom Club', status: 'coming_soon', category: 'sports', players: { min: 2, max: 4 }, duration: '10-20 min', tags: ['Flick', 'Classic'] });
const TAMBOLA = mk('tambola-night', { name: 'Tambola Night', status: 'coming_soon', category: 'card', players: { min: 2, max: 20 }, duration: '20-40 min' });
const SMALL = [TYCOON, LUDO, CARROM, TAMBOLA];

const BIG = Array.from({ length: 20 }, (_, i) =>
  mk(`game-${i}`, {
    name: i === 7 ? 'The Extraordinarily Long Named Game of Many Words and Invisible Rules' : `Game ${String.fromCharCode(90 - i)}${i}`,
    category: CAT_IDS[i % CAT_IDS.length],
    status: i < 6 ? 'live' : 'coming_soon',
    players: { min: 2 + (i % 3), max: 2 + (i % 3) + (i % 5) },
    duration: i % 4 === 0 ? '1 hr' : `${10 + i * 3}-${20 + i * 3} min`,
  }),
);

describe('norm and editDistance', () => {
  it('folds case, accents and punctuation', () => {
    expect(norm('  Café—Rush! ')).toBe('cafe rush');
  });
  it('counts a swap as one edit', () => {
    expect(editDistance('tycoon', 'tyocon')).toBe(1);
    expect(editDistance('abc', 'abd')).toBe(1);
    expect(editDistance('abc', 'xyzxyz', 2)).toBeGreaterThan(2);
  });
});

describe('searchGames', () => {
  it('returns the whole catalogue for an empty query', () => {
    expect(searchGames('', SMALL).map((r) => r.game.id)).toEqual(SMALL.map((g) => g.id));
    expect(searchGames('   ', SMALL)).toHaveLength(4);
  });
  it('ranks a name hit above a tagline hit and keeps live ahead of soon', () => {
    const r = searchGames('race', [TYCOON, LUDO], CATS);
    expect(r.map((x) => x.game.id)).toEqual(['ludo-lanes']);
    const both = searchGames('ludo', [LUDO, mk('x', { name: 'Other', tagline: 'a ludo-like game' })], CATS);
    expect(both[0].game.id).toBe('ludo-lanes');
  });
  it('is accent- and case-insensitive', () => {
    const g = mk('cafe', { name: 'Café Rush' });
    expect(searchGames('CAFE', [g], CATS)).toHaveLength(1);
    expect(searchGames('café', [mk('c2', { name: 'Cafe Two' })], CATS)).toHaveLength(1);
  });
  it('tolerates a typo in terms of 4+ characters but not in short ones', () => {
    expect(searchGames('tycon', SMALL, CATS)[0].game.id).toBe('hyderabad-tycoon'); // prefix typo
    expect(searchGames('tyocon', SMALL, CATS)[0].game.id).toBe('hyderabad-tycoon'); // swapped letters
    expect(searchGames('hydrabad', SMALL, CATS)[0].game.id).toBe('hyderabad-tycoon');
    expect(searchGames('lud', SMALL, CATS)[0].game.id).toBe('ludo-lanes'); // plain prefix
    expect(searchGames('xyz', SMALL, CATS)).toHaveLength(0);
    expect(searchGames('zzzz', SMALL, CATS)).toHaveLength(0);
  });
  it('matches category label and tags, and needs every term to match', () => {
    expect(searchGames('sports', SMALL, CATS).map((r) => r.game.id)).toEqual(['carrom-club']);
    expect(searchGames('flick', SMALL, CATS).map((r) => r.game.id)).toEqual(['carrom-club']);
    expect(searchGames('carrom flick', SMALL, CATS)).toHaveLength(1);
    expect(searchGames('carrom tycoon', SMALL, CATS)).toHaveLength(0);
  });
  it('reads manifests without optional fields', () => {
    const bare = { id: 'bare', name: 'Bare', category: 'nope', status: 'live' };
    expect(() => searchGames('bare', [bare], CATS)).not.toThrow();
    expect(searchGames('bare', [bare], CATS)).toHaveLength(1);
  });
  it('works for a one-game catalogue and a 20-game catalogue', () => {
    expect(searchGames('hyderabad', [TYCOON], CATS)).toHaveLength(1);
    expect(searchGames('game', BIG, CATS).length).toBeGreaterThan(10);
    expect(searchGames('invisible rules', BIG, CATS)[0].game.id).toBe('game-7');
  });
});

describe('highlightParts', () => {
  it('marks the matched text', () => {
    expect(highlightParts('Hyderabad Tycoon', 'tycoon')).toEqual([
      { text: 'Hyderabad ', hit: false },
      { text: 'Tycoon', hit: true },
    ]);
  });
  it('matches through accents and highlights the word a typo matched', () => {
    expect(highlightParts('Café Rush', 'cafe')[0]).toEqual({ text: 'Café', hit: true });
    expect(highlightParts('Hyderabad Tycoon', 'tyocon').find((p) => p.hit)?.text).toBe('Tycoon');
  });
  it('returns plain text for an empty query or no match', () => {
    expect(highlightParts('Ludo', '')).toEqual([{ text: 'Ludo', hit: false }]);
    expect(highlightParts('Ludo', 'zzz')).toEqual([{ text: 'Ludo', hit: false }]);
  });
});

describe('duration parsing', () => {
  it('reads ranges and units', () => {
    expect(parseDuration('35-60 min')).toEqual([35, 60]);
    expect(parseDuration('15 min')).toEqual([15, 15]);
    expect(parseDuration('1 hr')).toEqual([60, 60]);
    expect(parseDuration('1-2 hours')).toEqual([60, 120]);
    expect(parseDuration('45 min - 1 hr')).toEqual([45, 60]);
    expect(parseDuration('about 30m')).toEqual([30, 30]);
  });
  it('returns null for text it cannot read', () => {
    expect(parseDuration('varies')).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
  it('bands by the middle of the range', () => {
    expect(durationBand(CARROM)).toBe('short'); // 10-20
    expect(durationBand(LUDO)).toBe('medium'); // 15-30
    expect(durationBand(TYCOON)).toBe('long'); // 35-60
    expect(durationBand(mk('u', { duration: 'varies' }))).toBeNull();
  });
});

describe('players', () => {
  it('matches a bucket when the game has a table size inside it', () => {
    expect(matchesPlayers(TYCOON, '2')).toBe(true);
    expect(matchesPlayers(TYCOON, '5-6')).toBe(true);
    expect(matchesPlayers(TYCOON, '7plus')).toBe(false);
    expect(matchesPlayers(LUDO, '5-6')).toBe(false);
    expect(matchesPlayers(TAMBOLA, '7plus')).toBe(true);
    expect(matchesPlayers(TYCOON, 'any')).toBe(true);
  });
  it('does not match a game with no player info', () => {
    expect(matchesPlayers(mk('np', { players: undefined }), '2')).toBe(false);
    expect(matchesPlayers(mk('np', { players: undefined }), 'any')).toBe(true);
  });
});

describe('URL state', () => {
  it('parses the shareable example and normalises junk', () => {
    const s = parseState(new URLSearchParams('?cat=sports&sort=az&players=2'), CAT_IDS);
    expect(s).toMatchObject({ cat: 'sports', sort: 'az', players: '2', dur: 'any', status: 'any', view: 'grid' });
    const junk = parseState(new URLSearchParams('?cat=nope&players=99&dur=x&status=y&sort=z&view=cube'), CAT_IDS);
    expect(junk).toEqual({ ...DEFAULTS });
  });
  it('treats cat=soon as the coming-soon status and 7+ as 7plus', () => {
    expect(parseState(new URLSearchParams('cat=soon'), CAT_IDS)).toMatchObject({ cat: 'all', status: 'soon' });
    expect(parseState(new URLSearchParams('players=7 '), CAT_IDS).players).toBe('7plus');
  });
  it('falls back to the saved view when the URL has none', () => {
    expect(parseState(new URLSearchParams(''), CAT_IDS, 'list').view).toBe('list');
    expect(parseState(new URLSearchParams('view=grid'), CAT_IDS, 'list').view).toBe('grid');
  });
  it('round-trips and leaves defaults out', () => {
    const s = { ...DEFAULTS, cat: 'board', players: '5-6', dur: 'long', status: 'live', sort: 'players', view: 'list' };
    const q = toQuery(s);
    expect(q.toString()).toBe('cat=board&players=5-6&dur=long&status=live&sort=players&view=list');
    expect(parseState(new URLSearchParams(q.toString()), CAT_IDS)).toEqual(s);
    expect(toQuery(DEFAULTS).toString()).toBe('');
    expect(browseHref()).toBe('/games');
    expect(browseHref({ cat: 'sports' })).toBe('/games?cat=sports');
  });
  it('keeps the view in the URL for a visitor whose saved view is the list', () => {
    expect(toQuery({ ...DEFAULTS, view: 'grid' }, { storedView: 'list' }).get('view')).toBe('grid');
    expect(toQuery({ ...DEFAULTS, view: 'list' }, { storedView: 'list' }).get('view')).toBe('list');
  });
});

describe('applyFilters and sort', () => {
  const st = (p) => ({ ...DEFAULTS, ...p });
  it('filters by category, status, players and time together', () => {
    expect(applyFilters(SMALL, st({ cat: 'sports' })).map((g) => g.id)).toEqual(['carrom-club']);
    expect(applyFilters(SMALL, st({ status: 'live' })).map((g) => g.id)).toEqual(['hyderabad-tycoon']);
    expect(applyFilters(SMALL, st({ players: '7plus' })).map((g) => g.id)).toEqual(['tambola-night']);
    expect(applyFilters(SMALL, st({ dur: 'short' })).map((g) => g.id)).toEqual(['carrom-club']);
    expect(applyFilters(SMALL, st({ status: 'soon', players: '5-6' })).map((g) => g.id)).toEqual(['tambola-night']);
    expect(applyFilters(SMALL, st({ cat: 'word' }))).toEqual([]);
  });
  it('a game with an unreadable duration only appears when time is Any', () => {
    const odd = mk('odd', { duration: 'varies' });
    expect(applyFilters([odd], st({ dur: 'short' }))).toEqual([]);
    expect(applyFilters([odd], st({}))).toHaveLength(1);
  });
  it('sorts: featured, A-Z, shortest, most players', () => {
    expect(sortGames(SMALL, 'featured').map((g) => g.id)).toEqual(['hyderabad-tycoon', 'ludo-lanes', 'carrom-club', 'tambola-night']);
    expect(sortGames(SMALL, 'az').map((g) => g.name)).toEqual(['Carrom Club', 'Hyderabad Tycoon', 'Ludo Lanes', 'Tambola Night']);
    expect(sortGames(SMALL, 'short').map((g) => g.id)).toEqual(['carrom-club', 'ludo-lanes', 'tambola-night', 'hyderabad-tycoon']);
    expect(sortGames(SMALL, 'players').map((g) => g.id)[0]).toBe('tambola-night');
  });
  it('does not mutate its input and handles 1 and 20 games', () => {
    const copy = [...BIG];
    sortGames(BIG, 'az');
    expect(BIG).toEqual(copy);
    expect(applyFilters([TYCOON], st({ sort: 'az' }))).toHaveLength(1);
    const live = applyFilters(BIG, st({ status: 'live' }));
    expect(live).toHaveLength(6);
    expect(applyFilters(BIG, st({})).length).toBe(20);
    expect(applyFilters([], st({}))).toEqual([]);
  });
});

describe('counts, chips and summary', () => {
  it('counts each category against the other filters', () => {
    const c = facetCounts(SMALL, { ...DEFAULTS, status: 'soon' }, CATS);
    expect(c.all).toBe(3);
    expect(c.byCat).toEqual({ board: 1, card: 1, sports: 1, word: 0 });
    expect(c.soon).toBe(3);
    const live = facetCounts(SMALL, { ...DEFAULTS, status: 'live' }, CATS);
    expect(live.byCat.board).toBe(1);
    expect(live.soon).toBe(3); // the Coming soon chip ignores the status filter itself
  });
  it('lists the active filters as chips', () => {
    expect(activeChips(DEFAULTS, CATS)).toEqual([]);
    expect(activeChips({ ...DEFAULTS, cat: 'sports', players: '5-6', dur: 'short', status: 'soon' }, CATS).map((c) => c.label)).toEqual(['Sports', '5–6 players', 'Under 20 min', 'Coming soon']);
  });
  it('summarises the catalogue with real numbers', () => {
    expect(catalogueSummary(SMALL)).toBe('4 games · 1 live now · 3 coming soon');
    expect(catalogueSummary([TYCOON])).toBe('1 game · 1 live now');
    expect(catalogueSummary([])).toBe('0 games');
  });
});

describe('recent searches', () => {
  it('puts the newest first, de-dupes case-insensitively and caps the list', () => {
    let l = [];
    l = pushRecent(l, 'ludo');
    l = pushRecent(l, 'Tycoon');
    l = pushRecent(l, 'LUDO');
    expect(l).toEqual(['LUDO', 'Tycoon']);
    for (let i = 0; i < 10; i++) l = pushRecent(l, `query ${i}`);
    expect(l).toHaveLength(6);
    expect(l[0]).toBe('query 9');
  });
  it('ignores one-letter queries', () => {
    expect(pushRecent([], 'a')).toEqual([]);
    expect(pushRecent(['ludo'], '  ')).toEqual(['ludo']);
  });
});
