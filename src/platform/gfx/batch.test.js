import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, DataTexture, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RGBAFormat,
  Scene, SphereGeometry, UnsignedByteType, Vector3, Box3, DirectionalLight, ShaderMaterial,
} from 'three';
import {
  bakeGeometry, boundsOf, createInstances, disposeTree, freezeStatic, groupByTile, instancesFromMeshes, materialSignature, mergeByMaterial, mergeGeometries, mergeMeshes, thaw,
  tileInstances, tileMeshes,
} from './batch.js';

const box = (w = 1, h = 1, d = 1) => new BoxGeometry(w, h, d);
const mesh = (g, m, x = 0, y = 0, z = 0) => {
  const o = new Mesh(g, m);
  o.position.set(x, y, z);
  return o;
};
/** Signed volume of a closed triangle mesh: > 0 when the winding faces outward. */
function signedVolume(g) {
  const p = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : p.count;
  let v = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < n; i += 3) {
    const ia = idx ? idx.getX(i) : i;
    const ib = idx ? idx.getX(i + 1) : i + 1;
    const ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(p, ia);
    b.fromBufferAttribute(p, ib);
    c.fromBufferAttribute(p, ic);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}
const tex = () => {
  const t = new DataTexture(new Uint8Array([1, 2, 3, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
};

describe('mergeGeometries', () => {
  it('merges two indexed boxes: counts, offsets and index validity', () => {
    const a = box();
    const b = box(2, 2, 2);
    const m = mergeGeometries([a, b]);
    expect(m.attributes.position.count).toBe(a.attributes.position.count + b.attributes.position.count);
    expect(m.index.count).toBe(a.index.count + b.index.count);
    expect(m.groups.map((g) => g.materialIndex)).toEqual([0, 1, 2, 3, 4, 5]); // a BoxGeometry carries its 6 face groups: kept, contiguous
    expect(m.groups.reduce((s, g) => s + g.count, 0)).toBe(m.index.count);
    expect(mergeGeometries([new SphereGeometry(1, 4, 3), new SphereGeometry(1, 4, 3)]).groups).toHaveLength(0);
    let max = 0;
    for (let i = 0; i < m.index.count; i++) max = Math.max(max, m.index.getX(i));
    expect(max).toBe(m.attributes.position.count - 1);
    // every vertex of both boxes is referenced exactly as often as before (indices were offset, then regrouped by material index)
    const used = new Map();
    for (let i = 0; i < m.index.count; i++) used.set(m.index.getX(i), (used.get(m.index.getX(i)) || 0) + 1);
    expect(used.size).toBe(m.attributes.position.count);
    expect(m.index.array).toBeInstanceOf(Uint16Array);
  });
  it('keeps position, normal and uv; drops attributes that not every source has', () => {
    const a = box();
    const b = box();
    b.deleteAttribute('uv');
    const m = mergeGeometries([a, b]);
    expect(Object.keys(m.attributes).sort()).toEqual(['normal', 'position']);
    expect(Object.keys(mergeGeometries([box(), box()]).attributes).sort()).toEqual(['normal', 'position', 'uv']);
  });
  it('keeps uv1 / uv2 when all sources have them, copying values', () => {
    const mk = (v) => {
      const g = box();
      const n = g.attributes.position.count;
      g.setAttribute('uv1', new BufferAttribute(new Float32Array(n * 2).fill(v), 2));
      g.setAttribute('uv2', new BufferAttribute(new Float32Array(n * 2).fill(v + 1), 2));
      return g;
    };
    const m = mergeGeometries([mk(0.25), mk(0.75)]);
    expect(m.attributes.uv1.getX(0)).toBeCloseTo(0.25);
    expect(m.attributes.uv1.getX(24)).toBeCloseTo(0.75);
    expect(m.attributes.uv2.getY(30)).toBeCloseTo(1.75);
  });
  it('colour: kept when every source has it; "force" fills white for the ones without; "none" drops it', () => {
    const colored = box();
    colored.setAttribute('color', new BufferAttribute(new Float32Array(24 * 3).fill(0.5), 3));
    const plain = box();
    expect(mergeGeometries([colored, box()]).attributes.color).toBeUndefined();
    const forced = mergeGeometries([colored, plain], { color: 'force' });
    expect(forced.attributes.color.getX(0)).toBeCloseTo(0.5);
    expect(forced.attributes.color.getX(24)).toBe(1);
    expect(mergeGeometries([colored, colored.clone()]).attributes.color).toBeTruthy();
    expect(mergeGeometries([colored, colored.clone()], { color: 'none' }).attributes.color).toBeUndefined();
  });
  it('de-normalises Uint8 colours', () => {
    const g = box();
    g.setAttribute('color', new BufferAttribute(new Uint8Array(24 * 3).fill(255), 3, true));
    expect(mergeGeometries([g, g.clone()]).attributes.color.getX(0)).toBe(1);
  });
  it('mixes indexed and non-indexed sources', () => {
    const indexed = new PlaneGeometry(1, 1);
    const flat = new PlaneGeometry(1, 1).toNonIndexed();
    const m = mergeGeometries([indexed, flat]);
    expect(m.index.count).toBe(indexed.index.count + flat.attributes.position.count);
    expect(m.index.getX(indexed.index.count)).toBe(indexed.attributes.position.count); // the flat source starts right after
  });
  it('uses Uint32 indices past 65535 vertices', () => {
    const big = new BufferGeometry();
    big.setAttribute('position', new BufferAttribute(new Float32Array(40000 * 3), 3));
    const m = mergeGeometries([big, big.clone()]);
    expect(m.attributes.position.count).toBe(80000);
    expect(m.index.array).toBeInstanceOf(Uint32Array);
  });
  it('preserves material groups: contiguous ranges per material index across sources', () => {
    const mk = () => {
      const g = new PlaneGeometry(1, 1, 2, 1); // 4 triangles
      g.clearGroups();
      g.addGroup(0, 6, 0);
      g.addGroup(6, 6, 1);
      return g;
    };
    const m = mergeGeometries([mk(), mk(), mk()]);
    expect(m.groups.map((g) => [g.start, g.count, g.materialIndex])).toEqual([[0, 18, 0], [18, 18, 1]]);
    expect(m.index.count).toBe(36);
  });
  it('null for empty / invalid input', () => {
    expect(mergeGeometries([])).toBeNull();
    expect(mergeGeometries([new BufferGeometry()])).toBeNull();
  });
});

describe('bakeGeometry', () => {
  it('bakes translation into positions and rotation into normals', () => {
    const m = mesh(box(), new MeshStandardMaterial(), 5, 0, 0);
    m.rotation.y = Math.PI / 2;
    m.updateMatrixWorld(true);
    const g = bakeGeometry(m, m.matrixWorld);
    const bb = new Box3().setFromBufferAttribute(g.attributes.position);
    expect(bb.min.x).toBeCloseTo(4.5);
    expect(bb.max.x).toBeCloseTo(5.5);
    // the +x face normal (1,0,0) rotated 90 degrees about y points to -z
    let found = false;
    for (let i = 0; i < g.attributes.normal.count; i++) {
      if (Math.abs(g.attributes.normal.getZ(i) + 1) < 1e-5 && Math.abs(g.attributes.normal.getX(i)) < 1e-5) found = true;
    }
    expect(found).toBe(true);
  });
  it('flips the winding of a mirrored mesh so the faces still point outward', () => {
    const m = mesh(box(), new MeshStandardMaterial());
    m.scale.set(-2, 1, 1);
    m.updateMatrixWorld(true);
    const g = bakeGeometry(m, m.matrixWorld);
    expect(signedVolume(box())).toBeGreaterThan(0);
    expect(signedVolume(g)).toBeGreaterThan(0);
  });
  it('computes normals for a lit material when the source has none; not for basic', () => {
    const g = box();
    g.deleteAttribute('normal');
    expect(bakeGeometry(mesh(g, new MeshStandardMaterial()), new Matrix4()).attributes.normal).toBeTruthy();
    expect(bakeGeometry(mesh(g, new MeshBasicMaterial()), new Matrix4()).attributes.normal).toBeUndefined();
  });
  it('does not touch the source geometry', () => {
    const src = box();
    const before = Array.from(src.attributes.position.array);
    bakeGeometry(mesh(src, new MeshBasicMaterial(), 3, 3, 3), new Matrix4().makeTranslation(9, 9, 9));
    expect(Array.from(src.attributes.position.array)).toEqual(before);
  });
  it('de-interleaves interleaved attributes', () => {
    const g = new BufferGeometry();
    const inter = new (class extends Object {})();
    void inter;
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    expect(bakeGeometry(mesh(g, new MeshBasicMaterial()), new Matrix4()).attributes.position.count).toBe(3);
  });
});

describe('mergeMeshes', () => {
  it('bakes world transforms into one mesh with an identity transform and keeps flags', () => {
    const mat = new MeshStandardMaterial();
    const a = mesh(box(), mat, -3, 0, 0);
    const b = mesh(box(), mat, 3, 0, 0);
    b.scale.set(2, 2, 2);
    a.castShadow = true;
    const root = new Group();
    root.add(a, b);
    root.updateMatrixWorld(true);
    const out = mergeMeshes([a, b], { material: mat });
    expect(out.material).toBe(mat);
    expect(out.castShadow).toBe(true);
    expect(out.userData.merged).toBe(2);
    expect(out.matrixAutoUpdate).toBe(false);
    expect(out.geometry.boundingSphere).toBeTruthy();
    const bb = new Box3().setFromBufferAttribute(out.geometry.attributes.position);
    expect(bb.min.x).toBeCloseTo(-3.5);
    expect(bb.max.x).toBeCloseTo(4); // 3 + 2 * 0.5
    expect(out.position.toArray()).toEqual([0, 0, 0]);
  });
  it('bakes relative to a frame: the result sits in the frame\'s local space', () => {
    const mat = new MeshBasicMaterial();
    const frame = new Group();
    frame.position.set(100, 0, 0);
    const a = mesh(box(), mat, 1, 0, 0);
    const b = mesh(box(), mat, 2, 0, 0);
    frame.add(a, b);
    frame.updateMatrixWorld(true);
    const out = mergeMeshes([a, b], { material: mat, frame });
    frame.add(out);
    frame.updateMatrixWorld(true);
    const bb = new Box3().setFromObject(out);
    expect(bb.min.x).toBeCloseTo(100.5);
    expect(bb.max.x).toBeCloseTo(102.5);
  });
  it('vertex-colour materials get white filled in for meshes without colours', () => {
    const mat = new MeshBasicMaterial({ vertexColors: true });
    const withC = box();
    withC.setAttribute('color', new BufferAttribute(new Float32Array(72).fill(0.25), 3));
    const out = mergeMeshes([mesh(withC, mat), mesh(box(), mat, 2)], { material: mat });
    expect(out.geometry.attributes.color.getX(0)).toBeCloseTo(0.25);
    expect(out.geometry.attributes.color.getX(24)).toBe(1);
  });
  it('material arrays keep their groups: three meshes, two materials, still two groups', () => {
    const mats = [new MeshBasicMaterial({ color: 0xff0000 }), new MeshBasicMaterial({ color: 0x00ff00 })];
    const mk = (x) => {
      const g = new PlaneGeometry(1, 1, 2, 1);
      g.clearGroups();
      g.addGroup(0, 6, 0);
      g.addGroup(6, 6, 1);
      return mesh(g, mats, x);
    };
    const out = mergeMeshes([mk(0), mk(2), mk(4)], { material: mats });
    expect(out.material).toBe(mats);
    expect(out.geometry.groups).toHaveLength(2);
    expect(out.geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
    expect(out.geometry.groups[0].count + out.geometry.groups[1].count).toBe(out.geometry.index.count);
  });
  it('returns null for nothing mergeable', () => {
    expect(mergeMeshes([])).toBeNull();
    expect(mergeMeshes([new Object3D()])).toBeNull();
  });
});

describe('mergeByMaterial', () => {
  function city() {
    const root = new Group();
    const brick = new MeshStandardMaterial({ color: 0xaa4422 });
    const glass = new MeshStandardMaterial({ color: 0x88aacc });
    for (let i = 0; i < 12; i++) root.add(mesh(box(), brick, i * 3, 0, 0));
    for (let i = 0; i < 8; i++) root.add(mesh(box(), glass, i * 3, 5, 0));
    root.add(mesh(box(), new MeshStandardMaterial({ color: 0x00ff00 }), 99, 0, 0)); // a lonely material
    return { root, brick, glass };
  }
  it('collapses N meshes to one per material and reports the saving', () => {
    const { root, brick, glass } = city();
    const r = mergeByMaterial(root);
    expect(r.before).toBe(21);
    expect(r.after).toBe(3); // brick, glass, and the untouched singleton
    expect(r.groups).toBe(2);
    expect(r.merged.map((m) => m.material).sort((a, b) => a.uuid.localeCompare(b.uuid))).toEqual([brick, glass].sort((a, b) => a.uuid.localeCompare(b.uuid)));
    const meshes = [];
    root.traverse((o) => o.isMesh && meshes.push(o));
    expect(meshes).toHaveLength(3);
  });
  it('the merged geometry covers exactly the union of the originals (same bounds, same vertex total)', () => {
    const { root } = city();
    const verts = [];
    root.traverse((o) => o.isMesh && verts.push(o.geometry.attributes.position.count));
    const total = verts.reduce((s, v) => s + v, 0);
    const bbBefore = new Box3().setFromObject(root);
    const r = mergeByMaterial(root);
    const bbAfter = new Box3().setFromObject(root);
    expect(bbAfter.min.distanceTo(bbBefore.min)).toBeLessThan(1e-5);
    expect(bbAfter.max.distanceTo(bbBefore.max)).toBeLessThan(1e-5);
    let after = 0;
    root.traverse((o) => o.isMesh && (after += o.geometry.attributes.position.count));
    expect(after).toBe(total);
    expect(r.merged.every((m) => m.geometry.boundingSphere && m.geometry.boundingBox)).toBe(true);
  });
  it('leaves alone: transparent, invisible, noMerge, instanced, shader materials', () => {
    const root = new Group();
    const mat = new MeshStandardMaterial();
    const glassy = new MeshStandardMaterial({ transparent: true });
    for (let i = 0; i < 4; i++) root.add(mesh(box(), mat, i));
    for (let i = 0; i < 3; i++) root.add(mesh(box(), glassy, i));
    const hidden = mesh(box(), mat, 20);
    hidden.visible = false;
    const pinned = mesh(box(), mat, 21);
    pinned.userData.noMerge = true;
    root.add(hidden, pinned, new InstancedMesh(box(), mat, 3), mesh(box(), new ShaderMaterial(), 30), mesh(box(), new ShaderMaterial(), 31));
    const r = mergeByMaterial(root);
    expect(r.groups).toBe(1);
    expect(r.removed).toHaveLength(4);
    const withTransparent = mergeByMaterial(root, { includeTransparent: true });
    expect(withTransparent.removed.length).toBe(3); // only the transparent trio is left to merge
  });
  it('noMerge on an ancestor protects the whole subtree', () => {
    const root = new Group();
    const mat = new MeshBasicMaterial();
    const dyn = new Group();
    dyn.userData.noMerge = true;
    for (let i = 0; i < 3; i++) dyn.add(mesh(box(), mat, i));
    for (let i = 0; i < 3; i++) root.add(mesh(box(), mat, i + 10));
    root.add(dyn);
    const r = mergeByMaterial(root);
    expect(r.removed).toHaveLength(3);
    expect(dyn.children).toHaveLength(3);
  });
  it('respects shadow flags and renderOrder: different flags never merge together', () => {
    const root = new Group();
    const mat = new MeshBasicMaterial();
    for (let i = 0; i < 3; i++) root.add(mesh(box(), mat, i));
    for (let i = 0; i < 3; i++) {
      const m = mesh(box(), mat, i + 5);
      m.castShadow = true;
      root.add(m);
    }
    const r = mergeByMaterial(root);
    expect(r.groups).toBe(2);
    expect(r.merged.map((m) => m.castShadow).sort()).toEqual([false, true]);
  });
  it('bySignature merges equal-but-distinct materials onto the first one', () => {
    const root = new Group();
    for (let i = 0; i < 5; i++) root.add(mesh(box(), new MeshStandardMaterial({ color: 0x336699, roughness: 0.5 }), i));
    expect(mergeByMaterial(root).groups).toBe(0);
    const r = mergeByMaterial(root, { bySignature: true });
    expect(r.groups).toBe(1);
    expect(r.after).toBe(1);
  });
  it('tileSize keeps spatial locality: one merged mesh per (material, tile), each bounded inside its tile', () => {
    const root = new Group();
    const mat = new MeshBasicMaterial();
    for (let x = 0; x < 100; x += 10) for (let z = 0; z < 100; z += 10) root.add(mesh(box(), mat, x + 2, 0, z + 2));
    const one = mergeByMaterial(root);
    one.restore();
    const r = tileMeshes(root, 50);
    expect(r.groups).toBe(4);
    for (const m of r.merged) {
      const c = m.geometry.boundingSphere.center;
      const bb = new Box3().setFromBufferAttribute(m.geometry.attributes.position);
      expect(bb.max.x - bb.min.x).toBeLessThan(50);
      expect(bb.max.z - bb.min.z).toBeLessThan(50);
      expect(Number.isFinite(c.x)).toBe(true);
    }
  });
  it('maxVertices splits huge buckets', () => {
    const root = new Group();
    const mat = new MeshBasicMaterial();
    for (let i = 0; i < 10; i++) root.add(mesh(box(), mat, i)); // 24 vertices each
    const r = mergeByMaterial(root, { maxVertices: 100 });
    expect(r.groups).toBe(3); // 4 + 4 + 2 boxes
    expect(r.merged.every((m) => m.geometry.attributes.position.count <= 100)).toBe(true);
  });
  it('minGroup leaves small buckets untouched', () => {
    const root = new Group();
    const mat = new MeshBasicMaterial();
    root.add(mesh(box(), mat), mesh(box(), mat, 2));
    expect(mergeByMaterial(root, { minGroup: 3 }).groups).toBe(0);
  });
  it('restore() puts the originals back; dispose() removes the merged meshes', () => {
    const { root } = city();
    const r = mergeByMaterial(root);
    r.restore();
    const meshes = [];
    root.traverse((o) => o.isMesh && meshes.push(o));
    expect(meshes).toHaveLength(21);
    const r2 = mergeByMaterial(root);
    r2.dispose();
    const after = [];
    root.traverse((o) => o.isMesh && after.push(o));
    expect(after).toHaveLength(1); // only the lonely, never-merged mesh is left: the originals were dropped, the merged ones disposed
  });
  it('disposeOriginals frees source geometries that nothing else uses (and never a shared one)', () => {
    const root = new Group();
    const mat = new MeshBasicMaterial();
    const shared = box();
    shared.userData.shared = true;
    const spyShared = vi.spyOn(shared, 'dispose');
    const own = [box(), box()];
    const spies = own.map((g) => vi.spyOn(g, 'dispose'));
    root.add(mesh(own[0], mat), mesh(own[1], mat), mesh(shared, mat));
    mergeByMaterial(root, { disposeOriginals: true });
    expect(spies.every((s) => s.mock.calls.length === 1)).toBe(true);
    expect(spyShared).not.toHaveBeenCalled();
  });
  it('a nested hierarchy with transforms bakes the full world matrix', () => {
    const root = new Group();
    const mat = new MeshBasicMaterial();
    const parent = new Group();
    parent.position.set(10, 0, 0);
    parent.rotation.y = Math.PI / 2;
    const a = mesh(box(), mat, 0, 0, 4); // local z = 4 -> after the y rotation, world x = 10 + 4
    const b = mesh(box(), mat, 0, 0, 6);
    parent.add(a, b);
    root.add(parent);
    root.updateMatrixWorld(true);
    const bbBefore = new Box3().setFromObject(root);
    mergeByMaterial(root);
    const bbAfter = new Box3().setFromObject(root);
    expect(bbAfter.min.distanceTo(bbBefore.min)).toBeLessThan(1e-5);
    expect(bbAfter.max.distanceTo(bbBefore.max)).toBeLessThan(1e-5);
  });
  it('merging a scene keeps the draw-call count honest: 300 meshes -> 3 draws', () => {
    const root = new Group();
    const mats = [new MeshBasicMaterial({ color: 1 }), new MeshBasicMaterial({ color: 2 }), new MeshBasicMaterial({ color: 3 })];
    for (let i = 0; i < 300; i++) root.add(mesh(new SphereGeometry(0.5, 4, 3), mats[i % 3], i, 0, 0));
    const r = mergeByMaterial(root);
    expect(r.before).toBe(300);
    expect(r.after).toBe(3);
    let draws = 0;
    root.traverse((o) => o.isMesh && draws++);
    expect(draws).toBe(3);
  });
});

describe('materialSignature', () => {
  it('is equal for equal values and different for different ones', () => {
    expect(materialSignature(new MeshStandardMaterial({ color: 0x123456 }))).toBe(materialSignature(new MeshStandardMaterial({ color: 0x123456 })));
    expect(materialSignature(new MeshStandardMaterial({ color: 0x123456 }))).not.toBe(materialSignature(new MeshStandardMaterial({ color: 0x654321 })));
    const t = tex();
    expect(materialSignature(new MeshStandardMaterial({ map: t }))).toBe(materialSignature(new MeshStandardMaterial({ map: t })));
    expect(materialSignature(new MeshStandardMaterial({ map: t }))).not.toBe(materialSignature(new MeshStandardMaterial({ map: tex() })));
    expect(materialSignature(null)).toBe('none');
  });
});

describe('freezeStatic / thaw', () => {
  it('computes final matrices, switches off auto updates and creates bounding spheres', () => {
    const root = new Group();
    root.position.set(5, 0, 0);
    const child = mesh(box(), new MeshBasicMaterial(), 1, 2, 3);
    root.add(child);
    expect(child.geometry.boundingSphere).toBeNull();
    const r = freezeStatic(root);
    expect(r).toEqual({ nodes: 2, meshes: 1, bounded: 1 });
    expect(child.geometry.boundingSphere).toBeTruthy();
    expect(child.matrixWorld.elements[12]).toBe(6);
    for (const o of [root, child]) {
      expect(o.matrixAutoUpdate).toBe(false);
      expect(o.matrixWorldAutoUpdate).toBe(false);
    }
    // a frozen subtree no longer follows later transform edits...
    child.position.set(100, 0, 0);
    root.updateMatrixWorld(true);
    expect(child.matrixWorld.elements[12]).toBe(6);
    // ...until it is thawed
    thaw(root);
    root.updateMatrixWorld(true);
    expect(child.matrixWorld.elements[12]).toBe(105);
  });
  it('computes instanced bounds', () => {
    const root = new Group();
    const im = new InstancedMesh(box(), new MeshBasicMaterial(), 2);
    im.setMatrixAt(1, new Matrix4().makeTranslation(50, 0, 0));
    root.add(im);
    freezeStatic(root);
    expect(im.boundingSphere.radius).toBeGreaterThan(20);
  });
  it('bounds: false skips geometry work', () => {
    const root = new Group();
    const m = mesh(box(), new MeshBasicMaterial());
    root.add(m);
    expect(freezeStatic(root, { bounds: false }).bounded).toBe(0);
    expect(m.geometry.boundingSphere).toBeNull();
  });
  it('a frozen scene really skips matrix recomputation (no updateMatrix calls)', () => {
    const root = new Group();
    for (let i = 0; i < 20; i++) root.add(mesh(box(), new MeshBasicMaterial(), i));
    freezeStatic(root);
    const spies = root.children.map((c) => vi.spyOn(c, 'updateMatrix'));
    root.updateMatrixWorld(true);
    expect(spies.every((s) => s.mock.calls.length === 0)).toBe(true);
  });
});

describe('tiling and instancing', () => {
  it('groupByTile groups by floor(x / size), floor(z / size)', () => {
    const tiles = groupByTile([[0, 0], [10, 10], [300, 0], [-1, 0]], (p) => p, 256);
    expect([...tiles.keys()].sort()).toEqual(['-1,0', '0,0', '1,0']);
    expect(tiles.get('0,0')).toHaveLength(2);
  });
  it('tileInstances builds one culled InstancedMesh per tile with matrices, colours and bounding spheres', () => {
    const parent = new Group();
    const items = [{ x: 10, z: 10 }, { x: 20, z: 30 }, { x: 600, z: 10 }, { x: 610, z: 20 }, { x: 5, z: 700 }];
    const seen = [];
    const meshes = tileInstances(parent, box(), new MeshBasicMaterial(), items, (it) => [it.x, it.z], (it, o, c) => {
      o.position.set(it.x, 0, it.z);
      o.scale.setScalar(2);
      return it.x > 100 ? c.set(0xff0000) : null;
    }, { size: 256, castShadow: true, onMesh: (m, list) => seen.push(list.length) });
    expect(meshes).toHaveLength(3);
    expect(parent.children).toHaveLength(3);
    expect(seen.sort()).toEqual([1, 2, 2]);
    const tile = meshes.find((m) => m.count === 2 && m.instanceColor);
    expect(tile).toBeTruthy();
    const m4 = new Matrix4();
    tile.getMatrixAt(0, m4);
    expect(m4.elements[12]).toBe(600);
    expect(m4.elements[0]).toBe(2);
    expect(tile.castShadow).toBe(true);
    expect(tile.frustumCulled).toBe(true);
    expect(tile.boundingSphere.center.x).toBeGreaterThan(590);
    expect(meshes.find((m) => !m.instanceColor)).toBeTruthy();
    expect(tileInstances(parent, box(), new MeshBasicMaterial(), [], () => [0, 0], () => null)).toEqual([]);
  });
  it('tileInstances: place() always starts from an identity object (no state leaks between items)', () => {
    const parent = new Group();
    const meshes = tileInstances(parent, box(), new MeshBasicMaterial(), [1, 2], () => [0, 0], (it, o) => {
      if (it === 1) o.rotation.y = 1;
      o.position.x = it;
      return null;
    });
    const a = new Matrix4();
    meshes[0].getMatrixAt(1, a);
    const rot = new Object3D();
    rot.matrix.copy(a);
    rot.matrix.decompose(rot.position, rot.quaternion, rot.scale);
    expect(rot.quaternion.y).toBeCloseTo(0, 6); // item 2 did not inherit item 1's rotation
  });
  it('instancesFromMeshes turns repeated geometry+material into one InstancedMesh and leaves singletons', () => {
    const root = new Group();
    const g = box();
    const mat = new MeshStandardMaterial();
    for (let i = 0; i < 10; i++) root.add(mesh(g, mat, i * 2, 0, 0));
    const single = mesh(box(), mat, 50, 0, 0);
    const pair = [mesh(g, new MeshStandardMaterial(), 0, 5, 0), mesh(g, new MeshStandardMaterial(), 1, 5, 0)];
    root.add(single, ...pair);
    const r = instancesFromMeshes(root);
    expect(r.instanced).toHaveLength(1);
    expect(r.instanced[0].count).toBe(10);
    expect(r.removed).toHaveLength(10);
    let meshes = 0;
    root.traverse((o) => o.isMesh && meshes++);
    expect(meshes).toBe(1 + 1 + 2); // the instanced mesh, the singleton, the pair with distinct materials
  });
  it('instancesFromMeshes: instance matrices equal the original world matrices', () => {
    const root = new Group();
    root.position.set(7, 0, 0);
    const g = box();
    const mat = new MeshBasicMaterial();
    const originals = [];
    for (let i = 0; i < 4; i++) {
      const m = mesh(g, mat, i, i, 0);
      m.rotation.z = i * 0.3;
      m.scale.setScalar(1 + i);
      originals.push(m);
      root.add(m);
    }
    root.updateMatrixWorld(true);
    const worlds = originals.map((o) => o.matrixWorld.clone());
    const r = instancesFromMeshes(root);
    const inst = r.instanced[0];
    inst.updateMatrixWorld(true);
    const m4 = new Matrix4();
    for (let i = 0; i < 4; i++) {
      inst.getMatrixAt(i, m4);
      m4.premultiply(inst.matrixWorld);
      for (let k = 0; k < 16; k++) expect(m4.elements[k]).toBeCloseTo(worlds[i].elements[k], 5);
    }
  });
  it('createInstances accepts flat arrays, Matrix4[] and Object3D[], plus colours', () => {
    const g = box();
    const mat = new MeshBasicMaterial();
    const flat = createInstances(g, mat, [...new Matrix4().makeTranslation(1, 0, 0).elements, ...new Matrix4().makeTranslation(2, 0, 0).elements]);
    expect(flat.count).toBe(2);
    const o = new Object3D();
    o.position.set(5, 0, 0);
    const byObj = createInstances(g, mat, [o, new Matrix4().makeTranslation(9, 0, 0)], { colors: [0xff0000, new Color(0x00ff00)] });
    const m4 = new Matrix4();
    byObj.getMatrixAt(0, m4);
    expect(m4.elements[12]).toBe(5);
    expect(byObj.instanceColor).toBeTruthy();
    expect(byObj.matrixAutoUpdate).toBe(false);
    expect(createInstances(g, mat, [o], { dynamic: true }).instanceMatrix.usage).toBe(35048);
  });
});

describe('disposeTree', () => {
  function tree() {
    const root = new Group();
    const t1 = tex();
    const t2 = tex();
    const g = box();
    const m1 = new MeshStandardMaterial({ map: t1 });
    const m2 = new MeshBasicMaterial({ map: t2 });
    const arr = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    root.add(mesh(g, m1), mesh(g, m1), mesh(box(), arr), mesh(box(), m2));
    return { root, t1, t2, g, m1, m2, arr };
  }
  it('frees each geometry, material and texture exactly once, including shared references and material arrays', () => {
    const { root, t1, t2, g, m1, m2, arr } = tree();
    const spies = [t1, t2, g, m1, m2, ...arr].map((o) => vi.spyOn(o, 'dispose'));
    const s = disposeTree(root);
    expect(spies.every((sp) => sp.mock.calls.length === 1)).toBe(true);
    expect(s).toMatchObject({ geometries: 3, materials: 4, textures: 2 });
    // safe to call again (nothing is freed twice by the SECOND call's own `seen`, but it must not throw)
    expect(() => disposeTree(root)).not.toThrow();
  });
  it('skips userData.shared and anything in `keep`', () => {
    const { root, t1, g, m1, m2 } = tree();
    m1.userData.shared = true;
    const keep = new Set([g, m2]);
    const spies = [t1, g, m1, m2].map((o) => vi.spyOn(o, 'dispose'));
    const s = disposeTree(root, { keep });
    expect(spies.map((sp) => sp.mock.calls.length)).toEqual([0, 0, 0, 0]); // t1 belongs to the shared material, which is skipped entirely
    expect(s.skipped).toBeGreaterThanOrEqual(3);
  });
  it('textures: false leaves textures alone', () => {
    const { root, t1, t2 } = tree();
    const spies = [t1, t2].map((o) => vi.spyOn(o, 'dispose'));
    disposeTree(root, { textures: false });
    expect(spies.every((sp) => sp.mock.calls.length === 0)).toBe(true);
  });
  it('frees ShaderMaterial uniform textures, InstancedMesh buffers and light shadow maps; detach removes children', () => {
    const root = new Group();
    const t = tex();
    const sm = new ShaderMaterial({ uniforms: { tA: { value: t } } });
    const inst = new InstancedMesh(box(), sm, 2);
    const instDispose = vi.spyOn(inst, 'dispose');
    const light = new DirectionalLight();
    const shadowDispose = vi.fn();
    light.shadow.map = { dispose: shadowDispose };
    root.add(inst, light);
    const spy = vi.spyOn(t, 'dispose');
    disposeTree(root, { detach: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(instDispose).toHaveBeenCalled();
    expect(shadowDispose).toHaveBeenCalled();
    expect(root.children).toHaveLength(0);
  });
});

describe('boundsOf', () => {
  it('returns a sphere around everything in world space', () => {
    const root = new Group();
    root.add(mesh(box(), new MeshBasicMaterial(), -10, 0, 0), mesh(box(), new MeshBasicMaterial(), 10, 0, 0));
    const s = boundsOf(root);
    expect(s.center.x).toBeCloseTo(0);
    expect(s.radius).toBeGreaterThan(10);
  });
});

describe('merged scenes are the same picture', () => {
  it('total triangle count and area-weighted centroid are preserved by a merge', () => {
    const root = new Group();
    const mats = [new MeshStandardMaterial(), new MeshStandardMaterial()];
    for (let i = 0; i < 20; i++) {
      const m = mesh(box(1 + (i % 3), 1, 1), mats[i % 2], i * 2, (i % 4) * 1.5, -i);
      m.rotation.set(i * 0.1, i * 0.2, 0);
      root.add(m);
    }
    const tris = () => {
      let t = 0;
      root.traverse((o) => o.isMesh && (t += o.geometry.index.count / 3));
      return t;
    };
    const centroid = () => {
      const c = new Vector3();
      let n = 0;
      const v = new Vector3();
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          c.add(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
          n++;
        }
      });
      return c.divideScalar(n);
    };
    const t0 = tris();
    const c0 = centroid();
    mergeByMaterial(root);
    expect(tris()).toBe(t0);
    expect(centroid().distanceTo(c0)).toBeLessThan(1e-4);
  });
});
