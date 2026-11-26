// The player's touch-control choices, kept in localStorage under `jalebi.autowala.touch.v1`. Pure helpers (sanitize / migrate /
// load / save take an optional storage so they run in node tests). Anything unknown, hostile or from an older shape is repaired,
// never thrown on.
export const TOUCH_KEY = 'jalebi.autowala.touch.v1';
export const STEERING_MODES = ['wheel', 'tilt', 'arrows'];
export const HANDS = ['right', 'left'];
export const SIZES = ['S', 'M', 'L'];
export const SIZE_SCALE = { S: 0.86, M: 1, L: 1.18 };

export const DEFAULTS = Object.freeze({
  v: 1,
  steering: 'wheel', // 'wheel' | 'tilt' | 'arrows'
  hand: 'right', // 'right' = wheel on the left, pedals on the right; 'left' mirrors everything
  size: 'M', // 'S' | 'M' | 'L'
  opacity: 0.88, // 0.35..1
  autoThrottle: false, // keep the gas on while the brake is not pressed
  haptics: true,
  force: false, // show the controls even on a mouse-first device
  tiltSens: 0.5, // 0..1 (1 = a small tilt gives full lock)
  tiltNeutral: 0, // degrees: the roll that counts as "straight"
  tiltInvert: false, // flips the tilt direction (a sensor that reports the other way round)
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : d;
};
const bool = (v, d) => (typeof v === 'boolean' ? v : v === 1 || v === 'true' ? true : v === 0 || v === 'false' ? false : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);

/** Old / foreign shapes -> the v1 field names. (v0 had `mode`, `leftHanded`, `scale` 0.8..1.3, `alpha`.) */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = { ...raw };
  if (o.steering === undefined && o.mode !== undefined) o.steering = o.mode === 'slider' || o.mode === 'stick' ? 'wheel' : o.mode;
  if (o.hand === undefined && o.leftHanded !== undefined) o.hand = bool(o.leftHanded, false) ? 'left' : 'right';
  if (o.hand === 'mirror' || o.hand === 'left-handed' || o.hand === 'lefty') o.hand = 'left';
  if (o.hand === 'right-handed' || o.hand === 'righty') o.hand = 'right';
  if (o.size === undefined && o.scale !== undefined) {
    const s = num(o.scale, 1);
    o.size = s < 0.93 ? 'S' : s > 1.08 ? 'L' : 'M';
  }
  if (typeof o.size === 'string') o.size = o.size.toUpperCase();
  if (o.opacity === undefined && o.alpha !== undefined) o.opacity = o.alpha;
  if (o.opacity > 1 && o.opacity <= 100) o.opacity /= 100; // percent
  if (o.autoThrottle === undefined && o.autoGas !== undefined) o.autoThrottle = o.autoGas;
  if (o.force === undefined && o.alwaysShow !== undefined) o.force = o.alwaysShow;
  return o;
}

/** Any value -> a complete, valid settings object. */
export function sanitize(raw) {
  const o = migrate(raw);
  return {
    v: 1,
    steering: pick(o.steering, STEERING_MODES, DEFAULTS.steering),
    hand: pick(o.hand, HANDS, DEFAULTS.hand),
    size: pick(o.size, SIZES, DEFAULTS.size),
    opacity: Math.round(clamp(num(o.opacity, DEFAULTS.opacity), 0.35, 1) * 100) / 100,
    autoThrottle: bool(o.autoThrottle, DEFAULTS.autoThrottle),
    haptics: bool(o.haptics, DEFAULTS.haptics),
    force: bool(o.force, DEFAULTS.force),
    tiltSens: Math.round(clamp(num(o.tiltSens, DEFAULTS.tiltSens), 0, 1) * 100) / 100,
    tiltNeutral: Math.round(clamp(num(o.tiltNeutral, DEFAULTS.tiltNeutral), -180, 180) * 10) / 10,
    tiltInvert: bool(o.tiltInvert, DEFAULTS.tiltInvert),
  };
}

const defaultStorage = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export function loadTouchSettings(storage = defaultStorage()) {
  try {
    const txt = storage && storage.getItem(TOUCH_KEY);
    return sanitize(txt ? JSON.parse(txt) : null);
  } catch {
    return sanitize(null);
  }
}

/** Saves the sanitised settings; returns what was stored (or the sanitised value when storage is blocked). */
export function saveTouchSettings(settings, storage = defaultStorage()) {
  const clean = sanitize(settings);
  try {
    if (storage) storage.setItem(TOUCH_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota: the choice just lasts for this session */
  }
  return clean;
}

/** `?touch=1` in the address forces the controls on (handy on a laptop with a touch screen, and for testing). */
export function forcedByUrl(search = typeof location !== 'undefined' ? location.search : '') {
  try {
    const v = new URLSearchParams(search).get('touch');
    return v === '1' || v === 'true' || v === 'on';
  } catch {
    return false;
  }
}
