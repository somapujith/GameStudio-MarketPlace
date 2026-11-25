// OWNER: minimap agent. Pathfinding over world.city (nodes/edges). Pure: no three.js, no DOM. See ARCHITECTURE.md.
//
//   findRoute(city, from, to)   -> [{x,z}, ...]  polyline along the roads, or [] when there is no route
//   createRouter(city)          -> { route(from, to), nearest(x, z) }  cached adjacency + reusable heap (use this in hot paths)
//   routeLength(points)         -> metres
//   nextTurn(points, heading)   -> { dir: 'left'|'right'|'straight'|'uturn', distance, angle }
//
// Conventions (same as the rest of the game): north is -z, east is +x, heading 0 faces +z, forward = (sin h, cos h).
// Steering right makes the heading FALL, so a right turn is a negative change of the travel angle atan2(dx, dz).
import { nearestRoad } from './layout.js';
import { angleDiff } from '../game/rng.js';

const hyp = Math.hypot;

/** Binary min-heap over (key, value) with typed arrays; reused between queries so a search allocates nothing. */
function createHeap(capacity = 1024) {
  let keys = new Float64Array(capacity);
  let vals = new Int32Array(capacity);
  let n = 0;
  const grow = () => {
    const k2 = new Float64Array(keys.length * 2);
    const v2 = new Int32Array(vals.length * 2);
    k2.set(keys);
    v2.set(vals);
    keys = k2;
    vals = v2;
  };
  return {
    clear() { n = 0; },
    get size() { return n; },
    peekKey() { return n ? keys[0] : Infinity; },
    push(k, v) {
      if (n === keys.length) grow();
      let i = n++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= k) break;
        keys[i] = keys[p];
        vals[i] = vals[p];
        i = p;
      }
      keys[i] = k;
      vals[i] = v;
    },
    /** Removes the smallest entry and returns its value (its key is in `lastKey`). */
    pop() {
      const top = vals[0];
      this.lastKey = keys[0];
      n--;
      if (n > 0) {
        const k = keys[n];
        const v = vals[n];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && keys[c + 1] < keys[c]) c++;
          if (keys[c] >= k) break;
          keys[i] = keys[c];
          vals[i] = vals[c];
          i = c;
        }
        keys[i] = k;
        vals[i] = v;
      }
      return top;
    },
    lastKey: 0,
  };
}

/** Drop vertices closer than `eps` to the previous one and the ones that sit exactly on a straight stretch. */
function simplify(pts, eps = 0.05) {
  const out = [];
  for (const p of pts) {
    const n = out.length;
    if (n && hyp(p.x - out[n - 1].x, p.z - out[n - 1].z) < eps) continue;
    if (n >= 2) {
      const a = out[n - 2];
      const b = out[n - 1];
      const ux = b.x - a.x;
      const uz = b.z - a.z;
      const vx = p.x - b.x;
      const vz = p.z - b.z;
      const cross = ux * vz - uz * vx;
      const dot = ux * vx + uz * vz;
      if (dot > 0 && Math.abs(cross) < 1e-4 * hyp(ux, uz) * hyp(vx, vz)) out[n - 1] = p; // b is redundant
      else out.push(p);
    } else out.push(p);
  }
  return out;
}

