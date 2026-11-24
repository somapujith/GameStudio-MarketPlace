import { describe, expect, it } from 'vitest';
import { applyAction, chooseAutoAction, createGame, isOver } from './index.js';
import { TUTORIAL_SETTINGS, TUTORIAL_STEPS, TUTORIAL_STEP_IDS, createTutorialDriver } from './tutorial.js';

const ME = 'me';

/** One solo tutorial game plus a driver, pumped exactly like the local session does. */
function makeSim(seed = 7) {
  const sim = {
    state: createGame({ players: [{ id: ME, name: 'Tester' }], settings: TUTORIAL_SETTINGS, seed }),
    driver: createTutorialDriver(),
    errors: [],
    log: [],
    completed: 0,
    visited: [],
    events: [],
  };
  const apply = (action) => {
    const r = applyAction(sim.state, { ...action, playerId: ME });
    sim.log.push(`${sim.state.tick}:${JSON.stringify(action)}`);
    if (r.error) sim.errors.push({ action, error: r.error });
    else sim.state = r.state;
    sim.events.push(...r.events);
    return r;
  };
  sim.apply = apply;
  sim.pump = (events = []) => {
    let evs = events;
    for (let i = 0; i < 12; i++) {
      const before = sim.driver.index;
      const r = sim.driver.advance(sim.state, evs, { meId: ME });
      if (r.completed) sim.completed += 1;
      if (sim.driver.index !== before || !sim.visited.length) sim.visited.push(sim.driver.step.id);
      evs = [];
      for (const a of r.actions) evs.push(...apply(a).events);
      if (!r.actions.length) break;
    }
  };
  sim.tick = () => {
    const r = applyAction(sim.state, { type: 'tick' });
    sim.state = r.state;
    sim.events.push(...r.events);
    sim.pump(r.events);
  };
  sim.act = (action) => {
    const r = apply(action);
    sim.pump(r.events);
    return r;
  };
  sim.pump();
  return sim;
}

/** A person: presses Got it, walks to the tawa, then plays like the bot (one action per tick). */
function personAction(sim, extra) {
  const { state, driver } = sim;
  if (extra) {
    const a = extra(state, driver);
    if (a !== undefined) return a;
  }
  if (driver.ackable) {
    driver.ack();
    return null;
  }
  if (driver.step.id === 'walk') return { type: 'move', to: 'tawa1' };
  return chooseAutoAction(state, ME);
}

function play(sim, { maxTicks = 560, extra } = {}) {
  while (!sim.driver.finished && !isOver(sim.state) && sim.state.tick < maxTicks) {
    const a = personAction(sim, extra);
    if (a) sim.act(a);
    else sim.pump();
    if (sim.driver.finished) break;
    sim.tick();
  }
  return sim;
}

describe('tutorial steps data', () => {
  it('has the beats, in order, with unique ids and copy for every step', () => {
    expect(new Set(TUTORIAL_STEP_IDS).size).toBe(TUTORIAL_STEPS.length);
    expect(TUTORIAL_STEP_IDS).toEqual(['welcome', 'tour', 'walk', 'customer', 'cook', 'watch', 'take', 'serve', 'collect', 'burn', 'chai', 'carry', 'collect2', 'walkcost', 'rush', 'outro']);
    for (const s of TUTORIAL_STEPS) {
      expect(typeof s.say).toBe('string');
      expect(s.say.length).toBeGreaterThan(5);
      expect(s.speaker).toBe('Chotu');
      expect(typeof s.te).toBe('string');
      expect(s.te.length).toBeGreaterThan(3);
      expect(typeof s.done).toBe('function');
      expect(['string', 'function']).toContain(typeof s.text);
    }
    expect(TUTORIAL_STEPS[0].say).toMatch(/Namaste/);
  });

  it('every step that waits for the player has a hint timer, and the first one is soon', () => {
    for (const s of TUTORIAL_STEPS) {
      if (s.id === 'outro') continue;
      expect(s.hint && s.hint.length, s.id).toBeGreaterThan(0);
      expect(s.hint[0].after, s.id).toBeLessThanOrEqual(20);
      for (const h of s.hint) expect(h.text.length).toBeGreaterThan(5);
    }
  });
});

