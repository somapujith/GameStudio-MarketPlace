// Tiffin Centre operations layer (docs section 3b): ingredient stock and freshness, prep jobs, LPG gas, heat and tending, the sold-out board,
// the market, customers' special requests. One behaviour per test; level 0 (the tutorial) must stay exactly as it was.
import { describe, it, expect, vi } from 'vitest';
import {
  createGame, applyAction, slotInfo, customerInfo, stockInfo, gasInfo, tendInfo, needs, chooseAutoAction, result,
  DISHES, DISH_IDS, INGREDIENTS, INGREDIENT_IDS, STOCK_CAP, GAS, HEAT, FERMENT, MARKET_MARKUP, EAT_TICKS, REQUEST, LEVELS, MAX_LEVEL,
  levelOps, menuFor, openingStock, levelItems, dishCost, foodCostFrac, LAYOUT, STATIONS, STATION_KINDS, STATION_IDS,
} from './index.js';
import { validTarget, standX } from './movement.js';

vi.setConfig({ testTimeout: 120000 }); // a few tests simulate whole shifts

const PL = [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Bala' }];

function ap(s, action) {
  const r = applyAction(s, action);
  if (r.error) throw new Error(`${action.type}: ${r.error}`);
  return r;
}
function tk(s, n = 1) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    const r = ap(s, { type: 'tick' });
    s = r.state;
    ev.push(...r.events);
  }
  return { s, ev };
}
const types = (ev) => ev.map((e) => e.type);
const game = (level, seed = 1, players = PL, pace = 'normal') => createGame({ players, settings: { level, pace }, seed });
/** A copy of the state with some fields replaced (states are plain JSON). */
const patch = (s, p) => ({ ...s, ...p });
const stockOf = (s, over) => ({ ...s.stock, ...over });
const cook = (s, who, station, slot, dish) => applyAction(s, { type: 'cook', playerId: who, station, slot, dish });
/** Nobody comes: take the crowd away so a test can look at the stall alone. */
const quiet = (s) => ({ ...s, schedule: [], genAt: null, nextArrival: null });

describe('level 0 (the tutorial) has none of the operations layer', () => {
  it('unlimited stock, no gas, no heat, no events, no prep counter', () => {
    const s = game(0);
    expect(s.cfg).toMatchObject({ tutorial: true, stock: false, gas: false, heat: false, market: false, events: [] });
    expect(s.stock).toEqual({});
    expect(s.gas).toBe(null);
    expect(s.stations.prep1).toBeUndefined();
    expect(s.cfg.stations).not.toContain('prep1');
    for (const st of Object.values(s.stations)) {
      expect(st.heat).toBeUndefined();
      expect(st.water).toBeUndefined();
    }
    let t = s;
    for (let i = 0; i < 40; i++) t = cook(t, 'a', 'tawa1', i % 3, 'masala_dosa').state === t ? t : t;
    expect(stockInfo(s)).toEqual([]);
    expect(gasInfo(s)).toBe(null);
    expect(tendInfo(s, 'tawa1')).toBe(null);
    expect(needs(s)).toEqual([]);
  });

  it('cooks as often as you like and the stations never pause', () => {
    let s = game(0);
    for (let round = 0; round < 6; round++) {
      s = ap(s, { type: 'cook', playerId: 'a', station: 'tawa1', slot: 0, dish: 'masala_dosa' }).state;
      s = tk(s, 7).s;
      expect(s.stations.tawa1.slots[0].st).toBe('ready');
      s = ap(s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 }).state;
      s = ap(s, { type: 'discard', playerId: 'a', hand: 0 }).state;
    }
    expect(s.cost).toBe(0);
    expect(s.waste).toBe(0);
    expect(s.profit).toBe(0);
  });

  it('every new action is refused in the training shift', () => {
    const s = game(0);
    for (const a of [
      { type: 'prep', station: 'prep1', slot: 0, item: 'oil' }, { type: 'collectPrep', station: 'prep1', slot: 0 },
      { type: 'tend', station: 'tawa1' }, { type: 'swapGas' }, { type: 'board', dish: 'dosa', on: false }, { type: 'buy', item: 'oil', n: 1 },
    ]) {
      const r = applyAction(s, { ...a, playerId: 'a' });
      expect(r.state).toBe(s);
      expect(r.error).toBeTruthy();
    }
    expect(validTarget('gas', s.cfg.stations, s.cfg.spots, s.cfg.gas)).toBe(false);
    expect(applyAction(s, { type: 'move', playerId: 'a', to: 'gas' }).error).toBe('Cannot go there');
  });
});

describe('the catalogue of ingredients', () => {
  it('every dish has `uses` of known ingredients, and food cost is 25-40% of its price', () => {
    for (const id of DISH_IDS) {
      const d = DISHES[id];
      expect(Object.keys(d.uses).length).toBeGreaterThan(0);
      for (const [item, q] of Object.entries(d.uses)) {
        expect(INGREDIENTS[item], `${id} uses ${item}`).toBeTruthy();
        expect(q).toBeGreaterThan(0);
        expect((q * 4) % 1, `${id}: ${item} in quarter portions`).toBe(0);
      }
      const f = foodCostFrac(id);
      expect(f, `${id} food cost ${dishCost(id)} of ${d.price}`).toBeGreaterThanOrEqual(0.2);
      expect(f, `${id} food cost`).toBeLessThanOrEqual(0.41);
    }
  });

  it('every ingredient can be prepared at the back counter, and a batch fits on the shelf', () => {
    expect(INGREDIENT_IDS).toEqual(expect.arrayContaining([
      'batter_dosa', 'batter_idly', 'batter_pesarattu', 'potato_masala', 'coconut_chutney', 'sambar', 'podi_ghee', 'poori_dough', 'vada_batter',
      'besan_batter', 'mirchi', 'tea_decoction_milk', 'coffee_decoction', 'biscuits', 'oil',
    ]));
    for (const id of INGREDIENT_IDS) {
      const i = INGREDIENTS[id];
      expect(i.cost).toBeGreaterThan(0);
      expect(i.prep.ticks).toBeGreaterThanOrEqual(3);
      expect(i.prep.ticks).toBeLessThanOrEqual(14);
      expect(i.prep.yield).toBeGreaterThan(0);
      expect(i.prep.yield * 2).toBeLessThanOrEqual(STOCK_CAP);
      expect([null, 'power', 'gas']).toContain(i.prep.needs);
      expect(DISH_IDS.some((d) => DISHES[d].uses[id]), `${id} is used by a dish`).toBe(true);
    }
    expect(INGREDIENTS.batter_dosa.prep.ticks).toBe(12);
    expect(INGREDIENTS.coconut_chutney.prep.ticks).toBe(6);
    expect(INGREDIENTS.sambar.prep.ticks).toBe(10);
    expect(INGREDIENTS.poori_dough.prep.ticks).toBe(6);
    expect(INGREDIENTS.potato_masala.prep.ticks).toBe(8);
  });

  it('opening stock: generous early, tighter later, within the shelf; a team gets more', () => {
    const total = (lv, n = 1) => {
      const level = LEVELS[lv];
      const o = openingStock(level, menuFor(level), levelOps(lv), n, 'normal');
      return Object.values(o).reduce((a, b) => a + b, 0) / Object.keys(o).length;
    };
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      const level = LEVELS[lv];
      const o = openingStock(level, menuFor(level), levelOps(lv), 4, 'rush');
      expect(Object.keys(o).sort()).toEqual(levelItems(menuFor(level)).sort());
      for (const q of Object.values(o)) {
        expect(q).toBeGreaterThanOrEqual(6);
        expect(q).toBeLessThanOrEqual(32);
      }
    }
    expect(total(12, 4)).toBeGreaterThan(total(12, 1));
    // cover (opening stock / expected demand) falls with the level
    expect(levelOps(1).stock).toBeGreaterThan(levelOps(3).stock);
    expect(levelOps(3).stock).toBeGreaterThan(levelOps(8).stock);
    expect(levelOps(8).stock).toBeGreaterThan(levelOps(12).stock);
  });

  it('level switches: nothing in levels 1-2 events, more later, the festival has them all', () => {
    expect(levelOps(1).events).toEqual([]);
    expect(levelOps(2).events).toEqual([]);
    expect(levelOps(1).gas).toBe(0);
    expect(levelOps(3).gas).toBeGreaterThan(0);
    expect(levelOps(12).events.sort()).toEqual(['cricket', 'delivery', 'festival', 'inspector', 'power', 'rain']);
    expect(levelOps(12).market).toBe(true);
    expect(levelOps(1).market).toBe(false);
    for (let lv = 1; lv <= MAX_LEVEL; lv++) expect(game(lv).cfg.events).toEqual(levelOps(lv).events);
  });
});

