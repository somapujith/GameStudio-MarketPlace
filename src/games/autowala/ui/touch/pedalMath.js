// Pedals: an analogue value from where the thumb sits inside the pedal (higher = harder), a brake that stops first and only reverses
// on a NEW press at a standstill, and optional auto-throttle. Pure, unit-tested in pedalMath.test.js.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Finger y inside the pedal rect -> 0..1. The bottom edge gives `floor` (a plain tap always does something), the top 14% gives full.
 * `rect` = { top, height }.
 */
export function pedalValue(y, rect, { floor = 0.22, top = 0.14, bottom = 0.04 } = {}) {
  if (!rect || !(rect.height > 0) || !Number.isFinite(y)) return 0;
  const t = 1 - (y - rect.top) / rect.height; // 0 at the bottom edge, 1 at the top edge
  const norm = clamp((t - bottom) / (1 - top - bottom), 0, 1);
  return floor + (1 - floor) * norm;
}

/** Pressure steps (a haptic tick each time the value crosses one going up or down). */
export const PEDAL_STEPS = [0.4, 0.7, 0.97];
export function stepIndex(value, steps = PEDAL_STEPS) {
  let n = 0;
  for (const s of steps) if (value >= s) n++;
  return n;
}

/**
 * The brake pedal. The sim treats "brake while moving forward" as braking and "brake at a standstill" as REVERSE, so a held pedal
 * would roll straight on into reverse. Racing games avoid that: a press that STARTS while moving forward only brakes; when the auto
 * stops, the pedal goes quiet until it is released, and the next press (at a standstill) reverses.
 *   gate = createBrakeGate();  gate.press(fwd);  gate.output(value, fwd) -> brake 0..1;  gate.release()
 */
export function createBrakeGate({ moving = 1.2, stopped = 0.8 } = {}) {
  const g = { down: false, mode: 'reverse' };
  g.press = (fwd) => {
    g.down = true;
    g.mode = fwd > moving ? 'stop' : 'reverse';
  };
  g.release = () => {
    g.down = false;
    g.mode = 'reverse';
  };
  g.output = (value, fwd) => {
    if (!g.down) return 0;
    if (g.mode === 'stop') {
      if (fwd <= stopped) return 0; // stopped: hold still, wait for a new press to reverse
      return value;
    }
    return value;
  };
  return g;
}

/** Auto-throttle: gas stays on (at `cruise`) while the brake is untouched; the pedal still adds up to full. */
export function applyAutoThrottle(gas, brake, enabled, cruise = 0.85) {
  if (!enabled) return gas;
  if (brake > 0.02) return 0;
  return Math.max(gas, cruise);
}
