// The dosa life cycle on the tawa: batter puddle -> ladle spiral spread -> lacy golden crisp -> burnt, for every tawa dish
// (plain, masala, ghee podi, set (3 thick discs), pesarattu). One DosaSlot per tawa slot; setSlot() drives the state from the
// engine, playAction() lets the first-person viewmodel drive the pour / spread / oil / flip / fill / take beats.
import { Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { lathe, polarDisc } from './geo.js';
import { hashNoise, num, clamp01 } from './food-util.js';
import { createDosaMaterial, createFoodMaterial, foodUniforms, setPalette } from './shaders/food.js';
import { createSteam } from './shaders/steam.js';
import { ReadyRing, easeOut, smooth } from './fx.js';
import { sharedGeo } from './util.js';
import { quality } from './pbr.js';

export const DOSA_R = 0.122;

/** Normalise engine slot info. */
export function normSlot(info) {
  const st = info && (info.st === 'cooking' || info.st === 'ready' || info.st === 'burnt') ? info.st : 'empty';
  return {
    st,
    dish: info && typeof info.dish === 'string' ? info.dish : null,
    progress: clamp01(num(info && info.progress, 0)),
    burnFrac: clamp01(num(info && info.burnFrac, st === 'burnt' ? 1 : 0)),
    // the operations layer: a dish that came off a dirty or cold pan is 'stuck' (pale, a few crumbs left behind) or 'torn' (pale, split, lopsided)
    flaw: info && (info.flaw === 'stuck' || info.flaw === 'torn') ? info.flaw : '',
  };
}

const tearGeo = () => sharedGeo('dosa:tear', () => new PlaneGeometry(0.06, 0.011).rotateX(-Math.PI / 2));
const crumbGeo = () => sharedGeo('dosa:crumb', () => new PlaneGeometry(0.02, 0.014).rotateX(-Math.PI / 2));
// where the torn gaps and the crumbs left on the iron sit (local to the dosa, metres) and how they are turned
const TEARS = [[-0.03, 0.02, 0.5], [0.035, -0.015, -0.9], [0.0, 0.055, 1.9]];
const CRUMBS = [[0.105, 0.03, 0.4], [-0.09, -0.07, 1.2], [0.02, 0.118, 2.2], [-0.125, 0.02, 0.1]];

const discGeo = () => sharedGeo('dosa:disc', () => polarDisc(DOSA_R, [0.34, 0.6, 0.78, 0.89, 0.955, 1], 32));
const setDiscGeo = () =>
  sharedGeo('dosa:setdisc', () =>
    lathe([[0, 0.0], [0.049, 0.0], [0.055, 0.003, true], [0.0568, 0.012], [0.0545, 0.0195], [0.043, 0.0238], [0.02, 0.0252], [0, 0.0255]], 16, { sub: 0, uv: [1, 1] }),
  );
/** Lumpy potato-masala mound: a squashed icosphere with value-noise displacement. */
export const moundGeo = () =>
  sharedGeo('dosa:mound', () => {
    const g = new IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const n = hashNoise(x * 3.1, y * 3.1, z * 3.1) * 0.5 + hashNoise(x * 7.3 + 5, y * 7.3, z * 7.3) * 0.25;
      const k = 0.82 + n * 0.5;
      p.setXYZ(i, x * k, Math.max(y, -0.08) * k * 0.62, z * k);
    }
    g.computeVertexNormals();
    return g;
  });

const KIND = { dosa: 0, masala_dosa: 1, podi_dosa: 2, pesarattu: 3, set_dosa: 4 };

export class DosaSlot {
  /** parent: Group; (x, y, z) local surface position; spotUniform: tawa material uniform (Vector3) for the oil sheen. */
  constructor(parent, { x, y, z, seed = 0.3, spot = null, ring = true }) {
    this.root = new Group();
    this.root.position.set(x, y, z);
    parent.add(this.root);
    this.x = x;
    this.z = z;
    this.spot = spot; // Vector3 (x, z, strength) living in the tawa shader
    this.cur = normSlot(null);
    this.act = null; // { kind, t01, stamp }
    this.now = 0;
    this.flipped = 0;
    this.pose = new Group(); // flip / take animation moves this
    this.root.add(this.pose);

    this.dm = createDosaMaterial({});
    this.dm.uniforms.uSeed.value = seed;
    this.dm.uniforms.uR.value = DOSA_R;
    this.dosa = new Mesh(discGeo(), this.dm.mat);
    this.dosa.visible = false;
    this.pose.add(this.dosa);

    // set dosa discs and the masala mound are created lazily (first time a slot needs them) to keep idle stations light
    this.sm = null;
    this.setGroup = null;
    this.mm = null;
    this.mound = null;

    this.steam = createSteam({ count: 8, rise: 0.22, size: 0.075, speed: 0.33, radius: 0.12, drift: 0.03, opacity: 0.22, seed: seed * 91 });
    this.steam.points.position.set(0, 0.012, 0);
    this.root.add(this.steam.points);
    this.smoke = createSteam({ count: 8, rise: 0.4, size: 0.1, speed: 0.28, radius: 0.12, drift: 0.05, color: '#4a4643', opacity: 0.55, seed: seed * 53 + 3 });
    this.smoke.points.position.set(0, 0.012, 0);
    this.root.add(this.smoke.points);
    this.ring = ring ? new ReadyRing(this.root, 0, 0.0035, 0, 0.125) : null;
    this.anchor = new Vector3(x, y + 0.016, z);
    this.flawMeshes = null; // the tears and the crumbs, made the first time a flawed dish shows
    this.apply(0);
  }

