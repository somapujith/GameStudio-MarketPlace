// Idly station: four aluminium idli cookers (soot-blackened pot, riveted shoulder, tier with a cotton cloth and four spongy idlis,
// hinged lid) with real steam. setSlot drives the idli rise (batter -> fluffy white -> yellowed / burnt) and the lid; playAction 'lid'
// lifts the lid, 'take' slides the idlis away.
import { Group, Mesh, SphereGeometry, Vector3 } from 'three';
import { lathe, merge, paint, place, sweep } from './geo.js';
import { createFoodMaterial, foodUniforms } from './shaders/food.js';
import { createSteam } from './shaders/steam.js';
import { pbrMaterial, plainMaterial, quality } from './pbr.js';
import { ReadyRing, easeOut, smooth } from './fx.js';
import { sharedGeo } from './util.js';
import { normSlot } from './food-dosa.js';
import { clamp01 } from './food-util.js';
import { COUNTER_TOP } from './cookware-tawa.js';
import { buildTendProp, buildWaterGauge } from './cookware-tend.js';

const V3 = (x, y, z) => new Vector3(x, y, z);
export const POT_R = 0.16;
export const TIER_TOP = 0.385;
const SLOT_X = [-0.465, -0.155, 0.155, 0.465];
const SLOT_Z = 0.1;
const sg = (n) => Math.max(12, Math.round(n * quality().segScale));
const sgp = (n) => Math.max(14, Math.round(n * quality().segScale));

function potGeo() {
  return sharedGeo(`steamer:pot:${quality().name}`, () => {
    const body = lathe([[0, 0], [0.14, 0], [0.16, 0.04], [0.1605, 0.2], [0.1665, 0.208], [0.1585, 0.37], [0.1612, 0.378], [0.1565, 0.385], [0.1525, 0.378], [0.149, 0.33], [0, 0.325]], sgp(22), { sub: 0, uv: [2, 3] });
    // soot gradient: black near the flame, oxidised grey above, vertical streaks
    paint(body, (x, y, z) => {
      const th = Math.atan2(x, z);
      const streak = 0.5 + 0.5 * Math.sin(th * 9 + y * 3) * Math.sin(th * 4 + 1.3);
      const soot = 1 - smooth(0.0, 0.17 + 0.07 * streak, y);
      const k = 0.8 - 0.7 * soot - 0.1 * streak * smooth(0.18, 0.26, y) * (1 - smooth(0.26, 0.37, y));
      return [k, k * 0.985, k * 0.96];
    });
    // handles: riveted steel ears at both sides
    const ears = [-1, 1].map((s) => {
      const path = [V3(s * 0.158, 0.31, 0), V3(s * 0.19, 0.318, 0), V3(s * 0.19, 0.272, 0), V3(s * 0.16, 0.262, 0)];
      const g = sweep(path, () => [0.007, 0.0045], 5, { up: V3(0, 0, 1) });
      return paint(g, [0.55, 0.57, 0.58]);
    });
    const rivets = [-1, 1].flatMap((s) => [0.31, 0.262].map((y) => paint(place(new SphereGeometry(0.0065, 5, 3), { p: [s * 0.1595, y, 0], s: [0.5, 1, 1] }), [0.7, 0.72, 0.74])));
    return merge([body, ...ears, ...rivets], true);
  });
}
function lidGeo() {
  return sharedGeo(`steamer:lid:${quality().name}`, () => {
    const lid = lathe([[0.1705, 0.0], [0.1715, 0.012], [0.164, 0.02], [0.13, 0.046], [0.09, 0.062], [0.045, 0.07], [0.012, 0.0745], [0, 0.0752]], sgp(22), { sub: 0, uv: [2, 2] });
    paint(lid, [0.78, 0.8, 0.8]);
    const knob = place(new SphereGeometry(0.0145, 8, 5), { p: [0, 0.087, 0], s: [1, 0.9, 1] });
    paint(knob, [0.05, 0.045, 0.04]);
    return place(merge([lid, knob], true), { p: [0, 0, POT_R] }); // offset so the hinge sits at the back of the pot
  });
}
function idliGeo() {
  return sharedGeo(`steamer:idli:${quality().name}`, () => lathe([[0, 0], [0.034, 0.002], [0.0368, 0.012], [0.03, 0.025], [0.012, 0.031], [0, 0.0314]], sgp(12), { sub: 0, uv: [1, 6] }));
}
function idliPlateGeo() {
  return sharedGeo(`steamer:idliplate:${quality().name}`, () => lathe([[0, 0], [0.128, 0.0], [0.149, -0.02], [0.1495, -0.04]], sgp(18), { sub: 0, uv: [2, 2], flip: true }));
}

