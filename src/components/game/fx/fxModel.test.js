import { describe, expect, it } from 'vitest';
import { GROUP_TILES } from '@shared/board.js';
import { amountSpot, createGovernor, flightPlan, freshEntries, MINUS, reasonLabel, signedAmount, tileEffectsFor, tollTile } from './fxModel.js';
import { coinCount, coinTier, spinTurns } from './coins.js';
import { createFollower, createPool, overlaps } from './fxDom.js';

describe('reason labels and signed amounts', () => {
  it('names why money moved', () => {
    expect(reasonLabel('rent')).toBe('RENT');
    expect(reasonLabel('salary')).toBe('SALARY');
    expect(reasonLabel('tax')).toBe('TAX');
    expect(reasonLabel('traffic')).toBe('FINE');
    expect(reasonLabel('card')).toBe('CARD');
    expect(reasonLabel('event')).toBe('EVENT');
    expect(reasonLabel('nope')).toBe('');
    expect(reasonLabel(undefined)).toBe('');
  });
  it('signs with a real minus and Indian grouping', () => {
    expect(signedAmount(34000, 1)).toBe('+₹34,000');
    expect(signedAmount(-34000, -1)).toBe(`${MINUS}₹34,000`);
    expect(signedAmount(150000, 1)).toBe('+₹1,50,000');
    expect(signedAmount(0, 1)).toBe('+₹0');
  });
});

describe('coin tiers', () => {
  it('scales the count with the amount and keeps it between 1 and 8', () => {
    expect(coinCount(0)).toBe(0);
    expect(coinCount(5000)).toBe(1);
    expect(coinCount(20000)).toBe(2);
    expect(coinCount(10000000)).toBe(8);
    expect(coinCount(500000)).toBeGreaterThan(coinCount(60000));
  });
  it('tiers: small change < normal < big < huge, the lead coin grows with it', () => {
    expect(coinTier(5000).tier).toBe(0);
    expect(coinTier(60000).tier).toBe(1);
    expect(coinTier(200000).tier).toBe(2);
    expect(coinTier(900000).tier).toBe(3);
    expect(coinTier(900000).scale).toBeGreaterThan(coinTier(5000).scale);
  });
  it('the lead coin spins the most', () => {
    expect(spinTurns(0, 4)).toBeGreaterThan(spinTurns(3, 4));
    expect(spinTurns(0, 1)).toBeGreaterThan(0);
  });
});

describe('flightPlan', () => {
  it('player to player: a loss on the payer, a gain on the payee, flagging what is mine', () => {
    const p = flightPlan({ from: 'a', to: 'me', amount: 34000, reason: 'rent' }, 'me');
    expect(p.label).toBe('RENT');
    expect(p.legs).toEqual([{ who: 'a', sign: -1, when: 'start', mine: false }, { who: 'me', sign: 1, when: 'end', mine: true }]);
    expect(p.involvesMe).toBe(true);
  });
  it('bank flights show only the player side', () => {
    expect(flightPlan({ from: 'bank', to: 'me', amount: 200000, reason: 'salary' }, 'me').legs).toEqual([{ who: 'me', sign: 1, when: 'end', mine: true }]);
    expect(flightPlan({ from: 'a', to: 'bank', amount: 70000, reason: 'tax' }, 'me').legs).toEqual([{ who: 'a', sign: -1, when: 'start', mine: false }]);
  });
  it('is safe for nothing', () => {
    expect(flightPlan(null, 'me').legs).toEqual([]);
  });
});

describe('tileEffectsFor', () => {
  const ctx = { colorOf: (id) => ({ a: '#f00', b: '#0f0' }[id] || null), owners: [] };
  const ev = (e) => ({ ev: e });
  it('a bought district sends an owner-colour shockwave', () => {
    expect(tileEffectsFor(ev({ type: 'own', tile: 3, owner: 'a', reason: 'buy' }), ctx)).toEqual([{ kind: 'buy', tile: 3, color: '#f00', prio: 2 }]);
  });
  it('an auction win stamps SOLD, a snatch stamps too; a lost auction does nothing', () => {
    expect(tileEffectsFor(ev({ type: 'auction_end', tile: 12, winner: 'b', amount: 1, reason: 'bazaar' }), ctx)[0]).toMatchObject({ kind: 'sold', tile: 12, color: '#0f0' });
    expect(tileEffectsFor(ev({ type: 'auction_end', tile: 12, winner: 'b', reason: 'snatch' }), ctx)[0].kind).toBe('snatch');
    expect(tileEffectsFor(ev({ type: 'snatch_end', tile: 12, outcome: 'snatched', winner: 'a' }), ctx)[0].kind).toBe('snatch');
    expect(tileEffectsFor(ev({ type: 'auction_end', tile: 12, winner: null }), ctx)).toEqual([]);
    expect(tileEffectsFor(ev({ type: 'snatch_end', tile: 12, outcome: 'none' }), ctx)).toEqual([]);
  });
  it('upgrades sparkle (top level flagged), sells do not', () => {
    expect(tileEffectsFor(ev({ type: 'level', tile: 1, level: 2, reason: 'upgrade' }), { ...ctx, owners: [null, 'a'] })[0]).toMatchObject({ kind: 'upgrade', top: true, color: '#f00' });
    expect(tileEffectsFor(ev({ type: 'level', tile: 1, level: 1, reason: 'upgrade' }), ctx)[0].top).toBe(false);
    expect(tileEffectsFor(ev({ type: 'level', tile: 1, level: 0, reason: 'sell' }), ctx)).toEqual([]);
  });
  it('mortgage locks, unmortgage unlocks', () => {
    expect(tileEffectsFor(ev({ type: 'mortgage', tile: 3, player: 'a' }), ctx)[0].kind).toBe('lock');
    expect(tileEffectsFor(ev({ type: 'unmortgage', tile: 3, player: 'a' }), ctx)[0].kind).toBe('unlock');
  });
  it('a completed set sweeps every tile of the collection, at the top priority', () => {
    const group = Object.keys(GROUP_TILES)[0];
    const [fx] = tileEffectsFor(ev({ type: 'set_complete', group, player: 'a' }), ctx);
    expect(fx).toMatchObject({ kind: 'set', color: '#f00', prio: 3 });
    expect(fx.tiles).toEqual(GROUP_TILES[group].slice(0, 6));
    expect(tileEffectsFor(ev({ type: 'set_complete', group: 'zzz', player: 'a' }), ctx)).toEqual([]);
  });
  it('ignores entries without an engine event', () => {
    expect(tileEffectsFor({ text: 'x' }, ctx)).toEqual([]);
    expect(tileEffectsFor(null, ctx)).toEqual([]);
    expect(tileEffectsFor(ev({ type: 'dice', values: [3] }), ctx)).toEqual([]);
  });
  it('rent earns a toll sweep on the flight tile only', () => {
    expect(tollTile({ reason: 'rent', tile: 11 })).toBe(11);
    expect(tollTile({ reason: 'tax', tile: 27 })).toBeNull();
    expect(tollTile({ reason: 'rent', tile: null })).toBeNull();
    expect(tollTile({ reason: 'rent', tile: 999 })).toBeNull();
  });
});

