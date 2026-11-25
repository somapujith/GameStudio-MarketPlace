// Tiffin Centre: the OPERATIONS LAYER (docs/TIFFIN_CENTRE_PLAN.md section 3b): ingredient stock and freshness, the back-counter prep jobs,
// LPG gas, heat / seasoning / tending, and the sold-out board. Pure functions over the engine state; the engine calls them from its action
// handlers and from `tick`. Everything here is a no-op while the matching `cfg` flag is false (level 0, the tutorial, switches all of it off).
//
// state fields owned here:
//   stock { item: portions }     fresh { item: 0..100 } (batter only)      pre (rupees of the shelf that is already paid for)
//   gas { u, sw } | null         off [dishIds] (the sold-out board)
//   stations.<tawa|kadai>: heat, gunk, tendAt     stations.steamer: water, gunk, tendAt     stations.prep1: 2 prep jobs
//   slot.fl: bit 1 stuck, 2 torn, 4 sour batter (only present when non-zero)
import {
  DISHES, EVENTS, FERMENT, GAS, HEAT, INGREDIENTS, INGREDIENT_IDS, MARKET_MARKUP, MARKET_MAX, PACE, PREP_STATION, STATION_KINDS, STOCK_CAP,
  STOCK_LOW, CUSTOMER_KINDS, coopScale, daypartOf,
} from './catalog.js';
import { dishCost, spend, wasteOnly } from './economy.js';
import { isDown } from './events.js';
import { dishWeight, FIRST_ARRIVAL } from './schedule.js';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const r2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const TUTORIAL_NO = 'Not available in the training shift';

export const PREP_KIND = 'prep';
export const isPrep = (st) => !!st && st.kind === PREP_KIND;
const HEATED = { tawa: 'heat', kadai: 'heat', steamer: 'water' };

// ---------------------------------------------------------------------------------------------------------------------
// opening stock

/** The ingredients the level's menu uses, in catalogue order. */
export function levelItems(menu) {
  const set = new Set();
  for (const d of menu) if (DISHES[d] && DISHES[d].uses) for (const item of Object.keys(DISHES[d].uses)) set.add(item);
  return INGREDIENT_IDS.filter((i) => set.has(i));
}

/** Expected portions of each ingredient a shift will use (customers x dishes each x taste by daypart x portion sizes). */
export function expectedDemand(level, menu, players, pace) {
  const [lo, hi] = level.gap;
  const meanGap = (((lo + hi) / 2) * (PACE[pace] || PACE.normal).gap) / coopScale(players);
  const customers = Math.max(1, (level.shiftTicks - FIRST_ARRIVAL) / meanGap + 1);
  let wsum = 0;
  let dsum = 0;
  for (const k of Object.values(CUSTOMER_KINDS)) {
    const top = Math.max(1, Math.min(k.order[1], level.orderMax));
    const bot = Math.min(k.order[0], top);
    wsum += k.weight;
    dsum += k.weight * ((bot + top) / 2);
  }
  const perCustomer = dsum / wsum;
  const ctx = { hour: level.hour, shiftTicks: level.shiftTicks, plan: null };
  const share = {};
  const samples = 8;
  for (let i = 0; i < samples; i++) {
    const t = (level.shiftTicks * (i + 0.5)) / samples;
    let tot = 0;
    for (const d of menu) tot += dishWeight(d, ctx, t);
    for (const d of menu) share[d] = (share[d] || 0) + dishWeight(d, ctx, t) / tot / samples;
  }
  const need = {};
  for (const d of menu) for (const [item, q] of Object.entries(DISHES[d].uses)) need[item] = (need[item] || 0) + customers * perCustomer * share[d] * q;
  return need;
}

export const OPEN_MAX = 32;
export const OPEN_MIN = 6;

/** Portions in stock when the shift opens: expected demand x the level's `stock` cover (+1 for the spoon that always goes missing), 6..32 portions of each item. */
export function openingStock(level, menu, ops, players, pace) {
  const need = expectedDemand(level, menu, players, pace);
  const out = {};
  for (const item of levelItems(menu)) out[item] = clamp(Math.ceil(need[item] * ops.stock) + 1, OPEN_MIN, OPEN_MAX);
  return out;
}

