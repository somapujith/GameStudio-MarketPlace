// Day-part lighting as pure curves of the continuous hour: sky colours, sun / moon direction and intensity, hemisphere light,
// fog, haze, wet road, bulb glow, neon and tube-light. Smooth (eased between hand-set keys, wrapping at 24), allocation-free
// when an `out` is passed. The renderer-side applier is light-apply.js.
import { lerp, smoothstep, clamp } from './interp.js';

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const COLS = ['top', 'mid', 'hor', 'sun', 'hs', 'hg', 'fog'];
const NUMS = ['si', 'hi', 'fd', 'bulb', 'neon', 'tube', 'night', 'exposure', 'env', 'haze', 'wet'];

// h: hour. top/mid/hor: sky; sun: key light; hs/hg: hemisphere sky/ground; fog: fog colour.
// si/hi: sun / hemi intensity; fd: fog density; bulb/neon/tube: lamps 0..1; night: 0..1; exposure; env: IBL strength;
// haze: how much the far skyline fades into the sky; wet: shine of the tarred road / puddles.
const SOURCE = [
  { h: 0, top: '#070b22', mid: '#101846', hor: '#2c2a66', sun: '#7f98e8', hs: '#2e3c86', hg: '#1c1a38', fog: '#1a2150', si: 0.55, hi: 0.8, fd: 0.016, bulb: 1, neon: 1, tube: 1, night: 1, exposure: 1.05, env: 0.28, haze: 0.12, wet: 0.85 },
  { h: 4.5, top: '#0e1740', mid: '#2a2c68', hor: '#6a4a86', sun: '#8fa0f0', hs: '#38458f', hg: '#241f40', fog: '#3a3870', si: 0.5, hi: 0.8, fd: 0.015, bulb: 1, neon: 1, tube: 1, night: 0.85, exposure: 1.05, env: 0.3, haze: 0.3, wet: 0.7 },
  { h: 5.7, top: '#4a5aa8', mid: '#e07a9a', hor: '#ffb087', sun: '#ff9fa0', hs: '#d8a0c0', hg: '#6a4a58', fog: '#e5a0a0', si: 1.4, hi: 0.85, fd: 0.011, bulb: 0.85, neon: 0.8, tube: 0.9, night: 0.3, exposure: 1.0, env: 0.5, haze: 0.5, wet: 0.45 },
  { h: 7, top: '#3a86d0', mid: '#f4b680', hor: '#ffd9a0', sun: '#ffc27a', hs: '#bcd0f0', hg: '#8a6a58', fog: '#f6d3a8', si: 2.5, hi: 1.0, fd: 0.008, bulb: 0.2, neon: 0.25, tube: 0.4, night: 0.05, exposure: 1.0, env: 0.85, haze: 0.4, wet: 0.1 },
  { h: 9, top: '#2f8ee0', mid: '#8ccdf0', hor: '#f4ead0', sun: '#ffe2b0', hs: '#c4dcf6', hg: '#8f7660', fog: '#efe3c8', si: 2.5, hi: 0.8, fd: 0.006, bulb: 0, neon: 0.05, tube: 0.1, night: 0, exposure: 1.0, env: 0.85, haze: 0.35, wet: 0 },
  { h: 12.5, top: '#2088e2', mid: '#7ac6f2', hor: '#e8f0ee', sun: '#fff8e8', hs: '#c6dcf2', hg: '#8f7a60', fog: '#ebe6d2', si: 2.45, hi: 0.7, fd: 0.0085, bulb: 0, neon: 0, tube: 0, night: 0, exposure: 0.98, env: 0.8, haze: 0.62, wet: 0 },
  { h: 15.5, top: '#2f86d8', mid: '#86c2e8', hor: '#f4e4c4', sun: '#fff0d0', hs: '#c8dcf4', hg: '#8f7660', fog: '#f0e0c0', si: 2.6, hi: 0.78, fd: 0.0075, bulb: 0, neon: 0.05, tube: 0.05, night: 0, exposure: 1.0, env: 0.85, haze: 0.5, wet: 0 },
  { h: 17.2, top: '#3f78c8', mid: '#e8a070', hor: '#ffc27a', sun: '#ffb060', hs: '#e0b890', hg: '#7a5648', fog: '#f2b98a', si: 2.4, hi: 0.95, fd: 0.009, bulb: 0.35, neon: 0.4, tube: 0.35, night: 0.08, exposure: 1.0, env: 0.8, haze: 0.38, wet: 0.2 },
  { h: 18.4, top: '#4a5aa8', mid: '#e07a58', hor: '#ff9a4a', sun: '#ff8a3a', hs: '#c89aa8', hg: '#5a4050', fog: '#e0804e', si: 1.7, hi: 0.85, fd: 0.012, bulb: 0.8, neon: 0.75, tube: 0.8, night: 0.25, exposure: 1.02, env: 0.6, haze: 0.28, wet: 0.55 },
  { h: 19.4, top: '#26307a', mid: '#8a3a88', hor: '#e0508a', sun: '#d070a0', hs: '#6a58b0', hg: '#3a2a58', fog: '#8a3a78', si: 0.9, hi: 0.8, fd: 0.015, bulb: 1, neon: 1, tube: 1, night: 0.65, exposure: 1.05, env: 0.4, haze: 0.2, wet: 0.8 },
  { h: 20.8, top: '#0a1030', mid: '#16184c', hor: '#3a2a70', sun: '#7f98e8', hs: '#2e3c86', hg: '#1c1a38', fog: '#1a2150', si: 0.55, hi: 0.8, fd: 0.016, bulb: 1, neon: 1, tube: 1, night: 0.97, exposure: 1.05, env: 0.3, haze: 0.14, wet: 0.9 },
];

function compile(k, hour) {
  const o = { h: hour };
  for (const c of COLS) o[c] = hex(k[c]);
  for (const n of NUMS) o[n] = k[n];
  return o;
}
// the closing key (24 h) is an exact copy of the first, so the day wraps with no jump
export const HOUR_KEYS = [...SOURCE.map((k) => compile(k, k.h)), compile(SOURCE[0], 24)];

export function makeLighting() {
  const out = { hour: 0, sunDir: [0, 1, 0] };
  for (const c of COLS) out[c] = [0, 0, 0];
  for (const n of NUMS) out[n] = 0;
  return out;
}

/** Direction TO the light (sun by day, moon by night): continuous across the whole 24 h. Writes [x,y,z] into out. */
export function sunDirection(hour, out = [0, 0, 0]) {
  const h = ((hour % 24) + 24) % 24;
  let el;
  let az;
  if (h >= 5.5 && h < 19.5) {
    const t = (h - 5.5) / 14;
    el = 8 + Math.sin(Math.PI * t) * 62;
    az = lerp(1.25, -1.25, t);
  } else {
    const t = ((h - 19.5 + 24) % 24) / 10;
    el = 8 + Math.sin(Math.PI * t) * 38;
    az = lerp(-1.25, 1.25, t);
  }
  const e = (el * Math.PI) / 180;
  const x = Math.sin(az) * Math.cos(e);
  const y = Math.sin(e);
  const z = 0.5 * Math.cos(e);
  const len = Math.hypot(x, y, z) || 1;
  out[0] = x / len;
  out[1] = y / len;
  out[2] = z / len;
  return out;
}

/** Everything the lights and materials need at `hour` (any real number; wraps at 24). */
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
  for (const n of NUMS) out[n] = lerp(a[n], b[n], t);
  sunDirection(h, out.sunDir);
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
