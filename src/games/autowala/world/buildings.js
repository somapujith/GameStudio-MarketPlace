// Fills every block with buildings, per district style. Everything is instanced: one InstancedMesh per look (a few draw
// calls for thousands of buildings), with a per-instance colour. Also awnings, rooftop water tanks and neon shop signs.
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  InstancedBufferAttribute,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Group,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from '../game/rng.js';
import { buildingMaterial, setLookAttribute, signAtlasMaterial } from '../render/materials.js';
import { canvasTexture, signTexture } from '../render/textures.js';
import { chunkedInstances, groupByChunk } from '../render/chunks.js';
import { bakedCopy } from '../render/merge-static.js';

const PASTELS = ['#ff9fc2', '#ffc8a0', '#fff0a8', '#9ee8d0', '#8fd4f0', '#c9b0ff', '#ffb0a0', '#f6e0c8', '#ff7fa8', '#7fe0c4', '#ffd98a', '#f4a6d7'];
const WARM = ['#e8b48a', '#f0c9a0', '#d99a84', '#f2d9b4', '#e6a79a', '#f5cf9a', '#dba9a0'];
const VILLA = ['#fff3e0', '#ffe0cc', '#f9d6e0', '#e0f3ea', '#fff0b8', '#dfeaff'];
const GLASS = ['#7cc8ee', '#6ab0e8', '#9a8cf0', '#5fd0d0', '#e08ad0', '#78a4e6'];
const AWNING = ['#ff3d7f', '#ffb100', '#2ec4b6', '#7b5cff', '#ff6a3d', '#3dd68c'];

const FACING = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const FACING_ROT = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 };

const SIGNS = [
  { k: 'chai', bg: '#2a1038', bd: '#ffb100', l: [{ text: 'IRANI CHAI', font: '800 54px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#ffe08a' }, { text: 'ఇరానీ చాయ్', font: '700 34px "Noto Sans Telugu Variable", sans-serif', color: '#ffb100' }] },
  { k: 'bakery', bg: '#0e2038', bd: '#37e6ff', l: [{ text: 'KARACHI BAKERY', font: '800 46px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#bff6ff' }, { text: 'FRESH OSMANIA BISCUITS', font: '600 22px "Bricolage Grotesque Variable", sans-serif', color: '#37e6ff' }] },
  { k: 'pista', bg: '#2a0e2e', bd: '#ff3d9a', l: [{ text: 'PISTA HOUSE', font: '800 54px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#ffd1ea' }, { text: 'HALEEM  ·  SWEETS', font: '600 24px "Bricolage Grotesque Variable", sans-serif', color: '#ff3d9a' }] },
  { k: 'bangles', bg: '#2a0a0a', bd: '#ff5a3d', l: [{ text: 'LAAD BAZAAR', font: '800 52px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#ffd9c8' }, { text: 'లాడ్ బజార్ · చూడీలు', font: '700 30px "Noto Sans Telugu Variable", sans-serif', color: '#ff5a3d' }] },
  { k: 'biryani', bg: '#1a2a0a', bd: '#9dff3d', l: [{ text: 'DUM BIRYANI', font: '800 54px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#efffc8' }, { text: 'బిర్యానీ హౌస్', font: '700 32px "Noto Sans Telugu Variable", sans-serif', color: '#9dff3d' }] },
  { k: 'cinema', bg: '#1a0a2e', bd: '#b46bff', l: [{ text: 'FILMY CINEMA', font: '800 50px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#e8d1ff' }, { text: 'NOW SHOWING', font: '700 26px "Bricolage Grotesque Variable", sans-serif', color: '#ff5d9a' }] },
  { k: 'jewel', bg: '#2a1c06', bd: '#ffd24a', l: [{ text: 'GOLD & PEARLS', font: '800 52px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#fff1b8' }, { text: 'ముత్యాల దుకాణం', font: '700 30px "Noto Sans Telugu Variable", sans-serif', color: '#ffd24a' }] },
  { k: 'paan', bg: '#06281c', bd: '#3dffb0', l: [{ text: 'PAAN CORNER', font: '800 50px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#c8ffe8' }, { text: 'పాన్ షాప్', font: '700 30px "Noto Sans Telugu Variable", sans-serif', color: '#3dffb0' }] },
  { k: 'mobile', bg: '#08183a', bd: '#4d8bff', l: [{ text: 'MOBILE WORLD', font: '800 50px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#cfe0ff' }, { text: 'REPAIR · RECHARGE', font: '600 24px "Bricolage Grotesque Variable", sans-serif', color: '#4d8bff' }] },
];

const unitBox = () => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

