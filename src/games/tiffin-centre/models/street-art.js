// Painted / printed art for the street props, drawn with the 2D canvas into shared textures (stencils, plates, flex prints,
// hoardings, film posters, wall adverts, signboards, shutter ads, newsprint). Generic text only: no real brands, films or faces.
// Every material is cached; textures redraw when the Telugu / UI fonts finish loading. Node-safe (stub textures without a canvas).
import { DoubleSide, MeshStandardMaterial } from 'three';
import { FONT_TE, FONT_UI } from './textures.js';
import { drawnTexture } from './texgen.js';
import { redrawWhenFontsLoad, sharedMat, sharedTexture, texRes } from './util.js';

const HI = '"Noto Sans Devanagari","Nirmala UI","Mangal",sans-serif';
const BOLD = '"Arial Black","Impact","Bricolage Grotesque Variable",sans-serif';
const FONTS = [`700 40px ${FONT_TE}`, `800 40px ${FONT_UI}`, `700 40px ${HI}`];

const rr = (g, x, y, w, h, r) => {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
};
const rnd = (seed) => {
  let a = seed | 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Draws `draw(g, w, h)` (logical size w x h) at the current quality and caches it as a standard material (map + alpha). */
export function artMat(key, w, h, draw, { rough = 0.6, metal = 0, transparent = false, side, normal = null, nscale = 0.5, offset = false, text = '', emissive = null } = {}) {
  return sharedMat(`art:${key}`, () => {
    const f = Math.max(0.5, texRes(true) / 512);
    const tex = sharedTexture(`art:${key}:tex`, () => {
      const t = drawnTexture(Math.round(w * f), Math.round(h * f), (g) => {
        g.save();
        g.scale(f, f);
        draw(g, w, h);
        g.restore();
      });
      redrawWhenFontsLoad(t, FONTS, text || key);
      return t;
    });
    const m = new MeshStandardMaterial({ map: tex, vertexColors: true, roughness: rough, metalness: metal, transparent, depthWrite: !transparent, side: side ?? DoubleSide });
    if (offset) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
    }
    if (normal) {
      const s = normal();
      m.normalMap = s.normalMap;
      m.normalScale.set(nscale, nscale);
    }
    if (emissive) {
      m.emissiveMap = tex;
      m.emissive.set(emissive);
    }
    return m;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// shared brushes
function grime(g, w, h, seed, amount = 1, color = '60,50,40') {
  const r = rnd(seed);
  for (let i = 0; i < 26 * amount; i++) {
    const x = r() * w;
    const y = r() * h * 0.5;
    const len = h * (0.2 + r() * 0.7);
    const wd = 2 + r() * 14;
    const gr = g.createLinearGradient(0, y, 0, y + len);
    gr.addColorStop(0, `rgba(${color},${0.05 + r() * 0.1})`);
    gr.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = gr;
    g.fillRect(x, y, wd, len);
  }
}
function speck(g, w, h, n, seed, color = 'rgba(0,0,0,0.25)', size = 2) {
  const r = rnd(seed);
  g.fillStyle = color;
  for (let i = 0; i < n; i++) g.fillRect(r() * w, r() * h, 1 + r() * size, 1 + r() * size);
}
function chip(g, w, h, n, seed, maxR = 8) {
  const r = rnd(seed);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) {
    g.beginPath();
    g.ellipse(r() * w, r() * h, 1 + r() * maxR, 1 + r() * maxR * 0.6, r() * 3, 0, Math.PI * 2);
    g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.6})`;
    g.fill();
  }
  g.restore();
}
function fit(g, text, x, y, maxW, size, font, weight = 700) {
  let s = size;
  g.font = `${weight} ${s}px ${font}`;
  while (g.measureText(text).width > maxW && s > 8) {
    s -= 2;
    g.font = `${weight} ${s}px ${font}`;
  }
  g.fillText(text, x, y);
}

// ---------------------------------------------------------------------------------------------------------------------
export const lpgDecal = () =>
  artMat('lpg', 512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f3ecd8';
    fit(g, 'DOMESTIC', w / 2, 38, w - 60, 52, BOLD, 800);
    fit(g, 'L.P.G.', w / 2, 92, w - 60, 62, BOLD, 800);
    g.fillStyle = '#ffd24a';
    fit(g, 'వంట గ్యాస్', w / 2, 142, w - 120, 40, FONT_TE, 700);
    g.fillStyle = '#f3ecd8';
    g.strokeStyle = '#f3ecd8';
    g.lineWidth = 3;
    rr(g, 40, 168, w - 80, 70, 8);
    g.stroke();
    g.font = `700 20px ${FONT_UI}`;
    g.fillText('NET 14.2 KG   TARE 15.3 KG', w / 2, 188);
    g.font = `700 17px ${FONT_UI}`;
    g.fillText('KEEP AWAY FROM FIRE   |   TEST  C-27', w / 2, 218);
    chip(g, w, h, 26, 3, 7);
    speck(g, w, h, 140, 4, 'rgba(0,0,0,0.0)', 1);
  }, { transparent: true, rough: 0.55, offset: true, text: 'వంట గ్యాస్' });

export const numberPlate = (text = 'TS 09 UB 4382') =>
  artMat(`plate:${text}`, 512, 128, (g, w, h) => {
    g.fillStyle = '#e8b81c';
    rr(g, 0, 0, w, h, 14);
    g.fill();
    g.strokeStyle = '#1b1608';
    g.lineWidth = 5;
    rr(g, 8, 8, w - 16, h - 16, 9);
    g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.9)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fit(g, text, w / 2 + 6, h / 2 + 4, w - 70, 78, BOLD, 800);
    g.fillStyle = '#1b1608';
    g.beginPath();
    g.arc(26, 26, 5, 0, 6.3);
    g.arc(w - 26, h - 26, 5, 0, 6.3);
    g.fill();
    grime(g, w, h, 7, 0.6);
    speck(g, w, h, 160, 8, 'rgba(60,40,10,0.35)', 2);
  }, { rough: 0.5, text });

export const autoRearArt = () =>
  artMat('autoRear', 512, 256, (g, w, h) => {
    g.fillStyle = '#17120c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2c40d';
    rr(g, 10, 10, w - 20, 62, 10);
    g.fill();
    g.fillStyle = '#17120c';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fit(g, 'HORN OK PLEASE', w / 2, 42, w - 60, 44, BOLD, 800);
    g.fillStyle = '#f4f0e0';
    rr(g, 20, 88, w - 40, 70, 12);
    g.fill();
    g.fillStyle = '#c0261c';
    fit(g, 'माँ का आशीर्वाद', w / 2, 124, w - 90, 48, HI, 800);
    g.fillStyle = '#12908e';
    rr(g, 20, 172, w - 40, 62, 12);
    g.fill();
    g.fillStyle = '#fff4dc';
    fit(g, 'అమ్మ దీవెన', w / 2, 204, w - 90, 40, FONT_TE, 700);
    // flower + stars
    g.fillStyle = '#ff8a1f';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.ellipse(46 + Math.cos(i) * 9, 204 + Math.sin(i) * 9, 6, 6, 0, 0, 6.3);
      g.fill();
    }
    grime(g, w, h, 11, 0.8);
    speck(g, w, h, 160, 12, 'rgba(255,255,255,0.18)', 2);
  }, { rough: 0.45, text: 'माँ का आशीर्वाद అమ్మ దీవెన' });

export const autoSideArt = () =>
  artMat('autoSide', 512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#17120c';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fit(g, 'GOD IS GREAT', w / 2, 36, w - 40, 54, BOLD, 800);
    g.fillStyle = '#b3221a';
    fit(g, 'జై శ్రీ సాయి', w / 2, 92, w - 60, 44, FONT_TE, 700);
    chip(g, w, h, 18, 5, 6);
  }, { transparent: true, rough: 0.5, offset: true, text: 'జై శ్రీ సాయి' });

export const meterFace = () =>
  artMat('meter', 128, 64, (g, w, h) => {
    g.fillStyle = '#0a1208';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#9dff7a';
    g.font = `700 34px ${BOLD}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('₹ 48.0', w / 2, h / 2);
  }, { rough: 0.3, text: '48.0' });

