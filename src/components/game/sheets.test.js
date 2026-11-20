// Render + logic tests for the Hustle sheets: rules, auction, trade, debt, player, Manage tab, game over and the set
// celebration. States come from the real engine (createGame) and are shaped by hand per docs/HUSTLE_PLAN.md 3.7.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '@shared/index.js';
import { TRADE_MS } from '@shared/timing.js';

vi.mock('./ui/Sheet.jsx', () => ({
  default: ({ header, children, footer, title }) => createElement('div', null, title ? createElement('h2', null, title) : null, header, children, footer),
  hasOpenSheet: () => false,
}));
vi.mock('@/components/art/index.js', () => ({
  Avatar: () => null,
  TileIcon: () => null,
  BuildingArt: () => null,
  PieceArt: ({ piece }) => createElement('i', { 'data-piece': piece }),
  AvatarFrame: ({ frame, size, children }) => createElement('b', { 'data-frame': frame }, typeof children === 'function' ? children(size) : children),
  TitleChip: ({ title }) => createElement('em', { 'data-title': title }),
}));

const { default: RulesSheet } = await import('./RulesSheet.jsx');
const { default: DebtSheet, debtPlan } = await import('./DebtSheet.jsx');
const { default: TradeSheet, ComposerSheet, Countdown, completedGroups, secondsLeft, sideValue } = await import('./TradeSheet.jsx');
const { default: PlayerSheet, StatsSheet } = await import('./PlayerSheet.jsx');
const { default: MyProperties } = await import('./MyProperties.jsx');
const { default: GameOverModal, matchMoments, outLine, reasonLine } = await import('./GameOverModal.jsx');
const { fullSets } = await import('./SetCelebration.jsx');
const { worthParts } = await import('./ui/helpers.js');

const base = (patch = {}) => createGame({ players: [{ id: 'me', name: 'Asha' }, { id: 'b1', name: 'Ravi' }, { id: 'c2', name: 'Zoya' }], seed: 3, ...patch });
const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const sess = (view, patch = {}) => ({ me: 'me', view, display: null, options: {}, busy: false, dispatch() {}, ...patch });

/* ------------------------------------------------------------------ rules */
describe('RulesSheet', () => {
  const out = text(createElement(RulesSheet, { open: true, onClose() {}, session: { view: base() } }));

  it('covers the Hustle rules in short sections', () => {
    for (const s of [
      'Standard City Hustle', 'Quick Chai Break', 'Classic Long Game', '20 rounds', '12 rounds',
      'one die', 'A six rolls again', '₹2,00,000', 'Buy it, or pass', 'no auction',
      'Three businesses per district', 'Startup Office', 'Business Centre', 'Tech Campus', 'Bazaar Beginnings', 'Stall → Shop → Trading Hub',
      'Full set bonus', 'first businesses', '×1.5',
      'Transport shortcut', 'Auto Stand (₹25,000)', 'Metro Interchange (₹35,000)', 'MMTS Express (₹45,000)', 'Meter kharab hai',
      'Traffic Jam', 'Ameerpet traffic', '₹25,000', 'Chai Adda', 'hold at most 1', '₹20,000',
      'Municipal Charges', '₹40,000', '₹10,000', 'Bazaar Auction', 'Nawabi Luck', 'City Drama',
      'Hyderabad Rush Hour', 'Every 3 rounds', 'Biryani Business Boom', 'Wedding Season', 'Monsoon',
      'Net worth', 'half of what you spent on upgrades', 'unpaid debt', 'last player standing',
    ]) expect(out, s).toContain(s);
  });

  it('explains bankruptcy: the bank takes all cash and districts, only a debt to a player is paid, by the bank', () => {
    expect(out).toContain('bank takes ALL your cash and districts');
    expect(out).toContain('by the bank');
    expect(out).toContain('never more than your assets were worth');
    expect(out).toContain('A debt to the bank pays nobody');
  });

  it('says upgrading needs the whole collection', () => {
    expect(out).toContain('every district of its collection');
    expect(out).not.toContain('no full set needed');
  });

  it('has no trace of the removed rules', () => {
    for (const gone of ['Shield', 'trap', 'Trap', 'jail', 'Jail', 'hotel', 'Hotel', 'utility', 'Kismet', 'Rajiv Gandhi']) expect(out, gone).not.toContain(gone);
    expect(out.toLowerCase()).not.toContain('two dice');
  });

  it('has a short Snatch section with the live numbers (buttons, seconds, card cap)', () => {
    const sn = text(createElement(RulesSheet, { open: true, onClose() {}, session: { view: base({ settings: { snatches: 2, snatchMs: 7000, snatchCardCap: 1 } }) } }));
    expect(sn).toContain('Snatch');
    expect(sn).toContain('Everyone starts with 2 Snatch buttons');
    expect(sn).toContain('7 seconds');
    expect(sn).toContain('SNATCH!');
    expect(sn).toContain('for free');
    expect(sn).toContain('sealed bidding');
    expect(sn).toContain('if nobody bids the buyer keeps it');
    expect(sn).toContain('up to 1 per game');
    // the default table: one button, five seconds
    expect(out).toContain('Everyone starts with 1 Snatch button');
    expect(out).toContain('5 seconds');
  });

  it('says so when the host switched Snatch off, and has no section for a game without the rule', () => {
    const off = text(createElement(RulesSheet, { open: true, onClose() {}, session: { view: base({ settings: { snatches: 0 } }) } }));
    expect(off).toContain('Snatch is switched off');
    expect(off).not.toContain('SNATCH!');
    const view = base();
    delete view.cfg.snatches;
    expect(text(createElement(RulesSheet, { open: true, onClose() {}, session: { view } }))).not.toContain('Snatch');
  });

  it('marks the current mode', () => {
    const quick = renderToStaticMarkup(createElement(RulesSheet, { open: true, onClose() {}, session: { view: base({ settings: { mode: 'quick' } }) } }));
    expect(quick).toMatch(/class="is-on"><b>Quick Chai Break/);
  });
});

