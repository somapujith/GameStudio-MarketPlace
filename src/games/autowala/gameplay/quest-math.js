// OWNER: quests agent. Pure geometry and small helpers for the mission system: polylines (cumulative length, projection, point at
// distance), a daily seed, the reputation ladder. No three.js, no DOM. Unit tested in quest-engine.test.js / quest-defs.test.js.
import { hashString, makeRng } from '../game/rng.js';

const hyp = Math.hypot;

/** A path with its cumulative lengths: { points:[{x,z}], cum:Float64Array, length }. */
export function makePath(points) {
  const pts = points.map((p) => ({ x: p.x, z: p.z }));
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + hyp(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return { points: pts, cum, length: pts.length ? cum[pts.length - 1] : 0 };
}

/** Point `s` metres along the path (clamped), plus the unit tangent there and the heading (0 faces +z). Writes into `out`. */
export function pathAt(path, s, out = { x: 0, z: 0, tx: 0, tz: 1, heading: 0 }) {
  const { points: p, cum } = path;
  const n = p.length;
  if (!n) return out;
  if (n === 1) {
    out.x = p[0].x;
    out.z = p[0].z;
    return out;
  }
  const d = Math.max(0, Math.min(path.length, s));
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const segLen = cum[lo + 1] - cum[lo] || 1;
  const t = (d - cum[lo]) / segLen;
  out.x = p[lo].x + (p[lo + 1].x - p[lo].x) * t;
  out.z = p[lo].z + (p[lo + 1].z - p[lo].z) * t;
  out.tx = (p[lo + 1].x - p[lo].x) / segLen;
  out.tz = (p[lo + 1].z - p[lo].z) / segLen;
  out.heading = Math.atan2(out.tx, out.tz);
  return out;
}

/** Nearest point of the path to (x, z): { s (metres along), d (distance to the path) }. Optional window [sLo, sHi] to search. */
export function projectOnPath(path, x, z, sLo = 0, sHi = Infinity, out = { s: 0, d: Infinity }) {
  const { points: p, cum } = path;
  out.s = 0;
  out.d = Infinity;
  for (let i = 0; i < p.length - 1; i++) {
    if (cum[i + 1] < sLo) continue;
    if (cum[i] > sHi) break;
    const ax = p[i].x;
    const az = p[i].z;
    const dx = p[i + 1].x - ax;
    const dz = p[i + 1].z - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const d = hyp(x - (ax + dx * t), z - (az + dz * t));
    if (d < out.d) {
      out.d = d;
      out.s = cum[i] + Math.sqrt(len2) * t;
    }
  }
  return out;
}

/** `count` points at the given fractions of the path (default evenly, never the very start). Each is { x, z, s }. */
export function waypointsAlong(path, count, { from = 0.1, to = 1 } = {}) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const f = count === 1 ? to : from + ((to - from) * i) / (count - 1);
    const pt = pathAt(path, path.length * f);
    out.push({ x: pt.x, z: pt.z, s: path.length * f });
  }
  return out;
}

/** Local calendar date as "YYYY-MM-DD" (the daily job rolls over at midnight). */
export function dateKey(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/** The same date always picks the same item (and the same rng seed for it), on every device. */
export function dailyPick(key, ids) {
  if (!ids.length) return null;
  return ids[hashString(`autowala-daily-${key}`) % ids.length];
}
export const dailyRng = (key) => makeRng(hashString(`autowala-daily-roll-${key}`));

/** Reputation ladder: [min points, title, Telugu]. */
export const LADDER = [
  [0, 'Naya Driver', 'కొత్త డ్రైవర్'],
  [120, 'Local Pro', 'లోకల్ ప్రో'],
  [360, 'Gali Star', 'గల్లీ స్టార్'],
  [800, 'City Legend', 'సిటీ లెజెండ్'],
  [1600, 'Hero Mama', 'హీరో మామ'],
];

/** { index, title, te, next (points of the next rung, or null), floor } for a reputation total. */
export function rankFor(rep) {
  const r = Math.max(0, Number(rep) || 0);
  let i = 0;
  for (let k = 0; k < LADDER.length; k++) if (r >= LADDER[k][0]) i = k;
  return { index: i, title: LADDER[i][1], te: LADDER[i][2], floor: LADDER[i][0], next: LADDER[i + 1] ? LADDER[i + 1][0] : null };
}

export const fmtClock = (s) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
