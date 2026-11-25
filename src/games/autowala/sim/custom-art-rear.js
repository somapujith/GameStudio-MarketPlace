// Canvas art for the rear of the auto: engine-cover faces (louvres, mesh, chrome grille, jali, LED panels, royal emblem), the
// rear-window sticker, the roof badge, painted mud-flaps and the rainbow swish. DOM only. OWNER: customisation agent.
import { WINDOW_FRAMES, find } from '../gameplay/catalog.js';
import { fitBadge, fitRearWindow, fontFamilyFor, windowLetterColors } from './custom-logic.js';
import { fitMeasure, liveTexture, scaled, shade } from './custom-art.js';

const rr = (g, x, y, w, h, r) => {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
};

// ---------------------------------------------------------------------------------------------------------------- engine cover

/** The cover face is a 0.94 x 0.46 m plane (512 x 250). The plate covers its middle; louvres sit above and below it. */
export const COVER_BANDS = { top: [0.03, 0.2], bottom: [0.87, 0.97], plate: [0.5, 0.83] };

function slats(g, x, y, w, h, n, base, hi) {
  g.fillStyle = base;
  rr(g, x, y, w, h, 4);
  g.fill();
  const step = h / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillRect(x + 4, y + i * step + step * 0.5, w - 8, Math.max(2, step * 0.38));
    g.fillStyle = hi;
    g.fillRect(x + 4, y + i * step + step * 0.18, w - 8, Math.max(1, step * 0.14));
  }
}

function meshFill(g, x, y, w, h, line) {
  g.save();
  rr(g, x, y, w, h, 4);
  g.clip();
  g.fillStyle = '#0d0e12';
  g.fillRect(x, y, w, h);
  g.strokeStyle = line;
  g.lineWidth = 1.5;
  const s = 7;
  for (let i = -h; i < w; i += s) {
    g.beginPath();
    g.moveTo(x + i, y);
    g.lineTo(x + i + h, y + h);
    g.stroke();
    g.beginPath();
    g.moveTo(x + i + h, y);
    g.lineTo(x + i, y + h);
    g.stroke();
  }
  g.restore();
}

function crown(g, cx, cy, s, col) {
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(cx - s, cy + s * 0.55);
  g.lineTo(cx - s, cy - s * 0.2);
  g.lineTo(cx - s * 0.5, cy + s * 0.15);
  g.lineTo(cx, cy - s * 0.6);
  g.lineTo(cx + s * 0.5, cy + s * 0.15);
  g.lineTo(cx + s, cy - s * 0.2);
  g.lineTo(cx + s, cy + s * 0.55);
  g.closePath();
  g.fill();
  for (const dx of [-1, 0, 1]) {
    g.beginPath();
    g.arc(cx + dx * s * 0.9, cy - s * (dx ? 0.28 : 0.72), s * 0.12, 0, Math.PI * 2);
    g.fill();
  }
}

/**
 * Art for ENGINE_COVERS id. LED covers are drawn white-on-dark so the material colour tints them (rainbow animates that colour).
 * Everything outside the drawn parts is transparent, so the painted cover door shows through.
 */
