// OWNER: rules agent. The look of the rules: speed limit / camera / school / police-check signs (one 512 px atlas), speed cameras on
// poles, night checkpoints (barricades, cones, a policeman and a flashing beacon per direction) and the camera flash. Everything is
// instanced and split by map tile (render/chunks.js); the checkpoint set only shows at night.
import {
  AdditiveBlending, BoxGeometry, CanvasTexture, ConeGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chunkedInstances } from '../render/chunks.js';
import { colorBox, copGeometry, disposeGroup, glowTexture, mergeParts, tint } from '../world/signal-kit.js';
import { RULES } from './rule-logic.js';
import { edgePoint } from './rule-sites.js';

export const CELL = { 20: 0, 40: 1, 60: 2, camera: 3, school: 4, police: 5, plain: 6 };
const BASE_Y = 0.2; // the pavement slab
const TILE = 512; // m: few small things, so big tiles keep the draw calls down while still being culled

// ------------------------------------------------------------------------------------------------ the sign atlas
function drawAtlas() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  const cell = (i) => ({ x: (i % 4) * 128, y: Math.floor(i / 4) * 128 });
  g.fillStyle = '#6b6f78';
  g.fillRect(0, 0, 512, 256);
  const limit = (i, n) => {
    const { x, y } = cell(i);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x + 64, y + 64, 60, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#d4101c';
    g.lineWidth = 11;
    g.beginPath();
    g.arc(x + 64, y + 64, 54, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#101018';
    g.font = 'bold 58px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), x + 64, y + 68);
  };
  limit(CELL[20], 20);
  limit(CELL[40], 40);
  limit(CELL[60], 60);
  // speed camera: a yellow warning triangle-ish plate with a camera glyph
  {
    const { x, y } = cell(CELL.camera);
    g.fillStyle = '#ffd21a';
    g.fillRect(x + 6, y + 6, 116, 116);
    g.strokeStyle = '#101018';
    g.lineWidth = 6;
    g.strokeRect(x + 10, y + 10, 108, 108);
    g.fillStyle = '#101018';
    g.fillRect(x + 28, y + 44, 72, 42);
    g.fillRect(x + 44, y + 34, 24, 12);
    g.fillStyle = '#ffd21a';
    g.beginPath();
    g.arc(x + 64, y + 65, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#101018';
    g.font = 'bold 15px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.fillText('SPEED CAMERA', x + 64, y + 108);
  }
  // school: a yellow-green diamond with two children
  {
    const { x, y } = cell(CELL.school);
    g.fillStyle = '#c8e61a';
    g.beginPath();
    g.moveTo(x + 64, y + 4);
    g.lineTo(x + 124, y + 64);
    g.lineTo(x + 64, y + 124);
    g.lineTo(x + 4, y + 64);
    g.closePath();
    g.fill();
    g.strokeStyle = '#101018';
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = '#101018';
    for (const dx of [-14, 14]) {
      g.beginPath();
      g.arc(x + 64 + dx, y + 44, 7, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x + 64 + dx - 6, y + 52, 12, 26);
      g.fillRect(x + 64 + dx - 8, y + 78, 6, 18);
      g.fillRect(x + 64 + dx + 2, y + 78, 6, 18);
    }
  }
  // police check: blue plate
  {
    const { x, y } = cell(CELL.police);
    g.fillStyle = '#1550c8';
    g.fillRect(x + 6, y + 6, 116, 116);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 5;
    g.strokeRect(x + 12, y + 12, 104, 104);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.font = 'bold 30px Arial, Helvetica, sans-serif';
    g.fillText('POLICE', x + 64, y + 50);
    g.fillText('CHECK', x + 64, y + 84);
    g.font = 'bold 14px Arial, Helvetica, sans-serif';
    g.fillText('STOP', x + 64, y + 108);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A plane whose uv covers one atlas cell. */
function cellPlane(cell, size, y, z = 0.07) {
  const g = new PlaneGeometry(size, size);
  const u0 = (cell % 4) / 4;
  const v0 = 1 - (Math.floor(cell / 4) + 1) / 2;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.25, v0 + uv.getY(i) * 0.5);
  g.translate(0, y, z);
  return g;
}

/** A pole with a sign plate on top (withPole) or a plate on its own (a second plate lower on the same pole). */
function signGeometry(cell, withPole, size = 1.1, y = 3.0) {
  const plate = cellPlane(cell, size, y);
  if (!withPole) return plate;
  const pole = new BoxGeometry(0.09, 3.6, 0.09);
  pole.translate(0, 1.8, 0);
  const u = ((CELL.plain % 4) + 0.5) / 4;
  const v = 1 - (Math.floor(CELL.plain / 4) + 0.5) / 2;
  const uv = pole.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  const out = mergeGeometries([pole, plate], false);
  pole.dispose();
  plate.dispose();
  return out;
}

/**
 * @param scene THREE.Scene
 * @param sites { cameras, schools, checkpoints } from rule-sites.js
 * @param city the road graph (for edge positions)
 */
export function buildRuleArt(scene, sites, city) {
  const group = new Group();
  group.name = 'rules-art';
  scene.add(group);
  const atlas = drawAtlas();
  const signMat = new MeshBasicMaterial({ map: atlas, alphaTest: 0.4 });
  const body = new MeshLambertMaterial({ vertexColors: true });

  // ---- signs: { cell, pole, x, z, yaw, y? }
  const signs = [];
  const camPoles = [];
  for (const cam of sites.cameras) {
    const e = city.edges[cam.edgeId];
    const s = e.len * 0.5;
    for (const dir of [1, -1]) {
      const p = edgePoint(city, e, s, e.w / 2 + 0.9, dir);
      camPoles.push({ ...p, cam, dir });
      // the limit and the camera warning 28 m before the pole (or as far as the road allows)
      const back = Math.min(28, s - 4);
      const q = edgePoint(city, e, s - dir * back, e.w / 2 + 0.9, dir);
      signs.push({ cell: cam.limit === 60 ? CELL[60] : CELL[40], pole: true, x: q.x, z: q.z, yaw: q.yaw });
      signs.push({ cell: CELL.camera, pole: false, x: q.x, z: q.z, yaw: q.yaw, low: true });
    }
  }
  for (const z of sites.schools) {
    const e = city.edges[z.edgeId];
    const off = Math.min(z.r - 8, e.len * 0.5 - 6);
    for (const dir of [1, -1]) {
      const q = edgePoint(city, e, e.len * 0.5 - dir * off, e.w / 2 + 0.9, dir);
      signs.push({ cell: CELL.school, pole: true, x: q.x, z: q.z, yaw: q.yaw });
      signs.push({ cell: CELL[20], pole: false, x: q.x, z: q.z, yaw: q.yaw, low: true });
    }
  }
  const cps = sites.checkpoints.map((c) => ({ ...c, e: city.edges[c.edgeId] }));
  for (const c of cps) {
    for (const dir of [1, -1]) {
      const back = Math.min(34, c.len * 0.5 - 6);
      const q = edgePoint(city, c.e, c.len * 0.5 - dir * back, c.w / 2 + 0.9, dir);
      signs.push({ cell: CELL.police, pole: true, x: q.x, z: q.z, yaw: q.yaw, night: true });
    }
  }
  const signGeos = [];
  const signMeshes = [];
  for (const key of new Set(signs.map((s) => `${s.cell}:${s.pole ? 1 : 0}:${s.low ? 1 : 0}:${s.night ? 1 : 0}`))) {
    const [cell, pole, low, nt] = key.split(':').map(Number);
    const items = signs.filter((s) => s.cell === cell && !!s.pole === !!pole && !!s.low === !!low && !!s.night === !!nt);
    const geo = signGeometry(cell, !!pole, low ? 0.8 : 1.1, low ? 2.1 : 3.0);
    signGeos.push(geo);
    const ms = chunkedInstances(group, geo, signMat, items, (s) => [s.x, s.z], (s, o) => {
      o.position.set(s.x, BASE_Y, s.z);
      o.rotation.y = s.yaw;
    }, { size: TILE, receiveShadow: false });
    if (nt) for (const m of ms) signMeshes.push(m);
  }
  const nightSigns = signMeshes;

  // ---- speed cameras: a pole with a housing and a red lens, one per direction
  const camGeo = mergeParts([
    colorBox(0.14, 5.2, 0.14, 0, 2.6, 0, [0.22, 0.23, 0.26]),
    colorBox(0.7, 0.46, 0.9, 0, 5.3, 0.1, [0.78, 0.79, 0.83]),
    colorBox(0.26, 0.26, 0.14, 0, 5.3, 0.6, [0.03, 0.03, 0.05]),
    colorBox(0.12, 0.12, 0.1, 0.25, 5.58, 0.2, [1, 0.1, 0.1]),
  ]);
  chunkedInstances(group, camGeo, body, camPoles, (p) => [p.x, p.z], (p, o) => {
    o.position.set(p.x, BASE_Y, p.z);
    o.rotation.y = p.yaw;
  }, { size: TILE });

  // ---- night checkpoints
  const night = new Group();
  night.name = 'rules-checkpoints';
  night.visible = false;
  group.add(night);
  const orange = [1, 0.4, 0.04];
  const white = [0.92, 0.92, 0.9];
  const barGeo = mergeParts([
    colorBox(0.6, 0.18, 0.1, -0.9, 0.82, 0, orange),
    colorBox(0.6, 0.18, 0.1, -0.3, 0.82, 0, white),
    colorBox(0.6, 0.18, 0.1, 0.3, 0.82, 0, orange),
    colorBox(0.6, 0.18, 0.1, 0.9, 0.82, 0, white),
    colorBox(0.08, 0.8, 0.5, -1.1, 0.4, 0, [0.3, 0.3, 0.34]),
    colorBox(0.08, 0.8, 0.5, 1.1, 0.4, 0, [0.3, 0.3, 0.34]),
  ]);
  const coneGeo = tint(new ConeGeometry(0.2, 0.6, 7).translate(0, 0.3, 0), orange);
  coneGeo.deleteAttribute('uv');
  const beaconGeo = mergeParts([
    colorBox(0.09, 2.6, 0.09, 0, 1.3, 0, [0.25, 0.25, 0.3]),
    colorBox(0.3, 0.2, 0.3, 0, 2.7, 0, [0.1, 0.1, 0.14]),
  ]);
  const barItems = [];
  const coneItems = [];
  const copItems = [];
  const beacons = [];
  for (const c of cps) {
    for (const dir of [1, -1]) {
      const lat = c.w / 2 - 1.3; // on the shoulder, 1.3 m in from the kerb
      for (const ds of [-4, 4]) {
        const p = edgePoint(city, c.e, c.len * 0.5 + ds * dir, lat, dir);
        barItems.push({ x: p.x, z: p.z, yaw: p.yaw });
      }
      for (let k = 0; k < 4; k++) {
        // a taper of cones from the barricade out into the lane, then back
        const p = edgePoint(city, c.e, c.len * 0.5 - dir * (8 + k * 3.2), lat - 0.5 - k * 0.45, dir);
        coneItems.push({ x: p.x, z: p.z });
      }
      const cp = edgePoint(city, c.e, c.len * 0.5 + dir * 1, c.w / 2 + 0.7, dir);
      copItems.push({ x: cp.x, z: cp.z, yaw: cp.yaw });
      const bp = edgePoint(city, c.e, c.len * 0.5 - dir * 5, c.w / 2 + 0.9, dir);
      beacons.push({ x: bp.x, z: bp.z, yaw: bp.yaw, i: 0, mesh: null, phase: (c.id + (dir > 0 ? 0 : 1)) % 2 });
    }
  }
  const place2 = (it, o) => {
    o.position.set(it.x, BASE_Y, it.z);
    o.rotation.y = it.yaw || 0;
  };
  const nightMeshes = [
    ...chunkedInstances(night, barGeo, body, barItems, (p) => [p.x, p.z], place2, { size: TILE }),
    ...chunkedInstances(night, coneGeo, body, coneItems, (p) => [p.x, p.z], place2, { size: TILE }),
    ...chunkedInstances(night, copGeometry(), body, copItems, (p) => [p.x, p.z], place2, { size: TILE }),
    ...chunkedInstances(night, beaconGeo, body, beacons, (p) => [p.x, p.z], place2, { size: TILE }),
  ];
  void nightMeshes;
  const glowTex = glowTexture();
  const glowMat = new MeshBasicMaterial({ map: glowTex, color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const glowGeo = new PlaneGeometry(2.4, 2.4);
  chunkedInstances(night, glowGeo, glowMat, beacons, (p) => [p.x, p.z], (b, o, c) => {
    o.position.set(b.x, BASE_Y + 2.7, b.z);
    o.rotation.y = b.yaw;
    c.setRGB(1, 0.1, 0.1);
    return c;
  }, { size: TILE, receiveShadow: false, onMesh: (mesh, tile) => tile.forEach((b, i) => { b.mesh = mesh; b.i = i; }) });
  for (const m of night.children) if (m.material === glowMat) m.renderOrder = 3;

  // ---- the camera flash: one big additive billboard, shown for a moment
  const flashMat = new MeshBasicMaterial({ map: glowTex, color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
  const flashMesh = new Mesh(new PlaneGeometry(1, 1), flashMat);
  flashMesh.visible = false;
  flashMesh.renderOrder = 10;
  flashMesh.frustumCulled = false;
  group.add(flashMesh);
  let flashT = 0;
  let camRef = null;

  let blinkT = 0;
  let lastBlink = -1;
  const dirty = new Set();

  return {
    group,
    stats: { signs: signs.length, cameras: camPoles.length, checkpoints: cps.length },
    /** A flash at a world point (the camera lens), as seen from `camera`. */
    flash(x, y, z, camera) {
      flashT = 0.32;
      camRef = camera;
      flashMesh.position.set(x, y, z);
      flashMesh.visible = true;
    },
    update(dt, night01) {
      // signs lose some colour in the dark; the checkpoint set only exists at night
      const dim = 1 - Math.min(1, Math.max(0, night01)) * 0.5;
      signMat.color.setScalar(dim);
      const on = night01 >= RULES.checkpoint.nightFrom - 0.1;
      if (night.visible !== on) night.visible = on;
      for (const m of nightSigns) if (m.visible !== on) m.visible = on;
      if (on) {
        blinkT += dt;
        const phase = Math.floor(blinkT * 3.5) % 2;
        if (phase !== lastBlink) {
          lastBlink = phase;
          for (const b of beacons) {
            if (!b.mesh) continue;
            const red = (phase + b.phase) % 2 === 0;
            b.mesh.instanceColor.setXYZ(b.i, red ? 1.4 : 0.1, red ? 0.1 : 0.35, red ? 0.1 : 1.5);
            dirty.add(b.mesh);
          }
          for (const m of dirty) m.instanceColor.needsUpdate = true;
          dirty.clear();
        }
      }
      if (flashT > 0) {
        flashT -= dt;
        if (flashT <= 0) flashMesh.visible = false;
        else {
          const k = flashT / 0.32;
          flashMat.opacity = Math.min(1, k * 1.6);
          flashMesh.scale.setScalar(3 + (1 - k) * 9);
          if (camRef) flashMesh.quaternion.copy(camRef.quaternion);
        }
      }
    },
    dispose() {
      for (const g of signGeos) g.dispose();
      flashMesh.geometry.dispose();
      flashMat.dispose();
      disposeGroup(group);
    },
  };
}