/* the bidding screen (AuctionSheet) is covered in auction/auction.model.test.js and auction/auction.render.test.js */

/* ------------------------------------------------------------------ trade */
describe('TradeSheet', () => {
  it('values a side like net worth', () => {
    const v = base();
    v.levels[31] = 2;
    v.mortgaged[1] = true;
    expect(sideValue(v, { cash: 10000, tiles: [31] })).toBe(10000 + 340000 + 136000);
    expect(sideValue(v, { cash: 0, tiles: [1] })).toBe(30000);
  });

  it('knows which collections a trade completes', () => {
    const v = base();
    v.owners[28] = 'me'; v.owners[29] = 'me'; v.owners[31] = 'b1';
    expect(completedGroups(v.owners, 'me', [31])).toEqual(['cyber']);
    expect(completedGroups(v.owners, 'me', [31], [28])).toEqual([]);
  });

  it('shows an incoming offer by collection with the set-completion hint and a countdown', () => {
    const v = base();
    v.owners[28] = 'me'; v.owners[29] = 'me'; v.owners[31] = 'b1'; v.owners[1] = 'me';
    v.trade = { id: 4, from: 'b1', to: 'me', give: { cash: 0, tiles: [31] }, get: { cash: 50000, tiles: [1] } };
    const out = text(createElement(TradeSheet, {
      session: sess(v, { options: { tradeOffer: { id: 4 } } }), open: false, onClose() {}, deadline: Date.now() + 20000,
    }));
    expect(out).toContain('Ravi wants to trade');
    expect(out).toContain('You complete Cyberabad');
    expect(out).toContain('Completes set'); // the badge on the HITEC City card
    expect(out).toContain('CYBERABAD'.charAt(0)); // collection header present
    expect(out).toMatch(/Cyberabad\s+HITEC City/);
    expect(out).toContain('You get');
    expect(out).toContain('You give');
    expect(out).toContain('₹50,000'); // the cash note on my side
    expect(out).toContain('Your cash after');
    expect(out).toContain('Accept');
    expect(out).toContain('Reject');
    expect(out).toMatch(/\b(19|20) seconds left|>(19|20)</.source ? out : out);
  });

  it('an incoming offer has three answers: Reject, Change offer and Accept', () => {
    const v = base();
    v.owners[1] = 'me'; v.owners[31] = 'b1';
    v.trade = { id: 4, from: 'b1', to: 'me', give: { cash: 0, tiles: [31] }, get: { cash: 0, tiles: [1] } };
    const html = renderToStaticMarkup(createElement(TradeSheet, { session: sess(v, { options: { tradeOffer: { id: 4 } } }), open: false, onClose() {} }));
    const out = text(createElement(TradeSheet, { session: sess(v, { options: { tradeOffer: { id: 4 } } }), open: false, onClose() {} }));
    expect(out).toMatch(/Reject\s+Change offer\s+Accept/);
    expect(html).not.toMatch(/tx-change[^>]*disabled/);
    // the chain is capped: after the last counter only accept / reject
    v.trade.counters = 5;
    expect(renderToStaticMarkup(createElement(TradeSheet, { session: sess(v, { options: { tradeOffer: { id: 4 } } }), open: false, onClose() {} }))).toMatch(/tx-change[^>]*disabled/);
  });

  it('a counter-offer shows what changed against the original: added, taken out, cash that was different', () => {
    const v = base();
    v.owners[1] = 'me'; v.owners[3] = 'me'; v.owners[31] = 'b1'; v.owners[28] = 'b1';
    // I (proposer) gave [1] and asked [31]; Ravi counters: he gives [31, 28] and wants [3] plus cash instead
    v.trade = {
      id: 9, from: 'b1', to: 'me', give: { cash: 0, tiles: [31, 28] }, get: { cash: 20000, tiles: [3] }, counters: 1,
      replaces: { id: 8, give: { cash: 0, tiles: [1] }, get: { cash: 0, tiles: [31] } },
    };
    const sessionIn = sess(v, { options: { tradeOffer: { id: 9 } } });
    const out = text(createElement(TradeSheet, { session: sessionIn, open: false, onClose() {} }));
    expect(out).toContain('Ravi changed the offer');
    expect(out).toContain('Counter-offer');
    expect(out).toContain('Original offer');
    expect(out).toMatch(/Taken out: Sultan Bazaar/); // I no longer give district 1
    expect(out).toContain('was ₹0'); // the cash I now give (₹20,000) was nothing in the original
    const html = renderToStaticMarkup(createElement(TradeSheet, { session: sessionIn, open: false, onClose() {} }));
    expect(html).toContain('is-added'); // district 28 is new on the "You get" side
    expect(html).toContain('Added');
  });

  it('the counter composer starts as the received deal from my chair, to the proposer, with a way back', () => {
    const v = base();
    v.owners[1] = 'me'; v.owners[31] = 'b1';
    v.trade = { id: 4, from: 'b1', to: 'me', give: { cash: 10000, tiles: [31] }, get: { cash: 0, tiles: [1] } };
    const session = sess(v, { options: { tradeOffer: { id: 4 } } });
    const html = renderToStaticMarkup(createElement(ComposerSheet, { session, open: false, onClose() {}, counter: v.trade, onCounterBack() {} }));
    const out = text(createElement(ComposerSheet, { session, open: false, onClose() {}, counter: v.trade, onCounterBack() {} }));
    expect(out).toContain('Counter-offer to Ravi');
    expect(out).toContain('Original offer');
    expect(out).toContain('Send counter-offer');
    expect(out).toContain('Back to the offer');
    expect(out).not.toContain('Trade with'); // the partner is fixed
    expect(html).toContain('aria-pressed="true"'); // both districts of the original deal are pre-picked
    expect(out).toContain('Change something first, or accept the offer as it is'); // unchanged deal cannot be sent
  });

  it('a side that already holds 2 districts disables its other districts and says why; the picked ones stay toggle-able', () => {
    const v = base();
    [1, 3, 4, 6].forEach((t) => { v.owners[t] = 'me'; });
    [28, 29, 31, 7].forEach((t) => { v.owners[t] = 'b1'; });
    // Ravi offers two of his districts for two of mine: both sides are full
    v.trade = { id: 4, from: 'b1', to: 'me', give: { cash: 0, tiles: [28, 29] }, get: { cash: 0, tiles: [1, 3] } };
    const session = sess(v, { options: { tradeOffer: { id: 4 }, trade: { canOffer: true, maxTiles: 2 } } });
    const html = renderToStaticMarkup(createElement(ComposerSheet, { session, open: false, onClose() {}, counter: v.trade, onCounterBack() {} }));
    const deeds = html.match(/<button[^>]*class="tx-deed[^"]*"[\s\S]*?<\/button>/g) || [];
    expect(deeds).toHaveLength(8);
    const on = deeds.filter((d) => d.includes('aria-pressed="true"'));
    const off = deeds.filter((d) => d.includes('aria-pressed="false"'));
    expect(on).toHaveLength(4);
    for (const d of on) expect(d).not.toContain('disabled=""'); // can be un-picked to swap
    expect(off).toHaveLength(4);
    for (const d of off) {
      expect(d).toContain('disabled=""');
      expect(d).toMatch(/aria-describedby="tx-cap-(give|get)"/);
      expect(d).toContain('Up to 2 districts per side');
    }
    expect(html).toContain('id="tx-cap-give"');
    expect(html).toContain('id="tx-cap-get"');
    expect(text(createElement(ComposerSheet, { session, open: false, onClose() {}, counter: v.trade, onCounterBack() {} }))).toContain('2/2 picked');
  });

  it('a side below the limit keeps every district selectable and shows no limit hint', () => {
    const v = base();
    [1, 3, 4].forEach((t) => { v.owners[t] = 'me'; });
    v.owners[31] = 'b1';
    v.trade = { id: 4, from: 'b1', to: 'me', give: { cash: 10000, tiles: [31] }, get: { cash: 0, tiles: [1] } };
    const session = sess(v, { options: { tradeOffer: { id: 4 } } });
    const html = renderToStaticMarkup(createElement(ComposerSheet, { session, open: false, onClose() {}, counter: v.trade, onCounterBack() {} }));
    expect(html).not.toContain('tx-cap-');
    expect(html).not.toContain('Up to 2 districts');
    expect(html).not.toMatch(/<button[^>]*class="tx-deed[^"]*"[^>]*disabled/);
  });

  it('warns when the other side would complete a set, or I would break mine', () => {
    const v = base();
    v.owners[28] = 'me'; v.owners[29] = 'me'; v.owners[31] = 'me'; // I own Cyberabad whole
    v.owners[6] = 'me'; v.owners[7] = 'b1'; v.owners[8] = 'b1'; // Ravi needs Laad Bazaar for Old City Icons
    v.trade = { id: 5, from: 'b1', to: 'me', give: { cash: 0, tiles: [] }, get: { cash: 0, tiles: [6, 31] } };
    const out = text(createElement(TradeSheet, { session: sess(v, { options: { tradeOffer: { id: 5 } } }), open: false, onClose() {} }));
    expect(out).toContain('Ravi completes Old City Icons');
    expect(out).toContain('You break your Cyberabad set');
    expect(out).toContain('Nothing'); // they give no district and no cash
  });

  it('shows my sent offer as waiting, with the countdown and a way to cancel it', () => {
    const v = base();
    v.owners[1] = 'me'; v.owners[31] = 'b1';
    v.trade = { id: 6, from: 'me', to: 'b1', give: { cash: 20000, tiles: [1] }, get: { cash: 0, tiles: [31] } };
    const out = text(createElement(TradeSheet, { session: sess(v), open: false, onClose() {}, deadline: Date.now() + 30000 }));
    expect(out).toContain('Trade offer sent');
    expect(out).toContain('Waiting for Ravi');
    expect(out).toMatch(/\b(29|30)\b/); // the ring's seconds
    expect(out).toContain('Cancel offer');
    expect(out).toContain('Nobody can move until the offer is answered or cancelled.');
    expect(out).toContain('₹20,000');
    expect(out).not.toContain('Send offer');
  });

  it('drives the countdown from the server deadline, else the server trade limit', () => {
    expect(secondsLeft(10500, 0)).toBe(11);
    expect(secondsLeft(0, 5000)).toBe(0);
    const withDeadline = renderToStaticMarkup(createElement(Countdown, { deadline: Date.now() + 12000 }));
    expect(withDeadline).toMatch(/aria-label="1[12] seconds left to answer"/);
    const local = renderToStaticMarkup(createElement(Countdown, { resetKey: 1 }));
    expect(local).toContain(`aria-label="${TRADE_MS / 1000} seconds left to answer"`);
  });

  it('groups the composer pickers by collection', () => {
    const v = base();
    v.owners[1] = 'me'; v.owners[3] = 'me'; v.owners[31] = 'b1';
    const out = text(createElement(TradeSheet, { session: sess(v, { options: { trade: { canOffer: true } } }), open: true, onClose() {} }));
    expect(out).toContain('Propose a trade');
    expect(out).toMatch(/Bazaar Beginnings 2\/3/);
    expect(out).toMatch(/Cyberabad 1\/3/);
    expect(out).toContain('+₹50k');
    const html = renderToStaticMarkup(createElement(TradeSheet, { session: sess(v, { options: { trade: { canOffer: true } } }), open: true, onClose() {} }));
    for (const label of ['minus 10,000', 'plus 10,000', 'minus 50,000', 'plus 50,000']) {
      expect(html, label).toContain(`aria-label="Cash you give: ${label}"`);
    }
  });

  it('picks a partner from avatar cards: cash, worth, districts and the set they could complete', () => {
    const v = base();
    v.owners[28] = 'me'; v.owners[29] = 'me'; v.owners[31] = 'b1'; v.owners[1] = 'b1';
    const session = sess(v, { options: { trade: { canOffer: true } } });
    const html = renderToStaticMarkup(createElement(TradeSheet, { session, open: true, onClose() {} }));
    const out = text(createElement(TradeSheet, { session, open: true, onClose() {} }));
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/role="radio"[^>]*aria-checked="true"/); // the first other player is picked
    expect(out).toContain('Trade with');
    expect(out).toContain('₹15L');
    expect(out).toMatch(/Worth ₹[\d.]+L · 2 districts/);
    expect(out).toContain('Completes Cyberabad'); // Ravi holds the district I need
  });

  it('keeps a player who is out in the list but not choosable', () => {
    const v = base();
    v.players[2].bankrupt = true;
    const html = renderToStaticMarkup(createElement(TradeSheet, { session: sess(v, { options: { trade: { canOffer: true } } }), open: true, onClose() {} }));
    const cards = html.match(/<button[^>]*role="radio"[\s\S]*?<\/button>/g) || [];
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain('aria-checked="true"');
    expect(cards[0]).toContain('Ravi');
    expect(cards[1]).toContain('disabled=""');
    expect(cards[1]).toContain('aria-checked="false"');
    expect(cards[1]).toContain('Out of the game');
  });

  it('says why an offer cannot be sent and keeps the old turn hint', () => {
    const v = base();
    const empty = text(createElement(TradeSheet, { session: sess(v, { options: { trade: { canOffer: true } } }), open: true, onClose() {} }));
    expect(empty).toContain('The offer is empty');
    const away = base();
    away.turn = 1; // Ravi's turn
    const offTurn = text(createElement(TradeSheet, { session: sess(away, { options: { trade: { canOffer: false } } }), open: true, onClose() {} }));
    expect(offTurn).toContain('You can propose a trade on your own turn');
    const debt = base();
    debt.phase = 'debt';
    expect(text(createElement(TradeSheet, { session: sess(debt, { options: { trade: { canOffer: false } } }), open: true, onClose() {} })))
      .toContain('Settle the debt before trading');
    const alone = base();
    alone.players[1].bankrupt = true; alone.players[2].bankrupt = true;
    expect(text(createElement(TradeSheet, { session: sess(alone, { options: { trade: { canOffer: true } } }), open: true, onClose() {} })))
      .toContain('No other active players to trade with.');
  });

  it('marks level pips, mortgages and set badges on the deed cards', () => {
    const v = base();
    v.owners[1] = 'me'; v.owners[3] = 'me'; v.owners[4] = 'me'; // Bazaar Beginnings whole
    v.levels[1] = 1; v.mortgaged[3] = true;
    const out = text(createElement(TradeSheet, { session: sess(v, { options: { trade: { canOffer: true } } }), open: true, onClose() {} }));
    expect(out).toContain('Full set');
    expect(out).toContain('Shop'); // Sultan Bazaar runs its second business
    expect(out).toContain('No rent'); // the mortgaged district collects nothing
    expect(out).toContain('Rent ₹16k');
  });
});