export function makeCoverTexture(id) {
  const W = 512;
  const H = 250;
  const draw = (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const x0 = w * 0.1;
    const x1 = w * 0.9;
    const top = [h * COVER_BANDS.top[0], h * (COVER_BANDS.top[1] - COVER_BANDS.top[0])];
    const bot = [h * COVER_BANDS.bottom[0], h * (COVER_BANDS.bottom[1] - COVER_BANDS.bottom[0])];
    // door seam
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 3;
    rr(g, 3, 3, w - 6, h - 6, 14);
    g.stroke();
    switch (id) {
      case 'mesh':
        meshFill(g, x0, top[0], x1 - x0, top[1], '#8c93a6');
        meshFill(g, x0, bot[0], x1 - x0, bot[1], '#8c93a6');
        break;
      case 'chrome-grille': {
        for (const [y, hh] of [top, bot]) {
          g.fillStyle = '#0d0e12';
          rr(g, x0, y, x1 - x0, hh, 4);
          g.fill();
          const n = 28;
          for (let i = 0; i < n; i++) {
            const gr = g.createLinearGradient(0, y, 0, y + hh);
            gr.addColorStop(0, '#ffffff');
            gr.addColorStop(0.5, '#b9bed0');
            gr.addColorStop(1, '#6e7388');
            g.fillStyle = gr;
            g.fillRect(x0 + 5 + (i * (x1 - x0 - 10)) / n, y + 3, (x1 - x0 - 10) / n * 0.55, hh - 6);
          }
          g.strokeStyle = '#e8ebf5';
          g.lineWidth = 3;
          rr(g, x0, y, x1 - x0, hh, 4);
          g.stroke();
        }
        break;
      }
      case 'jali': {
        g.fillStyle = '#1c120c';
        rr(g, w * 0.07, h * 0.04, w * 0.86, h * 0.92, 10);
        g.fill();
        g.strokeStyle = '#d9a441';
        g.lineWidth = 2.2;
        const s = 26;
        for (let y = h * 0.05; y < h * 0.95; y += s) {
          for (let x = w * 0.08; x < w * 0.92; x += s) {
            g.beginPath();
            g.moveTo(x + s / 2, y);
            g.lineTo(x + s, y + s / 2);
            g.lineTo(x + s / 2, y + s);
            g.lineTo(x, y + s / 2);
            g.closePath();
            g.stroke();
            g.beginPath();
            g.arc(x + s / 2, y + s / 2, s * 0.14, 0, Math.PI * 2);
            g.stroke();
          }
        }
        g.strokeStyle = '#f0c968';
        g.lineWidth = 4;
        rr(g, w * 0.07, h * 0.04, w * 0.86, h * 0.92, 10);
        g.stroke();
        break;
      }
      case 'led-pink':
      case 'led-cyan':
      case 'led-rainbow': {
        g.fillStyle = '#05050a';
        rr(g, w * 0.06, h * 0.04, w * 0.88, h * 0.92, 12);
        g.fill();
        const cols = 34;
        const rows = 16;
        const cw = (w * 0.82) / cols;
        const ch = (h * 0.86) / rows;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const wave = 0.55 + 0.45 * Math.sin(c * 0.5 + r * 0.8);
            g.fillStyle = `rgba(255,255,255,${0.55 + wave * 0.45})`;
            g.beginPath();
            g.arc(w * 0.09 + (c + 0.5) * cw, h * 0.07 + (r + 0.5) * ch, Math.min(cw, ch) * 0.36, 0, Math.PI * 2);
            g.fill();
          }
        }
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 4;
        rr(g, w * 0.06, h * 0.04, w * 0.88, h * 0.92, 12);
        g.stroke();
        break;
      }
      case 'royal': {
        g.strokeStyle = '#e9b64a';
        g.lineWidth = 6;
        rr(g, w * 0.07, h * 0.05, w * 0.86, h * 0.9, 14);
        g.stroke();
        g.lineWidth = 2;
        rr(g, w * 0.095, h * 0.09, w * 0.81, h * 0.82, 10);
        g.stroke();
        // a generic crown on a shield, scrollwork either side, slim louvres at the bottom
        crown(g, w * 0.5, h * 0.17, h * 0.1, '#e9b64a');
        g.strokeStyle = '#e9b64a';
        g.lineWidth = 3;
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(w * 0.5 + s * w * 0.1, h * 0.2);
          g.bezierCurveTo(w * 0.5 + s * w * 0.26, h * 0.08, w * 0.5 + s * w * 0.3, h * 0.3, w * 0.5 + s * w * 0.4, h * 0.22);
          g.stroke();
          g.beginPath();
          g.moveTo(w * 0.5 + s * w * 0.12, h * 0.86);
          g.bezierCurveTo(w * 0.5 + s * w * 0.26, h * 0.7, w * 0.5 + s * w * 0.3, h * 0.92, w * 0.5 + s * w * 0.4, h * 0.82);
          g.stroke();
        }
        slats(g, w * 0.2, bot[0], w * 0.6, bot[1], 3, '#2a1d10', '#e9b64a');
        break;
      }
      case 'louver':
      default:
        slats(g, x0, top[0], x1 - x0, top[1], 6, '#1d1f27', 'rgba(255,255,255,0.28)');
        slats(g, x0, bot[0], x1 - x0, bot[1], 4, '#1d1f27', 'rgba(255,255,255,0.28)');
        break;
    }
  };
  return liveTexture(256, 125, scaled(W, H, 256, 125, draw), { anisotropy: 4 });
}

// ---------------------------------------------------------------------------------------------------------------- rear window

