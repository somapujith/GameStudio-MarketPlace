// The dosa tawa station: heavy cast-iron tawa (lathe with a rounded lip, riveted iron handle) on a sooty brick chulha with an arched
// feed opening, a cast burner ring with a real blue gas flame, steel LPG hose, matchbox, rag. Station-local coordinates:
// counter top y = COUNTER_TOP, +z faces the cook, the tawa centre is at (0, ., TAWA_Z).
import { BufferGeometry, Color, ExtrudeGeometry, Float32BufferAttribute, Group, Mesh, MeshPhysicalMaterial, PointLight, Shape, SphereGeometry, TorusGeometry, Vector2, Vector3 } from 'three';
import { boxUV, lathe, merge, paint, place, sweep } from './geo.js';
import { createTawaMaterial } from './shaders/tawa.js';
import { createFlameMaterial, createGlowMaterial, flameRingGeometry, flameStripGeometry } from './shaders/flame.js';
import { createSteam } from './shaders/steam.js';
import { DosaSlot } from './food-dosa.js';
import { mapSet, pbrMaterial, plainMaterial, quality, registerQuality, textureSet } from './pbr.js';
import { patchMaterial } from './shaders/patch.js';
import { sharedGeo } from './util.js';
import { disposeObject } from './util.js';
import { smooth } from './fx.js';
import { buildTendProp } from './cookware-tend.js';

export const COUNTER_TOP = 0.82;
export const TAWA_Z = -0.03;
export const TAWA_R = 0.447;
export const BRICK_H = 0.24;
const BRICK_TOP = COUNTER_TOP + BRICK_H;
const TAWA_Y = BRICK_TOP + 0.0075;

// ---------------------------------------------------------------------------------------------------------------------
/** Brick material with soot: blackened pit, soot tongue above the arch, grime near the ground. Uses the brick map set. */
export function sootBrickMaterial(archZ = 0.4) {
  const set = textureSet('brick');
  const m = new MeshPhysicalMaterial({ color: '#b9a49a', map: set.map, roughnessMap: set.orm, aoMap: set.orm, roughness: 1, metalness: 0, envMapIntensity: 0.5 });
  m.defines = { TC_Q: quality().detail };
  patchMaterial(m, {
    key: 'soot-brick',
    uniforms: { uArch: { value: new Vector3(0, COUNTER_TOP + 0.1, archZ) } },
    fragPars: 'uniform vec3 uArch;',
    fragColor: `
      vec3 sp = vTcPos;
      vec2 sa = vec2((sp.x - uArch.x) / 0.34, (sp.y - uArch.y) / 0.2);
      float noise = tc_fbm(sp.xz * 9.0 + sp.y * 7.0);
      float tongue = exp(-dot(sa, sa) * 0.6) * smoothstep(-0.4, 0.5, sp.y - uArch.y + 0.14) * step(0.25, sp.z);
      float inside = step(abs(sp.x), 0.36) * step(abs(sp.z + 0.03), 0.285) * step(sp.y, ${(COUNTER_TOP + BRICK_H + 0.01).toFixed(3)});
      float dpit = max(abs(sp.x) - 0.35, abs(sp.z + 0.02) - 0.27);
      float rimSoot = (1.0 - smoothstep(0.0, 0.1 + 0.05 * noise, dpit)) * smoothstep(${(COUNTER_TOP + BRICK_H - 0.02).toFixed(3)}, ${(COUNTER_TOP + BRICK_H).toFixed(3)}, sp.y);
      float soot = clamp(tongue * (0.6 + 0.6 * noise) + inside + rimSoot * 0.9, 0.0, 1.0);
      float low = (1.0 - smoothstep(${COUNTER_TOP.toFixed(2)}, ${(COUNTER_TOP + 0.07).toFixed(2)}, sp.y)) * 0.3;
      float grime = 0.18 * smoothstep(0.35, 0.8, tc_fbm(sp.xy * 6.0 + sp.z * 5.0));
      diffuseColor.rgb = mix(diffuseColor.rgb * 0.8, vec3(0.006, 0.005, 0.004), clamp(soot + low + grime, 0.0, 1.0) * 0.94);`,
    fragRough: 'roughnessFactor = mix(roughnessFactor, 0.55, soot * 0.7);',
  });
  const off = registerQuality({
    apply(cfg) {
      const n = cfg.normal ? set.normalMap : null;
      if (m.normalMap !== n || m.defines.TC_Q !== cfg.detail) {
        m.normalMap = n;
        m.defines.TC_Q = cfg.detail;
        m.needsUpdate = true;
      }
    },
  });
  return { mat: m, dispose() { off(); m.dispose(); } };
}

