// Customers: ~1.6 m low-poly Hyderabadi street-stall regulars, one distinct silhouette per kind, deterministic variation per seed.
// The returned group FACES -z (towards the stall); rotate group.rotation.y for any other heading. Origin = between the feet.
import { AdditiveBlending, CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RingGeometry, Color } from 'three';
import { CUSTOMER_KINDS } from '../../../../shared/tiffin-centre/catalog.js';
import { Parts, clamp01, damp, disposeObject, materials, num, rng, sharedGeo, sharedMat } from './util.js';
import { buildPerson, resetPose, shade } from './person.js';
import { Puffs } from './fx.js';
import { noteTexture } from './textures.js';

export const MOODS = ['waiting', 'eating', 'paying', 'happy', 'angry', 'walkaway'];

const SKIN = ['#f0c8a0', '#e3ab7c', '#c98a50', '#a8723e', '#8a5a2e', '#6e4526'];
const HAIR = ['#17100c', '#241811', '#33241a', '#0f0f12'];
const BRIGHTS = ['#e0392b', '#ff8a1f', '#12908e', '#2f9e5b', '#7a4bb8', '#d6336c', '#ffc83d'];

function officeSpec(r) {
  const female = r.chance(0.42);
  const hair = r.pick(HAIR);
  return {
    scale: r.range(0.97, 1.05),
    skin: r.pick(SKIN),
    top: female ? { kind: 'kurti', color: r.pick(BRIGHTS), sleeve: 'short' } : { kind: 'shirt', color: r.pick(['#e8eef5', '#b7d0ea', '#f1e2e2', '#d9e8d2', '#cdd5ee']), sleeve: 'long', pocket: true },
    bottom: { kind: 'trousers', color: r.pick(['#2c3345', '#3a3a3c', '#4a3f35']) },
    shoes: { kind: 'shoe', color: '#1d1612' },
    hair: { style: female ? r.pick(['long', 'plait', 'bun']) : 'short', color: hair },
    face: { moustache: !female && r.chance(0.35), glasses: r.chance(0.25), bindi: female && r.chance(0.6), hairColor: hair },
    extras: (ctx) => {
      if (!female) ctx.body.box(0.05, 0.26, 0.02, r.pick(['#c0392b', '#1f3a6e', '#6a2c70']), { p: [0, 0.3, 0.108] }); // tie
    },
    after: (p) => {
      // steel tiffin carrier (3 tiers, clip and handle) in the left hand
      const T = new Parts();
      for (let i = 0; i < 3; i++) T.cyl(0.075, 0.075, 0.058, 9, i % 2 ? '#aeb8be' : '#c9d1d6', { p: [0, -0.15 - i * 0.062, 0] });
      T.cyl(0.078, 0.078, 0.012, 9, '#8f9aa1', { p: [0, -0.115, 0] });
      T.cyl(0.004, 0.004, 0.2, 4, '#6f7a80', { p: [0.072, -0.2, 0] });
      T.torus(0.07, 0.005, '#6f7a80', { p: [0, -0.09, 0], r: [0, Math.PI / 2, 0] }, 3, 8, Math.PI);
      p.ctx.attach(p.arms[0].hand, T);
    },
  };
}

