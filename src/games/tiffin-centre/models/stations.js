// Station props: tawa, idly steamer, kadai, chai counter. Street style: steel counter, brick stove with a sooty arch, LPG cylinder,
// dented steel drums, batter bucket, soot-dark iron, tin/enamel label plate with hand-painted Telugu.
//
// Contract (plan section 5): buildStationProp(kindId) -> { group, slotAnchors, setSlot(i, {st, dish, progress}), update(dt, t), dispose() }
// plus slotWorld(i, out). Anchors are group-local, group origin = floor centre of the ~1.3 m wide station, +z faces the street.
import {
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  CapsuleGeometry,
  TorusGeometry,
  Vector3,
  Color,
  DoubleSide,
  AdditiveBlending,
} from 'three';
import { STATION_KINDS } from '../../../../shared/tiffin-centre/catalog.js';
import { Parts, clamp01, disposeObject, materials, num, sharedGeo, unit } from './util.js';
import { LABEL_STYLES, labelTexture } from './textures.js';
import { Puffs } from './fx.js';

export const COUNTER_TOP = 0.82;
export const STATION_WIDTH = 1.3;

const STEEL = '#c3ccd1';
const STEEL_BODY = '#8fa3ad';
const IRON = '#1d1a19';
const SOOT = '#2e2723';
const BRICK = '#a9482c';
const BRICK_DARK = '#8a3a22';
const MORTAR = '#cdbba0';

// --- shared static pieces -------------------------------------------------------------------------------------------
function counter(P, accent) {
  P.box(1.22, 0.06, 0.82, '#2a2421', { p: [0, 0.03, 0] }); // plinth
  P.box(1.3, 0.72, 0.9, STEEL_BODY, { p: [0, 0.42, 0] });
  P.box(1.32, 0.045, 0.92, STEEL, { p: [0, COUNTER_TOP - 0.0225, 0] }); // top sheet
  P.box(1.32, 0.05, 0.02, accent, { p: [0, 0.73, 0.455] }); // painted stripe
  for (const x of [-0.43, 0.43]) P.box(0.012, 0.6, 0.012, '#6f838d', { p: [x, 0.4, 0.452] }); // seams
  for (const [x, y] of [[-0.5, 0.5], [0.5, 0.3], [0.1, 0.2]]) P.sph(0.05, '#7d909a', { p: [x, y, 0.45], s: [1, 0.8, 0.12] }, 5, 3); // dents
  P.box(0.3, 0.03, 0.06, '#6f838d', { p: [0.4, 0.36, 0.47] }); // handle
}

function bricks(P, w, h, d, y0) {
  P.box(w, h, d, BRICK, { p: [0, y0 + h / 2, 0] });
  const rows = Math.max(2, Math.round(h / 0.06));
  for (let r = 1; r < rows; r++) {
    const y = y0 + (r * h) / rows;
    P.box(w + 0.006, 0.006, 0.006, MORTAR, { p: [0, y, d / 2] });
    P.box(0.006, 0.006, d + 0.006, MORTAR, { p: [w / 2, y, 0] });
    P.box(0.006, 0.006, d + 0.006, MORTAR, { p: [-w / 2, y, 0] });
    const off = r % 2 ? 0.08 : 0;
    for (let k = -3; k <= 3; k++) {
      const x = k * 0.14 + off;
      if (Math.abs(x) < w / 2 - 0.02) P.box(0.006, h / rows, 0.006, MORTAR, { p: [x, y - h / rows / 2, d / 2] });
    }
  }
  // a few darker bricks and soot at the top
  for (const [x, y] of [[-0.3, 0.3], [0.25, 0.65], [0.4, 0.2]]) P.box(0.12, h / rows - 0.008, 0.004, BRICK_DARK, { p: [x * w, y0 + y * h, d / 2 + 0.004] });
  P.box(w + 0.004, 0.02, d + 0.004, SOOT, { p: [0, y0 + h - 0.01, 0] });
  // sooty arch opening in the front, where the flame shows
  const aw = Math.min(0.56, w * 0.58);
  P.box(aw, h * 0.55, 0.02, '#120d0b', { p: [0, y0 + h * 0.34, d / 2 + 0.006] });
  P.torus(aw / 2, 0.008, SOOT, { p: [0, y0 + h * 0.34 + h * 0.275, d / 2 + 0.01], r: [0, 0, 0], s: [1, 0.4, 1] }, 3, 8, Math.PI);
  return y0 + h;
}

function lpg(P, x, z) {
  P.lathe([[0, 0], [0.14, 0], [0.155, 0.04], [0.155, 0.32], [0.12, 0.42], [0.06, 0.46], [0, 0.465]], 10, '#c7372a', { p: [x, 0, z] });
  P.torus(0.15, 0.01, '#8d2018', { p: [x, 0.04, z], r: [Math.PI / 2, 0, 0] }, 3, 10);
  P.cyl(0.05, 0.06, 0.04, 8, '#2b2b2b', { p: [x, 0.48, z] });
  P.box(0.03, 0.03, 0.09, '#d8b24a', { p: [x, 0.52, z + 0.03] });
  P.cyl(0.006, 0.006, 0.5, 4, '#3b3b3b', { p: [x + 0.08, 0.7, z + 0.12], r: [0.5, 0.3, 0] }); // rubber pipe
}

