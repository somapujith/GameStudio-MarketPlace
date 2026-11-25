// Tiffin Centre: the customer schedule. Built from the seed, generated LAZILY (a short look-ahead lives in `state.schedule`)
// so the serialised state stays small: the whole shift would be 100+ entries on a four-player rush. The generator only
// ever draws from `state.rng` in a fixed order, so it does not depend on what the players do: same seed = same crowd.
//
// Demand realism (section 3b): arrivals follow a real-life curve by hour (the morning rush bell around 8-9, the lunch lull, the 5-7 pm
// snack peak, the night tiffin wave) scaled so the level's mean gap is unchanged; who comes (office-goers 7-10, students after 4, families at
// night and at weekends, autowalas any time) and what they order (idly/dosa/poori in the morning, bajji/bonda/chai/vada in the evening,
// dosas at night) follow the daypart, the weather and the events. Some customers are REGULARS who come back during the shift, some
// ask for extras, less/more spice or a parcel, and on later levels an office parcel order of 6-10 dishes turns up now and then.
import {
  CROWD_CURVE, CROWD_SPREAD, CUSTOMER_KINDS, CUSTOMER_NAMES, DISHES, DISH_BY_DAYPART, KIND_BY_DAYPART, PACE, PATIENCE_BASE, REQUEST, STATIONS,
  WEEKEND, coopScale, daypartOf, levelDef, levelOps,
} from './catalog.js';
import { nextFloat, randInt, seedToUint32 } from '../rng.js';
import { burstAt, crowdMult, dishMult, eventPlan, kindMult } from './events.js';

export const LOOKAHEAD = 2; // entries kept in state.schedule
export const FIRST_ARRIVAL = 2; // the first customer walks up at tick 2

const KIND_LIST = Object.values(CUSTOMER_KINDS);
const REGULAR_KINDS = ['office', 'uncle', 'student', 'techie', 'autowala', 'family'];

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

// ---------------------------------------------------------------------------------------------------------------------
// the day: crowd by hour, weekends, weights

/** The raw crowd multiplier at a clock hour (24h decimal; hours past 24 are the small hours). */
export function crowdAtHour(hour) {
  const c = CROWD_CURVE;
  let h = hour;
  if (h < c[0][0]) h += 24;
  if (h <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (h <= c[i][0]) {
      const [x0, y0] = c[i - 1];
      const [x1, y1] = c[i];
      return y0 + ((y1 - y0) * (h - x0)) / (x1 - x0);
    }
  }
  return c[c.length - 1][1];
}

const normCache = new Map();
/**
 * The level's crowd shape: the raw curve relative to its mean over the shift, softened by CROWD_SPREAD (the bell is felt, but a level is still
 * playable), and a constant k so that the mean of 1 / (crowd * k) over the shift is 1: the curve moves the rushes around, the mean gap stays.
 */
function crowdShape(h0, h1) {
  const key = `${h0}|${h1}`;
  if (normCache.has(key)) return normCache.get(key);
  const n = 64;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += crowdAtHour(h0 + ((h1 - h0) * (i + 0.5)) / n) / n;
  const shape = (h) => Math.max(0.3, 1 + CROWD_SPREAD * (crowdAtHour(h) / mean - 1));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += 1 / shape(h0 + ((h1 - h0) * (i + 0.5)) / n);
  const out = { mean, k: sum / n, shape };
  normCache.set(key, out);
  return out;
}

/** A seeded "Sunday" shift: families crowd in, office-goers stay home. */
export const isWeekend = (seed) => ((seedToUint32(seed) >>> 3) % 5) === 0;

const hourIn = (hour, shiftTicks, tick) => hour[0] + ((hour[1] - hour[0]) * Math.max(0, Math.min(1, tick / shiftTicks)));

/** How likely a customer kind is at `tick` (relative weight). */
export function kindWeight(kindId, ctx, tick) {
  const kind = CUSTOMER_KINDS[kindId];
  if (!kind) return 0;
  if (!ctx.hour) return kind.weight;
  const dp = daypartOf(hourIn(ctx.hour, ctx.shiftTicks, tick));
  let w = kind.weight * ((KIND_BY_DAYPART[dp] && KIND_BY_DAYPART[dp][kindId]) || 1);
  if (ctx.weekend && WEEKEND.kind[kindId]) w *= WEEKEND.kind[kindId];
  if (ctx.plan) w *= kindMult(ctx.plan, tick, kindId);
  return w;
}

/** How likely a dish is to be ordered at `tick` (relative weight): daypart taste x weather and events. */
export function dishWeight(dishId, ctx, tick) {
  if (!ctx.hour) return 1;
  const dp = daypartOf(hourIn(ctx.hour, ctx.shiftTicks, tick));
  let w = (DISH_BY_DAYPART[dp] && DISH_BY_DAYPART[dp][dishId]) || 1;
  if (ctx.plan) w *= dishMult(ctx.plan, tick, dishId);
  return w;
}

