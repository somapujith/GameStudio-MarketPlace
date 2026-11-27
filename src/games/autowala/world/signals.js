// OWNER: rules agent. The meshes of the traffic signals (poles, heads, three lamps, a night glow, a camera on some, a traffic cop at
// others). The plan (where, which phase) is pure data in signal-logic.js. Everything is instanced and split by map tile
// (render/chunks.js) so only the junctions near the camera are drawn; the lamp colours are rewritten only when a light changes.
import {
  AdditiveBlending, CircleGeometry, Group, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry,
} from 'three';
import { chunkedInstances } from '../render/chunks.js';
import { approachState } from './signal-logic.js';
import { colorBox, copGeometry, disposeGroup, glowTexture, mergeParts } from './signal-kit.js';

const POLE_H = 4.9;
const HEAD_Y = 4.25;
const LAMP_DY = [0.42, 0, -0.42]; // red, yellow, green from the top
const LAMP_Z = 0.19;
const LAMP_RGB = [[1, 0.1, 0.08], [1, 0.62, 0.05], [0.1, 1, 0.38]];
const TILE = 1024; // m: signals are few and small, and a draw call costs far more than culling saves
const OFF = 0.1; // brightness of an unlit lamp
const BASE_Y = 0.2; // the pavement slab

const rotated = (item, lx, lz) => {
  const s = Math.sin(item.yaw);
  const c = Math.cos(item.yaw);
  return [item.px + lx * c + lz * s, item.pz - lx * s + lz * c];
};

/**
 * Build the signal meshes for `plan` (signal-logic.js createSignalPlan) into `scene`.
 * Returns { group, update(time, night), dispose(), stats }.
 */
