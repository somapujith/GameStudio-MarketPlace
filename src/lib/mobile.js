// Shared mobile helpers for every game and page: touch detection, viewport classes, fullscreen, orientation lock, wake lock.
// Pure functions take an optional `win` (default `window`) so they are unit-tested in node; every browser API is feature-detected
// and every failure is swallowed (Safari/iOS lacks fullscreen on non-video elements, orientation lock, and older wake lock).
import { useEffect, useState } from 'react';

const W = () => (typeof window !== 'undefined' ? window : null);

/** True when the primary input is a finger (phones, tablets), not a mouse. Hybrids with a mouse count as false unless forced. */
export function isCoarsePointer(win = W()) {
  try {
    if (!win) return false;
    if (win.matchMedia) {
      if (win.matchMedia('(pointer: coarse)').matches) return true;
      if (win.matchMedia('(any-pointer: coarse)').matches && !win.matchMedia('(any-pointer: fine)').matches) return true;
    }
    const nav = win.navigator;
    return !!nav && nav.maxTouchPoints > 0 && !(win.matchMedia && win.matchMedia('(pointer: fine)').matches);
  } catch {
    return false;
  }
}

/** Can this device produce touch events at all (used to decide whether to mount on-screen controls)? */
export function hasTouch(win = W()) {
  try {
    if (!win) return false;
    return 'ontouchstart' in win || (win.navigator && win.navigator.maxTouchPoints > 0);
  } catch {
    return false;
  }
}

/**
 * Viewport facts from the VISUAL viewport (it shrinks with the on-screen keyboard and mobile toolbars).
 * class: 'phone' (short side < 600), 'tablet' (short side < 900), 'desktop'. `short` = height <= 460 (a phone held sideways).
 */
export function viewportInfo(win = W()) {
  const vv = win && win.visualViewport;
  const w = Math.round((vv && vv.width) || (win && win.innerWidth) || 0);
  const h = Math.round((vv && vv.height) || (win && win.innerHeight) || 0);
  const shortSide = Math.min(w, h);
  const coarse = isCoarsePointer(win);
  // a tablet is a touch screen with a short side under 900; a small desktop window is still 'desktop' unless it is phone-narrow
  const cls = shortSide && shortSide < 600 ? 'phone' : shortSide && shortSide < 900 && coarse ? 'tablet' : 'desktop';
  return { w, h, landscape: w > h, portrait: h >= w, class: cls, phone: cls === 'phone', tablet: cls === 'tablet', short: h > 0 && h <= 460, coarse };
}

// ---- fullscreen -----------------------------------------------------------------------------------------------------------------
export function fullscreenSupported(doc = typeof document !== 'undefined' ? document : null) {
  const el = doc && doc.documentElement;
  return !!(el && (el.requestFullscreen || el.webkitRequestFullscreen));
}
export function isFullscreen(doc = typeof document !== 'undefined' ? document : null) {
  return !!(doc && (doc.fullscreenElement || doc.webkitFullscreenElement));
}
/** Enter fullscreen (must be called from a user gesture). Resolves true on success, false when unsupported or refused (iPhone Safari). */
export async function enterFullscreen(el, doc = typeof document !== 'undefined' ? document : null) {
  try {
    const target = el || (doc && doc.documentElement);
    if (!target) return false;
    const fn = target.requestFullscreen || target.webkitRequestFullscreen;
    if (!fn) return false;
    await fn.call(target, { navigationUI: 'hide' });
    return true;
  } catch {
    return false;
  }
}
export async function exitFullscreen(doc = typeof document !== 'undefined' ? document : null) {
  try {
    if (!doc || !isFullscreen(doc)) return false;
    const fn = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (!fn) return false;
    await fn.call(doc);
    return true;
  } catch {
    return false;
  }
}

