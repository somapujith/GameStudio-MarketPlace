// How bots (and the auto-play of an idle human) bid in a sealed auction (shared/bots.js auctionBid).
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, chooseBotAction, nextBotMove, auctionBid, AUCTION_VALUE, AUCTION_VARIATION, DEFAULT_BOT, TILES, mulberry32 } from './index.js';

const TILE = 1; // Sultan Bazaar: price 60,000, collection bazaar = tiles 1, 3, 4
const PRICE = TILES[TILE].price;
const edit = (s, fn) => {
  const c = structuredClone(s);
  fn(c);
  return c;
};

/**
 * An open sealed auction on `TILE` among n bots; `mutate` sets owners / cash first. Passing a district never starts one, so
 * it is Snatch bidding: p0 buys the tile, every other player presses Snatch (the last press closes the window; the minimum bid is 10%).
 */
function auction({ n = 3, isBot = true, mutate = () => {}, seed = 3 } = {}) {
  let s = createGame({
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot })),
    seed, settings: { debug: true, snatches: 1 },
  });
  s = edit(s, mutate);
  s = applyAction(s, { type: 'ROLL', playerId: 'p0', dice: [1] }).state;
  s = applyAction(s, { type: 'BUY', playerId: 'p0' }).state;
  for (let i = 1; i < n; i++) s = applyAction(s, { type: 'SNATCH', playerId: `p${i}` }).state;
  expect(s.phase).toBe('auction');
  return s;
}
const mid = () => 0.5;
const bidOf = (s, id, rnd = mid) => auctionBid(s, s.players.find((p) => p.id === id), rnd);
const margin = DEFAULT_BOT.reserve / 2;

