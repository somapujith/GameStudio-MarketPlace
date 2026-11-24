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

describe('solo game paths', () => {
  it('is the full-screen route /play/<slug>', () => {
    expect(paths.solo('autowala')).toBe('/play/autowala');
    expect(paths.solo('a/b')).toBe('/play/a%2Fb');
    expect(paths.solo('autowala')).not.toBe(paths.online('autowala', 'ABC234'));
  });
});

describe('admin console paths', () => {
  it('builds every section', () => {
    expect(paths.admin()).toBe('/admin');
    expect(paths.admin('')).toBe('/admin');
    for (const s of ['users', 'rooms', 'matches', 'grants', 'announcements', 'audit']) expect(paths.admin(s)).toBe(`/admin/${s}`);
  });

  it('builds a user page and escapes each segment', () => {
    expect(paths.admin('users/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed')).toBe('/admin/users/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed');
    expect(paths.admin('users/a b?c')).toBe('/admin/users/a%20b%3Fc');
    expect(paths.admin('/audit/')).toBe('/admin/audit');
  });
});
