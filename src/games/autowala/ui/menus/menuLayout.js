// How the full-screen menus lay themselves out. CSS does the work through two media queries (the same strings are used by the style
// sheets and asserted by menuLayout.test.js); this file is the pure mirror of them so React code (the garage, the roots'
// `data-layout`) and the tests agree on what "phone portrait / phone landscape / tablet / desktop" mean.
//
//   phone-portrait   narrow window held upright: one scrolling sheet, a sticky header with a 44 px close button, a sticky action bar
//   phone-landscape  short window held sideways: two columns (list left, detail right), no bottom bar, the header is one thin row
//   tablet           a touch screen with room to spare: the desktop layout with 44 px tap targets
//   desktop          everything as before
import { useViewport } from '@/lib/mobile.js';

export const PORTRAIT_QUERY = '(max-width: 760px) and (orientation: portrait)';
export const LANDSCAPE_QUERY = '(max-height: 520px) and (orientation: landscape)';
/** The smallest thing a finger should have to hit. */
export const MIN_TAP = 44;
/** The gap between two neighbouring tap targets. */
export const MIN_GAP = 8;

/**
 * Which layout applies to a window of w x h CSS pixels. `coarse` = the primary pointer is a finger.
 * Mirrors PORTRAIT_QUERY / LANDSCAPE_QUERY exactly: landscape (width > height) and h <= 520 is a phone held sideways; portrait
 * (height >= width) and w <= 760 is a phone held upright.
 */
export function menuLayout({ w = 0, h = 0, coarse = false } = {}) {
  if (!w || !h) return 'desktop'; // unknown size (server render, tests): the desktop markup
  if (w > h && h <= 520) return 'phone-landscape';
  if (h >= w && w <= 760) return 'phone-portrait';
  if (coarse && Math.min(w, h) < 900) return 'tablet';
  return 'desktop';
}

export const isCompact = (layout) => layout === 'phone-portrait' || layout === 'phone-landscape';

/** React hook: the layout name for the live viewport. */
export function useMenuLayout() {
  const v = useViewport();
  return menuLayout({ w: v.w, h: v.h, coarse: v.coarse });
}
