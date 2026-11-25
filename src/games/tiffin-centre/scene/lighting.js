// Day-part lighting as pure curves of the continuous clock hour (6:00 .. 24:00 is a level; the whole 24 h wraps). Everything the
// renderer, the sky, the post pipeline and the lamps need comes out of ONE snapshot (`lightingAt`): sky colours, sun / moon
// direction and strength, hemisphere, fog, exposure, lamp on-ness (bulbs, tube, sodium street lights, neon), shadow strength,
// light shafts, heat haze, bloom, colour grade, grain, vignette. Smooth (eased between hand-set keys, wrapping at 24), allocation-free
// when an `out` is passed. Pure: no three, no DOM. The renderer-side applier is light-apply.js.
//
// Hyderabad (17.4 N): sunrise ~6:00, noon sun high and hard, sunset ~18:30, a short blue hour, then sodium-lit night.
import { lerp, smoothstep, clamp } from './interp.js';

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const SUNRISE = 6.0;
export const SUNSET = 18.5;

// colour channels given as #hex (sRGB), blended in sRGB space (perceptual)
const COLS = ['top', 'mid', 'hor', 'sun', 'hs', 'hg', 'fog', 'cloud'];
// small vectors given as [r,g,b] numbers: colour-grade lift (shadows) and gain (highlights)
const VECS = ['gl', 'gg'];
const NUMS = [
  'si', 'hi', 'fd', 'bulb', 'neon', 'tube', 'night', 'exposure', 'env', 'haze', 'wet',
  'sodium', 'shadow', 'shaft', 'stars', 'cover', 'glow', 'sat', 'contrast', 'bloom', 'thr', 'grain', 'vig', 'heat',
];

