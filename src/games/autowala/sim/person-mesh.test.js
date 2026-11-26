// The skinned customer rig and the static driver / passenger: one draw call each, limbs still animate through the same handles.
import { describe, expect, it, vi } from 'vitest';
import { Bone, Color, Mesh, SkinnedMesh, Vector3 } from 'three';
import { Scene } from 'three';
import { buildCustomerRig, buildStaticPerson, installPersonWarmup, personSpec, sharedPersonMaterial } from './person-mesh.js';
import { createRig, poseWalk, poseWave, disposeRig } from '../gameplay/customers.js';

const look = { shirt: '#2d7be8', skin: '#a86e4a', hair: '#1b1220' };
const one = { pax: 1, look, female: false, kind: 'regular', luggage: false };
const two = { pax: 2, look, look2: { shirt: '#f2c230' }, female: true, kind: 'tourist', luggage: true };

const countMeshes = (o) => {
  let n = 0;
  o.traverse((x) => {
    if (x.isMesh) n++;
  });
  return n;
};
const countVerts = (g) => g.attributes.position.count;

describe('customer rig', () => {
  it('is ONE skinned mesh whatever the party (one person, two people with a suitcase)', () => {
    for (const c of [one, two]) {
      const rig = createRig(c);
      expect(rig).toBeInstanceOf(SkinnedMesh);
      expect(countMeshes(rig)).toBe(1);
      expect(rig.castShadow).toBe(true);
      expect(rig.userData.persons).toHaveLength(c.pax);
      expect(typeof rig.userData.phase).toBe('number');
    }
  });

  it('keeps the limb handles of the old rig: bones at the same rest positions', () => {
    const rig = createRig(one);
    const p = rig.userData.persons[0];
    for (const k of ['lArm', 'rArm', 'lLeg', 'rLeg']) expect(p.userData[k]).toBeInstanceOf(Bone);
    expect(p.userData.rArm.position.toArray()).toEqual([0.27, 1.01, 0.06].map((n) => expect.closeTo(n, 5)));
    expect(p.userData.lArm.position.x).toBeCloseTo(-0.27, 5);
    expect(p.userData.lLeg.position.toArray()).toEqual([-0.11, 0.34, 0].map((n) => expect.closeTo(n, 5)));
    // two people stand 0.84 m apart and the elder / student scales go on the root
    const rig2 = createRig({ ...two, kind: 'elder' });
    expect(rig2.userData.persons.map((q) => q.position.x)).toEqual([-0.42, 0.42]);
    expect(rig2.userData.persons[0].scale.x).toBeCloseTo(0.94, 5);
  });

  it('every customer shares one material, and disposing a rig never disposes it', () => {
    const a = createRig(one);
    const b = createRig(two);
    expect(a.material).toBe(b.material);
    expect(a.material).toBe(sharedPersonMaterial());
    expect(a.material.vertexColors).toBe(true);
    const spy = vi.fn();
    a.material.addEventListener('dispose', spy);
    const geo = a.geometry;
    const bt = vi.spyOn(a.skeleton, 'dispose');
    disposeRig(a);
    disposeRig(b);
    expect(spy).not.toHaveBeenCalled();
    expect(bt).toHaveBeenCalledTimes(1); // freeing the geometry frees the skeleton's bone texture too
    expect(geo.attributes.position).toBeTruthy();
  });

  it('bakes the look into vertex colours and binds every vertex to a real bone', () => {
    const rig = createRig(two);
    const g = rig.geometry;
    const bones = rig.skeleton.bones.length;
    expect(bones).toBe(1 + 5 * 2);
    const idx = g.attributes.skinIndex;
    const w = g.attributes.skinWeight;
    const used = new Set();
    for (let i = 0; i < countVerts(g); i++) {
      expect(idx.getX(i)).toBeLessThan(bones);
      expect(w.getX(i)).toBeCloseTo(1, 5);
      used.add(idx.getX(i));
    }
    expect(used.has(0)).toBe(true); // the suitcase rides the ground bone
    expect(used.size).toBe(bones);
    const shirt = new Color(look.shirt);
    const shirt2 = new Color('#f2c230');
    const col = g.attributes.color;
    let hitFirst = false;
    let hitSecond = false;
    for (let i = 0; i < countVerts(g); i++) {
      if (Math.abs(col.getX(i) - shirt.r) < 1e-5 && Math.abs(col.getY(i) - shirt.g) < 1e-5) hitFirst = true;
      if (Math.abs(col.getX(i) - shirt2.r) < 1e-5 && Math.abs(col.getY(i) - shirt2.g) < 1e-5) hitSecond = true;
    }
    expect(hitFirst && hitSecond).toBe(true);
  });

  it('the rest pose is the identity skinning, and the pose functions move the limbs', () => {
    const rig = createRig(one);
    rig.updateMatrixWorld(true);
    rig.skeleton.update();
    const m = rig.skeleton.boneMatrices;
    for (let b = 0; b < rig.skeleton.bones.length; b++) {
      const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      for (let k = 0; k < 16; k++) expect(m[b * 16 + k]).toBeCloseTo(id[k], 5);
    }
    const arm = rig.userData.persons[0].userData.rArm;
    poseWave(rig, 1.3, 0.5, 0);
    rig.updateMatrixWorld(true);
    rig.skeleton.update();
    const i = rig.skeleton.bones.indexOf(arm);
    const moved = Array.from(rig.skeleton.boneMatrices.slice(i * 16, i * 16 + 16)).some((v, k) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][k]) > 1e-3);
    expect(moved).toBe(true);
    poseWalk(rig, 0.9);
    rig.updateMatrixWorld(true);
    expect(rig.userData.persons[0].userData.lLeg.rotation.x).not.toBe(0);
  });

  it('a vertex of the raised arm follows the bone (skinning maths)', () => {
    const rig = createRig(one);
    const arm = rig.userData.persons[0].userData.rArm;
    const armIdx = rig.skeleton.bones.indexOf(arm);
    const geo = rig.geometry;
    let v = -1;
    for (let i = 0; i < countVerts(geo); i++) if (geo.attributes.skinIndex.getX(i) === armIdx) { v = i; break; }
    expect(v).toBeGreaterThanOrEqual(0);
    const p0 = new Vector3().fromBufferAttribute(geo.attributes.position, v);
    arm.rotation.z = -Math.PI / 2;
    arm.updateMatrixWorld(true);
    const p1 = rig.getVertexPosition(v, new Vector3());
    expect(p1.distanceTo(p0)).toBeGreaterThan(0.05);
    // ... and it moved about the bone's own origin (a rotation keeps the distance to it)
    const origin = arm.position.clone();
    expect(p1.distanceTo(origin)).toBeCloseTo(p0.distanceTo(origin), 4);
  });

  it('has a sane culling sphere around the whole party', () => {
    const rig = buildCustomerRig([{ look, scale: 1, x: -0.42 }, { look, scale: 1, x: 0.42 }], { x: 1, color: '#2b6cb0' });
    expect(rig.boundingSphere.radius).toBeGreaterThan(1.2);
    expect(rig.boundingSphere.center.y).toBeGreaterThan(0.4);
    expect(rig.boundingSphere.center.y).toBeLessThan(1.4);
  });
});

