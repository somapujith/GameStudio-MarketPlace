import { describe, it, expect } from 'vitest';
import { QUALITY, QUALITY_ORDER, KNOB_KEYS, pickQuality, lowerQuality, minTier, DRAW_CALL_BUDGET, GFX_GAME_KEY, GOVERNOR_OPTIONS, REF_UNITS, SCALE_LADDER, SCALE_MIN, TIER_COST, TIFFIN_TIER_MODELS, estimateTierMs, recommendStart, shadowEveryFor, deviceTweaks, applyDeviceTweaks, createCompileHold } from './quality.js';

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

describe('the tier cost model (estimateTierMs, recommendStart)', () => {
  const VP = { w: 1536, h: 864, dpr: 1.25 };
  it('grows with the tier and with the resolution, and a faster machine is estimated faster', () => {
    const ms = (tier, s = 1, units = REF_UNITS) => estimateTierMs(units, tier, VP, s);
    for (let i = 1; i < QUALITY_ORDER.length; i++) expect(ms(QUALITY_ORDER[i])).toBeGreaterThan(ms(QUALITY_ORDER[i - 1]));
    for (const q of QUALITY_ORDER) expect(ms(q, 0.7)).toBeLessThan(ms(q, 1));
    expect(ms('medium', 1, { fillNsPerPx: 0.25, callUs: 1.4 })).toBeLessThan(ms('medium'));
    expect(ms('medium', 1, { fillNsPerPx: 1.1, callUs: 6 })).toBeGreaterThan(ms('medium'));
    expect(estimateTierMs(REF_UNITS, 'nope', VP)).toBe(Infinity);
  });

  it('is a fixed cost plus a pixel cost: halving the pixels does not halve the frame', () => {
    const a = estimateTierMs(REF_UNITS, 'medium', VP, 1);
    const b = estimateTierMs(REF_UNITS, 'medium', VP, Math.SQRT1_2); // half the pixels
    expect(b).toBeGreaterThan(a / 2);
    expect(b).toBeLessThan(a);
  });

  it('starts the reference machine (the dev laptop) on medium at a modest scale, not on low at full resolution', () => {
    const r = recommendStart({ units: REF_UNITS, viewport: VP, capTier: 'medium' });
    expect(r.tier).toBe('medium');
    expect(r.scale).toBeGreaterThanOrEqual(0.7);
    expect(r.ms).toBeLessThanOrEqual((1000 / 60) * 0.9);
  });

  it('a fast machine starts at full resolution, a slow one on a lower tier, a hopeless one on lite; never above the GPU class cap', () => {
    const fast = recommendStart({ units: { fillNsPerPx: 0.1, callUs: 0.6 }, viewport: VP, capTier: 'high' });
    expect(fast.tier).toBe('high');
    expect(fast.scale).toBe(1);
    const capped = recommendStart({ units: { fillNsPerPx: 0.1, callUs: 0.6 }, viewport: VP, capTier: 'medium' });
    expect(capped.tier).toBe('medium');
    const slow = recommendStart({ units: { fillNsPerPx: 1.6, callUs: 9 }, viewport: VP, capTier: 'medium' });
    expect(['lite', 'low']).toContain(slow.tier);
    // the units are bounded (a calibration taken on a busy machine must not poison the start tier): 25 ns / px and 60 us / call read as 3x and 1.6x the reference
    const awful = recommendStart({ units: { fillNsPerPx: 25, callUs: 60 }, viewport: VP, capTier: 'high' });
    const bounded = recommendStart({ units: { fillNsPerPx: 0.55 * 3, callUs: 3 * 1.6 }, viewport: VP, capTier: 'high' });
    expect(['lite', 'low']).toContain(awful.tier);
    expect(awful.tier).toBe(bounded.tier);
    expect(estimateTierMs({ fillNsPerPx: 25, callUs: 60 }, 'medium', VP, 1)).toBeCloseTo(estimateTierMs({ fillNsPerPx: 0.55 * 3, callUs: 3 * 1.6 }, 'medium', VP, 1), 6);
  });

  it('prefers a post tier at the good-scale floor over the next tier down at full resolution, and says why', () => {
    // a machine on which medium fits only at ~0.7: it must still start on medium
    const units = { fillNsPerPx: 0.62, callUs: 3.2 };
    const r = recommendStart({ units, viewport: VP, capTier: 'medium' });
    expect(r.tier).toBe('medium');
    expect(r.reasons[0]).toMatch(/medium fits/);
    // with a stricter good-scale floor the same machine drops to low
    const strict = recommendStart({ units, viewport: VP, capTier: 'medium', goodScale: 0.95 });
    expect(strict.tier).not.toBe('medium');
  });

  it('carries the confidence flag through', () => {
    expect(recommendStart({ units: REF_UNITS, viewport: VP, confident: false }).confident).toBe(false);
  });
});

