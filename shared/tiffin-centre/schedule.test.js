// Tiffin Centre: the customer schedule is built from the seed alone and obeys the plan's arrival rules.
import { describe, it, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 30000 }); // loops every level; slow on a loaded machine
import {
  buildSchedule, createGame, applyAction, menuFor, patienceFor, LOOKAHEAD, FIRST_ARRIVAL,
  LEVELS, DISHES, STATIONS, CUSTOMER_KINDS, CUSTOMER_NAMES, PACE, PATIENCE_BASE, coopScale,
} from './index.js';

const mean = (a) => a.reduce((n, x) => n + x, 0) / a.length;
const gaps = (sched) => sched.slice(1).map((e, i) => e.at - sched[i].at);

describe('buildSchedule', () => {
  it('is deterministic per seed and starts at tick 2', () => {
    const a = buildSchedule({ level: 4, pace: 'normal', players: 2, seed: 7 });
    expect(a).toEqual(buildSchedule({ level: 4, pace: 'normal', players: 2, seed: 7 }));
    expect(a).not.toEqual(buildSchedule({ level: 4, pace: 'normal', players: 2, seed: 8 }));
    expect(a[0].at).toBe(FIRST_ARRIVAL);
    expect(FIRST_ARRIVAL).toBe(2);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it('every entry is a legal customer for its level', () => {
    for (let lv = 1; lv <= 12; lv++) {
      const level = LEVELS[lv];
      const kinds = new Set(level.stations.map((id) => STATIONS[id].kind));
      for (const players of [1, 4]) {
        const sched = buildSchedule({ level: lv, pace: 'normal', players, seed: lv * 13 });
        expect(sched.length).toBeGreaterThan(5);
        let last = 0;
        for (const e of sched) {
          expect(e.at).toBeGreaterThan(last);
          expect(e.at).toBeLessThan(level.shiftTicks);
          last = e.at;
          expect(CUSTOMER_KINDS[e.kind]).toBeTruthy();
          expect(CUSTOMER_NAMES).toContain(e.name);
          expect(e.look).toBe(CUSTOMER_KINDS[e.kind].look);
          expect(e.order.length).toBeGreaterThanOrEqual(1);
          expect(e.order.length).toBeLessThanOrEqual(Math.min(CUSTOMER_KINDS[e.kind].order[1], level.orderMax));
          for (const d of e.order) {
            expect(level.menu).toContain(d);
            expect(kinds.has(DISHES[d].station)).toBe(true);
            expect(e.order.filter((x) => x === d).length).toBeLessThanOrEqual(2);
          }
          expect(e.patienceMax).toBe(patienceFor(e.kind, level, 'normal'));
        }
      }
    }
  });

  it('patience = base * kind * level * pace', () => {
    expect(patienceFor('office', LEVELS[1], 'normal')).toBe(Math.round(PATIENCE_BASE * 0.75 * LEVELS[1].patience));
    expect(patienceFor('uncle', LEVELS[4], 'rush')).toBe(Math.round(PATIENCE_BASE * 1.3 * LEVELS[4].patience * 0.9));
    expect(patienceFor('nobody', LEVELS[4], 'nothing')).toBeGreaterThan(0);
  });

  it('gaps follow the level, the pace and the team size', () => {
    const avg = (opts) => mean(gaps(buildSchedule({ level: 6, seed: 3, ...opts })));
    const mid = (LEVELS[6].gap[0] + LEVELS[6].gap[1]) / 2;
    const base = avg({ pace: 'normal', players: 1 });
    expect(base).toBeGreaterThan(mid - 1.5);
    expect(base).toBeLessThan(mid + 1.5);
    expect(avg({ pace: 'rush', players: 1 })).toBeLessThan(base * 0.95);
    expect(avg({ pace: 'relaxed', players: 1 })).toBeGreaterThan(base * 1.1);
    expect(avg({ pace: 'normal', players: 4 })).toBeLessThan((base / coopScale(4)) * 1.4);
    const one = buildSchedule({ level: 6, pace: 'normal', players: 1, seed: 3 }).length;
    expect(buildSchedule({ level: 6, pace: 'normal', players: 4, seed: 3 }).length).toBeGreaterThan(2 * one);
    expect(Math.min(...gaps(buildSchedule({ level: 12, pace: 'rush', players: 4, seed: 3 })))).toBeGreaterThanOrEqual(1);
  });

  it('a mix of customer kinds shows up', () => {
    const kinds = new Set(buildSchedule({ level: 12, pace: 'normal', players: 4, seed: 5 }).map((e) => e.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(5);
  });

  it('the tutorial has no scheduled crowd', () => {
    expect(buildSchedule({ level: 0, seed: 1 })).toEqual([]);
  });

  it('menuFor drops dishes the level cannot cook', () => {
    expect(menuFor({ stations: ['tawa1'], menu: ['dosa', 'idly', 'irani_chai', 'zzz'] })).toEqual(['dosa']);
    for (let lv = 1; lv <= 12; lv++) expect(menuFor(LEVELS[lv])).toEqual(LEVELS[lv].menu);
  });
});

describe('the engine plays the same schedule, lazily', () => {
  it('seats exactly the entries buildSchedule lists, in order, and keeps a short look-ahead', () => {
    for (const [level, n] of [[2, 1], [9, 4]]) {
      const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i }));
      let s = createGame({ players, settings: { level }, seed: 21 });
      s = { ...s, lives: 1e6, cfg: { ...s.cfg, spots: 99 } }; // nobody is turned away, nobody ends the game
      const full = buildSchedule({ level, pace: 'normal', players: n, seed: 21 });
      expect(s.schedule).toEqual(full.slice(0, LOOKAHEAD));
      const seen = [];
      const known = new Set();
      while (s.status === 'playing') {
        expect(s.schedule.length).toBeLessThanOrEqual(LOOKAHEAD);
        s = applyAction(s, { type: 'tick' }).state;
        for (const c of s.customers) {
          if (known.has(c.id)) continue;
          known.add(c.id);
          seen.push({ at: c.arrivedAt, kind: c.kind, name: c.name, order: c.order, patienceMax: c.patienceMax });
        }
      }
      expect(seen).toEqual(full.map(({ look, ...rest }) => rest));
      expect(s.schedule).toEqual([]);
    }
  });

  it('does not depend on what the players do', () => {
    const run = (act) => {
      let s = createGame({ players: [{ id: 'a' }], settings: { level: 3 }, seed: 4 });
      s = { ...s, lives: 1e6 };
      for (let i = 0; i < 80; i++) {
        if (act && i % 5 === 0) s = applyAction(s, { type: 'cook', playerId: 'a', station: 'tawa1', slot: i % 3, dish: 'dosa' }).state;
        if (act) s = applyAction(s, { type: 'emote', playerId: 'a', e: 'fire' }).state;
        s = applyAction(s, { type: 'tick' }).state;
      }
      return [s.customers.map((c) => [c.id, c.name, c.order, c.arrivedAt]), s.schedule];
    };
    expect(run(true)).toEqual(run(false));
  });

  it('pace speeds the crowd up', () => {
    expect(PACE.rush.gap).toBeLessThan(PACE.relaxed.gap);
  });
});
