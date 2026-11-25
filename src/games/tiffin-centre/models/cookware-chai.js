// Chai counter: a steel gas stove with a soot-blackened Irani kettle over a blue flame, the steel pot for the long pour, a glass jar of
// Osmania biscuits, a tray of spare glasses, and two serving slots (glass + saucer with chai / filter coffee, or biscuits).
import { BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshPhysicalMaterial, PointLight, Vector3 } from 'three';
import { boxUV, lathe, merge, place } from './geo.js';
import { buildTool, TM } from './tools.js';
import { createFoodMaterial, foodUniforms } from './shaders/food.js';
import { createFlameMaterial, createGlowMaterial, flameRingGeometry } from './shaders/flame.js';
import { createSteam } from './shaders/steam.js';
import { pbrMaterial, plainMaterial, quality } from './pbr.js';
import { ReadyRing, easeOut, smooth } from './fx.js';
import { sharedGeo } from './util.js';
import { normSlot } from './food-dosa.js';
import { clamp01 } from './food-util.js';
import { COUNTER_TOP, lpgGeometry } from './cookware-tawa.js';
import { MAT, jarGeo, jarLidGeo, trayGeo } from './cookware-props.js';

const sg = (n) => Math.max(12, Math.round(n * quality().segScale));
export const STOVE = { x: -0.33, z: -0.13, w: 0.5, d: 0.4, h: 0.075 };
const SLOT_X = [-0.2, 0.2];
const SLOT_Z = 0.23;
const OY = 0.0165; // glass base above the saucer base

const CHAI_COL = { irani_chai: [new Color('#f1e4cb'), new Color('#b6702d')], filter_coffee: [new Color('#c9a07a'), new Color('#4a2410')] };
const BURNT = new Color('#120b07');

export function stoveGeo() {
  return sharedGeo(`chai:stove:${quality().name}`, () => {
    const { w, d, h } = STOVE;
    const body = place(boxUV(w, h - 0.01, d, 0.5, 0.5), { p: [0, (h - 0.01) / 2, 0] });
    const top = place(boxUV(w + 0.01, 0.012, d + 0.01, 0.5, 0.5, [0.3, 0.1]), { p: [0, h - 0.004, 0] });
    const foot = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => place(boxUV(0.03, 0.012, 0.03, 0.1, 0.1), { p: [sx * (w / 2 - 0.03), -0.0, sz * (d / 2 - 0.03)] })));
    const knob = place(lathe([[0, 0], [0.016, 0.001], [0.018, 0.012], [0.012, 0.02], [0, 0.021]], 10, { sub: 0 }).rotateX(Math.PI / 2), { p: [0.14, 0.036, d / 2 + 0.012] });
    return merge([body, top, ...foot, knob]);
  });
}
export function burnerGeo() {
  return sharedGeo(`chai:burner:${quality().name}`, () => {
    const ring = lathe([[0, 0], [0.075, 0], [0.083, 0.004], [0.085, 0.014], [0.078, 0.02], [0.064, 0.02], [0.05, 0.014], [0.03, 0.014], [0, 0.016]], sg(22), { sub: 0, uv: [2, 2] });
    // pot support: three arms
    const arms = [0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      return place(boxUV(0.012, 0.03, 0.1, 0.1, 0.1), { p: [Math.sin(a) * 0.1, 0.034, Math.cos(a) * 0.1], r: [0, a, 0] });
    });
    return merge([ring, ...arms]);
  });
}
function jarBiscuits() {
  return sharedGeo('chai:jarbiscuits', () => {
    const gs = [];
    for (let i = 0; i < 5; i++) gs.push(place(new CylinderGeometry(0.075, 0.075, 0.02, 14), { p: [Math.sin(i) * 0.004, 0.025 + i * 0.027, Math.cos(i) * 0.004], r: [0, i * 0.7, 0] }));
    return merge(gs);
  });
}
function liquidGeo() {
  return sharedGeo(`chai:liquid:${quality().name}`, () => lathe([[0, 0], [0.0256, 0], [0.0346, 0.0725], [0.0338, 0.0738], [0.006, 0.0733], [0, 0.0732]], sg(18), { sub: 0 }));
}
function frothGeo() {
  return sharedGeo(`chai:froth:${quality().name}`, () => lathe([[0, 0.0016], [0.0334, 0.0013], [0.0344, -0.0004], [0.032, -0.0016], [0, -0.0016]], sg(16), { sub: 0 }));
}
function biscuitGeo() {
  return sharedGeo('chai:biscuits', () => {
    const b = (x, y, z, ry, rz) => {
      const g = new CylinderGeometry(0.047, 0.049, 0.014, 20);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * (1 + (p.getY(i) > 0 ? 0.1 * Math.sin(p.getX(i) * 100) : 0)));
      g.computeVertexNormals();
      return place(g, { p: [x, y, z], r: [0, ry, rz] });
    };
    return merge([b(-0.026, 0.0215, 0.0, 0.2, 0), b(0.03, 0.0285, 0.016, 1.0, 0), b(0.014, 0.058, -0.016, 0.6, 0.5)]);
  });
}

