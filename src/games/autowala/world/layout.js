// The map of Hyderabad as data: districts, a road network (BSP-split streets with T-junctions, a ring road, Necklace Road
// around Hussain Sagar), blocks (the land between roads), landmark blocks, and the road graph traffic and quests use.
// Pure: no three.js, no DOM. The same seed always builds the same city. North is -z, east is +x.
import { WORLD } from '../game/config.js';
import { makeRng } from '../game/rng.js';

/** Districts: where they are, how fine their street grid is, and what gets built there. */
export const DISTRICTS = [
  { id: 'old', name: 'Old City', te: 'పాత నగరం', center: [150, 255], r: 230, block: 40, road: 8, h: [7, 17], style: 'bazaar' },
  { id: 'secbad', name: 'Secunderabad', te: 'సికింద్రాబాద్', center: [110, -520], r: 240, block: 58, road: 11, h: [10, 26], style: 'town' },
  { id: 'hitech', name: 'Hi-Tech City', te: 'హైటెక్ సిటీ', center: [-440, -80], r: 250, block: 100, road: 16, h: [34, 112], style: 'glass' },
  { id: 'banjara', name: 'Banjara Hills', te: 'బంజారా హిల్స్', center: [-215, 150], r: 210, block: 74, road: 10, h: [6, 13], style: 'villa' },
  { id: 'mehdi', name: 'Mehdipatnam', te: 'మెహదీపట్నం', center: [-110, 390], r: 190, block: 56, road: 10, h: [9, 22], style: 'town' },
  { id: 'golconda', name: 'Golconda', te: 'గోల్కొండ', center: [-570, 410], r: 190, block: 118, road: 9, h: [5, 9], style: 'rural' },
  { id: 'airport', name: 'Shamshabad', te: 'శంషాబాద్', center: [-70, 620], r: 150, block: 135, road: 14, h: [6, 13], style: 'airport' },
];
const SUBURB = { id: 'suburb', name: 'Outskirts', te: '', center: [0, 0], r: 0, block: 84, road: 10, h: [5, 11], style: 'town' };

