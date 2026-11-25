// Tiffin Centre: where people stand and how long it takes to walk there. Pure, shared by the engine (validation),
// the 3D scene (avatar walking), the HUD (walk, then do the work) and the tests.
//
// Everybody in the kitchen works on ONE line behind the counter (z = LAYOUT.cookZ), so a walk is a 1-D trip along x.
// A player's `at` is: null (standing where they spawned) | a station id (incl. the back counter 'prep1') | `spot:N` (behind the counter,
// facing customer spot N, to serve and collect) | 'bin' | 'gas' (the LPG cylinder stand, on levels that have one).
import { LAYOUT, STATIONS } from './catalog.js';

export const WALK_SPEED = 5.5; // metres per second along the line
export const WORK_MS = 650; // the 'do the work' animation after arriving, before the next walk may start
export const LANE_OFFSET = 0.38; // cosmetic: two cooks at one station stand this far apart in z (scene only)
export const HOME_X = 0; // where a player with at === null stands

const SPOT = /^spot:(\d)$/;

/** Is `to` a legal `move` target for these stations / spots? ('gas' is legal unless the level says `gas = false`.) */
export function validTarget(to, stations = Object.keys(STATIONS), spots = LAYOUT.spots, gas = true) {
  if (to === null) return true;
  if (typeof to !== 'string') return false;
  if (to === 'bin') return true;
  if (to === 'gas') return !!gas;
  if (Object.hasOwn(STATIONS, to)) return stations.includes(to);
  const m = SPOT.exec(to);
  return !!m && Number(m[1]) < spots;
}

/** The x a person stands at for `at` (stations use their own x; spots use the customer's x; the bin its x). */
export function standX(at) {
  if (at === null || at === undefined) return HOME_X;
  if (at === 'bin') return LAYOUT.bin.x - 0.6;
  if (at === 'gas') return LAYOUT.gas.x + 0.4;
  if (typeof at === 'string' && Object.hasOwn(STATIONS, at)) return STATIONS[at].x;
  const m = typeof at === 'string' ? SPOT.exec(at) : null;
  return m ? LAYOUT.spotX(Number(m[1])) : HOME_X;
}

/** Seconds to walk from x0 to x1. */
export const walkSeconds = (x0, x1) => Math.abs(x1 - x0) / WALK_SPEED;

/** Move a walker one frame towards x1. Returns { x, arrived, dir } (dir -1 | 0 | 1, for facing and the walk cycle). */
export function stepWalker(x, x1, dt) {
  const d = x1 - x;
  const step = WALK_SPEED * Math.max(0, dt);
  if (Math.abs(d) <= step) return { x: x1, arrived: true, dir: 0 };
  return { x: x + Math.sign(d) * step, arrived: false, dir: Math.sign(d) };
}

/** The target a game action is performed from (what a player must walk to before the work happens). */
export function workTarget(action, state) {
  if (!action || typeof action !== 'object') return null;
  switch (action.type) {
    case 'cook':
    case 'take':
    case 'prep':
    case 'collectPrep':
    case 'tend':
      return typeof action.station === 'string' ? action.station : null;
    case 'swapGas':
      return 'gas';
    case 'serve':
    case 'collect': {
      const c = state?.customers?.find((x) => x.id === action.customer);
      return c && Number.isInteger(c.spot) ? `spot:${c.spot}` : null;
    }
    case 'discard':
      return 'bin';
    default:
      return null;
  }
}
