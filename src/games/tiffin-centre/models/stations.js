// Station props: tawa, idly steamer, kadai, chai counter, rebuilt with real-life cookware (see cookware-*.js) and procedural PBR.
//
// Contract (plan section 5, unchanged): buildStationProp(kindId) -> { group, kind, slotAnchors, setSlot(i, {st, dish, progress, burnFrac?}),
// update(dt, t), slotWorld(i, out), dispose() }.   NEW hooks for the first-person viewmodel:
//   playAction(slotIndex, kind: 'pour'|'spread'|'flip'|'oil'|'fill'|'take'|'lid'|'skim', t01)   one beat of an action; t01 = 0..1.
//       Each station honours the beats that make sense for it (tawa: pour spread oil flip fill take; steamer: lid take; kadai: skim take fill;
//       chai: pour take); t01 >= 1 ends the beat (take stays applied until the next setSlot). A beat that is not refreshed for 0.9 s lapses.
//   tools: { [id]: { group, grip, tip, set } }  the resting tool props on the station (ladle, spatula, oil-bottle, ...);
//   setToolHeld(id, held)  hides / shows the resting copy while the viewmodel holds its own.
//   setQuality('low'|'medium'|'high')  (global for the food / cookware models; applies live to existing materials)
// Station-local space: origin = floor centre of the 1.3 m wide station, +z faces the cook, counter top at COUNTER_TOP.
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { STATION_KINDS } from '../../../../shared/tiffin-centre/catalog.js';
import { disposeObject, num, sharedGeo } from './util.js';
import { LABEL_STYLES, labelTexture } from './textures.js';
import { clock } from './shaders/patch.js';
import { getQuality, pbrMaterial, plainMaterial, quality, setQuality as setQualityGlobal } from './pbr.js';
import { COUNTER_TOP, TAWA_Z, buildTawaSet, lpgGeometry } from './cookware-tawa.js';
import { buildSteamerSet } from './cookware-steamer.js';
import { buildKadaiSet } from './cookware-kadai.js';
import { buildChaiSet } from './cookware-chai.js';
import { buildPrepSet } from './cookware-prep.js';
import { MAT, bucketGeo, bucketLidGeo, counterPack, drumGeo, plateStackGeo } from './cookware-props.js';
import { buildTool } from './tools.js';

export { COUNTER_TOP };
export const STATION_WIDTH = 1.3;

const ACCENT = { tawa: '#e0392b', steamer: '#12908e', kadai: '#ff8a1f', chai: '#2f9e5b', prep: '#8a6cc0' };
const sg = (n) => Math.max(12, Math.round(n * quality().segScale));

function addCounter(group, kind) {
  const pack = counterPack(ACCENT[kind] || ACCENT.tawa);
  group.add(new Mesh(pack.body, MAT.counterBody()));
  group.add(new Mesh(pack.top, MAT.counterTop()));
  group.add(new Mesh(pack.plinth, MAT.plinth()));
  group.add(new Mesh(pack.stripe, MAT.vc()));
  const lpg = new Mesh(lpgGeometry(), plainMaterial('lpgvc', { vertexColors: true, roughness: 0.42, metalness: 0.45, clearcoat: 0.5 }));
  lpg.position.set(-0.58, 0, -0.62);
  group.add(lpg);
}

function place(obj, x, y, z, ry = 0, rx = 0, rz = 0) {
  obj.position.set(x, y, z);
  obj.rotation.set(rx, ry, rz);
  return obj;
}

/** Resting tools (kept so the viewmodel can hide the copy it picks up). Placed where the cook can see them: the counter strips beside the chulha. */
function addTawaProps(group, tools) {
  const bucket = new Mesh(bucketGeo(sg(18)), MAT.bucket());
  place(bucket, -0.575, COUNTER_TOP, -0.08);
  bucket.scale.setScalar(0.58);
  const lid = new Mesh(bucketLidGeo(sg(18)), MAT.bucketLid());
  place(lid, -0.575, COUNTER_TOP, -0.08, 0, 0.0, 0.0);
  lid.scale.setScalar(0.58);
  lid.position.x -= 0.0;
  lid.visible = false; // lid off: the batter is open and the ladle is in it
  group.add(bucket);
  group.add(lid);
  // the ladle rests with its bowl in the batter, the handle leaning on the rim towards the cook
  const ladle = buildTool('ladle', { lod: 'rest' });
  place(ladle.group, -0.575, COUNTER_TOP + 0.1, -0.08);
  ladle.group.rotation.set(0.0, -0.2, 0.0);
  ladle.group.rotation.x = 0.55;
  group.add(ladle.group);
  tools.ladle = ladle;
  const bottle = buildTool('oil-bottle', { lod: 'rest' });
  place(bottle.group, 0.585, COUNTER_TOP + 0.07, -0.18, 0.4, Math.PI / 2);
  group.add(bottle.group);
  tools['oil-bottle'] = bottle;
  const spatula = buildTool('spatula', { lod: 'rest' });
  place(spatula.group, 0.585, COUNTER_TOP + 0.052, 0.12, 0.08);
  group.add(spatula.group);
  tools.spatula = spatula;
}
function addSteamerProps(group, tools) {
  const plates = new Mesh(plateStackGeo(4, sg(20)), pbrMaterial('steel-brushed', { rough: 0.9, metal: 1, key: 'prop-plates', aniso: 0.3 }));
  place(plates, -0.5, COUNTER_TOP, -0.3);
  group.add(plates);
  const drum = new Mesh(drumGeo(sg(20)), pbrMaterial('aluminium', { rough: 1, metal: 1, key: 'prop-alu' }));
  place(drum, 0.5, COUNTER_TOP, -0.28);
  group.add(drum);
}
function addKadaiProps(group, tools) {
  const jhara = buildTool('jhara', { lod: 'rest' });
  place(jhara.group, 0.5, COUNTER_TOP + 0.052, 0.14, 0.9);
  group.add(jhara.group);
  tools.jhara = jhara;
  const tongs = buildTool('tongs', { lod: 'rest' });
  place(tongs.group, -0.5, COUNTER_TOP + 0.01, 0.2, -0.3);
  group.add(tongs.group);
  tools.tongs = tongs;
  const plates = new Mesh(plateStackGeo(4, sg(22)), pbrMaterial('steel-brushed', { rough: 0.9, metal: 1, key: 'prop-plates', aniso: 0.3 }));
  place(plates, 0.5, COUNTER_TOP, -0.3);
  group.add(plates);
}

