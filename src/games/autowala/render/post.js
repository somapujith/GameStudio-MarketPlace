// The lean post pipeline: ONE scene target (no MSAA) -> a dual-Kawase bloom pyramid at <= 1/4 resolution -> ONE fullscreen-triangle
// composite (FXAA-lite + bloom + ACES tone mapping + sRGB + a 1-LSB dither). It replaces EffectComposer + RenderPass + UnrealBloomPass +
// OutputPass (a 4x MSAA half-float target at native resolution, ten gaussian blur passes, three full-screen copies).
//
// Cheap resolution scaling: the scene is drawn into the bottom-left sub-rectangle of a FIXED-size target and the composite reads that
// sub-rectangle with a scaled UV, so `setScale(s)` costs nothing (no reallocation, no new shader). The bloom pyramid is fixed too.
import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  OneFactor,
  OrthographicCamera,
  RGBAFormat,
  RGBFormat,
  RawShaderMaterial,
  UnsignedByteType,
  UnsignedInt101111Type,
  Vector2,
  WebGLRenderTarget,
} from 'three';

// ------------------------------------------------------------------------------------------------ pure helpers (unit-tested)

/** Smallest render scale. Below ~0.5 the picture is too soft to be worth it. */
export const MIN_SCALE = 0.5;

/** Clamp a requested scale and snap it to 1/32 steps so a governor that hunts does not make the picture shimmer. */
export function clampScale(s, min = MIN_SCALE) {
  if (!Number.isFinite(s)) return 1;
  const c = Math.min(1, Math.max(min, s));
  return Math.round(c * 32) / 32;
}

/** The sub-rectangle (in texels) of a W x H target that a scale draws into, and the UV scale the composite reads it with. */
export function scaleRect(W, H, s) {
  const w = Math.max(2, Math.min(W, Math.round(W * s)));
  const h = Math.max(2, Math.min(H, Math.round(H * s)));
  return { w, h, u: w / W, v: h / H };
}

/** Sizes (texels) of the bloom pyramid: level 0 is 1/`base` of the full target, each next level half of that, never below 2 px. */
export function bloomSizes(W, H, levels, base = 4) {
  const out = [];
  for (let i = 0; i < levels; i++) {
    const d = base * 2 ** i;
    out.push({ w: Math.max(2, Math.round(W / d)), h: Math.max(2, Math.round(H / d)) });
  }
  return out;
}

/** Per-level bloom weights: UnrealBloom's factors (1, .8, .6, .4, .2) blended with its radius (.42) give ~0.66 .. 0.54. */
export function bloomWeights(levels, radius = 0.42) {
  const out = [];
  for (let i = 0; i < levels; i++) {
    const f = 1 - (i / 4) * 0.8; // 1, .8, .6, .4, .2
    out.push(f * (1 - radius) + (1.2 - f) * radius);
  }
  return out;
}

/**
 * The composite's bloom multiplier. UnrealBloom adds `strength * sum(factor_k * blur_k)` over 5 mips (~3.0 * strength of energy);
 * the up-chain here yields `sum(w_i / w_0 * blur_i)` over `levels`, so scale it to carry the same energy for the same `strength`.
 */
export function bloomGain(strength, levels, radius = 0.42) {
  if (!levels) return 0;
  const ref = bloomWeights(5, radius).reduce((a, b) => a + b, 0);
  const w = bloomWeights(levels, radius);
  return (strength * ref * w[0]) / w.reduce((a, b) => a + b, 0);
}

/**
 * What fraction of a pixel's colour the bloom's bright pass keeps (the same arithmetic as FRAG_PREFILTER's `tap`, so it can be tested):
 * 0 well under the threshold, the excess over it above, a quadratic knee of half-width `knee` in between.
 */
export function brightPass(luma, threshold, knee) {
  const soft = Math.min(2 * knee, Math.max(0, luma - threshold + knee));
  const s = (soft * soft) / (4 * knee + 1e-4);
  return Math.max(s, luma - threshold) / Math.max(luma, 1e-4);
}

/**
 * The bloom threshold for the time of day (`night` 0..1 from the sky): neon and lamps are the point of the glow at night (1.05, as before),
 * but by day sunlit paint and chrome highlights sit in 1.2..4 and must not glow, so the threshold rises towards 2.2 at noon.
 */
