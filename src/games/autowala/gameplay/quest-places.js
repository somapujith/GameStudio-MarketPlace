// OWNER: quests agent. Where missions put their waypoints. PURE: reads world.city (nodes / edges / pois with `front`) only.
// Rule: every timed waypoint sits ON A ROAD (a point of an edge centreline, a junction, or a poi `front`, which is the nearest road
// point), so the player never has to climb a kerb at speed to reach it.
import { districtAt, nearestRoad } from '../world/layout.js';
import { makePath } from './quest-math.js';

const hyp = Math.hypot;
export const AVG_SPEED = { easy: 9.5, medium: 11, hard: 12.5 }; // m/s a route takes on average in the real game

/** The poi's road front as a place { x, z, name, te, id } or null. */
export function frontOf(city, id) {
  const p = city?.poiById?.[id];
  if (!p?.front || !Number.isFinite(p.front.x)) return null;
  return { x: p.front.x, z: p.front.z, name: p.name, te: p.te || p.name, id: p.id };
}

/** Snap any point to the road network: { x, z, edge, name } (the nearest centreline point). */
export function snapToRoad(city, x, z) {
  const r = nearestRoad(city, x, z);
  return r ? { x: r.x, z: r.z, edge: r.edge.id, name: r.edge.name || 'the road', w: r.edge.w } : { x, z, edge: -1, name: 'the road', w: 8 };
}

/** "Road name, District" for a road point (used in step labels). */
export function placeLabel(city, p) {
  const d = districtAt(p.x, p.z);
  const road = p.name || snapToRoad(city, p.x, p.z).name;
  return `${road}, ${d.name}`;
}

/** Whole seconds, rounded up to a multiple of 5. */
export const roundTime = (s) => Math.max(10, Math.ceil(s / 5) * 5);

/** A time limit for a route of `len` metres: len / average speed, times slack, plus a fixed allowance. */
export const timeFor = (len, level = 'medium', slack = 1.15, extra = 15) => roundTime((len / AVG_SPEED[level]) * slack + extra);

/**
 * A random point on a road centreline whose distance from `around` is in [minD, maxD]. Edges shorter than `minLen` are skipped
 * (no spots on stubs), and the point stays 15% away from the junction ends. Returns a place or null.
 */
export function roadSpot(city, rng, around, { minD = 80, maxD = 300, minLen = 40, minW = 0, avoid = [], avoidR = 60 } = {}) {
  const edges = city.edges;
  if (!edges?.length) return null;
  for (let i = 0; i < 300; i++) {
    const e = edges[Math.floor(rng() * edges.length)];
    if (e.len < minLen || (e.w || 0) < minW) continue;
    const t = 0.15 + rng() * 0.7;
    const a = city.nodes[e.a];
    const x = a.x + e.dx * e.len * t;
    const z = a.z + e.dz * e.len * t;
    const d = hyp(x - around.x, z - around.z);
    if (d < minD || d > maxD) continue;
    if (avoid.some((q) => hyp(x - q.x, z - q.z) < avoidR)) continue;
    return { x, z, edge: e.id, name: e.name || 'the road', w: e.w };
  }
  return null;
}

/** Junction points ("nodes") within [minD, maxD] of `around`, shuffled by rng, each at least `spacing` from the picked ones. */
export function junctionSpots(city, rng, around, count, { minD = 60, maxD = 320, spacing = 70, minDeg = 3 } = {}) {
  const pool = city.nodes.filter((n) => {
    const d = hyp(n.x - around.x, n.z - around.z);
    return d >= minD && d <= maxD && (n.out?.length || 0) >= minDeg;
  });
  rng.shuffle(pool);
  const out = [];
  for (const n of pool) {
    if (out.length >= count) break;
    if (out.some((q) => hyp(q.x - n.x, q.z - n.z) < spacing)) continue;
    out.push({ x: n.x, z: n.z, node: n.id });
  }
  return out;
}

/** Order points greedily by nearest neighbour starting from `from`; returns { order, length (straight-line sum) }. */
export function nearestOrder(from, pts) {
  const left = pts.slice();
  const order = [];
  let cur = from;
  let length = 0;
  while (left.length) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = hyp(left[i].x - cur.x, left[i].z - cur.z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    length += bd;
    cur = left.splice(bi, 1)[0];
    order.push(cur);
  }
  return { order, length };
}

/** Path from a router result; `route(a, b)` is the routing function. Falls back to a straight two-point path. */
export function pathBetween(route, a, b) {
  const pts = route(a, b);
  return makePath(pts && pts.length > 1 ? pts : [a, b]);
}

/**
 * Long straight road stretches for stunt ramps: edges at least `minLen` long, within [minD, maxD] of `around`, spread apart.
 * Returns [{ x, z, dx, dz, edge, len }] (x,z = edge middle, d = unit direction).
 */
export function rampSites(city, rng, around, count, { minLen = 70, minW = 8, minD = 60, maxD = 380, spacing = 110 } = {}) {
  const pool = city.edges.filter((e) => {
    if (e.len < minLen || (e.w || 0) < minW || e.curve) return false;
    const a = city.nodes[e.a];
    const mx = a.x + e.dx * e.len * 0.5;
    const mz = a.z + e.dz * e.len * 0.5;
    const d = hyp(mx - around.x, mz - around.z);
    return d >= minD && d <= maxD;
  });
  rng.shuffle(pool);
  const out = [];
  for (const e of pool) {
    if (out.length >= count) break;
    const a = city.nodes[e.a];
    const x = a.x + e.dx * e.len * 0.5;
    const z = a.z + e.dz * e.len * 0.5;
    if (out.some((q) => hyp(q.x - x, q.z - z) < spacing)) continue;
    const s = rng() < 0.5 ? 1 : -1;
    out.push({ x, z, dx: e.dx * s, dz: e.dz * s, edge: e.id, len: e.len, name: e.name || 'the road' });
  }
  return out;
}
