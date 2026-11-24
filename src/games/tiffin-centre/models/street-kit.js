// Street model kit: builds merged, UV-mapped, vertex-tinted geometry per material (see materials-street.js), caches it as a shared
// "bundle" and instantiates cheap meshes from it. Static parts are baked; animated parts live in named sub-groups with a pivot.
import {
  BoxGeometry, BufferGeometry, CapsuleGeometry, CatmullRomCurve3, Color, CylinderGeometry, Euler, Float32BufferAttribute, Group, LatheGeometry,
  Matrix4, Mesh, PlaneGeometry, Quaternion, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAT, glowMat, streetMat } from './materials-street.js';
import { onModelCacheReset, rng, sharedGeo } from './util.js';
import { smoothstep } from './texgen.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

// ---------------------------------------------------------------------------------------------------------------------
// geometry modifiers (run on the INDEXED primitive, before it is flattened)
/** Soft round dents / bulges on any surface: `n` random centres, `depth` metres (negative = dent), `radius` metres. Normals are tilted, not recomputed. */
export function dents({ seed = 1, n = 6, depth = -0.004, radius = 0.05, yMin = -Infinity, yMax = Infinity } = {}) {
  return (geo) => {
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const r = rng(`dent${seed}`);
    const cs = [];
    let tries = 0;
    while (cs.length < n && tries++ < n * 20) {
      const i = Math.floor(r() * pos.count);
      if (pos.getY(i) < yMin || pos.getY(i) > yMax) continue;
      cs.push([pos.getX(i), pos.getY(i), pos.getZ(i), radius * (0.5 + r() * 0.9), depth * (0.4 + r() * 0.9)]);
    }
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      let nx = nor.getX(i);
      let ny = nor.getY(i);
      let nz = nor.getZ(i);
      const ox = nx;
      const oy = ny;
      const oz = nz;
      for (const [cx, cy, cz, R, D] of cs) {
        const dx = x - cx;
        const dy = y - cy;
        const dz = z - cz;
        const d = Math.hypot(dx, dy, dz);
        if (d >= R) continue;
        const f = 1 - d / R;
        const h = f * f * (3 - 2 * f);
        x += ox * D * h;
        y += oy * D * h;
        z += oz * D * h;
        const dn = dx * ox + dy * oy + dz * oz;
        const k = (D / R) * 6 * f * (1 - f);
        const tx = dx - ox * dn;
        const ty = dy - oy * dn;
        const tz = dz - oz * dn;
        const tl = Math.hypot(tx, ty, tz) || 1;
        nx += (tx / tl) * k;
        ny += (ty / tl) * k;
        nz += (tz / tl) * k;
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      pos.setXYZ(i, x, y, z);
      nor.setXYZ(i, nx / l, ny / l, nz / l);
    }
    pos.needsUpdate = nor.needsUpdate = true;
  };
}

const h3 = (x, y, z) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Smooth 3D value noise in [-1, 1]. */
export function vnoise3(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => h3(ix + dx, iy + dy, iz + dz);
  return (l(l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy), l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy), sz)) * 2 - 1;
}

/** Lumpy / folded surface: displaces along the normal by fractal value noise and tilts the normals with its gradient. */
export function lumps({ amp = 0.02, freq = 4, oct = 2, seed = 1, sx = 1, sy = 1, sz = 1 } = {}) {
  const f = (x, y, z) => {
    let a = 1;
    let fr = freq;
    let v = 0;
    for (let o = 0; o < oct; o++) {
      v += vnoise3(x * fr * sx + seed * 17.3, y * fr * sy + seed * 3.1, z * fr * sz + seed * 9.7) * a;
      a *= 0.5;
      fr *= 2.1;
    }
    return v * amp;
  };
  return (geo) => {
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const e = 0.01 / Math.max(1, freq);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const v = f(x, y, z);
      const gx = (f(x + e, y, z) - v) / e;
      const gy = (f(x, y + e, z) - v) / e;
      const gz = (f(x, y, z + e) - v) / e;
      let nx = nor.getX(i);
      let ny = nor.getY(i);
      let nz = nor.getZ(i);
      pos.setXYZ(i, x + nx * v, y + ny * v, z + nz * v);
      nx -= gx;
      ny -= gy;
      nz -= gz;
      const l = Math.hypot(nx, ny, nz) || 1;
      nor.setXYZ(i, nx / l, ny / l, nz / l);
    }
    pos.needsUpdate = nor.needsUpdate = true;
  };
}

