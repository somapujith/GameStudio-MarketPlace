// Paradise Biryani: a modern four-storey restaurant. Deep maroon grooved composite cladding, glass curtain-wall bays between
// projecting fins, a cantilevered sign band ("Paradise" with the orange P emblem), a "Restaurant" canopy sign, a Takeaway
// corner counter, vertical glass lettering and a warm glazed entrance with steps. Wordmarks are drawn in code.
import { Group } from 'three';
import { Batch, FONT, Pen, addPerson, facadeTextures, hash01, SHIRTS, SKINS } from './shop-kit.js';

const MAROON = '#7a1a2d';
const MAROON_D = '#55101f';
const STEEL = '#3d4048';
const STONE = '#cfc6bd';
const FLOORS = [4.6, 8.2, 11.8];
const TOP = 15.4;
const H = 16.2;
const PLINTH = 0.3;

function layout(W, D) {
  const N = Math.max(4, Math.round(W / 3));
  const bayW = W / N;
  const gfStart = -W / 2 + 4.0;
  const gfEnd = W / 2 - 0.4;
  const nM = Math.max(3, Math.round((gfEnd - gfStart) / 3.1));
  const mw = (gfEnd - gfStart) / nM;
  const ent = Math.floor(nM / 2);
  return { W, D, N, bayW, gf: { start: gfStart, end: gfEnd, nM, mw, ent, entX: gfStart + (ent + 0.5) * mw } };
}

function glassPane(p, pass, x, y, w, h, seed) {
  if (pass === 'day') {
    p.grad(x, y, w, h, [[0, '#2f5f80'], [0.55, '#6aa3c4'], [1, '#a9d0e2']]);
    p.clipRect(x, y, w, h);
    for (let k = -2; k < 4; k++) p.line(x + k * w * 0.45, y, x + k * w * 0.45 + h * 0.7, y + h, 0.16, 'rgba(255,255,255,0.13)');
    p.restore();
    p.line(x + w / 2, y, x + w / 2, y + h, 0.05, '#2c3037');
    p.line(x, y + h * 0.62, x + w, y + h * 0.62, 0.04, '#2c3037');
  } else if (hash01(seed, 7, 3) < 0.72) {
    p.grad(x, y, w, h, [[0, 'rgba(255,170,90,0.55)'], [1, 'rgba(255,225,170,0.75)']]);
  }
}

function spandrel(p, x, y, w, h) {
  p.clipRect(x, y, w, h);
  for (let d = -h; d < w + h; d += 0.28) p.line(x + d, y, x + d + h, y + h, 0.018, 'rgba(0,0,0,0.3)');
  p.restore();
}

function cladding(p, W, H2) {
  p.grad(-W / 2, 0, W, H2, [[0, '#4a0c18'], [0.4, '#7a1a2d'], [1, '#8c2438']]);
  for (let x = -W / 2; x < W / 2; x += 0.22) {
    p.line(x, 0, x, H2, 0.014, 'rgba(0,0,0,0.3)');
    p.line(x + 0.025, 0, x + 0.025, H2, 0.01, 'rgba(255,210,210,0.07)');
  }
}

