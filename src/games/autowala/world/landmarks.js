// The famous places, hand-built from low-poly primitives and placed on the blocks layout.js reserved for them.
// Stone materials glow warmly after dark (floodlit), signs and domes feed the bloom pass.
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
} from 'three';
import { buildingMaterial, glowMaterial, setLookAttribute } from '../render/materials.js';
import { signTexture } from '../render/textures.js';
import { freezeMatrices, mergeStaticMeshes } from '../render/merge-static.js';

// one material per distinct look: the hand-built models ask for the same few colours hundreds of times, and parts only merge
// (render/merge-static.js) when they share a material
const stdCache = new Map();
const std = (color, o = {}) => {
  const key = `${color}|${JSON.stringify(o)}`;
  let m = stdCache.get(key);
  if (!m) stdCache.set(key, (m = new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...o })));
  return m;
};

export function buildLandmarks(scene, city, colliders, shared) {
  const root = new Group();
  scene.add(root);
  const lit = []; // materials that glow at night: [material, strength]
  const stone = (c) => {
    const m = std(c, { emissive: new Color('#ff8a4a'), emissiveIntensity: 0 });
    lit.push([m, 0.34]);
    return m;
  };
  const MAT = {
    cream: stone('#f3e3c6'),
    sand: stone('#e7c9a0'),
    brick: stone('#c9604a'),
    white: stone('#f6f1ea'),
    gold: new MeshStandardMaterial({ color: 0xe9b64a, roughness: 0.3, metalness: 0.75, emissive: new Color('#ffb100'), emissiveIntensity: 0.12 }),
    dark: std('#3a3446'),
    rock: std('#b88a76', { flatShading: true, roughness: 1 }),
    grass: std('#6fae5a'),
    glassTint: std('#6ec4ee', { roughness: 0.15, metalness: 0.6 }),
    red: std('#e03a4a'),
  };
  const glowSign = (key, w, h, bg, bd, lines) => {
    const tex = signTexture(key, { w: 512, h: Math.round(512 * (h / w)), bg, border: bd, lines });
    return new Mesh(new PlaneGeometry(w, h), glowMaterial(0xffffff, 1.35, tex));
  };

  const put = (parent, mesh, x, y, z, { cast = true, receive = true } = {}) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
    return mesh;
  };
  const box = (parent, w, h, d, mat, x, y, z) => put(parent, new Mesh(new BoxGeometry(w, h, d), mat), x, y + h / 2, z);
  const cyl = (parent, rt, rb, h, mat, x, y, z, seg = 14) => put(parent, new Mesh(new CylinderGeometry(rt, rb, h, seg), mat), x, y + h / 2, z);
  const dome = (parent, r, mat, x, y, z, sy = 0.9) => {
    const m = put(parent, new Mesh(new SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat), x, y, z);
    m.scale.y = sy;
    return m;
  };
  const cone = (parent, r, h, mat, x, y, z, seg = 8) => put(parent, new Mesh(new ConeGeometry(r, h, seg), mat), x, y + h / 2, z);
  // a window-shader tower: an InstancedMesh of one, so the facade shader knows the building's real size
  const tower = (parent, w, h, d, x, z, color, look) => {
    const geo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mesh = new InstancedMesh(geo, buildingMaterial(shared), 1);
    const o = new Object3D();
    o.position.set(x, 0, z);
    o.scale.set(w, h, d);
    o.updateMatrix();
    mesh.setMatrixAt(0, o.matrix);
    mesh.setColorAt(0, new Color(color));
    setLookAttribute(mesh, [look]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
  };
  const arches = (parent, n, w, h, x, z, face, mat) => {
    // dark arched recesses on a facade (a rounded top made from a half-cylinder + box)
    for (let i = 0; i < n; i++) {
      const gx = (i - (n - 1) / 2) * (w * 1.35);
      const g = new Group();
      g.position.set(x + (face === 'x' ? 0 : gx), 0, z + (face === 'x' ? gx : 0));
      g.rotation.y = face === 'x' ? Math.PI / 2 : 0;
      const body = new Mesh(new BoxGeometry(w, h - w / 2, 0.5), mat);
      body.position.y = (h - w / 2) / 2;
      const top = new Mesh(new CylinderGeometry(w / 2, w / 2, 0.5, 14, 1, false, 0, Math.PI), mat);
      top.rotation.x = Math.PI / 2;
      top.position.y = h - w / 2;
      g.add(body, top);
      parent.add(g);
    }
  };

  const spots = {};
  const at = (id) => city.poiById[id];

  // ---------------------------------------------------------------- Charminar
  {
    const p = at('charminar');
    if (p) {
      const g = new Group();
      g.position.set(p.x, 0.2, p.z);
      const S = Math.min(1.05, Math.min(p.w, p.d) / 34);
      g.scale.setScalar(S);
      root.add(g);
      const plaza = new Mesh(new RingGeometry(14.5, 17.5, 40), new MeshStandardMaterial({ color: 0x9c2f3f, roughness: 1 }));
      plaza.rotation.x = -Math.PI / 2;
      plaza.position.y = 0.05;
      g.add(plaza);
      box(g, 25, 1.2, 25, MAT.sand, 0, 0, 0);
      box(g, 21, 15, 21, MAT.cream, 0, 1.2, 0);
      const dark = std('#4a2f4a');
      for (const f of [[0, 10.6, 'z'], [0, -10.6, 'z']]) arches(g, 3, 4.4, 9.5, f[0], f[1], f[2], dark);
      for (const f of [[10.6, 0, 'x'], [-10.6, 0, 'x']]) arches(g, 3, 4.4, 9.5, f[0], f[1], f[2], dark);
      box(g, 22.4, 1.2, 22.4, MAT.sand, 0, 16.2, 0); // cornice
      box(g, 13, 4.8, 13, MAT.cream, 0, 17.4, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * 11.2;
        const z = sz * 11.2;
        cyl(g, 1.35, 1.6, 34, MAT.cream, x, 1.2, z, 12);
        for (const y of [10, 20, 28]) cyl(g, 2.1, 2.1, 0.7, MAT.sand, x, y, z, 12);
        cyl(g, 1.6, 1.4, 4.4, MAT.cream, x, 34.2, z, 12);
        dome(g, 1.9, MAT.cream, x, 38.6, z, 1.1);
        cone(g, 0.18, 3.4, MAT.gold, x, 40.6, z, 6);
        // little chhatri on the roof line
        dome(g, 1.1, MAT.cream, sx * 4.8, 22.2, sz * 4.8, 1);
      }
      dome(g, 3.6, MAT.cream, 0, 22.2, 0, 0.8);
      cone(g, 0.2, 3, MAT.gold, 0, 25.2, 0, 6);
      colliders.addCentered(p.x, p.z, 24 * S, 24 * S, 'landmark', 40);
      spots.charminar = { x: p.x, z: p.z };
    }
  }

  // ---------------------------------------------------------------- Mecca Masjid
  {
    const p = at('mecca');
    if (p) {
      const g = new Group();
      g.position.set(p.x, 0.2, p.z);
      root.add(g);
      const W = Math.min(34, p.w - 8);
      const D = Math.min(20, p.d - 8);
      box(g, W + 2, 1, D + 2, MAT.sand, 0, 0, 0);
      box(g, W, 13, D, MAT.sand, 0, 1, 0);
      arches(g, 5, 4.2, 9, 0, D / 2 + 0.2, 'z', std('#4a2f4a'));
      box(g, W + 1, 1.2, D + 1, MAT.cream, 0, 14, 0);
      for (const x of [-W / 2, W / 2]) {
        cyl(g, 1.2, 1.5, 24, MAT.cream, x, 1, D / 2, 10);
        dome(g, 1.6, MAT.cream, x, 25, D / 2, 1.2);
        cone(g, 0.15, 2.4, MAT.gold, x, 26.8, D / 2, 6);
      }
      dome(g, 4, MAT.cream, 0, 15.2, -2, 0.7);
      colliders.addCentered(p.x, p.z, W, D, 'landmark', 15);
      spots.mecca = { x: p.x, z: p.z };
    }
  }

  // ---------------------------------------------------------------- Secunderabad station
  {
    const p = at('station');
    if (p) {
      const g = new Group();
      g.position.set(p.x, 0.2, p.z);
      root.add(g);
      const W = Math.min(46, p.w - 6);
      const D = Math.min(18, p.d - 10);
      box(g, W, 11, D, MAT.brick, 0, 0, 0);
      box(g, W + 1.2, 1, D + 1.2, MAT.white, 0, 11, 0);
      arches(g, 6, 3, 6.5, 0, D / 2 + 0.2, 'z', std('#3a2a3a'));
      // clock tower
      box(g, 7, 22, 7, MAT.brick, 0, 11, 0);
      box(g, 8.4, 1.2, 8.4, MAT.white, 0, 33, 0);
      cone(g, 4.6, 7, MAT.red, 0, 34.2, 0, 4);
      const clockTex = signTexture('clock', { w: 256, h: 256, bg: '#fff6d8', border: '#c2563e', glow: false, lines: [{ text: '12', font: '800 70px sans-serif', color: '#2a1030', dy: -60 }, { text: '6', font: '800 70px sans-serif', color: '#2a1030', dy: 60 }, { text: '|', font: '800 90px sans-serif', color: '#c2563e', dy: -4 }] });
      for (const [rx, rz, ry] of [[0, 3.6, 0], [0, -3.6, Math.PI], [3.6, 0, Math.PI / 2], [-3.6, 0, -Math.PI / 2]]) {
        const c = new Mesh(new PlaneGeometry(4.6, 4.6), glowMaterial(0xffffff, 1.2, clockTex));
        c.position.set(rx, 27.5, rz);
        c.rotation.y = ry;
        g.add(c);
      }
      const sg = glowSign('station', 12, 3, '#14102e', '#ff3d9a', [{ text: 'SECUNDERABAD JN', font: '800 52px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#ffd1ea' }]);
      put(g, sg, 0, 8.4, D / 2 + 0.9, { cast: false, receive: false });
      colliders.addCentered(p.x, p.z, W, D, 'landmark', 22);
      spots.station = { x: p.x, z: p.z };
    }
  }

  // ---------------------------------------------------------------- Cyber Towers (Hi-Tech City)
  {
    const p = at('cyber');
    if (p) {
      const g = new Group();
      g.position.set(p.x, 0, p.z);
      root.add(g);
      const look = 'cyber'; // a name in BUILDING_LOOKS (render/materials.js)
      box(g, Math.min(p.w - 16, 70), 3, Math.min(p.d - 16, 70), MAT.white, 0, 0, 0);
      tower(g, 26, 118, 26, -16, -10, '#7fb8f0', look);
      tower(g, 24, 96, 24, 18, 12, '#b18af0', look);
      tower(g, 18, 62, 18, 20, -22, '#6fd0d0', look);
      cone(g, 7, 16, MAT.glassTint, -16, 118, -10, 4).rotation.y = Math.PI / 4;
      // sky bridge
      box(g, 22, 3, 5, MAT.glassTint, 0, 54, 4);
      colliders.addCentered(p.x - 16, p.z - 10, 26, 26, 'landmark', 118);
      colliders.addCentered(p.x + 18, p.z + 12, 24, 24, 'landmark', 96);
      colliders.addCentered(p.x + 20, p.z - 22, 18, 18, 'landmark', 62);
      spots.cyber = { x: p.x, z: p.z };
    }
  }

  // ---------------------------------------------------------------- Birla Mandir (white temple on a rock hill)
  {
    const p = at('birla');
    if (p) {
      const g = new Group();
      g.position.set(p.x, 0, p.z);
      root.add(g);
      const hill = new Mesh(new IcosahedronGeometry(1, 1), MAT.rock);
      hill.scale.set(Math.min(34, p.w / 2 - 3), 9, Math.min(30, p.d / 2 - 3));
      put(g, hill, 0, 3.5, 0);
      box(g, 16, 1.2, 16, MAT.white, 0, 9.6, 0);
      box(g, 11, 8, 11, MAT.white, 0, 10.8, 0);
      for (let i = 0; i < 6; i++) box(g, 9.4 - i * 1.3, 2, 9.4 - i * 1.3, MAT.white, 0, 18.8 + i * 2, 0);
      cone(g, 0.4, 3.6, MAT.gold, 0, 30.8, 0, 6);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        box(g, 3.2, 4.2, 3.2, MAT.white, sx * 6.4, 10.8, sz * 6.4);
        cone(g, 2.4, 3.4, MAT.white, sx * 6.4, 15, sz * 6.4, 4);
      }
      colliders.addCentered(p.x, p.z, 40, 34, 'landmark', 18);
      spots.birla = { x: p.x, z: p.z };
    }
  }

  // ---------------------------------------------------------------- Golconda Fort
  {
    const p = at('golconda');
    if (p) {
      const g = new Group();
      g.position.set(p.x, 0, p.z);
      root.add(g);
      const R = Math.min(p.w, p.d) / 2 - 8;
      const hill = new Mesh(new IcosahedronGeometry(1, 2), MAT.rock);
      hill.scale.set(R, 30, R * 0.9);
      put(g, hill, 0, 8, 0);
      const wall = std('#c9a088', { flatShading: true });
      const ring = 24;
      for (let i = 0; i < ring; i++) {
        const a = (i / ring) * Math.PI * 2;
        const x = Math.cos(a) * R * 0.78;
        const z = Math.sin(a) * R * 0.7;
        const seg = box(g, (Math.PI * 2 * R * 0.78) / ring + 0.4, 6, 2.2, wall, x, 22, z);
        seg.rotation.y = -a + Math.PI / 2;
        if (i % 3 === 0) {
          cyl(g, 3.2, 3.6, 10, wall, x, 22, z, 8);
          dome(g, 3.4, wall, x, 32, z, 0.7);
        }
        for (let k = -1; k <= 1; k += 2) {
          const m = box(g, 0.9, 1.2, 1, wall, x + Math.cos(a + Math.PI / 2) * k * 2.2, 28, z + Math.sin(a + Math.PI / 2) * k * 2.2);
          m.rotation.y = seg.rotation.y;
        }
      }
      box(g, 14, 13, 14, MAT.sand, 0, 28, 0);
      dome(g, 7.2, MAT.cream, 0, 41, 0, 0.75);
      cone(g, 0.3, 4, MAT.gold, 0, 46, 0, 6);
      colliders.addCentered(p.x, p.z, R * 1.2, R * 1.1, 'landmark', 40);
      spots.golconda = { x: p.x, z: p.z };
    }
  }

  // ---------------------------------------------------------------- Airport
  {
    const p = at('airport');
    if (p) {
      const g = new Group();
      g.position.set(p.x, 0, p.z);
      root.add(g);
      const W = Math.min(100, p.w - 12);
      const D = Math.min(34, p.d / 3);
      const tz = -p.d / 2 + D / 2 + 8;
      box(g, W, 12, D, MAT.white, 0, 0, tz);
      const roof = new Mesh(new CylinderGeometry(D * 0.62, D * 0.62, W + 2, 14, 1, false, 0, Math.PI), std('#cfe4f0', { metalness: 0.5, roughness: 0.3 }));
      roof.rotation.z = Math.PI / 2;
      roof.rotation.y = Math.PI / 2;
      roof.scale.y = 0.34;
      put(g, roof, 0, 12, tz);
      box(g, W - 4, 7, 0.5, MAT.glassTint, 0, 1.5, tz + D / 2 + 0.2);
      cyl(g, 2.4, 3.2, 38, MAT.white, W / 2 + 7, 0, tz + 4, 10);
      cyl(g, 4.6, 3, 5, MAT.glassTint, W / 2 + 7, 38, tz + 4, 10);
      const sg = glowSign('airport', 22, 4, '#08183a', '#4d8bff', [{ text: 'HYDERABAD', font: '800 70px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#cfe0ff' }, { text: 'శంషాబాద్ AIRPORT', font: '700 32px "Noto Sans Telugu Variable", sans-serif', color: '#4d8bff' }]);
      put(g, sg, 0, 14, tz + D / 2 + 1, { cast: false, receive: false });
      // apron + a parked airliner
      const apron = new Mesh(new PlaneGeometry(W + 20, 54), std('#5a5568'));
      apron.rotation.x = -Math.PI / 2;
      put(g, apron, 0, 0.1, tz + D / 2 + 30, { cast: false });
      const plane = new Group();
      cyl(plane, 2.4, 2.4, 34, MAT.white, 0, 0, 0, 12).rotation.z = Math.PI / 2;
      plane.children[0].position.set(0, 3.2, 0);
      const wing = box(plane, 8, 0.5, 30, MAT.white, -2, 2.4, 0);
      cone(plane, 2.4, 6, MAT.white, 20, 0, 0, 12).rotation.z = -Math.PI / 2;
      plane.children[plane.children.length - 1].position.set(19.5, 3.2, 0);
      const tail = box(plane, 5, 7, 0.6, std('#ff3d7f'), -15, 3.2, 0);
      plane.position.set(-12, 0, tz + D / 2 + 28);
      g.add(plane);
      colliders.addCentered(p.x, p.z + tz, W, D, 'landmark', 14);
      colliders.addCentered(p.x - 12, p.z + tz + D / 2 + 28, 36, 10, 'landmark', 8);
      spots.airport = { x: p.x, z: p.z + tz + D / 2 + 20 };
    }
  }

  // ---------------------------------------------------------------- Mama's Garage
  {
    const p = at('garage');
    if (p) {
      const g = new Group();
      g.position.set(p.x, 0.2, p.z);
      root.add(g);
      const W = Math.min(22, p.w - 8);
      const D = Math.min(14, p.d - 8);
      box(g, W, 7, D, std('#2ec4b6'), 0, 0, 0);
      box(g, W + 1, 0.8, D + 1, MAT.dark, 0, 7, 0);
      box(g, W * 0.6, 4.6, 0.4, std('#1a1030'), 0, 0, D / 2 + 0.06); // open bay
      for (let i = 0; i < 4; i++) cyl(g, 0.7, 0.7, 0.5, std('#1a1a22'), -W / 2 + 1.5, i * 0.52, D / 2 + 1.6, 12);
      const sg = glowSign('garage', 14, 3.4, '#0a1630', '#37e6ff', [{ text: "MAMA'S GARAGE", font: '800 56px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#bff6ff' }, { text: 'మామా గ్యారేజ్ · UPGRADES', font: '700 28px "Noto Sans Telugu Variable", sans-serif', color: '#37e6ff' }]);
      put(g, sg, 0, 8.9, D / 2 + 0.7, { cast: false, receive: false });
      colliders.addCentered(p.x, p.z, W, D, 'landmark', 8);
      spots.garage = { x: p.x, z: p.z };
    }
  }

  // ---------------------------------------------------------------- Stadium
  {
    const p = at('stadium');
    if (p) {
      const g = new Group();
      g.position.set(p.x, 0, p.z);
      root.add(g);
      const R = Math.min(p.w, p.d) / 2 - 7;
      const bowl = new Mesh(new CylinderGeometry(R, R * 0.8, 15, 28, 1, true), new MeshStandardMaterial({ color: 0xe7e0f0, roughness: 0.8, side: DoubleSide }));
      put(g, bowl, 0, 7.5, 0);
      const field = new Mesh(new CylinderGeometry(R * 0.7, R * 0.7, 0.4, 28), MAT.grass);
      put(g, field, 0, 0.3, 0);
      const pitch = new Mesh(new PlaneGeometry(4, 18), std('#d9c88a'));
      pitch.rotation.x = -Math.PI / 2;
      put(g, pitch, 0, 0.55, 0, { cast: false });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const x = Math.cos(a) * (R + 3);
        const z = Math.sin(a) * (R + 3);
        cyl(g, 0.5, 0.8, 32, MAT.dark, x, 0, z, 6);
        const lamp = new Mesh(new BoxGeometry(6, 3, 1), glowMaterial(0xfff4d0, 1.6));
        lamp.position.set(x, 33, z);
        lamp.lookAt(0, 20, 0);
        g.add(lamp);
      }
      colliders.addCentered(p.x, p.z, R * 2, R * 2, 'landmark', 15);
      spots.stadium = { x: p.x, z: p.z };
    }
  }

  // ---------------------------------------------------------------- Hospital
  {
    const p = at('hospital');
    if (p) {
      const g = new Group();
      g.position.set(p.x, 0.2, p.z);
      root.add(g);
      const W = Math.min(34, p.w - 8);
      const D = Math.min(20, p.d - 8);
      tower(g, W, 20, D, 0, 0, '#f4f0ff', 'hosp');
      const cross = new Mesh(new PlaneGeometry(6, 6), glowMaterial(0xffffff, 1.3, signTexture('redcross', { w: 128, h: 128, bg: '#ffffff', border: '#ff2a3a', glow: false, lines: [{ text: '+', font: '800 120px sans-serif', color: '#ff2a3a', dy: 4 }] })));
      put(g, cross, 0, 15, D / 2 + 0.2, { cast: false, receive: false });
      const sg = glowSign('hospital', 14, 3, '#071a2a', '#3dd68c', [{ text: 'CARE HOSPITAL', font: '800 54px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#c8ffe8' }, { text: '24×7 EMERGENCY', font: '700 26px "Bricolage Grotesque Variable", sans-serif', color: '#ff5d6a' }]);
      put(g, sg, 0, 22, D / 2 + 0.4, { cast: false, receive: false });
      colliders.addCentered(p.x, p.z, W, D, 'landmark', 20);
      spots.hospital = { x: p.x, z: p.z };
    }
  }

  // ---------------------------------------------------------------- Irani cafe
  {
    const p = at('irani');
    if (p) {
      const g = new Group();
      g.position.set(p.x, 0.2, p.z);
      root.add(g);
      const W = Math.min(16, p.w - 8);
      const D = Math.min(11, p.d - 8);
      box(g, W, 6, D, std('#fff0d0'), 0, 0, 0);
      box(g, W + 0.8, 0.6, D + 0.8, std('#c2563e'), 0, 6, 0);
      box(g, W + 1.6, 0.3, 2.8, std('#3d6bff'), 0, 3.4, D / 2 + 1.2);
      for (let i = 0; i < 4; i++) { cyl(g, 0.5, 0.5, 0.8, MAT.dark, -W / 2 + 2 + i * 3.4, 0, D / 2 + 3, 8); }
      const sg = glowSign('irani', 11, 2.8, '#2a1038', '#ffb100', [{ text: 'NIMRAH CAFE', font: '800 58px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#ffe08a' }, { text: 'ఇరానీ చాయ్ · OSMANIA', font: '700 28px "Noto Sans Telugu Variable", sans-serif', color: '#ffb100' }]);
      put(g, sg, 0, 7.8, D / 2 + 0.6, { cast: false, receive: false });
      colliders.addCentered(p.x, p.z, W, D, 'landmark', 7);
      spots.irani = { x: p.x, z: p.z };
    }
  }

  // ---------------------------------------------------------------- CNG stations
  for (const id of ['cng_old', 'cng_north', 'cng_west', 'cng_south']) {
    const p = at(id);
    if (!p) continue;
    const g = new Group();
    g.position.set(p.x, 0.2, p.z);
    root.add(g);
    const W = Math.min(18, p.w - 8);
    const D = Math.min(12, p.d - 14);
    box(g, W, 0.5, D, std('#8e8a99'), 0, 0, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.3, 0.3, 5.6, MAT.white, sx * (W / 2 - 1), 0.5, sz * (D / 2 - 1), 6);
    box(g, W + 1.5, 0.7, D + 1.5, std('#0e8a5a'), 0, 6.1, 0);
    for (const sx of [-1, 1]) {
      box(g, 1.1, 2.1, 0.8, std('#0e8a5a'), sx * 3.2, 0.5, 0);
      box(g, 0.8, 0.7, 0.2, glowMaterial(0x7dffb0, 1.4), sx * 3.2, 2.0, 0.5);
    }
    const sg = glowSign('cng', 7, 3, '#04201a', '#3dffb0', [{ text: 'CNG', font: '800 120px "Bricolage Grotesque Variable", Impact, sans-serif', color: '#c8ffe8' }, { text: 'GAS · 24 HRS', font: '700 28px "Bricolage Grotesque Variable", sans-serif', color: '#3dffb0' }]);
    put(g, sg, 0, 8.2, D / 2 + 0.4, { cast: false, receive: false });
    colliders.addCentered(p.x, p.z, 2.4, 1.5, 'landmark', 3);
    spots[id] = { x: p.x, z: p.z };
  }

  // Static batching: a landmark is dozens of tiny meshes, each a draw call in the camera pass AND in the shadow pass (they were ~60 +
  // ~57 calls a frame with Charminar in view). Bake every landmark into one mesh per material; parts too small to show in the shadow
  // map stop casting.
  let merged = { before: 0, after: 0 };
  for (const g of root.children) {
    const r = mergeStaticMeshes(g, { minShadowRadius: 1.2 });
    merged = { before: merged.before + r.before, after: merged.after + r.after };
    freezeMatrices(g);
  }
  stdCache.clear(); // the materials live on in the meshes; the cache must not keep them (or a disposed one) across rebuilds

  function update(night) {
    for (const [m, k] of lit) m.emissiveIntensity = night * k;
  }
  return { group: root, update, spots, merged };
}
