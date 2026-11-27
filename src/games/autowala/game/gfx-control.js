// The glue between Autowala and the shared engine layer (platform/gfx): which GPU is this, which tier and render scale to start on (the
// player's choice, then what this machine did last time, then a ~250 ms start-up calibration behind the loading bar, then the GPU class),
// and the frame governor that keeps the frame rate from then on. Game.js owns the consequences (what a tier step does to the world);
// this module owns the decisions and stays free of the game object, so the pure parts are unit-tested (gfx-control.test.js).
import { classifyGpu, createAdaptiveQuality, createGpuTimer, createTierMemory, runStandaloneCalibration, shouldCalibrate, viewportClass } from '@/platform/gfx';
import { GFX } from './config.js';
import { TIERS, gpuForTiers, tierAbove, tierBelow } from '../render/quality.js';

let probed = null;
/**
 * Classify this machine through a throw-away context that asks for the same GPU the game's renderer will ('high-performance': on a laptop
 * with two GPUs the default context and the game's context can be on different chips). Cached; the context is released. Null without a DOM.
 */
export function probeGameGpu(doc = typeof document !== 'undefined' ? document : null) {
  if (probed) return probed;
  if (!doc?.createElement) return null;
  let gl = null;
  try {
    const canvas = doc.createElement('canvas');
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false });
  } catch {
    /* no context */
  }
  probed = classifyGpu({ gl });
  try {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* ignore */
  }
  return probed;
}

/** The size the game will be drawn at, in CSS pixels, with the device pixel ratio: the viewport the tier memory and the calibration are keyed on. */
export function viewOf(canvas, win = typeof window !== 'undefined' ? window : null) {
  const w = (canvas && canvas.clientWidth) || win?.innerWidth || 1280;
  const h = (canvas && canvas.clientHeight) || win?.innerHeight || 720;
  return { w, h, dpr: (win && win.devicePixelRatio) || 1 };
}

/**
 * What the governor is told. `handlers` is an object the caller fills in later (the governor exists before the renderer does):
 * { onScale(scale, info), onTier(tier, info), onStable(info), onTierFailed(tier) }.
 * A generator so the calibration can be awaited by the staged boot: `yield*` it; it yields the calibration promise (a synchronous drain
 * skips the wait and starts from the GPU class alone).
 */
export function* setupQuality({ pref = 'auto', view, handlers = {}, storage, gpu: gpuIn = null, calibrate = runStandaloneCalibration, now } = {}) {
  const gpu = gpuForTiers(gpuIn || probeGameGpu() || classifyGpu({}), TIERS);
  const memory = createTierMemory({ game: 'autowala', storage, now }).get(gpu.key, viewportClass(view.w, view.h, view.dpr));
  const decision = shouldCalibrate({ gpu, memory, pref, tiers: TIERS });
  let calibration = null;
  if (decision.run) {
    // (drainAsync awaits a yielded promise but does not hand its value back: keep the result in a variable)
    let res = null;
    yield Promise.resolve()
      .then(() => calibrate({ width: view.w, height: view.h, dpr: view.dpr, gpu, tiers: GFX.models }))
      .then((r) => { res = r || null; }, () => { res = null; });
    calibration = res;
  }
  const aq = createAdaptiveQuality({
    game: 'autowala',
    tiers: TIERS,
    pref,
    viewport: view,
    gpu,
    calibration,
    storage,
    now,
    targetFps: 60,
    scaleMin: GFX.scaleMin,
    tierCost: GFX.tierCost,
    callBudgets: GFX.callBudget,
    onScale: (s, info) => handlers.onScale?.(s, info),
    onTier: (t, info) => handlers.onTier?.(t, info),
    onStable: (info) => handlers.onStable?.(info),
    onTierFailed: (t) => handlers.onTierFailed?.(t),
  });
  return { aq, gpu, calibration, decision };
}

/**
 * A GPU timer the loop can be told to leave alone: aw-probe's own timer queries must not nest inside the frame's, and a lost context kills
 * the queries (rebuild() makes new ones). `lastMs` is -1 while it is off.
 */
export function createSwitchableTimer(gl) {
  let raw = createGpuTimer(gl);
  let on = true;
  return {
    get supported() {
      return raw.supported;
    },
    begin: () => on && raw.begin(),
    end: (tag) => on && raw.end(tag),
    get lastMs() {
      return on ? raw.lastMs : -1;
    },
    get avgMs() {
      return raw.avgMs;
    },
    get enabled() {
      return on;
    },
    set enabled(v) {
      on = !!v;
    },
    rebuild(newGl) {
      try {
        raw.dispose();
      } catch {
        /* the context is gone with its queries */
      }
      raw = createGpuTimer(newGl);
    },
    dispose() {
      raw.dispose();
    },
  };
}

/**
 * What a memory warning from the OS does (the Android bridge fires `jalebi:memory` with level 'low' | 'critical'): 'low' = one step down and
 * a hold, 'critical' = the lowest tier and the optional GPU memory released. Pure: it returns the plan, Game.js carries it out.
 * `state` = { tier, scale, ladder, floor } of the governor; the plan is { tier, scale, release }.
 */
export function memoryPlan(level, { tier, scale, ladder = [1, 0.9, 0.8, 0.7, 0.6, 0.5], floor = 0.6, tiers = TIERS }) {
  if (level === 'critical') return { tier: tiers[0], scale: Math.max(floor, ladder[ladder.length - 1]), release: true };
  if (level !== 'low') return null;
  const at = ladder.findIndex((s) => s <= scale + 1e-6);
  const next = at >= 0 && at + 1 < ladder.length ? ladder[at + 1] : null;
  if (next !== null && next >= floor - 1e-6) return { tier, scale: next, release: false };
  const lower = tierBelow(tier, tiers);
  if (lower !== tier) return { tier: lower, scale: 1, release: false };
  return { tier, scale: Math.max(floor, ladder[ladder.length - 1]), release: false };
}

/** The tier a player's "Auto" starts a live switch from: what this GPU's class allows, medium at most (the governor climbs from there). */
export function autoStartTier(gpu, tiers = TIERS) {
  const cap = gpuForTiers(gpu, tiers).tierCap;
  return tiers.indexOf(cap) > tiers.indexOf('medium') ? 'medium' : cap;
}

export { tierAbove, tierBelow };