/** Catenary-ish sagging point list from a to b (arrays), `sag` metres at the middle (down = -y). */
export function sagPoints(a, b, sag, n = 8, wobble = 0, seed = 1) {
  const pts = [];
  const r = rng(`sag${seed}`);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const k = 4 * t * (1 - t);
    pts.push([a[0] + (b[0] - a[0]) * t + (r() - 0.5) * wobble * k, a[1] + (b[1] - a[1]) * t - sag * k, a[2] + (b[2] - a[2]) * t + (r() - 0.5) * wobble * k]);
  }
  return pts;
}

/** Radial scallops (cloth folds): r' = r + amp * sin(n * theta) * weight(y); full strength at y <= yLo, none at y >= yHi. axis = y. */
export function folds({ n = 8, amp = 0.006, yLo = -100, yHi = 100, seed = 0 } = {}) {
  return (geo) => {
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const w = 1 - smoothstep(yLo, yHi, y);
      if (w <= 0) continue;
      const r = Math.hypot(x, z) || 1e-6;
      const th = Math.atan2(z, x);
      const a = amp * w * (Math.sin(n * th + seed) + 0.45 * Math.sin(n * 2.3 * th + seed * 2));
      pos.setXYZ(i, x + (x / r) * a, y, z + (z / r) * a);
      const da = amp * w * n * (Math.cos(n * th + seed) + 1.0 * Math.cos(n * 2.3 * th + seed * 2));
      const nx = nor.getX(i) - (-z / r) * (da / r);
      const nz = nor.getZ(i) - (x / r) * (da / r);
      const l = Math.hypot(nx, nor.getY(i), nz) || 1;
      nor.setXYZ(i, nx / l, nor.getY(i) / l, nz / l);
    }
    pos.needsUpdate = nor.needsUpdate = true;
  };
}

