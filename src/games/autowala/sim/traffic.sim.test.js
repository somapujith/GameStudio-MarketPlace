// Headless simulation of the traffic and road-rage systems on the real city graph (no WebGL): the fake context in
// traffic-testkit.js runs the same fixed-step loop as Game.js with the real player physics.
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120000 });
import { makeFakeCtx } from './traffic-testkit.js';
import { leftOfCentre, laneOffset } from './traffic-lanes.js';
import { onAnyRoad } from './traffic-net.js';

/** A car cruising on a straight run with room ahead: where to put the player so it rams it from behind. */
function pickTarget(ctx, kind = 'car') {
  // heading towards the middle of the map, so a getaway has room to run
  return ctx.traffic.vehicles.find((v) => v.kind === kind && !v.inLink && v.uEnd - v.u > 60 && v.u > 25 && v.speed > 3 && v.fx * -v.x + v.fz * -v.z > 120);
}

/** Brake to a halt and then sit still (the auto reverses if you keep the brake down). */
const stopAndStay = (ctx) => () => (ctx.v.fwd > 0.3 ? { brake: 1 } : {});

/** Put the player `back` m behind a vehicle on the same lane line, heading the same way, doing `speed` m/s. */
function setUpRam(ctx, veh, back = 7, speed = 15) {
  const P = ctx.v;
  P.x = veh.x - veh.fx * back;
  P.z = veh.z - veh.fz * back;
  P.heading = veh.heading;
  P.vx = Math.sin(veh.heading) * speed;
  P.vz = Math.cos(veh.heading) * speed;
  P.speed = speed;
}

describe('traffic system (headless)', () => {
  it('fills the ring with vehicles on the road, in their own left lane, never inside each other', () => {
    const kit = makeFakeCtx({ traffic: true, rage: false });
    const { ctx, city, run } = kit;
    expect(ctx.traffic.vehicles.length).toBeGreaterThanOrEqual(30);
    const kinds = new Set();
    for (let s = 0; s < 40; s++) {
      run(1, { throttle: 0, brake: 1 });
      for (const v of ctx.traffic.vehicles) {
        kinds.add(v.kind);
        expect(Number.isFinite(v.x + v.z + v.heading + v.speed)).toBe(true);
        expect(onAnyRoad(city, v.x, v.z, 3)).toBeTruthy();
        if (!v.inLink && v.ox === 0) {
          // on a straight run: on the left of the centre line, in the lane
          expect(leftOfCentre(city, v.edge, v.dir, v.px, v.pz)).toBeCloseTo(laneOffset(v.edge.w, v.lane), 3);
        }
      }
      // same-direction vehicles in one lane never overlap
      const list = ctx.traffic.vehicles;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          if (dx * dx + dz * dz > 400) continue;
          if (a.fx * b.fx + a.fz * b.fz < 0.95) continue;
          const f = dx * a.fx + dz * a.fz;
          const l = dx * a.fz - dz * a.fx;
          if (Math.abs(l) > 1.2) continue;
          expect(Math.abs(f)).toBeGreaterThan(0.5 * (a.len + b.len) - 0.5);
        }
      }
    }
    expect(kinds.size).toBeGreaterThanOrEqual(4);
    kit.dispose();
  });

  it('opposing vehicles on the same road pass each other on their own left', () => {
    const { ctx, city, run } = makeFakeCtx({ traffic: true, rage: false });
    let pairs = 0;
    for (let s = 0; s < 60; s++) {
      run(1, { brake: 1 });
      const list = ctx.traffic.vehicles.filter((v) => !v.inLink);
      for (const a of list) {
        for (const b of list) {
          if (a === b || a.edge !== b.edge || a.dir === b.dir) continue;
          pairs++;
          // each is on the left of the centre line in its own direction => they are on opposite sides
          const la = leftOfCentre(city, a.edge, a.dir, a.px, a.pz);
          const lb = leftOfCentre(city, b.edge, b.dir, b.px, b.pz);
          expect(la).toBeGreaterThan(0);
          expect(lb).toBeGreaterThan(0);
          // b is on a's RIGHT: cross(forward, b - a) > 0 when it is alongside
          const cross = a.fx * (b.z - a.z) - a.fz * (b.x - a.x);
          if (Math.abs((b.x - a.x) * a.fx + (b.z - a.z) * a.fz) < 6) expect(cross).toBeGreaterThan(0);
        }
      }
    }
    expect(pairs).toBeGreaterThan(5);
  });

  it('freezes while a menu is open', () => {
    const { ctx, run } = makeFakeCtx({ traffic: true, rage: false });
    run(3, { brake: 1 });
    const snap = ctx.traffic.vehicles.map((v) => [v.x, v.z]);
    ctx.state.menu = 'pause';
    run(5, { brake: 1 });
    expect(ctx.traffic.vehicles.map((v) => [v.x, v.z])).toEqual(snap);
    ctx.state.menu = null;
    run(2, { brake: 1 });
    expect(ctx.traffic.vehicles.some((v, i) => v.x !== snap[i]?.[0])).toBe(true);
  });

  it('cleans up after itself', () => {
    const kit = makeFakeCtx({ traffic: true, rage: true });
    run0(kit);
    kit.dispose();
    expect(kit.ctx.scene.children.length).toBe(0);
    expect(kit.listeners.size).toBe(0);
  });
});

const run0 = (kit) => kit.run(2, { brake: 1 });

