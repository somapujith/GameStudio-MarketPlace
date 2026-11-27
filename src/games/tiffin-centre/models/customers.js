// Customers: Hyderabadi street-stall regulars with sculpted faces, real proportions (about 7.5 heads) and clothes, one distinct person per
// kind and per seed. The returned group FACES +z (towards the cook, first person); origin = between the feet.
//
//   buildCustomer(kindId, seed) -> { group, kind, mood, setMood, setPatience, setExpression, setSpeaking(ms, intensity), lookAt(vec3|null),
//                                    update(dt, t), dispose, triangles }
import { AdditiveBlending, CircleGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RingGeometry, Vector3 } from 'three';
import { CUSTOMER_KINDS } from '../../../../shared/tiffin-centre/catalog.js';
import { clamp01, countTriangles, damp, disposeObject, materials, num, rng, sharedGeo, sharedMat } from './util.js';
import { buildPerson } from './person.js';
import { makeFaceParams } from './facegen.js';
import { CH } from './bodies.js';
import { expressionForMood, EXPRESSION_NAMES } from './expressions.js';
import { Puffs } from './fx.js';
import { noteTexture } from './textures.js';
import { tiffinCarrier, walkingStick } from './clothes.js';
import { holdTool, makeTool } from './toolhost.js';
import { buildDish } from './dishes.js';
import { getCharacterQuality, getCharacterDrawMode } from './charquality.js';
import { mergeModel, limitShadowCasters } from './merge.js';
import { bakeRig } from './baked.js';
import { packPerson } from './pack.js';

export const MOODS = ['waiting', 'eating', 'paying', 'happy', 'angry', 'walkaway'];
export const CUSTOMER_KIND_IDS = Object.keys(CUSTOMER_KINDS);

const SHIRTS = ['#e8eef5', '#b7d0ea', '#f1e2e2', '#d9e8d2', '#cdd5ee', '#efe6c8', '#c9d8c5', '#e9d4c0'];
const DARKS = ['#2c3345', '#3a3a3c', '#4a3f35', '#51555f', '#3b4660'];
const BRIGHTS = ['#e0392b', '#ff8a1f', '#12908e', '#2f9e5b', '#7a4bb8', '#d6336c', '#e0a81f', '#2f6fd0'];
const TEES = ['#ff8a1f', '#12908e', '#e0392b', '#2f9e5b', '#7a4bb8', '#f2f2f2', '#2f6fd0', '#d6336c'];
const WHITES = ['#efeadb', '#f4efe0', '#dfe5db', '#ded3bd'];

const mm = (lo, hi, r) => lo + (hi - lo) * r();

