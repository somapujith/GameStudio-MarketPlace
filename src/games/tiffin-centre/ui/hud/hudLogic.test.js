import { standX } from '@shared/tiffin-centre/movement.js';
import { describe, it, expect } from 'vitest';
import {
  hourFromState, formatClock, daypartView, shiftFrac, formatLeft, starTargets, starBar, tickFrac, easeCount, urgency,
  patienceFracAt, patienceLeftSecs, payFracAt, payLeftSecs, activeCustomers, needsOf, ticketModel, serveHandFor, effectiveHand,
  urgentPaying, stationDishes, stationList, slotProgress, availability, chipTone, availabilityLabel, bestTarget, runOutAlerts,
  decideAction, dishForKey, walkStops, nextStop, nearestTarget, refineAction, pendingLabel, pendingKeys, placeName, spotKeys, eventNotice, patienceWarnings,
  playerChanges, teammates, heartsLabel, slotTarget, targetKey, ticketFrame,
} from './hudLogic.js';
import { mkState, mkCustomer, mkSlot } from './testState.js';

describe('clock, daypart and shift progress', () => {
  it('follows the hour from the state (lerp over the shift)', () => {
    expect(hourFromState(mkState({ tick: 0 }))).toBeCloseTo(6);
    expect(hourFromState(mkState({ tick: 100 }))).toBeCloseTo(9.5);
    expect(hourFromState(mkState({ tick: 50 }))).toBeCloseTo(7.75);
    expect(hourFromState(mkState({ tick: 50 }), 0.5)).toBeGreaterThan(7.75);
  });
  it('formats 12 hour clock and picks day parts with icons', () => {
    expect(formatClock(7.75).label).toBe('7:45 AM');
    expect(formatClock(0).label).toBe('12:00 AM');
    expect(formatClock(13.5).label).toBe('1:30 PM');
    expect(daypartView(6).icon).toBe('sunrise');
    expect(daypartView(12).icon).toBe('sun');
    expect(daypartView(17).icon).toBe('chai');
    expect(daypartView(22).icon).toBe('moon');
  });
  it('shift fraction and time left', () => {
    expect(shiftFrac(mkState())).toBeCloseTo(0.2);
    expect(formatLeft(mkState({ tick: 20, shiftTicks: 200 }))).toBe('3:00');
    expect(formatLeft(mkState({ tick: 300, shiftTicks: 200 }))).toBe('0:00');
  });
  it('star targets scale with pace and team size, tutorial has none', () => {
    const solo = starTargets(mkState({ level: 1, order: ['me'] }));
    expect(solo).toHaveLength(3);
    expect(solo[0]).toBeLessThan(solo[2]);
    const duo = starTargets(mkState({ level: 1, order: ['me', 'u2'], pace: 'rush' }));
    expect(duo[2]).toBeGreaterThan(solo[2]);
    expect(starTargets(mkState({ level: 0 }))).toBeNull();
  });
  it('star bar fill, ticks and earned stars', () => {
    const bar = starBar(330, [200, 320, 440]);
    expect(bar.earned).toBe(2);
    expect(bar.ticks[2]).toBe(1);
    expect(bar.ticks[0]).toBeCloseTo(200 / 440);
    expect(bar.fill).toBeCloseTo(0.75);
    expect(starBar(10, null)).toBeNull();
  });
});

describe('interpolation helpers', () => {
  it('tickFrac clamps while playing and freezes otherwise', () => {
    expect(tickFrac(1500, 1000, 'playing')).toBeCloseTo(0.5);
    expect(tickFrac(9000, 1000, 'playing')).toBe(1);
    expect(tickFrac(900, 1000, 'playing')).toBe(0);
    expect(tickFrac(1500, 1000, 'paused', 0.3)).toBe(0.3);
    expect(tickFrac(1500, undefined, 'playing')).toBe(0);
  });
  it('easeCount moves toward the target and snaps', () => {
    expect(easeCount(0, 100, 0.05)).toBeGreaterThan(0);
    expect(easeCount(0, 100, 0.05)).toBeLessThan(100);
    expect(easeCount(99.8, 100, 0.016)).toBe(100);
  });
});

