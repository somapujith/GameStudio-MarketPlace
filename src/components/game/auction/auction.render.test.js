// Render tests of the bidding screen, one per state: my turn to bid, can't afford, locked, observer, snatch bidding (claimant
// and observer), and the reveal (winner, tie, saved, nobody bid, snatch with no bids), plus the sheet's open / closed logic.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '@shared/index.js';

const shell = vi.hoisted(() => ({ props: null }));
vi.mock('../ui/Sheet.jsx', () => ({
  default: (props) => {
    shell.props = props;
    return props.open ? createElement('div', { 'data-open': 1, className: props.className }, props.header, props.children, props.footer) : createElement('div', { 'data-open': 0 });
  },
  hasOpenSheet: () => false,
}));
vi.mock('@/components/art/index.js', () => ({
  Avatar: () => null,
  TileIcon: () => createElement('i', { 'data-icon': 1 }),
  BuildingArt: () => null,
  PieceArt: ({ piece }) => createElement('i', { 'data-piece': piece }),
  AvatarFrame: ({ children, size }) => createElement('b', null, typeof children === 'function' ? children(size) : children),
  TitleChip: () => null,
}));

const { default: AuctionSheet } = await import('../AuctionSheet.jsx');

const base = () => createGame({ players: [{ id: 'me', name: 'Asha' }, { id: 'b1', name: 'Ravi' }, { id: 'c2', name: 'Zoya' }], seed: 3 });
const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const html = (session) => renderToStaticMarkup(createElement(AuctionSheet, { session }));

const auctionView = (pending = {}, patch = {}) => {
  const view = base();
  view.phase = 'auction';
  view.pending = {
    type: 'auction', tile: 31, minBid: 34000, bids: {}, bidIn: [], eligible: ['me', 'b1', 'c2'], reason: 'decline', returnPhase: 'manage', ...pending,
  };
  Object.assign(view, patch);
  return view;
};
const sess = (view, patch = {}) => ({
  me: 'me', view, display: null, options: {}, busy: false, dispatch() {}, clock: { deadline: Date.now() + 14000, waitingFor: ['me'] }, ...patch,
});

describe('my turn to bid', () => {
  const view = auctionView();
  const out = text(createElement(AuctionSheet, { session: sess(view) }));

  it('shows the district as a deed: name, price, base rent, minimum bid, collection and the reason in plain words', () => {
    expect(out).toContain('HITEC City');
    expect(out).toContain('Cyberabad');
    expect(out).toContain('₹3,40,000'); // price
    expect(out).toContain('Base rent');
    expect(out).toContain('Minimum bid');
    expect(out).toContain('₹34,000');
    expect(out).toContain('A free district goes under the hammer');
    expect(out).not.toMatch(/City Takeover|Nobody bought it|goes to auction/); // no excuse text: a pass never opens an auction
  });

  it('shows the amount, the steppers, the slider, the quick chips and both actions', () => {
    const m = html(sess(view));
    expect(out).toContain('Your sealed bid');
    expect(out).toContain('of ₹15,00,000 cash');
    expect(m).toContain('aria-label="Decrease by ₹10,000"');
    expect(m).toContain('aria-label="Increase by ₹10,000"');
    expect(m).toContain('type="range"');
    for (const label of ['Minimum', 'Price', '+10%', '+25%', 'Half my cash', 'Max']) expect(out).toContain(label);
    expect(out).toContain('Place bid · ₹34,000');
    expect(out).toContain('Pass');
  });

  it('gives live advice and has no text input', () => {
    const m = html(sess(view));
    expect(out).toContain('You would keep ₹14,66,000');
    expect(out).toContain("Price is ₹3,40,000: you'd pay 10% of it");
    expect(m).not.toContain('type="text"');
    expect(m).not.toContain('type="number"');
  });

  it('the strip: everyone is thinking, I am marked, nothing shows an amount', () => {
    expect(out).toMatch(/You\s+Thinking/);
    expect(out).toMatch(/Ravi\s+Thinking/);
    expect(out).toMatch(/Zoya\s+Thinking/);
    expect(out).not.toContain('Bid in');
  });

  it('the ring counts down from the clock; no clock, no ring', () => {
    expect(html(sess(view))).toContain('role="timer"');
    expect(html(sess(view))).toMatch(/aria-label="1[34] seconds left to bid"/);
    expect(html(sess(view, { clock: null }))).not.toContain('role="timer"');
  });

  it('is not dismissible (a bidder must bid or pass)', () => {
    renderToStaticMarkup(createElement(AuctionSheet, { session: sess(view) }));
    expect(shell.props.dismissible).toBe(false);
    expect(shell.props.open).toBe(true);
  });

  it('a Bazaar Auction says so', () => {
    const o = text(createElement(AuctionSheet, { session: sess(auctionView({ reason: 'bazaar', minBid: 170000 })) }));
    expect(o).toContain('Bazaar Auction: a free district goes under the hammer');
  });

  it('a retired reason (a game saved while a pass could open an auction) reads as a plain auction', () => {
    for (const reason of ['unaffordable', 'decline']) {
      const v = auctionView({ reason });
      const out = text(createElement(AuctionSheet, { session: sess(v) }));
      expect(out).toContain('A free district goes under the hammer');
      expect(out).not.toMatch(/afford it, so it goes to auction|Nobody bought it|City Takeover/);
    }
  });
});

