// Quality tiers, the frame-time sampler and the dynamic resolution scaler. Pure (no WebGL), unit-tested. The device probe and the tier
// choice live in capabilities.js; this file owns the tier tables and the runtime adaptation.
//
//   tier    post pipeline                                                shadows        real lights                 extras
//   lite    none (direct render, no AA unless free), 30 fps cap           none           none (baked-looking pools)  no clouds / shafts / reflections / birds, merged customers,
//                                                                                                                     128 px textures, no normal maps, pixel ratio 1, minimal traffic
//   low     none (direct render, native MSAA, ACES in the materials)      none           none (baked-looking pools)  cheap sky, no clouds / shafts / reflections
//   medium  HDR target + bloom (half res) + grade + vignette + grain +    1024 PCF       2 bulbs + tube + sodium     clouds, stars, shafts, fake wet reflections, heat haze
//           FXAA
//   high    MSAA 4 HDR target + GTAO-lite + bloom + depth of field +      2048 PCF       4 bulbs + tube + 2 sodium   everything above + planar wet road, PMREM refreshed often
//           grade + vignette + grain + chromatic fringe
//
// Runtime knobs (not 'more is better' values): fpsCap (frame cap), scaleMin (the lowest dynamic-resolution scale: 0.7 on medium / high so the picture is never
// left blurry for a few fps, the tier is the lever after that), shadowEvery (the most frames between two redraws of the shadow map, see shadowEveryFor), the
// model knobs (characters, bakedCustomers, flatScenery, customerMeshBudget, batchStatics: statics are merged on every tier now). deviceTweaks() trims 'high' on an
// integrated GPU. Measured cost of each effect and what each tier gives on the dev laptop's integrated GPU: docs/perf/tf-gpu.md.
export const QUALITY_ORDER = ['lite', 'low', 'medium', 'high'];

export const QUALITY = {
  lite: {
    pixelRatio: 1, shadow: 0, bloom: false, particles: 60, vehicles: 0, walkers: 2, lights: false, shelfDetail: 0.25, wires: false,
    post: false, msaa: 0, nativeAA: false, fxaa: false, ao: false, dof: false, grain: false, bloomScale: 0,
    bulbLights: 0, tubeLight: false, lampLights: 0, lightPool: 0, shafts: false, clouds: 0, stars: false, reflect: 'none', heat: false,
    envSize: 32, envInterval: 6, texSize: 128, birds: 0, decor: 0.25, normalMaps: false, shadowRadius: 1,
    // runtime / model knobs (read by renderer.js, loader.js and the models, not by the stall or the street)
    fpsCap: 30, scaleMin: 0.6, characters: 'lite', bakedCustomers: true, flatScenery: true, customerMeshBudget: 8, batchStatics: true, shadowEvery: 1, hdr: 'half',
  },
  low: {
    pixelRatio: 1, shadow: 0, bloom: false, particles: 140, vehicles: 4, walkers: 3, lights: false, shelfDetail: 0.5, wires: false,
    post: false, msaa: 0, nativeAA: true, fxaa: false, ao: false, dof: false, grain: false, bloomScale: 0,
    bulbLights: 0, tubeLight: false, lampLights: 0, lightPool: 0, shafts: false, clouds: 0, stars: false, reflect: 'none', heat: false,
    envSize: 64, envInterval: 2.5, texSize: 128, birds: 0, decor: 0.5, normalMaps: false, shadowRadius: 1,
    fpsCap: 0, scaleMin: 0.5, characters: 'low', bakedCustomers: true, flatScenery: false, customerMeshBudget: 8, batchStatics: true, shadowEvery: 1, hdr: 'half',
  },
  medium: {
    pixelRatio: 1.25, shadow: 1024, bloom: true, particles: 320, vehicles: 8, walkers: 6, lights: true, shelfDetail: 1, wires: true,
    post: true, msaa: 0, nativeAA: false, fxaa: true, ao: false, dof: false, grain: true, bloomScale: 0.5,
    bulbLights: 2, tubeLight: true, lampLights: 1, lightPool: 3, shafts: true, clouds: 1, stars: true, reflect: 'fake', heat: true,
    envSize: 128, envInterval: 0.6, texSize: 256, birds: 4, decor: 1, normalMaps: true, shadowRadius: 2,
    // hdr 'r11': the scene's HDR colour in R11G11B10F (4 bytes a pixel, no alpha) instead of RGBA16F: half the traffic of the scene write and of every full-size read
    // (interleaved A/B, 6 pairs by day and night: the scene pass -1.0 ms by day and -1.4 ms at night, the bloom's first pass 0.55 -> 0.26 ms)
    fpsCap: 0, scaleMin: 0.7, characters: 'medium', bakedCustomers: false, flatScenery: false, customerMeshBudget: 64, batchStatics: true, shadowEvery: 3, hdr: 'r11',
  },
  high: {
    pixelRatio: 1.75, shadow: 2048, bloom: true, particles: 640, vehicles: 12, walkers: 10, lights: true, shelfDetail: 1, wires: true,
    post: true, msaa: 4, nativeAA: false, fxaa: false, ao: true, dof: true, grain: true, bloomScale: 0.5,
    bulbLights: 4, tubeLight: true, lampLights: 2, lightPool: 4, shafts: true, clouds: 2, stars: true, reflect: 'planar', heat: true,
    envSize: 256, envInterval: 0.2, texSize: 512, birds: 8, decor: 1.4, normalMaps: true, shadowRadius: 3,
    fpsCap: 0, scaleMin: 0.7, characters: 'high', bakedCustomers: false, flatScenery: false, customerMeshBudget: 64, batchStatics: true, shadowEvery: 2, hdr: 'half',
  },
};

