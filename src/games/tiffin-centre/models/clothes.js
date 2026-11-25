// Clothing for people: layered meshes fitted to the body (torso loft, sleeves and trouser legs on the limb paths, pelvis garments,
// skirts, saree and dupatta strips, footwear) plus carried props (backpack, lanyard, tiffin carrier, laptop bag, gamchha, apron, stick).
// Garments are real geometry with cloth-like folds; weave and pattern come from fabric.js (canvas maps, shared).
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Color,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { fabricMat } from './fabric.js';
import { ringLoft } from './bodies.js';
import { REF } from './bodies.js';
import { sharedMat } from './util.js';

const PI = Math.PI;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const FRONT = PI / 2; // phi of the front (+z) on a y-axis ring

const plain = (color, rough = 0.8, metal = 0, extra = {}) => sharedMat(`cl:${color}:${rough}:${metal}:${JSON.stringify(extra)}`, () => new MeshStandardMaterial({ color, roughness: rough, metalness: metal, side: 2, ...extra }));

function addMesh(parent, geo, mat, name) {
  const m = new Mesh(geo, mat);
  m.name = name;
  m.frustumCulled = false;
  parent.add(m);
  return m;
}

/** A grid following the front (or back) of the torso: x in [-w/2, w/2] at each y, z from the body ring + `off`. */
function bodyPanel(body, { y0, y1, w, off = 0.012, cols = 4, rows = 8, back = false, wob = 0 }) {
  const pos = [];
  const idx = [];
  const uv = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const y = lerp(y1, y0, t);
    const r = body.ringAt(y);
    const ww = typeof w === 'function' ? w(t) : w;
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols - 0.5) * ww;
      const e = clamp(x / (r.rx + off), -0.98, 0.98);
      const z = r.cz + (back ? -1 : 1) * (r.rz + off) * Math.sqrt(1 - e * e) + (back ? -1 : 1) * wob * Math.sin(t * 9 + i);
      pos.push(x, y, z);
      uv.push(i / cols, t);
    }
  }
  const W = cols + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * W + i;
      if (back) idx.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
      else idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A ribbon along a polyline with a width vector per point. pts: [[x,y,z],...], wv: [[dx,dy,dz],...] half width vectors. */
