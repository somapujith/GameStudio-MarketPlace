// The glue: one call that wires the engine pieces together the way both games need them.
//
//   const aq = createAdaptiveQuality({ game: 'tiffin-centre', tiers: ['lite','low','medium','high'], pref: getGfxPref(), viewport: { w, h, dpr },
//                                      gl, calibration, callBudgets: DRAW_CALL_BUDGET, onScale: (s) => dyn.setScale(s), onTier: (t, info) => rebuild(t, info.scale) });
//   aq.initial      { tier, scale, source: 'pref' | 'memory' | 'calibration' | 'class', lock, maxTier, reasons }   -> build the renderer with this tier
//   aq.governor     feed it every frame (createLoop does: createLoop({ governor: aq.governor }))
//   aq.gpu          the classification (class, model, tierCap ...)
//   aq.memory       tier memory; the governor's onStable already saves into it and a failed tier-up is recorded as failed
//
// Order of authority for the START tier: the player's explicit choice, the remembered stable result for this GPU + viewport class, the calibration (capped by
// the GPU class), the GPU class alone. After that the governor owns the tier and the scale.
//
//   const cal = await runStandaloneCalibration({ width, height, dpr, gpu })      // optional ~250 ms on the loading screen, on a throw-away WebGL context
//
// Device hints (battery, data saver) cap the frame rate through the governor: watchDeviceHints(aq.governor).

import { WebGLRenderer } from 'three';
import { classifyGpu, probeGpu, TIER_ORDER } from './gpu.js';
import { createTierMemory, viewportClass } from './tierMemory.js';
import { DEFAULT_TIER_MODELS, chooseInitialTier, createCalibration, shouldCalibrate } from './calibrate.js';
import { createGovernor } from './governor.js';

/** { saveData, slowNet, reducedMotion } from navigator / matchMedia (battery arrives asynchronously through readBattery). Never throws. */
export function readDeviceHints({ nav, win, mm } = {}) {
  nav = nav ?? (typeof navigator !== 'undefined' ? navigator : {});
  win = win ?? (typeof window !== 'undefined' ? window : {});
  const media = mm ?? ((q) => {
    try {
      return typeof win.matchMedia === 'function' && !!win.matchMedia(q)?.matches;
    } catch {
      return false;
    }
  });
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection || null;
  return {
    saveData: !!conn?.saveData || media('(prefers-reduced-data: reduce)'),
    slowNet: /(^|-)2g$/.test(String(conn?.effectiveType || '')),
    reducedMotion: media('(prefers-reduced-motion: reduce)'),
  };
}

/** { level, charging } from the Battery Status API (Chromium only), or null. Resolves within 800 ms; never rejects. */
export async function readBattery(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  try {
    if (typeof nav.getBattery !== 'function') return null;
    const b = await Promise.race([nav.getBattery(), new Promise((r) => setTimeout(() => r(null), 800))]);
    if (!b) return null;
    return { level: Number(b.level), charging: !!b.charging, battery: b };
  } catch {
    return null;
  }
}

/**
 * Keeps the governor's fps-cap hints current: data saver (Network Information `change`), battery level / charging. Returns an unsubscribe function.
 * Async because the Battery API is a promise; safe to ignore the returned promise's rejection (it never rejects).
 */
export function watchDeviceHints(governor, { nav = typeof navigator !== 'undefined' ? navigator : {}, win, mm } = {}) {
  const subs = [];
  let stopped = false;
  const apply = (extra = {}) => {
    if (stopped) return;
    const h = readDeviceHints({ nav, win, mm });
    governor.setHints({ saveData: h.saveData, ...extra });
  };
  apply();
  const conn = nav.connection || null;
  if (conn?.addEventListener) {
    conn.addEventListener('change', apply);
    subs.push(() => conn.removeEventListener('change', apply));
  }
  readBattery(nav).then((b) => {
    if (!b || stopped) return;
    const bat = b.battery;
    const upd = () => apply({ batteryLow: Number(bat.level) <= 0.2 && !bat.charging });
    upd();
    for (const ev of ['levelchange', 'chargingchange']) {
      bat.addEventListener?.(ev, upd);
      subs.push(() => bat.removeEventListener?.(ev, upd));
    }
  });
  return () => {
    stopped = true;
    for (const f of subs) f();
  };
}

