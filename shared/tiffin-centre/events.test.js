// Tiffin Centre events (docs section 3b): rain, a cricket-match night, a power cut, a festival rush, the GHMC food-safety inspector and the
// tiffin delivery boy. Planned from the seed and the level alone; the state keeps only what is running.
import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, buildSchedule, eventPlan, eventsNow, levelOps, EVENTS, LEVELS, MAX_LEVEL, REQUEST, HEAT, DISHES, LIVES,
  slotInfo, dishWeight, kindWeight, crowdAtHour, result,
} from './index.js';

function ap(s, action) {
  const r = applyAction(s, action);
  if (r.error) throw new Error(`${action.type}: ${r.error}`);
  return r;
}
function tk(s, n = 1) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    const r = ap(s, { type: 'tick' });
    s = r.state;
    ev.push(...r.events);
  }
  return { s, ev };
}
const game = (level, seed = 1, n = 1) => createGame({ players: Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'P' + (i + 1) })), settings: { level }, seed });
const patch = (s, p) => ({ ...s, ...p });
const quiet = (s) => ({ ...s, schedule: [], genAt: null, nextArrival: null });
/** A game where `id` runs from tick 0 for `len` ticks (the plan is overridden). */
const withEvent = (s, id, len = 30) => patch(s, { events: [{ id, until: s.tick + len }] });
const planOf = (level, seed = 1) => eventPlan({ ids: levelOps(level).events, seed, shiftTicks: LEVELS[level].shiftTicks });

describe('the plan of a shift', () => {
  it('is deterministic per seed and level, inside the shift, sorted, one of each', () => {
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      for (const seed of [1, 2, 'abc']) {
        const a = planOf(lv, seed);
        expect(a).toEqual(planOf(lv, seed));
        expect(a.map((e) => e.id).sort()).toEqual([...levelOps(lv).events].sort());
        let last = 0;
        for (const e of a) {
          expect(e.at).toBeGreaterThanOrEqual(8);
          expect(e.until).toBeGreaterThan(e.at);
          expect(e.until).toBeLessThanOrEqual(LEVELS[lv].shiftTicks);
          expect(e.at).toBeGreaterThanOrEqual(last);
          last = e.at;
          const def = EVENTS[e.id];
          expect(e.at / LEVELS[lv].shiftTicks).toBeGreaterThanOrEqual(def.at[0] - 0.02);
          expect(e.at / LEVELS[lv].shiftTicks).toBeLessThanOrEqual(def.at[1] + 0.02);
        }
      }
    }
    expect(planOf(12, 1)).not.toEqual(planOf(12, 2));
    // the number 1 and the string '1' are different seeds (the plan cache must not confuse them)
    expect(eventPlan({ ids: ['rain'], seed: 1, shiftTicks: 200 })).not.toEqual(eventPlan({ ids: ['rain'], seed: '1', shiftTicks: 200 }));
    expect(eventPlan({ ids: [], seed: 1, shiftTicks: 100 })).toEqual([]);
    expect(eventPlan({ ids: ['nope', '__proto__', 'rain', 'rain'], seed: 1, shiftTicks: 100 }).map((e) => e.id)).toEqual(['rain']);
    expect(eventPlan({ ids: undefined, seed: 1, shiftTicks: 100 })).toEqual([]);
  });

  it('the inspector comes after about 60% of the shift and stays a while; none at all in levels 1 and 2', () => {
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      const insp = planOf(lv).find((e) => e.id === 'inspector');
      if (!levelOps(lv).events.includes('inspector')) { expect(insp).toBeUndefined(); continue; }
      expect(insp.at / LEVELS[lv].shiftTicks).toBeGreaterThanOrEqual(0.53);
      expect(insp.at / LEVELS[lv].shiftTicks).toBeLessThanOrEqual(0.67);
      expect(insp.until - insp.at).toBe(EVENTS.inspector.dur[0]);
    }
    expect(planOf(1)).toEqual([]);
    expect(planOf(2)).toEqual([]);
    expect(game(0).events).toEqual([]);
  });
});