// ---- orientation ----------------------------------------------------------------------------------------------------------------
/** Try to lock the screen orientation ('landscape' | 'portrait' | 'any'); only works in fullscreen on Android Chrome. Resolves boolean. */
export async function lockOrientation(type = 'landscape', win = W()) {
  try {
    const o = win && win.screen && win.screen.orientation;
    if (!o || !o.lock) return false;
    await o.lock(type);
    return true;
  } catch {
    return false;
  }
}
export function unlockOrientation(win = W()) {
  try {
    const o = win && win.screen && win.screen.orientation;
    if (o && o.unlock) o.unlock();
  } catch {
    /* ignore */
  }
}

// ---- wake lock ------------------------------------------------------------------------------------------------------------------
/** Keep the screen on while playing. Returns a release function (always safe to call). Re-acquires after the tab becomes visible again. */
export async function keepAwake(win = W()) {
  let sentinel = null;
  let released = false;
  const doc = win && win.document;
  const nav = win && win.navigator;
  const acquire = async () => {
    try {
      if (released || !nav || !nav.wakeLock) return;
      sentinel = await nav.wakeLock.request('screen');
    } catch {
      sentinel = null;
    }
  };
  const onVis = () => {
    if (doc && doc.visibilityState === 'visible' && !sentinel) acquire();
  };
  await acquire();
  if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVis);
  return () => {
    released = true;
    try {
      if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVis);
      if (sentinel && sentinel.release) sentinel.release();
    } catch {
      /* ignore */
    }
    sentinel = null;
  };
}

// ---- prevent the browser's own gestures during play -----------------------------------------------------------------------------
/** Stop pinch-zoom, double-tap zoom, pull-to-refresh and the context menu on `el` (a game surface). Returns a cleanup function. */
export function lockGestures(el) {
  if (!el || !el.addEventListener) return () => {};
  const prevent = (e) => {
    if (e.cancelable) e.preventDefault();
  };
  const onTouchMove = (e) => {
    if (e.touches && e.touches.length > 1) prevent(e);
  };
  el.addEventListener('contextmenu', prevent);
  el.addEventListener('gesturestart', prevent); // Safari pinch
  el.addEventListener('touchmove', onTouchMove, { passive: false });
  const style = el.style;
  const prev = style ? { ta: style.touchAction, os: style.overscrollBehavior, us: style.userSelect } : null;
  if (style) {
    style.touchAction = 'none';
    style.overscrollBehavior = 'none';
    style.userSelect = 'none';
  }
  return () => {
    el.removeEventListener('contextmenu', prevent);
    el.removeEventListener('gesturestart', prevent);
    el.removeEventListener('touchmove', onTouchMove);
    if (style && prev) {
      style.touchAction = prev.ta;
      style.overscrollBehavior = prev.os;
      style.userSelect = prev.us;
    }
  };
}

// ---- React hooks ----------------------------------------------------------------------------------------------------------------
/** The live viewport (visual viewport: tracks the keyboard and toolbars) and orientation; re-renders only when a value changes. */
export function useViewport() {
  const [v, setV] = useState(() => viewportInfo());
  useEffect(() => {
    const win = W();
    if (!win) return undefined;
    const update = () =>
      setV((prev) => {
        const next = viewportInfo(win);
        return prev.w === next.w && prev.h === next.h && prev.coarse === next.coarse ? prev : next;
      });
    update();
    const vv = win.visualViewport;
    win.addEventListener('resize', update);
    win.addEventListener('orientationchange', update);
    if (vv && vv.addEventListener) vv.addEventListener('resize', update);
    return () => {
      win.removeEventListener('resize', update);
      win.removeEventListener('orientationchange', update);
      if (vv && vv.removeEventListener) vv.removeEventListener('resize', update);
    };
  }, []);
  return v;
}

/** Is this a touch-first device (re-evaluated when a pointer type change is reported)? */
export function useTouchDevice() {
  const [t, setT] = useState(() => isCoarsePointer());
  useEffect(() => {
    const win = W();
    if (!win || !win.matchMedia) return undefined;
    const mq = win.matchMedia('(pointer: coarse)');
    const on = () => setT(isCoarsePointer(win));
    if (mq.addEventListener) mq.addEventListener('change', on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on);
    };
  }, []);
  return t;
}
