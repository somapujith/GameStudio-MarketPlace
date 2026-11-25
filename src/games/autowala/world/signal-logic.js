// Traffic signals as pure data and maths (no three.js, no DOM): which junctions get a signal, the phase clock, and when a driver must
// stop. The meshes live in world/signals.js, the player's fines in gameplay/rules.js, and traffic obeys through `ctx.signals`.
//
// A signalled junction has two phase groups: group 0 = approaches running mostly along x, group 1 = mostly along z. The cycle is
//   group 0: green, yellow, red until the cycle ends;  group 1 runs half a cycle later.
// `allRed` is the clearance both groups wait after a yellow. States: 0 red, 1 yellow, 2 green.
import { linkSetback } from '../sim/traffic-lanes.js';

export const SIGNAL = {
  green: 15, // s
  yellow: 3,
  allRed: 2,
  max: 36, // junctions with a signal
  minWidth: 14, // first choice: junctions where a road at least this wide meets (avenues, ring road, Necklace Road)
  minWidth2: 10, // a second pass takes busy mid-size junctions until `max` is reached
  spacing: 70, // m between two signalled junctions
  minEdge: 30, // m: every road at the junction must be this long, so a driver leaving the last junction has room to stop for the line
  brake: 4.5, // m/s2: the braking a driver is willing to do for a yellow
  brakeRed: 7, // ... for a red that has just turned
  brakeHard: 9, // ... once already braking for the line (never give up a stop that is still possible)
};

export const RED = 0;
export const YELLOW = 1;
export const GREEN = 2;

export const cycleLength = (cfg = SIGNAL) => 2 * (cfg.green + cfg.yellow + cfg.allRed);

function phaseTime(t, group, cfg) {
  const C = cycleLength(cfg);
  let tt = ((t % C) + C) % C;
  if (group === 1) tt = (tt + C / 2) % C;
  return tt;
}

/** 0 red, 1 yellow, 2 green for a phase group at time `t` (the node's own offset is added by the caller). */
export function signalState(t, group, cfg = SIGNAL) {
  const tt = phaseTime(t, group, cfg);
  if (tt < cfg.green) return GREEN;
  if (tt < cfg.green + cfg.yellow) return YELLOW;
  return RED;
}

/** Seconds until the current state of the group changes (red: until green). */
export function signalLeft(t, group, cfg = SIGNAL) {
  const tt = phaseTime(t, group, cfg);
  if (tt < cfg.green) return cfg.green - tt;
  if (tt < cfg.green + cfg.yellow) return cfg.green + cfg.yellow - tt;
  return cycleLength(cfg) - tt;
}

/** Seconds the group has been red (0 while green or yellow). */
export function redSince(t, group, cfg = SIGNAL) {
  const tt = phaseTime(t, group, cfg);
  const start = cfg.green + cfg.yellow;
  return tt >= start ? tt - start : 0;
}

/**
 * Must a driver `dist` metres before the stop line (nose to line), doing `speed` m/s, stop? Green: no. Yellow or red: yes, unless
 * the driver can no longer stop (then they are committed and go through). `sticky`: the driver is already braking for this line, so
 * only a stop that is physically out of reach is given up. A stationary driver always stops.
 */
export function mustStop(state, dist, speed, sticky = false, cfg = SIGNAL) {
  if (state === GREEN) return false;
  if (speed < 0.3) return true;
  const b = sticky ? cfg.brakeHard : state === RED ? cfg.brakeRed : cfg.brake;
  return dist > (speed * speed) / (2 * b);
}

