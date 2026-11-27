import { describe, expect, it } from 'vitest';
import { Color, Matrix4, MeshBasicMaterial, MeshStandardMaterial, BoxGeometry } from 'three';
import { createVehicleKit } from './street-vehicles.js';
import { createKit } from './kit.js';
import { createTracker } from './tracker.js';
import { createInstanceBatch } from './street-batch.js';
import { createStaticProbe, mergeStatic } from '../models/merge.js';
import { Group } from 'three';

describe('createInstanceBatch (all the traffic bodies in one BatchedMesh)', () => {
  const k = createKit(createTracker());
  const V = createVehicleKit(k);
  const kinds = { auto: V.auto(), bike: V.bike(true), car: V.car(), bus: V.bus(), bicycle: V.bicycle(), parked: V.bike(false) };
  const torso = V.walkerTorso();
  const leg = V.walkerLeg();

  it('takes every body geometry of the street (same attributes, non-indexed) and gives each kind its own instances', () => {
    const material = new MeshStandardMaterial({ vertexColors: true });
    const parts = Object.values(kinds).map((g, i) => ({ geometry: g.body, count: 2 + i }));
    parts.push({ geometry: torso.body, count: 3 }, { geometry: leg.body, count: 3 }, { geometry: leg.body, count: 3 }); // two parts share the leg geometry
    const { mesh, slots } = createInstanceBatch(material, parts);
    expect(mesh.isBatchedMesh).toBe(true);
    expect(mesh.material).toBe(material);
    expect(slots).toHaveLength(parts.length);
    slots.forEach((s, i) => expect(s.instanceIds).toHaveLength(parts[i].count));
    // the legs added their geometry once, the two leg parts have distinct instances
    expect(slots[slots.length - 1].geometryId).toBe(slots[slots.length - 2].geometryId);
    expect(new Set([...slots[slots.length - 1].instanceIds, ...slots[slots.length - 2].instanceIds]).size).toBe(6);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.perObjectFrustumCulled).toBe(true);
    mesh.dispose();
  });

  it('a slot speaks the InstancedMesh calls the street makes: setMatrixAt and setColorAt land on that instance, the others are untouched', () => {
    const { mesh, slots } = createInstanceBatch(new MeshBasicMaterial({ vertexColors: true }), [{ geometry: kinds.car.body, count: 2 }, { geometry: kinds.bus.body, count: 2 }]);
    const m = new Matrix4().makeTranslation(3, 4, 5);
    slots[1].setMatrixAt(1, m);
    slots[1].setColorAt(1, new Color('#ff0000'));
    const out = new Matrix4();
    mesh.getMatrixAt(slots[1].instanceIds[1], out);
    expect(out.elements[12]).toBe(3);
    expect(out.elements[13]).toBe(4);
    expect(out.elements[14]).toBe(5);
    const c = new Color();
    mesh.getColorAt(slots[1].instanceIds[1], c);
    expect(c.r).toBeCloseTo(1, 6);
    expect(c.g).toBeCloseTo(0, 6);
    mesh.getMatrixAt(slots[0].instanceIds[0], out);
    expect(out.elements[12]).toBe(0); // untouched (identity)
    // the InstancedMesh fields the street touches exist and do nothing harmful
    slots[0].instanceMatrix.setUsage(1);
    slots[0].instanceMatrix.needsUpdate = true;
    slots[0].instanceColor.needsUpdate = true;
    expect(() => slots[0].dispose()).not.toThrow();
    mesh.dispose();
  });

  it('a geometry with other attributes (or an index when the first had none) is refused with a plain error', () => {
    const plain = new BoxGeometry(1, 1, 1); // indexed, no vertex colours
    expect(() => createInstanceBatch(new MeshBasicMaterial(), [{ geometry: kinds.car.body, count: 1 }, { geometry: plain, count: 1 }])).toThrow();
  });

  it('the static merger never swallows it (it moves every frame)', () => {
    const root = new Group();
    const { mesh } = createInstanceBatch(new MeshBasicMaterial({ vertexColors: true }), [{ geometry: kinds.car.body, count: 1 }, { geometry: kinds.bus.body, count: 1 }]);
    root.add(mesh);
    const probe = createStaticProbe(root);
    probe.sample();
    const only = probe.finish();
    expect(only.has(mesh)).toBe(false);
    const res = mergeStatic(root, { only });
    expect(res.after).toBe(res.before);
    expect(root.children).toContain(mesh);
    mesh.dispose();
  });
});
