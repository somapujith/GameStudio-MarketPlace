// Snatch (docs/GAME_RULES.md section 9): every player holds `cfg.snatches` Snatch buttons (default 1; +1 from each of at
// most `cfg.snatchCardCap` Nawabi Luck cards). After a landing BUY of a free district every other player with a button
// gets a window (`cfg.snatchMs`, default 5 s) to press it. One presser takes the district for free (the buyer is NOT
// refunded); several pressers go to a sealed bidding among themselves; nobody pressing leaves it with the buyer.
// This file is the engine side (the room timer, sealed-press delivery and redaction are covered in worker/snatch.test.js).
import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, getOptions, nextBotMove, chooseBotAction, botSnatchAction, SNATCH_MIN_PRICE, normalizeSettings,
  DEFAULT_SETTINGS, TILES, LUCK_CARDS, DRAMA_CARDS, SNATCH_CAP_PAYOUT, mulberry32, formatINR,
} from './index.js';

// ---------------------------------------------------------------- helpers
const ids = ['p0', 'p1', 'p2', 'p3'];
const mkPlayers = (n) => Array.from({ length: n }, (_, i) => ({ id: ids[i], name: `P${i}`, avatar: i }));
const edit = (s, fn) => {
  const c = structuredClone(s);
  fn(c);
  return c;
};
const game = (n = 3, settings = {}, seed = 7) => createGame({
  players: mkPlayers(n), seed, settings: { debug: true, auctionOnDecline: false, ...settings },
});
const ok = (res) => {
  expect(res.error).toBeUndefined();
  return res;
};
const act = (s, playerId, action) => ok(applyAction(s, { playerId, ...action }));
const close = (s) => ok(applyAction(s, { type: 'SNATCH_CLOSE' }));
const ofType = (events, type) => events.filter((e) => e.type === type);
const types = (events) => events.map((e) => e.type);
const totalCash = (s) => s.players.reduce((a, p) => a + p.cash, 0);
const START = DEFAULT_SETTINGS.startCash;

const TILE = 1; // Sultan Bazaar, price 60,000 (bazaar collection with tiles 3 and 4)
const PRICE = TILES[TILE].price;
const MIN_BID = 6000; // a tenth of the price: the same minimum as a skipped district

/** p0 rolls 1 from START onto Sultan Bazaar: phase 'buy'. */
const onTile = (n = 3, settings = {}, mutate = () => {}) => {
  const s = edit(game(n, settings), mutate);
  return ok(applyAction(s, { type: 'ROLL', playerId: 'p0', dice: [1] })).state;
};
/** The BUY result: the window is open (or not, when nobody else holds a button). */
const bought = (n = 3, settings = {}, mutate = () => {}) => act(onTile(n, settings, mutate), 'p0', { type: 'BUY' });
/** An open window; `pressers` have pressed (the window stays open as long as someone eligible has not pressed). */
const windowWith = (pressers = [], n = 3, settings = {}, mutate = () => {}) => {
  let s = bought(n, settings, mutate).state;
  expect(s.phase).toBe('snatch');
  for (const id of pressers) s = act(s, id, { type: 'SNATCH' }).state;
  return s;
};
const bid = (s, pid, amount) => act(s, pid, { type: 'BID', amount });
/** Put the next card of the Nawabi Luck deck on top. */
function stackLuck(s, cardId) {
  s.deck.luck = [LUCK_CARDS.findIndex((c) => c.id === cardId), ...s.deck.luck];
  s.deckPos.luck = 0;
}

// ---------------------------------------------------------------- settings and tokens
describe('snatch: tokens and settings', () => {
  it('every player starts with cfg.snatches buttons (default 1), public on the player', () => {
    const s = createGame({ players: mkPlayers(3), seed: 1 });
    expect(s.cfg).toMatchObject({ snatches: 1, snatchMs: 5000, snatchCardCap: 2 });
    expect(s.players.map((p) => p.snatches)).toEqual([1, 1, 1]);
    expect(s.players.map((p) => p.snatchCards)).toEqual([0, 0, 0]);
    const three = createGame({ players: mkPlayers(2), seed: 1, settings: { snatches: 3 } });
    expect(three.players.map((p) => p.snatches)).toEqual([3, 3]);
  });

  it('the host rules are clamped, never silently invented', () => {
    expect(normalizeSettings({ snatches: 9 }).snatches).toBe(3);
    expect(normalizeSettings({ snatches: -1 }).snatches).toBe(0);
    expect(normalizeSettings({ snatchCardCap: 7 }).snatchCardCap).toBe(2);
    expect(normalizeSettings({ snatchMs: 7000 }).snatchMs).toBe(7000);
    expect(normalizeSettings({ snatches: 'x' }).snatches).toBe(1);
    expect(normalizeSettings({}).snatchMs).toBe(5000);
  });

  it('a game without the cfg keys (stored before Snatch) falls back to the defaults and never throws', () => {
    const s = game(3);
    for (const k of ['snatches', 'snatchMs', 'snatchCardCap']) delete s.cfg[k];
    for (const p of s.players) delete p.snatches;
    const landed = ok(applyAction(s, { type: 'ROLL', playerId: 'p0', dice: [1] })).state;
    const r = act(landed, 'p0', { type: 'BUY' });
    expect(r.state.phase).toBe('manage'); // nobody holds a button: no window
  });
});