function drawFront(p, pass, L, kit) {
  const { W, N, bayW, gf } = L;
  if (pass === 'day') cladding(p, W, H);
  // upper floors: curtain-wall glass bays between the fins
  FLOORS.forEach((yb, f) => {
    for (let i = 0; i < N; i++) {
      const x0 = -W / 2 + i * bayW;
      const last = i === N - 1 && f < 2;
      if (last) continue;
      const gx = x0 + 0.4;
      const gw = bayW - 0.8;
      glassPane(p, pass, gx, yb + 0.6, gw, 2.85, f * 40 + i);
      if (pass === 'day') spandrel(p, x0, yb, bayW, 0.55);
    }
  });
  // the tall glass strip with the vertical lettering (right-hand bay, floors 2 and 3)
  {
    const x0 = W / 2 - bayW + 0.4;
    const w = bayW - 0.8;
    const y0 = FLOORS[0] + 0.6;
    const hh = FLOORS[2] - FLOORS[0] - 0.75;
    if (pass === 'day') {
      p.grad(x0, y0, w, hh, [[0, '#2f5f80'], [0.5, '#5f9abd'], [1, '#a9d0e2']]);
      p.text("WORLD'S FAVOURITE BIRYANI", x0 + w / 2, y0 + hh / 2, w * 0.42, { rot: Math.PI / 2, color: 'rgba(255,255,255,0.93)', weight: 700, spacing: 0.06, maxW: hh - 0.5 });
    } else {
      p.grad(x0, y0, w, hh, [[0, 'rgba(255,150,80,0.35)'], [1, 'rgba(255,215,160,0.45)']]);
      p.text("WORLD'S FAVOURITE BIRYANI", x0 + w / 2, y0 + hh / 2, w * 0.42, { rot: Math.PI / 2, color: 'rgba(255,255,255,0.95)', weight: 700, spacing: 0.06, maxW: hh - 0.5 });
    }
  }
  // ground floor
  if (pass === 'day') {
    p.rect(-W / 2, 0, W, 0.4, '#241719');
    p.rect(-W / 2, FLOORS[0] - 0.12, W, 0.12, '#2a0a11');
  }
  // takeaway counter window
  {
    const x0 = -W / 2 + 0.6;
    const w = 2.8;
    if (pass === 'day') {
      p.grad(x0, 1.0, w, 2.4, [[0, '#9a5a2a'], [1, '#ffd9a0']]);
      p.rect(x0 - 0.12, 0.85, w + 0.24, 0.2, STONE);
      p.rect(x0, 1.05, w, 0.05, 'rgba(0,0,0,0.35)');
      p.rect(x0 + 0.5, 1.1, 0.5, 0.6, '#f4efe6');
      p.rect(x0 + 1.5, 1.1, 0.5, 0.7, '#e8dcc8');
    } else {
      p.grad(x0, 1.0, w, 2.4, [[0, 'rgba(255,160,70,0.85)'], [1, 'rgba(255,230,170,0.95)']]);
    }
  }
  for (let m = 0; m < gf.nM; m++) {
    const x0 = gf.start + m * gf.mw;
    const gx = x0 + 0.28;
    const gw = gf.mw - 0.56;
    const isDoor = m === gf.ent;
    if (pass === 'day') {
      p.grad(gx, 0.4, gw, 3.85, [[0, '#8a5a30'], [0.5, '#e6b377'], [1, '#fbe0b0']]);
      // tables and diners as dark silhouettes, ceiling spots
      for (let k = 0; k < 3; k++) p.rect(gx + 0.25 + k * (gw / 3), 0.4, gw / 4, 1.0, 'rgba(70,35,20,0.45)');
      for (let k = 0; k < 4; k++) p.circle(gx + 0.3 + k * (gw / 3.4), 3.9, 0.07, '#fffbe8');
      p.line(gx + gw / 2, 0.4, gx + gw / 2, 4.25, isDoor ? 0.07 : 0.04, '#25282e');
      p.line(gx, 3.0, gx + gw, 3.0, 0.04, '#25282e');
      if (isDoor) {
        p.rect(gx, 0.4, 0.07, 3.85, '#1e2026');
        p.rect(gx + gw - 0.07, 0.4, 0.07, 3.85, '#1e2026');
        p.rect(gx + gw / 2 - 0.35, 1.2, 0.05, 0.8, '#c9ccd2');
        p.rect(gx + gw / 2 + 0.3, 1.2, 0.05, 0.8, '#c9ccd2');
        p.rect(gx, 0.4, gw, 0.05, '#1e2026');
      }
    } else {
      p.grad(gx, 0.4, gw, 3.85, [[0, 'rgba(255,150,60,0.8)'], [0.6, 'rgba(255,205,130,0.92)'], [1, 'rgba(255,235,180,0.95)']]);
      for (let k = 0; k < 4; k++) p.circle(gx + 0.3 + k * (gw / 3.4), 3.9, 0.12, '#fff7d8');
    }
  }
}

function drawSide(p, pass, Wm) {
  const N = Math.max(2, Math.round(Wm / 3));
  const bw = Wm / N;
  if (pass === 'day') {
    cladding(p, Wm, H);
    p.rect(-Wm / 2, 0, Wm, 0.4, '#241719');
  }
  FLOORS.forEach((yb, f) => {
    for (let i = 0; i < N; i++) {
      const x0 = -Wm / 2 + i * bw;
      glassPane(p, pass, x0 + 0.45, yb + 0.7, bw - 0.9, 2.6, 500 + f * 30 + i);
      if (pass === 'day') spandrel(p, x0, yb, bw, 0.6);
    }
  });
  if (pass === 'day') {
    for (let i = 0; i < N; i += 2) {
      const x0 = -Wm / 2 + i * bw;
      p.rect(x0 + 0.5, 0.4, bw - 1.0, 2.2, '#2c3037');
      p.rect(x0 + 0.58, 0.48, bw - 1.16, 2.04, '#4e6e86');
    }
  }
}

