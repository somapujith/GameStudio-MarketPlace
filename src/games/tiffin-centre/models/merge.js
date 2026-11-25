// Draw-call reduction: merges STATIC sub-meshes of a model (a customer, the street, the stall shell) so the GPU gets a few big draws instead of
// hundreds of small ones. Nothing here knows what a mesh is for: staticness is MEASURED, not declared.
//
//   const probe = createStaticProbe(root);   // snapshot the world transforms / visibility / material values of every candidate mesh
//   ... drive the model through varied states (poses, expressions, hours, events) ...
//   const set = probe.finish();              // the meshes that never moved, never toggled and never changed material values
//   const r = mergeStatic(root, { only: set }) -> { before, after, dispose }
//
// What is merged: meshes of the same material (the same object, or an equivalent one whose values never changed during the probe) with the same
// shadow flags and render order, baked into the space of `root`. What is never merged: morph targets, skinned / instanced meshes, geometry that is
// rewritten per frame (frustumCulled === false: the IK limbs), anything with userData.noMerge, anything the probe saw move. `flatten` additionally
// replaces PBR-textured opaque materials by one shared vertex-coloured material per (side, roughness, metalness) class (the lite tier).
// Node-safe (three only); tests run it on plain boxes.
import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Matrix4, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const KEEP_ATTRS = ['position', 'normal', 'uv', 'uv1', 'color'];
const _m = new Matrix4();
const _inv = new Matrix4();

const worldVisible = (o) => {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};

/** A cheap, stable text signature of everything about a material that changes how it renders (not its uuid or name). */
export function materialSignature(m) {
  if (!m) return 'none';
  const parts = [m.type];
  for (const k of Object.keys(m)) {
    if (k[0] === '_' || k === 'uuid' || k === 'id' || k === 'name' || k === 'version' || k === 'userData' || k === 'needsUpdate' || k === 'listeners') continue;
    const v = m[k];
    if (v == null) continue;
    if (v.isColor) parts.push(`${k}:${v.getHexString()}`);
    else if (v.isTexture) parts.push(`${k}:${v.uuid}`);
    else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') parts.push(`${k}:${v}`);
    else if (v.isVector2 || v.isVector3) parts.push(`${k}:${v.toArray().join(',')}`);
  }
  return parts.join('|');
}

/** The values of a material that can change per frame (light, time of day, fades): used to tell a "stable" material from a live one. */
function liveValues(m) {
  const v = [m.opacity, m.visible ? 1 : 0, m.color ? m.color.getHex() : 0, m.emissive ? m.emissive.getHex() : 0, m.emissiveIntensity ?? 0, m.roughness ?? 0, m.metalness ?? 0];
  const u = m.uniforms;
  if (u) for (const k of Object.keys(u)) if (typeof u[k].value === 'number') v.push(u[k].value);
  return v.join(',');
}

const noMergeAbove = (o) => {
  for (let p = o; p; p = p.parent) if (p.userData?.noMerge) return true;
  return false;
};

const isCandidate = (o) => {
  if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) return false;
  if (Array.isArray(o.material) || !o.material || noMergeAbove(o)) return false;
  const g = o.geometry;
  if (!g || !g.attributes?.position) return false;
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return false;
  if (o.material.isShaderMaterial && !o.material.userData?.mergeable) return false;
  return true;
};

/**
 * Records, for every object under `root`, its LOCAL matrix and visibility, and for every candidate mesh its material values and a fingerprint of its
 * vertices. sample() is called between probe frames (finish() calls it once more). A node is DYNAMIC when its own local transform or visibility changed;
 * a mesh is mergeable when it is not dynamic itself, and it merges into the space of its FRAME: the lowest dynamic ancestor above it (or `root`), since
 * everything between the two is rigid. The result is a Set of meshes with `.frames` (Map mesh -> frame object) and `.liveMaterials`.
 */
