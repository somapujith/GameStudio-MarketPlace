import { describe, expect, it } from 'vitest';
import { PHASE, createFramePerf } from './perf.js';

/** A fake clock: each call returns the next scripted time. */
const clock = (...times) => {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
};

describe('createFramePerf', () => {
  it('splits a frame into phases and keeps the average and the worst of each', () => {
    // three empty warm-up frames (begin, end: 2 clock reads each), then begin(0) lap sim(4) lap world(5) lap render(25) end(26):
    // sim 4, world 1, render 20, total 26
    const t = [];
    for (let i = 0; i < 3; i++) t.push(0, 0);
    t.push(0, 4, 5, 25, 26);
    const r = createFramePerf({ now: clock(...t), slowMs: 100 });
    for (let i = 0; i < 3; i++) { r.begin(); r.end(); }
    r.begin();
    r.lap(PHASE.sim);
    r.lap(PHASE.world);
    r.lap(PHASE.render);
    r.end();
    const rep = r.report();
    expect(rep.frames).toBe(4);
    expect(rep.phases.sim.max).toBe(4);
    expect(rep.phases.world.max).toBe(1);
    expect(rep.phases.render.max).toBe(20);
    expect(rep.frame.max).toBe(26);
    expect(rep.phases.render.avg).toBeGreaterThan(0);
    expect(rep.slowCount).toBe(0);
  });

  it('records a slow frame with the phase and the system that caused it, and the renderer counters', () => {
    let now = 0;
    const p = createFramePerf({ now: () => now, slowMs: 33 });
    const traffic = p.nameSystem('traffic');
    const fares = p.nameSystem('fares');
    expect(p.nameSystem('traffic')).toBe(traffic); // names are interned
    p.begin();
    p.sys(traffic, 2);
    p.sys(fares, 41);
    now = 45;
    p.lap(PHASE.sim);
    now = 46;
    p.lap(PHASE.render);
    p.end({ programs: 210, textures: 90, geometries: 380 });
    // the next frame compiled 12 programs and uploaded a texture
    p.begin();
    now = 46 + 120;
    p.lap(PHASE.render);
    p.end({ programs: 222, textures: 91, geometries: 380 });
    const rep = p.report();
    expect(rep.slowCount).toBe(2);
    expect(rep.slow[0].sys).toBe('fares 41');
    expect(rep.slow[0].phases.sim).toBe(45);
    expect(rep.slow[1].programs).toBe(12);
    expect(rep.slow[1].textures).toBe(1);
    expect(rep.slow[1].geometries).toBe(0);
    expect(rep.slow[1].phases.render).toBe(120);
  });

  it('keeps the ring of slow frames bounded and resets cleanly', () => {
    let now = 0;
    const p = createFramePerf({ now: () => now, slowMs: 10, ring: 3 });
    for (let i = 0; i < 8; i++) {
      p.begin();
      now += 50;
      p.lap(PHASE.sim);
      p.end();
    }
    expect(p.report().slow).toHaveLength(3);
    expect(p.report().slowCount).toBe(8);
    p.reset();
    const rep = p.report();
    expect(rep.frames).toBe(0);
    expect(rep.slow).toHaveLength(0);
    expect(rep.frame.max).toBe(0);
  });

  it('does not allocate system slots beyond its capacity', () => {
    const p = createFramePerf();
    let last = 0;
    for (let i = 0; i < 100; i++) last = p.nameSystem(`s${i}`);
    expect(last).toBeLessThan(40);
  });
});
