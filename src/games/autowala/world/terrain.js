// Ground, the lake (with a sparkling shader), Buddha's island, and the boulder hills that ring the map (Hyderabad sits on
// some of the oldest rock on Earth, so the skyline is full of round granite boulders).
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { WORLD } from '../game/config.js';
import { makeRng } from '../game/rng.js';
import { groundTexture } from '../render/textures.js';

/** renderOrder of the big flat opaque surfaces: after every building, before the sky dome (10000). */
export const LATE = 100;

const WATER_VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const WATER_FRAG = /* glsl */ `
  uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uDeep; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uTime; uniform float uNight;
  varying vec3 vWorld;
  #include <common>
  #include <fog_pars_fragment>
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float t = uTime * 0.6;
    vec2 p = vWorld.xz * 0.12;
    float w1 = vnoise(p + vec2(t, t * 0.7));
    float w2 = vnoise(p * 2.3 - vec2(t * 1.3, t * 0.4));
    vec3 N = normalize(vec3((w1 - 0.5) * 0.22 + (w2 - 0.5) * 0.12, 1.0, (w2 - 0.5) * 0.22 + (w1 - 0.5) * 0.12));
    float fres = min(0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0), 0.5);
    vec3 R = reflect(-V, N);
    vec3 sky = mix(uHor, uMid, smoothstep(0.0, 0.25, max(R.y, 0.0)));
    sky = mix(sky, uTop, smoothstep(0.2, 0.9, max(R.y, 0.0)));
    vec3 col = mix(uDeep, sky * 0.8, fres);
    float sp = pow(max(dot(R, normalize(uSunDir)), 0.0), 380.0);
    col += uSunCol * sp * 1.6;
    float spark = step(0.992, vnoise(vWorld.xz * 0.9 + t * 1.5)) * (0.2 + uNight * 0.4);
    col += vec3(1.0, 0.8, 0.9) * spark * 0.25;
    gl_FragColor = vec4(col, 0.96);
    #include <fog_fragment>
  }
`;

