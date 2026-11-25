import { describe, expect, it } from 'vitest';
import { generateCity } from './layout.js';
import {
  GREEN, RED, SIGNAL, YELLOW, approachState, createSignalController, createSignalPlan, cycleLength, enforcementFor, mustStop, pickJunctions,
  signalLeft, signalState, redSince,
} from './signal-logic.js';

const city = generateCity(1);
const plan = createSignalPlan(city);

describe('phase clock', () => {
  const C = cycleLength();
  it('cycles green, yellow, red and group 1 runs half a cycle behind', () => {
    expect(signalState(0, 0)).toBe(GREEN);
    expect(signalState(SIGNAL.green + 0.5, 0)).toBe(YELLOW);
    expect(signalState(SIGNAL.green + SIGNAL.yellow + 0.5, 0)).toBe(RED);
    expect(signalState(C + 1, 0)).toBe(GREEN);
    expect(signalState(C / 2 + 1, 1)).toBe(GREEN);
    expect(signalState(1, 1)).toBe(RED);
  });
  it('never shows green to both groups, and each group gets a clearance', () => {
    let greens = 0;
    for (let t = 0; t < C * 2; t += 0.25) {
      const a = signalState(t, 0);
      const b = signalState(t, 1);
      expect(a === GREEN && b === GREEN).toBe(false);
      if (a === GREEN || b === GREEN) greens++;
      // a group turning green means the other has been red for the allRed clearance
      if (a === GREEN && signalState(t - 0.25, 0) !== GREEN) expect(signalState(t - SIGNAL.allRed + 0.1, 1)).toBe(RED);
    }
    expect(greens).toBeGreaterThan(0);
  });
  it('every group gets green within a cycle (no starvation)', () => {
    for (const g of [0, 1]) {
      let got = false;
      for (let t = 0; t < C; t += 0.5) if (signalState(t, g) === GREEN) got = true;
      expect(got).toBe(true);
    }
  });
  it('signalLeft counts down to the next change', () => {
    expect(signalLeft(0, 0)).toBeCloseTo(SIGNAL.green, 5);
    expect(signalLeft(SIGNAL.green, 0)).toBeCloseTo(SIGNAL.yellow, 5);
    expect(signalLeft(SIGNAL.green + SIGNAL.yellow, 0)).toBeCloseTo(C - SIGNAL.green - SIGNAL.yellow, 5);
  });
  it('redSince counts the seconds of red', () => {
    expect(redSince(1, 0)).toBe(0);
    expect(redSince(SIGNAL.green + SIGNAL.yellow + 4, 0)).toBeCloseTo(4, 5);
    expect(redSince(C - 0.5, 0)).toBeCloseTo(C - SIGNAL.green - SIGNAL.yellow - 0.5, 5);
  });
  it('is stable for negative and huge times', () => {
    expect(signalState(-3, 0)).toBe(signalState(C - 3, 0));
    expect([0, 1, 2]).toContain(signalState(1e7, 1));
  });
});

describe('mustStop', () => {
  it('green never stops, a standing driver always stops on yellow or red', () => {
    expect(mustStop(GREEN, 5, 14)).toBe(false);
    expect(mustStop(RED, 1, 0)).toBe(true);
    expect(mustStop(YELLOW, 1, 0)).toBe(true);
  });
  it('a driver too close to stop is committed', () => {
    expect(mustStop(YELLOW, 5, 14)).toBe(false); // 14 m/s needs 21 m at 4.5 m/s2
    expect(mustStop(YELLOW, 15, 14)).toBe(false);
    expect(mustStop(YELLOW, 15, 14, true)).toBe(true); // already braking: only a stop out of reach is given up
    expect(mustStop(YELLOW, 40, 14)).toBe(true);
    expect(mustStop(RED, 40, 14)).toBe(true);
  });
});

describe('junction choice', () => {
  it('picks a few dozen wide junctions, spread out, deterministic', () => {
    const ids = pickJunctions(city);
    expect(ids.length).toBeGreaterThanOrEqual(24);
    expect(ids.length).toBeLessThanOrEqual(SIGNAL.max);
    expect(pickJunctions(city)).toEqual(ids);
    for (let i = 0; i < ids.length; i++) {
      const a = city.nodes[ids[i]];
      expect(a.w >= SIGNAL.minWidth2 && a.out.length >= 3).toBe(true);
      for (let j = i + 1; j < ids.length; j++) {
        const b = city.nodes[ids[j]];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(SIGNAL.spacing);
      }
    }
  });
  it('some junctions have a cop, some a camera, some nobody', () => {
    const kinds = new Set(plan.nodes.map((n) => n.enf));
    expect(kinds.has('cop')).toBe(true);
    expect(kinds.has('cam')).toBe(true);
    expect(enforcementFor(5)).toBe(enforcementFor(5));
  });
});

describe('plan', () => {
  it('has one approach per arriving road, with a stop line short of the junction and a pole on the pavement side', () => {
    expect(plan.approaches.length).toBeGreaterThan(plan.nodes.length * 2);
    for (const a of plan.approaches) {
      const e = city.edges[a.edgeId];
      expect(plan.byEdge[a.edgeId * 2 + (a.dir > 0 ? 0 : 1)]).toBe(a.id);
      expect(Math.hypot(a.tx, a.tz)).toBeCloseTo(1, 5);
      const arrives = a.dir > 0 ? e.b : e.a;
      expect(arrives).toBe(a.nodeId);
      expect(a.k).toBeGreaterThan(1.4);
      expect(a.k).toBeLessThan(e.len);
      // the pole is beside the road (its distance from the road's centre line is more than half the width)
      const n = city.nodes[a.nodeId];
      const lat = Math.abs((a.px - n.x) * e.dz - (a.pz - n.z) * e.dx);
      expect(lat).toBeGreaterThan(e.w / 2);
    }
  });
  it('opposite approaches of a straight road share a group; crossing roads do not', () => {
    for (const n of plan.nodes) {
      const g = n.approaches.map((i) => plan.approaches[i]);
      for (const a of g) for (const b of g) {
        const dot = a.tx * b.tx + a.tz * b.tz;
        if (Math.abs(dot) > 0.99) expect(a.group).toBe(b.group);
        if (Math.abs(dot) < 0.01) expect(a.group).not.toBe(b.group);
      }
    }
  });
  it('the controller answers by edge and direction and ignores unsignalled roads', () => {
    let t = 0;
    const sc = createSignalController(plan, () => t);
    const a = plan.approaches[0];
    expect(sc.stateOf(a.edgeId, a.dir)).toBe(approachState(plan, 0, 0));
    t = 7;
    expect(sc.stateOf(a.edgeId, a.dir)).toBe(approachState(plan, 0, 7));
    const free = city.edges.find((e) => plan.byEdge[e.id * 2] < 0 && plan.byEdge[e.id * 2 + 1] < 0);
    expect(sc.stateOf(free.id, 1)).toBe(-1);
    expect(sc.mustStop(free.id, 1, 50, 0)).toBe(false);
  });
});