// ---------------------------------------------------------------------------------------------------------------------
function tawaGeometry() {
  return sharedGeo('tawa:body', () => {
    // bottom-centre -> outer wall -> rounded lip -> inner wall -> dish -> top-centre (outward normals all the way)
    const prof = [
      [0, -0.0125], [0.18, -0.011], [0.32, -0.0075], [0.41, 0.006], [0.436, 0.02], [0.4465, 0.033],
      [0.4425, 0.0425], [0.4345, 0.0465], [0.4265, 0.0425], [0.4215, 0.033], [0.4165, 0.02], [0.395, 0.0085],
      [0.33, 0.0028], [0.2, 0.0006], [0, 0],
    ];
    const g = lathe(prof, Math.max(32, Math.round(56 * quality().segScale)), { sub: 0, uv: [1, 1] });
    g.computeTangents();
    return g;
  });
}

function handleGeometry() {
  return sharedGeo('tawa:handle', () => {
    const a = -0.5; // angle (radians) from +x toward -z... handle goes to the right and slightly back
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const pts = [];
    const S = [0, 0.07, 0.16, 0.26, 0.32];
    const Y = [0.036, 0.056, 0.056, 0.04, 0.025];
    for (let i = 0; i < S.length; i++) pts.push(new Vector3(dx * (0.43 + S[i]), Y[i], dz * (0.43 + S[i])));
    const rod = sweep(pts, (t) => [0.0125 - 0.005 * t, 0.0095 - 0.0025 * t], 6, { up: new Vector3(0, 1, 0) });
    // riveted tang plate on the lip
    const plate = place(new BufferGeometry().copy(boxUV(0.09, 0.006, 0.034, 0.3, 0.3)), { p: [dx * 0.455, 0.0475, dz * 0.455], r: [0, -a, 0] });
    const rivets = [0.43, 0.472].map((s) => place(sharedSphere(0.0065, 0.55), { p: [dx * s, 0.0525, dz * s] }));
    // hang-hole eye at the end
    const eye = place(sharedTorus(0.011, 0.0042), { p: [dx * 0.765, 0.0225, dz * 0.765], r: [0, -a, Math.PI / 2] });
    return merge([rod, plate, ...rivets, eye]);
  });
}

function sharedSphere(r, flat = 1) {
  const g = new SphereGeometry(r, 6, 4);
  g.scale(1, flat, 1);
  return g;
}
function sharedTorus(R, r) {
  return new TorusGeometry(R, r, 5, 10);
}

/** The ring burner: cast-iron body with a flame ring and a pot-support spider. */
function burnerGeometry() {
  return sharedGeo('tawa:burner', () => {
    const body = lathe([[0, 0], [0.14, 0], [0.15, 0.01], [0.155, 0.03], [0.14, 0.042], [0.105, 0.044, true], [0.085, 0.036], [0.06, 0.04, true], [0.045, 0.034], [0, 0.034]], 28, { sub: 0, uv: [2, 2] });
    const legs = [0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      return place(boxUV(0.03, 0.05, 0.03, 0.3, 0.3), { p: [Math.sin(a) * 0.15, -0.025, Math.cos(a) * 0.15] });
    });
    const pipe = sweep([new Vector3(0, 0.02, 0.14), new Vector3(0, 0.022, 0.22), new Vector3(0, 0.024, 0.3)], () => [0.017, 0.017], 8);
    return merge([body, ...legs, pipe]);
  });
}

