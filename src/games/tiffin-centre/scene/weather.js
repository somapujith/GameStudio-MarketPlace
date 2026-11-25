// Rain (the `rain` event of the operations layer): slanted streaks falling beyond the awning (none under the tin roof), drops that hang and fall from the
// roof's front edge, leaks that drip through the gaps in the tin onto the counter and the floor, and expanding rings where they land, on the footpath and in
// the road's puddles. The level (0..1) is fed by the caller, already smoothed (a fade in and out); the overcast sky, the wet road and the umbrellas of the
// passers-by are lighting.js `applyWeather` and street.js, driven by the same level. Everything is pooled: nothing is allocated after construction.
//   createWeather({ scene, camera, art, tr, quality, reducedMotion, roofGaps }) -> { update(dt, t, level), setReduced(b), dispose(), stats }
// Tiers: low draws no streaks or drops at all, just a faint streaked film over the lens; medium and high draw streaks (quality.particles x 1.2).
import {
  AdditiveBlending, BufferGeometry, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, PlaneGeometry,
  Points, PointsMaterial, RepeatWrapping,
} from 'three';
import { mulberry } from './textures.js';
import { approach, clamp } from './ops-view.js';

export { approach };

// the stall, as the rain meets it (metres; see stall.js SHELL)
export const ROOF = { halfW: 4.75, frontZ: -2.3, rearZ: 2.9, frontY: 2.6, rearY: 3.12 };
export const RAIN_VOLUME = { x0: -13, x1: 13, z0: -13, z1: 2.5, top: 8.5 };
const WIND = 0.16; // streak slant (x per y)
const STREAK_W = 0.015; // half the width of a streak (m)
const FALL = 9.5; // m/s

/** The height of the roof's underside at depth z (it rises towards the back). */
export const roofY = (z) => ROOF.frontY + clamp((z - (ROOF.frontZ + 0.3)) / (ROOF.rearZ - ROOF.frontZ - 0.3), 0, 1) * (ROOF.rearY - ROOF.frontY);
/** Is the point under the tin roof (so rain cannot reach it)? */
export const underRoof = (x, y, z) => Math.abs(x) < ROOF.halfW + 0.05 && z > ROOF.frontZ && z < ROOF.rearZ && y < roofY(z) + 0.05;

/** Height of a drop `tau` seconds after it let go at `y0` (free fall), floored at `yEnd`; `landed` once it has reached it. Pure. */
export function dropY(tau, y0, yEnd, g = 9.8) {
  const y = y0 - 0.5 * g * tau * tau;
  return y <= yEnd ? { y: yEnd, landed: true } : { y, landed: false };
}
/** Seconds for a drop to fall from y0 to yEnd. */
export const fallTime = (y0, yEnd, g = 9.8) => Math.sqrt((2 * Math.max(0, y0 - yEnd)) / g);

/** Streak count for a quality config: none on the low tier (it gets the lens film instead). */
export const streakCount = (quality) => (quality?.post ? Math.round((quality.particles || 320) * 1.2) : 0);

const PUDDLES = [[-2.6, -7.3], [1.6, -8.6], [4.4, -7.2], [-7.4, -8.0], [-0.2, -6.9], [11, -9.2], [-13, -7.4], [-3.0, -4.3], [3.4, -3.9]];
const ROAD_Y = -0.17;
const FOOT_Y = -0.02;

