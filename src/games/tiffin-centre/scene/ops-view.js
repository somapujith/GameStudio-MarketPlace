// The operations layer as the 3D scene sees it (docs/TIFFIN_CENTRE_PLAN.md section 3b): pure functions from the engine state to the few numbers the
// props, the lights and the world need. No three, no DOM, allocation-free when an `out` is passed. Every function is defensive: the tutorial
// (level 0), an old save or a hand-built test state has none of the layer, and then everything reads as "all is well".
import { FERMENT, GAS, HEAT, LAYOUT } from '../../../../shared/tiffin-centre/catalog.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Events the world shows (state.events ids). */
export const EVENT_IDS = ['rain', 'power', 'cricket', 'festival', 'inspector', 'delivery'];
export const hasEvent = (state, id) => {
  const ev = state?.events;
  if (!Array.isArray(ev)) return false;
  for (let i = 0; i < ev.length; i++) if (ev[i] && ev[i].id === id) return true;
  return false;
};
/** The running event `id` ({ id, until }) or null. */
export const eventOf = (state, id) => {
  const ev = state?.events;
  if (!Array.isArray(ev)) return null;
  for (let i = 0; i < ev.length; i++) if (ev[i] && ev[i].id === id) return ev[i];
  return null;
};

/** `{ rain, power, cricket, festival, inspector, delivery }` as booleans (power is true while the CUT is on). */
export function eventFlags(state, out = {}) {
  for (const id of EVENT_IDS) out[id] = hasEvent(state, id);
  return out;
}

/** Exponential approach of `cur` to `target` (rate per second differs going up and down); allocation-free, frame-rate independent, never overshoots. */
export function approach(cur, target, dt, riseS = 2, fallS = 2) {
  const tau = Math.max(0.001, target > cur ? riseS : fallS);
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  const v = cur + (target - cur) * k;
  return Math.abs(v - target) < 0.0005 ? target : v;
}

// --- LPG --------------------------------------------------------------------------------------------------------------------------------------------
/**
 * The cylinder: `has` (the level has a gas supply: levels 3+), `frac` 0..1 of a full one, `low` (<= GAS.lowFrac), `empty`, `swapping`, `swapT` 0..1
 * through the change (GAS.swapTicks ticks, tickFrac in between) and `burners` (the flames burn: there is gas and nobody is changing the cylinder).
 * Levels without a supply (and the tutorial) have the burners on all the time and a full-looking cylinder.
 */
export function gasView(state, tickFrac = 0, out = {}) {
  const g = state?.gas;
  const has = !!state?.cfg?.gas && !!g && !state?.cfg?.tutorial;
  out.has = has;
  if (!has) {
    out.frac = 1; out.low = false; out.empty = false; out.swapping = false; out.swapT = 0; out.burners = true; out.u = GAS.cap;
    return out;
  }
  const u = clamp(num(g.u), 0, GAS.cap);
  const sw = Math.max(0, num(g.sw));
  out.u = u;
  out.frac = u / GAS.cap;
  out.empty = u <= 0;
  out.low = !out.empty && out.frac <= GAS.lowFrac;
  out.swapping = sw > 0;
  out.swapT = sw > 0 ? clamp((GAS.swapTicks - sw + clamp(tickFrac, 0, 1)) / GAS.swapTicks, 0, 1) : 0;
  out.burners = u > 0 && sw === 0;
  return out;
}

/** Gas flame strength 0..1 for the burners: full, thinner when the cylinder runs low, dead when there is none. */
export const flamePower = (gv) => (!gv.burners ? 0 : gv.low ? 0.55 + 0.45 * clamp(gv.frac / GAS.lowFrac, 0, 1) : 1);

/**
 * Where the cylinder is during a change, 0..1 -> { out: how far the old one is lifted away (0 on the stand .. 1 gone), inn: how far the new one is
 * lowered in (0 not there .. 1 on the stand) }. The old one goes in the first 40%, the stand stands empty, the new one arrives from 55%.
 */
export function swapPose(t, out = { out: 0, inn: 0 }) {
  const x = clamp(t, 0, 1);
  const s = (a, b, v) => {
    const k = clamp((v - a) / (b - a), 0, 1);
    return k * k * (3 - 2 * k);
  };
  out.out = s(0, 0.4, x);
  out.inn = s(0.55, 0.95, x);
  return out;
}

