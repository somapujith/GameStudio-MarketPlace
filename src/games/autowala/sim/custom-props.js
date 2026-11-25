// Props of the workshop catalogue that are meshes of their own: roof styles (flag topper, marigold garland, loudspeaker, LED bar,
// disco domes), the dashboard bobbleheads and the big windscreen garland. Every builder returns { group, update(env), dispose() }:
// `env` = { t, dt, speed, hornTime, jolt, night }. Props own all their geometry and materials, so dispose() frees everything.
// OWNER: customisation agent.
import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvasTexture } from '../render/textures.js';
import { hslInto } from './custom-logic.js';

const _rgb = [0, 0, 0]; // scratch for per-frame colour cycling

const std = (color, o = {}) => new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...o });
const glow = (hex, mult = 1) => new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(mult), toneMapped: false });

function mesh(parent, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, shadow = true) {
  const o = new Mesh(geo, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.castShadow = shadow;
  parent.add(o);
  return o;
}

/** Free every geometry, material and texture under an object (props own theirs; never call this on shared auto parts). */
export function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.isInstancedMesh) o.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      if (m.map) {
        if (m.map.userData) m.map.userData.dead = true;
        m.map.dispose();
      }
      m.dispose();
    }
  });
}

const prop = (group, update = () => {}) => ({ group, update, dispose: () => disposeTree(group) });

// ---------------------------------------------------------------------------------------------------------------- garlands

/** A hanging string of marigolds along a catenary from (x0,y,z) to (x1,y,z), sagging by `sag`. */
function garlandString(count, x0, x1, y, z, sag, r, palette, seed = 1) {
  const geo = new SphereGeometry(r, 6, 4);
  const m = std('#ffffff', { roughness: 0.75 });
  const im = new InstancedMesh(geo, m, count);
  const col = new Color();
  const o = new Object3D();
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0.5 : i / (count - 1);
    o.position.set(x0 + (x1 - x0) * u, y - sag * 4 * u * (1 - u) + Math.sin((i + seed) * 12.9) * 0.008, z + Math.cos((i + seed) * 7.1) * 0.01);
    const s = 0.9 + ((i * 37 + seed) % 5) * 0.06;
    o.scale.set(s, s * 0.78, s);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
    im.setColorAt(i, col.set(palette[(i + seed) % palette.length]));
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = true;
  return im;
}

