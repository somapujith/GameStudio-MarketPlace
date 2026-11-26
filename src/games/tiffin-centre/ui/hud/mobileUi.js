// Tiffin Centre on a phone or tablet: fullscreen, keep-awake and the multi-touch rule for the look surface. The pure helper is tested in node (mobileUi.test.js); the
// hooks wrap src/lib/mobile.js, which feature-detects every browser API (iPhone has no fullscreen on a page, only some browsers have a wake lock) and never throws.
// The "turn your phone sideways" hint is gone: touch devices held upright get the shell's orientation gate (src/platform/game), and the HUD is designed for landscape.
import { useCallback, useEffect, useState } from 'react';
import { enterFullscreen, exitFullscreen, fullscreenSupported, isFullscreen, keepAwake, useTouchDevice, useViewport } from '@/lib/mobile.js';

/** Pointer bookkeeping for the look surface: a second finger down cancels the gesture and nothing acts until every finger is up. */
export function createPointerGuard() {
  const down = new Set();
  let multi = false;
  return {
    /** A pointer went down: -> 'ok' (single finger) | 'multi' (two or more: ignore). */
    add(id) {
      down.add(id);
      if (down.size > 1) multi = true;
      return multi ? 'multi' : 'ok';
    },
    /** True while the gesture belongs to a multi-finger touch (moves and the release must be ignored). */
    get blocked() {
      return multi;
    },
    has: (id) => down.has(id),
    /** A pointer went up or was cancelled: -> true when it was part of a multi-finger gesture (do not act on the release). */
    remove(id) {
      down.delete(id);
      const was = multi;
      if (down.size === 0) multi = false;
      return was;
    },
    reset() {
      down.clear();
      multi = false;
    },
    get size() {
      return down.size;
    },
  };
}

/** { supported, active, toggle } for page fullscreen. `supported` is false on iPhone Safari (no fullscreen API for pages): the button is not drawn there. */
export function useFullscreen() {
  const [supported] = useState(() => fullscreenSupported());
  const [active, setActive] = useState(() => isFullscreen());
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const on = () => setActive(isFullscreen());
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    on();
    return () => {
      document.removeEventListener('fullscreenchange', on);
      document.removeEventListener('webkitfullscreenchange', on);
    };
  }, []);
  const toggle = useCallback(async () => {
    if (isFullscreen()) await exitFullscreen();
    else await enterFullscreen();
    setActive(isFullscreen());
  }, []);
  return { supported, active, toggle };
}

/** Leave fullscreen when the owner of this hook unmounts (the game screen closes: the hub itself should not stay fullscreen). */
export function useExitFullscreenOnUnmount() {
  useEffect(
    () => () => {
      if (isFullscreen()) exitFullscreen();
    },
    [],
  );
}

/** Keep the screen awake while `active` (the shift is playing); released on pause, on leaving and on unmount. */
export function useKeepAwake(active) {
  useEffect(() => {
    if (!active) return undefined;
    let release = null;
    let dead = false;
    keepAwake().then((r) => {
      if (dead) r();
      else release = r;
    });
    return () => {
      dead = true;
      if (release) release();
    };
  }, [active]);
}

export { useTouchDevice, useViewport };