function mainSignDraw(kit, w, h) {
  return (g, pw, ph) => {
    const p = new Pen(g, pw / w, w, h);
    p.grad(-w / 2, 0, w, h, [[0, '#6a1424'], [1, '#8f2438']]);
    p.rrect(-w / 2 + 0.14, 0.14, w - 0.28, h - 0.28, 0.12, null, 'rgba(255,255,255,0.85)', 0.05);
    if (kit.drawLogo('paradise', p, -w / 2 + 0.5, 0.3, w - 1, h - 0.6)) return;
    const ex = -w / 2 + 2.05;
    const ey = h / 2;
    const gr = g.createRadialGradient(p.X(ex - 0.3), p.Y(ey + 0.4), 1, p.X(ex), p.Y(ey), p.S(1.2));
    gr.addColorStop(0, '#ffb03a');
    gr.addColorStop(1, '#e8590c');
    g.beginPath();
    g.arc(p.X(ex), p.Y(ey), p.S(1.12), 0, Math.PI * 2);
    g.fillStyle = gr;
    g.fill();
    p.circle(ex, ey, 0.96, null, 'rgba(255,244,225,0.9)', 0.05);
    p.text('P', ex + 0.02, ey - 0.04, 1.6, { color: '#fff', weight: 800 });
    const left = ex + 1.5;
    const right = w / 2 - 0.6;
    const cx = (left + right) / 2;
    p.text('Paradise', cx, h / 2 + 0.42, 1.95, { color: '#fff', weight: 800, spacing: 0.04, maxW: right - left });
    p.line(left + 0.4, 0.62, cx - 2.35, 0.62, 0.035, '#f08a24');
    p.line(cx + 2.35, 0.62, right - 0.4, 0.62, 0.035, '#f08a24');
    p.text('A LEGEND SINCE 1953', cx, 0.62, 0.4, { color: '#f6e6cf', weight: 700, spacing: 0.12 });
  };
}

function canopyDraw(w, h) {
  return (g, pw, ph) => {
    const p = new Pen(g, pw / w, w, h);
    p.grad(-w / 2, 0, w, h, [[0, '#6a1424'], [1, '#8a2236']]);
    p.rect(-w / 2, 0, w, 0.06, 'rgba(255,255,255,0.7)');
    const ex = -2.3;
    p.circle(ex, h / 2 + 0.02, 0.38, '#ee7a1a', 'rgba(255,244,225,0.9)', 0.025);
    p.text('P', ex + 0.01, h / 2, 0.52, { color: '#fff', weight: 800 });
    p.text('Restaurant', 0.4, h / 2 + 0.02, 0.7, { color: '#fff', weight: 700, spacing: 0.04, maxW: 6.2 });
  };
}

function takeawayDraw(w, h) {
  return (g, pw, ph) => {
    const p = new Pen(g, pw / w, w, h);
    p.grad(-w / 2, 0, w, h, [[0, '#6a1424'], [1, '#8a2236']]);
    p.rrect(-w / 2 + 0.05, 0.05, w - 0.1, h - 0.1, 0.06, null, 'rgba(255,255,255,0.8)', 0.03);
    p.text('TAKEAWAY', 0, h / 2 + 0.02, 0.34, { color: '#fff', weight: 800, spacing: 0.08, maxW: w - 0.4 });
    p.rect(-w / 2 + 0.3, 0.12, w - 0.6, 0.04, '#f08a24');
  };
}

