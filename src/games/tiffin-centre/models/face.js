// The head: sculpted skin loft with morph-target expressions, real eyeballs with lids that blink and track, brows, lashes, teeth,
// tongue, ears, facial hair, glasses and jewellery. Everything is procedural geometry + GLSL (see skin.js); node-safe.
//
//   const head = buildHead({ kind: 'uncle', seed: 4 });         // head.group in head space (origin = eye line, +z forward)
//   head.setExpression('angry', 1, 250); head.setSpeaking(1500, 0.8); head.lookAt(worldVec3); head.update(dt, t);
import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { disposeObject, rng, hashSeed } from './util.js';
import { tierOf } from './charquality.js';
import { AU, AU_NAMES, ExpressionState } from './expressions.js';
import { BOTTOM, CROWN, EYE_R, EYE_X, MOUTH_EPS, MOUTH_Y, ROWS, gauss, makeFaceParams, makeShape, smooth } from './facegen.js';
import { cloneSkinMaterial, createEyeMaterial, createHairMaterial, createSkinMaterial } from './skin.js';

const lerp = (a, b, k) => a + (b - a) * k;
const TAU = Math.PI * 2;

// Drop rows (by ROWS index) for lighter tiers. Mouth rows (23, 24) and the lip rows always stay.
const DROP = { 0.75: [1, 3, 8, 10, 14, 29, 31], 0.55: [1, 3, 5, 8, 10, 12, 14, 16, 20, 26, 29, 31, 33] };
const MORPH_SETS = {
  all: AU_NAMES,
  core: ['jawOpen', 'smileL', 'smileR', 'frownL', 'frownR', 'pucker', 'lipsPress', 'browDownL', 'browDownR', 'browInnerUp', 'browUpL', 'browUpR', 'upperLipUp'],
  min: ['jawOpen', 'smileL', 'smileR', 'frownL', 'frownR', 'browDownL', 'browDownR', 'browUpL', 'browUpR'],
};

// ---------------------------------------------------------------------------------------------------------------------
// Morph fields: the rest-position -> delta function of every AU. Used for the skin AND everything that sticks to the skin.
function makeFields(shape) {
  const P = shape.P;
  const un = shape.unwarp;
  const lw = P.lipW;
  const hingeY = shape.vwarp(-0.032);
  const rot = { y: 0, z: 0 };
  return function delta(a, x, y, z, o) {
    o.x = o.y = o.z = 0;
    const ys = un(y);
    const ax = Math.abs(x);
    const sx = x >= 0 ? 1 : -1;
    const dm = ys - MOUTH_Y;
    switch (a) {
      case AU.jawOpen: {
        const w = smooth(MOUTH_Y + 0.0004, MOUTH_Y - 0.0004, ys) * (1 - 0.78 * smooth(0.03, 0.075, ax));
        if (w <= 0) return;
        const ang = 0.42 * w;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const py = y - hingeY;
        const pz = z + 0.045;
        rot.y = py * c - pz * s;
        rot.z = py * s + pz * c;
        o.y = rot.y - py;
        o.z = rot.z - pz;
        return;
      }
      case AU.smileL:
      case AU.smileR: {
        const s = a === AU.smileL ? 1 : -1;
        const w1 = gauss(x - s * 0.0275 * lw, 0.0165) * gauss(dm, 0.0145);
        const w2 = gauss(x - s * 0.047, 0.021) * gauss(ys + 0.032, 0.02);
        const w3 = gauss(x - s * 0.012, 0.016) * gauss(ys + 0.066, 0.008);
        o.x = s * 0.0085 * w1;
        o.y = 0.0105 * w1 + 0.0045 * w2 + 0.0025 * w3;
        o.z = -0.0012 * w1 + 0.0035 * w2;
        return;
      }
      case AU.frownL:
      case AU.frownR: {
        const s = a === AU.frownL ? 1 : -1;
        const w1 = gauss(x - s * 0.0275 * lw, 0.0155) * gauss(dm, 0.013);
        o.x = -s * 0.0022 * w1;
        o.y = -0.0085 * w1;
        o.z = 0.0008 * w1;
        const wc = gauss(x - s * 0.01, 0.02) * gauss(ys + 0.098, 0.012);
        o.y += 0.0022 * wc;
        return;
      }
      case AU.pucker: {
        const w = gauss(ax, 0.031) * gauss(dm, 0.0165);
        o.x = -x * 0.4 * w;
        o.z = 0.0115 * w;
        o.y = -dm * 0.08 * w;
        return;
      }
      case AU.stretch: {
        const w = gauss(ax - 0.03, 0.02) * gauss(dm, 0.016);
        o.x = sx * 0.0078 * w;
        o.y = 0.0008 * w;
        o.z = -0.0016 * w;
        return;
      }
      case AU.lipsPress: {
        const w = gauss(ax, 0.031) * gauss(dm, 0.0105);
        o.z = -0.0042 * w;
        o.y = -dm * 0.3 * w;
        o.x = -x * 0.04 * w;
        const wc = gauss(x - sx * 0.026 * lw, 0.01) * gauss(dm, 0.008);
        o.y -= 0.0018 * wc;
        return;
      }
      case AU.upperLipUp: {
        const w = gauss(ax, 0.0215) * gauss(ys + 0.0625, 0.0062);
        o.y = 0.0068 * w;
        o.z = 0.0008 * w;
        const wa = gauss(ax - 0.0148, 0.009) * gauss(ys + 0.0455, 0.009);
        o.y += 0.0028 * wa;
        o.x = sx * 0.0016 * wa;
        return;
      }
      case AU.browDownL:
      case AU.browDownR: {
        const s = a === AU.browDownL ? 1 : -1;
        const w = gauss(x - s * 0.034, 0.03) * gauss(ys - 0.031, 0.0135);
        const wi = gauss(x - s * 0.015, 0.016) * gauss(ys - 0.03, 0.012);
        const wf = gauss(x - s * 0.03, 0.036) * gauss(ys - 0.052, 0.022);
        o.y = -0.0065 * w - 0.0035 * wi - 0.0025 * wf;
        o.x = -s * 0.0042 * (w + wi) * 0.7;
        o.z = 0.0022 * wi + 0.0006 * w;
        return;
      }
      case AU.browInnerUp: {
        const w = gauss(ax - 0.014, 0.0155) * gauss(ys - 0.032, 0.0145);
        const wf = gauss(x, 0.03) * gauss(ys - 0.056, 0.022);
        o.y = 0.0095 * w + 0.0045 * wf;
        o.z = 0.0012 * w;
        return;
      }
      case AU.browUpL:
      case AU.browUpR: {
        const s = a === AU.browUpL ? 1 : -1;
        const w = gauss(x - s * 0.036, 0.03) * gauss(ys - 0.032, 0.0145);
        const wf = gauss(x - s * 0.03, 0.036) * gauss(ys - 0.056, 0.024);
        o.y = 0.0092 * w + 0.0052 * wf;
        o.z = 0.0008 * w;
        return;
      }
      case AU.noseWrinkle: {
        const w1 = gauss(x, 0.02) * gauss(ys + 0.012, 0.02);
        const wa = gauss(ax - 0.015, 0.01) * gauss(ys + 0.0455, 0.009);
        const wc = gauss(ax - 0.04, 0.02) * gauss(ys + 0.022, 0.016);
        o.y = 0.0028 * w1 + 0.0022 * wa + 0.0035 * wc;
        o.x = sx * 0.0032 * wa;
        o.z = -0.0012 * w1 + 0.0008 * wc;
        const wl = gauss(ax, 0.02) * gauss(ys + 0.0625, 0.008);
        o.y += 0.0022 * wl;
        return;
      }
      case AU.chinUp: {
        const w = gauss(x, 0.021) * gauss(ys + 0.108, 0.012);
        const wl = gauss(x, 0.02) * gauss(ys + 0.082, 0.008);
        o.y = 0.0062 * w + 0.0025 * wl;
        o.z = 0.002 * w + 0.0006 * wl;
        return;
      }
      default:
    }
  };
}

