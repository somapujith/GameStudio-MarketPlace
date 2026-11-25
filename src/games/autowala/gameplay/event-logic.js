// Pure maths of the city events (no three.js): which events run on which day, the baraat's route, formation and effect on traffic and
// on the player, match-night crowd phases and kite fields. gameplay/events.js and event-*.js wire these to meshes; all tested.
import { makeRng } from '../game/rng.js';

export const EVENT_INFO = {
  baraat: { id: 'baraat', name: 'Baraat', te: 'బారాత్' },
  match: { id: 'match', name: 'Match night', te: 'మ్యాచ్ నైట్' },
  kites: { id: 'kites', name: 'Kite day', te: 'గాలిపటాల రోజు' },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/**
 * The events of one game day: [{ id, start, end }] in hours, sorted by start. Deterministic in (day, seed).
 * Day 1 has a baraat at dusk and a match night, day 2 kites: the player meets all three in the first two days.
 */
export function eventsForDay(day, seed = 1) {
  const rng = makeRng(((seed >>> 0) * 2246822519) ^ (day * 3266489917) ^ 0xe7e47);
  const out = [];
  const baraat = day === 1 ? { start: 18.9, len: 2.0 } : rng.chance(0.62) ? { start: rng.range(18.2, 21.0), len: rng.range(1.8, 2.4) } : null;
  const match = day === 1 || day % 3 === 1 || rng.chance(0.2);
  const kites = day === 2 || (day > 2 && rng.chance(0.45));
  if (kites) out.push({ id: 'kites', start: 9.6, end: 17.3 });
  if (match) out.push({ id: 'match', start: 17.0, end: 23.0 });
  if (baraat) out.push({ id: 'baraat', start: baraat.start, end: baraat.start + baraat.len });
  return out.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/** Events that should be running at `hour`. */
export const activeAt = (list, hour) => list.filter((e) => hour >= e.start && hour < e.end);

// ------------------------------------------------------------------------------------------------ match night
/** Crowd 0..1 at the stadium gate and the extra traffic factor: arrival 17-19, the match 19-21.8, the exodus 21.8-23. */
export function matchPhase(hour) {
  const arrive = smooth((hour - 17) / 2);
  const leave = smooth((hour - 21.8) / 1.0);
  const exodus = leave * (1 - smooth((hour - 22.6) / 0.4));
  const crowd = arrive * (1 - 0.35 * leave);
  return { crowd, exodus, trafficMul: 1 + 0.18 * arrive + 0.22 * exodus, pedMul: 1 + 0.2 * crowd };
}

// ------------------------------------------------------------------------------------------------ kites
/** Share of the kite field in the sky: they go up over the first hour, come down at the end. */
export const kiteFraction = (hour, start = 9.6, end = 17.3) => smooth((hour - start) / 1.0) * (1 - smooth((hour - (end - 1.1)) / 1.0));

/** Wrap a world offset into [-size/2, size/2): the kite field repeats around the player so it never runs out. */
export const wrapDelta = (d, size) => d - Math.floor(d / size + 0.5) * size;

/** A kite's seed data (deterministic): position in a `size` m square, height, colour index, phase, speed. */
export function kiteField(n, size = 360, seed = 7) {
  const rng = makeRng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: (rng() - 0.5) * size, z: (rng() - 0.5) * size, y: rng.range(22, 64), color: rng.int(0, 5),
      phase: rng() * Math.PI * 2, drift: rng.range(0.5, 1.6), scale: rng.range(3.4, 6), after: rng(), // `after` staggers the lift-off
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ baraat
/** The formation, in metres in the procession's frame: u along the way it walks, w to the LEFT of that way. Centre = middle of the crowd. */
export function baraatFormation() {
  const people = [];
  const rng = makeRng(0xba2a47);
  // the groom on his horse, in the middle
  people.push({ role: 'groom', u: 2, w: 0, y: 1.25 });
  // dancers all round him: a lively mass, pushed out so they do not stand inside the horse
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const r = rng.range(2.4, 3.9);
    people.push({ role: 'dancer', u: 2 + Math.cos(a) * r * 1.5, w: Math.sin(a) * r * 0.9, y: 0 });
  }
  // lamp carriers (the women and children carrying the glowing lamps on their heads) lead the way
  for (const u of [8, 10.5, 13]) for (const w of [-2.3, 2.3]) people.push({ role: 'lamp', u, w, y: 0 });
  // the band follows: two rows, a big dhol drum in the middle
  for (const u of [-6.5, -8.5, -10.5, -12.5]) for (const w of [-1.4, 1.4]) people.push({ role: 'band', u, w, y: 0 });
  return { people, cart: { u: -16, w: 0 }, horse: { u: 2, w: 0 }, tail: 18, head: 15 };
}

/** Roads a procession could use: long, not the ring, wide enough for a lane to be left, near `at` (but not on top of it). */
export function baraatCandidates(city, at, { minLen = 95, minW = 12, minDist = 90, maxDist = 420 } = {}) {
  const out = [];
  for (const e of city.edges) {
    if (e.len < minLen || e.w < minW || e.w > 21) continue;
    const a = city.nodes[e.a];
    const b = city.nodes[e.b];
    if (Math.max(Math.abs(a.x), Math.abs(a.z), Math.abs(b.x), Math.abs(b.z)) > 560) continue; // not the outer ring
    const d = Math.hypot((a.x + b.x) / 2 - at.x, (a.z + b.z) / 2 - at.z);
    if (d >= minDist && d <= maxDist) out.push({ e, d });
  }
  return out;
}

/** Choose the route of a procession: a stretch of one edge and a direction. `rnd` is a function returning 0..1. Null if the city has none. */
export function pickBaraatRoute(city, at, rnd, length = 140) {
  let c = baraatCandidates(city, at);
  if (!c.length) c = baraatCandidates(city, at, { minLen: 70, minW: 9, minDist: 40, maxDist: 600 });
  if (!c.length) {
    c = baraatCandidates(city, at, { minLen: 60, minW: 8, minDist: 0, maxDist: 1500 });
    c.sort((p, q) => p.d - q.d);
    c = c.slice(0, 6); // nothing near: the closest few
  }
  if (!c.length) return null;
  c.sort((p, q) => p.e.id - q.e.id); // a stable order, so the same random number picks the same road
  const e = c[Math.floor(rnd() * c.length)].e;
  const a = city.nodes[e.a];
  const run = Math.min(length, e.len - 24);
  const from = 12 + rnd() * (e.len - 24 - run);
  const dir = rnd() < 0.5 ? 1 : -1;
  const t0 = dir > 0 ? from : from + run;
  const t1 = dir > 0 ? from + run : from;
  return {
    edge: e.id, name: e.name, w: e.w, dx: e.dx * dir, dz: e.dz * dir, length: run,
    x0: a.x + e.dx * t0, z0: a.z + e.dz * t0, x1: a.x + e.dx * t1, z1: a.z + e.dz * t1,
  };
}

/** Where the procession's centre is after `elapsed` seconds at `speed` m/s along `route`, in the left lane. */
export function baraatPose(route, speed, elapsed, out = {}) {
  const s = Math.max(0, Math.min(route.length, speed * elapsed));
  const lx = route.dz;
  const lz = -route.dx; // left of the walking direction (heading 0 faces +z and its left is +x: left = (dz, -dx))
  const off = route.w * 0.22;
  out.x = route.x0 + route.dx * s + lx * off;
  out.z = route.z0 + route.dz * s + lz * off;
  out.s = s;
  out.done = s >= route.length;
  return out;
}

/**
 * Speed limit (m/s) a traffic vehicle should respect near the procession, or Infinity when it is not affected.
 * `v` = { x, z, fx, fz } (position and unit heading); `b` = { x, z, dx, dz (unit walking dir), speed, tail, head }.
 * Behind it and going the same way: crawl at its pace and never closer than the band. Coming the other way: pass at a walking pace.
 */
export function trafficCap(v, b) {
  const rx = b.x - v.x;
  const rz = b.z - v.z;
  const along = rx * v.fx + rz * v.fz; // metres ahead of the vehicle (negative = behind it)
  const lateral = Math.abs(-rx * v.fz + rz * v.fx);
  if (lateral > 10 || along > 60) return Infinity;
  const same = v.fx * b.dx + v.fz * b.dz;
  if (same > 0.35) {
    if (along < -b.head) return Infinity; // already past the head of the procession
    const gap = along - b.tail; // metres to the last musician
    if (gap < -3) return 0;
    return b.speed * 0.9 + 8 * clamp01(gap / 24);
  }
  if (same < -0.35) {
    if (along < -b.tail) return Infinity; // passed it
    return 2.6 + 9 * clamp01((along - b.head) / 28);
  }
  if (lateral < 12 && Math.abs(along) < 14) return 3; // crossing traffic near the crowd
  return Infinity;
}

/** 0..1 how deep in the crowd the player is (they slow down to a crawl, nobody drives through a baraat at speed). */
export function crowdDrag(px, pz, b) {
  const rx = px - b.x;
  const rz = pz - b.z;
  const u = rx * b.dx + rz * b.dz;
  const w = Math.abs(-rx * b.dz + rz * b.dx);
  const du = u < -b.tail ? -b.tail - u : u > b.head ? u - b.head : 0;
  const dw = Math.max(0, w - 3.5);
  return clamp01(1 - Math.hypot(du, dw) / 5); // 1 inside the crowd's footprint, fading to 0 five metres outside it
}
