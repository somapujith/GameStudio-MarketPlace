// BANKRUPTCY (docs/GAME_RULES.md 7.2): the BANK takes all the cash and every district of a bankrupt player (districts
// are free again, upgrades sold off, mortgages cleared). The creditor is paid ONLY the debt, by the bank, and never more
// than the estate (cash + liquidationValue) was worth. Debts to the bank pay nobody. Resigning is the same rule.
import { describe, expect, it } from 'vitest';
import {
  createGame, applyAction, rentFor, estateValue, bankruptcyPayouts, owedPayments, liquidationValue, mortgageValue, sellRefund, TILES,
  BOARD_SIZE, LUCK_CARDS, DRAMA_CARDS, chooseBotAction, nextBotMove, mulberry32, municipalDue,
} from './index.js';

const ALL = ['a', 'b', 'c', 'd', 'e', 'f'];
function game(settings = {}, n = 3, seed = 7) {
  return createGame({ players: ALL.slice(0, n).map((id) => ({ id, name: id.toUpperCase() })), settings: { debug: true, snatches: 0, ...settings }, seed });
}
const P = (s, id) => s.players.find((p) => p.id === id);
function act(s, action) {
  const r = applyAction(s, action);
  if (r.error) throw new Error(`${action.type}: ${r.error}`);
  return r;
}
const roll = (s, who, d) => act(s, { type: 'ROLL', playerId: who, dice: [d] });
function stackCard(s, deck, cardId) {
  const cards = deck === 'luck' ? LUCK_CARDS : DRAMA_CARDS;
  s.deck[deck] = [cards.findIndex((c) => c.id === cardId), ...s.deck[deck]];
  s.deckPos[deck] = 0;
}
const MORT = (t) => mortgageValue(TILES[t]);
const SELL = (t) => sellRefund(TILES[t]);
const START = 1500000;

const RENT = rentFor(TILES[35], 2); // Financial District at level 2 (1,76,000)
/** a stands on 33 and rolls 2 onto b's Financial District (level 2: rent RENT) */
function rentSetup(s, { cash = 10000 } = {}) {
  s.owners[35] = 'b'; s.levels[35] = 2;
  s.players[0].cash = cash;
  s.players[0].pos = 33;
  return s;
}

describe('estate and payout helpers', () => {
  it('estate = cash + bank mortgage value of every unmortgaged district + sell-back value of the upgrades', () => {
    const s = game();
    s.owners[1] = 'a'; s.levels[1] = 2; // 30,000 mortgage + 2 x 12,000 sell-back
    s.owners[3] = 'a'; s.mortgaged[3] = true; // already mortgaged: adds nothing
    s.owners[4] = 'b';
    P(s, 'a').cash = 5000;
    expect(liquidationValue(s, 'a')).toBe(MORT(1) + 2 * SELL(1));
    expect(estateValue(s, 'a')).toBe(5000 + MORT(1) + 2 * SELL(1));
    expect(estateValue(s, 'nobody')).toBe(0);
  });

  it('payouts walk the debts in order; each is paid in full while the estate lasts, the rest is forgiven', () => {
    const s = game({}, 4);
    P(s, 'a').cash = 25000; // estate 25,000
    const owed = [{ to: 'b', amount: 10000 }, { to: 'c', amount: 10000 }, { to: 'd', amount: 10000 }, { to: null, amount: 99999 }];
    expect(bankruptcyPayouts(s, 'a', owed)).toEqual([{ to: 'b', amount: 10000 }, { to: 'c', amount: 10000 }, { to: 'd', amount: 5000 }]);
    expect(bankruptcyPayouts(s, 'a', [{ to: 'b', amount: 4000 }, { to: 'b', amount: 4000 }])).toEqual([{ to: 'b', amount: 8000 }]); // one row per creditor
    expect(bankruptcyPayouts(s, 'a', [{ to: 'a', amount: 4000 }, { to: 'zz', amount: 4000 }])).toEqual([]);
    expect(bankruptcyPayouts(s, 'a')).toEqual([]); // no open debt: nobody is paid
  });

  it('owedPayments lists the open debt first, then the player\'s queued payments', () => {
    const s = game({}, 4);
    s.debt = { player: 'a', amount: 7000, creditor: 'b', reason: 'card', rest: [{ from: 'a', to: 'c', amount: 5000, reason: 'card' }, { from: 'd', to: 'b', amount: 1, reason: 'card' }] };
    expect(owedPayments(s, 'a')).toEqual([{ to: 'b', amount: 7000, reason: 'card' }, { to: 'c', amount: 5000, reason: 'card' }]);
    expect(owedPayments(s, 'd')).toEqual([{ to: 'b', amount: 1, reason: 'card' }]);
    expect(owedPayments(s, 'b')).toEqual([]);
  });
});

