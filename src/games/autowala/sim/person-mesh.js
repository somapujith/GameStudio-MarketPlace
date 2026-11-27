// Little people, cheap to draw. Every person is ONE draw call (and at most one shadow call), whatever their limbs do:
//  - `buildCustomerRig`: the waiting / walking customers (gameplay/customers.js). One SkinnedMesh per customer (one or two people
//    and an optional suitcase): the torso, head, hair, arms and legs are rigid pieces of ONE geometry bound to a small skeleton, and
//    the skeleton's bones are the limb handles the pose code already drives (`persons[i].userData.{lArm,rArm,lLeg,rLeg}` are Bones
//    with the same rest positions the old limb meshes had, so `.position` / `.rotation` writes animate exactly as before).
//    Every customer shares ONE material (vertex colours carry shirt / skin / hair / trousers), so the shader state never changes
//    between customers.
//  - `buildStaticPerson`: the driver and the bench-seat passengers of the player's auto (no limb animation): a plain Mesh with the
//    same vertex-coloured geometry. `userData.mats.shirt.color` & co. are real THREE.Colors that rewrite their vertex range when set,
//    so `seatPassengers` can recolour a rider with `mats.shirt.color.set('#...')` as before.
// The parts, poses and proportions are the ones `autoModel.buildPerson` always had; only the packaging changed.
import {
  Bone,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  BufferGeometry,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint8BufferAttribute,
  Vector3,
} from 'three';

/** One roughness for every person (it was 0.7 shirt / 0.8 skin and trousers / 0.9 hair: indistinguishable on cloth and skin). */
export const PERSON_ROUGHNESS = 0.8;
export const ROLES = ['shirt', 'skin', 'hair', 'legs', 'cap'];

// ------------------------------------------------------------------------------------------------------------ base shapes

const BASE = {};

/** The six shapes of a person as plain non-indexed arrays (cached per level of detail, never disposed). */
function bases(low) {
  const key = low ? 'lo' : 'hi';
  if (BASE[key]) return BASE[key];
  const cs = low ? 1 : 2;
  const rs = low ? 5 : 6;
  const raw = {
    torso: new CapsuleGeometry(0.2, 0.34, cs, low ? 6 : 8),
    head: new SphereGeometry(0.16, low ? 6 : 8, low ? 4 : 6),
    hair: new SphereGeometry(0.17, low ? 6 : 8, low ? 3 : 4, 0, Math.PI * 2, 0, Math.PI * 0.55),
    arm: new CapsuleGeometry(0.06, 0.34, cs, rs),
    leg: new CapsuleGeometry(0.085, 0.4, cs, rs),
    cap: new SphereGeometry(0.185, low ? 6 : 8, low ? 3 : 4, 0, Math.PI * 2, 0, Math.PI * 0.5),
    bag: new BoxGeometry(0.42, 0.62, 0.22),
  };
  const out = {};
  for (const [name, g] of Object.entries(raw)) {
    const n = g.index ? g.toNonIndexed() : g;
    out[name] = { pos: n.attributes.position.array, nor: n.attributes.normal.array, count: n.attributes.position.count };
    if (n !== g) n.dispose();
    g.dispose();
  }
  BASE[key] = out;
  return out;
}

/**
 * The parts of one person in the person's own frame, ordered by colour role (so every role is one contiguous vertex range):
 * { base, role, bone, x, y, z, rx }. `bone` names the limb that moves the part ('root' = the body).
 */
export function personSpec(pose = 'stand', cap = false) {
  const yB = pose === 'stand' ? 0.55 : 0.32;
  let arm = { x: 0.27, y: yB + 0.46, z: 0.06, rx: 0 };
  let leg = { x: 0.11, y: 0.34, z: 0, rx: 0 };
  if (pose === 'drive') {
    arm = { x: 0.27, y: yB + 0.46, z: 0.24, rx: -1.1 };
    leg = { x: 0.13, y: yB + 0.12, z: 0.26, rx: -1.35 };
  } else if (pose === 'sit') {
    arm = { x: 0.27, y: yB + 0.46, z: 0.06, rx: -0.35 };
    leg = { x: 0.13, y: yB + 0.1, z: 0.28, rx: -1.4 };
  }
  const spec = [
    { base: 'torso', role: 'shirt', bone: 'root', x: 0, y: yB + 0.42, z: 0, rx: 0 },
    { base: 'head', role: 'skin', bone: 'root', x: 0, y: yB + 0.92, z: 0, rx: 0 },
    { base: 'arm', role: 'skin', bone: 'lArm', ...arm, x: -arm.x },
    { base: 'arm', role: 'skin', bone: 'rArm', ...arm },
    { base: 'hair', role: 'hair', bone: 'root', x: 0, y: yB + 0.95, z: -0.01, rx: 0 },
    { base: 'leg', role: 'legs', bone: 'lLeg', ...leg, x: -leg.x },
    { base: 'leg', role: 'legs', bone: 'rLeg', ...leg },
  ];
  if (cap) spec.push({ base: 'cap', role: 'cap', bone: 'root', x: 0, y: yB + 0.98, z: 0.01, rx: 0 });
  return spec;
}

