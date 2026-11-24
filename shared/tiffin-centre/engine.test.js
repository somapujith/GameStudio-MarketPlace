// Tiffin Centre engine: the rules of docs/TIFFIN_CENTRE_PLAN.md section 3, one behaviour per test.
import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, isOver, result, hourOf, daypartId, shiftProgress, secondsLeft, livesLeft, slotInfo, customerInfo,
  LEVELS, LIVES, HANDS_MAX, PAY_WINDOW, EAT_TICKS, ARRIVAL_RETRY, DISHES, PACE, coopScale, starTargets,
} from './index.js';

const PL = [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Bala' }];

function ap(s, action) {
  const r = applyAction(s, action);
  if (r.error) throw new Error(`${action.type}: ${r.error}`);
  return r;
}
/** Advance n ticks, collecting events. */
function tk(s, n = 1) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    const r = ap(s, { type: 'tick' });
    s = r.state;
    ev.push(...r.events);
  }
  return { s, ev };
}
const types = (ev) => ev.map((e) => e.type);
const tutorial = (flags) => {
  let s = createGame({ players: PL, settings: { level: 0 }, seed: 1 });
  if (flags) s = ap(s, { type: 'tutorial-flags', ...flags }).state;
  return s;
};
const spawn = (s, customer = {}) => ap(s, { type: 'spawn', customer: { kind: 'student', order: ['dosa'], patienceMax: 30, ...customer } });
const cook = (s, who, station, slot, dish) => ap(s, { type: 'cook', playerId: who, station, slot, dish });

