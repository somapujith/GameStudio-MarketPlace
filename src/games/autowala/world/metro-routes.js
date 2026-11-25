// OWNER: metro agent. Plans the Hyderabad Metro on a generated city: three lines routed along the arterial roads (Dijkstra over the
// road graph, turn-aware), smooth tracks with corner fillets, the two interchanges, and the stations. Pure data, no three.js.
//
//   Red   Miyapur -> LB Nagar  west to east, south of the lake, then south-east
//   Blue  Nagole -> Raidurg    north-east, round the north, then west; stacked above the Red Line at Ameerpet
//   Green JBS -> MG Bus Station  north to south, ends at the Red Line (MG Bus Station)
//
// Interchanges: the BSP road network only has T-junctions, so two lines can never cross. Instead
//  * Ameerpet (Red x Blue, "stack"): Blue joins a Red avenue from a side street, runs on top of Red for a stretch (Blue 7.6 m higher,
//    like the real double-decker station) and leaves by another side street; Blue's viaduct ramps up and down around it.
//  * MG Bus Station (Red x Green, "terminus"): Green ends on a side street at a Red avenue; the two stations stand next to each other.
import { nearestRoad } from './layout.js';
import { LINE_COLORS, LINE_NAMES, LINE_ORDER, pickBetween, poolIndex, slug } from './metro-names.js';
import { loopErase, makeGraph, routeThrough, shortestPath, snapNode, stepsToRuns, routeCost, widthFactor } from './metro-graph.js';
import { applyHeights, buildTrack, nearestOnTrack, pointAt, sampleIndex, smooth } from './metro-track.js';

export const METRO = {
  railY: 11, // rail level of a normal viaduct (m above the road)
  upperY: 18.6, // rail level of the upper line at an interchange
  ramp: 170, // length of the ramps up to / down from the upper level
  stationHalf: 32, // half the platform length
  stairFrom: 21, // stair blocks span this far from the station centre ...
  stairTo: 33, // ... to here (along the track), at both ends
  minGap: 250, // min distance between stations (m)
  targetGap: 330,
  maxGap: 760,
  lakeMargin: 12, // tracks stay this far outside the water ellipse
};

/** World-space targets (the city's districts are fixed, so these work for every seed). */
const PLAN = {
  red: { anchors: [[-676, -50], [-150, -50], [112, 2], [680, 2], [686, 640]] },
  blue: { pre: [[686, -480], [236, -686], [236, -300], [-205, -172]], post: [[-686, -232]], hint: [-330, -50] },
  green: { pre: [[300, -640], [426, -300]], hint: [426, 2] },
};

const ptKey = (n) => `${n.x.toFixed(1)},${n.z.toFixed(1)}`;

/** Is a point on the water (the lake ellipse, grown by `m`)? */
export function inLake(city, x, z, m = 0) {
  const L = city.lake;
  return ((x - L.cx) / (L.rx + m)) ** 2 + ((z - L.cz) / (L.rz + m)) ** 2 < 1;
}

const reverseStep = (st) => ({ e: st.e, dir: 1 - st.dir, from: st.to, to: st.from });

/** Nodes of a route in order. */
function routeNodes(steps) {
  const out = [steps[0].from];
  for (const st of steps) out.push(st.to);
  return out;
}

function stemsOf(graph, node, usedEdges, minW = 11) {
  return graph.adj[node].filter((en) => !usedEdges.has(en.e.id) && en.e.w >= minW);
}

/** The run (index) of `runs` that contains route node `node` strictly inside it, plus the node's distance along that run. */
function internalNodes(runs) {
  const out = [];
  runs.forEach((r, ri) => {
    let acc = 0;
    // parts are edges: node k sits at the end of part k-1
    for (let k = 1; k < r.nodes.length - 1; k++) {
      acc = r.parts[k - 1].s1;
      if (acc < 48 || r.len - acc < 48) continue; // keep clear of the corner fillets
      out.push({ node: r.nodes[k], run: ri, d: acc, runNodeIndex: k });
    }
  });
  return out;
}

