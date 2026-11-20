import { describe, expect, it } from 'vitest';
import { BADGES, buildBadgeContext, evaluateBadges, gameBadges, newlyEarned } from './badges.js';
import { fmtStat, matchResult, ordinal, relTime, resolveGameStats, statDefs, statDefsWithRating, statValue } from './gameStats.js';
import { playersLabel } from './gameTheme.js';

describe('resolveGameStats', () => {
  it('prefers the server per-game stats', () => {
    const user = { gameStats: { 'hyderabad-tycoon': { games: 3, wins: 2, bestScore: 5000, rating: 1010 } } };
    expect(resolveGameStats({ user, gameId: 'hyderabad-tycoon' })).toMatchObject({ games: 3, wins: 2, bestScore: 5000, source: 'server' });
  });

  it('falls back to the legacy account totals for the default game only', () => {
    const user = { stats: { games: 4, wins: 1, bestWorth: 70000 } };
    expect(resolveGameStats({ user, gameId: 'hyderabad-tycoon' })).toMatchObject({ games: 4, wins: 1, bestScore: 70000, source: 'account' });
    expect(resolveGameStats({ user, gameId: 'some-other-game' })).toBeNull();
  });

  it('returns null when there is nothing to show (an on-device profile no longer counts)', () => {
    expect(resolveGameStats({ user: null, gameId: 'hyderabad-tycoon' })).toBeNull();
    expect(resolveGameStats({ user: { stats: { games: 0, wins: 0, bestWorth: 0 } }, gameId: 'hyderabad-tycoon' })).toBeNull();
  });
});

describe('stat helpers', () => {
  it('reads bestScore from the legacy bestWorth', () => {
    expect(statValue({ bestWorth: 12 }, 'bestScore')).toBe(12);
    expect(statValue({ wins: 0 }, 'wins')).toBe(0);
    expect(statValue({}, 'wins')).toBeNull();
  });

  it('formats numbers with Indian grouping and em dash for missing', () => {
    expect(fmtStat(125000)).toBe('1,25,000');
    expect(fmtStat(null)).toBe('—');
    expect(fmtStat(70000, { format: 'inr' })).toBe('₹70k');
  });

  it('uses the manifest stats or a default trio', () => {
    expect(statDefs({ stats: [{ key: 'wins', label: 'Wins' }] })).toEqual([{ key: 'wins', label: 'Wins' }]);
    expect(statDefs(null).length).toBe(3);
  });

  it('labels player counts', () => {
    expect(playersLabel({ min: 2, max: 6 })).toBe('2–6 players');
    expect(playersLabel({ min: 4, max: 4 })).toBe('4 players');
    expect(playersLabel({ min: 1, max: 1 })).toBe('Solo');
    expect(playersLabel(null)).toBe('');
  });
});

describe('badges', () => {
  const earnedIds = (ctx) => evaluateBadges(ctx).filter((b) => b.earned).map((b) => b.id);

  it('has unique ids', () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });

  it('earns nothing for a brand-new player', () => {
    const ctx = buildBadgeContext({ perGame: [], level: 1, friends: 0 });
    expect(earnedIds(ctx)).toEqual([]);
  });

  it('derives First Win and 10 Wins from the per-game stats', () => {
    const per = [{ games: 12, wins: 10 }];
    const ids = earnedIds(buildBadgeContext({ perGame: per, level: 2, friends: 0 }));
    expect(ids).toEqual(expect.arrayContaining(['rookie', 'first-win', 'ten-wins']));
    expect(ids).not.toContain('social-butterfly');
  });

  it('platform badges carry no game-specific rules or money text', () => {
    expect(BADGES.some((b) => b.id === 'landlord' || b.id === 'hotel-tycoon')).toBe(false);
    expect(BADGES.every((b) => !/₹|\brent\b|hotel|tycoon/i.test(`${b.label} ${b.desc}`))).toBe(true);
  });

  it('level and streak badges follow the level and daily streak they are given', () => {
    expect(earnedIds(buildBadgeContext({ perGame: [], level: 5, friends: 0 }))).toContain('level-5');
    expect(earnedIds(buildBadgeContext({ perGame: [], level: 4, friends: 0 }))).not.toContain('level-5');
    expect(earnedIds(buildBadgeContext({ perGame: [], level: 10, friends: 0 }))).toEqual(expect.arrayContaining(['level-5', 'level-10']));
    expect(earnedIds(buildBadgeContext({ perGame: [], streak: 3, level: 1, friends: 0 }))).toEqual(['streak-3']);
    expect(earnedIds(buildBadgeContext({ perGame: [], streak: 7, level: 1, friends: 0 }))).toEqual(expect.arrayContaining(['streak-3', 'streak-7']));
  });

  it('hides Explorer until at least two games are live', () => {
    const one = evaluateBadges(buildBadgeContext({ perGame: [{ games: 1, wins: 0 }], level: 1, friends: 0, liveGames: 1 }));
    expect(one.some((b) => b.id === 'explorer')).toBe(false);
    const two = buildBadgeContext({ perGame: [{ games: 1, wins: 0 }, { games: 2, wins: 1 }], level: 1, friends: 0, liveGames: 2 });
    expect(earnedIds(two)).toContain('explorer');
  });

  it('hides Social Butterfly until the friends list is known, then needs 3 friends', () => {
    const base = { perGame: [], level: 1 };
    expect(evaluateBadges(buildBadgeContext({ ...base, friends: null })).some((b) => b.id === 'social-butterfly')).toBe(false);
    expect(earnedIds(buildBadgeContext({ ...base, friends: 3 }))).toContain('social-butterfly');
    expect(earnedIds(buildBadgeContext({ ...base, friends: 2 }))).not.toContain('social-butterfly');
  });

  it('reports progress for locked badges', () => {
    const ctx = buildBadgeContext({ perGame: [{ games: 5, wins: 5 }], level: 1, friends: 0 });
    const ten = evaluateBadges(ctx).find((b) => b.id === 'ten-wins');
    expect(ten).toMatchObject({ earned: false, value: 5, target: 10, pct: 50 });
  });
});