describe('createGame', () => {
  it('builds a small, JSON-clean, playable state', () => {
    const s = createGame({ players: PL, settings: { level: 1, pace: 'normal' }, seed: 5 });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(s).toMatchObject({ v: 1, status: 'playing', level: 1, pace: 'normal', tick: 0, shiftTicks: 150, lives: LIVES, money: 0, combo: 0 });
    expect(s.order).toEqual(['a', 'b']);
    expect(Object.keys(s.stations)).toEqual(['tawa1', 'chai1']);
    expect(s.stations.tawa1.slots).toHaveLength(3);
    expect(s.stations.chai1.slots).toHaveLength(2);
    expect(s.players.a).toMatchObject({ at: null, hands: [], served: 0, collected: 0, earned: 0, tips: 0 });
    expect(s.cfg).toMatchObject({ tutorial: false, spots: 3, stations: ['tawa1', 'chai1'], hour: [6, 9] });
    expect(s.schedule[0].at).toBe(2);
    expect(s.nextArrival).toBe(2);
    expect(JSON.stringify(s).length).toBeLessThan(3000);
  });

  it('falls back on bad settings and ignores bad players', () => {
    const s = createGame({ players: [{ id: 'a' }, { id: 'a' }, { id: '__proto__' }, null, { id: 5 }, { id: 'b', name: 7 }], settings: { level: 'x', pace: 'turbo' }, seed: undefined });
    expect(s.level).toBe(1);
    expect(s.pace).toBe('normal');
    expect(s.order).toEqual(['a', 'b']);
    expect(s.players.b.name).toBe('b');
    expect(createGame({ players: PL, settings: { level: 99 } }).level).toBe(12);
    expect(createGame({}).order).toEqual([]);
    expect(createGame(undefined).status).toBe('playing');
  });

  it('level 0 is the scripted tutorial: no crowd of its own, frozen clocks, no lives lost', () => {
    const s = tutorial();
    expect(s.cfg).toMatchObject({ tutorial: true, noPatience: true, noPayExpiry: true });
    expect(s.schedule).toEqual([]);
    expect(s.nextArrival).toBe(null);
    const r = tk(s, 40);
    expect(r.s.customers).toEqual([]);
  });

  it('caps a table at four players', () => {
    const s = createGame({ players: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })), settings: { level: 3 }, seed: 1 });
    expect(s.order).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('time helpers', () => {
  it('hour, daypart, progress and seconds follow the tick', () => {
    let s = createGame({ players: PL, settings: { level: 1 }, seed: 1 });
    expect(hourOf(s)).toBe(6);
    expect(daypartId(s)).toBe('morning');
    expect(shiftProgress(s)).toBe(0);
    expect(secondsLeft(s)).toBe(150);
    s = { ...s, tick: 75 };
    expect(hourOf(s)).toBeCloseTo(7.5, 6);
    expect(shiftProgress(s)).toBeCloseTo(0.5, 6);
    expect(secondsLeft(s)).toBe(75);
    s = { ...s, tick: 999 };
    expect(shiftProgress(s)).toBe(1);
    expect(secondsLeft(s)).toBe(0);
    const night = createGame({ players: PL, settings: { level: 11 }, seed: 1 });
    expect(daypartId(night)).toBe('night');
    expect(livesLeft(night)).toBe(LIVES);
  });
});

describe('cooking', () => {
  it('cook-start, ready after `cook` ticks, a perfect take straight away', () => {
    let s = createGame({ players: PL, settings: { level: 1 }, seed: 1 });
    let r = cook(s, 'a', 'tawa1', 0, 'dosa');
    expect(r.events).toEqual([{ type: 'cook-start', station: 'tawa1', slot: 0, dish: 'dosa', by: 'a' }]);
    s = r.state;
    expect(slotInfo(s, 'tawa1', 0)).toMatchObject({ st: 'cooking', dish: 'dosa', progress: 0 });
    r = tk(s, 4);
    expect(slotInfo(r.s, 'tawa1', 0).progress).toBeCloseTo(0.8, 6);
    expect(types(r.ev)).not.toContain('ready');
    r = tk(r.s, 1);
    expect(r.ev).toContainEqual({ type: 'ready', station: 'tawa1', slot: 0, dish: 'dosa' });
    expect(slotInfo(r.s, 'tawa1', 0)).toMatchObject({ st: 'ready', age: 0, burnLeft: 7, progress: 1 });
    r = ap(r.s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 });
    expect(r.events).toEqual([{ type: 'take', station: 'tawa1', slot: 0, dish: 'dosa', q: 'perfect', by: 'a' }]);
    expect(r.state.players.a.hands).toEqual([{ dish: 'dosa', q: 'perfect' }]);
    expect(slotInfo(r.state, 'tawa1', 0).st).toBe('empty');
  });

  it.each([[2, 'perfect'], [3, 'good'], [4, 'good'], [5, 'ok'], [6, 'ok']])('dosa taken %i ticks after ready is %s', (age, q) => {
    let s = cook(createGame({ players: PL, settings: { level: 1 }, seed: 1 }), 'a', 'tawa1', 0, 'dosa').state;
    s = tk(s, 5 + age).s;
    expect(slotInfo(s, 'tawa1', 0).age).toBe(age);
    expect(ap(s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 }).events[0].q).toBe(q);
  });

  it('burns `burn` ticks after ready; taking a burnt slot only clears it', () => {
    let s = cook(createGame({ players: PL, settings: { level: 1 }, seed: 1 }), 'a', 'tawa1', 0, 'dosa').state;
    let r = tk(s, 11);
    expect(r.s.stations.tawa1.slots[0].st).toBe('ready');
    r = tk(r.s, 1);
    expect(r.ev).toContainEqual({ type: 'burnt', station: 'tawa1', slot: 0, dish: 'dosa' });
    expect(slotInfo(r.s, 'tawa1', 0).st).toBe('burnt');
    const t = ap(r.s, { type: 'take', playerId: 'b', station: 'tawa1', slot: 0 });
    expect(t.events).toEqual([{ type: 'burnt-cleared', station: 'tawa1', slot: 0, by: 'b' }]);
    expect(t.state.players.b.hands).toEqual([]);
    expect(slotInfo(t.state, 'tawa1', 0).st).toBe('empty');
  });

  it('refuses bad cooks with the same state object', () => {
    const s = cook(createGame({ players: PL, settings: { level: 1 }, seed: 1 }), 'a', 'tawa1', 0, 'dosa').state;
    const bad = [
      { type: 'cook', playerId: 'a', station: 'tawa1', slot: 0, dish: 'dosa' }, // busy
      { type: 'cook', playerId: 'a', station: 'tawa1', slot: 3, dish: 'dosa' },
      { type: 'cook', playerId: 'a', station: 'tawa1', slot: -1, dish: 'dosa' },
      { type: 'cook', playerId: 'a', station: 'tawa1', slot: 1.5, dish: 'dosa' },
      { type: 'cook', playerId: 'a', station: 'tawa1', slot: NaN, dish: 'dosa' },
      { type: 'cook', playerId: 'a', station: 'tawa1', slot: 1e30, dish: 'dosa' },
      { type: 'cook', playerId: 'a', station: 'tawa1', slot: '1', dish: 'dosa' },
      { type: 'cook', playerId: 'a', station: 'steamer1', slot: 0, dish: 'idly' }, // not unlocked
      { type: 'cook', playerId: 'a', station: 'tawa2', slot: 0, dish: 'dosa' },
      { type: 'cook', playerId: 'a', station: '__proto__', slot: 0, dish: 'dosa' },
      { type: 'cook', playerId: 'a', station: 'constructor', slot: 0, dish: 'dosa' },
      { type: 'cook', playerId: 'a', station: 7, slot: 0, dish: 'dosa' },
      { type: 'cook', playerId: 'a', station: 'chai1', slot: 0, dish: 'dosa' }, // wrong station kind
      { type: 'cook', playerId: 'a', station: 'tawa1', slot: 1, dish: 'poori' }, // not this station
      { type: 'cook', playerId: 'a', station: 'tawa1', slot: 1, dish: 'podi_dosa' }, // not on today's menu
      { type: 'cook', playerId: 'a', station: 'tawa1', slot: 1, dish: 'toString' },
      { type: 'cook', playerId: 'a', station: 'tawa1', slot: 1 },
      { type: 'cook', playerId: 'zed', station: 'tawa1', slot: 1, dish: 'dosa' }, // not at this stall
      { type: 'cook', station: 'tawa1', slot: 1, dish: 'dosa' },
      { type: 'cook', playerId: '__proto__', station: 'tawa1', slot: 1, dish: 'dosa' },
    ];
    for (const a of bad) {
      const r = applyAction(s, a);
      expect(r.state, JSON.stringify(a)).toBe(s);
      expect(r.events).toEqual([]);
      expect(typeof r.error).toBe('string');
    }
  });

  it('take: not ready, empty, hands full', () => {
    let s = createGame({ players: PL, settings: { level: 1 }, seed: 1 });
    expect(applyAction(s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 }).error).toBe('Nothing there');
    s = cook(s, 'a', 'tawa1', 0, 'dosa').state;
    expect(applyAction(s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 }).error).toBe('Not ready yet');
    s = cook(s, 'a', 'tawa1', 1, 'dosa').state;
    s = cook(s, 'a', 'tawa1', 2, 'masala_dosa').state;
    s = tk(s, 5).s;
    s = ap(s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 }).state;
    s = ap(s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 1 }).state;
    expect(s.players.a.hands).toHaveLength(HANDS_MAX);
    s = tk(s, 2).s;
    const r = applyAction(s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 2 });
    expect(r.error).toBe('Your hands are full');
    expect(r.state).toBe(s);
    // a teammate with free hands can take it
    expect(ap(s, { type: 'take', playerId: 'b', station: 'tawa1', slot: 2 }).state.players.b.hands).toHaveLength(1);
  });
});

