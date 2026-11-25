// Hair and headwear: a scalp shell (ragged hairline via per-vertex mask), strand cards for length, braids, buns, topknots,
// and cloth on the head (skull cap, cap, headcloth/turban, dupatta, hijab). All shapes are fitted to the sculpted head (facegen.js).
// Everything lives in head space (origin on the eye line) and is a child of the head group.
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { CROWN, gauss, smooth } from './facegen.js';
import { createHairMaterial } from './skin.js';
import { fabricMat } from './fabric.js';
import { rng } from './util.js';
import { tierOf } from './charquality.js';

const PI = Math.PI;
const TAU_ = PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const HAIR_STYLES = ['none', 'crop', 'short', 'combed', 'receding', 'long', 'plait', 'bun', 'bunLow', 'topknot', 'bowl', 'pigtails'];
export const HEADWEAR = ['none', 'topi', 'cap', 'cloth', 'turban', 'dupatta', 'hijab'];

/** hairline: lowest std y at which hair grows for azimuth theta (0 = front, PI = back). */
function hairline(style, th) {
  const a = Math.abs(th);
  const front = { crop: 0.066, short: 0.062, combed: 0.065, receding: 0.088, long: 0.062, plait: 0.066, bun: 0.066, bunLow: 0.066, topknot: 0.068, bowl: 0.046, pigtails: 0.05 }[style] ?? 0.064;
  // front, temple, above the ear, behind the ear, nape
  const keys = [
    [0, front],
    [0.7, front - 0.004],
    [1.05, front - 0.026],
    [1.3, front - 0.05],
    [1.5, style === 'bowl' || style === 'pigtails' ? -0.035 : 0.004],
    [1.9, style === 'bowl' || style === 'pigtails' ? -0.06 : -0.002],
    [2.4, -0.045],
    [PI, style === 'crop' ? -0.05 : -0.078],
  ];
  if (style === 'receding') keys[1][1] = front - 0.014;
  for (let i = 0; i < keys.length - 1; i++) {
    if (a <= keys[i + 1][0]) return lerp(keys[i][1], keys[i + 1][1], smooth(keys[i][0], keys[i + 1][0], a));
  }
  return keys[keys.length - 1][1];
}

/**
 * A shell hugging the head. `rows`: std y from top to bottom; `cols` around; `off(th, y, base)` -> outward offset (m);
 * `mask(th, y)` -> 0..1 coverage (0 drops the vertex's cells); aEdge = mask drives the ragged edge in the hair shader.
 */
