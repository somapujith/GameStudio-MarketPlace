// Tiffin Centre balance: a greedy bot plays every level and the star targets must make sense for it.
// A bot acts once per tick like a fast human, and WALKS: each action costs walk time + the work animation, in whole ticks.
import { describe, it, expect, vi } from 'vitest';
import {
  createGame, applyAction, chooseAutoAction, actionCost, isOver, result, starTargets, MAX_LEVEL, LEVELS, HANDS_MAX,
} from './index.js';

/** Play a whole shift. `bot: false` = nobody does anything. Returns the final state. */
function play(level, pace, n, seed, { bot = true, slow = 1 } = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  let s = createGame({ players, settings: { level, pace }, seed });
  const freeAt = Object.fromEntries(players.map((p) => [p.id, 0]));
  let guard = 0;
  while (!isOver(s) && guard++ < 5000) {
    if (bot) {
      for (const p of players) {
        if (freeAt[p.id] > s.tick) continue;
        const a = chooseAutoAction(s, p.id);
        if (!a) continue;
        const cost = actionCost(s, p.id, a);
        const r = applyAction(s, a);
        if (r.error) throw new Error(`bot made an illegal move ${JSON.stringify(a)}: ${r.error}`);
        s = r.state;
        if (cost.to) s = applyAction(s, { type: 'move', playerId: p.id, to: cost.to }).state;
        freeAt[p.id] = s.tick + Math.ceil(cost.ticks * slow);
      }
    }
    s = applyAction(s, { type: 'tick' }).state;
  }
  return s;
}

vi.setConfig({ testTimeout: 120000 }); // whole shifts are simulated here

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const levels = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('bot basics', () => {
  it('returns null when it has nothing to do, or cannot act', () => {
    const s = createGame({ players: [{ id: 'a' }], settings: { level: 1 }, seed: 1 });
    expect(chooseAutoAction(s, 'a')).toBe(null);
    expect(chooseAutoAction(s, 'zed')).toBe(null);
    expect(chooseAutoAction(s, '__proto__')).toBe(null);
    expect(chooseAutoAction(null, 'a')).toBe(null);
    expect(chooseAutoAction({ ...s, status: 'done' }, 'a')).toBe(null);
  });

  it('starts cooking only what is ordered, never more than the demand', () => {
    let s = createGame({ players: [{ id: 'a' }], settings: { level: 1 }, seed: 1 });
    for (let i = 0; i < 2; i++) s = applyAction(s, { type: 'tick' }).state;
    expect(s.customers).toHaveLength(1);
    const order = s.customers[0].order;
    let cooks = 0;
    for (let i = 0; i < 10; i++) {
      const a = chooseAutoAction(s, 'a');
      if (!a || a.type !== 'cook') break;
      expect(order).toContain(a.dish);
      cooks += 1;
      s = applyAction(s, a).state;
    }
    expect(cooks).toBe(order.length);
  });

  it('takes, serves and collects in that order', () => {
    let s = createGame({ players: [{ id: 'a' }], settings: { level: 0 }, seed: 1 });
    s = applyAction(s, { type: 'spawn', customer: { order: ['dosa'] } }).state;
    s = applyAction(s, { type: 'cook', playerId: 'a', station: 'tawa1', slot: 0, dish: 'dosa' }).state;
    for (let i = 0; i < 5; i++) s = applyAction(s, { type: 'tick' }).state;
    let a = chooseAutoAction(s, 'a');
    expect(a).toMatchObject({ type: 'take', station: 'tawa1', slot: 0 });
    s = applyAction(s, a).state;
    a = chooseAutoAction(s, 'a');
    expect(a).toMatchObject({ type: 'serve', customer: 1, hand: 0 });
    s = applyAction(s, a).state;
    expect(chooseAutoAction(s, 'a')).toBe(null);
    for (let i = 0; i < 4; i++) s = applyAction(s, { type: 'tick' }).state;
    expect(chooseAutoAction(s, 'a')).toEqual({ type: 'collect', playerId: 'a', customer: 1 });
  });

  it('throws away a dish nobody wants and clears burnt slots', () => {
    let s = createGame({ players: [{ id: 'a' }], settings: { level: 0 }, seed: 1 });
    s = applyAction(s, { type: 'cook', playerId: 'a', station: 'chai1', slot: 0, dish: 'irani_chai' }).state;
    for (let i = 0; i < 4; i++) s = applyAction(s, { type: 'tick' }).state;
    s = applyAction(s, { type: 'take', playerId: 'a', station: 'chai1', slot: 0 }).state;
    expect(chooseAutoAction(s, 'a')).toEqual({ type: 'discard', playerId: 'a', hand: 0 });
    s = applyAction(s, { type: 'discard', playerId: 'a', hand: 0 }).state;
    s = applyAction(s, { type: 'cook', playerId: 'a', station: 'tawa1', slot: 0, dish: 'dosa' }).state;
    for (let i = 0; i < 13; i++) s = applyAction(s, { type: 'tick' }).state;
    expect(s.stations.tawa1.slots[0].st).toBe('burnt');
    expect(chooseAutoAction(s, 'a')).toEqual({ type: 'take', playerId: 'a', station: 'tawa1', slot: 0 });
  });

  it('actionCost: walk time plus the work animation, in whole ticks', () => {
    let s = createGame({ players: [{ id: 'a' }], settings: { level: 12 }, seed: 1 });
    expect(actionCost(s, 'a', { type: 'cook', station: 'tawa1', slot: 0 })).toEqual({ to: 'tawa1', ticks: 2 }); // from the middle: 3 m
    s = applyAction(s, { type: 'move', playerId: 'a', to: 'tawa1' }).state;
    expect(actionCost(s, 'a', { type: 'cook', station: 'tawa1', slot: 1 })).toEqual({ to: 'tawa1', ticks: 1 }); // already there
    expect(actionCost(s, 'a', { type: 'take', station: 'chai1', slot: 0 }).ticks).toBeGreaterThanOrEqual(2); // 6 m away
    expect(actionCost(s, 'a', { type: 'take', station: 'steamer1', slot: 0 }).ticks).toBe(1);
    expect(actionCost(s, 'a', { type: 'emote', e: 'fire' })).toEqual({ to: null, ticks: 1 });
    expect(actionCost(s, 'nobody', { type: 'discard', hand: 0 }).to).toBe('bin');
  });
});

