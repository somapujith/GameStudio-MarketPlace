// Panipuri / chaat stalls on the pavements: a steel cart with a glass display box of golgappas, a vendor, a customer or two,
// hanging bulbs and a bright board. Every stall is merged into one static mesh per material (cheap to render).
import { Batch, FONT, FONT_TE, Pen, addPerson, hash01, SHIRTS, SKINS } from './shop-kit.js';

const BOARD_W = 1.6;
const BOARD_H = 0.5;
const BOARDS = [
  { a: 'PANI PURI', b: 'పానీ పూరీ • GOLGAPPA', bg: '#1f6b3a', fg: '#fff3b0', bd: '#ffd23a' },
  { a: 'CHAAT', b: 'BHEL • SEV PURI • PAPDI', bg: '#a3201a', fg: '#fff', bd: '#ffd23a' },
  { a: 'GOLGAPPA', b: 'పానీ పూరీ బండి • 10 RS', bg: '#1c4f8a', fg: '#ffe38a', bd: '#ffffff' },
];

function boardAtlasDraw(g, w, h) {
  const rowH = h / BOARDS.length;
  BOARDS.forEach((bd, i) => {
    const p = new Pen(g, w / BOARD_W, BOARD_W, rowH / (w / BOARD_W));
    g.save();
    g.translate(0, i * rowH);
    p.rect(-BOARD_W / 2, 0, BOARD_W, BOARD_H, bd.bg);
    p.rrect(-BOARD_W / 2 + 0.03, 0.03, BOARD_W - 0.06, BOARD_H - 0.06, 0.04, null, bd.bd, 0.022);
    p.text(bd.a, 0, BOARD_H * 0.64, BOARD_H * 0.52, { color: bd.fg, weight: 800, spacing: 0.02, maxW: BOARD_W - 0.2 });
    p.text(bd.b, 0, BOARD_H * 0.2, BOARD_H * 0.17, { color: bd.bd, weight: 700, font: bd.b.match(/[ఀ-౿]/) ? `${FONT_TE}, ${FONT}` : FONT, maxW: BOARD_W - 0.2 });
    g.restore();
  });
}

/** Add one stall into the batch, in a frame at (x, y, z) rotated so local +z faces the customers. */
function addStall(b, st, i) {
  const rng = (k) => hash01(i, k, 11);
  b.push(st.x, 0, st.z, st.theta);
  const steel = '#bcc2cb';
  // cart: axle with wheels, body, counter top, prop leg
  for (const sz of [-0.5, 0.5]) b.cyl(0.3, 0.3, 0.07, -0.45, 0.265, sz, '#2a2a2f', { seg: 10, rx: Math.PI / 2 });
  b.cyl(0.03, 0.03, 1.0, -0.45, -0.2, 0, '#55555c', { seg: 5, rx: Math.PI / 2 });
  b.cyl(0.03, 0.03, 0.42, 0.62, 0, 0.0, '#55555c', { seg: 5 });
  b.box(1.5, 0.58, 0.9, 0, 0.32, 0, steel, { mat: 'metal' });
  b.box(1.62, 0.05, 1.02, 0, 0.9, 0, '#dde1e6', { mat: 'metal' });
  b.box(0.5, 0.3, 0.02, 0.45, 0.45, 0.46, '#8b8f98');
  // glass display box with golgappas
  for (const sx of [-0.62, 0.62]) for (const sz of [-0.3, 0.3]) b.box(0.035, 0.7, 0.035, sx, 0.95, sz, steel, { mat: 'metal' });
  b.box(1.32, 0.03, 0.68, 0, 1.64, 0, steel, { mat: 'metal' });
  b.box(1.28, 0.62, 0.64, 0, 0.98, 0, '#cfe6ee', { mat: 'glass' });
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 8; k++) b.sph(0.075, -0.5 + k * 0.14, 1.04 + r * 0.13, -0.12 + r * 0.14, k % 3 ? '#e2a53a' : '#d3922a', { w: 6, h: 4 });
  }
  b.cyl(0.12, 0.1, 0.1, 0.45, 0.95, 0.2, '#7fb069', { seg: 8 });
  b.cyl(0.12, 0.1, 0.1, 0.2, 0.95, 0.2, '#7a4a2b', { seg: 8 });
  b.cyl(0.12, 0.1, 0.1, -0.05, 0.95, 0.2, '#e9d08a', { seg: 8 });
  // frame for the board and the bulbs
  for (const sx of [-0.82, 0.82]) b.box(0.04, 2.45, 0.04, sx, 0, -0.38, '#4a4a52', { mat: 'metal' });
  b.box(1.68, 0.04, 0.04, 0, 2.43, -0.38, '#4a4a52', { mat: 'metal' });
  b.quad(BOARD_W, BOARD_H, 0, 1.78, -0.35, '#fff', { mat: 'board', uv: [0, 1 - (st.board + 1) / BOARDS.length, 1, 1 - st.board / BOARDS.length] });
  b.quad(BOARD_W, BOARD_H, 0, 1.78, -0.41, '#fff', { mat: 'board', ry: Math.PI, uv: [0, 1 - (st.board + 1) / BOARDS.length, 1, 1 - st.board / BOARDS.length] });
  for (let k = 0; k < 6; k++) {
    const x = -0.75 + k * 0.3;
    b.sph(0.045, x, 2.34 - (k % 2) * 0.06, -0.38, '#fff0c0', { w: 5, h: 4, mat: 'lamp' });
  }
  // umbrella on a centre pole: a bright shape you can spot from the road
  const ucol = ['#d92b2b', '#f2b51d', '#2b8a4a', '#c43d8a'][i % 4];
  b.cyl(0.025, 0.025, 0.7, 0, 2.43, -0.38, '#4a4a52', { seg: 5, mat: 'metal' });
  b.cone(1.15, 0.38, 0, 2.95, -0.38, ucol, { seg: 8 });
  b.sph(0.05, 0, 3.36, -0.38, '#f4e9c8', { w: 5, h: 4 });
  // people: the vendor behind the cart, customers on the pavement side
  const person = (x, z, yaw, k, o = {}) => addPerson(b, x, z, { yaw, shirt: SHIRTS[Math.floor(rng(k) * SHIRTS.length)], skin: SKINS[Math.floor(rng(k + 5) * SKINS.length)], pants: k % 2 ? '#2c3e50' : '#3d3a35', h: 1.5 + rng(k + 2) * 0.3, ...o });
  person(0.1, -0.75, 0, 1, { shirt: i % 2 ? '#f4f0e4' : '#d9b84a', pants: '#e3dccb' });
  person(-0.45, 1.05, Math.PI + 0.2, 2);
  if (rng(9) < 0.65) person(-1.15, 1.0, Math.PI - 0.3, 3);
  if (rng(10) < 0.35) person(0.75, 1.6, Math.PI + 0.7, 4, { h: 1.2 });
  b.pop();
}

export function buildStalls(kit, stalls, parent) {
  const atlas = kit.tex(1024, 960, boardAtlasDraw);
  const boardMat = kit.texMat({ map: atlas, glow: true, k: 0.95, base: 0.3, rough: 0.55 });
  const mats = { ...kit.mats, board: boardMat };
  const b = new Batch();
  b.push(0, 0.2, 0, 0);
  stalls.forEach((st, i) => addStall(b, st, i));
  b.pop();
  const meshes = b.flush(parent, mats, kit.track);
  for (const m of meshes) m.frustumCulled = false;
  return meshes;
}