export const moneyBoxSticker = () =>
  artMat('moneyBoxSticker', 256, 128, (g, w, h) => {
    g.fillStyle = '#c8941c';
    rr(g, 6, 6, w - 12, h - 12, 18);
    g.fill();
    g.fillStyle = '#8c1d14';
    rr(g, 14, 14, w - 28, h - 28, 12);
    g.fill();
    g.fillStyle = '#ffd86a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fit(g, 'శుభ లాభం', w / 2, h * 0.42, w - 60, 48, FONT_TE, 700);
    g.font = `800 20px ${FONT_UI}`;
    g.fillText('SHUBH LABH', w / 2, h * 0.78);
    chip(g, w, h, 14, 21, 5);
    grime(g, w, h, 22, 0.4);
  }, { rough: 0.4, text: 'శుభ లాభం', offset: true });

export const paniPuriDecal = () =>
  artMat('paniPuri', 512, 160, (g, w, h) => {
    g.fillStyle = '#e8c21a';
    rr(g, 0, 0, w, h, 16);
    g.fill();
    g.strokeStyle = '#b3221a';
    g.lineWidth = 8;
    rr(g, 8, 8, w - 16, h - 16, 12);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#b3221a';
    fit(g, 'పానీ పూరీ', w * 0.27, 54, w * 0.4, 52, FONT_TE, 700);
    fit(g, 'पानी पूरी', w * 0.73, 54, w * 0.38, 52, HI, 800);
    g.fillStyle = '#1c3a8a';
    fit(g, 'PANI PURI - 20 FOR ₹30', w / 2, 118, w - 60, 40, BOLD, 800);
    grime(g, w, h, 31, 0.7);
    speck(g, w, h, 90, 32, 'rgba(60,30,10,0.3)', 2);
  }, { rough: 0.5, text: 'పానీ పూరీ पानी पूरी' });

