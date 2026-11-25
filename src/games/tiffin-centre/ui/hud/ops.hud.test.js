// The operations layer through the HUD's decisions: what a tap does, the walk-then-act runner for the new actions, tutorial gating, notices, profit stars.
import { describe, it, expect } from 'vitest';
import { createGame, applyAction } from '@shared/tiffin-centre/index.js';
import { WORK_MS, standX, validTarget, walkSeconds } from '@shared/tiffin-centre/movement.js';
import { createActionRunner } from './actionRunner.js';
import {
  GATE_TEXT, booksView, cookReason, decideAction, eventNotice, gateDecision, isActionAllowed, nearestTarget, nextStop, pendingKeys, pendingLabel, pendingTarget, placeName,
  profitOf, qualityView, refineAction, starBar, starTargets, stationList, ticketModel, walkStops, walkToFor,
} from './hudLogic.js';
import { mkCustomer } from './testState.js';

const game = (level) => createGame({ players: [{ id: 'me', name: 'Me' }], settings: { level, pace: 'normal' }, seed: 5 });
const money = (n) => `₹${n}`;

describe('stars are PROFIT', () => {
  it('the star bar compares profit (cash minus cost) with the targets', () => {
    const s = game(3);
    const t = starTargets(s);
    expect(t).toEqual([330, 570, 820]);
    s.money = 400;
    s.cost = 100;
    s.profit = 300;
    expect(profitOf(s)).toBe(300);
    expect(starBar(profitOf(s), t).earned).toBe(0); // 400 cash would have been one star: 300 profit is none
    s.profit = 340;
    expect(starBar(profitOf(s), t)).toMatchObject({ earned: 1, targets: t });
    s.profit = 900;
    expect(starBar(profitOf(s), t)).toMatchObject({ earned: 3, fill: 1 });
    s.profit = -40;
    expect(starBar(-40, t).fill).toBe(0);
  });

  it('profit falls back to cash minus cost for a state without the books, and is hidden in the tutorial', () => {
    expect(profitOf({ money: 120 })).toBe(120);
    expect(profitOf({ money: 120, cost: 30 })).toBe(90);
    expect(booksView({ money: 120, cost: 30, cfg: {} })).toEqual({ cash: 120, cost: 30, profit: 90, show: true });
    expect(booksView(game(0)).show).toBe(false);
    expect(starTargets(game(0))).toBeNull();
  });
});

describe('what a tap on the back counter and the gas stand does', () => {
  it('the prep counter opens its sheet; a ready job is collected (walk, then act); a slot tap picks that job', () => {
    const s = game(5);
    expect(decideAction(s, { kind: 'station', id: 'prep1' }, { meId: 'me' })).toEqual({ type: 'prepsheet', station: 'prep1' });
    expect(decideAction(s, { kind: 'slot', station: 'prep1', slot: 1 }, { meId: 'me' })).toEqual({ type: 'prepsheet', station: 'prep1' });
    s.stations.prep1.slots[1] = { st: 'ready', item: 'sambar', t0: 0, readyAt: 5, by: 'me' };
    expect(decideAction(s, { kind: 'station', id: 'prep1' }, { meId: 'me' })).toEqual({ type: 'dispatch', action: { type: 'collectPrep', station: 'prep1', slot: 1 } });
    expect(decideAction(s, { kind: 'slot', station: 'prep1', slot: 0 }, { meId: 'me' })).toEqual({ type: 'prepsheet', station: 'prep1' });
    expect(decideAction(game(0), { kind: 'station', id: 'prep1' }, { meId: 'me' })).toEqual({ type: 'hint', text: 'Nothing to prepare today' }); // level 0 has none of it
  });

  it('the cylinder: Swap when it can be changed, the reason when it cannot', () => {
    const s = game(3);
    expect(decideAction(s, { kind: 'gas' }, { meId: 'me' })).toEqual({ type: 'dispatch', action: { type: 'swapGas' } });
    s.gas.u = 1000;
    expect(decideAction(s, { kind: 'gas' }, { meId: 'me' })).toEqual({ type: 'hint', text: 'The cylinder is still heavy' });
    expect(decideAction(game(2), { kind: 'gas' }, { meId: 'me' })).toEqual({ type: 'hint', text: 'No cylinder here' });
  });

  it('a tap on a cooking slot hints at tending when the pan needs it', () => {
    const s = game(3);
    s.stations.tawa1.slots[0] = { st: 'cooking', dish: 'dosa', t0: 0, readyAt: 9, burnAt: 16, by: 'me' };
    expect(decideAction(s, { kind: 'slot', station: 'tawa1', slot: 0 }, { meId: 'me' })).toEqual({ type: 'hint', text: 'Still cooking' });
    s.stations.tawa1.gunk = 50;
    expect(decideAction(s, { kind: 'slot', station: 'tawa1', slot: 0 }, { meId: 'me' }).text).toMatch(/press T/);
  });
});

