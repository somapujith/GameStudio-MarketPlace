// The lite tier's people: a full rig (bodies.js IK limbs, face morphs, clothes) drives a BAKED proxy. Every few frames the rig is posed, its
// meshes are transformed on the CPU (morph targets included) into a handful of shared vertex-coloured dynamic geometries, and the rig's own
// meshes stay hidden. A customer or cook is then 1 to 3 draw calls instead of 50 to 100, expressions and poses still read (the bake follows the rig),
// and only the flat-shaded look and the lower animation rate (2 to 15 Hz depending on the mood) are given up.
//
//   const baked = bakeRig(api, { roots: [person.group, ...], skip: (mesh) => bool })     // api.update is wrapped (throttled) in place
//   baked.rebake()   baked.dispose()   baked.meshes
//
// Node-safe (three only). Tests run it on a real customer.
import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Float32BufferAttribute, Matrix3, Matrix4, Mesh, MeshStandardMaterial, SphereGeometry, Sphere, Vector3 } from 'three';
import { flatMaterialKey, flatColorOf } from './merge.js';

const _inv = new Matrix4();
const _m = new Matrix4();
const _n = new Matrix3();
const _v = new Vector3();

// mood -> bake rate in Hz: the waiting stance only breathes, the others move their arms
const RATE = { waiting: 4, eating: 10, paying: 8, happy: 15, angry: 12, walkaway: 15 };
const matCache = new Map();
function bakedMaterial(key) {
  let m = matCache.get(key);
  if (!m) {
    const [side, rough, metal] = key.split('|').map(Number);
    m = new MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, side });
    m.userData.shared = true;
    m.userData.baked = true;
    matCache.set(key, m);
  }
  return m;
}
export const disposeBakedMaterials = () => {
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
};

