// The two officials of the operations layer, built from the same person parts as the customers (sculpted face, hair, body with IK arms, clothes):
//   buildInspector(seed)   the GHMC food-safety inspector: a pressed half-sleeve shirt, a lanyard with his ID card, a watch, a clipboard in the left
//                          hand and a pen in the right; he writes, looks the stall over, then shows thumbs-up (pass) or a stern pointed finger (fail)
//   buildDeliveryBoy(seed) the tiffin delivery rider: a red company tee and cap (generic, no real brand), a phone in one hand, a big red insulated bag
//                          hanging from the other
// Both return the customer API ({ group, kind, mood, setMood, setPatience, setExpression, setSpeaking, lookAt, update, dispose, triangles }) so the scene
// can treat them like any other person at the counter. The group FACES +z (towards the cook); origin = between the feet. Moods: waiting | happy |
// angry | walkaway ('eating' and 'paying' read as waiting).
import { BoxGeometry, CircleGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Vector3 } from 'three';
import { buildPerson } from './person.js';
import { makeFaceParams } from './facegen.js';
import { CH } from './bodies.js';
import { expressionForMood, EXPRESSION_NAMES } from './expressions.js';
import { clamp01, countTriangles, damp, disposeObject, num, rng, sharedGeo, sharedMat } from './util.js';
import { getCharacterQuality } from './charquality.js';

export const OFFICIAL_MOODS = ['waiting', 'eating', 'paying', 'happy', 'angry', 'walkaway'];
export const OFFICIAL_ROLES = ['inspector', 'delivery'];

const SHIRTS = ['#e9eef3', '#cfe0ee', '#eef0e4'];
const mm = (lo, hi, r) => lo + (hi - lo) * r();
const _wp = new Vector3();
const _tgt = new Vector3();

/** The person spec of an official (deterministic in seed). Exported for the tests. */
export function officialSpec(role, seed) {
  const r = rng(`official:${role}:${seed}`);
  const delivery = role === 'delivery';
  const P = makeFaceParams(delivery ? 'autowala' : 'office', `${role}:${seed}`, { gender: 'm', age: delivery ? mm(19, 27, r) : mm(40, 54, r) });
  const spec = { kind: delivery ? 'autowala' : 'office', seed: `${role}:${seed}`, params: P, hair: {}, outfit: { extras: [] } };
  const o = spec.outfit;
  const hr = spec.hair;
  hr.color = P.hairColor;
  spec.height = delivery ? mm(1.64, 1.74, r) : mm(1.68, 1.78, r);
  if (delivery) {
    hr.style = 'short';
    hr.headwear = 'cap';
    hr.clothColor = '#d3281c';
    o.top = { kind: 'tee', color: '#d3281c', sleeve: 'short' };
    o.bottom = { kind: 'jeans', color: '#2f3d5a' };
    o.shoes = { kind: 'shoe', color: '#1d1d1f' };
    o.extras.push({ id: 'watch', side: 'R', color: '#222' });
  } else {
    hr.style = r() < 0.5 ? 'combed' : 'short';
    spec.belly = mm(0.05, 0.4, r);
    o.top = { kind: 'shirt', color: r.pick(SHIRTS), sleeve: 'half', pocket: true, tucked: true };
    o.bottom = { kind: 'trousers', color: '#3b4048' };
    o.shoes = { kind: 'shoe', color: '#1d1612' };
    o.extras.push({ id: 'lanyard', color: '#12908e' }, { id: 'watch', side: 'R', color: '#b8bcc0' });
  }
  return spec;
}

const flat = (key, make) => sharedGeo(`official:${key}`, make);
const mat = (key, color, rough = 0.7, extra = {}) => sharedMat(`official:${key}`, () => new MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra }));

/** A clipboard seen from the front: a brown board, a steel clip, a sheet with ruled lines. Held by the grip. */
function clipboard() {
  const g = new Group();
  g.name = 'clipboard';
  const board = new Mesh(flat('cb', () => new BoxGeometry(0.235, 0.32, 0.012)), mat('cbBoard', '#8a6a42', 0.8));
  const sheet = new Mesh(flat('cbs', () => new PlaneGeometry(0.205, 0.27)), mat('cbSheet', '#f6f3ea', 0.9, { side: DoubleSide }));
  sheet.position.z = 0.0072;
  const clip = new Mesh(flat('cbc', () => new BoxGeometry(0.1, 0.03, 0.02)), mat('cbClip', '#b8bec3', 0.35, { metalness: 1 }));
  clip.position.set(0, 0.155, 0.01);
  g.add(board, sheet, clip);
  const lineMat = mat('cbLine', '#6a7a9a', 0.9);
  for (let i = 0; i < 7; i++) {
    const ln = new Mesh(flat('cbl', () => new PlaneGeometry(0.17, 0.004)), lineMat);
    ln.position.set(0, 0.095 - i * 0.034, 0.0076);
    g.add(ln);
  }
  // a green tick box, red cross on the sheet: the form being filled in
  const tick = new Mesh(flat('cbt', () => new PlaneGeometry(0.03, 0.03)), mat('cbTick', '#2f9e5b', 0.8));
  tick.position.set(-0.06, 0.06, 0.0078);
  g.add(tick);
  return g;
}

