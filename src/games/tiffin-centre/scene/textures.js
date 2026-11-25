// Procedural texture toolkit (no image assets: the hub CSP forbids external ones).
//  * canvas helpers for text and painted signs (CanvasTexture), safe in node (they fall back to a 1x1 texture);
//  * tileable noise fields (fbm, worley / cracks), height -> tangent-space normal, and PBR bundles (albedo + normal + ORM) baked from
//    pixel arrays so a photographic surface (brushed steel, peeling paint, worn concrete, asphalt, rusty tin) costs three small textures.
import {
  CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, SRGBColorSpace, UnsignedByteType,
} from 'three';

/** A seeded little PRNG so painted textures look the same on every device and every run. */
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hasDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const blank = (srgb = true) => {
  const t = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.needsUpdate = true;
  t.userData.redraw = () => {};
  return t;
};

/** Wrap a canvas in a texture. `draw(g, w, h)` runs once now; call `redraw()` on the result to paint again (e.g. after fonts load). */
export function canvasTexture(w, h, draw, { repeat = null, srgb = true, anisotropy = 4, mip = true } = {}) {
  if (!hasDom()) return blank(srgb);
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.minFilter = mip ? LinearMipmapLinearFilter : LinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = anisotropy;
  t.generateMipmaps = mip;
  if (repeat) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.userData.redraw = () => {
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    t.needsUpdate = true;
  };
  return t;
}

/** Sprinkle noise specks over a canvas (rust, dust, grain). */
export function speckle(g, w, h, n, colour, size = [1, 3], rnd = Math.random) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = typeof colour === 'function' ? colour(rnd) : colour;
    const s = size[0] + rnd() * (size[1] - size[0]);
    g.fillRect(rnd() * w, rnd() * h, s, s);
  }
}

export const FONT_UI = '"Bricolage Grotesque Variable", "Bricolage Grotesque", Impact, "Arial Black", sans-serif';
export const FONT_TE = '"Noto Sans Telugu Variable", "Noto Sans Telugu", "Nirmala UI", "Gautami", sans-serif';
export const FONT_HI = '"Noto Sans Devanagari", "Nirmala UI", "Mangal", sans-serif';

/** Resolve when the UI and Telugu fonts are usable (or after a short timeout). Never rejects. */
export function whenFontsReady(timeoutMs = 3500) {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  const wanted = [`800 60px ${FONT_UI}`, `700 30px ${FONT_UI}`, `700 40px ${FONT_TE}`];
  return Promise.race([
    Promise.all(wanted.map((f) => document.fonts.load(f, 'AaBb టిఫిన్ ₹0123').catch(() => {}))).then(() => {}),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Tileable noise fields: Float32Array(w * h), row index y = texture v (0 at the bottom), values 0..1.
const quint = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Fractal value noise, tileable (cells wrap). cx / cy are cells per axis of the first octave: unequal values give brushed streaks. */
export function fbmField(w, h, { cx = 4, cy = cx, oct = 4, gain = 0.5, seed = 1 } = {}) {
  const out = new Float32Array(w * h);
  const r = mulberry(seed * 977 + 13);
  let amp = 1;
  let sum = 0;
  let nx = cx;
  let ny = cy;
  const x0 = new Int32Array(w);
  const x1 = new Int32Array(w);
  const xf = new Float32Array(w);
  for (let o = 0; o < oct; o++) {
    const lat = new Float32Array(nx * ny);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * nx;
      const ix = Math.floor(fx);
      x0[x] = ix % nx;
      x1[x] = (ix + 1) % nx;
      xf[x] = quint(fx - ix);
    }
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * ny;
      const iy = Math.floor(fy);
      const ty = quint(fy - iy);
      const r0 = (iy % ny) * nx;
      const r1 = ((iy + 1) % ny) * nx;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const a = lat[r0 + x0[x]];
        const b = lat[r0 + x1[x]];
        const c = lat[r1 + x0[x]];
        const d = lat[r1 + x1[x]];
        const tx = xf[x];
        const top = a + (b - a) * tx;
        const bot = c + (d - c) * tx;
        out[row + x] += amp * (top + (bot - top) * ty);
      }
    }
    sum += amp;
    amp *= gain;
    nx *= 2;
    ny *= 2;
  }
  const inv = 1 / sum;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

/** Worley (cellular) noise, tileable. d1 / d2: distance to the nearest / second nearest feature point (in cells); id: random 0..1 per cell. */
export function worleyField(w, h, { cells = 6, seed = 1, jitter = 0.9 } = {}) {
  const r = mulberry(seed * 7919 + 5);
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  const pid = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    px[i] = 0.5 + (r() - 0.5) * jitter;
    py[i] = 0.5 + (r() - 0.5) * jitter;
    pid[i] = r();
  }
  const d1 = new Float32Array(w * h);
  const d2 = new Float32Array(w * h);
  const id = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * cells;
    const iy = Math.floor(fy);
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cells;
      const ix = Math.floor(fx);
      let a = 9;
      let b = 9;
      let who = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const cy = (((iy + dy) % cells) + cells) % cells;
        for (let dx = -1; dx <= 1; dx++) {
          const cx = (((ix + dx) % cells) + cells) % cells;
          const k = cy * cells + cx;
          const ex = ix + dx + px[k] - fx;
          const ey = iy + dy + py[k] - fy;
          const d = ex * ex + ey * ey;
          if (d < a) {
            b = a;
            a = d;
            who = pid[k];
          } else if (d < b) b = d;
        }
      }
      const i = y * w + x;
      d1[i] = Math.sqrt(a);
      d2[i] = Math.sqrt(b);
      id[i] = who;
    }
  }
  return { d1, d2, id };
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
};