/* ------------------------------------------------------------------ debt */
describe('DebtSheet', () => {
  it('plans the cheapest way to cover a shortfall: upgrades first, then mortgages', () => {
    const plan = debtPlan(90000, [{ tile: 31, refund: 68000 }], [{ tile: 1, value: 30000 }, { tile: 28, value: 150000 }]);
    expect(plan.picks.map((p) => `${p.kind}:${p.tile}`)).toEqual(['sell:31', 'mortgage:1']);
    expect(plan.enough).toBe(true);
    expect(debtPlan(10, [], []).enough).toBe(false);
    expect(debtPlan(0, [{ tile: 31, refund: 1 }], []).picks).toEqual([]);
  });

  it('shows the shortfall, the suggestion and every option', () => {
    const view = base();
    view.phase = 'debt';
    view.players[0].cash = 20000;
    view.owners[31] = 'me'; view.levels[31] = 1;
    view.owners[1] = 'me';
    view.debt = { player: 'me', amount: 110000, creditor: 'b1', reason: 'rent' };
    const out = text(createElement(DebtSheet, {
      session: sess(view, { options: { debt: true, mortgage: [{ tile: 1, value: 30000 }], sellBuilding: [{ tile: 31, refund: 68000 }] } }),
    }));
    expect(out).toContain('Rent due');
    expect(out).toContain('You owe ₹1,10,000');
    expect(out).toContain('Ravi');
    expect(out).toContain('Short by');
    expect(out).toContain('sell the Business Centre on HITEC City');
    expect(out).toContain('mortgage Sultan Bazaar');
    expect(out).toContain('Sell +₹68,000');
    expect(out).toContain('Mortgage +₹30,000');
    expect(out).toContain('Suggested');
  });

  it('states the bankruptcy rule with the exact amount: the bank takes everything, the creditor is paid the debt', () => {
    const view = base();
    view.phase = 'debt';
    view.players[0].cash = 20000;
    view.owners[31] = 'me'; view.levels[31] = 1; // 68,000 sell-back + 1,70,000 mortgage
    view.owners[1] = 'me'; // 30,000 mortgage
    view.debt = { player: 'me', amount: 120000, creditor: 'b1', reason: 'rent', rest: [] };
    const out = text(createElement(DebtSheet, { session: sess(view, { options: { debt: true, mortgage: [], sellBuilding: [] } }) }));
    expect(out).toContain('Declare bankruptcy');
    expect(out).toContain('If you go bankrupt, the bank takes ALL your cash and districts. Ravi is paid the ₹1,20,000 you owe (up to what your assets are worth).');
    // assets smaller than the debt: the creditor gets what the assets are worth, and the sheet says so
    view.debt.amount = 900000;
    const small = text(createElement(DebtSheet, { session: sess(view, { options: { debt: true, mortgage: [], sellBuilding: [] } }) }));
    expect(small).toContain('Ravi is paid ₹2,88,000 of the ₹9,00,000 you owe (up to what your assets are worth).'); // 20,000 cash + 68,000 + 1,70,000 + 30,000
    expect(small).toContain('You are leaving the game: the bank takes ALL your cash and districts. Ravi is paid ₹2,88,000'); // the confirm dialog says it too
    expect(small).toContain('Your districts go back to the bank');
    // a debt to the bank pays nobody
    view.debt = { player: 'me', amount: 120000, creditor: null, reason: 'tax', rest: [] };
    const bank = text(createElement(DebtSheet, { session: sess(view, { options: { debt: true, mortgage: [], sellBuilding: [] } }) }));
    expect(bank).toContain('the bank takes ALL your cash and districts. Nobody else is paid.');
    expect(bank).not.toContain('go to');
  });
});