describe('stock: cooking uses ingredients', () => {
  it('a cook takes its ingredients out of the stock and charges the unpaid part at the unit cost', () => {
    const s = game(1);
    const before = { ...s.stock };
    const r = cook(s, 'a', 'tawa1', 0, 'masala_dosa');
    expect(r.error).toBeUndefined();
    const u = DISHES.masala_dosa.uses;
    for (const item of Object.keys(u)) expect(r.state.stock[item]).toBe(before[item] - u[item]);
    expect(r.state.cost).toBe(dishCost('masala_dosa'));
    expect(r.state.profit).toBe(-dishCost('masala_dosa'));
    expect(r.events).toContainEqual({ type: 'cook-start', station: 'tawa1', slot: 0, dish: 'masala_dosa', by: 'a' });
  });

  it('is refused with "Out of ..." when an ingredient is short, with no change and no event', () => {
    for (const [item, text] of [['batter_dosa', /Out of dosa batter/], ['coconut_chutney', /Out of coconut chutney/], ['oil', /Out of cooking oil/], ['potato_masala', /Out of potato masala/]]) {
      const s = patch(game(1), {});
      const low = patch(s, { stock: stockOf(s, { [item]: 0.2 }) });
      const r = cook(low, 'a', 'tawa1', 0, 'masala_dosa');
      expect(r.state).toBe(low);
      expect(r.events).toEqual([]);
      expect(r.error).toMatch(text);
    }
    // exactly enough is enough
    const s = game(1);
    const exact = patch(s, { stock: stockOf(s, { batter_dosa: 1, potato_masala: 1, coconut_chutney: 0.5, sambar: 0.5, oil: 0.25 }) });
    const r = cook(exact, 'a', 'tawa1', 0, 'masala_dosa');
    expect(r.error).toBeUndefined();
    expect(r.state.stock.batter_dosa).toBe(0);
    expect(r.state.stock.oil).toBe(0);
    expect(types(r.events)).toEqual(expect.arrayContaining(['cook-start', 'stock-out']));
  });

  it('stock-low fires once when an item falls to 3 portions, stock-out when it can no longer be used', () => {
    const s = game(1);
    let t = patch(s, { stock: stockOf(s, { batter_dosa: 5 }) });
    const seen = [];
    for (let i = 0; i < 5; i++) {
      const r = ap(t, { type: 'cook', playerId: 'a', station: i < 3 ? 'tawa1' : 'tawa1', slot: i % 3, dish: 'dosa' });
      t = r.state;
      seen.push(...r.events.filter((e) => /^stock-/.test(e.type) && e.item === 'batter_dosa'));
      if (i === 2) t = patch(t, { stations: { ...t.stations, tawa1: { ...t.stations.tawa1, slots: t.stations.tawa1.slots.map((sl) => ({ ...sl, st: 'empty', dish: null })) } } });
    }
    expect(seen.map((e) => e.type)).toEqual(['stock-low', 'stock-out']);
    expect(seen[0]).toMatchObject({ item: 'batter_dosa', n: 3 });
  });

  it('stockInfo lists portions, freshness of batter, what is being prepared', () => {
    let s = game(3);
    const info = stockInfo(s);
    expect(info.map((i) => i.item)).toEqual(levelItems(s.cfg.menu));
    const dosa = info.find((i) => i.item === 'batter_dosa');
    expect(dosa).toMatchObject({ item: 'batter_dosa', name: 'Dosa batter', n: s.stock.batter_dosa, fresh: s.fresh.batter_dosa, pending: 0, out: false, sour: false });
    expect(info.find((i) => i.item === 'oil').fresh).toBe(null);
    s = ap(s, { type: 'prep', playerId: 'a', station: 'prep1', slot: 0, item: 'batter_dosa' }).state;
    expect(stockInfo(s).find((i) => i.item === 'batter_dosa').pending).toBe(INGREDIENTS.batter_dosa.prep.yield);
    expect(stockInfo(null)).toEqual([]);
  });
});

