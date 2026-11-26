// The render loop helper both games can share. Everything a frame loop needs and games keep re-writing badly:
//   * requestAnimationFrame with a fixed-step accumulator (deterministic sim, interpolated render) or a plain variable step;
//   * a frame-rate cap that survives refresh rates that are not multiples of the cap (144 Hz -> 60 fps renders every 2.4th frame, not every 3rd);
//   * pause on tab hide, resume WITHOUT a giant dt (and tells the governor it was a discontinuity);
//   * resize debounce (a window drag fires dozens of events; the renderer should rebuild once);
//   * `renderer.info` handling: autoReset is turned off so the counters cover the WHOLE frame (post passes render several times), reset once per frame;
//   * a zero-allocation ring buffer of frame stats (dt, cpu ms, draw calls) that feeds the governor and a dev overlay.
//
//   const loop = createLoop({ update: (dt) => sim.step(dt), render: (alpha, dt) => view.render(alpha, dt), fixedStep: 1 / 60,
//                             info: renderer.info, governor, onResize: () => view.resize(innerWidth, innerHeight) });
//   loop.start();   ...   loop.setMaxFps(gov.fpsCap);   ...   loop.dispose();
//
// All environment access (raf, caf, clock, document, window, timers) is injectable, so the loop is unit-tested with a fake clock.

/**
 * A fixed-capacity ring of per-frame stats. `push` allocates nothing; the read helpers (percentile) sort a private scratch buffer, so call them from a
 * dev panel or once a second, not every frame.
 */
export function createFrameRing(capacity = 240) {
  const dt = new Float32Array(capacity);
  const cpu = new Float32Array(capacity);
  const calls = new Float32Array(capacity);
  const scratch = new Float32Array(capacity);
  let pos = 0;
  let count = 0;
  const idx = (back) => (pos - 1 - back + capacity * 2) % capacity;
  const ring = {
    capacity,
    dt,
    cpu,
    calls,
    get count() { return count; },
    /** dt / cpu in ms, calls = draw calls of that frame (-1 unknown). */
    push(dtMs, cpuMs = -1, nCalls = -1) {
      dt[pos] = dtMs;
      cpu[pos] = cpuMs;
      calls[pos] = nCalls;
      pos = (pos + 1) % capacity;
      if (count < capacity) count++;
    },
    clear() {
      pos = 0;
      count = 0;
    },
    /** The most recent frame time, ms (0 when empty). */
    get last() { return count ? dt[idx(0)] : 0; },
    /** Mean of the last n values of a series ('dt' | 'cpu' | 'calls'); unknown (-1) entries are skipped. */
    mean(n = capacity, series = 'dt') {
      const a = series === 'cpu' ? cpu : series === 'calls' ? calls : dt;
      const m = Math.min(n, count);
      let s = 0;
      let k = 0;
      for (let i = 0; i < m; i++) {
        const v = a[idx(i)];
        if (v >= 0) {
          s += v;
          k++;
        }
      }
      return k ? s / k : 0;
    },
    max(n = capacity, series = 'dt') {
      const a = series === 'cpu' ? cpu : series === 'calls' ? calls : dt;
      const m = Math.min(n, count);
      let best = 0;
      for (let i = 0; i < m; i++) best = Math.max(best, a[idx(i)]);
      return best;
    },
    /** p in 0..1 over the last n frame times (insertion sort into scratch). */
    percentile(p, n = capacity) {
      const m = Math.min(n, count);
      if (!m) return 0;
      for (let i = 0; i < m; i++) {
        const v = dt[idx(i)];
        let j = i - 1;
        while (j >= 0 && scratch[j] > v) {
          scratch[j + 1] = scratch[j];
          j--;
        }
        scratch[j + 1] = v;
      }
      return scratch[Math.min(m - 1, Math.floor(p * m))];
    },
    /** Frames per second over the last n frames. */
    fps(n = 60) {
      const mean = ring.mean(n);
      return mean > 0 ? 1000 / mean : 0;
    },
    /** How many of the last n frames took longer than `ms`. */
    over(ms, n = capacity) {
      const m = Math.min(n, count);
      let k = 0;
      for (let i = 0; i < m; i++) if (dt[idx(i)] > ms) k++;
      return k;
    },
  };
  return ring;
}

