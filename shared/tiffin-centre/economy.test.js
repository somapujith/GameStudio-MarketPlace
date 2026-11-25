// Tiffin Centre economy (docs section 3b): revenue, tips, cost, waste and profit; stars and the co-op rank come from PROFIT.
import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, result, starTargets, starsFor, standingsOf, LEVELS, DISH_IDS, INGREDIENTS, GAS, EAT_TICKS, PACE, coopScale,
  profitOf, dishCost, foodCostFrac, chooseAutoAction, actionCost, MAX_LEVEL,
} from './index.js';
import { book, bonus, carryOver, earn, spend, summary, wasteOnly, CARRY_SHARE } from './economy.js';

function ap(s, action) {
  const r = applyAction(s, action);
  if (r.error) throw new Error(`${action.type}: ${r.error}`);
  return r;
}
function tk(s, n = 1) {
  for (let i = 0; i < n; i++) s = ap(s, { type: 'tick' }).state;
  return s;
}
const game = (level, n = 1, seed = 1, pace = 'normal') => createGame({ players: Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'P' + (i + 1) })), settings: { level, pace }, seed });
const patch = (s, p) => ({ ...s, ...p });

describe('the books', () => {
  it('dish costs are quarter-exact sums of the portions; food cost 25-40% of the price on average', () => {
    expect(dishCost('dosa')).toBe(5 + 0.5 * 4 + 0.5 * 4 + 0.25 * 10);
    expect(dishCost('irani_chai')).toBe(INGREDIENTS.tea_decoction_milk.cost);
    expect(dishCost('nope')).toBe(0);
    expect(foodCostFrac('nope')).toBe(0);
    const avg = DISH_IDS.reduce((n, d) => n + foodCostFrac(d), 0) / DISH_IDS.length;
    expect(avg).toBeGreaterThan(0.25);
    expect(avg).toBeLessThan(0.4);
  });

  it('profit = money - cost: spend, earn, bonus keep money, cost, waste and profit in step', () => {
    const s = { money: 0, tips: 0, cost: 0, waste: 0, revenue: 0, profit: 0 };
    spend(s, 40);
    expect(s).toMatchObject({ cost: 40, profit: -40 });
    earn(s, 100, 12);
    expect(s).toMatchObject({ revenue: 100, tips: 12, money: 112, profit: 72 });
    bonus(s, 60);
    expect(s).toMatchObject({ tips: 72, money: 172, revenue: 100, profit: 132 });
    spend(s, 10, true);
    expect(s).toMatchObject({ cost: 50, waste: 10, profit: 122 });
    wasteOnly(s, 7);
    expect(s).toMatchObject({ cost: 50, waste: 17 });
    wasteOnly(s, 1000);
    expect(s.waste).toBeLessThanOrEqual(s.cost);
    for (const bad of [0, -5, NaN, undefined, null, '5']) {
      const before = JSON.stringify(s);
      spend(s, bad);
      wasteOnly(s, bad);
      expect(JSON.stringify(s)).toBe(before);
    }
    expect(profitOf({ money: 100, cost: 30 })).toBe(70);
    expect(profitOf({ money: 100 })).toBe(100);
    expect(profitOf({ money: 100, cost: NaN })).toBe(100);
    book(s);
    expect(s.profit).toBe(profitOf(s));
  });

  it('carry-over: half the value of paid-for stock left on the shelf comes back at the end, once', () => {
    const s0 = game(3);
    let s = patch(s0, { money: 500, cost: 200, pre: 60, stock: { ...s0.stock, coconut_chutney: 20 } });
    carryOver(s);
    expect(s.carry).toBe(30); // pre 60 is covered by stock worth more than that: half back
    expect(s.cost).toBe(170);
    carryOver(s);
    expect(s.cost).toBe(170); // only once
    const none = patch(s0, { cost: 100, pre: 0 });
    carryOver(none);
    expect(none.cost).toBe(100);
    expect(CARRY_SHARE).toBe(0.5);
    const tut = game(0);
    carryOver(tut);
    expect(tut.carry).toBeUndefined();
  });

  it('summary rounds for display', () => {
    expect(summary({ money: 1000, tips: 80.4, revenue: 920.4, cost: 333.4, waste: 41.6, fines: 12 })).toEqual({
      revenue: 920, tips: 80, money: 1000, cost: 333, waste: 42, fines: 12, carry: 0, profit: 667,
    });
  });
});