describe('urgency and timers', () => {
  it('green, amber, red; shakes under 25 percent', () => {
    expect(urgency(0.9).tone).toBe('ok');
    expect(urgency(0.4).tone).toBe('warn');
    expect(urgency(0.2)).toMatchObject({ tone: 'crit', shake: true });
    expect(urgency(0.4).shake).toBe(false);
  });
  it('only a waiting customer drains patience, and the tutorial can freeze it', () => {
    const w = mkCustomer({ patience: 20, patienceMax: 40 });
    const s = mkState();
    expect(patienceFracAt(w, s, 0)).toBeCloseTo(0.5);
    expect(patienceFracAt(w, s, 1)).toBeCloseTo(19 / 40);
    expect(patienceFracAt({ ...w, st: 'eating' }, s, 1)).toBeCloseTo(0.5);
    expect(patienceFracAt(w, mkState({ cfg: { noPatience: true } }), 1)).toBeCloseTo(0.5);
    expect(patienceLeftSecs(w, s, 0)).toBe(20);
    expect(patienceLeftSecs(w, s, 0.5)).toBe(20);
    expect(patienceLeftSecs(w, s, 1)).toBe(19);
  });
  it('pay window counts down and can be frozen', () => {
    const p = mkCustomer({ st: 'paying', payLeft: 9 });
    expect(payFracAt(p, mkState(), 0)).toBe(1);
    expect(payFracAt(p, mkState(), 1)).toBeCloseTo(8 / 9);
    expect(payFracAt(p, mkState({ cfg: { noPayExpiry: true } }), 1)).toBe(1);
    expect(payLeftSecs({ ...p, payLeft: 3 }, mkState(), 0.2)).toBe(3);
    expect(payLeftSecs({ ...p, payLeft: 3 }, mkState(), 1)).toBe(2);
  });
});

describe('ticketFrame (the coin ring)', () => {
  const s = mkState();
  it('waiting shows patience with its urgency', () => {
    expect(ticketFrame(mkCustomer({ patience: 30, patienceMax: 40 }), s, 0)).toMatchObject({ mode: 'wait', tone: 'ok', shake: false, secs: 30 });
    expect(ticketFrame(mkCustomer({ patience: 8, patienceMax: 40 }), s, 0)).toMatchObject({ tone: 'crit', shake: true });
  });
  it('eating fills slowly', () => {
    const f = ticketFrame(mkCustomer({ st: 'eating', eatLeft: 2 }), s, 0);
    expect(f.mode).toBe('eat');
    expect(f.p).toBeCloseTo(0.5);
  });
  it('paying counts the window down and goes red at 3 s', () => {
    expect(ticketFrame(mkCustomer({ st: 'paying', payLeft: 9 }), s, 0)).toMatchObject({ mode: 'pay', tone: 'ok', secs: 9 });
    expect(ticketFrame(mkCustomer({ st: 'paying', payLeft: 5 }), s, 0).tone).toBe('warn');
    expect(ticketFrame(mkCustomer({ st: 'paying', payLeft: 3 }), s, 0)).toMatchObject({ tone: 'crit', shake: true });
  });
});

