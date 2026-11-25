// Procedural food surface shaders (patched MeshPhysicalMaterial). No textures: everything is computed from noise in GLSL, so the
// batter / dosa / fried / idli / potato / sambar surfaces stay crisp at 1 m and can be animated by plain uniforms.
//
//   createDosaMaterial({ sheet })   dosa lifecycle (batter -> spread -> lacy golden -> burnt); `sheet` = static plated dosa
//   createFoodMaterial(mode, opts)  'fried' | 'idli' | 'masala' | 'sambar' | 'chutney' | 'chutney-red' | 'powder'
//
// TC_Q (material.defines) is the quality tier: 0 flat + no bump, 1 bump + cheap pores, 2 worley lace + full bump.
import { Color, DoubleSide, MeshPhysicalMaterial } from 'three';
import { patchMaterial } from './patch.js';
import { quality, registerQuality } from '../pbr.js';

const u = (v) => ({ value: v });

// ---------------------------------------------------------------------------------------------------------------------
// DOSA
const DOSA_VERT = /* glsl */ `
uniform float uSpread, uLift, uR, uSeed, uCook;
vec3 tcDosa(vec3 p, out float slope){
  float rn = length(p.xz) / uR;
  float th = atan(p.z, p.x + 1e-5);
  float sp = max(uSpread, 0.03);
  float t = clamp((rn - 0.5) / 0.5, 0.0, 1.0);
  float e = t * t * (3.0 - 2.0 * t);
  float de = 6.0 * t * (1.0 - t) / 0.5;
  float md = 0.62 + 0.2 * sin(2.0 * th + uSeed * 6.0) + 0.18 * sin(3.0 * th + uSeed * 11.0);
  float wet = 1.0 - smoothstep(0.1, 0.5, uCook);
  float base = 0.0007 + 0.0011 * wet * (0.35 + 0.65 * smoothstep(0.7, 1.0, rn));
  float y = base + uLift * e * e * md;
  slope = uLift * 2.0 * e * de * md / (uR * sp);
  return vec3(p.x * sp, y, p.z * sp);
}
`;
const DOSA_VERT_NORMAL = /* glsl */ `
#ifdef DOSA_TAWA
{ float sl; vec3 qq = tcDosa(position, sl); float th0 = atan(position.z, position.x + 1e-5);
  objectNormal = normalize(vec3(-sl * cos(th0), 1.0, -sl * sin(th0))); }
#endif
`;
const DOSA_VERT_BEGIN = /* glsl */ `
#ifdef DOSA_TAWA
{ float sl; transformed = tcDosa(position, sl); }
#endif
`;

const DOSA_FRAG_PARS = /* glsl */ `
uniform float uCook, uBurn, uSpread, uRidge, uOil, uSizzle, uSeed, uR, uPodi, uFlipped, uKind, uSheetR, uCrisp;
uniform vec3 uBatter, uGold, uDeep;
`;

