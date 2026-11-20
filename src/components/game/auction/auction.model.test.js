// Pure helpers of the bidding screen: quick bids and their rounding, clamping, the engine's error strings, advice, the
// set badge, bidder statuses, the countdown, the reveal order / timing and the wording.
import { describe, expect, it } from 'vitest';
import { BOARD_SIZE } from '@shared/board.js';
import { createGame } from '@shared/index.js';
import {
  BID_ERRORS, DEFAULT_AUCTION_SECONDS, LOW_CASH, auctionClock, auctionInstance, auctionReason, auctionRole, auctionSecondsOf, bidAdvice,
  bidInIds, bidProblem, bidderRows, clamp, eligibleIds, isTie, joinList, kickerOf, privacyLine, quickBids, reasonLine, resultCaption, resultKey,
  observerReason, revealOrder, revealPlan, setBadge, setImpact, sliderModel, snapBid, stepFor, waitingLine,
} from './auctionModel.js';

const players = [
  { id: 'me', name: 'Asha', color: '#f00' },
  { id: 'b1', name: 'Ravi', color: '#0f0' },
  { id: 'c2', name: 'Zoya', color: '#00f' },
  { id: 'd3', name: 'Imran', color: '#ff0', bankrupt: true },
];
const none = () => Array(BOARD_SIZE).fill(null);

describe('quick bids', () => {
  const chips = (o) => quickBids({ min: 34000, max: 1500000, price: 340000, ...o });

  it('lists Minimum, Price, +10%, +25%, Half my cash and Max, ascending, in round thousands', () => {
    const c = chips();
    expect(c.map((x) => x.key)).toEqual(['min', 'price', 'p10', 'p25', 'half', 'max']);
    expect(c.map((x) => x.amount)).toEqual([34000, 340000, 374000, 425000, 750000, 1500000]);
    expect(c.every((x, i) => i === 0 || x.amount > c[i - 1].amount)).toBe(true);
  });

  it('never goes below the minimum or above my cash, and Max is my whole cash', () => {
    const c = quickBids({ min: 170000, max: 300000, price: 340000 });
    expect(Math.min(...c.map((x) => x.amount))).toBe(170000);
    expect(Math.max(...c.map((x) => x.amount))).toBe(300000);
    expect(c.find((x) => x.key === 'max').amount).toBe(300000);
    expect(c.find((x) => x.key === 'p25')).toBeUndefined(); // 4.25 lakh is out of reach
  });

  it('drops duplicates (the first label keeps the amount; Max keeps its own)', () => {
    const c = quickBids({ min: 340000, max: 340000, price: 340000 });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ key: 'max', amount: 340000 });
    const d = quickBids({ min: 34000, max: 60000, price: 340000 });
    expect(new Set(d.map((x) => x.amount)).size).toBe(d.length);
    expect(d.map((x) => x.amount)).toEqual([34000, 60000]); // price / +10% / +25% are out of reach, Half lifts to the minimum
  });

  it('keeps non-round cash exact at the top and rounds the middle to thousands', () => {
    const c = quickBids({ min: 6000, max: 123456, price: 60000 });
    expect(c.find((x) => x.key === 'max').amount).toBe(123456);
    expect(c.find((x) => x.key === 'half').amount % 1000).toBe(0); // 61,728 -> 62,000
    expect(c.find((x) => x.key === 'half').amount).toBe(62000);
  });

  it('is empty when I cannot reach the minimum', () => {
    expect(quickBids({ min: 34000, max: 20000, price: 340000 })).toEqual([]);
    expect(quickBids({ min: 34000, max: 0, price: 340000 })).toEqual([]);
  });

  it('works without a price (older state)', () => {
    expect(quickBids({ min: 10000, max: 90000, price: 0 }).map((x) => x.key)).toEqual(['min', 'half', 'max']);
  });
});