// h: hour. top/mid/hor: sky (zenith / mid / horizon); sun: key light colour (sun by day, moon by night); hs/hg: hemisphere sky / ground
// bounce; fog: fog colour; cloud: sunlit cloud colour. gl/gg: grade lift / gain.
// si/hi: key / hemisphere intensity; fd: fog density (exp2); bulb/neon/tube/sodium: lamp strength 0..1; night: 0..1; exposure; env: image-based
// light strength; haze: how much far things fade into the sky; wet: shine of the tarred road; shadow: sun-shadow darkness 0..1; shaft: light
// shafts through the roof gaps 0..1; stars; cover: cloud cover 0..1; glow: aureole round the sun; sat/contrast: grade; bloom/thr: bloom strength
// and threshold; grain; vig: vignette; heat: heat shimmer at the horizon.
const SOURCE = [
  { h: 0, top: '#04081a', mid: '#0a1230', hor: '#231f3e', sun: '#86a0e8', hs: '#27336b', hg: '#1a1830', fog: '#14193a', cloud: '#2a3260',
    gl: [0, 0.006, 0.03], gg: [0.94, 0.98, 1.06], si: 0.3, hi: 0.5, fd: 0.0065, bulb: 1, neon: 1, tube: 1, night: 1, exposure: 1.08, env: 0.2, haze: 0.18, wet: 0.88,
    sodium: 1, shadow: 0.55, shaft: 0, stars: 1, cover: 0.25, glow: 0, sat: 0.92, contrast: 1.1, bloom: 0.5, thr: 0.8, grain: 0.055, vig: 0.36, heat: 0 },
  { h: 4.6, top: '#0a1233', mid: '#222a64', hor: '#59487c', sun: '#8fa0f0', hs: '#34408c', hg: '#221e3e', fog: '#2f3068', cloud: '#4a4c8a',
    gl: [0, 0.008, 0.03], gg: [0.96, 0.98, 1.04], si: 0.32, hi: 0.52, fd: 0.0068, bulb: 1, neon: 1, tube: 1, night: 0.88, exposure: 1.08, env: 0.22, haze: 0.28, wet: 0.74,
    sodium: 1, shadow: 0.55, shaft: 0, stars: 0.8, cover: 0.3, glow: 0, sat: 0.94, contrast: 1.08, bloom: 0.45, thr: 0.8, grain: 0.05, vig: 0.34, heat: 0 },
  { h: 5.6, top: '#3a4a92', mid: '#c4709a', hor: '#ffa07c', sun: '#ff9b86', hs: '#c89cc4', hg: '#5e4658', fog: '#dc9a98', cloud: '#ffb89a',
    gl: [0.004, 0.006, 0.022], gg: [1.06, 0.97, 0.9], si: 0.9, hi: 0.95, fd: 0.0075, bulb: 0.9, neon: 0.85, tube: 0.92, night: 0.35, exposure: 1.1, env: 0.5, haze: 0.5, wet: 0.55,
    sodium: 0.55, shadow: 0.7, shaft: 0.0, stars: 0.15, cover: 0.3, glow: 0.5, sat: 0.98, contrast: 1.04, bloom: 0.38, thr: 0.85, grain: 0.04, vig: 0.3, heat: 0 },
  { h: 6.25, top: '#4c82cc', mid: '#f3b28a', hor: '#ffc284', sun: '#ff9d52', hs: '#d8b4c0', hg: '#7a5648', fog: '#f4c9a0', cloud: '#ffd2a0',
    gl: [0.004, 0.004, 0.012], gg: [1.1, 0.98, 0.86], si: 2.2, hi: 0.95, fd: 0.0078, bulb: 0.55, neon: 0.55, tube: 0.7, night: 0.1, exposure: 1.06, env: 0.7, haze: 0.5, wet: 0.35,
    sodium: 0.2, shadow: 0.82, shaft: 0.8, stars: 0, cover: 0.3, glow: 0.8, sat: 1.04, contrast: 1.04, bloom: 0.3, thr: 0.9, grain: 0.032, vig: 0.26, heat: 0 },
  { h: 7.2, top: '#3d86d2', mid: '#9ccaee', hor: '#ffe0b4', sun: '#ffc87e', hs: '#c0d4f2', hg: '#8a6c58', fog: '#f4dcb6', cloud: '#fff0dc',
    gl: [0.002, 0.003, 0.008], gg: [1.07, 1.0, 0.9], si: 3.1, hi: 1.0, fd: 0.0062, bulb: 0.12, neon: 0.2, tube: 0.3, night: 0, exposure: 1.0, env: 0.9, haze: 0.4, wet: 0.08,
    sodium: 0, shadow: 0.92, shaft: 0.8, stars: 0, cover: 0.3, glow: 0.45, sat: 1.08, contrast: 1.05, bloom: 0.22, thr: 1.0, grain: 0.028, vig: 0.22, heat: 0 },
  { h: 9.5, top: '#2a84e0', mid: '#86c8f0', hor: '#f2eacc', sun: '#ffe8bc', hs: '#c4dcf8', hg: '#8f7660', fog: '#eee6d0', cloud: '#ffffff',
    gl: [0, 0, 0.004], gg: [1.03, 1.0, 0.95], si: 3.6, hi: 0.9, fd: 0.0048, bulb: 0, neon: 0.05, tube: 0.08, night: 0, exposure: 0.96, env: 0.95, haze: 0.34, wet: 0,
    sodium: 0, shadow: 1, shaft: 0.1, stars: 0, cover: 0.35, glow: 0.3, sat: 1.04, contrast: 1.06, bloom: 0.18, thr: 1.05, grain: 0.024, vig: 0.2, heat: 0.1 },
  { h: 12.4, top: '#1c80e0', mid: '#74c0f0', hor: '#e8f0ee', sun: '#fff9ee', hs: '#c6dcf4', hg: '#938060', fog: '#e8e6d6', cloud: '#ffffff',
    gl: [0, 0, 0], gg: [1.0, 1.0, 0.99], si: 4.1, hi: 0.85, fd: 0.0052, bulb: 0, neon: 0, tube: 0, night: 0, exposure: 0.9, env: 0.9, haze: 0.6, wet: 0,
    sodium: 0, shadow: 1, shaft: 0, stars: 0, cover: 0.3, glow: 0.2, sat: 0.97, contrast: 1.1, bloom: 0.2, thr: 1.1, grain: 0.02, vig: 0.18, heat: 1 },
  { h: 15.5, top: '#2884dc', mid: '#80c0ea', hor: '#f2e6c8', sun: '#fff0d2', hs: '#c8dcf4', hg: '#8f7660', fog: '#efe2c4', cloud: '#fffaf0',
    gl: [0, 0, 0.002], gg: [1.03, 1.0, 0.96], si: 3.7, hi: 0.88, fd: 0.0052, bulb: 0, neon: 0.05, tube: 0.05, night: 0, exposure: 0.94, env: 0.9, haze: 0.5, wet: 0,
    sodium: 0, shadow: 1, shaft: 0, stars: 0, cover: 0.3, glow: 0.3, sat: 1.03, contrast: 1.08, bloom: 0.2, thr: 1.05, grain: 0.022, vig: 0.2, heat: 0.7 },
  { h: 17.3, top: '#3d78cc', mid: '#e4a674', hor: '#ffc684', sun: '#ffb264', hs: '#e0bc94', hg: '#7a5648', fog: '#f0bc8c', cloud: '#ffd8a8',
    gl: [0.002, 0.004, 0.012], gg: [1.1, 0.98, 0.82], si: 3.0, hi: 0.95, fd: 0.0064, bulb: 0.35, neon: 0.4, tube: 0.4, night: 0.06, exposure: 0.98, env: 0.8, haze: 0.38, wet: 0.2,
    sodium: 0.1, shadow: 0.95, shaft: 0.9, stars: 0, cover: 0.35, glow: 0.8, sat: 1.1, contrast: 1.06, bloom: 0.26, thr: 0.98, grain: 0.028, vig: 0.24, heat: 0.15 },
  { h: 18.45, top: '#4a5aa8', mid: '#e07a58', hor: '#ff9442', sun: '#ff8032', hs: '#c89aa8', hg: '#5a4050', fog: '#e0804e', cloud: '#ff9a62',
    gl: [0.004, 0.006, 0.02], gg: [1.1, 0.95, 0.78], si: 1.5, hi: 0.9, fd: 0.0072, bulb: 0.85, neon: 0.8, tube: 0.85, night: 0.25, exposure: 1.04, env: 0.6, haze: 0.28, wet: 0.55,
    sodium: 0.55, shadow: 0.7, shaft: 0.55, stars: 0, cover: 0.35, glow: 1, sat: 1.12, contrast: 1.07, bloom: 0.36, thr: 0.9, grain: 0.034, vig: 0.28, heat: 0 },
  { h: 19.3, top: '#232c78', mid: '#8a3a88', hor: '#e0508a', sun: '#c06ea8', hs: '#6a58b0', hg: '#3a2a58', fog: '#7a3874', cloud: '#a050a0',
    gl: [0.002, 0.006, 0.028], gg: [1.05, 0.96, 0.92], si: 0.6, hi: 0.7, fd: 0.0074, bulb: 1, neon: 1, tube: 1, night: 0.7, exposure: 1.1, env: 0.32, haze: 0.2, wet: 0.82,
    sodium: 0.95, shadow: 0.55, shaft: 0, stars: 0.2, cover: 0.3, glow: 0.4, sat: 1.0, contrast: 1.09, bloom: 0.46, thr: 0.82, grain: 0.045, vig: 0.32, heat: 0 },
  { h: 20.7, top: '#080e2c', mid: '#121848', hor: '#312a62', sun: '#86a0e8', hs: '#2a3880', hg: '#1c1a3a', fog: '#181f50', cloud: '#2e3668',
    gl: [0, 0.006, 0.03], gg: [0.95, 0.98, 1.05], si: 0.3, hi: 0.5, fd: 0.0066, bulb: 1, neon: 1, tube: 1, night: 0.98, exposure: 1.08, env: 0.2, haze: 0.16, wet: 0.9,
    sodium: 1, shadow: 0.55, shaft: 0, stars: 0.9, cover: 0.25, glow: 0, sat: 0.93, contrast: 1.1, bloom: 0.5, thr: 0.8, grain: 0.054, vig: 0.35, heat: 0 },
];

