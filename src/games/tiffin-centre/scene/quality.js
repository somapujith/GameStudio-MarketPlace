// Quality tiers and the frame-time sampler that steps down on slow devices. Pure (no WebGL), unit-tested.
//
//   tier    post pipeline                                                shadows        real lights                 extras
//   low     none (direct render, native MSAA, ACES in the materials)      none           none (baked-looking pools)  cheap sky, no clouds / shafts / reflections
//   medium  HDR target + bloom (half res) + grade + vignette + grain +    1024 PCF       2 bulbs + tube + sodium     clouds, stars, shafts, fake wet reflections, heat haze
//           FXAA
//   high    MSAA 4 HDR target + GTAO-lite + bloom + depth of field +      2048 PCF       4 bulbs + tube + 2 sodium   everything above + planar wet road, PMREM refreshed often
//           grade + vignette + grain + chromatic fringe
export const QUALITY_ORDER = ['low', 'medium', 'high'];

export const QUALITY = {
  low: {
    pixelRatio: 1, shadow: 0, bloom: false, particles: 140, vehicles: 4, walkers: 3, lights: false, shelfDetail: 0.5, wires: false,
    post: false, msaa: 0, nativeAA: true, fxaa: false, ao: false, dof: false, grain: false, bloomScale: 0,
    bulbLights: 0, tubeLight: false, lampLights: 0, shafts: false, clouds: 0, stars: false, reflect: 'none', heat: false,
    envSize: 64, envInterval: 2.5, texSize: 128, birds: 0, decor: 0.5, normalMaps: false, shadowRadius: 1,
  },
  medium: {
    pixelRatio: 1.25, shadow: 1024, bloom: true, particles: 320, vehicles: 8, walkers: 6, lights: true, shelfDetail: 1, wires: true,
    post: true, msaa: 0, nativeAA: false, fxaa: true, ao: false, dof: false, grain: true, bloomScale: 0.5,
    bulbLights: 2, tubeLight: true, lampLights: 1, shafts: true, clouds: 1, stars: true, reflect: 'fake', heat: true,
    envSize: 128, envInterval: 0.6, texSize: 256, birds: 4, decor: 1, normalMaps: true, shadowRadius: 2,
  },
  high: {
    pixelRatio: 1.75, shadow: 2048, bloom: true, particles: 640, vehicles: 12, walkers: 10, lights: true, shelfDetail: 1, wires: true,
    post: true, msaa: 4, nativeAA: false, fxaa: false, ao: true, dof: true, grain: true, bloomScale: 0.5,
    bulbLights: 4, tubeLight: true, lampLights: 2, shafts: true, clouds: 2, stars: true, reflect: 'planar', heat: true,
    envSize: 256, envInterval: 0.2, texSize: 512, birds: 8, decor: 1.4, normalMaps: true, shadowRadius: 3,
  },
};

/** 'auto' / unknown -> a first guess from the device; an explicit tier is kept. */
export function pickQuality(requested, env = {}) {
  if (QUALITY_ORDER.includes(requested)) return requested;
  const cores = env.cores ?? (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ?? 4;
  const mobile = env.mobile ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  if (mobile) return 'low';
  return (cores || 4) >= 8 ? 'high' : 'medium';
}

export const lowerQuality = (q) => QUALITY_ORDER[Math.max(0, QUALITY_ORDER.indexOf(q) - 1)];

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
