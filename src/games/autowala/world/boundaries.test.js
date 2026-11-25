import { describe, expect, it } from 'vitest';
import { generateCity } from './layout.js';
import { createColliders } from './colliders.js';
import { addBoundaries, createSlabIndex, SLAB_HEIGHT } from './boundaries.js';
import { createVehicle } from '../sim/vehicle.js';
import { CAR } from '../game/config.js';

const make = (seed = 1, opts) => {
  const city = generateCity(seed);
  const colliders = createColliders();
  addBoundaries(colliders, city, opts);
  return { city, colliders };
};

// An east-west road to test on: a long, narrow edge.
const pickRoad = (city) => city.edges.find((q) => Math.abs(q.dx) > 0.99 && q.len > 80 && q.w <= 12);

describe('boundaries: roads AND pavements are drivable; the lake is not', () => {
  for (const seed of [1, 42, 7]) {
    it('seed ' + seed + ': road centre-lines and pavement land are drivable, the lake is not', () => {
      const { city, colliders } = make(seed);
      for (const e of city.edges) {
        const a = city.nodes[e.a];
        expect(colliders.drivable(a.x + e.dx * e.len * 0.5, a.z + e.dz * e.len * 0.5), 'edge ' + e.id).toBe(true);
      }
      for (const b of city.blocks) {
        if (b.type === 'water' || b.type === 'park') continue; // parks beside the lake can reach into the water
        expect(colliders.drivable(b.x0 + 1.5, b.cz), 'pavement of block ' + b.id).toBe(true); // no kerb wall any more
      }
      const L = city.lake;
      expect(colliders.drivable(L.cx, L.cz)).toBe(false);
      expect(colliders.drivable(L.cx + L.rx * 0.5, L.cz)).toBe(false);
    });
  }

  it('Necklace Road around the lake is drivable', () => {
    const { city, colliders } = make(1);
    const L = city.lake;
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      expect(colliders.drivable(L.cx + Math.cos(t) * L.ringX, L.cz + Math.sin(t) * L.ringZ), 'ring ' + i).toBe(true);
    }
  });

  it('the old "stay on the road" rule is still there behind { kerbs: true }', () => {
    const { city, colliders } = make(1, { kerbs: true });
    const b = city.blocks.find((q) => q.type === 'normal');
    expect(colliders.drivable(b.cx, b.cz)).toBe(false);
    expect(colliders.inside(b.x0 + 1.5, b.z0 + 1.5)).toBeNull(); // placement checks still ignore kerbs
  });
});

describe('the pavement step', () => {
  it('is 0 on the road, 0.2 m on a pavement slab, 0 in a lake-side park block', () => {
    const { city } = make(1);
    const height = createSlabIndex(city);
    const e = pickRoad(city);
    const a = city.nodes[e.a];
    expect(height(a.x + e.dx * e.len * 0.5, a.z + e.dz * e.len * 0.5)).toBe(0);
    const b = city.blocks.find((q) => q.type === 'normal');
    expect(height(b.cx, b.cz)).toBe(SLAB_HEIGHT);
    const park = city.blocks.find((q) => q.type === 'park');
    if (park) expect(height(park.cx, park.cz)).toBe(0);
  });
});

describe('the auto and the guardrail', () => {
  it('drives up onto the pavement, and stops at the building wall with a soft guardrail contact (no wreck)', () => {
    const { city, colliders } = make(1);
    const height = createSlabIndex(city);
    const e = pickRoad(city);
    const a = city.nodes[e.a];
    const mid = { x: a.x + e.dx * e.len * 0.5, z: a.z };
    // a building whose south face stands 3.3 m beyond the road edge (the usual pavement width), north of the road
    const wallZ = mid.z - (e.w / 2 + 3.3);
    colliders.add(mid.x - 14, wallZ - 14, mid.x + 14, wallZ, 'building', 12);

    const v = createVehicle({ x: mid.x, z: mid.z, heading: Math.PI }); // facing north (-z), into the building
    const events = [];
    let maxY = 0;
    for (let i = 0; i < 60 * 5; i++) {
      events.push(...v.update(1 / 60, { steer: 0, throttle: 1, brake: 0, handbrake: false, boost: false }, { colliders, heightAt: height }));
      maxY = Math.max(maxY, v.state.y);
    }
    // it left the road ...
    expect(v.state.z).toBeLessThan(mid.z - e.w / 2 - 0.5);
    // ... rode up the pavement step ...
    expect(maxY).toBeGreaterThan(SLAB_HEIGHT * 0.8);
    // ... and was stopped by the wall, never inside it
    expect(v.state.z).toBeGreaterThanOrEqual(wallZ + CAR.radius - 0.05);
    expect(v.state.z).toBeLessThan(wallZ + CAR.radius + 0.6);
    expect(v.state.speed).toBeLessThan(1.5);
    // the contact is a guardrail: reported, but marked soft, and no bounce-back
    const hit = events.find((c) => c.type === 'crash');
    expect(hit?.guard).toBe(true);
    expect(hit.tag).toBe('building');
  });

  it('slides along a wall instead of stopping dead when it arrives at an angle', () => {
    const { city, colliders } = make(1);
    const e = pickRoad(city);
    const a = city.nodes[e.a];
    const mid = { x: a.x + e.dx * e.len * 0.3, z: a.z };
    const wallZ = mid.z - (e.w / 2 + 3.3);
    colliders.add(mid.x - 120, wallZ - 14, mid.x + 120, wallZ, 'building', 12);
    // heading roughly east (+x) but angled toward the wall (north): heading is PI/2 + a little toward -z means heading > PI/2
    const v = createVehicle({ x: mid.x, z: wallZ + 8, heading: Math.PI / 2 + 0.35 });
    const x0 = v.state.x;
    for (let i = 0; i < 60 * 4; i++) v.update(1 / 60, { steer: 0, throttle: 1, brake: 0, handbrake: false, boost: false }, { colliders });
    expect(v.state.z).toBeGreaterThanOrEqual(wallZ + CAR.radius - 0.05); // never through it
    expect(v.state.x - x0).toBeGreaterThan(25); // it kept going along the wall
  });
});