/** Stable pseudo random 0..1 from an integer (the node id): offsets and the choice of who watches the junction. */
export function hash01(n) {
  let h = Math.imul((n | 0) + 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Choose the signalled junctions: the biggest 3+-way junctions of wide roads first, then busy mid-size ones, spread out. Returns node ids. */
export function pickJunctions(city, cfg = SIGNAL) {
  const margin = (city.half || 700) - 60;
  const out = [];
  for (const minW of [cfg.minWidth, cfg.minWidth2]) {
    const cands = [];
    for (const n of city.nodes) {
      if (n.out.length < 3 || n.w < minW) continue;
      if (Math.abs(n.x) > margin || Math.abs(n.z) > margin) continue;
      let ok = true;
      for (const id of n.out) if (city.edges[id].len < cfg.minEdge) ok = false;
      if (!ok) continue;
      cands.push({ n, score: n.w + n.out.length * 3 + hash01(n.id) * 6 });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands) {
      if (out.length >= cfg.max) break;
      if (out.every((o) => Math.hypot(o.x - c.n.x, o.z - c.n.z) >= cfg.spacing)) out.push(c.n);
    }
  }
  return out.map((n) => n.id);
}

/** Who watches a junction: 'cop' (traffic police), 'cam' (a red-light camera) or null. */
export function enforcementFor(nodeId) {
  const h = hash01(nodeId * 7 + 3);
  if (h < 0.4) return 'cop';
  if (h < 0.65) return 'cam';
  return null;
}

/**
 * The whole plan for a city. `plan.approaches[i]` = { id, nodeId, edgeId, dir, tx, tz (travel direction), x, z (the junction),
 * w (road width), k (stop line distance from the junction), group, px, pz (where the signal pole stands), enf }.
 * `plan.byEdge[edgeId * 2 + (dir > 0 ? 0 : 1)]` = approach id or -1.
 */
export function createSignalPlan(city, cfg = SIGNAL) {
  const nodeIds = pickJunctions(city, cfg);
  const approaches = [];
  const nodes = [];
  const byEdge = new Int16Array(city.edges.length * 2).fill(-1);
  for (const nid of nodeIds) {
    const n = city.nodes[nid];
    const info = { id: nid, x: n.x, z: n.z, offset: hash01(nid) * cycleLength(cfg), enf: enforcementFor(nid), approaches: [] };
    for (const eid of n.out) {
      const e = city.edges[eid];
      const dir = e.b === nid ? 1 : -1; // the direction of travel that ARRIVES at this node
      const tx = e.dx * dir;
      const tz = e.dz * dir;
      const k = linkSetback(n, e, e);
      const side = e.w / 2 + 0.9; // the pole stands on the driver's left (pavement side): left = (tz, -tx)
      const a = {
        id: approaches.length, nodeId: nid, edgeId: eid, dir, tx, tz, x: n.x, z: n.z, w: e.w, k,
        group: Math.abs(tx) >= Math.abs(tz) ? 0 : 1, enf: info.enf,
        px: n.x - tx * k + tz * side, pz: n.z - tz * k - tx * side,
      };
      approaches.push(a);
      info.approaches.push(a.id);
      byEdge[eid * 2 + (dir > 0 ? 0 : 1)] = a.id;
    }
    nodes.push(info);
  }
  const nodeOf = new Map(nodes.map((n) => [n.id, n]));
  return { cfg, nodes, approaches, byEdge, nodeOf };
}

/** State (0/1/2) of approach `ai` at game time `t`. */
export function approachState(plan, ai, t) {
  const a = plan.approaches[ai];
  return signalState(t + plan.nodeOf.get(a.nodeId).offset, a.group, plan.cfg);
}

export function approachRedSince(plan, ai, t) {
  const a = plan.approaches[ai];
  return redSince(t + plan.nodeOf.get(a.nodeId).offset, a.group, plan.cfg);
}

export function approachLeft(plan, ai, t) {
  const a = plan.approaches[ai];
  return signalLeft(t + plan.nodeOf.get(a.nodeId).offset, a.group, plan.cfg);
}

/**
 * The controller traffic and the rules use: `ctx.signals`. `time()` is the game clock in seconds.
 *   mustStop(edgeId, dir, dist, speed, sticky): should a vehicle arriving at the end of that edge stop? (no signal there: false)
 *   stateOf(edgeId, dir): 0/1/2, or -1 when the junction has no signal
 */
export function createSignalController(plan, time) {
  const offs = plan.approaches.map((a) => plan.nodeOf.get(a.nodeId).offset);
  const stateAt = (ai, t) => signalState(t + offs[ai], plan.approaches[ai].group, plan.cfg);
  return {
    plan,
    time,
    stateOf(edgeId, dir) {
      const ai = plan.byEdge[edgeId * 2 + (dir > 0 ? 0 : 1)];
      return ai < 0 ? -1 : stateAt(ai, time());
    },
    mustStop(edgeId, dir, dist, speed, sticky = false) {
      const ai = plan.byEdge[edgeId * 2 + (dir > 0 ? 0 : 1)];
      if (ai < 0) return false;
      return mustStop(stateAt(ai, time()), dist, speed, sticky, plan.cfg);
    },
    state: (ai) => stateAt(ai, time()),
    redSince: (ai) => redSince(time() + offs[ai], plan.approaches[ai].group, plan.cfg),
    left: (ai) => signalLeft(time() + offs[ai], plan.approaches[ai].group, plan.cfg),
  };
}
