// OYO: a contemporary four-storey boutique hotel. Grey facade with a flat red feature wall carrying big white vertical letters
// "OYO" (drawn as vector shapes), red-framed cantilevered window boxes with curtains on the red wall and the corner, grey
// cornice bands with dentils between floors, grey jali lattice panels, a roof-edge railing, a columned entrance canopy,
// palms and shrubs in front. Wordmarks are drawn in code.
import { Group } from 'three';
import { Batch, Pen, addPerson, facadeTextures, hash01, SHIRTS, SKINS } from './shop-kit.js';

const GREY = '#9ea2aa';
const GREY_D = '#7d818a';
const GREY_L = '#b9bcc3';
const RED = '#ee3a30';
const RED_D = '#b32420';
const GF = 4.4;
const FL = [4.4, 7.8, 11.2];
const TOPF = 14.6;
const H = 14.6;
const PLINTH = 0.3;

function layout(W) {
  const redW = Math.round(W * 0.38 * 2) / 2;
  const gs = -W / 2 + redW + 0.4;
  const ge = W / 2 - 0.3;
  const nM = Math.max(3, Math.round((ge - gs) / 3.0));
  const mw = (ge - gs) / nM;
  const ent = Math.floor(nM / 2);
  return { W, redW, gs, ge, nM, mw, ent, entX: gs + (ent + 0.5) * mw, boxX: -W / 2 + redW - 1.35, cornerX: W / 2 - 1.15 };
}

function drawO(p, cx, cy, rx, ry, sw, color) {
  const g = p.g;
  g.beginPath();
  g.ellipse(p.X(cx), p.Y(cy), p.S(rx - sw / 2), p.S(ry - sw / 2), 0, 0, Math.PI * 2);
  g.lineWidth = p.S(sw);
  g.strokeStyle = color;
  g.stroke();
}
function drawY(p, cx, y0, w, h, sw, color) {
  const ym = y0 + h * 0.46;
  p.line(cx - w / 2 + sw * 0.4, y0 + h - sw * 0.2, cx, ym, sw, color, 'butt');
  p.line(cx + w / 2 - sw * 0.4, y0 + h - sw * 0.2, cx, ym, sw, color, 'butt');
  p.line(cx, ym, cx, y0 + sw * 0.1, sw, color, 'butt');
}

function bayWindow(p, pass, x, y, w, h, seed) {
  if (pass === 'day') {
    p.grad(x, y, w, h, [[0, '#33454f'], [1, '#6a8795']]);
    p.rect(x, y, w * 0.28, h, 'rgba(245,235,215,0.92)');
    p.rect(x + w * 0.72, y, w * 0.28, h, 'rgba(245,235,215,0.92)');
    for (let k = 1; k < 4; k++) {
      p.line(x + (w * 0.28 * k) / 4, y, x + (w * 0.28 * k) / 4, y + h, 0.015, 'rgba(150,130,100,0.4)');
      p.line(x + w - (w * 0.28 * k) / 4, y, x + w - (w * 0.28 * k) / 4, y + h, 0.015, 'rgba(150,130,100,0.4)');
    }
    p.rect(x + w / 2 - 0.025, y, 0.05, h, '#d8d8dc');
  } else if (hash01(seed, 5, 2) < 0.72) {
    p.grad(x, y, w, h, [[0, 'rgba(255,160,80,0.6)'], [1, 'rgba(255,225,170,0.85)']]);
    p.rect(x, y, w * 0.28, h, 'rgba(255,205,140,0.5)');
    p.rect(x + w * 0.72, y, w * 0.28, h, 'rgba(255,205,140,0.5)');
  }
}

