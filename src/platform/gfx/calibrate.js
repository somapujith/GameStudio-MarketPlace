// Start-up calibration: a short, cancellable micro-benchmark that measures THIS machine with a representative synthetic load and turns the numbers
// into a recommended { tier, scale }. It runs on the loading screen, spread over several rAF frames (each frame's slice is capped at a few
// ms and sized from the previous measurement, so no frame hitches), and is done in ~250 ms.
//
//   const cal = createCalibration({ renderer, gpu, tiers: MY_TIER_MODELS });          // renderer: the game's THREE.WebGLRenderer
//   const result = await cal.run();                                                    // cal.cancel() any time
//   const start = chooseInitialTier({ gpu, calibration: result, memory: mem.get(gpu.key, vp), pref: getGfxPref() });
//
// What it measures (per-unit costs, so they scale to any viewport; each is fitted from 2-3 slices of growing size, ms = overhead + slope * work):
//   fill   ns per pixel-layer   full-canvas-size alpha-blended layers with an ALU-heavy fragment shader (overdraw + shading)
//   calls  us per draw call     up to 800 tiny meshes with a handful of materials (three.js + driver submission cost)
//   tris   ms per million tris  a 100k-triangle mesh drawn repeatedly (vertex throughput)
//   post   ns per pixel-pass    a full-screen pass sampling a half-float target (9 taps + tone curve): the post pipeline's unit
// A frame of a game is then ESTIMATED as max(cpu, gpu): cpu = calls * callUs, gpu = fill + tris + post (see estimateFrameMs). The tier models are
// the game's own: DEFAULT_TIER_MODELS is a generic ladder; pass your tier table's real costs for a tight fit.
//
// Measured on the dev laptop (integrated AMD Radeon, ANGLE / D3D11, 144 Hz), and why it is built this way:
//   * the first draw of every distinct program costs ~25 ms of MAIN THREAD even after KHR_parallel_shader_compile reports it ready. So the benchmark uses two
//     programs only, pays those first draws in a "wake" phase (one per frame, then a fence poll), and never lets a timed slice carry them;
//   * a 1-pixel readback after a slice is bimodal (1.8 ms or 18 ms for the same work: it queues behind the compositor's own GPU work), so slices are timed with
//     EXT_disjoint_timer_query_webgl2 (GPU execution time, nothing blocks the main thread; available in Chrome / Edge / most Android). Browsers without it fall
//     back to blocking readbacks and the result is marked non-confident (the GPU class and the run-time governor carry the decision);
//   * integrated GPUs idle at low clocks: the wake phase also ramps them up before anything is timed.
// The first slice of every test is deliberately tiny (1/16 of a layer / 40 calls); a machine too slow for it (software rendering) gets "lowest tier" without a stall.

import {
  BufferAttribute, BufferGeometry, HalfFloatType, Mesh, NoBlending, NormalBlending, OrthographicCamera, PlaneGeometry, RGBAFormat,
  Scene, ShaderMaterial, UnsignedByteType, Vector2, WebGLRenderTarget, LinearFilter, NearestFilter,
} from 'three';
import { detectRefreshHz, snapRefresh, DEFAULT_LADDER } from './governor.js';
import { TIER_ORDER, minTier } from './gpu.js';
import { createGpuTimer } from './gpuTimer.js';

// ---------------------------------------------------------------------------------------------------------------------------------
// Pure part: cost model, recommendation, initial tier

/**
 * What one frame of each tier asks of the machine, in the units calibration measures. `layers` = shaded overdraw of the scene at the tier's pixel
 * ratio (shadow passes folded in), `calls` = draw calls in "simple call" equivalents (lit, shadowed materials cost more than the test's
 * MeshBasicMaterial: scale accordingly), `mtris` = million triangles, `post` = full-screen post passes. Generic defaults: override per game.
 */
export const DEFAULT_TIER_MODELS = {
  lite: { pixelRatio: 1, layers: 1.5, calls: 160, mtris: 0.08, post: 0, scaleMin: 0.6 },
  low: { pixelRatio: 1, layers: 2.5, calls: 320, mtris: 0.2, post: 0, scaleMin: 0.5 },
  medium: { pixelRatio: 1.25, layers: 3.5, calls: 500, mtris: 0.3, post: 3, scaleMin: 0.5 },
  high: { pixelRatio: 1.75, layers: 5, calls: 900, mtris: 0.5, post: 7, scaleMin: 0.5 },
};
/** The reference frame behind `score`: a medium-class frame. score = 1000 / its estimated ms (about the fps the machine holds on a medium-class game). */
export const REFERENCE_MODEL = DEFAULT_TIER_MODELS.medium;

/**
 * Least-squares-free robust fit of ms = a + b * W from [{ W, ms }, ...] (W = work units). Uses the two largest-W points when they differ enough;
 * falls back to the mean cost per unit. Returns { a, b } with b >= 0 and a >= 0.
 */
export function fitSlope(points) {
  const p = points.filter((q) => q.W > 0 && q.ms >= 0).sort((x, y) => x.W - y.W);
  if (!p.length) return { a: 0, b: 0 };
  const last = p[p.length - 1];
  const perUnit = last.ms / last.W;
  if (p.length === 1) return { a: 0, b: perUnit };
  // slope between the largest point and the smallest point that is at least 1.5x smaller (the slice sizes grow, so there is one)
  let ref = p[0];
  for (const q of p) if (q.W <= last.W / 1.5) ref = q;
  if (last.W - ref.W < last.W * 0.3) return { a: 0, b: perUnit };
  const b = (last.ms - ref.ms) / (last.W - ref.W);
  if (!(b > perUnit * 0.15)) return { a: 0, b: perUnit }; // noise: a slope below 15 % of the mean is not believable
  return { a: Math.max(0, last.ms - b * last.W), b };
}