/** The big centre pane (0.8 x 0.48 m): dark glass, a thin outline frame, and the sticker lettering. 512 x 307. */
export function makeRearWindowTexture(text, frameId) {
  const frame = find(WINDOW_FRAMES, frameId) || WINDOW_FRAMES[0];
  const t = String(text || 'AUTO').toUpperCase();
  const W = 512;
  const H = 307;
  const draw = (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#16303f');
    bg.addColorStop(0.5, '#0b1822');
    bg.addColorStop(1, '#122a38');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.07)'; // a diagonal sheen across the glass
    g.beginPath();
    g.moveTo(w * 0.1, 0);
    g.lineTo(w * 0.34, 0);
    g.lineTo(w * 0.05, h);
    g.lineTo(0, h);
    g.lineTo(0, h * 0.5);
    g.closePath();
    g.fill();
    // the sticker's thin outline frame
    g.strokeStyle = frame.hex;
    g.lineWidth = 5;
    rr(g, 16, 16, w - 32, h - 32, 26);
    g.stroke();
    g.lineWidth = 1.5;
    rr(g, 25, 25, w - 50, h - 50, 20);
    g.stroke();
    const family = fontFamilyFor(t);
    const fit = fitRearWindow(t, w - 40, h - 40, { pad: 30, measure: fitMeasure(g, family, 800) });
    const { fill, stroke } = windowLetterColors(frame.id, frame.hex);
    g.font = `italic 800 ${fit.fontPx}px ${fit.font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    const lh = fit.fontPx * 1.08;
    const y0 = h / 2 - ((fit.lines.length - 1) * lh) / 2;
    fit.lines.forEach((ln, i) => {
      const y = y0 + i * lh + fit.fontPx * 0.04;
      g.lineWidth = Math.max(4, fit.fontPx * 0.12);
      g.strokeStyle = stroke;
      g.strokeText(ln, w / 2, y);
      g.fillStyle = fill;
      g.fillText(ln, w / 2, y);
    });
  };
  return liveTexture(256, 154, scaled(W, H, 256, 154, draw), { anisotropy: 4 }, t, 800);
}

/** The small oval roof badge (0.22 x 0.092 m): a pale oval with a dark rim and 2-4 letters. 128 x 54. */
export function makeBadgeTexture(text) {
  const W = 256;
  const H = 108;
  const draw = (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#f4f1ea';
    g.beginPath();
    g.ellipse(w / 2, h / 2, w / 2 - 4, h / 2 - 4, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1a1a22';
    g.lineWidth = 6;
    g.stroke();
    g.strokeStyle = '#c8322e';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(w / 2, h / 2, w / 2 - 14, h / 2 - 14, 0, 0, Math.PI * 2);
    g.stroke();
    const fit = fitBadge(text, w * 0.66, h * 0.7, { pad: 4, measure: fitMeasure(g, '"Bricolage Grotesque Variable", Impact, sans-serif', 800) });
    g.font = `800 ${fit.fontPx}px "Bricolage Grotesque Variable", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#1a1a22';
    g.fillText(fit.text, w / 2, h / 2 + fit.fontPx * 0.05);
  };
  return liveTexture(W, H, draw, { anisotropy: 4 }, text, 800);
}

// ---------------------------------------------------------------------------------------------------------------- mud-flaps

