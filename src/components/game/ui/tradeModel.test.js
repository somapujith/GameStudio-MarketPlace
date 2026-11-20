// The pure side of the trade sheet: values, the balance split, set impact, the set badges, validation reasons (which
// must match the engine's) and the cash helpers.
import { describe, expect, it } from 'vitest';
import { MAX_TRADE_TILES, applyAction, createGame, getOptions } from '@shared/index.js';
import {
  CASH_CHIPS, CASH_STEP, NOT_YOUR_TURN, NO_PARTNER, balanceSplit, byCollection, cashAfter, clampCash, deedFacts, districtsOf, fairness,
  fullSets, hasImpact, impactRows, offerProblem, parseCash, partnerHints, setImpact, setsToComplete, sideBrief, sideParts, sideValue,
  tileHint, tileValue, SAME_DEAL, counterDiff, sameSide, sideChanged, tradeStatus, tradeLimit, limitHint, canPick,
} from './tradeModel.js';

const game = () => createGame({ players: [{ id: 'me', name: 'Asha' }, { id: 'b1', name: 'Ravi' }, { id: 'c2', name: 'Zoya' }], seed: 3 });
// Cyberabad = 28 Kondapur, 29 Madhapur, 31 HITEC City. Bazaar Beginnings = 1, 3, 4. Old City Icons = 6, 7, 8.

describe('values', () => {
  it('values a district at its price, minus the loan when mortgaged, plus half the upgrades paid', () => {
    const v = game();
    v.levels[31] = 2;
    v.mortgaged[1] = true;
    expect(tileValue(v, 31)).toBe(340000 + 136000);
    expect(tileValue(v, 1)).toBe(30000);
    expect(tileValue(v, 3)).toBe(70000);
    expect(tileValue(v, 0)).toBe(0); // not a district
    expect(sideValue(v, { cash: 10000, tiles: [31] })).toBe(10000 + 340000 + 136000);
  });

  it('splits a side into cash, districts and a count', () => {
    const v = game();
    expect(sideParts(v, { cash: 50000, tiles: [1, 3] })).toEqual({ cash: 50000, districts: 130000, total: 180000, count: 2 });
    expect(sideParts(v, null)).toEqual({ cash: 0, districts: 0, total: 0, count: 0 });
  });

  it('calls a deal generous, fair or greedy by what you give against what you get', () => {
    expect(fairness(0, 0).key).toBe('empty');
    expect(fairness(0, 10).key).toBe('greedy');
    expect(fairness(100, 50).key).toBe('generous');
    expect(fairness(100, 84).key).toBe('generous');
    expect(fairness(100, 85).key).toBe('fair');
    expect(fairness(100, 120).key).toBe('fair');
    expect(fairness(100, 121).key).toBe('greedy');
  });

  it('shares the balance bar between what you give and what you get, and is empty for an empty deal', () => {
    expect(balanceSplit(0, 0)).toMatchObject({ give: 0, get: 0, total: 0, diff: 0 });
    expect(balanceSplit(100, 100)).toMatchObject({ give: 0.5, get: 0.5, diff: 0 });
    const s = balanceSplit(300, 100);
    expect(s.give).toBeCloseTo(0.75);
    expect(s.get).toBeCloseTo(0.25);
    expect(s.give + s.get).toBeCloseTo(1);
    expect(s.diff).toBe(-200);
    expect(balanceSplit(-5, 10)).toMatchObject({ give: 0, get: 1 });
  });

  it('works out my cash after the deal', () => {
    expect(cashAfter(1000000, { cash: 200000 }, { cash: 50000 })).toBe(850000);
    expect(cashAfter(100, { cash: 300 }, {})).toBe(-200);
  });

  it('describes a district card: level, mortgage and the rent it collects now', () => {
    const v = game();
    v.levels[31] = 1;
    v.mortgaged[28] = true;
    expect(deedFacts(v, 31)).toMatchObject({ id: 31, level: 1, mortgaged: false, price: 340000, rent: 92000, value: 340000 + 68000 });
    expect(deedFacts(v, 28)).toMatchObject({ mortgaged: true, rent: 0, value: 150000 });
    expect(deedFacts(v, 29).rent).toBe(32000);
  });
});

