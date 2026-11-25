import { describe, it, expect } from 'vitest';
import { lightingAt, makeLighting, sunDirection, trueSunDirection, sunElevation, tubeFlicker, sodiumGlow, HOUR_KEYS, SUNRISE, SUNSET } from './lighting.js';

const NUMS = ['si', 'hi', 'fd', 'bulb', 'neon', 'tube', 'night', 'exposure', 'env', 'haze', 'wet', 'sodium', 'shadow', 'shaft', 'stars', 'cover', 'glow', 'sat', 'contrast', 'bloom', 'thr', 'grain', 'vig', 'heat'];
const COLS = ['top', 'mid', 'hor', 'sun', 'hs', 'hg', 'fog', 'cloud', 'gl', 'gg'];

/** Largest change of every field between steps of `dh` hours over [from, to]; also the min / max of each numeric field. */
function sweep(from, to, dh) {
  const cur = makeLighting();
  let prev = null;
  const maxStep = {};
  const lo = {};
  const hi = {};
  for (let h = from; h <= to + 1e-9; h += dh) {
    lightingAt(h, cur);
    if (prev) {
      for (const n of NUMS) maxStep[n] = Math.max(maxStep[n] || 0, Math.abs(cur[n] - prev[n]));
      for (const c of COLS) for (let k = 0; k < 3; k++) maxStep[`${c}${k}`] = Math.max(maxStep[`${c}${k}`] || 0, Math.abs(cur[c][k] - prev[c][k]));
      for (let k = 0; k < 3; k++) maxStep[`dir${k}`] = Math.max(maxStep[`dir${k}`] || 0, Math.abs(cur.sunDir[k] - prev.sunDir[k]));
    }
    for (const n of NUMS) {
      lo[n] = Math.min(lo[n] ?? Infinity, cur[n]);
      hi[n] = Math.max(hi[n] ?? -Infinity, cur[n]);
    }
    prev = { ...cur };
    for (const c of COLS) prev[c] = [...cur[c]];
    prev.sunDir = [...cur.sunDir];
  }
  return { maxStep, lo, hi };
}