/** Keys that are runtime knobs rather than a monotone "more is better" quality value (the tier test skips them). */
export const KNOB_KEYS = ['fpsCap', 'scaleMin', 'characters', 'bakedCustomers', 'flatScenery', 'customerMeshBudget', 'batchStatics', 'shadowEvery', 'hdr'];

/**
 * How many frames may pass between two redraws of the shadow map (the stall is static: only a few people move through it). `cfg.shadowEvery` is the most the
 * tier allows (1 = always every frame); the actual interval follows the smoothed frame time `dtAvg` (seconds): every frame while the tier holds ~36 fps or more,
 * every 2nd when frames are late (> 28 ms), every 3rd when they are very late (> 45 ms). `current` is the interval in use (a little hysteresis so it does not flip-flop).
 */
export function shadowEveryFor(cfg, dtAvg, current = 1) {
  const max = Math.max(1, cfg?.shadowEvery | 0 || 1);
  if (max <= 1 || !(dtAvg > 0)) return 1;
  // conservative: skipping redraws makes frames alternate between a dear one and a cheap one, which is only worth it when the game is already below ~36 fps
  const up2 = current >= 2 ? 0.024 : 0.028;
  const up3 = current >= 3 ? 0.038 : 0.045;
  const want = dtAvg > up3 ? 3 : dtAvg > up2 ? 2 : 1;
  return Math.min(max, want);
}

/**
 * Tier overrides for the device in front of us (`caps` from capabilities.probeBrowser). A tier is designed for the machines Auto gives it to: 'high' is
 * Auto's pick only for a discrete GPU, where 4x MSAA on a half-float target is fine. A player who FORCES 'high' on an integrated GPU (an identified GPU that is
 * not discrete) would get 8 fps from that, so there it keeps every effect but trades the 4x MSAA for FXAA, caps the pixel ratio at 1.1 and the shadow map at
 * 1536 (the picture is about as sharp, the frame is about a third of the cost). An unidentified GPU is left alone.
 */
