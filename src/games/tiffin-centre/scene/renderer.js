// WebGL renderer for the street stall: sRGB output, physically based lights, a procedural sky (sky.js) that doubles as image-based light, and a
// post pipeline (post.js) on medium and high: bloom, depth of field and occlusion (high), filmic tone map, daypart grade, FXAA / MSAA, grain and
// vignette.
//
// This file only DRAWS. What decides the resolution and the tier at run time is the shared frame governor (src/platform/gfx/governor.js), wired in index.js
// through createAdaptiveQuality + createLoop; it talks to this wrapper through two calls:
//   * `setScale(s)`: the render scale. On the tiers with a post pipeline it is free: every target is allocated once at its full size and the scene and the passes
//     render into the `s x s` sub-rect of them (post.js, gfx dynamicRes.js), so a step is a viewport and a few uniforms, never a setSize, never a recompile. The
//     direct tiers (lite / low) render straight to the canvas and re-size it (rare: a handful of steps a session);
//   * `setQuality(tier, reason, scale)`: a tier change (rebuilds the pipeline; the caller hides the shader compiles behind a held frame, see index.js).
// Point sprites are sized in pixels: with a dynamic scale every PointsMaterial size (and the steam shader's pixel factor) is multiplied by the scale so a halo keeps
// the same size on screen whatever the render resolution.
// A lost WebGL context pauses rendering and is rebuilt on restore; a context that cannot be created at all throws an error tagged `code: 'webgl'` (TiffinGame shows
// the "WebGL" status screen). The whole thing disposes cleanly.
import {
  AgXToneMapping, NoToneMapping, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import { createDynamicRes } from '../../../platform/gfx/dynamicRes.js';
import { probeBrowser } from './capabilities.js';
import { QUALITY, applyDeviceTweaks, shadowEveryFor, tierIndex } from './quality.js';
import { createSky } from './sky.js';
import { createPost } from './post.js';
import { programSort, skipDarkLights } from './gfx-tweaks.js';

// the applier (light-apply.js) is built from the bare WebGLRenderer, so it finds the sky and the post pipeline through this registry
const registry = new WeakMap();
export const attachmentsOf = (renderer) => registry.get(renderer) || null;

/** A WebGL2 context could not be created (blocked, out of contexts, no GPU, WebGL disabled). */
export class WebglUnavailableError extends Error {
  constructor(message, cause) {
    super(message || 'WebGL is not available');
    this.name = 'WebglUnavailableError';
    this.code = 'webgl';
    if (cause) this.cause = cause;
  }
}

/** new WebGLRenderer with one retry on a plainer context request (some drivers refuse high-performance / antialias requests). */
function makeRenderer(canvas, q) {
  let statusMessage = '';
  const onFail = (e) => {
    statusMessage = e?.statusMessage || statusMessage;
  };
  canvas.addEventListener?.('webglcontextcreationfailed', onFail, false);
  try {
    const cfg = QUALITY[q];
    const attempts = [
      { canvas, antialias: !!cfg.nativeAA, powerPreference: q === 'lite' ? 'default' : 'high-performance', alpha: false, stencil: false },
      { canvas, antialias: false, powerPreference: 'default', alpha: false, stencil: false, depth: true },
    ];
    let last = null;
    for (const attrs of attempts) {
      try {
        return new WebGLRenderer(attrs);
      } catch (err) {
        last = err;
      }
    }
    throw new WebglUnavailableError(statusMessage || last?.message || 'Error creating WebGL context.', last);
  } finally {
    canvas.removeEventListener?.('webglcontextcreationfailed', onFail, false);
  }
}

/**
 * The point-sprite sizes at a render scale: every PointsMaterial (the glow halos, the dust, the rain) keeps `userData.tcBaseSize`, the size it was made with, and is
 * set to `base * scale`. Idempotent and allocation-free once the materials are known; returns how many it touched. `scene.traverse` is the whole scan.
 */
export function applyPointScale(root, scale) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isPoints) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (!m || !m.isPointsMaterial) continue;
      if (m.userData.tcBaseSize === undefined) m.userData.tcBaseSize = m.size;
      const want = m.userData.tcBaseSize * scale;
      if (Math.abs(m.size - want) > 1e-9) {
        m.size = want;
        n++;
      }
    }
  });
  return n;
}