export const bloomThreshold = (night) => 1.05 + (1 - Math.min(1, Math.max(0, night))) * 1.15;

/**
 * Is the bloom worth its seven passes (the bright pass, three downs, three ups: ~85 GL calls and a render-target switch each) at this time of day?
 * By day the threshold is 2.2 and almost nothing in the picture reaches it: measured (aw-shots.mjs, paused world, same cameras, bloom on vs off at
 * 12:00 / 11:00 / 17.9): mean difference 0.006-0.026 of 255, 0-0.01 % of the pixels over 2 levels, i.e. dither noise, at Charminar, the shops, the glass
 * towers and the sunset. So it is skipped while `night` is under `on` (0.04, hour ~17.5 / ~7.7: the palette's `night` is 0.08 at 17.6) and comes back
 * when it rises past it; a little hysteresis (`off`) keeps it from flickering at the boundary.
 */
export const bloomWanted = (night, wasOn = true, on = 0.04, off = 0.02) => night > (wasOn ? off : on);

// ------------------------------------------------------------------------------------------------ support probes

const probed = new Map();
/** Is `internalFormat` a COMPLETE colour attachment on a throw-away WebGL2 context? Probed once per format; false when unsure. */
export function canRenderTo(internalFormat) {
  if (probed.has(internalFormat)) return probed.get(internalFormat);
  let ok = false;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const gl = c.getContext('webgl2');
    if (gl && gl.getExtension('EXT_color_buffer_float')) {
      const fmt = gl[internalFormat];
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, 4, 4);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      ok = fmt !== undefined && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
    }
    c.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    ok = false;
  }
  probed.set(internalFormat, ok);
  return ok;
}

/** Best HDR scene format this GPU can render to: 'r11g11b10' (32 bit, half the bandwidth), 'half' (RGBA16F), else null (8-bit pipeline). */
export function pickHdrFormat(renderer) {
  const ext = (n) => renderer.extensions.has(n);
  if (ext('EXT_color_buffer_float') && canRenderTo('R11F_G11F_B10F')) return 'r11g11b10';
  if (ext('EXT_color_buffer_half_float') || ext('EXT_color_buffer_float')) return 'half';
  return null;
}

// ------------------------------------------------------------------------------------------------ shaders (GLSL ES 3.00: textureLod, so
// the FXAA branch needs no screen-space derivatives)

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// bright pass + 4x4 box downsample into level 0 (1/4 resolution). Each of the four taps is a bilinear fetch of a 2x2 block; the bright pass is
// applied per tap (a thin neon line must not average itself away) and the Karis weight 1/(1+luma) keeps one hot pixel from flickering.
// The bright pass keeps only the EXCESS over the threshold (a pixel at 1.2 with a threshold of 1.05 feeds the bloom 0.15, not 1.2: the old
// "pass the whole colour above a hard edge" bloomed every sunlit white line and chrome highlight at noon), through a quadratic soft knee so
// nothing switches on at an edge. Neon at night is many times over the threshold: it passes almost whole.
const FRAG_PREFILTER = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform vec2 uScale; uniform float uThreshold; uniform float uKnee;
in vec2 vUv;
out vec4 fragColor;
vec3 tap(vec2 p) {
  vec3 c = textureLod(tSrc, clamp(p, 0.5 * uTexel, uScale - 0.5 * uTexel), 0.0).rgb;
  float l = dot(c, vec3(0.2126729, 0.7151522, 0.0721750));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  return c * (max(soft, l - uThreshold) / max(l, 1e-4));
}
void main() {
  vec2 p = vUv * uScale;
  vec3 a = tap(p + vec2(-1.0, -1.0) * uTexel);
  vec3 b = tap(p + vec2( 1.0, -1.0) * uTexel);
  vec3 c = tap(p + vec2(-1.0,  1.0) * uTexel);
  vec3 d = tap(p + vec2( 1.0,  1.0) * uTexel);
  float wa = 1.0 / (1.0 + dot(a, vec3(0.3333)));
  float wb = 1.0 / (1.0 + dot(b, vec3(0.3333)));
  float wc = 1.0 / (1.0 + dot(c, vec3(0.3333)));
  float wd = 1.0 / (1.0 + dot(d, vec3(0.3333)));
  fragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
}`;

// dual-Kawase down: 5 taps; offsets of one SOURCE texel reach the corners of the 2x2 footprint
const FRAG_DOWN = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D tSrc; uniform vec2 uTexel;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 s = textureLod(tSrc, vUv, 0.0).rgb * 4.0;
  s += textureLod(tSrc, vUv + vec2(-uTexel.x, -uTexel.y), 0.0).rgb;
  s += textureLod(tSrc, vUv + vec2( uTexel.x, -uTexel.y), 0.0).rgb;
  s += textureLod(tSrc, vUv + vec2(-uTexel.x,  uTexel.y), 0.0).rgb;
  s += textureLod(tSrc, vUv + vec2( uTexel.x,  uTexel.y), 0.0).rgb;
  fragColor = vec4(s * 0.125, 1.0);
}`;