export const sackStencil = (text = 'BASMATI RICE') =>
  artMat(`sack:${text}`, 256, 192, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#7b1d16';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fit(g, text, w / 2, 56, w - 40, 38, BOLD, 800);
    g.fillStyle = '#1d3d7a';
    fit(g, '50 KG', w / 2, 112, w - 60, 40, BOLD, 800);
    g.strokeStyle = '#7b1d16';
    g.lineWidth = 5;
    rr(g, 18, 18, w - 36, h - 36, 6);
    g.stroke();
    chip(g, w, h, 80, 41, 6);
  }, { transparent: true, rough: 0.95, offset: true, text });

// ---------------------------------------------------------------------------------------------------------------------
/** Printed flex banner (vinyl): glossy colour print with halftone, border strip, contact line. Returns an OWNED texture. */
export function flexTexture({ text = 'TIFFIN CENTRE', te = '', colors = ['#d9261c', '#fff4dc', '#ffc83d'] } = {}) {
  const [bg, ink, accent] = colors;
  const f = Math.max(0.5, texRes(true) / 512);
  const W = 1024;
  const H = 256;
  const draw = (g) => {
    g.save();
    g.scale(f, f);
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, bg);
    gr.addColorStop(1, '#00000055');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    // halftone burst behind the text
    g.fillStyle = 'rgba(255,255,255,0.09)';
    for (let y = 0; y < H; y += 10) for (let x = (y / 10) % 2 ? 5 : 0; x < W; x += 10) {
      const d = Math.hypot(x - W / 2, (y - H / 2) * 2.2) / W;
      g.beginPath();
      g.arc(x, y, Math.max(0, 4.2 - d * 9), 0, 6.3);
      g.fill();
    }
    g.fillStyle = accent;
    g.fillRect(0, 0, W, 16);
    g.fillRect(0, H - 30, W, 30);
    g.fillStyle = bg;
    for (let x = 14; x < W; x += 36) {
      g.beginPath();
      g.arc(x, H - 15, 5, 0, 6.3);
      g.fill();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const big = te ? 78 : 104;
    g.lineJoin = 'round';
    g.lineWidth = 12;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.font = `800 ${big}px ${FONT_UI}`;
    const T = String(text).toUpperCase();
    const ty = te ? 78 : 112;
    g.strokeText(T, W / 2, ty, W - 140);
    g.fillStyle = accent;
    g.fillText(T, W / 2, ty - 2, W - 140);
    if (te) {
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.font = `700 72px ${FONT_TE}`;
      g.strokeText(te, W / 2, 170, W - 160);
      g.fillStyle = ink;
      g.fillText(te, W / 2, 168, W - 160);
    }
    g.fillStyle = ink;
    g.font = `700 22px ${FONT_UI}`;
    g.fillText('Ph: 98480 XXXXX   *   TIFFINS - CHAI - SNACKS   *   OPEN 6 AM', W / 2, H - 14, W - 60);
    // print flaws: faint horizontal banding and creases
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 1);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(W * 0.33, 0, 3, H);
    g.fillRect(W * 0.66, 0, 3, H);
    g.restore();
  };
  const tex = drawnTexture(Math.round(W * f), Math.round(H * f), draw);
  redrawWhenFontsLoad(tex, FONTS, String(text) + te);
  return tex;
}

