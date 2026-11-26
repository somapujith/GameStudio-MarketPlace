// The frame governor: ONE controller that replaces the per-game samplers (Tiffin's createScaler + createQualitySampler + createDrawCallGuard,
// Autowala's step-down-only sampler). Feed it every rendered frame; it decides { scale, tier } and tells you through callbacks / return codes.
//
//   const gov = createGovernor({ tiers: ['lite','low','medium','high'], tier: 'medium', maxTier: gpu.tierCap, scale: saved?.scale ?? 1,
//                                callBudgets: { lite: 250, low: 350, medium: 700, high: 1000 }, onScale, onTier, onStable });
//   // per frame (all arguments in milliseconds; cpuMs / calls / gpuMs are optional extras, pass -1 when unknown):
//   const code = gov.frame(dtMs, cpuMs, calls, gpuMs);   // CHANGE_NONE | CHANGE_SCALE | CHANGE_TIER, read gov.scale / gov.tier
//
// What it does, and why it does not thrash
//   * Budget: 1000 / min(refreshHz, targetFps, fpsCap). The refresh rate (50..240 Hz) is detected from the frame intervals themselves.
//   * Decisions are made once per ~400 ms WINDOW on a TRIMMED mean (frames over max(3.5 x median, 80 ms) are hitches: counted, never acted on),
//     so a one-off shader compile or GC pause never lowers the resolution. The first `warmupMs`, tab switches (dt > 250 ms) and every
//     change settle for a moment and are ignored.
//   * Down: the windowed ratio mean / budget must stay above `downRatio` (1.15) for two windows (one window when it is severe: >= 1.6 AND most
//     frames are slow). The new scale comes from an area model (cost ~ scale^2) rounded to the ladder (1, .9, .8 ... .5), so it usually lands in one step.
//   * No gain => CPU bound: when a scale step does not speed the frame up (or cpuMs says the main thread is the limit) the scale is RESTORED and the
//     TIER steps down instead. Draw calls over the tier's budget while missing the frame budget also step the tier down.
//   * Up: separate, lower threshold. A rung up is taken when the area model PREDICTS it fits (predicted <= 0.9 x budget) after 2.5 s of calm, or, when the frame
//     time is pinned at vsync and headroom is invisible, as a PROBE (after 5 s, doubling after each failure, 2 failures per rung, then frozen until the
//     load changes). A probe that misses the budget is reverted at once. Tier up needs 20 s of calm and an observable prediction (gpuMs / cpuMs help here).
//   * Hysteresis band: [up threshold .. down threshold] does nothing, so a steady load settles on one rung and stays.
//
// Pure and deterministic: time is the sum of the dt it is fed, there is no clock. `frame()` allocates nothing (typed-array scratch); callbacks and
// `stats()` allocate, but only on a change / on demand.

export const CHANGE_NONE = 0;
export const CHANGE_SCALE = 1;
export const CHANGE_TIER = 2;

