// The sky: one gradient dome shader (zenith / mid / horizon, a haze band, the sun disc and aureole, a moon, stars, drifting clouds, the dusty ground
// below the horizon). The same shader renders the visible background and, through PMREM, the image-based light that makes steel, tin and wet
// tarmac pick up the colour of the hour. Pure GLSL + uniforms; `setLook(L, t)` feeds it a lighting snapshot (lighting.js).
import {
  BackSide, Color, Mesh, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector3,
} from 'three';
import { clamp, smoothstep } from './interp.js';

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; uniform vec3 uGround;
  uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uMoon;
  uniform vec3 uCloudCol;
  uniform float uNight; uniform float uStars; uniform float uCover; uniform float uGlow; uniform float uTime; uniform float uSunVis; uniform float uHaze;
  uniform float uDisc;
  varying vec3 vDir;
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), f.x), mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), f.x), f.y);
  }
  #if CLOUD_OCT > 0
  float fbm(vec2 p) {
    float a = .5; float s = 0.;
    for (int i = 0; i < CLOUD_OCT; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17., 9.); a *= .5; }
    return s;
  }
  #endif
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    float yy = max(y, 0.0);
    vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.3, yy));
    col = mix(col, uTop, smoothstep(0.22, 0.85, yy));
    float mu = dot(d, uSun);
    // glow along the horizon in the sun's direction, and the aureole round the disc
    float az = pow(max(dot(normalize(d.xz + 1e-4), normalize(uSun.xz + 1e-4)), 0.0), 2.5);
    col += uSunCol * uGlow * (0.55 * az * exp(-yy * 6.0) + pow(max(mu, 0.), 5.0) * 0.28 + pow(max(mu, 0.), 40.) * 0.7);
    col = mix(col, uHor * 1.04, exp(-yy * 11.0) * 0.55 * uHaze);
    col = mix(col, uGround, smoothstep(0.0, -0.05, y));
    // sun disc (HDR, so bloom and the tone mapper do the glare) and the moon
    col += uSunCol * smoothstep(0.99962, 0.99988, mu) * 26.0 * uSunVis * uDisc * step(0.0, y);
    float mm = dot(d, uMoon);
    col += vec3(0.78, 0.86, 1.0) * (smoothstep(0.9992, 0.99955, mm) * 1.6 + pow(max(mm, 0.), 120.) * 0.25) * uNight * smoothstep(-0.02, 0.1, y) * uDisc;
    float cloudMask = 0.0;
    #if CLOUD_OCT > 0
    if (y > 0.012) {
      vec2 p = d.xz / (y + 0.14) * 1.25 + vec2(uTime * 0.0045, uTime * 0.0016);
      float n = fbm(p * 1.6);
      float e0 = 0.64 - uCover * 0.3;
      float c = smoothstep(e0, e0 + 0.2, n);
      float n2 = fbm(p * 1.6 + uSun.xz * 0.05);
      float lit = clamp(0.55 + (n - n2) * 4.0, 0.0, 1.0);
      vec3 cc = mix(uCloudCol * 0.5, uCloudCol * 1.15, lit);
      cc += uSunCol * pow(max(mu, 0.), 6.0) * 0.45 * (1.0 - c * 0.5);
      float fade = smoothstep(0.012, 0.22, y);
      cloudMask = c * fade;
      col = mix(col, cc, cloudMask * 0.92);
    }
    #endif
    #ifndef NO_STARS
    if (uStars > 0.01 && y > 0.0) {
      vec3 sp = d * 110.0;
      vec3 id = floor(sp);
      float h = hash13(id);
      vec3 fp = fract(sp) - 0.5;
      float star = step(0.972, h) * smoothstep(0.3, 0.0, length(fp)) * (0.65 + 0.35 * sin(uTime * 2.2 + h * 60.0));
      col += vec3(1.0, 0.94, 0.88) * star * uStars * (0.35 + h) * smoothstep(0.02, 0.3, y) * (1.0 - cloudMask);
    }
    #endif
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const srgb = (c, rgb, k = 1) => c.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k, SRGBColorSpace);