const IDLI_XZ = [[-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05], [0.05, 0.05]];

class SteamerSlot {
  constructor(parent, i, x) {
    this.i = i;
    this.root = new Group();
    this.root.position.set(x, COUNTER_TOP, SLOT_Z);
    parent.add(this.root);
    this.cur = normSlot(null);
    this.act = null;
    this.now = 0;
    this.lidAngle = 0;
    this.lidTarget = 0;
    this.pot = new Mesh(potGeo(), pbrMaterial('aluminium', { rough: 1, metal: 1, vertexColors: true, key: 'alu-vc', aniso: 0.3 }));
    this.root.add(this.pot);
    // cloth + idlis (own material so the cook state is per pot)
    this.cloth = new Mesh(idliPlateGeo(), pbrMaterial('cloth', { rough: 1, metal: 0, color: '#e8e2d2', side: 2, key: 'idli-cloth' }));
    this.cloth.position.y = 0.327;
    this.root.add(this.cloth);
    this.fm = createFoodMaterial('idli', { uniforms: foodUniforms('idli', { cook: 0, scale: 18, seed: 0.3 + i * 0.2 }) });
    this.idlis = new Group();
    this.idlis.position.y = 0.326;
    this.root.add(this.idlis);
    IDLI_XZ.forEach(([dx, dz], k) => {
      const m = new Mesh(idliGeo(), this.fm.mat);
      m.position.set(dx, 0, dz);
      m.rotation.y = k * 1.7 + i;
      this.idlis.add(m);
    });
    this.hinge = new Group();
    this.hinge.position.set(0, TIER_TOP + 0.002, -POT_R);
    this.lid = new Mesh(lidGeo(), pbrMaterial('aluminium', { rough: 1, metal: 1, vertexColors: true, key: 'alu-vc', aniso: 0.3 }));
    this.hinge.add(this.lid);
    this.root.add(this.hinge);
    this.steam = createSteam({ count: 10, rise: 0.4, size: 0.13, speed: 0.3, radius: 0.18, drift: 0.05, opacity: 0.28, seed: 11 + i });
    this.steam.points.position.set(0, TIER_TOP, 0);
    this.root.add(this.steam.points);
    this.smoke = createSteam({ count: 6, rise: 0.4, size: 0.12, speed: 0.28, radius: 0.15, drift: 0.05, color: '#4a4643', opacity: 0.5, seed: 23 + i });
    this.smoke.points.position.set(0, TIER_TOP, 0);
    this.root.add(this.smoke.points);
    this.ring = new ReadyRing(this.root, 0, 0.003, 0.0, 0.2);
    this.anchor = new Vector3(x, COUNTER_TOP + TIER_TOP + 0.02, SLOT_Z);
    this.apply();
  }
  set(info) {
    this.cur = normSlot(info);
    this.apply();
  }
  playAction(kind, t01) {
    const t = clamp01(t01);
    if (kind === 'lid' || kind === 'take') {
      this.act = t >= 1 && kind === 'lid' ? null : { kind, t01: t, stamp: this.now };
      this.apply();
    }
  }
  apply() {
    const { st, progress: p, burnFrac } = this.cur;
    const u = this.fm.uniforms;
    const a = this.act;
    const cook = st === 'cooking' ? 0.04 + p * 0.72 : st === 'ready' ? 0.78 + 0.1 * burnFrac : st === 'burnt' ? 1.2 : 0;
    u.uCook.value = cook;
    u.uBurn.value = st === 'burnt' ? 1 : 0;
    const rise = st === 'cooking' ? 0.3 + 0.7 * smooth(0, 0.85, p) : st === 'burnt' ? 0.82 : 1;
    this.idlis.visible = st !== 'empty' && !(a && a.kind === 'take' && a.t01 > 0.97);
    this.idlis.scale.set(1, rise, 1);
    this.idlis.position.set(0, 0.326, 0);
    if (a && a.kind === 'take') this.idlis.position.set(0, 0.326 + 0.09 * easeOut(a.t01), 0.12 * easeOut(a.t01));
    let target = st === 'empty' ? 0 : st === 'burnt' ? -0.6 : st === 'cooking' ? (p < 0.03 ? 0 : -1.45) : -1.85;
    if (a && a.kind === 'lid') target = -1.85 * easeOut(Math.min(1, a.t01 * 1.6));
    this.lidTarget = target;
    this.cloth.visible = st !== 'empty';
    const q = quality().particles;
    this.steam.setAmount(st === 'cooking' ? (0.4 + 0.6 * smooth(0, 0.25, p)) * q : st === 'ready' ? 0.5 * q : 0);
    this.smoke.setAmount(st === 'burnt' ? 0.9 : 0);
  }
  update(dt, t) {
    this.now = t;
    if (this.act && t - this.act.stamp > 0.9) {
      this.act = null;
      this.apply();
    }
    this.lidAngle += (this.lidTarget - this.lidAngle) * Math.min(1, dt * 7);
    this.hinge.rotation.x = this.lidAngle;
    this.ring.update(t, this.cur.st === 'ready' && !this.act);
  }
  dispose() {
    this.fm.dispose();
    this.steam.dispose();
    this.smoke.dispose();
    this.ring.dispose();
    this.root.removeFromParent();
  }
}

