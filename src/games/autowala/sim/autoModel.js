// The auto-rickshaw (and the little people who ride and drive it). Smooth low-poly, lacquered paint, glowing lamps.
// Faces +z. Returns a group with handles in userData so the simulation can animate wheels, steering and lights, and so the
// customisation system (sim/customize.js, which OWNS the look of every catalogue item) can reach every part by name.
// PERFORMANCE: all static parts of the auto are merged by material into a handful of meshes (the merged geometry is built once per
// level of detail and shared by every auto), small parts are plain boxes, wheels are 8-12 sided. Budget: traffic auto <= ~1.5k
// triangles, the player's rig <= ~9k with every option fitted (see auto-budget.test.js).
// OWNER: customisation agent.
import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  SpotLight,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DEFAULT_LOADOUT } from '../gameplay/catalog.js';
import { applyLoadout } from './customize.js';

const mat = (color, o = {}) => new MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2, ...o });

const SKIN = ['#8d5a3c', '#a86e4a', '#c08a62', '#6f4430', '#d6a37c'];
const SHIRTS = ['#e8453c', '#2d7be8', '#f2c230', '#2fb572', '#a05cf0', '#f07ab0', '#ffffff', '#ff8a3d', '#2ec4b6'];

// ------------------------------------------------------------------------------------------------------------ batching

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _one = new Vector3(1, 1, 1);

/** Bake a transform into a (freshly made, unshared) geometry. */
function place(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _m.compose(_p, _q, _one);
  geo.applyMatrix4(_m);
  return geo;
}

/** Collects geometries under a key (a slot name or a material) and merges each key into ONE geometry. */
class Batch {
  constructor() {
    this.lists = new Map();
  }

  add(key, geometry, x, y, z, rx, ry, rz) {
    // (RoundedBoxGeometry is non-indexed, the rest are indexed: merge everything as non-indexed)
    let geo = geometry;
    if (geo.index) {
      geo = geo.toNonIndexed();
      geometry.dispose();
    }
    place(geo, x, y, z, rx, ry, rz);
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(geo);
  }

  /** key -> merged BufferGeometry */
  merge() {
    const out = new Map();
    for (const [key, list] of this.lists) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!g) throw new Error(`autoModel: could not merge the geometries of "${String(key?.name || key)}" (mismatched attributes)`);
      if (list.length > 1) for (const l of list) l.dispose();
      out.set(key, g);
    }
    this.lists.clear();
    return out;
  }
}

const mesh = (parent, geo, m, { cast = true, receive = false } = {}) => {
  const o = new Mesh(geo, m);
  o.castShadow = cast;
  o.receiveShadow = receive;
  parent.add(o);
  return o;
};

// ------------------------------------------------------------------------------------------------------------ people

/**
 * A seated or standing person. `pose`: 'drive' | 'sit' | 'stand'. Default: separate limb meshes (the customers animate them).
 * `merged: true` bakes the whole person into one mesh per material (use it for the driver and passengers, which never animate limbs);
 * `low: true` uses the cheapest geometry (traffic drivers).
 */