export function createStaticProbe(root, opts = {}) {
  root.updateMatrixWorld(true);
  const nodes = new Map(); // object -> { e: local matrix elements, v: visible, dyn }
  const cands = new Map();
  root.traverse((o) => {
    nodes.set(o, { e: o.matrix.elements.slice(), v: o.visible, dyn: false });
    if (isCandidate(o) && worldVisible(o) && !opts.skip?.(o)) cands.set(o, { mat: o.material, live: liveValues(o.material), pos: sampleSum(o.geometry), moved: false });
  });
  const liveMats = new Set();
  const sample = () => {
    root.updateMatrixWorld(true);
    for (const [o, r] of nodes) {
      if (r.dyn) continue;
      if (o.visible !== r.v) {
        r.dyn = true;
        continue;
      }
      const e = o.matrix.elements;
      for (let i = 0; i < 16; i++) if (Math.abs(e[i] - r.e[i]) > 1e-6) { r.dyn = true; break; }
    }
    for (const [o, r] of cands) {
      if (o.material !== r.mat) r.moved = true;
      if (!r.moved && sampleSum(o.geometry) !== r.pos) r.moved = true;
      const lv = liveValues(o.material);
      if (lv !== r.live) {
        liveMats.add(o.material);
        r.live = lv;
      }
    }
  };
  return {
    size: cands.size,
    sample,
    finish() {
      sample();
      const out = new Set();
      out.frames = new Map();
      out.liveMaterials = liveMats;
      for (const [o, r] of cands) {
        if (r.moved || nodes.get(o).dyn) continue;
        let f = o.parent;
        while (f && f !== root && !nodes.get(f)?.dyn) f = f.parent;
        out.add(o);
        out.frames.set(o, f || root);
      }
      return out;
    },
  };
}

/** A cheap fingerprint of the vertex positions (catches CPU-deformed geometry that is not flagged). */
function sampleSum(g) {
  const a = g.attributes.position;
  const n = a.count;
  if (!n) return 0;
  const step = Math.max(1, Math.floor(n / 24));
  let s = 0;
  for (let i = 0; i < n; i += step) s += a.getX(i) * 1.3 + a.getY(i) * 1.7 + a.getZ(i) * 2.1;
  return Math.round(s * 1e5) / 1e5;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// flattening: a PBR-textured opaque material -> one vertex colour per vertex on a shared material
const flatCache = new Map();
const bin = (v, step) => Math.round((v ?? 0) / step) * step;

function meanTexel(tex, out) {
  const img = tex?.image;
  const d = img?.data;
  if (!d || !img.width || !img.height || d.length < 4) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const w = img.width;
  const h = img.height;
  const c = new Color();
  const srgb = tex.colorSpace === SRGBColorSpace;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const x = Math.min(w - 1, Math.floor(((i + 0.5) / 4) * w));
      const y = Math.min(h - 1, Math.floor(((j + 0.5) / 4) * h));
      const k = (y * w + x) * 4;
      const sc = d instanceof Float32Array || d instanceof Uint16Array ? 1 : 1 / 255;
      if (srgb) c.setRGB(d[k] * sc, d[k + 1] * sc, d[k + 2] * sc, SRGBColorSpace);
      else c.setRGB(d[k] * sc, d[k + 1] * sc, d[k + 2] * sc);
      r += c.r;
      g += c.g;
      b += c.b;
      n++;
    }
  }
  return out.setRGB(r / n, g / n, b / n);
}

/** Can this material be replaced by a flat vertex-coloured one without losing something the player reads (text, lights, transparency)? */
export function isFlattenable(m, liveMaterials) {
  if (!m || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshBasicMaterial || m.isMeshPhongMaterial)) return false;
  if (m.isShaderMaterial || m.transparent || m.alphaTest > 0 || m.alphaMap || m.opacity < 1) return false;
  if (m.emissiveMap || (m.emissive && m.emissive.getHex() !== 0 && (m.emissiveIntensity ?? 1) > 0)) return false;
  if (m.onBeforeCompile && String(m.onBeforeCompile).length > 60 && m.customProgramCacheKey) return false; // patched shaders (skin, food, flame)
  if (m.userData?.noFlatten) return false;
  if (liveMaterials?.has(m)) return false;
  if (m.map && m.map.isCanvasTexture) return false; // painted signs, banners, posters: the text is the point
  if (m.map && !m.map.image?.data) return false; // an unknown kind of texture
  return true;
}

