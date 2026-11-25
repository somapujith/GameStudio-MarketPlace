// Tiffin Centre stress test: random legal and illegal actions (the operations layer's prep / collectPrep / tend / swapGas / board / buy
// included, with hostile parameters), straight to game over, for 200 seeds. Nothing may throw, refusals leave the very same state object,
// and the structural invariants hold after every action: stock, gas, heat and money never negative or NaN, the state size stays controlled.
import { describe, it, expect, vi } from 'vitest';
import { mulberry32 } from '../rng.js';
import {
  createGame, applyAction, isOver, result, chooseAutoAction, LIVES, HANDS_MAX, STATIONS, STATION_KINDS, DISHES, EMOTES, MAX_LEVEL, INGREDIENT_IDS,
  INGREDIENTS, STOCK_CAP, GAS, EVENT_IDS, needs, stockInfo, gasInfo, tendInfo, eventsNow,
} from './index.js';

vi.setConfig({ testTimeout: 240000 });
// 200 seeds locally; CI (a 2-core runner with a 15 minute deploy job) runs a third of them, the same code paths
const SEED_COUNT = process.env.CI ? 60 : 200;

const JUNK = [undefined, null, NaN, Infinity, -Infinity, -1, 0, 1, 2, 3, 99, 1e30, -1e30, 0.5, '0', '1', '', 'x', '__proto__', 'constructor', 'toString',
  'prototype', 'spot:99', 'gas', 'prep1', true, false, {}, [], [0], { a: 1 }, { __proto__: { x: 1 } }, () => 1, 1e-9, -0, 2 ** 53, '1e3'];
const pick = (r, a) => a[Math.floor(r() * a.length)];

let checks = 0;
const ok = (cond, label, what) => {
  if (!cond) throw new Error(`${label}: ${what}`);
};

function invariants(s, label) {
  const text = JSON.stringify(s);
  if (checks++ % 4 === 0) ok(JSON.stringify(JSON.parse(text)) === text, label, 'not JSON round-trippable');
  if (checks % 500 === 1) expect(JSON.parse(text), label).toEqual(s); // deep check (catches undefined values) now and then
  ok(Number.isInteger(s.money) && s.money >= 0, label, `money ${s.money}`);
  ok(s.tips >= 0 && s.combo >= 0, label, 'negative tips or combo');
  ok(Number.isFinite(s.cost) && s.cost >= 0 && Number.isFinite(s.waste) && s.waste >= 0 && s.waste <= s.cost + 1e-6, label, `cost ${s.cost} waste ${s.waste}`);
  ok(s.revenue + s.tips === s.money, label, 'revenue + tips != money');
  ok(Math.abs(s.profit - (s.money - s.cost)) < 0.011, label, `profit ${s.profit} != ${s.money} - ${s.cost}`);
  ok(s.bestCombo >= s.combo, label, 'bestCombo below combo');
  ok(Number.isFinite(s.pre) && s.pre >= 0, label, `pre ${s.pre}`);
  ok(Number.isInteger(s.lives) && s.lives >= 0 && s.lives <= LIVES, label, `lives ${s.lives}`);
  ok(text.length < 8000, label, `state is ${text.length} bytes`);
  ok(s.schedule.length <= 2 && s.emotes.length <= 4, label, 'schedule or emotes grew');
  ok(s.events.length <= 4 && s.off.length <= 13 && s.regs.length <= 3, label, 'events, board or regulars grew');
  ok(s.status !== 'closed' || s.stars === 0, label, 'closed with stars');
  let earned = 0;
  for (const id of s.order) {
    const p = s.players[id];
    ok(p.hands.length <= HANDS_MAX, label, 'hands over capacity');
    for (const h of p.hands) ok(DISHES[h.dish] && ['perfect', 'good', 'ok', 'broken'].includes(h.q), label, 'bad hand item');
    ok(p.earned >= 0, label, 'negative earnings');
    if (p.ops) ok(p.ops.length === 4 && p.ops.every((n) => Number.isInteger(n) && n >= 0), label, 'bad ops counters');
    earned += p.earned;
  }
  ok(earned <= s.money, label, 'players earned more than the stall');
  ok(s.money - earned <= 100 * (EVENT_IDS.length + 12), label, 'too much money nobody collected');
  for (const item of Object.keys(s.stock)) {
    ok(INGREDIENT_IDS.includes(item) && Number.isFinite(s.stock[item]) && s.stock[item] >= 0 && s.stock[item] <= STOCK_CAP, label, `stock ${item} ${s.stock[item]}`);
  }
  for (const item of Object.keys(s.fresh)) ok(INGREDIENTS[item].ferments && s.fresh[item] >= 0 && s.fresh[item] <= 100, label, `fresh ${item} ${s.fresh[item]}`);
  if (s.gas) {
    ok(Number.isInteger(s.gas.u) && s.gas.u >= 0 && s.gas.u <= GAS.cap && Number.isInteger(s.gas.sw) && s.gas.sw >= 0 && s.gas.sw <= GAS.swapTicks, label, `gas ${JSON.stringify(s.gas)}`);
  } else ok(!s.cfg.gas, label, 'gas level without a cylinder');
  ok(s.off.every((d) => s.cfg.menu.includes(d)) && new Set(s.off).size === s.off.length, label, 'bad board');
  for (const e of s.events) ok(EVENT_IDS.includes(e.id) && e.until > s.tick - 1, label, `bad event ${JSON.stringify(e)}`);
  for (const r of s.regs) ok(r.length === 2 && r[0] >= 0 && r[0] <= 3 && Number.isInteger(r[1]), label, 'bad regular');
  for (const fn of [needs, stockInfo, gasInfo, eventsNow]) expect(() => fn(s), label).not.toThrow();
  for (const sid of Object.keys(s.stations)) expect(() => tendInfo(s, sid), label).not.toThrow();
  for (const sid of Object.keys(s.stations)) {
    const st = s.stations[sid];
    ok(st.slots.length === STATION_KINDS[STATIONS[sid].kind].slots, label, 'slot count changed');
    if (st.kind === 'prep') {
      for (const sl of st.slots) {
        ok(['empty', 'cooking', 'ready'].includes(sl.st), label, 'bad prep state');
        ok(sl.st === 'empty' ? sl.item === null : !!INGREDIENTS[sl.item] && s.stock[sl.item] !== undefined, label, 'bad prep item');
      }
      continue;
    }
    for (const k of ['heat', 'water', 'gunk']) if (k in st) ok(Number.isFinite(st[k]) && st[k] >= 0 && st[k] <= 100, label, `${sid} ${k} ${st[k]}`);
    for (const sl of st.slots) {
      ok(['empty', 'cooking', 'ready', 'burnt'].includes(sl.st), label, 'bad slot state');
      ok(sl.st === 'empty' ? sl.dish === null : DISHES[sl.dish].station === st.kind, label, 'bad slot dish');
      ok(sl.fl === undefined || (Number.isInteger(sl.fl) && sl.fl > 0 && sl.fl < 8), label, 'bad flaw bits');
    }
  }
  const spots = new Set();
  for (const c of s.customers) {
    ok(c.patience >= 0 && c.patience <= c.patienceMax, label, 'patience out of range');
    ok(c.total >= 0 && Number.isFinite(c.total), label, `bill ${c.total}`);
    ok(['paid', 'angry', 'unpaid', 'soldout', null].includes(c.outcome), label, `outcome ${c.outcome}`);
    ok(c.got.length <= c.order.length && c.qs.length === c.got.length, label, 'bad got/qs');
    if (c.st !== 'left') {
      ok(!spots.has(c.spot) && c.spot < s.cfg.spots, label, `bad spot ${c.spot}`);
      spots.add(c.spot);
    }
  }
}

