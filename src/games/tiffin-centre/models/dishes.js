// Dish models. Street style: steel plates and katoris, banana leaf, newspaper cones and sheets, small chai glasses.
// A dish is built ONCE per (id, quality) into cached merged geometry; buildDish() only wraps it in a Group, so spawning
// dozens of dishes costs nothing and `disposeObject(dish)` is a no-op for the geometry (it is shared).
import { BufferGeometry, Color, Group, Mesh } from 'three';
import { Parts, materials, sharedGeo, palette } from './util.js';

export const QUALITIES = ['perfect', 'good', 'ok', 'burnt'];

const STEEL = '#cdd4d9';
const STEEL_DARK = '#9aa3a9';
const LEAF = '#3f9a4a';
const PAPER = '#e6dcc0';
const INK = '#4b4640';
const SAMBAR = '#b4521b';
const COCONUT = '#f2eee0';
const CHAR = new Color('#14100d');
const DULL = new Color('#a8906d');

/** How a quality changes the food colours (non-food: plates, katoris: untouched). */
function foodTint(q) {
  if (q === 'burnt') return (c) => c.lerp(CHAR, 0.88);
  if (q === 'ok') return (c) => c.lerp(DULL, 0.3);
  if (q === 'perfect') return (c) => c.multiplyScalar(1.06);
  return null;
}

// --- reusable bits (all centred on their own x,z; y = bottom) -------------------------------------------------------
function plate(P, r = 0.16, o = {}) {
  const [x, y, z] = o.p || [0, 0, 0];
  P.lathe(
    [[0, 0], [r * 0.6, 0], [r * 0.86, 0.016], [r, 0.036], [r * 0.975, 0.039], [r * 0.9, 0.022], [0, 0.012]],
    14,
    o.color || STEEL,
    { p: [x, y, z] },
  );
  P.torus(r * 0.985, 0.0045, STEEL_DARK, { p: [x, y + 0.038, z], r: [Math.PI / 2, 0, 0] }, 3, 14);
  return y + 0.012;
}
function katori(P, x, z, fill, o = {}) {
  const r = o.r || 0.045;
  const y = o.y || 0.03;
  P.lathe([[0, 0], [r * 0.55, 0], [r, 0.045], [r * 1.03, 0.052], [r * 0.96, 0.052], [r * 0.9, 0.04], [0, 0.012]], 9, STEEL, { p: [x, y, z] });
  P.cyl(r * 0.92, r * 0.95, 0.006, 9, fill, { p: [x, y + 0.038, z], food: true });
  if (o.garnish) P.sph(0.009, o.garnish, { p: [x + r * 0.2, y + 0.044, z - r * 0.1], s: [1, 0.5, 1] }, 5, 3);
  return y + 0.052;
}
function leaf(P, r = 0.19) {
  P.cyl(r, r, 0.006, 11, LEAF, { p: [0, 0.003, 0] });
  P.box(r * 1.9, 0.003, 0.008, '#2f7d3b', { p: [0, 0.0075, 0.0] });
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) P.box(r * 0.5, 0.003, 0.005, '#2f7d3b', { p: [s * r * 0.34, 0.0075, (i - 1) * 0.07], r: [0, s * 0.5, 0] });
}
function newspaperSheet(P, w = 0.34) {
  P.box(w, 0.006, w, PAPER, { p: [0, 0.003, 0], r: [0, 0.2, 0] });
  for (let i = 0; i < 6; i++) P.box(w * 0.7, 0.002, 0.012, INK, { p: [0.0, 0.0075, -w * 0.36 + i * 0.062], r: [0, 0.2, 0] });
}

// Dosa cone helper: tip at -x, mouth at +x, lying on y = yBase.
function dosaCone(P, { len, r, color, rings, ring, yBase, z = 0, yaw = 0, tilt = 0 }) {
  const yc = yBase + r * 0.98;
  P.cone(r, len, 10, color, { p: [0, yc, z], r: [0, yaw, Math.PI / 2 + tilt], s: 1, food: true }, true);
  // crisp bands
  for (const f of rings) {
    const x = -len / 2 + len * f;
    const rr = r * f;
    P.torus(rr, 0.005, ring, { p: [x * Math.cos(yaw), yc, z - x * Math.sin(yaw)], r: [0, Math.PI / 2 + yaw, 0], food: true }, 3, 10);
  }
  // open mouth: dark inside
  const mx = len / 2;
  P.disc(r * 0.9, '#7a4414', { p: [mx * Math.cos(yaw) - 0.002, yc, z - mx * Math.sin(yaw)], r: [0, Math.PI / 2 + yaw, 0], food: true }, 10);
  return { yc, mx, yaw, z };
}

