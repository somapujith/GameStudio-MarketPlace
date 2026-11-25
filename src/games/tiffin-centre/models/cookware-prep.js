// Prep (back) counter: a table-top wet grinder with a granite stone, the granite chutney stone (ammikallu) with its roller, a steel sambar
// vessel on a gas ring and a dough tray with a rolling pin. Its two slots are PREP JOBS (setSlot with any dish / item id): slot 0 runs the
// wet grinder (stone turns, batter level rises, foam), slot 1 boils the vessel (flame, lid rattle, steam).
import { Group, Mesh, MeshPhysicalMaterial, PointLight, Vector3 } from 'three';
import { boxUV, lathe, merge, paint, place, sweep } from './geo.js';
import { createFoodMaterial, foodUniforms } from './shaders/food.js';
import { createFlameMaterial } from './shaders/flame.js';
import { createSteam } from './shaders/steam.js';
import { pbrMaterial, plainMaterial, quality } from './pbr.js';
import { ReadyRing, smooth } from './fx.js';
import { sharedGeo } from './util.js';
import { normSlot } from './food-dosa.js';
import { COUNTER_TOP } from './cookware-tawa.js';
import { burnerGeo } from './cookware-chai.js';
import { flameRingGeometry } from './shaders/flame.js';

const sg = (n) => Math.max(12, Math.round(n * quality().segScale));
const V3 = (x, y, z) => new Vector3(x, y, z);

function grinderGeos() {
  return sharedGeo(`prep:grinder:${quality().name}`, () => {
    const base = lathe([[0, 0], [0.17, 0], [0.18, 0.01], [0.178, 0.12], [0.165, 0.17], [0.15, 0.178], [0, 0.178]], sg(26), { sub: 0, uv: [2, 2] });
    paint(base, [0.2, 0.22, 0.24]);
    const drum = lathe([[0.11, 0.17], [0.15, 0.172], [0.152, 0.2], [0.155, 0.31], [0.158, 0.318], [0.15, 0.318], [0.147, 0.3], [0.14, 0.2], [0.1, 0.19]], sg(26), { sub: 0, uv: [2, 2] });
    paint(drum, [0.78, 0.8, 0.82]);
    const lugs = [-1, 1].map((s) => paint(sweep([V3(s * 0.155, 0.28, 0), V3(s * 0.19, 0.295, 0), V3(s * 0.2, 0.26, 0), V3(s * 0.157, 0.245, 0)], () => [0.008, 0.006], 6, { up: V3(0, 0, 1) }), [0.7, 0.72, 0.74]));
    return merge([base, drum, ...lugs], true);
  });
}
function stoneGeo() {
  return sharedGeo(`prep:stone:${quality().name}`, () => paint(lathe([[0, 0], [0.12, 0], [0.124, 0.006], [0.124, 0.07], [0.12, 0.076], [0.04, 0.076], [0, 0.074]], sg(22), { sub: 0, uv: [2, 2] }), [0.18, 0.17, 0.17]));
}
function chutneyStoneGeo() {
  return sharedGeo('prep:chutneystone', () => {
    const slab = paint(place(boxUV(0.34, 0.07, 0.24, 0.5, 0.5), { p: [0, 0.035, 0] }), [0.3, 0.29, 0.28]);
    const roller = paint(place(lathe([[0, -0.1], [0.022, -0.1], [0.026, -0.09], [0.026, 0.09], [0.022, 0.1], [0, 0.1]], 12, { sub: 0 }).rotateZ(Math.PI / 2), { p: [0.02, 0.095, 0.0], r: [0, 0.3, 0] }), [0.22, 0.21, 0.2]);
    const bowl = paint(place(lathe([[0, 0.071], [0.08, 0.072], [0.1, 0.073], [0.1, 0.0705], [0, 0.0695]], 16, { sub: 0 }), { p: [0, 0, 0] }), [0.1, 0.1, 0.1]);
    return merge([slab, roller, bowl], true);
  });
}
function vesselGeo() {
  return sharedGeo(`prep:vessel:${quality().name}`, () => {
    const body = lathe([[0, 0], [0.12, 0], [0.132, 0.008], [0.14, 0.04], [0.142, 0.18], [0.1445, 0.19], [0.1405, 0.196], [0.138, 0.19], [0.1375, 0.18], [0.135, 0.04], [0, 0.03]], sg(26), { sub: 0, uv: [2, 3] });
    const handles = [-1, 1].map((s) => sweep([V3(s * 0.142, 0.15, 0), V3(s * 0.19, 0.16, 0), V3(s * 0.19, 0.12, 0), V3(s * 0.143, 0.115, 0)], () => [0.008, 0.005], 6, { up: V3(0, 0, 1) }));
    return merge([body, ...handles]);
  });
}
function vesselLidGeo() {
  return sharedGeo(`prep:vessellid:${quality().name}`, () => {
    const lid = lathe([[0, 0.205], [0.04, 0.207], [0.12, 0.2], [0.146, 0.192], [0.148, 0.184], [0.14, 0.186]], sg(26), { sub: 1, uv: [2, 2] });
    const knob = place(lathe([[0, 0], [0.012, 0.002], [0.014, 0.014], [0.006, 0.026], [0, 0.0265]], 10, { sub: 0 }), { p: [0, 0.207, 0] });
    return merge([lid, knob]);
  });
}
function trayBodyGeo() {
  return sharedGeo('prep:tray', () => lathe([[0, 0.002], [0.1, 0.002], [0.13, 0.008], [0.14, 0.03], [0.1405, 0.034], [0.136, 0.034], [0.126, 0.014], [0, 0.007]], sg(24), { sub: 0, uv: [2, 2] }));
}
function pinGeo() {
  return sharedGeo('prep:pin', () => place(lathe([[0, -0.15], [0.016, -0.14], [0.018, -0.1], [0.018, 0.1], [0.016, 0.14], [0, 0.15]], 10, { sub: 0 }).rotateZ(Math.PI / 2), { p: [0.02, 0.045, 0.02], r: [0, 0.5, 0] }));
}

