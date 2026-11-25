import { describe, it, expect } from 'vitest';
import { QUALITY, QUALITY_ORDER, pickQuality, lowerQuality, createQualitySampler } from './quality.js';

describe('quality tiers', () => {
  it('has low <= medium <= high on every numeric knob and a pipeline that grows with the tier', () => {
    expect(QUALITY_ORDER).toEqual(['low', 'medium', 'high']);
    const keys = Object.keys(QUALITY.low);
    for (const q of QUALITY_ORDER) expect(Object.keys(QUALITY[q]).sort()).toEqual(keys.slice().sort());
    for (const key of keys) {
      const [a, b, c] = QUALITY_ORDER.map((q) => QUALITY[q][key]);
      if (typeof a === 'number' && key !== 'envInterval') {
        expect(b, key).toBeGreaterThanOrEqual(a);
        expect(c, key).toBeGreaterThanOrEqual(b);
      }
      if (typeof a === 'boolean' && !['nativeAA', 'fxaa'].includes(key)) {
        // a feature on at one tier stays on at every higher one
        if (a) expect(b && c, key).toBe(true);
        if (b) expect(c, key).toBe(true);
      }
    }
    // the env light is refreshed more often (smaller interval) at higher tiers
    expect(QUALITY.high.envInterval).toBeLessThan(QUALITY.medium.envInterval);
    expect(QUALITY.medium.envInterval).toBeLessThan(QUALITY.low.envInterval);
  });

  it('low has no post, no real lights and no shadows; high has the full pipeline', () => {
    const { low, medium, high } = QUALITY;
    expect([low.post, low.shadow, low.bulbLights, low.lampLights, low.tubeLight, low.lights, low.bloom, low.ao, low.dof, low.shafts]).toEqual([false, 0, 0, 0, false, false, false, false, false, false]);
    expect(low.nativeAA).toBe(true);
    expect([medium.post, medium.bloom, medium.fxaa, medium.ao, medium.dof, medium.msaa]).toEqual([true, true, true, false, false, 0]);
    expect([high.post, high.bloom, high.ao, high.dof, high.msaa, high.fxaa]).toEqual([true, true, true, true, 4, false]);
    expect(medium.shadow).toBe(1024);
    expect(high.shadow).toBe(2048);
    expect(high.bulbLights).toBeGreaterThan(medium.bulbLights);
    expect(medium.texSize).toBeLessThanOrEqual(512);
    expect(high.texSize).toBeLessThanOrEqual(512);
    expect(QUALITY_ORDER.map((q) => QUALITY[q].reflect)).toEqual(['none', 'fake', 'planar']);
  });

  it('keeps the keys other modules read', () => {
    for (const q of QUALITY_ORDER) {
      for (const key of ['pixelRatio', 'shadow', 'bloom', 'particles', 'vehicles', 'walkers', 'lights', 'shelfDetail', 'wires']) expect(QUALITY[q][key], key).not.toBeUndefined();
    }
    expect(QUALITY.low.particles).toBeLessThan(QUALITY.high.particles);
  });

  it('picks a tier and honours an explicit one', () => {
    expect(pickQuality('high')).toBe('high');
    expect(pickQuality('auto', { mobile: true })).toBe('low');
    expect(pickQuality('auto', { mobile: false, cores: 12 })).toBe('high');
    expect(pickQuality('auto', { mobile: false, cores: 4 })).toBe('medium');
    expect(lowerQuality('high')).toBe('medium');
    expect(lowerQuality('medium')).toBe('low');
    expect(lowerQuality('low')).toBe('low');
  });
});

describe('frame-time sampler', () => {
  it('steps down only after a window of mostly slow frames and ignores hidden-tab gaps', () => {
    const s = createQualitySampler({ windowSec: 1 });
    let verdict = false;
    for (let i = 0; i < 40; i++) verdict = s.push(0.05) || verdict;
    expect(verdict).toBe(true);
    const ok = createQualitySampler({ windowSec: 1 });
    let any = false;
    for (let i = 0; i < 200; i++) any = ok.push(i === 50 ? 5 : 0.016) || any;
    expect(any).toBe(false);
  });

  it('starts a fresh window after every verdict, can be reset and ignores bad samples', () => {
    const s = createQualitySampler({ windowSec: 0.5 });
    let verdicts = 0;
    for (let i = 0; i < 100; i++) if (s.push(0.05)) verdicts++;
    expect(verdicts).toBeGreaterThanOrEqual(8);
    s.reset();
    expect(s.push(0.01)).toBe(false);
    expect(s.push(-1)).toBe(false);
    expect(s.push(NaN)).toBe(false);
  });
});
