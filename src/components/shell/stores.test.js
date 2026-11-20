import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ claimDailyReward: vi.fn() }));
vi.mock('@/lib/api.js', () => ({
  claimDailyReward: api.claimDailyReward,
  errorMessage: (e, fb) => (e && e.message) || fb,
}));

import { claimDaily, claimDailyServer, dailyStateOf, progressOf } from './stores.js';

describe('progressOf (level / XP / coins)', () => {
  const local = { xp: 0, coins: 500 };
  it('uses the server numbers for a signed-in player, guests included', () => {
    // server curve: level 2 at 100 XP, level 3 at 250 XP (100 + (L-1)*50 per level)
    const p = progressOf({ xp: 250, coins: 1250, level: 3 }, local);
    expect(p).toMatchObject({ xp: 250, coins: 1250, level: 3 });
    expect(p.info).toMatchObject({ level: 3, into: 0, need: 200 });
    expect(progressOf({ xp: 300 }, local).info).toMatchObject({ level: 3, into: 50 });
    expect(progressOf({ xp: 0, coins: 0, isGuest: true }, { xp: 900, coins: 9 })).toMatchObject({ xp: 0, coins: 0, level: 1 });
  });
  it('falls back to the on-device profile while signed out or when the server omits a number', () => {
    expect(progressOf(null, { xp: 100, coins: 700 })).toMatchObject({ xp: 100, coins: 700, level: 2 });
    expect(progressOf({ name: 'x' }, { xp: 100, coins: 700 })).toMatchObject({ xp: 100, coins: 700 });
  });
  it('survives a missing profile', () => {
    expect(progressOf(null, undefined)).toMatchObject({ xp: 0, coins: 0, level: 1 });
  });
});

describe('dailyStateOf', () => {
  const now = new Date(2026, 10, 15, 12);
  it('uses the server daily block for a session', () => {
    const user = { id: 1, daily: { streak: 3, lastClaim: '2026-11-14', canClaim: true, nextReward: 300 } };
    expect(dailyStateOf(user, {}, now)).toEqual({ canClaim: true, streak: 3, lastClaim: '2026-11-14', nextReward: 300, server: true });
    expect(dailyStateOf({ id: 1, daily: { streak: 2, canClaim: false } }, {}, now)).toMatchObject({ canClaim: false, nextReward: 200 });
  });
  it('a session without a daily block cannot claim locally', () => {
    expect(dailyStateOf({ id: 1 }, { lastDailyClaim: null }, now)).toMatchObject({ canClaim: false, server: true });
  });
  it('falls back to the on-device profile when signed out', () => {
    expect(dailyStateOf(null, { lastDailyClaim: '2026-11-14', dailyStreak: 2 }, now)).toMatchObject({ canClaim: true, streak: 2, nextReward: 250, server: false });
    expect(dailyStateOf(null, { lastDailyClaim: '2026-11-10', dailyStreak: 5 }, now)).toMatchObject({ canClaim: true, nextReward: 150 });
    expect(dailyStateOf(null, { lastDailyClaim: '2026-11-15', dailyStreak: 4 }, now)).toMatchObject({ canClaim: false, nextReward: 300 });
  });
});

describe('claimDaily (server for a session)', () => {
  beforeEach(() => {
    api.claimDailyReward.mockReset();
  });

  it('claims on the server, then refreshes the user', async () => {
    api.claimDailyReward.mockResolvedValue({ reward: 250, streak: 3, coins: 1750, daily: { canClaim: false } });
    const refresh = vi.fn().mockResolvedValue({});
    const r = await claimDaily({ user: { id: 1 }, refresh });
    expect(r).toEqual({ ok: true, coins: 250, streak: 3, balance: 1750, daily: { canClaim: false }, server: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('409 means already claimed (and still refreshes)', async () => {
    api.claimDailyReward.mockImplementation(async () => { throw Object.assign(new Error('Already claimed today.'), { status: 409 }); });
    const refresh = vi.fn();
    expect(await claimDailyServer({ refresh })).toEqual({ ok: false, already: true, server: true });
    expect(refresh).toHaveBeenCalled();
  });
  it('offline resolves with an error message instead of throwing', async () => {
    api.claimDailyReward.mockImplementation(async () => { throw Object.assign(new Error('Offline'), { status: 0 }); });
    expect(await claimDailyServer({})).toMatchObject({ ok: false, error: 'Offline' });
  });
  it('without a session it is the synchronous on-device claim', () => {
    const r = claimDaily();
    expect(r).not.toBeInstanceOf(Promise);
    expect(typeof r.ok).toBe('boolean');
    expect(api.claimDailyReward).not.toHaveBeenCalled();
  });
});
