import { afterAll, describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { CUSTOMER_KINDS, DISHES, HANDS_MAX, STATION_KINDS } from '../../../../shared/tiffin-centre/catalog.js';
import { WORK_MS } from '../../../../shared/tiffin-centre/movement.js';
import { MOODS, POSES, QUALITIES, STREET_PROP_IDS, buildAvatar, buildCustomer, buildDish, buildStationProp, buildStreetProp, countTriangles, disposeModelCache, disposeObject, makeCanvasTexture, materials, palette } from './index.js';

afterAll(() => disposeModelCache());

const box = (o) => {
  o.updateWorldMatrix(true, true);
  return new Box3().setFromObject(o);
};
const size = (o) => box(o).getSize(new Vector3());

/** Every non-shared geometry / material / texture under obj, with spies on dispose. */
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
      for (const slot of ['map', 'emissiveMap']) add(m[slot]);
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
  });
}

describe('canvas helpers', () => {
  it('makeCanvasTexture falls back to a stub in node', () => {
    const t = makeCanvasTexture(8, 8, () => {});
    expect(t.userData.stub).toBe(true);
    t.dispose();
  });
  it('palette follows the plan', () => {
    expect(palette.saffron).toBe('#ff8a1f');
    expect(palette.night).toBe('#141a33');
  });
  it('shared materials are cached and flat shaded', () => {
    expect(materials.solid('#ff0000')).toBe(materials.solid('#ff0000'));
    expect(materials.solid('#ff0000').flatShading).toBe(true);
    expect(materials.vertex().roughness).toBe(0.8);
  });
});

describe('dishes', () => {
  for (const id of Object.keys(DISHES)) {
    for (const q of QUALITIES) {
      it(`${id} (${q}) builds within budget`, () => {
        const d = buildDish(id, q);
        expect(d.children.length).toBeGreaterThan(0);
        const s = size(d);
        const b = box(d);
        expect(s.x).toBeLessThan(0.45);
        expect(s.z).toBeLessThan(0.45);
        expect(s.y).toBeLessThan(0.4);
        expect(s.x).toBeGreaterThan(0.18);
        expect(b.min.y).toBeGreaterThan(-0.01);
        expect(b.min.y).toBeLessThan(0.02);
        expect(countTriangles(d)).toBeLessThan(1200);
        noNaN(d);
      });
    }
  }
  it('dishes share cached geometry and disposeObject keeps it intact', () => {
    const a = buildDish('idly', 'good');
    const b = buildDish('idly', 'good');
    expect(a.children[0].geometry).toBe(b.children[0].geometry);
    disposeObject(a);
    expect(b.children[0].geometry.attributes.position.count).toBeGreaterThan(0);
  });
  it('quality changes the look', () => {
    expect(buildDish('dosa', 'perfect').children.length).toBeGreaterThan(buildDish('dosa', 'good').children.length);
    const burnt = buildDish('dosa', 'burnt').children[0].geometry.attributes.color;
    const good = buildDish('dosa', 'good').children[0].geometry.attributes.color;
    const sum = (a) => a.array.reduce((x, y) => x + y, 0);
    expect(sum(burnt)).toBeLessThan(sum(good));
  });
  it('an unknown dish still builds', () => {
    expect(buildDish('nope').children.length).toBeGreaterThan(0);
  });
});

describe('station props', () => {
  for (const kind of Object.keys(STATION_KINDS)) {
    it(`${kind}: structure, anchors, slots, dispose`, () => {
      const st = buildStationProp(kind);
      expect(st.slotAnchors).toHaveLength(STATION_KINDS[kind].slots);
      const b = size(st.group);
      expect(b.x).toBeLessThan(1.75);
      expect(b.x).toBeGreaterThan(1.0);
      expect(b.y).toBeLessThan(2.0);
      expect(countTriangles(st.group)).toBeLessThan(7000);
      const dishes = Object.values(DISHES).filter((d) => d.station === kind);
      const states = ['empty', 'cooking', 'ready', 'burnt'];
      let t = 0;
      for (let i = 0; i < st.slotAnchors.length; i++) {
        for (const d of dishes) {
          for (const s of states) {
            for (const p of [0, 0.4, 1]) {
              st.setSlot(i, { st: s, dish: d.id, progress: p });
              st.update(0.016, (t += 0.016));
            }
          }
        }
        st.setSlot(i, null);
        st.setSlot(i, { st: 'bogus', dish: 5, progress: NaN });
      }
      st.setSlot(99, { st: 'ready' });
      st.update(0.016, t);
      noNaN(st.group);
      const w = st.slotWorld(0);
      expect(Number.isFinite(w.x + w.y + w.z)).toBe(true);
      for (const a of st.slotAnchors) expect(a.y).toBeGreaterThan(0.8);
      const owned = trackOwned(st.group);
      expect(owned.length).toBeGreaterThan(0);
      st.dispose();
      st.dispose();
      expect(owned.every((o) => o.__disposed)).toBe(true);
    });
  }
  it('anchors are left to right', () => {
    for (const kind of Object.keys(STATION_KINDS)) {
      const a = buildStationProp(kind).slotAnchors;
      for (let i = 1; i < a.length; i++) expect(a[i].x).toBeGreaterThan(a[i - 1].x);
    }
  });
});

