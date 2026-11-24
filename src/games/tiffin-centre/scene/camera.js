// First-person camera maths (pure, no three, no DOM, so every bit of it is unit-tested): the cook's eyes at (x, eyeHeight, cookZ) looking
// towards -z. Conventions: yaw 0 faces the customers, yaw > 0 turns to the cook's RIGHT (+x), pitch > 0 looks UP. Limits come from
// LAYOUT.view; the field of view widens on portrait phones so the stall front still reads; the lens can be shifted so the interesting
// part of the picture sits in the HUD-safe window.
import { LAYOUT } from '../../../../shared/tiffin-centre/catalog.js';
import { WALK_SPEED } from '../../../../shared/tiffin-centre/movement.js';

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const VIEW = LAYOUT.view;
export const REST_PITCH = -0.1; // where the head rests when there is nothing to look at: a little down, counter and customers both in view
export const HFOV_MIN = 62; // degrees: portrait phones get a taller vertical fov until the horizontal one reaches this
export const FOV_MAX = 100; // degrees (vertical) cap, beyond this the edges stretch too much
export const AUTO_YAW_GAIN = 0.62; // how far (of the way to the target) the head leads while walking
export const AUTO_YAW_MAX = 0.75;
export const AUTO_PITCH_GAIN = 0.55; // look down only part of the way at the work: the customers stay in the top of the picture
export const MANUAL_HOLD_S = 2.4; // free look is held this long after the last input, then the head recentres on its own
export const MANUAL_RELAX = 1.6; // 1/s, how fast it recentres
export const FOLLOW_RATE = 26; // 1/s, how tightly the eye follows the walker (the walker itself is instant: this IS the glide)
export const LOOK_RATE = 9; // 1/s, damping of the head
export const PIN_RATE = 6.5;
export const BOB_CYCLE = 3.4; // metres of walking per full bob cycle (two steps)
export const BOB_Y = 0.034;
export const BOB_X = 0.012;
export const BOB_ROLL = 0.011; // radians
export const LEAN_ROLL = 0.018; // radians of lean into the walking direction at full speed
export const BREATH = 0.0035;

/** Vertical fov (degrees) for an aspect: LAYOUT.view.fov in landscape, wider on portrait phones, never above FOV_MAX. */
export function viewFov(aspect, base = VIEW.fov) {
  const a = clamp(aspect || 1.6, 0.3, 4);
  const need = (2 * Math.atan(Math.tan((HFOV_MIN * D2R) / 2) / a)) / D2R;
  return clamp(Math.max(base, need), base, FOV_MAX);
}

/** Horizontal fov (degrees) for a vertical fov and aspect. */
export const hFovOf = (vfov, aspect) => (2 * Math.atan(Math.tan((vfov * D2R) / 2) * aspect)) / D2R;

/** Default HUD-safe insets (fractions of the viewport height) by orientation. */
export const defaultInsets = (aspect) => (aspect < 0.9 ? { top: 0.1, bottom: 0.22 } : { top: 0.08, bottom: 0.1 });

/** Lens shift (fraction of the viewport height, positive = the picture moves UP) that centres the view in the window the HUD leaves free. */
export function lensShift(insets, aspect) {
  const ins = insets || defaultInsets(aspect || 1.6);
  const centre = (ins.top + (1 - ins.bottom)) / 2;
  return clamp((0.5 - centre) * 0.85, -0.2, 0.2);
}

/** Clamp a look {yaw, pitch} to the view limits (in place). */
export function clampLook(look, view = VIEW) {
  look.yaw = clamp(look.yaw, -view.yawMax, view.yawMax);
  look.pitch = clamp(look.pitch, view.pitchMin, view.pitchMax);
  return look;
}

/** Yaw / pitch that point the eye at (fx, fy, fz) towards (tx, ty, tz). */
export function aimAt(fx, fy, fz, tx, ty, tz, out = { yaw: 0, pitch: 0 }) {
  const dx = tx - fx;
  const dz = tz - fz;
  out.yaw = Math.atan2(dx, -dz);
  out.pitch = Math.atan2(ty - fy, Math.hypot(dx, dz));
  return out;
}

