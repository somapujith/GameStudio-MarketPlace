// OWNER: metro agent. Turns straight runs along the roads into a smooth track: straight pieces joined by circular fillets at the
// corners, sampled densely (position, tangent, road width, height). Pure. Also: point-at-distance lookups for trains and stations.
import { runWidth } from './metro-graph.js';

export const TRACK = {
  radius: 30, // corner fillet radius (m), reduced on short runs
  straightStep: 12, // max sample spacing on straights
  arcStep: 3.2, // sample spacing on arcs
};

/**
 * Build the track of a route.
 * @param runs from stepsToRuns
 * @returns {{ samples: Array, length: number, corners: Array, runs: Array }}
 *   sample = { x, z, tx, tz, s, w (road width), arc (bool), run (index), y (0 until a height profile is applied) }
 */
export function buildTrack(runs, opts = {}) {
  const R = opts.radius ?? TRACK.radius;
  const step = opts.straightStep ?? TRACK.straightStep;
  const arcStep = opts.arcStep ?? TRACK.arcStep;
  const n = runs.length;
  // corner i sits between run i and run i+1
  const corners = [];
  for (let i = 0; i < n - 1; i++) {
    const a = runs[i];
    const b = runs[i + 1];
    const cross = a.dx * b.dz - a.dz * b.dx;
    const dot = a.dx * b.dx + a.dz * b.dz;
    const theta = Math.atan2(Math.abs(cross), dot);
    const perp = { x: -a.dz, z: a.dx };
    const sgn = b.dx * perp.x + b.dz * perp.z >= 0 ? 1 : -1;
    const tDesired = R * Math.tan(theta / 2);
    const tCap = 0.45 * Math.min(a.len, b.len);
    const t = Math.min(tDesired, tCap);
    const re = theta > 1e-4 ? t / Math.tan(theta / 2) : 0;
    corners.push({ x: a.bx, z: a.bz, theta, sgn, t, re, nx: perp.x * sgn, nz: perp.z * sgn, s: 0 });
  }
  const samples = [];
  let s = 0;
  const push = (x, z, tx, tz, w, arc, run) => {
    const prev = samples[samples.length - 1];
    if (prev) s += Math.hypot(x - prev.x, z - prev.z);
    samples.push({ x, z, tx, tz, s, w, arc, run, y: 0 });
  };
  for (let i = 0; i < n; i++) {
    const r = runs[i];
    const t0 = i === 0 ? 0 : corners[i - 1].t;
    const t1 = i === n - 1 ? 0 : corners[i].t;
    const L = Math.max(0, r.len - t0 - t1);
    const K = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k <= K; k++) {
      const sr = t0 + (L * k) / K;
      if (i > 0 && k === 0 && samples.length && corners[i - 1].re === 0) {
        // no fillet (straight continuation): the corner point was already emitted as the last sample of the previous run
      }
      push(r.ax + r.dx * sr, r.az + r.dz * sr, r.dx, r.dz, runWidth(r, sr), false, i);
    }
    if (i < n - 1) {
      const c = corners[i];
      c.s = s;
      if (c.re > 0) {
        const px = r.ax + r.dx * (r.len - c.t);
        const pz = r.az + r.dz * (r.len - c.t);
        const arcLen = c.re * c.theta;
        const KA = Math.max(2, Math.ceil(arcLen / arcStep), Math.ceil(c.theta / 0.17)); // <= ~10 degrees per sample
        const w = Math.min(runWidth(r, r.len), runWidth(runs[i + 1], 0));
        for (let k = 1; k < KA; k++) {
          const phi = (c.theta * k) / KA;
          const sp = Math.sin(phi);
          const cp = Math.cos(phi);
          push(
            px + c.re * (sp * r.dx + (1 - cp) * c.nx),
            pz + c.re * (sp * r.dz + (1 - cp) * c.nz),
            r.dx * cp + c.nx * sp,
            r.dz * cp + c.nz * sp,
            w,
            true,
            i,
          );
        }
      }
    }
  }
  return { samples, length: s, corners, runs };
}

/** Index i such that samples[i].s <= d <= samples[i+1].s (binary search). */
export function sampleIndex(samples, d) {
  let lo = 0;
  let hi = samples.length - 2;
  if (d <= samples[0].s) return 0;
  if (d >= samples[samples.length - 1].s) return samples.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].s <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Pose on the centre line at distance `d` along the track, written into `out` (no allocation):
 * { x, y, z, tx, tz (unit tangent), pitch (rad, up positive), w }.
 */
export function pointAt(track, d, out = {}) {
  const sm = track.samples;
  const i = sampleIndex(sm, d);
  const a = sm[i];
  const b = sm[i + 1];
  const span = b.s - a.s || 1;
  const f = Math.max(0, Math.min(1, (d - a.s) / span));
  out.x = a.x + (b.x - a.x) * f;
  out.z = a.z + (b.z - a.z) * f;
  out.y = a.y + (b.y - a.y) * f;
  let tx = a.tx + (b.tx - a.tx) * f;
  let tz = a.tz + (b.tz - a.tz) * f;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  out.tx = tx;
  out.tz = tz;
  out.pitch = Math.atan2(b.y - a.y, span);
  out.w = a.w;
  return out;
}

/** Heights: apply a function (s, sample) -> y to every sample. */
export function applyHeights(track, fn) {
  for (const sm of track.samples) sm.y = fn(sm.s, sm);
}

/** Smoothstep ramp between two values over [s0, s1]. */
export const smooth = (t) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** Distance of the closest sample of `track` to a point: { d, s, i } (samples are <= 12 m apart, so this is within ~1 m). */
export function nearestOnTrack(track, x, z) {
  let best = { d: Infinity, s: 0, i: 0 };
  const sm = track.samples;
  for (let i = 0; i < sm.length - 1; i++) {
    const a = sm[i];
    const b = sm[i + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const l2 = vx * vx + vz * vz || 1;
    const f = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
    const d = Math.hypot(x - (a.x + vx * f), z - (a.z + vz * f));
    if (d < best.d) best = { d, s: a.s + (b.s - a.s) * f, i };
  }
  return best;
}