describe('tickets', () => {
  const customers = [
    mkCustomer({ id: 3, spot: 2 }),
    mkCustomer({ id: 1, spot: 0, order: ['dosa', 'irani_chai'], got: ['irani_chai'] }),
    mkCustomer({ id: 2, spot: 1, st: 'left' }),
    mkCustomer({ id: 4, spot: 1, st: 'paying', payLeft: 5, order: ['dosa'], got: ['dosa'] }),
  ];
  it('orders active tickets by spot and drops left customers', () => {
    expect(activeCustomers(mkState({ customers })).map((c) => c.id)).toEqual([1, 4, 3]);
  });
  it('needs is order minus got as a multiset', () => {
    expect(needsOf(mkCustomer({ order: ['dosa', 'dosa'], got: ['dosa'] }))).toEqual(['dosa']);
    expect(needsOf(customers[1])).toEqual(['dosa']);
  });
  it('ticket chips mark served dishes and dishes in my hands', () => {
    const t = ticketModel(customers[1], mkState(), [{ dish: 'dosa', q: 'good' }]);
    expect(t.chips.map((c) => [c.dish, c.served, c.inHand])).toEqual([['dosa', false, true], ['irani_chai', true, false]]);
    expect(t.chips[0].te).toBe('దోశ');
    expect(t.needs).toEqual(['dosa']);
    expect(t.initial).toBe('R');
  });
  it('chooses the hand to serve with: selected if needed, else any needed, else none', () => {
    const c = mkCustomer({ order: ['dosa'] });
    const hands = [{ dish: 'irani_chai', q: 'ok' }, { dish: 'dosa', q: 'good' }];
    expect(serveHandFor(c, hands, 0)).toBe(1);
    expect(serveHandFor(c, hands, 1)).toBe(1);
    expect(serveHandFor(c, [hands[0]], 0)).toBe(-1);
    expect(effectiveHand([null, hands[1]], 0)).toBe(1);
    expect(effectiveHand([], 0)).toBe(-1);
  });
  it('finds the paying customer who leaves first', () => {
    const s = mkState({ customers: [mkCustomer({ id: 1, st: 'paying', payLeft: 6 }), mkCustomer({ id: 2, st: 'paying', payLeft: 2 })] });
    expect(urgentPaying(s).id).toBe(2);
  });
});

describe('stations and slots', () => {
  it('lists only dishes of that station kind that are on the level menu, numbered for keys', () => {
    expect(stationDishes(mkState(), 'tawa1').map((d) => [d.id, d.key])).toEqual([['dosa', 1], ['masala_dosa', 2]]);
    expect(stationDishes(mkState(), 'chai1').map((d) => d.id)).toEqual(['irani_chai']);
    expect(stationDishes(mkState({ cfg: { menu: ['irani_chai'] } }), 'tawa1')).toEqual([]);
  });
  it('lists the shift stations with slot counts', () => {
    const s = mkState();
    s.stations.tawa1.slots[0] = mkSlot({ st: 'ready', dish: 'dosa' });
    const list = stationList(s);
    expect(list.map((x) => x.id)).toEqual(['tawa1', 'steamer1', 'chai1']);
    expect(list[0]).toMatchObject({ free: 2, ready: 1, name: 'Dosa tawa' });
    expect(list[1].slots).toHaveLength(4);
  });
  it('interpolates cooking and burning progress', () => {
    const s = mkState({ tick: 12 });
    s.stations.tawa1.slots[0] = mkSlot({ st: 'cooking', dish: 'dosa', t0: 10, readyAt: 15, burnAt: 22 });
    s.stations.tawa1.slots[1] = mkSlot({ st: 'ready', dish: 'dosa', t0: 5, readyAt: 10, burnAt: 17 });
    expect(slotProgress(s, 'tawa1', 0, 0).progress).toBeCloseTo(0.4);
    expect(slotProgress(s, 'tawa1', 0, 0.5).progress).toBeCloseTo(0.5);
    expect(slotProgress(s, 'tawa1', 0, 0).secs).toBe(3);
    expect(slotProgress(s, 'tawa1', 1, 0).burn).toBeCloseTo(2 / 7);
    expect(slotProgress(s, 'tawa1', 2, 0).st).toBe('empty');
  });
});