export function buildPerson({ shirt = '#e8453c', skin = '#a86e4a', hair = '#1b1220', cap = null, pose = 'stand', scale = 1, female = false, merged = false, low = false } = {}) {
  const g = new Group();
  const body = mat(shirt, { roughness: 0.7, metalness: 0 });
  const skinM = mat(skin, { roughness: 0.8, metalness: 0 });
  const legM = mat(female ? '#3a2a5a' : '#2a3350', { roughness: 0.8, metalness: 0 });
  const hairMat = mat(hair, { roughness: 0.9, metalness: 0 });
  const capMat = cap ? (low ? hairMat : mat(cap, { roughness: 0.8, metalness: 0 })) : null;
  const cs = low ? 1 : 2;
  const rs = low ? 5 : 6;
  const torsoGeo = () => new CapsuleGeometry(0.2, 0.34, cs, low ? 6 : 8);
  const headGeo = () => new SphereGeometry(0.16, low ? 6 : 8, low ? 4 : 6);
  const hairGeo = () => new SphereGeometry(0.17, low ? 6 : 8, low ? 3 : 4, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const armGeo = () => new CapsuleGeometry(0.06, 0.34, cs, rs);
  const legGeo = () => new CapsuleGeometry(0.085, 0.4, cs, rs);
  const yBase = pose === 'stand' ? 0.55 : 0.32;
  // [geometry, material, x, y, z, rx, rz] for each part, built from the pose
  const parts = {
    torso: [torsoGeo(), body, 0, yBase + 0.42, 0, 0, 0],
    head: [headGeo(), skinM, 0, yBase + 0.92, 0, 0, 0],
    hair: [hairGeo(), hairMat, 0, yBase + 0.95, -0.01, 0, 0],
    lArm: [armGeo(), skinM, -0.27, yBase + 0.46, 0.06, 0, 0],
    rArm: [armGeo(), skinM, 0.27, yBase + 0.46, 0.06, 0, 0],
    lLeg: [legGeo(), legM, 0, 0, 0, 0, 0],
    rLeg: [legGeo(), legM, 0, 0, 0, 0, 0],
  };
  if (pose === 'drive') {
    parts.lArm[5] = parts.rArm[5] = -1.1;
    parts.lArm[4] = parts.rArm[4] = 0.24;
    Object.assign(parts.lLeg, { 2: -0.13, 3: yBase + 0.12, 4: 0.26, 5: -1.35 });
    Object.assign(parts.rLeg, { 2: 0.13, 3: yBase + 0.12, 4: 0.26, 5: -1.35 });
  } else if (pose === 'sit') {
    parts.lArm[5] = parts.rArm[5] = -0.35;
    Object.assign(parts.lLeg, { 2: -0.13, 3: yBase + 0.1, 4: 0.28, 5: -1.4 });
    Object.assign(parts.rLeg, { 2: 0.13, 3: yBase + 0.1, 4: 0.28, 5: -1.4 });
  } else {
    Object.assign(parts.lLeg, { 2: -0.11, 3: 0.34, 4: 0 });
    Object.assign(parts.rLeg, { 2: 0.11, 3: 0.34, 4: 0 });
  }
  const capG = cap ? new SphereGeometry(0.185, low ? 6 : 8, low ? 3 : 4, 0, Math.PI * 2, 0, Math.PI * 0.5) : null;
  const userData = {};
  if (merged) {
    const b = new Batch();
    for (const [, p] of Object.entries(parts)) b.add(p[1], p[0], p[2], p[3], p[4], p[5], 0, 0);
    if (capG) b.add(capMat, capG, 0, yBase + 0.98, 0.01, 0, 0, 0);
    for (const [m, geo] of b.merge()) mesh(g, geo, m);
  } else {
    for (const [name, p] of Object.entries(parts)) {
      const o = mesh(g, p[0], p[1]);
      o.position.set(p[2], p[3], p[4]);
      o.rotation.x = p[5];
      userData[name] = o;
    }
    if (capG) mesh(g, capG, capMat).position.set(0, yBase + 0.98, 0.01);
  }
  g.scale.setScalar(scale);
  userData.mats = { shirt: body, skin: skinM, hair: hairMat, legs: legM }; // recolour with mats.shirt.color.set(...) (works merged or not)
  g.userData = userData;
  return g;
}

export const randomLook = (rng) => ({ shirt: rng.pick(SHIRTS), skin: rng.pick(SKIN), female: rng.chance(0.4), hair: rng.pick(['#1b1220', '#2a1a12', '#3a2a22']) });

// ------------------------------------------------------------------------------------------------------------ the auto's geometry

const GEO = {};

/**
 * The static geometry of the auto, merged into one BufferGeometry per slot (a slot = one material on one parent group).
 * `hi` is the player's rig (rounder, with trim, plates mounts, rimmed wheels); otherwise the cheap traffic auto. Cached per level.
 */
function geometries(hi) {
  const key = hi ? 'hi' : 'lo';
  if (GEO[key]) return GEO[key];
  const B = new Batch();
  const add = (slot, geo, ...t) => B.add(slot, geo, ...t);
  const box = (w, h, d) => new BoxGeometry(w, h, d);
  const big = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, hi ? 2 : 1, r);
  const soft = (w, h, d, r) => (hi ? new RoundedBoxGeometry(w, h, d, 1, r) : new BoxGeometry(w, h, d));
  const arch = (radius, width) => {
    const geo = new CylinderGeometry(radius, radius, width, hi ? 12 : 8, 1, true, -0.3, Math.PI + 0.6);
    geo.rotateZ(Math.PI / 2);
    return geo;
  };

  // ---- body group
  add('dark', box(1.42, 0.2, 2.6), 0, 0.42, -0.2); // chassis (closes the underside)
  add('paint', big(1.5, 0.64, 2.02, 0.12), 0, 0.76, -0.46); // passenger tub
  add('paint', big(1.22, 0.86, 0.95, 0.22), 0, 0.94, 0.78); // hood nose
  add('paint', soft(1.0, 0.18, 0.7, 0.07), 0, 1.43, 0.62, -0.1); // dash
  add('paint', box(0.98, 0.5, 0.05), 0, 0.81, -1.465); // engine cover door
  add('paint', arch(0.4, 0.3), 0, 0.34, 1.28); // round front mudguard
  for (const s of [-1, 1]) add('paint', arch(0.41, 0.3), s * 0.78, 0.34, -0.82); // rear arches
  add('chrome', new CylinderGeometry(0.03, 0.03, 0.8, 6), 0, 1.44, 0.72, 0, 0, Math.PI / 2); // handlebar
  add('chrome', new CylinderGeometry(0.05, 0.05, 0.4, 6), -0.68, 0.45, -1.55, Math.PI / 2, 0, 0); // exhaust
  add('dark', box(0.16, 0.14, 0.1), 0.22, 1.55, 0.7); // meter
  add('seat', soft(1.2, 0.2, 0.55, 0.07), 0, 1.02, -0.95);
  add('seat', soft(1.2, 0.5, 0.14, 0.06), 0, 1.37, -1.3);
  add('seat', soft(0.62, 0.18, 0.5, 0.06), 0, 1.0, 0.12);
  add('brake', box(0.5, 0.03, 0.012), 0, 1.1, -1.486);
  add('dark', box(0.3, 0.36, 0.025), 0.78, 0.3, -1.26); // rubber flaps behind the rear wheels
  add('dark', box(0.3, 0.36, 0.025), -0.78, 0.3, -1.26);
  add('hlLamp', new SphereGeometry(0.15, hi ? 10 : 6, hi ? 8 : 4), 0, 1.0, 1.26);
  if (hi) add('fork', new CylinderGeometry(0.03, 0.03, 0.62, 6), 0, 0.7, 1.28);
  add('posts', new CylinderGeometry(0.035, 0.035, 0.78, 6), -0.62, 0, 0.5, 0.18, 0, 0); // built about y = 1.64 so the canopy can stretch them
  add('posts', new CylinderGeometry(0.035, 0.035, 0.78, 6), 0.62, 0, 0.5, 0.18, 0, 0);
  if (hi) {
    for (const s of [-1, 1]) {
      add('chrome', box(0.012, 0.014, 1.9), s * 0.753, 1.0, -0.46); // pinstripes
      add('chrome', box(0.012, 0.014, 1.9), s * 0.753, 1.04, -0.46);
      add('chrome', box(0.22, 0.2, 0.07), s * 0.585, 0.78, -1.5); // tail-light housings
      add('tailLens', box(0.16, 0.14, 0.03), s * 0.585, 0.78, -1.5345);
      add('tailRef', box(0.07, 0.05, 0.01), s * 0.585, 0.78, -1.5515);
    }
    add('chrome', box(1.4, 0.014, 0.012), 0, 1.075, -1.474);
    add('chrome', new CylinderGeometry(0.155, 0.155, 0.04, 12, 1, true), 0, 1.0, 1.3, Math.PI / 2, 0, 0); // headlamp bezel
  } else {
    for (const s of [-1, 1]) add('tailLens', box(0.16, 0.12, 0.05), s * 0.55, 0.92, -1.42);
    add('chrome', box(1.5, 0.1, 0.1), 0, 0.5, -1.58); // traffic bumper
    for (const y of [0.99, 0.6]) add('dark', box(0.8, y > 0.9 ? 0.09 : 0.06, 0.01), 0, y, -1.4925);
  }

  // ---- upper rear (roof colour) and window surrounds
  add('upper', box(1.5, 0.95, 0.12), 0, 1.525, -1.42);
  for (const s of [-1, 1]) add('upper', box(0.2, 0.95, 0.5), s * 0.65, 1.525, -1.22);
  if (hi) {
    add('seal', box(0.86, 0.54, 0.014), 0, 1.58, -1.4855);
    for (const s of [-1, 1]) {
      add('seal', box(0.24, 0.44, 0.014), s * 0.545, 1.58, -1.4855);
      add('paneSides', new PlaneGeometry(0.2, 0.4), s * 0.545, 1.58, -1.4965, 0, Math.PI, 0);
    }
  } else {
    add('dark', new PlaneGeometry(0.8, 0.48), 0, 1.58, -1.4965, 0, Math.PI, 0);
    for (const s of [-1, 1]) add('dark', new PlaneGeometry(0.2, 0.4), s * 0.545, 1.58, -1.4965, 0, Math.PI, 0);
  }

  // ---- roof group: the dome that overhangs the rear, edge pinstripe, rolled canvas curtains
  add('roof', big(1.74, 0.16, 2.5, 0.08), 0, 2.0, -0.37);
  add('roof', soft(1.5, 0.1, 1.95, 0.05), 0, 2.12, -0.2);
  add('roof', box(1.5, 0.14, 0.36), 0, 1.98, 0.98, -0.12, 0, 0);
  if (hi) {
    add('roofTrim', box(1.76, 0.014, 0.014), 0, 1.935, -1.622);
    for (const s of [-1, 1]) add('roofTrim', box(0.014, 0.014, 2.5), s * 0.872, 1.935, -0.37);
  }
  for (const s of [-1, 1]) {
    if (hi) add('curtains', new CylinderGeometry(0.055, 0.055, 1.4, 8), s * 0.74, 1.91, -0.25, Math.PI / 2, 0, 0); // the roll
    add('curtains', box(0.035, 0.46, 1.36), s * 0.745, 1.66, -0.25); // the half-lowered flap
  }

  // ---- wheels (centred, axis along x)
  add('tyre', new CylinderGeometry(0.34, 0.34, 0.2, hi ? 12 : 8), 0, 0, 0, 0, 0, Math.PI / 2);
  if (hi) {
    add('rim', new CylinderGeometry(0.235, 0.235, 0.214, 12), 0, 0, 0, 0, 0, Math.PI / 2);
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) add('spokes', box(0.012, 0.04, 0.44), sx * 0.1132, 0, 0, (k * Math.PI) / 3, 0, 0);
    for (const sx of [-1, 1]) add('whites', new RingGeometry(0.24, 0.318, 16), sx * 0.1035, 0, 0, 0, sx * (Math.PI / 2), 0);
  }

  // ---- decorations that only exist on the player's rig
  if (hi) {
    const col = new Color();
    for (let i = -3; i <= 3; i++) {
      const g = new SphereGeometry(0.06, 5, 4);
      const c = col.set(['#ff8a2d', '#ffc400', '#ff4d6d'][Math.abs(i) % 3]);
      const arr = new Float32Array(g.attributes.position.count * 3);
      for (let k = 0; k < arr.length; k += 3) {
        arr[k] = c.r;
        arr[k + 1] = c.g;
        arr[k + 2] = c.b;
      }
      g.setAttribute('color', new Float32BufferAttribute(arr, 3));
      add('beads', g, i * 0.1, 1.5 - Math.abs(i) * 0.02, 0.84);
    }
    add('flapDecal', new PlaneGeometry(0.27, 0.32), 0.78, 0.3, -1.2745, 0, Math.PI, 0);
    add('flapDecal', new PlaneGeometry(0.27, 0.32), -0.78, 0.3, -1.2745, 0, Math.PI, 0);
  }

  const merged = {};
  for (const [slot, g] of B.merge()) merged[slot] = g;
  GEO[key] = merged;
  return merged;
}