function compile(k, hour) {
  const o = { h: hour };
  for (const c of COLS) o[c] = hex(k[c]);
  for (const v of VECS) o[v] = k[v];
  for (const n of NUMS) o[n] = k[n];
  return o;
}
// the closing key (24 h) is an exact copy of the first, so the day wraps with no jump
export const HOUR_KEYS = [...SOURCE.map((k) => compile(k, k.h)), compile(SOURCE[0], 24)];

export function makeLighting() {
  const out = { hour: 0, sunDir: [0, 1, 0], sunTrue: [0, 1, 0], sunEl: 0 };
  for (const c of COLS) out[c] = [0, 0, 0];
  for (const v of VECS) out[v] = [0, 0, 0];
  for (const n of NUMS) out[n] = 0;
  return out;
}

const D2R = Math.PI / 180;

/**
 * Direction TO the key light (sun by day, moon by night): continuous across the whole 24 h, never below 8 degrees and always from
 * the cook's side (+z) so faces at the counter are lit. Writes [x,y,z] into out.
 */
export function sunDirection(hour, out = [0, 0, 0]) {
  const h = ((hour % 24) + 24) % 24;
  let el;
  let az;
  if (h >= SUNRISE && h < SUNSET) {
    const t = (h - SUNRISE) / (SUNSET - SUNRISE);
    el = 8 + Math.sin(Math.PI * t) * 62;
    az = lerp(1.25, -1.25, t);
  } else {
    const t = ((h - SUNSET + 24) % 24) / (24 - SUNSET + SUNRISE);
    el = 8 + Math.sin(Math.PI * t) * 38;
    az = lerp(-1.25, 1.25, t);
  }
  return dirFrom(az, el * D2R, out);
}

