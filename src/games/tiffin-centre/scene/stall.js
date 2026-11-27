// The stall shell, seen from the cook's eyes: a Hyderabadi roadside tiffin stall on a footpath.
//   * the cook line (z = 0) on a worn concrete slab, a counter row at z = -1 (the station props sit on it; stations that are not on the level's
//     list become tidy empty counter space), the serving ledge whose customer-side edge is at z = -1.65;
//   * overhead: corrugated tin on bamboo rafters (rust, drip stains, gaps the sun comes through), a blue tarpaulin patch tied down with rope,
//     hanging bulbs on a wire, a tube-light, the flex banner seen from behind, your menu board, hanging cloths;
//   * beside you: shelves of jars and tiffin carriers, a steel bucket, the LPG cylinders and hose, brick-lined stove bases, plate racks, the bin.
// Everything is merged per material (a handful of draw calls); lights, shafts and dust motes respond to the hour via `setLight`.
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  CylinderGeometry, Object3D, PlaneGeometry, PointLight, Points, PointsMaterial, Quaternion, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector3, Vector2,
} from 'three';
import { LAYOUT, STATIONS, STATION_IDS } from '../../../../shared/tiffin-centre/catalog.js';
import * as models from '../models/index.js';
import { createKit, shade } from './kit.js';
import { tubeFlicker } from './lighting.js';
import { mulberry } from './textures.js';
import { SHELF_BATTERS, SHELF_JARS, approach, stockOf, swapPose } from './ops-view.js';

const srgb = (c, rgb, k = 1) => c.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k, SRGBColorSpace);

// geometry of the shell (metres)
export const SHELL = {
  halfW: 4.75, // side walls at +-halfW
  roofFrontZ: -2.0, roofFrontY: 2.6, roofRearZ: 2.7, roofRearY: 3.12,
  counterTop: 0.82, ledgeTop: 0.83, rearZ: 2.6,
};

