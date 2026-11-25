// Where customers stand and where they want to go. Pure (no three.js): city data in, points out. Seeded rng in, so tests are
// deterministic. A hail spot is a pavement point beside a road: a point on a road edge's centre line, pushed sideways by
// half the road width plus a gap, and then checked (lake, other roads, block slab, colliders).
import { WORLD } from '../game/config.js';
import { districtAt } from '../world/layout.js';
import { FAMOUS_SPOTS, NEVER_DEST, RUSHER_DEST, TOURIST_DEST } from './fare-kinds.js';

export const SPOT = {
  gap: 1.6, // metres between the kerb and the customer
  roadPad: 0.8, // clearance from every road's edge
  band: 5, // the spot must lie within this many metres of its block's edge (the pavement band)
  colliderPad: 0.9,
  lakePad: 4,
  margin: 24, // keep off the map border
};

const GRID = 80;
const gridCache = new WeakMap();

/** Spatial index of the road edges (cells of 80 m); cached per city. */
function gridOf(city) {
  let g = gridCache.get(city);
  if (g) return g;
  g = { cells: new Map(), mids: [] };
  const key = (i, j) => `${i},${j}`;
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const b = city.nodes[e.b];
    g.mids[e.id] = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, ax: a.x, az: a.z };
    const i0 = Math.floor((Math.min(a.x, b.x) - e.w) / GRID);
    const i1 = Math.floor((Math.max(a.x, b.x) + e.w) / GRID);
    const j0 = Math.floor((Math.min(a.z, b.z) - e.w) / GRID);
    const j1 = Math.floor((Math.max(a.z, b.z) + e.w) / GRID);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let c = g.cells.get(k);
        if (!c) g.cells.set(k, (c = []));
        c.push(e);
      }
    }
  }
  g.key = key;
  gridCache.set(city, g);
  return g;
}

/** Distance from (x,z) to the centre line of the edge. */
export function distToEdge(city, e, x, z) {
  const a = city.nodes[e.a];
  const t = Math.max(0, Math.min(1, ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len));
  return Math.hypot(x - (a.x + e.dx * e.len * t), z - (a.z + e.dz * e.len * t));
}

/** Smallest (distance to a road's centre line minus half its width) over the roads near the point. Negative = on a road. */
export function roadClearance(city, x, z) {
  const g = gridOf(city);
  const c = g.cells.get(g.key(Math.floor(x / GRID), Math.floor(z / GRID)));
  let best = Infinity;
  if (c) for (const e of c) best = Math.min(best, distToEdge(city, e, x, z) - e.w / 2);
  // a point can be within reach of a road registered in a neighbouring cell only: check those too
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const cc = g.cells.get(g.key(Math.floor(x / GRID) + di, Math.floor(z / GRID) + dj));
      if (cc) for (const e of cc) best = Math.min(best, distToEdge(city, e, x, z) - e.w / 2);
    }
  }
  return best;
}