// ---------------------------------------------------------------- opening the window
describe('snatch: when a window opens', () => {
  it('opens after a landing BUY when another player holds a button: state, pending shape and events', () => {
    const r = bought();
    expect(r.state.phase).toBe('snatch');
    expect(r.state.owners[TILE]).toBe('p0'); // the buyer already owns it during the window
    expect(r.state.players[0].cash).toBe(START - PRICE);
    expect(r.state.pending).toEqual({
      type: 'snatch', tile: TILE, buyer: 'p0', price: PRICE, eligible: ['p1', 'p2'], claims: [], ms: 5000, returnPhase: 'manage',
    });
    expect(r.events).toEqual([
      { type: 'cash', player: 'p0', delta: -PRICE, reason: 'buy' },
      { type: 'own', tile: TILE, owner: 'p0', reason: 'buy' },
      { type: 'snatch_open', tile: TILE, buyer: 'p0', price: PRICE, eligible: ['p1', 'p2'], ms: 5000 },
    ]);
    expect(r.state.turn).toBe(0); // the buyer stays the turn player
  });

  it('uses cfg.snatchMs for the window length', () => {
    const r = bought(3, { snatchMs: 8000 });
    expect(r.state.pending.ms).toBe(8000);
    expect(ofType(r.events, 'snatch_open')[0].ms).toBe(8000);
  });

  it('snatches 0 switches the whole feature off: no window, no buttons', () => {
    const r = bought(3, { snatches: 0 });
    expect(r.state.phase).toBe('manage');
    expect(r.state.pending).toBeNull();
    expect(ofType(r.events, 'snatch_open')).toHaveLength(0);
    expect(types(r.events)).toEqual(['cash', 'own']);
    expect(r.state.players.map((p) => p.snatches)).toEqual([0, 0, 0]);
  });

  it('no window when everybody else is out of buttons; the buyer\'s own buttons do not count', () => {
    const none = bought(3, {}, (c) => { c.players[1].snatches = 0; c.players[2].snatches = 0; });
    expect(none.state.phase).toBe('manage');
    const own = bought(3, {}, (c) => { c.players[0].snatches = 3; c.players[1].snatches = 0; c.players[2].snatches = 0; });
    expect(own.state.phase).toBe('manage');
  });

  it('only players with a button are eligible; bankrupt players never are', () => {
    const some = bought(4, {}, (c) => { c.players[2].snatches = 0; });
    expect(some.state.pending.eligible).toEqual(['p1', 'p3']);
    expect(ofType(some.events, 'snatch_open')[0].eligible).toEqual(['p1', 'p3']);
    const bk = bought(4, {}, (c) => { c.players[1].bankrupt = true; c.players[1].cash = 0; c.players[1].snatches = 0; });
    expect(bk.state.pending.eligible).toEqual(['p2', 'p3']);
    expect(applyAction(bk.state, { type: 'SNATCH', playerId: 'p1' }).error).toBe('You are out of the game');
    const alone = bought(3, {}, (c) => { c.players[1].bankrupt = true; c.players[1].cash = 0; c.players[2].snatches = 0; });
    expect(alone.state.phase).toBe('manage');
  });

  it('does NOT open for auction wins (skipped district, Bazaar Auction), trades, or mortgages', () => {
    const landed = onTile(3, { auctionOnDecline: true });
    let a = act(landed, 'p0', { type: 'SKIP_BUY' }).state;
    expect(a.phase).toBe('auction');
    a = bid(a, 'p0', 0).state;
    a = bid(a, 'p1', MIN_BID + 1000).state;
    const done = bid(a, 'p2', 0);
    expect(done.state.phase).toBe('manage');
    expect(done.state.owners[TILE]).toBe('p1');
    expect(ofType(done.events, 'snatch_open')).toHaveLength(0);
    // a skipped district without auctions
    const skipped = act(onTile(), 'p0', { type: 'SKIP_BUY' });
    expect(skipped.state.phase).toBe('manage');
    expect(ofType(skipped.events, 'snatch_open')).toHaveLength(0);
    // a trade
    const t = edit(game(3), (c) => { c.owners[8] = 'p1'; });
    const offered = act(t, 'p0', { type: 'TRADE_OFFER', to: 'p1', give: { cash: 90000, tiles: [] }, get: { cash: 0, tiles: [8] } });
    const traded = act(offered.state, 'p1', { type: 'TRADE_ACCEPT' });
    expect(traded.state.phase).toBe('roll');
    expect(ofType(traded.events, 'snatch_open')).toHaveLength(0);
    // a mortgage
    const m = edit(game(3), (c) => { c.owners[8] = 'p0'; });
    expect(act(m, 'p0', { type: 'MORTGAGE', tile: 8 }).state.phase).toBe('roll');
  });

  it('a card that moves you onto a free district leaves a normal buy phase; BUY then opens the window', () => {
    const s = edit(game(3), (c) => stackLuck(c, 'metro_hitec')); // advance to HITEC City (31)
    const landed = ok(applyAction(s, { type: 'ROLL', playerId: 'p0', dice: [2] })).state; // tile 2 = Nawabi Luck
    expect(landed.phase).toBe('buy');
    expect(landed.pending).toMatchObject({ type: 'buy', tile: 31 });
    const b = act(landed, 'p0', { type: 'BUY' });
    expect(b.state.phase).toBe('snatch');
    expect(b.state.pending).toMatchObject({ tile: 31, price: TILES[31].price, eligible: ['p1', 'p2'] });
  });

  it('a six: the turn continues after the window (extra roll kept, set_complete held back until it closes)', () => {
    // rolling a six from START lands on Laad Bazaar (6); p0 already owns the rest of Old City Icons (7, 8)
    const six = ok(applyAction(edit(game(3), (c) => { c.owners[7] = 'p0'; c.owners[8] = 'p0'; }), { type: 'ROLL', playerId: 'p0', dice: [6] })).state;
    expect(six.extraRoll).toBe(true);
    const b = act(six, 'p0', { type: 'BUY' });
    expect(b.state.phase).toBe('snatch');
    expect(b.state.extraRoll).toBe(true);
    expect(ofType(b.events, 'set_complete')).toHaveLength(0); // waits for the window
    for (const who of ids.slice(0, 3)) {
      expect(getOptions(b.state, who)).toMatchObject({ roll: false, endTurn: false }); // nothing to do until it resolves
    }
    const r = close(b.state);
    expect(types(r.events)).toEqual(['snatch_end', 'set_complete']);
    expect(r.state.phase).toBe('manage');
    expect(r.state.extraRoll).toBe(true);
    expect(getOptions(r.state, 'p0')).toMatchObject({ roll: true, endTurn: false });
    expect(applyAction(r.state, { type: 'END_TURN', playerId: 'p0' }).error).toMatch(/six/);
    const again = act(r.state, 'p0', { type: 'ROLL', dice: [2] });
    expect(again.state.players[0].pos).toBe(8); // 6 + 2
  });

  it('after the window the buyer ends the turn normally and the next player rolls', () => {
    const r = close(windowWith());
    expect(getOptions(r.state, 'p0')).toMatchObject({ endTurn: true, roll: false });
    const next = act(r.state, 'p0', { type: 'END_TURN' });
    expect(next.state.turn).toBe(1);
    expect(next.state.phase).toBe('roll');
  });
});