describe('sets', () => {
  const setup = () => {
    const v = game();
    v.owners[28] = 'me'; v.owners[29] = 'me'; v.owners[31] = 'b1'; // I need HITEC City for Cyberabad
    v.owners[1] = 'me'; v.owners[3] = 'me'; v.owners[4] = 'me'; // I own all of Bazaar Beginnings
    v.owners[6] = 'me'; v.owners[7] = 'b1'; v.owners[8] = 'b1'; // Ravi needs Laad Bazaar for Old City Icons
    return v;
  };

  it('lists the collections a player owns whole', () => {
    const v = setup();
    expect(fullSets(v.owners, 'me')).toEqual(['bazaar']);
    expect(fullSets(v.owners, 'b1')).toEqual([]);
    expect(fullSets(v.owners, 'c2')).toEqual([]);
  });

  it('reads what a deal does to both sides collections', () => {
    const v = setup();
    expect(setImpact(v.owners, 'me', 'b1', [], [31])).toEqual({ mineCompleted: ['cyber'], theirCompleted: [], mineBroken: [], theirBroken: [] });
    expect(setImpact(v.owners, 'me', 'b1', [6], [])).toMatchObject({ theirCompleted: ['oldcity'], mineBroken: [] });
    expect(setImpact(v.owners, 'me', 'b1', [3], [])).toMatchObject({ mineBroken: ['bazaar'], theirCompleted: [] });
    expect(setImpact(v.owners, 'me', 'b1', [3], [31])).toMatchObject({ mineCompleted: ['cyber'], mineBroken: ['bazaar'] });
    // taking their district breaks a set they hold whole
    v.owners[33] = 'b1'; v.owners[34] = 'b1'; v.owners[35] = 'b1';
    expect(setImpact(v.owners, 'me', 'b1', [], [34])).toMatchObject({ theirBroken: ['newcity'] });
    expect(setImpact(v.owners, 'me', 'b1', [], [])).toEqual({ mineCompleted: [], theirCompleted: [], mineBroken: [], theirBroken: [] });
    expect(hasImpact(setImpact(v.owners, 'me', 'b1', [], []))).toBe(false);
    expect(hasImpact(setImpact(v.owners, 'me', 'b1', [], [31]))).toBe(true);
  });

  it('turns an impact into ordered summary rows', () => {
    const rows = impactRows({ mineCompleted: ['cyber'], theirCompleted: ['oldcity'], mineBroken: ['bazaar'], theirBroken: ['newcity'] });
    expect(rows.map((r) => `${r.who}:${r.kind}:${r.group}:${r.tone}`)).toEqual([
      'me:complete:cyber:good', 'them:complete:oldcity:warn', 'me:break:bazaar:warn', 'them:break:newcity:info',
    ]);
    expect(impactRows(null)).toEqual([]);
  });

  it('badges one district card by what picking it would do', () => {
    const v = setup();
    const ctx = { me: 'me', them: 'b1', give: [], get: [] };
    expect(tileHint(v.owners, ctx, 31, 'get')).toEqual({ kind: 'completes', group: 'cyber' });
    expect(tileHint(v.owners, ctx, 7, 'get')).toBeNull(); // would not finish anything of mine, and Ravi holds no full set
    expect(tileHint(v.owners, ctx, 6, 'give')).toEqual({ kind: 'theirs', group: 'oldcity' });
    expect(tileHint(v.owners, ctx, 3, 'give')).toEqual({ kind: 'breaks', group: 'bazaar' });
    expect(tileHint(v.owners, ctx, 28, 'give')).toBeNull();
    expect(tileHint(v.owners, ctx, 0, 'give')).toBeNull();
    v.owners[33] = 'b1'; v.owners[34] = 'b1'; v.owners[35] = 'b1';
    expect(tileHint(v.owners, ctx, 34, 'get')).toEqual({ kind: 'theirsBroken', group: 'newcity' });
    // giving a district can cancel a completion I am picking on the other side
    expect(tileHint(v.owners, { ...ctx, give: [29] }, 31, 'get')).toBeNull();
  });

  it('knows which collections one swap with a player could finish', () => {
    const v = setup();
    // I hold Kondapur + Madhapur (Ravi has HITEC City) and Laad Bazaar (Ravi has the other two): both finish with Ravi
    expect(setsToComplete(v.owners, 'me', 'b1')).toEqual(['oldcity', 'cyber']);
    expect(setsToComplete(v.owners, 'b1', 'me')).toEqual(['oldcity', 'cyber']); // the other way round: my Laad Bazaar, my two Cyberabad tiles
    expect(setsToComplete(v.owners, 'me', 'c2')).toEqual([]);
    expect(partnerHints(v.owners, 'me', 'b1')).toEqual({ completesMine: ['oldcity', 'cyber'], completesTheirs: ['oldcity', 'cyber'] });
    v.owners[29] = 'c2'; // two players hold Cyberabad's missing tiles: one swap cannot finish it
    expect(setsToComplete(v.owners, 'me', 'b1')).toEqual(['oldcity']);
  });

  it('lists the districts a player owns in board order and groups them by collection', () => {
    const v = setup();
    expect(districtsOf(v.owners, 'me')).toEqual([1, 3, 4, 6, 28, 29]);
    const groups = byCollection([31, 1, 28, 4]);
    expect(groups.map((g) => [g.coll.id, g.ids])).toEqual([['bazaar', [1, 4]], ['cyber', [28, 31]]]);
    expect(byCollection([])).toEqual([]);
  });
});

