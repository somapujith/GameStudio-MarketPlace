// onBeforeCompile helper: injects procedural GLSL into a stock MeshPhysicalMaterial / MeshStandardMaterial at fixed chunk
// boundaries. `hooks` strings are inserted AFTER the named three chunk. Uniform objects stay live (the caller keeps them).
import { GLSL_BUMP, GLSL_NOISE } from './glsl.js';

/** Shared animated clock for every patched material (set once per frame by whoever updates). */
export const clock = { uTime: { value: 0 } };

const V_VARY = 'varying vec3 vTcPos; varying vec3 vTcNrm; varying vec2 vTcUv;\n';

export function patchMaterial(mat, o) {
  const uniforms = { uTime: clock.uTime, ...(o.uniforms || {}) };
  const key = o.key || 'tc';
  mat.userData.tcUniforms = uniforms;
  mat.customProgramCacheKey = () => `${key}:${mat.defines?.TC_Q ?? 0}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', `#include <common>\n${V_VARY}uniform float uTime;\n${GLSL_NOISE}\n${o.vertPars || ''}`);
    vs = vs.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\nvTcPos = position; vTcNrm = normal;\n${o.vertNormal || ''}`);
    vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\n${o.vertBegin || ''}`);
    fs = fs.replace('#include <common>', `#include <common>\n${V_VARY}uniform float uTime;\n${GLSL_NOISE}\n${GLSL_BUMP}\n${o.fragPars || ''}`);
    if (o.fragColor) fs = fs.replace('#include <map_fragment>', `#include <map_fragment>\n${o.fragColor}`);
    if (o.fragRough) fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${o.fragRough}`);
    if (o.fragNormal) fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${o.fragNormal}`);
    if (o.fragEmissive) fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${o.fragEmissive}`);
    if (o.fragPhysical) fs = fs.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${o.fragPhysical}`);
    if (o.fragOut) fs = fs.replace('#include <opaque_fragment>', `${o.fragOut}\n#include <opaque_fragment>`);
    // `attribute vec2 uv` is always declared by three's prefix (zero when the geometry has none)
    vs = vs.replace('#include <uv_vertex>', '#include <uv_vertex>\nvTcUv = uv;');
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  mat.needsUpdate = true;
  return mat;
}

