// The 13 plated dishes, built from real food shapes with the procedural food shaders: rolled / folded lacy dosas, spongy idlis,
// blistered pooris, ring vadas, bonda balls, batter-coated chillies, plus stainless plates, katoris (sambar, chutneys), glass and leaf.
// Geometry + materials per (dish, quality) live in ONE cached pack (util.sharedTexture) so every spawned dish is a cheap Group of
// meshes sharing them; disposeModelCache() frees the packs.
import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, Mesh, SphereGeometry, TorusGeometry } from 'three';
import { merge, paint, place, polarDisc, lathe, disc, boxUV } from './geo.js';
import { buildTool } from './tools.js';
import { createDosaMaterial, createFoodMaterial, dosaUniforms, foodUniforms, setPalette } from './shaders/food.js';
import { wispMaterial, wispMesh } from './shaders/wisp.js';
import { pbrMaterial, plainMaterial, quality } from './pbr.js';
import { sharedMat, sharedTexture } from './util.js';
import { hashNoise } from './food-util.js';

export const QUALITIES = ['perfect', 'good', 'ok', 'burnt'];
const TAU = Math.PI * 2;
const PLATE_R = 0.1228;

// ---------------------------------------------------------------------------------------------------------------------
// materials (shared, cached per key; each is created once and registered with the util cache so disposeModelCache frees it)
const QCOOK = { perfect: 0.8, good: 0.86, ok: 0.96, burnt: 1.15 };
const QFRIED = { perfect: 0.62, good: 0.7, ok: 0.86, burnt: 1.2 };

function dosaSheetMat(q, kind, pal) {
  return sharedMat(`dish:dosa:${kind}:${pal}:${q}:${quality().detail}`, () => {
    const d = createDosaMaterial({ sheet: true, uniforms: dosaUniforms({ R: 0.112, sheetR: 1 }) });
    const u = d.uniforms;
    setPalette(u, pal);
    u.uCook.value = QCOOK[q];
    u.uBurn.value = q === 'burnt' ? 1 : q === 'ok' ? 0.12 : 0;
    u.uKind.value = kind;
    u.uRidge.value = 0.3;
    u.uCrisp.value = 0.8;
    u.uSeed.value = 0.41 + kind * 0.13;
    return d.mat;
  });
}
function dosaObjMat(q) {
  return sharedMat(`dish:setdosa:${q}:${quality().detail}`, () => {
    const d = createDosaMaterial({ obj: true });
    setPalette(d.uniforms, 'set');
    d.uniforms.uKind.value = 4;
    d.uniforms.uR.value = 0.056;
    d.uniforms.uCook.value = q === 'burnt' ? 1.05 : q === 'ok' ? 0.78 : q === 'good' ? 0.62 : 0.55;
    d.uniforms.uBurn.value = q === 'burnt' ? 1 : 0;
    return d.mat;
  });
}
function foodMat(mode, color, q, opts = {}) {
  return sharedMat(`dish:food:${mode}:${color}:${q}:${opts.scale ?? ''}:${opts.amt ?? ''}:${quality().detail}`, () => {
    const cook = mode === 'fried' ? QFRIED[q] : q === 'burnt' ? 0.9 : 0.7;
    const f = createFoodMaterial(mode, { uniforms: foodUniforms(color, { cook, burn: q === 'burnt' ? 1 : q === 'ok' && mode === 'fried' ? 0.1 : 0, scale: opts.scale ?? 9, amt: opts.amt ?? 1, seed: opts.seed ?? 0.5 }) });
    return f.mat;
  });
}
const steelMat = () => pbrMaterial('steel-brushed', { rough: 0.85, metal: 1, aniso: 0.3, key: 'tool-steel' });
const leafMat = () => pbrMaterial('leaf', { rough: 1, metal: 0, side: 2, key: 'leaf', sheen: 0.4, sheenColor: '#bfe39a' });
const paperMat = () => pbrMaterial('newspaper', { rough: 1, metal: 0, side: 2, key: 'news' });
const solid = (key, color, rough = 0.6, extra = {}) => plainMaterial(`dish:${key}`, { color, roughness: rough, metalness: 0, ...extra });
const greenMat = () => solid('curryleaf', '#2c5a1c', 0.45, { side: 2, clearcoat: 0.3 });
const redMat = () => solid('chilli', '#a81c10', 0.35, { clearcoat: 0.6 });
const limeMat = () => solid('lime', '#a9c92a', 0.5, { clearcoat: 0.3 });
const onionRingMat = () => solid('onionring', '#c88ab0', 0.4, { clearcoat: 0.4 });
const drumstickMat = () => solid('drumstick', '#6a7a2e', 0.6);
const tomatoMat = () => solid('tomato', '#c23a1a', 0.4, { clearcoat: 0.4 });

