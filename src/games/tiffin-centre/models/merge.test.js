import { describe, it, expect } from 'vitest';
import {
  BoxGeometry, Color, DataTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RGBAFormat, SRGBColorSpace, UnsignedByteType, Box3, CanvasTexture,
  DoubleSide, InstancedMesh, ShaderMaterial, Vector3, Scene,
} from 'three';
import { createStaticProbe, mergeStatic, mergeModel, materialSignature, isFlattenable, limitShadowCasters, disposeFlatMaterials, createShadowProxy, SHADOW_LAYER, isUberable, uberMaterialFor, disposeUberMaterials } from './merge.js';
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
    expect(getCharacterDrawMode()).toEqual({ merge: false, limitShadows: false, baked: false, pack: false });
  });
});


describe('createShadowProxy', () => {
  const caster = (mat, x, parent) => {
    const m = box(mat, x, 0.5, 0, parent);
    m.castShadow = true;
    return m;
  };
  const volume = (g) => {
    // signed volume of an indexed triangle mesh: positive when the faces point outwards
    const p = g.attributes.position;
    const ix = g.index;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    let v = 0;
    for (let i = 0; i < ix.count; i += 3) {
      a.fromBufferAttribute(p, ix.getX(i));
      b.fromBufferAttribute(p, ix.getX(i + 1));
      c.fromBufferAttribute(p, ix.getX(i + 2));
      v += a.dot(b.cross(c)) / 6;
    }
    return v;
  };

  it('casts the shadow of many static meshes from one mesh per side mode, on the shadow layer only, and swallows the originals', () => {
    const scene = new Scene();
    const root = new Group();
    scene.add(root);
    const front = new MeshStandardMaterial({ color: '#c0392b' });
    const front2 = new MeshStandardMaterial({ color: '#27ae60', roughness: 0.2 });
    const dbl = new MeshStandardMaterial({ side: DoubleSide });
    const meshes = [];
    for (let i = 0; i < 4; i++) meshes.push(caster(i % 2 ? front : front2, i * 0.5, root));
    meshes.push(caster(dbl, 3, root));
    const trisBefore = meshes.reduce((n, m) => n + tris(m.geometry), 0);
    const proxy = createShadowProxy(root, { isStatic: () => true });
    expect(proxy.meshes).toHaveLength(2); // FrontSide (two materials share one proxy) + DoubleSide
    expect(proxy.swallowed).toHaveLength(5);
    expect(proxy.triangles).toBe(trisBefore);
    expect(meshes.every((m) => m.castShadow === false)).toBe(true);
    for (const p of proxy.meshes) {
      expect(p.castShadow).toBe(true);
      expect(p.layers.mask).toBe(1 << SHADOW_LAYER);
      expect(p.layers.test(new Group().layers)).toBe(false); // the main camera (layer 0) never draws it
      expect(p.parent).toBe(scene);
    }
    expect(proxy.meshes.map((p) => p.material.side).sort()).toEqual([0, 2]);
    // the world bounds of the proxies are the bounds of what they replace
    const bb = new Box3();
    for (const m of meshes) bb.union(new Box3().setFromObject(m));
    const pb = new Box3();
    for (const p of proxy.meshes) pb.union(p.geometry.boundingBox);
    expect(pb.min.distanceTo(bb.min)).toBeLessThan(1e-5);
    expect(pb.max.distanceTo(bb.max)).toBeLessThan(1e-5);
  });

  it('swallows only what the caller calls static, and never skinned / instanced / shader / alpha-tested / hidden / non-casting meshes', () => {
    const root = new Group();
    new Group().add(root);
    const plain = new MeshStandardMaterial();
    const ok = caster(plain, 0, root);
    const moving = caster(plain, 1, root);
    const hiddenOne = caster(plain, 2, root);
    hiddenOne.visible = false;
    const noCast = box(plain, 3, 0, 0, root);
    const alpha = caster(new MeshStandardMaterial({ alphaTest: 0.5 }), 4, root);
    const shader = caster(new ShaderMaterial(), 5, root);
    const inst = new InstancedMesh(new BoxGeometry(0.1, 0.1, 0.1), plain, 2);
    inst.castShadow = true;
    root.add(inst);
    const proxy = createShadowProxy(root, { isStatic: (m) => m !== moving });
    expect(proxy.swallowed).toEqual([ok]);
    expect(ok.castShadow).toBe(false);
    for (const m of [moving, hiddenOne, alpha, shader, inst]) expect(m.castShadow).toBe(true);
    expect(noCast.castShadow).toBe(false);
    expect(createShadowProxy(root, {}).meshes).toHaveLength(0); // nothing is static unless the caller says so
  });

  it('keeps outward-facing triangles for mirrored meshes and bakes the parent transform', () => {
    const root = new Group();
    new Group().add(root);
    const mat = new MeshStandardMaterial();
    const arm = new Group();
    arm.position.set(2, 0, 0);
    arm.scale.set(-1, 1, 1);
    root.add(arm);
    const m = caster(mat, 0.5, arm);
    const v0 = volume(m.geometry);
    const proxy = createShadowProxy(root, { isStatic: () => true });
    const g = proxy.meshes[0].geometry;
    expect(v0).toBeGreaterThan(0);
    expect(volume(g)).toBeCloseTo(v0, 6);
    const c = new Box3().setFromBufferAttribute(g.attributes.position).getCenter(new Vector3());
    expect(c.x).toBeCloseTo(2 - 0.5, 5); // mirrored about the arm, moved by the arm
  });

  it('restore() hands the shadow back to the originals and dispose() frees the proxies', () => {
    const root = new Group();
    const host = new Scene();
    host.add(root);
    const a = caster(new MeshStandardMaterial(), 0, root);
    const b = caster(new MeshStandardMaterial(), 1, root);
    const proxy = createShadowProxy(root, { isStatic: () => true });
    const geo = proxy.meshes[0].geometry;
    let disposed = 0;
    geo.addEventListener('dispose', () => disposed++);
    expect(host.children).toHaveLength(2);
    proxy.restore();
    expect(a.castShadow && b.castShadow).toBe(true);
    expect(host.children).toHaveLength(1);
    proxy.dispose();
    expect(disposed).toBe(1);
  });
});