/** The merged static geometry per slot for a level of detail (true = the player's rig). Exposed for the budget / merge tests. */
export const autoGeometries = geometries;

// materials that never change for traffic autos are shared between all of them
let SHARED = null;
function sharedMaterials() {
  if (SHARED) return SHARED;
  SHARED = {
    chrome: mat('#d8dae8', { roughness: 0.15, metalness: 0.9 }),
    rubber: mat('#15131a', { roughness: 0.9, metalness: 0 }),
    dark: mat('#14151c', { roughness: 0.7, metalness: 0.2 }),
    chassis: mat('#16202b', { roughness: 0.6, metalness: 0.3 }),
    roof: mat('#241f2c', { roughness: 0.36, metalness: 0.08 }),
    seat: mat('#a13a2c', { roughness: 0.8, metalness: 0 }),
    curtain: mat('#6b6046', { roughness: 0.85, metalness: 0, side: DoubleSide }),
    pane: new MeshStandardMaterial({ color: 0x0e1a24, roughness: 0.12, metalness: 0.55 }),
    flap: mat('#17141b', { roughness: 0.95, metalness: 0 }),
    glass: new MeshStandardMaterial({ color: 0xbfe6f4, transparent: true, opacity: 0.38, roughness: 0.05, metalness: 0.6, side: 2 }),
    hl: new MeshBasicMaterial({ color: new Color('#fff4c8').multiplyScalar(2.2) }),
  };
  return SHARED;
}

