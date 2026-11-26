import { describe, expect, it } from 'vitest';
import { CHANGE_NONE, CHANGE_SCALE, CHANGE_TIER, DEFAULT_LADDER, createGovernor, detectRefreshHz, fpsCapFromHints, snapRefresh } from './governor.js';

// ---------------------------------------------------------------------------------------------------------------------------------
// A closed-loop frame simulator: the governor's decisions change the cost of the next frame, exactly like a game would.
const rng = (seed = 1) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const TIER_COST = { lite: 0.3, low: 0.55, medium: 1, high: 1.8 };

/**
 * work(tier, scale, tSec) -> ms the frame needs (cpu + gpu). cpu(tier, scale, tSec) -> main-thread ms (default: 25% of work).
 * With vsync the frame time is the work rounded UP to whole refresh intervals (double-buffered swap); without, it is the work itself.
 * extra: { [frameIndex]: ms } adds a one-off stall to that frame.
 */
function simulate(gov, { seconds = 20, work, cpu = null, gpu = null, calls = null, refreshHz = 60, vsync = true, noise = 0, seed = 7, extra = {}, passCpu = true, passGpu = false, t0 = 0 }) {
  const rand = rng(seed);
  const interval = 1000 / refreshHz;
  const changes = [];
  const trace = [];
  let t = t0;
  let i = 0;
  while (t < t0 + seconds * 1000) {
    const ts = t / 1000;
    const jitter = noise ? (rand() * 2 - 1) * noise : 0;
    const w = Math.max(0.5, work(gov.tier, gov.scale, ts) + jitter);
    let dt = vsync ? Math.max(interval, Math.ceil((w - 1e-9) / interval) * interval) : Math.max(w, 1);
    if (extra[i]) dt += extra[i];
    const c = cpu ? cpu(gov.tier, gov.scale, ts) : Math.min(w * 0.25, 5);
    const g = gpu ? gpu(gov.tier, gov.scale, ts) : -1;
    const n = calls ? calls(gov.tier, gov.scale, ts) : -1;
    const code = gov.frame(dt, passCpu ? c : -1, n, passGpu ? g : -1);
    t += dt;
    i++;
    trace.push(dt);
    if (code !== CHANGE_NONE) changes.push({ t: t / 1000, code, scale: gov.scale, tier: gov.tier });
  }
  return { changes, trace, t: t / 1000 };
}
const model = (fixed, variable) => (tier, scale) => fixed + variable * scale * scale * TIER_COST[tier];
const mk = (o = {}) => createGovernor({ tiers: ['lite', 'low', 'medium', 'high'], tier: 'medium', tierCost: TIER_COST, ...o });
const reversals = (changes) => {
  let n = 0;
  let dir = 0;
  let prev = null;
  for (const c of changes) {
    if (c.code !== CHANGE_SCALE) continue;
    if (prev != null && c.scale !== prev) {
      const d = Math.sign(c.scale - prev);
      if (dir && d !== dir) n++;
      dir = d;
    }
    prev = c.scale;
  }
  return n;
};