function studentSpec(r) {
  const female = r.chance(0.45);
  const hair = r.pick(HAIR);
  const pack = r.pick(['#ff8a1f', '#12908e', '#e0392b', '#2f6fd0']);
  return {
    scale: r.range(0.93, 1.0),
    skin: r.pick(SKIN),
    top: { kind: 'tee', color: r.pick(['#ff8a1f', '#12908e', '#e0392b', '#2f9e5b', '#7a4bb8', '#f2f2f2']), sleeve: 'short' },
    bottom: { kind: r.chance(0.2) ? 'shorts' : 'trousers', color: r.pick(['#3b5b8c', '#2d4670', '#404552']) },
    shoes: { kind: 'shoe', color: '#e8e3da' },
    hair: { style: female ? r.pick(['long', 'plait']) : 'short', color: hair },
    face: { glasses: r.chance(0.2), bindi: female && r.chance(0.3), hairColor: hair },
    extras: (ctx) => {
      ctx.body.box(0.3, 0.4, 0.15, pack, { p: [0, 0.3, -0.15] }); // backpack
      ctx.body.box(0.24, 0.16, 0.05, shade(pack, 0.8), { p: [0, 0.2, -0.24] });
      ctx.body.box(0.2, 0.05, 0.1, shade(pack, 0.7), { p: [0, 0.53, -0.15] });
      for (const x of [-0.1, 0.1]) ctx.body.box(0.045, 0.42, 0.02, shade(pack, 0.65), { p: [x, 0.32, 0.105] });
    },
  };
}

function personFamilyParent(r) {
  const mother = r.chance(0.55);
  const hair = r.pick(HAIR);
  if (mother) {
    return {
      scale: r.range(0.97, 1.02),
      skin: r.pick(SKIN),
      top: { kind: 'saree', color: r.pick(['#d6336c', '#12908e', '#7a4bb8', '#e0392b']), sleeve: 'short' },
      bottom: { kind: 'skirt', color: r.pick(['#e0392b', '#2f9e5b', '#ff8a1f', '#2f6fd0']), trim: '#f4c542' },
      shoes: { kind: 'slipper', color: '#3b2a20' },
      hair: { style: r.pick(['bun', 'plait']), color: hair },
      face: { bindi: true, hairColor: hair },
    };
  }
  return {
    scale: r.range(1.0, 1.06),
    skin: r.pick(SKIN),
    top: { kind: 'shirt', color: r.pick(['#d9e8d2', '#f3e3b6', '#b7d0ea']), sleeve: 'short', pocket: true },
    bottom: { kind: 'trousers', color: r.pick(['#4a3f35', '#2c3345']) },
    shoes: { kind: 'slipper', color: '#3b2a20' },
    hair: { style: 'short', color: hair },
    face: { moustache: r.chance(0.6), hairColor: hair },
  };
}

function childSpec(r) {
  const hair = r.pick(HAIR);
  return {
    scale: 0.58,
    headScale: 1.22,
    skin: r.pick(SKIN),
    top: { kind: 'tee', color: r.pick(['#ffc83d', '#e0392b', '#12908e', '#ff8a1f']), sleeve: 'short' },
    bottom: { kind: 'shorts', color: r.pick(['#2f6fd0', '#2f9e5b', '#7a4bb8']) },
    shoes: { kind: 'slipper', color: '#e0392b' },
    hair: { style: r.chance(0.5) ? 'short' : 'plait', color: hair },
    face: { hairColor: hair },
  };
}

function uncleSpec(r) {
  const white = '#ece7da';
  const beard = r.chance(0.55);
  return {
    scale: r.range(0.94, 0.99),
    skin: r.pick(SKIN.slice(1, 5)),
    top: { kind: 'kurta', color: r.pick([white, '#f1ead6', '#cfd8cf', '#d7cdbb']), sleeve: 'long' },
    bottom: { kind: 'pyjama', color: white },
    shoes: { kind: 'slipper', color: '#6b4a2b' },
    hair: { style: 'none', color: '#d8d8d8', side: '#d8d8d8' },
    headgear: { kind: 'topi', color: '#f6f2e6' },
    face: { moustache: true, beard, glasses: r.chance(0.5), hairColor: '#e4e4e4' },
    after: (p) => {
      // walking stick planted beside the left foot, left hand resting on the crook
      const S = new Parts();
      S.cyl(0.015, 0.012, 0.88, 5, '#6b4a2b', { p: [0, 0.44, 0] });
      S.torus(0.045, 0.014, '#5a3d22', { p: [0.045, 0.9, 0], r: [0, 0, 0] }, 4, 8, Math.PI);
      S.cyl(0.018, 0.018, 0.03, 5, '#2a2a2a', { p: [0, 0.015, 0] });
      const m = p.ctx.attach(p.root, S, -0.27, 0, 0.16);
      m.rotation.z = -0.04;
    },
  };
}