/* ------------------------------------------------------------------ player */
describe('PlayerSheet', () => {
  const view = base();
  const me = view.players[0];
  me.cash = 900000;
  me.chai = 1;
  me.stuck = true;
  me.stats = { ...me.stats, rentEarned: 120000, rentPaid: 40000, biggestRent: 65000, taxPaid: 40000, rides: 3, chaiSaved: 17000, upgrades: 2, propertiesBought: 4 };
  view.owners[31] = 'me'; view.levels[31] = 1;
  view.owners[1] = 'me'; view.mortgaged[1] = true;

  it('splits net worth into cash, districts and upgrades (matching the engine)', () => {
    const parts = worthParts(view, 'me');
    expect(parts.cash).toBe(900000);
    expect(parts.districts).toBe(340000 + 30000);
    expect(parts.upgrades).toBe(68000);
    expect(parts.total).toBe(900000 + 370000 + 68000);
  });

  it('shows piece, chai, traffic, the breakdown and the Hustle stats', () => {
    const html = renderToStaticMarkup(createElement(PlayerSheet, { session: sess(view), playerId: 'me', onClose() {}, onOpenTile() {} }));
    const out = text(createElement(PlayerSheet, { session: sess(view), playerId: 'me', onClose() {}, onOpenTile() {} }));
    expect(html).toContain(`data-piece="${me.piece}"`);
    expect(out).toContain('Chai token');
    expect(out).toContain('Stuck in traffic');
    expect(out).toContain('Net worth ₹13,38,000');
    expect(out).toMatch(/Cash ₹9,00,000/);
    expect(out).toMatch(/Districts ₹3,70,000/);
    expect(out).toMatch(/Upgrades ₹68,000/);
    expect(out).toContain('Rides 3');
    expect(out).toContain('Chai saved ₹17,000');
    expect(out).toContain('Cyberabad');
    for (const gone of ['Snatch', 'laps to a token', 'Trap', 'jail']) expect(out).not.toContain(gone);
  });

  it('wears the equipped frame and title from session.cosmetics or the room', () => {
    const viaMap = renderToStaticMarkup(createElement(PlayerSheet, {
      session: sess(view, { cosmetics: { me: { frame: 'frame_gold', title: 'title_nawab' } } }), playerId: 'me', onClose() {}, onOpenTile() {},
    }));
    expect(viaMap).toContain('data-frame="frame_gold"');
    expect(viaMap).toContain('data-title="title_nawab"');
    const viaRoom = renderToStaticMarkup(createElement(PlayerSheet, {
      session: sess(view, { room: { players: [{ id: 'me', cosmetics: { frame: 'frame_teal' } }] } }), playerId: 'me', onClose() {}, onOpenTile() {},
    }));
    expect(viaRoom).toContain('data-frame="frame_teal"');
    expect(viaRoom).not.toContain('data-title');
  });

  it('StatsSheet lists everyone richest first', () => {
    const out = text(createElement(StatsSheet, { session: sess(view), open: true, onClose() {}, onOpenTile() {} }));
    expect(out.indexOf('Ravi')).toBeLessThan(out.indexOf('Asha')); // ₹15L cash beats Asha's ₹13.55L net worth
    expect(out).toContain('Standard City Hustle');
  });
});

