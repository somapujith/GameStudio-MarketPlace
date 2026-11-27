import { describe, expect, it } from 'vitest';
import { SCALE_MAX, SCALE_MIN, applyUiScale, uiScale } from './scale.js';

describe('uiScale', () => {
  it('keeps phones at about 1 and never shrinks below the readable floor', () => {
    expect(uiScale(640, 360)).toBe(SCALE_MIN);
    expect(uiScale(740, 360)).toBe(SCALE_MIN);
    expect(uiScale(844, 390)).toBeGreaterThanOrEqual(0.93);
    expect(uiScale(844, 390)).toBeLessThan(1);
    expect(uiScale(932, 430)).toBe(1);
    expect(uiScale(100, 200)).toBe(SCALE_MIN);
  });
  it('is 1 at the 720p desktop and grows with the height up to the cap', () => {
    expect(uiScale(1280, 720)).toBe(1);
    expect(uiScale(1366, 768)).toBeCloseTo(1.07, 2);
    expect(uiScale(1536, 864)).toBe(1.2);
    expect(uiScale(1920, 1080)).toBe(1.5);
    expect(uiScale(3840, 2160)).toBe(SCALE_MAX);
  });
  it('never grows with the width alone and is monotonic in the height', () => {
    let last = 0;
    for (let h = 300; h <= 1600; h += 20) {
      const s = uiScale(2400, h);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    expect(uiScale(3000, 400)).toBe(uiScale(900, 400));
  });
  it('a thin tall window does not get a huge HUD', () => {
    expect(uiScale(420, 1080)).toBeLessThanOrEqual(1);
    expect(uiScale(1000, 1080)).toBeLessThanOrEqual(1.12);
  });
  it('survives junk', () => {
    expect(uiScale(undefined, undefined)).toBe(1);
    expect(uiScale(NaN, 'x')).toBe(1);
    expect(uiScale(0, 0)).toBe(1);
  });
  it('applyUiScale writes the custom property', () => {
    const el = { style: { v: {}, setProperty(k, v) { this.v[k] = v; } } };
    expect(applyUiScale(el, 1920, 1080)).toBe(1.5);
    expect(el.style.v['--aw-ui-scale']).toBe('1.5');
    expect(applyUiScale(null, 800, 600)).toBe(1);
  });
});
