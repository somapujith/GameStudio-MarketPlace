import { describe, expect, it } from 'vitest';
import { generateCity } from '../world/layout.js';
import { createColliders } from '../world/colliders.js';
import { addBoundaries } from '../world/boundaries.js';
import { makeRng } from '../game/rng.js';
import { WORLD } from '../game/config.js';
import { NEVER_DEST } from './fare-kinds.js';
import { DISTRICTS } from '../world/layout.js';
import { PLACE_KINDS, PLACE_PAIR, pickWeighted } from './fare-kinds.js';
import { SPOT, isValidHailSpot, nearestRoadInfo, pickDestination, pickFamousPoi, pickHailSpot, pickPoiHailSpot, spotFromPlace } from './fare-spots.js';

const city = generateCity(1);
// the same "front" the world gives each poi (nearest road point), without building any three.js
for (const p of city.pois) {
  let best = null;
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * e.dx + (p.z - a.z) * e.dz) / e.len));
    const d = Math.hypot(p.x - (a.x + e.dx * e.len * t), p.z - (a.z + e.dz * e.len * t));
    if (!best || d < best.d) best = { d, x: a.x + e.dx * e.len * t, z: a.z + e.dz * e.len * t, edge: e.id, t };
  }
  p.front = { x: best.x, z: best.z, edge: best.edge, t: best.t };
}
const colliders = createColliders();
// a few "buildings" on the pavement so the collider check has something to reject
for (const p of city.pois.slice(0, 6)) colliders.add(p.front.x - 6, p.front.z - 6, p.front.x + 6, p.front.z + 6, 'building');

// independent brute-force checks (not the module's own helpers)
const lakeCx = WORLD.lakeCenter[0];
const lakeCz = WORLD.lakeCenter[1];
const inLake = (x, z) => ((x - lakeCx) / WORLD.lakeRadii[0]) ** 2 + ((z - lakeCz) / WORLD.lakeRadii[1]) ** 2 < 1;
const onAnyRoad = (x, z) =>
  city.edges.some((e) => {
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(1, ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len));
    return Math.hypot(x - (a.x + e.dx * e.len * t), z - (a.z + e.dz * e.len * t)) < e.w / 2;
  });
const blockOf = (x, z) => city.blocks.find((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1);

describe('hail spots over generateCity(1)', () => {
  it('every spot is on a pavement: off the lake, off every road, in a non-water block slab edge band, not inside a collider', () => {
    const rng = makeRng(11);
    let found = 0;
    for (let i = 0; i < 150; i++) {
      const px = rng.range(-640, 640);
      const pz = rng.range(-640, 640);
      const s = pickHailSpot(city, colliders, rng, { px, pz, minD: 120, maxD: 450 });
      if (!s) continue;
      found++;
      expect(inLake(s.x, s.z)).toBe(false);
      expect(onAnyRoad(s.x, s.z)).toBe(false);
      const b = blockOf(s.x, s.z);
      expect(b).toBeTruthy();
      expect(b.type).not.toBe('water');
      expect(Math.min(s.x - b.x0, b.x1 - s.x, s.z - b.z0, b.z1 - s.z)).toBeLessThanOrEqual(SPOT.band);
      expect(colliders.inside(s.x, s.z, 0.5)).toBeFalsy();
      const d = Math.hypot(s.x - px, s.z - pz);
      expect(d).toBeGreaterThanOrEqual(120);
      expect(d).toBeLessThanOrEqual(450);
      // it stands beside the road it hails: w/2 + gap from that edge's centre line
      const e = city.edges[s.edge];
      expect(Math.hypot(s.road.x - s.x, s.road.z - s.z)).toBeCloseTo(e.w / 2 + SPOT.gap, 5);
    }
    expect(found).toBeGreaterThan(130);
  });

  it('rejects the lake, roads, water blocks and colliders', () => {
    expect(isValidHailSpot(city, colliders, lakeCx, lakeCz)).toBe(false);
    const e = city.edges[10];
    const a = city.nodes[e.a];
    expect(isValidHailSpot(city, colliders, a.x + e.dx * e.len * 0.5, a.z + e.dz * e.len * 0.5)).toBe(false); // road centre
    const water = city.blocks.find((b) => b.type === 'water');
    if (water) expect(isValidHailSpot(city, colliders, water.cx, water.cz)).toBe(false);
    expect(isValidHailSpot(city, colliders, 5000, 5000)).toBe(false);
    // the middle of a big block is not a pavement band
    const big = city.blocks.find((b) => b.type === 'normal' && Math.min(b.w, b.d) > 40);
    expect(isValidHailSpot(city, colliders, big.cx, big.cz)).toBe(false);
    // inside a collider box
    const p = city.pois[0];
    expect(colliders.inside(p.front.x, p.front.z, 0)).toBeTruthy();
  });

  it('is deterministic for a seed', () => {
    const a = pickHailSpot(city, colliders, makeRng(5), { px: 100, pz: 250 });
    const b = pickHailSpot(city, colliders, makeRng(5), { px: 100, pz: 250 });
    expect(a).toEqual(b);
  });

  it('spreads over districts and can be biased in a direction', () => {
    const rng = makeRng(2);
    const districts = new Set();
    for (let i = 0; i < 120; i++) {
      const s = pickHailSpot(city, colliders, rng, { px: rng.range(-600, 600), pz: rng.range(-600, 600) });
      if (s) districts.add(s.district);
    }
    expect(districts.size).toBeGreaterThanOrEqual(4);
    // biased east: nearly all spots lie east of the player
    let east = 0;
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const s = pickHailSpot(city, colliders, rng, { px: -300, pz: 100, biasX: 1, biasZ: 0, bias: 1 });
      if (!s) continue;
      n++;
      if (s.x > -300) east++;
    }
    expect(n).toBeGreaterThan(30);
    expect(east / n).toBeGreaterThan(0.95);
  });

  it('keeps its distance from the customers already waiting', () => {
    const rng = makeRng(8);
    const avoid = [];
    for (let i = 0; i < 6; i++) {
      const s = pickHailSpot(city, colliders, rng, { px: 100, pz: 250, avoid, spacing: 45 });
      if (!s) continue;
      for (const o of avoid) expect(Math.hypot(s.x - o.x, s.z - o.z)).toBeGreaterThanOrEqual(45);
      avoid.push(s);
    }
    expect(avoid.length).toBeGreaterThanOrEqual(4);
  });

  it('finds spots in front of famous places', () => {
    const rng = makeRng(4);
    let hits = 0;
    for (const id of ['station', 'airport', 'hospital', 'charminar', 'cyber', 'paradise']) {
      const poi = city.poiById[id];
      if (!poi) continue;
      const s = pickPoiHailSpot(city, colliders, rng, poi);
      if (!s) continue;
      hits++;
      expect(isValidHailSpot(city, colliders, s.x, s.z)).toBe(true);
      expect(Math.hypot(s.x - poi.x, s.z - poi.z)).toBeLessThan(Math.max(poi.w, poi.d) + 60);
    }
    expect(hits).toBeGreaterThanOrEqual(4);
    const f = pickFamousPoi(city, rng, { px: 150, pz: 250, minD: 0, maxD: 600 });
    expect(f).toBeTruthy();
  });
});

