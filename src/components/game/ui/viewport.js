// Viewport helpers for the game screen on phones: which layout to use, the on-screen keyboard inset, page chrome.
//
//   useLayoutMode()   'wide' (tablets / desktop) | 'phone' (portrait phone, < 600px wide) | 'land' (short landscape screen:
//                     phones on their side, small windows)
//   useKeyboardInset  keeps `--hg-kb` (px) on <html> = how much of the layout viewport the on-screen keyboard covers
//   useGameChrome     while the game is mounted: <html class="hg-playing"> (no page scroll / pull-to-refresh / bounce)
//
// The pure parts (layoutMode, keyboardInset) are tested in viewport.test.js; the hooks only wire them to the browser.
import { useEffect } from 'react';
import { useMedia } from './helpers.js';

/** Portrait phone: narrower than a tablet. */
export const PHONE_QUERY = '(max-width: 599px)';
/** A phone on its side (or any short landscape window): too short for the stacked layout. */
export const LAND_QUERY = '(orientation: landscape) and (max-height: 520px)';

/** 'land' wins over 'phone' (a 568x320 iPhone SE on its side is "narrow" and "short"). */
export function layoutMode({ phone, land }) {
  if (land) return 'land';
  return phone ? 'phone' : 'wide';
}

export function useLayoutMode() {
  const phone = useMedia(PHONE_QUERY);
  const land = useMedia(LAND_QUERY);
  return layoutMode({ phone, land });
}

/** Below this the "keyboard" is just browser chrome (URL bar collapse), not an on-screen keyboard. */
export const KEYBOARD_MIN = 120;

/**
 * How many CSS px of the bottom of the layout viewport an on-screen keyboard covers.
 * `innerHeight` is the layout viewport, `vvHeight` / `vvOffsetTop` come from `window.visualViewport`.
 * iOS Safari keeps the layout viewport fixed and shrinks / pans the visual one, so the bottom gap is
 * innerHeight - (offsetTop + height). A pinch-zoom (scale > 1) also shrinks the visual viewport: not a keyboard.
 */
export function keyboardInset({ innerHeight, vvHeight, vvOffsetTop = 0, scale = 1 }) {
  if (!(innerHeight > 0) || !(vvHeight > 0)) return 0;
  if (scale > 1.02) return 0;
  const gap = innerHeight - (vvOffsetTop + vvHeight);
  return gap >= KEYBOARD_MIN ? Math.round(gap) : 0;
}

/**
 * `--hg-kb` on <html> while `active`: the tray that holds the chat input sits above the keyboard instead of under it,
 * and nothing else is re-laid out (the board never moves when the keyboard opens). On blur everything returns.
 */
export function useKeyboardInset(active = true) {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!active || !vv) return undefined;
    const doc = document.documentElement;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const kb = keyboardInset({ innerHeight: window.innerHeight, vvHeight: vv.height, vvOffsetTop: vv.offsetTop, scale: vv.scale });
      doc.style.setProperty('--hg-kb', `${kb}px`);
      if (kb) doc.dataset.hgKeyboard = '';
      else delete doc.dataset.hgKeyboard;
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    apply();
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (raf) cancelAnimationFrame(raf);
      doc.style.removeProperty('--hg-kb');
      delete doc.dataset.hgKeyboard;
    };
  }, [active]);
}

/**
 * The game owns the whole screen: while it is mounted <html> gets `hg-playing`, which turns off page scroll,
 * pull-to-refresh and the rubber band (game.css). Also undoes iOS's "scroll the page to the focused input" on blur.
 */
export function useGameChrome() {
  useEffect(() => {
    const doc = document.documentElement;
    doc.classList.add('hg-playing');
    const onFocusOut = () => {
      // iOS leaves the layout viewport panned after the keyboard closes
      setTimeout(() => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); }, 60);
    };
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusout', onFocusOut);
      doc.classList.remove('hg-playing');
    };
  }, []);
}
