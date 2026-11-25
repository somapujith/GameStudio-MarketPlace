import { describe, it, expect } from 'vitest';
import { trimRoute, pathLength, etaFor, targetKey, withStubs, AVG_SPEED } from './route-math.js';

const line = () => [{ x: 0, z: 0 }, { x: 0, z: -100 }, { x: 80, z: -100 }, { x: 80, z: -300 }];

describe('trimRoute', () => {
  it('leaves a route alone when the player is at its start', () => {
    const p = line();
    const r = trimRoute(p, 0, 0);
    expect(r.off).toBeCloseTo(0, 6);
    expect(p).toHaveLength(4);
  });
  it('drops the passed segments and moves the first vertex onto the player', () => {
    const p = line();
    const r = trimRoute(p, 3, -130); // the player drove the whole first leg and sits 30 m beside the second one
    expect(r.index).toBe(1);
    expect(p).toHaveLength(3);
    expect(p[0].z).toBeCloseTo(-100, 6);
    expect(p[0].x).toBeCloseTo(3, 6);
    expect(r.off).toBeCloseTo(30, 6);
  });
  it('projects onto the segment the player is on', () => {
    const p = line();
    trimRoute(p, 2, -40);
    expect(p).toHaveLength(4);
    expect(p[0].x).toBeCloseTo(0, 6);
    expect(p[0].z).toBeCloseTo(-40, 6);
    expect(pathLength(p)).toBeCloseTo(60 + 80 + 200, 6);
  });
  it('is idempotent and never goes backwards (a reversing player stays at the start)', () => {
    const p = line();
    trimRoute(p, 0, -50);
    const r = trimRoute(p, 0, 20);
    expect(p[0].z).toBeCloseTo(-50, 6);
    expect(r.off).toBeCloseTo(70, 6);
  });
  it('reports how far off the route the player is (the guide re-routes beyond 25 m)', () => {
    const p = line();
    expect(trimRoute(p, -60, -50).off).toBeCloseTo(60, 6);
  });
  it('only looks a few segments ahead so a parallel street can not steal the player', () => {
    const p = [{ x: 0, z: 0 }, { x: 0, z: -50 }, { x: 10, z: -50 }, { x: 10, z: 0 }, { x: 10, z: 50 }];
    const r = trimRoute(p, 10, 25, 2); // right on the last legs but those are out of the 2-segment window
    expect(r.index).toBeLessThan(2);
  });
  it('handles empty and single-point routes', () => {
    expect(trimRoute([], 0, 0).off).toBe(Infinity);
    expect(trimRoute(null, 0, 0).off).toBe(Infinity);
    expect(trimRoute([{ x: 3, z: 4 }], 0, 0).off).toBe(5);
  });
});

describe('eta and keys', () => {
  it('eta is distance over 11 m/s', () => {
    expect(AVG_SPEED).toBe(11);
    expect(etaFor(1100)).toBeCloseTo(100, 6);
    expect(etaFor(-5)).toBe(0);
  });
  it('target keys change with the id, the type and a real move only', () => {
    const a = { type: 'pickup', id: 'c1', x: 100, z: 50 };
    expect(targetKey(a)).toBe(targetKey({ ...a, x: 100.4 }));
    expect(targetKey(a)).not.toBe(targetKey({ ...a, id: 'c2' }));
    expect(targetKey(a)).not.toBe(targetKey({ ...a, type: 'dropoff' }));
    expect(targetKey(a)).not.toBe(targetKey({ ...a, x: 140 }));
    expect(targetKey(null)).toBe('');
  });
});

describe('withStubs', () => {
  it('adds the auto position when it is off the road and the target when it is on the pavement', () => {
    const r = withStubs([{ x: 0, z: 0 }, { x: 0, z: -100 }], { x: 8, z: 0 }, { x: 6, z: -100 });
    expect(r).toHaveLength(4);
    expect(r[0]).toEqual({ x: 8, z: 0 });
    expect(r[3]).toEqual({ x: 6, z: -100 });
  });
  it('does not add stubs that are tiny or huge, and keeps an empty route empty', () => {
    expect(withStubs([{ x: 0, z: 0 }, { x: 0, z: -100 }], { x: 1, z: 0 }, { x: 1, z: -100 })).toHaveLength(2);
    expect(withStubs([{ x: 0, z: 0 }, { x: 0, z: -100 }], { x: 0, z: 0 }, { x: 200, z: -100 })).toHaveLength(2);
    expect(withStubs([], { x: 5, z: 5 }, { x: 9, z: 9 })).toEqual([]);
  });
});
