// Maths for the on-screen steering slider (pure, unit-tested in touchMath.test.js).
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Fraction of the slider's travel that counts as "straight ahead" (centre dead zone), and the curve exponent (1 = linear). */
export const STICK_DEAD = 0.07;
export const STICK_CURVE = 1.35;

/**
 * Where the finger is on the track -> steering -1..1 (+1 = the driver's RIGHT).
 * `x` is the pointer's clientX, `rect` = { left, width }. Edges are reached a little BEFORE the physical end so a thumb never has to
 * reach the very edge; the response curve is gentle near the centre and full at the ends.
 */
export function stickValue(x, rect, { dead = STICK_DEAD, curve = STICK_CURVE, reach = 0.92 } = {}) {
  if (!rect || !(rect.width > 0) || !Number.isFinite(x)) return 0;
  const half = rect.width / 2;
  const raw = clamp((x - (rect.left + half)) / (half * reach), -1, 1);
  const a = Math.abs(raw);
  if (a <= dead) return 0;
  const scaled = (a - dead) / (1 - dead);
  return Math.sign(raw) * Math.pow(scaled, curve);
}

/** Knob offset in px from the track centre for a steering value (inverse of the display, not of the response curve). */
export function knobOffset(raw, rect, knob = 0) {
  if (!rect || !(rect.width > 0)) return 0;
  const room = Math.max(0, rect.width / 2 - knob / 2);
  return clamp(raw, -1, 1) * room;
}

/** Pointer x -> the knob's raw -1..1 position along the track (no dead zone / curve), used to draw the knob under the finger. */
export function rawPosition(x, rect) {
  if (!rect || !(rect.width > 0) || !Number.isFinite(x)) return 0;
  const half = rect.width / 2;
  return clamp((x - (rect.left + half)) / half, -1, 1);
}

/** Is this a phone / tablet style device? (Used once at mount; a touch on screen also switches the controls on.) */
export function detectCoarse(matchMediaFn) {
  try {
    return !!(typeof matchMediaFn === 'function' && matchMediaFn('(pointer: coarse)').matches);
  } catch {
    return false;
  }
}