// ---------------------------------------------------------------------------------------------------------------------
function charminar(g, cx, base, s, color, glow) {
  // simplified Charminar silhouette: four minarets, central arch block, small domes (a stylised illustration)
  g.save();
  g.translate(cx, base);
  g.scale(s, s);
  g.fillStyle = color;
  g.fillRect(-120, -150, 240, 150);
  g.fillRect(-135, -230, 40, 230);
  g.fillRect(95, -230, 40, 230);
  g.fillRect(-110, -250, 220, 26);
  for (const x of [-115, 115]) {
    g.beginPath();
    g.ellipse(x, -268, 16, 20, 0, Math.PI, 0);
    g.fill();
    g.fillRect(x - 3, -310, 6, 24);
  }
  for (const x of [-40, 0, 40]) {
    g.beginPath();
    g.ellipse(x, -262, 11, 16, 0, Math.PI, 0);
    g.fill();
  }
  g.fillStyle = glow;
  for (const x of [-70, 0, 70]) {
    g.beginPath();
    g.moveTo(x - 22, 0);
    g.lineTo(x - 22, -70);
    g.quadraticCurveTo(x, -118, x + 22, -70);
    g.lineTo(x + 22, 0);
    g.fill();
  }
  for (const x of [-60, 0, 60]) g.fillRect(x - 6, -190, 12, 22);
  g.restore();
}

