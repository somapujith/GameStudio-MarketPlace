// Pure interpolation + mapping helpers for the scene (no three, no DOM): tick fractions, hour, patience / pay timers,
// slot progress, walking lanes, event -> work animation. Everything the sync layer needs that can be unit-tested.
import { TICK_MS, PAY_WINDOW, STATIONS, LAYOUT } from '../../../../shared/tiffin-centre/catalog.js';
import { LANE_OFFSET, WALK_SPEED, standX } from '../../../../shared/tiffin-centre/movement.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const easeInOut = smoothstep;
export const easeOutCubic = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
export const easeOutBack = (t) => {
  const x = clamp(t, 0, 1) - 1;
  return 1 + 2.70158 * x * x * x + 1.70158 * x * x;
};
export const wrapAngle = (a) => {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
};
/** Move angle a towards b by the shortest way, exponentially (rate per second). */
export const angleDamp = (a, b, rate, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

/** Fraction of the current tick that has elapsed (0..1), from performance.now()-style timestamps. */
export const tickFrac = (now, tickAt, tickMs = TICK_MS) => (tickAt == null ? 0 : clamp((now - tickAt) / tickMs, 0, 1));

/** The continuous clock hour of a state: lerp(cfg.hour[0], cfg.hour[1], (tick + frac) / shiftTicks). */
export function hourAt(state, frac = 0) {
  const [a, b] = state?.cfg?.hour || [12, 12];
  const n = Math.max(1, state?.shiftTicks || 1);
  return lerp(a, b, clamp(((state?.tick || 0) + clamp(frac, 0, 1)) / n, 0, 1));
}

/** Patience 0..1 for the ring. While waiting it drains 1/tick, so draw it between ticks. */
export function patienceFrac(c, frac = 0, cfg = null) {
  const max = c.patienceMax || 1;
  const drain = c.st === 'waiting' && !cfg?.noPatience ? frac : 0;
  return clamp((c.patience - drain) / max, 0, 1);
}

/** Time left to collect, 0..1 of PAY_WINDOW (the glowing note's halo). */
export function payFrac(c, frac = 0, cfg = null) {
  const drain = c.st === 'paying' && !cfg?.noPayExpiry ? frac : 0;
  return clamp((c.payLeft - drain) / PAY_WINDOW, 0, 1);
}

/**
 * What a station slot looks like at fractional tick `tickF` (= state.tick + frac).
 * cooking: progress 0..1 to ready; ready: progress 1 and burnFrac 0..1 towards burning; burnt: both 1.
 */
export function slotVisual(slot, tickF) {
  if (!slot || slot.st === 'empty') return { st: 'empty', dish: null, progress: 0, burnFrac: 0, age: 0 };
  if (slot.st === 'cooking') {
    const span = Math.max(1, (slot.readyAt ?? 0) - (slot.t0 ?? 0));
    return { st: 'cooking', dish: slot.dish, progress: clamp((tickF - (slot.t0 ?? 0)) / span, 0, 1), burnFrac: 0, age: 0 };
  }
  if (slot.st === 'ready') {
    const span = Math.max(1, (slot.burnAt ?? 0) - (slot.readyAt ?? 0));
    const age = Math.max(0, tickF - (slot.readyAt ?? 0));
    return { st: 'ready', dish: slot.dish, progress: 1, burnFrac: clamp(age / span, 0, 1), age };
  }
  return { st: 'burnt', dish: slot.dish, progress: 1, burnFrac: 1, age: 0 };
}

/** Mood name for a customer. */
export function moodOf(c) {
  if (c.st === 'left') return c.outcome === 'angry' ? 'angry' : c.outcome === 'unpaid' ? 'walkaway' : 'happy';
  return c.st === 'eating' ? 'eating' : c.st === 'paying' ? 'paying' : 'waiting';
}

/** Where a customer who is arriving starts (on the road side) for spot i: alternate left / right of the spot. */
export function arrivalStart(spot, out = { x: 0, z: 0 }) {
  const side = spot % 2 === 0 ? -1 : 1;
  out.x = LAYOUT.spotX(spot) + side * 2.6;
  out.z = 4.4;
  return out;
}

/** Hash a string / number to a small positive integer seed. */
export function hashSeed(v) {
  const s = String(v);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

/**
 * Lane offset in z for avatar i among avatars at x positions `xs`: two people at (nearly) the same x stand LANE_OFFSET apart on
 * either side of the line, never overlapping; people walking past each other ease apart. Lower index takes the +z (front) lane.
 */
export function laneOffset(i, xs, reach = 0.7) {
  let sum = 0;
  for (let j = 0; j < xs.length; j++) {
    if (j === i) continue;
    const dx = Math.abs(xs[i] - xs[j]);
    if (dx >= reach) continue;
    const w = 1 - dx / reach;
    sum += (i < j ? 1 : -1) * w * LANE_OFFSET;
  }
  return clamp(sum, -LANE_OFFSET * 1.6, LANE_OFFSET * 1.6);
}

/**
 * Advance an avatar walker towards its stand x with the shared kinematics (same speed as the HUD's runner).
 * Mutates `w` ({x, dir, arrived}) and returns true on the frame it arrives.
 */
export function stepAvatarX(w, targetX, dt) {
  const d = targetX - w.x;
  const step = WALK_SPEED * Math.max(0, dt);
  if (Math.abs(d) <= step) {
    const was = w.arrived;
    w.x = targetX;
    w.dir = 0;
    w.arrived = true;
    return !was;
  }
  w.x += Math.sign(d) * step;
  w.dir = Math.sign(d);
  w.arrived = false;
  return false;
}

export const WORK_KINDS = ['tawa', 'steamer', 'kadai', 'chai', 'serve', 'collect', 'discard'];

/** Map a game event to the work animation it implies: { by, kind, verb, station? } or null. */
export function workForEvent(ev) {
  if (!ev || !ev.by) return null;
  switch (ev.type) {
    case 'cook-start':
    case 'take':
    case 'burnt-cleared': {
      const kind = STATIONS[ev.station]?.kind;
      return kind ? { by: ev.by, kind, station: ev.station, verb: ev.type === 'cook-start' ? 'cook' : 'take' } : null;
    }
    case 'serve':
      return { by: ev.by, kind: 'serve', verb: 'serve' };
    case 'collect':
      return { by: ev.by, kind: 'collect', verb: 'collect' };
    case 'discard':
      return { by: ev.by, kind: 'discard', verb: 'discard' };
    default:
      return null;
  }
}

/** Distinct, friendly avatar colours; a player's own `avatar` string (a #hex) wins. */
export const AVATAR_COLORS = ['#ff8a1f', '#12908e', '#e0392b', '#8a5cf0'];
export function avatarColor(player, index) {
  const a = player?.avatar;
  if (typeof a === 'string' && /^#[0-9a-f]{6}$/i.test(a)) return a;
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

export { standX };
