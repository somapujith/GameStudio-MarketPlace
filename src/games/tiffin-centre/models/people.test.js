import { afterAll, describe, expect, it, vi } from 'vitest';
import { Box3, Vector3 } from 'three';
import { CUSTOMER_KINDS } from '../../../../shared/tiffin-centre/catalog.js';
import { WORK_MS } from '../../../../shared/tiffin-centre/movement.js';
import { MOODS, buildCustomer } from './customers.js';
import { POSES, buildAvatar } from './avatar.js';
import { buildPerson } from './person.js';
import { EXPRESSION_NAMES } from './expressions.js';
import { disposeModelCache, countTriangles } from './util.js';
import { setCharacterQuality, getCharacterQuality } from './charquality.js';
import * as index from './characters-index.js';

afterAll(() => disposeModelCache());

const box = (o) => {
  o.updateWorldMatrix(true, true);
  return new Box3().setFromObject(o);
};

function trackOwned(obj) {
  const owned = [];
  const seen = new Set();
  const add = (x) => {
    if (!x || seen.has(x) || x.userData?.shared) return;
    seen.add(x);
    owned.push(x);
    const orig = x.dispose.bind(x);
    x.__disposed = false;
    x.dispose = () => {
      x.__disposed = true;
      orig();
    };
  };
  obj.traverse((o) => {
    add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      add(m);
      for (const slot of ['map', 'emissiveMap', 'normalMap']) add(m[slot]);
    }
  });
  return owned;
}

function noNaN(obj) {
  obj.updateWorldMatrix(true, true);
  obj.traverse((o) => {
    for (const v of [o.position, o.scale]) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
    expect(Number.isFinite(o.quaternion.x + o.quaternion.y + o.quaternion.z + o.quaternion.w)).toBe(true);
    expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true);
    const p = o.geometry?.attributes?.position;
    if (p) for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) throw new Error(`NaN in geometry of ${o.name || o.type}`);
    const n = o.geometry?.attributes?.normal;
    if (n) for (let i = 0; i < n.array.length; i++) if (!Number.isFinite(n.array[i])) throw new Error(`NaN normal in ${o.name || o.type}`);
    const inf = o.morphTargetInfluences;
    if (inf) for (const v of inf) expect(Number.isFinite(v)).toBe(true);
  });
}

/** Height of the sculpted head skin in head space (rest positions, without morph deltas). */
function skinHeight(head) {
  const a = head.skinMesh.geometry.attributes.position;
  let lo = 9;
  let hi = -9;
  for (let i = 0; i < a.count; i++) {
    lo = Math.min(lo, a.getY(i));
    hi = Math.max(hi, a.getY(i));
  }
  return hi - lo;
}

/** Hash of every vertex position in a customer (determinism and variation checks). */
function sig(obj) {
  let h = 0;
  obj.traverse((o) => {
    const a = o.geometry?.attributes?.position?.array;
    if (!a || o.geometry.userData.shared) return;
    for (let i = 0; i < a.length; i += 11) h = (h * 31 + Math.round(a[i] * 1e4)) | 0;
  });
  return h;
}

vi.setConfig({ testTimeout: 60000 });