// ------------------------------------------------------------------------------------------------------------ assembling

const _m = new Matrix4();
const _t = new Matrix4();
const _n = new Matrix3();
const _v = new Vector3();
const _c = new Color();

/**
 * Stamp transformed copies of base shapes into one set of typed arrays.
 * items: [{ src, matrix (Matrix4), color (Color), bone (index) }] -> { pos, nor, col, bone, count, starts[] }
 */
function assemble(items) {
  let count = 0;
  for (const it of items) count += it.src.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const bone = new Uint8Array(count);
  const starts = [];
  let o = 0;
  for (const it of items) {
    starts.push(o);
    _n.getNormalMatrix(it.matrix);
    for (let i = 0; i < it.src.count; i++, o++) {
      _v.set(it.src.pos[i * 3], it.src.pos[i * 3 + 1], it.src.pos[i * 3 + 2]).applyMatrix4(it.matrix);
      pos[o * 3] = _v.x;
      pos[o * 3 + 1] = _v.y;
      pos[o * 3 + 2] = _v.z;
      _v.set(it.src.nor[i * 3], it.src.nor[i * 3 + 1], it.src.nor[i * 3 + 2]).applyMatrix3(_n).normalize();
      nor[o * 3] = _v.x;
      nor[o * 3 + 1] = _v.y;
      nor[o * 3 + 2] = _v.z;
      col[o * 3] = it.color.r;
      col[o * 3 + 1] = it.color.g;
      col[o * 3 + 2] = it.color.b;
      bone[o] = it.bone;
    }
  }
  return { pos, nor, col, bone, count, starts };
}

/** part placement T(x,y,z) * Rx(rx), left-multiplied by `parent` when given. */
function placement(target, part, parent) {
  target.makeRotationX(part.rx);
  target.setPosition(part.x, part.y, part.z);
  if (parent) target.premultiply(parent);
  return target;
}

// ------------------------------------------------------------------------------------------------------------ the shared material

let SHARED = null;

/** The one material of every customer. It is never disposed (a rig leaving the scene must not release a material others still use). */
export function sharedPersonMaterial() {
  if (!SHARED) {
    SHARED = new MeshStandardMaterial({ vertexColors: true, roughness: PERSON_ROUGHNESS, metalness: 0 });
    SHARED.name = 'aw-person';
    SHARED.dispose = () => {};
  }
  return SHARED;
}

const legColor = (female) => (female ? '#3a2a5a' : '#2a3350');

// ------------------------------------------------------------------------------------------------------------ customers

const BONES_PER_PERSON = 5; // root, lArm, rArm, lLeg, rLeg (after the ground bone)
const LIMBS = ['lArm', 'rArm', 'lLeg', 'rLeg'];

/**
 * A rig of one or two standing people (and a suitcase) as ONE skinned mesh.
 * people: [{ look: { shirt, skin, hair }, female, scale, x }]; bag: null | { x, color } (the suitcase stands on the ground).
 * Returns the SkinnedMesh: `userData.persons[i]` is that person's root Bone (position.y bounces, userData.{lArm,rArm,lLeg,rLeg} are
 * Bones). Move / rotate the mesh itself to place the customer. Disposing its geometry also frees the skeleton's bone texture.
 */