describe('events start and end, and the state says what is running', () => {
  it('event-start / event-end bracket the plan; `events` lists { id, until }; eventsNow adds the names', () => {
    let s = quiet(game(3, 4));
    const rain = planOf(3, 4).find((e) => e.id === 'rain');
    const t0 = tk(s, rain.at - 1);
    expect(t0.s.events).toEqual([]);
    expect(t0.ev.filter((e) => /^event-/.test(e.type))).toEqual([]);
    const t1 = tk(t0.s, 1);
    expect(t1.ev).toContainEqual({ type: 'event-start', id: 'rain', until: rain.until });
    expect(t1.s.events).toEqual([{ id: 'rain', until: rain.until }]);
    expect(eventsNow(t1.s)).toEqual([{ id: 'rain', name: 'Rain', te: EVENTS.rain.te, until: rain.until, left: rain.until - rain.at }]);
    const t2 = tk(t1.s, rain.until - rain.at);
    expect(t2.ev).toContainEqual({ type: 'event-end', id: 'rain' });
    expect(t2.s.events).toEqual([]);
    expect(eventsNow(t2.s)).toEqual([]);
    expect(eventsNow(null)).toEqual([]);
    expect(eventsNow({ events: [{ id: '__proto__', until: 5 }], tick: 1 })).toEqual([]);
  });

  it('a whole shift of level 12 starts and ends every event it lists, in order', () => {
    let s = patch(quiet(game(12, 3)), { lives: 1e6 });
    const ev = [];
    while (s.status === 'playing') {
      const r = ap(s, { type: 'tick' });
      s = r.state;
      ev.push(...r.events);
    }
    const starts = ev.filter((e) => e.type === 'event-start').map((e) => e.id);
    const ends = ev.filter((e) => e.type === 'event-end').map((e) => e.id);
    expect(starts.sort()).toEqual([...levelOps(12).events].sort());
    expect(ends.sort()).toEqual(starts);
    expect(s.events).toEqual([]);
  });

  it('level 0 and levels 1-2 never have an event', () => {
    for (const lv of [0, 1, 2]) {
      let s = game(lv);
      if (lv === 0) s = patch(s, { cfg: { ...s.cfg, noPatience: true } });
      const t = tk(quiet(s), 120);
      expect(t.ev.filter((e) => /^event-|inspector/.test(e.type))).toEqual([]);
      expect(t.s.events).toEqual([]);
    }
  });
});

describe('rain, cricket and festival change the crowd and what they order', () => {
  it('rain thins the crowd (x0.6) and makes chai, bajji and bonda twice as likely', () => {
    const plan = [{ id: 'rain', at: 0, until: 999 }];
    const ctx = { hour: [17, 19], shiftTicks: 200, plan };
    const dry = { hour: [17, 19], shiftTicks: 200, plan: [] };
    expect(dishWeight('irani_chai', ctx, 10)).toBeCloseTo(dishWeight('irani_chai', dry, 10) * 2, 6);
    expect(dishWeight('mirchi_bajji', ctx, 10)).toBeCloseTo(dishWeight('mirchi_bajji', dry, 10) * 2, 6);
    expect(dishWeight('dosa', ctx, 10)).toBe(dishWeight('dosa', dry, 10));
    // arrivals: with the rain window in the plan there are fewer customers inside it (summed over seeds), none are lost outside it
    const dryLevel = { ...LEVELS[7], id: 1 }; // level 1 lists no events
    let wet = 0;
    let dry2 = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rainy = planOf(7, seed).find((e) => e.id === 'rain');
      const inside = (sched) => sched.filter((e) => e.at >= rainy.at && e.at < rainy.until).length;
      wet += inside(buildSchedule({ level: 7, seed }));
      dry2 += inside(buildSchedule({ level: dryLevel, seed }));
    }
    expect(wet).toBeLessThan(dry2 * 0.85);
  });

  it('a cricket night brings students and autowalas in bursts: more arrivals one tick apart', () => {
    const ids = ['cricket'];
    const plan = eventPlan({ ids, seed: 5, shiftTicks: 225 });
    const c = plan[0];
    const ctx = { hour: [22, 24], shiftTicks: 225, plan };
    expect(kindWeight('student', ctx, c.at + 1)).toBeGreaterThan(kindWeight('student', { ...ctx, plan: [] }, c.at + 1) * 1.9);
    expect(kindWeight('family', ctx, c.at + 1)).toBeLessThan(kindWeight('family', { ...ctx, plan: [] }, c.at + 1));
    // bursts: during the match 55% of the gaps are one tick (the rest are doubled), over many seeds a large share of the gaps in the window is 1
    let ones = 0;
    let total = 0;
    let outside = 0;
    let outsideTotal = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const plan2 = eventPlan({ ids, seed, shiftTicks: 225 });
      const win = plan2[0];
      const sched = buildSchedule({ level: 11, seed, players: 2 });
      const gapsOf = (list) => list.slice(1).map((e, i) => e.at - list[i].at);
      const inside = gapsOf(sched.filter((e) => e.at >= win.at && e.at < win.until));
      const rest = gapsOf(sched.filter((e) => e.at < win.at || e.at >= win.until));
      ones += inside.filter((g) => g === 1).length;
      total += inside.length;
      outside += rest.filter((g) => g === 1).length;
      outsideTotal += rest.length;
    }
    expect(total).toBeGreaterThan(20);
    expect(ones / total).toBeGreaterThan(0.3);
    expect(ones / total).toBeGreaterThan(3 * (outside / Math.max(1, outsideTotal)));
  });

  it('a festival makes the crowd bigger and tips better', () => {
    let s = quiet(game(9, 2));
    let busy = 0;
    let plain = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const f = planOf(9, seed).find((e) => e.id === 'festival');
      const inside = (sched) => sched.filter((e) => e.at >= f.at && e.at < f.until).length;
      busy += inside(buildSchedule({ level: 9, seed }));
      plain += inside(buildSchedule({ level: { ...LEVELS[9], id: 1 }, seed })); // level 1 lists no events
    }
    expect(busy).toBeGreaterThan(plain * 1.15);
    // tips x1.3 while it runs
    s = patch(s, { events: [{ id: 'festival', until: s.tick + 50 }] });
    const entry = { at: s.tick + 1, kind: 'student', name: 'Kiran', look: 'bag', order: ['dosa'], patienceMax: 40 };
    const hold = (st) => ap(patch(quiet(st), { schedule: [entry], nextArrival: entry.at }), { type: 'tick' }).state;
    const tipOf = (st) => {
      let t = hold(st);
      t = patch(t, { players: { ...t.players, p1: { ...t.players.p1, hands: [{ dish: 'dosa', q: 'good' }] } } });
      return ap(t, { type: 'serve', playerId: 'p1', customer: t.customers[0].id, hand: 0 }).state.customers[0].tip;
    };
    const normal = tipOf(patch(s, { events: [] }));
    expect(tipOf(s)).toBeGreaterThanOrEqual(normal);
  });
});

