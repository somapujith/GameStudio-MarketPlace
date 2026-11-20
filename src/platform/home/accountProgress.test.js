import { describe, expect, it } from 'vitest';
import { accountProgress, xpAtLevel, xpToLeave } from './accountProgress.js';

describe('accountProgress', () => {
  it('uses the server level when signed in, even if the XP alone would say another level', () => {
    // 720 XP derives to level 5 on the shared curve, but the server (and the top bar) say level 4
    const p = accountProgress({ id: 'u', xp: 720, coins: 10, level: 4 }, { xp: 0, coins: 0 });
    expect(p.level).toBe(4);
    expect(p.need).toBe(xpToLeave(4));
    expect(p.into).toBeLessThanOrEqual(p.need);
    expect(p.pct).toBeGreaterThanOrEqual(0);
    expect(p.pct).toBeLessThanOrEqual(100);
    expect(p.source).toBe('server');
  });

  it('agrees with the curve when the server level matches the XP', () => {
    const p = accountProgress({ id: 'u', xp: 120, coins: 0, level: 2 }, {});
    expect(p).toMatchObject({ level: 2, into: 20, need: 150 });
  });

  it('derives the level from the device profile for visitors', () => {
    const p = accountProgress(null, { xp: 120, coins: 40 });
    expect(p).toMatchObject({ level: 2, coins: 40, source: 'device' });
  });

  it('falls back to the derived level when the server sends no level', () => {
    expect(accountProgress({ id: 'u', xp: 120, coins: 0 }, {}).level).toBe(2);
  });

  it('level spans add up', () => {
    expect(xpAtLevel(1)).toBe(0);
    expect(xpAtLevel(3)).toBe(100 + 150);
  });
});