describe('customers', () => {
  for (const kind of Object.keys(CUSTOMER_KINDS)) {
    it(`${kind}: builds with real proportions, runs every mood at patience extremes, disposes`, () => {
      const c = buildCustomer(kind, 7);
      const main = c.people[0].p;
      const hb = box(main.group);
      const height = hb.max.y - hb.min.y;
      expect(height).toBeGreaterThan(1.5);
      expect(height).toBeLessThan(1.9);
      // about 7.5 heads
      const head = main.head;
      const headH = skinHeight(head) * 0.945 * head.group.scale.y; // crown to chin (the skin loft also has an under-jaw plate)
      const heads = main.height / headH;
      expect(heads).toBeGreaterThan(6.8);
      expect(heads).toBeLessThan(8.3);
      const limit = kind === 'family' ? 14000 : 9000;
      expect(countTriangles(c.group)).toBeLessThan(limit);
      expect(c.group.userData.height).toBeGreaterThan(1.5);
      const owned = trackOwned(c.group);
      let t = 0;
      for (const m of MOODS) {
        c.setMood(m);
        for (const p of [0, 0.1, 0.3, 0.5, 0.7, 1]) {
          c.setPatience(p);
          for (let i = 0; i < 6; i++) c.update(0.016, (t += 0.016));
        }
        c.setSpeaking(800, 0.9);
        for (let i = 0; i < 8; i++) c.update(0.033, (t += 0.033));
      }
      for (const e of EXPRESSION_NAMES) {
        c.setExpression(e, 1, 50);
        for (let i = 0; i < 4; i++) c.update(0.02, (t += 0.02));
      }
      c.lookAt(new Vector3(1, 1.6, 2));
      c.lookAt(null);
      c.setMood('nonsense');
      c.setPatience(NaN);
      c.update(NaN, NaN);
      c.update(Infinity, 0);
      noNaN(c.group);
      c.dispose();
      c.dispose();
      expect(owned.every((o) => o.__disposed)).toBe(true);
    });
  }

  it('faces +z towards the cook', () => {
    const c = buildCustomer('office', 3);
    c.update(0.016, 1);
    c.group.updateWorldMatrix(true, true);
    const eye = c.people[0].p.head.eyes[0];
    const wp = new Vector3();
    const head = c.people[0].p.head.group;
    head.getWorldPosition(wp);
    const nose = new Vector3(0, 0, 1);
    head.localToWorld(nose);
    expect(nose.z).toBeGreaterThan(wp.z);
    expect(eye).toBeTruthy();
  });

  it('walks away with its back turned', () => {
    const c = buildCustomer('student', 2);
    c.setMood('walkaway');
    for (let i = 0; i < 120; i++) c.update(0.033, i * 0.033);
    const fwd = new Vector3(0, 0, 1).applyQuaternion(c.group.children[0].quaternion);
    expect(fwd.z).toBeLessThan(-0.8);
  });

  it('is deterministic per seed and varies between seeds', () => {
    expect(sig(buildCustomer('office', 3).group)).toBe(sig(buildCustomer('office', 3).group));
    for (const kind of ['student', 'techie', 'uncle']) {
      const sigs = new Set([1, 2, 3, 4, 5, 6].map((s) => sig(buildCustomer(kind, s).group)));
      expect(sigs.size).toBeGreaterThan(4);
    }
  });

  it('family: a parent and a correctly scaled child', () => {
    const c = buildCustomer('family', 4);
    expect(c.people).toHaveLength(2);
    const p = box(c.people[0].p.group);
    const k = box(c.people[1].p.group);
    const ph = p.max.y - p.min.y;
    const kh = k.max.y - k.min.y;
    expect(kh).toBeGreaterThan(0.85);
    expect(kh).toBeLessThan(ph * 0.75);
    const kid = c.people[1].p;
    const hh = skinHeight(kid.head) * 0.945 * kid.head.group.scale.y;
    expect(kid.height / hh).toBeLessThan(6.6); // a child's head is bigger relative to the body
    expect(box(c.group).getSize(new Vector3()).x).toBeGreaterThan(0.6);
  });

  it('keeps the patience ring (arc proportional to patience) and the pay note', () => {
    const c = buildCustomer('office', 1);
    c.setMood('waiting');
    let fill = null;
    c.group.traverse((o) => {
      if (o.geometry && o.geometry.index && !o.geometry.userData.shared && o.geometry.type === 'RingGeometry') fill = o.geometry;
    });
    c.setPatience(1);
    c.update(0.016, 1);
    const full = fill.drawRange.count;
    c.setPatience(0.5);
    c.update(0.016, 1.1);
    expect(fill.drawRange.count).toBeLessThan(full);
    expect(fill.drawRange.count).toBeGreaterThan(0);
    c.setMood('paying');
    c.update(0.016, 2);
    let note = false;
    c.group.traverse((o) => {
      if (o.isMesh && o.visible && o.material?.emissiveMap) note = true;
    });
    expect(note).toBe(true);
  });

  it('expression follows the mood and patience', () => {
    const c = buildCustomer('office', 5);
    const e = c.people[0].p.head.expr;
    c.setMood('angry');
    expect(e.name).toBe('angry');
    c.setMood('waiting');
    c.setPatience(1);
    expect(e.name).toBe('neutral');
    c.setPatience(0.3);
    expect(e.name).toBe('impatient');
    c.setMood('happy');
    expect(e.name).toBe('delighted');
    c.setExpression('sad');
    expect(e.name).toBe('sad');
  });
});