/**
 * Runs the calibration on a throw-away WebGL context (a detached canvas), so it can happen BEFORE the game's own renderer exists (the game needs the
 * tier to build it). Resolves the calibration result, or null when a context cannot be made. The context is released afterwards.
 */
export async function runStandaloneCalibration({ width, height, dpr = 1, gpu = null, tiers = DEFAULT_TIER_MODELS, maxMs = 300, doc = typeof document !== 'undefined' ? document : null, ...rest } = {}) {
  if (!doc?.createElement) return null;
  let renderer = null;
  try {
    const canvas = doc.createElement('canvas');
    canvas.width = Math.max(64, Math.round(width * dpr));
    canvas.height = Math.max(64, Math.round(height * dpr));
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(canvas.width, canvas.height, false);
    const result = await createCalibration({ renderer, gpu, tiers, maxMs, width: canvas.width, height: canvas.height, cssWidth: width, cssHeight: height, dpr, ...rest }).run();
    return result;
  } catch {
    return null;
  } finally {
    try {
      renderer?.dispose();
      renderer?.forceContextLoss?.();
    } catch { /* ignore */ }
  }
}

/**
 * Wires gpu + tier memory + (optional) calibration result + governor.
 * Options: game, tiers (ascending ids), pref ('auto' | a tier), viewport { w, h, dpr } (css px), gpu (a classification) | gl (a context to classify) | renderer string,
 *          calibration (result of runStandaloneCalibration / createCalibration().run()), storage / now (tests), callBudgets, tierCost, scaleMin, targetFps, ladder,
 *          governor: extra createGovernor options, onScale(scale, info), onTier(tier, info), onStable(info).
 */
export function createAdaptiveQuality(opts = {}) {
  const tiers = opts.tiers || TIER_ORDER;
  const viewport = opts.viewport || { w: 1280, h: 720, dpr: 1 };
  const gpu = opts.gpu || (opts.gl ? classifyGpu({ gl: opts.gl }) : opts.renderer ? classifyGpu({ renderer: opts.renderer }) : probeGpu() || classifyGpu({}));
  const vp = viewportClass(viewport.w, viewport.h, viewport.dpr);
  const memory = createTierMemory({ game: opts.game || 'game', storage: opts.storage, now: opts.now });
  const saved = memory.get(gpu.key, vp);
  const pref = opts.pref || 'auto';
  const initial = chooseInitialTier({ gpu, calibration: opts.calibration || null, memory: saved, pref, tiers });
  const failedTiers = tiers.filter((t) => memory.isFailed(gpu.key, vp, t));
  const governor = createGovernor({
    tiers,
    tier: initial.tier,
    scale: initial.scale,
    minTier: tiers[0],
    maxTier: initial.maxTier,
    lockTier: initial.lock,
    ladder: opts.ladder,
    scaleMin: opts.scaleMin,
    targetFps: opts.targetFps,
    callBudgets: opts.callBudgets,
    tierCost: opts.tierCost,
    failedTiers: initial.lock ? [] : failedTiers,
    refreshHz: opts.calibration?.refreshHz || opts.refreshHz || 0,
    ...opts.governor,
    onScale: (s, info) => opts.onScale?.(s, info),
    onTier: (t, info) => opts.onTier?.(t, info),
    onStable: (info) => {
      // an explicit player choice is not "what the machine can do": do not remember it
      if (!initial.lock) memory.set(gpu.key, vp, { tier: info.tier, scale: info.scale });
      opts.onStable?.(info);
    },
    onTierFailed: (tier) => {
      memory.markFailed(gpu.key, vp, tier);
      opts.onTierFailed?.(tier);
    },
  });
  return {
    gpu,
    vp,
    memory,
    saved,
    initial,
    governor,
    tiers,
    /** One line for the console / bug reports. */
    describe() {
      return `gfx: ${gpu.class} ${gpu.vendor} ${gpu.model} cap:${gpu.tierCap} -> start ${initial.tier}@${initial.scale} (${initial.source}${initial.reasons?.length ? ': ' + initial.reasons[0] : ''})`;
    },
    /** Forget the remembered result (the player changed the Graphics setting, or the hardware changed). */
    forget() {
      memory.forget(gpu.key, vp);
    },
  };
}

export { shouldCalibrate };