describe('going bankrupt to a player (the debt cannot be covered)', () => {
  it('assets smaller than the debt: the bank takes everything, the creditor gets the whole estate, no districts', () => {
    const s = rentSetup(game());
    s.owners[1] = 'a'; s.levels[1] = 1;
    const estate = 10000 + MORT(1) + SELL(1);
    expect(estateValue(s, 'a')).toBe(estate);
    const r = roll(s, 'a', 2);
    expect(P(r.state, 'a')).toMatchObject({ bankrupt: true, cash: 0 });
    expect(r.state.owners[1]).toBeNull(); // the district is free again, NOT given to b
    expect(r.state.levels[1]).toBe(0);
    expect(r.state.mortgaged[1]).toBe(false);
    expect(r.state.owners.filter((o) => o === 'b')).toHaveLength(1); // b still has only the Financial District
    expect(P(r.state, 'b').cash).toBe(START + estate);
    expect(P(r.state, 'c').cash).toBe(START);
    expect(r.events).toContainEqual({ type: 'level', tile: 1, level: 0, reason: 'bankrupt' });
    expect(r.events).toContainEqual({ type: 'own', tile: 1, owner: null, reason: 'bankrupt' });
    expect(r.events).toContainEqual({ type: 'cash', player: 'b', delta: estate, reason: 'bankrupt', other: 'a' });
    expect(r.events).toContainEqual({ type: 'bankrupt', player: 'a', paid: [{ to: 'b', amount: estate }] });
    expect(r.state.players[r.state.turn].id).toBe('b');
    // the freed district can be bought again
    expect(r.state.owners[1]).toBeNull();
  });

  it('a mortgaged district adds nothing to the estate and comes back unmortgaged; upgrades are sold off', () => {
    const s = rentSetup(game(), { cash: 0 });
    s.owners[1] = 'a'; s.mortgaged[1] = true;
    s.owners[3] = 'a'; s.levels[3] = 2;
    const estate = MORT(3) + 2 * SELL(3);
    expect(estateValue(s, 'a')).toBe(estate);
    const r = roll(s, 'a', 2);
    expect(r.state.owners[1]).toBeNull();
    expect(r.state.owners[3]).toBeNull();
    expect(r.state.mortgaged[1]).toBe(false);
    expect(r.state.levels[3]).toBe(0);
    expect(P(r.state, 'b').cash).toBe(START + estate);
  });

  it('no assets at all: the creditor gets nothing and no cash event is emitted', () => {
    const r = roll(rentSetup(game(), { cash: 0 }), 'a', 2);
    expect(P(r.state, 'a').bankrupt).toBe(true);
    expect(P(r.state, 'b').cash).toBe(START);
    expect(r.events.some((e) => e.type === 'cash' && e.reason === 'bankrupt')).toBe(false);
    expect(r.events).toContainEqual({ type: 'bankrupt', player: 'a' });
  });

  it('the creditor stats count what they were really paid', () => {
    const s = rentSetup(game());
    const r = roll(s, 'a', 2);
    expect(P(r.state, 'b').stats.rentEarned).toBe(10000);
    expect(P(r.state, 'a').stats.rentPaid).toBe(10000);
  });
});