/** A coloured eye sphere for the bake (sclera, iris, pupil by the angle from the gaze axis +z). */
function eyeGeometry(eyeUniforms) {
  const g = new SphereGeometry(1, 14, 12);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const sc = eyeUniforms?.uSclera?.value || new Color('#f1ebe4');
  const ia = eyeUniforms?.uIrisA?.value || new Color('#2c180c');
  const ib = eyeUniforms?.uIrisB?.value || new Color('#6a4422');
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    // SphereGeometry's pole is +y: the gaze axis of the eye is +z, so measure the angle from +z
    const psi = Math.acos(Math.max(-1, Math.min(1, pos.getZ(i))));
    if (psi < 0.2) c.set('#0a0705');
    else if (psi < 0.5) c.copy(ia).lerp(ib, (psi - 0.2) / 0.3);
    else c.copy(sc).multiplyScalar(psi > 1.4 ? 0.85 : 1);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

const hiddenUp = (o) => {
  for (let p = o; p; p = p.parent) if (!p.visible) return true;
  return false;
};

/**
 * Bakes the meshes under `roots` that are visible and flat-colourable into shared dynamic geometries (one per side / roughness / metalness class).
 * opts: { skip(mesh) -> bool keeps a mesh live (held props, emissive things), rate(mood) -> Hz, mood() -> string }
 */
export function bakeRig(api, opts = {}) {
  const root = api.group;
  const roots = opts.roots || [root];
  root.updateMatrixWorld(true);
  const sources = [];
  for (const r of roots) {
    r.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || hiddenUp(o) || !o.geometry?.attributes?.position) return;
      if (o.userData?.noBake || o.userData?.noMerge || Array.isArray(o.material)) return;
      if (opts.skip?.(o)) return;
      const m = o.material;
      if (m && m.transparent && m.opacity < 0.4 && !m.isShaderMaterial) {
        o.visible = false; // spectacle lenses and the like: no lite draw call for glass
        return;
      }
      if (!m || m.transparent || m.opacity < 1 || m.alphaTest > 0 || m.isShaderMaterial) return;
      if (m.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 1) > 0) return;
      const eye = /^eye-[LR]$/.test(o.parent?.name || '') && m.userData?.eye;
      sources.push({ mesh: o, eye: eye ? m.userData.eye : null, color: eye ? null : flatColorOf(m, new Color()), key: flatMaterialKey(m) });
    });
  }
  // bucket by material class
  const buckets = new Map();
  for (const s of sources) {
    if (!buckets.has(s.key)) buckets.set(s.key, []);
    buckets.get(s.key).push(s);
  }
  const outs = [];
  const sphere = new Sphere(new Vector3(0, 1, 0), 3);
  for (const [key, list] of buckets) {
    let nv = 0;
    let ni = 0;
    for (const s of list) {
      s.geo = s.eye ? eyeGeometry(s.eye) : s.mesh.geometry; // the iris colours are per person: every eye gets its own coloured sphere
      if (s.eye) {
        s.ownGeo = true;
        s.mesh.geometry.computeBoundingSphere();
        s.radius = s.mesh.geometry.boundingSphere.radius || 0.012;
      }
      s.off = nv;
      s.n = s.geo.attributes.position.count;
      s.ni = s.geo.index ? s.geo.index.count : s.n;
      nv += s.n;
      ni += s.ni;
    }
    const pos = new Float32Array(nv * 3);
    const nor = new Float32Array(nv * 3);
    const col = new Float32Array(nv * 3);
    const idx = new Uint32Array(ni);
    let io = 0;
    for (const s of list) {
      const g = s.geo;
      if (s.eye) {
        const c = g.attributes.color;
        col.set(c.array, s.off * 3);
      } else {
        for (let i = 0; i < s.n; i++) {
          col[(s.off + i) * 3] = s.color.r;
          col[(s.off + i) * 3 + 1] = s.color.g;
          col[(s.off + i) * 3 + 2] = s.color.b;
        }
      }
      // winding: a mirrored transform flips the triangles
      s.mesh.updateWorldMatrix(true, false);
      _m.multiplyMatrices(_inv.copy(root.matrixWorld).invert(), s.mesh.matrixWorld);
      s.flip = _m.determinant() < 0;
      const ix = g.index ? g.index.array : null;
      for (let i = 0; i < s.ni; i += 3) {
        const a = ix ? ix[i] : i;
        const b = ix ? ix[i + 1] : i + 1;
        const c = ix ? ix[i + 2] : i + 2;
        idx[io++] = s.off + a;
        idx[io++] = s.off + (s.flip ? c : b);
        idx[io++] = s.off + (s.flip ? b : c);
      }
    }
    const geo = new BufferGeometry();
    const pa = new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage);
    const na = new BufferAttribute(nor, 3).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', pa);
    geo.setAttribute('normal', na);
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.boundingSphere = sphere.clone();
    geo.userData.baked = true;
    const mesh = new Mesh(geo, bakedMaterial(key));
    mesh.name = 'baked';
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    outs.push({ mesh, geo, list, pa, na });
  }
  for (const s of sources) s.mesh.visible = false;

  const rebake = () => {
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    for (const o of outs) {
      const P = o.pa.array;
      const N = o.na.array;
      for (const s of o.list) {
        const mesh = s.mesh;
        _m.multiplyMatrices(_inv, mesh.matrixWorld);
        _n.getNormalMatrix(_m);
        const g = s.geo;
        const sa = g.attributes.position.array;
        const sn = g.attributes.normal ? g.attributes.normal.array : null;
        const morphs = !s.eye && g.morphAttributes && g.morphAttributes.position;
        const infl = mesh.morphTargetInfluences;
        // active morph targets only (a handful of the ~10-40 are non-zero at any time)
        let active = null;
        if (morphs && infl) {
          for (let k = 0; k < morphs.length; k++) {
            if (infl[k]) (active ||= []).push([morphs[k].array, infl[k]]);
          }
        }
        const e = _m.elements;
        const nm = _n.elements;
        const k0 = s.eye ? s.radius : 1;
        for (let i = 0, n3 = s.n * 3, o3 = s.off * 3; i < n3; i += 3, o3 += 3) {
          let x = sa[i];
          let y = sa[i + 1];
          let z = sa[i + 2];
          if (active) {
            for (let k = 0; k < active.length; k++) {
              const ma = active[k][0];
              const w = active[k][1];
              x += ma[i] * w;
              y += ma[i + 1] * w;
              z += ma[i + 2] * w;
            }
          }
          x *= k0;
          y *= k0;
          z *= k0;
          P[o3] = e[0] * x + e[4] * y + e[8] * z + e[12];
          P[o3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          P[o3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          if (sn) {
            const ax = sn[i];
            const ay = sn[i + 1];
            const az = sn[i + 2];
            const nx = nm[0] * ax + nm[3] * ay + nm[6] * az;
            const ny = nm[1] * ax + nm[4] * ay + nm[7] * az;
            const nz = nm[2] * ax + nm[5] * ay + nm[8] * az;
            const il = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
            N[o3] = nx * il;
            N[o3 + 1] = ny * il;
            N[o3 + 2] = nz * il;
          }
        }
      }
      o.pa.needsUpdate = true;
      o.na.needsUpdate = true;
    }
  };

  // throttle the rig: its own update runs at the mood's rate, the bake follows each run
  const raw = api.update.bind(api);
  const moodOf = opts.mood || (() => api.mood || 'waiting');
  const rateOf = opts.rate || ((m) => RATE[m] || 8);
  let acc = 1;
  let force = true;
  api.update = (dt, t) => {
    acc += Math.max(0, dt || 0);
    const hz = rateOf(moodOf());
    if (!force && acc < 1 / hz) return;
    raw(Math.min(acc, 0.1), t);
    acc = 0;
    force = false;
    rebake();
  };
  // mood / expression changes show at once
  for (const fn of ['setMood', 'setExpression', 'setSpeaking', 'setPose', 'setHands']) {
    const orig = api[fn];
    if (typeof orig === 'function') {
      api[fn] = (...a) => {
        force = true;
        return orig.apply(api, a);
      };
    }
  }
  rebake();
  return {
    meshes: outs.map((o) => o.mesh),
    sources: sources.length,
    rebake,
    dispose() {
      for (const o of outs) {
        o.mesh.removeFromParent();
        o.geo.dispose();
        for (const s of o.list) if (s.ownGeo) s.geo.dispose();
      }
      outs.length = 0;
    },
  };
}
