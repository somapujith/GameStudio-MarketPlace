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
export function slotVisual(slot, tickF, out = null) {
  const o = out || {};
  o.item = null;
  o.flaw = '';
  if (!slot || slot.st === 'empty') {
    o.st = 'empty'; o.dish = null; o.progress = 0; o.burnFrac = 0; o.age = 0;
    return o;
  }
  // the operations layer: a back-counter job names its `item` (batter, sambar ...), a flawed dish carries `fl` bits (1 stuck, 2 torn, 4 sour)
  o.item = slot.item ?? null;
  o.flaw = flawOf(slot.fl);
  if (slot.st === 'cooking') {
    const span = Math.max(1, (slot.readyAt ?? 0) - (slot.t0 ?? 0));
    o.st = 'cooking'; o.dish = slot.dish ?? null; o.progress = clamp((tickF - (slot.t0 ?? 0)) / span, 0, 1); o.burnFrac = 0; o.age = 0;
    return o;
  }
  if (slot.st === 'ready') {
    const span = Math.max(1, (slot.burnAt ?? 0) - (slot.readyAt ?? 0));
    const age = Math.max(0, tickF - (slot.readyAt ?? 0));
    o.st = 'ready'; o.dish = slot.dish ?? null; o.progress = 1; o.burnFrac = slot.item ? 0 : clamp(age / span, 0, 1); o.age = age;
    return o;
  }
  o.st = 'burnt'; o.dish = slot.dish ?? null; o.progress = 1; o.burnFrac = 1; o.age = 0;
  return o;
}

/** The flaw a dish came out with, from the slot's `fl` bits (1 stuck, 2 torn, 4 sour batter): 'torn' | 'stuck' | 'sour' | ''. */
export function flawOf(fl) {
  const f = Number(fl) | 0;
  return f & 2 ? 'torn' : f & 1 ? 'stuck' : f & 4 ? 'sour' : '';
}

/** Mood name for a customer. */
export function moodOf(c) {
  if (c.st === 'left') return c.outcome === 'angry' ? 'angry' : c.outcome === 'unpaid' ? 'walkaway' : 'happy';
  return c.st === 'eating' ? 'eating' : c.st === 'paying' ? 'paying' : 'waiting';
}

/** Where a customer who is arriving starts (out on the street, to the side and well beyond the counter) for spot i. */
export function arrivalStart(spot, out = { x: 0, z: 0 }) {
  const side = spot % 2 === 0 ? -1 : 1;
  out.x = LAYOUT.spotX(spot) + side * 2.8;
  out.z = LAYOUT.spotZ - 2.6;
  return out;
}

/** Where a customer who leaves walks off to (along the street, away from the stall). */
export function departureEnd(spot, x, out = { x: 0, z: 0 }) {
  const side = spot % 2 === 0 ? -1 : 1;
  out.x = x + side * 3.6;
  out.z = LAYOUT.spotZ - 3.2;
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
    // the operations layer: avatars reuse the closest existing work pose (the ladle for the back counter, the pan's own for tending)
    case 'prep-start':
    case 'prep-collect':
      return { by: ev.by, kind: 'tawa', station: ev.station, verb: ev.type === 'prep-start' ? 'prep' : 'take' };
    case 'tend': {
      const kind = STATIONS[ev.station]?.kind;
      return kind ? { by: ev.by, kind, station: ev.station, verb: 'tend' } : null;
    }
    case 'gas-swap':
      return ev.phase === 'start' ? { by: ev.by, kind: 'collect', verb: 'swap' } : null;
    default:
      return null;
  }
}