describe('draw-call budgets and the governor tables', () => {
  it('has an increasing per-tier budget below what the heavy tiers were measured at', () => {
    expect(DRAW_CALL_BUDGET).toEqual({ lite: 250, low: 350, medium: 700, high: 1000 });
    const b = QUALITY_ORDER.map((q) => DRAW_CALL_BUDGET[q]);
    expect(b).toEqual([...b].sort((x, y) => x - y));
  });

  it('gives every tier a scale floor on the ladder, a cost, and a calibration model; the ladder descends from 1 and the costs rise with the tier', () => {
    expect(SCALE_LADDER[0]).toBe(1);
    expect([...SCALE_LADDER]).toEqual([...SCALE_LADDER].sort((a, b) => b - a));
    for (const q of QUALITY_ORDER) {
      expect(SCALE_MIN[q]).toBeGreaterThanOrEqual(SCALE_LADDER[SCALE_LADDER.length - 1]);
      expect(SCALE_MIN[q]).toBeLessThanOrEqual(1);
      expect(TIER_COST[q]).toBeGreaterThan(0);
      const m = TIFFIN_TIER_MODELS[q];
      expect(m).toBeTruthy();
      expect(m.pixelRatio).toBe(Math.max(QUALITY[q].pixelRatio, 0) > 0 ? QUALITY[q].pixelRatio : 1);
      expect(m.scaleMin).toBe(SCALE_MIN[q]);
      expect(m.post === 0).toBe(!QUALITY[q].post);
    }
    const costs = QUALITY_ORDER.map((q) => TIER_COST[q]);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    // the post tiers may go further down the ladder than the 0.7 the old scaler stopped at: a tier change is a bigger loss than a few pixels
    expect(SCALE_MIN.medium).toBeLessThanOrEqual(0.7);
  });

  it('keeps the model order: a model never costs more calls / triangles than the tier above it', () => {
    for (let i = 1; i < QUALITY_ORDER.length; i++) {
      const a = TIFFIN_TIER_MODELS[QUALITY_ORDER[i - 1]];
      const b = TIFFIN_TIER_MODELS[QUALITY_ORDER[i]];
      expect(b.calls).toBeGreaterThanOrEqual(a.calls);
      expect(b.mtris).toBeGreaterThanOrEqual(a.mtris);
      expect(b.layers).toBeGreaterThanOrEqual(a.layers);
    }
  });

  it('lets the scale steps do the work before a tier step: a held frame rate on a 60 Hz display never trips the down threshold', () => {
    expect(GOVERNOR_OPTIONS.downRatio).toBeGreaterThan(1);
    expect(GOVERNOR_OPTIONS.downRatio).toBeLessThanOrEqual(1.1);
    expect(GOVERNOR_OPTIONS.tierDownRatio).toBeGreaterThanOrEqual(1.3); // a tier drop only for a clearly slow frame
    expect(GOVERNOR_OPTIONS.tierDownRatio).toBeLessThanOrEqual(2);
    expect(GOVERNOR_OPTIONS.loadHoldMs).toBeGreaterThanOrEqual(2000);
    expect(GFX_GAME_KEY).toBe('tiffin-centre');
  });
});

