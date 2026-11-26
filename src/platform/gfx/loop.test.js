import { describe, expect, it, vi } from 'vitest';
import { createFrameRing, createLoop } from './loop.js';

// ---- fakes
function makeEnv() {
  let t = 0;
  let id = 0;
  const q = new Map();
  const docL = {};
  const winL = {};
  const timers = new Map();
  const env = {
    now: () => t,
    advance: (ms) => { t += ms; },
    raf: (fn) => { q.set(++id, fn); return id; },
    caf: (i) => { q.delete(i); },
    pending: () => q.size,
    // run the next queued frame at timestamp ts
    frame(ts) {
      const [[k, fn]] = [...q.entries()];
      q.delete(k);
      t = ts;
      fn(ts);
    },
    doc: { hidden: false, addEventListener: (n, f) => { docL[n] = f; }, removeEventListener: (n) => { delete docL[n]; } },
    win: { addEventListener: (n, f) => { winL[n] = f; }, removeEventListener: (n) => { delete winL[n]; } },
    fire: (target, name) => (target === 'doc' ? docL : winL)[name]?.(),
    listeners: () => ({ doc: Object.keys(docL), win: Object.keys(winL) }),
    setTimeout: (fn, ms) => { const k = ++id; timers.set(k, { fn, at: t + ms }); return k; },
    clearTimeout: (k) => { timers.delete(k); },
    runTimers(upTo) { t = upTo; for (const [k, v] of [...timers]) if (v.at <= upTo) { timers.delete(k); v.fn(); } },
  };
  return env;
}
const mkLoop = (env, o = {}) => createLoop({ raf: env.raf, caf: env.caf, now: env.now, doc: env.doc, win: env.win, setTimeout: env.setTimeout, clearTimeout: env.clearTimeout, ...o });
/** Drives n frames at a refresh rate, starting at ts0. Returns the last ts. */
const run = (env, n, hz = 60, ts0 = 1000) => {
  let ts = ts0;
  for (let i = 0; i < n; i++) {
    if (!env.pending()) break;
    env.frame(ts);
    ts += 1000 / hz;
  }
  return ts;
};

describe('createFrameRing', () => {
  it('pushes without growing and reports mean / max / percentile / fps / over', () => {
    const r = createFrameRing(8);
    for (let i = 1; i <= 12; i++) r.push(i, i * 2, 100);
    expect(r.count).toBe(8);
    expect(r.last).toBe(12);
    expect(r.mean(4)).toBe((12 + 11 + 10 + 9) / 4);
    expect(r.mean(8, 'cpu')).toBe(((12 + 11 + 10 + 9 + 8 + 7 + 6 + 5) * 2) / 8);
    expect(r.max()).toBe(12);
    expect(r.percentile(0.5)).toBe(9);
    expect(r.percentile(0.99)).toBe(12);
    expect(r.fps(4)).toBeCloseTo(1000 / 10.5, 5);
    expect(r.over(9)).toBe(3);
    r.clear();
    expect(r.count).toBe(0);
    expect(r.percentile(0.5)).toBe(0);
  });
  it('skips unknown (-1) values in means', () => {
    const r = createFrameRing(4);
    r.push(16, -1, -1);
    r.push(16, 4, 100);
    expect(r.mean(4, 'cpu')).toBe(4);
    expect(r.mean(4, 'calls')).toBe(100);
  });
});

describe('createLoop: stepping', () => {
  it('variable step: update and render get the frame delta in seconds; the first frame has dt 0', () => {
    const env = makeEnv();
    const updates = [];
    const renders = [];
    const loop = mkLoop(env, { update: (dt) => updates.push(dt), render: (a, dt) => renders.push([a, dt]) });
    loop.start();
    run(env, 3, 60);
    expect(updates[0]).toBe(0);
    expect(updates[1]).toBeCloseTo(1 / 60, 5);
    expect(renders[2]).toEqual([1, expect.closeTo(1 / 60, 5)]);
    expect(loop.frames).toBe(3);
  });
  it('fixed step: a 50 ms frame runs 3 steps of 1/60 and interpolates with the remainder', () => {
    const env = makeEnv();
    const steps = [];
    let alpha = -1;
    const loop = mkLoop(env, { fixedStep: 1 / 60, update: (dt) => steps.push(dt), render: (a) => { alpha = a; } });
    loop.start();
    env.frame(1000);
    expect(steps).toHaveLength(0);
    env.frame(1050);
    expect(steps).toHaveLength(3);
    expect(steps.every((s) => s === 1 / 60)).toBe(true);
    expect(alpha).toBeCloseTo(0.05 * 60 - 3, 4);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
  });
  it('fixed step: a long frame is clamped (maxDelta) and the backlog dropped (no spiral of death)', () => {
    const env = makeEnv();
    let n = 0;
    const loop = mkLoop(env, { fixedStep: 1 / 60, maxDelta: 0.5, maxSubSteps: 5, update: () => n++ });
    loop.start();
    env.frame(1000);
    env.frame(2000); // a 1 s frame
    expect(n).toBeLessThanOrEqual(5);
    expect(loop.state.droppedSteps).toBe(1);
    n = 0;
    env.frame(2016.7);
    expect(n).toBeLessThanOrEqual(1);
  });
  it('the sim advances exactly real time over many frames at an off-rate refresh (50 Hz)', () => {
    const env = makeEnv();
    let simTime = 0;
    const loop = mkLoop(env, { fixedStep: 1 / 60, update: (dt) => { simTime += dt; } });
    loop.start();
    run(env, 301, 50);
    expect(simTime).toBeGreaterThan(5.9);
    expect(simTime).toBeLessThan(6.02);
  });
});