export function createLoop(opts = {}) {
  const {
    update = null,
    render = null,
    fixedStep = 0,
    maxSubSteps = 5,
    maxDelta = 0.1,
    maxFps = 0,
    governor = null,
    info = null,
    onResize = null,
    onVisibility = null,
    resizeDebounceMs = 120,
    pauseHidden = true,
    ring = createFrameRing(240),
  } = opts;
  const raf = opts.raf || ((fn) => requestAnimationFrame(fn));
  const caf = opts.caf || ((id) => cancelAnimationFrame(id));
  const now = opts.now || (() => performance.now());
  const doc = 'doc' in opts ? opts.doc : typeof document !== 'undefined' ? document : null;
  const win = 'win' in opts ? opts.win : typeof window !== 'undefined' ? window : null;
  const setT = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeout || ((id) => clearTimeout(id));

  const gpuTimer = opts.gpuTimer && opts.gpuTimer.supported !== false ? opts.gpuTimer : null;
  let running = false;
  let rafId = 0;
  let lastTs = -1;
  let acc = 0;
  let cap = maxFps;
  let nextDue = 0;
  let hiddenPaused = false;
  let resizeTimer = 0;
  let disposed = false;
  let frames = 0;
  let skipped = 0;
  let pendingDiscontinuity = false;
  const state = { alpha: 0, steps: 0, droppedSteps: 0 };

  if (info) info.autoReset = false; // the counters must span every pass of the frame; we reset once, below

  function tick(ts) {
    if (!running) return;
    rafId = raf(tick);
    if (cap > 0) {
      const interval = 1000 / cap;
      if (nextDue === 0) nextDue = ts;
      if (ts < nextDue - 2) {
        skipped++;
        return;
      }
      // carry the remainder so 144 Hz capped to 60 averages 60, but never schedule into the past by more than one interval (after a stall)
      nextDue = Math.max(nextDue + interval, ts - interval * 0.5);
    }
    let dtMs = lastTs < 0 ? 0 : ts - lastTs;
    lastTs = ts;
    if (dtMs < 0) dtMs = 0;
    if (pendingDiscontinuity) {
      pendingDiscontinuity = false;
      dtMs = 0;
      governor?.discontinuity?.(500);
    }
    const dtSec = Math.min(dtMs / 1000, maxDelta);
    const t0 = now();
    if (info) info.reset();
    if (gpuTimer) gpuTimer.begin(); // one query spanning every GL command of the frame (the sim's own work issues none)
    state.steps = 0;
    if (fixedStep > 0) {
      acc += dtSec;
      while (acc >= fixedStep && state.steps < maxSubSteps) {
        if (update) update(fixedStep);
        acc -= fixedStep;
        state.steps++;
      }
      if (acc >= fixedStep) {
        acc = 0; // spiral of death guard: drop the backlog instead of simulating ever more steps
        state.droppedSteps++;
      }
      state.alpha = acc / fixedStep;
    } else {
      if (update) update(dtSec);
      state.alpha = 1;
      state.steps = 1;
    }
    if (render) render(state.alpha, dtSec);
    if (gpuTimer) gpuTimer.end();
    const cpuMs = now() - t0;
    const calls = info ? info.render.calls : -1;
    frames++;
    if (dtMs > 0) {
      ring.push(dtMs, cpuMs, calls);
      if (governor) governor.frame(dtMs, cpuMs, calls, gpuTimer ? gpuTimer.lastMs : -1);
    }
  }

  function discontinuity() {
    pendingDiscontinuity = true;
    lastTs = -1;
    nextDue = 0;
    acc = 0;
  }

  const onVis = () => {
    const hidden = !!doc?.hidden;
    if (hidden && pauseHidden) {
      if (rafId) caf(rafId);
      rafId = 0;
      hiddenPaused = true;
      discontinuity();
      onVisibility?.(true);
    } else if (!hidden && hiddenPaused) {
      hiddenPaused = false;
      discontinuity();
      if (running) rafId = raf(tick);
      onVisibility?.(false);
    }
  };

  function fireResize() {
    resizeTimer = 0;
    if (disposed) return;
    governor?.discontinuity?.(500); // the renderer is about to reallocate: that frame is not evidence about the load
    onResize?.();
  }
  const onWinResize = () => {
    if (resizeTimer) clearT(resizeTimer);
    resizeTimer = setT(fireResize, resizeDebounceMs);
  };

  doc?.addEventListener?.('visibilitychange', onVis);
  if (onResize) win?.addEventListener?.('resize', onWinResize);
  let ro = null;
  if (onResize && opts.observe && typeof (opts.ResizeObserver ?? (typeof ResizeObserver !== 'undefined' ? ResizeObserver : null)) === 'function') {
    const RO = opts.ResizeObserver ?? ResizeObserver;
    ro = new RO(onWinResize);
    ro.observe(opts.observe);
  }

  const api = {
    ring,
    state,
    start() {
      if (running || disposed) return api;
      running = true;
      discontinuity();
      if (!(pauseHidden && doc?.hidden)) rafId = raf(tick);
      else hiddenPaused = true;
      return api;
    },
    stop() {
      running = false;
      if (rafId) caf(rafId);
      rafId = 0;
      return api;
    },
    /** Pause without tearing down (a menu, a modal). resume() continues without a catch-up burst. */
    pause() {
      if (!running) return api;
      running = false;
      if (rafId) caf(rafId);
      rafId = 0;
      return api;
    },
    resume() {
      if (running || disposed) return api;
      running = true;
      discontinuity();
      if (!(pauseHidden && doc?.hidden)) rafId = raf(tick);
      return api;
    },
    /** 0 = uncapped. Use governor.fpsCap (battery / data-saver) or the tier's own cap (lite = 30). */
    setMaxFps(n) {
      cap = n > 0 ? n : 0;
      nextDue = 0;
      return api;
    },
    /** Tell the loop (and the governor) that the next frame time is not evidence: after a long load or a synchronous rebuild. */
    discontinuity,
    get running() { return running; },
    get maxFps() { return cap; },
    get frames() { return frames; },
    get skipped() { return skipped; },
    dispose() {
      disposed = true;
      api.stop();
      doc?.removeEventListener?.('visibilitychange', onVis);
      win?.removeEventListener?.('resize', onWinResize);
      if (resizeTimer) clearT(resizeTimer);
      ro?.disconnect?.();
    },
  };
  return api;
}
