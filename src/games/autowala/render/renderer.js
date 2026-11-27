// WebGL renderer + the lean post pipeline (scene -> HDR target -> dual-Kawase bloom -> one FXAA / tone-map composite, see ./post.js),
// built to degrade instead of fail:
//  - no WebGL2 at all            -> createRenderer throws a WebglUnsupported error (the screen shows a friendly message)
//  - no HDR render target        -> an 8-bit pipeline (tone mapping and FXAA still run, very bright pixels just clip, no bloom)
//  - the post shaders fail       -> plain direct rendering (no bloom / FXAA, tone mapping by the renderer itself)
//  - software rendering (SwiftShader, llvmpipe, ...) -> starts on 'low'
//  - the GPU context is lost     -> the loop pauses; on restore the pipeline is rebuilt
// A frame-time sampler steps the quality down (never up in the same session) when the device cannot hold ~40 fps; a shared governor
// can switch it off (`gfx.autoTier = false`) and drive `gfx.setScale(s)` instead.
//
// What the game reads: gfx.renderer / scene / camera / render(dt) / resize(w, h) / quality / cfg / caps / lost / dispose();
// gfx.setScale(s) (render resolution 0.5..1, free: no reallocation), gfx.scale, gfx.cost (whole-frame draw calls, triangles, programs...),
// gfx.invalidateShadows() (the shadow map is re-rendered on a schedule, not every frame; call it after a teleport).
import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, UnsignedByteType, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three';
import { QUALITY } from '../game/config.js';
import { setChunkSize } from './chunks.js';
import { clampScale, createPost, disposeShared, pickHdrFormat } from './post.js';
import { setAnisotropyCap } from './textures.js';

const ORDER = ['low', 'medium', 'high'];

export class WebglUnsupported extends Error {
  constructor(message = 'WebGL 2 is not available') {
    super(message);
    this.name = 'WebglUnsupported';
  }
}

/** A tier's settings, with the optional experiment overrides of the perf probe (globalThis.__awTune = { medium: { chunk: 1024 } }). */
const tier = (q) => (globalThis.__awTune && globalThis.__awTune[q] ? { ...QUALITY[q], ...globalThis.__awTune[q] } : QUALITY[q]);

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

/**
 * Should the shadow map be re-rendered on this frame? Time-based so a slow frame never skips twice: `interval` seconds between updates
 * (0 = every frame), `since` = seconds since the last one, `dirty` forces it.
 */
export function shadowDue(since, interval, dirty = false) {
  return dirty || interval <= 0 || since >= interval - 1e-4;
}

/**
 * A comparator for WebGLRenderer.setOpaqueSort: group order, render order, then the shader PROGRAM (so draws that share one run back to
 * back), then the material, then front to back. `programOf(material)` -> a number.
 */
