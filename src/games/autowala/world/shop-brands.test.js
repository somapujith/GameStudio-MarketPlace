import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Scene } from 'three';
import { generateCity, nearestRoad } from './layout.js';
import { createColliders } from './colliders.js';
import { onRoad } from './roads.js';
import { buildShops } from './shops.js';
import {
  BRANDS,
  BRAND_IDS,
  FORECOURT,
  brandOf,
  fitContain,
  onVerge,
  overrideUrls,
  pickOverride,
  planShops,
  planStalls,
} from './shop-brands.js';

const SEEDS = [1, 2, 3];
const cities = new Map(SEEDS.map((s) => [s, generateCity(s)]));
const branded = (city) => city.pois.filter((p) => brandOf(p));
const inLake = (city, x, z) => ((x - city.lake.cx) / city.lake.rx) ** 2 + ((z - city.lake.cz) / city.lake.rz) ** 2 < 1;

describe('brand configs', () => {
  it('are complete', () => {
    expect(BRAND_IDS.sort()).toEqual(['bawarchi', 'delhi', 'oyo', 'paradise']);
    for (const id of BRAND_IDS) {
      const b = BRANDS[id];
      expect(b.id).toBe(id);
      expect(b.name.length).toBeGreaterThan(2);
      expect(b.te.length).toBeGreaterThan(0);
      expect(['restaurant', 'sweets', 'hotel']).toContain(b.kind);
      expect(b.W).toBeGreaterThanOrEqual(b.minW);
      expect(b.D).toBeGreaterThanOrEqual(b.minD);
      expect(Math.abs(b.hailX)).toBeLessThan(0.5);
    }
  });
  it('maps the pois (the original paradise landmark has no brand field)', () => {
    expect(brandOf({ id: 'paradise' })).toBe('paradise');
    expect(brandOf({ id: 'x', brand: 'oyo' })).toBe('oyo');
    expect(brandOf({ id: 'charminar' })).toBe(null);
    expect(brandOf({ id: 'x', brand: 'nope' })).toBe(null);
  });
});

describe('logo override logic', () => {
  it('lists same-origin candidates in priority order', () => {
    expect(overrideUrls('paradise')).toEqual(['/art/brands/paradise.png', '/art/brands/paradise.webp', '/art/brands/paradise.svg']);
    expect(overrideUrls('oyo', '/hub')[0]).toBe('/hub/art/brands/oyo.png');
    expect(overrideUrls('oyo', '/hub/')[2]).toBe('/hub/art/brands/oyo.svg');
  });
  it('picks the first file that loaded and nothing when none did', () => {
    expect(pickOverride([{ url: 'a', ok: false }, { url: 'b', ok: true }, { url: 'c', ok: true }])).toBe('b');
    expect(pickOverride([{ url: 'a', ok: false }, null])).toBe(null);
    expect(pickOverride([])).toBe(null);
  });
  it('fits an image inside a box without distortion', () => {
    const f = fitContain(200, 100, 100, 100);
    expect(f.w).toBeCloseTo(100);
    expect(f.h).toBeCloseTo(50);
    expect(f.y).toBeCloseTo(25);
    expect(fitContain(0, 0, 80, 40)).toEqual({ x: 0, y: 0, w: 80, h: 40 });
  });
});

