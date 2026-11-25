// WebGL renderer for the street stall: sRGB output, physically based lights, a procedural sky (sky.js) that doubles as image-based light, and a
// post pipeline (post.js) on medium and high: bloom, depth of field and occlusion (high), filmic tone map, daypart grade, FXAA / MSAA, grain and
// vignette. The frame-time sampler steps the quality down on slow devices (only when quality was 'auto'); the whole thing disposes cleanly and
// survives a lost WebGL context (targets are rebuilt, the sky light is re-rendered).
import {
  AgXToneMapping, NoToneMapping, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import { QUALITY, createQualitySampler, lowerQuality } from './quality.js';
import { createSky } from './sky.js';
import { createPost } from './post.js';

// the applier (light-apply.js) is built from the bare WebGLRenderer, so it finds the sky and the post pipeline through this registry
const registry = new WeakMap();
export const attachmentsOf = (renderer) => registry.get(renderer) || null;

export function createRenderer(canvas, { quality = 'medium', auto = true, onQuality, onContextLost, onContextRestored } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: quality === 'low', powerPreference: 'high-performance', alpha: false, stencil: false });
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
  const sampler = createQualitySampler();
  const listeners = new Set();

  const sky = createSky({ clouds: QUALITY[q].clouds, stars: QUALITY[q].stars });
  scene.add(sky.mesh);
  const post = createPost(renderer, scene, camera);

  const dpr = () => (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
  let pr = 1;

  const build = () => {
    const cfg = QUALITY[q];
    pr = Math.min(cfg.pixelRatio, dpr());
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

  const setQuality = (next) => {
    if (next === q) return;
    q = next;
    build();
    scene.traverse((o) => {
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) m.needsUpdate = true; // shadow / tone mapping changes the shaders
    });
    for (const fn of listeners) fn(q);
    onQuality?.(q);
  };

  let clock = 0;
  const render = (dt) => {
    if (lost) return;
    if (auto && sampler.push(dt) && q !== 'low') setQuality(lowerQuality(q));
    clock += dt;
    sky.follow(camera);
    if (QUALITY[q].post) post.render(dt);
    else renderer.render(scene, camera);
  };

  const onLost = (e) => {
    e.preventDefault(); // lets the browser restore the context
    lost = true;
    onContextLost?.();
  };
  const onRestored = () => {
    lost = false;
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
    /** Where the depth of field focuses, in metres from the eye (the nearest customer). */
    setFocus: (d) => post.setFocus(d),
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get quality() { return q; },
    get cfg() { return QUALITY[q]; },
    get size() { return { w: width, h: height }; },
    get lost() { return lost; },
    get time() { return clock; },
  };
  registry.set(renderer, api);
  return api;
}