function addMorphs(geo, fields, auList) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const o = { x: 0, y: 0, z: 0 };
  const list = [];
  const names = [];
  for (const name of auList) {
    const a = AU[name];
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      fields(a, pos.getX(i), pos.getY(i), pos.getZ(i), o);
      arr[i * 3] = o.x;
      arr[i * 3 + 1] = o.y;
      arr[i * 3 + 2] = o.z;
    }
    list.push(new Float32BufferAttribute(arr, 3));
    names.push(a);
  }
  geo.morphAttributes.position = list;
  geo.morphTargetsRelative = true;
  geo.userData.morphAU = names;
  return names;
}

// ---------------------------------------------------------------------------------------------------------------------
function buildSkinGeometry(shape, tier) {
  const U = tier.headCols;
  const drop = new Set(DROP[tier.headDetail] || []);
  const rows = ROWS.filter((_, i) => !drop.has(i));
  const f = (s) => s * (0.5 + 0.5 * s * s);
  const th = (k) => Math.PI * f(-1 + (2 * k) / U);
  const kHalf = Math.max(2, Math.round(0.27 / (2 / U)));
  const kA = U / 2 - kHalf;
  const kB = U / 2 + kHalf;
  const pos = [];
  const ring = [];
  const tmp = { x: 0, y: 0, z: 0 };
  const push = (th2, y) => {
    shape.point(th2, y, tmp);
    pos.push(tmp.x, tmp.y, tmp.z);
    return pos.length / 3 - 1;
  };
  const top = push(0, CROWN);
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    const r = new Array(U);
    for (let k = 0; k < U; k++) {
      if (row === 'M0') r[k] = push(th(k), k > kA && k < kB ? MOUTH_Y + MOUTH_EPS : MOUTH_Y);
      else if (row === 'M1') r[k] = k > kA && k < kB ? push(th(k), MOUTH_Y - MOUTH_EPS) : ring[j - 1][k];
      else r[k] = push(th(k), row);
    }
    ring.push(r);
  }
  const bottom = push(0, BOTTOM);
  const idx = [];
  const m0 = rows.indexOf('M0');
  const last = rows.length - 1;
  for (let k = 0; k < U; k++) {
    const k2 = (k + 1) % U;
    idx.push(top, ring[0][k], ring[0][k2]);
    for (let j = 0; j < last; j++) {
      if (j === m0) continue; // the mouth strip: a real opening once the lips part, zero height while closed
      const a = ring[j][k];
      const b = ring[j][k2];
      const c = ring[j + 1][k];
      const d = ring[j + 1][k2];
      if (a !== c && b !== d) {
        idx.push(a, c, b, b, c, d);
      } else if (a !== c) idx.push(a, c, b);
      else if (b !== d) idx.push(b, c, d);
    }
    idx.push(bottom, ring[last][k2], ring[last][k]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('aEdge', new Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  // smooth the lip-line normals across the closed mouth for the welded corner columns is automatic (shared vertices)
  return { geometry: g, kA, kB, rows };
}

function earGeometry(side, size, off) {
  // a shallow dish with a raised helix rim and a hollow concha; lobe stretched downward
  const NR = 4;
  const NA = 10;
  const pos = [];
  const idx = [];
  const rx = 0.0185 * size;
  const ry = 0.0345 * size;
  for (let i = 0; i <= NR; i++) {
    const r = i / NR;
    for (let a = 0; a < NA; a++) {
      const an = (a / NA) * TAU;
      const ca = Math.cos(an);
      const sa = Math.sin(an);
      const lobe = sa < -0.2 ? 0.12 * -sa : 0; // lobe hangs lower
      const x = rx * r * ca * (1 - 0.1 * sa * sa) - 0.0016 * size * (1 - r);
      const y = ry * r * (sa + lobe);
      const h = 0.0032 + 0.0078 * smooth(0.6, 0.84, r) * (1 - smooth(0.9, 1.0, r) * 0.75) - 0.0042 * smooth(0.4, 0.1, r) + 0.0014 * smooth(0.2, 0.0, r) * 0;
      pos.push(side * (h * 1.0), y, -x); // local: +x outward, y up, z back to front reversed so the rim faces forward
    }
  }
  for (let i = 0; i < NR; i++) {
    for (let a = 0; a < NA; a++) {
      const a2 = (a + 1) % NA;
      const p = i * NA + a;
      const q = i * NA + a2;
      const s = (i + 1) * NA + a;
      const t = (i + 1) * NA + a2;
      if (side > 0) idx.push(p, q, s, q, t, s);
      else idx.push(p, s, q, q, s, t);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.rotateY(side * 0.0);
  g.rotateZ(side * -0.2); // the top leans back
  g.rotateY(side * -0.62); // splay out
  g.translate(off.x, off.y, off.z);
  g.computeVertexNormals();
  g.setAttribute('aEdge', new Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  return g;
}

function eyeballGeometry(R, seg) {
  const g = new SphereGeometry(R, seg[0], seg[1]);
  g.rotateX(Math.PI / 2); // pole -> +z (the gaze axis)
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const l = Math.hypot(x, y, z) || 1;
    const psi = Math.acos(Math.max(-1, Math.min(1, z / l)));
    const k = 1 + 0.115 * smooth(0.55, 0.0, psi); // cornea bulge
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A lid shell hugging the eyeball (positions relative to the eye centre). `upper` lids close by rotating about x. */
function lidGeometry(upper, side, R, seg, P) {
  const NT = Math.max(6, seg[0] - 3);
  const NK = 3;
  const hIn = -1.28;
  const hOut = 1.42;
  const vOpen = upper ? 0.74 + 0.05 * P.eyeSize : -0.52;
  const vTop = upper ? 1.5 : -1.35;
  const pos = [];
  const edge = [];
  const idx = [];
  for (let k = 0; k <= NK; k++) {
    const kk = k / NK;
    for (let i = 0; i <= NT; i++) {
      const t = i / NT;
      const sin = Math.max(0, Math.sin(Math.PI * t));
      const tilt = P.eyeTilt * (t - 0.5) * 0.35;
      const vEdge = (upper ? vOpen * sin ** 0.85 * (1 + 0.14 * (0.42 - t)) : vOpen * sin ** 1.1) + tilt;
      const v = lerp(vEdge, vTop, kk ** 0.8);
      const h = lerp(hIn, hOut, t) * (1 + 0.18 * kk);
      const rad = R * lerp(upper ? 1.075 : 1.07, 0.99, kk ** 1.4) + (k === 0 ? 0.0004 : 0);
      const cv = Math.cos(v);
      pos.push(side * Math.sin(h) * cv * rad, Math.sin(v) * rad, Math.cos(h) * cv * rad);
      edge.push(k === 0 ? (upper ? 2 : 1) : k === 1 ? 0.25 : 0);
    }
  }
  const W = NT + 1;
  for (let k = 0; k < NK; k++) {
    for (let i = 0; i < NT; i++) {
      const a = k * W + i;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      // seen from the front (+z), x to the right for side=+1; flip for the mirrored eye
      if ((side > 0) === upper) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('aEdge', new Float32BufferAttribute(edge, 1));
  return g;
}

function lashGeometry(upper, side, R, P, count) {
  const pos = [];
  const idx = [];
  const vOpen = upper ? 0.74 + 0.05 * P.eyeSize : -0.52;
  const n = count;
  for (let i = 0; i < n; i++) {
    const t = lerp(0.08, 0.97, n === 1 ? 0.5 : i / (n - 1));
    const sin = Math.sin(Math.PI * t);
    const tilt = P.eyeTilt * (t - 0.5) * 0.35;
    const v = (upper ? vOpen * sin ** 0.85 * (1 + 0.14 * (0.42 - t)) : vOpen * sin ** 1.1) + tilt;
    const h = lerp(-1.28, 1.42, t);
    const cv = Math.cos(v);
    const r0 = R * 1.075 + 0.0004;
    const dirx = side * Math.sin(h) * cv;
    const diry = Math.sin(v);
    const dirz = Math.cos(h) * cv;
    const len = (upper ? 0.0048 : 0.0024) * (0.5 + 0.9 * sin) * (P.gender === 'f' ? 1.3 : 1);
    const curl = upper ? 0.0016 : -0.0003;
    const w = 0.00042;
    const base = pos.length / 3;
    // root points on the lid edge, the tip pushed outwards along the sphere normal and forwards
    const tx = dirx * (r0 + len * 0.55) + side * 0.0;
    const ty = diry * (r0 + len * 0.55) + (upper ? len * 0.55 : -len * 0.45);
    const tz = dirz * (r0 + len * 0.55) + curl + len * 0.35;
    const tang = [Math.cos(h) * side, 0, -Math.sin(h)];
    pos.push(dirx * r0 - tang[0] * w, diry * r0, dirz * r0 - tang[2] * w, dirx * r0 + tang[0] * w, diry * r0, dirz * r0 + tang[2] * w, tx, ty, tz);
    idx.push(base, base + 1, base + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('aEdge', new Float32BufferAttribute(new Float32Array(pos.length / 3).fill(1), 1));
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// Brows and moustache: ribbons hugging the face, with strand-like clumps on top.
function ribbon(cols, rows, fn) {
  // fn(t, k) -> [x, y, z, edge]; returns {pos, edge, idx}
  const pos = [];
  const edge = [];
  const idx = [];
  for (let k = 0; k <= rows; k++) {
    for (let i = 0; i <= cols; i++) {
      const [x, y, z, e] = fn(i / cols, k / rows);
      pos.push(x, y, z);
      edge.push(e);
    }
  }
  const W = cols + 1;
  for (let k = 0; k < rows; k++) {
    for (let i = 0; i < cols; i++) {
      const a = k * W + i;
      idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
  }
  return { pos, edge, idx };
}
function mergeParts(parts) {
  const pos = [];
  const edge = [];
  const idx = [];
  for (const p of parts) {
    const off = pos.length / 3;
    pos.push(...p.pos);
    edge.push(...p.edge);
    for (const i of p.idx) idx.push(i + off);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('aEdge', new Float32BufferAttribute(edge, 1));
  return g;
}

function browGeometry(shape, side, P, tier, seedR) {
  const sp = P.eyeSpace;
  const N = tier.hairCards >= 1 ? 12 : 7;
  const bY = (ax) => 0.0215 + 0.0032 * smooth(0, 0.05, ax) * (0.6 + P.browArch) + P.browTilt * 0.0016 * smooth(0, 0.06, ax);
  const thick = 0.0118 * P.browThick;
  const ax0 = 0.007;
  const ax1 = 0.064 * sp;
  const pt = (t, v, dz = 0.0013) => {
    const ax = lerp(ax0, ax1, t);
    const th = thick * (1 - 0.72 * t ** 2.4) * (0.9 + 0.2 * Math.sin(t * 5));
    const yc = bY(ax) + 0.0009 + (t < 0.25 ? (0.25 - t) * 0.012 * v : 0);
    const y = yc + (v - 0.5) * th * 1.15;
    const edgeW = v === 0.5 ? 1 : 0.62;
    const endFade = Math.min(1, 0.4 + t * 6, 0.35 + (1 - t) * 3);
    const yS = y;
    const x = side * ax;
    return [x, shape.vwarp(yS), shape.surfaceZ(x, yS) + dz + 0.0014 * th * 100 * 0.1, edgeW * endFade];
  };
  const rb = ribbon(N, 2, (t, k) => pt(t, k / 2));
  const parts = [rb];
  // strand clumps flaring up and outwards from the ribbon
  const ns = tier.hairCards >= 1 ? 16 : tier.hairCards > 0.5 ? 9 : 0;
  for (let i = 0; i < ns; i++) {
    const t = (i + seedR()) / ns;
    const a = pt(t, 0.3 + 0.4 * seedR(), 0.0017);
    const dirx = side * (0.5 + 0.5 * t);
    const diry = lerp(0.8, -0.05, t) * (0.7 + 0.3 * seedR());
    const L = 0.0072 + 0.004 * seedR();
    const w = 0.0007;
    const p0 = [a[0], a[1], a[2]];
    parts.push({
      pos: [p0[0] - w, p0[1], p0[2], p0[0] + w, p0[1], p0[2], p0[0] + dirx * L * 0.9, p0[1] + diry * L, p0[2] + 0.0018],
      edge: [0.9, 0.9, 0.5],
      idx: [0, 1, 2],
    });
  }
  return mergeParts(parts);
}

function mustacheGeometry(shape, P, style, seedR) {
  const lw = P.lipW;
  const z0 = (x, y) => shape.surfaceZ(x, y);
  const N = 16;
  const thick = style === 'thin' ? 0.0048 : style === 'handlebar' ? 0.011 : 0.0125;
  const reach = (style === 'handlebar' ? 0.052 : style === 'thin' ? 0.027 : 0.034) * lw;
  const topY = -0.0518;
  const fn = (t, v) => {
    const u = t * 2 - 1; // -1 .. 1 across
    const ax = Math.abs(u) * reach;
    const x = u * reach;
    const droop = style === 'handlebar' ? (ax > 0.03 ? -(ax - 0.03) * 1.1 : 0) + (ax > 0.045 ? (ax - 0.045) * 4.5 : 0) : -0.0018 * (ax / reach) ** 2 * 0 - 0.006 * smooth(0.012, reach, ax) * (style === 'thick' ? 1 : 0.2);
    const h = thick * (0.55 + 0.6 * Math.exp(-((ax / (reach * 0.55)) ** 2))) * (style === 'thin' ? 1 : 1.0);
    const y = topY - 0.0045 * (ax / reach) ** 2 * 0.0 + droop * 0.55 - v * h - 0.0015 * smooth(0.0, 0.01, ax) * 0.0;
    const e = (v === 0 ? 0.3 : v === 1 ? 0.4 : 1) * Math.min(1, 0.4 + (1 - Math.abs(u)) * 3);
    return [x, shape.vwarp(y), z0(x, Math.max(-0.0735, y)) + 0.0026 + 0.0016 * (1 - Math.abs(u)), e];
  };
  const rb = ribbon(N, 3, fn);
  return mergeParts([rb]);
}

function beardGeometry(shape, P, style, tier) {
  const U = 40;
  const NJ = 14;
  const y0 = -0.042;
  const y1 = -0.126;
  const pos = [];
  const edge = [];
  const idx = [];
  const tmp = { x: 0, y: 0, z: 0 };
  const lw = P.lipW;
  const mask = (ax, y) => {
    if (style === 'trim') {
      const m = smooth(-0.064, -0.082, y) * smooth(0.04, 0.028, ax);
      return m * (1 - smooth(0.0, 1.0, 0) * 0) * (1 - Math.exp(-((ax / (0.03 * lw)) ** 2)) * smooth(-0.0585, -0.0605, y) * smooth(-0.0875, -0.0855, y));
    }
    const jaw = smooth(-0.04, -0.062, y) * smooth(0.071, 0.058, ax) * (0.35 + 0.65 * smooth(-0.05, -0.09, y) + 0.5 * smooth(0.04, 0.066, ax) * smooth(-0.05, -0.04, y));
    const lips = Math.exp(-((ax / (0.0285 * lw)) ** 4)) * smooth(-0.0585, -0.0615, y) * smooth(-0.0885, -0.0855, y);
    return Math.max(0, Math.min(1, jaw * (1 - lips)));
  };
  const th = (k) => Math.PI * (-1 + (2 * k) / 48) * 1; // linear in angle: sides are included
  for (let j = 0; j <= NJ; j++) {
    const y = lerp(y0, y1, j / NJ);
    for (let i = 0; i <= U; i++) {
      const theta = lerp(-1.5, 1.5, i / U);
      shape.point(theta, y, tmp);
      const m = mask(Math.abs(tmp.x), y);
      const base = shape.base(theta, y);
      const nx = base.sx;
      const nz = base.sz;
      const off = 0.0016 + 0.0014 * m;
      pos.push(tmp.x + nx * off, tmp.y, tmp.z + nz * off);
      edge.push(m);
    }
  }
  const W = U + 1;
  const keep = new Set();
  for (let j = 0; j < NJ; j++) {
    for (let i = 0; i < U; i++) {
      const a = j * W + i;
      if (edge[a] + edge[a + 1] + edge[a + W] + edge[a + W + 1] < 0.12) continue;
      idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
      keep.add(a);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('aEdge', new Float32BufferAttribute(edge, 1));
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
function toothRow(shape, upper, P, ym) {
  // 6 front teeth on an arc; local head space coordinates
  const pieces = [];
  const n = 6;
  const R = 0.0222;
  const zc = 0.0505;
  const arc = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];
  for (let i = 0; i < n; i++) {
    const a = arc[i] * 0.2;
    const x = Math.sin(a) * R;
    const z = zc + Math.cos(a) * R * 0.9;
    const w = (Math.abs(arc[i]) < 1 ? 0.0072 : Math.abs(arc[i]) < 2 ? 0.0058 : 0.0052) * (P.child > 0.5 ? 0.85 : 1);
    const h = upper ? (Math.abs(arc[i]) < 1 ? 0.0092 : 0.0082) : 0.0072;
    const g = new BoxGeometry(w, h, 0.0042, 1, 2, 1);
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const y = p.getY(v);
      const gum = upper ? y > 0 : y < 0;
      const col = gum ? 0.92 : 1;
      void col;
    }
    g.rotateY(a);
    g.translate(x, upper ? ym - h / 2 + 0.0015 : ym + h / 2 - 0.0015, z);
    pieces.push(g);
  }
  return pieces;
}

function mergeSimple(geos) {
  let n = 0;
  let ni = 0;
  for (const g of geos) {
    n += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const idx = [];
  let o = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    const nn = g.attributes.normal;
    pos.set(p.array, o * 3);
    nor.set(nn.array, o * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + o);
    else for (let i = 0; i < p.count; i++) idx.push(i + o);
    o += p.count;
    g.dispose();
  }
  const m = new BufferGeometry();
  m.setAttribute('position', new Float32BufferAttribute(pos, 3));
  m.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  m.setIndex(idx);
  m.setAttribute('aEdge', new Float32BufferAttribute(new Float32Array(n).fill(1), 1));
  void ni;
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
const _v = new Vector3();
const _w = new Vector3();

/**
 * buildHead({ kind, seed, params, quality }) -> head rig. `params` may be a ready makeFaceParams() result.
 * Head space origin = eye line, +z forward, +x the character's left.
 */
export function buildHead(opts = {}) {
  const tier = tierOf(opts.quality);
  const P = opts.params || makeFaceParams(opts.kind || 'office', opts.seed ?? 0, opts.face || {});
  const seedN = hashSeed(`head:${P.kind}:${P.seed}`);
  const seedR = rng(`headparts:${P.kind}:${P.seed}`);
  const shape = makeShape(P);
  const fields = makeFields(shape);
  const group = new Group();
  group.name = 'head';
  const owned = { geos: [], mats: [] };

  // --- skin
  const skinMat = createSkinMaterial({ tone: P.tone, age: P.wrinkles, stubble: P.stubble, hairColor: P.hairColor, quality: tier.id, bindi: false });
  const skinU = skinMat.userData.skin;
  const { geometry: skinGeo, kA, kB, rows } = buildSkinGeometry(shape, tier);
  const auList = MORPH_SETS[tier.morphs] || MORPH_SETS.all;
  const morphAU = addMorphs(skinGeo, fields, auList);
  const skinMesh = new Mesh(skinGeo, skinMat);
  skinMesh.name = 'face-skin';
  skinMesh.frustumCulled = false;
  group.add(skinMesh);
  // mouth uniforms from the real lip rows
  const ym = shape.vwarp(MOUTH_Y);
  const cornerX = Math.abs(skinGeo.attributes.position.getX(1 + rows.indexOf('M0') * tier.headCols + kB));
  skinU.uMouth.value.set(ym, cornerX * 1.02, shape.vwarp(-0.0625), shape.vwarp(-0.0858));
  skinU.uBindi.value = P.bindi ? 1 : 0;
  skinU.uBindiMode = skinU.uBindiMode || { value: 0 };

  const morphMeshes = [{ mesh: skinMesh, au: morphAU }];
  const attach = (geo, mat, name, withMorph = true) => {
    if (withMorph) {
      const names = addMorphs(geo, fields, auList);
      const m = new Mesh(geo, mat);
      m.name = name;
      morphMeshes.push({ mesh: m, au: names });
      group.add(m);
      return m;
    }
    const m = new Mesh(geo, mat);
    m.name = name;
    group.add(m);
    return m;
  };

  // --- ears (skin material shared, head space)
  if (tier.ears) {
    for (const s of [1, -1]) {
      const g = earGeometry(s, P.earSize * (1 - P.child * 0.1), new Vector3(s * (shape.Wf(-0.012) * 0.97), shape.vwarp(-0.014), -0.0105));
      const m = new Mesh(g, cloneSkinMaterial(skinMat));
      m.name = s > 0 ? 'ear-L' : 'ear-R';
      group.add(m);
    }
  }

  // --- eyes: pivot at the eyeball centre; the eyeball rotates for gaze, the lids rotate about x only
  const eyeR = EYE_R * P.eyeSize;
  const ex = EYE_X * P.eyeSpace;
  const eyes = [];
  const eyeMat = createEyeMaterial({ iris: P.iris, sclera: P.sclera });
  const lashMat = new MeshStandardMaterial({ color: '#0d0907', roughness: 0.6, side: DoubleSide });
  for (const s of [1, -1]) {
    const ez = shape.surfaceZ(s * ex, 0, false) - 0.0105 * P.eyeSize;
    const center = new Vector3(s * ex, 0, ez);
    const pivot = new Group();
    pivot.position.copy(center);
    pivot.name = s > 0 ? 'eye-L' : 'eye-R';
    group.add(pivot);
    const ball = new Mesh(eyeballGeometry(eyeR, tier.eyeSeg), eyeMat);
    pivot.add(ball);
    // the lids do not follow the gaze rotation: they hang off a sibling group at the same centre
    const lidU = new Group();
    const lidL = new Group();
    const lidRoot = new Group();
    lidRoot.position.copy(center);
    group.add(lidRoot);
    lidRoot.add(lidU, lidL);
    const matU = cloneSkinMaterial(skinMat, center);
    const matL = cloneSkinMaterial(skinMat, center);
    const upper = new Mesh(lidGeometry(true, s, eyeR, tier.eyeSeg, P), matU);
    const lower = new Mesh(lidGeometry(false, s, eyeR, tier.eyeSeg, P), matL);
    lidU.add(upper);
    lidL.add(lower);
    if (tier.lashes) {
      const lashesU = new Mesh(lashGeometry(true, s, eyeR, P, tier.hairCards >= 1 ? 9 : 6), lashMat);
      lidU.add(lashesU);
      const lashesL = new Mesh(lashGeometry(false, s, eyeR, P, 7), lashMat);
      lidL.add(lashesL);
    }
    eyes.push({ side: s, center, pivot, ball, lidU, lidL, yaw: 0, pitch: 0 });
  }

  // --- brows
  const browMat = createHairMaterial({ color: P.hairColor, grey: P.grey * 0.9, shine: 0.1, doubleSide: true });
  for (const s of [1, -1]) {
    const m = attach(browGeometry(shape, s, P, tier, seedR), browMat, s > 0 ? 'brow-L' : 'brow-R');
    m.frustumCulled = false;
  }

  // --- mouth interior, teeth, tongue
  const mouthCenterZ = shape.surfaceZ(0, MOUTH_Y, false) - 0.034;
  const cavityMat = new MeshBasicMaterial({ color: '#2a0b0c', side: BackSide });
  const cav = new Mesh(new SphereGeometry(1, 9, 6), cavityMat);
  cav.scale.set(0.044, 0.036, 0.052);
  cav.position.set(0, ym - 0.014, 0.036);
  group.add(cav);
  let lowerJaw = null;
  let tongue = null;
  let teethGroup = null;
  if (tier.teeth) {
    const toothMat = new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.35, metalness: 0 });
    const up = mergeSimple(toothRow(shape, true, P, ym + 0.0006));
    const upM = new Mesh(up, toothMat);
    teethGroup = upM;
    group.add(upM);
    lowerJaw = new Group();
    lowerJaw.position.set(0, shape.vwarp(-0.032), -0.045);
    group.add(lowerJaw);
    const lo = mergeSimple(toothRow(shape, false, P, ym - 0.0006));
    lo.translate(0, -lowerJaw.position.y, -lowerJaw.position.z);
    lowerJaw.add(new Mesh(lo, toothMat));
    const tg = new SphereGeometry(1, 10, 6);
    tg.scale(0.0125, 0.0048, 0.019);
    tg.translate(0, -lowerJaw.position.y + ym - 0.0075, -lowerJaw.position.z + 0.0415);
    tongue = new Mesh(tg, new MeshStandardMaterial({ color: '#c0605a', roughness: 0.45 }));
    lowerJaw.add(tongue);
  }

  // --- facial hair
  const hairMat = createHairMaterial({ color: P.hairColor, grey: P.grey, shine: 0.15, doubleSide: true });
  if (P.mustache) attach(mustacheGeometry(shape, P, P.mustache, seedR), hairMat, 'moustache').frustumCulled = false;
  if (P.beard) attach(beardGeometry(shape, P, P.beard, tier), hairMat, 'beard').frustumCulled = false;

  // --- jewellery and glasses
  const gold = new MeshStandardMaterial({ color: '#d9a93a', roughness: 0.28, metalness: 0.9 });
  if (P.earrings) {
    for (const s of [1, -1]) {
      const g = new SphereGeometry(0.0024, 7, 5);
      g.translate(s * (shape.Wf(-0.012) * 0.97 + 0.0085), shape.vwarp(-0.0455), -0.0075);
      group.add(new Mesh(g, gold));
      if (P.gender === 'f') {
        const d = new CylinderGeometry(0.0022, 0.0048, 0.011, 7, 1, true);
        d.translate(s * (shape.Wf(-0.012) * 0.97 + 0.0085), shape.vwarp(-0.0545), -0.0075);
        group.add(new Mesh(d, gold));
      }
    }
  }
  if (P.noseStud) {
    const g = new SphereGeometry(0.0022, 6, 4);
    const sx = 0.0172;
    const sy = -0.0455;
    g.translate(sx, shape.vwarp(sy), shape.surfaceZ(sx, sy) + 0.0012);
    group.add(attachNoMorph(g, gold, 'nose-stud'));
  }
  function attachNoMorph(g, m, n) {
    const mesh = new Mesh(g, m);
    mesh.name = n;
    return mesh;
  }
  if (P.glasses) group.add(buildGlasses(shape, P, ex, eyeR));

  // --- eye look and lid state
  const expr = new ExpressionState(seedN);
  const lookWorld = new Vector3();
  let hasLook = false;
  const infl = { ready: true };
  const rig = {
    group,
    params: P,
    shape,
    tier,
    skin: skinMat,
    expr,
    eyes,
    skinMesh,
    morphAU,
    headPivot: new Vector3(0, -0.098, -0.022), // where the neck turns the head (head space)
    neckBase: new Vector3(0, -0.132, -0.036),
    setExpression: (n, w, ms) => expr.setExpression(n, w, ms),
    setSpeaking: (ms, i) => expr.setSpeaking(ms, i),
    lookAt(v) {
      if (v && Number.isFinite(v.x + v.y + v.z)) {
        lookWorld.copy(v);
        hasLook = true;
      } else hasLook = false;
    },
    /** Gaze yaw/pitch (rad) of the eyes in head space, for the owner to turn the head towards the same target. */
    gaze: { yaw: 0, pitch: 0 },
    update(dt, t) {
      expr.update(dt, t);
      const au = expr.au;
      for (const mm of morphMeshes) {
        const inf = mm.mesh.morphTargetInfluences;
        if (!inf) continue;
        for (let i = 0; i < mm.au.length; i++) inf[i] = au[mm.au[i]];
      }
      // jaw of the lower teeth and tongue follow the same hinge as the jaw morph
      if (lowerJaw) lowerJaw.rotation.x = 0.42 * au[AU.jawOpen];
      const showTeeth = au[AU.jawOpen] > 0.05 || au[AU.upperLipUp] > 0.12 || au[AU.stretch] > 0.3;
      if (teethGroup) teethGroup.visible = showTeeth;
      if (lowerJaw) lowerJaw.visible = showTeeth || au[AU.jawOpen] > 0.01;
      // wrinkles and colour
      const browUp = Math.max(au[AU.browUpL], au[AU.browUpR]) + au[AU.browInnerUp] * 0.5;
      const frown = Math.max(au[AU.browDownL], au[AU.browDownR]) + au[AU.noseWrinkle] * 0.3;
      const smile = Math.max(au[AU.smileL], au[AU.smileR]);
      skinU.uWr.value.set(Math.min(1, browUp), Math.min(1, frown), smile, expr.lidSquint);
      skinU.uFlush.value = expr.flush;
      skinU.uSweat.value = expr.sweat + (P.sweat || 0);
      // gaze
      const tt = t || 0;
      let gy = expr.gazeX + Math.sin(tt * 0.7 + seedN) * 0.015 + Math.sin(tt * 2.3 + seedN * 0.3) * 0.006;
      let gp = expr.gazeY + Math.sin(tt * 0.9 + seedN * 0.7) * 0.012;
      if (hasLook) {
        group.updateWorldMatrix(true, false);
        _v.copy(lookWorld);
        group.worldToLocal(_v);
        for (const e of eyes) {
          _w.copy(_v).sub(e.center);
          const yaw = Math.atan2(_w.x, Math.max(0.02, _w.z));
          const pitch = Math.atan2(_w.y, Math.hypot(_w.x, Math.max(0.02, _w.z)));
          e.yaw = Math.max(-0.62, Math.min(0.62, yaw)) + gy * 0.0;
          e.pitch = Math.max(-0.45, Math.min(0.45, pitch));
        }
        rig.gaze.yaw = Math.atan2(_v.x, Math.max(0.05, _v.z));
        rig.gaze.pitch = Math.atan2(_v.y, Math.hypot(_v.x, Math.max(0.05, _v.z)));
        gy *= 0.4;
        gp *= 0.4;
      } else {
        rig.gaze.yaw = 0;
        rig.gaze.pitch = 0;
        for (const e of eyes) {
          e.yaw = 0;
          e.pitch = 0;
        }
      }
      const open = expr.lidOpen * (1 - expr.blink) * (1 - P.lidHeavy * 0.5);
      for (const e of eyes) {
        e.pivot.rotation.set(-(e.pitch + gp), e.yaw + gy, 0, 'YXZ');
        const pitchLid = (e.pitch + gp) * 0.55; // looking down lowers the upper lid, looking up lifts it
        e.lidU.rotation.x = Math.max(-0.25, (1 - open) * 0.89 - pitchLid);
        const raise = expr.lidSquint * 0.3 + smile * 0.05;
        e.lidL.rotation.x = -(raise + expr.blink * 0.18) - pitchLid * 0.3;
      }
    },
    triangles: 0,
    dispose() {
      disposeObject(group);
    },
  };
  void kA;
  void infl;
  void owned;
  rig.update(0.016, 0);
  rig.triangles = 0;
  return rig;
}

function buildGlasses(shape, P, ex, eyeR) {
  const g = new Group();
  g.name = 'glasses';
  const style = P.glasses;
  const frame = new MeshStandardMaterial({ color: style === 'wire' ? '#b8a46a' : style === 'cat' ? '#7a1f3a' : '#16130f', roughness: 0.35, metalness: style === 'wire' ? 0.8 : 0.1 });
  const lens = new MeshStandardMaterial({ color: '#cfe6ee', roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.16, depthWrite: false });
  const z = Math.max(shape.surfaceZ(ex, 0), shape.surfaceZ(0, 0.006)) + 0.0035;
  const rad = style === 'round' ? 0.0225 : 0.0215;
  const thick = style === 'wire' ? 0.0007 : 0.0016;
  for (const s of [1, -1]) {
    const geo = new TorusGeometry(rad, thick, 3, 12);
    if (style !== 'round') geo.scale(1.12, style === 'cat' ? 0.78 : 0.86, 1);
    geo.translate(s * ex, 0.001, z);
    g.add(new Mesh(geo, frame));
    const lg = new SphereGeometry(rad * 1.05, 10, 2, 0, TAU, 0, 0.5);
    lg.rotateX(Math.PI / 2);
    lg.scale(1.1, style === 'round' ? 1 : 0.84, 0.15);
    lg.translate(s * ex, 0.001, z - 0.0003);
    g.add(new Mesh(lg, lens));
    const arm = new CylinderGeometry(thick, thick, 0.1, 4);
    arm.rotateX(Math.PI / 2);
    arm.translate(s * (shape.Wf(0) * 0.99 + 0.0006), 0.006, z - 0.05 + 0.0);
    g.add(new Mesh(arm, frame));
  }
  const bridge = new CylinderGeometry(thick, thick, 2 * (ex - rad * 1.12) + 0.004, 4);
  bridge.rotateZ(Math.PI / 2);
  bridge.translate(0, 0.008, z + 0.001);
  g.add(new Mesh(bridge, frame));
  return g;
}

export { makeFaceParams };
