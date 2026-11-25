// Tiffin Centre procedural noise and pixel-map helpers (pure JS, node-safe, no DOM).
// Tileable value / worley noise, fbm, a Sobel height -> normal-map converter and a packed "pixel buffer" builder.
// Maps are generated into typed arrays and uploaded as DataTextures (no canvas needed, works in a worker too).

const imul = Math.imul;

/** Integer hash -> [0,1). */
export function hash2(ix, iy, seed = 0) {
  let h = imul(ix, 374761393) + imul(iy, 668265263) + imul(seed | 0, 1442695041);
  h = imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);
const wrap = (i, p) => (p > 0 ? ((i % p) + p) % p : i);

/** Value noise, tileable when px / py (lattice periods) are given. */
export function vnoise(x, y, px = 0, py = 0, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const x0 = wrap(ix, px);
  const x1 = wrap(ix + 1, px);
  const y0 = wrap(iy, py);
  const y1 = wrap(iy + 1, py);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal value noise in ~[0,1]. */
export function fbm(x, y, oct = 4, px = 0, py = 0, seed = 0) {
  let s = 0;
  let a = 0.5;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x, y, px, py, seed + i * 31);
    norm += a;
    x *= 2;
    y *= 2;
    px *= 2;
    py *= 2;
    a *= 0.5;
  }
  return s / norm;
}

/** Worley F1 distance (in cell units), tileable with periods px / py. */
export function worley(x, y, px = 0, py = 0, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let d1 = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const wx = wrap(cx, px);
      const wy = wrap(cy, py);
      const ox = cx + hash2(wx, wy, seed) - x;
      const oy = cy + hash2(wx, wy, seed + 77) - y;
      const d = ox * ox + oy * oy;
      if (d < d1) d1 = d;
    }
  }
  return Math.sqrt(d1);
}

/** Deterministic PRNG (mulberry32). */
export function prng(seed = 1) {
  let a = seed >>> 0 || 1;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = imul(t ^ (t >>> 15), t | 1);
    t ^= t + imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  return f;
}

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Height field (Float32Array w*h, wraps at the borders) -> tangent-space normal map bytes (RGBA).
 * `strength` scales the slope; +y of the map points to increasing v (matches three's default flipY=false DataTexture rows).
 */
export function heightToNormal(h, w, hh, strength = 2) {
  const out = new Uint8Array(w * hh * 4);
  for (let y = 0; y < hh; y++) {
    const ym = ((y - 1 + hh) % hh) * w;
    const yp = ((y + 1) % hh) * w;
    const y0 = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      // Sobel
      const dx = h[ym + xp] + 2 * h[y0 + xp] + h[yp + xp] - h[ym + xm] - 2 * h[y0 + xm] - h[yp + xm];
      const dy = h[yp + xm] + 2 * h[yp + x] + h[yp + xp] - h[ym + xm] - 2 * h[ym + x] - h[ym + xp];
      let nx = -dx * strength * 0.25;
      let ny = -dy * strength * 0.25;
      const nz = 1;
      const il = 1 / Math.hypot(nx, ny, nz);
      nx *= il;
      ny *= il;
      const o = (y0 + x) * 4;
      out[o] = (nx * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * 0.5 + 0.5) * 255;
      out[o + 2] = (nz * il * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Evaluate `fn(u, v, out, x, y)` over a w*h grid. `out` = { r,g,b (albedo 0..1), h (height), rough, metal, ao }.
 * Returns typed buffers: albedo RGBA8, orm RGBA8 (R=ao, G=rough, B=metal), normal RGBA8.
 */
export function buildMaps(w, hgt, fn, { normalStrength = 2 } = {}) {
  const albedo = new Uint8Array(w * hgt * 4);
  const orm = new Uint8Array(w * hgt * 4);
  const height = new Float32Array(w * hgt);
  const o = { r: 0.5, g: 0.5, b: 0.5, h: 0, rough: 0.5, metal: 0, ao: 1 };
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      o.r = o.g = o.b = 0.5;
      o.h = 0;
      o.rough = 0.5;
      o.metal = 0;
      o.ao = 1;
      fn(x / w, y / hgt, o, x, y);
      const i = y * w + x;
      const p = i * 4;
      albedo[p] = clamp(o.r) * 255;
      albedo[p + 1] = clamp(o.g) * 255;
      albedo[p + 2] = clamp(o.b) * 255;
      albedo[p + 3] = 255;
      orm[p] = clamp(o.ao) * 255;
      orm[p + 1] = clamp(o.rough) * 255;
      orm[p + 2] = clamp(o.metal) * 255;
      orm[p + 3] = 255;
      height[i] = o.h;
    }
  }
  return { albedo, orm, normal: heightToNormal(height, w, hgt, normalStrength), height, w, h: hgt };
}

/** sRGB hex -> linear-ish 0..1 triple helper for pixel functions (kept in sRGB: albedo textures are tagged sRGB). */
export function hexRGB(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
