// The stall shell: a Hyderabadi roadside tiffin stall on a footpath. Wooden thela counter with a steel top, tin roof + bamboo, a flex
// banner, a hand-painted menu board, a tarpaulin back screen with a hazy Charminar backdrop, LPG cylinders, steel drums and batter
// buckets, stools and a bench, bare bulbs on a wire and a tube-light, a bin. The station props themselves come from the models.
import {
  Color, DoubleSide, InstancedMesh, Matrix4, Object3D, PointLight, Points, PointsMaterial, BufferGeometry, Float32BufferAttribute,
  Line, LineBasicMaterial, AdditiveBlending, Group, ShaderMaterial, Vector3, SRGBColorSpace, BoxGeometry, TorusGeometry, MeshBasicMaterial,
} from 'three';
import { LAYOUT, STATIONS, STATION_IDS } from '../../../../shared/tiffin-centre/catalog.js';
import { buildStationProp, buildStreetProp } from '../models/index.js';
import { createKit, sagLine, shade } from './kit.js';
import { tubeFlicker } from './lighting.js';

const srgb = (c, rgb, k = 1) => c.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k, SRGBColorSpace);

const MURAL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const MURAL_FRAG = /* glsl */ `
  uniform sampler2D uSil; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uInk;
  uniform float uHaze; uniform float uNight; uniform float uTime;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  void main() {
    float t = vUv.y;
    vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.5, t));
    col = mix(col, uTop, smoothstep(0.45, 1.0, t));
    vec2 sp = floor(vUv * vec2(120.0, 60.0));
    float star = step(0.985, hash(sp)) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(sp + 3.0) * 20.0));
    col += vec3(1.0, 0.95, 0.85) * star * uNight * smoothstep(0.35, 0.8, t);
    vec4 s = texture2D(uSil, vUv);
    vec3 ink = mix(uInk, uHor * 0.92, uHaze);
    float lit = step(0.55, s.r) * uNight;
    float a = s.a;
    col = mix(col, ink, a * (1.0 - 0.4 * uHaze));
    col += vec3(1.0, 0.75, 0.35) * lit * a * 1.4;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createStall({ scene, art, tr, quality, onPropCreated }) {
  const k = createKit(tr);
  const { T, std, basic, box, cyl, sph, plane, put } = k;
  const root = new Group();
  root.name = 'stall';
  scene.add(root);
  const tmpC = new Color();

  // --- materials -----------------------------------------------------------------------------------------------------------
  const steelTex = art.steel();
  const steelM = std('#d3dade', { map: steelTex, metalness: 0.55, roughness: 0.5 });
  const steelDark = std('#8e979c', { metalness: 0.7, roughness: 0.5 });
  const woodTex = art.wood('#946238');
  const woodM = std('#ffffff', { map: woodTex, roughness: 0.85 });
  const woodDark = std('#5d3b22', { roughness: 0.9 });
  const bamboo = std('#b9a24a', { roughness: 0.8 });
  const brickM = std('#a4533a', { roughness: 0.95 });
  const tinTex = art.tin();
  const tinM = std('#ffffff', { map: tinTex, metalness: 0.5, roughness: 0.55, side: DoubleSide });
  const tarpTex = art.tarp();
  const tarpM = std('#ffffff', { map: tarpTex, roughness: 0.8 });
  const redPlastic = std('#d0301f', { roughness: 0.55 });
  const lpgM = std('#d63a2a', { roughness: 0.4, metalness: 0.35 });
  const whitePlastic = std('#f1ece0', { roughness: 0.5 });
  const blueLid = std('#2a62c4', { roughness: 0.5 });
  const brassM = std('#c8962f', { metalness: 0.8, roughness: 0.35 });
  const greenBin = std('#2f8a4a', { roughness: 0.6 });
  const rubber = std('#1c1a1a', { roughness: 0.9 });

  // --- ground, footpath, kerb ------------------------------------------------------------------------------------------------
  const cementTex = art.cement();
  cementTex.repeat.set(14, 2);
  put(plane(30, 4.4), std('#ffffff', { map: cementTex, roughness: 0.95 }), 0, 0.002, -1.7, root).rotation.x = -Math.PI / 2;
  const footTex = art.footpath();
  footTex.repeat.set(11, 1);
  put(plane(30, 2.65), std('#ffffff', { map: footTex, roughness: 0.92 }), 0, 0.001, 1.62, root).rotation.x = -Math.PI / 2;
  // kerb
  put(box(30, 0.16, 0.28), std('#9d968a', { roughness: 0.9 }), 0, 0.08, 2.98, root);
  put(box(30, 0.03, 0.06), basic('#ffd34d'), 0, 0.17, 3.05, root); // yellow kerb paint
  // behind the stall: the backyard ground
  const backM = std('#6f655a', { roughness: 1 });
  put(plane(40, 14), backM, 0, -0.01, -11, root).rotation.x = -Math.PI / 2;

  // --- the thela counter -------------------------------------------------------------------------------------------------------
  const counter = new Group();
  root.add(counter);
  put(box(10.3, 0.86, 0.56), woodM, 0, 0.45, -0.04, counter);
  put(box(10.5, 0.06, 0.66), steelM, 0, 0.97, -0.02, counter); // steel top: front edge at z = 0.31
  put(box(10.5, 0.07, 0.04), steelDark, 0, 0.9, 0.3, counter); // front lip
  // plank seams on the front face
  for (let i = -4; i <= 4; i++) put(box(0.03, 0.8, 0.02), woodDark, i * 1.1, 0.46, 0.245, counter);
  // cart wheels with spokes, handles resting at the sides
  const wheelGeo = k.geo('wheel', () => {
    const parts = [];
    const ring = k.torus(0.5, 0.05, 8, 24).clone();
    ring.rotateY(Math.PI / 2);
    parts.push(ring);
    for (let i = 0; i < 6; i++) {
      const sp = new BoxGeometry(0.04, 0.96, 0.06);
      sp.rotateX((i * Math.PI) / 6);
      parts.push(sp);
    }
    const hub = k.cyl(0.09, 0.09, 0.16, 10).clone();
    hub.rotateZ(Math.PI / 2);
    parts.push(hub);
    return k.merge(parts);
  });
  for (const x of [-5.1, 5.1]) put(wheelGeo, woodDark, x, 0.5, -0.04, counter);
  for (const x of [-4.2, 4.2]) {
    const h = put(cyl(0.035, 0.035, 1.6, 8), bamboo, x, 0.34, -0.9, counter);
    h.rotation.x = Math.PI / 2 - 0.12;
  }
  // things on the counter: steel plates, the money box (gallaa), a newspaper basket, a steel jug
  const plates = new Group();
  for (let i = 0; i < 9; i++) put(cyl(0.2, 0.18, 0.025, 20), steelM, 0, 1.02 + i * 0.026, 0, plates);
  plates.position.set(-4.65, 0, 0.0);
  counter.add(plates);
  const basket = put(cyl(0.26, 0.19, 0.2, 14), std('#e8dcc0', { roughness: 0.95 }), 4.55, 1.11, -0.05, counter);
  basket.name = 'basket';
  put(cyl(0.08, 0.09, 0.28, 12), steelM, 4.0, 1.14, -0.1, counter);
  put(cyl(0.025, 0.025, 0.1, 8), steelM, 4.08, 1.2, -0.1, counter).rotation.z = Math.PI / 2;
  // a bell, for the feel
  put(cyl(0.05, 0.08, 0.06, 12), brassM, -3.45, 1.03, 0.18, counter);

  // --- the back: tarpaulin screen, hazy Charminar flex, posts, tin roof -------------------------------------------------------------
  const wallZ = -3.8;
  put(box(11.8, 1.25, 0.06), tarpM, 0, 0.63, wallZ, root);
  const murMat = T(new ShaderMaterial({
    uniforms: {
      uSil: { value: art.skyline() },
      uTop: { value: new Color() }, uMid: { value: new Color() }, uHor: { value: new Color() }, uInk: { value: new Color() },
      uHaze: { value: 0.4 }, uNight: { value: 0 }, uTime: { value: 0 },
    },
    vertexShader: MURAL_VERT,
    fragmentShader: MURAL_FRAG,
    toneMapped: true,
  }));
  put(plane(11.6, 4.2), murMat, 0, 3.3, wallZ + 0.01, root);
  // bamboo frame of the flex
  for (const x of [-5.85, 5.85]) put(cyl(0.05, 0.05, 4.4, 8), bamboo, x, 3.4, wallZ + 0.05, root);
  for (const y of [1.2, 5.4]) put(cyl(0.045, 0.045, 11.8, 8), bamboo, 0, y, wallZ + 0.05, root).rotation.z = Math.PI / 2;
  // front posts that hold the roof, bamboo
  for (const x of [-5.4, 5.4]) {
    put(cyl(0.055, 0.06, 3.45, 8), bamboo, x, 1.72, -3.05, root);
    put(cyl(0.05, 0.055, 2.9, 8), bamboo, x, 1.45, -1.7, root);
  }
  // tin roof, sloping towards the street, with a rolled tarpaulin lip and tied-down bricks
  const roof = put(plane(11.9, 1.06), tinM, 0, 3.63, -3.52, root);
  roof.rotation.x = -Math.PI / 2 + 0.34;
  put(box(11.9, 0.07, 0.07), woodDark, 0, 3.42, -3.04, root);
  for (const x of [-4.4, -1.6, 1.8, 4.6]) put(box(0.3, 0.1, 0.18), brickM, x, 3.72, -3.72, root);

  // flex banner hanging from the roof's front edge
  const bannerTex = art.banner();
  const bannerM = std('#ffffff', { map: bannerTex, roughness: 0.6, emissive: '#ffffff', emissiveMap: bannerTex, emissiveIntensity: 0 });
  const bannerMesh = put(plane(4.1, 0.9), bannerM, -0.85, 2.98, -3.0, root);
  bannerMesh.rotation.x = 0.1;
  for (const x of [-2.85, 1.15]) put(cyl(0.012, 0.012, 0.3, 4), steelDark, x, 3.3, -3.0, root);

  // menu board with prices, left of the banner, hung on the screen
  const menu = art.menuBoard();
  const menuM = std('#ffffff', { map: menu.tex, roughness: 0.8, emissive: '#ffffff', emissiveMap: menu.tex, emissiveIntensity: 0 });
  const menuMesh = put(plane(2.1, 1.64), menuM, -4.1, 2.35, wallZ + 0.1, root);
  menuMesh.rotation.x = -0.05;
  put(box(2.22, 0.06, 0.08), woodDark, -4.1, 3.2, wallZ + 0.1, root);

  // posters pasted on the screen's edge and a flex strip above the menu
  const pos = put(plane(0.9, 1.35), std('#ffffff', { map: art.poster(2), roughness: 0.8 }), 5.0, 2.35, wallZ + 0.1, root);
  pos.rotation.z = -0.04;

  // shelf with tiffin carriers and jars (right of the banner)
  const shelf = new Group();
  shelf.position.set(3.9, 0, wallZ + 0.3);
  root.add(shelf);
  put(box(2.5, 0.05, 0.36), woodDark, 0, 1.78, 0, shelf);
  put(box(2.5, 0.05, 0.36), woodDark, 0, 2.38, 0, shelf);
  const detail = quality.shelfDetail;
  const tiffin = new Group();
  for (let i = 0; i < 3; i++) put(cyl(0.12, 0.12, 0.12, 14), steelM, 0, 0.07 + i * 0.125, 0, tiffin);
  put(cyl(0.015, 0.015, 0.45, 6), steelDark, 0.14, 0.2, 0, tiffin);
  put(cyl(0.12, 0.1, 0.03, 14), steelM, 0, 0.42, 0, tiffin);
  const carriers = detail > 0.7 ? [-0.9, -0.45, 0.0, 0.45, 0.9] : [-0.7, 0.2, 0.9];
  carriers.forEach((x, i) => {
    const c = tiffin.clone();
    c.position.set(x, 1.8 + (i % 2 ? 0.6 : 0), 0);
    shelf.add(c);
  });
  const jarM = [std('#e8c24a', { roughness: 0.3, transparent: true, opacity: 0.9 }), std('#c8402a', { roughness: 0.3 }), std('#7aa83a', { roughness: 0.3 })];
  (detail > 0.7 ? [-0.7, -0.22, 0.3, 0.75] : [-0.5, 0.5]).forEach((x, i) => {
    put(cyl(0.09, 0.09, 0.2, 12), jarM[i % 3], x, 1.9 + (i % 2 ? 0 : 0.6), 0.02, shelf);
    put(cyl(0.095, 0.095, 0.04, 12), steelDark, x, 2.03 + (i % 2 ? 0 : 0.6), 0.02, shelf);
  });

  // --- kit around the cooks and on the footpath: the models' street props (LPG, steel drums, batter buckets, plates, stools, bench) --------
  const props = [];
  const prop = (id, x, y, z, ry = 0, opts) => {
    const p = buildStreetProp(id, opts);
    p.group.position.set(x, y, z);
    p.group.rotation.y = ry;
    shade(p.group);
    root.add(p.group);
    props.push(p);
    return p;
  };
  prop('lpg', -5.0, 0, -3.3);
  prop('lpg', -4.62, 0, -3.35, 0.6);
  prop('lpg', 4.7, 0, -3.4, 0.2);
  prop('tiffin-drum', -5.0, 0, -2.5);
  prop('tiffin-drum', -4.4, 0, -2.75, 0.5);
  prop('batter-bucket', 4.75, 0, -2.6);
  prop('batter-bucket', 5.05, 0, -2.2, 0.8);
  prop('batter-bucket', -5.05, 0, -1.6, 0.3);
  prop('plate-stack', 4.9, 0, -3.0);
  prop('money-box', -4.0, 1.0, -0.05);
  prop('stool', 5.5, 0, 1.5);
  prop('stool', 5.95, 0, 2.1, 0.7);
  prop('stool', 5.1, 0, 2.25, 1.4);
  prop('bench', -5.9, 0, 1.9, 0.3);

  // --- the bin ---------------------------------------------------------------------------------------------------------------------
  const bin = new Group();
  put(cyl(0.34, 0.27, 0.72, 16), greenBin, 0, 0.38, 0, bin);
  put(cyl(0.37, 0.37, 0.05, 16), greenBin, 0, 0.76, 0, bin);
  const binLid = new Group();
  put(cyl(0.33, 0.33, 0.04, 16), std('#256c3a', { roughness: 0.6 }), 0, 0.02, 0, binLid);
  put(cyl(0.05, 0.05, 0.05, 8), rubber, 0, 0.06, 0, binLid);
  binLid.position.set(0, 0.8, 0);
  bin.add(binLid);
  put(box(0.12, 0.2, 0.01), basic('#fff4dc'), 0, 0.4, 0.31, bin); // painted label strip
  bin.position.set(LAYOUT.bin.x, 0, LAYOUT.bin.z);
  root.add(bin);

  // --- spot marks on the footpath ----------------------------------------------------------------------------------------------------
  const spotM = std('#fff4dc', { transparent: true, opacity: 0.32, roughness: 1, depthWrite: false });
  const spotMarks = [];
  for (let i = 0; i < LAYOUT.spots; i++) {
    const m = put(k.geo('spot', () => new TorusGeometry(0.33, 0.022, 4, 28)), spotM, LAYOUT.spotX(i), 0.012, LAYOUT.spotZ, root);
    m.rotation.x = Math.PI / 2;
    spotMarks.push(m);
  }

  // --- lamps: bulbs on a wire, a hanging tube-light ------------------------------------------------------------------------------------------
  const BULBS = 13;
  const wireZ = -1.7;
  const wireY = 2.85;
  const wireMat = T(new LineBasicMaterial({ color: 0x151515 }));
  const wires = [];
  const bulbPos = [];
  const addWire = (a, b, sag) => {
    const pts = sagLine(a, b, sag, 24);
    const ln = new Line(k.lineGeo(pts), wireMat);
    root.add(ln);
    wires.push(ln);
    return pts;
  };
  const wirePts = addWire([-5.4, wireY, wireZ], [5.4, wireY, wireZ], 0.28);
  for (let i = 0; i < BULBS; i++) {
    const idx = Math.round(((i + 0.5) / BULBS) * 24);
    const p = wirePts[Math.min(24, idx)];
    bulbPos.push(p);
  }
  // second, shorter wire over the counter end
  const wire2 = addWire([-5.4, 2.6, -0.6], [-2.2, 2.7, -0.6], 0.12);
  bulbPos.push(wire2[6], wire2[12], wire2[18]);
  const bulbMat = T(new MeshBasicMaterial({ color: 0xffd890 }));
  const bulbs = new InstancedMesh(sph(0.065, 10, 8), bulbMat, bulbPos.length);
  const m4 = new Matrix4();
  bulbPos.forEach((p, i) => {
    m4.makeTranslation(p[0], p[1] - 0.1, p[2]);
    bulbs.setMatrixAt(i, m4);
    put(cyl(0.02, 0.02, 0.08, 6), rubber, p[0], p[1] - 0.04, p[2], root);
  });
  bulbs.frustumCulled = false;
  root.add(bulbs);
  const glowTex = art.softDot();
  const glowGeo = T(new BufferGeometry());
  glowGeo.setAttribute('position', new Float32BufferAttribute(bulbPos.flatMap((p) => [p[0], p[1] - 0.1, p[2]]), 3));
  const glowMat = T(new PointsMaterial({ map: glowTex, size: 0.95, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffb35a, opacity: 0, fog: false }));
  const glow = new Points(glowGeo, glowMat);
  glow.frustumCulled = false;
  root.add(glow);

  // the tube-light hangs from the roof beam on two short chains
  const tube = new Group();
  const tubeBodyM = std('#e9eef0', { roughness: 0.4, emissive: '#cfe8ff', emissiveIntensity: 0 });
  put(cyl(0.035, 0.035, 1.25, 10), tubeBodyM, 0, 0, 0, tube).rotation.z = Math.PI / 2;
  put(box(1.3, 0.04, 0.12), steelDark, 0, 0.05, 0, tube);
  for (const s of [-0.5, 0.5]) put(cyl(0.006, 0.006, 0.35, 4), steelDark, s, 0.22, 0, tube);
  tube.position.set(2.7, 3.05, -2.3);
  root.add(tube);
  const tubeGlowMat = T(new PointsMaterial({ map: glowTex, size: 2.4, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xcfe6ff, opacity: 0, fog: false }));
  const tubeGlowGeo = T(new BufferGeometry());
  tubeGlowGeo.setAttribute('position', new Float32BufferAttribute([2.7, 3.0, -2.3, 2.3, 3.0, -2.3, 3.1, 3.0, -2.3], 3));
  const tubeGlow = new Points(tubeGlowGeo, tubeGlowMat);
  tubeGlow.frustumCulled = false;
  root.add(tubeGlow);

  // real lights: warm bulbs over the cooks and the cold tube (not on 'low')
  const lights = [];
  if (quality.lights) {
    for (const [x, z, c] of [[-2.4, -1.5, 0xffb055], [2.4, -1.5, 0xffb055]]) {
      const l = new PointLight(c, 0, 9, 2);
      l.position.set(x, 2.6, z);
      root.add(l);
      lights.push({ l, base: 14, kind: 'bulb' });
    }
    const tl = new PointLight(0xcfe6ff, 0, 8, 2);
    tl.position.set(2.7, 2.9, -2.2);
    root.add(tl);
    lights.push({ l: tl, base: 11, kind: 'tube' });
  }

  // --- stations ---------------------------------------------------------------------------------------------------------------------------
  const stationsGroup = new Group();
  root.add(stationsGroup);
  /** stationId -> { id, kind, group, prop|null, slotAnchors } */
  const stations = new Map();
  let stationKey = '';
  const emptyStand = (st) => {
    const g = new Group();
    put(box(1.25, 0.7, 0.75), brickM, 0, 0.35, 0, g);
    put(box(1.35, 0.06, 0.85), steelM, 0, 0.73, 0, g);
    put(cyl(0.2, 0.2, 0.18, 14), std('#3a3a3a', { roughness: 0.8 }), 0.2, 0.85, 0, g); // a cold clay chulha
    put(box(0.5, 0.02, 0.4), std('#e8dcc0', { roughness: 1 }), -0.3, 0.77, 0.05, g); // folded cloth
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
    }
    stations.clear();
    for (const id of STATION_IDS) {
      const st = STATIONS[id];
      if (ids.includes(id)) {
        const prop = buildStationProp(st.kind);
        prop.group.position.set(st.x, 0, st.z);
        shade(prop.group);
        stationsGroup.add(prop.group);
        stations.set(id, { id, kind: st.kind, group: prop.group, prop, anchors: prop.slotAnchors || [] });
        onPropCreated?.(id, prop);
      } else {
        const g = emptyStand(st);
        shade(g);
        stationsGroup.add(g);
        stations.set(id, { id, kind: st.kind, group: g, prop: null, anchors: [] });
      }
    }
  }

  function setSpots(n) {
    spotMarks.forEach((m, i) => { m.visible = i < n; });
  }

  // --- per-frame light response ----------------------------------------------------------------------------------------------------------
  const cBulb = new Color();
  const dummy = new Object3D();
  let binHop = 0;
  function setLight(L, t) {
    const flick = tubeFlicker(t, L.tube);
    // bulbs
    cBulb.setRGB(1, 0.78, 0.42, SRGBColorSpace).multiplyScalar(0.18 + 2.2 * L.bulb);
    bulbMat.color.copy(cBulb);
    glowMat.opacity = 0.85 * L.bulb;
    tubeBodyM.emissiveIntensity = 1.8 * flick;
    tubeGlowMat.opacity = 0.7 * flick;
    bannerM.emissiveIntensity = 0.35 * L.neon;
    menuM.emissiveIntensity = 0.28 * L.neon;
    for (const lt of lights) lt.l.intensity = lt.kind === 'tube' ? lt.base * flick : lt.base * L.bulb;
    // the Charminar flex
    const u = murMat.uniforms;
    srgb(u.uTop.value, L.top);
    srgb(u.uMid.value, L.mid);
    srgb(u.uHor.value, L.hor);
    tmpC.setRGB(0.2, 0.13, 0.2, SRGBColorSpace).multiplyScalar(1 - 0.7 * L.night);
    u.uInk.value.copy(tmpC);
    u.uHaze.value = L.haze;
    u.uNight.value = L.night;
    u.uTime.value = t;
  }

  function update(dt, t) {
    for (const s of stations.values()) s.prop?.update?.(dt, t);
    for (const p of props) p.update?.(dt, t);
    // bulbs sway a little in the street breeze
    bulbs.rotation.z = Math.sin(t * 0.9) * 0.004;
    if (binHop > 0) {
      binHop = Math.max(0, binHop - dt * 4);
      binLid.position.y = 0.8 + Math.sin(binHop * Math.PI) * 0.12;
      binLid.rotation.x = -Math.sin(binHop * Math.PI) * 0.4;
    }
  }

  /** World position of slot i of a station (anchor in the prop's local space + the prop's place). */
  function slotWorld(stationId, i, out) {
    const s = stations.get(stationId);
    if (!s) return null;
    const a = s.anchors[i];
    if (a) out.copy(a).add(s.group.position);
    else out.set(s.group.position.x - 0.4 + i * 0.4, 1.1, s.group.position.z);
    return out;
  }

  function dispose() {
    for (const s of stations.values()) s.prop?.dispose?.();
    for (const p of props) p.dispose?.();
    stations.clear();
    scene.remove(root);
  }

  return {
    root, stations, binPos: new Vector3(LAYOUT.bin.x, 0, LAYOUT.bin.z), setStations, setSpots, setMenu: (m) => menu.set(m), setLight, update, slotWorld,
    bumpBin: () => { binHop = 1; }, redrawText: () => { bannerTex.userData.redraw(); menu.tex.userData.redraw(); }, murMat,
    counterY: 0.97, dispose,
  };
}
