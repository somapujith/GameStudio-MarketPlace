// Sky, sun, moon, stars, clouds, fog and the day/night palette. The look: Vice City dusk (hot pink and orange at the horizon,
// teal-violet overhead), a big soft sun, indigo-magenta nights. One call per frame: sky.update(hour, playerPos, dt).
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { clamp, lerp } from '../game/rng.js';
import { canvasTexture } from './textures.js';
import { snapToShadowGrid } from './shadow-grid.js';

const C = (hex) => new Color(hex);

// hour -> palette (top of sky, mid, horizon, sun colour, sun intensity, hemi sky, hemi ground, hemi intensity, fog density)
const KEYS = [
  { h: 0, top: '#050818', mid: '#0d1038', hor: '#2b1450', sun: '#8fa8ff', si: 0.75, hs: '#3a4a9a', hg: '#3a2a5c', hi: 1.0, fog: 0.0016, night: 1 },
  { h: 4.5, top: '#0a0f33', mid: '#2a1a5c', hor: '#7b2f79', sun: '#ffb0c8', si: 0.7, hs: '#4a4a9a', hg: '#3a2a5c', hi: 0.95, fog: 0.0016, night: 0.9 },
  { h: 6.2, top: '#2d5fb0', mid: '#e079a0', hor: '#ffb36b', sun: '#ffc08a', si: 2.2, hs: '#a8b4e8', hg: '#6a4a52', hi: 0.95, fog: 0.0013, night: 0.2 },
  { h: 8.5, top: '#1f86d8', mid: '#6cc4ee', hor: '#d8f0f4', sun: '#fff1d6', si: 3.6, hs: '#bfe4ff', hg: '#9a8068', hi: 1.15, fog: 0.00085, night: 0 },
  { h: 12.5, top: '#1a7fd0', mid: '#5db8ea', hor: '#cfeaf2', sun: '#ffffff', si: 4.0, hs: '#c8e8ff', hg: '#a08a6c', hi: 1.2, fog: 0.0008, night: 0 },
  { h: 16.2, top: '#2d84cf', mid: '#7cc0e2', hor: '#ffd8a8', sun: '#ffe2b0', si: 3.4, hs: '#c0dcff', hg: '#9a7a66', hi: 1.1, fog: 0.001, night: 0 },
  { h: 17.6, top: '#3d5fc8', mid: '#c46aa8', hor: '#ff9a5a', sun: '#ff9c58', si: 2.6, hs: '#d09ad8', hg: '#7a4a5a', hi: 0.95, fog: 0.0013, night: 0.08 },
  { h: 18.7, top: '#2a2a8a', mid: '#b83a96', hor: '#ff5f7e', sun: '#ff6a70', si: 1.5, hs: '#9a6ad0', hg: '#5a2a50', hi: 0.95, fog: 0.0015, night: 0.35 },
  { h: 19.6, top: '#120f48', mid: '#5a2a8a', hor: '#c8408a', sun: '#a080ff', si: 1.0, hs: '#6a5ac0', hg: '#42306a', hi: 0.95, fog: 0.0016, night: 0.8 },
  { h: 21, top: '#080a2a', mid: '#161050', hor: '#3a1a62', sun: '#8fa8ff', si: 0.75, hs: '#3a4a9a', hg: '#3a2a5c', hi: 1.0, fog: 0.0016, night: 1 },
  { h: 24, top: '#050818', mid: '#0d1038', hor: '#2b1450', sun: '#8fa8ff', si: 0.75, hs: '#3a4a9a', hg: '#3a2a5c', hi: 1.0, fog: 0.0016, night: 1 },
].map((k) => ({
  ...k,
  top: C(k.top), mid: C(k.mid), hor: C(k.hor), sun: C(k.sun), hs: C(k.hs), hg: C(k.hg),
}));

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // always at the far plane
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor;
  uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uNight; uniform float uTime;
  varying vec3 vDir;
  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.2, 1.0);
    float t1 = smoothstep(0.0, 0.32, h);
    float t2 = smoothstep(0.25, 0.95, h);
    vec3 col = mix(uHor, uMid, t1);
    col = mix(col, uTop, t2);
    if (d.y < 0.0) col = mix(uHor, uHor * 0.55, clamp(-d.y * 4.0, 0.0, 1.0));
    // sun disc + halo (warm, wide: the hero of the sky)
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    float disc = smoothstep(0.9987, 0.9994, sd);
    float halo = pow(sd, 18.0) * 0.4 + pow(sd, 220.0) * 0.45;
    col += uSunCol * (halo + disc * 1.8) * (1.0 - uNight * 0.35);
    // stars
    float st = step(0.9965, hash(floor(d * 260.0)));
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(d * 260.0)) * 40.0);
    col += vec3(1.0, 0.95, 0.9) * st * tw * uNight * smoothstep(0.02, 0.35, d.y);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSky(scene) {
  const palette = {
    top: new Color(), mid: new Color(), hor: new Color(), sun: new Color(), hs: new Color(), hg: new Color(),
  };

  const uniforms = {
    uTop: { value: palette.top },
    uMid: { value: palette.mid },
    uHor: { value: palette.hor },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunCol: { value: palette.sun },
    uNight: { value: 0 },
    uTime: { value: 0 },
  };
  const dome = new Mesh(
    new SphereGeometry(1000, 32, 20),
    new ShaderMaterial({ uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: BackSide, depthWrite: false, fog: false }),
  );
  // drawn LAST among the opaque objects (it sits at the far plane, depth-tested): the sky shader then only runs on the pixels nothing else
  // covers, instead of on every pixel of the screen before the city paints over most of them
  dome.renderOrder = 10000;
  dome.frustumCulled = false;
  scene.add(dome);

  scene.fog = new FogExp2(0xffffff, 0.001);
  const hemi = new HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);
  const key = new DirectionalLight(0xffffff, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  // the shadow box follows the player: +-85 m is ~0.08 m per texel at 2048 and covers the whole street the camera sees
  key.shadow.camera.left = -85;
  key.shadow.camera.right = 85;
  key.shadow.camera.top = 85;
  key.shadow.camera.bottom = -85;
  key.shadow.camera.near = 10;
  key.shadow.camera.far = 520;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.6;
  scene.add(key, key.target);

  // soft puffy clouds: a few additive sprites that catch the sunset colour
  const cloudTex = canvasTexture(128, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  // 26 clouds in ONE draw call: an instanced billboard whose position (angle, radius, height around the player) and size live in
  // per-instance attributes and whose drift is a single uniform. (They were 26 Sprites with 26 materials: ~13 draw calls in view.)
  const CLOUDS = 26;
  const cloudGeo = new InstancedBufferGeometry();
  cloudGeo.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  cloudGeo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  cloudGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const cloudData = new Float32Array(CLOUDS * 4); // angle, radius, height, width
  const cloudSize = new Float32Array(CLOUDS); // height of the quad
  for (let i = 0; i < CLOUDS; i++) {
    cloudData[i * 4] = (i / CLOUDS) * Math.PI * 2 + Math.sin(i * 7.1) * 0.3;
    cloudData[i * 4 + 1] = 520 + (i % 5) * 70;
    cloudData[i * 4 + 2] = 120 + (i % 7) * 26;
    cloudData[i * 4 + 3] = 320 + (i % 4) * 90;
    cloudSize[i] = 70 + (i % 3) * 26;
  }
  cloudGeo.setAttribute('aCloud', new InstancedBufferAttribute(cloudData, 4));
  cloudGeo.setAttribute('aHeight', new InstancedBufferAttribute(cloudSize, 1));
  cloudGeo.instanceCount = CLOUDS;
  const cloudUniforms = { map: { value: cloudTex }, uColor: { value: new Color(1, 1, 1) }, uOpacity: { value: 0.55 }, uDrift: { value: 0 }, uFocus: { value: new Vector3() } };
  const cloudMat = new ShaderMaterial({
    uniforms: cloudUniforms,
    transparent: true,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      attribute vec4 aCloud; attribute float aHeight;
      uniform float uDrift; uniform vec3 uFocus;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        float a = aCloud.x + uDrift;
        vec3 c = vec3(uFocus.x + cos(a) * aCloud.y, aCloud.z, uFocus.z + sin(a) * aCloud.y);
        vec4 mv = viewMatrix * vec4(c, 1.0);
        mv.xy += position.xy * vec2(aCloud.w, aHeight);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform vec3 uColor; uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(map, vUv);
        gl_FragColor = vec4(uColor * t.rgb, t.a * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const cloudMesh = new Mesh(cloudGeo, cloudMat);
  cloudMesh.frustumCulled = false;
  cloudMesh.renderOrder = -9;
  scene.add(cloudMesh);
  let cloudAngle = 0;

  // sun/moon glow sprite (bloom feeds on it)
  const glowTex = canvasTexture(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.2, 'rgba(255,230,190,0.5)');
    gr.addColorStop(1, 'rgba(255,200,150,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  const sunGlow = new Sprite(new SpriteMaterial({ map: glowTex, blending: AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  sunGlow.scale.set(380, 380, 1);
  sunGlow.renderOrder = -8;
  scene.add(sunGlow);

  const sunDir = new Vector3();
  const state = { hour: 17.4, night: 0, sunDir, fogColor: new Color(), uNight: { value: 0 } };

  function sample(hour) {
    let a = KEYS[0];
    let b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (hour >= KEYS[i].h && hour <= KEYS[i + 1].h) {
        a = KEYS[i];
        b = KEYS[i + 1];
        break;
      }
    }
    const t = b.h === a.h ? 0 : (hour - a.h) / (b.h - a.h);
    palette.top.copy(a.top).lerp(b.top, t);
    palette.mid.copy(a.mid).lerp(b.mid, t);
    palette.hor.copy(a.hor).lerp(b.hor, t);
    palette.sun.copy(a.sun).lerp(b.sun, t);
    palette.hs.copy(a.hs).lerp(b.hs, t);
    palette.hg.copy(a.hg).lerp(b.hg, t);
    return { si: lerp(a.si, b.si, t), hi: lerp(a.hi, b.hi, t), fog: lerp(a.fog, b.fog, t), night: lerp(a.night, b.night, t) };
  }

  const shadowFocus = new Vector3();

  function update(hour, focus, dt, time = 0, weather = 0) {
    const h = ((hour % 24) + 24) % 24;
    const s = sample(h);
    state.hour = h;
    state.night = s.night;
    state.uNight.value = s.night;
    uniforms.uNight.value = s.night;
    uniforms.uTime.value = time;

    // sun rides an arc east -> west; after sunset the moon takes the same light slot from the opposite side
    const dayT = clamp((h - 6) / 12, -0.3, 1.3); // 0 sunrise .. 1 sunset
    const elev = Math.sin(dayT * Math.PI) * 1.15; // radians
    const az = lerp(-1.2, 1.2, clamp(dayT, 0, 1)) + 0.3;
    const sunUp = dayT > -0.02 && dayT < 1.02;
    if (sunUp) {
      sunDir.set(Math.sin(az) * Math.cos(Math.max(elev, 0.04)), Math.max(Math.sin(Math.max(elev, 0.04)), 0.04), -Math.cos(az) * Math.cos(Math.max(elev, 0.04)));
    } else {
      sunDir.set(-Math.sin(az + 0.8) * 0.7, 0.62, Math.cos(az) * 0.7).normalize();
    }
    uniforms.uSunDir.value.copy(sunDir);

    // lights
    const rain = 1 - weather * 0.45;
    key.color.copy(palette.sun);
    key.intensity = s.si * rain;
    hemi.color.copy(palette.hs);
    hemi.groundColor.copy(palette.hg);
    hemi.intensity = s.hi * (1 - weather * 0.25);
    // the shadow box is centred on the player, snapped to the shadow map's texel grid so a static edge keeps the same texels from one
    // re-render to the next (no crawling), which is what lets the renderer refresh the map on a schedule instead of every frame
    snapToShadowGrid(focus, sunDir, (key.shadow.camera.right - key.shadow.camera.left) / key.shadow.mapSize.x, shadowFocus);
    key.position.copy(shadowFocus).addScaledVector(sunDir, 260);
    key.target.position.copy(shadowFocus);
    key.target.updateMatrixWorld();

    // fog = horizon colour, thicker in rain
    state.fogColor.copy(palette.hor).lerp(palette.mid, 0.18);
    scene.fog.color.copy(state.fogColor);
    scene.fog.density = s.fog * (1 + weather * 1.6);

    dome.position.copy(focus);
    sunGlow.position.copy(focus).addScaledVector(sunDir, 900);
    sunGlow.material.opacity = sunUp ? clamp(1.1 - Math.abs(sunDir.y) * 0.9, 0.2, 0.6) * (1 - weather * 0.7) : 0.1;
    sunGlow.material.color.copy(palette.sun);

    cloudAngle += dt * 0.004;
    cloudUniforms.uDrift.value = cloudAngle;
    cloudUniforms.uFocus.value.copy(focus);
    // clouds pick up the horizon colour (sunset-lit undersides)
    cloudUniforms.uColor.value.copy(palette.hor).lerp(palette.hs, 0.35).multiplyScalar(0.5 + (1 - s.night) * 0.7);
    cloudUniforms.uOpacity.value = (0.4 + weather * 0.4) * (1 - s.night * 0.6);
    return state;
  }

  /** Quality switch: shadow-map size, and shadows on/off (off = no shadow pass at all). */
  function setShadows(size, on) {
    key.castShadow = !!on;
    if (on && key.shadow.mapSize.x !== size) {
      key.shadow.mapSize.set(size, size);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }
  }

  return { update, state, palette, key, hemi, setShadows };
}
