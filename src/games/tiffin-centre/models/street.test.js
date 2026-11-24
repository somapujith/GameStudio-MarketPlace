import { afterAll, describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { STREET_ALL_IDS, STREET_EXTRA_IDS, STREET_PROP_IDS, buildStreetProp, streetPropTriangles } from './street.js';
import { countTriangles, disposeModelCache, getTextureQuality, setTextureQuality, texRes } from './util.js';
import { blur, fbm, heightToNormal, normalize01, perlin, worley } from './texgen.js';
import { pbr } from './textures-pbr.js';
import { MAT, streetMat } from './materials-street.js';

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
      for (const slot of ['map', 'emissiveMap', 'normalMap', 'roughnessMap']) add(m[slot]);
    }
  });
  return owned;
}

function noNaN(obj) {
  obj.updateWorldMatrix(true, true);
  obj.traverse((o) => {
    for (const v of [o.position, o.scale]) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
    expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true);
    const g = o.geometry;
    if (g) for (const name of ['position', 'normal', 'uv', 'color']) {
      const a = g.attributes[name];
      if (a) for (let i = 0; i < a.array.length; i++) if (!Number.isFinite(a.array[i])) throw new Error(`NaN in ${name} of ${o.name || o.type}`);
    }
  });
}

// [min, max] of the bounding box height and the widest horizontal side (metres): "real life" sanity per id
const SIZES = {
  lpg: { h: [0.55, 0.75], w: [0.28, 0.9] },
  'tiffin-drum': { h: [0.45, 0.6], w: [0.4, 0.6] },
  'batter-bucket': { h: [0.28, 0.6], w: [0.3, 0.6] },
  'plate-stack': { h: [0.1, 0.2], w: [0.25, 0.7] },
  stool: { h: [0.4, 0.47], w: [0.35, 0.5] },
  bench: { h: [0.4, 0.5], w: [1.6, 1.9] },
  thela: { h: [0.7, 1.2], w: [1.8, 3.0] },
  'tube-light': { h: [0.05, 1.6], w: [1.1, 2.6] },
  'pole-with-wires': { h: [5.5, 7.5], w: [1.5, 20] },
  'panipuri-cart': { h: [1.5, 2.6], w: [1.4, 2.2] },
  'auto-rickshaw': { h: [1.6, 1.9], w: [2.4, 2.9] },
  scooter: { h: [1.0, 1.4], w: [1.6, 2.0] },
  motorbike: { h: [1.0, 1.4], w: [1.7, 2.5] },
  dog: { h: [0.45, 0.8], w: [0.7, 1.2] },
  cow: { h: [1.1, 1.6], w: [1.7, 2.6] },
  'flex-banner': { h: [0.8, 2.0], w: [2.9, 3.3] },
  'money-box': { h: [0.15, 0.3], w: [0.25, 0.4] },
};
const TRI_BUDGET = { 'auto-rickshaw': 6000, motorbike: 6000, scooter: 4200 };

describe('texture generators (pure, node-safe)', () => {
  it('perlin / fbm / worley tile seamlessly and stay in range', () => {
    const N = 32;
    for (const f of [normalize01(perlin(N, 4, 4, 3)), fbm(N, { cx: 3, oct: 4, seed: 2 }), worley(N, 4, 5).f1]) {
      let wrap = 0;
      let inner = 0;
      for (let y = 0; y < N; y++) {
        wrap += Math.abs(f[y * N] - f[y * N + N - 1]);
        for (let x = 1; x < N; x++) inner += Math.abs(f[y * N + x] - f[y * N + x - 1]) / (N - 1);
      }
      expect(wrap / N).toBeLessThan((inner / N) * 3 + 0.05);
      for (let i = 0; i < f.length; i++) expect(f[i] >= -1e-6 && f[i] <= 1.0001).toBe(true);
    }
  });
  it('is deterministic', () => {
    expect(Array.from(fbm(16, { seed: 4 }))).toEqual(Array.from(fbm(16, { seed: 4 })));
    expect(Array.from(fbm(16, { seed: 4 }))).not.toEqual(Array.from(fbm(16, { seed: 5 })));
  });
  it('height to normal gives unit, upward normals', () => {
    const N = 16;
    const n = heightToNormal(blur(perlin(N, 3, 3, 1), N, 1), N, 3);
    for (let i = 0; i < N * N; i++) {
      const x = n[i * 4] / 127.5 - 1;
      const y = n[i * 4 + 1] / 127.5 - 1;
      const z = n[i * 4 + 2] / 127.5 - 1;
      expect(z).toBeGreaterThan(0);
      expect(Math.hypot(x, y, z)).toBeGreaterThan(0.9);
      expect(Math.hypot(x, y, z)).toBeLessThan(1.1);
    }
  });
  it('quality levels set texture sizes (<= 512, heroes <= 1024) and recipes return stub textures without a canvas', () => {
    const prev = getTextureQuality();
    for (const [q, base, hero] of [['low', 128, 256], ['medium', 256, 512], ['high', 512, 1024]]) {
      setTextureQuality(q);
      expect(texRes(false)).toBe(base);
      expect(texRes(true)).toBe(hero);
    }
    setTextureQuality(prev);
    for (const name of Object.keys(pbr)) {
      if (name === 'fur') continue;
      const s = pbr[name]();
      expect(s.map.userData.stub).toBe(true);
      expect(s.map.userData.shared).toBe(true);
      expect(pbr[name]()).toBe(s); // cached
    }
    expect(pbr.fur().userData.shared).toBe(true);
  });
  it('every named street material builds and is cached/shared', () => {
    for (const name of Object.keys(MAT)) {
      const m = streetMat(name);
      expect(m.userData.shared).toBe(true);
      expect(streetMat(name)).toBe(m);
    }
  });
});