/** Estimated ms of one frame of `model` at a viewport (css px w x h, device ratio dpr) and render `scale`. frame = max(cpu, gpu). */
export function estimateFrameMs(units, model, { w, h, dpr = 1 }, scale = 1) {
  const pr = Math.min(model.pixelRatio ?? 1, dpr || 1);
  const pixels = Math.max(1, w * h * pr * pr * scale * scale);
  const mp = pixels / 1e6;
  const cpu = (model.calls * units.callUs) / 1000;
  const gpu = model.layers * mp * units.fillNsPerPx + model.mtris * units.mtriMs + model.post * mp * units.postNsPerPx; // Mpix x ns/pixel = ms
  return { ms: Math.max(cpu, gpu) * 1.1, cpu, gpu };
}

/** The game's tier table normalised to an ascending array [{ id, ...model }]. Accepts an object keyed by tier id or an array. */
function tierList(tiers) {
  if (Array.isArray(tiers)) return tiers.map((t) => ({ ...t }));
  return TIER_ORDER.filter((id) => tiers[id]).concat(Object.keys(tiers).filter((id) => !TIER_ORDER.includes(id))).map((id) => ({ id, ...tiers[id] }));
}

/**
 * The best tier the measurements say the machine holds at `budgetMs` (with 15 % headroom): the HIGHEST tier whose frame fits at a render scale of
 * at least `goodScale` (0.9: no visible resolution loss); when none does, the highest tier that fits at any scale down to its floor, and when even
 * that fails the lowest tier at its floor. Never above `capTier` (the GPU-class cap).
 * Returns { tier, scale, estimates: { [tier]: { ms, scale } }, reasons }.
 */
export function recommendTier({ units, viewport, tiers = DEFAULT_TIER_MODELS, budgetMs = 1000 / 60, capTier = null, ladder = DEFAULT_LADDER, goodScale = 0.9, headroom = 0.85 }) {
  const list = tierList(tiers);
  const allowed = capTier ? list.filter((t) => TIER_ORDER.indexOf(t.id) <= TIER_ORDER.indexOf(capTier) || !TIER_ORDER.includes(t.id)) : list;
  const use = allowed.length ? allowed : list.slice(0, 1);
  const estimates = {};
  const reasons = [];
  let anyFit = null;
  const target = budgetMs * headroom;
  for (const t of list) {
    const e = estimateFrameMs(units, t, viewport, 1);
    estimates[t.id] = { ms: Math.round(e.ms * 10) / 10, scale: 1, cpu: Math.round(e.cpu * 10) / 10, gpu: Math.round(e.gpu * 10) / 10 };
  }
  for (let i = use.length - 1; i >= 0; i--) {
    const t = use[i];
    const floor = t.scaleMin ?? 0.5;
    let fit = null;
    for (const s of ladder) {
      if (s < floor - 1e-6) continue;
      const e = estimateFrameMs(units, t, viewport, s);
      if (e.ms <= target) {
        fit = { tier: t.id, scale: s, ms: e.ms };
        break;
      }
    }
    if (fit && fit.scale >= goodScale) {
      reasons.push(`${t.id} fits ${budgetMs.toFixed(1)} ms at scale ${fit.scale} (est. ${fit.ms.toFixed(1)} ms)`);
      return { tier: fit.tier, scale: fit.scale, estimates, reasons };
    }
    if (fit && !anyFit) anyFit = fit;
    reasons.push(fit ? `${t.id} only fits at scale ${fit.scale}` : `${t.id} does not fit ${budgetMs.toFixed(1)} ms even at its floor`);
  }
  if (anyFit) return { tier: anyFit.tier, scale: anyFit.scale, estimates, reasons };
  const lowest = use[0];
  return { tier: lowest.id, scale: lowest.scaleMin ?? 0.5, estimates, reasons };
}

/** Should the start-up benchmark run at all? Not when the player chose a tier, a remembered tier exists, the GPU is software, or WebGL2 is missing. */
export function shouldCalibrate({ gpu = null, memory = null, pref = 'auto', tiers = TIER_ORDER } = {}) {
  if (pref && pref !== 'auto' && tiers.includes(pref)) return { run: false, reason: `player chose ${pref}` };
  if (memory) return { run: false, reason: `remembered ${memory.tier} at ${memory.scale}` };
  if (gpu?.class === 'software') return { run: false, reason: 'software renderer: lowest tier' };
  if (gpu?.caps && gpu.caps.webgl && gpu.caps.webgl < 2) return { run: false, reason: 'no WebGL2' };
  return { run: true, reason: 'no remembered result for this GPU and viewport' };
}

/**
 * The tier + scale to START on, in priority order: the player's explicit choice, the remembered stable result, the calibration (never above the GPU
 * class cap), the GPU class cap alone. An integrated GPU therefore never starts on 'high' unless the player or its own history says so.
 * Returns { tier, scale, source, lock, maxTier, reasons }.
 */