describe('freshEntries', () => {
  const L = (...ids) => ids.map((id) => ({ id }));
  it('the first look takes a baseline and replays nothing', () => {
    expect(freshEntries(L(1, 2, 3), null)).toEqual({ fresh: [], newest: 3 });
    expect(freshEntries([], null)).toEqual({ fresh: [], newest: null });
  });
  it('returns what is newer than the baseline, oldest first', () => {
    expect(freshEntries(L(1, 2, 3, 4), 2)).toEqual({ fresh: L(3, 4), newest: 4 });
    expect(freshEntries(L(1, 2), 2)).toEqual({ fresh: [], newest: 2 });
  });
  it('skips merged heads-up notes with string ids and never replays history because of them', () => {
    const log = [{ id: 1 }, { id: 'n1' }, { id: 2 }, { id: 'n2' }];
    expect(freshEntries(log, 1)).toEqual({ fresh: [{ id: 2 }], newest: 2 });
    expect(freshEntries(log, 2).fresh).toEqual([]);
  });
});

describe('amountSpot', () => {
  it('rises from an avatar with room above, drifts down for one at the top of the screen', () => {
    expect(amountSpot({ top: 400, height: 40 }).dir).toBe(-1);
    expect(amountSpot({ top: 10, height: 40 }).dir).toBe(1);
    expect(amountSpot(null).dir).toBe(1);
  });
  it('stacks further amounts away from the avatar', () => {
    const a = amountSpot({ top: 400, height: 40 }, 0).y;
    const b = amountSpot({ top: 400, height: 40 }, 2).y;
    expect(b).toBeLessThan(a);
    const c = amountSpot({ top: 10, height: 40 }, 0).y;
    expect(amountSpot({ top: 10, height: 40 }, 2).y).toBeGreaterThan(c);
  });
});

describe('createGovernor', () => {
  it('caps what is alive at once and frees a slot on done', () => {
    const g = createGovernor({ maxLive: 2, burstMs: 0 });
    const a = g.admit({ now: 0 });
    const b = g.admit({ now: 1 });
    expect(g.admit({ now: 2 })).toBeNull();
    a.done();
    a.done(); // twice is harmless
    expect(g.live()).toBe(1);
    expect(g.admit({ now: 3 })).not.toBeNull();
    b.done();
  });
  it('stays quiet during a burst (the presenter catching up) but lets a set-complete through', () => {
    const g = createGovernor({ maxLive: 9, burstMs: 600, burstMax: 3 });
    const tokens = [0, 10, 20].map((t) => g.admit({ now: t }));
    expect(tokens.every(Boolean)).toBe(true);
    expect(g.admit({ now: 30 })).toBeNull();
    expect(g.admit({ now: 40, prio: 3 })).not.toBeNull();
    expect(g.admit({ now: 700 })).not.toBeNull(); // the burst is over
  });
});

describe('fxDom helpers', () => {
  it('overlaps', () => {
    expect(overlaps({ left: 0, top: 0, width: 10, height: 10 }, { left: 5, top: 5, width: 10, height: 10 })).toBe(true);
    expect(overlaps({ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 0, width: 10, height: 10 })).toBe(false);
  });
  it('the pool hands a released node back, reset', () => {
    const made = [];
    const doc = { createElement: () => { const n = { className: '', style: {}, firstChild: null, removeAttribute() {}, remove() {}, getAnimations: () => [] }; made.push(n); return n; } };
    const pool = createPool(4);
    const a = pool.acquire('x', doc);
    pool.release(a);
    expect(pool.size()).toBe(1);
    expect(pool.acquire('x', doc)).toBe(a);
    expect(made.length).toBe(1);
    expect(pool.size()).toBe(0);
  });
  it('the follower runs only while something is registered', () => {
    const queue = [];
    const f = createFollower((fn) => { queue.push(fn); return queue.length; }, () => {});
    let n = 0;
    f.add(() => { n += 1; return n < 3; });
    while (queue.length) queue.shift()();
    expect(n).toBe(3);
    expect(f.size()).toBe(0);
  });
});
