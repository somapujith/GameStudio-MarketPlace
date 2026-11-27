// Static batching: a hand-built landmark is dozens of tiny Meshes (a minaret alone is a cylinder, rings, a dome, a cone, a chhatri...),
// each its own draw call in the camera pass AND in the shadow pass. Once a model is finished and never moves again, everything under
// it that shares a material (and the same shadow flags) can be baked into the model's local space and drawn as ONE mesh.
import { BufferAttribute, BufferGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = ['position', 'normal', 'uv'];
const KEEP_COLOR = ['position', 'normal', 'uv', 'color'];
const rel = new Matrix4();
const inv = new Matrix4();
const ctr = new Vector3();

/**
 * A copy of `geo` reduced to position / normal / uv (all non-indexed), with `m` baked in. Mirrored matrices get their winding flipped.
 * `keep` lists the attributes that survive (a vertex-coloured geometry keeps its `color` when asked: KEEP_COLOR).
 */
export function bakedCopy(geo, m, keep = KEEP) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.applyMatrix4(m);
  if (m.determinant() < 0) {
    // a mirror turns the triangles inside out: swap two vertices of every triangle in every attribute
    for (const name of keep) {
      const a = g.attributes[name];
      if (!a) continue;
      const s = a.itemSize;
      for (let t = 0; t < a.count; t += 3) {
        for (let k = 0; k < s; k++) {
          const i = (t + 1) * s + k;
          const j = (t + 2) * s + k;
          const tmp = a.array[i];
          a.array[i] = a.array[j];
          a.array[j] = tmp;
        }
      }
    }
  }
  return g;
}

/**
 * Colour baking: many hand-built models ask for the same few Lambert looks in dozens of colours. Parts whose material is a plain Lambert
 * (no map, no vertex colours, opaque) merge into ONE vertex-coloured material per (flat shading, side, emissive colour), their own colour
 * baked into the vertices. The registry keeps those shared materials, so every model of a world uses the same few.
 */
export function createBakeRegistry() {
  const map = new Map();
  const key = (m) => (m.isMeshLambertMaterial && !m.map && !m.vertexColors && !m.transparent && !m.alphaMap ? `${m.flatShading ? 1 : 0}|${m.side}|${m.emissive.getHex()}` : null);
  return {
    /** The shared vertex-coloured material standing in for `m`, or null when `m` cannot be baked. */
    materialFor(m) {
      const k = key(m);
      if (k === null) return null;
      let s = map.get(k);
      if (!s) {
        s = new MeshLambertMaterial({ vertexColors: true, flatShading: m.flatShading, side: m.side, emissive: m.emissive.clone(), emissiveIntensity: 0 });
        map.set(k, s);
      }
      return s;
    },
    get materials() {
      return [...map.values()];
    },
  };
}

/** Radius of the largest dimension of a mesh in the units of the merge root (rough: bounding sphere x the largest world scale). */
function worldRadius(mesh, root) {
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  rel.copy(inv.copy(root.matrixWorld).invert()).multiply(mesh.matrixWorld);
  const e = rel.elements;
  const s = Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
  return mesh.geometry.boundingSphere.radius * s;
}

/**
 * Merge every plain Mesh under `root` that shares a material, castShadow and receiveShadow into one Mesh per combination, in `root`'s own
 * local space. Instanced meshes, skinned meshes, multi-material meshes and anything with `userData.keep` stay as they are.
 *   opts.minShadowRadius  parts smaller than this (metres) stop casting a shadow (they cannot be seen in a 0.08 m / texel shadow map)
 *   opts.bake             a createBakeRegistry(): plain Lambert parts are merged across colours (see there)
 * Returns { before, after, meshes } (draw-call candidates before / after).
 */