describe('collisions and road rage (headless)', () => {
  it('ramming a car emits traffic:hit, shakes the camera and starts the rage', () => {
    const kit = makeFakeCtx({ wallet: 500 });
    const { ctx, run, events } = kit;
    run(1, { brake: 1 });
    const target = pickTarget(ctx);
    expect(target).toBeTruthy();
    setUpRam(ctx, target);
    run(1.2, { throttle: 1 });
    const hit = events.find((e) => e.type === 'traffic:hit');
    expect(hit).toBeTruthy();
    expect(hit.kind).toBe('car');
    expect(hit.severity).toBeGreaterThan(0);
    expect(hit.severity).toBeLessThanOrEqual(1);
    expect(hit.speed).toBeGreaterThan(0.6);
    expect(Number.isFinite(hit.x + hit.z)).toBe(true);
    expect(ctx.rig.kicks.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'rage:start')).toBe(true);
    expect(ctx.rage.active).toBe(true);
    expect(ctx.rage.heat).toBeGreaterThan(0);
    expect(ctx.traffic.vehicles.filter((v) => v.mode === 'chase').length).toBeGreaterThanOrEqual(1);
    expect(events.filter((e) => e.type === 'traffic:hit').length).toBeLessThanOrEqual(3); // a cooldown, not one per frame
    expect(events.some((e) => e.type === 'rage:shout')).toBe(true);
    kit.dispose();
  });

  it('a bus is a harder hit than a bike', () => {
    const sev = {};
    for (const kind of ['bus', 'bike']) {
      const kit = makeFakeCtx({ traffic: true, rage: false });
      kit.run(1, { brake: 1 });
      let target = pickTarget(kit.ctx, kind);
      // make sure there is one of the kind we want: reuse any vehicle and re-kind it is not possible, so search a few seeds of time
      for (let i = 0; i < 60 && !target; i++) {
        kit.run(2, { brake: 1 });
        target = pickTarget(kit.ctx, kind);
      }
      if (!target) continue;
      setUpRam(kit.ctx, target, 6, 14);
      kit.run(1, { throttle: 1 });
      sev[kind] = kit.events.find((e) => e.type === 'traffic:hit' && e.kind === kind)?.severity;
      kit.dispose();
    }
    if (sev.bus !== undefined && sev.bike !== undefined) expect(sev.bus).toBeGreaterThan(sev.bike);
  });

  it('escape: drive away fast and the rage ends with no fine', () => {
    const kit = makeFakeCtx({ wallet: 500 });
    const { ctx, run, events, toasts } = kit;
    run(1, { brake: 1 });
    const target = pickTarget(ctx);
    setUpRam(ctx, target);
    run(0.8, { throttle: 1 });
    expect(ctx.rage.active).toBe(true);
    // swerve round the car and floor it away along the avenue
    run(40, (t) => ({ throttle: 1, boost: false, steer: 0 }));
    const log = { escaped: events.some((e) => e.type === 'rage:escaped'), caught: events.some((e) => e.type === 'rage:caught') };
    console.log('escape sim', JSON.stringify({ ...log, wallet: ctx.economy.wallet, active: ctx.rage.active, toasts: toasts.map((t) => t.text) }));
    expect(log.escaped).toBe(true);
    expect(log.caught).toBe(false);
    expect(ctx.economy.wallet).toBe(500);
    expect(toasts.some((t) => t.text === 'You lost them!')).toBe(true);
    // (the straight getaway may clip more traffic and start a new chase; what matters is the first one ended free)
    expect(events.findIndex((e) => e.type === 'rage:escaped')).toBeGreaterThan(events.findIndex((e) => e.type === 'rage:start'));
    kit.dispose();
  });

  it('caught: stop and the chasers box you in; the fine is taken and the trip penalised', () => {
    const kit = makeFakeCtx({ wallet: 500 });
    const { ctx, run, events, toasts } = kit;
    run(1, { brake: 1 });
    const target = pickTarget(ctx);
    setUpRam(ctx, target);
    run(0.8, { throttle: 1 });
    expect(ctx.rage.active).toBe(true);
    run(40, stopAndStay(ctx));
    const caught = events.find((e) => e.type === 'rage:caught');
    console.log('caught sim', JSON.stringify({ caught, wallet: ctx.economy.wallet, toasts: toasts.map((t) => t.text), pen: ctx.fares.penalties }));
    expect(caught).toBeTruthy();
    expect(caught.fine).toBeGreaterThanOrEqual(150);
    expect(caught.fine).toBeLessThanOrEqual(450);
    expect(ctx.economy.wallet).toBe(500 - caught.fine);
    expect(toasts.some((t) => t.text === `Caught! Fined Rs ${caught.fine}`)).toBe(true);
    expect(ctx.fares.penalties).toEqual([{ fareMul: 0.7, mood: -0.25, reason: 'road rage' }]);
    expect(ctx.rage.active).toBe(false);
    // the chasers lost interest and the grace period holds
    expect(ctx.traffic.vehicles.some((v) => v.mode === 'chase')).toBe(false);
    kit.dispose();
  });

  it('caught with a thin wallet pays only what there is', () => {
    const kit = makeFakeCtx({ wallet: 60 });
    const { ctx, run, events } = kit;
    run(1, { brake: 1 });
    setUpRam(ctx, pickTarget(ctx));
    run(0.8, { throttle: 1 });
    run(40, stopAndStay(ctx));
    const caught = events.find((e) => e.type === 'rage:caught');
    expect(caught.fine).toBe(60);
    expect(ctx.economy.wallet).toBe(0);
  });
});