describe('steady loads', () => {
  it('a load that fits never changes anything (60 s)', () => {
    const gov = mk();
    const r = simulate(gov, { seconds: 60, work: model(2, 8) });
    expect(r.changes).toEqual([]);
    expect(gov.scale).toBe(1);
    expect(gov.tier).toBe('medium');
  });
  it('a fixed budget miss converges to the right rung in under 3 s and stays there', () => {
    const gov = mk();
    const r = simulate(gov, { seconds: 60, work: model(2, 26) }); // fits 16.7 ms only at scale <= .74
    expect(gov.scale).toBe(0.7);
    expect(gov.tier).toBe('medium');
    const converged = r.changes.find((c) => c.scale === 0.7);
    expect(converged.t).toBeLessThan(3);
    // after convergence: only bounded, immediately reverted probes (two per rung at most); it never ends up oscillating
    const after = r.changes.filter((c) => c.t > converged.t);
    expect(after.length).toBeLessThanOrEqual(4);
    expect(reversals(r.changes)).toBeLessThanOrEqual(3); // two failed probes = down-up-down-up
  });
  it('a long steady overload does not oscillate: 7 minutes, one re-probe per ~2 minutes at most', () => {
    const gov = mk();
    const r = simulate(gov, { seconds: 420, work: model(2, 26) });
    expect(gov.scale).toBe(0.7);
    const late = r.changes.filter((c) => c.t > 25);
    // after the first two (failed) probes, changes come in up / down pairs at least 90 s apart
    expect(late.length).toBeLessThanOrEqual(10);
    for (let i = 2; i < late.length; i += 2) expect(late[i].t - late[i - 1].t).toBeGreaterThan(90);
    // every probe is reverted within a second: the time spent above the sustainable rung is tiny
    for (let i = 0; i + 1 < r.changes.length; i++) if (r.changes[i].scale > 0.7) expect(r.changes[i + 1].t - r.changes[i].t).toBeLessThan(1.2);
  });
  it('heavy overload (x3) drops the scale quickly and, at the floor, the tier', () => {
    const gov = mk();
    const r = simulate(gov, { seconds: 30, work: model(2, 90) });
    expect(gov.tier === 'low' || gov.tier === 'lite').toBe(true);
    expect(r.changes.find((c) => c.code === CHANGE_SCALE).t).toBeLessThan(2.5);
    // no frame budget misses forever: the last 5 s are within the budget
    const tail = r.trace.slice(-200);
    expect(tail.reduce((s, v) => s + v, 0) / tail.length).toBeLessThan(16.7 * 1.2);
  });
  it('hysteresis: a load inside the dead band (ratio 1.05-1.15, uncapped) causes no change', () => {
    const gov = mk();
    const r = simulate(gov, { seconds: 60, work: () => 18.2, vsync: false }); // ratio 1.09
    expect(r.changes).toEqual([]);
  });
  it('a noisy load just under the budget (uncapped) is left alone', () => {
    const gov = mk();
    const r = simulate(gov, { seconds: 60, work: () => 14.5, noise: 3, vsync: false });
    expect(r.changes).toEqual([]);
  });
  it('a vsync-locked load with rare overshoot (1 % of frames) is left alone', () => {
    const gov = mk();
    const r = simulate(gov, { seconds: 60, work: () => 12, noise: 2.3, vsync: true });
    expect(r.changes.length).toBeLessThanOrEqual(1);
    expect(gov.scale).toBeGreaterThanOrEqual(0.9);
  });
});