/** Painted hoarding, 1024 x 640. kind: 'charminar' | 'hanuman' (a generic devotional icon: mace, sun, lotus, no face) | 'film'. */
export const hoardingArt = (kind = 'charminar') =>
  artMat(`hoarding:${kind}`, 1024, 640, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    if (kind === 'hanuman') {
      sky.addColorStop(0, '#ff8a1f');
      sky.addColorStop(1, '#a8240f');
    } else if (kind === 'film') {
      sky.addColorStop(0, '#1d2a6b');
      sky.addColorStop(1, '#e24a2a');
    } else {
      sky.addColorStop(0, '#f3b36a');
      sky.addColorStop(0.6, '#f7d9a0');
      sky.addColorStop(1, '#d9a56a');
    }
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (kind === 'charminar') {
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.arc(w * 0.78, h * 0.2, 70, 0, 6.3);
      g.fill();
      charminar(g, w / 2, h * 0.84, 1.15, '#6d4a3a', '#f3c98a');
      g.fillStyle = 'rgba(255,240,210,0.12)';
      g.fillRect(0, h * 0.5, w, h * 0.34); // haze
      g.fillStyle = '#4a2a1a';
      fit(g, 'హైదరాబాద్', w / 2, 62, w - 100, 78, FONT_TE, 700);
      g.fillStyle = '#8c1d14';
      fit(g, 'HYDERABAD - CITY OF PEARLS', w / 2, h - 70, w - 120, 46, BOLD, 800);
      g.fillStyle = '#1d3d7a';
      fit(g, 'Where every cup has a story', w / 2, h - 28, w - 200, 28, FONT_UI, 700);
    } else if (kind === 'hanuman') {
      g.fillStyle = '#ffd24a';
      g.beginPath();
      g.arc(w / 2, h * 0.46, 150, 0, 6.3);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * 6.283;
        g.beginPath();
        g.moveTo(w / 2 + Math.cos(a) * 160, h * 0.46 + Math.sin(a) * 160);
        g.lineTo(w / 2 + Math.cos(a + 0.06) * 260, h * 0.46 + Math.sin(a + 0.06) * 260);
        g.lineTo(w / 2 + Math.cos(a + 0.12) * 160, h * 0.46 + Math.sin(a + 0.12) * 160);
        g.fill();
      }
      // gada (mace) and lotus
      g.fillStyle = '#7a1e12';
      g.fillRect(w / 2 - 12, h * 0.46 - 20, 24, 210);
      g.beginPath();
      g.arc(w / 2, h * 0.46 - 40, 62, 0, 6.3);
      g.fill();
      g.fillStyle = '#ffe9a8';
      g.beginPath();
      g.arc(w / 2 - 14, h * 0.46 - 56, 18, 0, 6.3);
      g.fill();
      g.fillStyle = '#f7c0cf';
      for (let i = -3; i <= 3; i++) {
        g.beginPath();
        g.ellipse(w / 2 + i * 38, h * 0.82, 22, 56, i * 0.28, 0, 6.3);
        g.fill();
      }
      g.fillStyle = '#fff4dc';
      fit(g, 'జై హనుమాన్', w / 2, 58, w - 100, 82, FONT_TE, 700);
      fit(g, 'जय बजरंग बली', w / 2, h - 36, w - 140, 54, HI, 800);
    } else {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.moveTo(w * 0.3, h);
      g.quadraticCurveTo(w * 0.32, h * 0.35, w * 0.42, h * 0.3);
      g.quadraticCurveTo(w * 0.52, h * 0.35, w * 0.56, h);
      g.fill();
      g.beginPath();
      g.moveTo(w * 0.58, h);
      g.quadraticCurveTo(w * 0.62, h * 0.4, w * 0.72, h * 0.34);
      g.quadraticCurveTo(w * 0.82, h * 0.42, w * 0.86, h);
      g.fill();
      g.fillStyle = '#ffd24a';
      fit(g, 'గులాబీ రాత్రులు', w / 2, 80, w - 100, 92, FONT_TE, 700);
      g.fillStyle = '#fff4dc';
      fit(g, 'GULABI NIGHTS', w / 2, 170, w - 160, 70, BOLD, 800);
      g.font = `700 26px ${FONT_UI}`;
      g.fillText('IN CINEMAS THIS FRIDAY', w / 2, h - 36);
    }
    // weathering: sun fade, peeling, drips
    g.fillStyle = 'rgba(255,245,225,0.08)';
    g.fillRect(0, 0, w, h);
    grime(g, w, h, 55, 1.2, '80,50,30');
    speck(g, w, h, 500, 56, 'rgba(70,40,20,0.25)', 3);
    g.fillStyle = 'rgba(120,70,30,0.35)';
    for (const [x, y, s] of [[0, 0, 80], [w - 60, 0, 60], [0, h - 70, 70], [w - 90, h - 90, 90]]) {
      g.beginPath();
      g.ellipse(x + s / 2, y + s / 2, s / 2, s / 3, 0.6, 0, 6.3);
      g.fill();
    }
  }, { rough: 0.7, text: 'హైదరాబాద్ జై హనుమాన్ गులాబీ' });