describe('the dock lists only cooking stations; the walk line knows the back counter and the gas stand', () => {
  it('stationList leaves the prep counter to its own group', () => {
    const s = game(5);
    expect(s.cfg.stations).toContain('prep1');
    expect(stationList(s).map((x) => x.id)).not.toContain('prep1');
    expect(stationList(s).map((x) => x.id)).toContain('tawa1');
  });
  it('walkStops adds prep1 and, on gas levels, the cylinder stand; level 2 has no gas stop', () => {
    expect(walkStops(game(5)).some((x) => x.to === 'gas')).toBe(true);
    expect(walkStops(game(5)).some((x) => x.to === 'prep1')).toBe(true);
    expect(walkStops(game(2)).some((x) => x.to === 'gas')).toBe(false);
    expect(validTarget('gas', game(5).cfg.stations, 6, true)).toBe(true);
    expect(validTarget('gas', game(2).cfg.stations, 6, false)).toBe(false);
    const s = game(5);
    expect(nextStop(s, 0, -1)).toBeTruthy();
    expect(nearestTarget(s, standX('gas'))).toEqual({ kind: 'gas' });
    expect(nearestTarget(s, standX('prep1'))).toEqual({ kind: 'station', id: 'prep1', station: 'prep1' });
  });
  it('place names, labels, keys, look targets and walk targets of the new jobs', () => {
    const s = game(5);
    expect(placeName('gas', s)).toBe('the gas stand');
    expect(placeName('prep1', s)).toBe('Prep counter');
    expect(pendingLabel({ type: 'swapGas' }, 'gas', s)).toBe('Walking to change the cylinder');
    expect(pendingLabel({ type: 'tend', station: 'tawa1' }, 'tawa1', s)).toBe('Walking to tend Dosa tawa');
    expect(pendingLabel({ type: 'prep', station: 'prep1', slot: 0, item: 'oil' }, 'prep1', s)).toBe('Walking to the prep counter');
    expect([...pendingKeys({ type: 'tend', station: 'tawa1' }, 'tawa1')]).toEqual(['station:tawa1', 'tend:tawa1']);
    expect([...pendingKeys({ type: 'prep', station: 'prep1' }, 'prep1')]).toEqual(['station:prep1']);
    expect([...pendingKeys({ type: 'swapGas' }, 'gas')]).toEqual(['gas']);
    // the scene turns the head round to the back counter
    expect(pendingTarget({ type: 'prep', station: 'prep1', slot: 0 })).toMatchObject({ kind: 'station', id: 'prep1', station: 'prep1' });
    expect(pendingTarget({ type: 'collectPrep', station: 'prep1', slot: 0 })).toMatchObject({ kind: 'station', id: 'prep1' });
    expect(pendingTarget({ type: 'tend', station: 'kadai1' })).toMatchObject({ kind: 'station', id: 'kadai1' });
    expect(pendingTarget({ type: 'swapGas' })).toMatchObject({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) });
    expect(walkToFor({ kind: 'gas' }, s)).toBe('gas');
    expect(walkToFor({ kind: 'gas' }, game(2))).toBeNull();
  });
});