describe('recovery: steps UP as well as down', () => {
  it('vsync-pinned: after the load drops the scale climbs back to 1 (probes), within ~20 s', () => {
    const gov = mk();
    const w = (tier, scale, t) => (t < 10 ? model(2, 26)(tier, scale) : model(2, 8)(tier, scale));
    const r = simulate(gov, { seconds: 45, work: w });
    expect(r.changes.some((c) => c.t < 4 && c.scale < 1)).toBe(true);
    expect(gov.scale).toBe(1);
    const back = r.changes.find((c) => c.scale === 1 && c.t > 10);
    expect(back.t).toBeLessThan(10 + 22);
  });
  it('unpinned (144 Hz display, 60 fps target): the model predicts headroom and climbs without failed probes', () => {
    const gov = mk({ refreshHz: 144 });
    const w = (tier, scale, t) => (t < 8 ? model(1, 22)(tier, scale) : model(1, 5)(tier, scale));
    const r = simulate(gov, { seconds: 30, work: w, refreshHz: 144, vsync: true });
    expect(gov.scale).toBe(1);
    expect(r.changes.at(-1).t).toBeLessThan(20);
    expect(reversals(r.changes)).toBeLessThanOrEqual(2); // down, (one quantised probe at a 144 Hz frame boundary that is reverted), up
  });
  it('recovers when the load drops and then rises again (day / night, crowds): follows it without panic', () => {
    const gov = mk();
    const w = (tier, scale, t) => (t % 40 < 20 ? model(2, 26)(tier, scale) : model(2, 7)(tier, scale));
    const r = simulate(gov, { seconds: 120, work: w });
    // each phase settles; total changes stay modest
    expect(r.changes.length).toBeLessThan(40);
    const last20 = r.changes.filter((c) => c.t > 100);
    expect(last20.length).toBeLessThan(12);
  });
  it('tier up: with a GPU timer the headroom is visible even at vsync, and a better tier is taken after 20 s', () => {
    const gov = mk({ tier: 'low', maxTier: 'high' });
    const busy = (tier, scale) => 1 + 6 * scale * scale * TIER_COST[tier]; // gpu ms
    const r = simulate(gov, { seconds: 90, work: (tier, scale) => Math.max(8, busy(tier, scale)), gpu: busy, passGpu: true, cpu: () => 2 });
    expect(['medium', 'high']).toContain(gov.tier);
    expect(r.changes.some((c) => c.code === CHANGE_TIER && c.t >= 19)).toBe(true);
  });
  it('tier up never exceeds maxTier (the GPU class cap)', () => {
    const gov = mk({ tier: 'low', maxTier: 'medium' });
    const busy = (tier, scale) => 1 + 3 * scale * scale * TIER_COST[tier];
    simulate(gov, { seconds: 120, work: () => 8, gpu: busy, passGpu: true, cpu: () => 2 });
    expect(gov.tier).toBe('medium');
  });
  it('a failed tier-up is reverted at once, reported, and not retried', () => {
    const failed = [];
    const gov = mk({ tier: 'medium', maxTier: 'high', onTierFailed: (t) => failed.push(t) });
    // the GPU timer says there is room (it lies: the real cost of high is far above the model)
    const real = (tier, scale) => 1 + (tier === 'high' ? 40 : 6) * scale * scale;
    const r = simulate(gov, { seconds: 120, work: real, gpu: () => 4, passGpu: true, cpu: () => 2 });
    expect(failed).toEqual(['high']);
    expect(gov.tier).toBe('medium');
    expect(r.changes.filter((c) => c.code === CHANGE_TIER && c.tier === 'high').length).toBe(1);
  });
  it('failedTiers (from tier memory) are never tried', () => {
    const gov = mk({ tier: 'medium', maxTier: 'high', failedTiers: ['high'] });
    simulate(gov, { seconds: 90, work: () => 6, gpu: () => 3, passGpu: true, cpu: () => 2 });
    expect(gov.tier).toBe('medium');
  });
  it('without a timer and at vsync the tier is not raised on faith (no failed-tier hitches)', () => {
    const gov = mk({ tier: 'low', maxTier: 'high' });
    simulate(gov, { seconds: 90, work: model(1, 4) });
    expect(gov.tier).toBe('low');
  });
});

describe('hitches, warm-up and discontinuities are ignored', () => {
  it('one-off stalls (shader compile, GC) never change the scale', () => {
    const gov = mk();
    const extra = {};
    for (let i = 100; i < 3500; i += 97) extra[i] = 90 + (i % 5) * 60; // a 90-330 ms stall every ~1.6 s
    const r = simulate(gov, { seconds: 60, work: model(2, 8), extra });
    expect(r.changes).toEqual([]);
    expect(gov.stats().counts.hitches + gov.stats().counts.discontinuities).toBeGreaterThan(10);
  });
  it('a burst of start-up stalls in the first second (program compiles) is ignored', () => {
    const gov = mk();
    const r = simulate(gov, { seconds: 20, work: model(2, 8), extra: { 2: 400, 5: 350, 9: 300, 14: 200, 30: 120 } });
    expect(r.changes).toEqual([]);
  });
  it('a tab switch (dt of seconds) is not a verdict, before or after', () => {
    const gov = mk();
    simulate(gov, { seconds: 10, work: model(2, 8) });
    for (const dt of [3000, 12000, 60000]) {
      expect(gov.frame(dt)).toBe(CHANGE_NONE);
      const r = simulate(gov, { seconds: 8, work: model(2, 8), t0: 0 });
      expect(r.changes).toEqual([]);
    }
    expect(gov.scale).toBe(1);
    expect(gov.stats().counts.discontinuities).toBe(3);
  });
  it('a single slow window (GC burst of 5 slow frames) is not acted on; two are', () => {
    const gov = mk();
    // warm up, then 5 frames at 40 ms inside a healthy run
    simulate(gov, { seconds: 5, work: model(2, 8) });
    for (let i = 0; i < 5; i++) gov.frame(40, 10);
    const r = simulate(gov, { seconds: 10, work: model(2, 8) });
    expect(r.changes).toEqual([]);
    expect(gov.scale).toBe(1);
  });
  it('hold() ignores the next frames', () => {
    const gov = mk();
    simulate(gov, { seconds: 3, work: model(2, 8) });
    gov.hold(2000);
    // 2 s of terrible frames inside the hold: nothing happens
    let t = 0;
    while (t < 1800) {
      expect(gov.frame(60, 10)).toBe(CHANGE_NONE);
      t += 60;
    }
    expect(gov.scale).toBe(1);
  });
});

