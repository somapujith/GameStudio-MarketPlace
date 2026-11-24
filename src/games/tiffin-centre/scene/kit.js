// Tiny modelling kit for the stall shell: tracked geometries / materials and one-line primitives.
import {
  BoxGeometry, CylinderGeometry, SphereGeometry, PlaneGeometry, TorusGeometry, ConeGeometry, Mesh, MeshStandardMaterial, MeshBasicMaterial,
  Group, BufferGeometry, Float32BufferAttribute, Color, SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function createKit(tr) {
  const T = (o) => tr.track(o);
  const geoCache = new Map();
  const geo = (key, make) => {
    if (!geoCache.has(key)) geoCache.set(key, T(make()));
    return geoCache.get(key);
  };
  const std = (color, o = {}) => T(new MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o }));
  const basic = (color, o = {}) => T(new MeshBasicMaterial({ color, ...o }));
  const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new BoxGeometry(w, h, d));
  const cyl = (rt, rb, h, seg = 16) => geo(`c${rt},${rb},${h},${seg}`, () => new CylinderGeometry(rt, rb, h, seg));
  const sph = (r, ws = 14, hs = 10) => geo(`s${r},${ws},${hs}`, () => new SphereGeometry(r, ws, hs));
  const plane = (w, h) => geo(`p${w},${h}`, () => new PlaneGeometry(w, h));
  const torus = (r, t, a = 8, b = 20) => geo(`t${r},${t},${a},${b}`, () => new TorusGeometry(r, t, a, b));
  const cone = (r, h, seg = 12) => geo(`n${r},${h},${seg}`, () => new ConeGeometry(r, h, seg));

  /** Mesh at a position, added to `parent` when given. */
  const put = (g, m, x = 0, y = 0, z = 0, parent = null) => {
    const o = new Mesh(g, m);
    o.position.set(x, y, z);
    parent?.add(o);
    return o;
  };

  /** Merge geometries (each already transformed) into one tracked geometry; all inputs are disposed. */
  const merge = (parts) => {
    const m = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    return T(m);
  };

  /** Paint every vertex of `g` with `color` (sRGB hex) so parts of different colours can be merged into one draw call. */
  const paint = (g, hex) => {
    const c = new Color().setStyle(hex, SRGBColorSpace);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new Float32BufferAttribute(arr, 3));
    return g;
  };

  const lineGeo = (pts) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3));
    return T(g);
  };

  return { T, geo, std, basic, box, cyl, sph, plane, torus, cone, put, merge, paint, lineGeo, Group };
}

/** Catenary-ish sag between two points (arrays), n+1 points. */
export function sagLine(a, b, sag, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * sag, a[2] + (b[2] - a[2]) * t]);
  }
  return pts;
}

/** Mark every standard-material mesh under `root` to cast / receive shadows. */
export function shade(root, cast = true, receive = true) {
  root.traverse((o) => {
    if (o.isMesh) {
      const m = o.material;
      const solid = m && !Array.isArray(m) ? m.isMeshStandardMaterial && !m.transparent : true;
      o.castShadow = cast && solid;
      o.receiveShadow = receive && solid;
    }
  });
}
