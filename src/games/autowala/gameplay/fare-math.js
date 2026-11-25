// Fare maths: the meter, passenger mood, stars, tips, patience. Pure and deterministic, so it is all unit-tested.
import { FARE, KINDS } from './fare-kinds.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Estimated road distance for a straight line. */
export const routeEstimate = (straight) => straight * FARE.routeFactor;

/** The fare we quote before the ride: base + per-metre on the estimated road distance, scaled by who is riding. */
export function estimateFare(kind, straight) {
  const k = KINDS[kind] || KINDS.regular;
  const raw = (FARE.base + FARE.perMeter * routeEstimate(straight)) * k.fareMult;
  return Math.round(clamp(raw, FARE.min, FARE.max));
}

/** The live meter: ticks with the distance really driven plus the seconds spent waiting (traffic, stops), capped near the estimate. */
export function meterNow(kind, driven, waited, estimate) {
  const k = KINDS[kind] || KINDS.regular;
  const raw = (FARE.base + FARE.perMeter * Math.max(0, driven) + FARE.waitPerSecond * Math.max(0, waited)) * k.fareMult;
  const cap = Math.max(estimate * FARE.meterCapFactor, FARE.min);
  return Math.round(clamp(raw, FARE.min, Math.min(cap, FARE.max * 1.4)));
}

/** A rusher's time to reach the drop-off: a fixed grace plus the road estimate at a brisk 11 m/s. */
export const rushTimeLimit = (straight) => Math.round(25 + routeEstimate(straight) / 11);

/** Patience 1 -> 0 over `total` seconds (rate < 1 slows it, e.g. while the player is on another fare). */
export const patienceStep = (p, total, dt, rate = 1) => clamp(p - (dt / Math.max(total, 1)) * rate, 0, 1);

/**
 * One tick of passenger mood (0..1).
 * s = { kmh, jolt (0..1), drifting, scenic (near a landmark), late (rusher past the deadline) }
 */
export function moodStep(kind, mood, s, dt) {
  const k = KINDS[kind] || KINDS.regular;
  let rate = 0;
  const over = Math.max(0, s.kmh - k.maxKmh);
  rate -= over * k.speedPain;
  const fast = Math.max(0, s.kmh - k.fastKmh);
  rate += fast * k.speedJoy;
  rate -= (s.jolt || 0) * k.jolt;
  if (s.drifting) rate += k.drift;
  if (s.scenic) rate += k.scenic;
  if (s.late) rate -= 0.05;
  // a quiet ride slowly wins them over
  if (rate >= 0 && !s.drifting && (s.jolt || 0) < 0.05) rate += k.calm;
  return clamp(mood + rate * dt, 0, 1);
}

/** A crash or a very hard stop knocks mood in one go. `strength` 0..1.4 for crashes. */
export const crashHit = (kind, mood, strength) => clamp(mood - (KINDS[kind] || KINDS.regular).crash * clamp(strength, 0, 1.4) * 1.6, 0, 1);
export const brakeHit = (kind, mood) => clamp(mood - (KINDS[kind] || KINDS.regular).brake, 0, 1);
/** A deceleration (m/s^2) that counts as a "hard stop" for the passenger. */
export const HARD_BRAKE = 22;

/** What the passenger would grumble about right now (the voice agent speaks it), or null. */
export function complaintReason(kind, s) {
  const k = KINDS[kind] || KINDS.regular;
  if ((s.jolt || 0) > 0.45 && k.jolt >= 0.2) return 'jolt';
  if (s.kmh > k.maxKmh + 8 && k.speedPain > 0.001) return 'speed';
  if (s.drifting && k.drift <= -0.1) return 'drift';
  return null;
}

export const starsFromScore = (score) => (score >= 0.84 ? 5 : score >= 0.66 ? 4 : score >= 0.46 ? 3 : score >= 0.28 ? 2 : 1);

/**
 * Settle a finished ride.
 * ride = { kind, fareNow, mood, avgMood, timeLimit (null unless a rusher), timeLeft (seconds; negative when late) }
 * -> { fare, tip, stars, late }
 */
export function settleRide(ride) {
  const k = KINDS[ride.kind] || KINDS.regular;
  const rush = ride.timeLimit != null && ride.timeLeft != null;
  const late = rush && ride.timeLeft < 0;
  let score = 0.6 * ride.mood + 0.4 * (ride.avgMood ?? ride.mood);
  if (rush) {
    if (late) score -= 0.12 + clamp(-ride.timeLeft / 40, 0, 1) * 0.4;
    else score += 0.1 * clamp(ride.timeLeft / ride.timeLimit, 0, 1);
  }
  score = clamp(score, 0, 1);
  const stars = starsFromScore(score);
  let fare = ride.fareNow;
  if (late) fare = Math.round(fare * 0.65);
  let tipFrac = k.tip * ({ 5: 1, 4: 0.55, 3: 0.2 }[stars] || 0);
  if (rush) tipFrac = late || stars < 3 ? 0 : k.tip * clamp((ride.timeLeft / ride.timeLimit) * 2.2, 0, 1);
  const tip = Math.round(fare * tipFrac);
  return { fare, tip, stars, late, score };
}