const SETS = { tawa: buildTawaSet, steamer: buildSteamerSet, kadai: buildKadaiSet, chai: buildChaiSet, prep: buildPrepSet };

/** buildStationProp(kindId) -> { group, kind, slotAnchors, setSlot, playAction, update, slotWorld, tools, setToolHeld, setQuality, dispose } */
export function buildStationProp(kindId) {
  const def = STATION_KINDS[kindId];
  const kind = def ? kindId : 'tawa';
  const group = new Group();
  group.name = `station-${kind}`;
  group.userData.kind = kind;
  addCounter(group, kind);
  const set = SETS[kind]();
  group.add(set.group);
  const tools = {};
  if (kind === 'tawa') addTawaProps(group, tools);
  else if (kind === 'steamer') addSteamerProps(group, tools);
  else if (kind === 'kadai') addKadaiProps(group, tools);
  else if (set.tools) Object.assign(tools, set.tools);

  // enamel / tin label plate with the Telugu name, tilted towards the cook
  const labelTex = labelTexture({ te: def ? def.te : '', en: def ? def.name : kind, style: LABEL_STYLES[kind] });
  const labelMat = new MeshBasicMaterial({ map: labelTex, toneMapped: false });
  const label = new Mesh(sharedGeo('station:label', () => new PlaneGeometry(0.92, 0.23)), labelMat);
  label.position.set(0, 0.42, 0.4585);
  label.rotation.x = -0.42;
  const frameMat = pbrMaterial('steel-brushed', { rough: 1, metal: 1, key: 'labelframe', color: '#3a3d40' });
  const frame = new Mesh(sharedGeo('station:labelFrame', () => new PlaneGeometry(0.97, 0.275)), frameMat);
  frame.position.set(0, 0.42, 0.455);
  frame.rotation.x = -0.42;
  group.add(frame, label);
  // the counter body is 0.45 deep: keep the plates just off its face
  label.position.z = 0.4745;
  frame.position.z = 0.471;

  const slotAnchors = set.anchors;
  let disposed = false;
  const prop = {
    group,
    kind,
    slotAnchors,
    tools,
    setSlot(i, info) {
      const s = set.slots[i];
      if (!s || disposed) return;
      s.set(info);
    },
    playAction(i, actionKind, t01) {
      const s = set.slots[i];
      if (!s || disposed || !s.playAction) return;
      s.playAction(String(actionKind), num(t01, 0));
    },
    update(dt, t) {
      if (disposed) return;
      const tt = num(t, 0);
      clock.uTime.value = tt;
      set.update(num(dt, 0.016), tt);
    },
    setToolHeld(id, held) {
      const t = tools[id];
      if (t) t.group.visible = !held;
    },
    setQuality(q) {
      return setQualityGlobal(q);
    },
    getQuality,
    /** World position of slot i's anchor (pass `out` to avoid allocation). */
    slotWorld(i, out = new Vector3()) {
      const a = slotAnchors[i];
      if (!a) return out.set(0, 0, 0);
      group.updateWorldMatrix(true, false);
      return out.copy(a).applyMatrix4(group.matrixWorld);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      set.dispose();
      for (const t of Object.values(tools)) if (!set.tools || !Object.values(set.tools).includes(t)) t.dispose?.();
      labelTex.dispose();
      labelMat.dispose();
      disposeObject(group);
    },
  };
  for (const s of set.slots) s.set(null);
  prop.update(0.016, 0);
  return prop;
}

export { TAWA_Z };