function lattice(p, pass, x, y, w, h) {
  if (pass === 'day') {
    p.rect(x, y, w, h, '#c7cad0');
    p.clipRect(x, y, w, h);
    for (let d = -h; d < w + h; d += 0.3) {
      p.line(x + d, y, x + d + h, y + h, 0.05, '#6e727b');
      p.line(x + d + h, y, x + d, y + h, 0.05, '#6e727b');
    }
    p.restore();
    p.rrect(x, y, w, h, 0.02, null, '#8a8e97', 0.06);
  } else {
    p.clipRect(x, y, w, h);
    for (let d = -h; d < w + h; d += 0.6) p.line(x + d + 0.15, y, x + d + 0.15 + h, y + h, 0.03, 'rgba(255,190,110,0.28)');
    p.restore();
  }
}

function drawFront(p, pass, L, kit) {
  const { W } = L;
  const left = -W / 2;
  if (pass === 'day') {
    p.grad(left, 0, W, H, [[0, '#868a93'], [0.5, '#a0a4ac'], [1, '#aaaeb5']]);
    for (let x = left; x < W / 2; x += 1.2) p.line(x, 0, x, H, 0.012, 'rgba(0,0,0,0.12)');
    // red feature wall
    p.grad(left, 0, L.redW, H, [[0, '#c22a24'], [0.5, '#e2352e'], [1, '#ec4036']]);
    for (let y = 1.2; y < H; y += 1.2) p.line(left, y, left + L.redW, y, 0.014, 'rgba(90,10,10,0.25)');
    p.rect(left, 0, W, 0.4, '#4a4d54');
  }
  if (pass === 'glow') p.grad(-W / 2, 0.4, L.redW, H - 0.4, [[0, 'rgba(255,45,35,0.4)'], [1, 'rgba(255,45,35,0.55)']]); // the lit red feature wall
  // the big white vertical letters
  const lx = left + L.redW * 0.36;
  const letterH = 2.75;
  const white = pass === 'day' ? '#fff' : 'rgba(255,255,255,0.75)';
  const own = pass === 'day' && kit && kit.drawLogo('oyo', p, left + 0.4, 4.5, L.redW - 0.8, 9.6);
  if (!own && !(pass === 'glow' && kit && kit.logos.oyo)) {
    drawO(p, lx, 12.6, 1.15, letterH / 2, 0.62, white);
    drawY(p, lx, 7.9, 2.3, letterH, 0.62, white);
    drawO(p, lx, 5.9, 1.15, letterH / 2, 0.62, white);
  }
  // grey part: ground floor glazing, upper windows and jali panels
  for (let m = 0; m < L.nM; m++) {
    const gx = L.gs + m * L.mw + 0.22;
    const gw = L.mw - 0.44;
    if (pass === 'day') {
      p.grad(gx, 0.4, gw, GF - 0.7, [[0, '#6f6a60'], [0.5, '#d9bd8e'], [1, '#f3e1b8']]);
      for (let k = 0; k < 3; k++) p.rect(gx + 0.3 + k * (gw / 3), 0.4, gw / 4.5, 0.9, 'rgba(70,45,30,0.4)');
      p.line(gx + gw / 2, 0.4, gx + gw / 2, GF - 0.3, m === L.ent ? 0.07 : 0.035, '#2c2f36');
      p.rect(gx, GF - 0.75, gw, 0.04, '#2c2f36');
    } else {
      p.grad(gx, 0.4, gw, GF - 0.7, [[0, 'rgba(255,150,60,0.7)'], [1, 'rgba(255,225,170,0.9)']]);
    }
  }
  FL.forEach((yb, f) => {
    for (let m = 0; m < L.nM; m++) {
      const cx = L.gs + (m + 0.5) * L.mw;
      if (L.cornerX - cx < 1.9) continue; // the corner window box sits there
      if ((m + f) % 2 === 1) lattice(p, pass, cx - 0.95, yb + 0.7, 1.9, 2.1);
      else bayWindow(p, pass, cx - 0.9, yb + 0.7, 1.8, 2.1, 100 + f * 10 + m);
    }
  });
  if (pass === 'day') {
    p.rect(left, TOPF - 0.25, W, 0.25, '#8d9199');
  }
}

