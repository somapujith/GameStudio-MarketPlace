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
export const QUALITY_ORDER = ['lite', 'low', 'medium', 'high'];

export const QUALITY = {
  lite: {
    pixelRatio: 1, shadow: 0, bloom: false, particles: 60, vehicles: 0, walkers: 2, lights: false, shelfDetail: 0.25, wires: false,
    post: false, msaa: 0, nativeAA: false, fxaa: false, ao: false, dof: false, grain: false, bloomScale: 0,
    bulbLights: 0, tubeLight: false, lampLights: 0, shafts: false, clouds: 0, stars: false, reflect: 'none', heat: false,
    envSize: 32, envInterval: 6, texSize: 128, birds: 0, decor: 0.25, normalMaps: false, shadowRadius: 1,
    // runtime / model knobs (read by renderer.js, loader.js and the models, not by the stall or the street)
    fpsCap: 30, scaleMin: 0.6, characters: 'lite', bakedCustomers: true, flatScenery: true, customerMeshBudget: 8, batchStatics: true,
  },
  low: {
    pixelRatio: 1, shadow: 0, bloom: false, particles: 140, vehicles: 4, walkers: 3, lights: false, shelfDetail: 0.5, wires: false,
    post: false, msaa: 0, nativeAA: true, fxaa: false, ao: false, dof: false, grain: false, bloomScale: 0,
    bulbLights: 0, tubeLight: false, lampLights: 0, shafts: false, clouds: 0, stars: false, reflect: 'none', heat: false,
    envSize: 64, envInterval: 2.5, texSize: 128, birds: 0, decor: 0.5, normalMaps: false, shadowRadius: 1,
    fpsCap: 0, scaleMin: 0.5, characters: 'low', bakedCustomers: true, flatScenery: false, customerMeshBudget: 8, batchStatics: true,
  },
  medium: {
    pixelRatio: 1.25, shadow: 1024, bloom: true, particles: 320, vehicles: 8, walkers: 6, lights: true, shelfDetail: 1, wires: true,
    post: true, msaa: 0, nativeAA: false, fxaa: true, ao: false, dof: false, grain: true, bloomScale: 0.5,
    bulbLights: 2, tubeLight: true, lampLights: 1, shafts: true, clouds: 1, stars: true, reflect: 'fake', heat: true,
    envSize: 128, envInterval: 0.6, texSize: 256, birds: 4, decor: 1, normalMaps: true, shadowRadius: 2,
    fpsCap: 0, scaleMin: 0.5, characters: 'medium', bakedCustomers: false, flatScenery: false, customerMeshBudget: 64, batchStatics: true,
  },
  high: {
    pixelRatio: 1.75, shadow: 2048, bloom: true, particles: 640, vehicles: 12, walkers: 10, lights: true, shelfDetail: 1, wires: true,
    post: true, msaa: 4, nativeAA: false, fxaa: false, ao: true, dof: true, grain: true, bloomScale: 0.5,
    bulbLights: 4, tubeLight: true, lampLights: 2, shafts: true, clouds: 2, stars: true, reflect: 'planar', heat: true,
    envSize: 256, envInterval: 0.2, texSize: 512, birds: 8, decor: 1.4, normalMaps: true, shadowRadius: 3,
    fpsCap: 0, scaleMin: 0.5, characters: 'high', bakedCustomers: false, flatScenery: false, customerMeshBudget: 64, batchStatics: false,
  },
};

/** Keys that are runtime knobs rather than a monotone "more is better" quality value (the tier test skips them). */
export const KNOB_KEYS = ['fpsCap', 'scaleMin', 'characters', 'bakedCustomers', 'flatScenery', 'customerMeshBudget', 'batchStatics'];

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

/**
 * Feed it frame times in seconds. `push(dt)` returns true once when roughly `windowSec` of play was mostly slow frames
 * (a step down is due). Hidden-tab hiccups (dt > maxDt) are ignored; a fresh window starts after every verdict.
 */
export function createQualitySampler({ slowDt = 0.034, windowSec = 2.5, badRatio = 0.5, maxDt = 0.25 } = {}) {
  let slow = 0;
  let total = 0;
  return {
    push(dt) {
      if (!(dt > 0) || dt > maxDt) return false;
      total += dt;
      if (dt > slowDt) slow += dt;
      if (total < windowSec) return false;
      const bad = slow / total > badRatio;
      slow = 0;
      total = 0;
      return bad;
    },
    reset() {
      slow = 0;
      total = 0;
    },
  };
}

/**
 * Dynamic resolution scaling. Feed `push(dt)` the frame time in seconds; it returns
 *   { scale }   when the render scale should change (1.0 down to `min`, in `step` steps, never back up past what was proven to hold),
 *   { tier: 1 } when scaling cannot help any more (already at the floor, or the first steps did not speed the frame up: CPU bound)
 *               and the tier should drop one step,
 *   null        otherwise.
 * Hysteresis: it scales down when the windowed mean frame time exceeds `budget`, and only scales back up after `upSec` of frames
 * well under `budget * upRatio`; an upscale that has to be undone counts as a flap (and lowers the ceiling), and after
 * `maxFlaps` flaps the scale is frozen (so a borderline device settles instead of oscillating). Never raises the tier.
 */
