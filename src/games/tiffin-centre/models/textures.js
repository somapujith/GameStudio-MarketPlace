// Canvas-drawn textures for the models (street style: enamel + tin plates, gunny, newspaper, lungi checks, rupee notes).
// All are node-safe (see makeCanvasTexture) and the shared ones are cached with userData.shared.
import { makeCanvasTexture, redrawWhenFontsLoad, sharedTexture } from './util.js';
import { RepeatWrapping } from 'three';

// High-quality seamless procedural generators (noise, fbm, worley, Sobel normal maps, PBR recipes). Node-safe: stubs without a canvas.
export * from './texgen.js';
export { pbr } from './textures-pbr.js';
export { setTextureQuality, getTextureQuality, texRes } from './util.js';

export const FONT_TE = '"Noto Sans Telugu Variable","Noto Sans Telugu","Nirmala UI",sans-serif';
export const FONT_UI = '"Bricolage Grotesque Variable","Bricolage Grotesque",system-ui,sans-serif';

const rr = (g, x, y, w, h, r) => {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
};

// A tiny deterministic scatter so textures do not change between loads.
function speckle(g, w, h, n, color, size, seed = 7) {
  let a = seed;
  const r = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.fillStyle = color;
  for (let i = 0; i < n; i++) g.fillRect(r() * w, r() * h, size, size);
}

/** Hand-painted enamel / tin label plate. `style`: { base, edge, ink, ink2, rust }. Returns an OWNED texture that redraws when fonts load. */
export function labelTexture({ te, en, style }) {
  const s = { base: '#f4ead2', edge: '#1f5fa8', ink: '#c0301f', ink2: '#2a2220', rust: '#8a4a22', ...style };
  const draw = (g, w, h) => {
    // tin plate with rolled enamel edge
    g.fillStyle = s.edge;
    rr(g, 2, 2, w - 4, h - 4, 18);
    g.fill();
    g.fillStyle = s.base;
    rr(g, 12, 12, w - 24, h - 24, 12);
    g.fill();
    // rust bleed at the corners and chipped enamel
    g.fillStyle = s.rust;
    g.globalAlpha = 0.28;
    for (const [x, y] of [[16, 16], [w - 30, 18], [20, h - 30], [w - 34, h - 32]]) g.fillRect(x, y, 14, 10);
    g.globalAlpha = 1;
    speckle(g, w, h, 70, 'rgba(60,40,30,0.22)', 2, 11);
    // screw heads
    g.fillStyle = '#6b6560';
    for (const [x, y] of [[26, h / 2], [w - 26, h / 2]]) {
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = s.ink;
    g.font = `700 56px ${FONT_TE}`;
    g.fillText(te, w / 2, h * 0.4, w - 90);
    g.fillStyle = s.ink2;
    g.font = `800 25px ${FONT_UI}`;
    g.fillText(String(en).toUpperCase(), w / 2, h * 0.79, w - 90);
  };
  const tex = makeCanvasTexture(512, 128, draw);
  redrawWhenFontsLoad(tex, [`700 56px ${FONT_TE}`, `800 25px ${FONT_UI}`], te + en);
  return tex;
}

export const LABEL_STYLES = {
  tawa: { base: '#f4ead2', edge: '#1f5fa8', ink: '#c0301f' },
  steamer: { base: '#e6f1f2', edge: '#12908e', ink: '#0f5d8c' },
  kadai: { base: '#f7d54a', edge: '#7a3b12', ink: '#7c1d12' },
  chai: { base: '#e3f0d8', edge: '#2f7a46', ink: '#7c1d12' },
};

/** Jute / gunny sack weave, tiles. */
export const gunnyTexture = () =>
  sharedTexture('gunny', () => {
    const t = makeCanvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#b79360';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(90,60,30,0.45)';
      g.lineWidth = 1.5;
      for (let i = 0; i < w; i += 4) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, h);
        g.stroke();
        g.beginPath();
        g.moveTo(0, i);
        g.lineTo(w, i);
        g.stroke();
      }
      speckle(g, w, h, 120, 'rgba(255,230,170,0.25)', 2, 3);
    });
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  });