describe('customers, serving and paying', () => {
  /** A tutorial game with one dosa customer, a dosa in `a`'s hands. */
  function withDish(flags, customer) {
    let s = spawn(tutorial(flags), customer).state;
    s = cook(s, 'a', 'tawa1', 0, 'dosa').state;
    s = tk(s, 5).s;
    s = ap(s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 }).state;
    return s;
  }

  it('the whole loop: serve, eat, pay, collect (tip from the formula)', () => {
    let s = spawn(tutorial()).state;
    expect(s.customers[0]).toMatchObject({ id: 1, kind: 'student', st: 'waiting', spot: 0, order: ['dosa'], total: 40, outcome: null });
    s = cook(s, 'a', 'tawa1', 0, 'dosa').state;
    s = tk(s, 5).s;
    s = ap(s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 }).state;
    let r = ap(s, { type: 'serve', playerId: 'a', customer: 1, hand: 0 });
    expect(types(r.events)).toEqual(['serve', 'eating']);
    s = r.state;
    expect(s.players.a.hands).toEqual([]);
    expect(s.customers[0]).toMatchObject({ st: 'eating', eatLeft: EAT_TICKS, got: ['dosa'], qs: ['perfect'] });
    expect(applyAction(s, { type: 'collect', playerId: 'a', customer: 1 }).error).toBeTruthy(); // still eating
    r = tk(s, EAT_TICKS - 1);
    expect(r.s.customers[0].st).toBe('eating');
    r = tk(r.s, 1);
    expect(r.ev).toContainEqual({ type: 'pay-ready', customer: 1 });
    expect(r.s.customers[0]).toMatchObject({ st: 'paying', payLeft: PAY_WINDOW });
    // 40 * 0.5 * (0.04 + 0.12 * 1) = 3.2, plus 5% of the perfect 40 = 2  -> 5; combo 1: +2% of 40 -> 1
    r = ap(r.s, { type: 'collect', playerId: 'b', customer: 1 });
    expect(r.events.find((e) => e.type === 'collect')).toEqual({ type: 'collect', customer: 1, amount: 40, tip: 6, by: 'b', combo: 1 });
    expect(r.state).toMatchObject({ money: 46, tips: 6, combo: 1, served: 1, paid: 1 });
    expect(r.state.players.b).toMatchObject({ collected: 1, earned: 46, tips: 6 });
    expect(r.state.players.a).toMatchObject({ served: 1, earned: 0 });
    expect(r.state.customers[0]).toMatchObject({ st: 'left', outcome: 'paid', leftAt: r.state.tick });
  });

  it('combo grows by 2% of the bill per consecutive collect', () => {
    let s = tutorial();
    let combos = [];
    for (let i = 0; i < 3; i++) {
      s = spawn(s).state;
      const id = s.customers[s.customers.length - 1].id;
      s = cook(s, 'a', 'tawa1', 0, 'dosa').state;
      s = tk(s, 5).s;
      s = ap(s, { type: 'take', playerId: 'a', station: 'tawa1', slot: 0 }).state;
      s = ap(s, { type: 'serve', playerId: 'a', customer: id, hand: 0 }).state;
      s = tk(s, EAT_TICKS).s;
      const r = ap(s, { type: 'collect', playerId: 'a', customer: id });
      s = r.state;
      combos.push(r.events.find((e) => e.type === 'collect'));
    }
    expect(combos.map((c) => c.combo)).toEqual([1, 2, 3]);
    expect(combos.map((c) => c.tip)).toEqual([6, 7, 7]); // 5 + round(0.8), 5 + round(1.6), 5 + round(2.4)
  });

  it('a late dish still counts; serving is refused for the wrong dish, customer or hand', () => {
    const s = withDish(undefined, { order: ['dosa', 'irani_chai'] });
    const bad = [
      { type: 'serve', playerId: 'a', customer: 99, hand: 0 },
      { type: 'serve', playerId: 'a', customer: 'x', hand: 0 },
      { type: 'serve', playerId: 'a', customer: 1, hand: 1 },
      { type: 'serve', playerId: 'a', customer: 1, hand: -1 },
      { type: 'serve', playerId: 'a', customer: 1, hand: NaN },
      { type: 'serve', playerId: 'a', customer: 1, hand: 1e9 },
      { type: 'serve', playerId: 'b', customer: 1, hand: 0 }, // b has nothing
    ];
    for (const a of bad) {
      const r = applyAction(s, a);
      expect(r.state, JSON.stringify(a)).toBe(s);
      expect(r.error).toBeTruthy();
    }
    const r = ap(s, { type: 'serve', playerId: 'a', customer: 1, hand: 0 });
    expect(types(r.events)).toEqual(['serve']); // still needs the chai
    expect(r.state.customers[0].st).toBe('waiting');
    expect(applyAction(r.state, { type: 'serve', playerId: 'a', customer: 1, hand: 0 }).error).toBeTruthy();
  });

  it('serving refills a quarter of the patience', () => {
    let s = withDish({ patience: true }, { order: ['dosa', 'dosa'], patienceMax: 40 });
    expect(s.customers[0].patience).toBe(35); // 5 ticks spent cooking
    s = tk(s, 10).s;
    expect(s.customers[0].patience).toBe(25);
    s = ap(s, { type: 'serve', playerId: 'a', customer: 1, hand: 0 }).state;
    expect(s.customers[0].patience).toBe(35); // + round(0.25 * 40)
  });

  it('angry: patience 0 while waiting loses a life, the combo and the spot (tutorial: no life)', () => {
    let s = spawn(tutorial({ patience: true }), { patienceMax: 3 }).state;
    let r = tk(s, 3);
    expect(r.ev).toContainEqual({ type: 'customer-angry', customer: 1 });
    expect(types(r.ev)).not.toContain('life-lost');
    expect(r.s).toMatchObject({ lost: 1, lives: LIVES });
    expect(r.s.customers[0]).toMatchObject({ st: 'left', outcome: 'angry' });
  });

  it('unpaid: pay-warning at 3, then they walk off without paying', () => {
    let s = withDish({ patience: false, pay: true });
    s = ap(s, { type: 'serve', playerId: 'a', customer: 1, hand: 0 }).state;
    s = tk(s, EAT_TICKS).s;
    expect(s.customers[0].payLeft).toBe(PAY_WINDOW);
    let r = tk(s, PAY_WINDOW - 3);
    expect(r.ev.filter((e) => e.type === 'pay-warning')).toEqual([{ type: 'pay-warning', customer: 1 }]);
    r = tk(r.s, 3);
    expect(r.ev).toContainEqual({ type: 'customer-unpaid', customer: 1, owed: 40 });
    expect(r.s).toMatchObject({ money: 0, unpaid: 1, combo: 0 });
    expect(r.s.customers[0].outcome).toBe('unpaid');
    expect(applyAction(r.s, { type: 'collect', playerId: 'a', customer: 1 }).error).toBeTruthy();
  });

  it('frozen tutorial clocks really freeze, and the flags can thaw them', () => {
    let s = spawn(tutorial()).state;
    s = tk(s, 50).s;
    expect(s.customers[0].patience).toBe(30);
    s = ap(s, { type: 'tutorial-flags', patience: true }).state;
    s = tk(s, 4).s;
    expect(s.customers[0].patience).toBe(26);
    s = ap(s, { type: 'tutorial-flags', patience: 'nope', pay: 3 }).state; // non-booleans change nothing
    expect(s.cfg).toMatchObject({ noPatience: false, noPayExpiry: true });
  });

  it('left customers free their spot at once and are pruned 3 ticks later', () => {
    let s = spawn(tutorial({ patience: true }), { patienceMax: 1 }).state;
    s = tk(s, 1).s; // angry
    expect(s.customers).toHaveLength(1);
    s = spawn(s).state;
    expect(s.customers[1].spot).toBe(0); // same spot straight away
    s = tk(s, 1).s;
    expect(s.customers.map((c) => c.id)).toEqual([1, 2]);
    s = tk(s, 1).s;
    expect(s.customers.map((c) => c.id)).toEqual([1, 2]);
    s = tk(s, 1).s;
    expect(s.customers.map((c) => c.id)).toEqual([2]);
  });

  it('customerInfo reports fractions and what is still needed', () => {
    let s = withDish({ patience: true }, { order: ['dosa', 'irani_chai'], patienceMax: 20 });
    s = tk(s, 5).s;
    expect(customerInfo(s, 1)).toEqual({ patienceFrac: 0.5, payFrac: 0, needs: ['dosa', 'irani_chai'] });
    s = ap(s, { type: 'serve', playerId: 'a', customer: 1, hand: 0 }).state;
    expect(customerInfo(s, 1).needs).toEqual(['irani_chai']);
    expect(customerInfo(s, 77)).toBe(null);
  });
});

