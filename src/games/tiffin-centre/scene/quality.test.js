import { describe, it, expect } from 'vitest';
import { QUALITY, QUALITY_ORDER, KNOB_KEYS, pickQuality, lowerQuality, minTier, createQualitySampler, createScaler, createDrawCallGuard, DRAW_CALL_BUDGET, frameBudgetFor, tierBudgetFor, shadowEveryFor, deviceTweaks, applyDeviceTweaks } from './quality.js';

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
    // it only goes down while the frame is too slow (a later probe back up is allowed once the frame time recovers, and is judged separately)
    const firstUp = scales.findIndex((v, i) => i > 0 && v > scales[i - 1]);
    const downs = firstUp < 0 ? scales : scales.slice(0, firstUp);
    expect(downs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < downs.length; i++) expect(downs[i]).toBeLessThan(downs[i - 1]);
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
  it('undoes the useless downscales when the frame is CPU bound, freezes there and does not keep asking the pixels to help', () => {
    const s = createScaler({ budget: 0.03, min: 0.5, step: 0.1 });
    const seen = [];
    for (let i = 0; i < 6000; i++) {
      const r = s.push(0.06); // 60 ms whatever the resolution
      if (r) seen.push(r);
    }
    const tier = seen.find((v) => v.tier);
    expect(tier).toBeTruthy();
    expect(tier.revertTo).toBe(1); // the picture goes back to full resolution
    expect(s.scale).toBe(1);
    expect(s.cpuBound).toBe(true);
    // afterwards it never lowers the scale again (a caller that ignores the tier verdict, such as an explicit Graphics choice, keeps a sharp picture)
    const after = seen.slice(seen.indexOf(tier) + 1);
    expect(after.every((v) => !v.scale)).toBe(true);
    expect(s.scale).toBe(1);
  });
  it('keeps the steps that did help (GPU bound) and only reverts when a step bought nothing', () => {
    const s = createScaler({ budget: 0.03, min: 0.5, step: 0.1 });
    // the first two steps help (0.9 and 0.8), the rest is a CPU floor of 45 ms
    let last = null;
    for (let i = 0; i < 8000; i++) {
      const dt = Math.max(0.045, 0.09 * s.scale * s.scale * s.scale);
      const r = s.push(dt);
      if (r?.tier) { last = r; break; }
    }
    expect(last).toBeTruthy();
    expect(last.revertTo).toBeGreaterThan(0.6); // not all the way back to 1, not down to the floor: where the gain stopped
    expect(last.revertTo).toBeLessThan(1);
    expect(s.scale).toBe(last.revertTo);
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
  it('settles on a vsync-locked display: steps down to the biggest scale that holds the budget and then stays put', () => {
    // a 60 Hz display: a frame is never shorter than 16.7 ms; the pixels cost 6 ms + 20 ms * scale^2 beyond that
    const ft = (sc) => Math.max(1 / 60, 0.006 + 0.02 * sc * sc);
    const s = createScaler({ budget: 0.02, upSec: 4, cooldownSec: 0.5, windowSec: 1 });
    const changes = [];
    for (let t = 0; t < 120; t += 1 / 60) {
      const r = s.push(ft(s.scale));
      if (r?.scale) changes.push(+r.scale.toFixed(2));
    }
    expect(s.scale).toBeGreaterThanOrEqual(0.7);
    expect(s.scale).toBeLessThanOrEqual(0.9);
    // no thrash: after it settled, at most a couple of probes up (each one reverted), and it ends frozen or steady
    expect(changes.length).toBeLessThanOrEqual(8);
    const tail = changes.slice(-3);
    expect(tail.every((v) => v <= 0.9)).toBe(true);
  });
  it('only asks for a tier drop when the frames are slower than the tier budget; a mildly slow CPU-bound frame just keeps its scale', () => {
    const s = createScaler({ budget: 0.02, tierBudget: 0.03 });
    const seen = [];
    for (let i = 0; i < 6000; i++) {
      const r = s.push(0.024); // 42 fps whatever the resolution: over the scale budget, under the tier budget
      if (r) seen.push(r);
    }
    expect(seen.some((v) => v.tier)).toBe(false);
    expect(s.scale).toBe(1);
    expect(s.cpuBound).toBe(true);
    const slow = createScaler({ budget: 0.02, tierBudget: 0.03 });
    let tier = null;
    for (let i = 0; i < 6000 && !tier; i++) tier = slow.push(0.05)?.tier;
    expect(tier).toBe(1);
  });
  it('does not read an isolated hitch (a compile, a GC pause) as a slow device', () => {
    const s = createScaler({ budget: 0.02, windowSec: 1.2 });
    let verdicts = 0;
    for (let i = 0; i < 3000; i++) {
      const r = s.push(i % 200 === 199 ? 0.7 : 1 / 60); // 60 fps with a 700 ms stall every ~3.3 s
      if (r) verdicts++;
    }
    expect(verdicts).toBe(0);
    expect(s.scale).toBe(1);
  });
  it('goes back to full resolution after a hitch on a vsync-locked display (a flat 16.7 ms frame is headroom)', () => {
    const s = createScaler({ budget: 0.02, upSec: 3, cooldownSec: 0.5, windowSec: 1 });
    for (let t = 0; t < 8; t += 1 / 30) s.push(0.04 * s.scale * s.scale + 0.01); // a slow patch: scales down
    expect(s.scale).toBeLessThan(1);
    for (let t = 0; t < 90; t += 1 / 60) s.push(1 / 60); // fine again
    expect(s.scale).toBe(1);
  });
  it('does not blame a later slowdown on an upscale that held (no spurious flaps, ceiling or freeze)', () => {
    const s = createScaler({ budget: 0.03, upSec: 2, cooldownSec: 0.5, windowSec: 1 });
    for (let t = 0; t < 5; t += 1 / 30) s.push(0.05 * s.scale * s.scale + 0.006);
    for (let t = 0; t < 30; t += 1 / 60) s.push(0.012); // recovers and holds
    const before = s.flaps;
    for (let t = 0; t < 40; t += 1 / 60) s.push(0.012);
    for (let t = 0; t < 3; t += 1 / 30) s.push(0.05 * s.scale * s.scale + 0.006); // a new slow patch much later
    expect(s.flaps).toBe(before);
    expect(s.frozen).toBe(false);
  });
  it('ignores hidden-tab gaps and garbage samples and can restart for a new tier', () => {
    const s = createScaler({ budget: 0.03 });
    for (let i = 0; i < 100; i++) expect(s.push(i % 2 ? 5 : NaN)).toBeNull();
    s.restart(0.8);
    expect(s.scale).toBe(0.8);
  });
});