// ------------------------------------------------------------------------------------------------------------ the auto

/**
 * The auto, modelled on a Bajaj RE as seen on Hyderabad roads: a solid two-tone body (body colour below, roof colour above), a
 * domed roof that overhangs the rear, a rear panel with a rounded-rectangle window and side panes, a louvred engine cover carrying
 * the plate, chunky chrome-housed tail lights, a chrome bumper, rolled-up canvas curtains, a single front wheel under a round
 * mudguard. Closed from every side: tub, chassis, panels and roof all overlap, there is no see-through seam.
 *
 * `color` is the body paint. `player` builds the full customisable rig (plates, banner, mud-flap apron, stripes, underglow, dash and
 * roof mounts, rimmed wheels, headlight) and applies the default loadout; traffic and customers get the same shape without the extras.
 *
 * userData handles: body wheels[] front hlM tailM brakeM headlight driver pax[] paint (the original contract) plus
 *   roofGroup (roof shell, curtains, banner, roof props) upperGroup (rear panel + pillars) windowGroup posts[] glass glassM header
 *   roofM curtainM curtains[] seatM rimM spokeM tyreM whiteM wheelParts[] tailLampM tailRefM hlLamp chrome
 *   and for the player rig: roofMount rearMount bumperMount plates{rear,front} plateRearM plateFrontM banner bannerM bannerBoard
 *   badge badgeM cover{door,face,faceM,emblem} rearWin{group,center,centerM,sides[],sideM} flaps{left,right,decalL,decalR,decalM}
 *   mudguard (centre apron: {group,flap,text,textM}) stripes{left,right,material} swish{left,right,material}
 *   underglow{group,tubes,pool,tubeM,poolM} dashAnchor garlandAnchor.
 */