describe('arrivals', () => {
  it('first customer at tick 2, then the schedule; a spot is the lowest free index', () => {
    let s = createGame({ players: PL, settings: { level: 1 }, seed: 3 });
    let r = tk(s, 1);
    expect(r.s.customers).toEqual([]);
    r = tk(r.s, 1);
    expect(r.ev).toContainEqual({ type: 'customer-arrive', customer: 1, spot: 0 });
    expect(r.s.customers[0]).toMatchObject({ arrivedAt: 2, spot: 0 });
  });

  it('no free spot: waits ARRIVAL_RETRY ticks, then is turned away without a penalty', () => {
    let s = createGame({ players: PL, settings: { level: 1 }, seed: 3 });
    s = { ...s, cfg: { ...s.cfg, spots: 0 } };
    const r = tk(s, 2 + ARRIVAL_RETRY);
    expect(r.s.customers).toEqual([]);
    expect(types(r.ev).filter((t) => t === 'customer-turned-away')).toHaveLength(1);
    expect(r.s.lives).toBe(LIVES);
    expect(r.s.lost).toBe(0);
    const before = tk(s, 1 + ARRIVAL_RETRY);
    expect(types(before.ev)).not.toContain('customer-turned-away');
  });

  it('spawn is tutorial only and validated', () => {
    const s = createGame({ players: PL, settings: { level: 1 }, seed: 1 });
    expect(applyAction(s, { type: 'spawn', customer: { order: ['dosa'] } }).error).toBeTruthy();
    expect(applyAction(s, { type: 'tutorial-flags', patience: true }).error).toBeTruthy();
    const t = tutorial();
    const bad = [
      undefined, null, 5, [], {}, { order: [] }, { order: ['pizza'] }, { order: ['poori'] }, { order: [5] }, { order: ['dosa'], kind: 'ghost' },
      { order: ['dosa'], kind: '__proto__' }, { order: ['dosa', 'dosa', 'dosa', 'dosa', 'dosa'] },
    ];
    for (const customer of bad) {
      const r = applyAction(t, { type: 'spawn', customer });
      expect(r.state).toBe(t);
      expect(r.error).toBeTruthy();
    }
    let u = t;
    for (let i = 0; i < 3; i++) u = spawn(u).state;
    expect(applyAction(u, { type: 'spawn', customer: { order: ['dosa'] } }).error).toBe('No free spot');
    const r = ap(t, { type: 'spawn', customer: { order: ['dosa'], spot: 2, name: 'Gopal garu', patienceMax: 12 } });
    expect(r.events).toEqual([{ type: 'customer-arrive', customer: 1, spot: 2 }, { type: 'tutorial-spawn', customer: 1 }]);
    expect(r.state.customers[0]).toMatchObject({ name: 'Gopal garu', patienceMax: 12, spot: 2 });
  });
});

