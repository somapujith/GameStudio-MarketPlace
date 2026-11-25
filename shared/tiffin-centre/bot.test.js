// Tiffin Centre balance: a greedy bot plays every level and the star targets must make sense for it.
// A bot acts once per tick like a fast human, and WALKS: each action costs walk time + the work animation, in whole ticks.
// It also runs the operations layer (prep, tend, gas, the board); a bot may never make an illegal move (play() throws on a refusal).
// Stars come from PROFIT (cash in hand - what the stall spent), so the bots' ingredient and gas bills count.
import { describe, it, expect, vi } from 'vitest';
import {
  createGame, applyAction, chooseAutoAction, actionCost, isOver, result, starTargets, MAX_LEVEL, LEVELS, HANDS_MAX, PREP_STATION, levelOps,
} from './index.js';

/** Play a whole shift. `bot: false` = nobody does anything. Returns the final state (`.evs` = every event of the shift, for the reports). */
function play(level, pace, n, seed, { bot = true, slow = 1 } = {}) {
  const evs = [];
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
        evs.push(...r.events);
        if (cost.to) s = applyAction(s, { type: 'move', playerId: p.id, to: cost.to }).state;
        freeAt[p.id] = s.tick + Math.ceil(cost.ticks * slow);
      }
    }
    const tick = applyAction(s, { type: 'tick' });
    if (tick.error) break; // a collect on the last customer may already have ended the shift
    s = tick.state;
    evs.push(...tick.events);
  }
  s.evs = evs;
  return s;
}
const count = (s, type, pred = () => true) => s.evs.filter((e) => e.type === type && pred(e)).length;

vi.setConfig({ testTimeout: 240000 }); // whole shifts are simulated here

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
    // the operations layer: the back counter and the cylinder are places to walk to
    expect(actionCost(s, 'a', { type: 'prep', station: PREP_STATION, slot: 0, item: 'oil' }).to).toBe(PREP_STATION);
    expect(actionCost(s, 'a', { type: 'swapGas' })).toMatchObject({ to: 'gas' });
    expect(actionCost(s, 'a', { type: 'tend', station: 'tawa2' }).to).toBe('tawa2');
    expect(actionCost(s, 'a', { type: 'board', dish: 'dosa', on: false })).toEqual({ to: null, ticks: 1 });
  });

  it('the bot restocks an ingredient somebody is waiting for, and changes an empty cylinder', () => {
    let s = createGame({ players: [{ id: 'a' }], settings: { level: 3 }, seed: 1 });
    s = { ...s, stock: { ...s.stock, batter_dosa: 0 } };
    s = { ...s, customers: [], schedule: [{ at: 1, kind: 'student', name: 'Kiran', look: 'bag', order: ['dosa'], patienceMax: 60 }], nextArrival: 1 };
    s = applyAction(s, { type: 'tick' }).state; // the customer is told "no dosa" and orders something else, so seat one by hand
    s = { ...s, customers: [{ id: 99, name: 'Kiran', kind: 'student', look: 'bag', spot: 0, st: 'waiting', order: ['dosa'], got: [], arrivedAt: 0, patience: 40, patienceMax: 60, eatLeft: 0, payLeft: 0, total: 40, tip: 0, outcome: null, qs: [], leftAt: null }] };
    expect(chooseAutoAction(s, 'a')).toEqual({ type: 'prep', playerId: 'a', station: PREP_STATION, slot: 0, item: 'batter_dosa' });
    const g = { ...s, customers: [], gas: { u: 0, sw: 0 } };
    expect(chooseAutoAction(g, 'a')).toEqual({ type: 'swapGas', playerId: 'a' });
  });

  it('level 0 is unchanged: no prep, no tending, no gas, however long the bot plays', () => {
    let s = createGame({ players: [{ id: 'a' }], settings: { level: 0 }, seed: 1 });
    s = applyAction(s, { type: 'tutorial-flags', patience: true, pay: true }).state;
    s = applyAction(s, { type: 'spawn', customer: { order: ['dosa', 'irani_chai'] } }).state;
    const kinds = new Set();
    for (let i = 0; i < 400 && !isOver(s); i++) {
      const a = chooseAutoAction(s, 'a');
      if (a) { kinds.add(a.type); s = applyAction(s, a).state; }
      s = applyAction(s, { type: 'tick' }).state;
    }
    for (const k of kinds) expect(['cook', 'take', 'serve', 'collect', 'discard']).toContain(k);
  });
});