describe('customers', () => {
  for (const kind of Object.keys(CUSTOMER_KINDS)) {
    it(`${kind}: builds, animates every mood, disposes`, () => {
      const c = buildCustomer(kind, 7);
      const s = size(c.group);
      expect(s.y).toBeGreaterThan(1.1);
      expect(s.y).toBeLessThan(2.1);
      expect(countTriangles(c.group)).toBeLessThan(5000);
      let t = 0;
      for (const m of MOODS) {
        c.setMood(m);
        for (const p of [0, 0.1, 0.3, 0.7, 1]) {
          c.setPatience(p);
          for (let i = 0; i < 5; i++) c.update(0.016, (t += 0.016));
        }
      }
      c.setMood('nonsense');
      c.setPatience(NaN);
      c.update(NaN, NaN);
      noNaN(c.group);
      const owned = trackOwned(c.group);
      c.dispose();
      c.dispose();
      expect(owned.every((o) => o.__disposed)).toBe(true);
    });
  }
  it('is deterministic per seed and varies between seeds', () => {
    const sig = (kind, seed) => {
      const c = buildCustomer(kind, seed);
      const g = [];
      c.group.traverse((o) => {
        if (o.geometry?.attributes?.color) g.push(o.geometry.attributes.color.array[0].toFixed(3), o.geometry.attributes.color.array[1].toFixed(3));
      });
      return `${g.join(',')}|${size(c.group).y.toFixed(3)}`;
    };
    expect(sig('office', 3)).toBe(sig('office', 3));
    const sigs = new Set([1, 2, 3, 4, 5, 6].map((s) => sig('student', s)));
    expect(sigs.size).toBeGreaterThan(2);
  });
  it('family is wider than a single person', () => {
    expect(size(buildCustomer('family', 1).group).x).toBeGreaterThan(0.6);
  });
  it('patience ring draws an arc proportional to patience', () => {
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
  });
});

describe('avatar', () => {
  it('builds, poses, holds dishes, disposes', () => {
    const a = buildAvatar({ color: '#12908e', name: 'Sana' });
    expect(size(a.group).y).toBeGreaterThan(1.4);
    expect(countTriangles(a.group)).toBeLessThan(5000);
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
    expect(dishes).toBe(HANDS_MAX);
    a.setHands([]);
    a.setHands(null);
    a.update(0.016, t + 1);
    noNaN(a.group);
    const owned = trackOwned(a.group);
    a.dispose();
    a.dispose();
    expect(owned.every((o) => o.__disposed)).toBe(true);
  });
  it('different players look different', () => {
    const sig = (n, c) => {
      const a = buildAvatar({ color: c, name: n });
      let s = '';
      a.group.traverse((o) => {
        if (o.geometry?.attributes?.color) s += o.geometry.attributes.color.array.slice(0, 3).join(',');
      });
      return s;
    };
    expect(sig('A', '#ff0000')).not.toBe(sig('B', '#00ff00'));
  });
});

describe('street props', () => {
  for (const id of STREET_PROP_IDS) {
    it(`${id} builds and disposes`, () => {
      const p = buildStreetProp(id, { text: 'Anna Tiffins', te: 'x' });
      expect(p.group.children.length).toBeGreaterThan(0);
      expect(countTriangles(p.group)).toBeLessThan(8000);
      for (let i = 0; i < 20; i++) p.update(0.016, i * 0.05);
      noNaN(p.group);
      const owned = trackOwned(p.group);
      p.dispose();
      p.dispose();
      expect(owned.every((o) => o.__disposed)).toBe(true);
    });
  }
  it('auto-rickshaw takes two colours', () => {
    const a = buildStreetProp('auto-rickshaw', { body: '#2f9e5b', roof: '#111111' });
    const b = buildStreetProp('auto-rickshaw', { body: '#f4c20d', roof: '#111111' });
    expect(a.group.children[0].geometry).not.toBe(b.group.children[0].geometry);
  });
});
