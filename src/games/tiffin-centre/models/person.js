// A low-poly articulated person (shared by customers and the cook avatar). All geometry is merged per body part with vertex
// colours, so a person is ~9 meshes and ONE owned material. Origin = between the feet; the person FACES +z (three's default).
// Joints: hips (bob / lean / roll), head (nod / turn), per arm shoulder + elbow, per leg hip. Rotations about x are NEGATIVE to
// swing forward (towards +z).
import { DoubleSide, Group, Mesh, MeshStandardMaterial, BoxGeometry, SphereGeometry, TorusGeometry, Object3D } from 'three';
import { Parts, damp, sharedGeo, materials } from './util.js';
import { checkTexture } from './textures.js';

export const HIP_Y = 0.82;
export const SHOULDER = { x: 0.225, y: 0.46 };
export const UPPER_ARM = 0.26;
export const FORE_ARM = 0.29; // elbow to the socket (palm)

const FIELDS = ['aLx', 'aLz', 'eL', 'aRx', 'aRz', 'eR', 'lL', 'lR', 'hy', 'hz', 'hx', 'headX', 'headY', 'breathe'];
export const newPose = () => ({ aLx: 0, aLz: 0.08, eL: -0.1, aRx: 0, aRz: 0.08, eR: -0.1, lL: 0, lR: 0, hy: 0, hz: 0, hx: 0, headX: 0, headY: 0, breathe: 0 });
export const resetPose = (p) => {
  p.aLx = 0;
  p.aLz = 0.08;
  p.eL = -0.1;
  p.aRx = 0;
  p.aRz = 0.08;
  p.eR = -0.1;
  p.lL = 0;
  p.lR = 0;
  p.hy = 0;
  p.hz = 0;
  p.hx = 0;
  p.headX = 0;
  p.headY = 0;
  p.breathe = 0;
  return p;
};

const smileGeo = () => sharedGeo('person:smile', () => new TorusGeometry(0.03, 0.006, 3, 8, Math.PI).rotateZ(Math.PI));
const flatGeo = () => sharedGeo('person:flat', () => new BoxGeometry(0.04, 0.008, 0.006));
const openGeo = () => sharedGeo('person:open', () => new SphereGeometry(0.018, 6, 4));
const browGeo = () => sharedGeo('person:brow', () => new BoxGeometry(0.052, 0.011, 0.01));

function shade(hex, k) {
  // quick darken/lighten of a #rrggbb colour
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * k)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * k)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * k)));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
export { shade };

/**
 * spec: { scale, headScale, skin, top:{kind:'shirt'|'tee'|'kurta'|'kurti'|'saree'|'jacket', color, sleeve:'short'|'long'},
 *   bottom:{kind:'trousers'|'shorts'|'lungi'|'pyjama'|'skirt', color, trim}, shoes:{kind:'shoe'|'slipper', color},
 *   hair:{style:'short'|'long'|'bun'|'bald'|'none', color}, headgear:{kind:'cap'|'topi'|'cloth', color}|null,
 *   face:{moustache, beard, glasses, bindi, hairColor}, extras(ctx) }
 * extras(ctx): add parts BEFORE meshes are built: ctx = { body, head, armU:[L,R], armF:[L,R], hips, upper, root, vc, skin, attach(parent, Parts, x,y,z) -> Mesh }
 * after(person): runs once built (attach props to person.arms[i].hand, person.upper ...)
 */