function trackOf(city, steps, trimEnd = 0) {
  const runs = stepsToRuns(city, steps);
  if (trimEnd > 0) {
    const r = runs[runs.length - 1];
    const keep = r.len - trimEnd;
    r.len = keep;
    r.bx = r.ax + r.dx * keep;
    r.bz = r.az + r.dz * keep;
    r.parts = r.parts.filter((p) => p.s0 < keep);
    if (r.parts.length) r.parts[r.parts.length - 1].s1 = keep;
  }
  return buildTrack(runs);
}

/** Shortest distance from any sample of `track` to the lake water. Used by tests and the planner. */
export function trackClearsLake(city, track, margin = METRO.lakeMargin) {
  return track.samples.every((p) => !inLake(city, p.x, p.z, margin));
}

/**
 * The stair slots of a station centred at distance `s`: up to four spots on the verge just beyond the two ends of the concourse
 * (end = +1 ahead / -1 behind, side = +1 left / -1 right of the track) where the pavement is free of side streets.
 */
export function stairSlots(graph, track, s, w) {
  const out = [];
  const tmp = {};
  for (const end of [1, -1]) {
    for (const side of [1, -1]) {
      let clear = true;
      for (let v = METRO.stairFrom - 1; v <= METRO.stairTo + 1 && clear; v += 3.5) {
        pointAt(track, s + end * v, tmp);
        const nx = tmp.tz * side;
        const nz = -tmp.tx * side;
        for (const off of [w / 2 + 1.7, w / 2 + 3.3]) {
          if (graph.roads.roadAt(tmp.x + nx * off, tmp.z + nz * off, 0.7)) {
            clear = false;
            break;
          }
        }
      }
      if (clear) out.push({ end, side });
    }
  }
  return out;
}

/** Grid of "can a station stand here": straight, one road width, flat, out of the lake, with stair slots at both ends. cell = 3 m. */
function stationGrid(city, graph, track) {
  const sm = track.samples;
  const cell = 3;
  const n = Math.floor(track.length / cell) + 1;
  const ok = new Uint8Array(n);
  const tmp = {};
  for (let k = 0; k < n; k++) {
    const d = k * cell;
    const i = sampleIndex(sm, d);
    let good = !sm[i].arc && !sm[i + 1].arc && sm[i].w === sm[i + 1].w;
    if (good) {
      pointAt(track, d, tmp);
      good = !inLake(city, tmp.x, tmp.z, 4);
    }
    ok[k] = good ? 1 : 0;
  }
  const cum = new Int32Array(n + 1);
  for (let k = 0; k < n; k++) cum[k + 1] = cum[k] + (ok[k] ? 0 : 1);
  const reach = METRO.stairTo + 3;
  const half = Math.ceil(reach / cell);
  const flat = (k) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = k - half; j <= k + half; j += 2) {
      const y = pointAt(track, Math.max(0, Math.min(track.length, j * cell))).y;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    return hi - lo < 0.02;
  };
  const memo = new Map();
  const valid = (k) => {
    if (memo.has(k)) return memo.get(k);
    let v = k - half >= 0 && k + half < n && cum[k + half + 1] - cum[k - half] === 0 && flat(k);
    if (v) {
      const s = k * cell;
      const w = sm[sampleIndex(sm, s)].w;
      const slots = stairSlots(graph, track, s, w);
      v = slots.some((q) => q.end === 1) && slots.some((q) => q.end === -1);
    }
    memo.set(k, v);
    return v;
  };
  return { cell, n, valid };
}