function strip(pts, wv, uvRep = 2) {
  const pos = [];
  const uv = [];
  const idx = [];
  pts.forEach((p, i) => {
    const w = wv[Math.min(i, wv.length - 1)];
    pos.push(p[0] - w[0], p[1] - w[1], p[2] - w[2], p[0] + w[0], p[1] + w[1], p[2] + w[2]);
    uv.push(0, (i / (pts.length - 1)) * uvRep, 1, (i / (pts.length - 1)) * uvRep);
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function boxAt(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new BoxGeometry(w, h, d);
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(x, y, z);
  g.setAttribute('aEdge', new Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  return g;
}

/** Torso garment: rings from `hem` (world y) to `top` (world y); `ease` ballooning, `flare` widens below the hips. */
function torsoGarment(body, o, q) {
  const D = body.dims;
  const S = D.S;
  const toRel = (yw) => yw * S - (D.hipY + D.waistRel);
  const n = o.rings || 11;
  const rings = [];
  const lowest = body.ringAt(-0.5);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const yw = lerp(o.hem, o.top, t); // world y at reference scale (1.7 m)
    const yr = toRel(yw);
    const r = body.ringAt(yr);
    const below = Math.max(0, -(yr - (-0.21 * S))); // beyond the lowest body ring
    const fl = o.flare ? 1 + o.flare * sm(0, 0.5 * S, below) : 1;
    const ease = (o.ease ?? 0.012) * S * (1 + 0.5 * sm(0.9, 1.25, yw) * 0);
    rings.push({ y: yr, rx: (r.rx * (below > 0 ? 1 : 1) + ease) * fl * (o.sleeveTop && t > 0.82 ? 1 : 1), rz: (below > 0 ? lowest.rz : r.rz) * fl + ease, cz: below > 0 ? lowest.cz : r.cz, cx: 0 });
  }
  const amp = (o.fold ?? 0.0032) * S * q.clothFolds;
  const geo = ringLoft(rings, {
    axis: 'y',
    sides: q.limbSides + 6,
    caps: [false, false],
    uv: [3, 3],
    fold: (t, phi) => amp * (Math.sin(phi * 7 + t * 8) * (0.6 + 0.4 * Math.sin(t * 5)) + 0.7 * Math.sin(phi * 3 - t * 12)) * (0.35 + 0.65 * (1 - t)) + (o.pinch ? -amp * 1.6 * Math.exp(-(((t - o.pinch) / 0.07) ** 2)) : 0),
  });
  return geo;
}

/** Sleeves: a second tube on each arm path. */
function sleeves(body, o) {
  const S = body.dims.S;
  const out = [];
  for (const A of body.arms) {
    const ease = (o.ease ?? 0.012) * S;
    A.limb.addLayer({
      s0: 0,
      s1: o.length,
      rings: Math.max(5, Math.round(o.length * 9)),
      sides: body.tier.limbSides,
      material: o.mat,
      name: 'sleeve',
      uv: [3, 3],
      caps: [true, false],
      rad: (s) => {
        const r = A.rad(s);
        const cap = 1 + 0.1 * (1 - sm(0, 0.16, s));
        const flare = o.flare ? o.flare * sm(o.length - 0.25, o.length, s) : 0;
        return [r[0] * cap + ease + flare * S, r[1] * cap + ease + flare * S];
      },
      fold: (s, phi) => (o.fold ?? 0.0022) * S * Math.sin(phi * 3 + s * 17) * (0.4 + 0.6 * Math.exp(-(((s - 0.54) / 0.14) ** 2))) * body.tier.clothFolds,
    });
    out.push(A);
  }
  return out;
}

/** Leg garments on the leg paths. mult(s) widens the skin radius; `s1` where it ends (1 = ankle). */
function legWear(body, o) {
  const S = body.dims.S;
  for (const L of body.legs) {
    const ease = (o.ease ?? 0.012) * S;
    L.limb.addLayer({
      s0: o.s0 ?? 0,
      s1: o.s1 ?? 1,
      rings: Math.max(5, Math.round((o.s1 ?? 1) * 10)),
      sides: body.tier.limbSides,
      material: o.mat,
      name: 'legwear',
      uv: [3, 4],
      rad: (s) => {
        const r = L.rad(s);
        const m = o.mult ? o.mult(s) : 1;
        // the top of the leg garment stays inside the pelvis garment: the extra width fades in down the thigh
        const k = 0.1 + 0.9 * sm(0, 0.3, s);
        return [r[0] + 0.004 * S + (r[0] * (m - 1) + ease) * k, r[1] + 0.004 * S + (r[1] * (m - 1) + ease) * k];
      },
      fold: (s, phi) => (o.fold ?? 0.0028) * S * Math.sin(phi * 4 + s * 21) * (0.3 + 0.7 * Math.exp(-(((s - 0.5) / 0.12) ** 2)) + 0.4 * sm(0.78, 1, s)) * body.tier.clothFolds,
    });
  }
}

/** Pelvis garment (hips space): the waist band and seat of trousers, shorts, pyjamas, salwar and the base of skirts. */
function pelvisWear(body, o, q) {
  const D = body.dims;
  const S = D.S;
  const rings = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const yHips = lerp(o.low ?? -0.14, o.high ?? 0.13, t) * S; // relative to the hip joints
    const yTorso = yHips - D.waistRel;
    const r = body.ringAt(yTorso);
    const ease = (o.ease ?? 0.008) * S;
    const tp = i === 0 ? 0.62 : i === 1 ? 0.88 : 1;
    rings.push({ y: yHips, rx: (r.rx + ease) * tp, rz: (r.rz + ease) * (0.7 + 0.3 * tp), cz: r.cz, cx: 0 });
  }
  return ringLoft(rings, {
    axis: 'y',
    sides: q.limbSides + 6,
    caps: [true, true],
    uv: [3, 1],
    fold: (t, phi) => 0.0014 * S * Math.sin(phi * 9 + t * 6) * q.clothFolds,
  });
}

/** Skirt-like wrap (lungi, saree lower, salwar overskirt) hanging from the waist to `hemY` (world, reference scale). */
function skirtWrap(body, o, q) {
  const D = body.dims;
  const S = D.S;
  const rings = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const yw = lerp(o.top, o.hem, t);
    const yHips = (yw - REF.hipY) * S;
    const yTorso = yHips - D.waistRel;
    const r = body.ringAt(Math.max(yTorso, -0.2 * S));
    const w = lerp(1, o.flare ?? 1.12, t ** 1.2);
    const rx = (r.rx + 0.02 * S) * w + (o.gather ? 0.0 : 0);
    const rz = (r.rz + 0.025 * S) * (0.95 + 0.25 * t) * (o.narrow ? 0.9 : 1);
    rings.push({ y: yHips, rx: Math.max(rx, 0.1 * S), rz: Math.max(rz, 0.095 * S), cz: r.cz * (1 - t * 0.6), cx: 0 });
  }
  const amp = (o.fold ?? 0.006) * S * q.clothFolds;
  return ringLoft(rings, {
    axis: 'y',
    sides: q.limbSides + 8,
    caps: [true, false],
    uv: [3, 3],
    fold: (t, phi) => {
      const front = Math.exp(-(((phi - FRONT) / 0.9) ** 2));
      const pleats = o.pleats ? Math.sin(phi * 18) * 0.8 * front * (1 - t * 0.2) : 0;
      return amp * (Math.sin(phi * 6 + t * 5) + pleats + 0.5 * Math.sin(phi * 11 - t * 8)) * (0.3 + 0.7 * t);
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
function footwear(body, o) {
  const S = body.dims.S * (1 - body.dims.child * 0.12);
  const kind = o.kind || 'slipper';
  const col = o.color || '#3b2a20';
  const sole = plain(o.sole || '#1d1612', 0.9);
  const upper = kind === 'shoe' ? plain(col, 0.45, 0, {}) : plain(col, 0.7);
  for (const L of body.legs) {
    const foot = L.foot;
    if (kind === 'none') continue;
    const sl = ringLoft(
      [
        { z: -0.062 * S, cx: 0, cy: -0.0715 * S, rx: 0.036 * S, rz: 0.0055 * S },
        { z: 0.0 * S, cx: 0, cy: -0.0715 * S, rx: 0.042 * S, rz: 0.0055 * S },
        { z: 0.1 * S, cx: 0, cy: -0.0715 * S, rx: 0.047 * S, rz: 0.0055 * S },
        { z: 0.19 * S, cx: 0, cy: -0.0715 * S, rx: 0.037 * S, rz: 0.0055 * S },
        { z: 0.215 * S, cx: 0, cy: -0.0715 * S, rx: 0.016 * S, rz: 0.0055 * S },
      ],
      { axis: 'z', sides: 8, caps: [true, true] }
    );
    addMesh(foot, sl, sole, 'sole');
    if (kind === 'shoe') {
      const g = ringLoft(
        [
          { z: -0.064 * S, cx: 0, cy: -0.012 * S, rx: 0.038 * S, rz: 0.058 * S },
          { z: -0.02 * S, cx: 0, cy: -0.034 * S, rx: 0.043 * S, rz: 0.036 * S },
          { z: 0.06 * S, cx: 0, cy: -0.048 * S, rx: 0.049 * S, rz: 0.027 * S },
          { z: 0.15 * S, cx: 0, cy: -0.058 * S, rx: 0.045 * S, rz: 0.017 * S },
          { z: 0.2 * S, cx: 0, cy: -0.064 * S, rx: 0.028 * S, rz: 0.01 * S },
        ],
        { axis: 'z', sides: 9, caps: [true, true] }
      );
      addMesh(foot, g, upper, 'shoe');
    } else if (kind === 'slipper') {
      // a strap over the toes
      const t = new TorusGeometry(0.045 * S, 0.0075 * S, 4, 10, PI);
      t.rotateZ(0);
      t.scale(1, 0.55, 1);
      t.translate(0, -0.066 * S, 0.095 * S);
      addMesh(foot, t, upper, 'strap');
    } else if (kind === 'sandal') {
      for (const z of [0.05, 0.12]) {
        const t = new TorusGeometry(0.044 * S, 0.0045 * S, 4, 10, PI);
        t.scale(1, 0.5, 1);
        t.translate(0, -0.066 * S, z * S);
        addMesh(foot, t, upper, 'strap');
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
/**
 * dress(body, outfit) -> { dispose?, update(dt, t) }.
 * outfit: { top, bottom, shoes, extras: [] } (see customers.js for how the kinds fill it).
 */
export function dress(body, outfit = {}) {
  const q = body.tier;
  const S = body.dims.S;
  const D = body.dims;
  const female = D.female;
  const T = outfit.top || { kind: 'none' };
  const B = outfit.bottom || { kind: 'none' };
  const updaters = [];
  const adds = [];
  const fq = q.id;

  // ---- bottoms first (they sit under the top)
  const bmat = B.kind !== 'none' ? fabricMat({ color: B.color || '#2c3345', color2: B.color2, pattern: B.pattern || (B.kind === 'jeans' ? 'denim' : B.kind === 'lungi' ? 'check' : 'plain'), quality: fq }) : null;
  if (bmat) {
    if (B.kind === 'trousers' || B.kind === 'jeans') {
      legWear(body, { mat: bmat, mult: (s) => 1.04 + 0.08 * Math.sin(s * PI) * 0 + 0.1 * sm(0.75, 1, s) * (B.kind === 'jeans' ? 0 : 1), ease: B.kind === 'jeans' ? 0.006 : 0.011 });
      body.addToHips(new Mesh(pelvisWear(body, { ease: 0.007, high: 0.1 }, q), bmat)).name = 'pelvis-wear';
    } else if (B.kind === 'pyjama' || B.kind === 'salwar') {
      const wide = B.kind === 'salwar' ? 1.32 : 1.2;
      legWear(body, { mat: bmat, mult: (s) => 1.08 + (wide - 1.08) * sm(0.3, 0.75, s) * (1 - 0.5 * sm(0.85, 1, s)), ease: 0.012, fold: 0.0045 });
      body.addToHips(new Mesh(pelvisWear(body, { ease: 0.014, high: 0.12 }, q), bmat)).name = 'pelvis-wear';
    } else if (B.kind === 'shorts') {
      legWear(body, { mat: bmat, s1: 0.46, mult: () => 1.12, ease: 0.015 });
      body.addToHips(new Mesh(pelvisWear(body, { ease: 0.008, high: 0.1 }, q), bmat)).name = 'pelvis-wear';
    } else if (B.kind === 'lungi' || B.kind === 'dhoti') {
      body.addToHips(new Mesh(skirtWrap(body, { top: 1.04, hem: B.hem ?? 0.2, flare: 1.18, fold: 0.007 }, q), bmat)).name = 'lungi';
      // the rolled waist knot
      const kn = new Mesh(new TorusGeometry(0.075 * S, 0.02 * S, 5, 12), bmat);
      kn.rotation.x = PI / 2;
      kn.scale.set(1.45, 1.05, 1);
      kn.position.set(0, 0.125 * S, 0.06 * S);
      body.addToHips(kn);
    } else if (B.kind === 'saree') {
      body.addToHips(new Mesh(skirtWrap(body, { top: 1.04, hem: 0.1, flare: 1.08, pleats: true, fold: 0.006, narrow: true }, q), bmat)).name = 'saree-skirt';
    } else if (B.kind === 'skirt') {
      body.addToHips(new Mesh(skirtWrap(body, { top: 1.04, hem: B.hem ?? 0.5, flare: 1.4, fold: 0.007 }, q), bmat)).name = 'skirt';
    }
  }

  // ---- tops
  if (T.kind !== 'none') {
    const tmat = fabricMat({ color: T.color || '#e8eef5', color2: T.color2, pattern: T.pattern || 'plain', quality: fq });
    const kurta = T.kind === 'kurta' || T.kind === 'kurti';
    const tucked = T.kind === 'shirt' && !T.untucked;
    const hem = tucked ? 1.0 : { shirt: 0.86, tee: 0.87, kurta: 0.55, kurti: 0.62, blouse: 1.08, tank: 0.9 }[T.kind] ?? 0.88;
    const top = 1.405;
    const g = torsoGarment(body, { hem: T.hem ?? hem, top, ease: T.kind === 'tee' ? 0.017 : kurta ? 0.024 : tucked ? 0.012 : 0.021, flare: kurta ? 0.55 : tucked ? 0 : 0.05, fold: kurta ? 0.0045 : 0.0034 }, q);
    addMesh(body.torso, g, tmat, 'top');
    // neck opening: a collar ring
    const neckY = 1.43 * S - (D.hipY + D.waistRel);
    if (T.kind === 'shirt') {
      const col = new Mesh(ringLoft([{ y: neckY - 0.02 * S, rx: 0.062 * S, rz: 0.066 * S, cz: -0.012 * S }, { y: neckY + 0.012 * S, rx: 0.058 * S, rz: 0.062 * S, cz: -0.011 * S }], { axis: 'y', sides: 12, caps: [false, false] }), tmat);
      body.addToTorso(col);
      // placket and a chest pocket
      const placket = new Mesh(bodyPanel(body, { y0: 1.0 * S - (D.hipY + D.waistRel) + 0.0, y1: neckY - 0.01, w: 0.034 * S, off: 0.0235 * S, cols: 1, rows: 8 }), plain(`#${new Color(T.color || '#e8eef5').multiplyScalar(0.88).getHexString()}`, 0.8));
      body.addToTorso(placket);
      if (T.pocket) body.addToTorso(new Mesh(bodyPanel(body, { y0: 1.17 * S - (D.hipY + D.waistRel), y1: 1.23 * S - (D.hipY + D.waistRel), w: 0.07 * S, off: 0.0245 * S, cols: 2, rows: 2 }, q), tmat));
    } else if (kurta) {
      const col = new Mesh(ringLoft([{ y: neckY - 0.03 * S, rx: 0.066 * S, rz: 0.07 * S, cz: -0.012 * S }, { y: neckY + 0.008 * S, rx: 0.05 * S, rz: 0.055 * S, cz: -0.011 * S }], { axis: 'y', sides: 12, caps: [false, false] }), tmat);
      body.addToTorso(col);
      const plk = new Mesh(bodyPanel(body, { y0: 1.12 * S - (D.hipY + D.waistRel), y1: neckY - 0.01, w: 0.036 * S, off: 0.036 * S, cols: 1, rows: 5 }), plain('#f4f0e0', 0.8));
      body.addToTorso(plk);
    } else if (T.kind === 'tee') {
      body.addToTorso(new Mesh(ringLoft([{ y: neckY - 0.014 * S, rx: 0.066 * S, rz: 0.068 * S, cz: -0.012 * S }, { y: neckY + 0.006 * S, rx: 0.055 * S, rz: 0.058 * S, cz: -0.011 * S }], { axis: 'y', sides: 12, caps: [false, false] }), fabricMat({ color: T.color2 || T.color || '#fff', pattern: 'plain', quality: fq })));
    }
    // sleeves
    const sl = T.sleeve || 'short';
    if (sl !== 'none') {
      sleeves(body, { mat: tmat, length: sl === 'long' ? 0.9 : sl === 'half' ? 0.62 : sl === 'short' ? 0.36 : 0.3, ease: kurta ? 0.01 : T.kind === 'tee' ? 0.005 : 0.007, flare: sl === 'long' ? 0 : 0.006 });
      for (const A of body.arms) {
        // round shoulder: a deltoid cap in the garment cloth
        const cap = new Mesh(new SphereGeometry(0.05 * S * (female ? 0.9 : 1), 10, 7), tmat);
        cap.scale.set(1, 0.92, 1);
        cap.position.set(A.side * D.shoulderX * 0.97, D.shoulderRel - 0.006 * S, 0);
        body.addToTorso(cap);
        adds.push(cap);
      }
    }
  }

  // ---- footwear
  footwear(body, outfit.shoes || { kind: 'slipper' });

  // ---- extras
  const ex = outfit.extras || [];
  const chestY = (yw) => yw * S - (D.hipY + D.waistRel);
  const addTo = (parent, geo, mat, name) => {
    const m = addMesh(parent, geo, mat, name);
    adds.push(m);
    return m;
  };
  for (const e of ex) {
    const id = typeof e === 'string' ? e : e.id;
    const c = typeof e === 'string' ? null : e;
    if (id === 'tie') {
      const col = c?.color || '#c0392b';
      addTo(body.torso, bodyPanel(body, { y0: chestY(1.1), y1: chestY(1.385), w: (t) => 0.04 * S * (0.45 + 0.6 * t), off: 0.027 * S, cols: 2, rows: 6 }), plain(col, 0.5), 'tie');
      const kn = new Mesh(new SphereGeometry(0.02 * S, 6, 4), plain(col, 0.5));
      const r = body.ringAt(chestY(1.38));
      kn.scale.set(1, 0.8, 0.6);
      kn.position.set(0, chestY(1.385), r.cz + r.rz + 0.026 * S);
      body.addToTorso(kn);
      adds.push(kn);
    } else if (id === 'lanyard') {
      const col = c?.color || '#d0182c';
      for (const s of [1, -1]) {
        const r = body.ringAt(chestY(1.36));
        addTo(body.torso, strip([[s * 0.05 * S, chestY(1.4), r.cz + r.rz * 0.75], [s * 0.035 * S, chestY(1.3), r.cz + r.rz + 0.01 * S], [0, chestY(1.17), r.cz + r.rz + 0.02 * S]], [[0.006 * S, 0, 0]]), plain(col, 0.6), 'lanyard');
      }
      const card = boxAt(0.052 * S, 0.075 * S, 0.005 * S, 0, chestY(1.14), body.ringAt(chestY(1.14)).cz + body.ringAt(chestY(1.14)).rz + 0.028 * S);
      addTo(body.torso, card, plain('#f3f3f3', 0.4), 'id-card');
      addTo(body.torso, boxAt(0.052 * S, 0.016 * S, 0.0058 * S, 0, chestY(1.16), body.ringAt(chestY(1.14)).cz + body.ringAt(chestY(1.14)).rz + 0.0285 * S), plain('#12908e', 0.5), 'id-band');
    } else if (id === 'apron') {
      const col = c?.color || '#12908e';
      const am = fabricMat({ color: col, color2: '#ffffff', pattern: 'plain', quality: fq });
      addTo(body.torso, bodyPanel(body, { y0: chestY(0.62), y1: chestY(1.33), w: (t) => lerp(0.2, 0.34, 1 - Math.abs(t - 0.7)) * S, off: 0.022 * S, cols: 5, rows: 10, wob: 0.0012 }), am, 'apron');
      // neck strap and waist ties
      const r = body.ringAt(chestY(1.38));
      addTo(body.torso, strip([[-0.07 * S, chestY(1.33), r.cz + r.rz * 0.95], [-0.03 * S, chestY(1.42), r.cz - 0.002], [0.03 * S, chestY(1.42), r.cz - 0.002], [0.07 * S, chestY(1.33), r.cz + r.rz * 0.95]], [[0, 0.007 * S, 0]]), am, 'apron-strap');
      // stains: a few dark smears as flat patches
      for (const [x, y, w, h, col2] of [[-0.05, 1.08, 0.06, 0.04, '#6b3d12'], [0.06, 0.95, 0.05, 0.05, '#e4b33a'], [-0.02, 0.8, 0.07, 0.035, '#8d1f14'], [0.04, 1.2, 0.04, 0.03, '#6b3d12']]) {
        const rr = body.ringAt(chestY(y));
        addTo(body.torso, boxAt(w * S, h * S, 0.003 * S, x * S, chestY(y), rr.cz + rr.rz * Math.sqrt(Math.max(0.05, 1 - ((x * S) / (rr.rx + 0.02)) ** 2)) + 0.0245 * S), plain(col2, 0.9), 'stain');
      }
    } else if (id === 'gamchha') {
      const gm = fabricMat({ color: c?.color || '#c0392b', color2: c?.color2 || '#f3ede0', pattern: 'gamchha', quality: fq });
      const s = c?.side || 1;
      const r = body.ringAt(chestY(1.36));
      // over the shoulder: a front tail and a back tail
      addTo(body.torso, strip([[s * 0.12 * S, chestY(1.405), r.cz + 0.01], [s * 0.15 * S, chestY(1.36), r.cz + r.rz + 0.012 * S], [s * 0.15 * S, chestY(1.2), r.cz + r.rz + 0.026 * S], [s * 0.14 * S, chestY(1.04), r.cz + r.rz + 0.02 * S]], [[0.045 * S, 0, 0], [0.046 * S, 0, 0], [0.04 * S, 0, 0], [0.036 * S, 0, 0]]), gm, 'gamchha-front');
      addTo(body.torso, strip([[s * 0.12 * S, chestY(1.405), r.cz - 0.01], [s * 0.15 * S, chestY(1.36), r.cz - r.rz - 0.012 * S], [s * 0.15 * S, chestY(1.18), r.cz - r.rz - 0.026 * S], [s * 0.14 * S, chestY(1.0), r.cz - r.rz - 0.02 * S]], [[0.045 * S, 0, 0], [0.046 * S, 0, 0], [0.04 * S, 0, 0], [0.036 * S, 0, 0]]), gm, 'gamchha-back');
      const sh = new Mesh(new CylinderGeometry(0.03 * S, 0.034 * S, 0.27 * S, 6, 1, true), gm);
      sh.rotation.z = (s > 0 ? -1 : 1) * 1.2;
      sh.position.set(s * 0.11 * S, chestY(1.395), r.cz);
      body.addToTorso(sh);
      adds.push(sh);
    } else if (id === 'dupatta') {
      const dm = fabricMat({ color: c?.color || '#d6336c', color2: c?.color2 || '#f4c542', pattern: c?.pattern || 'sari', quality: fq });
      const r = body.ringAt(chestY(1.36));
      // across the chest, over the left shoulder and down the back
      addTo(body.torso, strip([[0.14 * S, chestY(1.4), r.cz + 0.005], [0.06 * S, chestY(1.34), r.cz + r.rz + 0.018 * S], [-0.06 * S, chestY(1.25), r.cz + r.rz + 0.02 * S], [-0.15 * S, chestY(1.1), r.cz + r.rz * 0.4]], [[0.022 * S, 0.02 * S, 0], [0.03 * S, 0.02 * S, 0], [0.034 * S, 0.02 * S, 0], [0.03 * S, 0.02 * S, 0]]), dm, 'dupatta-front');
      addTo(body.torso, strip([[0.14 * S, chestY(1.4), r.cz - 0.01], [0.17 * S, chestY(1.3), r.cz - r.rz - 0.015 * S], [0.15 * S, chestY(1.0), r.cz - r.rz - 0.03 * S], [0.14 * S, chestY(0.78), r.cz - r.rz - 0.03 * S]], [[0.06 * S, 0, 0], [0.075 * S, 0, 0.0], [0.09 * S, 0, 0], [0.085 * S, 0, 0]]), dm, 'dupatta-back');
      const nr = new Mesh(new TorusGeometry(0.066 * S, 0.012 * S, 4, 12), dm);
      nr.rotation.x = PI / 2;
      nr.scale.set(1, 1.05, 1);
      nr.position.set(0, chestY(1.41), r.cz - 0.003);
      body.addToTorso(nr);
      adds.push(nr);
    } else if (id === 'sariPallu') {
      const dm = fabricMat({ color: c?.color || '#7a4bb8', color2: c?.color2 || '#e6c25a', pattern: 'sari', quality: fq });
      const r = body.ringAt(chestY(1.34));
      addTo(body.torso, strip([[0.13 * S, chestY(1.41), r.cz + 0.0], [0.04 * S, chestY(1.32), r.cz + r.rz + 0.015 * S], [-0.07 * S, chestY(1.2), r.cz + r.rz + 0.022 * S], [-0.13 * S, chestY(1.04), r.cz + r.rz * 0.8]], [[0.03 * S, 0.02 * S, 0], [0.045 * S, 0.02 * S, 0], [0.05 * S, 0.02 * S, 0], [0.045 * S, 0.02 * S, 0]]), dm, 'pallu-front');
      addTo(body.torso, strip([[0.13 * S, chestY(1.41), r.cz - 0.01], [0.165 * S, chestY(1.3), r.cz - r.rz - 0.014 * S], [0.14 * S, chestY(1.05), r.cz - r.rz - 0.028 * S], [0.12 * S, chestY(0.7), r.cz - r.rz - 0.03 * S]], [[0.06 * S, 0, 0], [0.085 * S, 0, 0], [0.1 * S, 0, 0], [0.1 * S, 0, 0]]), dm, 'pallu-back');
    } else if (id === 'backpack') {
      const col = c?.color || '#ff8a1f';
      const bp = new Group();
      bp.name = 'backpack';
      const r = body.ringAt(chestY(1.22));
      const m1 = plain(col, 0.75);
      const m2 = plain('#222', 0.8);
      const z0 = r.cz - r.rz - 0.085 * S;
      bp.add(new Mesh(boxAt(0.3 * S, 0.4 * S, 0.14 * S, 0, chestY(1.18), z0), m1));
      bp.add(new Mesh(boxAt(0.24 * S, 0.16 * S, 0.05 * S, 0, chestY(1.1), z0 - 0.09 * S), m2));
      bp.add(new Mesh(boxAt(0.2 * S, 0.05 * S, 0.1 * S, 0, chestY(1.395), z0), m1));
      for (const s of [-1, 1]) {
        // shoulder straps seen from the front: two bands on the chest
        const g = bodyPanel(body, { y0: chestY(1.12), y1: chestY(1.37), w: 0.034 * S, off: 0.03 * S, cols: 1, rows: 4 });
        g.translate(s * 0.095 * S, 0, 0);
        bp.add(new Mesh(g, m2));
      }
      body.addToTorso(bp);
      adds.push(bp);
    } else if (id === 'laptopBag') {
      const bag = new Group();
      const r = body.ringAt(chestY(1.0));
      const m1 = plain('#2c2f36', 0.85);
      bag.add(new Mesh(boxAt(0.1 * S, 0.27 * S, 0.37 * S, 0, 0, 0), m1));
      bag.add(new Mesh(boxAt(0.104 * S, 0.07 * S, 0.3 * S, 0, 0.1 * S, 0), plain('#3a3f49', 0.85)));
      bag.position.set(0.26 * S, chestY(0.93), r.cz - 0.03 * S);
      body.addToTorso(bag);
      adds.push(bag);
      // cross strap
      const rr = body.ringAt(chestY(1.3));
      addTo(body.torso, strip([[-0.13 * S, chestY(1.4), rr.cz], [0.0, chestY(1.22), rr.cz + rr.rz + 0.016 * S], [0.19 * S, chestY(0.98), rr.cz + rr.rz * 0.3], [0.26 * S, chestY(0.93), rr.cz - 0.03 * S]], [[0.014 * S, 0, 0]]), m1, 'strap-front');
      addTo(body.torso, strip([[-0.13 * S, chestY(1.4), rr.cz - 0.005], [-0.04 * S, chestY(1.2), rr.cz - rr.rz - 0.014 * S], [0.12 * S, chestY(1.0), rr.cz - rr.rz - 0.01 * S], [0.25 * S, chestY(0.94), rr.cz - 0.03 * S]], [[0.014 * S, 0, 0]]), m1, 'strap-back');
    } else if (id === 'kada' || id === 'thread' || id === 'watch') {
      const arm = body.arms[c?.side === 'R' ? 1 : 0];
      const col = c?.color || (id === 'thread' ? '#c0201f' : '#c9d1d6');
      const m = plain(col, id === 'thread' ? 0.9 : 0.25, id === 'thread' ? 0 : 1);
      const t = new TorusGeometry(0.0285 * body.dims.handScale, id === 'thread' ? 0.0024 : 0.0042, 5, 14);
      t.rotateX(PI / 2);
      t.translate(0, 0.012 * body.dims.handScale, 0);
      arm.hand.group.add(new Mesh(t, m));
      if (id === 'watch') {
        const d = new Mesh(new CylinderGeometry(0.02, 0.02, 0.008, 12), plain('#1b1b1f', 0.3, 0.6));
        d.position.set(0, 0.012, -0.03 * body.dims.handScale);
        d.rotation.x = PI / 2;
        arm.hand.group.add(d);
      }
    } else if (id === 'belt') {
      const r = body.ringAt(chestY(1.0));
      void r;
    }
  }

  return {
    update(dt, t) {
      for (const u of updaters) u(dt, t);
    },
    dispose() {
      for (const m of adds) m.geometry?.dispose?.();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
/** A 3-tier steel tiffin carrier hanging from a handle bar at the origin; local -y is down. */
export function tiffinCarrier(scale = 1) {
  const g = new Group();
  g.name = 'tiffin';
  const steel = plain('#c9d1d6', 0.32, 0.95);
  const dark = plain('#8f9aa1', 0.4, 0.9);
  for (let i = 0; i < 3; i++) {
    const c = new CylinderGeometry(0.075 * scale, 0.075 * scale, 0.056 * scale, 14);
    c.translate(0, -0.15 * scale - i * 0.06 * scale, 0);
    g.add(new Mesh(c, i % 2 ? steel : plain('#d8dee2', 0.3, 0.95)));
  }
  const lid = new CylinderGeometry(0.06 * scale, 0.078 * scale, 0.016 * scale, 14);
  lid.translate(0, -0.115 * scale, 0);
  g.add(new Mesh(lid, dark));
  const bow = new TorusGeometry(0.072 * scale, 0.004 * scale, 4, 12, PI);
  bow.rotateZ(PI);
  bow.rotateY(PI / 2);
  bow.translate(0, -0.12 * scale, 0);
  g.add(new Mesh(bow, dark));
  const clip = new CylinderGeometry(0.004 * scale, 0.004 * scale, 0.2 * scale, 4);
  clip.translate(0.074 * scale, -0.22 * scale, 0);
  g.add(new Mesh(clip, dark));
  return g;
}

/** A walking stick: grip at the origin, tip planted `length` below. */
export function walkingStick(length = 0.88) {
  const g = new Group();
  g.name = 'stick';
  const wood = plain('#6b4a2b', 0.7);
  const shaft = new CylinderGeometry(0.013, 0.011, length, 6);
  shaft.translate(0, -length / 2 + 0.01, 0);
  g.add(new Mesh(shaft, wood));
  const crook = new TorusGeometry(0.04, 0.014, 5, 10, PI);
  crook.translate(0.04, 0.01, 0);
  g.add(new Mesh(crook, plain('#5a3d22', 0.65)));
  const tip = new CylinderGeometry(0.016, 0.016, 0.03, 6);
  tip.translate(0, -length + 0.025, 0);
  g.add(new Mesh(tip, plain('#222', 0.9)));
  return g;
}

export { plain as clothPlain, bodyPanel, strip };
void Vector3;
