// Everything beyond the stall's counter, at real scale: the footpath and its kerb, a nine-metre road with markings, potholes, patches and
// puddles, parked scooters, electric poles with tangled wires and a sodium street light, trees, the shopfronts across the road (kirana,
// medical shop, sweet shop, mobile repair, shuttered shops with Telugu / Hindi / English boards) with their upper storeys, rooftop hoardings,
// a cross lane that frames a hazy four-minaret monument far down the avenue, a city of far boxes, instanced traffic on a loop with head and
// tail lights at night, pedestrians with walk cycles, a street dog, a midday cow and birds. Cheap: merged statics, instanced movers.
import {
  AdditiveBlending, BufferGeometry, Color, DoubleSide, Euler, Float32BufferAttribute, Group, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry,
  PointLight, Points, PointsMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, Vector3, Vector2, BoxGeometry, DynamicDrawUsage,
} from 'three';
import * as models from '../models/index.js';
import { createKit, shade } from './kit.js';
import { createVehicleKit } from './street-vehicles.js';
import { mulberry } from './textures.js';
import { smoothstep, clamp } from './interp.js';

const srgb = (c, rgb, k = 1) => c.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k, SRGBColorSpace);

export const STREET = {
  kerbZ: -6.5, roadMid: -11.1, farKerbZ: -15.8, shopZ: -17.0, laneX: 4.0, monument: { x: 40, z: -170 },
  lanes: [{ z: -8.0, dir: -1, v: 6.2 }, { z: -9.6, dir: -1, v: 8.4 }, { z: -12.5, dir: 1, v: 7.4 }, { z: -14.1, dir: 1, v: 5.4 }],
};