/** Extruded front wall of the chulha with an arched feed opening (uv in metres / brick span). */
function archWallGeometry(w, h, depth) {
  return sharedGeo(`chulha:arch:${w}:${h}:${depth}`, () => {
    const s = new Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, h);
    s.lineTo(-w / 2, h);
    s.lineTo(-w / 2, 0);
    const hole = new Shape();
    const aw = 0.46;
    const ah = 0.1;
    const ar = 0.075;
    hole.moveTo(-aw / 2, 0);
    hole.lineTo(-aw / 2, ah);
    hole.absellipse(0, ah, aw / 2, ar, Math.PI, 0, true);
    hole.lineTo(aw / 2, 0);
    hole.lineTo(-aw / 2, 0);
    s.holes.push(hole);
    const g = new ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
    // world-scaled uv
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const nz = Math.abs(n.getZ(i));
      const a = nz > 0.5 ? p.getX(i) : Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i);
      const b = nz > 0.5 ? p.getY(i) : Math.abs(n.getY(i)) > 0.5 ? p.getZ(i) : p.getY(i);
      uv.setXY(i, a / 0.88 + 0.13, b / 0.6 + 0.07);
    }
    return g;
  });
}

export const CHULHA = { w: 1.0, d: 0.84, wall: 0.15, z: -0.02 };

export function chulhaGeometry() {
  return sharedGeo('tawa:chulha', () => {
    const { w, d, wall, z } = CHULHA;
    const parts = [];
    parts.push(place(boxUV(wall, BRICK_H, d, 0.88, 0.6, [0.21, 0.1]), { p: [-(w - wall) / 2, COUNTER_TOP + BRICK_H / 2, z] }));
    parts.push(place(boxUV(wall, BRICK_H, d, 0.88, 0.6, [0.55, 0.3]), { p: [(w - wall) / 2, COUNTER_TOP + BRICK_H / 2, z] }));
    parts.push(place(boxUV(w - 2 * wall, BRICK_H, wall, 0.88, 0.6, [0.33, 0.5]), { p: [0, COUNTER_TOP + BRICK_H / 2, z - (d - wall) / 2] }));
    const front = archWallGeometry(w - 2 * wall, BRICK_H, wall).clone();
    place(front, { p: [0, COUNTER_TOP, z + d / 2 - wall] });
    parts.push(front);
    // pit floor (soot black plate) and the inner ash lip
    parts.push(place(boxUV(w - 2 * wall, 0.01, d - wall * 1.4, 0.88, 0.6), { p: [0, COUNTER_TOP + 0.005, z - 0.02] }));
    return merge(parts);
  });
}

function hoseGeometry() {
  return sharedGeo('tawa:hose', () => {
    // braided steel LPG hose from the cylinder (back left) to the burner pipe
    const pts = [];
    const P = [[-0.5, COUNTER_TOP + 0.02, -0.4], [-0.55, COUNTER_TOP + 0.05, -0.2], [-0.5, COUNTER_TOP + 0.03, 0.08], [-0.34, COUNTER_TOP + 0.02, 0.2], [-0.12, COUNTER_TOP + 0.03, 0.3], [-0.02, COUNTER_TOP + 0.045, 0.33]];
    const curve = [];
    for (let i = 0; i < P.length; i++) curve.push(new Vector3(...P[i]));
    // Catmull-Rom resample
    const dense = [];
    for (let i = 0; i < curve.length - 1; i++) {
      const p0 = curve[Math.max(0, i - 1)];
      const p1 = curve[i];
      const p2 = curve[i + 1];
      const p3 = curve[Math.min(curve.length - 1, i + 2)];
      for (let k = 0; k < 3; k++) {
        const t = k / 3;
        const t2 = t * t;
        const t3 = t2 * t;
        const q = new Vector3();
        q.x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        q.y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        q.z = 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
        dense.push(q);
      }
    }
    dense.push(curve[curve.length - 1]);
    pts.push(...dense);
    const tube = sweep(pts, () => [0.0105, 0.0105], 6, { uv: [1, 22] });
    const f1 = sweep([new Vector3(-0.5, COUNTER_TOP + 0.02, -0.4), new Vector3(-0.5, COUNTER_TOP + 0.02, -0.37)], () => [0.015, 0.015], 8);
    const f2 = sweep([new Vector3(-0.045, COUNTER_TOP + 0.043, 0.325), new Vector3(0.0, COUNTER_TOP + 0.046, 0.335)], () => [0.016, 0.016], 8);
    return merge([tube, f1, f2]);
  });
}

