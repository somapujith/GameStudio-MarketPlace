// Render + logic tests for the Hustle sheets: rules, auction, trade, debt, player, Manage tab, game over and the set
// celebration. States come from the real engine (createGame) and are shaped by hand per docs/HUSTLE_PLAN.md 3.7.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '@shared/index.js';

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
const { default: AuctionSheet, auctionInstance, auctionReason } = await import('./AuctionSheet.jsx');
const { default: DebtSheet, debtPlan } = await import('./DebtSheet.jsx');
const { default: TradeSheet, Countdown, completedGroups, secondsLeft, sideValue } = await import('./TradeSheet.jsx');
const { default: PlayerSheet, StatsSheet } = await import('./PlayerSheet.jsx');
const { default: MyProperties } = await import('./MyProperties.jsx');
const { default: GameOverModal, matchMoments, reasonLine } = await import('./GameOverModal.jsx');
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
      'one die', 'A six rolls again', '₹2,00,000', 'City Takeover', 'one sealed bid',
      'Three businesses per district', 'Startup Office', 'Business Centre', 'Tech Campus', 'Bazaar Beginnings', 'Stall → Shop → Trading Hub',
      'Full set bonus', 'first businesses', '×1.5',
      'Transport shortcut', 'Auto Stand (₹25,000)', 'Metro Interchange (₹35,000)', 'MMTS Express (₹45,000)', 'Meter kharab hai',
      'Traffic Jam', 'Ameerpet traffic', '₹25,000', 'Chai Adda', 'hold at most 1', '₹20,000',
      'Municipal Charges', '₹40,000', '₹10,000', 'Bazaar Auction', 'Nawabi Luck', 'City Drama',
      'Hyderabad Rush Hour', 'Every 3 rounds', 'Biryani Business Boom', 'Wedding Season', 'Monsoon',
      'Net worth', 'half of what you spent on upgrades', 'unpaid debt', 'last player standing',
    ]) expect(out, s).toContain(s);
  });

  it('says upgrading needs the whole collection', () => {
    expect(out).toContain('every district of its collection');
    expect(out).not.toContain('no full set needed');
  });

  it('has no trace of the removed rules', () => {
    for (const gone of ['Snatch', 'Shield', 'trap', 'Trap', 'jail', 'Jail', 'hotel', 'Hotel', 'utility', 'Kismet', 'Rajiv Gandhi']) expect(out, gone).not.toContain(gone);
    expect(out.toLowerCase()).not.toContain('two dice');
  });

  it('marks the current mode', () => {
    const quick = renderToStaticMarkup(createElement(RulesSheet, { open: true, onClose() {}, session: { view: base({ settings: { mode: 'quick' } }) } }));
    expect(quick).toMatch(/class="is-on"><b>Quick Chai Break/);
  });
});

/* ------------------------------------------------------------------ auction */
describe('AuctionSheet', () => {
  const auctionView = (reason, bids = {}) => {
    const view = base();
    view.phase = 'auction';
    view.pending = { type: 'auction', tile: 31, minBid: 34000, bids, reason, returnPhase: 'manage' };
    return view;
  };
  const render = (view, options = { bid: { min: 34000, max: 1500000 } }) => text(createElement(AuctionSheet, { session: sess(view, { options }) }));

  it('labels a City Takeover and shows the district, collection and price', () => {
    const out = render(auctionView('decline'));
    expect(out).toContain('City Takeover');
    expect(out).toContain('HITEC City');
    expect(out).toContain('Cyberabad');
    expect(out).toContain('₹3,40,000');
    expect(out).toContain('You passed on it');
    expect(out).toContain('Minimum bid');
    expect(out).toContain('Startup Office');
  });

  it('labels the Bazaar Auction and the unaffordable takeover', () => {
    expect(render(auctionView('bazaar'))).toContain('Bazaar Auction');
    expect(render(auctionView('unaffordable'))).toContain('could not afford it');
  });

  it('offers Min / +10% / +25% quick bids', () => {
    const out = render(auctionView('decline'));
    expect(out).toContain('Min ₹34,000');
    expect(out).toContain('+10% ₹68,000');
    expect(out).toContain('+25% ₹1,19,000');
    expect(out).toContain('Place bid · ₹34,000');
  });

  it('ticks who has bid without showing amounts', () => {
    const out = render(auctionView('decline', { b1: null }));
    expect(out).toMatch(/Ravi has bid/);
    expect(out).toMatch(/Zoya thinking/);
  });

  it('waits with my sealed bid once I have bid', () => {
    const out = render(auctionView('decline', { me: 50000, b1: null }), { bid: null });
    expect(out).toContain('Sealed bid: ₹50,000');
    expect(out).toContain('Waiting for others (2/3)');
    expect(out).not.toContain('Place bid');
  });

  it('infers the reason when the engine does not say', () => {
    const v = auctionView(undefined);
    v.players[v.turn].pos = 32;
    expect(auctionReason(v, v.pending)).toBe('bazaar');
    v.players[v.turn].pos = 31;
    expect(auctionReason(v, v.pending)).toBe('decline');
    v.players[v.turn].cash = 1000;
    expect(auctionReason(v, v.pending)).toBe('unaffordable');
  });

  it('auctionInstance differs per auction', () => {
    const a = { tile: 15, reason: 'decline' };
    const first = auctionInstance({ round: 5, turnCount: 17 }, a);
    expect(auctionInstance({ round: 9, turnCount: 33 }, a)).not.toBe(first);
    expect(auctionInstance({ round: 5, turnCount: 17 }, { tile: 15, reason: 'bazaar' })).not.toBe(first);
    expect(auctionInstance({ round: 5, turnCount: 17 }, a)).toBe(first);
    expect(auctionInstance({ round: 5, turnCount: 17 }, null)).toBeNull();
  });
});

