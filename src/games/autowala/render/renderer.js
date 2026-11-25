// WebGL renderer + the post pipeline (MSAA scene -> bloom -> tone map), built to degrade instead of fail:
//  - no WebGL2 at all            -> createRenderer throws a WebglUnsupported error (the screen shows a friendly message)
//  - no half-float render target -> an 8-bit pipeline (tone mapping still runs, very bright pixels just clip)
//  - the post pipeline throws    -> one simpler attempt, then plain direct rendering (no bloom / MSAA)
//  - software rendering (SwiftShader, llvmpipe, ...) -> starts on 'low'
//  - the GPU context is lost     -> the loop pauses; on restore the pipeline is rebuilt
// A frame-time sampler steps the quality down (never up in the same session) when the device cannot hold ~40 fps.
import {
  ACESFilmicToneMapping,
  HalfFloatType,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { QUALITY } from '../game/config.js';
import { setAnisotropyCap } from './textures.js';

const ORDER = ['low', 'medium', 'high'];

export class WebglUnsupported extends Error {
  constructor(message = 'WebGL 2 is not available') {
    super(message);
    this.name = 'WebglUnsupported';
  }
}

export function pickQuality(saved) {
  if (ORDER.includes(saved)) return saved;
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const mobile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const memory = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 8; // Chromium only
  if (mobile || memory <= 2) return 'low';
  return cores >= 8 && memory >= 8 ? 'high' : 'medium';
}

/** Is this a software rasteriser (no real GPU)? Reads the unmasked renderer string where the browser allows it. */
export function isSoftwareRenderer(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software|softpipe|basic render/i.test(name);
  } catch {
    return false;
  }
}

export function createRenderer(canvas, { quality = 'medium', explicit = false, onQuality, onContext } = {}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (err) {
    throw new WebglUnsupported(err?.message);
  }
  const gl = renderer.getContext();
  if (!gl || typeof gl.getParameter !== 'function') throw new WebglUnsupported();
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const software = isSoftwareRenderer(gl);
  const halfFloat = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  const maxSamples = renderer.capabilities.maxSamples || 0;
  const maxAniso = renderer.capabilities.getMaxAnisotropy?.() || 1;

  const scene = new Scene();
  const camera = new PerspectiveCamera(62, 1, 0.3, 1000);

  let q = software && !explicit ? 'low' : quality;
  let composer = null;
  let bloom = null;
  let width = 1;
  let height = 1;
  let lost = false;
  let simple = false; // set when the full pipeline failed once

  const disposeComposer = () => {
    try {
      composer?.dispose?.();
    } catch {
      /* already gone with the context */
    }
    composer = null;
    bloom = null;
  };

  const build = () => {
    const cfg = QUALITY[q];
    setAnisotropyCap(q === 'low' ? 2 : Math.min(maxAniso, q === 'medium' ? 4 : 8));
    renderer.setPixelRatio(Math.min(cfg.pixelRatio, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1.5));
    renderer.setSize(width, height, false);
    disposeComposer();
    const full = !simple;
    try {
      const target = new WebGLRenderTarget(width, height, {
        type: halfFloat && full ? HalfFloatType : UnsignedByteType,
        samples: q === 'low' || !full ? 0 : Math.min(4, maxSamples),
      });
      composer = new EffectComposer(renderer, target);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
      composer.addPass(new RenderPass(scene, camera));
      if (cfg.bloom && full && halfFloat) {
        bloom = new UnrealBloomPass(new Vector2(width, height), 0.3, 0.42, 1.05);
        composer.addPass(bloom);
      }
      composer.addPass(new OutputPass());
    } catch (err) {
      console.warn('[autowala] post-processing unavailable, using a simpler pipeline', err);
      disposeComposer();
      if (full) {
        simple = true;
        build();
      }
      // else: composer stays null and render() draws the scene directly
    }
  };

  const resize = (w, h) => {
    width = Math.max(2, Math.floor(w));
    height = Math.max(2, Math.floor(h));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!lost) build();
  };

  // a lost GPU context (driver reset, too many tabs, mobile backgrounding): stop drawing, rebuild when it comes back
  const onLost = (e) => {
    e.preventDefault();
    lost = true;
    onContext?.('lost');
  };
  const onRestored = () => {
    lost = false;
    build();
    onContext?.('restored');
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  // frame-time sampler: ~2 s of slow frames drops one quality step
  let slow = 0;
  let sampled = 0;
  const sample = (dt) => {
    sampled += dt;
    if (dt > 0.032) slow += dt;
    if (sampled < 2) return;
    const bad = slow / sampled > 0.55;
    slow = 0;
    sampled = 0;
    const i = ORDER.indexOf(q);
    if (bad && i > 0) {
      q = ORDER[i - 1];
      build();
      onQuality?.(q);
    }
  };

  const render = (dt) => {
    if (lost) return;
    sample(dt);
    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
  };

  const setBloom = (strength) => {
    if (bloom) bloom.strength = strength;
  };

  const dispose = () => {
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
    disposeComposer();
    renderer.dispose();
    renderer.forceContextLoss?.(); // hand the GPU context back now: browsers allow only ~16 live ones
  };

  return {
    renderer,
    scene,
    camera,
    resize,
    render,
    setBloom,
    dispose,
    caps: { software, halfFloat, maxSamples, maxAniso, webgl2: !!renderer.capabilities.isWebGL2 },
    get quality() {
      return q;
    },
    get cfg() {
      return QUALITY[q];
    },
    get lost() {
      return lost;
    },
  };
}