describe('availability', () => {
  const stocked = () => {
    const s = mkState({ tick: 20 });
    s.stations.tawa1.slots = [
      mkSlot({ st: 'ready', dish: 'dosa' }),
      mkSlot({ st: 'cooking', dish: 'masala_dosa', t0: 18, readyAt: 25 }),
      mkSlot({ st: 'burnt', dish: 'dosa' }),
    ];
    s.stations.chai1.slots = [mkSlot({ st: 'cooking', dish: 'irani_chai', t0: 19, readyAt: 23 }), mkSlot({ st: 'cooking', dish: 'irani_chai', t0: 15, readyAt: 21 })];
    s.players.me.hands = [{ dish: 'irani_chai', q: 'good' }];
    s.players.u2.hands = [{ dish: 'dosa', q: 'perfect' }, { dish: 'irani_chai', q: 'ok' }];
    s.customers = [
      mkCustomer({ id: 1, order: ['dosa', 'masala_dosa'], got: [] }),
      mkCustomer({ id: 2, order: ['masala_dosa', 'masala_dosa'], got: ['masala_dosa'], spot: 1 }),
      mkCustomer({ id: 3, order: ['dosa'], got: ['dosa'], st: 'eating', spot: 2 }),
    ];
    return s;
  };
  const row = (rows, d) => rows.find((r) => r.dish === d);

  it('returns a row for every dish on the menu', () => {
    expect(availability(stocked(), 'me').map((r) => r.dish)).toEqual(['dosa', 'masala_dosa', 'irani_chai', 'idly']);
  });
  it('counts ready and cooking across stations; a burnt slot is not ready', () => {
    const a = availability(stocked(), 'me');
    expect(row(a, 'dosa')).toMatchObject({ ready: 1, cooking: 0 });
    expect(row(a, 'masala_dosa')).toMatchObject({ ready: 0, cooking: 1, eta: 5 });
    expect(row(a, 'irani_chai')).toMatchObject({ cooking: 2, eta: 1 });
    const burntOnly = mkState();
    burntOnly.stations.tawa1.slots[0] = mkSlot({ st: 'burnt', dish: 'dosa' });
    expect(row(availability(burntOnly, 'me'), 'dosa').ready).toBe(0);
  });
  it('counts held dishes of every player and mine separately (co-op)', () => {
    const a = availability(stocked(), 'me');
    expect(row(a, 'irani_chai')).toMatchObject({ held: 2, heldByMe: 1 });
    expect(row(a, 'dosa')).toMatchObject({ held: 1, heldByMe: 0 });
    expect(row(availability(stocked(), 'u2'), 'dosa').heldByMe).toBe(1);
  });
  it('demand counts only dishes still needed by WAITING customers', () => {
    const a = availability(stocked(), 'me');
    expect(row(a, 'dosa').demand).toBe(1); // eating customer's dosa is already served
    expect(row(a, 'masala_dosa').demand).toBe(2);
    const eating = stocked();
    eating.customers[0].st = 'eating';
    expect(row(availability(eating, 'me'), 'masala_dosa').demand).toBe(1);
  });
  it('shortfall is demand minus ready, cooking and held, never negative', () => {
    const a = availability(stocked(), 'me');
    expect(row(a, 'masala_dosa').shortfall).toBe(1); // wants 2, one cooking
    expect(row(a, 'dosa').shortfall).toBe(0); // wants 1, 1 ready + 1 held
    expect(row(a, 'idly').shortfall).toBe(0);
  });
  it('free counts empty slots on stations of the dish kind only', () => {
    const a = availability(stocked(), 'me');
    expect(row(a, 'dosa').free).toBe(0); // 3 tawa slots: ready, cooking, burnt
    expect(row(a, 'idly').free).toBe(4);
    expect(row(a, 'irani_chai').free).toBe(0);
  });
  it('blocked when no free slot and nothing ready, urgent when a nearly-out-of-patience customer has nothing coming', () => {
    const a = availability(stocked(), 'me');
    expect(row(a, 'masala_dosa').blocked).toBe(true);
    expect(row(a, 'dosa').blocked).toBe(false); // one is ready to take
    const s = stocked();
    s.customers[1].patience = 5; // 5/40 < 25%, wants masala_dosa
    expect(row(availability(s, 'me'), 'masala_dosa').urgent).toBe(false); // one is cooking
    s.stations.tawa1.slots[1] = mkSlot({ st: 'empty' });
    expect(row(availability(s, 'me'), 'masala_dosa').urgent).toBe(true);
    expect(chipTone(row(availability(s, 'me'), 'masala_dosa'))).toBe('urgent');
    expect(chipTone(row(availability(stocked(), 'me'), 'masala_dosa'))).toBe('blocked');
    const short = stocked();
    short.stations.tawa1.slots[2] = mkSlot();
    expect(chipTone(row(availability(short, 'me'), 'masala_dosa'))).toBe('short');
    expect(chipTone(row(availability(stocked(), 'me'), 'irani_chai'))).toBe('blocked');
  });
  it('no urgency in a no-patience tutorial step', () => {
    const s = stocked();
    s.cfg.noPatience = true;
    s.customers[0].patience = 1;
    s.stations.tawa1.slots[1] = mkSlot();
    expect(row(availability(s, 'me'), 'masala_dosa').urgent).toBe(false);
  });
  it('labels read like speech', () => {
    const a = availability(stocked(), 'me');
    expect(availabilityLabel({ dish: 'masala_dosa', ready: 2, cooking: 1, held: 0, demand: 3, blocked: false })).toBe('Masala Dosa: 2 ready, 1 cooking, 3 wanted');
    expect(availabilityLabel(row(a, 'idly'))).toBe('Idly (2 pc): none ready, 0 wanted');
    expect(availabilityLabel(row(a, 'masala_dosa'))).toContain('no free slot');
  });
  it('best target: a ready slot to take first, else a free slot to cook, else none', () => {
    const s = stocked();
    expect(bestTarget(s, 'dosa')).toEqual({ mode: 'take', station: 'tawa1', slot: 0 });
    expect(bestTarget(s, 'masala_dosa')).toBeNull();
    expect(bestTarget(s, 'idly')).toEqual({ mode: 'cook', station: 'steamer1', slot: 0, dish: 'idly' });
  });
  it('announces a dish that runs out of ready stock while customers still want it', () => {
    const before = availability(stocked(), 'me');
    const s = stocked();
    s.stations.tawa1.slots[0] = mkSlot();
    const after = availability(s, 'me');
    const alerts = runOutAlerts(before, after);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].text).toContain('Plain Dosa: none ready, 1 wanted');
    expect(runOutAlerts(after, after)).toEqual([]);
    const noDemand = stocked();
    noDemand.customers = [];
    noDemand.stations.tawa1.slots[0] = mkSlot();
    expect(runOutAlerts(availability({ ...stocked(), customers: [] }, 'me'), availability(noDemand, 'me'))).toEqual([]);
  });
});

