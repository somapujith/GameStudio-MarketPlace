// Canvas painters for the street stall shell: steel, cement, tarred road, corrugated tin, tarpaulin, the flex banner, the menu
// board, a hazy Charminar skyline, shop facades, posters, the rupee note and soft sprites. Pure drawing + a tracker: nothing here
// holds global state, so a scene can dispose everything it painted.
import { canvasTexture, speckle, mulberry, FONT_UI, FONT_TE } from './textures.js';
import { DISHES } from '../../../../shared/tiffin-centre/catalog.js';

const rgba = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

export function makeArt(tr) {
  const T = (tex) => tr.track(tex);

  const steel = () =>
    T(canvasTexture(256, 256, (g, w, h) => {
      const r = mulberry(11);
      g.fillStyle = '#b9c2c8';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        const y = r() * h;
        g.fillStyle = rgba(255, 255, 255, 0.05 + r() * 0.1);
        g.fillRect(0, y, w, 1 + r() * 1.5);
        g.fillStyle = rgba(60, 70, 80, 0.04 + r() * 0.07);
        g.fillRect(0, r() * h, w, 1);
      }
      g.strokeStyle = 'rgba(70,80,90,0.55)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, w - 2, h - 2);
      g.fillStyle = 'rgba(70,80,90,0.6)';
      for (const [x, y] of [[8, 8], [w - 8, 8], [8, h - 8], [w - 8, h - 8]]) {
        g.beginPath();
        g.arc(x, y, 2.5, 0, 7);
        g.fill();
      }
    }, { repeat: [2, 1] }));

  /** Worn cement of the stall floor, oily patches and chalk-white mop streaks. */
  const cement = () =>
    T(canvasTexture(256, 256, (g, w, h) => {
      const r = mulberry(21);
      g.fillStyle = '#9a948a';
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 2200, (q) => rgba(70 + q() * 90, 66 + q() * 86, 60 + q() * 80, 0.12 + q() * 0.25), [1, 3], r);
      for (let i = 0; i < 6; i++) {
        const cx = r() * w;
        const cy = r() * h;
        const gr = g.createRadialGradient(cx, cy, 2, cx, cy, 30 + r() * 40);
        gr.addColorStop(0, 'rgba(30,22,16,0.28)');
        gr.addColorStop(1, 'rgba(30,22,16,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      }
      g.strokeStyle = 'rgba(50,46,42,0.5)';
      g.lineWidth = 2;
      g.strokeRect(0, 0, w, h);
      g.beginPath();
      g.moveTo(0, h / 2);
      g.lineTo(w, h / 2);
      g.stroke();
    }, { repeat: [5, 2] }));

  /** Footpath: chipped slabs with a yellow-grey paver pattern. */
  const footpath = () =>
    T(canvasTexture(256, 256, (g, w, h) => {
      const r = mulberry(31);
      g.fillStyle = '#b8a995';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const v = 150 + r() * 40;
          g.fillStyle = rgba(v + 20, v + 6, v - 20, 0.5);
          g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
        }
      }
      speckle(g, w, h, 1400, (q) => rgba(90 + q() * 60, 80 + q() * 50, 66 + q() * 40, 0.15 + q() * 0.2), [1, 3], r);
      g.strokeStyle = 'rgba(60,52,44,0.6)';
      g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {
        g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke();
        g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke();
      }
    }, { repeat: [7, 1] }));

  /** Tarred road: dark asphalt, aggregate, a faded kerb-side paint line. v along z. */
  const road = () =>
    T(canvasTexture(256, 256, (g, w, h) => {
      const r = mulberry(41);
      g.fillStyle = '#2f2d33';
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 2600, (q) => rgba(70 + q() * 70, 68 + q() * 66, 72 + q() * 64, 0.1 + q() * 0.25), [1, 2.5], r);
      for (let i = 0; i < 14; i++) {
        g.strokeStyle = rgba(18, 18, 22, 0.35);
        g.lineWidth = 1 + r() * 2;
        g.beginPath();
        let x = r() * w;
        let y = r() * h;
        g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; g.lineTo(x, y); }
        g.stroke();
      }
      g.fillStyle = 'rgba(235,225,190,0.55)';
      for (let i = 0; i < 4; i++) g.fillRect(i * 64 + 8, h / 2 - 3, 44, 6);
    }, { repeat: [6, 3] }));

  const tin = () =>
    T(canvasTexture(256, 256, (g, w, h) => {
      const r = mulberry(51);
      for (let x = 0; x < w; x += 16) {
        const gr = g.createLinearGradient(x, 0, x + 16, 0);
        gr.addColorStop(0, '#6d7a82');
        gr.addColorStop(0.35, '#b5c1c6');
        gr.addColorStop(0.7, '#8a979e');
        gr.addColorStop(1, '#5a666d');
        g.fillStyle = gr;
        g.fillRect(x, 0, 16, h);
      }
      speckle(g, w, h, 420, (q) => rgba(150 + q() * 40, 70 + q() * 30, 34, 0.12 + q() * 0.3), [2, 9], r);
      for (let i = 0; i < 7; i++) {
        g.fillStyle = 'rgba(60,40,30,0.25)';
        g.fillRect(r() * w, 0, 1 + r() * 2, h);
      }
    }, { repeat: [3, 1] }));

  /** Tarpaulin (blue with a white pinstripe and creases): the stall's back screen. */
  const tarp = () =>
    T(canvasTexture(256, 256, (g, w, h) => {
      const r = mulberry(61);
      g.fillStyle = '#1f5fa8';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i += 18) {
        g.fillStyle = i % 36 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.1)';
        g.fillRect(i, 0, 9, h);
      }
      for (let i = 0; i < 12; i++) {
        g.strokeStyle = rgba(255, 255, 255, 0.12);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(r() * w, 0);
        g.lineTo(r() * w, h);
        g.stroke();
      }
      speckle(g, w, h, 300, 'rgba(0,0,0,0.12)', [1, 3], r);
    }, { repeat: [4, 1] }));

  const wood = (base = '#8a5a34') =>
    T(canvasTexture(256, 256, (g, w, h) => {
      const r = mulberry(71);
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) {
        g.fillStyle = rgba(40, 20, 8, 0.28);
        g.fillRect(0, i * 43, w, 2);
      }
      for (let i = 0; i < 160; i++) {
        g.strokeStyle = rgba(50, 26, 10, 0.1 + r() * 0.16);
        g.lineWidth = 1;
        const y = r() * h;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(w * 0.3, y + r() * 5, w * 0.7, y - r() * 5, w, y + r() * 3);
        g.stroke();
      }
    }, { repeat: [2, 1] }));

  /** The flex banner: red print, cream lettering, yellow border, grommets. Redrawn when fonts arrive. */
  const banner = () =>
    T(canvasTexture(1024, 224, (g, w, h) => {
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
      g.lineJoin = 'round';
      g.font = `900 108px ${FONT_UI}`;
      g.lineWidth = 12;
      g.strokeStyle = '#5a0f0a';
      g.strokeText('TIFFIN CENTRE', w / 2, 124);
      g.fillStyle = '#fff4dc';
      g.fillText('TIFFIN CENTRE', w / 2, 124);
      g.font = `700 62px ${FONT_TE}`;
      g.lineWidth = 8;
      g.strokeStyle = '#5a0f0a';
      g.strokeText('టిఫిన్ సెంటర్', w / 2, 196);
      g.fillStyle = '#ffd34d';
      g.fillText('టిఫిన్ సెంటర్', w / 2, 196);
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
    }, { anisotropy: 8 }));

  /**
   * The hand-painted menu board with prices for the level's menu. `set(menuIds)` repaints it; fonts are retried by the caller.
   * Chalk-white names on dark green board, prices in yellow rupees.
   */
  const menuBoard = () => {
    let items = [];
    const tex = T(canvasTexture(512, 400, (g, w, h) => {
      g.fillStyle = '#17352b';
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 700, 'rgba(255,255,255,0.05)', [1, 3], mulberry(5));
      g.strokeStyle = '#8a5a34';
      g.lineWidth = 16;
      g.strokeRect(8, 8, w - 16, h - 16);
      g.textAlign = 'center';
      g.fillStyle = '#ffd34d';
      g.font = `800 38px ${FONT_UI}`;
      g.fillText('MENU  ·  మెనూ', w / 2, 58);
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(40, 72);
      g.lineTo(w - 40, 72);
      g.stroke();
      const list = items.length ? items : ['dosa', 'masala_dosa', 'idly', 'irani_chai'];
      const two = list.length > 6;
      const rows = two ? Math.ceil(list.length / 2) : list.length;
      const rowH = Math.min(46, (h - 120) / rows);
      list.forEach((id, i) => {
        const d = DISHES[id];
        if (!d) return;
        const col = two ? i % 2 : 0;
        const row = two ? Math.floor(i / 2) : i;
        const x0 = two ? 28 + col * 240 : 40;
        const x1 = two ? x0 + 214 : w - 40;
        const y = 112 + row * rowH;
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

  /**
   * Hazy skyline silhouette for the flex hoarding above the stall roof (1024 x 372 = 11.6 x 4.2 m, 88 px/m): alpha ~0.5 = far blocks,
   * 1 = the Charminar peeking over the roof; lit windows are painted with a bright red channel. Wall y = 1.2 .. 5.4.
   */
  const skyline = () =>
    T(canvasTexture(1024, 372, (g, w, h) => {
      const r = mulberry(81);
      const farGround = h - (3.0 - 1.2) * 88; // far blocks stand on wall height 3.0
      g.fillStyle = 'rgba(0,0,0,0.5)';
      let x = 0;
      while (x < w) {
        const bw = 36 + r() * 60;
        const bh = 22 + r() * 80;
        g.fillRect(x, farGround - bh, bw, bh + 200);
        if (r() < 0.4) { g.beginPath(); g.arc(x + bw / 2, farGround - bh, bw * 0.33, Math.PI, 0); g.fill(); }
        if (r() < 0.18) g.fillRect(x + bw / 2 - 2, farGround - bh - 26, 4, 26);
        x += bw + r() * 10;
      }
      g.fillStyle = 'rgba(255,200,90,0.9)';
      for (let i = 0; i < 70; i++) g.fillRect(r() * w, farGround - 6 - r() * 90, 3, 4);
      // Charminar: base at wall height 2.3, 3 m tall, centred 1.2 m right of the middle
      g.save();
      g.translate((1.2 + 5.8) * 88, h - (2.3 - 1.2) * 88);
      g.scale(0.6, 0.6);
      g.fillStyle = 'rgba(0,0,0,1)';
      g.fillRect(-125, -190, 250, 190); // the arched base
      g.fillRect(-100, -235, 200, 45); // the gallery
      for (const sgn of [-1, 1]) {
        const mx = sgn * 112;
        g.fillRect(mx - 15, -395, 30, 215); // minaret shaft
        g.fillRect(mx - 20, -330, 40, 9);
        g.fillRect(mx - 20, -280, 40, 9);
        g.beginPath(); g.ellipse(mx, -398, 17, 22, 0, 0, Math.PI * 2); g.fill(); // bulb dome
        g.fillRect(mx - 2.5, -440, 5, 22);
        g.beginPath(); g.arc(mx, -442, 4, 0, 7); g.fill();
        const ix = sgn * 52;
        g.fillRect(ix - 11, -345, 22, 120);
        g.beginPath(); g.ellipse(ix, -348, 13, 17, 0, 0, Math.PI * 2); g.fill();
      }
      for (let kk = -4; kk <= 4; kk++) { g.beginPath(); g.arc(kk * 22, -237, 10, Math.PI, 0); g.fill(); }
      g.fillRect(-100, -241, 200, 6);
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.85)';
      const arch = (ax, aw, ah) => {
        g.beginPath();
        g.moveTo(ax - aw / 2, 0);
        g.lineTo(ax - aw / 2, -ah + aw / 2);
        g.arc(ax, -ah + aw / 2, aw / 2, Math.PI, 0);
        g.lineTo(ax + aw / 2, 0);
        g.fill();
      };
      arch(0, 74, 140);
      arch(-92, 40, 100);
      arch(92, 40, 100);
      for (let kk = -2; kk <= 2; kk++) g.fillRect(kk * 34 - 6, -225, 12, 24);
      g.restore();
      g.globalCompositeOperation = 'source-over';
    }, { mip: false }));

  /** Shop facade: concrete with a roll-down kirana shutter, signboard and hanging snack packets. */
  const kirana = () =>
    T(canvasTexture(512, 512, (g, w, h) => {
      const r = mulberry(91);
      g.fillStyle = '#c9b48f';
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 900, (q) => rgba(120 + q() * 60, 100 + q() * 50, 70 + q() * 40, 0.12 + q() * 0.2), [1, 4], r);
      // upper floor windows with grills
      for (let i = 0; i < 3; i++) {
        const x = 40 + i * 160;
        g.fillStyle = '#2b2a2e';
        g.fillRect(x, 40, 100, 130);
        g.strokeStyle = '#6a3a22';
        g.lineWidth = 4;
        for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(x + k * 20, 40); g.lineTo(x + k * 20, 170); g.stroke(); }
        g.fillStyle = 'rgba(255,205,120,0.0)';
        g.fillRect(x, 40, 100, 130);
      }
      // signboard
      g.fillStyle = '#2255a0';
      g.fillRect(20, 200, 472, 70);
      g.fillStyle = '#fff4dc';
      g.textAlign = 'center';
      g.font = `800 46px ${FONT_UI}`;
      g.fillText('SRI LAXMI KIRANA', w / 2, 250);
      // shutter
      g.fillStyle = '#7d8a90';
      g.fillRect(30, 280, 452, 232);
      for (let y = 284; y < 512; y += 9) {
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(30, y, 452, 3);
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fillRect(30, y + 4, 452, 3);
      }
      g.fillStyle = '#c7312b';
      g.fillRect(190, 360, 130, 52);
      g.fillStyle = '#fff4dc';
      g.font = `800 28px ${FONT_UI}`;
      g.fillText('PARLE-G', 255, 396);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(30, 280, 452, 8);
    }, { anisotropy: 8 }));

  /** A plain side-street block with windows, an AC unit and drying clothes. */
  const block = (seed = 1, tint = '#c4a287') =>
    T(canvasTexture(512, 512, (g, w, h) => {
      const r = mulberry(100 + seed);
      g.fillStyle = tint;
      g.fillRect(0, 0, w, h);
      speckle(g, w, h, 1100, (q) => rgba(90 + q() * 70, 80 + q() * 60, 60 + q() * 50, 0.1 + q() * 0.2), [1, 5], r);
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 4; x++) {
          const wx = 28 + x * 120;
          const wy = 30 + y * 150;
          g.fillStyle = '#2a2530';
          g.fillRect(wx, wy, 70, 100);
          g.strokeStyle = r() < 0.5 ? '#2f7a6a' : '#7a3a2a';
          g.lineWidth = 6;
          g.strokeRect(wx, wy, 70, 100);
          if (r() < 0.4) { g.fillStyle = '#d8d8d8'; g.fillRect(wx + 10, wy + 112, 50, 24); }
          if (r() < 0.25) {
            g.strokeStyle = '#444'; g.lineWidth = 2;
            g.beginPath(); g.moveTo(wx - 14, wy + 120); g.lineTo(wx + 84, wy + 120); g.stroke();
            for (let k = 0; k < 4; k++) { g.fillStyle = ['#e33', '#fc3', '#3a8', '#fff'][k]; g.fillRect(wx - 6 + k * 22, wy + 120, 14, 26); }
          }
        }
      }
    }, { anisotropy: 4 }));

  /** Window light mask for night (white where windows glow). Same layout seed as `block`. */
  const blockLights = (seed = 1) =>
    T(canvasTexture(256, 256, (g, w, h) => {
      const r = mulberry(300 + seed);
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 4; x++) {
          if (r() < 0.55) { g.fillStyle = r() < 0.5 ? '#ffd27a' : '#ffe9b8'; g.fillRect(14 + x * 60, 15 + y * 75, 35, 50); }
        }
      }
    }, { srgb: true }));

  /** A film / ad poster. */
  const poster = (seed = 1) =>
    T(canvasTexture(256, 384, (g, w, h) => {
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
      g.fillStyle = '#fff4dc';
      g.textAlign = 'center';
      g.font = `900 46px ${FONT_UI}`;
      g.fillText(['MASS', 'BIRYANI', 'SALE', 'CHAI', 'RAJA'][seed % 5], w / 2, h * 0.86);
      g.font = `700 22px ${FONT_UI}`;
      g.fillText('NOW SHOWING', w / 2, h * 0.94);
    }, { anisotropy: 4 }));

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

  /** Reflective puddle: dark mirror with soft warm streaks (the lamps) and a rim. */
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
      g.globalCompositeOperation = 'source-atop';
      for (const [x, c] of [[0.3, 'rgba(255,190,90,0.9)'], [0.55, 'rgba(255,240,200,0.8)'], [0.78, 'rgba(255,150,80,0.8)']]) {
        const lg = g.createLinearGradient(w * x, 0, w * x, h);
        lg.addColorStop(0, 'rgba(255,255,255,0)');
        lg.addColorStop(0.5, c);
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = lg;
        g.fillRect(w * x - 4, 0, 8, h);
      }
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

  return { steel, cement, footpath, road, tin, tarp, wood, banner, menuBoard, skyline, kirana, block, blockLights, poster, noteTex, softDot, ring, puddle, blob, label };
}
