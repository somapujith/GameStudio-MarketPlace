// OWNER: minimap agent. Pure helpers for the route guide: trimming the passed part of a route, remaining length, ETA, target identity.
const hyp = Math.hypot;

/** Average speed the ETA assumes (m/s): city traffic, stops and turns included. */
export const AVG_SPEED = 11;

/** Seconds to cover `metres` at the assumed average speed. */
export const etaFor = (metres) => Math.max(0, metres) / AVG_SPEED;

/** Remaining length of a polyline (m). */
export function pathLength(points) {
  let len = 0;
  for (let i = 1; i < (points?.length || 0); i++) len += hyp(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return len;
}

/**
 * Cut the part of the route the player has already driven. Works IN PLACE (no allocation per frame): the vertices before the
 * nearest segment are dropped and the first vertex is moved onto the player's projection on the route.
 * Only the first `window` segments are searched, so a parallel street further along can not steal the player.
 * Returns { off, index, t }: `off` = distance from the player to the route (m), `index` = how many vertices were dropped.
 */
export function trimRoute(points, x, z, window = 14) {
  const n = points?.length || 0;
  if (n < 2) return { off: n ? hyp(x - points[0].x, z - points[0].z) : Infinity, index: 0, t: 0 };
  const lim = Math.min(n - 1, window);
  let bestI = 0;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i < lim; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
    const d = hyp(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < bestD - 1e-9) {
      bestD = d;
      bestI = i;
      bestT = t;
    }
  }
  if (bestI > 0) points.splice(0, bestI);
  const a = points[0];
  const b = points[1];
  if (bestT > 0) {
    a.x += (b.x - a.x) * bestT;
    a.z += (b.z - a.z) * bestT;
  }
  return { off: bestD, index: bestI, t: bestT };
}

/** A key that changes when the target changes (another customer, pick-up -> drop-off, or the point moved more than ~2 m). */
export function targetKey(t) {
  if (!t) return '';
  return `${t.type || ''}:${t.id ?? ''}:${Math.round((t.x || 0) / 2)},${Math.round((t.z || 0) / 2)}`;
}

/** Copy the vertices of `src` into new {x,z} objects, with the player's own position in front when they are well off the road. */
export function withStubs(src, from, to, { startGap = 3, endGap = 3, endMax = 25 } = {}) {
  if (!src.length) return src;
  const out = src.slice();
  const first = out[0];
  if (from && hyp(from.x - first.x, from.z - first.z) > startGap) out.unshift({ x: from.x, z: from.z });
  const last = out[out.length - 1];
  if (to) {
    const d = hyp(to.x - last.x, to.z - last.z);
    if (d > endGap && d <= endMax) out.push({ x: to.x, z: to.z });
  }
  return out;
}
