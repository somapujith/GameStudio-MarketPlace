// Pure weather maths (no three.js): the day-by-day schedule, the transition curve, how rain maps to sky / grip / visibility and how
// the open auto's rider gets wet. gameplay/weather.js wires these to the game; everything here is unit-tested.
import { makeRng } from '../game/rng.js';

/** Weather states in order of severity. `sev` is the one number the system moves: 0 clear .. 0.25 cloudy .. 0.65 rain .. 1 storm. */
export const STATES = ['clear', 'cloudy', 'rain', 'storm'];
export const SEV = { clear: 0, cloudy: 0.25, rain: 0.65, storm: 1 };

const SLOT = 4; // schedule resolution: quarter hours
const SLOTS = 24 * SLOT;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const piecewise = (x, pts) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
};

/** The kind of day: 'dry' | 'cloudy' | 'showers' | 'monsoon'. Day 1 is always dry (the player starts at 17:24), day 2 always showery. */
export function dayKind(day, seed = 1) {
  if (day <= 1) return 'dry';
  if (day === 2) return 'showers';
  const r = makeRng(((seed >>> 0) * 2654435761) ^ (day * 40503) ^ 0x51ed)();
  if (r < 0.14) return 'monsoon';
  if (r < 0.42) return 'showers';
  if (r < 0.6) return 'cloudy';
  return 'dry';
}

const RANK = { clear: 0, cloudy: 1, rain: 2, storm: 3 };

/**
 * The weather of one day as non-overlapping segments covering 0..24: [{ from, to, state }] (hours). Deterministic in (day, seed).
 * Rain spells are padded with cloud on both sides so a shower is seen coming.
 */
export function daySchedule(day, seed = 1) {
  const kind = dayKind(day, seed);
  const rng = makeRng(((seed >>> 0) * 40503) ^ (day * 2246822519) ^ 0x7e57);
  const slots = new Array(SLOTS).fill(0);
  const paint = (from, to, state) => {
    const r = RANK[state];
    for (let i = Math.max(0, Math.floor(from * SLOT)); i < Math.min(SLOTS, Math.ceil(to * SLOT)); i++) if (r > slots[i]) slots[i] = r;
  };
  const spell = (centre, len, storm) => {
    const a = centre - len / 2;
    const b = centre + len / 2;
    paint(a - 1.2, b + 1.0, 'cloudy');
    paint(a, b, 'rain');
    if (storm) paint(a + len * 0.25, b - len * 0.2, 'storm');
  };
  if (kind === 'cloudy') {
    const a = rng.range(7, 12);
    paint(a, a + rng.range(5, 9), 'cloudy');
  } else if (kind === 'showers') {
    const n = rng.chance(0.35) ? 2 : 1;
    let c = rng.range(10, 17);
    for (let i = 0; i < n; i++) {
      spell(c, rng.range(1.2, 2.8), rng.chance(0.3));
      c += rng.range(5, 8);
    }
    if (day === 2) spell(18.5, 2.4, false); // a first taste of rain on the second evening
  } else if (kind === 'monsoon') {
    paint(8, 22, 'cloudy');
    spell(rng.range(10, 13), rng.range(2.5, 4), false);
    spell(rng.range(15, 17.5), rng.range(2.5, 4), true);
    if (rng.chance(0.6)) spell(rng.range(20, 22), rng.range(1.5, 2.5), rng.chance(0.4));
  }
  const out = [];
  for (let i = 0; i < SLOTS; i++) {
    const st = STATES[slots[i]];
    const last = out[out.length - 1];
    if (last && last.state === st) last.to = (i + 1) / SLOT;
    else out.push({ from: i / SLOT, to: (i + 1) / SLOT, state: st });
  }
  return out;
}

/** The state the schedule asks for at an hour (0..24). */
export function stateAt(schedule, hour) {
  const h = ((hour % 24) + 24) % 24;
  for (const s of schedule) if (h >= s.from && h < s.to) return s.state;
  return 'clear';
}

// weather.js asks every frame: the day's schedule (96 slots, an rng, closures) is built once per (day, seed), not once per frame
let memo = { day: NaN, seed: NaN, schedule: null };

/** Weather scheduled for a game time: { state, target (sev) }. */
export function scheduledWeather(day, hour, seed = 1) {
  if (memo.day !== day || memo.seed !== seed || !memo.schedule) memo = { day, seed, schedule: daySchedule(day, seed) };
  const state = stateAt(memo.schedule, hour);
  return { state, target: SEV[state] };
}

