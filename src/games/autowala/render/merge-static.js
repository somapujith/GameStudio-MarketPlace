// Static batching: a hand-built landmark is dozens of tiny Meshes (a minaret alone is a cylinder, rings, a dome, a cone, a chhatri...),
// each its own draw call in the camera pass AND in the shadow pass. Once a model is finished and never moves again, everything under
// it that shares a material (and the same shadow flags) can be baked into the model's local space and drawn as ONE mesh.
import { BufferAttribute, Matrix4, Mesh, MeshLambertMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = ['position', 'normal', 'uv'];
const rel = new Matrix4();
const inv = new Matrix4();

/** A copy of `geo` reduced to position / normal / uv (all non-indexed), with `m` baked in. Mirrored matrices get their winding flipped. */
export function bakedCopy(geo, m) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (!KEEP.includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.applyMatrix4(m);
  if (m.determinant() < 0) {
    // a mirror turns the triangles inside out: swap two vertices of every triangle in every attribute
    for (const name of KEEP) {
      const a = g.attributes[name];
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
    if (g.list.length < 2) continue;
    const parts = g.list.map((o) => {
      const p = bakedCopy(o.geometry, rel.copy(inv).multiply(o.matrixWorld));
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

/** Bake the local matrix of every object under `root` and stop recomputing it each frame (the model never moves again). */
export function freezeMatrices(root) {
  root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  root.updateMatrixWorld(true);
}
