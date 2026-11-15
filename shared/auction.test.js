// Sealed auctions (docs/GAME_RULES.md section 6): who is eligible, the public `bidIn` list, the window close
// (AUCTION_CLOSE, server-only), the seeded tie draw, the extended `auction_end` event, resigning mid-auction,
// Snatch bidding and the `auctionSeconds` host rule. The room timer itself is covered in worker/auction.test.js.
// An auction only starts at the Bazaar Auction corner or after two Snatch presses: passing a district never opens one
// (see `passing never starts an auction` below and shared/noAuctionOnPass.test.js).
import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, getOptions, normalizeSettings, DEFAULT_SETTINGS, TILES, BOARD_SIZE, isBuyable,
} from './index.js';
import { auctionMsOf, snatchBidMsOf, AUCTION_MS } from './timing.js';

const ids = ['a', 'b', 'c', 'd'];
const edit = (s, fn) => {
  const c = structuredClone(s);
  fn(c);
  return c;
};
const ok = (r) => {
  expect(r.error).toBeUndefined();
  return r;
};
const act = (s, action) => ok(applyAction(s, action));
const bid = (s, playerId, amount) => act(s, { type: 'BID', playerId, amount });
const close = (s) => act(s, { type: 'AUCTION_CLOSE' });
const end = (r) => r.events.find((e) => e.type === 'auction_end');
const TILE = 1; // Sultan Bazaar, price 60,000, minimum bid 6,000 (a tenth)
const PRICE = TILES[TILE].price;
const MIN = 6000;

const game = (n = 3, settings = {}, seed = 7, mutate = () => {}) =>
  edit(createGame({ players: ids.slice(0, n).map((id) => ({ id, name: id.toUpperCase() })), seed, settings: { debug: true, snatches: 0, ...settings } }), mutate);
/**
 * `a` lands on the Bazaar Auction corner while Sultan Bazaar is the only free district: a real sealed auction (reason
 * 'bazaar', minimum bid 50% of the price) is open. `lowMin` (default) then lowers `pending.minBid` to a tenth of the price
 * so the small bids in these tests stay legal; the engine only ever reads `pending.minBid` afterwards.
 */
function bazaarOf(n = 3, settings = {}, seed = 7, mutate = () => {}, lowMin = true) {
  const s = game(n, settings, seed, (c) => {
    c.players[0].pos = 31; // one step before the corner (tile 32)
    for (let i = 0; i < BOARD_SIZE; i++) if (isBuyable(TILES[i]) && i !== TILE) c.owners[i] = '_city'; // owned by nobody at the table: no net-worth win, no rent
    mutate(c);
  });
  const r = act(s, { type: 'ROLL', playerId: 'a', dice: [1] });
  if (!lowMin) return r;
  expect(r.state.phase).toBe('auction');
  return { ...r, state: edit(r.state, (c) => { c.pending.minBid = MIN; }) };
}
const auctionOf = (n, settings, seed, mutate) => bazaarOf(n, settings, seed, mutate);

describe('auction: the state everybody sees', () => {
  it('opens with an id, the public bidIn list (empty), who may bid and the window in ms', () => {
    const r = bazaarOf(3, {}, 7, () => {}, false);
    expect(r.state.phase).toBe('auction');
    expect(r.state.pending).toEqual({
      type: 'auction', id: 1, tile: TILE, minBid: PRICE / 2, bids: {}, bidIn: [], eligible: ['a', 'b', 'c'], ms: 20000, reason: 'bazaar', returnPhase: 'manage',
    });
    expect(r.events.at(-1)).toEqual({ type: 'auction_start', tile: TILE, minBid: PRICE / 2, reason: 'bazaar', eligible: ['a', 'b', 'c'], ms: 20000 });
  });

  it('bidIn grows with every submitted bid (amounts stay in bids, bidIn never holds an amount)', () => {
    let s = auctionOf().state;
    s = bid(s, 'b', 30000).state;
    expect(s.pending.bidIn).toEqual(['b']);
    s = bid(s, 'a', 0).state; // a pass is a submitted bid too
    expect(s.pending.bidIn).toEqual(['b', 'a']);
    expect(s.pending.eligible).toEqual(['a', 'b', 'c']); // does not shrink
    expect(s.pending.bids).toEqual({ b: 30000, a: 0 });
  });

  it('players who cannot afford the minimum are passed at once: not eligible, not in bidIn, bid 0', () => {
    const s = auctionOf(3, {}, 7, (c) => { c.players[2].cash = MIN - 1000; }).state;
    expect(s.pending.eligible).toEqual(['a', 'b']);
    expect(s.pending.bids).toEqual({ c: 0 });
    expect(s.pending.bidIn).toEqual([]);
    expect(applyAction(s, { type: 'BID', playerId: 'c', amount: MIN }).error).toMatch(/already/);
  });

  it('a second auction gets a new id (the room keys its timer on it)', () => {
    let r = auctionOf();
    r = act(r.state, { type: 'AUCTION_CLOSE' });
    expect(r.state.auctionSeq).toBe(1);
    expect(r.state.pending).toBeNull();
    const again = auctionOf(3, {}, 7, (c) => { c.auctionSeq = 4; });
    expect(again.state.pending.id).toBe(5);
  });
});

