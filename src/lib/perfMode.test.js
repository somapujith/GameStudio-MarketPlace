import { describe, expect, it, vi } from 'vitest';
import { FAST_MS, SLOW_MS, getPerfLevel, judgeFrames, medianFrame, sampleFrames, setPerfLevel, startPerfMonitor } from './perfMode.js';

const frames = (ms, n = 40) => Array.from({ length: n }, () => ms);

describe('judgeFrames', () => {
  it('calls 60 fps fast and 15 fps slow', () => {
    expect(judgeFrames(frames(16.7))).toBe('high');
    expect(judgeFrames(frames(66))).toBe('low');
    expect(judgeFrames(frames(SLOW_MS + 1))).toBe('low');
    expect(judgeFrames(frames(FAST_MS))).toBe('high');
  });

  it('says nothing in between or with too few frames', () => {
    expect(judgeFrames(frames(25))).toBe(null);
    expect(judgeFrames(frames(100, 5))).toBe(null);
    expect(judgeFrames(null)).toBe(null);
  });

  it('uses the median: a few long stalls do not make a fast screen slow', () => {
    const d = [...frames(16.7, 40), 900, 1200, 300];
    expect(medianFrame(d)).toBeCloseTo(16.7, 1);
    expect(judgeFrames(d)).toBe('high');
  });

  it('leaves out stalls (hidden tab) entirely', () => {
    expect(judgeFrames(frames(5000, 40))).toBe(null);
  });
});

/** A manual requestAnimationFrame: step(ms) fires the pending callback at the clock + ms. */
function fakeRaf() {
  let cb = null;
  let t = 1000;
  return {
    raf: (fn) => { cb = fn; return 1; },
    caf: () => { cb = null; },
    step(ms) { t += ms; const f = cb; cb = null; if (f) f(t); },
    pending: () => !!cb,
  };
}

describe('sampleFrames', () => {
  it('collects frame times over the window, then reports them', () => {
    const r = fakeRaf();
    const done = vi.fn();
    sampleFrames(100, done, { raf: r.raf, caf: r.caf, hidden: () => false });
    for (let i = 0; i < 20 && r.pending(); i++) r.step(16);
    expect(done).toHaveBeenCalledTimes(1);
    const d = done.mock.calls[0][0];
    expect(d.length).toBeGreaterThan(4);
    expect(d.every((x) => x === 16)).toBe(true);
  });

  it('reports null when the tab goes hidden', () => {
    const r = fakeRaf();
    const done = vi.fn();
    let hidden = false;
    sampleFrames(1000, done, { raf: r.raf, caf: r.caf, hidden: () => hidden });
    r.step(16);
    hidden = true;
    r.step(16);
    expect(done).toHaveBeenCalledWith(null);
  });

  it('can be cancelled', () => {
    const r = fakeRaf();
    const done = vi.fn();
    const cancel = sampleFrames(1000, done, { raf: r.raf, caf: r.caf, hidden: () => false });
    r.step(16);
    cancel();
    r.step(16);
    expect(done).not.toHaveBeenCalled();
  });
});

describe('startPerfMonitor', () => {
  /** Runs the whole monitor against a screen that renders every frame in `ms`. */
  function run(ms, schedule = [10, 20, 30]) {
    const r = fakeRaf();
    const timers = [];
    const verdicts = [];
    const stop = startPerfMonitor((v) => verdicts.push(v), {
      raf: r.raf,
      caf: r.caf,
      hidden: () => false,
      schedule,
      windowMs: 2500,
      setTimer: (fn) => { timers.push(fn); return timers.length; },
      clearTimer: () => {},
    });
    let guard = 0;
    while (guard++ < 2000) {
      if (timers.length) { timers.shift()(); continue; }
      if (r.pending()) { r.step(ms); continue; }
      break;
    }
    return { verdicts, stop };
  }

  it('a slow screen is judged low once, and the monitor stops', () => {
    expect(run(66).verdicts).toEqual(['low']);
  });

  it('a fast screen is confirmed on every window', () => {
    expect(run(16.7).verdicts).toEqual(['high', 'high', 'high']);
  });

  it('keeps the level on the page: set, mirrored on <html>, cleared', () => {
    setPerfLevel('low');
    expect(getPerfLevel()).toBe('low');
    if (typeof document !== 'undefined') expect(document.documentElement.dataset.perf).toBe('low');
    setPerfLevel('');
    expect(getPerfLevel()).toBe('');
    if (typeof document !== 'undefined') expect(document.documentElement.dataset.perf).toBeUndefined();
  });
});
