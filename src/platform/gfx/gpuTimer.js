// GPU frame time through EXT_disjoint_timer_query_webgl2 (when the browser exposes it; Chrome does on most desktop GPUs, Safari / Firefox often not).
// It is the one measurement that tells the governor how much real headroom a vsync-pinned frame has, so it can step UP the tier with evidence
// instead of probing. Results arrive a few frames late (the GPU is behind the CPU): a small ring of in-flight queries is polled once per frame.
//
//   const timer = createGpuTimer(renderer.getContext());   // timer.supported === false => every method is a no-op and lastMs stays -1
//   // each frame:  timer.begin();  ...all rendering of the frame...  timer.end();     (call poll() implicitly from begin())
//   governor.frame(dt, cpuMs, calls, timer.lastMs);        // or pass { gpuTimer: timer } to createLoop
//
// Disjoint events (a power-state change, a context switch) make a result meaningless; those samples are dropped. Never nests: one begin/end per frame.

export function createGpuTimer(gl, { inflight = 4, disjointMs = 0, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = {}) {
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
    /** Optional: called as onResult(tag, ms) for every query ended with a tag (ms = -1 when the sample was discarded: disjoint / absurd). */
    onResult: null,
    begin() { return false; },
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

  // `getParameter(GPU_DISJOINT_EXT)` is a SYNCHRONOUS round trip to the GPU process in Chrome: the main thread waits until every command it has queued has been
  // decoded, so asking it every frame removes the one frame of lead the renderer has over the GPU (a game whose frame is JS + GL calls then pays both instead of the
  // larger). With `disjointMs` > 0 the flag is read at most that often (and only when a result is about to be consumed); a disjoint event between two reads can let
  // one bad sample through, which the plausibility filter below and the consumers' averaging absorb. 0 = every poll (the default: exact, and what the tests pin).
  let lastDisjointAt = -1e9;
  let disjointCache = false;
  const readDisjoint = () => {
    if (disjointMs > 0) {
      const t = now();
      if (t - lastDisjointAt < disjointMs) return disjointCache;
      lastDisjointAt = t;
    }
    let d = false;
    try {
      d = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
    } catch { /* ignore */ }
    disjointCache = d;
    return d;
  };

  function poll() {
    if (dead) return;
    let disjoint = false;
    let checked = false;
    if (disjointMs <= 0) {
      disjoint = readDisjoint(); // exact: every poll (as before)
      checked = true;
    }
    while (queue.length) {
      const q = queue[0].q;
      let ready = false;
      try {
        ready = !!avail(q);
      } catch {
        dead = true;
        return;
      }
      if (!ready) break;
      if (!checked) {
        disjoint = readDisjoint(); // only when a result is actually about to be used
        checked = true;
      }
      const { tag } = queue.shift();
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
      const tagged = tag !== undefined;
      if (disjoint || !(ns >= 0) || ns > 5e9 || (!tagged && !(ns > 0))) {
        out.dropped++;
        if (tagged) out.onResult?.(tag, -1);
        continue;
      }
      const ms = ns / 1e6;
      if (tagged) {
        out.onResult?.(tag, ms);
        continue; // a tagged measurement is a one-off: it does not feed lastMs / avgMs (those follow the untagged frame queries)
      }
      out.lastMs = ms;
      out.avgMs = out.avgMs < 0 ? ms : out.avgMs + (ms - out.avgMs) * 0.2;
      out.samples++;
    }
  }

  out.poll = poll;
  /** Starts a query; returns false when it did not start (the GPU is `inflight` queries behind: skip the sample instead of stalling). */
  out.begin = () => {
    if (dead || active) return false;
    poll();
    if (queue.length >= inflight) return false;
    try {
      const q = create();
      begin(q);
      active = q;
      return true;
    } catch {
      dead = true;
      out.supported = false;
      return false;
    }
  };
  /** Ends the query; a `tag` (optional) makes its result arrive through onResult(tag, ms). */
  out.end = (tag) => {
    if (!active) return;
    try {
      end();
      queue.push({ q: active, tag });
    } catch {
      dead = true;
      out.supported = false;
    }
    active = null;
  };
  out.dispose = () => {
    dead = true;
    for (const { q } of queue) {
      try {
        del(q);
      } catch { /* ignore */ }
    }
    queue.length = 0;
  };
  return out;
}