describe('prep: the back counter', () => {
  const prep = (s, slot, item, who = 'a') => applyAction(s, { type: 'prep', playerId: who, station: 'prep1', slot, item });

  it('only levels that track stock have the counter: station kind "prep", id prep1, 2 job slots, behind the cook', () => {
    expect(STATION_KINDS.prep.slots).toBe(2);
    expect(STATIONS.prep1).toMatchObject({ kind: 'prep' });
    expect(STATIONS.prep1.z).toBeGreaterThan(LAYOUT.cookZ);
    expect(LAYOUT.prep.z).toBeGreaterThan(LAYOUT.cookZ);
    expect(STATION_IDS).not.toContain('prep1');
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      const s = game(lv);
      expect(s.cfg.stations).toContain('prep1');
      expect(s.stations.prep1.slots).toHaveLength(2);
    }
    expect(slotInfo(game(1), 'prep1', 0)).toMatchObject({ st: 'empty', progress: 0 });
  });

  it('start: pays the ingredients up front, runs N ticks, finishes as a visible "ready" job, collect adds the portions', () => {
    let s = quiet(game(3));
    const have = s.stock.batter_dosa;
    let r = prep(s, 0, 'batter_dosa');
    expect(r.error).toBeUndefined();
    const def = INGREDIENTS.batter_dosa;
    expect(r.events).toEqual([{ type: 'prep-start', station: 'prep1', slot: 0, item: 'batter_dosa', n: def.prep.yield, ticks: def.prep.ticks, by: 'a' }]);
    s = r.state;
    expect(s.cost).toBe(def.prep.yield * def.cost);
    expect(s.players.a.ops).toEqual([1, 0, 0, 0]);
    expect(slotInfo(s, 'prep1', 0)).toMatchObject({ st: 'cooking', item: 'batter_dosa', dish: null, progress: 0 });
    let t = tk(s, def.prep.ticks - 1);
    expect(types(t.ev)).not.toContain('prep-done');
    expect(slotInfo(t.s, 'prep1', 0).progress).toBeCloseTo((def.prep.ticks - 1) / def.prep.ticks, 6);
    t = tk(t.s, 1);
    expect(t.ev).toContainEqual({ type: 'prep-done', station: 'prep1', slot: 0, item: 'batter_dosa', n: def.prep.yield });
    expect(slotInfo(t.s, 'prep1', 0)).toMatchObject({ st: 'ready', progress: 1 });
    expect(t.s.stock.batter_dosa).toBe(have); // not on the shelf until somebody carries it over
    const c = ap(t.s, { type: 'collectPrep', playerId: 'b', station: 'prep1', slot: 0 });
    expect(c.events).toEqual([{ type: 'prep-collect', station: 'prep1', slot: 0, item: 'batter_dosa', n: def.prep.yield, by: 'b' }]);
    expect(c.state.stock.batter_dosa).toBe(have + def.prep.yield);
    expect(slotInfo(c.state, 'prep1', 0).st).toBe('empty');
    expect(c.state.cost).toBe(def.prep.yield * def.cost); // paid once
  });

  it('prepaid portions are used before new ones are paid for, so nothing is charged twice', () => {
    let s = quiet(game(3));
    s = ap(s, { type: 'prep', playerId: 'a', station: 'prep1', slot: 0, item: 'coconut_chutney' }).state;
    s = tk(s, INGREDIENTS.coconut_chutney.prep.ticks).s;
    s = ap(s, { type: 'collectPrep', playerId: 'a', station: 'prep1', slot: 0 }).state;
    const afterPrep = s.cost;
    const paidFor = s.pre;
    expect(paidFor).toBe(INGREDIENTS.coconut_chutney.prep.yield * INGREDIENTS.coconut_chutney.cost);
    // the prepaid shelf is used first: a dosa (Rs 11.5 of ingredients) is covered by it and charges nothing new
    const r = cook(s, 'a', 'tawa1', 0, 'dosa');
    expect(r.state.cost).toBe(afterPrep);
    expect(r.state.pre).toBe(paidFor - dishCost('dosa'));
    // once the prepaid value is used up, cooking is charged again
    const broke = cook(patch(s, { pre: 3 }), 'a', 'tawa1', 0, 'dosa');
    expect(broke.state.cost - afterPrep).toBeCloseTo(dishCost('dosa') - 3, 6);
    expect(broke.state.pre).toBe(0);
  });

  it('two jobs at a time; the same slot, bad items, items the level does not use and a full shelf are refused', () => {
    let s = quiet(game(3));
    s = prep(s, 0, 'sambar').state;
    s = prep(s, 1, 'oil').state;
    for (const [slot, item, text] of [[0, 'sambar', /busy/], [1, 'oil', /busy/]]) {
      const r = prep(s, slot, item);
      expect(r.state).toBe(s);
      expect(r.error).toMatch(text);
    }
    const t = quiet(game(3));
    const bad = [
      [0, 'pizza'], [0, '__proto__'], [0, 'constructor'], [0, 'toString'], [0, 7], [0, null], [0, undefined], [0, {}], [2, 'oil'], [-1, 'oil'], [0.5, 'oil'],
      [NaN, 'oil'], [1e30, 'oil'], ['0', 'oil'], [0, 'besan_batter'], // besan is not used by level 3's menu
    ];
    for (const [slot, item] of bad) {
      const r = prep(t, slot, item);
      expect(r.state, JSON.stringify([slot, item])).toBe(t);
      expect(r.error).toBeTruthy();
    }
    const full = patch(t, { stock: stockOf(t, { oil: STOCK_CAP - 3 }) });
    expect(prep(full, 0, 'oil').error).toMatch(/shelf is full/);
    for (const station of ['tawa1', 'chai1', 'nowhere', '__proto__', 5, undefined]) {
      expect(applyAction(t, { type: 'prep', playerId: 'a', station, slot: 0, item: 'oil' }).error).toBeTruthy();
    }
    expect(prep(game(0), 0, 'oil').error).toBeTruthy();
  });

  it('collectPrep: not ready, nothing there, hostile slots', () => {
    let s = quiet(game(3));
    const c = (st, slot, station = 'prep1') => applyAction(st, { type: 'collectPrep', playerId: 'a', station, slot });
    expect(c(s, 0).error).toBe('Nothing there');
    s = prep(s, 0, 'oil').state;
    expect(c(s, 0).error).toBe('Not ready yet');
    for (const slot of [2, -1, 0.5, NaN, '0', null, undefined, 1e30]) expect(c(s, slot).error).toBeTruthy();
    expect(c(s, 0, 'tawa1').error).toBeTruthy();
    expect(applyAction(s, { type: 'take', playerId: 'a', station: 'prep1', slot: 0 }).error).toMatch(/collectPrep/);
    expect(applyAction(s, { type: 'cook', playerId: 'a', station: 'prep1', slot: 0, dish: 'dosa' }).error).toBeTruthy();
  });

  it('a power cut stops the grinder (batter), a gas-out stops the pots (sambar); hand jobs carry on', () => {
    let s = quiet(game(5));
    s = prep(s, 0, 'batter_dosa').state;
    s = prep(s, 1, 'coconut_chutney').state;
    const cut = patch(s, { events: [{ id: 'power', until: s.tick + 100 }] });
    const t = tk(cut, INGREDIENTS.coconut_chutney.prep.ticks);
    expect(types(t.ev)).toContain('prep-done'); // the chutney stone needs no power
    expect(t.s.stations.prep1.slots[0].st).toBe('cooking');
    expect(t.s.stations.prep1.slots[0].readyAt).toBe(s.stations.prep1.slots[0].readyAt + INGREDIENTS.coconut_chutney.prep.ticks);
    // power back: it resumes where it left off
    const back = tk(patch(t.s, { events: [] }), 6);
    expect(back.s.stations.prep1.slots[0].st).toBe('cooking');
    expect(tk(back.s, 12).s.stations.prep1.slots[0].st).toBe('ready');

    let g = quiet(game(5));
    g = prep(g, 0, 'sambar').state;
    const dry = patch(g, { gas: { u: 0, sw: 0 } });
    const d = tk(dry, 20).s;
    expect(d.stations.prep1.slots[0].st).toBe('cooking');
  });
});

describe('LPG gas', () => {
  it('a cylinder: units, drain while stations cook, low warning at 20%, out at 0 and the burners go cold', () => {
    let s = quiet(game(3, 1, [{ id: 'a' }]));
    expect(gasInfo(s)).toMatchObject({ on: true, units: levelOps(3).gas, cap: GAS.cap, low: false, out: false, swapping: false });
    // idle burners burn nothing
    expect(tk(s, 10).s.gas.u).toBe(s.gas.u);
    s = cook(s, 'a', 'tawa1', 0, 'dosa').state;
    s = patch(s, { gas: { u: 230, sw: 0 } });
    // stay below 'low' only after enough ticks; collect events along the way
    const ev = [];
    for (let i = 0; i < 400 && s.gas.u > 0; i++) {
      const r = applyAction(s, { type: 'tick' });
      s = r.state;
      ev.push(...r.events);
      // keep a dish cooking so the burner stays lit
      if (!s.stations.tawa1.slots.some((sl) => sl.st === 'cooking')) {
        s = patch(s, { stations: { ...s.stations, tawa1: { ...s.stations.tawa1, slots: s.stations.tawa1.slots.map((sl, k) => (k === 0 ? { st: 'cooking', dish: 'dosa', t0: s.tick, readyAt: s.tick + 5, burnAt: s.tick + 12, by: 'a' } : sl)) } } });
      }
    }
    expect(types(ev)).toEqual(expect.arrayContaining(['gas-low', 'gas-out']));
    expect(ev.filter((e) => e.type === 'gas-low')).toHaveLength(1);
    expect(s.gas.u).toBe(0);
    expect(gasInfo(s)).toMatchObject({ on: false, out: true, frac: 0 });
  });

  it('with no gas nothing cooks: slots stop where they are, new cooks are refused', () => {
    let s = quiet(game(3));
    s = cook(s, 'a', 'tawa1', 0, 'dosa').state;
    s = tk(s, 2).s;
    const before = slotInfo(s, 'tawa1', 0);
    s = patch(s, { gas: { u: 0, sw: 0 } });
    const t = tk(s, 15).s;
    expect(slotInfo(t, 'tawa1', 0)).toMatchObject({ st: 'cooking', progress: before.progress });
    const r = cook(t, 'a', 'tawa1', 1, 'dosa');
    expect(r.error).toMatch(/No gas/);
    expect(r.state).toBe(t);
    // gas back: the dish carries on from where it stopped and is perfect when it comes out
    const back = tk(patch(t, { gas: { u: 500, sw: 0 } }), 3).s;
    expect(slotInfo(back, 'tawa1', 0).st).toBe('ready');
    expect(ap(back, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 }).events[0].q).toBe('perfect');
  });

  it('a ready dish does not burn while the burner is cold', () => {
    let s = quiet(game(3));
    s = cook(s, 'a', 'tawa1', 0, 'dosa').state;
    s = tk(s, 5).s;
    expect(slotInfo(s, 'tawa1', 0).st).toBe('ready');
    const t = tk(patch(s, { gas: { u: 0, sw: 0 } }), 30).s;
    expect(slotInfo(t, 'tawa1', 0)).toMatchObject({ st: 'ready', age: 0 });
  });

  it('swapGas: 6 ticks with the burners off, costs money, then a full cylinder', () => {
    let s = quiet(game(3));
    s = patch(s, { gas: { u: 120, sw: 0 } });
    expect(gasInfo(s).canSwap).toBe(true);
    const r = ap(s, { type: 'swapGas', playerId: 'b' });
    expect(r.events).toEqual([{ type: 'gas-swap', phase: 'start', ticks: GAS.swapTicks, cost: GAS.swapCost, by: 'b' }]);
    s = r.state;
    expect(s.cost).toBe(GAS.swapCost);
    expect(s.players.b.ops).toEqual([0, 0, 1, 0]);
    expect(gasInfo(s)).toMatchObject({ swapping: true, swapLeft: GAS.swapTicks, on: false });
    expect(applyAction(s, { type: 'swapGas', playerId: 'a' }).error).toMatch(/Already/);
    expect(cook(s, 'a', 'tawa1', 0, 'dosa').error).toMatch(/cylinder is being changed/);
    const t = tk(s, GAS.swapTicks - 1);
    expect(t.s.gas.sw).toBe(1);
    const done = tk(t.s, 1);
    expect(done.ev).toContainEqual({ type: 'gas-swap', phase: 'done', units: GAS.cap });
    expect(done.s.gas).toEqual({ u: GAS.cap, sw: 0 });
    // a heavy cylinder is not changed for fun
    expect(applyAction(done.s, { type: 'swapGas', playerId: 'a' }).error).toMatch(/heavy/);
    // no cylinder on this level
    expect(applyAction(game(1), { type: 'swapGas', playerId: 'a' }).error).toBeTruthy();
  });

  it("'gas' is a stand target on levels with a cylinder only", () => {
    expect(standX('gas')).toBeCloseTo(LAYOUT.gas.x + 0.4, 6);
    expect(game(3).cfg.gas).toBe(true);
    expect(applyAction(game(3), { type: 'move', playerId: 'a', to: 'gas' }).state.players.a.at).toBe('gas');
    expect(applyAction(game(1), { type: 'move', playerId: 'a', to: 'gas' }).error).toBe('Cannot go there');
    expect(validTarget('prep1', game(3).cfg.stations, 4, true)).toBe(true);
    expect(validTarget('prep1', game(0).cfg.stations, 4, true)).toBe(false);
  });
});

