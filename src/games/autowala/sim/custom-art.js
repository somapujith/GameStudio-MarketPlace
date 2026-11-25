// Canvas-drawn art for the customised auto: number plates, the rear banner, mud-flap messages, side stripes, curtain and seat
// patterns, the underglow pool. DOM only (CanvasTexture), no assets. OWNER: customisation agent.
// Text textures redraw themselves once the web fonts have loaded, so Telugu never appears as boxes on first paint.
import { CanvasTexture } from 'three';
import { canvasTexture } from '../render/textures.js';
import { STRIPES, PLATE_STYLES, WINDOW_FRAMES, find } from '../gameplay/catalog.js';
import { fitBadge, fitBanner, fitMudflap, fitRearWindow, fontFamilyFor, formatPlate, plateFontPx, windowLetterColors, FONT_LATIN } from './custom-logic.js';

export const shade = (hex, k) => {
  const n = parseInt(String(hex).slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

/** A draw function that may be re-run later: returns the texture; `redraw()` repaints and flags an upload. */
export function liveTexture(w, h, draw, opts, fontText = null, weight = 800) {
  const tex = canvasTexture(w, h, draw, opts);
  const canvas = tex.image;
  tex.userData.redraw = () => {
    if (tex.userData.dead) return;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    tex.needsUpdate = true;
  };
  if (fontText && typeof document !== 'undefined' && document.fonts?.load) {
    const fam = fontFamilyFor(fontText);
    const spec = `${weight} 40px ${fam}`;
    let ready = true;
    try {
      ready = document.fonts.check(spec, fontText);
    } catch {
      ready = true;
    }
    if (!ready) {
      document.fonts.load(spec, fontText).then(() => tex.userData.redraw()).catch(() => {});
    }
  }
  return tex;
}

/** Draw in a larger design space (W x H) onto a smaller canvas (w x h): the art code stays in design pixels. */
export const scaled = (W, H, w, h, draw) => (g) => {
  g.save();
  g.scale(w / W, h / H);
  draw(g, W, H);
  g.restore();
};

/** Dispose a texture made here (marks it so a late font-load redraw is ignored). */
export function disposeTexture(tex) {
  if (!tex) return;
  tex.userData.dead = true;
  tex.dispose();
}

export const fitMeasure = (g, family, weight) => (s, px) => {
  g.font = `${weight} ${px}px ${family}`;
  return g.measureText(s).width;
};

// ---------------------------------------------------------------------------------------------------------------- plates

/** The number plate (rear and front share it). 256x80 matches the 0.62 x 0.2 m plane. */
export function makePlateTexture(text, styleId) {
  const st = find(PLATE_STYLES, styleId) || PLATE_STYLES[0];
  const t = formatPlate(text);
  const W = 256;
  const H = 64;
  const draw = (g, w, h) => {
    g.fillStyle = st.bg;
    g.fillRect(0, 0, w, h);
    if (st.id === 'carbon') {
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = 2;
      for (let i = -h; i < w; i += 6) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + h, h);
        g.stroke();
        g.beginPath();
        g.moveTo(i + h, 0);
        g.lineTo(i, h);
        g.stroke();
      }
    }
    // soft top light so the plate reads as a pressed metal plate
    const sh = g.createLinearGradient(0, 0, 0, h);
    sh.addColorStop(0, 'rgba(255,255,255,0.16)');
    sh.addColorStop(0.5, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.14)');
    g.fillStyle = sh;
    g.fillRect(0, 0, w, h);
    g.lineWidth = 5;
    g.strokeStyle = st.border;
    if (st.glow) {
      g.shadowColor = st.border;
      g.shadowBlur = 10;
    }
    const r = 9;
    g.beginPath();
    g.moveTo(5 + r, 5);
    g.arcTo(w - 5, 5, w - 5, h - 5, r);
    g.arcTo(w - 5, h - 5, 5, h - 5, r);
    g.arcTo(5, h - 5, 5, 5, r);
    g.arcTo(5, 5, w - 5, 5, r);
    g.closePath();
    g.stroke();
    const family = '"Bricolage Grotesque Variable", "Arial Narrow", Impact, sans-serif';
    const px = plateFontPx(t, w, h, 22, fitMeasure(g, family, 800));
    g.font = `800 ${px}px ${family}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = st.fg;
    if (st.glow) {
      g.shadowColor = st.fg;
      g.shadowBlur = 12;
    } else g.shadowBlur = 0;
    g.fillText(t, w / 2, h / 2 + px * 0.04);
    g.shadowBlur = 0;
    g.fillStyle = st.border; // two rivets
    for (const x of [14, w - 14]) {
      g.beginPath();
      g.arc(x, h / 2, 2.4, 0, Math.PI * 2);
      g.fill();
    }
  };
  return liveTexture(W, H, draw, { anisotropy: 4 }, t, 800);
}

// ---------------------------------------------------------------------------------------------------------------- banner

/** The rear banner board (1.3 x 0.28 m): marigold-yellow board, bold text auto-fit to the width, Latin or Telugu. */
export function makeBannerTexture(text) {
  const W = 512;
  const H = 110;
  const draw = (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#f2c23c');
    bg.addColorStop(1, '#d9a21c');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#7a1c14';
    g.lineWidth = 5;
    g.strokeRect(7, 7, w - 14, h - 14);
    g.strokeStyle = '#1a0e04';
    g.lineWidth = 2;
    g.strokeRect(14, 14, w - 28, h - 28);
    const family = fontFamilyFor(text);
    const fit = fitBanner(text, w - 20, h - 8, { pad: 24, measure: fitMeasure(g, family, 800) });
    g.font = `800 ${fit.fontPx}px ${fit.font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#1a0e04';
    g.fillText(fit.text, w / 2, h / 2 + fit.fontPx * 0.06);
  };
  return liveTexture(W, H, draw, { anisotropy: 4 }, text, 800);
}

/** Mud-flap message (1.06 x 0.32 m): white / marigold letters on black rubber with a red border, one or two lines. */
export function makeMudflapTexture(text) {
  const W = 512;
  const H = 154;
  const draw = (g, w, h) => {
    g.fillStyle = '#17141b';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d6322e';
    g.lineWidth = 7;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.strokeStyle = '#ffc400';
    g.lineWidth = 2;
    g.strokeRect(15, 15, w - 30, h - 30);
    const family = fontFamilyFor(text);
    const fit = fitMudflap(text, w - 20, h - 10, { pad: 26, measure: fitMeasure(g, family, 800) });
    g.font = `800 ${fit.fontPx}px ${fit.font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lh = fit.fontPx * 1.1;
    const y0 = h / 2 - ((fit.lines.length - 1) * lh) / 2;
    fit.lines.forEach((ln, i) => {
      g.fillStyle = i % 2 ? '#ffc400' : '#fff6e0';
      g.fillText(ln, w / 2, y0 + i * lh + fit.fontPx * 0.04);
    });
  };
  return liveTexture(256, 77, scaled(W, H, 256, 77, draw), { anisotropy: 4 }, text, 800);
}

// ---------------------------------------------------------------------------------------------------------------- stripes

/** Side stripe art, 512x154 for the 1.2 x 0.36 m plane. u runs front-to-back on both sides. Transparent outside the stripe. */
export function makeStripeTexture(id) {
  const st = find(STRIPES, id);
  if (!st || !st.colors || id === 'rainbow-swish') return null;
  const [c0, c1 = '#ffffff'] = st.colors;
  const W = 512;
  const H = 96;
  const draw = (g, w, h) => {
    g.clearRect(0, 0, w, h);
    switch (id) {
      case 'tricolor': {
        const bh = h * 0.2;
        const y0 = h * 0.5 - bh * 1.5;
        [c0, c1, st.colors[2]].forEach((c, i) => {
          g.fillStyle = c;
          g.fillRect(0, y0 + i * bh, w, bh + 0.5);
        });
        g.strokeStyle = '#1a2a6c'; // the chakra, small, at the middle of the white band
        g.lineWidth = 2;
        g.beginPath();
        g.arc(w * 0.5, h * 0.5, bh * 0.4, 0, Math.PI * 2);
        g.stroke();
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          g.beginPath();
          g.moveTo(w * 0.5, h * 0.5);
          g.lineTo(w * 0.5 + Math.cos(a) * bh * 0.4, h * 0.5 + Math.sin(a) * bh * 0.4);
          g.stroke();
        }
        break;
      }
      case 'zigzag': {
        const pts = 11;
        const path = () => {
          g.beginPath();
          for (let i = 0; i <= pts; i++) {
            const x = (i / pts) * w;
            const y = i % 2 ? h * 0.78 : h * 0.22;
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
        };
        g.lineJoin = 'miter';
        g.lineCap = 'butt';
        g.strokeStyle = c1;
        g.lineWidth = h * 0.3;
        path();
        g.stroke();
        g.strokeStyle = c0;
        g.lineWidth = h * 0.16;
        path();
        g.stroke();
        break;
      }
      case 'stars': {
        const star = (cx, cy, R, rot) => {
          g.beginPath();
          for (let i = 0; i < 10; i++) {
            const r = i % 2 ? R * 0.42 : R;
            const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
          g.closePath();
        };
        g.fillStyle = c0;
        g.shadowColor = 'rgba(0,0,0,0.55)';
        g.shadowBlur = 6;
        const sizes = [0.3, 0.44, 0.34, 0.5, 0.34, 0.44, 0.3];
        sizes.forEach((s, i) => {
          star(((i + 0.5) / sizes.length) * w, h * (0.5 + (i % 2 ? 0.1 : -0.1)), h * s, i * 0.3);
          g.fill();
        });
        break;
      }
      case 'checker': {
        const rows = 3;
        const sz = (h * 0.62) / rows;
        const cols = Math.floor(w / sz);
        const y0 = h * 0.19;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            g.fillStyle = (r + c) % 2 ? c0 : c1;
            g.fillRect(c * sz + (w - cols * sz) / 2, y0 + r * sz, sz + 0.5, sz + 0.5);
          }
        }
        g.strokeStyle = c0;
        g.lineWidth = 3;
        g.strokeRect((w - cols * sz) / 2, y0, cols * sz, rows * sz);
        break;
      }
      case 'flame': {
        // tongues start at the front (u = 0) and stream back along the bottom of the stripe
        const tongue = (x0, len, hgt, col) => {
          g.fillStyle = col;
          g.beginPath();
          g.moveTo(x0, h);
          g.bezierCurveTo(x0 + len * 0.2, h - hgt * 0.4, x0 + len * 0.55, h - hgt * 0.9, x0 + len, h - hgt * 0.55);
          g.bezierCurveTo(x0 + len * 0.75, h - hgt * 0.45, x0 + len * 0.6, h - hgt * 0.2, x0 + len * 0.4, h);
          g.closePath();
          g.fill();
        };
        const rowsK = [[0, 0.86, 0.9], [0.08, 0.7, 0.7], [0.0, 0.5, 0.5]];
        g.fillStyle = c0;
        g.fillRect(0, h * 0.62, w * 0.12, h * 0.38);
        rowsK.forEach(([x, l, hh], i) => tongue(x * w, l * w, h * hh, i === 2 ? c1 : c0));
        tongue(w * 0.0, w * 0.6, h * 0.55, c1);
        tongue(w * 0.12, w * 0.4, h * 0.34, '#fff2b0');
        break;
      }
      case 'wave':
      default: {
        const wave = (amp, off, col, lw) => {
          g.strokeStyle = col;
          g.lineWidth = lw;
          g.lineCap = 'round';
          g.beginPath();
          for (let x = 0; x <= w; x += 4) {
            const y = h * 0.5 + Math.sin((x / w) * Math.PI * 4 + off) * amp;
            if (x) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
          g.stroke();
        };
        wave(h * 0.22, 0, c0, h * 0.2);
        wave(h * 0.22, 0.9, c1, h * 0.14);
        wave(h * 0.22, 1.7, shade(c0, 0.35), h * 0.07);
        break;
      }
    }
  };
  return liveTexture(256, 48, scaled(W, H, 256, 48, draw), { anisotropy: 4 });
}

// ---------------------------------------------------------------------------------------------------------------- curtains, seats

/** Curtain pattern on a 256x256 tile (the catalogue's `pattern`: check | floral | tricolor | poster). */
export function makeCurtainTexture(pattern, hex) {
  const draw = (g, w, h) => {
    switch (pattern) {
      case 'check': {
        g.fillStyle = hex;
        g.fillRect(0, 0, w, h);
        const n = 8;
        const s = w / n;
        g.fillStyle = 'rgba(255,255,255,0.55)';
        for (let i = 0; i < n; i += 2) {
          g.fillRect(i * s, 0, s, h);
          g.fillRect(0, i * s, w, s);
        }
        g.fillStyle = 'rgba(0,0,0,0.22)';
        for (let i = 0; i < n; i += 2) for (let j = 0; j < n; j += 2) g.fillRect(i * s, j * s, s, s);
        break;
      }
      case 'floral': {
        g.fillStyle = shade(hex, -0.45);
        g.fillRect(0, 0, w, h);
        const petals = ['#ffd6e6', '#fff1b8', '#ffffff'];
        for (let i = 0; i < 9; i++) {
          const cx = ((i * 97) % 5) * (w / 4.2) + 20 + (i % 2) * 18;
          const cy = ((i * 53) % 5) * (h / 4.2) + 24;
          g.fillStyle = petals[i % 3];
          for (let p = 0; p < 6; p++) {
            const a = (p / 6) * Math.PI * 2;
            g.beginPath();
            g.arc(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11, 8, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = '#e8a21c';
          g.beginPath();
          g.arc(cx, cy, 7, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#2f8a4a';
        for (let i = 0; i < 14; i++) {
          g.beginPath();
          g.ellipse(((i * 61) % 240) + 8, ((i * 83) % 240) + 8, 9, 4, i, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case 'tricolor': {
        const bh = h / 3;
        ['#ff9933', '#ffffff', '#138808'].forEach((c, i) => {
          g.fillStyle = c;
          g.fillRect(0, i * bh, w, bh + 1);
        });
        g.strokeStyle = '#1a2a8c';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(w / 2, h / 2, bh * 0.42, 0, Math.PI * 2);
        g.stroke();
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          g.beginPath();
          g.moveTo(w / 2, h / 2);
          g.lineTo(w / 2 + Math.cos(a) * bh * 0.42, h / 2 + Math.sin(a) * bh * 0.42);
          g.stroke();
        }
        break;
      }
      case 'poster':
      default: {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, '#3a1670');
        gr.addColorStop(0.55, hex);
        gr.addColorStop(1, '#ff8a4d');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,236,170,0.95)';
        g.beginPath();
        g.arc(w * 0.62, h * 0.4, 38, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(20,8,40,0.85)';
        g.beginPath();
        g.moveTo(0, h);
        g.lineTo(0, h * 0.7);
        for (let x = 0; x <= w; x += 16) g.lineTo(x, h * 0.7 - ((x * 7) % 37) - 4);
        g.lineTo(w, h);
        g.fill();
        g.fillStyle = '#ffe6f2'; // a hero and a heroine, in silhouette
        g.beginPath();
        g.arc(w * 0.34, h * 0.56, 11, 0, Math.PI * 2);
        g.arc(w * 0.46, h * 0.58, 10, 0, Math.PI * 2);
        g.fill();
        g.fillRect(w * 0.34 - 8, h * 0.6, 16, 34);
        g.fillRect(w * 0.46 - 7, h * 0.62, 14, 30);
        g.fillStyle = 'rgba(255,255,255,0.9)';
        for (let i = 0; i < 14; i++) g.fillRect(((i * 71) % 250) + 3, ((i * 37) % 70) + 6, 2, 2);
        g.strokeStyle = '#ffd24a';
        g.lineWidth = 6;
        g.strokeRect(5, 5, w - 10, h - 10);
        break;
      }
    }
  };
  return liveTexture(256, 256, draw, { anisotropy: 4 });
}

/** Leopard-print seat vinyl on a 256 tile. */
export function makeSeatTexture(hex) {
  const draw = (g, w, h) => {
    g.fillStyle = hex;
    g.fillRect(0, 0, w, h);
    let s = 7;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < 46; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = 7 + rnd() * 7;
      const rot = rnd() * 6.28;
      g.strokeStyle = '#2a170c';
      g.lineWidth = 3.5;
      g.beginPath();
      g.arc(x, y, r, rot, rot + 4.2);
      g.stroke();
      g.fillStyle = shade(hex, -0.35);
      g.beginPath();
      g.arc(x, y, r * 0.5, 0, Math.PI * 2);
      g.fill();
    }
  };
  return liveTexture(256, 256, draw, { anisotropy: 4 });
}

/** The soft glow on the road under the neon: a bright ring near the body edge fading outwards. Greyscale, tinted by the material. */
export function makePoolTexture() {
  const tex = canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.45)');
    gr.addColorStop(0.42, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.72, 'rgba(255,255,255,0.32)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  return tex;
}

/** Re-export so props can build small flat textures of their own. */
export { canvasTexture, CanvasTexture, FONT_LATIN };