describe('CPU / draw-call bound: the tier, not the resolution', () => {
  it('with cpuMs reported, a CPU-bound frame steps the tier down at once and never blurs the picture', () => {
    const gov = mk();
    const r = simulate(gov, { seconds: 15, work: (tier) => 6 + 17 * TIER_COST[tier], cpu: (tier) => 5 + 16 * TIER_COST[tier] });
    expect(r.changes[0]).toMatchObject({ code: CHANGE_TIER, tier: 'low' });
    expect(r.changes[0].t).toBeLessThan(3);
    expect(gov.scale).toBe(1);
    expect(r.changes).toHaveLength(1);
  });
  it('without cpuMs: scaling shows no gain, the scale is restored to 1 and the tier drops, in under 3.5 s', () => {
    const gov = mk();
    const r = simulate(gov, { seconds: 20, work: (tier) => 8 + 14 * TIER_COST[tier], passCpu: false }); // resolution-independent cost
    const tierChange = r.changes.find((c) => c.code === CHANGE_TIER);
    expect(tierChange).toBeTruthy();
    expect(tierChange.t).toBeLessThan(3.5);
    expect(tierChange.scale).toBe(1);
    expect(gov.scale).toBe(1);
    expect(gov.tier).toBe('low');
  });
  it('a fill-bound load is solved by scale alone: the tier is untouched', () => {
    const gov = mk();
    simulate(gov, { seconds: 20, work: model(1, 24), passCpu: false });
    expect(gov.tier).toBe('medium');
    expect(gov.scale).toBeLessThan(1);
  });
  it('draw calls over the tier budget while missing the frame budget step the tier down (2 s)', () => {
    const gov = mk({ callBudgets: { lite: 250, low: 350, medium: 700, high: 1000 } });
    const r = simulate(gov, { seconds: 15, work: (tier) => 8 + 20 * TIER_COST[tier], calls: (tier) => (tier === 'medium' ? 1100 : 300), passCpu: false });
    expect(r.changes.some((c) => c.code === CHANGE_TIER && c.tier === 'low')).toBe(true);
  });
  it('a fast machine with many draw calls but a held frame rate is never punished', () => {
    const gov = mk({ callBudgets: { medium: 700 } });
    const r = simulate(gov, { seconds: 30, work: () => 9, calls: () => 1500 });
    expect(r.changes).toEqual([]);
  });
  it('a locked tier only ever moves the scale', () => {
    const gov = mk({ lockTier: true });
    simulate(gov, { seconds: 30, work: (tier) => 10 + 40 * TIER_COST[tier], passCpu: false });
    expect(gov.tier).toBe('medium');
    expect(gov.scale).toBeLessThan(1);
  });
  it('the lowest tier at the scale floor stays put (nothing more to give)', () => {
    const gov = mk({ tier: 'lite' });
    const r = simulate(gov, { seconds: 20, work: model(2, 400) });
    expect(gov.tier).toBe('lite');
    expect(gov.scale).toBe(0.5);
    expect(r.changes.every((c) => c.code === CHANGE_SCALE)).toBe(true);
  });
});

