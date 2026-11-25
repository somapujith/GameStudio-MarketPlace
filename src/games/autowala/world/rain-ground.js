// What rain does to the ground near the player: puddle decals (a handful of instances reused as you drive, picked from a fixed hash
// of the road so the same puddle is always in the same place) and splashes (a small pool of Points: a burst when a tyre hits a puddle
// and a thin spray from the rear wheels on wet roads). One draw call each; the CPU work is a few hundred operations per frame.
import { DoubleSide, BufferAttribute, BufferGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Points, PointsMaterial, Quaternion, Vector3 } from 'three';
import { canvasTexture } from '../render/textures.js';
import { onRoad } from './roads.js';

export const PUDDLE_POOL = { low: 3, medium: 6, high: 9 };
export const SPLASH_POOL = { low: 20, medium: 40, high: 64 };
const CELL = 9; // m: at most one puddle per cell
const RADIUS = 44; // m around the player
const Y = 0.05;
const DARK = new Color(0.18, 0.22, 0.32);

/** Deterministic 0..1 values for a map cell (three of them, for: "is there a puddle", where, how big). */
export function cellHash(i, j) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ 0x2f6b;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const a = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  const b = ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  h = Math.imul(h ^ (h >>> 16), 3266489917);
  const c = ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  return [a, b, c];
}

/** The puddle of a map cell, or null: { x, z, rx, rz, yaw, dist } (long axis along the road). Cached by the caller. */
export function puddleOfCell(city, i, j) {
  const [a, b, c] = cellHash(i, j);
  if (a > 0.62) return null; // ~60% of cells (most then fall off the road)
  const x = (i + 0.15 + b * 0.7) * CELL;
  const z = (j + 0.15 + c * 0.7) * CELL;
  const e = onRoad(city, x, z, -2.6);
  if (!e) return null;
  const rx = 1.2 + b * 1.5;
  const rz = 2.2 + c * 2.8;
  return { x, z, rx, rz, yaw: Math.atan2(e.dx, e.dz) };
}