function flameCones(P, n, spread, y, z) {
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : -spread + (2 * spread * i) / (n - 1);
    P.cone(0.034, 0.1 + (i % 2) * 0.03, 5, '#ff8a1f', { p: [x, y + 0.05, z], layer: 'fx' }, true);
    P.cone(0.018, 0.06, 5, '#ffe27a', { p: [x, y + 0.03, z + 0.01], layer: 'fx' }, true);
  }
}

// --- animation helpers (no allocation per frame) --------------------------------------------------------------------
const _c1 = new Color();

class Marker {
  /** A flat glowing ring on the surface under a slot. */
  constructor(parent, x, y, z, r = 0.2) {
    this.mat = new MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: DoubleSide });
    this.mesh = new Mesh(unit.ring(r, r + 0.055, 24), this.mat);
    this.mesh.position.set(x, y, z);
    this.mesh.visible = false;
    parent.add(this.mesh);
  }
  update(t, st) {
    const on = st === 'ready';
    this.mesh.visible = on;
    if (on) this.mat.opacity = 0.55 + 0.35 * Math.sin(t * 5.5);
  }
}

const norm = (info) => {
  const st = info && (info.st === 'cooking' || info.st === 'ready' || info.st === 'burnt') ? info.st : 'empty';
  return { st, dish: info && typeof info.dish === 'string' ? info.dish : null, progress: clamp01(num(info && info.progress, 0)) };
};

// --- per-kind builders ----------------------------------------------------------------------------------------------
// Each returns { anchors:[Vector3], slots:[{ set(info), anim(t, dt) }], tick(t, dt) }.
// `ctx` = { root, P (Parts for static), owned: [] list of things to dispose, flames: Mesh|null }.

const TAWA_COLORS = {
  dosa: ['#f2e8cb', '#e6a840'],
  masala_dosa: ['#f2e8cb', '#db9534'],
  podi_dosa: ['#f2e8cb', '#d98b33'],
  set_dosa: ['#f6eed6', '#efd8a0'],
  pesarattu: ['#b4d576', '#6aa13a'],
};
const BURNT = new Color('#16110e');