export function buildSteamerSet() {
  const g = new Group();
  g.name = 'steamer-set';
  const slots = SLOT_X.map((x, i) => new SteamerSlot(g, i, x));
  // a sight gauge on the counter front (the water reservoir) and the jug that tops it up
  const gauge = buildWaterGauge();
  gauge.group.position.set(-0.6, COUNTER_TOP - 0.2, 0.452);
  g.add(gauge.group);
  const jug = buildTendProp('water', { y: COUNTER_TOP + TIER_TOP, z: SLOT_Z });
  g.add(jug.group);
  let gasOn = true;
  let powerOn = true;
  let dry = false;
  const applySteam = () => {
    const steaming = gasOn && powerOn && !dry;
    for (const s of slots) {
      s.steam.points.visible = steaming;
      s.smoke.points.visible = steaming;
    }
  };
  gauge.set(1);
  const api = {
    group: g,
    slots,
    anchors: slots.map((s) => s.anchor.clone()),
    update(dt, t) {
      for (const s of slots) s.update(dt, t);
    },
    /** The steamer is off (the cylinder is empty or being changed, or the power is cut): no steam, no smoke. */
    setBurner(b) {
      gasOn = !!b;
      applySteam();
    },
    setPower(b) {
      powerOn = !!b;
      applySteam();
    },
    /** `water` 0..1 of the reservoir: the sight gauge; a dry steamer makes no steam. */
    setHeat(v) {
      const w = v && Number.isFinite(v.water) ? v.water : 1;
      gauge.set(w);
      dry = !!(v && v.dry);
      applySteam();
    },
    tend(kind, t01) {
      if (kind === 'water') jug.play(t01);
    },
    dispose() {
      for (const s of slots) s.dispose();
      gauge.dispose();
      jug.dispose();
      g.removeFromParent();
    },
  };
  return api;
}