function drawSide(p, pass, Wm) {
  if (pass === 'day') {
    p.grad(-Wm / 2, 0, Wm, H, [[0, '#868a93'], [0.5, '#a0a4ac'], [1, '#aaaeb5']]);
    p.rect(-Wm / 2, 0, Wm, 0.4, '#4a4d54');
  }
  const n = Math.max(2, Math.round(Wm / 3.4));
  for (let i = 0; i < n; i++) {
    const cx = -Wm / 2 + ((i + 0.5) * Wm) / n;
    FL.forEach((yb, f) => {
      if ((i + f) % 2) lattice(p, pass, cx - 0.9, yb + 0.7, 1.8, 2.1);
      else bayWindow(p, pass, cx - 0.85, yb + 0.7, 1.7, 2.1, 200 + f * 10 + i);
    });
    if (pass === 'day') {
      p.rect(cx - 0.9, 0.9, 1.8, 2.4, '#2c2f36');
      p.grad(cx - 0.8, 1.0, 1.6, 2.2, [[0, '#6f6a60'], [1, '#e6cf9f']]);
    } else p.grad(cx - 0.8, 1.0, 1.6, 2.2, [[0, 'rgba(255,150,60,0.6)'], [1, 'rgba(255,225,160,0.85)']]);
  }
}

/** A red-framed window box texture (front face of a cantilevered bay). */
function boxDraw(w, h, seed) {
  return (g, pw) => {
    const p = new Pen(g, pw / w, w, h);
    p.rect(-w / 2, 0, w, h, RED);
    p.rect(-w / 2 + 0.16, 0.16, w - 0.32, h - 0.32, '#202428');
    bayWindow(p, 'day', -w / 2 + 0.2, 0.2, w - 0.4, h - 0.4, seed);
    p.rect(-w / 2, 0, w, 0.08, RED_D);
  };
}
function boxGlowDraw(w, h, seed) {
  return (g, pw) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, pw, g.canvas.height);
    const p = new Pen(g, pw / w, w, h);
    bayWindow(p, 'glow', -w / 2 + 0.2, 0.2, w - 0.4, h - 0.4, seed);
  };
}

