import { afterAll, describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { DISHES, STATION_KINDS } from '../../../../shared/tiffin-centre/catalog.js';
import { buildDish, QUALITIES, buildStationProp, disposeFood, setQuality, getQuality, QUALITY_TIERS } from './food-index.js';
import { disposeModelCache } from './util.js';
import { fbm, heightToNormal, hash2, vnoise, worley } from './noise.js';
import { mapSet, pbrMaterial, textureSet, RECIPE_NAMES } from './pbr.js';

afterAll(() => {
  disposeModelCache();
  disposeFood();
  setQuality('high');
});

/** Triangles that are actually drawn (hidden meshes are skipped). */
const visibleTris = (obj) => {
  let n = 0;
  const walk = (o) => {
    if (o.visible === false) return;
    if (o.isMesh && o.geometry) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    o.children.forEach(walk);
  };
  walk(obj);
  return Math.round(n);
};
function assertFinite(obj) {
  obj.updateWorldMatrix(true, true);
  obj.traverse((o) => {
    expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true);
    const g = o.geometry;
    if (g) {
      for (const name of ['position', 'normal', 'uv']) {
        const a = g.attributes[name];
        if (a) for (let i = 0; i < a.array.length; i++) if (!Number.isFinite(a.array[i])) throw new Error(`non-finite ${name} in ${o.name || o.type}`);
      }
    }
    const u = o.material && o.material.userData && o.material.userData.tcUniforms;
    if (u) for (const k of Object.keys(u)) if (typeof u[k].value === 'number') expect(Number.isFinite(u[k].value)).toBe(true);
  });
}

