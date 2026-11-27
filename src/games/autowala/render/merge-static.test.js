import { describe, expect, it } from 'vitest';
import { BoxGeometry, Box3, Float32BufferAttribute, Vector3, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, CylinderGeometry } from 'three';
import { bakedCopy, createBakeRegistry, freezeMatrices, mergeStaticMeshes, mergeStaticTiles, SHADOW_LAYER } from './merge-static.js';

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
describe('mergeStaticTiles', () => {
  const lambert = (c) => new MeshLambertMaterial({ color: c });
  const place = (parent, geo, m, [x, y, z], cast = true) => {
    const mesh = new Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  it('merges the same material across models of one tile and bakes world space (identity matrices)', () => {
    const root = new Group();
    const m = lambert('#ffffff');
    const a = new Group();
    a.position.set(100, 0, 100);
    a.rotation.y = 0.4;
    const b = new Group();
    b.position.set(300, 0, 50);
    root.add(a, b);
    place(a, new BoxGeometry(2, 2, 2), m, [1, 1, 0]);
    place(b, new BoxGeometry(2, 2, 2), m, [-1, 1, 3]);
    const before = worldBox(root);
    const r = mergeStaticTiles(root, { tile: 640 });
    expect(r.before).toBe(2);
    expect(r.meshes).toHaveLength(1);
    expect(r.after).toBe(1);
    const meshes = [];
    root.traverse((o) => o.isMesh && meshes.push(o));
    expect(meshes).toHaveLength(1);
    expect(meshes[0].parent).toBe(root);
    expect(meshes[0].matrixAutoUpdate).toBe(false);
    const after = worldBox(root);
    for (const k of ['x', 'y', 'z']) {
      expect(after.min[k]).toBeCloseTo(before.min[k], 4);
      expect(after.max[k]).toBeCloseTo(before.max[k], 4);
    }
    expect(root.children.filter((c) => c.isGroup)).toHaveLength(0); // the emptied model groups are gone
  });

  it('keeps tiles, materials and shadow flags apart', () => {
    const root = new Group();
    const m1 = lambert('#ff0000');
    const m2 = lambert('#00ff00');
    const near = new Group();
    const far = new Group();
    far.position.set(2000, 0, 0);
    root.add(near, far);
    place(near, new BoxGeometry(1, 1, 1), m1, [0, 0, 0]);
    place(near, new BoxGeometry(1, 1, 1), m1, [3, 0, 0]);
    place(near, new BoxGeometry(1, 1, 1), m1, [6, 0, 0], false); // other shadow flag
    place(near, new BoxGeometry(1, 1, 1), m2, [9, 0, 0]);
    place(far, new BoxGeometry(1, 1, 1), m1, [0, 0, 0]); // other tile
    const r = mergeStaticTiles(root, { tile: 640 });
    expect(r.before).toBe(5);
    expect(r.meshes).toHaveLength(4);
    const merged = r.meshes.find((o) => o.material === m1 && o.castShadow && o.position.x === 0 && o.geometry.attributes.position.count === 72);
    expect(merged).toBeTruthy(); // two boxes (36 vertices each, non-indexed)
  });

  it('keeps vertex colours, leaves instanced and kept meshes alone, and flips mirrored winding', () => {
    const root = new Group();
    const vc = new MeshLambertMaterial({ vertexColors: true });
    const g = new Group();
    g.scale.x = -1; // a mirror
    root.add(g);
    for (const [x, c] of [[2, [1, 0, 0]], [5, [0, 1, 0]]]) {
      const geo = new BoxGeometry(1, 1, 1);
      geo.setAttribute('color', new Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).map((_, i) => c[i % 3]), 3));
      place(g, geo, vc, [x, 0, 0]);
    }
    const inst = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2);
    g.add(inst);
    const keep = new Mesh(new BoxGeometry(1, 1, 1), vc);
    keep.userData.keep = true;
    g.add(keep);
    const r = mergeStaticTiles(root);
    expect(r.meshes).toHaveLength(1);
    const col = r.meshes[0].geometry.attributes.color;
    expect(col).toBeTruthy();
    expect(col.count).toBe(72);
    expect(col.getX(0)).toBe(1);
    expect(col.getY(40)).toBe(1);
    expect(inst.parent).toBe(g); // the instanced mesh keeps its model (and the model keeps its transform)
    expect(keep.parent).toBe(g);
    // outward-facing after the mirror: the first triangle's geometric normal agrees with the stored vertex normal
    const p = r.meshes[0].geometry.attributes.position;
    const n = r.meshes[0].geometry.attributes.normal;
    const a = new Vector3().fromBufferAttribute(p, 0);
    const b = new Vector3().fromBufferAttribute(p, 1);
    const c = new Vector3().fromBufferAttribute(p, 2);
    const face = b.sub(a).cross(c.sub(a));
    expect(face.dot(new Vector3().fromBufferAttribute(n, 0))).toBeGreaterThan(0);
  });
});

describe('mergeStaticTiles shadowProxy', () => {
  const lam = (c) => new MeshLambertMaterial({ color: c });
  const part = (parent, m, x, cast) => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), m);
    mesh.position.set(x, 0, 0);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
  };

  it('merges casters and non-casters of one material into one visible mesh and puts every caster in one shadow-only proxy per tile', () => {
    const root = new Group();
    const g = new Group();
    root.add(g);
    const a = lam('#ff0000');
    const b = lam('#0000ff');
    part(g, a, 0, true);
    part(g, a, 3, false);
    part(g, b, 6, true);
    part(g, b, 9, true);
    const r = mergeStaticTiles(root, { tile: 640, shadowProxy: true });
    expect(r.meshes).toHaveLength(2); // one per material, the cast flag no longer splits them
    expect(r.meshes.every((m) => m.castShadow === false)).toBe(true);
    expect(r.proxies).toHaveLength(1);
    const proxy = r.proxies[0];
    expect(proxy.castShadow).toBe(true);
    expect(Object.keys(proxy.geometry.attributes)).toEqual(['position']);
    expect(proxy.geometry.attributes.position.count).toBe(36 * 3); // the three casters, non-indexed
    // layer 1 only: the camera (layer 0) never draws it, the shadow camera with layer 1 enabled does
    expect(proxy.layers.isEnabled(SHADOW_LAYER)).toBe(true);
    expect(proxy.layers.isEnabled(0)).toBe(false);
    expect(r.after).toBe(3);
  });

  it('makes a proxy per tile and none when nothing casts', () => {
    const root = new Group();
    const far = new Group();
    far.position.set(5000, 0, 0);
    root.add(far);
    const m = lam('#00ff00');
    part(root, m, 0, true);
    part(far, m, 0, true);
    expect(mergeStaticTiles(root, { tile: 640, shadowProxy: true }).proxies).toHaveLength(2);
    const root2 = new Group();
    part(root2, m, 0, false);
    part(root2, m, 2, false);
    expect(mergeStaticTiles(root2, { tile: 640, shadowProxy: true }).proxies).toHaveLength(0);
  });
});