/** LPG cylinder: painted steel with a collar, valve and regulator. */
export function lpgGeometry() {
  return sharedGeo('station:lpg', () => {
    const body = lathe([[0, 0], [0.13, 0], [0.153, 0.03], [0.155, 0.3], [0.15, 0.38], [0.1, 0.43], [0.055, 0.446, true], [0.052, 0.47]], 18, { sub: 0, uv: [1, 1] });
    paint(body, (x, y) => (y < 0.012 ? [0.15, 0.15, 0.15] : [0.86, 0.17, 0.12]));
    const collar = lathe([[0.1, 0.44], [0.103, 0.46], [0.1, 0.5], [0.095, 0.51]], 14, { sub: 0 });
    paint(collar, [0.2, 0.2, 0.2]);
    const valve = place(sweep([new Vector3(0, 0.5, 0), new Vector3(0, 0.55, 0.0)], () => [0.03, 0.03], 8), {});
    paint(valve, [0.75, 0.55, 0.14]);
    const reg = place(sweep([new Vector3(0, 0.52, 0), new Vector3(0.06, 0.52, 0.05)], () => [0.022, 0.022], 8), {});
    paint(reg, [0.12, 0.12, 0.12]);
    return merge([body, collar, valve, reg], true);
  });
}

function matchboxGeometry() {
  return sharedGeo('tawa:matchbox', () => {
    const sleeve = place(boxUV(0.052, 0.014, 0.036, 0.052, 0.036), { p: [0, 0.007, 0] });
    paint(sleeve, [0.7, 0.14, 0.1]);
    const tray = place(boxUV(0.05, 0.011, 0.034, 0.1, 0.1), { p: [0.012, 0.0055, 0.004] });
    paint(tray, [0.82, 0.62, 0.34]);
    const label = place(boxUV(0.03, 0.0005, 0.02, 0.1, 0.1), { p: [-0.004, 0.0145, 0] });
    paint(label, [0.96, 0.82, 0.3]);
    const sticks = [0, 1, 2, 3].map((i) => {
      const s = place(sweep([new Vector3(-0.02, 0, 0), new Vector3(0.02, 0, 0)], () => [0.0007, 0.0007], 4), { p: [-0.0, 0.0148 + 0.0004, -0.005 + i * 0.003], r: [0, i * 0.13, 0] });
      return paint(s, [0.78, 0.6, 0.35]);
    });
    const heads = [0, 1, 2, 3].map((i) => {
      const s = place(new SphereGeometry(0.0016, 6, 4), { p: [-0.02 * Math.cos(i * 0.13), 0.0152, -0.005 + i * 0.003 + 0.02 * Math.sin(i * 0.13)] });
      return paint(s, [0.55, 0.08, 0.06]);
    });
    return merge([sleeve, tray, label, ...sticks, ...heads], true);
  });
}

