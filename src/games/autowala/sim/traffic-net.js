// Traffic on the road graph: what each kind of vehicle is, which way it goes at a junction, how busy each district is, and where
// new vehicles may appear. Pure (no three.js, no DOM) and unit-tested.
import { districtAt } from '../world/layout.js';
import { laneCount, lanePoint, linkSetback } from './traffic-lanes.js';

/**
 * Per-kind data. `circles` are z offsets (m, along the body) of the collision circles, `r` their radius. Masses are relative
 * (the player's auto with a fare aboard is ~600). `sf` scales the road's speed limit; `acc`/`brk` are comfortable m/s^2.
 */
export const KINDS = {
  car: { len: 3.9, wid: 1.7, mass: 1000, circles: [-1.2, 0, 1.2], r: 0.88, sf: 1.0, acc: 3.0, brk: 3.6, mix: 0.46, chase: 1.0, pitch: 1.0 },
  auto: { len: 2.9, wid: 1.45, mass: 450, circles: [-0.8, 0.8], r: 0.8, sf: 0.86, acc: 2.2, brk: 3.4, mix: 0.18, chase: 0.95, pitch: 1.25 },
  bike: { len: 2.0, wid: 0.7, mass: 190, circles: [-0.5, 0.5], r: 0.45, sf: 1.06, acc: 3.6, brk: 4.2, mix: 0.18, chase: 1.0, pitch: 1.7 },
  bus: { len: 10.5, wid: 2.5, mass: 9000, circles: [-3.9, -1.3, 1.3, 3.9], r: 1.3, sf: 0.8, acc: 1.6, brk: 2.6, mix: 0.09, chase: 0.7, pitch: 0.45 },
  truck: { len: 8.0, wid: 2.4, mass: 7000, circles: [-2.7, 0, 2.7], r: 1.25, sf: 0.76, acc: 1.4, brk: 2.4, mix: 0.09, chase: 0.75, pitch: 0.4 },
};
export const KIND_LIST = Object.keys(KINDS);
export const PLAYER_MASS = 600;

/** Pick a kind by the mix weights; `r` is a uniform number in [0, 1). */
export function pickKind(r) {
  let acc = 0;
  for (const k of KIND_LIST) {
    acc += KINDS[k].mix;
    if (r < acc) return k;
  }
  return 'car';
}

/** Posted speed (m/s) by road width: bazaar lanes crawl, avenues and the ring road flow. */
export function speedLimit(w) {
  if (w <= 9) return 8.6;
  if (w <= 12) return 11;
  if (w < 16) return 13;
  return 16.5;
}

/** Vehicles per unit of road, by district (data only: where the city is busy). */
const DENSITY = { old: 1.8, secbad: 1.3, hitech: 1.0, banjara: 0.8, mehdi: 1.1, golconda: 0.4, airport: 0.5, suburb: 0.6 };
export function districtDensity(id) {
  return DENSITY[id] ?? 0.6;
}
/** Relative traffic density at a point: the district's, boosted on avenues (`w` = width of the nearest road, optional). */
export function densityAt(x, z, w = 0) {
  return districtDensity(districtAt(x, z).id) * (w >= 15 ? 1.5 : 1);
}

/** Precompute per-edge midpoints, lengths of the playable stretch and spawn weights. */
export function buildNet(city) {
  const E = city.edges.length;
  const mx = new Float64Array(E);
  const mz = new Float64Array(E);
  const weight = new Float64Array(E);
  for (let i = 0; i < E; i++) {
    const e = city.edges[i];
    const a = city.nodes[e.a];
    mx[i] = a.x + e.dx * e.len * 0.5;
    mz[i] = a.z + e.dz * e.len * 0.5;
    weight[i] = densityAt(mx[i], mz[i], e.w) * (e.len > 24 ? 1 : 0.2);
  }
  return { city, mx, mz, weight, count: E };
}

const edgeBetween = (city, n, otherId) => {
  for (const id of n.out) {
    const e = city.edges[id];
    if (e.a === otherId || e.b === otherId) return e;
  }
  return null;
};

/**
 * The next edge at the end of (e1, dir1). Writes {edge, dir} into `out`. Roads are two-way, so every other edge at the node is a
 * candidate; going straight is preferred, buses and trucks shun the narrow lanes, and a U-turn only happens at a dead end.
 */
export function pickNextEdge(city, e1, dir1, kind, rnd, out = { edge: null, dir: 1 }) {
  const N = city.nodes[dir1 > 0 ? e1.b : e1.a];
  const d1x = e1.dx * dir1;
  const d1z = e1.dz * dir1;
  const big = kind === 'bus' || kind === 'truck';
  let total = 0;
  let any = false;
  for (const id of N.out) {
    if (id === e1.id) continue;
    any = true;
    const e = city.edges[id];
    const dir = e.a === N.id ? 1 : -1;
    const dot = e.dx * dir * d1x + e.dz * dir * d1z;
    total += (dot > 0.9 ? 3 : 1.4) * (big && e.w < 9 ? 0.08 : 1);
  }
  if (!any) {
    out.edge = e1;
    out.dir = -dir1;
    return out;
  }
  let r = rnd() * total;
  let last = null;
  let lastDir = 1;
  for (const id of N.out) {
    if (id === e1.id) continue;
    const e = city.edges[id];
    const dir = e.a === N.id ? 1 : -1;
    const dot = e.dx * dir * d1x + e.dz * dir * d1z;
    const w = (dot > 0.9 ? 3 : 1.4) * (big && e.w < 9 ? 0.08 : 1);
    last = e;
    lastDir = dir;
    r -= w;
    if (r <= 0) break;
  }
  out.edge = last;
  out.dir = lastDir;
  return out;
}