/** The road whose centre line is nearest to (x, z): { edge, w, dist (to the centre line), x, z (that road point), t }. */
export function nearestRoadInfo(city, x, z) {
  const g = gridOf(city);
  const ci = Math.floor(x / GRID);
  const cj = Math.floor(z / GRID);
  let best = null;
  let bd = Infinity;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const c = g.cells.get(g.key(ci + di, cj + dj));
      if (!c) continue;
      for (const e of c) {
        const d = distToEdge(city, e, x, z);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
    }
  }
  if (!best) {
    for (const e of city.edges) {
      const d = distToEdge(city, e, x, z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
  }
  if (!best) return null;
  const a = city.nodes[best.a];
  const t = Math.max(0, Math.min(1, ((x - a.x) * best.dx + (z - a.z) * best.dz) / best.len));
  return { edge: best.id, w: best.w, dist: bd, x: a.x + best.dx * best.len * t, z: a.z + best.dz * best.len * t, t };
}

export function insideLake(city, x, z, pad = SPOT.lakePad) {
  const [cx, cz] = WORLD.lakeCenter;
  const [rx, rz] = WORLD.lakeRadii;
  return ((x - cx) / (rx + pad)) ** 2 + ((z - cz) / (rz + pad)) ** 2 < 1;
}

/** The block (land between roads) a point is in, or null. */
export function blockAt(city, x, z) {
  for (const b of city.blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
  return null;
}

/** Is (x,z) a good place to stand and wave? Not the lake, not on a road, on a block's pavement band, not inside a collider. */
export function isValidHailSpot(city, colliders, x, z) {
  const lim = city.half - SPOT.margin;
  if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
  if (insideLake(city, x, z)) return false;
  if (roadClearance(city, x, z) < SPOT.roadPad) return false;
  const b = blockAt(city, x, z);
  if (!b || b.type === 'water') return false;
  if (Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z) > SPOT.band) return false;
  if (colliders && colliders.inside(x, z, SPOT.colliderPad)) return false;
  return true;
}

/**
 * A spot a shop or metro station supplied itself (`hail`): checked leniently (off the lake, off the road, not in a solid collider).
 * Returns a hail-spot record facing the nearest road, or null.
 */
export function spotFromPlace(city, colliders, hail, meta = {}) {
  if (!hail || !Number.isFinite(hail.x) || !Number.isFinite(hail.z)) return null;
  const lim = city.half - SPOT.margin;
  if (Math.abs(hail.x) > lim || Math.abs(hail.z) > lim) return null;
  if (insideLake(city, hail.x, hail.z)) return null;
  if (roadClearance(city, hail.x, hail.z) < 0.4) return null;
  if (colliders && colliders.inside(hail.x, hail.z, 0.4)) return null;
  const info = nearestRoadInfo(city, hail.x, hail.z);
  if (!info) return null;
  return { x: hail.x, z: hail.z, edge: info.edge, t: info.t, road: { x: info.x, z: info.z }, face: Math.atan2(info.x - hail.x, info.z - hail.z), district: districtAt(hail.x, hail.z).id, ...meta };
}

/** Build a hail-spot record from a road edge, a position t along it and a side (+1 / -1). Not validated. */
function spotOnEdge(city, e, t, side, extra = 0) {
  const a = city.nodes[e.a];
  const cx = a.x + e.dx * e.len * t;
  const cz = a.z + e.dz * e.len * t;
  const off = e.w / 2 + SPOT.gap + extra;
  const nx = -e.dz * side;
  const nz = e.dx * side;
  const x = cx + nx * off;
  const z = cz + nz * off;
  return { x, z, edge: e.id, t, road: { x: cx, z: cz }, face: Math.atan2(cx - x, cz - z), district: districtAt(x, z).id };
}

/**
 * A random valid hail spot on the pavement `minD`..`maxD` metres from (px, pz).
 * opts: { px, pz, minD, maxD, biasX, biasZ, bias (0..1 odds of insisting on that direction), avoid: [{x,z}], spacing, tries, district: skip these ids }
 * -> { x, z, edge, t, road:{x,z}, face (heading that looks at the road), district } or null.
 */
export function pickHailSpot(city, colliders, rng, opts) {
  const { px, pz, minD = 120, maxD = 450, avoid = [], spacing = 45, tries = 70 } = opts;
  const reach = [];
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    // nearest point of the edge to the player decides whether the edge can hold a spot in the ring
    const t = Math.max(0, Math.min(1, ((px - a.x) * e.dx + (pz - a.z) * e.dz) / e.len));
    const dn = Math.hypot(px - (a.x + e.dx * e.len * t), pz - (a.z + e.dz * e.len * t));
    const far = Math.hypot(px - (a.x + e.dx * e.len * (t > 0.5 ? 0 : 1)), pz - (a.z + e.dz * e.len * (t > 0.5 ? 0 : 1)));
    if (e.len >= 14 && dn <= maxD && far >= minD) reach.push(e);
  }
  if (!reach.length) return null;
  const bx = opts.biasX || 0;
  const bz = opts.biasZ || 0;
  const biased = (opts.bias || 0) > 0 && (bx || bz);
  for (let i = 0; i < tries; i++) {
    const e = reach[Math.floor(rng() * reach.length)];
    const s = spotOnEdge(city, e, rng.range(0.06, 0.94), rng.sign());
    const d = Math.hypot(s.x - px, s.z - pz);
    if (d < minD || d > maxD) continue;
    if (biased && rng() < opts.bias && ((s.x - px) * bx + (s.z - pz) * bz) / d < 0.35) continue;
    if (opts.skipDistricts && opts.skipDistricts.includes(s.district) && rng() < 0.8) continue;
    let near = false;
    for (const o of avoid) {
      if (Math.hypot(s.x - o.x, s.z - o.z) < spacing) {
        near = true;
        break;
      }
    }
    if (near) continue;
    if (isValidHailSpot(city, colliders, s.x, s.z)) return s;
  }
  return null;
}

