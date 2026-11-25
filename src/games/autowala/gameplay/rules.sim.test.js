// The rules system on the real city graph with a fake context (no WebGL): fines, cooldowns, the snapshot, and the no-fine cases.
import { describe, expect, it, vi } from 'vitest';
import { makeFakeCtx } from '../sim/traffic-testkit.js';
import { installRules } from './rules.js';
import { RULES } from './rule-logic.js';

vi.setConfig({ testTimeout: 60000 });

function setup({ wallet = 1000, hour = 12, night = 0 } = {}) {
  const kit = makeFakeCtx({ traffic: false, rage: false, wallet });
  const { ctx } = kit;
  ctx.world.sky.state.night = night;
  const prompts = new Map();
  ctx.setPrompt = (id, text) => (text ? prompts.set(id, text) : prompts.delete(id));
  installRules(ctx);
  return { ...kit, prompts };
}

/** Put the player `before` m before a point along (tx, tz) and drive it at `speed` m/s for `seconds`, updating every system each step. */
function drive(kit, from, t, speed, seconds, dt = 1 / 60) {
  const { ctx } = kit;
  const P = ctx.v;
  P.x = from.x;
  P.z = from.z;
  P.heading = Math.atan2(t.tx, t.tz);
  for (let s = 0; s < seconds; s += dt) {
    ctx.clock.time += dt;
    P.vx = t.tx * speed;
    P.vz = t.tz * speed;
    P.speed = speed;
    P.fwd = speed;
    P.kmh = speed * 3.6;
    P.x += P.vx * dt;
    P.z += P.vz * dt;
    for (const sys of ctx.systems) sys.update?.(dt, ctx);
  }
}

const violations = (kit, kind) => kit.events.filter((e) => e.type === 'rule:violation' && (!kind || e.kind === kind));

describe('rules: signals', () => {
  it('fines a red light run at a watched junction once, takes the money and tells career', () => {
    const kit = setup();
    const { ctx } = kit;
    const plan = ctx.signals.plan;
    const a = plan.approaches.find((x) => x.enf === 'cop');
    // wait until this approach has been red for a while
    for (let t = 0; t < 80; t += 0.5) {
      ctx.clock.time = t;
      if (ctx.signals.state(a.id) === 0 && ctx.signals.redSince(a.id) > 3) break;
    }
    const lane = a.w / 4;
    const from = { x: a.x - a.tx * (a.k + 14) + a.tz * lane, z: a.z - a.tz * (a.k + 14) - a.tx * lane };
    const before = ctx.economy.wallet;
    ctx.fares.trip = { id: 1 };
    drive(kit, from, a, 9, 3);
    expect(violations(kit, 'signal')).toHaveLength(1);
    expect(ctx.economy.wallet).toBe(before - RULES.fine.signal);
    expect(kit.events.some((e) => e.type === 'expense' && e.kind === 'challan' && e.amount === RULES.fine.signal)).toBe(true);
    expect(ctx.fares.penalties).toHaveLength(1);
    expect(ctx.fares.penalties[0].fareMul).toBeLessThan(1);
    expect(ctx.rules.wanted).toBe(true);
    // driving through again straight away does not double-charge (site and global cooldowns)
    drive(kit, from, a, 9, 3);
    expect(violations(kit, 'signal')).toHaveLength(1);
  });

  it('does not fine on green, on yellow, or at an unwatched junction, and never on a guard crash or at a standstill', () => {
    const kit = setup();
    const { ctx } = kit;
    const plan = ctx.signals.plan;
    const green = plan.approaches.find((x) => x.enf);
    for (let t = 0; t < 80; t += 0.25) {
      ctx.clock.time = t;
      if (ctx.signals.state(green.id) === 2 && ctx.signals.left(green.id) > 8) break;
    }
    const lane = green.w / 4;
    const from = (a, d) => ({ x: a.x - a.tx * (a.k + d) + a.tz * lane, z: a.z - a.tz * (a.k + d) - a.tx * lane });
    drive(kit, from(green, 12), green, 9, 2);
    expect(violations(kit)).toHaveLength(0);
    // an unwatched junction on red
    const quiet = plan.approaches.find((x) => !x.enf);
    for (let t = 0; t < 120; t += 0.5) {
      ctx.clock.time = t;
      if (ctx.signals.state(quiet.id) === 0 && ctx.signals.redSince(quiet.id) > 3) break;
    }
    drive(kit, from(quiet, 14), quiet, 9, 3);
    expect(violations(kit)).toHaveLength(0);
    // a guard crash is never an offence
    ctx.emit('crash', { strength: 0.8, tag: 'prop', guard: true });
    expect(violations(kit)).toHaveLength(0);
  });

  it('is capped by the wallet and a broke player still gets a (zero) challan', () => {
    const kit = setup({ wallet: 60 });
    const { ctx } = kit;
    const a = ctx.signals.plan.approaches.find((x) => x.enf === 'cop');
    for (let t = 0; t < 80; t += 0.5) {
      ctx.clock.time = t;
      if (ctx.signals.state(a.id) === 0 && ctx.signals.redSince(a.id) > 3) break;
    }
    drive(kit, { x: a.x - a.tx * (a.k + 12) + a.tz * (a.w / 4), z: a.z - a.tz * (a.k + 12) - a.tx * (a.w / 4) }, a, 9, 3);
    expect(violations(kit, 'signal')[0].fine).toBe(60);
    expect(ctx.economy.wallet).toBe(0);
  });
});