function dirFrom(az, e, out) {
  const x = Math.sin(az) * Math.cos(e);
  const y = Math.sin(e);
  const z = 0.5 * Math.cos(e);
  const len = Math.hypot(x, y, z) || 1;
  out[0] = x / len;
  out[1] = y / len;
  out[2] = z / len;
  return out;
}

/** True elevation of the sun in degrees (negative at night): 0 at SUNRISE and SUNSET, 72 at midday. */
export function sunElevation(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= SUNRISE && h < SUNSET) return 72 * Math.sin((Math.PI * (h - SUNRISE)) / (SUNSET - SUNRISE));
  const t = ((h - SUNSET + 24) % 24) / (24 - SUNSET + SUNRISE);
  return -38 * Math.sin(Math.PI * t);
}

/** Direction to the real sun (may be below the horizon: the sky shader draws the disc and its glow from it). */
export function trueSunDirection(hour, out = [0, 0, 0]) {
  const h = ((hour % 24) + 24) % 24;
  let az;
  if (h >= SUNRISE && h < SUNSET) az = lerp(1.25, -1.25, (h - SUNRISE) / (SUNSET - SUNRISE));
  else az = lerp(-1.25, 1.25, ((h - SUNSET + 24) % 24) / (24 - SUNSET + SUNRISE));
  return dirFrom(az, sunElevation(h) * D2R, out);
}

/** Everything the lights, sky, materials and post pipeline need at `hour` (any real number; wraps at 24). */
export function lightingAt(hour, out = makeLighting()) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < HOUR_KEYS.length - 2 && h >= HOUR_KEYS[i + 1].h) i++;
  const a = HOUR_KEYS[i];
  const b = HOUR_KEYS[i + 1];
  const t = smoothstep((h - a.h) / (b.h - a.h));
  out.hour = h;
  for (const c of COLS) {
    const o = out[c];
    o[0] = lerp(a[c][0], b[c][0], t);
    o[1] = lerp(a[c][1], b[c][1], t);
    o[2] = lerp(a[c][2], b[c][2], t);
  }
  for (const v of VECS) {
    const o = out[v];
    o[0] = lerp(a[v][0], b[v][0], t);
    o[1] = lerp(a[v][1], b[v][1], t);
    o[2] = lerp(a[v][2], b[v][2], t);
  }
  for (const n of NUMS) out[n] = lerp(a[n], b[n], t);
  sunDirection(h, out.sunDir);
  trueSunDirection(h, out.sunTrue);
  out.sunEl = sunElevation(h);
  return out;
}

/**
 * Tube-light multiplier 0..1. Off by day; at night it is on with the odd stutter (a slow warm-up flicker and a dip).
 * Deterministic in t, so it is the same for everyone and testable.
 */
export function tubeFlicker(t, on) {
  if (on <= 0.02) return 0;
  const s = Math.sin(t * 37.3) * Math.sin(t * 11.1 + 1.7) * Math.sin(t * 5.3);
  const dip = s > 0.62 ? 0.35 : 1;
  const hum = 0.96 + 0.04 * Math.sin(t * 100);
  return clamp(on * dip * hum, 0, 1);
}

/** Sodium street lamps: a slow, slightly uneven warm-up (they never flicker like the tube); 0..1. */
export function sodiumGlow(t, on) {
  if (on <= 0.01) return 0;
  return clamp(on * (0.94 + 0.04 * Math.sin(t * 0.7) + 0.02 * Math.sin(t * 9.1)), 0, 1);
}