export function chooseInitialTier({ gpu = null, calibration = null, memory = null, pref = 'auto', tiers = TIER_ORDER, fallback = 'medium' } = {}) {
  const has = (t) => tiers.includes(t);
  const cap = gpu?.tierCap && has(gpu.tierCap) ? gpu.tierCap : tiers[tiers.length - 1];
  if (pref && pref !== 'auto' && has(pref)) return { tier: pref, scale: 1, source: 'pref', lock: true, maxTier: pref, reasons: [`player chose ${pref}`] };
  if (memory && has(memory.tier)) {
    return { tier: memory.tier, scale: memory.scale ?? 1, source: 'memory', lock: false, maxTier: TIER_ORDER.indexOf(memory.tier) > TIER_ORDER.indexOf(cap) ? memory.tier : cap, reasons: [`remembered stable ${memory.tier} at scale ${memory.scale ?? 1}`] };
  }
  const rec = calibration?.recommended;
  if (rec && has(rec.tier)) {
    let tier = minTier(rec.tier, cap);
    const reasons = [...(rec.reasons || []).slice(0, 2)];
    if (tier !== rec.tier) reasons.push(`capped to ${tier} by the GPU class (${gpu?.class})`);
    // an unfinished benchmark (timeout / aborted) may only lower the class cap by ONE step: it is weak evidence, and the governor corrects the rest at run time
    if (rec.confident === false) {
      const floor = tiers[Math.max(0, tiers.indexOf(cap) - 1)];
      if (tiers.indexOf(tier) < tiers.indexOf(floor)) {
        tier = floor;
        reasons.push(`benchmark incomplete (${calibration.partial || 'partial'}): at most one tier below the GPU class cap`);
      }
    }
    return { tier, scale: tier === rec.tier ? rec.scale : 1, source: 'calibration', lock: false, maxTier: cap, reasons };
  }
  const start = gpu?.tierCap && has(gpu.tierCap) ? (gpu.class === 'integrated' || gpu.class === 'unknown' ? minTier(gpu.tierCap, has('medium') ? 'medium' : gpu.tierCap) : gpu.tierCap) : has(fallback) ? fallback : tiers[0];
  return { tier: start, scale: 1, source: 'class', lock: false, maxTier: cap, reasons: [`GPU class ${gpu?.class ?? 'unknown'}: starts on ${start}`] };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Three.js workload

// ONE vertex + fragment program serves the fill, calls and triangle tests (the first draw of every distinct program costs ~25 ms of main thread on
// ANGLE / D3D11 even after KHR_parallel_shader_compile says "ready", measured on the dev laptop), plus one more for the post pass: two stalls, not four.
const SCENE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FILL_FRAG = /* glsl */ `
  varying vec2 vUv; uniform float uSeed;
  void main() {
    vec2 p = vUv * 7.0 + uSeed;
    vec3 c = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float f = float(i) + 1.0;
      c += vec3(sin(p.x * f + uSeed), cos(p.y * f * 1.3), sin((p.x + p.y) * f * 0.7)) * 0.04;
      p = p.yx * 1.07 + c.xy;
    }
    gl_FragColor = vec4(c * 0.5 + 0.02, 0.35);
  }
`;
const POST_FRAG = /* glsl */ `
  varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uInv;
  void main() {
    vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
    s += texture2D(tSrc, vUv + vec2(uInv.x, 0.0)).rgb + texture2D(tSrc, vUv - vec2(uInv.x, 0.0)).rgb;
    s += texture2D(tSrc, vUv + vec2(0.0, uInv.y)).rgb + texture2D(tSrc, vUv - vec2(0.0, uInv.y)).rgb;
    s += texture2D(tSrc, vUv + uInv).rgb + texture2D(tSrc, vUv - uInv).rgb;
    s += texture2D(tSrc, vUv + vec2(uInv.x, -uInv.y)).rgb;
    s *= 1.0 / 12.0;
    s = s / (1.0 + s);
    s = pow(max(s, 0.0), vec3(1.0 / 2.2));
    gl_FragColor = vec4(s, 1.0);
  }
`;

const MAX_PIXELS = 2.6e6; // the benchmark target never exceeds this (units are per pixel, so a 4K canvas is measured at a smaller size)
const MAX_CALLS = 480;
const GRID = 80; // quads per side of the triangle-test mesh
const TRIS_PER_DRAW = GRID * GRID * 2; // 12,800
const MAX_TRI_DRAWS = 96; // 1.23 Mtri at most

/**
 * The synthetic scenes and the measuring entry points. `renderer` needs render / setRenderTarget / getRenderTarget (and readRenderTargetPixels for the sync mode).
 * Two ways to time a slice, chosen once:
 *   'timer'  EXT_disjoint_timer_query_webgl2 (Chrome, Edge, most Android): GPU execution time per slice, results arrive 1-3 frames later, NOTHING blocks the main
 *            thread. The calls test uses max(CPU submit time, GPU time). This is also immune to the compositor's own GPU work, which makes sync readbacks bimodal.
 *   'sync'   a 1-pixel readback after the slice (the only portable fence): the main thread waits for the GPU. Noisy; the runner marks the result non-confident.
 * submit(id, W, now) -> handle { id, W, cpuMs, ms (-1 until done), done, dropped }; poll(now) resolves handles; sync handles are done immediately.
 */
export function createThreeLoad(renderer, { width, height, halfFloat, timer: timerOpt } = {}) {
  let w = Math.max(64, Math.round(width || 1280));
  let h = Math.max(64, Math.round(height || 720));
  const s = Math.sqrt(Math.min(1, MAX_PIXELS / (w * h)));
  w = Math.max(64, Math.round(w * s));
  h = Math.max(64, Math.round(h * s));
  const pixels = w * h;
  const fullMP = pixels / 1e6;
  const useHalf = halfFloat !== false && (halfFloat === true || !!(renderer.extensions?.has?.('EXT_color_buffer_float') || renderer.extensions?.has?.('EXT_color_buffer_half_float')));

  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
  cam.position.z = 5;
  const buf = new Uint8Array(4);
  const owned = { geos: [], mats: [], rts: [] };
  const own = (kind, o) => {
    owned[kind].push(o);
    return o;
  };

  let rtMain = null;
  let rtHalf = null;
  let sceneMat = null; // the shared fill / calls / tris program
  let fillScene = null;
  let postScene = null;
  let postMat = null;
  let callsScene = null;
  let callMeshes = [];
  let trisScene = null;
  let triMeshes = [];
  let steps = 0;
  let ready = false;
  let compiled = false;
  let compileFailed = false;
  let fence = null;
  let fenceCtx = null;
  let gl = null;
  try {
    gl = renderer.getContext?.() || null;
    if (gl && typeof gl.fenceSync === 'function' && typeof gl.clientWaitSync === 'function') fenceCtx = gl;
  } catch { /* no context to ask */ }

  // ---- timing mode
  const gpuTimer = timerOpt === false ? null : timerOpt || (gl ? createGpuTimer(gl, { inflight: 3 }) : null);
  const mode = gpuTimer && gpuTimer.supported ? 'timer' : 'sync';
  const waiting = new Map(); // tag -> handle
  let tagSeq = 0;
  if (mode === 'timer') {
    gpuTimer.onResult = (tag, ms) => {
      const hnd = waiting.get(tag);
      if (!hnd) return;
      waiting.delete(tag);
      hnd.gpuMs = ms;
      hnd.dropped = ms < 0;
      hnd.ms = ms < 0 ? -1 : hnd.id === 'calls' ? Math.max(hnd.cpuMs, ms) : ms;
      hnd.done = true;
    };
  }

  const quadScene = (mat) => {
    const sc = new Scene();
    const m = new Mesh(own('geos', new PlaneGeometry(2, 2)), mat);
    m.frustumCulled = false;
    sc.add(m);
    return sc;
  };
  const triGeometry = () => {
    const n = GRID;
    const verts = (n + 1) * (n + 1);
    const pos = new Float32Array(verts * 3);
    for (let y = 0, k = 0; y <= n; y++) for (let x = 0; x <= n; x++, k += 3) {
      pos[k] = x / n - 0.5;
      pos[k + 1] = y / n - 0.5;
      pos[k + 2] = 0;
    }
    const idx = new Uint16Array(n * n * 6);
    for (let y = 0, k = 0; y < n; y++) for (let x = 0; x < n; x++, k += 6) {
      const a = y * (n + 1) + x;
      idx[k] = a;
      idx[k + 1] = a + 1;
      idx[k + 2] = a + n + 1;
      idx[k + 3] = a + 1;
      idx[k + 4] = a + n + 2;
      idx[k + 5] = a + n + 1;
    }
    const geo = own('geos', new BufferGeometry());
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
  };
  const addCalls = (from, to, geo) => {
    for (let i = from; i < to; i++) {
      const m = new Mesh(geo, sceneMat);
      m.scale.set(0.012, 0.012, 1);
      m.position.set(-0.95 + ((i % 40) / 39) * 1.9, -0.95 + (Math.floor(i / 40) / 12) * 1.9, 0);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.visible = false;
      callsScene.add(m);
      callMeshes.push(m);
    }
    callsScene.updateMatrixWorld(true);
  };

  // each step is a few ms of JS at most: the run spreads them over frames
  const stepFns = [
    // 1. targets, the two programs, the full-screen scenes
    () => {
      rtMain = own('rts', new WebGLRenderTarget(w, h, { type: UnsignedByteType, format: RGBAFormat, depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter }));
      rtHalf = own('rts', new WebGLRenderTarget(w, h, { type: useHalf ? HalfFloatType : UnsignedByteType, format: RGBAFormat, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter }));
      sceneMat = own('mats', new ShaderMaterial({ vertexShader: SCENE_VERT, fragmentShader: FILL_FRAG, uniforms: { uSeed: { value: 0.5 } }, depthTest: false, depthWrite: false, transparent: true, blending: NormalBlending }));
      fillScene = quadScene(sceneMat);
      postMat = own('mats', new ShaderMaterial({ vertexShader: SCENE_VERT, fragmentShader: POST_FRAG, uniforms: { tSrc: { value: rtHalf.texture }, uInv: { value: new Vector2(1 / w, 1 / h) } }, depthTest: false, depthWrite: false, blending: NoBlending }));
      postScene = quadScene(postMat);
    },
    // 2-3. many small draw calls (half of them per step)
    () => {
      callsScene = new Scene();
      addCalls(0, MAX_CALLS / 2, own('geos', new PlaneGeometry(1, 1, 1, 1)));
    },
    () => addCalls(MAX_CALLS / 2, MAX_CALLS, owned.geos[owned.geos.length - 1]),
    // 4. one mesh of 12.8k triangles
    () => {
      triGeo = triGeometry();
    },
    // 5. ... drawn many times
    () => {
      trisScene = new Scene();
      for (let i = 0; i < MAX_TRI_DRAWS; i++) {
        const m = new Mesh(triGeo, sceneMat);
        m.scale.set(0.03, 0.03, 1);
        m.position.set(-0.9 + (i % 12) * 0.16, -0.7 + Math.floor(i / 12) * 0.2, 0);
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        m.visible = false;
        trisScene.add(m);
        triMeshes.push(m);
      }
      trisScene.updateMatrixWorld(true);
    },
    // 6. compile every program now (parallel, non-blocking where KHR_parallel_shader_compile exists)
    () => {
      const all = [fillScene, postScene, callsScene, trisScene];
      for (const m of callMeshes.slice(0, 2)) m.visible = true;
      triMeshes[0].visible = true;
      try {
        const p = renderer.compileAsync ? Promise.all(all.map((sc) => renderer.compileAsync(sc, cam))) : Promise.resolve(all.forEach((sc) => renderer.compile?.(sc, cam)));
        p.then(() => { compiled = true; }, () => { compiled = true; compileFailed = true; });
      } catch {
        compiled = true;
        compileFailed = true;
      }
      for (const m of callMeshes) m.visible = false;
      for (const m of triMeshes) m.visible = false;
    },
  ];
  let triGeo = null;

  const setRect = (rt, frac) => {
    if (frac >= 0.999) {
      rt.scissorTest = false;
      rt.viewport.set(0, 0, w, h);
      rt.scissor.set(0, 0, w, h);
      return;
    }
    const f = Math.sqrt(frac);
    const vw = Math.max(1, Math.round(w * f));
    const vh = Math.max(1, Math.round(h * f));
    rt.viewport.set(0, 0, vw, vh);
    rt.scissor.set(0, 0, vw, vh);
    rt.scissorTest = true;
  };

  const prevState = { rt: null, autoClear: true };
  const enter = () => {
    prevState.rt = renderer.getRenderTarget?.() ?? null;
    prevState.autoClear = renderer.autoClear;
    renderer.autoClear = false;
  };
  const leave = () => {
    renderer.setRenderTarget(prevState.rt);
    renderer.autoClear = prevState.autoClear;
  };

  /** Draws W units of test `id` (no waiting). */
  const draw = (id, W) => {
    if (id === 'fill') {
      const layers = Math.max(1, Math.ceil(W / fullMP - 1e-9));
      setRect(rtMain, W / (layers * fullMP));
      renderer.setRenderTarget(rtMain);
      for (let i = 0; i < layers; i++) {
        sceneMat.uniforms.uSeed.value = 0.5 + i * 0.13;
        renderer.render(fillScene, cam);
      }
    } else if (id === 'calls') {
      const n = Math.max(1, Math.min(MAX_CALLS, Math.round(W)));
      for (let i = 0; i < MAX_CALLS; i++) callMeshes[i].visible = i < n;
      sceneMat.uniforms.uSeed.value = 0.5;
      setRect(rtMain, 1);
      renderer.setRenderTarget(rtMain);
      renderer.render(callsScene, cam);
    } else if (id === 'tris') {
      const n = Math.max(1, Math.min(MAX_TRI_DRAWS, Math.round((W * 1e6) / TRIS_PER_DRAW)));
      for (let i = 0; i < MAX_TRI_DRAWS; i++) triMeshes[i].visible = i < n;
      sceneMat.uniforms.uSeed.value = 0.5;
      setRect(rtMain, 1);
      renderer.setRenderTarget(rtMain);
      renderer.render(trisScene, cam);
    } else if (id === 'post') {
      const passes = Math.max(1, Math.ceil(W / fullMP - 1e-9));
      setRect(rtMain, W / (passes * fullMP));
      renderer.setRenderTarget(rtMain);
      for (let i = 0; i < passes; i++) renderer.render(postScene, cam);
    }
  };

  const api = {
    width: w,
    height: h,
    pixels,
    halfFloat: useHalf,
    mode,
    /** The tests, with the work range of one slice in each test's own unit. */
    tests: [
      { id: 'fill', unit: 'Mpix-layers', minW: fullMP / 16, maxW: fullMP * 14 },
      { id: 'calls', unit: 'calls', minW: 40, maxW: MAX_CALLS },
      { id: 'tris', unit: 'Mtris', minW: TRIS_PER_DRAW / 1e6, maxW: (TRIS_PER_DRAW * MAX_TRI_DRAWS) / 1e6 },
      { id: 'post', unit: 'Mpix-passes', minW: fullMP / 8, maxW: fullMP * 10 },
    ],
    get ready() { return ready; },
    get compiled() { return compiled; },
    get compileFailed() { return compileFailed; },
    get pending() { return waiting.size; },
    /** One prepare step per call (each a few ms of JS at most); returns true when everything is built. */
    prepare() {
      if (steps < stepFns.length) stepFns[steps++]();
      ready = steps >= stepFns.length;
      return ready;
    },
    /**
     * Throw-away GPU work, NOT timed: the first draw of every program, the geometry upload, the half-float target and the idle GPU's low clocks are paid here,
     * spread over frames (step 0: the fill program, 1: calls + triangles (same program, new geometry), 2: the post program), so no timed slice carries them.
     * Ends with a fence; warmReady() polls it without blocking.
     */
    wake(step = 0) {
      enter();
      try {
        const k = step % 3;
        if (k === 0) {
          setRect(rtHalf, 1);
          renderer.setRenderTarget(rtHalf);
          renderer.render(fillScene, cam);
          draw('fill', fullMP / 4);
        } else if (k === 1) {
          draw('calls', 60);
          draw('tris', (TRIS_PER_DRAW * 2) / 1e6);
        } else draw('post', fullMP / 4);
      } finally {
        leave();
      }
      if (fenceCtx) {
        try {
          if (fence) fenceCtx.deleteSync(fence);
          fence = fenceCtx.fenceSync(fenceCtx.SYNC_GPU_COMMANDS_COMPLETE, 0);
          fenceCtx.flush();
        } catch {
          fence = null;
        }
      }
    },
    /** True when the GPU has finished everything submitted so far (or cannot tell): a non-blocking check, so waiting costs no frame time. */
    warmReady() {
      if (!fence || !fenceCtx) return true;
      try {
        const r = fenceCtx.clientWaitSync(fence, 0, 0);
        if (r === fenceCtx.TIMEOUT_EXPIRED) return false;
        fenceCtx.deleteSync(fence);
      } catch { /* a lost context or a driver without sync objects: do not wait */ }
      fence = null;
      return true;
    },
    /**
     * Submits W units of test `id` and returns a handle { id, W, cpuMs, ms, done, dropped }. 'timer' mode: ms arrives through poll(), the call itself costs only the
     * CPU submit time. 'sync' mode: waits for the GPU here (1 px readback) and the handle is done on return. Returns null when the GPU is too far behind to take
     * another query (timer mode): try again next frame.
     */
    submit(id, W, now) {
      const hnd = { id, W, cpuMs: 0, gpuMs: -1, ms: -1, done: false, dropped: false };
      enter();
      try {
        if (mode === 'timer') {
          if (!gpuTimer.begin()) return null;
          const t0 = now();
          draw(id, W);
          hnd.cpuMs = now() - t0;
          const tag = ++tagSeq;
          waiting.set(tag, hnd);
          gpuTimer.end(tag);
        } else {
          const t0 = now();
          draw(id, W);
          hnd.cpuMs = now() - t0;
          renderer.readRenderTargetPixels(rtMain, 0, 0, 1, 1, buf);
          hnd.ms = now() - t0;
          hnd.done = true;
        }
      } finally {
        leave();
      }
      return hnd;
    },
    /** Resolves finished timer queries (a no-op in sync mode). */
    poll() {
      if (mode === 'timer') gpuTimer.poll();
    },
    dispose() {
      if (mode === 'timer') {
        gpuTimer.onResult = null;
        gpuTimer.dispose();
      }
      waiting.clear();
      for (const g of owned.geos) g.dispose();
      for (const m of owned.mats) m.dispose();
      for (const r of owned.rts) r.dispose();
      owned.geos.length = owned.mats.length = owned.rts.length = 0;
      try {
        if (fence && fenceCtx) fenceCtx.deleteSync(fence);
      } catch { /* ignore */ }
      fence = null;
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The runner

/**
 * createCalibration({ renderer | load, gpu, viewport, tiers, now, raf, caf, maxMs, ... }) -> { run(), cancel(), frame(ts) }
 *   run()     starts the rAF-driven run and resolves with the result (never rejects: a failure resolves { ok: false, error }).
 *   frame(ts) drive it yourself from your own loop instead (returns true when finished; read `result`).
 * `load` is the workload interface (createThreeLoad's shape: tests, prepare, compiled, wake, warmReady, submit, poll, dispose, mode); tests pass a fake.
 *
 * Timeline: prepare (6 small JS steps, one per frame) -> wait for the programs to be READY -> wake (3-4 frames, one program's first use each) -> wait for the GPU
 * fence -> measure. 'timer' mode keeps up to two slices in flight (their results arrive 1-3 frames later) and interleaves the four tests so latency is hidden;
 * 'sync' mode runs blocking slices inside a per-frame budget. `maxMs` bounds the MEASURE phase (default 300); the start-up phases have their own bound
 * (`startMaxMs`, default 500) because first-use costs on D3D11 are real stalls that no benchmark can shorten.
 */
export function createCalibration(opts = {}) {
  const now = opts.now || (() => performance.now());
  const raf = opts.raf || ((fn) => requestAnimationFrame(fn));
  const caf = opts.caf || ((id) => cancelAnimationFrame(id));
  const maxMs = opts.maxMs ?? 300;
  const startMaxMs = opts.startMaxMs ?? 500;
  const sliceMs = opts.sliceMs ?? 4; // the target duration of one slice
  const maxSliceMs = opts.maxSliceMs ?? 12;
  const frameBudgetMs = opts.frameBudgetMs ?? 9; // sync mode: all blocking slices of one frame together
  const abortSliceMs = opts.abortSliceMs ?? 40; // sync mode: two slices in a row this slow (after the warm-up) mean the machine cannot be measured gently
  const wakeFrames = opts.wakeFrames ?? 4;
  const compileWaitMs = opts.compileWaitMs ?? 110;
  const warmWaitMs = opts.warmWaitMs ?? 120; // how long to wait (without blocking) for the GPU to finish the wake-up work
  const maxInflight = opts.maxInflight ?? 4;
  const perFrame = opts.perFrame ?? 2; // timer mode: slices submitted per frame (their CPU cost is the submit time only)
  const gpu = opts.gpu || null;
  const budgetMs = opts.budgetMs ?? 1000 / Math.min(opts.targetFps ?? 60, 240);

  let load = opts.load || null;
  let viewport = opts.viewport || null;
  let state = 'idle'; // idle | prepare | wake | measure | done
  let t0 = 0;
  let tMeasure = 0;
  let tPrevRaf = -1;
  let frames = 0;
  let wakeStep = 0;
  let compileSince = -1;
  let wakeSince = 0;
  let slowStreak = 0;
  // per-frame budgets follow the display: at 144 Hz a frame is 6.9 ms, so a slice must be ~3 ms or the frame misses its vsync
  let budgetNow = frameBudgetMs;
  let sliceNow = sliceMs;
  let maxSliceNow = maxSliceMs;
  let rr = 0; // round-robin cursor over the tests (timer mode)
  let aborted = false;
  let cancelled = false;
  let tooSlow = false;
  let rafId = 0;
  let resolveFn = null;
  const intervals = [];
  const trace = [];
  const frameWork = [];
  const tests = [];
  const inflight = []; // timer mode: { t, h }
  let result = null;

  const ensureLoad = () => {
    if (load) return;
    const r = opts.renderer;
    let w = opts.width;
    let h = opts.height;
    if (!(w > 0) && r?.getDrawingBufferSize) {
      const v = r.getDrawingBufferSize(new Vector2());
      w = v.x;
      h = v.y;
    }
    load = createThreeLoad(r, { width: w, height: h, halfFloat: opts.halfFloat, timer: opts.timer });
  };
  const ensureViewport = () => {
    if (viewport) return;
    const r = opts.renderer;
    const dpr = opts.dpr ?? (r?.getPixelRatio ? r.getPixelRatio() : 1) ?? 1;
    let cw = opts.cssWidth;
    let ch = opts.cssHeight;
    if (!(cw > 0) && r?.getSize) {
      const v = r.getSize(new Vector2());
      cw = v.x;
      ch = v.y;
    }
    viewport = { w: cw || 1280, h: ch || 720, dpr };
  };

  /** Next slice size for `t` (in the test's own unit), or 0 when the test has enough points. */
  function plan(t) {
    const pts = t.points;
    const { minW, maxW } = t.def;
    if (pts.length === 0) return minW;
    if (pts.length >= 3) return 0;
    const last = pts[pts.length - 1];
    const perUnit = Math.max(last.ms / last.W, 1e-6);
    let W;
    if (pts.length === 1) W = sliceNow / perUnit;
    else W = last.W * 2;
    const hi = Math.min(maxW, maxSliceNow / perUnit);
    W = Math.min(W, hi);
    // a test whose largest allowed slice is not meaningfully bigger than the last one cannot add information
    if (W < last.W * 1.4) return 0;
    return Math.max(W, minW);
  }

  function medianInterval(arr) {
    const s = arr.filter((v) => v > 2 && v < 60).sort((a, b) => a - b);
    return s.length >= 3 ? s[s.length >> 1] : 16.7;
  }

  function refreshFrom(arr) {
    const sorted = arr.filter((v) => v > 2 && v < 50).sort((a, b) => a - b);
    if (sorted.length < 3) return 0;
    const q = sorted[Math.floor(sorted.length * 0.25)];
    return snapRefresh(q, 50) || detectRefreshHz(sorted, sorted.length) || 0;
  }

  function finish(partial) {
    state = 'done';
    const ranMs = now() - t0;
    const units = { fillNsPerPx: 0, callUs: 0, mtriMs: 0, postNsPerPx: 0 };
    const fits = {};
    const measuredTests = {};
    for (const t of tests) {
      fits[t.def.id] = fitSlope(t.points);
      measuredTests[t.def.id] = t.points.length > 0;
    }
    // the fill / post work unit is a million pixels, so the slope in ms per million pixels IS ns per pixel
    if (measuredTests.fill) units.fillNsPerPx = fits.fill.b;
    if (measuredTests.calls) units.callUs = fits.calls.b * 1000;
    if (measuredTests.tris) units.mtriMs = fits.tris.b;
    if (measuredTests.post) units.postNsPerPx = fits.post.b;
    // a test that never got a slice (the run ended early) falls back to a pessimistic value so the verdict errs low
    const missing = Object.entries(measuredTests).filter(([, ok]) => !ok).map(([id]) => id);
    if (missing.length) {
      if (!measuredTests.fill) units.fillNsPerPx = 25;
      if (!measuredTests.calls) units.callUs = 60;
      if (!measuredTests.tris) units.mtriMs = 8;
      if (!measuredTests.post) units.postNsPerPx = units.fillNsPerPx * 0.6;
    }
    ensureViewport();
    const hz = intervals.length >= 3 ? refreshFrom(intervals) : 0;
    const budget = hz > 0 && hz < (opts.targetFps ?? 60) ? 1000 / hz : budgetMs;
    const refMs = estimateFrameMs(units, REFERENCE_MODEL, viewport, 1).ms;
    // timer-less browsers time slices with a blocking readback, which is noisy: their verdict is never "confident"
    const confident = !partial && !missing.length && (load?.mode ?? 'timer') === 'timer';
    const recommended = partial === 'cancelled' ? null : tooSlow || partial === 'aborted'
      ? { tier: TIER_ORDER[0], scale: (opts.tiers?.[TIER_ORDER[0]]?.scaleMin ?? DEFAULT_TIER_MODELS.lite.scaleMin), estimates: {}, reasons: ['the machine was too slow to benchmark gently: lowest tier'], confident: false }
      : { ...recommendTier({ units, viewport, tiers: opts.tiers || DEFAULT_TIER_MODELS, budgetMs: budget, capTier: gpu?.tierCap || null, ladder: opts.ladder || DEFAULT_LADDER }), confident };
    result = {
      ok: true,
      partial: partial || false,
      cancelled,
      mode: load?.mode ?? 'timer',
      ranMs: Math.round(ranMs),
      measureMs: tMeasure ? Math.round(now() - tMeasure) : 0,
      frames,
      score: Math.round(1000 / Math.max(1, refMs)),
      refFrameMs: Math.round(refMs * 10) / 10,
      units,
      fits,
      missing,
      pixels: load?.pixels || 0,
      viewport,
      halfFloat: !!load?.halfFloat,
      compileWaited: !!(load && !load.compiled),
      refreshHz: hz || null,
      budgetMs: Math.round(budget * 100) / 100,
      maxFrameWorkMs: frameWork.length ? Math.round(Math.max(...frameWork) * 10) / 10 : 0,
      maxRafGapMs: intervals.length ? Math.round(Math.max(...intervals) * 10) / 10 : 0,
      recommended,
      trace,
    };
    try {
      load?.dispose?.();
    } catch { /* ignore */ }
    const fn = resolveFn;
    resolveFn = null;
    fn?.(result);
    return true;
  }

  const record = (t, h, extra = {}) => {
    trace.push({ test: t.def.id, W: Math.round(h.W * 1000) / 1000, ms: Math.round(h.ms * 1000) / 1000, cpuMs: Math.round(h.cpuMs * 100) / 100, ...extra });
  };

  /**
   * Timer mode. Each test is a queue of slice sizes: first the small probe; when its result is back, the two follow-ups (the size that fills a slice, and double
   * that) go out TOGETHER, so a test needs two result latencies, not three; the four tests are interleaved so the latency of one is the work of another.
   * Per frame: resolve finished slices, then submit up to `perFrame` slices (CPU cost: the submit time only; never more than `maxInflight` outstanding).
   */
  function measureTimer() {
    load.poll(now);
    for (let i = inflight.length - 1; i >= 0; i--) {
      const { t, h } = inflight[i];
      if (!h.done) continue;
      inflight.splice(i, 1);
      if (h.dropped || h.ms < 0) {
        record(t, h, { dropped: true });
        t.retries = (t.retries || 0) + 1;
        if (t.retries > 3) t.failed = true;
        else t.queue.unshift(h.W); // retry the same size
        continue;
      }
      t.points.push({ W: h.W, ms: h.ms });
      record(t, h);
      if (t.points.length === 1 && !t.followed) {
        t.followed = true;
        const { maxW } = t.def;
        const perUnit = Math.max(h.ms / h.W, 1e-6);
        const W2 = Math.min(sliceNow / perUnit, maxW, maxSliceNow / perUnit);
        if (W2 >= h.W * 1.4) {
          t.queue.push(W2);
          const W3 = Math.min(W2 * 2, maxW, maxSliceNow / perUnit);
          if (W3 >= W2 * 1.4) t.queue.push(W3);
        }
      }
    }
    if (!inflight.length && tests.every((t) => t.failed || !t.queue.length)) return finish(false);
    if (now() - tMeasure > maxMs) return finish('timeout');
    let sent = 0;
    for (let k = 0; k < tests.length && sent < perFrame && inflight.length < maxInflight; k++) {
      const t = tests[(rr + k) % tests.length];
      if (t.failed || !t.queue.length) continue;
      // follow-ups wait for the probe's result; a test never has more than two slices outstanding
      if (t.points.length === 0 && inflight.some((x) => x.t === t)) continue;
      const h = load.submit(t.def.id, t.queue[0], now);
      if (!h) return false; // the GPU is behind: wait a frame
      t.queue.shift();
      inflight.push({ t, h });
      sent++;
      rr = (rr + k + 1) % tests.length;
    }
    return false;
  }

  /** Sync mode: blocking slices inside this frame's budget. */
  function measureSync(f0) {
    for (;;) {
      if (testI >= tests.length) return finish(false);
      if (now() - tMeasure > maxMs) return finish('timeout');
      const t = tests[testI];
      const W = plan(t);
      if (!W) {
        testI++;
        continue;
      }
      const used = now() - f0;
      const last = t.points[t.points.length - 1];
      const predicted = last ? Math.min(maxSliceNow, (last.ms / last.W) * W) : 1;
      if (used > 0.1 && used + predicted > budgetNow) return false;
      const h = load.submit(t.def.id, W, now);
      if (h.ms > abortSliceMs) {
        // one slow slice can be a first-use cost or another process on the GPU: drop it and retry next frame; two in a row is the machine
        record(t, h, { dropped: true });
        if (++slowStreak >= 2) {
          tooSlow = true;
          return finish('aborted');
        }
        return false;
      }
      slowStreak = 0;
      t.points.push({ W, ms: h.ms });
      record(t, h);
      if (t.points.length >= 3 || !plan(t)) testI++;
      if (now() - f0 > budgetNow) return false;
    }
  }
  let testI = 0;

  /** One rAF frame of the run. Returns true when finished. */
  function frame(ts) {
    if (state === 'done') return true;
    const f0 = now();
    if (state === 'idle') {
      state = 'prepare';
      t0 = f0;
    }
    if (cancelled) return finish('cancelled');
    if (tPrevRaf >= 0) intervals.push(ts - tPrevRaf);
    tPrevRaf = ts;
    frames++;
    try {
      ensureLoad();
      if (f0 - t0 > startMaxMs && state !== 'measure') return finish('timeout');
      if (state === 'prepare') {
        if (load.prepare()) {
          if (compileSince < 0) compileSince = now();
          if (load.compiled || now() - compileSince > compileWaitMs) state = 'wake';
        }
      } else if (state === 'wake') {
        if (!load.compiled && now() - compileSince <= compileWaitMs) {
          /* still compiling: keep waiting (the frames double as the vsync measurement) */
        } else if (wakeStep < wakeFrames) {
          load.wake(wakeStep++);
          if (wakeStep === wakeFrames) wakeSince = now();
        } else if (load.warmReady && !load.warmReady() && now() - wakeSince < warmWaitMs) {
          /* the GPU is still working through the first-use costs of the wake-up draws: wait for it (a fence poll, no stall) */
        } else {
          const med = medianInterval(intervals);
          budgetNow = Math.min(frameBudgetMs, Math.max(3, med * 0.55));
          sliceNow = Math.min(sliceMs, Math.max(2, budgetNow * 0.8));
          maxSliceNow = Math.min(maxSliceMs, Math.max(4, budgetNow * 1.4));
          state = 'measure';
          tMeasure = now();
        }
      } else if (state === 'measure') {
        if (load.mode === 'sync') {
          if (measureSync(f0)) return true;
        } else if (measureTimer()) return true;
      }
    } catch (err) {
      state = 'done';
      aborted = true;
      result = { ok: false, error: String(err?.message || err), ranMs: Math.round(now() - t0), frames, recommended: null };
      try {
        load?.dispose?.();
      } catch { /* ignore */ }
      const fn = resolveFn;
      resolveFn = null;
      fn?.(result);
      return true;
    }
    frameWork.push(now() - f0);
    return false;
  }

  function init() {
    ensureLoad();
    for (const def of load.tests) tests.push({ def, points: [], queue: [def.minW], followed: false, retries: 0, failed: false });
  }

  const api = {
    /** Starts the rAF-driven run; resolves with the result. */
    run() {
      if (resolveFn || state === 'done') return Promise.resolve(result);
      return new Promise((resolve) => {
        resolveFn = resolve;
        try {
          init();
        } catch (err) {
          result = { ok: false, error: String(err?.message || err), ranMs: 0, frames: 0, recommended: null };
          resolveFn = null;
          resolve(result);
          return;
        }
        const loop = (ts) => {
          rafId = 0;
          if (frame(ts)) return;
          rafId = raf(loop);
        };
        rafId = raf(loop);
      });
    },
    /** Manual drive: call once from your own frame; initialises on the first call. */
    frame(ts) {
      if (state === 'idle' && !tests.length) init();
      return frame(ts);
    },
    cancel() {
      cancelled = true;
      if (rafId) {
        caf(rafId);
        rafId = 0;
      }
      if (state !== 'done' && state !== 'idle') finish('cancelled');
      else if (state === 'idle') {
        state = 'done';
        result = { ok: true, partial: 'cancelled', cancelled: true, ranMs: 0, frames: 0, recommended: null };
        const fn = resolveFn;
        resolveFn = null;
        fn?.(result);
      }
    },
    get state() { return state; },
    get result() { return result; },
    get aborted() { return aborted; },
    get progress() {
      if (state === 'done') return 1;
      if (!tests.length) return 0;
      const done = tests.reduce((s, t) => s + Math.min(3, t.points.length) / 3, 0) / tests.length;
      return Math.min(0.99, state === 'measure' ? 0.3 + done * 0.7 : state === 'wake' ? 0.2 : 0.1);
    },
  };
  return api;
}