describe('noise + maps', () => {
  it('hash and noise are deterministic and in range', () => {
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    for (let i = 0; i < 50; i++) {
      const v = vnoise(i * 0.37, i * 0.91, 8, 8, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(fbm(i * 0.3, i * 0.2, 4, 8, 8)).toBeLessThanOrEqual(1);
      expect(worley(i * 0.3, i * 0.7, 8, 8)).toBeGreaterThanOrEqual(0);
    }
  });
  it('noise tiles with its period', () => {
    expect(vnoise(0.3, 0.4, 8, 8, 1)).toBeCloseTo(vnoise(8.3, 8.4, 8, 8, 1), 6);
  });
  it('height -> normal map: flat height gives (0,0,1), a ramp tilts', () => {
    const flat = heightToNormal(new Float32Array(16), 4, 4, 2);
    expect(flat[0]).toBeGreaterThan(125);
    expect(flat[0]).toBeLessThan(131);
    expect(flat[2]).toBeGreaterThan(250);
    const ramp = new Float32Array(16).map((_, i) => (i % 4) * 0.2);
    const n = heightToNormal(ramp, 4, 4, 2);
    expect(n[(1 * 4 + 1) * 4]).toBeLessThan(120);
  });
  it('map sets are 1x1 stubs in node and cached', () => {
    const a = textureSet('steel-brushed');
    expect(a.stub).toBe(true);
    expect(textureSet('steel-brushed')).toBe(a);
    for (const name of RECIPE_NAMES) expect(textureSet(name).map).toBeTruthy();
    const m = mapSet('t', 32, 32, (u, v, o) => {
      o.r = u;
    });
    expect(m.map.image.width).toBeGreaterThan(0);
  });
  it('pbr materials are shared by key', () => {
    expect(pbrMaterial('wood', { key: 'a' })).toBe(pbrMaterial('wood', { key: 'a' }));
    expect(pbrMaterial('wood', { key: 'a' })).not.toBe(pbrMaterial('wood', { key: 'b' }));
  });
});

describe('quality tiers', () => {
  it('setQuality switches and ignores junk', () => {
    expect(setQuality('low')).toBe('low');
    expect(getQuality()).toBe('low');
    expect(setQuality('nonsense')).toBe('low');
    setQuality('high');
    expect(Object.keys(QUALITY_TIERS)).toEqual(['low', 'medium', 'high']);
    expect(QUALITY_TIERS.low.normal).toBe(false);
  });
});

for (const tier of ['low', 'medium', 'high']) {
  describe(`dishes @ ${tier}`, () => {
    for (const id of Object.keys(DISHES)) {
      it(`${id}: every quality builds within the 2.5k budget`, () => {
        setQuality(tier);
        for (const q of QUALITIES) {
          const d = buildDish(id, q);
          expect(d.children.length).toBeGreaterThan(0);
          expect(visibleTris(d)).toBeLessThan(2500);
          const b = new Box3().setFromObject(d);
          const s = b.getSize(new Vector3());
          expect(s.x).toBeLessThan(0.45);
          expect(s.z).toBeLessThan(0.45);
          expect(s.y).toBeLessThan(0.4);
          expect(b.min.y).toBeGreaterThan(-0.01);
          assertFinite(d);
        }
      });
    }
  });
}

for (const tier of ['low', 'medium', 'high']) {
  describe(`stations @ ${tier}`, () => {
    for (const kind of Object.keys(STATION_KINDS)) {
      it(`${kind}: <= 8k visible triangles, every dish x state x progress, every action beat, dispose`, () => {
        setQuality(tier);
        const st = buildStationProp(kind);
        expect(st.slotAnchors).toHaveLength(STATION_KINDS[kind].slots);
        expect(visibleTris(st.group)).toBeLessThan(8000);
        const dishes = Object.values(DISHES)
          .filter((d) => d.station === kind)
          .map((d) => d.id);
        if (!dishes.length) dishes.push('batter_dosa');
        let t = 0;
        for (let i = 0; i < st.slotAnchors.length; i++) {
          for (const dish of dishes) {
            for (const s of ['empty', 'cooking', 'ready', 'burnt']) {
              for (const p of [0, 0.03, 0.4, 1]) {
                st.setSlot(i, { st: s, dish, progress: p, burnFrac: p });
                st.update(0.016, (t += 0.016));
              }
            }
          }
          for (const k of ['pour', 'spread', 'flip', 'oil', 'fill', 'take', 'lid', 'skim', 'bogus']) {
            for (const v of [0, 0.3, 0.7, 1, NaN, 5]) {
              st.setSlot(i, { st: 'cooking', dish: dishes[0], progress: 0.5 });
              st.playAction(i, k, v);
              st.update(0.016, (t += 0.016));
            }
          }
          st.setSlot(i, null);
          st.setSlot(i, { st: 'bogus', dish: 7, progress: NaN });
        }
        st.playAction(99, 'pour', 0.5);
        st.setSlot(99, { st: 'ready' });
        st.update(NaN, NaN);
        assertFinite(st.group);
        const w = st.slotWorld(0);
        expect(Number.isFinite(w.x + w.y + w.z)).toBe(true);
        for (const a of st.slotAnchors) expect(a.y).toBeGreaterThan(0.8);
        st.dispose();
        st.dispose();
      });
    }
  });
}

describe('tawa action hooks', () => {
  it('pour / spread drive the dosa spread, tools can be hidden for the viewmodel', () => {
    setQuality('high');
    const st = buildStationProp('tawa');
    st.setSlot(0, { st: 'cooking', dish: 'dosa', progress: 0.5 });
    let u = null;
    st.group.traverse((o) => {
      if (!u && o.material && o.material.userData.tcUniforms && o.material.userData.tcUniforms.uSpread) u = o.material.userData.tcUniforms;
    });
    st.playAction(0, 'pour', 0.5);
    const poured = u.uSpread.value;
    st.playAction(0, 'spread', 0.5);
    expect(u.uSpread.value).toBeGreaterThan(poured);
    expect(st.tools.ladle).toBeTruthy();
    st.setToolHeld('ladle', true);
    expect(st.tools.ladle.group.visible).toBe(false);
    st.setToolHeld('ladle', false);
    expect(st.tools.ladle.group.visible).toBe(true);
    st.dispose();
  });
});
