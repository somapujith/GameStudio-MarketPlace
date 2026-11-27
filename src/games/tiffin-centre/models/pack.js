// PACKED people: one person (a customer, the cook) is a handful of draw calls instead of 60.
//
// A person is built as a rig of ~70 small meshes (a skin loft per limb, a mesh per garment, the hair, the eyes, the lids ...), most of them rewritten on the
// CPU every frame (limbs, hands, cloth) or deformed by morph targets (the face), each with its own material instance and uniforms. That is 60 draw calls and
// 26 more in the shadow pass for ONE customer. Packing leaves the rig alone (it still drives the same scene-graph nodes and geometries) and adds, per
// shading class, ONE dynamic mesh that the rig's meshes are written into every frame (position, normal, and for the skin / hair / eye shaders the rest-frame
// position they evaluate their procedural detail from). The rig's own meshes are RETIRED: `isMesh` is shadowed by false, so three.js neither draws, nor
// shadows, nor compiles them, while they stay Object3D nodes (their matrices are still updated, which is where the transforms come from).
//
//   skin   every skin part with the person's shared uniforms (the live flush / wrinkles / mouth uniforms are the same objects): aRest, aMode, aEdge
//   eye    both eyeballs (the gaze rotation is a transform of the part): aRest is the local position
//   hair   scalp, cards, brows, moustache, beard: colour in the vertex colours (the CPU applies the brow morph targets)
//   uber   every plain, untextured, opaque standard material (clothes, shoes, glasses frames, the tiffin carrier ...): colour + roughness / metalness in
//          vertex attributes, the same shared "uber" material the stall's static scenery uses (no new program)
//   own    anything else (a patterned garment, a flat-shaded prop): one mesh per material, the material itself is shared
//
// What stays live: transparent things (lenses, steam, the patience ring), emissive props, `userData.noMerge` / `noPack` subtrees (the phone, the note, a
// plate), the face skin (13 morph targets run on the GPU: 725 vertices are not worth a CPU morph) and everything added after the pack was built.
// Hidden parts (the teeth when the mouth is shut) are collapsed to a point in the buffer. Node-safe (three only); tests run it on real customers.
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, Matrix3, Matrix4, Mesh, Sphere, Vector3 } from 'three';
import { uberMaterialFor } from './merge.js';
import { createPackedEyeMaterial, createPackedHairMaterial, createPackedSkinMaterial } from './skin.js';

const _inv = new Matrix4();
const _rel = new Matrix4();
const _nm = new Matrix3();

const noPackAbove = (o, root) => {
  for (let p = o; p; p = p.parent) {
    if (p.userData?.noMerge || p.userData?.noPack) return true;
    if (p === root) break;
  }
  return false;
};

const UBER_MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'envMap', 'bumpMap', 'displacementMap', 'lightMap'];
const plainStandard = (m) => {
  if (!m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.flatShading || m.vertexColors) return false;
  for (const k of UBER_MAPS) if (m[k]) return false;
  if (m.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 1) > 0) return false;
  if (m.onBeforeCompile && String(m.onBeforeCompile).length > 60) return false; // patched shaders keep their own program
  return true;
};

let nextId = 1;
const ids = new WeakMap();
const idOf = (o) => {
  let v = ids.get(o);
  if (!v) ids.set(o, (v = nextId++));
  return v;
};