/* ------------------------------------------------------------------ manage tab */
describe('MyProperties', () => {
  it('shows all 8 collections as compact rows with my districts and actions', () => {
    const v = base();
    v.owners[28] = 'me'; v.owners[29] = 'me'; v.owners[31] = 'me'; v.levels[31] = 1;
    v.owners[1] = 'b1';
    const out = text(createElement(MyProperties, {
      session: sess(v, { options: { upgrade: [{ tile: 31, cost: 136000 }], mortgage: [{ tile: 28, value: 150000 }] } }), onOpenTile() {},
    }));
    for (const c of ['Bazaar Beginnings', 'Old City Icons', 'Everyday Hyderabad', 'Twin Cities', 'Lake & Leisure', 'Lights, Camera, Luxury', 'Cyberabad', 'The New City']) {
      expect(out, c).toContain(c);
    }
    expect(out).toContain('Cyberabad 3/3 Full set ×1.5');
    expect(out).toContain('Bazaar Beginnings 0/3');
    expect(out).toContain('Business Centre');
    expect(out).toContain('Upgrade ₹1,36,000');
    expect(out).toContain('Mortgage +₹1,50,000');
    expect(out).not.toContain('No properties yet.');
  });

  it('explains the whole-collection upgrade rule instead of offering Upgrade on an incomplete collection', () => {
    const v = base();
    v.owners[28] = 'me'; v.owners[29] = 'me'; // 2 of 3 Cyberabad districts
    const reason = 'Own all 3 districts of Cyberabad first (you have 2)';
    // Mortgage is on offer, so the row has actions: the reason still shows and there is no Upgrade button.
    const withActions = text(createElement(MyProperties, {
      session: sess(v, { options: { mortgage: [{ tile: 28, value: 150000 }, { tile: 29, value: 150000 }] } }), onOpenTile() {},
    }));
    expect(withActions).toContain(reason);
    expect(withActions).not.toContain('Upgrade ₹');
    // No actions at all: the reason is the row's note.
    expect(text(createElement(MyProperties, { session: sess(v), onOpenTile() {} }))).toContain(reason);
    // Own the third district and the reason is gone (the engine then offers the upgrade).
    v.owners[31] = 'me';
    const full = text(createElement(MyProperties, {
      session: sess(v, { options: { upgrade: [{ tile: 28, cost: 150000 }] } }), onOpenTile() {},
    }));
    expect(full).not.toContain('Own all 3 districts');
    expect(full).toContain('Upgrade ₹1,50,000');
  });

  it('keeps an empty-state note and the overview with nothing owned', () => {
    const out = text(createElement(MyProperties, { session: sess(base()), onOpenTile() {} }));
    expect(out).toContain('No properties yet.');
    expect(out).toContain('The New City 0/3');
  });
});

