import { afterAll, describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { VIEW_ACTIONS, ACTION_MS, buildViewmodel } from './viewmodel.js';
import { disposeModelCache } from './util.js';

afterAll(() => disposeModelCache());

function noNaN(obj) {
  obj.updateWorldMatrix(true, true);
  obj.traverse((o) => {
    expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true);
    const p = o.geometry?.attributes?.position;
    if (p) for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) throw new Error(`NaN in ${o.name || o.type}`);
  });
}

describe('viewmodel', () => {
  it('builds under the triangle budget with the documented API', () => {
    const vm = buildViewmodel();
    expect(vm.group).toBeTruthy();
    for (const k of ['setAction', 'setHands', 'setLookDelta', 'update', 'dispose']) expect(typeof vm[k]).toBe('function');
    expect(vm.triangles).toBeLessThan(8000);
    expect(vm.triangles).toBeGreaterThan(800);
    expect(VIEW_ACTIONS).toEqual(['tawa-oil', 'tawa-pour', 'tawa-spread', 'tawa-flip', 'tawa-fill', 'tawa-take', 'steamer', 'kadai', 'chai-pour', 'serve', 'collect', 'discard']);
    expect(ACTION_MS).toBe(650);
    vm.dispose();
  });

  it('every action runs through its whole phase without NaN and keeps the hands in front of the camera', () => {
    const vm = buildViewmodel();
    let t = 0;
    for (const a of VIEW_ACTIONS) {
      for (const ph of [0, 0.1, 0.25, 0.4, 0.5, 0.65, 0.8, 0.95, 1]) {
        vm.setAction(a, ph);
        for (let i = 0; i < 4; i++) vm.update(0.016, (t += 0.016));
      }
      noNaN(vm.group);
      const b = new Box3().setFromObject(vm.group);
      expect(b.max.z).toBeLessThan(0.5);
      expect(b.min.z).toBeGreaterThan(-1.3);
      expect(b.min.y).toBeGreaterThan(-1.2);
    }
    vm.setAction(null);
    for (let i = 0; i < 60; i++) vm.update(0.016, (t += 0.016));
    noNaN(vm.group);
    vm.dispose();
  });

  it('runs an action on its own timer when no phase is given and returns to rest', () => {
    const vm = buildViewmodel();
    vm.setAction('tawa-flip');
    expect(vm.action).toBe('tawa-flip');
    for (let i = 0; i < 80; i++) vm.update(0.016, i * 0.016);
    expect(vm.action).toBe(null);
    vm.dispose();
  });

  it('hands move when the phase moves (the action actually animates)', () => {
    const vm = buildViewmodel();
    const wrist = (ph) => {
      vm.setAction('tawa-spread', ph);
      for (let i = 0; i < 60; i++) vm.update(0.016, i * 0.016);
      const p = new Vector3();
      let r = null;
      vm.group.traverse((o) => {
        if (o.name === 'hand-R') r = o;
      });
      r.getWorldPosition(p);
      return p;
    };
    const a = wrist(0.1);
    const b = wrist(0.6);
    expect(a.distanceTo(b)).toBeGreaterThan(0.02);
    vm.dispose();
  });

  it('carried dishes, look delta and dispose', () => {
    const vm = buildViewmodel();
    vm.setHands([{ dish: 'dosa', q: 'good' }, { dish: 'irani_chai', q: 'perfect' }, { dish: 'idly', q: 'ok' }]);
    vm.setLookDelta(0.2, -0.1);
    vm.setLookDelta(NaN, NaN);
    for (let i = 0; i < 30; i++) vm.update(0.016, i * 0.016);
    vm.setHands(null);
    vm.setAction('bogus', NaN);
    vm.update(NaN, NaN);
    noNaN(vm.group);
    const owned = [];
    vm.group.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) {
        const orig = o.geometry.dispose.bind(o.geometry);
        o.geometry.__d = false;
        o.geometry.dispose = () => {
          o.geometry.__d = true;
          orig();
        };
        owned.push(o.geometry);
      }
    });
    vm.dispose();
    vm.dispose();
    expect(owned.length).toBeGreaterThan(5);
    expect(owned.every((g) => g.__d)).toBe(true);
  });
});
