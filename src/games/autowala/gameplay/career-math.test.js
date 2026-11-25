import { describe, expect, it } from 'vitest';
import {
  CAREER, addSavings, canBuyAuto, capDebt, createImpactGate, crashDamage, damageLevel, damageSpeedMul, defaultLadder, demand, emiResult, emiTick,
  fatigueLevel, fatigueMul, fatigueStep, hitDamage, ladderView, normalizeLadder, partialRepair, peak, rattle, rentFor, repairCost, settle, startOwnership,
} from './career-math.js';

describe('rent', () => {
  it('is a full day from 16 hours up, never under a quarter', () => {
    expect(rentFor(24)).toBe(CAREER.rent);
    expect(rentFor(16)).toBe(CAREER.rent);
    expect(rentFor(8)).toBe(200);
    expect(rentFor(0.1)).toBe(100);
    expect(rentFor(NaN)).toBe(100);
  });
  it('settles from the wallet and leaves the rest owed', () => {
    expect(settle(400, 1000)).toEqual({ paid: 400, owed: 0 });
    expect(settle(400, 150)).toEqual({ paid: 150, owed: 250 });
    expect(settle(-5, 100)).toEqual({ paid: 0, owed: 0 });
  });
  it('caps the carried debt', () => {
    expect(capDebt(99999)).toBe(CAREER.rent * CAREER.debtCapDays);
    expect(capDebt(-4)).toBe(0);
  });
});

describe('damage', () => {
  it('ignores tiny bumps and caps big ones', () => {
    expect(crashDamage(0.02)).toBe(0);
    expect(crashDamage(0.5)).toBeCloseTo(0.035);
    expect(crashDamage(9)).toBe(0.14);
    expect(hitDamage(0)).toBe(0);
    expect(hitDamage(1)).toBeCloseTo(0.055);
  });
  it('counts a crash + traffic:hit of the same bump once', () => {
    const g = createImpactGate();
    expect(g.take(0.03, 10)).toBeCloseTo(0.03);
    expect(g.take(0.03, 10.1)).toBe(0); // same bump, other event
    expect(g.take(0.05, 10.2)).toBeCloseTo(0.02); // only the excess
    expect(g.take(0.03, 11)).toBeCloseTo(0.03); // a new bump
  });
  it('slows the auto and rattles it only once damaged', () => {
    expect(damageSpeedMul(0)).toBe(1);
    expect(damageSpeedMul(1)).toBeCloseTo(1 - CAREER.damage.maxSpeedLoss);
    expect(damageSpeedMul(0.5)).toBeGreaterThan(damageSpeedMul(0.9));
    expect(rattle(0.2, 20)).toBe(0);
    expect(rattle(0.9, 20)).toBeGreaterThan(0.05);
    expect(rattle(0.9, 0)).toBe(0);
    expect(damageLevel(0.1)).toBe(0);
    expect(damageLevel(0.6)).toBe(2);
    expect(damageLevel(1)).toBe(3);
  });
  it('prices repairs by the point with a minimum job', () => {
    expect(repairCost(0)).toBe(0);
    expect(repairCost(0.004)).toBe(0);
    expect(repairCost(0.01)).toBe(50);
    expect(repairCost(0.5)).toBe(490);
    expect(repairCost(1)).toBe(940);
  });
  it('does a partial job for what the wallet buys', () => {
    expect(partialRepair(0.5, 5000)).toMatchObject({ cost: 490, repaired: 0.5 });
    expect(partialRepair(0.5, 40)).toMatchObject({ cost: 0, repaired: 0 });
    const p = partialRepair(0.5, 200);
    expect(p.cost).toBeLessThanOrEqual(200);
    expect(p.repaired).toBeCloseTo(Math.floor(160 / 9) / 100);
    expect(partialRepair(0, 500).cost).toBe(0);
  });
});

describe('fatigue', () => {
  it('grows faster while moving and stays in 0..1', () => {
    expect(fatigueStep(0, 60, true)).toBeCloseTo(0.12);
    expect(fatigueStep(0, 60, false)).toBeCloseTo(0.04);
    expect(fatigueStep(0.99, 600, true)).toBe(1);
  });
  it('costs a little grip only once tired', () => {
    expect(fatigueMul(0)).toBe(1);
    expect(fatigueMul(0.3)).toBe(1);
    expect(fatigueMul(1)).toBeCloseTo(1 - CAREER.fatigue.maxGripLoss);
    expect(fatigueMul(0.7)).toBeGreaterThan(fatigueMul(1));
    expect(fatigueLevel(0.1)).toBe(0);
    expect(fatigueLevel(0.75)).toBe(2);
    expect(fatigueLevel(1)).toBe(3);
  });
});