describe('resigning while in debt (assets can be larger than the debt)', () => {
  /** a (cash 1,20,000) owes b RENT (1,76,000) and holds Sultan Bazaar + Monda Market + Begum Bazaar */
  function inDebt() {
    const s = rentSetup(game(), { cash: 120000 });
    s.owners[1] = 'a'; s.owners[3] = 'a'; s.owners[4] = 'a';
    const r = roll(s, 'a', 2);
    expect(r.state.phase).toBe('debt');
    return r.state;
  }

  it('the creditor gets EXACTLY the debt, the bank keeps the rest and every district', () => {
    const s = inDebt();
    const estate = estateValue(s, 'a');
    expect(estate).toBe(120000 + MORT(1) + MORT(3) + MORT(4));
    expect(estate).toBeGreaterThan(RENT);
    const before = s.players.reduce((n, p) => n + p.cash, 0);
    const r = act(s, { type: 'RESIGN', playerId: 'a' });
    expect(P(r.state, 'a')).toMatchObject({ bankrupt: true, resigned: true, cash: 0 });
    expect(P(r.state, 'b').cash).toBe(START + RENT);
    expect(r.state.owners.includes('a')).toBe(false);
    expect(r.state.owners[1]).toBeNull();
    expect(r.state.owners[3]).toBeNull();
    expect(r.state.owners[4]).toBeNull();
    expect(r.state.owners[35]).toBe('b');
    expect(r.events).toContainEqual({ type: 'cash', player: 'b', delta: RENT, reason: 'bankrupt', other: 'a' });
    expect(r.events).toContainEqual({ type: 'bankrupt', player: 'a', reason: 'resign', paid: [{ to: 'b', amount: RENT }] });
    expect(r.state.debt).toBeNull();
    expect(r.state.phase).not.toBe('debt');
    // the players' cash only changed by: a's 1,20,000 taken by the bank, b paid RENT by the bank
    expect(r.state.players.reduce((n, p) => n + p.cash, 0)).toBe(before - 120000 + RENT);
  });

  it('a creditor is never paid more than the assets were worth', () => {
    const s = inDebt();
    const gain = bankruptcyPayouts(s, 'a').reduce((n, x) => n + x.amount, 0);
    expect(gain).toBeLessThanOrEqual(estateValue(s, 'a'));
    expect(gain).toBe(RENT);
  });

  it('a resign worth less than the debt pays what it can (the shortfall is forgiven)', () => {
    const s = rentSetup(game(), { cash: 150000 });
    s.owners[1] = 'a'; // estate 1,50,000 + 30,000 = 1,80,000 > 1,76,000 -> debt phase
    let r = roll(s, 'a', 2);
    expect(r.state.phase).toBe('debt');
    r.state.players[0].cash = 100000; // ... then it shrinks (the debt only stays valid while it can be covered)
    r = act(r.state, { type: 'RESIGN', playerId: 'a' });
    expect(P(r.state, 'b').cash).toBe(START + 100000 + MORT(1));
  });
});

