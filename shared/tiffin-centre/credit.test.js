// Tiffin Centre: who gets the credit for a shift. Co-op win credit (every seat that did real work wins a cleared shift, not only the top
// earner) and the `cooked` counter that makes a dedicated cook a contributor even if they never collect a rupee. Rule: docs/TIFFIN_CENTRE_PLAN.md section 3.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, result } from './index.js';
import { WORK_KEYS, winnersOf, workOf } from './scoring.js';

const team = (n = 3, level = 1, seed = 5) => createGame({ players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })), settings: { level }, seed });
const act = (s, a) => {
  const r = applyAction(s, a);
  if (r.error) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
  return r;
};
const tickN = (s, n) => {
  for (let i = 0; i < n; i++) s = applyAction(s, { type: 'tick' }).state;
  return s;
};

describe('workOf / winnersOf (pure)', () => {
  it('counts only real work; moving, emoting and money earned are not work', () => {
    expect(WORK_KEYS).toEqual(['served', 'collected', 'cooked', 'prepped', 'tended', 'gasSwaps', 'bought']);
    expect(workOf({})).toBe(0);
    expect(workOf(null)).toBe(0);
    expect(workOf({ earned: 500, tips: 50 })).toBe(0);
    expect(workOf({ served: 1 })).toBe(1);
    expect(workOf({ cooked: 2, prepped: 1, tended: 1, gasSwaps: 1, bought: 1, collected: 1, served: 1 })).toBe(8);
    expect(workOf({ served: -4, collected: NaN, cooked: Infinity })).toBe(0); // junk never counts
  });

  it('a cleared shift is won by every seat that worked, never by one that stood by, and only when a customer paid', () => {
    const rows = [{ id: 'a', stats: { collected: 3 } }, { id: 'b', stats: { cooked: 4 } }, { id: 'c', stats: {} }, { id: 'd', stats: { tended: 1 } }];
    expect(winnersOf(rows, 2, 6)).toEqual(['a', 'b', 'd']);
    expect(winnersOf(rows, 0, 6)).toEqual([]); // a failed shift has no winners
    expect(winnersOf(rows, 3, 0)).toEqual([]); // nobody paid: nothing was earned
    expect(winnersOf([], 3, 3)).toEqual([]);
  });
});

describe('the cooked counter', () => {
  it('credits the COOK when somebody takes the dish, not the one who took it, and never a burnt dish', () => {
    let s = team(2, 0); // the training shift: no stock to worry about
    s = act(s, { type: 'cook', playerId: 'p1', station: 'tawa1', slot: 0, dish: 'dosa' }).state;
    expect(s.players.p1.cooked).toBeUndefined(); // nothing yet: the dish has not reached anybody's hands
    s = tickN(s, 5);
    s = act(s, { type: 'take', playerId: 'p2', station: 'tawa1', slot: 0 }).state;
    expect(s.players.p1.cooked).toBe(1);
    expect(s.players.p2.cooked).toBeUndefined();
    // a dish that burns and is only cleared is waste, not work
    s = act(s, { type: 'cook', playerId: 'p2', station: 'tawa1', slot: 1, dish: 'dosa' }).state;
    s = tickN(s, 5 + 7);
    expect(s.stations.tawa1.slots[1].st).toBe('burnt');
    s = act(s, { type: 'take', playerId: 'p1', station: 'tawa1', slot: 1 }).state;
    expect(s.players.p2.cooked).toBeUndefined();
    expect(result(s).standings.find((r) => r.id === 'p1').stats.cooked).toBe(1);
    expect(result(s).standings.find((r) => r.id === 'p2').stats.cooked).toBe(0);
  });
});

describe('co-op win credit in the engine result', () => {
  /** A cleared team shift: p1 cooks only, p2 serves and collects, p3 stands by. Hand-built so the numbers are exact. */
  function cleared() {
    let s = team(3, 1, 9);
    s = { ...s, status: 'done', stars: 2, paid: 6, money: 900, revenue: 800, tips: 100 };
    s.players = {
      p1: { ...s.players.p1, cooked: 7 },
      p2: { ...s.players.p2, served: 5, collected: 4, earned: 900 },
      p3: { ...s.players.p3 },
    };
    return s;
  }

  it('lists every contributing seat in `winners`, in the order of the standings; the top earner stays `winnerId`', () => {
    const res = result(cleared());
    expect(res.reason).toBe('cleared');
    expect(res.winnerId).toBe('p2');
    expect(res.winners).toEqual(['p2', 'p1']);
    expect(res.standings.every((r) => r.rank === 1)).toBe(true);
  });

  it('a failed shift has no winners, and neither has a shift where nobody paid', () => {
    expect(result({ ...cleared(), status: 'closed', stars: 0 }).winners).toEqual([]);
    expect(result({ ...cleared(), paid: 0 }).winners).toEqual([]);
  });

  it('a solo cleared shift is a win for the one player, and the tutorial is always a win for its player', () => {
    let solo = team(1, 1, 3);
    solo = { ...solo, status: 'done', stars: 1, paid: 3, money: 400, players: { p1: { ...solo.players.p1, served: 3, collected: 3, earned: 400 } } };
    expect(result(solo).winners).toEqual(['p1']);
    let tut = team(1, 0, 3);
    tut = { ...tut, status: 'done', stars: 3 };
    expect(result(tut)).toMatchObject({ reason: 'tutorial', winnerId: 'p1', winners: ['p1'] });
  });
});