describe('shadow refresh interval', () => {
  it('is 1 on tiers that do not allow skipping, and follows the frame time on medium / high only when frames are late', () => {
    expect(shadowEveryFor(QUALITY.low, 0.05)).toBe(1);
    expect(shadowEveryFor(QUALITY.lite, 0.05)).toBe(1);
    expect(shadowEveryFor(QUALITY.medium, 0.0167)).toBe(1);
    expect(shadowEveryFor(QUALITY.medium, 0.022)).toBe(1); // 45 fps: no skipping (it would make the frames alternate)
    expect(shadowEveryFor(QUALITY.medium, 0.03)).toBe(2);
    expect(shadowEveryFor(QUALITY.medium, 0.05)).toBe(3);
    expect(shadowEveryFor(QUALITY.high, 0.05)).toBe(2); // high never skips more than every 2nd frame
    expect(shadowEveryFor(QUALITY.medium, NaN)).toBe(1);
  });
  it('has hysteresis: it does not flip back to every frame until the frame time is clearly better', () => {
    expect(shadowEveryFor(QUALITY.medium, 0.026, 1)).toBe(1);
    expect(shadowEveryFor(QUALITY.medium, 0.026, 2)).toBe(2);
    expect(shadowEveryFor(QUALITY.medium, 0.022, 2)).toBe(1);
    expect(shadowEveryFor(QUALITY.medium, 0.04, 3)).toBe(3);
  });
});

describe('device tweaks to the tier table', () => {
  it('leaves discrete and unidentified GPUs alone and gives an integrated GPU a playable high', () => {
    expect(deviceTweaks(null)).toEqual({});
    expect(deviceTweaks({ renderer: '', discreteGpu: false })).toEqual({});
    expect(deviceTweaks({ renderer: 'NVIDIA GeForce RTX 3060', discreteGpu: true })).toEqual({});
    const igpu = deviceTweaks({ renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics)', discreteGpu: false });
    expect(igpu.high).toEqual({ msaa: 0, fxaa: true, pixelRatio: 1.1, shadow: 1536 });
    expect(igpu.medium).toBeUndefined();
  });
  it('applies to a table and restores it exactly', () => {
    const table = JSON.parse(JSON.stringify(QUALITY));
    const undo = applyDeviceTweaks({ renderer: 'Intel(R) UHD Graphics 620', discreteGpu: false }, table);
    expect([table.high.msaa, table.high.fxaa, table.high.pixelRatio, table.high.shadow]).toEqual([0, true, 1.1, 1536]);
    expect(table.medium).toEqual(QUALITY.medium);
    undo();
    expect(table).toEqual(QUALITY);
  });
});

describe('compile hold', () => {
  it('holds for a moment after a new program appears and is quiet while the count is steady', () => {
    const h = createCompileHold({ holdSec: 0.5 });
    expect(h.push(100, 0.016)).toBe(false); // the first reading is only a reference
    expect(h.push(100, 0.016)).toBe(false);
    expect(h.push(101, 0.4)).toBe(true); // a program appeared: this frame is a compile stall
    expect(h.push(101, 0.016)).toBe(true); // still inside the window
    expect(h.push(101, 0.2)).toBe(true); // the frame that uses up the hold is held too
    expect(h.holding).toBe(false);
    expect(h.push(101, 0.016)).toBe(false); // judged again
  });
  it('keeps holding while programs keep appearing (the warm-up ramp) and ignores a hidden-tab gap', () => {
    const h = createCompileHold({ holdSec: 0.6 });
    h.push(10, 0.016);
    let held = 0;
    for (let i = 1; i <= 50; i++) if (h.push(10 + i, 0.3)) held++;
    expect(held).toBe(50);
    expect(h.push(60, 60)).toBe(true); // a 60 s gap counts as at most one second
    expect(h.push(60, 1)).toBe(false);
  });
  // (the governor-level behaviour of the hold, "a slow device is still seen, a compile storm is not", is tested with the real governor in adapt.test.js)
});
