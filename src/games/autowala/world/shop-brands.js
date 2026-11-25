// Pure data and planning for the branded shopfronts (no three.js, no DOM): brand configs, where each building stands on its
// reserved block and which way it faces, where customers wait (`hail`), where the pavement stalls go, and the logo-override
// helpers. world/shops.js turns these plans into geometry. The wordmarks themselves are drawn in code (no logo files bundled).
import { nearestRoad } from './layout.js';
import { onRoad } from './roads.js';
import { makeRng } from '../game/rng.js';

/** Depth of the pavement forecourt between the road edge and the shop front, and the gaps at the sides and back (m). */
export const FORECOURT = 6;
export const BACK_GAP = 3;
export const SIDE_GAP = 3;
/** How far from the kerb a waiting customer stands (m): clear of steps and planters, still on the pavement. */
export const HAIL_FROM_KERB = 3.2;

/**
 * Brand configs. `W`/`D` is the nominal footprint (width along the street x depth), `minW`/`minD` the smallest we will build,
 * `hailX` where along the frontage (fraction of W, from the centre, looking at the shop) customers wait.
 */
export const BRANDS = {
  paradise: { id: 'paradise', name: 'Paradise Biryani', te: 'పారడైజ్', kind: 'restaurant', W: 26, D: 17, minW: 18, minD: 12, hailX: 0.3, storeys: 4 },
  bawarchi: { id: 'bawarchi', name: 'Bawarchi', te: 'బావర్చి', kind: 'restaurant', W: 24, D: 16, minW: 18, minD: 12, hailX: -0.3, storeys: 4 },
  delhi: { id: 'delhi', name: 'Delhi Mithai Wala', te: 'ఢిల్లీ మిఠాయి వాలా', kind: 'sweets', W: 22, D: 13, minW: 16, minD: 10, hailX: -0.28, storeys: 2 },
  oyo: { id: 'oyo', name: 'OYO Rooms', te: 'ఓయో', kind: 'hotel', W: 20, D: 15, minW: 15, minD: 11, hailX: 0.3, storeys: 4 },
};
export const BRAND_IDS = Object.keys(BRANDS);

/** The brand a poi is built as, or null. The original `paradise` landmark has no `brand` field in layout.js. */
export function brandOf(poi) {
  if (poi.brand && BRANDS[poi.brand]) return poi.brand;
  if (poi.id === 'paradise') return 'paradise';
  return null;
}

// ---------------------------------------------------------------------------------------------- logo override (pure)
export const OVERRIDE_EXT = ['png', 'webp', 'svg'];
/** Same-origin URLs probed for a brand's optional logo file, in priority order. */
export function overrideUrls(brand, base = '/') {
  const b = base.endsWith('/') ? base : `${base}/`;
  return OVERRIDE_EXT.map((ext) => `${b}art/brands/${brand}.${ext}`);
}
/** First candidate that loaded: results = [{ url, ok }] in the same order as overrideUrls. */
export function pickOverride(results) {
  for (const r of results) if (r && r.ok) return r.url;
  return null;
}
/** Scale a w x h image to fit (contain) inside bw x bh, centred. */
export function fitContain(w, h, bw, bh) {
  if (!(w > 0) || !(h > 0)) return { x: 0, y: 0, w: bw, h: bh };
  const s = Math.min(bw / w, bh / h);
  return { x: (bw - w * s) / 2, y: (bh - h * s) / 2, w: w * s, h: h * s };
}

// ---------------------------------------------------------------------------------------------- building plans
const even = (v) => Math.round(v / 2) * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Local (lx across, lz out of the front face) -> world, for a building at (cx,cz) rotated `theta` about y. */
export function localToWorld(plan, lx, lz) {
  const c = Math.cos(plan.theta);
  const s = Math.sin(plan.theta);
  return { x: plan.cx + lx * c + lz * s, z: plan.cz - lx * s + lz * c };
}

