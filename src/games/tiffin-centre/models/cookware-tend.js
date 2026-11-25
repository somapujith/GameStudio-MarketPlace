// Tending the pans (docs/TIFFIN_CENTRE_PLAN.md section 3b): the little implements that appear for the beat of a `tend` action, and the sight gauge of the
// steamer. Tawa: a pad of cotton wrapped round half an onion dipped in oil rubs over the iron. Kadai: a flat steel skimmer sweeps the foam and crumbs
// off the oil. Steamer: a steel jug of water tips into the pots. Each is a small group in station-local space, shown only while its beat runs.
//   buildTendProp('wipe'|'skim'|'water', { y, z }) -> { group, play(t01), hide(), update(dt, t), dispose() }
//   buildWaterGauge() -> { group, set(water01, dry), dispose() }
import { CylinderGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { plainMaterial } from './pbr.js';
import { sharedGeo } from './util.js';
import { easeOut, smooth } from './fx.js';

const steel = () => plainMaterial('tend:steel', { color: '#c9ced2', metalness: 1, roughness: 0.32 });
const cloth = () => plainMaterial('tend:cloth', { color: '#e9dfc8', roughness: 0.95, metalness: 0 });
const onion = () => plainMaterial('tend:onion', { color: '#e8c9a0', roughness: 0.7, metalness: 0 });
const oil = () => plainMaterial('tend:oil', { color: '#8a5a12', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.8 });

const padGeo = () => sharedGeo('tend:pad', () => new CylinderGeometry(0.055, 0.062, 0.03, 14));
const onionGeo = () => sharedGeo('tend:onion', () => new SphereGeometry(0.045, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1));
const skimmerGeo = () => sharedGeo('tend:skimmer', () => new CylinderGeometry(0.075, 0.075, 0.006, 20));
const handleGeo = () => sharedGeo('tend:handle', () => new CylinderGeometry(0.005, 0.005, 0.34, 6).rotateZ(Math.PI / 2));
const jugGeo = () => sharedGeo('tend:jug', () => new CylinderGeometry(0.06, 0.05, 0.14, 16, 1, true));
const streamGeo = () => sharedGeo('tend:stream', () => new CylinderGeometry(0.004, 0.003, 1, 6, 1, true).translate(0, -0.5, 0));

/** `y` = the surface the implement works over (the pan iron, the oil, the pot rims), `z` its centre line; x = 0 is the middle of the pan. */
export function buildTendProp(kind, { y = 0.9, z = 0 } = {}) {
  const group = new Group();
  group.name = `tend-${kind}`;
  group.visible = false;
  let stream = null;
  let streamMat = null;
  let jug = null;
  if (kind === 'wipe') {
    const pad = new Mesh(padGeo(), cloth());
    const half = new Mesh(onionGeo(), onion());
    half.position.y = 0.014;
    const film = new Mesh(sharedGeo('tend:film', () => new CylinderGeometry(0.058, 0.058, 0.004, 14)), oil());
    film.position.y = -0.016;
    pad.add(half, film);
    group.add(pad);
    group.userData.pad = pad;
  } else if (kind === 'skim') {
    const dish = new Mesh(skimmerGeo(), steel());
    const handle = new Mesh(handleGeo(), steel());
    handle.position.set(0.2, 0.025, 0);
    handle.rotation.z = -0.12;
    dish.add(handle);
    group.add(dish);
    group.userData.pad = dish;
  } else {
    jug = new Group();
    const body = new Mesh(jugGeo(), plainMaterial('tend:jugsteel', { color: '#c9ced2', metalness: 1, roughness: 0.32, side: 2 }));
    jug.add(body);
    const bottom = new Mesh(sharedGeo('tend:jugbottom', () => new CylinderGeometry(0.05, 0.05, 0.004, 14).translate(0, -0.07, 0)), steel());
    jug.add(bottom);
    group.add(jug);
    streamMat = new MeshBasicMaterial({ color: '#a9d4ff', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
    stream = new Mesh(streamGeo(), streamMat);
    stream.visible = false;
    stream.scale.set(1, 0.001, 1);
    group.add(stream);
    group.userData.pad = jug;
  }
  let t01 = 1;
  let on = false;
  const api = {
    group,
    kind,
    get active() {
      return on;
    },
    /** One frame of the beat: t01 0..1 (>= 1 ends it). */
    play(t) {
      t01 = t;
      on = t < 1;
      group.visible = on;
      this.pose(t);
    },
    pose(t) {
      const pad = group.userData.pad;
      const fade = smooth(0, 0.14, t) * (1 - smooth(0.86, 1, t));
      if (kind === 'wipe') {
        // three rubbing passes in a widening spiral, the pad pressed flat, then lifted away
        const a = t * Math.PI * 6;
        const r = 0.05 + 0.2 * smooth(0, 0.5, t) * (1 - 0.3 * smooth(0.6, 1, t));
        pad.position.set(Math.cos(a) * r, y + 0.018 + 0.09 * (1 - fade), z + Math.sin(a) * r * 0.85);
        pad.rotation.y = a * 0.5;
      } else if (kind === 'skim') {
        const sweep = Math.sin(t * Math.PI * 2.4);
        pad.position.set(sweep * 0.14, y + 0.012 + 0.1 * (1 - fade), z + Math.sin(t * Math.PI * 1.2) * 0.07);
        pad.rotation.set(0, sweep * 0.25, 0);
      } else {
        // tip the jug over the pots: raised, tilted, held, righted
        const tilt = smooth(0.12, 0.4, t) * (1 - smooth(0.78, 0.95, t));
        pad.position.set(-0.155 + 0.18 * (1 - smooth(0, 0.3, t)) + 0.18 * smooth(0.8, 1, t), y + 0.2 + 0.1 * (1 - fade), z + 0.06);
        pad.rotation.z = -tilt * 1.05;
        const flow = tilt > 0.5 ? 1 : 0;
        stream.visible = !!flow;
        if (flow) {
          const top = y + 0.2 - 0.03 + 0.1 * (1 - fade);
          stream.position.set(-0.155 - 0.06 + 0.0, top, z + 0.06);
          stream.scale.set(1, Math.max(0.01, top - (y + 0.02)), 1);
        }
      }
    },
    hide() {
      on = false;
      t01 = 1;
      group.visible = false;
    },
    update() {},
    dispose() {
      streamMat?.dispose();
      group.removeFromParent();
    },
  };
  void t01;
  void easeOut;
  return api;
}

/** A glass sight tube on the steamer's counter: blue water, amber when it runs low, empty when dry. Station-local; `set(water01, dry)` per change. */
export function buildWaterGauge() {
  const group = new Group();
  group.name = 'water-gauge';
  const glass = new Mesh(sharedGeo('gauge:glass', () => new CylinderGeometry(0.014, 0.014, 0.22, 10, 1, true)), plainMaterial('gauge:glass', { color: '#dff0f4', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35, side: 2, depthWrite: false }));
  group.add(glass);
  const fillMat = new MeshBasicMaterial({ color: '#4aa8ff', toneMapped: false });
  const fill = new Mesh(sharedGeo('gauge:fill', () => new CylinderGeometry(0.0105, 0.0105, 1, 8).translate(0, 0.5, 0)), fillMat);
  fill.position.y = -0.105;
  group.add(fill);
  for (const s of [-1, 1]) {
    const cap = new Mesh(sharedGeo('gauge:cap', () => new CylinderGeometry(0.02, 0.02, 0.012, 10)), steel());
    cap.position.y = s * 0.116;
    group.add(cap);
  }
  const tick = new Mesh(sharedGeo('gauge:tick', () => new CylinderGeometry(0.0014, 0.0014, 0.03, 4).rotateZ(Math.PI / 2)), plainMaterial('gauge:tick', { color: '#c0392b', roughness: 0.6 }));
  tick.position.set(0.02, -0.105 + 0.22 * 0.3, 0); // the "low" mark: 30%
  group.add(tick);
  return {
    group,
    set(water01, dry = false) {
      const w = Math.max(0, Math.min(1, water01));
      fill.scale.y = Math.max(0.0001, 0.21 * w);
      fill.visible = w > 0.005;
      fillMat.color.set(w < 0.3 ? '#ffb02e' : '#4aa8ff');
      void dry;
    },
    dispose() {
      fillMat.dispose();
      group.removeFromParent();
    },
  };
}
