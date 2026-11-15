// The camera's engine: holds the current camera, eases it to a target with a critically damped spring and tells the
// caller what transform to write. No React, no DOM: the caller supplies `apply` (writes the transform), a frame scheduler
// and a clock, so it runs under fake timers in tests. All updates go through requestAnimationFrame; React only hears
// about coarse changes (crossing "zoomed", settling), never about a frame.
//
// Three modes:
//   spring   `setTarget` was called: glide to it (zoom is smoothed in log space so it feels even; the centre moves with it)
//   direct   a finger is on the board: `drag(cam)` writes the camera as it comes in (one write per frame)
//   inertia  the finger lifted while panning: the pan coasts on and slows down

import { FIT, clampCam, isZoomed, sameCam, toTransform } from './cameraMath.js';

// SmoothDamp is stable for any step, so a slow phone (10-15 fps) still plays the glide in real time instead of in slow
// motion; the cap only stops a tab that was in the background from taking one huge step.
const MAX_DT = 0.25;
const INERTIA_TAU = 0.32; // seconds: how quickly a flick slows down
const INERTIA_MIN = 14; // px/s: below this the flick has stopped
const INERTIA_START = 120; // px/s: a release slower than this does not coast

/**
 * Unity-style SmoothDamp: critically damped spring towards `target`, no overshoot. Returns [value, velocity].
 * `smooth` is roughly the time to arrive (95% of the way takes about 2.4x that).
 */
export function smoothDamp(cur, target, vel, smooth, dt) {
  const omega = 2 / Math.max(0.0001, smooth);
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel + omega * change) * dt;
  let v = (vel - omega * temp) * e;
  let out = target + (change + temp) * e;
  if ((target - cur > 0) === (out > target)) {
    out = target; // never overshoot
    v = 0;
  }
  return [out, v];
}