describe('heat, seasoning and tending', () => {
  const tawaPan = (s) => s.stations.tawa1;

  it('every cook chills the pan and adds gunk; an idle pan creeps hotter; the steamer boils its water away', () => {
    let s = quiet(game(3));
    expect(tawaPan(s)).toMatchObject({ heat: HEAT.start, gunk: 0, tendAt: 0 });
    expect(s.stations.steamer1.water).toBe(HEAT.waterStart);
    s = cook(s, 'a', 'tawa1', 0, 'dosa').state;
    expect(tawaPan(s).heat).toBe(HEAT.start - HEAT.pourCool.tawa);
    expect(tawaPan(s).gunk).toBe(HEAT.gunkPerCook);
    const idle = tk(quiet(game(3)), HEAT.idleEvery * 10).s;
    expect(tawaPan(idle).heat).toBe(HEAT.start + 10 * HEAT.idleRise);
    let t = cook(quiet(game(3)), 'a', 'steamer1', 0, 'idly').state;
    t = tk(t, 5).s;
    expect(t.stations.steamer1.water).toBe(HEAT.waterStart - 5 * HEAT.waterDrain);
  });

  it('tendInfo: need 0..1, band cold / ideal / hot / dry, whether it can be tended', () => {
    const s = game(3);
    expect(tendInfo(s, 'tawa1')).toMatchObject({ kind: 'heat', need: 0, band: 'ideal', value: HEAT.start, canTend: false, stuck: false });
    expect(tendInfo(s, 'steamer1')).toMatchObject({ kind: 'water', need: 0, band: 'ideal', value: HEAT.waterStart });
    expect(tendInfo(s, 'chai1')).toBe(null);
    expect(tendInfo(s, 'prep1')).toBe(null);
    expect(tendInfo(s, 'nope')).toBe(null);
    expect(tendInfo(s, '__proto__')).toBe(null);
    const cold = patch(s, { stations: { ...s.stations, tawa1: { ...s.stations.tawa1, heat: 20 } } });
    expect(tendInfo(cold, 'tawa1')).toMatchObject({ band: 'cold', need: 1, canTend: true });
    const hot = patch(s, { stations: { ...s.stations, tawa1: { ...s.stations.tawa1, heat: 90 } } });
    expect(tendInfo(hot, 'tawa1')).toMatchObject({ band: 'hot', need: 1 });
    const gunky = patch(s, { stations: { ...s.stations, tawa1: { ...s.stations.tawa1, gunk: 50 } } });
    expect(tendInfo(gunky, 'tawa1').need).toBeCloseTo(50 / HEAT.torn, 6);
    const dry = patch(s, { stations: { ...s.stations, steamer1: { ...s.stations.steamer1, water: 10 } } });
    expect(tendInfo(dry, 'steamer1')).toMatchObject({ band: 'dry', need: 1 });
    expect(tendInfo(game(1), 'tawa1')).toBe(null); // level 1 has no heat
    expect(tendInfo(game(0), 'tawa1')).toBe(null);
  });

  it('tend resets the pan to ideal and clears the gunk; refused while it is clean; counted per player', () => {
    let s = quiet(game(3));
    expect(applyAction(s, { type: 'tend', playerId: 'a', station: 'tawa1' }).error).toBe('Already clean');
    for (let i = 0; i < 4; i++) {
      s = cook(s, 'a', 'tawa1', i % 3, 'dosa').state;
      s = tk(s, 8).s;
      s = ap(s, { type: 'take', playerId: 'a', station: 'tawa1', slot: i % 3 }).state;
      s = ap(s, { type: 'discard', playerId: 'a', hand: 0 }).state;
    }
    expect(tawaPan(s).gunk).toBe(4 * HEAT.gunkPerCook);
    s = patch(s, { stations: { ...s.stations, tawa1: { ...s.stations.tawa1, gunk: 40, heat: 40 } } });
    expect(tendInfo(s, 'tawa1').canTend).toBe(true);
    const r = ap(s, { type: 'tend', playerId: 'b', station: 'tawa1' });
    expect(r.events).toEqual([{ type: 'tend', station: 'tawa1', kind: 'wipe', by: 'b' }]);
    expect(tawaPan(r.state)).toMatchObject({ heat: HEAT.ideal, gunk: 0, tendAt: s.tick });
    expect(r.state.players.b.ops).toEqual([0, 1, 0, 0]);
    expect(ap(quiet(game(3)), { type: 'move', playerId: 'a', to: 'steamer1' }).state.players.a.at).toBe('steamer1');
    const dry = patch(s, { stations: { ...s.stations, steamer1: { ...s.stations.steamer1, water: 20 } } });
    expect(ap(dry, { type: 'tend', playerId: 'a', station: 'steamer1' }).events[0]).toMatchObject({ type: 'tend', kind: 'water' });
    expect(ap(patch(s, { stations: { ...s.stations, kadai1: { ...s.stations.kadai1, heat: 95 } } }), { type: 'tend', playerId: 'a', station: 'kadai1' }).events[0].kind).toBe('skim');
    for (const station of ['chai1', 'prep1', 'nowhere', '__proto__', 'constructor', 5, null, undefined]) {
      const t = applyAction(s, { type: 'tend', playerId: 'a', station });
      expect(t.state).toBe(s);
      expect(t.error).toBeTruthy();
    }
    expect(applyAction(game(1), { type: 'tend', playerId: 'a', station: 'tawa1' }).error).toBeTruthy();
  });

  it('a cold pan cooks at half speed; a hot pan burns the food 1.5x as fast', () => {
    const s0 = quiet(game(3));
    const setHeat = (s, heat) => patch(s, { stations: { ...s.stations, tawa1: { ...s.stations.tawa1, heat } } });
    // normal: dosa ready after 5 ticks
    let n = cook(s0, 'a', 'tawa1', 0, 'dosa').state;
    n = setHeat(n, HEAT.ideal);
    expect(tk(n, 5).s.stations.tawa1.slots[0].st).toBe('ready');
    // cold: 10 ticks (the pan stays cold: set it each tick)
    let c = setHeat(cook(s0, 'a', 'tawa1', 0, 'dosa').state, 10);
    let readyAt = null;
    const ev = [];
    for (let i = 1; i <= 14; i++) {
      const r = ap(setHeat(c, 10), { type: 'tick' });
      c = r.state;
      ev.push(...r.events);
      if (readyAt === null && c.stations.tawa1.slots[0].st === 'ready') readyAt = i;
    }
    expect(readyAt).toBeGreaterThanOrEqual(9); // half speed: 5 ticks of work take 9-10 (it depends on which tick the dish went on)
    expect(readyAt).toBeLessThanOrEqual(10);
    // hot: a dosa burns after ~2/3 of the normal 7 ticks
    let h = cook(s0, 'a', 'tawa1', 0, 'dosa').state;
    h = tk(setHeat(h, HEAT.ideal), 5).s;
    expect(h.stations.tawa1.slots[0].st).toBe('ready');
    let burnt = null;
    for (let i = 1; i <= 8; i++) {
      h = ap(setHeat(h, 95), { type: 'tick' }).state;
      if (burnt === null && h.stations.tawa1.slots[0].st === 'burnt') burnt = i;
    }
    expect(burnt).toBeLessThan(7);
    expect(burnt).toBeGreaterThanOrEqual(4);
  });

  it('heat-warning when a working pan goes cold (a pour chills it) or hot (food waiting on it), never for an idle one', () => {
    const setHeat = (s, heat) => patch(s, { stations: { ...s.stations, tawa1: { ...s.stations.tawa1, heat } } });
    // an idle pan creeps hotter all the way to 100 without a word
    const idle = tk(quiet(game(3)), 90);
    expect(types(idle.ev)).not.toContain('heat-warning');
    expect(idle.s.stations.tawa1.heat).toBeGreaterThan(HEAT.hot);
    // a pour that chills the pan below the limit warns at that moment
    const cool = cook(setHeat(quiet(game(3)), HEAT.cold + 1), 'a', 'tawa1', 0, 'dosa');
    expect(cool.events).toContainEqual({ type: 'heat-warning', station: 'tawa1', band: 'cold' });
    // a pour that stays in the band does not
    expect(types(cook(setHeat(quiet(game(3)), HEAT.ideal), 'a', 'tawa1', 0, 'dosa').events)).not.toContain('heat-warning');
    // a dish waiting on a pan that drifts past the hot limit
    let w = cook(setHeat(quiet(game(3)), HEAT.ideal), 'a', 'tawa1', 0, 'dosa').state;
    w = tk(setHeat(w, HEAT.ideal), 5).s; // ready, the pan is now idle
    w = setHeat(w, HEAT.hot);
    const ev = tk(w, HEAT.idleEvery).ev;
    expect(ev).toContainEqual({ type: 'heat-warning', station: 'tawa1', band: 'hot' });
  });

  it('neglected pans make flawed food: stuck dishes drop to "ok", torn dishes are "broken" and pay half', () => {
    const s0 = quiet(game(3, 1, [{ id: 'a' }]));
    const withGunk = (gunk, heat = HEAT.ideal) => patch(s0, { stations: { ...s0.stations, tawa1: { ...s0.stations.tawa1, gunk, heat } } });
    const run = (s) => {
      let t = cook(s, 'a', 'tawa1', 0, 'dosa').state;
      t = patch(t, { stations: { ...t.stations, tawa1: { ...t.stations.tawa1, heat: HEAT.ideal } } });
      const r = tk(t, 5);
      return r;
    };
    const clean = run(withGunk(0));
    expect(clean.ev.find((e) => e.type === 'ready')).toEqual({ type: 'ready', station: 'tawa1', slot: 0, dish: 'dosa' });
    expect(ap(clean.s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 }).events[0].q).toBe('perfect');

    const stuck = run(withGunk(HEAT.stick));
    expect(stuck.ev.find((e) => e.type === 'ready')).toMatchObject({ flaw: 'stuck' });
    expect(slotInfo(stuck.s, 'tawa1', 0).flaw).toBe('stuck');
    expect(ap(stuck.s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 }).events[0].q).toBe('ok');

    const torn = run(withGunk(HEAT.torn));
    expect(torn.ev.find((e) => e.type === 'ready')).toMatchObject({ flaw: 'torn' });
    const taken = ap(torn.s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 });
    expect(taken.events[0].q).toBe('broken');
    expect(taken.state.players.a.hands).toEqual([{ dish: 'dosa', q: 'broken' }]);

    // serving a broken dish: the bill drops by half that dish's price, and no perfect-dish tip
    let g = createGame({ players: [{ id: 'a' }], settings: { level: 0 }, seed: 1 });
    g = ap(g, { type: 'spawn', customer: { order: ['dosa', 'irani_chai'] } }).state;
    g = patch(g, { players: { a: { ...g.players.a, hands: [{ dish: 'dosa', q: 'broken' }] } } });
    const sv = ap(g, { type: 'serve', playerId: 'a', customer: 1, hand: 0 });
    expect(sv.events).toEqual([{ type: 'serve', customer: 1, dish: 'dosa', by: 'a', q: 'broken' }]);
    expect(sv.state.customers[0].total).toBe(DISHES.dosa.price / 2 + DISHES.irani_chai.price);
  });

  it('tending a pan while the dish cooks rescues it (flaws are decided when the dish comes off)', () => {
    const s0 = quiet(game(3));
    let s = patch(s0, { stations: { ...s0.stations, tawa1: { ...s0.stations.tawa1, gunk: HEAT.torn } } });
    s = cook(s, 'a', 'tawa1', 0, 'dosa').state;
    s = ap(s, { type: 'tend', playerId: 'a', station: 'tawa1' }).state;
    const r = tk(s, 5);
    expect(r.ev.find((e) => e.type === 'ready').flaw).toBeUndefined();
  });

  it('the dry steamer runs at half speed and then stops', () => {
    const s0 = quiet(game(3));
    const dry = (water) => patch(s0, { stations: { ...s0.stations, steamer1: { ...s0.stations.steamer1, water } } });
    let s = cook(dry(HEAT.waterDry - 1), 'a', 'steamer1', 0, 'idly').state;
    s = patch(s, { stations: { ...s.stations, steamer1: { ...s.stations.steamer1, water: HEAT.waterDry - 1 } } });
    // idly = 7 ticks: ~14 at half speed (the water keeps falling a little, so allow a margin)
    let n = 0;
    while (s.stations.steamer1.slots[0].st === 'cooking' && n < 40) {
      s = ap(patch(s, { stations: { ...s.stations, steamer1: { ...s.stations.steamer1, water: HEAT.waterDry - 1 } } }), { type: 'tick' }).state;
      n += 1;
    }
    expect(n).toBeGreaterThanOrEqual(13);
    expect(n).toBeLessThanOrEqual(14);
    expect(s.stations.steamer1.slots[0].fl).toBe(1);
    const empty = dry(0);
    expect(cook(empty, 'a', 'steamer1', 0, 'idly').error).toMatch(/dry/);
  });
});