/** Choose which side of the block the shop faces: the widest road, then the longest frontage. */
function chooseSide(poi, cfg, city) {
  const x0 = poi.x - poi.w / 2;
  const x1 = poi.x + poi.w / 2;
  const z0 = poi.z - poi.d / 2;
  const z1 = poi.z + poi.d / 2;
  const sides = [
    { f: [0, 1], depth: poi.d, span: poi.w, probe: [poi.x, z1 + 3] },
    { f: [0, -1], depth: poi.d, span: poi.w, probe: [poi.x, z0 - 3] },
    { f: [1, 0], depth: poi.w, span: poi.d, probe: [x1 + 3, poi.z] },
    { f: [-1, 0], depth: poi.w, span: poi.d, probe: [x0 - 3, poi.z] },
  ];
  let best = null;
  for (const s of sides) {
    const r = nearestRoad(city, s.probe[0], s.probe[1]);
    s.roadW = r && r.dist < r.edge.w / 2 + 6 ? r.edge.w : 0;
    s.fits = s.depth >= cfg.minD + FORECOURT + BACK_GAP && s.span >= cfg.minW + SIDE_GAP * 2;
    s.score = (s.fits ? 1000 : 0) + s.roadW * 10 + Math.min(s.span, 90) * 0.2;
    if (!best || s.score > best.score) best = s;
  }
  return best;
}

/** Plan one branded building on its block. Returns null when the block is hopelessly small. */
export function planBuilding(poi, city) {
  const brand = brandOf(poi);
  if (!brand) return null;
  const cfg = BRANDS[brand];
  const side = chooseSide(poi, cfg, city);
  const [fx, fz] = side.f;
  const W = clamp(even(side.span - SIDE_GAP * 2), cfg.minW, cfg.W);
  const D = clamp(even(side.depth - FORECOURT - BACK_GAP), cfg.minD, cfg.D);
  const half = side.depth / 2;
  const shift = half - FORECOURT - D / 2; // building centre, from the block centre, toward the front road
  const cx = poi.x + fx * shift;
  const cz = poi.z + fz * shift;
  const theta = Math.atan2(fx, fz);
  const plan = { id: poi.id, poiId: poi.id, brand, cfg, name: poi.name || cfg.name, te: poi.te || cfg.te, kind: cfg.kind, W, D, f: { x: fx, z: fz }, theta, cx, cz, x: cx, z: cz };
  // collider footprint in world axes (the facing is axis aligned)
  const swap = fx !== 0;
  plan.footprint = { cx, cz, w: swap ? D : W, d: swap ? W : D };
  const hailLocal = { lx: cfg.hailX * W, lz: D / 2 + FORECOURT - HAIL_FROM_KERB };
  plan.hail = localToWorld(plan, hailLocal.lx, hailLocal.lz);
  plan.entrance = localToWorld(plan, 0, D / 2);
  const r = nearestRoad(city, plan.hail.x, plan.hail.z);
  plan.front = r ? { x: r.x, z: r.z, edge: r.edge.id, t: r.t } : { x: plan.hail.x, z: plan.hail.z };
  return plan;
}

