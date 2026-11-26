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
  it('dispose frees the outstanding queries', () => {
    const f = fakeGl({ latency: 1000 });
    const t = createGpuTimer(f.gl);
    for (let i = 0; i < 3; i++) { t.begin(); t.end(); f.tick(); }
    t.dispose();
    expect(f.queries.size).toBe(0);
  });
});