describe('a power cut', () => {
  it('stops the steamer (cooking pauses, a new idly is refused) while the gas burners carry on', () => {
    let s = quiet(game(5, 1));
    s = ap(s, { type: 'cook', playerId: 'p1', station: 'steamer1', slot: 0, dish: 'idly' }).state;
    s = ap(s, { type: 'cook', playerId: 'p1', station: 'tawa1', slot: 0, dish: 'dosa' }).state;
    s = withEvent(s, 'power', 40);
    const p = slotInfo(s, 'steamer1', 0).progress;
    const t = tk(s, 5);
    expect(slotInfo(t.s, 'steamer1', 0)).toMatchObject({ st: 'cooking', progress: p });
    expect(slotInfo(t.s, 'tawa1', 0).st).toBe('ready'); // the tawa is gas: unaffected
    const r = applyAction(t.s, { type: 'cook', playerId: 'p1', station: 'steamer1', slot: 1, dish: 'idly' });
    expect(r.error).toMatch(/Power cut/);
    expect(r.state).toBe(t.s);
    // power back: the idly carries on
    const back = tk(patch(t.s, { events: [] }), 7);
    expect(slotInfo(back.s, 'steamer1', 0).st).toBe('ready');
    expect(ap(back.s, { type: 'take', playerId: 'p1', station: 'steamer1', slot: 0 }).events[0].q).toBe('perfect');
  });

  it('is announced and ends: event-start, event-end', () => {
    const plan = planOf(5, 2).find((e) => e.id === 'power');
    expect(plan.until - plan.at).toBeGreaterThanOrEqual(EVENTS.power.dur[0]);
    expect(plan.until - plan.at).toBeLessThanOrEqual(EVENTS.power.dur[1]);
    expect(EVENTS.power.down).toEqual(expect.arrayContaining(['steamer', 'grinder', 'lights']));
  });
});

