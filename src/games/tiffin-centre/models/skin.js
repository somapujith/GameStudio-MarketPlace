// Skin, eye and hair materials for the people of Tiffin Centre. Pure three + GLSL injected with onBeforeCompile (no textures needed:
// pores, wrinkles, stubble, lips and flush are all evaluated from the REST position of the vertex in head space, so they follow the
// face morph targets and stay continuous across the head, neck, ears and eyelids).
//
// Head space: metres, origin on the eye line between the eyes, +y up, +z forward (the face), +x the character's left.
import { Color, MeshPhysicalMaterial, MeshStandardMaterial, ShaderChunk, Vector3 } from 'three';
import { tierOf } from './charquality.js';

/** Indian skin tones, light wheatish to deep brown: `base` is the albedo, `warm` the blood / subsurface tint, `lip` the lip colour. */
export const SKIN_TONES = [
  { id: 'fair', base: '#e9c19d', warm: '#d9694f', lip: '#c27867' },
  { id: 'wheat', base: '#dfaa80', warm: '#cf5d42', lip: '#b36a56' },
  { id: 'light-brown', base: '#c98d5f', warm: '#bd4f36', lip: '#9d5a49' },
  { id: 'medium-brown', base: '#b57a4c', warm: '#a8432d', lip: '#8d4d3d' },
  { id: 'brown', base: '#9a6439', warm: '#933a26', lip: '#7a4034' },
  { id: 'dark-brown', base: '#7b4e2c', warm: '#7a2f1f', lip: '#633029' },
  { id: 'deep', base: '#5d3a22', warm: '#62271a', lip: '#4f2a24' },
];

export function pickTone(r, lo = 0, hi = SKIN_TONES.length - 1) {
  const i = Math.max(0, Math.min(SKIN_TONES.length - 1, Math.floor(lo + r() * (hi - lo + 1))));
  return SKIN_TONES[i];
}

const GLSL_NOISE = /* glsl */ `
float tcH3(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float tcN3(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(tcH3(i+vec3(0,0,0)),tcH3(i+vec3(1,0,0)),f.x), mix(tcH3(i+vec3(0,1,0)),tcH3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(tcH3(i+vec3(0,0,1)),tcH3(i+vec3(1,0,1)),f.x), mix(tcH3(i+vec3(0,1,1)),tcH3(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float tcG(float d, float s){ return exp(-(d*d)/(s*s)); }
`;

