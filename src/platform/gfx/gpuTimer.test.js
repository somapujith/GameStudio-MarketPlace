import { describe, expect, it } from 'vitest';
import { createGpuTimer } from './gpuTimer.js';

/** A WebGL2-shaped fake: queries resolve `latency` polls after they end. */
function fakeGl({ latency = 2, ns = 6_000_000, disjointAt = -1, supported = true } = {}) {
  let id = 0;
  let polls = 0;
  const queries = new Map();
  const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    QUERY_RESULT_AVAILABLE: 3,
    QUERY_RESULT: 4,
    getExtension: (n) => (supported && n === 'EXT_disjoint_timer_query_webgl2' ? ext : null),
    createQuery: () => { const q = { id: ++id, ended: -1 }; queries.set(q.id, q); return q; },
    deleteQuery: (q) => queries.delete(q.id),
    beginQuery: () => {},
    endQuery: () => {},
    getParameter: (p) => (p === ext.GPU_DISJOINT_EXT ? polls === disjointAt : null),
    getQueryParameter: (q, p) => {
      if (p === 3) {
        if (q.ended < 0) q.ended = polls;
        return polls - q.ended >= latency;
      }
      return ns;
    },
  };
  return { gl, tick: () => { polls++; }, queries };
}

describe('createGpuTimer', () => {
  it('reports unsupported without the extension, and every call is a harmless no-op', () => {
    const t = createGpuTimer({ getExtension: () => null });
    expect(t.supported).toBe(false);
    expect(() => { t.begin(); t.end(); t.poll(); t.dispose(); }).not.toThrow();
    expect(t.lastMs).toBe(-1);
    expect(createGpuTimer(null).supported).toBe(false);
  });
  it('measures a frame once its result lands a few frames later', () => {
    const f = fakeGl({ latency: 2, ns: 6_000_000 });
    const t = createGpuTimer(f.gl);
    expect(t.supported).toBe(true);
    for (let i = 0; i < 6; i++) {
      t.begin();
      t.end();
      f.tick();
    }
    expect(t.lastMs).toBeCloseTo(6, 5);
    expect(t.avgMs).toBeCloseTo(6, 5);
    expect(t.samples).toBeGreaterThan(0);
  });
  it('drops disjoint samples and absurd values', () => {
    const f = fakeGl({ latency: 1, ns: 6_000_000, disjointAt: 3 });
    const t = createGpuTimer(f.gl);
    for (let i = 0; i < 8; i++) { t.begin(); t.end(); f.tick(); }
    expect(t.dropped).toBeGreaterThan(0);
    const huge = fakeGl({ latency: 1, ns: 9e9 });
    const t2 = createGpuTimer(huge.gl);
    for (let i = 0; i < 5; i++) { t2.begin(); t2.end(); huge.tick(); }
    expect(t2.lastMs).toBe(-1);
  });
  it('never has more than `inflight` queries outstanding (a slow GPU skips samples instead of stalling)', () => {
    const f = fakeGl({ latency: 1000 });
    const t = createGpuTimer(f.gl, { inflight: 3 });
    for (let i = 0; i < 20; i++) { t.begin(); t.end(); f.tick(); }
    expect(f.queries.size).toBeLessThanOrEqual(4);
  });
  it('a throwing driver turns the timer off instead of breaking the frame', () => {
    const f = fakeGl();
    f.gl.beginQuery = () => { throw new Error('INVALID_OPERATION'); };
    const t = createGpuTimer(f.gl);
    expect(() => { t.begin(); t.end(); }).not.toThrow();
    expect(t.supported).toBe(false);
  });
  it('a tagged query delivers its result through onResult(tag, ms) (zero is valid, a disjoint sample is -1) and does not feed lastMs', () => {
    const f = fakeGl({ latency: 1, ns: 4_000_000 });
    const t = createGpuTimer(f.gl);
    const got = [];
    t.onResult = (tag, ms) => got.push([tag, ms]);
    expect(t.begin()).toBe(true);
    t.end('a');
    f.tick();
    t.begin();
    t.end('b');
    for (let i = 0; i < 4; i++) { f.tick(); t.poll(); }
    expect(got.map((g) => g[0])).toEqual(['a', 'b']);
    expect(got[0][1]).toBeCloseTo(4, 5);
    expect(t.lastMs).toBe(-1);
    // a sample taken across a disjoint event is reported as -1
    const f2 = fakeGl({ latency: 1, ns: 4_000_000, disjointAt: 1 });
    const t2 = createGpuTimer(f2.gl);
    const got2 = [];
    t2.onResult = (tag, ms) => got2.push([tag, ms]);
    t2.begin();
    t2.end('d');
    t2.poll(); // the fake starts the query's clock at its first poll
    f2.tick();
    t2.poll();
    expect(got2).toEqual([['d', -1]]);
    expect(t2.dropped).toBe(1);
  });
  it('begin() reports false when the GPU is too far behind to take another query', () => {
    const f = fakeGl({ latency: 1000 });
    const t = createGpuTimer(f.gl, { inflight: 2 });
    expect(t.begin()).toBe(true);
    t.end();
    expect(t.begin()).toBe(true);
    t.end();
    expect(t.begin()).toBe(false);
  });
  it('dispose frees the outstanding queries', () => {
    const f = fakeGl({ latency: 1000 });
    const t = createGpuTimer(f.gl);
    for (let i = 0; i < 3; i++) { t.begin(); t.end(); f.tick(); }
    t.dispose();
    expect(f.queries.size).toBe(0);
  });
});
