import { describe, expect, it } from 'vitest';
import { gateOptions } from './gateOptions.js';

const real = {
  roll: true, payTraffic: 25000, useChai: true, buy: false, endTurn: true, ride: { to: 14, fare: 25000 },
  upgrade: [{ tile: 1 }], bid: null, sets: [{ group: 'bazaar', owned: 1, size: 3, multiplier: 1 }],
};

describe('gateOptions', () => {
  it('passes the real options through when idle and connected', () => {
    expect(gateOptions(real, { phase: 'roll' })).toBe(real);
  });

  it('blanks every action while the presenter animates or a request is in flight', () => {
    for (const flags of [{ busy: true }, { awaiting: true }]) {
      const out = gateOptions(real, { phase: 'manage' }, flags);
      expect(out.roll).toBe(false);
      expect(out.endTurn).toBe(false);
      expect(out.upgrade).toEqual([]);
      expect(out.ride).toBeNull();
      expect(out.useChai).toBe(false);
      expect(out.payTraffic).toBeFalsy();
      expect(out.sets).toEqual(real.sets); // informational, kept
    }
  });

  it('blanks everything when the connection is not open', () => {
    const out = gateOptions(real, { phase: 'roll' }, { connection: 'connecting' });
    expect(out.roll).toBe(false);
    expect(out.ride).toBeNull();
    expect(gateOptions(null, null).roll).toBe(false);
  });
});