export function createRainGround(scene, city) {
  const dot = canvasTexture(32, 32, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }, { anisotropy: 1 });
  // a puddle: soft edge, a brighter sky-reflection streak
  const puddleTex = canvasTexture(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.8)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.0)';
    g.globalCompositeOperation = 'lighter';
    const hl = g.createLinearGradient(0, h * 0.2, 0, h * 0.5);
    hl.addColorStop(0, 'rgba(255,255,255,0)');
    hl.addColorStop(0.5, 'rgba(120,120,120,0.35)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hl;
    g.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.3);
  }, { anisotropy: 1 });

  // ------------------------------------------------------------------------------------------------ puddles
  const pgeo = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const pmat = new MeshBasicMaterial({
    map: puddleTex, color: 0x6a7fa0, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const maxP = PUDDLE_POOL.high;
  const puddles = new InstancedMesh(pgeo, pmat, maxP);
  puddles.frustumCulled = false;
  puddles.renderOrder = 1;
  puddles.count = 0;
  puddles.instanceMatrix.setUsage(35048);
  scene.add(puddles);
  const cells = new Map(); // key -> puddle | null
  const near = []; // reused selection buffer
  const live = []; // puddles currently shown { x, z, rx, rz, cd }
  for (let i = 0; i < maxP; i++) live.push({ x: 0, z: 0, rx: 1, rz: 1, cd: 0 });
  let nLive = 0;
  let pool = PUDDLE_POOL.medium;
  let acc = 1;
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const sc = new Vector3();

  // ------------------------------------------------------------------------------------------------ splashes
  const maxS = SPLASH_POOL.high;
  const sPos = new Float32Array(maxS * 3).fill(0);
  const sVel = new Float32Array(maxS * 3);
  const sLife = new Float32Array(maxS);
  for (let i = 0; i < maxS; i++) sPos[i * 3 + 1] = -50;
  const sGeo = new BufferGeometry();
  sGeo.setAttribute('position', new BufferAttribute(sPos, 3).setUsage(35048));
  const sMat = new PointsMaterial({ size: 0.2, map: dot, color: 0xdfe9f6, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true });
  const splashes = new Points(sGeo, sMat);
  splashes.frustumCulled = false;
  splashes.renderOrder = 7;
  sGeo.setDrawRange(0, SPLASH_POOL.medium);
  scene.add(splashes);
  let sCount = SPLASH_POOL.medium;
  let sCursor = 0;
  let sActive = 0;
  let spray = 0;

  const spawn = (x, y, z, vx, vy, vz, life) => {
    for (let k = 0; k < sCount; k++) {
      const i = (sCursor + k) % sCount;
      if (sLife[i] > 0) continue;
      sCursor = (i + 1) % sCount;
      sPos[i * 3] = x; sPos[i * 3 + 1] = y; sPos[i * 3 + 2] = z;
      sVel[i * 3] = vx; sVel[i * 3 + 1] = vy; sVel[i * 3 + 2] = vz;
      sLife[i] = life;
      sActive++;
      return;
    }
  };

  const keyOf = (i, j) => (i + 512) * 1024 + (j + 512);

  /** Choose the nearest puddles of the cells around (px, pz). */
  function refresh(px, pz, night, hor, level) {
    near.length = 0;
    const i0 = Math.floor((px - RADIUS) / CELL);
    const i1 = Math.floor((px + RADIUS) / CELL);
    const j0 = Math.floor((pz - RADIUS) / CELL);
    const j1 = Math.floor((pz + RADIUS) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = keyOf(i, j);
        let p = cells.get(k);
        if (p === undefined) {
          p = puddleOfCell(city, i, j);
          cells.set(k, p);
        }
        if (!p) continue;
        const d = Math.hypot(p.x - px, p.z - pz);
        if (d < RADIUS) near.push({ p, d });
      }
    }
    near.sort((a, b) => a.d - b.d);
    nLive = Math.min(pool, near.length);
    for (let n = 0; n < nLive; n++) {
      const { p, d } = near[n];
      const fade = 1 - Math.min(1, Math.max(0, (d - 28) / (RADIUS - 28))); // shrink away at the edge: nothing pops
      const grow = Math.min(1, level * 1.6) * (0.55 + 0.45 * level) * fade;
      q.setFromAxisAngle(up, p.yaw);
      pos.set(p.x, Y, p.z);
      sc.set(p.rx * grow, 1, p.rz * grow);
      m4.compose(pos, q, sc);
      puddles.setMatrixAt(n, m4);
      const L = live[n];
      L.x = p.x; L.z = p.z; L.rx = p.rx * grow; L.rz = p.rz * grow;
    }
    puddles.count = nLive;
    puddles.instanceMatrix.needsUpdate = true;
    // the colour of the sky in the puddle, brighter after dark (neon in the water)
    pmat.color.copy(hor).multiplyScalar(0.5 + night * 0.5).lerp(DARK, 0.4 - night * 0.15);
  }

  return {
    puddles,
    splashes,
    get shown() { return nLive; },
    get sparks() { return sActive; },
    /** Quality: number of puddles and splash particles. */
    setQuality(q) {
      pool = PUDDLE_POOL[q] ?? PUDDLE_POOL.medium;
      sCount = SPLASH_POOL[q] ?? SPLASH_POOL.medium;
      sGeo.setDrawRange(0, sCount);
    },
    /**
     * Per frame. `level` = standing water 0..1, `rain` 0..1, `v` the player ({x,z,heading,speed}), `hor` the sky's horizon colour.
     * `emitSplash({x,z,speed})` is called once per burst (the sound, the event bus).
     */
    update(dt, level, rain, v, night, hor, emitSplash) {
      puddles.visible = level > 0.04;
      pmat.opacity = 0.6 * Math.min(1, level * 1.5);
      acc += dt;
      if (puddles.visible && acc > 0.25) {
        acc = 0;
        refresh(v.x, v.z, night, hor, level);
      }
      const speed = v.speed;
      const fx = Math.sin(v.heading);
      const fz = Math.cos(v.heading);
      // a tyre hits a puddle: a burst, with a cooldown per puddle
      if (puddles.visible && speed > 2.5) {
        for (let n = 0; n < nLive; n++) {
          const L = live[n];
          L.cd -= dt;
          const dx = L.x - v.x;
          const dz = L.z - v.z;
          const r = Math.max(L.rx, L.rz) * 0.8 + 0.8;
          if (dx * dx + dz * dz < r * r && L.cd <= 0) {
            L.cd = 0.5;
            const burst = Math.min(10, 3 + (speed * 0.4) | 0);
            for (let k = 0; k < burst; k++) {
              const a = Math.random() * Math.PI * 2;
              const s = 1.2 + Math.random() * 1.8 + speed * 0.06;
              spawn(v.x + fx * 0.6, 0.15, v.z + fz * 0.6, Math.cos(a) * s * 0.8 - fz * 0.5, 2.2 + Math.random() * 2.6, Math.sin(a) * s * 0.8 + fx * 0.5, 0.55 + Math.random() * 0.35);
            }
            emitSplash?.({ x: v.x, z: v.z, speed });
          } else if (L.cd < -1) L.cd = 0;
        }
      }
      // thin tyre spray from the rear wheels on a wet road
      const wet = Math.max(rain, level * 0.6);
      if (wet > 0.15 && speed > 6) {
        spray += dt * wet * speed * 0.9;
        while (spray >= 1) {
          spray -= 1;
          const side = Math.random() < 0.5 ? -0.7 : 0.7;
          const rx = fz; // the auto's left (heading 0 faces +z, left is +x)
          const rz = -fx;
          spawn(v.x - fx * 1.1 + rx * side, 0.12, v.z - fz * 1.1 + rz * side, rx * side * 1.2 - fx * 1.5, 1.2 + Math.random() * 1.4, rz * side * 1.2 - fz * 1.5, 0.35 + Math.random() * 0.25);
        }
      } else spray = 0;
      // integrate the particles
      if (sActive > 0) {
        let alive = 0;
        for (let i = 0; i < sCount; i++) {
          if (sLife[i] <= 0) continue;
          sLife[i] -= dt;
          const o = i * 3;
          sVel[o + 1] -= 9.8 * dt;
          sPos[o] += sVel[o] * dt;
          sPos[o + 1] += sVel[o + 1] * dt;
          sPos[o + 2] += sVel[o + 2] * dt;
          if (sLife[i] <= 0 || sPos[o + 1] < 0.03) {
            sLife[i] = 0;
            sPos[o + 1] = -50;
          } else alive++;
        }
        sActive = alive;
        sGeo.attributes.position.needsUpdate = true;
      }
      splashes.visible = sActive > 0;
    },
    dispose() {
      scene.remove(puddles, splashes);
      pgeo.dispose();
      pmat.dispose();
      puddles.dispose?.();
      sGeo.dispose();
      sMat.dispose();
      dot.dispose();
      puddleTex.dispose();
      cells.clear();
    },
  };
}
