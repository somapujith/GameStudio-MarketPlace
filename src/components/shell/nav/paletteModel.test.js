import { describe, expect, it } from 'vitest';
import { buildSections, codeFromQuery, flatten, isOpenShortcut, shortcutLabel, stepIndex } from './paletteModel.js';

const games = [
  { id: 'tycoon', name: 'Hyderabad Tycoon', tagline: 'Buy the city', status: 'live', category: 'board' },
  { id: 'ludo', name: 'Ludo Lanes', tagline: 'Race home', status: 'coming_soon', category: 'board' },
];
// deterministic stand-in for searchGames
const search = (q) => games.filter((g) => g.name.toLowerCase().includes(q.toLowerCase())).map((game) => ({ game, score: 40 }));

describe('codeFromQuery', () => {
  it('accepts 4-6 valid code characters', () => {
    expect(codeFromQuery('abc234')).toBe('ABC234');
    expect(codeFromQuery('  K7M2  ')).toBe('K7M2');
  });
  it('rejects short, long, spaced and look-alike input', () => {
    expect(codeFromQuery('abc')).toBe('');
    expect(codeFromQuery('abc2345')).toBe('');
    expect(codeFromQuery('ab c234')).toBe('');
    expect(codeFromQuery('AB0O12')).toBe('');
  });
});

describe('buildSections', () => {
  it('shows recents and every quick action for an empty query', () => {
    const s = buildSections({ query: '', games, recent: [games[0]], signedIn: true, search });
    expect(s.map((x) => x.id)).toEqual(['recent', 'actions']);
    expect(s[1].items.map((i) => i.id)).toContain('a-code');
    expect(s[1].items.find((i) => i.id === 'a-profile')).toBeTruthy();
  });
  it('swaps My profile for Sign in when signed out', () => {
    const s = buildSections({ query: '', games, signedIn: false, next: '/games', search });
    const signin = s[0].items.find((i) => i.id === 'a-signin');
    expect(signin.to).toBe('/login?next=%2Fgames');
  });
  it('ranks games first, then actions, then a search-all row', () => {
    const s = buildSections({ query: 'hyder', games, search, signedIn: true });
    expect(s.map((x) => x.id)).toEqual(['games', 'search']);
    expect(flatten(s).at(-1).to).toBe('/search?q=hyder');
  });
  it('offers Join table for a code-shaped query, first when no game matches', () => {
    const s = buildSections({ query: 'k7m2qx', games, search, signedIn: true });
    expect(flatten(s)[0]).toMatchObject({ kind: 'join', label: 'Join table K7M2QX', to: '/join/K7M2QX' });
  });
  it('keeps Join table last when a code with digits also matches a game', () => {
    const s = buildSections({ query: 'hyd234', games, search: () => [{ game: games[0], score: 10 }], signedIn: true });
    expect(s.map((x) => x.id)).toEqual(['games', 'join', 'search']);
  });
  it('matches quick actions by keyword', () => {
    const s = buildSections({ query: 'friends', games, search, signedIn: true });
    expect(flatten(s).some((i) => i.id === 'a-friends')).toBe(true);
  });
});

describe('helpers', () => {
  it('wraps the active index', () => {
    expect(stepIndex(-1, 1, 3)).toBe(0);
    expect(stepIndex(-1, -1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });
  it('labels the shortcut per platform', () => {
    expect(shortcutLabel('MacIntel')).toBe('⌘K');
    expect(shortcutLabel('Win32')).toBe('Ctrl K');
  });
  it('opens on Ctrl/Cmd+K, and on / only outside text fields', () => {
    expect(isOpenShortcut({ key: 'k', ctrlKey: true })).toBe(true);
    expect(isOpenShortcut({ key: 'K', metaKey: true })).toBe(true);
    expect(isOpenShortcut({ key: 'k' })).toBe(false);
    expect(isOpenShortcut({ key: '/', target: { tagName: 'BODY' } })).toBe(true);
    expect(isOpenShortcut({ key: '/', target: { tagName: 'INPUT' } })).toBe(false);
    expect(isOpenShortcut({ key: '/', target: { tagName: 'DIV', isContentEditable: true } })).toBe(false);
  });
});