export const DEFAULT_LADDER = [1, 0.9, 0.8, 0.7, 0.6, 0.5];
export const STANDARD_REFRESH = [50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
const WIN_MAX = 192; // frames per window at most (a 480 fps loop would otherwise overflow it)
const RING = 128;

/** Snaps an interval to a standard refresh rate within 6%, or 0. Rates below `min` are treated as "a slow machine", not "a slow display". */
export function snapRefresh(intervalMs, min = 50) {
  if (!(intervalMs > 0)) return 0;
  const hz = 1000 / intervalMs;
  let best = 0;
  let bestErr = 0.06;
  for (const r of STANDARD_REFRESH) {
    if (r < min) continue;
    const err = Math.abs(hz - r) / r;
    if (err < bestErr) {
      bestErr = err;
      best = r;
    }
  }
  return best;
}

/**
 * The display refresh rate from a run of frame intervals (ms): the 10th-percentile interval snapped to a standard rate, provided a real cluster of
 * frames sits at that interval (vsync-locked). An uncapped loop (no cluster) or a machine slower than the display answers 0 (unknown).
 */
export function detectRefreshHz(intervals, count = intervals.length, min = 50) {
  const n = Math.min(count, intervals.length);
  if (n < 30) return 0;
  const a = Array.prototype.slice.call(intervals, 0, n).filter((v) => v > 0 && v < 100).sort((x, y) => x - y);
  if (a.length < 30) return 0;
  const q = a[Math.floor(a.length * 0.1)];
  const hz = snapRefresh(q, min);
  if (!hz) return 0;
  const target = 1000 / hz;
  let near = 0;
  for (const v of a) if (Math.abs(v - target) / target <= 0.1) near++;
  return near / a.length >= 0.25 ? hz : 0;
}

/** The fps cap the device hints ask for (0 = none): low battery, OS low-power mode, reduced data and serious thermal pressure all cap at 30. */
export function fpsCapFromHints(h = {}) {
  if (h.capFps > 0) return h.capFps;
  if (h.batteryLow || h.lowPower || h.saveData || h.thermal === 'serious' || h.thermal === 'critical') return 30;
  return 0;
}

const nearestIndex = (ladder, x) => {
  let best = 0;
  for (let i = 1; i < ladder.length; i++) if (Math.abs(ladder[i] - x) < Math.abs(ladder[best] - x)) best = i;
  return best;
};

export function createGovernor(rawOpts = {}) {
  // an option passed as undefined means "not given" (callers forward optional settings): it must not override a default
  const opts = Object.fromEntries(Object.entries(rawOpts).filter(([, v]) => v !== undefined));
  const tiers = opts.tiers || ['lite', 'low', 'medium', 'high'];
  const ladder = (opts.ladder || DEFAULT_LADDER).slice().sort((a, b) => b - a);
  const cfg = {
    targetFps: 60,
    minRefreshHz: 50,
    warmupMs: 800,
    windowMs: 400,
    minWindowFrames: 4,
    settleMs: 200,
    downRatio: 1.15,
    severeRatio: 1.6,
    downWindows: 2,
    upRatio: 0.9,
    upHoldMs: 2500,
    probeHoldMs: 5000,
    probeRevertRatio: 1.08,
    maxProbeFailures: 2,
    okRatio: 1.05,
    noGainMin: 0.03,
    tierUpHoldMs: 20000,
    tierUpRatio: 0.85,
    maxTierFailures: 1,
    tierWarmupMs: 1500,
    hitchFactor: 3.5,
    hitchMinMs: 80,
    maxDtMs: 250,
    stableSaveMs: 8000,
    callOverMs: 2000,
    scaleMin: 0.5,
    ...opts,
  };
  const costOf = (i) => (opts.tierCost && opts.tierCost[tiers[i]]) ?? Math.pow(1.7, i);
  const floorFor = (i) => {
    const v = typeof cfg.scaleMin === 'function' ? cfg.scaleMin(tiers[i], i) : typeof cfg.scaleMin === 'object' ? cfg.scaleMin[tiers[i]] ?? 0.5 : cfg.scaleMin;
    return Math.max(ladder[ladder.length - 1], Math.min(1, v));
  };

  let tierI = Math.max(0, tiers.indexOf(opts.tier ?? 'medium'));
  const minI = Math.max(0, tiers.indexOf(opts.minTier ?? tiers[0]));
  let maxI = tiers.indexOf(opts.maxTier ?? tiers[tiers.length - 1]);
  if (maxI < 0) maxI = tiers.length - 1;
  maxI = Math.max(maxI, tierI);
  let locked = !!opts.lockTier || tiers.length < 2;
  let scaleI = nearestIndex(ladder, opts.scale ?? 1);
  if (ladder[scaleI] < floorFor(tierI)) scaleI = nearestIndex(ladder, floorFor(tierI));

  // ---- clock & window state
  let t = 0; // ms of frames seen
  let ignoreMs = cfg.warmupMs;
  const win = new Float32Array(WIN_MAX);
  const sorted = new Float32Array(WIN_MAX);
  let wn = 0;
  let wSpan = 0;
  let wCpu = 0;
  let wCpuN = 0;
  let wGpu = 0;
  let wGpuN = 0;
  let wCalls = 0;
  let wCallsN = 0;
  const ring = new Float32Array(RING);
  let ringN = 0;
  let ringPos = 0;
  let sinceDetect = 0;

  // ---- refresh / budget
  let refreshHz = opts.refreshHz > 0 ? opts.refreshHz : 0;
  let refreshFixed = refreshHz > 0;
  let lastDetected = 0;
  let hints = {};
  let cap = 0;
  let budget = 1000 / 60;
  const recomputeBudget = () => {
    const fps = Math.min(refreshHz || 60, cfg.targetFps || Infinity, cap || Infinity);
    budget = 1000 / Math.max(10, fps);
  };
  recomputeBudget();

  // ---- decisions
  let badWindows = 0;
  let okMs = 0;
  let cool = 0;
  let pending = null; // the change whose effect the next window verifies: { kind, from, preMean, expected }
  let noGain = 0;
  let baseScaleI = scaleI; // the scale before a run of no-gain steps
  let stableMs = 0;
  let stableSaved = false;
  let callOver = 0;
  let lastUpAt = -1e9;
  let calmMs = 0;
  const probeFail = new Uint8Array(ladder.length);
  const tierFail = new Uint8Array(tiers.length);
  if (opts.failedTiers) for (const f of opts.failedTiers) if (tiers.indexOf(f) >= 0) tierFail[tiers.indexOf(f)] = cfg.maxTierFailures;
  const counts = { scaleDown: 0, scaleUp: 0, tierDown: 0, tierUp: 0, reverts: 0, hitches: 0, discontinuities: 0, windows: 0 };
  const history = [];
  let last = { ratio: 0, mean: 0, cpu: -1, gpu: -1, calls: -1, slowFrac: 0 };
  let lastReason = 'start';

  const log = (kind, from, to, reason, ratio) => {
    lastReason = `${kind} ${from} -> ${to}: ${reason}`;
    history.push({ t: Math.round(t), kind, from, to, reason, ratio: Math.round(ratio * 100) / 100 });
    if (history.length > 24) history.shift();
  };

  const resetWindow = () => {
    wn = 0;
    wSpan = 0;
    wCpu = wCpuN = wGpu = wGpuN = wCalls = wCallsN = 0;
  };
  const discontinuity = (ms = 300) => {
    ignoreMs = Math.max(ignoreMs, ms);
    resetWindow();
    badWindows = 0;
    okMs = 0;
    pending = null;
  };

  const fire = {
    scale: (info) => opts.onScale?.(ladder[scaleI], info),
    tier: (info) => opts.onTier?.(tiers[tierI], info),
  };

  function setScaleIndex(i, kind, reason, ratio, settle = cfg.settleMs) {
    const from = ladder[scaleI];
    scaleI = i;
    cool = kind === 'up' ? 1500 : 600;
    ignoreMs = Math.max(ignoreMs, settle);
    resetWindow();
    badWindows = 0;
    okMs = 0;
    stableMs = 0;
    stableSaved = false;
    callOver = 0;
    log(kind === 'up' ? 'scale-up' : 'scale-down', from, ladder[i], reason, ratio);
    fire.scale({ reason, from, ratio, kind });
    return CHANGE_SCALE;
  }

  function setTierIndex(i, scaleTo, kind, reason, ratio) {
    const from = tiers[tierI];
    tierI = i;
    scaleI = scaleTo;
    cool = cfg.tierWarmupMs;
    ignoreMs = Math.max(ignoreMs, cfg.tierWarmupMs);
    resetWindow();
    badWindows = 0;
    okMs = 0;
    noGain = 0;
    stableMs = 0;
    stableSaved = false;
    callOver = 0;
    probeFail.fill(0);
    baseScaleI = scaleI;
    log(kind === 'up' ? 'tier-up' : 'tier-down', from, tiers[i], reason, ratio);
    fire.tier({ reason, from, ratio, kind, scale: ladder[scaleI] });
    return CHANGE_TIER;
  }

  function tierDown(reason, ratio, restoreScaleI = -1) {
    if (locked || tierI <= minI) return CHANGE_NONE;
    const next = tierI - 1;
    let to = restoreScaleI >= 0 ? restoreScaleI : nearestIndex(ladder, Math.min(1, ladder[scaleI] / Math.sqrt(Math.max(0.2, costOf(next) / costOf(tierI)))));
    to = Math.min(to, nearestIndex(ladder, floorFor(next))); // never below the new tier's floor (ladder is descending: smaller index = larger scale)
    if (ladder[to] < floorFor(next)) to = nearestIndex(ladder, floorFor(next));
    pending = { kind: 'tier', from: tierI };
    counts.tierDown++;
    return setTierIndex(next, to, 'down', reason, ratio);
  }

  function stepDown(m, ratio, cpuMean, gpuMean, windowDur) {
    // a down step soon after a probe up means that rung does not hold: remember it
    if (t - lastUpAt < 30000 && scaleI > 0) probeFail[scaleI] = Math.min(255, probeFail[scaleI] + 1);
    const floor = floorFor(tierI);
    // the main thread alone fills the frame (or the whole budget): fewer pixels cannot fit this tier into it
    const cpuBound = cpuMean >= 0 && cpuMean > Math.min(m * 0.8, budget) && !(gpuMean >= 0 && gpuMean > cpuMean);
    if (cpuBound) {
      // the main thread, not the pixels, is the limit: resolution cannot help; the tier is the lever (restore any sharpness a no-gain run cost).
      // With no lower tier to give (locked / lowest) fall through and try the scale anyway: the cpu reading is only a hint, the no-gain check decides.
      const r = tierDown(`cpu bound (cpu ${cpuMean.toFixed(1)} ms of ${m.toFixed(1)} ms)`, ratio, noGain > 0 ? baseScaleI : scaleI);
      if (r) return r;
    }
    if (ladder[scaleI] > floor + 1e-6) {
      const wanted = ladder[scaleI] * Math.sqrt(Math.min(1, (budget * 0.9) / m));
      let to = nearestIndex(ladder, wanted);
      if (to <= scaleI) to = scaleI + 1; // always at least one rung
      while (ladder[to] < floor - 1e-6 && to > scaleI + 1) to--;
      if (ladder[to] < floor - 1e-6) to = scaleI;
      if (to !== scaleI) {
        if (noGain === 0) baseScaleI = scaleI;
        pending = { kind: 'down', preMean: m, expected: 1 - (ladder[to] / ladder[scaleI]) ** 2 };
        counts.scaleDown++;
        return setScaleIndex(to, 'down', `mean ${m.toFixed(1)} ms vs budget ${budget.toFixed(1)} ms`, ratio);
      }
    }
    return tierDown(`scale floor ${floor} reached, still ${m.toFixed(1)} ms vs ${budget.toFixed(1)} ms`, ratio);
  }

  function tryUp(m, load, span) {
    if (cool > 0) return CHANGE_NONE;
    if (scaleI > 0) {
      const up = scaleI - 1;
      if (probeFail[up] >= cfg.maxProbeFailures) return CHANGE_NONE; // this rung failed twice: the model is wrong here, stay put until the load changes
      const predicted = load * (ladder[up] / ladder[scaleI]) ** 2;
      const confident = predicted <= budget * cfg.upRatio;
      if (confident && okMs >= cfg.upHoldMs) {
        pending = { kind: 'up', mode: 'confirmed', from: scaleI };
        lastUpAt = t;
        counts.scaleUp++;
        return setScaleIndex(up, 'up', `predicted ${predicted.toFixed(1)} ms fits ${budget.toFixed(1)} ms`, m / budget);
      }
      const hold = cfg.probeHoldMs * 2 ** Math.min(4, probeFail[up]);
      if (!confident && probeFail[up] < cfg.maxProbeFailures && okMs >= hold && m <= budget * cfg.okRatio) {
        pending = { kind: 'up', mode: 'probe', from: scaleI };
        lastUpAt = t;
        counts.scaleUp++;
        return setScaleIndex(up, 'up', `probe (frame time pinned at ${m.toFixed(1)} ms, no visible headroom)`, m / budget);
      }
      return CHANGE_NONE;
    }
    // top rung: consider a better tier
    if (locked || tierI >= maxI || tierFail[tierI + 1] >= cfg.maxTierFailures) return CHANGE_NONE;
    if (okMs < cfg.tierUpHoldMs) return CHANGE_NONE;
    const predicted = load * (costOf(tierI + 1) / costOf(tierI));
    if (predicted <= budget * cfg.tierUpRatio) {
      pending = { kind: 'tierUp', from: tierI };
      lastUpAt = t;
      counts.tierUp++;
      return setTierIndex(tierI + 1, scaleI, 'up', `predicted ${predicted.toFixed(1)} ms fits ${budget.toFixed(1)} ms`, m / budget);
    }
    return CHANGE_NONE;
  }

  /** Closes the current window and decides. */
  function evaluate() {
    const n = wn;
    // median (insertion sort into scratch: no allocation)
    for (let i = 0; i < n; i++) {
      const v = win[i];
      let j = i - 1;
      while (j >= 0 && sorted[j] > v) {
        sorted[j + 1] = sorted[j];
        j--;
      }
      sorted[j + 1] = v;
    }
    const median = sorted[n >> 1];
    const hitchAt = Math.max(cfg.hitchFactor * median, cfg.hitchMinMs);
    let sum = 0;
    let k = 0;
    let slow = 0;
    for (let i = 0; i < n; i++) {
      const v = win[i];
      if (v > hitchAt) continue;
      sum += v;
      k++;
      if (v > budget * 1.3) slow++;
    }
    counts.hitches += n - k;
    const span = wSpan;
    const cpuMean = wCpuN ? wCpu / wCpuN : -1;
    const gpuMean = wGpuN ? wGpu / wGpuN : -1;
    const callsMean = wCallsN ? wCalls / wCallsN : -1;
    const hadGpu = wGpuN > 0;
    resetWindow();
    if (!k) return CHANGE_NONE;
    counts.windows++;
    const m = sum / k;
    const ratio = m / budget;
    const slowFrac = slow / k;
    // headroom estimate: with BOTH sides measured (cpu submit + gpu timer) the real load can be far below a vsync-pinned frame time.
    // cpuMs alone says nothing about the GPU, so without gpuMs the frame time itself is the load.
    const busy = hadGpu && cpuMean >= 0 ? Math.max(cpuMean, gpuMean) : gpuMean;
    const load = busy > 0 ? Math.min(m, busy * 1.05) : m;
    last = { ratio, mean: m, cpu: cpuMean, gpu: gpuMean, calls: callsMean, slowFrac };

    // ---- 1. verify the last change
    if (pending) {
      const p = pending;
      pending = null;
      if (p.kind === 'up') {
        if (ratio > cfg.probeRevertRatio) {
          probeFail[p.from - 1 >= 0 ? p.from - 1 : 0] = Math.min(255, probeFail[p.from - 1 >= 0 ? p.from - 1 : 0] + 1);
          counts.reverts++;
          lastUpAt = -1e9;
          return setScaleIndex(p.from, 'down', `${p.mode} up did not hold (${ratio.toFixed(2)} x budget): reverted`, ratio);
        }
        probeFail[Math.max(0, scaleI)] = 0;
      } else if (p.kind === 'tierUp') {
        if (ratio > cfg.probeRevertRatio) {
          tierFail[tierI] = Math.min(255, tierFail[tierI] + 1);
          counts.reverts++;
          opts.onTierFailed?.(tiers[tierI], { ratio });
          const r = setTierIndex(p.from, 0, 'down', `tier up did not hold (${ratio.toFixed(2)} x budget): reverted`, ratio);
          return r;
        }
      } else if (p.kind === 'down') {
        const gain = (p.preMean - m) / p.preMean;
        if (ratio > cfg.downRatio && gain < Math.max(cfg.noGainMin, p.expected * 0.3)) {
          noGain++;
          badWindows = cfg.downWindows - 1; // the step did nothing: do not wait another window to try the next lever
          if (noGain >= 2 || ratio >= cfg.severeRatio) {
            // two scale steps bought (almost) nothing: the pixels are not the bottleneck. Put the sharpness back and use the tier.
            const restore = baseScaleI;
            noGain = 0;
            const r = tierDown(`resolution did not help (${p.preMean.toFixed(1)} -> ${m.toFixed(1)} ms): cpu / draw-call bound`, ratio, restore);
            if (r) return r;
            if (restore !== scaleI) return setScaleIndex(restore, 'up', 'scale restored: lowering it bought nothing and no lower tier exists', ratio);
            return CHANGE_NONE;
          }
        } else noGain = 0;
      }
    }

    // ---- 2. the draw-call guard (calls do not shrink with resolution: only the tier helps)
    const callBudget = cfg.callBudgets?.[tiers[tierI]];
    if (callBudget && callsMean > callBudget && ratio > 1.0) {
      callOver += span;
      if (callOver >= cfg.callOverMs && !locked && tierI > minI) {
        callOver = 0;
        return tierDown(`${Math.round(callsMean)} draw calls over the ${tiers[tierI]} budget ${callBudget}`, ratio, noGain > 0 ? baseScaleI : -1);
      }
    } else callOver = 0;

    // ---- 3. down
    if (ratio > cfg.downRatio) {
      badWindows++;
      okMs = 0;
      calmMs = 0;
      stableMs = 0;
      if (cool > 0) return CHANGE_NONE;
      const severe = ratio >= cfg.severeRatio && slowFrac >= 0.7;
      if (severe || badWindows >= cfg.downWindows) return stepDown(m, ratio, cpuMean, gpuMean, span);
      return CHANGE_NONE;
    }
    badWindows = 0;

    // ---- 4. calm: stable bookkeeping and up
    if (ratio <= cfg.okRatio) {
      okMs += span;
      calmMs += span;
    } else okMs = 0;
    if (ratio <= 1.1) {
      stableMs += span;
      if (!stableSaved && stableMs >= cfg.stableSaveMs && !pending) {
        stableSaved = true;
        opts.onStable?.({ tier: tiers[tierI], scale: ladder[scaleI], ratio, refreshHz: refreshHz || 60 });
      }
    }
    if (calmMs >= 120000) {
      // a long calm spell forgives old failures: the scene may have changed
      for (let i = 0; i < probeFail.length; i++) if (probeFail[i] > 0) probeFail[i]--;
      calmMs = 0;
    }
    return tryUp(m, load, span);
  }

  function maybeDetectRefresh() {
    if (refreshFixed || ringN < 60) return;
    sinceDetect++;
    if (sinceDetect < (lastDetected ? 90 : 60)) return;
    sinceDetect = 0;
    const hz = detectRefreshHz(ring, Math.min(ringN, RING), cfg.minRefreshHz);
    if (!hz) return;
    if (hz === lastDetected && hz !== refreshHz) {
      // two agreeing detections: adopt
      refreshHz = hz;
      recomputeBudget();
      resetWindow();
      opts.onRefresh?.(hz);
    }
    lastDetected = hz;
  }

  const api = {
    /** One rendered frame. dtMs: time since the previous rendered frame; cpuMs: main-thread time of the frame's JS; calls: draw calls; gpuMs: GPU time (timer query). */
    frame(dtMs, cpuMs = -1, calls = -1, gpuMs = -1) {
      if (!(dtMs > 0)) return CHANGE_NONE;
      t += dtMs;
      if (cool > 0) cool -= dtMs;
      if (dtMs > cfg.maxDtMs) {
        counts.discontinuities++;
        discontinuity(400); // a tab switch, a long compile or a debugger pause: not evidence about the load
        return CHANGE_NONE;
      }
      ring[ringPos] = dtMs;
      ringPos = (ringPos + 1) % RING;
      if (ringN < RING) ringN++;
      maybeDetectRefresh();
      if (ignoreMs > 0) {
        ignoreMs -= dtMs;
        return CHANGE_NONE;
      }
      if (wn < WIN_MAX) win[wn++] = dtMs;
      wSpan += dtMs;
      if (cpuMs >= 0) {
        wCpu += cpuMs;
        wCpuN++;
      }
      if (gpuMs > 0) {
        wGpu += gpuMs;
        wGpuN++;
      }
      if (calls >= 0) {
        wCalls += calls;
        wCallsN++;
      }
      if ((wSpan < cfg.windowMs && wn < WIN_MAX) || wn < cfg.minWindowFrames) return CHANGE_NONE;
      return evaluate();
    },
    get tier() { return tiers[tierI]; },
    get tierIndex() { return tierI; },
    get scale() { return ladder[scaleI]; },
    get budgetMs() { return budget; },
    get refreshHz() { return refreshHz || 60; },
    get refreshKnown() { return refreshHz > 0; },
    get fpsCap() { return cap; },
    get locked() { return locked; },
    get stableMs() { return stableMs; },
    get lastReason() { return lastReason; },
    get history() { return history; },
    ladder,
    tiers,
    /** Ignore the next `ms` of frames (a long load, a tab switch, a level change). */
    hold(ms = 1500) {
      ignoreMs = Math.max(ignoreMs, ms);
      resetWindow();
      pending = null;
    },
    discontinuity,
    /** The scene changed (new area, day / night, crowd): failed probes may succeed now. */
    notifyLoadChange() {
      probeFail.fill(0);
      tierFail.fill(0);
      okMs = 0;
      calmMs = 0;
    },
    /** Device hints: { batteryLow, lowPower, saveData, thermal, capFps }. Returns the resulting fps cap (0 = none). */
    setHints(h = {}) {
      hints = { ...hints, ...h };
      const next = fpsCapFromHints(hints);
      if (next !== cap) {
        cap = next;
        recomputeBudget();
        discontinuity(300);
      }
      return cap;
    },
    /** A known refresh rate (e.g. from calibration) disables detection. 0 re-enables it. */
    setRefreshHz(hz) {
      refreshFixed = hz > 0;
      refreshHz = hz > 0 ? hz : 0;
      lastDetected = 0;
      recomputeBudget();
      discontinuity(300);
    },
    /** The player picked a tier (or the app forces one): takes effect now, the governor adapts from there. `lock` keeps the tier and adapts only the scale. */
    setTier(tier, { scale = 1, lock } = {}) {
      const i = tiers.indexOf(tier);
      if (i < 0) return;
      if (lock !== undefined) locked = !!lock || tiers.length < 2;
      tierI = i;
      maxI = Math.max(maxI, i);
      scaleI = Math.max(0, nearestIndex(ladder, Math.max(scale, floorFor(i))));
      baseScaleI = scaleI;
      probeFail.fill(0);
      discontinuity(cfg.tierWarmupMs);
    },
    setLock(v) { locked = !!v || tiers.length < 2; },
    /** Raise or lower the highest tier the governor may climb to. */
    setMaxTier(tier) {
      const i = tiers.indexOf(tier);
      if (i >= 0) maxI = Math.max(i, tierI);
    },
    /** Marks a tier as unable to hold the budget here (from tier memory). */
    markTierFailed(tier) {
      const i = tiers.indexOf(tier);
      if (i >= 0) tierFail[i] = cfg.maxTierFailures;
    },
    /** A snapshot for a dev panel / logs. Allocates. */
    stats() {
      const n = Math.min(ringN, RING);
      const a = Array.prototype.slice.call(ring, 0, n).sort((x, y) => x - y);
      const pct = (p) => (n ? a[Math.min(n - 1, Math.floor(n * p))] : 0);
      return {
        tier: tiers[tierI], scale: ladder[scaleI], budgetMs: budget, refreshHz: refreshHz || 60, refreshKnown: refreshHz > 0, fpsCap: cap, locked,
        mean: n ? a.reduce((s, v) => s + v, 0) / n : 0, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99),
        lastWindow: { ...last }, counts: { ...counts }, stableMs, lastReason, probeFailures: Array.from(probeFail), tierFailures: Array.from(tierFail),
        elapsedMs: t, history: history.slice(),
      };
    },
  };
  return api;
}
