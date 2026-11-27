// Dynamic resolution WITHOUT re-allocating render targets.
//
// The problem: both games change the render scale by calling renderer.setPixelRatio / setSize and rebuilding every post target. That reallocates
// 5-10 textures + the MSAA renderbuffer per step, hitches the frame that does it, and made `setSize` 6 % of CPU in steady state. The fix is to allocate the
// targets ONCE at their maximum size and render into a SUB-RECT of them: renderTarget.viewport / .scissor cost nothing. Every pass then reads
// the sub-rect back with scaled UVs:
//
//     virtual target (what the shader thinks it renders to)      allocated texture (what is on the GPU)
//        uv in [0,1] x [0,1], size = used (w*s, h*s)       ->      uv * s, clamped half a texel inside the used area
//
// So the shader code stays in "virtual resolution" space: its texel size is 1 / usedSize, its gl_FragCoord runs 0..used, and the ONLY change is that
// every texture fetch from a dynamic target goes through dynUv(). Samples never bleed in from the unused (stale) part of the texture.
//
// Adopting it (details and exact file / function names in docs/GFX_ENGINE.md):
//   1. allocate each target at its max size, once (tier change / window resize only); never call setSize for a scale change
//   2. const dyn = createDynamicRes({ scale });  on governor onScale:  dyn.setScale(s)
//   3. before rendering into a target: dyn.apply(target)   (renderer.setRenderTarget(target); renderer.render(...))
//   4. fragment shaders: put DYNRES_GLSL (or rewriteSamples(src, ['tColor', ...])) in, sample through dynUv(); share dyn.uniforms with every material
//   5. texel-size uniforms use dyn.sizeOf(target) (the USED size), not target.width / height
//   6. the final pass renders to the canvas at full size (viewport reset) and upsamples with the linear filter of the sampled target
// The camera is untouched: the used sub-rect has the same aspect as the full target (to within one pixel of rounding).

import {
  BufferAttribute, BufferGeometry, Mesh, OrthographicCamera, Scene, ShaderMaterial, Vector2,
} from 'three';

/** GLSL to drop into any fragment shader that samples a dynamic target. `uDynScale` = used / allocated (shared by every target), `uDynHalf` = half a used texel. */
export const DYNRES_GLSL = /* glsl */ `
uniform vec2 uDynScale;
uniform vec2 uDynHalf;
vec2 dynUv(vec2 uv) { return clamp(uv, uDynHalf, vec2(1.0) - uDynHalf) * uDynScale; }
`;

/** The fullscreen-triangle vertex shader the dynamic passes use (uv 0..1 over the VIEWPORT, i.e. over the used sub-rect when rendering into a target). */
export const DYNRES_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** The JS twin of dynUv(), for tests and CPU-side picking. `used` and `alloc` are sizes in pixels. */
export function dynUv(uv, used, alloc) {
  const hx = 0.5 / used[0];
  const hy = 0.5 / used[1];
  return [Math.min(1 - hx, Math.max(hx, uv[0])) * (used[0] / alloc[0]), Math.min(1 - hy, Math.max(hy, uv[1])) * (used[1] / alloc[1])];
}

/**
 * Rewrites `texture2D(sampler, uv)` / `texture(sampler, uv)` calls on the listed samplers to `texture2D(sampler, dynUv(uv))` and prepends DYNRES_GLSL, so an
 * existing fragment shader can adopt dynamic resolution without being rewritten by hand. Calls on other samplers are left alone. Pure string work.
 */
export function rewriteSamples(source, samplers) {
  const names = new Set(samplers);
  const count = { n: 0 };
  const body = (src) => {
    let out = '';
    let i = 0;
    const re = /\b(texture2D|texture)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      const open = m.index + m[0].length; // just after the "("
      let depth = 1;
      let j = open;
      const commas = []; // top-level commas of this call
      while (j < src.length && depth > 0) {
        const ch = src[j];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 1) commas.push(j);
        j++;
      }
      if (depth !== 0 || !commas.length) break; // malformed: leave the rest untouched
      const close = j - 1;
      out += src.slice(i, open);
      if (names.has(src.slice(open, commas[0]).trim())) {
        const uvEnd = commas.length > 1 ? commas[1] : close;
        const uv = body(src.slice(commas[0] + 1, uvEnd)).trim();
        const rest = body(src.slice(uvEnd, close));
        if (uv.startsWith('dynUv(')) out += `${src.slice(open, commas[0] + 1)} ${uv}${rest}`; // already wrapped (a second pass)
        else {
          out += `${src.slice(open, commas[0] + 1)} dynUv(${uv})${rest}`;
          count.n++;
        }
      } else out += body(src.slice(open, close)); // not a dynamic sampler, but its arguments may contain dynamic fetches
      out += ')';
      i = close + 1;
      re.lastIndex = i;
    }
    return out + src.slice(i);
  };
  const out = body(source);
  return { source: count.n && !out.includes('vec2 dynUv(') ? `${DYNRES_GLSL}\n${out}` : out, rewritten: count.n };
}

/** Shared uniform objects: put them in the `uniforms` of every ShaderMaterial that samples a dynamic target; createDynamicRes updates them in place. */
export function dynResUniforms() {
  return { uDynScale: { value: new Vector2(1, 1) }, uDynHalf: { value: new Vector2(0, 0) } };
}

const roundPx = (v) => Math.max(1, Math.round(v));

/**
 * The dynamic-resolution state for one pipeline.
 *   dyn.scale                  the current factor (0.25..1)
 *   dyn.setScale(s)            -> true when the integer sizes changed (so a game can skip redundant work)
 *   dyn.apply(target)          sets target.viewport / scissor to the used sub-rect (scissor off at scale 1) and remembers its used size
 *   dyn.sizeOf(target)         { w, h } used pixels (for texel-size uniforms and gl_FragCoord math)
 *   dyn.uniforms               shared { uDynScale, uDynHalf }, kept current by setScale / apply
 *   dyn.reset(target)          full viewport again (when a target is borrowed by code that does not know about dyn)
 */