export function buildCustomerRig(people, bag = null) {
  const b = bases(false);
  const spec = personSpec('stand', false);
  const items = [];
  const ground = new Bone();
  ground.name = 'ground';
  const bones = [ground];
  const roots = [];
  people.forEach((p, i) => {
    const s = p.scale ?? 1;
    const px = p.x ?? 0;
    const first = bones.length;
    const root = new Bone();
    root.name = 'person';
    root.position.set(px, 0, 0);
    root.scale.setScalar(s);
    ground.add(root);
    bones.push(root);
    const limbs = {};
    for (const name of LIMBS) {
      const part = spec.find((q) => q.bone === name);
      const bone = new Bone();
      bone.name = name;
      bone.position.set(part.x, part.y, part.z);
      root.add(bone);
      bones.push(bone);
      limbs[name] = bone;
    }
    Object.assign(root.userData, limbs);
    roots.push(root);
    const parent = _t.makeScale(s, s, s).setPosition(px, 0, 0).clone();
    const look = p.look || {};
    const colors = {
      shirt: new Color(look.shirt ?? '#e8453c'),
      skin: new Color(look.skin ?? '#a86e4a'),
      hair: new Color(look.hair ?? '#1b1220'),
      legs: new Color(legColor(p.female)),
    };
    for (const part of spec) {
      const idx = part.bone === 'root' ? first : first + 1 + LIMBS.indexOf(part.bone);
      items.push({ src: b[part.base], matrix: placement(new Matrix4(), part, parent), color: colors[part.role], bone: idx });
    }
  });
  if (bag) {
    _m.makeTranslation(bag.x, 0.31, 0.15);
    items.push({ src: b.bag, matrix: _m.clone(), color: _c.set(bag.color).clone(), bone: 0 });
  }

  const a = assemble(items);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(a.pos, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(a.nor, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(a.col, 3));
  const skinIndex = new Uint8Array(a.count * 4);
  const skinWeight = new Uint8Array(a.count * 4);
  for (let i = 0; i < a.count; i++) {
    skinIndex[i * 4] = a.bone[i];
    skinWeight[i * 4] = 255;
  }
  geometry.setAttribute('skinIndex', new Uint8BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new Uint8BufferAttribute(skinWeight, 4, true));
  geometry.computeBoundingSphere();

  const mesh = new SkinnedMesh(geometry, sharedPersonMaterial());
  mesh.name = 'aw-customer';
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.add(ground);
  const skeleton = new Skeleton(bones);
  mesh.bind(skeleton);
  // the limbs swing outside the rest pose: a little slack so a raised arm never gets the whole customer culled
  mesh.boundingSphere = geometry.boundingSphere.clone();
  mesh.boundingSphere.radius += 0.5;
  geometry.addEventListener('dispose', () => skeleton.dispose());
  mesh.userData.persons = roots;
  return mesh;
}

// ------------------------------------------------------------------------------------------------------------ static people

/** A THREE.Color that tells its owner when it changes (set / copy / lerp ...), so a vertex range can follow it. */
class WatchedColor extends Color {
  constructor(hex, onChange) {
    super(hex);
    const wrap = (name) => {
      const base = Color.prototype[name];
      this[name] = (...args) => {
        base.apply(this, args);
        onChange();
        return this;
      };
    };
    for (const name of ['set', 'setHex', 'setRGB', 'setHSL', 'setStyle', 'setScalar', 'setColorName', 'copy', 'copySRGBToLinear', 'lerp', 'lerpColors', 'multiplyScalar', 'multiply']) wrap(name);
  }
}

/**
 * The driver / a passenger: a Group holding ONE vertex-coloured mesh (position the Group, scale it, lean it).
 * `merged`-style persons never animate limbs. userData.mats = { shirt, skin, hair, legs, cap? } each `{ color }`.
 */
export function buildStaticPerson({ shirt = '#e8453c', skin = '#a86e4a', hair = '#1b1220', cap = null, pose = 'stand', scale = 1, female = false, low = false, castShadow = true } = {}) {
  const b = bases(low);
  const spec = personSpec(pose, !!cap);
  const colors = { shirt: new Color(shirt), skin: new Color(skin), hair: new Color(hair), legs: new Color(legColor(female)), cap: new Color(low ? hair : cap || hair) }; // (the cheap traffic driver's cap is hair-coloured, as it always was)
  const items = spec.map((part) => ({ src: b[part.base], matrix: placement(new Matrix4(), part, null), color: colors[part.role], bone: 0 }));
  const a = assemble(items);
  // vertex range of every role (parts are ordered by role)
  const ranges = {};
  spec.forEach((part, i) => {
    const r = (ranges[part.role] ||= { start: a.starts[i], count: 0 });
    r.count += b[part.base].count;
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(a.pos, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(a.nor, 3));
  const colAttr = new Float32BufferAttribute(a.col, 3);
  geometry.setAttribute('color', colAttr);
  geometry.computeBoundingSphere();
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: PERSON_ROUGHNESS, metalness: 0 });
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = false;
  const g = new Group();
  g.add(mesh);
  g.scale.setScalar(scale);

  const paint = (role, color) => {
    const r = ranges[role];
    if (!r) return;
    for (let i = r.start; i < r.start + r.count; i++) colAttr.setXYZ(i, color.r, color.g, color.b);
    colAttr.needsUpdate = true;
  };
  const mats = {};
  for (const role of ROLES) {
    if (!ranges[role]) continue;
    const watched = new WatchedColor('#000000', () => paint(role, watched));
    // (the constructor's own writes ran before the watcher existed: load the baked colour without notifying)
    Color.prototype.copy.call(watched, colors[role]);
    mats[role] = { color: watched };
  }
  g.userData = { mats, mesh };
  return g;
}


// ------------------------------------------------------------------------------------------------------------ boot warm-up

/**
 * Put one hidden customer in the scene so the boot-time `renderer.compileAsync(scene, camera)` (it walks hidden meshes too) builds the
 * skinned, vertex-coloured shader now, instead of on the frame the first customer walks into view. Installed by `installCustomization`.
 */
export function installPersonWarmup(ctx) {
  if (!ctx?.scene) return;
  const warm = buildCustomerRig([{ look: {}, scale: 1, x: 0 }]);
  warm.name = 'aw-person-warmup';
  warm.visible = false;
  warm.castShadow = false;
  ctx.scene.add(warm);
  ctx.addSystem?.({
    dispose() {
      warm.removeFromParent();
      warm.geometry.dispose();
    },
  });
}
