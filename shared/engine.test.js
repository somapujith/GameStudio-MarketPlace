// Hyderabad Hustle rules (docs/HUSTLE_PLAN.md 3). Debug dice (`cfg.debug` + `ROLL {dice:[n]}`) make every move exact.
import { describe, it, expect } from 'vitest';
import { GROUP_TILES } from './board.js';
import {
  createGame, applyAction, getOptions, netWorth, standings, previewRent, municipalDue, canUpgrade, normalizeSettings,
  liquidationValue, chooseBotAction, DEFAULT_SETTINGS, MODES, ROUND_CAP, TARGET_OPTIONS, TILES, PASS_START, TRAFFIC_FINE, PIECES,
  nextBotMove, mulberry32, resolveTarget, targetLabel, modeSummary,
  LUCK_CARDS, DRAMA_CARDS, CITY_EVENTS, EVENT_EVERY, BOARD_SIZE, upgradeCost, mortgageValue, unmortgageCost, rentFor,
} from './index.js';

const ids = ['a', 'b', 'c'];
function game(settings = {}, { n = 3, seed = 7 } = {}) {
  const s = createGame({ players: ids.slice(0, n).concat(n > 3 ? ['d', 'e', 'f'].slice(0, n - 3) : []).map((id) => ({ id, name: id.toUpperCase() })), settings: { debug: true, snatches: 0, ...settings }, seed }); // Snatch is off here: shared/snatch.test.js covers it
  return s;
}
const P = (s, id) => s.players.find((p) => p.id === id);
const totalCash = (s) => s.players.reduce((n, p) => n + p.cash, 0);
function act(s, action) {
  const r = applyAction(s, action);
  if (r.error) throw new Error(`${action.type}: ${r.error}`);
  return r;
}
const roll = (s, who, d) => act(s, { type: 'ROLL', playerId: who, dice: [d] });
const types = (ev) => ev.map((e) => e.type);
/** Put the next card of `deck` on top: the engine draws deck[deckPos]. */
function stackCard(s, deck, cardId) {
  const cards = deck === 'luck' ? LUCK_CARDS : DRAMA_CARDS;
  s.deck[deck] = [cards.findIndex((c) => c.id === cardId), ...s.deck[deck]];
  s.deckPos[deck] = 0;
}