export function createDynamicRes({ scale = 1, min = 0.25 } = {}) {
  let s = Math.min(1, Math.max(min, scale));
  const uniforms = dynResUniforms();
  const used = new WeakMap(); // target -> { w, h }
  let lastAlloc = null;
  const sizeFor = (rt) => ({ w: roundPx(rt.width * s), h: roundPx(rt.height * s) });
  const syncUniforms = (rt, u = used.get(rt)) => {
    if (!u) return;
    uniforms.uDynScale.value.set(u.w / rt.width, u.h / rt.height);
    uniforms.uDynHalf.value.set(0.5 / u.w, 0.5 / u.h);
    lastAlloc = rt;
  };
  const api = {
    uniforms,
    get scale() { return s; },
    setScale(next) {
      const v = Math.min(1, Math.max(min, next));
      if (Math.abs(v - s) < 1e-6) return false;
      s = v;
      if (lastAlloc) syncUniforms(lastAlloc, sizeFor(lastAlloc)); // the next apply() makes the viewports match these
      return true;
    },
    /** Sets the viewport / scissor of `target` for the current scale. Cheap: three reads them in setRenderTarget. */
    apply(target) {
      const u = sizeFor(target);
      used.set(target, u);
      if (u.w >= target.width && u.h >= target.height) {
        target.scissorTest = false;
        target.viewport.set(0, 0, target.width, target.height);
        target.scissor.set(0, 0, target.width, target.height);
      } else {
        target.viewport.set(0, 0, u.w, u.h);
        target.scissor.set(0, 0, u.w, u.h);
        target.scissorTest = true;
      }
      syncUniforms(target);
      return u;
    },
    reset(target) {
      target.scissorTest = false;
      target.viewport.set(0, 0, target.width, target.height);
      target.scissor.set(0, 0, target.width, target.height);
      used.delete(target);
    },
    /** Used size in pixels; falls back to the size at the current scale for a target that has not been applied yet. */
    sizeOf(target) {
      return used.get(target) || sizeFor(target);
    },
    /** The scale of a target as a Vector2 (used / allocated). */
    uvScaleOf(target, out = new Vector2()) {
      const u = api.sizeOf(target);
      return out.set(u.w / target.width, u.h / target.height);
    },
    /** Updates the shared uniforms for sampling `target` (call before a pass that reads it, when its size differs from the last applied one). */
    bind(target) {
      if (!used.has(target)) used.set(target, sizeFor(target));
      syncUniforms(target);
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// A tiny fullscreen pass that samples dynamic targets (the building block of both games' composite / blit / blur passes)

const _cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
let _tri = null;
const triangle = () => {
  if (_tri) return _tri;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  _tri = g;
  return g;
};

/**
 * A fullscreen pass. `fragment` is GLSL that may call dynUv() (DYNRES_GLSL is prepended) and reads `vUv`; `uniforms` are yours (the dyn uniforms are added).
 * pass.render(renderer, target, dyn): target = a WebGLRenderTarget (its viewport is set to the used sub-rect) or null (the canvas: full viewport).
 * pass.dispose() frees the material; the shared triangle geometry lives for the page.
 */
export function createDynPass({ fragment, uniforms = {}, dyn, defines = null, blending, extra = {} }) {
  const mat = new ShaderMaterial({
    vertexShader: DYNRES_VERT,
    fragmentShader: `${DYNRES_GLSL}\n${fragment}`,
    uniforms: { ...uniforms, ...(dyn ? dyn.uniforms : dynResUniforms()) },
    depthTest: false,
    depthWrite: false,
    ...(defines ? { defines } : {}),
    ...(blending !== undefined ? { blending } : {}),
    ...extra,
  });
  const scene = new Scene();
  const mesh = new Mesh(triangle(), mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    material: mat,
    uniforms: mat.uniforms,
    render(renderer, target, d = dyn, { clear = true } = {}) {
      if (target) d?.apply(target);
      renderer.setRenderTarget(target);
      if (!target) {
        renderer.setScissorTest(false);
        const size = renderer.getDrawingBufferSize ? renderer.getDrawingBufferSize(_size) : _size.set(0, 0);
        const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
        renderer.setViewport(0, 0, size.x / pr, size.y / pr);
      }
      const ac = renderer.autoClear;
      renderer.autoClear = clear;
      renderer.render(scene, _cam);
      renderer.autoClear = ac;
    },
    dispose() {
      mat.dispose();
    },
  };
}
const _size = new Vector2();

/**
 * Presents a dynamic-resolution target on the canvas: one fullscreen pass sampling the used sub-rect with the target's own (linear) filter.
 * For the tiers that render DIRECTLY to the canvas today: render the scene into `target` (RGBA8, optionally MSAA samples) at dyn.scale and blit.
 * blit.render(renderer, target) draws it. At scale 1 skip both and render straight to the canvas.
 */
export function createBlit(dyn, { fragment = 'gl_FragColor = vec4(texture2D(tSrc, dynUv(vUv)).rgb, 1.0);' } = {}) {
  const pass = createDynPass({
    dyn,
    uniforms: { tSrc: { value: null } },
    fragment: `uniform sampler2D tSrc; varying vec2 vUv; void main() { ${fragment} }`,
  });
  return {
    pass,
    render(renderer, target) {
      dyn.bind(target);
      pass.uniforms.tSrc.value = target.texture;
      pass.render(renderer, null, dyn);
    },
    dispose() {
      pass.dispose();
    },
  };
}