describe('freshness of batter', () => {
  it('batter loses freshness over ticks; ferments faster at noon than at night; only batter has it', () => {
    const s = game(5); // level 5 is a noon level
    expect(Object.keys(s.fresh).sort()).toEqual(levelItems(s.cfg.menu).filter((i) => INGREDIENTS[i].ferments).sort());
    for (const v of Object.values(s.fresh)) expect(v).toBe(levelOps(5).fresh);
    const t = tk(quiet(s), 20).s;
    expect(t.fresh.batter_dosa).toBe(levelOps(5).fresh - 20 / FERMENT.every.noon);
    const night = tk(quiet(game(11)), 20).s;
    expect(night.fresh.batter_dosa).toBeGreaterThan(levelOps(11).fresh - 20 / FERMENT.every.noon);
  });

  it('sour batter (below the limit) makes dishes "ok" at best, with a batter-sour warning once', () => {
    let s = quiet(game(3));
    s = patch(s, { fresh: { ...s.fresh, batter_dosa: FERMENT.sour } });
    const ev = [];
    let t = s;
    for (let i = 0; i < 6; i++) { const r = ap(t, { type: 'tick' }); t = r.state; ev.push(...r.events); }
    expect(ev.filter((e) => e.type === 'batter-sour')).toEqual([{ type: 'batter-sour', item: 'batter_dosa' }]);
    expect(stockInfo(t).find((i) => i.item === 'batter_dosa').sour).toBe(true);
    let c = cook(t, 'a', 'tawa1', 0, 'dosa').state;
    c = patch(c, { stations: { ...c.stations, tawa1: { ...c.stations.tawa1, heat: HEAT.ideal } } });
    const done = tk(c, 5);
    expect(done.ev.find((e) => e.type === 'ready')).toMatchObject({ flaw: 'sour' });
    expect(ap(done.s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 }).events[0].q).toBe('ok');
  });

  it('a new batch is mixed in (weighted average); a sour shelf spoils and is thrown out', () => {
    let s = quiet(game(3));
    s = patch(s, { stock: stockOf(s, { batter_dosa: 8 }), fresh: { ...s.fresh, batter_dosa: 40 } });
    s = ap(s, { type: 'prep', playerId: 'a', station: 'prep1', slot: 0, item: 'batter_dosa' }).state;
    s = patch(s, { stations: { ...s.stations, prep1: { ...s.stations.prep1, slots: [{ ...s.stations.prep1.slots[0], st: 'ready' }, s.stations.prep1.slots[1]] } } });
    const c = ap(s, { type: 'collectPrep', playerId: 'a', station: 'prep1', slot: 0 }).state;
    const n = INGREDIENTS.batter_dosa.prep.yield;
    expect(c.fresh.batter_dosa).toBe(Math.round((40 * 8 + 100 * n) / (8 + n)));

    const bad = patch(quiet(game(3)), { fresh: { batter_dosa: 1, batter_idly: 90, vada_batter: 90 } });
    const r = tk(patch(bad, { tick: 0 }), 4);
    const spoiled = r.ev.find((e) => e.type === 'stock-spoiled');
    expect(spoiled).toMatchObject({ item: 'batter_dosa' });
    expect(r.s.stock.batter_dosa).toBe(0);
    expect(r.s.fresh.batter_dosa).toBe(100);
    expect(r.s.waste).toBeGreaterThan(0);
    expect(r.s.waste).toBeLessThanOrEqual(r.s.cost);
    expect(types(r.ev)).toContain('stock-out');
  });
});

