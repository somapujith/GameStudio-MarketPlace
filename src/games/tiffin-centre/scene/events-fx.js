// The events of the operations layer, in the world (state.events -> ids rain | power | cricket | festival | inspector | delivery). This module owns the
// SMOOTHED LEVELS of all of them (so a fade in and out is one shared clock: `levels`, which sync hands to the lighting) and everything that is not the
// rain itself (weather.js), the umbrellas (street.js) or the people at the counter (sync.js):
//   POWER CUT   a diya and candles are lit by the stall (stall.js, off the lighting grid), a generator across the road starts coughing smoke after a couple of
//               seconds, phone torches light the counter from the customers' hands; the cues { type: 'power' | 'generator', on } go out to audio
//   CRICKET     the shop television across the road shows a green pitch and glows, a crowd of extra pedestrians gathers under it and jumps, flags wave, bunting
//   FESTIVAL    marigold garlands on the awning, strings of colour-changing lights (the stall front and across the road), rangoli on the footpath, a decorated cow
// Everything is built once, pooled and instanced; the effects scale in from nothing with their level. No per-frame allocation.
//   createEventsFx({ scene, art, tr, quality, fx, reducedMotion, levels }) -> { setFlags(flags), update(dt, t, L), setTorches(list, n), onCue(fn), levels, dispose }
//   `levels` is the shared object the CALLER steps each frame with stepLevels(levels, flags, dt) (sync.js), so the lighting and every effect read one clock.
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, Points, PointsMaterial, Quaternion, SphereGeometry, Vector3,
} from 'three';
import * as models from '../models/index.js';
import { createKit, shade } from './kit.js';
import { createVehicleKit } from './street-vehicles.js';
import { approach, clamp, EVENT_IDS } from './ops-view.js';
import { mulberry } from './textures.js';

const FP = -0.02; // footpath level
const SHOP_Z = -17.0;
const FAR_KERB_Z = -15.8;
const KERB_Z = -6.5;

/** Seconds a level takes to rise / fall (per event). Pure data: tested. */
export const FADE = {
  rain: [4.0, 6.0],
  power: [0.15, 0.7], // a cut is sudden; the mains come back in a flicker
  cricket: [2.5, 3.0],
  festival: [3.0, 3.0],
};
/** After this many seconds of a cut the neighbour's generator is running (the audio cue and the smoke). */
export const GENERATOR_DELAY = 2.2;

/** The shared levels object (0..1 each): { rain, power (how far the mains are CUT), cricket, festival }. */
export const makeLevels = () => ({ rain: 0, power: 0, cricket: 0, festival: 0 });

const FADE_IDS = Object.keys(FADE); // once: stepLevels runs every frame
/** One step of every level towards its flag (pure; `out` is written and returned). */
export function stepLevels(levels, flags, dt, out = levels) {
  for (let i = 0; i < FADE_IDS.length; i++) {
    const id = FADE_IDS[i];
    const target = flags && flags[id] ? 1 : 0;
    out[id] = approach(levels[id], target, dt, FADE[id][0], FADE[id][1]);
  }
  return out;
}

const _o = new Object3D();
const _c = new Color();

/** Points on a hanging line (catenary-ish parabola) from a to b with `sag` metres of droop, n + 1 points. */
export function hangingLine(a, b, sag, n, out = []) {
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = out[i] || (out[i] = [0, 0, 0]);
    p[0] = a[0] + (b[0] - a[0]) * u;
    p[1] = a[1] + (b[1] - a[1]) * u - Math.sin(Math.PI * u) * sag;
    p[2] = a[2] + (b[2] - a[2]) * u;
  }
  return out;
}