/** Called by createGame: switches the layer on for this level (cfg flags, stock, gas, pan state, the prep counter). */
export function opsInit(s, level, ops, menu, players, pace) {
  const stockOn = ops.stock > 0;
  Object.assign(s.cfg, {
    stock: stockOn, gas: ops.gas > 0, heat: !!ops.heat, market: !!ops.market, events: ops.events.slice(),
  });
  if (stockOn) {
    s.stock = openingStock(level, menu, ops, players, pace);
    for (const item of Object.keys(s.stock)) {
      if (INGREDIENTS[item].ferments) s.fresh[item] = ops.fresh;
    }
    s.cfg.stations.push(PREP_STATION);
    s.stations[PREP_STATION] = {
      id: PREP_STATION, kind: PREP_KIND,
      slots: Array.from({ length: STATION_KINDS.prep.slots }, () => ({ st: 'empty', item: null })), // t0, readyAt, by appear while a job runs
    };
  }
  if (s.cfg.gas) s.gas = { u: Math.min(GAS.cap, ops.gas), sw: 0 };
  if (s.cfg.heat) {
    for (const sid of s.cfg.stations) {
      const st = s.stations[sid];
      if (st.kind === 'tawa' || st.kind === 'kadai') { st.heat = HEAT.start; st.gunk = 0; st.tendAt = 0; }
      else if (st.kind === 'steamer') { st.water = HEAT.waterStart; st.gunk = 0; st.tendAt = 0; }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// the training switches (the tutorial driver's `tutorial-flags` action; level 0 only, every switch starts OFF)

/** Marker in `cfg.events` while the training shift's events are switched on: not a real event id, so the seeded plan is empty and events only happen when staged. */
export const STAGED = 'staged';
/** Training values: a shelf of 10 portions of everything, batter fresh, half a cylinder, a tawa that needs wiping, and short fuses for staged events. */
export const TRAIN = Object.freeze({
  stock: 10,
  fresh: 100,
  gas: 500,
  tawa: Object.freeze({ heat: 40, gunk: 72 }),
  fuse: Object.freeze({ rain: 40, power: 16, inspector: 20, delivery: 5, cricket: 40, festival: 40 }),
  fuseMax: 90,
});

const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function trainPrepStation(s) {
  if (!s.cfg.stations.includes(PREP_STATION)) s.cfg.stations.push(PREP_STATION);
  s.stations[PREP_STATION] = { id: PREP_STATION, kind: PREP_KIND, slots: Array.from({ length: STATION_KINDS.prep.slots }, () => ({ st: 'empty', item: null })) };
}

function trainStock(s, on) {
  if (on === s.cfg.stock) return;
  if (on) {
    s.cfg.stock = true;
    for (const item of levelItems(s.cfg.menu)) {
      s.stock[item] = TRAIN.stock;
      if (INGREDIENTS[item].ferments) s.fresh[item] = TRAIN.fresh;
    }
    trainPrepStation(s);
    return;
  }
  s.cfg.stock = false; s.cfg.market = false;
  s.stock = {}; s.fresh = {}; s.pre = 0; s.off = [];
  s.cfg.stations = s.cfg.stations.filter((id) => id !== PREP_STATION);
  delete s.stations[PREP_STATION];
  for (const id of s.order) if (s.players[id].at === PREP_STATION) s.players[id].at = null;
}

function trainGas(s, on) {
  if (on === s.cfg.gas) return;
  if (on) { s.cfg.gas = true; s.gas = { u: TRAIN.gas, sw: 0 }; return; }
  s.cfg.gas = false; s.gas = null;
  for (const id of s.order) if (s.players[id].at === 'gas') s.players[id].at = null;
}

function trainHeat(s, on) {
  if (on === s.cfg.heat) return;
  if (on) {
    s.cfg.heat = true;
    for (const sid of s.cfg.stations) {
      const st = s.stations[sid];
      if (st.kind === 'tawa') { st.heat = TRAIN.tawa.heat; st.gunk = TRAIN.tawa.gunk; st.tendAt = 0; }
      else if (st.kind === 'kadai') { st.heat = HEAT.start; st.gunk = 0; st.tendAt = 0; }
      else if (st.kind === 'steamer') { st.water = HEAT.waterStart; st.gunk = 0; st.tendAt = 0; }
    }
    return;
  }
  s.cfg.heat = false;
  for (const sid of s.cfg.stations) {
    const st = s.stations[sid];
    delete st.heat; delete st.water; delete st.gunk; delete st.tendAt;
  }
}

function trainEvents(s, on) {
  if (on === (s.cfg.events.length > 0)) return;
  s.cfg.events = on ? [STAGED] : [];
  if (!on) s.events = [];
}

/** `{ item | '*': value }` -> [[item, value]] for the items in `have`, or null when malformed / unknown. */
function itemValues(map, have, lo, hi) {
  if (!isObj(map)) return null;
  const out = [];
  for (const [k, v] of Object.entries(map)) {
    if (!isNum(v, lo, hi)) return null;
    if (k === '*') { for (const item of Object.keys(have)) out.push([item, v]); } else if (hasOwn(have, k)) out.push([k, v]); else return null;
  }
  return out;
}

/**
 * The ops part of the `tutorial-flags` action (engine.js calls it in a tutorial game only). Booleans `stock gas heat events market` switch that
 * mechanic ON (true) or back OFF (false) for the training shift; anything else changes nothing. `a.stage` (optional) then sets exact values so a
 * lesson can stage a situation: `{ stock: { item|'*': portions }, fresh: { item|'*': 0..100 }, gas: units, pans: { tawa|kadai: { heat, gunk },
 * steamer: { water, gunk } }, event: { id, ticks } }`. Each stage key needs its mechanic ON. Returns an error string or undefined.
 */
export function trainingFlags(s, a, ev) {
  const st = a.stage;
  if (st !== undefined && !isObj(st)) return 'Bad training stage';
  if (typeof a.stock === 'boolean') trainStock(s, a.stock);
  if (typeof a.gas === 'boolean') trainGas(s, a.gas);
  if (typeof a.heat === 'boolean') trainHeat(s, a.heat);
  if (typeof a.events === 'boolean') trainEvents(s, a.events);
  if (typeof a.market === 'boolean') {
    if (a.market && !s.cfg.stock) return 'The market needs the stock switched on';
    s.cfg.market = a.market;
  }
  if (!st) return undefined;
  if (st.stock !== undefined) {
    if (!s.cfg.stock) return 'Switch the stock on first';
    const list = itemValues(st.stock, s.stock, 0, STOCK_CAP);
    if (!list) return 'Bad training stock';
    // a batch that is still under way has to fit on the shelf when it is collected
    const pending = (item) => (s.stations[PREP_STATION] ? s.stations[PREP_STATION].slots.reduce((n, j) => n + (j.st !== 'empty' && j.item === item ? INGREDIENTS[item].prep.yield : 0), 0) : 0);
    for (const [item, n] of list) s.stock[item] = r2(Math.min(n, STOCK_CAP - pending(item)));
  }
  if (st.fresh !== undefined) {
    if (!s.cfg.stock) return 'Switch the stock on first';
    const list = itemValues(st.fresh, s.fresh, 0, 100);
    if (!list) return 'Bad training freshness';
    for (const [item, n] of list) s.fresh[item] = Math.round(n);
  }
  if (st.gas !== undefined) {
    if (!s.cfg.gas) return 'Switch the gas on first';
    if (!isNum(st.gas, 0, GAS.cap)) return 'Bad training gas';
    s.gas.u = Math.round(st.gas); s.gas.sw = 0;
  }
  if (st.pans !== undefined) {
    if (!s.cfg.heat) return 'Switch the heat on first';
    if (!isObj(st.pans)) return 'Bad training pans';
    for (const [kind, v] of Object.entries(st.pans)) {
      if ((kind !== 'tawa' && kind !== 'kadai' && kind !== 'steamer') || !isObj(v)) return 'Bad training pans';
      for (const [k, n] of Object.entries(v)) {
        const ok = k === 'gunk' || (kind === 'steamer' ? k === 'water' : k === 'heat');
        if (!ok || !isNum(n, 0, 100)) return 'Bad training pans';
      }
    }
    for (const sid of s.cfg.stations) {
      const pan = s.stations[sid];
      const v = st.pans[pan.kind];
      if (v) for (const [k, n] of Object.entries(v)) pan[k] = Math.round(n);
    }
  }
  if (st.event !== undefined) {
    if (!s.cfg.events.length) return 'Switch the events on first';
    const e = st.event;
    if (!isObj(e) || typeof e.id !== 'string' || !hasOwn(EVENTS, e.id)) return 'Unknown training event';
    const ticks = e.ticks === undefined ? (TRAIN.fuse[e.id] || 30) : e.ticks;
    if (!isNum(ticks, 1, TRAIN.fuseMax) || !Number.isInteger(ticks)) return 'Bad training event';
    s.events = s.events.filter((x) => x.id !== e.id);
    const entry = { id: e.id, until: s.tick + ticks };
    if (e.id === 'delivery') entry.w = 1;
    s.events.push(entry);
    ev.push({ type: 'event-start', id: e.id, until: entry.until });
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// reading (the HUD, the bot and the scene use these)

/** minimum amount of an item any dish on the menu uses (below this the item is "out"). */
export function minUse(item, menu) {
  let m = Infinity;
  for (const d of menu) if (DISHES[d].uses && hasOwn(DISHES[d].uses, item)) m = Math.min(m, DISHES[d].uses[item]);
  return Number.isFinite(m) ? m : 0.25;
}

/** `[{ item, name, te, n, fresh|null, low, out, sour, pending, cost }]`: portions in stock, freshness of batter, jobs under way for it. */
export function stockInfo(s) {
  if (!s || !s.cfg || !s.cfg.stock || !s.stock) return [];
  const out = [];
  for (const item of Object.keys(s.stock)) {
    const def = INGREDIENTS[item];
    if (!def) continue;
    const n = s.stock[item];
    const fresh = typeof s.fresh[item] === 'number' ? s.fresh[item] : null;
    let pending = 0;
    const prep = s.stations[PREP_STATION];
    if (prep) for (const sl of prep.slots) if (sl.st !== 'empty' && sl.item === item) pending += def.prep.yield;
    out.push({
      item, name: def.name, te: def.te, n, fresh, pending, cost: def.cost,
      out: n < minUse(item, s.cfg.menu), low: n <= STOCK_LOW, sour: fresh !== null && fresh < FERMENT.sour,
    });
  }
  return out;
}

export const gasOn = (s) => !s.cfg.gas || (!!s.gas && s.gas.u > 0 && s.gas.sw === 0);

/** `{ on, units, cap, frac, low, out, swapping, swapLeft, swapCost, swapTicks }` or null when the level has no cylinder. */
export function gasInfo(s) {
  if (!s || !s.cfg || !s.cfg.gas || !s.gas) return null;
  const frac = clamp(s.gas.u / GAS.cap, 0, 1);
  return {
    on: gasOn(s), units: s.gas.u, cap: GAS.cap, frac, low: frac <= GAS.lowFrac, out: s.gas.u <= 0, swapping: s.gas.sw > 0, swapLeft: s.gas.sw,
    swapCost: GAS.swapCost, swapTicks: GAS.swapTicks, canSwap: s.gas.sw === 0 && s.gas.u <= GAS.cap * GAS.swapMaxFrac,
  };
}

const needOf = (st) => {
  if (typeof st.water === 'number') return clamp((HEAT.waterStart - st.water) / (HEAT.waterStart - HEAT.waterDry), 0, 1);
  if (typeof st.heat === 'number') return clamp(Math.max(Math.abs(st.heat - HEAT.ideal) / (HEAT.ideal - HEAT.cold), (st.gunk || 0) / HEAT.torn), 0, 1);
  return 0;
};

/** `{ kind: 'heat'|'water', need 0..1, value, band: 'cold'|'ideal'|'hot'|'dry', stuck, torn, tendAt, sinceTend, canTend }` or null (nothing to tend). */
export function tendInfo(s, stationId) {
  if (!s || !s.cfg || !s.cfg.heat || typeof stationId !== 'string' || !hasOwn(s.stations, stationId)) return null;
  const st = s.stations[stationId];
  if (!hasOwn(HEATED, st.kind)) return null;
  const water = HEATED[st.kind] === 'water';
  const value = water ? st.water : st.heat;
  const need = needOf(st);
  return {
    kind: water ? 'water' : 'heat', need, value, band: bandOf(st), stuck: (st.gunk || 0) >= HEAT.stick, torn: (st.gunk || 0) >= HEAT.torn,
    tendAt: st.tendAt, sinceTend: s.tick - st.tendAt, canTend: need >= HEAT.tendMin,
  };
}

function bandOf(st) {
  if (typeof st.water === 'number') return st.water < HEAT.waterDry ? 'dry' : 'ideal';
  if (typeof st.heat === 'number') return st.heat < HEAT.cold ? 'cold' : st.heat > HEAT.hot ? 'hot' : 'ideal';
  return 'ideal';
}

/** How a station is running right now: `run` false = nothing progresses (no gas, power cut, steamer dry); `slow` = half speed; `fast` = burns 1.5x. */
export function paceMods(s, st) {
  const m = { run: true, slow: false, fast: false };
  if (!s.cfg.gas && !s.cfg.heat && !s.events.length) return m;
  if (s.cfg.gas && !gasOn(s)) m.run = false;
  if (st.kind === 'steamer' && isDown(s, 'steamer')) m.run = false;
  if (s.cfg.heat) {
    if (st.kind === 'steamer') {
      if (st.water <= 0) m.run = false;
      else if (st.water < HEAT.waterDry) m.slow = true;
    } else if (st.kind === 'tawa' || st.kind === 'kadai') {
      if (st.heat < HEAT.cold) m.slow = true;
      else if (st.heat > HEAT.hot) m.fast = true;
    }
  }
  return m;
}

function prepMods(s, sl) {
  const needs = sl.item && INGREDIENTS[sl.item] ? INGREDIENTS[sl.item].prep.needs : null;
  if (needs === 'power') return !isDown(s, 'grinder');
  if (needs === 'gas') return !s.cfg.gas || gasOn(s);
  return true;
}

/** What `cook` would be refused for besides the usual slot / menu checks (null = fine). The bot uses the same function. */
export function cookBlocker(s, station, dishId) {
  const dish = DISHES[dishId];
  if (s.cfg.gas && !gasOn(s)) return s.gas.sw > 0 ? 'The cylinder is being changed' : 'No gas: change the cylinder';
  if (station.kind === 'steamer') {
    if (isDown(s, 'steamer')) return 'Power cut: the steamer is off';
    if (s.cfg.heat && station.water <= 0) return 'The steamer is dry: top up the water';
  }
  if (s.cfg.stock) {
    for (const [item, q] of Object.entries(dish.uses)) {
      if (!(s.stock[item] >= q)) return `Out of ${INGREDIENTS[item].name.toLowerCase()}`;
    }
  }
  return null;
}

/** The first ingredient a dish is short of right now, or null. */
export function shortOf(s, dishId) {
  if (!s.cfg.stock) return null;
  for (const [item, q] of Object.entries(DISHES[dishId].uses)) if (!(s.stock[item] >= q)) return item;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// stock movements

function stockEdges(s, item, before, ev) {
  const after = s.stock[item];
  const mu = minUse(item, s.cfg.menu);
  if (before >= mu && after < mu) ev.push({ type: 'stock-out', item });
  else if (before > STOCK_LOW && after <= STOCK_LOW) ev.push({ type: 'stock-low', item, n: after });
}

/** Take an item out of stock; returns the ingredient value (rupees at the unit cost) and charges the unpaid part. */
function withdraw(s, item, qty, ev) {
  const before = s.stock[item];
  s.stock[item] = r2(Math.max(0, before - qty));
  const value = qty * INGREDIENTS[item].cost;
  const fromPaid = Math.min(s.pre, value); // the prepaid part of the shelf is used first, the rest is bought now
  s.pre = r2(s.pre - fromPaid);
  spend(s, value - fromPaid);
  stockEdges(s, item, before, ev);
  return value;
}

/** A dish goes on: uses its ingredients (and chills the pan, builds gunk, and may start out sour). Returns the slot flaw bits. */
export function consumeFor(s, station, dishId, ev) {
  let fl = 0;
  if (s.cfg.stock) {
    for (const [item, q] of Object.entries(DISHES[dishId].uses)) {
      if (typeof s.fresh[item] === 'number' && s.fresh[item] < FERMENT.sour) fl |= 4;
      withdraw(s, item, q, ev);
    }
  }
  if (s.cfg.heat) {
    if (station.kind === 'tawa' || station.kind === 'kadai') {
      const before = bandOf(station);
      station.heat = clamp(station.heat - HEAT.pourCool[station.kind], 0, 100);
      station.gunk = Math.min(100, station.gunk + HEAT.gunkPerCook);
      const after = bandOf(station);
      if (after !== before && after !== 'ideal') ev.push({ type: 'heat-warning', station: station.id, band: after });
    } else if (station.kind === 'steamer') {
      station.gunk = Math.min(100, station.gunk + 1);
    }
  }
  return fl;
}

/** Rupees of ingredients in a dish that is binned (burnt or discarded) count as waste. */
export function binDish(s, dishId) {
  if (s.cfg.stock) wasteOnly(s, dishCost(dishId));
}

/** Flaw bits of a dish that has just finished on this station. */
export function flawsAtReady(s, st) {
  if (!s.cfg.heat) return 0;
  let fl = 0;
  if (st.kind === 'tawa' || st.kind === 'kadai') {
    if (st.gunk >= HEAT.torn) fl |= 2;
    else if (st.gunk >= HEAT.stick || st.heat < HEAT.cold) fl |= 1;
  } else if (st.kind === 'steamer') {
    if (st.water < HEAT.waterDry) fl |= 1;
  }
  return fl;
}

export const flawName = (fl) => (fl & 2 ? 'torn' : fl & 1 ? 'stuck' : fl & 4 ? 'sour' : null);

// ---------------------------------------------------------------------------------------------------------------------
// the sold-out board and which dishes can be promised

export const unmetOf = (c) => {
  const out = c.order.slice();
  for (const d of c.got) {
    const i = out.indexOf(d);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
};

/** Portions of each ingredient already promised to waiting customers (their unmet dishes minus what is cooking, ready or in hand). */
export function reservedUses(s, skipId = null) {
  const supply = {};
  const add = (d) => { supply[d] = (supply[d] || 0) + 1; };
  for (const id of s.order) for (const h of s.players[id].hands) add(h.dish);
  for (const sid of s.cfg.stations) {
    const st = s.stations[sid];
    if (st.kind === PREP_KIND) continue;
    for (const sl of st.slots) if (sl.st === 'cooking' || sl.st === 'ready') add(sl.dish);
  }
  const res = {};
  for (const c of s.customers) {
    if (c.st !== 'waiting' || c.id === skipId) continue;
    for (const d of unmetOf(c)) {
      if (supply[d] > 0) { supply[d] -= 1; continue; }
      for (const [item, q] of Object.entries(DISHES[d].uses || {})) res[item] = (res[item] || 0) + q;
    }
  }
  return res;
}

const canPromise = (s, d, res) => {
  if (s.off.includes(d)) return false;
  if (!s.cfg.stock) return true;
  for (const [item, q] of Object.entries(DISHES[d].uses)) if ((s.stock[item] || 0) - (res[item] || 0) < q) return false;
  return true;
};

const commit = (d, res) => {
  for (const [item, q] of Object.entries(DISHES[d].uses || {})) res[item] = (res[item] || 0) + q;
};

/**
 * What a new arrival may order given the board and the stock. Each wanted dish that cannot be promised is swapped for another dish
 * (same station kind first) or dropped; an empty order = the customer leaves politely (no life lost). Returns { order, swaps, left }.
 * `swaps` = [{ dish, swap: dishId|null }].
 */
export function fitOrder(s, wanted, salt, skipId = null) {
  if (!s.cfg.stock && !s.off.length) return { order: wanted.slice(), swaps: [], left: false };
  const res = reservedUses(s, skipId);
  const order = [];
  const swaps = [];
  wanted.forEach((d, i) => {
    if (canPromise(s, d, res)) { order.push(d); commit(d, res); return; }
    const kind = DISHES[d].station;
    const cands = s.cfg.menu.filter((x) => x !== d && order.filter((y) => y === x).length < 2 && canPromise(s, x, res));
    cands.sort((a, b) => (DISHES[b].station === kind) - (DISHES[a].station === kind) || (a < b ? -1 : 1));
    const same = cands.filter((x) => DISHES[x].station === kind);
    const pool = same.length ? same : cands;
    if (pool.length) {
      const pick = pool[(salt + i) % pool.length];
      order.push(pick);
      commit(pick, res);
      swaps.push({ dish: d, swap: pick });
    } else swaps.push({ dish: d, swap: null });
  });
  return { order, swaps, left: order.length === 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// action handlers: (s, a, ev, p) => error string | undefined

const asStation = (s, a, kind) => {
  if (typeof a.station !== 'string' || !hasOwn(s.stations, a.station)) return null;
  const st = s.stations[a.station];
  return kind && st.kind !== kind ? null : st;
};
const asSlot = (st, a) => (Number.isInteger(a.slot) && a.slot >= 0 && a.slot < st.slots.length ? st.slots[a.slot] : null);

/** Per-player operations counters [prepped, tended, gas swaps, bought], created the first time a player does one. */
const bump = (p, i) => {
  if (!p.ops) p.ops = [0, 0, 0, 0];
  p.ops[i] += 1;
};

export const OPS_H = {
  prep(s, a, ev, p) {
    if (s.cfg.tutorial && !s.cfg.stock) return TUTORIAL_NO; // the training shift has the back counter only once `tutorial-flags {stock}` switched it on
    if (!s.cfg.stock) return 'Nothing to prepare today';
    const st = asStation(s, a, PREP_KIND);
    if (!st) return 'No prep counter';
    const sl = asSlot(st, a);
    if (!sl) return 'No such slot';
    if (typeof a.item !== 'string' || !hasOwn(INGREDIENTS, a.item) || !hasOwn(s.stock, a.item)) return 'Not needed today';
    if (sl.st !== 'empty') return 'That job is busy';
    const def = INGREDIENTS[a.item];
    let pending = 0;
    for (const j of st.slots) if (j.st !== 'empty' && j.item === a.item) pending += def.prep.yield;
    if (s.stock[a.item] + pending + def.prep.yield > STOCK_CAP) return 'The shelf is full';
    sl.st = 'cooking'; sl.item = a.item; sl.t0 = s.tick; sl.readyAt = s.tick + def.prep.ticks; sl.by = p.id;
    spend(s, def.prep.yield * def.cost);
    bump(p, 0);
    ev.push({ type: 'prep-start', station: st.id, slot: a.slot, item: a.item, n: def.prep.yield, ticks: def.prep.ticks, by: p.id });
    return undefined;
  },

  collectPrep(s, a, ev, p) {
    if (s.cfg.tutorial && !s.cfg.stock) return TUTORIAL_NO;
    const st = asStation(s, a, PREP_KIND);
    if (!st) return 'No prep counter';
    const sl = asSlot(st, a);
    if (!sl) return 'No such slot';
    if (sl.st === 'cooking') return 'Not ready yet';
    if (sl.st !== 'ready') return 'Nothing there';
    const item = sl.item;
    const n = INGREDIENTS[item].prep.yield;
    addStock(s, item, n, true);
    sl.st = 'empty'; sl.item = null; delete sl.t0; delete sl.readyAt; delete sl.by;
    ev.push({ type: 'prep-collect', station: st.id, slot: a.slot, item, n, by: p.id });
    return undefined;
  },

  buy(s, a, ev, p) {
    if (s.cfg.tutorial && !s.cfg.market) return TUTORIAL_NO;
    if (!s.cfg.market) return 'Nobody to send to the market';
    if (typeof a.item !== 'string' || !hasOwn(INGREDIENTS, a.item) || !hasOwn(s.stock, a.item)) return 'Not needed today';
    if (!Number.isInteger(a.n) || a.n < 1 || a.n > MARKET_MAX) return 'Buy 1 to ' + MARKET_MAX;
    let pending = 0;
    const prep = s.stations[PREP_STATION];
    for (const j of prep.slots) if (j.st !== 'empty' && j.item === a.item) pending += INGREDIENTS[a.item].prep.yield;
    if (s.stock[a.item] + pending + a.n > STOCK_CAP) return 'The shelf is full';
    const price = Math.ceil(a.n * INGREDIENTS[a.item].cost * MARKET_MARKUP);
    spend(s, price);
    addStock(s, a.item, a.n, true);
    bump(p, 3);
    ev.push({ type: 'buy', item: a.item, n: a.n, cost: price, by: p.id });
    return undefined;
  },

  tend(s, a, ev, p) {
    if (!s.cfg.heat) return 'Nothing to tend here';
    const st = asStation(s, a, null);
    if (!st || !hasOwn(HEATED, st.kind)) return 'Nothing to tend here';
    if (needOf(st) < HEAT.tendMin) return 'Already clean';
    if (HEATED[st.kind] === 'water') st.water = HEAT.waterStart;
    else st.heat = HEAT.ideal;
    st.gunk = 0;
    st.tendAt = s.tick;
    bump(p, 1);
    ev.push({ type: 'tend', station: st.id, kind: st.kind === 'steamer' ? 'water' : st.kind === 'kadai' ? 'skim' : 'wipe', by: p.id });
    return undefined;
  },

  swapGas(s, a, ev, p) {
    if (!s.cfg.gas) return 'No cylinder here';
    if (s.gas.sw > 0) return 'Already changing the cylinder';
    if (s.gas.u > GAS.cap * GAS.swapMaxFrac) return 'The cylinder is still heavy';
    s.gas.sw = GAS.swapTicks;
    spend(s, GAS.swapCost);
    bump(p, 2);
    ev.push({ type: 'gas-swap', phase: 'start', ticks: GAS.swapTicks, cost: GAS.swapCost, by: p.id });
    return undefined;
  },
};

/** Add portions (a prep job collected or a market run); batter freshness is the weighted mean of what was there and the new 100. */
function addStock(s, item, n, paid) {
  const have = s.stock[item];
  if (typeof s.fresh[item] === 'number') s.fresh[item] = Math.round((s.fresh[item] * have + 100 * n) / (have + n));
  s.stock[item] = r2(have + n);
  if (paid) s.pre = r2(s.pre + n * INGREDIENTS[item].cost);
}

// ---------------------------------------------------------------------------------------------------------------------
// the per-tick part of the layer. Called by the engine right after the tick counter moves, BEFORE dishes change state.

export function tickOps(s, ev) {
  // 1. the cylinder: a swap in progress, then the burners burn gas for every station that is cooking
  if (s.cfg.gas) {
    const g = s.gas;
    if (g.sw > 0) {
      g.sw -= 1;
      if (g.sw === 0) {
        g.u = GAS.cap;
        ev.push({ type: 'gas-swap', phase: 'done', units: g.u });
      }
    } else if (g.u > 0) {
      const before = g.u;
      let burners = 0;
      for (const sid of s.cfg.stations) {
        const st = s.stations[sid];
        if (st.kind === PREP_KIND) {
          for (const sl of st.slots) if (sl.st === 'cooking' && sl.item && INGREDIENTS[sl.item].prep.needs === 'gas') burners += 1;
        } else if (st.slots.some((sl) => sl.st === 'cooking') && paceMods(s, st).run) burners += 1;
      }
      g.u = Math.max(0, g.u - burners * GAS.drain);
      const low = GAS.cap * GAS.lowFrac;
      if (before > low && g.u <= low && g.u > 0) ev.push({ type: 'gas-low', units: g.u });
      if (before > 0 && g.u === 0) ev.push({ type: 'gas-out' });
    }
  }
  // 2. the pans: busy ones chill and recover, idle ones creep hotter; the steamer boils its water away
  if (s.cfg.heat) {
    const burning = gasOn(s);
    for (const sid of s.cfg.stations) {
      const st = s.stations[sid];
      if (!hasOwn(HEATED, st.kind) || !burning) continue;
      const cooking = st.slots.some((sl) => sl.st === 'cooking');
      const before = bandOf(st);
      if (st.kind === 'steamer') {
        if (cooking && !isDown(s, 'steamer')) st.water = Math.max(0, st.water - HEAT.waterDrain);
      } else if (cooking) {
        if (st.heat > HEAT.ideal) st.heat = Math.max(HEAT.ideal, st.heat - HEAT.recover);
        else if (st.heat < HEAT.ideal) st.heat = Math.min(HEAT.ideal, st.heat + HEAT.recover);
      } else if (s.tick % HEAT.idleEvery === 0) st.heat = Math.min(100, st.heat + HEAT.idleRise);
      const after = bandOf(st);
      if (after !== before && after !== 'ideal' && (cooking || st.slots.some((sl) => sl.st === 'ready'))) {
        ev.push({ type: 'heat-warning', station: sid, band: after });
      }
    }
  }
  // 3. batter ferments (and, far too late, spoils)
  if (s.cfg.stock) {
    const every = FERMENT.every[daypartOf(s.cfg.hour[0] + (s.cfg.hour[1] - s.cfg.hour[0]) * clamp(s.tick / s.shiftTicks, 0, 1))] || 2;
    if (s.tick % every === 0) {
      for (const item of Object.keys(s.fresh)) {
        if (!(s.stock[item] > 0)) continue;
        const before = s.fresh[item];
        s.fresh[item] = before - 1;
        if (before >= FERMENT.sour && s.fresh[item] < FERMENT.sour) ev.push({ type: 'batter-sour', item });
        if (s.fresh[item] <= FERMENT.spoil) {
          const n = s.stock[item];
          const value = n * INGREDIENTS[item].cost;
          const pre = Math.min(s.pre, value);
          spend(s, value - pre, true);
          wasteOnly(s, pre);
          s.pre = r2(s.pre - pre);
          s.stock[item] = 0; s.fresh[item] = 100;
          ev.push({ type: 'stock-spoiled', item, n });
          ev.push({ type: 'stock-out', item });
        }
      }
    }
  }
  // 4. back-counter jobs: paused by a power cut (grinder) or no gas (pots), otherwise they finish
  if (s.cfg.stock) {
    const st = s.stations[PREP_STATION];
    for (let i = 0; i < st.slots.length; i++) {
      const sl = st.slots[i];
      if (sl.st !== 'cooking') continue;
      if (!prepMods(s, sl)) { sl.t0 += 1; sl.readyAt += 1; continue; }
      if (s.tick >= sl.readyAt) {
        sl.st = 'ready';
        ev.push({ type: 'prep-done', station: PREP_STATION, slot: i, item: sl.item, n: INGREDIENTS[sl.item].prep.yield });
      }
    }
  }
}

/** Short list of what the stall needs doing, most urgent first: [{ type: 'gas'|'stock'|'tend'|'collect-prep'|'inspector', ..., urgency 0..1 }]. */
export function needs(s) {
  const out = [];
  if (!s || !s.cfg || s.status !== 'playing') return out;
  const g = gasInfo(s);
  if (g && !g.swapping && g.frac <= GAS.lowFrac * 1.5) out.push({ type: 'gas', urgency: g.out ? 1 : clamp(1 - g.frac / (GAS.lowFrac * 1.5), 0.3, 0.95), frac: g.frac });
  for (const it of stockInfo(s)) {
    if (it.pending) continue;
    if (it.out) out.push({ type: 'stock', item: it.item, urgency: 0.95 });
    else if (it.low) out.push({ type: 'stock', item: it.item, urgency: 0.6 });
    else if (it.sour) out.push({ type: 'stock', item: it.item, urgency: 0.5, sour: true });
  }
  if (s.cfg.stock) {
    const prep = s.stations[PREP_STATION];
    prep.slots.forEach((sl, slot) => { if (sl.st === 'ready') out.push({ type: 'collect-prep', station: PREP_STATION, slot, item: sl.item, urgency: 0.7 }); });
  }
  if (s.cfg.heat) {
    for (const sid of s.cfg.stations) {
      const t = tendInfo(s, sid);
      if (t && t.canTend) out.push({ type: 'tend', station: sid, urgency: t.need * 0.9, band: t.band });
    }
  }
  if (s.events.some((e) => e.id === 'inspector')) out.push({ type: 'inspector', urgency: 0.85 });
  return out.sort((a, b) => b.urgency - a.urgency);
}

/** Does a customer's extra (chutney / sambar) come out of the stock? true = given (and charged). */
export function useExtra(s, item, qty, ev) {
  if (!s.cfg.stock || !hasOwn(s.stock, item) || !(s.stock[item] >= qty)) return false;
  withdraw(s, item, qty, ev);
  return true;
}