const SKIN_PARS = /* glsl */ `
varying vec3 vRest; varying float vEdge;
uniform vec3 uSssTint; uniform float uSssWrap; uniform float uSssAmt; uniform vec3 uRim;
uniform float uAge; uniform float uStubble; uniform vec3 uStubbleCol; uniform float uFlush; uniform float uSweat;
uniform vec4 uWr; uniform vec3 uLip; uniform vec4 uMouth; uniform float uPores; uniform float uBump; uniform vec3 uWarm;
uniform float uMode; uniform float uBrowShade; uniform float uBindi; uniform vec3 uBindiCol;
${GLSL_NOISE}
float skinH(vec3 p, float fw){
  float h = 0.0;
  // one return at the end (an early return left the HLSL result "potentially uninitialized" on D3D drivers)
  if (uMode > 0.5) { h = (tcN3(p*700.0) - 0.5) * 0.25 * uPores + (tcN3(p*180.0) - 0.5) * 0.3 * uPores; }
  else {
  float ax = abs(p.x);
  float poreAmp = uPores * smoothstep(0.0016, 0.0005, fw);
  h += (tcN3(p*1500.0) - 0.5) * 0.22 * poreAmp + (tcN3(p*420.0) - 0.5) * 0.22 * uPores;
  float age = uAge;
  // forehead lines
  float fz = smoothstep(0.036,0.046,p.y)*smoothstep(0.098,0.08,p.y)*smoothstep(0.066,0.045,ax);
  float fl = abs(sin((p.y + 0.0035*tcN3(p*70.0)) * 430.0));
  h -= fz * max(age*0.9, uWr.x) * (1.0 - smoothstep(0.0, 0.65, fl)) * 1.4;
  // glabella (frown) lines between the brows
  float gz = smoothstep(0.013,0.004,ax)*smoothstep(0.0,0.012,p.y)*smoothstep(0.044,0.03,p.y);
  h -= gz * max(age*0.4, uWr.y) * (1.0 - smoothstep(0.0,0.5,abs(sin(p.x*900.0 + 0.7*tcN3(p*50.0)))))*1.6;
  // crow's feet fan from the outer eye corner
  vec2 q = vec2(ax-0.066, p.y+0.001);
  float cr = length(q); float ang = atan(q.y, q.x);
  float cz = smoothstep(0.03,0.012,cr)*smoothstep(0.0035,0.012,cr);
  h -= cz * max(age*0.7, uWr.w*0.35 + uWr.z*0.25) * (1.0 - smoothstep(0.0,0.9,abs(sin(ang*6.0))))*0.8;
  // under-eye line and bag
  h -= tcG(p.y+0.017+0.003*ax*20.0, 0.0023) * smoothstep(0.06,0.03,ax)*smoothstep(0.012,0.025,ax) * age * 1.1;
  // nasolabial fold
  float nx = 0.016 + (-0.046 - p.y)*0.55;
  float nd = ax - nx;
  float nz = smoothstep(-0.040,-0.052,p.y)*smoothstep(-0.088,-0.07,p.y);
  h -= tcG(nd, 0.0042) * nz * max(age*0.9, uWr.z*0.85) * 1.4;
  // marionette lines at the mouth corners
  h -= tcG(ax-0.027, 0.0035) * smoothstep(-0.08,-0.09,p.y)*smoothstep(-0.115,-0.098,p.y) * age * 0.8;
  }
  return h;
}
vec3 skinAlbedo(vec3 base, vec3 p){
  vec3 c = base;
  if (uMode > 0.5) { c = base * (0.93 + 0.12*tcN3(p*55.0) + 0.04*tcN3(p*240.0)); }
  else {
  float ax = abs(p.x);
  c *= 0.93 + 0.14*tcN3(p*48.0) + 0.04*tcN3(p*210.0);
  // under-eye shadow and inner-corner darkness
  float ue = tcG(ax-0.032, 0.017)*tcG(p.y+0.015, 0.0075);
  c = mix(c, c*vec3(0.78,0.7,0.72), ue*(0.5 + uAge*0.5));
  float eo = tcG(ax-0.03, 0.021)*tcG(p.y-0.006, 0.0125);
  c = mix(c, c*vec3(0.88,0.8,0.78), eo*0.4);
  // cheeks, nose tip and ears take the blood colour
  float ch = tcG(ax-0.049, 0.021)*tcG(p.y+0.03, 0.02);
  float nt = tcG(p.x, 0.012)*tcG(p.y+0.041, 0.011);
  c = mix(c, uWarm, ch*(0.1 + uFlush*0.5) + nt*(0.12 + uFlush*0.25));
  c = mix(c, uWarm, uFlush*0.18*smoothstep(0.0,0.07,p.y)*smoothstep(0.1,0.04,p.y));
  // upper-lid crease above the eye
  float cr2 = tcG(p.y - (0.0105 + 0.0035*smoothstep(0.0,0.03,ax-0.02)), 0.0019) * smoothstep(0.02,0.0,abs(ax-0.032)-0.012);
  c = mix(c, c*vec3(0.7,0.58,0.55), cr2*0.55);
  // brow shadow
  c *= 1.0 - uBrowShade*tcG(p.y-0.03, 0.007)*smoothstep(0.07,0.03,ax)*0.18;
  // lips
  float yMid = 0.5*(uMouth.z+uMouth.w); float hh = 0.5*(uMouth.z-uMouth.w);
  float ny = (p.y-yMid)/hh; float nx2 = ax/uMouth.y;
  float lm = 1.0 - smoothstep(0.78,1.0, sqrt(nx2*nx2*0.8 + ny*ny));
  c = mix(c, uLip, lm*0.72);
  c *= 1.0 - 0.5*tcG(p.y-uMouth.x, 0.0009)*(1.0-smoothstep(0.9,1.1,nx2));
  // nostrils
  float nos = tcG(ax-0.0085, 0.0042)*tcG(p.y+0.0475, 0.0026);
  c = mix(c, vec3(0.06,0.025,0.02), nos*0.9);
  // stubble: jaw, chin, upper lip and the lower cheek, never on the lips
  float sm = smoothstep(-0.015,-0.045,p.y) * smoothstep(0.072,0.052,ax) * (1.0 - lm) * smoothstep(0.0, 0.5, p.z + 0.04);
  sm *= 1.0 - tcG(p.y+0.03, 0.02)*0.0;
  sm *= 0.55 + 0.45*smoothstep(-0.05,-0.1,p.y) + 0.4*(1.0-smoothstep(0.0,0.03,ax))*smoothstep(-0.042,-0.058,p.y);
  float dots = smoothstep(0.38,0.62, tcN3(p*1100.0)*0.6+tcN3(p*520.0)*0.4);
  c = mix(c, uStubbleCol, clamp(sm*dots*uStubble*1.15, 0.0, 0.88));
  // bindi / tilak dot on the forehead
  c = mix(c, uBindiCol, uBindi*(1.0 - smoothstep(0.0028,0.0038, length(vec2(p.x, p.y-0.0155))))*1.0);
  }
  return c;
}
`;