export function buildBuildings(scene, city, colliders, shared, seed) {
  const rng = makeRng(seed ^ 0xb17d);
  const lots = { bazaar: [], town: [], villa: [], glass: [], hangar: [] };
  const extras = { tanks: [], awnings: [], signs: [], roofBoxes: [], walls: [], roofCaps: [] };
  const buildingList = [];

  const pick = (arr) => rng.pick(arr);

  function pushLot(look, cx, cz, w, d, h, color, facing, opts = {}) {
    lots[look].push({ cx, cz, w, d, h, color, facing });
    colliders.addCentered(cx, cz, w, d, 'building', h);
    buildingList.push({ look, cx, cz, w, d, h, facing });
    if (opts.noExtras) return;
    if (h > 8 && rng.chance(0.45)) {
      extras.tanks.push({ x: cx + rng.range(-w * 0.25, w * 0.25), z: cz + rng.range(-d * 0.25, d * 0.25), y: h, s: rng.range(0.8, 1.3) });
    }
    if (rng.chance(0.5)) extras.roofBoxes.push({ x: cx + rng.range(-w * 0.3, w * 0.3), z: cz + rng.range(-d * 0.3, d * 0.3), y: h, sx: rng.range(1, 2.4), sy: rng.range(0.8, 1.6), sz: rng.range(1, 2.2) });
    if (facing && (look === 'bazaar' || look === 'town')) {
      const f = FACING[facing];
      const horizontal = facing === 'N' || facing === 'S';
      const span = horizontal ? w : d;
      const reach = (horizontal ? d : w) / 2 + 0.08;
      const fx = cx + f[0] * reach;
      const fz = cz + f[1] * reach;
      if (span > 5 && rng.chance(look === 'bazaar' ? 0.8 : 0.55)) {
        extras.awnings.push({ x: fx + f[0] * 0.7, z: fz + f[1] * 0.7, span: Math.min(span - 0.6, 9), facing, color: pick(AWNING) });
      }
      if (span > 5.5 && h > 7 && rng.chance(0.4)) {
        extras.signs.push({ x: fx + f[0] * 0.06, z: fz + f[1] * 0.06, y: 5.2 + rng.range(0, 0.6), facing, k: rng.int(0, SIGNS.length - 1), s: Math.min(1, (span - 1) / 4.2) });
      }
    }
  }

  const floorsH = (h0, h1) => {
    const n0 = Math.max(1, Math.ceil((h0 - 3.8) / 3.4));
    const n1 = Math.max(n0, Math.floor((h1 - 3.8) / 3.4));
    return 3.8 + rng.int(n0, n1) * 3.4;
  };

  /** Perimeter strips of attached buildings (bazaar and town). */
  function ringBlock(b, look, o) {
    const m = 3.3;
    const U = { x0: b.x0 + m, x1: b.x1 - m, z0: b.z0 + m, z1: b.z1 - m };
    const uw = U.x1 - U.x0;
    const ud = U.z1 - U.z0;
    if (uw < 9 || ud < 9) return;
    const depth = Math.min(o.depth, uw / 2 - 0.2, ud / 2 - 0.2);
    const palette = o.palette;
    const lotW = () => rng.range(o.lot[0], o.lot[1]);
    const run = (from, to, make) => {
      let p = from;
      while (to - p > 4) {
        let w = Math.min(lotW(), to - p);
        if (to - (p + w) < 4) w = to - p;
        make(p + w / 2, w);
        p += w;
      }
    };
    const hBase = rng.range(o.h[0], o.h[1]);
    const hh = () => floorsH(Math.max(o.h[0], hBase - 5), Math.min(o.h[1], hBase + 7));
    run(U.x0, U.x1, (x, w) => pushLot(look, x, U.z0 + depth / 2, w - 0.15, depth, hh(), pick(palette), 'N'));
    run(U.x0, U.x1, (x, w) => pushLot(look, x, U.z1 - depth / 2, w - 0.15, depth, hh(), pick(palette), 'S'));
    run(U.z0 + depth, U.z1 - depth, (z, w) => pushLot(look, U.x0 + depth / 2, z, depth, w - 0.15, hh(), pick(palette), 'W'));
    run(U.z0 + depth, U.z1 - depth, (z, w) => pushLot(look, U.x1 - depth / 2, z, depth, w - 0.15, hh(), pick(palette), 'E'));
    // an inner courtyard building when the block is big
    const iw = uw - depth * 2 - 2;
    const id = ud - depth * 2 - 2;
    if (iw > 10 && id > 10 && rng.chance(0.7)) pushLot(look, b.cx, b.cz, iw, id, floorsH(o.h[0], o.h[1] - 3), pick(palette), null, { noExtras: false });
  }

  function villaBlock(b) {
    const m = 3.6;
    const n = rng.int(1, Math.max(1, Math.min(3, Math.floor((b.w * b.d) / 2600) + 1)));
    const wallC = '#f0d8c4';
    for (let i = 0; i < n; i++) {
      const w = rng.range(12, 19);
      const d = rng.range(10, 16);
      const x = rng.range(b.x0 + m + w / 2 + 3, Math.max(b.x0 + m + w / 2 + 3.1, b.x1 - m - w / 2 - 3));
      const z = rng.range(b.z0 + m + d / 2 + 3, Math.max(b.z0 + m + d / 2 + 3.1, b.z1 - m - d / 2 - 3));
      if (colliders.inside(x, z, Math.max(w, d) / 2 + 2)) continue;
      pushLot('villa', x, z, w, d, rng.pick([6.6, 7.2, 10, 10.4]), pick(VILLA), 'S');
      extras.roofCaps.push({ x, z, y: 0, w: w + 1.2, d: d + 1.2, h: rng.pick([6.6, 7.2, 10, 10.4]) });
    }
    // compound wall around the plot (visual only)
    extras.walls.push({ x: b.cx, z: b.cz, w: b.w - 5.6, d: b.d - 5.6, color: wallC });
  }

  function glassBlock(b) {
    const m = 5;
    const w = Math.min(b.w - m * 2 - 6, rng.range(26, 42));
    const d = Math.min(b.d - m * 2 - 6, rng.range(26, 40));
    if (w < 14 || d < 14) return;
    const h = rng.range(48, 118);
    pushLot('glass', b.cx + rng.range(-4, 4), b.cz + rng.range(-4, 4), w, d, h, pick(GLASS), null, { noExtras: true });
    if (rng.chance(0.55)) {
      const w2 = rng.range(14, 22);
      const d2 = rng.range(14, 22);
      const x = b.x0 + m + w2 / 2 + 1;
      const z = b.z1 - m - d2 / 2 - 1;
      if (!colliders.inside(x, z, Math.max(w2, d2) / 2)) pushLot('glass', x, z, w2, d2, rng.range(30, 62), pick(GLASS), null, { noExtras: true });
    }
  }

  function ruralBlock(b) {
    const n = rng.int(0, 3);
    for (let i = 0; i < n; i++) {
      const w = rng.range(7, 11);
      const d = rng.range(6, 9);
      const x = rng.range(b.x0 + 10, b.x1 - 10);
      const z = rng.range(b.z0 + 10, b.z1 - 10);
      if (colliders.inside(x, z, 6)) continue;
      pushLot('villa', x, z, w, d, rng.pick([3.8, 4.4, 5]), pick(['#e8b48a', '#f0c9a0', '#d99a84']), 'S', { noExtras: true });
    }
  }

  function airportBlock(b) {
    const w = Math.min(b.w - 20, rng.range(44, 80));
    const d = Math.min(b.d - 20, rng.range(30, 52));
    if (w < 20 || d < 16) return;
    pushLot('hangar', b.cx, b.cz, w, d, rng.range(8, 13), pick(['#e8e0f0', '#d8f0f0', '#f0e8d8']), null, { noExtras: true });
  }

  for (const b of city.blocks) {
    if (b.type !== 'normal') continue;
    const style = (b.district === 'old' && 'bazaar') || (b.district === 'hitech' && 'glass') || (b.district === 'banjara' && 'villa') || (b.district === 'golconda' && 'rural') || (b.district === 'airport' && 'airport') || 'town';
    if (style === 'bazaar') ringBlock(b, 'bazaar', { depth: 14, lot: [5.5, 9.5], h: [7.6, 17], palette: PASTELS });
    else if (style === 'town') ringBlock(b, 'town', { depth: 17, lot: [9, 17], h: [10.6, 27], palette: rng.chance(0.55) ? PASTELS : WARM });
    else if (style === 'villa') villaBlock(b);
    else if (style === 'glass') glassBlock(b);
    else if (style === 'rural') ruralBlock(b);
    else airportBlock(b);
  }

  // ---- ONE instanced mesh per map tile for all the lots (render/chunks.js culls far tiles in the view and in the shadow pass); the facade
  // look is a per-instance attribute of the single building material, so a tile costs one draw call however many looks it holds.
  const group = new Group();
  scene.add(group);
  const geo = unitBox();
  const meshes = [];
  const at = (it) => [it.x ?? it.cx, it.z ?? it.cz];

  // per-instance tint, drawn in the order the old per-look 256 m meshes used so the colours of the city are unchanged
  const tintC = new Color();
  for (const list of Object.values(lots)) {
    for (const tileItems of groupByChunk(list, at, 256).values()) {
      for (const l of tileItems) l.tint = tintC.set(l.color).offsetHSL(rng.range(-0.012, 0.012), rng.range(-0.05, 0.03), rng.range(-0.035, 0.03)).clone();
    }
  }
  const allLots = [];
  for (const [look, list] of Object.entries(lots)) for (const l of list) allLots.push({ ...l, look });
  meshes.push(
    ...chunkedInstances(group, geo, buildingMaterial(shared), allLots, at, (l, o) => {
      o.position.set(l.cx, 0, l.cz);
      o.scale.set(l.w, l.h, l.d);
      return l.tint;
    }, { castShadow: true, onMesh: (mesh, items) => setLookAttribute(mesh, items.map((l) => l.look)) }),
  );

  // Small rooftop and street-edge details (tanks, roof boxes, villa roof slabs, compound walls, awnings): baked per tile into ONE static
  // vertex-coloured mesh, no shadows (they would only cost).
  const details = [];
  const tankGeo = new CylinderGeometry(1, 1, 1.6, 8).translate(0, 0.8, 0);
  const box = unitBox();
  const TANK = new Color('#3a8fd0');
  for (const t of extras.tanks) details.push({ x: t.x, z: t.z, geo: tankGeo, y: t.y, sx: t.s, sy: t.s, sz: t.s, c: TANK });
  const BOX = (t, c) => ({ x: t.x, z: t.z, geo: box, y: t.y, sx: t.sx, sy: t.sy, sz: t.sz, c: new Color(c) });
  for (const t of extras.roofBoxes) details.push(BOX(t, '#d6d0d8'));
  for (const t of extras.roofCaps) details.push(BOX({ x: t.x, z: t.z, y: t.h, sx: t.w, sy: 0.55, sz: t.d }, '#c4604a'));
  // compound walls: four thin slabs per plot
  for (const w of extras.walls) {
    for (const t of [{ x: w.x, z: w.z - w.d / 2, sx: w.w, sz: 0.5 }, { x: w.x, z: w.z + w.d / 2, sx: w.w, sz: 0.5 }, { x: w.x - w.w / 2, z: w.z, sx: 0.5, sz: w.d }, { x: w.x + w.w / 2, z: w.z, sx: 0.5, sz: w.d }]) {
      details.push(BOX({ ...t, y: 0, sy: 1.5 }, w.color));
    }
  }
  // awnings: striped slabs over shopfronts
  for (const a of extras.awnings) {
    const horizontal = a.facing === 'N' || a.facing === 'S';
    details.push(BOX({ x: a.x, z: a.z, y: 3.2, sx: horizontal ? a.span : 1.5, sy: 0.22, sz: horizontal ? 1.5 : a.span }, a.color));
  }
  const detailMat = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8, metalness: 0.05 });
  const dm = new Matrix4();
  for (const tileItems of groupByChunk(details, at).values()) {
    const parts = tileItems.map((d) => {
      dm.makeScale(d.sx, d.sy, d.sz).setPosition(d.x, d.y, d.z);
      const g = bakedCopy(d.geo, dm);
      g.deleteAttribute('uv');
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([d.c.r, d.c.g, d.c.b], i * 3);
      g.setAttribute('color', new BufferAttribute(col, 3));
      return g;
    });
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new Mesh(merged, detailMat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    meshes.push(mesh);
  }

  // Neon shop signs: all nine designs live in one atlas (2 columns x 5 rows of 512 x 160), each instance names its cell, so a tile draws
  // its signs in ONE call.
  const SW = 512;
  const SH = 160;
  const designs = SIGNS.map((s) => signTexture(s.k, { bg: s.bg, border: s.bd, lines: s.l }));
  const atlas = canvasTexture(SW * 2, SH * 5, (g) => {
    designs.forEach((t, k) => g.drawImage(t.image, (k % 2) * SW, Math.floor(k / 2) * SH));
  }, { anisotropy: 8 });
  const planeGeo = new PlaneGeometry(4.2, 1.3);
  const signMat = signAtlasMaterial(atlas, 1.35);
  meshes.push(
    ...chunkedInstances(group, planeGeo, signMat, extras.signs, at, (sg, o) => {
      o.position.set(sg.x, sg.y, sg.z);
      o.rotation.set(0, FACING_ROT[sg.facing], 0);
      o.scale.set(sg.s, sg.s, 1);
    }, {
      receiveShadow: false,
      onMesh: (mesh, items) => {
        const g = mesh.geometry.clone();
        const rect = new Float32Array(items.length * 4);
        items.forEach((sg, i) => rect.set([(sg.k % 2) * 0.5, 1 - (Math.floor(sg.k / 2) + 1) / 5, 0.5, 1 / 5], i * 4));
        g.setAttribute('aUvRect', new InstancedBufferAttribute(rect, 4));
        mesh.geometry = g;
      },
    }),
  );

  return { group, meshes, buildingList, counts: Object.fromEntries(Object.entries(lots).map(([k, v]) => [k, v.length])) };
}