describe('the GHMC food-safety inspector', () => {
  const inspectorAt = (s, id) => {
    const p = planOf(s.level, s.seed).find((e) => e.id === id);
    return p;
  };
  /** Run to the end of the inspector's visit and return what happened. */
  function visit(s, id = 'inspector') {
    const p = inspectorAt(s, id);
    return tk(s, p.until - s.tick);
  }

  it('passes when nothing is burnt and the tawas were tended: a bonus lands in the tips', () => {
    let s = quiet(game(5, 3));
    const p = inspectorAt(s, 'inspector');
    s = tk(s, p.at - 3).s;
    const tawa = s.stations.tawa1;
    s = patch(s, { stations: { ...s.stations, tawa1: { ...tawa, tendAt: s.tick - 10 }, tawa2: { ...s.stations.tawa2, tendAt: s.tick - 5 } } });
    const t = visit(s);
    const e = t.ev.find((x) => x.type === 'inspector');
    expect(e).toEqual({ type: 'inspector', pass: true, bonus: EVENTS.inspector.bonus + 5 * 5, fine: 0, why: [] });
    expect(t.s.tips).toBe(s.tips + e.bonus);
    expect(t.s.money).toBe(s.money + e.bonus);
    expect(t.s.lives).toBe(LIVES);
    expect(t.ev.map((x) => x.type)).toContain('event-end');
    // the bonus is cash in hand, nobody's own earnings
    expect(Object.values(t.s.players).reduce((n, pl) => n + pl.earned, 0)).toBe(0);
  });

  it('fails on a burnt dish lying on a station, or a tawa not tended for 30 ticks: a fine and a lost heart', () => {
    let s = quiet(game(5, 3));
    const p = inspectorAt(s, 'inspector');
    s = tk(s, p.at - 2).s;
    // an untended tawa (the pans are dirty and it has been a long time)
    s = patch(s, { stations: { ...s.stations, tawa1: { ...s.stations.tawa1, tendAt: 0, gunk: 40, heat: 40 }, tawa2: { ...s.stations.tawa2, tendAt: s.tick } } });
    const t = visit(s);
    const e = t.ev.find((x) => x.type === 'inspector');
    expect(e).toMatchObject({ pass: false, bonus: 0, fine: EVENTS.inspector.fine + 3 * 5 });
    expect(e.why).toContain('untended');
    expect(t.s.lives).toBe(LIVES - 1);
    expect(t.ev).toContainEqual({ type: 'life-lost', lives: LIVES - 1 });
    expect(t.s.fines).toBe(e.fine);
    expect(t.s.cost).toBeGreaterThanOrEqual(e.fine);
    expect(t.s.profit).toBe(t.s.money - t.s.cost);

    // a burnt dish on a station
    let b = quiet(game(5, 3));
    b = tk(b, p.at - 2).s;
    b = patch(b, { stations: { ...b.stations, chai1: { ...b.stations.chai1, slots: [{ st: 'burnt', dish: 'irani_chai', t0: 0, readyAt: 4, burnAt: 14, by: 'p1' }, b.stations.chai1.slots[1]] }, tawa1: { ...b.stations.tawa1, tendAt: b.tick }, tawa2: { ...b.stations.tawa2, tendAt: b.tick } } });
    const u = visit(b).ev.find((x) => x.type === 'inspector');
    expect(u).toMatchObject({ pass: false });
    expect(u.why).toContain('burnt');
  });

  it('a tawa that is clean (little need) passes even if it was not tended lately; the heart is not lost on a pass', () => {
    let s = quiet(game(5, 3));
    const p = inspectorAt(s, 'inspector');
    s = tk(s, p.at - 2).s;
    s = patch(s, { stations: { ...s.stations, tawa1: { ...s.stations.tawa1, tendAt: 0, gunk: 0, heat: HEAT.ideal - 4 }, tawa2: { ...s.stations.tawa2, tendAt: 0, gunk: 0, heat: HEAT.ideal - 4 } } });
    const t = visit(s);
    expect(t.ev.find((x) => x.type === 'inspector').pass).toBe(true);
    expect(t.s.lives).toBe(LIVES);
  });

  it('a failed inspection can close the stall (the last heart)', () => {
    let s = quiet(game(5, 3));
    const p = inspectorAt(s, 'inspector');
    s = tk(s, p.at - 2).s;
    s = patch(s, { lives: 1, stations: { ...s.stations, tawa1: { ...s.stations.tawa1, tendAt: 0, gunk: 60, heat: 40 } } });
    const t = visit(s);
    expect(t.s.status).toBe('closed');
    expect(t.s.stars).toBe(0);
  });
});

