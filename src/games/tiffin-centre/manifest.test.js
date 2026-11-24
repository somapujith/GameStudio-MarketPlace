// The manifest is read eagerly by src/games/registry.js, so it has to stay small and well-formed.
import { describe, expect, it } from 'vitest';
import manifest from './manifest.js';
import { GAMES, getGame, liveGames } from '../registry.js';

describe('tiffin-centre manifest', () => {
  it('has the contract fields', () => {
    expect(manifest.id).toBe('tiffin-centre');
    expect(manifest.name).toBe('Tiffin Centre');
    expect(manifest.tagline.length).toBeGreaterThan(5);
    expect(manifest.tagline.length).toBeLessThanOrEqual(48);
    expect(manifest.description.split('\n\n')).toHaveLength(2);
    expect(manifest.description).toMatch(/collect the money before they walk off/i);
    expect(manifest.description).toMatch(/tawa, steamer, kadai and chai counter/);
    expect(manifest.category).toBe('social');
    expect(manifest.status).toBe('live');
    expect(manifest.players).toEqual({ min: 2, max: 4 });
    expect(manifest.duration).toBe('5-10 min');
    expect(manifest.modes).toEqual({ friends: true, open: false });
    expect(manifest.theme).toEqual({ accent: '#ff8a1f', accent2: '#12908e', bg: '#241a14' });
    expect(['function', 'object']).toContain(typeof manifest.art.cover); // plain or memo() component
    expect(['function', 'object']).toContain(typeof manifest.art.icon);
  });

  it('is both a solo game (tutorial + practice) and a room game, with the tutorial gating rooms', () => {
    expect(manifest.solo).toBe(true);
    expect(manifest.tutorial).toEqual({ requiredForRooms: true });
    expect(Object.keys(manifest.loaders).sort()).toEqual(['onlineGame', 'soloGame']);
    expect(manifest.loaders.soloGame).toBeTypeOf('function');
    expect(manifest.loaders.onlineGame).toBeTypeOf('function');
  });

  it('carries honest store-listing metadata (no ratings, counts or invented dates)', () => {
    expect(manifest.publisher).toBe('Jalebi Games');
    expect(manifest.version).toBe('1.0');
    expect(manifest.languages).toEqual(['English', 'Telugu']);
    expect(manifest.platforms).toEqual(['Phone', 'Tablet', 'Desktop']);
    expect(manifest.tags).toEqual(expect.arrayContaining(['Co-op', 'Real time', 'Cooking', 'Hyderabad', '3D', 'Tiffin', 'Dosa', 'Street food']));
    expect(manifest.highlights.length).toBeGreaterThan(1);
    for (const h of manifest.highlights) expect(Object.keys(h)).toEqual(['icon', 'title', 'text']);
    expect(manifest.howToPlay.length).toBeGreaterThanOrEqual(4);
    expect(manifest.howToPlay.length).toBeLessThanOrEqual(5);
    for (const s of manifest.howToPlay) {
      expect(typeof s.icon).toBe('string');
      expect(s.text.length).toBeGreaterThan(10);
    }
    expect(manifest.howToPlay.map((s) => s.title.toLowerCase()).join(' ')).toMatch(/collect the money/);
    expect(manifest.gallery.length).toBeGreaterThan(0);
    for (const k of ['released', 'ageRating', 'rating', 'ratings', 'reviews', 'installs', 'downloads', 'playersOnline']) expect(manifest[k]).toBeUndefined();
  });

  it('stats and badges read the per-game stats the client sees', () => {
    expect(manifest.stats).toEqual([
      { key: 'games', label: 'Shifts' },
      { key: 'wins', label: 'Shifts cleared' },
      { key: 'bestScore', label: 'Best shift', format: 'inr' },
    ]);
    for (const b of manifest.badges) {
      expect(Object.keys(b)).toEqual(expect.arrayContaining(['id', 'label', 'desc', 'stat', 'target', 'icon']));
      expect(['games', 'wins', 'bestScore']).toContain(b.stat);
      expect(b.target).toBeGreaterThan(0);
    }
  });

  it('shows the level and the pace in the lobby with a one-line summary', () => {
    expect(manifest.lobbySettings).toEqual(['level', 'pace']);
    for (const k of manifest.lobbySettings) expect(manifest.settings.some((f) => f.key === k)).toBe(true);
    expect(manifest.summarize({ level: 3, pace: 'rush' })).toBe('Level 3: Poori Morning, Rush hour pace');
  });

  it('is registered: live, found by id, placed after Autowala and before the teasers', () => {
    expect(getGame('tiffin-centre')).toBe(manifest);
    expect(liveGames().map((g) => g.id)).toContain('tiffin-centre');
    const ids = GAMES.map((g) => g.id);
    expect(ids.indexOf('tiffin-centre')).toBe(ids.indexOf('autowala') + 1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
