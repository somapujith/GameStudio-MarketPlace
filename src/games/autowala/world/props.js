// Street furniture, all instanced: palms and shade trees (they sway in the wind), lamp posts with warm light pools at
// night, bunting across the Old City lanes. `update` moves a small pool of real point lights to the lamps nearest the player.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Group,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from '../game/rng.js';
import { foliageMaterial, glowMaterial } from '../render/materials.js';
import { chunkedInstances } from '../render/chunks.js';
import { canvasTexture } from '../render/textures.js';

function frondGeometry() {
  // one palm frond: an arched, drooping leaf strip along +x
  const steps = 3;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = t * 4.6;
    const y = 0.9 * t - 2.2 * t * t;
    const hw = 0.62 * Math.pow(1 - t, 0.75) + 0.04;
    pos.push(x, y, -hw, x, y, hw);
    if (i < steps) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function palmCrown() {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const g = frondGeometry();
    g.rotateY((i / 9) * Math.PI * 2 + (i % 2) * 0.18);
    g.rotateZ(0);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

export function buildProps(scene, city, colliders, shared, seed) {
  const rng = makeRng(seed ^ 0x7ee5);
  const group = new Group();
  scene.add(group);
  const o = new Object3D();
  const col = new Color();

  const treeSpots = [];
  const palmSpots = [];
  const lampSpots = [];
  const bunting = [];
  const L = city.lake;
  const nearLake = (x, z, m) => ((x - L.cx) / (L.rx + m)) ** 2 + ((z - L.cz) / (L.rz + m)) ** 2 < 1;

  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const nx = -e.dz;
    const nz = e.dx;
    const half = e.w / 2;
    const isPromenade = e.name === 'Necklace Road';
    const isAvenue = e.w >= 14;
    const dist = Math.hypot((a.x + e.dx * e.len / 2) - 150, (a.z + e.dz * e.len / 2) - 255);
    const oldCity = dist < 230 && e.w <= 10;

    // lamps: every ~34 m, alternating sides, leaning toward the road
    for (let s = 14, side = 1; s < e.len - 10; s += 34, side = -side) {
      const px = a.x + e.dx * s + nx * side * (half + 1.1);
      const pz = a.z + e.dz * s + nz * side * (half + 1.1);
      if (nearLake(px, pz, 4) && !isPromenade) continue;
      lampSpots.push({ x: px, z: pz, yaw: Math.atan2(-nx * side, -nz * side) });
    }
    // palms along the promenade and the avenues, on the outer verge
    if (isPromenade || isAvenue) {
      for (let s = 10, side = 1; s < e.len - 8; s += isPromenade ? 13 : 20) {
        const sd = isPromenade ? (rng.chance(0.5) ? 1 : -1) : side;
        const px = a.x + e.dx * s + nx * sd * (half + 2.4);
        const pz = a.z + e.dz * s + nz * sd * (half + 2.4);
        if (isPromenade && nearLake(px, pz, 2)) continue;
        palmSpots.push({ x: px, z: pz, h: rng.range(0.85, 1.25), r: rng.range(0, 6.28) });
        if (!isPromenade) side = -side;
      }
    }
    // shade trees on ordinary streets, sparse
    if (!isPromenade && !oldCity) {
      for (let s = 18; s < e.len - 14; s += rng.range(26, 46)) {
        const sd = rng.sign();
        treeSpots.push({ x: a.x + e.dx * s + nx * sd * (half + 2.2), z: a.z + e.dz * s + nz * sd * (half + 2.2), s: rng.range(0.8, 1.25), kind: rng.chance(0.28) ? 'gulmohar' : 'neem' });
      }
    }
    // bunting over Old City lanes
    if (oldCity && e.len > 36) {
      for (let s = 16; s < e.len - 14; s += 24) {
        bunting.push({ cx: a.x + e.dx * s, cz: a.z + e.dz * s, nx, nz, span: e.w + 3.4, yaw: Math.atan2(e.dx, e.dz) });
      }
    }
  }

  // parks, plazas and villa/rural blocks: plenty of trees
  for (const b of city.blocks) {
    const park = b.type === 'park' || b.type === 'water';
    const density = park ? 1 / 170 : b.district === 'banjara' ? 1 / 260 : b.district === 'golconda' || b.district === 'suburb' ? 1 / 420 : b.type === 'landmark' ? 1 / 380 : 0;
    if (!density || b.type === 'water') continue;
    const n = Math.floor(b.w * b.d * density);
    for (let i = 0; i < n; i++) {
      const x = rng.range(b.x0 + 4, b.x1 - 4);
      const z = rng.range(b.z0 + 4, b.z1 - 4);
      if (colliders.inside(x, z, 2.5)) continue;
      if (nearLake(x, z, 14)) continue;
      if (rng.chance(park ? 0.4 : 0.15)) palmSpots.push({ x, z, h: rng.range(0.8, 1.2), r: rng.range(0, 6.28) });
      else treeSpots.push({ x, z, s: rng.range(0.9, 1.5), kind: rng.chance(0.3) ? 'gulmohar' : 'neem' });
    }
  }
  // the park strip around the lake: a palm every few metres along the shore
  for (let i = 0; i < 90; i++) {
    const t = (i / 90) * Math.PI * 2;
    const rx = L.rx + 15 + (i % 2) * 5;
    const rz = L.rz + 15 + (i % 2) * 5;
    palmSpots.push({ x: L.cx + Math.cos(t) * rx, z: L.cz + Math.sin(t) * rz, h: rng.range(0.9, 1.3), r: rng.range(0, 6.28) });
  }

  // trunks and posts are solid now that the auto may use the pavement (the same soft guardrail contact as a wall)
  for (const t of treeSpots) colliders.addCentered(t.x, t.z, 0.8, 0.8, 'prop', 5);
  for (const p of palmSpots) colliders.addCentered(p.x, p.z, 0.7, 0.7, 'prop', 9);
  for (const l of lampSpots) colliders.addCentered(l.x, l.z, 0.35, 0.35, 'prop', 6);

  // All scenery is instanced PER MAP TILE (render/chunks.js) so the GPU culls far tiles in the view and in the shadow pass.
  const meshes = [];
  const keep = (list) => { meshes.push(...list); return list; };
  const treeAt = (t) => [t.x, t.z];

  // ---- shade trees: trunk + two stacked canopy blobs (low poly: ~100 tris a canopy)
  const trunkGeo = new CylinderGeometry(0.22, 0.34, 3.4, 6).translate(0, 1.7, 0);
  const canopyGeo = (() => {
    const a = new IcosahedronGeometry(2.6, 1);
    a.scale(1, 0.82, 1);
    a.translate(0, 5.0, 0);
    const b = new IcosahedronGeometry(1.8, 0);
    b.translate(0.9, 6.3, 0.3);
    return mergeGeometries([a, b]);
  })();
  const trunkMat = new MeshStandardMaterial({ color: 0x6b4a3a, roughness: 1, flatShading: true });
  const canopyMat = foliageMaterial(shared, { sway: 0.9, key: 'canopy' });
  treeSpots.forEach((t, i) => {
    t.i = i;
    t.tint = t.kind === 'gulmohar' ? rng.pick(['#ff6a3d', '#ff4d5e', '#ff8a2d']) : rng.pick(['#3f9a5a', '#5aae52', '#2f8a63', '#7bbd4f']);
  });
  const treePlace = (t, ob) => {
    ob.position.set(t.x, 0, t.z);
    ob.scale.setScalar(t.s);
    ob.rotation.set(0, (t.i * 1.7) % 6.28, 0);
  };
  keep(chunkedInstances(group, trunkGeo, trunkMat, treeSpots, treeAt, treePlace, { castShadow: true }));
  keep(chunkedInstances(group, canopyGeo, canopyMat, treeSpots, treeAt, (t, ob, c) => { treePlace(t, ob); return c.set(t.tint); }, { castShadow: true }));

  // ---- palms (a lighter crown: 3 segments a frond)
  const palmTrunkGeo = new CylinderGeometry(0.2, 0.34, 9, 6).translate(0, 4.5, 0);
  const crownGeo = palmCrown();
  crownGeo.translate(0, 9.1, 0);
  const palmTrunkMat = new MeshStandardMaterial({ color: 0x8a6a56, roughness: 1, flatShading: true });
  const palmCrownMat = foliageMaterial(shared, { color: 0xffffff, sway: 0.5, key: 'palm' });
  palmSpots.forEach((p) => { p.tint = rng.pick(['#4fb35a', '#3fa56a', '#62c054', '#37a07a']); });
  const palmPlace = (p, ob) => {
    ob.position.set(p.x, 0, p.z);
    ob.scale.set(p.h, p.h, p.h);
    ob.rotation.set(0, p.r, 0);
  };
  keep(chunkedInstances(group, palmTrunkGeo, palmTrunkMat, palmSpots, treeAt, palmPlace, { castShadow: true }));
  keep(chunkedInstances(group, crownGeo, palmCrownMat, palmSpots, treeAt, (p, ob, c) => { palmPlace(p, ob); return c.set(p.tint); }, { castShadow: false }));

  // ---- lamps: poles and heads cast no shadows (thin, and thousands of them)
  const poleGeo = (() => {
    const pole = new CylinderGeometry(0.09, 0.13, 6.4, 5).translate(0, 3.2, 0);
    const arm = new BoxGeometry(0.12, 0.12, 1.4).translate(0, 6.35, 0.6);
    return mergeGeometries([pole, arm]);
  })();
  const headGeo = new BoxGeometry(0.7, 0.14, 0.36).translate(0, 6.28, 1.25);
  const headMat = glowMaterial(0xffc27a, 1.0);
  const poolGeo = new CircleGeometry(7.5, 14);
  poolGeo.rotateX(-Math.PI / 2);
  const poolTex = canvasTexture(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }, { anisotropy: 1 });
  const poolMat = new MeshBasicMaterial({ color: new Color('#ff9a4a'), map: poolTex, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const lampAt = (l) => [l.x, l.z];
  const lampPlace = (l, ob) => {
    ob.position.set(l.x, 0, l.z);
    ob.rotation.set(0, l.yaw, 0);
  };
  keep(chunkedInstances(group, poleGeo, new MeshStandardMaterial({ color: 0x2c2838, roughness: 0.6, metalness: 0.4 }), lampSpots, lampAt, lampPlace));
  keep(chunkedInstances(group, headGeo, headMat, lampSpots, lampAt, lampPlace, { receiveShadow: false }));
  keep(
    chunkedInstances(group, poolGeo, poolMat, lampSpots, lampAt, (l, ob) => {
      // the pool of light lies in the road, a few metres out from the head
      ob.position.set(l.x + Math.sin(l.yaw) * 1.2, 0.08, l.z + Math.cos(l.yaw) * 1.2);
    }, { receiveShadow: false }),
  );

  // ---- bunting
  const flagGeo = new BufferGeometry();
  flagGeo.setAttribute('position', new BufferAttribute(new Float32Array([-0.28, 0, 0, 0.28, 0, 0, 0, -0.62, 0]), 3));
  flagGeo.setIndex([0, 1, 2]);
  flagGeo.computeVertexNormals();
  const FLAGS = 9;
  const palette = ['#ff3d7f', '#ffb100', '#2ec4b6', '#7b5cff', '#ff6a3d', '#3dd68c', '#ffe14d'];
  const flags = [];
  for (const b of bunting) {
    for (let k = 0; k < FLAGS; k++) {
      const t = (k + 0.5) / FLAGS;
      const along = (t - 0.5) * b.span;
      flags.push({ x: b.cx + b.nx * along, z: b.cz + b.nz * along, y: 7.6 - 1.2 * Math.sin(t * Math.PI), yaw: b.yaw, tint: palette[(k + flags.length) % palette.length] });
    }
  }
  keep(
    chunkedInstances(group, flagGeo, foliageMaterial(shared, { sway: 0.3, key: 'flag', flat: true }), flags, (f) => [f.x, f.z], (f, ob, c) => {
      ob.position.set(f.x, f.y, f.z);
      ob.rotation.set(0, f.yaw, 0);
      return c.set(f.tint);
    }, { receiveShadow: false }),
  );

  // ---- real lights near the player: a pool that jumps to the closest lamps
  const POOL = 8;
  let active = POOL; // how many of them are on (quality)
  const lights = [];
  for (let i = 0; i < POOL; i++) {
    const pl = new PointLight(0xffb35c, 0, 30, 2);
    pl.castShadow = false;
    scene.add(pl);
    lights.push(pl);
  }
  const lampGrid = new Map();
  lampSpots.forEach((l, i) => {
    const k = `${Math.floor(l.x / 64)},${Math.floor(l.z / 64)}`;
    (lampGrid.get(k) || lampGrid.set(k, []).get(k)).push(i);
  });
  const best = [];
  function update(focus, night) {
    poolMat.opacity = night * 0.6;
    const on = night > 0.18;
    for (let i = 0; i < POOL; i++) lights[i].visible = on && i < active;
    if (!on) return;
    best.length = 0;
    const cx = Math.floor(focus.x / 64);
    const cz = Math.floor(focus.z / 64);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        for (const li of lampGrid.get(`${i},${j}`) || []) {
          const l = lampSpots[li];
          best.push({ li, d: (l.x - focus.x) ** 2 + (l.z - focus.z) ** 2 });
        }
      }
    }
    best.sort((a, b) => a.d - b.d);
    for (let i = 0; i < active; i++) {
      const b = best[i];
      const pl = lights[i];
      if (!b) {
        pl.intensity = 0;
        continue;
      }
      const l = lampSpots[b.li];
      pl.position.set(l.x + Math.sin(l.yaw) * 1.4, 6.0, l.z + Math.cos(l.yaw) * 1.4);
      pl.intensity = 38 * night;
    }
  }

  const setLightCount = (n) => { active = Math.max(0, Math.min(POOL, n | 0)); };
  return { group, meshes, update, setLightCount, lampSpots, treeSpots, palmSpots, counts: { trees: treeSpots.length, palms: palmSpots.length, lamps: lampSpots.length, bunting: bunting.length } };
}
