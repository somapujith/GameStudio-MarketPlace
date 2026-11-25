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
import { LOAD_STEPS, applyModelTier, createBatcher, runAsync, runSync } from './loader.js';
import { WebglUnavailableError } from './renderer.js';
import { cameraProjector, pickFromProxies, pickBoxes, onScreen } from './picking.js';
import { edgeHint } from './camera.js';
import { hourAt, tickFrac } from './interp.js';
import * as models from '../models/index.js';

export { QUALITY, QUALITY_ORDER, pickQuality } from './quality.js';
export { getGfxPref, setGfxPref, GFX_PREFS } from './capabilities.js';
export { WebglUnavailableError } from './renderer.js';

const DEFAULT_HOUR = 9;
const PIN_HOLD_S = 4; // a lookAt that is never released lets go by itself after this long
const EDGE_MARGIN = 30; // px: where the edge hint sits inside the canvas border

/**
 * createTiffinScene(canvas, opts) builds everything in one go (tests, the screenshot tooling). createTiffinSceneAsync(canvas, opts) is the same build
 * cut into steps with a time budget per slice and opts.onProgress(p01, label): the loading screen keeps animating and input stays alive.
 * opts: { quality: 'auto' | tier (auto follows the player's Graphics setting, then the device probe), reducedMotion, onContextLost, onContextRestored, onProgress, onQuality }
 */
export function createTiffinScene(canvas, opts = {}) {
  return runSync(buildScene(canvas, opts, false));
}
export function createTiffinSceneAsync(canvas, opts = {}) {
  return runAsync(buildScene(canvas, opts, true), { onProgress: opts.onProgress, budgetMs: opts.budgetMs ?? 12, shouldAbort: opts.shouldAbort });
}

function* buildScene(canvas, { quality = 'auto', reducedMotion = false, onContextLost, onContextRestored, onQuality } = {}, isAsync = false) {
  const step = (key, p) => ({ label: LOAD_STEPS[key] || key, p });
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
  yield step('gpu', 0.08);
  scene.add(camera); // the viewmodel (the cook's own arms) is a child of the camera, so the camera has to be in the scene
  const lightApply = createLightApplier({ scene, renderer: gfx.renderer, quality: q0 });
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
  const projector = cameraProjector(camera, () => size);
  const L = makeLighting();
  const hlView = { camera, pxPerM: (d) => projector.pxPerM(d), minDim: () => Math.min(size.w, size.h) };
  let hourOverride = null;
  let disposed = false;
  const parked = []; // actors built once out of sight so their shaders are compiled (and stay cached) before the first customer walks up
  let running = false;
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
    if (batcher && !batcher.done && ++framesWithState > 40) batcher.step(5);
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
        if (batcher?.done && lastKey !== null && key !== lastKey) batcher.restore();
        lastKey = key;
        return orig(...a);
      };
    };
    for (const n of ['setStations', 'setSpots', 'setMenu']) guard(n);
  };

  const api = {
    setState(state, tickAt) {
      if (state && !stateSeen) {
        stateSeen = true;
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
      lightApply.dispose();
      gfx.dispose();
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
        if (batcher && !batcher.done && ++framesWithState > 40) batcher.step(1000);
      },
      /** Runs the batcher to completion now (tests, benchmarks). */
      batchNow() {
        startBatcher();
        while (batcher && !batcher.done) batcher.step(1000);
        return batcher?.stats;
      },
    },
  };
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
    if (isAsync && typeof gfx.renderer.compileAsync === 'function') yield gfx.renderer.compileAsync(scene, camera);
    else gfx.renderer.compile(scene, camera);
    for (const m of parked) m.group.visible = false;
    gfx.render(0.016); // the post passes compile on their first run
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