export function createEventsFx({ scene, art, tr, quality, fx = null, reducedMotion = false, levels = makeLevels() }) {
  const T = (o) => (tr ? tr.track(o) : o);
  const k = createKit(tr || { track: (o) => o });
  const { std } = k;
  const root = new Group();
  root.name = 'events';
  scene.add(root);
  const flags = {};
  for (const id of EVENT_IDS) flags[id] = false;
  const cues = new Set();
  let reduced = !!reducedMotion;
  let clock = 0;
  let powerCutFor = 0;
  let genOn = false;
  let lastPower = false;
  let night = 0;
  const rich = (quality?.decor ?? 1) >= 1;
  const rnd = mulberry(909);
  const tex = (name, arg) => {
    try {
      return art?.[name]?.(arg) || null;
    } catch {
      return null;
    }
  };
  const emit = (cue) => {
    for (const fn of cues) fn(cue);
  };

  // --- cricket: the shop television, the crowd under it, hand flags, bunting -----------------------------------------------------------------------------------
  const cricket = new Group();
  cricket.visible = false;
  root.add(cricket);
  const tvPos = { x: -5.7, y: 2.55, z: SHOP_Z + 0.55 };
  const tvTex = (() => {
    try {
      return art?.decal?.('tv') || null;
    } catch {
      return null;
    }
  })();
  // the screen is its own light: an unlit material, brightness by colour
  const screenM = T(new MeshBasicMaterial({ color: '#000000', map: tvTex, toneMapped: false }));
  const tv = new Group();
  tv.position.set(tvPos.x, tvPos.y, tvPos.z);
  tv.rotation.x = 0.12;
  {
    // (the depth buffer is coarse at 17 m: the screen stands well clear of the casing behind it, or the two z-fight into a ragged black)
    const frame = new Mesh(T(new BoxGeometry(1.7, 1.0, 0.09)), std('#151515', { roughness: 0.5 }));
    frame.position.z = -0.3;
    const screen = new Mesh(T(new PlaneGeometry(1.58, 0.89)), screenM);
    screen.position.z = 0.0;
    const bracket = new Mesh(T(new BoxGeometry(0.1, 0.1, 0.5)), std('#303030', { metalness: 0.8, roughness: 0.5 }));
    bracket.position.set(0, 0.55, -0.55);
    tv.add(frame, screen, bracket);
  }
  cricket.add(tv);
  const glowTex = tex('softDot');
  const tvGlowM = T(new PointsMaterial({ map: glowTex, size: 1.9, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xb8f0c0, opacity: 0, fog: false }));
  const tvGlowG = T(new BufferGeometry());
  tvGlowG.setAttribute('position', new Float32BufferAttribute([tvPos.x, tvPos.y, tvPos.z + 0.4], 3));
  const tvGlow = new Points(tvGlowG, tvGlowM);
  tvGlow.frustumCulled = false;
  cricket.add(tvGlow);

  // the crowd: ten extra pedestrians, backs to us, jumping
  const V = createVehicleKit(k);
  const torsoG = V.walkerTorso();
  const legG = V.walkerLeg();
  const NC = rich ? 10 : 5;
  const bodyM = std('#ffffff', { vertexColors: true, roughness: 0.6, metalness: 0.1 });
  bodyM.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('vColor.xyz *= instanceColor.xyz;', 'vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, uv.x);');
  };
  bodyM.customProgramCacheKey = () => 'tc-tintmask';
  const crowd = {
    torso: new InstancedMesh(torsoG.body, bodyM, NC),
    legL: new InstancedMesh(legG.body, bodyM, NC),
    legR: new InstancedMesh(legG.body, bodyM, NC),
  };
  const shirts = ['#f08a2a', '#1f5fb4', '#e8e0d0', '#2f8a4a', '#d8392b', '#e8b020', '#4a6a9a', '#b86a3a', '#1f5fb4', '#f08a2a'];
  const pants = ['#2a2a34', '#3a3a52', '#cfc8b8', '#1c1c1e'];
  const fans = [];
  for (let i = 0; i < NC; i++) {
    const row = i < NC / 2 ? 0 : 1;
    const col = i % Math.ceil(NC / 2);
    fans.push({ x: tvPos.x + (col - (Math.ceil(NC / 2) - 1) / 2) * 0.62 + (rnd() - 0.5) * 0.15, z: SHOP_Z + 0.55 + 0.45 + row * 0.55, ph: rnd() * 6.28, s: 0.92 + rnd() * 0.16, hop: 0.6 + rnd() * 0.8 });
    crowd.torso.setColorAt(i, _c.set(shirts[i % shirts.length]));
    crowd.legL.setColorAt(i, _c.set(pants[i % pants.length]));
    crowd.legR.setColorAt(i, _c.set(pants[i % pants.length]));
  }
  for (const m of Object.values(crowd)) {
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.frustumCulled = false;
    cricket.add(m);
  }
  // hand flags: saffron, white, green, and the team blue, waving over the heads
  const flagG = T(new PlaneGeometry(0.26, 0.17).translate(0.13, 0, 0));
  const flagM = T(new MeshBasicMaterial({ color: '#ffffff', side: DoubleSide }));
  const flags3 = new InstancedMesh(flagG, flagM, NC);
  const flagCols = ['#ff9933', '#f4f4f4', '#138808', '#1f5fb4'];
  for (let i = 0; i < NC; i++) flags3.setColorAt(i, _c.set(flagCols[i % flagCols.length]));
  flags3.instanceMatrix.setUsage(DynamicDrawUsage);
  flags3.frustumCulled = false;
  cricket.add(flags3);
  // bunting between the shop fronts above the crowd
  const bunting = (() => {
    const pts = hangingLine([-12.5, 3.9, SHOP_Z + 0.5], [-0.5, 3.9, SHOP_Z + 0.5], 0.9, 16);
    const pos = [];
    const col = [];
    const cc = ['#ff9933', '#f4f4f4', '#138808', '#1f5fb4'];
    for (let i = 0; i < 16; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      pos.push(a[0] + 0.05, a[1], a[2], b[0] - 0.05, b[1], b[2], mx, my - 0.42, a[2]);
      const c0 = new Color(cc[i % 4]);
      for (let v = 0; v < 3; v++) col.push(c0.r, c0.g, c0.b);
    }
    const g = T(new BufferGeometry());
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    const m = T(new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
    return new Mesh(g, m);
  })();
  bunting.frustumCulled = false;
  cricket.add(bunting);
  const flagGroupY = FP;

  // --- festival: garlands, string lights, rangoli, the cow -------------------------------------------------------------------------------------------------------
  const fest = new Group();
  fest.visible = false;
  root.add(fest);
  // marigold garlands along the awning's front edge
  const spans = [[-4.6, -2.3], [-2.3, 0], [0, 2.3], [2.3, 4.6]];
  const perSpan = rich ? 26 : 14;
  const marigoldG = T(new SphereGeometry(0.036, 7, 5));
  const marigoldM = T(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }));
  const garland = new InstancedMesh(marigoldG, marigoldM, spans.length * perSpan);
  {
    const pts = [];
    let n = 0;
    const cols = ['#f29a1a', '#f6c21c', '#ee7a12', '#f8d23a'];
    for (const [x0, x1] of spans) {
      hangingLine([x0, 2.5, -2.16], [x1, 2.5, -2.16], 0.28, perSpan - 1, pts);
      for (let i = 0; i < perSpan; i++) {
        _o.position.set(pts[i][0], pts[i][1], pts[i][2] + (rnd() - 0.5) * 0.03);
        _o.scale.set(1, 0.85 + rnd() * 0.3, 1);
        _o.updateMatrix();
        garland.setMatrixAt(n, _o.matrix);
        garland.setColorAt(n, _c.set(cols[(i + n) % cols.length]));
        n++;
      }
    }
    // a hanging tassel of marigolds at each join
  }
  garland.frustumCulled = false;
  fest.add(garland);
  // strings of colour-changing lights: the stall front, and two strands across the road from the pole tops
  const strands = [
    { a: [-4.6, 2.4, -2.22], b: [4.6, 2.4, -2.22], sag: 0.22, n: rich ? 36 : 20 },
    { a: [-9, 8.4, KERB_Z + 0.3], b: [-4, 8.0, FAR_KERB_Z - 0.3], sag: 1.3, n: rich ? 16 : 8 },
    { a: [11.5, 8.4, KERB_Z + 0.3], b: [16, 8.0, FAR_KERB_Z - 0.3], sag: 1.3, n: rich ? 16 : 8 },
  ];
  const NB = strands.reduce((s, x) => s + x.n, 0);
  const bulbG = T(new SphereGeometry(0.03, 6, 5));
  const bulbM = T(new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
  const bulbs = new InstancedMesh(bulbG, bulbM, NB);
  const bulbCols = ['#ff4a6a', '#ffcf2a', '#3adc7a', '#4aa8ff', '#ff8a2a', '#c05aff'].map((h) => new Color(h));
  {
    let n = 0;
    const pts = [];
    for (const s of strands) {
      hangingLine(s.a, s.b, s.sag, s.n - 1, pts);
      for (let i = 0; i < s.n; i++) {
        _o.position.set(pts[i][0], pts[i][1] - 0.03, pts[i][2]);
        _o.scale.set(1, 1.2, 1);
        _o.updateMatrix();
        bulbs.setMatrixAt(n++, _o.matrix);
      }
    }
  }
  bulbs.frustumCulled = false;
  for (let i = 0; i < NB; i++) bulbs.setColorAt(i, bulbCols[i % bulbCols.length]);
  fest.add(bulbs);
  // rangoli on the footpath in front of the stall
  const rangoliTex = (() => {
    try {
      return art?.decal?.('rangoli') || null;
    } catch {
      return null;
    }
  })();
  const rangoliM = T(new MeshBasicMaterial({ map: rangoliTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, toneMapped: true }));
  for (const [x, z, s, r] of [[-0.9, -3.3, 2.1, 0.3], [3.7, -3.2, 1.3, 1.1]]) {
    const m = new Mesh(T(new PlaneGeometry(1, 1)), rangoliM);
    m.rotation.set(-Math.PI / 2, 0, r);
    m.scale.set(s, s, 1);
    m.position.set(x, 0.006, z);
    fest.add(m);
  }
  // the decorated cow: the zebu with its own marigold garland, plus a red and gold blanket, painted horn tips and a flower crown
  let cow = null;
  try {
    cow = models.buildStreetProp?.('cow') ?? null;
  } catch {
    cow = null;
  }
  if (cow?.group) {
    cow.group.position.set(3.1, FP, -4.35);
    cow.group.rotation.y = 0.55;
    const redM = std('#c8282a', { roughness: 0.8 });
    const goldM = std('#e6b422', { roughness: 0.45, metalness: 0.5 });
    const blanket = new Mesh(T(new BoxGeometry(0.62, 0.025, 0.78)), redM);
    blanket.position.set(0, 1.14, 0.08);
    blanket.rotation.z = 0;
    const edge1 = new Mesh(T(new BoxGeometry(0.64, 0.03, 0.06)), goldM);
    edge1.position.set(0, 1.135, 0.5);
    const edge2 = edge1.clone();
    edge2.position.z = -0.34;
    const drapeL = new Mesh(T(new BoxGeometry(0.02, 0.28, 0.78)), redM);
    drapeL.position.set(-0.32, 1.0, 0.08);
    const drapeR = drapeL.clone();
    drapeR.position.x = 0.32;
    cow.group.add(blanket, edge1, edge2, drapeL, drapeR);
    for (const sx of [-1, 1]) {
      const tip = new Mesh(T(new SphereGeometry(0.03, 6, 5)), goldM);
      tip.position.set(sx * 0.23, 1.25, 1.07);
      cow.group.add(tip);
    }
    shade(cow.group, true, true);
    fest.add(cow.group);
  }

  // --- power cut: the neighbour's generator, and phone torches ------------------------------------------------------------------------------------------------------
  const gen = new Group();
  gen.position.set(-14.1, FP, SHOP_Z + 0.9);
  gen.visible = false;
  {
    const body = new Mesh(T(new BoxGeometry(0.7, 0.5, 0.5)), std('#d8a21a', { roughness: 0.55 }));
    body.position.y = 0.42;
    const frame = new Mesh(T(new BoxGeometry(0.76, 0.05, 0.56)), std('#222222', { roughness: 0.6 }));
    frame.position.y = 0.17;
    const tank = new Mesh(T(new CylinderGeometry(0.1, 0.1, 0.4, 10)), std('#b9281d', { roughness: 0.5 }));
    tank.rotation.z = Math.PI / 2;
    tank.position.set(0, 0.75, 0);
    const pipe = new Mesh(T(new CylinderGeometry(0.03, 0.03, 0.5, 6)), std('#2a2a2a', { roughness: 0.6 }));
    pipe.position.set(0.3, 0.9, 0.22);
    gen.add(body, frame, tank, pipe);
  }
  root.add(gen);
  const genSmoke = { kind: 'smoke', rate: 0, acc: 0 };
  const NT = 4;
  const torchG = T(new ConeGeometry(0.42, 2.2, 14, 1, true).translate(0, -1.1, 0));
  const torchM = T(new MeshBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide }));
  const torches = [];
  for (let i = 0; i < NT; i++) {
    const m = new Mesh(torchG, torchM);
    m.visible = false;
    m.renderOrder = 7;
    root.add(m);
    torches.push(m);
  }
  const torchTip = new Vector3();
  const torchAim = new Vector3();
  const torchQ = new Quaternion();
  const DOWN = new Vector3(0, -1, 0);
  let torchN = 0;
  const torchList = [];

  // --- the frame -----------------------------------------------------------------------------------------------------------------------------------------------------------
  const mtx = new Matrix4();
  const writeCrowd = (t, lvl) => {
    const s0 = Math.max(0.0001, lvl);
    for (let i = 0; i < NC; i++) {
      const f = fans[i];
      const jump = reduced ? 0 : Math.max(0, Math.sin(t * 6.4 * f.hop + f.ph)) * 0.14 * lvl * (Math.sin(t * 0.5 + f.ph) > -0.3 ? 1 : 0.2);
      const sw = reduced ? 0 : Math.sin(t * 3.1 + f.ph) * 0.05;
      const yaw = Math.PI / 2 + sw;
      const s = f.s * s0;
      const swing = reduced ? 0 : Math.sin(t * 6.4 * f.hop + f.ph) * 0.35 * lvl;
      _o.position.set(f.x, FP + jump, f.z);
      _o.rotation.set(0, yaw, 0, 'YZX');
      _o.scale.setScalar(s);
      _o.updateMatrix();
      crowd.torso.setMatrixAt(i, _o.matrix);
      const hipY = FP + 0.88 * s + jump;
      for (const [mesh, side, sgn] of [[crowd.legL, 0.1, 1], [crowd.legR, -0.1, -1]]) {
        _o.position.set(f.x + Math.sin(yaw) * side * s, hipY, f.z + Math.cos(yaw) * side * s);
        _o.rotation.set(0, yaw, sgn * swing, 'YZX');
        _o.updateMatrix();
        mesh.setMatrixAt(i, _o.matrix);
      }
      // the flag over a raised hand, waving
      _o.position.set(f.x + 0.12, flagGroupY + 1.95 * f.s * s0 + jump, f.z);
      _o.rotation.set(0, Math.sin(t * 7 + f.ph) * 0.5, Math.sin(t * 9 + f.ph) * 0.25, 'YZX');
      _o.scale.setScalar(s0);
      _o.updateMatrix();
      flags3.setMatrixAt(i, _o.matrix);
    }
    crowd.torso.instanceMatrix.needsUpdate = true;
    crowd.legL.instanceMatrix.needsUpdate = true;
    crowd.legR.instanceMatrix.needsUpdate = true;
    flags3.instanceMatrix.needsUpdate = true;
  };
  let blink = -1;

  function update(dt, t, L) {
    clock = t;
    const d = Math.min(0.1, Math.max(0, dt));
    night = L && Number.isFinite(L.night) ? L.night : night;
    const cut = flags.power;
    // cues for the audio: the cut itself, and the generator a moment after
    if (cut !== lastPower) {
      lastPower = cut;
      emit({ type: 'power', on: !cut });
      if (!cut && genOn) {
        genOn = false;
        emit({ type: 'generator', on: false });
      }
    }
    powerCutFor = cut ? powerCutFor + d : 0;
    if (cut && !genOn && powerCutFor > GENERATOR_DELAY) {
      genOn = true;
      emit({ type: 'generator', on: true });
    }
    // cricket
    const cl = levels.cricket;
    cricket.visible = cl > 0.002;
    if (cricket.visible) {
      const flick = 0.85 + 0.15 * Math.sin(t * 9) * Math.sin(t * 2.3 + 1);
      screenM.color.setScalar(clamp(1.1 * cl * flick, 0, 1.6));
      tvGlowM.opacity = 0.32 * cl * (0.8 + 0.2 * flick) * (0.3 + 0.7 * night);
      bunting.scale.set(1, Math.max(0.001, cl), 1);
      bunting.position.y = 3.9 * (1 - cl);
      writeCrowd(t, cl);
    }
    // festival
    const fl = levels.festival;
    fest.visible = fl > 0.002;
    if (fest.visible) {
      garland.scale.set(1, Math.max(0.001, fl), 1);
      garland.position.y = 2.5 * (1 - fl);
      bulbM.color.setScalar(0.8 + 0.5 * (0.4 + 0.6 * night) * fl);
      const phase = Math.floor(t * (reduced ? 1 : 2.5));
      if (phase !== blink) {
        blink = phase;
        for (let i = 0; i < NB; i++) bulbs.setColorAt(i, bulbCols[(i + phase) % bulbCols.length]);
        bulbs.instanceColor.needsUpdate = true;
      }
      bulbs.scale.set(1, Math.max(0.001, fl), 1);
      cow?.update?.(d, t);
    }
    // the generator across the road (it keeps shaking and smoking while the cut lasts)
    gen.visible = levels.power > 0.5 && genOn;
    if (gen.visible) {
      gen.position.y = FP + Math.sin(t * 60) * 0.003;
      genSmoke.rate = reduced ? 1 : 3;
      if (fx) fx.emit(genSmoke, gen.position.x + 0.3, 1.0, gen.position.z + 0.22, d);
    } else genSmoke.rate = 0;
    // phone torches: cones from the customers' hands towards the cook, only in a cut and brighter the darker it is
    const tl = levels.power * (0.4 + 0.6 * night);
    for (let i = 0; i < NT; i++) {
      const m = torches[i];
      const on = tl > 0.03 && i < torchN;
      m.visible = on;
      if (!on) continue;
      const p = torchList[i];
      torchTip.set(p.x, 1.05, p.z);
      torchAim.set(0.1 * (i % 2 ? 1 : -1), -0.32, 1).normalize();
      m.position.copy(torchTip);
      torchQ.setFromUnitVectors(DOWN, torchAim);
      m.quaternion.copy(torchQ);
    }
    torchM.opacity = 0.2 * tl * (0.9 + 0.1 * Math.sin(t * 40));
    void mtx;
    void clock;
  }

  function dispose() {
    scene.remove(root);
    cow?.dispose?.();
    for (const m of Object.values(crowd)) m.dispose?.();
    flags3.dispose();
    garland.dispose();
    bulbs.dispose();
    cues.clear();
    if (!tr) {
      for (const g of [torsoG.body, legG.body]) g?.dispose?.();
    }
  }

  return {
    levels,
    flags,
    root,
    /** Which events are running (booleans by id); the levels fade towards them. */
    setFlags(f) {
      for (const id of EVENT_IDS) flags[id] = !!(f && f[id]);
    },
    update,
    /** Phone torches at customers: list of { x, z } (the first NT are used). */
    setTorches(list, n) {
      torchN = Math.min(NT, Math.max(0, n | 0));
      for (let i = 0; i < torchN; i++) torchList[i] = list[i];
    },
    /** fn({ type: 'power' | 'generator', on }) for audio. Returns an unsubscribe. */
    onCue(fn) {
      cues.add(fn);
      return () => cues.delete(fn);
    },
    get generatorOn() {
      return genOn;
    },
    setReduced(b) {
      reduced = !!b;
    },
    dispose,
  };
}
void clamp;