function tawaStation(root, P) {
  const top = bricks(P, 0.98, 0.26, 0.7, COUNTER_TOP);
  // the tawa: a big sooty iron griddle (oval from above), worn bright in the middle
  const ty = top;
  P.cyl(0.6, 0.62, 0.032, 22, IRON, { p: [0, ty + 0.016, 0], s: [1, 1, 0.72] });
  P.torus(0.61, 0.014, '#0f0d0c', { p: [0, ty + 0.034, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.72, 1] }, 3, 22);
  P.cyl(0.42, 0.42, 0.004, 18, '#38312d', { p: [0, ty + 0.034, 0.0], s: [1, 1, 0.72] });
  P.cyl(0.04, 0.04, 0.05, 6, '#0f0d0c', { p: [0.52, ty + 0.03, -0.31], r: [1.4, 0, 0.6] }); // handle stump
  // ladle resting across the back-right rim, oil bottle, batter bucket, LPG
  P.cyl(0.008, 0.008, 0.46, 5, STEEL, { p: [0.34, ty + 0.085, -0.22], r: [0.02, 0.0, 1.43] });
  P.dome(0.045, STEEL, { p: [0.14, ty + 0.034, -0.2], r: [Math.PI, 0, 0], s: [1, 0.8, 1] }, 7, 3);
  P.cyl(0.04, 0.04, 0.17, 7, '#e5b92b', { p: [0.52, COUNTER_TOP + 0.085, -0.3] });
  P.cyl(0.018, 0.018, 0.05, 6, '#c7372a', { p: [0.52, COUNTER_TOP + 0.195, -0.3] });
  P.cyl(0.12, 0.105, 0.24, 9, '#2a6fb0', { p: [-0.5, COUNTER_TOP + 0.12, -0.28] }); // batter bucket
  P.cyl(0.125, 0.125, 0.025, 9, '#e8e8e8', { p: [-0.5, COUNTER_TOP + 0.255, -0.28] });
  P.torus(0.11, 0.006, '#9fa6aa', { p: [-0.5, COUNTER_TOP + 0.24, -0.28], r: [Math.PI / 2, 0, 0] }, 3, 9);
  P.box(0.02, 0.02, 0.1, SOOT, { p: [-0.5, COUNTER_TOP + 0.3, -0.28] });
  lpg(P, -0.58, -0.62);
  // fx: flames in the arch opening
  flameCones(P, 7, 0.2, COUNTER_TOP + 0.05, 0.37);
  const slotX = [-0.36, 0, 0.36];
  const slotZ = [0.05, -0.03, 0.05];
  const y = ty + 0.036;
  const slots = [];
  const anchors = [];
  const discGeo = sharedGeo('tawa:disc', () => new CylinderGeometry(0.17, 0.17, 0.014, 14).translate(0, 0.007, 0));
  const moundGeo = unit.sphere(6);
  const dotsGeo = sharedGeo('tawa:podi', () => {
    const Q = new Parts();
    for (const [x, z] of [[-0.07, 0.02], [0.0, -0.06], [0.06, 0.04], [0.09, -0.03], [-0.03, 0.07], [0.02, 0.02], [-0.09, -0.04]]) Q.sph(0.014, '#7a2412', { p: [x, 0.016, z], s: [1.3, 0.3, 1.3] }, 5, 3);
    return Q.build('solid');
  });
  for (let i = 0; i < 3; i++) {
    const g = new Group();
    g.position.set(slotX[i], y, slotZ[i]);
    root.add(g);
    const mat = new MeshStandardMaterial({ color: '#f2e8cb', flatShading: true, roughness: 0.55, emissive: '#ffb347', emissiveIntensity: 0, side: DoubleSide });
    const disc = new Mesh(discGeo, mat);
    disc.visible = false;
    g.add(disc);
    const mound = new Mesh(moundGeo, materials.solid('#f2c52e'));
    mound.position.set(0.02, 0.012, 0);
    mound.visible = false;
    g.add(mound);
    const podi = new Mesh(dotsGeo, materials.vertex());
    podi.visible = false;
    g.add(podi);
    const marker = new Marker(g, 0, 0.004, 0, 0.19);
    const smoke = new Puffs(g, materials.smoke(), 3, { y: 0.04, rise: 0.4, size: 0.1, speed: 0.35, drift: 0.05 });
    const A = new Vector3(slotX[i], y + 0.016, slotZ[i]);
    anchors.push(A);
    let cur = norm(null);
    const col = new Color();
    slots.push({
      set(info) {
        cur = norm(info);
        const { st, dish, progress } = cur;
        disc.visible = st !== 'empty';
        const pal = TAWA_COLORS[dish] || TAWA_COLORS.dosa;
        const p = st === 'cooking' ? progress : 1;
        const e = 1 - (1 - p) * (1 - p);
        const spread = st === 'cooking' ? 0.1 + 0.9 * e : 1;
        const set = dish === 'set_dosa';
        const k = set ? spread * 0.64 : spread;
        disc.scale.set(k, set ? 2.4 : 1, k);
        if (st === 'burnt') col.copy(BURNT);
        else col.set(pal[0]).lerp(_c1.set(pal[1]), p);
        mat.color.copy(col);
        mound.visible = dish === 'masala_dosa' && (st === 'ready' || (st === 'cooking' && progress > 0.55));
        mound.scale.set(0.075, 0.035, 0.05);
        podi.visible = dish === 'podi_dosa' && st !== 'empty' && st !== 'cooking' && st !== 'burnt';
        mat.emissiveIntensity = 0;
      },
      anim(t) {
        marker.update(t, cur.st);
        if (cur.st === 'ready') mat.emissiveIntensity = 0.12 + 0.1 * Math.sin(t * 5.5);
        smoke.update(t, cur.st === 'burnt', i * 0.31);
      },
    });
  }
  return { anchors, slots };
}

