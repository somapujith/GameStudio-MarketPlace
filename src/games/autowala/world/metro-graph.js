// OWNER: metro agent. Pure road-graph helpers for routing the metro: a spatial index of the roads, a turn-aware shortest path over
// the arterial network, and the conversion of a route into straight runs. No three.js, no DOM.

const CELL = 64;

/** Grid index of the road edges: `roadAt(x, z, pad)` -> the edge whose carriageway (+pad) covers the point, else null. */
export function makeRoadIndex(city) {
  const grid = new Map();
  const key = (i, j) => i * 4099 + j;
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const b = city.nodes[e.b];
    const m = e.w / 2 + 6;
    const i0 = Math.floor((Math.min(a.x, b.x) - m) / CELL);
    const i1 = Math.floor((Math.max(a.x, b.x) + m) / CELL);
    const j0 = Math.floor((Math.min(a.z, b.z) - m) / CELL);
    const j1 = Math.floor((Math.max(a.z, b.z) + m) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let c = grid.get(k);
        if (!c) grid.set(k, (c = []));
        c.push(e);
      }
    }
  }
  /** Distance from a point to the centre line of an edge (clamped to the segment). */
  function distToEdge(e, x, z) {
    const a = city.nodes[e.a];
    const t = Math.max(0, Math.min(1, ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len));
    return Math.hypot(x - (a.x + e.dx * e.len * t), z - (a.z + e.dz * e.len * t));
  }
  function roadAt(x, z, pad = 0) {
    const c = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!c) return null;
    let best = null;
    let bestOver = 0;
    for (const e of c) {
      const over = e.w / 2 + pad - distToEdge(e, x, z);
      if (over > bestOver) {
        bestOver = over;
        best = e;
      }
    }
    return best;
  }
  return { roadAt, distToEdge };
}

/** How expensive an edge is for a metro route (multiplier on its length); Infinity = never. */
export function widthFactor(e) {
  if (e.name === 'Necklace Road') return 1.35;
  if (e.name === 'Outer Ring Road') return 1.25;
  if (e.w >= 14) return 1;
  if (e.w >= 11) return 1.8;
  if (e.w >= 10) return 2.6;
  return Infinity;
}

export function makeGraph(city) {
  const adj = city.nodes.map(() => []);
  for (const e of city.edges) {
    if (!isFinite(widthFactor(e))) continue;
    adj[e.a].push({ e, to: e.b, from: e.a, dir: 0, dx: e.dx, dz: e.dz });
    adj[e.b].push({ e, to: e.a, from: e.b, dir: 1, dx: -e.dx, dz: -e.dz });
  }
  // the biggest connected piece of the usable network: anchors snap only into it
  const par = city.nodes.map((_, i) => i);
  const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
  for (const e of city.edges) if (isFinite(widthFactor(e))) par[find(e.a)] = find(e.b);
  const sizes = new Map();
  for (const n of city.nodes) if (adj[n.id].length) sizes.set(find(n.id), (sizes.get(find(n.id)) || 0) + 1);
  let root = -1;
  for (const [r, c] of sizes) if (root < 0 || c > sizes.get(root)) root = r;
  const main = new Set(city.nodes.filter((n) => adj[n.id].length && find(n.id) === root).map((n) => n.id));
  return { city, adj, main, roads: makeRoadIndex(city) };
}

/** Nearest node (to a world point) that has at least one usable edge. */
export function snapNode(graph, x, z) {
  let best = -1;
  let bd = Infinity;
  for (const n of graph.city.nodes) {
    if (!graph.main.has(n.id)) continue;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = n.id;
    }
  }
  return best;
}

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

const TURN_COST = 150; // metres-equivalent for a right-angle turn

/**
 * Shortest route over the metro graph from any node of `fromNodes` (or one id) to `toNode`, turn-aware (a quarter turn costs
 * ~55 m, U-turns are forbidden). Options: `mul` Map(edgeId -> cost multiplier), `forbidNodes` Set, `forbidEdges` Set,
 * `firstDir` {dx,dz} (the heading the route arrives with, so the first turn is charged).
 * -> [{ e: edgeId, dir, from, to }] or null.
 */
