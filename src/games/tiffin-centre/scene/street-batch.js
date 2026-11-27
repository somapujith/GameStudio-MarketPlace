// One BatchedMesh for many instanced kinds. The street drew every vehicle type, the parked scooters and the pedestrians' torsos and legs as an InstancedMesh each
// (a body and a lamp mesh per kind in view: 18 draw calls for the traffic of a medium frame). They all share ONE material per role (the tinted body material, the
// lamp material), so a BatchedMesh draws them in one multi-draw call (WEBGL_multi_draw; three.js falls back to a draw per geometry without it).
//
//   const { mesh, slots } = createInstanceBatch(material, [{ geometry, count }, ...])
//   slots[i].setMatrixAt(k, matrix) / setColorAt(k, color) / instanceMatrix.needsUpdate = true   <- the InstancedMesh calls the street code already makes
//
// A slot is the small part of the InstancedMesh API the street uses, mapped onto the instance ids of the part it stands for. Several parts may share a geometry
// (the two legs): the geometry is added once, each part gets its own instances. Every geometry must carry the same attributes and be indexed (or not) alike: the
// kit's merged geometries do (position, normal, uv, colour, non-indexed); createInstanceBatch throws a plain error otherwise.
import { BatchedMesh } from 'three';

export function createInstanceBatch(material, parts) {
  const unique = [];
  for (const p of parts) if (!unique.includes(p.geometry)) unique.push(p.geometry);
  let vertices = 0;
  let indices = 0;
  for (const g of unique) {
    vertices += g.attributes.position.count;
    indices += g.index ? g.index.count : 0;
  }
  const instances = parts.reduce((s, p) => s + p.count, 0);
  const mesh = new BatchedMesh(Math.max(1, instances), Math.max(1, vertices), Math.max(1, indices), material);
  // the instances move every frame and are few: cull each of them by its own sphere, but do not sort (everything here is opaque, drawn in any order)
  mesh.perObjectFrustumCulled = true;
  mesh.sortObjects = false;
  mesh.frustumCulled = false; // the batch's own sphere would have to be recomputed as the traffic moves
  mesh.castShadow = false;
  const ids = new Map();
  for (const g of unique) ids.set(g, mesh.addGeometry(g));
  const slots = parts.map((p) => {
    const geometryId = ids.get(p.geometry);
    const list = [];
    for (let i = 0; i < p.count; i++) list.push(mesh.addInstance(geometryId));
    const slot = {
      isBatchSlot: true,
      mesh,
      geometryId,
      instanceIds: list,
      count: p.count,
      setMatrixAt(i, matrix) {
        mesh.setMatrixAt(list[i], matrix);
      },
      setColorAt(i, color) {
        mesh.setColorAt(list[i], color);
      },
      // the InstancedMesh fields the street code touches: the batch uploads its own textures when an instance changes, so these are no-ops
      instanceMatrix: { needsUpdate: false, setUsage() {} },
      instanceColor: { needsUpdate: false },
      dispose() {},
    };
    return slot;
  });
  return { mesh, slots };
}