// ---------------------------------------------------------------- options (the UI contract)
describe('snatch: getOptions', () => {
  it('eligible players see options.snatch; everybody else has nothing to do', () => {
    const s = windowWith([], 4, {}, (c) => { c.players[3].snatches = 0; });
    expect(getOptions(s, 'p1').snatch).toEqual({ tile: TILE, ms: 5000 });
    expect(getOptions(s, 'p2').snatch).toEqual({ tile: TILE, ms: 5000 });
    expect(getOptions(s, 'p1').snatched).toBeUndefined();
    for (const id of ['p0', 'p3']) {
      const o = getOptions(s, id);
      expect(o.snatch).toBeNull();
      expect(o.snatched).toBeUndefined();
    }
    for (const id of ids) {
      expect(getOptions(s, id)).toMatchObject({ roll: false, buy: false, skipBuy: false, endTurn: false, bid: null, payDebt: false, upgrade: [], mortgage: [], resign: true });
    }
  });

  it('after pressing the player gets options.snatched (locked in); the others still see the button', () => {
    const s = windowWith(['p1']);
    expect(getOptions(s, 'p1').snatch).toBeNull();
    expect(getOptions(s, 'p1').snatched).toBe(true);
    expect(getOptions(s, 'p2').snatch).toEqual({ tile: TILE, ms: 5000 });
    expect(getOptions(s, 'p2').snatched).toBeUndefined();
  });
});

// ---------------------------------------------------------------- one claimant
describe('snatch: a single presser takes the district for free', () => {
  it('a press is sealed (no event); the last eligible press resolves the window at once', () => {
    const only = windowWith([], 3, {}, (c) => { c.players[2].snatches = 0; }); // only p1 is eligible
    const r = act(only, 'p1', { type: 'SNATCH' });
    expect(r.state.phase).toBe('manage');
    expect(types(r.events)).toEqual(['snatch_end', 'own', 'snatch_token']);
    const two = windowWith(); // two eligible: pressing alone changes nothing visible
    const press = act(two, 'p1', { type: 'SNATCH' });
    expect(press.events).toEqual([]);
    expect(press.state.phase).toBe('snatch');
    expect(press.state.pending.claims).toEqual(['p1']);
  });

  it('SNATCH_CLOSE transfers the district, spends 1 button, and does NOT refund the buyer', () => {
    const s = windowWith(['p1']);
    const before = s.players.map((p) => p.cash);
    const r = close(s);
    expect(r.events).toEqual([
      { type: 'snatch_end', tile: TILE, buyer: 'p0', outcome: 'snatched', winner: 'p1', claimants: ['p1'] },
      { type: 'own', tile: TILE, owner: 'p1', reason: 'snatch' },
      { type: 'snatch_token', player: 'p1', snatches: 0 },
    ]);
    expect(r.state.owners[TILE]).toBe('p1');
    expect(r.state.players.map((p) => p.cash)).toEqual(before); // nobody's cash moved: free for the taker, not refunded to the buyer
    expect(r.state.players[0].cash).toBe(START - PRICE);
    expect(r.state.players[1].cash).toBe(START);
    expect(r.state.players.map((p) => p.snatches)).toEqual([1, 0, 1]);
    expect(r.state.phase).toBe('manage');
    expect(r.state.pending).toBeNull();
    expect(r.state.turn).toBe(0);
    expect(r.state.players[1].stats.propertiesBought).toBe(1);
    expect(totalCash(r.state)).toBe(totalCash(s));
    expect(r.state.levels[TILE]).toBe(0);
  });

  it('a spent button cannot be used again: the next purchase opens a window only for those who still hold one', () => {
    let s = close(windowWith(['p1'])).state; // p1 spent its button; p2 still has one
    const again = edit(s, (c) => { c.phase = 'buy'; c.pending = { type: 'buy', tile: 8, price: TILES[8].price }; c.players[0].pos = 8; });
    const r = act(again, 'p0', { type: 'BUY' });
    expect(r.state.pending.eligible).toEqual(['p2']);
  });

  it('the taker completing a collection gets set_complete at the close, the buyer does not', () => {
    // p1 already owns Sultan Bazaar's siblings (3 and 4)
    const buy = bought(3, {}, (c) => { c.owners[3] = 'p1'; c.owners[4] = 'p1'; });
    expect(ofType(buy.events, 'set_complete')).toHaveLength(0);
    const r = close(act(buy.state, 'p1', { type: 'SNATCH' }).state);
    expect(ofType(r.events, 'set_complete')).toEqual([{ type: 'set_complete', player: 'p1', group: 'bazaar' }]);
    expect(r.events.at(-1)).toEqual({ type: 'set_complete', player: 'p1', group: 'bazaar' });
  });
});

