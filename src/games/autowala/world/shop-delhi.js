// Delhi Mithai Wala: a modern one-to-two storey sweet shop. Brown wood-slat cladding on the upper band, a big rounded
// red-orange sign ("Delhi" in white script with a yellow outline) over a yellow "MITHAI WALA" band, a dark side panel with
// white caps (SWEETS / BAKERY / CHAAT ...), a white carved jali panel, floor-to-ceiling glass between wooden columns and a
// red-and-white striped awning chaat stall at the right. Wordmarks are drawn in code.
import { DoubleSide, Group } from 'three';
import { Batch, FONT, Pen, SCRIPT, addPerson, facadeTextures, hash01, roundedShape, shapeBoard, SHIRTS, SKINS } from './shop-kit.js';

const WOOD = '#7a4a2b';
const WOOD_D = '#5a3320';
const WHITE = '#f3ede0';
const GF = 4.6;
const TOPB = 8.4;
const H = 8.8;
const PLINTH = 0.3;
const PANEL_W = 2.7;
const LINES = ['SWEETS', 'BAKERY', 'CHAAT', 'RESTAURANT', 'KULFI', 'PURE VEG'];

function layout(W) {
  const gs = -W / 2 + PANEL_W + 0.5;
  const ge = W / 2 - 0.4;
  const nM = Math.max(4, Math.round((ge - gs) / 3.1));
  const mw = (ge - gs) / nM;
  const ent = Math.min(2, nM - 2);
  return { W, gs, ge, nM, mw, ent, entX: gs + (ent + 0.5) * mw, jaliX: W / 2 - 3.1, jaliW: 3.8 };
}

function jali(p, pass, cx, y, w, h) {
  if (pass === 'day') {
    p.rrect(cx - w / 2, y, w, h, 0.1, '#f6f1e6', '#d8cfbd', 0.06);
  } else {
    p.rect(cx - w / 2, y, w, h, 'rgba(0,0,0,0)');
  }
  const cell = 0.42;
  for (let i = 0; i < Math.floor((w - 0.5) / cell); i++) {
    for (let j = 0; j < Math.floor((h - 0.5) / cell); j++) {
      const x = cx - w / 2 + 0.3 + (i + 0.5) * cell;
      const yy = y + 0.3 + (j + 0.5) * cell;
      const r = cell * 0.36;
      if (pass === 'day') {
        p.poly([[x, yy + r], [x + r, yy], [x, yy - r], [x - r, yy]], '#8a7a62');
        p.circle(x, yy, r * 0.42, '#f6f1e6');
      } else {
        p.poly([[x, yy + r], [x + r, yy], [x, yy - r], [x - r, yy]], 'rgba(255,170,70,0.75)');
      }
    }
  }
}