function steamerStation(root, P) {
  const slotX = [-0.465, -0.155, 0.155, 0.465];
  const colZ = 0.1;
  // dented steel drum, tiffin carrier and plate stack behind
  P.lathe([[0, 0], [0.19, 0], [0.2, 0.02], [0.2, 0.46], [0.185, 0.5], [0, 0.5]], 10, '#aab4ba', { p: [0.46, COUNTER_TOP, -0.28] });
  P.cyl(0.205, 0.205, 0.03, 10, '#8f9aa1', { p: [0.46, COUNTER_TOP + 0.505, -0.28] });
  P.torus(0.025, 0.006, '#6f7a80', { p: [0.46, COUNTER_TOP + 0.54, -0.28], r: [0, 0, 0] }, 3, 8);
  P.torus(0.205, 0.006, '#7c878e', { p: [0.46, COUNTER_TOP + 0.25, -0.28], r: [Math.PI / 2, 0, 0] }, 3, 10);
  for (const [dy, dr] of [[0.15, 0.04], [0.32, 0.05]]) P.sph(dr, '#8d979d', { p: [0.46 + 0.19, COUNTER_TOP + dy, -0.28 + 0.05], s: [0.3, 1, 1] }, 4, 3);
  for (let i = 0; i < 6; i++) P.cyl(0.11, 0.1, 0.012, 10, i % 2 ? '#c9d1d6' : '#bcc5ca', { p: [-0.5, COUNTER_TOP + 0.006 + i * 0.013, -0.28] }); // steel plates
  P.cyl(0.05, 0.05, 0.12, 8, '#c7372a', { p: [-0.2, COUNTER_TOP + 0.06, -0.3] }); // masala tin
  lpg(P, -0.62, -0.58);
  // 4 cookers: a sooty water pot with a tier on top
  for (let i = 0; i < 4; i++) {
    const x = slotX[i];
    const steel = ['#c6ced3', '#b9c2c8', '#c1cace', '#b4bdc3'][i];
    P.lathe([[0, 0], [0.145, 0], [0.155, 0.02], [0.165, 0.2], [0.17, 0.21], [0, 0.21]], 10, steel, { p: [x, COUNTER_TOP, colZ] });
    P.cyl(0.17, 0.15, 0.05, 10, SOOT, { p: [x, COUNTER_TOP + 0.025, colZ] });
    P.lathe([[0.165, 0], [0.16, 0.18], [0.172, 0.19], [0.178, 0.185], [0.15, 0.15]], 10, steel, { p: [x, COUNTER_TOP + 0.2, colZ] }); // tier wall
    P.torus(0.172, 0.007, '#8f9aa1', { p: [x, COUNTER_TOP + 0.2, colZ], r: [Math.PI / 2, 0, 0] }, 3, 10);
    P.torus(0.176, 0.008, '#8f9aa1', { p: [x, COUNTER_TOP + 0.385, colZ], r: [Math.PI / 2, 0, 0] }, 3, 10);
    P.box(0.07, 0.025, 0.03, '#7c878e', { p: [x - 0.19, COUNTER_TOP + 0.3, colZ] }); // handles
    P.box(0.07, 0.025, 0.03, '#7c878e', { p: [x + 0.19, COUNTER_TOP + 0.3, colZ] });
    P.cyl(0.14, 0.14, 0.01, 10, '#dfe5e8', { p: [x, COUNTER_TOP + 0.33, colZ] }); // tray floor
    P.sph(0.03, '#8d979d', { p: [x + 0.1, COUNTER_TOP + 0.17, colZ + 0.1], s: [1, 0.7, 0.3] }, 4, 3); // dent
  }
  const rimY = COUNTER_TOP + 0.39;
  const slots = [];
  const anchors = [];
  const idlyGeo = sharedGeo('steamer:idly', () => {
    const Q = new Parts();
    for (const [x, z] of [[0, 0.075], [-0.066, -0.04], [0.066, -0.04]]) Q.lathe([[0, 0], [0.05, 0], [0.058, 0.015], [0.05, 0.038], [0.028, 0.05], [0, 0.053]], 8, '#ffffff', { p: [x, 0, z] });
    return Q.build('solid');
  });
  const lidGeo = sharedGeo('steamer:lid', () => {
    const Q = new Parts();
    Q.lathe([[0.19, 0], [0.18, 0.03], [0.14, 0.07], [0.07, 0.095], [0, 0.1]], 10, '#b9c2c8', { p: [0, 0, 0.17] });
    Q.torus(0.19, 0.008, '#8f9aa1', { p: [0, 0, 0.17], r: [Math.PI / 2, 0, 0] }, 3, 10);
    Q.sph(0.025, '#2b2b2b', { p: [0, 0.115, 0.17] }, 5, 4);
    return Q.build('solid');
  });
  for (let i = 0; i < 4; i++) {
    const x = slotX[i];
    const g = new Group();
    g.position.set(x, rimY, colZ);
    root.add(g);
    const mat = new MeshStandardMaterial({ color: '#f1ecd9', flatShading: true, roughness: 0.6, emissive: '#fff0b0', emissiveIntensity: 0 });
    const idly = new Mesh(idlyGeo, mat);
    idly.position.y = -0.045;
    idly.visible = false;
    g.add(idly);
    const hinge = new Group();
    hinge.position.set(0, 0, -0.17);
    const lid = new Mesh(lidGeo, materials.vertex()); // lid geometry is offset +0.17 in z so it covers the pot when the hinge angle is 0
    hinge.add(lid);
    g.add(hinge);
    const marker = new Marker(root, x, COUNTER_TOP + 0.004, colZ, 0.2);
    const steam = new Puffs(g, materials.steam(), 4, { y: 0.04, rise: 0.4, size: 0.1, speed: 0.45, drift: 0.04 });
    const smoke = new Puffs(g, materials.smoke(), 3, { y: 0.04, rise: 0.4, size: 0.09, speed: 0.35, drift: 0.04 });
    anchors.push(new Vector3(x, rimY + 0.02, colZ));
    let cur = norm(null);
    let lidAngle = 0;
    let lidTarget = 0;
    slots.push({
      set(info) {
        cur = norm(info);
        const { st, progress } = cur;
        idly.visible = st !== 'empty';
        const rise = st === 'cooking' ? 0.18 + 0.82 * progress : 1;
        idly.scale.set(1, st === 'burnt' ? 0.8 : rise, 1);
        mat.color.set(st === 'burnt' ? '#2b211a' : '#f1ecd9').lerp(_c1.set('#fffaf0'), st === 'ready' ? 1 : st === 'cooking' ? progress : 0);
        if (st === 'burnt') mat.color.set('#2b211a');
        lidTarget = st === 'empty' ? 0 : st === 'burnt' ? -0.5 : st === 'cooking' ? -1.45 : -1.85;
      },
      anim(t, dt) {
        lidAngle += (lidTarget - lidAngle) * Math.min(1, dt * 7);
        hinge.rotation.x = lidAngle;
        marker.update(t, cur.st);
        mat.emissiveIntensity = cur.st === 'ready' ? 0.12 + 0.1 * Math.sin(t * 5.5) : 0;
        steam.update(t, cur.st === 'cooking' || cur.st === 'ready', i * 0.23);
        smoke.update(t, cur.st === 'burnt', i * 0.19);
      },
    });
  }
  return { anchors, slots };
}