/**
 * The transition curve: the severity moves LINEARLY toward its target (a rain front takes ~14 s to arrive, ~28 s to clear) and every
 * published number is a smooth function of it, so nothing pops. Returns the new value.
 */
export function approach(cur, target, dt, up = 1 / 14, down = 1 / 28) {
  const step = (target > cur ? up : down) * dt;
  return Math.abs(target - cur) <= step ? target : cur + Math.sign(target - cur) * step;
}

/** State name for a severity (a little hysteresis keeps it from flickering at a boundary). */
export function stateFor(sev, prev = 'clear') {
  const h = 0.03;
  const up = (name, edge) => (prev === name ? sev >= edge - h : sev >= edge + h);
  if (up('storm', 0.85)) return 'storm';
  if (up('rain', 0.45)) return 'rain';
  if (up('cloudy', 0.1)) return 'cloudy';
  return 'clear';
}

/** The `ctx.state.weather` value (sky darkness, fog, wet roads): clouds barely darken, rain does, a storm is dark. */
export const skyFor = (sev) => piecewise(sev, [[0, 0], [0.25, 0.12], [0.65, 0.7], [1, 1]]);
/** The severity that produces a sky value (used when something outside, like the debug hook, writes `state.weather` directly). */
export const sevForSky = (w) => piecewise(w, [[0, 0], [0.12, 0.25], [0.7, 0.65], [1, 1]]);
/** Rain amount 0..1 (drives streaks, splashes, soaking): none until the sky is properly grey. */
export const rainFor = (sev) => piecewise(sev, [[0.3, 0], [0.65, 0.6], [1, 1]]);
/** How far you can see, 0..1 (fares may use it for a "can't see the customer" patience nudge). */
export const visibilityFor = (sev) => 1 - 0.5 * smoothstep((sev - 0.2) / 0.8);

/**
 * Total tyre grip multiplier (1 = dry). Standing water lingers after the rain, so `puddles` counts for half. The game already
 * multiplies grip by (1 - uWet * 0.28); `gripCompensation` turns this total into the extra factor to publish.
 */
export function gripFor(rain, puddles = 0) {
  const wetness = Math.max(rain, puddles * 0.5);
  return 1 - 0.32 * smoothstep(wetness * 1.15);
}
export function gripCompensation(total, uWet) {
  const builtIn = 1 - clamp01(uWet) * 0.28;
  return Math.max(0.4, Math.min(1, total / builtIn));
}

/** Standing water 0..1: fills while it rains (~40 s of steady rain), drains in ~70 s of sun. */
export function puddleStep(p, rain, dt) {
  const v = rain > 0.08 ? p + (rain * dt) / 40 : p - dt / 70;
  return clamp01(v);
}

/** The roads' wet look: the sky value, but never dry while puddles stand (so the road looks wet for a while after the rain). */
export const roadWetFor = (sky, puddles) => Math.max(sky, puddles * 0.4);

/**
 * The rider is wet (0..1). The auto has a roof but open sides: rain drives in faster the faster you go. Standing still under the
 * roof soaks you slowly. Drying is slow and quicker at speed (the wind).
 */
export function wetStep(wet, rain, speed, dt, sheltered = false) {
  if (rain > 0.08 && !sheltered) {
    const rate = rain * (0.006 + 0.0011 * Math.min(speed, 24));
    return clamp01(wet + rate * dt);
  }
  return clamp01(wet - (0.004 + 0.0007 * Math.min(speed, 24)) * dt);
}

// ------------------------------------------------------------------------------------------------ lightning
/** Seconds until the next flash: storms flash every 4..12 s, heavy rain rarely (20..45 s), light rain never (Infinity). */
export function nextFlashDelay(rain, rnd) {
  if (rain >= 0.9) return 4 + rnd * 8;
  if (rain >= 0.75) return 20 + rnd * 25;
  return Infinity;
}
/** Flash brightness 0..1 `t` seconds after it started: a hard strike, a dip, a second softer strike. */
export function flashEnvelope(t) {
  if (t < 0 || t > 0.55) return 0;
  const strike = (x, w) => (x < 0 || x > w ? 0 : Math.pow(1 - x / w, 2));
  return Math.min(1, strike(t, 0.16) + 0.6 * strike(t - 0.22, 0.2) + 0.3 * strike(t - 0.4, 0.14));
}
/** Thunder arrives later the further the strike: 0.3..3.5 s after the flash. */
export const thunderDelay = (rnd) => 0.3 + rnd * 3.2;
