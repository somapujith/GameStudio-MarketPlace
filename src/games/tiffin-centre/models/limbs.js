// Limbs and hands for people: CPU-deformed tube chains (smooth elbows and knees, optional clothing layers on the same path),
// two-bone IK, and a one-mesh hand with real finger joints that curls. Node-safe, allocation-free per frame.
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Quaternion, Vector3, Matrix4, Object3D } from 'three';
import { tierOf } from './charquality.js';

const PI = Math.PI;
const TAU = PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();

// ---------------------------------------------------------------------------------------------------------------------
/** Two-bone IK. Writes the elbow/knee into `out`. S root, T target, l1/l2 segment lengths, pole = bend direction hint. */
export function solveTwoBone(S, T, l1, l2, pole, out) {
  _a.copy(T).sub(S);
  let d = _a.length();
  const maxD = l1 + l2 - 1e-4;
  const minD = Math.abs(l1 - l2) + 1e-3;
  if (d < 1e-5) {
    _a.set(0, -1, 0);
    d = 1e-5;
  } else _a.multiplyScalar(1 / d);
  const dd = clamp(d, minD, maxD);
  const a = (dd * dd + l1 * l1 - l2 * l2) / (2 * dd);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-8) _b.set(0, 0, 1).addScaledVector(_a, -_a.z);
  _b.normalize();
  out.copy(S).addScaledVector(_a, a).addScaledVector(_b, h);
  return dd;
}

// ---------------------------------------------------------------------------------------------------------------------
/**
 * A limb: a smooth path through three joints (A -> B -> C) sampled `n` times, with parallel-transported frames, and any number of
 * tube layers (skin, sleeves, trousers) written onto that path. `layer.rad(s) -> [rx, rz]` with s in 0..1 along the whole limb.
 */
export class Limb {
  constructor(n = 13) {
    this.n = n;
    this.P = Array.from({ length: n }, () => new Vector3());
    this.N = Array.from({ length: n }, () => new Vector3());
    this.B = Array.from({ length: n }, () => new Vector3());
    this.T = Array.from({ length: n }, () => new Vector3());
    this.layers = [];
    this.group = new Group();
    this.sElbow = 0.5;
  }