const KADAI_ITEM = {
  poori: ['#efdcb0', '#e2a038'],
  vada: ['#efe2c0', '#c98a3a'],
  mysore_bonda: ['#e8d3a0', '#bf7020'],
  mirchi_bajji: ['#e9d98d', '#d5a443'],
};

function kadaiStation(root, P) {
  const top = bricks(P, 0.92, 0.22, 0.7, COUNTER_TOP);
  const by = top + 0.02;
  // soot-dark iron kadai: outer shell, rim, ear handles
  P.lathe([[0, 0], [0.16, 0.005], [0.34, 0.05], [0.47, 0.13], [0.54, 0.22], [0.555, 0.235], [0.535, 0.235], [0.46, 0.12], [0.3, 0.04], [0, 0.015]], 16, '#2a2623', { p: [0, by, 0], s: [1, 1, 0.8] });
  P.torus(0.545, 0.014, '#5a524c', { p: [0, by + 0.235, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.8, 1] }, 3, 16);
  for (const sx of [-1, 1]) P.torus(0.06, 0.012, '#3c3631', { p: [sx * 0.575, by + 0.22, 0], r: [0, Math.PI / 2, 0] }, 4, 8);
  P.cyl(0.52, 0.45, 0.012, 16, '#b97316', { p: [0, by + 0.155, 0], s: [1, 1, 0.8] }); // oil
  P.cyl(0.4, 0.4, 0.004, 14, '#d0902a', { p: [0, by + 0.162, 0], s: [1, 1, 0.8] });
  // jhara (perforated spoon) across the front-right rim, basket of newspaper-lined pooris, LPG
  P.cyl(0.008, 0.008, 0.62, 5, STEEL, { p: [0.4, by + 0.265, 0.34], r: [0.05, 0.5, 1.2] });
  P.cyl(0.075, 0.075, 0.008, 10, STEEL, { p: [0.17, by + 0.275, 0.2], r: [0.05, 0, 0.14] });
  for (const [x, z] of [[0.15, 0.2], [0.19, 0.22], [0.16, 0.24]]) P.sph(0.006, '#3a3a3a', { p: [x, by + 0.283, z], s: [1, 0.3, 1] }, 3, 3);
  P.cyl(0.13, 0.11, 0.14, 10, '#9c6a3a', { p: [0.52, COUNTER_TOP + 0.07, -0.28] });
  P.cyl(0.125, 0.125, 0.012, 10, '#e6dcc0', { p: [0.52, COUNTER_TOP + 0.145, -0.28] });
  for (let i = 0; i < 3; i++) P.sph(0.07, '#e0a03a', { p: [0.52 + (i - 1) * 0.03, COUNTER_TOP + 0.16 + i * 0.012, -0.28 + (i % 2) * 0.03], s: [1, 0.35, 1] }, 7, 4);
  P.box(0.16, 0.14, 0.12, '#d9d0b8', { p: [-0.5, COUNTER_TOP + 0.07, -0.28] }); // box of dough/batter, newspaper
  P.box(0.14, 0.004, 0.1, '#4b4640', { p: [-0.5, COUNTER_TOP + 0.142, -0.28] });
  lpg(P, 0.6, -0.62);
  flameCones(P, 7, 0.17, COUNTER_TOP + 0.04, 0.37);
  const slotX = [-0.27, 0, 0.27];
  const slotZ = [0.05, -0.07, 0.05];
  const oilY = by + 0.17;
  const slots = [];
  const anchors = [];
  const poori = unit.sphere(8);
  const vadaGeo = sharedGeo('kadai:vada', () => new TorusGeometry(0.048, 0.027, 6, 10).rotateX(Math.PI / 2));
  const bajjiGeo = sharedGeo('kadai:bajji', () => new CapsuleGeometry(0.03, 0.09, 3, 6).rotateZ(Math.PI / 2));
  for (let i = 0; i < 3; i++) {
    const g = new Group();
    g.position.set(slotX[i], oilY, slotZ[i]);
    root.add(g);
    const mat = new MeshStandardMaterial({ color: '#efdcb0', flatShading: true, roughness: 0.5, emissive: '#ffb347', emissiveIntensity: 0, side: DoubleSide });
    const item = new Group();
    g.add(item);
    const mPoori = new Mesh(poori, mat);
    mPoori.scale.set(0.095, 0.02, 0.095);
    const mVada = new Mesh(vadaGeo, mat);
    const mBonda = new Mesh(poori, mat);
    mBonda.scale.setScalar(0.055);
    const mBajji = new Mesh(bajjiGeo, mat);
    for (const m of [mPoori, mVada, mBonda, mBajji]) {
      m.visible = false;
      item.add(m);
    }
    const bubbles = new Puffs(g, materials.bubble(), 4, { y: 0.0, rise: 0.045, size: 0.026, speed: 1.4, drift: 0.07 });
    const marker = new Marker(g, 0, 0.004, 0, 0.17);
    const smoke = new Puffs(g, materials.smoke(), 3, { y: 0.04, rise: 0.42, size: 0.1, speed: 0.35, drift: 0.05 });
    anchors.push(new Vector3(slotX[i], oilY + 0.02, slotZ[i]));
    let cur = norm(null);
    const col = new Color();
    slots.push({
      set(info) {
        cur = norm(info);
        const { st, dish, progress } = cur;
        mPoori.visible = st !== 'empty' && dish === 'poori';
        mVada.visible = st !== 'empty' && dish === 'vada';
        mBonda.visible = st !== 'empty' && dish === 'mysore_bonda';
        mBajji.visible = st !== 'empty' && dish === 'mirchi_bajji';
        const pal = KADAI_ITEM[dish] || KADAI_ITEM.poori;
        const p = st === 'cooking' ? progress : 1;
        if (st === 'burnt') col.copy(BURNT);
        else col.set(pal[0]).lerp(_c1.set(pal[1]), p);
        mat.color.copy(col);
        // puri puffs up as it cooks
        mPoori.scale.y = 0.02 + 0.042 * (st === 'cooking' ? Math.min(1, p * 1.4) : 1);
        mat.emissiveIntensity = 0;
      },
      anim(t) {
        const cooking = cur.st === 'cooking';
        item.position.y = cur.st === 'empty' ? 0 : 0.012 + Math.sin(t * (cooking ? 3.4 : 1.4) + i * 1.7) * (cooking ? 0.014 : 0.006);
        item.rotation.z = Math.sin(t * 2.2 + i) * (cooking ? 0.08 : 0.02);
        marker.update(t, cur.st);
        if (cur.st === 'ready') mat.emissiveIntensity = 0.12 + 0.1 * Math.sin(t * 5.5);
        bubbles.update(t, cooking || cur.st === 'ready', i * 0.37);
        smoke.update(t, cur.st === 'burnt', i * 0.31);
      },
    });
  }
  return { anchors, slots };
}