/** Every branded poi that was placed gets exactly one plan. */
export function planShops(city) {
  const out = [];
  for (const poi of city.pois) {
    const p = planBuilding(poi, city);
    if (p) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- pavement stalls
export const STALL_NAMES = [
  { name: 'Pani Puri Stall', te: 'పానీ పూరీ బండి', board: 0 },
  { name: 'Chaat Bandi', te: 'చాట్ బండి', board: 1 },
  { name: 'Golgappa Cart', te: 'గోల్గప్పా బండి', board: 2 },
];
/** Distance from the kerb to the stall centre, and to the standing spots (m). All within the 3.3 m building-free verge. */
export const STALL_FROM_KERB = 1.55;
export const STALL_HAIL_Z = 1.3; // hail spot, from the stall centre toward the customer side (m)
export const STALL_FOOT = { along: 2.0, deep: 1.2 }; // collider footprint of a stall (m)

function blockAt(city, x, z) {
  for (const b of city.blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
  return null;
}
/** Is (x,z) paved verge: inside a non-water block, within `max` m of its edge, and off the carriageway. */
export function onVerge(city, x, z, max = 3.3) {
  const b = blockAt(city, x, z);
  if (!b || b.type === 'water') return false;
  const edgeDist = Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z);
  if (edgeDist > max) return false;
  return !onRoad(city, x, z, 0.3);
}

/**
 * About `count` pavement stall sites on busy roads (more in the Old City and near stations). `blocked(x, z, pad)` should answer
 * truthy when a spot is inside a collider. Deterministic. -> [{ id, x, z, theta, hail:{x,z}, name, te, board, edge, t }]
 */
export function planStalls(city, { count = 25, blocked = () => false, avoid = [] } = {}) {
  const rng = makeRng((city.seed ?? 1) ^ 0x57a115);
  const hot = city.pois.filter((p) => ['station', 'charminar', 'mecca'].includes(p.id));
  const cand = [];
  for (const e of city.edges) {
    if (e.name === 'Necklace Road' || e.len < 40) continue;
    const a = city.nodes[e.a];
    const mid = { x: a.x + (e.dx * e.len) / 2, z: a.z + (e.dz * e.len) / 2 };
    let w = e.w >= 14 ? 1.6 : e.w >= 10 ? 1.2 : 1;
    if (Math.hypot(mid.x - 150, mid.z - 255) < 240) w *= 3.2; // Old City lanes
    for (const h of hot) if (Math.hypot(mid.x - h.x, mid.z - h.z) < 140) w *= 3;
    for (let s = 14; s < e.len - 14; s += 11) {
      for (const side of [1, -1]) cand.push({ e, a, s, side, w });
    }
  }
  const total = cand.reduce((t, c) => t + c.w, 0);
  const picked = [];
  const pickOne = () => {
    let r = rng() * total;
    for (const c of cand) {
      r -= c.w;
      if (r <= 0) return c;
    }
    return cand[cand.length - 1];
  };
  const MIN_GAP = 48;
  for (let tries = 0; tries < 4000 && picked.length < count && cand.length; tries++) {
    const c = pickOne();
    const nx = -c.e.dz * c.side;
    const nz = c.e.dx * c.side;
    const along = c.s + rng.range(-4, 4);
    const px = c.a.x + c.e.dx * along;
    const pz = c.a.z + c.e.dz * along;
    const sx = px + nx * (c.e.w / 2 + STALL_FROM_KERB);
    const sz = pz + nz * (c.e.w / 2 + STALL_FROM_KERB);
    if (picked.some((p) => Math.hypot(p.x - sx, p.z - sz) < MIN_GAP)) continue;
    const blk = blockAt(city, sx, sz);
    if (!blk || (blk.type !== 'normal' && blk.type !== 'landmark')) continue;
    if (!onVerge(city, sx, sz)) continue;
    // local frame of the stall: +z away from the road (n), +x = (nz, -nx); customers wait beside the counter
    const hx = sx + nz * 1.0 + nx * STALL_HAIL_Z;
    const hz = sz - nx * 1.0 + nz * STALL_HAIL_Z;
    if (!onVerge(city, hx, hz) || blocked(sx, sz, 1.3) || blocked(hx, hz, 0.5)) continue;
    if (avoid.some((a) => Math.hypot(a.x - sx, a.z - sz) < 14)) continue;
    const nameDef = STALL_NAMES[picked.length % STALL_NAMES.length];
    picked.push({
      id: `stall_${picked.length}`,
      x: sx,
      z: sz,
      // local +z points away from the road, toward the customers
      theta: Math.atan2(nx, nz),
      hail: { x: hx, z: hz },
      name: nameDef.name,
      te: nameDef.te,
      board: nameDef.board,
      edge: c.e.id,
      t: along / c.e.len,
    });
  }
  return picked;
}