// dual-Kawase up: 8 taps, ADDED onto the level below it (additive blending), scaled by this level's weight. uTexel = half a source texel.
const FRAG_UP = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uWeight;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 h = uTexel;
  vec3 s = textureLod(tSrc, vUv + vec2(-h.x * 2.0, 0.0), 0.0).rgb;
  s += textureLod(tSrc, vUv + vec2(-h.x,  h.y), 0.0).rgb * 2.0;
  s += textureLod(tSrc, vUv + vec2(0.0,  h.y * 2.0), 0.0).rgb;
  s += textureLod(tSrc, vUv + vec2( h.x,  h.y), 0.0).rgb * 2.0;
  s += textureLod(tSrc, vUv + vec2( h.x * 2.0, 0.0), 0.0).rgb;
  s += textureLod(tSrc, vUv + vec2( h.x, -h.y), 0.0).rgb * 2.0;
  s += textureLod(tSrc, vUv + vec2(0.0, -h.y * 2.0), 0.0).rgb;
  s += textureLod(tSrc, vUv + vec2(-h.x, -h.y), 0.0).rgb * 2.0;
  fragColor = vec4(s * (uWeight / 12.0), 1.0);
}`;

// FXAA-lite on the HDR scene (edge detection on a perceptual luma, so a neon pixel does not dominate), bloom, ACES, sRGB, dither.
// Mirrors three's OutputShader: the same ACESFilmicToneMapping chunk and exposure, so the look is the old pipeline's.
const FRAG_COMPOSITE = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D tScene;
#ifdef BLOOM
uniform sampler2D tBloom; uniform float uBloom;
#endif
uniform vec2 uTexel; uniform vec2 uScale;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
in vec2 vUv;
out vec4 fragColor;
vec3 S(vec2 p) { return textureLod(tScene, clamp(p, 0.5 * uTexel, uScale - 0.5 * uTexel), 0.0).rgb; }
float L(vec3 c) { return dot(sqrt(c / (1.0 + c)), vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 p = vUv * uScale;
  vec3 m = S(p);
  #ifdef FXAA
  vec3 nw = S(p + vec2(-1.0, -1.0) * uTexel);
  vec3 ne = S(p + vec2( 1.0, -1.0) * uTexel);
  vec3 sw = S(p + vec2(-1.0,  1.0) * uTexel);
  vec3 se = S(p + vec2( 1.0,  1.0) * uTexel);
  float lM = L(m); float lNW = L(nw); float lNE = L(ne); float lSW = L(sw); float lSE = L(se);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin > max(0.045, lMax * 0.125)) {
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * (0.25 * 0.125), 1.0 / 128.0);
    float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
    dir = clamp(dir * rcp, vec2(-6.0), vec2(6.0)) * uTexel;
    vec3 a = 0.5 * (S(p + dir * (1.0 / 3.0 - 0.5)) + S(p + dir * (2.0 / 3.0 - 0.5)));
    vec3 b = a * 0.5 + 0.25 * (S(p + dir * -0.5) + S(p + dir * 0.5));
    float lB = L(b);
    m = (lB < lMin || lB > lMax) ? a : b;
  }
  #endif
  #ifdef BLOOM
  m += textureLod(tBloom, vUv, 0.0).rgb * uBloom;
  #endif
  m = ACESFilmicToneMapping(m);
  m = sRGBTransferOETF(vec4(m, 1.0)).rgb;
  // interleaved-gradient dither, +-0.5 LSB: hides the banding of the dark sky gradients in an 8-bit output
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  m += (n - 0.5) / 255.0;
  fragColor = vec4(m, 1.0);
}`;

