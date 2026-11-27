// Spatial chunking for instanced scenery. One InstancedMesh for the whole city can never be culled (its bounding sphere is the
// whole map), so every tree, lamp and building was drawn every frame, twice (view + shadow pass). Splitting each set into map tiles
// gives every tile its own bounding sphere, so the GPU only draws the few tiles near the camera.
import { InstancedMesh, Object3D, Color } from 'three';

/**
 * Tile size in metres. The frame is bound by draw calls (a draw is ~50 us of CPU through the browser and the driver; a box city of 700k triangles is nothing for
 * the GPU), so a tile is as BIG as culling still pays: the renderer sets it from the quality tier BEFORE the world is built (setChunkSize).
 */
export let CHUNK = 256;
export const setChunkSize = (n) => { CHUNK = Math.max(128, n | 0); };

/** Group items by map tile. `at(item)` -> [x, z]. */
export function groupByChunk(items, at, size = CHUNK) {
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

const o = new Object3D();
const c = new Color();

/**
 * Build one culled InstancedMesh per tile.
 *   place(item, o, color)  sets o.position / scale / rotation (and may set `color` to a Color to tint that instance)
 *   at(item) -> [x, z]     where the item stands
 * Returns the meshes (already added to `parent`). `opts`: castShadow, receiveShadow, size, onMesh(mesh, items).
 */
export function chunkedInstances(parent, geometry, material, items, at, place, opts = {}) {
  const meshes = [];
  if (!items.length) return meshes;
  for (const tile of groupByChunk(items, at, opts.size).values()) {
    const mesh = new InstancedMesh(geometry, material, tile.length);
    let tinted = false;
    tile.forEach((it, i) => {
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
      const tint = place(it, o, c);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
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
    if (opts.onMesh) opts.onMesh(mesh, tile);
    parent.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

export { Color };