/* ------------------------------------------------------------------ trade */
describe('TradeSheet', () => {
  it('values a side like net worth', () => {
    const v = base();
    v.levels[31] = 2;
    v.mortgaged[1] = true;
    expect(sideValue(v, { cash: 10000, tiles: [31] })).toBe(10000 + 340000 + 170000);
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
    expect(out).toContain('Completes Cyberabad !');
    expect(out).toContain('CYBERABAD'.charAt(0)); // collection header present
    expect(out).toMatch(/Cyberabad\s+HITEC City/);
    expect(out).toMatch(/\b(19|20) seconds left|>(19|20)</.source ? out : out);
  });

  it('drives the countdown from the server deadline, else a local 30 s', () => {
    expect(secondsLeft(10500, 0)).toBe(11);
    expect(secondsLeft(0, 5000)).toBe(0);
    const withDeadline = renderToStaticMarkup(createElement(Countdown, { deadline: Date.now() + 12000 }));
    expect(withDeadline).toMatch(/aria-label="1[12] seconds left to answer"/);
    const local = renderToStaticMarkup(createElement(Countdown, { resetKey: 1 }));
    expect(local).toContain('aria-label="30 seconds left to answer"');
  });

  it('groups the composer pickers by collection', () => {
    const v = base();
    v.owners[1] = 'me'; v.owners[3] = 'me'; v.owners[31] = 'b1';
    const out = text(createElement(TradeSheet, { session: sess(v, { options: { trade: { canOffer: true } } }), open: true, onClose() {} }));
    expect(out).toContain('Propose a trade');
    expect(out).toMatch(/Bazaar Beginnings 2\/3/);
    expect(out).toMatch(/Cyberabad 1\/3/);
    expect(out).toContain('+10k');
  });
});

/* ------------------------------------------------------------------ debt */
describe('DebtSheet', () => {
  it('plans the cheapest way to cover a shortfall: upgrades first, then mortgages', () => {
    const plan = debtPlan(100000, [{ tile: 31, refund: 85000 }], [{ tile: 1, value: 30000 }, { tile: 28, value: 150000 }]);
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
    view.debt = { player: 'me', amount: 120000, creditor: 'b1', reason: 'rent' };
    const out = text(createElement(DebtSheet, {
      session: sess(view, { options: { debt: true, mortgage: [{ tile: 1, value: 30000 }], sellBuilding: [{ tile: 31, refund: 85000 }] } }),
    }));
    expect(out).toContain('Rent due');
    expect(out).toContain('You owe ₹1,20,000');
    expect(out).toContain('Ravi');
    expect(out).toContain('Short by');
    expect(out).toContain('sell the Business Centre on HITEC City');
    expect(out).toContain('mortgage Sultan Bazaar');
    expect(out).toContain('Sell +₹85,000');
    expect(out).toContain('Mortgage +₹30,000');
    expect(out).toContain('Suggested');
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
    expect(parts.upgrades).toBe(85000);
    expect(parts.total).toBe(900000 + 370000 + 85000);
  });

  it('shows piece, chai, traffic, the breakdown and the Hustle stats', () => {
    const html = renderToStaticMarkup(createElement(PlayerSheet, { session: sess(view), playerId: 'me', onClose() {}, onOpenTile() {} }));
    const out = text(createElement(PlayerSheet, { session: sess(view), playerId: 'me', onClose() {}, onOpenTile() {} }));
    expect(html).toContain(`data-piece="${me.piece}"`);
    expect(out).toContain('Chai token');
    expect(out).toContain('Stuck in traffic');
    expect(out).toContain('Net worth ₹13,55,000');
    expect(out).toMatch(/Cash ₹9,00,000/);
    expect(out).toMatch(/Districts ₹3,70,000/);
    expect(out).toMatch(/Upgrades ₹85,000/);
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
      session: sess(v, { options: { upgrade: [{ tile: 31, cost: 170000 }], mortgage: [{ tile: 28, value: 150000 }] } }), onOpenTile() {},
    }));
    for (const c of ['Bazaar Beginnings', 'Old City Icons', 'Everyday Hyderabad', 'Twin Cities', 'Lake & Leisure', 'Lights, Camera, Luxury', 'Cyberabad', 'The New City']) {
      expect(out, c).toContain(c);
    }
    expect(out).toContain('Cyberabad 3/3 Full set ×1.5');
    expect(out).toContain('Bazaar Beginnings 0/3');
    expect(out).toContain('Business Centre');
    expect(out).toContain('Upgrade ₹1,70,000');
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
    expect(out).toContain('After 20 rounds, the richest hustler wins');
    expect(out).toContain('Biggest rent');
    expect(out).toContain('Ravi · ₹1,19,000');
    expect(out).toContain('Most rides');
    expect(out).toContain('You · 4 rides');
    expect(out).toContain('Chai saves');
    expect(out).toContain('Play again');
    expect(out).toContain('Home');
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