function drawFront(p, pass, L) {
  const { W } = L;
  const left = -W / 2;
  if (pass === 'day') {
    p.rect(left, 0, W, H, WHITE);
    // wood-slat upper band
    p.rect(left + PANEL_W, GF, W - PANEL_W, TOPB - GF, WOOD_D);
    for (let y = GF + 0.05, k = 0; y < TOPB - 0.05; y += 0.14, k++) {
      p.rect(left + PANEL_W, y, W - PANEL_W, 0.11, k % 3 === 0 ? '#8d5a35' : k % 3 === 1 ? '#7a4a2b' : '#6e4226');
      p.rect(left + PANEL_W, y + 0.09, W - PANEL_W, 0.02, 'rgba(255,220,170,0.15)');
    }
    p.rect(left, TOPB, W, H - TOPB, '#e9e1d0');
    p.rect(left, 0, W, 0.4, '#3a3029');
  }
  // dark side panel with the white caps
  {
    const x0 = left;
    const y0 = 0.4;
    const h = TOPB - 0.4;
    if (pass === 'day') {
      p.grad(x0, y0, PANEL_W, h, [[0, '#4a2616'], [1, '#6a3420']]);
      p.rrect(x0 + 0.12, y0 + 0.12, PANEL_W - 0.24, h - 0.24, 0.05, null, 'rgba(240,200,120,0.8)', 0.03);
    }
    LINES.forEach((t, i) => {
      const y = y0 + h - 0.9 - i * ((h - 1.6) / (LINES.length - 1));
      p.text(t, x0 + PANEL_W / 2, y, 0.44, { color: pass === 'day' ? '#fff' : 'rgba(255,255,255,0.8)', weight: 800, spacing: 0.04, maxW: PANEL_W - 0.5 });
      if (pass === 'day' && i < LINES.length - 1) p.rect(x0 + 0.5, y - 0.55, PANEL_W - 1.0, 0.025, 'rgba(240,200,120,0.7)');
    });
  }
  jali(p, pass, L.jaliX, GF + 0.55, L.jaliW, TOPB - GF - 1.1);
  // glass shopfront modules: sweets counters inside
  for (let m = 0; m < L.nM; m++) {
    const x0 = L.gs + m * L.mw;
    const gx = x0 + 0.25;
    const gw = L.mw - 0.5;
    if (pass === 'day') {
      p.grad(gx, 0.4, gw, GF - 0.5, [[0, '#9a6a40'], [0.5, '#f1cf98'], [1, '#fff3d2']]);
      // shelves of sweets: coloured trays
      const cols = ['#ff9a1f', '#ffd23d', '#ff6a8a', '#f7f0d8', '#c2742a', '#9bd36a'];
      for (let sh = 0; sh < 3; sh++) {
        const y = 0.95 + sh * 0.85;
        p.rect(gx, y, gw, 0.05, 'rgba(90,60,30,0.6)');
        for (let k = 0; k < 5; k++) p.rrect(gx + 0.2 + k * (gw / 5.2), y + 0.07, gw / 7, 0.3, 0.05, cols[(m * 3 + sh * 2 + k) % cols.length]);
      }
      p.line(gx + gw / 2, 0.4, gx + gw / 2, GF - 0.1, m === L.ent ? 0.07 : 0.03, '#2b2d33');
      p.rect(gx, GF - 0.45, gw, 0.04, '#2b2d33');
      for (let k = 0; k < 3; k++) p.circle(gx + 0.4 + k * (gw / 2.6), GF - 0.3, 0.06, '#fffbe8');
    } else {
      p.grad(gx, 0.4, gw, GF - 0.5, [[0, 'rgba(255,150,60,0.75)'], [1, 'rgba(255,225,160,0.95)']]);
    }
  }
}

function drawSide(p, pass, Wm) {
  if (pass === 'day') {
    p.rect(-Wm / 2, 0, Wm, H, WHITE);
    p.rect(-Wm / 2, GF, Wm, TOPB - GF, WOOD_D);
    for (let y = GF + 0.05, k = 0; y < TOPB - 0.05; y += 0.14, k++) p.rect(-Wm / 2, y, Wm, 0.11, k % 3 === 0 ? '#8d5a35' : k % 3 === 1 ? '#7a4a2b' : '#6e4226');
    p.rect(-Wm / 2, 0, Wm, 0.4, '#3a3029');
  }
  const n = Math.max(2, Math.round(Wm / 3.6));
  for (let i = 0; i < n; i++) {
    const cx = -Wm / 2 + ((i + 0.5) * Wm) / n;
    if (pass === 'day') {
      p.rect(cx - 0.95, 0.9, 1.9, 2.4, '#2b2d33');
      p.grad(cx - 0.85, 1.0, 1.7, 2.2, [[0, '#a8672f'], [1, '#f0d09a']]);
    } else p.grad(cx - 0.85, 1.0, 1.7, 2.2, [[0, 'rgba(255,150,60,0.6)'], [1, 'rgba(255,225,160,0.85)']]);
  }
}