function autowalaSpec(r) {
  const hair = r.pick(HAIR);
  return {
    scale: r.range(0.98, 1.05),
    skin: r.pick(SKIN.slice(2)),
    top: { kind: 'shirt', color: '#bfa95a', sleeve: 'short', pocket: true },
    bottom: { kind: 'trousers', color: '#8f8247' },
    shoes: { kind: 'slipper', color: '#2a4f9e' },
    hair: { style: 'short', color: hair },
    headgear: r.chance(0.45) ? { kind: 'cap', color: '#bfa95a' } : null,
    face: { moustache: true, hairColor: hair },
    extras: (ctx) => {
      // red-and-white gamchha over the shoulder
      ctx.body.box(0.12, 0.035, 0.2, '#c0392b', { p: [0.14, 0.545, 0], r: [0, 0, -0.35] });
      ctx.body.box(0.075, 0.24, 0.02, '#c0392b', { p: [0.19, 0.4, 0.108] });
      ctx.body.box(0.077, 0.02, 0.022, '#f3ede0', { p: [0.19, 0.36, 0.108] });
      ctx.body.box(0.077, 0.02, 0.022, '#f3ede0', { p: [0.19, 0.28, 0.108] });
    },
  };
}

function techieSpec(r) {
  const female = r.chance(0.4);
  const hair = r.pick(HAIR);
  return {
    scale: r.range(0.97, 1.04),
    skin: r.pick(SKIN),
    top: { kind: 'tee', color: r.pick(['#6f7f6f', '#8a8f99', '#3d4e6b', '#a65d5d']), sleeve: 'short' },
    bottom: { kind: 'trousers', color: r.pick(['#b8a888', '#4a4f5a']) },
    shoes: { kind: 'shoe', color: '#f1efe9' },
    hair: { style: female ? r.pick(['long', 'bun']) : 'short', color: hair },
    face: { glasses: r.chance(0.6), hairColor: hair, bindi: female && r.chance(0.3) },
    extras: (ctx) => {
      // red lanyard + ID badge, messenger laptop bag on a cross strap
      for (const sx of [-1, 1]) ctx.body.box(0.014, 0.34, 0.012, '#d0182c', { p: [sx * 0.05, 0.38, 0.112], r: [0, 0, -sx * 0.16] });
      ctx.body.box(0.075, 0.1, 0.012, '#f3f3f3', { p: [0, 0.2, 0.116] });
      ctx.body.box(0.075, 0.025, 0.014, '#12908e', { p: [0, 0.245, 0.117] });
      ctx.body.box(0.04, 0.68, 0.014, '#2c2f36', { p: [0.02, 0.28, 0.108], r: [0, 0, 0.74] });
      ctx.body.box(0.04, 0.68, 0.014, '#2c2f36', { p: [0.02, 0.28, -0.108], r: [0, 0, 0.74] });
      ctx.body.box(0.1, 0.26, 0.36, '#2c2f36', { p: [0.25, 0.0, -0.04] });
      ctx.body.box(0.104, 0.07, 0.3, '#3a3f49', { p: [0.25, 0.1, -0.04] });
      ctx.body.box(0.02, 0.04, 0.06, '#c9d1d6', { p: [0.305, 0.06, -0.04] });
    },
  };
}

const SPECS = { office: officeSpec, student: studentSpec, family: personFamilyParent, uncle: uncleSpec, autowala: autowalaSpec, techie: techieSpec };
// per-kind resting posture
const BASE = {
  uncle: { hx: 0.1, aLx: -0.45 },
  student: { hx: 0.03 },
  techie: { hx: 0.02 },
};

const C_GREEN = new Color('#3ddc84');
const C_AMBER = new Color('#ffb02e');
const C_RED = new Color('#ef3b2d');
const _col = new Color();
const RING_SEG = 40;