  /** The torn gaps (children of the pose, so they move with the dosa) and the crumbs it left on the iron (children of the root). */
  ensureFlaw() {
    if (this.flawMeshes) return this.flawMeshes;
    this.flawMat = new MeshBasicMaterial({ color: '#0e0c0a', toneMapped: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.crumbMat = new MeshBasicMaterial({ color: '#3a2412', toneMapped: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const tears = TEARS.map(([x, z, r]) => {
      const m = new Mesh(tearGeo(), this.flawMat);
      m.position.set(x, 0.0042, z);
      m.rotation.y = r;
      m.visible = false;
      this.pose.add(m);
      return m;
    });
    const crumbs = CRUMBS.map(([x, z, r]) => {
      const m = new Mesh(crumbGeo(), this.crumbMat);
      m.position.set(x, 0.0014, z);
      m.rotation.y = r;
      m.visible = false;
      this.root.add(m);
      return m;
    });
    this.flawMeshes = { tears, crumbs };
    return this.flawMeshes;
  }

  ensureSet() {
    if (this.setGroup) return;
    this.sm = createDosaMaterial({ obj: true });
    this.sm.uniforms.uKind.value = 4;
    this.sm.uniforms.uR.value = 0.056;
    setPalette(this.sm.uniforms, 'set');
    this.setGroup = new Group();
    this.pose.add(this.setGroup);
    [[-0.062, 0.05], [0.062, 0.04], [0.0, -0.062]].forEach(([dx, dz], i) => {
      const m = new Mesh(setDiscGeo(), this.sm.mat);
      m.position.set(dx, 0.0006, dz);
      m.rotation.y = i * 2.1;
      this.setGroup.add(m);
    });
  }

  ensureMound() {
    if (this.mound) return;
    this.mm = createFoodMaterial('masala', { uniforms: foodUniforms('masala', { scale: 14, seed: this.dm.uniforms.uSeed.value * 3 }) });
    this.mound = new Mesh(moundGeo(), this.mm.mat);
    this.mound.position.set(0.012, 0.006, 0);
    this.mound.scale.set(0.05, 0.05, 0.036);
    this.pose.add(this.mound);
  }

  set(info) {
    this.cur = normSlot(info);
    if (this.cur.dish === 'set_dosa') this.ensureSet();
    if (this.cur.dish === 'masala_dosa') this.ensureMound();
    this.apply(this.now);
  }

  playAction(kind, t01) {
    const t = clamp01(num(t01, 0));
    if (kind === 'take' || kind === 'flip' || kind === 'pour' || kind === 'spread' || kind === 'oil' || kind === 'fill') {
      this.act = t >= 1 && kind !== 'take' ? null : { kind, t01: t, stamp: this.now };
      if (kind === 'flip' && t >= 1) this.flipped = this.flipped ? 0 : 1;
      this.apply(this.now);
    }
  }

  /** Writes every uniform / visibility from the current state and action. */
  apply(t) {
    const { st, dish, progress: p, burnFrac } = this.cur;
    const a = this.act;
    const u = this.dm.uniforms;
    const kind = KIND[dish] ?? 0;
    const forced = a && (a.kind === 'pour' || a.kind === 'spread');
    const vis = st !== 'empty' || forced;
    const pp = forced ? (a.kind === 'pour' ? 0 : 0.05) : st === 'cooking' ? p : 1;
    // cook / burn mapping: cooking 0..0.84, ready 0.84 -> 0.97 (burnFrac), burnt 1.15
    let cook = st === 'cooking' ? p * 0.84 : st === 'ready' ? 0.84 + 0.13 * burnFrac : st === 'burnt' ? 1.15 : 0;
    if (forced) cook = 0;
    // a flawed dosa never crisps and browns: it stays pale, the torn one worst
    const fl = st === 'empty' || st === 'burnt' ? '' : this.cur.flaw;
    if (fl) cook *= fl === 'torn' ? 0.74 : 0.88;
    let spread = st === 'cooking' ? 0.3 + 0.7 * smooth(0, 0.12, p) : 1;
    let ridge = 1 - smooth(0.1, 0.7, pp) * 0.6;
    if (a && a.kind === 'pour') {
      spread = 0.1 + 0.2 * easeOut(a.t01);
      ridge = 0;
    } else if (a && a.kind === 'spread') {
      spread = 0.3 + 0.7 * easeOut(a.t01);
      ridge = 1;
    }
    const set = dish === 'set_dosa';
    if (fl || this.flawMeshes) {
      const fm = this.ensureFlaw();
      const showTear = fl === 'torn' && vis && !set && st !== 'cooking';
      fm.tears.forEach((m, i) => { m.visible = showTear && (i < 2 || st === 'ready'); });
      const nCrumb = fl === 'torn' ? 4 : fl === 'stuck' ? 2 : 0;
      fm.crumbs.forEach((m, i) => { m.visible = vis && i < nCrumb && st !== 'cooking'; });
      this.dosa.scale.set(fl === 'torn' ? 1.1 : 1, 1, fl === 'torn' ? 0.82 : 1);
    }
    this.dosa.visible = vis && !set;
    if (this.setGroup) this.setGroup.visible = vis && set;
    u.uCook.value = cook;
    u.uBurn.value = st === 'burnt' ? 1 : st === 'ready' ? smooth(0.55, 1, burnFrac) * 0.25 : 0;
    u.uSpread.value = spread;
    u.uRidge.value = ridge;
    u.uKind.value = kind;
    setPalette(u, kind === 3 ? 'pesarattu' : 'plain');
    u.uPodi.value = kind === 2 && st !== 'empty' ? (st === 'cooking' ? smooth(0.5, 0.68, p) : 1) : 0;
    u.uSizzle.value = st === 'cooking' ? 1 - smooth(0, 0.4, p) : a && a.kind === 'pour' ? 1 : 0;
    u.uLift.value = st === 'cooking' ? 0.011 * smooth(0.5, 0.97, p) : st === 'ready' ? 0.011 + 0.005 * burnFrac : st === 'burnt' ? 0.022 : 0;
    u.uFlipped.value = this.flipped;
    const oil = a && a.kind === 'oil' ? Math.sin(Math.PI * a.t01) : 0;
    u.uOil.value = oil;
    // the set dosa discs
    if (this.sm) {
      const su = this.sm.uniforms;
      su.uCook.value = st === 'burnt' ? 1.05 : st === 'cooking' ? 0.1 + p * 0.5 : st === 'ready' ? 0.6 + 0.2 * burnFrac : 0.1;
      su.uBurn.value = st === 'burnt' ? 1 : 0;
    }
    // masala mound (a 'fill' beat on a masala dosa creates it on demand)
    if (kind === 1 && a && a.kind === 'fill') this.ensureMound();
    if (this.mound) {
      const wantMound = kind === 1 && (st === 'ready' || (st === 'cooking' && p > 0.6) || (a && a.kind === 'fill'));
      this.mound.visible = !!wantMound && vis;
      const grow = a && a.kind === 'fill' ? easeOut(a.t01) : 1;
      this.mound.scale.set(0.05 * grow, 0.05 * grow, 0.036 * grow);
      this.mm.uniforms.uBurn.value = st === 'burnt' ? 1 : 0;
    }
    // oil sheen + spot under the dosa on the tawa
    if (this.spot) this.spot.set(this.x, this.z, vis ? (st === 'cooking' || st === 'ready' ? 0.55 : 0.25) + oil * 0.4 : oil * 0.5);
    // pose: flip arcs, take slides away
    this.pose.position.set(0, 0, 0);
    this.pose.rotation.set(0, 0, 0);
    this.pose.scale.set(1, 1, 1);
    if (a && a.kind === 'flip') {
      const k = easeOut(a.t01);
      this.pose.position.y = Math.sin(Math.PI * a.t01) * 0.09;
      this.pose.rotation.x = Math.PI * k;
      u.uFlipped.value = a.t01 > 0.5 ? 1 - this.flipped : this.flipped;
    }
    if (a && a.kind === 'take') {
      const k = easeOut(a.t01);
      this.pose.position.set(0, 0.12 * k, 0.16 * k);
      this.pose.rotation.x = -0.4 * k;
      this.dosa.visible = this.dosa.visible && a.t01 < 0.98;
      if (this.setGroup) this.setGroup.visible = this.setGroup.visible && a.t01 < 0.98;
      if (this.mound) this.mound.visible = this.mound.visible && a.t01 < 0.98;
    }
    // particles
    const q = quality().particles;
    this.steam.setAmount(st === 'cooking' || st === 'ready' ? (st === 'cooking' ? 0.3 + 0.7 * smooth(0, 0.25, p) : 0.55 * (1 - burnFrac * 0.4)) * q : forced ? 0.4 * q : 0);
    this.smoke.setAmount(st === 'burnt' ? 0.9 : st === 'ready' ? smooth(0.7, 1, burnFrac) * 0.5 : 0);
  }

  update(dt, t) {
    this.now = t;
    if (this.act && t - this.act.stamp > 0.9) {
      this.act = null;
      this.apply(t);
    }
    if (this.ring) this.ring.update(t, this.cur.st === 'ready' && !this.act);
  }

  dispose() {
    this.flawMat?.dispose();
    this.crumbMat?.dispose();
    this.dm.dispose();
    this.sm?.dispose();
    this.mm?.dispose();
    this.steam.dispose();
    this.smoke.dispose();
    this.ring?.dispose();
    this.root.removeFromParent();
  }
}
