import { describe, expect, it } from 'vitest';
import { DISHES, DISH_IDS, GAS, INGREDIENTS, INGREDIENT_IDS, LEVELS, REQUEST } from './catalog.js';
import {
  INGREDIENT_HI, PREP_RECIPES, RECIPES, RECIPE_LANGS, RECIPE_REVIEW, ingredientsOf, portionLabel, prepRecipeFor, prepRecipeGoes, prepRecipeSteps, prepRecipeTip,
  recipeFor, recipeSteps, recipeTip,
} from './recipes.js';
import { applyAction, createGame, isOver } from './index.js';
import { tutorialBotAction } from './tutorial.bot.js';
import {
  LOOK_TURN_RAD, TUTORIAL_ACTIONS, TUTORIAL_CHAPTERS, TUTORIAL_NOT_YET, TUTORIAL_RECIPE_DISHES, TUTORIAL_SETTINGS, TUTORIAL_STEPS,
  TUTORIAL_STEP_IDS, TUTORIAL_PREP_RECIPES, TUTORIAL_RESCUE_NOTE, createTutorialDriver, spawnAction, trainAction,
} from './tutorial.js';

const ME = 'me';
const CHAPTER_IDS = ['look', 'tokens', 'tawa', 'idly', 'kadai', 'chai', 'serve', 'stock', 'heat', 'gas', 'board', 'special', 'weather', 'profit', 'flow', 'rush'];