// ---------------------------------------------------------------- nobody pressed
describe('snatch: nobody presses', () => {
  it('the buyer keeps the district; no button is spent; the set celebration comes at the close', () => {
    const buy = bought(3, {}, (c) => { c.owners[3] = 'p0'; c.owners[4] = 'p0'; });
    expect(ofType(buy.events, 'set_complete')).toHaveLength(0);
    const r = close(buy.state);
    expect(r.events).toEqual([
      { type: 'snatch_end', tile: TILE, buyer: 'p0', outcome: 'none' },
      { type: 'set_complete', player: 'p0', group: 'bazaar' },
    ]);
    expect(r.state.owners[TILE]).toBe('p0');
    expect(r.state.players.map((p) => p.snatches)).toEqual([1, 1, 1]);
    expect(r.state.phase).toBe('manage');
    expect(r.state.pending).toBeNull();
  });

  it('SNATCH_CLOSE needs no playerId; a stray close is refused without touching the state', () => {
    const w = windowWith();
    expect(close(w).state.phase).toBe('manage');
    expect(applyAction(w, { type: 'SNATCH_CLOSE', playerId: 'p0' }).error).toBeUndefined();
    for (const s of [onTile(), game(), close(w).state, close(windowWith(['p1'])).state]) {
      const res = applyAction(s, { type: 'SNATCH_CLOSE' });
      expect(res.error).toBe('There is nothing to snatch');
      expect(res.state).toBe(s);
      expect(res.events).toEqual([]);
    }
    const bidding = windowWith(['p1', 'p2']);
    expect(bidding.phase).toBe('auction');
    expect(applyAction(bidding, { type: 'SNATCH_CLOSE' }).error).toBe('There is nothing to snatch');
    expect(applyAction(edit(w, (c) => { c.phase = 'over'; }), { type: 'SNATCH_CLOSE' }).error).toBe('The game is over');
  });
});

// ---------------------------------------------------------------- errors
describe('snatch: who may press, and when', () => {
  it('pressing twice errors', () => {
    const s = windowWith(['p1']);
    const res = applyAction(s, { type: 'SNATCH', playerId: 'p1' });
    expect(res.error).toBe('You already pressed Snatch');
    expect(res.state).toBe(s);
  });

  it('the buyer cannot snatch their own purchase; a player without a button cannot snatch', () => {
    expect(applyAction(windowWith(), { type: 'SNATCH', playerId: 'p0' }).error).toBe('You cannot snatch this one');
    const s = windowWith([], 3, {}, (c) => { c.players[2].snatches = 0; });
    expect(applyAction(s, { type: 'SNATCH', playerId: 'p2' }).error).toBe('You cannot snatch this one');
    expect(applyAction(s, { type: 'SNATCH', playerId: 'ghost' }).error).toBe('Unknown player');
  });

  it('SNATCH outside a window errors', () => {
    for (const s of [game(), onTile(), close(windowWith()).state, bought(3, { snatches: 0 }).state]) {
      expect(applyAction(s, { type: 'SNATCH', playerId: 'p1' }).error).toBe('There is nothing to snatch');
    }
  });

  it('every other action is refused with "Wait for the snatch window" (RESIGN excepted)', () => {
    const s = windowWith(['p1']);
    const actions = [
      { type: 'ROLL' }, { type: 'END_TURN' }, { type: 'BUY' }, { type: 'SKIP_BUY' }, { type: 'BID', amount: 10000 },
      { type: 'UPGRADE', tile: 3 }, { type: 'MORTGAGE', tile: TILE }, { type: 'UNMORTGAGE', tile: TILE }, { type: 'SELL_BUILDING', tile: TILE },
      { type: 'PAY_TRAFFIC' }, { type: 'USE_CHAI' }, { type: 'RIDE' }, { type: 'PAY_DEBT' },
      { type: 'TRADE_OFFER', to: 'p1', give: { cash: 10, tiles: [] }, get: { cash: 0, tiles: [] } },
      { type: 'TRADE_ACCEPT' }, { type: 'TRADE_REJECT' }, { type: 'TRADE_CANCEL' },
    ];
    for (const who of ids.slice(0, 3)) {
      for (const a of actions) {
        const res = applyAction(s, { ...a, playerId: who });
        expect(res.error, `${who} ${a.type}`).toBe('Wait for the snatch window');
        expect(res.state).toBe(s);
        expect(res.events).toEqual([]);
      }
    }
  });
});

