// Soft-particle steam / smoke / sizzle: one THREE.Points per emitter, all motion in the vertex shader (zero per-frame CPU).
// Each particle ages from 0 to 1, rises, widens and fades; the sprite is a noisy soft disc.
import { BufferGeometry, Color, Float32BufferAttribute, Points, ShaderMaterial, Vector2 } from 'three';
import { GLSL_NOISE } from './glsl.js';
import { clock } from './patch.js';
import { quality } from '../pbr.js';

const _v = new Vector2();

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uRise, uSize, uSpeed, uRadius, uAmt, uPx, uDrift, uGrow;
varying float vA;
varying float vR;
void main(){
  float age = fract(uTime * uSpeed + aSeed.x);
  vec3 p = position;
  p.xz += (aSeed.yz - 0.5) * uRadius;
  p.y += age * uRise;
  float w = uTime * 0.8 + aSeed.w * 6.2832 + age * 2.5;
  p.x += sin(w) * uDrift * age;
  p.z += cos(w * 1.13) * uDrift * 0.7 * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float sz = uSize * (0.3 + uGrow * age) * (0.7 + 0.6 * aSeed.w);
  gl_PointSize = clamp(sz * uPx / max(0.05, -mv.z), 1.0, 150.0);
  vA = smoothstep(0.0, 0.18, age) * (1.0 - smoothstep(0.45, 1.0, age)) * uAmt;
  vR = aSeed.w;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uTime;
varying float vA;
varying float vR;
${GLSL_NOISE}
void main(){
  if (vA < 0.004) discard;
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float n = tc_fbm2(c * 3.5 + vR * 17.0 + uTime * 0.15);
  float a = smoothstep(1.0, 0.15, d) * (0.45 + 0.9 * n);
  a = clamp(a * vA * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(uColor, a);
}`;

/**
 * createSteam({ count, rise, size, speed, radius, drift, color, opacity, grow }) -> { points, setAmount(0..1), dispose }
 * `count` is scaled by the quality tier (particles). Position the Points object where the emitter sits.
 */
export function createSteam({ count = 10, rise = 0.35, size = 0.1, speed = 0.4, radius = 0.1, drift = 0.04, color = '#ffffff', opacity = 0.35, grow = 1.4, seed = 1 } = {}) {
  const n = Math.max(2, Math.round(count * quality().particles));
  const g = new BufferGeometry();
  const pos = new Float32Array(n * 3);
  const sd = new Float32Array(n * 4);
  let s = (seed * 9301 + 49297) % 233280;
  const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < n; i++) {
    sd[i * 4] = i / n + r() * 0.05;
    sd[i * 4 + 1] = r();
    sd[i * 4 + 2] = r();
    sd[i * 4 + 3] = r();
  }
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new Float32BufferAttribute(sd, 4));
  const mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: clock.uTime,
      uRise: { value: rise },
      uSize: { value: size },
      uSpeed: { value: speed },
      uRadius: { value: radius },
      uAmt: { value: 0 },
      uPx: { value: 600 },
      uDrift: { value: drift },
      uGrow: { value: grow },
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const points = new Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  points.visible = false;
  points.onBeforeRender = (renderer, scene, camera) => {
    const h = renderer.getDrawingBufferSize(_v).y;
    mat.uniforms.uPx.value = (camera.projectionMatrix.elements[5] * h) / 2;
  };
  return {
    points,
    setAmount(a) {
      mat.uniforms.uAmt.value = a;
      points.visible = a > 0.005;
    },
    dispose() {
      g.dispose();
      mat.dispose();
      points.removeFromParent();
    },
  };
}
