// Car following for traffic: the Intelligent Driver Model plus a hard safety net, and the speed a vehicle may carry towards a
// slower stretch ahead (a corner, a stop line). Pure maths, unit-tested.

export const FOLLOW = { T: 1.15, s0: 2.2, minGap: 0.8, bMax: 9, delta: 4 };

/** IDM acceleration. `gap` is bumper to bumper (Infinity = free road), `vLead` the leader's speed. */
export function idmAccel(v, v0, gap, vLead, a, b, p = FOLLOW) {
  const free = 1 - (v / Math.max(v0, 0.1)) ** p.delta;
  if (!(gap < 1e6)) return a * free;
  const dv = v - vLead;
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(a * b)));
  const g = Math.max(gap, 0.05);
  return a * (free - (sStar / g) ** 2);
}

/** Highest speed from which we can still stop short of a leader that brakes as hard as we can (never below 0). */
export function safeSpeed(gap, vLead, minGap = FOLLOW.minGap, bMax = FOLLOW.bMax) {
  const room = gap - minGap;
  if (room <= 0) return Math.min(vLead, 0);
  return Math.sqrt(vLead * vLead + 2 * bMax * room);
}

/** Speed we may have now to be down to `cap` after `dist` more metres at deceleration b. */
export function approachSpeed(cap, dist, b) {
  if (!(cap < 1e6)) return Infinity;
  return Math.sqrt(cap * cap + 2 * b * Math.max(0, dist));
}

/**
 * New speed after dt seconds for a follower (allocation free). The safety net keeps a bumper-to-bumper gap of at least
 * p.minGap: the speed is cut so that the advance this step never exceeds the room left.
 */
export function followSpeed(v, dt, v0, gap, vLead, a, b, p = FOLLOW) {
  let acc = idmAccel(v, v0, gap, vLead, a, b, p);
  acc = Math.max(-p.bMax, Math.min(a, acc));
  let nv = Math.max(0, v + acc * dt);
  if (gap < 1e6) {
    nv = Math.min(nv, Math.max(0, safeSpeed(gap, vLead, p.minGap, p.bMax)));
    const room = Math.max(0, gap - p.minGap);
    if (nv * dt > room) nv = room / dt;
  }
  return nv;
}
