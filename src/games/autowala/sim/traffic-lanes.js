// Lane geometry for traffic. Pure maths: no three.js, no DOM.
//
// India drives on the LEFT. Heading 0 faces +z and forward = (sin h, cos h); the driver's LEFT is (cos h, -sin h), which for a
// travel direction d = (dx, dz) is simply (dz, -dx). A vehicle's lane centre is `laneOffset(w, lane)` metres to its left of the
// road's centre line, so two vehicles driving in opposite directions pass each other with the other on their right.
//
// A trip along the graph is a chain of pieces: a straight run on an edge's lane line, then a `link` (a cubic Bezier through the
// junction between the lane lines of the two edges), then the next edge ... Links are written into preallocated objects.
import { clamp } from '../game/rng.js';

/** Lanes per direction: avenues and the ring road have two, everything else one. */
export const laneCount = (w) => (w >= 15 ? 2 : 1);

/** Distance from the road's centre line to the centre of a lane (lane 0 is the inner one, next to the centre line). */
export function laneOffset(w, lane = 0) {
  const n = laneCount(w);
  const l = Math.min(Math.max(lane | 0, 0), n - 1);
  return ((l + 0.5) * (w / 2)) / n;
}

/** The node a vehicle starts from when it travels along `edge` in direction `dir` (+1: a -> b, -1: b -> a). */
export const startNode = (city, e, dir) => city.nodes[dir > 0 ? e.a : e.b];
export const endNode = (city, e, dir) => city.nodes[dir > 0 ? e.b : e.a];

/** Heading (game convention) of travel along an edge in direction `dir`. */
export const edgeHeading = (e, dir) => Math.atan2(e.dx * dir, e.dz * dir);

/**
 * Position of the lane centre `u` metres from the start of travel on (edge, dir, lane); writes into `out` {x, z, heading}.
 */
export function lanePoint(city, e, dir, lane, u, out = { x: 0, z: 0, heading: 0 }) {
  const n = startNode(city, e, dir);
  const dx = e.dx * dir;
  const dz = e.dz * dir;
  const o = laneOffset(e.w, lane);
  out.x = n.x + dx * u + dz * o; // left = (dz, -dx)
  out.z = n.z + dz * u - dx * o;
  out.heading = Math.atan2(dx, dz);
  return out;
}

/** Signed distance of a point to the LEFT of the lane's centre line (travel direction dir): > 0 means left of centre. */
export function leftOfCentre(city, e, dir, x, z) {
  const n = startNode(city, e, dir);
  const dx = e.dx * dir;
  const dz = e.dz * dir;
  return (x - n.x) * dz - (z - n.z) * dx;
}

/** How far from the node a junction link starts / ends on the incident edges. */
export function linkSetback(node, e1, e2) {
  return Math.max(1.5, Math.min(Math.max(4, node.w * 0.5 + 0.5), e1.len * 0.45, e2.len * 0.45));
}

/** Speed a corner of turning angle `ang` (rad) and setback `k` allows (m/s), from a lateral acceleration budget. */
export function cornerSpeed(ang, k, aLat = 3.2) {
  if (ang < 0.08) return Infinity;
  const R = Math.max(2.2, k / Math.tan(Math.min(ang, Math.PI * 0.95) / 2));
  return Math.max(2.4, Math.sqrt(aLat * R));
}

export const newLink = () => ({
  curve: true, x0: 0, z0: 0, x1: 0, z1: 0, x2: 0, z2: 0, x3: 0, z3: 0, L: 1, k1: 0, k2: 0,
  hx0: 0, hz0: 0, hx1: 0, hz1: 0, angle: 0, cap: Infinity, node: -1, right: false,
});

