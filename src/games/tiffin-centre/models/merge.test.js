import { describe, it, expect } from 'vitest';
import {
  BoxGeometry, Color, DataTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RGBAFormat, SRGBColorSpace, UnsignedByteType, Box3, CanvasTexture,
} from 'three';
import { createStaticProbe, mergeStatic, mergeModel, materialSignature, isFlattenable, limitShadowCasters, disposeFlatMaterials } from './merge.js';
import { buildCustomer, CUSTOMER_KIND_IDS } from './customers.js';
import { buildAvatar } from './avatar.js';
import { setCharacterQuality, setCharacterDrawMode, getCharacterDrawMode } from './charquality.js';

const box = (mat, x = 0, y = 0, z = 0, parent) => {
  const m = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), mat);
  m.position.set(x, y, z);
  parent?.add(m);
  return m;
};
const tris = (g) => g.index.count / 3;
const visibleMeshes = (root) => {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    out.push(o);
  });
  return out;
};
const worldBox = (root) => {
  root.updateMatrixWorld(true);
  const b = new Box3();
  for (const m of visibleMeshes(root)) b.union(new Box3().setFromObject(m));
  return b;
};
const sum = (root) => visibleMeshes(root).reduce((n, m) => n + tris(m.geometry), 0);

describe('mergeStatic', () => {
  it('merges same-material static meshes into one mesh, keeping the triangles and the world bounds', () => {
    const root = new Group();
    const mat = new MeshStandardMaterial({ color: '#c0392b' });
    for (let i = 0; i < 5; i++) box(mat, i * 0.3, 0.1 * i, -i * 0.2, root);
    const before = sum(root);
    const bb = worldBox(root);
    const res = mergeModel(root, (sample) => sample());
    expect(res.before).toBe(5);
    expect(res.after).toBe(1);
    expect(visibleMeshes(root).length).toBe(1);
    expect(sum(root)).toBe(before);
    const ab = worldBox(root);
    expect(ab.min.distanceTo(bb.min)).toBeLessThan(1e-5);
    expect(ab.max.distanceTo(bb.max)).toBeLessThan(1e-5);
  });

  it('merges equivalent materials that never changed, but never an animated or toggled mesh', () => {
    const root = new Group();
    const a = new MeshStandardMaterial({ color: '#336699' });
    const b = new MeshStandardMaterial({ color: '#336699' }); // equivalent, a different object
    const staticA = box(a, 0, 0, 0, root);
    const staticB = box(b, 1, 0, 0, root);
    const spinner = box(a, 2, 0, 0, root);
    const blinker = box(a, 3, 0, 0, root);
    const morphing = box(a, 4, 0, 0, root);
    const res = mergeModel(root, (sample) => {
      for (let i = 0; i < 4; i++) {
        spinner.rotation.y += 0.5;
        blinker.visible = i % 2 === 0;
        morphing.geometry.attributes.position.setX(0, 0.1 * i);
        morphing.geometry.attributes.position.needsUpdate = true;
        sample();
      }
      blinker.visible = true;
    });
    expect(res.groups).toBe(1);
    const left = visibleMeshes(root);
    expect(left).toContain(spinner);
    expect(left).toContain(blinker);
    expect(left).toContain(morphing);
    expect(left).not.toContain(staticA);
    expect(left).not.toContain(staticB);
  });

  it('merges into the space of the rigid frame, so a moving parent keeps carrying the merged mesh', () => {
    const root = new Group();
    const arm = new Group();
    root.add(arm);
    const mat = new MeshStandardMaterial({ color: '#445566' });
    box(mat, 0.1, 0, 0, arm);
    box(mat, 0.2, 0.1, 0, arm);
    box(mat, 5, 0, 0, root); // a static neighbour in the root frame
    const res = mergeModel(root, (sample) => {
      for (let i = 0; i < 5; i++) {
        arm.rotation.z = i * 0.4;
        arm.position.x = i * 0.1;
        sample();
      }
      arm.rotation.z = 0;
      arm.position.x = 0;
    });
    expect(res.groups).toBe(1); // the arm's two meshes merge; the lone mesh in the root frame stays as it is
    const merged = visibleMeshes(root).filter((m) => m.userData.merged);
    expect(merged.length).toBe(1);
    expect(merged[0].parent).toBe(arm);
    arm.rotation.z = Math.PI / 2;
    root.updateMatrixWorld(true);
    const p = new Box3().setFromObject(merged[0]).getCenter(new (merged[0].position.constructor)());
    expect(Math.abs(p.x)).toBeLessThan(0.3); // rotated with the arm: it no longer sits along +x
    expect(p.y).toBeGreaterThan(0.05);
  });

  it('keeps meshes marked noMerge and anything under a noMerge group, and restore() brings the originals back', () => {
    const root = new Group();
    const mat = new MeshStandardMaterial({ color: '#aaaaaa' });
    const keep = box(mat, 0, 0, 0, root);
    keep.userData.noMerge = true;
    const holder = new Group();
    holder.userData.noMerge = true;
    root.add(holder);
    const inner = box(mat, 0, 1, 0, holder);
    const a = box(mat, 1, 0, 0, root);
    const b = box(mat, 2, 0, 0, root);
    const res = mergeModel(root, (sample) => sample());
    expect(res.groups).toBe(1);
    expect(visibleMeshes(root)).toEqual(expect.arrayContaining([keep, inner]));
    expect(visibleMeshes(root)).not.toContain(a);
    res.restore();
    expect(visibleMeshes(root)).toEqual(expect.arrayContaining([keep, inner, a, b]));
    expect(visibleMeshes(root).filter((m) => m.userData.merged).length).toBe(0);
  });

  it('does not merge a material whose values change (lights, fades): the live material keeps its identity', () => {
    const root = new Group();
    const live = new MeshStandardMaterial({ color: '#ffffff', emissive: '#000000' });
    const twin = new MeshStandardMaterial({ color: '#ffffff', emissive: '#000000' });
    box(live, 0, 0, 0, root);
    box(live, 1, 0, 0, root);
    const t1 = box(twin, 2, 0, 0, root);
    const t2 = box(twin, 3, 0, 0, root);
    const res = mergeModel(root, (sample) => {
      for (let i = 0; i < 3; i++) {
        live.emissive.setScalar(i * 0.1);
        sample();
      }
    });
    expect(res.groups).toBeGreaterThanOrEqual(1);
    const merged = visibleMeshes(root).filter((m) => m.userData.merged);
    for (const m of merged) expect(m.material === live || m.material === twin).toBe(true);
    expect(visibleMeshes(root)).not.toContain(t1);
    expect(visibleMeshes(root)).not.toContain(t2);
  });

  it('gives mirrored meshes the right winding', () => {
    const root = new Group();
    const mat = new MeshStandardMaterial({ color: '#112233' });
    const m1 = box(mat, 0, 0, 0, root);
    const m2 = box(mat, 1, 0, 0, root);
    m2.scale.x = -1;
    const res = mergeModel(root, (s) => s.call?.());
    void m1;
    void res;
    const merged = visibleMeshes(root).find((m) => m.userData.merged);
    expect(merged).toBeTruthy();
    // every face normal must point away from the centre of its box: dot(normal, vertex - centre) > 0
    const g = merged.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    let bad = 0;
    for (let f = 0; f < idx.count; f += 3) {
      const a = idx.getX(f);
      const b = idx.getX(f + 1);
      const c = idx.getX(f + 2);
      const cx = ((pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3 < 0.5 ? 0 : 1);
      const ux = pos.getX(b) - pos.getX(a);
      const uy = pos.getY(b) - pos.getY(a);
      const uz = pos.getZ(b) - pos.getZ(a);
      const vx = pos.getX(c) - pos.getX(a);
      const vy = pos.getY(c) - pos.getY(a);
      const vz = pos.getZ(c) - pos.getZ(a);
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const mx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3 - cx;
      const my = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
      const mz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      if (nx * mx + ny * my + nz * mz <= 0) bad++;
    }
    expect(bad).toBe(0);
  });

  it('flatten: PBR-textured opaque materials become one vertex-coloured material; painted signs and lights keep theirs', () => {
    disposeFlatMaterials();
    const root = new Group();
    const data = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) data.set([200, 100, 50, 255], i * 4);
    const tex = new DataTexture(data, 4, 4, RGBAFormat, UnsignedByteType);
    tex.colorSpace = SRGBColorSpace;
    tex.needsUpdate = true;
    const pbr1 = new MeshStandardMaterial({ map: tex, color: '#ffffff', roughness: 0.5 });
    const pbr2 = new MeshStandardMaterial({ color: '#2060a0', roughness: 0.6 });
    const sign = new MeshStandardMaterial({ map: Object.assign(new CanvasTexture({ width: 2, height: 2 }), { image: { width: 2, height: 2 } }) });
    const bulb = new MeshStandardMaterial({ color: '#fff', emissive: '#ffcc88', emissiveIntensity: 2 });
    box(pbr1, 0, 0, 0, root);
    box(pbr2, 1, 0, 0, root);
    const s1 = box(sign, 2, 0, 0, root);
    const s2 = box(sign, 3, 0, 0, root);
    const b1 = box(bulb, 4, 0, 0, root);
    const b2 = box(bulb, 5, 0, 0, root);
    expect(isFlattenable(pbr1)).toBe(true);
    expect(isFlattenable(sign)).toBe(false);
    expect(isFlattenable(bulb)).toBe(false);
    const res = mergeModel(root, (s) => s.call?.(), { flatten: true });
    expect(res.groups).toBe(3); // flat group, signs, bulbs
    const flat = visibleMeshes(root).find((m) => m.material.userData.flat);
    expect(flat.geometry.attributes.color).toBeTruthy();
    const c = flat.geometry.attributes.color;
    // the first box took the mean colour of its texture (orange-ish), the second its plain colour (blue-ish): different vertex colours
    expect(c.getX(0)).toBeGreaterThan(c.getZ(0));
    expect(c.getZ(c.count - 1)).toBeGreaterThan(c.getX(c.count - 1));
    expect(visibleMeshes(root)).not.toContain(s1);
    expect(visibleMeshes(root)).not.toContain(b1);
    void s2;
    void b2;
    disposeFlatMaterials();
  });

  it('is safe on empty input and on a probe with nothing mergeable', () => {
    const root = new Group();
    expect(mergeStatic(root, { only: new Set() }).after).toBe(0);
    const probe = createStaticProbe(root);
    expect(probe.finish().size).toBe(0);
    expect(materialSignature(null)).toBe('none');
    expect(materialSignature(new MeshBasicMaterial({ color: new Color('#fff') }))).toContain('MeshBasicMaterial');
  });

  it('limitShadowCasters pins tiny meshes out of the shadow pass even when shade() sets castShadow again', () => {
    const root = new Group();
    const tiny = new Mesh(new BoxGeometry(0.01, 0.01, 0.01), new MeshStandardMaterial());
    const big = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    root.add(tiny, big);
    root.updateMatrixWorld(true);
    const n = limitShadowCasters(root);
    expect(n).toBe(1);
    tiny.castShadow = true;
    big.castShadow = true;
    expect(tiny.castShadow).toBe(false);
    expect(big.castShadow).toBe(true);
  });
});