/** Newspaper lining (cones, baskets). */
export const newspaperTexture = () =>
  sharedTexture('newspaper', () => {
    const t = makeCanvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#e9e0c7';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(40,36,32,0.55)';
      for (let y = 10; y < h; y += 7) {
        let x = 6;
        while (x < w - 8) {
          const len = 8 + ((x * 7 + y * 13) % 19);
          g.fillRect(x, y, Math.min(len, w - 8 - x), 2);
          x += len + 4;
        }
      }
      g.fillStyle = 'rgba(30,26,24,0.7)';
      g.fillRect(8, 2, 60, 6); // headline
    });
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  });

/** White/grey check for a lungi or gamchha; tinted by the material colour. */
export const checkTexture = () =>
  sharedTexture('check', () => {
    const t = makeCanvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.38)';
      for (let i = 0; i < 4; i++) {
        g.fillRect(i * 16, 0, 5, h);
        g.fillRect(0, i * 16, w, 5);
      }
      g.fillStyle = 'rgba(0,0,0,0.2)';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(i * 16, j * 16, 5, 5);
    });
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(3, 2);
    return t;
  });

/** A ten-rupee-ish note: green with a gold border and a big rupee sign. Emissive-mapped so it glows. */
export const noteTexture = () =>
  sharedTexture('note', () =>
    makeCanvasTexture(128, 64, (g, w, h) => {
      g.fillStyle = '#3aa65a';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#f6d36a';
      g.lineWidth = 5;
      g.strokeRect(5, 5, w - 10, h - 10);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.arc(w * 0.3, h / 2, 20, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff4c2';
      g.font = `800 44px ${FONT_UI}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('₹', w * 0.7, h / 2 + 2);
    }));

/** Hand-painted flex banner. Returns an OWNED texture. colors = [bg, text, accent]. */
export function bannerTexture({ text = 'TIFFIN CENTRE', te = '', colors = ['#d9261c', '#fff4dc', '#ffc83d'] } = {}) {
  const [bg, ink, accent] = colors;
  const draw = (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = accent;
    g.fillRect(0, 0, w, 14);
    g.fillRect(0, h - 14, w, 14);
    for (let x = 12; x < w; x += 44) {
      g.fillStyle = ink;
      g.beginPath();
      g.arc(x, h - 7, 3, 0, Math.PI * 2);
      g.fill();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = accent;
    g.font = `800 ${te ? 70 : 92}px ${FONT_UI}`;
    g.fillText(String(text).toUpperCase(), w / 2 + 3, (te ? h * 0.36 : h * 0.5) + 3, w - 60);
    g.fillStyle = ink;
    g.fillText(String(text).toUpperCase(), w / 2, te ? h * 0.36 : h * 0.5, w - 60);
    if (te) {
      g.fillStyle = ink;
      g.font = `700 64px ${FONT_TE}`;
      g.fillText(te, w / 2, h * 0.74, w - 60);
    }
    speckle(g, w, h, 80, 'rgba(0,0,0,0.12)', 2, 5);
  };
  const tex = makeCanvasTexture(1024, 256, draw);
  redrawWhenFontsLoad(tex, [`800 70px ${FONT_UI}`, `700 64px ${FONT_TE}`], String(text) + te);
  return tex;
}

/** Player name tag (pill). Returns an OWNED texture. */
export function nameTagTexture(name, color = '#ff8a1f') {
  const label = String(name || '').slice(0, 14);
  const draw = (g, w, h) => {
    g.fillStyle = 'rgba(36,26,20,0.88)';
    rr(g, 4, 6, w - 8, h - 12, 24);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc(28, h / 2, 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff4dc';
    g.font = `700 32px ${FONT_UI}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(label, 50, h / 2 + 2, w - 64);
  };
  const tex = makeCanvasTexture(256, 64, draw);
  redrawWhenFontsLoad(tex, [`700 32px ${FONT_UI}`], label);
  return tex;
}
