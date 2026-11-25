// Seasoned cast-iron tawa surface: black polymerised-oil patina, scorch rings, oil film puddles, burnt-on batter crust, lathe marks
// and scratches, all procedural in the fragment shader (no textures). Oil sheen under each dosa is driven by three vec3 uniforms
// (local x, z, strength). Also used (with different palette uniforms) for the kadai iron.
import { Color, MeshPhysicalMaterial, Vector3 } from 'three';
import { patchMaterial } from './patch.js';
import { quality, registerQuality } from '../pbr.js';

const FRAG_PARS = /* glsl */ `
uniform vec3 uSpot0, uSpot1, uSpot2;
uniform float uHeat, uSoot, uWorn, uGunk, uHot;
uniform vec3 uBase;
float tcSpot(vec3 s, vec2 p){ return s.z * (1.0 - smoothstep(0.09, 0.19, length(p - s.xy))); }
`;

const FRAG_COLOR = /* glsl */ `
vec2 pp = vTcPos.xz;
float rr = length(pp);
float tth = atan(pp.y, pp.x + 1e-5);
float topN = smoothstep(0.35, 0.8, vTcNrm.y);
float big = tc_fbm(pp * 5.0 + 3.0);
float mid = tc_fbm(pp * 17.0);
vec3 c = tc_lin(uBase) * (0.7 + 0.8 * big);
// seasoned bronze / brown tint in oiled zones
float seas = smoothstep(0.35, 0.7, tc_fbm(pp * 3.2 + 11.0));
c = mix(c, tc_lin(vec3(0.22, 0.13, 0.07)) * 0.5, seas * 0.85 * topN);
// concentric scorch rings from the flame
float ringN = tc_fbm(pp * 4.0 + 5.0);
float sc = sin(rr * 46.0 + ringN * 6.0) * 0.5 + 0.5;
float scorch = smoothstep(0.55, 0.95, sc) * smoothstep(0.42, 0.1, rr) * topN;
c = mix(c, tc_lin(vec3(0.3, 0.2, 0.14)) * 0.5, scorch * 0.5 * uHeat);
c = mix(c, tc_lin(vec3(0.16, 0.2, 0.28)) * 0.5, scorch * 0.18);
// lathe marks (circular) and scratches
float lathe = tc_vn(vec2(rr * 520.0, tc_vn(pp * 7.0) * 9.0));
float lathe2 = tc_vn(vec2(rr * 260.0, tc_vn(pp * 5.0 + 3.0) * 9.0));
vec2 q1 = vec2(pp.x * 0.8 + pp.y * 0.6, pp.y * 0.8 - pp.x * 0.6);
float scr1 = smoothstep(0.9, 0.99, tc_vn(vec2(q1.x * 1.0 * 240.0, q1.y * 9.0))) * smoothstep(0.3, 0.7, tc_fbm(pp * 4.0 + 7.0));
vec2 q2 = vec2(pp.x * 0.35 - pp.y * 0.94, pp.y * 0.35 + pp.x * 0.94);
float scr2 = smoothstep(0.92, 0.99, tc_vn(vec2(q2.x * 300.0, q2.y * 7.0))) * smoothstep(0.35, 0.7, tc_fbm(pp * 3.0 + 1.0));
float scr = max(scr1, scr2) * topN * uWorn;
c = mix(c, tc_lin(vec3(0.34, 0.33, 0.32)) * 0.55, scr * 0.5);
// burnt-on batter crust: sparse dark brown specks and larger crusts
vec3 wk = tc_wor(pp * 85.0);
float fleck = step(0.955 - 0.42 * uGunk, tc_h21(floor(pp * 85.0 + 3.0))) * (1.0 - smoothstep(0.12, 0.34, wk.x)) * topN;
vec3 wk2 = tc_wor(pp * 14.0 + 4.0);
float crust = step(0.9 - 0.55 * uGunk, tc_h21(floor(pp * 14.0 + 9.0))) * (1.0 - smoothstep(0.1, 0.3, wk2.x)) * smoothstep(0.4, 0.7, mid) * topN;
c = mix(c, tc_lin(vec3(0.13, 0.07, 0.035)), fleck * 0.9);
c = mix(c, tc_lin(vec3(0.07, 0.04, 0.025)), crust * 0.9);
// a pan that has not been wiped: a brown-black burnt-on skin spreading over the iron
c = mix(c, tc_lin(vec3(0.09, 0.055, 0.03)), uGunk * topN * (0.2 + 0.45 * smoothstep(0.35, 0.75, mid)));
// soot / carbon on rim and underside
float sootM = uSoot * (1.0 - topN * 0.6);
c = mix(c, vec3(0.004), sootM * (0.4 + 0.5 * mid));
// oil under and around each dosa
float oilS = clamp(tcSpot(uSpot0, pp) + tcSpot(uSpot1, pp) + tcSpot(uSpot2, pp), 0.0, 1.0) * topN;
float oilF = smoothstep(0.55, 0.72, tc_fbm(pp * 6.0 + 21.0)) * topN;
c *= 1.0 - 0.25 * oilS;
diffuseColor.rgb = c;
`;