describe('validation (the same reasons as the engine)', () => {
  const me = { id: 'me', name: 'Asha', cash: 500000 };
  const rav = { id: 'b1', name: 'Ravi', cash: 200000 };
  const ok = { me, partner: rav, give: { cash: 1, tiles: [] }, get: { cash: 0, tiles: [] } };

  it('has a reason for each way an offer cannot go', () => {
    expect(offerProblem({ ...ok, partner: null })).toBe(NO_PARTNER);
    expect(offerProblem({ ...ok, canOffer: false })).toBe(NOT_YOUR_TURN);
    expect(offerProblem({ ...ok, give: { cash: 0, tiles: [] } })).toBe('The offer is empty');
    expect(offerProblem({ ...ok, give: { cash: 600000, tiles: [] } })).toBe('You do not have that much cash');
    expect(offerProblem({ ...ok, get: { cash: 300000, tiles: [] } })).toBe('Ravi does not have that much cash');
    expect(offerProblem(ok)).toBeNull();
    expect(offerProblem({ ...ok, give: { cash: 0, tiles: [1] } })).toBeNull();
    expect(offerProblem({ ...ok, give: { cash: 0, tiles: [] }, get: { cash: 0, tiles: [31] }, canOffer: true })).toBeNull();
  });

  it('the district limit: the same wording as the engine, either side, and the limit comes from the options', () => {
    const three = { cash: 0, tiles: [1, 3, 4] };
    const two = { cash: 0, tiles: [1, 3] };
    const s = game();
    [1, 3, 4].forEach((t) => { s.owners[t] = 'me'; });
    const engine = applyAction(s, { type: 'TRADE_OFFER', playerId: 'me', to: 'b1', give: three, get: { cash: 5, tiles: [] } }).error;
    expect(offerProblem({ ...ok, give: three })).toBe(engine);
    expect(offerProblem({ ...ok, get: three })).toBe('A trade can include at most 2 districts from each player.');
    expect(offerProblem({ ...ok, give: two, get: two })).toBeNull();
    expect(offerProblem({ ...ok, give: three, maxTiles: 3 })).toBeNull();
  });

  it('never blocks an unbalanced offer', () => {
    expect(offerProblem({ ...ok, give: { cash: 0, tiles: [] }, get: { cash: 100000, tiles: [] } })).toBeNull();
  });

  it('matches what the engine answers for the same offers', () => {
    const s = game();
    s.players[0].cash = 500000;
    s.players[1].cash = 200000;
    const engine = (give, get) => applyAction(s, { type: 'TRADE_OFFER', playerId: 'me', to: 'b1', give, get }).error ?? null;
    const mine = (give, get) => offerProblem({ me: s.players[0], partner: s.players[1], give, get });
    for (const [give, get] of [
      [{ cash: 0, tiles: [] }, { cash: 0, tiles: [] }],
      [{ cash: 600000, tiles: [] }, { cash: 0, tiles: [] }],
      [{ cash: 0, tiles: [] }, { cash: 300000, tiles: [] }],
      [{ cash: 100, tiles: [] }, { cash: 100, tiles: [] }],
    ]) {
      expect(mine(give, get), JSON.stringify([give, get])).toBe(engine(give, get));
    }
  });
});

