import { describe, it, expect } from 'vitest';
import { QUALITY, QUALITY_ORDER, KNOB_KEYS, pickQuality, lowerQuality, minTier, createQualitySampler, createScaler } from './quality.js';

describe('quality tiers', () => {
  it('has lite <= low <= medium <= high on every numeric knob and a pipeline that grows with the tier', () => {
    expect(QUALITY_ORDER).toEqual(['lite', 'low', 'medium', 'high']);
    const allKeys = Object.keys(QUALITY.low);
    for (const q of QUALITY_ORDER) expect(Object.keys(QUALITY[q]).sort()).toEqual(allKeys.slice().sort());
    const keys = allKeys.filter((k) => !KNOB_KEYS.includes(k));
    for (const key of keys) {
      const [z, a, b, c] = QUALITY_ORDER.map((q) => QUALITY[q][key]);
      if (typeof a === 'number' && key !== 'envInterval') {
        expect(a, key).toBeGreaterThanOrEqual(z);
        expect(b, key).toBeGreaterThanOrEqual(a);
        expect(c, key).toBeGreaterThanOrEqual(b);
      }
      if (typeof a === 'boolean' && !['nativeAA', 'fxaa'].includes(key)) {
        // a feature on at one tier stays on at every higher one
        if (z) expect(a && b && c, key).toBe(true);
        if (a) expect(b && c, key).toBe(true);
        if (b) expect(c, key).toBe(true);
      }
    }
    // the env light is refreshed more often (smaller interval) at higher tiers
    expect(QUALITY.high.envInterval).toBeLessThan(QUALITY.medium.envInterval);
    expect(QUALITY.medium.envInterval).toBeLessThan(QUALITY.low.envInterval);
    expect(QUALITY.low.envInterval).toBeLessThan(QUALITY.lite.envInterval);
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
    expect(QUALITY_ORDER.map((q) => QUALITY[q].reflect)).toEqual(['none', 'none', 'fake', 'planar']);
  });

  it('lite: no post, no shadows, no normal maps, 128 px textures, pixel ratio 1, 30 fps cap, merged customers', () => {
    const l = QUALITY.lite;
    expect([l.post, l.shadow, l.normalMaps, l.texSize, l.pixelRatio, l.fpsCap, l.bakedCustomers]).toEqual([false, 0, false, 128, 1, 30, true]);
    expect([l.bloom, l.ao, l.dof, l.fxaa, l.shafts, l.clouds, l.stars, l.lights, l.wires, l.birds]).toEqual([false, false, false, false, false, 0, false, false, false, 0]);
    expect(l.customerMeshBudget).toBeLessThanOrEqual(8);
    expect([l.bakedCustomers, l.flatScenery, QUALITY.low.bakedCustomers, QUALITY.low.flatScenery, QUALITY.medium.bakedCustomers]).toEqual([true, true, true, false, false]);
    for (const q of ['low', 'medium', 'high']) expect(QUALITY[q].fpsCap).toBe(0);
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
    expect(lowerQuality('low')).toBe('lite');
    expect(lowerQuality('lite')).toBe('lite');
    expect(minTier('high', 'low')).toBe('low');
    expect(minTier('lite', 'medium')).toBe('lite');
    expect(pickQuality('lite')).toBe('lite');
    expect(pickQuality('auto', { tier: 'lite' })).toBe('lite');
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

describe('dynamic resolution scaler', () => {
  const run = (s, dt, sec) => {
    const out = [];
    for (let t = 0; t < sec; t += dt) {
      const r = s.push(dt);
      if (r) out.push(r);
    }
    return out;
  };
  it('steps the scale down on a slow window, never below the floor', () => {
    const s = createScaler({ budget: 0.03, min: 0.5, step: 0.1 });
    const verdicts = [];
    // frame time shrinks with the pixel count: GPU bound
    for (let i = 0; i < 4000; i++) {
      const r = s.push(0.05 * s.scale * s.scale + 0.006);
      if (r) verdicts.push(r);
      if (r?.tier) break;
    }
    const scales = verdicts.filter((v) => v.scale).map((v) => v.scale);
    expect(scales.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeLessThan(scales[i - 1]);
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.5);
  });
  it('asks for a tier drop quickly when lowering the resolution does not help (CPU bound)', () => {
    const s = createScaler({ budget: 0.03 });
    const out = [];
    for (let i = 0; i < 2000 && !out.some((v) => v.tier); i++) {
      const r = s.push(0.06);
      if (r) out.push(r);
    }
    expect(out.some((v) => v.tier === 1)).toBe(true);
    expect(out.filter((v) => v.scale).length).toBeLessThanOrEqual(2);
  });
  it('asks for a tier drop when even the floor is too slow', () => {
    const s = createScaler({ budget: 0.03, min: 0.8, step: 0.1 });
    let tier = false;
    for (let i = 0; i < 3000 && !tier; i++) tier = !!s.push(0.2 * s.scale * s.scale + 0.03)?.tier;
    expect(tier).toBe(true);
    expect(s.scale).toBeGreaterThanOrEqual(0.8);
  });
  it('stays at scale 1 and never asks for anything on a healthy device', () => {
    const s = createScaler({ budget: 0.03 });
    expect(run(s, 0.0167, 60)).toEqual([]);
    expect(s.scale).toBe(1);
  });
  it('recovers after a spike but settles instead of oscillating when 1.0 is just too slow', () => {
    const s = createScaler({ budget: 0.03, upSec: 3, cooldownSec: 0.5, maxFlaps: 2 });
    let ups = 0;
    // a device that is fine at 0.9 or below but too slow at 1.0
    for (let i = 0; i < 40000; i++) {
      const dt = s.scale >= 0.99 ? 0.05 : 0.012;
      const r = s.push(dt);
      if (r?.scale && r.scale >= 0.99) ups++;
      if (r?.tier) break;
    }
    expect(ups).toBeLessThanOrEqual(1); // one failed attempt at 1.0, then the ceiling stays below it
    expect(s.scale).toBeLessThan(1);
  });
  it('goes back up after a transient slowdown', () => {
    const s = createScaler({ budget: 0.03, upSec: 2, cooldownSec: 0.5 });
    for (let i = 0; i < 200; i++) s.push(0.05 * s.scale * s.scale + 0.006); // a few slow seconds
    expect(s.scale).toBeLessThan(1);
    const lowest = s.scale;
    run(s, 0.012, 40);
    expect(s.scale).toBeGreaterThan(lowest);
  });
  it('ignores hidden-tab gaps and garbage samples and can restart for a new tier', () => {
    const s = createScaler({ budget: 0.03 });
    for (let i = 0; i < 100; i++) expect(s.push(i % 2 ? 5 : NaN)).toBeNull();
    s.restart(0.8);
    expect(s.scale).toBe(0.8);
  });
});
