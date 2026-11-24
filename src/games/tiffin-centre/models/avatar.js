// The player's cook: a street-stall wallah in a half-sleeve shirt, lungi or trousers, a gamchha towel on the shoulder, a stained
// apron in the player's colour, a headcloth and slippers. Procedural poses (idle/walk/carry/cheer + seven WORK poses).
// Facing: +z is the front of the model. setFacing(dir) turns to face +x (1) / -x (-1) while walking; dir 0 uses the pose's own
// heading (stations: back to the camera, serve/collect: towards the customers). Rotations about x are negative = forward.
import { CylinderGeometry, Color, Group, Mesh, Quaternion, Sprite, SpriteMaterial, Vector3 } from 'three';
import { HANDS_MAX } from '../../../../shared/tiffin-centre/catalog.js';
import { WORK_MS } from '../../../../shared/tiffin-centre/movement.js';
import { Parts, clamp01, damp, disposeObject, hashSeed, materials, num, rng, sharedGeo } from './util.js';
import { buildPerson, resetPose, shade } from './person.js';
import { buildDish } from './dishes.js';
import { nameTagTexture } from './textures.js';

export const POSES = ['idle', 'walk', 'carry', 'cheer', 'work-tawa', 'work-steamer', 'work-kadai', 'work-chai', 'work-serve', 'work-collect', 'work-discard'];

const WORK_S = WORK_MS / 1000;
const TAU = Math.PI * 2;
const sm = (x) => {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
};
const wrapPi = (a) => {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};

// --- tools held in the hand. Local frame: the grip is the origin, the tool continues along -y (the forearm direction). ---
function toolGeo(key, build) {
  return sharedGeo(`tool:${key}`, () => {
    const P = new Parts();
    build(P);
    return P.build('solid');
  });
}
const TOOLS = {
  ladle: () =>
    toolGeo('ladle', (P) => {
      P.cyl(0.008, 0.008, 0.34, 5, '#cfd6db', { p: [0, -0.17, 0] });
      P.dome(0.05, '#c3ccd1', { p: [0, -0.36, 0.02], r: [Math.PI / 2 + 0.2, 0, 0], s: [1, 0.8, 1] }, 8, 3);
      P.sph(0.012, '#3a3a3a', { p: [0, -0.01, 0] }, 4, 3);
    }),
  spatula: () =>
    toolGeo('spatula', (P) => {
      P.cyl(0.009, 0.009, 0.3, 5, '#6b4a2b', { p: [0, -0.15, 0] });
      P.box(0.09, 0.13, 0.008, '#cfd6db', { p: [0, -0.37, 0.0], r: [0.1, 0, 0] });
    }),
  jhara: () =>
    toolGeo('jhara', (P) => {
      P.cyl(0.009, 0.009, 0.42, 5, '#cfd6db', { p: [0, -0.21, 0] });
      P.cyl(0.075, 0.075, 0.008, 10, '#c3ccd1', { p: [0, -0.5, 0], r: [Math.PI / 2, 0, 0] });
      for (const [x, y] of [[-0.03, -0.48], [0.03, -0.48], [0, -0.52], [-0.035, -0.53], [0.035, -0.53]]) P.cyl(0.008, 0.008, 0.012, 4, '#2a2a2a', { p: [x, y, 0], r: [Math.PI / 2, 0, 0] });
    }),
  plate: () =>
    toolGeo('plate', (P) => {
      P.lathe([[0, 0], [0.09, 0], [0.13, 0.014], [0.14, 0.03], [0.12, 0.018], [0, 0.008]], 12, '#cfd6db', { p: [0, -0.07, 0], r: [Math.PI / 2, 0, 0] });
    }),
  mug: () =>
    toolGeo('mug', (P) => {
      P.lathe([[0, 0], [0.04, 0], [0.05, 0.1], [0.046, 0.1], [0.037, 0.01]], 8, '#d7dde1', { p: [0, -0.05, -0.04], r: [Math.PI / 2, 0, 0] });
      P.torus(0.05, 0.005, '#8f9aa1', { p: [0, -0.05, 0.06], r: [0, 0, 0] }, 3, 8);
    }),
  note: () =>
    toolGeo('note', (P) => {
      P.box(0.14, 0.07, 0.004, '#3aa65a', { p: [0, -0.07, 0.012] });
      P.box(0.12, 0.05, 0.005, '#f6d36a', { p: [0, -0.07, 0.01] });
    }),
};

