// OWNER: metro agent. Train timetable maths (pure): trains shuttle end to end on a line, forward on one track and back on the other,
// stopping at every station for a dwell with eased acceleration. Position is a closed-form function of time, so there is no state
// to drift (fast-forwarding the clock, pausing and resuming all just work).

export const TRAIN = {
  cruise: 16, // m/s
  accel: 1.15, // m/s^2 (also the braking rate)
  dwell: 12, // s at a station
  terminalDwell: 20, // s at the ends
  cars: 3,
  carLen: 19.6,
  carGap: 0.6,
  lane: 2.05, // lateral offset of a track from the viaduct centre line
};

export const trainLength = (cars = TRAIN.cars) => cars * TRAIN.carLen + (cars - 1) * TRAIN.carGap;

/** Time to cover `d` metres from rest to rest with the trapezoid profile (accel to cruise, cruise, brake). */
export function legTime(d, cruise = TRAIN.cruise, a = TRAIN.accel) {
  const dAcc = (cruise * cruise) / a; // accel + brake distance
  if (d >= dAcc) return d / cruise + cruise / a;
  return 2 * Math.sqrt(d / a);
}

/** Distance covered after `t` seconds of a leg of length `d` (0 <= t <= legTime). Returns { x, v }. */
export function legPos(d, t, cruise = TRAIN.cruise, a = TRAIN.accel) {
  const T = legTime(d, cruise, a);
  if (t <= 0) return { x: 0, v: 0 };
  if (t >= T) return { x: d, v: 0 };
  const dAcc = (cruise * cruise) / a;
  if (d >= dAcc) {
    const ta = cruise / a;
    if (t < ta) return { x: 0.5 * a * t * t, v: a * t };
    const tc = d / cruise - cruise / a; // cruise time
    if (t < ta + tc) return { x: 0.5 * cruise * ta + cruise * (t - ta), v: cruise };
    const tb = T - t; // time left
    return { x: d - 0.5 * a * tb * tb, v: a * tb };
  }
  const half = T / 2;
  if (t < half) return { x: 0.5 * a * t * t, v: a * t };
  const tb = T - t;
  return { x: d - 0.5 * a * tb * tb, v: a * tb };
}

/**
 * Build the timetable of one line from its stop positions (distances along the track, ascending).
 * The cycle visits stops 0..n-1 on the forward track, then n-1..0 on the backward track.
 * @returns {{ stops, legs, cycle, events }}
 */
export function buildSchedule(stopS, opts = {}) {
  const dwell = opts.dwell ?? TRAIN.dwell;
  const tdwell = opts.terminalDwell ?? TRAIN.terminalDwell;
  const n = stopS.length;
  const events = []; // sequential: dwell at stop (dir, index) then leg to next
  let t = 0;
  for (let half = 0; half < 2; half++) {
    for (let k = 0; k < n; k++) {
      const idx = half === 0 ? k : n - 1 - k;
      const terminal = k === 0 || k === n - 1;
      const dw = terminal ? tdwell : dwell;
      const ev = { dir: half === 0 ? 1 : -1, lane: half, stop: idx, s: stopS[idx], t0: t, dwell: dw, t1: t + dw, leg: 0, legT: 0, next: -1 };
      t += dw;
      if (k < n - 1) {
        const nidx = half === 0 ? idx + 1 : idx - 1;
        ev.leg = Math.abs(stopS[nidx] - stopS[idx]);
        ev.legT = legTime(ev.leg);
        ev.next = nidx;
        ev.t2 = t + ev.legT;
        t += ev.legT;
      } else ev.t2 = ev.t1;
      events.push(ev);
    }
  }
  return { stops: stopS, events, cycle: t };
}

/**
 * State of a train at time `time` (seconds), with phase offset `phase` (seconds) into the cycle.
 * Writes into `out` (no allocation): { s (distance of the train centre), dir (+1 forward track / -1 backward), lane (0|1),
 * v (speed, m/s), dwelling (0..1: doors open amount), stop (index while dwelling, else -1) }.
 */
export function trainState(sched, time, phase = 0, out = {}) {
  const T = sched.cycle;
  let t = (time + phase) % T;
  if (t < 0) t += T;
  const ev = sched.events;
  // binary search the event whose [t0, t2) contains t
  let lo = 0;
  let hi = ev.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ev[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  const e = ev[lo];
  out.dir = e.dir;
  out.lane = e.lane;
  if (t < e.t1) {
    out.s = e.s;
    out.v = 0;
    out.stop = e.stop;
    const into = t - e.t0;
    const left = e.t1 - t;
    out.dwelling = Math.max(0, Math.min(1, Math.min(into - 1.5, left - 1.5) / 1.2));
    return out;
  }
  const p = legPos(e.leg, t - e.t1);
  out.s = e.s + e.dir * p.x;
  out.v = p.v;
  out.stop = -1;
  out.dwelling = 0;
  return out;
}

/** Centre distances of the cars of a train whose centre is at `s` heading `dir` (front car first). */
export function carOffsets(cars = TRAIN.cars) {
  const pitch = TRAIN.carLen + TRAIN.carGap;
  const out = [];
  for (let k = 0; k < cars; k++) out.push((((cars - 1) / 2) - k) * pitch); // + ahead of centre
  return out;
}
