import { describe, expect, it } from 'vitest';
import { BoxGeometry, Box3, Vector3, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, CylinderGeometry } from 'three';
import { bakedCopy, createBakeRegistry, freezeMatrices, mergeStaticMeshes } from './merge-static.js';

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

describe('colour baking', () => {
  const lam = (c, o = {}) => new MeshLambertMaterial({ color: c, ...o });
  function painted() {
    const g = new Group();
    for (const [i, c] of ['#ff0000', '#00ff00', '#0000ff', '#ffff00'].entries()) {
      const m = new Mesh(new BoxGeometry(1, 1, 1), lam(c));
      m.position.set(i * 2, 0.5, 0);
      m.castShadow = true;
      g.add(m);
    }
    const shiny = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: '#ffffff', metalness: 0.8, roughness: 0.2 }));
    const shiny2 = new Mesh(new BoxGeometry(1, 1, 1), shiny.material);
    shiny2.position.x = 5;
    g.add(shiny, shiny2);
    return g;
  }

  it('merges plain Lambert parts of different colours into ONE vertex-coloured mesh and leaves PBR parts alone', () => {
    const g = painted();
    const bake = createBakeRegistry();
    const r = mergeStaticMeshes(g, { bake });
    expect(r.meshes.length).toBe(2); // the baked Lambert mesh + the shared-material PBR mesh
    const baked = r.meshes.find((m) => m.material.isMeshLambertMaterial);
    expect(baked.material.vertexColors).toBe(true);
    const col = baked.geometry.getAttribute('color');
    expect(col.count).toBe(4 * 36);
    const distinct = new Set(Array.from({ length: col.count }, (_, i) => `${col.getX(i).toFixed(3)},${col.getY(i).toFixed(3)},${col.getZ(i).toFixed(3)}`));
    expect(distinct.size).toBe(4);
    expect(r.meshes.find((m) => m.material.isMeshStandardMaterial).material.metalness).toBe(0.8);
  });

  it('shares the baked material between models and keeps flat-shaded / emissive looks apart', () => {
    const bake = createBakeRegistry();
    const a = bake.materialFor(lam('#aa0000'));
    const b = bake.materialFor(lam('#00aa00'));
    expect(a).toBe(b);
    expect(bake.materialFor(lam('#aa0000', { flatShading: true }))).not.toBe(a);
    const glow = lam('#aa0000', { emissive: '#ff8a4a' });
    expect(bake.materialFor(glow)).not.toBe(a);
    expect(bake.materialFor(glow).emissiveIntensity).toBe(0);
    expect(bake.materialFor(new MeshStandardMaterial())).toBeNull();
    expect(bake.materialFor(lam('#ffffff', { transparent: true }))).toBeNull();
  });
});