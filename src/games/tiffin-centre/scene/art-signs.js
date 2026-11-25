// Canvas painters for signage and small sprites: the flex banner (front and ghosted back), the menu board, enamel plates, posters, rooftop
// hoardings, Hyderabad shopfronts (kirana, medical, sweets, mobile repair, shuttered shops), upper-storey building faces with a night-light
// mask, road decals, and the small sprites the effects use. Text is drawn with web fonts, so `redrawText()` repaints once they load.
// All names and numbers are generic: no real brands, no real people.
import { DISHES } from '../../../../shared/tiffin-centre/catalog.js';
import { FONT_UI, FONT_TE, FONT_HI } from './textures.js';

const rgba = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Text shrunk to fit `maxW`, with an optional outline. */
function fit(g, str, x, y, font, size, maxW, fill, stroke = null, lw = 0) {
  let px = size;
  g.font = `${font.replace('{px}', px)}`;
  while (px > 8 && g.measureText(str).width > maxW) {
    px -= 2;
    g.font = font.replace('{px}', px);
  }
  g.lineJoin = 'round';
  if (stroke) {
    g.lineWidth = lw || px * 0.14;
    g.strokeStyle = stroke;
    g.strokeText(str, x, y);
  }
  g.fillStyle = fill;
  g.fillText(str, x, y);
  return px;
}