/** Tube along a Catmull-Rom path with a radius function r(t), t in [0, 1], and closed ends. Returns an INDEXED geometry. */
export function taperGeometry(pts, rFn, seg = 10, rseg = 6) {
  const curve = new CatmullRomCurve3(pts.map((q) => new Vector3(q[0], q[1], q[2])), false, 'catmullrom', 0.5);
  const frames = curve.computeFrenetFrames(seg, false);
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const P = new Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, P);
    const r = Math.max(1e-4, rFn(t));
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= rseg; j++) {
      const a = (j / rseg) * Math.PI * 2;
      const cx = -Math.cos(a);
      const cy = Math.sin(a);
      const nx = cx * N.x + cy * B.x;
      const ny = cx * N.y + cy * B.y;
      const nz = cx * N.z + cy * B.z;
      pos.push(P.x + r * nx, P.y + r * ny, P.z + r * nz);
      nor.push(nx, ny, nz);
      uv.push(t, j / rseg);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < rseg; j++) {
      const a = i * (rseg + 1) + j;
      const b = (i + 1) * (rseg + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // end caps (fans)
  for (const end of [0, seg]) {
    const base = pos.length / 3;
    curve.getPointAt(end / seg, P);
    const tan = curve.getTangentAt(end / seg);
    const s = end === 0 ? -1 : 1;
    pos.push(P.x, P.y, P.z);
    nor.push(tan.x * s, tan.y * s, tan.z * s);
    uv.push(0.5, 0.5);
    for (let j = 0; j <= rseg; j++) {
      const k = end * (rseg + 1) + j;
      pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
      nor.push(tan.x * s, tan.y * s, tan.z * s);
      uv.push(0.5, 0.5);
    }
    for (let j = 0; j < rseg; j++) {
      if (s > 0) idx.push(base, base + 1 + j, base + 2 + j);
      else idx.push(base, base + 2 + j, base + 1 + j);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Corrugated sheet (tin): width along x, length along z, ridges along z. Returns an indexed geometry with analytic normals. */
export function corrugatedGeometry(width, length, { amp = 0.0125, period = 0.076, rows = 2, perPeriod = 5, sag = 0 } = {}) {
  const cols = Math.max(4, Math.round((width / period) * perPeriod));
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const z = (v - 0.5) * length;
    const dz = sag * (1 - (2 * v - 1) ** 2);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const x = (u - 0.5) * width;
      const ph = (x / period) * Math.PI * 2;
      const y = amp * Math.sin(ph) - dz;
      const dydx = amp * Math.cos(ph) * ((Math.PI * 2) / period);
      const l = Math.hypot(dydx, 1);
      pos.push(x, y, z);
      nor.push(-dydx / l, 1 / l, 0);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = (j + 1) * (cols + 1) + i;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A curved half-pipe panel (canvas hoods, awnings): across the x axis it follows an elliptical arch, along z it slopes. */
export function archGeometry(width, height, length, { across = 10, along = 6, zSlope = 0, startAngle = -Math.PI / 2, endAngle = Math.PI / 2 } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= along; j++) {
    const v = j / along;
    const z = (v - 0.5) * length;
    for (let i = 0; i <= across; i++) {
      const u = i / across;
      const a = startAngle + (endAngle - startAngle) * u;
      pos.push((width / 2) * Math.sin(a), height * Math.cos(a) + zSlope * (0.5 - v), z);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < across; i++) {
      const a = j * (across + 1) + i;
      const b = (j + 1) * (across + 1) + i;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Lofted body: `sections` = [[z, yc, rx, ry, xc?], ...] elliptical rings along z (superellipse exponent `pow`), closed at both ends, smooth normals. */
export function loftGeometry(sections, { around = 16, pow = 2 } = {}) {
  const pos = [];
  const uv = [];
  const idx = [];
  const n = sections.length;
  for (let i = 0; i < n; i++) {
    const [z, yc, rx, ry, xc = 0] = sections[i];
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(xc + rx * Math.sign(c) * Math.abs(c) ** (2 / pow), yc + ry * Math.sign(s) * Math.abs(s) ** (2 / pow), z);
      uv.push(j / around, i / (n - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j;
      const b = (i + 1) * (around + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  for (const [ring, flip] of [[0, true], [n - 1, false]]) {
    const [z, yc, , , xc = 0] = sections[ring];
    const c0 = pos.length / 3;
    pos.push(xc, yc, z);
    uv.push(0.5, 0.5);
    for (let j = 0; j < around; j++) {
      const a = ring * (around + 1) + j;
      if (flip) idx.push(c0, a + 1, a);
      else idx.push(c0, a, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A grid sheet displaced by `fn(x, z) -> y` (ground, roads, cloth): w x d metres, smooth normals. */
export function heightGrid(w, d, ws, ds, fn) {
  const g = new PlaneGeometry(w, d, ws, ds).rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, fn(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  return g;
}

/** A snarl of overhead cables: `n` sagging runs between random points inside a box, with loops and knots. Adds tubes to `k` (material 'rubber'). */
export function cableTangle(k, { c = [0, 0, 0], size = [1, 0.6, 0.4], n = 8, seed = 1, r = 0.0085, colors = ['#161514', '#161514', '#26211e', '#8a1f1a', '#c9c4b4'] } = {}) {
  const rr = rng(`tangle${seed}`);
  const pt = () => [c[0] + (rr() - 0.5) * size[0], c[1] + (rr() - 0.5) * size[1], c[2] + (rr() - 0.5) * size[2]];
  for (let i = 0; i < n; i++) {
    const a = pt();
    const b = pt();
    const pts = sagPoints(a, b, 0.05 + rr() * size[1] * 0.5, 6, size[2] * 0.6, seed * 31 + i);
    if (rr() < 0.5) {
      const m = pts[3];
      pts.splice(3, 0, [m[0] + (rr() - 0.5) * 0.2, m[1] - 0.12 - rr() * 0.1, m[2] + (rr() - 0.5) * 0.2], [m[0] + (rr() - 0.5) * 0.2, m[1] + 0.05, m[2] + (rr() - 0.5) * 0.2]);
    }
    k.tube('rubber', pts, r * (0.7 + rr() * 0.8), { tint: colors[i % colors.length] }, 12, 3);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// UV projection (per triangle, from the face normal, in prop space so textures keep a real-world scale)
function boxUV(g, su, sv, ox, oy, swap) {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < 3; k++) {
      nx += nor.getX(t + k);
      ny += nor.getY(t + k);
      nz += nor.getZ(t + k);
    }
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      let u;
      let v;
      if (ax >= ay && ax >= az) {
        u = z * Math.sign(nx || 1);
        v = y;
      } else if (ay >= az) {
        u = x;
        v = z * Math.sign(ny || 1);
      } else {
        u = x * Math.sign(nz || 1);
        v = y;
      }
      if (swap) {
        const tmp = u;
        u = v;
        v = tmp;
      }
      uv[i * 2] = u * su + ox;
      uv[i * 2 + 1] = v * sv + oy;
    }
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
}

/** Cylindrical UV about the geometry's LOCAL y axis (lathes, cylinders): integer repeats around, flat on the caps. */
function cylUV(g, tile, du, dv, sc) {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const n = pos.count;
  let R = 0;
  for (let i = 0; i < n; i++) R = Math.max(R, Math.hypot(pos.getX(i), pos.getZ(i)));
  const reps = Math.max(1, Math.round(((Math.PI * 2 * R * sc) / tile) * du));
  const uv = new Float32Array(n * 2);
  const k = sc / tile;
  for (let t = 0; t < n; t += 3) {
    const ny = (Math.abs(nor.getY(t)) + Math.abs(nor.getY(t + 1)) + Math.abs(nor.getY(t + 2))) / 3;
    if (ny > 0.85) {
      for (let j = 0; j < 3; j++) {
        uv[(t + j) * 2] = pos.getX(t + j) * k * du;
        uv[(t + j) * 2 + 1] = pos.getZ(t + j) * k * dv;
      }
      continue;
    }
    const th0 = Math.atan2(pos.getZ(t), pos.getX(t)) / (Math.PI * 2);
    for (let j = 0; j < 3; j++) {
      let d = Math.atan2(pos.getZ(t + j), pos.getX(t + j)) / (Math.PI * 2) - th0;
      d -= Math.round(d);
      uv[(t + j) * 2] = (th0 + d) * reps;
      uv[(t + j) * 2 + 1] = pos.getY(t + j) * k * dv;
    }
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
}

// ---------------------------------------------------------------------------------------------------------------------
export class Kit {
  constructor(pivot = null) {
    this.items = [];
    this.pivot = pivot;
    this.subs = new Map();
    this.r = rng('kit');
  }

  /** A named sub-group with its own pivot (prop-space position it rotates around). Add parts to it with the same API. */
  sub(name, pivot = [0, 0, 0]) {
    let s = this.subs.get(name);
    if (!s) {
      s = new Kit(pivot);
      s.r = this.r;
      this.subs.set(name, s);
    }
    return s;
  }

  /** o: p [x,y,z], r [rx,ry,rz] (XYZ euler), s (number | [x,y,z]), tint, vary, proj ('box'|'keep'), uvs (density multiplier), uvr (swap u/v), pre(geo), vc(x,y,z) -> number | [r,g,b] */
  add(geo, mat, o = {}) {
    if (o.pre) o.pre(geo);
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    const isName = typeof mat === 'string';
    const def = isName ? MAT[mat] : null;
    const proj = o.proj || (isName ? def?.proj : 'keep') || o.dproj || 'box';
    const dens = o.uvs ?? 1;
    const du = Array.isArray(dens) ? dens[0] : dens;
    const dv = Array.isArray(dens) ? dens[1] : dens;
    if (proj === 'cyl') {
      if (!g.attributes.normal) g.computeVertexNormals();
      const sc = typeof o.s === 'number' ? o.s : o.s ? (o.s[0] + o.s[2]) / 2 : 1;
      cylUV(g, def?.tile || 1, du, dv, sc);
    }
    const p = o.p || [0, 0, 0];
    const r = o.r || [0, 0, 0];
    _p.set(p[0], p[1], p[2]);
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    if (typeof o.s === 'number') _s.set(o.s, o.s, o.s);
    else if (o.s) _s.set(o.s[0], o.s[1], o.s[2]);
    else _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (proj === 'box') {
      const inv = 1 / (def?.tile || 1);
      boxUV(g, inv * du, inv * dv, this.r() * 13, this.r() * 13, !!o.uvr);
    } else if (proj === 'keep' && g.attributes.uv) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * du, uv.getY(i) * dv);
    } else if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    // colour = tint * per-item variation * optional per-vertex function
    _c.set(o.tint ?? '#ffffff');
    const vary = o.vary ? 1 + (this.r() - 0.5) * 2 * o.vary : 1;
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let kr = vary;
      let kg = vary;
      let kb = vary;
      if (o.vc) {
        const v = o.vc(g.attributes.position.getX(i), g.attributes.position.getY(i), g.attributes.position.getZ(i));
        if (typeof v === 'number') {
          kr *= v;
          kg *= v;
          kb *= v;
        } else {
          kr *= v[0];
          kg *= v[1];
          kb *= v[2];
        }
      }
      col[i * 3] = _c.r * kr;
      col[i * 3 + 1] = _c.g * kg;
      col[i * 3 + 2] = _c.b * kb;
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    g.userData.worldY0 = this.pivot ? this.pivot[1] : 0;
    if (this.pivot) g.translate(-this.pivot[0], -this.pivot[1], -this.pivot[2]);
    this.items.push({ mat, geo: g, key: isName ? mat : mat.uuid });
    return this;
  }

  box(mat, w, h, d, o) {
    return this.add(new BoxGeometry(w, h, d), mat, o);
  }
  /** Beveled box: catches highlights on its edges (the single biggest "not a toy" detail). */
  rbox(mat, w, h, d, rad = 0.006, o, seg = 1) {
    // a bevel under 4 cm is invisible: thin parts get a plain 12-triangle box. segments > 1 cost 300+ triangles (seg >= 3 -> 2)
    if (Math.min(w, h, d) < 0.04) return this.add(new BoxGeometry(w, h, d), mat, o);
    return this.add(new RoundedBoxGeometry(w, h, d, seg >= 3 ? 2 : 1, Math.min(rad, w / 2.01, h / 2.01, d / 2.01)), mat, o);
  }
  cyl(mat, rt, rb, h, seg = 12, o, open = false, hs = 1) {
    return this.add(new CylinderGeometry(rt, rb, h, seg, hs, open), mat, { dproj: 'cyl', ...o });
  }
  sph(mat, r, ws = 12, hs = 8, o) {
    return this.add(new SphereGeometry(r, ws, hs), mat, o);
  }
  /** Sphere cap from the pole down to theta (radians). */
  cap(mat, r, theta, ws = 12, hs = 5, o) {
    return this.add(new SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, theta), mat, { dproj: 'cyl', ...o });
  }
  capsule(mat, r, len, o, cs = 4, rs = 10) {
    return this.add(new CapsuleGeometry(r, len, cs, rs), mat, o);
  }
  /** pts = [[radius, y], ...] bottom to top. */
  lathe(mat, pts, seg = 20, o) {
    return this.add(new LatheGeometry(pts.map((q) => new Vector2(q[0], q[1])), seg), mat, { dproj: 'cyl', ...o });
  }
  tor(mat, R, t, rs = 6, ts = 16, o, arc = Math.PI * 2) {
    return this.add(new TorusGeometry(R, t, rs, ts, arc), mat, o);
  }
  plane(mat, w, h, ws = 1, hs = 1, o) {
    return this.add(new PlaneGeometry(w, h, ws, hs), mat, o);
  }
  /** Round tube along a Catmull-Rom path through `pts` ([[x,y,z], ...]). */
  tube(mat, pts, r = 0.01, o, seg = 12, rseg = 5, closed = false) {
    const curve = new CatmullRomCurve3(pts.map((q) => new Vector3(q[0], q[1], q[2])), closed, 'catmullrom', 0.5);
    return this.add(new TubeGeometry(curve, seg, r, rseg, closed), mat, o);
  }

  /** Tapered tube along a path with radius function rFn(t). */
  taper(mat, pts, rFn, o, seg = 10, rseg = 6) {
    return this.add(taperGeometry(pts, rFn, seg, rseg), mat, o);
  }

  /** Merged geometry per material: [{ mat, geo }]. */
  pack(ao, aoH) {
    const by = new Map();
    for (const it of this.items) {
      if (ao) {
        const pos = it.geo.attributes.position;
        const col = it.geo.attributes.color;
        const y0 = it.geo.userData.worldY0 || 0;
        for (let i = 0; i < pos.count; i++) {
          const k = 1 - ao * (1 - smoothstep(0, aoH, pos.getY(i) + y0));
          col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
        }
      }
      const list = by.get(it.key) || { mat: it.mat, geos: [] };
      list.geos.push(it.geo);
      by.set(it.key, list);
    }
    const out = [];
    for (const { mat, geos } of by.values()) {
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (geos.length > 1) for (const g of geos) g.dispose();
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      out.push({ mat, geo });
    }
    return out;
  }

  /** ao: darken vertices near the ground (0..1), aoH: height of that gradient in metres. */
  build({ ao = 0, aoH = 0.25 } = {}) {
    const bundle = { main: this.pack(ao, aoH), subs: {} };
    for (const [name, s] of this.subs) bundle.subs[name] = { pivot: s.pivot, items: s.pack(ao, aoH) };
    return bundle;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// bundles: built once per key, geometry shared across instances
const bundles = new Map();
onModelCacheReset(() => bundles.clear());

export function getBundle(key, make) {
  let b = bundles.get(key);
  if (b) return b;
  b = make();
  let n = 0;
  const share = (items) => {
    for (const it of items) {
      const geo = it.geo;
      it.geo = sharedGeo(`${key}#${n++}`, () => geo);
    }
  };
  share(b.main);
  for (const s of Object.values(b.subs)) share(s.items);
  bundles.set(key, b);
  return b;
}

export const bundleTriangles = (b) => {
  let t = 0;
  const count = (items) => {
    for (const it of items) t += (it.geo.index ? it.geo.index.count : it.geo.attributes.position.count) / 3;
  };
  count(b.main);
  for (const s of Object.values(b.subs)) count(s.items);
  return Math.round(t);
};

export function resolveMat(mat) {
  if (typeof mat !== 'string') return mat;
  return mat === 'glow' ? glowMat() : streetMat(mat);
}

/** Adds meshes for a bundle into `group` (sub-groups at their pivots). Returns { sub: { name: Group } }. */
export function instantiate(bundle, group) {
  const subs = {};
  const fill = (items, parent) => {
    for (const it of items) {
      const m = new Mesh(it.geo, resolveMat(it.mat));
      if (it.mat === 'glass') m.renderOrder = 2;
      parent.add(m);
    }
  };
  fill(bundle.main, group);
  for (const [name, s] of Object.entries(bundle.subs)) {
    const g = new Group();
    g.name = name;
    g.position.set(s.pivot[0], s.pivot[1], s.pivot[2]);
    fill(s.items, g);
    group.add(g);
    subs[name] = g;
  }
  return { sub: subs };
}


