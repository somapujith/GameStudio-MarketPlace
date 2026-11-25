// Bawarchi: a classical four-storey restaurant. Cream facade, fluted pilasters with gold bands, window surrounds with small
// pediments, gold-trimmed cornices with dentils, a dark charcoal arched sign board with a white script wordmark and a chef
// emblem, a long yellow-and-white striped canopy, a black "Since Jan-1994" board and a warm lit doorway with a queue.
import { DoubleSide, Group, Shape } from 'three';
import { Batch, shapeBoard, Pen, SCRIPT, addPerson, drawChef, facadeTextures, hash01, SHIRTS, SKINS } from './shop-kit.js';

const CREAM = '#efe3c6';
const TRIM = '#faf3e0';
const FLUTE = '#d8cba9';
const GOLD = '#e2b13f';
const CHAR = '#2c2d31';
const GF = 5.0;
const FL = [5.0, 8.5, 12.0];
const TOPF = 15.5;
const H = 16.3;
const PLINTH = 0.35;

function layout(W) {
  let N = 2 * Math.round((W / 4 - 1) / 2) + 1;
  N = Math.max(5, N);
  const bw = W / N;
  const mid = (N - 1) / 2;
  return { W, N, bw, mid, xc: (i) => -W / 2 + (i + 0.5) * bw, entX: -W / 2 + (mid + 0.5) * bw };
}

function archPath(p, cx, y0, w, h) {
  const g = p.g;
  g.beginPath();
  const x0 = p.X(cx - w / 2);
  const x1 = p.X(cx + w / 2);
  const yb = p.Y(y0);
  const ya = p.Y(y0 + h - w / 2);
  g.moveTo(x0, yb);
  g.lineTo(x0, ya);
  g.ellipse((x0 + x1) / 2, ya, (x1 - x0) / 2, p.S(w / 2), 0, Math.PI, 0);
  g.lineTo(x1, yb);
  g.closePath();
}

function window2(p, pass, cx, y, w, h, seed) {
  const x = cx - w / 2;
  if (pass === 'day') {
    p.rect(x - 0.12, y - 0.12, w + 0.24, h + 0.24, '#f7f0dc');
    p.grad(x, y, w, h, [[0, '#2f4a5a'], [1, '#6f94a6']]);
    p.rect(x, y, w * 0.2, h, 'rgba(244,230,200,0.9)');
    p.rect(x + w * 0.8, y, w * 0.2, h, 'rgba(244,230,200,0.9)');
    p.rect(x + w / 2 - 0.03, y, 0.06, h, '#f7f0dc');
    p.rect(x, y + h * 0.62, w, 0.05, '#f7f0dc');
  } else if (hash01(seed, 3, 9) < 0.7) {
    p.grad(x, y, w, h, [[0, 'rgba(255,165,80,0.6)'], [1, 'rgba(255,225,170,0.8)']]);
    p.rect(x, y, w * 0.2, h, 'rgba(255,200,130,0.5)');
    p.rect(x + w * 0.8, y, w * 0.2, h, 'rgba(255,200,130,0.5)');
  }
}