// --- pans -------------------------------------------------------------------------------------------------------------------------------------------
/**
 * What the tawa / kadai / steamer of the state looks like (levels 2+): `glow` 0..1 of heat (0 cold iron .. 1 white-hot; the ideal pan is ~0.5),
 * `hot` / `cold` 0..1 beyond the band, `gunk` 0..1 of burnt-on crust (1 = the torn threshold), `water` 0..1 (steamer), `stuck` / `torn`.
 * A pan without the heat fields reads as a healthy ideal pan.
 */
export function panView(st, out = {}) {
  const heat = st && Number.isFinite(st.heat) ? st.heat : HEAT.ideal;
  const gunk = st && Number.isFinite(st.gunk) ? st.gunk : 0;
  const water = st && Number.isFinite(st.water) ? st.water : HEAT.waterStart;
  out.heat = heat;
  out.glow = clamp(heat / 100, 0, 1);
  out.hot = clamp((heat - HEAT.hot) / (100 - HEAT.hot), 0, 1);
  out.cold = clamp((HEAT.cold - heat) / HEAT.cold, 0, 1);
  out.gunk = clamp(gunk / HEAT.torn, 0, 1);
  out.stuck = gunk >= HEAT.stick;
  out.torn = gunk >= HEAT.torn;
  out.water = clamp(water / HEAT.waterStart, 0, 1);
  out.dry = water <= 0;
  out.low = water < HEAT.waterDry;
  return out;
}

// --- the shelf --------------------------------------------------------------------------------------------------------------------------------------
export const STOCK_FULL = 20; // portions that fill a bucket / jar to the brim (the HUD's bars use the same)
/** Items drawn on the shelves: the batter buckets and the jars. */
export const SHELF_BATTERS = ['batter_dosa', 'batter_idly', 'batter_pesarattu'];
export const SHELF_JARS = ['coconut_chutney', 'sambar', 'podi_ghee', 'potato_masala'];

/** `fill` 0..1 (portions / STOCK_FULL; a shelf with anything keeps a sliver) and `sour` 0..1 (0 fresh .. 1 spoiled) of one ingredient; null when it is not stocked. */
export function stockOf(state, item, out = {}) {
  const n = state?.stock?.[item];
  if (!Number.isFinite(n)) return null;
  out.fill = n <= 0 ? 0 : clamp(Math.max(0.06, n / STOCK_FULL), 0, 1);
  const f = state?.fresh?.[item];
  out.sour = Number.isFinite(f) ? clamp((70 - f) / 70, 0, 1) : 0;
  out.isSour = Number.isFinite(f) && f < FERMENT.sour;
  return out;
}

/** The dishes the cook has taken off the board (state.off), as a stable key for change detection ('' when none). */
export const offKey = (state) => (Array.isArray(state?.off) && state.off.length ? state.off.join(',') : '');

// --- customers ---------------------------------------------------------------------------------------------------------------------------------------
/** `{ parcel, regular, delivery }` marks of an engine customer. */
export function customerMarks(c, out = {}) {
  out.parcel = !!c && !!c.parcel && !c.delivery;
  out.regular = !!c && !!c.regular;
  out.delivery = !!c && !!c.delivery;
  return out;
}

// --- the inspector ------------------------------------------------------------------------------------------------------------------------------------
/** Where the GHMC official stands: just beyond the last customer spot of the level, close to the counter. */
export function inspectorPos(spots = LAYOUT.spots, out = { x: 0, z: 0 }) {
  out.x = LAYOUT.spotX(Math.max(0, spots - 1)) + 1.05;
  out.z = LAYOUT.spotZ + 0.35;
  return out;
}
/** Where the delivery boy's scooter is parked (beside the counter, on the footpath) and where he stands. */
export function deliveryBikePos(out = { x: 0, z: 0, ry: 0 }) {
  out.x = LAYOUT.spotX(0) - 1.55;
  out.z = LAYOUT.spotZ - 1.15;
  out.ry = 1.25;
  return out;
}
