import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TIER_MODELS, chooseInitialTier, createCalibration, createThreeLoad, estimateFrameMs, fitSlope, recommendTier, shouldCalibrate } from './calibrate.js';
import { classifyGpu } from './gpu.js';

const desktopEnv = { nav: { hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', maxTouchPoints: 0 }, win: { devicePixelRatio: 1.25 }, mm: () => false };
const gpuOf = (renderer) => classifyGpu({ renderer, ...desktopEnv });
const RADEON = 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const RTX = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const VIEW = { w: 1536, h: 864, dpr: 1.25 };

describe('fitSlope', () => {
  it('recovers an exact line', () => {
    const f = fitSlope([{ W: 1, ms: 1.5 }, { W: 4, ms: 3.9 }, { W: 8, ms: 7.1 }]);
    expect(f.b).toBeCloseTo(0.8, 5);
    expect(f.a).toBeCloseTo(0.7, 5);
  });
  it('one point: the mean cost per unit', () => expect(fitSlope([{ W: 2, ms: 3 }])).toEqual({ a: 0, b: 1.5 }));
  it('a noisy / flat slope falls back to the mean cost per unit', () => {
    const f = fitSlope([{ W: 1, ms: 2 }, { W: 2, ms: 2.02 }, { W: 4, ms: 2.05 }]);
    expect(f.a).toBe(0);
    expect(f.b).toBeCloseTo(2.05 / 4, 5);
  });
  it('empty / bad input', () => {
    expect(fitSlope([])).toEqual({ a: 0, b: 0 });
    expect(fitSlope([{ W: 0, ms: 1 }, { W: -1, ms: 1 }])).toEqual({ a: 0, b: 0 });
  });
  it('never returns a negative overhead', () => expect(fitSlope([{ W: 1, ms: 0.5 }, { W: 3, ms: 3 }]).a).toBe(0));
});

describe('estimateFrameMs: frame = max(cpu, gpu)', () => {
  const units = { fillNsPerPx: 4, callUs: 10, mtriMs: 2, postNsPerPx: 2 };
  it('cpu = calls x callUs, gpu = fill + tris + post', () => {
    const m = { pixelRatio: 1, layers: 2, calls: 300, mtris: 0.5, post: 2 };
    const e = estimateFrameMs(units, m, { w: 1000, h: 1000, dpr: 1 }); // 1 Mpix
    expect(e.cpu).toBeCloseTo(3, 5);
    expect(e.gpu).toBeCloseTo(2 * 4 + 0.5 * 2 + 2 * 2, 5); // 8 + 1 + 4 = 13 ms
    expect(e.ms).toBeCloseTo(13 * 1.1, 5);
  });
  it('the tier pixel ratio is capped by the device ratio and scale reduces fill and post only', () => {
    const m = { pixelRatio: 2, layers: 4, calls: 100, mtris: 0.1, post: 0 };
    const a = estimateFrameMs(units, m, { w: 1000, h: 1000, dpr: 1 });
    const b = estimateFrameMs(units, m, { w: 1000, h: 1000, dpr: 2 });
    expect(b.gpu).toBeGreaterThan(a.gpu * 3);
    const half = estimateFrameMs(units, m, { w: 1000, h: 1000, dpr: 2 }, 0.5);
    expect(half.gpu).toBeCloseTo(4 * 1 * 4 + 0.2, 5); // 4 Mpix x 0.25 = 1 Mpix of fill + the unchanged triangles
    expect(half.cpu).toBe(b.cpu);
  });
});

describe('recommendTier', () => {
  const fast = { fillNsPerPx: 0.6, callUs: 4, mtriMs: 0.4, postNsPerPx: 0.4 }; // a strong discrete GPU
  const mid = { fillNsPerPx: 3.2, callUs: 9, mtriMs: 1.6, postNsPerPx: 2 }; // an integrated GPU
  const slow = { fillNsPerPx: 14, callUs: 25, mtriMs: 6, postNsPerPx: 9 };
  it('a fast machine gets high at full resolution', () => {
    const r = recommendTier({ units: fast, viewport: VIEW });
    expect(r).toMatchObject({ tier: 'high', scale: 1 });
  });
  it('a mid machine gets medium at >= 0.9 rather than high at a low scale', () => {
    const r = recommendTier({ units: mid, viewport: VIEW });
    expect(['medium', 'low']).toContain(r.tier);
    expect(r.scale).toBeGreaterThanOrEqual(0.9);
  });
  it('a slow machine falls to the lowest tiers', () => {
    const r = recommendTier({ units: slow, viewport: VIEW });
    expect(['lite', 'low']).toContain(r.tier);
  });
  it('the GPU-class cap bounds the answer', () => {
    expect(recommendTier({ units: fast, viewport: VIEW, capTier: 'medium' }).tier).toBe('medium');
    expect(recommendTier({ units: fast, viewport: VIEW, capTier: 'lite' }).tier).toBe('lite');
  });
  it('a tighter budget (120 Hz) lowers the tier', () => {
    const a = recommendTier({ units: mid, viewport: VIEW, budgetMs: 1000 / 60 });
    const b = recommendTier({ units: mid, viewport: VIEW, budgetMs: 1000 / 144 });
    expect(['lite', 'low', 'medium', 'high'].indexOf(b.tier)).toBeLessThanOrEqual(['lite', 'low', 'medium', 'high'].indexOf(a.tier));
  });
  it('a bigger viewport lowers the answer (more pixels)', () => {
    const small = recommendTier({ units: mid, viewport: { w: 844, h: 390, dpr: 2 } });
    const big = recommendTier({ units: mid, viewport: { w: 2560, h: 1440, dpr: 1.5 } });
    const order = ['lite', 'low', 'medium', 'high'];
    expect(order.indexOf(big.tier) * 10 + big.scale).toBeLessThanOrEqual(order.indexOf(small.tier) * 10 + small.scale);
  });
  it('when nothing fits it returns the lowest tier at its floor and says why', () => {
    const r = recommendTier({ units: { fillNsPerPx: 500, callUs: 900, mtriMs: 200, postNsPerPx: 300 }, viewport: VIEW });
    expect(r.tier).toBe('lite');
    expect(r.scale).toBe(DEFAULT_TIER_MODELS.lite.scaleMin);
    expect(r.reasons.some((x) => /does not fit/.test(x))).toBe(true);
  });
  it('accepts the game\'s own tier table (array form) with custom ids', () => {
    const tiers = [{ id: 'cheap', pixelRatio: 1, layers: 1, calls: 100, mtris: 0.05, post: 0, scaleMin: 0.6 }, { id: 'fancy', pixelRatio: 1.5, layers: 5, calls: 800, mtris: 0.5, post: 6 }];
    expect(recommendTier({ units: fast, viewport: VIEW, tiers }).tier).toBe('fancy');
    expect(recommendTier({ units: slow, viewport: VIEW, tiers }).tier).toBe('cheap');
  });
  it('reports per-tier estimates at scale 1', () => {
    const r = recommendTier({ units: mid, viewport: VIEW });
    expect(Object.keys(r.estimates).sort()).toEqual(['high', 'lite', 'low', 'medium']);
    expect(r.estimates.high.ms).toBeGreaterThan(r.estimates.low.ms);
  });
});

describe('chooseInitialTier', () => {
  const radeon = gpuOf(RADEON);
  const rtx = gpuOf(RTX);
  const rec = (tier, scale = 1) => ({ recommended: { tier, scale, reasons: [`${tier} fits`] } });
  it('an explicit player choice wins and locks the tier', () => {
    const r = chooseInitialTier({ gpu: radeon, pref: 'high', calibration: rec('low'), memory: { tier: 'medium', scale: 0.8 } });
    expect(r).toMatchObject({ tier: 'high', source: 'pref', lock: true, scale: 1 });
  });
  it('then the remembered stable result', () => {
    const r = chooseInitialTier({ gpu: radeon, calibration: rec('low'), memory: { tier: 'medium', scale: 0.8 } });
    expect(r).toMatchObject({ tier: 'medium', scale: 0.8, source: 'memory', lock: false });
  });
  it('then the calibration, never above the GPU class cap', () => {
    expect(chooseInitialTier({ gpu: rtx, calibration: rec('high') })).toMatchObject({ tier: 'high', source: 'calibration' });
    const capped = chooseInitialTier({ gpu: radeon, calibration: rec('high', 1) });
    expect(capped.tier).toBe('medium'); // integrated: never high
    expect(capped.scale).toBe(1);
    expect(capped.maxTier).toBe('medium');
    expect(capped.reasons.join(' ')).toMatch(/capped/);
  });
  it('an integrated GPU must not start on high in any path without memory or a pref', () => {
    for (const c of [null, rec('high'), rec('medium'), rec('low')]) expect(chooseInitialTier({ gpu: radeon, calibration: c }).tier).not.toBe('high');
  });
  it('without calibration: the class cap, integrated / unknown at most medium', () => {
    expect(chooseInitialTier({ gpu: radeon })).toMatchObject({ tier: 'medium', source: 'class' });
    expect(chooseInitialTier({ gpu: rtx })).toMatchObject({ tier: 'high', source: 'class' });
    expect(chooseInitialTier({ gpu: null }).tier).toBe('medium');
    expect(chooseInitialTier({ gpu: gpuOf('Mali-G52 MC2') }).tier).toBe('low');
  });
  it('a remembered tier above the cap raises the governor ceiling to it', () => {
    expect(chooseInitialTier({ gpu: radeon, memory: { tier: 'high', scale: 1 } }).maxTier).toBe('high');
  });
  it('ignores tiers the game does not have', () => {
    expect(chooseInitialTier({ gpu: rtx, pref: 'ultra', memory: { tier: 'nope' }, tiers: ['low', 'medium'] }).tier).toBe('medium');
  });
});

describe('shouldCalibrate', () => {
  it('skips for a player choice, a memory hit, software and no-WebGL2; runs otherwise', () => {
    expect(shouldCalibrate({ pref: 'low' }).run).toBe(false);
    expect(shouldCalibrate({ memory: { tier: 'low', scale: 1 } }).run).toBe(false);
    expect(shouldCalibrate({ gpu: gpuOf('llvmpipe (LLVM 12.0.0, 256 bits)') }).run).toBe(false);
    expect(shouldCalibrate({ gpu: { caps: { webgl: 1 } } }).run).toBe(false);
    expect(shouldCalibrate({ gpu: gpuOf(RADEON), pref: 'auto' }).run).toBe(true);
    expect(shouldCalibrate({}).run).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// the runner, against a fake workload on a fake clock
function fakeWorld({ fillNs = 3, pixels = 2e6, callUs = 9, mtriMs = 1.6, postNs = 2, overhead = 0.5, compileFrames = 2, noise = 0 } = {}) {
  const clock = { t: 0 };
  const log = [];
  let prep = 0;
  let framesSincePrep = 0;
  const mp = pixels / 1e6;
  const slope = { fill: fillNs, calls: callUs / 1000, tris: mtriMs, post: postNs };
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const load = {
    pixels,
    halfFloat: true,
    tests: [
      { id: 'fill', minW: mp / 16, maxW: mp * 14 },
      { id: 'calls', minW: 40, maxW: 800 },
      { id: 'tris', minW: 0.1, maxW: 2.4 },
      { id: 'post', minW: mp / 8, maxW: mp * 10 },
    ],
    compiled: false,
    prepare: () => { prep++; return prep >= 4; },
    wake: () => { clock.t += 3; log.push('wake'); },
    run: (id, W, now) => {
      const ms = overhead + slope[id] * W * (1 + (noise ? (rnd() * 2 - 1) * noise : 0));
      clock.t += ms;
      log.push(`${id}:${W.toFixed(3)}:${ms.toFixed(2)}`);
      return ms;
    },
    dispose: vi.fn(),
    _tick() { framesSincePrep++; if (prep >= 4 && framesSincePrep >= compileFrames) this.compiled = true; },
  };
  return { clock, load, log, now: () => clock.t };
}
/** Drive the calibrator at `hz` until it finishes; returns { result, frames, longestFrameWork }. */
function drive(cal, w, hz = 60, maxFrames = 200) {
  let ts = 100;
  let n = 0;
  let longest = 0;
  for (; n < maxFrames; n++) {
    w.clock.t = ts;
    w.load._tick();
    const before = w.clock.t;
    const done = cal.frame(ts);
    longest = Math.max(longest, w.clock.t - before);
    if (done) break;
    ts += 1000 / hz;
  }
  return { result: cal.result, frames: n + 1, longest };
}
const mkCal = (w, o = {}) => createCalibration({ load: w.load, now: w.now, viewport: VIEW, ...o });

describe('createCalibration (fake workload)', () => {
  it('finishes within the time budget, spread over several frames, and recovers the machine\'s unit costs', () => {
    const w = fakeWorld({ fillNs: 3, callUs: 9, mtriMs: 1.6, postNs: 2 });
    const { result, frames } = drive(mkCal(w), w);
    expect(result.ok).toBe(true);
    expect(result.partial).toBe(false);
    expect(result.ranMs).toBeLessThanOrEqual(300);
    expect(frames).toBeGreaterThanOrEqual(6); // never a single big stall
    expect(result.units.fillNsPerPx).toBeCloseTo(3, 0);
    expect(result.units.callUs).toBeCloseTo(9, 0);
    expect(result.units.mtriMs).toBeCloseTo(1.6, 1);
    expect(result.units.postNsPerPx).toBeCloseTo(2, 0);
    expect(result.refreshHz).toBe(60);
    expect(w.load.dispose).toHaveBeenCalled();
  });
  it('never does more than ~one slice of work in a frame (no hitch): worst frame under 14 ms', () => {
    const w = fakeWorld({ fillNs: 6, callUs: 12, mtriMs: 3, postNs: 4 });
    const { longest, result } = drive(mkCal(w), w);
    expect(longest).toBeLessThan(14);
    expect(result.maxFrameWorkMs).toBeLessThan(14);
  });
  it('a stronger machine scores higher and is recommended a higher tier than a weaker one', () => {
    const strong = fakeWorld({ fillNs: 0.6, callUs: 4, mtriMs: 0.4, postNs: 0.4 });
    const weak = fakeWorld({ fillNs: 9, callUs: 18, mtriMs: 4, postNs: 6 });
    const a = drive(mkCal(strong), strong).result;
    const b = drive(mkCal(weak), weak).result;
    expect(a.score).toBeGreaterThan(b.score * 3);
    const order = ['lite', 'low', 'medium', 'high'];
    expect(order.indexOf(a.recommended.tier)).toBeGreaterThan(order.indexOf(b.recommended.tier));
  });
  it('is robust to measurement noise (10 %)', () => {
    const w = fakeWorld({ fillNs: 3, noise: 0.1 });
    const { result } = drive(mkCal(w), w);
    expect(result.units.fillNsPerPx).toBeGreaterThan(2);
    expect(result.units.fillNsPerPx).toBeLessThan(4.5);
  });
  it('the GPU class cap bounds the recommendation (integrated never high even on a fast measurement)', () => {
    const w = fakeWorld({ fillNs: 0.5, callUs: 3, mtriMs: 0.3, postNs: 0.3 });
    const { result } = drive(mkCal(w, { gpu: gpuOf(RADEON) }), w);
    expect(result.recommended.tier).not.toBe('high');
  });
  it('detects the refresh rate from the frame cadence: 120 Hz and 60 Hz', () => {
    const w1 = fakeWorld();
    expect(drive(mkCal(w1), w1, 120).result.refreshHz).toBe(120);
    const w2 = fakeWorld();
    expect(drive(mkCal(w2), w2, 60).result.refreshHz).toBe(60);
  });
  it('a machine too slow for the smallest slice (software rendering) aborts at once with the lowest tier and no stall', () => {
    const w = fakeWorld({ fillNs: 600, callUs: 500, mtriMs: 100, postNs: 400, overhead: 2 }); // 2 Mpix x 600 ns x (1/16 layer) = 75 ms for the first slice
    const { result, longest } = drive(mkCal(w), w);
    expect(result.partial).toBe('aborted');
    expect(result.recommended.tier).toBe('lite');
    expect(longest).toBeLessThan(100); // one slice of 75 ms is the worst case; it never repeats
    expect(result.trace.length).toBe(1);
  });
  it('waits for shader compilation but never longer than compileWaitMs', () => {
    const w = fakeWorld({ compileFrames: 1000 }); // never "compiles"
    const { result } = drive(mkCal(w, { compileWaitMs: 60 }), w);
    expect(result.ok).toBe(true);
    expect(result.compileWaited).toBe(true);
    expect(result.ranMs).toBeLessThanOrEqual(320);
  });
  it('maxMs bounds the run: an unfinished benchmark returns a partial result', () => {
    const w = fakeWorld({ fillNs: 2.5 });
    const { result } = drive(mkCal(w, { maxMs: 90 }), w);
    expect(result.partial).toBe('timeout');
    expect(result.recommended).toBeTruthy();
    expect(result.ranMs).toBeLessThan(150);
  });
  it('cancel() ends the run and resolves with a cancelled marker (no recommendation)', async () => {
    const w = fakeWorld();
    let cb = null;
    const cal = createCalibration({ load: w.load, now: w.now, viewport: VIEW, raf: (fn) => { cb = fn; return 1; }, caf: () => { cb = null; } });
    const p = cal.run();
    cb(100);
    cal.cancel();
    const r = await p;
    expect(r.cancelled).toBe(true);
    expect(r.recommended).toBeNull();
    expect(cb).toBeNull();
  });
  it('a workload that throws resolves { ok: false } instead of rejecting', async () => {
    const w = fakeWorld();
    w.load.prepare = () => { throw new Error('GL_OUT_OF_MEMORY'); };
    let cb = null;
    const cal = createCalibration({ load: w.load, now: w.now, viewport: VIEW, raf: (fn) => { cb = fn; return 1; } });
    const p = cal.run();
    cb(100);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/OUT_OF_MEMORY/);
  });
  it('run() drives itself from rAF and resolves', async () => {
    const w = fakeWorld();
    let q = [];
    let ts = 0;
    const cal = createCalibration({ load: w.load, now: w.now, viewport: VIEW, raf: (fn) => { q.push(fn); return q.length; } });
    const p = cal.run();
    while (q.length) {
      const fn = q.shift();
      ts += 16.67;
      w.clock.t = ts;
      w.load._tick();
      fn(ts);
    }
    const r = await p;
    expect(r.ok).toBe(true);
    expect(cal.progress).toBe(1);
  });
  it('the first slice of each test is the small probe, later ones grow, and the work is logged in the trace', () => {
    const w = fakeWorld();
    const { result } = drive(mkCal(w), w);
    const fill = result.trace.filter((t) => t.test === 'fill');
    expect(fill.length).toBeGreaterThanOrEqual(2);
    expect(fill[0].W).toBeLessThan(fill[1].W);
    expect(fill[1].W).toBeLessThanOrEqual(fill[2]?.W ?? Infinity);
    expect(w.log.filter((l) => l === 'wake').length).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// the three.js workload against a stub renderer (no WebGL in node: everything but the GPU calls is real)
function stubRenderer() {
  const r = {
    autoClear: true,
    render: vi.fn(),
    setRenderTarget: vi.fn(),
    getRenderTarget: () => null,
    readRenderTargetPixels: vi.fn(),
    compileAsync: vi.fn(() => Promise.resolve()),
    extensions: { has: (n) => n === 'EXT_color_buffer_float' },
  };
  return r;
}

describe('createThreeLoad', () => {
  it('builds in four prepare steps, compiles every scene, and caps the benchmark size', async () => {
    const r = stubRenderer();
    const load = createThreeLoad(r, { width: 4000, height: 2000 });
    expect(load.pixels).toBeLessThanOrEqual(2.7e6);
    expect(load.pixels).toBeGreaterThan(2e6);
    expect(load.halfFloat).toBe(true);
    let n = 0;
    while (!load.prepare()) n++;
    expect(n).toBe(3);
    expect(r.compileAsync).toHaveBeenCalledTimes(4);
    await Promise.resolve();
    await Promise.resolve();
    expect(load.compiled).toBe(true);
    load.dispose();
  });
  it('keeps small canvases at their real size', () => {
    const load = createThreeLoad(stubRenderer(), { width: 844, height: 390 });
    expect([load.width, load.height]).toEqual([844, 390]);
  });
  it('fill: renders ceil(W / canvas) layers into the sub-rect that makes the work exact, then waits with a 1 px readback, and restores renderer state', () => {
    const r = stubRenderer();
    const load = createThreeLoad(r, { width: 1000, height: 1000 }); // 1 Mpix
    while (!load.prepare());
    let t = 0;
    const now = () => (t += 1);
    load.run('fill', 2.5, now); // 2.5 Mpix-layers = 3 layers at 5/6 of the area
    expect(r.render).toHaveBeenCalledTimes(3);
    expect(r.readRenderTargetPixels).toHaveBeenCalledTimes(1);
    expect(r.readRenderTargetPixels.mock.calls[0].slice(1)).toEqual([0, 0, 1, 1, expect.any(Uint8Array)]);
    expect(r.autoClear).toBe(true);
    expect(r.setRenderTarget).toHaveBeenLastCalledWith(null);
    r.render.mockClear();
    load.run('fill', 0.0625, now); // the 1/16 probe: one layer
    expect(r.render).toHaveBeenCalledTimes(1);
    const rt = r.setRenderTarget.mock.calls.find((c) => c[0])?.[0];
    expect(rt.scissorTest).toBe(true);
    expect(rt.viewport.width * rt.viewport.height).toBeCloseTo(1e6 / 16, -3);
    load.dispose();
  });
  it('calls: N visible meshes, one scene render', () => {
    const r = stubRenderer();
    const load = createThreeLoad(r, { width: 640, height: 360 });
    while (!load.prepare());
    load.run('calls', 123, () => 0);
    expect(r.render).toHaveBeenCalledTimes(1);
    const scene = r.render.mock.calls[0][0];
    expect(scene.children.filter((m) => m.visible).length).toBe(123);
    expect(scene.children.length).toBe(800);
    load.run('calls', 5000, () => 0);
    expect(r.render.mock.calls[1][0].children.filter((m) => m.visible).length).toBe(800);
    load.dispose();
  });
  it('tris: draws a 100k-triangle mesh ceil(W) times, one scene render', () => {
    const r = stubRenderer();
    const load = createThreeLoad(r, { width: 640, height: 360 });
    while (!load.prepare());
    load.run('tris', 0.5, () => 0); // 0.5 Mtri = 5 draws of 100,352 triangles
    const scene = r.render.mock.calls[0][0];
    expect(scene.children.filter((m) => m.visible).length).toBe(5);
    expect(scene.children[0].geometry.index.count / 3).toBe(100352);
    load.dispose();
  });
  it('post: renders the full-screen composite per pass', () => {
    const r = stubRenderer();
    const load = createThreeLoad(r, { width: 1000, height: 1000 });
    while (!load.prepare());
    load.run('post', 3, () => 0);
    expect(r.render).toHaveBeenCalledTimes(3);
    load.dispose();
  });
  it('wake submits throw-away fills without reading back', () => {
    const r = stubRenderer();
    const load = createThreeLoad(r, { width: 640, height: 360 });
    while (!load.prepare());
    load.wake(2);
    expect(r.render).toHaveBeenCalledTimes(3);
    expect(r.readRenderTargetPixels).not.toHaveBeenCalled();
  });
  it('without float targets the half-float stand-in is 8 bit and reported', () => {
    const r = stubRenderer();
    r.extensions.has = () => false;
    expect(createThreeLoad(r, { width: 640, height: 360 }).halfFloat).toBe(false);
  });
  it('state is restored even when a render throws', () => {
    const r = stubRenderer();
    r.render = vi.fn(() => { throw new Error('boom'); });
    const load = createThreeLoad(r, { width: 640, height: 360 });
    while (!load.prepare());
    expect(() => load.run('fill', 1, () => 0)).toThrow('boom');
    expect(r.autoClear).toBe(true);
    expect(r.setRenderTarget).toHaveBeenLastCalledWith(null);
  });
  it('dispose frees every geometry, material and render target it made', () => {
    const r = stubRenderer();
    const load = createThreeLoad(r, { width: 640, height: 360 });
    while (!load.prepare());
    expect(() => load.dispose()).not.toThrow();
    expect(() => load.dispose()).not.toThrow();
  });
});