export function buildOyo(kit, plan, parent) {
  const { W, D } = plan;
  const L = layout(W);
  const g = new Group();
  g.position.set(plan.cx, 0.2, plan.cz);
  g.rotation.y = plan.theta;
  parent.add(g);
  const bld = new Group();
  bld.position.y = PLINTH;
  g.add(bld);

  const front = facadeTextures(kit, W, H, { ppm: 48, draw: (p, pass) => drawFront(p, pass, L, kit) });
  const side = facadeTextures(kit, D, H, { ppm: 40, draw: (p, pass) => drawSide(p, pass, D) });
  const frontMat = kit.texMat({ map: front.map, glow: front.glow, k: 0.85, rough: 0.7, offset: 1 });
  const sideMat = kit.texMat({ map: side.map, glow: side.glow, k: 0.8, rough: 0.7, offset: 1 });
  const backMat = kit.texMat({ map: front.map, glow: front.glow, k: 0.4, rough: 0.7, offset: 1 });
  const E = 0.03;
  // the grey facade plane starts where the red feature wall (a separate, proud plane) ends
  const redFrac = L.redW / W;
  kit.plane(bld, frontMat, W - L.redW, H, L.redW / 2, 0, D / 2 + E, 0, { uv: [redFrac, 0, 1, 1] });
  kit.plane(bld, frontMat, L.redW, H, -W / 2 + L.redW / 2, 0, D / 2 + 0.4 + E, 0, { uv: [0, 0, redFrac, 1] });
  kit.plane(bld, sideMat, D, H, W / 2 + E, 0, 0, Math.PI / 2);
  kit.plane(bld, sideMat, D, H, -W / 2 - E, 0, 0, -Math.PI / 2);
  kit.plane(bld, backMat, W, H, 0, 0, -D / 2 - E, Math.PI);
  kit.loadLogo('oyo');

  const b = new Batch();
  b.push(0, PLINTH, 0);
  b.box(W, H, D, 0, 0, 0, GREY);
  // the red wall stands proud of the grey facade
  b.box(L.redW, H, 0.4, -W / 2 + L.redW / 2, 0, D / 2 + 0.2, RED);
  b.box(L.redW + 0.2, 0.3, 0.6, -W / 2 + L.redW / 2, H - 0.3, D / 2 + 0.3, RED_D);
  b.box(0.3, H, 0.55, -W / 2 + L.redW + 0.05, 0, D / 2 + 0.27, RED_D);
  // grey cornice bands with dentils between floors, wrapping the grey part
  const gx0 = L.gs - 0.2;
  const gxw = W / 2 + 0.2 - gx0;
  const gcx = (gx0 + W / 2 + 0.2) / 2;
  for (const y of [GF, ...FL.slice(1), TOPF - 0.3]) {
    b.box(gxw, 0.3, 0.6, gcx, y - 0.15, D / 2 + 0.3, GREY_D);
    b.box(gxw + 0.1, 0.1, 0.7, gcx, y + 0.15, D / 2 + 0.33, GREY_L);
    for (let x = gx0 + 0.3; x < W / 2; x += 0.4) b.box(0.18, 0.18, 0.5, x, y - 0.32, D / 2 + 0.25, GREY_L);
  }
  // cantilevered red window boxes: three on the red wall, one on each floor at the corner
  const bw = 1.9;
  const bh = 2.3;
  const bd = 0.75;
  const boxes = [];
  FL.forEach((yb) => {
    boxes.push([L.boxX, yb + 0.55]);
    boxes.push([L.cornerX, yb + 0.55]);
  });
  for (const [x, y] of boxes) {
    b.box(bw, bh, bd, x, y, D / 2 + bd / 2 + 0.4, RED);
    b.box(bw + 0.2, 0.12, bd + 0.2, x, y + bh, D / 2 + bd / 2 + 0.4, RED_D);
    b.box(bw + 0.2, 0.12, bd + 0.2, x, y - 0.12, D / 2 + bd / 2 + 0.4, RED_D);
  }
  // roof-edge railing, plant, tank
  b.box(W + 0.4, 0.2, D + 0.4, 0, H, 0, GREY_D);
  const ry = H + 0.2;
  for (let x = -W / 2 + 0.1; x <= W / 2; x += 1.0) b.cyl(0.04, 0.04, 1.0, x, ry, D / 2 + 0.1, '#d9dbe0', { seg: 5, mat: 'metal' });
  b.box(W, 0.06, 0.06, 0, ry + 1.0, D / 2 + 0.1, '#d9dbe0', { mat: 'metal' });
  b.box(W, 0.05, 0.05, 0, ry + 0.5, D / 2 + 0.1, '#d9dbe0', { mat: 'metal' });
  for (const sx of [-1, 1]) {
    for (let z = -D / 2 + 1; z < D / 2; z += 1.0) b.cyl(0.04, 0.04, 1.0, sx * (W / 2 + 0.1), ry, z, '#d9dbe0', { seg: 5, mat: 'metal' });
    b.box(0.06, 0.06, D, sx * (W / 2 + 0.1), ry + 1.0, 0, '#d9dbe0', { mat: 'metal' });
  }
  b.box(W - 0.6, 0.3, D - 0.6, 0, H + 0.2, 0, '#8a8d93');
  b.box(2.4, 1.6, 2.0, W * 0.15, H + 0.5, -D * 0.2, '#b9bcc3');
  b.cyl(0.95, 0.95, 1.6, -W * 0.15, H + 0.5, -D * 0.2, '#e8e9ec', { seg: 12 });
  b.box(L.redW - 0.6, 0.5, 0.25, -W / 2 + L.redW / 2, H + 0.5, D / 2 - 0.5, RED);
  b.pop();

  // plinth, canopy columns and slab, planters, palms and shrubs
  b.box(W + 0.5, PLINTH, D + 0.5, 0, 0, 0, '#8d8c92');
  const cw = L.mw + 2.6;
  const cz = D / 2 + 2.3;
  for (const sx of [-0.5, 0.5]) {
    b.cyl(0.3, 0.34, 4.0, L.entX + sx * (cw - 0.6), 0, cz - 0.2, '#d8d6d0', { seg: 12 });
    b.box(0.8, 0.18, 0.8, L.entX + sx * (cw - 0.6), 0, cz - 0.2, '#b3b0aa');
    b.box(0.8, 0.2, 0.8, L.entX + sx * (cw - 0.6), 3.9, cz - 0.2, '#b3b0aa');
  }
  b.box(cw + 0.8, 0.4, 2.8, L.entX, PLINTH + 4.0 - PLINTH, D / 2 + 1.4, GREY_L);
  b.box(cw + 0.9, 0.22, 0.2, L.entX, 4.0, D / 2 + 2.9, RED);
  b.box(cw - 0.4, 0.04, 2.0, L.entX, 3.95, D / 2 + 1.4, '#ffe9c4', { mat: 'lamp' });
  b.box(cw, 0.14, 1.0, L.entX, 0, D / 2 + 0.6, '#b9b6af');
  // palms and shrubs
  const palm = (x, z, hgt, lean) => {
    b.cyl(0.14, 0.26, hgt, x, 0, z, '#8a6a52', { seg: 6, rz: lean });
    const tx = x - Math.sin(lean) * hgt;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.cone(0.3, 2.8, tx + Math.cos(a) * 1.05, hgt + 0.1, z + Math.sin(a) * 1.05, i % 2 ? '#3f9a52' : '#2f8a4a', { seg: 4, rz: Math.cos(a) * 1.2, rx: -Math.sin(a) * 1.2 });
    }
    b.sph(0.35, tx, hgt + 0.1, z, '#2b7a40', { w: 6, h: 4 });
  };
  palm(-W / 2 + 1.6, D / 2 + 3.6, 5.2, 0.08);
  palm(-W / 2 + 4.8, D / 2 + 4.2, 4.2, -0.07);
  palm(W / 2 - 0.8, D / 2 + 3.2, 4.8, -0.06);
  for (const sx of [-1, 1]) {
    b.box(1.2, 0.5, 0.9, L.entX + sx * (cw / 2 + 1.8), 0, D / 2 + 1.2, '#4a3a30');
    for (let k = 0; k < 3; k++) b.sph(0.45, L.entX + sx * (cw / 2 + 1.8) + (k - 1) * 0.4, 0.8, D / 2 + 1.2, '#2d7a45', { w: 7, h: 5 });
  }
  const rng = (i) => hash01(plan.cx | 0, plan.cz | 0, i + 90);
  const man = (x, z, yaw, i, o = {}) => addPerson(b, x, z, { yaw, shirt: SHIRTS[Math.floor(rng(i) * SHIRTS.length)], skin: SKINS[Math.floor(rng(i + 5) * SKINS.length)], pants: '#2c3e50', h: 1.55 + rng(i + 3) * 0.3, ...o });
  man(L.entX - 1.0, D / 2 + 1.5, 0.3, 1);
  man(L.entX + 1.6, D / 2 + 2.0, -0.4, 2);
  man(L.entX + 2.4, D / 2 + 2.0, -0.6, 3, { shirt: '#fff' });
  kit.flush(b, g);

  // window-box fronts
  const boxMap = kit.tex(256, Math.round((256 * bh) / bw), boxDraw(bw, bh, 11));
  const boxGlow = kit.tex(128, Math.round((128 * bh) / bw), boxGlowDraw(bw, bh, 11));
  const boxMat = kit.texMat({ map: boxMap, glow: boxGlow, k: 0.8, rough: 0.6 });
  for (const [x, y] of boxes) kit.plane(bld, boxMat, bw - 0.02, bh - 0.02, x, y + 0.01, D / 2 + bd + 0.4 + 0.02, 0);
  kit.pool(g, '#ffd7a0', W * 0.8, 8, L.entX * 0.6, D / 2 + 4.0, 0.45);
  return g;
}