describe('strip statuses while sealed', () => {
  it('"Bid in" for any submitted bid, a pass included; the others keep thinking', () => {
    const view = auctionView({ bidIn: ['b1'], bids: { b1: 0 } });
    const out = text(createElement(AuctionSheet, { session: sess(view) }));
    expect(out).toMatch(/Ravi\s+Bid in/);
    expect(out).toMatch(/Zoya\s+Thinking/);
    expect(out).not.toMatch(/Passed/);
  });

  it('players who may not bid are dimmed as "Not bidding"', () => {
    const view = auctionView({ eligible: ['me', 'b1'] });
    const m = html(sess(view));
    expect(text(createElement(AuctionSheet, { session: sess(view) }))).toMatch(/Zoya\s+Can't afford, passed/);
    expect(m).toContain('hga-chip is-out');
  });
});

describe("can't afford the minimum", () => {
  it('shows why and only offers Pass', () => {
    const view = auctionView({}, {});
    view.players[0].cash = 20000;
    const out = text(createElement(AuctionSheet, { session: sess(view) }));
    expect(out).toContain("You can't afford the minimum bid of ₹34,000. You'll pass.");
    expect(out).toContain('Pass');
    expect(out).not.toContain('Place bid');
    expect(html(sess(view))).not.toContain('type="range"');
  });
});

describe('a bid that completes my collection', () => {
  it('shows the badge', () => {
    const view = auctionView();
    view.owners[28] = 'me';
    view.owners[29] = 'me';
    expect(text(createElement(AuctionSheet, { session: sess(view) }))).toContain('Completes your Cyberabad');
  });
  it('shows progress for a partial set', () => {
    const view = auctionView();
    view.owners[28] = 'me';
    expect(text(createElement(AuctionSheet, { session: sess(view) }))).toContain('2 of 3 in Cyberabad');
  });
});

describe('locked after I bid', () => {
  const view = auctionView({ bidIn: ['me'], bids: { me: 150000 } });
  const out = text(createElement(AuctionSheet, { session: sess(view) }));
  it('collapses the controls into a locked card with the sealed amount and who we wait for', () => {
    expect(out).toContain('Your bid is in');
    expect(out).toContain('₹1,50,000');
    expect(out).toContain('(sealed)');
    expect(out).toContain('Waiting for Ravi and Zoya...');
    expect(out).not.toContain('Place bid');
    expect(html(sess(view))).not.toContain('type="range"');
  });
  it('the ring is still running', () => {
    expect(html(sess(view))).toContain('role="timer"');
  });
  it('a pass reads "You passed"', () => {
    const v = auctionView({ bidIn: ['me'], bids: { me: 0 } });
    expect(text(createElement(AuctionSheet, { session: sess(v) }))).toContain('You passed');
  });
  it('right after I sent (before the server confirms) the controls are not shown either (local lock is covered by the model)', () => {
    // the pending state already lists me in bidIn once confirmed; role() also locks on `sent`, tested in the model
    expect(out).not.toContain('Your sealed bid');
  });
  it('everyone in: says the bids are opening', () => {
    const v = auctionView({ bidIn: ['me', 'b1', 'c2'], bids: { me: 1000, b1: 0, c2: 0 } });
    expect(text(createElement(AuctionSheet, { session: sess(v) }))).toContain('Everyone has bid');
  });
});

describe('observer / not eligible', () => {
  const view = auctionView({ eligible: ['b1', 'c2'], bidIn: ['b1'] });
  it('sees the strip, the ring and "Bidding is private"', () => {
    const m = html(sess(view));
    const out = text(createElement(AuctionSheet, { session: sess(view) }));
    expect(out).toContain('Bidding is private');
    expect(out).toMatch(/Ravi\s+Bid in/);
    expect(out).toMatch(/Zoya\s+Thinking/);
    expect(out).toMatch(/You\s+Can't afford, passed/);
    expect(m).toContain('role="timer"');
    expect(out).not.toContain('Place bid');
    expect(out).not.toContain('Your sealed bid');
  });
  it('may close the panel (the reveal still opens later)', () => {
    renderToStaticMarkup(createElement(AuctionSheet, { session: sess(view) }));
    expect(shell.props.dismissible).toBe(true);
  });
});

describe('snatch bidding', () => {
  const snatch = (extra = {}) => auctionView({ reason: 'snatch', snatch: true, buyer: 'c2', claimants: ['me', 'b1'], eligible: ['me', 'b1'], bidIn: ['c2'], ...extra });
  it('a claimant gets the bid form, the Snatch kicker and who already paid', () => {
    const out = text(createElement(AuctionSheet, { session: sess(snatch()) }));
    expect(out).toContain('Snatch bidding');
    expect(out).toContain('Snatch bidding: only the snatchers bid. Zoya already paid and keeps it if nobody bids');
    expect(out).toContain('Place bid');
    expect(out).toContain('Minimum bid');
    expect(out).not.toMatch(/Zoya\s+Thinking/); // the buyer is not bidding
    expect(out).toMatch(/Zoya\s+Not bidding/);
  });
  it('everybody else watches: "Snatchers are bidding for HITEC City"', () => {
    const v = snatch({ buyer: 'me', claimants: ['b1', 'c2'], eligible: ['b1', 'c2'] });
    const out = text(createElement(AuctionSheet, { session: sess(v) }));
    expect(out).toContain('Snatchers are bidding for HITEC City');
    expect(out).toContain('You already paid and keep it if nobody bids');
    expect(out).not.toContain('Place bid');
    expect(out).not.toContain('You passed');
  });
  it('an older state without eligible / bidIn still works: claimants are the bidders, bids keys are the ticks', () => {
    const v = auctionView({ reason: 'snatch', snatch: true, buyer: 'c2', claimants: ['me', 'b1'], bids: { c2: 0, b1: 40000 }, eligible: undefined, bidIn: undefined });
    const out = text(createElement(AuctionSheet, { session: sess(v) }));
    expect(out).toMatch(/Ravi\s+Bid in/);
    expect(out).toContain('Place bid');
  });
});

describe('open / closed', () => {
  it('stays closed outside an auction', () => {
    const view = base();
    renderToStaticMarkup(createElement(AuctionSheet, { session: sess(view) }));
    expect(shell.props.open).toBe(false);
  });
  it('waits for the presenter to finish announcing the auction (busy) before it opens', () => {
    renderToStaticMarkup(createElement(AuctionSheet, { session: sess(auctionView(), { busy: true }) }));
    expect(shell.props.open).toBe(false);
  });
});

describe('the reveal', () => {
  const afterAuction = () => {
    const view = base();
    view.phase = 'manage';
    view.pending = null;
    return view;
  };
  const end = (extra = {}) => ({
    type: 'auction_end', id: 'ar1', ms: 3000, tile: 31, winner: 'b1', amount: 230000, reason: 'decline',
    bids: { me: 150000, b1: 230000, c2: 0 }, order: ['b1', 'me', 'c2'], tie: false, ...extra,
  });
  const reveal = (e, patch = {}) => sess(afterAuction(), { auctionResult: e, clock: null, ...patch });

  it('stays open for the result although the phase has left "auction"', () => {
    renderToStaticMarkup(createElement(AuctionSheet, { session: reveal(end()) }));
    expect(shell.props.open).toBe(true);
    expect(shell.props.dismissible).toBe(true);
  });

  it('flip cards run lowest to highest, the winner last with a crown, then the SOLD stamp', () => {
    const m = html(reveal(end()));
    const out = text(createElement(AuctionSheet, { session: reveal(end()) }));
    expect(m.indexOf('>You<')).toBeLessThan(m.indexOf('>Ravi<')); // 1.5 lakh flips before the 2.3 lakh winner
    expect(m).toContain('hga-card is-winner');
    expect(m).toContain('hga-crown');
    expect(out).toContain('₹1,50,000');
    expect(out).toContain('₹2,30,000');
    expect(out).toContain('SOLD to Ravi for ₹2,30,000');
    expect(out).toMatch(/Passed\s+Zoya/);
    expect(out).not.toContain('Place bid');
  });

  it('gives each card a staggered delay (CSS), the winner the latest', () => {
    const m = html(reveal(end()));
    const cards = [...m.matchAll(/<li class="hga-card[^"]*" style="([^"]*)"/g)].map((x) => x[1]);
    expect(cards).toHaveLength(2);
    const at = (s) => Number(/--at:(\d+)ms/.exec(s)[1]);
    expect(at(cards[1])).toBeGreaterThan(at(cards[0]));
    const stamp = /class="hga-stamp[^"]*" style="([^"]*)"/.exec(m)[1];
    expect(at(stamp)).toBeGreaterThan(at(cards[1]));
  });

  it('says it was my win', () => {
    const out = text(createElement(AuctionSheet, { session: reveal(end({ winner: 'me', amount: 150000, bids: { me: 150000, b1: 100000, c2: 0 }, order: ['me', 'b1', 'c2'] })) }));
    expect(out).toContain('SOLD to you for ₹1,50,000');
  });

  it('shows "saved" and the tie note when the server sends them', () => {
    const out = text(createElement(AuctionSheet, { session: reveal(end({ saved: 30000, tie: true })) }));
    expect(out).toContain('saved ₹30,000');
    expect(out).toContain('Tie! Drawn at random');
    expect(text(createElement(AuctionSheet, { session: reveal(end({ tie: true, tieRule: 'seat order' })) }))).toContain('Tie! Decided by seat order');
  });

  it('flags the district in the winner colour', () => {
    const m = html(reveal(end()));
    expect(m).toContain('hga-flag');
    expect(m).toContain('hga-stage is-sold');
  });

  it('nobody bid: the district stays free', () => {
    const out = text(createElement(AuctionSheet, { session: reveal(end({ winner: null, amount: 0, bids: { me: 0, b1: 0, c2: 0 }, order: ['me', 'b1', 'c2'] })) }));
    expect(out).toContain('Nobody bid. The district stays free');
    expect(out).not.toContain('SOLD');
    expect(html(reveal(end({ winner: null, amount: 0, bids: { me: 0, b1: 0, c2: 0 }, order: ['me', 'b1', 'c2'] })))).not.toContain('hga-card');
  });

  it('snatch bidding with no bids: it stays with the buyer', () => {
    const out = text(createElement(AuctionSheet, { session: reveal(end({ winner: null, amount: 0, reason: 'snatch', buyer: 'c2', bids: { me: 0, b1: 0, c2: 0 }, order: ['me', 'b1', 'c2'] })) }));
    expect(out).toContain('Nobody bid. HITEC City stays with Zoya');
  });

  it('works for an older engine (no order, tie or id)', () => {
    const e = { type: 'auction_end', tile: 31, winner: 'b1', amount: 230000, bids: { me: 150000, b1: 230000, c2: 0 }, reason: 'decline' };
    const out = text(createElement(AuctionSheet, { session: reveal(e) }));
    expect(out).toContain('SOLD to Ravi for ₹2,30,000');
  });

  it('has a Close button and a skip hint', () => {
    const out = text(createElement(AuctionSheet, { session: reveal(end()) }));
    expect(out).toContain('Close');
    expect(out).toContain('Tap the cards to skip');
  });

  it('the reveal beats the bidding form when both could show', () => {
    const view = auctionView();
    const out = text(createElement(AuctionSheet, { session: sess(view, { auctionResult: end() }) }));
    expect(out).toContain('SOLD to Ravi');
    expect(out).not.toContain('Place bid');
  });
});

describe('real-engine states', () => {
  it('a player the engine passed for cash (not in eligible) is told why', () => {
    const view = auctionView({ eligible: ['b1', 'c2'], bidIn: [], bids: { me: 0 } });
    view.players[0].cash = 20000;
    const out = text(createElement(AuctionSheet, { session: sess(view) }));
    expect(out).toContain("You can't afford the minimum bid of ₹34,000, so you pass. Bidding is private.");
    expect(out).not.toContain('Place bid');
  });

  it('the reveal lists only eligible passers (a snatch non-claimant is not "Passed")', () => {
    const view = auctionView({ reason: 'snatch', snatch: true, buyer: 'c2', claimants: ['me', 'b1'], eligible: ['me', 'b1'], bidIn: ['me', 'b1'], bids: { c2: 0, me: 0, b1: 0 } });
    const end = { type: 'auction_end', id: 'ar9', ms: 3000, tile: 31, winner: null, amount: 0, reason: 'snatch', buyer: 'c2', bids: { me: 0, b1: 0, c2: 0 }, order: ['me', 'b1'], tie: false };
    // the sheet saw the live auction first (held), then the result arrives with the phase already moved on
    const after = base();
    after.phase = 'manage';
    after.pending = null;
    const first = renderToStaticMarkup(createElement(AuctionSheet, { session: sess(view) }));
    expect(first).toContain('hga-chip');
    const out = text(createElement(AuctionSheet, { session: sess(after, { auctionResult: end, clock: null }) }));
    expect(out).toContain('Nobody bid. HITEC City stays with Zoya');
  });
});