// ---------------------------------------------------------------- sealed bidding
describe('snatch: two or more pressers go to sealed bidding among themselves', () => {
  it('two pressers (all eligible pressed): the window closes at once and bidding opens', () => {
    const r = act(windowWith(['p1']), 'p2', { type: 'SNATCH' });
    expect(r.state.phase).toBe('auction');
    expect(r.state.pending).toEqual({
      type: 'auction', tile: TILE, minBid: MIN_BID, bids: { p0: 0 }, reason: 'snatch', snatch: true, buyer: 'p0', claimants: ['p1', 'p2'], returnPhase: 'manage',
    });
    expect(r.events).toEqual([
      { type: 'snatch_end', tile: TILE, buyer: 'p0', outcome: 'bidding', claimants: ['p1', 'p2'] },
      { type: 'auction_start', tile: TILE, minBid: MIN_BID, reason: 'snatch', eligible: ['p1', 'p2'] },
    ]);
    expect(r.state.owners[TILE]).toBe('p0'); // still the buyer's until the bidding ends
    expect(r.state.players.map((p) => p.snatches)).toEqual([1, 1, 1]); // buttons are spent only by the winner
    expect(getOptions(r.state, 'p0').bid).toBeNull(); // the buyer never takes part
    expect(getOptions(r.state, 'p1').bid).toEqual({ tile: TILE, min: MIN_BID, max: START });
    expect(getOptions(r.state, 'p2').bid).toEqual({ tile: TILE, min: MIN_BID, max: START });
  });

  it('only the claimants bid: non-claimants and the buyer are auto-passed and cannot bid', () => {
    let s = windowWith(['p1', 'p2'], 4); // p3 holds a button but never pressed: the window is still open
    expect(s.phase).toBe('snatch');
    s = close(s).state;
    expect(s.phase).toBe('auction');
    expect(s.pending.bids).toEqual({ p0: 0, p3: 0 });
    expect(s.pending.claimants).toEqual(['p1', 'p2']);
    expect(getOptions(s, 'p3').bid).toBeNull();
    expect(applyAction(s, { type: 'BID', playerId: 'p3', amount: 20000 }).error).toMatch(/already/);
    expect(applyAction(s, { type: 'BID', playerId: 'p0', amount: 20000 }).error).toMatch(/already/);
    expect(applyAction(s, { type: 'BID', playerId: 'p1', amount: MIN_BID - 1000 }).error).toMatch(/minimum/);
    expect(applyAction(s, { type: 'BID', playerId: 'p1', amount: START + 1000 }).error).toMatch(/cash/);
  });

  it('the highest bid wins: pays the bank, gets the district, spends 1 button; the loser keeps its button; the buyer is not refunded', () => {
    let s = windowWith(['p1', 'p2']);
    const total = totalCash(s);
    s = bid(s, 'p1', 15000).state;
    expect(s.phase).toBe('auction'); // sealed: waits for p2
    const r = bid(s, 'p2', 40000);
    expect(r.events).toEqual([
      { type: 'auction_end', tile: TILE, winner: 'p2', amount: 40000, bids: { p0: 0, p1: 15000, p2: 40000 }, reason: 'snatch', buyer: 'p0' },
      { type: 'cash', player: 'p2', delta: -40000, reason: 'auction' },
      { type: 'own', tile: TILE, owner: 'p2', reason: 'auction' },
      { type: 'snatch_token', player: 'p2', snatches: 0 },
    ]);
    expect(r.state.owners[TILE]).toBe('p2');
    expect(r.state.players.map((p) => p.cash)).toEqual([START - PRICE, START, START - 40000]);
    expect(r.state.players.map((p) => p.snatches)).toEqual([1, 1, 0]); // the loser p1 keeps its button
    expect(totalCash(r.state)).toBe(total - 40000); // the bid goes to the bank
    expect(r.state.phase).toBe('manage');
    expect(r.state.pending).toBeNull();
    expect(r.state.turn).toBe(0);
  });

  it('a tie goes to the claimant who sits first after the buyer; the winner of a set-completing bid gets set_complete', () => {
    let s = windowWith(['p1', 'p2'], 3, {}, (c) => { c.owners[3] = 'p2'; c.owners[4] = 'p2'; });
    s = bid(s, 'p1', 20000).state;
    const r = bid(s, 'p2', 20000);
    expect(r.state.owners[TILE]).toBe('p1'); // earliest seat from the turn player
    const sets = windowWith(['p1', 'p2'], 3, {}, (c) => { c.owners[3] = 'p2'; c.owners[4] = 'p2'; });
    const done = bid(bid(sets, 'p1', 0).state, 'p2', 30000);
    expect(done.state.owners[TILE]).toBe('p2');
    expect(ofType(done.events, 'set_complete')).toEqual([{ type: 'set_complete', player: 'p2', group: 'bazaar' }]);
  });

  it('everybody passing leaves the district with the buyer: no button spent, buyer\'s set_complete comes now', () => {
    let s = windowWith(['p1', 'p2'], 3, {}, (c) => { c.owners[3] = 'p0'; c.owners[4] = 'p0'; });
    s = bid(s, 'p1', 0).state;
    const r = bid(s, 'p2', 0);
    expect(r.state.owners[TILE]).toBe('p0');
    expect(r.state.players.map((p) => p.snatches)).toEqual([1, 1, 1]);
    expect(r.events.map((e) => e.type)).toEqual(['auction_end', 'set_complete']);
    expect(r.events[0]).toMatchObject({ winner: null, amount: 0, reason: 'snatch', buyer: 'p0' });
    expect(r.events[1]).toEqual({ type: 'set_complete', player: 'p0', group: 'bazaar' });
    expect(r.state.phase).toBe('manage');
  });

  it('a claimant who cannot afford the minimum bid is auto-passed (and keeps the button)', () => {
    const s = windowWith(['p1', 'p2'], 3, {}, (c) => { c.players[1].cash = MIN_BID - 1000; });
    // p1 pressed but cannot bid: only p2 can, so the sealed bidding is about p2 alone
    expect(s.phase).toBe('auction');
    expect(s.pending.bids).toEqual({ p0: 0, p1: 0 });
    const r = bid(s, 'p2', 10000);
    expect(r.state.owners[TILE]).toBe('p2');
    expect(r.state.players.map((p) => p.snatches)).toEqual([1, 1, 0]);
  });

  it('three claimants bid for it; a claimant who passes with 0 is still named in pending.claimants', () => {
    let s = windowWith(['p1', 'p2', 'p3'], 4);
    expect(s.phase).toBe('auction');
    expect(s.pending.claimants).toEqual(['p1', 'p2', 'p3']);
    s = bid(s, 'p2', 0).state;
    expect(s.pending.claimants).toContain('p2');
    s = bid(s, 'p1', 70000).state;
    const r = bid(s, 'p3', 65000);
    expect(r.state.owners[TILE]).toBe('p1');
    expect(r.state.players.map((p) => p.snatches)).toEqual([1, 0, 1, 1]);
  });
});