/** Half the time a plausible action built from the state, half the time garbage. */
function randomAction(s, r) {
  const who = pick(r, [...s.order, ...s.order, 'ghost', '__proto__', undefined, 7]);
  const stations = Object.keys(s.stations);
  const garbage = r() < 0.3;
  const g = (legal) => (garbage && r() < 0.5 ? pick(r, JUNK) : legal);
  const station = g(pick(r, stations.concat(['tawa2', 'steamer1', 'kadai1'])));
  const slot = g(Math.floor(r() * 4));
  const customers = s.customers.map((c) => c.id);
  const customer = g(customers.length ? pick(r, customers) : 1);
  const hand = g(Math.floor(r() * 3));
  const roll = r();
  const item = g(pick(r, INGREDIENT_IDS));
  const prepStation = g(r() < 0.8 ? 'prep1' : pick(r, stations));
  if (roll < 0.04) return pick(r, JUNK);
  if (roll < 0.17) return { type: 'cook', playerId: who, station, slot, dish: g(pick(r, Object.keys(DISHES))) };
  if (roll < 0.30) return { type: 'take', playerId: who, station, slot };
  if (roll < 0.42) return { type: 'serve', playerId: who, customer, hand };
  if (roll < 0.52) return { type: 'collect', playerId: who, customer };
  if (roll < 0.55) return { type: 'discard', playerId: who, hand };
  if (roll < 0.59) return { type: 'move', playerId: who, to: g(pick(r, [null, 'bin', 'gas', 'prep1', 'spot:0', 'spot:5', ...stations])) };
  if (roll < 0.61) return { type: 'emote', playerId: who, e: g(pick(r, EMOTES)) };
  if (roll < 0.62) return { type: 'spawn', customer: g({ order: [pick(r, s.cfg.menu)], kind: 'student' }) };
  if (roll < 0.63) return { type: 'tutorial-flags', patience: g(r() < 0.5), pay: g(r() < 0.5) };
  if (roll < 0.64) return { type: pick(r, JUNK) };
  if (roll < 0.65) return { type: 'tick', tick: g(s.tick) };
  // the operations layer
  if (roll < 0.75) return { type: 'prep', playerId: who, station: prepStation, slot: g(Math.floor(r() * 3)), item };
  if (roll < 0.82) return { type: 'collectPrep', playerId: who, station: prepStation, slot: g(Math.floor(r() * 3)) };
  if (roll < 0.89) return { type: 'tend', playerId: who, station };
  if (roll < 0.92) return { type: 'swapGas', playerId: who };
  if (roll < 0.97) return { type: 'board', playerId: who, dish: g(pick(r, Object.keys(DISHES))), on: g(r() < 0.5) };
  return { type: 'buy', playerId: who, item, n: g(1 + Math.floor(r() * 12)) };
}

