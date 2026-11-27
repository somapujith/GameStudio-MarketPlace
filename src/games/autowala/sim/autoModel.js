// The auto-rickshaw (and the little people who ride and drive it). Smooth low-poly, lacquered paint, glowing lamps.
// Faces +z. Returns a group with handles in userData so the simulation can animate wheels, steering and lights, and so the
// customisation system (sim/customize.js, which OWNS the look of every catalogue item) can reach every part by name.
// PERFORMANCE: every static part of the auto is baked into ONE geometry per slot (built once per level of detail and shared by every
// auto). The traffic auto draws one mesh per material. The player's rig draws far fewer: every opaque static part in ONE mesh, the
// transparent decals in one, one mesh per wheel set (sim/auto-uber.js: a per-vertex slot picks each part's look from uniform arrays fed
// by the per-part materials, which stay the handles customize.js writes; the decals' pictures live in one atlas, sim/auto-atlas.js),
// plus the paint, the windscreen and the driver. The windscreen posts, header and rear panel that the "high canopy" option stretches are
// baked in two variants (normal / canopy, sim/auto-canopy.js) and customize.js swaps the geometry.
// Budget: player rig with the default look <= 8 draw calls and <= 3 shadow casters, however it is customised (see auto-budget.test.js).
// OWNER: customisation agent.
import {
  AdditiveBlending,
  BoxGeometry,
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
  CapsuleGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DEFAULT_LOADOUT } from '../gameplay/catalog.js';
import { applyLoadout } from './customize.js';
import { CANOPY_LIFT, canopyFrames } from './auto-canopy.js';
import { buildStaticPerson } from './person-mesh.js';
import { UBER_GROUPS, bindSlot, createUberDepthMaterial, createUberMaterial, createUberState, mergeSlots, syncUber } from './auto-uber.js';
import { createAtlas } from './auto-atlas.js';

const mat = (color, o = {}) => new MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2, ...o });

// The vertex-coloured "matte" material has metalness 0.25 (the chassis' own); parts that used to have another metalness get a vertex-colour
// gain that keeps their diffuse colour: a metallic surface's diffuse is scaled by (1 - metalness).
const MATTE_METAL = 0.25;
const gain = (oldMetal) => (1 - oldMetal) / (1 - MATTE_METAL);

const SKIN = ['#8d5a3c', '#a86e4a', '#c08a62', '#6f4430', '#d6a37c'];
const SHIRTS = ['#e8453c', '#2d7be8', '#f2c230', '#2fb572', '#a05cf0', '#f07ab0', '#ffffff', '#ff8a3d', '#2ec4b6'];

// ------------------------------------------------------------------------------------------------------------ batching

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _one = new Vector3(1, 1, 1);
const _col = new Color();

/** Bake a transform into a (freshly made, unshared) geometry. */
function place(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _m.compose(_p, _q, _one);
  geo.applyMatrix4(_m);
  return geo;
}

/** A flat vertex colour on every vertex (the `color` attribute, linear like a Color's r g b). `color` is a hex, or [hex, gain]. */
function paintVertices(geo, color) {
  if (Array.isArray(color)) _col.set(color[0]).multiplyScalar(color[1]);
  else _col.set(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _col.r;
    arr[i * 3 + 1] = _col.g;
    arr[i * 3 + 2] = _col.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(arr, 3));
  return geo;
}

/** Swap vertex 1 and 2 of every triangle (a non-indexed geometry that was mirrored must have its winding restored). */
function flipWinding(geo) {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name];
    const k = a.itemSize;
    for (let t = 0; t < a.count; t += 3) {
      for (let c = 0; c < k; c++) {
        const i1 = (t + 1) * k + c;
        const i2 = (t + 2) * k + c;
        const tmp = a.array[i1];
        a.array[i1] = a.array[i2];
        a.array[i2] = tmp;
      }
    }
    a.needsUpdate = true;
  }
  return geo;
}

/**
 * Two flat planes of one size baked into ONE geometry (mirrored ones get their winding fixed): a: { x, y, z, ry, mirror }.
 * The planes keep their own 0..1 uv, so a texture reads exactly as it did on two separate meshes.
 */
function planePair(w, h, items) {
  const list = items.map((it) => {
    const g = new PlaneGeometry(w, h).toNonIndexed();
    const m = new Matrix4().makeScale(it.mirror ? -1 : 1, 1, 1);
    g.applyMatrix4(m);
    if (it.mirror) flipWinding(g);
    return place(g, it.x, it.y, it.z, 0, it.ry || 0, 0);
  });
  const out = mergeGeometries(list, false);
  list.forEach((l) => l.dispose());
  return out;
}