// ------------------------------------------------------------------------------------------------ the pipeline

const triangle = () => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
};

/** Dispose the materials a renderer kept in its shared map (see createPost). */
export function disposeShared(shared) {
  for (const S of shared.values()) for (const m of Object.values(S.mats)) m.dispose();
  shared.clear();
}

/**
 * @param renderer  THREE.WebGLRenderer (toneMappingExposure is read from it, as OutputPass does; ACES is fixed here)
 * @param opts      { hdr: 'r11g11b10' | 'half' | null, bloomLevels: 0..5 (the pyramid is ALLOCATED for this many; setLevels() picks how many are drawn),
 *                    fxaa: boolean, msaa: number, bloomStrength, threshold, knee, radius, minScale, shared: Map }
 */
export function createPost(renderer, opts = {}) {
  const hdr = opts.hdr ?? null;
  const levels = hdr ? Math.max(0, Math.min(5, opts.bloomLevels ?? 0)) : 0; // allocated
  let active = levels; // used right now (0 = the composite without bloom): a tier step changes this, never the allocation
  const fxaa = opts.fxaa !== false;
  const msaa = Math.max(0, opts.msaa | 0);
  const radius = opts.radius ?? 0.42;
  const weightsFor = [];
  for (let n = 0; n <= 5; n++) weightsFor.push(bloomWeights(Math.max(1, n), radius));
  let strength = opts.bloomStrength ?? 0.3;
  let scale = 1;
  const minScale = opts.minScale ?? 0.3; // a tier below the allocated one draws a fraction of it, and the governor's scale comes on top

  const geometry = triangle();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mesh = new Mesh(geometry, null);
  mesh.frustumCulled = false;

  const raw = (name, fragmentShader, uniforms, defines = {}) =>
    new RawShaderMaterial({ name, glslVersion: GLSL3, vertexShader: VERT, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false, blending: NoBlending });

  // the materials (and so the compiled programs) outlive a resize: opts.shared (a Map owned by the renderer) keeps one set per configuration,
  // otherwise every window-resize event would drop the four programs and compile them again
  const sharedKey = `${levels ? 'b' : 'n'}${fxaa ? 'f' : 'n'}`;
  let S = opts.shared && opts.shared.get(sharedKey);
  if (!S) {
    const U = {
      prefilter: { tSrc: { value: null }, uTexel: { value: new Vector2() }, uScale: { value: new Vector2(1, 1) }, uThreshold: { value: opts.threshold ?? 1.05 }, uKnee: { value: opts.knee ?? 0.3 } },
      down: { tSrc: { value: null }, uTexel: { value: new Vector2() } },
      up: { tSrc: { value: null }, uTexel: { value: new Vector2() }, uWeight: { value: 1 } },
      comp: {
        tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uTexel: { value: new Vector2() }, uScale: { value: new Vector2(1, 1) },
        toneMappingExposure: { value: 1 },
      },
    };
    const mats = {
      prefilter: raw('aw-bloom-prefilter', FRAG_PREFILTER, U.prefilter),
      down: raw('aw-bloom-down', FRAG_DOWN, U.down),
      up: raw('aw-bloom-up', FRAG_UP, U.up),
      comp: raw('aw-composite', FRAG_COMPOSITE, U.comp, { ...(fxaa ? { FXAA: '' } : {}), ...(levels ? { BLOOM: '' } : {}) }),
    };
    // the same composite without the bloom term, for a tier step that turns the glow off (same uniforms object; both programs are compiled up front)
    if (levels) mats.compPlain = raw('aw-composite-plain', FRAG_COMPOSITE, U.comp, { ...(fxaa ? { FXAA: '' } : {}) });
    Object.assign(mats.up, { blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor });
    S = { U, mats };
    opts.shared?.set(sharedKey, S);
  }
  const { U, mats } = S;

  let sceneRT = null;
  let mips = [];
  let W = 2;
  let H = 2;

  const target = (w, h, { depth = false, samples = 0 } = {}) => {
    const t = new WebGLRenderTarget(w, h, {
      // 'r11g11b10' is three's own packed float format (RGB + UnsignedInt101111Type (10F11F11F rev) -> R11F_G11F_B10F, 32 bit per pixel, no alpha)
      type: hdr === 'r11g11b10' ? UnsignedInt101111Type : hdr ? HalfFloatType : UnsignedByteType,
      format: hdr === 'r11g11b10' ? RGBFormat : RGBAFormat,
      depthBuffer: depth,
      stencilBuffer: false,
      samples,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
    });
    return t;
  };

  const freeTargets = () => {
    sceneRT?.dispose();
    for (const m of mips) m.dispose();
    sceneRT = null;
    mips = [];
  };

  function setScale(s) {
    scale = clampScale(s, minScale);
    const r = scaleRect(W, H, scale);
    if (sceneRT) sceneRT.viewport.set(0, 0, r.w, r.h);
    U.comp.uScale.value.set(r.u, r.v);
    U.prefilter.uScale.value.set(r.u, r.v);
  }

  /** Allocate for a drawing buffer of w x h pixels (CSS size x pixel ratio). */
  function setSize(w, h) {
    W = Math.max(2, Math.floor(w));
    H = Math.max(2, Math.floor(h));
    freeTargets();
    sceneRT = target(W, H, { depth: true, samples: msaa });
    mips = bloomSizes(W, H, levels).map((s) => target(s.w, s.h));
    U.comp.uTexel.value.set(1 / W, 1 / H);
    U.prefilter.uTexel.value.set(1 / W, 1 / H);
    setScale(scale);
  }

  const pass = (material, to) => {
    mesh.material = material;
    renderer.setRenderTarget(to);
    renderer.render(mesh, camera);
  };

  /** Draw `scene` through `camera3` and the whole chain onto the canvas. */
  function render(scene, camera3) {
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = true; // the scene pass clears colour + depth
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera3);
    renderer.autoClear = false; // every later pass overwrites (or, for the up-chain, adds to) what is already in its target

    const lv = active;
    const weights = weightsFor[lv];
    if (lv) {
      U.prefilter.tSrc.value = sceneRT.texture;
      pass(mats.prefilter, mips[0]);
      for (let i = 1; i < lv; i++) {
        U.down.tSrc.value = mips[i - 1].texture;
        U.down.uTexel.value.set(1 / mips[i - 1].width, 1 / mips[i - 1].height);
        pass(mats.down, mips[i]);
      }
      for (let i = lv - 2; i >= 0; i--) {
        U.up.tSrc.value = mips[i + 1].texture;
        U.up.uTexel.value.set(0.5 / mips[i + 1].width, 0.5 / mips[i + 1].height);
        U.up.uWeight.value = weights[i + 1] / weights[0];
        pass(mats.up, mips[i]);
      }
      U.comp.tBloom.value = mips[0].texture;
      U.comp.uBloom.value = bloomGain(strength, lv, radius);
    }
    U.comp.tScene.value = sceneRT.texture;
    U.comp.toneMappingExposure.value = renderer.toneMappingExposure;
    pass(lv || !mats.compPlain ? mats.comp : mats.compPlain, null);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
  }

  /** Start compiling the four shaders now (in parallel where the browser allows it) so the first frame does not stall on them. */
  function warm() {
    const camera3 = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    for (const m of Object.values(mats)) {
      try {
        renderer.compile(new Mesh(geometry, m), camera3);
      } catch {
        /* compiled lazily on first use instead */
      }
    }
  }

  function dispose() {
    freeTargets();
    if (!opts.shared) for (const m of Object.values(mats)) m.dispose();
    geometry.dispose();
  }

  return {
    setSize,
    setScale,
    render,
    warm,
    dispose,
    setBloom(k) {
      strength = Math.max(0, k);
    },
    /** The bright pass's threshold (HDR luma): see bloomThreshold(night). */
    setThreshold(t) {
      U.prefilter.uThreshold.value = Math.max(0.5, t);
    },
    /** How many pyramid levels are drawn (0..allocated; 0 = no bloom at all). No allocation, no new program. */
    setLevels(n) {
      active = Math.max(0, Math.min(levels, n | 0));
      return active;
    },
    get activeLevels() {
      return active;
    },
    get scale() {
      return scale;
    },
    get size() {
      return { w: W, h: H };
    },
    get rect() {
      return scaleRect(W, H, scale);
    },
    get hdr() {
      return hdr;
    },
    get bloomLevels() {
      return levels;
    },
    /** For diagnostics (aw-probe): the scene target and the bloom pyramid. */
    get targets() {
      return { scene: sceneRT, mips };
    },
    mats,
  };
}