const DOSA_FRAG_COLOR = /* glsl */ `
#if defined(DOSA_TAWA)
  vec2 pn = vTcPos.xz * uSpread / uR;
  float rn = length(vTcPos.xz) / uR;
#elif defined(DOSA_OBJ)
  vec2 pn = vTcPos.xz / uR;
  float rn = clamp(length(pn) / uSheetR, 0.0, 1.0);
#else
  vec2 pn = vTcUv;
  float rn = clamp(length(pn) / uSheetR, 0.0, 1.0);
#endif
float rho = length(pn);
float th = atan(pn.y, pn.x + 1e-5);
bool under = !gl_FrontFacing;
bool spongy = uKind > 3.5;
float cookT = smoothstep(0.28, 0.75, uCook);
float rag = tc_fbm(pn * 2.6 + uSeed * 9.0);
#ifdef DOSA_TAWA
  float lim = 0.992 - cookT * 0.07 * rag * uCrisp - 0.02 * uBurn;
  if (rn > lim) discard;
#endif
float holeMask = 0.0; float holeRim = 0.0; float net = 1.0; float wkF1 = 1.0;
#if TC_Q >= 2
  vec2 wp = pn * 21.0 + uSeed * 13.0;
  wp += 0.45 * vec2(tc_vn(pn * 6.0 + 3.1), tc_vn(pn * 6.0 + 9.7)) - 0.22;
  vec3 wk = tc_wor(wp);
  float dens = 0.12 + 0.88 * smoothstep(0.42, 0.72, tc_fbm(pn * 3.2 + uSeed * 3.0));
  dens = max(dens, 0.5 * smoothstep(0.62, 1.0, rn));
  float holeR = cookT * dens * 0.2 * uCrisp;
  wkF1 = wk.x;
  holeMask = 1.0 - smoothstep(holeR * 0.85, holeR, wk.x);
  holeRim = (1.0 - smoothstep(holeR, holeR * 3.0 + 0.03, wk.x)) * cookT * smoothstep(0.1, 0.3, dens);
  net = smoothstep(0.0, 0.16, wk.y - wk.x);
#elif TC_Q == 1
  float lv = tc_vn(pn * 24.0 + uSeed * 7.0);
  float holeR = cookT * 0.2 * uCrisp;
  holeMask = 1.0 - smoothstep(holeR * 0.8, holeR, lv);
  holeRim = (1.0 - smoothstep(holeR, holeR * 2.2 + 0.03, lv)) * cookT;
  wkF1 = lv;
#endif
if (!spongy && holeMask > 0.5) discard;

float spot = tc_fbm(pn * 2.7 + uSeed * 5.0);
float cl = uCook + (spot - 0.5) * 0.34 * smoothstep(0.1, 0.6, uCook) + (tc_vn(pn * 17.0) - 0.5) * 0.08;
cl += holeRim * 0.24 + smoothstep(0.55, 1.0, rn) * 0.17 * smoothstep(0.2, 0.7, uCook);
float rid = sin(6.2832 * 5.0 * rho - th + uSeed * 6.3);
cl += rid * 0.045 * smoothstep(0.2, 0.8, uCook);
if (under) cl = min(cl + 0.1 + 0.08 * (1.0 - net), 0.97 + 0.5 * uBurn);
cl += uFlipped * 0.14;
if (spongy) {
  cl = uCook + (spot - 0.5) * 0.2 + (under ? 0.35 : 0.0) - 0.12;
#ifdef DOSA_OBJ
  cl += (1.0 - smoothstep(0.0, 0.012, vTcPos.y)) * 0.55 + smoothstep(0.7, 1.0, rn) * 0.12;
#endif
}

vec3 cB = tc_lin(uBatter);
vec3 cC = tc_lin(mix(uBatter, uGold, 0.35));
vec3 cG = tc_lin(uGold);
vec3 cD = tc_lin(uDeep);
vec3 cK = tc_lin(vec3(0.07, 0.04, 0.02));
vec3 col = cB;
col = mix(col, cC, smoothstep(0.15, 0.45, cl));
col = mix(col, cG, smoothstep(0.45, 0.8, cl));
col = mix(col, cD, smoothstep(0.8, 1.05, cl));
col = mix(col, cK, smoothstep(1.0, 1.35, cl));
float burnN = tc_fbm(pn * 4.0 + 9.0 + uSeed);
float bm = smoothstep(0.62 - 0.5 * uBurn, 0.82 - 0.45 * uBurn, burnN + 0.28 * uBurn) * uBurn;
col = mix(col, tc_lin(vec3(0.03, 0.024, 0.02)), bm);
float speck = step(0.988, tc_h21(floor(pn * 120.0 + uSeed * 31.0))) * smoothstep(0.3, 0.8, uCook);
col *= 1.0 - speck * 0.55;
col *= 0.93 + 0.14 * tc_vn(pn * 60.0);
col *= 1.0 + 0.07 * rid * (1.0 - smoothstep(0.1, 0.5, uCook)) * smoothstep(0.1, 0.4, uSpread);
float pm = 0.0; float pfleck = 0.0;
if (uPodi > 0.0 && !under) {
  float pg = tc_vn(pn * 150.0);
  pm = smoothstep(0.42, 0.75, tc_fbm(pn * 5.0 + 3.0 + uSeed)) * uPodi;
  vec3 podi = mix(tc_lin(vec3(0.3, 0.06, 0.03)), tc_lin(vec3(0.55, 0.17, 0.06)), pg);
  col = mix(col, podi, pm * 0.88);
}
if (uKind > 2.5 && uKind < 3.5 && !under) {
  vec3 wf = tc_wor(pn * 11.0 + 4.0 + uSeed);
  pfleck = (1.0 - smoothstep(0.1, 0.17, wf.x)) * step(0.42, wf.z);
  col = mix(col, tc_lin(vec3(0.92, 0.86, 0.58)), pfleck * 0.85 * step(0.7, wf.z));
  col = mix(col, tc_lin(vec3(0.3, 0.45, 0.12)), pfleck * 0.85 * (1.0 - step(0.7, wf.z)));
}
// raw batter is translucent: the dark tawa shows through
float opac = spongy ? 1.0 : mix(0.5, 1.0, smoothstep(0.0, 0.42, uCook));
col = mix(tc_lin(vec3(0.03)), col, opac);
float sizz = 0.0;
#ifdef DOSA_TAWA
  sizz = uSizzle * smoothstep(0.86, 0.99, rn) * smoothstep(0.55, 0.8, tc_wor(pn * 38.0 + uTime * 1.5).x);
  col = mix(col, vec3(0.9, 0.88, 0.8), clamp(sizz, 0.0, 1.0) * 0.6);
#endif
diffuseColor.rgb = col;
`;