function flatMaterialFor(m) {
  const key = `${m.side}|${bin(m.roughness ?? 0.7, 0.25)}|${bin(m.metalness ?? 0, 0.5)}|${m.isMeshBasicMaterial ? 1 : 0}`;
  let f = flatCache.get(key);
  if (!f) {
    f = new MeshStandardMaterial({ vertexColors: true, roughness: bin(m.roughness ?? 0.7, 0.25), metalness: bin(m.metalness ?? 0, 0.5), side: m.side });
    f.userData.shared = true;
    f.userData.flat = true;
    flatCache.set(key, f);
  }
  return f;
}
export const disposeFlatMaterials = () => {
  for (const f of flatCache.values()) f.dispose();
  flatCache.clear();
};

/** The class key of the shared baked material for `m`: side | roughness bin | metalness bin. */
export const flatMaterialKey = () => '2|0.7|0'; // ONE class: double sided, matte (a whole customer is one draw call)

const flatColor = (m, out) => {
  out.copy(m.color || new Color(1, 1, 1));
  if (m.map) {
    const t = new Color();
    if (meanTexel(m.map, t)) out.multiply(t);
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------
function prepared(mesh, frameInv, colour) {
  const src = mesh.geometry;
  let g = new BufferGeometry();
  for (const k of KEEP_ATTRS) {
    const a = src.attributes[k];
    if (a && !a.isInterleavedBufferAttribute) g.setAttribute(k, a.clone());
    else if (a) g.setAttribute(k, new Float32BufferAttribute(Array.from({ length: a.count * a.itemSize }, (_, i) => a.array[(i / a.itemSize | 0) * a.data.stride + a.offset + (i % a.itemSize)]), a.itemSize));
  }
  if (src.index) g.setIndex(new BufferAttribute(src.index.array.slice(), 1));
  else {
    const n = g.attributes.position.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new BufferAttribute(idx, 1));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  _m.multiplyMatrices(frameInv, mesh.matrixWorld);
  const flip = _m.determinant() < 0;
  g.applyMatrix4(_m);
  if (flip) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = t;
    }
  }
  if (colour) {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = colour.r;
      arr[i * 3 + 1] = colour.g;
      arr[i * 3 + 2] = colour.b;
    }
    g.setAttribute('color', new Float32BufferAttribute(arr, 3));
  } else if (g.attributes.color && g.attributes.color.itemSize !== 3) g.deleteAttribute('color');
  return g;
}

/** Makes every geometry in the list carry the same attribute set (the intersection), which mergeGeometries requires. */
function conform(list) {
  const names = KEEP_ATTRS.filter((k) => list.every((g) => g.attributes[k]));
  const all = new Set(list.flatMap((g) => Object.keys(g.attributes)));
  for (const g of list) {
    for (const k of all) if (!names.includes(k) || g.attributes[k]?.itemSize === undefined) g.deleteAttribute(k);
  }
}

/**
 * Merges the static candidates under `root`.
 * opts: { only: Set<Mesh> (from the probe; required), flatten, minGroup (default 2), shared (geometry cache check) }
 * Returns { before, after, groups, dispose }.
 */