export function shortestPath(graph, fromNodes, toNode, opts = {}) {
  const { city, adj } = graph;
  const E = city.edges.length;
  const starts = Array.isArray(fromNodes) ? fromNodes : [fromNodes];
  const dist = new Float64Array(E * 2).fill(Infinity);
  const prev = new Int32Array(E * 2).fill(-1);
  const heap = new Heap();
  const { mul, forbidNodes, forbidEdges, firstDir } = opts;
  const cost = (en) => en.e.len * widthFactor(en.e) * ((mul && mul.get(en.e.id)) || 1);
  const stateOf = (en) => en.e.id * 2 + en.dir;
  for (const s of starts) {
    for (const en of adj[s]) {
      if (forbidEdges && forbidEdges.has(en.e.id)) continue;
      if (forbidNodes && forbidNodes.has(en.to) && en.to !== toNode) continue;
      let c = cost(en);
      if (firstDir) {
        const dot = firstDir.dx * en.dx + firstDir.dz * en.dz;
        if (dot < -0.9) continue;
        c += TURN_COST * Math.acos(Math.max(-1, Math.min(1, dot))) / (Math.PI / 2);
      }
      const st = stateOf(en);
      if (c < dist[st]) {
        dist[st] = c;
        prev[st] = -1;
        heap.push(c, st);
      }
    }
  }
  while (heap.size) {
    const st = heap.pop();
    const e = city.edges[st >> 1];
    const dir = st & 1;
    const node = dir === 0 ? e.b : e.a;
    const d0 = dist[st];
    if (node === toNode) {
      const steps = [];
      for (let s = st; s !== -1; s = prev[s]) {
        const ed = city.edges[s >> 1];
        const dr = s & 1;
        steps.push({ e: ed.id, dir: dr, from: dr === 0 ? ed.a : ed.b, to: dr === 0 ? ed.b : ed.a });
      }
      return steps.reverse();
    }
    const dx = dir === 0 ? e.dx : -e.dx;
    const dz = dir === 0 ? e.dz : -e.dz;
    for (const en of adj[node]) {
      if (en.e.id === e.id) continue;
      if (forbidEdges && forbidEdges.has(en.e.id)) continue;
      if (forbidNodes && forbidNodes.has(en.to) && en.to !== toNode) continue;
      const dot = dx * en.dx + dz * en.dz;
      if (dot < -0.9) continue;
      const turn = TURN_COST * Math.acos(Math.max(-1, Math.min(1, dot))) / (Math.PI / 2);
      const nd = d0 + cost(en) + turn;
      const ns = stateOf(en);
      if (nd < dist[ns]) {
        dist[ns] = nd;
        prev[ns] = st;
        heap.push(nd, ns);
      }
    }
  }
  return null;
}

/** Total weighted cost of a step list (for comparing candidate routes). */
export function routeCost(city, steps, mul) {
  let c = 0;
  for (const st of steps) {
    const e = city.edges[st.e];
    c += e.len * widthFactor(e) * ((mul && mul.get(e.id)) || 1);
  }
  return c;
}

/** Remove loops and immediate reversals from a concatenated route. */
export function loopErase(steps) {
  const out = [];
  const seen = new Map(); // node -> index in out of the step that arrived there (-1 = start node)
  for (const st of steps) {
    if (!out.length && !seen.size) seen.set(st.from, -1);
    if (seen.has(st.to)) {
      out.length = seen.get(st.to) + 1;
      for (const [n, i] of [...seen]) if (i >= out.length) seen.delete(n);
      continue;
    }
    out.push(st);
    seen.set(st.to, out.length - 1);
  }
  return out;
}

/** Route through a list of waypoint nodes (each leg shortest, then loops erased). */
export function routeThrough(graph, nodes, opts = {}) {
  let all = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    if (nodes[i] === nodes[i + 1]) continue;
    const last = all[all.length - 1];
    const e = last && graph.city.edges[last.e];
    const firstDir = last ? { dx: last.dir === 0 ? e.dx : -e.dx, dz: last.dir === 0 ? e.dz : -e.dz } : null;
    const leg = shortestPath(graph, nodes[i], nodes[i + 1], { ...opts, firstDir }) || shortestPath(graph, nodes[i], nodes[i + 1], opts);
    if (!leg) return null;
    all = all.concat(leg);
  }
  return loopErase(all);
}

/**
 * Merge consecutive collinear steps into straight runs:
 * [{ ax,az,bx,bz, dx,dz, len, parts:[{s0,s1,w,edge}], nodes:[ids] }].
 */
export function stepsToRuns(city, steps) {
  const runs = [];
  for (const st of steps) {
    const e = city.edges[st.e];
    const dx = st.dir === 0 ? e.dx : -e.dx;
    const dz = st.dir === 0 ? e.dz : -e.dz;
    const na = city.nodes[st.from];
    const nb = city.nodes[st.to];
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.dx * dz - last.dz * dx) < 1e-3 && last.dx * dx + last.dz * dz > 0) {
      last.parts.push({ s0: last.len, s1: last.len + e.len, w: e.w, edge: e.id });
      last.len += e.len;
      last.bx = nb.x;
      last.bz = nb.z;
      last.nodes.push(st.to);
    } else {
      runs.push({ ax: na.x, az: na.z, bx: nb.x, bz: nb.z, dx, dz, len: e.len, parts: [{ s0: 0, s1: e.len, w: e.w, edge: e.id }], nodes: [st.from, st.to] });
    }
  }
  return runs;
}

/** Width of the road under run position `sr`. */
export function runWidth(run, sr) {
  for (const p of run.parts) if (sr <= p.s1 + 1e-6) return p.w;
  return run.parts[run.parts.length - 1].w;
}