export function createScaler({ budget = 1 / 45, min = 0.5, step = 0.1, windowSec = 1.2, upSec = 6, upRatio = 0.62, cooldownSec = 1.5, maxFlaps = 2, maxDt = 1, minGain = 0.04 } = {}) {
  let scale = 1;
  let ceiling = 1; // the highest scale that has not been undone by a slowdown
  let flaps = 0;
  let frozen = false;
  let sum = 0;
  let n = 0;
  let span = 0;
  let cool = 0;
  let upClock = 0;
  let upSum = 0;
  let upN = 0;
  let lastDownMean = 0;
  let noGain = 0;
  let lastWasUp = false;
  const reset = () => {
    sum = 0;
    n = 0;
    span = 0;
  };
  return {
    get scale() { return scale; },
    get flaps() { return flaps; },
    get frozen() { return frozen; },
    setBudget(b) { budget = b; },
    /** After a tier change the old verdicts mean nothing: start over (the scale restarts at `to`). */
    restart(to = 1) {
      scale = to;
      ceiling = to;
      flaps = 0;
      frozen = false;
      noGain = 0;
      lastWasUp = false;
      lastDownMean = 0;
      cool = cooldownSec;
      upClock = 0;
      upSum = 0;
      upN = 0;
      reset();
    },
    push(dt) {
      if (!(dt > 0) || dt > maxDt) return null;
      if (cool > 0) {
        cool -= dt;
        return null;
      }
      sum += dt;
      n += 1;
      span += dt;
      upSum += dt;
      upN += 1;
      upClock += dt;
      if (span >= windowSec) {
        const mean = sum / n;
        reset();
        if (mean > budget) {
          upClock = 0;
          upSum = 0;
          upN = 0;
          if (lastWasUp) {
            // the upscale we just made did not hold: undo it for good (the ceiling drops) and count a flap
            flaps += 1;
            ceiling = Math.max(min, +(scale - step).toFixed(3));
            if (flaps >= maxFlaps) frozen = true;
            noGain = 0;
          } else if (lastDownMean && mean > lastDownMean * (1 - minGain)) noGain += 1;
          else noGain = 0;
          lastWasUp = false;
          if (scale > min + 1e-6 && noGain < 2) {
            lastDownMean = mean;
            scale = Math.max(min, +(scale - step).toFixed(3));
            cool = cooldownSec;
            return { scale };
          }
          // at the floor, or two downscales in a row bought nothing (the CPU is the limit): the tier is the only lever left
          lastDownMean = 0;
          noGain = 0;
          return { tier: 1 };
        }
      }
      if (!frozen && scale < 1 - 1e-6 && upClock >= upSec) {
        const mean = upSum / Math.max(1, upN);
        upClock = 0;
        upSum = 0;
        upN = 0;
        if (mean < budget * upRatio && scale + step <= ceiling + 1e-6) {
          scale = Math.min(1, +(scale + step).toFixed(3));
          lastWasUp = true;
          cool = cooldownSec;
          return { scale };
        }
      }
      return null;
    },
    get lastWasUp() { return lastWasUp; },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The draw-call guard
/**
 * Draw calls per frame each tier is designed for (`renderer.info.render.calls`, shadow pass and post passes included). Measured six-customer
 * counts at the time of writing: lite 189, low 293, medium 1147 (before the build-time merge), high 1379. A tier that stays over its budget
 * on a device that is also missing its frame budget is too heavy for that device, whatever the capability probe guessed.
 */
export const DRAW_CALL_BUDGET = { lite: 250, low: 350, medium: 700, high: 1000 };

/** The frame-time budget (seconds) the scaler and the guard hold a tier to: about 38 fps, or the tier's frame cap less 4 fps. */
export const frameBudgetFor = (cfg) => (cfg && cfg.fpsCap ? 1 / (cfg.fpsCap + 4) : 1 / 38);

/**
 * createDrawCallGuard({ budgets, overSec, ema, maxDt }) -> { push(dt, calls, tier, frameBudget) -> boolean, reset(), state }
 * Feed it every rendered frame: `dt` seconds, `calls` = draw calls of that frame, the current `tier` and its frame-time budget in seconds.
 * Returns true ONCE when a tier downgrade is due: the (smoothed) draw-call count has been above the tier's budget for `overSec` (2 s) AND the mean frame
 * time over those 2 s exceeded the frame budget. A fast machine that submits many calls but holds its frame rate is never punished; a count that dips back
 * under the budget restarts the clock. The lowest tier never asks (nothing to go down to). Auto quality only: the caller ignores it for an explicit tier.
 * It only ever requests a step DOWN.
 */
export function createDrawCallGuard({ budgets = DRAW_CALL_BUDGET, overSec = 2, ema = 0.15, maxDt = 1 } = {}) {
  let avg = 0;
  let span = 0;
  let sum = 0;
  let n = 0;
  const reset = () => {
    avg = 0;
    span = 0;
    sum = 0;
    n = 0;
  };
  return {
    reset,
    get state() { return { avg, span }; },
    push(dt, calls, tier, frameBudget = 1 / 38) {
      const budget = budgets[tier];
      if (!(dt > 0) || dt > maxDt || !(calls >= 0) || !budget || tier === QUALITY_ORDER[0]) {
        if (!budget || tier === QUALITY_ORDER[0]) reset();
        return false;
      }
      avg = avg ? avg + (calls - avg) * ema : calls;
      if (avg <= budget) {
        span = 0;
        sum = 0;
        n = 0;
        return false;
      }
      span += dt;
      sum += dt;
      n += 1;
      if (span < overSec) return false;
      const slow = sum / n > frameBudget;
      span = 0;
      sum = 0;
      n = 0;
      return slow;
    },
  };
}