/**
 * The edge a chaser should take at the end of (e1, dir1) to reach `target` {x, z}. `route(from, to)` is the minimap agent's
 * router (a polyline along the roads, or [] when it has none): we follow its first leg. Without a usable route, fall back to the
 * outgoing edge that points most at the target (a U-turn when the target is behind and nothing else fits).
 */
export function chaseNextEdge(city, route, e1, dir1, target, out = { edge: null, dir: 1 }) {
  const N = city.nodes[dir1 > 0 ? e1.b : e1.a];
  let pts = null;
  if (route) {
    try {
      pts = route({ x: N.x, z: N.z }, target);
    } catch {
      pts = null;
    }
  }
  if (pts && pts.length >= 2) {
    let p1 = null;
    for (let i = 1; i < pts.length; i++) {
      if (Math.hypot(pts[i].x - N.x, pts[i].z - N.z) > 0.6) {
        p1 = pts[i];
        break;
      }
    }
    if (p1) {
      for (const id of N.out) {
        const e = city.edges[id];
        const dir = e.a === N.id ? 1 : -1;
        // does p1 lie on this edge (leaving the node)? distance from the segment
        const t = (p1.x - N.x) * e.dx * dir + (p1.z - N.z) * e.dz * dir;
        if (t < 0.3 || t > e.len + 0.6) continue;
        const px = N.x + e.dx * dir * t;
        const pz = N.z + e.dz * dir * t;
        if (Math.hypot(p1.x - px, p1.z - pz) < 0.9) {
          out.edge = e;
          out.dir = dir;
          return out;
        }
      }
    }
  }
  // greedy fallback
  let best = null;
  let bestScore = -Infinity;
  const tx = target.x - N.x;
  const tz = target.z - N.z;
  const tl = Math.hypot(tx, tz) || 1;
  for (const id of N.out) {
    const e = city.edges[id];
    const dir = e.a === N.id ? 1 : -1;
    let score = (e.dx * dir * tx + e.dz * dir * tz) / tl;
    if (e.id === e1.id) score -= 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = { e, dir };
    }
  }
  out.edge = best ? best.e : e1;
  out.dir = best ? best.dir : -dir1;
  return out;
}

export { edgeBetween };

/**
 * Where a new vehicle may appear: a random road point 60..450 m (default) from the player, in a random direction and lane, chosen
 * with the district densities as weights. `reject(x, z, edge, dir, lane, u)` lets the caller veto (out of sight, occupied).
 * Returns null when nothing fits after a few tries. Writes {edge, dir, lane, u, x, z, heading} into `out`.
 */
export function pickSpawn(net, px, pz, rnd, { rMin = 60, rMax = 450, reject = null, tries = 8 } = {}, out = { edge: null, dir: 1, lane: 0, u: 0, x: 0, z: 0, heading: 0 }) {
  const { city } = net;
  // weighted pick among the edges that reach into the ring (reservoir sampling by weight)
  let total = 0;
  let pick = -1;
  for (let i = 0; i < net.count; i++) {
    const e = city.edges[i];
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(e.len, (px - a.x) * e.dx + (pz - a.z) * e.dz));
    const near = Math.hypot(px - (a.x + e.dx * t), pz - (a.z + e.dz * t));
    if (near > rMax) continue;
    // the far end must be beyond rMin for the edge to hold a point in the ring
    const far = Math.max(Math.hypot(px - a.x, pz - a.z), Math.hypot(px - (a.x + e.dx * e.len), pz - (a.z + e.dz * e.len)));
    if (far < rMin) continue;
    // nearer roads are likelier: the ring is dense around the player and thins out towards its rim
    const w = net.weight[i] / (1 + near / 140);
    total += w;
    if (rnd() * total < w) pick = i;
  }
  if (pick < 0) return null;
  const e = city.edges[pick];
  for (let k = 0; k < tries; k++) {
    const dir = rnd() < 0.5 ? 1 : -1;
    const lane = laneCount(e.w) > 1 ? (rnd() < 0.5 ? 0 : 1) : 0;
    const margin = Math.min(e.len * 0.3, 8);
    const u = margin + rnd() * Math.max(0.1, e.len - 2 * margin);
    lanePoint(city, e, dir, lane, u, out);
    const d = Math.hypot(out.x - px, out.z - pz);
    if (d < rMin || d > rMax) continue;
    out.edge = e;
    out.dir = dir;
    out.lane = lane;
    out.u = u;
    if (reject && reject(out.x, out.z, e, dir, lane, u)) continue;
    return out;
  }
  return null;
}

/** Is a point on a road (within the carriageway)? Linear scan: for tests and rare checks. */
export function onAnyRoad(city, x, z, pad = 0.01) {
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(e.len, (x - a.x) * e.dx + (z - a.z) * e.dz));
    if (Math.hypot(x - (a.x + e.dx * t), z - (a.z + e.dz * t)) <= e.w / 2 + pad) return e;
  }
  return null;
}

export { linkSetback };