export function opaqueByProgram(programOf) {
  return (a, b) => {
    if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
    if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
    if (a.material !== b.material) {
      const pa = programOf(a.material);
      const pb = programOf(b.material);
      if (pa !== pb) return pa - pb;
      if (a.material.id !== b.material.id) return a.material.id - b.material.id;
    }
    if (a.materialVariant !== b.materialVariant) return a.materialVariant - b.materialVariant;
    if (a.z !== b.z) return a.z - b.z;
    return a.id - b.id;
  };
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
  renderer.toneMapping = ACESFilmicToneMapping; // used by the direct fallback; the post composite applies the same ACES itself
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // re-rendered on a schedule (see render())
  renderer.info.autoReset = false; // the post chain renders ~10 times a frame: reset once per frame so info.render is the WHOLE frame
  const info = renderer.info;

  const software = isSoftwareRenderer(gl);
  const hdrFormat = pickHdrFormat(renderer);
  const halfFloat = !!hdrFormat;
  const maxSamples = renderer.capabilities.maxSamples || 0;
  const maxAniso = renderer.capabilities.getMaxAnisotropy?.() || 1;

  const scene = new Scene();
  const camera = new PerspectiveCamera(62, 1, 0.3, 1000);

  let q = software && !explicit ? 'low' : quality;
  setChunkSize(tier(q).chunk ?? 256); // the world is built right after this, in tiles of that size
  let post = null;
  const postShared = new Map(); // the post chain's materials survive a resize (their programs stay compiled)
  let scale = 1;
  let width = 1;
  let height = 1;
  const canvasSize = new Vector2();
  let lost = false;
  let simple = false; // set when the post pipeline failed once: 8-bit, no bloom
  let direct = false; // set when even that failed: plain renderer.render
  let shaderFailed = false;
  let warm = 4; // seconds of grace after a (re)build before the sampler may judge the frame time (shader compiles, first uploads)
  let autoTier = true;
  let shadowSince = 1;
  let shadowDirty = true;

  // a post shader that does not compile must not leave a black canvas: fall back on the next frame
  // (setting onShaderError replaces three's own error report, so log here too, and only blame the post chain for ITS shaders)
  renderer.debug.onShaderError = (g, program, vs, fs) => {
    let src = '';
    let log = '';
    try {
      src = g.getShaderSource(fs) || '';
      log = `${g.getShaderInfoLog(vs) || ''}\n${g.getShaderInfoLog(fs) || ''}\n${g.getProgramInfoLog(program) || ''}`.trim();
    } catch {
      /* context gone */
    }
    console.error('[autowala] shader failed to compile or link', log.slice(0, 600));
    if (/\btSrc\b|\btScene\b/.test(src)) shaderFailed = true;
  };

  // ---- whole-frame cost, filled at the end of every frame (read it through gfx.cost)
  const cost = { calls: 0, triangles: 0, lines: 0, points: 0, shadowCalls: 0, shadowTriangles: 0, programs: 0, geometries: 0, textures: 0, passes: 0, scale: 1 };
  const sm = renderer.shadowMap;
  const shadowRender = sm.render.bind(sm);
  sm.render = (lights, sc, cam) => {
    const c0 = info.render.calls;
    const t0 = info.render.triangles;
    shadowRender(lights, sc, cam);
    if (info.render.calls > c0) {
      cost.shadowCalls = info.render.calls - c0;
      cost.shadowTriangles = info.render.triangles - t0;
    }
  };

  // Opaque draw order: three sorts by material id, which interleaves the PROGRAMS (a program switch re-uploads the whole light state and
  // the camera uniforms: ~100 GL calls; 71 switches a frame with ~100 material switches). Sort by program first, then material, then
  // front to back. (Sky dome: renderOrder 10000, still last.)
  const programOf = (m) => {
    const p = renderer.properties.get(m);
    return p && p.currentProgram ? p.currentProgram.id : 0;
  };
  renderer.setOpaqueSort(opaqueByProgram(programOf));

  const disposePost = () => {
    try {
      post?.dispose();
    } catch {
      /* already gone with the context */
    }
    post = null;
  };

  const build = () => {
    const cfg = tier(q);
    setAnisotropyCap(q === 'low' ? 2 : Math.min(maxAniso, q === 'medium' ? 4 : 8));
    // assigning canvas.width / height reallocates the drawing buffer even when the value is the same (hundreds of ms on some drivers):
    // only touch the canvas when its size or pixel ratio really changes (a tier step with the same ratio, a rebuild after a context loss)
    const ratio = Math.min(cfg.pixelRatio, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1.5);
    if (ratio !== renderer.getPixelRatio()) renderer.setPixelRatio(ratio);
    renderer.getSize(canvasSize);
    if (canvasSize.x !== width || canvasSize.y !== height) renderer.setSize(width, height, false);
    disposePost();
    shaderFailed = false;
    warm = 4;
    shadowDirty = true; // the tier may have changed the shadow-map size
    if (direct || cfg.post === false) return; // (cfg.post === false: experiment / test of the direct fallback)
    const full = !simple;
    try {
      const pr = renderer.getPixelRatio();
      post = createPost(renderer, {
        hdr: full && cfg.hdr !== 'none' ? hdrFormat : null, // (cfg.hdr === 'none': experiment / test of the 8-bit fallback)
        bloomLevels: full && cfg.bloom ? cfg.bloomLevels ?? 4 : 0,
        fxaa: cfg.fxaa !== false,
        msaa: full ? Math.min(cfg.msaa || 0, maxSamples) : 0,
        bloomStrength: 0.3,
        shared: postShared,
      });
      post.setSize(width * pr, height * pr);
      post.setScale(scale);
      post.warm();
    } catch (err) {
      console.warn('[autowala] post-processing unavailable, using a simpler pipeline', err);
      disposePost();
      if (full) {
        simple = true;
        build();
      } else {
        direct = true; // render() draws the scene directly
      }
    }
  };

  build(); // a 2 x 2 pipeline right now: its shaders compile during loading (resize() re-allocates the targets, the programs stay cached)

  // The first real frame (game/Game.js draws one while the loading screen is still up, after game/warm.js built the programs for the
  // render target the game draws into) is preceded by ONE draw of the whole scene into a 16 x 9 target with culling off: every vertex /
  // instance buffer and canvas texture (every map tile, every shop sign) is uploaded and the shadow-depth programs are compiled NOW, not
  // when the player first drives past them. (The warm-up draws only the first view.)
  let prewarmed = false;
  const prewarm = () => {
    prewarmed = true;
    const culled = [];
    const tiny = new WebGLRenderTarget(16, 9, { type: UnsignedByteType, depthBuffer: true });
    try {
      scene.traverse((o) => {
        if (o.frustumCulled) {
          culled.push(o);
          o.frustumCulled = false;
        }
      });
      sm.needsUpdate = true;
      renderer.setRenderTarget(tiny);
      renderer.render(scene, camera);
    } catch (err) {
      console.warn('[autowala] warm-up render failed', err);
    } finally {
      renderer.setRenderTarget(null);
      for (const o of culled) o.frustumCulled = true;
      tiny.dispose();
      shadowDirty = true;
    }
  };
  const resize = (w, h) => {
    const nw = Math.max(2, Math.floor(w));
    const nh = Math.max(2, Math.floor(h));
    if (nw === width && nh === height && post && !lost) return; // the game sizes the pipeline during boot (shader warm-up): the screen's first resize is a no-op
    width = nw;
    height = nh;
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
    prewarmed = false; // every buffer and texture is gone: upload them again before the next real frame
    shadowDirty = true;
    build();
    onContext?.('restored');
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  // frame-time sampler: ~2 s of slow frames drops one quality step (not during the warm-up, not when a governor took over)
  let slow = 0;
  let sampled = 0;
  const sample = (dt) => {
    if (warm > 0) {
      warm -= dt;
      slow = sampled = 0;
      return;
    }
    if (!autoTier) return;
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

  // shadow map schedule: the sun's shadow box follows the player and is re-rendered every `shadowInterval` seconds (0 = every frame)
  const scheduleShadows = (dt) => {
    shadowSince += dt;
    if (shadowDue(shadowSince, tier(q).shadowInterval ?? 0, shadowDirty)) {
      sm.needsUpdate = true;
      shadowSince = 0;
      shadowDirty = false;
    }
  };

  const render = (dt) => {
    if (lost) return;
    if (!prewarmed && !lost) prewarm();
    sample(dt);
    info.reset();
    scheduleShadows(dt);
    if (post && shaderFailed) {
      // fall back: first the 8-bit pipeline, then direct rendering
      if (!simple && hdrFormat) simple = true;
      else direct = true;
      console.warn('[autowala] a post-processing shader failed to compile, falling back');
      build();
    }
    if (post) post.render(scene, camera);
    else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
    cost.calls = info.render.calls;
    cost.triangles = info.render.triangles;
    cost.lines = info.render.lines;
    cost.points = info.render.points;
    cost.programs = info.programs ? info.programs.length : 0;
    cost.geometries = info.memory.geometries;
    cost.textures = info.memory.textures;
    cost.scale = scale;
  };

  const setBloom = (strength) => {
    post?.setBloom(strength);
  };

  /** Render resolution as a fraction (0.5..1) of the drawing buffer: free, no reallocation. The composite upsamples. */
  const setScale = (s) => {
    scale = clampScale(s);
    post?.setScale(scale);
    return scale;
  };

  const dispose = () => {
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
    disposePost();
    disposeShared(postShared);
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
    setScale,
    invalidateShadows() {
      shadowDirty = true;
    },
    dispose,
    caps: { software, halfFloat, hdrFormat, maxSamples, maxAniso, webgl2: !!renderer.capabilities.isWebGL2 },
    get quality() {
      return q;
    },
    get cfg() {
      return tier(q);
    },
    get lost() {
      return lost;
    },
    get scale() {
      return scale;
    },
    get cost() {
      return cost;
    },
    get post() {
      return post;
    },
    /** false = the built-in frame-time sampler never changes the tier (a shared governor drives setScale instead). */
    get autoTier() {
      return autoTier;
    },
    set autoTier(v) {
      autoTier = !!v;
    },
    /** Kept for game/warm.js (passMaterials): this pipeline has no EffectComposer passes; its own materials are built by post.warm(). */
    get composer() {
      return null;
    },
    /** The render target the scene is drawn into (null before the first resize / when drawing directly): game/warm.js compiles against it. */
    get target() {
      return post ? post.targets.scene : null;
    },
  };
}