function signDraw(kit, w, h, yellowH) {
  return (g, pw) => {
    const p = new Pen(g, pw / w, w, h);
    const redH = h - yellowH;
    p.grad(-w / 2, yellowH, w, redH, [[0, '#d8341a'], [1, '#f0572a']]);
    p.rect(-w / 2, 0, w, yellowH, '#ffc72c');
    p.rect(-w / 2, yellowH - 0.03, w, 0.07, '#fff3b0');
    p.rrect(-w / 2 + 0.18, yellowH + 0.15, w - 0.36, redH - 0.3, 0.2, null, 'rgba(255,255,255,0.65)', 0.04);
    if (kit.drawLogo('delhi', p, -w / 2 + 0.5, 0.2, w - 1, h - 0.4)) return;
    p.text('Delhi', 0, yellowH + redH * 0.52, redH * 0.74, { font: SCRIPT, weight: 700, color: '#fff', stroke: '#ffc72c', strokeW: 0.16, maxW: w - 1.4, shadow: { color: 'rgba(120,20,0,0.4)', blur: 0.1 } });
    p.text('MITHAI WALA', 0, yellowH / 2, yellowH * 0.6, { color: '#b3141b', weight: 800, spacing: 0.1, maxW: w - 1.2 });
  };
}

function awningDraw(g, w, h) {
  const n = 12;
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? '#fbf5e6' : '#d92b2b';
    g.fillRect((i * w) / n, 0, w / n + 1, h);
  }
}