describe('createLoop: frame cap', () => {
  const countRendered = (hz, cap, seconds = 10) => {
    const env = makeEnv();
    let n = 0;
    const loop = mkLoop(env, { maxFps: cap, render: () => n++ });
    loop.start();
    run(env, Math.round(hz * seconds), hz);
    return n / seconds;
  };
  it('30 fps on a 60 Hz display renders every other frame', () => expect(countRendered(60, 30)).toBeCloseTo(30, 0));
  it('60 fps on a 144 Hz display averages ~60 (not 48)', () => {
    const fps = countRendered(144, 60);
    expect(fps).toBeGreaterThan(55);
    expect(fps).toBeLessThan(62);
  });
  it('30 fps on a 120 Hz display renders every 4th frame', () => expect(countRendered(120, 30)).toBeCloseTo(30, 0));
  it('uncapped renders every frame', () => expect(countRendered(60, 0)).toBeCloseTo(60, 0));
  it('the dt handed to the game is the time since the last RENDERED frame', () => {
    const env = makeEnv();
    const dts = [];
    const loop = mkLoop(env, { maxFps: 30, render: (a, dt) => dts.push(dt) });
    loop.start();
    run(env, 20, 60);
    for (const d of dts.slice(1)) expect(d).toBeCloseTo(1 / 30, 2);
    expect(loop.skipped).toBeGreaterThan(5);
  });
  it('setMaxFps changes the cap at run time (battery low -> 30)', () => {
    const env = makeEnv();
    let n = 0;
    const loop = mkLoop(env, { render: () => n++ });
    loop.start();
    const ts = run(env, 60, 60);
    expect(n).toBe(60);
    loop.setMaxFps(30);
    n = 0;
    run(env, 60, 60, ts);
    expect(n).toBeGreaterThanOrEqual(29);
    expect(n).toBeLessThanOrEqual(31);
    expect(loop.maxFps).toBe(30);
  });
});

describe('createLoop: visibility, pause and resume', () => {
  it('hiding the tab cancels the rAF; showing it resumes with dt 0 and tells the governor', () => {
    const env = makeEnv();
    const dts = [];
    const governor = { frame: vi.fn(), discontinuity: vi.fn() };
    const seen = [];
    const loop = mkLoop(env, { governor, render: (a, dt) => dts.push(dt), onVisibility: (h) => seen.push(h) });
    loop.start();
    const ts = run(env, 5, 60);
    env.doc.hidden = true;
    env.fire('doc', 'visibilitychange');
    expect(env.pending()).toBe(0);
    expect(seen).toEqual([true]);
    env.doc.hidden = false;
    env.fire('doc', 'visibilitychange');
    expect(env.pending()).toBe(1);
    expect(seen).toEqual([true, false]);
    env.frame(ts + 20000); // 20 s later
    expect(dts.at(-1)).toBe(0);
    expect(governor.discontinuity).toHaveBeenCalledWith(500);
    // the dt=0 frame is not fed to the governor
    const fed = governor.frame.mock.calls.length;
    env.frame(ts + 20016);
    expect(governor.frame.mock.calls.length).toBe(fed + 1);
    expect(governor.frame.mock.calls.at(-1)[0]).toBeCloseTo(16, 0);
  });
  it('starting while hidden waits for visibility', () => {
    const env = makeEnv();
    env.doc.hidden = true;
    const loop = mkLoop(env, { render: () => {} });
    loop.start();
    expect(env.pending()).toBe(0);
    env.doc.hidden = false;
    env.fire('doc', 'visibilitychange');
    expect(env.pending()).toBe(1);
    expect(loop.running).toBe(true);
  });
  it('pause() / resume() do not produce a catch-up frame', () => {
    const env = makeEnv();
    const dts = [];
    const loop = mkLoop(env, { render: (a, dt) => dts.push(dt) });
    loop.start();
    run(env, 3, 60);
    loop.pause();
    expect(env.pending()).toBe(0);
    loop.resume();
    env.frame(9000);
    expect(dts.at(-1)).toBe(0);
  });
  it('stop() cancels everything; dispose() removes the listeners', () => {
    const env = makeEnv();
    const loop = mkLoop(env, { render: () => {}, onResize: () => {} });
    loop.start();
    expect(env.listeners()).toEqual({ doc: ['visibilitychange'], win: ['resize'] });
    loop.dispose();
    expect(env.pending()).toBe(0);
    expect(env.listeners()).toEqual({ doc: [], win: [] });
    expect(loop.running).toBe(false);
  });
});