describe('tutorial gating of the new actions', () => {
  const driver = (allowed) => ({ allows: (type) => !allowed || !['move', 'cook', 'take', 'serve', 'collect', 'discard'].includes(type) || allowed.includes(type) });
  it('a step that teaches only cooking still never blocks an operations action (the driver lets unknown types through)', () => {
    const d = driver(['cook']);
    const gate = (a) => isActionAllowed((x) => d.allows(x.type), a);
    expect(gate({ type: 'cook' })).toBe(true);
    expect(gate({ type: 'serve' })).toBe(false);
    for (const type of ['prep', 'collectPrep', 'tend', 'swapGas', 'board', 'buy']) expect(gate({ type })).toBe(true);
  });
  it('a plain allowed-list gates them by name, and the gate turns a refused tap into a walk or the friendly "not yet"', () => {
    const s = game(5);
    expect(isActionAllowed(['cook'], { type: 'prep' })).toBe(false);
    expect(isActionAllowed(['prep', 'collectPrep', 'tend'], { type: 'tend' })).toBe(true);
    const sheet = decideAction(s, { kind: 'station', id: 'prep1' }, { meId: 'me' });
    expect(gateDecision(sheet, { kind: 'station', id: 'prep1' }, ['cook'], s)).toEqual({ blocked: true });
    expect(gateDecision(sheet, { kind: 'station', id: 'prep1' }, ['move'], s)).toEqual({ walk: 'prep1' });
    expect(gateDecision(sheet, { kind: 'station', id: 'prep1' }, ['prep'], s)).toEqual({ go: sheet });
    const swap = decideAction(s, { kind: 'gas' }, { meId: 'me' });
    expect(gateDecision(swap, { kind: 'gas' }, ['move'], s)).toEqual({ walk: 'gas' });
    expect(GATE_TEXT).toBe('Chotu says: not yet!');
  });
});

describe('refine: the queued job is re-checked when the walk ends', () => {
  it('prep moves to a free slot, or is dropped when both are taken; collectPrep finds a ready job', () => {
    const s = game(5);
    const prep = { type: 'prep', station: 'prep1', slot: 0, item: 'batter_dosa' };
    expect(refineAction(prep, s, 'me')).toEqual(prep);
    s.stations.prep1.slots[0] = { st: 'cooking', item: 'oil', t0: 0, readyAt: 3, by: 'u2' };
    expect(refineAction(prep, s, 'me')).toEqual({ ...prep, slot: 1 });
    s.stations.prep1.slots[1] = { st: 'cooking', item: 'oil', t0: 0, readyAt: 3, by: 'u2' };
    expect(refineAction(prep, s, 'me')).toBeNull();
    const col = { type: 'collectPrep', station: 'prep1', slot: 0 };
    expect(refineAction(col, s, 'me')).toBeNull(); // nothing is ready any more
    s.stations.prep1.slots[1] = { st: 'ready', item: 'oil', t0: 0, readyAt: 3, by: 'u2' };
    expect(refineAction(col, s, 'me')).toEqual({ ...col, slot: 1 });
    for (const a of [{ type: 'tend', station: 'tawa1' }, { type: 'swapGas' }, { type: 'buy', item: 'oil', n: 5 }]) expect(refineAction(a, s, 'me')).toEqual(a);
  });
});

describe('the action runner walks, then does the back-counter, tend and gas jobs', () => {
  function rig(level) {
    const state = game(level);
    const clock = { t: 0 };
    const sent = [];
    const refused = [];
    const runner = createActionRunner({
      now: () => clock.t,
      getState: () => state,
      meId: 'me',
      dispatch: (a) => {
        sent.push({ ...a, t: clock.t });
        if (a.type === 'move') state.players.me.at = a.to;
        return true;
      },
      refine: (a, s) => refineAction(a, s, 'me', 0),
      onRefused: (a) => refused.push(a),
    });
    const run = (ms, step = 16) => {
      for (let i = 0; i < ms; i += step) {
        clock.t += step;
        runner.update();
      }
    };
    return { state, clock, sent, refused, runner, run };
  }
  const moves = (r) => r.sent.filter((a) => a.type === 'move');
  const real = (r) => r.sent.filter((a) => a.type !== 'move');

  it('prep: walks to prep1 first, then dispatches the job', () => {
    const r = rig(5);
    r.runner.update();
    r.runner.request({ type: 'prep', station: 'prep1', slot: 0, item: 'batter_dosa' });
    expect(moves(r)).toEqual([expect.objectContaining({ to: 'prep1' })]);
    expect(real(r)).toHaveLength(0);
    expect(r.runner.snapshot().pending.label).toBe('Walking to the prep counter');
    r.run(walkSeconds(0, standX('prep1')) * 1000 - 80);
    expect(real(r)).toHaveLength(0);
    r.run(200);
    expect(real(r)).toEqual([expect.objectContaining({ type: 'prep', station: 'prep1', slot: 0, item: 'batter_dosa' })]);
  });

  it('swapGas walks to the stand on a gas level; on a level without one there is nowhere to walk and the engine answers', () => {
    const r = rig(5);
    r.runner.update();
    r.runner.request({ type: 'swapGas' });
    expect(moves(r)).toEqual([expect.objectContaining({ to: 'gas' })]);
    r.run(walkSeconds(0, standX('gas')) * 1000 + 100);
    expect(real(r).map((a) => a.type)).toEqual(['swapGas']);
    const q = rig(2);
    q.runner.update();
    q.runner.request({ type: 'swapGas' });
    expect(moves(q)).toHaveLength(0); // 'gas' is not a legal target here
    expect(real(q).map((a) => a.type)).toEqual(['swapGas']); // sent at once: the engine refuses it with "No cylinder here"
  });

  it('a refusal from the engine is handed to onRefused (the HUD turns it into a toast)', () => {
    const state = game(3);
    const refused = [];
    const runner = createActionRunner({ now: () => 0, getState: () => state, meId: 'me', dispatch: () => false, refine: (a) => a, onRefused: (a) => refused.push(a) });
    runner.update();
    runner.request({ type: 'buy', item: 'oil', n: 5 });
    expect(refused).toEqual([{ type: 'buy', item: 'oil', n: 5 }]);
  });

  it('a second tap replaces the queued job, tend walks to its pan and waits out the work animation', () => {
    const r = rig(3);
    r.state.players.me.at = 'tawa1';
    r.runner.update();
    r.runner.request({ type: 'tend', station: 'tawa1' });
    r.run(40);
    expect(real(r).map((a) => a.type)).toEqual(['tend']);
    r.runner.request({ type: 'tend', station: 'kadai1' });
    r.run(WORK_MS / 2);
    expect(real(r)).toHaveLength(1);
    r.run(2500);
    expect(real(r).map((a) => `${a.type}:${a.station}`)).toEqual(['tend:tawa1', 'tend:kadai1']);
  });
});

