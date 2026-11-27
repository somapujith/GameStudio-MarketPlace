// Tiffin Centre 3D scene, FIRST PERSON: createTiffinScene(canvas, { quality, reducedMotion }) -> the API of plan section 5 + 2c:
// setState / handleEvents / setMe / setHighlight / pick / project / resize / start / stop / dispose / getQuality / onQuality, the HUD
// runner's getAvatarX / onAvatarArrive, setInsets, and the head: lookBy / lookAt / getLook, plus setViewmodel / setReducedMotion / speak.
// Everything is procedural: no external assets. You see through the local cook's eyes; the cook's body is never drawn.
import { Vector3 } from 'three';
import { HOME_X } from '../../../../shared/tiffin-centre/movement.js';
import {
  CHANGE_NONE, classifyGpu, createAdaptiveQuality, createGpuTimer, createLoop, createTierMemory, formatCensus, probeGpu, programCensus, runStandaloneCalibration, shouldCalibrate, viewportClass,
  watchDeviceHints,
} from '../../../platform/gfx/index.js';
import { createRenderer } from './renderer.js';
import { createLightApplier } from './light-apply.js';
import { createLightPool } from './light-pool.js';
import { lightingAt, makeLighting } from './lighting.js';
import { createCameraRig } from './rig.js';
import { createStall } from './stall.js';
import { createStreet } from './street.js';
import { createFx } from './fx.js';
import { createHighlight } from './highlight.js';
import { createSync } from './sync.js';
import { makeArt } from './art.js';
import { createTracker } from './tracker.js';
import { whenFontsReady } from './textures.js';
import { DRAW_CALL_BUDGET, GFX_GAME_KEY, GOVERNOR_OPTIONS, QUALITY, QUALITY_ORDER, SCALE_LADDER, SCALE_MIN, TIER_COST, TIFFIN_TIER_MODELS, pickQuality, recommendStart } from './quality.js';
import { combineFpsCap, createGovernorFeed, startTier, usableCalibration } from './adapt.js';
import { describeCaps, getGfxPref, probeBrowser, resolveTier, setGfxPref } from './capabilities.js';
import { LOAD_STEPS, applyModelTier, createBatcher, createProgramWarmer, programsStatus, runAsync, runSync, sleep } from './loader.js';
import { DISH_IDS } from '../../../../shared/tiffin-centre/catalog.js';
import { WebglUnavailableError } from './renderer.js';
import { cameraProjector, pickFromProxies, pickBoxes, onScreen } from './picking.js';
import { edgeHint } from './camera.js';
import { hourAt, tickFrac } from './interp.js';
import * as models from '../models/index.js';
import { SHADOW_LAYER, createShadowProxy, disposeFlatMaterials, disposeUberMaterials } from '../models/merge.js';
import { disposeBakedMaterials } from '../models/baked.js';

export { QUALITY, QUALITY_ORDER, pickQuality } from './quality.js';
export { getGfxPref, setGfxPref, GFX_PREFS } from './capabilities.js';
export { WebglUnavailableError } from './renderer.js';

/** A User Timing mark (the load timeline in docs/perf/tf-cpu.md and scripts/perf/tf-load.mjs read the `tc:*` ones). Free when the browser has none. */
const mark = (name) => {
  try {
    performance.mark(name);
  } catch {
    /* no User Timing */
  }
};

const DEFAULT_HOUR = 9;
const PIN_HOLD_S = 4; // a lookAt that is never released lets go by itself after this long
const EDGE_MARGIN = 30; // px: where the edge hint sits inside the canvas border

/**
 * createTiffinScene(canvas, opts) builds everything in one go (tests, the screenshot tooling). createTiffinSceneAsync(canvas, opts) is the same build
 * cut into steps with a time budget per slice and opts.onProgress(p01, label): the loading screen keeps animating and input stays alive.
 * opts: { quality: 'auto' | tier (auto follows the player's Graphics setting, then the device probe), reducedMotion, onContextLost, onContextRestored, onProgress, onQuality,
 *         initialState / initialTickAt / meId (the session's first state: with it the async build settles the scene BEFORE it is shown: stations and their lights,
 *         the env map, the batched scenery, and every shader linked and ready, so the first frame never waits for a compile), size: { w, h } }
 */
export function createTiffinScene(canvas, opts = {}) {
  return runSync(buildScene(canvas, opts, false));
}
export function createTiffinSceneAsync(canvas, opts = {}) {
  return runAsync(buildScene(canvas, opts, true), { onProgress: opts.onProgress, budgetMs: opts.budgetMs ?? 12, shouldAbort: opts.shouldAbort });
}

