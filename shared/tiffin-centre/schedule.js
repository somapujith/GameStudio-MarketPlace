// Tiffin Centre: the customer schedule. Built from the seed, generated LAZILY (a short look-ahead lives in `state.schedule`)
// so the serialised state stays small: the whole shift would be 100+ entries on a four-player rush. The generator only
// ever draws from `state.rng` in a fixed order, so it does not depend on what the players do: same seed = same crowd.
import {
  CUSTOMER_KINDS, CUSTOMER_NAMES, DISHES, PACE, PATIENCE_BASE, STATIONS, coopScale, levelDef,
} from './catalog.js';
import { nextFloat, randInt, seedToUint32 } from '../rng.js';

export const LOOKAHEAD = 2; // entries kept in state.schedule
export const FIRST_ARRIVAL = 2; // the first customer walks up at tick 2

const KIND_LIST = Object.values(CUSTOMER_KINDS);
const KIND_WEIGHT = KIND_LIST.reduce((n, k) => n + k.weight, 0);

/** The level's dishes that the level's stations can actually cook (menu order kept). */
export function menuFor(level) {
  const kinds = new Set(level.stations.map((id) => STATIONS[id].kind));
  return level.menu.filter((d) => DISHES[d] && kinds.has(DISHES[d].station));
}

/** Ticks of patience a customer starts with. */
export function patienceFor(kindId, level, pace) {
  const kind = CUSTOMER_KINDS[kindId] || CUSTOMER_KINDS.student;
  const p = PACE[pace] || PACE.normal;
  return Math.max(1, Math.round(PATIENCE_BASE * kind.patience * level.patience * p.patience));
}

function pickKind(h) {
  let r = nextFloat(h) * KIND_WEIGHT;
  for (const k of KIND_LIST) {
    r -= k.weight;
    if (r < 0) return k;
  }
  return KIND_LIST[KIND_LIST.length - 1];
}

function rollOrder(h, kind, level, menu) {
  const hi = Math.max(1, Math.min(kind.order[1], level.orderMax));
  const lo = Math.min(kind.order[0], hi);
  const size = randInt(h, lo, hi);
  const order = [];
  for (let i = 0; i < size; i++) {
    let dish = menu[randInt(h, menu.length)];
    for (let tries = 0; tries < 8 && order.filter((d) => d === dish).length >= 2; tries++) dish = menu[randInt(h, menu.length)];
    if (order.filter((d) => d === dish).length >= 2) dish = menu.find((d) => order.filter((x) => x === d).length < 2) || dish;
    order.push(dish);
  }
  return order;
}

/** One schedule entry arriving at tick `at`. Draw order: kind, order size, dishes, name. */
export function makeEntry(h, ctx, at) {
  const kind = pickKind(h);
  const order = rollOrder(h, kind, ctx.level, ctx.menu);
  const name = CUSTOMER_NAMES[randInt(h, CUSTOMER_NAMES.length)];
  return { at, kind: kind.id, name, look: kind.look, order, patienceMax: patienceFor(kind.id, ctx.level, ctx.pace) };
}

/** Ticks until the next customer: level.gap * PACE.gap / coopScale(players), at least 1. */
export function rollGap(h, ctx) {
  const [lo, hi] = ctx.level.gap;
  const g = (lo + nextFloat(h) * (hi - lo)) * (PACE[ctx.pace] || PACE.normal).gap / coopScale(ctx.players);
  return Math.max(1, Math.round(g));
}

const ctxOf = (s) => ({ level: levelDef(s.level), menu: s.cfg.menu, pace: s.pace, players: s.order.length });

/** Top up `s.schedule` to LOOKAHEAD entries (mutates s: rng, genAt, schedule, nextArrival). */
export function fillSchedule(s) {
  if (s.genAt !== null && s.genAt !== undefined) {
    const ctx = ctxOf(s);
    while (s.schedule.length < LOOKAHEAD && s.genAt !== null && s.genAt < s.shiftTicks) {
      s.schedule.push(makeEntry(s, ctx, s.genAt));
      s.genAt += rollGap(s, ctx);
    }
    if (s.genAt !== null && s.genAt >= s.shiftTicks) s.genAt = null;
  }
  s.nextArrival = s.schedule.length ? s.schedule[0].at : null;
}

/** The complete schedule of a shift, for tests and tools (the engine itself generates it lazily, identically). */
export function buildSchedule({ level, pace = 'normal', players = 1, seed = 1 }) {
  const lv = typeof level === 'object' ? level : levelDef(level);
  if (lv.tutorial) return [];
  const ctx = { level: lv, menu: menuFor(lv), pace: PACE[pace] ? pace : 'normal', players };
  const h = { rng: seedToUint32(seed) };
  const out = [];
  for (let at = FIRST_ARRIVAL; at < lv.shiftTicks; at += rollGap(h, ctx)) out.push(makeEntry(h, ctx, at));
  return out;
}