describe('game badges from the manifest', () => {
  const game = {
    id: 'g1',
    name: 'Game One',
    badges: [
      { id: 'landlord', label: 'Landlord', desc: 'Collect 5,00,000 in rent', stat: 'rentEarned', target: 500000, icon: 'landlord' },
      { id: 'bad' }, // malformed: skipped
    ],
  };

  it('evaluates against the per-game stats, falling back to the extra source, with namespaced ids', () => {
    const [b] = gameBadges(game, { rentEarned: 250000 });
    expect(b).toMatchObject({ id: 'g1:landlord', label: 'Landlord', art: 'landlord', earned: false, value: 250000, pct: 50, gameId: 'g1' });
    expect(gameBadges(game, {}, { rentEarned: 600000 })[0]).toMatchObject({ earned: true, value: 500000, pct: 100 });
    expect(gameBadges(game, null)).toHaveLength(1);
    expect(gameBadges({ id: 'x' }, {})).toEqual([]);
  });

  it('newlyEarned lists earned badges that were not seen before', () => {
    const list = [
      { id: 'a', earned: true },
      { id: 'b', earned: true },
      { id: 'c', earned: false },
    ];
    expect(newlyEarned(['a'], list)).toEqual(['b']);
    expect(newlyEarned([], list)).toEqual(['a', 'b']);
    expect(newlyEarned(null, list)).toEqual(['a', 'b']);
    expect(newlyEarned(['a', 'b'], list)).toEqual([]);
  });
});

describe('match + leaderboard helpers', () => {
  it('puts rating second in the stat columns', () => {
    const game = { stats: [{ key: 'wins', label: 'Wins' }, { key: 'games', label: 'Games' }, { key: 'bestScore', label: 'Best net worth' }] };
    expect(statDefsWithRating(game, 3).map((d) => d.key)).toEqual(['wins', 'rating', 'games']);
    expect(statDefsWithRating({ stats: [{ key: 'rating', label: 'Elo' }, { key: 'wins', label: 'Wins' }] }, 3).map((d) => d.label)).toEqual(['Wins', 'Elo']);
    expect(statDefsWithRating(null, 2).map((d) => d.key)).toEqual(['wins', 'rating']);
  });

  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  });

  it('result chip: Won, or place of player count', () => {
    expect(matchResult({ won: true, rank: 1, playerCount: 4 })).toEqual({ text: 'Won', tone: 'win' });
    expect(matchResult({ won: false, rank: 2, playerCount: 4 })).toEqual({ text: '2nd of 4', tone: 'podium' });
    expect(matchResult({ won: false, rank: 2, playerCount: 2 })).toEqual({ text: '2nd of 2', tone: 'loss' });
    expect(matchResult({ rank: 3, players: [{}, {}, {}] }).text).toBe('3rd of 3');
    expect(matchResult({}).text).toBe('Finished');
  });

  it('relative time', () => {
    const now = Date.parse('2026-11-15T12:00:00Z');
    expect(relTime('2026-11-15T11:59:50Z', now)).toBe('just now');
    expect(relTime('2026-11-15T11:55:00Z', now)).toBe('5 minutes ago');
    expect(relTime('2026-11-15T09:00:00Z', now)).toBe('3 hours ago');
    expect(relTime('2026-11-14T12:00:00Z', now)).toBe('yesterday');
    expect(relTime('2026-11-01T12:00:00Z', now)).toMatch(/1 Nov/);
    expect(relTime('nope', now)).toBe('');
    expect(relTime(null, now)).toBe('');
  });
});