describe('merged and baked people', () => {
  it('merging customers and cooks keeps every triangle and reduces the meshes', () => {
    setCharacterQuality('medium');
    for (const kind of CUSTOMER_KIND_IDS) {
      setCharacterDrawMode({ merge: false, baked: false });
      const plain = buildCustomer(kind, 3, { quality: 'medium' });
      setCharacterDrawMode({ merge: true, baked: false });
      const merged = buildCustomer(kind, 3, { quality: 'medium' });
      const p = visibleMeshes(plain.group);
      const m = visibleMeshes(merged.group);
      expect(m.length, kind).toBeLessThan(p.length);
      const tp = p.reduce((n, x) => n + (x.geometry.index ? x.geometry.index.count : x.geometry.attributes.position.count) / 3, 0);
      const tm = m.reduce((n, x) => n + (x.geometry.index ? x.geometry.index.count : x.geometry.attributes.position.count) / 3, 0);
      expect(Math.abs(tm - tp) / tp, kind).toBeLessThan(0.08);
      // it still animates: update() must not throw in any mood
      for (const mood of ['waiting', 'eating', 'paying', 'happy', 'angry', 'walkaway']) {
        merged.setMood(mood);
        merged.update(0.05, 1);
      }
      plain.dispose();
      merged.dispose();
    }
    setCharacterDrawMode({ merge: false, baked: false });
    const a = buildAvatar({ color: '#ff8a1f', name: 'x' });
    setCharacterDrawMode({ merge: true });
    const b = buildAvatar({ color: '#ff8a1f', name: 'x' });
    expect(visibleMeshes(b.group).length).toBeLessThan(visibleMeshes(a.group).length);
    b.setPose('work-tawa');
    b.update(0.05, 1);
    a.dispose();
    b.dispose();
    setCharacterDrawMode({ merge: false, baked: false });
  });

  it('lite: a customer is a baked proxy of a few draw calls that still follows mood and expression', () => {
    setCharacterQuality('lite');
    setCharacterDrawMode({ merge: false, baked: true });
    const c = buildCustomer('office', 5, { quality: 'lite' });
    const meshes = visibleMeshes(c.group);
    expect(meshes.length).toBeLessThanOrEqual(8);
    expect(c.baked.meshes.length).toBeGreaterThanOrEqual(1);
    const baked = c.baked.meshes[0];
    const snap = () => Array.from(baked.geometry.attributes.position.array.slice(0, 600));
    const rest = snap();
    c.setMood('happy');
    c.update(0.2, 1.3);
    const happy = snap();
    let moved = 0;
    for (let i = 0; i < rest.length; i++) if (Math.abs(rest[i] - happy[i]) > 1e-4) moved++;
    expect(moved).toBeGreaterThan(10);
    for (const mood of ['waiting', 'eating', 'paying', 'angry', 'walkaway']) {
      c.setMood(mood);
      c.update(0.2, 2);
    }
    expect(Number.isFinite(baked.geometry.attributes.position.array[3])).toBe(true);
    // a vertex-coloured material, no textures
    expect(baked.material.vertexColors).toBe(true);
    c.dispose();
    const cook = buildAvatar({ color: '#ff8a1f', name: 'x' });
    expect(visibleMeshes(cook.group).length).toBeLessThanOrEqual(8);
    cook.setPose('work-chai');
    cook.update(0.2, 1);
    cook.dispose();
    setCharacterDrawMode({ merge: false, baked: false });
    setCharacterQuality('high');
  });

  it('draw mode is off by default so a bare build is what it always was', () => {
    expect(getCharacterDrawMode()).toEqual({ merge: false, limitShadows: false, baked: false });
  });
});