describe('demand curve', () => {
  it('peaks at the office rushes and sags at night', () => {
    expect(demand(9)).toBeGreaterThan(1.4);
    expect(demand(18.5)).toBeGreaterThan(1.6);
    expect(demand(12.5)).toBeGreaterThan(1.1); // lunch
    expect(demand(3)).toBeLessThan(0.3);
    expect(demand(15.5)).toBeLessThan(1);
  });
  it('wraps and tolerates garbage', () => {
    expect(demand(24 + 9)).toBeCloseTo(demand(9));
    expect(demand(-15)).toBeCloseTo(demand(9));
    expect(Number.isFinite(demand(NaN))).toBe(true);
  });
  it('labels the rushes', () => {
    expect(peak(9).label).toBe('Office rush');
    expect(peak(9).peak).toBe(true);
    expect(peak(18).label).toBe('Evening rush');
    expect(peak(12.6).label).toBe('Lunch hour');
    expect(peak(3).level).toBe(0);
    expect(peak(3).peak).toBe(false);
    expect(peak(15).peak).toBe(false);
  });
});

describe('the ladder to your own auto', () => {
  const rich = { ...defaultLadder(), savings: CAREER.ladder.downPayment };
  it('needs both the savings and the cash', () => {
    expect(canBuyAuto(defaultLadder(), 99999).ok).toBe(false);
    expect(canBuyAuto(rich, 100).ok).toBe(false);
    expect(canBuyAuto(rich, 99999).ok).toBe(true);
    expect(canBuyAuto(startOwnership(rich), 99999).ok).toBe(false);
  });
  it('banks the net profit but never goes below zero', () => {
    expect(addSavings(defaultLadder(), 500).savings).toBe(500);
    expect(addSavings(addSavings(defaultLadder(), 500), -9000).savings).toBe(0);
  });
  it('counts days down to each instalment', () => {
    let l = startOwnership(rich);
    for (let i = 1; i < CAREER.ladder.monthDays; i++) {
      const t = emiTick(l);
      expect(t.emiDue).toBe(0);
      l = t.ladder;
    }
    const t = emiTick(l);
    expect(t.emiDue).toBe(CAREER.ladder.emi);
    expect(t.ladder.daysToEmi).toBe(CAREER.ladder.monthDays);
  });
  it('clears the loan after the last instalment', () => {
    const l = { ...startOwnership(rich), emiLeft: 1 };
    const r = emiResult(l, 1250, 1250);
    expect(r.cleared).toBe(true);
    expect(r.ladder.emiLeft).toBe(0);
    expect(ladderView(r.ladder, 0).cleared).toBe(true);
    expect(emiTick(r.ladder).emiDue).toBe(0);
  });
  it('adds a late fee, carries the arrears, then repossesses after three misses', () => {
    let l = startOwnership(rich);
    let r = emiResult(l, 1250, 0);
    expect(r.ladder.missed).toBe(1);
    expect(r.ladder.arrears).toBe(1250 + CAREER.ladder.lateFee);
    l = { ...r.ladder, daysToEmi: 1 };
    const t = emiTick(l);
    expect(t.emiDue).toBe(1250 + 1250 + CAREER.ladder.lateFee);
    r = emiResult(t.ladder, t.emiDue, 0);
    expect(r.ladder.missed).toBe(2);
    r = emiResult({ ...r.ladder }, 4000, 0);
    expect(r.repossessed).toBe(true);
    expect(r.ladder.owned).toBe(false);
    expect(r.ladder.savings).toBe(Math.floor(rich.savings / 2));
    expect(r.ladder.repossessed).toBe(1);
  });
  it('a late payment also clears the missed instalments', () => {
    const l = { ...startOwnership(rich), missed: 1, arrears: 1350, emiLeft: 10 };
    const r = emiResult(l, 2600, 2600);
    expect(r.ladder.emiLeft).toBe(8);
    expect(r.ladder.missed).toBe(0);
  });
  it('reports progress', () => {
    const v = ladderView({ ...defaultLadder(), savings: 5000 }, 100);
    expect(v.progress).toBeCloseTo(0.25);
    expect(v.canBuy).toBe(false);
    expect(v.emi).toBe(null);
    expect(ladderView(startOwnership(rich), 0).emi.left).toBe(CAREER.ladder.emiCount);
  });
  it('normalises hostile saves', () => {
    expect(normalizeLadder(null)).toEqual(defaultLadder());
    const n = normalizeLadder({ savings: -4, owned: 'yes', emiLeft: 5, lifeDays: 'x' });
    expect(n.savings).toBe(0);
    expect(n.owned).toBe(false);
    expect(n.emiLeft).toBe(0);
    expect(normalizeLadder({ owned: true, emiLeft: 3, savings: 10.7 })).toMatchObject({ owned: true, emiLeft: 3, savings: 10 });
  });
});