describe('several payments of the same cause (rest)', () => {
  /** a lands on a Drama tile and draws "Chai round" (pay 10,000 to every player) with 5 rivals: owes b, c, d, e, f in turn */
  function chaiRound(cash, tiles = []) {
    const s = game({}, 6);
    s.players[0].pos = 10;
    s.players[0].cash = cash;
    for (const t of tiles) s.owners[t] = 'a';
    stackCard(s, 'drama', 'chai_round');
    return roll(s, 'a', 2);
  }

  it('resigning in debt pays b, c, d in order and stops where the estate runs out (e gets the rest, f nothing)', () => {
    const r = chaiRound(5000, [1]); // estate 5,000 + 30,000 = 35,000 for 5 x 10,000
    expect(r.state.phase).toBe('debt');
    expect(r.state.debt).toMatchObject({ player: 'a', creditor: 'b', amount: 10000 });
    expect(r.state.debt.rest).toHaveLength(4);
    const x = act(r.state, { type: 'RESIGN', playerId: 'a' });
    const cash = (id) => P(x.state, id).cash - START;
    expect(['b', 'c', 'd', 'e', 'f'].map(cash)).toEqual([10000, 10000, 10000, 5000, 0]);
    expect(x.state.owners[1]).toBeNull();
    expect(x.state.debt).toBeNull();
    expect(x.state.phase).not.toBe('debt');
    expect(x.events.filter((e) => e.type === 'cash' && e.reason === 'bankrupt').map((e) => [e.player, e.delta])).toEqual([['b', 10000], ['c', 10000], ['d', 10000], ['e', 5000]]);
  });

  it('an automatic bankruptcy on the first payment still pays the creditors in order up to the estate', () => {
    const r = chaiRound(7000); // 7,000 and nothing else: cannot cover even the first 10,000
    expect(P(r.state, 'a').bankrupt).toBe(true);
    expect(P(r.state, 'b').cash).toBe(START + 7000);
    expect(P(r.state, 'c').cash).toBe(START);
    expect(r.state.phase).not.toBe('debt');
    // a's other queued payments are gone with a, nothing is replayed or paid twice
    expect(['c', 'd', 'e', 'f'].every((id) => P(r.state, id).cash === START)).toBe(true);
  });

  it('collect-from-all: a debtor resigning out of turn pays the card-owner from their estate and leaves the queue', () => {
    const s = game({}, 3);
    s.players[1].cash = 5000; s.owners[1] = 'b'; // b owes 10,000: debt
    s.players[2].cash = 5000; s.owners[3] = 'c'; // c owes 10,000 later in the queue
    stackCard(s, 'luck', 'birthday'); // a collects 10,000 from everyone
    const r = roll(s, 'a', 2);
    expect(r.state.phase).toBe('debt');
    expect(r.state.debt).toMatchObject({ player: 'b', creditor: 'a' });
    expect(r.state.debt.rest.map((p) => p.from)).toEqual(['c']);
    const x = act(r.state, { type: 'RESIGN', playerId: 'c' }); // not c's debt yet: c leaves anyway
    expect(P(x.state, 'a').cash).toBe(START + 10000); // paid by the bank out of c's estate
    expect(P(x.state, 'c')).toMatchObject({ bankrupt: true, cash: 0 });
    expect(x.state.owners[3]).toBeNull();
    expect(x.state.debt.rest).toEqual([]);
    expect(x.state.phase).toBe('debt'); // b's debt is untouched
    const y = act(x.state, { type: 'RESIGN', playerId: 'b' });
    expect(P(y.state, 'a').cash).toBe(START + 20000);
    expect(y.state.phase).toBe('over');
    expect(y.state.winner).toBe('a');
  });
});

describe('debts to the bank', () => {
  it('a tax the player cannot cover: the bank takes everything and nobody is paid', () => {
    const s = game();
    s.players[0].pos = 25;
    s.players[0].cash = 0;
    s.owners[1] = 'a';
    expect(municipalDue(s, 'a')).toBeGreaterThan(MORT(1));
    const total = s.players.reduce((n, p) => n + p.cash, 0);
    const r = roll(s, 'a', 2);
    expect(P(r.state, 'a')).toMatchObject({ bankrupt: true, cash: 0 });
    expect(r.state.owners[1]).toBeNull();
    expect(r.state.players.reduce((n, p) => n + p.cash, 0)).toBe(total);
    expect(r.events.some((e) => e.type === 'cash' && e.reason === 'bankrupt')).toBe(false);
    expect(r.events).toContainEqual({ type: 'bankrupt', player: 'a' });
  });

  it('resigning while owing the bank: nobody is paid', () => {
    const s = game();
    s.players[0].pos = 25;
    s.players[0].cash = 20000;
    s.owners[1] = 'a'; s.owners[3] = 'a';
    let r = roll(s, 'a', 2);
    expect(r.state.phase).toBe('debt');
    expect(r.state.debt.creditor).toBeNull();
    const total = r.state.players.reduce((n, p) => n + p.cash, 0) - 20000;
    r = act(r.state, { type: 'RESIGN', playerId: 'a' });
    expect(r.state.players.reduce((n, p) => n + p.cash, 0)).toBe(total);
    expect(r.state.owners[1]).toBeNull();
    expect(r.events.some((e) => e.type === 'cash')).toBe(false);
  });
});

