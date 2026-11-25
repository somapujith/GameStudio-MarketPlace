// Traffic obeys the signals (ctx.signals from world/signal-logic.js) and never deadlocks at them. Headless, on the real city graph.
import { describe, expect, it, vi } from 'vitest';
import { makeFakeCtx } from './traffic-testkit.js';
import { createSignalController, createSignalPlan, SIGNAL, signalState, RED } from '../world/signal-logic.js';

vi.setConfig({ testTimeout: 120000 });

function setup() {
  const kit = makeFakeCtx({ traffic: true, rage: false });
  const plan = createSignalPlan(kit.city);
  // park the player on a quiet spot: 150 m up a signalled road from its junction
  const a = plan.approaches.find((p) => kit.city.edges[p.edgeId].len > 200) || plan.approaches[0];
  kit.ctx.signals = createSignalController(plan, () => kit.ctx.clock.time);
  const P = kit.ctx.v;
  P.x = a.x - a.tx * 150;
  P.z = a.z - a.tz * 150;
  P.heading = Math.atan2(a.tx, a.tz);
  P.vx = P.vz = P.speed = 0;
  return { ...kit, plan };
}

describe('traffic and signals', () => {
  it('stops for red, goes on green, and keeps flowing (no deadlock)', () => {
    const { ctx, run, plan } = setup();
    const seen = new Map(); // vehicle -> was in link last frame
    const entries = { total: 0, onRed: 0 };
    let waitingGreen = 0;
    let worstWait = 0;
    const waitT = new Map();
    for (let s = 0; s < 150 * 4; s++) {
      run(0.25, { brake: 1 });
      const t = ctx.clock.time;
      for (const v of ctx.traffic.vehicles) {
        const was = seen.get(v);
        seen.set(v, v.inLink);
        if (v.inLink && was === false && v.link.node >= 0 && !v.chase && t > 10) { // (the first seconds are the primed spawn)
          const ai = plan.byEdge[v.fromEdge.id * 2 + (v.fromDir > 0 ? 0 : 1)];
          if (ai >= 0) {
            entries.total++;
            const a = plan.approaches[ai];
            const off = plan.nodeOf.get(a.nodeId).offset;
            // entering is fine on green or a yellow; on red only if it turned red a moment ago (the driver could not stop any more)
            if (signalState(t + off - 2.5, a.group) === RED && signalState(t + off, a.group) === RED) entries.onRed++;
          }
        }
        // a vehicle standing at a line while its light is green must not stay there
        if (!v.inLink && v.speed < 0.3 && v.uEnd - v.u < 30) {
          const ai = plan.byEdge[v.edge.id * 2 + (v.dir > 0 ? 0 : 1)];
          if (ai >= 0 && ctx.signals.state(ai) === 2) {
            const w = (waitT.get(v) || 0) + 0.25;
            waitT.set(v, w);
            worstWait = Math.max(worstWait, w);
            if (w > 20) waitingGreen++;
          } else waitT.delete(v);
        }
      }
    }
    expect(entries.total).toBeGreaterThan(10);
    expect(entries.onRed / entries.total).toBeLessThan(0.08);
    expect(waitingGreen).toBe(0);
    expect(worstWait).toBeLessThan(25);
  });

  it('cars actually queue at a red: some stand still at a line and later move off', () => {
    const { ctx, run, plan } = setup();
    let stoppedAtRed = 0;
    let movedOff = 0;
    const was = new Map();
    for (let s = 0; s < 120 * 4; s++) {
      run(0.25, { brake: 1 });
      for (const v of ctx.traffic.vehicles) {
        if (v.inLink || v.chase) continue;
        const ai = plan.byEdge[v.edge.id * 2 + (v.dir > 0 ? 0 : 1)];
        if (ai < 0 || v.uEnd - v.u > 20) continue;
        const st = ctx.signals.state(ai);
        if (v.speed < 0.3 && st === RED && !was.get(v)) { stoppedAtRed++; was.set(v, true); }
        if (was.get(v) && st === 2 && v.speed > 2) { movedOff++; was.set(v, false); }
      }
    }
    expect(stoppedAtRed).toBeGreaterThan(2);
    expect(movedOff).toBeGreaterThan(0);
  });

  it('without ctx.signals traffic behaves as before (cars never wait for a light)', () => {
    const kit = makeFakeCtx({ traffic: true, rage: false });
    kit.run(30, { brake: 1 });
    expect(kit.ctx.traffic.vehicles.length).toBeGreaterThan(20);
    expect(kit.ctx.traffic.vehicles.some((v) => v.red)).toBe(false);
  });

  it('the cycle is longer than a red phase wait budget', () => {
    expect(SIGNAL.green + SIGNAL.yellow + SIGNAL.allRed).toBeLessThan(25);
  });
});