export function createRenderer(canvas, { quality = 'medium', onQuality, onScale, onContextLost, onContextRestored } = {}) {
  let undoTweaks = () => {};
  try {
    undoTweaks = applyDeviceTweaks(probeBrowser()); // forced 'high' on an integrated GPU: FXAA instead of 4x MSAA (see quality.js deviceTweaks)
  } catch {
    /* no probe: the table stays as designed */
  }
  const releaseLightSkip = skipDarkLights(); // before the first program compiles: a dark point light costs a distance test, not a PBR evaluation
  let renderer;
  try {
    renderer = makeRenderer(canvas, quality);
  } catch (err) {
    releaseLightSkip();
    undoTweaks();
    throw err;
  }
  const sorter = programSort(renderer); // opaque draws grouped by shader program: far fewer program switches (and lighting uniform uploads) per frame
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(0x10131c, 1);

  const scene = new Scene();
  // first person: the cook's eyes at (x, 1.55, 0) looking -z. The rig sets the real fov; near is small because the hands live right in front of the lens.
  const camera = new PerspectiveCamera(74, 1, 0.08, 700);
  camera.position.set(0, 1.55, 0);

  let q = quality;
  let width = 2;
  let height = 2;
  let lost = false;
  let scale = 1; // the render scale the governor asked for (1 = the tier's full resolution)
  renderer.info.autoReset = false; // the post passes render several times a frame: count the whole frame, reset it ourselves in render()
  // compile() / compileAsync() bind the HDR scene target when the tier has post and nothing else is bound: the output colour space is part of the program key, so
  // programs compiled against the canvas (as the loader does) are never used by the frame and the real ones would compile mid-shift
  const rawCompile = renderer.compile.bind(renderer);
  const rawCompileAsync = renderer.compileAsync?.bind(renderer);
  for (const name of ['compile', 'compileAsync']) {
    const orig = renderer[name]?.bind(renderer);
    if (!orig) continue;
    renderer[name] = (...args) => {
      const rt = QUALITY[q]?.post ? post.sceneTarget : null;
      if (!rt || renderer.getRenderTarget()) return orig(...args);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      try {
        return orig(...args);
      } finally {
        renderer.setRenderTarget(prev);
      }
    };
  }
  const listeners = new Set();
  const scaleListeners = new Set();
  const lastTier = { from: null, reason: '' };

  const dyn = createDynamicRes({ scale: 1, min: 0.25 });
  const sky = createSky({ clouds: QUALITY[q].clouds, stars: QUALITY[q].stars });
  scene.add(sky.mesh);
  const post = createPost(renderer, scene, camera, { dyn });

  const dpr = () => (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 && devicePixelRatio) || 1;
  let pr = 1; // the canvas pixel ratio: the tier's, capped by the device's (post tiers); times the scale on the direct tiers
  let builtPr = 0;
  let builtW = 0;
  let builtH = 0;
  let shadowDirty = true; // the shadow map is (re)drawn on the next frame
  let shadowTick = 0;
  let shadowInterval = 1;
  let dtAvg = 1 / 60; // smoothed frame time: decides how often the shadow map is redrawn (see render())
  let pointFrames = 0;

  /** The scale that applies to the PICTURE on this tier: dynamic (viewport) on the post tiers, 1 on the direct tiers (their canvas is re-sized instead). */
  const viewScaleOf = (cfg) => (cfg.post ? scale : 1);
  const syncPoints = () => {
    const vs = viewScaleOf(QUALITY[q]);
    renderer.tcViewScale = vs; // read by the steam shader (models/shaders/steam.js)
    applyPointScale(scene, vs);
  };

  // only touch the canvas when its size really changes (a resize of the drawing buffer reallocates the swap chain AND clears it: the picture goes blank until the
  // next draw, which is why a tier change that is still compiling its shaders keeps the old size until `commitCanvas`)
  let canvasPending = false;
  const sizeCanvas = () => {
    canvasPending = false;
    if (pr !== builtPr || width !== builtW || height !== builtH) {
      renderer.setPixelRatio(pr);
      renderer.setSize(width, height, false);
      builtPr = pr;
      builtW = width;
      builtH = height;
    }
  };

  const build = (deferCanvas = false) => {
    const cfg = QUALITY[q];
    const base = Math.max(0.25, Math.min(cfg.pixelRatio, dpr()));
    pr = cfg.post ? base : Math.max(0.25, base * scale);
    if (deferCanvas) canvasPending = true;
    else sizeCanvas();
    shadowDirty = true;
    renderer.shadowMap.enabled = cfg.shadow > 0;
    renderer.toneMapping = cfg.post ? NoToneMapping : AgXToneMapping; // with post the pipeline tone-maps; without it the materials do
    sky.setTier(cfg.clouds, cfg.stars);
    dyn.setScale(cfg.post ? scale : 1);
    if (cfg.post) post.build(cfg, width, height, pr);
    else post.release(); // a tier without post keeps none of the HDR / bloom / FXAA targets (8 to 30 MB at 1080p)
    syncPoints();
  };

  /**
   * Gives back GPU memory that the current tier does not need (a memory warning, see index.js): the post targets of a tier without post, the shadow map of a tier without
   * shadows, the render lists. Everything is made again on demand; nothing visible changes.
   */
  const releaseMemory = () => {
    const cfg = QUALITY[q];
    if (!cfg.post) post.release();
    renderer.renderLists?.dispose?.(); // (the sun's shadow map lives on the light: light-apply.js releases it when a tier has no shadows)
    return { post: !!cfg.post };
  };

  const resize = (w, h) => {
    width = Math.max(2, Math.floor(w));
    height = Math.max(2, Math.floor(h));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    build();
  };

  /**
   * A tier change: everything the new tier's shaders depend on is set NOW (tone mapping, shadows, the post targets, the lights through the change listeners), so the
   * programs can be compiled for it; with `{ defer: true }` the canvas keeps its size (and so its last picture) until `commitCanvas()`: index.js hides the compiles
   * of a tier switch behind a held frame instead of freezing the page.
   */
  const setQuality = (next, reason = '', nextScale, { defer = false } = {}) => {
    if (next === q || !QUALITY[next]) return;
    lastTier.from = q;
    lastTier.reason = reason;
    q = next;
    if (nextScale > 0) scale = Math.max(0.25, Math.min(1, nextScale));
    build(defer);
    scene.traverse((o) => {
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) m.needsUpdate = true; // shadow / tone mapping changes the shaders
    });
    for (const fn of listeners) fn(q);
    onQuality?.(q, reason);
  };

  /**
   * The render scale (0.25 to 1). Free on the post tiers (a viewport and uniforms: no setSize, no target re-creation, no program change); the direct tiers re-size
   * the canvas. Returns true when the scale changed.
   */
  const setScale = (s) => {
    let next = Math.max(0.25, Math.min(1, s));
    // a direct tier (lite / low) re-sizes the canvas on every step (2 to 7 ms, a blank frame): it only follows the governor in tenths, not in the post tiers' 0.05 rungs
    if (!QUALITY[q].post) next = Math.max(0.25, Math.round(next * 10) / 10);
    if (Math.abs(next - scale) < 1e-4) return false;
    scale = next;
    if (QUALITY[q].post) {
      dyn.setScale(scale);
      syncPoints();
    } else build();
    for (const fn of scaleListeners) fn(scale);
    onScale?.(scale);
    return true;
  };

  /** Applies the canvas size a deferred tier change was holding back (a no-op when there is none). */
  const commitCanvas = () => {
    if (canvasPending) sizeCanvas();
  };

  let clock = 0;
  const render = (dt) => {
    if (lost) return;
    if (canvasPending) sizeCanvas(); // a draw always goes to a canvas of the size the pipeline was built for
    clock += dt;
    sorter.tick();
    renderer.info.reset();
    sky.follow(camera);
    // the shadow map of the static stall does not need redrawing at the full frame rate: when frames are already late it is refreshed every 2nd / 3rd frame
    // (the sun moves in hours, the casters that move are a few people; one frame of lag is a centimetre)
    const sm = QUALITY[q];
    if (sm.shadow > 0) {
      if (dt > 0 && dt < 0.5) dtAvg += (dt - dtAvg) * 0.05;
      renderer.shadowMap.autoUpdate = false;
      shadowInterval = shadowEveryFor(sm, dtAvg, shadowInterval);
      if (shadowDirty || ++shadowTick >= shadowInterval) {
        renderer.shadowMap.needsUpdate = true;
        shadowDirty = false;
        shadowTick = 0;
      }
    }
    // materials made after the last scan (the rain, an event's glow) get their sprite size within a second
    if (sm.post && scale < 1 - 1e-4 && ++pointFrames >= 60) {
      pointFrames = 0;
      applyPointScale(scene, scale);
    }
    if (sm.post) post.render(dt);
    else renderer.render(scene, camera);
  };

  const onLost = (e) => {
    e.preventDefault(); // lets the browser restore the context
    lost = true;
    onContextLost?.();
  };
  const onRestored = () => {
    lost = false;
    shadowDirty = true;
    builtPr = 0; // the drawing buffer is new
    builtW = 0;
    sky.markEnvDirty();
    build();
    onContextRestored?.();
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  const dispose = () => {
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
    scene.remove(sky.mesh);
    post.dispose();
    sky.dispose();
    registry.delete(renderer);
    sorter.dispose();
    releaseLightSkip();
    undoTweaks();
    renderer.dispose();
    listeners.clear();
    scaleListeners.clear();
  };

  build();
  const api = {
    renderer,
    scene,
    camera,
    sky,
    post,
    dyn,
    resize,
    render,
    dispose,
    setQuality,
    commitCanvas,
    releaseMemory,
    setScale,
    /** The renderer's own compile functions, without the "bind the HDR target" wrapper (a caller that binds its own target, post.prelink, needs these). */
    rawCompile,
    rawCompileAsync,
    /** Where the depth of field focuses, in metres from the eye (the nearest customer). */
    setFocus: (d) => post.setFocus(d),
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onScaleChange: (fn) => {
      scaleListeners.add(fn);
      return () => scaleListeners.delete(fn);
    },
    /** Replaced by index.js with the governor's hold; a no-op until then (tests, tooling that builds a bare renderer). */
    holdAdaptation() {},
    get quality() { return q; },
    get cfg() { return QUALITY[q]; },
    get size() { return { w: width, h: height }; },
    get lost() { return lost; },
    get time() { return clock; },
    /** The render scale in force (1 = full). */
    get scale() { return scale; },
    /** Device pixels per css pixel of the PICTURE that is rendered (tier ratio x scale): what the old resolution scaler changed. */
    get pixelRatio() { return QUALITY[q].post ? pr * scale : pr; },
    /** The canvas's own pixel ratio (the allocation: it does not move with the render scale on the post tiers). */
    get canvasRatio() { return pr; },
    /** Scale that applies to the picture (point sprite sizes, particle pixel factors): the render scale on the post tiers, 1 on the direct ones. */
    get viewScale() { return viewScaleOf(QUALITY[q]); },
    get lastDowngrade() { return lastTier; },
    get tierIndex() { return tierIndex(q); },
  };
  registry.set(renderer, api);
  return api;
}
