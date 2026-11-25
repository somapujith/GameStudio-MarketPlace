// Hot frying oil: glossy amber surface with drifting ripples, rising bubbles that bloom and pop, and foam rings around each item
// (three vec3 uniforms: local x, z, strength). Procedural normals via screen-space bump; no textures.
import { Color, MeshPhysicalMaterial, Vector3 } from 'three';
import { patchMaterial } from './patch.js';
import { quality, registerQuality } from '../pbr.js';

const FRAG_PARS = /* glsl */ `
uniform vec3 uSpot0, uSpot1, uSpot2;
uniform float uBoil, uR;
float tcFoam(vec3 s, vec2 p, out float h){
  float d = length(p - s.xy);
  vec3 w = tc_wor((p - s.xy) * 70.0 + uTime * 0.8);
  float cells = (1.0 - smoothstep(0.1, 0.42, w.x)) * step(0.35, w.z);
  float ring = (1.0 - smoothstep(0.045, 0.105, d)) * smoothstep(0.02, 0.05, d) * s.z;
  h += cells * ring * 0.6;
  return cells * ring;
}
`;

const FRAG_COLOR = /* glsl */ `
vec2 pp = vTcPos.xz;
float rr = length(pp) / uR;
float flowT = uTime * 0.35;
vec2 flow = vec2(sin(flowT + pp.y * 11.0), cos(flowT * 0.8 + pp.x * 9.0)) * 0.006;
float rip = tc_fbm((pp + flow) * 16.0 + vec2(flowT * 0.6, 0.0));
float rip2 = tc_fbm((pp - flow) * 38.0 - vec2(0.0, flowT));
vec3 wb = tc_wor(pp * 30.0 + vec2(0.0, uTime * 0.6));
float live = step(0.78 - 0.25 * uBoil, wb.z);
float phase = fract(uTime * (0.6 + 0.6 * uBoil) + wb.z * 11.0);
float br = 0.08 + 0.28 * phase;
float bubble = live * (smoothstep(br, br - 0.035, wb.x) - smoothstep(br - 0.035, br - 0.1, wb.x)) * (1.0 - smoothstep(0.85, 1.0, phase));
float hb = live * (1.0 - smoothstep(0.0, br, wb.x)) * (1.0 - phase) * 0.5;
float foamH = 0.0;
float foam = tcFoam(uSpot0, pp, foamH) + tcFoam(uSpot1, pp, foamH) + tcFoam(uSpot2, pp, foamH);
vec3 deep = tc_lin(vec3(0.24, 0.1, 0.01));
vec3 light = tc_lin(vec3(0.55, 0.3, 0.05));
vec3 c = mix(deep, light, 0.35 + 0.5 * rip);
c *= 1.0 - 0.55 * smoothstep(0.72, 1.0, rr);
c = mix(c, tc_lin(vec3(1.0, 0.86, 0.5)), clamp(bubble * 0.8, 0.0, 1.0));
c = mix(c, tc_lin(vec3(0.98, 0.9, 0.7)), clamp(foam * 0.9, 0.0, 1.0));
diffuseColor.rgb = c;
`;

const FRAG_ROUGH = /* glsl */ 'roughnessFactor = mix(0.05, 0.3, clamp(foam + bubble * 0.4, 0.0, 1.0));';
const FRAG_NORMAL = /* glsl */ `
#if TC_Q >= 1
  float hh = rip * 0.25 + rip2 * 0.08 + bubble * 0.7 + hb + foamH;
  normal = tc_bump(-vViewPosition, normal, vec2(dFdx(hh), dFdy(hh)) * 0.6, faceDirection);
#endif
`;

export function oilUniforms(R = 0.245) {
  return { uSpot0: { value: new Vector3() }, uSpot1: { value: new Vector3() }, uSpot2: { value: new Vector3() }, uBoil: { value: 0.6 }, uR: { value: R } };
}

export function createOilMaterial(uniforms = oilUniforms()) {
  const mat = new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.08, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.06, envMapIntensity: 0.9 });
  mat.defines = { TC_Q: quality().detail };
  patchMaterial(mat, { key: 'oil', uniforms, fragPars: FRAG_PARS, fragColor: FRAG_COLOR, fragRough: FRAG_ROUGH, fragNormal: FRAG_NORMAL });
  const off = registerQuality({
    apply(cfg) {
      if (mat.defines.TC_Q !== cfg.detail) {
        mat.defines.TC_Q = cfg.detail;
        mat.needsUpdate = true;
      }
    },
  });
  return { mat, uniforms, dispose() { off(); mat.dispose(); } };
}

export { Color };