export function districtAt(x, z) {
  let best = null;
  let bestScore = 1;
  for (const d of DISTRICTS) {
    const s = Math.hypot(x - d.center[0], z - d.center[1]) / d.r;
    if (s < bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best || SUBURB;
}

/** Landmarks and where they want to stand (the nearest big-enough block is chosen). `need` = smallest block side (m). */
export const LANDMARKS = [
  { id: 'charminar', name: 'Charminar', te: 'చార్మినార్', at: [150, 252], need: 36, kind: 'monument' },
  { id: 'mecca', name: 'Mecca Masjid', te: 'మక్కా మసీదు', at: [88, 290], need: 40, kind: 'monument' },
  { id: 'station', name: 'Secunderabad Station', te: 'సికింద్రాబాద్ స్టేషన్', at: [110, -505], need: 48, kind: 'monument' },
  { id: 'paradise', brand: 'paradise', name: 'Paradise Biryani', te: 'పారడైజ్', at: [-10, -420], need: 40, kind: 'shop' },
  { id: 'cyber', name: 'Cyber Towers', te: 'సైబర్ టవర్స్', at: [-430, -70], need: 80, kind: 'monument' },
  { id: 'birla', name: 'Birla Mandir', te: 'బిర్లా మందిర్', at: [-95, -35], need: 44, kind: 'monument' },
  { id: 'golconda', name: 'Golconda Fort', te: 'గోల్కొండ కోట', at: [-580, 430], need: 100, kind: 'monument' },
  { id: 'airport', name: 'Airport', te: 'విమానాశ్రయం', at: [-70, 625], need: 110, kind: 'monument' },
  { id: 'garage', name: "Mama's Garage", te: 'మామా గ్యారేజ్', at: [190, 330], need: 30, kind: 'service' },
  { id: 'stadium', name: 'Uppal Stadium', te: 'ఉప్పల్ స్టేడియం', at: [420, -150], need: 70, kind: 'monument' },
  { id: 'hospital', name: 'Care Hospital', te: 'కేర్ హాస్పిటల్', at: [-210, 215], need: 44, kind: 'service' },
  { id: 'irani', name: 'Nimrah Irani Cafe', te: 'ఇరానీ చాయ్', at: [118, 238], need: 26, kind: 'shop' },
  { id: 'cng_old', name: 'CNG - Old City', te: '', at: [250, 190], need: 30, kind: 'cng' },
  { id: 'cng_north', name: 'CNG - Secunderabad', te: '', at: [190, -440], need: 30, kind: 'cng' },
  { id: 'cng_west', name: 'CNG - Hi-Tech', te: '', at: [-330, 40], need: 34, kind: 'cng' },
  { id: 'cng_south', name: 'CNG - Mehdipatnam', te: '', at: [-30, 340], need: 30, kind: 'cng' },
  // Branded Hyderabad shopfronts (several branches each, like the real chains). Appended LAST so they only claim blocks the
  // landmarks above left free. `brand` selects the facade built by world/shops.js; customers hail outside them.
  { id: 'paradise_old', brand: 'paradise', name: 'Paradise Biryani', te: 'పారడైజ్', at: [200, 215], need: 34, kind: 'shop' },
  { id: 'bawarchi_secbad', brand: 'bawarchi', name: 'Bawarchi', te: 'బావర్చి', at: [150, -380], need: 34, kind: 'shop' },
  { id: 'bawarchi_banjara', brand: 'bawarchi', name: 'Bawarchi', te: 'బావర్చి', at: [-150, 95], need: 34, kind: 'shop' },
  { id: 'delhi_banjara', brand: 'delhi', name: 'Delhi Mithai Wala', te: 'ఢిల్లీ మిఠాయి వాలా', at: [-255, 180], need: 30, kind: 'shop' },
  { id: 'delhi_hitech', brand: 'delhi', name: 'Delhi Mithai Wala', te: 'ఢిల్లీ మిఠాయి వాలా', at: [-380, -10], need: 30, kind: 'shop' },
  { id: 'oyo_mehdi', brand: 'oyo', name: 'OYO Rooms', te: 'ఓయో', at: [-90, 360], need: 34, kind: 'shop' },
  { id: 'oyo_hitech', brand: 'oyo', name: 'OYO Rooms', te: 'ఓయో', at: [-430, 115], need: 34, kind: 'shop' },
  { id: 'oyo_secbad', brand: 'oyo', name: 'OYO Rooms', te: 'ఓయో', at: [230, -390], need: 34, kind: 'shop' },
];

const SNAP = 2;
const snap = (v) => Math.round(v / SNAP) * SNAP;

/** Lake: water radii, and the promenade (Necklace Road) ring just outside it. */
export function lakeGeometry() {
  const [cx, cz] = WORLD.lakeCenter;
  const [rx, rz] = WORLD.lakeRadii;
  const park = 30; // palm-lined strip between the water and the road
  return { cx, cz, rx, rz, ringX: rx + park, ringZ: rz + park, park };
}
const insideEllipse = (x, z, L, ex = 0) => ((x - L.cx) / (L.ringX + ex)) ** 2 + ((z - L.cz) / (L.ringZ + ex)) ** 2 < 1;

/** Clip an axis-aligned segment against the promenade ellipse -> list of [a, b] pieces outside it. */
function clipSegment(axis, c, a, b, L) {
  // axis 'z': the line z = c runs along x from a to b. axis 'x': the line x = c runs along z.
  const k = axis === 'z' ? (c - L.cz) / L.ringZ : (c - L.cx) / L.ringX;
  if (Math.abs(k) >= 1) return [[a, b]];
  const half = Math.sqrt(1 - k * k) * (axis === 'z' ? L.ringX : L.ringZ);
  const mid = axis === 'z' ? L.cx : L.cz;
  const lo = mid - half;
  const hi = mid + half;
  const out = [];
  if (a < lo) out.push([a, Math.min(b, lo)]);
  if (b > hi) out.push([Math.max(a, hi), b]);
  return out.filter(([p, q]) => q - p > 18);
}

export function generateCity(seed = 1) {
  const rng = makeRng(seed ^ 0x9e3779b9);
  const H = WORLD.half;
  const L = lakeGeometry();
  const segments = [];
  const leaves = [];

  // ---- the ring road along the border
  const rb = H - 14;
  const ringW = 18;
  segments.push({ axis: 'z', c: -rb, a: -rb, b: rb, w: ringW, depth: 0, name: 'Outer Ring Road' });
  segments.push({ axis: 'z', c: rb, a: -rb, b: rb, w: ringW, depth: 0, name: 'Outer Ring Road' });
  segments.push({ axis: 'x', c: -rb, a: -rb, b: rb, w: ringW, depth: 0, name: 'Outer Ring Road' });
  segments.push({ axis: 'x', c: rb, a: -rb, b: rb, w: ringW, depth: 0, name: 'Outer Ring Road' });

  // ---- BSP: split the area inside the ring into blocks; the finer the district grid, the more splits
  const avenueW = (depth) => (depth <= 1 ? 20 : depth === 2 ? 15 : 0);
  function split(r, depth) {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const dist = districtAt(cx, cz);
    const target = dist.block;
    if (w <= target * 1.5 && d <= target * 1.5) {
      leaves.push({ ...r, district: dist.id });
      return;
    }
    const cutX = w >= d ? w > target * 1.2 : !(d > target * 1.2);
    const jitter = rng.range(0.4, 0.6);
    const rw = Math.max(dist.road, avenueW(depth));
    if (cutX) {
      const px = snap(r.x0 + w * jitter);
      segments.push({ axis: 'x', c: px, a: r.z0, b: r.z1, w: rw, depth });
      split({ ...r, x1: px, wR: rw / 2 }, depth + 1);
      split({ ...r, x0: px, wL: rw / 2 }, depth + 1);
    } else {
      const pz = snap(r.z0 + d * jitter);
      segments.push({ axis: 'z', c: pz, a: r.x0, b: r.x1, w: rw, depth });
      split({ ...r, z1: pz, wB: rw / 2 }, depth + 1);
      split({ ...r, z0: pz, wT: rw / 2 }, depth + 1);
    }
  }
  split({ x0: -rb, x1: rb, z0: -rb, z1: rb, wL: ringW / 2, wR: ringW / 2, wT: ringW / 2, wB: ringW / 2 }, 0);

  // ---- clip roads against the lake, collect nodes
  const clipped = [];
  for (const s of segments) {
    for (const [a, b] of clipSegment(s.axis, s.c, s.a, s.b, L)) clipped.push({ ...s, a, b, shore: a !== s.a || b !== s.b });
  }

  const nodes = [];
  const nodeAt = new Map();
  const keyOf = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  const getNode = (x, z) => {
    const k = keyOf(x, z);
    let n = nodeAt.get(k);
    if (!n) {
      n = { id: nodes.length, x, z, out: [], w: 0, curve: false };
      nodes.push(n);
      nodeAt.set(k, n);
    }
    return n;
  };
  const endpoints = [];
  for (const s of clipped) {
    const p1 = s.axis === 'z' ? [s.a, s.c] : [s.c, s.a];
    const p2 = s.axis === 'z' ? [s.b, s.c] : [s.c, s.b];
    endpoints.push(getNode(p1[0], p1[1]), getNode(p2[0], p2[1]));
  }
  // every node that lies on a segment splits it
  const edges = [];
  const addEdge = (na, nb, w, name, curve = false) => {
    const dx = nb.x - na.x;
    const dz = nb.z - na.z;
    const len = Math.hypot(dx, dz);
    if (len < 1) return;
    const e = { id: edges.length, a: na.id, b: nb.id, len, w, dx: dx / len, dz: dz / len, name: name || '', curve };
    edges.push(e);
    na.out.push(e.id);
    nb.out.push(e.id);
    na.w = Math.max(na.w, w);
    nb.w = Math.max(nb.w, w);
  };
  for (const s of clipped) {
    const on = nodes.filter((n) => (s.axis === 'z' ? Math.abs(n.z - s.c) < 0.6 && n.x >= s.a - 0.6 && n.x <= s.b + 0.6 : Math.abs(n.x - s.c) < 0.6 && n.z >= s.a - 0.6 && n.z <= s.b + 0.6));
    on.sort((p, q) => (s.axis === 'z' ? p.x - q.x : p.z - q.z));
    for (let i = 0; i < on.length - 1; i++) addEdge(on[i], on[i + 1], s.w, s.name);
  }

  // ---- Necklace Road: a ring around the lake, joined to every road the lake cut off
  const ringPts = [];
  const STEPS = 56;
  for (let i = 0; i < STEPS; i++) {
    const t = (i / STEPS) * Math.PI * 2;
    ringPts.push({ t, x: L.cx + Math.cos(t) * L.ringX, z: L.cz + Math.sin(t) * L.ringZ });
  }
  for (const s of clipped) {
    if (!s.shore) continue;
    for (const end of [s.a, s.b]) {
      const p = s.axis === 'z' ? [end, s.c] : [s.c, end];
      // a cut end sits exactly on the promenade ellipse: add it to the ring so the road joins Necklace Road
      if (Math.abs(((p[0] - L.cx) / L.ringX) ** 2 + ((p[1] - L.cz) / L.ringZ) ** 2 - 1) < 0.02) {
        ringPts.push({ t: Math.atan2((p[1] - L.cz) / L.ringZ, (p[0] - L.cx) / L.ringX), x: p[0], z: p[1], join: true });
      }
    }
  }
  for (const p of ringPts) if (p.t < 0) p.t += Math.PI * 2;
  ringPts.sort((p, q) => p.t - q.t);
  const ringNodes = ringPts.map((p) => {
    const n = getNode(p.x, p.z);
    if (!p.join) n.curve = true;
    return n;
  });
  for (let i = 0; i < ringNodes.length; i++) {
    const a = ringNodes[i];
    const b = ringNodes[(i + 1) % ringNodes.length];
    if (a !== b) addEdge(a, b, 14, 'Necklace Road', true);
  }

  // ---- blocks: leaf rects inset by the half width of the roads around them
  const blocks = [];
  for (const lf of leaves) {
    const x0 = lf.x0 + lf.wL;
    const x1 = lf.x1 - lf.wR;
    const z0 = lf.z0 + lf.wT;
    const z1 = lf.z1 - lf.wB;
    if (x1 - x0 < 12 || z1 - z0 < 12) continue;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const corners = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [cx, cz]];
    const lakeHits = corners.filter(([x, z]) => insideEllipse(x, z, L, 6)).length;
    blocks.push({
      id: blocks.length, x0, x1, z0, z1, cx, cz, w: x1 - x0, d: z1 - z0, district: lf.district,
      type: lakeHits >= 3 ? 'water' : lakeHits > 0 ? 'park' : 'normal', landmark: null,
    });
  }

  // ---- landmarks claim the nearest block that is big enough
  const pois = [];
  for (const lm of LANDMARKS) {
    let best = null;
    let bestScore = Infinity;
    for (const b of blocks) {
      if (b.type !== 'normal' || b.landmark) continue;
      if (Math.min(b.w, b.d) < lm.need * 0.82) continue;
      const score = Math.hypot(b.cx - lm.at[0], b.cz - lm.at[1]) + (Math.min(b.w, b.d) < lm.need ? 40 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best) {
      best.landmark = lm.id;
      best.type = 'landmark';
      pois.push({ ...lm, x: best.cx, z: best.cz, block: best.id, w: best.w, d: best.d });
    }
  }

  const byId = Object.fromEntries(pois.map((p) => [p.id, p]));
  const roadNames = nameRoads(edges, nodes);
  return { seed, half: H, lake: L, segments: clipped, nodes, edges, blocks, pois, poiById: byId, roadNames };
}

const STREET_NAMES = ['Laad Bazaar', 'Patthargatti', 'Moti Galli', 'Chudi Bazaar', 'Gulzar Houz Road', 'Pearl Lane', 'MG Road', 'SD Road', 'Tank Bund Road', 'Banjara Road', 'Jubilee Road', 'Mehdi Marg', 'Begum Bazaar', 'Abids Road', 'Koti Road', 'Nampally Road', 'Tolichowki Road', 'Madhapur Road', 'Gachibowli Road', 'Kukatpally Road', 'Ameerpet Road', 'Panjagutta Road', 'Himayat Road', 'Dilsukhnagar Road'];

/** Give long edges a street name (shown on the minimap and in quest text). Deterministic. */
function nameRoads(edges, nodes) {
  const names = [];
  let i = 0;
  for (const e of edges) {
    if (e.name) continue;
    const mid = [(nodes[e.a].x + nodes[e.b].x) / 2, (nodes[e.a].z + nodes[e.b].z) / 2];
    const dist = districtAt(mid[0], mid[1]);
    e.name = dist.id === 'old' && i % 3 === 0 ? STREET_NAMES[i % 6] : STREET_NAMES[(i * 7 + Math.floor(mid[0] / 13)) % STREET_NAMES.length];
    i++;
  }
  return names;
}

/** Nearest road edge to a point: { edge, t (0..1 along it), x, z, dist }. Linear scan; call sparingly (quests, spawns). */
export function nearestRoad(city, x, z) {
  let best = null;
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(1, ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len));
    const px = a.x + e.dx * e.len * t;
    const pz = a.z + e.dz * e.len * t;
    const d = Math.hypot(x - px, z - pz);
    if (!best || d < best.dist) best = { edge: e, t, x: px, z: pz, dist: d };
  }
  return best;
}