/** Faded film poster, 512 x 768 (generic invented titles, silhouettes only). */
export const filmPosterArt = (seed = 1) => {
  const titles = [['రాజా మార్గం', 'RAJA MAARGAM'], ['గులాబీ రాత్రులు', 'GULABI NIGHTS'], ['మహానది రాజు', 'MAHANADI RAJU'], ['चाँद का टुकड़ा', 'CHAAND KA TUKDA']];
  const [te, en] = titles[Math.abs(seed) % titles.length];
  const pal = [['#8c1d14', '#f0b23c'], ['#12508e', '#f4d77a'], ['#2f6b3a', '#e6d27a'], ['#6a2a7a', '#f2b27a']][Math.abs(seed >> 2) % 4];
  return artMat(`film:${seed}`, 512, 768, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, pal[0]);
    gr.addColorStop(1, '#1a1210');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = pal[1];
    g.beginPath();
    g.arc(w * 0.5, h * 0.42, 130, 0, 6.3);
    g.fill();
    // silhouettes (no faces)
    g.fillStyle = 'rgba(15,10,8,0.85)';
    for (const [x, s] of [[0.32, 1], [0.68, 0.9]]) {
      g.beginPath();
      g.ellipse(w * x, h * 0.5, 40 * s, 52 * s, 0, 0, 6.3);
      g.fill();
      g.beginPath();
      g.moveTo(w * x - 90 * s, h * 0.9);
      g.quadraticCurveTo(w * x, h * 0.46 * 1.1, w * x + 90 * s, h * 0.9);
      g.fill();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = pal[1];
    fit(g, te, w / 2, 70, w - 60, 68, FONT_TE, 700);
    g.fillStyle = '#fff4dc';
    fit(g, en, w / 2, 135, w - 80, 46, BOLD, 800);
    g.font = `700 20px ${FONT_UI}`;
    g.fillText('A FILM IN ASSOCIATION WITH SOMEBODY PICTURES', w / 2, h - 60);
    g.fillText('MUSIC  *  STORY  *  DIRECTION', w / 2, h - 30);
    // fade + stains + tape
    g.fillStyle = 'rgba(235,225,205,0.32)';
    g.fillRect(0, 0, w, h);
    grime(g, w, h, 70 + seed, 1.6, '70,50,30');
    speck(g, w, h, 400, 71 + seed, 'rgba(255,255,255,0.15)', 3);
    g.fillStyle = 'rgba(220,200,150,0.6)';
    g.fillRect(w * 0.4, -8, 90, 34);
    g.fillRect(w - 50, h * 0.5, 34, 80);
    // a handbill pasted over the corner
    g.fillStyle = '#d9d2bd';
    g.fillRect(w - 170, h - 210, 170, 210);
    g.fillStyle = '#4a4036';
    g.font = `800 28px ${FONT_UI}`;
    g.fillText('SALE', w - 85, h - 160);
    g.font = `700 16px ${FONT_UI}`;
    for (let i = 0; i < 5; i++) g.fillText('-------- ----- ---', w - 85, h - 120 + i * 22);
  }, { rough: 0.85, text: te + en });
};