describe('the price board and sold-out customers', () => {
  const arrive = (s, order = ['dosa'], at = s.tick) => ({ ...s, schedule: [{ at, kind: 'student', name: 'Kiran', look: 'bag', order, patienceMax: 40 }], genAt: null, nextArrival: at });

  it('board {dish, on}: take a dish off, put it back; repeats are no-ops; bad input is refused', () => {
    const s = quiet(game(3));
    const r = ap(s, { type: 'board', playerId: 'a', dish: 'poori', on: false });
    expect(r.events).toEqual([{ type: 'board', dish: 'poori', on: false, by: 'a' }]);
    expect(r.state.off).toEqual(['poori']);
    expect(applyAction(r.state, { type: 'board', playerId: 'b', dish: 'poori', on: false }).state).toBe(r.state); // already off
    const back = ap(r.state, { type: 'board', playerId: 'a', dish: 'poori', on: true });
    expect(back.state.off).toEqual([]);
    expect(applyAction(s, { type: 'board', playerId: 'a', dish: 'poori', on: true }).state).toBe(s);
    for (const [dish, on] of [['pizza', false], ['__proto__', true], [7, false], [undefined, false], ['poori', 'no'], ['poori', 1], ['poori', undefined], ['podi_dosa', false]]) {
      const bad = applyAction(s, { type: 'board', playerId: 'a', dish, on });
      expect(bad.state, JSON.stringify([dish, on])).toBe(s);
      expect(bad.error).toBeTruthy();
    }
  });

  it('a dish that is off the board is swapped for something else (no life lost), and a sold-out event says so', () => {
    let s = quiet(game(3));
    s = ap(s, { type: 'board', playerId: 'a', dish: 'dosa', on: false }).state;
    const t = tk(arrive(s, ['dosa'], s.tick + 1), 1);
    expect(t.s.customers).toHaveLength(1);
    const c = t.s.customers[0];
    expect(c.order).toHaveLength(1);
    expect(c.order[0]).not.toBe('dosa');
    expect(DISHES[c.order[0]].station).toBe('tawa'); // same kind first
    const so = t.ev.find((e) => e.type === 'sold-out');
    expect(so).toEqual({ type: 'sold-out', customer: c.id, dish: 'dosa', swap: c.order[0], left: false });
    expect(t.ev.map((e) => e.type)).toEqual(expect.arrayContaining(['customer-arrive', 'sold-out']));
    expect(c.total).toBe(DISHES[c.order[0]].price);
    expect(t.s.lives).toBe(5);
  });

  it('when nothing they want can be had they leave politely: no seat, no life, no combo lost', () => {
    let s = quiet(game(3));
    s = patch(s, { combo: 3 });
    for (const d of s.cfg.menu) s = ap(s, { type: 'board', playerId: 'a', dish: d, on: false }).state;
    const t = tk(arrive(s, ['dosa', 'idly'], s.tick + 1), 1);
    expect(t.s.customers).toEqual([]);
    expect(t.ev.find((e) => e.type === 'sold-out')).toMatchObject({ dish: 'dosa', swap: null, left: true });
    expect(t.s).toMatchObject({ lives: 5, lost: 0, unpaid: 0, combo: 3 });
  });

  it('out of stock counts as off the board: they swap, or go home, and the stock is promised to people already waiting', () => {
    let s = quiet(game(3));
    s = patch(s, { stock: stockOf(s, { batter_dosa: 0 }) });
    const t = tk(arrive(s, ['masala_dosa'], s.tick + 1), 1);
    expect(t.ev.find((e) => e.type === 'sold-out')).toMatchObject({ dish: 'masala_dosa', left: false });
    expect(t.s.customers[0].order[0]).not.toBe('masala_dosa');
    // two portions left of the batter: the first customer takes 2 dosas, so the next one cannot have a dosa
    let p = quiet(game(3));
    p = patch(p, { stock: stockOf(p, { batter_dosa: 2 }) });
    p = tk(arrive(p, ['dosa', 'dosa'], p.tick + 1), 1).s;
    expect(p.customers[0].order).toEqual(['dosa', 'dosa']);
    const q = tk(arrive(p, ['dosa'], p.tick + 1), 1);
    expect(q.s.customers[1].order[0]).not.toBe('dosa');
    expect(q.ev.find((e) => e.type === 'sold-out')).toMatchObject({ dish: 'dosa', left: false });
  });

  it('taking a dish off the board changes the order of customers who are still waiting for it', () => {
    let s = quiet(game(3));
    s = tk(arrive(s, ['dosa', 'irani_chai'], s.tick + 1), 1).s;
    const c0 = s.customers[0];
    expect(c0.order).toEqual(['dosa', 'irani_chai']);
    const r = ap(s, { type: 'board', playerId: 'a', dish: 'dosa', on: false });
    const c = r.state.customers[0];
    expect(c.order).toContain('irani_chai');
    expect(c.order).not.toContain('dosa');
    expect(c.order).toHaveLength(2);
    expect(r.events.find((e) => e.type === 'sold-out')).toMatchObject({ customer: c.id, dish: 'dosa', left: false });
    expect(c.total).toBe(c.order.reduce((n, d) => n + DISHES[d].price, 0));
    // someone who already got the dish is not touched
    let g = quiet(game(3));
    g = tk(arrive(g, ['dosa'], g.tick + 1), 1).s;
    g = patch(g, { customers: g.customers.map((x) => ({ ...x, got: ['dosa'], qs: ['good'], st: 'eating', eatLeft: 3 })) });
    expect(ap(g, { type: 'board', playerId: 'a', dish: 'dosa', on: false }).state.customers[0].order).toEqual(['dosa']);
  });

  it('serving somebody something they did not want is still refused', () => {
    let s = quiet(game(3));
    s = tk(arrive(s, ['dosa'], s.tick + 1), 1).s;
    s = patch(s, { players: { ...s.players, a: { ...s.players.a, hands: [{ dish: 'idly', q: 'good' }] } } });
    expect(applyAction(s, { type: 'serve', playerId: 'a', customer: 1, hand: 0 }).error).toBe('They did not order that');
  });
});

