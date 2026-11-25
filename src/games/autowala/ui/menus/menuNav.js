// Pure helpers for the menus: selection movement, slider steps, quality cycling, audio settings, gamepad edge detection.
// Unit-tested in menuNav.test.js; the React side (Menus*.jsx) only wires them to the DOM.
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Move a selection index by `dir` (-1 / +1) through `count` rows, wrapping around. */
export function moveSel(sel, count, dir) {
  if (!(count > 0)) return 0;
  const s = Number.isInteger(sel) ? sel : 0;
  return (((s + (dir < 0 ? -1 : 1)) % count) + count) % count;
}

/** Slider value 0..1 moved by one step in direction `dir`, kept to 2 decimals so repeated presses never drift. */
export function stepSlider(value, dir, step = 0.1) {
  const v = Number.isFinite(value) ? value : 0;
  return Math.round(clamp(v + (dir < 0 ? -step : step), 0, 1) * 100) / 100;
}

/** Pointer x on a slider track -> 0..1 (steps of 0.05 so it feels notched). */
export function sliderFromPointer(x, rect, step = 0.05) {
  if (!rect || !(rect.width > 0) || !Number.isFinite(x)) return 0;
  const t = clamp((x - rect.left) / rect.width, 0, 1);
  return Math.round(Math.round(t / step) * step * 100) / 100;
}

export const QUALITIES = [null, 'low', 'medium', 'high']; // null = automatic
export const qualityLabel = (q) => (q === 'low' ? 'Low' : q === 'medium' ? 'Medium' : q === 'high' ? 'High' : 'Auto');
/** Next / previous quality in the cycle Auto -> Low -> Medium -> High. Unknown values count as Auto. */
export function cycleQuality(cur, dir = 1) {
  const i = Math.max(0, QUALITIES.indexOf(cur === undefined ? null : cur));
  return QUALITIES[(((i + (dir < 0 ? -1 : 1)) % QUALITIES.length) + QUALITIES.length) % QUALITIES.length];
}

export const DEFAULT_AUDIO = Object.freeze({ master: 1, fx: 1, voice: 1, music: 1 });
/** settings.audio from a saved profile (any shape) -> four levels 0..1. */
export function normalizeAudio(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of Object.keys(DEFAULT_AUDIO)) out[k] = Number.isFinite(Number(r[k])) && r[k] !== null && r[k] !== '' ? Math.round(clamp(Number(r[k]), 0, 1) * 100) / 100 : DEFAULT_AUDIO[k];
  return out;
}
/** The master bus gain (the shared Web Audio graph runs at 0.8 for "full"). */
export const masterGain = (master, muted) => (muted ? 0 : 0.8 * clamp(Number(master) || 0, 0, 1));

/**
 * Gamepad state -> which menu actions fired THIS poll (edge-triggered). `prev` is the previous result's `held` map.
 * pad: a Gamepad-like { axes, buttons[{pressed}] }. Returns { held, up, down, left, right, select, back, start }.
 */
export function padEdges(prev, pad) {
  const b = (i) => !!(pad && pad.buttons && pad.buttons[i] && pad.buttons[i].pressed);
  const ax = (i) => (pad && pad.axes && Number(pad.axes[i])) || 0;
  const held = {
    up: b(12) || ax(1) < -0.6,
    down: b(13) || ax(1) > 0.6,
    left: b(14) || ax(0) < -0.6,
    right: b(15) || ax(0) > 0.6,
    select: b(0),
    back: b(1),
    start: b(9),
  };
  const was = prev || {};
  const out = { held };
  for (const k of Object.keys(held)) out[k] = held[k] && !was[k];
  return out;
}

/** Pause-menu structure: view path -> its title. */
export const ROOT_ITEMS = [
  { id: 'resume', label: 'RESUME', te: 'కొనసాగించు' },
  { id: 'brief', label: 'BRIEF', te: 'సారాంశం' },
  { id: 'map', label: 'MAP', te: 'మ్యాప్' },
  { id: 'stats', label: 'STATS', te: 'గణాంకాలు' },
  { id: 'options', label: 'OPTIONS', te: 'ఎంపికలు' },
  { id: 'clockout', label: 'CLOCK OUT', te: 'షిఫ్ట్ ముగించు' },
  { id: 'quit', label: 'QUIT TO HUB', te: 'హబ్‌కు వెళ్ళు' },
];
export const OPTION_ITEMS = [
  { id: 'audio', label: 'AUDIO', te: 'ధ్వని' },
  { id: 'display', label: 'DISPLAY', te: 'డిస్‌ప్లే' },
  { id: 'controls', label: 'CONTROLS', te: 'నియంత్రణలు' },
  { id: 'language', label: 'LANGUAGE', te: 'భాష' },
];
/** Back one level: ['options','audio'] -> ['options'] -> []. */
export const backPath = (path) => (Array.isArray(path) ? path.slice(0, -1) : []);