function pickKind(h, ctx, at) {
  let total = 0;
  for (const k of KIND_LIST) total += kindWeight(k.id, ctx, at);
  let r = nextFloat(h) * total;
  for (const k of KIND_LIST) {
    r -= kindWeight(k.id, ctx, at);
    if (r < 0) return k;
  }
  return KIND_LIST[KIND_LIST.length - 1];
}

function pickDish(h, ctx, at, menu) {
  let total = 0;
  for (const d of menu) total += dishWeight(d, ctx, at);
  let r = nextFloat(h) * total;
  for (const d of menu) {
    r -= dishWeight(d, ctx, at);
    if (r < 0) return d;
  }
  return menu[menu.length - 1];
}

function rollOrder(h, ctx, at, size, firstDish = null, maxRep = 2) {
  const menu = ctx.menu;
  const order = [];
  if (firstDish && menu.includes(firstDish)) order.push(firstDish);
  const count = (d) => order.filter((x) => x === d).length;
  while (order.length < size) {
    let dish = pickDish(h, ctx, at, menu);
    for (let tries = 0; tries < 8 && count(dish) >= maxRep; tries++) dish = pickDish(h, ctx, at, menu);
    if (count(dish) >= maxRep) dish = menu.find((d) => count(d) < maxRep) || dish;
    order.push(dish);
  }
  return order;
}

const regCache = new Map();
/**
 * The regulars of a shift: [{ n name, k kind, f favourite dish, nx first visit }]. A pure function of (seed, menu, how many): they are NOT
 * stored in the state (only their loyalty and next visit are: `state.regs = [[loyalty, nextVisit], ...]`).
 */
export function regularIds(seed, menu, count) {
  const n = Math.min(REQUEST.regularMax, count || 0);
  if (!n) return [];
  const key = `${typeof seed}:${String(seed)}|${menu.join(",")}|${n}`;
  const hit = regCache.get(key);
  if (hit) return hit;
  const h = { rng: (seedToUint32(seed) ^ 0x9e3779b1) >>> 0 };
  const regs = [];
  for (let i = 0; i < n; i++) {
    const k = REGULAR_KINDS[randInt(h, REGULAR_KINDS.length)];
    let name = CUSTOMER_NAMES[randInt(h, CUSTOMER_NAMES.length)];
    for (let tries = 0; tries < 12 && regs.some((r) => r.n === name); tries++) name = CUSTOMER_NAMES[randInt(h, CUSTOMER_NAMES.length)];
    const f = menu[randInt(h, menu.length)];
    regs.push({ n: name, k, f, nx: 14 + i * 16 + randInt(h, 0, 10) });
  }
  if (regCache.size > 100) regCache.clear();
  regCache.set(key, regs);
  return regs;
}

/** Give a fresh schedule holder its regulars' state: [[loyalty, nextVisit], ...] (loyalty counts good visits so far). */
export function initRegulars(h, ctx) {
  h.regs = (ctx.regIds || []).map((r) => [0, r.nx]);
}

/** One schedule entry arriving at tick `at`. Extra entry fields appear only when set: parcel, extra, spice, big, regular + rid. */
export function makeEntry(h, ctx, at) {
  const ops = ctx.ops || {};
  let reg = -1;
  if (h.regs && h.regs.length) {
    const due = h.regs.findIndex((r) => r[1] <= at);
    if (due >= 0 && nextFloat(h) < REQUEST.regularChance) reg = due;
  }
  let kind = pickKind(h, ctx, at);
  if (reg >= 0) kind = CUSTOMER_KINDS[ctx.regIds[reg].k] || kind;

  let big = false;
  if (ops.big && reg < 0 && at >= Math.max(REQUEST.big.from, h.nb || 0) && nextFloat(h) < REQUEST.big.chance) {
    big = true;
    kind = CUSTOMER_KINDS.office;
    h.nb = at + REQUEST.big.spacing;
  }

  let order;
  if (big) {
    // an office parcel order is sized for the team: 4-6 dishes for one cook, 6-10 for three or more
    const team = Math.max(1, Math.min(3, ctx.players)) - 1;
    order = rollOrder(h, ctx, at, randInt(h, REQUEST.big.min - 2 + team, REQUEST.big.max - 4 + team), null, 3);
  } else {
    const hi = Math.max(1, Math.min(kind.order[1], ctx.level.orderMax));
    const lo = Math.min(kind.order[0], hi);
    const size = randInt(h, lo, hi);
    order = rollOrder(h, ctx, at, size, reg >= 0 ? ctx.regIds[reg].f : null);
  }
  let name = CUSTOMER_NAMES[randInt(h, CUSTOMER_NAMES.length)];
  if (reg >= 0) name = ctx.regIds[reg].n;

  let patienceMax = patienceFor(kind.id, ctx.level, ctx.pace);
  const e = { at, kind: kind.id, name, look: kind.look, order, patienceMax };
  if (ops.requests) {
    if (nextFloat(h) < REQUEST.extraChance) e.extra = nextFloat(h) < 0.5 ? 'coconut_chutney' : 'sambar';
    if (nextFloat(h) < REQUEST.spiceChance) e.spice = nextFloat(h) < 0.5 ? 'less' : 'more';
    if (!big && nextFloat(h) < (kind.id === 'office' ? REQUEST.officeParcelChance : REQUEST.parcelChance)) {
      e.parcel = 1;
      e.patienceMax = Math.max(1, Math.round(patienceMax * REQUEST.parcelPatience));
    }
  }
  if (big) {
    e.big = 1;
    e.parcel = 1;
    e.patienceMax = Math.max(1, Math.round(patienceMax * REQUEST.big.patience));
  }
  if (reg >= 0) {
    e.regular = 1;
    e.rid = reg;
    h.regs[reg][1] = at + 40 + randInt(h, 0, 25);
  }
  return e;
}