describe('draw-call guard', () => {
  const FRAME = 1 / 38;
  // feeds `sec` seconds of frames at `dt` with `calls` draw calls; returns the time the verdict came, or null
  const run = (g, tier, sec, dt, calls, frame = FRAME) => {
    for (let t = 0; t < sec; t += dt) if (g.push(dt, calls, tier, frame)) return +(t + dt).toFixed(3);
    return null;
  };

  it('has an increasing per-tier budget below what the heavy tiers were measured at', () => {
    expect(DRAW_CALL_BUDGET).toEqual({ lite: 250, low: 350, medium: 700, high: 1000 });
    const b = QUALITY_ORDER.map((q) => DRAW_CALL_BUDGET[q]);
    expect(b).toEqual([...b].sort((x, y) => x - y));
    expect(frameBudgetFor(QUALITY.lite)).toBeCloseTo(1 / 34, 6);
    expect(frameBudgetFor(QUALITY.medium)).toBeCloseTo(1 / 50, 6);
    expect(tierBudgetFor(QUALITY.medium)).toBeCloseTo(1 / 36, 6);
    expect(tierBudgetFor(QUALITY.lite)).toBeCloseTo(1 / 34, 6);
  });

  it('downgrades after 2 s over budget with frames slower than their budget', () => {
    const g = createDrawCallGuard();
    const at = run(g, 'medium', 5, 1 / 25, 1150); // 25 fps (40 ms) against a 26 ms budget
    expect(at).toBeGreaterThanOrEqual(2);
    expect(at).toBeLessThan(2.1);
    const h = createDrawCallGuard();
    expect(run(h, 'high', 5, 1 / 20, 1379)).toBeGreaterThanOrEqual(2);
    const l = createDrawCallGuard();
    expect(run(l, 'low', 5, 1 / 25, 450)).not.toBeNull();
  });

  it('does not punish a machine that holds its frame budget with many calls', () => {
    const g = createDrawCallGuard();
    expect(run(g, 'medium', 30, 1 / 120, 1150)).toBeNull();
    expect(run(g, 'high', 30, 1 / 90, 1400)).toBeNull();
  });

  it('does not act under the budget, even with slow frames (the dynamic resolution handles those)', () => {
    const g = createDrawCallGuard();
    expect(run(g, 'medium', 20, 1 / 15, 650)).toBeNull();
    expect(run(g, 'low', 20, 1 / 15, 300)).toBeNull();
  });

  it('a count that dips back under the budget restarts the 2 s clock; a one-frame spike does not count', () => {
    const g = createDrawCallGuard();
    expect(run(g, 'medium', 1.5, 1 / 25, 1100)).toBeNull();
    expect(run(g, 'medium', 3, 1 / 25, 300)).toBeNull(); // the smoothed count falls under 700
    expect(run(g, 'medium', 1.5, 1 / 25, 1100)).toBeNull(); // clock restarted: not yet 2 s again
    const s = createDrawCallGuard();
    for (let t = 0; t < 10; t += 1 / 25) expect(s.push(1 / 25, Math.abs(Math.round(t * 25)) % 50 === 0 ? 2000 : 300, 'medium', FRAME)).toBe(false);
  });

  it('never asks from the lowest tier, ignores hidden-tab frames and junk input, and restarts after reset()', () => {
    const g = createDrawCallGuard();
    expect(run(g, 'lite', 20, 1 / 15, 900)).toBeNull();
    expect(g.push(5, 2000, 'medium', FRAME)).toBe(false); // a 5 s hiccup (tab hidden) is not a frame
    expect(g.push(0, 2000, 'medium', FRAME)).toBe(false);
    expect(g.push(NaN, NaN, 'medium', FRAME)).toBe(false);
    expect(g.push(1 / 25, 2000, 'bogus', FRAME)).toBe(false);
    run(g, 'medium', 1.9, 1 / 25, 1100);
    g.reset();
    expect(run(g, 'medium', 1.9, 1 / 25, 1100)).toBeNull();
    expect(run(g, 'medium', 1, 1 / 25, 1100)).not.toBeNull();
  });

  it('walks a heavy device down one tier at a time and stops at lite (the caller resets the guard on a tier change)', () => {
    const g = createDrawCallGuard();
    let tier = 'high';
    const seen = [tier];
    const callsOf = { high: 1379, medium: 1147, low: 293, lite: 189 }; // the measured six-customer numbers
    for (let n = 0; n < 40 && tier !== 'lite'; n++) {
      if (run(g, tier, 3, 1 / 24, callsOf[tier])) {
        tier = lowerQuality(tier);
        seen.push(tier);
        g.reset();
      }
    }
    // low (293 calls) is under its own budget (350): the slow frames there are the resolution scaler's business, so the walk ends at low
    expect(seen).toEqual(['high', 'medium', 'low']);
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
