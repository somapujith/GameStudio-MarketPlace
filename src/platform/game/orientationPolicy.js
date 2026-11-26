// The pure rules behind the "play this game sideways" gate (OrientationGate.jsx / useOrientationPolicy.js). No DOM, no React: every rule here is
// unit-tested in node (orientation.test.js) against real device sizes.
//
// A game declares `orientation: 'landscape'` in its manifest. On a touch-first device (phone or tablet) held upright the game is paused and a
// "turn your phone sideways" screen covers it. Desktop (a mouse is the main pointer) is NEVER gated, however narrow the window is.
//
//   shouldGate({ policy, coarse, viewport: { w, h }, portrait, keyboardOpen, prevPortrait })  -> boolean
//
// Why the inputs look like this:
//   - `viewport` is the LAYOUT viewport (innerWidth x innerHeight). Its shape is the truth for "is this window portrait?", which also gives the
//     right answer in split-screen and small windows (the game is cramped by the WINDOW, not by the device).
//   - `portrait` is the device's own reading (screen.orientation, window.orientation, matchMedia). A virtual keyboard cannot change it.
//   - `keyboardOpen`: the keyboard eats height, so a portrait phone with the keyboard up can look "wider than tall". While it is open the
//     viewport shape is ignored and the device reading (or the previous decision) is used, so typing never un-gates a phone held upright.
//   - `prevPortrait` is the previous decision: a window that is nearly square keeps it (hysteresis), so a foldable, a split-screen divider or
//     a shrinking browser toolbar never makes the gate flicker.

export const POLICIES = Object.freeze(['landscape', 'portrait', 'any']);

/** A manifest value -> a known policy ('any' for anything else: unknown values never block a game). */
export function normalizePolicy(p) {
  return p === 'landscape' || p === 'portrait' ? p : 'any';
}

/** Width and height this close (as a fraction of the longer side) count as "nearly square": the previous decision stands. */
export const NEAR_SQUARE = 0.08;

/** The keyboard has taken at least this much height (px, and as a fraction of the page height) while a text field has focus. */
export const KEYBOARD_MIN_PX = 120;
export const KEYBOARD_MIN_FRACTION = 0.15;

const num = (v) => (Number.isFinite(v) ? v : 0);

/** Is a layout viewport portrait? true / false, or null when its size is unusable. A nearly square one keeps `prev` (hysteresis). */
export function windowShape(viewport, prev = null) {
  const w = num(viewport && viewport.w);
  const h = num(viewport && viewport.h);
  if (!(w > 0 && h > 0)) return null;
  if (typeof prev === 'boolean' && Math.abs(h - w) / Math.max(w, h) < NEAR_SQUARE) return prev;
  return h >= w; // CSS `(orientation: portrait)` is true for a square window too
}

/** Is the on-screen keyboard open? A text field has focus AND the visible page lost a big slice of its height since the width last changed. */
export function detectKeyboard({ editableFocused = false, baseH = 0, visibleH = 0 } = {}) {
  if (!editableFocused || !(baseH > 0) || !(visibleH > 0)) return false;
  return baseH - visibleH >= Math.max(KEYBOARD_MIN_PX, baseH * KEYBOARD_MIN_FRACTION);
}

/** Portrait or not, from the facts (see the header). Never throws; with nothing to go on it answers false (not gated). */
export function resolvePortrait({ viewport, portrait = null, keyboardOpen = false, prevPortrait = null } = {}) {
  const device = typeof portrait === 'boolean' ? portrait : null;
  const prev = typeof prevPortrait === 'boolean' ? prevPortrait : null;
  if (keyboardOpen) {
    const shape = device ?? prev;
    return shape ?? windowShape(viewport, null) ?? false;
  }
  const shape = windowShape(viewport, prev);
  return shape ?? device ?? prev ?? false;
}

/**
 * Should the game be covered by the "turn your phone" screen?
 * policy 'landscape': gated while a touch device is portrait. policy 'portrait': the mirror image. 'any' (or anything unknown): never.
 * `coarse` = a finger is the main pointer (src/lib/mobile.js isCoarsePointer). A mouse-first device is never gated.
 */
export function shouldGate({ policy = 'landscape', coarse = false, viewport, portrait = null, keyboardOpen = false, prevPortrait = null } = {}) {
  const p = normalizePolicy(policy);
  if (p === 'any' || !coarse) return false;
  const isPortrait = resolvePortrait({ viewport, portrait, keyboardOpen, prevPortrait });
  return p === 'landscape' ? isPortrait : !isPortrait;
}

/** Text fields that open the virtual keyboard (a checkbox, a button or a range slider do not). */
const TEXTUAL_INPUT = /^(text|search|url|tel|email|password|number|date|datetime-local|month|time|week)?$/i;
export function isEditableElement(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return TEXTUAL_INPUT.test(String(el.type || ''));
  return el.isContentEditable === true;
}

/** The device's own orientation reading: true = portrait, false = landscape, null = unknown. screen.orientation, else the old window.orientation. */
export function deviceIsPortrait(win) {
  try {
    const so = win && win.screen && win.screen.orientation;
    if (so && typeof so.type === 'string') return so.type.startsWith('portrait');
    if (win && typeof win.orientation === 'number') return Math.abs(win.orientation) !== 90; // iOS before 16.4
  } catch {
    /* a locked-down browser */
  }
  return null;
}

/** The generic "Best played in landscape" chip the game page shows for a manifest with `orientation: 'landscape'` ('' for any other). */
export function orientationLabel(game) {
  const o = game && typeof game === 'object' ? normalizePolicy(game.orientation) : 'any';
  if (o === 'landscape') return 'Best played in landscape';
  if (o === 'portrait') return 'Best played upright';
  return '';
}

/** The same fact for the "Game details" rows ('' when the manifest has no `orientation`). */
export function orientationDetail(game) {
  const o = game && typeof game === 'object' ? normalizePolicy(game.orientation) : 'any';
  if (o === 'landscape') return 'Landscape on phones and tablets';
  if (o === 'portrait') return 'Portrait on phones and tablets';
  return '';
}
