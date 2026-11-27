// Tiffin Centre: who gets the credit for a shift. Co-op win credit (every seat that did real work wins a cleared shift, not only the top
// earner) and the `cooked` counter that makes a dedicated cook a contributor even if they never collect a rupee. Rule: docs/TIFFIN_CENTRE_PLAN.md section 3.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, result } from './index.js';
import { WIN_MIN_WORK, WORK_KEYS, winnersOf, workOf } from './scoring.js';

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
    const rows = [{ id: 'a', stats: { collected: 3 } }, { id: 'b', stats: { cooked: 4 } }, { id: 'c', stats: {} }, { id: 'd', stats: { tended: 3 } }];
    expect(winnersOf(rows, 2, 6)).toEqual(['a', 'b', 'd']);
    expect(winnersOf(rows, 0, 6)).toEqual([]); // a failed shift has no winners
    expect(winnersOf(rows, 3, 0)).toEqual([]); // nobody paid: nothing was earned
    expect(winnersOf([], 3, 3)).toEqual([]);
  });

  it('one bought ingredient is not a shift: a seat needs WIN_MIN_WORK units and a tenth of the team\'s work to share the win', () => {
    expect(WIN_MIN_WORK).toBe(3);
    // a second account that buys once and idles while the first plays the whole shift
    const farm = [{ id: 'a', stats: { served: 40, collected: 40, bought: 12 } }, { id: 'b', stats: { bought: 1 } }];
    expect(winnersOf(farm, 3, 40)).toEqual(['a']);
    // two units are still below the floor, three is a real (if small) contribution on a small team
    expect(winnersOf([{ id: 'a', stats: { served: 6 } }, { id: 'b', stats: { bought: 2 } }], 1, 6)).toEqual(['a']);
    expect(winnersOf([{ id: 'a', stats: { served: 6 } }, { id: 'b', stats: { bought: 3 } }], 1, 6)).toEqual(['a', 'b']);
    // a big team: the share rule (a tenth of 130 = 13) beats the floor
    const big = [{ id: 'a', stats: { served: 100 } }, { id: 'b', stats: { served: 20 } }, { id: 'c', stats: { bought: 10 } }];
    expect(winnersOf(big, 2, 50)).toEqual(['a', 'b']);
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

describe('a seat that leaves the running shift (the room\'s resignAction)', () => {
  /** p1 holds a dosa and a chai; a customer waits for the dosa, nobody wants the chai. */
  function holding() {
    let s = team(2, 0, 4);
    s = act(s, { type: 'spawn', customer: { kind: 'student', order: ['dosa'] } }).state;
    s = act(s, { type: 'tutorial-flags', patience: true, pay: true }).state;
    s = act(s, { type: 'cook', playerId: 'p1', station: 'tawa1', slot: 0, dish: 'dosa' }).state;
    s = act(s, { type: 'cook', playerId: 'p1', station: 'chai1', slot: 0, dish: 'irani_chai' }).state;
    s = tickN(s, 6);
    s = act(s, { type: 'take', playerId: 'p1', station: 'tawa1', slot: 0 }).state;
    s = act(s, { type: 'take', playerId: 'p1', station: 'chai1', slot: 0 }).state;
    expect(s.players.p1.hands.map((h) => h.dish)).toEqual(['dosa', 'irani_chai']);
    return s;
  }

  it('hands what they hold to a waiting customer who needs it and bins the rest, then is marked as gone', () => {
    const r = act(holding(), { type: 'leave', playerId: 'p1' });
    const s = r.state;
    expect(s.players.p1).toMatchObject({ hands: [], at: null, left: true, served: 1 });
    expect(s.customers[0].got).toEqual(['dosa']);
    expect(r.events.map((e) => e.type)).toEqual(['discard', 'serve', 'eating', 'player-left']);
    expect(r.events.at(-1)).toEqual({ type: 'player-left', by: 'p1' });
    // the shift goes on for the one who stays
    expect(applyAction(s, { type: 'tick' }).error).toBeUndefined();
    expect(s.status).toBe('playing');
  });

  it('is a no-op the second time, an error for a stranger, and never lets the same seat act as gone twice', () => {
    const s = act(holding(), { type: 'leave', playerId: 'p1' }).state;
    expect(applyAction(s, { type: 'leave', playerId: 'p1' }).state).toBe(s);
    expect(applyAction(s, { type: 'leave', playerId: 'nobody' }).error).toBeTruthy();
    expect(applyAction(s, { type: 'leave' }).error).toBeTruthy();
  });

  it('a seat that comes back and acts again is no longer marked as gone', () => {
    let s = act(holding(), { type: 'leave', playerId: 'p1' }).state;
    expect(s.players.p1.left).toBe(true);
    s = act(s, { type: 'move', playerId: 'p1', to: 'tawa1' }).state;
    expect(s.players.p1.left).toBeUndefined();
    expect(s.players.p1.at).toBe('tawa1');
  });
});