const SSS_OLD = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\n\tvec3 irradiance = dotNL * directLight.color;';
function sssChunk() {
  const src = ShaderChunk.lights_physical_pars_fragment;
  if (!src.includes(SSS_OLD)) return src;
  return src.replace(
    SSS_OLD,
    `float dotNLraw = dot( geometryNormal, directLight.direction );
	float dotNL = saturate( dotNLraw );
	float wrapNL = saturate( ( dotNLraw + uSssWrap ) / ( 1.0 + uSssWrap ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += directLight.color * max( wrapNL - dotNL, 0.0 ) * uSssTint * uSssAmt * BRDF_Lambert( material.diffuseColor );`
  );
}

function makeSkinUniforms(o) {
  const tone = o.tone || SKIN_TONES[2];
  const warm = new Color(tone.warm);
  return {
    uSssTint: { value: new Color(tone.warm).multiplyScalar(0.9) },
    uSssWrap: { value: 0.45 },
    uSssAmt: { value: 1.0 },
    uRim: { value: new Color('#ffb48a') },
    uAge: { value: o.age ?? 0.1 },
    uStubble: { value: o.stubble ?? 0 },
    uStubbleCol: { value: new Color(o.hairColor || '#1a1410').lerp(new Color(tone.base), 0.12) },
    uFlush: { value: 0 },
    uSweat: { value: 0 },
    uWr: { value: { x: 0, y: 0, z: 0, w: 0, set(a, b, c, d) { this.x = a; this.y = b; this.z = c; this.w = d; return this; } } },
    uLip: { value: new Color(o.lipColor || tone.lip) },
    uMouth: { value: { x: -0.0745, y: 0.025, z: -0.0605, w: -0.0865, set(a, b, c, d) { this.x = a; this.y = b; this.z = c; this.w = d; return this; } } },
    uPores: { value: o.normalMaps === false ? 0 : 1 },
    uBump: { value: o.normalMaps === false ? 0 : 1 },
    uWarm: { value: warm },
    uMode: { value: 0 },
    uBrowShade: { value: 1 },
    uBindi: { value: o.bindi ? 1 : 0 },
    uBindiCol: { value: new Color(o.bindiColor || '#b3122b') },
    uRestOff: { value: new Vector3(0, 0, 0) },
  };
}

// three's Vector4 is not needed: the uniforms above use plain {x,y,z,w} objects, which three uploads as vec4 (it checks .x/.y/.z/.w).

