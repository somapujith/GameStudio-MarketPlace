// Tiffin Centre 3D scene: createTiffinScene(canvas, { quality, reducedMotion }) -> the API of plan section 5, plus a few additions
// the HUD runner needs (getAvatarX, onAvatarArrive) and small extras (setInsets, debug). Everything is procedural: no external assets.
import { Vector3 } from 'three';
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
import { cameraProjector, pickFromProxies, onScreen } from './picking.js';
import { hourAt, tickFrac } from './interp.js';
import * as models from '../models/index.js';

export { QUALITY, QUALITY_ORDER, pickQuality } from './quality.js';

const DEFAULT_HOUR = 9;

export function createTiffinScene(canvas, { quality = 'auto', reducedMotion = false, onContextLost, onContextRestored } = {}) {
  const q0 = pickQuality(quality);
  const auto = !QUALITY_ORDER.includes(quality);
  const tr = createTracker();
  const gfx = createRenderer(canvas, { quality: q0, auto, onContextLost, onContextRestored });
  const { scene, camera } = gfx;
  const lightApply = createLightApplier({ scene, renderer: gfx.renderer, quality: q0 });
  gfx.onChange((q) => lightApply.applyQuality(q));
  const art = makeArt(tr);
  const cfg = QUALITY[q0];
  const rig = createCameraRig(camera, { reducedMotion });
  const stall = createStall({ scene, art, tr, quality: cfg });
  const street = createStreet({ scene, art, tr, quality: cfg });
  const fx = createFx({ scene, art, tr, quality: cfg, reducedMotion });
  const highlight = createHighlight({ scene, art, tr });
  const sync = createSync({ scene, stall, fx, art, tr, quality: cfg, reducedMotion, onShake: (a) => rig.shake(a) });

  const size = { w: 300, h: 150 };
  const projector = cameraProjector(camera, () => size);
  const L = makeLighting();
  let hourOverride = null;
  let disposed = false;
  let running = false;
  let raf = 0;
  let last = 0;
  let t = 0;

  // text on the banner / menu board is painted with web fonts: repaint once they have loaded (and whenever more load)
  const repaint = () => {
    if (!disposed) stall.redrawText();
  };
  whenFontsReady().then(repaint);
  const fontsDoc = typeof document !== 'undefined' ? document.fonts : null;
  fontsDoc?.addEventListener?.('loadingdone', repaint);

  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    rig.setPointer(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
  };
  const onLeave = () => rig.setPointer(0, 0);
  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerleave', onLeave, { passive: true });

  const frame = (nowMs) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const rawDt = Math.max(0, (nowMs - last) / 1000);
    last = nowMs;
    const dt = Math.min(rawDt, 0.1);
    t += dt;
    const st = sync.state;
    const hour = hourOverride ?? (st ? hourAt(st, tickFrac(performance.now(), tickAtOf())) : DEFAULT_HOUR);
    lightingAt(hour, L);
    lightApply.apply(L);
    stall.setLight(L, t);
    street.setLight(L);
    stall.update(dt, t);
    street.update(dt, t);
    sync.update(dt, t, performance.now());
    fx.update(dt, (size.h * gfx.renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360)));
    highlight.update(dt, t, sync.resolve, reducedMotion);
    rig.update(dt, t);
    gfx.render(rawDt);
  };
  let lastTickAt = null;
  const tickAtOf = () => lastTickAt;

  const api = {
    setState(state, tickAt) {
      lastTickAt = tickAt ?? performance.now();
      sync.setState(state, lastTickAt);
    },
    handleEvents: (events) => sync.handleEvents(events),
    setMe: (id) => sync.setMe(id),
    setHighlight: (target) => highlight.set(target),
    /** CSS px relative to the canvas' client rect (clientX / clientY as from a pointer event). */
    pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      camera.updateMatrixWorld();
      size.w = r.width || size.w;
      size.h = r.height || size.h;
      return pickFromProxies(sync.buildProxies(), clientX - r.left, clientY - r.top, projector);
    },
    /** Where a target's bubble anchor is, in CSS px relative to the canvas: { x, y, visible }. */
    project(target, out = { x: 0, y: 0, visible: false }) {
      const base = projBase;
      const top = projTop;
      out.visible = false;
      if (!sync.resolve(target, base, top)) return out;
      camera.updateMatrixWorld();
      projector.project(top, projOut);
      out.x = projOut.x;
      out.y = projOut.y;
      out.visible = projOut.depth > 0 && onScreen(projOut.x, projOut.y, size.w, size.h);
      return out;
    },
    resize(w, h) {
      size.w = Math.max(2, w);
      size.h = Math.max(2, h);
      gfx.resize(size.w, size.h);
      rig.setAspect(size.w / size.h);
    },
    start() {
      if (running || disposed) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      api.stop();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      fontsDoc?.removeEventListener?.('loadingdone', repaint);
      sync.dispose();
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
    onQuality: (fn) => gfx.onChange(fn),
    // --- additions to the plan's API ---
    /** The avatar's current x along the kitchen line (same kinematics as the HUD's runner), or null if there is no such player. */
    getAvatarX: (id) => sync.getAvatarX(id),
    /** fn({ playerId, at, x }) when an avatar finishes a walk. Returns an unsubscribe. */
    onAvatarArrive: (fn) => sync.onAvatarArrive(fn),
    /** HUD-safe insets as fractions of the viewport height ({ top, bottom }); null for the defaults. */
    setInsets(i) {
      rig.setInsets(i);
    },
    /** For screenshots / tuning: force the clock hour (null = follow the state), and reach internals. */
    debug: {
      setHour: (h) => { hourOverride = h; },
      get gfx() { return gfx; },
      stall,
      sync,
      fx,
    },
  };
  const projBase = new Vector3();
  const projTop = new Vector3();
  const projOut = { x: 0, y: 0, depth: 0 };
  return api;
}
