// Human bodies for Tiffin Centre: a pelvis, torso with chest/waist/shoulders, smooth IK arms and legs, hands with fingers, feet and a
// bending neck. Real proportions (about 7.5 heads for an adult), one pose-channel table that every character animates through.
//
// Space: the root group stands on the ground (y = 0) and FACES +z (so +x is the character's left, -x the right).
//   hips (at the hip joints) > torso (pivot at the waist) > headMount (pivot at the neck) ; arms are in torso space, legs in root space.
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Quaternion, Vector3 } from 'three';
import { tierOf } from './charquality.js';
import { cloneSkinMaterial } from './skin.js';
import { Hand, Limb, solveTwoBone } from './limbs.js';

const PI = Math.PI;
const TAU = PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------------------------------
// Pose channels. All lengths in metres (before the body scale), angles in radians.
const NAMES = [
  'hipX', 'hipY', 'hipZ', 'hipYaw', 'hipRoll',
  'spPitch', 'spYaw', 'spRoll',
  'hdPitch', 'hdYaw', 'hdRoll',
];
for (const s of ['L', 'R']) {
  NAMES.push(`a${s}x`, `a${s}y`, `a${s}z`, `a${s}fx`, `a${s}fy`, `a${s}fz`, `a${s}px`, `a${s}py`, `a${s}pz`, `a${s}aw`, `a${s}pole`);
  NAMES.push(`a${s}c0`, `a${s}c1`, `a${s}c2`, `a${s}c3`, `a${s}c4`, `a${s}spread`);
  NAMES.push(`f${s}x`, `f${s}y`, `f${s}z`, `f${s}yaw`, `f${s}toe`);
}
export const CH = Object.fromEntries(NAMES.map((n, i) => [n, i]));
const NCH = NAMES.length;

