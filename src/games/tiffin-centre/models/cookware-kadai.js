// Fry kadai station: a heavy black cast-iron kadai cradled in the sooty brick chulha with orange gas fire licking its belly, hot oil that
// bubbles (animated bump + foam rings) and the frying items: poori (puffs up as it cooks), vada ring, mysore bonda ball, mirchi bajji.
import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, PointLight, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { lathe, merge, place, sweep } from './geo.js';
import { createFoodMaterial, foodUniforms, FOOD_COLORS } from './shaders/food.js';
import { createOilMaterial } from './shaders/oil.js';
import { createFlameMaterial, createGlowMaterial, flameRingGeometry } from './shaders/flame.js';
import { createSteam } from './shaders/steam.js';
import { createTawaMaterial } from './shaders/tawa.js';
import { pbrMaterial, quality } from './pbr.js';
import { ReadyRing, easeOut, smooth } from './fx.js';
import { sharedGeo } from './util.js';
import { normSlot } from './food-dosa.js';
import { clamp01, hashNoise } from './food-util.js';
import { CHULHA, COUNTER_TOP, BRICK_H, chulhaGeometry, sootBrickMaterial } from './cookware-tawa.js';
import { buildTendProp } from './cookware-tend.js';

const V3 = (x, y, z) => new Vector3(x, y, z);
const sg = (n) => Math.max(12, Math.round(n * quality().segScale));
export const KADAI_Z = -0.03;
const BRICK_TOP = COUNTER_TOP + BRICK_H;
export const KADAI_Y = BRICK_TOP - 0.062; // the kadai's belly sits inside the pit
export const OIL_Y = KADAI_Y + 0.097;
const OIL_R = 0.215;