export function createSky({ clouds = 1, stars = true } = {}) {
  const uniforms = {
    uTop: { value: new Color() }, uMid: { value: new Color() }, uHor: { value: new Color() }, uGround: { value: new Color() },
    uSun: { value: new Vector3(0, 1, 0) }, uSunCol: { value: new Color() }, uMoon: { value: new Vector3(0, 1, 0) }, uCloudCol: { value: new Color() },
    uNight: { value: 0 }, uStars: { value: 0 }, uCover: { value: 0.3 }, uGlow: { value: 0.5 }, uTime: { value: 0 }, uSunVis: { value: 1 }, uHaze: { value: 0.5 },
    uDisc: { value: 1 },
  };
  const mk = (defines) => new ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, defines, side: BackSide, depthWrite: false, depthTest: false, fog: false });
  const material = mk({ CLOUD_OCT: clouds === 0 ? 0 : clouds === 1 ? 3 : 5, ...(stars ? {} : { NO_STARS: 1 }) });
  const envMaterial = mk({ CLOUD_OCT: 0, NO_STARS: 1 });
  const geo = new SphereGeometry(1, 40, 20);
  const mesh = new Mesh(geo, material);
  mesh.scale.setScalar(420);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.name = 'sky';

  const envScene = new Scene();
  const envMesh = new Mesh(geo, envMaterial);
  envMesh.scale.setScalar(50);
  envMesh.frustumCulled = false;
  envScene.add(envMesh);

  const tmp = new Color();
  let envDirty = true;
  let lastEnvHour = -99;
  let pmrem = null;
  let envRT = null;

  function setLook(L, t) {
    srgb(uniforms.uTop.value, L.top);
    srgb(uniforms.uMid.value, L.mid);
    srgb(uniforms.uHor.value, L.hor);
    // the ground under the horizon: street dust lit by the hour
    srgb(uniforms.uGround.value, L.hg, 1.0).lerp(tmp.copy(uniforms.uHor.value), 0.35);
    uniforms.uSun.value.set(L.sunTrue[0], L.sunTrue[1], L.sunTrue[2]);
    uniforms.uMoon.value.set(-L.sunTrue[0] * 0.6 + 0.2, 0.8, 0.35 - L.sunTrue[2] * 0.2).normalize();
    srgb(uniforms.uSunCol.value, L.sun);
    srgb(uniforms.uCloudCol.value, L.cloud, 1.0);
    uniforms.uNight.value = L.night;
    uniforms.uStars.value = L.stars;
    uniforms.uCover.value = L.cover;
    uniforms.uGlow.value = L.glow;
    uniforms.uHaze.value = L.haze;
    uniforms.uSunVis.value = smoothstep(clamp((L.sunEl + 1.5) / 5, 0, 1));
    uniforms.uTime.value = t || 0;
  }

  /** Re-render the image-based light when the sky has changed enough (or `force`); returns the env texture. */
  function updateEnv(renderer, hour, interval, size, force = false) {
    if (!pmrem) pmrem = new PMREMGenerator(renderer);
    const dh = Math.abs(hour - lastEnvHour);
    const changed = Math.min(dh, 24 - dh); // distance in hours
    if (!force && !envDirty && envRT && changed < interval) return envRT.texture;
    if (envRT) envRT.dispose();
    uniforms.uDisc.value = 0.12;
    envRT = pmrem.fromScene(envScene, 0.02, 0.1, 100, { size: size || 128 });
    uniforms.uDisc.value = 1;
    envDirty = false;
    lastEnvHour = hour;
    return envRT.texture;
  }

  return {
    mesh,
    material,
    uniforms,
    setLook,
    updateEnv,
    markEnvDirty() {
      envDirty = true;
    },
    /** Cloud octaves (0 none, 1 cheap, 2 rich) and stars follow the quality tier. */
    setTier(cloudLevel, withStars) {
      const oct = cloudLevel === 0 ? 0 : cloudLevel === 1 ? 3 : 5;
      if (material.defines.CLOUD_OCT === oct && !!material.defines.NO_STARS === !withStars) return;
      material.defines.CLOUD_OCT = oct;
      if (withStars) delete material.defines.NO_STARS;
      else material.defines.NO_STARS = 1;
      material.needsUpdate = true;
    },
    follow(camera) {
      mesh.position.copy(camera.position);
    },
    dispose() {
      geo.dispose();
      material.dispose();
      envMaterial.dispose();
      envRT?.dispose();
      pmrem?.dispose();
      envRT = null;
      pmrem = null;
    },
  };
}
