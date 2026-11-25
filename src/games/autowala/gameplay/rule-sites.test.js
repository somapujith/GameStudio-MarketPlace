import { describe, expect, it } from 'vitest';
import { generateCity } from '../world/layout.js';
import { createSignalPlan } from '../world/signal-logic.js';
import { onAnyRoad } from '../sim/traffic-net.js';
import { edgePoint, planRuleSites } from './rule-sites.js';

const city = generateCity(1);
const plan = createSignalPlan(city);
const sites = planRuleSites(city, plan.nodes);

describe('rule sites', () => {
  it('has cameras on the fast roads, school zones and a few night checkpoints', () => {
    expect(sites.cameras.length).toBeGreaterThanOrEqual(8);
    expect(sites.schools.length).toBeGreaterThanOrEqual(2);
    expect(sites.checkpoints.length).toBeGreaterThanOrEqual(2);
    expect(sites.cameras.some((c) => c.limit === 60)).toBe(true);
    expect(sites.cameras.some((c) => c.zone === 'city')).toBe(true);
  });
  it('puts every timed site ON a road (the player can reach it without a kerb)', () => {
    for (const s of [...sites.cameras, ...sites.checkpoints, ...sites.schools]) expect(onAnyRoad(city, s.x, s.z, -1)).toBeTruthy();
  });
  it('keeps clear of signalled junctions and of each other', () => {
    for (const s of [...sites.cameras, ...sites.checkpoints]) {
      for (const n of plan.nodes) expect(Math.hypot(n.x - s.x, n.z - s.z)).toBeGreaterThan(40);
    }
    for (let i = 0; i < sites.cameras.length; i++) {
      for (let j = i + 1; j < sites.cameras.length; j++) {
        expect(Math.hypot(sites.cameras[i].x - sites.cameras[j].x, sites.cameras[i].z - sites.cameras[j].z)).toBeGreaterThan(90);
      }
    }
  });
  it('is deterministic per city', () => {
    expect(planRuleSites(city, plan.nodes)).toEqual(sites);
  });
  it('edgePoint stands beside the road on the driver\'s left for either direction', () => {
    const e = city.edges.find((x) => x.len > 60 && Math.abs(x.dx) === 1);
    const a = edgePoint(city, e, 30, e.w / 2 + 1, 1);
    const b = edgePoint(city, e, 30, e.w / 2 + 1, -1);
    const lat = (p) => Math.abs((p.x - city.nodes[e.a].x) * e.dz - (p.z - city.nodes[e.a].z) * e.dx);
    expect(lat(a)).toBeCloseTo(e.w / 2 + 1, 5);
    expect(lat(b)).toBeCloseTo(e.w / 2 + 1, 5);
    // opposite directions put it on opposite sides of the road
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(e.w + 2, 5);
  });
});