const DOSA_FRAG_ROUGH = /* glsl */ `
float tcWet = (1.0 - smoothstep(0.1, 0.5, uCook)) * (spongy ? 0.0 : 1.0);
float tcOilN = smoothstep(0.55, 0.76, tc_fbm(pn * 4.5 + 8.0));
float tcOilM = uOil * smoothstep(0.35, 0.65, tc_fbm(pn * 2.0 + uTime * 0.05 + 2.0));
roughnessFactor = mix(spongy ? 0.7 : 0.66, 0.1, tcWet);
roughnessFactor = mix(roughnessFactor, 0.3, tcOilN * (1.0 - tcWet) * 0.7);
roughnessFactor = mix(roughnessFactor, 0.1, tcOilM);
roughnessFactor = mix(roughnessFactor, 0.92, pm);
roughnessFactor += holeRim * 0.08 + bm * 0.3 + (under ? 0.1 : 0.0);
`;

const DOSA_FRAG_NORMAL = /* glsl */ `
#if TC_Q >= 1
  float tcRidAmp = uRidge * (1.0 - smoothstep(0.3, 0.9, uCook) * 0.65);
  float hh = rid * 0.9 * tcRidAmp + tc_fbm(pn * 28.0) * 0.22 + holeRim * 0.5 + sizz * 0.6 + pm * tc_vn(pn * 150.0) * 0.5 + bm * tc_vn(pn * 50.0) * 0.8;
  hh -= (1.0 - net) * 0.0;
  if (spongy) hh = (1.0 - smoothstep(0.0, 0.35, tc_wor(pn * 26.0 + uSeed).x)) * -0.7 + tc_fbm(pn * 14.0) * 0.3;
  normal = tc_bump(-vViewPosition, normal, vec2(dFdx(hh), dFdy(hh)) * 0.55, faceDirection);
#endif
`;

const DOSA_FRAG_PHYS = /* glsl */ `
#if TC_Q >= 1
  material.clearcoat = clamp(tcOilM * 0.95 + tcWet * 0.35 + pm * 0.0, 0.0, 1.0);
  material.clearcoatRoughness = 0.07;
#endif
`;

/** Per-instance uniform set for a dosa. */
export function dosaUniforms(o = {}) {
  return {
    uCook: u(0), uBurn: u(0), uSpread: u(1), uRidge: u(0.6), uOil: u(0), uSizzle: u(0), uSeed: u(o.seed ?? 0.37), uR: u(o.R ?? 0.115),
    uLift: u(0), uPodi: u(0), uFlipped: u(0), uKind: u(0), uSheetR: u(o.sheetR ?? 1), uCrisp: u(1),
    uBatter: u(new Color(0.93, 0.9, 0.8)), uGold: u(new Color(0.88, 0.6, 0.24)), uDeep: u(new Color(0.6, 0.3, 0.09)),
  };
}