export function* mergeStaticSteps(root, opts = {}) {
  const only = opts.only;
  if (!only || !only.size) return { before: 0, after: 0, groups: 0, dispose() {} };
  const minGroup = opts.minGroup ?? 2;
  const flatten = !!opts.flatten;
  const live = only.liveMaterials || new Set();
  root.updateMatrixWorld(true);
  const frames = only.frames || new Map();

  // 1. bucket
  const buckets = new Map();
  let before = 0;
  root.traverse((o) => {
    if (!only.has(o) || !isCandidate(o) || !worldVisible(o)) return;
    before++;
    const m = o.material;
    const flat = flatten && isFlattenable(m, live);
    // equivalent-but-distinct materials are merged only when none of them is live; otherwise the exact material object keeps its identity
    const matKey = flat ? `flat:${flatMaterialFor(m).uuid}` : live.has(m) || m.isShaderMaterial || m.onBeforeCompile?.toString().length > 60 ? `obj:${m.uuid}` : `sig:${materialSignature(m)}`;
    const frame = frames.get(o) || root;
    const key = `${frame.uuid}|${matKey}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}|${o.layers.mask}|${m.transparent ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { meshes: [], flat, frame, material: flat ? flatMaterialFor(m) : m }));
    b.meshes.push(o);
  });

  // 2. merge each bucket
  const made = [];
  const dropped = [];
  for (const b of buckets.values()) {
    if (b.meshes.length < minGroup) continue;
    const geos = [];
    const c = new Color();
    b.frame.updateWorldMatrix(true, false);
    const frameInv = _inv.copy(b.frame.matrixWorld).invert().clone();
    for (const mesh of b.meshes) {
      const g = prepared(mesh, frameInv, b.flat ? flatColor(mesh.material, c) : null);
      if (g) geos.push(g);
      else b.meshes = b.meshes.filter((x) => x !== mesh);
    }
    if (geos.length < minGroup) {
      for (const g of geos) g.dispose();
      continue;
    }
    // vertex colours only on materials that use them: a mixed bucket (some meshes with, some without) drops the attribute
    if (!b.flat && !geos.every((g) => g.attributes.color) ) for (const g of geos) g.deleteAttribute('color');
    conform(geos);
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const first = b.meshes[0];
    const mesh = new Mesh(merged, b.material);
    mesh.name = 'merged';
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.layers.mask = first.layers.mask;
    mesh.userData.merged = b.meshes.length;
    mesh.matrixAutoUpdate = false;
    b.frame.add(mesh);
    made.push(mesh);
    for (const o of b.meshes) dropped.push(o);
    yield; // one bucket per slice: the caller decides how many to run before giving the frame back
  }

  // 3. retire the originals (geometry shared with a mesh that stays is kept)
  const keepGeo = new Set();
  const drop = new Set(dropped);
  root.traverse((o) => {
    if (o.isMesh && !drop.has(o) && o.geometry) keepGeo.add(o.geometry);
  });
  const freed = [];
  const parents = new Map();
  for (const o of dropped) {
    parents.set(o, o.parent);
    o.removeFromParent();
    const g = o.geometry;
    if (g && !g.userData?.shared && !keepGeo.has(g)) freed.push(g);
  }
  for (const g of new Set(freed)) g.dispose(); // GPU buffers only: with keepOriginals the objects can still come back (three re-uploads on use)
  root.updateMatrixWorld(true);
  const after = before - dropped.length + made.length;
  return {
    before,
    after,
    groups: made.length,
    merged: made,
    /** Puts the original meshes back and removes the merged ones (only meaningful while the originals were kept). */
    restore() {
      for (const m of made) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      made.length = 0;
      for (const [o, p] of parents) p?.add(o);
      parents.clear();
    },
    dispose() {
      for (const m of made) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      made.length = 0;
      parents.clear();
    },
  };
}

/** Stops the nearest-to-nothing meshes of a model from casting shadows (eyes, lids, brows, glasses, fingers...): `size` is the bounding radius in metres. */
export function limitShadowCasters(root, maxRadius = 0.07) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const s = o.matrixWorld.getMaxScaleOnAxis();
    if ((o.geometry.boundingSphere?.radius || 0) * s < maxRadius) {
      // sync.js calls shade() after the build, which would set castShadow back: pin it
      Object.defineProperty(o, 'castShadow', { get: () => false, set() {}, configurable: true });
      n++;
    }
  });
  return n;
}

/**
 * Probe + merge in one call: `drive(sample)` must put the model through its states and call sample() after each (see createStaticProbe).
 * Returns the mergeStatic result.
 */
export function mergeModel(root, drive, opts = {}) {
  root.updateMatrixWorld(true);
  const probe = createStaticProbe(root);
  drive(probe.sample);
  const set = probe.finish();
  return mergeStatic(root, { ...opts, only: set });
}

export { flatColor as flatColorOf };

/** Runs mergeStaticSteps to completion. */
export function mergeStatic(root, opts = {}) {
  const g = mergeStaticSteps(root, opts);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}
