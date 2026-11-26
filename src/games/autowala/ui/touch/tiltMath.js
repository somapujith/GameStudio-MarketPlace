// Tilt steering: turn the phone like a steering wheel. The roll is taken from the gravity direction expressed in SCREEN coordinates,
// so it is the same in portrait, landscape and the flipped landscape (the screen angle picks which device axes are "screen up/right"),
// and it has no gimbal problem when the phone is held upright. Pure functions, unit-tested in tiltMath.test.js.
// Roll is degrees, clockwise (as the player sees it) positive = steer RIGHT.
const RAD = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** screen.orientation.angle / window.orientation (may be negative, e.g. -90) -> 0 | 90 | 180 | 270. */
export function normaliseScreenAngle(a) {
  const n = Number(a);
  if (!Number.isFinite(n)) return 0;
  return (((Math.round(n / 90) * 90) % 360) + 360) % 360;
}

/** The current screen angle of a window (works with the modern and the legacy API). */
export function screenAngleOf(win = typeof window !== 'undefined' ? window : null) {
  try {
    const o = win && win.screen && win.screen.orientation;
    if (o && Number.isFinite(o.angle)) return normaliseScreenAngle(o.angle);
    if (win && Number.isFinite(win.orientation)) return normaliseScreenAngle(win.orientation);
  } catch {
    /* ignore */
  }
  return 0;
}

/** Shortest signed difference a - b in degrees, (-180, 180]. */
export function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * DeviceOrientation (beta, gamma in degrees) + the screen angle -> the roll of the screen about its own normal.
 * Returns null when there is no usable reading (a missing value, or the phone lying flat so "tilt" means nothing).
 */
export function tiltRoll(beta, gamma, screenAngle = 0) {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  const b = beta * RAD;
  const g = gamma * RAD;
  // world "up" in device axes (x right, y toward the top of the phone in portrait, z out of the screen)
  const ux = -Math.cos(b) * Math.sin(g);
  const uy = Math.sin(b);
  let sx;
  let sy;
  switch (normaliseScreenAngle(screenAngle)) {
    case 90: // landscape, top of the phone to the left
      sx = -uy;
      sy = ux;
      break;
    case 180:
      sx = -ux;
      sy = -uy;
      break;
    case 270: // landscape, top of the phone to the right
      sx = uy;
      sy = -ux;
      break;
    default:
      sx = ux;
      sy = uy;
  }
  if (Math.hypot(sx, sy) < 0.2) return null; // flat on a table
  return Math.atan2(-sx, sy) / RAD;
}

/** Full lock at this many degrees of tilt for a sensitivity 0..1 (0 = 60 degrees, 1 = 20 degrees). */
export const fullLockDegrees = (sens) => 60 - 40 * clamp(Number.isFinite(sens) ? sens : 0.5, 0, 1);

/** Roll + calibrated neutral -> steering -1..1 with a small dead zone. */
export function tiltSteer(roll, { neutral = 0, sens = 0.5, invert = false, dead = 2 } = {}) {
  if (!Number.isFinite(roll)) return 0;
  const d = angleDiff(roll, neutral);
  const a = Math.abs(d);
  if (a <= dead) return 0;
  const v = clamp(Math.sign(d) * ((a - dead) / (fullLockDegrees(sens) - dead)), -1, 1);
  return invert ? -v : v;
}

/** Exponential low-pass: `tau` seconds of smoothing (a shaky hand and sensor noise out, quick turns still through). */
export function lowPass(prev, next, dt, tau = 0.07) {
  if (!Number.isFinite(prev)) return next;
  if (!(tau > 0)) return next;
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  return prev + (next - prev) * k;
}

/**
 * Filter that works on the roll ANGLE (not the steer value) so it can be shown on the wheel and calibrated.
 * feed(beta, gamma, angle) stores the latest sensor sample, step(dt) filters it, calibrate() makes the current roll "straight".
 */
export function createTilt({ neutral = 0, sens = 0.5, invert = false, tau = 0.07 } = {}) {
  const t = { neutral, sens, invert, roll: null, filtered: null, steer: 0, samples: 0 };
  t.feed = (beta, gamma, angle) => {
    const r = tiltRoll(beta, gamma, angle);
    if (r === null) return false;
    t.roll = r;
    t.samples++;
    return true;
  };
  t.step = (dt) => {
    if (t.roll === null) {
      t.steer = 0;
      return 0;
    }
    // filter the angular difference so the wrap at +-180 does not smear through zero
    if (t.filtered === null) t.filtered = t.roll;
    else t.filtered += lowPass(0, angleDiff(t.roll, t.filtered), dt, tau);
    t.steer = tiltSteer(t.filtered, { neutral: t.neutral, sens: t.sens, invert: t.invert });
    return t.steer;
  };
  /** Make the current roll the straight-ahead; returns it (or null when there is no reading yet). */
  t.calibrate = () => {
    if (t.roll === null) return null;
    t.neutral = Math.round(t.roll * 10) / 10;
    t.filtered = t.roll;
    return t.neutral;
  };
  t.reset = () => {
    t.roll = null;
    t.filtered = null;
    t.steer = 0;
    t.samples = 0;
  };
  return t;
}

/** Wheel angle to draw for a tilt (so the on-screen wheel mirrors the phone): the filtered roll relative to neutral, +-135. */
export function tiltWheelAngle(tilt, lock = 135) {
  if (!tilt || tilt.filtered === null) return 0;
  const a = clamp(angleDiff(tilt.filtered, tilt.neutral) * (lock / fullLockDegrees(tilt.sens)), -lock, lock);
  return tilt.invert ? -a : a;
}
