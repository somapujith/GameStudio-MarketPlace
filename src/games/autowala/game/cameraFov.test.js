import { describe, expect, it } from 'vitest';
import { H_MAX, H_MIN, V_MAX, V_MIN, fovForAspect, horizontalFov } from './cameraFov.js';

// the chase lens: 60 at rest, 75 flat out, 84 boosting, 68 in the hood view
const REST = 60;
const FAST = 75;
const BOOST = 84;
const SCREENS = {
  '32:9': 3.56, '21:9 (3440x1440)': 2.39, '932x430': 2.17, '844x390': 2.164, '2:1': 2, '16:9': 16 / 9, '16:10': 1.6, '3:2': 1.5, '4:3': 4 / 3, '1:1': 1, 'portrait 420x900': 420 / 900,
};

describe('fovForAspect', () => {
  it('leaves a 16:9 screen alone at rest, while the horizontal fov is inside the band', () => {
    expect(horizontalFov(REST, 16 / 9)).toBeLessThanOrEqual(H_MAX);
    expect(fovForAspect(REST, 16 / 9)).toBeCloseTo(REST, 6);
    expect(fovForAspect(REST, 1.6)).toBeCloseTo(REST, 6);
  });

  it('keeps a wide-and-short landscape phone out of the fisheye range, at rest and flat out', () => {
    for (const a of [2, 2.164, 2.17, 2.39]) {
      expect(horizontalFov(fovForAspect(REST, a), a)).toBeLessThan(H_MAX + 6);
      expect(horizontalFov(fovForAspect(FAST, a), a)).toBeLessThan(H_MAX + 11);
      expect(horizontalFov(fovForAspect(BOOST, a), a)).toBeLessThan(H_MAX + 15);
    }
    // and it is a real reduction against the raw vertical fov (124 degrees across at 844x390 on boost)
    expect(horizontalFov(BOOST, 2.164)).toBeGreaterThan(120);
    expect(horizontalFov(fovForAspect(BOOST, 2.164), 2.164)).toBeLessThan(110);
    expect(horizontalFov(fovForAspect(FAST, 2.39), 2.39)).toBeLessThan(horizontalFov(FAST, 2.39) - 10);
  });

  it('opens the lens up on a 4:3 tablet instead of showing a 75 degree keyhole', () => {
    const v = fovForAspect(REST, 4 / 3);
    expect(v).toBeGreaterThan(REST + 2);
    expect(horizontalFov(v, 4 / 3)).toBeGreaterThan(H_MIN - 6);
  });

  it('caps the vertical fov on a portrait window', () => {
    for (const base of [REST, FAST, BOOST]) {
      const v = fovForAspect(base, 420 / 900);
      expect(v).toBeLessThanOrEqual(V_MAX);
      expect(v).toBeGreaterThan(REST); // but it is still wider than landscape asks for, to show more of the road
    }
    expect(fovForAspect(REST, 0.3)).toBe(V_MAX);
  });

  it('never gets narrower than V_MIN on a super-ultrawide', () => {
    expect(fovForAspect(REST, 3.56)).toBeGreaterThanOrEqual(V_MIN);
    expect(fovForAspect(REST, 8)).toBeGreaterThanOrEqual(V_MIN);
  });

  it('is still monotonic in the base fov, so the speed and boost widening survive on every screen', () => {
    for (const [name, a] of Object.entries(SCREENS)) {
      let prev = -Infinity;
      for (let base = 55; base <= 90; base += 1) {
        const v = fovForAspect(base, a);
        expect(v, `${name} base ${base}`).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
      expect(fovForAspect(BOOST, a), name).toBeGreaterThanOrEqual(fovForAspect(REST, a));
    }
    // wide phone: 60 -> 75 -> 84 still opens up a few degrees
    expect(fovForAspect(FAST, 2.164) - fovForAspect(REST, 2.164)).toBeGreaterThan(3);
    expect(fovForAspect(BOOST, 2.164) - fovForAspect(FAST, 2.164)).toBeGreaterThan(1.5);
  });

  it('is continuous at the band edges (no pop when the window is resized)', () => {
    for (let a = 0.4; a < 3.6; a += 0.001) {
      expect(Math.abs(fovForAspect(REST, a + 0.001) - fovForAspect(REST, a))).toBeLessThan(0.6);
    }
  });

  it('survives nonsense', () => {
    expect(fovForAspect(60, 0)).toBe(60);
    expect(fovForAspect(60, NaN)).toBe(60);
    expect(fovForAspect(60, -2)).toBe(60);
    expect(fovForAspect(NaN, 2)).toBeNaN();
  });

  it('is deterministic and allocation-free in shape (returns a plain number)', () => {
    expect(typeof fovForAspect(REST, 2.164)).toBe('number');
    expect(fovForAspect(REST, 2.164)).toBe(fovForAspect(REST, 2.164));
  });
});