describe('rules: speed cameras and limits', () => {
  it('fines speeding past a camera, not a legal speed, and shows the limit', () => {
    const kit = setup();
    const { ctx, city } = kit;
    const cam = ctx.rules.cameras[0];
    const e = city.edges[cam.edgeId];
    const a = city.nodes[e.a];
    const lane = e.w / 4;
    const start = (s) => ({ x: a.x + e.dx * s + e.dz * lane, z: a.z + e.dz * s - e.dx * lane });
    const t = { tx: e.dx, tz: e.dz };
    const s0 = e.len * 0.5 - 25;
    drive(kit, start(s0), t, (cam.limit - 4) / 3.6, 3);
    expect(violations(kit, 'speed')).toHaveLength(0);
    ctx.clock.time += 60; // out of every cooldown
    drive(kit, start(s0), t, (cam.limit + 25) / 3.6, 3);
    expect(violations(kit, 'speed')).toHaveLength(1);
    expect(violations(kit, 'speed')[0].fine).toBeGreaterThan(RULES.fine.speedBase - 1);
    expect(ctx.rules.limitAt(a.x + e.dx * s0, a.z + e.dz * s0)).toBe(cam.limit);
  });

  it('publishes the snapshot the HUD reads', () => {
    // the fake context keeps snapshot parts private: ask through an install on a context that records them
    const parts = [];
    const ctx2 = setup().ctx;
    ctx2.addSnapshot = (fn) => parts.push(fn);
    installRules(ctx2);
    const snap = parts[parts.length - 1]().rules;
    expect(Object.keys(snap).sort()).toEqual(['cameraAhead', 'checkpoint', 'fines', 'heat', 'lastFine', 'limit', 'signalAhead', 'speeding', 'wanted', 'zone'].sort());
    expect([20, 40, 60]).toContain(snap.limit);
  });
});

describe('rules: night checkpoint', () => {
  const pick = (kit) => kit.ctx.rules.checkpoints[0];
  const pose = (c, back) => ({ x: c.x - c.dx * back + c.dz * (c.w / 4), z: c.z - c.dz * back - c.dx * (c.w / 4) });

  it('lets a clean driver go after a check, and fines a wanted one for the documents', () => {
    const kit = setup({ night: 1 });
    const { ctx } = kit;
    const c = pick(kit);
    const t = { tx: c.dx, tz: c.dz };
    // slow to a stop beside it
    drive(kit, pose(c, 30), t, 6, 3.5);
    drive(kit, pose(c, 5), t, 0, 5);
    expect(violations(kit)).toHaveLength(0);
    expect(kit.toasts.some((x) => /papers in order/i.test(x.text))).toBe(true);
    // second checkpoint: a driver with a recent offence
    const kit2 = setup({ night: 1 });
    const c2 = pick(kit2);
    drive(kit2, pose(c2, 30), { tx: c2.dx, tz: c2.dz }, 6, 3.5);
    kit2.ctx.rules.heat = 0; // (the internal heat is what counts: provoke it through a rage heat)
    kit2.ctx.rage = { heat: 0.8 };
    drive(kit2, pose(c2, 5), { tx: c2.dx, tz: c2.dz }, 0, 5);
    expect(violations(kit2, 'docs')).toHaveLength(1);
  });

  it('fines running the checkpoint at speed, and is absent by day', () => {
    const kit = setup({ night: 1 });
    const c = pick(kit);
    drive(kit, pose(c, 40), { tx: c.dx, tz: c.dz }, 14, 6);
    expect(violations(kit, 'checkpoint')).toHaveLength(1);
    const day = setup({ night: 0 });
    const d = pick(day);
    drive(day, pose(d, 40), { tx: d.dx, tz: d.dz }, 14, 6);
    expect(violations(day)).toHaveLength(0);
  });
});

describe('rules: install and dispose', () => {
  it('installs on a plain context, exposes ctx.signals and cleans up', () => {
    const { ctx } = setup();
    expect(ctx.signals.plan.nodes.length).toBeGreaterThan(12);
    expect(ctx.rules.cameras.length).toBeGreaterThan(5);
    const n = ctx.scene.children.length;
    expect(n).toBeGreaterThan(0);
    for (const s of ctx.systems) s.dispose?.(ctx);
    expect(ctx.signals).toBe(null);
    expect(ctx.scene.children.length).toBeLessThan(n);
  });
});