/** The head's goal while the hands work on / walk to a point: leads the walk, settles ahead of the work, partly down. */
export function autoGoal(eyeX, point, out = { yaw: 0, pitch: 0 }) {
  aimAt(eyeX, LAYOUT.eyeHeight, LAYOUT.cookZ, point.x, point.y, point.z, out);
  out.yaw = clamp(out.yaw * AUTO_YAW_GAIN, -AUTO_YAW_MAX, AUTO_YAW_MAX);
  out.pitch = clamp(out.pitch * AUTO_PITCH_GAIN, VIEW.pitchMin, VIEW.pitchMax);
  return out;
}

export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * Math.max(0, dt)));

/** One damped step of a look towards its goal; both clamped to the view limits. Returns `look`. */
export function stepLook(look, goal, rate, dt, view = VIEW) {
  look.yaw = damp(look.yaw, clamp(goal.yaw, -view.yawMax, view.yawMax), rate, dt);
  look.pitch = damp(look.pitch, clamp(goal.pitch, view.pitchMin, view.pitchMax), rate, dt);
  return look;
}

/** Free look: add a delta to the manual offset and keep the RESULT (auto goal + offset) inside the limits. */
export function addManual(manual, dYaw, dPitch, base, view = VIEW) {
  const y = clamp(base.yaw + manual.yaw + (Number.isFinite(dYaw) ? dYaw : 0), -view.yawMax, view.yawMax);
  const p = clamp(base.pitch + manual.pitch + (Number.isFinite(dPitch) ? dPitch : 0), view.pitchMin, view.pitchMax);
  manual.yaw = y - base.yaw;
  manual.pitch = p - base.pitch;
  return manual;
}

/** Walk-cycle phase after moving `dx` metres (phase in radians, one full cycle per BOB_CYCLE metres). */
export const advancePhase = (phase, dx) => (phase + (Math.abs(dx) / BOB_CYCLE) * TAU) % TAU;

/**
 * Head bob for a walk cycle phase and a smoothed speed (0..1): vertical y (two bobs per cycle), side x, roll. Everything is zero when
 * standing still or with reduced motion. `dir` (-1..1) leans the head into the walk.
 */
export function walkBob(phase, speed01, dir, reduced, out = { x: 0, y: 0, roll: 0 }) {
  if (reduced || speed01 <= 0.0005) {
    out.x = out.y = out.roll = 0;
    return out;
  }
  const s = clamp(speed01, 0, 1);
  out.y = -Math.abs(Math.sin(phase)) * BOB_Y * s + BOB_Y * 0.5 * s;
  out.x = Math.sin(phase) * BOB_X * s;
  out.roll = Math.sin(phase) * BOB_ROLL * s - dir * LEAN_ROLL * s;
  return out;
}

/** Smoothed 0..1 walking speed from a measured speed (m/s). */
export const speed01Of = (mps) => clamp(Math.abs(mps) / WALK_SPEED, 0, 1);

/**
 * An edge-of-screen hint for a target that is not on screen. (px, py): the projected CSS px (valid when depth > 0); (vx, vy): the point in
 * camera space (used when it is behind). The hint sits on the border of the window inset by `margin`, along the line from the centre.
 * side: 'left' | 'right' | 'behind'.
 */
export function edgeHint(px, py, depth, vx, vy, w, h, margin = 28, out = { side: 'right', x: 0, y: 0 }) {
  const cx = w / 2;
  const cy = h / 2;
  const behind = depth <= 0.001;
  let dx = behind ? vx : px - cx;
  let dy = behind ? -vy : py - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    dx = 0;
    dy = 1;
  }
  const hw = Math.max(1, cx - margin);
  const hh = Math.max(1, cy - margin);
  const sx = Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  out.x = cx + dx * s;
  out.y = cy + dy * s;
  out.side = behind ? 'behind' : dx < 0 ? 'left' : 'right';
  return out;
}

/** Sway of the camera when something shakes it (decaying `shake`), deterministic in t, radians. */
export function shakeAngles(t, shake, reduced, out = { pitch: 0, yaw: 0, roll: 0 }) {
  if (reduced || shake <= 0) {
    out.pitch = out.yaw = out.roll = 0;
    return out;
  }
  out.pitch = Math.sin(t * 47) * shake * 0.014;
  out.yaw = Math.sin(t * 53 + 1) * shake * 0.01;
  out.roll = Math.sin(t * 61 + 2) * shake * 0.012;
  return out;
}