// ---------------------------------------------------------------------------------------------------------------------
// geometry helpers
const at = (g, x, y, z, ry = 0, rx = 0, rz = 0, s) => place(g, { p: [x, y, z], r: [rx, ry, rz], s });

/** Plate with a low segment count (dish budget). */
const PLATE_LOW = [[0, 0.0015], [0.1, 0.002], [0.114, 0.0105], [0.1218, 0.0252], [0.1228, 0.0272], [0.1208, 0.0286], [0.118, 0.0272], [0.1085, 0.0145], [0.092, 0.0078], [0, 0.0066]];
const dishPlate = () => lathe(PLATE_LOW, Math.max(18, Math.round(26 * quality().segScale)), { sub: 0, uv: [8, 5] });

function katoriLow() {
  const seg = Math.max(12, Math.round(16 * quality().segScale));
  return lathe([[0, 0.0], [0.03, 0.002], [0.0425, 0.02], [0.0466, 0.0386], [0.0452, 0.0402], [0.0412, 0.0215], [0.02, 0.0038], [0, 0.0035]], seg, { sub: 0, uv: [2, 5] });
}
function katoriFill(r = 0.0405, y = 0.029) {
  return lathe([[0, y + 0.0006], [r * 0.7, y + 0.0002], [r, y - 0.0016], [r * 0.99, y - 0.007], [0, y - 0.007]], 18, { sub: 0 });
}
function puffed(r, flat, seg, rows, seed, wob = 0.05) {
  const g = new SphereGeometry(r, seg, rows);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = hashNoise(x * 28 + seed, y * 28, z * 28 + seed);
    const k = 1 + wob * n;
    p.setXYZ(i, x * k, y * k * flat, z * k);
  }
  g.computeVertexNormals();
  return g;
}
/** A noisy blob (masala, upma, podi pile) from an icosahedron. */
function lump(r, sx, sy, sz, seed, detail = 1, amp = 0.28) {
  const g = new IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / r;
    const y = p.getY(i) / r;
    const z = p.getZ(i) / r;
    const k = 1 + amp * hashNoise(x * 3.2 + seed, y * 3.2, z * 3.2 + seed);
    p.setXYZ(i, x * r * k * sx, Math.max(y, -0.25) * r * k * sy, z * r * k * sz);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Rolled dosa: a slightly irregular cone tube along +x (tip at x=0, open mouth at x=len) lying on y=0 after the tilt.
 * uv = unrolled sheet in units of the dosa radius (0.112 m) so the lace scale matches the tawa dosa; the mouth edge is rn = 1.
 */
function rolledDosa(len, r0, r1, seed) {
  const rows = 12;
  const seg = Math.max(12, Math.round(16 * quality().segScale));
  const slope = (r1 - r0) / len;
  const xa = -r0 / slope;
  const sinH = slope / Math.sqrt(1 + slope * slope);
  const pos = [];
  const uv = [];
  const idx = [];
  const R = 0.112;
  let rhoMax = 0;
  for (let j = 0; j <= rows; j++) {
    const f = j / rows;
    const x = len * f;
    const base = r0 + (r1 - r0) * f ** 0.9;
    const rho = (x - xa) / Math.sqrt(1 + slope * slope);
    rhoMax = Math.max(rhoMax, rho);
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * TAU;
      const wrapped = Math.min(a, TAU - a);
      const seam = 0.07 * Math.exp(-((wrapped / 0.28) ** 2)) * (a < Math.PI ? 1 : -0.3);
      const wob = 1 + 0.045 * hashNoise(x * 18 + seed, a * 1.6, seed) + seam;
      const r = base * wob;
      pos.push(x, r * Math.cos(a), r * Math.sin(a));
      const th = a * sinH * 1.0;
      uv.push((rho * Math.cos(th)) / R, (rho * Math.sin(th)) / R);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let k = 0; k < seg; k++) {
      const a = j * (seg + 1) + k;
      const b = a + seg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // tilt so the lowest generator line is horizontal, then drop onto y = 0
  g.rotateZ(Math.atan(slope));
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0);
  g.userData.rhoMax = rhoMax / R;
  return g;
}

/** Half-moon folded dosa (flat half + arched flap) for pesarattu: uv = disc coordinates / R, rn = radius. */
function foldedDosa(R) {
  const rings = [0.16, 0.34, 0.5, 0.64, 0.76, 0.86, 0.94, 1];
  const seg = Math.max(20, Math.round(28 * quality().segScale));
  const pos = [];
  const uv = [];
  const idx = [];
  const arc = (s) => {
    // flap curve from the hinge: direction angle psi from +z, turning from up towards the flat half
    const n = 24;
    let z = 0;
    let y = 0;
    const ds = s / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const psi = Math.PI / 2 + 1.9 * (t * (s / R)) ** 0.9 * (R / Math.max(s, 1e-6)) ** 0.0;
      z += Math.cos(psi) * ds;
      y += Math.sin(psi) * ds;
    }
    return [z, y];
  };
  const add = (x, z0, fx, fz) => {
    let px = x;
    let py = 0.0008;
    let pz = z0;
    if (z0 > 0) {
      const [zz, yy] = arc(z0);
      pz = zz;
      py = yy + 0.0008;
    }
    pos.push(px, py, pz);
    uv.push(fx, fz);
  };
  add(0, 0, 0, 0);
  for (const f of rings) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      const x = Math.cos(a) * R * f;
      const z0 = Math.sin(a) * R * f;
      add(x, z0, Math.cos(a) * f, Math.sin(a) * f);
    }
  }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
  for (let j = 1; j < rings.length; j++) {
    const a0 = 1 + (j - 1) * seg;
    const a1 = 1 + j * seg;
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg;
      idx.push(a0 + i, a0 + i2, a1 + i, a0 + i2, a1 + i2, a1 + i);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function sheetOnPlate(parts, g, ry, x, y, z, mat) {
  parts.push({ g: at(g, x, y, z, ry), m: mat });
}

function newspaper(w = 0.34, lift = 0) {
  const nx = 8;
  const g = new BufferGeometry();
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= nx; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const v = j / nx;
      const e = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
      pos.push((u - 0.5) * w, 0.001 + 0.005 * e * e * e + 0.0015 * Math.sin(u * 7 + v * 5), (v - 0.5) * w);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i;
    idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
  }
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return place(g, { r: [0, 0.25, 0], p: [0, lift, 0] });
}