export function createCameraController({
  apply,
  onZoomChange,
  onSettle,
  raf = (f) => requestAnimationFrame(f),
  caf = (id) => cancelAnimationFrame(id),
  now = () => performance.now(),
} = {}) {
  let size = { w: 0, h: 0 };
  let cam = { ...FIT };
  let target = { ...FIT };
  let vel = { ls: 0, cx: 0, cy: 0 }; // ls = ln(scale)
  let smooth = 0.4;
  let mode = 'idle';
  let coast = null; // { vx, vy } px/s while mode === 'inertia'
  let frame = 0;
  let last = 0;
  let dirty = false;
  let zoomed = false;
  let disposed = false;

  const dims = () => ({ w: size.w || 1, h: size.h || size.w || 1 });

  function emit(moving) {
    if (disposed) return;
    const { w, h } = dims();
    const tr = toTransform(cam, w, h);
    apply?.({ s: tr.s, tx: tr.tx, ty: tr.ty, moving, cam: { ...cam } });
    const z = isZoomed(cam);
    if (z !== zoomed) {
      zoomed = z;
      onZoomChange?.(z, { ...cam });
    }
  }

  function stop() {
    if (frame) caf(frame);
    frame = 0;
  }

  function settle() {
    stop();
    if (mode === 'spring') cam = clampCam(target);
    mode = 'idle';
    coast = null;
    vel = { ls: 0, cx: 0, cy: 0 };
    dirty = false;
    emit(false);
    onSettle?.({ ...cam });
  }

  function schedule() {
    if (frame || disposed) return;
    last = now();
    frame = raf(tick);
  }

  function springArrived() {
    const { w, h } = dims();
    const err = Math.max(Math.abs(cam.cx - target.cx) * cam.s * w, Math.abs(cam.cy - target.cy) * cam.s * h);
    const dls = Math.abs(Math.log(cam.s) - Math.log(target.s));
    return dls < 0.0012 && err < 0.25 && Math.abs(vel.ls) < 0.02 && Math.abs(vel.cx) * cam.s * w < 2 && Math.abs(vel.cy) * cam.s * h < 2;
  }

  function tick(t) {
    frame = 0;
    if (disposed) return;
    const dt = Math.min(MAX_DT, Math.max(0.001, ((t ?? now()) - last) / 1000));
    last = t ?? now();
    if (mode === 'spring') {
      const [ls, vls] = smoothDamp(Math.log(cam.s), Math.log(target.s), vel.ls, smooth, dt);
      const [cx, vcx] = smoothDamp(cam.cx, target.cx, vel.cx, smooth, dt);
      const [cy, vcy] = smoothDamp(cam.cy, target.cy, vel.cy, smooth, dt);
      const next = clampCam({ s: Math.exp(ls), cx, cy });
      vel = { ls: vls, cx: next.cx === cx ? vcx : 0, cy: next.cy === cy ? vcy : 0 };
      cam = next;
      if (springArrived()) {
        settle();
        return;
      }
      emit(true);
      schedule();
    } else if (mode === 'direct') {
      if (dirty) {
        dirty = false;
        emit(true);
      }
      // stay quiet until the next drag() call schedules a frame again
    } else if (mode === 'inertia' && coast) {
      const { w, h } = dims();
      const decay = Math.exp(-dt / INERTIA_TAU);
      coast = { vx: coast.vx * decay, vy: coast.vy * decay };
      const next = clampCam({ s: cam.s, cx: cam.cx - (coast.vx * dt) / (cam.s * w), cy: cam.cy - (coast.vy * dt) / (cam.s * h) });
      if (next.cx === cam.cx) coast.vx = 0;
      if (next.cy === cam.cy) coast.vy = 0;
      cam = next;
      if (Math.hypot(coast.vx, coast.vy) < INERTIA_MIN) {
        settle();
        return;
      }
      emit(true);
      schedule();
    }
  }

  return {
    /** The viewport's size in px (the board's box). Re-clamps the camera, so a rotation never exposes the edge. */
    setSize(w, h = w) {
      size = { w: Math.max(0, w), h: Math.max(0, h) };
      cam = clampCam(cam);
      target = clampCam(target);
      if (mode === 'idle') emit(false);
    },
    getCam: () => ({ ...cam }),
    getTarget: () => ({ ...target }),
    isMoving: () => mode !== 'idle',
    isZoomed: () => isZoomed(cam),

    /** Glide to `next` (`smooth` seconds); `instant` jumps (reduced motion, rotations). */
    setTarget(next, { smooth: s = 0.4, instant = false } = {}) {
      const c = clampCam(next);
      if (instant) {
        if (mode === 'idle' && sameCam(cam, c, 1e-4)) {
          target = c;
          return;
        }
        stop();
        cam = c;
        target = c;
        mode = 'idle';
        settle();
        return;
      }
      if (mode === 'idle' && sameCam(cam, c, 1e-4)) {
        target = c;
        return;
      }
      target = c;
      smooth = Math.max(0.08, s);
      if (mode !== 'spring') {
        vel = { ls: 0, cx: 0, cy: 0 };
        mode = 'spring';
      }
      schedule();
    },

    /** A finger is moving the board: write `next` now (coalesced to one write per frame). */
    drag(next) {
      cam = clampCam(next);
      target = cam;
      if (mode !== 'direct') {
        vel = { ls: 0, cx: 0, cy: 0 };
        mode = 'direct';
        coast = null;
      }
      dirty = true;
      schedule();
    },

    /** The finger lifted: coast on if it was flicking a zoomed board, else settle where it is. */
    release(velocity = null, { inertia = true } = {}) {
      const v = velocity ? Math.hypot(velocity.vx, velocity.vy) : 0;
      if (inertia && isZoomed(cam) && v > INERTIA_START) {
        mode = 'inertia';
        coast = { vx: velocity.vx, vy: velocity.vy };
        schedule();
        return;
      }
      settle();
    },

    /** Stop whatever is moving where it stands. */
    freeze() {
      if (mode === 'idle') return;
      target = cam;
      settle();
    },

    dispose() {
      disposed = true;
      stop();
    },

    /** Test hook: run one frame of `dt` seconds. */
    step(dt) {
      last = now() - dt * 1000;
      frame = 0;
      tick(now());
    },
  };
}