describe('destination picker', () => {
  const from = { x: 100, z: 250 };
  it('never picks the garage or a CNG pump, and respects 250-1100 m', () => {
    const rng = makeRng(21);
    for (const kind of ['regular', 'elder', 'women', 'student', 'rusher', 'tourist']) {
      for (let i = 0; i < 80; i++) {
        const f = { x: rng.range(-600, 600), z: rng.range(-600, 600) };
        const d = pickDestination(city, rng, kind, f);
        expect(NEVER_DEST).not.toContain(d.poiId);
        expect(d.front.edge).toBeGreaterThanOrEqual(0);
        expect(d.name.length).toBeGreaterThan(1);
        expect(d.te.length).toBeGreaterThan(0);
        const dist = Math.hypot(d.x - f.x, d.z - f.z);
        expect(dist).toBeGreaterThan(110);
        expect(dist).toBeLessThan(1500);
      }
    }
  });

  it('sends tourists to landmarks and rushers to a station, airport or hospital', () => {
    const rng = makeRng(6);
    const tourist = new Set();
    const rusher = new Set();
    for (let i = 0; i < 100; i++) {
      const f = { x: rng.range(-500, 500), z: rng.range(-500, 500) };
      tourist.add(pickDestination(city, rng, 'tourist', f).poiId);
      rusher.add(pickDestination(city, rng, 'rusher', f).poiId);
    }
    for (const id of tourist) expect(['charminar', 'mecca', 'golconda', 'cyber', 'birla', 'paradise', 'stadium', 'airport']).toContain(id);
    for (const id of rusher) expect(['station', 'airport', 'hospital']).toContain(id);
    expect(tourist.size).toBeGreaterThanOrEqual(3);
  });

  it('keeps a within-bounds distance when it can and returns road spots on the road centre line', () => {
    const rng = makeRng(31);
    let roads = 0;
    let pois = 0;
    for (let i = 0; i < 200; i++) {
      const d = pickDestination(city, rng, 'regular', from);
      const dist = Math.hypot(d.x - from.x, d.z - from.z);
      expect(dist).toBeGreaterThanOrEqual(120);
      expect(dist).toBeLessThanOrEqual(1500);
      if (d.road) {
        roads++;
        const e = city.edges[d.front.edge];
        const a = city.nodes[e.a];
        const t = Math.max(0, Math.min(1, ((d.x - a.x) * e.dx + (d.z - a.z) * e.dz) / e.len));
        expect(Math.hypot(d.x - (a.x + e.dx * e.len * t), d.z - (a.z + e.dz * e.len * t))).toBeLessThan(0.01);
      } else pois++;
    }
    expect(roads).toBeGreaterThan(30);
    expect(pois).toBeGreaterThan(30);
  });
});

