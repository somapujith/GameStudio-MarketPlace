// Shared materials. The star is the building material: one MeshStandardMaterial per look, patched with onBeforeCompile so a
// plain instanced box gets procedural windows (dark glass by day, lit after dark), floor ledges, a darker roof and a soft
// ground shadow. No textures, so it works at any scale and every instance can have its own colour.
import { Color, InstancedBufferAttribute, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, Vector2 } from 'three';

/** Values every material reads each frame. The sky system writes these. */
export function createShared() {
  return { uNight: { value: 0 }, uTime: { value: 0 }, uWet: { value: 0 } };
}

/**
 * Every facade "look" in one table. A building is an instance of a unit box; which look it wears is a per-instance attribute
 * (`aLook`, see `setLookAttribute`), so every building of a tile is ONE draw call whatever its look, and the city needs ONE program
 * (it was five materials = five programs and up to five draw calls per map tile).
 *   cell    window module in metres, ground = shopfront height (no windows below it), glass = window colour,
 *   litBias = extra chance a window is lit at night, roughness = base roughness of the wall
 */
export const BUILDING_LOOKS = {
  bazaar: { cell: [3.0, 3.4], ground: 3.8, glass: '#2d3b5c', litBias: 0.1, roughness: 0.85 },
  town: { cell: [3.4, 3.6], ground: 4.0, glass: '#2a3a58', litBias: 0.08, roughness: 0.85 },
  villa: { cell: [4.2, 3.4], ground: 3.2, glass: '#33425e', litBias: 0.1, roughness: 0.85 },
  glass: { cell: [2.2, 3.9], ground: 7.0, glass: '#3a6a98', litBias: 0.12, roughness: 0.35, glassy: true },
  hangar: { cell: [9, 5], ground: 5.5, glass: '#2a3a58', litBias: 0.02, roughness: 0.85 },
  cyber: { cell: [2.2, 3.9], ground: 7.0, glass: '#3a6a98', litBias: 0.14, roughness: 0.3, glassy: true },
  hosp: { cell: [3.2, 3.4], ground: 4.0, glass: '#3a5a88', litBias: 0.3, roughness: 0.85 },
};
export const LOOK_NAMES = Object.keys(BUILDING_LOOKS);
const NL = LOOK_NAMES.length;

/** Give an InstancedMesh its own copy of the geometry plus one `aLook` index per instance (`looks[i]` = a name in BUILDING_LOOKS). */
export function setLookAttribute(mesh, looks) {
  const g = mesh.geometry.clone();
  const a = new Float32Array(mesh.count);
  for (let i = 0; i < mesh.count; i++) a[i] = Math.max(0, LOOK_NAMES.indexOf(looks[i]));
  g.setAttribute('aLook', new InstancedBufferAttribute(a, 1));
  mesh.geometry = g;
  return mesh;
}

const BUILDING_VERT_COMMON = /* glsl */ `
  attribute float aLook;
  varying vec3 vBP; varying vec3 vBN; flat varying float vBSeed; flat varying float vBH; flat varying float vLook;
`;
const BUILDING_VERT_BODY = /* glsl */ `
  #ifdef USE_INSTANCING
    vec3 bsc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    vBSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  #else
    vec3 bsc = vec3(1.0); vBSeed = 0.5;
  #endif
  vBP = position * bsc; // metres in box space: x,z centred, y from 0 (the geometry sits on the ground)
  vBN = normal;
  vBH = bsc.y;
  vLook = aLook;
`;
const BUILDING_FRAG_COMMON = /* glsl */ `
  uniform float uNight; uniform vec2 uCell[${NL}]; uniform float uGround[${NL}]; uniform vec3 uGlass[${NL}]; uniform float uLitBias[${NL}]; uniform float uRough[${NL}]; uniform float uWet;
  varying vec3 vBP; varying vec3 vBN; flat varying float vBSeed; flat varying float vBH; flat varying float vLook;
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float gWin = 0.0; float gLit = 0.0; vec3 gLitCol = vec3(1.0, 0.75, 0.4); int gLook = 0;
`;
const BUILDING_FRAG_COLOR = /* glsl */ `
  {
    gLook = int(vLook + 0.5);
    vec2 uCellL = uCell[gLook]; float uGroundL = uGround[gLook]; vec3 uGlassL = uGlass[gLook]; float uLitBiasL = uLitBias[gLook];
    vec3 n = normalize(vBN);
    float side = step(abs(n.y), 0.5);
    vec2 uv = abs(n.x) > 0.5 ? vec2(vBP.z, vBP.y) : vec2(vBP.x, vBP.y);
    vec2 cid = floor(uv / uCellL);
    vec2 f = fract(uv / uCellL);
    float inWin = step(0.17, f.x) * step(f.x, 0.83) * step(0.22, f.y) * step(f.y, 0.8);
    float aboveGround = step(uGroundL, vBP.y);
    float belowTop = step(vBP.y, vBH - 1.1);
    gWin = side * inWin * aboveGround * belowTop;
    float r = h21(cid + vBSeed * 91.7 + (abs(n.x) > 0.5 ? 17.0 : 0.0));
    float r2 = h21(cid.yx + vBSeed * 13.1);
    float dusk = clamp((uNight - 0.12) * 1.25, 0.0, 1.0);
    gLit = gWin * step(r, dusk * 0.5 + uLitBiasL * smoothstep(0.12, 0.5, uNight));
    gLitCol = r2 < 0.2 ? vec3(0.3, 0.75, 1.0) : (r2 < 0.32 ? vec3(1.0, 0.3, 0.7) : vec3(1.0, 0.42, 0.1));
    // facade: darker glass in the window, a pale ledge on every floor line, a darker roof, a soft ground shadow
    diffuseColor.rgb = mix(diffuseColor.rgb, uGlassL, gWin);
    diffuseColor.rgb *= 1.0 - 0.14 * side * step(f.y, 0.07) * aboveGround;
    diffuseColor.rgb *= mix(1.0, 0.7, step(0.5, n.y));
    diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 5.0, vBP.y));
  }
`;
const BUILDING_FRAG_ROUGH = /* glsl */ `
  roughnessFactor = mix(uRough[gLook], 0.14, gWin * (1.0 - gLit));
`;
const BUILDING_FRAG_METAL = /* glsl */ `
  metalnessFactor = mix(metalnessFactor, 0.55, gWin);
`;
const BUILDING_FRAG_EMIT = /* glsl */ `
  totalEmissiveRadiance += gLitCol * gLit * 1.0;
`;