/** Strands of flowers dangling down from points on a garland. */
function dangle(group, xs, y, z, n, r, palette) {
  const geo = new SphereGeometry(r, 6, 4);
  const m = std('#ffffff', { roughness: 0.75 });
  const im = new InstancedMesh(geo, m, xs.length * n);
  const col = new Color();
  const o = new Object3D();
  let k = 0;
  xs.forEach((x, si) => {
    for (let i = 0; i < n; i++) {
      o.position.set(x, y - i * r * 1.7, z);
      const s = 1 - i * 0.07;
      o.scale.set(s, s * 0.8, s);
      o.updateMatrix();
      im.setMatrixAt(k, o.matrix);
      im.setColorAt(k, col.set(palette[(i + si) % palette.length]));
      k++;
    }
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  group.add(im);
}

const MARIGOLD = ['#ff8a1c', '#ffc21a', '#ff9f1c', '#ffd23f'];

/** Marigold garland across the front lip of the roof, with strands hanging at the corners and the middle. */
export function buildRoofGarland() {
  const g = new Group();
  g.add(garlandString(22, -0.76, 0.76, 1.97, 1.17, 0.12, 0.062, MARIGOLD, 3));
  dangle(g, [-0.74, 0, 0.74], 1.96, 1.17, 5, 0.052, [...MARIGOLD, '#ff4d6d']);
  dangle(g, [-0.38, 0.38], 1.9, 1.17, 3, 0.05, MARIGOLD);
  return prop(g);
}

/** The big windscreen garland (the `interior.garland` option): hangs from the front roof edge across the glass. */
export function buildDashGarland() {
  const g = new Group();
  g.add(garlandString(20, -0.62, 0.62, 2.0, 0.7, 0.2, 0.052, [...MARIGOLD, '#ff4d6d', '#fff1d0'], 5));
  dangle(g, [-0.62, 0.62], 1.99, 0.7, 6, 0.05, [...MARIGOLD, '#ff4d6d']);
  dangle(g, [0], 1.8, 0.7, 3, 0.05, MARIGOLD);
  const tassel = new ConeGeometry(0.035, 0.1, 8);
  mesh(g, tassel, std('#e9b64a', { metalness: 0.7, roughness: 0.3 }), 0, 1.69, 0.7, Math.PI, 0, 0);
  return prop(g);
}

// ---------------------------------------------------------------------------------------------------------------- flag

function flagTexture() {
  return canvasTexture(160, 100, (g, w, h) => {
    g.fillStyle = '#e91e8c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.fillRect(0, h * 0.34, w, h * 0.32);
    g.fillStyle = '#ffc21a'; // a gold sun in the white band
    g.beginPath();
    g.arc(w * 0.5, h * 0.5, h * 0.13, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffc21a';
    g.lineWidth = 2;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(w * 0.5 + Math.cos(a) * h * 0.16, h * 0.5 + Math.sin(a) * h * 0.16);
      g.lineTo(w * 0.5 + Math.cos(a) * h * 0.24, h * 0.5 + Math.sin(a) * h * 0.24);
      g.stroke();
    }
  });
}

/** A flagpole at the front-right corner of the roof with a flag that streams backwards and flutters (faster when you drive faster). */
export function buildFlag() {
  const g = new Group();
  const base = new Group();
  base.position.set(0.56, 2.17, 0.5);
  g.add(base);
  const chrome = std('#d8dae8', { roughness: 0.2, metalness: 0.9 });
  mesh(base, new CylinderGeometry(0.05, 0.06, 0.04, 10), chrome, 0, 0.02, 0);
  mesh(base, new CylinderGeometry(0.014, 0.014, 0.95, 8), chrome, 0, 0.5, 0);
  mesh(base, new SphereGeometry(0.03, 8, 6), std('#e9b64a', { metalness: 0.8, roughness: 0.3 }), 0, 1.0, 0);
  const SEG_X = 12;
  const SEG_Y = 4;
  const W = 0.66;
  const H = 0.4;
  const geo = new PlaneGeometry(W, H, SEG_X, SEG_Y);
  const m = new MeshStandardMaterial({ map: flagTexture(), side: DoubleSide, roughness: 0.7, metalness: 0 });
  const flag = mesh(base, geo, m, 0, 0.78, -W / 2 - 0.015, 0, Math.PI / 2, 0, false);
  const pos = geo.attributes.position;
  const rest = Float32Array.from(pos.array);
  let phase = 0;
  const update = (env) => {
    phase += env.dt * (5 + Math.min(env.speed, 28) * 0.55);
    const amp = 0.035 + Math.min(env.speed, 28) * 0.0035;
    for (let i = 0; i < pos.count; i++) {
      const x = rest[i * 3];
      const y = rest[i * 3 + 1];
      const u = (x + W / 2) / W; // 0 at the pole .. 1 at the fly end
      pos.setZ(i, Math.sin(u * 7 - phase + y * 3) * amp * u + Math.sin(u * 3.3 - phase * 0.7) * amp * 0.5 * u);
      pos.setY(i, y - u * u * 0.025);
    }
    pos.needsUpdate = true;
  };
  flag.frustumCulled = false;
  return prop(g, update);
}

// ---------------------------------------------------------------------------------------------------------------- speaker, led bar, domes

/** A PA loudspeaker box on the roof with two cones that thump when you honk. */
export function buildSpeaker() {
  const g = new Group();
  const box = new Group();
  box.position.set(0, 2.17, 0.1);
  g.add(box);
  const cab = std('#17141b', { roughness: 0.7 });
  mesh(box, new RoundedBoxGeometry(0.74, 0.3, 0.36, 1, 0.035), cab, 0, 0.16, 0);
  const trim = std('#c9ccd8', { roughness: 0.25, metalness: 0.85 });
  mesh(box, new RoundedBoxGeometry(0.78, 0.03, 0.4, 1, 0.012), trim, 0, 0.015, 0);
  const cones = [];
  const coneMat = std('#2a2733', { roughness: 0.55, metalness: 0.2, side: DoubleSide });
  for (const s of [-1, 1]) {
    const unit = new Group();
    unit.position.set(s * 0.19, 0.17, 0.18);
    box.add(unit);
    mesh(unit, new TorusGeometry(0.115, 0.014, 5, 12), trim, 0, 0, 0, 0, 0, 0, false);
    const cone = mesh(unit, new CylinderGeometry(0.108, 0.04, 0.07, 10, 1, true), coneMat, 0, 0, -0.03, Math.PI / 2, 0, 0, false);
    mesh(unit, new SphereGeometry(0.035, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), trim, 0, 0, -0.05, Math.PI / 2, 0, 0, false);
    cones.push({ unit, cone });
  }
  const led = mesh(box, new SphereGeometry(0.012, 6, 5), glow('#ff3a3a', 1.2), 0, 0.27, 0.185, 0, 0, 0, false);
  const update = (env) => {
    const thump = env.hornTime > 0 ? 0.5 + 0.5 * Math.sin(env.t * 70) : 0;
    for (const c of cones) c.unit.scale.z = 1 + thump * 0.45;
    led.scale.setScalar(env.hornTime > 0 ? 1.6 : 1);
  };
  return prop(g, update);
}

/** A bright LED light bar across the front of the roof; the emitters shimmer in a slow chase. */
export function buildLedBar() {
  const g = new Group();
  const bar = new Group();
  bar.position.set(0, 2.2, 0.62);
  g.add(bar);
  mesh(bar, new RoundedBoxGeometry(1.3, 0.075, 0.1, 1, 0.02),std('#101018', { roughness: 0.4, metalness: 0.5 }), 0, 0, 0);
  for (const s of [-1, 1]) mesh(bar, new BoxGeometry(0.05, 0.04, 0.05), std('#c9ccd8', { metalness: 0.8, roughness: 0.3 }), s * 0.5, -0.05, 0, 0, 0, 0, false);
  const N = 9;
  const emitters = [];
  const geo = new BoxGeometry(0.11, 0.045, 0.012);
  for (let i = 0; i < N; i++) {
    const m = glow('#dff6ff', 1.0);
    const e = mesh(bar, geo, m, -0.52 + (i * 1.04) / (N - 1), 0, 0.056, 0, 0, 0, false);
    emitters.push(e);
  }
  const base = new Color('#dff6ff');
  const update = (env) => {
    for (let i = 0; i < N; i++) {
      const k = 1.0 + 0.16 * Math.sin(env.t * 4 - i * 0.7);
      emitters[i].material.color.setRGB(base.r * k, base.g * k, base.b * k);
    }
  };
  return prop(g, update);
}

/** Two disco domes on the roof: translucent coloured glass, a spinning beam bar and a pulsing core; the colours cycle. */
export function buildDomeLights() {
  const g = new Group();
  const domes = [];
  const baseGeo = new CylinderGeometry(0.14, 0.15, 0.04, 10);
  const domeGeo = new SphereGeometry(0.115, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const bladeGeo = new BoxGeometry(0.2, 0.012, 0.03);
  const coreGeo = new SphereGeometry(0.035, 8, 6);
  const baseM = std('#1c1a24', { metalness: 0.6, roughness: 0.4 });
  for (const [i, x] of [-0.44, 0.44].entries()) {
    const d = new Group();
    d.position.set(x, 2.17, 0.35);
    g.add(d);
    mesh(d, baseGeo, baseM, 0, 0.02, 0, 0, 0, 0, false);
    const glass = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false });
    mesh(d, domeGeo, glass, 0, 0.04, 0, 0, 0, 0, false);
    const core = glow('#ffffff', 1.1);
    mesh(d, coreGeo, core, 0, 0.075, 0, 0, 0, 0, false);
    const blade = new Group();
    blade.position.y = 0.085;
    const bm = glow('#ffffff', 1.2);
    mesh(blade, bladeGeo, bm, 0, 0, 0, 0, 0, 0, false);
    mesh(blade, bladeGeo, bm, 0, 0, 0, 0, Math.PI / 2, 0, false);
    d.add(blade);
    domes.push({ glass, core, bm, blade, off: i * 0.5 });
  }
  const update = (env) => {
    domes.forEach((d, i) => {
      hslInto(_rgb, env.t * 0.22 + d.off, 1, 0.55);
      const r = _rgb[0];
      const gg = _rgb[1];
      const b = _rgb[2];
      d.glass.color.setRGB(r, gg, b);
      const k = 1.0 + 0.2 * Math.sin(env.t * 9 + i * 2);
      d.core.color.setRGB(r * k, gg * k, b * k);
      d.bm.color.setRGB(r * 1.15, gg * 1.15, b * 1.15);
      d.blade.rotation.y = env.t * (i ? -7 : 7);
    });
  };
  return prop(g, update);
}

// ---------------------------------------------------------------------------------------------------------------- dash toys

/** Spring + base shared by every bobblehead; returns the group the animated part hangs from. */
function toyRig(root) {
  mesh(root, new CylinderGeometry(0.06, 0.066, 0.022, 10), std('#25222c', { roughness: 0.5, metalness: 0.4 }), 0, 0.011, 0, 0, 0, 0, false);
  mesh(root, new CylinderGeometry(0.009, 0.009, 0.05, 6), std('#c9ccd8', { metalness: 0.9, roughness: 0.25 }), 0, 0.045, 0, 0, 0, 0, false);
  const nod = new Group();
  nod.position.y = 0.07;
  root.add(nod);
  return nod;
}

const SKIN = '#d9a273';

const TOYS = {
  cricketer(root) {
    const nod = toyRig(root);
    mesh(nod, new CapsuleGeometry(0.04, 0.06, 2, 6), std('#1e5bd8'), 0, 0.06, 0);
    mesh(nod, new SphereGeometry(0.036, 8, 6), std(SKIN), 0, 0.14, 0);
    mesh(nod, new SphereGeometry(0.041, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), std('#1e5bd8', { roughness: 0.4 }), 0, 0.147, 0);
    mesh(nod, new BoxGeometry(0.1, 0.012, 0.03), std('#1e5bd8'), 0, 0.15, 0.04); // helmet peak
    const bat = mesh(nod, new RoundedBoxGeometry(0.02, 0.12, 0.034, 1, 0.006), std('#d9b06a', { roughness: 0.6 }), 0.07, 0.07, 0.025, 0, 0, -0.3);
    bat.castShadow = false;
    for (const s of [-1, 1]) mesh(nod, new CapsuleGeometry(0.014, 0.05, 2, 6), std('#f4f1ea'), s * 0.02, -0.005, 0.01);
    return (env) => {
      nod.rotation.x = Math.sin(env.t * 3.1) * 0.22 + env.jolt * Math.sin(env.t * 30) * 0.2;
      nod.rotation.z = Math.sin(env.t * 1.7) * 0.05;
    };
  },
  hanuman(root) {
    const nod = toyRig(root);
    mesh(nod, new CapsuleGeometry(0.042, 0.06, 2, 6), std('#ff8a2d'), 0, 0.06, 0);
    mesh(nod, new SphereGeometry(0.04, 8, 6), std('#e8b58a'), 0, 0.145, 0);
    mesh(nod, new SphereGeometry(0.028, 8, 6), std('#d6322e'), 0, 0.14, 0.022);
    for (const s of [-1, 1]) mesh(nod, new SphereGeometry(0.011, 6, 5), std('#111'), s * 0.014, 0.153, 0.04, 0, 0, 0, false);
    mesh(nod, new ConeGeometry(0.036, 0.06, 10), std('#e9b64a', { metalness: 0.8, roughness: 0.3 }), 0, 0.2, 0);
    const mace = new Group();
    mace.position.set(0.075, 0.07, 0.02);
    mace.rotation.z = -0.2;
    nod.add(mace);
    mesh(mace, new CylinderGeometry(0.007, 0.007, 0.1, 6), std('#7a4a2d'), 0, 0.03, 0, 0, 0, 0, false);
    mesh(mace, new SphereGeometry(0.03, 8, 6), std('#e9b64a', { metalness: 0.8, roughness: 0.3 }), 0, 0.1, 0, 0, 0, 0, false);
    mesh(nod, new TorusGeometry(0.04, 0.008, 5, 12, Math.PI * 1.3), std('#ff8a2d'), 0, 0.04, -0.045, 0.2, 0, 0, false);
    return (env) => {
      nod.rotation.x = Math.sin(env.t * 2.6) * 0.18 + env.jolt * Math.sin(env.t * 28) * 0.2;
      mace.rotation.z = -0.2 + Math.sin(env.t * 2.6 + 1) * 0.1;
    };
  },
  ganesh(root) {
    const nod = toyRig(root);
    mesh(nod, new SphereGeometry(0.052, 8, 6), std('#e8a23d'), 0, 0.06, 0);
    const head = new Group();
    head.position.y = 0.15;
    nod.add(head);
    mesh(head, new SphereGeometry(0.045, 8, 6), std('#9aa0aa'), 0, 0, 0);
    for (const s of [-1, 1]) {
      const ear = mesh(head, new SphereGeometry(0.04, 8, 6), std('#b3b8c2'), s * 0.05, 0, 0, 0, 0, 0, false);
      ear.scale.set(0.35, 1.1, 0.9);
      mesh(head, new ConeGeometry(0.006, 0.035, 6), std('#f4f1ea'), s * 0.022, -0.035, 0.04, Math.PI * 0.85, 0, 0, false);
    }
    mesh(head, new CapsuleGeometry(0.015, 0.06, 2, 6), std('#9aa0aa'), 0, -0.04, 0.045, 0.35, 0, 0, false);
    mesh(head, new ConeGeometry(0.035, 0.05, 10), std('#e9b64a', { metalness: 0.8, roughness: 0.3 }), 0, 0.055, 0, 0, 0, 0, false);
    for (const s of [-1, 1]) mesh(head, new SphereGeometry(0.007, 6, 5), std('#111'), s * 0.017, 0.012, 0.043, 0, 0, 0, false);
    return (env) => {
      head.rotation.x = Math.sin(env.t * 2.4) * 0.22 + env.jolt * Math.sin(env.t * 30) * 0.2;
      nod.rotation.z = Math.sin(env.t * 1.2) * 0.04;
    };
  },
  cow(root) {
    mesh(root, new CylinderGeometry(0.06, 0.066, 0.022, 10), std('#25222c', { roughness: 0.5, metalness: 0.4 }), 0, 0.011, 0, 0, 0, 0, false);
    const body = mesh(root, new RoundedBoxGeometry(0.09, 0.08, 0.17, 1, 0.03), std('#f6f1e6'), 0, 0.08, 0);
    body.castShadow = true;
    for (const [x, y, z, s] of [[0.046, 0.09, -0.02, 0.5], [-0.046, 0.075, 0.03, 0.4], [0.03, 0.12, 0.05, 0.3]]) {
      const p = mesh(root, new BoxGeometry(0.01, 0.04 * s * 2, 0.05 * s * 2), std('#1a1820'), x, y, z, 0, 0, 0, false);
      p.position.x = x;
    }
    for (const [x, z] of [[-0.028, -0.06], [0.028, -0.06], [-0.028, 0.06], [0.028, 0.06]]) mesh(root, new CylinderGeometry(0.009, 0.009, 0.04, 6), std('#d9a273'), x, 0.04, z, 0, 0, 0, false);
    const nod = new Group();
    nod.position.set(0, 0.11, 0.08);
    root.add(nod);
    mesh(nod, new SphereGeometry(0.04, 8, 6), std('#f6f1e6'), 0, 0.01, 0.03);
    const snout = mesh(nod, new SphereGeometry(0.026, 8, 6), std('#f2a7a0'), 0, -0.006, 0.065, 0, 0, 0, false);
    snout.scale.set(1.1, 0.8, 0.8);
    for (const s of [-1, 1]) {
      mesh(nod, new ConeGeometry(0.008, 0.035, 6), std('#f1e4c6'), s * 0.03, 0.05, 0.03, 0, 0, -s * 0.5, false);
      const ear = mesh(nod, new SphereGeometry(0.014, 6, 5), std('#f6f1e6'), s * 0.045, 0.025, 0.02, 0, 0, 0, false);
      ear.scale.set(1.2, 0.5, 0.8);
      mesh(nod, new SphereGeometry(0.006, 6, 5), std('#111'), s * 0.016, 0.02, 0.067, 0, 0, 0, false);
    }
    mesh(root, new CylinderGeometry(0.004, 0.004, 0.07, 5), std('#1a1820'), 0, 0.085, -0.095, 0.4, 0, 0, false);
    return (env) => {
      nod.rotation.x = Math.sin(env.t * 2.8) * 0.3 + env.jolt * Math.sin(env.t * 30) * 0.2;
    };
  },
  dancer(root) {
    const nod = toyRig(root);
    const fig = new Group();
    nod.add(fig);
    mesh(fig, new CylinderGeometry(0.02, 0.07, 0.085, 10, 1, true), std('#e91e8c', { side: DoubleSide }), 0, 0.045, 0);
    mesh(fig, new CylinderGeometry(0.022, 0.024, 0.06, 8), std('#ffc21a'), 0, 0.105, 0);
    mesh(fig, new SphereGeometry(0.03, 8, 6), std(SKIN), 0, 0.16, 0);
    mesh(fig, new SphereGeometry(0.034, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), std('#1b1220'), 0, 0.166, -0.004, 0, 0, 0, false);
    mesh(fig, new SphereGeometry(0.016, 8, 6), std('#1b1220'), 0, 0.2, -0.015, 0, 0, 0, false);
    const arms = [];
    for (const s of [-1, 1]) {
      const a = new Group();
      a.position.set(s * 0.024, 0.125, 0);
      fig.add(a);
      mesh(a, new CapsuleGeometry(0.008, 0.06, 2, 6), std(SKIN), s * 0.02, 0.025, 0, 0, 0, -s * 0.5, false);
      arms.push([a, s]);
    }
    return (env) => {
      fig.rotation.y = Math.sin(env.t * 2.4) * 0.8;
      nod.rotation.z = Math.sin(env.t * 4.8) * 0.12;
      for (const [a, s] of arms) a.rotation.z = -s * (0.5 + 0.5 * Math.sin(env.t * 4.8 + (s > 0 ? 0 : 1.6)));
    };
  },
  'lucky-cat'(root) {
    const nod = toyRig(root);
    mesh(nod, new CapsuleGeometry(0.04, 0.05, 2, 6), std('#f6f1e6', { roughness: 0.4 }), 0, 0.055, 0);
    const head = mesh(nod, new SphereGeometry(0.042, 8, 6), std('#f6f1e6', { roughness: 0.4 }), 0, 0.14, 0);
    head.scale.set(1.15, 0.9, 0.95);
    for (const s of [-1, 1]) {
      mesh(nod, new ConeGeometry(0.014, 0.03, 6), std('#f6f1e6'), s * 0.032, 0.18, 0, 0, 0, -s * 0.3, false);
      mesh(nod, new SphereGeometry(0.006, 6, 5), std('#111'), s * 0.017, 0.145, 0.038, 0, 0, 0, false);
    }
    mesh(nod, new SphereGeometry(0.007, 6, 5), std('#e08a8a'), 0, 0.135, 0.04, 0, 0, 0, false);
    mesh(nod, new TorusGeometry(0.036, 0.007, 5, 12), std('#d6322e'), 0, 0.103, 0, Math.PI / 2, 0, 0, false);
    mesh(nod, new SphereGeometry(0.012, 8, 6), std('#e9b64a', { metalness: 0.8, roughness: 0.3 }), 0, 0.09, 0.04, 0, 0, 0, false);
    const paw = new Group();
    paw.position.set(0.04, 0.085, 0.015);
    nod.add(paw);
    mesh(paw, new CapsuleGeometry(0.013, 0.05, 2, 6), std('#f6f1e6'), 0.01, 0.03, 0, 0, 0, 0, false);
    return (env) => {
      nod.rotation.x = Math.sin(env.t * 2.5) * 0.1 + env.jolt * Math.sin(env.t * 30) * 0.15;
      paw.rotation.z = -0.5 + Math.sin(env.t * 4.5) * 0.55;
    };
  },
};

/** A dashboard toy by catalogue id ('none' / unknown -> null). The toy faces +z of its mount and bobs. */
export function buildDashToy(id) {
  const make = TOYS[id];
  if (!make) return null;
  const g = new Group();
  const upd = make(g);
  return prop(g, upd);
}

export const TOY_IDS = Object.keys(TOYS);

/** Build a roof-style prop by catalogue id; null for 'stock' and 'high-canopy' (the canopy is a change to the roof itself). */
export function buildRoofProp(id) {
  switch (id) {
    case 'flag': return buildFlag();
    case 'garland': return buildRoofGarland();
    case 'speaker': return buildSpeaker();
    case 'led-bar': return buildLedBar();
    case 'dome-lights': return buildDomeLights();
    default: return null;
  }
}

export { AdditiveBlending, Matrix4 };