describe('a real shift books money and costs', () => {
  function playBot(level, n, seed, pace = 'normal') {
    const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1) }));
    let s = createGame({ players, settings: { level, pace }, seed });
    const freeAt = Object.fromEntries(players.map((p) => [p.id, 0]));
    while (s.status === 'playing') {
      for (const p of players) {
        if (freeAt[p.id] > s.tick) continue;
        const a = chooseAutoAction(s, p.id);
        if (!a) continue;
        const c = actionCost(s, p.id, a);
        s = ap(s, a).state;
        if (c.to) s = applyAction(s, { type: 'move', playerId: p.id, to: c.to }).state;
        freeAt[p.id] = s.tick + c.ticks;
      }
      if (s.status === 'playing') s = ap(s, { type: 'tick' }).state;
    }
    return s;
  }

  it('revenue + tips = money; profit = money - cost; waste is part of the cost; every figure is sane', () => {
    for (const [level, n] of [[1, 1], [4, 2], [9, 2]]) {
      const s = playBot(level, n, 3);
      expect(s.revenue + s.tips).toBe(s.money);
      expect(s.money).toBeGreaterThan(0);
      expect(s.cost).toBeGreaterThan(0);
      expect(s.waste).toBeGreaterThanOrEqual(0);
      expect(s.waste).toBeLessThanOrEqual(s.cost);
      expect(s.profit).toBeCloseTo(s.money - s.cost, 6);
      // a healthy stall: ingredients and gas cost well under what the customers paid
      expect(s.cost).toBeLessThan(s.money * 0.7);
      expect(Object.values(s.players).reduce((a, p) => a + p.earned, 0)).toBeLessThanOrEqual(s.money);
    }
  });

  it('result(): profit, cost, waste, bestCombo, served, lost, unpaid and team stats, and the old fields', () => {
    const s = playBot(4, 2, 2);
    const r = result(s);
    expect(r).toMatchObject({ reason: 'cleared', level: 4, money: s.money, stars: s.stars });
    expect(r.profit).toBe(s.money - Math.round(s.cost));
    expect(r.cost).toBe(Math.round(s.cost));
    expect(r.waste).toBe(Math.round(s.waste));
    expect(r.revenue + r.tips).toBeGreaterThanOrEqual(s.money - 1);
    expect(r.bestCombo).toBe(s.bestCombo);
    expect(r.bestCombo).toBeGreaterThan(0);
    expect(r.served).toBe(s.served);
    expect(r.lost).toBe(s.lost);
    expect(r.unpaid).toBe(s.unpaid);
    expect(r.stats).toMatchObject({ served: s.served, lost: s.lost, unpaid: s.unpaid, bestCombo: s.bestCombo, tips: r.tips, profit: r.profit, cost: r.cost, waste: r.waste });
    expect(r.team).toEqual(r.stats);
    expect(r.stats.prepped).toBe(Object.values(s.players).reduce((n, p) => n + (p.ops ? p.ops[0] : 0), 0));
    expect(r.standings).toHaveLength(2);
    for (const row of r.standings) {
      expect(row.stats).toMatchObject({ served: expect.any(Number), collected: expect.any(Number), earned: expect.any(Number), tips: expect.any(Number), prepped: expect.any(Number), tended: expect.any(Number) });
    }
    expect(r.winnerId).toBe(r.standings[0].id);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('stars and the rank come from PROFIT, not from cash in hand', () => {
    const t = starTargets(4, 'normal', 1);
    const end = (money, cost) => {
      let s = game(4);
      s = patch(s, { tick: s.shiftTicks - 1, money, cost, schedule: [], genAt: null, nextArrival: null });
      return ap(s, { type: 'tick' }).state;
    };
    expect(end(t[0] + 500, 500).stars).toBe(1);
    expect(end(t[0] + 499, 500).stars).toBe(0);
    expect(end(t[2] + 100, 100).stars).toBe(3);
    expect(end(t[2] + 99, 100).stars).toBe(2);
    expect(end(t[0] + 300, 300).profit).toBe(t[0]);
    const poor = end(t[2] + 1000, t[2] + 1000);
    expect(poor.stars).toBe(0);
    expect(result(poor)).toMatchObject({ winnerId: null, reason: 'closed' });
    // the same shape through the helpers
    expect(starsFor(4, 'normal', 1, t[1])).toBe(2);
    expect(starsFor(4, 'normal', 1, -50)).toBe(0);
    expect(starsFor(4, 'rush', 1, t[0])).toBe(0);
    expect(starTargets(4, 'rush', 2)).toEqual(LEVELS[4].stars.map((n) => Math.round(n * PACE.rush.stars * coopScale(2))));
  });

  it('doing nothing earns nothing and spends nothing: 0 stars on every level', () => {
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      let s = game(lv, 2);
      while (s.status === 'playing') s = ap(s, { type: 'tick' }).state;
      expect(s.money).toBe(0);
      expect(s.stars).toBe(0);
      expect(s.profit).toBeLessThanOrEqual(0);
      expect(result(s)).toMatchObject({ winnerId: null, stars: 0 });
    }
  });

  it('the tutorial shift keeps costing nothing and always earns its stars', () => {
    let s = game(0);
    s = ap(s, { type: 'spawn', customer: { order: ['dosa'] } }).state;
    s = ap(s, { type: 'cook', playerId: 'p1', station: 'tawa1', slot: 0, dish: 'dosa' }).state;
    s = tk(s, 5);
    s = ap(s, { type: 'take', playerId: 'p1', station: 'tawa1', slot: 0 }).state;
    s = ap(s, { type: 'serve', playerId: 'p1', customer: 1, hand: 0 }).state;
    s = tk(s, EAT_TICKS);
    s = ap(s, { type: 'collect', playerId: 'p1', customer: 1 }).state;
    expect(s).toMatchObject({ cost: 0, waste: 0, revenue: 40, money: 46, profit: 46 });
    const r = result(s);
    expect(r).toMatchObject({ reason: 'tutorial', stars: 3, cost: 0, profit: 46, revenue: 40, tips: 6 });
  });

  it('burnt and discarded dishes are waste (and part of the cost)', () => {
    let s = patch(game(1), { schedule: [], genAt: null, nextArrival: null });
    s = ap(s, { type: 'cook', playerId: 'p1', station: 'tawa1', slot: 0, dish: 'dosa' }).state;
    s = ap(s, { type: 'cook', playerId: 'p1', station: 'tawa1', slot: 1, dish: 'dosa' }).state;
    s = tk(s, 5);
    s = ap(s, { type: 'take', playerId: 'p1', station: 'tawa1', slot: 0 }).state;
    s = ap(s, { type: 'discard', playerId: 'p1', hand: 0 }).state;
    expect(s.waste).toBe(dishCost('dosa'));
    s = tk(s, 7); // the other burns
    expect(s.stations.tawa1.slots[1].st).toBe('burnt');
    expect(s.waste).toBe(2 * dishCost('dosa'));
    expect(s.waste).toBeLessThanOrEqual(s.cost);
  });

  it('gas swaps are a cost, not waste', () => {
    let s = patch(game(3), { gas: { u: 100, sw: 0 }, schedule: [], genAt: null, nextArrival: null });
    s = ap(s, { type: 'swapGas', playerId: 'p1' }).state;
    expect(s.cost).toBe(GAS.swapCost);
    expect(s.waste).toBe(0);
  });

  it('standings still rank by what each player collected; all share rank 1 when the shift earned a star', () => {
    const players = { a: { id: 'a', earned: 300, served: 1, collected: 1, tips: 5 }, b: { id: 'b', earned: 900, served: 2, collected: 3, tips: 9 } };
    const st = standingsOf(players, ['a', 'b'], 2);
    expect(st.map((r) => [r.id, r.rank, r.score])).toEqual([['b', 1, 900], ['a', 1, 300]]);
    expect(st[0].stats).toMatchObject({ served: 2, collected: 3, earned: 900, tips: 9, prepped: 0, tended: 0, gasSwaps: 0, bought: 0 });
    expect(standingsOf(players, ['a', 'b'], 0).map((r) => r.rank)).toEqual([2, 2]);
  });
});
