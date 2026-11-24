import { describe, it, expect } from 'vitest';
import { WORK_MS, standX, walkSeconds } from '@shared/tiffin-centre/movement.js';
import { createActionRunner } from './actionRunner.js';
import { refineAction } from './hudLogic.js';
import { mkState, mkCustomer, mkSlot } from './testState.js';

function rig(over = {}, opts = {}) {
  const state = mkState({ cfg: { spots: 4 }, customers: [mkCustomer({ id: 1, spot: 2, order: ['dosa'] })], ...over });
  state.players.me.hands = [{ dish: 'dosa', q: 'good' }];
  const clock = { t: 0 };
  const sent = [];
  const arrivals = [];
  const dropped = [];
  const refused = [];
  const runner = createActionRunner({
    now: () => clock.t,
    getState: () => state,
    meId: 'me',
    dispatch: (a) => {
      sent.push({ ...a, t: clock.t });
      if (a.type === 'move') state.players.me.at = a.to; // the engine applies the move at once
      return opts.refuse ? false : true;
    },
    refine: (a, s) => refineAction(a, s, 'me', 0),
    onArrive: (a) => arrivals.push(a),
    onDrop: (a) => dropped.push(a),
    onRefused: (a) => refused.push(a),
  });
  const run = (ms, step = 16) => {
    for (let i = 0; i < ms; i += step) {
      clock.t += step;
      runner.update();
    }
  };
  return { state, clock, sent, arrivals, dropped, refused, runner, run };
}

const moves = (r) => r.sent.filter((a) => a.type === 'move');
const real = (r) => r.sent.filter((a) => a.type !== 'move');