// a hot pan glows a dull cherry-red from the middle, shimmering a little
const FRAG_EMISSIVE = /* glsl */ `
float hotMid = smoothstep(0.33, 0.03, rr) * topN;
float shim = 0.82 + 0.18 * sin(uTime * 6.0 + rr * 38.0 + big * 5.0);
totalEmissiveRadiance += vec3(1.0, 0.2, 0.035) * uHot * hotMid * shim * 0.5;
`;

const FRAG_ROUGH = /* glsl */ `
float rgh = 0.52 + 0.3 * (mid - 0.5) + 0.04 * lathe2 + 0.12 * (big - 0.5);
rgh = mix(rgh, 0.2, oilF * 0.8);
rgh = mix(rgh, 0.16, oilS * 0.6);
rgh = mix(rgh, 0.88, max(fleck, crust));
rgh = mix(rgh, 0.38, scr);
rgh = mix(rgh, 0.45, scorch * 0.5);
roughnessFactor = rgh;
`;

const FRAG_NORMAL = /* glsl */ `
#if TC_Q >= 1
  float hh = lathe * 0.03 + lathe2 * 0.025 + mid * 0.2 - (scr1 + scr2) * 0.3 + fleck * 0.35 + crust * 0.7;
  normal = tc_bump(-vViewPosition, normal, vec2(dFdx(hh), dFdy(hh)) * 0.35, faceDirection);
#endif
`;

export function tawaUniforms() {
  return {
    uSpot0: { value: new Vector3(0, 0, 0) },
    uSpot1: { value: new Vector3(0, 0, 0) },
    uSpot2: { value: new Vector3(0, 0, 0) },
    uHeat: { value: 1 },
    uGunk: { value: 0 },
    uHot: { value: 0 },
    uSoot: { value: 0.5 },
    uWorn: { value: 1 },
    uBase: { value: new Color(0.045, 0.043, 0.042) },
  };
}

/** createTawaMaterial() -> { mat, uniforms, dispose }. metalness is mid: polymerised oil over iron. */
export function createTawaMaterial({ uniforms = tawaUniforms(), metalness = 0.55, anisotropy = 0 } = {}) {
  const mat = new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.5, metalness, envMapIntensity: 1.1, side: 0 });
  mat.defines = { TC_Q: quality().detail };
  patchMaterial(mat, { key: 'tawa', uniforms, fragPars: FRAG_PARS, fragColor: FRAG_COLOR, fragRough: FRAG_ROUGH, fragNormal: FRAG_NORMAL, fragEmissive: FRAG_EMISSIVE });
  const off = registerQuality({
    apply(cfg) {
      if (mat.defines.TC_Q !== cfg.detail || mat.anisotropy !== (cfg.aniso ? anisotropy : 0)) {
        mat.defines.TC_Q = cfg.detail;
        mat.anisotropy = cfg.aniso ? anisotropy : 0;
        mat.needsUpdate = true;
      }
    },
  });
  return { mat, uniforms, dispose() { off(); mat.dispose(); } };
}