function patienceColor(f, out) {
  if (f > 0.5) return out.copy(C_AMBER).lerp(C_GREEN, (f - 0.5) / 0.5);
  return out.copy(C_RED).lerp(C_AMBER, Math.min(1, f / 0.5));
}

/** buildCustomer(kindId, seed) -> { group, setMood, setPatience, update(dt,t), dispose() } */
export function buildCustomer(kindId, seed = 0) {
  const kind = SPECS[kindId] ? kindId : 'office';
  const r = rng(`${kind}:${seed}`);
  const group = new Group();
  group.name = `customer-${kind}`;
  group.userData.kind = kind;
  const rig = new Group();
  rig.rotation.y = Math.PI; // face -z
  group.add(rig);

  const main = buildPerson(SPECS[kind](r));
  rig.add(main.root);
  const people = [main];
  let child = null;
  if (kind === 'family') {
    child = buildPerson(childSpec(r));
    child.root.position.set(0.42, 0, 0.03);
    rig.add(child.root);
    people.push(child);
    main.root.position.x = -0.12;
  }
  const ph = [r() * 6.28, r() * 6.28];
  const height = 1.62 * main.root.scale.y;
  group.userData.height = height;

  // paying: a glowing rupee note held out in the right hand (arm index 1 = +x local)
  const noteMat = new MeshStandardMaterial({ color: '#ffffff', map: noteTexture(), emissive: '#3dff8c', emissiveMap: noteTexture(), emissiveIntensity: 0.9, roughness: 0.6, side: DoubleSide });
  const note = new Mesh(sharedGeo('cust:note', () => new PlaneGeometry(0.2, 0.1)), noteMat);
  note.position.set(0, -0.12, 0.025);
  note.rotation.x = 0.0;
  note.visible = false;
  main.arms[1].hand.add(note);
  const haloMat = new MeshBasicMaterial({ color: '#3dff8c', transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  const halo = new Mesh(sharedGeo('cust:halo', () => new CircleGeometry(0.17, 16)), haloMat);
  halo.position.set(0, -0.12, 0.012);
  halo.visible = false;
  main.arms[1].hand.add(halo);

  // angry: steam from both ears
  const earSteam = [
    new Puffs(main.headG, materials.steam(), 3, { x: -0.14, y: 0.1, z: 0, rise: 0.28, size: 0.07, speed: 0.9, drift: 0.05 }),
    new Puffs(main.headG, materials.steam(), 3, { x: 0.14, y: 0.1, z: 0, rise: 0.28, size: 0.07, speed: 0.9, drift: 0.05 }),
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
  ringG.visible = true;

  let mood = 'waiting';
  let patience = 1;
  let angry = 0;
  let disposed = false;
  let lastSegs = -1;

  const poseFor = (p, m, t, k, who) => {
    const T = p.target;
    resetPose(T);
    const b = who === 0 ? BASE[kind] : null;
    if (b) for (const key of Object.keys(b)) T[key] = b[key];
    const phs = ph[who];
    T.breathe = Math.sin(t * 1.8 + phs) * 0.012;
    T.headY = Math.sin(t * 0.7 + phs) * 0.28;
    const kid = who === 1;
    switch (m) {
      case 'waiting': {
        const rate = 5 + (1 - patience) * 6;
        T.lR = Math.max(0, Math.sin(t * rate + phs)) * -0.2;
        if (kid) T.hy = Math.abs(Math.sin(t * 4 + phs)) * 0.04;
        if (!kid && patience < 0.4) {
          T.aLx = -0.5;
          T.eL = -2.0 + Math.sin(t * 2 + phs) * 0.06; // checking the wrist / watch
          T.headX = 0.2;
        }
        if (!kid && patience < 0.2) T.hx += 0.06 + Math.sin(t * 9) * 0.02;
        break;
      }
      case 'eating': {
        const bite = Math.sin(t * 4.2 + phs);
        T.aRx = -0.5;
        T.eR = -2.35 - bite * 0.22;
        T.headX = 0.1 + bite * 0.06;
        T.hy = bite * 0.006;
        break;
      }
      case 'paying': {
        T.aRx = -1.5;
        T.eR = -0.12;
        T.aRz = 0.14;
        T.hx += 0.07;
        T.headY = 0;
        if (kid) {
          T.aRx = 0;
          T.eR = -0.1;
          T.hy = Math.abs(Math.sin(t * 5 + phs)) * 0.03;
        }
        break;
      }
      case 'happy': {
        const hop = Math.abs(Math.sin(t * 7 + phs));
        T.hy = hop * (kid ? 0.14 : 0.1);
        T.aLx = T.aRx = -2.7 + Math.sin(t * 14) * 0.15;
        T.aLz = T.aRz = 0.35;
        T.eL = T.eR = -0.15;
        T.lL = T.lR = hop * -0.25;
        T.headX = -0.12;
        break;
      }
      case 'angry': {
        const s = Math.sin(t * 8 + phs);
        T.lL = Math.max(0, s) * -0.5;
        T.lR = Math.max(0, -s) * -0.5;
        T.hy = -Math.abs(s) * 0.02;
        T.hz = Math.sin(t * 26) * 0.03;
        T.aLx = T.aRx = -0.35;
        T.eL = T.eR = -1.5;
        T.aLz = T.aRz = 0.25;
        T.headX = 0.12;
        T.hx += 0.08;
        T.headY = Math.sin(t * 20) * 0.08;
        break;
      }
      case 'walkaway': {
        const w = Math.sin(t * 7 + phs);
        T.lL = -w * 0.7;
        T.lR = w * 0.7;
        T.aLx = w * 0.5;
        T.aRx = -w * 0.5;
        T.hy = -Math.abs(Math.cos(t * 7 + phs)) * 0.025;
        T.headX = 0.05;
        T.headY = 0;
        break;
      }
      default:
    }
    void k;
  };

  const api = {
    group,
    kind,
    get mood() {
      return mood;
    },
    setMood(m) {
      mood = MOODS.includes(m) ? m : 'waiting';
      const face = mood === 'happy' || mood === 'paying' ? 'smile' : mood === 'eating' || mood === 'angry' ? 'open' : 'flat';
      for (const p of people) p.setFace(face, mood === 'angry');
      note.visible = halo.visible = mood === 'paying';
      ringG.visible = mood === 'waiting' || mood === 'paying';
      lastSegs = -1;
    },
    setPatience(f) {
      patience = clamp01(num(f, 1));
    },
    update(dt, t) {
      if (disposed) return;
      const d = Math.min(0.1, Math.max(0, num(dt, 0.016)));
      const tt = num(t, 0);
      for (let i = 0; i < people.length; i++) {
        poseFor(people[i], mood, tt, 0, i);
        people[i].step(d, mood === 'walkaway' || mood === 'angry' ? 14 : 9);
      }
      angry = damp(angry, mood === 'angry' ? 1 : 0, 6, d);
      for (const p of people) {
        p.vc.emissive.setRGB(1, 0.1, 0.05);
        p.vc.emissiveIntensity = angry * (0.35 + 0.1 * Math.sin(tt * 14));
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
        note.rotation.z = Math.sin(tt * 3) * 0.05;
        const s = 0.7 + 0.3 * f; // the note visibly shrinks as the pay window runs out
        note.scale.set(s, s, 1);
        halo.scale.setScalar(0.6 + 0.4 * f);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeObject(group);
    },
  };
  for (const p of people) {
    resetPose(p.target);
    resetPose(p.cur);
    p.step(0.016);
  }
  api.setMood('waiting');
  api.update(0.016, 0);
  return api;
}

export const CUSTOMER_KIND_IDS = Object.keys(CUSTOMER_KINDS);