/** Painted flap art for MUDFLAP_STYLES id on black rubber (0.27 x 0.32 m): 128 x 152. */
export function makeFlapTexture(styleId) {
  const W = 128;
  const H = 152;
  const draw = (g, w, h) => {
    g.fillStyle = '#17141b';
    g.fillRect(0, 0, w, h);
    const border = (col, lw = 5) => {
      g.strokeStyle = col;
      g.lineWidth = lw;
      rr(g, lw, lw, w - lw * 2, h - lw * 2, 10);
      g.stroke();
    };
    switch (styleId) {
      case 'studs': {
        border('#8a8ea0', 3);
        for (let y = 14; y < h - 8; y += 18) {
          for (const x of [14, w - 14]) stud(g, x, y);
        }
        for (let x = 32; x < w - 20; x += 18) stud(g, x, 14);
        for (let i = 0; i < 6; i++) stud(g, 34 + (i % 3) * 30, 50 + Math.floor(i / 3) * 40);
        break;
      }
      case 'flowers': {
        border('#d6322e', 5);
        const flower = (cx, cy, R, c1, c2) => {
          g.fillStyle = c1;
          for (let p = 0; p < 6; p++) {
            const a = (p / 6) * Math.PI * 2;
            g.beginPath();
            g.arc(cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62, R * 0.46, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = c2;
          g.beginPath();
          g.arc(cx, cy, R * 0.34, 0, Math.PI * 2);
          g.fill();
        };
        g.fillStyle = '#2f8a4a';
        for (const [x, y, r] of [[30, 118, 0.6], [100, 110, 0.5], [64, 128, 0.7]]) {
          g.beginPath();
          g.ellipse(x, y, 24 * r, 9 * r, x, 0, Math.PI * 2);
          g.fill();
        }
        flower(64, 62, 30, '#ff3d9a', '#ffd23f');
        flower(26, 108, 14, '#ffc400', '#d6322e');
        flower(102, 104, 15, '#37e6ff', '#ffffff');
        flower(30, 28, 11, '#ffffff', '#ff8a2d');
        flower(100, 28, 11, '#ffffff', '#ff8a2d');
        break;
      }
      case 'eyes': {
        border('#ffffff', 4);
        const eye = (cx, cy, R) => {
          const ring = (r, c) => {
            g.fillStyle = c;
            g.beginPath();
            g.ellipse(cx, cy, r * 1.35, r, 0, 0, Math.PI * 2);
            g.fill();
          };
          ring(R, '#ffffff');
          ring(R * 0.78, '#2a6fe0');
          ring(R * 0.52, '#ffffff');
          ring(R * 0.3, '#111');
        };
        eye(64, 46, 24);
        eye(64, 112, 17);
        g.strokeStyle = '#d6322e';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(14, 78);
        g.lineTo(w - 14, 78);
        g.stroke();
        break;
      }
      case 'checker': {
        const s = 12;
        for (let y = 0; y < 2; y++) {
          for (let x = 0; x * s < w; x++) {
            g.fillStyle = (x + y) % 2 ? '#ffffff' : '#17141b';
            g.fillRect(x * s, y * s, s, s);
            g.fillStyle = (x + y) % 2 ? '#17141b' : '#ffffff';
            g.fillRect(x * s, h - (y + 1) * s, s, s);
          }
        }
        g.fillStyle = '#c8322e';
        g.fillRect(8, 30, w - 16, h - 60);
        g.fillStyle = '#ffffff';
        g.font = '800 34px "Bricolage Grotesque Variable", Impact, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('RS', w / 2, h / 2);
        break;
      }
      case 'peacock': {
        border('#ffc400', 4);
        const cx = 64;
        const cy = 60;
        for (let k = -4; k <= 4; k++) {
          g.strokeStyle = k % 2 ? '#2fb59a' : '#1d78d8';
          g.lineWidth = 5;
          g.beginPath();
          g.moveTo(cx, 128);
          g.quadraticCurveTo(cx + k * 10, 90, cx + k * 20, 28);
          g.stroke();
        }
        const feather = (x, y, R) => {
          g.fillStyle = '#ffc400';
          g.beginPath();
          g.ellipse(x, y, R * 1.15, R * 1.4, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#1d78d8';
          g.beginPath();
          g.ellipse(x, y, R * 0.85, R * 1.05, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#2fb59a';
          g.beginPath();
          g.ellipse(x, y, R * 0.5, R * 0.62, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#111';
          g.beginPath();
          g.arc(x, y, R * 0.2, 0, Math.PI * 2);
          g.fill();
        };
        feather(cx, cy - 6, 16);
        feather(cx - 38, cy + 8, 11);
        feather(cx + 38, cy + 8, 11);
        g.fillStyle = '#1d78d8';
        g.beginPath();
        g.ellipse(cx, 126, 12, 9, 0, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case 'black':
      default: {
        g.strokeStyle = 'rgba(255,255,255,0.1)';
        g.lineWidth = 3;
        rr(g, 8, 8, w - 16, h - 16, 10);
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.07)';
        g.lineWidth = 2;
        for (let y = 30; y < h - 12; y += 16) {
          g.beginPath();
          g.moveTo(16, y);
          g.lineTo(w - 16, y);
          g.stroke();
        }
        break;
      }
    }
  };
  return liveTexture(W, H, draw, { anisotropy: 4 });
}

function stud(g, x, y) {
  const gr = g.createRadialGradient(x - 2, y - 2, 1, x, y, 7);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(1, '#6e7388');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, 6.5, 0, Math.PI * 2);
  g.fill();
}

// ---------------------------------------------------------------------------------------------------------------- swish

/** Curved rainbow stripes for the broad rear pillar (0.48 x 0.9 m): 154 x 288. u runs towards the rear on both sides. */
export function makeSwishTexture(colors) {
  const W = 154;
  const H = 288;
  const draw = (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    const cols = colors && colors.length ? colors : ['#ff3d6e', '#ffb100', '#3dd68c', '#37a8ff'];
    cols.forEach((c, i) => {
      const o = (i - (cols.length - 1) / 2) * 20;
      g.strokeStyle = c;
      g.lineWidth = 15;
      g.beginPath();
      g.moveTo(-10 + o * 0.4, h * 0.98 + o * 0.2);
      g.bezierCurveTo(w * 0.85 + o, h * 0.82, w * 0.1 + o, h * 0.4, w * 1.05 + o * 0.3, h * 0.04);
      g.stroke();
      g.strokeStyle = shade(c, 0.45);
      g.lineWidth = 3;
      g.stroke();
    });
  };
  return liveTexture(128, 240, scaled(W, H, 128, 240, draw), { anisotropy: 4 });
}
