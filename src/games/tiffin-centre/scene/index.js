// Tiffin Centre 3D scene, FIRST PERSON: createTiffinScene(canvas, { quality, reducedMotion }) -> the API of plan section 5 + 2c:
// setState / handleEvents / setMe / setHighlight / pick / project / resize / start / stop / dispose / getQuality / onQuality, the HUD
// runner's getAvatarX / onAvatarArrive, setInsets, and the head: lookBy / lookAt / getLook, plus setViewmodel / setReducedMotion / speak.
// Everything is procedural: no external assets. You see through the local cook's eyes; the cook's body is never drawn.
import { Vector3 } from 'three';
import { HOME_X } from '../../../../shared/tiffin-centre/movement.js';
import { createRenderer } from './renderer.js';
import { createLightApplier } from './light-apply.js';
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
import { QUALITY, QUALITY_ORDER, pickQuality } from './quality.js';
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
  // the tier: an explicit one wins; 'auto' follows the player's Graphics setting, then the device probe
  const explicit = QUALITY_ORDER.includes(quality);
  const caps = probeBrowser();
  const verdict = explicit ? { tier: quality, reasons: ['requested'], pref: quality, auto: null } : resolveTier(getGfxPref(), caps);
  if (!verdict.tier) throw new WebglUnavailableError(verdict.reasons[0]);
  const q0 = pickQuality(verdict.tier);
  const auto = !explicit && verdict.pref === 'auto';
  yield step('gpu', 0.02);
  applyModelTier(q0);
  // an aborted or failed build gives back what it already made (generator return() runs this finally)
  const undo = [];
  let built = false;
  try {
  const tr = createTracker();
  const gfx = createRenderer(canvas, { quality: q0, auto, onContextLost, onContextRestored, onQuality });
  undo.push(() => gfx.dispose(), () => tr.dispose());
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
  let running = false;
  let firstFrame = false;
  let raf = 0;
  let last = 0;
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

  const tick = (nowMs, renderIt = true) => {
    const rawDt = Math.max(0, (nowMs - last) / 1000);
    last = nowMs;
    const dt = Math.min(rawDt, 0.1);
    t += dt;
    const now = performance.now();
    const st = sync.state;
    const hour = hourOverride ?? (st ? hourAt(st, tickFrac(now, lastTickAt)) : DEFAULT_HOUR);
    lightingAt(hour, L, sync.world); // + the overcast / wet look of the rain event and the power cut (smoothed levels from the sync layer)
    lightApply.apply(L);
    stall.setLight(L, t);
    street.setLight(L);
    stall.update(dt, t);
    street.update(dt, t);
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
    sync.update(dt, t, now, rig.lookDelta);
    fx.update(dt, (size.h * gfx.renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360)), camera.position);
    highlight.update(dt, t, sync.resolve, reduced, hlView);
    if (renderIt) gfx.render(rawDt);
  };
  const frame = (nowMs) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!gfx.shouldRender(nowMs)) return; // the tier's frame cap (30 fps on lite)
    tick(nowMs);
    if (!firstFrame) {
      firstFrame = true;
      mark('tc:first-frame');
    }
    if (batcher && !batcher.done && ++framesWithState > 40) {
      batcher.step(5);
      if (batcher.done) finishBatch();
    } else warmShaders();
  };
  // the tab was hidden: nothing to draw, nothing to adapt to
  let wantRun = false;
  const onVisibility = () => {
    if (disposed) return;
    if (typeof document !== 'undefined' && document.hidden) {
      if (running) {
        cancelAnimationFrame(raf);
        running = false;
        wantRun = true;
      }
    } else if (wantRun) {
      wantRun = false;
      running = true;
      last = performance.now();
      gfx.holdAdaptation(2);
      raf = requestAnimationFrame(frame);
    }
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility, false);

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
      if (warmer.done) mark('tc:warm-done');
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
      size.w = Math.max(2, w);
      size.h = Math.max(2, h);
      gfx.resize(size.w, size.h);
      rig.setAspect(size.w / size.h, size.w, size.h);
    },
    start() {
      if (running || disposed) return;
      if (typeof document !== 'undefined' && document.hidden) {
        wantRun = true; // starts when the tab comes back
        return;
      }
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      wantRun = false;
      cancelAnimationFrame(raf);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      api.stop();
      fontsDoc?.removeEventListener?.('loadingdone', repaint);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility, false);
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
    getTierInfo: () => ({ tier: gfx.quality, start: q0, pref: verdict.pref, auto: verdict.auto, reasons: verdict.reasons, caps, summary: describeCaps(caps, verdict), scale: gfx.scale }),
    /** The player's Graphics setting (auto | high | medium | low | lite). An explicit tier applies now (to what is built from now on) and in full next time. */
    setGraphics(pref) {
      const v = setGfxPref(pref);
      if (QUALITY_ORDER.includes(v) && v !== gfx.quality) gfx.setQuality(v, 'Graphics setting');
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
      stall,
      street,
      sync,
      fx,
      rig,
      camera,
      /** Render one frame synchronously (headless checks without rAF). */
      step(dtSec = 1 / 60) {
        last = performance.now() - dtSec * 1000;
        tick(performance.now());
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
    last = performance.now() - 16;
    tick(performance.now(), false); // clock light, env map (PMREM), the stall's lights, the actors: everything but the draw
    yield step('batch', 0.9);
    // the static scenery is merged now, so the merged meshes (not the originals they replace) are what gets compiled
    if (batcher) {
      while (!batcher.done) {
        batcher.step(6);
        yield step('batch', 0.9 + 0.03 * (batcher.progress ?? 0));
      }
      finishBatch();
      last = performance.now() - 16;
      tick(performance.now(), false); // the batcher drove the light through a whole day: put the real one back
    }
    // whole top-level groups, not their children: every compile() call walks the whole scene to gather its lights, so ~230 small chunks cost 1.7 s of
    // traversals for 124 programs; behind the loading screen a chunk may take as long as it likes
    const w = createProgramWarmer({ renderer: gfx.renderer, scene, camera, post: !!gfx.cfg.post, hiddenLights: !!gfx.cfg.lights, extras: [], bigChunk: Infinity });
    while (!w.done) {
      w.step(5);
      yield step('shaders', 0.93);
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
    settledAtLoad = true;
    gfx.render(0.016); // uploads, the shadow-pass and post programs: behind the loading screen, not in the first frame
    mark('tc:first-render');
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
  gfx.holdAdaptation(3);
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
