// WebGL renderer for the street stall: sRGB output, physically based lights, a procedural sky (sky.js) that doubles as image-based light, and a
// post pipeline (post.js) on medium and high: bloom, depth of field and occlusion (high), filmic tone map, daypart grade, FXAA / MSAA, grain and
// vignette.
//
// Runtime adaptation (all on the render path, allocation-free per frame):
//   * dynamic resolution: a rolling frame-time window scales the render resolution from 1.0 down to the tier's floor and back up (hysteresis in
//     quality.js createScaler), and only when scaling cannot help any more steps the TIER down (auto quality only; the tier never goes up again);
//   * `shouldRender(nowMs)` implements the tier's frame cap (30 fps on lite);
//   * a lost WebGL context pauses rendering and is rebuilt on restore; a context that cannot be created at all throws an error tagged
//     `code: 'webgl'` (TiffinGame shows the "WebGL" status screen).
// The whole thing disposes cleanly.
import {
  AgXToneMapping, NoToneMapping, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import { QUALITY, createScaler, createDrawCallGuard, frameBudgetFor, lowerQuality, tierIndex } from './quality.js';
import { createSky } from './sky.js';
import { createPost } from './post.js';

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

export function createRenderer(canvas, { quality = 'medium', auto = true, onQuality, onScale, onContextLost, onContextRestored } = {}) {
  const renderer = makeRenderer(canvas, quality);
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
  let scale = 1; // dynamic resolution factor on top of the tier's pixel ratio
  const makeScaler = () => {
    const c = QUALITY[q];
    const s = createScaler({ budget: frameBudgetFor(c), min: c.scaleMin ?? 0.5 });
    s.restart(1);
    return s;
  };
  let scaler = makeScaler();
  const drawGuard = createDrawCallGuard(); // a tier that stays over its draw-call budget while missing the frame budget steps down (auto only)
  renderer.info.autoReset = false; // the post passes render several times a frame: count the whole frame, reset it ourselves in render()
  const listeners = new Set();
  const scaleListeners = new Set();
  const lastTier = { from: null, reason: '' };
  let warmUp = 2.5; // seconds of frames ignored after a start / tier change (shader compiles, texture uploads)
  let lastRenderAt = -1e9;

  const sky = createSky({ clouds: QUALITY[q].clouds, stars: QUALITY[q].stars });
  scene.add(sky.mesh);
  const post = createPost(renderer, scene, camera);

  const dpr = () => (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 && devicePixelRatio) || 1;
  let pr = 1;

  const build = () => {
    const cfg = QUALITY[q];
    pr = Math.max(0.25, Math.min(cfg.pixelRatio, dpr()) * scale);
    renderer.setPixelRatio(pr);
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = cfg.shadow > 0;
    renderer.toneMapping = cfg.post ? NoToneMapping : AgXToneMapping; // with post the pipeline tone-maps; without it the materials do
    sky.setTier(cfg.clouds, cfg.stars);
    if (cfg.post) post.build(cfg, width, height, pr);
  };

  const resize = (w, h) => {
    width = Math.max(2, Math.floor(w));
    height = Math.max(2, Math.floor(h));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    build();
  };

  const setQuality = (next, reason = '') => {
    if (next === q || !QUALITY[next]) return;
    lastTier.from = q;
    lastTier.reason = reason;
    q = next;
    scale = 1;
    scaler = makeScaler();
    drawGuard.reset();
    warmUp = 2.5;
    build();
    scene.traverse((o) => {
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) m.needsUpdate = true; // shadow / tone mapping changes the shaders
    });
    for (const fn of listeners) fn(q);
    onQuality?.(q, reason);
  };

  const setScale = (s) => {
    const next = Math.max(0.25, Math.min(1, s));
    if (Math.abs(next - scale) < 1e-4) return;
    scale = next;
    build();
    for (const fn of scaleListeners) fn(scale);
    onScale?.(scale);
  };

  /** The tier's frame cap: false when this rAF callback should be skipped. */
  const shouldRender = (nowMs) => {
    const cap = QUALITY[q].fpsCap;
    if (!cap) return true;
    if (nowMs - lastRenderAt < 1000 / cap - 3) return false;
    lastRenderAt = nowMs;
    return true;
  };

  let clock = 0;
  const render = (dt) => {
    if (lost) return;
    clock += dt;
    renderer.info.reset();
    if (warmUp > 0) warmUp -= Math.min(dt, 1);
    else if (dt > 0 && dt < 1) {
      const verdict = scaler.push(dt);
      if (verdict?.scale) setScale(verdict.scale);
      else if (verdict?.tier && auto && q !== 'lite') setQuality(lowerQuality(q), `frame time ${(dt * 1000).toFixed(0)} ms at scale ${scale.toFixed(2)}`);
      else if (verdict?.tier && q === 'lite') scaler.restart(scale); // nothing lower than lite: keep the floor scale and stop asking
    }
    sky.follow(camera);
    if (QUALITY[q].post) post.render(dt);
    else renderer.render(scene, camera);
    if (warmUp <= 0 && auto && dt > 0 && drawGuard.push(dt, renderer.info.render.calls, q, frameBudgetFor(QUALITY[q]))) {
      setQuality(lowerQuality(q), `${renderer.info.render.calls} draw calls per frame over the ${q} budget with frame time ${(dt * 1000).toFixed(0)} ms`);
    }
  };

  const onLost = (e) => {
    e.preventDefault(); // lets the browser restore the context
    lost = true;
    onContextLost?.();
  };
  const onRestored = () => {
    lost = false;
    warmUp = 2.5;
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
    resize,
    render,
    dispose,
    setQuality,
    setScale,
    shouldRender,
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
    /** Ignore the next `sec` seconds of frame times (after a long load or a tab switch). */
    holdAdaptation(sec = 2.5) {
      warmUp = Math.max(warmUp, sec);
    },
    get quality() { return q; },
    get cfg() { return QUALITY[q]; },
    get size() { return { w: width, h: height }; },
    get lost() { return lost; },
    get time() { return clock; },
    get scale() { return scale; },
    get pixelRatio() { return pr; },
    get lastDowngrade() { return lastTier; },
    get tierIndex() { return tierIndex(q); },
  };
  registry.set(renderer, api);
  return api;
}
