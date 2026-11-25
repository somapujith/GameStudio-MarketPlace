// Tiffin Centre: the pure rules engine (docs/TIFFIN_CENTRE_PLAN.md sections 3 and 3b). State is plain JSON, advances only through
// `applyAction` (players) and the `tick` action (once per TICK_MS, from the room server or the local runner), and is
// deterministic: same seed + same actions = same game. No Date, no Math.random, no Map/Set in state.
//
// Contract notes for the other packages:
//  - invalid actions return the SAME state object, `events: []` and an `error` string; nothing here throws on hostile input.
//  - `tick` may carry `tick: n`; it is then only applied when state.tick === n (so a duplicated tick is a harmless no-op).
//  - `tutorial-flags {patience, pay}`: a boolean says whether that clock RUNS (false = frozen). Tutorial games start frozen.
//  - tutorial games (level 0) have no scheduled crowd: customers come only from `spawn {customer}`, and none of the operations layer
//    (stock, gas, heat, events, requests, the board) exists there: it plays exactly as it did before that layer was added.
import {
  CUSTOMER_KINDS, CUSTOMER_NAMES, DAYPARTS, DISHES, EAT_TICKS, HANDS_MAX, LIVES, MAX_LEVEL, PACE, PATIENCE_REFILL, PAY_WINDOW,
  ARRIVAL_RETRY, REQUEST, STATIONS, STATION_KINDS, TICK_MS, daypartOf, levelDef, levelOps,
} from './catalog.js';
import { seedToUint32 } from '../rng.js';
import { billOf, comboBonus, flawedQuality, priceOf, qualityOf, standingsOf, starsFor, tipFor } from './scoring.js';
import { fillSchedule, isWeekend, menuFor, patienceFor, seedRegulars } from './schedule.js';
import { validTarget } from './movement.js';
import { carryOver, earn, profitOf, summary } from './economy.js';
import { tickEvents, tipMult } from './events.js';
import {
  OPS_H, binDish, consumeFor, cookBlocker, fitOrder, flawName, flawsAtReady, opsInit, paceMods, tickOps, unmetOf, useExtra,
} from './ops.js';

export const STATE_VERSION = 1;
export const EMOTES = ['thumbs', 'fire', 'help', 'thanks'];
export const MAX_PLAYERS = 4;
const PRUNE_AFTER = 3; // ticks a customer who left stays in the state (the walk-out animation)
const OVERTIME_CAP = 150; // ticks past the shift end after which stragglers are sent home (only reachable with frozen tutorial clocks)
const EMOTE_KEEP = 4;
const EMOTE_TTL = 6;
const NOOP = Symbol('noop');
const TRAINING = 'Not available in the training shift';

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// Deep copy of plain JSON data (several times faster than a JSON round trip, and the engine clones on every action).
function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = clone(v[i]);
    return out;
  }
  const out = {};
  for (const k in v) out[k] = clone(v[k]);
  return out;
}
const isStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;

const emptySlot = () => ({ st: 'empty', dish: null, t0: 0, readyAt: 0, burnAt: 0, by: null });
function clearSlot(sl) {
  sl.st = 'empty'; sl.dish = null; sl.t0 = 0; sl.readyAt = 0; sl.burnAt = 0; sl.by = null;
  delete sl.fl;
}

// ---------------------------------------------------------------------------------------------------------------------
// creation