/** The big red insulated delivery bag (generic: a bowl-and-steam mark, no real brand). */
function deliveryBag() {
  const g = new Group();
  g.name = 'delivery-bag';
  const red = mat('bagRed', '#d3281c', 0.55);
  const body = new Mesh(flat('bag', () => new BoxGeometry(0.4, 0.4, 0.3)), red);
  body.position.y = -0.2;
  const lid = new Mesh(flat('bagLid', () => new BoxGeometry(0.41, 0.07, 0.31)), mat('bagLid', '#ab1d14', 0.55));
  lid.position.y = -0.035;
  const strapMat = mat('bagStrap', '#222222', 0.8);
  const strap = new Mesh(flat('bagStrap', () => new BoxGeometry(0.04, 0.5, 0.03)), strapMat);
  strap.position.set(0, -0.05, 0.16);
  // the front face: a white disc with a bowl, and a stripe
  const stripe = new Mesh(flat('bagStripe', () => new PlaneGeometry(0.4, 0.05)), mat('bagStripe', '#ffe9c0', 0.6, { side: DoubleSide }));
  stripe.position.set(0, -0.31, 0.1515);
  const disc = new Mesh(flat('bagDisc', () => new CircleGeometry(0.085, 20)), new MeshBasicMaterial({ color: '#fff4e0', toneMapped: false }));
  disc.position.set(0, -0.19, 0.1518);
  const bowl = new Mesh(flat('bagBowl', () => new CircleGeometry(0.045, 14, Math.PI, Math.PI)), new MeshBasicMaterial({ color: '#d3281c', toneMapped: false, side: DoubleSide }));
  bowl.position.set(0, -0.2, 0.152);
  g.add(body, lid, strap, stripe, disc, bowl);
  g.userData.own = [disc.material, bowl.material];
  return g;
}

