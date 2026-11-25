import { describe, it, expect } from 'vitest';
import { generateCity } from './layout.js';
import { METRO, inLake, planMetro, trackClearsLake } from './metro-routes.js';
import { nearestOnTrack, pointAt } from './metro-track.js';
import { LINE_COLORS, LINE_NAMES } from './metro-names.js';

// the planner is tuned for the real city (seed 1); two more seeds prove it is not hard-wired to one layout
const SEEDS = [1, 7, 8];
const plans = new Map(SEEDS.map((s) => [s, { city: generateCity(s), plan: null }]));
for (const v of plans.values()) v.plan = planMetro(v.city);

describe.each(SEEDS)('metro plan, city seed %i', (seed) => {
  const { city, plan } = plans.get(seed);
  const byId = Object.fromEntries(plan.lines.map((l) => [l.id, l]));

  it('has the three lines with the real colours and names', () => {
    expect(plan.lines.map((l) => l.id)).toEqual(['red', 'blue', 'green']);
    for (const l of plan.lines) {
      expect(l.color).toBe(LINE_COLORS[l.id]);
      expect(l.name).toBe(LINE_NAMES[l.id].name);
    }
  });

  for (const id of ['red', 'blue', 'green']) {
    describe(`${id} line`, () => {
      const line = byId[id];
      it('is one connected route along existing roads (no jumps, no U-turns)', () => {
        const steps = line.steps;
        expect(steps.length).toBeGreaterThan(8);
        for (let i = 0; i < steps.length - 1; i++) expect(steps[i].to).toBe(steps[i + 1].from);
        for (const st of steps) {
          const e = city.edges[st.e];
          expect([e.a, e.b]).toContain(st.from);
          expect([e.a, e.b]).toContain(st.to);
          expect(e.w).toBeGreaterThanOrEqual(10); // arterials and avenues, never the lanes
        }
        const nodes = [steps[0].from, ...steps.map((s) => s.to)];
        expect(new Set(nodes).size).toBe(nodes.length); // never crosses itself
      });
      it('stays inside the map and out of the lake', () => {
        for (const p of line.track.samples) {
          expect(Math.abs(p.x)).toBeLessThanOrEqual(city.half);
          expect(Math.abs(p.z)).toBeLessThanOrEqual(city.half);
          expect(inLake(city, p.x, p.z, 0)).toBe(false);
        }
        expect(trackClearsLake(city, line.track)).toBe(true);
      });
      it('is a smooth track: samples are close together and the heading changes gradually', () => {
        const sm = line.track.samples;
        for (let i = 0; i < sm.length - 1; i++) {
          const d = Math.hypot(sm[i + 1].x - sm[i].x, sm[i + 1].z - sm[i].z);
          expect(d).toBeLessThan(12.5);
          const dot = sm[i].tx * sm[i + 1].tx + sm[i].tz * sm[i + 1].tz;
          expect(dot).toBeGreaterThan(0.92); // < ~23 degrees between neighbouring samples
        }
        expect(line.track.length).toBeGreaterThan(500);
      });
      it('has stations with unique ids, both names and sane spacing', () => {
        const st = line.stations;
        expect(st.length).toBeGreaterThanOrEqual(id === 'green' ? 2 : 4);
        expect(new Set(st.map((s) => s.id)).size).toBe(st.length);
        expect(new Set(st.map((s) => s.name)).size).toBe(st.length);
        for (const s of st) {
          expect(s.name.length).toBeGreaterThan(2);
          expect(/[ఀ-౿]/.test(s.te)).toBe(true);
          expect(s.line).toBe(id);
          expect(s.front).toEqual(expect.objectContaining({ x: expect.any(Number), z: expect.any(Number), edge: expect.any(Number) }));
        }
        expect(st[0].name).toBe(LINE_NAMES[id].from);
        expect(st[st.length - 1].name).toBe(LINE_NAMES[id].to);
        for (let i = 1; i < st.length; i++) {
          const gap = st[i].s - st[i - 1].s;
          expect(gap).toBeGreaterThanOrEqual(METRO.minGap - 1);
          expect(gap).toBeLessThanOrEqual(1100);
        }
        // names follow the real order of the line
        const pool = LINE_NAMES[id].pool.map((p) => p.en);
        const idx = st.map((s) => pool.indexOf(s.name));
        expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      });
      it('puts every station on a straight, level piece, with its front on the road', () => {
        for (const s of line.stations) {
          for (let d = -METRO.stationHalf; d <= METRO.stationHalf; d += 4) {
            const p = pointAt(line.track, s.s + d);
            expect(Math.abs(p.tx * s.tx + p.tz * s.tz)).toBeGreaterThan(0.9999);
            expect(Math.abs(p.y - s.y)).toBeLessThan(0.02);
          }
          const e = city.edges[s.front.edge];
          const a = city.nodes[e.a];
          const off = Math.abs((s.front.x - a.x) * -e.dz + (s.front.z - a.z) * e.dx);
          expect(off).toBeLessThan(0.01); // exactly on the centre line of its road
          expect(Math.hypot(s.front.x - s.x, s.front.z - s.z)).toBeLessThan(1.5);
        }
      });
    });
  }

  it('has exactly two interchanges: Ameerpet (Red + Blue) and MG Bus Station (Red + Green)', () => {
    const names = plan.interchanges.map((i) => i.name).sort();
    expect(names).toEqual(['Ameerpet', 'MG Bus Station']);
    const ameer = plan.interchanges.find((i) => i.name === 'Ameerpet');
    expect(ameer.lines.sort()).toEqual(['blue', 'red']);
    expect(ameer.kind).toBe('stack');
    const mg = plan.interchanges.find((i) => i.name === 'MG Bus Station');
    expect(mg.lines.sort()).toEqual(['green', 'red']);
    // flagged on the stations, and only on those
    const flagged = plan.lines.flatMap((l) => l.stations.filter((s) => s.interchange));
    expect(flagged.map((s) => s.name).sort()).toEqual(['Ameerpet', 'Ameerpet', 'MG Bus Station', 'MG Bus Station']);
    // the two halves of an interchange stand together
    const all = plan.lines.flatMap((l) => l.stations);
    for (const ic of plan.interchanges) {
      const halves = all.filter((s) => s.name === ic.name);
      expect(halves).toHaveLength(2);
      expect(Math.hypot(halves[0].x - halves[1].x, halves[0].z - halves[1].z)).toBeLessThan(120);
    }
    // station names are never reused outside an interchange
    const counts = new Map();
    for (const s of all) counts.set(s.name, (counts.get(s.name) || 0) + 1);
    for (const [n, c] of counts) expect(c).toBe(n === 'Ameerpet' || n === 'MG Bus Station' ? 2 : 1);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
  });

  it('Blue stacks above Red at Ameerpet; elsewhere the lines never meet', () => {
    const red = byId.red;
    const blue = byId.blue;
    const ameer = plan.interchanges.find((i) => i.name === 'Ameerpet');
    const rs = red.stations.find((s) => s.name === 'Ameerpet');
    const bs = blue.stations.find((s) => s.name === 'Ameerpet');
    expect(rs.y).toBe(METRO.railY);
    expect(bs.y).toBeCloseTo(METRO.upperY, 6);
    expect(bs.y - rs.y).toBeGreaterThan(7);
    // wherever two lines are within a deck width of each other horizontally they are either far apart vertically or at an interchange
    const pairs = [[red, blue], [red, byId.green], [blue, byId.green]];
    for (const [A, B] of pairs) {
      for (const p of A.track.samples) {
        const n = nearestOnTrack(B.track, p.x, p.z);
        if (n.d < 9.6) {
          const q = pointAt(B.track, n.s);
          const nearInterchange = plan.interchanges.some((ic) => Math.hypot(ic.x - p.x, ic.z - p.z) < 330);
          expect(nearInterchange).toBe(true);
          if (A.id !== 'green' && B.id !== 'green' && n.d < 9.6) expect(Math.abs(p.y - q.y)).toBeGreaterThan(6.5);
        }
      }
    }
    expect(ameer.kind).toBe('stack');
  });

  it('has one platform level per line in a stack and ramps for the upper line', () => {
    const blue = byId.blue;
    const ys = blue.track.samples.map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(METRO.railY, 6);
    expect(Math.max(...ys)).toBeCloseTo(METRO.upperY, 6);
    // the grade of the ramps stays gentle
    const sm = blue.track.samples;
    let steepest = 0;
    for (let i = 0; i < sm.length - 1; i++) steepest = Math.max(steepest, Math.abs(sm[i + 1].y - sm[i].y) / Math.hypot(sm[i + 1].x - sm[i].x, sm[i + 1].z - sm[i].z));
    expect(steepest).toBeLessThan(0.075);
  });
});