// ---------------------------------------------------------------- resigning, bankruptcy, the end of the game
describe('snatch: resignations during the window', () => {
  it('a presser who resigns is removed; the window keeps running', () => {
    const s = windowWith(['p1'], 4);
    const r = act(s, 'p1', { type: 'RESIGN' });
    expect(r.state.phase).toBe('snatch');
    expect(r.state.pending.claims).toEqual([]);
    const closed = close(r.state);
    expect(ofType(closed.events, 'snatch_end')[0]).toMatchObject({ outcome: 'none' });
    expect(closed.state.owners[TILE]).toBe('p0');
  });

  it('when everyone who could still press has pressed after a resignation, it resolves at once', () => {
    const s = windowWith(['p1']); // p2 has not pressed yet
    const r = act(s, 'p2', { type: 'RESIGN' });
    expect(ofType(r.events, 'snatch_end')[0]).toMatchObject({ outcome: 'snatched', winner: 'p1' });
    expect(r.state.owners[TILE]).toBe('p1');
    expect(r.state.phase).toBe('manage');
  });

  it('a buyer who resigns loses the district to the bank at once; it can still be snatched for free at the close', () => {
    const s = windowWith(['p1'], 3);
    const resigned = act(s, 'p0', { type: 'RESIGN' });
    expect(resigned.state.phase).toBe('snatch'); // the window is not cut short and the turn does not move on yet
    expect(resigned.state.owners[TILE]).toBeNull();
    expect(resigned.state.turn).toBe(0);
    const r = close(resigned.state);
    expect(ofType(r.events, 'snatch_end')[0]).toMatchObject({ outcome: 'snatched', winner: 'p1' });
    expect(r.state.owners[TILE]).toBe('p1');
    expect(r.state.players[1].snatches).toBe(0);
    expect(r.state.turn).toBe(1); // the bankrupt buyer's turn ends once the window closes
    expect(r.state.phase).toBe('roll');
  });

  it('a buyer who resigns and a window nobody uses leave the district unowned', () => {
    const resigned = act(windowWith(), 'p0', { type: 'RESIGN' }).state;
    const r = close(resigned);
    expect(ofType(r.events, 'snatch_end')[0]).toMatchObject({ outcome: 'none' });
    expect(r.state.owners[TILE]).toBeNull();
    expect(r.state.turn).toBe(1);
    expect(ofType(r.events, 'set_complete')).toHaveLength(0);
  });

  it('a buyer who resigns mid-window with a six keeps nobody waiting: the turn passes on at the close', () => {
    const six = ok(applyAction(game(3), { type: 'ROLL', playerId: 'p0', dice: [6] })).state;
    const w = act(six, 'p0', { type: 'BUY' }).state;
    const r = close(act(w, 'p0', { type: 'RESIGN' }).state);
    expect(r.state.turn).toBe(1);
    expect(r.state.extraRoll).toBe(false);
  });

  it('a claimant who resigns before the close is dropped; the one who is left just takes the district', () => {
    const s = windowWith(['p1', 'p2'], 4); // p3 has not pressed
    const afterResign = act(s, 'p2', { type: 'RESIGN' }).state; // p2 leaves: claims [p1], p3 has not pressed
    const r = close(afterResign);
    expect(ofType(r.events, 'snatch_end')[0]).toMatchObject({ outcome: 'snatched', winner: 'p1' });
  });

  it('a claimant who resigns during the sealed bidding is passed; the bidding can then resolve', () => {
    let s = windowWith(['p1', 'p2']);
    s = bid(s, 'p1', 12000).state;
    const r = act(s, 'p2', { type: 'RESIGN' });
    expect(r.state.owners[TILE]).toBe('p1');
    expect(r.state.phase).toBe('manage');
    expect(ofType(r.events, 'auction_end')[0]).toMatchObject({ winner: 'p1', amount: 12000, reason: 'snatch' });
  });

  it('the only possible snatcher resigning ends the window; the last player standing wins at once', () => {
    const s = windowWith([], 2);
    expect(s.pending.eligible).toEqual(['p1']);
    const r = act(s, 'p1', { type: 'RESIGN' });
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe('p0');
    expect(r.state.winReason).toBe('last_standing');
    expect(r.state.pending).toBeNull();
  });

  it('a snatched district can lift the taker to the win target', () => {
    const s = windowWith(['p1'], 2, { targetWorth: 3000000 }, (c) => {
      c.players[1].cash = 3000000 - PRICE + 1000; // one rupee-thousand short of the target before the free district
    });
    expect(s.owners[TILE]).toBe('p1'); // the only eligible player pressed: the window resolved at once
    expect(s.phase).toBe('over');
    expect(s.winner).toBe('p1');
    expect(s.winReason).toBe('target');
  });
});

