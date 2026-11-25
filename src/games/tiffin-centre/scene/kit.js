// Modelling kit for the stall shell and the street: tracked geometries / materials, one-line primitives and a BATCH builder that
// transforms primitives into place, maps their UVs in metres (so every surface has the same texel density) and merges them per material
// into a handful of draw calls.
import {
  BoxGeometry, CylinderGeometry, SphereGeometry, PlaneGeometry, TorusGeometry, ConeGeometry, Mesh, MeshStandardMaterial, MeshBasicMaterial,
  Group, BufferGeometry, Float32BufferAttribute, Color, SRGBColorSpace, Matrix4, Quaternion, Euler, Vector3, CatmullRomCurve3, TubeGeometry,
  CapsuleGeometry, LatheGeometry, Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);

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

  /** A PBR material from a bake bundle ({ map, normalMap, ormMap }); `color` tints the albedo (plaster, cloth). */
  const pbr = (b, o = {}) => {
    const m = std(o.color ?? '#ffffff', {
      map: b?.map || null,
      normalMap: b?.normalMap || null,
      roughnessMap: b?.ormMap || null,
      metalnessMap: b?.ormMap || null,
      roughness: o.roughness ?? 1,
      metalness: o.metalness ?? 1,
      ...(o.rest || {}),
    });
    if (b?.normalMap) m.normalScale = new Vector2(o.normal ?? 1, o.normal ?? 1);
    if (o.side !== undefined) m.side = o.side;
    if (o.transparent) m.transparent = true;
    if (o.alphaTest) m.alphaTest = o.alphaTest;
    if (o.vertexColors) m.vertexColors = true;
    if (o.envMapIntensity !== undefined) m.envMapIntensity = o.envMapIntensity;
    return m;
  };

  /** A batch: add transformed primitives with `mat`, then `build(parent)` merges them per material. */
  const batch = () => {
    const groups = new Map(); // material -> { geos: [], color: bool }
    const add = (mat, g, matrix, { tile = 1, off = [0, 0], cylUv = null, color = null } = {}) => {
      g.applyMatrix4(matrix);
      const pos = g.attributes.position;
      const nor = g.attributes.normal;
      const uv = g.attributes.uv;
      if (uv && tile > 0) {
        if (cylUv) {
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * cylUv[0] + off[0], uv.getY(i) * cylUv[1] + off[1]);
        } else {
          for (let i = 0; i < uv.count; i++) {
            const ax = Math.abs(nor.getX(i));
            const ay = Math.abs(nor.getY(i));
            const az = Math.abs(nor.getZ(i));
            let u;
            let v;
            if (ay >= ax && ay >= az) { u = pos.getX(i); v = pos.getZ(i); } else if (ax >= az) { u = pos.getZ(i); v = pos.getY(i); } else { u = pos.getX(i); v = pos.getY(i); }
            uv.setXY(i, u / tile + off[0], v / tile + off[1]);
          }
        }
      }
      if (color) {
        const c = new Color().setStyle(color, SRGBColorSpace);
        const arr = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        g.setAttribute('color', new Float32BufferAttribute(arr, 3));
      }
      if (!groups.has(mat)) groups.set(mat, { geos: [], color: false });
      const grp = groups.get(mat);
      if (color) grp.color = true;
      grp.geos.push(g);
      return g;
    };
    const xf = (pos, rot = [0, 0, 0], scl = null) => {
      _e.set(rot[0] || 0, rot[1] || 0, rot[2] || 0, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(pos[0], pos[1], pos[2]);
      if (scl) _s.set(scl[0], scl[1], scl[2]);
      else _s.set(1, 1, 1);
      return _m.compose(_p, _q, _s).clone();
    };
    const api = {
      /** box(mat, [w,h,d], [x,y,z], { rot:[rx,ry,rz], tile, off, color }) */
      box(mat, size, pos, o = {}) {
        return add(mat, new BoxGeometry(size[0], size[1], size[2]), xf(pos, o.rot), o);
      },
      cyl(mat, rt, rb, h, seg, pos, o = {}) {
        const circ = Math.PI * (rt + rb);
        const tile = o.tile || 1;
        return add(mat, new CylinderGeometry(rt, rb, h, seg), xf(pos, o.rot), { ...o, cylUv: o.cylUv || [Math.max(1, Math.round(circ / tile)), Math.max(1, h / tile)] });
      },
      sph(mat, r, ws, hs, pos, o = {}) {
        return add(mat, new SphereGeometry(r, ws, hs), xf(pos, o.rot, o.scale), { ...o, cylUv: [1, 1] });
      },
      torus(mat, r, t, a, b, pos, o = {}) {
        return add(mat, new TorusGeometry(r, t, a, b), xf(pos, o.rot, o.scale), { ...o, cylUv: [Math.max(1, Math.round((2 * Math.PI * r) / (o.tile || 1))), 1] });
      },
      plane(mat, w, h, pos, o = {}) {
        return add(mat, new PlaneGeometry(w, h), xf(pos, o.rot), o);
      },
      /** A stretched cylinder from point a to point b (poles, pipes, ropes), radius r. */
      rod(mat, a, b, r, seg = 6, o = {}) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dz = b[2] - a[2];
        const len = Math.hypot(dx, dy, dz);
        const g = new CylinderGeometry(r, o.r2 ?? r, len, seg);
        _q.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(dx / len, dy / len, dz / len));
        _m.compose(new Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new Vector3(1, 1, 1));
        return add(mat, g, _m.clone(), { ...o, cylUv: [Math.max(1, Math.round((2 * Math.PI * r) / (o.tile || 1))), Math.max(1, len / (o.tile || 1))] });
      },
      /** A thin tube along a Catmull-Rom path of points (cables, rope, hose). */
      tube(mat, points, r, tubular = 24, radial = 5, o = {}) {
        const curve = new CatmullRomCurve3(points.map((p) => new Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
        const g = new TubeGeometry(curve, tubular, r, radial, false);
        return add(mat, g, new Matrix4(), { ...o, cylUv: [1, 1] });
      },
      lathe(mat, pts, seg, pos, o = {}) {
        return add(mat, new LatheGeometry(pts.map((p) => new Vector2(p[0], p[1])), seg), xf(pos, o.rot, o.scale), { ...o, cylUv: [1, 1] });
      },
      capsule(mat, r, len, pos, o = {}) {
        return add(mat, new CapsuleGeometry(r, len, 4, 8), xf(pos, o.rot, o.scale), { ...o, cylUv: [1, 1] });
      },
      /** Any BufferGeometry, positioned (it is consumed). */
      geo(mat, g, pos = [0, 0, 0], o = {}) {
        return add(mat, g, xf(pos, o.rot, o.scale), { ...o, tile: o.tile ?? 0 });
      },
      /** Merge per material and add the meshes to `parent`. Returns the meshes. */
      build(parent, { cast = true, receive = true, name = '' } = {}) {
        const out = [];
        for (const [mat, grp] of groups) {
          if (!grp.geos.length) continue;
          if (grp.color) {
            for (const g of grp.geos) {
              if (g.attributes.color) continue;
              const arr = new Float32Array(g.attributes.position.count * 3).fill(1);
              g.setAttribute('color', new Float32BufferAttribute(arr, 3));
            }
            mat.vertexColors = true;
          }
          for (const g of grp.geos) {
            if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
            if (!g.attributes.normal) g.computeVertexNormals();
            g.deleteAttribute?.('uv1');
            if (g.index === null) g.setIndex([...Array(g.attributes.position.count).keys()]);
          }
          const merged = mergeGeometries(grp.geos, false);
          for (const g of grp.geos) g.dispose();
          if (!merged) continue;
          T(merged);
          const mesh = new Mesh(merged, mat);
          mesh.castShadow = cast && !mat.transparent;
          mesh.receiveShadow = receive && !mat.transparent;
          if (name) mesh.name = name;
          parent?.add(mesh);
          out.push(mesh);
        }
        groups.clear();
        return out;
      },
    };
    return api;
  };

  return { T, geo, std, basic, box, cyl, sph, plane, torus, cone, put, merge, paint, lineGeo, pbr, batch, Group };
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