describe('static people (driver, passengers)', () => {
  it('is one Mesh in a Group; scale and position live on the group', () => {
    const p = buildStaticPerson({ pose: 'drive', scale: 0.92, cap: '#2a3350' });
    expect(countMeshes(p)).toBe(1);
    expect(p.children[0]).toBeInstanceOf(Mesh);
    expect(p.scale.x).toBeCloseTo(0.92, 5);
    expect(p.userData.mats.cap).toBeTruthy();
    expect(buildStaticPerson({ pose: 'sit' }).userData.mats.cap).toBeUndefined();
  });

  it('recolours through mats.<role>.color.set(), rewriting only that role', () => {
    const p = buildStaticPerson({ pose: 'sit', shirt: '#ff0000', skin: '#00ff00' });
    const col = p.userData.mesh.geometry.attributes.color;
    const before = Array.from(col.array);
    expect(p.userData.mats.shirt.color).toBeInstanceOf(Color);
    p.userData.mats.shirt.color.set('#123456');
    expect(p.userData.mats.shirt.color.getHexString()).toBe('123456');
    const after = Array.from(col.array);
    const changed = after.filter((v, i) => v !== before[i]).length;
    expect(changed).toBeGreaterThan(0);
    const want = new Color('#123456');
    // every changed channel is the new shirt colour; skin vertices untouched
    for (let i = 0; i < after.length; i += 3) {
      if (after[i] !== before[i] || after[i + 1] !== before[i + 1] || after[i + 2] !== before[i + 2]) {
        expect(after[i]).toBeCloseTo(want.r, 5);
        expect(after[i + 1]).toBeCloseTo(want.g, 5);
        expect(after[i + 2]).toBeCloseTo(want.b, 5);
      }
    }
    p.userData.mats.skin.color.set('#445566');
    expect(p.userData.mats.skin.color.getHexString()).toBe('445566');
  });

  it('has the same parts, in the same places, as the old limb meshes', () => {
    const stand = personSpec('stand');
    expect(stand.map((s) => s.base)).toEqual(['torso', 'head', 'arm', 'arm', 'hair', 'leg', 'leg']);
    // roles are contiguous ranges
    const roles = stand.map((s) => s.role);
    expect(roles).toEqual(['shirt', 'skin', 'skin', 'skin', 'hair', 'legs', 'legs']);
    expect(personSpec('drive', true).at(-1)).toMatchObject({ base: 'cap', role: 'cap' });
  });
});

describe('boot warm-up', () => {
  it('parks ONE hidden skinned customer in the scene (renderer.compile walks hidden meshes) and removes it on dispose', () => {
    const scene = new Scene();
    const systems = [];
    installPersonWarmup({ scene, addSystem: (s) => systems.push(s) });
    expect(scene.children).toHaveLength(1);
    const warm = scene.children[0];
    expect(warm).toBeInstanceOf(SkinnedMesh);
    expect(warm.visible).toBe(false);
    expect(warm.material).toBe(sharedPersonMaterial()); // the very material (and so the very program) every customer uses
    systems[0].dispose();
    expect(scene.children).toHaveLength(0);
    expect(() => installPersonWarmup({})).not.toThrow();
  });
});