/** A router for one city: adjacency in flat typed arrays (CSR), an A* with a stamped (never cleared) scratch space. */
export function createRouter(city) {
  const nodes = city?.nodes || [];
  const edges = city?.edges || [];
  const N = nodes.length;
  const xs = new Float64Array(N);
  const zs = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    xs[i] = nodes[i].x;
    zs[i] = nodes[i].z;
  }
  // CSR adjacency: roads are two-way, every edge appears at both of its ends
  const start = new Int32Array(N + 1);
  for (const e of edges) {
    start[e.a + 1]++;
    start[e.b + 1]++;
  }
  for (let i = 0; i < N; i++) start[i + 1] += start[i];
  const fill = start.slice(0, N);
  const adjTo = new Int32Array(start[N]);
  const adjCost = new Float64Array(start[N]);
  for (const e of edges) {
    const len = e.len ?? hyp(xs[e.b] - xs[e.a], zs[e.b] - zs[e.a]);
    adjTo[fill[e.a]] = e.b;
    adjCost[fill[e.a]++] = len;
    adjTo[fill[e.b]] = e.a;
    adjCost[fill[e.b]++] = len;
  }

  const g = new Float64Array(N);
  const seen = new Int32Array(N); // epoch at which g[] was written
  const done = new Int32Array(N); // epoch at which the node was closed
  const parent = new Int32Array(N);
  let epoch = 0;
  const heap = createHeap(1024);

  const edgeEnds = (e) => ({ a: e.a, b: e.b });

  /** The point on the road network nearest to (x, z): { edge, t, x, z, dist } or null. */
  const nearest = (x, z) => nearestRoad(city, x, z);

  function route(from, to) {
    if (!N || !edges.length || !from || !to) return [];
    if (!Number.isFinite(from.x + from.z + to.x + to.z)) return [];
    const s = nearest(from.x, from.z);
    const t = nearest(to.x, to.z);
    if (!s || !t) return [];
    const sp = { x: s.x, z: s.z };
    const tp = { x: t.x, z: t.z };
    if (s.edge.id === t.edge.id) return simplify([sp, tp]);

    const se = edgeEnds(s.edge);
    const te = edgeEnds(t.edge);
    const sCostA = s.t * s.edge.len;
    const sCostB = (1 - s.t) * s.edge.len;
    const tCostA = t.t * t.edge.len;
    const tCostB = (1 - t.t) * t.edge.len;
    const gx = tp.x;
    const gz = tp.z;

    epoch++;
    heap.clear();
    const seed = (n, cost) => {
      if (seen[n] === epoch && g[n] <= cost) return;
      seen[n] = epoch;
      g[n] = cost;
      parent[n] = -1;
      heap.push(cost + hyp(xs[n] - gx, zs[n] - gz), n);
    };
    seed(se.a, sCostA);
    seed(se.b, sCostB);

    let best = Infinity;
    let bestNode = -1;
    while (heap.size) {
      if (heap.peekKey() >= best) break;
      const u = heap.pop();
      if (done[u] === epoch) continue;
      done[u] = epoch;
      if (u === te.a || u === te.b) {
        const total = g[u] + (u === te.a ? tCostA : tCostB);
        if (total < best) {
          best = total;
          bestNode = u;
        }
      }
      const gu = g[u];
      for (let k = start[u], end = start[u + 1]; k < end; k++) {
        const v = adjTo[k];
        if (done[v] === epoch) continue;
        const ng = gu + adjCost[k];
        if (seen[v] !== epoch || ng < g[v]) {
          seen[v] = epoch;
          g[v] = ng;
          parent[v] = u;
          heap.push(ng + hyp(xs[v] - gx, zs[v] - gz), v);
        }
      }
    }
    if (bestNode < 0) return [];

    const chain = [];
    for (let n = bestNode; n >= 0; n = parent[n]) chain.push(n);
    const pts = [sp];
    for (let i = chain.length - 1; i >= 0; i--) pts.push({ x: xs[chain[i]], z: zs[chain[i]] });
    pts.push(tp);
    return simplify(pts);
  }

  return { route, nearest, nodeCount: N };
}

const routers = new WeakMap();
/** -> [{x,z}, ...] polyline along the roads from the road point nearest `from` to the road point nearest `to`, or [] when unreachable. */
export function findRoute(city, from, to) {
  if (!city) return [];
  let r = routers.get(city);
  if (!r) {
    r = createRouter(city);
    routers.set(city, r);
  }
  return r.route(from, to);
}

/** Length of a polyline in metres. */
export function routeLength(points) {
  let len = 0;
  for (let i = 1; i < (points?.length || 0); i++) len += hyp(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return len;
}

/** The point `d` metres along the polyline (clamped to its ends), written into `out`. */
export function pointAlong(points, d, out = { x: 0, z: 0 }) {
  if (!points?.length) return out;
  let rest = Math.max(0, d);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const l = hyp(b.x - a.x, b.z - a.z);
    if (rest <= l && l > 0) {
      const k = rest / l;
      out.x = a.x + (b.x - a.x) * k;
      out.z = a.z + (b.z - a.z) * k;
      return out;
    }
    rest -= l;
  }
  const last = points[points.length - 1];
  out.x = last.x;
  out.z = last.z;
  return out;
}

/** Travel direction of the segment p -> q as a heading (the game's convention: atan2(dx, dz)). */
export const segmentHeading = (p, q) => Math.atan2(q.x - p.x, q.z - p.z);

/**
 * The next turn along a route that starts at the player.
 * Returns { dir, distance, angle }: `dir` is 'left' | 'right' | 'straight' (no turn before the end, distance = what is left)
 * | 'uturn' (the first stretch points against the player's heading). `angle` is the signed change of heading in radians
 * (positive = left, because steering right makes the heading fall). Gentle curves (the lakeside promenade) add up
 * until they reach `minAngle`.
 */
export function nextTurn(points, heading = NaN, { minAngle = 0.55, curveWindow = 30, uturnAngle = 2.2 } = {}) {
  const n = points?.length || 0;
  if (n < 2) return { dir: 'straight', distance: 0, angle: 0 };
  const first = segmentHeading(points[0], points[1]);
  if (Number.isFinite(heading)) {
    const d = angleDiff(heading, first);
    if (Math.abs(d) > uturnAngle) return { dir: 'uturn', distance: 0, angle: d };
  }
  let dist = 0;
  let acc = 0;
  let accAt = 0;
  for (let i = 1; i < n - 1; i++) {
    dist += hyp(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    const d = angleDiff(segmentHeading(points[i - 1], points[i]), segmentHeading(points[i], points[i + 1]));
    if (acc === 0) accAt = dist;
    if (acc !== 0 && Math.abs(d) > 0.005 && Math.sign(d) !== Math.sign(acc)) {
      acc = 0;
      accAt = dist;
    }
    acc += d;
    if (Math.abs(acc) >= minAngle) return { dir: acc > 0 ? 'left' : 'right', distance: accAt, angle: acc };
    if (hyp(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z) > curveWindow) acc = 0;
  }
  return { dir: 'straight', distance: routeLength(points), angle: 0 };
}