/**
 * THE building facade material (cities, landmark towers): a lit material patched with onBeforeCompile so a plain instanced box gets
 * procedural windows (dark glass by day, lit after dark), floor ledges, a darker roof and a soft ground shadow. The facade values come
 * from BUILDING_LOOKS by the instance's `aLook` index (see setLookAttribute), so ONE material per flavour serves every look.
 * Two flavours: matte walls use MeshLambertMaterial (the walls are roughness 0.85: a GGX specular term on every pixel of every facade, with
 * 3-5 lamp lights, is ~2.5x the ALU of a Lambert term and invisible); `glassy` looks (glass towers) keep MeshStandardMaterial for the sheen.
 */
export function buildingMaterial(shared, glassy = false) {
  const cache = (shared.buildingMats ||= {});
  const flavour = glassy ? 'glassy' : 'matte';
  if (cache[flavour]) return cache[flavour];
  const m = glassy ? new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.02 }) : new MeshLambertMaterial({ color: 0xffffff });
  m.customProgramCacheKey = () => `bldg-uber-${flavour}`;
  const looks = LOOK_NAMES.map((n) => BUILDING_LOOKS[n]);
  const uniforms = {
    uCell: { value: looks.map((l) => new Vector2(l.cell[0], l.cell[1])) },
    uGround: { value: looks.map((l) => l.ground) },
    uGlass: { value: looks.map((l) => new Color(l.glass)) },
    uLitBias: { value: looks.map((l) => l.litBias) },
    uRough: { value: looks.map((l) => l.roughness) },
  };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.uNight;
    shader.uniforms.uWet = shared.uWet;
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${BUILDING_VERT_COMMON}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BUILDING_VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${BUILDING_FRAG_COMMON}`)
      // (the Standard flavour darkens windows with metalness 0.55 and no environment map; the Lambert one does it in the colour)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${BUILDING_FRAG_COLOR}${glassy ? '' : '\n  diffuseColor.rgb *= 1.0 - 0.55 * gWin;'}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${BUILDING_FRAG_ROUGH}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${BUILDING_FRAG_METAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${BUILDING_FRAG_EMIT}`);
  };
  cache[flavour] = m;
  return m;
}
/** Foliage that sways in the wind (palms, trees, bunting): the vertex shader bends by height. */
export function foliageMaterial(shared, { color = 0xffffff, sway = 0.35, roughness = 0.8, key = 'f', flat = true } = {}) {
  // Lambert: leaves are roughness 0.8 and flat shaded, a specular term on a whole canopy would only cost ALU
  const m = new MeshLambertMaterial({ color, flatShading: flat, side: 2 });
  // the bend strength is a uniform (it was baked into the shader text: one program per tree kind); trees, palms and bunting share ONE program
  m.customProgramCacheKey = () => 'fol-sway';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uSway = { value: sway };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uSway;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
        #else
          float ph = 0.0;
        #endif
        float bend = max(position.y, 0.0) * uSway * 0.06;
        transformed.x += sin(uTime * 1.6 + ph) * bend;
        transformed.z += cos(uTime * 1.3 + ph * 1.3) * bend * 0.8;`,
      );
  };
  return m;
}

/** Glowing stuff (neon, lamp heads, tail lights): unlit, brighter than white so the bloom pass picks it up. */
export function glowMaterial(color = 0xffffff, boost = 2.2, map = null) {
  const m = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(boost), map, toneMapped: true });
  return m;
}

/**
 * The neon shop signs of a whole city share ONE atlas texture; each instance picks its cell with `aUvRect` (u0, v0, du, dv). One draw
 * call per map tile instead of one per sign design (nine of them).
 */
export function signAtlasMaterial(map, boost = 1.35) {
  const m = new MeshBasicMaterial({ color: new Color(0xffffff).multiplyScalar(boost), map, toneMapped: true });
  m.customProgramCacheKey = () => 'sign-atlas';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aUvRect;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = ( mapTransform * vec3( aUvRect.xy + MAP_UV * aUvRect.zw, 1 ) ).xy;\n#endif');
  };
  return m;
}

/** Lacquered paint for vehicles. */
export function paintMaterial(color, { roughness = 0.32, metalness = 0.25 } = {}) {
  return new MeshStandardMaterial({ color, roughness, metalness });
}