function drawFront(p, pass, L) {
  const { W, N, bw, mid } = L;
  if (pass === 'day') {
    p.grad(-W / 2, 0, W, H, [[0, '#d9cba8'], [0.3, '#efe3c6'], [1, '#f3e9cf']]);
    for (let y = 0.6; y < GF; y += 0.5) p.line(-W / 2, y, W / 2, y, 0.015, 'rgba(120,100,60,0.22)');
    for (const y of FL) p.rect(-W / 2, y - 0.04, W, 0.08, 'rgba(150,125,70,0.35)');
    p.rect(-W / 2, 0, W, 0.5, '#8d7f68');
  }
  // ground floor windows and the arched doorway
  for (let i = 0; i < N; i++) {
    const cx = L.xc(i);
    if (i === mid) {
      const w = 2.6;
      const h = 3.9;
      if (pass === 'day') {
        p.rect(cx - w / 2 - 0.2, 0.4, w + 0.4, h, TRIM);
        archPath(p, cx, 0.4, w + 0.4, h + 0.2);
        p.g.fillStyle = TRIM;
        p.g.fill();
        archPath(p, cx, 0.5, w, h);
        const gr = p.g.createLinearGradient(0, p.Y(0.5 + h), 0, p.Y(0.5));
        gr.addColorStop(0, '#fff0c8');
        gr.addColorStop(1, '#e09a4e');
        p.g.fillStyle = gr;
        p.g.fill();
        p.line(cx, 0.5, cx, 3.2, 0.06, '#5a4a38');
        p.rect(cx - w / 2, 3.2, w, 0.05, '#5a4a38');
        p.circle(cx, 4.0, 0.1, '#fffbe8');
      } else {
        archPath(p, cx, 0.5, w, h);
        const gr = p.g.createLinearGradient(0, p.Y(0.5 + h), 0, p.Y(0.5));
        gr.addColorStop(0, 'rgba(255,225,160,0.95)');
        gr.addColorStop(1, 'rgba(255,160,70,0.9)');
        p.g.fillStyle = gr;
        p.g.fill();
      }
      continue;
    }
    const w = bw - 1.5;
    if (pass === 'day') {
      p.rect(cx - w / 2 - 0.12, 0.88, w + 0.24, 3.0, TRIM);
      p.grad(cx - w / 2, 1.0, w, 2.76, [[0, '#a8672f'], [0.5, '#f0c488'], [1, '#fff0c8']]);
      p.rect(cx - 0.03, 1.0, 0.06, 2.76, TRIM);
      p.rect(cx - w / 2, 2.6, w, 0.05, TRIM);
      for (let k = 0; k < 3; k++) p.rect(cx - w / 2 + 0.2 + k * (w / 3), 1.0, w / 5, 0.8, 'rgba(80,40,20,0.4)');
    } else {
      p.grad(cx - w / 2, 1.0, w, 2.76, [[0, 'rgba(255,150,60,0.7)'], [1, 'rgba(255,225,160,0.9)']]);
    }
  }
  // upper windows
  FL.forEach((yb, f) => {
    for (let i = 0; i < N; i++) {
      if (i === mid && f < 2) continue;
      window2(p, pass, L.xc(i), yb + 0.72, 1.5, 2.25, f * 20 + i);
    }
  });
  if (pass === 'day') {
    // top frieze
    p.rect(-W / 2, TOPF - 0.3, W, 0.3, '#e6d9b8');
    p.rect(-W / 2, TOPF, W, H - TOPF, '#f5ecd2');
  }
}

function drawSide(p, pass, Wm) {
  const N = Math.max(2, Math.round(Wm / 3.6));
  const bw = Wm / N;
  if (pass === 'day') {
    p.grad(-Wm / 2, 0, Wm, H, [[0, '#d9cba8'], [0.3, '#efe3c6'], [1, '#f3e9cf']]);
    p.rect(-Wm / 2, 0, Wm, 0.5, '#8d7f68');
    for (const y of FL) p.rect(-Wm / 2, y - 0.04, Wm, 0.08, 'rgba(150,125,70,0.35)');
  }
  for (let i = 0; i < N; i++) {
    const cx = -Wm / 2 + (i + 0.5) * bw;
    FL.forEach((yb, f) => window2(p, pass, cx, yb + 0.72, 1.4, 2.2, 300 + f * 17 + i));
    if (pass === 'day') {
      p.rect(cx - 0.7, 1.0, 1.4, 2.6, '#f7f0dc');
      p.grad(cx - 0.6, 1.1, 1.2, 2.4, [[0, '#a8672f'], [1, '#f0d09a']]);
    } else p.grad(cx - 0.6, 1.1, 1.2, 2.4, [[0, 'rgba(255,150,60,0.6)'], [1, 'rgba(255,225,160,0.85)']]);
  }
}

function archSignDraw(kit, w, h) {
  return (g, pw) => {
    const p = new Pen(g, pw / w, w, h);
    const grd = g.createLinearGradient(0, 0, 0, p.S(h));
    grd.addColorStop(0, '#34353a');
    grd.addColorStop(1, '#222327');
    g.fillStyle = grd;
    g.fillRect(0, 0, p.S(w), p.S(h));
    // gold inset following the arch
    archPath(p, 0, 0.18, w - 0.36, h - 0.18);
    g.lineWidth = p.S(0.07);
    g.strokeStyle = GOLD;
    g.stroke();
    archPath(p, 0, 0.3, w - 0.6, h - 0.3);
    g.lineWidth = p.S(0.025);
    g.strokeStyle = 'rgba(211,162,56,0.7)';
    g.stroke();
    if (kit.drawLogo('bawarchi', p, -w / 2 + 0.8, 0.5, w - 1.6, h - 1.1)) return;
    drawChef(p, 0, h * 0.72, 0.5);
    p.text('Bawarchi', 0, h * 0.4, 1.55, { font: SCRIPT, weight: 700, color: '#fff', maxW: w - 1.6, shadow: { color: 'rgba(0,0,0,0.5)', blur: 0.06 } });
    p.text('RESTAURANT', 0, 0.62, 0.3, { color: GOLD, weight: 700, spacing: 0.14 });
  };
}