const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();
const UP = new Vector3(0, 1, 0);

/** buildAvatar({ color, name }) -> { group, setPose, setHands, setFacing, setLane, update, dispose } */
export function buildAvatar({ color = '#ff8a1f', name = '' } = {}) {
  const hexColor = `#${new Color(color).getHexString()}`;
  const r = rng(`avatar:${name}:${hexColor}`);
  const lungi = r.chance(0.6);
  const group = new Group();
  group.name = 'avatar';
  const lane = new Group();
  group.add(lane);
  const yawG = new Group();
  lane.add(yawG);

  const person = buildPerson({
    scale: 1,
    skin: r.pick(['#e3ab7c', '#c98a50', '#a8723e', '#8a5a2e', '#f0c8a0']),
    top: { kind: 'shirt', color: r.pick(['#efe9d8', '#cfe0ef', '#e8d9a8', '#d9d4c8']), sleeve: 'short', pocket: true },
    bottom: lungi
      ? { kind: 'lungi', color: r.pick(['#2f5da8', '#1f7a5c', '#8a2d2d', '#4d3a8a']), trim: '#f0e6c8' }
      : { kind: 'trousers', color: r.pick(['#3a3f4a', '#4a3f35']) },
    shoes: { kind: 'slipper', color: r.pick(['#ff8a1f', '#2a6fd0', '#d0392b']) },
    hair: { style: 'short', color: '#1a120e' },
    headgear: { kind: 'cloth', color: r.pick(['#f4eacb', '#c0392b', '#ffc83d', '#e8e8e8']) },
    face: { moustache: r.chance(0.65), hairColor: '#1a120e' },
    extras: (ctx) => {
      // stained apron in the player's colour, tied at the back, with a halter strap
      const c = hexColor;
      ctx.body.box(0.31, 0.58, 0.022, c, { p: [0, 0.1, 0.112] });
      ctx.body.box(0.2, 0.2, 0.022, c, { p: [0, 0.4, 0.108] });
      ctx.body.box(0.31, 0.03, 0.024, shade(c, 0.7), { p: [0, -0.19, 0.113] });
      ctx.body.box(0.3, 0.025, 0.2, shade(c, 0.75), { p: [0, 0.14, 0], r: [0, 0, 0] }); // waist tie
      for (const sx of [-1, 1]) ctx.body.box(0.02, 0.2, 0.012, shade(c, 0.7), { p: [sx * 0.07, 0.52, 0.09], r: [0.35, 0, -sx * 0.25] });
      for (const [x, y, w, h, col] of [[-0.06, 0.04, 0.06, 0.04, '#6b3d12'], [0.07, -0.05, 0.05, 0.05, '#e4b33a'], [-0.02, -0.14, 0.07, 0.035, '#8d1f14'], [0.05, 0.3, 0.04, 0.03, '#6b3d12'], [-0.08, 0.24, 0.035, 0.05, '#e4b33a']]) ctx.body.box(w, h, 0.004, col, { p: [x, y, 0.125] });
      // red-and-white gamchha over the left shoulder
      ctx.body.box(0.12, 0.035, 0.2, '#c0392b', { p: [-0.14, 0.545, 0], r: [0, 0, 0.35] });
      ctx.body.box(0.075, 0.28, 0.02, '#c0392b', { p: [-0.19, 0.36, -0.108] });
      ctx.body.box(0.077, 0.02, 0.022, '#f3ede0', { p: [-0.19, 0.3, -0.108] });
      ctx.body.box(0.077, 0.02, 0.022, '#f3ede0', { p: [-0.19, 0.2, -0.108] });
    },
  });
  yawG.add(person.root);
  person.setFace('flat');

  // tools (one mesh each, toggled)
  const vtx = materials.vertex({ metal: 0.2, rough: 0.5 });
  const mkTool = (key, hand) => {
    const m = new Mesh(TOOLS[key](), vtx);
    m.visible = false;
    hand.add(m);
    return m;
  };
  const hR = person.arms[1].hand;
  const hL = person.arms[0].hand;
  const tools = {
    ladle: mkTool('ladle', hR),
    spatula: mkTool('spatula', hR),
    jhara: mkTool('jhara', hR),
    plateR: mkTool('plate', hR),
    plateL: mkTool('plate', hL),
    mugR: mkTool('mug', hR),
    mugL: mkTool('mug', hL),
    note: mkTool('note', hR),
  };
  const streamGeo = sharedGeo('avatar:stream', () => new CylinderGeometry(1, 1, 1, 6, 1, true));
  const stream = new Mesh(streamGeo, materials.solid('#d9a066', { rough: 0.3 }));
  stream.visible = false;
  lane.add(stream);

  // carried dishes
  const holders = [new Group(), new Group()];
  holders[0].position.set(-0.17, 0.4, 0.5);
  holders[1].position.set(0.17, 0.4, 0.5);
  for (const h of holders) {
    h.scale.setScalar(0.55);
    person.upper.add(h);
  }
  let handsKey = '';
  let handCount = 0;

  // name tag
  const tagTex = nameTagTexture(name, hexColor);
  const tagMat = new SpriteMaterial({ map: tagTex, transparent: true, depthTest: false, toneMapped: false });
  const tag = new Sprite(tagMat);
  tag.position.y = 2.0;
  tag.scale.set(0.95, 0.24, 1);
  tag.renderOrder = 10;
  group.add(tag);

  let pose = 'idle';
  let poseT0 = null;
  let yaw = 0.25;
  let faceDir = 0;
  let laneTarget = 0;
  let disposed = false;
  const toolVis = { ladle: false, spatula: false, jhara: false, plateR: false, plateL: false, mugR: false, mugL: false, note: false, stream: false };

  const headingFor = (p) => {
    if (faceDir !== 0 && (p === 'walk' || p === 'carry' || p === 'idle')) return faceDir * (Math.PI / 2);
    if (faceDir !== 0) return faceDir * (Math.PI / 2);
    switch (p) {
      case 'work-serve':
      case 'work-collect':
        return 0;
      case 'work-discard':
        return 2.2;
      case 'work-tawa':
      case 'work-steamer':
      case 'work-kadai':
      case 'work-chai':
        return 2.85;
      default:
        return 0.25;
    }
  };

  const setTools = (o) => {
    for (const k of Object.keys(toolVis)) toolVis[k] = !!o[k];
  };

  const solvePose = (T, t) => {
    const carrying = handCount > 0;
    const u = poseT0 === null ? 0 : (((t - poseT0) / WORK_S) % 1 + 1) % 1;
    T.breathe = Math.sin(t * 1.9) * 0.01;
    setTools({});
    holders[0].visible = holders[1].visible = pose === 'idle' || pose === 'walk' || pose === 'carry';
    const carryArms = () => {
      T.aLx = T.aRx = -1.4;
      T.eL = T.eR = -0.35;
      T.aLz = T.aRz = 0.04;
    };
    switch (pose) {
      case 'idle':
        T.headY = Math.sin(t * 0.8) * 0.2;
        if (carrying) carryArms();
        break;
      case 'carry':
        carryArms();
        T.hx = -0.03;
        T.hy = Math.sin(t * 2.2) * 0.004;
        break;
      case 'walk': {
        const s = Math.sin(t * 10);
        T.lL = -s * 0.75;
        T.lR = s * 0.75;
        T.hy = -Math.abs(Math.cos(t * 10)) * 0.03;
        T.hz = s * 0.025;
        if (carrying) carryArms();
        else {
          T.aLx = s * 0.6;
          T.aRx = -s * 0.6;
          T.eL = -0.3;
          T.eR = -0.3;
        }
        T.hx = 0.05;
        break;
      }
      case 'cheer': {
        const hop = Math.abs(Math.sin(t * 7));
        T.hy = hop * 0.12;
        T.aLx = T.aRx = -2.75 + Math.sin(t * 15) * 0.18;
        T.aLz = T.aRz = 0.3;
        T.eL = T.eR = -0.15;
        T.lL = T.lR = -hop * 0.3;
        T.headX = -0.15;
        break;
      }
      case 'work-tawa': {
        T.hx = 0.14;
        T.headX = 0.25;
        T.aLx = -0.75;
        T.eL = -0.55;
        T.aLz = 0.2;
        if (u < 0.5) {
          const a = u * 4 * TAU; // two circles while spreading the batter
          setTools({ ladle: true });
          T.aRx = -1.15 + Math.cos(a) * 0.1;
          T.aRz = 0.1 + Math.sin(a) * 0.22;
          T.eR = -0.85 + Math.sin(a) * 0.1;
        } else {
          const f = sm((u - 0.5) / 0.5);
          const lift = Math.sin(Math.PI * Math.min(1, f * 1.4));
          setTools({ spatula: true });
          T.aRx = -1.05 - lift * 0.55;
          T.eR = -0.55 - lift * 0.55;
          T.aRz = 0.12;
        }
        break;
      }
      case 'work-steamer': {
        const a = u < 0.5 ? sm(u / 0.5) : 1 - sm((u - 0.5) / 0.5) * 0.4;
        T.aRx = -1.0 - 1.25 * a;
        T.eR = -0.4 - 0.2 * a;
        T.aRz = 0.2;
        T.headX = -0.38 * a; // head back from the steam
        T.hx = 0.1 - 0.16 * a;
        T.aLx = -1.1;
        T.eL = -0.45 + Math.sin(u * 40) * 0.18; // tapping the trays
        T.aLz = 0.15;
        break;
      }
      case 'work-kadai': {
        T.headX = -0.1;
        T.hx = 0.1;
        T.aLx = -0.5;
        T.eL = -0.6;
        if (u < 0.25) {
          T.aRx = -1.35 + u * 1.2; // drop the dough
          T.eR = -0.5;
          T.aRz = 0.15;
        } else if (u < 0.62) {
          const a = ((u - 0.25) / 0.37) * TAU * 1.5; // swirl with the jhara
          setTools({ jhara: true });
          T.aRx = -1.1 + Math.cos(a) * 0.1;
          T.aRz = 0.12 + Math.sin(a) * 0.22;
          T.eR = -0.7;
        } else {
          const f = sm((u - 0.62) / 0.38); // lift the fried item out
          setTools({ jhara: true });
          T.aRx = -1.1 - f * 0.6;
          T.eR = -0.7 - f * 0.4;
          T.aRz = 0.1;
          T.hx = 0.1 - f * 0.1;
        }
        break;
      }
      case 'work-chai': {
        const s = Math.sin(u * TAU);
        setTools({ mugR: true, mugL: true, stream: true });
        T.aRx = -2.0 + s * 0.2;
        T.aRz = 0.55;
        T.eR = -0.45;
        T.aLx = -1.05 - s * 0.1;
        T.aLz = 0.5;
        T.eL = -0.3;
        T.headX = -0.1;
        T.hx = -0.03;
        break;
      }
      case 'work-serve': {
        const f = u < 0.55 ? sm(u / 0.55) : 1 - sm((u - 0.55) / 0.45);
        setTools({ plateR: true, plateL: true });
        T.aRx = T.aLx = -1.2 - 0.2 * f;
        T.eR = T.eL = -0.9 + 0.7 * f; // arms straighten as the plate slides across
        T.aRz = T.aLz = 0.12;
        T.hx = 0.05 + 0.14 * f;
        break;
      }
      case 'work-collect': {
        const reach = u < 0.35 ? sm(u / 0.35) : 0;
        const tuck = u < 0.35 ? 0 : sm((u - 0.35) / 0.4);
        setTools({ note: u < 0.78 });
        T.aRx = -1.5 * reach - 0.7 * tuck + (1 - reach) * (1 - tuck) * -0.2;
        T.eR = -0.15 - 1.1 * tuck;
        T.aRz = 0.12;
        T.hx = 0.08 + 0.05 * tuck;
        T.headX = 0.12;
        T.aLx = -0.6;
        T.eL = -0.9; // left hand steadies the box
        break;
      }
      case 'work-discard': {
        const f = sm((u - 0.3) / 0.45);
        setTools({ plateR: true, plateL: true });
        T.aRx = T.aLx = -1.3 - 0.35 * f;
        T.eR = T.eL = -0.5;
        T.aRz = 0.1 + 0.5 * f;
        T.aLz = 0.1 + 0.2 * f;
        T.hx = 0.06 + 0.1 * f;
        T.headX = 0.1;
        break;
      }
      default:
    }
    for (const k of Object.keys(tools)) tools[k].visible = !!toolVis[k];
    tools.plateR.rotation.z = pose === 'work-discard' ? -sm((u - 0.3) / 0.45) * 1.1 : 0;
    stream.visible = toolVis.stream;
  };

  const api = {
    group,
    pose: () => pose,
    setPose(p) {
      const next = POSES.includes(p) ? p : 'idle';
      if (next !== pose || next.startsWith('work-')) poseT0 = null; // restart the work animation on every call
      pose = next;
    },
    /** dishes: [{ dish, q }] (at most HANDS_MAX are shown) */
    setHands(dishes) {
      const list = Array.isArray(dishes) ? dishes.slice(0, HANDS_MAX) : [];
      const key = list.map((d) => `${d && d.dish}:${d && d.q}`).join('|');
      if (key === handsKey) return;
      handsKey = key;
      handCount = list.length;
      for (let i = 0; i < holders.length; i++) {
        const h = holders[i];
        while (h.children.length) h.remove(h.children[h.children.length - 1]);
        const d = list[i];
        if (d && d.dish) h.add(buildDish(d.dish, d.q || 'good'));
      }
    },
    /** dir -1 | 0 | 1: the walking direction (0 = the pose decides the heading). */
    setFacing(dir) {
      faceDir = dir > 0 ? 1 : dir < 0 ? -1 : 0;
    },
    /** Cosmetic z offset (two cooks sharing a station stand in offset lanes). */
    setLane(z) {
      laneTarget = num(z, 0);
    },
    update(dt, t) {
      if (disposed) return;
      const d = Math.min(0.1, Math.max(0, num(dt, 0.016)));
      const tt = num(t, 0);
      if (poseT0 === null) poseT0 = tt;
      const T = person.target;
      resetPose(T);
      solvePose(T, tt);
      const working = pose.startsWith('work-');
      person.step(d, working ? 24 : 14);
      yaw += wrapPi(headingFor(pose) - yaw) * Math.min(1, d * 11);
      yawG.rotation.y = yaw;
      lane.position.z = damp(lane.position.z, laneTarget, 10, d);
      if (stream.visible) {
        lane.updateWorldMatrix(true, true);
        hR.getWorldPosition(_a);
        hL.getWorldPosition(_b);
        lane.worldToLocal(_a);
        lane.worldToLocal(_b);
        _a.y += 0.05;
        _b.y += 0.12;
        _a.sub(_b);
        const len = _a.length();
        if (len > 0.001) {
          stream.position.copy(_b).addScaledVector(_a, 0.5);
          _a.multiplyScalar(1 / len);
          stream.quaternion.copy(_q.setFromUnitVectors(UP, _a));
          const wob = 0.0055 + 0.0015 * Math.sin(tt * 40);
          stream.scale.set(wob, len, wob);
        } else stream.visible = false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const h of holders) while (h.children.length) h.remove(h.children[0]);
      disposeObject(group);
    },
  };
  void clamp01;
  void hashSeed;
  person.step(0.016, 100);
  api.update(0.016, 0);
  return api;
}