export function deviceTweaks(caps) {
  if (!caps || !caps.renderer || caps.discreteGpu) return {};
  return { high: { msaa: 0, fxaa: true, pixelRatio: 1.1, shadow: 1536 } };
}

/** Applies deviceTweaks to the (shared) tier table and returns a function that puts the original values back. */
export function applyDeviceTweaks(caps, table = QUALITY) {
  const tweaks = deviceTweaks(caps);
  const saved = [];
  for (const [tier, over] of Object.entries(tweaks)) {
    if (!table[tier]) continue;
    for (const [k, v] of Object.entries(over)) {
      saved.push([tier, k, table[tier][k]]);
      table[tier][k] = v;
    }
  }
  return () => {
    for (const [tier, k, v] of saved.reverse()) table[tier][k] = v;
  };
}

export const tierIndex = (q) => QUALITY_ORDER.indexOf(q);
export const lowerQuality = (q) => QUALITY_ORDER[Math.max(0, tierIndex(q) - 1)];
export const minTier = (a, b) => (tierIndex(a) <= tierIndex(b) ? a : b);

/**
 * 'auto' / unknown -> a first guess from the device; an explicit tier is kept. `env` may carry the capability probe's verdict
 * (`env.tier`, from capabilities.chooseTier) or the two legacy hints (`cores`, `mobile`) used by tests and the first prototype.
 */
