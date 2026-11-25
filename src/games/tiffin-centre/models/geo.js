// Geometry helpers for the realistic Tiffin Centre models: smooth lathe profiles with real creases, world-scaled box UVs,
// elliptical sweeps (handles, hoses), merging, vertex-colour baking. Pure three.js, node-safe.
import { BoxGeometry, BufferGeometry, Euler, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------------------------------
// Profiles. A control point is [r, y] or [r, y, true] (true = sharp crease: the row is duplicated with separate normals).
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

/** Dense profile rows [{r, y, nr, ny}] with normals from the local tangent (rotating the tangent -90 degrees: outward when going up). */
export function profileRows(ctrl, sub = 2) {
  // split into chains at sharp points
  const chains = [];
  let cur = [];
  ctrl.forEach((p, i) => {
    cur.push([p[0], p[1]]);
    if (p[2] && i > 0 && i < ctrl.length - 1) {
      chains.push(cur);
      cur = [[p[0], p[1]]];
    }
  });
  chains.push(cur);
  const rows = [];
  for (const ch of chains) {
    const pts = [];
    const n = ch.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = ch[Math.max(0, i - 1)];
      const p1 = ch[i];
      const p2 = ch[i + 1];
      const p3 = ch[Math.min(n - 1, i + 2)];
      for (let k = 0; k <= sub; k++) pts.push(catmull(p0, p1, p2, p3, k / (sub + 1)));
    }
    pts.push(ch[n - 1]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      rows.push({ r: Math.max(0, pts[i][0]), y: pts[i][1], nr: ty, ny: -tx });
    }
  }
  return rows;
}

/**
 * Lathe around Y with smooth normals and creases. opts: { sub, phi, phiStart, uv: [su, sv], warp(r,y,th)->[dr,dy], flip }.
 * UV: u = angle fraction * su, v = arc length (metres) * sv (so textures keep their texel density on every part).
 */
