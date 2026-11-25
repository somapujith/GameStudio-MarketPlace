// Where the rules live in the city, chosen from the road graph (pure, deterministic per seed): speed cameras on fast roads, school
// zones on quiet streets, night checkpoints on mid-size roads. Everything stands ON a road (the cameras and checkpoints are
// timed things the player must be able to reach without climbing a kerb at speed). Poles, signs and cops stand on the pavement beside.
import { makeRng } from '../game/rng.js';
import { districtAt } from '../world/layout.js';
import { RULES, edgeLimit } from './rule-logic.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** A point on edge `e` at `s` metres from its start, `lat` metres to the left of the direction of travel `dir` (+1 a->b, -1 b->a). */
export function edgePoint(city, e, s, lat = 0, dir = 1) {
  const a = city.nodes[e.a];
  const tx = e.dx * dir;
  const tz = e.dz * dir;
  return { x: a.x + e.dx * s + tz * lat, z: a.z + e.dz * s - tx * lat, tx, tz, yaw: Math.atan2(-tx, -tz) };
}

function greedy(cands, taken, count, spacing, rnd, minGap = 90) {
  const out = [];
  // a deterministic shuffle so equal candidates do not always win in map order
  const list = cands.map((c) => ({ c, k: rnd() })).sort((a, b) => a.k - b.k).map((o) => o.c);
  for (const c of list) {
    if (out.length >= count) break;
    if (out.some((o) => dist(o, c) < spacing)) continue;
    if (taken.some((o) => dist(o, c) < minGap)) continue;
    out.push(c);
  }
  return out;
}

/**
 * @param city the road graph
 * @param signalNodes [{x, z}] signalled junctions (sites keep clear of them)
 */
export function planRuleSites(city, signalNodes = []) {
  const rnd = makeRng(((city.seed || 1) * 7919 + 11) >>> 0);
  const awayFromSignals = (x, z, d) => signalNodes.every((n) => Math.hypot(n.x - x, n.z - z) > d);
  const mid = (e) => {
    const a = city.nodes[e.a];
    return { x: a.x + e.dx * e.len * 0.5, z: a.z + e.dz * e.len * 0.5 };
  };

  // ---- speed cameras
  const taken = [];
  const camEdges = (pred) => city.edges
    .filter(pred)
    .map((e) => ({ e, ...mid(e) }))
    .filter((c) => awayFromSignals(c.x, c.z, 45));
  const picks = [
    ...greedy(camEdges((e) => /necklace/i.test(e.name || '') && e.len >= 18), taken, 3, 300, rnd),
  ];
  taken.push(...picks);
  const ring = greedy(camEdges((e) => /outer ring/i.test(e.name || '') && e.len >= 50), taken, 3, 420, rnd);
  taken.push(...ring);
  const avenues = greedy(camEdges((e) => e.w >= 16 && !/ring|necklace/i.test(e.name || '') && e.len >= 50), taken, 4, 260, rnd);
  taken.push(...avenues);
  const town = greedy(camEdges((e) => e.w < 16 && e.w >= 10 && e.len >= 50 && !/necklace/i.test(e.name || '')), taken, 3, 320, rnd);
  const cameras = [...picks, ...ring, ...avenues, ...town].map((c, i) => {
    const e = c.e;
    const lim = edgeLimit(e);
    return { id: i, edgeId: e.id, x: c.x, z: c.z, dx: e.dx, dz: e.dz, w: e.w, limit: lim.limit, zone: lim.zone, name: e.name || '' };
  });

  // ---- school zones: quiet streets in the residential districts
  const quiet = new Set(['banjara', 'mehdi', 'secbad', 'old', 'suburb']);
  const schoolCands = city.edges
    .filter((e) => e.w <= 12 && e.len >= 70 && quiet.has(districtAt(mid(e).x, mid(e).z).id))
    .map((e) => ({ e, ...mid(e) }))
    .filter((c) => awayFromSignals(c.x, c.z, 70) && cameras.every((cam) => dist(cam, c) > 120));
  const schoolPicks = greedy(schoolCands, [], 5, 240, rnd, 0);
  const schools = schoolPicks.map((c, i) => ({
    id: i, edgeId: c.e.id, x: c.x, z: c.z, r: 42, dx: c.e.dx, dz: c.e.dz, w: c.e.w, limit: RULES.limits.school,
    len: c.e.len,
  }));

  // ---- night checkpoints
  const cpCands = city.edges
    .filter((e) => e.w >= 10 && e.w <= 15 && e.len >= 80 && !/necklace|outer ring/i.test(e.name || ''))
    .map((e) => ({ e, ...mid(e) }))
    .filter((c) => awayFromSignals(c.x, c.z, 70)
      && cameras.every((cam) => dist(cam, c) > 100)
      && schools.every((s) => dist(s, c) > 110));
  const cpPicks = greedy(cpCands, [], 4, 380, rnd, 0);
  const checkpoints = cpPicks.map((c, i) => ({
    id: i, edgeId: c.e.id, x: c.x, z: c.z, dx: c.e.dx, dz: c.e.dz, w: c.e.w, len: c.e.len,
  }));

  return { cameras, schools, checkpoints };
}