export function createWeather({ scene, camera = null, art = null, tr, quality, reducedMotion = false, roofGaps = [] }) {
  const T = (o) => (tr ? tr.track(o) : o);
  const root = new Group();
  root.name = 'weather';
  scene.add(root);
  const rnd = mulberry(4040);
  const tex = (name) => {
    try {
      return art?.[name]?.() || null;
    } catch {
      return null;
    }
  };
  let reduced = !!reducedMotion;
  let level = 0;

  // --- streaks ------------------------------------------------------------------------------------------------------------------------------------------
  const N = streakCount(quality);
  let streakMat = null;
  let streaks = null;
  let sx = null;
  let sy = null;
  let sz = null;
  let sv = null;
  let sl = null;
  let spos = null;
  const respawn = (i, fresh) => {
    sx[i] = RAIN_VOLUME.x0 + rnd() * (RAIN_VOLUME.x1 - RAIN_VOLUME.x0);
    sz[i] = RAIN_VOLUME.z0 + rnd() * (RAIN_VOLUME.z1 - RAIN_VOLUME.z0);
    sy[i] = fresh ? rnd() * RAIN_VOLUME.top : RAIN_VOLUME.top + rnd() * 1.5;
    sv[i] = FALL * (0.85 + rnd() * 0.35);
    sl[i] = 0.5 + rnd() * 0.45;
  };
  if (N > 0) {
    sx = new Float32Array(N);
    sy = new Float32Array(N);
    sz = new Float32Array(N);
    sv = new Float32Array(N);
    sl = new Float32Array(N);
    for (let i = 0; i < N; i++) respawn(i, true);
    // each streak is a thin quad (4 vertices), alternately facing the cook and facing sideways, so a drop reads from any way the head is turned
    const g = T(new BufferGeometry());
    const attr = new Float32BufferAttribute(new Float32Array(N * 12), 3).setUsage(DynamicDrawUsage);
    g.setAttribute('position', attr);
    spos = attr.array; // the attribute owns its array (the constructor copies): write straight into it
    const idx = [];
    for (let i = 0; i < N; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    g.setIndex(idx);
    streakMat = T(new MeshBasicMaterial({ color: 0xe6eef8, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
    streaks = new Mesh(g, streakMat);
    streaks.frustumCulled = false;
    streaks.visible = false;
    streaks.renderOrder = 9;
    root.add(streaks);
  }

  // --- the lens film (the low tier's whole rain): a tiling streak texture drifting down a plane just in front of the eye ---------------------------------------
  let film = null;
  let filmMat = null;
  if (N === 0 && camera) {
    const map = tex('rainStreak');
    if (map) {
      T(map);
      map.wrapS = map.wrapT = RepeatWrapping;
      map.repeat.set(2, 2);
    }
    filmMat = T(new MeshBasicMaterial({ map, color: 0xdfeaf5, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide }));
    film = new Mesh(T(new PlaneGeometry(1.4, 0.9)), filmMat);
    film.position.set(0, 0, -0.6);
    film.renderOrder = 30;
    film.visible = false;
    camera.add(film);
  }

  // --- drippers: the roof's front edge, and leaks through the gaps in the tin ---------------------------------------------------------------------------------
  const drippers = [];
  const edge = 24;
  for (let i = 0; i < edge; i++) {
    drippers.push({ x: -4.55 + (i + rnd() * 0.6) * (9.1 / edge), z: ROOF.frontZ - 0.04, y0: ROOF.frontY - 0.04, yEnd: FOOT_Y + 0.01, period: 1.1 + rnd() * 1.4, phase: rnd() * 3, on: (i + 0.5) / edge, landed: true, leak: false, ring: 0.1 });
  }
  const LEAK_Z = [-0.95, -0.35, 0.5, 1.15];
  (roofGaps || []).slice(0, 4).forEach((gp, i) => {
    const z = LEAK_Z[i % LEAK_Z.length];
    const onCounter = z <= -0.55 && Math.abs(gp.x) < 3.25;
    for (let k = 0; k < 2; k++) {
      drippers.push({
        x: gp.x + (k - 0.5) * gp.w * 0.5, z, y0: roofY(z) - 0.06, yEnd: onCounter ? 0.84 : 0.0, period: 0.55 + rnd() * 0.5, phase: rnd() * 2, on: 0.2 + 0.3 * rnd(), landed: true, leak: true, ring: 0.07,
      });
    }
  });
  const ND = drippers.length;
  const dg = T(new BufferGeometry());
  dg.setAttribute('position', new Float32BufferAttribute(new Float32Array(ND * 3), 3).setUsage(DynamicDrawUsage));
  const dpos = dg.attributes.position.array; // the attribute owns its array
  const dropMat = T(new PointsMaterial({ map: tex('softDot'), size: 0.075, transparent: true, depthWrite: false, color: 0xdcecff, opacity: 0, sizeAttenuation: true }));
  const drops = new Points(dg, dropMat);
  drops.frustumCulled = false;
  drops.visible = false;
  root.add(drops);

  // --- rings where drops land --------------------------------------------------------------------------------------------------------------------------------
  const ringGeo = T(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const rippleMap = (() => {
    try {
      return art?.decal?.('ripple') || null;
    } catch {
      return null;
    }
  })();
  const rings = [];
  const NR = quality?.post ? 20 : 10;
  for (let i = 0; i < NR; i++) {
    const mat = T(new MeshBasicMaterial({ map: rippleMap, color: 0xe8f2ff, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    const mesh = new Mesh(ringGeo, mat);
    mesh.visible = false;
    mesh.renderOrder = 8;
    root.add(mesh);
    rings.push({ mesh, mat, age: 9, life: 0.5, r: 0.1 });
  }
  let nextRing = 0;
  const spawnRing = (x, y, z, r, life = 0.55) => {
    const o = rings[nextRing];
    nextRing = (nextRing + 1) % NR;
    o.age = 0;
    o.life = life;
    o.r = r;
    o.mesh.position.set(x, y, z);
    o.mesh.visible = true;
  };
  let puddleAcc = 0;
  let clock = 0;
  const stats = { streaks: N, drippers: ND, rings: NR, film: !!film, visible: false };

  function update(dt, t, lvl) {
    clock = t;
    level = clamp(lvl, 0, 1);
    const on = level > 0.02;
    stats.visible = on;
    if (streaks) streaks.visible = on;
    drops.visible = on && !reduced;
    if (film) film.visible = on;
    if (!on) {
      for (const r of rings) r.mesh.visible = false;
      return;
    }
    const d = Math.min(0.1, Math.max(0, dt));
    if (streaks) {
      streakMat.opacity = 0.6 * Math.min(1, level * 1.4);
      const active = Math.max(1, Math.round(N * (0.25 + 0.75 * level)));
      for (let i = 0; i < N; i++) {
        const o = i * 12;
        if (i >= active) {
          for (let v = 0; v < 4; v++) {
            spos[o + v * 3] = 0;
            spos[o + v * 3 + 1] = -50;
            spos[o + v * 3 + 2] = 0;
          }
          continue;
        }
        sy[i] -= sv[i] * d;
        sx[i] -= WIND * sv[i] * d;
        if (sy[i] < 0 || underRoof(sx[i], sy[i], sz[i])) {
          // it reaches the ground (a ring in the near puddles) or the tin
          if (sy[i] < 0 && sz[i] > -6.3 && sz[i] < -2.6 && rnd() < 0.05) spawnRing(sx[i], FOOT_Y + 0.01, sz[i], 0.12, 0.4);
          respawn(i, false);
        }
        const len = sl[i] * (reduced ? 0.7 : 1);
        const hw = STREAK_W * (0.7 + 0.6 * sl[i]);
        const ax = i & 1 ? 0 : hw; // half the quads are spread along x, half along z
        const az = i & 1 ? hw : 0;
        spos[o] = sx[i] - ax;
        spos[o + 1] = sy[i];
        spos[o + 2] = sz[i] - az;
        spos[o + 3] = sx[i] + ax;
        spos[o + 4] = sy[i];
        spos[o + 5] = sz[i] + az;
        spos[o + 6] = sx[i] + ax + WIND * len;
        spos[o + 7] = sy[i] + len;
        spos[o + 8] = sz[i] + az;
        spos[o + 9] = sx[i] - ax + WIND * len;
        spos[o + 10] = sy[i] + len;
        spos[o + 11] = sz[i] - az;
      }
      streaks.geometry.attributes.position.needsUpdate = true;
    }
    if (film) {
      filmMat.opacity = 0.2 * level;
      const m = filmMat.map;
      if (m) m.offset.set(0, -(t * 0.9) % 1);
    }
    // drips: each hangs (a bead at the edge), lets go, falls, lands in a ring; `on` thins them out in a drizzle
    for (let i = 0; i < ND; i++) {
      const dr = drippers[i];
      const o = i * 3;
      if (dr.on > level) {
        dpos[o] = dr.x;
        dpos[o + 1] = -50;
        dpos[o + 2] = dr.z;
        continue;
      }
      const c = ((t + dr.phase * dr.period) / dr.period) % 1; // 0..1 through one cycle
      const hang = 0.45; // the first part of the cycle it clings to the edge
      if (c < hang) {
        dpos[o] = dr.x;
        dpos[o + 1] = dr.y0 - 0.012 * (c / hang);
        dpos[o + 2] = dr.z;
        dr.landed = false;
      } else {
        const tau = (c - hang) * dr.period;
        const f = dropY(tau, dr.y0, dr.yEnd);
        dpos[o] = dr.x;
        dpos[o + 1] = f.y;
        dpos[o + 2] = dr.z;
        if (f.landed && !dr.landed) {
          dr.landed = true;
          spawnRing(dr.x, dr.yEnd + 0.004, dr.z, dr.ring, 0.5);
        }
        if (f.landed) dpos[o + 1] = -50; // gone once it has landed
      }
    }
    dg.attributes.position.needsUpdate = true;
    dropMat.opacity = 0.85 * Math.min(1, level * 1.5);
    // splashes in the puddles of the road (and the footpath), a few a second in a downpour
    puddleAcc += d * (3 + 11 * level) * (reduced ? 0.4 : 1);
    while (puddleAcc >= 1) {
      puddleAcc -= 1;
      const p = PUDDLES[Math.floor(rnd() * PUDDLES.length)];
      spawnRing(p[0] + (rnd() - 0.5) * 0.9, (p[1] > -6.4 ? FOOT_Y : ROAD_Y) + 0.012, p[1] + (rnd() - 0.5) * 0.5, 0.14 + rnd() * 0.12, 0.45 + rnd() * 0.25);
    }
    for (const r of rings) {
      if (r.age >= r.life) {
        r.mesh.visible = false;
        continue;
      }
      r.age += d;
      const u = clamp(r.age / r.life, 0, 1);
      r.mesh.scale.set(r.r * (0.35 + 1.4 * u), 1, r.r * (0.35 + 1.4 * u));
      r.mat.opacity = 0.7 * (1 - u) * (1 - u) * Math.min(1, level * 2);
    }
  }

  function dispose() {
    if (film) camera.remove(film);
    scene.remove(root);
    for (const r of rings) r.mat.dispose();
    streakMat?.dispose();
    dropMat.dispose();
    filmMat?.dispose();
    if (!tr) {
      streaks?.geometry.dispose();
      dg.dispose();
      ringGeo.dispose();
    }
  }

  return {
    update,
    dispose,
    stats,
    root,
    get level() {
      return level;
    },
    get time() {
      return clock;
    },
    setReduced(b) {
      reduced = !!b;
    },
  };
}