describe('scale ladder', () => {
  it('only ever emits rungs of the ladder', () => {
    const seen = new Set();
    const gov = mk({ onScale: (s) => seen.add(s) });
    simulate(gov, { seconds: 90, work: (tier, scale, t) => (t % 30 < 15 ? model(2, 40)(tier, scale) : model(2, 6)(tier, scale)), noise: 1.5 });
    expect(seen.size).toBeGreaterThan(1);
    for (const s of seen) expect(DEFAULT_LADDER).toContain(s);
  });
  it('snaps an arbitrary start scale (from tier memory) to the nearest rung', () => {
    expect(mk({ scale: 0.83 }).scale).toBe(0.8);
    expect(mk({ scale: 5 }).scale).toBe(1);
    expect(mk({ scale: 0.1 }).scale).toBe(0.5);
  });
  it('per-tier floors are respected', () => {
    const gov = mk({ tier: 'lite', scaleMin: { lite: 0.7, low: 0.5, medium: 0.5, high: 0.5 } });
    simulate(gov, { seconds: 20, work: model(2, 400) });
    expect(gov.scale).toBe(0.7);
  });
});

describe('refresh-rate awareness', () => {
  const locked = (hz, n = 200, jitter = 0.25, seed = 3) => {
    const r = rng(seed);
    return Array.from({ length: n }, () => 1000 / hz + (r() * 2 - 1) * jitter);
  };
  it('snapRefresh', () => {
    expect(snapRefresh(16.67)).toBe(60);
    expect(snapRefresh(6.94)).toBe(144);
    expect(snapRefresh(11.1)).toBe(90);
    expect(snapRefresh(8.33)).toBe(120);
    expect(snapRefresh(20)).toBe(50);
    expect(snapRefresh(33.3)).toBe(0); // 30 Hz is a slow machine, not a slow display
    expect(snapRefresh(3)).toBe(0);
  });
  for (const hz of [60, 72, 75, 90, 120, 144, 165]) {
    it(`detects ${hz} Hz from jittery vsync intervals`, () => expect(detectRefreshHz(locked(hz))).toBe(hz));
  }
  it('detects 60 Hz even when a third of the frames miss vsync', () => {
    const base = locked(60, 300);
    const mixed = base.map((v, i) => (i % 3 === 0 ? v * 2 : v));
    expect(detectRefreshHz(mixed)).toBe(60);
  });
  it('answers 0 for an uncapped loop and for a machine locked at 30 fps', () => {
    const r = rng(5);
    expect(detectRefreshHz(Array.from({ length: 200 }, () => 2 + r() * 9))).toBe(0);
    expect(detectRefreshHz(locked(30))).toBe(0);
    expect(detectRefreshHz([16.7, 16.7])).toBe(0);
  });
  it('the governor adopts the detected rate (after two agreeing detections) and reports it', () => {
    let got = 0;
    const gov = mk({ targetFps: 144, onRefresh: (hz) => (got = hz) });
    expect(gov.refreshKnown).toBe(false);
    for (const dt of locked(144, 400)) gov.frame(dt, 2);
    expect(got).toBe(144);
    expect(gov.refreshHz).toBe(144);
    expect(gov.budgetMs).toBeCloseTo(1000 / 144, 3);
  });
  it('budget = 1 / min(refresh, targetFps): a 144 Hz panel does not demand 6.9 ms of a 60 fps game', () => {
    const gov = mk({ refreshHz: 144 });
    expect(gov.budgetMs).toBeCloseTo(1000 / 60, 3);
    expect(mk({ refreshHz: 144, targetFps: 144 }).budgetMs).toBeCloseTo(1000 / 144, 3);
    expect(mk({ refreshHz: 50 }).budgetMs).toBeCloseTo(20, 3);
    expect(mk().budgetMs).toBeCloseTo(1000 / 60, 3);
  });
  it('on a 120 Hz display with targetFps 120 the governor chases 8.3 ms', () => {
    const gov = mk({ refreshHz: 120, targetFps: 120 });
    const r = simulate(gov, { seconds: 30, work: model(1, 14), refreshHz: 120 }); // 15 ms at scale 1: over 8.3
    expect(gov.scale).toBeLessThan(1);
    expect(r.changes.length).toBeGreaterThan(0);
  });
});