describe('the market: buy {item, n}', () => {
  it('only where the stall can send someone; 40% dearer; instant; the shelf limit applies', () => {
    const s = quiet(game(5));
    expect(s.cfg.market).toBe(true);
    const r = ap(s, { type: 'buy', playerId: 'a', item: 'sambar', n: 4 });
    expect(r.events).toEqual([{ type: 'buy', item: 'sambar', n: 4, cost: Math.ceil(4 * INGREDIENTS.sambar.cost * MARKET_MARKUP), by: 'a' }]);
    expect(r.state.stock.sambar).toBe(s.stock.sambar + 4);
    expect(r.state.cost).toBe(Math.ceil(4 * INGREDIENTS.sambar.cost * MARKET_MARKUP));
    expect(r.state.cost).toBeGreaterThan(4 * INGREDIENTS.sambar.cost);
    expect(r.state.players.a.ops).toEqual([0, 0, 0, 1]);
    const nope = applyAction(quiet(game(3)), { type: 'buy', playerId: 'a', item: 'sambar', n: 1 });
    expect(nope.error).toMatch(/market/);
    for (const [item, n] of [['pizza', 1], ['__proto__', 1], ['sambar', 0], ['sambar', -1], ['sambar', 1.5], ['sambar', NaN], ['sambar', 11], ['sambar', 1e9], ['sambar', '3'], [undefined, 1], ['sambar', undefined]]) {
      const bad = applyAction(s, { type: 'buy', playerId: 'a', item, n });
      expect(bad.state, JSON.stringify([item, n])).toBe(s);
      expect(bad.error).toBeTruthy();
    }
    const full = patch(s, { stock: stockOf(s, { sambar: STOCK_CAP - 2 }) });
    expect(applyAction(full, { type: 'buy', playerId: 'a', item: 'sambar', n: 5 }).error).toMatch(/full/);
  });
});

