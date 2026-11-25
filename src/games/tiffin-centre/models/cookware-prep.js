// Prep (back) counter: a table-top wet grinder with a granite stone, the granite chutney stone (ammikallu) with its roller, a steel sambar
// vessel on a gas ring and a dough tray with a rolling pin. Its two slots are PREP JOBS (setSlot({ st, progress, item })): which of the four
// devices a job uses follows its ITEM (batter: the grinder, chutney / podi: the stone, sambar / masala / decoction: the vessel on the gas ring,
// dough: the tray), so the slot's anchor moves to the device. While a job runs the device works (the grinder turns and fills, the roller
// grinds, the vessel boils, the dough is kneaded); a ready job glows with a ring and shows its portions in steel bowls.
//   setBurner(on, power)  the gas ring under the vessel (jobs that need gas pause with it)     setPower(on)  the grinder (a power cut stops it)
import { CircleGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PointLight, Vector3 } from 'three';
import { boxUV, lathe, merge, paint, place, sweep } from './geo.js';
import { createFoodMaterial, foodUniforms } from './shaders/food.js';
import { createFlameMaterial } from './shaders/flame.js';
import { createSteam } from './shaders/steam.js';
import { pbrMaterial, plainMaterial, quality } from './pbr.js';
import { ReadyRing, smooth } from './fx.js';
import { sharedGeo } from './util.js';
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
// the granite slab and its bowl, WITHOUT the roller (that is its own mesh so it can grind)
function chutneyStoneGeo() {
  return sharedGeo('prep:chutneystone2', () => {
    const slab = paint(place(boxUV(0.34, 0.07, 0.24, 0.5, 0.5), { p: [0, 0.035, 0] }), [0.3, 0.29, 0.28]);
    const bowl = paint(place(lathe([[0, 0.071], [0.08, 0.072], [0.1, 0.073], [0.1, 0.0705], [0, 0.0695]], 16, { sub: 0 }), { p: [0, 0, 0] }), [0.1, 0.1, 0.1]);
    return merge([slab, bowl], true);
  });
}
function rollerGeo() {
  return sharedGeo('prep:roller', () => paint(lathe([[0, -0.1], [0.022, -0.1], [0.026, -0.09], [0.026, 0.09], [0.022, 0.1], [0, 0.1]], 12, { sub: 0 }).rotateZ(Math.PI / 2), [0.22, 0.21, 0.2]));
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
const bowlGeo = () => sharedGeo('prep:bowl', () => lathe([[0, 0], [0.022, 0], [0.038, 0.014], [0.042, 0.032], [0.0405, 0.033], [0.036, 0.015], [0.02, 0.004], [0, 0.003]], 14, { sub: 0, uv: [2, 2] }));
const pasteGeo = (r) => sharedGeo(`prep:paste:${r}`, () => new CircleGeometry(r, 18).rotateX(-Math.PI / 2));

// --- which device a job uses -------------------------------------------------------------------------------------------------------------------
export const PREP_DEVICES = ['grinder', 'stone', 'vessel', 'tray'];
export const DEVICE_OF = {
  batter_dosa: 'grinder', batter_idly: 'grinder', batter_pesarattu: 'grinder', vada_batter: 'grinder',
  coconut_chutney: 'stone', podi_ghee: 'stone', mirchi: 'stone',
  potato_masala: 'vessel', sambar: 'vessel', tea_decoction_milk: 'vessel', coffee_decoction: 'vessel',
  poori_dough: 'tray', besan_batter: 'tray', biscuits: 'tray', oil: 'tray',
};
/** What the portions look like (sRGB hex): the batter in the grinder, the paste on the stone, the dough, the bowls when ready. */
export const ITEM_COLOR = {
  batter_dosa: '#efe9d6', batter_idly: '#f1ecdc', batter_pesarattu: '#b9c98a', vada_batter: '#e9e2cb', besan_batter: '#e8c860',
  coconut_chutney: '#e6efd8', potato_masala: '#e2b324', sambar: '#c8601c', podi_ghee: '#a8482a', poori_dough: '#efe1c0', mirchi: '#5a9a3a',
  tea_decoction_milk: '#b8864a', coffee_decoction: '#5a3a22', biscuits: '#d9a85a', oil: '#d8b040',
};
const FREE_ORDER = ['grinder', 'tray', 'stone', 'vessel'];

/**
 * Which device each job slot uses: the item's own, and when both want the same one the later slot takes the first free other (two jobs never share a
 * device). An empty slot keeps a default. Pure: exported for the tests.
 */
export function assignDevices(items, out = ['grinder', 'vessel']) {
  const used = new Set();
  const pick = (want) => {
    if (want && !used.has(want)) return want;
    for (const d of FREE_ORDER) if (!used.has(d)) return d;
    return want || FREE_ORDER[0];
  };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    out[i] = pick(it ? DEVICE_OF[it] || null : null);
    used.add(out[i]);
  }
  return out;
}