// --- dishes ---------------------------------------------------------------------------------------------------------
const BUILD = {
  dosa(P) {
    const y = plate(P, 0.18);
    dosaCone(P, { len: 0.3, r: 0.058, color: '#e8a53d', rings: [0.3, 0.55, 0.8], ring: '#b46f1c', yBase: y, z: 0.03, yaw: 0.12 });
    katori(P, -0.07, -0.11, SAMBAR, { garnish: '#6aa84f' });
    katori(P, 0.07, -0.11, COCONUT, { garnish: '#4f9a3f' });
  },
  masala_dosa(P) {
    const y = plate(P, 0.19);
    const c = dosaCone(P, { len: 0.33, r: 0.085, color: '#d98c2f', rings: [0.25, 0.5, 0.75], ring: '#a35f17', yBase: y, z: 0.03, yaw: 0.1 });
    // potato masala peeking out of the mouth
    const mx = c.mx;
    for (const [dx, dy, dz, rad] of [[0.012, 0, 0, 0.05], [0.04, -0.01, 0.025, 0.036], [0.035, 0.012, -0.03, 0.034]])
      P.sph(rad, '#f2c52e', { p: [mx + dx, c.yc + dy, c.z + dz], s: [1, 0.8, 1], food: true }, 7, 5);
    for (const [dx, dz] of [[0.02, 0.02], [0.05, -0.02], [0.03, 0.045]]) P.sph(0.01, '#2f9e3b', { p: [mx + dx, c.yc + 0.04, c.z + dz] }, 4, 3);
    katori(P, -0.08, -0.12, SAMBAR, { garnish: '#6aa84f' });
    katori(P, 0.07, -0.12, COCONUT, { garnish: '#4f9a3f' });
  },
  podi_dosa(P) {
    const y = plate(P, 0.18);
    const c = dosaCone(P, { len: 0.3, r: 0.058, color: '#dc9335', rings: [0.3, 0.55, 0.8], ring: '#a8601a', yBase: y, z: 0.03, yaw: 0.12 });
    // red podi dusting + a streak of ghee
    const spots = [[-0.09, 0.0], [-0.04, 0.012], [0.0, -0.008], [0.03, 0.01], [0.06, -0.012], [0.09, 0.005], [-0.02, -0.015], [0.1, -0.02]];
    for (const [x, dz] of spots) {
      const rad = 0.058 * ((x + 0.15) / 0.3);
      P.sph(0.016, '#7a2412', { p: [x, c.yc + rad * 0.97 + 0.002, c.z + dz], s: [1.4, 0.35, 1.2] }, 5, 3);
    }
    P.sph(0.02, '#ffe27a', { p: [0.0, c.yc + 0.058 * 0.55 + 0.012, c.z + 0.012], s: [2, 0.4, 1] }, 5, 3);
    katori(P, -0.07, -0.11, '#8d2a14', { garnish: '#ffe27a' }); // idly podi + ghee
    katori(P, 0.07, -0.11, COCONUT, { garnish: '#4f9a3f' });
  },
  set_dosa(P) {
    const y = plate(P, 0.18);
    for (let i = 0; i < 3; i++) {
      const yy = y + 0.014 + i * 0.027;
      P.cyl(0.1 - i * 0.004, 0.105 - i * 0.004, 0.026, 12, '#f6e8bd', { p: [i * 0.006, yy, 0.02 - i * 0.004], food: true });
      P.cyl(0.098 - i * 0.004, 0.098 - i * 0.004, 0.003, 12, '#e2b865', { p: [i * 0.006, yy + 0.0135, 0.02 - i * 0.004], food: true });
    }
    for (const [x, z] of [[-0.04, 0.0], [0.03, 0.04], [0.0, 0.08], [0.05, -0.02], [-0.03, 0.06]]) P.sph(0.01, '#cf9a4a', { p: [x, y + 0.083, z], s: [1, 0.4, 1] }, 4, 3);
    katori(P, -0.07, -0.12, '#e0a82a', { garnish: '#6aa84f' }); // veg sagu
    katori(P, 0.07, -0.12, COCONUT, { garnish: '#4f9a3f' });
  },
  pesarattu(P) {
    const y = plate(P, 0.18);
    P.cyl(0.15, 0.152, 0.014, 14, '#6fa63b', { p: [0, y + 0.008, 0.01], food: true });
    P.torus(0.15, 0.007, '#c58a2c', { p: [0, y + 0.012, 0.01], r: [Math.PI / 2, 0, 0], food: true }, 3, 14);
    for (const [x, z] of [[-0.08, 0.04], [0.06, 0.07], [0.09, -0.04], [-0.05, -0.05], [0.0, 0.09], [-0.1, 0.0]]) P.sph(0.014, '#4d8a2a', { p: [x, y + 0.016, z], s: [1.4, 0.3, 1.2] }, 5, 3);
    for (const [x, z] of [[-0.03, 0.02], [0.04, 0.0], [0.0, 0.06], [0.07, 0.04]]) P.box(0.014, 0.006, 0.014, '#f2e4b8', { p: [x, y + 0.018, z], r: [0, x * 9, 0], food: true });
    // upma dome + ginger chutney
    P.dome(0.055, '#f0d57f', { p: [0.0, y + 0.014, 0.0], s: [1, 0.7, 1], food: true }, 8, 4);
    katori(P, -0.07, -0.12, '#e8d18a', { garnish: '#6aa84f' });
    katori(P, 0.07, -0.12, COCONUT, { garnish: '#4f9a3f' });
  },
  idly(P) {
    leaf(P, 0.2);
    const y = plate(P, 0.15, { p: [0, 0.006, 0.01] });
    for (const x of [-0.068, 0.068])
      P.lathe([[0, 0], [0.06, 0], [0.068, 0.018], [0.058, 0.044], [0.032, 0.058], [0, 0.061]], 10, '#fbf6e6', { p: [x, y, 0.045], food: true });
    for (const x of [-0.068, 0.068]) P.sph(0.012, '#e3d8bd', { p: [x, y + 0.06, 0.045], s: [1, 0.4, 1] }, 4, 3);
    katori(P, -0.07, -0.085, SAMBAR, { y: y - 0.012, garnish: '#6aa84f', r: 0.04 });
    katori(P, 0.07, -0.085, COCONUT, { y: y - 0.012, garnish: '#4f9a3f', r: 0.04 });
  },
  poori(P) {
    const y = plate(P, 0.18);
    P.sph(0.095, '#eaa73f', { p: [-0.05, y + 0.045, 0.045], s: [1, 0.5, 1], r: [0.1, 0, 0.12], food: true }, 10, 6);
    P.sph(0.092, '#e39a30', { p: [0.06, y + 0.07, 0.03], s: [1, 0.55, 1], r: [0.0, 0, -0.25], food: true }, 10, 6);
    for (const [x, z] of [[-0.06, 0.05], [0.05, 0.04], [0.0, 0.02]]) P.sph(0.012, '#b87218', { p: [x, y + 0.08, z], s: [1.4, 0.3, 1.4] }, 4, 3);
    // aloo curry
    const k = katori(P, 0.0, -0.1, '#e8a92e', { r: 0.062, garnish: '#2f9e3b' });
    for (const [x, z, rr] of [[-0.02, -0.1, 0.017], [0.02, -0.11, 0.016], [0.0, -0.085, 0.015]]) P.sph(rr, '#f2c24a', { p: [x, k - 0.01, z], s: [1, 0.7, 1], food: true }, 5, 4);
    P.sph(0.01, '#d0392b', { p: [0.025, k - 0.008, -0.095] }, 4, 3);
  },
  vada(P) {
    const y = plate(P, 0.18);
    for (const [x, z, ry] of [[-0.075, 0.035, 0.1], [0.075, 0.035, -0.1], [0.0, -0.05, 0.3]]) {
      P.torus(0.055, 0.03, '#c98a3a', { p: [x, y + 0.03, z], r: [Math.PI / 2, 0, ry], food: true }, 5, 9);
      P.torus(0.057, 0.012, '#a56a22', { p: [x, y + 0.052, z], r: [Math.PI / 2, 0, ry], s: [1, 1, 0.8], food: true }, 3, 9);
    }
    katori(P, -0.095, -0.1, SAMBAR, { r: 0.04, garnish: '#6aa84f' });
    katori(P, 0.095, -0.1, COCONUT, { r: 0.04, garnish: '#4f9a3f' });
  },
  mysore_bonda(P) {
    newspaperSheet(P, 0.34);
    const pts = [[-0.065, 0.045, 0.05], [0.065, 0.045, 0.05], [0.0, 0.045, -0.045], [-0.03, 0.093, 0.0], [0.03, 0.093, 0.01]];
    for (const [x, y, z] of pts) {
      P.sph(0.05, '#c47624', { p: [x, y + 0.008, z], food: true }, 8, 6);
      P.sph(0.014, '#8f4c14', { p: [x * 1.05, y + 0.05, z], s: [1, 0.4, 1], food: true }, 4, 3);
    }
    katori(P, 0.11, -0.12, COCONUT, { y: 0.006, garnish: '#4f9a3f' });
    P.box(0.04, 0.008, 0.012, '#2f9e3b', { p: [-0.12, 0.012, 0.1], r: [0, 0.6, 0] });
  },
  mirchi_bajji(P) {
    // newspaper cone leaning on a sheet, bajjis sticking out, onion rings and a lime wedge
    newspaperSheet(P, 0.34);
    P.cone(0.085, 0.17, 10, PAPER, { p: [0, 0.105, -0.05], r: [-2.1, 0, 0] }, true);
    P.cone(0.08, 0.002, 10, '#cfc4a6', { p: [0, 0.14, 0.02], r: [-2.1, 0, 0] }, true);
    for (let i = 0; i < 4; i++) P.box(0.1, 0.003, 0.01, INK, { p: [0, 0.06 + i * 0.012, 0.0 + i * 0.012], r: [-0.5, 0, 0.0] });
    // two bajjis poking out of the cone mouth (axis (0, .83, .56)) and one lying on the sheet
    const ax = [0, 0.5, 0.86];
    const tipped = (cx, cy, cz, rot, half) => {
      P.capsule(0.03, half * 2 - 0.06, '#dcaa4a', { p: [cx, cy, cz], r: rot, food: true }, 3, 6);
      P.sph(0.009, '#a8691d', { p: [cx, cy + 0.03, cz + 0.02], s: [1.4, 0.4, 1] }, 4, 3);
    };
    for (const dx of [-0.03, 0.03]) {
      const cx = dx, cy = 0.17, cz = 0.06;
      tipped(cx, cy, cz, [1.05, 0, -dx * 5], 0.085);
      P.cone(0.014, 0.035, 5, '#2f8a3a', { p: [cx, cy + ax[1] * 0.1, cz + ax[2] * 0.1], r: [1.05, 0, -dx * 5] });
    }
    P.capsule(0.03, 0.1, '#dcaa4a', { p: [0.0, 0.034, 0.1], r: [0, 0.3, Math.PI / 2], food: true }, 3, 6);
    P.cone(0.014, 0.035, 5, '#2f8a3a', { p: [-0.092, 0.034, 0.1 + 0.03], r: [0, 0.3, Math.PI / 2 + 0.0] });
    for (const [x, z] of [[0.095, 0.075], [0.125, 0.06], [0.1, 0.1]]) P.torus(0.026, 0.006, '#c0507a', { p: [x, 0.012, z], r: [Math.PI / 2, 0, 0] }, 3, 8);
    P.box(0.05, 0.02, 0.025, '#9ccc3c', { p: [-0.11, 0.016, 0.1], r: [0, 0.5, 0.2] });
    P.sph(0.02, '#d0392b', { p: [0.12, 0.02, -0.08], s: [1.7, 0.7, 1] }, 5, 3);
  },
  irani_chai(P) {
    // small glass of milky Irani chai on a saucer, spoon in the saucer
    P.lathe([[0, 0], [0.07, 0], [0.12, 0.012], [0.14, 0.024], [0.13, 0.026], [0.07, 0.014], [0, 0.012]], 14, '#f4efe2', { p: [0, 0, 0] });
    P.torus(0.136, 0.004, '#2c6fb4', { p: [0, 0.025, 0], r: [Math.PI / 2, 0, 0] }, 3, 14);
    P.cyl(0.064, 0.05, 0.1, 10, '#c98e56', { p: [0, 0.07, 0], food: true });
    P.cyl(0.062, 0.062, 0.006, 10, '#ecc89c', { p: [0, 0.122, 0], food: true });
    P.cyl(0.002, 0.002, 0.14, 4, STEEL, { p: [0.05, 0.1, 0.05], r: [0.2, 0, -0.25] });
    P.cyl(0.07, 0.054, 0.108, 10, '#cfeeee', { p: [0, 0.07, 0], layer: 'glass' }, true);
    P.torus(0.032, 0.007, '#cfeeee', { p: [0.075, 0.075, 0], r: [0, 0, 0], s: [0.8, 1, 1], layer: 'glass' }, 4, 8, Math.PI * 1.2);
  },
  filter_coffee(P) {
    // steel tumbler in a davara (wide steel dish), dark foamy coffee
    P.lathe([[0, 0], [0.07, 0], [0.12, 0.018], [0.14, 0.04], [0.133, 0.042], [0.11, 0.025], [0, 0.015]], 14, STEEL, { p: [0, 0, 0] });
    P.torus(0.138, 0.005, STEEL_DARK, { p: [0, 0.041, 0], r: [Math.PI / 2, 0, 0] }, 3, 14);
    P.lathe([[0, 0], [0.045, 0], [0.055, 0.06], [0.066, 0.122], [0.062, 0.124], [0.05, 0.1], [0, 0.01]], 10, '#dfe5e8', { p: [0, 0.018, 0] });
    P.torus(0.066, 0.005, STEEL_DARK, { p: [0, 0.14, 0], r: [Math.PI / 2, 0, 0] }, 3, 10);
    P.cyl(0.06, 0.06, 0.006, 10, '#6b3a1e', { p: [0, 0.13, 0], food: true });
    P.cyl(0.04, 0.04, 0.006, 8, '#a56a3c', { p: [0, 0.134, 0], food: true });
  },
  osmania(P) {
    P.lathe([[0, 0], [0.06, 0], [0.11, 0.012], [0.135, 0.024], [0.126, 0.026], [0.06, 0.014], [0, 0.012]], 14, '#f4efe2', { p: [0, 0, 0] });
    P.torus(0.13, 0.004, '#2c6fb4', { p: [0, 0.025, 0], r: [Math.PI / 2, 0, 0] }, 3, 14);
    // two pale biscuits, one leaning on the other
    P.cyl(0.062, 0.062, 0.018, 12, '#f1dca3', { p: [-0.02, 0.034, 0.03], r: [0, 0, 0], food: true });
    P.torus(0.062, 0.006, '#d6b062', { p: [-0.02, 0.043, 0.03], r: [Math.PI / 2, 0, 0], food: true }, 3, 12);
    P.cyl(0.06, 0.06, 0.018, 12, '#f4e1ab', { p: [0.03, 0.074, -0.02], r: [0.2, 0, -0.9], food: true });
    P.torus(0.06, 0.006, '#d6b062', { p: [0.03, 0.074, -0.02], r: [0.2 + Math.PI / 2, 0, -0.9], food: true }, 3, 12);
    for (const [x, z] of [[-0.03, 0.02], [-0.01, 0.045], [-0.04, 0.045]]) P.sph(0.006, '#cc9a4c', { p: [x, 0.045, z], s: [1, 0.5, 1] }, 3, 3);
  },
};

