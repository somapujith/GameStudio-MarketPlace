// Shared rides: a bounded special case. While one passenger is riding, a second single passenger waiting near the route may be
// taken along if the first agrees. Both pay a discounted rate while the auto carries two; the first one minds the detour.
// Pure geometry + odds; the runtime (boarding, seats, markers) lives in fares.js.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const SHARE = {
  discount: 0.25, // each rider pays this much less per metre driven while the auto holds two
  fixedDiscount: 0.1, // a fixed price drops by this when it was shared
  minLeft: 300, // metres the first rider still has to go for sharing to be offered
  minElapsed: 5, // seconds into the ride
  band: 90, // the second customer stands within this many metres of the straight line to the first one's drop-off
  reach: 170, // ... and within this many metres of the auto when offered
  minCos: 0.45, // their destinations point the same way (cosine of the angle between the two journeys)
  maxExtra: 520, // refuse a pick-up that adds more than this many metres to the first rider's journey (straight lines)
  spawnChance: 0.5, // odds that a rider who agrees gets a dedicated sharer waiting along the way
  moodDrain: 0.004, // per second, the first rider's mood loss while sharing (crowded), scaled by their sensitivity
};

/** How readily each kind agrees to share (0..1). Rushers never. */
export const SHARE_ODDS = { regular: 0.6, student: 0.8, tourist: 0.5, women: 0.35, elder: 0.3, rusher: 0 };
/** How much each kind minds a detour (multiplies the mood hit). */
export const SHARE_SENS = { regular: 1, student: 0.5, tourist: 0.8, women: 1.2, elder: 1.3, rusher: 2 };

export const shareAgrees = (kind, roll) => roll < (SHARE_ODDS[kind] ?? 0.4);

/** The distance from (px,pz) to the segment a-b, and where along it (0..1). */
export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return { d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t };
}

/** Is sharing even on the table? rider = { pax, urgent, kind, shared }, s = { distLeft, elapsed, agreed }. */
export function canOfferShare(rider, s) {
  return !!s.agreed && !rider.shared && rider.pax === 1 && !rider.urgent && rider.kind !== 'rusher' && s.distLeft >= SHARE.minLeft && s.elapsed >= SHARE.minElapsed;
}

/** Extra straight-line metres the first rider rides if the auto fetches `c` on the way: |auto->c| + |c->drop| - |auto->drop|. */
export const detourExtra = (auto, c, drop) =>
  Math.max(0, Math.hypot(c.x - auto.x, c.z - auto.z) + Math.hypot(drop.x - c.x, drop.z - c.z) - Math.hypot(drop.x - auto.x, drop.z - auto.z));

/**
 * Does customer `c` ({ x, z, pax, kind, urgent, dest:{x,z} }) fit the current ride? auto, drop = first rider's destination.
 * -> { ok, off (metres off the route), cos, extra }
 */
export function candidateFit(auto, drop, c, reach = SHARE.reach) {
  const { d: off } = distToSegment(c.x, c.z, auto.x, auto.z, drop.x, drop.z);
  const ax = drop.x - auto.x;
  const az = drop.z - auto.z;
  const bx = c.dest.x - c.x;
  const bz = c.dest.z - c.z;
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  const cos = la > 0 && lb > 0 ? (ax * bx + az * bz) / (la * lb) : 0;
  const extra = detourExtra(auto, c, drop);
  const ok = c.pax === 1 && !c.urgent && c.kind !== 'rusher' && off <= SHARE.band && cos >= SHARE.minCos && extra <= SHARE.maxExtra && Math.hypot(c.x - auto.x, c.z - auto.z) <= reach;
  return { ok, off, cos, extra };
}

/** Mood the first rider loses when the auto fetches a second passenger (0..0.25), from the extra metres and their temper. */
export const detourMoodHit = (kind, extra) => clamp((extra / 500) * 0.2 * (SHARE_SENS[kind] ?? 1), 0, 0.25);

/** The distance a rider pays for: metres driven since boarding minus the discount for the metres shared. */
export const effectiveDriven = (driven, drivenAt, sharedM) => Math.max(0, driven - drivenAt - SHARE.discount * Math.max(0, sharedM));

/** A fixed price after a shared ride. */
export const sharedFixedFare = (fixed, sharedM) => (sharedM > 20 ? Math.round(fixed * (1 - SHARE.fixedDiscount)) : fixed);

/** A point `f` (0..1) of the way from a to b. */
export const along = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