describe('the engine drives the same actions the HUD sends', () => {
  it('prep, collectPrep, tend, swapGas, board and buy dispatch cleanly through the real engine; refusals carry readable errors', () => {
    let s = game(5);
    const send = (a) => {
      const r = applyAction(s, { playerId: 'me', ...a });
      if (!r.error) s = r.state;
      return r;
    };
    expect(send({ type: 'prep', station: 'prep1', slot: 0, item: 'batter_dosa' }).error).toBeUndefined();
    expect(send({ type: 'prep', station: 'prep1', slot: 0, item: 'oil' }).error).toMatch(/busy/);
    expect(send({ type: 'tend', station: 'tawa1' }).error).toMatch(/clean/i);
    expect(send({ type: 'swapGas' }).error).toBeUndefined(); // 420 of 1000 units: below 70%
    expect(send({ type: 'swapGas' }).error).toMatch(/Already/);
    expect(send({ type: 'buy', item: 'oil', n: 5 }).error).toBeUndefined();
    expect(send({ type: 'board', dish: 'dosa', on: false }).error).toBeUndefined();
    expect(s.off).toEqual(['dosa']);
    const l0 = createGame({ players: [{ id: 'me', name: 'Me' }], settings: { level: 0 }, seed: 1 });
    expect(applyAction(l0, { type: 'prep', playerId: 'me', station: 'prep1', slot: 0, item: 'oil' }).error).toMatch(/training/i);
  });

  it('cookReason words match what the engine refuses with', () => {
    const s = game(5);
    expect(cookReason(s, 'tawa1', 'dosa')).toBeNull();
    s.stock.batter_dosa = 0;
    expect(cookReason(s, 'tawa1', 'dosa')).toBe('Out of dosa batter');
    const r = applyAction(s, { type: 'cook', playerId: 'me', station: 'tawa1', slot: 0, dish: 'dosa' });
    expect(r.error).toBe('Out of dosa batter');
    s.stock.batter_dosa = 9;
    s.gas.u = 0;
    expect(cookReason(s, 'tawa1', 'dosa')).toBe('No gas: change the cylinder');
    s.gas.u = 400;
    s.events = [{ id: 'power', until: 99 }];
    expect(cookReason(s, 'steamer1', 'idly')).toBe('Power cut: the steamer is off');
    expect(cookReason(game(0), 'tawa1', 'dosa')).toBeNull();
    expect(cookReason(null, 'tawa1', 'dosa')).toBeNull();
  });
});