const CHAI_LIQUID = { irani_chai: ['#eed9b6', '#c98e56'], filter_coffee: ['#8a5a36', '#5a3320'] };

function chaiStation(root, P) {
  // Irani chai kettle on a brick stove (left), steel milk pot (right), osmania biscuit jar (centre back), stack of glasses
  P.box(0.5, 0.04, 0.45, BRICK, { p: [-0.35, COUNTER_TOP + 0.02, -0.17] });
  P.box(0.5, 0.012, 0.012, MORTAR, { p: [-0.35, COUNTER_TOP + 0.02, 0.055] });
  P.box(0.3, 0.025, 0.012, '#120d0b', { p: [-0.35, COUNTER_TOP + 0.02, 0.058] });
  // Irani kettle (left, tall aluminium) and steel pot (right)
  const sub = (x, z, color, h, y0) => {
    P.lathe([[0, 0], [0.14, 0], [0.17, 0.05], [0.165, h * 0.6], [0.11, h * 0.9], [0.07, h * 0.99], [0, h]], 10, color, { p: [x, y0, z] });
    P.cyl(0.17, 0.15, 0.06, 10, SOOT, { p: [x, y0 + 0.03, z] });
    P.sph(0.03, '#3b3b3b', { p: [x, y0 + h + 0.02, z] }, 5, 4);
    P.cone(0.035, 0.2, 6, color, { p: [x + 0.17, y0 + h * 0.55, z + 0.1], r: [0.5, 0, -1.0] }, true);
    P.torus(0.12, 0.012, '#4a443f', { p: [x - 0.16, y0 + h * 0.55, z - 0.02], r: [0, Math.PI / 2, 0], s: [1, 1.2, 1] }, 3, 10, Math.PI);
    P.sph(0.03, '#8d979d', { p: [x - 0.1, y0 + h * 0.35, z + 0.15], s: [1, 1, 0.3] }, 4, 3);
  };
  sub(-0.35, -0.17, '#b9bec2', 0.36, COUNTER_TOP + 0.04);
  sub(0.38, -0.2, '#7a8288', 0.3, COUNTER_TOP);
  // biscuit jar (osmania): glass-ish jar drawn as pale cylinder with a tin lid, biscuits inside
  P.cyl(0.1, 0.095, 0.2, 10, '#e8efe9', { p: [0.0, COUNTER_TOP + 0.1, -0.3] });
  for (let i = 0; i < 4; i++) P.cyl(0.085, 0.085, 0.022, 9, '#f1dca3', { p: [0, COUNTER_TOP + 0.04 + i * 0.045, -0.3] });
  P.cyl(0.105, 0.105, 0.03, 10, '#c0392b', { p: [0, COUNTER_TOP + 0.215, -0.3] });
  P.sph(0.02, '#3b3b3b', { p: [0, COUNTER_TOP + 0.245, -0.3] }, 4, 3);
  // stack of spare chai glasses on a steel tray (front right)
  P.cyl(0.13, 0.13, 0.01, 10, STEEL, { p: [0.5, COUNTER_TOP + 0.005, 0.2] });
  for (const [dx, dz] of [[-0.04, -0.03], [0.04, -0.03], [0.0, 0.04]]) P.cyl(0.032, 0.026, 0.09, 6, '#cfe6e6', { p: [0.5 + dx, COUNTER_TOP + 0.055, 0.2 + dz] });
  lpg(P, 0.62, -0.62);
  flameCones(P, 5, 0.1, COUNTER_TOP + 0.015, 0.057 + 0.0);
  const slotX = [-0.2, 0.2];
  const slotZ = 0.22;
  const slots = [];
  const anchors = [];
  const glassGeo = sharedGeo('chai:glass', () => new CylinderGeometry(0.07, 0.052, 0.14, 10, 1, true).translate(0, 0.07, 0));
  const liqGeo = sharedGeo('chai:liquid', () => new CylinderGeometry(0.062, 0.046, 0.12, 10).translate(0, 0.06, 0));
  const frothGeo = sharedGeo('chai:froth', () => new CylinderGeometry(0.06, 0.06, 0.008, 10));
  const saucerGeo = sharedGeo('chai:saucer', () => {
    const Q = new Parts();
    Q.lathe([[0, 0], [0.09, 0], [0.14, 0.015], [0.145, 0.025], [0.13, 0.027], [0.07, 0.014], [0, 0.012]], 12, '#f4efe2', {});
    Q.torus(0.141, 0.004, '#2c6fb4', { p: [0, 0.025, 0], r: [Math.PI / 2, 0, 0] }, 3, 12);
    return Q.build('solid');
  });
  const biscGeo = sharedGeo('chai:biscuit', () => {
    const Q = new Parts();
    Q.cyl(0.058, 0.058, 0.016, 10, '#f1dca3', { p: [-0.025, 0.03, 0.02] });
    Q.torus(0.058, 0.006, '#d6b062', { p: [-0.025, 0.038, 0.02], r: [Math.PI / 2, 0, 0] }, 3, 10);
    Q.cyl(0.056, 0.056, 0.016, 10, '#f4e1ab', { p: [0.035, 0.07, -0.02], r: [0.2, 0, -0.9] });
    return Q.build('solid');
  });
  for (let i = 0; i < 2; i++) {
    const g = new Group();
    g.position.set(slotX[i], COUNTER_TOP, slotZ);
    root.add(g);
    g.add(new Mesh(saucerGeo, materials.vertex()));
    const glass = new Mesh(glassGeo, materials.glass());
    glass.position.y = 0.02;
    g.add(glass);
    const liqMat = new MeshStandardMaterial({ color: '#c98e56', flatShading: true, roughness: 0.4, emissive: '#ffb347', emissiveIntensity: 0 });
    const liquid = new Mesh(liqGeo, liqMat);
    liquid.position.y = 0.02;
    liquid.visible = false;
    g.add(liquid);
    const froth = new Mesh(frothGeo, materials.solid('#f0d6ac'));
    froth.visible = false;
    g.add(froth);
    const bisc = new Mesh(biscGeo, materials.vertex());
    bisc.position.y = 0.012;
    bisc.visible = false;
    g.add(bisc);
    const marker = new Marker(g, 0, 0.004, 0, 0.17);
    const steam = new Puffs(g, materials.steam(), 3, { y: 0.17, rise: 0.25, size: 0.055, speed: 0.5, drift: 0.03 });
    const smoke = new Puffs(g, materials.smoke(), 3, { y: 0.15, rise: 0.35, size: 0.07, speed: 0.35, drift: 0.04 });
    anchors.push(new Vector3(slotX[i], COUNTER_TOP + 0.16, slotZ));
    let cur = norm(null);
    const col = new Color();
    slots.push({
      set(info) {
        cur = norm(info);
        const { st, dish, progress } = cur;
        const biscuit = dish === 'osmania';
        glass.visible = !biscuit || st === 'empty';
        liquid.visible = !biscuit && st !== 'empty';
        bisc.visible = biscuit && st !== 'empty';
        bisc.scale.setScalar(st === 'cooking' ? 0.3 + 0.7 * progress : 1);
        const pal = CHAI_LIQUID[dish] || CHAI_LIQUID.irani_chai;
        if (st === 'burnt') col.copy(BURNT);
        else col.set(pal[0]).lerp(_c1.set(pal[1]), st === 'cooking' ? progress : 1);
        liqMat.color.copy(col);
        const fill = st === 'cooking' ? 0.08 + 0.92 * progress : 1;
        liquid.scale.y = fill;
        froth.visible = liquid.visible && st === 'ready';
        froth.position.y = 0.02 + 0.12;
        liqMat.emissiveIntensity = 0;
      },
      anim(t) {
        marker.update(t, cur.st);
        if (cur.st === 'ready') liqMat.emissiveIntensity = 0.1 + 0.08 * Math.sin(t * 5.5);
        steam.update(t, (cur.st === 'cooking' && cur.progress > 0.4) || cur.st === 'ready', i * 0.4);
        smoke.update(t, cur.st === 'burnt', i * 0.5);
      },
    });
  }
  return { anchors, slots };
}