function shell(shape, { cols, rows, off, mask, uvScale = [1, 1], yRange }) {
  const pos = [];
  const edge = [];
  const uv = [];
  const idx = [];
  const [y0, y1] = yRange;
  const tmp = { x: 0, y: 0, z: 0 };
  const top = { x: 0, y: 0, z: 0 };
  shape.point(0, CROWN, top, false);
  const topOff = off(0, CROWN, { sx: 0, sz: 1 });
  pos.push(top.x, top.y + topOff, top.z);
  edge.push(mask(0, CROWN));
  uv.push(0.5, 1);
  for (let j = 0; j <= rows; j++) {
    const y = lerp(y0, y1, j / rows);
    for (let i = 0; i < cols; i++) {
      const th = -PI + (2 * PI * i) / cols;
      const b = shape.base(th, y);
      shape.point(th, y, tmp, false);
      const o = off(th, y, b);
      pos.push(tmp.x + b.sx * o, tmp.y + (y > 0.06 ? o * 0.5 : 0), tmp.z + b.sz * o);
      edge.push(mask(th, y));
      uv.push((i / cols) * uvScale[0], (1 - j / rows) * uvScale[1]);
    }
  }
  const at = (j, i) => 1 + j * cols + (i % cols);
  for (let i = 0; i < cols; i++) {
    const m = edge[0] + edge[at(0, i)] + edge[at(0, i + 1)];
    if (m > 0.05) idx.push(0, at(0, i), at(0, i + 1));
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = at(j, i);
      const b = at(j, i + 1);
      const c = at(j + 1, i);
      const d = at(j + 1, i + 1);
      if (edge[a] + edge[b] + edge[c] + edge[d] < 0.08) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('aEdge', new Float32BufferAttribute(edge, 1));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A hanging strand card: path from (th, y) down the head then straight down; uv.x across, uv.y 1 at the root to 0 at the tip. */
function card(shape, th, y0, len, width, rows, spread = 0, curl = 0) {
  const pos = [];
  const uv = [];
  const idx = [];
  const tmp = { x: 0, y: 0, z: 0 };
  const yEnd = y0 - len;
  for (let j = 0; j <= rows; j++) {
    const s = j / rows;
    const y = lerp(y0, yEnd, s);
    const yc = Math.max(y, -0.075);
    const b = shape.base(th, yc);
    shape.point(th, yc, tmp, false);
    const below = Math.max(0, -0.075 - y);
    const out = 0.006 + 0.004 * Math.sin(s * PI) + below * 0.12 + 0.009 * (1 - s) * 0 + spread * s;
    const w = width * (1 - 0.55 * s * s);
    const cx = tmp.x + b.sx * out + curl * s * s * 0.03;
    const cz = tmp.z + b.sz * out - below * 0.12 * (b.sz > 0 ? 0 : 0) - (b.sz < 0 ? below * 0.15 : 0);
    // across direction: tangent around the head (cos, 0, -sin)
    const tx = b.sz;
    const tz = -b.sx;
    pos.push(cx - tx * w, tmp.y + (y - yc), cz - tz * w, cx + tx * w, tmp.y + (y - yc), cz + tz * w);
    uv.push(0, 1 - s, 1, 1 - s);
  }
  for (let j = 0; j < rows; j++) {
    const a = j * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  return { pos, uv, idx };
}

function mergeCards(list) {
  const pos = [];
  const uv = [];
  const idx = [];
  const edge = [];
  for (const c of list) {
    const off = pos.length / 3;
    pos.push(...c.pos);
    uv.push(...c.uv);
    for (let i = 0; i < c.pos.length / 3; i++) edge.push(1);
    for (const i of c.idx) idx.push(i + off);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function sphereMesh(r, mat, x, y, z, sx = 1, sy = 1, sz = 1, w = 8, h = 6) {
  const g = new SphereGeometry(r, w, h);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  g.setAttribute('aEdge', new Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
  return new Mesh(g, mat);
}

/**
 * buildHair({ shape, style, headwear, color, grey, seed, quality, clothColor, clothColor2 }) -> { group, dispose }
 */
export function buildHair(o) {
  const { shape } = o;
  const P = shape.P;
  const tier = tierOf(o.quality);
  const r = rng(`hair:${P.kind}:${P.seed}:${o.style}`);
  const group = new Group();
  group.name = 'hair';
  const style = HAIR_STYLES.includes(o.style) ? o.style : 'short';
  const headwear = HEADWEAR.includes(o.headwear) ? o.headwear : 'none';
  const color = o.color || P.hairColor;
  const grey = o.grey ?? P.grey;
  const shine = style === 'combed' ? 0.85 : style === 'long' || style === 'plait' || style === 'bun' || style === 'bunLow' ? 0.45 : 0.22;
  const mat = createHairMaterial({ color, grey, shine, doubleSide: true });
  const cardMat = createHairMaterial({ color, grey, shine, alphaCards: true });
  const meshes = [];
  const add = (g, m, name) => {
    const mesh = new Mesh(g, m);
    mesh.name = name;
    mesh.frustumCulled = false;
    group.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  // ---- scalp shell
  if (style !== 'none') {
    const cols = Math.max(24, Math.round(44 * Math.max(0.6, tier.hairCards)));
    const nrows = Math.max(7, Math.round(11 * Math.max(0.7, tier.hairCards)));
    const t0 = { crop: 0.0022, short: 0.0042, combed: 0.0062, receding: 0.0045, long: 0.006, plait: 0.0048, bun: 0.0048, bunLow: 0.0048, topknot: 0.0042, bowl: 0.0075, pigtails: 0.006 }[style];
    const part = 0.35 * (style === 'combed' ? 1 : 0);
    const g = shell(shape, {
      cols,
      rows: nrows,
      yRange: [0.106, -0.082],
      off: (th, y) => {
        const m = smooth(hairline(style, th) - 0.002, hairline(style, th) + 0.012, y);
        let t = t0 * (0.6 + 0.6 * m);
        if (style === 'combed') t += 0.006 * smooth(0.045, 0.075, y) * gauss(th, 0.9) - 0.0035 * gauss(th - part, 0.07) * smooth(0.04, 0.08, y);
        if (style === 'bowl') t += 0.003 * smooth(0.03, 0.055, y);
        t += 0.0016 * Math.sin(th * 7.3 + y * 90) * (style === 'crop' ? 0.2 : 1);
        return t + 0.001;
      },
      mask: (th, y) => {
        const hl = hairline(style, th);
        let m = smooth(hl - 0.001, hl + 0.011, y);
        if (style === 'receding') m *= 1 - 0.97 * smooth(0.058, 0.085, y) * (1 - smooth(1.7, 2.5, Math.abs(th)));
        if (style === 'combed' || style === 'plait' || style === 'bun' || style === 'bunLow') m *= 1;
        return m;
      },
      uvScale: [4, 3],
    });
    add(g, mat, 'scalp');
  }

  // ---- strand cards for length
  if (style === 'long' || style === 'bowl' || style === 'pigtails') {
    const list = [];
    const n = Math.round((style === 'long' ? 34 : style === 'short' ? 12 : style === 'combed' ? 10 : style === 'bowl' ? 14 : 12) * tier.hairCards);
    for (let i = 0; i < n; i++) {
      let th;
      let y0;
      let len;
      let w;
      if (style === 'long') {
        th = (r() < 0.5 ? -1 : 1) * lerp(1.25, 3.0, r());
        y0 = lerp(0.04, -0.03, r());
        len = lerp(0.2, 0.36, r()) + (Math.abs(th) > 2.4 ? 0.06 : 0) + (y0 + 0.07);
        w = lerp(0.026, 0.04, r());
      } else if (style === 'short' || style === 'combed') {
        th = (r() < 0.5 ? -1 : 1) * lerp(0.4, 2.8, r());
        y0 = lerp(0.075, 0.03, r()) - (Math.abs(th) > 1.2 ? 0.04 : 0);
        len = lerp(0.03, 0.055, r());
        w = lerp(0.008, 0.013, r());
      } else {
        th = (r() < 0.5 ? -1 : 1) * lerp(0.4, 2.9, r());
        y0 = lerp(0.06, 0.0, r());
        len = lerp(0.06, 0.1, r());
        w = lerp(0.011, 0.017, r());
      }
      list.push(card(shape, th, y0, len, w, 6, r() * 0.01, (r() - 0.5) * 0.6));
    }
    if (list.length) add(mergeCards(list), cardMat, 'cards');
  }

  // ---- long loose hair: a curtain behind the neck and over the shoulders fills what the cards leave open
  if (style === 'long') {
    const cols = Math.max(14, Math.round(22 * Math.max(0.7, tier.hairCards)));
    const rowsN = 7;
    const pos = [];
    const edge = [];
    const uvs = [];
    const idx = [];
    for (let j = 0; j <= rowsN; j++) {
      const s = j / rowsN;
      const y = lerp(-0.05, -0.36, s);
      const flare = 1 + 0.35 * s;
      for (let i = 0; i <= cols; i++) {
        const k = i / cols;
        const th = lerp(1.1, TAU_ - 1.1, k);
        const rx = 0.082 * flare;
        const rz = 0.078 * flare;
        const edgeFade = Math.min(1, Math.sin(k * PI) * 3.2);
        pos.push(Math.sin(th) * rx, y, -0.045 + Math.cos(th) * rz - 0.004 * Math.sin(s * 9 + i));
        edge.push(edgeFade * (1 - 0.35 * s));
        uvs.push(k * 6, 1 - s);
      }
    }
    const W = cols + 1;
    for (let j = 0; j < rowsN; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * W + i;
        idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('aEdge', new Float32BufferAttribute(edge, 1));
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    add(g, mat, 'curtain');
  }

  // ---- braid, bun, topknot, pigtails
  const hairTie = new MeshStandardMaterial({ color: o.tieColor || '#b3122b', roughness: 0.6 });
  if (style === 'plait') {
    const N = Math.round(11 * Math.max(0.6, tier.hairCards));
    const lobe = new SphereGeometry(1, 5, 3);
    const geos = [];
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1);
      const g = lobe.clone();
      const w = lerp(0.027, 0.012, s ** 1.4);
      g.scale(w * 1.0, 0.026 * (1 - 0.2 * s), w * 0.85);
      g.rotateZ(((i % 2) - 0.5) * 0.9);
      g.translate(((i % 2) - 0.5) * 0.008 * (1 - s), -0.075 - i * 0.032, -0.093 - 0.012 * Math.sin(s * PI) - 0.004 * i * 0.2);
      geos.push(g);
    }
    lobe.dispose();
    const merged = mergeGeos(geos);
    add(merged, mat, 'braid');
    const tie = new Mesh(new TorusGeometry(0.0125, 0.0035, 4, 8), hairTie);
    tie.position.set(0, -0.075 - (N - 1) * 0.032 - 0.004, -0.1);
    tie.rotation.x = PI / 2;
    group.add(tie);
  }
  if (style === 'bun' || style === 'bunLow') {
    const low = style === 'bunLow';
    const m = sphereMesh(low ? 0.043 : 0.04, mat, 0, low ? -0.035 : 0.045, low ? -0.118 : -0.1, 1, 0.9, 0.85, 10, 7);
    m.name = 'bun';
    group.add(m);
    const tie = new Mesh(new TorusGeometry(0.036, 0.0022, 4, 12), hairTie);
    tie.position.set(0, low ? -0.035 : 0.045, low ? -0.098 : -0.082);
    tie.rotation.x = PI / 2;
    tie.scale.set(1, 1, 1);
    group.add(tie);
    if (o.gajra) {
      const jas = new MeshStandardMaterial({ color: '#fbf6e8', roughness: 0.7 });
      const geos = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * PI * 1.5 - 0.4 - PI * 0.25;
        const g = new SphereGeometry(0.0062, 5, 3);
        g.translate(Math.sin(a) * 0.044, (low ? -0.035 : 0.045) - 0.01, (low ? -0.118 : -0.1) + Math.cos(a) * 0.04 + 0.0);
        geos.push(g);
      }
      add(mergeGeos(geos), jas, 'gajra');
    }
  }
  if (style === 'topknot') {
    const m = sphereMesh(0.03, mat, 0, 0.126, -0.018, 1, 1, 1, 9, 6);
    m.name = 'topknot';
    group.add(m);
    const tie = new Mesh(new TorusGeometry(0.014, 0.003, 4, 8), hairTie);
    tie.position.set(0, 0.112, -0.016);
    tie.rotation.x = PI / 2;
    group.add(tie);
  }
  if (style === 'pigtails') {
    for (const s of [1, -1]) {
      const m = sphereMesh(0.03, mat, s * 0.072, 0.03, -0.05, 1, 1.5, 1, 8, 6);
      group.add(m);
      const tie = new Mesh(new TorusGeometry(0.014, 0.003, 4, 8), hairTie);
      tie.position.set(s * 0.072, 0.065, -0.05);
      tie.rotation.x = PI / 2;
      group.add(tie);
    }
  }

  // ---- headwear
  if (headwear !== 'none') addHeadwear(group, shape, headwear, o, tier, add);

  return {
    group,
    meshes,
    dispose() {
      group.traverse((m) => {
        if (m.geometry) m.geometry.dispose();
        const mt = m.material;
        if (mt && !mt.userData.shared) mt.dispose();
      });
      group.removeFromParent();
    },
  };
}

function mergeGeos(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const idx = [];
  let o = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    pos.set(p.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + o);
    o += p.count;
    g.dispose();
  }
  const m = new BufferGeometry();
  m.setAttribute('position', new Float32BufferAttribute(pos, 3));
  m.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  m.setAttribute('aEdge', new Float32BufferAttribute(new Float32Array(n).fill(1), 1));
  m.setIndex(idx);
  return m;
}

function addHeadwear(group, shape, kind, o, tier, add) {
  const P = shape.P;
  const q = tier.id;
  const col = o.clothColor || '#f4eee0';
  const col2 = o.clothColor2 || '#d6d0c2';
  const mkMesh = (g, m, name) => {
    const mesh = new Mesh(g, m);
    mesh.name = name;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };
  const cols = Math.max(20, Math.round(28 * Math.max(0.7, tier.hairCards)));
  void add;
  if (kind === 'topi') {
    // white crocheted skull cap sitting on the head, brim a little above the brow and the ears
    const g = shell(shape, {
      cols,
      rows: 6,
      yRange: [0.106, 0.026],
      uvScale: [6, 3],
      off: (th, y) => 0.0058 + 0.0014 * Math.sin(th * 16) * smooth(0.04, 0.06, y) * 0 + 0.0022 * smooth(0.05, 0.026, y),
      mask: (th, y) => smooth(0.024, 0.032, y),
    });
    mkMesh(g, fabricMat({ color: col, color2: col2, pattern: 'crochet', quality: q }), 'topi');
  } else if (kind === 'cap') {
    const g = shell(shape, {
      cols,
      rows: 6,
      yRange: [0.108, 0.034],
      uvScale: [4, 2],
      off: (th, y) => 0.007 + 0.002 * smooth(0.06, 0.1, y),
      mask: (th, y) => smooth(0.032, 0.04, y),
    });
    mkMesh(g, fabricMat({ color: col, pattern: 'plain', quality: q }), 'cap');
    // visor
    const vg = new BufferGeometry();
    const pos = [];
    const idx = [];
    const N = 10;
    for (let i = 0; i <= N; i++) {
      const a = lerp(-1.15, 1.15, i / N);
      const R = 0.088;
      const x = Math.sin(a) * R;
      const z = Math.cos(a) * R * 0.98 + 0.004;
      pos.push(x, 0.04, z, Math.sin(a) * (R + 0.052), 0.034, Math.cos(a) * (R + 0.052 * Math.cos(a)) + 0.004);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    vg.setAttribute('position', new Float32BufferAttribute(pos, 3));
    vg.setIndex(idx);
    vg.computeVertexNormals();
    mkMesh(vg, fabricMat({ color: col, pattern: 'plain', quality: q }), 'visor');
  } else if (kind === 'cloth' || kind === 'turban') {
    // a wrapped headcloth: layered twisted bands around the head, a knot at the side
    const turb = kind === 'turban';
    const mat = fabricMat({ color: col, color2: col2, pattern: o.pattern || 'gamchha', quality: q });
    const bands = turb ? 5 : 3;
    for (let b = 0; b < bands; b++) {
      const yb = lerp(0.046, turb ? 0.086 : 0.07, b / Math.max(1, bands - 1));
      const g = shell(shape, {
        cols,
        rows: 3,
        yRange: [yb + 0.016, yb - 0.016],
        uvScale: [3, 1],
        off: (th, y) => 0.0075 + 0.0045 * Math.cos(((y - yb) / 0.016) * 1.4) + 0.004 * b / bands + 0.0025 * Math.sin(th * 3 + b * 1.7) + (turb ? 0.006 * (b / bands) : 0),
        mask: () => 1,
      });
      mkMesh(g, mat, `wrap${b}`);
    }
    if (!turb) {
      // the cloth top: a soft dome over the crown
      const g = shell(shape, {
        cols,
        rows: 4,
        yRange: [0.108, 0.07],
        uvScale: [3, 1],
        off: (th, y) => 0.0085 + 0.003 * Math.sin(th * 4),
        mask: () => 1,
      });
      mkMesh(g, mat, 'cloth-top');
    } else {
      const g = shell(shape, {
        cols,
        rows: 4,
        yRange: [0.114, 0.08],
        uvScale: [3, 1],
        off: (th, y) => 0.016 + 0.004 * Math.sin(th * 5),
        mask: () => 1,
      });
      mkMesh(g, mat, 'turban-top');
    }
    // knot / tail
    const kn = new SphereGeometry(0.02, 8, 6);
    kn.scale(1.2, 0.8, 1);
    kn.translate(turb ? 0.0 : 0.062, turb ? 0.02 : 0.054, turb ? 0.088 : 0.058);
    mkMesh(kn, mat, 'knot');
    if (!turb) {
      const tail = new BufferGeometry();
      const pos = [];
      const idx = [];
      for (let j = 0; j <= 4; j++) {
        const s = j / 4;
        const x = 0.066 + 0.008 * s;
        const y = 0.054 - 0.09 * s;
        const z = 0.05 - 0.02 * s - 0.02 * Math.sin(s * 3);
        const w = 0.018 * (1 - 0.3 * s);
        pos.push(x - w * 0.5, y, z - w, x + w * 0.5, y, z + w);
      }
      for (let j = 0; j < 4; j++) {
        const a = j * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      tail.setAttribute('position', new Float32BufferAttribute(pos, 3));
      tail.setIndex(idx);
      tail.computeVertexNormals();
      mkMesh(tail, mat, 'tail');
    }
  } else if (kind === 'dupatta' || kind === 'hijab') {
    // a scarf over the hair with an oval left open for the face, falling over the shoulders at the back
    const mat = fabricMat({ color: col, color2: col2, pattern: o.pattern || 'plain', quality: q });
    const hij = kind === 'hijab';
    const g = shell(shape, {
      cols: cols + 8,
      rows: 11,
      yRange: [0.108, hij ? -0.13 : -0.07],
      uvScale: [4, 3],
      off: (th, y) => {
        const a = Math.abs(th);
        const fold = 0.0035 * Math.sin(th * 5.0 + y * 40);
        return 0.0085 + 0.004 * smooth(0.02, -0.07, y) * (hij ? 1.4 : 1) + fold;
      },
      mask: (th, y) => {
        const a = Math.abs(th);
        const open = hij ? 0.95 : 0.8; // half-angle of the opening for the face
        const yTop = 0.055;
        const yBot = hij ? -0.125 : -0.1;
        const hole = smooth(yTop, yTop - 0.008, y) * smooth(yBot, yBot + 0.01, y) * smooth(open, open - 0.12, a);
        return 1 - hole;
      },
    });
    mkMesh(g, mat, kind);
    if (!hij) {
      // dupatta tails: two cloth panels hanging down the back / over a shoulder
      const tail = new BufferGeometry();
      const pos = [];
      const idx = [];
      for (let j = 0; j <= 6; j++) {
        const s = j / 6;
        const y = -0.07 - 0.38 * s;
        const w = 0.075 + 0.03 * s;
        const z = -0.1 - 0.02 * s + 0.01 * Math.sin(s * 6);
        pos.push(-w, y, z, 0, y, z - 0.012 * Math.sin(s * 5), w, y, z);
      }
      for (let j = 0; j < 6; j++) {
        const a = j * 3;
        idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
      }
      tail.setAttribute('position', new Float32BufferAttribute(pos, 3));
      tail.setIndex(idx);
      tail.computeVertexNormals();
      mkMesh(tail, mat, 'dupatta-tail');
    }
  }
  void P;
  void DoubleSide;
  void Color;
  void clamp;
}