/** Pick station centres (as distances along the track) around the pinned ones. */
function spreadStations(grid, length, pinned) {
  const { cell } = grid;
  const out = pinned.map((p) => ({ ...p }));
  out.sort((a, b) => a.s - b.s);
  const result = [out[0]];
  for (let g = 1; g < out.length; g++) {
    const a = result[result.length - 1].s;
    const b = out[g].s;
    const gap = b - a;
    const m = Math.max(1, Math.round(gap / METRO.targetGap));
    const spacing = gap / m;
    let prev = a;
    for (let i = 1; i < m; i++) {
      const target = prev + (b - prev) / (m - i + 1);
      let best = -1;
      let bd = Infinity;
      const range = Math.min(spacing * 0.34, 110);
      for (let k = Math.max(0, Math.floor((target - range) / cell)); k <= Math.min(grid.n - 1, Math.ceil((target + range) / cell)); k++) {
        const s = k * cell;
        if (s - prev < METRO.minGap || b - s < METRO.minGap) continue;
        if (!grid.valid(k)) continue;
        const d = Math.abs(s - target);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (best >= 0) {
        result.push({ s: best, kind: 'stop' });
        prev = best;
      }
    }
    result.push(out[g]);
  }
  return result;
}

/** Best valid grid position near `target`, at least `minDist` from `avoid` (distances along the track). */
function nearestValid(grid, target, { lo = 0, hi = Infinity, avoid = null, minDist = 0, prefer = 0 } = {}) {
  let best = -1;
  let bd = Infinity;
  for (let k = 0; k < grid.n; k++) {
    const s = k * grid.cell;
    if (s < lo || s > hi) continue;
    if (avoid !== null && Math.abs(s - avoid) < minDist) continue;
    if (!grid.valid(k)) continue;
    const d = Math.abs(s - target) + (prefer ? 0 : 0);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/**
 * Plan the whole metro on a city.
 * @returns {{ lines: Array, interchanges: Array, graph }}
 *   line = { id, name, te, color, steps, track, stations:[{ id, name, te, line, s, x, z, tx, tz, y, w, interchange, partner? }], points }
 */
const TIERS = [
  { minShare: 150, maxShare: 520, endMargin: 300, stemMinW: 11, top: 60 },
  { minShare: 120, maxShare: 700, endMargin: 230, stemMinW: 10, top: 400 },
  { minShare: 100, maxShare: 900, endMargin: 170, stemMinW: 10, top: 1200 },
];

/** Plan the metro on a city (the planner tries progressively looser corridor rules until one fits). */
export function planMetro(city) {
  const graph = makeGraph(city);
  let err = null;
  for (const cfg of TIERS) {
    try {
      return planWith(city, graph, cfg);
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

function need(v, msg) {
  if (!v) throw new Error(msg);
  return v;
}

function planWith(city, graph, cfg) {
  const lakeBlocked = new Set();
  for (const nd of city.nodes) if (inLake(city, nd.x, nd.z, METRO.lakeMargin)) lakeBlocked.add(nd.id);

  // ---------------------------------------------------------------- Red
  const redNodes = PLAN.red.anchors.map(([x, z]) => snapNode(graph, x, z));
  const redSteps = need(routeThrough(graph, redNodes, { forbidNodes: lakeBlocked }) || routeThrough(graph, redNodes), 'metro: no Red route');
  const redTrack = trackOf(city, redSteps);
  const redEdges = new Set(redSteps.map((s) => s.e));
  const redNodeSet = new Set(routeNodes(redSteps));
  const redRuns = redTrack.runs;
  const redInternal = internalNodes(redRuns);

  // ---------------------------------------------------------------- Blue (stacked over Red at Ameerpet)
  const bluePre = need(routeThrough(graph, PLAN.blue.pre.map(([x, z]) => snapNode(graph, x, z)), { forbidNodes: new Set([...lakeBlocked, ...redNodeSet]) }), 'metro: no Blue route');
  const preEnd = bluePre[bluePre.length - 1].to;
  const postNodes = PLAN.blue.post.map(([x, z]) => snapNode(graph, x, z));
  const forbidB = new Set([...lakeBlocked, ...redNodeSet, ...routeNodes(bluePre)]);
  const cands = [];
  // side streets off the Red avenue, at nodes strictly inside a straight Red run
  const stemInfo = [];
  for (const it of redInternal) {
    for (const en of stemsOf(graph, it.node, redEdges, cfg.stemMinW)) {
      const far = en.to;
      if (lakeBlocked.has(far) || redNodeSet.has(far)) continue;
      stemInfo.push({ ...it, en, far });
    }
  }
  const legIn = new Map();
  const legOut = new Map();
  for (const si of stemInfo) {
    if (!legIn.has(si.far)) {
      const l = shortestPath(graph, preEnd, si.far, { forbidNodes: forbidB, mul: new Map(bluePre.map((s) => [s.e, 50])) });
      legIn.set(si.far, l);
    }
    if (!legOut.has(si.far)) {
      const l = shortestPath(graph, si.far, postNodes[0], { forbidNodes: new Set([...lakeBlocked, ...redNodeSet, ...routeNodes(bluePre)].filter((n) => n !== si.far)) });
      legOut.set(si.far, l);
    }
  }
  const redRunOf = (it) => redRuns[it.run];
  for (const a of stemInfo) {
    for (const b of stemInfo) {
      if (a.run !== b.run || a.node === b.node || a.far === b.far) continue;
      const dist = Math.abs(a.d - b.d);
      if (dist < cfg.minShare || dist > cfg.maxShare) continue;
      const li = legIn.get(a.far);
      const lo = legOut.get(b.far);
      if (!li || !lo) continue;
      const ci = routeCost(city, li) + routeCost(city, lo) + a.en.e.len + b.en.e.len + dist;
      const midD = (a.d + b.d) / 2;
      const r = redRunOf(a);
      const mx = r.ax + r.dx * midD;
      const mz = r.az + r.dz * midD;
      const hint = Math.hypot(mx - PLAN.blue.hint[0], mz - PLAN.blue.hint[1]);
      cands.push({ a, b, score: ci + 0.45 * hint });
    }
  }
  cands.sort((p, q) => p.score - q.score);
  let blue = null;
  for (const c of cands.slice(0, cfg.top)) {
    const { a, b } = c;
    // run edges between the two junctions, in Blue's direction
    const rsteps = redSteps;
    const ia = rsteps.findIndex((st) => st.from === a.node);
    const ib = rsteps.findIndex((st) => st.from === b.node);
    const share = ia < ib ? rsteps.slice(ia, ib) : rsteps.slice(ib, ia).reverse().map(reverseStep);
    const stemIn = { e: a.en.e.id, dir: 1 - a.en.dir, from: a.far, to: a.node };
    const stemOut = { e: b.en.e.id, dir: b.en.dir, from: b.node, to: b.far };
    const all = [...bluePre, ...legIn.get(a.far), stemIn, ...share, stemOut, ...legOut.get(b.far)];
    let rest = null;
    if (postNodes.length > 1) rest = routeThrough(graph, postNodes, { forbidNodes: new Set([...lakeBlocked, ...redNodeSet]) });
    const full = loopErase(rest ? [...all, ...rest] : all);
    // the shared stretch and both stems must survive loop erasure intact
    const keep = new Set(full.map((s) => s.e));
    if (![stemIn, stemOut, ...share].every((s) => keep.has(s.e))) continue;
    const track = trackOf(city, full);
    // where does Blue lie on top of Red?
    let sFirst = Infinity;
    let sLast = -Infinity;
    for (const sm of track.samples) {
      if (nearestOnTrack(redTrack, sm.x, sm.z).d < 9.8) {
        sFirst = Math.min(sFirst, sm.s);
        sLast = Math.max(sLast, sm.s);
      }
    }
    if (!isFinite(sFirst) || sFirst < cfg.endMargin || track.length - sLast < cfg.endMargin) continue;
    if (!trackClearsLake(city, track)) continue;
    blue = { steps: full, track, sFirst, sLast, a, b };
    break;
  }
  if (!blue) throw new Error('metro: no Ameerpet stack found');
  {
    const lo = blue.sFirst - 6;
    const hi = blue.sLast + 6;
    const A = METRO.railY;
    const D = METRO.upperY - METRO.railY;
    blue.track.samples.forEach((sm) => {
      sm.y = A + D * (smooth((sm.s - (lo - METRO.ramp)) / METRO.ramp) - smooth((sm.s - hi) / METRO.ramp));
    });
    blue.lo = lo;
    blue.hi = hi;
  }
  applyHeights(redTrack, () => METRO.railY);

  // ---------------------------------------------------------------- Green (ends on the Red avenue)
  const bluePre2 = new Set(routeNodes(blue.steps));
  const blueMul = new Map(blue.steps.map((st) => [st.e, 40]));
  const greenPre = need(routeThrough(graph, PLAN.green.pre.map(([x, z]) => snapNode(graph, x, z)), { forbidNodes: new Set([...lakeBlocked, ...redNodeSet]), mul: blueMul }), 'metro: no Green route');
  const gEnd = greenPre[greenPre.length - 1].to;
  let green = null;
  {
    const gcands = [];
    for (const it of redInternal) {
      for (const en of stemsOf(graph, it.node, redEdges, 10)) {
        const far = en.to;
        if (lakeBlocked.has(far) || redNodeSet.has(far) || bluePre2.has(far)) continue;
        const r = redRuns[it.run];
        const tx = r.ax + r.dx * it.d;
        const tz = r.az + r.dz * it.d;
        gcands.push({ it, en, far, hint: Math.hypot(tx - PLAN.green.hint[0], tz - PLAN.green.hint[1]) });
      }
    }
    gcands.sort((p, q) => p.hint - q.hint);
    for (const g of gcands.slice(0, 12)) {
      // the T node itself is Red's; approach through the stem only
      const leg = shortestPath(graph, gEnd, g.far, { forbidNodes: new Set([...lakeBlocked, ...redNodeSet, ...bluePre2, ...routeNodes(greenPre)].filter((n) => n !== gEnd && n !== g.far)) });
      if (!leg) continue;
      const stem = { e: g.en.e.id, dir: 1 - g.en.dir, from: g.far, to: g.it.node };
      const steps = loopErase([...greenPre, ...leg, stem]);
      if (steps[steps.length - 1].e !== stem.e) continue;
      const barW = redRuns[g.it.run].parts.reduce((m, p) => Math.max(m, p.w), 0);
      const trim = Math.min(barW / 2 + 9, 24);
      const runs = stepsToRuns(city, steps);
      const lastRun = runs[runs.length - 1];
      if (lastRun.len < 150) continue; // a straight approach for the terminus station
      const track = trackOf(city, steps, trim);
      if (!trackClearsLake(city, track)) continue;
      green = { steps, track, tNode: g.it.node, tRun: g.it.run, tD: g.it.d };
      break;
    }
  }
  if (!green) throw new Error('metro: no Green terminus found');
  applyHeights(green.track, () => METRO.railY);

  // ---------------------------------------------------------------- stations
  const lines = [];
  const defs = { red: { track: redTrack, steps: redSteps }, blue: { track: blue.track, steps: blue.steps }, green: { track: green.track, steps: green.steps } };
  const grids = {};
  for (const id of LINE_ORDER) grids[id] = stationGrid(city, graph, defs[id].track);

  // Ameerpet: the middle of the stretch where Blue lies on Red (a valid platform spot on both)
  const redOverlap = { lo: Infinity, hi: -Infinity };
  for (const sm of redTrack.samples) {
    if (nearestOnTrack(blue.track, sm.x, sm.z).d < 9.8) {
      redOverlap.lo = Math.min(redOverlap.lo, sm.s);
      redOverlap.hi = Math.max(redOverlap.hi, sm.s);
    }
  }
  const redMid = (redOverlap.lo + redOverlap.hi) / 2;
  let ameerRed = -1;
  let bd = Infinity;
  for (let k = 0; k < grids.red.n; k++) {
    const s = k * grids.red.cell;
    if (s < redOverlap.lo || s > redOverlap.hi || !grids.red.valid(k)) continue;
    const p = pointAt(redTrack, s);
    const nb = nearestOnTrack(blue.track, p.x, p.z);
    const kb = Math.round(nb.s / grids.blue.cell);
    if (!grids.blue.valid(kb) || nb.d > 1.5) continue;
    const d = Math.abs(s - redMid);
    if (d < bd) {
      bd = d;
      ameerRed = s;
    }
  }
  if (ameerRed < 0) throw new Error('metro: no Ameerpet platform spot');
  const ap = pointAt(redTrack, ameerRed);
  const ameerBlue = nearestOnTrack(blue.track, ap.x, ap.z).s;

  // MG Bus Station: Red platform next to the Green terminus (west of it along Red, >= 55 m from the junction)
  const tNode = city.nodes[green.tNode];
  const tOnRed = nearestOnTrack(redTrack, tNode.x, tNode.z).s;
  const mgbsRed = (() => {
    let best = -1;
    let bdist = Infinity;
    for (let k = 0; k < grids.red.n; k++) {
      const s = k * grids.red.cell;
      if (!grids.red.valid(k)) continue;
      const d = Math.abs(s - tOnRed);
      if (d < 58) continue;
      if (Math.abs(s - ameerRed) < METRO.minGap) continue;
      if (d < bdist) {
        bdist = d;
        best = s;
      }
    }
    return best;
  })();
  if (mgbsRed < 0) throw new Error('metro: no MG Bus Station spot');

  const gridStartEnd = (grid, length) => {
    const first = nearestValid(grid, METRO.stationHalf + 20, { lo: 0 });
    const last = (() => {
      let best = -1;
      for (let k = grid.n - 1; k >= 0; k--) {
        if (grid.valid(k)) {
          best = k * grid.cell;
          break;
        }
      }
      return best;
    })();
    return [first, last];
  };

  const pins = {
    red: (() => {
      const [a, b] = gridStartEnd(grids.red, redTrack.length);
      return [{ s: a, kind: 'start' }, { s: ameerRed, kind: 'interchange', key: 'Ameerpet' }, { s: mgbsRed, kind: 'interchange', key: 'MG Bus Station' }, { s: b, kind: 'end' }];
    })(),
    blue: (() => {
      const [a, b] = gridStartEnd(grids.blue, blue.track.length);
      return [{ s: a, kind: 'start' }, { s: ameerBlue, kind: 'interchange', key: 'Ameerpet' }, { s: b, kind: 'end' }];
    })(),
    green: (() => {
      const [a, b] = gridStartEnd(grids.green, green.track.length);
      return [{ s: a, kind: 'start' }, { s: b, kind: 'end', key: 'MG Bus Station', interchange: true }];
    })(),
  };

  for (const id of LINE_ORDER) {
    const def = LINE_NAMES[id];
    const { track, steps } = defs[id];
    const placed = spreadStations(grids[id], track.length, pins[id]);
    placed.sort((a, b) => a.s - b.s);
    // names: pinned ones by key, the rest evenly from the pool gaps
    const pool = def.pool;
    const names = new Array(placed.length).fill(null);
    placed.forEach((p, i) => {
      if (p.kind === 'start') names[i] = pool[0];
      else if (p.kind === 'end') names[i] = pool[pool.length - 1];
      else if (p.kind === 'interchange') names[i] = pool[poolIndex(id, p.key)];
    });
    let i = 0;
    while (i < placed.length) {
      if (names[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < placed.length && !names[j]) j++;
      const i0 = poolIndex(id, names[i - 1].en);
      const i1 = j < placed.length ? poolIndex(id, names[j].en) : pool.length;
      const picks = pickBetween(pool, i0, i1, j - i);
      for (let k = i; k < j; k++) names[k] = picks[k - i] || null;
      i = j;
    }
    // stations whose name pool ran dry are dropped
    const stations = [];
    placed.forEach((p, idx) => {
      const nm = names[idx];
      if (!nm) return;
      const pt = pointAt(track, p.s);
      const front = nearestRoad(city, pt.x, pt.z);
      stations.push({
        id: `${id}-${slug(nm.en)}`,
        name: nm.en,
        te: nm.te,
        line: id,
        s: p.s,
        x: pt.x,
        z: pt.z,
        tx: pt.tx,
        tz: pt.tz,
        y: pt.y,
        w: pt.w,
        interchange: p.kind === 'interchange' || !!p.interchange,
        front: { x: front.x, z: front.z, edge: front.edge.id, t: front.t },
      });
    });
    lines.push({
      id,
      name: def.name,
      te: def.te,
      color: LINE_COLORS[id],
      steps,
      track,
      stations,
      from: def.from,
      to: def.to,
    });
  }

  // interchanges: stations of different lines with the same name
  const interchanges = [];
  const byName = new Map();
  for (const ln of lines) for (const st of ln.stations) (byName.get(st.name) || byName.set(st.name, []).get(st.name)).push(st);
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const kind = list.some((s) => s.line === 'blue') ? 'stack' : 'terminus';
    list.forEach((s) => (s.interchange = true));
    interchanges.push({ name, kind, lines: list.map((s) => s.line), stations: list.map((s) => s.id), x: list[0].x, z: list[0].z });
  }
  return { lines, interchanges, graph, blue: { lo: blue.lo, hi: blue.hi }, redTrack };
}