/** Wall-painted advert on plaster, 1024 x 512. kind: 'clinic' | 'tuition' | 'cement'. */
export const wallAdvertArt = (kind = 'clinic') => {
  const sets = {
    clinic: { bg: '#cfc3a8', band: '#1d4d8c', te: 'డా. రావు డెంటల్ క్లినిక్', en: "DR. RAO'S DENTAL CLINIC", sub: 'Root canal * Braces * Implants   Ph: 040-2XXXXXXX' },
    tuition: { bg: '#d9cdb0', band: '#8c1d14', te: 'శ్రీ సాయి ట్యూషన్స్', en: 'SRI SAI TUITIONS', sub: 'Maths * Science * English  - Classes 6 to 10' },
    cement: { bg: '#c7bda4', band: '#1d6d3c', te: 'వజ్ర సిమెంట్', en: 'VAJRA CEMENT - STRONG FOUNDATIONS', sub: 'Dealer: Venkata Ramana Traders' },
  };
  const s = sets[kind] || sets.clinic;
  return artMat(`wallad:${kind}`, 1024, 512, (g, w, h) => {
    g.fillStyle = s.bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = s.band;
    g.fillRect(30, 30, w - 60, 120);
    g.fillStyle = '#fff4dc';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fit(g, s.te, w / 2, 92, w - 120, 84, FONT_TE, 700);
    g.fillStyle = s.band;
    fit(g, s.en, w / 2, 232, w - 100, 62, BOLD, 800);
    g.fillStyle = '#2a2018';
    fit(g, s.sub, w / 2, 320, w - 120, 36, FONT_UI, 700);
    g.strokeStyle = s.band;
    g.lineWidth = 8;
    g.strokeRect(24, 24, w - 48, h - 48);
    // brush irregularity + drips + peeling plaster
    const r = rnd(81);
    g.fillStyle = s.band;
    for (let i = 0; i < 9; i++) g.fillRect(60 + r() * (w - 120), 150, 3 + r() * 4, 20 + r() * 70);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 16; i++) g.fillRect(r() * w, r() * h, 20 + r() * 120, 2);
    grime(g, w, h, 82, 1.8, '90,70,50');
    speck(g, w, h, 900, 83, 'rgba(70,50,30,0.3)', 3);
    g.fillStyle = 'rgba(90,60,40,0.3)';
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.ellipse(r() * w, r() * h, 20 + r() * 50, 10 + r() * 30, r() * 3, 0, 6.3);
      g.fill();
    }
  }, { rough: 0.9, text: s.te + s.en });
};

/** Hand-painted tin signboard. lines: [{ text, font?: 'te'|'hi'|'en', size?, color? }] */
export function signboardArt(id, lines, { base = '#f4ead2', edge = '#1f5fa8', ink = '#c0301f', w = 1024, h = 320 } = {}) {
  return artMat(`sign:${id}`, w, h, (g) => {
    g.fillStyle = edge;
    rr(g, 0, 0, w, h, 26);
    g.fill();
    g.fillStyle = base;
    rr(g, 18, 18, w - 36, h - 36, 14);
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((ln, i) => {
      const font = ln.font === 'te' ? FONT_TE : ln.font === 'hi' ? HI : BOLD;
      const y = 18 + ((h - 36) * (i + 0.5)) / n;
      g.fillStyle = 'rgba(0,0,0,0.18)';
      fit(g, ln.text, w / 2 + 3, y + 3, w - 120, ln.size || 70, font, 800);
      g.fillStyle = ln.color || ink;
      fit(g, ln.text, w / 2, y, w - 120, ln.size || 70, font, 800);
    });
    g.fillStyle = '#5b5650';
    for (const [x, y] of [[40, 40], [w - 40, 40], [40, h - 40], [w - 40, h - 40]]) {
      g.beginPath();
      g.arc(x, y, 7, 0, 6.3);
      g.fill();
    }
    // rust bleed from the screws and chipped enamel
    g.fillStyle = 'rgba(140,70,30,0.35)';
    for (const [x, y] of [[40, 40], [w - 40, 40], [40, h - 40], [w - 40, h - 40]]) g.fillRect(x - 5, y, 10, 40 + (x % 30));
    grime(g, w, h, 91, 1.2, '70,40,20');
    speck(g, w, h, 300, 92, 'rgba(60,40,30,0.3)', 3);
    chip(g, w, h, 20, 93, 9);
  }, { rough: 0.5, metal: 0.3, text: lines.map((l) => l.text).join('') });
}

