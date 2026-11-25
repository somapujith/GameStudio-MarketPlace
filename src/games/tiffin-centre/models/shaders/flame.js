// Procedural gas / wood flame: additive tongues driven by noise in the fragment shader, plus a soft glow disc.
// Geometry is an open cylinder (ring of jets seen from outside) or a flat strip; uv.y = 0 at the burner, 1 at the tip.
import { AdditiveBlending, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, ShaderMaterial } from 'three';
import { GLSL_NOISE } from './glsl.js';
import { clock } from './patch.js';

const VERT = /* glsl */ `
varying vec2 vUv;
uniform float uTime, uSeed, uPower;
void main(){
  vUv = uv;
  vec3 p = position;
  float a = atan(p.z, p.x);
  float flick = 0.9 + 0.2 * sin(uTime * 17.0 + a * 7.0 + uSeed) + 0.1 * sin(uTime * 31.0 + a * 13.0);
  p.y *= flick * uPower;
  p.xz *= 1.0 + 0.06 * uv.y * sin(uTime * 9.0 + a * 5.0 + uSeed);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime, uSeed, uJets, uOrange, uAlpha;
uniform vec3 uBlue, uTip;
${GLSL_NOISE}
void main(){
  float y = vUv.y;
  float cell = vUv.x * uJets;
  float cx = fract(cell) - 0.5;
  float id = floor(cell);
  float fl = tc_vn(vec2(id * 3.1 + uSeed, uTime * 9.0 - y * 4.0));
  float h = mix(0.55, 1.0, tc_h11(id + uSeed));
  float yy = y / h;
  float width = mix(0.5, 0.04, pow(clamp(yy, 0.0, 1.0), 0.8)) * (0.75 + 0.5 * fl);
  float tongue = smoothstep(width, width * 0.2, abs(cx)) * smoothstep(1.05, 0.55, yy);
  float core = smoothstep(width * 0.55, 0.0, abs(cx)) * smoothstep(0.7, 0.0, yy);
  vec3 blue = uBlue * (0.6 + 1.6 * core);
  vec3 tip = uTip * smoothstep(0.35, 0.95, yy) * (0.6 + fl);
  vec3 col = mix(blue, tip * 2.0 + blue * 0.3, uOrange * smoothstep(0.0, 0.8, yy));
  col = mix(col, uTip * (1.0 + 2.0 * core), uOrange * 0.55);
  float a = tongue * (0.45 + 0.55 * fl) * uAlpha * smoothstep(0.0, 0.06, y);
  gl_FragColor = vec4(col * a, a);
}`;

export function createFlameMaterial({ orange = 0, jets = 24, seed = 0, alpha = 1 } = {}) {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: clock.uTime,
      uSeed: { value: seed },
      uJets: { value: jets },
      uOrange: { value: orange },
      uAlpha: { value: alpha },
      uPower: { value: 1 },
      uBlue: { value: new Color(0.1, 0.32, 1.0) },
      uTip: { value: new Color(1.0, 0.45, 0.08) },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
}

function strip(posFn, seg) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= 2; j++) {
    for (let i = 0; i <= seg; i++) {
      pos.push(...posFn(i / seg, j / 2));
      uv.push(i / seg, j / 2);
    }
  }
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      idx.push(a, a + seg + 1, a + 1, a + 1, a + seg + 1, a + seg + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Open cylinder wall from y=0 to y=h, `seg` around (the flame ring of a burner). */
export function flameRingGeometry(r, h, seg = 36) {
  return strip((u, v) => [Math.cos(u * Math.PI * 2) * r, v * h, Math.sin(u * Math.PI * 2) * r], seg);
}

/** A flat vertical strip (width w, height h, centred on x): fire seen from the front. */
export function flameStripGeometry(w, h, seg = 12) {
  return strip((u, v) => [(u - 0.5) * w, v * h, 0], seg);
}

/** Additive radial glow (a quad with a gaussian falloff, flickering). */
export function createGlowMaterial(color = '#ff8a2a', intensity = 1) {
  return new ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform vec3 uC; uniform float uI, uTime, uSeed;
      void main(){ vec2 d = (vUv - 0.5) * 2.0; float g = exp(-dot(d, d) * 3.2) * uI * (0.85 + 0.15 * sin(uTime * 13.0 + uSeed) + 0.08 * sin(uTime * 29.0)); gl_FragColor = vec4(uC * g, g); }`,
    uniforms: { uC: { value: new Color(color) }, uI: { value: intensity }, uTime: clock.uTime, uSeed: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    side: DoubleSide,
  });
}
