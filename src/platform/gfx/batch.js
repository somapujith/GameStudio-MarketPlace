// Static batching helpers over three.js (three only; Node-safe, no WebGL needed, so everything is unit-tested on small geometries).
//
// A draw call costs the CPU ~15-40 us (matrix + uniforms + state + the driver), whatever it draws, and a frame with 300-1400 of them is CPU bound on
// ordinary machines. These helpers turn many small static meshes into few big ones without changing a pixel:
//
//   mergeByMaterial(root, opts)        bake every static mesh under `root` into one mesh per (material, shadow flags, layer, tile): world matrix baked in,
//                                      normals / uv / uv1 / uv2 / colour kept, multi-material groups preserved, optional spatial tiling for culling
//   mergeMeshes(meshes, opts)          the primitive: one Mesh from meshes that share a material (or an identical material array)
//   mergeGeometries(geos)              the geometry merge itself (index-aware, attribute intersection, material groups kept)
//   freezeStatic(root)                 final updateMatrixWorld, then matrixAutoUpdate = matrixWorldAutoUpdate = false on the subtree, bounding volumes computed
//   tileInstances(parent, geo, mat, items, at, place)   a culled InstancedMesh per map tile (generalises Autowala's render/chunks.js: same signature)
//   instancesFromMeshes(root, opts)    meshes sharing geometry + material -> one InstancedMesh each
//   createInstances(geo, mat, matrices) a standalone InstancedMesh from matrices / colours
//   disposeTree(root, opts)            frees geometries, materials and their textures once each, skipping userData.shared; returns what it freed
//
// Rules of thumb: batch what NEVER moves (buildings, props, signs, shelves); instance what repeats with the SAME geometry; keep anything animated,
// skinned, morphed, or rewritten per frame out of it (userData.noMerge, or `skip`). Merging transparent geometry changes its sort order: it is
// excluded unless `includeTransparent`.
import {
  Box3, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, Mesh, Object3D, Sphere, Vector3,
} from 'three';

const _m = new Matrix4();
const _inv = new Matrix4();
const _v = new Vector3();
const _box = new Box3();

const OPTIONAL_ATTRS = ['normal', 'tangent', 'uv', 'uv1', 'uv2', 'uv3'];
const LIT = ['isMeshStandardMaterial', 'isMeshLambertMaterial', 'isMeshPhongMaterial', 'isMeshToonMaterial', 'isMeshMatcapMaterial'];
const needsNormals = (m) => !!m && LIT.some((k) => m[k]);

