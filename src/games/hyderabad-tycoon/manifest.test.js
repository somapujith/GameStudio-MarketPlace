// The manifest is read eagerly by src/games/registry.js, so it has to stay small and well-formed.
import { describe, expect, it, vi } from 'vitest';

// The art lives in other files (JSX); the manifest only needs something to point at.
vi.mock('@/components/art/hub/index.js', () => ({ TycoonCover: () => null, TycoonIcon: () => null }));

const { default: manifest } = await import('./manifest.js');

describe('hyderabad-tycoon manifest', () => {
  it('has the contract fields', () => {
    expect(manifest.id).toBe('hyderabad-tycoon');
    expect(manifest.name).toBe('Hyderabad Tycoon');
    expect(manifest.tagline).toBe('Own the city. Survive the madness.');
    expect(manifest.description).toMatch(/₹15 lakh/);
    expect(manifest.description).not.toMatch(/snatch|jail|hotel/i);
    expect(manifest.category).toBe('board');
    expect(manifest.status).toBe('live');
    expect(manifest.players).toEqual({ min: 2, max: 6 });
    expect(manifest.duration).toBe('35-60 min');
    expect(manifest.modes).toEqual({ friends: true, open: false });
    expect(typeof manifest.createHint).toBe('string');
    expect(manifest.art.cover).toBeTypeOf('function');
  });

  it('how to play in 4 steps, the six pieces, badges on client-visible stats', () => {
    expect(manifest.howToPlay.map((s) => s.title)).toEqual(['Roll', 'Buy or auction', 'Upgrade', 'Richest wins']);
    for (const s of manifest.howToPlay) expect(s.text.length).toBeGreaterThan(10);
    expect(manifest.pieces.map((p) => p.id)).toEqual(['pearl', 'auto', 'handi', 'chai', 'bat', 'camera']);
    expect(manifest.badges.length).toBeGreaterThan(0);
    for (const b of manifest.badges) {
      expect(Object.keys(b)).toEqual(expect.arrayContaining(['id', 'label', 'desc', 'stat', 'target', 'icon']));
      expect(['games', 'wins', 'bestScore', 'rating']).toContain(b.stat);
      expect(b.target).toBeGreaterThan(0);
    }
    expect(manifest.stats).toEqual([
      { key: 'wins', label: 'Wins' },
      { key: 'games', label: 'Games' },
      { key: 'bestScore', label: 'Best net worth', format: 'inr' },
      { key: 'rating', label: 'Rating' },
    ]);
  });

  it('online only: one loader, no extras or saved game', () => {
    expect(manifest.extras).toBeUndefined();
    expect(manifest.savedGame).toBeUndefined();
    expect(Object.keys(manifest.loaders)).toEqual(['onlineGame']);
  });

  it('shows only the mode in the lobby, with the table rules and a one-line summary', () => {
    expect(manifest.lobbySettings).toEqual(['mode']);
    expect(manifest.tableRules).toBe('One die · 3 business levels per district · Chai, Auto shortcuts and city rush hours');
    for (const k of manifest.lobbySettings) expect(manifest.settings.some((f) => f.key === k)).toBe(true);
    expect(manifest.summarize({ mode: 'standard', dice: 'lucky' })).toBe('Standard City Hustle · 20 rounds · richest wins');
  });
});
