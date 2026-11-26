// GPU frame time through EXT_disjoint_timer_query_webgl2 (when the browser exposes it; Chrome does on most desktop GPUs, Safari / Firefox often not).
// It is the one measurement that tells the governor how much real headroom a vsync-pinned frame has, so it can step UP the tier with evidence
// instead of probing. Results arrive a few frames late (the GPU is behind the CPU): a small ring of in-flight queries is polled once per frame.
//
//   const timer = createGpuTimer(renderer.getContext());   // timer.supported === false => every method is a no-op and lastMs stays -1
//   // each frame:  timer.begin();  ...all rendering of the frame...  timer.end();     (call poll() implicitly from begin())
//   governor.frame(dt, cpuMs, calls, timer.lastMs);        // or pass { gpuTimer: timer } to createLoop
//
// Disjoint events (a power-state change, a context switch) make a result meaningless; those samples are dropped. Never nests: one begin/end per frame.

export function createGpuTimer(gl, { inflight = 4 } = {}) {
  let ext = null;
  try {
    ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2') || gl?.getExtension?.('EXT_disjoint_timer_query') || null;
  } catch { /* not available */ }
  const out = {
    supported: !!ext,
    /** The most recent valid GPU time in ms (-1 until the first result arrives). */
    lastMs: -1,
    /** Exponential average of valid results, ms (-1 until the first). */
    avgMs: -1,
    samples: 0,
    dropped: 0,
    begin() {},
    end() {},
    poll() {},
    dispose() {},
  };
  if (!ext) return out;
  const gl2 = typeof gl.createQuery === 'function';
  const create = () => (gl2 ? gl.createQuery() : ext.createQueryEXT());
  const del = (q) => (gl2 ? gl.deleteQuery(q) : ext.deleteQueryEXT(q));
  const TARGET = ext.TIME_ELAPSED_EXT;
  const begin = (q) => (gl2 ? gl.beginQuery(TARGET, q) : ext.beginQueryEXT(TARGET, q));
  const end = () => (gl2 ? gl.endQuery(TARGET) : ext.endQueryEXT(TARGET));
  const avail = (q) => (gl2 ? gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) : ext.getQueryObjectEXT(q, ext.QUERY_RESULT_AVAILABLE_EXT));
  const result = (q) => (gl2 ? gl.getQueryParameter(q, gl.QUERY_RESULT) : ext.getQueryObjectEXT(q, ext.QUERY_RESULT_EXT));

  const queue = []; // queries submitted, oldest first
  let active = null;
  let dead = false;

  function poll() {
    if (dead) return;
    let disjoint = false;
    try {
      disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
    } catch { /* ignore */ }
    while (queue.length) {
      const q = queue[0];
      let ready = false;
      try {
        ready = !!avail(q);
      } catch {
        dead = true;
        return;
      }
      if (!ready) break;
      queue.shift();
      let ns = 0;
      try {
        ns = Number(result(q));
      } catch {
        dead = true;
        return;
      }
      try {
        del(q);
      } catch { /* ignore */ }
      if (disjoint || !(ns > 0) || ns > 5e9) {
        out.dropped++;
        continue;
      }
      const ms = ns / 1e6;
      out.lastMs = ms;
      out.avgMs = out.avgMs < 0 ? ms : out.avgMs + (ms - out.avgMs) * 0.2;
      out.samples++;
    }
  }

  out.poll = poll;
  out.begin = () => {
    if (dead || active) return;
    poll();
    if (queue.length >= inflight) return; // the GPU is that far behind: skip this frame's sample instead of stalling
    try {
      const q = create();
      begin(q);
      active = q;
    } catch {
      dead = true;
      out.supported = false;
    }
  };
  out.end = () => {
    if (!active) return;
    try {
      end();
      queue.push(active);
    } catch {
      dead = true;
      out.supported = false;
    }
    active = null;
  };
  out.dispose = () => {
    dead = true;
    for (const q of queue) {
      try {
        del(q);
      } catch { /* ignore */ }
    }
    queue.length = 0;
  };
  return out;
}
