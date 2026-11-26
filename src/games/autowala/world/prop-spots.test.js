import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateCity } from './layout.js';
import { createColliders } from './colliders.js';
import { createRoadProbe, dropSpotsOnRoads } from './prop-spots.js';
import { makeRng } from '../game/rng.js';

const city = generateCity(1);

/** The honest answer, slowly: distance to the nearest carriageway edge, minus its half width. */
function brute(x, z) {
  let best = Infinity;
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(1, ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len));
    best = Math.min(best, Math.hypot(x - (a.x + e.dx * e.len * t), z - (a.z + e.dz * e.len * t)) - e.w / 2);
  }
  return best;
}

describe('createRoadProbe', () => {
  const probe = createRoadProbe(city);
  it('agrees with a brute-force scan wherever a prop could matter (within 2 m of a road)', () => {
    const rng = makeRng(3);
    let near = 0;
    for (let i = 0; i < 4000; i++) {
      const e = city.edges[Math.floor(rng() * city.edges.length)];
      const a = city.nodes[e.a];
      const t = rng();
      const off = rng.range(-e.w / 2 - 2.5, e.w / 2 + 2.5);
      const x = a.x + e.dx * e.len * t - e.dz * off;
      const z = a.z + e.dz * e.len * t + e.dx * off;
      const truth = brute(x, z);
      if (truth < 2) {
        near++;
        expect(probe.clearance(x, z)).toBeCloseTo(truth, 6);
      }
    }
    expect(near).toBeGreaterThan(1500);
  });
  it('is far away from roads in the middle of nowhere', () => {
    expect(probe.clearance(99999, 99999)).toBe(Infinity);
  });
});

describe('dropSpotsOnRoads', () => {
  const probe = createRoadProbe(city);
  it('filters in place, keeps the order of the rest and reports what it dropped', () => {
    const e = city.edges.find((q) => q.len > 40);
    const a = city.nodes[e.a];
    const onRoad = { x: a.x + e.dx * 20, z: a.z + e.dz * 20 };
    const beside = { x: onRoad.x - e.dz * (e.w / 2 + 2.2), z: onRoad.z + e.dx * (e.w / 2 + 2.2) };
    const list = [{ ...beside, id: 1 }, { ...onRoad, id: 2 }, { x: 1e6, z: 1e6, id: 3 }];
    const same = list;
    expect(dropSpotsOnRoads(probe, list, 1.2)).toBe(1);
    expect(list).toBe(same);
    expect(list.map((s) => s.id)).toEqual([1, 3]);
  });
});

// The real thing: the street furniture props.js places on the seed-1 city. Needs a canvas stub (textures are drawn in 2D).
describe('buildProps never plants a solid in a lane (51 trees, palms and lamps used to stand on carriageways)', () => {
  let buildProps;
  beforeAll(async () => {
    const grad = { addColorStop() {} };
    const ctx2d = new Proxy({ measureText: (s) => ({ width: String(s).length * 7 }), createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => ({}) }, {
      get: (t, k) => (k in t ? t[k] : () => {}),
      set: () => true,
    });
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
    ({ buildProps } = await import('./props.js'));
  });
  afterAll(() => {
    delete globalThis.document;
  });

  it('no tree, palm or lamp collider within 0.3 m of a carriageway', async () => {
    const { Scene } = await import('three');
    const colliders = createColliders();
    const shared = { uTime: { value: 0 }, uWet: { value: 0 }, uNight: { value: 0 } };
    buildProps(new Scene(), city, colliders, shared, 1);
    const boxes = colliders.near(0, 0, 3000).filter((b) => b.tag === 'prop');
    expect(boxes.length).toBeGreaterThan(2000);
    const bad = boxes.filter((b) => brute((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) < 0.3);
    expect(bad.map((b) => [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2])).toEqual([]);
  }, 60000);
});