/** A valid hail spot on the pavement in front of a famous place (poi). Tries a few spots along the road, both sides. */
export function pickPoiHailSpot(city, colliders, rng, poi, avoid = [], spacing = 30) {
  const e = city.edges[poi.front?.edge];
  if (!e) return null;
  const toPoi = (-e.dz) * (poi.x - poi.front.x) + e.dx * (poi.z - poi.front.z); // + : the poi lies on the +1 side
  const first = toPoi >= 0 ? 1 : -1;
  const t0 = poi.front.t ?? 0.5;
  for (let i = 0; i < 28; i++) {
    const side = i % 3 === 2 ? -first : first;
    const dt = i === 0 ? 0 : rng.range(-26, 26) / e.len;
    const s = spotOnEdge(city, e, Math.max(0.03, Math.min(0.97, t0 + dt)), side);
    if (avoid.some((o) => Math.hypot(s.x - o.x, s.z - o.z) < spacing)) continue;
    if (isValidHailSpot(city, colliders, s.x, s.z)) return { ...s, poiId: poi.id };
  }
  return null;
}

/** Which famous place (if any) to try for a spawn: one of FAMOUS_SPOTS inside the ring, not already crowded. */
export function pickFamousPoi(city, rng, { px, pz, minD = 120, maxD = 450, taken = [] }) {
  const pool = [];
  for (const id of Object.keys(FAMOUS_SPOTS)) {
    const p = city.poiById[id];
    if (!p || taken.includes(id)) continue;
    const d = Math.hypot((p.front?.x ?? p.x) - px, (p.front?.z ?? p.z) - pz);
    if (d >= minD && d <= maxD) pool.push(p);
  }
  return pool.length ? rng.pick(pool) : null;
}

const dest = (p) => ({ x: p.front.x, z: p.front.z, name: p.name, te: p.te || p.name, poiId: p.id, front: { x: p.front.x, z: p.front.z, edge: p.front.edge, t: p.front.t }, road: false });

/**
 * Where a customer wants to go, 250..1100 m (straight line) from `from`; never the garage or a CNG pump.
 * kind: tourist -> a landmark, rusher -> station / airport / hospital, others -> a poi or a road spot.
 */
export function pickDestination(city, rng, kind, from, opts = {}) {
  const { minD = 250, maxD = 1100, exclude = [], extra = [] } = opts;
  const ok = (p) => p?.front && Number.isFinite(p.front.x) && !NEVER_DEST.includes(p.id) && !exclude.includes(p.id);
  const extras = extra.filter(ok);
  const within = (p, lo, hi) => {
    const d = Math.hypot(p.front.x - from.x, p.front.z - from.z);
    return d >= lo && d <= hi;
  };
  const named = (ids) => ids.map((id) => city.poiById[id]).filter(ok);
  const attempt = (pool, lo, hi) => {
    const list = pool.filter((p) => within(p, lo, hi));
    return list.length ? dest(rng.pick(list)) : null;
  };
  let pool = null;
  if (kind === 'tourist') pool = named(TOURIST_DEST);
  else if (kind === 'rusher') pool = named(RUSHER_DEST).concat(extras.filter((p) => p.kind === 'metro'));
  else if (rng.chance(0.45)) pool = city.pois.filter(ok).concat(extras);
  if (pool) {
    const d = attempt(pool, minD, maxD) || attempt(pool, minD * 0.5, maxD * 1.35);
    if (d) return d;
    if (kind === 'tourist' || kind === 'rusher') {
      const any = attempt(city.pois.filter(ok), minD, maxD);
      if (any) return any;
    }
  }
  // a road spot
  for (let i = 0; i < 80; i++) {
    const e = city.edges[Math.floor(rng() * city.edges.length)];
    if (e.len < 30) continue;
    const t = rng.range(0.3, 0.7);
    const a = city.nodes[e.a];
    const x = a.x + e.dx * e.len * t;
    const z = a.z + e.dz * e.len * t;
    const d = Math.hypot(x - from.x, z - from.z);
    if (d < minD || d > maxD || insideLake(city, x, z, 0)) continue;
    const dist = districtAt(x, z);
    return { x, z, name: `${e.name}, ${dist.name}`, te: dist.te || 'శివార్లు', poiId: null, front: { x, z, edge: e.id, t }, road: true };
  }
  // last resort: any poi, however far
  const all = city.pois.filter(ok);
  return dest(all.reduce((best, p) => (!best || Math.abs(Math.hypot(p.front.x - from.x, p.front.z - from.z) - 600) < Math.abs(Math.hypot(best.front.x - from.x, best.front.z - from.z) - 600) ? p : best), null));
}