// ---------------------------------------------------------------------------------------------------------------------
// accompaniments
function sambarKatori(parts, x, z, q, y = 0, r = 1) {
  parts.push({ g: at(katoriLow(), x, y, z, 0, 0, 0, r), m: steelMat });
  parts.push({ g: at(katoriFill(), x, y, z, 0, 0, 0, r), m: foodMat('liquid', 'sambar', q, { scale: 22, amt: 1, seed: 0.7 }) });
  // drumstick piece, tomato wedge, curry leaf
  parts.push({ g: at(new CylinderGeometry(0.0042, 0.0042, 0.034, 6), x - 0.01 * r, y + 0.0302, z + 0.004, 0.5, 0, Math.PI / 2 - 0.2), m: drumstickMat });
  parts.push({ g: at(new SphereGeometry(0.008, 7, 5), x + 0.016 * r, y + 0.0305, z - 0.008, 0, 0, 0, [1, 0.5, 1]), m: tomatoMat });
  parts.push({ g: at(new SphereGeometry(0.007, 6, 4), x + 0.002 * r, y + 0.0295, z + 0.016, 0.7, 0, 0, [1.5, 0.12, 0.8]), m: greenMat });
}
function chutneyKatori(parts, x, z, q, kind = 'chutney', y = 0, r = 1) {
  parts.push({ g: at(katoriLow(), x, y, z, 0, 0, 0, r), m: steelMat });
  parts.push({ g: at(katoriFill(), x, y, z, 0, 0, 0, r), m: foodMat('liquid', kind, q, { scale: 24, amt: 0.15, seed: 0.3 }) });
  if (kind === 'chutney') {
    // mustard and curry-leaf tempering, a dried red chilli
    parts.push({ g: at(new SphereGeometry(0.007, 6, 4), x + 0.008 * r, y + 0.0296, z - 0.005, 0.3, 0, 0, [1.6, 0.14, 0.8]), m: greenMat });
    parts.push({ g: at(new SphereGeometry(0.006, 6, 4), x - 0.006 * r, y + 0.0296, z + 0.006, 1.2, 0, 0, [1.5, 0.14, 0.8]), m: greenMat });
    parts.push({ g: at(new CylinderGeometry(0.0022, 0.0016, 0.022, 5), x + 0.002 * r, y + 0.0303, z + 0.002, 0.9, 0, Math.PI / 2), m: redMat });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
const BUILD = {
  dosa(parts, q) {
    const plate = dishPlate();
    parts.push({ g: plate, m: steelMat });
    const mat = dosaSheetMat(q, 0, 'plain');
    const g = rolledDosa(0.33, 0.02, 0.05, 1.3);
    mat.userData.sheetR = g.userData.rhoMax;
    sheetOnPlate(parts, g, 0.38, -0.15, 0.0066, 0.045, mat);
    sambarKatori(parts, -0.07, -0.11, q);
    chutneyKatori(parts, 0.075, -0.115, q);
  },
  masala_dosa(parts, q) {
    parts.push({ g: dishPlate(), m: steelMat });
    const mat = dosaSheetMat(q, 1, 'plain');
    const g = rolledDosa(0.33, 0.02, 0.07, 2.1);
    mat.userData.sheetR = g.userData.rhoMax;
    sheetOnPlate(parts, g, 0.3, -0.17, 0.0066, 0.05, mat);
    // potato masala spilling out of the open mouth
    const mm = foodMat('masala', 'masala', q, { scale: 14, seed: 0.2 });
    const mx = -0.17 + 0.33 * Math.cos(0.3);
    const mz = 0.05 - 0.33 * Math.sin(0.3);
    parts.push({ g: at(lump(0.05, 1.0, 0.85, 1.0, 0.3, 1), mx + 0.004, 0.04, mz, 0.4), m: mm });
    parts.push({ g: at(lump(0.034, 1, 0.8, 1, 1.7, 1), mx + 0.035, 0.03, mz + 0.034, 1.0), m: mm });
    parts.push({ g: at(lump(0.03, 1, 0.8, 1, 3.1, 1), mx + 0.03, 0.028, mz - 0.038, 2.0), m: mm });
    sambarKatori(parts, -0.075, -0.115, q);
    chutneyKatori(parts, 0.075, -0.12, q);
  },
  podi_dosa(parts, q) {
    parts.push({ g: dishPlate(), m: steelMat });
    const mat = sharedMat(`dish:podidosa:${q}:${quality().detail}`, () => {
      const d = createDosaMaterial({ sheet: true, uniforms: dosaUniforms({ R: 0.112 }) });
      setPalette(d.uniforms, 'plain');
      d.uniforms.uCook.value = QCOOK[q];
      d.uniforms.uBurn.value = q === 'burnt' ? 1 : 0;
      d.uniforms.uPodi.value = q === 'burnt' ? 0.4 : 1;
      d.uniforms.uKind.value = 2;
      d.uniforms.uCrisp.value = 0.8;
      d.uniforms.uRidge.value = 0.3;
      return d.mat;
    });
    const g = rolledDosa(0.33, 0.02, 0.05, 3.7);
    mat.userData.sheetR = g.userData.rhoMax;
    sheetOnPlate(parts, g, 0.38, -0.15, 0.0066, 0.045, mat);
    // podi pile + a yellow glint of ghee
    parts.push({ g: at(lump(0.022, 1.2, 0.6, 1, 4.4, 1), 0.07, 0.01, 0.07, 0.3), m: foodMat('powder', 'podi', q, { scale: 20 }) });
    sambarKatori(parts, -0.07, -0.11, q);
    chutneyKatori(parts, 0.075, -0.115, q);
  },
  set_dosa(parts, q) {
    parts.push({ g: dishPlate(), m: steelMat });
    const mat = dosaObjMat(q);
    const seg = Math.max(14, Math.round(18 * quality().segScale));
    const disc3 = () => lathe([[0, 0.0], [0.049, 0.0], [0.055, 0.003], [0.0568, 0.012], [0.0545, 0.0195], [0.043, 0.0238], [0.02, 0.0252], [0, 0.0255]], seg, { sub: 0 });
    [[-0.052, 0.032, 0.2, 0.0066], [0.05, 0.03, 0.9, 0.0066], [0.0, -0.034, 1.5, 0.0066], [-0.01, 0.016, 0.3, 0.0318]].forEach(([x, z, ry, y], i) => parts.push({ g: at(disc3(), x, y, z, ry, 0, 0, i === 3 ? 0.93 : 1), m: mat }));
    sambarKatori(parts, -0.075, -0.115, q);
    chutneyKatori(parts, 0.075, -0.12, q);
  },
  pesarattu(parts, q) {
    parts.push({ g: dishPlate(), m: steelMat });
    const mat = dosaSheetMat(q, 3, 'pesarattu');
    sheetOnPlate(parts, foldedDosa(0.112), 0.0, 0.0, 0.0066, 0.01, mat);
    // upma tucked inside the fold and spilling out of the open side
    parts.push({ g: at(lump(0.03, 1.4, 0.7, 1, 6.2, 1), 0.005, 0.02, -0.07, 0.3), m: sharedMat(`dish:upma:${q}`, () => foodMatPale(q)) });
    sambarKatori(parts, -0.085, -0.115, q);
    chutneyKatori(parts, 0.075, -0.12, q, 'chutney');
  },
  idly(parts, q) {
    const leafG = bananaLeafGeo();
    parts.push({ g: at(leafG, 0, 0, 0.01), m: leafMat });
    parts.push({ g: at(dishPlate(), 0, 0.004, 0.012, 0, 0, 0, 0.96), m: steelMat });
    const seg = Math.max(14, Math.round(20 * quality().segScale));
    const idli = () => lathe([[0, 0.0], [0.034, 0.0], [0.0405, 0.005], [0.0412, 0.013], [0.0368, 0.024], [0.0245, 0.0315], [0.008, 0.0338], [0, 0.034]], seg, { sub: 0, uv: [1, 8] });
    const im = foodMat('idli', 'idli', q, { scale: 16, seed: 0.9 });
    const ig = (x, z, ry) => parts.push({ g: at(idli(), x, 0.0104, z, ry), m: im });
    ig(-0.05, 0.035, 0.4);
    ig(0.05, 0.03, 1.4);
    ig(0.0, 0.08, 2.1);
    sambarKatori(parts, -0.07, -0.075, q, 0.004, 0.9);
    chutneyKatori(parts, 0.07, -0.075, q, 'chutney', 0.004, 0.9);
  },
  poori(parts, q) {
    parts.push({ g: dishPlate(), m: steelMat });
    const pm = foodMat('fried', 'poori', q, { scale: 8, amt: 0.8, seed: 0.4 });
    const seg = Math.max(14, Math.round(18 * quality().segScale));
    parts.push({ g: at(puffed(0.075, 0.62, seg, 10, 1.3, 0.05), -0.04, 0.052, 0.05, 0.4, 0.08, 0.1), m: pm });
    parts.push({ g: at(puffed(0.072, 0.6, seg, 10, 4.1, 0.05), 0.045, 0.074, 0.035, 1.4, -0.06, -0.12), m: pm });
    // aloo bhaji katori
    parts.push({ g: at(katoriLow(), 0.0, 0.0, -0.105, 0, 0, 0, 1.2), m: steelMat });
    parts.push({ g: at(katoriFill(0.0405 * 1.2, 0.029 * 1.2), 0.0, 0.0, -0.105), m: foodMat('masala', 'masala', q, { scale: 16, seed: 0.8 }) });
    for (const [dx, dz, s] of [[-0.012, -0.01, 1], [0.014, 0.004, 0.9], [0.0, 0.016, 0.8]]) parts.push({ g: at(lump(0.016, 1.1, 0.8, 1, 8 + dx * 99, 1, 0.18), dx, 0.037, -0.105 + dz, dx * 40, 0, 0, s), m: foodMat('masala', 'masala', q, { scale: 16, seed: 0.8 }) });
    parts.push({ g: at(new SphereGeometry(0.006, 6, 4), 0.02, 0.0375, -0.112, 0, 0, 0, [1, 0.8, 1]), m: redMat });
  },
  vada(parts, q) {
    parts.push({ g: dishPlate(), m: steelMat });
    const vm = foodMat('fried', 'vada', q, { scale: 12, amt: 1.3, seed: 0.6 });
    const seg = Math.max(12, Math.round(16 * quality().segScale));
    const vada = (seed) => {
      const g = new TorusGeometry(0.034, 0.0185, 8, seg);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const n = hashNoise(x * 30 + seed, y * 30, z * 30);
        const k = 1 + 0.07 * n;
        p.setXYZ(i, x * k, y * k, z * k * 0.62);
      }
      g.computeVertexNormals();
      return g.rotateX(Math.PI / 2);
    };
    [[-0.055, 0.04, 0.2], [0.058, 0.04, 1.0], [0.0, -0.035, 2.0]].forEach(([x, z, ry], i) => parts.push({ g: at(vada(i * 3.3), x, 0.0182, z, ry, 0.05 * i), m: vm }));
    sambarKatori(parts, -0.085, -0.1, q, 0, 0.9);
    chutneyKatori(parts, 0.085, -0.1, q, 'chutney', 0, 0.9);
  },
  mysore_bonda(parts, q) {
    parts.push({ g: newspaper(0.34), m: paperMat });
    const bm = foodMat('fried', 'bonda', q, { scale: 14, amt: 1.2, seed: 0.3 });
    const seg = Math.max(12, Math.round(16 * quality().segScale));
    [[-0.07, 0.0, 0.045], [0.07, -0.005, 0.05], [0.0, -0.01, -0.05], [-0.03, 0.043, 0.0], [0.035, 0.043, 0.01]].forEach(([x, y, z], i) => {
      const r = 0.03 + (i % 3) * 0.0025;
      parts.push({ g: at(puffed(r, 0.96, seg, 9, i * 2.7, 0.07), x, r * 0.95 + y + 0.003, z, i), m: bm });
    });
    chutneyKatori(parts, 0.115, -0.12, q, 'chutney');
  },
  mirchi_bajji(parts, q) {
    parts.push({ g: newspaper(0.34), m: paperMat });
    const bm = foodMat('fried', 'bajji', q, { scale: 10, amt: 0.6, seed: 0.2 });
    const seg = Math.max(10, Math.round(14 * quality().segScale));
    const bajji = (seed, x, z, ry) => {
      // a long chilli in a smooth chickpea-flour coat, tapering to the tip; a green stalk at the stem end
      const g = lathe([[0, 0], [0.018, 0.004], [0.0285, 0.025], [0.0305, 0.06], [0.0265, 0.095], [0.018, 0.12], [0.0075, 0.133], [0, 0.1345]], seg, { sub: 0, uv: [1, 1],
        warp: (r, y, th) => [r * 0.06 * hashNoise(th * 2 + seed, y * 40, seed), 0] });
      g.rotateZ(-Math.PI / 2).translate(-0.067, 0, 0);
      parts.push({ g: at(g, x, 0.0305, z, ry), m: bm });
      const st = new CylinderGeometry(0.0042, 0.0055, 0.032, 6).rotateZ(Math.PI / 2).translate(-0.08, 0.002, 0);
      parts.push({ g: at(st, x, 0.0305, z, ry), m: greenMat });
    };
    [[0, -0.01, 0.04, 0.12], [5, 0.0, 0.075, -0.15], [10, -0.02, -0.035, 0.05], [15, 0.03, -0.075, -0.3]].forEach(([seed, x, z, ry]) => bajji(seed, x, z, ry));
    for (const [x, z, ry] of [[0.095, 0.075, 0.2], [0.125, 0.06, 1.0], [0.1, 0.105, 2.0]]) parts.push({ g: at(new TorusGeometry(0.026, 0.0055, 5, 14).rotateX(Math.PI / 2), x, 0.007, z, ry), m: onionRingMat });
    parts.push({ g: at(new SphereGeometry(0.024, 8, 4, 0, TAU, 0, Math.PI / 2), -0.11, 0.003, 0.1, 0.5, 0, 0, [1, 0.8, 0.6]), m: limeMat });
  },
  irani_chai(parts, q) {
    toolParts(parts, 'steel-glass', { fill: q === 'burnt' ? 0.2 : 0.9, drink: 'chai' });
    // a biscuit-sized spoon on the saucer
    parts.push({ g: at(new CylinderGeometry(0.0016, 0.0016, 0.1, 5), 0.038, 0.0215, 0.05, 0.5, 0, Math.PI / 2 - 0.06), m: steelMat });
  },
  filter_coffee(parts, q) {
    toolParts(parts, 'davara', { fill: q === 'burnt' ? 0.2 : 0.88 });
  },
  osmania(parts, q) {
    // Osmania biscuits on a saucer
    const sau = lathe([[0, 0], [0.05, 0], [0.09, 0.006], [0.13, 0.0235], [0.1385, 0.0262], [0.1365, 0.0275], [0.126, 0.0225], [0.08, 0.009], [0, 0.006]], Math.max(20, Math.round(30 * quality().segScale)), { sub: 0, uv: [1, 3] });
    parts.push({ g: sau, m: () => plainMaterial('porcelain', { color: '#f3efe6', roughness: 0.18, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.08 }) });
    parts.push({ g: at(new TorusGeometry(0.1368, 0.0012, 5, 36).rotateX(Math.PI / 2), 0, 0.0268, 0), m: () => plainMaterial('porcelainblue', { color: '#2a62ae', roughness: 0.2, metalness: 0, clearcoat: 0.8 }) });
    const bm = sharedMat(`dish:biscuit:${q}`, () => foodMatBiscuit(q));
    const bis = (x, y, z, ry, rz = 0) => {
      const g = new CylinderGeometry(0.052, 0.054, 0.016, 22);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * (1 + (p.getY(i) > 0 ? 0.08 * Math.sin(p.getX(i) * 90) : 0)));
      g.computeVertexNormals();
      return at(g, x, y, z, ry, 0, rz);
    };
    parts.push({ g: bis(-0.03, 0.03, 0.0, 0.2), m: bm });
    parts.push({ g: bis(0.03, 0.036, 0.02, 1.0, 0.0), m: bm });
    parts.push({ g: bis(0.02, 0.07, -0.02, 0.6, 0.55), m: bm });
  },
};