export function buildPerson(spec) {
  const s = { scale: 1, headScale: 1, skin: '#d9a273', ...spec };
  const top = { kind: 'shirt', color: '#8fb3d9', sleeve: 'short', ...s.top };
  const bottom = { kind: 'trousers', color: '#2f3445', ...s.bottom };
  const shoes = { kind: 'shoe', color: '#2a211d', ...s.shoes };
  const hair = { style: 'short', color: '#1c1410', ...s.hair };
  const face = { ...s.face };
  const skin = s.skin;

  const root = new Group();
  root.scale.setScalar(s.scale);
  const vc = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0, side: DoubleSide, emissive: '#000000', emissiveIntensity: 0 });
  vc.userData.person = true;

  const hips = new Group(); // bobs; the legs hang from here
  hips.position.y = HIP_Y;
  root.add(hips);
  const upper = new Group(); // leans / rolls / breathes; body, head and arms hang from here
  hips.add(upper);

  const geos = [];
  const addMesh = (parent, P, x = 0, y = 0, z = 0) => {
    const g = P.build('solid');
    if (!g) return null;
    const m = new Mesh(g, vc);
    m.position.set(x, y, z);
    parent.add(m);
    geos.push(g);
    return m;
  };

  // ---- body (hips space) ---------------------------------------------------------------------------------------
  const body = new Parts();
  body.box(0.33, 0.13, 0.18, bottom.kind === 'shorts' || bottom.kind === 'trousers' || bottom.kind === 'pyjama' ? bottom.color : top.color, { p: [0, -0.02, 0] });
  const kind = top.kind;
  body.cyl(0.185, 0.165, 0.52, 8, top.color, { p: [0, 0.27, 0], s: [1, 1, 0.68] });
  if (kind === 'kurta') body.cyl(0.155, 0.215, 0.62, 8, top.color, { p: [0, -0.06, 0], s: [1, 1, 0.72] });
  else if (kind === 'kurti') body.cyl(0.158, 0.2, 0.34, 8, top.color, { p: [0, -0.03, 0], s: [1, 1, 0.72] });
  else if (kind === 'saree') {
    body.cyl(0.158, 0.27, 0.78, 10, bottom.color, { p: [0, -0.3, 0], s: [1, 1, 0.8] });
    body.box(0.07, 0.62, 0.02, bottom.trim || '#f4c542', { p: [-0.07, 0.2, 0.108], r: [0, 0, -0.55] }); // pallu across the chest
    body.box(0.09, 0.5, 0.02, bottom.trim || '#f4c542', { p: [0.0, 0.0, -0.11] }); // pallu down the back
  } else if (kind === 'jacket') body.box(0.34, 0.5, 0.02, top.color, { p: [0, 0.27, 0.105] });
  body.sph(0.068, top.color, { p: [-0.215, 0.46, 0] }, 6, 4);
  body.sph(0.068, top.color, { p: [0.215, 0.46, 0] }, 6, 4);
  body.cyl(0.05, 0.06, 0.07, 6, skin, { p: [0, 0.545, 0] });
  if (kind === 'shirt') {
    body.box(0.13, 0.03, 0.04, shade(top.color, 0.9), { p: [0, 0.525, 0.03] }); // collar
    for (let i = 0; i < 3; i++) body.sph(0.007, shade(top.color, 0.75), { p: [0, 0.4 - i * 0.12, 0.107] }, 3, 3);
  }
  if (s.top.pocket) body.box(0.05, 0.05, 0.012, shade(top.color, 0.88), { p: [-0.07, 0.38, 0.108] });
  const ctx = {
    body,
    head: null,
    armU: [new Parts(), new Parts()],
    armF: [new Parts(), new Parts()],
    hips,
    upper,
    root,
    vc,
    skin,
    attach: (parent, P, x = 0, y = 0, z = 0) => addMesh(parent, P, x, y, z),
  };

  // ---- head (pivot at the neck) --------------------------------------------------------------------------------
  const headG = new Group();
  headG.position.set(0, 0.57, 0);
  upper.add(headG);
  const head = new Parts();
  const hs = s.headScale;
  head.sph(0.128 * hs, skin, { p: [0, 0.105 * hs, 0], s: [1, 1.06, 0.97] }, 9, 7);
  head.sph(0.025, skin, { p: [-0.118 * hs, 0.1 * hs, 0] }, 4, 3);
  head.sph(0.025, skin, { p: [0.118 * hs, 0.1 * hs, 0] }, 4, 3);
  head.cone(0.014, 0.035, 5, shade(skin, 0.9), { p: [0, 0.09 * hs, 0.118 * hs], r: [Math.PI / 2, 0, 0] });
  for (const x of [-0.042, 0.042]) head.sph(0.0135, '#15100d', { p: [x * hs, 0.113 * hs, 0.104 * hs] }, 5, 4);
  const hc = hair.color;
  if (hair.style !== 'bald' && hair.style !== 'none') {
    head.cap(0.133 * hs, Math.PI * 0.4, hc, { p: [0, 0.1 * hs, -0.008], r: [-0.28, 0, 0], s: [1, 1.05, 1.0] }, 9, 4);
    for (const sx of [-1, 1]) head.box(0.02, 0.07, 0.07, hc, { p: [sx * 0.118 * hs, 0.125 * hs, -0.02] });
    if (hair.style === 'long') {
      head.box(0.25 * hs, 0.34, 0.06, hc, { p: [0, 0.0, -0.1 * hs] });
    } else if (hair.style === 'bun') {
      head.sph(0.055, hc, { p: [0, 0.2 * hs, -0.09 * hs] }, 6, 5);
    } else if (hair.style === 'plait') {
      head.box(0.16 * hs, 0.14, 0.06, hc, { p: [0, 0.07, -0.1 * hs] });
      head.cyl(0.026, 0.02, 0.34, 5, hc, { p: [0.02, -0.12, -0.12 * hs], r: [0.08, 0, 0.05] });
    }
  } else if (hair.style === 'none' && hair.side) {
    for (const sx of [-1, 1]) head.box(0.02, 0.06, 0.08, hair.side, { p: [sx * 0.115 * hs, 0.09 * hs, -0.02] });
  }
  const hg = s.headgear;
  if (hg) {
    if (hg.kind === 'cap') {
      head.cap(0.136 * hs, Math.PI * 0.42, hg.color, { p: [0, 0.108 * hs, 0], r: [-0.1, 0, 0], s: [1, 1, 1] }, 9, 4);
      head.box(0.15, 0.012, 0.09, hg.color, { p: [0, 0.135 * hs, 0.125 * hs], r: [0.1, 0, 0] });
    } else if (hg.kind === 'topi') {
      head.cap(0.128 * hs, Math.PI * 0.36, hg.color, { p: [0, 0.112 * hs, 0], r: [-0.05, 0, 0], s: [1, 0.9, 1] }, 9, 4);
      head.torus(0.1 * hs, 0.011, '#d8d2c0', { p: [0, 0.158 * hs, 0], r: [Math.PI / 2, 0, 0] }, 3, 10);
    } else if (hg.kind === 'cloth') {
      head.cap(0.137 * hs, Math.PI * 0.4, hg.color, { p: [0, 0.108 * hs, -0.004], r: [-0.2, 0, 0], s: [1, 1, 1] }, 9, 4);
      head.torus(0.12 * hs, 0.012, shade(hg.color, 0.8), { p: [0, 0.158 * hs, 0.0], r: [Math.PI / 2 - 0.2, 0, 0] }, 3, 10);
      head.sph(0.04, hg.color, { p: [0.05, 0.12 * hs, -0.125 * hs] }, 5, 4);
      head.box(0.05, 0.14, 0.015, hg.color, { p: [0.07, 0.04 * hs, -0.13 * hs], r: [0, 0, 0.2] });
    }
  }
  if (face.moustache) head.box(0.08, 0.016, 0.024, face.hairColor || hc, { p: [0, 0.066 * hs, 0.106 * hs] });
  if (face.beard) head.cone(0.07, 0.11, 6, face.hairColor || hc, { p: [0, -0.002 * hs, 0.07 * hs], r: [Math.PI, 0, 0] });
  if (face.glasses) {
    for (const x of [-0.045, 0.045]) head.torus(0.03, 0.004, '#1b1b1b', { p: [x * hs, 0.113 * hs, 0.112 * hs] }, 3, 8);
    head.box(0.03, 0.005, 0.005, '#1b1b1b', { p: [0, 0.118 * hs, 0.114 * hs] });
  }
  if (face.bindi) head.sph(0.009, '#d0182c', { p: [0, 0.158 * hs, 0.101 * hs] }, 4, 3);
  ctx.head = head;
  if (typeof s.extras === 'function') s.extras(ctx);

  addMesh(upper, body);
  addMesh(headG, head);

  // ---- face expressions (shared geometry, toggled) -------------------------------------------------------------
  const fm = materials.face();
  const mFlat = new Mesh(flatGeo(), fm);
  const mSmile = new Mesh(smileGeo(), fm);
  const mOpen = new Mesh(openGeo(), fm);
  const my = 0.052 * hs;
  const mz = 0.103 * hs;
  mFlat.position.set(0, my, mz);
  mSmile.position.set(0, my + 0.022, mz);
  mOpen.position.set(0, my - 0.004, mz);
  mOpen.scale.set(1.2, 0.9, 0.6);
  const brows = [new Mesh(browGeo(), fm), new Mesh(browGeo(), fm)];
  brows[0].position.set(-0.045 * hs, 0.152 * hs, 0.105 * hs);
  brows[0].rotation.z = -0.42;
  brows[1].position.set(0.045 * hs, 0.152 * hs, 0.105 * hs);
  brows[1].rotation.z = 0.42;
  for (const m of [mFlat, mSmile, mOpen, ...brows]) headG.add(m);
  mSmile.visible = false;
  mOpen.visible = false;
  brows[0].visible = brows[1].visible = false;
  const earL = new Object3D();
  const earR = new Object3D();
  earL.position.set(-0.13 * hs, 0.1 * hs, 0);
  earR.position.set(0.13 * hs, 0.1 * hs, 0);
  headG.add(earL, earR);

  // ---- arms ----------------------------------------------------------------------------------------------------
  const sleeveFull = top.sleeve === 'long';
  const arms = [];
  for (const side of [-1, 1]) {
    const i = side < 0 ? 0 : 1;
    const sh = new Group();
    sh.position.set(side * SHOULDER.x, SHOULDER.y, 0);
    upper.add(sh);
    const U = ctx.armU[i];
    U.cyl(0.058, 0.05, UPPER_ARM, 6, top.color, { p: [0, -UPPER_ARM / 2, 0] });
    addMesh(sh, U);
    const el = new Group();
    el.position.y = -UPPER_ARM;
    sh.add(el);
    const F = ctx.armF[i];
    F.cyl(0.05, 0.042, 0.24, 6, sleeveFull ? top.color : skin, { p: [0, -0.12, 0] });
    F.sph(0.05, skin, { p: [0, -0.27, 0] }, 5, 4);
    if (sleeveFull) F.cyl(0.04, 0.04, 0.03, 6, skin, { p: [0, -0.245, 0] });
    addMesh(el, F);
    const hand = new Object3D();
    hand.position.y = -0.28;
    el.add(hand);
    arms.push({ sh, el, hand });
  }

  // ---- legs ----------------------------------------------------------------------------------------------------
  const legs = [];
  const LEG = 0.74;
  const cloth = bottom.kind === 'trousers' || bottom.kind === 'pyjama' ? LEG : bottom.kind === 'shorts' ? 0.3 : 0;
  const rAt = (y) => 0.082 + (0.058 - 0.082) * (y / LEG);
  for (const side of [-1, 1]) {
    const leg = new Group();
    leg.position.set(side * 0.085, 0, 0);
    hips.add(leg);
    const L = new Parts();
    if (cloth > 0) L.cyl(rAt(0), rAt(cloth), cloth, 7, bottom.color, { p: [0, -cloth / 2, 0] });
    if (cloth < LEG) L.cyl(rAt(cloth), rAt(LEG), LEG - cloth, 7, skin, { p: [0, -(cloth + (LEG - cloth) / 2), 0] });
    if (shoes.kind === 'slipper') {
      L.box(0.085, 0.045, 0.19, skin, { p: [0, -0.79, 0.04] });
      L.box(0.1, 0.014, 0.23, shoes.color, { p: [0, -0.813, 0.045] });
      L.box(0.09, 0.016, 0.035, shade(shoes.color, 1.25), { p: [0, -0.78, 0.07] });
    } else {
      L.box(0.1, 0.07, 0.2, shoes.color, { p: [0, -0.785, 0.04] });
      L.box(0.1, 0.012, 0.21, '#d9d2c4', { p: [0, -0.814, 0.04] });
    }
    addMesh(leg, L);
    legs.push(leg);
  }

  // lungi / tehmat: a checked wrap from the waist to the shin (own textured material)
  let lungiMat = null;
  if (bottom.kind === 'lungi') {
    lungiMat = new MeshStandardMaterial({ color: bottom.color, map: checkTexture(), flatShading: true, roughness: 0.9, side: DoubleSide, vertexColors: true });
    const P = new Parts();
    P.lathe([[0.215, -0.62], [0.2, -0.42], [0.178, -0.14], [0.165, 0.06]], 10, '#ffffff', { s: [1, 1, 0.82] });
    const g = P.build('solid');
    // the lathe has vertex colours (white) and the check map multiplies them
    const lungiMesh = new Mesh(g, lungiMat);
    hips.add(lungiMesh);
    geos.push(g);
    const knot = new Parts();
    knot.sph(0.05, bottom.trim || shade(bottom.color, 0.8), { p: [0.17, 0.0, 0.05] }, 5, 4);
    knot.cyl(0.165, 0.17, 0.045, 10, bottom.trim || shade(bottom.color, 0.8), { p: [0, 0.055, 0], s: [1, 1, 0.82] });
    addMesh(hips, knot);
  }

  // extras that need sockets (props held in hands, bags on hips...)
  const person = {
    root,
    hips,
    upper,
    headG,
    arms,
    legs,
    vc,
    lungiMat,
    earL,
    earR,
    face: { flat: mFlat, smile: mSmile, open: mOpen, brows },
    cur: newPose(),
    target: newPose(),
    ctx,
    setFace(name, angry = false) {
      mFlat.visible = name === 'flat';
      mSmile.visible = name === 'smile';
      mOpen.visible = name === 'open';
      brows[0].visible = brows[1].visible = angry;
    },
    /** Damp `cur` towards `target` and write the joint rotations. No allocation. */
    step(dt, rate = 12) {
      const c = person.cur;
      const t = person.target;
      for (let i = 0; i < FIELDS.length; i++) {
        const k = FIELDS[i];
        c[k] = damp(c[k], t[k], rate, dt);
      }
      arms[0].sh.rotation.set(c.aLx, 0, -c.aLz);
      arms[1].sh.rotation.set(c.aRx, 0, c.aRz);
      arms[0].el.rotation.x = c.eL;
      arms[1].el.rotation.x = c.eR;
      legs[0].rotation.x = c.lL;
      legs[1].rotation.x = c.lR;
      hips.position.y = HIP_Y + c.hy;
      upper.rotation.set(c.hx, 0, c.hz);
      upper.scale.y = 1 + c.breathe;
      headG.rotation.set(c.headX, c.headY, 0);
    },
    dispose() {
      for (const g of geos) g.dispose();
      vc.dispose();
      if (lungiMat) lungiMat.dispose();
    },
  };
  if (typeof s.after === 'function') s.after(person);
  return person;
}