function kadaiGeo() {
  return sharedGeo(`kadai:body:${quality().name}`, () => {
    const prof = [[0, 0], [0.07, 0.002], [0.15, 0.02], [0.225, 0.058], [0.268, 0.108], [0.288, 0.152], [0.2915, 0.162], [0.2865, 0.17], [0.279, 0.163], [0.262, 0.12], [0.215, 0.07], [0.14, 0.032], [0.06, 0.013], [0, 0.011]];
    const body = lathe(prof, sg(26), { sub: 0, uv: [4, 3] });
    // two riveted ear handles
    const ears = [-1, 1].map((s) => {
      const path = [V3(s * 0.282, 0.145, 0), V3(s * 0.322, 0.158, 0), V3(s * 0.348, 0.134, 0), V3(s * 0.335, 0.098, 0), V3(s * 0.292, 0.09, 0)];
      return sweep(path, () => [0.0105, 0.0085], 7, { up: V3(0, 0, 1) });
    });
    const rivets = [-1, 1].flatMap((s) => [0.145, 0.095].map((y) => place(new SphereGeometry(0.0085, 8, 5), { p: [s * 0.2845, y, 0], s: [0.5, 1, 1] })));
    return merge([body, ...ears, ...rivets]);
  });
}
function oilGeo() {
  return sharedGeo(`kadai:oil:${quality().name}`, () => {
    // flat disc with a slightly raised meniscus at the wall (rings concentrate near the edge)
    const seg = sg(32);
    const rings = [0, 0.3, 0.6, 0.8, 0.92, 1];
    const pos = [];
    const uv = [];
    const idx = [];
    rings.forEach((f, j) => {
      const n = j === 0 ? 1 : seg;
      for (let i = 0; i < n; i++) {
        const a = (i / seg) * Math.PI * 2;
        pos.push(Math.cos(a) * OIL_R * f, f > 0.95 ? 0.0018 : 0, Math.sin(a) * OIL_R * f);
        uv.push(0.5 + Math.cos(a) * f * 0.5, 0.5 + Math.sin(a) * f * 0.5);
      }
    });
    for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
    for (let j = 1; j < rings.length - 1; j++) {
      const a0 = 1 + (j - 1) * seg;
      const a1 = 1 + j * seg;
      for (let i = 0; i < seg; i++) {
        const i2 = (i + 1) % seg;
        idx.push(a0 + i, a0 + i2, a1 + i, a0 + i2, a1 + i2, a1 + i);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', makeAttr(pos, 3));
    g.setAttribute('uv', makeAttr(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}
const makeAttr = (arr, n) => new Float32BufferAttribute(arr, n);

function pooriGeo() {
  return sharedGeo(`kadai:poori:${quality().name}`, () => {
    const g = new SphereGeometry(0.075, sg(16), sg(9));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const k = 1 + 0.05 * hashNoise(x * 26, y * 26, z * 26);
      p.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals();
    return g;
  });
}
function vadaGeo() {
  return sharedGeo(`kadai:vada:${quality().name}`, () => {
    const g = new TorusGeometry(0.034, 0.0185, 8, sg(16));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const k = 1 + 0.07 * hashNoise(x * 30, y * 30, z * 30);
      p.setXYZ(i, x * k, y * k, z * k * 0.65);
    }
    g.rotateX(Math.PI / 2);
    g.computeVertexNormals();
    return g;
  });
}
function bondaGeo() {
  return sharedGeo(`kadai:bonda:${quality().name}`, () => {
    const g = new SphereGeometry(0.031, sg(14), sg(9));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const k = 1 + 0.08 * hashNoise(x * 40, y * 40, z * 40);
      p.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals();
    return g;
  });
}
function bajjiGeo() {
  return sharedGeo(`kadai:bajji:${quality().name}`, () => {
    const g = lathe([[0, 0], [0.018, 0.004], [0.0285, 0.025], [0.0305, 0.06], [0.0265, 0.095], [0.018, 0.12], [0.0075, 0.133], [0, 0.1345]], sg(12), { sub: 0, uv: [1, 1], warp: (r, y, th) => [r * 0.06 * hashNoise(th * 2, y * 40, 1), 0] });
    g.rotateZ(-Math.PI / 2).translate(-0.067, 0, 0);
    return g;
  });
}

const ITEM_COLOR = { poori: 'poori', vada: 'vada', mysore_bonda: 'bonda', mirchi_bajji: 'bajji' };
const SLOT_XZ = [[-0.12, 0.055], [0.0, -0.055], [0.12, 0.055]];

class KadaiSlot {
  constructor(parent, i, x, z, oilUniform) {
    this.i = i;
    this.root = new Group();
    this.root.position.set(x, OIL_Y, KADAI_Z + z);
    parent.add(this.root);
    this.x = x;
    this.z = z;
    this.spot = oilUniform; // Vector3 in the oil shader (kadai-local xz)
    this.cur = normSlot(null);
    this.act = null;
    this.now = 0;
    this.fm = createFoodMaterial('fried', { uniforms: foodUniforms('poori', { cook: 0, scale: 9, seed: 0.3 + i * 0.37, amt: 1 }) });
    this.item = new Group();
    this.root.add(this.item);
    this.meshes = {}; // created on demand, one per dish type this slot has actually shown
    this.steam = createSteam({ count: 8, rise: 0.3, size: 0.09, speed: 0.38, radius: 0.1, drift: 0.04, opacity: 0.2, seed: 31 + i });
    this.steam.points.position.set(0, 0.01, 0);
    this.root.add(this.steam.points);
    this.smoke = createSteam({ count: 8, rise: 0.45, size: 0.11, speed: 0.28, radius: 0.1, drift: 0.05, color: '#4a4643', opacity: 0.55, seed: 41 + i });
    this.smoke.points.position.set(0, 0.01, 0);
    this.root.add(this.smoke.points);
    this.ring = new ReadyRing(this.root, 0, 0.004, 0, 0.1);
    this.anchor = new Vector3(x, OIL_Y + 0.025, KADAI_Z + z);
    this.apply();
  }
  makeItem(dish) {
    const geo = { poori: pooriGeo, vada: vadaGeo, mysore_bonda: bondaGeo, mirchi_bajji: bajjiGeo }[dish]();
    const m = new Mesh(geo, this.fm.mat);
    m.visible = false;
    this.meshes[dish] = m;
    this.item.add(m);
  }
  set(info) {
    this.cur = normSlot(info);
    this.apply();
  }
  playAction(kind, t01) {
    const t = clamp01(t01);
    if (kind === 'skim' || kind === 'take' || kind === 'fill') {
      this.act = t >= 1 && kind === 'fill' ? null : { kind, t01: t, stamp: this.now };
      this.apply();
    }
  }
  apply() {
    const { st, dish, progress: p, burnFrac } = this.cur;
    const a = this.act;
    const key = ITEM_COLOR[dish] || 'poori';
    const col = FOOD_COLORS[key];
    const u = this.fm.uniforms;
    u.uA.value.setRGB(col.a[0], col.a[1], col.a[2]);
    u.uB.value.setRGB(col.b[0], col.b[1], col.b[2]);
    u.uC.value.setRGB(col.c[0], col.c[1], col.c[2]);
    u.uCook.value = st === 'cooking' ? 0.06 + p * 0.58 : st === 'ready' ? 0.64 + 0.2 * burnFrac : st === 'burnt' ? 1.2 : 0;
    u.uBurn.value = st === 'burnt' ? 1 : st === 'ready' ? smooth(0.6, 1, burnFrac) * 0.3 : 0;
    u.uAmt.value = dish === 'mysore_bonda' ? 1.3 : dish === 'vada' ? 1.2 : 0.8;
    const vis = st !== 'empty';
    if (vis && ITEM_COLOR[dish] && !this.meshes[dish]) this.makeItem(dish);
    for (const [k, m] of Object.entries(this.meshes)) m.visible = vis && k === dish;
    // the poori puffs: flat dough disc -> golden dome
    const puff = st === 'cooking' ? 0.1 + 0.9 * smooth(0.05, 0.6, p) : st === 'empty' ? 0 : 1;
    if (this.meshes.poori) this.meshes.poori.scale.set(1 + 0.15 * (1 - puff), 0.12 + 0.5 * puff, 1 + 0.15 * (1 - puff));
    const rise = a && (a.kind === 'skim' || a.kind === 'take') ? easeOut(a.t01) : 0;
    this.item.userData.rise = rise;
    // the oil foam spot
    const foam = vis ? (st === 'cooking' ? 1 : st === 'ready' ? 0.45 : 0.25) * (1 - rise) : 0;
    this.spot.set(this.x, this.z, foam);
    const q = quality().particles;
    this.steam.setAmount(st === 'cooking' || st === 'ready' ? (st === 'cooking' ? 0.5 : 0.3) * q : 0);
    this.smoke.setAmount(st === 'burnt' ? 0.9 : 0);
    if (a && a.kind === 'take' && a.t01 > 0.97) for (const m of Object.values(this.meshes)) m.visible = false;
  }
  update(dt, t) {
    this.now = t;
    if (this.act && t - this.act.stamp > 0.9) {
      this.act = null;
      this.apply();
    }
    const st = this.cur.st;
    const cooking = st === 'cooking';
    const rise = this.item.userData.rise || 0;
    this.item.position.y = st === 'empty' ? 0 : 0.004 + Math.sin(t * (cooking ? 3.6 : 1.5) + this.i * 1.7) * (cooking ? 0.006 : 0.002) + rise * 0.16;
    this.item.rotation.z = Math.sin(t * 2.1 + this.i) * (cooking ? 0.07 : 0.02) - rise * 0.35;
    this.item.rotation.y = st === 'empty' ? 0 : Math.sin(t * 0.7 + this.i * 2) * 0.4;
    const y0 = this.cur.dish === 'poori' ? 0.0 : this.cur.dish === 'vada' ? 0.014 : this.cur.dish === 'mirchi_bajji' ? 0.01 : 0.016;
    for (const m of Object.values(this.meshes)) m.position.y = y0 + (m === this.meshes.poori ? 0.012 : 0);
    this.ring.update(t, st === 'ready' && !this.act);
  }
  dispose() {
    this.fm.dispose();
    this.steam.dispose();
    this.smoke.dispose();
    this.ring.dispose();
    this.root.removeFromParent();
    this.spot.set(0, 0, 0);
  }
}

export function buildKadaiSet() {
  const g = new Group();
  g.name = 'kadai-set';
  const owned = [];
  const brick = sootBrickMaterial();
  owned.push(brick);
  g.add(new Mesh(chulhaGeometry(), brick.mat));
  // kadai iron (own tawa-style procedural patina, a rougher darker palette)
  const iron = createTawaMaterial({ metalness: 0.7, anisotropy: 0.2 });
  iron.uniforms.uBase.value.setRGB(0.05, 0.047, 0.045);
  iron.uniforms.uSoot.value = 0.85;
  owned.push(iron);
  const kadai = new Mesh(kadaiGeo(), iron.mat);
  kadai.position.set(0, KADAI_Y, KADAI_Z);
  g.add(kadai);
  // oil
  const oil = createOilMaterial();
  owned.push(oil);
  const oilMesh = new Mesh(oilGeo(), oil.mat);
  oilMesh.position.set(0, OIL_Y, KADAI_Z);
  g.add(oilMesh);
  // fire: orange tongues licking up the belly, seen in front of the brick
  const fm = [createFlameMaterial({ orange: 0.85, jets: 26, seed: 2, alpha: 0.95 }), createFlameMaterial({ orange: 0.5, jets: 18, seed: 9, alpha: 0.8 })];
  owned.push(...fm.map((m) => ({ dispose: () => m.dispose() })));
  const rings = [[0.255, 0.1, 0], [0.2, 0.08, 1]].map(([r, h, k]) => {
    const m = new Mesh(sharedGeo(`kadai:flame:${r}`, () => flameRingGeometry(r, h, 36)), fm[k]);
    m.position.set(0, BRICK_TOP - 0.035, KADAI_Z);
    m.renderOrder = 4;
    g.add(m);
    return m;
  });
  const glowMat = createGlowMaterial('#ff7a2a', 0.6);
  owned.push({ dispose: () => glowMat.dispose() });
  const glowGeo = sharedGeo('kadai:glow', () => new BufferGeometry().setAttribute('position', makeAttr([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3)).setAttribute('uv', makeAttr([0, 0, 1, 0, 0, 1, 1, 1], 2)).setIndex([0, 1, 2, 1, 3, 2]));
  const frontGlow = new Mesh(glowGeo, glowMat);
  frontGlow.scale.set(0.5, 0.16, 1);
  frontGlow.position.set(0, COUNTER_TOP + 0.002, CHULHA.z + CHULHA.d / 2 + 0.006);
  frontGlow.renderOrder = 6;
  g.add(frontGlow);
  let light = null;
  if (quality().lights) {
    light = new PointLight('#ff8a3a', 1.1, 1.8, 2);
    light.position.set(0, COUNTER_TOP + 0.16, KADAI_Z + 0.05);
    g.add(light);
  }
  const slots = SLOT_XZ.map(([x, z], i) => new KadaiSlot(g, i, x, z, [oil.uniforms.uSpot0.value, oil.uniforms.uSpot1.value, oil.uniforms.uSpot2.value][i]));
  slots.forEach((s) => {
    s.x = s.root.position.x;
    s.z = s.root.position.z - KADAI_Z;
    s.apply();
  });
  const skim = buildTendProp('skim', { y: OIL_Y, z: KADAI_Z });
  g.add(skim.group);
  let burnerOn = true;
  let flamePower = 1;
  const api = {
    group: g,
    slots,
    anchors: slots.map((s) => s.anchor.clone()),
    oilY: OIL_Y,
    update(dt, t) {
      for (const s of slots) s.update(dt, t);
      const any = slots.some((s) => s.cur.st === 'cooking' || s.cur.st === 'ready');
      oil.uniforms.uBoil.value += (((any && burnerOn) ? 1 : 0.35) - oil.uniforms.uBoil.value) * Math.min(1, dt * 2);
      if (light) light.intensity = burnerOn ? (1.0 + 0.25 * Math.sin(t * 12) + 0.12 * Math.sin(t * 27)) * (0.35 + 0.65 * flamePower) : 0;
    },
    /** The gas burner (see the tawa set): flames, glow and the steam / smoke on or off, a shorter flame on a low cylinder. */
    setBurner(on, power = 1) {
      burnerOn = !!on;
      flamePower = on ? Math.max(0.05, Math.min(1, power)) : 0;
      rings.forEach((m) => (m.visible = burnerOn));
      frontGlow.visible = burnerOn;
      // the light stays in the scene (intensity 0 when the burner is off): a changing point-light count recompiles every lit shader
      for (const m of fm) m.uniforms.uPower.value = flamePower;
      for (const s of slots) {
        s.steam.points.visible = burnerOn;
        s.smoke.points.visible = burnerOn;
      }
    },
    /** Seasoning of the kadai iron: the same burnt-on crust and cherry glow as the tawa. */
    setHeat(v) {
      const u = iron.uniforms;
      u.uGunk.value = v && Number.isFinite(v.gunk) ? v.gunk : 0;
      u.uHot.value = v && Number.isFinite(v.hot) ? v.hot : 0;
      u.uHeat.value = 0.55 + (v && Number.isFinite(v.glow) ? v.glow : 0.5);
    },
    tend(kind, t01) {
      if (kind === 'skim') skim.play(t01);
    },
    dispose() {
      for (const s of slots) s.dispose();
      for (const o of owned) o.dispose();
      skim.dispose();
      light?.removeFromParent();
      g.removeFromParent();
    },
  };
  return api;
}

export { Color };