function run(seed) {
  const r = mulberry32(seed * 7919 + 1);
  const level = seed % (MAX_LEVEL + 1);
  const n = 1 + (seed % 4);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  let s = createGame({ players, settings: { level, pace: pick(r, ['relaxed', 'normal', 'rush']) }, seed });
  const label = (i, a) => `seed ${seed} level ${level} step ${i} ${JSON.stringify(a)}`;
  let steps = 0;
  while (!isOver(s) && steps < 60000) {
    const burst = Math.floor(r() * 4);
    for (let k = 0; k < burst; k++) {
      // some players are sensible, some are chaos
      const a = r() < 0.35 ? chooseAutoAction(s, pick(r, s.order)) || randomAction(s, r) : randomAction(s, r);
      const lab = label(steps++, a);
      let res;
      try { res = applyAction(s, a); } catch (e) { throw new Error(`${lab} threw ${e.message}`); }
      ok(Array.isArray(res.events), lab, 'events is not an array');
      if (res.error !== undefined) {
        ok(typeof res.error === 'string' && res.state === s && res.events.length === 0, lab, 'a refusal must keep the same state, no events, a string error');
      } else {
        ok(res.state !== s || res.events.length === 0, lab, 'a no-op may not emit events');
        for (const e of res.events) ok(e && typeof e.type === 'string', lab, 'event without a type');
        if (steps % 3 === 0) invariants(res.state, lab);
        s = res.state;
      }
      if (isOver(s)) break;
    }
    if (isOver(s)) break;
    const tick = applyAction(s, { type: 'tick' });
    ok(tick.error === undefined, `seed ${seed}`, `tick refused: ${tick.error}`);
    s = tick.state;
    invariants(s, `seed ${seed} tick ${s.tick}`);
    steps++;
  }
  return s;
}

describe('fuzz: random legal and illegal actions to game over', () => {
  it('many seeds, every level, 1-4 players, the operations layer included', () => {
    const ends = { done: 0, closed: 0 };
    const seen = new Set();
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const s = run(seed);
      expect(isOver(s), `seed ${seed} did not finish`).toBe(true);
      ends[s.status] += 1;
      const res = result(s);
      expect(res.standings).toHaveLength(s.order.length);
      expect(res.money).toBe(s.money);
      expect(res.stars).toBe(s.stars);
      expect(JSON.parse(JSON.stringify(res))).toEqual(res);
      if (s.stars === 0) expect(res.winnerId).toBe(null);
      seen.add(s.level);
      // nothing works after the end
      for (const a of [{ type: 'tick' }, { type: 'cook', playerId: 'p0', station: 'tawa1', slot: 0, dish: 'dosa' }, { type: 'emote', playerId: 'p0', e: 'fire' },
        { type: 'prep', playerId: 'p0', station: 'prep1', slot: 0, item: 'oil' }, { type: 'swapGas', playerId: 'p0' }, { type: 'board', playerId: 'p0', dish: 'dosa', on: false }]) {
        const after = applyAction(s, a);
        expect(after.state).toBe(s);
        expect(after.error).toBeTruthy();
      }
    }
    expect(seen.size).toBe(MAX_LEVEL + 1);
    expect(ends.done + ends.closed).toBe(SEED_COUNT);
    expect(ends.closed).toBeGreaterThan(0);
    expect(ends.done).toBeGreaterThan(0);
  });

  it('the same seed replays to the identical game', () => {
    expect(run(17)).toEqual(run(17));
    expect(run(18)).not.toEqual(run(17));
  });

  it('hostile parameters to every new action are refused with the very same state', () => {
    const s = createGame({ players: [{ id: 'a' }, { id: 'b' }], settings: { level: 12 }, seed: 3 });
    const vals = JUNK;
    const actions = ['prep', 'collectPrep', 'tend', 'swapGas', 'board', 'buy'];
    let refused = 0;
    for (const type of actions) {
      for (const a of vals) {
        for (const b of vals) {
          const act = { type, playerId: 'a', station: a, slot: b, item: a, n: b, dish: a, on: b };
          let r;
          expect(() => { r = applyAction(s, act); }).not.toThrow();
          if (r.error) {
            expect(r.state).toBe(s);
            expect(r.events).toEqual([]);
            refused += 1;
          }
        }
      }
    }
    expect(refused).toBeGreaterThan(500);
    // prototype pollution: nothing leaked into Object.prototype, and objects that merely look like a boolean are not one
    expect({}.station).toBeUndefined();
    expect(applyAction(s, { type: 'board', playerId: 'a', dish: 'dosa', on: { valueOf: () => false } }).error).toBeTruthy();
    for (const pid of ['__proto__', 'constructor', 'toString', '', 5, null]) expect(applyAction(s, { type: 'swapGas', playerId: pid }).error).toBeTruthy();
  });
});