const SHAFT_VERT = /* glsl */ `
  varying float vT; varying vec3 vL;
  void main() { vL = position; vT = position.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const SHAFT_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uStrength; uniform float uTime; uniform float uSeed;
  varying float vT; varying vec3 vL;
  void main() {
    float along = smoothstep(0.0, 0.06, vT) * pow(1.0 - vT, 1.25);
    vec2 e = abs(vL.xy) * 2.0;
    float edge = (1.0 - smoothstep(0.55, 1.0, e.x)) * (1.0 - smoothstep(0.6, 1.0, e.y));
    float dust = 0.72 + 0.28 * sin(vT * 21.0 - uTime * 0.6 + uSeed) * sin(vT * 7.3 + uTime * 0.35 + uSeed * 2.0);
    float a = uStrength * along * edge * dust;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export function createStall({ scene, art, tr, quality, onPropCreated }) {
  art.setQuality?.(quality);
  const k = createKit(tr);
  const { T, std, box, cyl, plane, put } = k;
  const root = new Group();
  root.name = 'stall';
  scene.add(root);
  const rnd = mulberry(77);
  const tmpC = new Color();
  const post = !!quality.post;

  // --- materials ---------------------------------------------------------------------------------------------------------------------------
  const M = {
    steel: k.pbr(art.steel()),
    teal: k.pbr(art.paintedWood([0.07, 0.42, 0.4])),
    maroon: k.pbr(art.paintedWood([0.45, 0.1, 0.1])),
    timber: k.pbr(art.timber()),
    tin: k.pbr(art.tin(), { side: DoubleSide }),
    concrete: k.pbr(art.concrete()),
    bamboo: k.pbr(art.bamboo()),
    brick: k.pbr(art.brick(), { metalness: 0 }),
    tarp: k.pbr(art.tarp([0.17, 0.32, 0.52]), { metalness: 0, side: DoubleSide }),
    tarpOrange: k.pbr(art.tarp([0.62, 0.32, 0.12]), { metalness: 0, side: DoubleSide }),
    cloth: k.pbr(art.cloth(), { metalness: 0, color: '#ded6c4' }),
    plaster: k.pbr(art.plaster(), { metalness: 0, color: '#d9d0bf', normal: 0.5 }),
    steelPlain: std('#c9ced2', { metalness: 1, roughness: 0.34 }),
    steelDull: std('#8d969c', { metalness: 1, roughness: 0.5 }),
    steelDark: std('#4b5156', { metalness: 1, roughness: 0.55 }),
    iron: std('#2a2623', { metalness: 0.6, roughness: 0.6 }),
    rubber: std('#17140f', { roughness: 0.85 }),
    rope: std('#8a6a3a', { roughness: 0.95 }),
    redPlastic: std('#cc2f22', { roughness: 0.5 }),
    bluePlastic: std('#2a62b4', { roughness: 0.5 }),
    whitePlastic: std('#e4e0d4', { roughness: 0.5 }),
    greenBin: std('#2f7a44', { roughness: 0.55 }),
    brass: std('#b98a2a', { metalness: 1, roughness: 0.35 }),
    lpg: std('#c2362a', { roughness: 0.4, metalness: 0.35 }),
    glass: std('#cfe6ea', { roughness: 0.06, metalness: 0, transparent: true, opacity: 0.28, envMapIntensity: 1.6, depthWrite: false }),
    newsprint: std('#d8d2c0', { roughness: 0.95 }),
    jarA: std('#d23a1c', { roughness: 0.4 }),
    jarB: std('#e0b020', { roughness: 0.4 }),
    jarC: std('#6e8a2a', { roughness: 0.4 }),
    jarD: std('#4a2a14', { roughness: 0.5 }),
    soot: std('#14110f', { roughness: 0.95 }),
    wet: std('#0d0e10', { roughness: 0.12, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    stain: std('#0a0908', { roughness: 0.9, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  M.stain.map = art.decal('stain');
  M.wet.map = art.decal('water');
  M.tarp.normalScale?.set(0.8, 0.8);

  const S = SHELL;
  const HW = S.halfW;
  const B = k.batch();

  // --- the slab, the walking line -----------------------------------------------------------------------------------------------------------
  B.box(M.concrete, [HW * 2 + 0.9, 0.12, 4.35], [0, -0.06, 0.52], { tile: 2, off: [0.13, 0.31] });
  B.box(M.concrete, [HW * 2 + 0.9, 0.05, 0.5], [0, -0.025, -1.82], { tile: 2, off: [0.4, 0.2] }); // the step towards the footpath

  // --- the counter: the stations stand on it; this is the thela body and the serving ledge --------------------------------------------------------
  const ctrFront = -0.55; // the stations' fronts (their counters are 0.9 deep, centred on z = -1)
  // continuous carcass (hidden under the station props, visible beyond them)
  const counterZ0 = -1.45;
  const ledge = (x0, x1) => {
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    B.box(M.teal, [w, 0.8, 0.22], [cx, 0.4, -1.54], { tile: 1 });
    B.box(M.steel, [w + 0.02, 0.04, 0.3], [cx, S.ledgeTop - 0.02, -1.55], { tile: 1 });
    B.box(M.steelDull, [w + 0.02, 0.05, 0.015], [cx, S.ledgeTop - 0.07, -1.7], { tile: 1 }); // the lip, with a rolled edge
    B.box(M.teal, [w, 0.14, 0.04], [cx, 0.07, -1.5], { tile: 1 }); // toe board
  };
  ledge(-HW + 0.05, HW - 0.05);
  // the ends of the counter beyond the station row (x beyond +-3.25), steel top, painted front facing the cook
  const ctrEnd = (x0, x1) => {
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    B.box(M.teal, [w, 0.78, 0.9], [cx, 0.39, -1.0], { tile: 1 });
    B.box(M.steel, [w + 0.02, 0.04, 0.94], [cx, S.counterTop - 0.02, -1.0], { tile: 1 });
    B.box(M.steelDull, [w + 0.02, 0.05, 0.02], [cx, S.counterTop - 0.065, ctrFront + 0.0], { tile: 1 });
    B.box(M.timber, [w - 0.1, 0.05, 0.8], [cx, 0.03, -1.0], { tile: 1 }); // plinth
  };
  ctrEnd(-HW + 0.05, -3.25);
  ctrEnd(3.25, HW - 0.05);
  // under-counter shelf strip, only visible beyond the props
  B.box(M.timber, [HW * 2, 0.04, 0.5], [0, 0.32, -0.8], { tile: 1 });

  // --- posts, beams and rafters (bamboo, lashed with rope) ----------------------------------------------------------------------------------
  const pole = (x, z, h, r = 0.034) => B.cyl(M.bamboo, r, r * 1.08, h, 9, [x, h / 2, z], { tile: 0.9 });
  pole(-HW, -1.95, S.roofFrontY - 0.05);
  pole(HW, -1.95, S.roofFrontY - 0.05);
  pole(-HW, 0.45, 2.85);
  pole(HW, 0.45, 2.85);
  pole(-HW, 2.55, S.roofRearY - 0.06);
  pole(HW, 2.55, S.roofRearY - 0.06);
  // bamboo prop poles on the street side that hold the tarp lip and lean a little
  B.rod(M.bamboo, [-3.55, 0, -2.8], [-3.35, 2.38, -2.3], 0.032, 9, { tile: 0.9 });
  B.rod(M.bamboo, [-0.55, 0, -2.8], [-0.7, 2.4, -2.3], 0.032, 9, { tile: 0.9 });
  const beamY = (z) => S.roofFrontY + ((z - S.roofFrontZ) / (S.roofRearZ - S.roofFrontZ)) * (S.roofRearY - S.roofFrontY);
  // cross beams along x
  for (const z of [-1.98, -0.5, 1.0, 2.5]) B.rod(M.bamboo, [-HW - 0.2, beamY(z) - 0.07, z], [HW + 0.2, beamY(z) - 0.07, z], 0.036, 8, { tile: 0.9 });
  // rafters along z (a little lower than the sheets)
  for (let i = 0; i <= 8; i++) {
    const x = -HW + 0.1 + (i * (HW * 2 - 0.2)) / 8;
    B.rod(M.bamboo, [x, beamY(S.roofFrontZ - 0.1) - 0.1, S.roofFrontZ - 0.1], [x, beamY(S.roofRearZ) - 0.1, S.roofRearZ], 0.03, 7, { tile: 0.9 });
  }
  // rope lashings at the crossings
  for (const z of [-1.98, -0.5, 1.0, 2.5]) {
    for (let i = 0; i <= 8; i += 1) {
      const x = -HW + 0.1 + (i * (HW * 2 - 0.2)) / 8;
      B.torus(M.rope, 0.045, 0.011, 4, 8, [x, beamY(z) - 0.085, z], { rot: [0, Math.PI / 2, 0] });
    }
  }
  for (const [x, z, h] of [[-HW, -1.95, 2.45], [HW, -1.95, 2.45], [-HW, 0.45, 2.7], [HW, 0.45, 2.7]]) B.torus(M.rope, 0.05, 0.012, 4, 8, [x, h, z], { rot: [Math.PI / 2, 0, 0] });

  // --- the tin roof: corrugated sheets with deliberate gaps, built from real corrugation ---------------------------------------------------------
  const alpha = Math.atan2(S.roofRearY - S.roofFrontY, S.roofRearZ - S.roofFrontZ);
  const roofLen = Math.hypot(S.roofRearZ - S.roofFrontZ + 0.3, S.roofRearY - S.roofFrontY);
  const roofZc = (S.roofRearZ + S.roofFrontZ - 0.3) / 2;
  const roofYc = (S.roofRearY + S.roofFrontY) / 2 + 0.04;
  const sheet = (x0, width, seed) => {
    const pitch = 0.076;
    const segX = Math.max(8, Math.round((width / pitch) * 8));
    const g = new PlaneGeometry(width, roofLen, segX, 5);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    const r2 = mulberry(seed);
    const dz = (r2() - 0.5) * 0.06;
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i);
      const lz = p.getZ(i);
      p.setY(i, 0.019 * Math.sin(((lx + x0) * Math.PI * 2) / pitch) + (r2() - 0.5) * 0.0015 + Math.max(0, Math.abs(lz) - roofLen * 0.46) * 0.05 * (lx > 0 ? 1 : 0.6));
      uv.setXY(i, (lx + x0) / 1.0 + seed * 0.37, (lz + dz) / 1.0 + seed * 0.19);
    }
    g.computeVertexNormals();
    return B.geo(M.tin, g, [x0, roofYc, roofZc], { rot: [-alpha, 0, 0], tile: 0 });
  };
  const gaps = new Map([[2, 0.07], [5, 0.09], [8, 0.05], [11, 0.06]]);
  let sx = -HW - 0.55;
  const roofGaps = [];
  for (let i = 0; i < 12; i++) {
    const w = 0.84;
    sheet(sx + w / 2, w, 100 + i * 7);
    sx += w;
    const gp = gaps.get(i) || 0;
    if (gp) roofGaps.push({ x: sx + gp / 2, w: gp });
    sx += gp - 0.03; // sheets overlap by 3 cm; the gaps are real
  }
  // rusty lapped patches and the tied-down bricks / tyres on top are out of the cook's sight; the underside gets drip stains from the texture itself

  // --- the blue tarpaulin patch, tied with rope to bamboo ------------------------------------------------------------------------------------
  const tarpGeo = (() => {
    const w = 3.0;
    const l = 3.9;
    const g = new PlaneGeometry(w, l, 20, 16);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i);
      const lz = p.getZ(i); // -l/2 .. l/2: front (street) is -z
      const front = Math.max(0, (-lz - (l / 2 - 0.75)) / 0.75); // the last 0.75 m droops towards the street, tied to the prop poles
      const sag = -0.05 * (0.5 - 0.5 * Math.cos(((lx + 1.4) * Math.PI * 2) / 1.1)); // sags between the rafters
      const y = sag - front * front * 0.3 + Math.sin(lx * 3.1 + lz * 1.7) * 0.012 + Math.sin(lx * 11.0 + lz * 3.0) * 0.006;
      p.setY(i, y);
      uv.setXY(i, lx / 0.5, lz / 0.5);
    }
    g.computeVertexNormals();
    return g;
  })();
  B.geo(M.tarp, tarpGeo, [-2.15, beamY(-0.5) - 0.2, -0.5], { rot: [-alpha, 0, 0], tile: 0 });
  // rope from the tarp's front corners to the prop poles, and a few ties along the beam
  B.tube(M.rope, [[-3.5, 2.5, -2.33], [-3.45, 2.2, -2.35], [-3.4, 2.05, -2.36]], 0.008, 6, 4);
  B.tube(M.rope, [[-0.5, 2.5, -2.33], [-0.55, 2.2, -2.35], [-0.6, 2.05, -2.36]], 0.008, 6, 4);

  // --- stall walls: tarpaulin screens on the sides and the back, plaster on the rear ------------------------------------------------------------
  B.plane(M.tarp, 4.3, 2.6, [-HW + 0.03, 1.32, 0.95], { rot: [0, Math.PI / 2, 0], tile: 0.5 });
  B.plane(M.tarpOrange, 4.3, 2.6, [HW - 0.03, 1.32, 0.95], { rot: [0, -Math.PI / 2, 0], tile: 0.5 });
  // plane UVs for walls: metric (tile 0.5)
  B.box(M.plaster, [HW * 2 + 0.3, 1.85, 0.16], [0, 0.925, S.rearZ + 0.2], { tile: 3 });
  B.box(M.timber, [HW * 2 + 0.3, 0.07, 0.24], [0, 1.88, S.rearZ + 0.2], { tile: 1 });

  // --- shelves on the left wall: tiffin carriers, jars, steel dabbas ---------------------------------------------------------------------------------
  const shelfX = -HW + 0.28;
  const shelfYs = [1.28, 1.78, 2.28];
  for (const y of shelfYs) {
    B.box(M.timber, [0.42, 0.04, 3.7], [shelfX, y, 0.55], { tile: 1 });
    B.box(M.timber, [0.05, 0.12, 3.7], [shelfX + 0.2, y - 0.07, 0.55], { tile: 1 });
    for (const z of [-1.1, 0.55, 2.2]) B.rod(M.iron, [shelfX - 0.15, y - 0.02, z], [shelfX + 0.1, y - 0.33, z], 0.008, 4);
  }
  const detail = quality.shelfDetail;
  const carrier = (x, y, z, tiers = 3, r = 0.1) => {
    for (let i = 0; i < tiers; i++) B.cyl(M.steelPlain, r, r, 0.1, 14, [x, y + 0.055 + i * 0.105, z]);
    B.cyl(M.steelPlain, r * 1.02, r * 0.98, 0.025, 14, [x, y + 0.01 + tiers * 0.105 + 0.045, z]);
    B.torus(M.steelDull, r * 0.7, 0.007, 4, 12, [x, y + tiers * 0.105 + 0.1, z], { rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1] });
    B.rod(M.steelDull, [x - r - 0.004, y + 0.03, z], [x - r - 0.004, y + tiers * 0.105 + 0.02, z], 0.006, 4);
    B.rod(M.steelDull, [x + r + 0.004, y + 0.03, z], [x + r + 0.004, y + tiers * 0.105 + 0.02, z], 0.006, 4);
  };
  const jar = (x, y, z, m, r = 0.075, h = 0.2) => {
    B.cyl(M.glass, r, r, h, 14, [x, y + h / 2, z]);
    B.cyl(m, r * 0.88, r * 0.88, h * 0.72, 12, [x, y + h * 0.4, z]);
    B.cyl(M.steelDull, r * 1.02, r * 1.02, 0.025, 14, [x, y + h + 0.012, z]);
  };
  // the jars of chutney, sambar, podi and masala: glass and lid are static, the contents are live meshes that sink as the stock drops (setShelf)
  const JAR_COLOR = { coconut_chutney: '#e4eed8', sambar: '#c8601c', podi_ghee: '#a8482a', potato_masala: '#e2b324' };
  const dynJars = [];
  let dynN = 0;
  const dynJar = (x, y, z, r = 0.075, h = 0.2) => {
    const item = SHELF_JARS[dynN++];
    B.cyl(M.glass, r, r, h, 14, [x, y + h / 2, z]);
    B.cyl(M.steelDull, r * 1.02, r * 1.02, 0.025, 14, [x, y + h + 0.012, z]);
    dynJars.push({ item, x, y, z, r, h, mesh: null, fill: -1 });
  };
  const nextIsDyn = () => dynN < SHELF_JARS.length;
  const dabba = (x, y, z, r = 0.09, h = 0.13) => {
    B.cyl(M.steelDull, r, r * 0.96, h, 12, [x, y + h / 2, z]);
    B.cyl(M.steelPlain, r * 1.02, r * 1.02, 0.02, 12, [x, y + h + 0.01, z]);
    B.sph(M.steelDark, 0.016, 6, 4, [x, y + h + 0.03, z]);
  };
  const zs = detail > 0.7 ? [-1.0, -0.55, -0.1, 0.35, 0.8, 1.25, 1.7, 2.1] : [-0.9, 0.0, 0.9, 1.8];
  zs.forEach((z, i) => {
    const jm = [M.jarA, M.jarB, M.jarC, M.jarD][i % 4];
    const y0 = shelfYs[0] + 0.02;
    if (i % 3 === 0) carrier(shelfX, y0, z, 3 + (i % 2), 0.1);
    else if (i % 3 === 1) {
      if (nextIsDyn()) dynJar(shelfX, y0, z);
      else jar(shelfX, y0, z, jm);
    } else dabba(shelfX, y0, z, 0.1, 0.14);
    const y1 = shelfYs[1] + 0.02;
    if (i % 2 === 0) {
      if (nextIsDyn()) dynJar(shelfX - 0.02, y1, z + 0.12, 0.07, 0.24);
      else jar(shelfX - 0.02, y1, z + 0.12, [M.jarC, M.jarA, M.jarB][i % 3], 0.07, 0.24);
    } else carrier(shelfX, y1, z, 2, 0.095);
    const y2 = shelfYs[2] + 0.02;
    if (i % 3 !== 2) dabba(shelfX, y2, z, 0.085, 0.11);
    else B.box(M.newsprint, [0.28, 0.12, 0.2], [shelfX, y2 + 0.06, z], { rot: [0, 0.2, 0] });
  });

  // --- right wall: plate rack, hanging ladles, a small shrine -------------------------------------------------------------------------------------
  const rackX = HW - 0.22;
  B.box(M.timber, [0.3, 0.04, 2.4], [rackX, 1.35, 0.6], { tile: 1 });
  B.box(M.timber, [0.3, 0.04, 2.4], [rackX, 1.85, 0.6], { tile: 1 });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 9; j++) B.cyl(M.steelPlain, 0.13, 0.12, 0.012, 16, [rackX, 1.38 + j * 0.014, -0.45 + i * 0.58], {});
  // hooks with ladles, spatulas and strainers hanging from the roof beam on the right
  const hook = (x, y, z, kind) => {
    B.rod(M.steelDark, [x, y, z], [x, y - 0.1, z], 0.004, 4);
    if (kind === 0) { B.cyl(M.steelPlain, 0.055, 0.04, 0.05, 10, [x, y - 0.4, z]); B.rod(M.steelDull, [x, y - 0.1, z], [x, y - 0.38, z], 0.007, 5); }
    else if (kind === 1) { B.box(M.steelPlain, [0.1, 0.012, 0.13], [x, y - 0.46, z]); B.rod(M.steelDull, [x, y - 0.1, z], [x, y - 0.4, z], 0.006, 4); }
    else { B.torus(M.steelDull, 0.06, 0.006, 4, 12, [x, y - 0.46, z], { rot: [Math.PI / 2, 0, 0] }); B.rod(M.steelDull, [x, y - 0.1, z], [x, y - 0.4, z], 0.006, 4); }
  };
  for (let i = 0; i < 6; i++) hook(3.2 + i * 0.22, 2.2, -0.65, i % 3);
  // shrine: a small shelf with a framed picture, a marigold garland and a diya
  B.box(M.timber, [0.3, 0.025, 0.2], [3.9, 1.95, -1.88]);
  B.box(M.maroon, [0.22, 0.28, 0.02], [3.9, 2.16, -1.97], { rot: [0.1, 0, 0] });
  for (let i = 0; i < 9; i++) B.sph(M.jarB, 0.022, 6, 5, [3.8 + i * 0.025, 2.28 - Math.sin((i / 8) * Math.PI) * 0.1, -1.9], {});
  B.cyl(M.brass, 0.02, 0.014, 0.012, 8, [3.98, 1.973, -1.86]);

  // --- floor kit: bucket, LPG cylinders and hose, stool, crates, a mop ------------------------------------------------------------------------------
  // steel bucket with a rope handle, beside the counter at the cook's left (the gas stand has the spot at the end of the line now)
  B.cyl(M.steelPlain, 0.17, 0.13, 0.28, 16, [-2.95, 0.14, 0.38]);
  B.torus(M.steelDull, 0.172, 0.01, 4, 16, [-2.95, 0.28, 0.38], { rot: [Math.PI / 2, 0, 0] });
  B.torus(M.steelDark, 0.17, 0.006, 4, 12, [-2.95, 0.3, 0.38], { rot: [0, 0.6, 0], scale: [1, 1, 1] });
  B.cyl(M.bluePlastic, 0.05, 0.04, 0.08, 10, [-2.7, 0.04, 0.5]);
  // plastic crate of onions
  B.box(M.redPlastic, [0.5, 0.26, 0.36], [3.55, 0.13, 0.55], { rot: [0, 0.15, 0] });
  for (let i = 0; i < 9; i++) B.sph(M.jarA, 0.055, 8, 6, [3.4 + (i % 3) * 0.14, 0.3, 0.45 + Math.floor(i / 3) * 0.1], { scale: [1, 0.8, 1], color: i % 2 ? '#a0402a' : '#c2603a' });
  // gunny sacks of rice
  for (const [x, z, r] of [[-3.9, 1.5, 0.2], [-3.4, 1.7, -0.3], [-3.7, 1.15, 0.6]]) B.cyl(M.cloth, 0.2, 0.18, 0.55, 10, [x, 0.28, z], { rot: [0, r, 0], color: '#b9a27a' });
  // brick-lined stove base left over from the old chulha, soot-black, beside the counter
  B.box(M.brick, [0.62, 0.34, 0.5], [4.05, 0.17, -0.35], { tile: 0.69 });
  B.box(M.brick, [0.62, 0.34, 0.5], [4.12, 0.51, -0.35], { tile: 0.69 });
  B.cyl(M.soot, 0.16, 0.16, 0.02, 12, [4.1, 0.69, -0.35]);
  // the gas stand: a scuffed rubber mat with a chain, the live cylinder is placed on it below; the rubber hose runs from its valve to the counter
  const GS = LAYOUT.gas;
  B.cyl(M.rubber, 0.24, 0.24, 0.016, 18, [GS.x, 0.008, GS.z], {});
  B.torus(M.steelDark, 0.2, 0.006, 4, 16, [GS.x, 0.02, GS.z], { rot: [Math.PI / 2, 0, 0] });
  B.tube(M.rubber, [[GS.x + 0.02, 0.6, GS.z - 0.04], [GS.x + 0.2, 0.52, GS.z - 0.16], [GS.x + 0.38, 0.12, GS.z - 0.32], [-3.15, 0.07, -0.18], [-3.05, 0.3, -0.5], [-2.95, 0.55, -0.62]], 0.011, 28, 6);
  // mop leaning on the right post
  B.rod(M.timber, [HW - 0.1, 0.02, 0.2], [HW - 0.15, 1.5, 0.43], 0.014, 5);
  B.cyl(M.cloth, 0.08, 0.1, 0.18, 8, [HW - 0.098, 0.1, 0.2], { color: '#b8b0a0' });

  // --- things on the counter ends: steel plates, a glass of toothpicks, the dabba of spare spoons ---------------------------------------------------
  for (let i = 0; i < 10; i++) B.cyl(M.steelPlain, 0.11, 0.09, 0.012, 16, [-3.85, S.counterTop + 0.01 + i * 0.013, -0.9]);
  B.cyl(M.glass, 0.032, 0.03, 0.09, 10, [3.55, S.counterTop + 0.045, -0.8]);
  B.box(M.newsprint, [0.3, 0.05, 0.22], [-3.55, S.counterTop + 0.025, -1.3], { rot: [0, 0.2, 0] }); // a stack of newspaper for wrapping
  B.cyl(M.whitePlastic, 0.07, 0.065, 0.14, 10, [3.9, S.counterTop + 0.07, -1.35]);

  // --- the front fascia of the roof, seen from behind: the flex banner's wooden frame and ropes ---------------------------------------------------
  // (the banner plane itself is a separate textured mesh below)
  for (const x of [-2.6, 2.6]) B.rod(M.bamboo, [x, S.roofFrontY - 0.02, S.roofFrontZ - 0.05], [x, S.roofFrontY + 1.25, S.roofFrontZ - 0.26], 0.03, 8, { tile: 0.9 });
  B.rod(M.bamboo, [-2.7, S.roofFrontY + 1.22, S.roofFrontZ - 0.25], [2.7, S.roofFrontY + 1.22, S.roofFrontZ - 0.25], 0.026, 8, { tile: 0.9 });
  B.rod(M.bamboo, [-2.7, S.roofFrontY + 0.12, S.roofFrontZ - 0.06], [2.7, S.roofFrontY + 0.12, S.roofFrontZ - 0.06], 0.026, 8, { tile: 0.9 });
  for (let i = 0; i < 12; i++) {
    const x = -2.5 + i * 0.455;
    B.tube(M.rope, [[x, S.roofFrontY + 1.2, S.roofFrontZ - 0.24], [x + 0.03, S.roofFrontY + 1.15, S.roofFrontZ - 0.24]], 0.006, 2, 4);
  }

  B.build(root, { name: 'stall-static' });

  // --- the flex banner, the back of it; the menu board facing the cook; a grimy enamel plate on the front is for the customers ---------------------------
  const bannerBack = std('#ffffff', { map: art.bannerBack(), roughness: 0.7, side: DoubleSide });
  const banner = put(plane(5.4, 1.2), bannerBack, 0, S.roofFrontY + 0.64, S.roofFrontZ - 0.26, root);
  banner.rotation.y = Math.PI;
  banner.rotation.x = 0.12;
  banner.castShadow = true;
  const bannerFront = std('#ffffff', { map: art.banner(), roughness: 0.55, side: DoubleSide, emissive: '#ffffff', emissiveIntensity: 0 });
  bannerFront.emissiveMap = bannerFront.map;
  const bannerFace = put(plane(5.4, 1.2), bannerFront, 0, S.roofFrontY + 0.64, S.roofFrontZ - 0.27, root);
  bannerFace.rotation.x = 0.12;
  const enamelM = std('#ffffff', { map: art.enamel(), roughness: 0.25, metalness: 0.1, transparent: true, alphaTest: 0.3 });
  const enamel = put(plane(0.9, 0.28), enamelM, 0, 0.5, -1.665, root);
  enamel.rotation.y = Math.PI;
  const menu = art.menuBoard();
  const menuM = std('#ffffff', { map: menu.tex, roughness: 0.75, emissive: '#ffffff', emissiveIntensity: 0 });
  menuM.emissiveMap = menu.tex;
  const menuGroup = new Group();
  menuGroup.position.set(2.1, 2.2, -1.82);
  menuGroup.rotation.set(0.14, 0.38, 0.02);
  root.add(menuGroup);
  const menuMesh = put(plane(1.5, 1.2), menuM, 0, 0, 0, menuGroup);
  menuMesh.rotation.y = Math.PI;
  menuMesh.castShadow = true;
  // the same board read from the footpath side (customers see the struck-through, sold-out dishes too)
  const menuFront = put(plane(1.5, 1.2), menuM, 0, 0, -0.032, menuGroup);
  menuFront.rotation.y = 0;
  const mb = k.batch();
  mb.box(M.timber, [1.62, 0.06, 0.05], [0, 0.63, -0.02]);
  mb.box(M.timber, [1.62, 0.06, 0.05], [0, -0.63, -0.02]);
  mb.box(M.timber, [0.06, 1.3, 0.05], [-0.79, 0, -0.02]);
  mb.box(M.timber, [0.06, 1.3, 0.05], [0.79, 0, -0.02]);
  mb.rod(M.rope, [-0.7, 0.62, 0], [-0.55, 1.2, 0.1], 0.006, 4);
  mb.rod(M.rope, [0.7, 0.62, 0], [0.55, 1.2, 0.1], 0.006, 4);
  mb.build(menuGroup);

  // poster on the rear wall, a calendar, a rate card
  const posterM = std('#ffffff', { map: art.poster(2), roughness: 0.8 });
  const pos = put(plane(0.7, 1.05), posterM, 2.6, 1.7, S.rearZ + 0.12, root);
  pos.rotation.set(0, Math.PI, 0.05);
  put(plane(0.6, 0.9), std('#ffffff', { map: art.poster(4), roughness: 0.8 }), 1.2, 1.6, S.rearZ + 0.12, root).rotation.set(0, Math.PI, -0.03);

  // --- hanging cloths (gamchha towels, a waist cloth) on a line, swaying a little -------------------------------------------------------------------
  const cloths = [];
  const clothTex = art.fabric?.('red') || null;
  const cloth = (x, y, z, w, h, colour, phase) => {
    const g = k.geo(`cloth${w},${h}`, () => {
      const pg = new PlaneGeometry(w, h, 4, 8);
      pg.translate(0, -h / 2, 0);
      return pg;
    });
    const m = std(colour, { roughness: 0.95, side: DoubleSide, map: clothTex || null });
    const mesh = new Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    root.add(mesh);
    cloths.push({ mesh, phase, base: z, geo: g, h });
    return mesh;
  };
  cloth(2.9, 2.2, -0.2, 0.34, 0.8, '#b92a2a', 0);
  cloth(3.12, 2.2, -0.18, 0.3, 0.7, '#e8e0d0', 1.3);
  cloth(-2.3, 2.3, 0.7, 0.32, 0.75, '#2a62b4', 2.1);
  const cb = k.batch();
  cb.rod(M.rope, [2.7, 2.22, -0.2], [3.4, 2.2, -0.2], 0.005, 4);
  cb.rod(M.rope, [-2.5, 2.32, 0.7], [-2.05, 2.3, 0.7], 0.005, 4);
  cb.build(root);

  // --- the bin ---------------------------------------------------------------------------------------------------------------------------------
  const bin = new Group();
  put(cyl(0.3, 0.24, 0.72, 18), M.greenBin, 0, 0.38, 0, bin);
  put(cyl(0.325, 0.325, 0.04, 18), M.greenBin, 0, 0.74, 0, bin);
  const binLid = new Group();
  put(cyl(0.3, 0.3, 0.035, 18), std('#25663a', { roughness: 0.5 }), 0, 0.02, 0, binLid);
  put(cyl(0.045, 0.045, 0.05, 8), M.rubber, 0, 0.06, 0, binLid);
  binLid.position.set(0, 0.78, 0);
  bin.add(binLid);
  put(box(0.12, 0.2, 0.01), std('#e8dcc0', { roughness: 0.8 }), 0, 0.4, 0.3, bin);
  bin.position.set(LAYOUT.bin.x, 0, LAYOUT.bin.z);
  root.add(bin);

  // --- the models' street props around the cooks ----------------------------------------------------------------------------------------------------
  const props = [];
  const prop = (id, x, y, z, ry = 0, opts) => {
    let p = null;
    try {
      p = models.buildStreetProp?.(id, opts);
    } catch {
      p = null;
    }
    if (!p?.group) return null;
    p.group.position.set(x, y, z);
    p.group.rotation.y = ry;
    shade(p.group);
    root.add(p.group);
    props.push(p);
    return p;
  };
  prop('tiffin-drum', 4.2, 0, 1.15);
  prop('tiffin-drum', 3.75, 0, 1.45, 0.5);
  // the batter buckets: open, with a level and a sourness that follow the stock (setShelf)
  const buckets = SHELF_BATTERS.map((item, i) => ({ item, p: prop('batter-bucket', [-3.2, -4.2, -4.1][i], 0, [1.4, -0.2, 2.0][i], [0.3, 0.8, 1.9][i], { dyn: true }), fill: -1, sour: -1 }));
  prop('plate-stack', 3.7, S.counterTop, -1.25, 0.4);
  prop('money-box', -4.05, S.counterTop, -1.2, 0.2);
  prop('stool', 4.3, 0, 0.6, 0.4);

  // --- spot marks: faint wear where customers stand (a stain on the paving, not a game ring) ---------------------------------------------------------
  const wearM = std('#1a1612', { roughness: 0.9, transparent: true, opacity: 0.16, depthWrite: false, map: art.decal('stain'), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const spotMarks = [];
  for (let i = 0; i < LAYOUT.spots; i++) {
    const m = put(plane(0.95, 0.95), wearM, LAYOUT.spotX(i), 0.002, LAYOUT.spotZ, root);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = i * 1.3;
    spotMarks.push(m);
  }
  // wet mop marks and old oil on the stall floor
  const wetPlanes = [[-1.2, 0.1, 1.6, 0.8, 0.2], [2.0, -0.15, 1.2, 0.7, 1.0], [-3.1, 0.4, 0.9, 0.7, 2.0], [0.4, 0.25, 1.3, 0.6, 0.5]];
  for (const [x, z, w, h, rz] of wetPlanes) {
    const m = put(plane(w, h), M.wet, x, 0.004, z, root);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rz;
  }
  for (const [x, z, w, h, rz] of [[-2.7, -0.3, 1.1, 0.8, 0.3], [1.6, 0.35, 1.0, 0.7, 1.4], [3.3, -0.2, 0.9, 0.9, 2.2]]) {
    const m = put(plane(w, h), M.stain, x, 0.003, z, root);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rz;
  }

  // --- lamps: bulbs on a wire, a hanging tube-light ----------------------------------------------------------------------------------------------------
  const BULBS = 12;
  const wireY = 2.5;
  const wireZ = -1.38;
  const lampB = k.batch();
  const bulbPos = [];
  const wirePts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    wirePts.push([-HW + 0.1 + t * (HW * 2 - 0.2), wireY - Math.sin(Math.PI * t) * 0.2, wireZ]);
  }
  lampB.tube(M.iron, wirePts, 0.007, 40, 4);
  for (let i = 0; i < BULBS; i++) {
    const p = wirePts[Math.round(((i + 0.5) / BULBS) * 24)];
    bulbPos.push([p[0], p[1] - 0.12, p[2]]);
    lampB.cyl(M.rubber, 0.017, 0.017, 0.06, 6, [p[0], p[1] - 0.03, p[2]]);
    lampB.cyl(M.brass, 0.022, 0.022, 0.035, 8, [p[0], p[1] - 0.075, p[2]]);
  }
  // a second, lower line over the cook's left with three bulbs and a hanging steel lampshade
  const wire2 = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    wire2.push([-4.6 + t * 2.4, 2.38 - Math.sin(Math.PI * t) * 0.12, 0.05]);
  }
  lampB.tube(M.iron, wire2, 0.007, 20, 4);
  for (const idx of [3, 6, 9]) {
    const p = wire2[idx];
    bulbPos.push([p[0], p[1] - 0.12, p[2]]);
    lampB.cyl(M.rubber, 0.017, 0.017, 0.06, 6, [p[0], p[1] - 0.03, p[2]]);
    lampB.cyl(M.brass, 0.022, 0.022, 0.035, 8, [p[0], p[1] - 0.075, p[2]]);
  }
  // a bulb on a drop cord over the back counter, so the prep work is lit
  {
    const px = STATIONS.prep1.x;
    const pz = STATIONS.prep1.z - 0.1;
    lampB.rod(M.iron, [px, beamY(pz) - 0.07, pz], [px, 2.42, pz], 0.006, 4);
    lampB.cyl(M.rubber, 0.017, 0.017, 0.06, 6, [px, 2.4, pz]);
    lampB.cyl(M.brass, 0.022, 0.022, 0.035, 8, [px, 2.355, pz]);
    bulbPos.push([px, 2.31, pz]);
  }
  lampB.build(root, { cast: false });
  const bulbMat = T(new MeshBasicMaterial({ color: 0xffd890 }));
  const bulbs = new InstancedMesh(new SphereGeometry(0.036, 12, 10), bulbMat, bulbPos.length);
  T(bulbs.geometry);
  const m4 = new Matrix4();
  bulbPos.forEach((p, i) => {
    m4.makeTranslation(p[0], p[1], p[2]);
    m4.scale(new Vector3(1, 1.28, 1));
    m4.setPosition(p[0], p[1], p[2]);
    bulbs.setMatrixAt(i, m4);
  });
  bulbs.frustumCulled = false;
  root.add(bulbs);
  const glowTex = art.softDot();
  const glowGeo = T(new BufferGeometry());
  glowGeo.setAttribute('position', new Float32BufferAttribute(bulbPos.flat(), 3));
  const glowMat = T(new PointsMaterial({ map: glowTex, size: 0.7, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffb35a, opacity: 0, fog: false }));
  const glow = new Points(glowGeo, glowMat);
  glow.frustumCulled = false;
  root.add(glow);

  // the tube-light hangs from the beam on two short chains, a dusty fitting
  const tube = new Group();
  const tubeBodyM = std('#e9eef0', { roughness: 0.4, emissive: '#cfe8ff', emissiveIntensity: 0 });
  put(cyl(0.017, 0.017, 1.18, 10), tubeBodyM, 0, 0, 0, tube).rotation.z = Math.PI / 2;
  put(box(1.22, 0.035, 0.08), M.steelDull, 0, 0.04, 0, tube);
  put(box(0.06, 0.05, 0.1), M.iron, -0.61, 0.0, 0, tube);
  put(box(0.06, 0.05, 0.1), M.iron, 0.61, 0.0, 0, tube);
  for (const s of [-0.45, 0.45]) put(cyl(0.004, 0.004, 0.18, 4), M.iron, s, 0.14, 0, tube);
  tube.position.set(2.45, 2.36, -1.15);
  root.add(tube);
  const tubeGlowMat = T(new PointsMaterial({ map: glowTex, size: 1.9, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xcfe6ff, opacity: 0, fog: false }));
  const tubeGlowGeo = T(new BufferGeometry());
  tubeGlowGeo.setAttribute('position', new Float32BufferAttribute([2.45, 2.34, -1.15, 2.1, 2.34, -1.15, 2.8, 2.34, -1.15], 3));
  const tubeGlow = new Points(tubeGlowGeo, tubeGlowMat);
  tubeGlow.frustumCulled = false;
  root.add(tubeGlow);

  // real lights: warm bulbs over the cooks and the cold tube, as many as the tier allows
  const lights = [];
  const nBulb = quality.bulbLights ?? (quality.lights ? 2 : 0);
  if (nBulb > 0) {
    const xs = nBulb >= 4 ? [-3.5, -1.2, 1.2, 3.5] : [-2.4, 2.4];
    for (const x of xs) {
      const l = new PointLight(0xffb055, 0, 7.5, 2);
      l.position.set(x, 2.2, -1.1);
      root.add(l);
      lights.push({ l, base: 12, kind: 'bulb' });
    }
  }
  if (quality.tubeLight ?? quality.lights) {
    const tl = new PointLight(0xcfe6ff, 0, 8, 2);
    tl.position.set(2.45, 2.2, -1.0);
    root.add(tl);
    lights.push({ l: tl, base: 14, kind: 'tube' });
  }
  // a local light over the back counter (the cook's bulbs are a long way from it); on only when the level has a prep counter. Like every light here it
  // stays in the scene for good and is dimmed to zero (`off`): three.js bakes the number of visible lights into every lit shader, so a light that came
  // and went made the whole scene compile again.
  let prepLight = null;
  let prepEntry = null;
  let prepOn = false; // the level has the back counter (its two lights are dimmed to zero when it has not)
  if (quality.lights) {
    prepLight = new PointLight(0xffb055, 0, 5.5, 2);
    prepLight.position.set(STATIONS.prep1.x, 2.12, STATIONS.prep1.z - 0.35);
    root.add(prepLight);
    prepEntry = { l: prepLight, base: 9, kind: 'bulb', off: true };
    lights.push(prepEntry);
  }
  // low tier: baked-looking pools of warm light on the counter instead of real lights
  const pools = [];
  if (!lights.length) {
    const poolM = T(new MeshBasicMaterial({ map: glowTex, color: 0xff9a40, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0, fog: false }));
    for (const x of [-3.3, -1.1, 1.1, 3.3]) {
      const p = put(plane(2.6, 1.6), poolM, x, 0.9, -1.05, root);
      p.rotation.x = -Math.PI / 2;
      pools.push(p);
    }
    const pp = put(plane(2.0, 1.5), poolM, STATIONS.prep1.x, 0.9, STATIONS.prep1.z - 0.1, root);
    pp.rotation.x = -Math.PI / 2;
    pp.visible = false;
    pools.prep = pp;
    pools.mat = poolM;
  }

  // --- light shafts through the roof gaps (cheap additive prisms along the sun direction), and floating dust ----------------------------------------------
  const shaftU = { uColor: { value: new Color() }, uStrength: { value: 0 }, uTime: { value: 0 }, uSeed: { value: 0 } };
  const shaftGeo = T(new BoxGeometry(1, 1, 1).translate(0, 0, 0.5));
  const shafts = [];
  if (quality.shafts) {
    const used = roofGaps.slice(0, 5);
    used.forEach((gp, i) => {
      const m = T(new ShaderMaterial({
        uniforms: { ...shaftU, uSeed: { value: i * 1.7 }, uStrength: shaftU.uStrength, uColor: shaftU.uColor, uTime: shaftU.uTime },
        vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG, transparent: true, forceSinglePass: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false,
      }));
      const mesh = new Mesh(shaftGeo, m);
      const zRoof = 0.3 + (i - 2) * 0.55;
      mesh.userData = { x: gp.x, w: gp.w, y: beamY(zRoof) - 0.05, z: zRoof };
      mesh.frustumCulled = false;
      mesh.visible = false;
      root.add(mesh);
      shafts.push(mesh);
    });
  }
  const NDUST = quality.shafts ? 56 : 0;
  const dustGeo = T(new BufferGeometry());
  const dustPos = new Float32Array(NDUST * 3);
  const dustSeed = new Float32Array(NDUST * 3);
  for (let i = 0; i < NDUST; i++) {
    dustSeed[i * 3] = rnd() * 6.28;
    dustSeed[i * 3 + 1] = rnd() * 6.28;
    dustSeed[i * 3 + 2] = rnd() * 6.28;
    dustPos[i * 3] = -4 + rnd() * 8;
    dustPos[i * 3 + 1] = 0.9 + rnd() * 1.6;
    dustPos[i * 3 + 2] = -1.3 + rnd() * 2.9;
  }
  dustGeo.setAttribute('position', new Float32BufferAttribute(dustPos, 3));
  const dustMat = T(new PointsMaterial({ map: glowTex, size: 0.035, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffe4b0, opacity: 0, fog: false }));
  const dust = new Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.visible = NDUST > 0;
  root.add(dust);

  // --- stations ----------------------------------------------------------------------------------------------------------------------------------------------
  const stationsGroup = new Group();
  root.add(stationsGroup);
  /** stationId -> { id, kind, group, prop|null, anchors } */
  const stations = new Map();
  let stationKey = '';
  const emptySlot = (st, variant) => {
    const g = new Group();
    const b = k.batch();
    // painted counter body, steel top, a folded cloth or a steel tray with plates on it
    b.box(M.teal, [1.3, 0.78, 0.9], [0, 0.39, 0], { tile: 1 });
    b.box(M.steel, [1.32, 0.04, 0.94], [0, S.counterTop - 0.02, 0], { tile: 1 });
    b.box(M.steelDull, [1.32, 0.05, 0.02], [0, S.counterTop - 0.065, 0.45], { tile: 1 });
    b.box(M.timber, [1.2, 0.05, 0.8], [0, 0.03, 0]);
    if (variant === 0) {
      b.box(M.cloth, [0.5, 0.025, 0.36], [-0.2, S.counterTop + 0.0125, 0.05], { rot: [0, 0.12, 0], color: '#d8cdb4' });
      b.box(M.cloth, [0.42, 0.02, 0.3], [-0.18, S.counterTop + 0.035, 0.06], { rot: [0, -0.08, 0], color: '#b0302a' });
      b.cyl(M.steelPlain, 0.09, 0.07, 0.1, 14, [0.35, S.counterTop + 0.05, -0.1]);
      b.cyl(M.steelDull, 0.095, 0.095, 0.012, 14, [0.35, S.counterTop + 0.106, -0.1]);
    } else {
      b.box(M.steelPlain, [0.62, 0.025, 0.42], [0, S.counterTop + 0.0125, 0.05], { rot: [0, 0.06, 0] });
      b.box(M.steelPlain, [0.62, 0.05, 0.012], [0, S.counterTop + 0.03, 0.26], { rot: [0, 0.06, 0] });
      for (let i = 0; i < 5; i++) b.cyl(M.steelPlain, 0.1, 0.085, 0.012, 16, [-0.15, S.counterTop + 0.03 + i * 0.013, 0.05]);
      b.cyl(M.steelDull, 0.04, 0.035, 0.07, 10, [0.2, S.counterTop + 0.06, 0.0]);
    }
    b.build(g);
    g.position.set(st.x, 0, st.z);
    return g;
  };
  function setStations(ids) {
    const key = ids.join(',');
    if (key === stationKey) return;
    stationKey = key;
    for (const s of stations.values()) {
      stationsGroup.remove(s.group);
      s.prop?.dispose?.();
      if (!s.prop) s.group.traverse((o) => o.geometry?.dispose?.());
    }
    stations.clear();
    let n = 0;
    // the five cooking stations always take their places (a station the level does not list is tidy empty counter space); the back counter
    // behind the cook exists only on levels that track stock, turned round so its front (and its Telugu plate) faces the cook
    for (const id of [...STATION_IDS, ...(ids.includes('prep1') ? ['prep1'] : [])]) {
      const st = STATIONS[id];
      const back = st.kind === 'prep';
      if (ids.includes(id)) {
        const prop = models.buildStationProp(st.kind);
        prop.group.position.set(st.x, 0, st.z);
        if (back) prop.group.rotation.y = Math.PI;
        shade(prop.group);
        stationsGroup.add(prop.group);
        stations.set(id, { id, kind: st.kind, group: prop.group, prop, anchors: prop.slotAnchors || [], rotY: back ? Math.PI : 0, front: back ? -1 : 1 });
        onPropCreated?.(id, prop);
      } else {
        const g = emptySlot(st, n++ % 2);
        shade(g);
        stationsGroup.add(g);
        stations.set(id, { id, kind: st.kind, group: g, prop: null, anchors: [], rotY: 0, front: 1 });
      }
    }
    const hasPrep = stations.has('prep1');
    prepOn = hasPrep;
    if (prepEntry) prepEntry.off = !hasPrep;
    if (pools.prep) pools.prep.visible = hasPrep;
    prepCandle.visible = hasPrep;
    opsDirty = true;
  }

  function setSpots(n) {
    spotMarks.forEach((m, i) => { m.visible = i < n; });
  }

  // --- the operations layer (docs/TIFFIN_CENTRE_PLAN.md section 3b) ---------------------------------------------------------------------------------------------
  // the gas stand: the live cylinder on its mat at LAYOUT.gas, a full spare beside it; a change carries the old one away and the spare onto the stand
  let opsDirty = true;
  const ops = { burners: true, flame: 1, power: true, pans: new Map() };
  const mkLpg = () => {
    try {
      return models.buildStreetProp?.('lpg') ?? null;
    } catch {
      return null;
    }
  };
  const GSX = LAYOUT.gas.x;
  const GSZ = LAYOUT.gas.z;
  const SPARE = { x: -4.2, z: 0.7, ry: 2.5 };
  const gasA = mkLpg();
  const gasB = mkLpg();
  for (const [g, x, z, ry] of [[gasA, GSX, GSZ, Math.PI], [gasB, SPARE.x, SPARE.z, SPARE.ry]]) {
    if (!g?.group) continue;
    g.group.position.set(x, 0, z);
    g.group.rotation.y = ry;
    shade(g.group);
    root.add(g.group);
  }
  props.push(...[gasA, gasB].filter(Boolean)); // they animate (the leak flame) and are disposed with the other props
  let standIsA = true;
  let wasSwapping = false;
  const sp = { out: 0, inn: 0 };
  const gasNow = { frac: 1, low: false };
  /** The cylinder of the view (ops-view.gasView): gauge, the hiss flame when low, the change (old one carried off, the spare brought in), burners on / off. */
  function setGas(gv) {
    const stand = standIsA ? gasA : gasB;
    const spare = standIsA ? gasB : gasA;
    const flame = gv.burners ? (gv.low ? 0.55 + 0.45 * Math.min(1, gv.frac / 0.2) : 1) : 0;
    if (gv.burners !== ops.burners || flame !== ops.flame) {
      ops.burners = gv.burners;
      ops.flame = flame;
      opsDirty = true;
    }
    gasNow.frac = gv.frac;
    gasNow.low = gv.low;
    if (gv.swapping) {
      swapPose(gv.swapT, sp);
      if (stand?.group) {
        stand.group.visible = sp.out < 0.97;
        stand.group.position.set(GSX - 1.7 * sp.out, 0.5 * Math.sin(Math.PI * Math.min(1, sp.out * 1.05)), GSZ + 0.5 * sp.out);
        stand.group.rotation.set(0, Math.PI + sp.out * 1.2, -0.45 * Math.sin(Math.PI * sp.out));
        stand.setLow?.(false);
      }
      if (spare?.group) {
        spare.group.position.set(SPARE.x + (GSX - SPARE.x) * sp.inn, 0.45 * Math.sin(Math.PI * sp.inn), SPARE.z + (GSZ - SPARE.z) * sp.inn);
        spare.group.rotation.set(0, SPARE.ry + (Math.PI - SPARE.ry) * sp.inn, 0.4 * Math.sin(Math.PI * sp.inn));
        spare.setLevel?.(1);
      }
      wasSwapping = true;
      return;
    }
    if (wasSwapping) {
      // done: the spare is on the stand now; the old cylinder goes back to the spare spot (a fresh full one is brought, out of sight)
      wasSwapping = false;
      standIsA = !standIsA;
    }
    const st2 = standIsA ? gasA : gasB;
    const sp2 = standIsA ? gasB : gasA;
    if (st2?.group) {
      st2.group.visible = true;
      st2.group.position.set(GSX, 0, GSZ);
      st2.group.rotation.set(0, Math.PI, 0);
      st2.setLevel?.(gv.frac);
      st2.setLow?.(gv.low);
    }
    if (sp2?.group) {
      sp2.group.visible = true;
      sp2.group.position.set(SPARE.x, 0, SPARE.z);
      sp2.group.rotation.set(0, SPARE.ry, 0);
      sp2.setLevel?.(1);
      sp2.setLow?.(false);
    }
  }

  /** The pan's condition (ops-view.panView) for a station: tawa / kadai colour and crust, the steamer's gauge. */
  function setPan(id, view) {
    ops.pans.set(id, view);
    stations.get(id)?.prop?.setHeat?.(view);
  }

  // the shelf: batter buckets (level + sourness) and the jars of chutney, sambar, podi and masala (contents sink with the stock)
  const jarMats = {};
  for (const j of dynJars) {
    if (!jarMats[j.item]) jarMats[j.item] = std(JAR_COLOR[j.item] || '#dddddd', { roughness: 0.55 });
    j.mesh = new Mesh(k.geo('jarfill' + j.r, () => new CylinderGeometry(j.r * 0.88, j.r * 0.88, 1, 12).translate(0, 0.5, 0)), jarMats[j.item]);
    root.add(j.mesh);
  }
  const stk = { fill: 0, sour: 0, isSour: false };
  /** The state's stock on the shelves. Without the operations layer (the tutorial) everything is full. */
  function setShelf(state) {
    const live = !!state?.cfg?.stock && !!state?.stock;
    for (const b of buckets) {
      const v = live ? stockOf(state, b.item, stk) : null;
      const fill = live ? (v ? stk.fill : 0) : 0.85;
      const sour = live && v ? stk.sour : 0;
      if (Math.abs(fill - b.fill) > 0.004 || Math.abs(sour - b.sour) > 0.004) {
        b.fill = fill;
        b.sour = sour;
        b.p?.setFill?.(fill, sour);
      }
    }
    for (const j of dynJars) {
      const v = live ? stockOf(state, j.item, stk) : null;
      const fill = live ? (v ? stk.fill : 0) : 0.8;
      if (Math.abs(fill - j.fill) > 0.004) {
        j.fill = fill;
        const hh = j.h * 0.82 * fill;
        j.mesh.visible = fill > 0.001;
        j.mesh.scale.y = Math.max(0.0001, hh);
        j.mesh.position.set(j.x, j.y + 0.012, j.z);
      }
    }
  }

  // power: a table fan on the floor at the cook's right and a bottle cooler at the back, both of which stop in a cut; a candle on the counter end and the
  // shrine diya are the only flames that matter then
  const fan = new Group();
  fan.position.set(3.3, 0, 1.0);
  {
    const fb = k.batch();
    fb.cyl(M.steelDark, 0.2, 0.22, 0.03, 16, [0, 0.015, 0]);
    fb.cyl(M.steelDull, 0.022, 0.022, 0.95, 8, [0, 0.5, 0]);
    fb.cyl(M.steelDark, 0.07, 0.07, 0.16, 12, [0, 1.0, 0], { rot: [Math.PI / 2, 0, 0] });
    fb.torus(M.steelDull, 0.2, 0.005, 4, 22, [0, 1.0, 0.1], {});
    fb.torus(M.steelDull, 0.14, 0.004, 4, 20, [0, 1.0, 0.1], {});
    fb.torus(M.steelDull, 0.07, 0.004, 4, 16, [0, 1.0, 0.1], {});
    fb.build(fan);
  }
  const blades = new Group();
  blades.position.set(0, 1.0, 0.1);
  const bladeM = std('#5c7ea8', { roughness: 0.5, side: DoubleSide });
  for (let b = 0; b < 3; b++) {
    const bl = put(plane(0.17, 0.07), bladeM, 0.085, 0, 0, null);
    bl.rotation.set(0.5, 0, 0);
    const piv = new Group();
    piv.rotation.z = (b / 3) * Math.PI * 2;
    piv.add(bl);
    blades.add(piv);
  }
  fan.add(blades);
  root.add(fan);
  shade(fan);

  const cooler = new Group();
  cooler.position.set(2.55, 0, 2.2);
  const coolerGlowM = std('#8fb8c4', { roughness: 0.3, emissive: '#bfe6ff', emissiveIntensity: 0.3 });
  const coolerLedM = std('#2fdc6a', { roughness: 0.4, emissive: '#2fdc6a', emissiveIntensity: 2 });
  {
    const cb = k.batch();
    cb.box(M.bluePlastic, [0.66, 1.0, 0.56], [0, 0.5, 0], {});
    cb.box(M.steelDark, [0.62, 0.04, 0.5], [0, 1.02, 0], {});
    for (let i = 0; i < 3; i++) cb.box(M.whitePlastic, [0.5, 0.012, 0.36], [0, 0.3 + i * 0.28, 0], {});
    const cols = [M.jarA, M.jarB, M.jarC, M.redPlastic];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) cb.cyl(cols[(r + c) % 4], 0.034, 0.034, 0.16, 8, [-0.2 + c * 0.1, 0.38 + r * 0.28, 0], {});
    cb.build(cooler);
  }
  const door = put(plane(0.56, 0.82), coolerGlowM, 0, 0.5, -0.285, cooler);
  door.rotation.y = Math.PI;
  put(plane(0.56, 0.82), std('#cfe6ea', { roughness: 0.06, transparent: true, opacity: 0.18, depthWrite: false, side: DoubleSide }), 0, 0.5, -0.29, cooler).rotation.y = Math.PI;
  put(box(0.025, 0.025, 0.01), coolerLedM, 0.26, 0.97, -0.284, cooler);
  root.add(cooler);
  shade(cooler);

  // a candle on the counter end and the shrine diya: flames + glow + (on the lit tiers) a real warm light, all scaled by how far the mains are cut
  const candleAt = [[-3.55, S.counterTop, -0.8], [3.98, 1.973, -1.86]];
  const candleM = std('#efe6cc', { roughness: 0.8 });
  put(cyl(0.017, 0.019, 0.1, 8), candleM, candleAt[0][0], S.counterTop + 0.05, candleAt[0][2], root);
  put(box(0.1, 0.012, 0.1), M.steelDull, candleAt[0][0], S.counterTop + 0.006, candleAt[0][2], root);
  const flameM = T(new MeshBasicMaterial({ color: 0xffc060, toneMapped: false }));
  const candleFlames = candleAt.map(([x, y, z], i) => {
    const f = new Mesh(k.geo('flame', () => new SphereGeometry(0.011, 8, 6).scale(1, 2.0, 1)), flameM);
    f.position.set(x, y + (i ? 0.02 : 0.115), z);
    f.visible = false;
    root.add(f);
    return f;
  });
  const candleGeo = T(new BufferGeometry());
  candleGeo.setAttribute('position', new Float32BufferAttribute(candleAt.map(([x, y, z], i) => [x, y + (i ? 0.03 : 0.12), z]).flat(), 3));
  const candleGlowM = T(new PointsMaterial({ map: glowTex, size: 0.55, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xff9a40, opacity: 0, fog: false }));
  const candleGlow = new Points(candleGeo, candleGlowM);
  candleGlow.frustumCulled = false;
  root.add(candleGlow);
  let candleLight = null;
  if (quality.lights) {
    candleLight = new PointLight(0xff9a3a, 0, 4.5, 2);
    candleLight.position.set(candleAt[0][0] + 0.2, S.counterTop + 0.45, candleAt[0][2] + 0.3);
    root.add(candleLight);
  }
  // a second candle on the back counter, so the prep work is not in the dark in a cut (there only when the level has that counter)
  const prepCandle = new Group();
  prepCandle.visible = false;
  root.add(prepCandle);
  const pcx = STATIONS.prep1.x + 0.52;
  const pcz = STATIONS.prep1.z - 0.18;
  put(cyl(0.017, 0.019, 0.1, 8), candleM, pcx, S.counterTop + 0.05, pcz, prepCandle);
  put(box(0.1, 0.012, 0.1), M.steelDull, pcx, S.counterTop + 0.006, pcz, prepCandle);
  const prepFlame = new Mesh(k.geo('flame', () => new SphereGeometry(0.011, 8, 6).scale(1, 2.0, 1)), flameM);
  prepFlame.position.set(pcx, S.counterTop + 0.115, pcz);
  prepFlame.visible = false;
  prepCandle.add(prepFlame);
  const prepGlowG = T(new BufferGeometry());
  prepGlowG.setAttribute('position', new Float32BufferAttribute([pcx, S.counterTop + 0.12, pcz], 3));
  const prepGlow = new Points(prepGlowG, candleGlowM);
  prepGlow.frustumCulled = false;
  prepCandle.add(prepGlow);
  let prepCandleLight = null;
  if (quality.lights) {
    prepCandleLight = new PointLight(0xff9a3a, 0, 4, 2);
    prepCandleLight.position.set(pcx - 0.25, S.counterTop + 0.5, pcz - 0.1);
    root.add(prepCandleLight); // not a child of prepCandle (which hides with the prep counter): the number of lights must never change
  }
  let grid = 1;
  let fanSpin = 0;
  let fanRate = 1;

  // re-apply what the stall knows about the operations layer to freshly built station props
  function applyOps() {
    for (const s of stations.values()) {
      if (!s.prop) continue;
      s.prop.setBurner?.(ops.burners, ops.flame);
      s.prop.setPower?.(ops.power);
      const pv = ops.pans.get(s.id);
      if (pv) s.prop.setHeat?.(pv);
    }
    opsDirty = false;
  }

  // --- per-frame light response ------------------------------------------------------------------------------------------------------------------------------
  const cBulb = new Color();
  const sunDir = new Vector3();
  const zAxis = new Vector3(0, 0, 1);
  const qq = new Quaternion();
  function setLight(L, t) {
    const flick = tubeFlicker(t, L.tube);
    cBulb.setRGB(1, 0.74, 0.38, SRGBColorSpace).multiplyScalar(0.25 + (post ? 7 : 2.4) * L.bulb);
    bulbMat.color.copy(cBulb);
    glowMat.opacity = (post ? 0.5 : 0.85) * L.bulb;
    tubeBodyM.emissiveIntensity = (post ? 5 : 1.8) * flick;
    tubeGlowMat.opacity = (post ? 0.35 : 0.7) * flick;
    bannerFront.emissiveIntensity = 0.12 * L.neon;
    menuM.emissiveIntensity = 0.22 * L.neon;
    for (const lt of lights) lt.l.intensity = lt.off ? 0 : lt.kind === 'tube' ? lt.base * flick : lt.base * L.bulb * (0.97 + 0.03 * Math.sin(t * 7.3 + lt.l.position.x));
    if (pools.mat) pools.mat.opacity = 0.34 * L.bulb;
    // the mains: a power cut (L.grid < 1) stops the fan and the cooler's light and lights the candle and the diya
    grid = L.grid ?? 1;
    const cut = 1 - grid;
    const powered = grid > 0.5;
    if (powered !== ops.power) {
      ops.power = powered;
      opsDirty = true;
    }
    coolerGlowM.emissiveIntensity = (post ? 1.5 : 1.0) * (0.22 + 0.78 * L.night) * grid;
    coolerLedM.emissiveIntensity = 2 * grid;
    const flick2 = 0.82 + 0.18 * Math.sin(t * 13.1) * Math.sin(t * 5.3 + 1);
    candleGlowM.opacity = (post ? 0.5 : 0.8) * cut * flick2;
    for (let i = 0; i < candleFlames.length; i++) {
      candleFlames[i].visible = cut > 0.05;
      candleFlames[i].scale.set(1, 0.85 + 0.3 * Math.sin(t * (11 + i * 3.7)), 1);
    }
    flameM.color.setRGB(1, 0.72, 0.34, SRGBColorSpace).multiplyScalar(post ? 3 : 1.2);
    if (candleLight) candleLight.intensity = 6.5 * cut * flick2;
    prepFlame.visible = cut > 0.05;
    prepFlame.scale.set(1, 0.85 + 0.3 * Math.sin(t * 12.3 + 1), 1);
    if (prepCandleLight) prepCandleLight.intensity = prepOn ? 5 * cut * flick2 : 0;
    // shafts follow the key light; only when it is a low warm sun (shaft > 0)
    const s = L.shaft;
    shaftU.uStrength.value = s * 0.28;
    srgb(shaftU.uColor.value, L.sun);
    shaftU.uTime.value = t;
    sunDir.set(-L.sunDir[0], -L.sunDir[1], -L.sunDir[2]); // the light travels away from the sun
    qq.setFromUnitVectors(zAxis, sunDir);
    for (const m of shafts) {
      const d = m.userData;
      m.visible = s > 0.02;
      if (!m.visible) continue;
      m.position.set(d.x, d.y, d.z);
      m.quaternion.copy(qq);
      m.scale.set(d.w * 1.1, 0.75, 4.2 + Math.max(0, 0.6 - L.sunDir[1]) * 3);
    }
    dustMat.opacity = Math.min(0.6, s * 0.7) * (post ? 0.8 : 1);
    dust.visible = NDUST > 0 && dustMat.opacity > 0.01;
  }

  const posAttr = dustGeo.attributes.position;
  function update(dt, t) {
    if (opsDirty) applyOps();
    // the fan runs up and winds down (inertia), oscillating on its pole
    fanRate = approach(fanRate, grid > 0.5 ? 1 : 0, dt, 0.9, 2.6);
    fanSpin += dt * 26 * fanRate;
    blades.rotation.z = -fanSpin;
    blades.parent.rotation.y = Math.sin(t * 0.35) * 0.55 * fanRate + 0.35;
    for (const s of stations.values()) s.prop?.update?.(dt, t);
    for (const p of props) p.update?.(dt, t);
    bulbs.rotation.z = Math.sin(t * 0.9) * 0.003;
    // cloths sway in the street breeze
    for (const c of cloths) {
      const sway = Math.sin(t * 1.1 + c.phase) * 0.05 + Math.sin(t * 2.3 + c.phase * 2) * 0.015;
      c.mesh.rotation.x = sway;
      c.mesh.rotation.z = Math.sin(t * 0.8 + c.phase) * 0.03;
    }
    if (dust.visible) {
      const a = posAttr.array;
      for (let i = 0; i < NDUST; i++) {
        const sx = dustSeed[i * 3];
        const sy = dustSeed[i * 3 + 1];
        const sz = dustSeed[i * 3 + 2];
        a[i * 3 + 1] += Math.sin(t * 0.3 + sy) * dt * 0.02;
        a[i * 3] += Math.sin(t * 0.21 + sx) * dt * 0.025;
        a[i * 3 + 2] += Math.cos(t * 0.17 + sz) * dt * 0.02;
      }
      posAttr.needsUpdate = true;
    }
    if (binHop > 0) {
      binHop = Math.max(0, binHop - dt * 4);
      binLid.position.y = 0.78 + Math.sin(binHop * Math.PI) * 0.12;
      binLid.rotation.x = -Math.sin(binHop * Math.PI) * 0.4;
    }
  }
  let binHop = 0;

  /** World position of slot i of a station (anchor in the prop's local space, turned with the prop, + the prop's place). */
  function slotWorld(stationId, i, out) {
    const s = stations.get(stationId);
    if (!s) return null;
    const a = s.anchors[i];
    if (a) {
      if (s.rotY) {
        const c = Math.cos(s.rotY);
        const sn = Math.sin(s.rotY);
        out.set(a.x * c + a.z * sn, a.y, -a.x * sn + a.z * c);
      } else out.copy(a);
      out.add(s.group.position);
    } else out.set(s.group.position.x - 0.4 + i * 0.4, 1.1, s.group.position.z);
    return out;
  }

  function dispose() {
    for (const s of stations.values()) s.prop?.dispose?.();
    for (const p of props) p.dispose?.();
    stations.clear();
    scene.remove(root);
  }

  shade(bin);
  void tmpC;
  void Object3D;
  void Vector2;
  void Mesh;
  return {
    root, stations, binPos: new Vector3(LAYOUT.bin.x, 0, LAYOUT.bin.z), setStations, setSpots, setMenu: (m, off) => menu.set(m, off), setLight, update, slotWorld,
    setGas, setPan, setShelf, gasNow,
    bumpBin: () => { binHop = 1; }, redrawText: () => { art.redrawAll?.(); menu.tex.userData.redraw?.(); }, murMat: null,
    counterY: S.counterTop, roofGaps, dispose,
  };
}