describe('auction: resolution', () => {
  it('the highest bid wins and pays its own bid; auction_end carries order, tie, saved and the sealed bids', () => {
    let s = auctionOf().state;
    s = bid(s, 'c', 30000).state;
    s = bid(s, 'a', 0).state;
    const cash = s.players.find((p) => p.id === 'b').cash;
    const r = bid(s, 'b', 40000);
    expect(end(r)).toEqual({
      type: 'auction_end', tile: TILE, winner: 'b', amount: 40000, bids: { a: 0, b: 40000, c: 30000 }, order: ['b', 'c', 'a'], tie: false,
      reason: 'bazaar', saved: PRICE - 40000,
    });
    expect(r.state.owners[TILE]).toBe('b');
    expect(r.state.players.find((p) => p.id === 'b').cash).toBe(cash - 40000); // first price: they pay their own bid
    expect(r.state.pending).toBeNull();
    expect(r.state.phase).toBe('manage');
  });

  it('saved is only there when positive (a bid at or above the price saves nothing)', () => {
    const at = bid(bid(bid(auctionOf().state, 'a', 0).state, 'c', 0).state, 'b', PRICE);
    expect(end(at)).toMatchObject({ winner: 'b', amount: PRICE });
    expect('saved' in end(at)).toBe(false);
    const over = bid(bid(bid(auctionOf().state, 'a', 0).state, 'c', 0).state, 'b', PRICE + 5000);
    expect('saved' in end(over)).toBe(false);
  });

  it('a tie for the top bid is drawn with the seeded rng among the tied bidders, flagged tie, the winner first in order', () => {
    const run = (seed) => {
      let s = auctionOf(3, {}, seed).state;
      s = bid(s, 'a', 20000).state;
      s = bid(s, 'c', 0).state;
      return bid(s, 'b', 20000);
    };
    const winners = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const r = run(seed);
      const e = end(r);
      expect(e).toMatchObject({ tie: true, amount: 20000 });
      expect(['a', 'b']).toContain(e.winner);
      expect(e.order).toEqual([e.winner, e.winner === 'a' ? 'b' : 'a', 'c']);
      expect(r.state.owners[TILE]).toBe(e.winner);
      expect(end(run(seed)).winner).toBe(e.winner); // same seed, same draw
      winners.add(e.winner);
    }
    expect(winners.size).toBe(2); // not always the lander
  });

  it('only the top bids tie: a tie below the winner is not a tie', () => {
    let s = auctionOf(4).state;
    s = bid(s, 'a', 10000).state;
    s = bid(s, 'b', 10000).state;
    s = bid(s, 'c', 25000).state;
    const r = bid(s, 'd', 0);
    expect(end(r)).toMatchObject({ winner: 'c', tie: false });
    expect(end(r).order).toEqual(['c', 'a', 'b', 'd']); // the equal losers keep seat order from the turn player
  });

  it('nobody bids: the district stays unowned and auction_end says so (winner null, amount 0, order = the passers)', () => {
    let s = auctionOf().state;
    s = bid(s, 'a', 0).state;
    s = bid(s, 'b', 0).state;
    const r = bid(s, 'c', 0);
    expect(end(r)).toMatchObject({ winner: null, amount: 0, tie: false, order: ['a', 'b', 'c'], bids: { a: 0, b: 0, c: 0 } });
    expect('saved' in end(r)).toBe(false);
    expect(r.state.owners[TILE]).toBeNull();
    expect(r.state.phase).toBe('manage');
  });

  it('every player bids: the auction resolves at once (no waiting for the window)', () => {
    let s = auctionOf().state;
    s = bid(s, 'a', 7000).state;
    s = bid(s, 'b', 8000).state;
    expect(s.phase).toBe('auction');
    const r = bid(s, 'c', 9000);
    expect(r.state.phase).toBe('manage');
    expect(end(r).winner).toBe('c');
  });

  it('nobody can afford the minimum: the auction ends in the same action, no pending, nothing to time', () => {
    const r = auctionOf(3, {}, 7, (c) => { for (const p of c.players) p.cash = 35000; });
    expect(r.state.phase).toBe('auction'); // the Bazaar minimum (half of 60,000) is within reach
    const broke = bazaarOf(3, {}, 7, (c) => { for (const p of c.players) p.cash = 29000; }, false);
    expect(broke.state.phase).toBe('manage');
    expect(broke.state.pending).toBeNull();
    expect(broke.events.map((e) => e.type)).toContain('auction_end');
    expect(end(broke)).toMatchObject({ winner: null, order: [] });
    expect(broke.state.owners[TILE]).toBeNull();
  });

  it('the winner is validated at BID time: more than their cash is refused, and nobody pays mid-auction', () => {
    const s = auctionOf().state;
    const cash = s.players[1].cash;
    expect(applyAction(s, { type: 'BID', playerId: 'b', amount: cash + 1000 }).error).toMatch(/cash/);
    expect(applyAction(s, { type: 'BID', playerId: 'b', amount: MIN - 1000 }).error).toMatch(/minimum/);
    expect(applyAction(s, { type: 'BID', playerId: 'b', amount: -5 }).error).toMatch(/Invalid/);
    const after = bid(s, 'b', cash).state;
    expect(after.players[1].cash).toBe(cash); // nothing is paid before the auction ends
    expect(applyAction(after, { type: 'BID', playerId: 'b', amount: MIN }).error).toMatch(/already/);
  });
});