describe('lives, closing and the end of the shift', () => {
  it('doing nothing closes the centre after LIVES lost customers', () => {
    let s = createGame({ players: PL, settings: { level: 1 }, seed: 2 });
    const ev = [];
    while (!isOver(s)) {
      const r = ap(s, { type: 'tick' });
      s = r.state;
      ev.push(...r.events);
    }
    expect(s.status).toBe('closed');
    expect(s.lives).toBe(0);
    expect(s.stars).toBe(0);
    expect(ev.filter((e) => e.type === 'life-lost').map((e) => e.lives)).toEqual([4, 3, 2, 1, 0]);
    expect(ev.at(-1)).toEqual({ type: 'shift-end', status: 'closed', stars: 0 });
    const res = result(s);
    expect(res).toMatchObject({ winnerId: null, reason: 'closed', stars: 0, money: 0, level: 1 });
    expect(res.standings.map((r) => r.rank)).toEqual([2, 2]);
    expect(isOver(s)).toBe(true);
    const after = applyAction(s, { type: 'tick' });
    expect(after.state).toBe(s);
    expect(after.error).toBeTruthy();
    expect(applyAction(s, { type: 'emote', playerId: 'a', e: 'fire' }).error).toBeTruthy();
  });

  it('at the shift end the crowd stops, and it is done once everyone has left', () => {
    let s = createGame({ players: PL, settings: { level: 1 }, seed: 1 });
    s = { ...s, tick: s.shiftTicks - 1, money: 500 };
    s = tk(s, 1).s;
    expect(s.status).toBe('done');
    expect(s.schedule).toEqual([]);

    // a customer still in the stall keeps the shift open
    let t = createGame({ players: PL, settings: { level: 1 }, seed: 1 });
    t = tk(t, 3).s;
    expect(t.customers).toHaveLength(1);
    t = { ...t, tick: t.shiftTicks, schedule: [], money: 700 };
    t = tk(t, 1).s;
    expect(t.status).toBe('playing');
    t = { ...t, customers: t.customers.map((c) => ({ ...c, st: 'paying', payLeft: 9, tip: 0 })) };
    const r = ap(t, { type: 'collect', playerId: 'b', customer: t.customers[0].id });
    expect(r.state.status).toBe('done'); // the last collect ends it at once
    expect(r.events.at(-1)).toMatchObject({ type: 'shift-end', status: 'done' });
  });

  it('stars follow PACE and coopScale; the result shares the rank', () => {
    const play = (level, pace, players, money) => {
      let s = createGame({ players: players.map((id) => ({ id })), settings: { level, pace }, seed: 1 });
      s = { ...s, tick: s.shiftTicks - 1, money };
      s.players[players[0]].earned = money;
      return tk(s, 1).s;
    };
    const t = starTargets(4, 'normal', 1);
    expect(t).toEqual(LEVELS[4].stars);
    expect(play(4, 'normal', ['a'], t[0] - 1).stars).toBe(0);
    expect(play(4, 'normal', ['a'], t[0]).stars).toBe(1);
    expect(play(4, 'normal', ['a'], t[1]).stars).toBe(2);
    expect(play(4, 'normal', ['a'], t[2]).stars).toBe(3);
    // rush wants 20% more, relaxed 15% less, a pair wants coopScale(2) more
    expect(play(4, 'rush', ['a'], t[0]).stars).toBe(0);
    expect(play(4, 'rush', ['a'], Math.round(t[0] * PACE.rush.stars)).stars).toBe(1);
    expect(play(4, 'relaxed', ['a'], Math.round(t[0] * PACE.relaxed.stars)).stars).toBe(1);
    expect(play(4, 'normal', ['a', 'b'], t[0]).stars).toBe(0);
    expect(play(4, 'normal', ['a', 'b'], Math.round(t[0] * coopScale(2))).stars).toBe(1);
    const won = play(4, 'normal', ['a', 'b'], Math.round(t[2] * coopScale(2)));
    const res = result(won);
    expect(res).toMatchObject({ stars: 3, reason: 'cleared', winnerId: 'a' });
    expect(res.standings.map((r) => [r.id, r.rank])).toEqual([['a', 1], ['b', 1]]);
    expect(res.standings[0].score).toBe(Math.round(t[2] * coopScale(2)));
    const failed = result(play(4, 'normal', ['a', 'b'], 0));
    expect(failed).toMatchObject({ stars: 0, reason: 'closed', winnerId: null });
    expect(failed.standings.map((r) => r.rank)).toEqual([2, 2]);
  });

  it('the tutorial always completes when its shift runs out', () => {
    let s = tutorial();
    while (!isOver(s)) s = ap(s, { type: 'tick' }).state;
    expect(s.tick).toBe(LEVELS[0].shiftTicks);
    expect(s.status).toBe('done');
    expect(result(s)).toMatchObject({ reason: 'tutorial', stars: 3 });
    expect(result(s).winnerId).toBeTruthy();
  });

  it('a tutorial with a frozen customer is still sent home eventually', () => {
    let s = spawn(tutorial()).state;
    let guard = 0;
    while (!isOver(s) && guard++ < 2000) s = ap(s, { type: 'tick' }).state;
    expect(s.status).toBe('done');
    expect(s.tick).toBeGreaterThan(s.shiftTicks);
  });
});

