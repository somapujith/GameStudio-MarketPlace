// Procedural texture engine: SEAMLESS (periodic) noise fields, height -> normal maps, ORM packing and canvas upload.
// The numeric part (noise, fields, Sobel) is pure typed-array code and runs in node (unit tests); only the final upload needs a canvas,
// and when there is no `document` every map builder returns a tiny stub texture so factories stay constructible.
import { CanvasTexture, DataTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';
import { makeCanvas, onModelCacheReset, sharedTexture, texRes } from './util.js';

let paintable = null;
/** True when a 2D canvas is available (a browser). False in node / unit tests. */
export function canPaint() {
  if (paintable === null) {
    try {
      const c = makeCanvas(2, 2);
      paintable = !!(c && c.getContext && c.getContext('2d'));
    } catch {
      paintable = false;
    }
  }
  return paintable;
}

// ---------------------------------------------------------------------------------------------------------------------
// small helpers
export function mulberry32(seed) {
  let a = (seed | 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash2 = (x, y, s = 0) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export const smoothstep = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};
export const mix = (a, b, k) => a + (b - a) * k;
export const hexRGB = (hex) => {
  const n = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// ---------------------------------------------------------------------------------------------------------------------
// fields: Float32Array(N*N), row-major, y down. All generators are periodic with period N.
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient noise on a cx x cy lattice (cx cells across, cy cells down), range about [-1, 1]. Non-square lattices give streaks. */
export function perlin(N, cx, cy = cx, seed = 1) {
  cx = Math.max(1, Math.round(cx));
  cy = Math.max(1, Math.round(cy));
  const r = mulberry32(seed * 7919 + cx * 31 + cy * 17);
  const gx = new Float32Array(cx * cy);
  const gy = new Float32Array(cx * cy);
  for (let i = 0; i < cx * cy; i++) {
    const a = r() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const X0 = new Int32Array(N);
  const X1 = new Int32Array(N);
  const FX = new Float32Array(N);
  const SX = new Float32Array(N);
  for (let x = 0; x < N; x++) {
    const u = (x / N) * cx;
    const i = Math.floor(u);
    FX[x] = u - i;
    X0[x] = i % cx;
    X1[x] = (i + 1) % cx;
    SX[x] = fade(u - i);
  }
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const v = (y / N) * cy;
    const iy = Math.floor(v);
    const fy = v - iy;
    const y0 = (iy % cy) * cx;
    const y1 = ((iy + 1) % cy) * cx;
    const sy = fade(fy);
    for (let x = 0; x < N; x++) {
      const fx = FX[x];
      const a = X0[x] + y0;
      const b = X1[x] + y0;
      const c = X0[x] + y1;
      const d = X1[x] + y1;
      const n00 = gx[a] * fx + gy[a] * fy;
      const n10 = gx[b] * (fx - 1) + gy[b] * fy;
      const n01 = gx[c] * fx + gy[c] * (fy - 1);
      const n11 = gx[d] * (fx - 1) + gy[d] * (fy - 1);
      const sx = SX[x];
      const nx0 = n00 + (n10 - n00) * sx;
      const nx1 = n01 + (n11 - n01) * sx;
      out[y * N + x] = (nx0 + (nx1 - nx0) * sy) * 1.41;
    }
  }
  return out;
}

/** Stretches a field to [0, 1] (in place) and returns it. */
export function normalize01(f) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < f.length; i++) {
    const v = f[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const k = hi - lo > 1e-9 ? 1 / (hi - lo) : 0;
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) * k;
  return f;
}

/** Fractal noise in [0, 1]. cx / cy: first octave lattice; oct octaves; gain amplitude falloff; lac frequency step. */
export function fbm(N, { cx = 4, cy = cx, oct = 5, gain = 0.5, lac = 2, seed = 1 } = {}) {
  const out = new Float32Array(N * N);
  let amp = 1;
  for (let o = 0; o < oct; o++) {
    const fx = cx * lac ** o;
    const fy = cy * lac ** o;
    if (fx > N / 1.5 && fy > N / 1.5) break;
    const p = perlin(N, Math.min(fx, N / 2), Math.min(fy, N / 2), seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += p[i] * amp;
    amp *= gain;
  }
  return normalize01(out);
}

/** Cellular noise: returns { f1, f2 } (distance to the nearest / second nearest feature point, in cell units, clamped to [0, 1]). cx cells across. */
export function worley(N, cx, seed = 1, jitter = 1) {
  cx = Math.max(1, Math.round(cx));
  const r = mulberry32(seed * 104729 + cx);
  const px = new Float32Array(cx * cx);
  const py = new Float32Array(cx * cx);
  for (let i = 0; i < cx * cx; i++) {
    px[i] = 0.5 + (r() - 0.5) * jitter;
    py[i] = 0.5 + (r() - 0.5) * jitter;
  }
  const f1 = new Float32Array(N * N);
  const f2 = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const v = (y / N) * cx;
    const iy = Math.floor(v);
    for (let x = 0; x < N; x++) {
      const u = (x / N) * cx;
      const ix = Math.floor(u);
      let d1 = 9;
      let d2 = 9;
      for (let dy = -1; dy <= 1; dy++) {
        const cy = iy + dy;
        const wy = ((cy % cx) + cx) % cx;
        for (let dx = -1; dx <= 1; dx++) {
          const cxx = ix + dx;
          const wx = ((cxx % cx) + cx) % cx;
          const k = wy * cx + wx;
          const ddx = cxx + px[k] - u;
          const ddy = cy + py[k] - v;
          const d = ddx * ddx + ddy * ddy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
      }
      f1[y * N + x] = Math.min(1, Math.sqrt(d1));
      f2[y * N + x] = Math.min(1, Math.sqrt(d2));
    }
  }
  return { f1, f2 };
}

/** Per-texel white noise in [0, 1]. */
export function white(N, seed = 1) {
  const f = new Float32Array(N * N);
  const r = mulberry32(seed * 6151 + 3);
  for (let i = 0; i < f.length; i++) f[i] = r();
  return f;
}

/** 3x3 box blur with wrap (a few passes ~ gaussian). */
export function blur(f, N, passes = 1) {
  let a = f;
  let b = new Float32Array(f.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < N; y++) {
      const ym = ((y + N - 1) % N) * N;
      const y0 = y * N;
      const yp = ((y + 1) % N) * N;
      for (let x = 0; x < N; x++) {
        const xm = (x + N - 1) % N;
        const xp = (x + 1) % N;
        b[y0 + x] = (a[ym + xm] + a[ym + x] + a[ym + xp] + a[y0 + xm] + a[y0 + x] * 2 + a[y0 + xp] + a[yp + xm] + a[yp + x] + a[yp + xp]) / 10;
      }
    }
    const t = a;
    a = b;
    b = t === f ? new Float32Array(f.length) : t;
  }
  return a;
}

/** Draws wrapped thin lines (scratches) into a field: value `amount` is ADDED along each line. */
export function scratches(f, N, { count = 40, len = 0.15, angle = 0, spread = 0.4, amount = 0.5, seed = 1 } = {}) {
  const r = mulberry32(seed * 977 + 5);
  for (let i = 0; i < count; i++) {
    let x = r() * N;
    let y = r() * N;
    const a = angle + (r() - 0.5) * spread * Math.PI;
    const L = len * N * (0.4 + r() * 0.9);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const amt = amount * (0.4 + r() * 0.8);
    for (let s = 0; s < L; s++) {
      const ix = ((Math.round(x) % N) + N) % N;
      const iy = ((Math.round(y) % N) + N) % N;
      f[iy * N + ix] += amt;
      x += dx;
      y += dy;
    }
  }
  return f;
}

/** Stamps `n` soft round dents / dots (wrapped) into a field: value `amount` at the centre, radius in px. */
export function stamps(f, N, { count = 12, radius = 10, amount = 1, seed = 1, jitter = 0.5 } = {}) {
  const r = mulberry32(seed * 313 + 11);
  for (let i = 0; i < count; i++) {
    const cx = r() * N;
    const cy = r() * N;
    const rad = radius * (1 - jitter * 0.5 + r() * jitter);
    const amt = amount * (0.5 + r() * 0.6);
    const R = Math.ceil(rad);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy) / rad;
        if (d >= 1) continue;
        const ix = (((Math.round(cx) + dx) % N) + N) % N;
        const iy = (((Math.round(cy) + dy) % N) + N) % N;
        const k = 1 - d;
        f[iy * N + ix] += amt * k * k * (3 - 2 * k);
      }
    }
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------------------------
// maps
/** Height field -> tangent-space normal map (RGBA bytes, Sobel, periodic). `strength` ~ 1 subtle .. 6 deep. */
export function heightToNormal(h, N, strength = 2) {
  const out = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) {
    const ym = ((y + N - 1) % N) * N;
    const y0 = y * N;
    const yp = ((y + 1) % N) * N;
    for (let x = 0; x < N; x++) {
      const xm = (x + N - 1) % N;
      const xp = (x + 1) % N;
      const dx = h[ym + xp] + 2 * h[y0 + xp] + h[yp + xp] - (h[ym + xm] + 2 * h[y0 + xm] + h[yp + xm]);
      const dy = h[yp + xm] + 2 * h[yp + x] + h[yp + xp] - (h[ym + xm] + 2 * h[ym + x] + h[ym + xp]);
      let nx = -dx * strength;
      let ny = dy * strength; // canvas y points down, texture v points up
      const nz = 1;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= l;
      ny *= l;
      const o = (y0 + x) * 4;
      out[o] = (nx * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * 0.5 + 0.5) * 255;
      out[o + 2] = nz * l * 0.5 * 255 + 127.5;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Packs roughness (G) and metalness (B) fields (0..1; a number is a constant) into one RGBA map (R = occlusion 1). */
export function packORM(N, rough, metal = 0) {
  const out = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const o = i * 4;
    out[o] = 255;
    out[o + 1] = (typeof rough === 'number' ? rough : rough[i]) * 255;
    out[o + 2] = (typeof metal === 'number' ? metal : metal[i]) * 255;
    out[o + 3] = 255;
  }
  return out;
}

/** Fills an RGBA image from `fn(i, out, o)` which writes out[o..o+2]. */
export function paintImage(N, fn) {
  const out = new Uint8ClampedArray(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const o = i * 4;
    fn(i, out, o);
    out[o + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// upload
const STUBS = { white: [255, 255, 255, 255], normal: [128, 128, 255, 255], rough: [255, 200, 0, 255] };
export function stubTexture(kind = 'white') {
  const t = new DataTexture(new Uint8Array(STUBS[kind] || STUBS.white), 1, 1);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  t.userData.stub = true;
  return t;
}

/** RGBA bytes (N x N) -> a repeating mip-mapped CanvasTexture. In node returns a stub. */
export function imageTexture(N, rgba, { srgb = false, kind = 'white', anisotropy = 8 } = {}) {
  if (!canPaint()) return stubTexture(kind);
  const c = makeCanvas(N, N);
  const g = c.getContext('2d');
  g.putImageData(new ImageData(rgba, N, N), 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/** Draws with the 2D API into an N x M repeating mip-mapped texture (art, decals). In node returns a stub. `draw(ctx, w, h)`. */
export function drawnTexture(w, h, draw, { srgb = true, repeat = false, anisotropy = 8, kind = 'white' } = {}) {
  if (!canPaint()) return stubTexture(kind);
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = anisotropy;
  t.userData.redraw = () => {
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    t.needsUpdate = true;
  };
  t.needsUpdate = true;
  return t;
}

// A PBR set = { map, normalMap, roughnessMap (also the metalness map: G rough, B metal) }, built once per (key, size) and cached/shared.
const sets = new Map();
onModelCacheReset(() => sets.clear());
export const pbrSetCount = () => sets.size;

/** build(N) -> { albedo?: RGBA bytes, height?: Float32Array, normal?: RGBA bytes, normalStrength?, orm?: RGBA bytes } */
export function pbrSet(key, hero, build) {
  const N = texRes(hero);
  const k = `${key}@${N}`;
  const hit = sets.get(k);
  if (hit) return hit;
  let set;
  if (!canPaint()) {
    set = { map: stubTexture('white'), normalMap: stubTexture('normal'), roughnessMap: stubTexture('rough') };
    for (const [slot, t] of Object.entries(set)) set[slot] = sharedTexture(`${k}:${slot}`, () => t);
  } else {
    const o = build(N);
    const normal = o.normal || (o.height ? heightToNormal(o.height, N, o.normalStrength ?? 2) : null);
    set = {
      map: sharedTexture(`${k}:map`, () => imageTexture(N, o.albedo, { srgb: true })),
      normalMap: normal ? sharedTexture(`${k}:normal`, () => imageTexture(N, normal, { kind: 'normal' })) : null,
      roughnessMap: o.orm ? sharedTexture(`${k}:orm`, () => imageTexture(N, o.orm, { kind: 'rough' })) : null,
    };
  }
  sets.set(k, set);
  return set;
}