class PrepSlot {
  constructor(parent, i, x, z, parts) {
    this.i = i;
    this.parts = parts;
    this.cur = normSlot(null);
    this.root = new Group();
    this.root.position.set(x, COUNTER_TOP, z);
    parent.add(this.root);
    this.ring = new ReadyRing(this.root, 0, 0.003, 0, 0.19);
    this.steam = createSteam({ count: 8, rise: 0.3, size: 0.1, speed: 0.35, radius: 0.1, drift: 0.04, opacity: 0.26, seed: 71 + i });
    this.steam.points.position.set(0, i === 0 ? 0.33 : 0.23, 0);
    this.root.add(this.steam.points);
    this.smoke = createSteam({ count: 6, rise: 0.4, size: 0.1, speed: 0.28, radius: 0.1, drift: 0.05, color: '#4a4643', opacity: 0.5, seed: 81 + i });
    this.smoke.points.position.copy(this.steam.points.position);
    this.root.add(this.smoke.points);
    this.anchor = new Vector3(x, COUNTER_TOP + 0.34, z);
    this.now = 0;
    this.apply();
  }
  set(info) {
    this.cur = normSlot(info);
    this.apply();
  }
  playAction() {}
  apply() {
    const { st, progress: p } = this.cur;
    const q = quality().particles;
    this.parts.setState(this.i, st, p);
    this.steam.setAmount(this.i === 1 && (st === 'cooking' || st === 'ready') ? 0.7 * q : 0);
    this.smoke.setAmount(st === 'burnt' ? 0.9 : 0);
  }
  update(dt, t) {
    this.now = t;
    this.ring.update(t, this.cur.st === 'ready');
    this.parts.tick(this.i, this.cur.st, dt, t);
  }
  dispose() {
    this.steam.dispose();
    this.smoke.dispose();
    this.ring.dispose();
    this.root.removeFromParent();
  }
}