const WHITE = new Color('#ffffff');
const DOUGH = new Color('#efe1c0');

/** One of the two job slots: ring, bowls, steam and the anchor, placed on the device its item uses. */
class PrepSlot {
  constructor(parent, i, parts) {
    this.i = i;
    this.parts = parts;
    this.cur = { st: 'empty', progress: 0, item: null };
    this.device = i === 0 ? 'grinder' : 'vessel';
    this.root = new Group();
    this.root.position.set(0, COUNTER_TOP, 0);
    parent.add(this.root);
    this.ring = new ReadyRing(this.root, 0, 0.003, 0, 0.17, '#9dff9d');
    this.bowls = new Group();
    this.bowlMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const steel_ = pbrMaterial('steel-brushed', { rough: 0.9, metal: 1, key: 'prep-bowl', color: '#d6dade' });
    for (let k = 0; k < 3; k++) {
      const b = new Mesh(bowlGeo(), steel_);
      const fill = new Mesh(pasteGeo(0.034), this.bowlMat);
      fill.position.y = 0.027;
      b.add(fill);
      b.position.set((k - 1) * 0.095, 0, k === 1 ? 0.0 : 0.03);
      this.bowls.add(b);
    }
    this.bowls.visible = false;
    this.root.add(this.bowls);
    this.steam = createSteam({ count: 8, rise: 0.3, size: 0.1, speed: 0.35, radius: 0.1, drift: 0.04, opacity: 0.26, seed: 71 + i });
    this.root.add(this.steam.points);
    this.smoke = createSteam({ count: 6, rise: 0.4, size: 0.1, speed: 0.28, radius: 0.1, drift: 0.05, color: '#4a4643', opacity: 0.5, seed: 81 + i });
    this.root.add(this.smoke.points);
    this.anchor = new Vector3(0, COUNTER_TOP + 0.34, 0);
    this.color = new Color('#ffffff');
    this.place(this.device);
  }
  /** Move the slot (ring, bowls, steam, anchor) onto a device. */
  place(device) {
    this.device = device;
    const d = this.parts.dev[device];
    this.root.position.set(d.x, COUNTER_TOP, d.z);
    this.steam.points.position.set(0, d.steamY, 0);
    this.smoke.points.position.copy(this.steam.points.position);
    this.anchor.set(d.x, COUNTER_TOP + d.top, d.z);
    this.bowls.position.set(d.bx, 0, d.bz);
    this.ring.mesh.scale.setScalar(d.ring / 0.17);
  }
  set(info) {
    const st = info && (info.st === 'cooking' || info.st === 'ready' || info.st === 'burnt') ? info.st : 'empty';
    this.cur.st = st;
    this.cur.progress = Math.max(0, Math.min(1, Number.isFinite(info?.progress) ? info.progress : 0));
    this.cur.item = st === 'empty' ? null : info?.item || null;
    this.color.set(ITEM_COLOR[this.cur.item] || '#efe9d6');
    this.bowlMat.color.copy(this.color);
    this.ring.mat.color.copy(this.color).lerp(WHITE, 0.35);
  }
  playAction() {}
  update(dt, t) {
    const ready = this.cur.st === 'ready';
    this.ring.update(t, ready);
    this.bowls.visible = ready;
    if (ready) {
      // the portions glow a little and breathe, so a finished job reads from across the stall
      const g = 0.7 + 0.3 * Math.sin(t * 3.2 + this.i);
      this.bowlMat.color.copy(this.color).multiplyScalar(0.85 + 0.35 * g);
      this.ring.mat.opacity = 0.2 + 0.16 * g;
    }
  }
  dispose() {
    this.steam.dispose();
    this.smoke.dispose();
    this.ring.dispose();
    this.bowlMat.dispose();
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
  // where each device sits (station-local), the height of a slot's anchor above the counter and of its steam, and where the ready bowls stand
  const dev = {
    grinder: { x: GX, z: -0.12, top: 0.34, steamY: 0.33, bx: 0.0, bz: 0.2, ring: 0.19 },
    stone: { x: 0.0, z: 0.02, top: 0.14, steamY: 0.1, bx: 0.0, bz: 0.14, ring: 0.17 },
    vessel: { x: VX, z: -0.12, top: 0.26, steamY: 0.23, bx: 0.0, bz: 0.22, ring: 0.19 },
    tray: { x: 0.0, z: -0.3, top: 0.14, steamY: 0.12, bx: 0.0, bz: 0.14, ring: 0.17 },
  };
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
  batter.visible = false;
  g.add(batter);
  // chutney stone and roller
  const cs = new Mesh(chutneyStoneGeo(), vcMat);
  cs.position.set(0.0, COUNTER_TOP, 0.02);
  cs.rotation.y = 0.2;
  g.add(cs);
  const pasteMat = new MeshBasicMaterial({ color: '#e6efd8', toneMapped: false });
  owned.push({ dispose: () => pasteMat.dispose() });
  const paste = new Mesh(pasteGeo(0.075), pasteMat);
  paste.position.set(0.0, COUNTER_TOP + 0.0765, 0.02);
  paste.visible = false;
  g.add(paste);
  const roller = new Mesh(rollerGeo(), vcMat);
  roller.position.set(0.02, COUNTER_TOP + 0.098, 0.02);
  g.add(roller);
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
  const doughMat = new MeshPhysicalMaterial({ color: '#efe1c0', roughness: 0.75, metalness: 0, sheen: 0.4, sheenColor: '#fff5dc' });
  owned.push({ dispose: () => doughMat.dispose() });
  const dough = new Mesh(sharedGeo('prep:dough', () => lathe([[0, 0.004], [0.07, 0.006], [0.095, 0.02], [0.08, 0.04], [0.04, 0.05], [0, 0.052]], 16, { sub: 0 })), doughMat);
  dough.position.set(0, COUNTER_TOP + 0.075, -0.3);
  dough.visible = false;
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

  const flags = { burner: true, power: true, flame: 1 };
  const slots = [new PrepSlot(g, 0, { dev }), new PrepSlot(g, 1, { dev })];
  const anchors = slots.map((s) => s.anchor); // live vectors: a slot's anchor follows its device
  const items = [null, null];
  const devs = ['grinder', 'vessel'];
  const ctl = { grinder: null, stone: null, vessel: null, tray: null }; // the slot working each device
  let spin = 0;
  let roll = 0;

  // what each device looks like for its job (called whenever a job or a flag changes)
  function applyDevices() {
    const gr = ctl.grinder;
    batter.visible = !!gr;
    if (gr) {
      batterFm.uniforms.uA.value.copy(gr.color);
      batter.position.y = COUNTER_TOP + 0.3 - 0.03 * (1 - (gr.cur.st === 'cooking' ? smooth(0, 0.8, gr.cur.progress) : 1));
    }
    const sn = ctl.stone;
    paste.visible = !!sn;
    if (sn) {
      pasteMat.color.copy(sn.color);
      paste.scale.setScalar(sn.cur.st === 'cooking' ? 0.4 + 0.6 * smooth(0, 0.7, sn.cur.progress) : 1);
    }
    const tr = ctl.tray;
    dough.visible = !!tr;
    if (tr) {
      doughMat.color.copy(tr.color).lerp(DOUGH, 0.5);
      dough.scale.setScalar(tr.cur.st === 'cooking' ? 0.55 + 0.45 * smooth(0, 0.8, tr.cur.progress) : 1);
    }
    const ve = ctl.vessel;
    const boiling = !!ve && flags.burner;
    flame.visible = boiling;
    if (light) light.visible = boiling;
    fm.uniforms.uPower.value = flags.flame;
    for (const s of slots) {
      const own = s.device === 'vessel' && s.cur.st !== 'empty' && flags.burner;
      s.steam.setAmount(own && (s.cur.st === 'cooking' || s.cur.st === 'ready') ? (s.cur.st === 'cooking' ? 0.7 : 0.35) * quality().particles : 0);
      s.smoke.setAmount(s.cur.st === 'burnt' ? 0.9 : 0);
    }
  }
  const reassign = () => {
    items[0] = slots[0].cur.item;
    items[1] = slots[1].cur.item;
    assignDevices(items, devs);
    ctl.grinder = ctl.stone = ctl.vessel = ctl.tray = null;
    slots.forEach((s, i) => {
      if (s.device !== devs[i]) s.place(devs[i]);
      if (s.cur.st !== 'empty') ctl[devs[i]] = s;
    });
  };
  reassign();
  applyDevices();

  return {
    group: g,
    slots,
    anchors,
    devices: devs,
    update(dt, tt) {
      for (const s of slots) s.update(dt, tt);
      // the grinder stone turns while its job runs (and the power is on); the roller grinds; the vessel lid rattles; the dough is rolled
      const gr = ctl.grinder;
      if (gr && gr.cur.st === 'cooking' && flags.power) spin += dt * 5;
      stone.rotation.y = spin;
      batterFm.uniforms.uSeed.value = 0.9 + Math.sin(spin * 0.5) * 0.05;
      const sn = ctl.stone;
      if (sn && sn.cur.st === 'cooking') roll += dt * 3.4;
      roller.position.x = 0.02 + (sn && sn.cur.st === 'cooking' ? Math.sin(roll) * 0.05 : 0);
      roller.rotation.y = 0.3 + (sn && sn.cur.st === 'cooking' ? Math.sin(roll * 0.5) * 0.15 : 0);
      const ve = ctl.vessel;
      const boil = !!ve && ve.cur.st === 'cooking' && flags.burner;
      lidPivot.position.y = COUNTER_TOP + 0.034 + (boil ? Math.max(0, Math.sin(tt * 22)) * 0.003 : 0);
      lidPivot.rotation.z = boil ? Math.sin(tt * 21) * 0.01 : 0;
      if (light) light.intensity = flags.burner ? (0.35 + 0.1 * Math.sin(tt * 15)) * (0.4 + 0.6 * flags.flame) : 0;
      const tr = ctl.tray;
      pin.position.z = -0.3 + (tr && tr.cur.st === 'cooking' ? Math.sin(tt * 4) * 0.045 : 0);
    },
    setSlot(i, info) {
      if (!slots[i]) return;
      slots[i].set(info);
      reassign();
      applyDevices();
    },
    /** The gas ring under the vessel: the flame (shorter when `power` < 1) and the steam; jobs that need gas stand still while it is off. */
    setBurner(on, power = 1) {
      flags.burner = !!on;
      flags.flame = on ? Math.max(0.05, Math.min(1, power)) : 0;
      applyDevices();
    },
    /** The wet grinder has power (false in a power cut: the stone stops). */
    setPower(on) {
      flags.power = !!on;
    },
    get spinning() {
      return !!(ctl.grinder && ctl.grinder.cur.st === 'cooking' && flags.power);
    },
    dispose() {
      for (const s of slots) s.dispose();
      for (const o of owned) o.dispose();
      light?.removeFromParent();
      g.removeFromParent();
    },
  };
}