describe('balance: a single bot (one action per tick, walking)', () => {
  it.each(levels(1, 8))('clears level %i with at least one star on every seed', (level) => {
    for (const seed of SEEDS) {
      const s = play(level, 'normal', 1, seed);
      expect(s.status, `level ${level} seed ${seed}`).toBe('done');
      expect(s.stars, `level ${level} seed ${seed}: money ${s.money}`).toBeGreaterThanOrEqual(1);
      for (const id of s.order) expect(s.players[id].hands.length).toBeLessThanOrEqual(HANDS_MAX);
    }
  });

  it.each(levels(4, 8))('does not get 3 stars easily on level %i', (level) => {
    const threes = SEEDS.filter((seed) => play(level, 'normal', 1, seed).stars === 3).length;
    expect(threes).toBeLessThanOrEqual(SEEDS.length / 2);
  });

  it('three stars on the first level is within reach', () => {
    expect(SEEDS.filter((seed) => play(1, 'normal', 1, seed).stars === 3).length).toBeGreaterThan(SEEDS.length / 2);
  });
});

describe('balance: bots together', () => {
  it('two bots reach three stars on level 4 at least sometimes (the co-op reward), and more often than one', () => {
    const seeds = [...SEEDS, 9, 10, 11, 12];
    const two = seeds.filter((seed) => play(4, 'normal', 2, seed).stars === 3).length;
    const one = seeds.filter((seed) => play(4, 'normal', 1, seed).stars === 3).length;
    expect(two).toBeGreaterThanOrEqual(1);
    expect(two).toBeGreaterThan(one);
  });

  it.each(levels(1, MAX_LEVEL))('four bots clear level %i', (level) => {
    for (const seed of [1, 2, 3]) {
      const s = play(level, 'normal', 4, seed);
      expect(s.status).toBe('done');
      expect(s.stars).toBeGreaterThanOrEqual(1);
      expect(result(s).reason).toBe('cleared');
    }
  });

  it.each(levels(1, MAX_LEVEL))('two bots clear level %i', (level) => {
    for (const seed of [1, 2, 3]) {
      const s = play(level, 'normal', 2, seed);
      expect(s.stars, `level ${level} seed ${seed}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('the last levels are for teams: one bot cannot three-star the festival', () => {
    for (const seed of [1, 2, 3]) expect(play(12, 'normal', 1, seed).stars).toBeLessThan(3);
  });

  it('pace matters: rush hour brings more customers, so a good team earns more', () => {
    const money = (pace) => SEEDS.reduce((n, seed) => n + play(6, pace, 2, seed).money, 0);
    expect(money('rush')).toBeGreaterThan(money('relaxed'));
  });
});

describe('balance: doing nothing', () => {
  it.each(levels(1, MAX_LEVEL))('level %i closes or fails when nobody plays', (level) => {
    for (const n of [1, 2, 4]) {
      const s = play(level, 'normal', n, 1, { bot: false });
      expect(isOver(s)).toBe(true);
      expect(s.stars).toBe(0);
      expect(result(s).winnerId).toBe(null);
      expect(s.money).toBe(0);
      expect(['closed', 'done']).toContain(s.status);
    }
  });
});

describe('the tutorial level', () => {
  it('runs to the end of its shift with a bot looking after a hand-fed customer', () => {
    let s = createGame({ players: [{ id: 'a' }], settings: { level: 0 }, seed: 1 });
    s = applyAction(s, { type: 'tutorial-flags', patience: true, pay: true }).state;
    s = applyAction(s, { type: 'spawn', customer: { order: ['dosa', 'irani_chai'] } }).state;
    let guard = 0;
    while (!isOver(s) && guard++ < 8000) {
      const a = chooseAutoAction(s, 'a');
      if (a) s = applyAction(s, a).state;
      s = applyAction(s, { type: 'tick' }).state;
    }
    expect(s.status).toBe('done');
    expect(s.paid).toBe(1);
    expect(s.lives).toBe(5);
    expect(result(s)).toMatchObject({ reason: 'tutorial', winnerId: 'a' });
  });
});

describe('star targets', () => {
  it('1 star is below 2 below 3 on every level, and match the catalogue', () => {
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      const [a, b, c] = starTargets(lv, 'normal', 1);
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(a);
      expect(c).toBeGreaterThan(b);
      expect(LEVELS[lv].stars).toEqual([a, b, c]);
    }
  });
});