describe.each(SEEDS)('shop plans, seed %i', (seed) => {
  const city = cities.get(seed);
  const plans = planShops(city);
  it('gives every placed branded poi exactly one plan', () => {
    const ids = branded(city).map((p) => p.id).sort();
    expect(plans.map((p) => p.id).sort()).toEqual(ids);
    expect(new Set(plans.map((p) => p.id)).size).toBe(plans.length);
    expect(plans.length).toBeGreaterThanOrEqual(6);
  });
  it('keeps every building inside its block with a forecourt toward a road', () => {
    for (const p of plans) {
      const poi = city.poiById[p.id];
      const f = p.footprint;
      expect(f.cx - f.w / 2).toBeGreaterThanOrEqual(poi.x - poi.w / 2 - 1e-6);
      expect(f.cx + f.w / 2).toBeLessThanOrEqual(poi.x + poi.w / 2 + 1e-6);
      expect(f.cz - f.d / 2).toBeGreaterThanOrEqual(poi.z - poi.d / 2 - 1e-6);
      expect(f.cz + f.d / 2).toBeLessThanOrEqual(poi.z + poi.d / 2 + 1e-6);
      // the front face is FORECOURT metres from the block edge on the facing side
      const edge = p.f.x !== 0 ? (p.f.x > 0 ? poi.x + poi.w / 2 : poi.x - poi.w / 2) : p.f.z > 0 ? poi.z + poi.d / 2 : poi.z - poi.d / 2;
      const frontFace = p.f.x !== 0 ? p.cx + (p.f.x * p.D) / 2 : p.cz + (p.f.z * p.D) / 2;
      expect(Math.abs(edge - frontFace)).toBeCloseTo(FORECOURT, 4);
      expect(p.W).toBeGreaterThanOrEqual(BRANDS[p.brand].minW);
      expect(p.D).toBeGreaterThanOrEqual(BRANDS[p.brand].minD);
    }
  });
  it('puts hail spots on the pavement, clear of colliders, near the road, with a road front', () => {
    const colliders = createColliders();
    for (const p of plans) colliders.addCentered(p.footprint.cx, p.footprint.cz, p.footprint.w, p.footprint.d, 'building', 16);
    for (const p of plans) {
      expect(colliders.inside(p.hail.x, p.hail.z, 0.4)).toBe(null);
      expect(onRoad(city, p.hail.x, p.hail.z, 0)).toBe(null);
      expect(inLake(city, p.hail.x, p.hail.z)).toBe(false);
      expect(onVerge(city, p.hail.x, p.hail.z, 5)).toBe(true);
      const r = nearestRoad(city, p.hail.x, p.hail.z);
      expect(r.dist - r.edge.w / 2).toBeLessThanOrEqual(5);
      // front: the nearest road point to the hail spot, on the carriageway
      expect(p.front.edge).toBe(r.edge.id);
      expect(onRoad(city, p.front.x, p.front.z, 0.05)).not.toBe(null);
    }
  });
  it('does not overlap the footprints of two shops', () => {
    for (let i = 0; i < plans.length; i++) {
      for (let j = i + 1; j < plans.length; j++) {
        const a = plans[i].footprint;
        const b = plans[j].footprint;
        const overlap = Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cz - b.cz) < (a.d + b.d) / 2;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe.each(SEEDS)('pavement stalls, seed %i', (seed) => {
  const city = cities.get(seed);
  const plans = planShops(city);
  const colliders = createColliders();
  for (const p of plans) colliders.addCentered(p.footprint.cx, p.footprint.cz, p.footprint.w, p.footprint.d, 'building', 16);
  const stalls = planStalls(city, { count: 25, blocked: (x, z, pad) => !!colliders.inside(x, z, pad), avoid: plans.map((p) => p.hail) });
  it('finds about 25 sites, deterministically', () => {
    expect(stalls.length).toBeGreaterThanOrEqual(18);
    expect(stalls.length).toBeLessThanOrEqual(25);
    const again = planStalls(city, { count: 25, blocked: (x, z, pad) => !!colliders.inside(x, z, pad), avoid: plans.map((p) => p.hail) });
    expect(again.map((s) => [s.x, s.z])).toEqual(stalls.map((s) => [s.x, s.z]));
  });
  it('stands on sidewalks: off the carriageway, inside a block, within the verge, not in a collider or the lake', () => {
    for (const s of stalls) {
      expect(onRoad(city, s.x, s.z, 0)).toBe(null);
      expect(onVerge(city, s.x, s.z)).toBe(true);
      expect(onVerge(city, s.hail.x, s.hail.z)).toBe(true);
      expect(colliders.inside(s.x, s.z, 0.6)).toBe(null);
      expect(colliders.inside(s.hail.x, s.hail.z, 0.3)).toBe(null);
      expect(inLake(city, s.x, s.z)).toBe(false);
      const r = nearestRoad(city, s.x, s.z);
      expect(r.dist - r.edge.w / 2).toBeGreaterThan(0.8);
      expect(r.dist - r.edge.w / 2).toBeLessThan(2.4);
    }
  });
  it('keeps stalls apart and finds more of them in the Old City', () => {
    for (let i = 0; i < stalls.length; i++) for (let j = i + 1; j < stalls.length; j++) expect(Math.hypot(stalls[i].x - stalls[j].x, stalls[i].z - stalls[j].z)).toBeGreaterThan(40);
    const old = stalls.filter((s) => Math.hypot(s.x - 150, s.z - 255) < 240).length;
    expect(old).toBeGreaterThanOrEqual(3);
  });
});

// ---- the registry itself, with a stub canvas so the textures can be "drawn" in node
describe('buildShops registry (generateCity(1) and two more seeds)', () => {
  let savedDoc;
  beforeAll(() => {
    savedDoc = globalThis.document;
    const grad = { addColorStop() {} };
    const ctx = new Proxy({}, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return () => ({ width: 10 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
        if (k === 'canvas') return t.__canvas;
        return () => {};
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    });
    globalThis.document = { createElement: () => { const c = { width: 0, height: 0, getContext: () => { ctx.__canvas = c; return ctx; } }; return c; } };
  });
  afterAll(() => {
    globalThis.document = savedDoc;
  });
  it.each(SEEDS)('seed %i: one shop per branded poi, plus stalls, all with valid hail spots', (seed) => {
    const city = cities.get(seed);
    for (const p of city.pois) {
      const r = nearestRoad(city, p.x, p.z);
      p.front = r ? { x: r.x, z: r.z, edge: r.edge.id, t: r.t } : { x: p.x, z: p.z };
    }
    const scene = new Scene();
    const colliders = createColliders();
    const world = buildShops(scene, city, colliders, { uNight: { value: 0 } }, null);
    const brandedIds = branded(city).map((p) => p.id).sort();
    const shopsOnly = world.shops.filter((s) => s.kind !== 'stall');
    expect(shopsOnly.map((s) => s.id).sort()).toEqual(brandedIds);
    const stalls = world.shops.filter((s) => s.kind === 'stall');
    expect(stalls.length).toBeGreaterThanOrEqual(18);
    for (const s of world.shops) {
      expect(typeof s.name).toBe('string');
      expect(s.te).toBeTruthy();
      expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
      expect(s.front && Number.isFinite(s.front.x) && Number.isFinite(s.front.edge)).toBe(true);
      expect(onRoad(city, s.front.x, s.front.z, 0.05)).not.toBe(null);
      expect(onRoad(city, s.hail.x, s.hail.z, 0)).toBe(null);
      // the building / cart itself is a collider, the customer's spot is not inside any collider
      expect(colliders.inside(s.hail.x, s.hail.z, 0.2)).toBe(null);
    }
    expect(scene.children.length).toBeGreaterThan(0);
    world.update(0.8, 3);
    world.update(0, 4);
    world.dispose();
    expect(scene.children.length).toBe(0);
  }, 90000);
});