function infoDraw(w, h) {
  return (g, pw) => {
    const p = new Pen(g, pw / w, w, h);
    p.rect(-w / 2, 0, w, h, '#17171a');
    p.rrect(-w / 2 + 0.06, 0.06, w - 0.12, h - 0.12, 0.05, null, GOLD, 0.03);
    p.text('Bawarchi', 0, h * 0.7, 0.34, { font: SCRIPT, weight: 700, color: '#fff', maxW: w - 0.3 });
    p.text('Since Jan-1994', 0, h * 0.38, 0.2, { font: SCRIPT, weight: 700, color: '#f3e4b8', maxW: w - 0.3 });
    p.rect(-w / 2 + 0.2, h * 0.2, w - 0.4, 0.015, GOLD);
    p.text('FAMOUS HYDERABADI BIRYANI', 0, h * 0.12, 0.075, { color: GOLD, weight: 700, spacing: 0.03, maxW: w - 0.3 });
  };
}

function stripeDraw(g, w, h) {
  const n = 16;
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? '#fbf5e6' : '#f2c230';
    g.fillRect((i * w) / n, 0, w / n + 1, h);
  }
}

export function buildBawarchi(kit, plan, parent) {
  const { W, D } = plan;
  const L = layout(W);
  const g = new Group();
  g.position.set(plan.cx, 0.2, plan.cz);
  g.rotation.y = plan.theta;
  parent.add(g);
  const bld = new Group();
  bld.position.y = PLINTH;
  g.add(bld);
  kit.loadLogo('bawarchi');

  const front = facadeTextures(kit, W, H, { ppm: 40, draw: (p, pass) => drawFront(p, pass, L) });
  const side = facadeTextures(kit, D, H, { ppm: 40, draw: (p, pass) => drawSide(p, pass, D) });
  const frontMat = kit.texMat({ map: front.map, glow: front.glow, k: 0.85, rough: 0.8, offset: 1 });
  const sideMat = kit.texMat({ map: side.map, glow: side.glow, k: 0.8, rough: 0.8, offset: 1 });
  const backMat = kit.texMat({ map: front.map, glow: front.glow, k: 0.4, rough: 0.8, offset: 1 });
  const E = 0.03;
  kit.plane(bld, frontMat, W, H, 0, 0, D / 2 + E, 0);
  kit.plane(bld, sideMat, D, H, W / 2 + E, 0, 0, Math.PI / 2);
  kit.plane(bld, sideMat, D, H, -W / 2 - E, 0, 0, -Math.PI / 2);
  kit.plane(bld, backMat, W, H, 0, 0, -D / 2 - E, Math.PI);

  const b = new Batch();
  b.push(0, PLINTH, 0);
  b.box(W, H, D, 0, 0, 0, CREAM);
  // pilasters: piers on the ground floor, fluted pilasters with gold bands above
  for (let i = 0; i <= L.N; i++) {
    const x = -W / 2 + i * L.bw;
    b.box(0.7, GF - 0.4, 0.3, x, 0.4, D / 2 + 0.15, TRIM);
    b.box(0.75, TOPF - GF - 0.6, 0.3, x, GF + 0.3, D / 2 + 0.15, TRIM);
    for (const fx of [-0.2, 0, 0.2]) b.box(0.07, TOPF - GF - 1.2, 0.34, x + fx, GF + 0.6, D / 2 + 0.17, FLUTE);
    for (const y of [GF + 0.35, 8.5 - 0.15, 12.0 - 0.15, TOPF - 0.35]) b.box(0.88, 0.16, 0.38, x, y, D / 2 + 0.17, GOLD);
  }
  // cornice over the ground floor and the top cornice, both with dentils and a gold line
  const cornice = (y, sc) => {
    b.box(W + 0.7, 0.34 * sc, 0.8 * sc, 0, y, D / 2 + 0.3 * sc, TRIM);
    b.box(W + 0.8, 0.1, 0.88 * sc, 0, y + 0.34 * sc, D / 2 + 0.32 * sc, GOLD);
    b.box(W + 0.5, 0.16, 0.5 * sc, 0, y - 0.16, D / 2 + 0.2 * sc, TRIM);
    for (let x = -W / 2 + 0.3; x < W / 2; x += 0.42) b.box(0.2, 0.2, 0.3 * sc, x, y - 0.36, D / 2 + 0.2, '#f3e8cc');
  };
  cornice(GF - 0.15, 1);
  cornice(TOPF, 1.25);
  for (const y of [8.5, 12.0]) b.box(W + 0.3, 0.16, 0.34, 0, y - 0.14, D / 2 + 0.15, TRIM);
  // window surrounds: sills, lintels and small pediments
  FL.forEach((yb, f) => {
    for (let i = 0; i < L.N; i++) {
      if (i === L.mid && f < 2) continue;
      const x = L.xc(i);
      b.box(2.0, 0.16, 0.34, x, yb + 0.6, D / 2 + 0.17, TRIM);
      for (const sx of [-1, 1]) b.box(0.12, 2.4, 0.14, x + sx * 0.9, yb + 0.72, D / 2 + 0.08, TRIM);
      b.box(1.95, 0.2, 0.3, x, yb + 2.97, D / 2 + 0.15, TRIM);
      if (f !== 1) b.prism(2.0, 0.5, 0.24, x, yb + 3.17, D / 2 + 0.13, TRIM);
      else b.box(1.6, 0.14, 0.3, x, yb + 3.17, D / 2 + 0.15, GOLD);
    }
  });
  // ground-floor window frames
  for (let i = 0; i < L.N; i++) {
    if (i === L.mid) continue;
    const x = L.xc(i);
    b.box(L.bw - 1.2, 0.18, 0.3, x, 0.8, D / 2 + 0.15, TRIM);
  }
  // doorway surround
  b.box(0.35, 4.3, 0.36, L.entX - 1.75, 0.4, D / 2 + 0.18, TRIM);
  b.box(0.35, 4.3, 0.36, L.entX + 1.75, 0.4, D / 2 + 0.18, TRIM);
  // roof: balustrade, urns, tank
  const by = H;
  b.box(W + 0.6, 0.16, D + 0.6, 0, by, 0, TRIM);
  for (let x = -W / 2 + 0.2; x < W / 2; x += 0.55) b.cyl(0.07, 0.07, 0.8, x, by + 0.16, D / 2 + 0.1, TRIM, { seg: 6 });
  b.box(W + 0.5, 0.14, 0.3, 0, by + 0.96, D / 2 + 0.1, TRIM);
  for (const sx of [-1, 1]) {
    b.box(0.5, 0.6, 0.5, sx * (W / 2 - 0.2), by + 0.16, D / 2 + 0.1, TRIM);
    b.sph(0.34, sx * (W / 2 - 0.2), by + 1.0, D / 2 + 0.1, GOLD);
  }
  b.box(W - 1, 0.6, D - 1, 0, by + 0.16, 0, '#9b958c');
  b.cyl(1.0, 1.0, 1.8, W * 0.26, by + 0.76, -D * 0.2, '#2b79b8', { seg: 14 });
  b.box(2.2, 1.6, 2.0, -W * 0.2, by + 0.76, -D * 0.2, '#b8b0a2');
  // arched sign board (a solid with the sign as its face) is added below; charcoal bracket shadow box behind it
  b.pop();

  // entrance steps, planters, plinth
  b.box(W + 0.5, PLINTH, D + 0.5, 0, 0, 0, '#9a8e7a');
  b.box(5.6, 0.16, 0.6, L.entX, 0, D / 2 + 0.55, '#b3a894');
  b.box(6.2, 0.16, 0.4, L.entX, 0, D / 2 + 0.9, '#a89d89');
  for (const sx of [-1, 1]) {
    b.cyl(0.45, 0.38, 0.6, L.entX + sx * 3.4, 0, D / 2 + 0.7, '#6d4a37', { seg: 8 });
    b.sph(0.5, L.entX + sx * 3.4, 0.95, D / 2 + 0.7, '#2d7a45', { w: 8, h: 6 });
  }
  // canopy supports (thin steel rods) and the info board posts
  const cw = Math.min(W * 0.62, 14);
  const cd = 2.7;
  for (const sx of [-0.5, 0.5]) b.cyl(0.05, 0.05, 3.9, L.entX + sx * cw, 0, D / 2 + cd - 0.1, '#3b3b40', { seg: 6, mat: 'metal' });
  // queue toward the door
  const rng = (i) => hash01(plan.cx | 0, plan.cz | 0, i + 40);
  for (let i = 0; i < 5; i++) {
    const px = L.entX + 0.6 + i * 0.85;
    const pz = D / 2 + 1.3 + i * 0.5;
    const yaw = Math.atan2(L.entX - px, D / 2 - pz);
    addPerson(b, px, pz, { yaw, shirt: SHIRTS[Math.floor(rng(i) * SHIRTS.length)], skin: SKINS[Math.floor(rng(i + 7) * SKINS.length)], pants: i % 2 ? '#2c3e50' : '#40342c', h: 1.55 + rng(i + 3) * 0.3 });
  }
  addPerson(b, L.entX - 2.0, D / 2 + 1.6, { yaw: 0.6, shirt: '#e8e2d2', skin: '#a8714b', pants: '#2b2b30', h: 1.75 });
  kit.flush(b, g);

  // arched sign board on the wall over the doorway
  const sbw = Math.min(7.2, L.bw * 2.1);
  const sbh = 3.5;
  const sbTex = kit.tex(1024, Math.round((1024 * sbh) / sbw), archSignDraw(kit, sbw, sbh));
  const sbMat = kit.texMat({ map: sbTex, glow: true, k: 0.95, base: 0.3, rough: 0.5 });
  const sideM = kit.texMat({ map: sbTex, rough: 0.6 });
  sideM.color.set('#2a2b2f');
  sideM.map = null;
  const arch = new Shape();
  const rise = sbw / 2;
  arch.moveTo(-sbw / 2, 0);
  arch.lineTo(sbw / 2, 0);
  arch.lineTo(sbw / 2, sbh - rise);
  arch.absellipse(0, sbh - rise, sbw / 2, rise, 0, Math.PI, false);
  arch.lineTo(-sbw / 2, 0);
  const board = shapeBoard(kit, arch, sbw, sbh, 0.38, sbMat, sideM);
  board.position.set(L.entX, 5.75, D / 2 + 0.05);
  bld.add(board);

  // striped canopy over the entrance
  const a = Math.atan2(0.65, cd);
  const stripe = kit.tex(512, 128, stripeDraw);
  const stripeMat = kit.texMat({ map: stripe, rough: 0.75, side: DoubleSide });
  const top = kit.plane(bld, stripeMat, cw, cd / Math.cos(a), L.entX, 0, 0, 0, { repeat: [1, 1] });
  top.rotation.x = -Math.PI / 2 + a;
  top.position.set(L.entX, 4.35, D / 2 + cd / 2);
  top.castShadow = true;
  const valTex = kit.tex(512, 64, (gc, w, h) => {
    const n = 16;
    for (let i = 0; i < n; i++) {
      gc.fillStyle = i % 2 ? '#fbf5e6' : '#f2c230';
      gc.fillRect((i * w) / n, 0, w / n + 1, h * 0.7);
      gc.beginPath();
      gc.arc(((i + 0.5) * w) / n, h * 0.7, w / n / 2, 0, Math.PI);
      gc.fill();
    }
  });
  const valMat = kit.texMat({ map: valTex, rough: 0.75, transparent: true, alphaTest: 0.4, side: DoubleSide });
  kit.plane(bld, valMat, cw, 0.62, L.entX, 3.5, D / 2 + cd + 0.02, 0);
  // black info board beside the door
  const iw = 1.5;
  const ih = 1.9;
  const infoTex = kit.tex(512, Math.round((512 * ih) / iw), infoDraw(iw, ih));
  const infoMat = kit.texMat({ map: infoTex, glow: true, k: 0.7, base: 0.15, rough: 0.5 });
  const ib = new Batch();
  ib.box(iw + 0.14, ih + 0.14, 0.1, L.entX + 3.75, 0.9, D / 2 + 0.1, '#222226');
  ib.box(cw - 1, 0.04, 0.14, L.entX, 3.93, D / 2 + 1.4, '#ffe2b0', { mat: 'lamp' });
  kit.flush(ib, bld);
  kit.plane(bld, infoMat, iw, ih, L.entX + 3.75, 0.97, D / 2 + 0.17, 0);
  // lamp strip under the canopy + warm pool
  kit.pool(g, '#ffb468', W * 0.8, 9, L.entX * 0.5, D / 2 + 4.5, 0.5);
  return g;
}