describe('battery / reduced-data hints cap the frame rate', () => {
  it('fpsCapFromHints', () => {
    expect(fpsCapFromHints({})).toBe(0);
    expect(fpsCapFromHints({ batteryLow: true })).toBe(30);
    expect(fpsCapFromHints({ saveData: true })).toBe(30);
    expect(fpsCapFromHints({ lowPower: true })).toBe(30);
    expect(fpsCapFromHints({ thermal: 'serious' })).toBe(30);
    expect(fpsCapFromHints({ thermal: 'fair' })).toBe(0);
    expect(fpsCapFromHints({ capFps: 45, batteryLow: true })).toBe(45);
  });
  it('setHints changes the budget and fpsCap; a capped loop at its cap interval is on budget (no change)', () => {
    const gov = mk();
    expect(gov.setHints({ batteryLow: true })).toBe(30);
    expect(gov.fpsCap).toBe(30);
    expect(gov.budgetMs).toBeCloseTo(33.33, 1);
    const r = simulate(gov, { seconds: 30, work: model(2, 8), refreshHz: 30 });
    expect(r.changes).toEqual([]);
    expect(gov.setHints({ batteryLow: false })).toBe(0);
    expect(gov.budgetMs).toBeCloseTo(16.67, 1);
  });
});

describe('callbacks, stability reports and external control', () => {
  it('onScale / onTier carry the new value and the reason', () => {
    const events = [];
    const gov = mk({ onScale: (s, i) => events.push(['scale', s, i.reason]), onTier: (t, i) => events.push(['tier', t, i.reason]) });
    simulate(gov, { seconds: 10, work: model(2, 26) });
    expect(events[0][0]).toBe('scale');
    expect(events[0][2]).toMatch(/budget/);
  });
  it('onStable fires once per settled rung after 8 s, with the tier and scale to remember', () => {
    const stable = [];
    const gov = mk({ onStable: (s) => stable.push(s) });
    simulate(gov, { seconds: 30, work: model(2, 26) });
    expect(stable.length).toBeGreaterThanOrEqual(1);
    expect(stable[0]).toMatchObject({ tier: 'medium', scale: 0.7 });
    // a perfectly fine run reports once too
    const s2 = [];
    simulate(mk({ onStable: (s) => s2.push(s) }), { seconds: 30, work: model(2, 6) });
    expect(s2).toHaveLength(1);
    expect(s2[0]).toMatchObject({ tier: 'medium', scale: 1 });
  });
  it('setTier (the player picked a tier) restarts adaptation from there', () => {
    const gov = mk();
    simulate(gov, { seconds: 10, work: model(2, 26) });
    gov.setTier('low', { scale: 1, lock: true });
    expect(gov.tier).toBe('low');
    expect(gov.scale).toBe(1);
    expect(gov.locked).toBe(true);
  });
  it('notifyLoadChange forgives failed probes', () => {
    const gov = mk();
    simulate(gov, { seconds: 60, work: model(2, 26) });
    expect(gov.stats().probeFailures.some((v) => v > 0)).toBe(true);
    gov.notifyLoadChange();
    expect(gov.stats().probeFailures.every((v) => v === 0)).toBe(true);
  });
  it('stats() reports percentiles, counts and history', () => {
    const gov = mk();
    simulate(gov, { seconds: 10, work: model(2, 26) });
    const s = gov.stats();
    expect(s.p50).toBeGreaterThan(0);
    expect(s.p99).toBeGreaterThanOrEqual(s.p50);
    expect(s.counts.scaleDown).toBeGreaterThan(0);
    expect(s.history.length).toBeGreaterThan(0);
    expect(s.history[0]).toHaveProperty('reason');
  });
  it('options passed as undefined (forwarded optional settings) fall back to the defaults instead of breaking the controller', () => {
    const gov = mk({ scaleMin: undefined, targetFps: undefined, callBudgets: undefined, ladder: undefined, refreshHz: undefined, maxTier: undefined });
    expect(gov.budgetMs).toBeCloseTo(1000 / 60, 3);
    simulate(gov, { seconds: 15, work: model(2, 26) });
    expect(gov.scale).toBe(0.7);
  });
  it('garbage frame times are ignored', () => {
    const gov = mk();
    for (const v of [0, -5, NaN, undefined, null, Infinity]) expect(gov.frame(v)).toBe(CHANGE_NONE);
  });
});
