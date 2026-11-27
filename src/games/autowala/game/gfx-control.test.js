import { describe, expect, it, vi } from 'vitest';
import { classifyGpu, createTierMemory, viewportClass } from '@/platform/gfx';
import { GFX } from './config.js';
import { autoStartTier, createSwitchableTimer, memoryPlan, probeGameGpu, setupQuality, viewOf } from './gfx-control.js';

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
