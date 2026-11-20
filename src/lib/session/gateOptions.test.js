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

  it('the Snatch buttons are the one exception: the window is real time, so the press never waits for an animation', () => {
    const snatchReal = { ...real, roll: false, snatch: { tile: 29, ms: 5000 } };
    for (const flags of [{ busy: true }, { awaiting: true }, { busy: true, awaiting: true }]) {
      const out = gateOptions(snatchReal, { phase: 'snatch' }, flags);
      expect(out.snatch).toEqual({ tile: 29, ms: 5000 });
      expect(out.roll).toBe(false);
      expect(out.endTurn).toBe(false); // everything else stays blank
      expect(out.upgrade).toEqual([]);
    }
    // after pressing, the "locked in" mark gets through too
    expect(gateOptions({ ...real, snatch: null, snatched: true }, { phase: 'snatch' }, { busy: true }).snatched).toBe(true);
    // outside a snatch window the Snatch options are blanked like everything else
    expect(gateOptions(snatchReal, { phase: 'manage' }, { busy: true }).snatch).toBeNull();
    expect(gateOptions(snatchReal, null, { busy: true }).snatch).toBeNull();
    // and nothing gets through offline
    expect(gateOptions(snatchReal, { phase: 'snatch' }, { busy: true, connection: 'closed' }).snatch).toBeNull();
  });

  it('trading is not a table move: while the presenter animates, an offer to me and the Trade button stay live', () => {
    const t = { ...real, roll: false, trade: { canOffer: true }, tradeOffer: { id: 4, from: 'x', give: {}, get: {}, canCounter: true }, tradeSent: null };
    const busy = gateOptions(t, { phase: 'manage' }, { busy: true });
    expect(busy.tradeOffer).toMatchObject({ id: 4, canCounter: true });
    expect(busy.trade.canOffer).toBe(true);
    expect(busy.endTurn).toBe(false);
    // a request of mine in flight (or a dead connection) still blanks it, so nothing is sent twice
    expect(gateOptions(t, { phase: 'manage' }, { awaiting: true }).tradeOffer).toBeNull();
    expect(gateOptions(t, { phase: 'manage' }, { awaiting: true, busy: true }).trade.canOffer).toBe(false);
    expect(gateOptions(t, { phase: 'manage' }, { busy: true, connection: 'closed' }).tradeOffer).toBeNull();
  });

  it('blanks everything when the connection is not open', () => {
    const out = gateOptions(real, { phase: 'roll' }, { connection: 'connecting' });
    expect(out.roll).toBe(false);
    expect(out.ride).toBeNull();
    expect(gateOptions(null, null).roll).toBe(false);
  });
});