/** The person spec of one customer of `kind` (deterministic in r). `role` 'child' builds the family's kid. */
function specFor(kind, seed, r, role) {
  const faceKind = role === 'child' ? 'child' : kind;
  const P = makeFaceParams(faceKind, seed);
  const f = P.gender === 'f';
  const spec = { kind: faceKind, seed, params: P, hair: {}, outfit: { extras: [] } };
  const o = spec.outfit;
  const hr = spec.hair;
  const col = P.hairColor;
  hr.color = col;
  if (role === 'child') {
    spec.height = mm(1.0, 1.16, r);
    hr.style = f ? 'pigtails' : 'bowl';
    hr.tieColor = r.pick(BRIGHTS);
    o.top = { kind: 'tee', color: r.pick(TEES), sleeve: 'short' };
    o.bottom = { kind: f ? 'skirt' : 'shorts', color: r.pick(BRIGHTS), hem: 0.62 };
    o.shoes = { kind: 'slipper', color: r.pick(BRIGHTS) };
    return spec;
  }
  switch (kind) {
    case 'office':
      spec.height = f ? mm(1.54, 1.64, r) : mm(1.66, 1.78, r);
      spec.belly = f ? 0 : r() < 0.35 ? mm(0.2, 0.55, r) : 0;
      if (f) {
        hr.style = r.pick(['long', 'plait', 'bunLow']);
        hr.gajra = r() < 0.25;
        o.top = { kind: 'kurti', color: r.pick(BRIGHTS), color2: '#f4f0e0', sleeve: r.pick(['short', 'half']), pattern: 'plain' };
        o.bottom = { kind: 'salwar', color: r.pick(DARKS) };
        o.extras.push({ id: 'dupatta', color: r.pick(BRIGHTS), pattern: 'sari', color2: '#e6c25a' }, { id: 'lanyard' });
        o.shoes = { kind: 'sandal', color: '#3b2a20' };
      } else {
        hr.style = r.pick(['combed', 'short', 'short']);
        o.top = { kind: 'shirt', color: r.pick(SHIRTS), sleeve: r() < 0.3 ? 'half' : 'long', pocket: true, tucked: true };
        o.bottom = { kind: 'trousers', color: r.pick(DARKS) };
        o.shoes = { kind: 'shoe', color: '#1d1612' };
        if (r() < 0.55) o.extras.push({ id: 'tie', color: r.pick(['#c0392b', '#1f3a6e', '#6a2c70', '#2f6e5a']) });
        else o.extras.push({ id: 'lanyard' });
        o.extras.push({ id: 'watch', side: 'R', color: '#b8bcc0' });
        spec.carry = 'tiffin';
      }
      break;
    case 'student':
      spec.height = f ? mm(1.52, 1.62, r) : mm(1.62, 1.74, r);
      if (f) {
        hr.style = r.pick(['plait', 'long', 'bun']);
        o.top = r() < 0.5 ? { kind: 'kurti', color: r.pick(BRIGHTS), sleeve: 'short', hem: 0.7 } : { kind: 'tee', color: r.pick(TEES), sleeve: 'short', untucked: true };
        o.bottom = { kind: 'jeans', color: r.pick(['#3b5b8c', '#2d4670', '#404552']) };
        if (r() < 0.4) o.extras.push({ id: 'dupatta', color: r.pick(BRIGHTS), pattern: 'plain' });
      } else {
        hr.style = r.pick(['short', 'combed', 'short']);
        o.top = { kind: 'tee', color: r.pick(TEES), sleeve: 'short' };
        o.bottom = { kind: r() < 0.2 ? 'shorts' : 'jeans', color: r.pick(['#3b5b8c', '#2d4670', '#404552']) };
      }
      o.shoes = { kind: r() < 0.5 ? 'shoe' : 'sandal', color: r() < 0.5 ? '#e8e3da' : '#2a4f9e' };
      o.extras.push({ id: 'backpack', color: r.pick(['#ff8a1f', '#12908e', '#e0392b', '#2f6fd0']) });
      spec.phone = true;
      break;
    case 'family':
      if (f) {
        spec.height = mm(1.52, 1.6, r);
        hr.style = r() < 0.2 ? 'none' : r.pick(['bun', 'plait', 'bunLow']);
        hr.gajra = r() < 0.6;
        if (r() < 0.22) hr.headwear = 'dupatta';
        hr.clothColor = r.pick(BRIGHTS);
        o.top = { kind: 'blouse', color: r.pick(BRIGHTS), sleeve: 'short' };
        const sc = r.pick(['#d6336c', '#12908e', '#7a4bb8', '#e0392b', '#2f9e5b']);
        o.bottom = { kind: 'saree', color: sc, pattern: 'sari', color2: '#e6c25a' };
        o.extras.push({ id: 'sariPallu', color: sc, color2: '#e6c25a' });
        o.shoes = { kind: 'sandal', color: '#3b2a20' };
      } else {
        spec.height = mm(1.64, 1.74, r);
        spec.belly = mm(0.1, 0.5, r);
        hr.style = r.pick(['short', 'combed']);
        o.top = { kind: 'shirt', color: r.pick(SHIRTS), sleeve: 'short', pocket: true };
        o.bottom = { kind: 'trousers', color: r.pick(DARKS) };
        o.shoes = { kind: 'slipper', color: '#3b2a20' };
      }
      break;
    case 'uncle':
      spec.height = mm(1.58, 1.68, r);
      spec.belly = mm(0.3, 0.8, r);
      hr.style = r.pick(['receding', 'receding', 'crop']);
      hr.grey = 0.8 + 0.2 * r();
      if (r() < 0.6) {
        hr.headwear = 'topi';
        hr.clothColor = r.pick(WHITES);
        hr.clothColor2 = '#cfc8b6';
      }
      o.top = { kind: 'kurta', color: r.pick(WHITES), sleeve: 'long', untucked: true };
      o.bottom = r() < 0.7 ? { kind: 'pyjama', color: r.pick(WHITES) } : { kind: 'lungi', color: r.pick(['#2f5da8', '#1f7a5c', '#8a2d2d']), color2: '#f0e6c8', hem: 0.18 };
      o.shoes = { kind: 'slipper', color: '#6b4a2b' };
      if (r() < 0.5) o.extras.push({ id: 'gamchha', color: '#e8e0cf', color2: '#8a8f99', side: -1 });
      o.extras.push({ id: 'watch', side: 'R', color: '#c0c4c8' });
      spec.stick = true;
      break;
    case 'autowala':
      spec.height = mm(1.62, 1.72, r);
      spec.belly = mm(0, 0.4, r);
      hr.style = r.pick(['short', 'short', 'crop']);
      if (r() < 0.45) {
        hr.headwear = 'cap';
        hr.clothColor = '#bfa95a';
      }
      o.top = { kind: 'shirt', color: '#bfa95a', sleeve: 'short', pocket: true, untucked: true };
      o.bottom = { kind: 'trousers', color: '#8f8247' };
      o.shoes = { kind: r() < 0.6 ? 'slipper' : 'sandal', color: '#2a4f9e' };
      o.extras.push({ id: 'gamchha', color: '#c0392b', color2: '#f3ede0', side: 1 });
      o.extras.push({ id: 'kada', side: 'R' });
      break;
    case 'techie':
    default:
      spec.height = f ? mm(1.56, 1.66, r) : mm(1.66, 1.78, r);
      if (f) {
        hr.style = r.pick(['long', 'bun', 'plait']);
        o.top = r() < 0.5 ? { kind: 'kurti', color: r.pick(['#6f7f6f', '#3d4e6b', '#a65d5d', '#7a4bb8']), sleeve: 'half', hem: 0.72 } : { kind: 'tee', color: r.pick(['#6f7f6f', '#8a8f99', '#3d4e6b']), sleeve: 'short', untucked: true };
        o.bottom = { kind: 'jeans', color: r.pick(['#3b5b8c', '#404552']) };
      } else {
        hr.style = r.pick(['short', 'combed']);
        o.top = { kind: 'tee', color: r.pick(['#6f7f6f', '#8a8f99', '#3d4e6b', '#a65d5d']), sleeve: 'short' };
        o.bottom = { kind: 'trousers', color: r.pick(['#b8a888', '#4a4f5a']) };
      }
      o.shoes = { kind: 'shoe', color: '#f1efe9' };
      o.extras.push({ id: 'lanyard' }, { id: 'laptopBag' });
      spec.phone = true;
  }
  return spec;
}

