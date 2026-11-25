// Rain: ONE mesh of a few hundred thin quad streaks (a hairline is invisible, a 1 px GL line even more) falling inside a box around the camera. All motion is in the vertex shader (a
// uniform clock and the camera position), so the CPU does nothing per frame but write six uniforms. Streaks are world-anchored and
// wrap around the camera, so driving through rain looks right. Quality only changes how many are drawn (drawRange).
// Also owns the lightning light: one AmbientLight that is dark except for a flash.
import { AmbientLight, BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial, Vector2, Vector3 } from 'three';
import { makeRng } from '../game/rng.js';

/** Streaks drawn per quality tier. */
export const RAIN_STREAKS = { low: 340, medium: 640, high: 900 };
const MAX = RAIN_STREAKS.high;
const BOX = new Vector3(26, 18, 26);

const VERT = /* glsl */ `
  attribute float aEnd;
  attribute float aSide;
  attribute float aRnd;
  uniform vec3 uCam; uniform vec3 uBox; uniform float uTime; uniform float uInt;
  uniform float uFall; uniform vec2 uWind; uniform float uLen; uniform float uWidth;
  varying float vA;
  void main() {
    vec3 vel = vec3(uWind.x, -uFall * (0.82 + 0.36 * aRnd), uWind.y);
    vec3 p = position * uBox + vel * uTime;
    float y = mod(p.y, uBox.y);
    vec2 rel = mod(p.xz - uCam.xz, uBox.xz) - uBox.xz * 0.5;
    vec3 w = vec3(uCam.x + rel.x, y, uCam.z + rel.y);
    w -= normalize(vel) * uLen * aEnd; // the tail of the streak trails up-wind
    float fade = 1.0 - smoothstep(0.3, 0.5, length(rel) / uBox.x);
    fade *= smoothstep(0.0, 1.0, y); // dies at the ground instead of cutting off
    vA = fade * mix(1.0, 0.15, aEnd);
    vec4 mv = viewMatrix * vec4(w, 1.0);
    vA *= smoothstep(1.2, 4.0, length(mv.xyz)); // no giant streaks right in front of the lens
    mv.x += aSide * uWidth * (0.6 + 0.8 * aRnd);
    gl_Position = projectionMatrix * mv;
    if (aRnd > uInt) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // this streak is not raining yet (clipped)
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uAlpha;
  varying float vA;
  void main() { gl_FragColor = vec4(uColor, vA * uAlpha); }
`;

export function createRain(scene) {
  const rng = makeRng(0x4a17);
  const V = MAX * 4;
  const pos = new Float32Array(V * 3);
  const end = new Float32Array(V);
  const side = new Float32Array(V);
  const rnd = new Float32Array(V);
  const index = new Uint16Array(MAX * 6);
  for (let i = 0; i < MAX; i++) {
    const x = rng();
    const y = rng();
    const z = rng();
    const r = (i + rng()) / MAX; // spread over 0..1 so `uInt` thins the rain evenly
    for (let k = 0; k < 4; k++) {
      const vi = i * 4 + k;
      pos.set([x, y, z], vi * 3);
      end[vi] = k >> 1; // 0,0,1,1: head, head, tail, tail
      side[vi] = k & 1 ? 1 : -1;
      rnd[vi] = r;
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new BufferAttribute(end, 1));
  geo.setAttribute('aSide', new BufferAttribute(side, 1));
  geo.setAttribute('aRnd', new BufferAttribute(rnd, 1));
  geo.setIndex(new BufferAttribute(index, 1));
  const uniforms = {
    uCam: { value: new Vector3() }, uBox: { value: BOX }, uTime: { value: 0 }, uInt: { value: 0 }, uFall: { value: 17 },
    uWind: { value: new Vector2(2.2, 0.6) }, uLen: { value: 1.4 }, uWidth: { value: 0.017 }, uColor: { value: new Color(0.75, 0.82, 0.92) }, uAlpha: { value: 0.5 },
  };
  const mat = new ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false, side: 2 });
  const lines = new Mesh(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 6;
  lines.visible = true; // visible until the first update, so the shader compiles with the rest of the scene
  geo.setDrawRange(0, 6);
  scene.add(lines);

  // lightning: an ambient light, dark except while a flash lasts (added now, so the light count never changes at run time)
  const flash = new AmbientLight(0xaabfff, 0);
  scene.add(flash);

  let count = RAIN_STREAKS.medium;
  const day = new Color(0.72, 0.8, 0.92);
  const dusk = new Color(0.34, 0.4, 0.58);

  return {
    lines,
    flash,
    /** How many streaks may be drawn (quality). */
    setCount(n) {
      count = Math.max(0, Math.min(MAX, n | 0));
      geo.setDrawRange(0, count * 6);
    },
    /** Per frame. `intensity` 0..1, `night` 0..1, `hidden` hides them (menus, a debug cam far from the action). */
    update(time, camera, intensity, night, windPush = 0) {
      const on = intensity > 0.02;
      lines.visible = on;
      if (!on) return;
      uniforms.uTime.value = time;
      uniforms.uCam.value.copy(camera.position);
      uniforms.uInt.value = Math.min(1, intensity * 1.05);
      uniforms.uColor.value.copy(day).lerp(dusk, night);
      uniforms.uAlpha.value = 0.38 + 0.4 * intensity;
      uniforms.uWind.value.x = 1.4 + 2.4 * intensity + windPush;
      uniforms.uLen.value = 1.0 + 0.9 * intensity;
    },
    /** Lightning brightness 0..1. */
    setFlash(e) {
      flash.intensity = e * 5.5;
    },
    dispose() {
      scene.remove(lines, flash);
      geo.dispose();
      mat.dispose();
      flash.dispose?.();
    },
  };
}