describe('bots: sealed bids', () => {
  it('values a plain district at a bit under its price, rounded to a thousand', () => {
    const s = auction();
    const b = bidOf(s, 'p1');
    expect(b).toBe(Math.floor((PRICE * AUCTION_VALUE.base) / 1000) * 1000);
    expect(b % 1000).toBe(0);
    expect(b).toBeGreaterThanOrEqual(s.pending.minBid);
  });

  it('pays a big premium to complete its own collection, a smaller one to block a rival, a little to extend', () => {
    const plain = bidOf(auction(), 'p1');
    const extends_ = bidOf(auction({ mutate: (c) => { c.owners[3] = 'p1'; } }), 'p1'); // owns 1 of the other 2, nobody blocks
    const blocks = bidOf(auction({ mutate: (c) => { c.owners[3] = 'p2'; c.owners[4] = 'p2'; } }), 'p1'); // p2 holds the rest
    const completes = bidOf(auction({ mutate: (c) => { c.owners[3] = 'p1'; c.owners[4] = 'p1'; } }), 'p1');
    expect(extends_).toBeGreaterThan(plain);
    expect(blocks).toBeGreaterThan(extends_);
    expect(completes).toBeGreaterThan(blocks);
    expect(completes).toBe(Math.floor((PRICE * AUCTION_VALUE.completes) / 1000) * 1000);
    expect(blocks).toBe(Math.floor((PRICE * AUCTION_VALUE.blocks) / 1000) * 1000);
  });

  it('does not block against itself: the owner of the rest is not a rival', () => {
    const own = bidOf(auction({ mutate: (c) => { c.owners[3] = 'p1'; c.owners[4] = 'p1'; } }), 'p1');
    expect(own).toBe(Math.floor((PRICE * AUCTION_VALUE.completes) / 1000) * 1000);
  });

  it('never bids more than cash minus the safety margin, whatever the district is worth to it', () => {
    for (const cash of [0, 5000, 6000, 20000, 40000, 66000, 80000, 150000, 1500000]) {
      for (const owner of [null, 'p1', 'p2']) {
        const s = auction({ mutate: (c) => { c.owners[3] = owner; c.owners[4] = owner; c.players[1].cash = Math.max(cash, 6000); } });
        const p = s.players[1];
        p.cash = cash; // after the auction opened: whatever the cash, the bot must stay sane
        for (const r of [0, 0.5, 0.999999, 1]) {
          const b = auctionBid(s, p, () => r);
          expect(Number.isInteger(b)).toBe(true);
          if (b > 0) {
            expect(b).toBeLessThanOrEqual(cash - margin);
            expect(b).toBeGreaterThanOrEqual(s.pending.minBid);
          }
        }
      }
    }
  });

  it('passes (0) when it cannot afford the minimum and still keep the margin', () => {
    const s = auction();
    const p = edit(s, (c) => { c.players[1].cash = s.pending.minBid + margin - 1000; }).players[1];
    expect(auctionBid(s, p, mid)).toBe(0);
    const q = edit(s, (c) => { c.players[1].cash = s.pending.minBid + margin; }).players[1];
    expect(auctionBid(s, q, mid)).toBe(s.pending.minBid);
  });

  it('is deterministic for a given rng and varies with it (bots do not all bid the same number)', () => {
    const s = auction();
    const a = () => mulberry32(42);
    const first = [bidOf(s, 'p1', a()), bidOf(s, 'p1', a()), bidOf(s, 'p1', a())];
    expect(new Set(first).size).toBe(1);
    const rnd = mulberry32(9);
    const spread = new Set(Array.from({ length: 30 }, () => bidOf(s, 'p1', rnd)));
    expect(spread.size).toBeGreaterThan(5);
    const lo = bidOf(s, 'p1', () => 0);
    const hi = bidOf(s, 'p1', () => 0.999999);
    expect(lo).toBe(Math.floor((PRICE * AUCTION_VALUE.base * (1 - AUCTION_VARIATION)) / 1000) * 1000);
    expect(hi).toBeLessThanOrEqual(Math.floor((PRICE * AUCTION_VALUE.base * (1 + AUCTION_VARIATION)) / 1000) * 1000);
    expect(hi).toBeGreaterThan(lo);
  });

  it('the greedy bot bids higher than the careful one', () => {
    const s = auction();
    const careful = { ...s.players[1], bot: { reserve: 150000, greed: 0.7 } };
    const greedy = { ...s.players[1], bot: { reserve: 150000, greed: 1.4 } };
    expect(auctionBid(s, greedy, mid)).toBeGreaterThan(auctionBid(s, careful, mid));
  });

  it('never throws on rubbish and passes', () => {
    const s = auction();
    const p = s.players[1];
    expect(auctionBid(null, p, mid)).toBe(0);
    expect(auctionBid({}, p, mid)).toBe(0);
    expect(auctionBid(s, null, mid)).toBe(0);
    expect(auctionBid(edit(s, (c) => { c.pending.tile = 999; }), p, mid)).toBe(0);
    expect(auctionBid(s, { ...p, cash: NaN }, mid)).toBe(0);
    expect(auctionBid(s, { ...p, bot: { reserve: 'x', greed: null } }, mid)).toBeGreaterThanOrEqual(0);
    expect(auctionBid(s, p, () => NaN)).toBeGreaterThan(0);
    expect(auctionBid(s, p, undefined)).toBeGreaterThanOrEqual(0);
    expect(auctionBid(s, p, () => { throw new Error('boom'); })).toBe(0);
  });
});

describe('bots: the move chooser in an auction', () => {
  it('a simulator bot places a legal sealed bid that applyAction accepts', () => {
    let s = auction({ n: 4 });
    const rnd = mulberry32(5);
    for (let i = 0; i < 4 && s.phase === 'auction'; i++) {
      const a = nextBotMove(s, rnd);
      expect(a.type).toBe('BID');
      const r = applyAction(s, a);
      expect(r.error).toBeUndefined();
      s = r.state;
    }
    expect(s.phase).toBe('manage');
  });

  it('the auto-play of an idle HUMAN seat passes (0), never bids', () => {
    const s = auction({ isBot: false });
    for (const p of s.players) {
      // the buyer sits out the Snatch bidding (already passed): nothing to do for them
      if (!s.pending.eligible.includes(p.id)) expect(chooseBotAction(s, p.id, mid)).toBeNull();
      else expect(chooseBotAction(s, p.id, mid)).toEqual({ type: 'BID', playerId: p.id, amount: 0 });
    }
  });

  it('nobody to act for a player who already bid', () => {
    let s = auction();
    s = applyAction(s, { type: 'BID', playerId: 'p1', amount: 10000 }).state;
    expect(chooseBotAction(s, 'p1', mid)).toBeNull();
  });
});
