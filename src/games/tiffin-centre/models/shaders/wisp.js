// Steam wisps for finished dishes: two crossed vertical planes with a scrolling noise alpha (no particles, no per-instance state),
// so a cloned dish Group can share the material and geometry safely.
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, ShaderMaterial } from 'three';
import { GLSL_NOISE } from './glsl.js';
import { clock } from './patch.js';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime, uSeed, uAmt;
uniform vec3 uColor;
${GLSL_NOISE}
void main(){
  vec2 p = vec2(vUv.x * 2.0 - 1.0, vUv.y);
  float sway = sin(uTime * 0.9 + p.y * 5.0 + uSeed) * 0.22 * p.y;
  float n = tc_fbm(vec2((p.x + sway) * 2.6 + uSeed, p.y * 2.2 - uTime * 0.55));
  float body = smoothstep(0.62, 0.0, abs(p.x + sway * 0.6) * (0.9 + 0.8 * p.y));
  float a = body * smoothstep(0.38, 0.72, n) * smoothstep(0.0, 0.18, p.y) * (1.0 - smoothstep(0.55, 1.0, p.y)) * uAmt;
  gl_FragColor = vec4(uColor, a);
}`;

let geo = null;
function wispGeometry(w = 0.1, h = 0.17) {
  if (geo) return geo;
  const pos = [];
  const uv = [];
  const idx = [];
  for (const rot of [0, Math.PI / 2]) {
    const base = pos.length / 3;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const x = (u - 0.5) * w;
      pos.push(x * c, v * h, x * s);
      uv.push(u, v);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.userData.shared = true;
  return geo;
}

export function wispMaterial(seed = 0, amt = 0.35) {
  const m = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uTime: clock.uTime, uSeed: { value: seed }, uAmt: { value: amt }, uColor: { value: new Color('#ffffff') } },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  m.userData.shared = true;
  return m;
}

/** A wisp Mesh (shared geometry, material is the caller's shared one). */
export function wispMesh(mat, x = 0, y = 0, z = 0, w = 0.1, h = 0.17) {
  const m = new Mesh(wispGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.renderOrder = 4;
  return m;
}
export function disposeWisp() {
  geo?.dispose();
  geo = null;
}