describe('balance: a single bot (one action per tick, walking)', () => {
  it.each(levels(1, 8))('clears level %i with at least one star on every seed', (level) => {
    for (const seed of SEEDS) {
      const s = play(level, 'normal', 1, seed);
      expect(s.status, `level ${level} seed ${seed}`).toBe('done');
      expect(s.stars, `level ${level} seed ${seed}: profit ${s.profit} (money ${s.money}, cost ${Math.round(s.cost)})`).toBeGreaterThanOrEqual(1);
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

  it('stock runs out from level 3 on (a real pressure), but never twice as often as it is restocked, and levels 1-2 are generous', () => {
    for (const level of [1, 2]) for (const seed of [1, 2, 3]) expect(count(play(level, 'normal', 1, seed), 'stock-out'), `level ${level}`).toBeLessThanOrEqual(1);
    let outs = 0;
    for (const level of [3, 4, 5, 6, 7, 8]) {
      for (const seed of [1, 2, 3, 4]) {
        const s = play(level, 'normal', 1, seed);
        outs += count(s, 'stock-out') + count(s, 'sold-out');
      }
    }
    expect(outs).toBeGreaterThan(20);
  });

  it('the solo bot looks after the stall: it preps, tends the pans and changes the cylinder when the level asks for it', () => {
    let preps = 0;
    let tends = 0;
    let swaps = 0;
    for (const seed of [1, 2, 3, 4]) {
      for (const level of [5, 6, 8]) {
        const s = play(level, 'normal', 1, seed);
        preps += count(s, 'prep-start');
        tends += count(s, 'tend');
        swaps += count(s, 'gas-swap', (e) => e.phase === 'start');
        expect(count(s, 'prep-collect')).toBeGreaterThanOrEqual(count(s, 'prep-start') - 1); // what it started it fetched
      }
    }
    expect(preps).toBeGreaterThan(6);
    expect(tends).toBeGreaterThan(20);
    expect(swaps).toBeGreaterThan(0);
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

  it('three stars are reachable by 2-4 bots on the later levels too', () => {
    let reached = 0;
    for (const level of [5, 6, 9, 10, 12]) {
      for (const n of [2, 4]) {
        for (const seed of [1, 2, 3, 4, 5, 6]) if (play(level, 'normal', n, seed).stars === 3) reached += 1;
      }
    }
    expect(reached).toBeGreaterThanOrEqual(5);
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

  it('the festival needs restocking in the middle of the day: the shelf alone does not last a team to closing time', () => {
    for (const seed of [1, 2]) {
      const s = play(12, 'normal', 4, seed);
      expect(count(s, 'prep-start')).toBeGreaterThanOrEqual(5);
      expect(count(s, 'gas-swap', (e) => e.phase === 'start')).toBeGreaterThanOrEqual(1);
    }
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
      expect(s.profit).toBeLessThanOrEqual(0);
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
    expect(s.cost).toBe(0);
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

  it('prints the balance table (profit per player, stars) for 1, 2 and 4 bots', () => {
    const rows = [];
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      const row = { level: lv, targets: LEVELS[lv].stars.join('/'), ops: `${levelOps(lv).events.join('+') || '-'}` };
      for (const n of [1, 2, 4]) {
        const sims = [1, 2, 3, 4].map((seed) => play(lv, 'normal', n, seed));
        row[`${n}p stars`] = sims.map((s) => s.stars).join('');
        row[`${n}p profit`] = Math.round(sims.reduce((a, s) => a + s.profit, 0) / sims.length);
      }
      rows.push(row);
    }
    // eslint-disable-next-line no-console
    console.table(rows);
    expect(rows).toHaveLength(MAX_LEVEL);
  });
});