describe('clamp, snap, steps, slider', () => {
  it('clamp / snapBid', () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(-5, 1, 3)).toBe(1);
    expect(snapBid(36400, 34000, 100000)).toBe(36000);
    expect(snapBid(1000, 34000, 100000)).toBe(34000);
    expect(snapBid(999999, 34000, 100000)).toBe(100000);
    expect(snapBid(50000, 90000, 40000)).toBe(90000); // max below min: the minimum wins, never below
  });

  it('stepFor scales with the price', () => {
    expect(stepFor(6000)).toBe(1000);
    expect(stepFor(60000)).toBe(5000);
    expect(stepFor(340000)).toBe(10000);
  });

  it('slider notches are round bids, the first is the minimum and the last is exactly my cash', () => {
    const s = sliderModel(34000, 1500500);
    expect(s.toAmount(0)).toBe(34000);
    expect(s.toAmount(1)).toBe(35000);
    expect(s.toAmount(s.n)).toBe(1500500);
    expect(s.toAmount(s.n + 5)).toBe(1500500);
    expect(s.toIndex(35000)).toBe(1);
    expect(s.toIndex(1500500)).toBe(s.n);
    expect(s.toIndex(10)).toBe(0);
    expect(sliderModel(50000, 50000).n).toBe(0);
  });
});

describe('validation and advice', () => {
  it('uses the engine error strings', () => {
    expect(bidProblem(10000, { min: 34000, cash: 100000 })).toBe('The minimum bid is ₹34,000');
    expect(bidProblem(10000, { min: 34000, cash: 100000 })).toBe(BID_ERRORS.tooLow(34000));
    expect(bidProblem(200000, { min: 34000, cash: 100000 })).toBe('You cannot bid more than your cash');
    expect(bidProblem(1.5, { min: 0, cash: 10 })).toBe('Invalid bid');
    expect(bidProblem(-1, { min: 0, cash: 10 })).toBe('Invalid bid');
    expect(bidProblem(0, { min: 34000, cash: 0 })).toBeNull(); // a pass is always fine
    expect(bidProblem(34000, { min: 34000, cash: 34000 })).toBeNull();
    expect(BID_ERRORS.already).toBe('You already placed your bid');
  });

  it('says what I keep and the share of the price', () => {
    const a = bidAdvice({ amount: 230000, cash: 1115000, price: 340000 });
    expect(a).toMatchObject({ keep: 885000, pct: 68, low: false, deal: 'bargain', keepText: 'You would keep ₹8,85,000' });
    expect(a.priceText).toBe("Price is ₹3,40,000: you'd pay 68% of it");
    expect(bidAdvice({ amount: 340000, cash: 1000000, price: 340000 }).deal).toBe('fair');
    expect(bidAdvice({ amount: 400000, cash: 1000000, price: 340000 }).deal).toBe('premium');
  });

  it('warns when the bid leaves little cash', () => {
    const a = bidAdvice({ amount: 1100000, cash: 1115000, price: 340000 });
    expect(a.low).toBe(true);
    expect(a.keepText).toBe('This leaves you only ₹15,000');
    expect(bidAdvice({ amount: 1115000, cash: 1115000, price: 340000 }).keepText).toBe('This leaves you nothing');
    expect(bidAdvice({ amount: 1000000, cash: 1000000 + LOW_CASH, price: 1 }).low).toBe(false);
  });
});