export const DOSA_PALETTES = {
  plain: { batter: [0.93, 0.9, 0.8], gold: [0.89, 0.62, 0.26], deep: [0.6, 0.3, 0.09] },
  pesarattu: { batter: [0.52, 0.58, 0.3], gold: [0.44, 0.5, 0.18], deep: [0.34, 0.28, 0.09] },
  set: { batter: [0.98, 0.96, 0.88], gold: [0.97, 0.88, 0.62], deep: [0.82, 0.6, 0.28] },
};
export function setPalette(uniforms, name) {
  const p = DOSA_PALETTES[name] || DOSA_PALETTES.plain;
  uniforms.uBatter.value.setRGB(p.batter[0], p.batter[1], p.batter[2]);
  uniforms.uGold.value.setRGB(p.gold[0], p.gold[1], p.gold[2]);
  uniforms.uDeep.value.setRGB(p.deep[0], p.deep[1], p.deep[2]);
}

function qualityBinding(mat) {
  return registerQuality({
    apply(cfg) {
      const d = cfg.detail;
      if (mat.defines.TC_Q !== d) {
        mat.defines.TC_Q = d;
        mat.clearcoat = d >= 1 ? 1 : 0;
        mat.needsUpdate = true;
      }
    },
  });
}

/**
 * createDosaMaterial({ sheet, uniforms }) -> { mat, uniforms, dispose }. `sheet` = static plated dosa (uv = metres/uR on the unrolled sheet,
 * no vertex displacement); otherwise the tawa dosa: unit disc geometry of radius uR whose xz is scaled by uSpread in the vertex shader.
 */
export function createDosaMaterial({ sheet = false, obj = false, uniforms = dosaUniforms() } = {}) {
  const mat = new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0, side: DoubleSide, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.9 });
  const mode = obj ? 'DOSA_OBJ' : sheet ? 'DOSA_SHEET' : 'DOSA_TAWA';
  mat.defines = { [mode]: '', TC_Q: quality().detail };
  patchMaterial(mat, {
    key: `dosa-${mode}`,
    uniforms,
    vertPars: DOSA_VERT,
    vertNormal: DOSA_VERT_NORMAL,
    vertBegin: DOSA_VERT_BEGIN,
    fragPars: DOSA_FRAG_PARS,
    fragColor: DOSA_FRAG_COLOR,
    fragRough: DOSA_FRAG_ROUGH,
    fragNormal: DOSA_FRAG_NORMAL,
    fragPhysical: DOSA_FRAG_PHYS,
  });
  const off = qualityBinding(mat);
  return { mat, uniforms, dispose() { off(); mat.dispose(); } };
}

// ---------------------------------------------------------------------------------------------------------------------
// OTHER FOODS. One patched physical material per mode; `fp` = object-space position scaled by uScale.
const FOOD_PARS = /* glsl */ `
uniform float uCook, uBurn, uScale, uSeed, uAmt;
uniform vec3 uA, uB, uC;
`;

