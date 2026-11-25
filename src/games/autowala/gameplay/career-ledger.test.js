import { describe, expect, it } from 'vitest';
import { clearCredits, compactDay, createLedger, defaultHistory, netOf, normalizeHistory, noteDropoff, noteExpense, noteWallet, recordDay, starsOf, summarize } from './career-ledger.js';

describe('the day ledger', () => {
  it('counts income from wallet events by reason', () => {
    const l = createLedger();
    noteWallet(l, { delta: 120, reason: 'fare' });
    noteWallet(l, { delta: 20, reason: 'tip' });
    noteWallet(l, { delta: 300, reason: 'quest' });
    noteWallet(l, { delta: 50, reason: 'refund' });
    expect(l).toMatchObject({ fares: 120, tips: 20, bonus: 300 });
    expect(netOf(l)).toBe(440);
  });
  it('counts expenses by kind, chai separately, and unknown kinds as other', () => {
    const l = createLedger();
    noteExpense(l, { kind: 'repair', amount: 200 });
    noteExpense(l, { kind: 'other', amount: 15, note: 'chai' });
    noteExpense(l, { kind: 'banana', amount: 7 });
    noteExpense(l, { kind: 'rent', amount: -3 });
    expect(l.expenses).toMatchObject({ repair: 200, chai: 15, other: 7, rent: 0 });
  });
  it('does not count fuel twice when both a wallet event and an expense event arrive', () => {
    const l = createLedger();
    noteWallet(l, { delta: -60, reason: 'fuel' });
    noteExpense(l, { kind: 'cng', amount: 60 });
    expect(l.expenses.cng).toBe(60);
    clearCredits(l);
    noteExpense(l, { kind: 'cng', amount: 30 }); // a later one with no wallet event
    expect(l.expenses.cng).toBe(90);
  });
  it('counts a fine from the wallet and its challan expense once', () => {
    const l = createLedger();
    noteWallet(l, { delta: -200, reason: 'road rage fine' });
    noteExpense(l, { kind: 'challan', amount: 200 });
    expect(l.expenses.fine + l.expenses.challan).toBe(200);
  });
  it('keeps the down payment out of the running costs', () => {
    const l = createLedger();
    noteExpense(l, { kind: 'other', amount: 20000, note: 'down-payment' });
    expect(netOf(l)).toBe(0);
  });
  it('tracks rides, the best fare and the star average', () => {
    const l = createLedger();
    noteDropoff(l, { fare: 90, rating: 5 });
    noteDropoff(l, { fare: 140, rating: 4 });
    noteDropoff(l, { fare: 60 });
    expect(l.rides).toBe(3);
    expect(l.bestFare).toBe(140);
    expect(starsOf(l)).toBe(4.5);
  });
  it('summarises net profit', () => {
    const l = createLedger();
    noteWallet(l, { delta: 500, reason: 'fare' });
    noteExpense(l, { kind: 'rent', amount: 400 });
    noteExpense(l, { kind: 'cng', amount: 120 });
    const s = summarize(l, { day: 2 });
    expect(s).toMatchObject({ day: 2, earned: 500, expenseTotal: 520, net: -20 });
  });
});

describe('history', () => {
  const day = (net, rides = 3, i = 1) => ({ lifeDay: i, earned: net + 100, expenseTotal: 100, net, rides, bestFare: 80, stars: 4.26 });
  it('keeps a week and the best day', () => {
    let h = defaultHistory();
    let nb;
    for (let i = 1; i <= 9; i++) {
      const r = recordDay(h, day(i * 10, 3, i));
      h = r.history;
      nb = r.newBest;
    }
    expect(h.days).toHaveLength(7);
    expect(h.days[0].day).toBe(3);
    expect(h.best.net).toBe(90);
    expect(nb).toBe(true);
    expect(recordDay(h, day(20)).newBest).toBe(false);
  });
  it('does not make a day with no rides the best', () => {
    expect(recordDay(defaultHistory(), day(0, 0)).newBest).toBe(false);
    expect(recordDay(defaultHistory(), day(0, 0)).history.best).toBe(null);
  });
  it('rounds and survives junk', () => {
    expect(compactDay(day(10.6)).stars).toBe(4.3);
    expect(normalizeHistory('x')).toEqual(defaultHistory());
    expect(normalizeHistory({ days: [null, { net: 'a' }, 4], best: 7 }).days).toHaveLength(1);
  });
});
