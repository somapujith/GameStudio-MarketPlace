import { describe, expect, it } from 'vitest';
import { createShakeDetector, motionPermission, shakeSupported } from './shake.js';

const feed = (det, samples) => samples.map(([x, y, z, t]) => det.push({ x, y, z }, t));

describe('createShakeDetector', () => {
  it('ignores a phone lying still or being carried gently', () => {
    const det = createShakeDetector();
    const out = feed(det, Array.from({ length: 60 }, (_, i) => [0.2 * Math.sin(i), 9.8 + 0.3 * Math.cos(i), 0.1, i * 16]));
    expect(out.some(Boolean)).toBe(false);
  });

  it('fires once after three hard jolts inside the window, then stays quiet during the cooldown', () => {
    const det = createShakeDetector();
    const jolts = [];
    let t = 0;
    for (let i = 0; i < 5; i++) { jolts.push([i % 2 ? 22 : -22, 0, 9.8, t]); t += 120; }
    const out = feed(det, jolts);
    expect(out.filter(Boolean)).toHaveLength(1);
    expect(out.indexOf(true)).toBe(3); // sample 0 is the baseline; jolts on samples 1, 2, 3
    expect(feed(det, [[22, 0, 9.8, t], [-22, 0, 9.8, t + 120], [22, 0, 9.8, t + 240]]).some(Boolean)).toBe(false);
  });

  it('does not count slow jolts spread over more than the window, nor one jolt that spans several samples', () => {
    const slow = createShakeDetector();
    expect(feed(slow, [[-22, 0, 9, 0], [22, 0, 9, 600], [-22, 0, 9, 1200], [22, 0, 9, 1800], [-22, 0, 9, 2400]]).some(Boolean)).toBe(false);
    const single = createShakeDetector();
    expect(feed(single, [[0, 0, 9, 0], [20, 0, 9, 10], [40, 0, 9, 20], [60, 0, 9, 30], [80, 0, 9, 40]]).some(Boolean)).toBe(false);
  });

  it('shakes again after the cooldown, and ignores junk samples', () => {
    const det = createShakeDetector({ cooldownMs: 500 });
    const burst = (t0) => feed(det, [[-22, 0, 9, t0], [22, 0, 9, t0 + 120], [-22, 0, 9, t0 + 240], [22, 0, 9, t0 + 360]]);
    expect(burst(0).some(Boolean)).toBe(true);
    expect(burst(2000).some(Boolean)).toBe(true);
    expect(det.push(null, 1)).toBe(false);
    expect(det.push({ x: Number.NaN, y: 0, z: 0 }, 1)).toBe(false);
  });
});

describe('motion support (no browser here)', () => {
  it('reports unsupported outside a browser', () => {
    expect(shakeSupported()).toBe(false);
    expect(motionPermission()).toBe('unsupported');
  });
});