const FALLBACK = (P) => {
  plate(P, 0.16);
  P.sph(0.07, '#b9a27a', { p: [0, 0.07, 0] }, 7, 5);
};

function steamPuffs(P, topY, x = 0, z = 0) {
  P.sph(0.022, '#ffffff', { p: [x, topY + 0.02, z], layer: 'fx' }, 5, 4);
  P.sph(0.026, '#ffffff', { p: [x + 0.01, topY + 0.052, z], layer: 'fx' }, 5, 4);
  P.sph(0.02, '#ffffff', { p: [x - 0.004, topY + 0.082, z], layer: 'fx' }, 5, 4);
}

function dishGeos(id, q) {
  const k = `dish:${id}:${q}`;
  let pack = null;
  const build = () => {
    if (pack) return pack;
    const P = new Parts();
    P.food = foodTint(q);
    (BUILD[id] || FALLBACK)(P);
    const solid = P.build('solid');
    if (q === 'perfect' && solid) steamPuffs(P, solid.boundingBox.max.y);
    pack = { solid, glass: P.build('glass'), fx: P.build('fx') };
    return pack;
  };
  const empty = () => new BufferGeometry();
  return {
    solid: sharedGeo(`${k}:s`, () => build().solid || empty()),
    glass: sharedGeo(`${k}:g`, () => build().glass || empty()),
    fx: sharedGeo(`${k}:f`, () => build().fx || empty()),
  };
}

/** buildDish(dishId, q='good') -> Group (~0.35 m wide, origin at the base, steel plate / leaf / newspaper / glass). */
export function buildDish(dishId, q = 'good') {
  const quality = QUALITIES.includes(q) ? q : 'good';
  const { solid, glass, fx } = dishGeos(dishId, quality);
  const group = new Group();
  group.name = `dish-${dishId}`;
  group.userData.dish = dishId;
  group.userData.q = quality;
  const sMat =
    quality === 'perfect'
      ? materials.vertex({ emissive: '#ff9a2e', ei: 0.2 })
      : quality === 'burnt'
        ? materials.vertex({ rough: 1 })
        : materials.vertex();
  group.add(new Mesh(solid, sMat));
  if (glass.attributes.position) group.add(new Mesh(glass, materials.glass()));
  if (fx.attributes.position) group.add(new Mesh(fx, materials.steam()));
  return group;
}

export const DISH_PALETTE = palette;
