// OWNER: metro agent. The Hyderabad Metro: elevated lines on pillars, stations, trains. See ARCHITECTURE.md.
//   Red Line (Miyapur - LB Nagar), Blue Line (Nagole - Raidurg), Green Line (JBS - MG Bus Station); Ameerpet is a two-level
//   interchange (Blue above Red), MG Bus Station joins Red and Green.
// The route planning, pillar placement, timetable and geometry live in world/metro-*.js (pure parts are unit-tested).
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three';
import { LINE_COLORS, LINE_ORDER } from './metro-names.js';
import { planMetro, stairSlots } from './metro-routes.js';
import { BENT, planBents } from './metro-pillars.js';
import { DECK, HEAD_H, beamGeometry, capGeometry, carGeometry, deckGeometry, pillarGeometry } from './metro-geo.js';
import { groupByChunk } from '../render/chunks.js';
import { buildStationMeshes } from './metro-station.js';
import { buildSignAtlas } from './metro-signs.js';
import { metroMaterial } from './metro-material.js';
import { TRAIN, buildSchedule, carOffsets, trainState } from './metro-trains.js';
import { pointAt } from './metro-track.js';
import { canvasTexture } from '../render/textures.js';

const TILE = 768; // map tile for the instanced viaduct: the whole line is ~90k triangles, a draw call costs far more than culling saves
const NEAR = 520; // trains farther than this from the focus are not animated
const TRAINS_PER_LINE = { red: 3, blue: 3, green: 2 };

/** Write a Y-yaw * X-pitch rotation, a translation and a z scale into a column-major 4x4 at `o`. */
function writeMatrix(a, o, x, y, z, yaw, pitch, sz = 1) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const al = -pitch;
  const ca = Math.cos(al);
  const sa = Math.sin(al);
  a[o] = cy;
  a[o + 1] = 0;
  a[o + 2] = -sy;
  a[o + 3] = 0;
  a[o + 4] = sy * sa;
  a[o + 5] = ca;
  a[o + 6] = cy * sa;
  a[o + 7] = 0;
  a[o + 8] = sy * ca * sz;
  a[o + 9] = -sa * sz;
  a[o + 10] = cy * ca * sz;
  a[o + 11] = 0;
  a[o + 12] = x;
  a[o + 13] = y;
  a[o + 14] = z;
  a[o + 15] = 1;
}

const EMPTY = { lines: [], stations: [], update() {}, dispose() {} };