describe('set badge', () => {
  it('knows when winning completes my collection (Cyberabad = 28, 29, 31)', () => {
    const owners = none();
    owners[28] = 'me';
    owners[29] = 'me';
    const i = setImpact({ tileId: 31, owners, me: 'me', players });
    expect(i).toMatchObject({ complete: true, owned: 3, total: 3, name: 'Cyberabad' });
    expect(setBadge(i)).toEqual({ tone: 'complete', text: 'Completes your Cyberabad' });
  });

  it('shows progress for a partial set and nothing for a lone district', () => {
    const owners = none();
    owners[28] = 'me';
    const i = setImpact({ tileId: 31, owners, me: 'me', players });
    expect(i.complete).toBe(false);
    expect(setBadge(i)).toEqual({ tone: 'progress', text: '2 of 3 in Cyberabad' });
    expect(setBadge(setImpact({ tileId: 31, owners: none(), me: 'me', players }))).toBeNull();
    expect(setBadge(null)).toBeNull();
  });

  it('notices when winning blocks a rival who owns the rest of the set', () => {
    const owners = none();
    owners[28] = 'b1';
    owners[29] = 'b1';
    const i = setImpact({ tileId: 31, owners, me: 'me', players });
    expect(i.complete).toBe(false);
    expect(setBadge(i)).toEqual({ tone: 'block', text: "Blocks Ravi's Cyberabad" });
  });

  it('is null for a square that is not a district', () => {
    expect(setImpact({ tileId: 0, owners: none(), me: 'me', players })).toBeNull();
    expect(setImpact({ tileId: 99, owners: none(), me: 'me', players })).toBeNull();
  });
});