  /** Recompute the path. A, B (elbow), C and a pole vector fix the roll of the frames. */
  setPath(A, B, C, pole) {
    const n = this.n;
    const l1 = A.distanceTo(B);
    const l2 = B.distanceTo(C);
    const tot = Math.max(1e-5, l1 + l2);
    this.sElbow = l1 / tot;
    for (let i = 0; i < n; i++) {
      const s = i / (n - 1);
      const u = s * tot;
      if (u <= l1) this.P[i].copy(A).lerp(B, l1 > 1e-6 ? u / l1 : 0);
      else this.P[i].copy(B).lerp(C, l2 > 1e-6 ? (u - l1) / l2 : 0);
    }
    // round the corner: two relaxation passes (ends fixed)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n - 1; i++) this.P[i].lerp(_a.copy(this.P[i - 1]).add(this.P[i + 1]).multiplyScalar(0.5), 0.6);
    }
    for (let i = 0; i < n; i++) {
      const a = this.P[Math.max(0, i - 1)];
      const b = this.P[Math.min(n - 1, i + 1)];
      this.T[i].copy(b).sub(a);
      if (this.T[i].lengthSq() < 1e-10) this.T[i].set(0, -1, 0);
      this.T[i].normalize();
    }
    // frames: start with n0 = pole made perpendicular to the first tangent, then parallel transport
    _a.copy(pole).addScaledVector(this.T[0], -pole.dot(this.T[0]));
    if (_a.lengthSq() < 1e-8) _a.set(1, 0, 0).addScaledVector(this.T[0], -this.T[0].x);
    this.N[0].copy(_a).normalize();
    this.B[0].crossVectors(this.T[0], this.N[0]).normalize();
    for (let i = 1; i < n; i++) {
      // minimal rotation taking T[i-1] to T[i]
      _a.crossVectors(this.T[i - 1], this.T[i]);
      const sinA = _a.length();
      const cosA = this.T[i - 1].dot(this.T[i]);
      this.N[i].copy(this.N[i - 1]);
      if (sinA > 1e-6) {
        _a.multiplyScalar(1 / sinA);
        // Rodrigues
        const ang = Math.atan2(sinA, cosA);
        const c = Math.cos(ang);
        const s2 = Math.sin(ang);
        _b.copy(this.N[i - 1]);
        _c.crossVectors(_a, _b);
        this.N[i].copy(_b).multiplyScalar(c).addScaledVector(_c, s2).addScaledVector(_a, _a.dot(_b) * (1 - c));
      }
      this.B[i].crossVectors(this.T[i], this.N[i]).normalize();
    }
  }

  /** Samples position+frame at s (0..1) into out: { p, n, b, t }. */
  sample(s, out) {
    const f = clamp(s, 0, 1) * (this.n - 1);
    const i = Math.min(this.n - 2, Math.floor(f));
    const k = f - i;
    out.p.copy(this.P[i]).lerp(this.P[i + 1], k);
    out.n.copy(this.N[i]).lerp(this.N[i + 1], k).normalize();
    out.b.copy(this.B[i]).lerp(this.B[i + 1], k).normalize();
    out.t.copy(this.T[i]).lerp(this.T[i + 1], k).normalize();
    return out;
  }

  /**
   * layer: { s0, s1, rings, sides, rad(s)->[rx, rz], material, name, caps: [bool, bool], uv: [u, v], fold(s, phi)->offset, color }
   * Returns the Mesh (already added to this.group).
   */
  addLayer(o) {
    const sides = o.sides || 8;
    const rings = o.rings || 6;
    const caps = o.caps || [false, false];
    const nv = (rings + 1) * sides + (caps[0] ? 1 : 0) + (caps[1] ? 1 : 0);
    const pos = new Float32Array(nv * 3);
    const nor = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const idx = [];
    const [uS, vS] = o.uv || [2, 4];
    for (let r = 0; r <= rings; r++) {
      for (let k = 0; k < sides; k++) {
        const i = r * sides + k;
        uv[i * 2] = (k / sides) * uS;
        uv[i * 2 + 1] = (r / rings) * vS;
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < sides; k++) {
        const a = r * sides + k;
        const b = r * sides + ((k + 1) % sides);
        const c = a + sides;
        const d = b + sides;
        idx.push(a, b, c, b, d, c);
      }
    }
    let capA = -1;
    let capB = -1;
    let off = (rings + 1) * sides;
    if (caps[0]) {
      capA = off++;
      for (let k = 0; k < sides; k++) idx.push(capA, (k + 1) % sides, k);
    }
    if (caps[1]) {
      capB = off++;
      for (let k = 0; k < sides; k++) idx.push(capB, rings * sides + k, rings * sides + ((k + 1) % sides));
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setAttribute('aEdge', new Float32BufferAttribute(new Float32Array(nv), 1));
    g.setIndex(idx);
    const mesh = new Mesh(g, o.material);
    mesh.name = o.name || 'limb-layer';
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const layer = { ...o, sides, rings, caps, capA, capB, mesh, geometry: g, tmp: { p: new Vector3(), n: new Vector3(), b: new Vector3(), t: new Vector3() } };
    this.layers.push(layer);
    return mesh;
  }

  /** Write every layer's vertices from the current path. */
  update() {
    for (const L of this.layers) {
      const pos = L.geometry.attributes.position.array;
      const nor = L.geometry.attributes.normal.array;
      const { sides, rings, tmp } = L;
      for (let r = 0; r <= rings; r++) {
        const s = lerp(L.s0, L.s1, r / rings);
        this.sample(s, tmp);
        const rr = L.rad(s);
        const rx = rr[0];
        const rz = rr[1];
        for (let k = 0; k < sides; k++) {
          const phi = (k / sides) * TAU;
          const cx = Math.cos(phi);
          const sy = Math.sin(phi);
          const fo = L.fold ? L.fold(s, phi) : 0;
          const px = rx + fo;
          const pz = rz + fo;
          const i = (r * sides + k) * 3;
          pos[i] = tmp.p.x + tmp.n.x * px * cx + tmp.b.x * pz * sy;
          pos[i + 1] = tmp.p.y + tmp.n.y * px * cx + tmp.b.y * pz * sy;
          pos[i + 2] = tmp.p.z + tmp.n.z * px * cx + tmp.b.z * pz * sy;
          const nx = cx / Math.max(1e-4, px);
          const nz = sy / Math.max(1e-4, pz);
          const nl = 1 / Math.hypot(nx, nz);
          nor[i] = (tmp.n.x * nx + tmp.b.x * nz) * nl;
          nor[i + 1] = (tmp.n.y * nx + tmp.b.y * nz) * nl;
          nor[i + 2] = (tmp.n.z * nx + tmp.b.z * nz) * nl;
        }
      }
      if (L.capA >= 0) {
        this.sample(L.s0, tmp);
        const i = L.capA * 3;
        pos[i] = tmp.p.x;
        pos[i + 1] = tmp.p.y;
        pos[i + 2] = tmp.p.z;
        nor[i] = -tmp.t.x;
        nor[i + 1] = -tmp.t.y;
        nor[i + 2] = -tmp.t.z;
      }
      if (L.capB >= 0) {
        this.sample(L.s1, tmp);
        const i = L.capB * 3;
        pos[i] = tmp.p.x;
        pos[i + 1] = tmp.p.y;
        pos[i + 2] = tmp.p.z;
        nor[i] = tmp.t.x;
        nor[i + 1] = tmp.t.y;
        nor[i + 2] = tmp.t.z;
      }
      L.geometry.attributes.position.needsUpdate = true;
      L.geometry.attributes.normal.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Hand. Local frame: origin at the wrist centre, +y along the fingers, +z out of the palm, +x towards the thumb (right hand).
// A left hand is the same mesh mirrored by scale.x = -1 (three flips the winding).
const FINGERS = [
  // x across the knuckle line, knuckle y, [len1, len2, len3], radius at base
  { x: 0.0285, y: 0.095, len: [0.042, 0.025, 0.021], r: 0.0092, z: 0.0 }, // index
  { x: 0.0095, y: 0.099, len: [0.046, 0.028, 0.022], r: 0.0095, z: 0.0 }, // middle
  { x: -0.0095, y: 0.096, len: [0.042, 0.026, 0.021], r: 0.009, z: 0.0 }, // ring
  { x: -0.0285, y: 0.089, len: [0.033, 0.019, 0.019], r: 0.0082, z: 0.0 }, // pinky
];
const THUMB = { x: 0.034, y: 0.03, len: [0.04, 0.032, 0.026], r: 0.0108 };

export const HAND_PRESETS = {
  relaxed: { curl: [0.22, 0.3, 0.36, 0.44], thumb: 0.15, spread: 0.1 },
  open: { curl: [0.02, 0.02, 0.02, 0.02], thumb: 0.02, spread: 0.35 },
  flat: { curl: [0, 0, 0, 0], thumb: 0.05, spread: 0.12 },
  fist: { curl: [1, 1, 1, 1], thumb: 0.9, spread: 0 },
  grip: { curl: [0.72, 0.78, 0.84, 0.9], thumb: 0.55, spread: 0.02 },
  pinch: { curl: [0.42, 0.55, 0.62, 0.7], thumb: 0.6, spread: 0.05 },
  point: { curl: [0.03, 0.95, 0.95, 0.95], thumb: 0.7, spread: 0.02 },
  cup: { curl: [0.32, 0.36, 0.4, 0.45], thumb: 0.1, spread: 0.2 },
  tray: { curl: [0.2, 0.22, 0.25, 0.3], thumb: 0.05, spread: 0.18 },
};

export class Hand {
  /** `side` +1 right / -1 left, `scale` (children), `material`. */
  constructor({ side = 1, scale = 1, material, quality, color } = {}) {
    const tier = tierOf(quality);
    this.side = side;
    this.sides = tier.handSides;
    this.group = new Group();
    this.group.name = side > 0 ? 'hand-R' : 'hand-L';
    this.curl = new Float32Array(5);
    this.spread = 0.1;
    this._key = '';
    this.segs = []; // { finger, joint, vOff, vCount, tmpl: Float32Array positions, nTmpl: normals, radius0/1, len }
    this.sc = scale;
    const verts = [];
    const idx = [];
    const addSeg = (len, r0, r1) => {
      const S = this.sides;
      const rings = 1;
      const startV = verts.length / 3;
      const pos = [];
      const nor = [];
      for (let r = 0; r <= rings; r++) {
        const t = r / rings;
        const y = t * len;
        const rr = lerp(r0, r1, t) * (r === rings ? 0.82 : 1);
        for (let k = 0; k < S; k++) {
          const phi = (k / S) * TAU;
          // slightly flattened on the palm side: x wider than z
          const cx = Math.cos(phi);
          const cz = Math.sin(phi);
          pos.push(cx * rr * 1.06, y + (r === rings ? rr * 0.15 : 0), cz * rr * 0.9);
          nor.push(cx, 0.1 * (r === rings ? 1 : 0), cz);
        }
      }
      // tip cap vertex
      pos.push(0, len + r1 * 0.55, 0);
      nor.push(0, 1, 0);
      const tip = (rings + 1) * S;
      const ix = [];
      for (let r = 0; r < rings; r++) {
        for (let k = 0; k < S; k++) {
          const a = r * S + k;
          const b = r * S + ((k + 1) % S);
          ix.push(a, b, a + S, b, b + S, a + S);
        }
      }
      for (let k = 0; k < S; k++) ix.push(rings * S + k, rings * S + ((k + 1) % S), tip);
      const seg = { vOff: startV, count: tip + 1, tmpl: new Float32Array(pos), nTmpl: new Float32Array(nor), len };
      for (const i of ix) idx.push(i + startV);
      for (let i = 0; i < pos.length; i++) verts.push(0);
      this.segs.push(seg);
      return seg;
    };
    // palm as a static segment set (3 rings), written once
    this.palmCount = 0;
    this.fingers = [];
    for (let f = 0; f < 4; f++) {
      const F = FINGERS[f];
      const sg = [];
      let r0 = F.r;
      for (let j = 0; j < 3; j++) {
        const r1 = r0 * (j === 2 ? 0.8 : 0.9);
        sg.push(addSeg(F.len[j] * scale, r0 * scale, r1 * scale));
        r0 = r1;
      }
      this.fingers.push(sg);
    }
    const th = [];
    let r0 = THUMB.r;
    for (let j = 0; j < 3; j++) {
      const r1 = r0 * (j === 2 ? 0.82 : 0.92);
      th.push(addSeg(THUMB.len[j] * scale, r0 * scale, r1 * scale));
      r0 = r1;
    }
    this.fingers.push(th);
    this.palmStart = verts.length / 3;
    // palm: 4 rings (wrist -> knuckles), 8 sides, back of the hand slightly domed
    const PS = 8;
    const palmRings = [
      { y: 0.0, w: 0.029, d: 0.0165 },
      { y: 0.038, w: 0.0385, d: 0.0165 },
      { y: 0.07, w: 0.0435, d: 0.015 },
      { y: 0.098, w: 0.0455, d: 0.0125 },
    ];
    const palmPos = [];
    const palmNor = [];
    for (const R of palmRings) {
      for (let k = 0; k < PS; k++) {
        const phi = (k / PS) * TAU;
        const cx = Math.cos(phi);
        const cz = Math.sin(phi);
        palmPos.push(cx * R.w * scale, R.y * scale, cz * R.d * scale + (cz > 0 ? 0.0 : 0.0));
        palmNor.push(cx / R.w, 0, cz / R.d);
      }
    }
    const palmBase = this.palmStart;
    for (let i = 0; i < palmPos.length; i++) verts.push(palmPos[i]);
    for (let r = 0; r < palmRings.length - 1; r++) {
      for (let k = 0; k < PS; k++) {
        const a = palmBase + r * PS + k;
        const b = palmBase + r * PS + ((k + 1) % PS);
        idx.push(a, b, a + PS, b, b + PS, a + PS);
      }
    }
    // knuckle cap and wrist cap
    const capTop = verts.length / 3;
    verts.push(0, 0.1 * scale, 0);
    for (let k = 0; k < PS; k++) idx.push(palmBase + (palmRings.length - 1) * PS + k, palmBase + (palmRings.length - 1) * PS + ((k + 1) % PS), capTop);
    const capWrist = verts.length / 3;
    verts.push(0, -0.002 * scale, 0);
    for (let k = 0; k < PS; k++) idx.push(palmBase + ((k + 1) % PS), palmBase + k, capWrist);
    // thenar pad
    this.palmVerts = verts.length / 3 - palmBase;
    this.vertCount = verts.length / 3;
    this.pos = new Float32Array(this.vertCount * 3);
    this.nor = new Float32Array(this.vertCount * 3);
    // static palm part
    for (let i = 0; i < palmPos.length; i++) {
      this.pos[palmBase * 3 + i] = palmPos[i];
      this.nor[palmBase * 3 + i] = palmNor[i];
    }
    this.pos[capTop * 3 + 1] = 0.1 * scale;
    this.nor[capTop * 3 + 1] = 1;
    this.pos[capWrist * 3 + 1] = -0.002 * scale;
    this.nor[capWrist * 3 + 1] = -1;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aEdge', new Float32BufferAttribute(new Float32Array(this.vertCount), 1));
    for (let i = 0; i < idx.length; i += 3) {
      const t2 = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t2;
    }
    g.setIndex(idx);
    this.pos = g.attributes.position.array; // the attribute owns its own copy: write there
    this.nor = g.attributes.normal.array;
    this.geometry = g;
    this.mesh = new Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.scale.x = side;
    this.mesh.name = 'hand-mesh';
    this.group.add(this.mesh);
    // a grip frame (not mirrored): where tools sit
    this.grip = new Object3D();
    this.grip.name = 'hand-grip';
    this.grip.position.set(0, 0.05 * scale, 0.012 * scale);
    this.group.add(this.grip);
    void color;
    this._m = new Matrix4();
    this.setPose('relaxed', true);
  }

  /** Pose from a preset name or { curl:[4], thumb, spread }. Rewrites the finger vertices when something changed. */
  setPose(p, force = false) {
    const o = typeof p === 'string' ? HAND_PRESETS[p] || HAND_PRESETS.relaxed : p;
    this.setCurls(o.curl[0], o.curl[1], o.curl[2], o.curl[3], o.thumb, o.spread, force);
  }

  setCurls(i, m, r, p, thumb, spread, force = false) {
    const c = this.curl;
    const k = `${i.toFixed(2)}${m.toFixed(2)}${r.toFixed(2)}${p.toFixed(2)}${thumb.toFixed(2)}${spread.toFixed(2)}`;
    if (!force && k === this._key) return false;
    this._key = k;
    c[0] = i;
    c[1] = m;
    c[2] = r;
    c[3] = p;
    c[4] = thumb;
    this.spread = spread;
    this._write();
    return true;
  }

  _write() {
    const P = this.pos;
    const N = this.nor;
    const sc = this.sc;
    // joint flexion angles for a curl value
    for (let f = 0; f < 5; f++) {
      const F = f < 4 ? FINGERS[f] : THUMB;
      const cu = this.curl[f];
      let px;
      let py;
      let pz;
      // finger frame: base position, then each segment rotated about x by the accumulated flexion
      let ang;
      let yaw = f < 4 ? (f - 1.5) * this.spread * 0.35 : 0;
      if (f === 4) {
        // thumb: starts at the thenar, angled out and across the palm
        px = F.x * sc;
        py = F.y * sc;
        pz = 0.004 * sc;
        yaw = -0.62 + cu * -0.35;
        ang = -0.25 + cu * 0.55; // + moves towards the palm
      } else {
        px = F.x * sc;
        py = F.y * sc;
        pz = 0;
        ang = cu * 1.38;
      }
      let ax = ang; // accumulated flexion
      const maxs = [1.0, 1.0, 0.8];
      const segs = this.fingers[f];
      let ox = px;
      let oy = py;
      let oz = pz;
      for (let j = 0; j < 3; j++) {
        if (j > 0) ax += (f === 4 ? cu * 0.5 : cu * (j === 1 ? 1.5 : 0.95)) * maxs[j];
        const seg = segs[j];
        const cA = Math.cos(ax);
        const sA = Math.sin(ax);
        const cY = Math.cos(yaw);
        const sY = Math.sin(yaw);
        // direction of the segment axis in hand space: yaw about z, then flex about x towards +z
        const dx = -sY * cA * 0 + -sY;
        const dyv = cY * cA;
        const dzv = sA;
        // transform template points: local (x, y, z) -> origin + R * local, R built from axis d, and the side axis
        const ex = cY; // local x axis after yaw (yaw rotates about z: x' = (cY, sY, 0))
        const ey = sY;
        const t = seg.tmpl;
        const nt = seg.nTmpl;
        const base = seg.vOff * 3;
        for (let v = 0; v < seg.count; v++) {
          const lx = t[v * 3];
          const ly = t[v * 3 + 1];
          const lz = t[v * 3 + 2];
          // local y -> along (−sY*cA, cY*cA, sA); local x -> (cY, sY, 0); local z -> (sY*sA, -cY*sA, cA)
          P[base + v * 3] = ox + lx * ex + ly * -sY * cA + lz * sY * sA;
          P[base + v * 3 + 1] = oy + lx * ey + ly * cY * cA + lz * -cY * sA;
          P[base + v * 3 + 2] = oz + ly * sA + lz * cA;
          const nx = nt[v * 3];
          const ny = nt[v * 3 + 1];
          const nz = nt[v * 3 + 2];
          N[base + v * 3] = nx * ex + ny * -sY * cA + nz * sY * sA;
          N[base + v * 3 + 1] = nx * ey + ny * cY * cA + nz * -cY * sA;
          N[base + v * 3 + 2] = ny * sA + nz * cA;
        }
        const len = seg.len;
        ox += -sY * cA * len;
        oy += cY * cA * len;
        oz += sA * len;
        void dx;
        void dyv;
        void dzv;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }

  /** Orient the hand: fingers along `fingerDir`, palm facing roughly `palmHint`; position at the wrist. */
  place(wrist, fingerDir, palmHint, q = new Quaternion()) {
    _a.copy(fingerDir).normalize();
    _b.copy(palmHint).addScaledVector(_a, -palmHint.dot(_a));
    if (_b.lengthSq() < 1e-8) _b.set(0, 0, 1).addScaledVector(_a, -_a.z);
    _b.normalize(); // z axis (palm normal)
    _c.crossVectors(_a, _b); // x axis (thumb side for a right hand)
    this._m.makeBasis(_c, _a, _b);
    this.group.quaternion.setFromRotationMatrix(this._m);
    this.group.position.copy(wrist);
    return this;
  }
}
