// Touch (and mouse / trackpad) control of the board camera.
//
//   createGestureMachine(opts)   a pure state machine fed with plain { id, x, y, t } points: unit-tested in node
//   useBoardGestures(ref, opts)  the React hook that wires it to Pointer Events on the board frame
//
// What it does (docs/MOBILE_CAMERA.md):
//   - two pointers: pinch zoom about the pinch midpoint (1x..3x); moving both pans as well
//   - one pointer, board zoomed: drag pans, with a light coast when the finger flicks and lifts
//   - one pointer, board not zoomed: a vertical drag is handed to the scrolling ancestor, if there is one, because
//     the board frame has `touch-action: none` and would otherwise swallow the scroll
//   - a quick tap (< 8 px, < 300 ms) is not a gesture: the browser's own click reaches the tile
//   - double tap toggles between the whole board and DOUBLE_TAP_SCALE centred on the tapped point. To make that work
//     without the first tap opening a deed sheet that then eats the second tap, a tile's click is held back for the
//     double-tap window (DOUBLE_TAP_MS) and replayed, unless a second tap follows
//   - ctrl + wheel / trackpad pinch zooms about the cursor; the wheel pans a zoomed board
//   - a third finger is ignored, pointercancel aborts without coasting, and a pinch that ends with one finger down
//     carries on as a pan

import { useEffect, useRef } from 'react';
import { MAX_SCALE, ZOOMED_AT, clampScale, panBy, pinchCam, zoomAbout } from './cameraMath.js';

export const TAP_SLOP = 8; // px a finger may move and still be a tap
export const TAP_MS = 300; // longest press that is still a tap
export const DOUBLE_TAP_MS = 260; // a second tap within this long (and DOUBLE_TAP_DIST px) of the first is a double tap
export const DOUBLE_TAP_DIST = 32;
const VELOCITY_MS = 100; // the flick velocity is measured over the last stretch this long

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * opts: getCam() -> { s, cx, cy } · getSize() -> { w, h } · onCam(cam) (live, per move) · onBegin() / onEnd(velocity|null)
 * (the first finger down that turns into a gesture / the last one up) · onDoubleTap({ x, y }) · onScroll(dx, dy).
 * Points are in viewport (board frame) pixels, `t` in ms.
 */