export function pickQuality(requested, env = {}) {
  if (QUALITY_ORDER.includes(requested)) return requested;
  if (QUALITY_ORDER.includes(env.tier)) return env.tier;
  const cores = env.cores ?? (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ?? 4;
  const mobile = env.mobile ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  if (mobile) return 'low';
  return (cores || 4) >= 8 ? 'high' : 'medium';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Shader compiles are not slowness
/**
 * createCompileHold({ holdSec }) -> { push(programCount, dt) -> boolean }
 * Feed it the number of compiled programs every frame. Returns true while the frame time must not be judged: a new program appeared in the last holdSec seconds (0.6 s by default)
 * (the first use of a program that is still linking blocks the main thread for 100 ms or more, and the loader's warm-up keeps compiling for about 16 s after the scene is
 * ready). Long frames in that window say nothing about what the device can render (the renderer skips them, the normal frames still count); without this the scaler walked the picture down to 0.5, or the tier down to low, during the warm-up.
 */
export function createCompileHold({ holdSec = 0.6 } = {}) {
  let last = -1;
  let left = 0;
  return {
    push(programCount, dt = 0) {
      if (last >= 0 && programCount !== last) left = holdSec;
      last = programCount;
      if (left > 0) {
        left -= Math.min(Math.max(dt, 0), 1); // the frame that uses up the last of the hold is held too
        return true;
      }
      return false;
    },
    get holding() { return left > 0; },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The draw-call budget and the shared frame governor's tables
/**
 * Draw calls per frame each tier is designed for (`renderer.info.render.calls`, shadow pass and post passes included). Measured six-customer
 * counts at the time of writing: lite 189, low 293, medium 1147 (before the build-time merge), high 1379. A tier that stays over its budget
 * on a device that is also missing its frame budget is too heavy for that device, whatever the capability probe guessed. (The governor enforces it.)
 */
export const DRAW_CALL_BUDGET = { lite: 250, low: 350, medium: 700, high: 1000 };

/** The key of this game's tier memory (src/platform/gfx/tierMemory.js): bump it when a release changes what a tier costs. */
export const GFX_GAME_KEY = 'tiffin-centre';

/**
 * The render-scale rungs the governor steps on. Dynamic resolution is free on the post tiers (no re-allocation), so the ladder is fine: 0.05 steps down to 0.7
 * (where a step is still visible but small), 0.1 below.
 */
export const SCALE_LADDER = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5];

/**
 * The lowest scale each tier may be pushed to before the tier itself is asked to drop: a lower tier is a much bigger loss of picture (no bloom, no shadows) and a
 * full rebuild, so the post tiers go further down the ladder than the old 0.7.
 */
export const SCALE_MIN = { lite: 0.6, low: 0.5, medium: 0.6, high: 0.6 };

/** Relative cost of a tier for the governor's tier-up prediction and for the scale a tier change resumes at (measured: see docs/perf/tf-int.md). */
export const TIER_COST = { lite: 1, low: 1.6, medium: 3.3, high: 3.9 };

/**
 * What one frame of each tier asks of the machine, in the units the start-up calibration measures (src/platform/gfx/calibrate.js): `layers` = shaded overdraw at the
 * tier's pixel ratio, `calls` = draw calls in simple-call equivalents, `mtris` = million triangles, `post` = full-screen passes, `scaleMin`. Validated against measured
 * frame times on the dev laptop's integrated GPU (docs/perf/tf-int.md section "tier cost model").
 */
export const TIFFIN_TIER_MODELS = {
  lite: { pixelRatio: 1, layers: 1.5, calls: 190, mtris: 0.1, post: 0, scaleMin: SCALE_MIN.lite },
  low: { pixelRatio: 1, layers: 2.5, calls: 240, mtris: 0.15, post: 0, scaleMin: SCALE_MIN.low },
  medium: { pixelRatio: 1.25, layers: 3.5, calls: 420, mtris: 0.25, post: 3, scaleMin: SCALE_MIN.medium },
  high: { pixelRatio: 1.75, layers: 5, calls: 900, mtris: 0.4, post: 7, scaleMin: SCALE_MIN.high },
};

/**
 * Measured cost of each tier on the reference machine (the dev laptop's integrated AMD Radeon, 1920x1080 drawing buffer, GPU timer medians of whole frames, day and
 * night averaged): `fixedMs` the part that does not move with the render scale (draw submission, shadow pass, FXAA at canvas size), `mpxMs` ms per million RENDERED
 * pixels. `REF_UNITS` are the calibration units (fill ns / pixel, ms / draw-call equivalent) that machine measured at: another machine's frame is these two numbers
 * scaled by how much faster or slower ITS calibration was. The shared `estimateFrameMs` takes max(cpu, gpu) and so cannot express "a fixed cost plus a pixel cost", which
 * is what these frames are (the CPU's draw submission and the GPU's work serialise through the driver); this table is what Tiffin's start tier is chosen from.
 */
export const REF_UNITS = { fillNsPerPx: 0.55, callUs: 3.0 };
export const TIER_REF = {
  lite: { fixedMs: 4.5, mpxMs: 1.5 },
  low: { fixedMs: 6.5, mpxMs: 2.2 },
  medium: { fixedMs: 10, mpxMs: 4 }, // day, 13:00: the scene pass 6.7 ms + 5.1 ms / Mpx, the post passes 1.7 ms + 0.8 / Mpx, FXAA 2.2 ms flat (measured: docs/perf/tf-int.md)
  high: { fixedMs: 17, mpxMs: 2.6 },
};

/** Estimated frame ms of `tier` at `scale` for a viewport { w, h, dpr } (css px) on a machine whose calibration measured `units` ({ fillNsPerPx, callUs }). */
export function estimateTierMs(units, tier, viewport, scale = 1, table = TIER_REF) {
  const ref = table[tier];
  if (!ref) return Infinity;
  const pr = Math.max(0.25, Math.min(QUALITY[tier]?.pixelRatio ?? 1, viewport.dpr || 1));
  const mpx = (viewport.w * viewport.h * pr * pr * scale * scale) / 1e6;
  // the calibration runs on a machine that is also doing other things (the loading screen, other tabs, other programs): a single reading swings by 30 to 40 %, and a
  // tier chosen from a transient poisons tier memory for weeks. The factors are therefore bounded: a machine can be judged 1.6x slower at submitting calls and 3x slower
  // at filling pixels than the reference, not more (a really weak machine is that slow, and the governor does the rest from real frames)
  const pixel = Math.min(3, Math.max(0.3, (units?.fillNsPerPx || REF_UNITS.fillNsPerPx) / REF_UNITS.fillNsPerPx));
  const call = Math.min(1.6, Math.max(0.4, (units?.callUs || REF_UNITS.callUs) / REF_UNITS.callUs));
  return ref.fixedMs * call + ref.mpxMs * mpx * pixel;
}

/**
 * The tier and scale to START on from a calibration: the highest tier (not above `capTier`) whose frame fits `budgetMs * headroom` at a scale of at least `goodScale`
 * (0.6, the post tiers' floor: a post tier at 0.6 beats the plain tier at 1.0, the picture and not the pixels is what a tier is; the governor lowers the TIER from real
 * frames, never from one calibration run), at the highest ladder scale that fits; else the highest tier that
 * fits at its floor; else the lowest tier at its floor. Returns { tier, scale, ms, estimates, reasons, confident }.
 */
export function recommendStart({ units, viewport, capTier = 'high', budgetMs = 1000 / 60, goodScale = 0.6, headroom = 0.9, ladder = SCALE_LADDER, confident = true }) {
  const est = {};
  const reasons = [];
  const top = Math.max(0, QUALITY_ORDER.indexOf(capTier));
  let anyFit = null;
  for (let i = top; i >= 0; i--) {
    const tier = QUALITY_ORDER[i];
    const floor = SCALE_MIN[tier];
    est[tier] = Math.round(estimateTierMs(units, tier, viewport, 1) * 10) / 10;
    let fit = null;
    for (const s of ladder) {
      if (s < floor - 1e-6) continue;
      const ms = estimateTierMs(units, tier, viewport, s);
      if (ms <= budgetMs * headroom) {
        fit = { tier, scale: s, ms };
        break;
      }
    }
    if (fit && fit.scale >= Math.max(floor, goodScale) - 1e-6) {
      reasons.push(`${tier} fits ${budgetMs.toFixed(1)} ms at scale ${fit.scale} (est. ${fit.ms.toFixed(1)} ms)`);
      return { tier, scale: fit.scale, ms: fit.ms, estimates: est, reasons, confident };
    }
    if (fit && !anyFit) anyFit = fit;
    reasons.push(fit ? `${tier} only fits at scale ${fit.scale}` : `${tier} does not fit ${budgetMs.toFixed(1)} ms even at its floor`);
  }
  if (anyFit) return { tier: anyFit.tier, scale: anyFit.scale, ms: anyFit.ms, estimates: est, reasons, confident };
  return { tier: QUALITY_ORDER[0], scale: SCALE_MIN[QUALITY_ORDER[0]], ms: estimateTierMs(units, QUALITY_ORDER[0], viewport, SCALE_MIN[QUALITY_ORDER[0]]), estimates: est, reasons, confident };
}

/**
 * The governor's policy for this game (see docs/GFX_ENGINE.md section 6.2): `downRatio` how far over the frame budget the windowed mean may sit before the scale
 * steps down (a vsync-locked 60 Hz display reads 1.00, so 1.04 never trips on a held frame rate and keeps an unlocked benchmark within ~58 fps); `tierDownRatio` how
 * slow the frame must be before the TIER drops (1.6 x 16.7 = 27 ms, about 37 fps: a lower tier is a much bigger loss of picture than a slow-ish frame, and a CPU-bound
 * medium at 40 fps keeps its bloom, shadows and lights);
 * `upRatio` how far under the budget a predicted frame must be before the scale steps up; `loadHoldMs` / `tierHoldMs` how long the governor ignores frames after the
 * load / after a tier change.
 */
export const GOVERNOR_OPTIONS = { downRatio: 1.04, tierDownRatio: 1.6, loadHoldMs: 3000, tierHoldMs: 2500, warmHoldMs: 1500 };