describe('action runner: walk, then work', () => {
  it('sends the move at once, waits the walking time, then dispatches the real action', () => {
    const r = rig();
    r.runner.update(); // sync: standing at null -> x = 0
    r.runner.request({ type: 'serve', customer: 1, hand: 0 });
    expect(moves(r)).toEqual([expect.objectContaining({ to: 'spot:2' })]);
    expect(real(r)).toHaveLength(0);
    expect(r.runner.snapshot().pending.label).toBe('Walking to serve Ravi anna');
    const secs = walkSeconds(0, standX('spot:2'));
    r.run(secs * 1000 - 100);
    expect(real(r)).toHaveLength(0);
    r.run(200);
    expect(real(r)).toEqual([expect.objectContaining({ type: 'serve', customer: 1, hand: 0 })]);
    expect(r.arrivals).toEqual([{ at: 'spot:2', action: { type: 'serve', customer: 1, hand: 0 } }]);
    expect(r.runner.snapshot().pending).toBeNull();
    expect(r.runner.x()).toBeCloseTo(standX('spot:2'));
  });

  it('acts at once when already standing there, then holds the next walk for the work animation', () => {
    const r = rig();
    r.state.players.me.at = 'tawa1';
    r.runner.update();
    r.runner.request({ type: 'take', station: 'tawa1', slot: 0 });
    expect(moves(r)).toHaveLength(0); // already there
    r.run(40);
    expect(real(r)).toHaveLength(1);
    const t0 = r.clock.t;
    r.runner.request({ type: 'discard', hand: 0 });
    r.run(WORK_MS / 2);
    expect(r.runner.x()).toBeCloseTo(standX('tawa1')); // still working: no walk yet
    r.run(2000);
    expect(real(r).map((a) => a.type)).toEqual(['take', 'discard']);
    expect(real(r)[1].t - t0).toBeGreaterThan(WORK_MS);
  });

  it('a new tap replaces the queued action and keeps walking from the current x', () => {
    const r = rig();
    r.state.players.me.at = 'tawa1';
    r.runner.update();
    r.runner.request({ type: 'discard', hand: 0 }); // to the bin, far to the right
    r.run(300);
    const xMid = r.runner.x();
    expect(xMid).toBeGreaterThan(standX('tawa1'));
    r.runner.request({ type: 'take', station: 'chai1', slot: 0 });
    expect(r.runner.snapshot().pending.action.type).toBe('take');
    r.run(32);
    expect(Math.abs(r.runner.x() - xMid)).toBeLessThan(0.6); // continued from where it was, did not jump
    r.run(3000);
    expect(real(r).map((a) => a.type)).toEqual(['take']); // the discard never happened
  });

  it('coalesces move messages to one per second, latest wish wins', () => {
    const r = rig();
    r.runner.update();
    r.runner.request({ type: 'take', station: 'tawa1', slot: 0 });
    r.runner.request({ type: 'take', station: 'steamer1', slot: 0 });
    r.runner.request({ type: 'take', station: 'kadai1', slot: 0 });
    r.runner.request({ type: 'take', station: 'chai1', slot: 0 });
    expect(moves(r).map((m) => m.to)).toEqual(['tawa1']);
    r.run(1100);
    expect(moves(r).map((m) => m.to)).toEqual(['tawa1', 'chai1']);
    r.run(3000);
    expect(moves(r)).toHaveLength(2);
  });

  it('does not send an action for a walk-only job, and keyboard nudges walk stop by stop', () => {
    const r = rig();
    r.runner.update();
    expect(r.runner.nudge(1)).toBe(true);
    const first = moves(r)[0].to;
    expect(first).toBeTruthy();
    r.run(1200);
    expect(real(r)).toHaveLength(0);
    const x1 = r.runner.x();
    expect(x1).toBeGreaterThan(0);
    r.runner.nudge(-1);
    r.run(1200);
    expect(r.runner.x()).toBeLessThan(x1);
  });

  it('holding a key does not run the target far ahead of the avatar', () => {
    const r = rig();
    r.runner.update();
    for (let i = 0; i < 30; i += 1) {
      r.runner.nudge(1); // key repeat every ~33 ms
      r.run(33);
    }
    const target = standX(r.runner.at());
    expect(target - r.runner.x()).toBeLessThan(1.7);
    expect(r.runner.x()).toBeGreaterThan(0.5); // and the avatar did keep walking
  });

  it('drops a queued action that became invalid, without dispatching', () => {
    const r = rig();
    r.runner.update();
    r.runner.request({ type: 'collect', customer: 1 }); // customer is waiting, not paying
    r.run(3000);
    expect(real(r)).toHaveLength(0);
    expect(r.dropped).toHaveLength(1);
  });

  it('serves with the right hand if the hands changed during the walk', () => {
    const r = rig();
    r.state.players.me.hands = [{ dish: 'irani_chai', q: 'ok' }, { dish: 'dosa', q: 'good' }];
    r.runner.update();
    r.runner.request({ type: 'serve', customer: 1, hand: 1 });
    r.state.players.me.hands = [{ dish: 'dosa', q: 'good' }]; // the chai was thrown away meanwhile
    r.run(3000);
    expect(real(r)[0]).toMatchObject({ type: 'serve', hand: 0 });
  });

  it('reports a refusal from the session', () => {
    const r = rig({}, { refuse: true });
    r.runner.update();
    r.runner.request({ type: 'serve', customer: 1, hand: 0 });
    r.run(3000);
    expect(r.refused).toHaveLength(1);
  });

  it('an action with no place to walk to (customer gone) goes straight through', () => {
    const r = rig();
    r.runner.update();
    r.runner.request({ type: 'collect', customer: 99 });
    expect(real(r)).toHaveLength(0); // refine drops it (customer missing)
    expect(r.dropped).toHaveLength(1);
    r.runner.request({ type: 'emote-like' });
    expect(real(r)).toHaveLength(1);
  });

  it('follows an outside change of `at` when idle', () => {
    const r = rig();
    r.runner.update();
    r.state.players.me.at = 'chai1';
    r.runner.update();
    expect(r.runner.x()).toBeCloseTo(standX('chai1'));
  });

  it('walks only to places that exist this shift', () => {
    const r = rig();
    r.runner.update();
    expect(r.runner.walkTo('kadai1')).toBe(false); // not on this level
    expect(r.runner.walkTo('spot:9')).toBe(false);
    expect(r.runner.walkTo('bin')).toBe(true);
  });

  it('cook goes to the station, and an occupied slot moves to the next empty one', () => {
    const r = rig();
    r.runner.update();
    r.runner.request({ type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' });
    r.state.stations.tawa1.slots[0] = mkSlot({ st: 'cooking', dish: 'dosa', readyAt: 40 });
    r.run(3000);
    expect(real(r)[0]).toMatchObject({ type: 'cook', slot: 1 });
  });
});
