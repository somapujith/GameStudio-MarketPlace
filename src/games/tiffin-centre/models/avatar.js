// The other cooks of a table, seen from first person: a full person (sculpted face, real body, IK arms) in a half-sleeve shirt, lungi or
// trousers, a stained apron in the player's colour, a gamchha, a headcloth and slippers. Eleven poses (idle, walk, carry, cheer and seven
// WORK poses that hold the real tools). Facing: the model's front is +z; setFacing(dir) turns to face +x (1) / -x (-1) while walking;
// dir 0 uses the pose's own heading (at the stations they face the counter, i.e. -z, with their back to the player's camera).
import { Color, Group, Sprite, SpriteMaterial, Vector3 } from 'three';
import { HANDS_MAX } from '../../../../shared/tiffin-centre/catalog.js';
import { WORK_MS } from '../../../../shared/tiffin-centre/movement.js';
import { clamp01, countTriangles, damp, disposeObject, hashSeed, num, rng } from './util.js';
import { buildPerson, shade } from './person.js';
import { CH } from './bodies.js';
import { buildDish } from './dishes.js';
import { nameTagTexture } from './textures.js';
import { holdTool, makeFarTool } from './toolhost.js';
import { getCharacterQuality, getCharacterDrawMode } from './charquality.js';
import { mergeModel, limitShadowCasters } from './merge.js';
import { bakeRig } from './baked.js';
import { packPerson } from './pack.js';

export const POSES = ['idle', 'walk', 'carry', 'cheer', 'work-tawa', 'work-steamer', 'work-kadai', 'work-chai', 'work-serve', 'work-collect', 'work-discard'];

const WORK_S = WORK_MS / 1000;
const TAU = Math.PI * 2;
const PI = Math.PI;
const sm = (x) => {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
};
const seg = (u, a, b) => sm((u - a) / (b - a));
const wrapPi = (a) => {
  let x = (a + PI) % TAU;
  if (x < 0) x += TAU;
  return x - PI;
};

// tools held in the hands by each work pose: [left (+x), right (-x)] with a grip style (1 power diag, 2 tray, 3 upright)
const POSE_TOOLS = {
  'work-tawa': [null, ['ladle', 1]],
  'work-steamer': [null, ['spatula', 1]],
  'work-kadai': [null, ['jhara', 1]],
  'work-chai': [['steel-glass', 3], ['chai-kettle', 3]],
  'work-serve': [['plate', 2], ['plate', 2]],
  'work-collect': [['money-box', 2], ['note', 2]],
  'work-discard': [['plate', 2], null],
};
// hand-local grip frames of the avatar (unmirrored group frame): [dir of the working end, up, grip position]
const GRIPS = {
  1: (side) => [[0.7071 * side, 0.7071, 0], [0, 0, -1], [0, 0.052, 0.014]],
  2: () => [[0, 1, 0], [0, 0, 1], [0, 0.07, 0.02]],
  3: (side) => [[0, 1, 0], [side, 0, 0], [0, 0.05, 0.016]],
};

const _v = new Vector3();
const _w = new Vector3();