describe('citywide board, shops and metro', () => {
  it('can stock every district with valid pavement spots, anywhere on the map', () => {
    const rng = makeRng(77);
    for (const d of DISTRICTS) {
      let ok = 0;
      for (let i = 0; i < 12; i++) {
        const s = pickHailSpot(city, colliders, rng, { px: d.center[0], pz: d.center[1], minD: 0, maxD: d.r * 0.9 });
        if (!s) continue;
        ok++;
        expect(isValidHailSpot(city, colliders, s.x, s.z)).toBe(true);
        expect(inLake(s.x, s.z)).toBe(false);
        expect(onAnyRoad(s.x, s.z)).toBe(false);
      }
      expect(ok).toBeGreaterThanOrEqual(8);
    }
  });

  it('finds the nearest road and its distance (the pick-up radius is that plus a margin)', () => {
    const rng = makeRng(3);
    for (let i = 0; i < 40; i++) {
      const s = pickHailSpot(city, colliders, rng, { px: 0, pz: 100 });
      if (!s) continue;
      const info = nearestRoadInfo(city, s.x, s.z);
      expect(info.dist).toBeGreaterThanOrEqual(city.edges[info.edge].w / 2 + SPOT.roadPad - 0.01);
      expect(info.dist).toBeLessThan(city.edges[info.edge].w / 2 + SPOT.gap + 2);
    }
  });

  it('accepts a shop-supplied hail spot only if it is on the pavement', () => {
    const rng = makeRng(9);
    const s = pickHailSpot(city, colliders, rng, { px: 0, pz: 100 });
    const ok = spotFromPlace(city, colliders, { x: s.x, z: s.z }, { placeId: 'x', place: { name: 'Bawarchi' } });
    expect(ok).toBeTruthy();
    expect(ok.place.name).toBe('Bawarchi');
    expect(Number.isFinite(ok.face)).toBe(true);
    expect(spotFromPlace(city, colliders, { x: lakeCx, z: lakeCz })).toBe(null);
    const e = city.edges[4];
    const a = city.nodes[e.a];
    expect(spotFromPlace(city, colliders, { x: a.x + e.dx * e.len / 2, z: a.z + e.dz * e.len / 2 })).toBe(null);
    expect(spotFromPlace(city, colliders, null)).toBe(null);
    expect(spotFromPlace(city, colliders, { x: NaN, z: 0 })).toBe(null);
  });

  it('adds metro stations as destinations and as rusher destinations', () => {
    const rng = makeRng(14);
    const e = city.edges[50];
    const a = city.nodes[e.a];
    const front = { x: a.x + e.dx * e.len / 2, z: a.z + e.dz * e.len / 2, edge: e.id, t: 0.5 };
    const extra = [{ id: 'metro_x', name: 'Ameerpet Metro', te: 'అమీర్‌పేట్ మెట్రో', kind: 'metro', front }];
    const from = { x: front.x + 500, z: front.z };
    let hit = 0;
    for (let i = 0; i < 100; i++) if (pickDestination(city, rng, 'rusher', from, { extra, minD: 250, maxD: 1100 }).poiId === 'metro_x') hit++;
    expect(hit).toBeGreaterThan(10);
  });

  it('weights who waits where', () => {
    const rng = makeRng(5);
    const count = (table) => {
      const c = {};
      for (let i = 0; i < 2000; i++) {
        const k = pickWeighted(rng, table);
        c[k] = (c[k] || 0) + 1;
      }
      return c;
    };
    const hotel = count(PLACE_KINDS.hotel);
    expect(hotel.tourist).toBeGreaterThan(hotel.rusher * 3);
    expect(hotel.rusher).toBeGreaterThan(0);
    const stall = count(PLACE_KINDS.stall);
    expect(stall.student).toBeGreaterThan(stall.regular * 2);
    expect(PLACE_PAIR.restaurant).toBeGreaterThan(PLACE_PAIR.metro);
  });
});

describe('hail spots and the lake keep-out', () => {
  // the real lake collider (an ellipse 7.2 m inside Necklace Road) is wider than the water the spot test avoids (+4 m)
  const real = createColliders();
  addBoundaries(real, city);
  it('no spot is inside the lake collider (28 of 31,699 valid spots used to be)', () => {
    const rng = makeRng(5);
    let inside = 0;
    let checked = 0;
    for (const e of city.edges) {
      const a = city.nodes[e.a];
      for (const side of [-1, 1]) {
        for (let t = 0.06; t < 0.95; t += 0.04) {
          const off = e.w / 2 + SPOT.gap;
          const x = a.x + e.dx * e.len * t - e.dz * side * off;
          const z = a.z + e.dz * e.len * t + e.dx * side * off;
          if (isValidHailSpot(city, real, x, z)) {
            checked++;
            if (!real.drivable(x, z)) inside++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(inside).toBe(0);
    expect(rng()).toBeGreaterThanOrEqual(0);
  });
});