/** buildOfficial(role, seed, { quality }) -> the customer-like API. */
function buildOfficial(role, seed = 0, opts = {}) {
  const delivery = role === 'delivery';
  const quality = opts.quality || getCharacterQuality();
  const spec = officialSpec(role, seed);
  spec.quality = quality;
  const person = buildPerson(spec);
  const group = new Group();
  group.name = `official-${role}`;
  group.userData.kind = role;
  const rig = new Group(); // turns away when they walk off
  group.add(rig);
  rig.add(person.group);
  group.userData.height = person.height + 0.04;
  const b = person.body;
  const S = b.S;
  const handL = b.arms[0].hand;
  const handR = b.arms[1].hand;

  let prop = null;
  if (delivery) {
    prop = deliveryBag();
    prop.position.set(0.0, 0.02, 0.0);
    handL.grip.add(prop);
    prop.rotation.set(Math.PI, 0, 0); // the grip's frame points the bag down
    prop.scale.setScalar(0.95);
  } else {
    prop = clipboard();
    prop.position.set(0.0, 0.07, 0.04);
    prop.rotation.set(-0.35, 0.1, 0.0);
    handL.grip.add(prop);
  }
  // the inspector's pen (right) and the rider's phone (right)
  let pen = null;
  let phone = null;
  if (!delivery) {
    pen = new Mesh(flat('pen', () => new BoxGeometry(0.008, 0.008, 0.14)), mat('pen', '#1f3f8f', 0.4));
    pen.position.set(0, 0.06, 0.03);
    pen.rotation.x = 0.6;
    handR.grip.add(pen);
  } else {
    phone = new Mesh(flat('phone', () => new PlaneGeometry(0.07, 0.145)), new MeshStandardMaterial({ color: '#111418', emissive: '#4a7cff', emissiveIntensity: 0.55, roughness: 0.3, side: DoubleSide }));
    phone.position.set(0, 0.07, 0.03);
    handR.grip.add(phone);
  }

  const r = rng(`o:${role}:${seed}`);
  const ph = r() * 6.28;
  let mood = 'waiting';
  let patience = 1;
  let turn = 0;
  let exprOverride = null;
  let lookOverride = null;
  let lastExpr = '';
  let disposed = false;
  const sc = (v) => v * S;

  const expressionNow = () => exprOverride || (mood === 'waiting' || mood === 'eating' || mood === 'paying' ? 'neutral' : expressionForMood(mood, patience));
  const refreshExpression = (force) => {
    const e = expressionNow();
    if (e === lastExpr && !force) return;
    lastExpr = e;
    person.setExpression(e, 1, e === 'angry' ? 160 : 320);
  };

  const poseFor = (t) => {
    const T = b.pose.tgt;
    b.resetPose();
    const set = (n, v) => {
      T[CH[n]] = v;
    };
    const arm = (side, o) => b.setArm(side, o);
    const bias = person.headBias;
    bias.pitch = 0;
    bias.yaw = 0;
    bias.roll = 0;
    set('spPitch', 0.012 * Math.sin(t * 1.9 + ph));
    set('hipX', 0.012 * S * Math.sin(t * 0.45 + ph));
    set('hipYaw', 0.05 * Math.sin(t * 0.3 + ph));
    let showPen = !delivery;
    switch (mood) {
      case 'happy': {
        if (delivery) {
          // hands the bag over with a flourish: the free hand up
          arm('R', { pos: [sc(-0.29), sc(0.5), sc(0.12)], dir: [-0.2, 1, 0.3], palm: [0, 0, 1], aw: 1, pole: 0.5, curl: [0.1, 0.1, 0.12, 0.15, 0.05], spread: 0.4 });
          arm('L', { pos: [sc(0.2), sc(-0.03), sc(0.06)], aw: 0 });
        } else {
          // thumbs-up, clipboard lowered: PASSED
          arm('L', { pos: [sc(0.2), sc(0.0), sc(0.1)], dir: [0, -1, 0.1], palm: [-1, 0, 0.2], aw: 1, curl: [0.7, 0.8, 0.85, 0.9, 0.5] });
          arm('R', { pos: [sc(-0.13), sc(0.3), sc(0.32)], dir: [0, 0.9, 0.35], palm: [1, 0.2, 0], aw: 1, pole: 0.4, curl: [0.0, 1, 1, 1, 1], spread: 0 });
          set('spPitch', -0.04);
          bias.pitch = -0.05;
          bias.yaw = Math.sin(t * 5) * 0.06; // a nod
          showPen = false;
        }
        break;
      }
      case 'angry': {
        if (delivery) {
          arm('R', { pos: [sc(-0.2), sc(0.2), sc(0.3)], dir: [0, 0.4, 0.9], palm: [1, -0.2, 0], aw: 0.7, pole: 0.7, curl: [0.04, 1, 1, 1, 0.9], spread: 0 });
        } else {
          // clipboard to the chest, the pen finger pointed: FAILED
          arm('L', { pos: [sc(0.08), sc(0.26), sc(0.22)], dir: [-0.4, 0.45, 0.5], palm: [0, 0.6, -0.8], aw: 1, pole: 0.4, curl: [0.3, 0.4, 0.45, 0.5, 0.25] });
          arm('R', { pos: [sc(-0.2), sc(0.2), sc(0.34)], dir: [0, 0.35, 0.9], palm: [1, -0.2, 0], aw: 0.7, pole: 0.7, curl: [0.04, 1, 1, 1, 0.9], spread: 0 });
          showPen = false;
        }
        set('spPitch', 0.1);
        bias.pitch = 0.08;
        bias.yaw = Math.sin(t * 17) * 0.05;
        break;
      }
      case 'walkaway': {
        const w = Math.sin(t * 6.5 + ph);
        const stride = 0.2 * S;
        set('fLz', stride * w);
        set('fRz', -stride * w);
        set('fLy', Math.max(0, Math.cos(t * 6.5 + ph)) * 0.075 * S);
        set('fRy', Math.max(0, -Math.cos(t * 6.5 + ph)) * 0.075 * S);
        set('hipY', -Math.abs(Math.cos(t * 6.5 + ph)) * 0.02 * S);
        set('hipYaw', 0.08 * w);
        set('spYaw', -0.12 * w);
        arm('L', delivery ? { pos: [sc(0.2), sc(-0.02), sc(0.02 - 0.1 * w)], aw: 0 } : { pos: [sc(0.1), sc(0.2), sc(0.2)], dir: [-0.5, 0.2, 0.5], palm: [0, 0.6, -0.8], aw: 1, pole: 0.4, curl: [0.3, 0.4, 0.45, 0.5, 0.25] });
        arm('R', { pos: [sc(-0.2), sc(-0.02), sc(0.02 + 0.13 * w)], aw: 0 });
        set('spPitch', 0.05);
        break;
      }
      default: {
        if (delivery) {
          // the bag hangs from the left hand; the right thumbs through the phone, now and then a look up at the stall
          arm('L', { pos: [sc(0.22), sc(-0.03), sc(0.05)], aw: 0, curl: [0.8, 0.85, 0.9, 0.9, 0.6] });
          arm('R', { pos: [sc(-0.1), sc(0.2), sc(0.3)], dir: [0, 0.3, 1], palm: [0.4, 1, 0], aw: 1, pole: 0.3, curl: [0.4, 0.5, 0.55, 0.6, 0.4] });
          const up = Math.sin(t * 0.7 + ph) > 0.75;
          bias.pitch = up ? 0.0 : 0.2;
        } else {
          // clipboard held at the chest, the pen going: writing, with a glance up and about now and then
          arm('L', { pos: [sc(0.1), sc(0.27), sc(0.22)], dir: [-0.4, 0.45, 0.5], palm: [0, 0.6, -0.8], aw: 1, pole: 0.4, curl: [0.3, 0.4, 0.45, 0.5, 0.25] });
          arm('R', { pos: [sc(-0.05 + 0.012 * Math.sin(t * 7)), sc(0.25 + 0.006 * Math.sin(t * 11)), sc(0.27)], dir: [0.5, 0.3, 0.7], palm: [0.5, 0.5, 0], aw: 1, pole: 0.5, curl: [0.45, 0.55, 0.6, 0.65, 0.5] });
          const look = Math.sin(t * 0.5 + ph);
          bias.pitch = look > 0.6 ? -0.03 : 0.16;
          bias.yaw = look > 0.6 ? Math.sin(t * 0.9) * 0.25 : 0;
        }
        set('spPitch', 0.03 + 0.012 * Math.sin(t * 1.9 + ph));
      }
    }
    if (pen) pen.visible = showPen;
    if (phone) phone.visible = mood !== 'happy' && mood !== 'angry' && mood !== 'walkaway';
  };

  const api = {
    group,
    kind: role,
    get mood() {
      return mood;
    },
    setMood(m) {
      const next = OFFICIAL_MOODS.includes(m) ? m : 'waiting';
      if (next !== mood) {
        mood = next;
        b.rate = mood === 'angry' || mood === 'walkaway' ? 16 : 11;
      }
      exprOverride = null;
      refreshExpression(true);
    },
    setPatience(f) {
      patience = clamp01(num(f, 1));
      refreshExpression(false);
    },
    setExpression(name, weight = 1, blendMs = 250) {
      if (!EXPRESSION_NAMES.includes(name)) return;
      exprOverride = name;
      lastExpr = name;
      person.setExpression(name, weight, blendMs);
    },
    setSpeaking(ms, intensity = 0.7) {
      person.setSpeaking(ms, intensity);
    },
    lookAt(v) {
      lookOverride = v && Number.isFinite(v.x + v.y + v.z) ? v.clone() : null;
    },
    update(dt, t) {
      if (disposed) return;
      const d = Math.min(0.1, Math.max(0, num(dt, 0.016)));
      const tt = num(t, 0);
      turn = damp(turn, mood === 'walkaway' ? Math.PI : 0, mood === 'walkaway' ? 5 : 8, d);
      rig.rotation.y = turn;
      group.updateWorldMatrix(true, false);
      group.getWorldPosition(_wp);
      poseFor(tt);
      if (lookOverride) person.lookAt(lookOverride);
      else person.lookAt(_tgt.set(_wp.x * 0.6, 1.5, _wp.z + 2.6));
      person.update(d, tt);
    },
    get triangles() {
      return countTriangles(group);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      person.dispose();
      if (prop?.userData.own) for (const m of prop.userData.own) m.dispose();
      disposeObject(group);
    },
  };
  b.pose.snap();
  poseFor(0);
  b.pose.snap();
  person.update(0.016, 0);
  api.setMood('waiting');
  api.update(0.016, 0);
  return api;
}

/** The GHMC food-safety inspector. */
export const buildInspector = (seed = 0, opts = {}) => buildOfficial('inspector', seed, opts);
/** The tiffin delivery rider with his red bag. */
export const buildDeliveryBoy = (seed = 0, opts = {}) => buildOfficial('delivery', seed, opts);
void Color;