describe('cash and wording helpers', () => {
  it('clamps cash into what the payer has, in whole rupees', () => {
    expect(clampCash(-5, 1000)).toBe(0);
    expect(clampCash(2500, 1000)).toBe(1000);
    expect(clampCash(120.6, 1000)).toBe(121);
    expect(clampCash(10, 0)).toBe(0);
    expect(clampCash('abc', 1000)).toBe(0);
  });

  it('reads typed cash with grouping, symbols and spaces', () => {
    expect(parseCash('1,50,000')).toBe(150000);
    expect(parseCash('₹ 90000')).toBe(90000);
    expect(parseCash('')).toBe(0);
    expect(parseCash(null)).toBe(0);
    expect(parseCash('abc')).toBe(0);
  });

  it('offers the quick chips the old stepper had, with a spoken form', () => {
    expect(CASH_STEP).toBe(10000);
    expect(CASH_CHIPS.map((c) => c.say)).toEqual(['minus 50,000', 'plus 50,000', 'plus 1,00,000']);
    expect(CASH_CHIPS.map((c) => c.delta)).toEqual([-50000, 50000, 100000]);
  });

  it('puts a side into a few words', () => {
    expect(sideBrief({ cash: 0, tiles: [] })).toBe('nothing');
    expect(sideBrief({ cash: 50000, tiles: [] })).toBe('₹50k');
    expect(sideBrief({ cash: 0, tiles: [1] })).toBe('1 district');
    expect(sideBrief({ cash: 150000, tiles: [1, 3] })).toBe('2 districts + ₹1.5L');
    expect(sideBrief(null)).toBe('nothing');
  });
});

describe('can I propose a trade right now (tradeStatus), and why not', () => {
  const sessionOf = (patch = {}, extra = {}) => {
    const v = game();
    Object.assign(v, patch);
    return { me: 'me', view: v, connection: 'open', options: { trade: { canOffer: true } }, busy: false, ...extra };
  };

  it('is true on my turn before the roll, after landing (buy phase) and after buying, even while the table animates', () => {
    expect(tradeStatus(sessionOf()).can).toBe(true);
    expect(tradeStatus(sessionOf({ phase: 'manage' })).can).toBe(true);
    expect(tradeStatus(sessionOf({ phase: 'buy', pending: { type: 'buy', tile: 3, price: 70000 } })).can).toBe(true);
    expect(tradeStatus(sessionOf({}, { busy: true })).can).toBe(true); // presenter playing: not a reason
  });

  it('names the exact reason otherwise', () => {
    expect(tradeStatus(sessionOf({ turn: 1 })).reason).toBe('You can propose a trade on your own turn');
    expect(tradeStatus(sessionOf({ phase: 'debt' })).reason).toBe('Settle the debt before trading');
    expect(tradeStatus(sessionOf({ phase: 'auction' })).reason).toMatch(/auction/);
    expect(tradeStatus(sessionOf({ phase: 'snatch' })).reason).toMatch(/Snatch/);
    expect(tradeStatus(sessionOf({ trade: { id: 1, from: 'me', to: 'b1' } })).reason).toMatch(/waiting/);
    expect(tradeStatus(sessionOf({}, { connection: 'connecting' })).reason).toMatch(/Reconnecting/);
    expect(tradeStatus(sessionOf({}, { options: { trade: { canOffer: false } } })).reason).toMatch(/One moment/);
    expect(tradeStatus({ me: 'me', view: null }).can).toBe(false);
  });
});