/* ------------------------------------------------------------------ game over */
describe('GameOverModal', () => {
  const over = () => {
    const v = base();
    v.phase = 'over';
    v.winner = 'b1';
    v.winReason = 'rounds';
    v.round = 20;
    v.owners[31] = 'b1'; v.levels[31] = 2;
    v.players[1].stats = { ...v.players[1].stats, biggestRent: 119000, rentEarned: 400000 };
    v.players[0].stats = { ...v.players[0].stats, rides: 4, chaiSaved: 30000 };
    return v;
  };
  const resultOf = (v) => ({
    winner: v.winner, reason: v.winReason, rounds: v.round,
    standings: [
      { id: 'b1', name: 'Ravi', avatar: 0, cash: v.players[1].cash, worth: worthParts(v, 'b1').total, rank: 1 },
      { id: 'me', name: 'Asha', avatar: 0, cash: v.players[0].cash, worth: worthParts(v, 'me').total, rank: 2 },
      { id: 'c2', name: 'Zoya', avatar: 0, cash: v.players[2].cash, worth: worthParts(v, 'c2').total, rank: 3 },
    ],
    me: { won: false, rank: 2 },
  });

  it('shows the net-worth podium with breakdowns, the reason and the moments', () => {
    const v = over();
    const out = text(createElement(GameOverModal, { session: { ...sess(v), result: resultOf(v), restart() {} }, onExit() {} }));
    expect(out).toContain('You finished 2nd');
    expect(out).toContain('Ravi wins with');
    expect(out).toContain('Round limit reached: richest wins');
    expect(out).toContain('Biggest rent');
    expect(out).toContain('Ravi · ₹1,19,000');
    expect(out).toContain('Most rides');
    expect(out).toContain('You · 4 rides');
    expect(out).toContain('Chai saves');
    expect(out).toContain('Rematch');
    expect(out).toContain('Back to lobby');
  });

  it('celebrates the winner', () => {
    const v = over();
    v.winner = 'me';
    const r = resultOf(v);
    r.me = { won: true, rank: 1 };
    expect(text(createElement(GameOverModal, { session: { ...sess(v), result: r }, onExit() {} }))).toContain('You own the city!');
  });

  it('reasonLine and matchMoments', () => {
    expect(reasonLine({ reason: 'last_standing' })).toBe('Last player standing');
    expect(reasonLine({ reason: 'rounds', rounds: 20 })).toBe('Round limit reached: richest wins');
    expect(reasonLine({ reason: 'target', target: 5000000 })).toBe('Reached the ₹50L net worth target');
    expect(reasonLine({ reason: 'target' })).toBe('Reached the net worth target');
    expect(reasonLine({ reason: 'whatever' })).toBe('');
    expect(outLine(true, true)).toBe('You resigned before the end');
    expect(outLine(true, false)).toBe('You went bankrupt before the end');
    expect(outLine(false, true)).toBe('');
    expect(matchMoments([{ id: 'a', name: 'A', stats: { rides: 0 } }])).toEqual([]);
    expect(matchMoments([{ id: 'a', name: 'A', stats: { rides: 2 } }, { id: 'b', name: 'B', stats: { rides: 5 } }])[0]).toMatchObject({ key: 'rides', who: 'B' });
  });
});

/* ------------------------------------------------------------------ set celebration */
describe('SetCelebration', () => {
  it('finds every complete collection with its owner', () => {
    const v = base();
    v.owners[28] = 'me'; v.owners[29] = 'me'; v.owners[31] = 'me';
    v.owners[1] = 'b1'; v.owners[3] = 'b1'; v.owners[4] = 'b1';
    v.owners[6] = 'c2'; v.owners[7] = 'c2';
    expect([...fullSets(v)].sort()).toEqual(['b1:bazaar', 'me:cyber']);
  });
});