export function lathe(ctrl, seg = 24, opts = {}) {
  const { sub = 2, phi = TAU, phiStart = 0, uv = [1, 1], warp = null, flip = false } = opts;
  const rows = profileRows(ctrl, sub);
  const R = rows.length;
  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  let arc = 0;
  for (let j = 0; j < R; j++) {
    if (j > 0) arc += Math.hypot(rows[j].r - rows[j - 1].r, rows[j].y - rows[j - 1].y);
    const row = rows[j];
    for (let i = 0; i <= seg; i++) {
      const f = i / seg;
      const th = phiStart + f * phi;
      const s = Math.sin(th);
      const c = Math.cos(th);
      let r = row.r;
      let y = row.y;
      if (warp) {
        const d = warp(r, y, th);
        r += d[0];
        y += d[1];
      }
      pos.push(r * s, y, r * c);
      const k = flip ? -1 : 1;
      nor.push(k * row.nr * s, k * row.ny, k * row.nr * c);
      uvs.push(f * uv[0], arc * uv[1]);
    }
  }
  for (let j = 0; j < R - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + seg + 1;
      if (flip) idx.push(a, b, a + 1, a + 1, b, b + 1);
      else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  // drop the zero-area strips of duplicated crease rows
  return stripDegenerate(g);
}

function stripDegenerate(g) {
  const p = g.attributes.position;
  const old = g.index.array;
  const out = [];
  for (let i = 0; i < old.length; i += 3) {
    const a = old[i];
    const b = old[i + 1];
    const c = old[i + 2];
    const ax = p.getX(a);
    const ay = p.getY(a);
    const az = p.getZ(a);
    const e1 = (p.getX(b) - ax) ** 2 + (p.getY(b) - ay) ** 2 + (p.getZ(b) - az) ** 2;
    const e2 = (p.getX(c) - ax) ** 2 + (p.getY(c) - ay) ** 2 + (p.getZ(c) - az) ** 2;
    const e3 = (p.getX(c) - p.getX(b)) ** 2 + (p.getY(c) - p.getY(b)) ** 2 + (p.getZ(c) - p.getZ(b)) ** 2;
    if (e1 < 1e-14 || e2 < 1e-14 || e3 < 1e-14) continue;
    out.push(a, b, c);
  }
  g.setIndex(out);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
/** Box whose UVs are in metres / texture span (spanU x spanV), offset by a hash so neighbouring boxes do not tile identically. */
export function boxUV(w, h, d, spanU = 0.88, spanV = 0.6, off = [0, 0]) {
  const g = new BoxGeometry(w, h, d);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    let a;
    let b;
    if (nx > 0.5) {
      a = p.getZ(i);
      b = p.getY(i);
    } else if (ny > 0.5) {
      a = p.getX(i);
      b = p.getZ(i);
    } else {
      a = p.getX(i);
      b = p.getY(i);
    }
    uv.setXY(i, a / spanU + off[0], b / spanV + off[1]);
  }
  return g;
}

/** Elliptical sweep along a polyline path (Vector3[]): section(t) -> [halfWidth, halfHeight]. Round caps are closed with a fan. */
export function sweep(path, section, radial = 8, { up = new Vector3(0, 1, 0), caps = true, uv = [1, 1], twist = 0 } = {}) {
  const n = path.length;
  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const T = new Vector3();
  const N = new Vector3();
  const B = new Vector3();
  let len = 0;
  const ring = (i, endCap) => {
    const t = i / (n - 1);
    T.copy(path[Math.min(n - 1, i + 1)]).sub(path[Math.max(0, i - 1)]).normalize();
    N.crossVectors(T, up);
    if (N.lengthSq() < 1e-6) N.set(1, 0, 0);
    N.normalize();
    B.crossVectors(N, T).normalize();
    const [rw, rh] = section(t);
    const base = pos.length / 3;
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * TAU + twist * t;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ox = N.x * ca * rw + B.x * sa * rh;
      const oy = N.y * ca * rw + B.y * sa * rh;
      const oz = N.z * ca * rw + B.z * sa * rh;
      pos.push(path[i].x + ox, path[i].y + oy, path[i].z + oz);
      // ellipse normal: (ca / rw, sa / rh)
      const nx = N.x * (ca / Math.max(rw, 1e-5)) + B.x * (sa / Math.max(rh, 1e-5));
      const ny = N.y * (ca / Math.max(rw, 1e-5)) + B.y * (sa / Math.max(rh, 1e-5));
      const nz = N.z * (ca / Math.max(rw, 1e-5)) + B.z * (sa / Math.max(rh, 1e-5));
      const l = Math.hypot(nx, ny, nz) || 1;
      if (endCap) nor.push(-T.x * endCap, -T.y * endCap, -T.z * endCap);
      else nor.push(nx / l, ny / l, nz / l);
      uvs.push((k / radial) * uv[0], len * uv[1]);
    }
    return base;
  };
  const rows = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) len += path[i].distanceTo(path[i - 1]);
    rows.push(ring(i, 0));
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = rows[i] + k;
      const b = rows[i + 1] + k;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  if (caps) {
    for (const [i, s] of [[0, 1], [n - 1, -1]]) {
      const c0 = pos.length / 3;
      T.copy(path[Math.min(n - 1, i + 1)]).sub(path[Math.max(0, i - 1)]).normalize();
      pos.push(path[i].x, path[i].y, path[i].z);
      nor.push(-T.x * s, -T.y * s, -T.z * s);
      uvs.push(0.5, 0.5);
      const rim = ring(i, s);
      for (let k = 0; k < radial; k++) {
        if (s > 0) idx.push(c0, rim + k, rim + k + 1);
        else idx.push(c0, rim + k + 1, rim + k);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

/** Apply { p:[x,y,z], r:[rx,ry,rz], s: number | [sx,sy,sz] } in place and return the geometry. */
export function place(geo, o = {}) {
  const p = o.p || [0, 0, 0];
  const r = o.r || [0, 0, 0];
  const s = o.s == null ? [1, 1, 1] : typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s;
  _p.set(p[0], p[1], p[2]);
  _e.set(r[0], r[1], r[2], o.order || 'XYZ');
  _q.setFromEuler(_e);
  _s.set(s[0], s[1], s[2]);
  _m.compose(_p, _q, _s);
  geo.applyMatrix4(_m);
  return geo;
}

/** Normalise attributes so geometries from different sources can be merged: position, normal, uv (+ optional color). */
export function normalizeAttrs(g, withColor = false) {
  const keep = withColor ? ['position', 'normal', 'uv', 'color'] : ['position', 'normal', 'uv'];
  for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (withColor && !g.attributes.color) g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

/** Merge geometries (indexed or not) into one indexed-free geometry. Inputs are disposed. */
export function merge(list, withColor = false) {
  const gs = list.filter(Boolean).map((g) => {
    const x = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    return normalizeAttrs(x, withColor);
  });
  if (!gs.length) return new BufferGeometry();
  const out = mergeGeometries(gs, false);
  for (const g of gs) g.dispose();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Fill / bake vertex colours: fn(x, y, z, nx, ny, nz) -> [r, g, b] (or a constant triple). */
export function paint(g, fn) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = typeof fn === 'function' ? fn(p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0) : fn;
    arr[i * 3] = c[0];
    arr[i * 3 + 1] = c[1];
    arr[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new Float32BufferAttribute(arr, 3));
  return g;
}

/** Simple ellipse/circle disc in the xz plane (y up) with optional rings: used for liquid surfaces. */
export function disc(r, seg = 24, rings = 1, y = 0) {
  const pos = [0, y, 0];
  const nor = [0, 1, 0];
  const uv = [0.5, 0.5];
  const idx = [];
  for (let j = 1; j <= rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      const rr = (j / rings) * r;
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      nor.push(0, 1, 0);
      uv.push(0.5 + (Math.cos(a) * j) / rings / 2, 0.5 + (Math.sin(a) * j) / rings / 2);
    }
  }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
  for (let j = 1; j < rings; j++) {
    const a0 = 1 + (j - 1) * seg;
    const a1 = 1 + j * seg;
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg;
      idx.push(a0 + i, a0 + i2, a1 + i, a0 + i2, a1 + i2, a1 + i);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Polar grid disc (for the dosa): `ringsAt` are the normalised radii (ascending, last = 1), `seg` angular steps.
 * y = 0, normals +y, uv = xz / (2r) + 0.5.
 */
export function polarDisc(r, ringsAt, seg) {
  const pos = [0, 0, 0];
  const uv = [0.5, 0.5];
  const idx = [];
  for (const f of ringsAt) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      pos.push(Math.cos(a) * r * f, 0, Math.sin(a) * r * f);
      uv.push(0.5 + Math.cos(a) * f * 0.5, 0.5 + Math.sin(a) * f * 0.5);
    }
  }
  const nor = new Float32Array(pos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
  for (let j = 1; j < ringsAt.length; j++) {
    const a0 = 1 + (j - 1) * seg;
    const a1 = 1 + j * seg;
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg;
      idx.push(a0 + i, a0 + i2, a1 + i, a0 + i2, a1 + i2, a1 + i);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export const lerpV = (a, b, t) => a + (b - a) * t;