/** Build a fresh game. Unknown settings fall back to the defaults (level 1, normal pace); level 0 is the tutorial. */
export function createGame({ players = [], settings = {}, seed } = {}) {
  const st = settings && typeof settings === 'object' ? settings : {};
  // Level 0 (the scripted tutorial: no lives, frozen clocks, `spawn` accepted) only when asked for with the number 0;
  // anything else that is not a real level 1..12 (-4, '', [], false, NaN) becomes a real level.
  let lv = 0;
  if (st.level !== 0) {
    const t = Math.trunc(Number(st.level));
    lv = Math.max(1, Math.min(MAX_LEVEL, Number.isFinite(t) ? t : 1));
  }
  const level = levelDef(lv);
  const pace = typeof st.pace === 'string' && hasOwn(PACE, st.pace) ? st.pace : 'normal';
  const tutorial = !!level.tutorial;

  const ps = {};
  const order = [];
  for (const raw of Array.isArray(players) ? players : []) {
    if (!raw || !isStr(raw.id) || raw.id === '__proto__' || hasOwn(ps, raw.id) || order.length >= MAX_PLAYERS) continue;
    ps[raw.id] = {
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name.slice(0, 40) : raw.id,
      avatar: typeof raw.avatar === 'string' || (typeof raw.avatar === 'number' && Number.isFinite(raw.avatar)) ? raw.avatar : null,
      at: null, hands: [], served: 0, collected: 0, earned: 0, tips: 0, // (+ ops: [prepped, tended, gas swaps, bought] once a player does one)
    };
    order.push(raw.id);
  }

  const stations = {};
  for (const id of level.stations) {
    const kind = STATIONS[id].kind;
    stations[id] = { id, kind, slots: Array.from({ length: STATION_KINDS[kind].slots }, emptySlot) };
  }

  const keptSeed = typeof seed === 'string' || (typeof seed === 'number' && Number.isFinite(seed)) ? seed : 1;
  const menu = menuFor(level);
  const s = {
    v: STATE_VERSION, status: 'playing', level: lv, pace, tick: 0, shiftTicks: level.shiftTicks, seed: keptSeed,
    cfg: {
      tutorial, spots: level.spots, stations: level.stations.slice(), menu, hour: level.hour.slice(),
      noPatience: tutorial, noPayExpiry: tutorial,
    },
    rng: seedToUint32(keptSeed), genAt: tutorial ? null : 2, nid: 1,
    players: ps, order, stations, customers: [], schedule: [], nextArrival: null,
    money: 0, tips: 0, served: 0, paid: 0, lost: 0, unpaid: 0, combo: 0, lives: LIVES, stars: 0, emotes: [],
    // the operations layer (all neutral at level 0)
    revenue: 0, cost: 0, waste: 0, profit: 0, bestCombo: 0, // (+ fines, carry when they happen)
    stock: {}, pre: 0, fresh: {}, gas: null, off: [], events: [], regs: [],
  };
  opsInit(s, level, levelOps(lv), menu, order.length, pace);
  s.cfg.weekend = !tutorial && isWeekend(keptSeed);
  seedRegulars(s);
  fillSchedule(s);
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// read-only helpers (the scene, HUD and bot use these)

export const isOver = (s) => !!s && s.status !== 'playing';
export const livesLeft = (s) => s.lives;
export const shiftProgress = (s) => Math.max(0, Math.min(1, s.tick / s.shiftTicks));
export const secondsLeft = (s) => (Math.max(0, s.shiftTicks - s.tick) * TICK_MS) / 1000;
export function hourOf(s) {
  const [a, b] = s.cfg.hour;
  return a + (b - a) * shiftProgress(s);
}
export const daypartId = (s) => daypartOf(hourOf(s));
export const daypartInfo = (s) => DAYPARTS[daypartId(s)];

/**
 * { st, dish, progress 0..1 (cooking), age (ticks since ready), burnLeft (ticks until it burns) } or null for a bad slot.
 * Extra keys appear only when they apply: `flaw` ('stuck' | 'torn' | 'sour', on a cooking / ready dish) and `item` (a prep job's ingredient).
 */
export function slotInfo(s, stationId, slot) {
  if (!s || typeof stationId !== 'string' || !hasOwn(s.stations, stationId)) return null;
  const sl = s.stations[stationId].slots[slot];
  if (!sl) return null;
  const span = sl.readyAt - sl.t0;
  const info = {
    st: sl.st,
    dish: sl.dish === undefined ? null : sl.dish,
    progress: sl.st === 'cooking' ? Math.max(0, Math.min(1, span > 0 ? (s.tick - sl.t0) / span : 1)) : sl.st === 'empty' ? 0 : 1,
    age: sl.st === 'ready' || sl.st === 'burnt' ? s.tick - sl.readyAt : 0,
    burnLeft: sl.st === 'ready' && sl.dish ? Math.max(0, sl.burnAt - s.tick) : 0,
  };
  if (sl.item) info.item = sl.item;
  if (sl.fl) info.flaw = flawName(sl.fl);
  return info;
}

/** The dishes a customer still has to receive (order minus what they got). */
export function needsOf(c) {
  return unmetOf(c);
}

export function customerInfo(s, id) {
  const c = s && Array.isArray(s.customers) ? s.customers.find((x) => x.id === id) : null;
  if (!c) return null;
  const info = {
    patienceFrac: c.patienceMax > 0 ? Math.max(0, Math.min(1, c.patience / c.patienceMax)) : 0,
    payFrac: c.st === 'paying' ? Math.max(0, Math.min(1, c.payLeft / PAY_WINDOW)) : 0,
    needs: needsOf(c),
  };
  for (const k of ['parcel', 'extra', 'spice', 'regular', 'loyal', 'big', 'delivery']) if (c[k] !== undefined && c[k] !== false) info[k] = c[k];
  if (c.st === 'waiting' && s.cfg.stock) {
    const blocked = info.needs.filter((d, i) => info.needs.indexOf(d) === i && s.stock && DISHES[d].uses && Object.entries(DISHES[d].uses).some(([it, q]) => !(s.stock[it] >= q)));
    if (blocked.length) info.blocked = blocked;
  }
  return info;
}

export function result(s) {
  const stars = s.status === 'playing' ? starsFor(s.level, s.pace, s.order.length, profitOf(s)) : s.stars;
  const standings = standingsOf(s.players, s.order, stars);
  const reason = s.cfg.tutorial ? 'tutorial' : stars >= 1 ? 'cleared' : 'closed';
  const sum = summary(s);
  const team = {
    served: s.served, paid: s.paid, lost: s.lost, unpaid: s.unpaid, bestCombo: s.bestCombo, tips: sum.tips, revenue: sum.revenue,
    cost: sum.cost, waste: sum.waste, fines: sum.fines, profit: sum.profit,
    prepped: 0, tended: 0, gasSwaps: 0, bought: 0,
  };
  for (const id of s.order) {
    const p = s.players[id];
    if (p.ops) { team.prepped += p.ops[0]; team.tended += p.ops[1]; team.gasSwaps += p.ops[2]; team.bought += p.ops[3]; }
  }
  return {
    winnerId: stars >= 1 && standings.length ? standings[0].id : null, reason, standings, stars, money: s.money, level: s.level,
    ...sum, served: s.served, lost: s.lost, unpaid: s.unpaid, bestCombo: s.bestCombo, combo: s.bestCombo, stats: team, team,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// internals

function freeSpot(s) {
  const taken = new Set();
  for (const c of s.customers) if (c.st !== 'left') taken.add(c.spot);
  for (let i = 0; i < s.cfg.spots; i++) if (!taken.has(i)) return i;
  return -1;
}

function seat(s, e, spot, ev) {
  const id = s.nid++;
  const order = e.order.slice();
  const c = {
    id, name: e.name, kind: e.kind, look: e.look, spot, st: 'waiting', order, got: [], arrivedAt: s.tick,
    patience: e.patienceMax, patienceMax: e.patienceMax, eatLeft: 0, payLeft: 0,
    total: billOf(order) + (e.parcel ? REQUEST.parcelFee * order.length : 0), tip: 0,
    outcome: null, qs: [], leftAt: null,
  };
  if (e.parcel) c.parcel = true;
  if (e.extra) c.extra = e.extra;
  if (e.spice) c.spice = e.spice;
  if (e.big) c.big = true;
  if (e.delivery) c.delivery = true;
  if (e.regular && s.regs[e.rid]) { c.regular = true; c.rid = e.rid; c.loyal = s.regs[e.rid][0]; }
  s.customers.push(c);
  ev.push({ type: 'customer-arrive', customer: id, spot });
  return id;
}

function resetCombo(s, ev) {
  if (s.combo > 0) {
    s.combo = 0;
    ev.push({ type: 'combo', combo: 0 });
  }
}

function leave(s, c, outcome, ev) {
  c.st = 'left'; c.outcome = outcome; c.leftAt = s.tick;
  if (c.regular && s.regs[c.rid]) s.regs[c.rid][0] = outcome === 'paid' ? Math.min(REQUEST.regularMax, s.regs[c.rid][0] + 1) : 0;
  if (outcome === 'paid') return;
  resetCombo(s, ev);
  if (outcome === 'angry') {
    s.lost += 1;
    ev.push({ type: 'customer-angry', customer: c.id });
  } else {
    s.unpaid += 1;
    ev.push({ type: 'customer-unpaid', customer: c.id, owed: c.total });
  }
  if (!s.cfg.tutorial) {
    s.lives = Math.max(0, s.lives - 1);
    ev.push({ type: 'life-lost', lives: s.lives });
  }
}

/** A customer whose dishes cannot be had walks off politely: no life, no combo lost. */
function politeLeave(s, c) {
  c.st = 'left'; c.outcome = 'soldout'; c.leftAt = s.tick;
}

function finish(s, status, ev) {
  s.status = status;
  carryOver(s);
  s.stars = status === 'closed' ? 0 : starsFor(s.level, s.pace, s.order.length, profitOf(s));
  s.schedule = []; s.genAt = null; s.nextArrival = null;
  ev.push({ type: 'shift-end', status, stars: s.stars });
}

function checkEnd(s, ev) {
  if (s.status !== 'playing') return;
  if (!s.cfg.tutorial && s.lives <= 0) return finish(s, 'closed', ev);
  if (s.tick < s.shiftTicks) return;
  if (s.customers.every((c) => c.st === 'left')) return finish(s, 'done', ev);
  if (s.tick >= s.shiftTicks + OVERTIME_CAP) {
    for (const c of s.customers) if (c.st !== 'left') { c.st = 'left'; c.outcome = 'unpaid'; c.leftAt = s.tick; }
    finish(s, 'done', ev);
  }
}

function tickStations(s, ev) {
  for (const sid of s.cfg.stations) {
    const station = s.stations[sid];
    if (station.kind === 'prep') continue; // the back counter runs its own jobs (tickOps)
    const m = paceMods(s, station);
    const slots = station.slots;
    for (let i = 0; i < slots.length; i++) {
      const sl = slots[i];
      if (sl.st === 'cooking' || sl.st === 'ready') {
        if (!m.run || (sl.st === 'cooking' && m.slow && s.tick % 2 === 0)) {
          // no gas / no power / a cold pan: the dish does not move on this tick
          if (sl.st === 'cooking') sl.t0 += 1;
          sl.readyAt += 1; sl.burnAt += 1;
          continue;
        }
        if (sl.st === 'ready' && m.fast && s.tick % 2 === 0) sl.burnAt -= 1; // a too-hot pan burns food 1.5x as fast
      }
      if (sl.st === 'cooking' && s.tick >= sl.readyAt) {
        sl.st = 'ready';
        const fl = flawsAtReady(s, station);
        if (fl) sl.fl = (sl.fl || 0) | fl;
        const flaw = sl.fl ? flawName(sl.fl) : null;
        ev.push(flaw ? { type: 'ready', station: sid, slot: i, dish: sl.dish, flaw } : { type: 'ready', station: sid, slot: i, dish: sl.dish });
      }
      if (sl.st === 'ready' && s.tick >= sl.burnAt) {
        sl.st = 'burnt';
        binDish(s, sl.dish);
        ev.push({ type: 'burnt', station: sid, slot: i, dish: sl.dish });
      }
    }
  }
}

function tickCustomers(s, ev) {
  for (const c of s.customers.slice()) {
    if (c.st === 'waiting') {
      if (s.cfg.noPatience) continue;
      c.patience -= 1;
      if (c.patience <= 0) { c.patience = 0; leave(s, c, 'angry', ev); }
    } else if (c.st === 'eating') {
      c.eatLeft -= 1;
      if (c.eatLeft <= 0) {
        c.eatLeft = 0; c.st = 'paying'; c.payLeft = PAY_WINDOW;
        ev.push({ type: 'pay-ready', customer: c.id });
      }
    } else if (c.st === 'paying') {
      if (s.cfg.noPayExpiry) continue;
      c.payLeft -= 1;
      if (c.payLeft === 3) ev.push({ type: 'pay-warning', customer: c.id });
      if (c.payLeft <= 0) { c.payLeft = 0; leave(s, c, 'unpaid', ev); }
    }
  }
  s.customers = s.customers.filter((c) => c.st !== 'left' || s.tick - c.leftAt < PRUNE_AFTER);
}

/** Seat a scheduled arrival (or send them away politely when the board / stock leaves nothing they can have). */
function admit(s, e, spot, ev) {
  const fit = fitOrder(s, e.order, s.nid);
  if (fit.left) {
    const id = s.nid++;
    ev.push({ type: 'sold-out', customer: id, dish: e.order[0], swap: null, left: true });
    return;
  }
  const id = seat(s, { ...e, order: fit.order }, spot, ev);
  for (const w of fit.swaps) ev.push({ type: 'sold-out', customer: id, dish: w.dish, swap: w.swap, left: false });
  if (e.big) ev.push({ type: 'parcel-order', customer: id, n: fit.order.length, big: true });
}

function tickArrivals(s, ev) {
  if (s.tick >= s.shiftTicks) {
    s.schedule = []; s.genAt = null; s.nextArrival = null;
    return;
  }
  while (s.schedule.length && s.schedule[0].at <= s.tick) {
    const e = s.schedule[0];
    const spot = freeSpot(s);
    if (spot < 0 && s.tick - e.at < ARRIVAL_RETRY) break; // wait a little for a free spot
    s.schedule.shift();
    if (spot >= 0) admit(s, e, spot, ev);
    else ev.push({ type: 'customer-turned-away', customer: s.nid++ });
    fillSchedule(s);
  }
  s.nextArrival = s.schedule.length ? s.schedule[0].at : null;
}

/** The delivery boy turns up wanting 5 parcels quickly (called by the events layer; false = no free spot yet). */
function spawnDelivery(s, ev) {
  const spot = freeSpot(s);
  if (spot < 0) return false;
  const menu = s.cfg.menu;
  const base = seedToUint32(s.seed) % menu.length;
  const wanted = [];
  for (let i = 0; i < REQUEST.delivery.dishes; i++) wanted.push(menu[(base + i * 3 + s.tick) % menu.length]);
  const fit = fitOrder(s, wanted, s.nid);
  if (fit.left) return false;
  const pm = Math.max(1, Math.round(REQUEST.delivery.patience * (PACE[s.pace] || PACE.normal).patience));
  const id = seat(s, { kind: 'autowala', look: CUSTOMER_KINDS.autowala.look, name: 'Delivery boy', order: fit.order, patienceMax: pm, parcel: 1, delivery: 1 }, spot, ev);
  for (const w of fit.swaps) ev.push({ type: 'sold-out', customer: id, dish: w.dish, swap: w.swap, left: false });
  ev.push({ type: 'parcel-order', customer: id, n: fit.order.length, delivery: true });
  return true;
}

/** Waiting customers who still need a dish that was just taken off the board swap it or go home politely. */
function refitWaiting(s, dish, ev) {
  for (const c of s.customers) {
    if (c.st !== 'waiting') continue;
    const unmet = unmetOf(c);
    const n = unmet.filter((d) => d === dish).length;
    if (!n) continue;
    const fit = fitOrder(s, unmet.filter((d) => d === dish), c.id, c.id);
    // drop the unmet instances of that dish from the order, then add what they ordered instead
    let removed = 0;
    for (let i = c.order.length - 1; i >= 0 && removed < n; i--) if (c.order[i] === dish) { c.order.splice(i, 1); removed += 1; }
    c.total -= billOfFee(c, n, dish);
    for (const d of fit.order) { c.order.push(d); c.total += DISHES[d].price + (c.parcel ? REQUEST.parcelFee : 0); }
    if (!c.order.length || (fit.left && !c.got.length && !unmetOf(c).length)) {
      politeLeave(s, c);
      ev.push({ type: 'sold-out', customer: c.id, dish, swap: null, left: true });
      continue;
    }
    for (const w of fit.swaps) ev.push({ type: 'sold-out', customer: c.id, dish: w.dish, swap: w.swap, left: false });
    if (!unmetOf(c).length) {
      // everything left on their order was already served
      c.st = 'eating'; c.eatLeft = c.parcel ? EAT_TICKS + REQUEST.packExtra : EAT_TICKS;
      c.tip = tipFor({ total: c.total, kindTip: (CUSTOMER_KINDS[c.kind] || CUSTOMER_KINDS.student).tip, patienceFrac: c.patienceMax > 0 ? c.patience / c.patienceMax : 0, got: c.got, qs: c.qs });
      ev.push(c.parcel ? { type: 'eating', customer: c.id, parcel: true } : { type: 'eating', customer: c.id });
    }
  }
}
const billOfFee = (c, n, dish) => n * (DISHES[dish].price + (c.parcel ? REQUEST.parcelFee : 0));

// ---------------------------------------------------------------------------------------------------------------------
// actions. Each handler gets the CLONED state, the action, the event list and the acting player (null for server actions)
// and returns an error string, NOOP or undefined (applied).

const H = {
  tick(s, a, ev) {
    if (a.tick !== undefined && a.tick !== null && a.tick !== s.tick) return 'Stale tick';
    s.tick += 1;
    ev.push({ type: 'tick', tick: s.tick });
    tickEvents(s, ev, { spawnDelivery });
    tickOps(s, ev);
    tickStations(s, ev);
    tickCustomers(s, ev);
    tickArrivals(s, ev);
    if (s.emotes.length) s.emotes = s.emotes.filter((e) => s.tick - e.tick <= EMOTE_TTL);
    checkEnd(s, ev);
  },

  cook(s, a, ev, p) {
    if (typeof a.station !== 'string' || !hasOwn(s.stations, a.station)) return 'No such station';
    const station = s.stations[a.station];
    if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot >= station.slots.length) return 'No such slot';
    if (typeof a.dish !== 'string' || !hasOwn(DISHES, a.dish)) return 'Unknown dish';
    const dish = DISHES[a.dish];
    if (!s.cfg.menu.includes(dish.id)) return 'Not on the menu today';
    if (dish.station !== station.kind) return 'This station cannot cook that';
    const sl = station.slots[a.slot];
    if (sl.st !== 'empty') return 'That spot is busy';
    const blocked = cookBlocker(s, station, dish.id);
    if (blocked) return blocked;
    sl.st = 'cooking'; sl.dish = dish.id; sl.t0 = s.tick; sl.readyAt = s.tick + dish.cook; sl.burnAt = sl.readyAt + dish.burn; sl.by = p.id;
    const fl = consumeFor(s, station, dish.id, ev);
    if (fl) sl.fl = fl;
    ev.push({ type: 'cook-start', station: station.id, slot: a.slot, dish: dish.id, by: p.id });
    return undefined;
  },

  take(s, a, ev, p) {
    if (typeof a.station !== 'string' || !hasOwn(s.stations, a.station)) return 'No such station';
    const station = s.stations[a.station];
    if (station.kind === 'prep') return 'Use collectPrep at the back counter';
    if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot >= station.slots.length) return 'No such slot';
    const sl = station.slots[a.slot];
    if (sl.st === 'burnt') {
      clearSlot(sl);
      ev.push({ type: 'burnt-cleared', station: station.id, slot: a.slot, by: p.id });
      return undefined;
    }
    if (sl.st !== 'ready') return sl.st === 'cooking' ? 'Not ready yet' : 'Nothing there';
    if (p.hands.length >= HANDS_MAX) return 'Your hands are full';
    const q = flawedQuality(qualityOf(s.tick - sl.readyAt, sl.dish), sl.fl);
    const dish = sl.dish;
    p.hands.push({ dish, q });
    clearSlot(sl);
    ev.push({ type: 'take', station: station.id, slot: a.slot, dish, q, by: p.id });
    return undefined;
  },

  serve(s, a, ev, p) {
    if (!Number.isInteger(a.customer)) return 'No such customer';
    const c = s.customers.find((x) => x.id === a.customer);
    if (!c || c.st !== 'waiting') return 'That customer is not waiting for food';
    if (!Number.isInteger(a.hand) || a.hand < 0 || a.hand >= p.hands.length) return 'Nothing in that hand';
    const h = p.hands[a.hand];
    if (!needsOf(c).includes(h.dish)) return 'They did not order that';
    p.hands.splice(a.hand, 1);
    c.got.push(h.dish); c.qs.push(h.q);
    if (h.q === 'broken') c.total -= DISHES[h.dish].price - priceOf(h.dish, 'broken'); // a torn dish is paid at half price
    p.served += 1; s.served += 1;
    c.patience = Math.min(c.patienceMax, c.patience + Math.round(PATIENCE_REFILL * c.patienceMax));
    ev.push(h.q === 'broken' ? { type: 'serve', customer: c.id, dish: h.dish, by: p.id, q: 'broken' } : { type: 'serve', customer: c.id, dish: h.dish, by: p.id });
    if (needsOf(c).length === 0) {
      c.st = 'eating'; c.eatLeft = c.parcel ? EAT_TICKS + REQUEST.packExtra : EAT_TICKS;
      const frac = c.patienceMax > 0 ? c.patience / c.patienceMax : 0;
      let tip = tipFor({ total: c.total, kindTip: (CUSTOMER_KINDS[c.kind] || CUSTOMER_KINDS.student).tip, patienceFrac: frac, got: c.got, qs: c.qs });
      if (c.extra && useExtra(s, c.extra, REQUEST.extraUse, ev)) {
        tip += REQUEST.extraTip;
        ev.push({ type: 'extra', customer: c.id, item: c.extra });
      }
      if (c.spice && (h.q === 'perfect' || h.q === 'good')) tip += Math.round(c.total * 0.05);
      if (c.regular && frac >= 0.35 && !c.qs.includes('broken')) tip = Math.round(tip * (1 + REQUEST.regularMult * (c.loyal + 1)));
      if (c.big) tip += REQUEST.big.bonus;
      if (c.delivery) tip += REQUEST.delivery.bonus;
      if (s.events.length) tip = Math.round(tip * tipMult(s));
      c.tip = tip;
      ev.push(c.parcel ? { type: 'eating', customer: c.id, parcel: true } : { type: 'eating', customer: c.id });
    }
    return undefined;
  },

  collect(s, a, ev, p) {
    if (!Number.isInteger(a.customer)) return 'No such customer';
    const c = s.customers.find((x) => x.id === a.customer);
    if (!c || c.st !== 'paying') return 'They are not paying right now';
    s.combo += 1;
    if (s.combo > s.bestCombo) s.bestCombo = s.combo;
    const tip = c.tip + comboBonus(c.total, s.combo);
    c.tip = tip;
    earn(s, c.total, tip);
    s.paid += 1;
    p.collected += 1; p.earned += c.total + tip; p.tips += tip;
    leave(s, c, 'paid', ev);
    ev.push({ type: 'collect', customer: c.id, amount: c.total, tip, by: p.id, combo: s.combo });
    if (s.combo >= 2) ev.push({ type: 'combo', combo: s.combo });
    checkEnd(s, ev);
    return undefined;
  },

  discard(s, a, ev, p) {
    if (!Number.isInteger(a.hand) || a.hand < 0 || a.hand >= p.hands.length) return 'Nothing in that hand';
    const [h] = p.hands.splice(a.hand, 1);
    binDish(s, h.dish);
    ev.push({ type: 'discard', dish: h.dish, by: p.id });
    return undefined;
  },

  move(s, a, ev, p) {
    const to = a.to === undefined ? null : a.to;
    if (!validTarget(to, s.cfg.stations, s.cfg.spots, s.cfg.gas)) return 'Cannot go there';
    if (p.at === to) return NOOP;
    p.at = to;
    return undefined;
  },

  emote(s, a, ev, p) {
    if (typeof a.e !== 'string' || !EMOTES.includes(a.e)) return 'Unknown emote';
    s.emotes.push({ by: p.id, e: a.e, tick: s.tick });
    if (s.emotes.length > EMOTE_KEEP) s.emotes.splice(0, s.emotes.length - EMOTE_KEEP);
    ev.push({ type: 'emote', by: p.id, e: a.e });
    return undefined;
  },

  // ---- the operations layer (ops.js): prep / collectPrep / buy / tend / swapGas
  prep: OPS_H.prep,
  collectPrep: OPS_H.collectPrep,
  buy: OPS_H.buy,
  tend: OPS_H.tend,
  swapGas: OPS_H.swapGas,

  /** The price board: `{dish, on}`. off = nobody will order it; waiting customers who still want it swap or leave politely. */
  board(s, a, ev, p) {
    if (s.cfg.tutorial) return TRAINING;
    if (typeof a.dish !== 'string' || !hasOwn(DISHES, a.dish) || !s.cfg.menu.includes(a.dish)) return 'Unknown dish';
    if (typeof a.on !== 'boolean') return 'Say whether it is on or off the board';
    const i = s.off.indexOf(a.dish);
    if (a.on) {
      if (i < 0) return NOOP;
      s.off.splice(i, 1);
      ev.push({ type: 'board', dish: a.dish, on: true, by: p.id });
      return undefined;
    }
    if (i >= 0) return NOOP;
    s.off.push(a.dish);
    ev.push({ type: 'board', dish: a.dish, on: false, by: p.id });
    refitWaiting(s, a.dish, ev);
    return undefined;
  },

  // tutorial only
  spawn(s, a, ev) {
    if (!s.cfg.tutorial) return 'Not allowed here';
    const d = a.customer;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return 'Bad customer';
    const kindId = d.kind === undefined ? 'student' : d.kind;
    if (typeof kindId !== 'string' || !hasOwn(CUSTOMER_KINDS, kindId)) return 'Unknown customer kind';
    if (!Array.isArray(d.order) || d.order.length < 1 || d.order.length > 4) return 'Bad order';
    for (const dish of d.order) if (typeof dish !== 'string' || !hasOwn(DISHES, dish) || !s.cfg.menu.includes(dish)) return 'Bad order';
    if (s.customers.filter((c) => c.st !== 'left').length >= s.cfg.spots) return 'No free spot';
    let spot = Number.isInteger(d.spot) && d.spot >= 0 && d.spot < s.cfg.spots && !s.customers.some((c) => c.st !== 'left' && c.spot === d.spot) ? d.spot : -1;
    if (spot < 0) spot = freeSpot(s);
    if (spot < 0) return 'No free spot';
    const level = levelDef(s.level);
    const pm = Number.isInteger(d.patienceMax) && d.patienceMax > 0 && d.patienceMax <= 9999 ? d.patienceMax : patienceFor(kindId, level, s.pace);
    const kind = CUSTOMER_KINDS[kindId];
    const id = seat(s, {
      kind: kindId, look: typeof d.look === 'string' ? d.look.slice(0, 24) : kind.look, order: d.order,
      name: typeof d.name === 'string' && d.name ? d.name.slice(0, 40) : CUSTOMER_NAMES[s.nid % CUSTOMER_NAMES.length],
      patienceMax: pm,
    }, spot, ev);
    ev.push({ type: 'tutorial-spawn', customer: id });
    return undefined;
  },

  'tutorial-flags'(s, a) {
    if (!s.cfg.tutorial) return 'Not allowed here';
    if (typeof a.patience === 'boolean') s.cfg.noPatience = !a.patience;
    if (typeof a.pay === 'boolean') s.cfg.noPayExpiry = !a.pay;
    return undefined;
  },
};

const SERVER_ONLY = new Set(['tick', 'spawn', 'tutorial-flags']);

/** Apply one action. Invalid: `{ state (same object), events: [], error }`. Valid: `{ state (new), events }`. */
export function applyAction(state, action) {
  const fail = (error) => ({ state, events: [], error });
  if (!state || typeof state !== 'object' || state.v !== STATE_VERSION) return fail('No game');
  if (!action || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string') return fail('Not an action');
  if (!hasOwn(H, action.type)) return fail('Unknown action');
  if (state.status !== 'playing') return fail('The shift is over');
  const s = clone(state);
  let p = null;
  if (!SERVER_ONLY.has(action.type)) {
    if (typeof action.playerId !== 'string' || !hasOwn(s.players, action.playerId)) return fail('You are not at this stall');
    p = s.players[action.playerId];
  }
  const ev = [];
  const err = H[action.type](s, action, ev, p);
  if (err === NOOP) return { state, events: [] };
  if (err) return fail(err);
  return { state: s, events: ev };
}