describe("customers' special requests", () => {
  const arrive = (s, e) => {
    const entry = { at: s.tick + 1, kind: 'student', name: 'Kiran', look: 'bag', order: ['dosa'], patienceMax: 40, ...e };
    return tk({ ...quiet(s), schedule: [entry], nextArrival: entry.at }, 1);
  };
  const serveAll = (s, who = 'a') => {
    let t = s;
    for (const c of t.customers.filter((x) => x.st === 'waiting')) {
      for (const d of c.order) {
        t = patch(t, { players: { ...t.players, [who]: { ...t.players[who], hands: [{ dish: d, q: 'good' }] } } });
        t = ap(t, { type: 'serve', playerId: who, customer: c.id, hand: 0 }).state;
      }
    }
    return t;
  };

  it('a parcel: the bill carries a packing fee per dish, they pack instead of eating (longer), and customerInfo says so', () => {
    const r = arrive(game(3), { parcel: 1, order: ['dosa', 'idly'] });
    const c = r.s.customers[0];
    expect(c).toMatchObject({ parcel: true, total: DISHES.dosa.price + DISHES.idly.price + 2 * REQUEST.parcelFee });
    expect(customerInfo(r.s, c.id)).toMatchObject({ parcel: true });
    const t = serveAll(r.s);
    expect(t.customers[0]).toMatchObject({ st: 'eating', eatLeft: EAT_TICKS + REQUEST.packExtra });
    const plain = serveAll(arrive(game(3), { order: ['dosa', 'idly'] }).s);
    expect(plain.customers[0].eatLeft).toBe(EAT_TICKS);
    expect(plain.customers[0].parcel).toBeUndefined();
    const ev = ap(patch(r.s, { players: { ...r.s.players, a: { ...r.s.players.a, hands: [{ dish: 'dosa', q: 'good' }, { dish: 'idly', q: 'good' }] } } }), { type: 'serve', playerId: 'a', customer: c.id, hand: 0 });
    const last = ap(ev.state, { type: 'serve', playerId: 'a', customer: c.id, hand: 0 });
    expect(last.events).toContainEqual({ type: 'eating', customer: c.id, parcel: true });
  });

  it('extra chutney or sambar: costs stock, is charged, gives a tip', () => {
    const base = arrive(game(3), { extra: 'coconut_chutney' });
    expect(base.s.customers[0].extra).toBe('coconut_chutney');
    const s = base.s;
    const chutney = s.stock.coconut_chutney;
    const without = serveAll(arrive(game(3), { order: ['dosa'] }).s);
    const t = serveAll(s);
    const dosaUse = DISHES.dosa.uses.coconut_chutney;
    expect(t.stock.coconut_chutney).toBe(chutney - REQUEST.extraUse); // serving does not use stock: only the extra does
    expect(chutney - t.stock.coconut_chutney).toBe(REQUEST.extraUse);
    expect(dosaUse).toBeGreaterThan(0);
    expect(t.customers[0].tip).toBeGreaterThanOrEqual(without.customers[0].tip + REQUEST.extraTip);
    const ev = ap(patch(s, { players: { ...s.players, a: { ...s.players.a, hands: [{ dish: 'dosa', q: 'good' }] } } }), { type: 'serve', playerId: 'a', customer: 1, hand: 0 });
    expect(ev.events).toContainEqual({ type: 'extra', customer: 1, item: 'coconut_chutney' });
    // out of chutney: no extra, no bonus, nothing breaks
    const out = patch(s, { stock: stockOf(s, { coconut_chutney: 0 }) });
    const o = serveAll(out);
    expect(o.stock.coconut_chutney).toBe(0);
    expect(o.customers[0].tip).toBe(without.customers[0].tip);
  });

  it('spice less / more is a request the cook can honour for a small tip', () => {
    const s = arrive(game(3), { spice: 'more' }).s;
    expect(s.customers[0].spice).toBe('more');
    expect(customerInfo(s, 1)).toMatchObject({ spice: 'more' });
    const plain = serveAll(arrive(game(3), {}).s);
    expect(serveAll(s).customers[0].tip).toBeGreaterThanOrEqual(plain.customers[0].tip);
  });

  it('a regular carries a loyalty counter that grows on a good visit and resets on a bad one; they tip more', () => {
    let g = game(4, 1);
    expect(g.regs).toHaveLength(2);
    expect(g.regs.every((r) => Array.isArray(r) && r[0] === 0 && r[1] > 0)).toBe(true);
    const e = { regular: 1, rid: 0, kind: 'office', name: 'Imran bhai' };
    const first = arrive(g, e).s;
    expect(first.customers[0]).toMatchObject({ regular: true, rid: 0, loyal: 0 });
    expect(customerInfo(first, 1)).toMatchObject({ regular: true, loyal: 0 });
    const tipOf = (s) => serveAll(s).customers[0].tip;
    const newcomer = tipOf(arrive(g, { kind: 'office', name: 'Imran bhai' }).s);
    expect(tipOf(first)).toBeGreaterThan(newcomer);
    // pay it: loyalty 1; the next visit shows it and tips more
    let t = serveAll(first);
    t = tk(t, EAT_TICKS).s;
    t = ap(t, { type: 'collect', playerId: 'a', customer: 1 }).state;
    expect(t.regs[0][0]).toBe(1);
    const second = arrive(patch(t, { customers: [] }), e).s;
    expect(second.customers[0].loyal).toBe(1);
    expect(tipOf(second)).toBeGreaterThan(tipOf(first));
    // an angry walk-out resets it
    const angry = patch(t, { customers: [{ ...second.customers[0], patience: 1 }] });
    expect(tk(angry, 1).s.regs[0][0]).toBe(0);
  });

  it('office parcel orders come on later levels only, sized for the team, long deadline', () => {
    const count = (level, players) => {
      let big = 0;
      let sizes = [];
      for (let seed = 1; seed <= 10; seed++) {
        const s0 = createGame({ players: Array.from({ length: players }, (_, i) => ({ id: 'p' + i })), settings: { level }, seed });
        let s = patch(s0, { lives: 1e6, cfg: { ...s0.cfg, spots: 99, stock: false } });
        const seen = new Set();
        while (s.status === 'playing') {
          s = applyAction(s, { type: 'tick' }).state;
          for (const c of s.customers) if (!seen.has(c.id)) { seen.add(c.id); if (c.big) { big += 1; sizes.push(c.order.length); expect(c.parcel).toBe(true); expect(c.kind).toBe('office'); expect(c.patienceMax).toBeGreaterThan(40); } }
        }
      }
      return { big, sizes };
    };
    expect(count(3, 1).big).toBe(0);
    const solo = count(6, 1);
    const team = count(6, 4);
    expect(solo.big).toBeGreaterThan(0);
    expect(team.big).toBeGreaterThan(0);
    expect(Math.max(...solo.sizes)).toBeLessThanOrEqual(6);
    expect(Math.min(...solo.sizes)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...team.sizes)).toBeLessThanOrEqual(8);
    expect(Math.max(...team.sizes)).toBeGreaterThan(Math.max(...solo.sizes));
  });

  it('special requests only exist where the level asks for them', () => {
    let seen = 0;
    for (const level of [1, 2]) {
      const sched = game(level, 3).schedule;
      for (const e of sched) { expect(e.extra).toBeUndefined(); seen += 1; }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('needs(): what the stall needs doing, most urgent first', () => {
  it('gas, stock, ready prep, tending, the inspector', () => {
    let s = quiet(game(5));
    expect(needs(s)).toEqual([]);
    s = patch(s, { gas: { u: 50, sw: 0 }, stock: stockOf(s, { sambar: 0 }) });
    s = patch(s, { stations: { ...s.stations, tawa1: { ...s.stations.tawa1, heat: 10 } }, events: [{ id: 'inspector', until: s.tick + 9 }] });
    const n = needs(s);
    expect(n.map((x) => x.type)).toEqual(expect.arrayContaining(['gas', 'stock', 'tend', 'inspector']));
    expect(n.find((x) => x.type === 'stock')).toMatchObject({ item: 'sambar' });
    for (let i = 1; i < n.length; i++) expect(n[i - 1].urgency).toBeGreaterThanOrEqual(n[i].urgency);
    for (const x of n) expect(x.urgency).toBeGreaterThan(0);
    const r = patch(s, { stations: { ...s.stations, prep1: { ...s.stations.prep1, slots: [{ st: 'ready', item: 'oil', t0: 0, readyAt: 1, by: 'a' }, s.stations.prep1.slots[1]] } } });
    expect(needs(r).find((x) => x.type === 'collect-prep')).toMatchObject({ station: 'prep1', slot: 0, item: 'oil' });
    expect(needs(null)).toEqual([]);
    expect(needs(patch(s, { status: 'done' }))).toEqual([]);
  });
});

describe('never a dead end', () => {
  it('everything out and the cylinder empty: prepping and a gas swap always get the stall going again', () => {
    for (const level of [3, 8, 12]) {
      let s = quiet(game(level, 4, [{ id: 'a' }]));
      const none = Object.fromEntries(Object.keys(s.stock).map((k) => [k, 0]));
      s = patch(s, { stock: none, gas: { u: 0, sw: 0 } });
      // the only way out is the layer's own actions
      s = ap(s, { type: 'swapGas', playerId: 'a' }).state;
      s = tk(s, GAS.swapTicks).s;
      expect(gasInfo(s).on).toBe(true);
      for (const item of ['batter_dosa', 'coconut_chutney']) {
        const slot = s.stations.prep1.slots.findIndex((x) => x.st === 'empty');
        s = ap(s, { type: 'prep', playerId: 'a', station: 'prep1', slot, item }).state;
      }
      s = tk(s, 14).s;
      s = ap(s, { type: 'collectPrep', playerId: 'a', station: 'prep1', slot: 0 }).state;
      s = ap(s, { type: 'collectPrep', playerId: 'a', station: 'prep1', slot: 1 }).state;
      const r = cook(s, 'a', 'tawa1', 0, 'dosa');
      expect(r.error, `level ${level}`).toBeTruthy(); // sambar and oil are still out: dosa wants them too
      let t = s;
      for (const item of ['sambar', 'oil']) {
        const slot = t.stations.prep1.slots.findIndex((x) => x.st === 'empty');
        t = ap(t, { type: 'prep', playerId: 'a', station: 'prep1', slot, item }).state;
      }
      t = tk(t, 12).s;
      t = ap(t, { type: 'collectPrep', playerId: 'a', station: 'prep1', slot: 0 }).state;
      t = ap(t, { type: 'collectPrep', playerId: 'a', station: 'prep1', slot: 1 }).state;
      expect(cook(t, 'a', 'tawa1', 0, 'dosa').error, `level ${level}`).toBeUndefined();
    }
  });

  it('the bot, starting with an empty shelf and an empty cylinder, recovers and serves customers', () => {
    let s = game(8, 2, [{ id: 'a' }, { id: 'b' }]);
    const none = Object.fromEntries(Object.keys(s.stock).map((k) => [k, 0]));
    s = patch(s, { stock: none, gas: { u: 0, sw: 0 }, lives: 1e6 });
    const freeAt = { a: 0, b: 0 };
    for (let i = 0; i < 120 && s.status === 'playing'; i++) {
      for (const id of ['a', 'b']) {
        if (freeAt[id] > s.tick) continue;
        const a = chooseAutoAction(s, id);
        if (!a) continue;
        const r = applyAction(s, a);
        expect(r.error, JSON.stringify(a)).toBeUndefined();
        s = r.state;
        freeAt[id] = s.tick + 1;
      }
      s = applyAction(s, { type: 'tick' }).state;
    }
    expect(s.paid).toBeGreaterThan(0);
    expect(result(s).stats.prepped).toBeGreaterThan(0);
  });
});

describe('state stays sane', () => {
  it('stock, gas and heat are never negative or NaN over whole shifts; JSON round-trips; state size is reported', () => {
    const sizes = {};
    for (const [level, n] of [[1, 1], [3, 2], [6, 3], [12, 4]]) {
      const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'Player ' + (i + 1) }));
      let s = createGame({ players, settings: { level, pace: 'rush' }, seed: 5 });
      const freeAt = Object.fromEntries(players.map((p) => [p.id, 0]));
      let max = 0;
      while (s.status === 'playing') {
        for (const p of players) {
          if (freeAt[p.id] > s.tick) continue;
          const a = chooseAutoAction(s, p.id);
          if (!a) continue;
          s = ap(s, a).state;
          freeAt[p.id] = s.tick + 1;
          max = Math.max(max, JSON.stringify(s).length);
        }
        if (s.status !== 'playing') break;
        s = ap(s, { type: 'tick' }).state;
        max = Math.max(max, JSON.stringify(s).length);
        for (const v of Object.values(s.stock)) expect(v >= 0 && Number.isFinite(v)).toBe(true);
        for (const v of Object.values(s.fresh)) expect(v >= 0 && v <= 100).toBe(true);
        if (s.gas) { expect(s.gas.u >= 0 && s.gas.u <= GAS.cap).toBe(true); expect(s.gas.sw >= 0).toBe(true); }
        for (const st of Object.values(s.stations)) {
          for (const k of ['heat', 'water', 'gunk']) if (k in st) expect(st[k] >= 0 && st[k] <= 100).toBe(true);
        }
        expect(Number.isFinite(s.cost) && s.cost >= 0).toBe(true);
        expect(s.waste <= s.cost + 1e-9).toBe(true);
      }
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
      sizes[`L${level}x${n}`] = max;
    }
    // eslint-disable-next-line no-console
    console.log('state size (bytes, largest seen while a bot plays, rush pace):', JSON.stringify(sizes));
    expect(sizes.L1x1).toBeLessThan(4000);
    expect(sizes.L12x4).toBeLessThan(7500);
  });

  it('same seed + same actions = same game, including the new actions', () => {
    const run = () => {
      let s = game(5, 77);
      const acts = [
        { type: 'prep', playerId: 'a', station: 'prep1', slot: 0, item: 'batter_dosa' }, { type: 'cook', playerId: 'b', station: 'tawa1', slot: 0, dish: 'dosa' },
        { type: 'board', playerId: 'a', dish: 'poori', on: false }, { type: 'tend', playerId: 'b', station: 'tawa1' },
      ];
      for (let i = 0; i < 90; i++) {
        if (i % 9 === 0) s = applyAction(s, acts[(i / 9) % acts.length]).state;
        if (i === 40) s = applyAction(s, { type: 'swapGas', playerId: 'a' }).state;
        s = applyAction(s, { type: 'tick' }).state;
        if (s.status !== 'playing') break;
      }
      return s;
    };
    expect(run()).toEqual(run());
  });
});
