import { describe, expect, it } from 'vitest';
import { createEconomy } from './economy.js';
import { defaultProfile } from './profile.js';

function make(wallet = 600) {
  const data = { ...defaultProfile(), wallet };
  const events = [];
  const ctx = { profile: { data, save() {} }, emit: (type, d) => events.push({ type, ...d }) };
  return { eco: createEconomy(ctx), data, events };
}

describe('economy.add / spend', () => {
  it('adds whole rupees, announces them and counts the sitting', () => {
    const { eco, data, events } = make(100);
    eco.add(120.4, 'fare', 'fare');
    eco.add(30, 'tip', 'tip');
    expect(eco.wallet).toBe(250);
    expect(data.totalEarned).toBe(150);
    expect(eco.session).toMatchObject({ earned: 150, fares: 120, tips: 30 });
    expect(events.filter((e) => e.type === 'wallet')).toHaveLength(2);
  });

  it('ignores zero, negative and NaN amounts', () => {
    const { eco } = make(100);
    for (const bad of [0, -5, NaN, Infinity * -1, undefined, null, 'x']) eco.add(bad);
    expect(eco.wallet).toBe(100);
    expect(eco.session.earned).toBe(0);
  });

  it('refuses to spend more than the wallet and never goes below zero', () => {
    const { eco, data } = make(50);
    expect(eco.spend(51)).toBe(false);
    expect(eco.wallet).toBe(50);
    expect(eco.spend(-1)).toBe(false);
    expect(eco.spend(NaN)).toBe(false);
    expect(eco.spend(50)).toBe(true);
    expect(data.wallet).toBe(0);
    expect(eco.spend(0)).toBe(true);
  });

  it('refunds are not income', () => {
    const { eco, data } = make(100);
    eco.add(40, 'refund', 'refund');
    expect(eco.wallet).toBe(140);
    expect(data.totalEarned).toBe(0);
    expect(eco.session.earned).toBe(0);
  });
});

describe('"best fare" is the best FARE', () => {
  it('a tip or a quest bonus does not raise it', () => {
    const { eco, data } = make();
    eco.add(80, 'fare', 'fare');
    eco.add(900, 'quest:biryani', 'bonus');
    eco.add(300, 'tip', 'tip');
    expect(data.bestFare).toBe(80);
    eco.add(95, 'fare', 'fare');
    expect(data.bestFare).toBe(95);
  });
});

describe('workshop spend is tracked on its own', () => {
  it('only purchases made in the workshop count, not fuel, rent or fines', () => {
    const { eco } = make(2000);
    eco.spend(300, 'workshop');
    eco.spend(60, 'fuel');
    eco.spend(200, 'rent');
    eco.spend(100, 'workshop');
    expect(eco.session.spent).toBe(660);
    expect(eco.session.workshop).toBe(400);
  });
});
