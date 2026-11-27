// A closed-loop check of the governor wired the way Game.js wires it (same tables, same tier-swap controller): a synthetic Autowala whose frame
// cost depends on the tier and the scale the governor itself picked. It pins the behaviour we want on a draw-call-bound GPU: the tier steps
// down once, quickly, scale never makes the picture soft for nothing, and it does not flip back and forth.
import { describe, expect, it } from 'vitest';
import { classifyGpu } from '@/platform/gfx';
import { createTierSwitch } from './tier-switch.js';
import { resolutionUseless, setupQuality } from './gfx-control.js';

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const integrated = () => classifyGpu({ renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', vendor: 'Google Inc. (AMD)', caps: { webgl: 2, maxTexture: 16384, halfFloatRT: true }, env: { dpr: 1.25, cores: 16, memoryGB: 8, mobile: false } });
const view = { w: 1536, h: 864, dpr: 1.25 };

async function boot(startTier, storage = fakeStorage()) {
  const handlers = {};
  const gen = setupQuality({ pref: 'auto', view, gpu: integrated(), storage, calibrate: async () => ({ recommended: { tier: startTier, scale: 1, confident: true, reasons: [] } }), handlers });
  let r = gen.next();
  while (!r.done) {
    if (r.value && r.value.then) await r.value;
    r = gen.next();
  }
  return { ...r.value, handlers };
}

/**
 * Run `seconds` of frames. cost(tier, scale) -> { cpu, gpu } in ms; the frame is max(cpu, gpu); the governor is fed what Game.js feeds it
 * (frame time, the game's own JS time OUTSIDE gfx.render, draw calls, the GPU timer).
 */
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

async function simulate({ aq, handlers, floors }, { start, seconds, cost, calls = () => 200 }) {
  const gov = aq.governor;
  let tier = start;
  let scale = aq.initial.scale;
  let now = 0;
  const swaps = [];
  const scales = [];
  const sw = createTierSwitch({
    warm: () => Promise.resolve('done'),
    getTier: () => tier,
    hold: (ms) => gov.hold(ms),
    apply: (t, s) => {
      swaps.push({ at: Math.round(now), from: tier, to: t });
      tier = t;
      scale = s;
    },
    now: () => now,
  });
  // the same reactions as Game.js: a "resolution did not help" verdict pins the scale floor of the tier and the ones below it to 1
  handlers.onScale = (s, info) => {
    if (resolutionUseless(info.reason)) floors.pin(gov.tier);
    scales.push({ at: Math.round(now), scale: s });
    scale = s;
  };
  handlers.onTier = (t, info) => {
    if (resolutionUseless(info.reason)) floors.pin(info.from);
    if (info.kind === 'down') gov.markTierFailed(info.from);
    sw.request(t, info.scale);
  };
  gov.hold(4000);
  while (now < seconds * 1000) {
    sw.frame();
    const c = cost(tier, scale);
    const dt = Math.max(c.cpu, c.gpu) * (1 + 0.06 * (rnd() - 0.5)); // +-3 % jitter: a real frame is never exactly the same twice
    now += dt;
    gov.frame(dt, 1.5, calls(tier), c.gpu * 0.8);
    await Promise.resolve(); // a microtask turn per frame: a finished warm-up promise lands before the next frame, as it would between two rAF callbacks
  }
  return { swaps, scales, tier, scale };
}

// the dev laptop's integrated GPU: draw-call bound, so the resolution buys almost nothing (docs/perf/aw-gpu.md)
const callBound = (tier, scale) => {
  const cpu = { low: 11, medium: 21, high: 30 }[tier];
  const gpu = { low: 6, medium: 14, high: 24 }[tier] * scale * scale;
  return { cpu, gpu };
};
// a pixel-bound GPU: the main thread is quick, the pixels are the cost
const pixelBound = (tier, scale) => {
  const cpu = { low: 4, medium: 6, high: 8 }[tier];
  const gpu = { low: 12, medium: 24, high: 40 }[tier] * scale * scale;
  return { cpu, gpu };
};

describe('governor + tier switch, closed loop', () => {
  it('a draw-call-bound medium that misses 60 fps tries the resolution, sees it buys nothing, and steps to low once', async () => {
    const b = await boot('medium');
    const r = await simulate(b, { start: 'medium', seconds: 120, cost: callBound });
    expect(r.swaps.filter((s) => s.to === 'low')).toHaveLength(1);
    expect(r.swaps[0].at).toBeLessThan(12000); // 4 s start-up hold + two no-gain steps
    expect(r.scales.length).toBeGreaterThan(0);
    expect(r.scales.length).toBeLessThanOrEqual(3);
    expect(r.swaps).toHaveLength(1); // no climbing back up: medium is marked as one that cannot hold the budget here (the timer-based prediction would say it fits)
    expect(r.tier).toBe('low');
    expect(r.scale).toBeGreaterThanOrEqual(0.9); // the sharpness the no-gain steps took is given back
  });

  it('on the lowest tier a draw-call-bound frame is NOT answered with a soft / sharp cycle: one no-gain verdict and the resolution is left alone', async () => {
    const b = await boot('low');
    const r = await simulate(b, { start: 'low', seconds: 180, cost: () => ({ cpu: 21, gpu: 12 }) }); // 48 fps, nothing lower to go to
    expect(r.swaps).toHaveLength(0);
    expect(r.scales.length).toBeLessThanOrEqual(3); // down, down, restored: once
    expect(r.scale).toBe(1);
    expect(b.floors.get('low')).toBe(1);
  });

  it('a benchmark that already said "draw-call bound" keeps the resolution at 1 from the first frame', async () => {
    const calibrate = async () => ({ recommended: { tier: 'low', scale: 1, confident: true, estimates: { low: { cpu: 15, gpu: 9 }, medium: { cpu: 21, gpu: 19 }, high: { cpu: 22, gpu: 21 } }, reasons: [] } });
    const handlers = {};
    const gen = setupQuality({ pref: 'auto', view, gpu: integrated(), storage: fakeStorage(), calibrate, handlers });
    let r = gen.next();
    while (!r.done) {
      if (r.value && r.value.then) await r.value;
      r = gen.next();
    }
    const out = { ...r.value, handlers };
    const res = await simulate(out, { start: 'low', seconds: 120, cost: () => ({ cpu: 21, gpu: 12 }) });
    expect(res.scales).toHaveLength(0);
    expect(res.scale).toBe(1);
  });

  it('a medium that fits the frame budget is left alone for two minutes', async () => {
    const b = await boot('medium');
    const r = await simulate(b, { start: 'medium', seconds: 120, cost: () => ({ cpu: 13, gpu: 9 }) });
    expect(r.swaps).toHaveLength(0);
    expect(r.scales).toHaveLength(0);
  });

  it('a pixel-bound GPU is handled with the resolution first, and keeps the tier', async () => {
    const b = await boot('medium');
    const r = await simulate(b, { start: 'medium', seconds: 60, cost: pixelBound });
    expect(r.swaps).toHaveLength(0);
    expect(r.scales.length).toBeGreaterThan(0);
    expect(r.scale).toBeGreaterThanOrEqual(0.6); // never below the tier's floor
    expect(r.scale).toBeLessThan(1);
  });

  it('nothing is judged during the first seconds (the start-up hold)', async () => {
    const b = await boot('medium');
    const r = await simulate(b, { start: 'medium', seconds: 3.5, cost: () => ({ cpu: 60, gpu: 10 }) });
    expect(r.swaps).toHaveLength(0);
    expect(r.scales).toHaveLength(0);
  });

  it('while a swap waits for its warm-up the governor stays quiet, and the slow frames of the warm-up are not read as load', async () => {
    const b = await boot('high');
    const gov = b.aq.governor;
    const decisions = [];
    b.handlers.onScale = (sc) => decisions.push(['scale', sc]);
    b.handlers.onTier = (t) => decisions.push(['tier', t]);
    let tier = 'high';
    let resolve;
    const applied = [];
    const sw = createTierSwitch({
      warm: () => new Promise((r) => { resolve = r; }),
      getTier: () => tier,
      hold: (ms) => gov.hold(ms),
      apply: (t) => { applied.push(t); tier = t; },
      now: () => 0,
    });
    gov.hold(4000);
    for (let i = 0; i < 200; i++) gov.frame(16, 1.5, 200, -1); // the start-up hold passes
    sw.request('medium', 1); // the governor's decision, say
    let t = 0;
    while (t < 8000) { // eight seconds of frames at 60 ms (the warm-up building programs): a plain governor would step down again and again
      sw.frame();
      gov.frame(60, 1.5, 200, -1);
      t += 60;
    }
    expect(decisions).toEqual([]);
    expect(applied).toEqual([]);
    resolve('done');
    await Promise.resolve();
    await Promise.resolve();
    expect(sw.frame()).toBe(true);
    expect(applied).toEqual(['medium']);
    // and right after the swap the governor ignores the settling frames too
    for (let i = 0; i < 20; i++) gov.frame(40, 1.5, 200, -1);
    expect(decisions).toEqual([]);
  });
});

describe('tier memory is written by the governor after stable play', () => {
  it('a low tier holding the budget for 8 s is remembered, with the scale it settled on', async () => {
    const storage = fakeStorage();
    const handlers = {};
    const gpu = integrated();
    const gen = setupQuality({ pref: 'auto', view, gpu, storage, calibrate: async () => ({ recommended: { tier: 'low', scale: 1, confident: true, reasons: [] } }), handlers });
    let r = gen.next();
    while (!r.done) {
      if (r.value && r.value.then) await r.value;
      r = gen.next();
    }
    const { aq } = r.value;
    const gov = aq.governor;
    gov.hold(4000);
    let now = 0;
    while (now < 30000) {
      const dt = 13 * (1 + 0.06 * (rnd() - 0.5));
      now += dt;
      gov.frame(dt, 1.5, 150, 9);
    }
    const saved = aq.memory.get(gpu.key, aq.vp);
    expect(saved).toMatchObject({ tier: 'low', scale: 1 });
  });
});