const C_GREEN = new Color('#3ddc84');
const C_AMBER = new Color('#ffb02e');
const C_RED = new Color('#ef3b2d');
const _col = new Color();
const RING_SEG = 40;
const _tgt = new Vector3();
const _wp = new Vector3();

function patienceColor(f, out) {
  if (f > 0.5) return out.copy(C_AMBER).lerp(C_GREEN, (f - 0.5) / 0.5);
  return out.copy(C_RED).lerp(C_AMBER, Math.min(1, f / 0.5));
}

const sm = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** buildCustomer(kindId, seed, { quality }) */
export function buildCustomer(kindId, seed = 0, opts = {}) {
  const kind = SPEC_KINDS.has(kindId) ? kindId : 'office';
  const quality = opts.quality || getCharacterQuality();
  const r = rng(`${kind}:${seed}`);
  const group = new Group();
  group.name = `customer-${kind}`;
  group.userData.kind = kind;
  const rig = new Group(); // turns away when they walk off
  group.add(rig);

  const people = [];
  const mainSpec = specFor(kind, seed, r, 'main');
  mainSpec.quality = quality;
  const main = buildPerson(mainSpec);
  rig.add(main.group);
  people.push({ p: main, spec: mainSpec, ph: r() * 6.28, kid: false });
  if (kind === 'family') {
    const kidSpec = specFor(kind, `${seed}:kid`, r, 'child');
    kidSpec.quality = quality === 'high' ? 'medium' : quality;
    const kid = buildPerson(kidSpec);
    kid.group.position.set(0.5, 0, 0.04);
    main.group.position.x = -0.16;
    rig.add(kid.group);
    people.push({ p: kid, spec: kidSpec, ph: r() * 6.28, kid: true });
  }
  group.userData.height = main.height + 0.04;

  // ---- props
  const M = people[0];
  const mp = main;
  const handL = mp.body.arms[0].hand;
  const handR = mp.body.arms[1].hand;
  let tiffin = null;
  if (mainSpec.carry === 'tiffin') {
    tiffin = tiffinCarrier(mp.body.S);
    tiffin.rotation.x = Math.PI;
    tiffin.position.set(0, 0.03, 0.0);
    handL.grip.add(tiffin);
  }
  let stick = null;
  if (mainSpec.stick) {
    stick = walkingStick(0.9 * mp.body.S);
    mp.group.add(stick);
  }
  let phone = null;
  if (mainSpec.phone) {
    phone = new Mesh(sharedGeo('cust:phone', () => new PlaneGeometry(0.07, 0.145)), sharedMat('cust:phoneMat', () => new MeshStandardMaterial({ color: '#111418', emissive: '#4a7cff', emissiveIntensity: 0.55, roughness: 0.3, side: DoubleSide })));
    phone.visible = false;
    phone.userData.noMerge = true;
    phone.position.set(0, 0.07, 0.03);
    phone.rotation.set(0, 0, 0);
    handL.grip.add(phone);
  }
  let plate = null;
  const ensurePlate = () => {
    if (plate) return plate;
    try {
      plate = buildDish(r.pick(['idly', 'dosa', 'masala_dosa', 'vada', 'poori']), 'good');
    } catch {
      plate = new Group();
    }
    plate.scale.setScalar(0.62 * Math.min(1.05, mp.body.S));
    plate.rotation.x = Math.PI / 2;
    plate.position.set(0, 0.06, 0.035);
    plate.visible = false;
    handL.grip.add(plate);
    return plate;
  };

  // paying: a glowing rupee note held out in the right hand
  const noteMat = new MeshStandardMaterial({ color: '#ffffff', map: noteTexture(), emissive: '#3dff8c', emissiveMap: noteTexture(), emissiveIntensity: 0.9, roughness: 0.6, side: DoubleSide });
  const note = new Mesh(sharedGeo('cust:note2', () => new PlaneGeometry(0.2, 0.1).rotateX(-Math.PI / 2)), noteMat);
  note.userData.noMerge = true;
  note.position.set(0, 0.11, 0.0);
  note.rotation.set(0, 0, Math.PI / 2);
  note.visible = false;
  handR.grip.add(note);
  const haloMat = new MeshBasicMaterial({ color: '#3dff8c', transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  const halo = new Mesh(sharedGeo('cust:halo2', () => new CircleGeometry(0.17, 16)), haloMat);
  halo.userData.noMerge = true;
  halo.position.set(0, 0.11, 0.012);
  halo.visible = false;
  handR.grip.add(halo);

  // angry: steam from both ears
  const earSteam = [
    new Puffs(mp.head.group, materials.steam(), 3, { x: -0.085, y: -0.01, z: 0, rise: 0.14, size: 0.036, speed: 0.9, drift: 0.03 }),
    new Puffs(mp.head.group, materials.steam(), 3, { x: 0.085, y: -0.01, z: 0, rise: 0.14, size: 0.036, speed: 0.9, drift: 0.03 }),
  ];

  // coin-shaped patience ring on the ground in front of the feet
  const ringG = new Group();
  ringG.position.y = 0.03;
  group.add(ringG);
  const coin = new Mesh(sharedGeo('cust:coin', () => new CircleGeometry(0.47, 28).rotateX(-Math.PI / 2)), sharedMat('cust:coinMat', () => new MeshBasicMaterial({ color: '#241a14', transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false })));
  ringG.add(coin);
  const edge = new Mesh(sharedGeo('cust:coinEdge', () => new RingGeometry(0.44, 0.485, 28, 1).rotateX(-Math.PI / 2)), sharedMat('cust:coinEdgeMat', () => new MeshBasicMaterial({ color: '#ffc83d', depthWrite: false, toneMapped: false, side: DoubleSide })));
  edge.position.y = 0.002;
  ringG.add(edge);
  const fillGeo = new RingGeometry(0.31, 0.41, RING_SEG, 1, Math.PI / 2, -Math.PI * 2).rotateX(-Math.PI / 2);
  fillGeo.userData.shared = false;
  const fillMat = new MeshBasicMaterial({ color: '#3ddc84', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, side: DoubleSide });
  const fill = new Mesh(fillGeo, fillMat);
  fill.position.y = 0.004;
  ringG.add(fill);

  let mood = 'waiting';
  let patience = 1;
  let disposed = false;
  let lastSegs = -1;
  let turn = 0; // 0 faces the cook, PI faces away
  let exprOverride = null;
  let lookOverride = null;
  let lastExpr = '';
  let shown = '';
  let hop = 0;

  const expressionNow = () => exprOverride || expressionForMood(mood, patience);
  const refreshExpression = (force) => {
    const e = expressionNow();
    if (e === lastExpr && !force) return;
    lastExpr = e;
    const ms = e === 'angry' || e === 'surprised' ? 160 : 320;
    for (const q of people) q.p.setExpression(q.kid && e === 'angry' ? 'sad' : e, 1, ms);
  };

  // --------------------------------------------------------------------------------------------------------------------------------
  // body language: every frame the targets are rebuilt from the mood, the channels smooth them
  const armRest = (b, sd) => {
    b.setArm(sd, { aw: 0, pole: 0 });
  };
  const poseFor = (q, t) => {
    const p = q.p;
    const b = p.body;
    const S = b.S;
    const T = b.pose.tgt;
    b.resetPose();
    const phs = q.ph;
    const kid = q.kid;
    const set = (n, v) => {
      T[CH[n]] = v;
    };
    // breathing and weight shift
    set('spPitch', 0.012 * Math.sin(t * 1.9 + phs));
    set('hipX', 0.012 * S * Math.sin(t * 0.45 + phs));
    set('hipRoll', 0.02 * Math.sin(t * 0.45 + phs + 1));
    set('hipYaw', 0.05 * Math.sin(t * 0.3 + phs));
    let bias = p.headBias;
    bias.pitch = 0;
    bias.yaw = 0;
    bias.roll = 0;
    if (kind === 'uncle' && !kid) {
      set('spPitch', 0.07 + 0.012 * Math.sin(t * 1.9 + phs));
      bias.pitch = -0.06;
    }
    const sx = (side) => (side === 'L' ? 1 : -1);
    const arm = (side, o) => b.setArm(side, o);
    const sc = (v) => v * S;
    let phoneUp = false;
    let showPlate = false;
    let showNote = false;
    const calm = kid ? 0.0 : 1;
    // carried things keep the left hand busy in the resting pose
    const restCarry = () => {
      if (tiffin && !kid) arm('L', { pos: [sc(0.21), sc(-0.02), sc(0.07)], dir: [0, -1, 0.05], palm: [-1, 0, 0.2], aw: 1, curl: [0.78, 0.82, 0.86, 0.9, 0.6], spread: 0 });
      if (stick && !kid) arm('L', { pos: [sc(0.2), sc(0.0), sc(0.15)], dir: [0.1, -1, 0.1], palm: [-1, 0, 0.1], aw: 1, curl: [0.75, 0.8, 0.85, 0.9, 0.55], spread: 0 });
    };
    switch (mood) {
      case 'waiting': {
        const rate = 5 + (1 - patience) * 6;
        if (kid) {
          set('hipY', Math.abs(Math.sin(t * 3 + phs)) * 0.025 * S);
          arm('L', { pos: [sc(0.2), sc(0.0), sc(0.1)], aw: 0 });
          arm('R', { pos: [sc(-0.2), sc(0.0), sc(0.1)], aw: 0 });
          break;
        }
        restCarry();
        if (patience > 0.66) {
          // calm: eyes on the menu, now and then a shift of weight and a glance at the phone
          if (q.p.params.gender === 'f' && kind !== 'uncle') set('hipRoll', 0.035 * Math.sin(t * 0.45 + phs + 1));
          if (phone && sm(0.0, 0.5, Math.sin(t * 0.21 + phs * 3)) > 0.82) phoneUp = true;
        } else if (patience > 0.4) {
          // bored: hand on the hip, shifting about
          arm('R', { pos: [sc(-0.205), sc(-0.02), sc(-0.01)], dir: [-0.1, -0.7, 0.55], palm: [1, 0, -0.1], aw: 1, pole: 1, curl: [0.3, 0.4, 0.45, 0.5, 0.2] });
          set('hipRoll', 0.05 * Math.sin(t * 0.7 + phs));
          set('fRz', 0.03 * Math.max(0, Math.sin(t * 1.4 + phs)));
          if (phone) phoneUp = true;
        } else if (patience > 0.2) {
          // impatient: arms crossed, foot tapping, a look at the wrist
          const tap = Math.max(0, Math.sin(t * rate + phs));
          set('fRz', 0.07 * S * tap);
          set('fRy', 0.01 * tap);
          set('fRtoe', tap * 0.35);
          if (Math.sin(t * 0.8 + phs) > 0.7 && !tiffin && !stick) {
            arm('L', { pos: [sc(0.07), sc(0.27), sc(0.26)], dir: [-0.5, 0.45, 0.4], palm: [0, 0.6, -0.8], aw: 1, pole: 0.4, curl: [0.15, 0.2, 0.25, 0.3, 0.1] });
            arm('R', { pos: [sc(-0.13), sc(0.14), sc(0.17)], dir: [1, 0.1, 0], palm: [0, 0, -1], aw: 1, pole: 0.8, curl: [0.2, 0.25, 0.3, 0.35, 0.2] });
            bias.pitch = 0.2;
          } else if (!tiffin && !stick) {
            arm('L', { pos: [sc(-0.12), sc(0.15), sc(0.165)], dir: [-1, 0.1, 0], palm: [0, 0, -1], aw: 1, pole: 0.9, curl: [0.25, 0.3, 0.35, 0.4, 0.2] });
            arm('R', { pos: [sc(0.13), sc(0.125), sc(0.18)], dir: [1, 0.1, 0], palm: [0, 0, -1], aw: 1, pole: 0.9, curl: [0.25, 0.3, 0.35, 0.4, 0.2] });
          } else {
            arm('R', { pos: [sc(-0.14), sc(0.14), sc(0.2)], dir: [1, 0.1, 0], palm: [0, 0, -1], aw: 1, pole: 0.8, curl: [0.25, 0.3, 0.35, 0.4, 0.2] });
          }
          bias.roll = 0.06;
          set('spPitch', 0.03);
        } else {
          // furious: fists, hunched shoulders, shaking
          const sh = Math.sin(t * 24) * 0.012;
          set('spPitch', 0.1 + sh);
          arm('L', { pos: [sc(0.2), sc(-0.0 + sh), sc(0.17)], dir: [0, -0.5, 0.8], palm: [-1, 0, 0], aw: 0.4, pole: 0.7, curl: [1, 1, 1, 1, 0.95], spread: 0 });
          arm('R', { pos: [sc(-0.2), sc(-0.0 - sh), sc(0.17)], dir: [0, -0.5, 0.8], palm: [1, 0, 0], aw: 0.4, pole: 0.7, curl: [1, 1, 1, 1, 0.95], spread: 0 });
          bias.pitch = 0.08;
        }
        break;
      }
      case 'eating': {
        showPlate = true;
        const bite = 0.5 + 0.5 * Math.sin(t * 2.0 + phs);
        const up = sm(0.15, 0.55, bite) - sm(0.7, 0.95, bite);
        const mz = sc(0.2);
        arm('L', { pos: [sc(0.08), sc(0.14), sc(0.27)], dir: [0, 0, 1], palm: [0, 1, 0], aw: 1, pole: 0.3, curl: [0.28, 0.3, 0.33, 0.38, 0.1], spread: 0.22 });
        arm('R', { pos: [sc(-0.05 + 0.03 * up), sc(0.17 + 0.25 * up), mz + sc(0.12) * (1 - up)], dir: [0.05, 0.6 + 0.4 * up, 0.8 - 0.5 * up], palm: [0.6, 0.3, 0], aw: 1, pole: 0.6, curl: [0.45, 0.6, 0.65, 0.7, 0.55], spread: 0.05 });
        bias.pitch = 0.1 + 0.05 * bite;
        break;
      }
      case 'paying': {
        showNote = true;
        restCarry();
        if (!kid) arm('L', tiffin || stick ? {} : { pos: [sc(0.2), sc(-0.03), sc(0.02)], aw: 0 });
        const reach = 0.5 + 0.03 * Math.sin(t * 3);
        arm('R', { pos: [sc(-0.07), sc(0.25), sc(0.18) + sc(reach) * (kid ? 0.55 : 0.6)], dir: [0, 0.12, 1], palm: [0.4, 1, 0], aw: 1, pole: 0.3, curl: [0.4, 0.55, 0.62, 0.7, 0.55], spread: 0.05 });
        set('spPitch', 0.05);
        bias.pitch = -0.04;
        break;
      }
      case 'happy': {
        const hp = Math.abs(Math.sin(t * 7 + phs));
        hop = hp;
        set('hipY', hp * (kid ? 0.07 : 0.05) * S);
        const sw = Math.sin(t * 14) * 0.03 * S;
        arm('L', { pos: [sc(0.29), sc(0.6) + sw, sc(0.1)], dir: [0.2, 1, 0.2], palm: [0, 0, 1], aw: 1, pole: 0.5, curl: [0.1, 0.1, 0.12, 0.15, 0.05], spread: 0.4 });
        arm('R', { pos: [sc(-0.29), sc(0.6) - sw, sc(0.1)], dir: [-0.2, 1, 0.2], palm: [0, 0, 1], aw: 1, pole: 0.5, curl: [0.1, 0.1, 0.12, 0.15, 0.05], spread: 0.4 });
        set('fLy', hp * 0.05);
        set('fRy', hp * 0.05);
        set('spPitch', -0.06);
        break;
      }
      case 'angry': {
        const sh = Math.sin(t * 26 + phs) * 0.01;
        set('spPitch', 0.12 + sh);
        if (!kid && r.range(0, 1) >= 0) {
          arm('L', { pos: [sc(0.22), sc(0.05 + sh), sc(0.2)], dir: [0, -0.4, 0.9], palm: [-1, 0, 0], aw: 0.6, pole: 0.9, curl: [1, 1, 1, 1, 0.95], spread: 0 });
          arm('R', { pos: [sc(-0.2), sc(0.2), sc(0.3)], dir: [0, 0.4, 0.9], palm: [1, -0.2, 0], aw: 0.7, pole: 0.7, curl: [0.04, 1, 1, 1, 0.9], spread: 0 }); // pointing at the cook
        } else {
          arm('L', { pos: [sc(0.18), sc(0.0), sc(0.15)], dir: [0, -0.4, 0.9], palm: [-1, 0, 0], aw: 0.5, curl: [1, 1, 1, 1, 0.95] });
          arm('R', { pos: [sc(-0.18), sc(0.0), sc(0.15)], dir: [0, -0.4, 0.9], palm: [1, 0, 0], aw: 0.5, curl: [1, 1, 1, 1, 0.95] });
        }
        const st = Math.max(0, Math.sin(t * 9 + phs));
        set('fLz', 0.03 * st);
        set('hipRoll', 0.04 * Math.sin(t * 6));
        bias.pitch = 0.1;
        bias.yaw = Math.sin(t * 17) * 0.05;
        break;
      }
      case 'walkaway': {
        const ph = t * 6.5 + phs;
        const w = Math.sin(ph);
        const stride = (mainSpec.outfit?.bottom?.kind === 'lungi' ? 0.12 : 0.2) * S;
        set('fLz', stride * w);
        set('fRz', -stride * w);
        set('fLy', Math.max(0, Math.cos(ph)) * 0.075 * S);
        set('fRy', Math.max(0, -Math.cos(ph)) * 0.075 * S);
        set('hipY', -Math.abs(Math.cos(ph)) * 0.02 * S);
        set('hipYaw', 0.08 * w);
        set('spYaw', -0.12 * w);
        arm('L', { pos: [sc(0.2), sc(-0.02), sc(0.02 - 0.13 * w)], aw: 0 });
        arm('R', { pos: [sc(-0.2), sc(-0.02), sc(0.02 + 0.13 * w)], aw: 0 });
        set('spPitch', 0.07);
        bias.pitch = 0.1;
        bias.yaw = 0.1;
        break;
      }
      default:
    }
    q.phoneUp = phoneUp;
    if (!kid) {
      if (phone) phone.visible = phoneUp && mood === 'waiting';
      if (q === M) {
        if (plate || showPlate) ensurePlate().visible = showPlate;
        note.visible = halo.visible = showNote;
        if (tiffin) tiffin.visible = true;
      }
    }
    void calm;
    void armRest;
    void CUSTOMER_KINDS;
  };

  const api = {
    group,
    kind,
    get mood() {
      return mood;
    },
    people,
    setMood(m) {
      const next = MOODS.includes(m) ? m : 'waiting';
      if (next !== mood) {
        mood = next;
        for (const q of people) q.p.body.rate = mood === 'angry' || mood === 'walkaway' ? 16 : 11;
      }
      ringG.visible = mood === 'waiting' || mood === 'paying';
      exprOverride = null;
      refreshExpression(true);
      lastSegs = -1;
    },
    setPatience(f) {
      patience = clamp01(num(f, 1));
      refreshExpression(false);
    },
    /** Direct expression override (any of EXPRESSION_NAMES); setMood() clears it. */
    setExpression(name, weight = 1, blendMs = 250) {
      if (!EXPRESSION_NAMES.includes(name)) return;
      exprOverride = name;
      lastExpr = name;
      for (const q of people) q.p.setExpression(name, weight, blendMs);
    },
    /** The mouth moves (and the head nods) for `ms` milliseconds. */
    setSpeaking(ms, intensity = 0.7) {
      main.setSpeaking(ms, intensity);
      if (people[1] && num(ms, 0) > 1500) people[1].p.setSpeaking(ms * 0.3, intensity * 0.6);
    },
    /** World-space point the eyes and head follow (the cook's eyes). null returns to the default (straight at the cook line). */
    lookAt(v) {
      lookOverride = v && Number.isFinite(v.x + v.y + v.z) ? v.clone() : null;
    },
    update(dt, t) {
      if (disposed) return;
      const d = Math.min(0.1, Math.max(0, num(dt, 0.016)));
      const tt = num(t, 0);
      // heading: they turn their back when they walk off
      turn = damp(turn, mood === 'walkaway' ? Math.PI : 0, mood === 'walkaway' ? 5 : 8, d);
      rig.rotation.y = turn;
      group.updateWorldMatrix(true, false);
      group.getWorldPosition(_wp);
      for (let i = 0; i < people.length; i++) {
        const q = people[i];
        poseFor(q, tt);
        if (lookOverride) q.p.lookAt(lookOverride);
        else if (q.phoneUp) {
          handL.group.getWorldPosition(_tgt);
          q.p.lookAt(_tgt);
        } else q.p.lookAt(_tgt.set(_wp.x * 0.6, 1.5 * (i ? 0.7 : 1), _wp.z + 2.6));
        q.p.update(d, tt + i * 0.37);
      }
      // the stick is planted on the ground beside the left foot
      if (stick) {
        mp.body.torsoToRoot(_tgt.copy(handL.group.position), _wp);
        stick.position.set(_wp.x, _wp.y - 0.0, _wp.z);
        stick.rotation.set(0, 0, 0);
        // tilt a little so the tip stays near the foot
        const dx = 0.2 * mp.body.S - _wp.x;
        stick.rotation.z = Math.atan2(-dx, Math.max(0.3, _wp.y)) * 0.6;
        stick.rotation.x = -0.05;
      }
      earSteam[0].update(tt, mood === 'angry');
      earSteam[1].update(tt, mood === 'angry', 0.3);
      if (ringG.visible) {
        const f = patience;
        const segs = Math.max(f > 0.001 ? 1 : 0, Math.ceil(f * RING_SEG));
        if (segs !== lastSegs) {
          fillGeo.setDrawRange(0, segs * 6);
          lastSegs = segs;
        }
        patienceColor(f, fillMat.color);
        const low = f < 0.25;
        const pulse = low ? 1 + 0.07 * Math.sin(tt * 11) : 1;
        ringG.scale.set(pulse, 1, pulse);
        ringG.rotation.y = f < 0.1 ? Math.sin(tt * 40) * 0.05 : 0;
        fillMat.opacity = low ? 0.7 + 0.3 * Math.sin(tt * 11) : 0.95;
      }
      if (mood === 'paying') {
        const f = patience;
        patienceColor(f, _col);
        noteMat.emissive.copy(_col);
        haloMat.color.copy(_col);
        const rate = f < 0.25 ? 14 : 4;
        noteMat.emissiveIntensity = 0.75 + 0.45 * Math.sin(tt * rate);
        haloMat.opacity = 0.22 + 0.18 * Math.sin(tt * rate + 1);
        note.rotation.y = Math.sin(tt * 3) * 0.08;
        const s = 0.7 + 0.3 * f; // the note visibly shrinks as the pay window runs out
        note.scale.set(s, s, s);
        halo.scale.setScalar(0.6 + 0.4 * f);
      }
      // everything has moved: the packed meshes follow the rig (models/pack.js)
      if (api.packs) for (let i = 0; i < api.packs.length; i++) api.packs[i].update();
      void shown;
      void hop;
    },
    get triangles() {
      return countTriangles(group);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (api.packs) for (const pk of api.packs) pk.dispose();
      for (const q of people) q.p.dispose();
      disposeObject(group);
    },
  };
  for (const q of people) {
    q.p.body.pose.snap();
    poseFor(q, 0);
    q.p.body.pose.snap();
    q.p.update(0.016, 0);
  }
  api.setMood('waiting');
  api.update(0.016, 0);
  const mode = opts.draw || getCharacterDrawMode();
  if (mode.baked) {
    // lite: a hidden rig drives 1-3 shared dynamic meshes (baked.js)
    api.baked = bakeRig(api, { roots: people.map((q) => q.p.group) });
  } else if (mode.pack) {
    // medium / high: a person is a handful of dynamic meshes (skin, eyes, hair, clothes) instead of ~60 draw calls (models/pack.js)
    api.packs = people.map((q) => packPerson(q.p.group)).filter(Boolean);
  } else if (mode.merge) {
    // measure what never moves relative to its rigid frame across every mood, patience band, expression and a spoken line, then merge it per material
    const states = [['waiting', 1], ['waiting', 0.55], ['waiting', 0.3], ['waiting', 0.1], ['eating', 0.8], ['paying', 0.8], ['paying', 0.1], ['happy', 1], ['angry', 0.05], ['walkaway', 0.5]];
    api.merge = mergeModel(group, (sample) => {
      let t = 0.2;
      for (const [m, p] of states) {
        api.setMood(m);
        api.setPatience(p);
        for (let i = 0; i < 3; i++) {
          t += 0.37;
          api.update(0.05, t);
          sample();
        }
      }
      for (const e of EXPRESSION_NAMES) {
        api.setExpression(e, 1, 100);
        api.update(0.1, (t += 0.3));
        sample();
      }
      api.setSpeaking(800, 0.8);
      api.update(0.1, (t += 0.2));
      sample();
      api.setMood('waiting');
      api.setPatience(1);
      for (const q of people) {
        q.p.body.pose.snap();
        poseFor(q, 0);
        q.p.body.pose.snap();
      }
      api.update(0.016, 0);
    });
  }
  if (mode.limitShadows) limitShadowCasters(group);
  return api;
}

const SPEC_KINDS = new Set(['office', 'student', 'family', 'uncle', 'autowala', 'techie']);
void holdTool;
void makeTool;