// ---------------------------------------------------------------- cards
describe('snatch: Nawabi Luck cards', () => {
  const draw = (cardId, mutate = () => {}, settings = {}) => {
    const s = edit(game(3, settings), (c) => { stackLuck(c, cardId); mutate(c); });
    return ok(applyAction(s, { type: 'ROLL', playerId: 'p0', dice: [2] })); // tile 2 is Nawabi Luck
  };

  it('the deck has 2-3 Snatch cards: one hook, one short sentence, effect snatch +1', () => {
    const cards = LUCK_CARDS.filter((c) => c.effect.type === 'snatch');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards.length).toBeLessThanOrEqual(3);
    for (const c of cards) {
      expect(c.effect).toEqual({ type: 'snatch', amount: 1 });
      expect(c.kind).toBe('good');
      expect(c.title.length).toBeLessThanOrEqual(40);
      expect(c.text.length).toBeLessThanOrEqual(110);
      expect(c.capText.length).toBeLessThanOrEqual(110);
      expect(c.capText).toContain('₹50,000');
    }
    expect(SNATCH_CAP_PAYOUT).toBe(50000);
    expect(DRAMA_CARDS.some((c) => c.effect.type === 'snatch')).toBe(false);
  });

  it('drawing one gives +1 button, counts against the card cap, and emits token_earned', () => {
    const r = draw('snatch_tip');
    expect(r.events.find((e) => e.type === 'card')).toMatchObject({ cardId: 'snatch_tip', deck: 'luck', kind: 'good' });
    expect(r.events.find((e) => e.type === 'card').capped).toBeUndefined();
    expect(ofType(r.events, 'token_earned')).toEqual([{ type: 'token_earned', player: 'p0', reason: 'card', snatches: 2 }]);
    expect(r.state.players[0]).toMatchObject({ snatches: 2, snatchCards: 1, cash: START });
  });

  it('at most cfg.snatchCardCap buttons come from cards over the whole game; at the cap the card pays 50,000 and says so', () => {
    const atCap = draw('snatch_haggle', (c) => { c.players[0].snatches = 0; c.players[0].snatchCards = 2; }); // spent them: still capped
    const card = atCap.events.find((e) => e.type === 'card');
    expect(card).toMatchObject({ cardId: 'snatch_haggle', capped: true });
    expect(card.text).toBe(LUCK_CARDS.find((c) => c.id === 'snatch_haggle').capText);
    expect(card.text).toContain('50,000');
    expect(ofType(atCap.events, 'token_earned')).toHaveLength(0);
    expect(atCap.events).toContainEqual({ type: 'cash', player: 'p0', delta: 50000, reason: 'card' });
    expect(atCap.state.players[0]).toMatchObject({ snatches: 0, snatchCards: 2, cash: START + 50000 });
  });

  it('a host cap of 1 or 0 is respected; with Snatch off or cap 0 the cards are not even in the deck', () => {
    const one = draw('snatch_broker', (c) => { c.players[0].snatchCards = 1; }, { snatchCardCap: 1 });
    expect(one.events.find((e) => e.type === 'card').capped).toBe(true);
    expect(one.state.players[0].cash).toBe(START + 50000);
    const idx = (s) => s.deck.luck.filter((i) => LUCK_CARDS[i].effect.type === 'snatch');
    expect(idx(createGame({ players: mkPlayers(3), seed: 3 }))).toHaveLength(3);
    expect(createGame({ players: mkPlayers(3), seed: 3 }).deck.luck).toHaveLength(LUCK_CARDS.length);
    for (const settings of [{ snatches: 0 }, { snatchCardCap: 0 }]) {
      const s = createGame({ players: mkPlayers(3), seed: 3, settings });
      expect(idx(s)).toHaveLength(0);
      expect(s.deck.luck).toHaveLength(LUCK_CARDS.length - 3);
      expect(s.deck.drama).toHaveLength(DRAMA_CARDS.length);
    }
  });

  it('a Snatch card that is stacked anyway pays out when Snatch is off, and never gives a button', () => {
    const r = draw('snatch_tip', () => {}, { snatches: 0 });
    expect(r.events.find((e) => e.type === 'card').capped).toBe(true);
    expect(r.state.players[0].snatches).toBe(0);
    expect(r.state.players[0].cash).toBe(START + 50000);
  });

  it('the reshuffle of an exhausted deck keeps the same composition', () => {
    const s = edit(game(3, { snatches: 0 }), (c) => { c.deckPos.luck = c.deck.luck.length; });
    const r = ok(applyAction(s, { type: 'ROLL', playerId: 'p0', dice: [2] }));
    expect(r.state.deck.luck).toHaveLength(LUCK_CARDS.length - 3);
    expect(r.state.deck.luck.some((i) => LUCK_CARDS[i].effect.type === 'snatch')).toBe(false);
  });

  it('a button won from a card is a real button: the window opens for it', () => {
    let s = draw('snatch_tip', (c) => { c.players[1].snatches = 0; c.players[2].snatches = 0; }).state; // p0 now holds 2
    s = edit(s, (c) => { // p1 buys; p0 is the only possible snatcher
      c.turn = 1; c.phase = 'buy'; c.pending = { type: 'buy', tile: 4, price: TILES[4].price }; c.players[1].pos = 4;
    });
    const b = act(s, 'p1', { type: 'BUY' });
    expect(b.state.phase).toBe('snatch');
    expect(b.state.pending.eligible).toEqual(['p0']);
  });
});

