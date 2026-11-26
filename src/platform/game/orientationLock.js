// Fullscreen + screen.orientation.lock('landscape') for a landscape-only game. Android Chrome (and Firefox for Android) can pin the screen
// sideways, but only inside fullscreen and only from a user gesture. iOS Safari can do neither, so there the "turn your phone" screen is the
// whole solution. Everything goes through src/lib/mobile.js (feature-detected, never throws); this file adds the bookkeeping:
//   - request(): enter fullscreen (when it is not already) and lock; remembers what WE did so release() undoes only that
//   - armFirstGesture(): the first tap / key press anywhere asks once, so a player who has already turned the phone gets it pinned there
//   - release(): unlock, and leave fullscreen only if this module entered it (the game's own fullscreen toggle is left alone)
import { enterFullscreen, exitFullscreen, fullscreenSupported, isFullscreen, lockOrientation, unlockOrientation } from '@/lib/mobile.js';

/** Can this browser pin the orientation at all (a `lock` method)? iOS Safari: false. Desktop Chrome: true, but it only works in fullscreen on a phone. */
export function canLockOrientation(win) {
  try {
    const o = win && win.screen && win.screen.orientation;
    return !!(o && typeof o.lock === 'function');
  } catch {
    return false;
  }
}

/** Is a "Tap to play in landscape" button worth showing? Needs the lock API and a way into fullscreen (or an app already fullscreen). */
export function canPlayLandscape(win, doc = win && win.document) {
  return canLockOrientation(win) && (fullscreenSupported(doc) || isFullscreen(doc));
}

const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'];

/** `win` / `doc` are injectable so the sequence is tested in node with fakes. */
export function createLandscapeLock({ win = typeof window !== 'undefined' ? window : null, doc = win && win.document, type = 'landscape' } = {}) {
  let enteredFullscreen = false;
  let locked = false;
  let disarm = null;
  let released = false;

  const api = {
    supported: () => !!win && canPlayLandscape(win, doc),
    get locked() {
      return locked;
    },

    /** Must run inside a user gesture. Resolves true when the screen is pinned. */
    async request() {
      if (!win || released) return false;
      if (!canLockOrientation(win)) return false;
      if (!isFullscreen(doc) && fullscreenSupported(doc) && (await enterFullscreen(doc.documentElement, doc))) enteredFullscreen = true;
      if (released) {
        api.release(); // left the game while the browser was asking: undo what just got entered
        return false;
      }
      locked = await lockOrientation(type, win);
      if (released) {
        api.release(); // same, but the answer came late: do not leave the lock behind
        return false;
      }
      return locked;
    },

    /** Ask once, on the first user gesture after this call. Returns the function that cancels the wait. */
    armFirstGesture(onDone) {
      if (!doc || !doc.addEventListener || disarm || !api.supported()) return () => {};
      const off = () => {
        GESTURES.forEach((g) => doc.removeEventListener(g, fire, true));
        disarm = null;
      };
      const fire = () => {
        off();
        api.request().then((ok) => onDone && onDone(ok), () => onDone && onDone(false));
      };
      GESTURES.forEach((g) => doc.addEventListener(g, fire, { capture: true, passive: true }));
      disarm = off;
      return off;
    },

    /** Leave: cancel a pending ask, unlock, and exit fullscreen if (and only if) this module entered it. Safe to call twice. */
    release() {
      released = true;
      if (disarm) disarm();
      if (locked) unlockOrientation(win);
      locked = false;
      if (enteredFullscreen) exitFullscreen(doc);
      enteredFullscreen = false;
    },
  };
  return api;
}
