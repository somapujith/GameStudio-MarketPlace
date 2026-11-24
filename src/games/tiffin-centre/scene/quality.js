// Quality tiers and the frame-time sampler that steps down on slow devices. Pure (no WebGL), unit-tested.
export const QUALITY_ORDER = ['low', 'medium', 'high'];

export const QUALITY = {
  low: { pixelRatio: 1, shadow: 0, bloom: false, particles: 140, vehicles: 4, walkers: 3, lights: false, shelfDetail: 0.5, wires: false },
  medium: { pixelRatio: 1.25, shadow: 1024, bloom: false, particles: 320, vehicles: 8, walkers: 5, lights: true, shelfDetail: 1, wires: true },
  high: { pixelRatio: 1.75, shadow: 2048, bloom: true, particles: 640, vehicles: 12, walkers: 8, lights: true, shelfDetail: 1, wires: true },
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