function* buildScene(canvas, { quality = 'auto', reducedMotion = false, onContextLost, onContextRestored, onQuality, initialState = null, initialTickAt, meId = null, size: initialSize = null } = {}, isAsync = false) {
  const step = (key, p) => {
    mark(`tc:step:${key}:${p}`);
    return { label: LOAD_STEPS[key] || key, p };
  };
  // the tier: an explicit one wins; 'auto' follows the player's Graphics setting, then the device probe (capabilities.js: the capability gate and the legacy
  // caps for phones / Safari), then the shared engine layer (src/platform/gfx): GPU class, what worked last time on this GPU + viewport, a start-up calibration
  const explicit = QUALITY_ORDER.includes(quality);
  const caps = probeBrowser();
  const verdict = explicit ? { tier: quality, reasons: ['requested'], pref: quality, auto: null } : resolveTier(getGfxPref(), caps);
  if (!verdict.tier) throw new WebglUnavailableError(verdict.reasons[0]);
  const auto = !explicit && verdict.pref === 'auto';
  const prefNow = QUALITY_ORDER.includes(verdict.pref) ? verdict.pref : 'auto';
  yield step('gpu', 0.02);
  const vw = Math.max(2, initialSize?.w || (typeof window !== 'undefined' ? window.innerWidth : 0) || 1280);
  const vh = Math.max(2, initialSize?.h || (typeof window !== 'undefined' ? window.innerHeight : 0) || 720);
  const vdpr = Math.max(1, caps.dpr || (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
  // the GPU class from what the capability probe already read (one throw-away context, not two): the renderer string and the caps the classifier looks at
  let gpu0 = null;
  try {
    gpu0 = caps.renderer
      ? classifyGpu({
        renderer: caps.renderer,
        vendor: caps.vendor,
        caps: { webgl: caps.webgl, maxTexture: caps.maxTexture, maxSamples: caps.maxSamples, maxAniso: caps.maxAniso, halfFloatRT: caps.halfFloatRT, floatRT: caps.floatRT, parallelCompile: caps.parallelCompile, timerQuery: false },
      })
      : probeGpu() || classifyGpu({});
  } catch {
    gpu0 = classifyGpu({ renderer: caps.renderer || '' });
  }
  // the start-up benchmark (~250 ms on a throw-away context, the loading screen keeps animating): only when nothing is remembered for this GPU + viewport and the
  // player did not choose a tier; the async build only (the synchronous build is for tests and screenshot tooling)
  let calibration = null;
  if (isAsync && auto) {
    let mem = null;
    try {
      mem = createTierMemory({ game: GFX_GAME_KEY }).get(gpu0.key, viewportClass(vw, vh, vdpr));
    } catch {
      mem = null;
    }
    if (shouldCalibrate({ gpu: gpu0, memory: mem, pref: prefNow, tiers: QUALITY_ORDER }).run) {
      yield runStandaloneCalibration({ width: vw, height: vh, dpr: vdpr, gpu: gpu0, tiers: TIFFIN_TIER_MODELS }).then((r) => {
        calibration = r;
      });
      // an INCOMPLETE benchmark (a test never got a slice: the machine was too busy, or no timer queries) fills the missing units with pessimistic sentinels (25 ns / pixel,
      // 60 us / call): reading those as a verdict put a perfectly good laptop on `low` for weeks through tier memory. Its verdict is not used at all: the class decides the
      // start and the governor corrects it from real frames. Only a COMPLETE, confident run may move the start tier.
      if (calibration && !usableCalibration(calibration)) calibration = null;
      // the shared estimate is max(cpu, gpu) of generic tier models; Tiffin's frames are a fixed draw cost PLUS a pixel cost (quality.js TIER_REF): the measured
      // units (fill ns / pixel, call us) go through Tiffin's own table, and a post tier at a modest scale beats the plain tier at full resolution
      if (calibration?.ok && calibration.units && calibration.recommended) {
        const rec = recommendStart({
          units: calibration.units, viewport: { w: vw, h: vh, dpr: vdpr }, capTier: gpu0.tierCap, budgetMs: calibration.budgetMs || 1000 / 60, confident: calibration.recommended.confident !== false,
        });
        calibration = { ...calibration, recommended: { ...calibration.recommended, tier: rec.tier, scale: rec.scale, estimates: rec.estimates, reasons: rec.reasons, confident: rec.confident } };
      }
    }
  }
  let gov = null; // the frame governor (below): the callbacks of createAdaptiveQuality reach it through this binding
  let gfx = null;
  let switchTierFn = null; // assigned once the scene exists (the governor's onTier is bound before it)
  const aq = createAdaptiveQuality({
    game: GFX_GAME_KEY, tiers: QUALITY_ORDER, pref: prefNow, viewport: { w: vw, h: vh, dpr: vdpr }, gpu: gpu0, calibration,
    callBudgets: DRAW_CALL_BUDGET, scaleMin: SCALE_MIN, ladder: SCALE_LADDER, tierCost: TIER_COST,
    governor: { ...GOVERNOR_OPTIONS },
    onScale: (s) => gfx?.setScale(s),
    onTier: (tier, info) => switchTierFn?.(tier, info.reason, info.scale),
  });
  gov = aq.governor;
  // the verdict above is a ceiling too (phones, Safari, no float targets: chooseTier): an Auto start never exceeds it and the governor never climbs past it
  const q0 = pickQuality(startTier({ auto, initial: aq.initial.tier, ceiling: verdict.tier }));
  if (auto) {
    if (q0 !== aq.initial.tier) gov.setTier(q0, { scale: aq.initial.scale });
    gov.setMaxTier(verdict.tier);
  }
  applyModelTier(q0);
  // an aborted or failed build gives back what it already made (generator return() runs this finally)
  const undo = [];
  let built = false;
  try {
  const tr = createTracker();
  gfx = createRenderer(canvas, { quality: q0, onContextLost, onContextRestored, onQuality });
  undo.push(() => gfx.dispose(), () => tr.dispose());
  gfx.holdAdaptation = (sec = 2.5) => gov.hold(sec * 1000); // tf-shot, the bench and the tier switch hold the governor through this
  if (aq.initial.scale < 1) gfx.setScale(aq.initial.scale);
  const { scene, camera } = gfx;
  // three.js reads three shader / link logs per program the first time it is drawn, and each read is a synchronous round trip to the GPU process:
  // 372 round trips for the 124 programs of this scene, measured at 6 s of the first frame on a shared GPU (17 s of a 20 s load before the programs were
  // cut down). Shipped shaders are fixed, so the checks are on only where a developer looks: the dev server and ?tcshaders=1.
  gfx.renderer.debug.checkShaderErrors = !!(import.meta.env?.DEV || (typeof location !== 'undefined' && /[?&]tcshaders=1\b/.test(location.search)));
  yield step('gpu', 0.08);
  scene.add(camera); // the viewmodel (the cook's own arms) is a child of the camera, so the camera has to be in the scene
  const lightApply = createLightApplier({ scene, renderer: gfx.renderer, quality: q0 });
  // the shadow pass also draws SHADOW_LAYER (the static casters' proxy meshes, see models/merge.js createShadowProxy); the main camera never does
  lightApply.sun.shadow.camera.layers.enable(SHADOW_LAYER);
  gfx.onChange((q) => {
    lightApply.applyQuality(q);
    applyModelTier(q); // customers and dishes built from now on use the new tier
  });
  const art = makeArt(tr);
  const cfg = QUALITY[q0];
  let reduced = !!reducedMotion;
  const rig = createCameraRig(camera, { reducedMotion: reduced });
  // the procedural surface textures bake one by one (each is a slice of its own) instead of all inside the first stall / street build
  art.setQuality?.(cfg);
  const WARM = ['steel', 'paintedWood', 'timber', 'tin', 'concrete', 'paving', 'asphalt', 'plaster', 'brick', 'bamboo', 'tarp', 'cloth', 'grunge'];
  for (let i = 0; i < WARM.length; i++) {
    try {
      art[WARM[i]]?.();
    } catch {
      /* the stall paints it on demand */
    }
    yield step('textures', 0.1 + (0.3 * (i + 1)) / WARM.length);
  }
  const stall = createStall({ scene, art, tr, quality: cfg });
  undo.push(() => stall.dispose());
  yield step('stall', 0.55);
  const street = createStreet({ scene, art, tr, quality: cfg });
  undo.push(() => street.dispose());
  yield step('street', 0.7);
  const fx = createFx({ scene, art, tr, quality: cfg, reducedMotion: reduced });
  undo.push(() => fx.dispose());
  const highlight = createHighlight({ scene, art, tr });
  undo.push(() => highlight.dispose());
  const sync = createSync({ scene, camera, stall, fx, art, tr, quality: cfg, reducedMotion: reduced, onShake: (a) => rig.shake(a) });

  // the stall's small lights (station flames, candles, the prep lamp) are served by a few proxy lights: see light-pool.js. They are pooled BEFORE anything compiles, so
  // the shaders are built for the pooled light count, and again whenever the stall rebuilds its stations / spots (the new lights must not show up in a shader).
  const lightPool = createLightPool({ scene, k: cfg.lightPool || 0 });
  lightPool.refresh();
  for (const n of ['setStations', 'setSpots', 'setMenu']) {
    const orig = stall[n];
    stall[n] = (...a) => {
      const r = orig(...a);
      lightPool.refresh();
      return r;
    };
  }
  undo.push(() => lightPool.dispose());

  const size = { w: 300, h: 150 };
  if (initialSize && initialSize.w > 1 && initialSize.h > 1) {
    // the canvas size is known before the build: the render targets of the post pipeline are made once, at their real size
    size.w = Math.max(2, initialSize.w);
    size.h = Math.max(2, initialSize.h);
    gfx.resize(size.w, size.h);
    rig.setAspect(size.w / size.h, size.w, size.h);
  }
  const projector = cameraProjector(camera, () => size);
  const L = makeLighting();
  const hlView = { camera, pxPerM: (d) => projector.pxPerM(d), minDim: () => Math.min(size.w, size.h) };
  let hourOverride = null;
  let disposed = false;
  const parked = []; // actors built once out of sight so their shaders are compiled (and stay cached) before the first customer walks up
  let firstFrame = false;
  let t = 0;
  let lastTickAt = null;
  let pinnedTarget = null; // lookAt(target): the head stays on it (for PIN_HOLD_S, or until it is released / the player looks around)
  let pinnedUntil = 0;
  const aimPt = { x: 0, y: 0, z: 0 };
  const pinBase = new Vector3();
  const pinTop = new Vector3();
  const projBase = new Vector3();
  const projTop = new Vector3();
  const projOut = { x: 0, y: 0, depth: 0, vx: 0, vy: 0 };
  const ndc = { x: 0, y: 0 };

  // text on the banner / menu board is painted with web fonts: repaint once they have loaded (and whenever more load)
  const repaint = () => {
    if (!disposed) stall.redrawText();
  };
  whenFontsReady().then(repaint);
  const fontsDoc = typeof document !== 'undefined' ? document.fonts : null;
  fontsDoc?.addEventListener?.('loadingdone', repaint);

  let poolScan = 0;
  // main-thread time per section of a frame, for the benchmark tooling (scene.debug.profile): off in play, then one null check per section
  let prof = null;
  const lap = (k) => {
    if (!prof) return;
    const n = performance.now();
    prof.sum[k] = (prof.sum[k] || 0) + (n - prof.t);
    prof.t = n;
  };
  const tick = (dtSec, renderIt = true) => {
    const dt = Math.min(Math.max(dtSec, 0), 0.1);
    t += dt;
    const now = performance.now();
    if (prof) {
      prof.t = now;
      prof.frames++;
    }
    const st = sync.state;
    const hour = hourOverride ?? (st ? hourAt(st, tickFrac(now, lastTickAt)) : DEFAULT_HOUR);
    lightingAt(hour, L, sync.world); // + the overcast / wet look of the rain event and the power cut (smoothed levels from the sync layer)
    lightApply.apply(L);
    lap('light');
    stall.setLight(L, t);
    street.setLight(L);
    lap('setLight');
    stall.update(dt, t);
    lap('stall');
    street.update(dt, t);
    lap('street');
    // the cook walks (shared kinematics), then the eye follows, then everything that depends on where the eye is
    sync.advance(dt);
    const me = sync.me();
    rig.setBody(me ? me.x : HOME_X, me ? me.dir : 0);
    rig.setAuto(sync.autoAim(aimPt) ? aimPt : null);
    if (pinnedTarget && t > pinnedUntil) {
      pinnedTarget = null;
      rig.setPinned(null);
    }
    if (pinnedTarget) {
      if (pinnedTarget.fixed) rig.setPinned(pinnedTarget.fixed);
      else if (sync.resolve(pinnedTarget, pinBase, pinTop)) rig.setPinned(pinBase);
      else {
        pinnedTarget = null;
        rig.setPinned(null);
      }
    }
    rig.update(dt, t);
    sync.setSun(L.sunDir); // where a person's shadow falls (a person outside the view is hidden only when their shadow is outside it too)
    lap('rig');
    sync.update(dt, t, now, rig.lookDelta);
    lap('sync');
    // the glow / particle sizes are in pixels of the PICTURE that is rendered (canvas ratio x the dynamic render scale)
    fx.update(dt, (size.h * gfx.pixelRatio) / (2 * Math.tan((camera.fov * Math.PI) / 360)), camera.position);
    lap('fx');
    highlight.update(dt, t, sync.resolve, reduced, hlView);
    lap('highlight');
    if (++poolScan >= 90) {
      poolScan = 0;
      lightPool.refresh(); // a light the stall made without going through setStations / setSpots / setMenu is pooled within 1.5 s
    }
    lightPool.update(dt, camera.position);
    lap('lightPool');
    if (renderIt) {
      gfx.render(dt);
      lap('render');
    }
  };

  // ---- the frame loop (gfx createLoop): rAF, the tier's frame cap, tab hidden / shown without a catch-up step, GPU timing, and the governor fed every frame ----
  // A tier change is hidden behind a held frame (see switchTier): `switching` frames update the game but do not draw.
  const timer = createGpuTimer(gfx.renderer.getContext(), { disjointMs: 500 }); // (the disjoint flag is a synchronous round trip to the GPU process: not every frame)
  let timerPaused = false; // the benchmark tooling times single passes itself (scripts/perf/tf-probe.mjs): one TIME_ELAPSED query at a time
  const loopTimer = timer.supported
    ? { supported: true, begin: () => !timerPaused && timer.begin(), end: () => timer.end(), get lastMs() { return timer.lastMs; } }
    : null;
  gfx.pauseTimer = (p) => {
    timerPaused = !!p;
  };
  gfx.gpuTimer = timer;
  // a frame within a compile storm (a program appeared in the last 0.6 s and the frame itself is a stall) says nothing about what the device renders
  let sw = null; // the tier switch in flight (see switchTier)
  // frames are not judged while the tier switches or while the post-load shader warm-up builds one of each dish (a frame of its own work each, 45 programs): that
  // warm-up is what sank the old scaler to 0.5 in the first seconds; the governor starts looking when it is done (plus the hold below)
  const govFeed = createGovernorFeed(gov, () => (gfx.renderer.info.programs ? gfx.renderer.info.programs.length : 0), {
    none: CHANGE_NONE,
    paused: () => !!sw || (!!warmer && !warmer.done),
  });
  let appliedCap = -1;
  const applyFpsCap = () => {
    appliedCap = gov.fpsCap || 0;
    loop.setMaxFps(combineFpsCap(gfx.cfg.fpsCap || 0, appliedCap));
  };
  const frame = (alpha, dt) => {
    if (disposed) return;
    if (gov.fpsCap !== appliedCap) applyFpsCap();
    if (sw) {
      // a tier switch is linking its shaders: the game keeps running, the picture holds its last frame; the frame that finishes the switch is the first one drawn
      tick(dt, false);
      if (stepSwitch()) gfx.render(Math.min(dt, 0.1));
      return;
    }
    tick(dt);
    if (!firstFrame) {
      firstFrame = true;
      mark('tc:first-frame');
    }
    if (batcher && !batcher.done && ++framesWithState > 40) {
      batcher.step(5);
      if (batcher.done) finishBatch();
    } else warmShaders();
  };
  const loop = createLoop({ render: frame, governor: govFeed, info: gfx.renderer.info, gpuTimer: loopTimer, maxFps: gfx.cfg.fpsCap || 0, maxDelta: 0.1 });
  gov.setHints({ capFps: gfx.cfg.fpsCap || 0 }); // lite is capped at 30 fps: the governor's budget is that frame, not 16.7 ms
  const stopHints = watchDeviceHints(gov); // data saver / low battery: 30 fps cap
  // a tier change: the tier's own frame cap and the governor's budget follow it
  gfx.onChange(() => {
    lightPool.setK(gfx.cfg.lightPool || 0);
    gov.setHints({ capFps: gfx.cfg.fpsCap || 0 });
    applyFpsCap();
  });

  /**
   * The governor (or the Graphics setting) asks for tier `tier`. A new tier is a new set of shader programs (tone mapping, output colour space, shadows and the
   * light set are all part of the program key): compiling them on the first draw froze the page for seconds (one 19 s task under load). So while the loop is running
   * the switch happens BEHIND A HELD FRAME: the new tier's state is set at once (setQuality with `defer`: the canvas keeps its size and its last picture), every program
   * is compiled through the browser's parallel link (the warm-up of the load, whole top-level groups), polled until ready, then primed in 25 ms slices (the first
   * synchronous query of a program is its real cost on ANGLE), and only then is the first frame of the new tier drawn. The game keeps running, no frame is a long task,
   * the picture holds for the length of the compile (a second or two on a warm shader cache). Not running (a test, a hidden tab): rebuilt at once.
   * `scale` is the render scale to resume at.
   */
  const switchTier = (tier, reason, scale) => {
    if (disposed || !gfx || tier === gfx.quality || sw) return; // (a request while one is in flight is dropped: the governor asks again if the problem is still there)
    if (!loop.running || gfx.lost || !(typeof gfx.renderer.compile === 'function')) {
      gfx.setQuality(tier, reason, scale);
      gov.hold(GOVERNOR_OPTIONS.tierHoldMs ?? 2500);
      return;
    }
    mark(`tc:tier-switch-start:${tier}`);
    const known = new Set((gfx.renderer.info.programs || []).map((p) => p.id));
    gfx.setQuality(tier, reason, scale, { defer: true });
    const warmer = createProgramWarmer({ renderer: gfx.renderer, scene: gfx.scene, camera: gfx.camera, post: !!gfx.cfg.post, hiddenLights: !!gfx.cfg.lights, extras: [], bigChunk: Infinity });
    sw = { tier, stage: 'kick', known, warmer, progs: null, k: 0, t0: performance.now(), tLink: 0 };
  };
  switchTierFn = switchTier;
  /** One slice of the tier switch per frame. Returns true on the frame that finishes it (the caller draws that frame). */
  const stepSwitch = () => {
    const s = sw;
    if (!s) return false;
    const now = performance.now();
    if (s.stage === 'kick') {
      s.warmer.step(5);
      if (s.warmer.done) {
        try {
          gfx.post.prelink(gfx.rawCompile);
        } catch {
          /* linked on first draw */
        }
        s.stage = 'link';
        s.tLink = now;
      }
    } else if (s.stage === 'link') {
      const { ready, total } = programsStatus(gfx.renderer);
      if (ready >= total || now - s.tLink > 20000) {
        s.progs = (gfx.renderer.info.programs || []).filter((p) => !s.known.has(p.id));
        s.stage = 'prime';
      }
    } else if (s.stage === 'prime') {
      const tp = performance.now();
      while (s.k < s.progs.length && performance.now() - tp < 25) {
        try {
          s.progs[s.k].getUniforms();
          s.progs[s.k].getAttributes();
        } catch {
          /* a program that failed to link: the draw will show it */
        }
        s.k++;
      }
      if (s.k >= s.progs.length) s.stage = 'commit';
    }
    if (s.stage !== 'commit') return false;
    gfx.commitCanvas();
    mark(`tc:tier-switch-done:${s.tier}:${Math.round(now - s.t0)}ms:${s.progs.length}programs`);
    tierSwitches.push({ tier: s.tier, ms: Math.round(now - s.t0), programs: s.progs.length });
    sw = null;
    gov.hold(GOVERNOR_OPTIONS.tierHoldMs ?? 2500);
    return true;
  };
  const tierSwitches = []; // [{ tier, ms, programs }]: what each tier switch of this session cost (scene.debug.tierSwitches)

  // batching of the static scenery (see loader.js): after the first state has arrived, spread over frames
  let batcher = null;
  let shadowProxy = null;
  /** The batcher is done: the static casters hand their shadow to a few proxy meshes (one shadow draw call per side mode instead of ~140). */
  const finishBatch = () => {
    mark('tc:batch-done');
    if (shadowProxy || disposed || !(gfx.cfg.shadow > 0)) return;
    try {
      shadowProxy = createShadowProxy([stall.root, street.root], { isStatic: (o) => batcher.statics.has(o) });
    } catch (err) {
      console.warn('[tiffin] shadow proxy skipped', err);
    }
  };
  let framesWithState = 0;
  let stateSeen = false;
  const Lp = makeLighting();
  const startBatcher = () => {
    if (batcher || !cfg.batchStatics || disposed) return;
    for (const s of stall.stations.values()) s.group.userData.noMerge = true;
    let tp = 0;
    batcher = createBatcher({
      roots: [{ name: 'stall', root: stall.root }, { name: 'street', root: street.root }],
      flatten: !!cfg.flatScenery,
      uber: !cfg.flatScenery,
      drive(i, n) {
        lightingAt(6 + (16 * i) / n, Lp);
        tp += 0.05;
        stall.setLight(Lp, tp);
        street.setLight(Lp);
        stall.update(0.05, tp);
        street.update(0.05, tp);
      },
    });
    // anything the stall rebuilds later (stations, spots, menu) must find its original meshes again
    const guard = (name) => {
      const orig = stall[name];
      let lastKey = null;
      stall[name] = (...a) => {
        const key = JSON.stringify(a);
        if (batcher?.done && lastKey !== null && key !== lastKey) {
          shadowProxy?.dispose(); // the originals come back and cast for themselves
          shadowProxy = null;
          batcher.restore();
        }
        lastKey = key;
        return orig(...a);
      };
    };
    for (const n of ['setStations', 'setSpots', 'setMenu']) guard(n);
  };

  // shader warm-up (loader.js): once the first state is in and the batcher is done, compile what the game really draws with, a slice per frame,
  // so no program compiles mid-shift (it restarts after a tier change: the programs differ per tier)
  let warmer = null;
  let warmFrames = 0;
  let settleInfo = null; // { linked, builtByFirstRender, names }: what settleFirstFrame left for the first real frame
  let settledAtLoad = false; // the scene itself was compiled behind the loading screen (settleFirstFrame): only the extras (one of each dish) are left
  const warmShaders = () => {
    if (!stateSeen || (batcher && !batcher.done) || disposed) return;
    if (!warmer) {
      if (++warmFrames < 30) return;
      warmer = createProgramWarmer({
        renderer: gfx.renderer, scene, camera, post: !!gfx.cfg.post, hiddenLights: !!gfx.cfg.lights, units: !settledAtLoad,
        extras: DISH_IDS.map((id) => () => models.buildDish(id, 'good')),
      });
    }
    if (!warmer.done) {
      warmer.step(3);
      if (warmer.done) {
        mark('tc:warm-done');
        gov.hold(GOVERNOR_OPTIONS.warmHoldMs ?? 1500); // the last compile's frames are over: let the window refill with normal ones
      }
    }
  };
  gfx.onChange(() => {
    warmer?.cancel();
    warmer = null;
    warmFrames = 0;
    settledAtLoad = false; // a new tier is a new set of programs
  });

  const api = {
    setState(state, tickAt) {
      if (state && !stateSeen) {
        stateSeen = true;
        mark('tc:first-state');
        startBatcher();
      }
      lastTickAt = tickAt ?? performance.now();
      sync.setState(state, lastTickAt);
    },
    handleEvents: (events) => sync.handleEvents(events),
    setMe: (id) => sync.setMe(id),
    setHighlight: (target) => highlight.set(target),
    /**
     * What is under the pointer (clientX / clientY as from a pointer event): a slot, station, customer or the bin. Screen-space discs of at
     * least 44 px (a slot beats its station), then a cheap ray against the big boxes for anything the discs missed.
     */
    pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      camera.updateMatrixWorld();
      size.w = r.width || size.w;
      size.h = r.height || size.h;
      const px = clientX - r.left;
      const py = clientY - r.top;
      if (px < 0 || py < 0 || px > size.w || py > size.h) return null;
      const proxies = sync.buildProxies();
      const hit = pickFromProxies(proxies, px, py, projector);
      if (hit) return hit;
      ndc.x = (px / size.w) * 2 - 1;
      ndc.y = -(py / size.h) * 2 + 1;
      return pickBoxes(proxies.boxes || [], camera, ndc.x, ndc.y);
    },
    /**
     * Where a target's bubble anchor is, in CSS px relative to the canvas: { x, y, visible, edge }. When it is off screen (or behind you)
     * `edge` = { side: 'left' | 'right' | 'behind', x, y } is where a HUD indicator should sit (on the canvas border); on screen edge.side = null.
     */
    project(target, out) {
      if (!out) out = { x: 0, y: 0, visible: false, edge: { side: null, x: 0, y: 0 } };
      if (!out.edge) out.edge = { side: null, x: 0, y: 0 };
      out.visible = false;
      out.edge.side = null;
      if (!sync.resolve(target, projBase, projTop)) return out;
      camera.updateMatrixWorld();
      projector.project(projTop, projOut);
      out.x = projOut.x;
      out.y = projOut.y;
      out.visible = projOut.depth > 0 && onScreen(projOut.x, projOut.y, size.w, size.h);
      if (!out.visible) edgeHint(projOut.x, projOut.y, projOut.depth, projOut.vx, projOut.vy, size.w, size.h, EDGE_MARGIN, out.edge);
      return out;
    },
    /** Turn the head by (dYaw, dPitch) radians: yaw > 0 turns to the cook's right (+x), pitch > 0 looks up. Limited by LAYOUT.view. */
    lookBy(dYaw, dPitch) {
      if (pinnedTarget) {
        pinnedTarget = null; // the player took the head back
        rig.setPinned(null);
      }
      rig.lookBy(dYaw, dPitch);
    },
    /**
     * Turn the head smoothly towards a target ({ kind: 'station' | 'slot' | 'customer' | 'bin' | 'hands', ... }) or a world point
     * ({ x, y, z }) and hold it; null releases it and the head recentres.
     */
    lookAt(target) {
      if (!target) {
        pinnedTarget = null;
        rig.setPinned(null);
        rig.recentre();
      } else if (target.kind) {
        pinnedTarget = target;
        pinnedUntil = t + PIN_HOLD_S;
      } else if (Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z)) {
        pinnedTarget = { fixed: { x: target.x, y: target.y, z: target.z } };
        pinnedUntil = t + PIN_HOLD_S;
      }
    },
    /** The head now: { yaw, pitch } (radians; yaw 0 faces the customers, > 0 right; pitch > 0 up). */
    getLook: (out) => rig.getLook(out),
    /** Show / hide the cook's own arms. */
    setViewmodel: (on) => sync.setViewmodel(on),
    /** No head bob, roll, breathing, shake; fewer particles. */
    setReducedMotion(b) {
      reduced = !!b;
      rig.setReducedMotion(reduced);
      fx.setReduced(reduced);
      sync.setReducedMotion(reduced);
    },
    /** fn({ type: 'power' | 'generator', on }) for the audio: the power cut itself, and the neighbour's generator a moment later. Returns an unsubscribe. */
    onCue: (fn) => sync.onCue(fn),
    /** A customer starts speaking for `ms` (their mouth and head move). */
    speak: (id, ms, intensity) => sync.speak(id, ms, intensity),
    setSpeaking: (id, ms, intensity) => sync.speak(id, ms, intensity),
    resize(w, h) {
      const nw = Math.max(2, w);
      const nh = Math.max(2, h);
      const changed = Math.abs(nw - size.w) > 0.5 || Math.abs(nh - size.h) > 0.5;
      size.w = nw;
      size.h = nh;
      gfx.resize(size.w, size.h);
      rig.setAspect(size.w / size.h, size.w, size.h);
      if (changed) gov.discontinuity(500); // the canvas is re-allocated: that frame is not evidence about the load
    },
    /** Starts (or resumes) the frame loop; the loop waits for the tab to be visible by itself, and its first frame has dt = 0 (no catch-up step). */
    start() {
      if (disposed) return;
      loop.start();
    },
    stop() {
      loop.stop();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      api.stop();
      loop.dispose();
      stopHints?.();
      timer.dispose();
      sw?.warmer?.cancel();
      sw = null;
      lightPool.dispose();
      fontsDoc?.removeEventListener?.('loadingdone', repaint);
      warmer?.cancel();
      shadowProxy?.dispose();
      batcher?.dispose();
      for (const a of parked) a.dispose?.();
      sync.dispose();
      scene.remove(camera);
      highlight.dispose();
      fx.dispose();
      street.dispose();
      stall.dispose();
      tr.dispose();
      models.disposeModelCache?.();
      disposeUberMaterials(); // module-level caches of shared materials: nothing may outlive the scene
      disposeFlatMaterials();
      disposeBakedMaterials();
      lightApply.dispose();
      gfx.dispose();
      // hand the GPU memory back now, not whenever the canvas happens to be collected (not in dev: StrictMode re-mounts onto the very same canvas)
      if (!import.meta.env?.DEV) {
        try {
          gfx.renderer.forceContextLoss?.();
        } catch {
          /* best effort */
        }
      }
    },
    getQuality: () => gfx.quality,
    /** What the device probe saw and why this tier was chosen: { tier, start, pref, auto, reasons, caps, summary, scale }. */
    getTierInfo: () => ({
      tier: gfx.quality, start: q0, pref: verdict.pref, auto: verdict.auto, reasons: verdict.reasons, caps, summary: describeCaps(caps, verdict), scale: gfx.scale,
      gfx: aq.describe(), governor: gov.lastReason,
    }),
    /** The player's Graphics setting (auto | high | medium | low | lite). An explicit tier applies now (to what is built from now on) and in full next time. */
    setGraphics(pref) {
      const v = setGfxPref(pref);
      if (QUALITY_ORDER.includes(v)) {
        if (v !== gfx.quality) switchTier(v, 'Graphics setting', 1);
        gov.setTier(v, { scale: 1, lock: true }); // an explicit tier: the governor only adapts the resolution
      } else {
        gov.setLock(false); // back to Auto: the governor owns the tier again (from where it stands)
        aq.forget();
      }
      return v;
    },
    getGraphics: () => getGfxPref(),
    /** Render resolution scale (dynamic resolution): 1 = full. */
    getRenderScale: () => gfx.scale,
    getBatchStats: () => (batcher ? { ...batcher.stats, done: batcher.done } : null),
    onQuality: (fn) => gfx.onChange(fn),
    // --- additions the HUD runner needs ---
    /** The local cook's current x along the kitchen line (same kinematics as the HUD's runner), or null if there is no such player. */
    getAvatarX: (id) => sync.getAvatarX(id),
    /** fn({ playerId, at, x }) when a cook finishes a walk. Returns an unsubscribe. */
    onAvatarArrive: (fn) => sync.onAvatarArrive(fn),
    /** HUD-safe insets as fractions of the viewport height ({ top, bottom }); null for the defaults. The picture is centred in what is left. */
    setInsets(i) {
      rig.setInsets(i);
    },
    /** For screenshots / tuning: force the clock hour (null = follow the state), and reach internals. */
    debug: {
      setHour: (h) => { hourOverride = h; },
      get gfx() { return gfx; },
      /** The shared frame governor, the loop and the adaptive-quality record (scripts/perf/tf-probe.mjs and the bench read their stats). */
      get governor() { return gov; },
      get loop() { return loop; },
      get aq() { return aq; },
      /** The pool that serves the stall's small lights through a few proxy lights (light-pool.js): setK(0) switches it off. */
      get lightPool() { return lightPool; },
      /** The start-up calibration result (null when none ran: a remembered tier, an explicit choice, the synchronous build): { units, recommended: { estimates } ... }. */
      get calibration() { return calibration; },
      /** The program census of the renderer (gfx warmup.js): which tokens split the programs. `census(true)` returns the formatted text. */
      census: (text = false) => {
        const c = programCensus(gfx.renderer);
        return text ? formatCensus(c) : c;
      },
      /** What each tier switch of this session cost: [{ tier, ms, programs }]. */
      get tierSwitches() { return tierSwitches; },
      get switching() { return !!sw; },
      /** Main-thread ms per section of a frame: profile.start(), later profile.stop() -> { frames, ms: { light, setLight, stall, street, rig, sync, fx, highlight, render } } (mean per frame). */
      profile: {
        start() {
          prof = { t: 0, frames: 0, sum: {} };
        },
        stop() {
          const p = prof;
          prof = null;
          if (!p) return null;
          const ms = {};
          for (const k of Object.keys(p.sum)) ms[k] = +(p.sum[k] / Math.max(1, p.frames)).toFixed(3);
          return { frames: p.frames, ms };
        },
      },
      /** Force a tier change the way the governor asks for one (tooling and tests). */
      switchTier: (tier, scale = 1) => switchTier(tier, 'debug', scale),
      /** What the load linked and what the first real frame still had to build (programs): see settleFirstFrame. */
      get settle() { return settleInfo; },
      stall,
      street,
      sync,
      fx,
      rig,
      camera,
      /** Render one frame synchronously (headless checks without rAF). */
      step(dtSec = 1 / 60) {
        tick(dtSec);
        if (batcher && !batcher.done && ++framesWithState > 40) {
          batcher.step(1000);
          if (batcher.done) finishBatch();
        }
      },
      /** Runs the batcher to completion now (tests, benchmarks). */
      /** Runs the shader warm-up to completion now (tests, benchmarks): { chunks, programs, ms, variants, extras }. */
      warmNow() {
        startBatcher();
        while (batcher && !batcher.done) batcher.step(1000);
        if (batcher?.done) finishBatch();
        warmFrames = 1e3;
        warmShaders();
        while (warmer && !warmer.done) warmer.step(1e6);
        return warmer?.stats;
      },
      batchNow() {
        startBatcher();
        while (batcher && !batcher.done) batcher.step(1000);
        if (batcher?.done) finishBatch();
        return batcher?.stats;
      },
    },
  };
  /**
   * The async build's last stage, with the session's first state in hand: put the scene in the exact condition it will be drawn in (the state's stations and
   * their lights, the clock's light, the env map, the merged scenery), then link every shader program for THAT condition on the browser's worker threads
   * and wait until they are all ready, then draw once behind the loading screen. three.js bakes the light count, the env map, the fog and the shadow flags
   * into every lit shader, so a program compiled for any other condition is thrown away: before this, 439 programs were compiled in a session of which
   * 101 were ever drawn, and the first frame blocked for 10 s on the compiles it needed.
   */
  function* settleFirstFrame() {
    api.setMe(meId);
    api.setState(initialState, initialTickAt ?? performance.now());
    mark('tc:state-applied');
    tick(0.016, false); // clock light, env map (PMREM), the stall's lights, the actors: everything but the draw
    yield step('batch', 0.9);
    // the static scenery is merged now, so the merged meshes (not the originals they replace) are what gets compiled
    if (batcher) {
      while (!batcher.done) {
        batcher.step(6);
        yield step('batch', 0.9 + 0.03 * (batcher.progress ?? 0));
      }
      finishBatch();
      tick(0.016, false); // the batcher drove the light through a whole day: put the real one back
    }
    // whole top-level groups, not their children: every compile() call walks the whole scene to gather its lights, so ~230 small chunks cost 1.7 s of
    // traversals for 124 programs; behind the loading screen a chunk may take as long as it likes
    const w = createProgramWarmer({ renderer: gfx.renderer, scene, camera, post: !!gfx.cfg.post, hiddenLights: !!gfx.cfg.lights, extras: [], bigChunk: Infinity });
    while (!w.done) {
      w.step(5);
      yield step('shaders', 0.93);
    }
    // the post passes (bloom, final, FXAA ...) link with the rest: each against the target it draws into (post.js prelink)
    try {
      gfx.post.prelink(gfx.rawCompile);
    } catch {
      /* they link on their first draw */
    }
    mark('tc:compile-kicked');
    // the links run on the browser's worker threads: poll (the page keeps painting the loading screen) until every program is ready
    const t0 = performance.now();
    for (;;) {
      const { ready, total } = programsStatus(gfx.renderer);
      yield step('shaders', 0.93 + 0.06 * (total ? ready / total : 1));
      if (ready >= total || performance.now() - t0 > 30000) break;
      yield sleep(25);
    }
    mark('tc:programs-ready');
    // "ready" is not "finished": on ANGLE / D3D11 a program is completed by its first synchronous query (uniform / attribute tables), one after the other on the GPU
    // process's main thread, 25 ms (warm shader cache) to 120 ms (cold) each: 168 programs were one 4 to 20 s task inside the hidden first render, a frozen page (and
    // Chrome's "page unresponsive" bar). Doing the queries here, a slice at a time, costs the same wall time but the loading bar keeps moving and no task is longer than ~150 ms.
    const progs = gfx.renderer.info.programs.slice();
    for (let k = 0; k < progs.length; ) {
      const tp = performance.now();
      while (k < progs.length && performance.now() - tp < 40) {
        try {
          progs[k].getUniforms();
          progs[k].getAttributes();
        } catch {
          /* a program that failed to link: the draw will show it */
        }
        k++;
      }
      yield step('shaders', 0.99 + 0.009 * (k / Math.max(1, progs.length)));
    }
    mark('tc:programs-primed');
    settledAtLoad = true;
    const known = new Set(progs.map((x) => x.id));
    gfx.render(0.016); // uploads, the shadow-pass and post programs: behind the loading screen, not in the first frame
    mark('tc:first-render');
    // what the first real frame still had to build (should be the shadow-pass and post programs only): kept for scene.debug.settle
    const added = gfx.renderer.info.programs.filter((x) => !known.has(x.id));
    settleInfo = { linked: progs.length, builtByFirstRender: added.length, names: added.map((x) => x.name || x.cacheKey?.slice(0, 40) || '?') };
    mark(`tc:first-render-new-programs:${added.length}`);
  }

  // compile every shader the first frames will need now (stall, street, a customer, a cook, the post passes), not when the first customer walks up
  try {
    // one of every kind of customer and a cook, parked out of sight: their programs (skin, eyes, hair, cloth variants) compile now, not mid-shift
    const kinds = models.CUSTOMER_KIND_IDS || ['office'];
    for (let i = 0; i < kinds.length + 1; i++) {
      const m = i < kinds.length ? models.buildCustomer(kinds[i], 7 + i) : models.buildAvatar({ color: '#ff8a1f', name: 'x' });
      m.group.position.set(0, -40, 0);
      scene.add(m.group);
      parked.push(m);
      yield step('people', 0.78 + (0.08 * (i + 1)) / (kinds.length + 1));
    }
    yield step('shaders', 0.88);
    camera.updateMatrixWorld();
    if (isAsync && initialState && typeof gfx.renderer.compile === 'function') {
      for (const m of parked) m.group.visible = false; // the warm-up compiles hidden objects too
      yield* settleFirstFrame();
    } else {
      if (isAsync && typeof gfx.renderer.compileAsync === 'function') yield gfx.renderer.compileAsync(scene, camera);
      else gfx.renderer.compile(scene, camera);
      for (const m of parked) m.group.visible = false;
      gfx.render(0.016); // the post passes compile on their first run
    }
  } catch (err) {
    console.warn('[tiffin] shader pre-compile skipped', err);
  }
  yield step('ready', 1);
  gov.hold(GOVERNOR_OPTIONS.loadHoldMs ?? 3000); // the first seconds after the load (uploads, the last compiles) are not evidence about the device
  built = true;
  return api;
  } finally {
    if (!built) {
      for (const fn of undo.reverse()) {
        try {
          fn();
        } catch {
          /* best effort */
        }
      }
    }
  }
}