describe('small actions', () => {
  it('discard drops a held dish', () => {
    let s = createGame({ players: PL, settings: { level: 1 }, seed: 1 });
    s = cook(s, 'a', 'chai1', 0, 'irani_chai').state;
    s = tk(s, 4).s;
    s = ap(s, { type: 'take', playerId: 'a', station: 'chai1', slot: 0 }).state;
    expect(applyAction(s, { type: 'discard', playerId: 'a', hand: 1 }).error).toBeTruthy();
    expect(applyAction(s, { type: 'discard', playerId: 'a', hand: -1 }).error).toBeTruthy();
    expect(applyAction(s, { type: 'discard', playerId: 'a', hand: 0.5 }).error).toBeTruthy();
    const r = ap(s, { type: 'discard', playerId: 'a', hand: 0 });
    expect(r.events).toEqual([{ type: 'discard', dish: 'irani_chai', by: 'a' }]);
    expect(r.state.players.a.hands).toEqual([]);
  });

  it('move accepts null, stations, spot:N and bin; refuses everything else', () => {
    let s = createGame({ players: PL, settings: { level: 1 }, seed: 1 }); // 3 spots, tawa1 + chai1
    for (const to of ['tawa1', 'spot:0', 'spot:2', 'bin', null, 'chai1']) {
      const r = ap(s, { type: 'move', playerId: 'a', to });
      expect(r.state.players.a.at).toBe(to);
      expect(r.events).toEqual([]);
      s = r.state;
    }
    const same = ap(s, { type: 'move', playerId: 'a', to: null });
    s = same.state;
    expect(ap(s, { type: 'move', playerId: 'a', to: null }).state).toBe(s); // already there: a no-op
    const bad = ['__proto__', 'constructor', 'spot:3', 'spot:99', 'spot:-1', 'spot:01', 'spot:', 'steamer1', 'tawa2', 'kadai1', '', 5, 0, NaN, {}, [], ['tawa1'], true, { toString: 1 }];
    for (const to of bad) {
      const r = applyAction(s, { type: 'move', playerId: 'a', to });
      expect(r.state, JSON.stringify(to) ?? typeof to).toBe(s);
      expect(r.error).toBeTruthy();
      expect(r.events).toEqual([]);
    }
  });

  it('emote keeps only the last few and expires old ones', () => {
    let s = createGame({ players: PL, settings: { level: 1 }, seed: 1 });
    for (const e of ['thumbs', 'fire', 'help', 'thanks', 'fire', 'thumbs']) s = ap(s, { type: 'emote', playerId: 'b', e }).state;
    expect(s.emotes).toHaveLength(4);
    expect(ap(s, { type: 'emote', playerId: 'a', e: 'fire' }).events).toEqual([{ type: 'emote', by: 'a', e: 'fire' }]);
    for (const e of ['rude', '', 5, null, undefined, {}]) expect(applyAction(s, { type: 'emote', playerId: 'a', e }).error).toBeTruthy();
    s = tk(s, 8).s;
    expect(s.emotes).toEqual([]);
  });

  it('a duplicated tick (with the tick it advances from) is a harmless no-op', () => {
    let s = createGame({ players: PL, settings: { level: 1 }, seed: 1 });
    s = ap(s, { type: 'tick', tick: 0 }).state;
    expect(s.tick).toBe(1);
    const dup = applyAction(s, { type: 'tick', tick: 0 });
    expect(dup.state).toBe(s);
    expect(dup.error).toBe('Stale tick');
    expect(ap(s, { type: 'tick', tick: 1 }).state.tick).toBe(2);
  });

  it('hostile actions never throw and never change anything', () => {
    const s = createGame({ players: PL, settings: { level: 1 }, seed: 1 });
    const junk = [
      undefined, null, 0, 'tick', [], () => {}, {}, { type: 5 }, { type: 'nope' }, { type: '__proto__' }, { type: 'constructor' },
      { type: 'hasOwnProperty' }, { type: 'take' }, { type: 'serve', playerId: 'a' }, { type: 'collect', playerId: 'a', customer: {} },
      { type: 'move', playerId: ['a'], to: null }, { type: 'discard', playerId: 'a' }, { type: 'emote', playerId: 'a' },
    ];
    for (const a of junk) {
      let r;
      expect(() => { r = applyAction(s, a); }).not.toThrow();
      expect(r.state).toBe(s);
      expect(r.events).toEqual([]);
      expect(typeof r.error).toBe('string');
    }
    for (const bad of [null, undefined, 3, 'x', {}]) {
      expect(() => applyAction(bad, { type: 'tick' })).not.toThrow();
      expect(applyAction(bad, { type: 'tick' }).error).toBeTruthy();
    }
  });
});