export function buildPrepSet() {
  const g = new Group();
  g.name = 'prep-set';
  const owned = [];
  const steel = (k, c) => pbrMaterial('steel-brushed', { rough: 0.9, metal: 1, key: k, color: c, vertexColors: false });
  const vcMat = plainMaterial('prepvc', { vertexColors: true, roughness: 0.45, metalness: 0.5 });
  const GX = -0.34;
  const VX = 0.33;
  // wet grinder
  const grinder = new Mesh(grinderGeos(), vcMat);
  grinder.position.set(GX, COUNTER_TOP, -0.12);
  g.add(grinder);
  const stone = new Mesh(stoneGeo(), vcMat);
  stone.position.set(GX, COUNTER_TOP + 0.19, -0.12);
  g.add(stone);
  const batterFm = createFoodMaterial('liquid', { uniforms: foodUniforms('chutney', { scale: 14, amt: 0.1, seed: 0.9 }) });
  owned.push(batterFm);
  const batter = new Mesh(sharedGeo('prep:batter', () => lathe([[0, 0.002], [0.1, 0.0], [0.138, -0.004], [0.139, -0.03], [0, -0.03]], sg(22), { sub: 0 })), batterFm.mat);
  batter.position.set(GX, COUNTER_TOP + 0.3, -0.12);
  g.add(batter);
  // chutney stone and roller
  const cs = new Mesh(chutneyStoneGeo(), vcMat);
  cs.position.set(0.0, COUNTER_TOP, 0.02);
  cs.rotation.y = 0.2;
  g.add(cs);
  // sambar vessel on a gas ring
  const ring = new Mesh(burnerGeo(), pbrMaterial('iron-dark', { rough: 1, metal: 1, key: 'burner' }));
  ring.position.set(VX, COUNTER_TOP, -0.12);
  g.add(ring);
  const vessel = new Mesh(vesselGeo(), steel('prep-vessel', '#d6dade'));
  vessel.position.set(VX, COUNTER_TOP + 0.034, -0.12);
  g.add(vessel);
  const lidPivot = new Group();
  lidPivot.position.set(VX, COUNTER_TOP + 0.034, -0.12);
  const lid = new Mesh(vesselLidGeo(), steel('prep-vessel', '#d6dade'));
  lidPivot.add(lid);
  g.add(lidPivot);
  const fm = createFlameMaterial({ jets: 22, seed: 6, alpha: 0.9 });
  owned.push({ dispose: () => fm.dispose() });
  const flame = new Mesh(sharedGeo('prep:flame', () => flameRingGeometry(0.066, 0.05, 28)), fm);
  flame.position.set(VX, COUNTER_TOP + 0.016, -0.12);
  flame.renderOrder = 4;
  flame.visible = false;
  g.add(flame);
  // dough tray with a rolling pin
  const tray = new Mesh(trayBodyGeo(), steel('prep-tray', '#c0c6ca'));
  tray.position.set(0.0, COUNTER_TOP + 0.075, -0.3);
  const dough = new Mesh(sharedGeo('prep:dough', () => {
    const d = lathe([[0, 0.004], [0.07, 0.006], [0.095, 0.02], [0.08, 0.04], [0.04, 0.05], [0, 0.052]], 16, { sub: 0 });
    return d;
  }), new MeshPhysicalMaterial({ color: '#efe1c0', roughness: 0.75, metalness: 0, sheen: 0.4, sheenColor: '#fff5dc' }));
  owned.push({ dispose: () => dough.material.dispose() });
  dough.position.set(0, COUNTER_TOP + 0.075, -0.3);
  const pin = new Mesh(pinGeo(), pbrMaterial('wood', { rough: 1, metal: 0, key: 'tool-wood' }));
  pin.position.set(0.0, COUNTER_TOP + 0.075, -0.3);
  g.add(tray, dough, pin);
  // a tray stand
  const stand = new Mesh(sharedGeo('prep:stand', () => merge([place(boxUV(0.3, 0.075, 0.3, 0.3, 0.3), { p: [0, 0.0375, 0] })])), plainMaterial('prepstand', { color: '#7a5a3a', roughness: 0.8, metalness: 0 }));
  stand.position.set(0.0, COUNTER_TOP, -0.3);
  g.add(stand);
  let light = null;
  if (quality().lights) {
    light = new PointLight('#7aa8ff', 0.4, 1.0, 2);
    light.position.set(VX, COUNTER_TOP + 0.1, -0.05);
    light.visible = false;
    g.add(light);
  }

  const state = { 0: { st: 'empty', p: 0, spin: 0 }, 1: { st: 'empty', p: 0, rattle: 0 } };
  const parts = {
    setState(i, st, p) {
      state[i].st = st;
      state[i].p = p;
      if (i === 0) {
        batter.visible = st !== 'empty';
        batter.position.y = COUNTER_TOP + 0.3 - 0.03 * (1 - (st === 'cooking' ? smooth(0, 0.8, p) : 1));
        batterFm.uniforms.uA.value.setRGB(0.93, 0.92, 0.88);
      } else {
        flame.visible = st === 'cooking' || st === 'ready';
        if (light) light.visible = flame.visible;
        lidPivot.visible = true;
      }
    },
    tick(i, st, dt, t) {
      if (i === 0) {
        const on = st === 'cooking';
        state[0].spin += dt * (on ? 5 : 0);
        stone.rotation.y = state[0].spin;
        batterFm.uniforms.uSeed.value = 0.9 + Math.sin(state[0].spin * 0.5) * 0.05;
      } else {
        const boil = st === 'cooking';
        lidPivot.position.y = COUNTER_TOP + 0.034 + (boil ? Math.max(0, Math.sin(t * 22)) * 0.003 : 0);
        lidPivot.rotation.z = boil ? Math.sin(t * 21) * 0.01 : 0;
        if (light) light.intensity = 0.35 + 0.1 * Math.sin(t * 15);
      }
    },
  };
  const slots = [new PrepSlot(g, 0, GX, -0.12, parts), new PrepSlot(g, 1, VX, -0.12, parts)];
  return {
    group: g,
    slots,
    anchors: slots.map((s) => s.anchor.clone()),
    update(dt, tt) {
      for (const s of slots) s.update(dt, tt);
    },
    dispose() {
      for (const s of slots) s.dispose();
      for (const o of owned) o.dispose();
      light?.removeFromParent();
      g.removeFromParent();
    },
  };
}