export function buildTerrain(scene, city, sky) {
  const H = WORLD.half;
  const group = new Group();
  group.name = 'terrain';
  scene.add(group);

  // ground: a big plane far past the ring road
  const gmat = new MeshLambertMaterial({ map: groundTexture(), color: 0xffe0c8 }); // roughness 1: Lambert is the same picture for a fraction of the ALU
  const ground = new Mesh(new PlaneGeometry(H * 4, H * 4), gmat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  // the big flat surfaces (ground, roads, pavements, shore) are drawn AFTER the buildings: the depth test then rejects the pixels they would
  // have shaded behind a wall (a PBR pixel with 5 lights is ~900 ALU ops, and the ground fills half the screen)
  ground.renderOrder = LATE;
  group.add(ground);

  // lake
  const L = city.lake;
  const uniforms = UniformsUtils.merge([UniformsLib.fog, {
    uTop: { value: sky.palette.top }, uMid: { value: sky.palette.mid }, uHor: { value: sky.palette.hor }, uDeep: { value: new Color('#0a6b86') },
    uSunDir: { value: sky.state.sunDir }, uSunCol: { value: sky.palette.sun }, uTime: { value: 0 }, uNight: { value: 0 },
  }]);
  // UniformsUtils.merge clones every value, so the four sky colours and the sun direction above were frozen copies of the palette's
  // initial white / zero (the water stayed pale as snow at night and never caught the sun): bind the live objects the sky updates in place
  uniforms.uTop.value = sky.palette.top;
  uniforms.uMid.value = sky.palette.mid;
  uniforms.uHor.value = sky.palette.hor;
  uniforms.uSunCol.value = sky.palette.sun;
  uniforms.uSunDir.value = sky.state.sunDir;
  const waterMat = new ShaderMaterial({ uniforms, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, fog: true, side: DoubleSide });
  const ellipse = makeEllipse(L.rx + 4, L.rz + 4, 72);
  const lake = new Mesh(ellipse, waterMat);
  lake.position.set(L.cx, 0.05, L.cz);
  group.add(lake);

  // lake shore: a darker rim so the water has an edge, plus Buddha's island
  const rim = new Mesh(makeEllipse(L.rx + 11, L.rz + 11, 72), new MeshLambertMaterial({ color: 0xc9a98f }));
  rim.position.set(L.cx, 0.02, L.cz);
  rim.renderOrder = LATE;
  group.add(rim);
  const island = new Mesh(new CylinderGeometry(22, 26, 1.2, 20), new MeshLambertMaterial({ color: 0xb59a86, flatShading: true }));
  island.position.set(L.cx + 8, 0.3, L.cz + 4);
  island.receiveShadow = true;
  group.add(island);

  // boulders: big round granite blocks outside the ring road and in a few spots inside
  const rng = makeRng(city.seed ^ 0x51ed);
  const rockGeo = new IcosahedronGeometry(1, 1);
  const pos = rockGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.85 + ((i * 13) % 7) * 0.04), pos.getY(i) * 0.7, pos.getZ(i) * (0.85 + ((i * 7) % 5) * 0.05));
  rockGeo.computeVertexNormals();
  const rocks = [];
  const place = (x, z, r) => rocks.push({ x, z, r });
  for (let i = 0; i < 260; i++) {
    const side = rng.int(0, 3);
    const along = rng.range(-H - 300, H + 300);
    const out = rng.range(H + 6, H + 420);
    const [x, z] = side === 0 ? [along, -out] : side === 1 ? [along, out] : side === 2 ? [-out, along] : [out, along];
    place(x, z, rng.range(5, out > H + 200 ? 38 : 20));
  }
  // clusters of boulder hills the player can see from the road
  for (const [cx, cz] of [[-310, -330], [330, -380], [-640, 120], [620, 120], [-380, 600], [420, 560]]) {
    for (let k = 0; k < 9; k++) place(cx + rng.range(-40, 40), cz + rng.range(-40, 40), rng.range(9, 28));
  }
  const rockMat = new MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const im = new InstancedMesh(rockGeo, rockMat, rocks.length);
  const o = new Object3D();
  const c = new Color();
  rocks.forEach((r, i) => {
    o.position.set(r.x, r.r * 0.32, r.z);
    o.scale.set(r.r * rng.range(1, 1.5), r.r * rng.range(0.7, 1.1), r.r * rng.range(1, 1.5));
    o.rotation.y = rng.range(0, 6.28);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
    im.setColorAt(i, c.set(rng.pick(['#b78e7b', '#a98273', '#c29a85', '#9d7a6e', '#bb8f7e'])));
  });
  im.castShadow = true;
  im.receiveShadow = true;
  im.instanceColor.needsUpdate = true;
  group.add(im);

  // far mountains: flat low-poly silhouettes at the horizon, tinted by the fog so they fade in the haze
  const far = new Group();
  const farMat = new MeshLambertMaterial({ color: 0x8a5a78, flatShading: true });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const d = rng.range(1150, 1500);
    const m = new Mesh(new IcosahedronGeometry(1, 0), farMat);
    m.position.set(Math.cos(a) * d, 20, Math.sin(a) * d);
    m.scale.set(rng.range(120, 260), rng.range(50, 130), rng.range(120, 260));
    far.add(m);
  }
  group.add(far);

  const tmp = new Vector3();
  function update(time, focus) {
    uniforms.uTime.value = time;
    uniforms.uNight.value = sky.state.night;
    ground.position.x = Math.round(focus.x / 64) * 64;
    ground.position.z = Math.round(focus.z / 64) * 64;
  }
  return { group, update, ground, lake, tmp };
}

/** A flat filled ellipse in the xz plane (y up), `seg` segments. */
function makeEllipse(rx, rz, seg) {
  const pos = [0, 0, 0];
  const norm = [0, 1, 0];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    pos.push(Math.cos(t) * rx, 0, Math.sin(t) * rz);
    norm.push(0, 1, 0);
  }
  for (let i = 1; i <= seg; i++) idx.push(0, i + 1, i);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(norm), 3));
  geo.setIndex(idx);
  return geo;
}
