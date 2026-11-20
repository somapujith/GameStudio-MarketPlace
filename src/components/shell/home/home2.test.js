import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  dailyRewardFor,
  dailyView,
  fmtCountdown,
  istDayKey,
  joinableRooms,
  msUntilIstMidnight,
  openTablesById,
  pickResume,
  previewDays,
} from './homeModel.js';
import { homeCatalog, SOON_ID } from '@/platform/home/catalog.js';

// 2026-11-15 12:00 IST = 06:30 UTC
const NOON_IST = Date.UTC(2026, 10, 15, 6, 30);

describe('IST calendar helpers', () => {
  it('keys the IST day, not the UTC day', () => {
    expect(istDayKey(NOON_IST)).toBe('2026-11-15');
    // 20:00 UTC on the 15th is already 01:30 IST on the 16th
    expect(istDayKey(Date.UTC(2026, 10, 15, 20, 0))).toBe('2026-11-16');
    expect(istDayKey(Date.UTC(2026, 10, 15, 18, 29))).toBe('2026-11-15');
  });

  it('counts down to the next IST midnight', () => {
    expect(msUntilIstMidnight(NOON_IST)).toBe(12 * 3_600_000);
    const atMidnight = Date.UTC(2026, 10, 15, 18, 30); // 00:00 IST on the 16th
    expect(msUntilIstMidnight(atMidnight)).toBe(DAY_MS);
  });

  it('formats the countdown', () => {
    expect(fmtCountdown(5 * 3_600_000 + 12 * 60_000 + 30_000)).toBe('5h 12m');
    expect(fmtCountdown(3 * 3_600_000)).toBe('3h');
    expect(fmtCountdown(12 * 60_000)).toBe('12m');
    expect(fmtCountdown(20_000)).toBe('under a minute');
  });
});

describe('daily reward view', () => {
  it('follows the server reward rule 150..400', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 30].map(dailyRewardFor)).toEqual([150, 200, 250, 300, 350, 400, 400, 400]);
    expect(previewDays().map((d) => d.coins)).toEqual([150, 200, 250, 300, 350, 400, 400]);
  });

  it('a brand-new player can claim day 1', () => {
    const v = dailyView({ streak: 0, lastClaim: null, canClaim: true }, NOON_IST);
    expect(v).toMatchObject({ claimed: false, nextStreak: 1, todaysCoins: 150, lost: false });
    expect(v.days.find((d) => d.current).n).toBe(1);
    expect(v.days.filter((d) => d.done)).toHaveLength(0);
  });

  it('continues a streak claimed yesterday (IST)', () => {
    const v = dailyView({ streak: 3, lastClaim: '2026-11-14', canClaim: true }, NOON_IST);
    expect(v).toMatchObject({ claimed: false, nextStreak: 4, todaysCoins: 300, lost: false });
    expect(v.days.find((d) => d.current).n).toBe(4);
    expect(v.days.filter((d) => d.done).map((d) => d.n)).toEqual([1, 2, 3]);
  });

  it('flags a lost streak and restarts at day 1', () => {
    const v = dailyView({ streak: 5, lastClaim: '2026-11-10', canClaim: true }, NOON_IST);
    expect(v).toMatchObject({ claimed: false, nextStreak: 1, todaysCoins: 150, lost: true });
  });

  it('shows the claimed state for today', () => {
    const v = dailyView({ streak: 2, lastClaim: '2026-11-15', canClaim: false }, NOON_IST);
    expect(v).toMatchObject({ claimed: true, streak: 2 });
    expect(v.days.filter((d) => d.done).map((d) => d.n)).toEqual([1, 2]);
    expect(v.days.some((d) => d.current)).toBe(false);
  });

  it('trusts canClaim and nextReward from the server', () => {
    expect(dailyView({ streak: 2, lastClaim: '2026-11-15', canClaim: true, nextReward: 250 }, NOON_IST).claimed).toBe(false);
    expect(dailyView({ streak: 1, lastClaim: '2026-11-14', canClaim: true, nextReward: 999 }, NOON_IST).todaysCoins).toBe(999);
  });

  it('wraps the 7-day track after a week and tolerates a missing object', () => {
    const v = dailyView({ streak: 8, lastClaim: '2026-11-14', canClaim: true }, NOON_IST);
    expect(v.nextStreak).toBe(9);
    expect(v.days.find((d) => d.current).n).toBe(2);
    expect(v.todaysCoins).toBe(400);
    expect(dailyView(undefined, NOON_IST)).toMatchObject({ claimed: false, nextStreak: 1, todaysCoins: 150 });
  });
});

describe('rooms', () => {
  it('prefers a running game over a lobby, ignores junk', () => {
    expect(pickResume(null)).toBeNull();
    expect(pickResume([{ code: '' }, null])).toBeNull();
    const lobby = { code: 'AAA111', status: 'lobby' };
    const playing = { code: 'BBB222', status: 'playing' };
    expect(pickResume([lobby])).toEqual({ kind: 'lobby', room: lobby });
    expect(pickResume([lobby, playing])).toEqual({ kind: 'playing', room: playing });
    expect(pickResume([{ code: 'CCC333', status: 'ended' }])).toBeNull();
  });

  it('maps live table counts and drops full rooms', () => {
    expect(openTablesById([{ id: 'a', openTables: 3 }, { id: 'b', openTables: 0 }, { openTables: 2 }])).toEqual({ a: 3 });
    expect(openTablesById(undefined)).toEqual({});
    const rooms = [
      { code: 'A', players: 2, maxPlayers: 4 },
      { code: 'B', players: 4, maxPlayers: 4 },
      { code: 'C' },
      { players: 1 },
    ];
    expect(joinableRooms(rooms).map((r) => r.code)).toEqual(['A', 'C']);
  });
});

describe('home catalogue', () => {
  it('rows carry live games only; every teaser sits in one Coming soon row', () => {
    const { cats, soon } = homeCatalog();
    expect(cats.length).toBeGreaterThan(0);
    for (const c of cats) {
      expect(c.games.length).toBeGreaterThan(0);
      expect(c.games.every((g) => g.status !== 'coming_soon')).toBe(true);
    }
    if (soon) {
      expect(soon.id).toBe(SOON_ID);
      expect(soon.games.every((g) => g.status === 'coming_soon')).toBe(true);
    }
  });
});