export function mergeStaticMeshes(root, { minShadowRadius = 0, bake = null } = {}) {
  root.updateWorldMatrix(true, true);
  const groups = new Map();
  const doomed = [];
  let before = 0;
  root.traverse((o) => {
    if (o === root || !o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.userData.keep || !o.visible) return;
    before++;
    if (minShadowRadius > 0 && o.castShadow && worldRadius(o, root) < minShadowRadius) o.castShadow = false;
    const baked = bake ? bake.materialFor(o.material) : null;
    const material = baked || o.material;
    const key = `${material.uuid}|${o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}|${o.renderOrder}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { material, baked: !!baked, cast: o.castShadow, receive: o.receiveShadow, order: o.renderOrder, list: [] }));
    g.list.push(o);
  });
  const meshes = [];
  inv.copy(root.matrixWorld).invert();
  for (const g of groups.values()) {
    if (g.list.length < 2 && !g.baked) continue; // (a lone part that bakes into a shared vertex-coloured material still moves there: it merges with the others later)
    const parts = g.list.map((o) => {
      // a part that already carries vertex colours (a sign plane with its glow boost) keeps them; a baked one gets its material colour
      const p = bakedCopy(o.geometry, rel.copy(inv).multiply(o.matrixWorld), !g.baked && g.material.vertexColors ? KEEP_COLOR : KEEP);
      if (g.baked) {
        const n = p.attributes.position.count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([o.material.color.r, o.material.color.g, o.material.color.b], i * 3);
        p.setAttribute('color', new BufferAttribute(col, 3));
      }
      return p;
    });
    const geo = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!geo) continue;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new Mesh(geo, g.material);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    mesh.renderOrder = g.order;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    meshes.push(mesh);
    doomed.push(...g.list);
  }
  for (const o of doomed) {
    o.parent?.remove(o);
    o.geometry.dispose();
  }
  // drop the groups that are now empty
  const prune = (o) => {
    for (const c of [...o.children]) {
      prune(c);
      if (c.isGroup && c.children.length === 0) o.remove(c);
    }
  };
  prune(root);
  root.updateWorldMatrix(true, true); // the new meshes get their world matrix now (static objects are not recomputed afterwards)
  return { before, after: before - doomed.length + meshes.length, meshes };
}

/**
 * Second pass after `mergeStaticMeshes`: the meshes of every model under `root` that share a material (and shadow flags / render order) are
 * baked into `root`'s space and merged ACROSS models, one mesh per map tile (`tile` metres, by the mesh's centre). A mesh whose matrix is the
 * identity costs ~2 GL calls to draw (three skips the unchanged matrix uniforms), a mesh with its own matrix ~6, and merging also removes
 * whole draw calls: Charminar, Mecca Masjid and the cafe next to it are one set of draws instead of three.
 * Instanced, skinned, multi-material, `userData.keep`, blended (transparent) and invisible meshes are left alone.
 *
 * `shadowProxy`: the shadow pass replaces every material by a depth material, so which material a caster has is irrelevant to it, and
 * whether a part casts must not split the camera draws either. With the option the visible meshes of a tile never cast (so they merge
 * whatever their flag was) and ONE extra mesh per tile holds every caster (positions only, any material), on layer SHADOW_LAYER: the
 * camera does not see that layer, the sun's shadow camera does (render/sky.js enables it). A tile that cast through eight materials
 * is one shadow draw instead of eight.
 * Returns { before, after, meshes, proxies }.
 */
export const SHADOW_LAYER = 1;
let proxyMaterial = null;
export function mergeStaticTiles(root, { tile = 640, offset = 0, shadowProxy = false } = {}) {
  root.updateWorldMatrix(true, true);
  inv.copy(root.matrixWorld).invert();
  const groups = new Map();
  let before = 0;
  root.traverse((o) => {
    if (o === root || !o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.userData.keep || !o.visible) return;
    if (o.material.transparent) return; // blended parts are sorted by their own origin: a merged mesh at the origin would change the order
    before++;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    ctr.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
    const tk = `${Math.floor((ctr.x + offset) / tile)},${Math.floor((ctr.z + offset) / tile)}`; // (offset: shifts the grid, e.g. half a tile, so the city centre is not on a tile edge)
    const key = `${tk}|${o.material.uuid}|${shadowProxy ? 0 : o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}|${o.renderOrder}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { tile: tk, material: o.material, cast: shadowProxy ? false : o.castShadow, receive: o.receiveShadow, order: o.renderOrder, list: [] }));
    g.list.push(o);
  });
  const meshes = [];
  const doomed = [];
  const casters = new Map(); // tile -> baked caster geometries (shadowProxy)
  for (const g of groups.values()) {
    const parts = g.list.map((o) => bakedCopy(o.geometry, rel.copy(inv).multiply(o.matrixWorld), KEEP_COLOR));
    if (g.material.vertexColors) {
      for (const p of parts) {
        if (p.attributes.color) continue;
        p.setAttribute('color', new BufferAttribute(new Float32Array(p.attributes.position.count * 3).fill(1), 3));
      }
    }
    const geo = mergeGeometries(parts, false);
    if (!geo) {
      parts.forEach((p) => p.dispose());
      continue; // mismatched attributes: leave these meshes as they are
    }
    if (shadowProxy) {
      // the parts that cast: positions only (a depth material reads nothing else)
      g.list.forEach((o, i) => {
        if (!o.castShadow) return;
        const p = new BufferGeometry();
        p.setAttribute('position', parts[i].attributes.position);
        let list = casters.get(g.tile);
        if (!list) casters.set(g.tile, (list = []));
        list.push(p);
      });
    }
    // (the position attributes of the parts live on in the proxies: do not dispose them)
    if (!shadowProxy) parts.forEach((p) => p.dispose());
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new Mesh(geo, g.material);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    mesh.renderOrder = g.order;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    meshes.push(mesh);
    doomed.push(...g.list);
  }
  const proxies = [];
  for (const list of casters.values()) {
    const geo = mergeGeometries(list, false);
    if (!geo) continue;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    if (!proxyMaterial) proxyMaterial = new MeshBasicMaterial({ color: 0x000000 });
    const proxy = new Mesh(geo, proxyMaterial);
    proxy.name = 'shadow-proxy';
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.layers.set(SHADOW_LAYER);
    proxy.matrixAutoUpdate = false;
    root.add(proxy);
    proxies.push(proxy);
  }
  for (const o of doomed) {
    o.parent?.remove(o);
    o.geometry.dispose();
  }
  const prune = (o) => {
    for (const c of [...o.children]) {
      prune(c);
      if (c.isGroup && c.children.length === 0) o.remove(c);
    }
  };
  prune(root);
  root.updateWorldMatrix(true, true);
  return { before, after: before - doomed.length + meshes.length + proxies.length, meshes, proxies };
}

/** Bake the local matrix of every object under `root` and stop recomputing it each frame (the model never moves again). */
export function freezeMatrices(root) {
  root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  root.updateMatrixWorld(true);
}