/** Height field -> tangent-space normal map bytes (RGBA, OpenGL convention, tiling edges). */
export function normalFromHeight(hf, w, h, strength = 2) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w;
    const yp = ((y + 1) % h) * w;
    const yc = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const dx = (hf[yc + xp] - hf[yc + xm]) * strength;
      const dy = (hf[yp + x] - hf[ym + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const o = (yc + x) * 4;
      out[o] = (-dx * inv * 0.5 + 0.5) * 255;
      out[o + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      out[o + 2] = (inv * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** An RGBA byte array as a repeating, mip-mapped DataTexture. */
export function dataTexture(bytes, w, h, { srgb = false, repeat = null, anisotropy = 8 } = {}) {
  const t = new DataTexture(bytes, w, h, RGBAFormat, UnsignedByteType);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.needsUpdate = true;
  return t;
}

/**
 * Bake a PBR bundle from a per-pixel shader. `shade(i, x, y, u, v, px)` fills px = { r, g, b (albedo 0..1, sRGB), rough, metal, ao (0..1), h (height, any
 * scale) }. Returns { map, normalMap, ormMap } (any may be null when `normals` is false); the ORM texture packs ao / roughness / metalness in R / G / B.
 */
export function bakePBR(w, h, shade, { normals = true, strength = 3, repeat = null, ormSize = null } = {}) {
  const alb = new Uint8ClampedArray(w * h * 4);
  const orm = new Uint8ClampedArray(w * h * 4);
  const hf = new Float32Array(w * h);
  const px = { r: 0.5, g: 0.5, b: 0.5, rough: 0.8, metal: 0, ao: 1, h: 0 };
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      px.r = px.g = px.b = 0.5;
      px.rough = 0.8;
      px.metal = 0;
      px.ao = 1;
      px.h = 0;
      shade(i, x, y, x / w, v, px);
      const o = i * 4;
      alb[o] = clamp01(px.r) * 255;
      alb[o + 1] = clamp01(px.g) * 255;
      alb[o + 2] = clamp01(px.b) * 255;
      alb[o + 3] = 255;
      orm[o] = clamp01(px.ao) * 255;
      orm[o + 1] = clamp01(px.rough) * 255;
      orm[o + 2] = clamp01(px.metal) * 255;
      orm[o + 3] = 255;
      hf[i] = px.h;
    }
  }
  const map = dataTexture(alb, w, h, { srgb: true, repeat });
  let ormMap = null;
  if (ormSize && ormSize < w) {
    // roughness varies slowly: store it at a smaller size (nearest-sampled downscale of the box)
    const s = w / ormSize;
    const small = new Uint8ClampedArray(ormSize * ormSize * 4);
    for (let y = 0; y < ormSize; y++) for (let x = 0; x < ormSize; x++) {
      const si = (Math.floor(y * s) * w + Math.floor(x * s)) * 4;
      const di = (y * ormSize + x) * 4;
      small[di] = orm[si]; small[di + 1] = orm[si + 1]; small[di + 2] = orm[si + 2]; small[di + 3] = 255;
    }
    ormMap = dataTexture(small, ormSize, ormSize, { repeat });
  } else ormMap = dataTexture(orm, w, h, { repeat });
  const normalMap = normals ? dataTexture(normalFromHeight(hf, w, h, strength), w, h, { repeat }) : null;
  return { map, normalMap, ormMap };
}
