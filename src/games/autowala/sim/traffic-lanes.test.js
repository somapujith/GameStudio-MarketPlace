import { describe, expect, it } from 'vitest';
import { generateCity } from '../world/layout.js';
import { edgeHeading, evalLink, junctionLink, laneCount, lanePoint, laneOffset, leftOfCentre, newLink, uTurnLink } from './traffic-lanes.js';

const city = generateCity(1);

// the driver's left for heading h is (cos h, -sin h)
const leftVec = (h) => ({ x: Math.cos(h), z: -Math.sin(h) });
const fwdVec = (h) => ({ x: Math.sin(h), z: Math.cos(h) });
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const cross = (a, b) => a.x * b.z - a.z * b.x;

describe('lanes: India drives on the LEFT', () => {
  it('a vehicle heading +z (south) drives on the +x side of the centre line, heading -z on the -x side', () => {
    const e = { id: 0, a: 0, b: 1, dx: 0, dz: 1, w: 8, len: 100 };
    const c = { nodes: [{ id: 0, x: 10, z: 0 }, { id: 1, x: 10, z: 100 }] };
    const south = lanePoint(c, e, 1, 0, 50);
    expect(south.heading).toBeCloseTo(0);
    expect(south.x).toBeCloseTo(12); // facing +z, the left hand points to +x
    expect(south.z).toBeCloseTo(50);
    const north = lanePoint(c, e, -1, 0, 50);
    expect(Math.abs(north.heading)).toBeCloseTo(Math.PI);
    expect(north.x).toBeCloseTo(8);
    expect(north.z).toBeCloseTo(50);
  });

  it('every lane point lies to the driver\'s left of the centre line, and opposing vehicles pass on each other\'s right', () => {
    let checked = 0;
    for (const e of city.edges) {
      for (let lane = 0; lane < laneCount(e.w); lane++) {
        const p = lanePoint(city, e, 1, lane, e.len / 2);
        const q = lanePoint(city, e, -1, lane, e.len / 2); // same place along the road, other direction
        // each is on its own left of the centre line
        expect(leftOfCentre(city, e, 1, p.x, p.z)).toBeCloseTo(laneOffset(e.w, lane), 5);
        expect(leftOfCentre(city, e, -1, q.x, q.z)).toBeCloseTo(laneOffset(e.w, lane), 5);
        const lp = leftVec(p.heading);
        const mid = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
        // p is displaced from the centre line along ITS left vector
        const cx = city.nodes[e.a].x + e.dx * e.len * 0.5;
        const cz = city.nodes[e.a].z + e.dz * e.len * 0.5;
        expect((p.x - cx) * lp.x + (p.z - cz) * lp.z).toBeGreaterThan(0);
        // the oncoming vehicle q is on p's RIGHT: cross(forward, q - p) points the way "right" does (forward x left < 0, so right > 0)
        const f = fwdVec(p.heading);
        const rel = { x: q.x - p.x, z: q.z - p.z };
        expect(cross(f, rel)).toBeGreaterThan(0);
        expect(cross(fwdVec(q.heading), { x: p.x - q.x, z: p.z - q.z })).toBeGreaterThan(0);
        expect(Math.hypot(mid.x - cx, mid.z - cz)).toBeLessThan(1e-6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('holds on slanted and curved (Necklace Road) edges too', () => {
    const slanted = { id: 0, a: 0, b: 1, dx: Math.SQRT1_2, dz: -Math.SQRT1_2, w: 14, len: 50, curve: true };
    const c = { nodes: [{ id: 0, x: 0, z: 0 }, { id: 1, x: 50 * Math.SQRT1_2, z: -50 * Math.SQRT1_2 }] };
    for (const dir of [1, -1]) {
      const p = lanePoint(c, slanted, dir, 0, 20);
      const f = fwdVec(p.heading);
      const onCentre = { x: c.nodes[dir > 0 ? 0 : 1].x + slanted.dx * dir * 20, z: c.nodes[dir > 0 ? 0 : 1].z + slanted.dz * dir * 20 };
      // left of the centre line = cross(forward, offset) < 0 in this (x right, z toward the viewer) system
      expect(cross(f, { x: p.x - onCentre.x, z: p.z - onCentre.z })).toBeLessThan(0);
    }
    const necklace = city.edges.filter((e) => e.curve);
    expect(necklace.length).toBeGreaterThan(10);
    for (const e of necklace) {
      const p = lanePoint(city, e, 1, 0, e.len / 2);
      const q = lanePoint(city, e, -1, 0, e.len / 2);
      expect(cross(fwdVec(p.heading), { x: q.x - p.x, z: q.z - p.z })).toBeGreaterThan(0);
    }
  });

  it('heading of an edge matches the game convention (atan2(dx, dz))', () => {
    expect(edgeHeading({ dx: 1, dz: 0 }, 1)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(edgeHeading({ dx: 0, dz: 1 }, -1))).toBeCloseTo(Math.PI);
  });
});

describe('junction links', () => {
  const out = { x: 0, z: 0, heading: 0 };
  const links = [];
  // every (edge in, edge out) pair at every node
  for (const n of city.nodes) {
    for (const i of n.out) {
      const e1 = city.edges[i];
      const dir1 = e1.b === n.id ? 1 : -1;
      for (const j of n.out) {
        if (j === i) continue;
        const e2 = city.edges[j];
        const dir2 = e2.a === n.id ? 1 : -1;
        links.push([e1, dir1, e2, dir2, n]);
      }
    }
  }

  it('starts on the incoming lane line heading the right way and ends on the outgoing one', () => {
    for (const [e1, dir1, e2, dir2] of links.slice(0, 400)) {
      const l = junctionLink(city, e1, dir1, 0, e2, dir2, 0, newLink());
      const s = evalLink(l, 0, out);
      expect(Math.abs(wrap(s.heading - edgeHeading(e1, dir1)))).toBeLessThan(0.02);
      // the start lies at the incoming lane's lateral offset from the incoming centre line
      expect(leftOfCentre(city, e1, dir1, s.x, s.z)).toBeCloseTo(laneOffset(e1.w, 0), 4);
      const t = evalLink(l, l.L, out);
      expect(leftOfCentre(city, e2, dir2, t.x, t.z)).toBeCloseTo(laneOffset(e2.w, 0), 4);
      const dh = wrap(t.heading - edgeHeading(e2, dir2));
      expect(Math.abs(dh)).toBeLessThan(0.05);
      expect(l.L).toBeGreaterThan(0.5);
    }
  });

  it('a 90 degree turn is an arc between the lanes, a right turn is flagged, and the arc has no heading jump', () => {
    // find a plain crossing: node with a pure +x edge and a pure +z edge
    const e1 = { id: 100, a: 0, b: 1, dx: 0, dz: 1, w: 8, len: 60 }; // heading +z into node 1
    const e2 = { id: 101, a: 1, b: 2, dx: -1, dz: 0, w: 8, len: 60 }; // leaves node 1 towards -x (turn to the driver's right)
    const c = { nodes: [{ id: 0, x: 0, z: 0, w: 8 }, { id: 1, x: 0, z: 60, w: 8, out: [] }, { id: 2, x: -60, z: 60, w: 8 }] };
    const l = junctionLink(c, e1, 1, 0, e2, 1, 0, newLink());
    expect(l.right).toBe(true);
    expect(l.angle).toBeCloseTo(Math.PI / 2, 2);
    let prev = evalLink(l, 0, { x: 0, z: 0, heading: 0 }).heading;
    for (let s = 0.5; s <= l.L; s += 0.5) {
      const h = evalLink(l, s, out).heading;
      expect(Math.abs(Math.atan2(Math.sin(h - prev), Math.cos(h - prev)))).toBeLessThan(0.3);
      prev = h;
    }
    // heading falls from 0 to -PI/2 (steering right lowers the heading)
    expect(evalLink(l, l.L, out).heading).toBeCloseTo(-Math.PI / 2, 1);
    const left = junctionLink(c, e1, 1, 0, { id: 102, a: 1, b: 3, dx: 1, dz: 0, w: 8, len: 60 }, 1, 0, newLink());
    expect(left.right).toBe(false);
  });

  it('a U-turn at a dead end swings from the left lane into the opposite lane', () => {
    const e = { id: 0, a: 0, b: 1, dx: 0, dz: 1, w: 8, len: 60 };
    const c = { nodes: [{ id: 0, x: 0, z: 0, w: 8 }, { id: 1, x: 0, z: 60, w: 8 }] };
    const l = junctionLink(c, e, 1, 0, e, -1, 0, newLink());
    const end = evalLink(l, l.L, out);
    expect(Math.abs(end.heading)).toBeCloseTo(Math.PI, 1);
    expect(end.x).toBeCloseTo(-2, 1); // heading north, its left is -x
  });

  it('a mid-road U-turn ends in the opposite lane', () => {
    const e = { id: 0, a: 0, b: 1, dx: 0, dz: 1, w: 8, len: 100 };
    const c = { nodes: [{ id: 0, x: 0, z: 0, w: 8 }, { id: 1, x: 0, z: 100, w: 8 }] };
    const l = uTurnLink(c, e, 1, 0, 30, 0, 8, newLink());
    const a = evalLink(l, 0, out);
    expect(a.x).toBeCloseTo(2);
    const b = evalLink(l, l.L, out);
    expect(b.x).toBeCloseTo(-2);
    expect(b.z).toBeCloseTo(38);
  });
});
