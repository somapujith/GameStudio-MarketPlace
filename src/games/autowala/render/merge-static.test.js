import { describe, expect, it } from 'vitest';
import { BoxGeometry, Box3, Vector3, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, CylinderGeometry } from 'three';
import { bakedCopy, freezeMatrices, mergeStaticMeshes } from './merge-static.js';

const mat = (c) => new MeshStandardMaterial({ color: c });

function model() {
  const g = new Group();
  g.position.set(100, 0, -40);
  g.rotation.y = 0.7;
  const a = mat('#ff0000');
  const b = mat('#00ff00');
  const sub = new Group();
  sub.position.set(0, 5, 0);
  sub.scale.setScalar(2);
  g.add(sub);
  const parts = [
    [new BoxGeometry(2, 2, 2), a, [0, 1, 0], true],
    [new BoxGeometry(1, 1, 1), a, [4, 0.5, 0], true],
    [new CylinderGeometry(0.3, 0.3, 4, 8), a, [-4, 2, 1], true],
    [new BoxGeometry(0.2, 0.2, 0.2), a, [0, 9, 0], true], // tiny: should stop casting
    [new BoxGeometry(3, 1, 3), b, [0, 0.5, 6], true],
  ];
  for (const [geo, m, p, cast] of parts) {
    const mesh = new Mesh(geo, m);
    mesh.position.set(...p);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    (p[1] > 8 ? sub : g).add(mesh);
  }
  const inst = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 3);
  g.add(inst);
  const keep = new Mesh(new BoxGeometry(1, 1, 1), a);
  keep.userData.keep = true;
  g.add(keep);
  return g;
}

const worldBox = (g) => {
  g.updateWorldMatrix(true, true);
  const box = new Box3();
  g.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const p = o.geometry.attributes.position;
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  });
  return box;
};

describe('mergeStaticMeshes', () => {
  it('merges same-material parts into one mesh per material and flags', () => {
    const g = model();
    const r = mergeStaticMeshes(g, { minShadowRadius: 0.5 });
    const meshes = [];
    g.traverse((o) => o.isMesh && !o.isInstancedMesh && meshes.push(o));
    // red casters merged (3), red tiny non-caster stays alone (1 part: not merged), green alone, kept one, instanced untouched
    expect(r.before).toBe(5);
    expect(r.after).toBeLessThan(r.before);
    const merged = r.meshes;
    expect(merged.length).toBe(1);
    expect(merged[0].castShadow).toBe(true);
    expect(g.children.some((c) => c.isInstancedMesh)).toBe(true);
    expect(meshes.some((m) => m.userData.keep)).toBe(true);
  });

  it('keeps every vertex where it was (world-space bounds unchanged)', () => {
    const g = model();
    const before = worldBox(g);
    mergeStaticMeshes(g, { minShadowRadius: 0 });
    const after = worldBox(g);
    for (const k of ['x', 'y', 'z']) {
      expect(after.min[k]).toBeCloseTo(before.min[k], 4);
      expect(after.max[k]).toBeCloseTo(before.max[k], 4);
    }
  });

  it('stops tiny parts from casting shadows', () => {
    const g = model();
    mergeStaticMeshes(g, { minShadowRadius: 0.5 });
    const tiny = [];
    g.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh && !o.castShadow && o.receiveShadow && o.geometry.boundingSphere && o.geometry.boundingSphere.radius < 0.3) tiny.push(o);
    });
    expect(tiny.length).toBe(1);
  });

  it('freezes matrices', () => {
    const g = model();
    mergeStaticMeshes(g);
    freezeMatrices(g);
    let auto = 0;
    g.traverse((o) => {
      if (o.matrixAutoUpdate) auto++;
    });
    expect(auto).toBe(0);
  });
});

describe('bakedCopy', () => {
  it('flips the winding of a mirrored copy and keeps position / normal / uv', () => {
    const geo = new BoxGeometry(1, 1, 1);
    const m = new Mesh(geo);
    m.scale.set(-1, 1, 1);
    m.updateMatrix();
    const g = bakedCopy(geo, m.matrix);
    expect(Object.keys(g.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    expect(g.attributes.position.count).toBe(36);
    // first triangle's geometric normal must still agree with its stored normal (outward)
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const e1 = [p.getX(1) - p.getX(0), p.getY(1) - p.getY(0), p.getZ(1) - p.getZ(0)];
    const e2 = [p.getX(2) - p.getX(0), p.getY(2) - p.getY(0), p.getZ(2) - p.getZ(0)];
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const dot = c[0] * n.getX(0) + c[1] * n.getY(0) + c[2] * n.getZ(0);
    expect(dot).toBeGreaterThan(0);
  });
});