describe('determinism and size', () => {
  it('same seed + same actions = same game; a different seed = a different crowd', () => {
    const run = (seed) => {
      let s = createGame({ players: PL, settings: { level: 4 }, seed });
      for (let i = 0; i < 60; i++) {
        if (i % 7 === 0) s = applyAction(s, { type: 'cook', playerId: 'a', station: 'tawa1', slot: i % 3, dish: 'dosa' }).state;
        s = ap(s, { type: 'tick' }).state;
      }
      return s;
    };
    expect(run(11)).toEqual(run(11));
    expect(run('abc')).toEqual(run('abc'));
    expect(run(11).customers.map((c) => c.order)).not.toEqual(run(12).customers.map((c) => c.order));
  });

  it('the serialised state stays small even in a full festival rush', () => {
    let s = createGame({ players: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: 'Player ' + id })), settings: { level: 12, pace: 'rush' }, seed: 9 });
    let max = 0;
    for (let i = 0; i < 120; i++) {
      s = applyAction(s, { type: 'tick' }).state;
      max = Math.max(max, JSON.stringify(s).length);
    }
    expect(max).toBeLessThan(5000); // the worst case: 4 players, 6 customers, 5 stations, nobody playing
    expect(DISHES.dosa.cook).toBe(5);
  });
});
