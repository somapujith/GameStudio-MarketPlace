import { describe, expect, it } from 'vitest';
import { paths } from './paths.js';
import { gameSlug, normalizeGameId } from './game/identity.js';

describe('Nawabi Raj public links and room compatibility', () => {
  it('uses the new name for public links from either identity', () => {
    for (const id of ['hyderabad-tycoon', 'nawabi-raj']) {
      expect(paths.game(id)).toBe('/games/nawabi-raj');
      expect(paths.online(id, 'ABC234')).toBe('/play/nawabi-raj/online/ABC234');
      expect(paths.leaderboard(id)).toBe('/leaderboard?game=nawabi-raj');
      expect(normalizeGameId(id)).toBe('hyderabad-tycoon');
    }
  });

  it('preserves other games and escapes shared links', () => {
    expect(normalizeGameId('ludo-lanes')).toBe('ludo-lanes');
    expect(gameSlug('ludo-lanes')).toBe('ludo-lanes');
    expect(paths.online('ludo-lanes', 'A/B')).toBe('/play/ludo-lanes/online/A%2FB');
  });
});