// Pale upma / biscuit materials
function foodMatPale(q) {
  const f = createFoodMaterial('powder', { uniforms: foodUniforms('podi', { scale: 26 }) });
  f.uniforms.uA.value.setRGB(0.92, 0.8, 0.46);
  f.uniforms.uB.value.setRGB(0.98, 0.9, 0.62);
  return f.mat;
}
function foodMatBiscuit(q) {
  const f = createFoodMaterial('powder', { uniforms: foodUniforms('podi', { scale: 14 }) });
  const dark = q === 'burnt' ? 0.4 : 1;
  f.uniforms.uA.value.setRGB(0.93 * dark, 0.8 * dark, 0.5 * dark);
  f.uniforms.uB.value.setRGB(0.98 * dark, 0.86 * dark, 0.56 * dark);
  return f.mat;
}

function bananaLeafGeo() {
  const t = buildTool('banana-leaf', { lod: 'dish' });
  const g = t.group.children.find((c) => c.isMesh).geometry.clone();
  t.dispose();
  return place(g.scale(0.95, 1, 0.95), {});
}
function toolParts(parts, id, opts) {
  const t = buildTool(id, { ...opts, lod: 'dish' });
  t.group.traverse((o) => {
    if (o.isMesh) parts.push({ g: o.geometry.clone(), m: o.material });
  });
  t.dispose();
}

