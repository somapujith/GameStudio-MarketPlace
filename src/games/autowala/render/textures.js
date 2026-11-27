// Small canvas-drawn textures (no image assets): asphalt, ground, signs, posters. All are cached by key.
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';

const cache = new Map();
let ANISO_CAP = 4;
/** The renderer sets this from the GPU's limit and the quality tier; textures made afterwards respect it. */
export const setAnisotropyCap = (n) => { ANISO_CAP = Math.max(1, n | 0); };

export function canvasTexture(w, h, draw, { repeat = null, srgb = true, anisotropy = 4 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = Math.min(anisotropy, ANISO_CAP);
  if (repeat) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

export function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

export function clearTextureCache() {
  for (const t of cache.values()) t.dispose?.();
  cache.clear();
}

const noise = (g, w, h, n, rgba, size = [1, 3]) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rgba();
    g.fillRect(Math.random() * w, Math.random() * h, size[0] + Math.random() * (size[1] - size[0]), size[0] + Math.random() * (size[1] - size[0]));
  }
};

/** Warm dusty ground. Tiles. */
export const groundTexture = () =>
  cached('ground', () =>
    canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = '#c99a78';
      g.fillRect(0, 0, w, h);
      noise(g, w, h, 1400, () => `rgba(${150 + Math.random() * 60 | 0},${100 + Math.random() * 40 | 0},${80 + Math.random() * 30 | 0},${0.12 + Math.random() * 0.28})`, [1, 4]);
      noise(g, w, h, 160, () => 'rgba(90,60,50,0.12)', [2, 6]);
    }, { repeat: [90, 90] }));

/** Asphalt with a dashed centre line; v runs along the road (one tile = 16 m). u across. */
export const asphaltTexture = () =>
  cached('asphalt', () =>
    canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#413c4e';
      g.fillRect(0, 0, w, h);
      noise(g, w, h, 900, () => `rgba(${70 + Math.random() * 40 | 0},${66 + Math.random() * 36 | 0},${84 + Math.random() * 40 | 0},${0.1 + Math.random() * 0.3})`, [1, 2.5]);
      g.fillStyle = '#ffe9a6';
      g.fillRect(w / 2 - 3, 8, 6, 48);
      g.fillRect(w / 2 - 3, 72, 6, 48);
      g.fillStyle = 'rgba(255,255,255,0.8)'; // edge lines
      g.fillRect(5, 0, 4, h);
      g.fillRect(w - 9, 0, 4, h);
    }, { repeat: [1, 1] }));

/** The same asphalt without the lane markings (junction patches): tiles in both directions, 8 px per metre when mapped at 8 m. */
export const asphaltPlainTexture = () =>
  cached('asphalt-plain', () =>
    canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#413c4e';
      g.fillRect(0, 0, w, h);
      noise(g, w, h, 450, () => `rgba(${70 + Math.random() * 40 | 0},${66 + Math.random() * 36 | 0},${84 + Math.random() * 40 | 0},${0.1 + Math.random() * 0.3})`, [1, 2.5]);
    }, { repeat: [1, 1] }));

export const sidewalkTexture = () =>
  cached('sidewalk', () =>
    canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#d9b9b0';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(120,80,90,0.35)';
      g.lineWidth = 2;
      for (let i = 0; i <= w; i += 32) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke();
      }
      noise(g, w, h, 500, () => `rgba(110,80,80,${0.06 + Math.random() * 0.14})`, [1, 3]);
    }, { repeat: [1, 1] }));

/** A shop / neon sign texture. `lines` = [{ text, font, color }]; bg is the board colour; glow draws a neon outline. */
export function signTexture(key, { w = 512, h = 160, bg = '#1a0b2e', border = '#ff3d9a', lines, glow = true }) {
  return cached(`sign:${key}`, () =>
    canvasTexture(w, h, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = border;
      g.lineWidth = 8;
      if (glow) { g.shadowColor = border; g.shadowBlur = 18; }
      g.strokeRect(10, 10, w - 20, h - 20);
      g.shadowBlur = glow ? 14 : 0;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const n = lines.length;
      lines.forEach((ln, i) => {
        g.font = ln.font;
        g.fillStyle = ln.color;
        g.shadowColor = ln.color;
        g.fillText(ln.text, w / 2, (h * (i + 1)) / (n + 1) + (ln.dy || 0));
      });
    }, { anisotropy: 8 }));
}

/** A film-poster-like billboard: gradient, big title, little sun. */
export function posterTexture(key, title, sub, a, b) {
  return cached(`poster:${key}`, () =>
    canvasTexture(256, 384, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, a);
      gr.addColorStop(1, b);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,230,160,0.9)';
      g.beginPath(); g.arc(w * 0.68, h * 0.34, 46, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(20,10,40,0.82)';
      g.beginPath();
      g.moveTo(0, h * 0.62);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, h * 0.62 - 10 - ((x * 7) % 41));
      g.lineTo(w, h); g.lineTo(0, h); g.fill();
      g.textAlign = 'center';
      g.shadowColor = '#000';
      g.shadowBlur = 8;
      g.fillStyle = '#fff6d8';
      g.font = '800 44px "Bricolage Grotesque Variable", Impact, sans-serif';
      g.fillText(title, w / 2, h * 0.84);
      g.font = '700 20px "Bricolage Grotesque Variable", sans-serif';
      g.fillStyle = '#ffd1e8';
      g.fillText(sub, w / 2, h * 0.93);
    }, { anisotropy: 8 }));
}
