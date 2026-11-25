import { describe, it, expect } from 'vitest';
import { generateCity } from './layout.js';
import { planMetro } from './metro-routes.js';
import { BENT, planBents, straightPieces } from './metro-pillars.js';

const SEEDS = [1, 7, 8];

/** Distance from a point to the centre line of an edge. */
function distToEdge(city, e, x, z) {
  const a = city.nodes[e.a];
  const t = Math.max(0, Math.min(1, ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len));
  return Math.hypot(x - (a.x + e.dx * e.len * t), z - (a.z + e.dz * e.len * t));
}

describe.each(SEEDS)('viaduct pillars, city seed %i', (seed) => {
  const city = generateCity(seed);
  const plan = planMetro(city);
  // stand-in for the building colliders: every block (the land between roads), shrunk by 3 m, is "inside a building"
  const inBlock = (x, z, r) => city.blocks.some((b) => b.type !== 'water' && x > b.x0 + 3 - r && x < b.x1 - 3 + r && z > b.z0 + 3 - r && z < b.z1 - 3 + r);
  const { bents, pillars } = planBents(city, plan.graph, plan.lines, inBlock);

  it('places plenty of bents on every line', () => {
    for (const l of plan.lines) expect(bents.filter((b) => b.line === l.id).length).toBeGreaterThan(l.id === 'green' ? 8 : 25);
    expect(pillars.length).toBeGreaterThan(80);
  });

  it('never puts a pillar on a road: always outside every carriageway by at least a pillar radius', () => {
    let worst = Infinity;
    for (const p of pillars) for (const e of city.edges) worst = Math.min(worst, distToEdge(city, e, p.x, p.z) - (e.w / 2 + BENT.radius));
    expect(worst).toBeGreaterThanOrEqual(0);
  });

  it('puts the pillars on the verge: road half width + 1 m from the centre line of their own road', () => {
    for (const b of bents) {
      const lx = b.tz;
      const lz = -b.tx;
      for (const sd of [-1, 1]) {
        const x = b.x + lx * b.half * sd;
        const z = b.z + lz * b.half * sd;
        // the nearest road centre line is the bent's own road
        let best = Infinity;
        let width = 0;
        for (const e of city.edges) {
          const d = distToEdge(city, e, x, z);
          if (d < best) {
            best = d;
            width = e.w;
          }
        }
        expect(best).toBeGreaterThanOrEqual(width / 2 + BENT.offset - 0.35);
      }
      expect(b.half).toBeCloseTo(b.w / 2 + BENT.offset, 6);
    }
  });

  it('never stands inside a block (building footprint) and keeps off the lake', () => {
    for (const p of pillars) {
      expect(inBlock(p.x, p.z, BENT.radius)).toBe(false);
      expect(((p.x - city.lake.cx) / city.lake.rx) ** 2 + ((p.z - city.lake.cz) / city.lake.rz) ** 2).toBeGreaterThan(1);
    }
  });

  it('spaces the bents about 28 m apart along a straight piece, with no span much longer than two bays', () => {
    for (const l of plan.lines) {
      const mine = bents.filter((b) => b.line === l.id);
      const sm = l.track.samples;
      for (const piece of straightPieces(l.track)) {
        const a = sm[piece.i0];
        const b = sm[piece.i1];
        if (b.s - a.s < 80) continue;
        const on = mine
          .filter((q) => Math.abs((q.x - a.x) * -a.tz + (q.z - a.z) * a.tx) < 0.5 && (q.x - a.x) * a.tx + (q.z - a.z) * a.tz >= -0.1 && (q.x - a.x) * a.tx + (q.z - a.z) * a.tz <= b.s - a.s + 0.1)
          .map((q) => (q.x - a.x) * a.tx + (q.z - a.z) * a.tz)
          .sort((p, q) => p - q);
        for (let i = 1; i < on.length; i++) {
          expect(on[i] - on[i - 1]).toBeGreaterThan(BENT.spacing * 0.5 - 0.1);
          expect(on[i] - on[i - 1]).toBeLessThanOrEqual(BENT.spacing * 3.1);
        }
      }
    }
  });

  it('pillar height follows the deck: taller under the upper line, flat elsewhere', () => {
    const hs = pillars.map((p) => p.h);
    expect(Math.min(...hs)).toBeCloseTo(11 - BENT.deckDepth - BENT.beamDepth, 6);
    expect(Math.max(...hs)).toBeGreaterThan(14.5);
    for (const b of bents) {
      const p = pillars.find((q) => Math.hypot(q.x - (b.x + b.tz * b.half), q.z - (b.z - b.tx * b.half)) < 1);
      expect(p.h).toBeGreaterThanOrEqual(b.y - BENT.deckDepth - BENT.beamDepth - 1e-6);
    }
  });

  it('the stacked bents of Red and Blue share their pillars', () => {
    const red = bents.filter((b) => b.line === 'red');
    const blue = bents.filter((b) => b.line === 'blue');
    const shared = blue.filter((b) => red.some((r) => Math.hypot(r.x - b.x, r.z - b.z) < 1.5));
    expect(shared.length).toBeGreaterThan(3);
  });
});