/** One solo tutorial game plus a driver, pumped exactly like the local session does (and the camera looking straight ahead). */
function makeSim(seed = 7) {
  const sim = {
    state: createGame({ players: [{ id: ME, name: 'Tester' }], settings: TUTORIAL_SETTINGS, seed }),
    driver: createTutorialDriver(),
    look: { yaw: 0, pitch: 0 },
    errors: [],
    log: [],
    completed: 0,
    visited: [],
    events: [],
    allowedBy: {}, // step id -> the allowed list seen
    touchTexts: [], // every touch text / hint / controls the driver showed
    kbTexts: [],
    spots: [],
    refused: 0,
    stepAt: {}, // step id -> how many events had happened when the driver first stood on it
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
  const sample = () => {
    const d = sim.driver;
    sim.allowedBy[d.step.id] = d.allowed;
    sim.touchTexts.push(d.textFor('touch'), d.hintFor('touch'), d.controlsFor('touch'));
    sim.kbTexts.push(d.textFor('keyboard'), d.hintFor('keyboard'), d.controlsFor('keyboard'));
    const sp = d.spotlight;
    if (sp) sim.spots.push({ id: d.step.id, sp });
    if (!Object.hasOwn(sim.stepAt, d.step.id)) sim.stepAt[d.step.id] = sim.events.length;
  };
  sim.pump = (events = []) => {
    let evs = events;
    for (let i = 0; i < 12; i++) {
      const before = sim.driver.index;
      const r = sim.driver.advance(sim.state, evs, { meId: ME, look: sim.look });
      if (r.completed) sim.completed += 1;
      if (sim.driver.index !== before || !sim.visited.length) sim.visited.push(sim.driver.step.id);
      evs = [];
      for (const a of r.actions) evs.push(...apply(a).events);
      if (!r.actions.length) break;
    }
    sample();
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

/** A person who follows the lesson: turns the head, presses Got it, walks to the tawa, then plays like the bot, doing only what Chotu allows. */
function personAction(sim, extra) {
  const { state, driver } = sim;
  if (extra) {
    const a = extra(state, driver);
    if (a !== undefined) return a;
  }
  if (driver.step.id === 'look' && driver.lookTurned <= LOOK_TURN_RAD) {
    sim.look = { yaw: sim.look.yaw + 0.5, pitch: 0 };
    return null;
  }
  if (driver.ackable) {
    driver.ack();
    return null;
  }
  const a = tutorialBotAction(state, driver, ME); // the scripted player: lessons, walks, preps, tends, swaps, serves
  if (a && !driver.allows(a.type)) {
    sim.refused += 1;
    return null;
  }
  return a;
}

function play(sim, { maxTicks = 3400, extra } = {}) {
  while (!sim.driver.finished && !isOver(sim.state) && sim.state.tick < maxTicks) {
    const a = personAction(sim, extra);
    if (a) sim.act(a);
    else sim.pump();
    if (sim.driver.finished) break;
    sim.tick();
  }
  return sim;
}

/** Walk the lesson (head, Got it, the walk) until the driver stands on step `id`. */
function playTo(sim, id, guardMax = 300) {
  let guard = 0;
  while (sim.driver.step.id !== id && guard++ < guardMax) {
    const a = personAction(sim);
    if (a) sim.act(a);
    else sim.pump();
    if (sim.driver.step.id === id) break;
    sim.tick();
  }
  return sim;
}

const KEYBOARDISH = /\b(keyboard|arrow keys?|spacebar|press|click|space|enter|[ADQE] \/ [ADQE])\b/i;
const noKeys = (t) => !KEYBOARDISH.test(String(t || '').replace(/empty space/gi, ''));

describe('recipes', () => {
  it('has a recipe for EVERY dish, with Telugu and Hindi variants of every step', () => {
    expect(Object.keys(RECIPES).sort()).toEqual([...DISH_IDS].sort());
    for (const id of DISH_IDS) {
      const r = recipeFor(id);
      expect(r.station, id).toBe(DISHES[id].station);
      expect(r.steps.length, id).toBeGreaterThanOrEqual(3);
      expect(r.steps.length, id).toBeLessThanOrEqual(6);
      expect(r.te.length, id).toBe(r.steps.length);
      expect(r.hi.length, id).toBe(r.steps.length);
      for (const l of r.steps) expect(l.length, `${id} ${l}`).toBeGreaterThan(8);
      for (const l of r.te) expect(l, id).toMatch(/[ఀ-౿]/);
      for (const l of r.hi) expect(l, id).toMatch(/[ऀ-ॿ]/);
      expect(r.tip.length, id).toBeGreaterThan(10);
      expect(r.tipTe, id).toMatch(/[ఀ-౿]/);
      expect(r.tipHi, id).toMatch(/[ऀ-ॿ]/);
      for (const lang of RECIPE_LANGS) expect(recipeSteps(id, lang)).toHaveLength(r.steps.length);
      expect(recipeTip(id, 'te')).toBe(r.tipTe);
      expect(recipeTip(id, 'zz')).toBe(r.tip);
    }
    expect(recipeFor('nope')).toBe(null);
    expect(recipeSteps('nope')).toEqual([]);
  });

  it('every recipe is taught: the tutorial level has the full menu and a recipe card step for every dish, each served to a token', () => {
    expect(LEVELS[0].menu).toEqual(DISH_IDS);
    expect([...TUTORIAL_RECIPE_DISHES].sort()).toEqual([...DISH_IDS].sort());
    for (const id of DISH_IDS) {
      const card = TUTORIAL_STEPS.find((s) => s.recipe === id);
      expect(card.ack, id).toBe(true);
      const prefix = card.id.replace(/-card$/, '');
      for (const part of ['cook', 'take', 'serve']) expect(TUTORIAL_STEP_IDS, `${id} ${part}`).toContain(`${prefix}-${part}`);
    }
  });
});

describe('tutorial steps data', () => {
  it('is one lesson: chapters in order, unique ids, copy for every step, keyboard and touch variants', () => {
    expect(new Set(TUTORIAL_STEP_IDS).size).toBe(TUTORIAL_STEPS.length);
    expect(TUTORIAL_STEPS.length).toBeGreaterThan(60);
    const chapterIds = TUTORIAL_CHAPTERS.map((c) => c.id);
    expect(chapterIds).toEqual(CHAPTER_IDS);
    let last = -1;
    for (const s of TUTORIAL_STEPS) {
      const ci = chapterIds.indexOf(s.chapter);
      expect(ci, s.id).toBeGreaterThanOrEqual(last);
      last = ci;
      expect(typeof s.say, s.id).toBe('string');
      expect(s.say.length).toBeGreaterThan(5);
      expect(s.speaker).toBe('Chotu');
      expect(s.te.length, s.id).toBeGreaterThan(3);
      expect(typeof s.done).toBe('function');
      expect(['string', 'function']).toContain(typeof s.text);
      expect(['string', 'function']).toContain(typeof s.textTouch);
      expect(typeof s.controls.kb, s.id).toBe('string');
      expect(typeof s.controls.touch, s.id).toBe('string');
      expect(noKeys(s.controls.touch), `${s.id} controls`).toBe(true);
      expect(s.hintTouch.length, s.id).toBe(s.hint.length);
      s.hint.forEach((h, i) => expect(s.hintTouch[i].after).toBe(h.after));
      expect(s.allow, s.id).toContain('move');
      for (const a of s.allow) expect(TUTORIAL_ACTIONS, `${s.id} ${a}`).toContain(a);
      if (typeof s.textTouch === 'string') expect(noKeys(s.textTouch), `${s.id} text`).toBe(true);
      for (const h of s.hintTouch) expect(noKeys(h.text), `${s.id} hint`).toBe(true);
    }
    expect(TUTORIAL_STEPS[0].say).toMatch(/Namaste/);
  });

  it('has every beat of the brief in the right chapter', () => {
    const at = (id) => TUTORIAL_STEPS.find((s) => s.id === id);
    expect(at('look').chapter).toBe('look');
    expect(at('hands').chapter).toBe('look');
    expect(at('token').chapter).toBe('tokens');
    expect(at('token-states').chapter).toBe('tokens');
    expect(at('walk').chapter).toBe('tawa');
    expect(at('burn').chapter).toBe('tawa');
    for (const d of ['masala_dosa', 'podi_dosa', 'set_dosa', 'pesarattu']) expect(at(`${d}-card`).chapter).toBe('tawa');
    expect(at('idly-card').chapter).toBe('idly');
    for (const d of ['poori', 'vada', 'mysore_bonda', 'mirchi_bajji']) expect(at(`${d}-card`).chapter).toBe('kadai');
    for (const d of ['irani_chai', 'filter_coffee', 'osmania']) expect(at(`${d}-card`).chapter).toBe('chai');
    for (const id of ['orders', 'cook2', 'carry', 'serve2', 'collect', 'tips']) expect(at(id).chapter).toBe('serve');
    for (const id of ['money', 'hearts', 'stars', 'clock', 'levels', 'walkcost', 'coop']) expect(at(id).chapter).toBe('flow');
    for (const id of ['stock-turn', 'stock-bars', 'stock-batter', 'stock-grind', 'stock-sides', 'stock-out-refused', 'stock-out-prep', 'stock-out-finish']) expect(at(id).chapter, id).toBe('stock');
    for (const id of ['heat-intro', 'heat-cook', 'heat-take', 'heat-serve', 'heat-tend', 'heat-others', 'heat-rules']) expect(at(id).chapter, id).toBe('heat');
    for (const id of ['gas-intro', 'gas-low', 'gas-swap', 'gas-wait', 'gas-cost']) expect(at(id).chapter, id).toBe('gas');
    for (const id of ['board-intro', 'board-off', 'board-react', 'board-on']) expect(at(id).chapter, id).toBe('board');
    for (const id of ['parcel', 'extra', 'regular', 'regular-back', 'big', 'delivery']) expect(at(id).chapter, id).toBe('special');
    for (const id of ['rain', 'power-card', 'power-cut', 'inspect-card', 'inspect-drill']) expect(at(id).chapter, id).toBe('weather');
    for (const id of ['profit-books', 'profit-bin', 'profit-profit']) expect(at(id).chapter, id).toBe('profit');
    expect(at('rush').chapter).toBe('rush');
    expect(at('outro').complete).toBe(true);
    expect(at('look').ackAfter).toBeGreaterThan(0);
  });

  it('every step that waits for the player has a hint timer, and the first one is soon', () => {
    for (const s of TUTORIAL_STEPS) {
      if (s.id === 'outro') continue;
      expect(s.hint && s.hint.length, s.id).toBeGreaterThan(0);
      expect(s.hint[0].after, s.id).toBeLessThanOrEqual(20);
      for (const h of s.hint) expect(h.text.length).toBeGreaterThan(5);
    }
    expect(TUTORIAL_STEPS.find((s) => s.id === 'look').hint[0].after).toBe(8);
  });

  it('each step states what is allowed: the frozen reading steps allow no cooking at all', () => {
    const at = (id) => TUTORIAL_STEPS.find((s) => s.id === id);
    for (const id of ['welcome', 'look', 'hands', 'tour', 'token', 'token-states', 'walk', 'dosa-card', 'tips', 'money', 'coop']) {
      expect(at(id).allow, id).toEqual(['move']);
    }
    expect(at('dosa-cook').allow).toContain('cook');
    expect(at('dosa-cook').allow).not.toContain('serve');
    expect(at('dosa-take').allow).toContain('take');
    expect(at('dosa-take').allow).not.toContain('cook');
    expect(at('dosa-serve').allow).toContain('serve');
    expect(at('collect').allow).toEqual(['move', 'collect']);
    expect(at('rush').allow).toEqual([...TUTORIAL_ACTIONS]);
  });
});

describe('the driver through the real engine', () => {
  it('a bot player completes the whole tutorial, exactly once, with no refused actions, visiting every chapter and every step', () => {
    const sim = play(makeSim());
    expect(sim.driver.done).toBe(true);
    expect(sim.driver.finished).toBe(true);
    expect(sim.completed).toBe(1);
    expect(sim.errors).toEqual([]);
    expect(sim.state.tick).toBeLessThan(sim.state.shiftTicks);
    const visited = new Set(sim.visited);
    for (const s of TUTORIAL_STEPS) {
      if (s.id === 'burn' || s.id === 'inspect-clean') continue; // only when the demo dish is still on the tawa
      expect(visited.has(s.id), s.id).toBe(true);
    }
    const chapters = new Set(TUTORIAL_STEPS.filter((s) => visited.has(s.id)).map((s) => s.chapter));
    expect([...chapters]).toEqual(TUTORIAL_CHAPTERS.map((c) => c.id));
    expect(sim.state.money).toBeGreaterThan(0);
    expect(sim.state.paid).toBeGreaterThanOrEqual(18);
    // every dish was really cooked, taken and served through the engine
    const served = new Set(sim.events.filter((e) => e.type === 'serve').map((e) => e.dish));
    for (const id of DISH_IDS) expect(served.has(id), id).toBe(true);
    const duration = sim.state.tick;
    expect(duration).toBeGreaterThan(120); // a real lesson, not a flash (a bot never reads)
    // game-clock seconds for a bot that reads nothing; a person reading every card roughly doubles it: about 12-18 minutes in all
    expect(duration).toBeLessThan(600);
    expect(duration).toBeGreaterThan(300);
    expect(TUTORIAL_STEPS.length).toBeLessThan(140);
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

  it('nobody leaves while the player reads: the first customer starts frozen', () => {
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

  it('a player who only presses Got it and never acts is stuck at the walk, not finished', () => {
    const sim = makeSim();
    let guard = 0;
    while (sim.driver.step.id !== 'walk' && guard++ < 100) {
      if (sim.driver.step.id === 'look') sim.look = { yaw: sim.look.yaw + 0.5, pitch: 0 };
      sim.driver.ack();
      sim.tick();
    }
    expect(sim.driver.step.id).toBe('walk');
    for (let i = 0; i < 200; i++) {
      sim.driver.ack();
      sim.tick();
    }
    expect(sim.driver.step.id).toBe('walk');
    expect(sim.driver.done).toBe(false);
    expect(sim.driver.hint).toBeTruthy();
  });

  it('a player who stalls on a step sees its hints (first and last) after the timers, then can carry on', () => {
    const sim = makeSim();
    const idleOk = new Set(['welcome', 'look', 'hands', 'tour', 'token', 'walk', 'dosa-card', 'dosa-cook', 'dosa-serve', 'masala_dosa-cook', 'poori-cook', 'orders', 'money']);
    const checked = new Set();
    let guard = 0;
    while (!sim.driver.finished && !isOver(sim.state) && sim.state.tick < 3400 && guard++ < 3000) {
      const step = sim.driver.step;
      if (idleOk.has(step.id) && !checked.has(step.id)) {
        checked.add(step.id);
        const plain = step.hint.filter((h) => !h.when); // (a hint with a condition only shows in its own situation)
        const first = plain[0];
        const last = plain[plain.length - 1];
        let waited = 0;
        while (!sim.driver.hint && waited < 100 && sim.driver.step.id === step.id) {
          sim.tick();
          waited += 1;
        }
        expect(sim.driver.step.id).toBe(step.id);
        expect(sim.driver.hint, step.id).toBe(first.text);
        expect(sim.driver.hintFor('touch'), step.id).toBe(step.hintTouch[0].text);
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
    expect([...checked]).toEqual(expect.arrayContaining(['welcome', 'look', 'walk', 'dosa-cook', 'dosa-serve', 'poori-cook', 'orders']));
    expect(sim.driver.done).toBe(true);
  });

  it('recovers when the first dosa is lost: the player is sent back to cook again', () => {
    const sim = makeSim(5);
    let discarded = false;
    play(sim, {
      extra: (state, driver) => {
        const me = state.players[ME];
        if (!discarded && driver.step.id === 'dosa-serve' && me.hands.length) {
          discarded = true;
          return { type: 'discard', hand: 0 };
        }
        return undefined;
      },
    });
    expect(discarded).toBe(true);
    expect(sim.driver.done).toBe(true);
    expect(sim.driver.visits['dosa-cook']).toBeGreaterThan(1);
  });

  it('recovers in a recipe lesson too (a kadai dish thrown away) and in the two-token lesson', () => {
    const sim = makeSim(8);
    const lost = new Set();
    play(sim, {
      extra: (state, driver) => {
        const me = state.players[ME];
        for (const id of ['vada-serve', 'carry']) {
          if (!lost.has(id) && driver.step.id === id && me.hands.length) {
            lost.add(id);
            return { type: 'discard', hand: 0 };
          }
        }
        return undefined;
      },
    });
    expect(lost.size).toBe(2);
    expect(sim.driver.done).toBe(true);
    expect(sim.driver.visits['vada-cook']).toBeGreaterThan(1);
    expect(sim.driver.visits.cook2).toBeGreaterThan(1);
  });

  it('a late collect (customers walked away unpaid) is a retry with new customers, and a second miss cannot happen', () => {
    const sim = makeSim(9);
    play(sim, {
      extra: (state, driver) => {
        // never collect during the first pass of the collect step: let the customers leave unpaid
        if (driver.step.id === 'collect' && driver.attempts.collect === 0) return null;
        return undefined;
      },
    });
    expect(sim.driver.attempts.collect).toBe(1);
    expect(sim.state.unpaid).toBeGreaterThanOrEqual(1);
    expect(sim.driver.done).toBe(true);
    expect(sim.driver.visits.orders).toBeGreaterThan(1);
  });

  it('a first rush nobody is paid for retries once with frozen clocks, then completes only when someone paid', () => {
    const sim = makeSim(3);
    play(sim, {
      maxTicks: 2500,
      extra: (state, driver) => {
        if (driver.step.id === 'rush' && driver.attempts.rush === 0) return null; // do nothing: all three run out of patience
        return undefined;
      },
    });
    expect(sim.driver.attempts.rush).toBe(1);
    expect(sim.driver.done).toBe(true);
    expect(sim.state.lost).toBeGreaterThanOrEqual(3);
    expect(sim.driver.flags.patience).toBe(true); // the outro runs live
  });

  it('copes with a player who grabs the demo dish: it is thrown away before the next lesson', () => {
    const sim = makeSim(21);
    play(sim, {
      extra: (state, driver) => {
        const me = state.players[ME];
        if (driver.step.id === 'dosa-watch' || driver.step.id === 'dosa-take') {
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

  it('harmless even if the HUD forgot to refuse: a dosa cooked early (during the walk) does not stop the lesson', () => {
    const sim = makeSim(13);
    let cooked = false;
    play(sim, {
      extra: (state, driver) => {
        if (!cooked && driver.step.id === 'walk') {
          cooked = true;
          return { type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' };
        }
        return undefined;
      },
    });
    expect(cooked).toBe(true);
    expect(sim.driver.done).toBe(true);
    expect(sim.completed).toBe(1);
  });

  it('skip() stops the driver and never counts as completed', () => {
    const sim = makeSim();
    sim.driver.skip();
    expect(sim.driver.skipped).toBe(true);
    expect(sim.driver.allowed).toBe(null);
    expect(sim.driver.allows('cook')).toBe(true);
    const r = sim.driver.advance(sim.state, [], { meId: ME });
    expect(r).toEqual({ actions: [], completed: false });
    expect(sim.driver.done).toBe(false);
  });

  it('ack() only counts on steps that ask for it', () => {
    const sim = makeSim();
    expect(sim.driver.ackable).toBe(true);
    expect(sim.driver.ack()).toBe(true);
    sim.pump();
    expect(sim.driver.step.id).toBe('look');
    sim.look = { yaw: 0.6, pitch: 0 };
    sim.pump();
    expect(sim.driver.step.id).toBe('hands');
    sim.driver.ack();
    sim.pump();
    sim.driver.ack();
    sim.pump();
    sim.driver.ack();
    sim.pump();
    sim.driver.ack();
    sim.pump();
    expect(sim.driver.step.id).toBe('walk');
    expect(sim.driver.ack()).toBe(false);
  });

  it('walking: the walk step completes from state alone (me.at), whatever time it took', () => {
    const sim = makeSim();
    playTo(sim, 'walk');
    expect(sim.driver.step.id).toBe('walk');
    sim.act({ type: 'move', to: 'tawa1' });
    expect(sim.driver.step.id).toBe('dosa-card');
  });
});

describe('look around (first person)', () => {
  const toLook = () => {
    const sim = makeSim();
    sim.driver.ack();
    sim.pump();
    expect(sim.driver.step.id).toBe('look');
    return sim;
  };

  it('is done by turning the head more than 0.35 rad, not by a small turn or by idling', () => {
    const sim = toLook();
    for (let i = 0; i < 6; i++) sim.tick();
    expect(sim.driver.step.id).toBe('look');
    sim.look = { yaw: LOOK_TURN_RAD - 0.05, pitch: 0 };
    sim.pump();
    expect(sim.driver.step.id).toBe('look');
    sim.look = { yaw: LOOK_TURN_RAD + 0.05, pitch: 0 };
    sim.pump();
    expect(sim.driver.step.id).toBe('hands');
  });

  it('counts the turn from where the head was when the step began, left or right', () => {
    const sim = makeSim();
    sim.look = { yaw: 1.0, pitch: 0 };
    sim.driver.ack();
    sim.pump();
    expect(sim.driver.step.id).toBe('look');
    sim.look = { yaw: 1.2, pitch: 0 };
    sim.pump();
    expect(sim.driver.step.id).toBe('look');
    sim.look = { yaw: 0.5, pitch: 0 };
    sim.pump();
    expect(sim.driver.step.id).toBe('hands');
  });

  it('shows a hint after 8 s, and Got it only after 20 s when the head cannot turn', () => {
    const sim = toLook();
    expect(sim.driver.ackable).toBe(false);
    expect(sim.driver.ack()).toBe(false);
    for (let i = 0; i < 7; i++) sim.tick();
    expect(sim.driver.hint).toBe(null);
    sim.tick();
    sim.tick();
    expect(sim.driver.hint).toMatch(/Q or E/);
    expect(sim.driver.hintFor('touch')).toMatch(/drag/);
    for (let i = 0; i < 12; i++) sim.tick();
    expect(sim.driver.ackable).toBe(true);
    expect(sim.driver.ack()).toBe(true);
    sim.pump();
    expect(sim.driver.step.id).toBe('hands');
  });

  it('works without any look input (older glue): the step waits for Got it after 20 s instead of auto-completing', () => {
    const sim = makeSim();
    sim.look = null;
    sim.driver.ack();
    sim.pump();
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.driver.step.id).toBe('look');
    expect(sim.driver.ack()).toBe(true);
    sim.pump();
    expect(sim.driver.step.id).toBe('hands');
  });
});

describe('what is allowed (the HUD refuses the rest)', () => {
  it('exposes driver.allowed and driver.allows(type) per step, always with move', () => {
    const sim = makeSim();
    expect(sim.driver.allowed).toEqual(['move']);
    expect(sim.driver.allows('move')).toBe(true);
    expect(sim.driver.allows('cook')).toBe(false);
    expect(sim.driver.allows('emote')).toBe(true); // not a gated game action
    expect(sim.driver.notYet).toBe(TUTORIAL_NOT_YET);
    expect(TUTORIAL_NOT_YET).toBe('Chotu says: not yet!');
  });

  it('while the player reads (walk, token, recipe card) cooking is refused, and in the cook step only cooking is', () => {
    const sim = playTo(makeSim(), 'dosa-cook');
    expect(sim.allowedBy.walk).toEqual(['move']);
    expect(sim.allowedBy.token).toEqual(['move']);
    expect(sim.allowedBy['dosa-card']).toEqual(['move']);
    expect(sim.driver.step.id).toBe('dosa-cook');
    expect(sim.driver.allows('cook')).toBe(true);
    expect(sim.driver.allows('serve')).toBe(false);
    expect(sim.driver.allows('collect')).toBe(false);
  });

  it('across a whole play every step reported a list that includes move, and take/serve/collect appear only where they belong', () => {
    const sim = play(makeSim());
    for (const [id, a] of Object.entries(sim.allowedBy)) {
      if (!a) continue; // after the last Got it nothing is restricted
      expect(a, id).toContain('move');
      if (id.endsWith('-card') || ['walk', 'token', 'token-states', 'money', 'hearts', 'tips'].includes(id)) expect(a, id).toEqual(['move']);
      if (id.endsWith('-cook')) expect(a, id).not.toContain('collect');
      if (id.endsWith('-take')) expect(a, id).not.toContain('cook');
    }
    expect(sim.allowedBy.collect).toEqual(['move', 'collect']);
    expect(sim.allowedBy.rush).toEqual([...TUTORIAL_ACTIONS]);
    expect(sim.refused).toBeLessThan(40); // a bot that mostly does the right thing at the right time
  });

  it('is unrestricted once finished', () => {
    const sim = play(makeSim());
    expect(sim.driver.allowed).toBe(null);
    expect(sim.driver.allows('cook')).toBe(true);
  });
});

describe('keyboard and touch variants', () => {
  it('never mention keys on touch, across every text, hint and controls line the driver showed in a full play', () => {
    const sim = play(makeSim());
    const touch = sim.touchTexts.filter(Boolean);
    expect(touch.length).toBeGreaterThan(300);
    for (const t of touch) expect(noKeys(t), t).toBe(true);
    const kb = sim.kbTexts.filter(Boolean);
    expect(kb.some((t) => /Space/.test(t))).toBe(true);
    expect(kb.some((t) => /A \/ D/.test(t))).toBe(true);
  });

  it('textFor / hintFor / controlsFor and setPointer pick the variant', () => {
    const sim = makeSim();
    sim.driver.ack();
    sim.pump();
    expect(sim.driver.step.id).toBe('look');
    expect(sim.driver.text).toBe(sim.driver.textFor('keyboard'));
    expect(sim.driver.textFor('keyboard')).toMatch(/Q or E/);
    expect(sim.driver.textFor('touch')).toMatch(/drag/i);
    sim.driver.setPointer('touch');
    expect(sim.driver.pointer).toBe('touch');
    expect(sim.driver.text).toBe(sim.driver.textFor('touch'));
    expect(sim.driver.controls).toMatch(/Drag/);
    sim.driver.setPointer('mouse');
    expect(sim.driver.pointer).toBe('keyboard');
    expect(sim.driver.controls).toMatch(/Q \/ E/);
  });
});

describe('spotlights', () => {
  it('are plain data the scene understands, and every station, slot or customer target may turn the head (look: true)', () => {
    const sim = play(makeSim());
    const kinds = new Set(['station', 'slot', 'customer', 'bin', 'hands', 'gas', 'board']);
    expect(sim.spots.length).toBeGreaterThan(100);
    for (const { id, sp } of sim.spots) {
      expect(kinds.has(sp.kind), id).toBe(true);
      if (['station', 'slot', 'customer', 'gas', 'board'].includes(sp.kind)) expect(sp.look, `${id} ${sp.kind}`).toBe(true);
      if (sp.kind === 'station') expect(['tawa1', 'steamer1', 'kadai1', 'chai1', 'prep1']).toContain(sp.id);
    }
    const touched = new Set(sim.spots.map((x) => x.sp.id));
    for (const s of ['steamer1', 'kadai1', 'chai1', 'prep1']) expect(touched.has(s), s).toBe(true);
    expect(new Set(sim.spots.map((x) => x.sp.kind))).toEqual(new Set(['station', 'slot', 'customer', 'hands', 'gas', 'board', 'bin']));
  });
});

describe('chapters and progress', () => {
  it('lists the sixteen chapters with counts, advances them in order and fills the meter to the end', () => {
    const sim = makeSim();
    let prev = sim.driver.progress.done;
    expect(sim.driver.chapters.map((c) => c.id)).toEqual(CHAPTER_IDS);
    expect(sim.driver.chapters.reduce((n, c) => n + c.count, 0)).toBe(TUTORIAL_STEPS.length);
    expect(sim.driver.chapter).toMatchObject({ id: 'look', index: 0, step: 0 });
    expect(sim.driver.chapters[0]).toMatchObject({ active: true, complete: false, done: 0 });
    const activeSeen = new Set();
    while (!sim.driver.finished && !isOver(sim.state) && sim.state.tick < 3400) {
      const a = personAction(sim);
      if (a) sim.act(a);
      else sim.pump();
      const p = sim.driver.progress;
      expect(p.done).toBeGreaterThanOrEqual(prev); // never goes back, even on a recovery
      prev = p.done;
      expect(p.total).toBe(TUTORIAL_STEPS.length);
      if (!sim.driver.finished) activeSeen.add(sim.driver.chapter.id);
      if (sim.driver.finished) break;
      sim.tick();
    }
    expect([...activeSeen]).toEqual(TUTORIAL_CHAPTERS.map((c) => c.id));
    expect(sim.driver.chapters.every((c) => c.complete && c.done === c.count)).toBe(true);
    expect(sim.driver.progress.fraction).toBe(1);
  });
});

describe('tokens and spawn safety', () => {
  it('shows the token number of the customer on the first lesson steps', () => {
    const sim = playTo(makeSim(), 'token');
    sim.pump();
    const a = sim.state.customers[0];
    expect(a).toBeTruthy();
    expect(sim.driver.text).toContain(`Token #${a.id}`);
    expect(sim.driver.text).toContain('Plain Dosa');
    expect(sim.driver.spotlight).toMatchObject({ kind: 'customer', id: a.id, look: true });
  });

  it('sends a spawn again when the stall had no free spot, and strips its bookkeeping tag', () => {
    const sim = makeSim();
    // drive up to the token step without applying its spawn
    let spawn = null;
    let guard = 0;
    while (!spawn && guard++ < 60) {
      if (sim.driver.step.id === 'look') sim.look = { yaw: sim.look.yaw + 0.5, pitch: 0 };
      sim.driver.ack();
      const r = sim.driver.advance(sim.state, [], { meId: ME, look: sim.look });
      for (const a of r.actions) {
        if (a.type === 'spawn') spawn = a;
        else sim.apply(a);
      }
    }
    expect(spawn).toBeTruthy();
    expect(Object.keys(spawn).sort()).toEqual(['customer', 'type']); // no `tag` leaks to the engine
    expect(sim.driver.step.id).toBe('token');
    let again = null;
    for (let i = 0; i < 6 && !again; i++) {
      sim.state = applyAction(sim.state, { type: 'tick' }).state;
      const r = sim.driver.advance(sim.state, [], { meId: ME, look: sim.look });
      again = r.actions.find((a) => a.type === 'spawn') || null;
    }
    expect(again).toEqual(spawn);
    expect(sim.state.customers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// the operations chapters: stock and the back counter, the tawa, gas, the board, special orders, weather, profit

const OPS_CHAPTERS = ['stock', 'heat', 'gas', 'board', 'special', 'weather', 'profit'];
const eventsOf = (sim, type, pred) => sim.events.filter((e) => e.type === type && (!pred || pred(e)));

describe('the operations chapters teach every mechanic through the real engine', () => {
  it('a full play really prepares, tends, swaps the cylinder, uses the board, serves special orders and passes the inspector', () => {
    const sim = play(makeSim());
    expect(sim.driver.done).toBe(true);
    expect(sim.errors).toEqual([]);
    // stock and the back counter
    expect(eventsOf(sim, 'prep-start').length).toBeGreaterThanOrEqual(6);
    expect(eventsOf(sim, 'prep-collect').map((e) => e.item)).toEqual(expect.arrayContaining(['batter_dosa', 'sambar', 'coconut_chutney']));
    expect(eventsOf(sim, 'batter-sour').length).toBeGreaterThanOrEqual(1);
    expect(eventsOf(sim, 'stock-out', (e) => e.item === 'batter_dosa').length).toBeGreaterThanOrEqual(1);
    // the tawa: a torn dosa pays half, then every pan is tended with its own verb
    expect(eventsOf(sim, 'ready', (e) => e.flaw === 'torn')).toHaveLength(1);
    const broken = eventsOf(sim, 'serve', (e) => e.q === 'broken');
    expect(broken).toHaveLength(1);
    const paid = eventsOf(sim, 'collect', (e) => e.customer === broken[0].customer)[0];
    expect(paid.amount).toBe(DISHES.dosa.price / 2);
    expect(new Set(eventsOf(sim, 'tend').map((e) => e.kind))).toEqual(new Set(['wipe', 'skim', 'water']));
    // gas
    expect(eventsOf(sim, 'gas-low')).toHaveLength(1);
    expect(eventsOf(sim, 'gas-swap').map((e) => e.phase)).toEqual(['start', 'done']);
    expect(eventsOf(sim, 'gas-swap')[0].cost).toBe(GAS.swapCost);
    // the board: off, customers swap their order, back on
    expect(eventsOf(sim, 'board').map((e) => e.on)).toEqual([false, true]);
    expect(eventsOf(sim, 'sold-out', (e) => e.swap && !e.left).length).toBeGreaterThanOrEqual(2);
    // special orders
    expect(eventsOf(sim, 'extra')).toHaveLength(1);
    expect(eventsOf(sim, 'parcel-order', (e) => e.big)).toHaveLength(1);
    expect(eventsOf(sim, 'parcel-order', (e) => e.delivery)).toHaveLength(1);
    expect(eventsOf(sim, 'eating', (e) => e.parcel).length).toBeGreaterThanOrEqual(3);
    expect(sim.state.regs[0][0]).toBe(2); // Raju came twice and was served well both times
    // weather
    expect(eventsOf(sim, 'event-start').map((e) => e.id)).toEqual(['rain', 'power', 'inspector']);
    expect(eventsOf(sim, 'inspector').map((e) => e.pass)).toEqual([true]);
    // profit: costs, waste and the books add up
    expect(sim.state.cost).toBeGreaterThan(GAS.swapCost);
    expect(sim.state.waste).toBeGreaterThan(0);
    expect(sim.state.profit).toBe(sim.state.money - sim.state.cost);
    expect(sim.state.fines || 0).toBe(0);
  });

  it('the final rush uses prep and tend', () => {
    const sim = play(makeSim());
    const rush = sim.events.slice(sim.stepAt.rush, sim.stepAt.outro);
    expect(rush.some((e) => e.type === 'prep-start' && e.item === 'batter_dosa')).toBe(true);
    expect(rush.some((e) => e.type === 'prep-collect' && e.item === 'batter_dosa')).toBe(true);
    expect(rush.some((e) => e.type === 'tend' && e.station === 'tawa1')).toBe(true);
    expect(rush.some((e) => e.type === 'collect')).toBe(true);
  });

  it('every chapter switches its mechanic on with a tutorial-flags action when its lesson starts (and the level starts with all of it off)', () => {
    const sim = makeSim();
    expect(sim.state.cfg).toMatchObject({ stock: false, gas: false, heat: false, market: false, events: [] });
    play(sim);
    const flagged = (key) => sim.log.filter((l) => l.includes('"tutorial-flags"') && l.includes(`"${key}":true`));
    for (const key of ['stock', 'heat', 'gas', 'events']) expect(flagged(key), key).toHaveLength(1);
    expect(sim.state.cfg).toMatchObject({ stock: true, gas: true, heat: true, events: ['staged'] });
    expect(sim.state.cfg.market).toBe(false); // the market is a real-shift thing, only explained
  });

  it('shows the engine\'s own refusals: a heavy cylinder, an already clean pan, a dead steamer and an empty batter jar', () => {
    const sim = makeSim(4);
    const tried = new Set();
    const attempt = (id, action) => (state, driver) => {
      if (driver.step.id === id && !tried.has(id)) {
        tried.add(id);
        return action(state);
      }
      return undefined;
    };
    const tries = [
      attempt('gas-intro', () => ({ type: 'swapGas' })),
      attempt('heat-others', () => ({ type: 'tend', station: 'tawa1' })),
      attempt('stock-out-refused', (s) => ({ type: 'cook', station: 'tawa1', slot: s.stations.tawa1.slots.findIndex((x) => x.st === 'empty'), dish: 'dosa' })),
      (state, driver) => {
        if (driver.step.id === 'power-serve' && !tried.has('power') && state.events.some((e) => e.id === 'power') && state.stations.steamer1.slots[0].st === 'empty') {
          tried.add('power');
          return { type: 'cook', station: 'steamer1', slot: 0, dish: 'idly' };
        }
        return undefined;
      },
    ];
    play(sim, { extra: (state, driver) => { for (const t of tries) { const a = t(state, driver); if (a !== undefined) return a; } return undefined; } });
    expect(sim.errors.map((e) => e.error)).toEqual([
      'Out of dosa batter', 'Already clean', 'The cylinder is still heavy', 'Power cut: the steamer is off', // in the order of the chapters
    ]);
    expect(sim.driver.done).toBe(true);
  });

  it('out of batter is recoverable: losing the first dosa sends the player back to restage the lesson, and it still completes', () => {
    const sim = makeSim(5);
    let lost = false;
    play(sim, {
      extra: (state, driver) => {
        if (!lost && driver.step.id === 'stock-out-serve' && state.players[ME].hands.length) { lost = true; return { type: 'discard', hand: 0 }; }
        return undefined;
      },
    });
    expect(lost).toBe(true);
    expect(sim.errors).toEqual([]);
    expect(sim.driver.visits['stock-out-order']).toBeGreaterThan(1);
    expect(sim.driver.done).toBe(true);
  });

  it('a failed inspector drill costs a fine, comes back with a longer warning, and passes the second time', () => {
    const sim = makeSim(6);
    play(sim, { extra: (state, driver) => (driver.step.id === 'inspect-drill' && driver.attempts.inspect === 0 ? null : undefined) });
    expect(sim.driver.attempts.inspect).toBe(1);
    expect(sim.driver.visits['inspect-drill']).toBe(2);
    expect(sim.state.fines).toBeGreaterThan(0);
    expect(eventsOf(sim, 'inspector').map((e) => e.pass)).toEqual([false, true]);
    expect(sim.state.lives).toBe(5); // the training shift never costs a heart
    let last = 0;
    const fuses = [];
    for (const e of sim.events) {
      if (e.type === 'tick') last = e.tick;
      if (e.type === 'event-start' && e.id === 'inspector') fuses.push(e.until - last);
    }
    expect(fuses).toEqual([20, 30]);
    expect(sim.driver.done).toBe(true);
  });

  it('nothing in the operations chapters is finished by idling: a player who does nothing at a step stays at or before it', () => {
    const waits = new Set(['gas-low', 'gas-wait']); // these end by themselves once the player's own action has run
    const ids = TUTORIAL_STEPS.filter((s) => OPS_CHAPTERS.includes(s.chapter) && !s.ack && !waits.has(s.id) && s.id !== 'inspect-clean').map((s) => s.id);
    expect(ids.length).toBeGreaterThan(30);
    for (const id of ids) {
      const sim = playTo(makeSim(5), id, 1200);
      expect(sim.driver.step.id, `reached ${id}`).toBe(id);
      const at = sim.driver.index;
      for (let i = 0; i < 160; i++) {
        sim.tick();
        sim.driver.ack(); // even a player who keeps pressing Got it
      }
      expect(sim.driver.index, `idle at ${id}`).toBeLessThanOrEqual(at);
      expect(sim.driver.done, `idle at ${id}`).toBe(false);
    }
  });

  it('every operations step names what is allowed, and only the lesson\'s own operations action', () => {
    const at = (id) => TUTORIAL_STEPS.find((s) => s.id === id);
    expect(at('stock-turn').allow).toEqual(['move']);
    expect(at('stock-batter').allow).toEqual(['move', 'prep', 'collectPrep']); // a finished junk job in the way can be cleared
    expect(at('stock-grind').allow).toEqual(['move', 'collectPrep']);
    expect(at('stock-out-cook').allow).toContain('cook');
    expect(at('stock-out-cook').allow).not.toContain('prep');
    expect(at('heat-tend').allow).toEqual(['move', 'tend']);
    expect(at('gas-swap').allow).toContain('swapGas');
    expect(at('gas-cook').allow).not.toContain('swapGas');
    expect(at('board-off').allow).toEqual(['move', 'board']);
    expect(at('power-cut').allow).toEqual(['move', 'prep', 'collectPrep']);
    expect(at('inspect-drill').allow).toEqual(['move', 'take', 'tend', 'discard']);
    for (const op of ['prep', 'collectPrep', 'tend', 'swapGas', 'board']) {
      expect(TUTORIAL_ACTIONS).toContain(op);
      const where = TUTORIAL_STEPS.filter((s) => s.allow.includes(op)).map((s) => s.chapter);
      expect(where.length, op).toBeGreaterThan(0);
      for (const c of where) expect([...OPS_CHAPTERS, 'rush']).toContain(c); // never in the cooking lessons that come before the mechanic exists
    }
  });

  it('step texts show the live numbers (batter freshness, the gas gauge, the books)', () => {
    const sim = playTo(makeSim(), 'stock-grind', 900);
    expect(sim.driver.text).toMatch(/Freshness now \d+ of 100|READY/);
    const sim2 = playTo(makeSim(), 'gas-intro', 900);
    sim2.pump();
    expect(sim2.driver.text).toContain('% full');
    const sim3 = playTo(makeSim(), 'profit-profit', 1500);
    expect(sim3.driver.text).toMatch(/PROFIT is what is left: cash in hand Rs \d+ minus cost Rs \d+ = Rs \d+/);
  });

  it('prep cards come with the back-counter steps (driver.recipe) and every one is a real ingredient', () => {
    const sim = playTo(makeSim(), 'stock-batter', 900);
    const card = sim.driver.recipe;
    expect(card).toMatchObject({ dish: 'batter_dosa', prep: true, name: INGREDIENTS.batter_dosa.name, station: 'prep1', needs: 'power' });
    expect(card.goes.length).toBeGreaterThanOrEqual(2);
    expect(card.steps).toHaveLength(3);
    expect(TUTORIAL_PREP_RECIPES).toEqual(expect.arrayContaining(['batter_dosa', 'sambar']));
    for (const item of TUTORIAL_PREP_RECIPES) expect(INGREDIENT_IDS).toContain(item);
    expect([...TUTORIAL_RECIPE_DISHES].sort()).toEqual([...DISH_IDS].sort()); // prep cards are not dish cards
    const dosa = playTo(makeSim(), 'dosa-card');
    expect(dosa.driver.recipe.uses.map((u) => u.item)).toEqual(Object.keys(DISHES.dosa.uses));
  });

  it('special orders arrive with their requests: parcel fee, extra, loyalty, the big order and the delivery boy', () => {
    const sim = playTo(makeSim(), 'parcel', 1500);
    sim.pump();
    const p = sim.state.customers.find((c) => c.parcel);
    expect(p).toMatchObject({ name: 'Imran bhai', parcel: true, total: DISHES.masala_dosa.price + DISHES.irani_chai.price + REQUEST.parcelFee * 2 });
    const x = playTo(makeSim(), 'extra', 1500);
    x.pump();
    expect(x.state.customers.find((c) => c.extra)).toMatchObject({ extra: 'coconut_chutney', spice: 'more' });
    const r = playTo(makeSim(), 'regular', 1500);
    r.pump();
    expect(r.state.customers.find((c) => c.regular)).toMatchObject({ regular: true, loyal: 0 });
    const b = playTo(makeSim(), 'big', 1500);
    b.pump();
    expect(b.state.customers.find((c) => c.big)).toMatchObject({ big: true, parcel: true });
    const d = playTo(makeSim(), 'delivery', 1500);
    d.pump();
    const boy = d.state.customers.find((c) => c.delivery);
    expect(boy.order).toHaveLength(REQUEST.delivery.dishes);
    expect(boy.patienceMax).toBe(REQUEST.delivery.patience);
  });
});

describe('spawn and flag actions the operations chapters send', () => {
  it('spawnAction carries the special requests with the patience the schedule would give, and stays plain without them', () => {
    const plain = spawnAction({ kind: 'student', name: 'Kiran', order: ['dosa'], tag: 'A' });
    expect(Object.keys(plain.customer).sort()).toEqual(['kind', 'look', 'name', 'order', 'patienceMax']);
    const parcel = spawnAction({ kind: 'student', name: 'Kiran', order: ['dosa'], parcel: true });
    expect(parcel.customer.parcel).toBe(true);
    expect(parcel.customer.patienceMax).toBe(Math.round(plain.customer.patienceMax * REQUEST.parcelPatience));
    const big = spawnAction({ kind: 'office', name: 'X', order: ['dosa'], big: true });
    expect(big.customer).toMatchObject({ big: true, patienceMax: Math.round(spawnAction({ kind: 'office', name: 'X', order: ['dosa'] }).customer.patienceMax * REQUEST.big.patience) });
    const boy = spawnAction({ kind: 'autowala', name: 'D', order: ['dosa'], delivery: true });
    expect(boy.customer).toMatchObject({ delivery: true, patienceMax: REQUEST.delivery.patience });
    expect(spawnAction({ kind: 'student', name: 'R', order: ['dosa'], regular: true, loyal: 2, extra: 'sambar', spice: 'less', fit: true }).customer).toMatchObject({ regular: true, loyal: 2, extra: 'sambar', spice: 'less', fit: true });
    expect(trainAction({ stock: true, stage: { stock: { '*': 4 } } })).toEqual({ type: 'tutorial-flags', stock: true, stage: { stock: { '*': 4 } } });
  });
});

describe('prep recipes and the per-dish ingredient list', () => {
  it('has a back-counter recipe for EVERY ingredient: what goes in, how it is made, Telugu and Hindi, flagged for native review', () => {
    expect(Object.keys(PREP_RECIPES).sort()).toEqual([...INGREDIENT_IDS].sort());
    expect(RECIPE_REVIEW).toMatchObject({ te: true, hi: true });
    for (const id of INGREDIENT_IDS) {
      const r = prepRecipeFor(id);
      expect(r.item, id).toBe(id);
      expect(r.station, id).toBe('prep1');
      expect(r.needs, id).toBe(INGREDIENTS[id].prep.needs);
      expect(r.goes.length, id).toBeGreaterThanOrEqual(2);
      expect(r.goes.length, id).toBeLessThanOrEqual(3);
      expect(r.steps, id).toHaveLength(3);
      expect(r.goesTe, id).toHaveLength(r.goes.length);
      expect(r.goesHi, id).toHaveLength(r.goes.length);
      expect(r.te, id).toHaveLength(3);
      expect(r.hi, id).toHaveLength(3);
      for (const l of [...r.goesTe, ...r.te, r.tipTe]) expect(l, id).toMatch(/[ఀ-౿]/);
      for (const l of [...r.goesHi, ...r.hi, r.tipHi]) expect(l, id).toMatch(/[ऀ-ॿ]/);
      for (const l of [...r.goes, ...r.steps, r.tip]) expect(l.length, `${id} ${l}`).toBeGreaterThan(8);
      expect(prepRecipeSteps(id, 'te')).toEqual(r.te);
      expect(prepRecipeSteps(id, 'hi')).toEqual(r.hi);
      expect(prepRecipeSteps(id, 'zz')).toEqual(r.steps);
      expect(prepRecipeGoes(id, 'hi')).toEqual(r.goesHi);
      expect(prepRecipeTip(id, 'te')).toBe(r.tipTe);
      expect(prepRecipeTip(id)).toBe(r.tip);
    }
    expect(prepRecipeFor('nope')).toBe(null);
    expect(prepRecipeSteps('nope')).toEqual([]);
    expect(prepRecipeTip('nope')).toBe('');
    // the ones the brief names
    expect(prepRecipeGoes('batter_dosa')[0]).toMatch(/rice/);
    expect(prepRecipeGoes('potato_masala').join(' ')).toMatch(/potato/i);
    expect(prepRecipeGoes('poori_dough').join(' ')).toMatch(/flour|atta/i);
    expect(prepRecipeGoes('sambar').join(' ')).toMatch(/dal/i);
    expect(prepRecipeGoes('coconut_chutney').join(' ')).toMatch(/coconut/i);
  });

  it('lists the ingredients of every dish from the catalogue, in the three languages, with portion labels', () => {
    for (const id of DISH_IDS) {
      const list = ingredientsOf(id);
      expect(list.map((u) => u.item), id).toEqual(Object.keys(DISHES[id].uses));
      expect(recipeFor(id).uses, id).toEqual(list);
      for (const u of list) {
        expect(u.qty).toBe(DISHES[id].uses[u.item]);
        expect(u.name).toBe(INGREDIENTS[u.item].name);
        expect(u.te).toMatch(/[ఀ-౿]/);
        expect(u.hi).toMatch(/[ऀ-ॿ]/);
        expect(u.label.length).toBeGreaterThan(0);
      }
    }
    for (const id of INGREDIENT_IDS) expect(INGREDIENT_HI[id], id).toMatch(/[ऀ-ॿ]/);
    expect(ingredientsOf('nope')).toEqual([]);
    expect([0.25, 0.5, 1, 1.25, 2].map(portionLabel)).toEqual(['1/4', '1/2', '1', '1 1/4', '2']);
    expect(ingredientsOf('masala_dosa').find((u) => u.item === 'potato_masala').label).toBe('1');
    expect(ingredientsOf('dosa').find((u) => u.item === 'oil').label).toBe('1/4');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// soft-locks: whatever the player does (or the stall does behind the lesson's back), the tutorial can always be finished

const finished = (sim) => sim.driver.done && sim.driver.finished && sim.completed === 1 && !isOver(sim.state);
const stepOf = (id) => TUTORIAL_STEPS.find((s) => s.id === id);
/** The rest of the lesson, played by the competent scripted player, with room for a retry or two. */
const finishLesson = (sim, ticks = 2300) => play(sim, { maxTicks: sim.state.tick + ticks });
const copyState = (s) => JSON.parse(JSON.stringify(s));

/** Seeded PRNG (mulberry32). */
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A player who makes mistakes between the lesson's own actions: wastes dishes (cooks things nobody ordered), serves the wrong customer, collects
 * from nobody, discards, takes whatever is ready, starts extra jobs at the back counter (extra batter), changes the cylinder early, marks a
 * wrong dish sold out, tends a clean pan, wanders off, and now and then stops for a while (so patience and pay windows run out when they are live).
 * `respect`: only what the HUD would let through in this step (driver.allows). `budget`: how many mistakes in all. Use as `extra` of play().
 */
function chaos(rand, { rate = 0.2, idleRate = 0.012, respect = true, budget = Infinity, noBoard = false } = {}) {
  let idle = 0;
  let used = 0;
  const pick = (list) => list[Math.floor(rand() * list.length)];
  return (state, driver) => {
    if (used >= budget) return undefined;
    if (idle > 0) { idle -= 1; return null; }
    if (rand() < idleRate) { idle = 4 + Math.floor(rand() * 60); return null; }
    if (rand() >= rate) return undefined;
    const stations = state.cfg.stations.filter((id) => state.stations[id].kind !== 'prep');
    const sid = pick(stations);
    const st = state.stations[sid];
    const alive = state.customers.filter((c) => c.st !== 'left');
    const mistakes = {
      cook: () => ({ type: 'cook', station: sid, slot: Math.floor(rand() * st.slots.length), dish: pick(DISH_IDS.filter((d) => DISHES[d].station === st.kind)) }),
      discard: () => ({ type: 'discard', hand: Math.floor(rand() * 2) }),
      serve: () => (alive.length ? { type: 'serve', customer: pick(alive).id, hand: Math.floor(rand() * 2) } : null),
      take: () => ({ type: 'take', station: sid, slot: Math.floor(rand() * st.slots.length) }),
      prep: () => (state.stations.prep1 ? { type: 'prep', station: 'prep1', slot: Math.floor(rand() * 2), item: pick(Object.keys(state.stock)) } : null),
      collectPrep: () => (state.stations.prep1 ? { type: 'collectPrep', station: 'prep1', slot: Math.floor(rand() * 2) } : null),
      swapGas: () => ({ type: 'swapGas' }),
      board: () => (state.cfg.stock && !noBoard ? { type: 'board', dish: pick(state.cfg.menu), on: rand() < 0.3 } : null),
      tend: () => ({ type: 'tend', station: pick(stations) }),
      collect: () => (alive.length ? { type: 'collect', customer: pick(alive).id } : null),
      move: () => ({ type: 'move', to: pick([...state.cfg.stations, 'bin', ...(state.cfg.gas ? ['gas'] : [])]) }),
    };
    const a = mistakes[pick(Object.keys(mistakes))]();
    if (!a || (respect && !driver.allows(a.type))) return undefined;
    used += 1;
    return a;
  };
}

/** Every mistake the HUD lets through in the step the sim stands on, one after the other, with time between them for the dishes to get ready. */
function worstMistake(sim) {
  const JUNK = { tawa: 'pesarattu', steamer: 'idly', kadai: 'mirchi_bajji', chai: 'osmania' };
  const attempt = (a) => { if (sim.driver.allows(a.type)) sim.act(a); };
  for (let round = 0; round < 2; round++) {
    const s = sim.state;
    for (const sid of s.cfg.stations) {
      const st = s.stations[sid];
      st.slots.forEach((_, slot) => {
        if (st.kind === 'prep') attempt({ type: 'prep', station: sid, slot, item: round ? 'mirchi' : 'biscuits' });
        else attempt({ type: 'cook', station: sid, slot, dish: JUNK[st.kind] });
      });
    }
    attempt({ type: 'swapGas' });
    for (const d of s.cfg.menu) attempt({ type: 'board', dish: d, on: false });
    for (const c of sim.state.customers) { attempt({ type: 'serve', customer: c.id, hand: 0 }); attempt({ type: 'collect', customer: c.id }); }
    for (let i = 0; i < 9; i++) sim.tick();
    for (const sid of s.cfg.stations) {
      if (s.stations[sid].kind === 'prep') continue;
      s.stations[sid].slots.forEach((_, slot) => attempt({ type: 'take', station: sid, slot })); // the junk ends up in both hands
    }
    for (const sid of s.cfg.stations) if (s.stations[sid].kind !== 'prep') attempt({ type: 'tend', station: sid });
  }
}

describe('soft-locks: the lesson can always be finished', () => {
  it('cook2, carry and serve2 share one recovery, and a token served, paid and gone no longer blocks cook2 (finding H4)', () => {
    expect(typeof stepOf('cook2').recover).toBe('function');
    expect(stepOf('cook2').recover).toBe(stepOf('carry').recover);
    expect(stepOf('serve2').recover).toBe(stepOf('carry').recover);
    // the exact trace: serve the dosa, collect that token at once, then lose the idly held for the other: only C is left, and cook2 has to let go of B
    const sim = playTo(makeSim(23), 'serve2', 400);
    expect(sim.driver.step.id).toBe('serve2');
    const me = () => sim.state.players[ME];
    const dosa = sim.state.customers.find((c) => c.name === 'Padma' && c.order[0] === 'dosa');
    if (dosa.st === 'waiting') sim.act({ type: 'serve', customer: dosa.id, hand: me().hands.findIndex((h) => h.dish === 'dosa') });
    for (let i = 0; i < 12 && sim.state.customers.some((c) => c.id === dosa.id && c.st !== 'left'); i++) {
      if (sim.state.customers.find((c) => c.id === dosa.id).st === 'paying') sim.act({ type: 'collect', customer: dosa.id });
      else sim.tick();
    }
    for (let i = 0; i < 5; i++) sim.tick(); // the paid customer leaves the state
    expect(sim.state.customers.some((c) => c.id === dosa.id)).toBe(false);
    sim.act({ type: 'discard', hand: me().hands.findIndex((h) => h.dish === 'idly') });
    expect(['cook2', 'carry']).toContain(sim.driver.step.id);
    finishLesson(sim);
    expect(finished(sim)).toBe(true);
  });

  it('a customer who is gone for good at ANY step (walked out, pruned unseen) is seated again and the lesson goes on', () => {
    const bad = [];
    for (const id of TUTORIAL_STEP_IDS) {
      const sim = playTo(makeSim(5), id, 1500);
      if (sim.driver.step.id !== id) continue; // (the demo-dish steps only exist while their dish does)
      const s = copyState(sim.state);
      s.customers = [];
      sim.state = s;
      sim.pump();
      finishLesson(sim);
      if (!finished(sim)) bad.push(id + '@' + sim.driver.step.id);
    }
    expect(bad).toEqual([]);
  }, 120000);

  it("a stall changed behind the lesson's back (stock, gas and steamer water gone, dishes lost or burnt, hands jammed, prep counter jammed, board off) never blocks it", () => {
    const tampers = {
      starve: (s) => {
        if (s.cfg.stock) for (const k of Object.keys(s.stock)) s.stock[k] = 0;
        if (s.cfg.gas && s.gas) { s.gas.u = 0; s.gas.sw = 0; }
        if (s.cfg.heat) for (const st of Object.values(s.stations)) if (st.kind === 'steamer') st.water = 0;
      },
      wipeDishes: (s) => {
        for (const st of Object.values(s.stations)) if (st.kind !== 'prep') for (const sl of st.slots) Object.assign(sl, { st: 'empty', dish: null, t0: 0, readyAt: 0, burnAt: 0, by: null });
        for (const p of Object.values(s.players)) p.hands = [];
      },
      jamHands: (s) => { for (const p of Object.values(s.players)) p.hands = [{ dish: 'osmania', q: 'ok' }, { dish: 'vada', q: 'ok' }]; },
      jamPrep: (s) => {
        if (s.stations.prep1) s.stations.prep1.slots.forEach((sl, i) => Object.assign(sl, { st: 'ready', item: i ? 'mirchi' : 'biscuits', t0: 0, readyAt: 0, by: ME }));
      },
      everything: (s) => {
        for (const st of Object.values(s.stations)) if (st.kind !== 'prep') for (const sl of st.slots) { sl.st = 'burnt'; sl.dish = sl.dish || 'vada'; }
        if (s.cfg.stock) { for (const k of Object.keys(s.stock)) s.stock[k] = 47; s.off = s.cfg.menu.slice(); }
        for (const p of Object.values(s.players)) p.hands = [{ dish: 'osmania', q: 'ok' }, { dish: 'vada', q: 'ok' }];
      },
    };
    const bad = [];
    for (const [name, tamper] of Object.entries(tampers)) {
      for (const id of TUTORIAL_STEP_IDS) {
        const sim = playTo(makeSim(5), id, 1500);
        if (sim.driver.step.id !== id) continue;
        const s = copyState(sim.state);
        tamper(s);
        sim.state = s;
        sim.pump();
        finishLesson(sim);
        if (!finished(sim)) bad.push(name + ':' + id + '@' + sim.driver.step.id);
      }
    }
    expect(bad).toEqual([]);
  }, 240000);

  it('chaos: 40 seeds of a player who keeps making mistakes still finish the whole tutorial, once, in good time', () => {
    const slow = [];
    let worst = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const sim = makeSim(seed);
      play(sim, { maxTicks: 3300, extra: chaos(rng32(seed * 7919), { rate: 0.2 }) });
      if (!finished(sim)) slow.push(seed + '@' + sim.driver.step.id);
      expect(sim.completed, 'seed ' + seed).toBe(1);
      worst = Math.max(worst, sim.state.tick);
    }
    expect(slow).toEqual([]);
    expect(worst).toBeLessThan(2400); // a bot that never reads; the shift lasts 3600
  });

  it('chaos, harder: a mistake every few ticks, and mistakes the HUD would have refused (a HUD that forgot) still cannot stop it', () => {
    const slow = [];
    for (let seed = 101; seed <= 130; seed++) {
      const sim = makeSim(seed);
      play(sim, { maxTicks: 3300, extra: chaos(rng32(seed * 104729), { rate: 0.35, respect: seed % 2 === 0, noBoard: seed % 2 === 1, budget: seed % 2 === 1 ? 80 : Infinity }) });
      if (!finished(sim)) slow.push(seed + '@' + sim.driver.step.id);
    }
    expect(slow).toEqual([]);
  });

  it('stuck detector: at every step a player who does nothing is never moved on (even pressing Got it), still has the hints, and can finish after a long wait', () => {
    let tested = 0;
    for (const id of TUTORIAL_STEP_IDS) {
      const sim = playTo(makeSim(5), id, 1500);
      if (sim.driver.step.id !== id) continue;
      tested += 1;
      const at = sim.driver.index;
      const visits = sim.driver.visits[id];
      const step = stepOf(id);
      for (let i = 0; i < 200; i++) {
        sim.tick();
        if (!step.ack) sim.driver.ack(); // (a Got it press that nothing waits for does nothing)
      }
      if (id !== 'outro') { // the outro IS the end
        expect(sim.driver.index, 'idle at ' + id).toBeLessThanOrEqual(at); // (it may fall back: a dish that burnt is cooked again)
        expect(sim.driver.done, 'idle at ' + id).toBe(false);
        if (sim.driver.index === at && sim.driver.visits[id] === visits) expect(sim.driver.hint, 'idle at ' + id).toBeTruthy();
      }
      for (let i = 0; i < 200; i++) sim.tick(); // 400 ticks in all: the batter sours and is thrown away, the pans cool, the shelf empties
      finishLesson(sim);
      expect(finished(sim), 'after a long wait at ' + id + ' it stands on ' + sim.driver.step.id).toBe(true);
    }
    expect(tested).toBeGreaterThan(115);
  }, 120000);

  it('stuck detector: at every step the worst plausible mistake (junk everywhere, hands full of it, board off, jobs started, cylinder changed) can still be finished', () => {
    const bad = [];
    for (const id of TUTORIAL_STEP_IDS) {
      const sim = playTo(makeSim(5), id, 1500);
      if (sim.driver.step.id !== id) continue;
      worstMistake(sim);
      finishLesson(sim);
      if (!finished(sim)) bad.push(id + '@' + sim.driver.step.id);
    }
    expect(bad).toEqual([]);
  }, 120000);
});

describe('soft-locks: what the player is told', () => {
  it('names the way out when the hands are full of dishes nobody ordered (and points at the bin), in a take step and a carry step', () => {
    for (const id of ['dosa-take', 'carry', 'stock-out-serve']) {
      const sim = playTo(makeSim(5), id, 900);
      expect(sim.driver.step.id).toBe(id);
      const s = copyState(sim.state);
      s.players[ME].hands = [{ dish: 'osmania', q: 'ok' }, { dish: 'vada', q: 'ok' }];
      sim.state = s;
      sim.pump();
      for (let i = 0; i < 9; i++) sim.tick();
      if (sim.driver.step.id !== id) continue; // (a dish that burnt in the meantime sends the lesson back, which is fine too)
      expect(sim.driver.hint, id).toMatch(/one nobody ordered/);
      expect(sim.driver.hintFor('touch'), id).toMatch(/Tap the bin/);
      expect(sim.driver.spotlight, id).toMatchObject({ kind: 'bin', look: true });
    }
  });

  it('names the way out when every spot of the station is busy and when both back-counter job slots are', () => {
    const sim = playTo(makeSim(5), 'dosa-cook', 900);
    const s = copyState(sim.state);
    s.stations.tawa1.slots.forEach((sl) => Object.assign(sl, { st: 'burnt', dish: 'vada', t0: 0, readyAt: 0, burnAt: 0 }));
    sim.state = s;
    sim.pump();
    for (let i = 0; i < 9; i++) sim.tick();
    expect(sim.driver.step.id).toBe('dosa-cook');
    expect(sim.driver.hint).toMatch(/Every spot on the Dosa tawa is busy/);
    expect(sim.driver.spotlight).toMatchObject({ kind: 'slot', id: 'tawa1', slot: 0 });
    const prep = playTo(makeSim(5), 'stock-batter', 900);
    const p = copyState(prep.state);
    p.stations.prep1.slots.forEach((sl, i) => Object.assign(sl, { st: 'cooking', item: i ? 'mirchi' : 'biscuits', t0: p.tick, readyAt: p.tick + 40, by: ME }));
    prep.state = p;
    prep.pump();
    for (let i = 0; i < 9; i++) prep.tick();
    expect(prep.driver.hint).toMatch(/job slots at the back counter are busy/);
    expect(prep.driver.allows('collectPrep')).toBe(true); // a finished junk job can be cleared
  });

  it('puts the stall back when it ran dry, tells the player so, and the dish can then be cooked', () => {
    const sim = playTo(makeSim(5), 'heat-cook', 1500);
    const s = copyState(sim.state);
    s.stock.batter_dosa = 0;
    sim.state = s;
    sim.pump();
    expect(sim.state.stock.batter_dosa).toBeGreaterThanOrEqual(1);
    expect(sim.driver.notice).toBe(TUTORIAL_RESCUE_NOTE);
    expect(sim.log.some((l) => l.includes('"tutorial-flags"') && l.includes('batter_dosa'))).toBe(true);
    const cook = tutorialBotAction(sim.state, sim.driver, ME);
    expect(cook).toMatchObject({ type: 'cook', dish: 'dosa' });
    expect(sim.act(cook).error).toBeUndefined();
  });

  it('keeps the sold-out board honest: a dish marked off by mistake is put back, even when everything is off at the moment the customer looks', () => {
    const sim = playTo(makeSim(5), 'board-off', 1500);
    expect(sim.act({ type: 'board', dish: 'idly', on: false }).error).toBeUndefined();
    expect(sim.state.off).not.toContain('idly'); // put back at once
    const s = copyState(sim.state);
    s.off = s.cfg.menu.filter((d) => d !== 'dosa');
    sim.state = s;
    sim.act({ type: 'board', dish: 'dosa', on: false });
    finishLesson(sim);
    expect(finished(sim)).toBe(true);
    expect(sim.state.off).toEqual([]);
  });

  it('matches a customer to the spawn it came from (by name and order), so two tokens never swap their tags', () => {
    const sim = playTo(makeSim(5), 'orders', 900);
    sim.pump();
    const b = sim.state.customers.find((x) => x.name === 'Padma' && x.order[0] === 'dosa');
    const c = sim.state.customers.find((x) => x.name === 'Venkat uncle');
    expect(c.order).toEqual(['idly']);
    expect(sim.driver.step.id).toBe('orders');
    expect(sim.driver.text).toContain('Token #' + b.id + ' wants a Plain Dosa');
    expect(sim.driver.text).toContain('Token #' + c.id + ' wants an Idly');
  });
});