/** Rolled steel shutter of a kirana shop, 512 x 512: grey-green paint, rust, handbills, graffiti and ad stickers. */
export const shutterArt = () =>
  artMat('shutter', 512, 512, (g, w, h) => {
    g.fillStyle = '#5d6b64';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(0, y, w, 3);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(0, y + 12, w, 4);
    }
    const r = rnd(101);
    // paint ads: lettering + stickers
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f4ead2';
    fit(g, 'NO PARKING', w / 2, 70, w - 120, 56, BOLD, 800);
    g.fillStyle = '#e8c21a';
    fit(g, 'పార్కింగ్ నిషేధం', w / 2, 128, w - 120, 40, FONT_TE, 700);
    g.fillStyle = '#c0301f';
    rr(g, 30, 210, 190, 130, 8);
    g.fill();
    g.fillStyle = '#fff4dc';
    fit(g, 'COLD DRINKS', 125, 250, 170, 34, BOLD, 800);
    fit(g, 'ICE CREAMS', 125, 295, 170, 34, BOLD, 800);
    g.fillStyle = '#1d4d8c';
    rr(g, 290, 190, 190, 90, 8);
    g.fill();
    g.fillStyle = '#fff4dc';
    fit(g, 'RECHARGE', 385, 222, 170, 30, BOLD, 800);
    fit(g, 'PHONE REPAIR', 385, 256, 170, 26, BOLD, 800);
    // handbills + posters (torn paper)
    for (let i = 0; i < 4; i++) {
      g.fillStyle = ['#e9e0c7', '#d9c27a', '#c7d9e0', '#e0b8b0'][i];
      const x = 40 + r() * 380;
      const y = 340 + r() * 120;
      g.fillRect(x, y, 70 + r() * 40, 60 + r() * 40);
      g.fillStyle = 'rgba(40,36,32,0.55)';
      for (let k = 0; k < 6; k++) g.fillRect(x + 6, y + 8 + k * 9, 50, 2);
    }
    // graffiti
    g.strokeStyle = 'rgba(230,230,230,0.7)';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(300, 360);
    g.bezierCurveTo(340, 320, 380, 400, 420, 350);
    g.bezierCurveTo(440, 330, 460, 380, 470, 360);
    g.stroke();
    // rust streaks, dents, dirt
    for (let i = 0; i < 30; i++) {
      const x = r() * w;
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(140,70,30,0)');
      gr.addColorStop(0.5, `rgba(140,70,30,${0.08 + r() * 0.2})`);
      gr.addColorStop(1, 'rgba(140,70,30,0)');
      g.fillStyle = gr;
      g.fillRect(x, 0, 2 + r() * 8, h);
    }
    grime(g, w, h, 102, 2, '40,30,20');
    speck(g, w, h, 700, 103, 'rgba(0,0,0,0.25)', 3);
  }, { rough: 0.55, metal: 0.3, text: 'పార్కింగ్ నిషేధం' });

/** Newspaper, 512 x 512 (tiling): columns of fine print, headlines, halftone photos. */
export const newsprintArt = () =>
  artMat('newsprint', 512, 512, (g, w, h) => {
    g.fillStyle = '#e4dcc4';
    g.fillRect(0, 0, w, h);
    const r = rnd(111);
    g.fillStyle = 'rgba(30,26,22,0.78)';
    g.textBaseline = 'top';
    g.font = `800 40px ${FONT_TE}`;
    g.fillText('రాష్ట్రంలో భారీ వర్షాలు', 14, 8, w - 28);
    g.font = `900 46px ${BOLD}`;
    g.fillText('CITY BUS FARE HIKED', 14, 58, w - 28);
    for (let c = 0; c < 4; c++) {
      const x = 14 + c * 124;
      for (let y = 124; y < h - 14; y += 8) {
        const len = 70 + r() * 36;
        g.fillRect(x, y, len, 2.2);
      }
    }
    g.fillStyle = 'rgba(60,56,50,0.55)';
    g.fillRect(262, 130, 110, 80);
    g.fillStyle = 'rgba(30,26,22,0.4)';
    for (let y = 130; y < 210; y += 4) for (let x = 262; x < 372; x += 4) if (r() > 0.5) g.fillRect(x, y, 2, 2);
    grime(g, w, h, 112, 1, '120,90,40');
    speck(g, w, h, 300, 113, 'rgba(60,40,20,0.2)', 2);
  }, { rough: 0.92, text: 'రాష్ట్రంలో' });