describe('notices for the new events', () => {
  const s = game(6);
  const n = (ev) => eventNotice(ev, s, 'me', money);
  it('stock, prep, gas, heat, board and events speak plainly', () => {
    expect(n({ type: 'stock-low', item: 'sambar', n: 3 })).toMatchObject({ text: 'Sambar running low: 3 left', tone: 'warn', toast: true });
    expect(n({ type: 'stock-out', item: 'batter_dosa' }).text).toMatch(/Out of dosa batter.*sold out/);
    expect(n({ type: 'batter-sour', item: 'batter_idly' }).text).toMatch(/Idly batter has gone sour/);
    expect(n({ type: 'stock-spoiled', item: 'batter_dosa', n: 9 }).tone).toBe('bad');
    expect(n({ type: 'prep-done', station: 'prep1', slot: 0, item: 'sambar', n: 14 })).toMatchObject({ text: 'Sambar is ready at the prep counter: collect it', toast: true });
    expect(n({ type: 'prep-start', item: 'oil', ticks: 3, by: 'me' }).toast).toBe(false);
    expect(n({ type: 'buy', item: 'oil', n: 5, cost: 70, by: 'me' }).text).toBe('You bought 5 cooking oil for ₹70');
    expect(n({ type: 'tend', station: 'tawa1', kind: 'wipe', by: 'me' }).text).toBe('You wiped the tawa');
    expect(n({ type: 'heat-warning', station: 'tawa1', band: 'cold' }).text).toBe('Dosa tawa is too cold');
    expect(n({ type: 'gas-low', units: 200 })).toMatchObject({ tone: 'warn', pulse: true });
    expect(n({ type: 'gas-out' }).text).toMatch(/Out of gas/);
    expect(n({ type: 'gas-swap', phase: 'start', ticks: 6, cost: 90, by: 'me' }).text).toBe('Changing the cylinder (₹90): burners off for 6s');
    expect(n({ type: 'gas-swap', phase: 'done', units: 1000 }).text).toMatch(/New cylinder/);
    expect(n({ type: 'board', dish: 'dosa', on: false, by: 'me' }).text).toBe('Plain Dosa is off the board');
    expect(n({ type: 'event-start', id: 'rain', until: 90 }).text).toBe('Rain (వర్షం)');
    expect(n({ type: 'event-start', id: 'inspector', until: 90 }).tone).toBe('warn');
    expect(n({ type: 'event-end', id: 'inspector' })).toBeNull();
    expect(n({ type: 'inspector', pass: true, bonus: 90, fine: 0, why: [] }).text).toBe('The inspector was pleased: +₹90');
    expect(n({ type: 'inspector', pass: false, bonus: 0, fine: 68, why: ['burnt', 'untended'] }).text).toMatch(/fined you ₹68 \(burnt dish left lying, tawa not tended\)/);
    expect(n({ type: 'parcel-order', customer: 1, n: 5, delivery: true }).text).toMatch(/delivery boy/);
    expect(n({ type: 'parcel-order', customer: 1, n: 6, big: true }).text).toMatch(/Big office order/);
    expect(n({ type: 'parcel-order', customer: 1, n: 1 })).toBeNull();
  });
  it('flawed and broken dishes warn', () => {
    expect(n({ type: 'ready', station: 'tawa1', slot: 0, dish: 'dosa', flaw: 'stuck' })).toMatchObject({ tone: 'warn', toast: true });
    expect(n({ type: 'ready', station: 'tawa1', slot: 0, dish: 'dosa' })).toMatchObject({ toast: false });
    expect(n({ type: 'take', station: 'tawa1', slot: 0, dish: 'dosa', q: 'broken', by: 'me' }).text).toMatch(/broken: it pays half price/);
    expect(n({ type: 'take', station: 'tawa1', slot: 0, dish: 'dosa', q: 'good', by: 'me' })).toBeNull();
    expect(n({ type: 'serve', customer: 1, dish: 'dosa', q: 'broken', by: 'me' }).text).toMatch(/half price/);
    expect(qualityView('broken')).toMatchObject({ stars: 0, label: expect.stringMatching(/half price/) });
  });
  it('chit chips show a broken served dish', () => {
    const c = mkCustomer({ order: ['dosa', 'irani_chai'], got: ['irani_chai', 'dosa'], qs: ['good', 'broken'] });
    const t = ticketModel(c, s, []);
    expect(t.chips.map((x) => [x.dish, x.q, x.broken])).toEqual([['dosa', 'broken', true], ['irani_chai', 'good', false]]);
  });
});