describe('auction: the window closes (AUCTION_CLOSE, server-only)', () => {
  it('passes everyone who has not bid, resolves, and names them in auction_end.timedOut', () => {
    let s = auctionOf(4).state;
    s = bid(s, 'c', 20000).state;
    const r = close(s);
    expect(end(r)).toMatchObject({ winner: 'c', amount: 20000, timedOut: ['a', 'b', 'd'], bids: { a: 0, b: 0, c: 20000, d: 0 }, order: ['c', 'a', 'b', 'd'] });
    expect(r.state.phase).toBe('manage');
    expect(r.state.pending).toBeNull();
  });

  it('with no bid at all the district stays unowned; the extra roll after a six still continues', () => {
    // a six from tile 26 lands on the Bazaar Auction corner (32): Sultan Bazaar is the only free district
    let r = act(
      game(3, {}, 7, (c) => { c.players[0].pos = 26; for (let i = 0; i < BOARD_SIZE; i++) if (isBuyable(TILES[i]) && i !== TILE) c.owners[i] = '_city'; }),
      { type: 'ROLL', playerId: 'a', dice: [6] },
    );
    expect(r.state.phase).toBe('auction');
    r = close(r.state);
    expect(end(r)).toMatchObject({ winner: null, timedOut: ['a', 'b', 'c'] });
    expect(r.state.owners[TILE]).toBeNull();
    expect(r.state.phase).toBe('manage');
    expect(r.state.extraRoll).toBe(true);
    expect(applyAction(r.state, { type: 'ROLL', playerId: 'a', dice: [2] }).error).toBeUndefined();
    expect(applyAction(r.state, { type: 'END_TURN', playerId: 'a' }).error).toMatch(/six/);
  });

  it('is refused with no auction open (a stale timer cannot do anything twice)', () => {
    const s = auctionOf().state;
    const done = close(s).state;
    expect(applyAction(done, { type: 'AUCTION_CLOSE' }).error).toBe('There is no auction right now');
    expect(applyAction(game(), { type: 'AUCTION_CLOSE' }).error).toBe('There is no auction right now');
    expect(applyAction(done, { type: 'AUCTION_CLOSE' }).state).toBe(done);
  });

  it('does not lose a bid that came in just before it', () => {
    let s = auctionOf().state;
    s = bid(s, 'b', 12000).state;
    s = bid(s, 'c', 13000).state;
    expect(end(close(s))).toMatchObject({ winner: 'c', amount: 13000, timedOut: ['a'] });
  });
});

