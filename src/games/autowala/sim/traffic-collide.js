// Collision maths between the player's auto and the traffic (vehicles, pedestrians, cows): circles, a momentum exchange where the
// heavier body wins, and how serious a hit is. Pure maths, unit-tested.
import { PLAYER_MASS } from './traffic-net.js';

/** The player's auto is two circles along its body. */
export const PLAYER_CIRCLES = { offsets: [-0.85, 0.85], r: 0.85 };

/** World position of circle `i` of a body at (x, z) with heading h and circle z-offset `off`. */
export function circleAt(x, z, heading, off, out) {
  out.x = x + Math.sin(heading) * off;
  out.z = z + Math.cos(heading) * off;
  return out;
}

/**
 * Exchange momentum between bodies A and B along the contact normal n (unit, pointing from A to B).
 * restitution e: 0 sticks, 1 bounces. Writes velocity CHANGES into `out`: dax, daz, dbx, dbz, and `closing` (m/s, > 0 when the
 * bodies were moving into each other). Nothing changes when they are already separating.
 */
export function exchangeImpulse(ma, vax, vaz, mb, vbx, vbz, nx, nz, e, out) {
  const closing = (vax - vbx) * nx + (vaz - vbz) * nz;
  out.closing = closing;
  out.dax = out.daz = out.dbx = out.dbz = 0;
  if (closing <= 0) return out;
  const j = ((1 + e) * closing) / (1 / ma + 1 / mb);
  out.dax = (-j / ma) * nx;
  out.daz = (-j / ma) * nz;
  out.dbx = (j / mb) * nx;
  out.dbz = (j / mb) * nz;
  return out;
}

/** Positional correction for an overlap `depth`: the lighter body moves further. Writes the displacement of A and B. */
export function separate(ma, mb, depth, nx, nz, out) {
  const ka = mb / (ma + mb);
  const kb = ma / (ma + mb);
  out.ax = -nx * depth * ka;
  out.az = -nz * depth * ka;
  out.bx = nx * depth * kb;
  out.bz = nz * depth * kb;
  return out;
}

/** How hard a hit is for the player's rage purposes (0..1): relative closing speed, the other's mass, and a bonus for bikes. */
export function hitSeverity(closing, kind, otherMass, playerMass = PLAYER_MASS) {
  const speedTerm = Math.min(1, Math.max(0, closing) / 13);
  const massTerm = otherMass / (otherMass + playerMass);
  const bonus = kind === 'bike' ? 0.12 : 0;
  return Math.min(1, Math.max(0.06, 0.06 + 0.94 * speedTerm * (0.3 + 0.7 * massTerm) + bonus * Math.min(1, speedTerm * 3 + 0.3)));
}

/** Mass of things that are not vehicles. */
export const SOFT_MASS = { ped: 70, cow: 450 };