export function createGestureMachine({ getCam, getSize, onCam, onBegin, onEnd, onDoubleTap, onScroll } = {}) {
  const ptrs = new Map(); // id -> { x, y }
  let phase = 'idle'; // idle | press | pan | scroll | pinch
  let press = null;
  let begun = false;
  let noTap = false;
  let pinchStart = null;
  let samples = [];
  let lastTap = null;

  const begin = () => {
    if (begun) return;
    begun = true;
    onBegin?.();
  };
  const finish = (velocity) => {
    if (!begun) return;
    begun = false;
    onEnd?.(velocity);
  };
  const sample = (e) => {
    samples.push({ t: e.t, x: e.x, y: e.y });
    while (samples.length > 2 && e.t - samples[0].t > VELOCITY_MS) samples.shift();
  };
  const velocityAt = (t) => {
    const recent = samples.filter((s) => t - s.t <= VELOCITY_MS * 1.5);
    if (recent.length < 2) return { vx: 0, vy: 0 };
    const a = recent[0];
    const b = recent[recent.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt } : { vx: 0, vy: 0 };
  };
  const pair = () => [...ptrs.values()];

  return {
    /** True when a pointer going down at `e` would be the second tap of a double tap (the hook cancels the held click). */
    isDoubleCandidate(e) {
      return !!lastTap && e.t - lastTap.t <= DOUBLE_TAP_MS && dist(lastTap, e) <= DOUBLE_TAP_DIST;
    },

    down(e) {
      if (e.type === 'mouse' && e.button !== 0) return {};
      if (ptrs.has(e.id) || ptrs.size >= 2) return {}; // a third finger is ignored
      ptrs.set(e.id, { x: e.x, y: e.y });
      if (ptrs.size === 1) {
        phase = 'press';
        press = { x: e.x, y: e.y, t: e.t };
        noTap = false;
        samples = [{ t: e.t, x: e.x, y: e.y }];
        return {};
      }
      // the second finger: a pinch from the camera as it is now
      const [a, b] = pair();
      phase = 'pinch';
      noTap = true;
      lastTap = null;
      begin();
      pinchStart = { cam: getCam(), a: { ...a }, b: { ...b } };
      return { capture: true, prevent: true };
    },

    move(e) {
      const p = ptrs.get(e.id);
      if (!p) return {};
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      p.x = e.x;
      p.y = e.y;
      const { w, h } = getSize();
      if (phase === 'press') {
        if (dist(p, press) <= TAP_SLOP) return {};
        noTap = true;
        lastTap = null;
        if (getCam().s > ZOOMED_AT) {
          phase = 'pan';
          begin();
          samples = [{ t: e.t, x: e.x, y: e.y }];
          onCam?.(panBy(getCam(), p.x - press.x, p.y - press.y, w, h)); // catch up with the whole drag, slop included
          return { capture: true, prevent: true };
        }
        phase = 'scroll';
        onScroll?.(p.x - press.x, p.y - press.y);
        return { capture: true };
      }
      if (phase === 'pan') {
        onCam?.(panBy(getCam(), dx, dy, w, h));
        sample(e);
        return { prevent: true };
      }
      if (phase === 'scroll') {
        onScroll?.(dx, dy);
        return {};
      }
      if (phase === 'pinch') {
        const [a, b] = pair();
        onCam?.(pinchCam(pinchStart, { a, b }, w, h));
        return { prevent: true };
      }
      return {};
    },

    up(e) {
      const p = ptrs.get(e.id);
      if (!p) return {};
      ptrs.delete(e.id);
      if (phase === 'press') {
        phase = 'idle';
        const isTap = !noTap && e.t - press.t < TAP_MS && dist(e, press) <= TAP_SLOP;
        if (!isTap) {
          lastTap = null;
          return { tap: false };
        }
        if (lastTap && e.t - lastTap.t <= DOUBLE_TAP_MS && dist(lastTap, e) <= DOUBLE_TAP_DIST) {
          lastTap = null;
          onDoubleTap?.({ x: e.x, y: e.y });
          return { tap: true, double: true };
        }
        lastTap = { x: e.x, y: e.y, t: e.t };
        return { tap: true, double: false };
      }
      lastTap = null;
      if (phase === 'pan') {
        phase = 'idle';
        finish(velocityAt(e.t));
        return {};
      }
      if (phase === 'scroll') {
        phase = 'idle';
        return {};
      }
      if (phase === 'pinch') {
        if (ptrs.size === 1) {
          phase = 'pan'; // the finger that is still down carries on as a pan
          samples = [];
          return {};
        }
        phase = 'idle';
        finish(null);
      }
      return {};
    },

    /** pointercancel: the system took the touch (an alert, a palm, a system gesture). Abort, no coasting. */
    cancel() {
      ptrs.clear();
      phase = 'idle';
      lastTap = null;
      pinchStart = null;
      finish(null);
    },

    /** ctrl + wheel (a trackpad pinch) zooms about the cursor; a plain wheel pans a zoomed board. */
    wheel(e) {
      const cam = getCam();
      const { w, h } = getSize();
      if (e.ctrlKey) {
        const k = Math.min(1.25, Math.max(0.8, Math.exp(-(e.deltaY || 0) * 0.01)));
        begin();
        onCam?.(zoomAbout(cam, clampScale(cam.s * k, MAX_SCALE), e.x, e.y, w, h));
        finish(null);
        return { handled: true };
      }
      if (cam.s > ZOOMED_AT) {
        begin();
        onCam?.(panBy(cam, -(e.deltaX || 0), -(e.deltaY || 0), w, h));
        finish(null);
        return { handled: true };
      }
      return { handled: false };
    },

    /** True while a pan or a pinch is under way (the hook cancels the browser's own handling then). */
    active: () => phase === 'pan' || phase === 'pinch',
    phase: () => phase,
  };
}

// ---- scrolling ancestor ------------------------------------------------------------------------------------------

