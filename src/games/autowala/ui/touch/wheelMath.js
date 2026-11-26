// The steering wheel: a finger drags around the wheel's centre, the wheel turns with it (+-135 degrees lock to lock) and springs back
// on release. All pure (no DOM), unit-tested in wheelMath.test.js. Angles are degrees, 0 = 12 o'clock, clockwise positive, and
// clockwise = steering RIGHT (+1 is the driver's right, see ARCHITECTURE.md).
export const WHEEL_LOCK = 135;
export const WHEEL_DEAD = 2.5; // degrees around centre that still read as straight
export const WHEEL_CURVE = 1.15; // 1 = linear; a touch above 1 is gentler near the centre
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Normalise any angle difference to (-180, 180]. */
export function shortestDelta(to, from) {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Pointer position -> angle round the centre (0 = up, clockwise positive). */
export function angleAround(px, py, cx, cy) {
  const dx = px - cx;
  const dy = py - cy;
  if (dx === 0 && dy === 0) return 0;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** Wheel rotation in degrees -> steering -1..1 with a centre dead zone and a response curve. */
export function steerFromRotation(rot, { lock = WHEEL_LOCK, dead = WHEEL_DEAD, curve = WHEEL_CURVE } = {}) {
  if (!Number.isFinite(rot)) return 0;
  const n = clamp(rot / lock, -1, 1);
  const a = Math.abs(n);
  const d = dead / lock;
  if (a <= d) return 0;
  return Math.sign(n) * Math.pow((a - d) / (1 - d), curve);
}

/** Speed-sensitive smoothing: quicker at a crawl, calmer at speed (the rate is the exponential time-constant inverse, 1/s). */
export function smoothingRate(kmh) {
  return lerp(42, 15, clamp((Number(kmh) || 0) / 55, 0, 1));
}
export function smoothStep(prev, target, dt, kmh) {
  const k = 1 - Math.exp(-smoothingRate(kmh) * Math.max(0, dt));
  const next = prev + (target - prev) * k;
  return Math.abs(next - target) < 0.002 ? target : next;
}

/** One step of the spring back to centre: exponential with a minimum speed so it never lingers near zero. */
export function springBack(rot, dt, { rate = 7, minSpeed = 70 } = {}) {
  if (rot === 0) return 0;
  const step = Math.max(Math.abs(rot) * rate, minSpeed) * Math.max(0, dt);
  return step >= Math.abs(rot) ? 0 : rot - Math.sign(rot) * step;
}

/**
 * The wheel's whole behaviour as a small object. `down(angle)` when a finger lands, `move(angle, radiusFrac)` as it drags (radiusFrac =
 * distance from the centre / wheel radius; a finger almost ON the centre gives a noisy angle, so it is ignored), `up()` on release,
 * `tick(dt, kmh)` every frame. tick() returns { rot, steer, events } where events may hold 'centre' (passed the straight-ahead
 * detent) and 'lock' (reached full lock): the component turns those into haptic ticks.
 */
export function createWheel({ lock = WHEEL_LOCK, minRadius = 0.16 } = {}) {
  const w = { rot: 0, steer: 0, held: false, last: 0, lockArmed: true, inCentre: true };
  const detent = 4;
  w.down = (angle) => {
    w.held = true;
    w.last = angle;
  };
  w.move = (angle, radiusFrac = 1) => {
    if (!w.held) return;
    if (radiusFrac < minRadius) return;
    w.rot = clamp(w.rot + shortestDelta(angle, w.last), -lock, lock);
    w.last = angle;
  };
  w.up = () => {
    w.held = false;
  };
  w.reset = () => {
    w.rot = 0;
    w.steer = 0;
    w.held = false;
    w.lockArmed = true;
    w.inCentre = true;
  };
  let prevRot = 0;
  w.tick = (dt, kmh = 0) => {
    const events = [];
    if (!w.held) w.rot = springBack(w.rot, dt);
    const r = w.rot;
    // detents
    if (Math.abs(r) >= lock - 0.5) {
      if (w.lockArmed) events.push('lock');
      w.lockArmed = false;
    } else if (Math.abs(r) < lock - 14) w.lockArmed = true;
    // the straight-ahead detent: entering the centre band, or swinging straight through it
    if (w.inCentre) {
      if (Math.abs(r) > detent + 4) w.inCentre = false;
    } else if (Math.abs(r) <= detent) {
      w.inCentre = true;
      events.push('centre');
    }
    if (!w.inCentre && prevRot * r < 0) {
      events.push('centre');
    }
    prevRot = r;
    w.steer = smoothStep(w.steer, steerFromRotation(r, { lock }), dt, kmh);
    return { rot: r, steer: w.steer, events };
  };
  return w;
}