export function makeSigns(T, { canvasTexture, mulberry }) {
  const redraws = [];
  const track = (tex) => {
    redraws.push(tex);
    return T(tex);
  };

  // --- the flex banner -----------------------------------------------------------------------------------------------------------------------
  const paintBanner = (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#e23a22');
    gr.addColorStop(1, '#b9211a');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffc83d';
    g.fillRect(0, 0, w, 12);
    g.fillRect(0, h - 12, w, 12);
    g.fillStyle = '#fff4dc';
    for (let x = 24; x < w; x += 48) {
      g.beginPath(); g.arc(x, 6, 3, 0, 7); g.arc(x, h - 6, 3, 0, 7); g.fill();
    }
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    fit(g, 'TIFFIN CENTRE', w / 2, 124, `900 {px}px ${FONT_UI}`, 108, w - 120, '#fff4dc', '#5a0f0a', 12);
    fit(g, 'టిఫిన్ సెంటర్', w / 2, 196, `700 {px}px ${FONT_TE}`, 62, w - 200, '#ffd34d', '#5a0f0a', 8);
    g.font = `700 22px ${FONT_UI}`;
    g.fillStyle = '#fff4dc';
    g.textAlign = 'left';
    g.fillText('IDLY  DOSA  POORI  VADA', 34, 44);
    g.textAlign = 'right';
    g.fillText('IRANI CHAI  BAJJI', w - 34, 44);
    g.fillStyle = '#fff4dc';
    g.beginPath();
    for (const [x, y] of [[14, 22], [w - 14, 22], [14, h - 22], [w - 14, h - 22]]) { g.moveTo(x + 5, y); g.arc(x, y, 5, 0, 7); }
    g.fill();
  };
  const banner = () => track(canvasTexture(1024, 224, paintBanner, { anisotropy: 8 }));
  /** The flex seen from behind: the print ghosting through the white backing (mirrored, washed out). */
  const bannerBack = () =>
    track(canvasTexture(512, 112, (g, w, h) => {
      g.fillStyle = '#e8e4da';
      g.fillRect(0, 0, w, h);
      g.save();
      g.globalAlpha = 0.3;
      g.translate(w, 0);
      g.scale(-w / 1024, h / 224);
      paintBanner(g, 1024, 224);
      g.restore();
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(120,100,80,0.18)';
      for (let i = 0; i < 4; i++) g.fillRect(0, 12 + i * 30, w, 2);
    }, { anisotropy: 4 }));

  // --- menu board (painted hardboard, chalk-white names and yellow prices) ---------------------------------------------------------------------
  const menuBoard = () => {
    let items = [];
    const rnd = mulberry(5);
    const tex = track(canvasTexture(512, 400, (g, w, h) => {
      g.fillStyle = '#1a3a2e';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,255,255,${0.02 + rnd() * 0.04})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2); }
      g.strokeStyle = '#8a5a34';
      g.lineWidth = 18;
      g.strokeRect(9, 9, w - 18, h - 18);
      g.strokeStyle = '#3a2412';
      g.lineWidth = 2;
      g.strokeRect(18, 18, w - 36, h - 36);
      g.textAlign = 'center';
      g.fillStyle = '#ffd34d';
      g.font = `800 38px ${FONT_UI}`;
      g.fillText('MENU  ·  మెనూ', w / 2, 66);
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(40, 80);
      g.lineTo(w - 40, 80);
      g.stroke();
      const list = items.length ? items : ['dosa', 'masala_dosa', 'idly', 'irani_chai'];
      const two = list.length > 6;
      const rows = two ? Math.ceil(list.length / 2) : list.length;
      const rowH = Math.min(46, (h - 130) / rows);
      list.forEach((id, i) => {
        const d = DISHES[id];
        if (!d) return;
        const col = two ? i % 2 : 0;
        const row = two ? Math.floor(i / 2) : i;
        const x0 = two ? 32 + col * 236 : 44;
        const x1 = two ? x0 + 206 : w - 44;
        const y = 122 + row * rowH;
        g.textAlign = 'left';
        g.fillStyle = '#fff4dc';
        g.font = `700 ${two ? 19 : 25}px ${FONT_UI}`;
        g.fillText(d.name.replace(/ \(.*\)/, ''), x0, y);
        g.textAlign = 'right';
        g.fillStyle = '#ffd34d';
        g.fillText(`₹${d.price}`, x1, y);
        g.strokeStyle = 'rgba(255,255,255,0.18)';
        g.setLineDash([3, 5]);
        g.beginPath();
        g.moveTo(x0, y + 8);
        g.lineTo(x1, y + 8);
        g.stroke();
        g.setLineDash([]);
      });
    }, { anisotropy: 8 }));
    return {
      tex,
      set(ids) {
        const next = (ids || []).join(',');
        if (next === items.join(',')) return;
        items = ids || [];
        tex.userData.redraw();
      },
    };
  };

  /** Enamel-plated sign on the counter front, chipped at the corners. */
  const enamel = () =>
    track(canvasTexture(512, 160, (g, w, h) => {
      const r = mulberry(7);
      g.fillStyle = '#f2ead8';
      rr(g, 0, 0, w, h, 16);
      g.fill();
      g.strokeStyle = '#1d4f9a';
      g.lineWidth = 10;
      rr(g, 9, 9, w - 18, h - 18, 10);
      g.stroke();
      g.textAlign = 'center';
      fit(g, 'TIFFIN CENTRE', w / 2, 74, `900 {px}px ${FONT_UI}`, 56, w - 70, '#1d4f9a');
      fit(g, 'టిఫిన్ సెంటర్  ·  ఇరానీ చాయ్', w / 2, 112, `700 {px}px ${FONT_TE}`, 28, w - 80, '#b8261c');
      g.font = `700 16px ${FONT_UI}`;
      g.fillStyle = '#444';
      g.fillText('SINCE 1989  ·  FRESH & HOT', w / 2, 140);
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 26; i++) {
        const side = i % 4;
        const cx = side < 2 ? (side ? w : 0) + (r() - 0.5) * 24 : r() * w;
        const cy = side < 2 ? r() * h : (side === 2 ? 0 : h) + (r() - 0.5) * 18;
        g.beginPath();
        g.arc(cx, cy, 2 + r() * 5, 0, 7);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(80,50,20,0.14)';
      for (let i = 0; i < 40; i++) g.fillRect(r() * w, r() * h, 2 + r() * 8, 1 + r() * 3);
    }, { anisotropy: 4 }));

  // --- posters --------------------------------------------------------------------------------------------------------------------------------
  const poster = (seed = 1) =>
    track(canvasTexture(256, 384, (g, w, h) => {
      const r = mulberry(400 + seed);
      const hues = [[220, 40, 40], [30, 130, 200], [250, 190, 30], [40, 150, 90], [150, 50, 160]];
      const [cr, cg, cb] = hues[seed % hues.length];
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, rgba(cr, cg, cb));
      gr.addColorStop(1, rgba(cr * 0.4, cg * 0.4, cb * 0.4));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,240,200,0.92)';
      g.beginPath(); g.arc(w * (0.3 + r() * 0.4), h * 0.34, 54, 0, 7); g.fill();
      g.fillStyle = 'rgba(20,10,10,0.75)';
      g.fillRect(w * 0.3, h * 0.38, w * 0.4, h * 0.34);
      g.textAlign = 'center';
      fit(g, ['MASS', 'BIRYANI', 'SALE', 'CHAI', 'RAJA'][seed % 5], w / 2, h * 0.86, `900 {px}px ${FONT_UI}`, 46, w - 30, '#fff4dc');
      g.font = `700 22px ${FONT_UI}`;
      g.fillStyle = '#fff4dc';
      g.fillText('NOW SHOWING', w / 2, h * 0.94);
      // torn corner and tape
      g.fillStyle = 'rgba(230,220,190,0.6)';
      g.fillRect(w / 2 - 18, 0, 36, 14);
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.moveTo(w, h); g.lineTo(w - 40, h); g.lineTo(w, h - 52); g.fill();
      g.globalCompositeOperation = 'source-over';
    }, { anisotropy: 4 }));

  /** Rooftop flex hoarding, generic art. */
  const hoarding = (kind = 0) =>
    track(canvasTexture(512, 256, (g, w, h) => {
      const r = mulberry(600 + kind);
      g.textAlign = 'center';
      if (kind % 4 === 0) {
        const gr = g.createLinearGradient(0, 0, w, h);
        gr.addColorStop(0, '#7a0f2e');
        gr.addColorStop(1, '#d6592a');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 40; i++) { g.fillStyle = rgba(255, 210, 90, 0.2 + r() * 0.5); g.beginPath(); g.arc(r() * w, r() * h, 2 + r() * 6, 0, 7); g.fill(); }
        fit(g, 'MEGA SALE', w / 2, 120, `900 {px}px ${FONT_UI}`, 100, w - 40, '#ffe27a', '#4a0a14', 10);
        fit(g, 'FLAT 50% OFF', w / 2, 188, `800 {px}px ${FONT_UI}`, 60, w - 60, '#fff4dc');
        fit(g, 'పండుగ ఆఫర్', w / 2, 236, `700 {px}px ${FONT_TE}`, 34, w - 80, '#ffd34d');
      } else if (kind % 4 === 1) {
        g.fillStyle = '#12304a';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#d9e6f0';
        for (let i = 0; i < 5; i++) { const bh = 70 + r() * 90; g.fillRect(30 + i * 56, h - 40 - bh, 44, bh); }
        g.fillStyle = '#f4c542';
        for (let i = 0; i < 5; i++) for (let j = 0; j < 8; j++) if (r() < 0.7) g.fillRect(36 + i * 56 + (j % 2) * 18, h - 52 - j * 18, 8, 10);
        fit(g, 'SKYLINE HEIGHTS', 365, 90, `900 {px}px ${FONT_UI}`, 44, 220, '#fff4dc');
        fit(g, '2 & 3 BHK LUXURY FLATS', 365, 128, `700 {px}px ${FONT_UI}`, 22, 220, '#f4c542');
        fit(g, 'Call: 98xxx xxxxx', 365, 170, `700 {px}px ${FONT_UI}`, 24, 220, '#ffffff');
      } else if (kind % 4 === 2) {
        g.fillStyle = '#f2f0e4';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#1c7a4a';
        g.fillRect(0, 0, w, 60);
        fit(g, 'SMART COACHING', w / 2, 44, `900 {px}px ${FONT_UI}`, 42, w - 40, '#fff4dc');
        fit(g, 'JEE · NEET · EAMCET', w / 2, 130, `800 {px}px ${FONT_UI}`, 50, w - 40, '#c2271d');
        fit(g, 'New batches start 1st of every month', w / 2, 180, `600 {px}px ${FONT_UI}`, 24, w - 40, '#222');
        fit(g, 'కోచింగ్ సెంటర్', w / 2, 226, `700 {px}px ${FONT_TE}`, 32, w - 60, '#1c7a4a');
      } else {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, '#2a1a08');
        gr.addColorStop(1, '#6a4510');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#ffd34d';
        g.lineWidth = 6;
        g.strokeRect(12, 12, w - 24, h - 24);
        fit(g, 'LAKSHMI GOLD', w / 2, 112, `900 {px}px ${FONT_UI}`, 70, w - 60, '#ffd34d');
        fit(g, 'PURE · TRUSTED · SINCE 1975', w / 2, 160, `700 {px}px ${FONT_UI}`, 26, w - 60, '#fff4dc');
        fit(g, 'లక్ష్మి జ్యువెలర్స్', w / 2, 212, `700 {px}px ${FONT_TE}`, 34, w - 60, '#ffe9a8');
      }
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 6; i++) g.fillRect(0, 20 + i * 40, w, 2);
    }, { anisotropy: 4 }));

  // --- shopfronts: 512 x 352 = 5.0 m x 3.44 m, the lit parts in a second (emissive) canvas ----------------------------------------------------
  const shopCanvas = (paint, light) => ({
    map: track(canvasTexture(512, 352, (g, w, h) => paint(g, w, h, mulberry(77)), { anisotropy: 8 })),
    emis: track(canvasTexture(256, 176, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); light(g, w, h); }, { srgb: true, anisotropy: 2 })),
  });
  const wall = (g, w, h, color, r) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${60 + r() * 60 | 0},${50 + r() * 50 | 0},${40 + r() * 40 | 0},${0.04 + r() * 0.09})`; g.fillRect(r() * w, r() * h, 1 + r() * 6, 1 + r() * 4); }
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(40,30,20,${0.04 + r() * 0.07})`; g.fillRect(r() * w, 60 + r() * 30, 2 + r() * 5, 30 + r() * 220); }
  };
  const shutterSlats = (g, x, y, w, h) => {
    g.fillStyle = '#7e8a90';
    g.fillRect(x, y, w, h);
    for (let yy = y; yy < y + h; yy += 7) {
      g.fillStyle = 'rgba(255,255,255,0.2)';
      g.fillRect(x, yy, w, 2);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x, yy + 4, w, 2);
    }
  };
  const packets = (g, x0, y0, w, h, r, cols) => {
    for (let yy = y0; yy < y0 + h - 4; yy += 14) {
      for (let xx = x0; xx < x0 + w - 8;) {
        const bw = 8 + r() * 14;
        g.fillStyle = cols[(r() * cols.length) | 0];
        g.fillRect(xx, yy, bw, 12);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(xx, yy, bw, 2);
        xx += bw + 2;
      }
    }
  };

  const kirana = () => shopCanvas((g, w, h, r) => {
    wall(g, w, h, '#d7b457', r);
    g.fillStyle = '#1d4a9a';
    g.fillRect(14, 14, w - 28, 74);
    g.strokeStyle = '#fff4dc';
    g.lineWidth = 3;
    g.strokeRect(20, 20, w - 40, 62);
    g.textAlign = 'center';
    fit(g, 'SRI LAXMI KIRANA & GENERAL STORES', w / 2, 52, `900 {px}px ${FONT_UI}`, 26, w - 60, '#fff4dc');
    fit(g, 'శ్రీ లక్ష్మి కిరాణా జనరల్ స్టోర్స్', w / 2, 76, `700 {px}px ${FONT_TE}`, 20, w - 70, '#ffd34d');
    g.fillStyle = '#251a12';
    g.fillRect(28, 108, w - 56, h - 108);
    g.fillStyle = '#ffeab0';
    g.fillRect(28, 108, w - 56, 14);
    for (let s = 0; s < 4; s++) {
      g.fillStyle = '#4a3422';
      g.fillRect(36, 140 + s * 44, w - 72, 4);
      packets(g, 40, 118 + s * 44, w - 80, 24, r, ['#d83a2a', '#f2c21a', '#2a8a4a', '#2a62c4', '#f0e8d0', '#e87a1a']);
    }
    for (let i = 0; i < 24; i++) { g.fillStyle = ['#d83a2a', '#f2c21a', '#2a8a4a', '#e87a1a'][i % 4]; g.fillRect(40 + i * 18, 112, 10, 30 + (i % 3) * 8); }
    shutterSlats(g, 28, 98, w - 56, 26);
    g.fillStyle = '#c8b690';
    g.beginPath(); g.ellipse(120, h - 28, 46, 26, 0, 0, 7); g.ellipse(214, h - 24, 40, 24, 0, 0, 7); g.fill();
    g.fillStyle = '#9a8a68';
    g.fillRect(100, h - 34, 40, 5);
  }, (g, w, h) => {
    g.fillStyle = '#ffe6a0';
    g.fillRect(14, 54, w - 28, h - 54);
    g.fillStyle = '#7a8cff';
    g.fillRect(8, 8, w - 16, 34);
  });

  const medical = () => shopCanvas((g, w, h, r) => {
    wall(g, w, h, '#dfe6df', r);
    g.fillStyle = '#16794a';
    g.fillRect(14, 14, w - 28, 76);
    g.fillStyle = '#fff';
    g.fillRect(28, 24, 54, 54);
    g.fillStyle = '#16794a';
    g.fillRect(48, 28, 14, 46);
    g.fillRect(32, 44, 46, 14);
    g.textAlign = 'center';
    fit(g, 'SAI MEDICALS', 280, 56, `900 {px}px ${FONT_UI}`, 40, 330, '#fff4dc');
    fit(g, 'సాయి మెడికల్స్  ·  24 HOURS', 280, 80, `700 {px}px ${FONT_TE}`, 20, 330, '#c9f2d8');
    g.fillStyle = '#e8f4f6';
    g.fillRect(28, 108, w - 56, h - 108);
    for (let s = 0; s < 4; s++) {
      g.fillStyle = '#b8c6cc';
      g.fillRect(34, 148 + s * 42, w - 68, 4);
      packets(g, 38, 124 + s * 42, w - 76, 24, r, ['#ffffff', '#2a62c4', '#d83a2a', '#e8f0f4', '#16794a', '#f2c21a']);
    }
    g.fillStyle = 'rgba(180,220,240,0.22)';
    g.fillRect(28, 108, w - 56, h - 108);
    g.fillStyle = '#4a5a60';
    g.fillRect(28, h - 50, w - 56, 50);
    g.fillStyle = '#c9d4d8';
    g.fillRect(28, h - 54, w - 56, 6);
  }, (g, w, h) => {
    g.fillStyle = '#e8fbff';
    g.fillRect(14, 54, w - 28, h - 80);
    g.fillStyle = '#7aff9a';
    g.fillRect(8, 8, w - 16, 38);
  });

  const sweets = () => shopCanvas((g, w, h, r) => {
    wall(g, w, h, '#e8c8a0', r);
    g.fillStyle = '#b8261c';
    g.fillRect(14, 14, w - 28, 76);
    g.fillStyle = '#ffd34d';
    g.fillRect(14, 84, w - 28, 6);
    g.textAlign = 'center';
    fit(g, 'HOT JALEBI & BAKERY', w / 2, 52, `900 {px}px ${FONT_UI}`, 38, w - 50, '#ffe9a8', '#5a0f0a', 5);
    fit(g, 'గరం జిలేబీ · बेकरी', w / 2, 76, `700 {px}px ${FONT_TE}`, 20, w - 90, '#fff4dc');
    for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#f6e8c8' : '#c42a1e'; g.fillRect(14 + i * 41.5, 92, 42, 20); }
    g.fillStyle = '#4a2a14';
    g.fillRect(28, 118, w - 56, h - 118);
    // glass display with trays of sweets
    for (let s = 0; s < 3; s++) {
      const y = 140 + s * 56;
      g.fillStyle = '#b9b2a2';
      g.fillRect(36, y + 22, w - 72, 5);
      for (let i = 0; i < 9; i++) {
        const cx = 56 + i * 46;
        g.fillStyle = ['#f08a1a', '#f6c24a', '#e8d8a0', '#d85a1a', '#b8741c'][(i + s * 2) % 5];
        g.beginPath(); g.arc(cx, y + 10, 13, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath(); g.arc(cx - 4, y + 6, 4, 0, 7); g.fill();
      }
    }
    g.fillStyle = 'rgba(255,230,180,0.12)';
    g.fillRect(28, 118, w - 56, h - 118);
  }, (g, w, h) => {
    g.fillStyle = '#ffc860';
    g.fillRect(14, 60, w - 28, h - 60);
    g.fillStyle = '#ff8a60';
    g.fillRect(8, 8, w - 16, 36);
  });

  const mobile = () => shopCanvas((g, w, h, r) => {
    wall(g, w, h, '#b9d2e0', r);
    g.fillStyle = '#10182e';
    g.fillRect(14, 14, w - 28, 76);
    g.strokeStyle = '#4aa8ff';
    g.lineWidth = 3;
    g.strokeRect(20, 20, w - 40, 64);
    g.textAlign = 'center';
    fit(g, 'SMART MOBILE POINT', w / 2, 52, `900 {px}px ${FONT_UI}`, 34, w - 60, '#9ad4ff');
    fit(g, 'REPAIR · RECHARGE · మొబైల్ రిపేర్', w / 2, 76, `700 {px}px ${FONT_TE}`, 18, w - 70, '#fff4dc');
    g.fillStyle = '#1a2230';
    g.fillRect(28, 108, w - 56, h - 108);
    for (let s = 0; s < 3; s++) {
      g.fillStyle = '#2a3446';
      g.fillRect(36, 150 + s * 50, w - 72, 4);
      for (let i = 0; i < 11; i++) {
        g.fillStyle = '#05080e';
        g.fillRect(44 + i * 40, 116 + s * 50, 18, 32);
        g.fillStyle = ['#2a8aff', '#ff5a5a', '#6aff9a', '#ffd34a'][(i + s) % 4];
        g.fillRect(46 + i * 40, 119 + s * 50, 14, 24);
      }
    }
    g.fillStyle = '#e8eef2';
    g.fillRect(36, h - 36, 130, 22);
    g.fillStyle = '#222';
    g.font = `700 14px ${FONT_UI}`;
    g.textAlign = 'left';
    g.fillText('SIM · RECHARGE · UPI', 42, h - 20);
  }, (g, w, h) => {
    g.fillStyle = '#2a4a8a';
    g.fillRect(14, 54, w - 28, h - 54);
    g.fillStyle = '#6ac4ff';
    g.fillRect(8, 8, w - 16, 38);
  });

  /** A shop that is shut for the night: rolling shutter, a name board, stuck-on posters. */
  const shutterShop = (seed = 0) => {
    const names = [['VENKATESWARA HARDWARE', 'వెంకటేశ్వర హార్డ్‌వేర్', '#274e8c'], ['NEW STAR TAILORS', 'న్యూ స్టార్ టైలర్స్', '#8a2a4a'], ['ANNAPURNA TIFFINS', 'అన్నపూర్ణ టిఫిన్స్', '#2a7a4a'], ['GREEN PHARMA', 'గ్రీన్ ఫార్మా', '#2a6a8a']][seed % 4];
    return shopCanvas((g, w, h, r) => {
      wall(g, w, h, ['#cdbca0', '#b9c8c0', '#d8c0b0', '#c8c8b0'][seed % 4], r);
      g.fillStyle = names[2];
      g.fillRect(14, 14, w - 28, 66);
      g.textAlign = 'center';
      fit(g, names[0], w / 2, 48, `900 {px}px ${FONT_UI}`, 32, w - 60, '#fff4dc');
      fit(g, names[1], w / 2, 72, `700 {px}px ${FONT_TE}`, 18, w - 80, '#ffe9a8');
      shutterSlats(g, 24, 96, w - 48, h - 96);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(24, 96, w - 48, 12);
      for (let i = 0; i < 4; i++) {
        g.fillStyle = ['#f2c21a', '#e8e0d0', '#d83a2a', '#6aa8e0'][(i + seed) % 4];
        g.fillRect(60 + r() * (w - 160), 140 + r() * 130, 40 + r() * 30, 52 + r() * 40);
      }
      g.fillStyle = '#c33';
      g.font = `900 22px ${FONT_UI}`;
      g.fillText('POST NO BILLS', w / 2 + 70, h - 24);
      g.fillStyle = '#222';
      g.fillRect(w / 2 - 6, h - 100, 12, 20);
    }, (g, w) => { g.fillStyle = '#3a3a30'; g.fillRect(8, 8, w - 16, 28); });
  };

  /** Upper storeys: three floors of grilled windows, balconies, AC units and drying clothes; a mask of lit windows for the night. 5 m x 7.5 m. */
  const building = (seed = 1, tint = '#d8b88a') => {
    const lit = [];
    const map = track(canvasTexture(512, 768, (g, w, h) => {
      const r = mulberry(900 + seed * 31);
      wall(g, w, h, tint, r);
      lit.length = 0;
      const floors = 3;
      const fh = h / floors;
      for (let f = 0; f < floors; f++) {
        const y0 = f * fh;
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(0, y0 + fh - 8, w, 8);
        g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(40,60,90,0.12)';
        g.fillRect(0, y0 + fh * 0.72, w, 6);
        const cols = 3 + ((seed + f) % 2);
        const cw = w / cols;
        for (let c = 0; c < cols; c++) {
          const ww = cw * 0.52;
          const wx = c * cw + (cw - ww) / 2;
          const wy = y0 + 28;
          const wh = fh * 0.52;
          g.fillStyle = '#1e2026';
          g.fillRect(wx, wy, ww, wh);
          g.fillStyle = ['#2f7a6a', '#7a3a2a', '#d8d8d0', '#3a5a8a'][(seed + c + f) % 4];
          g.fillRect(wx - 5, wy - 5, ww + 10, 5);
          g.fillRect(wx - 5, wy + wh, ww + 10, 5);
          g.fillRect(wx - 5, wy - 5, 5, wh + 10);
          g.fillRect(wx + ww, wy - 5, 5, wh + 10);
          g.strokeStyle = '#242424';
          g.lineWidth = 3;
          for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(wx + (ww * k) / 5, wy); g.lineTo(wx + (ww * k) / 5, wy + wh); g.stroke(); }
          for (let k = 1; k < 3; k++) { g.beginPath(); g.moveTo(wx, wy + (wh * k) / 3); g.lineTo(wx + ww, wy + (wh * k) / 3); g.stroke(); }
          if (r() < 0.55) lit.push([wx, wy, ww, wh, r() < 0.5 ? '#ffd27a' : '#ffeec0']);
          if (r() < 0.3) {
            g.fillStyle = '#d4d6d8';
            g.fillRect(wx + ww * 0.1, wy + wh + 8, ww * 0.6, 22);
            g.fillStyle = '#999';
            g.fillRect(wx + ww * 0.12, wy + wh + 12, ww * 0.56, 4);
          }
          if (r() < 0.22) {
            g.strokeStyle = '#444';
            g.lineWidth = 2;
            g.beginPath(); g.moveTo(wx - 14, wy + wh + 44); g.lineTo(wx + ww + 14, wy + wh + 44); g.stroke();
            for (let k = 0; k < 5; k++) { g.fillStyle = ['#e33', '#fc3', '#3a8', '#fff', '#c5a'][(k + c) % 5]; g.fillRect(wx - 8 + k * (ww / 4.3), wy + wh + 44, 12, 28); }
          }
        }
        if (r() < 0.6) {
          g.fillStyle = 'rgba(60,40,30,0.55)';
          g.font = `900 22px ${FONT_UI}`;
          g.textAlign = 'center';
          g.fillText(['TO LET', 'COACHING', 'HOSTEL', 'CLINIC'][(seed + f) % 4], w * (0.25 + r() * 0.5), y0 + fh - 18);
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 4; i++) g.fillRect(r() * w, 0, 3 + r() * 5, h);
    }, { anisotropy: 4 }));
    const emis = track(canvasTexture(256, 384, (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      for (const [x, y, ww, wh, c] of lit) { g.fillStyle = c; g.fillRect(x / 2 + 2, y / 2 + 2, ww / 2 - 4, wh / 2 - 4); }
    }, { anisotropy: 2 }));
    return { map, emis };
  };

  // --- ground decals (alpha) -----------------------------------------------------------------------------------------------------------------
  const decal = (kind) => {
    const sizes = { pothole: [256, 256], patch: [256, 128], stain: [256, 256], kolam: [256, 256], zebra: [256, 256], dash: [256, 64], litter: [256, 128], puddle: [256, 128], water: [256, 256], leaf: [128, 128], shadow: [128, 128] };
    const [dw, dh] = sizes[kind] || [128, 128];
    return track(canvasTexture(dw, dh, (g, w, h) => {
      const r = mulberry(1000 + kind.length * 7);
      g.clearRect(0, 0, w, h);
      if (kind === 'pothole') {
        const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(8,8,10,1)');
        gr.addColorStop(0.55, 'rgba(14,14,16,0.95)');
        gr.addColorStop(0.8, 'rgba(60,56,54,0.8)');
        gr.addColorStop(1, 'rgba(60,56,54,0)');
        g.fillStyle = gr;
        g.beginPath();
        for (let a = 0; a < 40; a++) { const ang = (a / 40) * 6.283; const rad = (w / 2) * (0.78 + r() * 0.2); g[a ? 'lineTo' : 'moveTo'](w / 2 + Math.cos(ang) * rad, h / 2 + Math.sin(ang) * rad * 0.85); }
        g.fill();
      } else if (kind === 'patch') {
        g.fillStyle = 'rgba(30,30,34,0.9)';
        g.fillRect(14, 14, w - 28, h - 28);
        g.strokeStyle = 'rgba(10,10,10,0.7)';
        g.lineWidth = 3;
        g.strokeRect(14, 14, w - 28, h - 28);
        for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${90 + r() * 70 | 0},${88 + r() * 70 | 0},${90 + r() * 70 | 0},${0.15 + r() * 0.3})`; g.fillRect(14 + r() * (w - 28), 14 + r() * (h - 28), 1.5, 1.5); }
      } else if (kind === 'stain') {
        for (let i = 0; i < 6; i++) {
          const cx = w * (0.25 + r() * 0.5);
          const cy = h * (0.25 + r() * 0.5);
          const rad = 30 + r() * 60;
          const gr = g.createRadialGradient(cx, cy, 2, cx, cy, rad);
          gr.addColorStop(0, 'rgba(10,8,6,0.5)');
          gr.addColorStop(1, 'rgba(10,8,6,0)');
          g.fillStyle = gr;
          g.fillRect(0, 0, w, h);
        }
      } else if (kind === 'kolam') {
        g.strokeStyle = 'rgba(250,246,236,0.92)';
        g.fillStyle = 'rgba(250,246,236,0.92)';
        g.lineWidth = 3.5;
        const n = 5;
        const sp = 34;
        const cx = w / 2;
        const cy = h / 2;
        for (let i = -n; i <= n; i++) {
          const m = n - Math.abs(i);
          for (let j = -m; j <= m; j += 2) { g.beginPath(); g.arc(cx + j * sp * 0.5, cy + i * sp * 0.5, 2.6, 0, 7); g.fill(); }
        }
        g.beginPath();
        for (let t = 0; t <= 360; t += 4) {
          const a = (t * Math.PI) / 180;
          const rad = 80 + Math.sin(a * 4) * 22;
          g[t ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
        }
        g.closePath();
        g.stroke();
        g.beginPath();
        for (let t = 0; t <= 360; t += 4) {
          const a = (t * Math.PI) / 180;
          const rad = 46 + Math.sin(a * 8 + 1) * 10;
          g[t ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
        }
        g.stroke();
        g.fillStyle = 'rgba(190,40,30,0.7)';
        g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.fill();
      } else if (kind === 'zebra') {
        g.fillStyle = 'rgba(232,228,214,0.88)';
        for (let i = 0; i < 9; i++) g.fillRect(0, i * 28 + 4, w, 17);
        g.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.6})`; g.fillRect(r() * w, r() * h, 1 + r() * 5, 1 + r() * 4); }
        g.globalCompositeOperation = 'source-over';
      } else if (kind === 'dash') {
        g.fillStyle = 'rgba(232,228,214,0.88)';
        g.fillRect(8, 12, w * 0.6, h - 24);
        g.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.6})`; g.fillRect(r() * w, r() * h, 1 + r() * 6, 1 + r() * 4); }
        g.globalCompositeOperation = 'source-over';
      } else if (kind === 'litter') {
        for (let i = 0; i < 16; i++) {
          g.save();
          g.translate(r() * w, r() * h);
          g.rotate(r() * 6.28);
          g.fillStyle = ['#e8e0cc', '#d83a2a', '#2a62c4', '#f2c21a', '#8a6a3a', '#f0f0f0'][i % 6];
          g.fillRect(-8 - r() * 8, -5 - r() * 4, 14 + r() * 12, 9 + r() * 6);
          g.restore();
        }
      } else if (kind === 'puddle') {
        const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.7, 'rgba(255,255,255,0.9)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.save();
        g.scale(1, h / w);
        g.beginPath();
        for (let a = 0; a < 48; a++) { const ang = (a / 48) * 6.283; const rad = (w / 2) * (0.78 + r() * 0.22); g[a ? 'lineTo' : 'moveTo'](w / 2 + Math.cos(ang) * rad, w / 2 + Math.sin(ang) * rad); }
        g.fill();
        g.restore();
      } else if (kind === 'water') {
        // mop water / wet footprints: soft blobs
        for (let i = 0; i < 9; i++) {
          const cx = r() * w;
          const cy = r() * h;
          const rad = 18 + r() * 40;
          const gr = g.createRadialGradient(cx, cy, 1, cx, cy, rad);
          gr.addColorStop(0, 'rgba(255,255,255,0.9)');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr;
          g.fillRect(0, 0, w, h);
        }
      } else if (kind === 'leaf') {
        g.fillStyle = 'rgba(90,120,40,1)';
        g.beginPath(); g.moveTo(8, h / 2); g.quadraticCurveTo(w / 2, 4, w - 8, h / 2); g.quadraticCurveTo(w / 2, h - 4, 8, h / 2); g.fill();
        g.strokeStyle = 'rgba(40,70,20,1)';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(8, h / 2); g.lineTo(w - 8, h / 2); g.stroke();
      } else if (kind === 'shadow') {
        const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(0,0,0,0.6)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      }
    }, { anisotropy: 4 }));
  };

  /** Neem / banyan foliage card: a cloud of leaves on a transparent ground (alpha-tested, 128 px). */
  const foliage = (kind = 0) =>
    track(canvasTexture(256, 256, (g, w, h) => {
      const r = mulberry(1500 + kind);
      g.clearRect(0, 0, w, h);
      const base = kind ? [58, 100, 36] : [64, 112, 40];
      for (let i = 0; i < 420; i++) {
        const a = r() * 6.283;
        const d = Math.sqrt(r()) * (w * 0.46);
        const x = w / 2 + Math.cos(a) * d;
        const y = h / 2 + Math.sin(a) * d * 0.85;
        const lum = 0.55 + r() * 0.7 + (1 - y / h) * 0.15;
        g.fillStyle = rgba(base[0] * lum, base[1] * lum, base[2] * lum);
        g.save();
        g.translate(x, y);
        g.rotate(r() * 6.28);
        g.beginPath(); g.ellipse(0, 0, 7 + r() * 4, 2.6 + r() * 1.6, 0, 0, 7); g.fill();
        g.restore();
      }
    }, { anisotropy: 4 }));


  /** The Charminar-like four-minaret monument (original, stylised): one 28 x 14 m face with great arches, a gallery of small arches and a parapet. */
  const monument = () => {
    const paint = (g, w, h, lightOnly) => {
      const r = mulberry(2468);
      const px = w / 28;
      if (!lightOnly) {
        g.fillStyle = '#cdbd9a';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${90 + r() * 70 | 0},${80 + r() * 60 | 0},${60 + r() * 50 | 0},${0.05 + r() * 0.12})`; g.fillRect(r() * w, r() * h, 1 + r() * 8, 1 + r() * 5); }
        for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(40,34,24,0.08)'; g.fillRect(r() * w, 0, 2 + r() * 6, h); }
      } else {
        g.fillStyle = '#000';
        g.fillRect(0, 0, w, h);
      }
      const arch = (cx, bw, bh, base, inner) => {
        g.beginPath();
        g.moveTo(cx - bw / 2, base);
        g.lineTo(cx - bw / 2, base - bh + bw / 2);
        g.arc(cx, base - bh + bw / 2, bw / 2, Math.PI, 0);
        g.lineTo(cx + bw / 2, base);
        g.closePath();
        g.fillStyle = inner;
        g.fill();
      };
      const base = h - 0.5 * px;
      if (!lightOnly) {
        g.fillStyle = 'rgba(80,66,46,0.28)';
        g.fillRect(0, h * 0.62, w, 5);
        g.fillRect(0, h * 0.18, w, 8);
      }
      arch(w / 2, 8 * px, 10.6 * px, base, lightOnly ? '#ffb45a' : '#2c2018');
      arch(w / 2 - 9.4 * px, 4.2 * px, 8 * px, base, lightOnly ? '#ff9a44' : '#2c2018');
      arch(w / 2 + 9.4 * px, 4.2 * px, 8 * px, base, lightOnly ? '#ff9a44' : '#2c2018');
      for (let i = -4; i <= 4; i++) arch(w / 2 + i * 2.7 * px, 1.4 * px, 2.9 * px, h * 0.54, lightOnly ? '#ffc070' : '#3a2c20');
      if (!lightOnly) {
        g.fillStyle = '#b8a67e';
        for (let i = 0; i < 29; i++) { g.beginPath(); g.moveTo(i * px - 0.4 * px, h * 0.14); g.lineTo(i * px, h * 0.14 - 1.0 * px); g.lineTo(i * px + 0.4 * px, h * 0.14); g.fill(); }
      }
    };
    const map = track(canvasTexture(1024, 512, (g, w, h) => paint(g, w, h, false), { anisotropy: 4 }));
    const emis = track(canvasTexture(512, 256, (g, w, h) => paint(g, w, h, true), { anisotropy: 2 }));
    return { map, emis };
  };

  /** Checked cotton (gamchha) for hanging towels. */
  const fabric = (kind = 'red') =>
    track(canvasTexture(64, 64, (g, w, h) => {
      const col = kind === 'blue' ? ['#2a4a9a', '#f2f0e8'] : ['#b92a2a', '#f2f0e8'];
      g.fillStyle = col[1];
      g.fillRect(0, 0, w, h);
      g.fillStyle = col[0];
      for (let i = 0; i < 4; i++) { g.fillRect(i * 16 + 3, 0, 5, h); g.fillRect(0, i * 16 + 3, w, 5); }
      g.fillStyle = 'rgba(0,0,0,0.06)';
      for (let i = 0; i < h; i += 2) g.fillRect(0, i, w, 1);
    }, { anisotropy: 2 }));

  // --- small sprites ----------------------------------------------------------------------------------------------------------------------------
  const noteTex = () =>
    T(canvasTexture(256, 128, (g, w, h) => {
      g.fillStyle = '#d6efd0';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#7fbf86';
      g.fillRect(8, 8, w - 16, h - 16);
      g.fillStyle = '#e9f7e2';
      g.fillRect(14, 14, w - 28, h - 28);
      g.fillStyle = '#2f7a46';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `900 78px ${FONT_UI}`;
      g.fillText('₹', w / 2, h / 2 + 4);
      g.beginPath(); g.arc(34, h / 2, 14, 0, 7); g.arc(w - 34, h / 2, 14, 0, 7); g.fill();
    }));

  const softDot = () =>
    T(canvasTexture(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }, { mip: false }));

  const ring = () =>
    T(canvasTexture(128, 128, (g, w, h) => {
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 9;
      g.shadowColor = 'rgba(255,255,255,0.9)';
      g.shadowBlur = 10;
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2 - 14, 0, Math.PI * 2);
      g.stroke();
    }, { mip: false }));

  /** Reflective puddle (kept for older callers): soft dark mirror with warm streaks. */
  const puddle = () =>
    T(canvasTexture(128, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.75, 'rgba(255,255,255,0.7)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.save();
      g.scale(1, h / w);
      g.beginPath();
      g.arc(w / 2, w / 2, w / 2, 0, 7);
      g.restore();
      g.fill();
    }));

  const blob = () =>
    T(canvasTexture(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)');
      gr.addColorStop(0.6, 'rgba(0,0,0,0.25)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }, { mip: false }));

  /** Floating text labels (+₹NN, emotes). */
  const label = (text, color = '#ffd34d', size = 64) =>
    canvasTexture(256, 96, (g, w, h) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let px = size;
      g.font = `900 ${px}px ${FONT_UI}`;
      while (px > 18 && g.measureText(text).width > w - 36) {
        px -= 4;
        g.font = `900 ${px}px ${FONT_UI}`;
      }
      g.lineJoin = 'round';
      g.lineWidth = 14;
      g.strokeStyle = 'rgba(30,14,6,0.9)';
      g.strokeText(text, w / 2, h / 2 + 2);
      g.fillStyle = color;
      g.fillText(text, w / 2, h / 2 + 2);
    }, { mip: false });

  void FONT_HI;
  return {
    banner, bannerBack, menuBoard, enamel, monument, fabric, poster, hoarding, kirana, medical, sweets, mobile, shutterShop, building, decal, foliage,
    noteTex, softDot, ring, puddle, blob, label,
    redrawText() {
      for (const t of redraws) t.userData.redraw?.();
    },
  };
}