describe('counter-offers', () => {
  it('sameSide ignores the order of districts; an unchanged counter cannot be sent', () => {
    expect(sameSide({ cash: 5, tiles: [1, 3] }, { cash: 5, tiles: [3, 1] })).toBe(true);
    expect(sameSide({ cash: 5, tiles: [1] }, { cash: 6, tiles: [1] })).toBe(false);
    expect(sameSide({ cash: 0, tiles: [1] }, { tiles: [] })).toBe(false);
    const me = { id: 'me', name: 'Asha', cash: 500000 };
    const rav = { id: 'b1', name: 'Ravi', cash: 500000 };
    const original = { give: { cash: 0, tiles: [1] }, get: { cash: 10000, tiles: [] } };
    expect(offerProblem({ me, partner: rav, give: original.give, get: original.get, original })).toBe(SAME_DEAL);
    expect(offerProblem({ me, partner: rav, give: original.give, get: { cash: 20000, tiles: [] }, original })).toBeNull();
  });

  it('counterDiff maps the replaced deal to the proposer who now answers: added, removed, cash before and after', () => {
    // I (a) offered: give [1] + 0 cash, get [31]. Ravi (b1) countered: he gives [31, 28], asks [3] and 20k from me
    const trade = {
      id: 9, from: 'b1', to: 'a', give: { cash: 0, tiles: [31, 28] }, get: { cash: 20000, tiles: [3] },
      replaces: { id: 8, give: { cash: 0, tiles: [1] }, get: { cash: 0, tiles: [31] } },
    };
    const d = counterDiff(trade, 'a');
    expect(d.get).toEqual({ added: [28], removed: [], cashFrom: 0, cashTo: 0 });
    expect(d.give).toEqual({ added: [3], removed: [1], cashFrom: 0, cashTo: 20000 });
    expect(sideChanged(d.get)).toBe(true);
    expect(sideChanged({ added: [], removed: [], cashFrom: 5, cashTo: 5 })).toBe(false);
    expect(counterDiff(trade, 'b1')).toBeNull(); // only the one who answers sees it
    expect(counterDiff({ id: 1, from: 'b1', to: 'a' }, 'a')).toBeNull(); // not a counter
  });
});

describe('the district limit helpers', () => {
  it('tradeLimit reads options.trade.maxTiles and falls back to the engine constant', () => {
    const s = game();
    expect(tradeLimit(getOptions(s, 'me'))).toBe(MAX_TRADE_TILES);
    expect(tradeLimit({ trade: { maxTiles: 3 } })).toBe(3);
    expect(tradeLimit({ trade: { canOffer: true } })).toBe(MAX_TRADE_TILES);
    expect(tradeLimit(null)).toBe(MAX_TRADE_TILES);
    expect(tradeLimit({ trade: { maxTiles: 0 } })).toBe(MAX_TRADE_TILES);
  });

  it('canPick: below the limit anything goes; at the limit only the picked ones (to swap them out)', () => {
    expect(canPick([], 5, 2)).toBe(true);
    expect(canPick([1], 5, 2)).toBe(true);
    expect(canPick([1, 3], 5, 2)).toBe(false);
    expect(canPick([1, 3], 3, 2)).toBe(true);
    expect(limitHint(2)).toBe('Up to 2 districts per side');
  });
});