/** Component `c` of vertex `v`, de-interleaved and de-normalised (a Uint8 colour reads as 0..1). */
function comp(a, v, c) {
  return c === 0 ? a.getX(v) : c === 1 ? a.getY(v) : c === 2 ? a.getZ(v) : a.getW(v);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// geometry merge
/**
 * Merges geometries into ONE BufferGeometry.
 * Attributes: position always; normal / tangent / uv / uv1 / uv2 / uv3 only when EVERY source has them with the same item size (never guessed);
 * colour per `color`: 'all' (default: kept when every source has it), 'force' (kept, missing ones filled with white) or 'none'.
 * Indexed and non-indexed sources can be mixed; the result is indexed (Uint16 when it fits). Sources with material groups (a material array) keep them:
 * the output has one contiguous group per material index, ranges gathered across all sources, so N meshes with the same two materials still draw in 2 calls.
 */
export function mergeGeometries(geos, { color = 'all' } = {}) {
  if (!geos.length || geos.some((g) => !g?.attributes?.position)) return null;
  const names = ['position'];
  for (const n of OPTIONAL_ATTRS) {
    const first = geos[0].attributes[n];
    if (first && geos.every((g) => g.attributes[n] && g.attributes[n].itemSize === first.itemSize)) names.push(n);
  }
  if (color === 'force' || (color === 'all' && geos.every((g) => g.attributes.color))) names.push('color');

  let vertexCount = 0;
  for (const g of geos) vertexCount += g.attributes.position.count;
  const itemSize = {};
  const arrays = {};
  for (const n of names) {
    itemSize[n] = n === 'color' ? (geos.find((g) => g.attributes.color)?.attributes.color.itemSize ?? 3) : geos[0].attributes[n].itemSize;
    arrays[n] = new Float32Array(vertexCount * itemSize[n]);
  }

  // pass 1: attributes, and the index segments each source contributes to each material index
  const segments = []; // { mi, g, start, cnt, vertexOffset }
  const totals = new Map();
  let offset = 0;
  for (const g of geos) {
    const count = g.attributes.position.count;
    for (const n of names) {
      const dst = arrays[n];
      const size = itemSize[n];
      const a = g.attributes[n];
      if (a) {
        for (let v = 0; v < count; v++) for (let c = 0; c < size; c++) dst[(offset + v) * size + c] = c < a.itemSize ? comp(a, v, c) : n === 'color' ? 1 : 0;
      } else dst.fill(1, offset * size, (offset + count) * size); // only 'color' can be missing here
    }
    const total = g.index ? g.index.count : count;
    const add = (mi, start, cnt) => {
      if (cnt <= 0) return;
      segments.push({ mi, g, start, cnt, vertexOffset: offset });
      totals.set(mi, (totals.get(mi) || 0) + cnt);
    };
    if (g.groups.length) for (const gr of g.groups) add(gr.materialIndex ?? 0, gr.start, Math.min(gr.count, total - gr.start));
    else add(0, 0, total);
    offset += count;
  }

  // pass 2: the index, written in material-index order so every group is one contiguous range
  const mis = [...totals.keys()].sort((a, b) => a - b);
  const grandTotal = [...totals.values()].reduce((s, v) => s + v, 0);
  const index = vertexCount < 65536 ? new Uint16Array(grandTotal) : new Uint32Array(grandTotal);
  const out = new BufferGeometry();
  for (const n of names) out.setAttribute(n, new BufferAttribute(arrays[n], itemSize[n]));
  const single = mis.length === 1 && !geos.some((g) => g.groups.length);
  let p = 0;
  for (const mi of mis) {
    const start = p;
    for (const s of segments) {
      if (s.mi !== mi) continue;
      const idx = s.g.index;
      for (let k = 0; k < s.cnt; k++) index[p++] = (idx ? idx.getX(s.start + k) : s.start + k) + s.vertexOffset;
    }
    if (!single) out.addGroup(start, p - start, mi);
  }
  out.setIndex(new BufferAttribute(index, 1));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// baking
/**
 * A new geometry holding `mesh`'s attributes (position, normal, tangent, uv..uv3, colour) transformed by `matrix` (the mesh's world matrix relative to the
 * merge frame). Normals are computed when the material is lit and the source has none. Winding is flipped for mirrored (negative-determinant) transforms.
 */
export function bakeGeometry(mesh, matrix) {
  const src = mesh.geometry;
  const g = new BufferGeometry();
  for (const n of ['position', ...OPTIONAL_ATTRS, 'color']) {
    const a = src.attributes[n];
    if (!a) continue;
    if (a.isInterleavedBufferAttribute) {
      const arr = new Float32Array(a.count * a.itemSize);
      for (let v = 0; v < a.count; v++) for (let c = 0; c < a.itemSize; c++) arr[v * a.itemSize + c] = comp(a, v, c);
      g.setAttribute(n, new BufferAttribute(arr, a.itemSize));
    } else g.setAttribute(n, a.clone());
  }
  if (src.index) g.setIndex(new BufferAttribute(src.index.array.slice(), 1));
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  if (!g.attributes.normal) {
    const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (needsNormals(m)) g.computeVertexNormals();
  }
  g.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    if (!g.index) {
      const n = g.attributes.position.count;
      const idx = n < 65536 ? new Uint16Array(n) : new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new BufferAttribute(idx, 1));
    }
    const arr = g.index.array;
    for (let i = 0; i + 2 < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
  }
  return g;
}

/**
 * One Mesh from `meshes` (all sharing `opts.material`, or the first mesh's). Everything is baked into the space of `opts.frame` (default: world space);
 * the new mesh has an identity transform. Returns the Mesh (not added to anything) or null when nothing is mergeable.
 */
export function mergeMeshes(meshes, opts = {}) {
  const list = meshes.filter((m) => m?.isMesh && m.geometry?.attributes?.position);
  if (!list.length) return null;
  _inv.identity();
  if (opts.frame) {
    opts.frame.updateWorldMatrix(true, false);
    _inv.copy(opts.frame.matrixWorld).invert();
  }
  const material = opts.material || list[0].material;
  const vertexColors = Array.isArray(material) ? material.some((m) => m.vertexColors) : !!material.vertexColors;
  const baked = list.map((mesh) => {
    mesh.updateWorldMatrix(true, false);
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
    const g = bakeGeometry(mesh, _m);
    if (!Array.isArray(mesh.material)) g.clearGroups(); // one material: all its indices belong to material index 0
    return g;
  });
  const merged = mergeGeometries(baked, { color: vertexColors ? 'force' : 'none' });
  for (const g of baked) g.dispose();
  if (!merged) return null;
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  const first = list[0];
  const out = new Mesh(merged, material);
  out.name = opts.name || 'merged';
  out.castShadow = first.castShadow;
  out.receiveShadow = first.receiveShadow;
  out.renderOrder = first.renderOrder;
  out.layers.mask = first.layers.mask;
  out.userData.merged = list.length;
  out.matrixAutoUpdate = false;
  out.updateMatrix();
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// merge a whole tree
const worldVisible = (o) => {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};
const noMergeAbove = (o) => {
  for (let p = o; p; p = p.parent) if (p.userData?.noMerge) return true;
  return false;
};

/** A stable text signature of a material's rendering-relevant values (not its uuid or name): lets equivalent-but-distinct materials merge. */
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

/**
 * Bakes every STATIC mesh under `root` into few big meshes, one per (material, shadow flags, render order, layers, tile).
 * opts:
 *   frame            the space to bake into and where the merged meshes are added (default `root`)
 *   include(mesh)    extra filter (false = leave the mesh alone); `skip(mesh)` is the inverse
 *   minGroup (2)     buckets smaller than this are left untouched
 *   bySignature      merge equivalent materials that are distinct objects (the first one becomes the shared material)
 *   tileSize         metres: also split buckets by the map tile of the mesh's world position, so frustum culling still bites; 0 = one mesh per bucket
 *   tileAxes         'xz' (default, a flat map) or 'xyz'
 *   maxVertices      split a bucket whose merged vertex count would exceed this (default 200000)
 *   includeTransparent, includeHidden   (both false by default: draw order and visibility semantics stay intact)
 *   disposeOriginals free the source geometries nothing else uses (default false: the originals can be restored)
 * Never merged: skinned, instanced and morph-target meshes, ShaderMaterial (unless material.userData.mergeable), userData.noMerge (own or ancestor).
 * Returns { before, after, groups, merged: Mesh[], removed: Mesh[], restore(), dispose() }.
 */
export function mergeByMaterial(root, opts = {}) {
  const frame = opts.frame || root;
  const minGroup = opts.minGroup ?? 2;
  const maxVertices = opts.maxVertices ?? 200000;
  const tile = opts.tileSize > 0 ? opts.tileSize : 0;
  const xyz = opts.tileAxes === 'xyz';
  root.updateMatrixWorld(true);
  const buckets = new Map();
  let before = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh) return;
    const g = o.geometry;
    if (!g?.attributes?.position) return;
    if (g.morphAttributes && Object.keys(g.morphAttributes).length) return;
    if (noMergeAbove(o)) return;
    if (!opts.includeHidden && !worldVisible(o)) return;
    if (opts.include && !opts.include(o)) return;
    if (opts.skip && opts.skip(o)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => !m || (m.isShaderMaterial && !m.userData?.mergeable))) return;
    if (!opts.includeTransparent && mats.some((m) => m.transparent)) return;
    before++;
    const matKey = mats.map((m) => (opts.bySignature ? `s:${materialSignature(m)}` : m.uuid)).join('+');
    let tk = '';
    if (tile) {
      if (!g.boundingSphere) g.computeBoundingSphere();
      _v.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);
      tk = `${Math.floor(_v.x / tile)},${xyz ? `${Math.floor(_v.y / tile)},` : ''}${Math.floor(_v.z / tile)}`;
    }
    const key = `${matKey}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}|${o.layers.mask}|${Array.isArray(o.material) ? 'A' : 'S'}|${tk}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { meshes: [], material: o.material }));
    b.meshes.push(o);
  });

  const made = [];
  const dropped = [];
  for (const b of buckets.values()) {
    if (b.meshes.length < minGroup) continue;
    let chunk = [];
    let verts = 0;
    const flush = () => {
      if (chunk.length >= minGroup) {
        const mesh = mergeMeshes(chunk, { material: b.material, frame });
        if (mesh) {
          frame.add(mesh);
          made.push(mesh);
          for (const o of chunk) dropped.push(o);
        }
      }
      chunk = [];
      verts = 0;
    };
    for (const o of b.meshes) {
      const n = o.geometry.attributes.position.count;
      if (verts + n > maxVertices && chunk.length) flush();
      chunk.push(o);
      verts += n;
    }
    flush();
  }
  const parents = new Map();
  const drop = new Set(dropped);
  const keepGeo = new Set();
  root.traverse((o) => {
    if (o.isMesh && !drop.has(o) && o.geometry) keepGeo.add(o.geometry);
  });
  for (const o of dropped) {
    parents.set(o, o.parent);
    o.removeFromParent();
  }
  if (opts.disposeOriginals) for (const g of new Set(dropped.map((o) => o.geometry))) if (g && !g.userData?.shared && !keepGeo.has(g)) g.dispose();
  root.updateMatrixWorld(true);
  const removeMerged = () => {
    for (const m of made) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    made.length = 0;
  };
  return {
    before,
    after: before - dropped.length + made.length,
    groups: made.length,
    merged: made,
    removed: dropped,
    /** Puts the original meshes back and removes the merged ones. */
    restore() {
      removeMerged();
      for (const [o, p] of parents) p?.add(o);
      parents.clear();
    },
    dispose() {
      removeMerged();
      parents.clear();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// freezing
/**
 * Marks a subtree as final: one last updateMatrixWorld, then matrixAutoUpdate = false and matrixWorldAutoUpdate = false on every node, bounding spheres
 * computed for every geometry that lacks one (frustum culling needs them; computing them lazily costs a frame at first sight). Frozen nodes cost only the
 * traversal in scene.updateMatrixWorld(); fewer nodes (merge / instance) is the real saving. Move one later with thaw(node), set the transform, freezeStatic(node).
 * Returns { nodes, meshes, bounded }.
 */
export function freezeStatic(root, { bounds = true } = {}) {
  root.updateMatrixWorld(true);
  let nodes = 0;
  let meshes = 0;
  let bounded = 0;
  root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    o.matrixWorldAutoUpdate = false;
    nodes++;
    if (o.isMesh || o.isLine || o.isPoints) {
      meshes++;
      if (bounds && o.geometry && !o.geometry.boundingSphere) {
        o.geometry.computeBoundingSphere();
        bounded++;
      }
      if (bounds && o.isInstancedMesh && !o.boundingSphere) o.computeBoundingSphere();
    }
  });
  return { nodes, meshes, bounded };
}

/** The inverse of freezeStatic for one subtree (call before moving something). */
export function thaw(root) {
  root.traverse((o) => {
    o.matrixAutoUpdate = true;
    o.matrixWorldAutoUpdate = true;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// spatial tiling + instancing
/** Groups items by map tile. `at(item)` -> [x, z]. */
export function groupByTile(items, at, size = 256) {
  const tiles = new Map();
  for (const it of items) {
    const [x, z] = at(it);
    const k = `${Math.floor(x / size)},${Math.floor(z / size)}`;
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = []));
    t.push(it);
  }
  return tiles;
}

const _o = new Object3D();
const _c = new Color();

/**
 * One culled InstancedMesh per tile (generalises Autowala render/chunks.js chunkedInstances; same arguments).
 *   place(item, o, color)  set o.position / scale / rotation; return a Color (or set `color` and return it) to tint that instance
 *   at(item) -> [x, z]     where the item stands
 * opts: { castShadow, receiveShadow, size (tile size, 256), onMesh(mesh, items), freeze (default true: matrixAutoUpdate off) }.
 * Returns the meshes (already added to `parent`). Each has its own bounding sphere, so a tile outside the view costs nothing.
 */
export function tileInstances(parent, geometry, material, items, at, place, opts = {}) {
  const meshes = [];
  if (!items.length) return meshes;
  for (const tileItems of groupByTile(items, at, opts.size).values()) {
    const mesh = new InstancedMesh(geometry, material, tileItems.length);
    let tinted = false;
    tileItems.forEach((it, i) => {
      _o.position.set(0, 0, 0);
      _o.rotation.set(0, 0, 0);
      _o.quaternion.identity();
      _o.scale.set(1, 1, 1);
      const tint = place(it, _o, _c);
      _o.updateMatrix();
      mesh.setMatrixAt(i, _o.matrix);
      if (tint) {
        mesh.setColorAt(i, tint);
        tinted = true;
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !!opts.castShadow;
    mesh.receiveShadow = opts.receiveShadow !== false;
    mesh.frustumCulled = true;
    mesh.computeBoundingSphere();
    if (opts.freeze !== false) {
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
    }
    if (opts.onMesh) opts.onMesh(mesh, tileItems);
    parent.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

/**
 * Tiles ALREADY-BUILT meshes spatially: merges per (material, tile) so each result has its own bounding sphere and culling works on a big static scene.
 * A named wrapper over mergeByMaterial with a tile size.
 */
export function tileMeshes(root, size, opts = {}) {
  return mergeByMaterial(root, { ...opts, tileSize: size });
}

/**
 * Meshes that share BOTH geometry and material become one InstancedMesh each (positions from their world matrices relative to `frame`).
 * Groups smaller than `minCount` are left alone. opts: { frame (root), minCount (3), tileSize (0), include, removeOriginals (true) }.
 * Returns { instanced: InstancedMesh[], removed: Mesh[] }.
 */
export function instancesFromMeshes(root, opts = {}) {
  const frame = opts.frame || root;
  const minCount = opts.minCount ?? 3;
  const tile = opts.tileSize > 0 ? opts.tileSize : 0;
  root.updateMatrixWorld(true);
  frame.updateWorldMatrix(true, false);
  _inv.copy(frame.matrixWorld).invert();
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.material || noMergeAbove(o) || !worldVisible(o)) return;
    if (opts.include && !opts.include(o)) return;
    let tk = '';
    if (tile) {
      _v.setFromMatrixPosition(o.matrixWorld);
      tk = `${Math.floor(_v.x / tile)},${Math.floor(_v.z / tile)}`;
    }
    const key = `${o.geometry.uuid}|${o.material.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${o.renderOrder}|${tk}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(o);
  });
  const instanced = [];
  const removed = [];
  for (const list of groups.values()) {
    if (list.length < minCount) continue;
    const first = list[0];
    const mesh = new InstancedMesh(first.geometry, first.material, list.length);
    list.forEach((o, i) => {
      _m.multiplyMatrices(_inv, o.matrixWorld);
      mesh.setMatrixAt(i, _m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.layers.mask = first.layers.mask;
    mesh.matrixAutoUpdate = false;
    mesh.computeBoundingSphere();
    mesh.userData.instancedFrom = list.length;
    frame.add(mesh);
    instanced.push(mesh);
    for (const o of list) removed.push(o);
  }
  if (opts.removeOriginals !== false) for (const o of removed) o.removeFromParent();
  root.updateMatrixWorld(true);
  return { instanced, removed };
}

/** A standalone InstancedMesh from matrices (a flat array of 16n numbers, Matrix4[] or Object3D[]) with optional per-instance colours (Color[] or hex[]). */
export function createInstances(geometry, material, transforms, { colors = null, castShadow = false, receiveShadow = true, dynamic = false, name = 'instances' } = {}) {
  const flat = transforms.length > 0 && typeof transforms[0] === 'number';
  const n = flat ? transforms.length / 16 : transforms.length;
  const mesh = new InstancedMesh(geometry, material, n);
  for (let i = 0; i < n; i++) {
    if (flat) _m.fromArray(transforms, i * 16);
    else {
      const t = transforms[i];
      if (t.isMatrix4) _m.copy(t);
      else {
        t.updateMatrix();
        _m.copy(t.matrix);
      }
    }
    mesh.setMatrixAt(i, _m);
    if (colors) mesh.setColorAt(i, colors[i]?.isColor ? colors[i] : _c.set(colors[i] ?? 0xffffff));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (colors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (dynamic) mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  else mesh.matrixAutoUpdate = false;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.name = name;
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// disposal
/**
 * Frees every geometry, material and texture under `root` exactly once. Skips anything flagged userData.shared (module-level caches) and anything in
 * `keep` (a Set). Handles material arrays, InstancedMesh buffers, light shadow maps and ShaderMaterial uniform textures. `detach` also removes the
 * children from their parents. Returns { geometries, materials, textures, skipped } counts. Safe to call twice.
 */
export function disposeTree(root, { keep = null, textures = true, detach = false } = {}) {
  const seen = new Set();
  const stats = { geometries: 0, materials: 0, textures: 0, skipped: 0 };
  const release = (obj, counter, extra) => {
    if (!obj || seen.has(obj)) return;
    seen.add(obj);
    if (keep?.has(obj) || obj.userData?.shared) {
      stats.skipped++;
      return;
    }
    extra?.(obj);
    obj.dispose?.();
    stats[counter]++;
  };
  const freeTexture = (t) => t?.isTexture && release(t, 'textures');
  const freeMaterial = (m) => release(m, 'materials', (mat) => {
    if (!textures) return;
    for (const v of Object.values(mat)) if (v && v.isTexture) freeTexture(v);
    if (mat.uniforms) for (const u of Object.values(mat.uniforms)) if (u?.value?.isTexture) freeTexture(u.value);
  });
  const list = [];
  root.traverse((o) => list.push(o));
  for (const o of list) {
    release(o.geometry, 'geometries');
    if (o.material) Array.isArray(o.material) ? o.material.forEach(freeMaterial) : freeMaterial(o.material);
    if (o.isInstancedMesh) o.dispose?.();
    if (o.shadow?.map) o.shadow.map.dispose();
  }
  if (detach) for (const o of list) if (o !== root) o.removeFromParent?.();
  return stats;
}

/** A bounding Sphere of everything under `root`, in world space (for tiling and culling decisions). */
export function boundsOf(root) {
  root.updateMatrixWorld(true);
  _box.makeEmpty();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return _box.getBoundingSphere(new Sphere());
}