/** Fill `out` with a smooth link from A (travelling along dA) to B (travelling along dB). Length is measured by sampling. */
export function setLink(out, ax, az, adx, adz, bx, bz, bdx, bdz) {
  const abx = bx - ax;
  const abz = bz - az;
  const ab = Math.hypot(abx, abz);
  const dot = adx * bdx + adz * bdz;
  const cross = adx * bdz - adz * bdx;
  const lateral = Math.abs(abx * adz - abz * adx);
  out.hx0 = adx;
  out.hz0 = adz;
  out.hx1 = bdx;
  out.hz1 = bdz;
  out.x0 = ax;
  out.z0 = az;
  out.x3 = bx;
  out.z3 = bz;
  out.angle = Math.acos(clamp(dot, -1, 1));
  out.right = cross > 0.25; // a right turn (heading falls; it crosses the oncoming lane when driving on the left)
  if (Math.abs(cross) < 1e-3 && dot > 0 && lateral < 0.05) {
    out.curve = false;
    out.x1 = ax + abx / 3;
    out.z1 = az + abz / 3;
    out.x2 = ax + (abx * 2) / 3;
    out.z2 = az + (abz * 2) / 3;
    out.L = ab;
    return out;
  }
  out.curve = true;
  const c = (dot < -0.85 ? 0.75 : 0.4) * Math.max(ab, 1);
  out.x1 = ax + adx * c;
  out.z1 = az + adz * c;
  out.x2 = bx - bdx * c;
  out.z2 = bz - bdz * c;
  let len = 0;
  let px = ax;
  let pz = az;
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const m = 1 - t;
    const x = m * m * m * ax + 3 * m * m * t * out.x1 + 3 * m * t * t * out.x2 + t * t * t * bx;
    const z = m * m * m * az + 3 * m * m * t * out.z1 + 3 * m * t * t * out.z2 + t * t * t * bz;
    len += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  out.L = Math.max(len, 0.5);
  return out;
}

/**
 * The junction link from (e1, dir1, lane1) into (e2, dir2, lane2) at the node where e1 ends (e2 must start there).
 * `out.k1` / `out.k2` are the setbacks: the straight run on e1 stops k1 metres before the node, the run on e2 begins k2 after it.
 */
export function junctionLink(city, e1, dir1, lane1, e2, dir2, lane2, out = newLink()) {
  const N = endNode(city, e1, dir1);
  const d1x = e1.dx * dir1;
  const d1z = e1.dz * dir1;
  const d2x = e2.dx * dir2;
  const d2z = e2.dz * dir2;
  const o1 = laneOffset(e1.w, lane1);
  const o2 = laneOffset(e2.w, lane2);
  const k = linkSetback(N, e1, e2);
  const ax = N.x + d1z * o1 - d1x * k;
  const az = N.z - d1x * o1 - d1z * k;
  const bx = N.x + d2z * o2 + d2x * k;
  const bz = N.z - d2x * o2 + d2z * k;
  setLink(out, ax, az, d1x, d1z, bx, bz, d2x, d2z);
  out.k1 = k;
  out.k2 = k;
  out.node = N.id;
  out.cap = cornerSpeed(out.angle, k);
  return out;
}

/** Position and heading at distance `s` along a link; writes `out` {x, z, heading}. */
export function evalLink(l, s, out) {
  const t = clamp(s / l.L, 0, 1);
  if (!l.curve) {
    out.x = l.x0 + (l.x3 - l.x0) * t;
    out.z = l.z0 + (l.z3 - l.z0) * t;
    out.heading = Math.atan2(l.hx0, l.hz0);
    return out;
  }
  const m = 1 - t;
  const a = m * m * m;
  const b = 3 * m * m * t;
  const c = 3 * m * t * t;
  const d = t * t * t;
  out.x = a * l.x0 + b * l.x1 + c * l.x2 + d * l.x3;
  out.z = a * l.z0 + b * l.z1 + c * l.z2 + d * l.z3;
  // derivative of the cubic
  const tx = 3 * m * m * (l.x1 - l.x0) + 6 * m * t * (l.x2 - l.x1) + 3 * t * t * (l.x3 - l.x2);
  const tz = 3 * m * m * (l.z1 - l.z0) + 6 * m * t * (l.z2 - l.z1) + 3 * t * t * (l.z3 - l.z2);
  out.heading = Math.abs(tx) + Math.abs(tz) < 1e-6 ? Math.atan2(l.hx1, l.hz1) : Math.atan2(tx, tz);
  return out;
}

/** The link of a mid-road U-turn: from lane `lane` travelling +dir at distance u to the opposite direction's lane `lane2`, `ahead` m further on. */
export function uTurnLink(city, e, dir, lane, u, lane2, ahead, out = newLink()) {
  const n = startNode(city, e, dir);
  const dx = e.dx * dir;
  const dz = e.dz * dir;
  const o1 = laneOffset(e.w, lane);
  const o2 = laneOffset(e.w, lane2);
  const ax = n.x + dx * u + dz * o1;
  const az = n.z + dz * u - dx * o1;
  // the opposite lane: its left is our right
  const bx = n.x + dx * (u + ahead) - dz * o2;
  const bz = n.z + dz * (u + ahead) + dx * o2;
  setLink(out, ax, az, dx, dz, bx, bz, -dx, -dz);
  out.k1 = 0;
  out.k2 = 0;
  out.node = -1;
  out.cap = 4.5;
  return out;
}
