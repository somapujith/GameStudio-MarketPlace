// Canvas-drawn textures (no image assets: the hub CSP forbids external ones). Small helper layer over CanvasTexture.
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';

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

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Wrap a canvas in a texture. `draw(g, w, h)` runs once now; call `redraw()` on the result to paint again (e.g. after fonts load). */
export function canvasTexture(w, h, draw, { repeat = null, srgb = true, anisotropy = 4, mip = true } = {}) {
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

/** Resolve when the UI and Telugu fonts are usable (or after a short timeout). Never rejects. */
export function whenFontsReady(timeoutMs = 3500) {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  const wanted = [`800 60px ${FONT_UI}`, `700 30px ${FONT_UI}`, `700 40px ${FONT_TE}`];
  return Promise.race([
    Promise.all(wanted.map((f) => document.fonts.load(f, 'AaBb టిఫిన్ ₹0123').catch(() => {}))).then(() => {}),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}
