// Hand tools, vessels and serving ware, modelled in metres like their real counterparts.
//
//   buildTool(id, opts) -> { group, grip: Object3D, tip: Object3D, set(key, v), dispose() }
//
// Frame (all tools): the local origin is where the hand holds it (`grip`), the working end points along -Z, +Y is "up" (the bowl
// opening / blade face), +X is right. `tip` sits at the working end (bowl base / blade edge / spout end / cap).
// `group.userData.baseY` is the distance from the grip down to a resting surface (vessels): a station stands the tool on the counter with it.
// Ids: ladle spatula scraper onion-fork oil-bottle jhara tongs chai-kettle chai-pot steel-glass davara plate katori banana-leaf
//      newspaper-cone money-box note
// Options: steel-glass / davara { fill 0..1, drink 'chai'|'coffee', saucer }, katori { fill: 'sambar'|'chutney'|'chutney-red'|null },
//      note { value: 10|20|50|100|500 }, money-box { open 0..1 }.
// set(key, v): oil-bottle 'pour' 0..1 (oil stream), money-box 'open' 0..1, steel-glass/davara 'fill' 0..1.
// Geometry is OWNED by the tool (freed by dispose()); materials are shared PBR materials (freed by disposeModelCache()).
import { BufferGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, Shape, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { MeshPhysicalMaterial } from 'three';
import { boxUV, disc, lathe, merge, paint, place, sweep } from './geo.js';
import { pbrMaterial, plainMaterial, quality } from './pbr.js';
import { patchMaterial } from './shaders/patch.js';
import { makeCanvasTexture, sharedMat, sharedTexture } from './util.js';
import { createFoodMaterial, foodUniforms } from './shaders/food.js';

export const TOOL_IDS = ['ladle', 'spatula', 'scraper', 'onion-fork', 'oil-bottle', 'jhara', 'tongs', 'chai-kettle', 'chai-pot', 'steel-glass', 'davara', 'plate', 'katori', 'banana-leaf', 'newspaper-cone', 'money-box', 'note'];

const TAU = Math.PI * 2;
const V3 = (x, y, z) => new Vector3(x, y, z);
let LOD = 1;
const LA = (ctrl, seg, o = {}) => lathe(ctrl, seg, LOD < 1 ? { ...o, sub: 0 } : o);
const SW = (path, section, radial, o) => sweep(path, section, LOD < 1 ? Math.min(radial, 6) : radial, o);
const sg = (n) => Math.max(10, Math.round(n * quality().segScale * LOD));
const sstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------------------------------
// shared materials (created on first use, cached by pbr.js / util.js)
export const TM = {
  steel: () => pbrMaterial('steel-brushed', { rough: 0.85, metal: 1, aniso: 0.3, key: 'tool-steel' }),
  steelBright: () => pbrMaterial('steel-brushed', { rough: 0.55, metal: 1, aniso: 0.5, key: 'tool-steel-bright', color: '#f2f4f6' }),
  steelDark: () => pbrMaterial('steel-brushed', { rough: 1.2, metal: 1, key: 'tool-steel-dark', color: '#8a9096' }),
  alu: () => pbrMaterial('aluminium', { rough: 1, metal: 1, vertexColors: true, key: 'alu-vc', aniso: 0.3 }),
  iron: () => pbrMaterial('iron-dark', { rough: 1, metal: 1, key: 'tool-iron' }),
  wood: () => pbrMaterial('wood', { rough: 1, metal: 0, key: 'tool-wood' }),
  brass: () => pbrMaterial('brass', { rough: 1, metal: 1, key: 'tool-brass' }),
  leaf: () => pbrMaterial('leaf', { rough: 1, metal: 0, side: DoubleSide, key: 'leaf', sheen: 0.4, sheenColor: '#bfe39a' }),
  paper: () => pbrMaterial('newspaper', { rough: 1, metal: 0, side: DoubleSide, key: 'news' }),
  bottle: () => plainMaterial('bottle', { color: '#dfe9ee', roughness: 0.12, metalness: 0, transparent: true, opacity: 0.4, clearcoat: 1, clearcoatRoughness: 0.1, side: DoubleSide, depthWrite: false, envMapIntensity: 1.6 }),
  oil: () => plainMaterial('oil', { color: '#e8a012', roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#7a4a00', emissiveIntensity: 0.14, envMapIntensity: 1.4 }),
  oilStream: () => plainMaterial('oilstream', { color: '#f0b020', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.75, emissive: '#7a4a00', emissiveIntensity: 0.2, clearcoat: 1 }),
  cap: () => plainMaterial('capblue', { color: '#1b5fb4', roughness: 0.35, metalness: 0, clearcoat: 0.4 }),
  black: () => plainMaterial('rubberblack', { color: '#0c0c0d', roughness: 0.55, metalness: 0 }),
  glass: () => plainMaterial('glassclear', { color: '#e8f4f4', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, clearcoatRoughness: 0.02, side: DoubleSide, depthWrite: false, envMapIntensity: 2.2, ior: 1.5 }),
  porcelain: () => plainMaterial('porcelain', { color: '#f3efe6', roughness: 0.18, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.08 }),
  porcelainBlue: () => plainMaterial('porcelainblue', { color: '#2a62ae', roughness: 0.2, metalness: 0, clearcoat: 0.8 }),
  chai: () => plainMaterial('chai', { color: '#b8742f', roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#5a2a08', emissiveIntensity: 0.25 }),
  coffee: () => plainMaterial('coffee', { color: '#3a1d0c', roughness: 0.12, metalness: 0, clearcoat: 1, emissive: '#1a0a02', emissiveIntensity: 0.2 }),
  froth: () => plainMaterial('froth', { color: '#e9cfa6', roughness: 0.7, metalness: 0, sheen: 0.6, sheenColor: '#fff0d0' }),
  coin: () => plainMaterial('coin', { color: '#d8c8a0', roughness: 0.35, metalness: 1 }),
  onionSkin: () => plainMaterial('onionskin', { color: '#8a3a68', roughness: 0.35, metalness: 0, clearcoat: 0.5, sheen: 0.5, sheenColor: '#d49ad0' }),
  vc: () => plainMaterial('vcplain', { vertexColors: true, roughness: 0.6, metalness: 0 }),
  vcGloss: () => plainMaterial('vcgloss', { vertexColors: true, roughness: 0.35, metalness: 0, clearcoat: 0.4 }),
};

/** The jhara skimmer: stainless steel with a procedural hex field of holes (discard), so no alpha texture is needed. */
function jharaMaterial() {
  return sharedMat('jhara', () => {
    const m = new MeshPhysicalMaterial({ color: '#c9ced2', roughness: 0.4, metalness: 1, side: DoubleSide, envMapIntensity: 1.2 });
    patchMaterial(m, {
      key: 'jhara',
      fragColor: `
        vec2 jq = vTcPos.xz - vec2(0.0, -0.17);
        vec2 jp = jq / 0.0105;
        jp.y *= 1.1547;
        float jrow = floor(jp.y + 0.5);
        jp.x += mod(jrow, 2.0) * 0.5;
        vec2 jc = vec2(fract(jp.x) - 0.5, fract(jp.y) - 0.5);
        if (length(jq) < 0.058 && length(jc * vec2(1.0, 0.866)) < 0.27 && vTcPos.y < 0.06 && vTcNrm.y * vTcNrm.y > 0.0004) discard;
      `,
    });
    return m;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// plumbing
const P = (g, m) => ({ g, m });
const shift = (parts, x, y, z) => parts.map((p) => ({ g: place(p.g, { p: [x, y, z] }), m: p.m }));

/** Merge the parts by material (functions or Material objects) into one Mesh each. */
function assemble(id, parts, { grip = [0, 0, 0], tip = [0, 0, -0.2], baseY = 0, extra = null } = {}) {
  const group = new Group();
  group.name = `tool-${id}`;
  group.userData.tool = id;
  group.userData.baseY = baseY;
  const byMat = new Map();
  for (const p of parts) {
    if (!byMat.has(p.m)) byMat.set(p.m, []);
    byMat.get(p.m).push(p.g);
  }
  const geos = [];
  for (const [m, gs] of byMat) {
    const geo = merge(gs, gs.some((g) => g.attributes.color));
    geos.push(geo);
    const mesh = new Mesh(geo, typeof m === 'function' ? m() : m);
    group.add(mesh);
  }
  const gripO = new Object3D();
  gripO.name = 'grip';
  gripO.position.set(...grip);
  const tipO = new Object3D();
  tipO.name = 'tip';
  tipO.position.set(...tip);
  group.add(gripO, tipO);
  const tool = { group, grip: gripO, tip: tipO, geos, owned: [], set() {}, update() {}, dispose() {} };
  if (extra) extra(tool);
  tool.dispose = () => {
    for (const g of geos) g.dispose();
    for (const o of tool.owned) o.dispose?.();
    group.removeFromParent();
  };
  return tool;
}

/** Rounded-rectangle sheet (plate-like blade), thickness `t`, in the XZ plane with its back edge at z=z0 and front edge at z0-len, top face at y=0. */
function blade(w, len, t, r, z0, bevel = 0.0007) {
  const s = new Shape();
  const x = w / 2;
  s.moveTo(-x + r, 0);
  s.lineTo(x - r, 0);
  s.quadraticCurveTo(x, 0, x, r);
  s.lineTo(x, len - r);
  s.quadraticCurveTo(x, len, x - r, len);
  s.lineTo(-x + r, len);
  s.quadraticCurveTo(-x, len, -x, len - r);
  s.lineTo(-x, r);
  s.quadraticCurveTo(-x, 0, -x + r, 0);
  const g = new ExtrudeGeometry(s, { depth: Math.max(0.0002, t - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 5 });
  g.rotateX(-Math.PI / 2); // shape y -> -z, extrusion -> +y
  g.translate(0, -t / 2 + bevel, z0);
  // world uv for the brushed grain: x along width, z along length
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 2.5, p.getZ(i) * 2.5);
  return g;
}

const round = (r) => [r, r];
const arcPath = (cx, cy, r, a0, a1, n, axis = 'yz') =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return axis === 'yz' ? V3(0, cy + Math.sin(a) * r, cx + Math.cos(a) * r) : V3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0);
  });
/** Catmull-Rom resample of control Vector3s (n samples per segment). */
function smoothPath(ctrl, n = 4) {
  if (LOD < 1) n = Math.max(1, Math.round(n / 3));
  const out = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push(V3(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z)));
    }
  }
  out.push(ctrl[ctrl.length - 1].clone());
  return out;
}
const dome = (r, flat = 0.6, s = 8) => {
  const g = new SphereGeometry(r, s, Math.max(4, s - 3), 0, TAU, 0, Math.PI / 2);
  g.scale(1, flat, 1);
  return g;
};
const rivet = (x, y, z, r = 0.0035) => place(dome(r, 0.55, 8), { p: [x, y, z] });
const rivetSide = (x, y, z, r = 0.0035, sign = 1) => place(dome(r, 0.55, 8), { p: [x, y, z], r: [0, 0, -sign * Math.PI / 2] });

// ---------------------------------------------------------------------------------------------------------------------
// TOOLS
function ladle() {
  const parts = [];
  const cz = -0.215;
  const outer = [[0, 0], [0.022, 0.0004], [0.0365, 0.0085], [0.0448, 0.0225], [0.0478, 0.0395], [0.0481, 0.0425], [0.0466, 0.0442], [0.0451, 0.0427], [0.0443, 0.0405], [0.0424, 0.0225], [0.0334, 0.0088], [0.0205, 0.0032], [0, 0.0028]];
  const lip = (r, y, th) => {
    // pouring lip at the front (-z): th = PI
    const d = Math.abs(((th - Math.PI + Math.PI) % TAU) - Math.PI);
    const k = Math.exp(-((d / 0.42) ** 2)) * sstep(0.034, 0.043, y);
    return [0.0075 * k, -0.0045 * k];
  };
  const bowl = LA(outer, sg(36), { sub: 1, uv: [1, 6], warp: lip });
  parts.push(P(place(bowl, { p: [0, 0.0, cz] }), TM.steelBright));
  // handle: a flat strap that rounds off, with an eye-hook end
  const hp = smoothPath([V3(0, 0.038, cz + 0.045), V3(0, 0.046, cz + 0.085), V3(0, 0.05, -0.1), V3(0, 0.047, -0.03), V3(0, 0.042, 0.04), V3(0, 0.04, 0.085), V3(0, 0.047, 0.118), V3(0, 0.068, 0.132), V3(0, 0.088, 0.112), V3(0, 0.086, 0.088)], 4);
  const n = hp.length;
  const strap = SW(hp, (t) => [0.0076 - 0.0034 * sstep(0.1, 0.5, t) - 0.0006 * t, 0.0016 + 0.0027 * sstep(0.15, 0.55, t) - 0.0008 * t], 8, { up: V3(0, 1, 0) });
  parts.push(P(strap, TM.steelBright));
  parts.push(P(place(dome(0.0035), { p: [-0.0035, 0.0425, cz + 0.058] }), TM.steelBright));
  parts.push(P(place(dome(0.0035), { p: [0.0035, 0.0425, cz + 0.058] }), TM.steelBright));
  return assemble('ladle', shift(parts, 0, -0.047, 0), { tip: [0, -0.047, cz], baseY: 0.047 });
}

function spatula() {
  const parts = [];
  // blade at y = 0, handle axis at y = HY
  const HY = 0.05;
  parts.push(P(blade(0.108, 0.1, 0.0013, 0.007, -0.195), TM.steelBright));
  // bent neck: flat bar rising from the blade to the handle axis
  const neck = smoothPath([V3(0, 0.0007, -0.2), V3(0, 0.0015, -0.185), V3(0, 0.014, -0.165), V3(0, 0.036, -0.14), V3(0, HY, -0.118), V3(0, HY, -0.098)], 4);
  parts.push(P(SW(neck, () => [0.0085, 0.0017], 6, { up: V3(0, 1, 0) }), TM.steelBright));
  // tapered wooden handle (axis along z), brass ferrule and rivets
  const h = LA([[0, 0], [0.0098, 0.001], [0.0132, 0.012], [0.0136, 0.07], [0.0124, 0.14], [0.0112, 0.158], [0.0102, 0.162], [0, 0.1626]], 12, { sub: 1, uv: [1, 3] });
  h.rotateX(-Math.PI / 2);
  parts.push(P(place(h, { p: [0, HY, 0.065] }), TM.wood));
  const fer = LA([[0.0125, 0], [0.0138, 0.002], [0.0138, 0.026], [0.0128, 0.0285], [0.0112, 0.0285]], 12, { sub: 0, uv: [1, 1] });
  fer.rotateX(-Math.PI / 2);
  parts.push(P(place(fer, { p: [0, HY, -0.088] }), TM.brass));
  for (const z of [-0.02, 0.025]) {
    parts.push(P(rivetSide(0.0132, HY, z, 0.0034, 1), TM.brass));
    parts.push(P(rivetSide(-0.0132, HY, z, 0.0034, -1), TM.brass));
  }
  return assemble('spatula', shift(parts, 0, -HY, 0), { tip: [0, -HY, -0.293], baseY: HY });
}

function scraper() {
  const parts = [];
  const HY = 0.03;
  parts.push(P(blade(0.084, 0.17, 0.0022, 0.004, -0.14, 0.0009), TM.steelBright));
  // edge bevel: a thinner front lip is implied by the chamfer of the extrusion; a stiffening ridge down the middle
  parts.push(P(place(boxUV(0.0035, 0.0028, 0.12, 0.2, 0.2), { p: [0, 0.0012, -0.22] }), TM.steelBright));
  const neck = smoothPath([V3(0, 0.001, -0.145), V3(0, 0.004, -0.13), V3(0, 0.022, -0.115), V3(0, HY, -0.095)], 4);
  parts.push(P(SW(neck, () => [0.007, 0.0018], 6, { up: V3(0, 1, 0) }), TM.steelBright));
  const h = LA([[0, 0], [0.0105, 0.001], [0.0142, 0.012], [0.0144, 0.09], [0.0125, 0.118], [0.0108, 0.124], [0, 0.1245]], 12, { sub: 1, uv: [1, 3] });
  h.rotateX(-Math.PI / 2);
  parts.push(P(place(h, { p: [0, HY, 0.055] }), TM.wood));
  const fer = LA([[0.0128, 0], [0.0142, 0.002], [0.0142, 0.03], [0.0132, 0.0325], [0.0114, 0.0325]], 12, { sub: 0, uv: [1, 1] });
  fer.rotateX(-Math.PI / 2);
  parts.push(P(place(fer, { p: [0, HY, -0.071] }), TM.brass));
  return assemble('scraper', shift(parts, 0, -HY, 0), { tip: [0, -HY, -0.31], baseY: HY });
}

function onionFork() {
  const parts = [];
  const h = LA([[0, 0], [0.0085, 0.001], [0.0115, 0.012], [0.0118, 0.1], [0.0098, 0.138], [0.0085, 0.142], [0, 0.1425]], 10, { sub: 1, uv: [1, 3] });
  h.rotateX(-Math.PI / 2);
  parts.push(P(place(h, { p: [0, 0, 0.07] }), TM.wood));
  const fer = LA([[0.0098, 0], [0.011, 0.002], [0.011, 0.02], [0.0098, 0.0225]], 10, { sub: 0 });
  fer.rotateX(-Math.PI / 2);
  parts.push(P(place(fer, { p: [0, 0, -0.07] }), TM.brass));
  // shaft + three tines
  parts.push(P(SW([V3(0, 0, -0.07), V3(0, 0, -0.17)], () => [0.0032, 0.0032], 7), TM.steel));
  for (const x of [-0.014, 0, 0.014]) parts.push(P(SW(smoothPath([V3(x * 0.4, 0, -0.17), V3(x, 0, -0.19), V3(x, 0, -0.225)], 3), (t) => [0.0021 - 0.0014 * t, 0.0021 - 0.0014 * t], 6), TM.steel));
  parts.push(P(SW([V3(-0.014, 0, -0.176), V3(0.014, 0, -0.176)], () => [0.0026, 0.0026], 6), TM.steel));
  // half an onion skewered on the tines, cut face down
  const sk = new SphereGeometry(0.036, 20, 10, 0, TAU, 0, Math.PI / 2);
  sk.scale(1, 0.82, 1);
  parts.push(P(place(sk, { p: [0, 0.0, -0.192] }), TM.onionSkin));
  // cut face rings (cream / pale purple)
  const cut = disc(0.036, 24, 6, 0);
  paint(cut, (x, y, z) => {
    const r = Math.hypot(x, z) / 0.036;
    const ring = Math.floor(r * 7.0);
    const t = (ring % 2) * 0.5;
    const edge = r > 0.93 ? 1 : 0;
    return [0.95 - 0.1 * t - 0.18 * edge, 0.9 - 0.12 * t - 0.4 * edge, 0.82 - 0.08 * t - 0.3 * edge];
  });
  cut.rotateX(Math.PI);
  parts.push(P(place(cut, { p: [0, -0.0005, -0.192] }), TM.vcGloss));
  return assemble('onion-fork', shift(parts, 0, 0.0, 0), { tip: [0, -0.0, -0.192], baseY: 0 });
}

function oilBottle() {
  const parts = [];
  const rib = (r, y) => [r * 0.012 * Math.sin(Math.max(0, y - 0.025) * 150) * sstep(0.03, 0.04, y) * (1 - sstep(0.1, 0.115, y)), 0];
  const shell = LA([[0, 0], [0.027, 0], [0.0325, 0.012], [0.0336, 0.05], [0.0336, 0.1], [0.0322, 0.125], [0.025, 0.148], [0.0165, 0.166], [0.0148, 0.176], [0.0147, 0.187], [0.0152, 0.19]], sg(24), { sub: 1, uv: [1, 1], warp: (r, y) => rib(r, y) });
  const oil = LA([[0, 0.003], [0.0265, 0.003], [0.0318, 0.014], [0.0326, 0.05], [0.0326, 0.0955], [0, 0.0955]], sg(20), { sub: 0 });
  const cap = LA([[0.0158, 0.184], [0.0182, 0.1855], [0.0184, 0.2], [0.016, 0.2035], [0, 0.2035]], 14, { sub: 0, uv: [1, 1] });
  // perforations: three tiny dark discs on the cap face
  const holes = [0, 1, 2].map((i) => place(new CylinderGeometry(0.0016, 0.0016, 0.0006, 6), { p: [Math.cos((i * TAU) / 3) * 0.006, 0.2037, Math.sin((i * TAU) / 3) * 0.006] }));
  const all = [P(shell, TM.bottle), P(oil, TM.oil), P(cap, TM.cap), ...holes.map((h) => P(h, TM.black))];
  // rotate to lie along -z, grip on the body (y = 0.07 -> z = 0)
  for (const p of all) {
    p.g.rotateX(-Math.PI / 2);
    p.g.translate(0, 0, 0.07);
  }
  return assemble('oil-bottle', all, {
    tip: [0, 0, -0.134],
    baseY: 0.034,
    extra(t) {
      const m = TM.oilStream();
      const g = new CylinderGeometry(0.0013, 0.0009, 1, 6, 1, true);
      g.translate(0, -0.5, 0);
      const stream = new Mesh(g, m);
      stream.position.set(0, 0, -0.134);
      stream.scale.set(1, 0.001, 1);
      stream.visible = false;
      t.group.add(stream);
      t.geos.push(g);
      t.set = (k, v) => {
        if (k === 'pour') {
          stream.visible = v > 0.01;
          stream.scale.y = Math.max(0.001, v * 0.16);
          t.group.rotation.x = 0;
        }
      };
    },
  });
}

function jhara() {
  const parts = [];
  const bowl = LA([[0, 0], [0.03, 0.002], [0.055, 0.012], [0.0695, 0.028], [0.0715, 0.0315], [0.0702, 0.033], [0.0675, 0.0305], [0.0545, 0.0145], [0.03, 0.0045], [0, 0.0025]], sg(36), { sub: 1, uv: [1, 4] });
  const cz = -0.17;
  parts.push({ g: place(bowl, { p: [0, 0, cz] }), m: jharaMaterial });
  parts.push(P(place(new TorusGeometry(0.0705, 0.0017, 6, sg(36)), { p: [0, 0.0315, cz], r: [Math.PI / 2, 0, 0] }), TM.steelBright));
  const hp = smoothPath([V3(0, 0.032, cz + 0.066), V3(0, 0.042, cz + 0.1), V3(0, 0.05, -0.04), V3(0, 0.052, 0.04), V3(0, 0.05, 0.12), V3(0, 0.055, 0.17), V3(0, 0.075, 0.185), V3(0, 0.092, 0.168), V3(0, 0.088, 0.145)], 4);
  parts.push(P(SW(hp, (t) => [0.0068 - 0.0022 * sstep(0, 0.4, t), 0.0019 + 0.0016 * sstep(0, 0.4, t)], 8), TM.steelBright));
  return assemble('jhara', shift(parts, 0, -0.052, 0.0), { tip: [0, -0.052, cz], baseY: 0.052 });
}

function tongs() {
  const parts = [];
  // chimta: two spring-steel arms folded at the back, flat grippers at the front
  const arm = (s) => smoothPath([V3(0, 0, 0.1), V3(s * 0.006, 0, 0.082), V3(s * 0.016, 0, 0.03), V3(s * 0.021, 0, -0.04), V3(s * 0.013, 0, -0.13), V3(s * 0.004, 0, -0.205)], 4);
  for (const s of [-1, 1]) {
    parts.push(P(SW(arm(s), (t) => [0.0018, 0.0075 + 0.0045 * sstep(0.7, 1, t)], 6, { up: V3(0, 1, 0) }), TM.steel));
    parts.push(P(place(boxUV(0.0035, 0.015, 0.032, 0.2, 0.2), { p: [s * 0.0045, 0, -0.205], r: [0, -s * 0.05, 0] }), TM.steel));
  }
  parts.push(P(place(new TorusGeometry(0.0045, 0.0018, 6, 12, Math.PI), { p: [0, 0, 0.1], r: [Math.PI / 2, 0, Math.PI] }), TM.steel));
  parts.push(P(place(dome(0.0045, 1, 8), { p: [0.0218, 0, -0.03], r: [0, 0, -Math.PI / 2] }), TM.brass));
  return assemble('tongs', parts, { tip: [0, 0, -0.215], baseY: 0.01 });
}

function chaiKettle() {
  const parts = [];
  // Irani chai kettle: tall blackened aluminium body, long thin spout, wooden-wrapped handle
  const bodyProf = [[0, 0], [0.074, 0], [0.084, 0.008], [0.089, 0.04], [0.086, 0.12], [0.074, 0.19], [0.056, 0.232], [0.043, 0.248], [0.037, 0.256]];
  const body = LA(bodyProf, sg(30), { sub: 1, uv: [2, 4], warp: (r, y, th) => [0.0012 * Math.sin(th * 3 + y * 20) + 0.001 * Math.sin(y * 70) * sstep(0.05, 0.2, y), 0] });
  // soot: black at the flame side (low), grey-white above, streaks
  paint(body, (x, y, z) => {
    const th = Math.atan2(x, z);
    const streak = 0.5 + 0.5 * Math.sin(th * 7 + y * 4.0) * Math.sin(th * 3 - 1.7);
    const soot = 1 - sstep(0.02, 0.16 + 0.05 * streak, y);
    const k = 0.78 - 0.66 * soot - 0.12 * streak * sstep(0.12, 0.2, y) * (1 - sstep(0.2, 0.26, y));
    return [k, k * 0.98, k * 0.95];
  });
  parts.push(P(body, TM.alu));
  const lid = LA([[0.038, 0.254], [0.0385, 0.258], [0.034, 0.264], [0.022, 0.2705], [0.011, 0.2735], [0, 0.274]], 16, { sub: 1, uv: [1, 1] });
  paint(lid, [0.7, 0.7, 0.68]);
  parts.push(P(lid, TM.alu));
  const knob = place(new SphereGeometry(0.0125, 10, 8), { p: [0, 0.2825, 0] });
  paint(knob, [0.07, 0.065, 0.06]);
  parts.push(P(knob, TM.alu));
  // spout: from the lower front curving up
  const sp = smoothPath([V3(0, 0.07, -0.082), V3(0, 0.1, -0.13), V3(0, 0.15, -0.185), V3(0, 0.2, -0.225), V3(0, 0.236, -0.245)], 4);
  const spout = SW(sp, (t) => [0.0165 - 0.0095 * t, 0.0165 - 0.0095 * t], 10, { caps: false });
  paint(spout, (x, y) => {
    const k = 0.2 + 0.5 * sstep(0.1, 0.24, y);
    return [k, k * 0.98, k * 0.95];
  });
  parts.push(P(spout, TM.alu));
  // handle: a flat loop at the back, wrapped in dark wood
  const hp = smoothPath([V3(0, 0.205, 0.062), V3(0, 0.222, 0.1), V3(0, 0.21, 0.138), V3(0, 0.17, 0.152), V3(0, 0.12, 0.138), V3(0, 0.095, 0.092)], 4);
  const hnd = SW(hp, () => [0.0075, 0.0075], 8);
  paint(hnd, [0.16, 0.1, 0.06]);
  parts.push(P(hnd, TM.vc));
  parts.push(P(place(new TorusGeometry(0.009, 0.0025, 6, 10), { p: [0, 0.205, 0.062], r: [0, Math.PI / 2, 0] }), TM.steelDark));
  // grip = handle centre
  const gx = [0, 0.17, 0.152];
  return assemble('chai-kettle', shift(parts, -gx[0], -gx[1], -gx[2]), { tip: [0, 0.236 - gx[1], -0.245 - gx[2]], baseY: gx[1] });
}

function chaiPot() {
  const parts = [];
  // steel milk / tea pot used for the long Irani pour, D-handle with rivets
  const prof = [[0, 0], [0.056, 0], [0.063, 0.008], [0.067, 0.03], [0.066, 0.12], [0.0625, 0.15], [0.0618, 0.158], [0.0635, 0.1625], [0.0652, 0.1645], [0.064, 0.1665], [0.0618, 0.164]];
  const pour = (r, y, th) => {
    const d = Math.abs(((th - Math.PI + Math.PI) % TAU) - Math.PI);
    const k = Math.exp(-((d / 0.5) ** 2)) * sstep(0.14, 0.165, y);
    return [0.012 * k, -0.006 * k];
  };
  parts.push(P(LA(prof, sg(32), { sub: 1, uv: [1, 2], warp: pour }), TM.steel));
  const hp = smoothPath([V3(0, 0.146, 0.064), V3(0, 0.158, 0.098), V3(0, 0.13, 0.132), V3(0, 0.07, 0.125), V3(0, 0.04, 0.071)], 5);
  parts.push(P(SW(hp, () => [0.0065, 0.0042], 8), TM.steel));
  for (const [y, z] of [[0.146, 0.066], [0.04, 0.072]]) parts.push(P(rivetSide(0.0055, y, z, 0.0032, 1), TM.steelBright), P(rivetSide(-0.0055, y, z, 0.0032, -1), TM.steelBright));
  const gy = 0.1;
  const gz = 0.128;
  return assemble('chai-pot', shift(parts, 0, -gy, -gz), { tip: [0, 0.16 - gy, -0.075 - gz], baseY: gy });
}

function liquidLathe(r0, r1, y0, y1, fill, extraRise = 0.0012) {
  const yt = y0 + (y1 - y0) * fill;
  const rt = r0 + (r1 - r0) * fill;
  return { yt, rt, geo: LA([[0, y0], [r0, y0], [rt, yt - 0.0004], [rt - 0.0016, yt + extraRise], [0.006, yt - 0.0003], [0, yt - 0.0004]], 20, { sub: 0 }) };
}

function glassWithSaucer(opts = {}, id = 'steel-glass') {
  const parts = [];
  const fill = opts.fill == null ? 0.88 : opts.fill;
  const drink = opts.drink || 'chai';
  const oy = opts.saucer === false ? 0 : 0.0165;
  const shell = LA([[0.0262, 0.0], [0.0284, 0.0012], [0.0335, 0.04], [0.0368, 0.0855], [0.0376, 0.0886, true], [0.0364, 0.0888], [0.0348, 0.0868], [0.0318, 0.04], [0.0256, 0.011], [0.0, 0.0095]], sg(28), { sub: 1, uv: [1, 1] });
  parts.push(P(place(shell, { p: [0, oy, 0] }), TM.glass));
  if (fill > 0.01 && drink !== 'none') {
    const { yt, rt, geo } = liquidLathe(0.0256, 0.0352, 0.0115, 0.0845, fill);
    parts.push(P(place(geo, { p: [0, oy, 0] }), drink === 'coffee' ? TM.coffee : TM.chai));
    if (fill > 0.55) {
      const fr = LA([[0, yt + 0.0011], [rt - 0.0006, yt + 0.0009], [rt, yt - 0.0003], [rt - 0.002, yt - 0.001], [0, yt - 0.001]], 16, { sub: 0 });
      parts.push(P(place(fr, { p: [0, oy, 0] }), TM.froth));
    }
  }
  if (opts.saucer !== false) {
    const sau = LA([[0, 0], [0.03, 0], [0.05, 0.0035], [0.0675, 0.0135], [0.0705, 0.0158], [0.0694, 0.0168], [0.0665, 0.0148], [0.05, 0.0085], [0.027, 0.0055], [0, 0.0055]], sg(32), { sub: 1, uv: [1, 1] });
    parts.push(P(sau, TM.porcelain));
    parts.push(P(place(new TorusGeometry(0.0685, 0.0011, 5, sg(36)), { p: [0, 0.0153, 0], r: [Math.PI / 2, 0, 0] }), TM.porcelainBlue));
  }
  return assemble(id, parts, { grip: [0, oy + 0.045, 0], tip: [0, oy + 0.0888, 0], baseY: oy + 0.045 });
}

function davara(opts = {}) {
  const parts = [];
  const fill = opts.fill == null ? 0.85 : opts.fill;
  const tum = LA([[0, 0.0], [0.0285, 0.0], [0.0305, 0.0045], [0.0335, 0.04], [0.0362, 0.082], [0.0372, 0.0845, true], [0.0378, 0.087], [0.0364, 0.0885], [0.0348, 0.0865], [0.0335, 0.082], [0.031, 0.04], [0.0272, 0.008], [0, 0.006]], sg(28), { sub: 1, uv: [1, 3] });
  parts.push(P(place(tum, { p: [0, 0.0068, 0] }), TM.steelBright));
  const dav = LA([[0, 0.0], [0.045, 0.0], [0.065, 0.007], [0.082, 0.027], [0.0866, 0.0385], [0.0876, 0.041], [0.0858, 0.0422], [0.0835, 0.0395], [0.078, 0.027], [0.062, 0.0125], [0.04, 0.0075], [0, 0.007]], sg(36), { sub: 1, uv: [1, 3] });
  parts.push(P(dav, TM.steel));
  if (fill > 0.01) {
    const { yt, rt, geo } = liquidLathe(0.0272, 0.0345, 0.0148, 0.0835, fill);
    parts.push(P(place(geo, { p: [0, 0.0068, 0] }), TM.coffee));
    const fr = LA([[0, yt + 0.0016], [rt - 0.0006, yt + 0.0013], [rt, yt - 0.0004], [0, yt - 0.001]], 16, { sub: 0 });
    parts.push(P(place(fr, { p: [0, 0.0068, 0] }), TM.froth));
  }
  return assemble('davara', parts, { grip: [0, 0.05, 0], tip: [0, 0.095, 0], baseY: 0.05 });
}

const PLATE_PROF = [[0, 0.0015], [0.04, 0.0015], [0.062, 0.0], [0.07, 0.0016], [0.078, 0.0], [0.1, 0.0022], [0.114, 0.0105], [0.1195, 0.0212], [0.1218, 0.0252], [0.1228, 0.0272], [0.1208, 0.0286], [0.118, 0.0272], [0.1158, 0.0246], [0.1085, 0.0145], [0.092, 0.0078], [0.04, 0.0066], [0, 0.0066]];
/** Raw steel thali plate geometry (radius ~0.123, origin at the bottom centre). */
export function plateGeo(seg = 44, sub = 1) {
  return LA(PLATE_PROF, seg, { sub, uv: [3, 5] });
}
function plate() {
  const g = plateGeo(sg(44), 1);
  g.computeTangents();
  return assemble('plate', [P(g, TM.steel)], { grip: [0, 0.01, -0.1], tip: [0, 0.007, 0], baseY: 0 });
}

const KATORI_PROF = [[0, 0.0], [0.022, 0.0003], [0.034, 0.0065], [0.0425, 0.02], [0.0458, 0.034], [0.0468, 0.0384], [0.0452, 0.0402], [0.0436, 0.037], [0.0412, 0.0215], [0.0322, 0.0078], [0.0202, 0.0038], [0, 0.0035]];
/** Raw steel katori geometry (radius 0.047, height 0.04, origin at the bottom centre). */
export function katoriGeo(seg = 28, sub = 1) {
  return LA(KATORI_PROF, seg, { sub, uv: [2, 5] });
}
function katori(opts = {}) {
  const parts = [];
  parts.push(P(katoriGeo(sg(32), 1), TM.steel));
  const owned = [];
  let fillMesh = null;
  const fill = opts.fill;
  const tool = assemble('katori', parts, {
    grip: [0, 0.02, 0.0],
    tip: [0, 0.04, 0],
    baseY: 0.02,
    extra(t) {
      if (!fill) return;
      const color = fill === 'chutney-red' ? 'chutney-red' : fill === 'chutney' ? 'chutney' : 'sambar';
      const fm = createFoodMaterial('liquid', { uniforms: foodUniforms(color, { scale: 22, amt: color === 'sambar' ? 1 : 0.2, seed: 0.7 }) });
      t.owned.push(fm);
      const g = LA([[0, 0.0296], [0.0392, 0.0286], [0.0405, 0.0262], [0.0396, 0.0222], [0, 0.0222]], 20, { sub: 0 });
      t.geos.push(g);
      fillMesh = new Mesh(g, fm.mat);
      t.group.add(fillMesh);
    },
  });
  void owned;
  void fillMesh;
  return tool;
}

function bananaLeaf() {
  const nx = 14;
  const nz = 10;
  const W = 0.36;
  const D = 0.3;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const v = j / nz;
      const x = (u - 0.5) * W;
      const z = (v - 0.5) * D;
      const edge = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
      const cur = 0.012 * sstep(0.55, 1, edge) + 0.004 * Math.sin(u * 11 + v * 7) * sstep(0.3, 1, edge);
      pos.push(x, 0.0012 + cur + 0.0015 * Math.sin(v * 9 + u * 5), z);
      uv.push(v, u * 1.1);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return assemble('banana-leaf', [P(geo, TM.leaf)], { grip: [0, 0.002, 0], tip: [0, 0.002, -0.15], baseY: 0 });
}

function newspaperCone() {
  const cone = LA([[0.004, 0.0], [0.02, 0.05], [0.045, 0.11], [0.062, 0.16], [0.07, 0.19], [0.0715, 0.195]], sg(24), {
    sub: 1,
    uv: [1.4, 1.6],
    warp: (r, y, th) => [r * 0.06 * Math.sin(th * 2 + 0.7) * sstep(0.04, 0.19, y) + 0.002 * Math.sin(th * 7 + y * 30), 0],
  });
  // thin lip fold at the mouth
  const lip = LA([[0.07, 0.186], [0.0725, 0.19], [0.0715, 0.1985], [0.0695, 0.1945]], 20, { sub: 0, uv: [1.4, 1] });
  return assemble('newspaper-cone', [P(cone, TM.paper), P(lip, TM.paper)], { grip: [0, 0.1, 0], tip: [0, 0.195, 0], baseY: 0.1 });
}

function moneyBox(opts0 = {}) {
  const group = new Group();
  group.name = 'tool-money-box';
  group.userData.tool = 'money-box';
  group.userData.baseY = 0.055;
  const W = 0.3;
  const H = 0.075;
  const D = 0.2;
  const geos = [];
  const parts = [];
  // body: open tray + front and back walls, brass corner straps
  const wall = 0.012;
  parts.push(P(place(boxUV(W, 0.012, D, 0.5, 0.5), { p: [0, 0.006, 0] }), TM.wood));
  parts.push(P(place(boxUV(W, H, wall, 0.5, 0.5), { p: [0, H / 2, D / 2 - wall / 2] }), TM.wood));
  parts.push(P(place(boxUV(W, H, wall, 0.5, 0.5, [0.3, 0.2]), { p: [0, H / 2, -D / 2 + wall / 2] }), TM.wood));
  for (const s of [-1, 1]) parts.push(P(place(boxUV(wall, H, D - 2 * wall, 0.5, 0.5, [0.1, 0.6]), { p: [s * (W / 2 - wall / 2), H / 2, 0] }), TM.wood));
  for (const s of [-1, 1]) {
    for (const z of [-1, 1]) parts.push(P(place(boxUV(0.022, H + 0.002, 0.0025, 0.1, 0.1), { p: [s * (W / 2 - 0.012), H / 2, z * (D / 2 + 0.0008)] }), TM.brass));
    parts.push(P(place(boxUV(0.0025, H + 0.002, 0.022, 0.1, 0.1), { p: [s * (W / 2 + 0.0008), H / 2, 0] }), TM.brass));
  }
  parts.push(P(place(boxUV(0.05, 0.034, 0.003, 0.1, 0.1), { p: [0, H - 0.026, D / 2 + 0.0015] }), TM.brass)); // lock plate
  // coins and notes inside
  const coinG = [];
  for (let i = 0; i < 14; i++) {
    const a = i * 2.39996;
    const r = 0.015 + (i % 5) * 0.012;
    coinG.push(place(new CylinderGeometry(0.0105, 0.0105, 0.0016, 12), { p: [-0.07 + Math.cos(a) * r, 0.0135 + (i % 3) * 0.0016, 0.02 + Math.sin(a) * r * 0.7], r: [(i % 4) * 0.08, a, (i % 3) * 0.06] }));
  }
  for (const g of coinG) parts.push(P(g, TM.coin));
  const noteMat = noteMaterial(10);
  const noteG = [0, 1, 2].map((i) => place(new PlaneGeometry(0.12, 0.063, 4, 2).rotateX(-Math.PI / 2), { p: [0.07, 0.014 + i * 0.0012, 0.0 + i * 0.012 - 0.015], r: [0, 0.2 * i - 0.2, 0] }));
  const byMat = new Map();
  for (const p of parts) {
    if (!byMat.has(p.m)) byMat.set(p.m, []);
    byMat.get(p.m).push(p.g);
  }
  for (const [m, gs] of byMat) {
    const g = merge(gs, false);
    geos.push(g);
    group.add(new Mesh(g, typeof m === 'function' ? m() : m));
  }
  const noteGeo = merge(noteG, false);
  geos.push(noteGeo);
  group.add(new Mesh(noteGeo, noteMat));
  // lid on a back hinge
  const pivot = new Group();
  pivot.position.set(0, H, -D / 2);
  const lidParts = [
    P(place(boxUV(W + 0.012, 0.014, D + 0.01, 0.5, 0.5, [0.7, 0.4]), { p: [0, 0.007, D / 2] }), TM.wood),
    P(place(boxUV(W + 0.014, 0.003, 0.03, 0.1, 0.1), { p: [0, 0.015, D / 2 + 0.02] }), TM.brass),
    P(place(boxUV(0.08, 0.0035, 0.028, 0.1, 0.1), { p: [0, 0.0165, 0.1] }), TM.brass),
    P(place(new TorusGeometry(0.018, 0.0028, 6, 12, Math.PI), { p: [0, 0.0165, D / 2 + 0.0], r: [0, 0, 0] }), TM.brass),
  ];
  const lidBy = new Map();
  for (const p of lidParts) {
    if (!lidBy.has(p.m)) lidBy.set(p.m, []);
    lidBy.get(p.m).push(p.g);
  }
  for (const [m, gs] of lidBy) {
    const g = merge(gs, false);
    geos.push(g);
    pivot.add(new Mesh(g, typeof m === 'function' ? m() : m));
  }
  group.add(pivot);
  const gripO = new Object3D();
  gripO.name = 'grip';
  gripO.position.set(0, H / 2, 0);
  const tipO = new Object3D();
  tipO.name = 'tip';
  tipO.position.set(0, H + 0.01, 0);
  group.add(gripO, tipO);
  const tool = {
    group,
    grip: gripO,
    tip: tipO,
    geos,
    owned: [],
    set(k, v) {
      if (k === 'open') pivot.rotation.x = -Math.min(1, Math.max(0, v)) * 1.9;
    },
    update() {},
    dispose() {
      for (const g of geos) g.dispose();
      group.removeFromParent();
    },
  };
  tool.set('open', opts0.open ?? 0);
  return tool;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rupee notes: generic printed look (guilloche, border, numerals, watermark window), no portraits or serial numbers.
const NOTE_STYLE = {
  10: { a: '#a0795c', b: '#d9c08e', ink: '#4c2f1f', word: 'TEN' },
  20: { a: '#b6c46a', b: '#e6e3a2', ink: '#475a1c', word: 'TWENTY' },
  50: { a: '#5ec1c9', b: '#bfe6e2', ink: '#14565e', word: 'FIFTY' },
  100: { a: '#a98fc4', b: '#dbcdea', ink: '#43285f', word: 'HUNDRED' },
  500: { a: '#9aa293', b: '#d3d8c5', ink: '#3b4635', word: 'FIVE HUNDRED' },
};
function noteTexture(value) {
  return sharedTexture(`note:${value}`, () =>
    makeCanvasTexture(
      512,
      256,
      (g, w, h) => {
        const s = NOTE_STYLE[value] || NOTE_STYLE[10];
        const grd = g.createLinearGradient(0, 0, w, h);
        grd.addColorStop(0, s.a);
        grd.addColorStop(0.5, s.b);
        grd.addColorStop(1, s.a);
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
        // guilloche rosettes
        g.strokeStyle = s.ink;
        g.globalAlpha = 0.16;
        g.lineWidth = 1;
        for (const [cx, cy, R] of [[w * 0.2, h * 0.5, 96], [w * 0.8, h * 0.5, 96]]) {
          for (let k = 0; k < 40; k++) {
            g.beginPath();
            for (let a = 0; a <= 360; a += 4) {
              const rr = R * (0.55 + 0.45 * Math.sin((a * Math.PI) / 180 * 6 + k * 0.4));
              const x = cx + Math.cos((a * Math.PI) / 180) * rr * (0.6 + k / 100);
              const y = cy + Math.sin((a * Math.PI) / 180) * rr * (0.6 + k / 100);
              if (a === 0) g.moveTo(x, y);
              else g.lineTo(x, y);
            }
            g.stroke();
          }
        }
        g.globalAlpha = 0.12;
        for (let y = 14; y < h - 10; y += 5) {
          g.beginPath();
          for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.04 + y * 0.2) * 3);
          g.stroke();
        }
        g.globalAlpha = 1;
        g.strokeStyle = s.ink;
        g.lineWidth = 5;
        g.strokeRect(10, 10, w - 20, h - 20);
        g.lineWidth = 1.5;
        g.strokeRect(20, 20, w - 40, h - 40);
        // numeral, word and a watermark window
        g.fillStyle = s.ink;
        g.textBaseline = 'middle';
        g.font = '700 82px system-ui, sans-serif';
        g.textAlign = 'right';
        g.fillText(String(value), w - 34, h * 0.3);
        g.font = '700 30px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText(`${s.word} RUPEES`, w * 0.5, h * 0.86);
        g.font = '600 22px system-ui, sans-serif';
        g.textAlign = 'left';
        g.fillText('₹', 36, h * 0.18);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath();
        g.ellipse(w * 0.5, h * 0.5, 46, 58, 0, 0, TAU);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.fillRect(w * 0.37, 20, 5, h - 40);
      },
      { anisotropy: 8 },
    ),
  );
}
function noteMaterial(value) {
  return sharedMat(`note:${value}`, () => new MeshStandardMaterial({ map: noteTexture(value), roughness: 0.7, metalness: 0, side: DoubleSide }));
}

function note(opts = {}) {
  const g = new PlaneGeometry(0.12, 0.063, 8, 3).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setY(i, 0.003 * Math.cos((x / 0.06) * 1.2) + 0.0015 * Math.sin(x * 70));
  }
  g.computeVertexNormals();
  return assemble('note', [P(g, noteMaterial(opts.value || 10))], { grip: [0, 0, 0.02], tip: [0, 0, -0.03], baseY: 0 });
}

// ---------------------------------------------------------------------------------------------------------------------
const BUILDERS = {
  ladle,
  spatula,
  scraper,
  'onion-fork': onionFork,
  'oil-bottle': oilBottle,
  jhara,
  tongs,
  'chai-kettle': chaiKettle,
  'chai-pot': chaiPot,
  'steel-glass': (o) => glassWithSaucer(o, 'steel-glass'),
  davara,
  plate,
  katori,
  'banana-leaf': bananaLeaf,
  'newspaper-cone': newspaperCone,
  'money-box': moneyBox,
  note,
};

/** buildTool(id, opts) -> { group, grip, tip, set, dispose }. Unknown ids fall back to a small steel plate. */
export function buildTool(id, opts = {}) {
  const b = BUILDERS[id] || plate;
  const prev = LOD;
  LOD = opts && opts.lod === 'rest' ? 0.4 : opts && opts.lod === 'dish' ? 0.55 : 1;
  let t;
  try {
    t = b(opts || {});
  } finally {
    LOD = prev;
  }
  if (t.group.userData.tool !== id && !BUILDERS[id]) t.group.userData.tool = id;
  return { group: t.group, grip: t.grip, tip: t.tip, set: t.set, dispose: t.dispose };
}

export { disc, boxUV };