describe('lighting curves', () => {
  it('wraps at 24 with no jump', () => {
    const a = lightingAt(0);
    const b = lightingAt(24);
    for (const n of NUMS) expect(b[n]).toBeCloseTo(a[n], 6);
    for (const c of COLS) for (let k = 0; k < 3; k++) expect(b[c][k]).toBeCloseTo(a[c][k], 6);
    expect(lightingAt(-3).hour).toBeCloseTo(21, 6);
    expect(HOUR_KEYS.at(-1).h).toBe(24);
  });

  it('is continuous over the whole day: no field jumps more than a few percent of its range per 1.2 minutes of game clock', () => {
    const { maxStep, lo, hi } = sweep(0, 48, 0.02);
    for (const n of NUMS) {
      const range = Math.max(hi[n] - lo[n], 1e-6);
      expect(maxStep[n], n).toBeLessThan(range * 0.16 + 1e-6);
    }
    for (const c of COLS) for (let k = 0; k < 3; k++) expect(maxStep[`${c}${k}`], c).toBeLessThan(0.025);
    for (let k = 0; k < 3; k++) expect(maxStep[`dir${k}`]).toBeLessThan(0.02);
  });

  it('level 12 sweeps 06:00 to 24:00 smoothly with a sane look at every minute', () => {
    const cur = makeLighting();
    let prevExp = null;
    for (let h = 6; h <= 24; h += 1 / 60) {
      lightingAt(h, cur);
      expect(cur.exposure).toBeGreaterThan(0.8);
      expect(cur.exposure).toBeLessThan(1.3);
      expect(cur.si).toBeGreaterThan(0.25);
      expect(cur.hi).toBeGreaterThan(0.45);
      for (const c of ['top', 'mid', 'hor', 'sun', 'hs', 'hg', 'fog', 'cloud']) {
        for (const v of cur[c]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
      for (const v of cur.gg) {
        expect(v).toBeGreaterThan(0.75);
        expect(v).toBeLessThan(1.15);
      }
      for (const v of cur.gl) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(0.06);
      }
      if (prevExp != null) expect(Math.abs(cur.exposure - prevExp)).toBeLessThan(0.01);
      prevExp = cur.exposure;
    }
  });

  it('is bright and harsh at noon, dim and lamp-lit at night, rosy at dawn, amber in the evening', () => {
    const noon = lightingAt(12.4);
    const night = lightingAt(22);
    const dawn = lightingAt(5.7);
    const eve = lightingAt(18.4);
    expect(noon.si).toBeGreaterThan(night.si * 5);
    expect(noon.bulb).toBe(0);
    expect(noon.sodium).toBe(0);
    expect(night.bulb).toBeGreaterThan(0.95);
    expect(night.tube).toBeGreaterThan(0.95);
    expect(night.sodium).toBeGreaterThan(0.95);
    expect(night.night).toBeGreaterThan(0.9);
    expect(night.stars).toBeGreaterThan(0.8);
    expect(noon.stars).toBe(0);
    expect(noon.haze).toBeGreaterThan(night.haze);
    expect(night.wet).toBeGreaterThan(noon.wet + 0.5);
    expect(dawn.hor[0]).toBeGreaterThan(dawn.hor[2]); // warm horizon
    expect(eve.sun[0]).toBeGreaterThan(eve.sun[2] * 1.5); // amber sun
    expect(eve.gg[0]).toBeGreaterThan(eve.gg[2]); // warm highlights in the grade
    expect(night.gl[2]).toBeGreaterThan(night.gl[0]); // deep blue shadows at night
    expect(noon.shadow).toBe(1);
    expect(noon.vig).toBeLessThan(night.vig);
    expect(night.grain).toBeGreaterThan(noon.grain);
    expect(noon.bloom).toBeLessThan(night.bloom);
  });

  it('shows light shafts only in the low-sun hours, heat shimmer only around midday', () => {
    expect(lightingAt(7.0).shaft).toBeGreaterThan(0.6);
    expect(lightingAt(17.3).shaft).toBeGreaterThan(0.7);
    expect(lightingAt(12.4).shaft).toBe(0);
    expect(lightingAt(22).shaft).toBe(0);
    expect(lightingAt(12.4).heat).toBeGreaterThan(0.9);
    expect(lightingAt(13.5).heat).toBeGreaterThan(0.7);
    expect(lightingAt(22).heat).toBe(0);
    expect(lightingAt(7).heat).toBe(0);
  });

  it('the sun rises at 06:00 and sets at 18:30; the key light stays above 8 degrees and on the cook side', () => {
    expect(sunElevation(SUNRISE)).toBeCloseTo(0, 6);
    expect(sunElevation(SUNSET)).toBeCloseTo(0, 6);
    expect(sunElevation(12.25)).toBeGreaterThan(70);
    expect(sunElevation(12)).toBeGreaterThan(sunElevation(9));
    for (let h = 6.2; h < 18.4; h += 0.25) expect(sunElevation(h)).toBeGreaterThan(0);
    for (let h = 18.7; h < 29.8; h += 0.25) expect(sunElevation(h)).toBeLessThan(0);
    for (let h = 0; h < 24; h += 0.25) {
      const d = sunDirection(h);
      expect(Math.hypot(...d)).toBeCloseTo(1, 5);
      expect(d[1]).toBeGreaterThan(0.12);
      expect(d[2]).toBeGreaterThan(0);
      const t = trueSunDirection(h);
      expect(Math.hypot(...t)).toBeCloseTo(1, 5);
      expect(Math.sign(t[1]) || 0).toBe(Math.sign(sunElevation(h)) || 0);
    }
    // the sun moves from the cook's right (east, +x) in the morning to the left in the evening
    expect(trueSunDirection(7)[0]).toBeGreaterThan(0.3);
    expect(trueSunDirection(17.5)[0]).toBeLessThan(-0.3);
    expect(lightingAt(12.4).sunEl).toBeGreaterThan(70);
  });

  it('tube light flickers only when on; sodium lamps never flicker', () => {
    expect(tubeFlicker(3, 0)).toBe(0);
    let dipped = false;
    for (let t = 0; t < 60; t += 0.01) {
      const v = tubeFlicker(t, 1);
      expect(v).toBeGreaterThan(0.2);
      expect(v).toBeLessThanOrEqual(1);
      if (v < 0.5) dipped = true;
    }
    expect(dipped).toBe(true);
    expect(sodiumGlow(1, 0)).toBe(0);
    for (let t = 0; t < 60; t += 0.05) expect(sodiumGlow(t, 1)).toBeGreaterThan(0.85);
  });

  it('writes into the out object it is given and is deterministic', () => {
    const out = makeLighting();
    const r = lightingAt(9.3, out);
    expect(r).toBe(out);
    expect(JSON.stringify(lightingAt(9.3))).toBe(JSON.stringify(lightingAt(9.3)));
  });
});