describe('decideAction (what a tap does)', () => {
  const base = () => mkState({ customers: [mkCustomer({ id: 1, order: ['dosa'] })] });
  const opts = { meId: 'me', selectedHand: 0 };

  it('empty slot opens the sheet, unless nothing here is on the menu', () => {
    expect(decideAction(base(), slotTarget('tawa1', 0), opts)).toEqual({ type: 'sheet', station: 'tawa1', slot: 0 });
    const s = mkState({ cfg: { menu: ['irani_chai'] } });
    expect(decideAction(s, slotTarget('tawa1', 0), opts).type).toBe('hint');
  });
  it('ready slot is taken at once (with a cosmetic move), refused with full hands', () => {
    const s = base();
    s.stations.tawa1.slots[1] = mkSlot({ st: 'ready', dish: 'dosa' });
    expect(decideAction(s, slotTarget('tawa1', 1), opts)).toEqual({ type: 'dispatch', action: { type: 'take', station: 'tawa1', slot: 1 }});
    s.players.me.hands = [{ dish: 'dosa', q: 'ok' }, { dish: 'dosa', q: 'ok' }];
    expect(decideAction(s, slotTarget('tawa1', 1), opts)).toEqual({ type: 'hint', text: 'Hands full' });
  });
  it('burnt slot is cleared even with full hands; cooking only hints', () => {
    const s = base();
    s.stations.tawa1.slots[0] = mkSlot({ st: 'burnt', dish: 'dosa' });
    s.stations.tawa1.slots[1] = mkSlot({ st: 'cooking', dish: 'dosa', readyAt: 30 });
    s.players.me.hands = [{ dish: 'dosa', q: 'ok' }, { dish: 'dosa', q: 'ok' }];
    expect(decideAction(s, slotTarget('tawa1', 0), opts).action).toEqual({ type: 'take', station: 'tawa1', slot: 0 });
    expect(decideAction(s, slotTarget('tawa1', 1), opts)).toEqual({ type: 'hint', text: 'Still cooking' });
  });
  it('tapping a station prefers a ready dish, then an empty slot', () => {
    const s = base();
    s.stations.tawa1.slots[2] = mkSlot({ st: 'ready', dish: 'dosa' });
    expect(decideAction(s, { kind: 'station', station: 'tawa1' }, opts).action).toEqual({ type: 'take', station: 'tawa1', slot: 2 });
    s.stations.tawa1.slots[2] = mkSlot();
    expect(decideAction(s, { kind: 'station', id: 'tawa1' }, opts)).toEqual({ type: 'sheet', station: 'tawa1', slot: 0 });
  });
  it('a station with a burnt pan clears it first (keyboard Space has no other way), then offers the empty slot', () => {
    const s = base();
    s.stations.tawa1.slots[1] = mkSlot({ st: 'burnt', dish: 'dosa' });
    expect(decideAction(s, { kind: 'station', id: 'tawa1' }, opts).action).toEqual({ type: 'take', station: 'tawa1', slot: 1 });
    s.stations.tawa1.slots[1] = mkSlot();
    expect(decideAction(s, { kind: 'station', id: 'tawa1' }, opts)).toEqual({ type: 'sheet', station: 'tawa1', slot: 0 });
  });
  it('customer: serves a needed held dish, collects when paying, explains otherwise', () => {
    const s = base();
    expect(decideAction(s, { kind: 'customer', id: 1 }, opts).text).toBe('Pick up a dish first');
    s.players.me.hands = [{ dish: 'irani_chai', q: 'ok' }];
    expect(decideAction(s, { kind: 'customer', id: 1 }, opts).text).toBe('They do not need that');
    s.players.me.hands = [{ dish: 'irani_chai', q: 'ok' }, { dish: 'dosa', q: 'good' }];
    expect(decideAction(s, { kind: 'customer', id: 1 }, opts)).toEqual({ type: 'dispatch', action: { type: 'serve', customer: 1, hand: 1 } });
    s.customers[0].st = 'paying';
    expect(decideAction(s, { kind: 'customer', id: 1 }, opts).action).toEqual({ type: 'collect', customer: 1 });
    s.customers[0].st = 'eating';
    expect(decideAction(s, { kind: 'customer', id: 1 }, opts).text).toBe('Still eating');
    expect(decideAction(s, { kind: 'customer', id: 99 }, opts)).toBeNull();
  });
  it('bin discards the selected (or first) held dish', () => {
    const s = base();
    expect(decideAction(s, { kind: 'bin' }, opts).type).toBe('hint');
    s.players.me.hands = [null, { dish: 'dosa', q: 'ok' }].filter(Boolean);
    expect(decideAction(s, { kind: 'bin' }, opts).action).toEqual({ type: 'discard', hand: 0 });
  });
});

