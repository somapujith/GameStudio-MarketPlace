// First-person viewmodel: the cook's own forearms and hands, attached to the camera (+x right, +y up, -z forward). Rolled shirt sleeves,
// a steel kada on the right wrist, a red thread on the left, a checked gamchha hanging off the left forearm. Every action holds the right
// tool from tools.js (through toolhost.js) and moves it believably; phase 0..1 drives an ease curve, hands blend back to the rest pose.
//
//   const vm = buildViewmodel(); camera.add(vm.group);
//   vm.setAction('tawa-flip', phase01); vm.setHands([{dish, q}]); vm.setLookDelta(dyaw, dpitch); vm.update(dt, t);
import {
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';
import { Hand, HAND_PRESETS, Limb, solveTwoBone } from './limbs.js';
import { cloneSkinMaterial, createSkinMaterial, SKIN_TONES } from './skin.js';
import { fabricMat } from './fabric.js';
import { disposeObject } from './util.js';
import { buildDish } from './dishes.js';
import { makeTool } from './toolhost.js';
import { TOOL_IDS } from './tools.js';
import { getCharacterDrawMode, getCharacterQuality, tierOf } from './charquality.js';
import { packPerson } from './pack.js';

export const VIEW_ACTIONS = ['tawa-oil', 'tawa-pour', 'tawa-spread', 'tawa-flip', 'tawa-fill', 'tawa-take', 'steamer', 'kadai', 'chai-pour', 'serve', 'collect', 'discard'];
export const ACTION_MS = 650;

const PI = Math.PI;
const TAU = PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const bump = (a, b, x) => sstep(a, (a + b) / 2, x) * (1 - sstep((a + b) / 2, b, x)); // 0 -> 1 -> 0 over [a, b]

// ---------------------------------------------------------------------------------------------------------------------
// Hand targets. mode: 0 free hand (wrist pos, finger dir, palm hint) | 1 power grip on a tool | 2 tray (plate, katori, box) | 3 upright (kettle, glass, bottle) | 4 pinch (note)
const mkT = () => ({ mode: 0, px: 0, py: 0, pz: 0, dx: 0, dy: 0, dz: -1, ux: 0, uy: 1, uz: 0, hand: 'relaxed', tool: null, roll: 0 });
const T0 = (t, mode, px, py, pz, dx, dy, dz, ux, uy, uz, hand, tool = null, roll = 0) => {
  t.mode = mode;
  t.px = px;
  t.py = py;
  t.pz = pz;
  t.dx = dx;
  t.dy = dy;
  t.dz = dz;
  t.ux = ux;
  t.uy = uy;
  t.uz = uz;
  t.hand = hand;
  t.tool = tool;
  t.roll = roll;
};
const REST_R = [0.2, -0.3, -0.4];
const REST_L = [-0.2, -0.3, -0.4];

/** Fill the right/left targets of an action at phase u (0..1). */
function actions(kind, u, R, L) {
  const e = sstep(0, 1, u);
  switch (kind) {
    case 'tawa-oil': {
      // the right hand wipes the tawa in circles with the oil-soaked onion fork, the left tips a little oil from the bottle
      const a = u * TAU * 2.2;
      const k = bump(0.02, 0.98, u);
      T0(R, 1, 0.04 + 0.075 * Math.cos(a) * k, -0.3 + 0.012 * Math.sin(a * 2), -0.6 + 0.05 * Math.sin(a) * k - 0.02 * (1 - k), 0.1, -0.28, -1, 0, 1, -0.1, 'grip', 'onion-fork');
      const tilt = bump(0.0, 0.5, u);
      T0(L, 3, -0.16 - 0.02 * tilt, -0.25 + 0.04 * tilt, -0.48, 0.1 - 0.7 * tilt, -0.5 * tilt - 0.1, -1, 0, 1, 0, 'grip', 'oil-bottle');
      break;
    }
    case 'tawa-pour': {
      // the ladle scoops, rises, tips and a ribbon of batter lands on the tawa
      const lift = sstep(0.0, 0.3, u) * (1 - sstep(0.75, 1, u));
      const tip = sstep(0.3, 0.55, u) * (1 - sstep(0.8, 1, u));
      T0(R, 1, lerp(0.2, 0.06, lift), lerp(-0.34, -0.2, lift) + 0.03 * Math.sin(u * 5), lerp(-0.4, -0.56, lift) - 0.07 * tip, 0.05, -0.3 - 0.65 * tip, -1, -0.2 * tip, 1, 0.3 * tip, 'grip', 'ladle');
      T0(L, 0, -0.2, -0.33, -0.46, 0.2, -0.1, -1, 1, 0.4, 0, 'flat');
      break;
    }
    case 'tawa-spread': {
      // the ladle base spreads the batter in an outward spiral
      const th = u * TAU * 2.1;
      const rr = lerp(0.012, 0.085, sstep(0.05, 0.95, u));
      T0(R, 1, 0.03 + rr * Math.cos(th), -0.3, -0.62 + rr * 0.8 * Math.sin(th), -Math.sin(th) * 0.15, -0.75, -1, 0, 1, 0, 'grip', 'ladle');
      T0(L, 0, -0.2, -0.33, -0.46, 0.2, -0.1, -1, 1, 0.4, 0, 'flat');
      break;
    }
    case 'tawa-flip': {
      // the spatula slides under the dosa, lifts and turns it over, lays it down
      const slide = sstep(0, 0.28, u);
      const lift = sstep(0.28, 0.5, u) * (1 - sstep(0.78, 0.95, u));
      const turn = sstep(0.4, 0.68, u);
      T0(R, 1, lerp(0.1, 0.03, slide), -0.31 + 0.15 * lift, -0.42 - 0.2 * slide + 0.04 * lift, 0, -0.22 + 0.5 * lift, -1, Math.sin(turn * PI) * 0.0, 1, 0, 'grip', 'spatula', turn * PI * 0.95);
      T0(L, 0, -0.2, -0.33, -0.46, 0.2, -0.1, -1, 1, 0.4, 0, 'flat');
      break;
    }
    case 'tawa-fill': {
      // a spoon of masala from the bowl onto the dosa, then the spatula folds it
      const spoon = bump(0, 0.55, u);
      const fold = sstep(0.55, 1, u);
      T0(R, 1, lerp(-0.06, 0.06, sstep(0.1, 0.45, u)) + 0.04 * fold, -0.26 + 0.05 * spoon - 0.02 * fold, lerp(-0.46, -0.62, sstep(0.1, 0.45, u)), 0.1, -0.4 - 0.2 * fold, -1, 0, 1, 0, 'grip', 'scraper', fold * 0.5);
      T0(L, 3, -0.14, -0.26, -0.44, 0.3, -0.1, -1, 0, 1, 0, 'grip', 'katori');
      L.mode = 2;
      break;
    }
    case 'tawa-take': {
      // slide the spatula under the dosa, lift it onto the plate held on the left
      const slide = sstep(0, 0.3, u);
      const carry = sstep(0.3, 0.75, u);
      const rel = sstep(0.75, 1, u);
      T0(R, 1, lerp(0.04, -0.12, carry), lerp(-0.32, -0.26, carry) + 0.1 * Math.sin(carry * PI), lerp(-0.46, -0.66, slide) + 0.2 * carry - 0.02 * rel, 0, -0.2 + 0.2 * carry, -1, 0, 1, 0, 'grip', 'spatula', carry * 0.15);
      T0(L, 2, -0.14, -0.3, -0.5, 0.1, 0, -1, 0, 1, 0, 'tray', 'plate');
      break;
    }
    case 'steamer': {
      // the left hand lifts the lid in a cloud of steam, the right taps the trays, then scoops the idlis out
      const lid = bump(0, 0.5, u);
      T0(L, 0, lerp(-0.1, -0.24, lid) , lerp(-0.2, 0.0, lid), lerp(-0.5, -0.44, lid), 0.4 * lid, 0.8 * lid + 0.1, -1 + 0.4 * lid, 1, -0.2, 0, lid > 0.5 ? 'grip' : 'open');
      const tap = sstep(0.1, 0.55, u) * (1 - sstep(0.55, 0.65, u));
      const scoop = sstep(0.55, 1, u);
      if (u < 0.55) T0(R, 0, 0.04, -0.2 + 0.015 * Math.sin(u * 60) * tap, -0.5, 0, -0.3, -1, -1, 0.2, 0, 'point');
      else T0(R, 1, lerp(0.04, 0.0, scoop), -0.22 + 0.08 * Math.sin(scoop * PI), -0.52 - 0.1 * Math.sin(scoop * PI), 0, -0.3 + 0.3 * scoop, -1, 0, 1, 0, 'grip', 'spatula');
      break;
    }
    case 'kadai': {
      // drop the batter in, swirl it and lift the golden fritters out with the jhara
      const drop = bump(0, 0.28, u);
      const sw = sstep(0.25, 0.62, u) * (1 - sstep(0.62, 0.7, u));
      const lift = sstep(0.62, 0.95, u);
      const a = (u - 0.25) * TAU * 3;
      if (u < 0.3) T0(R, 4, 0.03, -0.15 + 0.02 * drop, -0.56, 0, -0.35, -1, 0, 1, 0, 'pinch', null);
      else T0(R, 1, 0.03 + 0.05 * sw * Math.cos(a), -0.24 + 0.14 * lift, -0.58 + 0.04 * sw * Math.sin(a) + 0.1 * Math.sin(lift * PI) * 0, 0, -0.45 + 0.45 * lift, -1, 0, 1, 0, 'grip', 'jhara');
      T0(L, 0, -0.2, -0.32, -0.44, 0.2, -0.1, -1, 1, 0.4, 0, 'relaxed');
      break;
    }
    case 'chai-pour': {
      // the long Irani pour: the kettle is raised high and tipped over the glass held low, swinging between the two
      const up = sstep(0, 0.22, u) * (1 - sstep(0.82, 1, u));
      const pour = bump(0.15, 0.9, u);
      T0(R, 3, lerp(0.2, 0.1, up), lerp(-0.3, 0.0, up) + 0.03 * Math.sin(u * 16) * pour, lerp(-0.4, -0.5, up), -0.35 * up, -0.1 - 0.75 * pour, -1, 0, 1, 0, 'grip', 'chai-kettle');
      T0(L, 3, -0.1, -0.3 + 0.012 * Math.sin(u * 30) * pour, -0.52, 0.3, 0, -1, 0, 1, 0, 'grip', 'steel-glass');
      break;
    }
    case 'serve': {
      // slide the plate across the counter to the customer, then let go
      const s = sstep(0, 0.6, u);
      const rel = sstep(0.6, 0.85, u);
      const back = sstep(0.85, 1, u);
      const z = lerp(-0.42, -0.8, s) + 0.28 * back;
      T0(R, 2, lerp(0.12, 0.06, s), -0.31, z, -0.3, 0, -1, 0, 1, 0, rel > 0.3 ? 'flat' : 'tray', 'plate');
      T0(L, 2, lerp(-0.12, -0.06, s), -0.31, z + 0.0, 0.3, 0, -1, 0, 1, 0, rel > 0.3 ? 'flat' : 'tray', 'plate');
      R.tool = L.tool = rel > 0.3 ? null : 'plate';
      L.tool = null; // one plate between the two hands: the right carries it, the left steadies
      break;
    }
    case 'collect': {
      // take the note from the customer's hand, tuck it into the money box held on the left
      const take = sstep(0, 0.35, u);
      const tuck = sstep(0.4, 0.78, u);
      const lift = Math.sin(take * PI);
      T0(R, 4, lerp(0.14, -0.1, tuck) + 0.0, lerp(-0.2, -0.28, tuck) + 0.04 * lift, lerp(-0.72, -0.46, Math.max(take, tuck) * 1) + 0.0, lerp(0, -0.9, tuck), -0.2 * tuck - 0.05, -1 + 0.3 * tuck, 0, 1, 0, 'pinch', u < 0.82 ? 'note' : null);
      T0(L, 2, -0.17, -0.33, -0.44, 0.3, 0, -1, 0, 1, 0, 'tray', 'money-box');
      break;
    }
    case 'discard': {
      // carry the burnt dish over to the bin on the right and tip it
      const mv = sstep(0, 0.4, u);
      const tip = sstep(0.4, 0.72, u) * (1 - sstep(0.85, 1, u));
      T0(R, 2, lerp(0.2, 0.34, mv), lerp(-0.3, -0.22, mv) + 0.03 * tip, lerp(-0.42, -0.5, mv), 0, 0, -1, 0, 1, 0, 'tray', 'plate', tip * 2.3);
      T0(L, 0, -0.18, -0.32, -0.42, 0.2, -0.1, -1, 1, 0.4, 0, 'relaxed');
      break;
    }
    default:
  }
  void e;
}

// ---------------------------------------------------------------------------------------------------------------------
const _q = new Quaternion();
const _q2 = new Quaternion();
const _m = new Matrix4();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _w = new Vector3();
const _g = new Vector3();
const _elb = new Vector3();
const _pole = new Vector3();
const _sh = new Vector3();
const _roll = new Quaternion();
const _hx = new Vector3();
const _hy = new Vector3();
const _hz = new Vector3();
const AXZ = new Vector3(0, 0, -1);

/** Grip frames in hand-group coordinates: [X, Y, Z] columns of the tool, grip point. `side` +1 right hand (unmirrored thumb +x), -1 left. */
function gripFrame(mode, side, out) {
  const s2 = 0.70710678;
  if (mode === 1) {
    // diagonal power grip: the working end leaves the fist forward and to the thumb side, the tool's up is the back of the hand
    out.X.set(-s2, s2 * side, 0);
    out.Y.set(0, 0, -1);
    out.Z.set(-s2 * side, -s2, 0);
    out.p.set(0, 0.052, 0.014);
  } else if (mode === 3) {
    // upright (kettle, glass, bottle): the vessel stands along the hand's thumb axis, the spout leads forward
    out.Y.set(side, 0, 0);
    out.Z.set(0, -1, 0);
    out.X.crossVectors(out.Y, out.Z);
    out.p.set(0, 0.05, 0.016);
  } else if (mode === 4) {
    // pinch: the note lies flat between thumb and index tips
    out.Y.set(0, 0, 1);
    out.Z.set(0, -1, 0);
    out.X.crossVectors(out.Y, out.Z);
    out.p.set(0.012, 0.1, 0.005);
  } else {
    // tray: plate or box lies flat on the open fingers
    out.Y.set(0, 0, 1);
    out.Z.set(0, -1, 0);
    out.X.crossVectors(out.Y, out.Z);
    out.p.set(0, 0.07, 0.02);
  }
  return out;
}
const GF = { X: new Vector3(), Y: new Vector3(), Z: new Vector3(), p: new Vector3() };

/** Resolve a hand target to a wrist position and orientation (hand group frame: +y fingers, +z palm, +x thumb for the right hand). */
function solveHand(t, side, scale, outPos, outQuat) {
  if (t.mode === 0) {
    _a.set(t.dx, t.dy, t.dz).normalize();
    _b.set(t.ux, t.uy, t.uz);
    _b.addScaledVector(_a, -_b.dot(_a)).normalize();
    _c.crossVectors(_a, _b);
    _m.makeBasis(_c, _a, _b);
    outQuat.setFromRotationMatrix(_m);
    outPos.set(t.px, t.py, t.pz);
    return;
  }
  gripFrame(t.mode, side, GF);
  // tool frame in the world: Z = -dir, Y = up (orthogonalised), X = Y x Z
  _a.set(t.dx, t.dy, t.dz).normalize().negate(); // Z
  _b.set(t.ux, t.uy, t.uz);
  _b.addScaledVector(_a, -_b.dot(_a)).normalize(); // Y
  _c.crossVectors(_b, _a); // X
  if (t.roll) {
    // roll about the tool axis (turns the dosa, tips the plate)
    _roll.setFromAxisAngle(_w.copy(_a).negate(), t.roll * side);
    _b.applyQuaternion(_roll);
    _c.applyQuaternion(_roll);
  }
  // H = M * G^T : hand axes in the world are the tool axes combined with the grip frame's transpose
  // hand x axis (world) = X*GX.x + Y*GY.x + Z*GZ.x etc.
  _hx.set(0, 0, 0).addScaledVector(_c, GF.X.x).addScaledVector(_b, GF.Y.x).addScaledVector(_a, GF.Z.x);
  _hy.set(0, 0, 0).addScaledVector(_c, GF.X.y).addScaledVector(_b, GF.Y.y).addScaledVector(_a, GF.Z.y);
  _hz.set(0, 0, 0).addScaledVector(_c, GF.X.z).addScaledVector(_b, GF.Y.z).addScaledVector(_a, GF.Z.z);
  _m.makeBasis(_hx, _hy, _hz);
  outQuat.setFromRotationMatrix(_m);
  // wrist = grip point - H * gripLocal
  _g.copy(GF.p).multiplyScalar(scale).applyQuaternion(outQuat);
  outPos.set(t.px, t.py, t.pz).sub(_g);
}

// ---------------------------------------------------------------------------------------------------------------------
/** buildViewmodel({ quality }) -> { group, setAction, setHands, setLookDelta, update, dispose, triangles } */
export function buildViewmodel(opts = {}) {
  const tier = tierOf(opts.quality || getCharacterQuality());
  const group = new Group();
  group.name = 'viewmodel';
  const rig = new Group(); // sways with the head
  group.add(rig);
  const K = 1.12; // first-person arms are a little bigger than life
  const tone = opts.tone || SKIN_TONES[2];
  const base = createSkinMaterial({ tone, age: 0.2, quality: tier.id });
  const skin = cloneSkinMaterial(base, null, { body: true });
  const handMat = cloneSkinMaterial(base, null, { body: true });
  const shirt = fabricMat({ color: '#e9e4d6', color2: '#cfc8b4', pattern: 'stripe', quality: tier.id });
  const arms = [];
  const l1 = 0.3 * K;
  const l2 = 0.26 * K;
  for (const side of [1, -1]) {
    // side +1 = the player's right (+x in camera space)
    const limb = new Limb(14);
    const prof = [
      [0, 0.052, 0.05],
      [0.3, 0.046, 0.044],
      [0.52, 0.039, 0.037],
      [0.62, 0.0385, 0.037],
      [0.82, 0.0315, 0.029],
      [1, 0.025, 0.022],
    ];
    const rad = (s) => {
      let i = 0;
      while (i < prof.length - 2 && s > prof[i + 1][0]) i++;
      const a = prof[i];
      const b = prof[i + 1];
      const t = clamp((s - a[0]) / (b[0] - a[0]), 0, 1);
      return [lerp(a[1], b[1], t) * K * 0.93, lerp(a[2], b[2], t) * K * 0.93];
    };
    limb.addLayer({ s0: 0, s1: 1, rings: 12, sides: tier.id === 'low' ? 8 : 12, material: skin, name: 'forearm', uv: [2, 3], rad });
    // rolled sleeve: the upper arm in cloth and a thick rolled cuff
    limb.addLayer({ s0: 0, s1: 0.5, rings: 6, sides: 12, material: shirt, name: 'sleeve', uv: [3, 2], rad: (s) => [rad(s)[0] + 0.011, rad(s)[1] + 0.011], fold: (s, phi) => 0.002 * Math.sin(phi * 4 + s * 18) });
    limb.addLayer({ s0: 0.47, s1: 0.55, rings: 3, sides: 12, material: shirt, name: 'cuff', uv: [3, 1], caps: [true, true], rad: (s) => [rad(s)[0] * 1.2 + 0.014, rad(s)[1] * 1.2 + 0.014], fold: (s, phi) => 0.003 * Math.sin(phi * 6) });
    rig.add(limb.group);
    const hand = new Hand({ side, scale: K * 1.06, material: handMat, quality: tier.id });
    rig.add(hand.group);
    // jewellery: a steel kada on the right wrist, a red thread on the left
    const jm = new MeshStandardMaterial({ color: side > 0 ? '#c9d1d6' : '#c0201f', roughness: side > 0 ? 0.25 : 0.9, metalness: side > 0 ? 1 : 0 });
    const ring = new Mesh(new TorusGeometry(0.029 * K, side > 0 ? 0.0048 : 0.0026, 5, 18), jm);
    ring.rotation.x = PI / 2;
    ring.position.y = 0.012 * K;
    hand.group.add(ring);
    if (side > 0) {
      const ring2 = new Mesh(new TorusGeometry(0.0285 * K, 0.0026, 4, 14), new MeshStandardMaterial({ color: '#c0201f', roughness: 0.9 }));
      ring2.rotation.x = PI / 2;
      ring2.position.y = -0.006 * K;
      hand.group.add(ring2);
    }
    arms.push({ side, limb, hand, tools: new Map(), toolList: [], curl: new Float32Array(5), spread: 0.1, pos: new Vector3(), quat: new Quaternion(), pos2: new Vector3(), quat2: new Quaternion(), shoulder: new Vector3(side * 0.2 * K, -0.22 * K, 0.1 * K), active: null });
  }

  // the gamchha: a checked cotton cloth hanging off the left wrist
  const gam = fabricMat({ color: '#c0392b', color2: '#f3ede0', pattern: 'gamchha', quality: tier.id });
  const cloth = new Mesh(new PlaneGeometry(0.15, 0.34, 3, 6).translate(0, -0.17, 0), gam);
  cloth.frustumCulled = false;
  rig.add(cloth); // hangs straight down in camera space from the left wrist
  const clothPos = cloth.geometry.attributes.position;
  const clothRest = new Float32Array(clothPos.array);

  // carried dishes (idle pose and serving)
  const holders = [new Group(), new Group()];
  for (let i = 0; i < 2; i++) {
    holders[i].rotation.x = PI / 2;
    holders[i].position.set(0, 0.06 * K, 0.04 * K);
    holders[i].scale.setScalar(0.62 * K);
    arms[i].hand.grip.add(holders[i]);
  }
  let handsKey = '';
  let handCount = 0;

  const TR = mkT();
  const TL = mkT();
  const IR = mkT();
  const IL = mkT();
  let kind = null;
  let phase = 0;
  let autoT = -1;
  let actW = 0;
  let swayYaw = 0;
  let swayPitch = 0;
  let lastDyaw = 0;
  let lastDpitch = 0;
  let disposed = false;

  const getTool = (arm, id) => {
    let t = arm.tools.get(id);
    if (!t) {
      t = makeTool(id, id === 'steel-glass' ? { fill: 0.8, drink: 'chai' } : id === 'note' ? { value: 100 } : undefined);
      t.group.visible = false;
      arm.hand.grip.add(t.group);
      arm.tools.set(id, t);
      arm.toolList.push({ id, t });
    }
    return t;
  };

  const orient = (arm, target, idle, out) => {
    // fills arm.pos / arm.quat blended between idle and the action target
    solveHand(idle, arm.side, K, arm.pos2, arm.quat2);
    solveHand(target, arm.side, K, arm.pos, arm.quat);
    out.pos.copy(arm.pos2).lerp(arm.pos, actW);
    out.quat.copy(arm.quat2).slerp(arm.quat, actW);
  };
  const OUT = { pos: new Vector3(), quat: new Quaternion() };

  const api = {
    group,
    get action() {
      return kind;
    },
    /** Builds every tool once, hidden in the right hand: their materials and shader programs exist before the first action (no compile mid-shift). */
    warmTools(ids = TOOL_IDS) {
      for (const id of ids) {
        try {
          getTool(arms[0], id);
        } catch {
          /* a tool that cannot be built is not worth a failed load */
        }
      }
    },
    /** kind: one of VIEW_ACTIONS or null (hands return to rest); phase01 drives the animation (undefined: it runs on its own for 0.65 s). */
    setAction(k, p) {
      const next = VIEW_ACTIONS.includes(k) ? k : null;
      if (next !== kind) autoT = typeof p === 'number' ? -1 : 0;
      kind = next;
      if (typeof p === 'number' && Number.isFinite(p)) {
        phase = clamp(p, 0, 1);
        autoT = -1;
      } else if (next && autoT < 0) autoT = 0;
    },
    /** dishes: [{ dish, q }] carried in the hands while no action runs (and slid across the counter by 'serve'). */
    setHands(dishes) {
      const list = Array.isArray(dishes) ? dishes.slice(0, 2) : [];
      const key = list.map((d) => `${d && d.dish}:${d && d.q}`).join('|');
      if (key === handsKey) return;
      handsKey = key;
      handCount = list.length;
      for (let i = 0; i < 2; i++) {
        const h = holders[i];
        while (h.children.length) disposeObject(h.children[h.children.length - 1]);
        const d = list[i];
        if (d && d.dish) {
          try {
            h.add(buildDish(d.dish, d.q || 'good'));
          } catch {
            /* a missing dish model must not break the hands */
          }
        }
      }
    },
    /** Subtle sway: the hands lag a little behind a head turn. dyaw/dpitch in radians since the last frame. */
    setLookDelta(dyaw, dpitch) {
      lastDyaw = Number.isFinite(dyaw) ? dyaw : 0;
      lastDpitch = Number.isFinite(dpitch) ? dpitch : 0;
    },
    update(dt, t) {
      if (disposed) return;
      const d = clamp(Number.isFinite(dt) ? dt : 0.016, 0, 0.1);
      const tt = Number.isFinite(t) ? t : 0;
      if (kind && autoT >= 0) {
        autoT += d;
        phase = clamp(autoT / (ACTION_MS / 1000), 0, 1);
        if (autoT > ACTION_MS / 1000 + 0.05) {
          kind = null;
          autoT = -1;
        }
      }
      actW += ((kind ? 1 : 0) - actW) * (1 - Math.exp(-(kind ? 16 : 9) * d));
      // head-turn sway
      swayYaw += (lastDyaw * 4 - swayYaw) * (1 - Math.exp(-9 * d));
      swayPitch += (lastDpitch * 4 - swayPitch) * (1 - Math.exp(-9 * d));
      lastDyaw *= 0.5;
      lastDpitch *= 0.5;
      const sy = clamp(swayYaw, -0.25, 0.25);
      const sp = clamp(swayPitch, -0.2, 0.2);
      rig.position.set(-sy * 0.09 + 0.004 * Math.sin(tt * 1.3), sp * 0.06 + 0.003 * Math.sin(tt * 1.7 + 1), 0);
      rig.rotation.set(sp * 0.25, sy * 0.25, 0);

      // idle: hands rest on the counter edge, or hold the carried plates
      const carrying = handCount > 0;
      const bob = 0.004 * Math.sin(tt * 1.8);
      if (carrying) {
        T0(IR, 2, REST_R[0] - 0.03, REST_R[1] + bob + 0.02, REST_R[2], -0.1, 0.1, -1, 0, 1, 0, 'tray');
        T0(IL, 2, REST_L[0] + 0.03, REST_L[1] - bob + 0.02, REST_L[2], 0.1, 0.1, -1, 0, 1, 0, 'tray');
      } else {
        T0(IR, 0, REST_R[0], REST_R[1] + bob, REST_R[2], -0.15, -0.2, -1, -1, 0.2, 0, 'relaxed');
        T0(IL, 0, REST_L[0], REST_L[1] - bob, REST_L[2], 0.15, -0.2, -1, 1, 0.2, 0, 'relaxed');
      }
      IR.tool = IL.tool = null;
      if (kind) actions(kind, phase, TR, TL);
      else {
        TR.mode = IR.mode;
        TL.mode = IL.mode;
      }
      for (let i = 0; i < 2; i++) {
        const A = arms[i];
        const tg = kind ? (i === 0 ? TR : TL) : i === 0 ? IR : IL;
        const id0 = i === 0 ? IR : IL;
        orient(A, tg, id0, OUT);
        // curls follow the target's hand preset
        const pr = HAND_PRESETS[(actW > 0.5 ? tg : id0).hand] || HAND_PRESETS.relaxed;
        const kc = 1 - Math.exp(-18 * d);
        for (let f = 0; f < 4; f++) A.curl[f] += (pr.curl[f] - A.curl[f]) * kc;
        A.curl[4] += (pr.thumb - A.curl[4]) * kc;
        A.spread += (pr.spread - A.spread) * kc;
        A.hand.setCurls(A.curl[0], A.curl[1], A.curl[2], A.curl[3], A.curl[4], A.spread);
        A.hand.group.position.copy(OUT.pos);
        A.hand.group.quaternion.copy(OUT.quat);
        A.hand.group.updateMatrix();
        // arm IK from the shoulder to the wrist
        _sh.copy(A.shoulder);
        _w.copy(OUT.pos);
        _pole.set(A.side * 0.5, -1, 0.35);
        solveTwoBone(_sh, _w, l1, l2, _pole, _elb);
        A.limb.setPath(_sh, _elb, _w, _a.set(A.side * 0.4, 0.2, 1));
        A.limb.update();
        // tool in hand
        const want = actW > 0.35 && kind ? tg.tool : null;
        for (let q = 0; q < A.toolList.length; q++) A.toolList[q].t.group.visible = A.toolList[q].id === want;
        if (want) {
          const tl = getTool(A, want);
          tl.group.visible = true;
          gripFrame(tg.mode, A.side, GF);
          _m.makeBasis(GF.X, GF.Y, GF.Z);
          tl.group.quaternion.setFromRotationMatrix(_m);
          tl.group.position.copy(GF.p).multiplyScalar(K).sub(A.hand.grip.position);
          tl.group.scale.setScalar(K * 0.95);
        }
      }
      // carried dishes show while idle (and during serve)
      const showDishes = carrying && (!kind || kind === 'serve');
      for (let i = 0; i < 2; i++) holders[i].visible = showDishes && holders[i].children.length > 0;
      // the gamchha swings with the left hand
      const wave = Math.sin(tt * 2.1) * 0.012 + arms[1].hand.group.quaternion.x * 0.02;
      for (let i = 0; i < clothPos.count; i++) {
        const y = clothRest[i * 3 + 1];
        const k2 = Math.min(1, -y / 0.34);
        clothPos.setXYZ(i, clothRest[i * 3] + wave * k2 * 3 + 0.01 * Math.sin(y * 30 + tt * 2.4) * k2, y, clothRest[i * 3 + 2] + 0.02 * Math.sin(y * 24 + tt * 1.7) * k2);
      }
      clothPos.needsUpdate = true; // (normals stay flat: computeVertexNormals would allocate every frame)
      cloth.position.copy(arms[1].hand.group.position);
      cloth.position.y += 0.02;
      cloth.position.z += 0.035;
      cloth.position.x += 0.045;
      api.pack?.update(); // the packed arms follow the IK (models/pack.js)
    },
    /** Triangles of the cook's own arms, hands and cloth (tools and carried dishes excluded). */
    get triangles() {
      const c = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
      let n = c(cloth.geometry);
      for (const A of arms) {
        n += c(A.hand.geometry);
        for (const L of A.limb.layers) n += c(L.geometry);
      }
      return Math.round(n + 120);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      api.pack?.dispose();
      for (const A of arms) for (const e of A.toolList) e.t.dispose?.();
      disposeObject(group);
    },
  };
  void Color;
  void Object3D;
  void AXZ;
  // settle into the rest pose
  actW = 0;
  api.update(0.016, 0);
  // the arms, hands, sleeves and jewellery are a handful of dynamic meshes (models/pack.js); the camera-space group is always in front of the eye: never culled
  if (getCharacterDrawMode().pack) api.pack = packPerson(group, { noCull: true });
  return api;
}
