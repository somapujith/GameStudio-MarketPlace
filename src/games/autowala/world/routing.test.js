import { describe, it, expect } from 'vitest';
import { generateCity } from './layout.js';
import { createRouter, findRoute, routeLength, nextTurn, pointAlong } from './routing.js';
import { makeRng } from '../game/rng.js';

const SEEDS = [1, 2, 7, 42];
const cities = new Map(SEEDS.map((s) => [s, generateCity(s)]));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Largest connected component of the road graph, as a Set of node ids (the routes we can ask for). */
function mainComponent(city) {
  const seen = new Int32Array(city.nodes.length).fill(-1);
  let bestId = -1;
  let bestSize = 0;
  let id = 0;
  for (const n of city.nodes) {
    if (seen[n.id] >= 0) continue;
    const stack = [n.id];
    seen[n.id] = id;
    let size = 0;
    while (stack.length) {
      const u = stack.pop();
      size++;
      for (const eid of city.nodes[u].out) {
        const e = city.edges[eid];
        const v = e.a === u ? e.b : e.a;
        if (seen[v] < 0) {
          seen[v] = id;
          stack.push(v);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestId = id;
    }
    id++;
  }
  return { seen, bestId, bestSize };
}

describe('findRoute on the generated city', () => {
  it('the road network is one connected piece (or nearly)', () => {
    for (const [seed, city] of cities) {
      const { bestSize } = mainComponent(city);
      expect(bestSize / city.nodes.length, `seed ${seed}`).toBeGreaterThan(0.95);
    }
  });

  it('connects every pair of points of interest in seed 1', () => {
    const city = cities.get(1);
    const pois = city.pois;
    expect(pois.length).toBeGreaterThan(8);
    for (const a of pois) {
      for (const b of pois) {
        if (a === b) continue;
        const r = findRoute(city, a.front || a, b.front || b);
        expect(r.length, `${a.id} -> ${b.id}`).toBeGreaterThan(1);
      }
    }
  });

  for (const seed of SEEDS) {
    it(`random point pairs, seed ${seed}: sane length, ends near the request, deterministic`, () => {
      const city = cities.get(seed);
      const rng = makeRng(1000 + seed);
      const H = city.half - 30;
      const router = createRouter(city);
      let routed = 0;
      for (let i = 0; i < 60; i++) {
        const a = { x: rng.range(-H, H), z: rng.range(-H, H) };
        const b = { x: rng.range(-H, H), z: rng.range(-H, H) };
        const na = router.nearest(a.x, a.z);
        const nb = router.nearest(b.x, b.z);
        const r = router.route(a, b);
        if (!r.length) continue; // an island of the graph: allowed, checked by the connectivity test above
        routed++;
        expect(dist(r[0], na)).toBeLessThan(0.5);
        expect(dist(r[r.length - 1], nb)).toBeLessThan(0.5);
        const len = routeLength(r);
        const straight = dist(na, nb);
        expect(len).toBeGreaterThanOrEqual(straight - 1e-6);
        expect(len).toBeLessThanOrEqual(Math.max(straight * 3, straight + 120));
        // the polyline really follows the roads: every vertex is on (or at the end of) a road edge
        for (const p of r) expect(router.nearest(p.x, p.z).dist).toBeLessThan(0.3);
        // same question, same answer
        expect(router.route(a, b)).toEqual(r);
        expect(findRoute(city, a, b)).toEqual(r);
      }
      expect(routed).toBeGreaterThan(40);
    });
  }

  it('routes are symmetric in length', () => {
    const city = cities.get(1);
    const rng = makeRng(5);
    for (let i = 0; i < 30; i++) {
      const a = { x: rng.range(-600, 600), z: rng.range(-600, 600) };
      const b = { x: rng.range(-600, 600), z: rng.range(-600, 600) };
      const ab = routeLength(findRoute(city, a, b));
      const ba = routeLength(findRoute(city, b, a));
      expect(Math.abs(ab - ba)).toBeLessThan(1e-6);
    }
  });

  it('uses partial edges at both ends and the same-edge shortcut', () => {
    const city = cities.get(1);
    const { seen, bestId } = mainComponent(city);
    const e = city.edges.find((x) => x.len > 60 && x.w < 12 && seen[x.a] === bestId);
    const a = city.nodes[e.a];
    const p1 = { x: a.x + e.dx * 10, z: a.z + e.dz * 10 };
    const p2 = { x: a.x + e.dx * 40, z: a.z + e.dz * 40 };
    const r = findRoute(city, p1, p2);
    expect(r).toHaveLength(2);
    expect(routeLength(r)).toBeCloseTo(30, 3);
    // from the middle of one edge to a far place: the first leg is a partial edge, not a whole one
    const far = city.poiById.airport; // (the block centre: routing snaps it to the nearest road)
    const long = findRoute(city, p1, far);
    expect(long.length).toBeGreaterThan(3);
    expect(dist(long[0], p1)).toBeLessThan(0.01); // starts mid-edge, not at a junction
  });

  it('unreachable or empty input gives []', () => {
    const city = cities.get(1);
    expect(findRoute(null, { x: 0, z: 0 }, { x: 1, z: 1 })).toEqual([]);
    expect(findRoute(city, null, { x: 1, z: 1 })).toEqual([]);
    expect(findRoute(city, { x: NaN, z: 0 }, { x: 1, z: 1 })).toEqual([]);
    expect(findRoute({ nodes: [], edges: [] }, { x: 0, z: 0 }, { x: 5, z: 5 })).toEqual([]);
    // two islands: no way across
    const island = {
      nodes: [
        { id: 0, x: 0, z: 0, out: [0] }, { id: 1, x: 100, z: 0, out: [0] },
        { id: 2, x: 0, z: 500, out: [1] }, { id: 3, x: 100, z: 500, out: [1] },
      ],
      edges: [
        { id: 0, a: 0, b: 1, len: 100, w: 10, dx: 1, dz: 0 },
        { id: 1, a: 2, b: 3, len: 100, w: 10, dx: 1, dz: 0 },
      ],
    };
    expect(findRoute(island, { x: 10, z: 0 }, { x: 10, z: 500 })).toEqual([]);
    expect(findRoute(island, { x: 10, z: 3 }, { x: 90, z: -3 })).toHaveLength(2);
  });

  it('is fast enough to call every half second (graph size and time)', () => {
    const city = cities.get(1);
    const router = createRouter(city);
    const rng = makeRng(99);
    const qs = [];
    for (let i = 0; i < 200; i++) qs.push([{ x: rng.range(-650, 650), z: rng.range(-650, 650) }, { x: rng.range(-650, 650), z: rng.range(-650, 650) }]);
    for (let i = 0; i < 20; i++) router.route(qs[i][0], qs[i][1]); // warm up
    const t0 = performance.now();
    for (const [a, b] of qs) router.route(a, b);
    const per = (performance.now() - t0) / qs.length;
    console.log(`routing: ${city.nodes.length} nodes, ${city.edges.length} edges, ${per.toFixed(3)} ms per query`);
    expect(per).toBeLessThan(2);
  });
});

describe('routeLength / pointAlong', () => {
  const pts = [{ x: 0, z: 0 }, { x: 0, z: -30 }, { x: 40, z: -30 }];
  it('adds the legs', () => {
    expect(routeLength(pts)).toBe(70);
    expect(routeLength([])).toBe(0);
    expect(routeLength(null)).toBe(0);
  });
  it('walks along the line', () => {
    expect(pointAlong(pts, 10)).toEqual({ x: 0, z: -10 });
    expect(pointAlong(pts, 50)).toEqual({ x: 20, z: -30 });
    expect(pointAlong(pts, 999)).toEqual({ x: 40, z: -30 });
  });
});

describe('nextTurn (steering right = heading DECREASES, north is -z)', () => {
  const NORTH = Math.PI; // facing -z
  const north = [{ x: 0, z: 0 }, { x: 0, z: -50 }];
  it('heading north then going east is a RIGHT turn', () => {
    const t = nextTurn([...north, { x: 50, z: -50 }], NORTH);
    expect(t.dir).toBe('right');
    expect(t.distance).toBeCloseTo(50, 6);
    expect(t.angle).toBeCloseTo(-Math.PI / 2, 6);
  });
  it('heading north then going west is a LEFT turn', () => {
    const t = nextTurn([...north, { x: -50, z: -50 }], NORTH);
    expect(t.dir).toBe('left');
    expect(t.angle).toBeCloseTo(Math.PI / 2, 6);
  });
  it('facing +z (heading 0): going to +x is a LEFT turn (the driver faces south, east is on the left)', () => {
    const t = nextTurn([{ x: 0, z: 0 }, { x: 0, z: 40 }, { x: 40, z: 40 }], 0);
    expect(t.dir).toBe('left');
  });
  it('straight ahead reports the distance left', () => {
    const t = nextTurn([{ x: 0, z: 0 }, { x: 0, z: -20 }, { x: 0, z: -90 }], NORTH);
    expect(t.dir).toBe('straight');
    expect(t.distance).toBeCloseTo(90, 6);
  });
  it('a route that starts behind the player is a U-turn', () => {
    const t = nextTurn([{ x: 0, z: 0 }, { x: 0, z: 60 }, { x: 40, z: 60 }], NORTH);
    expect(t.dir).toBe('uturn');
  });
  it('small bends add up along a curve (the promenade) until they matter', () => {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i * 8 * Math.PI) / 180; // 8 degrees per vertex, turning left from heading north
      pts.push({ x: -Math.sin(a) * 100 + 0, z: -Math.cos(a) * 100 });
    }
    // points on a circle of radius 100 around (0, 0) starting at (0,-100), going counter-clockwise on screen = left
    const t = nextTurn(pts.map((p) => ({ x: p.x, z: p.z })), NORTH, { minAngle: 0.55 });
    expect(['left', 'right']).toContain(t.dir);
    expect(Math.abs(t.angle)).toBeGreaterThanOrEqual(0.55);
  });
  it('degenerate input is straight, never a throw', () => {
    expect(nextTurn([], 0).dir).toBe('straight');
    expect(nextTurn(null, 0).dir).toBe('straight');
    expect(nextTurn([{ x: 1, z: 1 }], 0).dir).toBe('straight');
  });
});
