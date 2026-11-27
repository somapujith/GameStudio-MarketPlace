import { describe, expect, it } from 'vitest';
import { expenseRows, incomeRows, liveView, sparkBars, verdict, widgetModel } from './hisaabModel.js';

describe('Hisaab rows', () => {
  it('lists income, tips only when earned', () => {
    expect(incomeRows({ fares: 300 }).map((r) => r.id)).toEqual(['fares']);
    expect(incomeRows({ fares: 300, tips: 20, bonus: 100 }).map((r) => r.id)).toEqual(['fares', 'tips', 'bonus']);
  });
  it('always shows CNG and rent, the rest only when they cost something', () => {
    const rows = expenseRows({ expenses: { cng: 0, rent: 400, repair: 0, fine: 100, challan: 50, chai: 30 } });
    expect(rows.map((r) => r.id)).toEqual(['cng', 'rent', 'fines', 'chai']);
    expect(rows.find((r) => r.id === 'fines').amount).toBe(150);
  });
  it('calls it an EMI on your own auto', () => {
    const rows = expenseRows({ expenses: { rent: 0 }, rent: { owned: true } });
    expect(rows.map((r) => r.id)).toEqual(['cng']);
    expect(expenseRows({ expenses: { rent: 1250 }, emi: { due: 1250 } }).find((r) => r.id === 'rent').en).toBe('Auto EMI');
  });
  it('survives junk', () => {
    expect(expenseRows(null).length).toBeGreaterThan(0);
    expect(incomeRows(undefined)[0].amount).toBe(0);
  });
});

describe('verdict and spark bars', () => {
  it('judges the day', () => {
    expect(verdict({ rides: 0, net: 0 }).id).toBe('idle');
    expect(verdict({ rides: 3, net: -50 }).id).toBe('loss');
    expect(verdict({ rides: 3, net: 100 }).id).toBe('thin');
    expect(verdict({ rides: 3, net: 400 }).id).toBe('fair');
    expect(verdict({ rides: 9, net: 900 }).id).toBe('great');
  });
  it('scales bars to the best day and marks losses', () => {
    const b = sparkBars([{ day: 1, net: 200 }, { day: 2, net: -100 }, { day: 3, net: 400 }]);
    expect(b.map((x) => x.h)).toEqual([0.5, 0.25, 1]);
    expect(b[1].loss).toBe(true);
    expect(sparkBars(null)).toEqual([]);
  });
});

describe('widgetModel', () => {
  it('is null without career data', () => {
    expect(widgetModel(null)).toBe(null);
  });
  it('reads tone and visibility from the numbers', () => {
    const w = widgetModel({ fatigue: 0.8, damage: 0.01, repairCost: 0, demand: { label: 'Office rush', mult: 1.6, level: 3, peak: true }, chai: { price: 15, cooldown: 0.2, canBuy: true }, rent: { due: 400 }, ladder: { progress: 0.256, canBuy: false } });
    expect(w.fatigue).toMatchObject({ pct: 80, tone: 'warn', show: true });
    expect(w.chai).toMatchObject({ urgent: true, cooldown: 1 });
    expect(w.damage.show).toBe(false);
    expect(w.demand.peak).toBe(true);
    expect(w.ladder.pct).toBe(26);
    expect(widgetModel({ fatigue: 0.1 }).fatigue.show).toBe(false);
    expect(widgetModel({ damage: 0.9 }).damage.tone).toBe('bad');
  });
});

describe('liveView (the open Hisaab must not show a stale bill or ladder)', () => {
  const h = { repairCost: 340, ladder: { owned: false, canBuy: true } };
  it('prefers the live career snapshot', () => {
    expect(liveView(h, { repairCost: 0, ladder: { owned: true } })).toEqual({ ladder: { owned: true }, repairCost: 0 });
  });
  it('falls back to the frozen record when there is no snapshot', () => {
    expect(liveView(h, null)).toEqual({ ladder: h.ladder, repairCost: 340 });
    expect(liveView(h, { repairCost: 'x' }).repairCost).toBe(340);
    expect(liveView(null, undefined)).toEqual({ ladder: null, repairCost: 0 });
  });
  it('never returns a negative or fractional bill', () => {
    expect(liveView(h, { repairCost: -5 }).repairCost).toBe(0);
    expect(liveView(h, { repairCost: 12.6 }).repairCost).toBe(13);
  });
});