function findScroller(el) {
  if (typeof getComputedStyle !== 'function') return null;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

// ---- the hook ----------------------------------------------------------------------------------------------------

/**
 * Wires the machine to Pointer Events on `ref.current`.
 * opts: { enabled, getCam, getSize, onCam, onBegin, onEnd, onDoubleTap, onKey(action, dx, dy) -> handled }
 * The latest opts are read through a ref, so changing a callback never re-attaches the listeners.
 */
export function useBoardGestures(ref, opts) {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const enabled = !!opts.enabled;

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return undefined;
    const o = () => optsRef.current;

    let rect = el.getBoundingClientRect();
    let scroller;
    let pendingClick = null; // a tile click held back for the double-tap window
    let swallow = false; // the click that follows a double tap is dropped
    let swallowTimer = 0;
    let lastTapAt = null; // when the last pointerup counted as a tap

    const machine = createGestureMachine({
      getCam: () => o().getCam(),
      getSize: () => ({ w: rect.width || 1, h: rect.height || 1 }),
      onCam: (c) => o().onCam?.(c),
      onBegin: () => o().onBegin?.(),
      onEnd: (v) => o().onEnd?.(v),
      onDoubleTap: (p) => o().onDoubleTap?.(p),
      onScroll: (dx, dy) => {
        if (scroller === undefined) scroller = findScroller(el);
        if (scroller) scroller.scrollTop -= dy;
      },
    });

    const point = (e) => ({ id: e.pointerId, x: e.clientX - rect.left, y: e.clientY - rect.top, t: e.timeStamp, type: e.pointerType, button: e.button });
    const capture = (id) => {
      try {
        el.setPointerCapture(id);
      } catch {
        /* the pointer is gone */
      }
    };
    const cancelHeldClick = () => {
      if (pendingClick) clearTimeout(pendingClick.timer);
      pendingClick = null;
    };
    const replay = () => {
      const held = pendingClick;
      pendingClick = null;
      if (!held || !held.el.isConnected) return;
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX: held.x, clientY: held.y, detail: 1, view: window });
      Object.defineProperty(ev, '__bcReplay', { value: true });
      held.el.dispatchEvent(ev);
    };

    const onDown = (e) => {
      if (e.target.closest?.('[data-bc-hud]')) return;
      rect = el.getBoundingClientRect();
      scroller = undefined;
      const p = point(e);
      if (pendingClick && machine.isDoubleCandidate(p)) cancelHeldClick();
      const r = machine.down(p);
      if (r.capture) capture(e.pointerId);
    };
    const onMove = (e) => {
      const r = machine.move(point(e));
      if (r.capture) capture(e.pointerId);
    };
    const onUp = (e) => {
      const r = machine.up(point(e));
      lastTapAt = r.tap ? performance.now() : null;
      if (r.double) {
        cancelHeldClick();
        swallow = true;
        clearTimeout(swallowTimer);
        swallowTimer = setTimeout(() => {
          swallow = false;
        }, 500);
      }
    };
    const onCancel = () => {
      machine.cancel();
      lastTapAt = null;
    };

    // a tile's click is held for the double-tap window, so a double tap zooms instead of opening a deed twice
    const onClickCapture = (e) => {
      if (e.__bcReplay) return;
      if (swallow) {
        swallow = false;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (!(e.detail > 0) || lastTapAt === null || performance.now() - lastTapAt > 600) return; // keyboard / not a tap
      const tile = e.target.closest?.('[data-fx-tile]');
      if (!tile) return;
      e.stopPropagation();
      e.preventDefault();
      cancelHeldClick();
      pendingClick = { el: tile, x: e.clientX, y: e.clientY, timer: setTimeout(replay, DOUBLE_TAP_MS + 20) };
    };

    // Keep the browser (and iOS Safari's page pinch) out of two-finger gestures and of pans on the board.
    const onTouchStart = (e) => {
      if (e.touches.length > 1 && !e.target.closest?.('[data-bc-hud]')) e.preventDefault();
    };
    const onTouchMove = (e) => {
      if ((e.touches.length > 1 || machine.active()) && e.cancelable) e.preventDefault();
    };
    const stopGesture = (e) => e.preventDefault(); // Safari's gesturestart / gesturechange: no page zoom from the board

    const onWheel = (e) => {
      if (e.target.closest?.('[data-bc-hud]')) return;
      rect = el.getBoundingClientRect();
      const r = machine.wheel({ x: e.clientX - rect.left, y: e.clientY - rect.top, deltaX: e.deltaX, deltaY: e.deltaY, ctrlKey: e.ctrlKey });
      if (r.handled) e.preventDefault();
    };

    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key;
      let action = null;
      let dx = 0;
      let dy = 0;
      if (k === '+' || k === '=') action = 'in';
      else if (k === '-' || k === '_') action = 'out';
      else if (k === '0') action = 'fit';
      else if (k === 'ArrowLeft') [action, dx] = ['pan', -1];
      else if (k === 'ArrowRight') [action, dx] = ['pan', 1];
      else if (k === 'ArrowUp') [action, dy] = ['pan', -1];
      else if (k === 'ArrowDown') [action, dy] = ['pan', 1];
      if (action && o().onKey?.(action, dx, dy)) e.preventDefault();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('click', onClickCapture, true);
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('gesturestart', stopGesture);
    el.addEventListener('gesturechange', stopGesture);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKeyDown);
    return () => {
      cancelHeldClick();
      clearTimeout(swallowTimer);
      machine.cancel();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('click', onClickCapture, true);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('gesturestart', stopGesture);
      el.removeEventListener('gesturechange', stopGesture);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, enabled]);
}
