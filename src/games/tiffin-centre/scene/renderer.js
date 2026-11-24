// WebGL renderer + (high quality) a small post pipeline: MSAA scene -> light bloom -> tone map. A frame-time sampler steps the quality
// down on slow devices (only when quality was 'auto'), the whole thing disposes cleanly and survives a lost WebGL context.
import {
  ACESFilmicToneMapping, HalfFloatType, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector2, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { QUALITY, createQualitySampler, lowerQuality } from './quality.js';

export function createRenderer(canvas, { quality = 'medium', auto = true, onQuality, onContextLost, onContextRestored } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: quality === 'low', powerPreference: 'high-performance', alpha: false });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.3, 160);

  let q = quality;
  // low quality uses plain MSAA-free direct rendering; medium and high go through the composer so they get MSAA; bloom is high only
  let composer = null;
  let bloom = null;
  let width = 2;
  let height = 2;
  let lost = false;
  const sampler = createQualitySampler();
  const listeners = new Set();

  const dpr = () => (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;

  const build = () => {
    const cfg = QUALITY[q];
    const pr = Math.min(cfg.pixelRatio, dpr());
    renderer.setPixelRatio(pr);
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = cfg.shadow > 0;
    composer?.dispose?.();
    composer = null;
    bloom = null;
    if (q === 'low') return;
    const target = new WebGLRenderTarget(width * pr, height * pr, { type: HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(pr);
    composer.setSize(width, height);
    composer.addPass(new RenderPass(scene, camera));
    if (cfg.bloom) {
      bloom = new UnrealBloomPass(new Vector2(width, height), 0.22, 0.5, 0.92);
      composer.addPass(bloom);
    }
    composer.addPass(new OutputPass());
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
      for (const m of ms) m.needsUpdate = true; // shadow on/off changes the shaders
    });
    for (const fn of listeners) fn(q);
    onQuality?.(q);
  };

  const render = (dt) => {
    if (lost) return;
    if (auto && sampler.push(dt) && q !== 'low') setQuality(lowerQuality(q));
    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
  };

  const onLost = (e) => {
    e.preventDefault(); // lets the browser restore the context
    lost = true;
    onContextLost?.();
  };
  const onRestored = () => {
    lost = false;
    build();
    onContextRestored?.();
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  const dispose = () => {
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
    composer?.dispose?.();
    composer = null;
    renderer.dispose();
    listeners.clear();
  };

  build();
  return {
    renderer,
    scene,
    camera,
    resize,
    render,
    dispose,
    setQuality,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get quality() { return q; },
    get cfg() { return QUALITY[q]; },
    get size() { return { w: width, h: height }; },
    get lost() { return lost; },
  };
}
