import { describe, expect, it } from 'vitest';
import { generateCity } from '../world/layout.js';
import { makeRng } from '../game/rng.js';
import {
  activeAt, baraatCandidates, baraatFormation, baraatPose, crowdDrag, eventsForDay, kiteField, kiteFraction, matchPhase, pickBaraatRoute,
  trafficCap, wrapDelta,
} from './event-logic.js';

// the city is deterministic: build it once for the file
const city = generateCity(1);

describe('event schedule', () => {
  it('is deterministic and sorted, inside the day', () => {
    for (let d = 1; d <= 30; d++) {
      const a = eventsForDay(d, 1);
      expect(JSON.stringify(a)).toBe(JSON.stringify(eventsForDay(d, 1)));
      for (let i = 0; i < a.length; i++) {
        expect(a[i].end).toBeGreaterThan(a[i].start);
        expect(a[i].start).toBeGreaterThanOrEqual(0);
        expect(a[i].end).toBeLessThanOrEqual(24);
        if (i) expect(a[i].start).toBeGreaterThanOrEqual(a[i - 1].start);
      }
    }
  });

  it('shows the player a baraat and a match on day 1 and kites on day 2', () => {
    expect(eventsForDay(1).map((e) => e.id).sort()).toEqual(['baraat', 'match']);
    expect(eventsForDay(2).some((e) => e.id === 'kites')).toBe(true);
  });

  it('every event kind turns up now and then, none every single day', () => {
    const n = { baraat: 0, match: 0, kites: 0 };
    for (let d = 1; d <= 60; d++) for (const e of eventsForDay(d, 1)) n[e.id]++;
    for (const k of Object.keys(n)) {
      expect(n[k]).toBeGreaterThan(8);
      expect(n[k]).toBeLessThan(55);
    }
  });

  it('baraats run in the evening, kites by day, and activeAt filters by hour', () => {
    for (let d = 1; d <= 40; d++) {
      for (const e of eventsForDay(d, 1)) {
        if (e.id === 'baraat') expect(e.start).toBeGreaterThanOrEqual(18.2);
        if (e.id === 'kites') expect(e.end).toBeLessThan(18);
      }
    }
    const day1 = eventsForDay(1);
    expect(activeAt(day1, 17.4).map((e) => e.id)).toEqual(['match']);
    expect(activeAt(day1, 19.5).map((e) => e.id).sort()).toEqual(['baraat', 'match']);
    expect(activeAt(day1, 3)).toEqual([]);
  });
});

describe('match night', () => {
  it('the crowd builds up, then the exodus makes the roads heavy, then it empties', () => {
    expect(matchPhase(16).crowd).toBe(0);
    expect(matchPhase(16).trafficMul).toBe(1);
    expect(matchPhase(20).crowd).toBeGreaterThan(0.95);
    expect(matchPhase(20).trafficMul).toBeGreaterThan(1.1);
    expect(matchPhase(22.3).trafficMul).toBeGreaterThan(matchPhase(20).trafficMul);
    expect(matchPhase(22.3).trafficMul).toBeLessThan(1.5); // a safe multiplier
    expect(matchPhase(23.5).exodus).toBe(0);
  });
});

describe('kites', () => {
  it('go up over an hour and come down again', () => {
    expect(kiteFraction(9)).toBe(0);
    expect(kiteFraction(11)).toBe(1);
    expect(kiteFraction(15)).toBe(1);
    expect(kiteFraction(17.3)).toBe(0);
    expect(kiteFraction(10.1)).toBeGreaterThan(0);
    expect(kiteFraction(10.1)).toBeLessThan(1);
  });

  it('wraps a field around the viewer', () => {
    expect(wrapDelta(10, 360)).toBe(10);
    expect(wrapDelta(190, 360)).toBeCloseTo(-170, 6);
    expect(wrapDelta(-200, 360)).toBeCloseTo(160, 6);
    for (const d of [-1000, -181, 0, 179, 700]) expect(Math.abs(wrapDelta(d, 360))).toBeLessThanOrEqual(180);
  });

  it('builds a deterministic field', () => {
    const a = kiteField(40);
    expect(a).toHaveLength(40);
    expect(JSON.stringify(a)).toBe(JSON.stringify(kiteField(40)));
    for (const k of a) {
      expect(k.y).toBeGreaterThan(20);
      expect(k.color).toBeGreaterThanOrEqual(0);
      expect(k.color).toBeLessThanOrEqual(5);
    }
  });
});