// ---------------------------------------------------------------------------------------------------------------------
function buildPack(id, q) {
  const parts = [];
  const fn = BUILD[id] || BUILD.dosa;
  fn(parts, q);
  const byMat = new Map();
  for (const p of parts) {
    const m = typeof p.m === 'function' ? p.m() : p.m;
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m).push(p.g);
  }
  const items = [];
  for (const [m, gs] of byMat) {
    const geo = merge(gs, false);
    geo.userData.shared = true;
    items.push({ geo, mat: m });
  }
  // sheet shaders need the unrolled-sheet extent for edge browning
  for (const it of items) {
    const u = it.mat.userData?.tcUniforms;
    if (u && u.uSheetR && it.mat.userData.sheetR) u.uSheetR.value = it.mat.userData.sheetR;
  }
  // geometry-only dosa with a fallback plate for unknown ids
  const wispMat = q === 'perfect' ? wispMaterial(hashNoise(id.length, 3, 1) * 3, 0.32) : null;
  const pack = {
    items,
    wispMat,
    userData: { shared: true },
    dispose() {
      for (const it of items) it.geo.dispose();
      wispMat?.dispose();
    },
  };
  return pack;
}

/** buildDish(dishId, q) -> Group of meshes sharing cached geometry and materials (origin at the base, ~0.3 m wide). */
export function buildDish(dishId, q = 'good') {
  const quality_ = QUALITIES.includes(q) ? q : 'good';
  const id = BUILD[dishId] ? dishId : 'dosa';
  const pack = sharedTexture(`dishpack:${id}:${quality_}:${quality().name}`, () => buildPack(id, quality_));
  const group = new Group();
  group.name = `dish-${dishId}`;
  group.userData.dish = dishId;
  group.userData.q = quality_;
  for (const it of pack.items) {
    const m = new Mesh(it.geo, it.mat);
    group.add(m);
  }
  if (pack.wispMat) {
    group.add(wispMesh(pack.wispMat, 0.0, 0.05, 0.0, 0.1, 0.17));
  }
  return group;
}

export { PLATE_R, disc, boxUV, paint, polarDisc };
