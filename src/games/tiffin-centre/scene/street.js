// Everything beyond the stall's counter: the neighbouring shops (a kirana shutter, a pani-puri cart), the electric pole with its tangle
// of wires, the wet tarred road with puddles, passers-by, autos / scooters / bikes (instanced), a street dog and, at noon, a cow.
// All of it is cheap: instanced vehicles and walkers, merged vehicle meshes, no per-frame allocation.
import {
  AdditiveBlending, BoxGeometry, CylinderGeometry, SphereGeometry, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh,
  Line, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Points, PointsMaterial, SRGBColorSpace, Matrix4,
} from 'three';
import { buildStreetProp } from '../models/index.js';
import { createKit, shade } from './kit.js';
import { mulberry } from './textures.js';
import { smoothstep, clamp } from './interp.js';

const srgb = (c, rgb, k = 1) => c.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k, SRGBColorSpace);

export function createStreet({ scene, art, tr, quality }) {
  const k = createKit(tr);
  const { T, std, basic, box, cyl, sph, plane, put } = k;
  const root = new Group();
  root.name = 'street';
  scene.add(root);
  const rnd = mulberry(2026);

  // --- the road --------------------------------------------------------------------------------------------------------------------
  const roadTex = art.road();
  roadTex.repeat.set(9, 2);
  const roadM = std('#ffffff', { map: roadTex, roughness: 0.95, metalness: 0 });
  const road = put(plane(60, 12), roadM, 0, -0.005, 9.1, root);
  road.rotation.x = -Math.PI / 2;
  // far pavement and the shops' side of the street do not matter: fog + background swallow them

  // puddles
  const puddleTex = art.puddle();
  const puddleM = T(new MeshBasicMaterial({ map: puddleTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  const puddles = [[-2.6, 3.7, 1.7, 0.7], [1.2, 4.35, 2.4, 0.9], [4.4, 3.5, 1.3, 0.55], [-5.4, 4.6, 1.8, 0.7], [-0.4, 2.62, 1.0, 0.4]];
  for (const [x, z, w, h] of puddles) {
    const p = put(plane(w, h), puddleM, x, 0.02, z, root);
    p.rotation.x = -Math.PI / 2;
    p.renderOrder = 2;
  }

  // --- neighbouring buildings -------------------------------------------------------------------------------------------------------
  const lightMasks = [];
  const buildingMat = (tex, mask) => {
    const m = std('#ffffff', { map: tex, roughness: 0.92, emissive: '#ffffff', emissiveMap: mask, emissiveIntensity: 0 });
    lightMasks.push(m);
    return m;
  };
  const kiranaM = std('#ffffff', { map: art.kirana(), roughness: 0.9 });
  const blockL = buildingMat(art.block(1, '#c9a78a'), art.blockLights(1));
  const blockR = buildingMat(art.block(2, '#bfa98f'), art.blockLights(2));
  const blockR2 = buildingMat(art.block(3, '#b79a80'), art.blockLights(3));
  const plain = std('#a98d76', { roughness: 0.95 });
  // left: the kirana (shutter facing the street) — materials per face: +x, -x, +y, -y, +z, -z
  const left = put(box(5.6, 6.2, 6.4), [blockL, plain, plain, plain, kiranaM, plain], -10.6, 3.1, -1.3, root);
  void left;
  const right = put(box(5.6, 6.8, 6.4), [plain, blockR, plain, plain, blockR2, plain], 10.6, 3.4, -1.3, root);
  void right;
  // far backdrop blocks behind (seen above the stall in tall windows)
  const rear = [blockL, blockR, blockR2, blockL, blockR, blockR2, blockL];
  rear.forEach((m, i) => {
    const x = -19 + i * 6.4;
    put(box(5.8, 7 + ((i * 5) % 6), 3), [m, m, plain, plain, m, plain], x, (7 + ((i * 5) % 6)) / 2, -9 - (i % 2) * 2.5, root);
  });

  // flex banners and posters on the kirana
  const flexM = std('#ffffff', { map: art.poster(1), roughness: 0.8 });
  put(plane(1.1, 1.65), flexM, -8.2, 2.6, 1.95, root).rotation.y = 0;
  put(plane(1.1, 1.65), std('#ffffff', { map: art.poster(3), roughness: 0.8 }), -12.4, 2.3, 1.95, root);

  // --- neighbours + pole: the models' street props ------------------------------------------------------------------------------------------
  const props = [];
  const prop = (id, x, y, z, ry = 0, opts) => {
    const p = buildStreetProp(id, opts);
    p.group.position.set(x, y, z);
    p.group.rotation.y = ry;
    root.add(p.group);
    props.push(p);
    return p;
  };
  prop('panipuri-cart', 8.3, 0, 1.2, -0.3);
  prop('pole-with-wires', -6.15, 0, 2.5, 0.2);
  const dogP = prop('dog', -5.55, 0, 2.25, 1.2);
  const cowP = prop('cow', -20, 0, 3.35, Math.PI / 2);
  cowP.group.visible = false;

  // sodium lamp on the pole: a warm glow at night
  const lampGlowTex = art.softDot();
  const lampGeo = T(new BufferGeometry());
  lampGeo.setAttribute('position', new Float32BufferAttribute([-5.6, 5.4, 2.7], 3));
  const lampGlowM = T(new PointsMaterial({ map: lampGlowTex, size: 4.2, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffa94d, opacity: 0, fog: false }));
  const lampGlow = new Points(lampGeo, lampGlowM);
  lampGlow.frustumCulled = false;
  root.add(lampGlow);

  // --- passers-by (instanced silhouettes) -------------------------------------------------------------------------------------------------------
  const N = quality.walkers;
  const cyl2 = (rt, rb, h, seg, hex, x, y, z) => k.paint(new CylinderGeometry(rt, rb, h, seg).translate(x, y, z), hex);
  const torsoGeo = k.merge([cyl2(0.17, 0.2, 0.6, 8, '#ffffff', 0, 1.2, 0), k.paint(new SphereGeometry(0.13, 8, 6).translate(0, 1.66, 0), '#d8a888')]);
  const legsGeo = k.merge([cyl2(0.07, 0.06, 0.8, 6, '#2a2a32', 0, 0.4, 0.09), cyl2(0.07, 0.06, 0.8, 6, '#2a2a32', 0, 0.4, -0.09)]);
  const personM = std('#ffffff', { vertexColors: true, roughness: 0.9 });
  const bodyI = new InstancedMesh(torsoGeo, personM, N);
  const legsI = new InstancedMesh(legsGeo, personM, N);
  const dark = ['#c47a62', '#6a8fb0', '#d8b25a', '#7aa87a', '#b9a0c8', '#e0e0d0', '#cc6666', '#8a8aa0'];
  const walkers = [];
  const tmpCol = new Color();
  for (let i = 0; i < N; i++) {
    walkers.push({ x: -13 + rnd() * 26, z: 3.1 + rnd() * 0.2, v: (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), ph: rnd() * 6 });
    bodyI.setColorAt(i, tmpCol.set(dark[i % dark.length]));
    legsI.setColorAt(i, tmpCol.set('#ffffff'));
  }
  for (const m of [bodyI, legsI]) {
    m.frustumCulled = false;
    root.add(m);
  }

  // --- vehicles: merged auto / scooter geometries, instanced -------------------------------------------------------------------------------------
  const part = (g, hex, x, y, z, rx = 0, ry = 0, rz = 0) => {
    g.rotateX(rx);
    g.rotateY(ry);
    g.rotateZ(rz);
    g.translate(x, y, z);
    return k.paint(g, hex);
  };
  const B = (w, h, d) => new BoxGeometry(w, h, d);
  const Cy = (r, h, s = 12) => new CylinderGeometry(r, r, h, s);
  const autoGeo = k.merge([
    part(B(2.1, 0.55, 1.3), '#ffffff', 0, 0.62, 0),
    part(B(1.4, 0.07, 1.35), '#1d1d1f', -0.15, 1.72, 0),
    part(B(0.07, 0.95, 0.07), '#303034', 0.5, 1.2, 0.6),
    part(B(0.07, 0.95, 0.07), '#303034', 0.5, 1.2, -0.6),
    part(B(0.07, 0.95, 0.07), '#303034', -0.85, 1.2, 0.6),
    part(B(0.07, 0.95, 0.07), '#303034', -0.85, 1.2, -0.6),
    part(B(0.5, 0.9, 1.0), '#ffffff', 0.78, 1.0, 0),
    part(B(0.05, 0.5, 0.9), '#222a32', 1.04, 1.25, 0),
    part(B(0.1, 0.12, 0.2), '#fff2b0', 1.07, 0.8, 0.35),
    part(B(0.1, 0.12, 0.2), '#fff2b0', 1.07, 0.8, -0.35),
    part(B(0.9, 0.45, 1.05), '#26262a', -0.3, 1.0, 0),
    part(Cy(0.24, 0.14), '#101010', 0.85, 0.24, 0, Math.PI / 2),
    part(Cy(0.24, 0.14), '#101010', -0.6, 0.24, 0.66, Math.PI / 2),
    part(Cy(0.24, 0.14), '#101010', -0.6, 0.24, -0.66, Math.PI / 2),
  ]);
  const bikeGeo = k.merge([
    part(B(1.0, 0.28, 0.26), '#ffffff', 0, 0.62, 0),
    part(B(0.5, 0.1, 0.24), '#1b1b1d', -0.2, 0.82, 0),
    part(B(0.35, 0.3, 0.3), '#ffffff', 0.45, 0.78, 0),
    part(B(0.06, 0.55, 0.06), '#888a8c', 0.55, 0.62, 0, 0, 0, -0.3),
    part(B(0.06, 0.06, 0.62), '#2a2a2e', 0.62, 1.0, 0),
    part(Cy(0.27, 0.1), '#101010', 0.62, 0.27, 0, Math.PI / 2),
    part(Cy(0.27, 0.1), '#101010', -0.62, 0.27, 0, Math.PI / 2),
    part(B(0.09, 0.09, 0.14), '#fff2b0', 0.72, 0.96, 0),
    part(Cy(0.17, 0.62, 8), '#3a3a52', -0.15, 1.3, 0),
    part(new SphereGeometry(0.15, 8, 6), '#b57a52', -0.12, 1.78, 0),
    part(Cy(0.09, 0.5, 6), '#2a2a34', 0.2, 1.1, 0.12, 0, 0, 1.0),
  ]);
  const vcol = ['#f2c21a', '#2f8a4a', '#d0301f', '#2a62c4', '#e8e0d0', '#444a52', '#c8802a', '#8a2a5a'];
  const nAuto = Math.max(1, Math.ceil(quality.vehicles / 3));
  const nBike = Math.max(1, quality.vehicles - nAuto);
  const vehMat = std('#ffffff', { vertexColors: true, roughness: 0.55, metalness: 0.2 });
  const autos = new InstancedMesh(autoGeo, vehMat, nAuto);
  const bikes = new InstancedMesh(bikeGeo, vehMat, nBike);
  const vehicles = [];
  const lanes = [5.3, 6.2, 7.1, 8.0];
  const addVeh = (mesh, i, type) => {
    const lane = (vehicles.length + (type === 'auto' ? 0 : 1)) % lanes.length;
    const dir = lane < 2 ? -1 : 1;
    vehicles.push({ mesh, i, type, x: -14 + rnd() * 28, z: lanes[lane], dir, v: (type === 'auto' ? 2.6 : 3.6) + rnd() * 2.2, bob: rnd() * 6 });
    mesh.setColorAt(i, tmpCol.set(vcol[(vehicles.length * 3) % vcol.length]));
  };
  for (let i = 0; i < nAuto; i++) addVeh(autos, i, 'auto');
  for (let i = 0; i < nBike; i++) addVeh(bikes, i, 'bike');
  for (const m of [autos, bikes]) {
    m.frustumCulled = false;
    root.add(m);
  }
  // head / tail lights at night
  const lightsGeo = T(new BufferGeometry());
  lightsGeo.setAttribute('position', new Float32BufferAttribute(vehicles.length * 6, 3).setUsage(35048));
  lightsGeo.setAttribute('color', new Float32BufferAttribute(vehicles.length * 6, 3));
  const lpos = lightsGeo.attributes.position.array;
  const lcol = lightsGeo.attributes.color.array;
  for (let i = 0; i < vehicles.length; i++) {
    lcol.set([1, 0.95, 0.7], i * 6);
    lcol.set([1, 0.15, 0.1], i * 6 + 3);
  }
  const vLightsM = T(new PointsMaterial({ map: lampGlowTex, size: 1.5, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0, fog: false }));
  const vLights = new Points(lightsGeo, vLightsM);
  vLights.frustumCulled = false;
  root.add(vLights);

  // --- per-frame ------------------------------------------------------------------------------------------------------------------------------------
  const dummy = new Object3D();
  const m4 = new Matrix4();
  void m4;
  let hourNow = 12;
  let nightNow = 0;
  function update(dt, t) {
    // walkers
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i];
      w.x += w.v * dt;
      if (w.x > 14) w.x = -14;
      if (w.x < -14) w.x = 14;
      const bob = Math.abs(Math.sin(t * 6 * Math.abs(w.v) + w.ph)) * 0.035;
      dummy.rotation.set(0, w.v > 0 ? Math.PI / 2 : -Math.PI / 2, Math.sin(t * 6 * Math.abs(w.v) + w.ph) * 0.03);
      dummy.scale.setScalar(0.95);
      dummy.position.set(w.x, bob, w.z);
      dummy.updateMatrix();
      bodyI.setMatrixAt(i, dummy.matrix);
      legsI.setMatrixAt(i, dummy.matrix);
    }
    bodyI.instanceMatrix.needsUpdate = true;
    legsI.instanceMatrix.needsUpdate = true;
    // vehicles (+ their lights)
    for (let n = 0; n < vehicles.length; n++) {
      const v = vehicles[n];
      v.x += v.dir * v.v * dt;
      if (v.x > 16) v.x = -16;
      if (v.x < -16) v.x = 16;
      dummy.rotation.set(0, v.dir > 0 ? 0 : Math.PI, Math.sin(t * 9 + v.bob) * 0.006);
      dummy.position.set(v.x, Math.sin(t * 11 + v.bob) * 0.012, v.z);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      v.mesh.setMatrixAt(v.i, dummy.matrix);
      const front = v.type === 'auto' ? 1.1 : 0.8;
      const back = v.type === 'auto' ? -1.05 : -0.8;
      lpos[n * 6] = v.x + v.dir * front;
      lpos[n * 6 + 1] = 0.82;
      lpos[n * 6 + 2] = v.z;
      lpos[n * 6 + 3] = v.x + v.dir * back;
      lpos[n * 6 + 4] = 0.8;
      lpos[n * 6 + 5] = v.z;
    }
    autos.instanceMatrix.needsUpdate = true;
    bikes.instanceMatrix.needsUpdate = true;
    lightsGeo.attributes.position.needsUpdate = true;
    for (const p of props) p.update(dt, t);
    // the cow ambles across at noon: its place is a pure function of the hour, so everyone sees the same cow
    const f = (hourNow - 11) / 5;
    const cow = cowP.group;
    if (f > 0 && f < 1) {
      cow.visible = true;
      cow.position.set(-13 + f * 26, Math.abs(Math.sin(t * 2.2)) * 0.015, 4.35 + Math.sin(f * 9) * 0.1);
    } else cow.visible = false;
  }

  const tmp = new Color();
  function setLight(L) {
    hourNow = L.hour;
    nightNow = L.night;
    const wet = clamp(L.wet, 0, 1);
    roadM.roughness = 0.95 - 0.55 * wet;
    roadM.metalness = 0.1 * wet;
    roadM.color.setRGB(1 - 0.25 * wet, 1 - 0.25 * wet, 1 - 0.2 * wet);
    puddleM.opacity = 0.14 + 0.38 * smoothstep(wet);
    tmp.setRGB(0, 0, 0);
    srgb(puddleM.color, L.mid).lerp(tmp.setRGB(1, 0.7, 0.4), 0.25 * L.night).multiplyScalar(0.6 + 0.35 * L.night);
    for (const m of lightMasks) m.emissiveIntensity = 0.55 * smoothstep((L.night - 0.25) / 0.6);
    lampGlowM.opacity = 0.85 * smoothstep((L.night - 0.15) / 0.5);
    vLightsM.opacity = 0.9 * smoothstep((L.night - 0.15) / 0.5);
    vehMat.emissive.setRGB(0, 0, 0);
  }

  shade(root, true, true);
  road.receiveShadow = true;
  void sph;

  function dispose() {
    scene.remove(root);
    for (const p of props) p.dispose();
    bodyI.dispose();
    legsI.dispose();
    autos.dispose();
    bikes.dispose();
    void Mesh;
    void MeshStandardMaterial;
    void nightNow;
  }

  return { root, update, setLight, dispose };
}