export function buildSignals(scene, plan) {
  const group = new Group();
  group.name = 'rules-signals';
  scene.add(group);
  const apps = plan.approaches.map((a) => ({ ...a, yaw: Math.atan2(-a.tx, -a.tz) }));
  if (!apps.length) return { group, update() {}, dispose: () => disposeGroup(group), stats: { approaches: 0 } };

  const grey = [0.16, 0.17, 0.2];
  const headGeo = mergeParts([
    colorBox(0.16, POLE_H, 0.16, 0, POLE_H / 2, 0, [0.22, 0.23, 0.26]),
    colorBox(0.5, 1.4, 0.36, 0, HEAD_Y, 0, grey),
    colorBox(0.62, 0.08, 0.5, 0, HEAD_Y + 0.74, 0.04, grey), // the hood
  ]);
  const body = new MeshLambertMaterial({ vertexColors: true });
  const at = (a) => [a.px, a.pz];
  chunkedInstances(group, headGeo, body, apps, at, (a, o) => {
    o.position.set(a.px, BASE_Y, a.pz);
    o.rotation.y = a.yaw;
  }, { size: TILE });

  // a red-light camera on top of the pole at 'cam' junctions
  const camItems = apps.filter((a) => a.enf === 'cam');
  const camGeo = mergeParts([
    colorBox(0.5, 0.34, 0.7, 0, 0, 0.1, [0.75, 0.76, 0.8]),
    colorBox(0.2, 0.2, 0.12, 0, 0, 0.5, [0.04, 0.04, 0.06]),
    colorBox(0.1, 0.12, 0.1, 0.2, 0.22, 0, [0.9, 0.12, 0.1]),
  ]);
  chunkedInstances(group, camGeo, body, camItems, at, (a, o) => {
    o.position.set(a.px, BASE_Y + POLE_H + 0.15, a.pz);
    o.rotation.y = a.yaw;
  }, { size: TILE });

  // a traffic policeman beside the pole at 'cop' junctions (one per junction, the first approach)
  const seenNode = new Set();
  const copItems = [];
  for (const a of apps) {
    if (a.enf !== 'cop' || seenNode.has(a.nodeId)) continue;
    seenNode.add(a.nodeId);
    // stand just on the junction side of the pole (towards the stop line), facing the approaching traffic
    copItems.push({ ...a, cx: a.px + a.tx * 1.6, cz: a.pz + a.tz * 1.6 });
  }
  const copGeo = copGeometry();
  chunkedInstances(group, copGeo, body, copItems, (a) => [a.cx, a.cz], (a, o) => {
    o.position.set(a.cx, BASE_Y, a.cz);
    o.rotation.y = a.yaw;
  }, { size: TILE });

  // lamps: three per head, plus a glow quad each (additive, only lit lamps at night)
  const lampItems = [];
  for (const a of apps) {
    for (let k = 0; k < 3; k++) {
      const [x, z] = rotated(a, 0, LAMP_Z);
      lampItems.push({ a, k, x, z, y: BASE_Y + HEAD_Y + LAMP_DY[k], mesh: null, glow: null, i: 0 });
    }
  }
  const lampMat = new MeshBasicMaterial({ color: 0xffffff });
  const lampGeo = new CircleGeometry(0.17, 10);
  const lampMeshes = chunkedInstances(
    group, lampGeo, lampMat, lampItems, (l) => [l.x, l.z],
    (l, o, c) => {
      o.position.set(l.x, l.y, l.z);
      o.rotation.y = l.a.yaw;
      c.setRGB(LAMP_RGB[l.k][0] * OFF, LAMP_RGB[l.k][1] * OFF, LAMP_RGB[l.k][2] * OFF);
      return c;
    },
    { size: TILE, receiveShadow: false, onMesh: (mesh, tile) => tile.forEach((l, i) => { l.mesh = mesh; l.i = i; }) },
  );
  const glowTex = glowTexture();
  const glowMat = new MeshBasicMaterial({
    map: glowTex, color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: true,
  });
  const glowGeo = new PlaneGeometry(1.5, 1.5);
  const glowMeshes = chunkedInstances(
    group, glowGeo, glowMat, lampItems, (l) => [l.x, l.z],
    (l, o, c) => {
      const [x, z] = rotated(l.a, 0, LAMP_Z + 0.08);
      o.position.set(x, l.y, z);
      o.rotation.y = l.a.yaw;
      c.setRGB(0, 0, 0);
      return c;
    },
    { size: TILE, receiveShadow: false, onMesh: (mesh, tile) => tile.forEach((l) => { l.glow = mesh; }) },
  );
  for (const m of glowMeshes) m.renderOrder = 3;

  // ---- per frame: rewrite the colours of a head only when its state (or the night level) changed
  const last = new Int8Array(apps.length).fill(-1);
  let lastNight = -1;
  let acc = 1;
  const dirty = new Set();
  const setLamp = (l, lit, nightQ) => {
    const rgb = LAMP_RGB[l.k];
    const day = lit ? 1.15 : OFF;
    const k = lit ? day * (1 + nightQ * 0.9) : day * (1 - nightQ * 0.5);
    const g = lit ? 0.25 + nightQ * 1.1 : 0;
    const lc = l.mesh.instanceColor;
    lc.setXYZ(l.i, rgb[0] * k, rgb[1] * k, rgb[2] * k);
    const gc = l.glow.instanceColor;
    gc.setXYZ(l.i, rgb[0] * g, rgb[1] * g, rgb[2] * g);
    dirty.add(l.mesh);
    dirty.add(l.glow);
  };
  const byApproach = apps.map(() => []);
  for (const l of lampItems) byApproach[l.a.id].push(l);

  function update(dt, time, night) {
    acc += dt;
    if (acc < 0.1) return;
    acc = 0;
    const nq = Math.round(Math.min(1, Math.max(0, night)) * 5);
    const nightChanged = nq !== lastNight;
    lastNight = nq;
    for (let i = 0; i < apps.length; i++) {
      const s = approachState(plan, i, time); // 0 red, 1 yellow, 2 green: the lit lamp from the top (red, yellow, green) is the same index
      if (s === last[i] && !nightChanged) continue;
      last[i] = s;
      const lamps = byApproach[i];
      for (let k = 0; k < 3; k++) setLamp(lamps[k], k === s, nq / 5);
    }
    for (const m of dirty) m.instanceColor.needsUpdate = true;
    dirty.clear();
  }

  return {
    group,
    update,
    dispose: () => disposeGroup(group),
    stats: { approaches: apps.length, lamps: lampItems.length, tiles: lampMeshes.length + glowMeshes.length },
  };
}