describe('characters-index', () => {
  it('re-exports the whole people API', () => {
    for (const k of ['buildCustomer', 'MOODS', 'buildAvatar', 'POSES', 'buildViewmodel', 'VIEW_ACTIONS', 'buildHead', 'buildPerson', 'EXPRESSION_NAMES', 'setCharacterQuality']) expect(index[k]).toBeTruthy();
  });
});

describe('quality tiers', () => {
  it('low and medium customers are lighter than high', () => {
    const prev = getCharacterQuality();
    setCharacterQuality('high');
    const hi = countTriangles(buildCustomer('office', 3).group);
    setCharacterQuality('medium');
    const me = countTriangles(buildCustomer('office', 3).group);
    setCharacterQuality('low');
    const lo = countTriangles(buildCustomer('office', 3).group);
    setCharacterQuality(prev);
    expect(me).toBeLessThan(hi);
    expect(lo).toBeLessThan(me);
  });
});

describe('avatar', () => {
  it('builds, poses, holds dishes, disposes, under budget', () => {
    const a = buildAvatar({ color: '#12908e', name: 'Sana' });
    const b = box(a.group);
    expect(b.max.y).toBeGreaterThan(1.5);
    expect(countTriangles(a.group)).toBeLessThan(9000 + 1500); // + tools in hands
    const owned = trackOwned(a.group);
    let t = 0;
    for (const p of POSES) {
      a.setPose(p);
      for (const dir of [-1, 0, 1]) {
        a.setFacing(dir);
        for (let i = 0; i < Math.ceil(WORK_MS / 16) + 5; i++) a.update(0.016, (t += 0.016));
      }
    }
    a.setPose('bogus');
    a.setLane(0.38);
    a.setHands([{ dish: 'dosa', q: 'perfect' }, { dish: 'irani_chai', q: 'good' }, { dish: 'idly', q: 'ok' }]);
    let dishes = 0;
    a.group.traverse((o) => {
      if (o.name?.startsWith('dish-')) dishes += 1;
    });
    expect(dishes).toBeLessThanOrEqual(2);
    a.setHands([]);
    a.setHands(null);
    a.update(0.016, t + 1);
    noNaN(a.group);
    const trackedAfter = trackOwned(a.group);
    a.dispose();
    a.dispose();
    expect(owned.every((o) => o.__disposed)).toBe(true);
    expect(trackedAfter.length).toBeGreaterThan(0);
  });
  it('every pose is under budget with its tools out', () => {
    const a = buildAvatar({ color: '#ff8a1f', name: 'Ravi' });
    let worst = 0;
    let t = 0;
    for (const p of POSES) {
      a.setPose(p);
      for (let i = 0; i < 12; i++) a.update(0.02, (t += 0.02));
      let n = 0;
      a.group.traverse((o) => {
        let vis = true;
        for (let q = o; q; q = q.parent) if (q.visible === false) vis = false;
        if (vis && o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      });
      worst = Math.max(worst, n);
    }
    expect(worst).toBeLessThan(11000);
  });
  it('different players look different and faces forward when walking sideways', () => {
    const a = buildAvatar({ color: '#ff0000', name: 'A' });
    const b = buildAvatar({ color: '#00ff00', name: 'B' });
    expect(sig(a.group)).not.toBe(sig(b.group));
    a.setPose('walk');
    a.setFacing(1);
    for (let i = 0; i < 100; i++) a.update(0.03, i * 0.03);
    const fwd = new Vector3(0, 0, 1).applyQuaternion(a.group.children[0].children[0].quaternion);
    expect(fwd.x).toBeGreaterThan(0.9);
  });
});

describe('person', () => {
  it('buildPerson speaks and nods', () => {
    const p = buildPerson({ kind: 'techie', seed: 2, outfit: { top: { kind: 'tee', color: '#888' }, bottom: { kind: 'jeans', color: '#334' }, shoes: { kind: 'shoe' } } });
    p.setSpeaking(1200, 1);
    let jaw = 0;
    for (let i = 0; i < 70; i++) {
      p.update(0.016, i * 0.016);
      jaw = Math.max(jaw, p.head.skinMesh.morphTargetInfluences[p.head.morphAU.indexOf(0)]);
    }
    expect(jaw).toBeGreaterThan(0.2);
    p.dispose();
  });
});