describe('createLoop: resize debounce', () => {
  it('a burst of resize events produces one onResize, after the quiet period, and a governor discontinuity', () => {
    const env = makeEnv();
    const onResize = vi.fn();
    const governor = { frame() {}, discontinuity: vi.fn() };
    mkLoop(env, { onResize, governor, resizeDebounceMs: 100 });
    for (let t = 0; t < 10; t++) {
      env.advance(20);
      env.fire('win', 'resize');
    }
    env.runTimers(env.now() + 50);
    expect(onResize).not.toHaveBeenCalled();
    env.runTimers(env.now() + 100);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(governor.discontinuity).toHaveBeenCalledWith(500);
  });
  it('a ResizeObserver can drive the same debounce', () => {
    const env = makeEnv();
    let cb = null;
    class FakeRO { constructor(fn) { cb = fn; } observe() {} disconnect() {} }
    const onResize = vi.fn();
    mkLoop(env, { onResize, ResizeObserver: FakeRO, observe: {} });
    cb();
    cb();
    env.runTimers(env.now() + 200);
    expect(onResize).toHaveBeenCalledTimes(1);
  });
});

describe('createLoop: renderer.info and the stats ring', () => {
  it('turns autoReset off, resets once per frame, and records draw calls, cpu time and dt in the ring', () => {
    const env = makeEnv();
    const info = { autoReset: true, render: { calls: 0 }, reset: vi.fn(() => { info.render.calls = 0; }) };
    const governor = { frame: vi.fn(), discontinuity: vi.fn() };
    const loop = mkLoop(env, { info, governor, render: () => { info.render.calls += 120; info.render.calls += 80; env.advance(3); } });
    expect(info.autoReset).toBe(false);
    loop.start();
    run(env, 4, 60);
    expect(info.reset).toHaveBeenCalledTimes(4);
    expect(loop.ring.count).toBe(3); // the first frame has dt 0 and is not recorded
    expect(loop.ring.mean(3, 'calls')).toBe(200);
    expect(loop.ring.mean(3, 'cpu')).toBeCloseTo(3, 5);
    expect(loop.ring.mean(3)).toBeCloseTo(16.67, 1);
    expect(governor.frame).toHaveBeenCalledTimes(3);
    const [dt, cpu, calls] = governor.frame.mock.calls[0];
    expect(dt).toBeCloseTo(16.67, 1);
    expect(cpu).toBeCloseTo(3, 5);
    expect(calls).toBe(200);
  });
  it('wraps every frame in the GPU timer (begin before the sim, end after the render) and passes its reading on', () => {
    const env = makeEnv();
    const governor = { frame: vi.fn(), discontinuity() {} };
    const order = [];
    const gpuTimer = { supported: true, lastMs: 7.5, begin: () => order.push('begin'), end: () => order.push('end') };
    const loop = mkLoop(env, { governor, gpuTimer, update: () => order.push('update'), render: () => order.push('render') });
    loop.start();
    run(env, 3, 60);
    expect(order.slice(0, 4)).toEqual(['begin', 'update', 'render', 'end']);
    expect(governor.frame.mock.calls[0][3]).toBe(7.5);
  });
  it('an unsupported GPU timer is ignored (-1 reaches the governor)', () => {
    const env = makeEnv();
    const governor = { frame: vi.fn(), discontinuity() {} };
    const begin = vi.fn();
    const loop = mkLoop(env, { governor, gpuTimer: { supported: false, lastMs: -1, begin, end: begin }, render: () => {} });
    loop.start();
    run(env, 3, 60);
    expect(begin).not.toHaveBeenCalled();
    expect(governor.frame.mock.calls[0][3]).toBe(-1);
  });
  it('the ring is a fixed typed-array buffer: 5000 frames neither grow it nor replace the state object', () => {
    const env = makeEnv();
    const loop = mkLoop(env, { fixedStep: 1 / 60, update: () => {}, render: () => {} });
    const { state, ring } = loop;
    const dtBuf = ring.dt;
    loop.start();
    run(env, 5000, 60);
    expect(ring.count).toBe(240);
    expect(ring.dt).toBe(dtBuf);
    expect(ring.dt.length).toBe(240);
    expect(loop.state).toBe(state);
  });
});