describe('walking line and nearest target', () => {
  const s = () => mkState({ cfg: { spots: 3 }, customers: [mkCustomer({ id: 7, spot: 1, name: 'Fatima aapa' })] });
  it('lists stations, spots and the bin left to right', () => {
    const stops = walkStops(s());
    expect(stops.map((x) => x.x)).toEqual([...stops.map((x) => x.x)].sort((a, b) => a - b));
    expect(stops[0].to).toBe('spot:0');
    expect(stops.some((x) => x.to === 'tawa1')).toBe(true);
    expect(stops.at(-1).to).toBe('bin');
    expect(stops.filter((x) => x.kind === 'spot')).toHaveLength(3);
  });
  it('steps to the next stop in a direction and stops at the ends', () => {
    expect(nextStop(s(), -2.6, 1).x).toBeGreaterThan(-2.6);
    expect(nextStop(s(), -2.6, -1).x).toBeLessThan(-2.6);
    expect(nextStop(s(), -100, -1)).toBeNull();
    expect(nextStop(s(), 100, 1)).toBeNull();
    expect(nextStop(s(), 0, -1).x).toBeLessThan(0);
    expect(nextStop(s(), 0, 1).x).toBeGreaterThan(0);
  });
  it('faces the station, the customer at the spot, or the bin', () => {
    expect(nearestTarget(s(), standX('tawa1'))).toEqual({ kind: 'station', id: 'tawa1', station: 'tawa1' });
    expect(nearestTarget(s(), standX('spot:1'))).toEqual({ kind: 'customer', id: 7 });
    expect(nearestTarget(s(), standX('spot:0'), 0.05)).toBeNull(); // nobody at spot 0 (and no station there)
    expect(nearestTarget(s(), standX('bin'))).toEqual({ kind: 'bin' });
    expect(nearestTarget(s(), standX('tawa1') + 0.5, 0.2)).toBeNull();
  });
  it('re-checks a queued action when the walk ends', () => {
    const st = mkState({ customers: [mkCustomer({ id: 1, order: ['dosa'] })] });
    st.players.me.hands = [{ dish: 'irani_chai', q: 'ok' }, { dish: 'dosa', q: 'good' }];
    expect(refineAction({ type: 'serve', customer: 1, hand: 0 }, st, 'me', 0).hand).toBe(1);
    st.players.me.hands = [{ dish: 'irani_chai', q: 'ok' }];
    expect(refineAction({ type: 'serve', customer: 1, hand: 0 }, st, 'me', 0)).toBeNull();
    expect(refineAction({ type: 'collect', customer: 1 }, st, 'me')).toBeNull();
    st.stations.tawa1.slots[0] = mkSlot({ st: 'cooking', dish: 'dosa', readyAt: 30 });
    expect(refineAction({ type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' }, st, 'me').slot).toBe(1);
    expect(refineAction({ type: 'discard', hand: 3 }, st, 'me', 0).hand).toBe(0);
    expect(refineAction({ type: 'take', station: 'tawa1', slot: 0 }, st, 'me')).toEqual({ type: 'take', station: 'tawa1', slot: 0 });
  });
  it('words and keys of a pending action', () => {
    const st = s();
    expect(placeName('tawa1', st)).toBe('Dosa tawa');
    expect(placeName('spot:1', st)).toBe('Token 7');
    expect(placeName('bin', st)).toBe('the bin');
    expect(pendingLabel({ type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' }, 'tawa1', st)).toBe('Walking to Dosa tawa');
    expect(pendingLabel({ type: 'serve', customer: 7, hand: 0 }, 'spot:1', st)).toBe('Walking to serve Token 7');
    expect([...pendingKeys({ type: 'take', station: 'tawa1', slot: 2 }, 'tawa1')].sort()).toEqual(['slot:tawa1:2', 'station:tawa1']);
    expect([...pendingKeys({ type: 'collect', customer: 7 }, 'spot:1')].sort()).toEqual(['collect:7', 'ticket:7']);
    expect([...pendingKeys({ type: 'discard', hand: 0 }, 'bin')]).toEqual(['bin']);
  });
  it('number keys map to sheet rows', () => {
    const rows = stationDishes(mkState(), 'tawa1');
    expect(dishForKey(rows, '2').id).toBe('masala_dosa');
    expect(dishForKey(rows, '3')).toBeNull();
    expect(dishForKey(rows, '0')).toBeNull();
    expect(dishForKey(rows, 'a')).toBeNull();
  });
});

describe('tutorial spotlight mapping', () => {
  const s = mkState({ customers: [mkCustomer({ id: 5 }), mkCustomer({ id: 6, spot: 1, st: 'paying', payLeft: 8 })] });
  it('maps each spotlight kind to DOM keys', () => {
    expect([...spotKeys({ kind: 'station', id: 'tawa1' }, s)]).toEqual(['station:tawa1']);
    expect([...spotKeys({ kind: 'slot', id: 'tawa1', slot: 1 }, s)].sort()).toEqual(['slot:tawa1:1', 'station:tawa1']);
    expect([...spotKeys({ kind: 'customer', id: 5 }, s)]).toEqual(['ticket:5']);
    expect([...spotKeys({ kind: 'customer', id: 6 }, s)].sort()).toEqual(['collect:6', 'ticket:6']);
    expect([...spotKeys({ kind: 'customer' }, s)]).toEqual(['ticket:5']);
    expect([...spotKeys({ kind: 'hands' }, s)]).toEqual(['hands']);
    expect([...spotKeys({ kind: 'bin' }, s)]).toEqual(['bin']);
    expect(spotKeys(null, s).size).toBe(0);
    expect(spotKeys({ kind: 'customer', id: 99 }, s).size).toBe(0);
  });
});

describe('event notices', () => {
  const s = mkState({ customers: [mkCustomer({ id: 1, name: 'Ravi anna' })] });
  it('names the key moments', () => {
    expect(eventNotice({ type: 'pay-ready', customer: 1 }, s, 'me').text).toBe('Pay now! Token 1 (Ravi anna) is holding money out');
    expect(eventNotice({ type: 'pay-warning', customer: 1 }, s, 'me')).toMatchObject({ tone: 'warn', pulse: true });
    expect(eventNotice({ type: 'customer-unpaid', customer: 1, owed: 40 }, s, 'me').text).toContain('walked out without paying (-1 heart)');
    expect(eventNotice({ type: 'customer-angry', customer: 1 }, s, 'me').tone).toBe('bad');
    expect(eventNotice({ type: 'combo', combo: 3 }, s, 'me').text).toBe('Combo x3');
    expect(eventNotice({ type: 'combo', combo: 1 }, s, 'me')).toBeNull();
    expect(eventNotice({ type: 'tick' }, s, 'me')).toBeNull();
  });
  it('collect carries the amount for the +rupee pop and says who collected', () => {
    const mine = eventNotice({ type: 'collect', customer: 1, amount: 90, tip: 6, by: 'me' }, s, 'me');
    expect(mine.collect.amount).toBe(90);
    expect(mine.text).toBe('Collected ₹90 (tip ₹6)');
    expect(eventNotice({ type: 'collect', customer: 1, amount: 40, tip: 0, by: 'u2' }, s, 'me').text).toBe('Anu collected ₹40');
  });
  it('emotes name the sender and carry the emote', () => {
    expect(eventNotice({ type: 'emote', by: 'u2', e: 'fire' }, s, 'me')).toMatchObject({ text: 'Anu: On fire', emote: { by: 'u2', e: 'fire' } });
    expect(eventNotice({ type: 'emote', by: 'u2', e: 'nope' }, s, 'me')).toBeNull();
  });
  it('warns once when patience crosses 25 percent', () => {
    const prev = mkState({ customers: [mkCustomer({ id: 1, patience: 11, patienceMax: 40 })] });
    const next = mkState({ customers: [mkCustomer({ id: 1, patience: 9, patienceMax: 40 })] });
    expect(patienceWarnings(prev, next)).toHaveLength(1);
    expect(patienceWarnings(next, next)).toEqual([]);
    expect(patienceWarnings(prev, { ...next, cfg: { ...next.cfg, noPatience: true } })).toEqual([]);
  });
});

describe('players and teammates', () => {
  it('detects teammates who left or returned', () => {
    const a = [{ id: 'me', name: 'Me' }, { id: 'u2', name: 'Anu' }, { id: 'u3', name: 'Bo' }];
    expect(playerChanges(a, [a[0], a[2]], 'me')).toEqual([{ type: 'left', id: 'u2', name: 'Anu' }]);
    expect(playerChanges(a, [a[0], { ...a[1], online: false }, a[2]], 'me')).toEqual([{ type: 'left', id: 'u2', name: 'Anu' }]);
    expect(playerChanges([a[0], { ...a[1], online: false }], [a[0], a[1]], 'me')).toEqual([{ type: 'back', id: 'u2', name: 'Anu' }]);
    expect(playerChanges(a, a, 'me')).toEqual([]);
  });
  it('summarises what a teammate holds', () => {
    const st = mkState();
    st.players.u2.hands = [{ dish: 'dosa', q: 'good' }, { dish: 'irani_chai', q: 'ok' }];
    const t = teammates(st, [{ id: 'me', name: 'Me' }, { id: 'u2', name: 'Anu' }], 'me');
    expect(t).toHaveLength(1);
    expect(t[0].holding).toBe('Plain Dosa + Irani Chai');
    expect(teammates(mkState(), [{ id: 'u2', name: 'Anu' }], 'me')[0].holding).toBe('Empty hands');
  });
  it('hearts label', () => {
    expect(heartsLabel(5)).toBe('5 hearts left');
    expect(heartsLabel(1)).toBe('1 heart left');
  });
});