describe('bidders and roles', () => {
  const pending = (extra = {}) => ({ type: 'auction', tile: 31, minBid: 34000, bids: {}, reason: 'decline', ...extra });

  it('eligible: pending.eligible, else snatch claimants, else everybody still in', () => {
    expect(eligibleIds(pending({ eligible: ['me', 'b1'] }), players)).toEqual(['me', 'b1']);
    expect(eligibleIds(pending({ snatch: true, claimants: ['c2'] }), players)).toEqual(['c2']);
    expect(eligibleIds(pending(), players)).toEqual(['me', 'b1', 'c2']); // the bankrupt player is out
  });

  it('bidIn: pending.bidIn, else the keys of the bids map', () => {
    expect(bidInIds(pending({ bidIn: ['b1'] }))).toEqual(['b1']);
    expect(bidInIds(pending({ bids: { c2: 0 } }))).toEqual(['c2']);
    expect(bidInIds(null)).toEqual([]);
  });

  it('status per bidder: a pass reads Bid in like any bid; outsiders are dimmed and last', () => {
    const rows = bidderRows({ players, pending: pending({ eligible: ['me', 'b1', 'c2'], bidIn: ['b1'] }), me: 'me' });
    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual(['me:thinking', 'c2:thinking', 'b1:in']);
    expect(rows.find((r) => r.id === 'me').mine).toBe(true);
    const out = bidderRows({ players, pending: pending({ eligible: ['b1'], bidIn: [] }), me: 'me' });
    expect(out.map((r) => `${r.id}:${r.status}`)).toEqual(['b1:thinking', 'me:out', 'c2:out']);
    expect(bidderRows({ players, pending: pending({ eligible: ['me'], bidIn: [] }), me: 'me', sent: true })[0].status).toBe('in');
  });

  it('role: bidder, locked once sent or recorded, observer when not eligible', () => {
    const p = pending({ eligible: ['me', 'b1'], bidIn: [] });
    expect(auctionRole({ pending: p, players, me: 'me' })).toBe('bidder');
    expect(auctionRole({ pending: p, players, me: 'me', sent: true })).toBe('locked');
    expect(auctionRole({ pending: pending({ eligible: ['me', 'b1'], bidIn: ['me'] }), players, me: 'me' })).toBe('locked');
    expect(auctionRole({ pending: p, players, me: 'c2' })).toBe('observer');
  });

  it('the waiting line names who is still thinking', () => {
    const rows = bidderRows({ players, pending: pending({ eligible: ['me', 'b1', 'c2'], bidIn: ['me'] }), me: 'me' });
    expect(waitingLine(rows, 'me')).toBe('Waiting for Ravi and Zoya...');
    expect(waitingLine(bidderRows({ players, pending: pending({ eligible: ['me', 'b1'], bidIn: ['me', 'b1'] }), me: 'me' }), 'me')).toMatch(/Everyone has bid/);
    expect(joinList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(joinList(['A'])).toBe('A');
    expect(joinList([])).toBe('');
  });
});

describe('the countdown', () => {
  const cfg = { auctionSeconds: 20 };
  it('is null without a clock', () => {
    expect(auctionClock(null, 0, cfg)).toBeNull();
    expect(auctionClock({ deadline: null }, 0, cfg)).toBeNull();
  });
  it('fills from the room rule (default 20 s) and turns urgent in the last 5 s', () => {
    expect(auctionSecondsOf({})).toBe(DEFAULT_AUCTION_SECONDS);
    expect(auctionSecondsOf({ auctionSeconds: 30 })).toBe(30);
    expect(auctionSecondsOf({ auctionSeconds: 0 })).toBe(DEFAULT_AUCTION_SECONDS);
    const full = auctionClock({ deadline: 20000 }, 0, cfg);
    expect(full).toMatchObject({ secs: 20, frac: 1, urgent: false, total: 20000 });
    expect(auctionClock({ deadline: 20000 }, 10000, cfg)).toMatchObject({ secs: 10, frac: 0.5, urgent: false });
    expect(auctionClock({ deadline: 20000 }, 15500, cfg)).toMatchObject({ secs: 5, urgent: true });
    expect(auctionClock({ deadline: 20000 }, 25000, cfg)).toMatchObject({ secs: 0, frac: 0, urgent: true });
    expect(auctionClock({ deadline: 60000 }, 0, cfg).frac).toBe(1); // a longer first window (animation) does not overfill the ring
  });
});

describe('wording', () => {
  it('reason lines in plain words', () => {
    expect(reasonLine('bazaar')).toBe('Bazaar Auction: a free district goes under the hammer');
    // retired reasons (a game saved while a pass could open an auction) read as a plain auction
    for (const old of ['decline', 'unaffordable', undefined]) expect(reasonLine(old, 'Ravi')).toBe('A free district goes under the hammer');
    expect(kickerOf('bazaar')).toBe('Bazaar Auction');
    expect(kickerOf('snatch')).toBe('Snatch bidding');
    expect(kickerOf('decline')).toBe('Auction');
    expect(reasonLine('snatch', 'Ravi')).toBe('Snatch bidding: only the snatchers bid. Ravi already paid and keeps it if nobody bids');
    expect(reasonLine('snatch', 'You')).toContain('You already paid and keep it');
  });

  it('privacy line for observers, and for snatch observers', () => {
    expect(privacyLine('observer')).toMatch(/^Bidding is private/);
    expect(privacyLine('observer', { snatch: true, tileName: 'HITEC City' })).toBe('Snatchers are bidding for HITEC City. Their bids are private.');
    expect(privacyLine('bidder')).toMatch(/Sealed bids/);
  });

  it('auctionReason infers the reason for an older state; auctionInstance is per auction', () => {
    const view = createGame({ players: [{ id: 'me', name: 'Asha' }, { id: 'b1', name: 'Ravi' }], seed: 3 });
    const p = { tile: 31, minBid: 34000, bids: {} };
    view.players[view.turn].pos = 32;
    expect(auctionReason(view, p)).toBe('bazaar');
    view.players[view.turn].pos = 31;
    expect(auctionReason(view, p)).toBe('open'); // nothing but the Bazaar corner and Snatch opens an auction now
    view.players[view.turn].cash = 1000;
    expect(auctionReason(view, p)).toBe('open');
    expect(auctionReason(view, { ...p, reason: 'snatch' })).toBe('snatch');
    expect(auctionReason(view, null)).toBeNull();
    const a = { tile: 15, reason: 'decline' };
    const first = auctionInstance({ round: 5, turnCount: 17 }, a);
    expect(auctionInstance({ round: 9, turnCount: 33 }, a)).not.toBe(first);
    expect(auctionInstance({ round: 5, turnCount: 17 }, { tile: 15, reason: 'bazaar' })).not.toBe(first);
    expect(auctionInstance({ round: 5, turnCount: 17 }, null)).toBeNull();
  });
});

describe('the reveal', () => {
  const end = (extra = {}) => ({
    type: 'auction_end', tile: 31, winner: 'b1', amount: 230000, reason: 'decline',
    bids: { me: 150000, b1: 230000, c2: 0 }, order: ['b1', 'me', 'c2'], tie: false, ...extra,
  });
  const nameOf = (id) => (id === 'me' ? 'You' : players.find((p) => p.id === id)?.name || 'Someone');

  it('uses the server order, else rebuilds it (highest first, passers last)', () => {
    expect(revealOrder(end(), players)).toEqual(['b1', 'me', 'c2']);
    expect(revealOrder(end({ order: undefined }), players)).toEqual(['b1', 'me', 'c2']);
    expect(revealOrder(end({ order: undefined, bids: { me: 5000, b1: 5000, c2: 0 } }), players)).toEqual(['me', 'b1', 'c2']); // ties keep seat order
    expect(revealOrder(end({ order: ['b1'] }), players)).toEqual(['b1', 'me', 'c2']); // anyone the order forgot is appended
  });

  it('tie: the server flag, else equal top bids', () => {
    expect(isTie(end({ tie: true }))).toBe(true);
    expect(isTie(end({ tie: false, bids: { me: 5, b1: 5 } }))).toBe(false);
    expect(isTie(end({ tie: undefined, bids: { me: 5, b1: 5, c2: 0 } }))).toBe(true);
    expect(isTie(end({ tie: undefined }))).toBe(false);
    expect(isTie(end({ tie: undefined, bids: { me: 0, b1: 0 } }))).toBe(false);
  });

  it('flips lowest to highest, ~450 ms apart, the winner last, all inside the presenter hold', () => {
    const plan = revealPlan(end(), players);
    expect(plan.passers).toEqual(['c2']);
    expect(plan.cards.map((c) => c.id)).toEqual(['me', 'b1']);
    expect(plan.cards[1].winner).toBe(true);
    expect(plan.cards[1].at - plan.cards[0].at).toBe(450);
    expect(plan.stampAt).toBeGreaterThan(plan.cards[1].at);
    expect(plan.totalMs).toBeLessThanOrEqual(3000);
  });

  it('many bidders still finish within ~3 s; faster playback shrinks everything', () => {
    const bids = {};
    const order = [];
    for (let i = 0; i < 6; i++) { bids[`p${i}`] = 10000 * (6 - i); order.push(`p${i}`); }
    const plan = revealPlan({ winner: 'p0', amount: 60000, bids, order }, [], {});
    expect(plan.cards).toHaveLength(6);
    expect(plan.cards[5].id).toBe('p0');
    expect(plan.totalMs).toBeLessThanOrEqual(3000);
    const gaps = plan.cards.slice(1).map((c, i) => c.at - plan.cards[i].at);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(450);
    const fast = revealPlan(end(), players, { ms: 1500 });
    expect(fast.totalMs).toBeLessThan(revealPlan(end(), players, { ms: 3000 }).totalMs);
    expect(fast.totalMs).toBeLessThanOrEqual(1500);
  });

  it('reduced motion: no stagger at all', () => {
    const plan = revealPlan(end(), players, { reduced: true });
    expect(plan.cards.every((c) => c.at === 0)).toBe(true);
    expect(plan.stampAt).toBe(0);
    expect(plan.totalMs).toBe(0);
  });

  it('no bids: everybody passed, no cards', () => {
    const plan = revealPlan(end({ winner: null, amount: 0, bids: { me: 0, b1: 0, c2: 0 }, order: ['me', 'b1', 'c2'] }), players);
    expect(plan.cards).toEqual([]);
    expect(plan.passers).toEqual(['me', 'b1', 'c2']);
  });

  it('captions: SOLD, saved, tie, nobody bid, snatch keeper', () => {
    expect(resultCaption(end(), nameOf, { tileName: 'HITEC City' })).toMatchObject({ kind: 'sold', headline: 'SOLD to Ravi for ₹2,30,000', saved: 0, tieNote: '' });
    expect(resultCaption(end({ winner: 'me' }), nameOf).headline).toBe('SOLD to you for ₹2,30,000');
    const saved = resultCaption(end({ saved: 30000 }), nameOf);
    expect(saved.savedText).toBe('saved ₹30,000');
    expect(saved.line).toBe('SOLD to Ravi for ₹2,30,000. saved ₹30,000');
    expect(resultCaption(end({ tie: true }), nameOf).tieNote).toBe('Tie! Drawn at random');
    expect(resultCaption(end({ tie: true, tieRule: 'seat order from the roller' }), nameOf).tieNote).toBe('Tie! Decided by seat order from the roller');
    expect(resultCaption(end({ winner: null, amount: 0 }), nameOf)).toMatchObject({ kind: 'none', headline: 'Nobody bid. The district stays free' });
    expect(resultCaption(end({ winner: null, amount: 0, reason: 'snatch', buyer: 'c2' }), nameOf, { tileName: 'HITEC City' })).toMatchObject({ kind: 'kept', headline: 'Nobody bid. HITEC City stays with Zoya' });
    expect(resultCaption(end({ winner: null, amount: 0, reason: 'snatch', buyer: 'me' }), nameOf, { tileName: 'HITEC City' }).headline).toBe('Nobody bid. HITEC City stays with you');
    expect(resultCaption(null, nameOf)).toBeNull();
  });

  it('resultKey prefers the presenter id', () => {
    expect(resultKey({ id: 'ar3', tile: 1 })).toBe('ar3');
    expect(resultKey({ tile: 1, winner: 'b1', amount: 5 })).toBe('1:b1:5');
    expect(resultKey(null)).toBeNull();
  });
});

describe('real-engine details', () => {
  it('auctionInstance prefers the engine id; the ring follows the server window (pending.ms)', () => {
    expect(auctionInstance({ round: 5, turnCount: 17 }, { id: 4, tile: 31 })).toBe('#4:31');
    expect(auctionInstance({ round: 9, turnCount: 99 }, { id: 4, tile: 31 })).toBe('#4:31');
    expect(auctionInstance({ round: 5, turnCount: 17 }, { id: 5, tile: 31 })).not.toBe('#4:31');
    expect(auctionClock({ deadline: 5000 }, 0, { auctionSeconds: 20 }, 10000)).toMatchObject({ total: 10000, frac: 0.5 });
    expect(auctionClock({ deadline: 5000 }, 0, { auctionSeconds: 20 })).toMatchObject({ total: 20000, frac: 0.25 });
  });

  it('observerReason: poor (could bid but cannot afford the minimum), snatch (not a claimant), out', () => {
    const decline = { type: 'auction', eligible: ['b1'], reason: 'decline' };
    expect(observerReason({ pending: decline, me: 'me', cash: 20000, min: 34000 })).toBe('poor');
    expect(observerReason({ pending: decline, me: 'me', cash: 900000, min: 34000 })).toBe('out');
    const snatch = { type: 'auction', snatch: true, claimants: ['b1', 'c2'], eligible: ['b1'] };
    expect(observerReason({ pending: snatch, me: 'me', cash: 20000, min: 34000 })).toBe('snatch');
    expect(observerReason({ pending: snatch, me: 'c2', cash: 20000, min: 34000 })).toBe('poor');
    expect(privacyLine('observer', { poor: true, min: 34000 })).toBe("You can't afford the minimum bid of ₹34,000, so you pass. Bidding is private.");
  });

  it('the Passed row lists only players who could bid; timed-out passers are marked', () => {
    const e = { winner: 'b1', amount: 50000, bids: { me: 0, b1: 50000, c2: 0 }, order: ['b1', 'c2'], timedOut: ['c2'] };
    const plan = revealPlan(e, players, { only: ['b1', 'c2'] });
    expect(plan.passers).toEqual(['c2']); // me was out of it (could not afford the minimum): not a passer
    expect(plan.timedOut).toEqual(['c2']);
    expect(revealPlan(e, players).passers).toEqual(['c2', 'me']); // without the roster everybody at 0 is listed
  });
});
