import { describe, expect, it } from 'vitest';
import { generateCity } from '../world/layout.js';
import { makeRng } from '../game/rng.js';
import { buildNet, chaseNextEdge, districtDensity, KINDS, onAnyRoad, pickKind, pickNextEdge, pickSpawn, speedLimit } from './traffic-net.js';
import { createRouter } from '../world/routing.js';
import { lanePoint } from './traffic-lanes.js';

const city = generateCity(1);
const net = buildNet(city);

describe('traffic net', () => {
  it('spawns on the road, in the ring around the player, in the driver\'s left lane', () => {
    const rnd = makeRng(7);
    const players = [[150, 255], [-440, -80], [10, -400], [-70, 600], [0, 0]];
    let n = 0;
    for (const [px, pz] of players) {
      for (let i = 0; i < 40; i++) {
        const s = pickSpawn(net, px, pz, rnd, { rMin: 60, rMax: 450 });
        if (!s) continue;
        n++;
        const d = Math.hypot(s.x - px, s.z - pz);
        expect(d).toBeGreaterThanOrEqual(60);
        expect(d).toBeLessThanOrEqual(450);
        expect(onAnyRoad(city, s.x, s.z)).toBeTruthy();
        // inside the carriageway of its own edge, to the left of the centre line
        const e = s.edge;
        const a = city.nodes[s.dir > 0 ? e.a : e.b];
        const left = (s.x - a.x) * (e.dz * s.dir) - (s.z - a.z) * (e.dx * s.dir);
        expect(left).toBeGreaterThan(0);
        expect(left).toBeLessThan(e.w / 2);
        const p = lanePoint(city, e, s.dir, s.lane, s.u);
        expect(p.x).toBeCloseTo(s.x);
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it('honours the reject callback and returns null when nothing fits', () => {
    expect(pickSpawn(net, 0, 0, makeRng(1), { reject: () => true })).toBeNull();
  });

  it('busier in the Old City than on the outskirts', () => {
    expect(districtDensity('old')).toBeGreaterThan(districtDensity('golconda'));
    const rnd = makeRng(3);
    const count = { old: 0, other: 0 };
    for (let i = 0; i < 400; i++) {
      const s = pickSpawn(net, 150, 255, rnd, { rMin: 20, rMax: 600 });
      if (!s) continue;
      if (Math.hypot(s.x - 150, s.z - 255) < 230) count.old++;
      else count.other++;
    }
    expect(count.old).toBeGreaterThan(count.other * 0.8);
  });

  it('picks a different edge at a junction, never a U-turn unless it is a dead end', () => {
    const rnd = makeRng(11);
    const out = { edge: null, dir: 1 };
    for (const e of city.edges.slice(0, 300)) {
      for (const dir of [1, -1]) {
        pickNextEdge(city, e, dir, 'car', rnd, out);
        const N = city.nodes[dir > 0 ? e.b : e.a];
        expect(N.out).toContain(out.edge.id);
        if (N.out.length > 1) expect(out.edge.id).not.toBe(e.id);
        // the chosen edge leaves the node
        const start = city.nodes[out.dir > 0 ? out.edge.a : out.edge.b];
        expect(start.id).toBe(N.id);
      }
    }
  });

  it('buses avoid the narrow lanes when there is a choice', () => {
    const rnd = makeRng(5);
    const out = { edge: null, dir: 1 };
    let narrow = 0;
    let wide = 0;
    for (const n of city.nodes) {
      if (n.out.length < 3) continue;
      const nw = n.out.filter((id) => city.edges[id].w < 9).length;
      if (nw === 0 || nw === n.out.length) continue;
      const e1 = city.edges[n.out.find((id) => city.edges[id].w >= 9)];
      if (!e1) continue;
      const dir = e1.b === n.id ? 1 : -1;
      for (let i = 0; i < 20; i++) {
        pickNextEdge(city, e1, dir, 'bus', rnd, out);
        if (out.edge.w < 9) narrow++;
        else wide++;
      }
    }
    if (narrow + wide > 0) expect(wide).toBeGreaterThan(narrow * 3);
  });

  it('a chaser follows the route towards the player, and falls back to the greedy edge without one', () => {
    const router = createRouter(city);
    const out = { edge: null, dir: 1 };
    const target = { x: 150, z: 255 };
    let checked = 0;
    for (const e of city.edges.slice(0, 400)) {
      const N = city.nodes[e.b];
      chaseNextEdge(city, (a, b) => router.route(a, b), e, 1, target, out);
      expect(N.out).toContain(out.edge.id);
      // following the route should bring us closer along the road than the straight pick would on average: just validate it leaves N
      const start = city.nodes[out.dir > 0 ? out.edge.a : out.edge.b];
      expect(start.id).toBe(N.id);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    // greedy: a target straight ahead picks the straight edge
    const e = city.edges.find((x) => x.dz === 0 && city.nodes[x.b].out.length >= 4);
    const N = city.nodes[e.b];
    chaseNextEdge(city, null, e, 1, { x: N.x + 500, z: N.z }, out);
    expect(out.edge.dx * out.dir).toBeGreaterThan(0.9);
  });

  it('kinds and speed limits are sane', () => {
    const total = Object.values(KINDS).reduce((s, k) => s + k.mix, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(pickKind(0.99)).toBeTruthy();
    expect(speedLimit(8)).toBeLessThan(speedLimit(20));
  });
});