let skinCount = 0;
// The PACKED variant (models/pack.js): a whole person's skin parts are one mesh, so what a part carried in uniforms (the local frame offset `uRestOff` and the
// shading mode `uMode`: 0 face, 1 body) rides in two vertex attributes instead (`aRest`: the rest position of the vertex in head space, `aMode`).
const SKIN_PARS_PACKED = SKIN_PARS.replace('uniform float uMode;', 'varying float vMode;');
function attachSkinShader(mat, u, tier, packed = false) {
  mat.userData.skin = u;
  mat.customProgramCacheKey = () => `tc-skin-v2:${tier.normalMaps ? 1 : 0}${packed ? ':p' : ''}`;
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(u)) shader.uniforms[k] = u[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', packed ? '#include <common>\nvarying vec3 vRest; varying float vEdge; attribute float aEdge; attribute vec3 aRest; attribute float aMode; varying float vMode;' : '#include <common>\nvarying vec3 vRest; varying float vEdge; attribute float aEdge; uniform vec3 uRestOff;')
      .replace('#include <begin_vertex>', packed ? '#include <begin_vertex>\nvRest = aRest; vEdge = aEdge; vMode = aMode;' : '#include <begin_vertex>\nvRest = position + uRestOff; vEdge = aEdge;');
    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>
${packed ? SKIN_PARS_PACKED : SKIN_PARS}`);
    fs = fs.replace('#include <lights_physical_pars_fragment>', sssChunk());
    fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = skinAlbedo(diffuseColor.rgb, vRest);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.62,0.4,0.38), clamp(vEdge,0.0,1.0)*0.7);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012,0.008,0.007), smoothstep(1.15,1.8,vEdge));`);
    if (tier.normalMaps) {
      fs = fs.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  float fw = length(fwidth(vRest));
  float hh = skinH(vRest, fw) * 0.00065;
  vec3 sX = dFdx( - vViewPosition ); vec3 sY = dFdy( - vViewPosition );
  float dhx = dFdx(hh); float dhy = dFdy(hh);
  vec3 R1 = cross( sY, normal ); vec3 R2 = cross( normal, sX );
  float det = dot( sX, R1 ) * faceDirection;
  vec3 grad = sign( det ) * ( dhx * R1 + dhy * R2 );
  normal = normalize( abs( det ) * normal - grad * uBump * 0.9 );
}`
      );
    }
    fs = fs.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
{
  float ax2 = abs(vRest.x);
  float yMid2 = 0.5*(uMouth.z+uMouth.w); float hh2 = 0.5*(uMouth.z-uMouth.w);
  float ny2 = (vRest.y-yMid2)/hh2; float nx3 = ax2/uMouth.y;
  float lm2 = 1.0 - smoothstep(0.78,1.0, sqrt(nx3*nx3*0.8 + ny2*ny2));
  float t = smoothstep(0.1,-0.06, vRest.y)*smoothstep(0.0,0.06,vRest.y+0.08) + smoothstep(0.02,0.1,vRest.y)*0.7;
  if (uMode < 0.5) roughnessFactor = mix(roughnessFactor, 0.34, lm2);
  roughnessFactor = mix(roughnessFactor, roughnessFactor - 0.16, clamp(t*0.2 + uSweat*(0.5+0.5*tcN3(vRest*300.0)), 0.0, 0.8));
  roughnessFactor = mix(roughnessFactor, 0.28, clamp(vEdge,0.0,1.0));
}`
    );
    fs = fs.replace(
      '#include <opaque_fragment>',
      `{
  vec3 Vn = normalize( vViewPosition );
  float rim = pow( 1.0 - saturate( dot( normal, Vn ) ), 3.0 );
  outgoingLight += uRim * rim * 0.16 * diffuseColor.rgb;
  outgoingLight += diffuseColor.rgb * uSssTint * 0.045;
}
#include <opaque_fragment>`
    );
    shader.fragmentShader = packed ? fs.replaceAll('uMode', 'vMode') : fs;
  };
  mat.needsUpdate = true;
}

/**
 * The skin material of a whole PACKED person (models/pack.js): same look, same live uniforms as `base` (a person's skin material: the flush, the wrinkles, the
 * mouth shape are shared objects), but the per-part frame offset and mode come from vertex attributes (`aRest`, `aMode`, `aEdge`). Double sided, like every body part.
 */
export function createPackedSkinMaterial(base) {
  const u = { ...base.userData.skin };
  delete u.uRestOff;
  delete u.uMode;
  const m = new MeshStandardMaterial({ color: base.color.clone(), roughness: base.roughness, metalness: 0, side: 2 });
  m.userData.tier = base.userData.tier;
  attachSkinShader(m, u, base.userData.tier, true);
  return m;
}

/**
 * The skin material. `o`: { tone, age (0..1 wrinkles), stubble (0..1), hairColor, lipColor, quality, bindi, bindiColor }.
 * `mat.userData.skin` holds the live uniforms (flush, sweat, wrinkles ...).
 */
export function createSkinMaterial(o = {}) {
  const tier = tierOf(o.quality);
  const tone = o.tone || SKIN_TONES[2];
  const mat = new MeshStandardMaterial({ color: new Color(tone.base), roughness: 0.62, metalness: 0 });
  mat.userData.skinId = ++skinCount;
  mat.userData.tier = tier;
  attachSkinShader(mat, makeSkinUniforms({ ...o, tone, normalMaps: tier.normalMaps }), tier);
  return mat;
}

