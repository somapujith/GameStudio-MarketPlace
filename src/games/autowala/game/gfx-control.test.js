import { describe, expect, it, vi } from 'vitest';
import { classifyGpu, createTierMemory, viewportClass } from '@/platform/gfx';
import { GFX } from './config.js';
import { autoStartTier, createScaleFloors, createSwitchableTimer, decideStart, guardMemoryWrites, insuranceTier, memoryPlan, probeGameGpu, resolutionUseless, sanitizeUnits, setupQuality, sharpenStart, viewOf } from './gfx-control.js';

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const integrated = () => classifyGpu({ renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', vendor: 'Google Inc. (AMD)', caps: { webgl: 2, maxTexture: 16384, halfFloatRT: true }, env: { dpr: 1.25, cores: 16, memoryGB: 8, mobile: false } });
const discrete = () => classifyGpu({ renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)', vendor: 'Google Inc. (NVIDIA)', caps: { webgl: 2, maxTexture: 16384, halfFloatRT: true }, env: { dpr: 1.25, cores: 16, memoryGB: 8, mobile: false } });
const software = () => classifyGpu({ renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', vendor: 'Google Inc. (Google)', caps: { webgl: 2, maxTexture: 8192 }, env: { dpr: 1, cores: 8, memoryGB: 8, mobile: false } });
const view = { w: 1536, h: 864, dpr: 1.25 };

/** Drive the generator like game/steps.js drainAsync does: await every yielded promise (its value is NOT handed back). */
async function drive(gen) {
  let r = gen.next();
  while (!r.done) {
    if (r.value && typeof r.value.then === 'function') await r.value;
    r = gen.next();
  }
  return r.value;
}

describe('setupQuality: where the game starts', () => {
  it('an integrated GPU with no history is calibrated and never starts on high, even when the benchmark says so', async () => {
    const calibrate = vi.fn(async () => ({ recommended: { tier: 'high', scale: 1, confident: true, reasons: ['high fits'] } }));
    const out = await drive(setupQuality({ pref: 'auto', view, gpu: integrated(), storage: fakeStorage(), calibrate }));
    expect(calibrate).toHaveBeenCalledTimes(1);
    expect(calibrate.mock.calls[0][0].tiers).toBe(GFX.models); // the game's own cost model, not the generic ladder
    expect(out.aq.initial).toMatchObject({ tier: 'medium', source: 'calibration', lock: false, maxTier: 'medium' });
  });

  it('starts on what the benchmark recommends when that is lower than the class cap', async () => {
    const calibrate = async () => ({ recommended: { tier: 'low', scale: 1, confident: true, reasons: [] } });
    const out = await drive(setupQuality({ pref: 'auto', view, gpu: integrated(), storage: fakeStorage(), calibrate }));
    expect(out.aq.initial).toMatchObject({ tier: 'low', source: 'calibration' });
  });

  it('a discrete GPU may start on high, and the ceiling is high', async () => {
    const calibrate = async () => ({ recommended: { tier: 'high', scale: 1, confident: true, reasons: [] } });
    const out = await drive(setupQuality({ pref: 'auto', view, gpu: discrete(), storage: fakeStorage(), calibrate }));
    expect(out.aq.initial).toMatchObject({ tier: 'high', maxTier: 'high' });
  });

  it('a remembered tier skips the benchmark and starts there (scale included)', async () => {
    const storage = fakeStorage();
    const gpu = integrated();
    createTierMemory({ game: 'autowala', storage }).set(gpu.key, viewportClass(view.w, view.h, view.dpr), { tier: 'medium', scale: 0.8 });
    const calibrate = vi.fn();
    const out = await drive(setupQuality({ pref: 'auto', view, gpu, storage, calibrate }));
    expect(calibrate).not.toHaveBeenCalled();
    expect(out.aq.initial).toMatchObject({ tier: 'medium', scale: 0.8, source: 'memory' });
  });

  it("a player's choice wins over everything and locks the tier", async () => {
    const storage = fakeStorage();
    const calibrate = vi.fn();
    const out = await drive(setupQuality({ pref: 'high', view, gpu: integrated(), storage, calibrate }));
    expect(calibrate).not.toHaveBeenCalled();
    expect(out.aq.initial).toMatchObject({ tier: 'high', source: 'pref', lock: true, maxTier: 'high' });
    expect(out.aq.governor.locked).toBe(true);
  });

  it('a software renderer starts on low (Autowala has no lite) and is not benchmarked', async () => {
    const calibrate = vi.fn();
    const out = await drive(setupQuality({ pref: 'auto', view, gpu: software(), storage: fakeStorage(), calibrate }));
    expect(calibrate).not.toHaveBeenCalled();
    expect(out.aq.initial.tier).toBe('low');
    expect(out.aq.initial.maxTier).toBe('low');
  });

  it('a failed or missing benchmark falls back to the GPU class (medium on an integrated GPU, never high)', async () => {
    for (const calibrate of [async () => null, async () => { throw new Error('no context'); }]) {
      const out = await drive(setupQuality({ pref: 'auto', view, gpu: integrated(), storage: fakeStorage(), calibrate }));
      expect(out.aq.initial).toMatchObject({ tier: 'medium', source: 'class' });
    }
  });

  it('a benchmark that never answers is given up on, and the GPU class decides', async () => {
    const out = await drive(setupQuality({ pref: 'auto', view, gpu: integrated(), storage: fakeStorage(), calibrate: () => new Promise(() => {}), calibrateTimeoutMs: 30 }));
    expect(out.aq.initial).toMatchObject({ tier: 'medium', source: 'class' });
    expect(out.calibration).toBe(null);
  });

  it('a synchronous drain (tests, scripts) skips the benchmark and still gets a tier', () => {
    const gen = setupQuality({ pref: 'auto', view, gpu: integrated(), storage: fakeStorage(), calibrate: async () => null });
    let r = gen.next();
    while (!r.done) r = gen.next(); // no awaiting: the yielded promise is ignored
    expect(r.value.aq.initial.tier).toBe('medium');
  });

  it('hands the governor the game tables (scale floors, call budgets, relative tier cost)', async () => {
    const out = await drive(setupQuality({ pref: 'auto', view, gpu: integrated(), storage: fakeStorage(), calibrate: async () => null }));
    expect(out.aq.tiers).toEqual(['low', 'medium', 'high']);
    expect(out.aq.governor.budgetMs).toBeCloseTo(1000 / 60, 3);
    expect(out.aq.governor.ladder[0]).toBe(1);
  });

  it('forwards the governor decisions to the handlers the game fills in later', async () => {
    const handlers = {};
    const out = await drive(setupQuality({ pref: 'auto', view, gpu: integrated(), storage: fakeStorage(), calibrate: async () => null, handlers }));
    const onScale = vi.fn();
    const onTier = vi.fn();
    handlers.onScale = onScale;
    handlers.onTier = onTier;
    const gov = out.aq.governor;
    // a steady 40 ms frame (1.5x the budget with no GPU timer): the governor must react within a few seconds, through the handlers
    for (let i = 0; i < 600 && !onScale.mock.calls.length && !onTier.mock.calls.length; i++) gov.frame(40, 5, 150, -1);
    expect(onScale.mock.calls.length + onTier.mock.calls.length).toBeGreaterThan(0);
  });
});

describe('the memory warning plan', () => {
  const base = { tier: 'medium', scale: 1, floor: 0.6 };
  it('low: one scale step down first', () => {
    expect(memoryPlan('low', base)).toEqual({ tier: 'medium', scale: 0.9, release: false });
    expect(memoryPlan('low', { ...base, scale: 0.8 })).toEqual({ tier: 'medium', scale: 0.7, release: false });
  });
  it('low: at the scale floor, one tier down at full scale', () => {
    expect(memoryPlan('low', { ...base, scale: 0.6 })).toEqual({ tier: 'low', scale: 1, release: false });
    expect(memoryPlan('low', { ...base, tier: 'high', scale: 0.7, floor: 0.7 })).toEqual({ tier: 'medium', scale: 1, release: false });
  });
  it('low on the lowest tier at the floor changes nothing but stays at the floor', () => {
    expect(memoryPlan('low', { tier: 'low', scale: 0.6, floor: 0.6 })).toEqual({ tier: 'low', scale: 0.6, release: false });
  });
  it('critical: the lowest tier and release the optional memory', () => {
    expect(memoryPlan('critical', { ...base, tier: 'high' })).toEqual({ tier: 'low', scale: 0.6, release: true });
  });
  it('anything else is ignored', () => {
    expect(memoryPlan('fine', base)).toBe(null);
    expect(memoryPlan(undefined, base)).toBe(null);
  });
});

describe('small helpers', () => {
  it('Auto restarts a live switch from the class cap, at most medium', () => {
    expect(autoStartTier(integrated())).toBe('medium');
    expect(autoStartTier(discrete())).toBe('medium');
    expect(autoStartTier(software())).toBe('low');
  });

  it('reads the canvas size and the device ratio, with fallbacks', () => {
    expect(viewOf({ clientWidth: 800, clientHeight: 400 }, { innerWidth: 1, innerHeight: 1, devicePixelRatio: 2 })).toEqual({ w: 800, h: 400, dpr: 2 });
    expect(viewOf({ clientWidth: 0, clientHeight: 0 }, { innerWidth: 1000, innerHeight: 500 })).toEqual({ w: 1000, h: 500, dpr: 1 });
    expect(viewOf(null, null)).toEqual({ w: 1280, h: 720, dpr: 1 });
  });

  it('the probe survives a page with no DOM', () => {
    expect(probeGameGpu(null)).toBe(null);
  });

  it('the switchable timer gives the loop -1 while it is off, and never throws when unsupported', () => {
    const t = createSwitchableTimer({ getExtension: () => null });
    expect(t.supported).toBe(false);
    expect(() => { t.begin(); t.end(); t.rebuild({ getExtension: () => null }); t.dispose(); }).not.toThrow();
    t.enabled = false;
    expect(t.lastMs).toBe(-1);
  });

  it('the tier tables are consistent: every tier has a model, a floor, a budget and a cost; costs rise with the tier', () => {
    for (const t of ['low', 'medium', 'high']) {
      expect(GFX.models[t]).toBeTruthy();
      expect(GFX.scaleMin[t]).toBeGreaterThanOrEqual(0.5);
      expect(GFX.callBudget[t]).toBeGreaterThan(0);
    }
    expect(GFX.tierCost.low).toBeLessThan(GFX.tierCost.medium);
    expect(GFX.tierCost.medium).toBeLessThan(GFX.tierCost.high);
    expect(GFX.callBudget.low).toBeLessThan(GFX.callBudget.medium);
    expect(GFX.models.low.pixelRatio).toBeLessThanOrEqual(GFX.models.medium.pixelRatio);
  });
});

describe('guardMemoryWrites', () => {
  it('drops the memory writes while the game says not to save, and keeps them otherwise', async () => {
    const storage = fakeStorage();
    const gpu = integrated();
    const { aq } = await drive(setupQuality({ pref: 'auto', view, gpu, storage, calibrate: async () => null }));
    let ok = false;
    guardMemoryWrites(aq, () => ok);
    const vp = viewportClass(view.w, view.h, view.dpr);
    aq.memory.set(gpu.key, vp, { tier: 'medium', scale: 0.9 });
    expect(aq.memory.get(gpu.key, vp)).toBe(null);
    ok = true;
    aq.memory.set(gpu.key, vp, { tier: 'medium', scale: 0.9 });
    expect(aq.memory.get(gpu.key, vp)).toMatchObject({ tier: 'medium', scale: 0.9 });
  });
});

describe('sharpenStart', () => {
  it('raises a soft start scale to the floor, keeps the tier, and says so', () => {
    const cal = { ok: true, recommended: { tier: 'low', scale: 0.6, confident: true, reasons: ['low only fits at scale 0.6'] } };
    const out = sharpenStart(cal, 0.85);
    expect(out.recommended).toMatchObject({ tier: 'low', scale: 0.85, confident: true });
    expect(out.recommended.reasons.at(-1)).toContain('raised from 0.6 to 0.85');
    expect(cal.recommended.scale).toBe(0.6); // the input is not touched
  });
  it('starts at full scale when the estimate says draw calls, not pixels, are the limit', () => {
    const cal = { recommended: { tier: 'low', scale: 0.6, estimates: { low: { ms: 16, cpu: 14.5, gpu: 6 } }, reasons: [] } };
    expect(sharpenStart(cal, 0.85).recommended.scale).toBe(1);
    expect(sharpenStart(cal, 0.85).recommended.reasons.at(-1)).toContain('draw calls');
    const pixelBound = { recommended: { tier: 'medium', scale: 0.7, estimates: { medium: { ms: 20, cpu: 4, gpu: 18 } }, reasons: [] } };
    expect(sharpenStart(pixelBound, 0.85).recommended.scale).toBe(0.85);
  });
  it('leaves a sharp start and a missing result alone', () => {
    const cal = { recommended: { tier: 'medium', scale: 0.9, reasons: [] } };
    expect(sharpenStart(cal, 0.85)).toBe(cal);
    expect(sharpenStart(null)).toBe(null);
    expect(sharpenStart({ recommended: null })).toEqual({ recommended: null });
  });
  it('the benchmark path applies it: a calibration that says low at 0.5 starts low at the game floor', async () => {
    const calibrate = async () => ({ recommended: { tier: 'low', scale: 0.5, confident: true, reasons: [] } });
    const out = await drive(setupQuality({ pref: 'auto', view, gpu: integrated(), storage: fakeStorage(), calibrate }));
    expect(out.aq.initial).toMatchObject({ tier: 'low', source: 'calibration' });
    expect(out.aq.initial.scale).toBeGreaterThanOrEqual(GFX.startScaleMin - 0.06); // the governor snaps it to its ladder
  });
});

describe('scale floors', () => {
  it('start at the game table and a pin lifts a tier and every tier below it to 1', () => {
    const f = createScaleFloors({ low: 0.6, medium: 0.6, high: 0.7 });
    expect(f.get('medium')).toBe(0.6);
    f.pin('medium');
    expect(f.snapshot()).toEqual({ low: 1, medium: 1, high: 0.7 });
    f.reset();
    expect(f.snapshot()).toEqual({ low: 0.6, medium: 0.6, high: 0.7 });
    expect(f.get('nope')).toBe(0.6);
  });

  it('are seeded from a benchmark estimate: a tier bound by the main thread gets floor 1', () => {
    const f = createScaleFloors({ low: 0.6, medium: 0.6, high: 0.7 });
    f.seed({ recommended: { estimates: { low: { cpu: 15, gpu: 9 }, medium: { cpu: 18, gpu: 25 }, high: { cpu: 20, gpu: 30 } } } });
    expect(f.snapshot()).toEqual({ low: 1, medium: 0.6, high: 0.7 });
    expect(() => f.seed(null)).not.toThrow();
    expect(() => f.seed({ recommended: { estimates: {} } })).not.toThrow();
  });

  it('recognise the "resolution did not help" verdicts of the governor', () => {
    expect(resolutionUseless('scale restored: lowering it bought nothing and no lower tier exists')).toBe(true);
    expect(resolutionUseless('resolution did not help (21.0 -> 20.9 ms): cpu / draw-call bound')).toBe(true);
    expect(resolutionUseless('mean 21.1 ms vs budget 16.7 ms')).toBe(false);
    expect(resolutionUseless(undefined)).toBe(false);
  });

  it('a tier the player chose is softened only down to pinnedScaleMin, a pin to 1 is never lowered', async () => {
    const out = await drive(setupQuality({ pref: 'medium', view, gpu: integrated(), storage: fakeStorage(), calibrate: async () => null }));
    expect(out.floors.get('medium')).toBe(GFX.pinnedScaleMin);
    expect(out.floors.get('low')).toBe(GFX.scaleMin.low);
    const f = createScaleFloors({ low: 0.6, medium: 0.6, high: 0.7 });
    f.pin('medium');
    f.setMin('medium', 0.8);
    expect(f.get('medium')).toBe(1);
  });

  it('the start-up path hands the governor the floors, seeded by the benchmark', async () => {
    const calibrate = async () => ({ recommended: { tier: 'low', scale: 1, confident: true, estimates: { low: { cpu: 14, gpu: 8 }, medium: { cpu: 20, gpu: 28 }, high: { cpu: 22, gpu: 34 } }, reasons: [] } });
    const out = await drive(setupQuality({ pref: 'auto', view, gpu: integrated(), storage: fakeStorage(), calibrate }));
    expect(out.floors.get('low')).toBe(1);
    expect(out.floors.get('medium')).toBe(GFX.scaleMin.medium);
  });
});

describe('decideStart: our reading of the benchmark', () => {
  const viewport = { w: 1536, h: 864, dpr: 1.25 };
  // units measured on the dev laptop (docs/perf/aw-int.md): busy run, quiet-ish run, and a run whose mtriMs was a 100x outlier
  const busy = { fillNsPerPx: 2.82, callUs: 14.06, mtriMs: 4.48, postNsPerPx: 2.79 };
  const outlier = { fillNsPerPx: 2.79, callUs: 17.2, mtriMs: 293, postNsPerPx: 2.72 };
  const phone = { fillNsPerPx: 9, callUs: 38, mtriMs: 11, postNsPerPx: 9 };
  const quiet = { fillNsPerPx: 0.55, callUs: 3, mtriMs: 1.35, postNsPerPx: 0.69 };
  const cal = (units, vp = viewport) => ({ ok: true, units, viewport: vp, recommended: { tier: 'low', scale: 0.6, confident: true, estimates: {}, reasons: ['generic'] } });

  it('keeps an integrated laptop on its class cap even when the busy benchmark says medium misses the budget (a wrong low start stays low)', () => {
    const out = decideStart(cal(busy), { cap: 'medium' });
    expect(out.recommended.tier).toBe('medium');
    expect(out.recommended.estimates.medium.ms).toBeGreaterThan(16.7); // it IS over the budget: the governor will see it, and decide with evidence
    expect(out.recommended.confident).toBe(true);
  });

  it('is not fooled by one absurd unit (mtriMs 293): the units are sanitised', () => {
    expect(sanitizeUnits({ mtriMs: 293, callUs: 0.01, fillNsPerPx: NaN, postNsPerPx: 99 })).toEqual({ fillNsPerPx: 0.1, callUs: 0.5, mtriMs: 12, postNsPerPx: 8 });
    expect(decideStart(cal(outlier), { cap: 'medium' }).recommended.tier).toBe('medium');
  });

  it('a hopeless machine (a weak phone: > 2.5 x the budget even for medium) starts on low', () => {
    const out = decideStart(cal(phone, { w: 844, h: 390, dpr: 3 }), { cap: 'medium' });
    expect(out.recommended.estimates.medium.ms).toBeGreaterThan(41.7);
    expect(out.recommended.tier).toBe('low');
  });

  it('never goes above the class cap, whatever the units say', () => {
    expect(decideStart(cal(quiet), { cap: 'medium' }).recommended.tier).toBe('medium');
    expect(decideStart(cal(quiet), { cap: 'high' }).recommended.tier).toBe('high');
    expect(decideStart(cal(quiet), { cap: 'low' }).recommended.tier).toBe('low');
  });

  it('keeps the answer of a benchmark without units (aborted or too slow to run) and survives null', () => {
    const aborted = { ok: true, recommended: { tier: 'low', scale: 0.6, reasons: ['aborted'] } };
    expect(decideStart(aborted)).toBe(aborted);
    expect(decideStart(null)).toBe(null);
  });

  it('the start-up path applies it: a measured laptop starts on medium', async () => {
    const calibrate = async () => cal(busy);
    const out = await drive(setupQuality({ pref: 'auto', view, gpu: integrated(), storage: fakeStorage(), calibrate }));
    expect(out.aq.initial).toMatchObject({ tier: 'medium', source: 'calibration' });
  });

  it('a failed tier-up is not written to tier memory for a week', async () => {
    const storage = fakeStorage();
    const gpu = integrated();
    const out = await drive(setupQuality({ pref: 'auto', view, gpu, storage, calibrate: async () => null }));
    out.aq.memory.markFailed(gpu.key, viewportClass(view.w, view.h, view.dpr), 'medium');
    expect(out.aq.memory.isFailed(gpu.key, viewportClass(view.w, view.h, view.dpr), 'medium')).toBe(false);
  });
});

describe('insuranceTier: the fallback built behind the loading bar', () => {
  const start = (tier, source, lock = false) => ({ tier, source, lock });
  it('is the tier below an unproved start', () => {
    expect(insuranceTier(start('medium', 'class'), undefined, 16.7)).toBe('low');
    expect(insuranceTier(start('high', 'calibration'), { ms: 30 }, 16.7)).toBe('medium');
  });
  it('is skipped for a remembered tier, a chosen tier, the lowest tier and a start the benchmark says fits', () => {
    expect(insuranceTier(start('medium', 'memory'), undefined, 16.7)).toBe(null);
    expect(insuranceTier(start('medium', 'pref', true), undefined, 16.7)).toBe(null);
    expect(insuranceTier(start('low', 'class'), undefined, 16.7)).toBe(null);
    expect(insuranceTier(start('medium', 'calibration'), { ms: 12 }, 16.7)).toBe(null);
  });
});