describe('baraat', () => {
  it('formation is a handful of people', () => {
    const f = baraatFormation();
    expect(f.people.length).toBeGreaterThan(15);
    expect(f.people.length).toBeLessThanOrEqual(32);
    expect(f.people.filter((p) => p.role === 'groom')).toHaveLength(1);
    // nobody inside the horse's body
    const horse = f.horse;
    for (const p of f.people) if (p.role === 'dancer') expect(Math.hypot(p.u - horse.u, p.w - horse.w)).toBeGreaterThan(1.8);
  });

  it('has roads to use in the real city, and picks a stable route', () => {
    const at = { x: 0, z: 0 };
    expect(baraatCandidates(city, at).length).toBeGreaterThan(3);
    const r1 = pickBaraatRoute(city, at, makeRng(5));
    const r2 = pickBaraatRoute(city, at, makeRng(5));
    expect(r1).toEqual(r2);
    expect(r1.length).toBeGreaterThan(50);
    const e = city.edges[r1.edge];
    // both ends lie on the road's centre line, inside it
    for (const [x, z] of [[r1.x0, r1.z0], [r1.x1, r1.z1]]) {
      const a = city.nodes[e.a];
      const t = (x - a.x) * e.dx + (z - a.z) * e.dz;
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(e.len);
      expect(Math.abs((x - a.x) * -e.dz + (z - a.z) * e.dx)).toBeLessThan(0.01);
    }
    expect(Math.hypot(r1.x1 - r1.x0, r1.z1 - r1.z0)).toBeCloseTo(r1.length, 4);
  });

  it('the pose walks the route in the left lane and stops at the end', () => {
    const route = { x0: 0, z0: 0, dx: 0, dz: 1, length: 100, w: 12 };
    const p = baraatPose(route, 1.2, 10);
    expect(p.z).toBeCloseTo(12, 6);
    // walking +z, the left side is +x (looking down +z, screen-left is +x)
    expect(p.x).toBeGreaterThan(0);
    expect(p.done).toBe(false);
    const end = baraatPose(route, 1.2, 1000);
    expect(end.z).toBeCloseTo(100, 6);
    expect(end.done).toBe(true);
  });

  const b = { x: 0, z: 0, dx: 0, dz: 1, speed: 1.1, tail: 18, head: 15 };
  it('traffic behind it crawls at its pace and never reaches the band', () => {
    const far = trafficCap({ x: 0, z: -70, fx: 0, fz: 1 }, b);
    expect(far).toBe(Infinity);
    const mid = trafficCap({ x: 0, z: -35, fx: 0, fz: 1 }, b);
    const near = trafficCap({ x: 0, z: -20, fx: 0, fz: 1 }, b);
    expect(near).toBeLessThan(mid);
    expect(near).toBeLessThan(2);
    expect(trafficCap({ x: 0, z: -16, fx: 0, fz: 1 }, b)).toBeLessThan(1.1); // right behind the band: slower than they walk
    expect(trafficCap({ x: 0, z: -10, fx: 0, fz: 1 }, b)).toBe(0); // jammed in
  });

  it('traffic ahead and the other way is not stopped', () => {
    // already past the head of the procession, same direction
    expect(trafficCap({ x: 0, z: 40, fx: 0, fz: 1 }, b)).toBe(Infinity);
    // coming at it
    const toward = trafficCap({ x: 0, z: 40, fx: 0, fz: -1 }, b);
    expect(toward).toBeGreaterThan(2);
    const passing = trafficCap({ x: 3, z: 5, fx: 0, fz: -1 }, b);
    expect(passing).toBeGreaterThan(2);
    expect(passing).toBeLessThan(4); // walking pace past the crowd
    // cars that passed it
    expect(trafficCap({ x: 3, z: -30, fx: 0, fz: -1 }, b)).toBe(Infinity);
    // another street
    expect(trafficCap({ x: 80, z: 0, fx: 0, fz: 1 }, b)).toBe(Infinity);
  });

  it('the crowd slows the player inside it and not beyond', () => {
    expect(crowdDrag(0, 0, b)).toBe(1);
    expect(crowdDrag(0, -18, b)).toBe(1);
    expect(crowdDrag(0, -23, b)).toBeCloseTo(0, 6);
    expect(crowdDrag(0, -20.5, b)).toBeGreaterThan(0.3);
    expect(crowdDrag(20, 0, b)).toBe(0);
    expect(crowdDrag(6, 0, b)).toBeGreaterThan(0.4);
    expect(crowdDrag(0, 80, b)).toBe(0);
  });
});