describe('the driver through the real engine', () => {
  it('a bot player completes the tutorial, exactly once, with no refused actions', () => {
    const sim = play(makeSim());
    expect(sim.driver.done).toBe(true);
    expect(sim.completed).toBe(1);
    expect(sim.errors).toEqual([]);
    expect(sim.state.tick).toBeLessThan(sim.state.shiftTicks);
    expect(sim.visited).toEqual(expect.arrayContaining(['welcome', 'walk', 'customer', 'cook', 'take', 'serve', 'collect', 'chai', 'carry', 'collect2', 'walkcost', 'rush', 'outro']));
    expect(sim.state.money).toBeGreaterThan(0);
    expect(sim.state.paid).toBeGreaterThanOrEqual(4);
  });

  it('teaches burning: the demo dish burns and the burn step waits until it is cleared', () => {
    const sim = play(makeSim());
    expect(sim.visited).toContain('burn');
    expect(sim.events.some((e) => e.type === 'burnt' && e.dish === 'masala_dosa')).toBe(true);
    expect(sim.events.some((e) => e.type === 'burnt-cleared')).toBe(true);
  });

  it('is deterministic: same seed and same play give the same actions and the same end state', () => {
    const a = play(makeSim(11));
    const b = play(makeSim(11));
    expect(a.log).toEqual(b.log);
    expect(a.state).toEqual(b.state);
  });

  it('the ready-to-eat state of the first customer starts frozen: nobody leaves while the player reads', () => {
    const sim = makeSim();
    for (let i = 0; i < 60; i++) sim.tick();
    expect(sim.state.lost).toBe(0);
    expect(sim.state.unpaid).toBe(0);
    expect(sim.driver.index).toBe(0);
    expect(sim.driver.done).toBe(false);
  });

  it('a player who does nothing never completes, but always has a hint', () => {
    const sim = makeSim();
    const seen = new Set();
    while (!isOver(sim.state) && sim.state.tick < 700) {
      sim.tick();
      if (sim.driver.hint) seen.add(sim.driver.hint);
    }
    expect(sim.driver.done).toBe(false);
    expect(sim.completed).toBe(0);
    expect(sim.driver.index).toBe(0);
    expect(seen.size).toBeGreaterThan(0);
  });

  it('a player who stalls on a step sees its hints (first and last) after the timers, then can carry on', () => {
    const sim = makeSim();
    const idleOk = new Set(['welcome', 'tour', 'walk', 'customer', 'cook', 'serve', 'chai', 'collect2', 'walkcost']);
    const checked = new Set();
    let guard = 0;
    while (!sim.driver.finished && !isOver(sim.state) && sim.state.tick < 560 && guard++ < 400) {
      const step = sim.driver.step;
      if (idleOk.has(step.id) && !checked.has(step.id)) {
        checked.add(step.id);
        const first = step.hint[0];
        const last = step.hint[step.hint.length - 1];
        let waited = 0;
        while (!sim.driver.hint && waited < 100 && sim.driver.step.id === step.id) {
          sim.tick();
          waited += 1;
        }
        expect(sim.driver.step.id).toBe(step.id);
        expect(sim.driver.hint, step.id).toBe(first.text);
        expect(waited, step.id).toBeGreaterThanOrEqual(first.after - 2);
        waited = 0;
        while (sim.driver.hint !== last.text && waited < 200 && sim.driver.step.id === step.id) {
          sim.tick();
          waited += 1;
        }
        expect(sim.driver.step.id).toBe(step.id);
        expect(sim.driver.hint, step.id).toBe(last.text);
      }
      const a = personAction(sim);
      if (a) sim.act(a);
      else sim.pump();
      if (sim.driver.finished) break;
      sim.tick();
    }
    expect([...checked]).toEqual(expect.arrayContaining(['welcome', 'walk', 'cook', 'serve', 'chai']));
    expect(sim.driver.done).toBe(true);
  });

  it('recovers when the first dosa is lost: the player is sent back to cook again', () => {
    const sim = makeSim(5);
    let discarded = false;
    play(sim, {
      extra: (state, driver) => {
        const me = state.players[ME];
        if (!discarded && driver.step.id === 'serve' && me.hands.length) {
          discarded = true;
          return { type: 'discard', hand: 0 };
        }
        return undefined;
      },
    });
    expect(discarded).toBe(true);
    expect(sim.driver.done).toBe(true);
    expect(sim.driver.visits.cook).toBeGreaterThan(1);
  });

  it('a late collect (customer walked away unpaid) is a retry with a new customer, and a second miss cannot happen', () => {
    const sim = makeSim(9);
    play(sim, {
      extra: (state, driver) => {
        // never collect during the first pass of the collect step: let the customer leave unpaid
        if (driver.step.id === 'collect' && driver.attempts.collect === 0) return null;
        return undefined;
      },
    });
    expect(sim.driver.attempts.collect).toBe(1);
    expect(sim.state.unpaid).toBeGreaterThanOrEqual(1);
    expect(sim.driver.done).toBe(true);
  });

  it('a first rush nobody is paid for retries once with frozen clocks, then completes only when someone paid', () => {
    const sim = makeSim(3);
    play(sim, {
      maxTicks: 590,
      extra: (state, driver) => {
        if (driver.step.id === 'rush' && driver.attempts.rush === 0) return null; // do nothing: both customers run out of patience
        return undefined;
      },
    });
    expect(sim.driver.attempts.rush).toBe(1);
    expect(sim.driver.done).toBe(true);
    expect(sim.state.lost).toBeGreaterThanOrEqual(2);
    expect(sim.state.paid).toBeGreaterThanOrEqual(4);
  });

  it('copes with a player who grabs the demo dish: it is thrown away before the two-dish lesson', () => {
    const sim = makeSim(21);
    play(sim, {
      extra: (state, driver) => {
        const me = state.players[ME];
        if (driver.step.id === 'watch' || driver.step.id === 'take') {
          // take anything that is ready, including the masala dosa nobody ordered
          if (me.hands.length < 2) {
            for (const sid of state.cfg.stations) {
              const slot = state.stations[sid].slots.findIndex((s) => s.st === 'ready' && s.dish === 'masala_dosa');
              if (slot >= 0) return { type: 'take', station: sid, slot };
            }
          }
        }
        return undefined;
      },
    });
    expect(sim.errors).toEqual([]);
    expect(sim.driver.done).toBe(true);
  });

  it('skip() stops the driver and never counts as completed', () => {
    const sim = makeSim();
    sim.driver.skip();
    expect(sim.driver.skipped).toBe(true);
    const r = sim.driver.advance(sim.state, [], { meId: ME });
    expect(r).toEqual({ actions: [], completed: false });
    expect(sim.driver.done).toBe(false);
  });

  it('ack() only counts on steps that ask for it', () => {
    const sim = makeSim();
    expect(sim.driver.ackable).toBe(true);
    expect(sim.driver.ack()).toBe(true);
    sim.pump();
    expect(sim.driver.step.id).toBe('tour');
    sim.driver.ack();
    sim.pump();
    expect(sim.driver.step.id).toBe('walk');
    expect(sim.driver.ack()).toBe(false);
  });

  it('walking: the walk step completes from state alone (me.at), whatever time it took', () => {
    const sim = makeSim();
    sim.driver.ack();
    sim.pump();
    sim.driver.ack();
    sim.pump();
    expect(sim.driver.step.id).toBe('walk');
    sim.act({ type: 'move', to: 'tawa1' });
    expect(sim.driver.step.id).toBe('customer');
  });

  it('spotlights are plain data the scene understands', () => {
    const sim = play(makeSim());
    const kinds = new Set(['station', 'slot', 'customer', 'bin', 'hands']);
    for (const s of TUTORIAL_STEPS) {
      const sp = typeof s.spotlight === 'function' ? s.spotlight(sim.state, { cust: () => null, me: sim.state.players[ME], demo: null }) : s.spotlight;
      if (sp) expect(kinds.has(sp.kind), s.id).toBe(true);
    }
  });
});