/** buildAvatar({ color, name, quality }) -> { group, pose, setPose, setHands, setFacing, setLane, setExpression, lookAt, update, dispose } */
export function buildAvatar({ color = '#ff8a1f', name = '', quality } = {}) {
  const hexColor = `#${new Color(color).getHexString()}`;
  const seed = hashSeed(`avatar:${name}:${hexColor}`);
  const r = rng(`avatar:${name}:${hexColor}`);
  const lungi = r.chance(0.55);
  const group = new Group();
  group.name = 'avatar';
  const lane = new Group();
  group.add(lane);
  const yawG = new Group();
  lane.add(yawG);

  const person = buildPerson({
    kind: 'cook',
    seed,
    height: r.range(1.64, 1.76),
    belly: r.range(0, 0.35),
    quality: quality || (getCharacterQuality() === 'high' ? 'medium' : getCharacterQuality()), // seen at a distance, beside the player
    hair: { style: r.pick(['short', 'crop', 'combed']), headwear: 'cloth', clothColor: hexColor, clothColor2: '#f4eacb', pattern: 'gamchha' },
    outfit: {
      top: { kind: 'shirt', color: r.pick(['#efe9d8', '#cfe0ef', '#e8d9a8', '#d9d4c8']), sleeve: 'short', pocket: true, untucked: true },
      bottom: lungi ? { kind: 'lungi', color: r.pick(['#2f5da8', '#1f7a5c', '#8a2d2d', '#4d3a8a']), color2: '#f0e6c8', hem: 0.2 } : { kind: 'trousers', color: r.pick(['#3a3f4a', '#4a3f35']) },
      shoes: { kind: 'slipper', color: r.pick(['#ff8a1f', '#2a6fd0', '#d0392b']) },
      extras: [{ id: 'apron', color: hexColor }, { id: 'gamchha', color: '#c0392b', color2: '#f3ede0', side: 1 }, { id: 'kada', side: 'R' }],
    },
  });
  yawG.add(person.group);
  const body = person.body;
  const S = body.S;
  const handL = body.arms[0].hand; // character's left (+x)
  const handR = body.arms[1].hand;
  person.setExpression('neutral', 1, 0);

  // tools: built on demand, one per (hand, id)
  const tools = [new Map(), new Map()];
  const toolFor = (hi, id, style) => {
    let t = tools[hi].get(id);
    if (!t) {
      t = makeFarTool(id); // far LOD: the real tools are 1-3k triangles each
      t.group.visible = false;
      const hand = hi === 0 ? handL : handR;
      const side = hi === 0 ? -1 : 1; // the right hand is the unmirrored one in the body frame
      const g = GRIPS[style](side);
      // orient the tool: working end (-z) along g[0], up along g[1]
      const z = [-g[0][0], -g[0][1], -g[0][2]];
      const y = g[1];
      const x = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
      t.group.matrix.set(x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1);
      t.group.quaternion.setFromRotationMatrix(t.group.matrix);
      t.group.position.set(g[2][0] * S, g[2][1] * S, g[2][2] * S).sub(hand.grip.position);
      t.group.scale.setScalar(S * 0.95);
      hand.grip.add(t.group);
      tools[hi].set(id, t);
    }
    return t;
  };
  const showTools = (pose) => {
    const want = POSE_TOOLS[pose] || [null, null];
    for (let hi = 0; hi < 2; hi++) {
      const w = want[hi];
      for (const [id, t] of tools[hi]) t.group.visible = !!w && id === w[0];
      if (w) toolFor(hi, w[0], w[1]).group.visible = true;
    }
  };

  // carried dishes sit on the open hands
  const holders = [new Group(), new Group()];
  for (let i = 0; i < 2; i++) {
    holders[i].rotation.x = PI / 2;
    holders[i].position.set(0, 0.06 * S, 0.04 * S);
    holders[i].scale.setScalar(0.55 * S);
    (i === 0 ? handL : handR).grip.add(holders[i]);
  }
  let handsKey = '';
  let handCount = 0;

  // name tag
  const tagTex = nameTagTexture(name, hexColor);
  const tagMat = new SpriteMaterial({ map: tagTex, transparent: true, depthTest: false, toneMapped: false });
  const tag = new Sprite(tagMat);
  tag.position.y = person.height + 0.32;
  tag.scale.set(0.95, 0.24, 1);
  tag.renderOrder = 10;
  group.add(tag);

  let pose = 'idle';
  let poseT0 = null;
  let yaw = PI - 0.2;
  let faceDir = 0;
  let laneTarget = 0;
  let disposed = false;
  let exprName = 'neutral';
  let lookTarget = null;

  const headingFor = (p) => {
    if (faceDir !== 0) return faceDir * (PI / 2);
    switch (p) {
      case 'work-serve':
      case 'work-collect':
        return PI;
      case 'work-discard':
        return PI * 0.72;
      case 'work-tawa':
        return PI - 0.12;
      case 'work-steamer':
        return PI + 0.05;
      case 'work-kadai':
        return PI + 0.1;
      case 'work-chai':
        return PI + 0.18;
      case 'cheer':
        return PI - 0.5;
      default:
        return PI - 0.25;
    }
  };

  const solve = (t) => {
    const T = body.pose.tgt;
    const set = (n, v) => {
      T[CH[n]] = v;
    };
    const arm = (sd, o) => body.setArm(sd, o);
    const sc = (v) => v * S;
    body.resetPose();
    const u = poseT0 === null ? 0 : (((t - poseT0) / WORK_S) % 1 + 1) % 1;
    set('spPitch', 0.012 * Math.sin(t * 1.9));
    const carrying = handCount > 0;
    const carryArms = () => {
      arm('L', { pos: [sc(0.14), sc(0.13), sc(0.3)], dir: [0, 0.05, 1], palm: [0, 1, 0], aw: 1, pole: 0.3, curl: [0.28, 0.3, 0.33, 0.38, 0.1], spread: 0.22 });
      arm('R', { pos: [sc(-0.14), sc(0.13), sc(0.3)], dir: [0, 0.05, 1], palm: [0, 1, 0], aw: 1, pole: 0.3, curl: [0.28, 0.3, 0.33, 0.38, 0.1], spread: 0.22 });
    };
    let expr = 'neutral';
    let bias = [0, 0, 0];
    const gripCurl = [0.72, 0.78, 0.84, 0.9, 0.55];
    switch (pose) {
      case 'idle':
        if (carrying) carryArms();
        break;
      case 'carry':
        carryArms();
        set('spPitch', -0.03);
        break;
      case 'walk': {
        const ph = t * 8.5;
        const w = Math.sin(ph);
        const stride = (lungi ? 0.13 : 0.22) * S;
        set('fLz', stride * w);
        set('fRz', -stride * w);
        set('fLy', Math.max(0, Math.cos(ph)) * 0.08 * S);
        set('fRy', Math.max(0, -Math.cos(ph)) * 0.08 * S);
        set('hipY', -Math.abs(Math.cos(ph)) * 0.022 * S);
        set('hipYaw', 0.09 * w);
        set('spYaw', -0.13 * w);
        if (carrying) carryArms();
        else {
          arm('L', { pos: [sc(0.2), sc(-0.02), sc(0.02 - 0.15 * w)], aw: 0 });
          arm('R', { pos: [sc(-0.2), sc(-0.02), sc(0.02 + 0.15 * w)], aw: 0 });
        }
        set('spPitch', 0.04);
        break;
      }
      case 'cheer': {
        const hop = Math.abs(Math.sin(t * 7));
        set('hipY', hop * 0.06 * S);
        const sw = Math.sin(t * 15) * 0.03 * S;
        arm('L', { pos: [sc(0.29), sc(0.6) + sw, sc(0.1)], dir: [0.2, 1, 0.2], palm: [0, 0, 1], aw: 1, pole: 0.5, curl: [0.1, 0.1, 0.12, 0.15, 0.05], spread: 0.4 });
        arm('R', { pos: [sc(-0.29), sc(0.6) - sw, sc(0.1)], dir: [-0.2, 1, 0.2], palm: [0, 0, 1], aw: 1, pole: 0.5, curl: [0.1, 0.1, 0.12, 0.15, 0.05], spread: 0.4 });
        set('fLy', hop * 0.05);
        set('fRy', hop * 0.05);
        expr = 'delighted';
        bias = [-0.1, 0, 0];
        break;
      }
      case 'work-tawa': {
        // pour and spread the batter in circles, then flip with the spatula
        const spread = u < 0.5;
        const a = u * 4 * TAU;
        arm('R', { pos: [sc(-0.1) + (spread ? Math.cos(a) * sc(0.05) : 0), sc(0.15) + (spread ? 0 : sc(0.1) * Math.sin(seg(u, 0.5, 1) * PI)), sc(0.42) + (spread ? Math.sin(a) * sc(0.04) : sc(0.06) * seg(u, 0.5, 0.7))], dir: [0.1, -0.5, 1], palm: [1, 0.3, 0], aw: 1, pole: 0.2, curl: gripCurl });
        arm('L', { pos: [sc(0.14), sc(0.1), sc(0.34)], dir: [-0.1, -0.3, 1], palm: [-1, 0.4, 0], aw: 1, pole: 0.3, curl: [0.1, 0.1, 0.12, 0.15, 0.1] });
        set('spPitch', 0.16);
        bias = [0.22, 0, 0];
        break;
      }
      case 'work-steamer': {
        const lid = u < 0.5 ? seg(u, 0, 0.5) : 1 - seg(u, 0.5, 1) * 0.4;
        arm('L', { pos: [sc(0.12), sc(0.12 + 0.34 * lid), sc(0.4 - 0.1 * lid)], dir: [0, 0.4 + 0.6 * lid, 1], palm: [-1, 0.2, 0], aw: 1, pole: 0.3, curl: lid > 0.4 ? [0.6, 0.65, 0.7, 0.75, 0.4] : [0.1, 0.1, 0.12, 0.15, 0.1] });
        arm('R', { pos: [sc(-0.12), sc(0.14) + 0.02 * Math.sin(u * 40), sc(0.4)], dir: [0, -0.3, 1], palm: [1, 0.2, 0], aw: 1, pole: 0.2, curl: gripCurl });
        set('spPitch', 0.06 - 0.14 * lid);
        bias = [-0.12 * lid, 0, 0];
        break;
      }
      case 'work-kadai': {
        const a = seg(u, 0.25, 0.62) * TAU * 1.5;
        const lift = seg(u, 0.62, 1);
        arm('R', { pos: [sc(-0.1) + Math.cos(a) * sc(0.04), sc(0.16) + sc(0.14) * lift, sc(0.45) + Math.sin(a) * sc(0.04)], dir: [0, -0.45 + 0.45 * lift, 1], palm: [1, 0.3, 0], aw: 1, pole: 0.2, curl: gripCurl });
        arm('L', { pos: [sc(0.15), sc(0.0), sc(0.28)], dir: [0, -0.4, 1], palm: [-1, 0.3, 0], aw: 1, pole: 0.5, curl: [0.3, 0.35, 0.4, 0.45, 0.2] });
        set('spPitch', 0.1);
        bias = [0.12, 0, 0];
        break;
      }
      case 'work-chai': {
        const sw = Math.sin(u * TAU);
        arm('R', { pos: [sc(-0.14), sc(0.46) + sc(0.04) * sw, sc(0.3)], dir: [0.2, 0.1 - 0.6 * (0.5 + 0.5 * sw), 1], palm: [1, 0.2, 0], aw: 1, pole: 0.6, curl: gripCurl });
        arm('L', { pos: [sc(0.1), sc(0.12), sc(0.34)], dir: [-0.2, 0.3, 1], palm: [-1, 0.2, 0], aw: 1, pole: 0.4, curl: gripCurl });
        bias = [-0.05, 0, 0];
        set('spPitch', -0.02);
        break;
      }
      case 'work-serve': {
        const f = u < 0.55 ? sm(u / 0.55) : 1 - sm((u - 0.55) / 0.45);
        arm('L', { pos: [sc(0.1), sc(0.12), sc(0.3 + 0.18 * f)], dir: [-0.2, 0, 1], palm: [0, 1, 0], aw: 1, pole: 0.3, curl: [0.2, 0.22, 0.25, 0.3, 0.05], spread: 0.2 });
        arm('R', { pos: [sc(-0.1), sc(0.12), sc(0.3 + 0.18 * f)], dir: [0.2, 0, 1], palm: [0, 1, 0], aw: 1, pole: 0.3, curl: [0.2, 0.22, 0.25, 0.3, 0.05], spread: 0.2 });
        set('spPitch', 0.06 + 0.1 * f);
        break;
      }
      case 'work-collect': {
        const reach = u < 0.35 ? sm(u / 0.35) : 0;
        const tuck = u < 0.35 ? 0 : sm((u - 0.35) / 0.4);
        arm('R', { pos: [sc(-0.1) - sc(0.1) * tuck, sc(0.2) - sc(0.08) * tuck, sc(0.3 + 0.2 * reach * (1 - tuck))], dir: [0, -0.1, 1], palm: [0.3, 1, 0], aw: 1, pole: 0.3, curl: [0.4, 0.55, 0.62, 0.7, 0.55] });
        arm('L', { pos: [sc(0.14), sc(0.07), sc(0.33)], dir: [-0.2, 0, 1], palm: [0, 1, 0], aw: 1, pole: 0.4, curl: [0.2, 0.22, 0.25, 0.3, 0.05], spread: 0.2 });
        set('spPitch', 0.1);
        bias = [0.12, 0, 0];
        break;
      }
      case 'work-discard': {
        const f = seg(u, 0.3, 0.75);
        arm('R', { pos: [sc(-0.16) - sc(0.1) * f, sc(0.12) + sc(0.1) * f, sc(0.3)], dir: [-0.3, 0, 1], palm: [0.3, 1, 0], aw: 1, pole: 0.5, curl: [0.2, 0.22, 0.25, 0.3, 0.05], spread: 0.2 });
        arm('L', { pos: [sc(0.14), sc(0.12), sc(0.3)], dir: [0.1, 0, 1], palm: [0, 1, 0], aw: 1, pole: 0.3, curl: [0.2, 0.22, 0.25, 0.3, 0.05], spread: 0.2 });
        set('spYaw', -0.35 * f);
        bias = [0.1, 0, 0];
        break;
      }
      default:
    }
    if (pose.startsWith('work-')) expr = pose === 'work-chai' || pose === 'work-collect' ? 'paying' : 'neutral';
    if (expr !== exprName) {
      exprName = expr;
      person.setExpression(expr, expr === 'paying' ? 0.6 : 1, 280);
    }
    person.headBias.pitch = bias[0];
    person.headBias.yaw = bias[1];
    person.headBias.roll = bias[2];
  };

  const api = {
    group,
    person,
    pose: () => pose,
    setPose(p) {
      const next = POSES.includes(p) ? p : 'idle';
      if (next !== pose || next.startsWith('work-')) poseT0 = null; // restart the work animation on every call
      if (next !== pose) showTools(next);
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
        while (h.children.length) disposeObject(h.children[h.children.length - 1]);
        const d = list[i];
        if (d && d.dish) {
          try {
            h.add(buildDish(d.dish, d.q || 'good'));
          } catch {
            /* ignore */
          }
        }
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
    setExpression(n, w = 1, ms = 250) {
      exprName = n;
      person.setExpression(n, w, ms);
    },
    lookAt(v) {
      lookTarget = v && Number.isFinite(v.x + v.y + v.z) ? v.clone() : null;
    },
    update(dt, t) {
      if (disposed) return;
      const d = Math.min(0.1, Math.max(0, num(dt, 0.016)));
      const tt = num(t, 0);
      if (poseT0 === null) poseT0 = tt;
      solve(tt);
      const working = pose.startsWith('work-');
      body.rate = working ? 20 : 12;
      const hp = headingFor(pose);
      yaw += wrapPi(hp - yaw) * Math.min(1, d * 11);
      yawG.rotation.y = yaw;
      lane.position.z = damp(lane.position.z, laneTarget, 10, d);
      // look where they work (or where told)
      group.updateWorldMatrix(true, false);
      if (lookTarget) person.lookAt(lookTarget);
      else {
        _w.set(Math.sin(yaw), 0, Math.cos(yaw));
        group.getWorldPosition(_v);
        _v.addScaledVector(_w, 1.2);
        _v.y = person.height * (working ? 0.62 : 0.9);
        person.lookAt(_v);
      }
      person.update(d, tt);
      api.pack?.update(); // the packed meshes follow the rig (models/pack.js)
    },
    get triangles() {
      return countTriangles(group);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      api.pack?.dispose();
      for (const h of holders) while (h.children.length) disposeObject(h.children[0]);
      for (const m of tools) for (const t2 of m.values()) t2.dispose?.();
      person.dispose();
      disposeObject(group);
    },
  };
  void holdTool;
  void clamp01;
  void shade;
  person.body.pose.snap();
  api.update(0.016, 0);
  const mode = getCharacterDrawMode();
  if (mode.baked) {
    api.baked = bakeRig(api, { roots: [person.group], rate: () => 15 }); // cooks walk and work: always the fast rate
  } else if (mode.pack) {
    api.pack = packPerson(person.group);
  } else if (mode.merge) {
    api.merge = mergeModel(group, (sample) => {
      let t = 0.2;
      for (const p of POSES) {
        api.setPose(p);
        for (let i = 0; i < 4; i++) {
          t += 0.23;
          api.update(0.05, t);
          sample();
        }
      }
      api.setPose('idle');
      api.setFacing(0);
      person.body.pose.snap();
      api.update(0.016, 0);
    });
  }
  if (mode.limitShadows) limitShadowCasters(group);
  return api;
}
