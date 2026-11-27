// The HUD scale: one number derived from the viewport HEIGHT (a landscape game is limited by its height, not its width), written on the
// `.aw` root as `--aw-ui-scale` by AutowalaGame.jsx. Pure and unit-tested (scale.test.js).
//   360 px tall phone -> 0.92   390..430 -> ~1.0   720 desktop -> 1.0   864 -> 1.2   1080 -> 1.5   1440 and up -> 1.6
// Below 430 px tall the HUD keeps its own sizes (text under ~11 px stops being readable), so the scale only drops a little there; the
// rest of the fit on a small phone comes from hiding secondary information, not from shrinking everything.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const SCALE_MIN = 0.92;
export const SCALE_MAX = 1.6;

/**
 * Viewport CSS pixels -> the HUD scale (rounded to 2 decimals so the style is not rewritten for sub-pixel resizes).
 * `compact` = the phone / tablet / touch HUD (hud/land.css), which needs far less width than the desktop HUD (about 640 vs 1010 px at scale 1).
 */
export function uiScale(w, h, compact = false) {
  const H = Number(h);
  if (!Number.isFinite(H) || H <= 0) return 1;
  let s;
  if (H <= 360) s = SCALE_MIN;
  else if (H < 430) s = SCALE_MIN + ((H - 360) / 70) * (1 - SCALE_MIN);
  else if (H <= 720) s = 1;
  else s = 1 + ((H - 720) / 360) * 0.5;
  // a narrow window (a desktop window dragged thin) cannot afford a big HUD whatever its height is
  const W = Number(w);
  if (Number.isFinite(W) && W > 0) s = Math.min(s, Math.max(SCALE_MIN, W / (compact ? 640 : 1010)));
  return Math.round(clamp(s, SCALE_MIN, SCALE_MAX) * 100) / 100;
}

/** Writes the scale on an element (the `.aw` root); returns the value. */
export function applyUiScale(el, w, h, compact = false) {
  const s = uiScale(w, h, compact);
  if (el && el.style) el.style.setProperty('--aw-ui-scale', String(s));
  return s;
}