/** Which bucket a mesh packs into: { cls, key } or null (it stays a live mesh). Exported for the tests and the census. */
export function classifyForPack(o, root) {
  if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isPoints || o.isLine || o.isSprite) return null;
  const m = o.material;
  if (!m || Array.isArray(m) || o.renderOrder !== 0 || noPackAbove(o, root)) return null;
  const g = o.geometry;
  const pa = g?.attributes?.position;
  if (!pa || pa.isInterleavedBufferAttribute || g.attributes.normal?.isInterleavedBufferAttribute) return null;
  if (m.alphaTest > 0 || m.visible === false || m.isShaderMaterial || m.isLineBasicMaterial || m.isPointsMaterial || m.isSpriteMaterial) return null;
  const translucent = m.transparent || m.opacity < 1; // lenses: packed by material (one mesh for both), never into the opaque classes
  const morph = g.morphAttributes?.position;
  if (translucent) return m.isMeshStandardMaterial || m.isMeshBasicMaterial ? { cls: 'own', key: `own:${idOf(m)}` } : null;
  if (m.userData?.skin) {
    if (morph?.length) return null; // the face: the GPU does its morph targets
    return { cls: 'skin', key: `skin:${idOf(m.userData.skin.uSssTint || m.userData.skin)}` };
  }
  if (m.userData?.eye) return { cls: 'eye', key: `eye:${idOf(m.userData.eye)}` };
  if (m.userData?.hair) return { cls: 'hair', key: `hair:${m.customProgramCacheKey?.().includes(':1') ? 'cards' : 'cap'}` };
  if (plainStandard(m)) return { cls: 'uber', key: `uber:${uberMaterialFor(m, 2).uuid}` };
  if (!(m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return null;
  return { cls: 'own', key: `own:${idOf(m)}` };
}

const arr = (a) => (a ? a.array : null);

/**
 * packPerson(root, opts) -> { update(), dispose(), meshes, stats } or null when nothing packs.
 * `root` is the person's group (customer.group, person.group): the packed meshes are its children, in its local frame. Call update() every frame after the rig has
 * been updated (it refreshes the world matrices of root's subtree itself); it is cheap for parts that did not move.
 * opts: { skip(mesh) -> bool keeps a mesh live, castShadow (true), receiveShadow (true), bounds: Sphere }
 */
export function packPerson(root, opts = {}) {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const srcs = [];
  root.traverse((o) => {
    if (opts.skip?.(o)) return;
    const c = classifyForPack(o, root);
    if (!c) return;
    srcs.push({ mesh: o, cls: c.cls, key: c.key });
  });
  if (!srcs.length) return null;

  const buckets = new Map();
  for (const s of srcs) {
    let b = buckets.get(s.key);
    if (!b) buckets.set(s.key, (b = { cls: s.cls, key: s.key, srcs: [] }));
    b.srcs.push(s);
  }

  const bounds = opts.bounds || new Sphere(new Vector3(0, 0.95, 0), 1.7);
  const outs = [];
  const retired = [];
  const stats = { sources: srcs.length, meshes: 0, vertices: 0 };

  for (const b of buckets.values()) {
    const first = b.srcs[0].mesh;
    const m0 = first.material;
    let nv = 0;
    let ni = 0;
    let hasUv = b.cls === 'hair';
    let hasColor = b.cls === 'uber' || b.cls === 'hair' || (b.cls === 'own' && m0.vertexColors);
    for (const s of b.srcs) {
      const g = s.mesh.geometry;
      s.geo = g;
      s.n = g.attributes.position.count;
      s.ni = g.index ? g.index.count : s.n;
      s.off = nv;
      nv += s.n;
      ni += s.ni;
      if (b.cls === 'own' && g.attributes.uv) hasUv = true;
    }
    const lit = !(m0.isMeshBasicMaterial && b.cls === 'own');
    const pos = new Float32Array(nv * 3);
    const nor = lit ? new Float32Array(nv * 3) : null;
    const col = hasColor ? new Float32Array(nv * 3) : null;
    const uv = hasUv ? new Float32Array(nv * 2) : null;
    const rm = b.cls === 'uber' ? new Float32Array(nv * 2) : null;
    const edge = b.cls === 'skin' || b.cls === 'hair' ? new Float32Array(nv) : null;
    const rest = b.cls === 'skin' || b.cls === 'hair' || b.cls === 'eye' ? new Float32Array(nv * 3) : null;
    const mode = b.cls === 'skin' ? new Float32Array(nv) : null;
    const idx = nv < 65535 ? new Uint16Array(ni) : new Uint32Array(ni);
    let io = 0;
    for (const s of b.srcs) {
      const g = s.geo;
      const m = s.mesh.material;
      if (lit && !g.attributes.normal) g.computeVertexNormals();
      s.normal = lit ? arr(g.attributes.normal) : null;
      // winding: a mirrored part (the left hand) flips its triangles, and so does it in the packed buffer
      s.mesh.updateWorldMatrix(true, false);
      _rel.multiplyMatrices(_inv, s.mesh.matrixWorld);
      s.flip = _rel.determinant() < 0;
      const ix = g.index ? g.index.array : null;
      for (let i = 0; i < s.ni; i += 3) {
        const a = ix ? ix[i] : i;
        const bb = ix ? ix[i + 1] : i + 1;
        const c = ix ? ix[i + 2] : i + 2;
        idx[io++] = s.off + a;
        idx[io++] = s.off + (s.flip ? c : bb);
        idx[io++] = s.off + (s.flip ? bb : c);
      }
      if (col) {
        const own = g.attributes.color && g.attributes.color.itemSize >= 3 && !g.attributes.color.isInterleavedBufferAttribute && m.vertexColors ? g.attributes.color : null;
        const mc = m.color;
        for (let i = 0; i < s.n; i++) {
          const o3 = (s.off + i) * 3;
          if (b.cls === 'own') {
            col[o3] = own ? own.getX(i) : 1;
            col[o3 + 1] = own ? own.getY(i) : 1;
            col[o3 + 2] = own ? own.getZ(i) : 1;
          } else {
            col[o3] = mc.r;
            col[o3 + 1] = mc.g;
            col[o3 + 2] = mc.b;
          }
        }
      }
      if (uv) {
        const a = g.attributes.uv;
        if (a) uv.set(a.array.subarray(0, s.n * 2), s.off * 2);
      }
      if (rm) {
        for (let i = 0; i < s.n; i++) {
          rm[(s.off + i) * 2] = m.roughness;
          rm[(s.off + i) * 2 + 1] = m.metalness;
        }
      }
      if (edge) {
        const a = g.attributes.aEdge;
        if (a) edge.set(a.array.subarray(0, s.n), s.off);
      }
      if (mode) {
        const v = m.userData.skin.uMode ? m.userData.skin.uMode.value : 0;
        mode.fill(v, s.off, s.off + s.n);
        s.restOff = m.userData.skin.uRestOff ? m.userData.skin.uRestOff.value : null;
      }
      // morph targets (relative deltas): applied on the CPU for the parts that carry them (brows, moustache, beard)
      const morphs = g.morphAttributes?.position;
      if (morphs && morphs.length && s.mesh.morphTargetInfluences) {
        s.morphArrays = morphs.map((a) => a.array);
        s.infl = s.mesh.morphTargetInfluences;
        s.mAct = new Array(morphs.length);
        s.mW = new Float32Array(morphs.length);
        s.relative = g.morphTargetsRelative !== false;
      }
      s.last = new Float64Array(16);
      s.lastVer = -1;
      s.lastSig = Number.NaN;
      s.shown = false;
      s.chain = [];
      for (let p = s.mesh; p; p = p.parent) {
        s.chain.push(p);
        if (p === root) break;
      }
    }

    const geo = new BufferGeometry();
    const pa = new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', pa);
    let na = null;
    if (nor) {
      na = new BufferAttribute(nor, 3).setUsage(DynamicDrawUsage);
      geo.setAttribute('normal', na);
    }
    if (col) geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    if (uv) geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    if (rm) geo.setAttribute('aRM', new Float32BufferAttribute(rm, 2));
    if (edge) geo.setAttribute('aEdge', new Float32BufferAttribute(edge, 1));
    let ra = null;
    if (rest) {
      ra = new BufferAttribute(rest, 3).setUsage(DynamicDrawUsage);
      geo.setAttribute('aRest', ra);
    }
    if (mode) geo.setAttribute('aMode', new Float32BufferAttribute(mode, 1));
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.boundingSphere = bounds.clone();
    geo.userData.packed = true;

    let material;
    let ownMaterial = true;
    if (b.cls === 'skin') material = createPackedSkinMaterial(m0);
    else if (b.cls === 'eye') material = createPackedEyeMaterial(m0);
    else if (b.cls === 'hair') {
      let shine = 0.15;
      if (typeof m0.roughness === 'number') shine = (0.55 - m0.roughness) / 0.3;
      material = createPackedHairMaterial({ shine, alphaCards: m0.customProgramCacheKey?.().includes(':1') });
    } else if (b.cls === 'uber') {
      material = uberMaterialFor(m0, 2); // a person's plain parts are all double sided (closed shells: no visible difference), so ONE draw
      ownMaterial = false;
    } else {
      material = m0;
      ownMaterial = false;
    }
    const mesh = new Mesh(geo, material);
    mesh.name = `packed-${b.cls}`;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = opts.castShadow !== false && !m0.isMeshBasicMaterial && !m0.transparent;
    mesh.receiveShadow = !m0.isMeshBasicMaterial && !m0.transparent && opts.receiveShadow !== false;
    mesh.frustumCulled = !opts.noCull;
    root.add(mesh);
    outs.push({ b, mesh, geo, pa, na, ra, material, ownMaterial, srcs: b.srcs, dirty: true });
    stats.meshes++;
    stats.vertices += nv;
  }
  // retire the rig's own meshes: not drawn, not shadowed, not compiled; still nodes of the graph (their world matrices feed the packed buffers)
  for (const s of srcs) {
    s.mesh.isMesh = false; // three sets it per instance in the constructor: shadowing it is enough (and dispose puts it back)
    retired.push(s.mesh);
  }

  const tmpCtr = { v: 0 };
  void tmpCtr;

  function writeSource(o, s) {
    const sp = s.geo.attributes.position.array;
    const sn = s.normal;
    const P = o.pa.array;
    const N = o.na ? o.na.array : null;
    const e = _rel.elements;
    _nm.getNormalMatrix(_rel);
    const nm = _nm.elements;
    let na = 0;
    if (s.morphArrays) {
      for (let k = 0; k < s.morphArrays.length; k++) {
        const w = s.infl[k];
        if (w) {
          s.mAct[na] = s.morphArrays[k];
          s.mW[na++] = w;
        }
      }
    }
    for (let i = 0, n3 = s.n * 3, o3 = s.off * 3; i < n3; i += 3, o3 += 3) {
      let x = sp[i];
      let y = sp[i + 1];
      let z = sp[i + 2];
      for (let k = 0; k < na; k++) {
        const ma = s.mAct[k];
        const w = s.mW[k];
        x += ma[i] * w;
        y += ma[i + 1] * w;
        z += ma[i + 2] * w;
      }
      P[o3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P[o3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P[o3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (N && sn) {
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
  /** aRest of a source: its local (un-morphed) rest position, plus the part's frame offset for skin. */
  function writeRest(o, s) {
    const R = o.ra.array;
    const sp = s.geo.attributes.position.array;
    const ro = s.restOff;
    const ox = ro ? ro.x : 0;
    const oy = ro ? ro.y : 0;
    const oz = ro ? ro.z : 0;
    for (let i = 0, n3 = s.n * 3, o3 = s.off * 3; i < n3; i += 3, o3 += 3) {
      R[o3] = sp[i] + ox;
      R[o3 + 1] = sp[i + 1] + oy;
      R[o3 + 2] = sp[i + 2] + oz;
    }
  }
  function hide(o, s) {
    o.pa.array.fill(0, s.off * 3, (s.off + s.n) * 3);
  }

  const api = {
    meshes: outs.map((o) => o.mesh),
    stats,
    /** The buckets (for tests and the census): { cls, mesh, srcs: [{ mesh, off, n, shown }] }. */
    outs,
    /** Refresh the packed buffers from the rig. Call once per frame after the rig's own update. */
    update() {
      root.updateMatrixWorld(true);
      _inv.copy(root.matrixWorld).invert();
      for (const o of outs) {
        let any = false;
        let touchedPos = false;
        let touchedRest = false;
        for (const s of o.srcs) {
          let vis = true;
          for (let i = 0; i < s.chain.length; i++) {
            if (!s.chain[i].visible) {
              vis = false;
              break;
            }
          }
          if (!vis) {
            if (s.shown) {
              hide(o, s);
              s.shown = false;
              touchedPos = true;
            }
            continue;
          }
          any = true;
          _rel.multiplyMatrices(_inv, s.mesh.matrixWorld);
          const el = _rel.elements;
          let changed = !s.shown;
          for (let i = 0; i < 16 && !changed; i++) if (Math.abs(el[i] - s.last[i]) > 1e-7) changed = true;
          const ver = s.geo.attributes.position.version;
          if (ver !== s.lastVer) changed = true;
          let sig = 0;
          if (s.infl) {
            for (let k = 0; k < s.infl.length; k++) sig += s.infl[k] * (k + 1);
            if (sig !== s.lastSig) changed = true;
          }
          if (s.normal && s.geo.attributes.normal.version !== s.lastNVer) changed = true;
          if (!changed) continue;
          writeSource(o, s);
          if (o.ra && (ver !== s.lastVer || !s.shown)) {
            writeRest(o, s);
            touchedRest = true;
          }
          for (let i = 0; i < 16; i++) s.last[i] = el[i];
          s.lastVer = ver;
          s.lastSig = sig;
          if (s.normal) s.lastNVer = s.geo.attributes.normal.version;
          s.shown = true;
          touchedPos = true;
        }
        if (touchedPos) {
          o.pa.needsUpdate = true;
          if (o.na) o.na.needsUpdate = true;
        }
        if (touchedRest && o.ra) o.ra.needsUpdate = true;
        if (o.mesh.visible !== any) o.mesh.visible = any;
      }
    },
    dispose() {
      for (const m of retired) m.isMesh = true;
      for (const o of outs) {
        o.mesh.removeFromParent();
        o.geo.dispose();
        if (o.ownMaterial) o.material.dispose();
      }
      outs.length = 0;
      retired.length = 0;
    },
  };
  api.update();
  return api;
}