export function createStreet({ scene, art, tr, quality }) {
  art.setQuality?.(quality);
  const k = createKit(tr);
  const V = createVehicleKit(k);
  const { T, std } = k;
  const root = new Group();
  root.name = 'street';
  scene.add(root);
  const rnd = mulberry(2026);
  const tmp = new Color();
  const post = !!quality.post;

  // --- materials ---------------------------------------------------------------------------------------------------------------------------------
  const M = {
    paving: k.pbr(art.paving(), { metalness: 0 }),
    asphalt: k.pbr(art.asphalt(), { metalness: 0 }),
    kerb: k.pbr(art.concrete(), { metalness: 0, color: '#c8c2b4' }),
    plasterA: k.pbr(art.plaster(), { metalness: 0, color: '#d9c7a4', normal: 0.4 }),
    plasterB: k.pbr(art.plaster(), { metalness: 0, color: '#b9c9bd', normal: 0.4 }),
    plasterC: k.pbr(art.plaster(), { metalness: 0, color: '#d6b4a4', normal: 0.4 }),
    plasterD: k.pbr(art.plaster(), { metalness: 0, color: '#c8c8c0', normal: 0.4 }),
    pole: k.pbr(art.plaster(), { metalness: 0, color: '#8e8c86', normal: 0.4 }),
    bark: k.pbr(art.plaster(), { metalness: 0, color: '#6a5646', normal: 0.4 }),
    galv: std('#a4abb0', { metalness: 1, roughness: 0.42 }),
    black: std('#161515', { roughness: 0.7, metalness: 0.2 }),
    wire: std('#0c0c0c', { roughness: 0.6 }),
    tank: std('#1d2226', { roughness: 0.5 }),
    ground: std('#4a4339', { roughness: 1 }),
    tarp: k.pbr(art.tarp([0.1, 0.3, 0.64]), { metalness: 0, side: DoubleSide }),
    tarpOrange: k.pbr(art.tarp([0.75, 0.3, 0.05]), { metalness: 0, side: DoubleSide }),
    leaf: std('#ffffff', { map: art.foliage(0), alphaTest: 0.5, side: DoubleSide, roughness: 0.9, vertexColors: true }),
    crate: std('#7a5a34', { roughness: 0.9 }),
    sack: std('#bba67c', { roughness: 0.95 }),
    rubber: std('#17140f', { roughness: 0.85 }),
    litter: std('#ffffff', { map: art.decal('litter'), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  M.leaf.alphaToCoverage = !!quality.msaa;
  const B = k.batch();
  const Y = (x) => x;

  // --- ground: the footpath, the kerb, the road, the far footpath, the dusty city beyond ------------------------------------------------------------
  const FP = -0.02; // footpath level
  const RD = -0.17; // road level
  B.plane(M.paving, 170, 16.2, [0, FP, 1.6], { rot: [-Math.PI / 2, 0, 0], tile: 1.2 });
  B.box(M.kerb, [170, 0.26, 0.3], [0, -0.05, STREET.kerbZ], { tile: 1 });
  B.box(M.kerb, [170, 0.26, 0.3], [0, -0.05, STREET.farKerbZ], { tile: 1 });
  B.plane(M.asphalt, 170, 9.1, [0, RD, (STREET.kerbZ + STREET.farKerbZ) / 2], { rot: [-Math.PI / 2, 0, 0], tile: 3 });
  B.plane(M.paving, 170, 1.4, [0, FP, -16.4], { rot: [-Math.PI / 2, 0, 0], tile: 1.2, off: [0.3, 0.1] });
  B.plane(M.ground, 700, 520, [0, -0.3, -280], { rot: [-Math.PI / 2, 0, 0], tile: 0 });
  // the cross lane towards the monument: a strip of asphalt along the sight line
  const lineAng = Math.atan2(STREET.monument.x - STREET.laneX, -(STREET.monument.z - STREET.shopZ));
  {
    const g = new PlaneGeometry(7.2, 440);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -220);
    B.geo(M.asphalt, g, [STREET.laneX, RD + 0.002, STREET.shopZ + 1.2], { rot: [0, -lineAng, 0], tile: 3 });
  }
  const kerbPaint = std('#e8c840', { roughness: 0.8 });
  const kerbBlack = std('#1a1a1a', { roughness: 0.8 });
  for (let i = -40; i < 40; i++) B.box(i % 2 ? kerbBlack : kerbPaint, [1.2, 0.01, 0.14], [i * 1.2 + 0.6, 0.083, STREET.kerbZ + 0.0], { tile: 0 });

  // --- road decals: dashed centre line, zebra crossing, potholes, patches, oil, puddles --------------------------------------------------------------
  const decals = k.batch();
  const dashTex = art.decal('dash');
  dashTex.wrapS = RepeatWrapping;
  const mDash = std('#ffffff', { map: dashTex, transparent: true, depthWrite: false, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  {
    const g = new PlaneGeometry(136, 0.2);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 136 / 5, uv.getY(i));
    decals.geo(mDash, g, [0, RD + 0.004, STREET.roadMid], { tile: 0 });
  }
  const mZebra = std('#ffffff', { map: art.decal('zebra'), transparent: true, depthWrite: false, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  decals.plane(mZebra, 3.4, 8.4, [-8.0, RD + 0.005, (STREET.kerbZ + STREET.farKerbZ) / 2], { rot: [-Math.PI / 2, 0, 0], tile: 0 });
  const mPot = std('#ffffff', { map: art.decal('pothole'), transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (const [x, z, s, r] of [[-3.2, -8.8, 1.1, 0.3], [7.5, -10.2, 0.8, 1.5], [-14.5, -13.0, 1.3, 2.2], [14, -8.4, 0.9, 0.9], [1.2, -13.3, 0.7, 1.1], [-20, -9.1, 1.0, 0.5], [22, -12.7, 1.2, 2.8]]) {
    decals.plane(mPot, s * 1.4, s * 1.1, [x, RD + 0.006, z], { rot: [-Math.PI / 2, 0, r], tile: 0 });
  }
  const mPatch = std('#ffffff', { map: art.decal('patch'), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const [x, z, s, r] of [[-6, -9.0, 1.6, 0.1], [10, -13.4, 2.0, 0.0], [-1.5, -12.0, 1.4, 0.05], [18, -9.5, 1.8, 0.0]]) {
    decals.plane(mPatch, s * 1.5, s * 0.75, [x, RD + 0.005, z], { rot: [-Math.PI / 2, 0, r], tile: 0 });
  }
  const mStain = std('#ffffff', { map: art.decal('stain'), transparent: true, depthWrite: false, roughness: 0.5, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const [x, z, s, r] of [[-9.5, -8.2, 3.0, 0.2], [6, -9.1, 2.6, 1.4], [12.5, -12.4, 3.4, 0.7], [-18, -12.7, 2.8, 2.4], [0, -8.0, 2.4, 0.1]]) {
    decals.plane(mStain, s, s * 0.7, [x, RD + 0.003, z], { rot: [-Math.PI / 2, 0, r], tile: 0 });
  }
  for (const [x, z, s, r] of [[-5.5, -6.2, 3, 0.2], [2.5, -6.1, 2.6, 0], [9, -6.2, 3.2, 0.5], [-12, -6.15, 3, 0.1], [14, -6.2, 2.4, 0.3], [-1, -15.6, 3, 0.4]]) {
    decals.plane(M.litter, s, s * 0.5, [x, FP + 0.004, z], { rot: [-Math.PI / 2, 0, r], tile: 0 });
  }
  // a kolam (rangoli) drawn at the next-door doorstep, and old oil on the footpath
  const mKolam = std('#ffffff', { map: art.decal('kolam'), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  decals.plane(mKolam, 1.5, 1.5, [5.2, 0.003, -1.6], { rot: [-Math.PI / 2, 0, 0.5], tile: 0 });
  decals.plane(mStain, 2.4, 1.6, [-1.5, FP + 0.002, -3.6], { rot: [-Math.PI / 2, 0, 0.6], tile: 0 });
  decals.plane(mStain, 2.8, 1.8, [6.5, FP + 0.002, -5.0], { rot: [-Math.PI / 2, 0, 1.6], tile: 0 });
  decals.build(root, { cast: false, receive: true, name: 'street-decals' });
  // puddles (mirror dark, reflecting the sky and lamps; their strength follows the wet curve)
  const puddleM = std('#06080c', { roughness: 0.03, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false, map: art.decal('puddle'), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, envMapIntensity: 1.8 });
  const puddleB = k.batch();
  for (const [x, z, w, h, r] of [[-2.6, -7.3, 2.2, 1.2, 0.2], [1.6, -8.6, 3.2, 1.5, 0.1], [4.4, -7.2, 1.6, 0.9, 0.5], [-7.4, -8.0, 2.6, 1.3, 0.2], [-0.2, -6.9, 1.4, 0.8, 0.9], [11, -9.2, 2.4, 1.2, 0.0], [-13, -7.4, 2.0, 1.0, 0.4], [-3.0, -4.3, 1.3, 0.8, 0.3], [3.4, -3.9, 1.5, 0.9, 1.0]]) {
    puddleB.plane(puddleM, w, h, [x, (z > -6.4 ? FP : RD) + 0.007, z], { rot: [-Math.PI / 2, 0, r], tile: 0 });
  }
  puddleB.build(root, { cast: false, receive: false, name: 'puddles' });
  // manholes
  for (const [x, z] of [[-4.2, -9.2], [6.8, -13.0]]) B.cyl(M.black, 0.34, 0.34, 0.02, 20, [x, RD + 0.008, z], { tile: 0.5 });

  // --- the shops across the road --------------------------------------------------------------------------------------------------------------------
  const shopTex = { kirana: art.kirana(), medical: art.medical(), sweets: art.sweets(), mobile: art.mobile() };
  for (let i = 0; i < 4; i++) shopTex[`shutter${i}`] = art.shutterShop(i);
  const emissives = [];
  const faceMat = (t) => {
    const m = std('#ffffff', { map: t.map, roughness: 0.85, emissive: '#ffffff', emissiveIntensity: 0 });
    m.emissiveMap = t.emis;
    emissives.push(m);
    return m;
  };
  const shopMat = {};
  for (const id of Object.keys(shopTex)) shopMat[id] = faceMat(shopTex[id]);
  // plaster micro-detail on every facade: the same baked normal / roughness, cloned so each facade can tile it at its own scale (the GPU upload is shared)
  const plasterB = art.plaster();
  const detail = (m, rx, ry) => {
    if (plasterB.normalMap) {
      const nm = tr.track(plasterB.normalMap.clone());
      nm.repeat.set(rx, ry);
      nm.needsUpdate = true;
      m.normalMap = nm;
      m.normalScale = new Vector2(0.55, 0.55);
    }
    if (plasterB.ormMap) {
      const rm = tr.track(plasterB.ormMap.clone());
      rm.repeat.set(rx, ry);
      rm.needsUpdate = true;
      m.roughnessMap = rm;
      m.roughness = 1;
    }
    return m;
  };
  for (const id of Object.keys(shopMat)) detail(shopMat[id], 2.2, 1.5);
  const bldTex = [art.building(1, '#d9b98a'), art.building(2, '#b8c8bc'), art.building(3, '#d8b4a4'), art.building(4, '#cfcfc4')];
  const bldMat = bldTex.map((t) => detail(faceMat(t), 2.2, 3.3));
  const body = [M.plasterA, M.plasterB, M.plasterC, M.plasterD];
  const hoard = [art.hoarding(0), art.hoarding(1), art.hoarding(2), art.hoarding(3)].map((t) => std('#ffffff', { map: t, roughness: 0.7, side: DoubleSide, emissive: '#ffffff', emissiveIntensity: 0, emissiveMap: t }));

  const row = [
    [-45, 'shutter3', 2], [-40, 'shutter0', 3], [-35, 'sweets', 2], [-30, 'shutter1', 3], [-25, 'mobile', 3], [-20, 'shutter2', 2], [-15, 'kirana', 3], [-10, 'medical', 2], [-5, 'sweets', 3],
    [10.5, 'shutter3', 3], [15.5, 'mobile', 2], [20.5, 'kirana', 3], [25.5, 'shutter0', 2], [30.5, 'medical', 3], [35.5, 'shutter2', 2], [40.5, 'sweets', 3], [45.5, 'shutter1', 2],
  ];
  const upper = k.batch();
  const tubeB = k.batch();
  const signB = k.batch();
  const acMat = std('#cfcfc8', { roughness: 0.6 });
  const tubeM = std('#e9eef0', { roughness: 0.4, emissive: '#d8ecff', emissiveIntensity: 0 });
  const sz = STREET.shopZ;
  row.forEach(([x, shop, floors], idx) => {
    const v = (idx * 7 + Math.floor(Math.abs(x))) % 4;
    const totalH = 3.5 + floors * 2.5;
    // building body (hides the inside), shop face, upper storeys
    B.box(body[v], [4.96, totalH, 9], [x, totalH / 2, sz - 4.5], { tile: 3 });
    B.plane(shopMat[shop], 5.0, 3.44, [x, 1.72, sz + 0.03], { tile: 0 });
    const g = new PlaneGeometry(5.0, floors * 2.5);
    const uv = g.attributes.uv;
    const v0 = 1 - floors / 3;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), v0 + uv.getY(i) * (1 - v0));
    upper.geo(bldMat[v], g, [x, 3.44 + (floors * 2.5) / 2, sz + 0.03], { tile: 0 });
    // floor slabs that overhang a little (shadow lines), a parapet, water tanks on the terrace
    for (let f = 0; f <= floors; f++) B.box(body[(v + 1) % 4], [5.06, 0.14, 0.7], [x, 3.5 + f * 2.5, sz + 0.34], { tile: 3 });
    B.box(body[(v + 2) % 4], [5.04, 0.55, 0.22], [x, totalH + 0.27, sz + 0.05], { tile: 3 });
    for (const dx of [-2.43, 2.43]) B.box(body[(v + 1) % 4], [0.2, 3.6, 0.55], [x + dx, 1.8, sz + 0.27], { tile: 3 });
    B.box(body[(v + 3) % 4], [4.9, 0.1, 0.3], [x, 3.42, sz + 0.15], { tile: 3 });
    if (idx % 3 === 1) {
      B.cyl(M.tank, 0.7, 0.7, 1.1, 14, [x - 1.2, totalH + 0.7, sz - 2.2], { tile: 1 });
      B.cyl(M.tank, 0.7, 0.7, 1.1, 14, [x + 0.3, totalH + 0.7, sz - 2.6], { tile: 1 });
    }
    if (idx % 4 === 2) B.box(body[v], [1.6, 2.2, 1.6], [x + 1.5, totalH + 1.1, sz - 3], { tile: 3 });
    // air-conditioner boxes, a drain pipe, a tube-light over the shop, a dish on the terrace, a blade sign
    const acY = 3.5 + ((idx % floors) + 0.5) * 2.5;
    if (idx % 2 === 0) {
      B.box(acMat, [0.82, 0.55, 0.38], [x + 1.45, acY - 0.1, sz + 0.42], { tile: 0 });
      B.cyl(M.black, 0.2, 0.2, 0.03, 12, [x + 1.45, acY - 0.1, sz + 0.62], { rot: [Math.PI / 2, 0, 0], tile: 0 });
    }
    if (idx % 3 !== 0) B.rod(M.galv, [x - 2.25, 0, sz + 0.1], [x - 2.25, totalH, sz + 0.1], 0.035, 6);
    if (idx % 2 === 1) B.rod(M.galv, [x + 0.3, totalH + 0.55, sz - 2.6], [x + 0.3, totalH + 1.4, sz - 2.6], 0.03, 5);
    if (idx % 2 === 1) B.sph(M.galv, 0.42, 10, 6, [x + 0.3, totalH + 1.55, sz - 2.55], { scale: [1, 0.3, 1], rot: [0.7, 0.3, 0], tile: 0 });
    if (idx % 4 !== 3) {
      tubeB.box(tubeM, [1.3, 0.05, 0.1], [x + (idx % 2 ? 0.8 : -0.8), 3.28, sz + 0.28], { tile: 0 });
      tubeB.box(M.galv, [1.34, 0.025, 0.12], [x + (idx % 2 ? 0.8 : -0.8), 3.32, sz + 0.28], { tile: 0 });
    }
    if (idx % 3 === 0) {
      const bs = std('#ffffff', { map: art.poster(idx), roughness: 0.7, side: DoubleSide, emissive: '#ffffff', emissiveIntensity: 0 });
      bs.emissiveMap = bs.map;
      hoard.push(bs);
      B.rod(M.galv, [x + 2.45, 4.6, sz + 0.1], [x + 2.45, 4.6, sz + 1.0], 0.02, 5);
      signB.plane(bs, 0.62, 1.1, [x + 2.45, 4.0, sz + 0.62], { rot: [0, Math.PI / 2, 0], tile: 0 });
    }
    // awnings: a tarpaulin sloping over the footpath on some shops
    if (shop === 'kirana' || shop === 'sweets') B.plane(shop === 'kirana' ? M.tarp : M.tarpOrange, 4.6, 1.3, [x, 3.15, sz + 0.62], { rot: [-Math.PI / 2 + 0.34, 0, 0], tile: 0.5 });
    if (shop === 'kirana') for (const dx of [-2.2, 2.2]) B.rod(M.galv, [x + dx, 0, sz + 1.15], [x + dx, 3.0, sz + 1.1], 0.025, 6);
    // goods stacked on the far footpath
    if (shop === 'kirana') {
      for (let i = 0; i < 4; i++) B.box(M.crate, [0.5, 0.32, 0.4], [x - 1.5 + i * 0.55, 0.16 + (i % 2) * 0.32, sz + 0.5], { tile: 0.5 });
      B.box(M.sack, [0.5, 0.7, 0.35], [x + 1.4, 0.35, sz + 0.5], { tile: 0.5 });
    }
  });
  // behind the stall: the buildings the footpath belongs to (seen when the head turns far round)
  for (let idx = 0, x = -47.5; x <= 47.5; x += 5, idx++) {
    const floors = 2 + (idx % 2);
    const shop = ['shutter0', 'shutter1', 'shutter2', 'shutter3', 'kirana', 'medical'][idx % 6];
    const v = (idx * 3) % 4;
    const zr = 10.4;
    const totalH = 3.5 + floors * 2.5;
    B.box(body[v], [4.96, totalH, 9], [x, totalH / 2, zr + 4.5], { tile: 3 });
    B.plane(shopMat[shop], 5.0, 3.44, [x, 1.72, zr - 0.03], { rot: [0, Math.PI, 0], tile: 0 });
    const g = new PlaneGeometry(5.0, floors * 2.5);
    const uv = g.attributes.uv;
    const v0 = 1 - floors / 3;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), v0 + uv.getY(i) * (1 - v0));
    upper.geo(bldMat[v], g, [x, 3.44 + (floors * 2.5) / 2, zr - 0.03], { rot: [0, Math.PI, 0], tile: 0 });
  }
  // end walls of the cross lane, running back along the lane with windows
  for (const [x, ry] of [[0.5 - 0.02, 0], [7.5 + 0.02, 0]]) B.box(M.plasterA, [0.2, 11, 22], [x, 5.5, sz - 11], { tile: 3, rot: [0, ry, 0] });
  // hoardings on terraces, on steel frames
  const hoardSpots = [[-35, 0, 6.5], [-15, 1, 11], [-5, 2, 11], [15.5, 3, 8.5], [30.5, 0, 11], [40.5, 1, 11]];
  hoardSpots.forEach(([x, n, topY]) => {
    const hw = 4.4;
    const hh = 2.2;
    B.rod(M.galv, [x - hw / 2 + 0.2, topY - 0.2, sz - 0.4], [x - hw / 2 + 0.2, topY + hh + 0.4, sz - 0.4], 0.04, 6);
    B.rod(M.galv, [x + hw / 2 - 0.2, topY - 0.2, sz - 0.4], [x + hw / 2 - 0.2, topY + hh + 0.4, sz - 0.4], 0.04, 6);
    B.rod(M.galv, [x - hw / 2, topY + 0.3, sz - 0.4], [x - hw / 2, topY + 0.3, sz - 1.8], 0.025, 5);
    B.rod(M.galv, [x + hw / 2, topY + 0.3, sz - 0.4], [x + hw / 2, topY + 0.3, sz - 1.8], 0.025, 5);
    B.box(M.galv, [hw + 0.1, 0.07, 0.07], [x, topY + hh + 0.02, sz - 0.4], {});
    B.box(M.galv, [hw + 0.1, 0.07, 0.07], [x, topY + 0.02, sz - 0.4], {});
  });

  // --- electric poles, tangled wires, the street light -----------------------------------------------------------------------------------------------
  const poles = [[-9, STREET.kerbZ + 0.3], [11.5, STREET.kerbZ + 0.3], [-4, STREET.farKerbZ - 0.3], [16, STREET.farKerbZ - 0.3], [-22, STREET.kerbZ + 0.3], [26, STREET.kerbZ + 0.3]];
  const poleTops = [];
  for (const [x, z] of poles) {
    const h = 9.2;
    B.cyl(M.pole, 0.1, 0.16, h, 12, [x, h / 2, z], { tile: 1.5 });
    B.box(M.galv, [1.5, 0.07, 0.07], [x, h - 0.4, z]);
    B.box(M.galv, [1.0, 0.07, 0.07], [x, h - 1.1, z]);
    for (const dx of [-0.65, -0.2, 0.25, 0.65]) B.cyl(M.black, 0.03, 0.04, 0.12, 6, [x + dx, h - 0.32, z]);
    if (x === -9 || x === 16) {
      B.cyl(M.galv, 0.28, 0.28, 0.9, 12, [x + 0.4, h - 2.2, z], { tile: 1 }); // transformer can
      B.box(M.galv, [1.1, 0.06, 0.22], [x + 0.15, h - 1.6, z]);
    }
    poleTops.push([x, h - 0.32, z]);
  }
  const wireBundle = (a, b, n, sag) => {
    for (let j = 0; j < n; j++) {
      const off = (j - (n - 1) / 2) * 0.22;
      const s = sag * (0.8 + rnd() * 0.5);
      const p0 = [a[0] + off, a[1] - (j % 2) * 0.7, a[2] + (j % 3) * 0.04];
      const p3 = [b[0] + off, b[1] - (j % 2) * 0.7, b[2] + (j % 3) * 0.04];
      const mid = (t) => [p0[0] + (p3[0] - p0[0]) * t, p0[1] + (p3[1] - p0[1]) * t - Math.sin(Math.PI * t) * s, p0[2] + (p3[2] - p0[2]) * t];
      B.tube(M.wire, [p0, mid(0.25), mid(0.5), mid(0.75), p3], 0.011 + (j % 2) * 0.004, 20, 4);
    }
  };
  wireBundle(poleTops[0], poleTops[1], 6, 0.7);
  wireBundle(poleTops[1], poleTops[5], 5, 0.8);
  wireBundle(poleTops[4], poleTops[0], 5, 0.7);
  wireBundle(poleTops[0], poleTops[2], 4, 1.2);
  wireBundle(poleTops[1], poleTops[3], 4, 1.3);
  wireBundle(poleTops[2], poleTops[3], 5, 0.9);
  // loose service wires dropping to the shops and a few tangled loops
  for (const [px, pz] of [[-4, STREET.farKerbZ], [16, STREET.farKerbZ]]) {
    for (let j = 0; j < 3; j++) B.tube(M.wire, [[px, 8.6, pz], [px + 1.5 + j, 7.0 - j * 0.6, pz - 0.8], [px + 3 + j, 5.4 - j * 0.3, sz + 0.3], [px + 3.4 + j, 3.8, sz + 0.28]], 0.01, 14, 4);
  }
  for (let i = 0; i < 4; i++) {
    const [x, y, z] = poleTops[i % poleTops.length];
    B.tube(M.wire, [[x - 0.4, y - 0.4, z], [x - 1.0, y - 1.4, z + 0.3], [x - 0.5, y - 2.2, z - 0.2], [x + 0.2, y - 1.4, z + 0.2], [x - 0.2, y - 0.5, z]], 0.01, 20, 4);
  }
  // the sodium street light
  const lamps = [[5.4, STREET.kerbZ + 0.35, 1]];
  if ((quality.lampLights || 0) > 1) lamps.push([-14.5, STREET.kerbZ + 0.35, -1]);
  const lampHeads = [];
  for (const [x, z, s] of lamps) {
    B.cyl(M.galv, 0.065, 0.1, 7.4, 10, [x, 3.7, z], { tile: 1.5 });
    B.rod(M.galv, [x, 7.2, z], [x + 0.2 * s, 7.55, z - 2.1], 0.04, 6);
    B.box(M.galv, [0.72, 0.13, 0.3], [x + 0.2 * s, 7.45, z - 2.2]);
    B.box(M.black, [0.62, 0.03, 0.26], [x + 0.2 * s, 7.37, z - 2.2]);
    lampHeads.push([x + 0.2 * s, 7.34, z - 2.2]);
  }

  // --- trees: neem and banyan, a trunk and cards of leaves ---------------------------------------------------------------------------------------------
  const leafB = k.batch();
  const barkB = B;
  const tree = (x, z, h, spread, seed) => {
    const r = mulberry(seed);
    barkB.cyl(M.bark, 0.22, 0.34, h * 0.55, 9, [x, h * 0.275, z], { tile: 1 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * 6.28 + r();
      barkB.rod(M.bark, [x, h * 0.45, z], [x + Math.cos(a) * spread * 0.45, h * 0.8, z + Math.sin(a) * spread * 0.35], 0.09, 6, { tile: 1 });
    }
    const n = quality.decor >= 1 ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const a = r() * 6.28;
      const d = Math.sqrt(r()) * spread;
      const cx = x + Math.cos(a) * d;
      const cy = h * 0.72 + (r() - 0.3) * h * 0.38;
      const cz = z + Math.sin(a) * d * 0.7;
      const s = 3.2 + r() * 2.2;
      const lum = 0.55 + r() * 0.5;
      leafB.plane(M.leaf, s, s, [cx, cy, cz], { rot: [(r() - 0.5) * 0.9, r() * 3.14, (r() - 0.5) * 0.5], tile: 0, color: `rgb(${Math.round(255 * lum * 0.8)},${Math.round(255 * lum)},${Math.round(255 * lum * 0.7)})` });
    }
  };
  tree(-15.5, STREET.kerbZ + 0.8, 9, 3.2, 11);
  tree(14.2, STREET.kerbZ + 0.9, 8, 3.0, 12);
  tree(-26, STREET.kerbZ + 0.8, 9.5, 3.6, 13);
  tree(-9.5, STREET.farKerbZ - 0.7, 8.5, 3.0, 14);
  tree(21, STREET.farKerbZ - 0.8, 9, 3.4, 15);
  tree(-19, 12, 10, 4.2, 16); // behind the stall, framing nothing, just present when the head turns
  B.build(root, { cast: true, receive: true, name: 'street-static' });
  upper.build(root, { cast: false, receive: false, name: 'street-upper' });
  tubeB.build(root, { cast: false, receive: false, name: 'shop-tubes' });
  signB.build(root, { cast: false, receive: false, name: 'blade-signs' });
  leafB.build(root, { cast: false, receive: false, name: 'street-leaves' });

  // hoarding faces: each takes its own texture
  {
    const hb = k.batch();
    hoardSpots.forEach(([x, n, topY]) => hb.plane(hoard[n], 4.4, 2.2, [x, topY + 1.1, sz - 0.34], { tile: 0 }));
    hb.build(root, { cast: false, receive: false, name: 'hoardings' });
  }

  // --- the monument at the end of the lane: four minarets, great arches, floodlit at night ----------------------------------------------------------
  const mono = new Group();
  mono.position.set(STREET.monument.x, 0, STREET.monument.z);
  mono.rotation.y = -Math.atan2(STREET.monument.x - 0, -STREET.monument.z + 0);
  mono.scale.setScalar(1);
  root.add(mono);
  const monoTex = art.monument();
  const monoPlaster = k.pbr(art.plaster(), { metalness: 0, color: '#cdbd9a', rest: { emissive: new Color('#ff9a50'), emissiveIntensity: 0 } });
  const monoFace = std('#ffffff', { map: monoTex.map, roughness: 0.9, emissive: '#ffffff', emissiveIntensity: 0, emissiveMap: monoTex.emis });
  emissives.push(monoFace);
  const mb = k.batch();
  mb.box(monoPlaster, [34, 1.6, 34], [0, 0.8, 0], { tile: 3 });
  mb.box(monoPlaster, [28, 16, 28], [0, 9.6, 0], { tile: 3 });
  mb.box(monoPlaster, [26, 3.2, 26], [0, 19.2, 0], { tile: 3 });
  for (const [dx, dz, ry] of [[0, 14.03, 0], [0, -14.03, Math.PI], [14.03, 0, Math.PI / 2], [-14.03, 0, -Math.PI / 2]]) {
    mb.plane(monoFace, 28, 14.4, [dx, 9.0, dz], { rot: [0, ry, 0], tile: 0 });
  }
  for (let i = -5; i <= 5; i++) {
    for (const [dx, dz] of [[i * 2.4, 13.2], [i * 2.4, -13.2], [13.2, i * 2.4], [-13.2, i * 2.4]]) mb.sph(monoPlaster, 0.7, 8, 6, [dx, 21.3, dz], { scale: [1, 1.2, 1] });
  }
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) {
    const x = sx * 13.8;
    const z = sz2 * 13.8;
    mb.cyl(monoPlaster, 2.1, 2.6, 24, 18, [x, 12, z], { tile: 3 });
    mb.cyl(monoPlaster, 1.6, 2.1, 20, 18, [x, 33, z], { tile: 3 });
    for (const y of [22, 30, 37]) mb.cyl(monoPlaster, 2.9, 2.9, 0.6, 18, [x, y, z], { tile: 3 });
    for (const y of [22.55, 30.55, 37.55]) mb.cyl(monoPlaster, 2.3, 2.5, 0.5, 18, [x, y, z], { tile: 3 });
    mb.cyl(monoPlaster, 2.0, 1.6, 2.2, 18, [x, 44.2, z], { tile: 3 });
    mb.sph(monoPlaster, 2.0, 16, 12, [x, 46.2, z], { scale: [1, 1.3, 1] });
    mb.cyl(monoPlaster, 0.12, 0.2, 3.4, 8, [x, 49.6, z]);
    mb.sph(monoPlaster, 0.35, 8, 6, [x, 51.4, z]);
  }
  for (const dz of [-2.2, 0, 2.2]) {
    mb.cyl(monoPlaster, 2.2, 2.4, 1.2, 14, [dz * 2.4, 22.4, dz], { tile: 3 });
    mb.sph(monoPlaster, 2.0, 14, 10, [dz * 2.4, 23.9, dz], { scale: [1, 1.1, 1] });
  }
  mb.build(mono, { cast: false, receive: false, name: 'monument' });

  // --- the far city: instanced boxes in the haze, a clear corridor left along the lane to the monument -------------------------------------------------
  const cityTex = art.building(9, '#c9b9a0');
  const cityMat = std('#ffffff', { map: cityTex.map, roughness: 0.95, emissive: '#ffffff', emissiveIntensity: 0, emissiveMap: cityTex.emis });
  emissives.push(cityMat);
  const nCity = quality.decor >= 1.4 ? 120 : quality.decor >= 1 ? 80 : 36;
  const cityGeo = T(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  { const uv = cityGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 5); }
  cityTex.map.wrapS = cityTex.map.wrapT = RepeatWrapping;
  cityTex.emis.wrapS = cityTex.emis.wrapT = RepeatWrapping;
  const city = new InstancedMesh(cityGeo, cityMat, nCity);
  const dummy = new Object3D();
  const cr = mulberry(777);
  const tint = ['#d9c7a4', '#c4cfc4', '#dcb9a8', '#cfcfc6', '#e0d2b0', '#b8b2a4'];
  const mA = Math.tan(lineAng);
  for (let i = 0; i < nCity; i++) {
    const zz = -58 - cr() * 210;
    const lx = STREET.laneX + mA * (-zz - 17);
    let xx = lx + (cr() < 0.5 ? -1 : 1) * (6.5 + cr() * 90);
    if (Math.abs(xx - lx) < 16 + Math.abs(zz) * 0.05) xx += xx < lx ? -22 : 22;
    const w = 8 + cr() * 14;
    const h = 9 + cr() * (zz < -120 ? 34 : 20);
    const d = 8 + cr() * 12;
    dummy.position.set(xx, -0.3, zz);
    dummy.scale.set(w, h, d);
    dummy.rotation.set(0, (cr() - 0.5) * 0.12, 0);
    dummy.updateMatrix();
    city.setMatrixAt(i, dummy.matrix);
    city.setColorAt(i, tmp.set(tint[i % tint.length]));
  }
  city.frustumCulled = false;
  root.add(city);

  // --- movers: traffic, pedestrians, birds ---------------------------------------------------------------------------------------------------------------
  const geos = { auto: V.auto(), bike: V.bike(true), car: V.car(), bus: V.bus(), bicycle: V.bicycle(), bikeParked: V.bike(false), torso: V.walkerTorso(), leg: V.walkerLeg() };
  const bodyMat = std('#ffffff', { vertexColors: true, roughness: 0.55, metalness: 0.15 });
  // the per-instance tint only reaches the parts painted white (uv.x = 1): skin, glass and tyres keep their own colour
  bodyMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('vColor.xyz *= instanceColor.xyz;', 'vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, uv.x);');
  };
  bodyMat.customProgramCacheKey = () => 'tc-tintmask';
  const lightMat = T(new MeshBasicMaterial({ vertexColors: true, color: 0x333333 }));
  const mk = (g, n) => {
    const out = [];
    if (g.body) {
      const m = new InstancedMesh(g.body, bodyMat, n);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      root.add(m);
      out.push(m);
    } else out.push(null);
    if (g.lights) {
      const m = new InstancedMesh(g.lights, lightMat, n);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      root.add(m);
      out.push(m);
    } else out.push(null);
    return out;
  };
  const nv = quality.vehicles;
  const counts = { auto: Math.max(2, Math.round(nv * 0.3)), bike: Math.max(2, Math.round(nv * 0.35)), car: Math.max(1, Math.round(nv * 0.2)), bus: nv >= 12 ? 2 : 1, bicycle: nv >= 8 ? 2 : 1 };
  const inst = {};
  for (const t of Object.keys(counts)) inst[t] = mk(geos[t], counts[t]);
  const vcol = { auto: ['#f2c21a', '#2f8a4a', '#f2c21a', '#e8e0d0'], bike: ['#c4402a', '#2a62c4', '#e8e0d0', '#444a52', '#2f8a4a'], car: ['#e8e8e8', '#9aa0a4', '#8a2a2a', '#2a3a5a', '#d8d4c8'], bus: ['#c8402a', '#e8e4d8', '#2a6a9a'], bicycle: ['#e8e0d0', '#c4402a'] };
  const vehicles = [];
  const speedMul = { auto: 1, bike: 1.2, car: 1.05, bus: 0.8, bicycle: 0.45 };
  let ln = 0;
  for (const t of Object.keys(counts)) {
    for (let i = 0; i < counts[t]; i++) {
      const lane = STREET.lanes[(ln++ + (t === 'bus' ? 2 : 0)) % 4];
      const colour = vcol[t][i % vcol[t].length];
      vehicles.push({ t, i, lane, x: -38 + rnd() * 76, v: lane.v * speedMul[t] * (0.92 + rnd() * 0.16), bob: rnd() * 6, colour, scale: t === 'bus' ? 1 : 0.97 + rnd() * 0.06, dz: (rnd() - 0.5) * 0.5 });
      for (const m of inst[t]) if (m) m.setColorAt(i, tmp.set(colour));
    }
  }
  const q = new Quaternion();
  const eu = new Euler();
  const sc = new Vector3();
  const ps = new Vector3();
  const setInst = (mesh, i, x, y, z, yaw, tilt, s = 1, roll = 0) => {
    eu.set(roll, yaw, tilt, 'YZX');
    q.setFromEuler(eu);
    ps.set(x, y, z);
    sc.set(s, s, s);
    dummy.matrix.compose(ps, q, sc);
    mesh.setMatrixAt(i, dummy.matrix);
  };
  // parked scooters on the near footpath (static) and along the far kerb
  const parkedList = [[2.3, -4.7, 1.25], [3.0, -4.5, 1.9], [-3.9, -4.9, 0.4], [-11.2, -4.6, 1.3], [8.8, -5.0, 1.6], [14, -4.9, 0.9]];
  const parked = mk(geos.bikeParked, parkedList.length);
  parkedList.forEach(([x, z, ry], i) => {
    setInst(parked[0], i, x, FP, z, ry, 0, 1.0);
    parked[0].setColorAt(i, tmp.set(['#c4402a', '#2a62c4', '#e8e0d0', '#2f8a4a', '#444a52', '#e8c040'][i % 6]));
    if (parked[1]) setInst(parked[1], i, x, FP, z, ry, 0, 1.0);
  });
  for (const m of parked) if (m) { m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; }
  if (parked[0].instanceColor) parked[0].instanceColor.needsUpdate = true;
  // pedestrians
  const nWalk = Math.max(2, quality.walkers);
  const torso = new InstancedMesh(geos.torso.body, bodyMat, nWalk);
  const legL = new InstancedMesh(geos.leg.body, bodyMat, nWalk);
  const legR = new InstancedMesh(geos.leg.body, bodyMat, nWalk);
  const shirt = ['#9a4a3a', '#3a5a82', '#d8d2c0', '#4a6a4a', '#c0a050', '#6a4a7a', '#b86a3a', '#4a4a52', '#b8848c', '#bdb8a8'];
  const pants = ['#2a2a34', '#3a3a52', '#4a3a2a', '#cfc8b8', '#2a3a2a', '#1c1c1e'];
  const walkers = [];
  for (let i = 0; i < nWalk; i++) {
    const far = i % 3 === 2;
    walkers.push({ x: -30 + rnd() * 60, z: far ? -16.4 : -4.9 - rnd() * 0.9, v: (rnd() < 0.5 ? -1 : 1) * (1.0 + rnd() * 0.5), ph: rnd() * 6, s: 0.92 + rnd() * 0.16 });
    torso.setColorAt(i, tmp.set(shirt[i % shirt.length]));
    legL.setColorAt(i, tmp.set(pants[i % pants.length]));
    legR.setColorAt(i, tmp.set(pants[i % pants.length]));
  }
  for (const m of [torso, legL, legR]) {
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.frustumCulled = false;
    root.add(m);
  }
  // birds
  const nBirds = quality.birds || 0;
  let birds = null;
  const birdList = [];
  if (nBirds > 0) {
    const bg = T(new BufferGeometry());
    bg.setAttribute('position', new Float32BufferAttribute([0.14, 0, 0, -0.14, 0, 0, 0, 0.1, 0.62, 0.14, 0, 0, -0.14, 0, 0, 0, 0.1, -0.62], 3));
    bg.computeVertexNormals();
    const bm = T(new MeshBasicMaterial({ color: 0x1b1a1c, side: DoubleSide, fog: true, transparent: true }));
    birds = new InstancedMesh(bg, bm, nBirds);
    birds.frustumCulled = false;
    birds.instanceMatrix.setUsage(DynamicDrawUsage);
    root.add(birds);
    for (let i = 0; i < nBirds; i++) birdList.push({ x: -80 + rnd() * 160, y: 22 + rnd() * 24, z: -50 - rnd() * 90, v: (rnd() < 0.5 ? -1 : 1) * (4 + rnd() * 3), ph: rnd() * 6 });
  }

  // --- the models' dog, cow and neighbours ---------------------------------------------------------------------------------------------------------------
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
    shade(p.group, true, true);
    root.add(p.group);
    props.push(p);
    return p;
  };
  prop('panipuri-cart', 8.2, FP, -4.2, 0.35);
  prop('thela', -12.5, FP, -4.4, 0.2);
  prop('dog', -5.4, FP, -4.1, 1.2);
  const cowP = prop('cow', -22, FP, -6.9, Math.PI / 2);
  if (cowP) cowP.group.visible = false;

  // --- lights: sodium lamps (glow + real light on the tiers that have them) ---------------------------------------------------------------------------------
  const glowTex = art.softDot();
  const lampGeo = T(new BufferGeometry());
  lampGeo.setAttribute('position', new Float32BufferAttribute(lampHeads.flat(), 3));
  const lampGlowM = T(new PointsMaterial({ map: glowTex, size: 3.6, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffa94d, opacity: 0, fog: false }));
  const lampGlow = new Points(lampGeo, lampGlowM);
  lampGlow.frustumCulled = false;
  root.add(lampGlow);
  const lampLights = [];
  const nLamp = quality.lampLights ?? (quality.lights ? 1 : 0);
  for (let i = 0; i < Math.min(nLamp, lampHeads.length); i++) {
    const l = new PointLight(0xffa040, 0, 30, 2);
    l.position.set(lampHeads[i][0], lampHeads[i][1] - 0.4, lampHeads[i][2] + 0.5);
    root.add(l);
    lampLights.push(l);
  }

  // --- contact shadows: soft dark quads thrown along the sun direction from everything that stands outside the real shadow map ----------------------------
  const shadowGeo = T(new PlaneGeometry(1, 1));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = T(new MeshBasicMaterial({ color: 0x000000, map: art.blob(), transparent: true, opacity: 0.5, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  const statics = [];
  for (const [x, z] of poles) statics.push({ x, z, h: 9.2, len: 0.3, wid: 0.35 });
  for (const [x, z] of lamps) statics.push({ x, z, h: 7.4, len: 0.2, wid: 0.25 });
  for (const [x, z] of [[-15.5, STREET.kerbZ + 0.8], [14.2, STREET.kerbZ + 0.9], [-26, STREET.kerbZ + 0.8], [-9.5, STREET.farKerbZ - 0.7], [21, STREET.farKerbZ - 0.8]]) statics.push({ x, z, h: 7, len: 5, wid: 5.2 });
  for (const [x, z] of parkedList) statics.push({ x, z, h: 1.3, len: 1.5, wid: 0.5 });
  const dims = { auto: [1.9, 2.8, 1.5], bike: [1.7, 1.5, 0.55], car: [1.5, 3.9, 1.8], bus: [3.2, 9.8, 2.6], bicycle: [1.6, 1.3, 0.45] };
  const maxShadows = statics.length + vehicles.length + walkers.length + 4;
  const shadows = new InstancedMesh(shadowGeo, shadowMat, maxShadows);
  shadows.instanceMatrix.setUsage(DynamicDrawUsage);
  shadows.frustumCulled = false;
  shadows.renderOrder = 3;
  root.add(shadows);
  const sh = { dx: 0, dz: 1, cot: 1, on: 0 };
  const setShadow = (i, x, z, h, len, wid, scaleOn = 1) => {
    const y = z > STREET.kerbZ ? FP + 0.01 : z < STREET.farKerbZ ? FP + 0.01 : RD + 0.012;
    const reach = Math.min(h * sh.cot, 7);
    const length = (len * 0.8 + reach) * scaleOn;
    const cx = x + sh.dx * reach * 0.5;
    const cz = z + sh.dz * reach * 0.5;
    eu.set(0, Math.atan2(-sh.dz, sh.dx), 0, 'YXZ');
    q.setFromEuler(eu);
    ps.set(cx, y, cz);
    sc.set(Math.max(0.0001, length), 1, Math.max(0.0001, wid * 1.1 * scaleOn));
    dummy.matrix.compose(ps, q, sc);
    shadows.setMatrixAt(i, dummy.matrix);
  };
  const writeStaticShadows = () => {
    statics.forEach((c, i) => setShadow(i, c.x, c.z, c.h, c.len, c.wid));
  };

  // --- per frame --------------------------------------------------------------------------------------------------------------------------------------------------
  let hourNow = 12;
  let activeFrac = 1;
  const cowPos = new Vector3();
  function update(dt, t) {
    const nAct = (type) => Math.max(1, Math.round(counts[type] * activeFrac));
    for (const v of vehicles) {
      v.x += v.lane.dir * v.v * dt;
      if (v.x > 42) v.x = -42;
      if (v.x < -42) v.x = 42;
      const on = v.i < nAct(v.t);
      const yaw = v.lane.dir > 0 ? 0 : Math.PI;
      const s = on ? v.scale : 0.0001;
      const bob = Math.sin(t * 11 + v.bob) * 0.008;
      const lean = v.t === 'bike' ? Math.sin(t * 0.7 + v.bob) * 0.03 : 0;
      for (const m of inst[v.t]) if (m) setInst(m, v.i, v.x, bob + RD + 0.17, v.lane.z + v.dz, yaw, 0, s, lean);
    }
    for (const t2 of Object.keys(inst)) for (const m of inst[t2]) if (m) m.instanceMatrix.needsUpdate = true;
    {
      let si = statics.length;
      for (const v of vehicles) {
        const d = dims[v.t];
        setShadow(si++, v.x, v.lane.z + v.dz, d[0], d[1], d[2], v.i < nAct(v.t) ? 1 : 0);
      }
      for (const w of walkers) setShadow(si++, w.x, w.z, 1.7, 0.4, 0.45, 1);
      shadows.instanceMatrix.needsUpdate = true;
    }
    // pedestrians with a walk cycle: legs swing about the hip, a little body bob
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i];
      w.x += w.v * dt;
      if (w.x > 36) w.x = -36;
      if (w.x < -36) w.x = 36;
      const yaw = w.v > 0 ? 0 : Math.PI;
      const ph = t * 5.2 * Math.abs(w.v) + w.ph;
      const swing = Math.sin(ph) * 0.55;
      const bob = Math.abs(Math.cos(ph)) * 0.025;
      const on = (i % 5) < Math.max(1, Math.round(5 * activeFrac)) ? 1 : 0.0001;
      const s = w.s * on;
      setInst(torso, i, w.x, FP + bob * s, w.z, yaw, 0, s);
      const hipY = FP + 0.88 * s + bob * s;
      const side = 0.1 * s;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      setInst(legL, i, w.x + sy * side, hipY, w.z + cy * side, yaw, swing, s);
      setInst(legR, i, w.x - sy * side, hipY, w.z - cy * side, yaw, -swing, s);
    }
    torso.instanceMatrix.needsUpdate = true;
    legL.instanceMatrix.needsUpdate = true;
    legR.instanceMatrix.needsUpdate = true;
    if (birds) {
      for (let i = 0; i < birdList.length; i++) {
        const b = birdList[i];
        b.x += b.v * dt;
        if (b.x > 90) b.x = -90;
        if (b.x < -90) b.x = 90;
        const flap = Math.sin(t * 9 + b.ph);
        eu.set(0, b.v > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 'YZX');
        q.setFromEuler(eu);
        ps.set(b.x, b.y + Math.sin(t * 0.4 + b.ph) * 1.2, b.z);
        sc.set(1, 0.4 + 0.9 * Math.abs(flap), 1.1);
        dummy.matrix.compose(ps, q, sc);
        birds.setMatrixAt(i, dummy.matrix);
      }
      birds.instanceMatrix.needsUpdate = true;
    }
    for (const p of props) p.update?.(dt, t);
    // the cow ambles along the road edge at midday: its place is a pure function of the hour, so everyone sees the same cow
    if (cowP) {
      const f = (hourNow - 11.5) / 4.5;
      if (f > 0 && f < 1) {
        cowP.group.visible = true;
        cowPos.set(-30 + f * 60, FP + Math.abs(Math.sin(t * 2.2)) * 0.012, -6.8 + Math.sin(f * 9) * 0.15);
        cowP.group.position.copy(cowPos);
      } else cowP.group.visible = false;
    }
  }

  const cLight = new Color();
  function setLight(L) {
    hourNow = L.hour;
    {
      const hz = Math.hypot(L.sunDir[0], L.sunDir[2]) || 1;
      sh.dx = -L.sunDir[0] / hz;
      sh.dz = -L.sunDir[2] / hz;
      sh.cot = Math.min(4, hz / Math.max(0.12, L.sunDir[1]));
      sh.on = smoothstep(clamp((L.sunEl - 1) / 10, 0, 1));
      shadowMat.opacity = 0.5 * sh.on * L.shadow;
      shadows.visible = sh.on > 0.01;
      writeStaticShadows();
    }
    const wet = clamp(L.wet, 0, 1);
    // the tarmac darkens and shines as the night comes on (the sky and lamps are what it reflects)
    const mr = 1 - 0.62 * wet;
    M.asphalt.roughness = mr;
    M.asphalt.color.setRGB(1 - 0.32 * wet, 1 - 0.32 * wet, 1 - 0.28 * wet);
    M.paving.roughness = 1 - 0.3 * wet;
    M.paving.color.setRGB(1 - 0.2 * wet, 1 - 0.2 * wet, 1 - 0.17 * wet);
    puddleM.opacity = 0.18 + 0.72 * smoothstep(wet);
    const night = smoothstep((L.night - 0.2) / 0.55);
    for (const m of emissives) m.emissiveIntensity = 0.65 * night;
    for (const m of hoard) m.emissiveIntensity = 0.55 * night;
    tubeM.emissiveIntensity = (post ? 4 : 1.6) * night;
    monoPlaster.emissiveIntensity = 0.12 * night;
    // sodium lamps
    const sod = L.sodium;
    lampGlowM.opacity = (post ? 0.55 : 0.9) * sod;
    for (const l of lampLights) l.intensity = 330 * sod;
    // vehicles' lamps: a faint lens by day, a hot HDR glare at night
    const k2 = 0.25 + (post ? 7 : 2.5) * night;
    lightMat.color.setRGB(k2, k2, k2);
    cLight.setRGB(1, 1, 1);
    // traffic thins out late, peaks at the morning and evening rush
    const h = L.hour;
    activeFrac = clamp(0.45 + 0.55 * Math.max(smoothstep(1 - Math.abs(h - 9) / 2.2), smoothstep(1 - Math.abs(h - 18) / 2.4), 0.55) - 0.55 * smoothstep((h - 22.5) / 1.2), 0.25, 1);
    if (birds) birds.visible = L.night < 0.55;
    void srgb;
    void Y;
  }

  function dispose() {
    scene.remove(root);
    for (const p of props) p.dispose?.();
    for (const m of [city, torso, legL, legR, birds, shadows, parked[0], parked[1], ...Object.values(inst).flat()]) m?.dispose?.();
  }

  return { root, update, setLight, dispose, STREET };
}