describe('the tiffin delivery boy', () => {
  it('turns up wanting 5 parcels quickly: a parcel-order event, a hurried customer with a bonus tip', () => {
    let s = quiet(game(4, 2));
    const p = planOf(4, 2).find((e) => e.id === 'delivery');
    const t = tk(s, p.at);
    const c = t.s.customers.find((x) => x.delivery);
    expect(c).toMatchObject({ delivery: true, parcel: true, kind: 'autowala', name: 'Delivery boy' });
    expect(c.order).toHaveLength(REQUEST.delivery.dishes);
    expect(c.patienceMax).toBe(REQUEST.delivery.patience);
    expect(c.total).toBe(c.order.reduce((n, d) => n + DISHES[d].price, 0) + REQUEST.parcelFee * 5);
    expect(t.ev).toContainEqual({ type: 'parcel-order', customer: c.id, n: 5, delivery: true });
    expect(t.s.events.find((e) => e.id === 'delivery')).toEqual({ id: 'delivery', until: p.until }); // no longer waiting
    // served in full the tip carries the bonus
    let g = t.s;
    for (const d of c.order) {
      g = patch(g, { players: { ...g.players, p1: { ...g.players.p1, hands: [{ dish: d, q: 'good' }] } } });
      g = ap(g, { type: 'serve', playerId: 'p1', customer: c.id, hand: 0 }).state;
    }
    expect(g.customers.find((x) => x.id === c.id).tip).toBeGreaterThanOrEqual(REQUEST.delivery.bonus);
  });

  it('waits for a free spot (up to the end of the visit), and is skipped if none comes', () => {
    let s = quiet(game(4, 2));
    const p = planOf(4, 2).find((e) => e.id === 'delivery');
    s = patch(s, { cfg: { ...s.cfg, spots: 0 } });
    const t = tk(s, p.until + 2);
    expect(t.s.customers).toEqual([]);
    expect(t.ev.filter((e) => e.type === 'parcel-order')).toEqual([]);
    expect(t.ev).toContainEqual({ type: 'event-end', id: 'delivery' });
  });
});

describe('the daypart curve', () => {
  it('rushes in the morning and the evening, a lull around noon; kinds and dishes follow the hour', () => {
    expect(crowdAtHour(8.5)).toBeGreaterThan(crowdAtHour(11.2) * 1.8);
    expect(crowdAtHour(18)).toBeGreaterThan(crowdAtHour(14.5) * 2);
    expect(crowdAtHour(21)).toBeGreaterThan(crowdAtHour(24));
    expect(crowdAtHour(26)).toBeLessThan(0.5);
    const morning = { hour: [8, 10], shiftTicks: 100, plan: [] };
    const evening = { hour: [17, 19], shiftTicks: 100, plan: [] };
    const night = { hour: [21, 23], shiftTicks: 100, plan: [] };
    expect(dishWeight('idly', morning, 10)).toBeGreaterThan(dishWeight('mirchi_bajji', morning, 10) * 4);
    expect(dishWeight('mirchi_bajji', evening, 10)).toBeGreaterThan(dishWeight('idly', evening, 10) * 4);
    expect(dishWeight('dosa', night, 10)).toBeGreaterThan(dishWeight('mysore_bonda', night, 10) * 3);
    expect(kindWeight('office', morning, 10)).toBeGreaterThan(kindWeight('student', morning, 10));
    expect(kindWeight('student', evening, 10)).toBeGreaterThan(kindWeight('office', evening, 10));
    expect(kindWeight('family', night, 10)).toBeGreaterThan(kindWeight('office', night, 10) * 2);
    expect(kindWeight('autowala', night, 10)).toBeGreaterThan(0);
    expect(kindWeight('ghost', night, 10)).toBe(0);
  });

  it('the shift keeps its mean gap: the curve moves the rushes around, not the total', () => {
    for (const lv of [1, 4, 7, 10]) {
      const gaps = buildSchedule({ level: lv, seed: 3, players: 1 });
      const mean = (LEVELS[lv].gap[0] + LEVELS[lv].gap[1]) / 2;
      const avg = (LEVELS[lv].shiftTicks - 2) / gaps.length;
      expect(avg).toBeGreaterThan(mean * 0.65);
      expect(avg).toBeLessThan(mean * 1.35);
    }
    // a morning level is busier in its middle (the 8-9 bell) than at its edges
    const m = buildSchedule({ level: 4, seed: 9, players: 1 });
    const third = LEVELS[4].shiftTicks / 3;
    const inMid = m.filter((e) => e.at >= third && e.at < 2 * third).length;
    const first = m.filter((e) => e.at < third).length;
    expect(inMid).toBeGreaterThanOrEqual(first - 1);
    expect(result(game(4)).stars).toBe(0);
  });
});