export function buildAuto({ color = '#ffc400', player = false, driver = true, rng = null } = {}) {
  const hi = !!player;
  const geo = geometries(hi);
  const sh = hi ? null : sharedMaterials();
  const M = (k, make) => (sh ? sh[k] : make());

  const g = new Group();
  const body = new Group(); // the part that rolls and pitches; wheels stay on the ground
  g.add(body);
  const paint = hi
    ? new MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.04, clearcoat: 0.6, clearcoatRoughness: 0.12, side: DoubleSide })
    : mat(color, { roughness: 0.3, metalness: 0.04, side: DoubleSide });
  const roofM = M('roof', () => mat('#241f2c', { roughness: 0.36, metalness: 0.08 }));
  const chrome = M('chrome', () => mat('#d8dae8', { roughness: 0.15, metalness: 0.9 }));
  const tyreM = M('rubber', () => mat('#15131a', { roughness: 0.9, metalness: 0 }));
  const seatM = M('seat', () => mat('#a13a2c', { roughness: 0.8, metalness: 0 }));
  const curtainM = M('curtain', () => mat('#6b6046', { roughness: 0.85, metalness: 0, side: DoubleSide }));
  const trimM = hi ? mat('#f4f1ea', { roughness: 0.35, metalness: 0.4 }) : null;
  const flapM = M('flap', () => mat('#17141b', { roughness: 0.95, metalness: 0 }));
  const hlM = M('hl', () => new MeshBasicMaterial({ color: new Color('#fff4c8').multiplyScalar(2.2) }));
  const paneM = M('pane', () => new MeshStandardMaterial({ color: 0x0e1a24, roughness: 0.12, metalness: 0.55 }));
  const glassM = M('glass', () => new MeshStandardMaterial({ color: 0xbfe6f4, transparent: true, opacity: 0.38, roughness: 0.05, metalness: 0.6, side: 2 }));
  const rect = (w, h, m) => new Mesh(new PlaneGeometry(w, h), m);

  // ---- body: one mesh per material
  mesh(body, geo.paint, paint, { receive: true });
  mesh(body, geo.chrome, chrome);
  const darkM = M('dark', () => mat('#14181f', { roughness: 0.65, metalness: 0.25 }));
  mesh(body, geo.dark, darkM, { cast: false });
  mesh(body, geo.seat, seatM);
  const tailLampM = new MeshBasicMaterial({ color: new Color('#ff2a3a').multiplyScalar(0.9) });
  const tailRefM = hi ? new MeshBasicMaterial({ color: new Color('#ffb4b8').multiplyScalar(0.9) }) : null;
  mesh(body, geo.tailLens, tailLampM, { cast: false });
  if (geo.tailRef) mesh(body, geo.tailRef, tailRefM, { cast: false });
  // `tailM` is what Game.syncAuto writes every frame (red, brighter on the brake). Traffic autos light their lamps with it directly;
  // the player's lamps use tailLampM (tinted by the loadout and driven in customize.js), so tailM is a free-standing dummy there.
  const tailM = hi ? new MeshBasicMaterial({ color: new Color('#ff2a3a').multiplyScalar(0.9) }) : tailLampM;
  const brakeM = new MeshBasicMaterial({ color: new Color('#ff1f2f').multiplyScalar(0.0) });
  mesh(body, geo.brake, brakeM, { cast: false });
  const hlLamp = mesh(body, geo.hlLamp, hlM, { cast: false });

  // windscreen: frame posts (their own mesh so the high canopy can stretch them), glass, header
  const postsMesh = mesh(body, geo.posts, chrome);
  postsMesh.position.y = 1.64;
  const posts = [postsMesh];
  let header = null;
  const glass = new Mesh(new PlaneGeometry(1.2, 0.58), glassM);
  glass.position.set(0, 1.745, 0.78);
  glass.rotation.x = -0.18;
  body.add(glass);

  // ---- upper rear and window panes
  const upperGroup = new Group();
  body.add(upperGroup);
  mesh(upperGroup, geo.upper, roofM, { receive: true });
  const windowGroup = new Group();
  body.add(windowGroup);
  if (geo.seal) mesh(windowGroup, geo.seal, mat('#cfd2de', { roughness: 0.3, metalness: 0.8 }), { cast: false }); // chrome surround
  const paneCenterM = hi ? new MeshStandardMaterial({ color: 0xffffff, roughness: 0.14, metalness: 0.4 }) : null;
  let paneCenter = null;
  if (hi) {
    paneCenter = rect(0.8, 0.48, paneCenterM);
    paneCenter.position.set(0, 1.58, -1.4965);
    paneCenter.rotation.y = Math.PI;
    windowGroup.add(paneCenter);
  }
  if (geo.paneSides) mesh(windowGroup, geo.paneSides, paneM, { cast: false });
  const paneSides = [];

  // ---- roof group
  const roofGroup = new Group();
  body.add(roofGroup);
  mesh(roofGroup, geo.roof, roofM, { receive: true });
  if (geo.roofTrim) mesh(roofGroup, geo.roofTrim, trimM, { cast: false });
  const curtainMesh = mesh(roofGroup, geo.curtains, curtainM);
  const curtains = [curtainMesh];

  const ud = {};
  if (hi) {
    header = new Mesh(new BoxGeometry(1.32, 0.045, 0.045), chrome);
    header.position.set(0, 2.03, 0.73);
    header.rotation.x = -0.18;
    body.add(header);
  }

  const flat = (w, h, m) => new Mesh(new PlaneGeometry(w, h), m);
  const decalM = (o = {}) => new MeshStandardMaterial({ roughness: 0.55, metalness: 0, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, ...o });

  if (hi) {
    // engine-cover face (louvres / grille / LED panel art), plates, emblem
    const faceM = decalM();
    const face = flat(0.94, 0.46, faceM);
    face.position.set(0, 0.81, -1.4925);
    face.rotation.y = Math.PI;
    body.add(face);
    const plateRearM = new MeshStandardMaterial({ roughness: 0.6, color: 0xffffff });
    const plateRear = flat(0.5, 0.125, plateRearM);
    plateRear.position.set(0, 0.735, -1.498);
    plateRear.rotation.y = Math.PI;
    body.add(plateRear);
    const plateFrontM = new MeshStandardMaterial({ roughness: 0.6, color: 0xffffff });
    const plateFront = flat(0.34, 0.085, plateFrontM);
    plateFront.position.set(0, 0.62, 1.7);
    body.add(plateFront);

    const emblem = new Mesh(new CylinderGeometry(0.03, 0.03, 0.012, 10), chrome);
    emblem.position.set(0, 0.875, -1.4945);
    emblem.rotation.x = Math.PI / 2;
    body.add(emblem);

    // the oval roof badge
    const badgeM = new MeshStandardMaterial({ roughness: 0.5, color: 0xffffff, transparent: true, alphaTest: 0.05 });
    const badge = flat(0.22, 0.092, badgeM);
    badge.position.set(0, 1.985, -1.6255);
    badge.rotation.y = Math.PI;
    roofGroup.add(badge);

    // the board on the back of the roof, held up by two little posts
    const bannerM = new MeshStandardMaterial({ roughness: 0.6, color: 0xffffff });
    const bannerBoard = new Group();
    const bannerFace = flat(1.3, 0.28, bannerM);
    bannerFace.rotation.y = Math.PI;
    bannerFace.position.z = -0.016;
    const bb = new Batch();
    bb.add('b', new BoxGeometry(1.34, 0.32, 0.03), 0, 0, 0);
    for (const s of [-1, 1]) bb.add('l', new CylinderGeometry(0.02, 0.02, 0.22, 5), s * 0.55, -0.2, 0);
    const bbm = bb.merge();
    mesh(bannerBoard, bbm.get('b'), mat('#1a0e04', { roughness: 0.7, metalness: 0 }), { cast: false });
    mesh(bannerBoard, bbm.get('l'), chrome, { cast: false });
    bannerBoard.add(bannerFace);
    bannerBoard.position.set(0, 2.4, -1.5);
    roofGroup.add(bannerBoard);

    // mud-flap art behind the wheels, the centre apron with a message (hidden until one is picked)
    const flapDecalM = decalM({ roughness: 0.7 });
    mesh(body, geo.flapDecal, flapDecalM, { cast: false });
    const mud = new Group();
    const apron = mesh(mud, new BoxGeometry(1.1, 0.34, 0.03), mat('#17141b', { roughness: 0.95, metalness: 0 }), { cast: false });
    const mudTextM = new MeshStandardMaterial({ roughness: 0.7, metalness: 0, color: 0xffffff });
    const mudText = flat(1.06, 0.3, mudTextM);
    mudText.rotation.y = Math.PI;
    mudText.position.z = -0.0165;
    mud.add(mudText);
    mud.position.set(0, 0.24, -1.66);
    mud.visible = false;
    body.add(mud);

    // side stripes: thin planes hugging the tub sides; the left one is mirrored so patterns run front-to-back on both
    const stripeM = decalM();
    const stripeR = flat(1.6, 0.3, stripeM);
    stripeR.position.set(0.754, 0.8, -0.4);
    stripeR.rotation.y = Math.PI / 2;
    const stripeL = flat(1.6, 0.3, stripeM);
    stripeL.position.set(-0.754, 0.8, -0.4);
    stripeL.rotation.y = -Math.PI / 2;
    stripeL.scale.x = -1;
    stripeR.visible = stripeL.visible = false;
    body.add(stripeR, stripeL);
    // the rainbow swish sits on the broad rear pillars
    const swishM = decalM();
    const swishR = flat(0.48, 0.9, swishM);
    swishR.position.set(0.754, 1.52, -1.22);
    swishR.rotation.y = Math.PI / 2;
    const swishL = flat(0.48, 0.9, swishM);
    swishL.position.set(-0.754, 1.52, -1.22);
    swishL.rotation.y = -Math.PI / 2;
    swishL.scale.x = -1;
    swishR.visible = swishL.visible = false;
    upperGroup.add(swishR, swishL);

    // underglow: neon tubes under the chassis and a soft additive pool on the road (all hidden until a colour is picked)
    const ug = new Group();
    ug.visible = false;
    const tubeM = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const tb = new Batch();
    for (const s of [-1, 1]) tb.add('t', new BoxGeometry(0.06, 0.05, 2.3), s * 0.6, 0.28, -0.3);
    tb.add('t', new BoxGeometry(1.26, 0.05, 0.06), 0, 0.28, 0.85);
    tb.add('t', new BoxGeometry(1.26, 0.05, 0.06), 0, 0.28, -1.45);
    const tubesMesh = mesh(ug, tb.merge().get('t'), tubeM, { cast: false });
    const poolM = new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const pool = new Mesh(new PlaneGeometry(3.0, 4.0), poolM);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.075, -0.2);
    pool.renderOrder = 2;
    ug.add(pool);
    g.add(ug);

    // mounts: a toy on the dash, a garland across the windscreen, bolt-ons at the rear, the roof props, the bumper
    const dashAnchor = new Group();
    dashAnchor.position.set(-0.36, 1.53, 0.68);
    dashAnchor.rotation.y = 0.28;
    body.add(dashAnchor);
    const garlandAnchor = new Group();
    body.add(garlandAnchor);
    if (geo.beads) mesh(body, geo.beads, new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }), { cast: false });
    const roofMount = new Group();
    roofGroup.add(roofMount);
    const rearMount = new Group();
    body.add(rearMount);
    const bumperMount = new Group();
    body.add(bumperMount);

    Object.assign(ud, {
      roofMount, rearMount, bumperMount, plateRearM, plateFrontM, plates: { rear: plateRear, front: plateFront }, banner: bannerFace, bannerM, bannerBoard,
      badge, badgeM,
      cover: { door: null, face, faceM, emblem },
      rearWin: { group: windowGroup, center: paneCenter, centerM: paneCenterM, sides: paneSides, sideM: paneM },
      flaps: { left: null, right: null, decalL: null, decalR: null, decalM: flapDecalM, material: flapM },
      mudguard: { group: mud, flap: apron, text: mudText, textM: mudTextM },
      stripes: { left: stripeL, right: stripeR, material: stripeM }, swish: { left: swishL, right: swishR, material: swishM },
      underglow: { group: ug, tubes: [tubesMesh], pool, tubeM, poolM }, dashAnchor, garlandAnchor,
    });
  }

  // ---- wheels: front one steers; the pivot group turns, the tyre spins inside it
  const rimM = hi ? mat('#a29a90', { roughness: 0.35, metalness: 0.5 }) : null;
  const spokeM = hi ? mat('#6c655d', { roughness: 0.4, metalness: 0.5 }) : null;
  const whiteM = hi ? mat('#f2f0ea', { roughness: 0.8, metalness: 0 }) : null;
  const wheels = [];
  const wheelParts = [];
  const mkWheel = (x, z) => {
    const holder = new Group();
    holder.position.set(x, 0.34, z);
    const spin = new Group();
    const tyre = mesh(spin, geo.tyre, tyreM);
    if (hi) {
      const rim = mesh(spin, geo.rim, rimM, { cast: false });
      const spokes = mesh(spin, geo.spokes, spokeM, { cast: false });
      const whites = mesh(spin, geo.whites, whiteM, { cast: false });
      whites.visible = false;
      wheelParts.push({ tyre, rim, cap: null, spokes: [spokes], whites: [whites] });
    }
    holder.add(spin);
    g.add(holder);
    wheels.push(spin);
    return holder;
  };
  const front = mkWheel(0, 1.28);
  mkWheel(-0.78, -0.82);
  mkWheel(0.78, -0.82);
  if (geo.fork) mesh(g, geo.fork, chrome, { cast: false });

  // ---- driver (always) and up to two passengers (player only: shown when a fare boards)
  let driverRig = null;
  if (driver) {
    driverRig = buildPerson({ shirt: '#c9a86a', skin: '#a86e4a', cap: '#2a3350', pose: 'drive', scale: 0.92, merged: true, low: !hi, ...(rng ? randomLook(rng) : {}) });
    driverRig.position.set(0, 0.6, 0.1);
    body.add(driverRig);
  }
  const pax = [];
  if (hi) {
    for (let i = 0; i < 2; i++) {
      const p = buildPerson({ pose: 'sit', scale: 0.9, merged: true });
      p.position.set(i === 0 ? -0.32 : 0.32, 0.68, -0.95);
      p.rotation.y = Math.PI;
      p.visible = false;
      body.add(p);
      pax.push(p);
    }
  }

  let headlight = null;
  if (hi) {
    headlight = new SpotLight(0xfff0c0, 0, 46, 0.62, 0.6, 1.2);
    headlight.position.set(0, 1.0, 1.3);
    headlight.target.position.set(0, 0.4, 14);
    body.add(headlight, headlight.target);
  }

  g.userData = {
    ...ud, body, wheels, front, hlM, tailM, brakeM, headlight, driver: driverRig, pax, paint,
    roofGroup, upperGroup, windowGroup, header, roofM, curtainM, curtains, posts, glass, glassM, seatM, rimM, spokeM, tyreM, whiteM, wheelParts,
    tailLampM, tailRefM, hlLamp, chrome, trimM, detail: hi,
  };
  if (hi) {
    // the default look (plates, banner...) so the auto is never blank, even if the customisation system never runs
    applyLoadout(g, { ...DEFAULT_LOADOUT });
    if (/^#[0-9a-f]{3,8}$/i.test(String(color))) g.userData.paint.color.set(color); // (a saved loadout stores catalogue ids, which customize.js resolves)
  }
  return g;
}

/** Re-paint the body (garage). */
export function paintAuto(auto, color) {
  if (/^#[0-9a-f]{3,8}$/i.test(String(color))) auto.userData.paint.color.set(color);
}