export function buildMetro(scene, city, colliders, shared, sky) {
  let plan;
  try {
    plan = planMetro(city);
  } catch (e) {
    console.warn('[autowala] metro: could not plan the lines for this city:', e.message);
    return { ...EMPTY };
  }
  const group = new Group();
  group.name = 'metro';
  scene.add(group);
  const disposables = [];
  const glowU = { value: 0.07 };
  const col = new Color();

  const lines = plan.lines;
  const isBlocked = (x, z, r) => !!colliders.inside(x, z, r);
  const { bents, pillars } = planBents(city, plan.graph, lines, isBlocked);

  // ---------------------------------------------------------------- deck (tiled by map region so culling bites)
  const deckMat = metroMaterial(glowU, { key: 'deck', roughness: 0.9 });
  const deckGeo = deckGeometry();
  const segs = [];
  const ends = [];
  for (const ln of lines) {
    const sm = ln.track.samples;
    for (let i = 0; i < sm.length - 1; i++) {
      const a = sm[i];
      const b = sm[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      // turning at either end -> lengthen the segment so the outside of the bend stays closed (mitre)
      const yaw = Math.atan2(dx, dz);
      let turn = 0;
      const pa = sm[i - 1];
      const nb = sm[i + 2];
      if (pa && Math.hypot(a.x - pa.x, a.z - pa.z) > 0.2) turn = Math.max(turn, Math.abs(wrap(yaw - Math.atan2(a.x - pa.x, a.z - pa.z))));
      if (nb && Math.hypot(nb.x - b.x, nb.z - b.z) > 0.2) turn = Math.max(turn, Math.abs(wrap(Math.atan2(nb.x - b.x, nb.z - b.z) - yaw)));
      const ext = Math.min(1.6, DECK.halfWidth * Math.tan(turn / 2)) + 0.04;
      const s = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, yaw, pitch: Math.atan2(b.y - a.y, len), len: len + ext * 2, color: ln.color };
      segs.push(s);
      if (i === 0) ends.push({ x: a.x, y: a.y, z: a.z, yaw: yaw + Math.PI });
      if (i === sm.length - 2) ends.push({ x: b.x, y: b.y, z: b.z, yaw });
    }
  }
  const tiled = (geo, mat, items, fill, { shadow = false, tinted = false, size = TILE } = {}) => {
    const out = [];
    for (const tile of groupByChunk(items, (it) => [it.x, it.z], size).values()) {
      const mesh = new InstancedMesh(geo, mat, tile.length);
      tile.forEach((it, i) => {
        fill(mesh.instanceMatrix.array, i * 16, it);
        if (tinted) mesh.setColorAt(i, col.set(it.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      out.push(mesh);
    }
    return out;
  };
  const deckMeshes = tiled(deckGeo, deckMat, segs, (a, o, s) => writeMatrix(a, o, s.x, s.y, s.z, s.yaw, s.pitch, s.len), { shadow: true, tinted: true });
  const capMeshes = tiled(capGeometry(), deckMat, ends, (a, o, e) => writeMatrix(a, o, e.x, e.y, e.z, e.yaw, 0, 1), { size: 100000 });
  deckMeshes.forEach((m) => (m.name = 'metro-deck'));

  // ---------------------------------------------------------------- pillars (shaft + flared head in one mesh) and cross-beams
  const concMat = metroMaterial(glowU, { key: 'pillar', roughness: 0.92, headFix: true });
  const beamMat = metroMaterial(glowU, { key: 'beam', roughness: 0.92 });
  const pillarGeo = pillarGeometry();
  const beamGeo = beamGeometry();
  for (const p of pillars) colliders.addCentered(p.x, p.z, BENT.radius * 2 + 0.2, BENT.radius * 2 + 0.2, 'pillar', 12);
  const pillarMeshes = tiled(
    pillarGeo,
    concMat,
    pillars,
    (a, o, p) => {
      writeMatrix(a, o, p.x, 0, p.z, 0, 0, 1);
      a[o + 5] = Math.max(0.5, p.h - HEAD_H + 0.05); // scale y: the shaft height
    },
    { shadow: true },
  );
  const beamMeshes = tiled(
    beamGeo,
    beamMat,
    bents,
    (a, o, b) => {
      writeMatrix(a, o, b.x, b.y - BENT.deckDepth, b.z, Math.atan2(b.tx, b.tz), 0, 1);
      const span = 2 * b.half + 1.9;
      a[o] *= span; // scale x
      a[o + 2] *= span;
    },
    { shadow: true },
  );
  pillarMeshes.forEach((m) => (m.name = 'metro-pillars'));
  beamMeshes.forEach((m) => (m.name = 'metro-beams'));

  // ---------------------------------------------------------------- stations
  const stationList = [];
  for (const ln of lines) for (const st of ln.stations) stationList.push({ ...st, color: ln.color });
  const atlas = buildSignAtlas(stationList.map((s) => ({ id: s.id, name: s.name, te: s.te, color: s.color })), LINE_COLORS);
  const roundelUv = Object.fromEntries(LINE_ORDER.map((id) => [id, atlas.roundel(id)]));
  // group the stations: a stacked interchange is one building with two platform levels
  const lineById = Object.fromEntries(lines.map((l) => [l.id, l]));
  const used = new Set();
  const groups = [];
  for (const st of stationList) {
    if (used.has(st.id)) continue;
    used.add(st.id);
    const twin = stationList.find((o) => !used.has(o.id) && o.name === st.name && Math.hypot(o.x - st.x, o.z - st.z) < 6);
    const members = [st];
    if (twin) {
      used.add(twin.id);
      members.push(twin);
    }
    members.sort((a, b) => a.y - b.y);
    const low = members[0];
    const track = lineById[low.line].track;
    groups.push({
      x: low.x,
      z: low.z,
      tx: low.tx,
      tz: low.tz,
      w: low.w,
      slots: stairSlots(plan.graph, track, low.s, low.w),
      roundelUv,
      levels: members.map((m) => ({ y: m.y, color: m.color, line: m.line, boardUv: atlas.board(m.id) })),
    });
  }
  const sm = buildStationMeshes(groups);
  const solidGeo = sm.solid.build();
  const glassGeo = sm.glass.build();
  const signGeo = sm.signs.build({ withUv: true });
  const poolGeo = sm.pools.build({ withUv: true });
  const solidMesh = new Mesh(solidGeo, metroMaterial(glowU, { key: 'station', roughness: 0.8, metalness: 0.1 }));
  solidMesh.castShadow = false;
  solidMesh.receiveShadow = true;
  solidMesh.name = 'metro-stations';
  const glassMesh = new Mesh(
    glassGeo,
    new MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.34, roughness: 0.06, metalness: 0.15, side: DoubleSide, depthWrite: false }),
  );
  glassMesh.name = 'metro-glass';
  const signMat = new MeshBasicMaterial({ map: atlas.texture, side: DoubleSide, alphaTest: 0.5 });
  const signMesh = new Mesh(signGeo, signMat);
  signMesh.name = 'metro-signs';
  const poolTex = canvasTexture(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.3)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }, { anisotropy: 1 });
  const poolMat = new MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color: new Color('#ff9a4a') });
  const poolMesh = new Mesh(poolGeo, poolMat);
  poolMesh.name = 'metro-pools';
  poolMesh.renderOrder = 1;
  for (const m of [solidMesh, glassMesh, signMesh, poolMesh]) group.add(m);
  for (const c of sm.colliders) colliders.addCentered(c.x, c.z, c.w, c.d, 'metro', 9);

  // ---------------------------------------------------------------- trains
  const carMat = metroMaterial(glowU, { key: 'train', doors: true, roughness: 0.38, metalness: 0.35 });
  const kinds = ['head', 'mid', 'tail'];
  const trains = [];
  for (const ln of lines) {
    const sched = buildSchedule(ln.stations.map((s) => s.s));
    const n = TRAINS_PER_LINE[ln.id] || 2;
    for (let k = 0; k < n; k++) trains.push({ line: ln, sched, phase: (k * sched.cycle) / n + ln.id.length * 7, state: {}, idx: trains.length });
  }
  const nT = trains.length;
  const carMeshes = kinds.map((kind) => {
    const geo = carGeometry(kind);
    const open = new InstancedBufferAttribute(new Float32Array(nT), 1);
    geo.setAttribute('aOpen', open);
    const mesh = new InstancedMesh(geo, carMat, Math.max(1, nT));
    mesh.count = nT;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = `metro-cars-${kind}`;
    group.add(mesh);
    return { mesh, open };
  });
  trains.forEach((t) => {
    for (const cm of carMeshes) cm.mesh.setColorAt(t.idx, col.set(t.line.color));
  });
  for (const cm of carMeshes) if (cm.mesh.instanceColor) cm.mesh.instanceColor.needsUpdate = true;
  const offs = carOffsets(TRAIN.cars);
  const pose = {};

  /** Poses of every train (cheap); the car matrices are only written for trains within NEAR of the focus {x, z}. */
  function placeTrains(time, focus) {
    let dirty = false;
    for (const t of trains) {
      const st = trainState(t.sched, time, t.phase, t.state);
      const track = t.line.track;
      if (focus) {
        pointAt(track, st.s, pose);
        const dx = pose.x - focus.x;
        const dz = pose.z - focus.z;
        const tp0 = trainPoses[t.idx];
        tp0.x = pose.x;
        tp0.y = pose.y;
        tp0.z = pose.z;
        tp0.speed = st.v;
        tp0.stop = st.stop;
        tp0.dwelling = st.dwelling;
        if (dx * dx + dz * dz > NEAR * NEAR) continue;
      }
      dirty = true;
      const lat = st.dir > 0 ? TRAIN.lane : -TRAIN.lane;
      for (let c = 0; c < 3; c++) {
        const sc = Math.max(0, Math.min(track.length, st.s + st.dir * offs[c]));
        pointAt(track, sc, pose);
        const lx = pose.tz;
        const lz = -pose.tx;
        let yaw = Math.atan2(pose.tx, pose.tz);
        if (st.dir < 0) yaw += Math.PI;
        if (c === 2) yaw += Math.PI; // the tail car faces backwards
        const pitch = st.dir > 0 ? pose.pitch : -pose.pitch;
        const cm = carMeshes[c];
        writeMatrix(cm.mesh.instanceMatrix.array, t.idx * 16, pose.x + lx * lat, pose.y + 0.24, pose.z + lz * lat, yaw, c === 2 ? -pitch : pitch, 1);
        cm.open.array[t.idx] = st.dwelling;
        if (c === 1) {
          const tp = trainPoses[t.idx];
          tp.x = pose.x + lx * lat;
          tp.y = pose.y;
          tp.z = pose.z + lz * lat;
          tp.speed = st.v;
          tp.stop = st.stop;
          tp.dwelling = st.dwelling;
        }
      }
    }
    if (!dirty) return;
    for (const cm of carMeshes) {
      cm.mesh.instanceMatrix.needsUpdate = true;
      cm.open.needsUpdate = true;
    }
  }
  /** Live train poses (read-only for others: audio, minimap): { line, x, y, z, speed, stop, dwelling } of each train centre. */
  const trainPoses = trains.map((t) => ({ line: t.line.id, x: 0, y: 0, z: 0, speed: 0, stop: -1, dwelling: 0 }));
  placeTrains(0);

  // ---------------------------------------------------------------- registry
  const registryStations = [];
  for (const ln of lines) {
    for (const st of ln.stations) {
      registryStations.push({ id: st.id, name: st.name, te: st.te, line: st.line, interchange: st.interchange, x: st.x, z: st.z, front: st.front, y: st.y });
    }
  }
  const registryLines = lines.map((ln) => ({
    id: ln.id,
    name: ln.name,
    te: ln.te,
    color: ln.color,
    points: ln.track.samples.map((p) => ({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 })),
    stations: ln.stations.map((s) => s.id),
    length: ln.track.length,
  }));

  let lastNight = -1;
  /** `focus` ({x, z}: the player or the camera) is optional; with it, trains farther than ~500 m are not animated. */
  function update(dt, time, night, focus) {
    if (night !== lastNight) {
      lastNight = night;
      glowU.value = 0.07 + night * 1.15;
      signMat.color.setScalar(0.8 + 0.32 * night);
      poolMat.opacity = night * 0.5;
    }
    placeTrains(time, focus);
  }

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    atlas.dispose();
    poolTex.dispose();
    for (const d of disposables) d.dispose?.();
  }

  return { lines: registryLines, stations: registryStations, interchanges: plan.interchanges, trains: trainPoses, update, dispose, plan, group };
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