describe('uber material', () => {
  const std = (color, o = {}) => new MeshStandardMaterial({ color, ...o });
  const mk = (mat, x, root) => box(mat, x, 0, 0, root);

  it('folds untextured opaque standard materials into ONE mesh and keeps colour, roughness and metalness per vertex', () => {
    const root = new Group();
    const a = std('#c0392b', { roughness: 0.4, metalness: 0 });
    const b = std('#c9ced2', { roughness: 0.34, metalness: 1 });
    const c = std('#17140f', { roughness: 0.85, metalness: 0 });
    mk(a, 0, root);
    mk(a, 0.3, root);
    mk(b, 0.6, root);
    mk(c, 0.9, root);
    const bb = worldBox(root);
    const before = sum(root);
    const probe = createStaticProbe(root);
    probe.sample();
    const res = mergeStatic(root, { only: probe.finish(), uber: true });
    const meshes = visibleMeshes(root);
    expect(meshes).toHaveLength(1);
    expect(res.before).toBe(4);
    expect(res.after).toBe(1);
    expect(sum(root)).toBe(before);
    const g = meshes[0].geometry;
    expect(g.attributes.color.itemSize).toBe(3);
    expect(g.attributes.aRM.itemSize).toBe(2);
    const m = meshes[0].material;
    expect(m.userData.uber).toBe(true);
    expect(m.vertexColors).toBe(true);
    expect(m.roughness).toBe(1);
    expect(m.metalness).toBe(1);
    // the first box (24 vertices) carries material a's linear colour and its roughness / metalness; the third carries b's
    const col = g.attributes.color;
    const rm = g.attributes.aRM;
    expect(col.getX(0)).toBeCloseTo(a.color.r, 6);
    expect(col.getY(0)).toBeCloseTo(a.color.g, 6);
    expect(rm.getX(0)).toBeCloseTo(0.4, 6);
    expect(rm.getY(0)).toBeCloseTo(0, 6);
    expect(col.getX(48)).toBeCloseTo(b.color.r, 6);
    expect(rm.getX(48)).toBeCloseTo(0.34, 6);
    expect(rm.getY(48)).toBeCloseTo(1, 6);
    expect(rm.getX(72)).toBeCloseTo(0.85, 6);
    const ab = worldBox(root);
    expect(ab.min.distanceTo(bb.min)).toBeLessThan(1e-5);
    expect(ab.max.distanceTo(bb.max)).toBeLessThan(1e-5);
    disposeUberMaterials();
  });

  it('leaves alone anything that is not a plain standard material: textures, transparency, emissive, physical, patched shaders, shared / live ones', () => {
    const tex = new DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    expect(isUberable(std('#fff'))).toBe(true);
    expect(isUberable(std('#fff', { map: tex }))).toBe(false);
    expect(isUberable(std('#fff', { normalMap: tex }))).toBe(false);
    expect(isUberable(std('#fff', { transparent: true, opacity: 0.5 }))).toBe(false);
    expect(isUberable(std('#fff', { opacity: 0.9 }))).toBe(false);
    expect(isUberable(std('#fff', { emissive: '#ff0000', emissiveIntensity: 1 }))).toBe(false);
    expect(isUberable(std('#fff', { emissive: '#ff0000', emissiveIntensity: 0 }))).toBe(true);
    expect(isUberable(std('#fff', { polygonOffset: true }))).toBe(false);
    expect(isUberable(std('#fff', { flatShading: true }))).toBe(false);
    expect(isUberable(new MeshBasicMaterial())).toBe(false);
    const patched = std('#fff');
    patched.onBeforeCompile = function patchTheShaderWithSomethingLongEnough(shader) { shader.fragmentShader += '// a custom chunk that makes this a different program'; };
    expect(isUberable(patched)).toBe(false);
    const live = std('#fff');
    expect(isUberable(live, new Set([live]))).toBe(false);
    const shared = std('#fff');
    shared.userData.shared = true;
    expect(isUberable(shared)).toBe(false);
  });

  it('keeps one uber material per side mode, and a textured material still gets its own mesh', () => {
    const root = new Group();
    const tex = new DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    tex.colorSpace = SRGBColorSpace;
    mk(std('#aa3322'), 0, root);
    mk(std('#2233aa', { roughness: 0.2 }), 0.3, root);
    mk(std('#33aa22', { side: DoubleSide }), 0.6, root);
    mk(std('#33aa11', { side: DoubleSide, roughness: 0.3 }), 0.9, root);
    mk(std('#ffffff', { map: tex }), 1.2, root);
    mk(std('#ffffff', { map: tex }), 1.5, root);
    const probe = createStaticProbe(root);
    probe.sample();
    mergeStatic(root, { only: probe.finish(), uber: true });
    const meshes = visibleMeshes(root);
    expect(meshes).toHaveLength(3); // uber front, uber double sided, the textured pair (same material signature)
    expect(meshes.filter((m) => m.material.userData.uber)).toHaveLength(2);
    expect(uberMaterialFor(std('#fff'))).toBe(uberMaterialFor(std('#000', { roughness: 0.1 })));
    disposeUberMaterials();
  });

  it('patches roughness and metalness from the vertex attribute and nothing else', () => {
    const u = uberMaterialFor(std('#fff'));
    const shader = {
      vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main() {\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n}',
    };
    u.onBeforeCompile(shader);
    expect(shader.vertexShader).toContain('attribute vec2 aRM;');
    expect(shader.vertexShader).toContain('vRM = aRM;');
    expect(shader.fragmentShader).toContain('roughnessFactor *= vRM.x;');
    expect(shader.fragmentShader).toContain('metalnessFactor *= vRM.y;');
    expect(u.customProgramCacheKey()).toBe('tc-uber');
    disposeUberMaterials();
  });
});