describe('resigning', () => {
  it('without a debt: everything goes to the bank, nobody is paid', () => {
    const s = game();
    s.owners[1] = 'b'; s.levels[1] = 1; s.owners[35] = 'b'; s.mortgaged[35] = true;
    s.players[1].cash = 321000;
    const r = act(s, { type: 'RESIGN', playerId: 'b' });
    expect(P(r.state, 'b')).toMatchObject({ bankrupt: true, resigned: true, cash: 0 });
    expect(r.state.owners.includes('b')).toBe(false);
    expect(r.state.mortgaged[35]).toBe(false);
    expect(r.state.levels[1]).toBe(0);
    expect(P(r.state, 'a').cash).toBe(START);
    expect(P(r.state, 'c').cash).toBe(START);
    expect(r.events).toContainEqual({ type: 'bankrupt', player: 'b', reason: 'resign' });
    expect(r.events.filter((e) => e.type === 'cash')).toEqual([]);
    expect(r.events.filter((e) => e.type === 'own').every((e) => e.owner === null && e.reason === 'bankrupt')).toBe(true);
  });

  it('out of turn: the player on turn keeps the turn, the resigned seat is skipped later', () => {
    const s = game();
    s.owners[4] = 'c';
    const r = act(s, { type: 'RESIGN', playerId: 'c' });
    expect(r.state.players[r.state.turn].id).toBe('a');
    expect(r.state.owners[4]).toBeNull();
    let x = roll(r.state, 'a', 1);
    x = act(x.state, { type: 'SKIP_BUY', playerId: 'a' });
    expect(x.state.owners[1]).toBeNull();
  });

  it('a district a resigned player held can be bought, auctioned or snatched again', () => {
    const s = game();
    s.owners[1] = 'b';
    const r = act(s, { type: 'RESIGN', playerId: 'b' });
    const x = roll(r.state, 'a', 1); // a lands on Sultan Bazaar, free again
    expect(x.state.pending).toMatchObject({ type: 'buy', tile: 1 });
  });

  it('last player standing wins after a bankruptcy, the creditor is paid and the standings agree', () => {
    const s = rentSetup(game({}, 2), { cash: 50000 });
    const r = roll(s, 'a', 2);
    expect(r.state.phase).toBe('over');
    expect(r.state).toMatchObject({ winner: 'b', winReason: 'last_standing' });
    expect(P(r.state, 'b').cash).toBe(START + 50000);
    expect(r.state.owners.every((o) => o !== 'a')).toBe(true);
  });

  it('the creditor resigned first: an old debt to them is owed to the bank, nobody is paid', () => {
    const s = rentSetup(game(), { cash: 120000 });
    s.owners[1] = 'a'; s.owners[3] = 'a'; s.owners[4] = 'a';
    let r = roll(s, 'a', 2);
    expect(r.state.debt.creditor).toBe('b');
    r = act(r.state, { type: 'RESIGN', playerId: 'b' });
    expect(r.state.phase).toBe('debt');
    const total = r.state.players.reduce((n, p) => n + p.cash, 0);
    r = act(r.state, { type: 'RESIGN', playerId: 'a' });
    expect(r.state.players.reduce((n, p) => n + p.cash, 0)).toBe(total - 120000); // a's cash went to the bank, nobody was paid
    expect(r.state.owners.every((o) => o === null)).toBe(true);
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe('c');
  });

  it('standings still rank the eliminated by when they went out, last out first', () => {
    const s = game({}, 4);
    s.owners[1] = 'b'; s.owners[3] = 'c';
    let r = act(s, { type: 'RESIGN', playerId: 'b' });
    r = act(r.state, { type: 'RESIGN', playerId: 'c' });
    expect(r.state.players.find((p) => p.id === 'b').outOrder).toBe(1);
    expect(r.state.players.find((p) => p.id === 'c').outOrder).toBe(2);
  });
});

describe('interplay with auctions and trades', () => {
  it('a bankruptcy mid-auction: the bankrupt bidder passes and their districts are plain free tiles', () => {
    const s = game({ snatches: 1 });
    s.owners[3] = 'b';
    let r = roll(s, 'a', 1); // a lands on the free Sultan Bazaar and buys it; b and c both press Snatch: sealed bidding opens
    r = act(r.state, { type: 'BUY', playerId: 'a' });
    r = act(r.state, { type: 'SNATCH', playerId: 'b' });
    r = act(r.state, { type: 'SNATCH', playerId: 'c' }); // the last press closes the window at once
    expect(r.state.phase).toBe('auction');
    r = act(r.state, { type: 'RESIGN', playerId: 'b' });
    expect(r.state.pending.bids.b).toBe(0);
    expect(r.state.owners.includes('b')).toBe(false);
    expect(r.state.owners[3]).toBeNull();
  });

  it('an open trade of the bankrupt player is cancelled', () => {
    const s = game();
    s.owners[1] = 'a'; s.owners[3] = 'b';
    let r = act(s, { type: 'TRADE_OFFER', playerId: 'a', to: 'b', give: { cash: 0, tiles: [1] }, get: { cash: 0, tiles: [3] } });
    r = act(r.state, { type: 'RESIGN', playerId: 'a' });
    expect(r.events.some((e) => e.type === 'trade_rejected' && e.reason === 'bankrupt')).toBe(true);
    expect(r.state.trade).toBeNull();
  });
});

