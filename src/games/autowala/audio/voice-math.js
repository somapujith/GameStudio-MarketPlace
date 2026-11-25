// OWNER: voice agent. Small pure maths for the voices: positional audio (pan + distance gain relative to the camera) and
// subtitle timing. Unit-tested in voice-math.test.js.

export const MAX_HEARD_M = 90; // a customer's voice is audible up to here
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Where a voice at `src` sounds from, for a listener (the camera) at `lis` with its screen-right axis (rx, rz) on the ground.
 * Returns { dist, gain 0..1, pan -1 (left)..1 (right), cutoff (Hz, the far voice is muffled), audible }.
 * Units: metres. Right-handed: with the listener looking along -x... only the dot product with `right` matters.
 */
export function spatial(lis, src, maxDist = MAX_HEARD_M) {
  const dx = src.x - lis.x;
  const dz = src.z - lis.z;
  const dist = Math.hypot(dx, dz);
  const near = 6; // inside this the voice is full and centred-ish
  const t = clamp((dist - near) / Math.max(1, maxDist - near), 0, 1);
  const gain = dist >= maxDist ? 0 : Math.pow(1 - t, 1.6);
  const rl = Math.hypot(lis.rx || 0, lis.rz || 0) || 1;
  const side = dist > 0.001 ? (dx * (lis.rx || 0) + dz * (lis.rz || 0)) / (dist * rl) : 0;
  // a voice right next to the camera is not hard-panned: the closer it is, the more it is centred
  const pan = clamp(side * clamp(dist / 14, 0.25, 1), -1, 1);
  const cutoff = 1500 + (1 - t) * 14500;
  return { dist, gain, pan, cutoff, audible: gain > 0.02 };
}

/** A line's spoken length in ms when no audio file gives one: ~75 ms per Telugu/Latin character, 900 ms .. 4500 ms. */
export function estimateMs(text) {
  return clamp(String(text || '').length * 75, 900, 4500);
}

/** How long the subtitle stays on screen for a line of `ms` audio (a little longer than the voice so it can be read). */
export function subtitleHold(ms, text = '') {
  const read = String(text).length * 38; // ~ reading speed
  return clamp(Math.max(ms + 700, read), 1800, 7000);
}

/** Phase of a subtitle at time `t` ms after it appeared: 'in' (fade in) | 'show' | 'out' (fade out) | 'gone'. */
export function subtitlePhase(t, hold, fadeIn = 140, fadeOut = 320) {
  if (t < 0) return 'gone';
  if (t < fadeIn) return 'in';
  if (t < hold) return 'show';
  if (t < hold + fadeOut) return 'out';
  return 'gone';
}