/** Collects geometries under a key (a slot name or a material) and merges each key into ONE geometry. */
class Batch {
  constructor() {
    this.lists = new Map();
  }

  /** `post` (Matrix4) is applied after the placement (the canopy variant), `color` bakes a vertex colour. */
  add(key, geometry, x, y, z, rx, ry, rz, post = null, color = null) {
    // (RoundedBoxGeometry is non-indexed, the rest are indexed: merge everything as non-indexed)
    let geo = geometry;
    if (geo.index) {
      geo = geo.toNonIndexed();
      geometry.dispose();
    }
    place(geo, x, y, z, rx, ry, rz);
    if (post) geo.applyMatrix4(post);
    if (color) paintVertices(geo, color);
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
 * A seated or standing person. `pose`: 'drive' | 'sit' | 'stand'.
 * `merged: true` (the driver and the passengers, which never animate limbs) is ONE vertex-coloured mesh (sim/person-mesh.js);
 * `low: true` uses the cheapest geometry (traffic drivers). The default (separate limb meshes) is the original rig, kept for tools and
 * tests: the game's customers are skinned rigs (`person-mesh.js buildCustomerRig`) whose limb handles work the same way.
 */
export function buildPerson({ shirt = '#e8453c', skin = '#a86e4a', hair = '#1b1220', cap = null, pose = 'stand', scale = 1, female = false, merged = false, low = false } = {}) {
  if (merged) return buildStaticPerson({ shirt, skin, hair, cap, pose, scale, female, low });
  const g = new Group();
  const body = mat(shirt, { roughness: 0.7, metalness: 0 });
  const skinM = mat(skin, { roughness: 0.8, metalness: 0 });
  const legM = mat(female ? '#3a2a5a' : '#2a3350', { roughness: 0.8, metalness: 0 });
  const hairMat = mat(hair, { roughness: 0.9, metalness: 0 });
  const capMat = cap ? (low ? hairMat : mat(cap, { roughness: 0.8, metalness: 0 })) : null;
  const cs = low ? 1 : 2;
  const rs = low ? 5 : 6;
  const yBase = pose === 'stand' ? 0.55 : 0.32;
  // [geometry, material, x, y, z, rx] for each part, built from the pose
  const parts = {
    torso: [new CapsuleGeometry(0.2, 0.34, cs, low ? 6 : 8), body, 0, yBase + 0.42, 0, 0],
    head: [new SphereGeometry(0.16, low ? 6 : 8, low ? 4 : 6), skinM, 0, yBase + 0.92, 0, 0],
    hair: [new SphereGeometry(0.17, low ? 6 : 8, low ? 3 : 4, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 0, yBase + 0.95, -0.01, 0],
    lArm: [new CapsuleGeometry(0.06, 0.34, cs, rs), skinM, -0.27, yBase + 0.46, 0.06, 0],
    rArm: [new CapsuleGeometry(0.06, 0.34, cs, rs), skinM, 0.27, yBase + 0.46, 0.06, 0],
    lLeg: [new CapsuleGeometry(0.085, 0.4, cs, rs), legM, -0.11, 0.34, 0, 0],
    rLeg: [new CapsuleGeometry(0.085, 0.4, cs, rs), legM, 0.11, 0.34, 0, 0],
  };
  const userData = {};
  for (const [name, p] of Object.entries(parts)) {
    const o = mesh(g, p[0], p[1]);
    o.position.set(p[2], p[3], p[4]);
    o.rotation.x = p[5];
    userData[name] = o;
  }
  if (cap) mesh(g, new SphereGeometry(0.185, low ? 6 : 8, low ? 3 : 4, 0, Math.PI * 2, 0, Math.PI * 0.5), capMat).position.set(0, yBase + 0.98, 0.01);
  g.scale.setScalar(scale);
  userData.mats = { shirt: body, skin: skinM, hair: hairMat, legs: legM };
  g.userData = userData;
  return g;
}

export const randomLook = (rng) => ({ shirt: rng.pick(SHIRTS), skin: rng.pick(SKIN), female: rng.chance(0.4), hair: rng.pick(['#1b1220', '#2a1a12', '#3a2a22']) });

// ------------------------------------------------------------------------------------------------------------ the auto's geometry

const GEO = {};

/**
 * The static geometry of the auto, merged into one BufferGeometry per slot (a slot = one material). `hi` is the player's rig (rounder,
 * with trim, plate mounts, rimmed wheels); otherwise the cheap traffic auto. `canopy` bakes the parts the high-canopy roof moves
 * (roof, rear panel, window, posts, header, banner) in their lifted place. Cached per variant.
 * Slots: paint chrome matte (vertex colours) seat tailLens tailRef brake hlLamp roof curtains paneSides flapDecal,
 *        tyre rim spokes whites (the front wheel, centred) and the same + 'R' (both rear wheels, centred between them);
 *        player only: emblem plates banner paneCenter face badge, and the merged meshes it draws: uber (the opaque body parts),
 *        wheel, wheelR, decal (sim/auto-uber.js UBER_GROUPS; they carry `aSlot`, colours and atlas uvs).
 */
function geometries(hi, canopy = false) {
  const key = (hi ? 'hi' : 'lo') + (canopy ? 'C' : '');
  if (GEO[key]) return GEO[key];
  const B = new Batch();
  const F = canopy ? canopyFrames(CANOPY_LIFT) : null;
  // add(slot, geometry, x, y, z, rx, ry, rz, frame, vertexColour)
  const add = (slot, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, frame = null, color = null) =>
    B.add(slot, geo, x, y, z, rx, ry, rz, F && frame ? F[frame] : null, color);
  const box = (w, h, d) => new BoxGeometry(w, h, d);
  const big = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, hi ? 2 : 1, r);
  const soft = (w, h, d, r) => (hi ? new RoundedBoxGeometry(w, h, d, 1, r) : new BoxGeometry(w, h, d));
  const arch = (radius, width) => {
    const geo = new CylinderGeometry(radius, radius, width, hi ? 12 : 8, 1, true, -0.3, Math.PI + 0.6);
    geo.rotateZ(Math.PI / 2);
    return geo;
  };
  const DARK = hi ? '#14181f' : '#ffffff'; // (the traffic auto's matte material carries its own colour)

  // ---- body: paint
  add('matte', box(1.42, 0.2, 2.6), 0, 0.42, -0.2, 0, 0, 0, null, DARK); // chassis (closes the underside)
  add('paint', big(1.5, 0.64, 2.02, 0.12), 0, 0.76, -0.46); // passenger tub
  add('paint', big(1.22, 0.86, 0.95, 0.22), 0, 0.94, 0.78); // hood nose
  add('paint', soft(1.0, 0.18, 0.7, 0.07), 0, 1.43, 0.62, -0.1); // dash
  add('paint', box(0.98, 0.5, 0.05), 0, 0.81, -1.465); // engine cover door
  add('paint', arch(0.4, 0.3), 0, 0.34, 1.28); // round front mudguard
  for (const s of [-1, 1]) add('paint', arch(0.41, 0.3), s * 0.78, 0.34, -0.82); // rear arches
  add('chrome', new CylinderGeometry(0.03, 0.03, 0.8, 6), 0, 1.44, 0.72, 0, 0, Math.PI / 2); // handlebar
  add('chrome', new CylinderGeometry(0.05, 0.05, 0.4, 6), -0.68, 0.45, -1.55, Math.PI / 2, 0, 0); // exhaust
  add('matte', box(0.16, 0.14, 0.1), 0.22, 1.55, 0.7, 0, 0, 0, null, DARK); // meter
  add('seat', soft(1.2, 0.2, 0.55, 0.07), 0, 1.02, -0.95);
  add('seat', soft(1.2, 0.5, 0.14, 0.06), 0, 1.37, -1.3);
  add('seat', soft(0.62, 0.18, 0.5, 0.06), 0, 1.0, 0.12);
  add('brake', box(0.5, 0.03, 0.012), 0, 1.1, -1.486);
  add('matte', box(0.3, 0.36, 0.025), 0.78, 0.3, -1.26, 0, 0, 0, null, DARK); // rubber flaps behind the rear wheels
  add('matte', box(0.3, 0.36, 0.025), -0.78, 0.3, -1.26, 0, 0, 0, null, DARK);
  add('hlLamp', new SphereGeometry(0.15, hi ? 10 : 6, hi ? 8 : 4), 0, 1.0, 1.26);
  if (hi) add('chrome', new CylinderGeometry(0.03, 0.03, 0.62, 6), 0, 0.7, 1.28); // fork
  // windscreen frame posts (the canopy stretches them: that variant is baked in)
  add('chrome', new CylinderGeometry(0.035, 0.035, 0.78, 6), -0.62, 1.64, 0.5, 0.18, 0, 0, 'posts');
  add('chrome', new CylinderGeometry(0.035, 0.035, 0.78, 6), 0.62, 1.64, 0.5, 0.18, 0, 0, 'posts');
  if (hi) {
    add('chrome', box(1.32, 0.045, 0.045), 0, 2.03, 0.73, -0.18, 0, 0, 'header'); // windscreen header
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
    for (const y of [0.99, 0.6]) add('matte', box(0.8, y > 0.9 ? 0.09 : 0.06, 0.01), 0, y, -1.4925, 0, 0, 0, null, DARK);
  }

  // ---- upper rear (roof colour) and window surrounds
  add('roof', box(1.5, 0.95, 0.12), 0, 1.525, -1.42, 0, 0, 0, 'upper');
  for (const s of [-1, 1]) add('roof', box(0.2, 0.95, 0.5), s * 0.65, 1.525, -1.22, 0, 0, 0, 'upper');
  if (hi) {
    add('chrome', box(0.86, 0.54, 0.014), 0, 1.58, -1.4855, 0, 0, 0, 'window'); // chrome surround (was its own pale-steel material)
    for (const s of [-1, 1]) {
      add('chrome', box(0.24, 0.44, 0.014), s * 0.545, 1.58, -1.4855, 0, 0, 0, 'window');
      add('paneSides', new PlaneGeometry(0.2, 0.4), s * 0.545, 1.58, -1.4965, 0, Math.PI, 0, 'window');
    }
  } else {
    add('matte', new PlaneGeometry(0.8, 0.48), 0, 1.58, -1.4965, 0, Math.PI, 0, null, DARK);
    for (const s of [-1, 1]) add('matte', new PlaneGeometry(0.2, 0.4), s * 0.545, 1.58, -1.4965, 0, Math.PI, 0, null, DARK);
  }

  // ---- roof group: the dome that overhangs the rear, edge pinstripe, rolled canvas curtains, the banner board
  add('roof', big(1.74, 0.16, 2.5, 0.08), 0, 2.0, -0.37, 0, 0, 0, 'roof');
  add('roof', soft(1.5, 0.1, 1.95, 0.05), 0, 2.12, -0.2, 0, 0, 0, 'roof');
  add('roof', box(1.5, 0.14, 0.36), 0, 1.98, 0.98, -0.12, 0, 0, 'roof');
  if (hi) {
    add('matte', box(1.76, 0.014, 0.014), 0, 1.935, -1.622, 0, 0, 0, 'roof', ['#f4f1ea', gain(0.4)]);
    for (const s of [-1, 1]) add('matte', box(0.014, 0.014, 2.5), s * 0.872, 1.935, -0.37, 0, 0, 0, 'roof', ['#f4f1ea', gain(0.4)]);
    add('matte', box(1.34, 0.32, 0.03), 0, 2.4, -1.5, 0, 0, 0, 'roof', ['#1a0e04', gain(0)]); // the board on the back of the roof...
    for (const s of [-1, 1]) add('chrome', new CylinderGeometry(0.02, 0.02, 0.22, 5), s * 0.55, 2.2, -1.5, 0, 0, 0, 'roof'); // ...and its two little posts
  }
  for (const s of [-1, 1]) {
    if (hi) add('curtains', new CylinderGeometry(0.055, 0.055, 1.4, 8), s * 0.74, 1.91, -0.25, Math.PI / 2, 0, 0, 'roof'); // the roll
    add('curtains', box(0.035, 0.46, 1.36), s * 0.745, 1.66, -0.25, 0, 0, 0, 'roof'); // the half-lowered flap
  }

  // ---- wheels (centred, axis along x): the front one, and both rear ones as a pair centred between them
  const wheelSet = (suffix, xs) => {
    for (const wx of xs) {
      add('tyre' + suffix, new CylinderGeometry(0.34, 0.34, 0.2, hi ? 12 : 8), wx, 0, 0, 0, 0, Math.PI / 2);
      if (hi) {
        add('rim' + suffix, new CylinderGeometry(0.235, 0.235, 0.214, 12), wx, 0, 0, 0, 0, Math.PI / 2);
        for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) add('spokes' + suffix, box(0.012, 0.04, 0.44), wx + sx * 0.1132, 0, 0, (k * Math.PI) / 3, 0, 0);
        for (const sx of [-1, 1]) add('whites' + suffix, new RingGeometry(0.24, 0.318, 16), wx + sx * 0.1035, 0, 0, 0, sx * (Math.PI / 2), 0);
      }
    }
  };
  wheelSet('', [0]);
  wheelSet('R', [-0.78, 0.78]);

  // ---- decorations that only exist on the player's rig
  if (hi) {
    for (let i = -3; i <= 3; i++) add('matte', new SphereGeometry(0.06, 5, 4), i * 0.1, 1.5 - Math.abs(i) * 0.02, 0.84, 0, 0, 0, null, [['#ff8a2d', '#ffc400', '#ff4d6d'][Math.abs(i) % 3], gain(0)]); // the dash beads
    add('flapDecal', new PlaneGeometry(0.27, 0.32), 0.78, 0.3, -1.2745, 0, Math.PI, 0);
    add('flapDecal', new PlaneGeometry(0.27, 0.32), -0.78, 0.3, -1.2745, 0, Math.PI, 0);
    // the emblem on the engine cover (hidden under the LED / royal covers), both number plates (one texture), the banner face on its
    // board, the rear-window sticker pane, the engine-cover art and the roof badge: textured through the decal atlas (sim/auto-atlas.js)
    add('emblem', new CylinderGeometry(0.03, 0.03, 0.012, 10), 0, 0.875, -1.4945, Math.PI / 2, 0, 0);
    add('plates', new PlaneGeometry(0.5, 0.125), 0, 0.735, -1.498, 0, Math.PI, 0);
    add('plates', new PlaneGeometry(0.34, 0.085), 0, 0.62, 1.7);
    add('banner', new PlaneGeometry(1.3, 0.28), 0, 2.4, -1.516, 0, Math.PI, 0, 'roof');
    add('paneCenter', new PlaneGeometry(0.8, 0.48), 0, 1.58, -1.4965, 0, Math.PI, 0, 'window');
    add('face', new PlaneGeometry(0.94, 0.46), 0, 0.81, -1.4925, 0, Math.PI, 0);
    add('badge', new PlaneGeometry(0.22, 0.092), 0, 1.985, -1.6255, 0, Math.PI, 0, 'roof');
  }

  const merged = {};
  for (const [slot, g] of B.merge()) merged[slot] = g;
  if (hi) {
    // the player's rig draws these: every opaque static part, each wheel set, the transparent decals (one mesh each, sim/auto-uber.js)
    merged.uber = mergeSlots(merged, UBER_GROUPS.body);
    merged.wheel = mergeSlots(merged, UBER_GROUPS.wheel);
    merged.wheelR = mergeSlots(merged, UBER_GROUPS.wheel, 'R');
    merged.decal = mergeSlots(merged, UBER_GROUPS.decal);
  }
  GEO[key] = merged;
  return merged;
}

/** The merged static geometry per slot for a level of detail (true = the player's rig) and canopy variant. Exposed for the budget / merge tests. */
export const autoGeometries = geometries;

// materials that never change for traffic autos are shared between all of them
let SHARED = null;
// (the windscreen glass is ONE flat plane: the back-face pass of a double-sided transparent material would only draw nothing, so it is drawn in one pass)
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
    glass: new MeshStandardMaterial({ color: 0xbfe6f4, transparent: true, opacity: 0.38, roughness: 0.05, metalness: 0.6, side: 2, forceSinglePass: true }),
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
 *   roofGroup (decals and roof props that ride the roof) upperGroup (rear-panel decals) windowGroup (rear-window decal) glass glassM
 *   canopyGeometry(on) roofM curtainM curtains[] seatM rimM spokeM tyreM whiteM wheelParts[] tailLampM tailRefM hlLamp chrome
 *   (wheels[] and wheelParts[] hold TWO entries: the front wheel and both rear wheels as one pair, which turn together)
 *   On the player's rig most of these part handles are DATA: their materials (and `visible`, for the emblem, plates, badge, banner,
 *   rear-window centre, whitewalls) feed the merged meshes every frame instead of drawing themselves; syncParts() shows the textured
 *   stand-ins a patterned seat / curtain or an LED cover needs; envBag lists the data materials (customize.js gives them the env strength).
 *   and for the player rig: roofMount rearMount bumperMount plates plateRearM plateFrontM (one material) banner bannerM bannerBoard
 *   badge badgeM cover{door,face,faceM,emblem} rearWin{group,center,centerM,sides[],sideM} flaps{left,right,decalL,decalR,decalM}
 *   mudguard (centre apron: {group,flap,text,textM}) stripes{left,right,material} swish{left,right,material} (left and right are one
 *   mesh: toggling either toggles both) underglow{group,tubes,pool,tubeM,poolM} dashAnchor garlandAnchor.
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
  const flapM = M('flap', () => mat('#17141b', { roughness: 0.95, metalness: 0 }));
  const hlM = M('hl', () => new MeshBasicMaterial({ color: new Color('#fff4c8').multiplyScalar(2.2) }));
  const paneM = M('pane', () => new MeshStandardMaterial({ color: 0x0e1a24, roughness: 0.12, metalness: 0.55 }));
  const glassM = M('glass', () => new MeshStandardMaterial({ color: 0xbfe6f4, transparent: true, opacity: 0.38, roughness: 0.05, metalness: 0.6, side: 2, forceSinglePass: true }));
  // the dark / trim parts: the player's rig colours them per vertex (dark chassis, pinstripe, banner board, beads); traffic autos keep the shared dark
  const matteM = hi ? mat('#ffffff', { roughness: 0.65, metalness: 0.25, vertexColors: true }) : M('dark', () => mat('#14181f', { roughness: 0.65, metalness: 0.25 }));

  mesh(body, geo.paint, paint, { cast: true, receive: true });
  const tailLampM = new MeshBasicMaterial({ color: new Color('#ff2a3a').multiplyScalar(0.9) });
  const tailRefM = hi ? new MeshBasicMaterial({ color: new Color('#ffb4b8').multiplyScalar(0.9) }) : null;
  // `tailM` is what Game.syncAuto writes every frame (red, brighter on the brake). Traffic autos light their lamps with it directly;
  // the player's lamps use tailLampM (tinted by the loadout and driven in customize.js), so tailM is a free-standing dummy there.
  const tailM = hi ? new MeshBasicMaterial({ color: new Color('#ff2a3a').multiplyScalar(0.9) }) : tailLampM;
  const brakeM = new MeshBasicMaterial({ color: new Color('#ff1f2f').multiplyScalar(0.0) });

  // windscreen glass (its own mesh: the canopy stretches it)
  const glass = new Mesh(new PlaneGeometry(1.2, 0.58), glassM);
  glass.position.set(0, 1.745, 0.78);
  glass.rotation.x = -0.18;
  body.add(glass);

  // the groups that carry the decals and mounted props which ride the roof / rear panel / window (the canopy moves these nodes)
  const upperGroup = new Group();
  body.add(upperGroup);
  const windowGroup = new Group();
  body.add(windowGroup);
  const roofGroup = new Group();
  body.add(roofGroup);
  const paneCenterM = hi ? new MeshStandardMaterial({ color: 0xffffff, roughness: 0.14, metalness: 0.4 }) : null;
  const paneSides = [];

  const ud = {};
  let canopyGeometry;
  let hlLamp;
  let curtains;
  // the player's rig: the uniform arrays every merged mesh reads (sim/auto-uber.js), its two materials, and the per-frame sync
  const uber = hi ? createUberState() : null;
  let uberM = null;
  let syncLook = null;
  // a "data bag": a handle that keeps its material and `visible` (customize.js and Game.js write them) but is never drawn itself
  const bag = (m) => new Mesh(undefined, m);

  if (!hi) {
    // ---- traffic: one mesh per material. Only the big shell parts (tub, roof) and the driver cast shadows.
    const chromeMesh = mesh(body, geo.chrome, chrome, { cast: false });
    const matteMesh = mesh(body, geo.matte, matteM, { cast: false });
    mesh(body, geo.seat, seatM, { cast: false });
    mesh(body, geo.tailLens, tailLampM, { cast: false });
    mesh(body, geo.brake, brakeM, { cast: false });
    hlLamp = mesh(body, geo.hlLamp, hlM, { cast: false });
    const roofMesh = mesh(body, geo.roof, roofM, { cast: true, receive: true });
    const curtainMesh = mesh(body, geo.curtains, curtainM, { cast: false });
    curtains = [curtainMesh];
    // the canopy option swaps these meshes' geometry for the lifted bake (built the first time it is asked for)
    canopyGeometry = (on) => {
      const gset = geometries(false, !!on);
      chromeMesh.geometry = gset.chrome;
      matteMesh.geometry = gset.matte;
      roofMesh.geometry = gset.roof;
      curtainMesh.geometry = gset.curtains;
    };
  }

  const flat = (w, h, m) => new Mesh(new PlaneGeometry(w, h), m);
  const decalM = (o = {}) => new MeshStandardMaterial({ roughness: 0.55, metalness: 0, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, ...o });

  if (hi) {
    // engine-cover face (louvres / grille / LED panel art): drawn by the decal mesh through the atlas; this real mesh only shows when
    // customize.js puts the glowing LED material on it (syncParts)
    const faceM = decalM();
    const face = flat(0.94, 0.46, faceM);
    face.position.set(0, 0.81, -1.4925);
    face.rotation.y = Math.PI;
    face.castShadow = false;
    face.visible = false;
    body.add(face);
    // both number plates: ONE material (they always carry the same texture)
    const plateM = new MeshStandardMaterial({ roughness: 0.6, color: 0xffffff });
    const plates = bag(plateM);
    const emblem = bag(chrome); // (hidden under LED / royal covers)
    // the oval roof badge, the banner face (the board and its posts are baked into the merged body)
    const badgeM = new MeshStandardMaterial({ roughness: 0.5, color: 0xffffff, transparent: true, alphaTest: 0.05 });
    const badge = bag(badgeM);
    const bannerM = new MeshStandardMaterial({ roughness: 0.6, color: 0xffffff });
    const bannerFace = bag(bannerM);
    const bannerBoard = new Group();
    const paneCenter = bag(paneCenterM);
    hlLamp = bag(hlM);

    // mud-flap art behind the wheels, the centre apron with a message (hidden until one is picked)
    const flapDecalM = decalM({ roughness: 0.7 });
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

    // side stripes: thin planes hugging the tub sides (left and right are ONE mesh); the left one is mirrored so patterns run
    // front-to-back on both
    const stripeM = decalM();
    const stripes = new Mesh(planePair(1.6, 0.3, [{ x: 0.754, y: 0.8, z: -0.4, ry: Math.PI / 2 }, { x: -0.754, y: 0.8, z: -0.4, ry: -Math.PI / 2, mirror: true }]), stripeM);
    stripes.visible = false;
    body.add(stripes);
    // the rainbow swish sits on the broad rear pillars
    const swishM = decalM();
    const swish = new Mesh(planePair(0.48, 0.9, [{ x: 0.754, y: 1.52, z: -1.22, ry: Math.PI / 2 }, { x: -0.754, y: 1.52, z: -1.22, ry: -Math.PI / 2, mirror: true }]), swishM);
    swish.visible = false;
    upperGroup.add(swish);

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
    const roofMount = new Group();
    roofGroup.add(roofMount);
    const rearMount = new Group();
    body.add(rearMount);
    const bumperMount = new Group();
    body.add(bumperMount);

    // ---- the merged meshes (sim/auto-uber.js): every opaque static part in ONE mesh (the only shadow caster among them is its roof slot),
    // the always-visible transparent decals in one more, both textured through the decal atlas; plus textured stand-ins for a patterned
    // seat / curtain, shown only while customize.js has put a pattern texture on seatM / curtainM (syncParts)
    const atlas = createAtlas([
      { cell: 'plate', material: plateM }, { cell: 'banner', material: bannerM }, { cell: 'rearWindow', material: paneCenterM },
      { cell: 'cover', material: faceM }, { cell: 'flap', material: flapDecalM }, { cell: 'badge', material: badgeM },
    ]);
    uberM = createUberMaterial(uber, { map: atlas.texture });
    const decalUberM = createUberMaterial(uber, { map: atlas.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, alphaTest: 0.05 });
    syncLook = () => {
      atlas.sync();
      syncUber(uber);
    };
    const uberMesh = mesh(body, geo.uber, uberM, { cast: true, receive: true });
    uberMesh.customDepthMaterial = createUberDepthMaterial();
    uberMesh.onBeforeRender = syncLook;
    const decalMesh = mesh(body, geo.decal, decalUberM, { cast: false });
    decalMesh.onBeforeRender = syncLook;
    const seatTex = mesh(body, geo.seat, seatM, { cast: false });
    seatTex.visible = false;
    const curtainTex = mesh(body, geo.curtains, curtainM, { cast: false });
    curtainTex.visible = false;
    curtains = [curtainTex];
    canopyGeometry = (on) => {
      const gset = geometries(true, !!on);
      uberMesh.geometry = gset.uber;
      decalMesh.geometry = gset.decal;
      curtainTex.geometry = gset.curtains;
    };
    /** Show the stand-in meshes a texture needs (patterned seat / curtains, the LED cover material). customize.js calls it after every change. */
    ud.merged = { body: uberMesh, decals: decalMesh, seat: seatTex, curtains: curtainTex };
    ud.syncParts = () => {
      seatTex.visible = !!seatM.map;
      curtainTex.visible = !!curtainM.map;
      face.visible = face.material !== faceM;
    };
    bindSlot(uber, 'chrome', chrome);
    bindSlot(uber, 'matte', matteM);
    bindSlot(uber, 'seat', seatM, seatTex, true);
    bindSlot(uber, 'roof', roofM);
    bindSlot(uber, 'curtains', curtainM, curtainTex, true);
    bindSlot(uber, 'paneSides', paneM);
    bindSlot(uber, 'tailLens', tailLampM);
    bindSlot(uber, 'tailRef', tailRefM);
    bindSlot(uber, 'brake', brakeM);
    bindSlot(uber, 'hlLamp', hlM, hlLamp);
    bindSlot(uber, 'emblem', chrome, emblem);
    bindSlot(uber, 'plates', plateM, plates);
    bindSlot(uber, 'banner', bannerM, bannerFace);
    bindSlot(uber, 'paneCenter', paneCenterM, paneCenter);
    bindSlot(uber, 'face', faceM, face, true);
    bindSlot(uber, 'flapDecal', flapDecalM);
    bindSlot(uber, 'badge', badgeM, badge);

    Object.assign(ud, {
      roofMount, rearMount, bumperMount, plateRearM: plateM, plateFrontM: plateM, plates, banner: bannerFace, bannerM, bannerBoard,
      badge, badgeM,
      cover: { door: null, face, faceM, emblem },
      rearWin: { group: windowGroup, center: paneCenter, centerM: paneCenterM, sides: paneSides, sideM: paneM },
      flaps: { left: null, right: null, decalL: null, decalR: null, decalM: flapDecalM, material: flapM },
      mudguard: { group: mud, flap: apron, text: mudText, textM: mudTextM },
      stripes: { left: stripes, right: stripes, material: stripeM }, swish: { left: swish, right: swish, material: swishM },
      underglow: { group: ug, tubes: [tubesMesh], pool, tubeM, poolM }, dashAnchor, garlandAnchor,
    });
  }

  // ---- wheels: the front one steers; the pivot group turns, the tyre spins inside it. Both rear wheels are ONE spinning pair
  // (they always turn together), so the whole set is two spin groups.
  const rimM = hi ? mat('#a29a90', { roughness: 0.35, metalness: 0.5 }) : null;
  const spokeM = hi ? mat('#6c655d', { roughness: 0.4, metalness: 0.5 }) : null;
  const whiteM = hi ? mat('#f2f0ea', { roughness: 0.8, metalness: 0 }) : null;
  const wheels = [];
  const wheelParts = [];
  const mkWheel = (x, z, suffix) => {
    const holder = new Group();
    holder.position.set(x, 0.34, z);
    const spin = new Group();
    if (hi) {
      // tyre, rim, spokes and (hidden) whitewalls in ONE mesh of the uber material; the part handles are data bags
      const wheel = mesh(spin, geo[suffix ? 'wheelR' : 'wheel'], uberM, { cast: false, receive: true });
      wheel.onBeforeRender = syncLook;
      const whites = bag(whiteM);
      whites.visible = false;
      wheelParts.push({ tyre: bag(tyreM), rim: bag(rimM), cap: null, spokes: [bag(spokeM)], whites: [whites], mesh: wheel });
    } else {
      mesh(spin, geo['tyre' + suffix], tyreM, { cast: false });
    }
    holder.add(spin);
    g.add(holder);
    wheels.push(spin);
    return holder;
  };
  const front = mkWheel(0, 1.28, '');
  mkWheel(0, -0.82, 'R');
  if (hi) {
    bindSlot(uber, 'tyre', tyreM);
    bindSlot(uber, 'rim', rimM);
    bindSlot(uber, 'spokes', spokeM);
    bindSlot(uber, 'whites', whiteM, wheelParts[0].whites[0]); // (customize.js shows / hides both wheel sets' whitewalls together)
    // the materials that are only data now: customize.js gives them the environment map and strength like the drawn ones
    ud.envBag = [...new Set(uber.bindings.map((b) => b.m))].filter((m) => m.isMeshStandardMaterial);
    ud.uber = uber;
  }

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
      const p = buildStaticPerson({ pose: 'sit', scale: 0.9, castShadow: false });
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
    roofGroup, upperGroup, windowGroup, roofM, curtainM, curtains, glass, glassM, seatM, rimM, spokeM, tyreM, whiteM, wheelParts,
    tailLampM, tailRefM, hlLamp, chrome, detail: hi, canopyGeometry,
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