/** Build Paradise Biryani into `parent`. Returns the group. */
export function buildParadise(kit, plan, parent) {
  const { W, D } = plan;
  const L = layout(W, D);
  const g = new Group();
  g.position.set(plan.cx, 0.2, plan.cz);
  g.rotation.y = plan.theta;
  parent.add(g);
  const bld = new Group();
  bld.position.y = PLINTH;
  g.add(bld);
  kit.loadLogo('paradise');

  const key = Math.round(W);
  // textures: front and side walls (day + night glow)
  const front = facadeTextures(kit, W, H, { ppm: 40, draw: (p, pass) => drawFront(p, pass, L, kit) });
  const side = facadeTextures(kit, D, H, { ppm: 40, draw: (p, pass) => drawSide(p, pass, D) });
  const frontMat = kit.texMat({ map: front.map, glow: front.glow, k: 0.72, rough: 0.6, metal: 0.05, offset: 1 });
  const sideMat = kit.texMat({ map: side.map, glow: side.glow, k: 0.8, rough: 0.6, metal: 0.05, offset: 1 });
  const E = 0.03;
  kit.plane(bld, frontMat, W, H, 0, 0, D / 2 + E, 0);
  kit.plane(bld, sideMat, D, H, W / 2 + E, 0, 0, Math.PI / 2);
  kit.plane(bld, sideMat, D, H, -W / 2 - E, 0, 0, -Math.PI / 2);
  kit.plane(bld, sideMat, W, H, 0, 0, -D / 2 - E, Math.PI).material = kit.texMat({ map: front.map, glow: front.glow, k: 0.5, rough: 0.7, offset: 1 });

  // signs
  const sw = Math.min(W * 0.74, 19.5);
  const sh = 3.2;
  const signTex = kit.tex(2048, Math.round((2048 * sh) / sw), mainSignDraw(kit, sw, sh));
  const signMat = kit.texMat({ map: signTex, glow: true, k: 0.9, base: 0.5, rough: 0.5 });
  const cw = Math.min(W - 2, 18);
  const ch = 1.1;
  const canTex = kit.tex(1024, Math.round((1024 * ch) / cw), canopyDraw(cw, ch));
  const canMat = kit.texMat({ map: canTex, glow: true, k: 0.9, base: 0.3, rough: 0.5 });
  const tkw = 2.7;
  const tkh = 0.72;
  const tkTex = kit.tex(512, Math.round((512 * tkh) / tkw), takeawayDraw(tkw, tkh));
  const tkMat = kit.texMat({ map: tkTex, glow: true, k: 0.9, base: 0.3, rough: 0.5 });

  const b = new Batch();
  b.push(0, PLINTH, 0);
  // body (hidden behind the textured planes but gives the volume, shadows and the roof line)
  b.box(W, H, D, 0, 0, 0, MAROON);
  // floor ledges, fins, ground columns
  FLOORS.forEach((yb, i) => (i === 1 ? b.box(W - L.bayW + 0.3, 0.28, 0.55, -L.bayW / 2, yb - 0.14, D / 2 + 0.1, MAROON_D) : b.box(W + 0.3, 0.28, 0.55, 0, yb - 0.14, D / 2 + 0.1, MAROON_D)));
  for (let f = 0; f < 2; f++) {
    for (let i = 0; i <= L.N; i++) {
      const x = -W / 2 + i * L.bayW;
      const y0 = f === 0 ? FLOORS[0] : FLOORS[1];
      b.box(0.5, 3.6, 0.42, x, y0, D / 2 + 0.1, MAROON_D);
    }
  }
  for (let i = 0; i <= L.N; i++) b.box(0.5, 3.6, 0.42, -W / 2 + i * L.bayW, FLOORS[2], D / 2 + 0.1, MAROON_D);
  const { gf } = L;
  for (let m = 0; m <= gf.nM; m++) b.box(0.5, FLOORS[0], 0.5, gf.start + m * gf.mw, 0, D / 2 + 0.1, MAROON_D);
  b.box(0.5, FLOORS[0], 0.5, -W / 2 + 0.3, 0, D / 2 + 0.1, MAROON_D);
  b.box(0.6, H, 0.6, -W / 2, 0, D / 2, MAROON_D);
  b.box(0.6, H, 0.6, W / 2, 0, D / 2, MAROON_D);
  // roof: coping, parapet cap, plant
  b.box(W + 0.5, 0.18, D + 0.5, 0, H, 0, '#8a8087');
  b.box(W - 0.8, 0.5, D - 0.8, 0, H + 0.18, 0, '#6e6a72');
  b.box(1.6, 1.0, 1.1, -W * 0.28, H + 0.68, -D * 0.2, '#b7b4bc', { mat: 'metal' });
  b.box(1.6, 1.0, 1.1, -W * 0.12, H + 0.68, -D * 0.2, '#b7b4bc', { mat: 'metal' });
  b.cyl(0.95, 0.95, 1.7, W * 0.28, H + 0.68, -D * 0.22, '#2b79b8', { seg: 14 });
  b.box(2.6, 2.0, 2.4, W * 0.05, H + 0.68, -D * 0.3, '#8b8790');
  // cantilevered main sign: a lit box with a steel beam under it
  const signY = 12.15;
  b.box(sw, sh, 1.3, 0, signY, D / 2 + 0.65, MAROON_D);
  b.box(sw + 0.3, 0.14, 1.5, 0, signY + sh, D / 2 + 0.75, '#2a0a11');
  b.box(sw - 0.3, 0.05, 1.0, 0, signY - 0.03, D / 2 + 0.7, '#ffd9a0', { mat: 'lamp' });
  for (const sx of [-0.4, -0.15, 0.15, 0.4]) b.box(0.3, 0.4, 1.2, sx * sw, signY - 0.4, D / 2 + 0.6, STEEL);
  // restaurant canopy
  const canY = 4.1;
  b.box(cw, ch, 1.8, 0, canY, D / 2 + 0.9, MAROON_D);
  b.box(cw + 0.2, 0.1, 1.9, 0, canY + ch, D / 2 + 0.95, '#2a0a11');
  b.box(cw - 0.4, 0.05, 1.4, 0, canY - 0.03, D / 2 + 0.95, '#ffe2b0', { mat: 'lamp' });
  for (const sx of [-0.4, 0.4]) b.box(0.2, 0.2, 1.7, sx * cw, canY + ch - 0.05, D / 2 + 0.9, STEEL);
  // takeaway tag at the corner and its counter hood
  b.box(tkw, tkh, 0.3, -W / 2 + 2.0, 3.55, D / 2 + 0.45, MAROON_D);
  b.box(3.2, 0.12, 0.9, -W / 2 + 2.0, 3.45, D / 2 + 0.5, '#2a0a11');
  b.box(3.0, 0.05, 0.6, -W / 2 + 2.0, 3.4, D / 2 + 0.5, '#ffe2b0', { mat: 'lamp' });
  b.pop();

  // plinth, steps, planters, queue (ground level, outside the building frame)
  b.box(W + 0.5, PLINTH, D + 0.5, 0, 0, 0, '#7d7378');
  const stepW = gf.mw + 1.2;
  b.box(stepW, 0.15, 0.55, gf.entX, 0, D / 2 + 0.5, '#9d948c');
  b.box(stepW + 0.5, 0.15, 0.35, gf.entX, 0, D / 2 + 0.8, '#938a83');
  for (const sx of [-1, 1]) {
    b.box(0.8, 0.55, 0.8, gf.entX + sx * (stepW / 2 + 0.7), 0, D / 2 + 0.8, '#2f2c33');
    b.sph(0.5, gf.entX + sx * (stepW / 2 + 0.7), 1.0, D / 2 + 0.8, '#2f8a4a', { w: 8, h: 6 });
  }
  const rng = (i) => hash01(plan.cx | 0, plan.cz | 0, i);
  const person = (x, z, yaw, i, y = 0) => addPerson(b, x, z, { y, yaw, shirt: SHIRTS[Math.floor(rng(i) * SHIRTS.length)], skin: SKINS[Math.floor(rng(i + 9) * SKINS.length)], pants: i % 2 ? '#2c3e50' : '#3b3b3b', h: 1.55 + rng(i + 3) * 0.3 });
  const tx = -W / 2 + 2.0;
  person(tx - 0.5, D / 2 + 1.5, Math.PI, 1);
  person(tx + 0.4, D / 2 + 2.3, Math.PI, 2);
  person(tx + 0.1, D / 2 + 3.2, Math.PI, 3);
  person(gf.entX - stepW / 2 - 0.2, D / 2 + 1.9, Math.PI * 0.9, 4);
  kit.flush(b, g);

  kit.plane(bld, signMat, sw - 0.06, sh - 0.06, 0, signY + 0.03, D / 2 + 1.3 + 0.02, 0);
  kit.plane(bld, canMat, cw - 0.06, ch - 0.06, 0, canY + 0.03, D / 2 + 1.8 + 0.02, 0);
  kit.plane(bld, tkMat, tkw - 0.04, tkh - 0.04, -W / 2 + 2.0, 3.55 + 0.02, D / 2 + 0.6 + 0.02, 0);
  kit.pool(g, '#ffb468', W * 0.9, 9, 0, D / 2 + 4.5, 0.5);
  return g;
}