// ---------------------------------------------------------------- bots, auto-play, purity
describe('snatch: bots and auto-play', () => {
  it('auto-play and the normal bot chooser never snatch; the simulator asks botSnatchAction', () => {
    const w = windowWith();
    for (const id of ids.slice(0, 3)) expect(chooseBotAction(w, id)).toBeNull();
    expect(nextBotMove(w, () => 0.5)).toBeNull();
    expect(SNATCH_MIN_PRICE).toBeGreaterThan(0);
    const cheap = botSnatchAction(w, 'p1'); // a 60,000 district that completes nothing: not worth a press
    expect(cheap).toBeNull();
    const rich = edit(w, (c) => { c.pending.price = SNATCH_MIN_PRICE; });
    expect(botSnatchAction(rich, 'p1')).toEqual({ type: 'SNATCH', playerId: 'p1' });
    expect(botSnatchAction(rich, 'p0')).toBeNull(); // the buyer cannot press
    expect(botSnatchAction(game(), 'p1')).toBeNull(); // no window
    // a bot playing the whole window out through the engine
    const pressed = act(rich, 'p1', botSnatchAction(rich, 'p1'));
    expect(pressed.state.pending.claims).toEqual(['p1']);
  });

  it('never mutates the state it is given; the same inputs give the same events', () => {
    const s = windowWith(['p1', 'p2']);
    const copy = structuredClone(s);
    const a = bid(s, 'p1', 9000);
    expect(s).toEqual(copy);
    expect(bid(s, 'p1', 9000)).toEqual(a);
  });

  it('a full bot game with Snatch on always terminates and keeps the button invariants', () => {
    for (const [n, seed, settings] of [[2, 1, {}], [4, 2, { snatches: 3 }], [6, 3, { snatchCardCap: 1 }], [3, 4, { snatches: 0 }]]) {
      let s = createGame({ players: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `B${i}`, isBot: true })), seed, settings });
      const rnd = mulberry32(seed);
      let snatched = 0;
      for (let step = 0; step < 40000 && s.phase !== 'over'; step++) {
        let a = null;
        if (s.phase === 'snatch') {
          a = s.pending.eligible.filter((id) => !s.pending.claims.includes(id)).map((id) => botSnatchAction(s, id)).find(Boolean) || { type: 'SNATCH_CLOSE' };
        } else a = nextBotMove(s, rnd);
        const r = applyAction(s, a);
        if (r.error) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
        snatched += r.events.filter((e) => e.type === 'snatch_end' && e.outcome !== 'none').length;
        s = r.state;
        for (const p of s.players) {
          expect(p.snatches).toBeGreaterThanOrEqual(0);
          expect(p.snatches).toBeLessThanOrEqual(s.cfg.snatches + s.cfg.snatchCardCap);
          expect(p.snatchCards).toBeLessThanOrEqual(s.cfg.snatchCardCap);
        }
      }
      expect(s.phase, `${n} players ${JSON.stringify(settings)}`).toBe('over');
      if (settings.snatches === 0) expect(snatched).toBe(0);
    }
  });
});

describe('formatINR sanity for the card copy', () => {
  it('prints the payout the way the cards do', () => {
    expect(formatINR(SNATCH_CAP_PAYOUT)).toBe('₹50,000');
  });
});