// --- first-person work: event -> a short sequence of viewmodel actions (kind, seconds). The SAME sequence drives the station prop's
// playAction(slot, kind, t01), so the hands and the stall move together. Shared constant arrays: nothing is allocated per event.
export const SEQ = {
  // the operations layer reuses the twelve hands actions: pouring batter in the grinder looks like filling, the back counter like a take
  prep: [['tawa-fill', 0.3], ['tawa-spread', 0.35]],
  prepTake: [['tawa-take', 0.3], ['collect', 0.35]],
  tendWipe: [['tawa-oil', 0.25], ['tawa-spread', 0.4]],
  swapGas: [['discard', 0.3], ['collect', 0.35]],
  tawaCook: [['tawa-oil', 0.22], ['tawa-pour', 0.22], ['tawa-spread', 0.3]],
  tawaFlipTake: [['tawa-flip', 0.3], ['tawa-take', 0.3]],
  tawaFillTake: [['tawa-fill', 0.3], ['tawa-take', 0.3]],
  steamer: [['steamer', 0.65]],
  kadai: [['kadai', 0.65]],
  chai: [['chai-pour', 0.65]],
  serve: [['serve', 0.5]],
  collect: [['collect', 0.55]],
  discard: [['discard', 0.5]],
};
export const ACTION_KINDS = ['tawa-oil', 'tawa-pour', 'tawa-spread', 'tawa-flip', 'tawa-fill', 'tawa-take', 'steamer', 'kadai', 'chai-pour', 'serve', 'collect', 'discard'];
const FILLED = new Set(['masala_dosa', 'podi_dosa']); // dosas that get their filling / podi before the fold

/** The viewmodel / station action sequence a game event implies (a SEQ entry) or null. Station events also carry the station and slot. */
export function actionSeqFor(ev) {
  if (!ev) return null;
  switch (ev.type) {
    case 'cook-start': {
      const k = STATIONS[ev.station]?.kind;
      return k === 'tawa' ? SEQ.tawaCook : k === 'steamer' ? SEQ.steamer : k === 'kadai' ? SEQ.kadai : k === 'chai' ? SEQ.chai : null;
    }
    case 'take': {
      const k = STATIONS[ev.station]?.kind;
      if (k === 'tawa') return FILLED.has(ev.dish) ? SEQ.tawaFillTake : SEQ.tawaFlipTake;
      return k === 'steamer' ? SEQ.steamer : k === 'kadai' ? SEQ.kadai : k === 'chai' ? SEQ.chai : null;
    }
    case 'burnt-cleared':
      return SEQ.discard;
    case 'prep-start':
      return STATIONS[ev.station]?.kind === 'prep' ? SEQ.prep : null;
    case 'prep-collect':
      return STATIONS[ev.station]?.kind === 'prep' ? SEQ.prepTake : null;
    case 'tend': {
      const k = STATIONS[ev.station]?.kind;
      return k === 'tawa' ? SEQ.tendWipe : k === 'kadai' ? SEQ.kadai : k === 'steamer' ? SEQ.steamer : null;
    }
    case 'gas-swap':
      return ev.phase === 'start' ? SEQ.swapGas : null;
    case 'serve':
      return SEQ.serve;
    case 'collect':
      return SEQ.collect;
    case 'discard':
      return SEQ.discard;
    default:
      return null;
  }
}

export const seqDuration = (seq) => {
  let d = 0;
  for (let i = 0; i < seq.length; i++) d += seq[i][1];
  return d;
};

/** Where a sequence is after `elapsed` seconds: { kind, t01, done }. Past the end: the last action at t01 = 1, done = true. */
export function sampleSeq(seq, elapsed, out = { kind: null, t01: 0, done: true }) {
  let t = Math.max(0, elapsed);
  for (let i = 0; i < seq.length; i++) {
    const dur = seq[i][1];
    if (t < dur) {
      out.kind = seq[i][0];
      out.t01 = t / dur;
      out.done = false;
      return out;
    }
    t -= dur;
  }
  out.kind = seq[seq.length - 1][0];
  out.t01 = 1;
  out.done = true;
  return out;
}

/**
 * Where another cook stands relative to the local cook, who is the camera: close by (|dxm| < reach) they are pushed beside AND behind the
 * line so nobody walks through the eyes. `side` is a stable +1 / -1 per pair (so passing never flips sides). Smooth in dxm.
 */
export function crowdOffset(dxm, side, out = { x: 0, z: 0 }, reach = 0.9) {
  const w = smoothstep(1 - Math.abs(dxm) / reach);
  out.x = side * 0.72 * w;
  out.z = 0.16 * w;
  return out;
}

/** Distinct, friendly avatar colours; a player's own `avatar` string (a #hex) wins. */
export const AVATAR_COLORS = ['#ff8a1f', '#12908e', '#e0392b', '#8a5cf0'];
export function avatarColor(player, index) {
  const a = player?.avatar;
  if (typeof a === 'string' && /^#[0-9a-f]{6}$/i.test(a)) return a;
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

export { standX };