class ChaiSlot {
  constructor(parent, i, x, glassTool) {
    this.i = i;
    this.root = new Group();
    this.root.position.set(x, COUNTER_TOP, SLOT_Z);
    parent.add(this.root);
    this.cur = normSlot(null);
    this.act = null;
    this.now = 0;
    // saucer + glass share their geometry between the two slots (the tool owns it, disposed by the station)
    this.glass = null;
    this.saucer = [];
    for (const c of glassTool.group.children) {
      if (!c.isMesh) continue;
      const m = new Mesh(c.geometry, c.material);
      this.root.add(m);
      if (c.material === TM.glass()) this.glass = m;
      else this.saucer.push(m);
    }
    this.liqMat = new MeshPhysicalMaterial({ color: '#b8742f', roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#5a2a08', emissiveIntensity: 0.22 });
    this.liquid = new Mesh(liquidGeo(), this.liqMat);
    this.liquid.position.y = OY + 0.0115;
    this.liquid.visible = false;
    this.root.add(this.liquid);
    this.froth = new Mesh(frothGeo(), TM.froth());
    this.froth.visible = false;
    this.root.add(this.froth);
    this.bm = createFoodMaterial('powder', { uniforms: foodUniforms('podi', { scale: 14 }) });
    this.bm.uniforms.uA.value.setRGB(0.93, 0.8, 0.5);
    this.bm.uniforms.uB.value.setRGB(0.98, 0.86, 0.56);
    this.bisc = new Mesh(biscuitGeo(), this.bm.mat);
    this.bisc.position.y = 0.0055;
    this.bisc.visible = false;
    this.root.add(this.bisc);
    this.stream = new Mesh(sharedGeo('chai:stream', () => new CylinderGeometry(0.0034, 0.0026, 1, 8, 1, true).translate(0, -0.5, 0)), plainMaterial('chaistream', { color: '#c07a34', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.85, clearcoat: 1, emissive: '#5a2a08', emissiveIntensity: 0.2 }));
    this.stream.visible = false;
    this.root.add(this.stream);
    this.steam = createSteam({ count: 8, rise: 0.24, size: 0.07, speed: 0.4, radius: 0.04, drift: 0.025, opacity: 0.3, seed: 51 + i });
    this.steam.points.position.set(0, OY + 0.09, 0);
    this.root.add(this.steam.points);
    this.smoke = createSteam({ count: 6, rise: 0.35, size: 0.08, speed: 0.3, radius: 0.04, drift: 0.04, color: '#4a4643', opacity: 0.5, seed: 61 + i });
    this.smoke.points.position.set(0, OY + 0.09, 0);
    this.root.add(this.smoke.points);
    this.ring = new ReadyRing(this.root, 0, 0.0185, 0, 0.082);
    this.anchor = new Vector3(x, COUNTER_TOP + 0.13, SLOT_Z);
    this.apply();
  }
  set(info) {
    this.cur = normSlot(info);
    this.apply();
  }
  playAction(kind, t01) {
    const t = clamp01(t01);
    if (kind === 'pour' || kind === 'take') {
      this.act = t >= 1 && kind === 'pour' ? null : { kind, t01: t, stamp: this.now };
      this.apply();
    }
  }
  apply() {
    const { st, dish, progress: p, burnFrac } = this.cur;
    const a = this.act;
    const biscuit = dish === 'osmania';
    const pal = CHAI_COL[dish] || CHAI_COL.irani_chai;
    let fill = st === 'cooking' ? 0.08 + 0.92 * smooth(0, 0.9, p) : st === 'empty' ? 0 : 1;
    if (a && a.kind === 'pour') fill = Math.max(fill, 0.05 + 0.9 * easeOut(a.t01));
    const showLiq = !biscuit && (st !== 'empty' || (a && a.kind === 'pour'));
    if (this.glass) this.glass.visible = !biscuit || st === 'empty';
    this.liquid.visible = showLiq;
    this.liquid.scale.y = Math.max(0.02, fill);
    const col = st === 'burnt' ? BURNT : this.liqMat.color.copy(pal[0]).lerp(pal[1], st === 'cooking' ? smooth(0, 0.8, p) : 1);
    if (st === 'burnt') this.liqMat.color.copy(BURNT);
    this.liqMat.emissiveIntensity = dish === 'filter_coffee' ? 0.12 : 0.22;
    void col;
    this.froth.visible = showLiq && fill > 0.85 && st !== 'burnt';
    this.froth.position.y = OY + 0.0115 + 0.0732 * fill;
    this.bisc.visible = biscuit && st !== 'empty';
    this.bisc.scale.setScalar(st === 'cooking' ? 0.4 + 0.6 * smooth(0, 1, p) : 1);
    this.bm.uniforms.uBurn.value = st === 'burnt' ? 1 : 0;
    const show = a && a.kind === 'pour' && a.t01 < 0.92;
    this.stream.visible = !!show;
    if (show) {
      const top = 0.42;
      this.stream.position.set(0, COUNTER_TOP * 0 + top, 0);
      this.stream.scale.set(1, top - (OY + 0.0115 + 0.0732 * fill), 1);
    }
    if (a && a.kind === 'take') {
      const k = easeOut(a.t01);
      this.root.position.z = SLOT_Z + 0.2 * k;
      this.root.position.y = COUNTER_TOP + 0.04 * k;
      if (a.t01 > 0.97) this.root.visible = false;
    } else {
      this.root.visible = true;
      this.root.position.set(this.anchor.x, COUNTER_TOP, SLOT_Z);
    }
    const q = quality().particles;
    this.steam.setAmount(st === 'ready' || (st === 'cooking' && p > 0.4) ? 0.7 * q : 0);
    this.smoke.setAmount(st === 'burnt' ? 0.9 : 0);
  }
  update(dt, t) {
    this.now = t;
    if (this.act && t - this.act.stamp > 0.9) {
      this.act = null;
      this.apply();
    }
    this.ring.update(t, this.cur.st === 'ready' && !this.act);
  }
  dispose() {
    this.liqMat.dispose();
    this.bm.dispose();
    this.steam.dispose();
    this.smoke.dispose();
    this.ring.dispose();
    this.root.removeFromParent();
  }
}

export function buildChaiSet() {
  const g = new Group();
  g.name = 'chai-set';
  const owned = [];
  // stove + burner + blue flame
  const stoveMat = pbrMaterial('steel-brushed', { rough: 1.1, metal: 1, color: '#9aa2a8', key: 'stove' });
  const stove = new Mesh(stoveGeo(), stoveMat);
  stove.position.set(STOVE.x, COUNTER_TOP, STOVE.z);
  g.add(stove);
  const burner = new Mesh(burnerGeo(), pbrMaterial('iron-dark', { rough: 1, metal: 1, key: 'burner' }));
  burner.position.set(STOVE.x, COUNTER_TOP + STOVE.h, STOVE.z);
  g.add(burner);
  const fm = createFlameMaterial({ jets: 24, seed: 3, alpha: 0.95 });
  owned.push({ dispose: () => fm.dispose() });
  const flame = new Mesh(sharedGeo('chai:flame', () => flameRingGeometry(0.066, 0.05, 28)), fm);
  flame.position.set(STOVE.x, COUNTER_TOP + STOVE.h + 0.014, STOVE.z);
  flame.renderOrder = 4;
  g.add(flame);
  const glowMat = createGlowMaterial('#4a8cff', 0.5);
  owned.push({ dispose: () => glowMat.dispose() });
  const glow = new Mesh(sharedGeo('chai:glow', () => new BufferGeometry().setAttribute('position', new Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5], 3)).setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2)).setIndex([0, 2, 1, 1, 2, 3])), glowMat);
  glow.scale.set(0.34, 1, 0.34);
  glow.position.set(STOVE.x, COUNTER_TOP + STOVE.h + 0.016, STOVE.z);
  glow.renderOrder = 3;
  g.add(glow);
  let light = null;
  if (quality().lights) {
    light = new PointLight('#7aa8ff', 0.5, 1.2, 2);
    light.position.set(STOVE.x, COUNTER_TOP + STOVE.h + 0.07, STOVE.z + 0.05);
    g.add(light);
  }
  // kettle on the stove (spout to the right), steel pot beside it
  const kettle = buildTool('chai-kettle', { lod: 'rest' });
  kettle.group.position.set(STOVE.x, COUNTER_TOP + STOVE.h + 0.034 + kettle.group.userData.baseY, STOVE.z);
  kettle.group.rotation.y = -Math.PI / 2 + 0.25;
  g.add(kettle.group);
  const pot = buildTool('chai-pot', { lod: 'rest' });
  pot.group.position.set(-0.01, COUNTER_TOP + pot.group.userData.baseY, -0.26);
  pot.group.rotation.y = 0.6;
  g.add(pot.group);
  // biscuit jar
  const jar = new Mesh(jarGeo(sg(20)), MAT.glassJar());
  jar.position.set(0.12, COUNTER_TOP, -0.3);
  jar.renderOrder = 2;
  const biscuits = new Mesh(jarBiscuits(), new MeshPhysicalMaterial({ color: '#d9a85a', roughness: 0.8, metalness: 0 }));
  owned.push({ dispose: () => biscuits.material.dispose() });
  biscuits.position.copy(jar.position);
  const lid = new Mesh(jarLidGeo(sg(20)), pbrMaterial('steel-brushed', { rough: 1, metal: 1, key: 'jarlid', color: '#b02a22' }));
  lid.position.copy(jar.position);
  g.add(biscuits, jar, lid);
  // tray of spare glasses
  const tray = new Mesh(trayGeo(sg(20)), pbrMaterial('steel-brushed', { rough: 0.9, metal: 1, key: 'tray' }));
  tray.position.set(0.5, COUNTER_TOP, 0.18);
  g.add(tray);
  const spare = [];
  [[-0.04, -0.025], [0.04, -0.025], [0.0, 0.04]].forEach(([dx, dz]) => {
    const t = buildTool('steel-glass', { saucer: false, fill: 0, drink: 'none', lod: 'rest' });
    t.group.position.set(0.5 + dx, COUNTER_TOP + 0.006, 0.18 + dz);
    g.add(t.group);
    spare.push(t);
  });
  // serving slots
  const glassTool = buildTool('steel-glass', { fill: 0, drink: 'none', lod: 'rest' });
  const slots = SLOT_X.map((x, i) => new ChaiSlot(g, i, x, glassTool));
  const tools = [kettle, pot, ...spare, glassTool];
  let burnerOn = true;
  let flamePower = 1;
  const api = {
    group: g,
    slots,
    anchors: slots.map((s) => s.anchor.clone()),
    tools: { 'chai-kettle': kettle, 'chai-pot': pot },
    update(dt, t) {
      for (const s of slots) s.update(dt, t);
      if (light) light.intensity = burnerOn ? (0.45 + 0.1 * Math.sin(t * 15)) * (0.35 + 0.65 * flamePower) : 0;
    },
    /** The gas ring: the blue flame, its glow and light and the steam of the glasses on or off; `power` 0..1 shortens the flame. */
    setBurner(on, power = 1) {
      burnerOn = !!on;
      flamePower = on ? Math.max(0.05, Math.min(1, power)) : 0;
      flame.visible = burnerOn;
      glow.visible = burnerOn;
      if (light) light.visible = burnerOn;
      fm.uniforms.uPower.value = flamePower;
      for (const s of slots) {
        s.steam.points.visible = burnerOn;
        s.smoke.points.visible = burnerOn;
      }
    },
    dispose() {
      for (const s of slots) s.dispose();
      for (const t of tools) t.dispose();
      for (const o of owned) o.dispose();
      light?.removeFromParent();
      g.removeFromParent();
    },
  };
  return api;
}

export { lpgGeometry };