describe('random games: the bank absorbs the assets and never creates money out of thin air', () => {
  it('after every action: bankrupt players hold nothing; creditors are paid only what the events say, never more than the debt allows', () => {
    let bankruptcies = 0;
    let paidTotal = 0;
    for (let g = 0; g < 24; g++) {
      const n = 2 + (g % 5);
      const seed = 9100 + g * 13;
      const rnd = mulberry32(seed);
      let s = createGame({
        players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })),
        settings: { mode: 'quick', startCash: 500000, rentPercent: 200, passStart: 0, snatches: 0, targetWorth: null }, seed,
      });
      for (let step = 0; step < 4000 && s.phase !== 'over'; step++) {
        let a;
        if (s.phase === 'snatch') a = { type: 'SNATCH_CLOSE' };
        else a = nextBotMove(s, rnd);
        if (!a) break;
        // now and then a player simply leaves (also with a debt): the same rule applies
        const live = s.players.filter((p) => !p.bankrupt);
        if (rnd() < 0.004 && live.length > 2) a = { type: 'RESIGN', playerId: live[Math.floor(rnd() * live.length)].id };
        else if (s.phase === 'debt' && live.length > 2 && rnd() < 0.2) a = { type: 'RESIGN', playerId: s.debt.player }; // "Bankrupt" pressed in the debt sheet
        const before = s;
        const r = applyAction(s, a);
        if (r.error) throw new Error(`g${g} step ${step} ${JSON.stringify(a)} -> ${r.error}`);
        s = r.state;
        const out = r.events.filter((e) => e.type === 'bankrupt');
        for (const b of out) {
          bankruptcies++;
          const p = P(s, b.player);
          expect(p.cash).toBe(0);
          expect(s.owners.includes(b.player)).toBe(false); // no district left owned by a bankrupt player
          for (let t = 0; t < BOARD_SIZE; t++) if (s.owners[t] === null) expect(s.levels[t] === 0 && !s.mortgaged[t]).toBe(true);
          const events = (b.paid || []);
          const cashEv = r.events.filter((e) => e.type === 'cash' && e.reason === 'bankrupt' && e.other === b.player);
          expect(cashEv.map((e) => [e.player, e.delta])).toEqual(events.map((x) => [x.to, x.amount]));
          const paid = events.reduce((m, x) => m + x.amount, 0);
          paidTotal += paid;
          for (const x of events) expect(x.to).not.toBe(b.player);
          if (a.type === 'RESIGN') {
            // nothing is gained or lost in between: the payout is capped by the estate right before the resignation
            expect(paid).toBeLessThanOrEqual(estateValue(before, b.player));
            const owed = owedPayments(before, b.player).filter((o) => o.to).reduce((m, o) => m + o.amount, 0);
            expect(paid).toBeLessThanOrEqual(owed);
          }
        }
        for (const p of s.players) {
          expect(Number.isInteger(p.cash) && p.cash >= 0).toBe(true);
          if (p.bankrupt) expect(s.owners.includes(p.id)).toBe(false);
        }
      }
    }
    expect(bankruptcies).toBeGreaterThan(5);
    expect(paidTotal).toBeGreaterThan(0);
  }, 60000);

  it('chooseBotAction never leaves a debt hanging (bots resign only when they cannot cover it)', () => {
    const s = rentSetup(game(), { cash: 120000 });
    s.owners[1] = 'a'; s.owners[3] = 'a'; s.owners[4] = 'a';
    const r = roll(s, 'a', 2);
    const a = chooseBotAction(r.state, 'a', mulberry32(1));
    expect(['MORTGAGE', 'SELL_BUILDING', 'PAY_DEBT']).toContain(a.type);
  });
});