const FOOD_FRAG = {
  // poori / vada / bonda / bajji: golden fried batter, blisters, mottling, oil gloss
  fried: /* glsl */ `
vec3 fp = vTcPos * uScale + uSeed * 17.0;
vec3 w3 = tc_wor3(fp * 9.0);
float mott = tc_fbm3(fp * 4.0);
float bl = 1.0 - smoothstep(0.0, 0.55, w3.x);
float pitN = 1.0 - smoothstep(0.0, 0.2, tc_wor3(fp * 26.0).x);
float cl = uCook + (mott - 0.5) * 0.5 + bl * 0.12 * uAmt + (tc_h21(vec2(floor(fp.x * 40.0), floor(fp.z * 40.0))) - 0.5) * 0.08;
vec3 cA = tc_lin(uA); vec3 cBb = tc_lin(uB); vec3 cCc = tc_lin(uC);
vec3 col = mix(cA, cBb, smoothstep(0.2, 0.62, cl));
col = mix(col, cCc, smoothstep(0.62, 1.0, cl));
col = mix(col, tc_lin(vec3(0.03, 0.022, 0.018)), smoothstep(0.0, 1.0, uBurn) * smoothstep(0.35, 0.7, mott + uBurn * 0.5));
col *= 0.9 + 0.2 * (1.0 - bl * 0.6) - pitN * 0.18 * uAmt;
diffuseColor.rgb = col;
`,
  // idli: white, spongy, fine pores, slight translucency
  idli: /* glsl */ `
vec3 fp = vTcPos * uScale + uSeed * 17.0;
float pore = 1.0 - smoothstep(0.0, 0.24, tc_wor3(fp * 34.0).x);
float pore2 = 1.0 - smoothstep(0.0, 0.3, tc_wor3(fp * 70.0 + 3.0).x);
float mott = tc_fbm3(fp * 5.0);
vec3 col = mix(tc_lin(uA), tc_lin(uB), smoothstep(0.35, 0.75, mott) * 0.45);
col *= 1.0 - 0.18 * pore - 0.1 * pore2;
col *= mix(0.86, 1.0, smoothstep(0.05, 0.5, uCook));
col = mix(col, tc_lin(vec3(0.5, 0.3, 0.12)), smoothstep(0.7, 1.3, uCook) * 0.6);
col = mix(col, tc_lin(vec3(0.18, 0.1, 0.05)), uBurn * smoothstep(0.3, 0.6, mott + uBurn * 0.4));
diffuseColor.rgb = col;
`,
  // potato masala: turmeric chunks, onion, curry leaf, mustard seed flecks
  masala: /* glsl */ `
vec3 fp = vTcPos * uScale + uSeed * 17.0;
vec3 w3 = tc_wor3(fp * 12.0);
float mott = tc_fbm3(fp * 6.0);
vec3 yel = mix(tc_lin(uA), tc_lin(uB), w3.z * 0.8 + mott * 0.5);
vec3 col = yel * (0.82 + 0.3 * smoothstep(0.0, 0.7, w3.x));
vec3 w2 = tc_wor3(fp * 22.0 + 5.0);
float leaf = (1.0 - smoothstep(0.1, 0.2, w2.x)) * step(0.78, w2.z);
float seed = (1.0 - smoothstep(0.05, 0.1, tc_wor3(fp * 40.0 + 9.0).x)) * step(0.7, tc_h31(floor(fp * 40.0)));
float onion = (1.0 - smoothstep(0.12, 0.2, w2.x)) * step(0.45, w2.z) * (1.0 - step(0.78, w2.z));
col = mix(col, tc_lin(vec3(0.16, 0.3, 0.08)), leaf * 0.9);
col = mix(col, tc_lin(vec3(0.95, 0.85, 0.5)), onion * 0.45);
col = mix(col, vec3(0.01), seed * 0.9);
diffuseColor.rgb = col;
`,
  // liquid in a katori: sambar (0) / coconut chutney (1) / red chutney (2); flat disc, y-up, coordinates in xz
  liquid: /* glsl */ `
vec2 lp = vTcPos.xz * uScale + uSeed * 9.0;
float sw = tc_fbm(lp * 3.0 + vec2(uTime * 0.02, 0.0));
float swirl = tc_fbm(lp * 2.0 + 3.0 * vec2(sw, tc_vn(lp * 2.5)));
vec3 base = mix(tc_lin(uA), tc_lin(uB), swirl);
vec3 wo = tc_wor(lp * 14.0);
float oil = (1.0 - smoothstep(0.1, 0.16, wo.x)) * step(0.55, wo.z) * uAmt;
float grain = (1.0 - smoothstep(0.08, 0.14, tc_wor(lp * 40.0 + 2.0).x)) * step(0.4, tc_h21(floor(lp * 40.0)));
vec3 col = base;
col = mix(col, tc_lin(uC), grain * 0.75);
col = mix(col, tc_lin(vec3(0.95, 0.7, 0.2)), oil * 0.7);
diffuseColor.rgb = col;
`,
  // loose powder (podi): coarse grains
  powder: /* glsl */ `
vec3 fp = vTcPos * uScale;
float g = tc_vn3(fp * 160.0);
float g2 = tc_vn3(fp * 60.0 + 4.0);
vec3 col = mix(tc_lin(uA), tc_lin(uB), g * 0.7 + g2 * 0.3);
diffuseColor.rgb = col;
`,
};

const FOOD_ROUGH = {
  fried: 'roughnessFactor = mix(0.28, 0.62, smoothstep(0.1, 0.8, mott)) + pitN * 0.2 + uBurn * 0.3;',
  idli: 'roughnessFactor = mix(0.3, 0.74, smoothstep(0.05, 0.55, uCook)) + pore * 0.1;',
  masala: 'roughnessFactor = mix(0.42, 0.7, w3.x) + leaf * 0.1;',
  liquid: 'roughnessFactor = mix(0.16 + 0.3 * grain, 0.05, oil);',
  powder: 'roughnessFactor = 0.94;',
};