export function buildDelhi(kit, plan, parent) {
  const { W, D } = plan;
  const L = layout(W);
  const g = new Group();
  g.position.set(plan.cx, 0.2, plan.cz);
  g.rotation.y = plan.theta;
  parent.add(g);
  const bld = new Group();
  bld.position.y = PLINTH;
  g.add(bld);
  kit.loadLogo('delhi');

  const front = facadeTextures(kit, W, H, { ppm: 46, draw: (p, pass) => drawFront(p, pass, L) });
  const side = facadeTextures(kit, D, H, { ppm: 46, draw: (p, pass) => drawSide(p, pass, D) });
  const frontMat = kit.texMat({ map: front.map, glow: front.glow, k: 0.85, base: 0, rough: 0.7, offset: 1 });
  const sideMat = kit.texMat({ map: side.map, glow: side.glow, k: 0.8, rough: 0.7, offset: 1 });
  const backMat = kit.texMat({ map: front.map, glow: front.glow, k: 0.4, rough: 0.7, offset: 1 });
  const E = 0.03;
  kit.plane(bld, frontMat, W, H, 0, 0, D / 2 + E, 0);
  kit.plane(bld, sideMat, D, H, W / 2 + E, 0, 0, Math.PI / 2);
  kit.plane(bld, sideMat, D, H, -W / 2 - E, 0, 0, -Math.PI / 2);
  kit.plane(bld, backMat, W, H, 0, 0, -D / 2 - E, Math.PI);

  const b = new Batch();
  b.push(0, PLINTH, 0);
  b.box(W, H, D, 0, 0, 0, WHITE);
  // wooden columns between the glass modules, header beam, side panel block, jali frame
  for (let m = 0; m <= L.nM; m++) b.box(0.42, GF, 0.5, L.gs + m * L.mw, 0, D / 2 + 0.1, WOOD);
  b.box(W - PANEL_W, 0.34, 0.7, PANEL_W / 2, GF - 0.17, D / 2 + 0.2, WOOD_D);
  b.box(PANEL_W, TOPB, 0.3, -W / 2 + PANEL_W / 2, 0, D / 2 + 0.1, '#4a2616');
  b.box(PANEL_W + 0.2, 0.2, 0.4, -W / 2 + PANEL_W / 2, TOPB, D / 2 + 0.15, WOOD);
  b.box(L.jaliW + 0.4, 0.16, 0.34, L.jaliX, GF + 0.4, D / 2 + 0.15, WHITE);
  b.box(L.jaliW + 0.4, 0.16, 0.34, L.jaliX, TOPB - 0.55, D / 2 + 0.15, WHITE);
  for (const sx of [-1, 1]) b.box(0.2, TOPB - GF - 0.8, 0.34, L.jaliX + sx * (L.jaliW / 2 + 0.1), GF + 0.4, D / 2 + 0.15, WHITE);
  // roof: wooden coping, plant, a tank
  b.box(W + 0.4, 0.2, D + 0.4, 0, H, 0, WOOD);
  b.box(W - 0.6, 0.4, D - 0.6, 0, H + 0.2, 0, '#8a857f');
  b.box(1.6, 1.0, 1.1, -W * 0.25, H + 0.6, -D * 0.15, '#b7b4bc', { mat: 'metal' });
  b.cyl(0.9, 0.9, 1.6, W * 0.28, H + 0.6, -D * 0.2, '#d9d4c8', { seg: 12 });
  // lit strip under the header
  b.box(W - PANEL_W - 0.6, 0.04, 0.12, PANEL_W / 2, GF - 0.38, D / 2 + 0.35, '#ffe2b0', { mat: 'lamp' });
  b.pop();

  // plinth, entrance steps and planters
  b.box(W + 0.5, PLINTH, D + 0.5, 0, 0, 0, '#8e857a');
  b.box(L.mw + 1.2, 0.15, 0.6, L.entX, 0, D / 2 + 0.55, '#b5aa9a');
  b.box(L.mw + 1.8, 0.15, 0.4, L.entX, 0, D / 2 + 0.9, '#a89d8d');
  for (const sx of [-1, 1]) {
    b.box(0.7, 0.6, 0.7, L.entX + sx * (L.mw / 2 + 1.1), 0, D / 2 + 0.9, '#3b2f27');
    b.sph(0.45, L.entX + sx * (L.mw / 2 + 1.1), 0.95, D / 2 + 0.9, '#2f8a4a', { w: 8, h: 6 });
  }
  // the chaat stall under a red-and-white awning at the right
  const sx0 = W / 2 - 3.6;
  const sd = 2.4;
  const sw = 4.6;
  b.box(sw - 0.4, 0.85, 0.8, sx0, 0, D / 2 + 1.7, '#b9bec6', { mat: 'metal' });
  b.box(sw - 0.4, 0.06, 0.9, sx0, 0.85, D / 2 + 1.7, '#d9dde2', { mat: 'metal' });
  b.box(1.5, 0.5, 0.7, sx0 - 1.0, 0.91, D / 2 + 1.7, '#e9edf1', { mat: 'metal' });
  b.box(1.5, 0.5, 0.05, sx0 - 1.0, 1.41, D / 2 + 1.35, '#cfe6ee', { mat: 'glass' });
  for (let k = 0; k < 4; k++) b.cyl(0.2, 0.22, 0.26, sx0 + 0.4 + k * 0.5, 0.91, D / 2 + 1.7, '#c9ced6', { seg: 10, mat: 'metal' });
  for (let k = 0; k < 6; k++) b.sph(0.1, sx0 - 1.5 + (k % 3) * 0.4, 1.6, D / 2 + 1.6 + (k > 2 ? 0.2 : 0), '#e7a23a', { w: 6, h: 4 });
  for (const sx of [-1, 1]) b.cyl(0.05, 0.05, 2.7, sx0 + sx * (sw / 2 - 0.1), 0, D / 2 + sd - 0.15, '#3b3b40', { seg: 6, mat: 'metal' });
  for (let k = 0; k < 5; k++) b.sph(0.09, sx0 - sw / 2 + 0.6 + k * 0.85, 2.45, D / 2 + sd - 0.3, '#fff3c0', { w: 6, h: 4, mat: 'lamp' });
  const rng = (i) => hash01(plan.cx | 0, plan.cz | 0, i + 70);
  const man = (x, z, yaw, i, o = {}) => addPerson(b, x, z, { yaw, shirt: SHIRTS[Math.floor(rng(i) * SHIRTS.length)], skin: SKINS[Math.floor(rng(i + 5) * SKINS.length)], pants: '#2c3e50', h: 1.55 + rng(i + 3) * 0.3, ...o });
  man(sx0 + 0.2, D / 2 + 1.0, 0, 1, { shirt: '#fbf3e0', pants: '#d8d0c0' }); // vendor, behind the counter
  man(sx0 - 0.9, D / 2 + 2.6, Math.PI, 2);
  man(sx0 + 0.4, D / 2 + 2.7, Math.PI * 0.9, 3);
  man(L.entX - 2.6, D / 2 + 1.8, 0.4, 4);
  man(L.entX + 2.3, D / 2 + 2.0, -0.5, 5);
  kit.flush(b, g);

  // the big rounded sign
  const sgw = Math.min(9.6, L.mw * 3.2);
  const yh = 1.0;
  const sgh = 3.45;
  const signTex = kit.tex(1024, Math.round((1024 * sgh) / sgw), signDraw(kit, sgw, sgh, yh));
  const signMat = kit.texMat({ map: signTex, glow: true, k: 0.95, base: 0.3, rough: 0.5 });
  const edgeMat = kit.texMat({ map: null, rough: 0.6 });
  edgeMat.color.set('#a82414');
  const board = shapeBoard(kit, roundedShape(sgw, sgh, 0.55), sgw, sgh, 0.45, signMat, edgeMat);
  board.position.set(L.entX, GF + 0.55, D / 2 + 0.05);
  bld.add(board);

  // awning (sloped, striped) + valance
  const a = Math.atan2(0.5, sd);
  const aw = kit.tex(512, 128, awningDraw);
  const awMat = kit.texMat({ map: aw, rough: 0.8, side: DoubleSide });
  const top = kit.plane(bld, awMat, sw, sd / Math.cos(a), sx0, 0, 0, 0);
  top.rotation.x = -Math.PI / 2 + a;
  top.position.set(sx0, 2.95, D / 2 + sd / 2 - 0.05);
  top.castShadow = true;
  const valTex = kit.tex(512, 64, (gc, w, h) => {
    const n = 12;
    for (let i = 0; i < n; i++) {
      gc.fillStyle = i % 2 ? '#fbf5e6' : '#d92b2b';
      gc.fillRect((i * w) / n, 0, w / n + 1, h * 0.65);
      gc.beginPath();
      gc.arc(((i + 0.5) * w) / n, h * 0.65, w / n / 2, 0, Math.PI);
      gc.fill();
    }
  });
  const valMat = kit.texMat({ map: valTex, rough: 0.8, transparent: true, alphaTest: 0.4, side: DoubleSide });
  kit.plane(bld, valMat, sw, 0.5, sx0, 2.5, D / 2 + sd - 0.05, 0);
  // chaat board on the awning
  const bw = 2.6;
  const bh = 0.62;
  const cb = kit.tex(512, Math.round((512 * bh) / bw), (gc, w, h) => {
    const p = new Pen(gc, w / bw, bw, bh);
    p.rect(-bw / 2, 0, bw, bh, '#2a1a12');
    p.rrect(-bw / 2 + 0.04, 0.04, bw - 0.08, bh - 0.08, 0.04, null, '#ffc72c', 0.025);
    p.text('CHAAT  •  GOLGAPPA', 0, bh / 2, bh * 0.5, { color: '#ffe9a8', weight: 800, spacing: 0.04, maxW: bw - 0.3 });
  });
  const cbMat = kit.texMat({ map: cb, glow: true, k: 0.9, base: 0.25, rough: 0.5 });
  kit.plane(bld, cbMat, bw, bh, sx0, 2.0, D / 2 + sd - 0.04, 0);
  kit.pool(g, '#ffb468', W * 0.8, 8, 0, D / 2 + 4.2, 0.5);
  return g;
}