function ragGeometry() {
  return sharedGeo('tawa:rag', () => {
    // a crumpled cotton gamchha lying on the counter: a subdivided cloth with folds, drooping at the edges
    const nx = 10;
    const nz = 7;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const v = j / nz;
        const x = (u - 0.5) * 0.3;
        const z = (v - 0.5) * 0.2;
        const edge = Math.min(u, 1 - u, v, 1 - v);
        const fold = Math.sin(u * 9 + Math.sin(v * 5) * 2) * Math.cos(v * 7 + u * 3);
        const y = 0.003 + 0.016 * Math.max(0, fold) * Math.min(1, edge * 6) + 0.006 * Math.sin(u * 21 + v * 17) * Math.min(1, edge * 6) + (edge < 0.08 ? 0 : 0.004);
        pos.push(x, Math.max(0.001, y), z);
        uv.push(u * 0.9, v * 0.6);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
const SLOT_XZ = [[-0.26, 0.045], [0.0, -0.075], [0.26, 0.045]];

/**
 * buildTawaSet() -> { group, slots: DosaSlot[], anchors: Vector3[], update(dt, t), setFlame(on), dispose() }.
 * `group` is positioned in station-local space (its origin is the station origin).
 */
export function buildTawaSet() {
  const g = new Group();
  g.name = 'tawa-set';
  const owned = [];

  // chulha
  const brick = sootBrickMaterial();
  owned.push(brick);
  g.add(new Mesh(chulhaGeometry(), brick.mat));

  // burner + flame (+ light)
  const iron = pbrMaterial('iron-dark', { rough: 1, metal: 1, key: 'burner' });
  const burner = new Mesh(burnerGeometry(), iron);
  burner.position.set(0, COUNTER_TOP + 0.012, TAWA_Z);
  g.add(burner);
  const flameMats = [createFlameMaterial({ jets: 30, seed: 1, alpha: 0.95 }), createFlameMaterial({ jets: 20, seed: 4, alpha: 0.8 }), createFlameMaterial({ jets: 14, seed: 7, alpha: 0.7, orange: 0.35 })];
  owned.push(...flameMats.map((m) => ({ dispose: () => m.dispose() })));
  const rings = [[0.1, 0.075, 0], [0.065, 0.06, 1], [0.03, 0.05, 2]].map(([r, h, k]) => {
    const m = new Mesh(sharedGeo(`flame:ring:${r}:${h}`, () => flameRingGeometry(r, h, 32)), flameMats[k]);
    m.position.set(0, COUNTER_TOP + 0.052, TAWA_Z);
    m.renderOrder = 4;
    g.add(m);
    return m;
  });
  // flames licking out of the arch (a strip of tongues seen from the front)
  const archFlameMat = createFlameMaterial({ jets: 9, seed: 5, alpha: 1, orange: 0.5 });
  owned.push({ dispose: () => archFlameMat.dispose() });
  const archFlame = new Mesh(sharedGeo('tawa:archflame', () => flameStripGeometry(0.4, 0.13, 10)), archFlameMat);
  archFlame.position.set(0, COUNTER_TOP + 0.012, CHULHA.z + CHULHA.d / 2 - 0.1);
  archFlame.renderOrder = 5;
  g.add(archFlame);
  const glowMat = createGlowMaterial('#ff7a2a', 0.55);
  owned.push({ dispose: () => glowMat.dispose() });
  const glow = new Mesh(sharedGeo('tawa:glowquad', () => new BufferGeometry().setAttribute('position', new Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5], 3)).setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2)).setIndex([0, 2, 1, 1, 2, 3])), glowMat);
  glow.scale.set(0.5, 1, 0.5);
  glow.position.set(0, COUNTER_TOP + 0.014, TAWA_Z);
  glow.renderOrder = 3;
  g.add(glow);
  // glow on the arch front
  const frontGlow = new Mesh(sharedGeo('tawa:archglow', () => new BufferGeometry().setAttribute('position', new Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3)).setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2)).setIndex([0, 1, 2, 1, 3, 2])), glowMat);
  frontGlow.scale.set(0.5, 0.16, 1);
  frontGlow.position.set(0, COUNTER_TOP + 0.002, CHULHA.z + CHULHA.d / 2 + 0.006);
  frontGlow.renderOrder = 6;
  g.add(frontGlow);
  let light = null;
  if (quality().lights) {
    light = new PointLight('#ff9a4a', 1.2, 1.9, 2);
    light.position.set(0, COUNTER_TOP + 0.14, TAWA_Z + 0.05);
    g.add(light);
  }

  // tawa
  const tw = createTawaMaterial();
  owned.push(tw);
  const tawaMesh = new Mesh(tawaGeometry(), tw.mat);
  tawaMesh.position.set(0, TAWA_Y, TAWA_Z);
  g.add(tawaMesh);
  const handle = new Mesh(handleGeometry(), pbrMaterial('iron-dark', { rough: 1, metal: 1, key: 'handle' }));
  handle.position.copy(tawaMesh.position);
  g.add(handle);

  // clutter
  const hose = new Mesh(hoseGeometry(), pbrMaterial('steel-brushed', { rough: 1.1, metal: 1, key: 'hose', color: '#8a9096' }));
  g.add(hose);
  const matchbox = new Mesh(matchboxGeometry(), plainMaterial('matchbox', { vertexColors: true, roughness: 0.75, metalness: 0 }));
  matchbox.position.set(0.585, COUNTER_TOP, 0.33);
  matchbox.rotation.y = 0.5;
  g.add(matchbox);
  const rag = new Mesh(ragGeometry(), pbrMaterial('cloth', { rough: 1, metal: 0, color: '#b5322a', side: 2, key: 'rag' }));
  rag.position.set(-0.58, COUNTER_TOP, 0.17);
  rag.rotation.y = Math.PI / 2 + 0.2;
  rag.scale.setScalar(0.62);
  g.add(rag);

  // dosa slots
  const tu = tw.uniforms;
  const spots = [tu.uSpot0.value, tu.uSpot1.value, tu.uSpot2.value];
  const slots = SLOT_XZ.map(([x, z], i) => new DosaSlot(g, { x, y: TAWA_Y + 0.0035, z: TAWA_Z + z, seed: 0.31 + i * 0.23, spot: spots[i] }));
  // the tawa shader works in the tawa's own (lathe) space: x, z relative to the tawa centre
  slots.forEach((s, i) => {
    s.x = SLOT_XZ[i][0];
    s.z = SLOT_XZ[i][1];
    s.apply(0);
  });
  const anchors = slots.map((s) => new Vector3(s.root.position.x, TAWA_Y + 0.02, s.root.position.z));

  const flameParts = [...flameMats, archFlameMat];
  // pan tending: the cotton pad with half an onion that wipes the iron
  const wipe = buildTendProp('wipe', { y: TAWA_Y, z: TAWA_Z });
  g.add(wipe.group);
  let lightT = 0;
  let burnerOn = true;
  let flamePower = 1;
  const api = {
    group: g,
    slots,
    anchors,
    tawaY: TAWA_Y,
    uniforms: tw.uniforms,
    update(dt, t) {
      for (const s of slots) s.update(dt, t);
      lightT = t;
      if (light) light.intensity = burnerOn ? (1.1 + 0.25 * Math.sin(t * 13) + 0.15 * Math.sin(t * 29) + 0.1 * Math.sin(t * 7.3)) * (0.35 + 0.65 * flamePower) : 0;
    },
    setFlame(on) {
      rings.forEach((m) => (m.visible = on));
      archFlame.visible = on;
      glow.visible = on;
      frontGlow.visible = on;
      if (light) light.visible = on;
    },
    /** The gas burner: flame, glow and the steam / smoke of the dishes on or off; `power` 0..1 shortens the flame (a low cylinder). */
    setBurner(on, power = 1) {
      burnerOn = !!on;
      flamePower = on ? Math.max(0.05, Math.min(1, power)) : 0;
      api.setFlame(burnerOn);
      for (const m of flameParts) m.uniforms.uPower.value = flamePower;
      for (const s of slots) {
        s.steam.points.visible = burnerOn;
        s.smoke.points.visible = burnerOn;
      }
    },
    /** Heat and seasoning of the iron (ops-view.panView): the scorch colour, the cherry glow when too hot, the burnt-on crust. */
    setHeat(v) {
      const u = tw.uniforms;
      u.uGunk.value = v && Number.isFinite(v.gunk) ? v.gunk : 0;
      u.uHot.value = v && Number.isFinite(v.hot) ? v.hot : 0;
      u.uHeat.value = 0.55 + (v && Number.isFinite(v.glow) ? v.glow : 0.5);
    },
    /** One beat of the wiping (kind 'wipe', t01 0..1). */
    tend(kind, t01) {
      if (kind === 'wipe') wipe.play(t01);
    },
    dispose() {
      for (const s of slots) s.dispose();
      for (const o of owned) o.dispose();
      wipe.dispose();
      light?.dispose?.();
      light?.removeFromParent();
      g.removeFromParent();
    },
  };
  return api;
}

export { Color, Vector2, disposeObject, smooth, mapSet };