/** A skin material that shares the tone and every live uniform but renders in another local frame (`restOff` = local -> head space offset). */
export function cloneSkinMaterial(base, restOff, o = {}) {
  const m = new MeshStandardMaterial({ color: base.color.clone(), roughness: base.roughness, metalness: 0, side: 2 });
  m.userData.tier = base.userData.tier;
  const u = { ...base.userData.skin, uRestOff: { value: restOff ? restOff.clone() : new Vector3() } };
  if (o.body) u.uMode = { value: 1 };
  attachSkinShader(m, u, base.userData.tier);
  return m;
}

// --------------------------------------------------------------------------------------------------------------------------------
// Eyes: sclera, iris with fibres and limbal ring, pupil, cornea bulge shine and two catch-lights. Local frame: +z is the gaze axis.
const EYE_PARS = /* glsl */ `
varying vec3 vEye;
uniform vec3 uIrisA; uniform vec3 uIrisB; uniform float uPupil; uniform vec3 uSclera; uniform float uWet; uniform float uShine;
${GLSL_NOISE}
`;
export const IRIS_COLORS = [
  { a: '#2c180c', b: '#6a4422' }, // brown
  { a: '#33200f', b: '#7c5428' },
  { a: '#40280f', b: '#8f6630' }, // lighter brown
  { a: '#2c2a12', b: '#6e6a2c' }, // hazel
  { a: '#14110e', b: '#2e241c' }, // near black
];

const eyeBase = () => new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.18, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.04, ior: 1.38, specularIntensity: 0.9 });

/** The eye material of a PACKED person (models/pack.js): both eyeballs are one mesh and the local gaze-frame position comes from `aRest` (the live uniforms are shared with `base`). */
export function createPackedEyeMaterial(base) {
  const mat = eyeBase();
  attachEyeShader(mat, base.userData.eye, true);
  return mat;
}

export function createEyeMaterial(o = {}) {
  const ic = o.iris || IRIS_COLORS[0];
  const mat = eyeBase();
  const u = {
    uIrisA: { value: new Color(ic.a) },
    uIrisB: { value: new Color(ic.b) },
    uPupil: { value: o.pupil ?? 0.3 },
    uSclera: { value: new Color(o.sclera || '#f1ebe4') },
    uWet: { value: 1 },
    uShine: { value: o.shine ?? 1 },
  };
  attachEyeShader(mat, u, false);
  return mat;
}

function attachEyeShader(mat, u, packed) {
  mat.userData.eye = u;
  mat.customProgramCacheKey = () => (packed ? 'tc-eye-v1:p' : 'tc-eye-v1');
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(u)) shader.uniforms[k] = u[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', packed ? '#include <common>\nvarying vec3 vEye; attribute vec3 aRest;' : '#include <common>\nvarying vec3 vEye;')
      .replace('#include <begin_vertex>', packed ? '#include <begin_vertex>\nvEye = aRest;' : '#include <begin_vertex>\nvEye = position;');
    let fs = shader.fragmentShader.replace('#include <common>', `#include <common>\n${EYE_PARS}`);
    fs = fs.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
{
  vec3 d = normalize(vEye);
  float psi = acos(clamp(d.z, -1.0, 1.0));
  float ir = psi / 0.5;                                  // 1.0 at the iris edge
  float a = atan(d.y, d.x);
  float fib = tcN3(vec3(a*3.2, ir*5.0, 1.7))*0.55 + tcN3(vec3(a*9.0, ir*11.0, 4.1))*0.45;
  vec3 iris = mix(uIrisA, uIrisB, smoothstep(0.1, 0.95, ir*0.85 + fib*0.5 - 0.15));
  iris *= 0.7 + 0.5*fib;
  iris = mix(iris, uIrisA*0.4, smoothstep(0.78, 0.99, ir));  // limbal ring
  float pup = uPupil * 0.4;
  vec3 c = uSclera;
  c *= 0.88 + 0.12*smoothstep(1.6, 1.2, psi);              // sclera darkens towards the rear
  c = mix(c, vec3(0.62,0.22,0.2)*uSclera, smoothstep(1.0, 1.35, abs(d.x))*0.35 * 0.0 + smoothstep(0.82,1.0,abs(d.x))*0.0);
  float vein = smoothstep(0.93, 0.99, tcN3(vec3(d.x*14.0, d.y*14.0, d.z*14.0))) * smoothstep(0.6, 1.2, psi);
  c = mix(c, vec3(0.78,0.34,0.3), vein*0.22);
  float inIris = 1.0 - smoothstep(0.96, 1.0, ir);
  c = mix(c, iris, inIris);
  c = mix(c, vec3(0.012), 1.0 - smoothstep(pup*0.9, pup*1.05, ir));
  diffuseColor.rgb = c;
}`
    );
    fs = fs.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
{
  vec3 d2 = normalize(vEye);
  float s1 = smoothstep(0.17, 0.08, length(d2.xy - vec2(-0.2, 0.2)));
  float s2 = smoothstep(0.09, 0.03, length(d2.xy - vec2(0.17, -0.17)));
  totalEmissiveRadiance += vec3(1.0, 0.98, 0.94) * (s1*0.9 + s2*0.35) * uShine * step(0.0, d2.z);
}`
    );
    shader.fragmentShader = fs;
  };
  mat.needsUpdate = true;
  return mat;
}