describe('auction: resigning in the middle', () => {
  it('a resigning bidder passes (bid 0, bidIn updated) and the others still get their window', () => {
    let s = auctionOf(4).state;
    s = bid(s, 'a', 9000).state;
    const r = act(s, { type: 'RESIGN', playerId: 'c' });
    expect(r.state.phase).toBe('auction');
    expect(r.state.pending.bids.c).toBe(0);
    expect(r.state.pending.bidIn).toEqual(['a', 'c']);
    const done = bid(bid(r.state, 'b', 11000).state, 'd', 0);
    expect(end(done)).toMatchObject({ winner: 'b', amount: 11000 });
  });

  it('the last open bidder resigning resolves the auction at once', () => {
    let s = auctionOf(3).state;
    s = bid(s, 'a', 8000).state;
    s = bid(s, 'b', 9000).state;
    const r = act(s, { type: 'RESIGN', playerId: 'c' });
    expect(end(r)).toMatchObject({ winner: 'b', amount: 9000 });
    expect(r.state.pending).toBeNull();
  });

  it('a resigned player who had bid never wins (their bid is void)', () => {
    let s = auctionOf(4).state;
    s = bid(s, 'c', 50000).state;
    s = bid(s, 'a', 7000).state;
    s = act(s, { type: 'RESIGN', playerId: 'c' }).state;
    const r = bid(bid(s, 'b', 0).state, 'd', 0);
    expect(end(r)).toMatchObject({ winner: 'a', amount: 7000 });
  });

  it('the resigning lander (the turn player) mid-auction: the auction still ends and the turn moves on', () => {
    let s = auctionOf(3).state;
    s = bid(s, 'b', 9000).state;
    const r = act(s, { type: 'RESIGN', playerId: 'a' });
    expect(r.state.phase).toBe('auction'); // c has not bid
    const done = act(r.state, { type: 'AUCTION_CLOSE' });
    expect(end(done)).toMatchObject({ winner: 'b', amount: 9000 });
    expect(done.state.phase).toBe('roll');
    expect(done.state.players[done.state.turn].id).not.toBe('a');
  });

  it('the second-to-last player resigning ends the game even mid-auction, and the auction resolves first', () => {
    let s = auctionOf(2).state;
    s = bid(s, 'b', 9000).state;
    const r = act(s, { type: 'RESIGN', playerId: 'a' });
    expect(r.state.phase).toBe('over');
    expect(end(r)).toMatchObject({ winner: 'b' });
  });
});