const BUILDERS = { tawa: tawaStation, steamer: steamerStation, kadai: kadaiStation, chai: chaiStation };
const ACCENT = { tawa: '#e0392b', steamer: '#12908e', kadai: '#ff8a1f', chai: '#2f9e5b' };

/** buildStationProp(kindId) -> { group, slotAnchors, setSlot, update, dispose, slotWorld, kind } */
export function buildStationProp(kindId) {
  const def = STATION_KINDS[kindId];
  const kind = def ? kindId : 'tawa';
  const group = new Group();
  group.name = `station-${kind}`;
  group.userData.kind = kind;

  // static merged geometry is built once per kind and shared
  const key = `station:${kind}`;
  const P = new Parts();
  counter(P, ACCENT[kind]);
  // The kind builder adds its static parts to P and creates its dynamic meshes under `group`
  const built = BUILDERS[kind](group, P);
  const solid = sharedGeo(`${key}:solid`, () => P.build('solid'));
  const fxGeo = sharedGeo(`${key}:fx`, () => P.build('fx') || new BufferGeometry());
  group.add(new Mesh(solid, materials.vertex()));

  // flames (fx layer): flicker as one mesh; plus a glow patch
  const flameMat = new MeshBasicMaterial({ color: '#ff7a1a', toneMapped: false, side: DoubleSide });
  let flames = null;
  if (fxGeo.attributes.position) {
    flames = new Mesh(fxGeo, flameMat);
    group.add(flames);
  }
  const glowMat = new MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.4, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  const glow = new Mesh(sharedGeo('station:glow', () => new PlaneGeometry(0.62, 0.16)), glowMat);
  glow.position.set(0, COUNTER_TOP + 0.13, 0.372);
  if (kind === 'chai') glow.position.set(-0.35, COUNTER_TOP + 0.05, 0.06);
  if (kind === 'chai') glow.scale.set(0.5, 0.3, 1);
  glow.visible = !!flames;
  group.add(glow);

  // label plate: enamel/tin with the Telugu name, tilted up towards the high camera
  const labelTex = labelTexture({ te: def ? def.te : '', en: def ? def.name : kind, style: LABEL_STYLES[kind] });
  const labelMat = new MeshBasicMaterial({ map: labelTex, toneMapped: false });
  const label = new Mesh(sharedGeo('station:label', () => new PlaneGeometry(0.92, 0.23)), labelMat);
  label.position.set(0, 0.42, 0.468);
  label.rotation.x = -0.42;
  group.add(label);
  const frame = new Mesh(sharedGeo('station:labelFrame', () => new PlaneGeometry(0.97, 0.275)), materials.solid('#1f1c1b'));
  frame.position.set(0, 0.42, 0.465);
  frame.rotation.x = -0.42;
  group.add(frame);

  const slotAnchors = built.anchors;
  const state = built.slots.map(() => norm(null));
  let disposed = false;

  const prop = {
    group,
    kind,
    slotAnchors,
    setSlot(i, info) {
      const s = built.slots[i];
      if (!s || disposed) return;
      state[i] = norm(info);
      s.set(info);
    },
    update(dt, t) {
      if (disposed) return;
      const d = num(dt, 0.016);
      const tt = num(t, 0);
      if (flames) flames.scale.set(1 + 0.05 * Math.sin(tt * 13), 0.88 + 0.16 * Math.sin(tt * 17) + 0.08 * Math.sin(tt * 29), 1);
      glowMat.opacity = 0.3 + 0.12 * Math.sin(tt * 9) + 0.06 * Math.sin(tt * 23);
      for (const s of built.slots) s.anim(tt, d);
    },
    /** World position of slot i's anchor (pass `out` to avoid allocation). */
    slotWorld(i, out = new Vector3()) {
      const a = slotAnchors[i];
      if (!a) return out.set(0, 0, 0);
      group.updateWorldMatrix(true, false);
      return out.copy(a).applyMatrix4(group.matrixWorld);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeObject(group);
    },
  };
  // paint the idle state once so a station is never blank before the first setSlot
  for (let i = 0; i < built.slots.length; i++) built.slots[i].set(null);
  prop.update(0.016, 0);
  return prop;
}