// height functions for bump (used with screen-space derivatives)
const FOOD_BUMP = {
  fried: 'float hh = w3.x * -0.5 + tc_fbm3(fp * 18.0) * 0.35 - pitN * 0.3 * uAmt;',
  idli: 'float hh = (pore * -0.5 + pore2 * -0.25) + tc_fbm3(fp * 12.0) * 0.2;',
  masala: 'float hh = (1.0 - w3.x) * 0.8 + tc_fbm3(fp * 30.0) * 0.25 + leaf * 0.2 + onion * 0.25;',
  liquid: 'float hh = grain * 0.15 + oil * 0.1 + swirl * 0.05;',
  powder: 'float hh = g * 0.6 + g2 * 0.3;',
};
const FOOD_BUMP_K = { fried: 0.5, idli: 0.45, masala: 0.5, liquid: 0.4, powder: 0.8 };

const FOOD_BASE = {
  fried: { roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.35 },
  idli: { roughness: 0.75, sheen: 0.7, sheenRoughness: 0.5, sheenColor: '#fff6e4' },
  masala: { roughness: 0.55, clearcoat: 0.1, clearcoatRoughness: 0.5 },
  liquid: { roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.12 },
  powder: { roughness: 0.94 },
};

/** Static colour palettes (sRGB 0..1) the dish builders feed to the uniforms. */
export const FOOD_COLORS = {
  poori: { a: [0.93, 0.76, 0.42], b: [0.82, 0.5, 0.15], c: [0.5, 0.24, 0.07] },
  vada: { a: [0.9, 0.7, 0.36], b: [0.78, 0.46, 0.14], c: [0.46, 0.22, 0.06] },
  bonda: { a: [0.86, 0.6, 0.26], b: [0.7, 0.38, 0.1], c: [0.42, 0.2, 0.05] },
  bajji: { a: [0.93, 0.8, 0.45], b: [0.84, 0.58, 0.2], c: [0.55, 0.3, 0.09] },
  idli: { a: [0.97, 0.95, 0.88], b: [0.9, 0.87, 0.76], c: [0.8, 0.76, 0.66] },
  masala: { a: [0.96, 0.78, 0.16], b: [0.82, 0.55, 0.08], c: [0.4, 0.5, 0.1] },
  sambar: { a: [0.7, 0.3, 0.08], b: [0.84, 0.46, 0.12], c: [0.95, 0.82, 0.5] },
  chutney: { a: [0.93, 0.92, 0.86], b: [0.88, 0.9, 0.78], c: [0.25, 0.45, 0.14] },
  'chutney-red': { a: [0.66, 0.1, 0.05], b: [0.8, 0.22, 0.08], c: [0.95, 0.9, 0.7] },
  podi: { a: [0.4, 0.08, 0.04], b: [0.72, 0.26, 0.08], c: [0.9, 0.7, 0.4] },
};

export function foodUniforms(color, o = {}) {
  const c = FOOD_COLORS[color] || FOOD_COLORS.poori;
  return {
    uCook: u(o.cook ?? 0.7), uBurn: u(o.burn ?? 0), uScale: u(o.scale ?? 9), uSeed: u(o.seed ?? 0.5), uAmt: u(o.amt ?? 1),
    uA: u(new Color(c.a[0], c.a[1], c.a[2])), uB: u(new Color(c.b[0], c.b[1], c.b[2])), uC: u(new Color(c.c[0], c.c[1], c.c[2])),
  };
}

/** createFoodMaterial(mode, { uniforms, color, side }) -> { mat, uniforms, dispose } (owned). */
export function createFoodMaterial(mode, { uniforms = foodUniforms('poori'), side = 0 } = {}) {
  const m = FOOD_FRAG[mode] ? mode : 'fried';
  const mat = new MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, side, envMapIntensity: 0.9, ...FOOD_BASE[m] });
  mat.defines = { TC_Q: quality().detail };
  const bump = FOOD_BUMP[m];
  patchMaterial(mat, {
    key: `food-${m}`,
    uniforms,
    fragPars: FOOD_PARS,
    fragColor: FOOD_FRAG[m],
    fragRough: FOOD_ROUGH[m],
    fragNormal: `#if TC_Q >= 1\n${bump}\nnormal = tc_bump(-vViewPosition, normal, vec2(dFdx(hh), dFdy(hh)) * ${FOOD_BUMP_K[m].toFixed(2)}, faceDirection);\n#endif`,
  });
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