/** Ticks until the next customer: level.gap * PACE.gap / coopScale(players) / the crowd at `at`, at least 1. */
export function rollGap(h, ctx, at) {
  const [lo, hi] = ctx.level.gap;
  let g = (lo + nextFloat(h) * (hi - lo)) * (PACE[ctx.pace] || PACE.normal).gap / coopScale(ctx.players);
  if (ctx.hour && Number.isFinite(at)) {
    const cs = crowdShape(ctx.hour[0], ctx.hour[1]);
    let crowd = cs.shape(hourIn(ctx.hour, ctx.shiftTicks, at)) * cs.k;
    if (ctx.weekend) crowd *= WEEKEND.crowd;
    if (ctx.plan) {
      crowd *= crowdMult(ctx.plan, at);
      if (burstAt(ctx.plan, at)) g = nextFloat(h) < 0.55 ? 1 : g * 2.2;
    }
    g /= crowd;
  }
  return Math.max(1, Math.round(g));
}

const opsOf = (s) => {
  const o = levelOps(s.level);
  return { requests: !!o.requests, big: !!o.big, regulars: o.regulars || 0 };
};
const ctxOf = (s) => ({
  level: levelDef(s.level), menu: s.cfg.menu, pace: s.pace, players: s.order.length, ops: opsOf(s), hour: s.cfg.hour,
  shiftTicks: s.shiftTicks, weekend: !!s.cfg.weekend, regIds: regularIds(s.seed, s.cfg.menu, levelOps(s.level).regulars), plan: s.cfg.events && s.cfg.events.length ? eventPlan({ ids: s.cfg.events, seed: s.seed, shiftTicks: s.shiftTicks }) : null,
});

/** Draw the regulars of a fresh game (call once, before the first `fillSchedule`). */
export function seedRegulars(s) {
  initRegulars(s, ctxOf(s));
}

/** Top up `s.schedule` to LOOKAHEAD entries (mutates s: rng, genAt, schedule, nextArrival). */
export function fillSchedule(s) {
  if (s.genAt !== null && s.genAt !== undefined) {
    const ctx = ctxOf(s);
    while (s.schedule.length < LOOKAHEAD && s.genAt !== null && s.genAt < s.shiftTicks) {
      s.schedule.push(makeEntry(s, ctx, s.genAt));
      s.genAt += rollGap(s, ctx, s.genAt);
    }
    if (s.genAt !== null && s.genAt >= s.shiftTicks) s.genAt = null;
  }
  s.nextArrival = s.schedule.length ? s.schedule[0].at : null;
}

/** The complete schedule of a shift, for tests and tools (the engine itself generates it lazily, identically). */
export function buildSchedule({ level, pace = 'normal', players = 1, seed = 1 }) {
  const lv = typeof level === 'object' ? level : levelDef(level);
  if (lv.tutorial) return [];
  const p = PACE[pace] ? pace : 'normal';
  const ops = levelOps(lv.id === undefined ? 0 : lv.id);
  const menu = menuFor(lv);
  const events = ops.events;
  const ctx = {
    level: lv, menu, pace: p, players, ops: { requests: ops.requests, big: ops.big, regulars: ops.regulars },
    hour: lv.hour, shiftTicks: lv.shiftTicks, weekend: isWeekend(seed), regIds: regularIds(seed, menu, ops.regulars),
    plan: events.length ? eventPlan({ ids: events, seed, shiftTicks: lv.shiftTicks }) : null,
  };
  const h = { rng: seedToUint32(seed) };
  initRegulars(h, ctx);
  const out = [];
  for (let at = FIRST_ARRIVAL; at < lv.shiftTicks; at += rollGap(h, ctx, at)) out.push(makeEntry(h, ctx, at));
  return out;
}