describe('createGame and settings', () => {
  it('standard mode: 15 lakh each, 20 rounds, lucky dice, no pass auction', () => {
    const s = createGame({ players: [{ id: 'a' }, { id: 'b' }], seed: 1 });
    expect(s.cfg).toEqual({
      mode: 'standard', startCash: 1500000, passStart: 200000, maxRounds: 20, targetWorth: 5000000, dice: 'lucky',
      trafficFine: 25000, chaiCap: 1, rentPercent: 100, requireFullSet: true, eventEvery: 3, turnSeconds: 60, tradeSeconds: 45,
      auctionSeconds: 20, snatches: 1, snatchMs: 5000, snatchCardCap: 2,
    });
    expect(s.owners).toHaveLength(36);
    expect(s.levels).toHaveLength(36);
    expect(s.players[0]).toMatchObject({ cash: 1500000, pos: 0, stuck: false, chai: 0, laps: 0, bankrupt: false, piece: 'pearl' });
    expect(Object.keys(s.players[0].stats).sort()).toEqual(['biggestRent', 'chaiSaved', 'propertiesBought', 'rentEarned', 'rentPaid', 'rides', 'taxPaid', 'upgrades']);
    expect(s.players[0]).not.toHaveProperty('jailTurns');
    expect(s).not.toHaveProperty('traps');
    expect(s.ride).toBeNull();
    expect(DEFAULT_SETTINGS).toEqual(s.cfg);
  });

  it('modes: quick = 12 rounds and 20 lakh, classic = no round limit', () => {
    expect(MODES.standard).toMatchObject({ label: 'Standard City Hustle', rounds: 20, startCash: 1500000 });
    expect(normalizeSettings({ mode: 'quick' })).toMatchObject({ mode: 'quick', maxRounds: 12, startCash: 2000000 });
    expect(normalizeSettings({ mode: 'classic' })).toMatchObject({ mode: 'classic', maxRounds: null, startCash: 1500000 });
    expect(normalizeSettings({ mode: 'turbo', dice: 'loaded', auctionOnDecline: 'yes', goal: 5 })).toEqual(normalizeSettings({}));
    // the retired `auctionOnDecline` host rule (a pass auction) is dropped, whatever its value
    for (const v of [true, false, 'yes', null]) expect(normalizeSettings({ auctionOnDecline: v })).toEqual(normalizeSettings({}));
    expect(normalizeSettings({ auctionOnDecline: true })).not.toHaveProperty('auctionOnDecline');
    expect(normalizeSettings({ startCash: 500000, maxRounds: null })).toMatchObject({ startCash: 500000, maxRounds: null });
  });

  it('pieces: a requested free piece is kept, everyone else gets the first free one', () => {
    const s = createGame({ players: [{ id: 'a' }, { id: 'b', piece: 'pearl' }, { id: 'c', piece: 'pearl' }, { id: 'd', piece: 'nope' }], seed: 1 });
    expect(s.players.map((p) => p.piece)).toEqual(['auto', 'pearl', 'handi', 'chai']);
    expect(PIECES.map((p) => p.id)).toContain('camera');
  });

  it('rejects bad player lists', () => {
    expect(() => createGame({ players: [{ id: 'a' }] })).toThrow();
    expect(() => createGame({ players: [{ id: 'a' }, { id: 'a' }] })).toThrow();
  });

  it('is deterministic: same seed and actions give the same events', () => {
    const run = () => {
      let s = createGame({ players: [{ id: 'a' }, { id: 'b' }], seed: 123 });
      const out = [];
      for (let i = 0; i < 60 && s.phase !== 'over'; i++) {
        const who = s.phase === 'auction' ? s.players.find((p) => !(p.id in s.pending.bids)).id : s.players[s.turn].id;
        const a = chooseBotAction(s, s.phase === 'debt' ? s.debt.player : who, () => 0.5);
        const r = applyAction(s, a);
        out.push(...r.events);
        s = r.state;
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('moving, START and buying', () => {
  it('roll moves clockwise; an unowned affordable district offers a buy', () => {
    const s = game();
    const r = roll(s, 'a', 1);
    expect(types(r.events)).toEqual(['dice', 'move', 'land']);
    expect(r.state.phase).toBe('buy');
    expect(r.state.pending).toEqual({ type: 'buy', tile: 1, price: 60000 });
    expect(getOptions(r.state, 'a')).toMatchObject({ buy: true, skipBuy: true, roll: false });
    const b = act(r.state, { type: 'BUY', playerId: 'a' });
    expect(b.state.owners[1]).toBe('a');
    expect(P(b.state, 'a').cash).toBe(1440000);
    expect(b.state.levels[1]).toBe(0);
    expect(b.state.phase).toBe('manage');
    expect(getOptions(b.state, 'a').endTurn).toBe(true);
  });

  it('passing or landing on START pays 2 lakh once per move', () => {
    const s = game();
    s.players[0].pos = 33;
    const r = roll(s, 'a', 3); // 33 -> 36 = START
    const move = r.events.find((e) => e.type === 'move');
    expect(move).toMatchObject({ from: 33, to: 0, passedStart: true });
    expect(r.events.filter((e) => e.type === 'cash' && e.reason === 'salary')).toEqual([{ type: 'cash', player: 'a', delta: PASS_START, reason: 'salary' }]);
    expect(P(r.state, 'a').laps).toBe(1);
  });

  it('a six rolls again; END_TURN is refused until then', () => {
    let r = roll(game(), 'a', 6); // tile 6 Laad Bazaar
    r = act(r.state, { type: 'SKIP_BUY', playerId: 'a' }); // pass: the district stays free, no auction
    expect(r.state.phase).toBe('manage');
    expect(r.state.extraRoll).toBe(true);
    expect(applyAction(r.state, { type: 'END_TURN', playerId: 'a' }).error).toMatch(/six/);
    const again = roll(r.state, 'a', 2);
    expect(again.state.players[0].pos).toBe(8);
  });

  it('passing never starts an auction: the district stays free and a `skip` event says so; unaffordable is not offered at all', () => {
    let r = roll(game(), 'a', 4);
    r = act(r.state, { type: 'SKIP_BUY', playerId: 'a' });
    expect(r.events).toEqual([{ type: 'skip', player: 'a', tile: 4 }]);
    expect(r.state.phase).toBe('manage');
    expect(r.state.pending).toBeNull();
    expect(r.state.owners[4]).toBeNull();
    expect(r.state.auctionSeq || 0).toBe(0);

    const poor = game();
    poor.players[0].cash = 50000;
    const u = roll(poor, 'a', 1); // Sultan Bazaar costs 60,000
    expect(u.state.phase).toBe('manage'); // nothing offered, nothing auctioned
    expect(u.state.pending).toBeNull();
    expect(u.state.owners[1]).toBeNull();
    expect(u.events.map((e) => e.type)).not.toContain('auction_start');
  });
});

describe('rent, levels and the set bonus', () => {
  it('rent = rentTable[level]; the 1.5x set bonus only applies at level 0', () => {
    const s = game();
    s.owners[28] = 'b'; s.owners[29] = 'b'; s.owners[31] = 'b';
    expect(previewRent(s, 31)).toBe(51000); // full set, level 0
    s.levels[31] = 1;
    expect(previewRent(s, 31)).toBe(92000);
    s.levels[31] = 2;
    expect(previewRent(s, 31)).toBe(150000);
    s.owners[28] = 'c';
    s.levels[31] = 0;
    expect(previewRent(s, 31)).toBe(34000);
    s.mortgaged[31] = true;
    expect(previewRent(s, 31)).toBe(0);
  });

  it('landing on an opponent district pays its owner', () => {
    const s = game();
    s.owners[3] = 'b';
    const before = totalCash(s);
    const r = roll(s, 'a', 3);
    expect(r.events.filter((e) => e.type === 'cash')).toEqual([
      { type: 'cash', player: 'a', delta: -7000, reason: 'rent', other: 'b' },
      { type: 'cash', player: 'b', delta: 7000, reason: 'rent', other: 'a' },
    ]);
    expect(totalCash(r.state)).toBe(before);
    expect(P(r.state, 'b').stats.rentEarned).toBe(7000);
  });

  it('upgrades need the whole collection, an unmortgaged tile, your turn and the cash; 40% of the price each, max level 2', () => {
    const s = game();
    for (const t of GROUP_TILES.cyber) s.owners[t] = 'a';
    expect(canUpgrade(s, 'a', 31)).toEqual({ ok: true, cost: 136000 });
    let r = act(s, { type: 'UPGRADE', playerId: 'a', tile: 31 });
    expect(r.events).toEqual([
      { type: 'cash', player: 'a', delta: -136000, reason: 'upgrade' },
      { type: 'level', tile: 31, level: 1, reason: 'upgrade' },
    ]);
    r = act(r.state, { type: 'UPGRADE', playerId: 'a', tile: 31 });
    expect(r.state.levels[31]).toBe(2);
    expect(applyAction(r.state, { type: 'UPGRADE', playerId: 'a', tile: 31 }).error).toMatch(/Tech Campus/);
    expect(applyAction(r.state, { type: 'MORTGAGE', playerId: 'a', tile: 31 }).error).toMatch(/upgrades/);
    const sold = act(r.state, { type: 'SELL_BUILDING', playerId: 'a', tile: 31 });
    expect(sold.state.levels[31]).toBe(1);
    expect(sold.events.at(-1)).toEqual({ type: 'cash', player: 'a', delta: 68000, reason: 'sell' });
    expect(canUpgrade(s, 'b', 31).ok).toBe(false);
    const m = { ...structuredClone(s) };
    m.mortgaged[31] = true;
    expect(canUpgrade(m, 'a', 31).reason).toMatch(/Unmortgage/);
  });

  it('mortgage = 50% of the price, lifting costs +10%; a mortgaged district collects nothing', () => {
    const s = game();
    s.owners[35] = 'a';
    let r = act(s, { type: 'MORTGAGE', playerId: 'a', tile: 35 });
    expect(P(r.state, 'a').cash).toBe(1500000 + mortgageValue(TILES[35]));
    expect(netWorth(r.state, 'a')).toBe(1500000 + 200000 + 400000 - 200000);
    r = act(r.state, { type: 'UNMORTGAGE', playerId: 'a', tile: 35 });
    expect(P(r.state, 'a').cash).toBe(1500000 + 200000 - unmortgageCost(TILES[35]));
  });

  it('net worth = cash + prices + 50% of upgrades paid - unpaid debt', () => {
    const s = game();
    s.owners[31] = 'a';
    s.levels[31] = 2;
    expect(netWorth(s, 'a')).toBe(1500000 + 340000 + upgradeCost(TILES[31]));
    s.phase = 'debt';
    s.debt = { player: 'a', amount: 1000, creditor: null, reason: 'tax', returnPhase: 'manage', rest: [] };
    expect(netWorth(s, 'a')).toBe(1500000 + 340000 + upgradeCost(TILES[31]) - 1000);
  });

  it('completing a collection emits set_complete', () => {
    const s = game();
    s.owners[1] = 'a'; s.owners[3] = 'a';
    let r = roll(s, 'a', 4);
    r = act(r.state, { type: 'BUY', playerId: 'a' });
    expect(r.events.at(-1)).toEqual({ type: 'set_complete', player: 'a', group: 'bazaar' });
    expect(getOptions(r.state, 'a').sets.find((x) => x.group === 'bazaar')).toMatchObject({ owned: 3, size: 3, multiplier: 1.5 });
  });
});

describe('upgrades need the whole collection', () => {
  const CYBER = [28, 29, 31]; // Cyberabad: 3 districts
  const reason = (have) => `Own all 3 districts of Cyberabad first (you have ${have})`;
  const own = (s, tiles, who = 'a') => { for (const t of tiles) s.owners[t] = who; return s; };

  it('refuses with a human-readable reason when 1 or 2 of 3 districts are owned (the rest free or held by others)', () => {
    const one = own(game(), [31]);
    expect(canUpgrade(one, 'a', 31)).toEqual({ ok: false, reason: reason(1), cost: 136000 });
    expect(applyAction(one, { type: 'UPGRADE', playerId: 'a', tile: 31 }).error).toBe(reason(1));
    expect(getOptions(one, 'a').upgrade).toEqual([]);

    const two = own(game(), [28, 31]);
    two.owners[29] = 'b'; // somebody else holds the third
    expect(canUpgrade(two, 'a', 31).reason).toBe(reason(2));
    expect(canUpgrade(two, 'a', 28).reason).toBe(reason(2));
    const err = applyAction(two, { type: 'UPGRADE', playerId: 'a', tile: 28 });
    expect(err.error).toBe(reason(2));
    expect(err.state).toBe(two);
    expect(getOptions(two, 'a').upgrade).toEqual([]);
    expect(two.levels[28]).toBe(0);
  });

  it('allows every district of the collection once all 3 are owned; other collections stay locked', () => {
    const s = own(game(), CYBER);
    own(s, [1, 3], 'a'); // 2 of 3 Bazaar districts: still locked
    for (const t of CYBER) expect(canUpgrade(s, 'a', t).ok).toBe(true);
    expect(getOptions(s, 'a').upgrade.map((u) => u.tile)).toEqual(CYBER);
    expect(canUpgrade(s, 'a', 1).reason).toBe('Own all 3 districts of Bazaar Beginnings first (you have 2)');
    const r = act(s, { type: 'UPGRADE', playerId: 'a', tile: 28 });
    expect(r.state.levels[28]).toBe(1);
    // nobody else may use the set, and the rule sits before the cash check
    expect(canUpgrade(s, 'b', 29)).toMatchObject({ ok: false, reason: 'You do not own this district' });
    const broke = own(game(), [28, 29]);
    broke.players[0].cash = 0;
    expect(canUpgrade(broke, 'a', 28).reason).toBe(reason(2));
    own(broke, [31]);
    expect(canUpgrade(broke, 'a', 28).reason).toMatch(/^Need /);
  });

  it('a mortgaged sibling still counts as owned (ownership only)', () => {
    const s = own(game(), CYBER);
    s.mortgaged[28] = true;
    expect(canUpgrade(s, 'a', 31).ok).toBe(true);
    expect(canUpgrade(s, 'a', 28).reason).toMatch(/Unmortgage/);
    expect(getOptions(s, 'a').upgrade.map((u) => u.tile)).toEqual([29, 31]);
  });

  it('breaking the set later blocks further upgrades only: levels stay, selling and rent work', () => {
    const s = own(game(), CYBER);
    let r = act(s, { type: 'UPGRADE', playerId: 'a', tile: 31 });
    r = act(r.state, { type: 'TRADE_OFFER', playerId: 'a', to: 'b', give: { cash: 0, tiles: [28] }, get: { cash: 1000, tiles: [] } });
    r = act(r.state, { type: 'TRADE_ACCEPT', playerId: 'b' });
    expect(r.state.owners[28]).toBe('b');
    expect(r.state.levels[31]).toBe(1); // the built level survives
    expect(canUpgrade(r.state, 'a', 31).reason).toBe(reason(2));
    expect(canUpgrade(r.state, 'a', 29).reason).toBe(reason(2));
    expect(applyAction(r.state, { type: 'UPGRADE', playerId: 'a', tile: 31 }).error).toBe(reason(2));
    expect(previewRent(r.state, 31)).toBe(92000); // level 1 rent unchanged
    const sold = act(r.state, { type: 'SELL_BUILDING', playerId: 'a', tile: 31 });
    expect(sold.state.levels[31]).toBe(0);
    // win the district back and upgrading works again
    const back = { ...structuredClone(r.state) };
    back.owners[28] = 'a';
    expect(canUpgrade(back, 'a', 31).ok).toBe(true);
  });

  it('is generic by collection size: a 2-district collection needs both', () => {
    const saved = GROUP_TILES.bazaar;
    GROUP_TILES.bazaar = [1, 3];
    try {
      const s = own(game(), [1]);
      expect(canUpgrade(s, 'a', 1).reason).toBe('Own all 2 districts of Bazaar Beginnings first (you have 1)');
      s.owners[3] = 'a';
      expect(canUpgrade(s, 'a', 1)).toEqual({ ok: true, cost: 24000 });
      expect(canUpgrade(s, 'a', 3).ok).toBe(true);
      expect(applyAction(s, { type: 'UPGRADE', playerId: 'a', tile: 3 }).state.levels[3]).toBe(1);
    } finally {
      GROUP_TILES.bazaar = saved;
    }
  });
});

describe('transport rides', () => {
  it('landing on a stop offers RIDE to the next stop for the fare; the offer ends with END_TURN', () => {
    const r = roll(game(), 'a', 5);
    expect(r.state.ride).toEqual({ player: 'a', from: 5, to: 14, fare: 25000 });
    expect(getOptions(r.state, 'a').ride).toEqual({ to: 14, fare: 25000 });
    expect(getOptions(r.state, 'b').ride).toBeNull();
    const ride = act(r.state, { type: 'RIDE', playerId: 'a' });
    expect(types(ride.events)).toEqual(['cash', 'ride', 'move']);
    expect(ride.events[1]).toEqual({ type: 'ride', player: 'a', from: 5, to: 14, fare: 25000 });
    expect(ride.events[2]).toMatchObject({ from: 5, to: 14, ride: true, passedStart: false });
    expect(ride.events[2].path).toHaveLength(9);
    expect(P(ride.state, 'a')).toMatchObject({ pos: 14, cash: 1475000 });
    expect(P(ride.state, 'a').stats.rides).toBe(1);
    expect(ride.state.ride).toBeNull(); // arriving has no further effect
    expect(applyAction(ride.state, { type: 'RIDE', playerId: 'a' }).error).toBeTruthy();
    const end = act(r.state, { type: 'END_TURN', playerId: 'a' });
    expect(end.state.ride).toBeNull();
  });

  it('the MMTS ride passes START and pays the salary', () => {
    const s = game();
    s.players[0].pos = 20;
    const r = roll(s, 'a', 3);
    const ride = act(r.state, { type: 'RIDE', playerId: 'a' });
    expect(ride.events.find((e) => e.type === 'move')).toMatchObject({ from: 23, to: 5, passedStart: true, ride: true });
    expect(P(ride.state, 'a').cash).toBe(1500000 - 45000 + PASS_START);
  });

  it('cannot ride without the fare; a new roll after a six drops the offer', () => {
    const s = game();
    s.players[0].cash = 10000;
    const r = roll(s, 'a', 5);
    expect(getOptions(r.state, 'a').ride).toBeNull();
    expect(applyAction(r.state, { type: 'RIDE', playerId: 'a' }).error).toMatch(/fare/);
    const t = game();
    t.players[0].pos = 17;
    let q = roll(t, 'a', 6); // 23 MMTS, six
    expect(q.state.ride).toMatchObject({ from: 23 });
    q = roll(q.state, 'a', 1);
    expect(q.state.ride).toBeNull();
  });
});

describe('traffic jam and chai', () => {
  it('Traffic Jam: stuck, the turn ends (extra roll lost)', () => {
    const s = game();
    s.players[0].pos = 3;
    const r = roll(s, 'a', 6); // 9 on a six
    expect(r.events).toContainEqual({ type: 'traffic', player: 'a', stuck: true, reason: 'tile' });
    expect(P(r.state, 'a').stuck).toBe(true);
    expect(r.state.extraRoll).toBe(false);
    expect(r.state.players[r.state.turn].id).toBe('b');
    expect(types(r.events).at(-1)).toBe('turn');
  });

  function stuckTurn() {
    const s = game();
    s.players[0].stuck = true;
    s.players[0].pos = 9;
    return s;
  }

  it('PAY_TRAFFIC costs 25,000 and then you roll normally', () => {
    const s = stuckTurn();
    expect(getOptions(s, 'a')).toMatchObject({ roll: true, payTraffic: TRAFFIC_FINE, useChai: false });
    const r = act(s, { type: 'PAY_TRAFFIC', playerId: 'a' });
    expect(r.events).toEqual([
      { type: 'cash', player: 'a', delta: -25000, reason: 'traffic' },
      { type: 'traffic', player: 'a', stuck: false, reason: 'paid', amount: 25000 },
    ]);
    expect(r.state.phase).toBe('roll');
    expect(roll(r.state, 'a', 1).state.players[0].pos).toBe(10);
  });

  it('USE_CHAI spends the token instead; ROLL while stuck means wait (no move, the turn ends)', () => {
    const s = stuckTurn();
    s.players[0].chai = 1;
    const c = act(s, { type: 'USE_CHAI', playerId: 'a' });
    expect(c.events).toEqual([
      { type: 'chai', player: 'a', chai: 0, change: -1, reason: 'traffic' },
      { type: 'traffic', player: 'a', stuck: false, reason: 'chai' },
    ]);
    const w = act(stuckTurn(), { type: 'ROLL', playerId: 'a', dice: [4] });
    expect(types(w.events)).toEqual(['traffic', 'turn']);
    expect(w.events[0]).toEqual({ type: 'traffic', player: 'a', stuck: false, reason: 'waited' });
    expect(P(w.state, 'a')).toMatchObject({ pos: 9, stuck: false });
    expect(w.state.players[w.state.turn].id).toBe('b');
    const broke = stuckTurn();
    broke.players[0].cash = 1000;
    expect(getOptions(broke, 'a').payTraffic).toBe(false);
    expect(applyAction(broke, { type: 'PAY_TRAFFIC', playerId: 'a' }).error).toBeTruthy();
    expect(applyAction(game(), { type: 'USE_CHAI', playerId: 'a' }).error).toMatch(/not stuck/);
  });

  it('Chai Adda gives one chai (cap 1, nothing at the cap)', () => {
    const s = game();
    s.players[0].pos = 15;
    const r = roll(s, 'a', 3);
    expect(r.events).toContainEqual({ type: 'chai', player: 'a', chai: 1, change: 1, reason: 'adda' });
    const again = game();
    again.players[0].pos = 15;
    again.players[0].chai = 1;
    expect(roll(again, 'a', 3).events.some((e) => e.type === 'chai')).toBe(false);
  });

  it('chai halves the next rent of 20,000 or more automatically', () => {
    const s = game();
    s.owners[31] = 'b';
    s.levels[31] = 1; // 92,000
    s.players[0].pos = 28;
    s.players[0].chai = 1;
    const r = roll(s, 'a', 3);
    expect(r.events).toContainEqual({ type: 'chai', player: 'a', chai: 0, change: -1, reason: 'rent', saved: 46000 });
    expect(r.events).toContainEqual({ type: 'cash', player: 'a', delta: -46000, reason: 'rent', other: 'b' });
    expect(P(r.state, 'a').stats.chaiSaved).toBe(46000);
    // a small rent keeps the chai
    const small = game();
    small.owners[1] = 'b';
    small.players[0].chai = 1;
    const sr = roll(small, 'a', 1);
    expect(P(sr.state, 'a').chai).toBe(1);
  });
});

describe('municipal charges and bazaar auction', () => {
  it('Municipal Charges = 40,000 + 10,000 per upgrade level owned', () => {
    const s = game();
    s.owners[1] = 'a'; s.levels[1] = 2; s.owners[3] = 'a'; s.levels[3] = 1;
    expect(municipalDue(s, 'a')).toBe(70000);
    s.players[0].pos = 24;
    const r = roll(s, 'a', 3);
    expect(r.events).toContainEqual({ type: 'cash', player: 'a', delta: -70000, reason: 'tax' });
    expect(P(r.state, 'a').stats.taxPaid).toBe(70000);
  });

  it('Bazaar Auction: a random unowned district, min bid 50% of its price; the lander bids too', () => {
    const s = game({ targetWorth: null }); // c owns the rest of the city: no win target here
    s.players[0].pos = 29;
    for (let i = 0; i < BOARD_SIZE; i++) if (TILES[i].type === 'property' && i !== 22) s.owners[i] = 'c';
    const r = roll(s, 'a', 3);
    expect(r.state.phase).toBe('auction');
    expect(r.events.at(-1)).toEqual({ type: 'auction_start', tile: 22, minBid: 120000, reason: 'bazaar', eligible: ['a', 'b', 'c'], ms: 20000 });
    expect(getOptions(r.state, 'a').bid).toEqual({ tile: 22, min: 120000, max: 1500000 });
    expect(applyAction(r.state, { type: 'BID', playerId: 'b', amount: 100000 }).error).toMatch(/minimum/);
    let x = act(r.state, { type: 'BID', playerId: 'a', amount: 130000 });
    x = act(x.state, { type: 'BID', playerId: 'b', amount: 130000 });
    x = act(x.state, { type: 'BID', playerId: 'c', amount: 0 });
    expect(['a', 'b']).toContain(x.state.owners[22]); // tie -> drawn with the game's seeded rng among the tied bidders
    expect(x.events.find((e) => e.type === 'auction_end')).toMatchObject({ tie: true, amount: 130000 });
    expect(x.state.phase).toBe('manage');
  });

  it('Bazaar Auction does nothing when every district is owned', () => {
    const s = game({ targetWorth: null });
    s.players[0].pos = 29;
    for (let i = 0; i < BOARD_SIZE; i++) if (TILES[i].type === 'property') s.owners[i] = 'c';
    const r = roll(s, 'a', 3);
    expect(r.state.phase).toBe('manage');
    expect(r.events.some((e) => e.type === 'auction_start')).toBe(false);
  });
});

describe('cards', () => {
  it('Nawabi Luck and City Drama draw from their own decks', () => {
    const s = game();
    stackCard(s, 'luck', 'investor');
    const r = roll(s, 'a', 2);
    expect(r.events).toContainEqual({ type: 'card', player: 'a', cardId: 'investor', kind: 'good', deck: 'luck', title: 'An investor is impressed!', text: expect.any(String) });
    expect(P(r.state, 'a').cash).toBe(1600000);
    const d = game();
    d.players[0].pos = 10;
    stackCard(d, 'drama', 'shaadi_season');
    const dr = roll(d, 'a', 2);
    expect(dr.events.find((e) => e.type === 'card')).toMatchObject({ deck: 'drama', cardId: 'shaadi_season' });
    expect(P(dr.state, 'a').cash).toBe(1450000);
  });

  it('Ameerpet traffic: stuck where you stand, the turn ends', () => {
    const s = game();
    s.players[0].pos = 6;
    stackCard(s, 'drama', 'ameerpet_traffic');
    const r = roll(s, 'a', 6);
    expect(r.events).toContainEqual({ type: 'traffic', player: 'a', stuck: true, reason: 'card' });
    expect(P(r.state, 'a')).toMatchObject({ pos: 12, stuck: true });
    expect(r.state.extraRoll).toBe(false);
    expect(r.state.players[r.state.turn].id).toBe('b');
  });

  it('Cricket night doubles your rents until your next turn', () => {
    const s = game();
    s.owners[4] = 'a';
    stackCard(s, 'luck', 'cricket_night');
    let r = roll(s, 'a', 2);
    expect(P(r.state, 'a').rentBoost).toBe(2);
    expect(previewRent(r.state, 4)).toBe(16000);
    r = act(r.state, { type: 'END_TURN', playerId: 'a' });
    r = roll(r.state, 'b', 4);
    expect(r.events).toContainEqual({ type: 'cash', player: 'b', delta: -16000, reason: 'rent', other: 'a' });
    r = act(r.state, { type: 'END_TURN', playerId: 'b' });
    r = roll(r.state, 'c', 1);
    r = act(r.state, { type: 'SKIP_BUY', playerId: 'c' });
    for (const id of ids) if (r.state.phase === 'auction') r = act(r.state, { type: 'BID', playerId: id, amount: 0 });
    r = act(r.state, { type: 'END_TURN', playerId: 'c' });
    expect(P(r.state, 'a').rentBoost).toBe(0);
    expect(previewRent(r.state, 4)).toBe(8000);
  });

  it('move-to cards travel clockwise, pay salary when passing START and resolve the new tile', () => {
    const s = game();
    s.players[0].pos = 19;
    stackCard(s, 'luck', 'metro_hitec');
    const r = roll(s, 'a', 2); // 21 -> HITEC City 31
    expect(P(r.state, 'a').pos).toBe(31);
    expect(r.state.pending).toMatchObject({ type: 'buy', tile: 31 });
    const w = game();
    w.players[0].pos = 19;
    stackCard(w, 'luck', 'go_start');
    const wr = roll(w, 'a', 2);
    expect(P(wr.state, 'a')).toMatchObject({ pos: 0, cash: 1700000 });
    const t = game();
    t.players[0].pos = 19;
    stackCard(t, 'luck', 'next_ride');
    const tr = roll(t, 'a', 2);
    expect(tr.state.ride).toMatchObject({ from: 23, to: 5 });
  });

  it('collect from every player, pay per upgrade, free chai', () => {
    const s = game();
    stackCard(s, 'luck', 'birthday');
    const r = roll(s, 'a', 2);
    expect(P(r.state, 'a').cash).toBe(1520000);
    expect(P(r.state, 'b').cash).toBe(1490000);
    const m = game();
    m.players[0].pos = 10;
    m.owners[1] = 'a'; m.levels[1] = 2; m.owners[3] = 'a'; m.levels[3] = 1;
    stackCard(m, 'drama', 'monsoon_leaks');
    expect(P(roll(m, 'a', 2).state, 'a').cash).toBe(1500000 - 45000);
    const c = game();
    stackCard(c, 'luck', 'free_chai');
    expect(roll(c, 'a', 2).events).toContainEqual({ type: 'chai', player: 'a', chai: 1, change: 1, reason: 'card' });
  });

  it('a deck reshuffles when it runs out', () => {
    let s = game({ snatches: 1 }); // with Snatch on the Snatch cards are part of the deck
    s.deckPos.luck = s.deck.luck.length; // exhausted
    const r = roll(s, 'a', 2);
    expect(r.state.deckPos.luck).toBe(1);
    expect([...r.state.deck.luck].sort((x, y) => x - y)).toEqual(LUCK_CARDS.map((_, i) => i));
  });
});

describe('city events (every 3 rounds)', () => {
  /** Play END_TURNs until the round counter reaches `round`. */
  function toRound(s, round) {
    let ev = [];
    while (s.round < round) {
      const who = s.players[s.turn].id;
      let r = roll(s, who, 1 + ((s.turnCount * 2) % 3)); // land on cheap squares
      if (r.state.phase === 'buy') r = act(r.state, { type: 'SKIP_BUY', playerId: who });
      while (r.state.phase === 'auction') r = act(r.state, { type: 'BID', playerId: r.state.players.find((p) => !(p.id in r.state.pending.bids)).id, amount: 0 });
      if (r.state.phase === 'manage' && r.state.extraRoll === false) r = act(r.state, { type: 'END_TURN', playerId: who });
      ev = r.events;
      s = r.state;
    }
    return { s, ev };
  }

  it('no event in rounds 1-2; one in round 3 (before its first turn event), gone in round 4', () => {
    const g = game();
    const r2 = toRound(g, 2);
    expect(r2.s.event).toBeNull();
    const r3 = toRound(r2.s, 3);
    expect(r3.s.event).toMatchObject({ round: 3 });
    expect(CITY_EVENTS.map((e) => e.id)).toContain(r3.s.event.id);
    const i = r3.ev.findIndex((e) => e.type === 'city_event');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(r3.ev.findIndex((e) => e.type === 'turn'));
    const r4 = toRound(r3.s, 4);
    expect(r4.s.event).toBeNull();
    expect(EVENT_EVERY).toBe(3);
  });

  it('rent events multiply previewRent; biryani boom only hits upgraded food districts', () => {
    const s = game();
    s.owners[6] = 'b'; s.owners[7] = 'b';
    s.levels[7] = 1;
    s.event = { id: 'biryani_boom', kind: 'rent', groups: ['oldcity', 'everyday'], mult: 2, upgradedOnly: true, round: 3 };
    expect(previewRent(s, 6)).toBe(10000);
    expect(previewRent(s, 7)).toBe(rentFor(TILES[7], 1) * 2);
    s.event = { id: 'rush_hour', kind: 'rent', group: 'oldcity', mult: 1.5, round: 3 };
    expect(previewRent(s, 6)).toBe(15000);
    s.event = { id: 'monsoon', kind: 'rent', group: 'oldcity', mult: 0.5, round: 3 };
    expect(previewRent(s, 6)).toBe(5000);
  });

  it('festival pays everyone; wedding season charges everyone and pays upgraded venue owners', () => {
    // Force each cash event by trying seeds until the round-3 draw is the one we want.
    const find = (id) => {
      for (let seed = 1; seed < 400; seed++) {
        const g = game({}, { seed });
        g.owners[20] = 'b'; g.levels[20] = 1;
        const { s, ev } = toRound(g, 3);
        if (s.event && s.event.id === id) return { s, ev };
      }
      throw new Error(`no seed draws ${id}`);
    };
    const f = find('festival');
    expect(f.s.event.amount).toBe(50000);
    expect(f.ev.filter((e) => e.type === 'cash' && e.reason === 'event')).toHaveLength(3);
    expect(f.s.event.title).toMatch(/Bonalu|Bathukamma|Eid/);
    const w = find('wedding_season');
    const cash = w.ev.filter((e) => e.type === 'cash' && e.reason === 'event');
    expect(cash).toContainEqual({ type: 'cash', player: 'b', delta: 20000, reason: 'event' });
    expect(cash.filter((e) => e.delta === -30000)).toHaveLength(3);
  });
});

describe('debt, bankruptcy and trades', () => {
  it('a rent too big for the cash pauses in debt; mortgaging and PAY_DEBT settle it', () => {
    const s = game();
    s.owners[35] = 'b'; s.levels[35] = 2; // 1,76,000
    s.owners[1] = 'a';
    s.players[0].cash = 150000;
    s.players[0].pos = 33;
    const r = roll(s, 'a', 2);
    expect(r.state.phase).toBe('debt');
    expect(r.state.debt).toMatchObject({ player: 'a', amount: 176000, creditor: 'b', reason: 'rent' });
    expect(getOptions(r.state, 'a').debt).toEqual({ amount: 176000, creditor: 'b', shortfall: 26000 });
    expect(applyAction(r.state, { type: 'END_TURN', playerId: 'a' }).error).toMatch(/debt/);
    expect(applyAction(r.state, { type: 'PAY_DEBT', playerId: 'a' }).error).toMatch(/more/);
    let x = act(r.state, { type: 'MORTGAGE', playerId: 'a', tile: 1 });
    x = act(x.state, { type: 'PAY_DEBT', playerId: 'a' });
    expect(x.state.phase).toBe('manage');
    expect(P(x.state, 'b').cash).toBe(1676000);
  });

  it('an uncoverable debt is a bankruptcy: the bank takes everything, the creditor is paid up to the estate (shared/bankruptcy.test.js)', () => {
    const s = game();
    s.owners[35] = 'b'; s.levels[35] = 2;
    s.owners[1] = 'a'; s.levels[1] = 1;
    s.players[0].cash = 10000;
    s.players[0].pos = 33;
    expect(liquidationValue(s, 'a')).toBe(12000 + 30000);
    const r = roll(s, 'a', 2);
    expect(P(r.state, 'a').bankrupt).toBe(true);
    expect(r.state.owners[1]).toBeNull(); // back to the bank, NOT to b
    expect(r.state.levels[1]).toBe(0);
    expect(P(r.state, 'b').cash).toBe(1500000 + 10000 + 12000 + 30000); // b: only what a's assets were worth (cash + sell-back + mortgage value)
    expect(r.events).toContainEqual({ type: 'bankrupt', player: 'a', paid: [{ to: 'b', amount: 52000 }] });
    expect(r.state.players[r.state.turn].id).toBe('b');
  });

  it('last player standing wins; standings agree', () => {
    let s = game({}, { n: 2 });
    const r = act(s, { type: 'RESIGN', playerId: 'a' });
    expect(r.state.phase).toBe('over');
    expect(r.state.winReason).toBe('last_standing');
    expect(r.state.winner).toBe('b');
    expect(r.events.at(-1)).toMatchObject({ type: 'win', player: 'b', reason: 'last_standing' });
    expect(standings(r.state)[0].id).toBe('b');
    expect(applyAction(r.state, { type: 'ROLL', playerId: 'b' }).error).toBe('The game is over');
    s = r.state;
  });

  it('trades swap districts (with their upgrades) and cash after acceptance', () => {
    const s = game();
    s.owners[1] = 'a'; s.levels[1] = 1;
    s.owners[31] = 'b';
    let r = act(s, { type: 'TRADE_OFFER', playerId: 'a', to: 'b', give: { cash: 50000, tiles: [1] }, get: { cash: 0, tiles: [31] } });
    expect(getOptions(r.state, 'b').tradeOffer).toMatchObject({ from: 'a' });
    expect(applyAction(r.state, { type: 'ROLL', playerId: 'a' }).error).toMatch(/trade/);
    r = act(r.state, { type: 'TRADE_ACCEPT', playerId: 'b' });
    expect(r.state.owners[1]).toBe('b');
    expect(r.state.levels[1]).toBe(1);
    expect(r.state.owners[31]).toBe('a');
    expect(P(r.state, 'a').cash).toBe(1450000);
    expect(applyAction(s, { type: 'TRADE_OFFER', playerId: 'a', to: 'b', give: { cash: 0, tiles: [5] }, get: { cash: 1, tiles: [] } }).error).toMatch(/districts/);
  });
});

describe('modes and the round-limit win', () => {
  function endRounds(settings, setup) {
    const s = game(settings, { n: 2 });
    setup?.(s);
    s.round = s.cfg.maxRounds ?? ROUND_CAP;
    s.turn = 1;
    s.phase = 'manage';
    return act(s, { type: 'END_TURN', playerId: 'b' });
  }

  it('standard ends after round 20: highest net worth wins', () => {
    const r = endRounds({}, (s) => { s.owners[35] = 'b'; });
    expect(r.state.phase).toBe('over');
    expect(r.state).toMatchObject({ winner: 'b', winReason: 'rounds' });
    expect(r.events.at(-1)).toEqual({ type: 'win', player: 'b', reason: 'rounds', worth: 1900000 });
    expect(r.state.event).toBeNull();
  });

  it('a net worth tie goes to the one with more cash, then seat order; standings agree', () => {
    const cash = endRounds({ mode: 'quick' }, (s) => {
      s.players[0].cash = 1600000; // a: 16 L cash
      s.players[1].cash = 1500000; s.owners[33] = 'b'; s.players[1].cash -= 260000; // b: worth 16 L, less cash
    });
    expect(cash.state.round).toBe(13);
    expect(netWorth(cash.state, 'a')).toBe(netWorth(cash.state, 'b'));
    expect(cash.state.winner).toBe('a');
    expect(standings(cash.state)[0].id).toBe('a');
    const seat = endRounds({}, () => {});
    expect(seat.state.winner).toBe('a');
    expect(standings(seat.state).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('classic has no round limit but stops at the safety cap', () => {
    const s = game({ mode: 'classic' }, { n: 2 });
    s.round = 30;
    s.turn = 1;
    s.phase = 'manage';
    expect(act(s, { type: 'END_TURN', playerId: 'b' }).state.phase).toBe('roll');
    const r = endRounds({ mode: 'classic' }, (x) => { x.players[1].cash += 1; });
    expect(r.state).toMatchObject({ phase: 'over', winReason: 'rounds', winner: 'b' });
  });

  it('bankrupt players rank after everyone still in, the last one out first', () => {
    const s = game({}, { n: 4 });
    let r = act(s, { type: 'RESIGN', playerId: 'b' });
    r = act(r.state, { type: 'RESIGN', playerId: 'c' });
    const st = standings(r.state);
    expect(st.map((x) => x.id)).toEqual(['a', 'd', 'c', 'b']);
  });
});

describe('win target (net worth)', () => {
  const TARGET = 2500000; // 25 lakh: reachable in a test with a little setup
  const tgame = (extra = {}, opts = { n: 2 }) => game({ targetWorth: TARGET, ...extra }, opts);
  /** `id` sits above the target before anyone acts (the setup bypasses the check that runs after every action) */
  const above = (s, id, cash = TARGET + 100000) => { P(s, id).cash = cash; return s; };

  it('defaults: standard and quick 50 lakh (a safety valve), classic 30 lakh; the list of options', () => {
    expect(TARGET_OPTIONS).toEqual([null, 2500000, 3000000, 4000000, 5000000, 7500000, 10000000]);
    expect(MODES.standard.targetWorth).toBe(5000000);
    expect(MODES.quick.targetWorth).toBe(5000000);
    expect(MODES.classic.targetWorth).toBe(3000000);
    expect(normalizeSettings({}).targetWorth).toBe(5000000);
    expect(normalizeSettings({ mode: 'quick' }).targetWorth).toBe(5000000);
    expect(normalizeSettings({ mode: 'classic' }).targetWorth).toBe(3000000);
    expect(createGame({ players: [{ id: 'a' }, { id: 'b' }], settings: { mode: 'classic' }, seed: 1 }).cfg.targetWorth).toBe(3000000);
  });

  it('only a listed target or null gets through; anything else is the mode default', () => {
    for (const t of TARGET_OPTIONS) expect(normalizeSettings({ targetWorth: t }).targetWorth).toBe(t);
    for (const bad of [123, -5, 2500001, '5000000', true, NaN, Infinity, [], {}, undefined]) {
      expect(normalizeSettings({ targetWorth: bad }).targetWorth, String(bad)).toBe(5000000);
      expect(normalizeSettings({ mode: 'classic', targetWorth: bad }).targetWorth, String(bad)).toBe(3000000);
    }
    // the engine accepts "off" for every mode (tests, the simulator): the ROUND_CAP safety net still ends a classic game
    expect(normalizeSettings({ mode: 'classic', targetWorth: null })).toMatchObject({ maxRounds: null, targetWorth: null });
    // the rules the lobby uses: no "off" without a round limit
    expect(resolveTarget('standard', null)).toBeNull();
    expect(resolveTarget('classic', null)).toBe(3000000);
    expect(resolveTarget('classic', 4000000)).toBe(4000000);
    expect(resolveTarget('nope', 77)).toBe(5000000);
    expect(targetLabel(null)).toBe('Off');
    expect([2500000, 7500000, 10000000].map(targetLabel)).toEqual(['₹25L', '₹75L', '₹1Cr']);
    expect(modeSummary('standard')).toBe('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
    expect(modeSummary('quick', null)).toBe('Quick Chai Break · 12 rounds · richest wins');
    expect(modeSummary('classic', 4000000)).toBe('Classic Long Game · first to ₹40L wins');
  });

  it('crossing the target ends the game at once: phase over, winner, winReason target, win event with the worth', () => {
    const s = tgame();
    P(s, 'a').cash = 2400000;
    P(s, 'a').pos = 34;
    const r = roll(s, 'a', 3); // passes START: +2 lakh salary -> 26 lakh
    expect(r.state.phase).toBe('over');
    expect(r.state).toMatchObject({ winner: 'a', winReason: 'target', pending: null, debt: null, trade: null });
    expect(r.state.round).toBe(1);
    expect(r.events.at(-1)).toEqual({ type: 'win', player: 'a', reason: 'target', worth: netWorth(r.state, 'a') });
    expect(r.events.at(-1).worth).toBeGreaterThanOrEqual(TARGET);
    expect(r.events.filter((e) => e.type === 'win')).toHaveLength(1);
    expect(standings(r.state)[0].id).toBe('a');
    expect(applyAction(r.state, { type: 'ROLL', playerId: 'b' }).error).toBe('The game is over');
  });

  it('exactly the target counts (>=), one rupee short does not', () => {
    const at = above(tgame(), 'a', TARGET);
    at.phase = 'manage';
    expect(act(at, { type: 'END_TURN', playerId: 'a' }).state).toMatchObject({ phase: 'over', winner: 'a', winReason: 'target' });
    const short = above(tgame(), 'a', TARGET - 1);
    short.phase = 'manage';
    expect(act(short, { type: 'END_TURN', playerId: 'a' }).state.phase).toBe('roll');
  });

  it('net worth counts districts at their printed value and half the upgrades, not just cash', () => {
    const s = tgame();
    s.phase = 'manage';
    s.owners[1] = 'a'; s.owners[3] = 'a';
    P(s, 'a').cash = 100000;
    expect(netWorth(s, 'a')).toBe(100000 + TILES[1].price + TILES[3].price);
    for (const t of [28, 29, 31]) s.owners[t] = 'a'; // a whole collection, one district upgraded
    s.levels[28] = 2;
    P(s, 'a').cash += TARGET - netWorth(s, 'a'); // exactly at the target
    expect(netWorth(s, 'a')).toBe(TARGET);
    expect(act(s, { type: 'END_TURN', playerId: 'a' }).state).toMatchObject({ phase: 'over', winner: 'a', winReason: 'target' });
  });

  it('mortgaging never moves net worth, so it cannot trigger (or dodge) the target', () => {
    const s = tgame();
    s.phase = 'manage';
    s.owners[1] = 'a';
    P(s, 'a').cash = TARGET - TILES[1].price - 1; // one rupee short
    expect(netWorth(s, 'a')).toBe(TARGET - 1);
    const r = act(s, { type: 'MORTGAGE', playerId: 'a', tile: 1 });
    expect(netWorth(r.state, 'a')).toBe(TARGET - 1);
    expect(r.state.phase).toBe('manage');
  });

  it('targetWorth null: nobody wins on wealth (the old behaviour)', () => {
    const s = game({ targetWorth: null }, { n: 2 });
    above(s, 'a', 90000000);
    s.phase = 'manage';
    const r = act(s, { type: 'END_TURN', playerId: 'a' });
    expect(r.state.phase).toBe('roll');
    expect(r.state.winner).toBeNull();
    expect(r.events.some((e) => e.type === 'win')).toBe(false);
  });

  it('is not decided while a debt is open; it is once the debt is settled', () => {
    const s = tgame();
    s.owners[35] = 'b'; s.levels[35] = 2; // 1,76,000 rent
    s.owners[1] = 'a';
    P(s, 'a').cash = 150000;
    P(s, 'a').pos = 33;
    above(s, 'b'); // b is over the target before the rent lands
    const r = roll(s, 'a', 2);
    expect(r.state.phase).toBe('debt');
    expect(r.state.winner).toBeNull();
    let x = act(r.state, { type: 'MORTGAGE', playerId: 'a', tile: 1 });
    expect(x.state.phase).toBe('debt'); // still open: no win in the middle of a debt
    x = act(x.state, { type: 'PAY_DEBT', playerId: 'a' });
    expect(x.state).toMatchObject({ phase: 'over', winner: 'b', winReason: 'target' });
    expect(x.events.at(-1)).toMatchObject({ type: 'win', player: 'b', reason: 'target' });
  });

  it('rent paid on the way to the target settles first: the payee wins with the rent included', () => {
    const s = tgame();
    s.owners[35] = 'b'; s.levels[35] = 2; // 1,76,000 rent
    P(s, 'a').pos = 33;
    const before = netWorth(s, 'b');
    P(s, 'b').cash += TARGET - before - 100000; // 1,00,000 short: the 1,76,000 rent lifts b over the line
    const r = roll(s, 'a', 2);
    expect(P(r.state, 'a').cash).toBe(1500000 - 176000);
    expect(r.state).toMatchObject({ phase: 'over', winner: 'b', winReason: 'target' });
    expect(r.events.at(-1).worth).toBe(netWorth(r.state, 'b'));
  });

  it('is not decided during a sealed auction; it is once the auction is resolved', () => {
    const s = tgame({}, { n: 3 });
    P(s, 'a').pos = 29;
    for (let i = 0; i < BOARD_SIZE; i++) if (TILES[i].type === 'property' && i !== 22) s.owners[i] = 'c';
    const r = roll(s, 'a', 3); // lands on the Bazaar: a random free district goes to auction
    expect(r.state.phase).toBe('auction');
    expect(netWorth(r.state, 'c')).toBeGreaterThanOrEqual(TARGET); // c is far over the line, yet the game waits
    expect(r.state.winner).toBeNull();
    let x = act(r.state, { type: 'BID', playerId: 'a', amount: 130000 });
    x = act(x.state, { type: 'BID', playerId: 'b', amount: 0 });
    expect(x.state.phase).toBe('auction');
    x = act(x.state, { type: 'BID', playerId: 'c', amount: 0 });
    expect(x.state.owners[22]).toBe('a');
    expect(x.state).toMatchObject({ phase: 'over', winner: 'c', winReason: 'target' });
  });

  it('is not decided while a trade offer is open; it is once the offer is answered', () => {
    const s = tgame();
    above(s, 'b');
    const r = act(s, { type: 'TRADE_OFFER', playerId: 'a', to: 'b', give: { cash: 1000, tiles: [] }, get: { cash: 0, tiles: [] } });
    expect(r.state.trade).not.toBeNull();
    expect(r.state.phase).not.toBe('over');
    const x = act(r.state, { type: 'TRADE_REJECT', playerId: 'b' });
    expect(x.state).toMatchObject({ phase: 'over', winner: 'b', winReason: 'target', trade: null });
    // accepting counts too: the traded worth is what is measured afterwards
    const y = act(r.state, { type: 'TRADE_ACCEPT', playerId: 'b' });
    expect(y.state).toMatchObject({ phase: 'over', winner: 'b', winReason: 'target' });
  });

  it('several players over the line: the richest wins, then more cash, then the lower seat', () => {
    // richest
    let s = tgame({}, { n: 3 });
    above(s, 'a', TARGET + 10); above(s, 'b', TARGET + 500000); above(s, 'c', TARGET + 20);
    s.phase = 'manage';
    let r = act(s, { type: 'END_TURN', playerId: 'a' });
    expect(r.state).toMatchObject({ winner: 'b', winReason: 'target' });
    expect(standings(r.state)[0].id).toBe('b');
    // equal worth: more cash wins (b holds a district instead of cash); a and c tie on worth and cash: the lower seat
    s = tgame({}, { n: 3 });
    above(s, 'a', TARGET + 100000); above(s, 'c', TARGET + 100000);
    s.owners[1] = 'b';
    P(s, 'b').cash = TARGET + 100000 - TILES[1].price;
    expect(netWorth(s, 'b')).toBe(netWorth(s, 'a'));
    s.phase = 'manage';
    r = act(s, { type: 'END_TURN', playerId: 'a' });
    expect(r.state.winner).toBe('a');
    expect(standings(r.state).map((x) => x.id)).toEqual(['a', 'c', 'b']);
    // equal worth, the later seat holds more cash
    s = tgame({}, { n: 3 });
    above(s, 'c', TARGET + 100000);
    s.owners[1] = 'a';
    P(s, 'a').cash = TARGET + 100000 - TILES[1].price;
    above(s, 'b', TARGET - 1);
    s.phase = 'manage';
    r = act(s, { type: 'END_TURN', playerId: 'a' });
    expect(r.state).toMatchObject({ winner: 'c', winReason: 'target' });
    expect(standings(r.state)[0].id).toBe('c');
  });

  it('a bankrupt player cannot win; the last one standing wins as last_standing, which is checked first', () => {
    const s = tgame({}, { n: 3 });
    above(s, 'c');
    let r = act(s, { type: 'RESIGN', playerId: 'c' }); // c is out although it was over the line
    expect(r.state.phase).not.toBe('over');
    expect(P(r.state, 'c').bankrupt).toBe(true);
    r = act(r.state, { type: 'RESIGN', playerId: r.state.players[r.state.turn].id });
    expect(r.state).toMatchObject({ phase: 'over', winReason: 'last_standing' });
    const two = above(tgame(), 'a'); // both reasons apply at once
    const x = act(two, { type: 'RESIGN', playerId: 'b' });
    expect(x.state).toMatchObject({ winner: 'a', winReason: 'last_standing' });
  });

  it('the last round: when the target and the round limit both apply, the target is the reason', () => {
    const s = tgame();
    s.round = 20;
    s.turn = 1;
    s.phase = 'manage';
    above(s, 'b');
    const r = act(s, { type: 'END_TURN', playerId: 'b' }); // round 21 would begin: over by rounds AND target
    expect(r.state).toMatchObject({ phase: 'over', winner: 'b', winReason: 'target' });
    expect(r.state.round).toBe(21);
  });

  it('a classic game with the target off still ends at the safety cap (never runs forever)', () => {
    const s = game({ mode: 'classic', targetWorth: null }, { n: 2 });
    s.round = ROUND_CAP;
    s.turn = 1;
    s.phase = 'manage';
    above(s, 'a', 90000000);
    expect(act(s, { type: 'END_TURN', playerId: 'b' }).state).toMatchObject({ phase: 'over', winner: 'a', winReason: 'rounds' });
  });

  it('with the target never reached, a game plays out exactly as with the target off (same dice, same events)', () => {
    for (const mode of ['standard', 'quick']) {
      for (let seed = 1; seed <= 4; seed++) {
        const run = (settings) => {
          const players = [0, 1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, isBot: true }));
          let s = createGame({ players, settings: { mode, snatches: 0, ...settings }, seed });
          const rnd = mulberry32(seed * 13);
          const log = [];
          for (let i = 0; i < 20000 && s.phase !== 'over'; i++) {
            const r = applyAction(s, nextBotMove(s, rnd));
            if (r.error) throw new Error(r.error);
            s = r.state;
            log.push(JSON.stringify(r.events));
          }
          return { s, log };
        };
        const on = run({});
        const off = run({ targetWorth: null });
        expect(on.s.winReason, `${mode} #${seed}`).toBe('rounds'); // the 50 lakh valve is not reached by these games
        expect(on.log).toEqual(off.log);
        expect({ ...on.s, cfg: { ...on.s.cfg, targetWorth: null } }).toEqual(off.s);
      }
    }
  });
});