describe('street props', () => {
  it('lists the original ids plus the extras', () => {
    expect(STREET_PROP_IDS).toHaveLength(16);
    expect(STREET_ALL_IDS).toEqual([...STREET_PROP_IDS, ...STREET_EXTRA_IDS]);
    expect(new Set(STREET_ALL_IDS).size).toBe(STREET_ALL_IDS.length);
  });

  for (const id of STREET_ALL_IDS) {
    it(`${id}: builds, sane size, within triangle budget, animates, disposes`, () => {
      const p = buildStreetProp(id, { text: 'Anna Tiffins', te: 'అన్న' });
      expect(p.group.children.length).toBeGreaterThan(0);
      const tris = countTriangles(p.group);
      expect(tris).toBeLessThan(TRI_BUDGET[id] || 3000);
      expect(streetPropTriangles(id, { text: 'Anna Tiffins', te: 'అన్న' })).toBeGreaterThan(0);
      for (let i = 0; i < 60; i++) p.update(0.016, i * 0.05);
      p.update(NaN, NaN);
      noNaN(p.group);
      const s = size(p.group);
      if (SIZES[id]) {
        expect(s.y).toBeGreaterThan(SIZES[id].h[0]);
        expect(s.y).toBeLessThan(SIZES[id].h[1]);
        const wide = Math.max(s.x, s.z);
        expect(wide).toBeGreaterThan(SIZES[id].w[0]);
        expect(wide).toBeLessThan(SIZES[id].w[1]);
      }
      // every standard material needs vertex colours + uvs (the kit guarantees them)
      p.group.traverse((o) => {
        if (o.isMesh && o.geometry.attributes.position && o.material.vertexColors) {
          expect(o.geometry.attributes.color).toBeDefined();
          expect(o.geometry.attributes.uv).toBeDefined();
        }
      });
      const owned = trackOwned(p.group);
      p.dispose();
      p.dispose();
      expect(owned.every((o) => o.__disposed)).toBe(true);
    });
  }

  it('static geometry is shared between instances and survives disposing one', () => {
    const a = buildStreetProp('lpg');
    const b = buildStreetProp('lpg');
    expect(a.group.children[0].geometry).toBe(b.group.children[0].geometry);
    expect(a.group.children[0].material).toBe(b.group.children[0].material);
    a.dispose();
    expect(b.group.children[0].geometry.attributes.position.count).toBeGreaterThan(0);
    b.dispose();
  });

  it('auto-rickshaw takes colours and exposes wheel spin', () => {
    const a = buildStreetProp('auto-rickshaw', { body: '#2f9e5b', roof: '#111111' });
    const b = buildStreetProp('auto-rickshaw', { body: '#f4c20d', roof: '#111111' });
    expect(a.group.children[0].geometry).not.toBe(b.group.children[0].geometry);
    expect(typeof a.setSpeed).toBe('function');
    a.setSpeed(5);
    const wheels = a.group.children.filter((c) => c.name === 'wF');
    expect(wheels).toHaveLength(1);
    const r0 = wheels[0].rotation.x;
    a.update(0.1, 1);
    expect(wheels[0].rotation.x).not.toBe(r0);
  });

  it('dog wags its tail and cow chews', () => {
    const d = buildStreetProp('dog');
    const tail = d.group.children.find((c) => c.name === 'tail');
    d.update(0.016, 0.3);
    const y0 = tail.rotation.y;
    d.update(0.016, 0.45);
    expect(tail.rotation.y).not.toBe(y0);
    const c = buildStreetProp('cow');
    const jaw = c.group.children.find((x) => x.name === 'jaw');
    c.update(0.016, 0.5);
    expect(Number.isFinite(jaw.rotation.x)).toBe(true);
  });

  it('flex banner owns its texture and material', () => {
    const p = buildStreetProp('flex-banner', { text: 'Hello', width: 2 });
    const owned = trackOwned(p.group);
    expect(owned.length).toBeGreaterThan(2);
    p.dispose();
    expect(owned.every((o) => o.__disposed)).toBe(true);
  });
});