/** Pose channel table with exponential smoothing from current to target. */
export class Pose {
  constructor() {
    this.cur = new Float32Array(NCH);
    this.tgt = new Float32Array(NCH);
  }
  set(name, v) {
    this.tgt[CH[name]] = v;
  }
  setN(names, ...vals) {
    for (let i = 0; i < names.length; i++) this.tgt[CH[names[i]]] = vals[i];
  }
  snap() {
    this.cur.set(this.tgt);
  }
  step(dt, rate) {
    const k = 1 - Math.exp(-rate * dt);
    for (let i = 0; i < NCH; i++) this.cur[i] += (this.tgt[i] - this.cur[i]) * k;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
/** Static ring loft. rings: [{ y|z, cx, cy|cz?, rx, rz }]. axis 'y' stacks rings upward (ellipse in xz), 'z' along z (ellipse in xy). */
export function ringLoft(rings, { axis = 'y', sides = 12, caps = [false, false], uv = [2, 3], fold = null, flip = false } = {}) {
  const pos = [];
  const uvs = [];
  const idx = [];
  const nr = rings.length;
  for (let r = 0; r < nr; r++) {
    const R = rings[r];
    for (let k = 0; k < sides; k++) {
      const phi = (k / sides) * TAU;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const f = fold ? fold(r / (nr - 1), phi, R) : 0;
      if (axis === 'y') pos.push((R.cx || 0) + (R.rx + f) * c, R.y, (R.cz || 0) + (R.rz + f) * s);
      else pos.push((R.cx || 0) + (R.rx + f) * c, (R.cy || 0) + (R.rz + f) * s, R.z);
      uvs.push((k / sides) * uv[0], (r / (nr - 1)) * uv[1]);
    }
  }
  for (let r = 0; r < nr - 1; r++) {
    for (let k = 0; k < sides; k++) {
      const a = r * sides + k;
      const b = r * sides + ((k + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      if ((axis === 'y') !== flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  if (caps[0]) {
    const R = rings[0];
    const o = pos.length / 3;
    pos.push(R.cx || 0, axis === 'y' ? R.y : R.cy || 0, axis === 'y' ? R.cz || 0 : R.z);
    uvs.push(0.5, 0);
    for (let k = 0; k < sides; k++) idx.push(o, (axis === 'y') !== flip ? k : (k + 1) % sides, (axis === 'y') !== flip ? (k + 1) % sides : k);
  }
  if (caps[1]) {
    const R = rings[nr - 1];
    const o = pos.length / 3;
    const base = (nr - 1) * sides;
    pos.push(R.cx || 0, axis === 'y' ? R.y : R.cy || 0, axis === 'y' ? R.cz || 0 : R.z);
    uvs.push(0.5, 1);
    for (let k = 0; k < sides; k++) idx.push(o, (axis === 'y') !== flip ? base + (k + 1) % sides : base + k, (axis === 'y') !== flip ? base + k : base + (k + 1) % sides);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setAttribute('aEdge', new Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dimensions of the reference adult (1.70 m), world heights. `S` scales everything.
export const REF = {
  height: 1.7,
  hipY: 0.9,
  waistY: 1.0, // torso pivot
  shoulderY: 1.352,
  neckBaseY: 1.425,
  pivotY: 1.488, // the head turns here
  armUpper: 0.3,
  armFore: 0.26,
  thigh: 0.4,
  shank: 0.415,
  ankle: 0.075,
  hipX: 0.092,
};

function torsoRings(g) {
  // [world y, half width, half depth, depth centre]. g = { female, belly, sh (shoulder width), hips }
  const f = g.female;
  const bl = g.belly;
  const sh = g.sh;
  const waistW = f ? 0.121 : 0.139;
  const hipW = (f ? 0.188 : 0.18) * g.hips;
  const chestW = (f ? 0.148 : 0.166) * sh;
  const shW = (f ? 0.158 : 0.182) * sh;
  const bust = f ? 0.014 : 0;
  return [
    [0.79, hipW * 0.9, 0.098, -0.004],
    [0.9, hipW, 0.106 + bl * 0.012, -0.002],
    [0.98, lerp(hipW, waistW, 0.55), 0.098 + bl * 0.03, 0.002 + bl * 0.016],
    [1.05, waistW, 0.09 + bl * 0.05, 0.003 + bl * 0.03],
    [1.13, lerp(waistW, chestW, 0.45), 0.092 + bl * 0.036, 0.004 + bl * 0.026 + bust * 0.3],
    [1.22, chestW, 0.104 + bust * 0.4 + bl * 0.012, 0.004 + bust],
    [1.3, lerp(chestW, shW, 0.7), 0.1 + bust * 0.2, 0.002 + bust * 0.4],
    [1.368, shW, 0.088, -0.003],
    [1.4, shW * 0.66, 0.074, -0.008],
    [1.425, f ? 0.048 : 0.058, f ? 0.05 : 0.058, -0.012],
  ].map(([y, rx, rz, cz]) => ({ y, rx, rz, cz }));
}

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _hipL = new Vector3();
const _hipR = new Vector3();
const POLE = new Vector3();
const FD = new Vector3();
const PH = new Vector3();
const ELB = new Vector3();
const WR = new Vector3();
const SH = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * buildBody({ gender, height, belly, shoulders, hips, child, skin, quality }) -> body
 * body.pose (Pose), body.group (root), body.hips, body.torso, body.headMount, body.arms[0=L(+x),1=R(-x)] { limb, hand },
 * body.legs[0|1] { limb, foot }, body.S, body.dims, body.attachHead(rig), body.update(dt)
 */
export function buildBody(spec = {}) {
  const tier = tierOf(spec.quality);
  const female = spec.gender === 'f';
  const child = spec.child || 0;
  const height = spec.height || (female ? 1.58 : 1.7);
  const S = height / REF.height;
  const root = new Group();
  root.name = 'body';
  const hips = new Group();
  hips.name = 'hips';
  root.add(hips);
  const torso = new Group();
  torso.name = 'torso';
  hips.add(torso);
  const headMount = new Group();
  headMount.name = 'head-mount';
  torso.add(headMount);
  const legSc = 1 - child * 0.1; // children have shorter legs and larger heads
  const D = {
    S,
    hipY: REF.hipY * S * legSc,
    waistRel: (REF.waistY - REF.hipY) * S,
    shoulderRel: (REF.shoulderY - REF.waistY) * S,
    neckBaseRel: (REF.neckBaseY - REF.waistY) * S,
    pivotRel: (REF.pivotY - REF.waistY) * S,
    shoulderX: (female ? 0.165 : 0.188) * S * (spec.shoulders || 1),
    armUpper: REF.armUpper * S,
    armFore: REF.armFore * S,
    thigh: REF.thigh * S * legSc,
    shank: REF.shank * S * legSc,
    ankle: REF.ankle * S,
    hipX: REF.hipX * S * (female ? 1.06 : 1),
    female,
    child,
    handScale: S * (1 - child * 0.05),
  };
  hips.position.set(0, D.hipY, 0);
  torso.position.set(0, D.waistRel, 0);
  headMount.position.set(0, D.pivotRel, -0.02 * S);

  const skinBase = spec.skin;
  const mkSkin = (off) => (skinBase ? cloneSkinMaterial(skinBase, off, { body: true }) : undefined);
  const skinMat = mkSkin();

  // ---- torso skin loft (hidden under most clothes, visible at the neckline and for sleeveless wear)
  const g = { female, belly: spec.belly || 0, sh: spec.shoulders || 1, hips: spec.hips || 1 };
  const rings = torsoRings(g).map((r) => ({ y: (r.y - REF.waistY) * S, rx: r.rx * S, rz: r.rz * S, cx: 0, cz: r.cz * S }));
  const torsoGeo = ringLoft(rings, { axis: 'y', sides: tier.limbSides + 4, caps: [true, true], uv: [2, 3] });
  const torsoMesh = new Mesh(torsoGeo, skinMat);
  torsoMesh.name = 'torso-skin';
  torso.add(torsoMesh);

  // ---- neck (bends towards the head)
  const neck = new Limb(6);
  const neckR = (female ? 0.047 : 0.054) * S * (1 - child * 0.1);
  neck.addLayer({
    s0: 0,
    s1: 1,
    rings: 5,
    sides: tier.limbSides,
    material: mkSkin(),
    name: 'neck',
    uv: [2, 1],
    rad: (s) => [neckR * (1.1 - 0.12 * s), neckR * (1 - 0.1 * s)],
  });
  torso.add(neck.group);

  // ---- arms
  const arms = [];
  const handMat = mkSkin();
  for (const side of [1, -1]) {
    const limb = new Limb(tier.limbRings + 4);
    const k = (female ? 0.88 : 1) * S;
    const prof = [
      [0, 0.054, 0.05],
      [0.2, 0.049, 0.046],
      [0.4, 0.0415, 0.04],
      [0.536, 0.0375, 0.036],
      [0.62, 0.0385, 0.037],
      [0.8, 0.0315, 0.029],
      [1, 0.0245, 0.0215],
    ];
    const rad = (s) => {
      let i = 0;
      while (i < prof.length - 2 && s > prof[i + 1][0]) i++;
      const a = prof[i];
      const b = prof[i + 1];
      const t = clamp((s - a[0]) / (b[0] - a[0]), 0, 1);
      return [lerp(a[1], b[1], t) * k, lerp(a[2], b[2], t) * k];
    };
    limb.addLayer({ s0: 0, s1: 1, rings: tier.limbRings, sides: tier.limbSides, material: mkSkin(), name: side > 0 ? 'arm-L' : 'arm-R', uv: [2, 3], rad, caps: [false, false] });
    torso.add(limb.group);
    const hand = new Hand({ side: -side, scale: D.handScale, material: handMat, quality: tier.id });
    // the left hand (on +x, the character's left) is the mirrored mesh
    hand.mesh.scale.x = side > 0 ? -1 : 1;
    torso.add(hand.group);
    arms.push({ side, limb, hand, rad, k });
  }

  // ---- legs and feet
  const legs = [];
  for (const side of [1, -1]) {
    const limb = new Limb(tier.limbRings + 4);
    const k = (female ? 0.94 : 1) * S * (spec.hips || 1);
    const prof = [
      [0, 0.088, 0.088],
      [0.25, 0.082, 0.08],
      [0.48, 0.058, 0.057],
      [0.52, 0.056, 0.055],
      [0.68, 0.052, 0.054],
      [0.9, 0.034, 0.034],
      [1, 0.03, 0.03],
    ];
    const rad = (s) => {
      let i = 0;
      while (i < prof.length - 2 && s > prof[i + 1][0]) i++;
      const a = prof[i];
      const b = prof[i + 1];
      const t = clamp((s - a[0]) / (b[0] - a[0]), 0, 1);
      return [lerp(a[1], b[1], t) * k, lerp(a[2], b[2], t) * k];
    };
    limb.addLayer({ s0: 0, s1: 1, rings: tier.limbRings, sides: tier.limbSides, material: mkSkin(), name: side > 0 ? 'leg-L' : 'leg-R', uv: [2, 4], rad });
    root.add(limb.group);
    const foot = new Group();
    foot.name = side > 0 ? 'foot-L' : 'foot-R';
    const fs = S * (1 - child * 0.12);
    const footGeo = ringLoft(
      [
        { z: -0.055 * fs, cx: 0, cy: -0.045 * fs, rx: 0.033 * fs, rz: 0.04 * fs },
        { z: -0.01 * fs, cx: 0, cy: -0.05 * fs, rx: 0.038 * fs, rz: 0.03 * fs },
        { z: 0.06 * fs, cx: 0, cy: -0.058 * fs, rx: 0.044 * fs, rz: 0.021 * fs },
        { z: 0.14 * fs, cx: 0, cy: -0.064 * fs, rx: 0.042 * fs, rz: 0.0135 * fs },
        { z: 0.19 * fs, cx: 0, cy: -0.067 * fs, rx: 0.026 * fs, rz: 0.009 * fs },
      ],
      { axis: 'z', sides: 8, caps: [true, true] }
    );
    const fm = new Mesh(footGeo, mkSkin());
    fm.name = 'foot-skin';
    foot.add(fm);
    root.add(foot);
    legs.push({ side, limb, foot, rad, k, rest: new Vector3(side * D.hipX, 0, 0) });
  }

  // body surface lookup in torso space (rel. to the waist): half width, half depth and depth centre at height yRel
  const ringsRel = rings;
  const ringAt = (yRel) => {
    const r0 = ringsRel[0];
    const rn = ringsRel[ringsRel.length - 1];
    if (yRel <= r0.y) return { rx: r0.rx, rz: r0.rz, cz: r0.cz };
    if (yRel >= rn.y) return { rx: rn.rx, rz: rn.rz, cz: rn.cz };
    let i = 0;
    while (i < ringsRel.length - 2 && yRel > ringsRel[i + 1].y) i++;
    const a = ringsRel[i];
    const b = ringsRel[i + 1];
    const t = (yRel - a.y) / (b.y - a.y);
    return { rx: lerp(a.rx, b.rx, t), rz: lerp(a.rz, b.rz, t), cz: lerp(a.cz, b.cz, t) };
  };
  const pose = new Pose();
  const body = {
    ringAt,
    group: root,
    hips,
    torso,
    headMount,
    neck,
    arms,
    legs,
    pose,
    S,
    dims: D,
    tier,
    skinMaterial: skinMat,
    head: null,
    handPose: [null, null],
    owned: [],
    /** Put a head rig (face.js) on the neck. `scale` enlarges children's heads. */
    attachHead(rig, scale = 1) {
      this.head = rig;
      rig.group.scale.setScalar(scale * (1 + child * 0.0));
      rig.group.position.set(-rig.headPivot.x * scale, -rig.headPivot.y * scale, -rig.headPivot.z * scale);
      headMount.add(rig.group);
      // neck-top attach point sits inside the head
      this._headScale = scale;
    },
    /** Reach, in a standing pose, of the right wrist. */
    reach: D.armUpper + D.armFore,
    /** Standing pose targets (everything relaxed). Called once on build and by `resetPose()`. */
    resetPose() {
      const T = pose.tgt;
      T.fill(0);
      for (const sd of ['L', 'R']) {
        const sg = sd === 'L' ? 1 : -1;
        const set = (n, v) => {
          T[CH[`a${sd}${n}`]] = v;
        };
        set('x', sg * (D.shoulderX + 0.03 * S));
        set('y', D.shoulderRel - 0.54 * S);
        set('z', 0.02 * S);
        set('fx', 0);
        set('fy', -1);
        set('fz', 0.15);
        set('px', -sg);
        set('py', 0);
        set('pz', 0.1);
        set('aw', 0);
        set('pole', 0);
        set('c0', 0.22);
        set('c1', 0.3);
        set('c2', 0.36);
        set('c3', 0.44);
        set('c4', 0.15);
        set('spread', 0.1);
        T[CH[`f${sd}x`]] = sg * D.hipX * 1.02;
        T[CH[`f${sd}y`]] = 0;
        T[CH[`f${sd}z`]] = 0.0;
        T[CH[`f${sd}yaw`]] = sg * 0.12;
        T[CH[`f${sd}toe`]] = 0;
      }
      T[CH.hipY] = 0;
    },
    /** Set one arm's targets in torso space. Anything omitted keeps its value. o: { pos:[x,y,z], dir:[..]|null, palm:[..], aw, pole, hand: preset|{curl,thumb,spread} } */
    setArm(side, o) {
      const sd = side === 'L' || side === 0 ? 'L' : 'R';
      const T = pose.tgt;
      if (o.pos) {
        T[CH[`a${sd}x`]] = o.pos[0];
        T[CH[`a${sd}y`]] = o.pos[1];
        T[CH[`a${sd}z`]] = o.pos[2];
      }
      if (o.dir) {
        T[CH[`a${sd}fx`]] = o.dir[0];
        T[CH[`a${sd}fy`]] = o.dir[1];
        T[CH[`a${sd}fz`]] = o.dir[2];
      }
      if (o.palm) {
        T[CH[`a${sd}px`]] = o.palm[0];
        T[CH[`a${sd}py`]] = o.palm[1];
        T[CH[`a${sd}pz`]] = o.palm[2];
      }
      if (o.aw !== undefined) T[CH[`a${sd}aw`]] = o.aw;
      if (o.pole !== undefined) T[CH[`a${sd}pole`]] = o.pole;
      if (o.curl) {
        for (let i = 0; i < 5; i++) T[CH[`a${sd}c${i}`]] = o.curl[i];
        if (o.spread !== undefined) T[CH[`a${sd}spread`]] = o.spread;
      }
    },
    update(dt) {
      const d = clamp(dt, 0, 0.1);
      pose.step(d, this.rate || 12);
      const c = pose.cur;
      // hips and spine
      hips.position.set(c[CH.hipX], D.hipY + c[CH.hipY], c[CH.hipZ]);
      hips.rotation.set(0, c[CH.hipYaw], c[CH.hipRoll]);
      torso.rotation.set(c[CH.spPitch], c[CH.spYaw], c[CH.spRoll]);
      headMount.rotation.set(c[CH.hdPitch], c[CH.hdYaw], -c[CH.hdRoll], 'YXZ');
      hips.updateMatrix();
      torso.updateMatrix();

      // arms (torso space)
      for (let a = 0; a < 2; a++) {
        const A = arms[a];
        const sd = a === 0 ? 'L' : 'R';
        const sg = A.side;
        SH.set(sg * D.shoulderX, D.shoulderRel, 0);
        WR.set(c[CH[`a${sd}x`]], c[CH[`a${sd}y`]], c[CH[`a${sd}z`]]);
        const pw = c[CH[`a${sd}pole`]];
        POLE.set(sg * (0.55 + 0.6 * pw), -0.75, -0.35 - 0.5 * Math.max(0, pw));
        solveTwoBone(SH, WR, D.armUpper, D.armFore, POLE, ELB);
        // wrist is clamped inside the reach
        _v1.copy(WR).sub(SH);
        const dist = _v1.length();
        const maxd = D.armUpper + D.armFore - 1e-3;
        if (dist > maxd) WR.copy(SH).addScaledVector(_v1, maxd / dist);
        // frames use the pole direction projected perpendicular for a stable roll: outward-back
        A.limb.setPath(SH, ELB, WR, _v2.set(sg * 0.2, 0.0, -1));
        A.limb.update();
        // hand
        _v3.copy(WR).sub(ELB).normalize(); // forearm direction
        FD.set(c[CH[`a${sd}fx`]], c[CH[`a${sd}fy`]], c[CH[`a${sd}fz`]]).normalize();
        const aw = clamp(c[CH[`a${sd}aw`]], 0, 1);
        _v3.lerp(FD, aw).normalize();
        PH.set(c[CH[`a${sd}px`]], c[CH[`a${sd}py`]], c[CH[`a${sd}pz`]]);
        A.hand.place(WR, _v3, PH);
        A.hand.setCurls(c[CH[`a${sd}c0`]], c[CH[`a${sd}c1`]], c[CH[`a${sd}c2`]], c[CH[`a${sd}c3`]], c[CH[`a${sd}c4`]], c[CH[`a${sd}spread`]]);
      }

      // legs (root space)
      for (let l = 0; l < 2; l++) {
        const L = legs[l];
        const sd = l === 0 ? 'L' : 'R';
        const sg = L.side;
        _v1.set(sg * D.hipX, 0, 0).applyQuaternion(hips.quaternion).add(hips.position); // hip joint
        const gx = c[CH[`f${sd}x`]];
        const gy = c[CH[`f${sd}y`]];
        const gz = c[CH[`f${sd}z`]];
        const toe = c[CH[`f${sd}toe`]];
        const yaw = c[CH[`f${sd}yaw`]];
        _v2.set(gx, gy + D.ankle, gz); // ankle
        // heel lift: the ankle rises with toe pitch
        _v2.y += Math.max(0, toe) * 0.05 * S;
        POLE.set(sg * 0.12, 0.05, 1);
        solveTwoBone(_v1, _v2, D.thigh, D.shank, POLE, ELB);
        _v4.set(sg * 0.25, 0, 1);
        L.limb.setPath(_v1, ELB, _v2, _v4);
        L.limb.update();
        L.foot.position.copy(_v2);
        L.foot.rotation.set(-toe, yaw, 0, 'YXZ');
      }

      // neck: from the neck base up to just inside the head, bending with the head
      _v1.set(0, D.neckBaseRel - 0.015 * S, -0.012 * S);
      _v2.set(0, D.pivotRel + 0.03 * S, -0.02 * S);
      _q.setFromEuler(headMount.rotation);
      _v3.set(0, 0.034 * S, 0.006 * S).applyQuaternion(_q);
      _v2.copy(headMount.position).add(_v3);
      _v4.copy(_v1).lerp(_v2, 0.5);
      _v4.z += c[CH.hdPitch] * 0.012 * S;
      neck.setPath(_v1, _v4, _v2, _v3.set(1, 0, 0));
      neck.update();
      void UP;
      void _q2;
      void _hipL;
      void _hipR;
    },
    /** torso-space point -> root space (writes out). */
    torsoToRoot(v, out) {
      hips.updateMatrix();
      torso.updateMatrix();
      return out.copy(v).applyMatrix4(torso.matrix).applyMatrix4(hips.matrix);
    },
    /** Add a mesh to the torso (garments follow the spine) or the hips (pelvis garments). */
    addToTorso(mesh) {
      torso.add(mesh);
      return mesh;
    },
    addToHips(mesh) {
      hips.add(mesh);
      return mesh;
    },
    dispose() {
      root.traverse((o) => {
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        const m = o.material;
        if (m && !m.userData.shared) m.dispose();
      });
      root.removeFromParent();
    },
  };
  body.resetPose();
  pose.snap();
  body.rate = 12;
  body.update(0.016);
  return body;
}
