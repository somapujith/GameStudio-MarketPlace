// Shared "is the player on a touch screen?" flag, so the HUD (speedometer placement, tappable prompt, touch wording) and TouchControls agree.
// It starts from the SAME rule the rest of the app uses (`isCoarsePointer` in src/lib/mobile.js: the pointer media queries, plus the touch points
// where the media query lies, e.g. an Android WebView on a tablet that reports `pointer: fine`), flips on for anyone who touches the screen later,
// and never switches back off.
import { useEffect, useSyncExternalStore } from 'react';
import { isCoarsePointer } from '@/lib/mobile.js';

/**
 * The touch-mode store of one window (the singleton below is the window the game runs in; tests pass a fake one).
 * `get()` / `set(on)` / `subscribe(fn)`, and `watch()` which listens for the first touch and returns the function that stops listening.
 */
export function createTouchMode(win = typeof window !== 'undefined' ? window : null) {
  let touch = win ? isCoarsePointer(win) : false;
  const subs = new Set();
  const set = (on) => {
    if (touch === !!on) return;
    touch = !!on;
    for (const fn of [...subs]) fn();
  };
  return {
    get: () => touch,
    set,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    watch() {
      if (!win || !win.addEventListener) return () => {};
      const onPointer = (e) => {
        if (e && e.pointerType === 'touch') set(true);
      };
      const onTouch = () => set(true);
      // the page may have changed since the module loaded (a device emulation, a keyboard cover detached): ask the shared rule again
      let mq = null;
      const recheck = () => {
        if (isCoarsePointer(win)) set(true);
      };
      recheck();
      try {
        mq = win.matchMedia ? win.matchMedia('(pointer: coarse)') : null;
        if (mq && mq.addEventListener) mq.addEventListener('change', recheck);
      } catch {
        mq = null;
      }
      win.addEventListener('pointerdown', onPointer, { passive: true, capture: true });
      win.addEventListener('touchstart', onTouch, { passive: true, capture: true });
      return () => {
        win.removeEventListener('pointerdown', onPointer, true);
        win.removeEventListener('touchstart', onTouch, true);
        if (mq && mq.removeEventListener) mq.removeEventListener('change', recheck);
      };
    },
  };
}

const store = createTouchMode();
let watchers = 0;
let stopWatch = null;

export const isTouchMode = () => store.get();
/** The controls were switched on by a setting or ?touch=1: the HUD must lay itself out around them like on a real touch screen. */
export const enableTouchMode = () => store.set(true);

/** React hook: true while the touch controls should be on screen. */
export function useTouchMode() {
  useEffect(() => {
    if (watchers++ === 0) stopWatch = store.watch();
    return () => {
      if (--watchers === 0 && stopWatch) {
        stopWatch();
        stopWatch = null;
      }
    };
  }, []);
  return useSyncExternalStore(store.subscribe, store.get, () => false);
}