describe('auction: bidding among Snatch claimants', () => {
  /** p0 buys Sultan Bazaar, p1 and p2 snatch: sealed bidding between them, buyer and p3 sit out. */
  function bidding(settings = {}, mutate = () => {}) {
    let s = edit(
      createGame({ players: ['p0', 'p1', 'p2', 'p3'].map((id) => ({ id, name: id })), seed: 7, settings: { debug: true, ...settings } }),
      mutate,
    );
    s = act(s, { type: 'ROLL', playerId: 'p0', dice: [1] }).state;
    s = act(s, { type: 'BUY', playerId: 'p0' }).state;
    s = act(s, { type: 'SNATCH', playerId: 'p1' }).state;
    s = act(s, { type: 'SNATCH', playerId: 'p2' }).state;
    s = act(s, { type: 'SNATCH_CLOSE' }).state;
    return s;
  }

  it('eligible = the claimants; bidIn counts them; the window is min(auctionSeconds, 15 s)', () => {
    const s = bidding();
    expect(s.phase).toBe('auction');
    expect(s.pending).toMatchObject({ snatch: true, buyer: 'p0', claimants: ['p1', 'p2'], eligible: ['p1', 'p2'], bidIn: [], ms: 15000 });
    expect(s.pending.bids).toEqual({ p0: 0, p3: 0 });
    expect(bidding({ auctionSeconds: 10 }).pending.ms).toBe(10000);
    expect(bidding({ auctionSeconds: 60 }).pending.ms).toBe(15000);
  });

  it('AUCTION_CLOSE passes the claimants who have not bid; the buyer keeps the district when everybody passes', () => {
    let s = bidding();
    s = bid(s, 'p1', 20000).state;
    expect(s.pending.bidIn).toEqual(['p1']);
    const r = close(s);
    expect(end(r)).toMatchObject({ winner: 'p1', amount: 20000, buyer: 'p0', timedOut: ['p2'], reason: 'snatch', order: ['p1', 'p2'] });
    const none = close(bidding());
    expect(end(none)).toMatchObject({ winner: null, timedOut: ['p1', 'p2'], buyer: 'p0' });
    expect(none.state.owners[TILE]).toBe('p0');
  });

  it('a claimant who cannot afford the minimum is not eligible; the lone eligible one bids alone', () => {
    const s = bidding({}, (c) => { c.players[1].cash = MIN - 1000; });
    expect(s.pending.claimants).toEqual(['p1', 'p2']); // p1 pressed ...
    expect(s.pending.eligible).toEqual(['p2']); // ... but cannot bid
    expect(s.pending.bids).toEqual({ p0: 0, p1: 0, p3: 0 });
    const r = bid(s, 'p2', MIN);
    expect(end(r)).toMatchObject({ winner: 'p2', amount: MIN, order: ['p2'] });
  });
});

describe('auction: the host rule auctionSeconds', () => {
  it('is a normal host rule: default 20, clamped by the engine, carried in cfg', () => {
    expect(DEFAULT_SETTINGS.auctionSeconds).toBe(20);
    expect(createGame({ players: [{ id: 'a' }, { id: 'b' }], seed: 1 }).cfg.auctionSeconds).toBe(20);
    expect(normalizeSettings({ auctionSeconds: 45 }).auctionSeconds).toBe(45);
    expect(normalizeSettings({ auctionSeconds: 'soon' }).auctionSeconds).toBe(20);
    expect(normalizeSettings({ auctionSeconds: 100000 }).auctionSeconds).toBe(600); // the engine's wide clamp; the server enforces 10-90
    expect(normalizeSettings({ auctionSeconds: -3 }).auctionSeconds).toBe(1);
  });

  it('feeds the pending window (ms), the event and the helpers', () => {
    const r = auctionOf(3, { auctionSeconds: 35 });
    expect(r.state.pending.ms).toBe(35000);
    expect(r.events.at(-1)).toMatchObject({ type: 'auction_start', ms: 35000 });
    expect(auctionMsOf({ auctionSeconds: 35 })).toBe(35000);
    expect(auctionMsOf({})).toBe(AUCTION_MS);
    expect(auctionMsOf(null)).toBe(20000);
    expect(snatchBidMsOf({ auctionSeconds: 90 })).toBe(15000);
    expect(snatchBidMsOf({ auctionSeconds: 10 })).toBe(10000);
  });
});

describe('auction: states stored before this version', () => {
  it('a pending auction without id / bidIn / eligible / ms still takes bids, closes, and resolves', () => {
    let s = auctionOf().state;
    delete s.pending.id;
    delete s.pending.bidIn;
    delete s.pending.eligible;
    delete s.pending.ms;
    s = bid(s, 'b', 15000).state;
    expect(s.pending.bidIn).toEqual(['b']);
    const r = close(s);
    expect(end(r)).toMatchObject({ winner: 'b', amount: 15000, timedOut: ['a', 'c'] });
    expect(end(r).order).toEqual(['b', 'a', 'c']);
  });

  it('getOptions still offers the bid range', () => {
    const s = auctionOf().state;
    expect(getOptions(s, 'b').bid).toEqual({ tile: TILE, min: MIN, max: s.players[1].cash });
    expect(getOptions(bid(s, 'b', 8000).state, 'b').bid).toBeNull();
  });
});