// --------------------------------------------------------------------------------------------------------------------------------
/** Hair: cap and cards share this. Anisotropic-looking highlight bands come from the strand noise along `vRest.y`-ish flow in the shader. */
export function createHairMaterial({ color = '#1a120d', grey = 0, shine = 0.35, alphaCards = false, doubleSide = false, quality, packed = false } = {}) {
  const tier = tierOf(quality);
  const c = new Color(color).lerp(new Color('#cfcfcf'), Math.max(0, Math.min(1, grey)));
  // packed (models/pack.js): every hair part of a person in one mesh: the colour rides in the vertex colours, the strand-noise position in `aRest`
  const mat = new MeshStandardMaterial({ color: packed ? '#ffffff' : c, roughness: 0.55 - 0.3 * shine, metalness: 0.05, side: alphaCards || doubleSide ? 2 : 0, vertexColors: packed });
  const u = { uGrey: { value: grey } };
  mat.userData.hair = u;
  mat.customProgramCacheKey = () => `tc-hair-v1:${alphaCards ? 1 : 0}${packed ? ':p' : ''}`;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', packed ? '#include <common>\nvarying vec3 vHairP; varying float vHairE; varying vec2 vHairUv; attribute float aEdge; attribute vec3 aRest;' : '#include <common>\nvarying vec3 vHairP; varying float vHairE; varying vec2 vHairUv; attribute float aEdge;')
      .replace('#include <begin_vertex>', packed ? '#include <begin_vertex>\nvHairP = aRest; vHairE = aEdge; vHairUv = uv;' : '#include <begin_vertex>\nvHairP = position; vHairE = aEdge; vHairUv = uv;');
    let fs = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vHairP; varying float vHairE; varying vec2 vHairUv;\n${GLSL_NOISE}`);
    fs = fs.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
{
  float strand = tcN3(vec3(vHairP.x*620.0, vHairP.y*180.0, vHairP.z*620.0))*0.6 + tcN3(vec3(vHairP.x*1800.0, vHairP.y*500.0, vHairP.z*1800.0))*0.4;
  diffuseColor.rgb *= 0.62 + 0.62*strand;
  ${alphaCards ? 'float sl = abs(fract(vHairUv.x*9.0)-0.5)*2.0; float cardA = smoothstep(1.0, 0.35, sl + (1.0-vHairUv.y)*0.35); diffuseColor.a *= cardA; if (diffuseColor.a < 0.35) discard;' : ''}
  if (vHairE < 0.999) { float n = tcN3(vHairP*900.0); if (n > vHairE*1.25 + 0.05) discard; }
  diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 1.0, vHairE));
}`
    );
    shader.fragmentShader = fs;
  };
  mat.needsUpdate = true;
  void tier;
  return mat;
}

/** The hair material of a PACKED person (models/pack.js): one mesh for the scalp, cards, brows and facial hair; colours in the vertex colours. Always double sided, like the rig's own. */
export const createPackedHairMaterial = (o = {}) => createHairMaterial({ ...o, doubleSide: true, packed: true });
