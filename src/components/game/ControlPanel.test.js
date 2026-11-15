// Control panel + action row under the Hustle rules (docs/HUSTLE_PLAN.md 3.7). The engine is not under test:
// views and options are built by hand, so these tests hold for the old and the new board alike.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import ControlPanel, { TABS, TradePane, landedInfo, panelBadges, statusLine } from './ControlPanel.jsx';
import ActionBar, { buildActionSpec, rideLabel, rideVehicle, shortcutAction } from './ActionBar.jsx';
import MoneyBar, { ChaiToken } from './MoneyBar.jsx';
import { CENTER_LINES, LogList, centerLines } from './LogPanel.jsx';

/** renderToString separates adjacent text nodes with comment markers; drop them so text assertions read naturally. */
const html = (node) => renderToString(node).replaceAll('<!-- -->', '');

const N = TILES.length;
const PROP = TILES.find((t) => t.type === 'property');
const STOPS = TILES.filter((t) => t.type === 'transport');

const P = (id, name, extra = {}) => ({
  id, name, avatar: 0, color: id === 'me' ? '#ff4d6d' : '#3ddc97', cash: 1500000, pos: 0, stuck: false, chai: 0, bankrupt: false, ...extra,
});

function mkView(extra = {}) {
  return {
    phase: 'roll', turn: 0, round: 3, turnCount: 5, extraRoll: false,
    players: [P('me', 'Nithin'), P('rav', 'Ravi')],
    owners: Array(N).fill(null), levels: Array(N).fill(0), mortgaged: Array(N).fill(false),
    cfg: { mode: 'standard', maxRounds: 20, startCash: 1500000, passStart: 200000, dice: 'lucky', trafficFine: 25000, chaiCap: 1 },
    pending: null, trade: null, debt: null, event: null, dice: [], ride: null,
    ...extra,
  };
}

/** A session shaped like useOnlineGame's: display mirrors view, options by hand. */
function mkSession(view, extra = {}) {
  const display = {
    players: view.players, owners: view.owners, levels: view.levels, mortgaged: view.mortgaged,
    turn: view.turn, round: view.round, dice: view.dice, phase: view.phase, cfg: view.cfg,
  };
  return {
    mode: 'online', me: 'me', view, display, busy: false, rolling: false, result: null,
    options: {}, log: [], dispatch: () => {}, clock: null, roomPlayers: [], ...extra,
  };
}

const keys = (spec) => spec.secondaries.map((x) => x.key);

describe('buildActionSpec: rolling and ending', () => {
  it('offers Roll (Space) on my turn, nothing else yet', () => {
    const spec = buildActionSpec(mkSession(mkView(), { options: { roll: true } }));
    expect(spec.kind).toBe('roll');
    expect(spec.primary.action).toEqual({ type: 'ROLL' });
    expect(spec.primary.kbd).toBe('Space');
    expect(spec.secondaries).toEqual([]);
  });

  it('describes a six as rolling again', () => {
    const spec = buildActionSpec(mkSession(mkView({ phase: 'manage', extraRoll: true }), { options: { roll: true } }));
    expect(spec.primary.label).toBe('Roll again');
    expect(spec.sr).toBe('Six! Roll again');
  });

  it('offers End turn as the primary in manage', () => {
    const spec = buildActionSpec(mkSession(mkView({ phase: 'manage' }), { options: { endTurn: true, upgrade: [1, 3] } }));
    expect(spec.kind).toBe('end');
    expect(spec.primary.action).toEqual({ type: 'END_TURN' });
    expect(spec.upgrades).toBe(2);
  });

  it('shows a waiting status while another player is on turn', () => {
    const spec = buildActionSpec(mkSession(mkView(), { me: 'rav' }));
    expect(spec.primary).toBeNull();
    expect(spec.label).toBe('Waiting for Nithin');
    expect(spec.waitFor.id).toBe('me');
  });

  it('is a quiet busy slot while the presenter animates', () => {
    expect(buildActionSpec(mkSession(mkView(), { busy: true, options: { roll: true } })).kind).toBe('busy');
  });
});

describe('buildActionSpec: buying', () => {
  const buyView = () => mkView({ phase: 'buy', pending: { type: 'buy', tile: PROP.id, price: PROP.price } });

  it('offers Buy with the name and price, and Pass (no auction: the district stays free)', () => {
    const spec = buildActionSpec(mkSession(buyView(), { options: { buy: true, skipBuy: true } }));
    expect(spec.kind).toBe('buy');
    expect(spec.primary.label).toBe(`Buy ${PROP.short ?? PROP.name}`);
    expect(spec.primary.action).toEqual({ type: 'BUY' });
    const skip = spec.secondaries.find((x) => x.key === 'skip');
    expect(skip.label).toBe('Pass');
    expect(skip.sub).toMatch(/no auction/i);
    expect(skip.wide).toBeFalsy();
    expect(skip.action).toEqual({ type: 'SKIP_BUY' });
    expect(spec.sr).toMatch(/no auction/i);
  });

  it('never talks about an auction for a pass, whatever an old cfg still carries', () => {
    const v = buyView();
    v.cfg.auctionOnDecline = true; // a game stored before the rule was retired
    const spec = buildActionSpec(mkSession(v, { options: { buy: true, skipBuy: true } }));
    const skip = spec.secondaries.find((x) => x.key === 'skip');
    expect(skip.label).toBe('Pass');
    expect(JSON.stringify(spec)).not.toMatch(/put (it )?up for auction|sealed|bids/i);
  });

  it('makes Pass the primary when the buyer cannot afford the district', () => {
    const v = buyView();
    v.players[0].cash = 10;
    const spec = buildActionSpec(mkSession(v, { options: { skipBuy: true } }));
    expect(spec.kind).toBe('skip');
    expect(spec.primary.label).toBe('Pass');
    expect(spec.primary.sub).toMatch(/^Need ₹/);
  });

  it('never fires Buy or Pass from Space / Enter', () => {
    const spec = buildActionSpec(mkSession(buyView(), { options: { buy: true, skipBuy: true } }));
    expect(shortcutAction(spec, { key: ' ' })).toBeNull();
    expect(shortcutAction(spec, { key: 'Enter' })).toBeNull();
  });
});

describe('buildActionSpec: traffic jam', () => {
  const stuck = (opts) => mkSession(mkView({ players: [P('me', 'Nithin', { stuck: true, chai: opts.useChai ? 1 : 0 }), P('rav', 'Ravi')] }), { options: { roll: true, ...opts } });

  it('offers Use chai first when I hold one, then Pay and Wait it out', () => {
    const spec = buildActionSpec(stuck({ payTraffic: 25000, useChai: true }));
    expect(spec.kind).toBe('traffic');
    expect(spec.primary.action).toEqual({ type: 'USE_CHAI' });
    expect(keys(spec)).toEqual(['pay', 'wait']);
    expect(spec.secondaries[0].label).toBe('Pay ₹25,000');
    expect(spec.secondaries[0].action).toEqual({ type: 'PAY_TRAFFIC' });
    expect(spec.secondaries[1].action).toEqual({ type: 'ROLL' });
    expect(spec.secondaries[1].label).toBe('Wait it out');
    expect(spec.hint.text).toMatch(/Traffic Jam/);
  });

  it('offers Pay as the primary without chai', () => {
    const spec = buildActionSpec(stuck({ payTraffic: 25000, useChai: false }));
    expect(spec.primary.label).toBe('Pay ₹25,000');
    expect(keys(spec)).toEqual(['wait']);
  });

  it('only offers Wait it out when the fine is unaffordable and there is no chai', () => {
    const spec = buildActionSpec(stuck({ payTraffic: false, useChai: false }));
    expect(spec.primary.label).toBe('Wait it out');
    expect(spec.primary.action).toEqual({ type: 'ROLL' });
    expect(spec.secondaries).toEqual([]);
  });

  it('never fires a traffic choice from Space', () => {
    expect(shortcutAction(buildActionSpec(stuck({ payTraffic: 25000 })), { key: ' ' })).toBeNull();
  });
});

describe('rides', () => {
  it('names the vehicle from the stop', () => {
    expect(rideVehicle({ name: 'Auto Stand' })).toBe('Auto');
    expect(rideVehicle({ name: 'Metro Interchange' })).toBe('Metro');
    expect(rideVehicle({ name: 'MMTS Express' })).toBe('MMTS');
    expect(rideVehicle({ name: 'Somewhere' })).toBe('ride');
  });

  it('offers the ride as a full-width row beside End turn', () => {
    const from = STOPS[0]?.id ?? 5;
    const to = STOPS[1]?.id ?? 14;
    const v = mkView({ phase: 'manage', players: [P('me', 'Nithin', { pos: from }), P('rav', 'Ravi')] });
    const spec = buildActionSpec(mkSession(v, { options: { endTurn: true, ride: { to, fare: 25000 } } }));
    expect(spec.primary.action).toEqual({ type: 'END_TURN' });
    const ride = spec.secondaries.find((x) => x.key === 'ride');
    expect(ride.wide).toBe(true);
    expect(ride.action).toEqual({ type: 'RIDE' });
    expect(ride.label).toBe(rideLabel({ to, fare: 25000 }, from));
    expect(ride.label).toMatch(/^(Take the (Auto|Metro|MMTS)|Ride) to .+ for ₹25,000$/);
  });

  it('is absent without options.ride', () => {
    const spec = buildActionSpec(mkSession(mkView({ phase: 'manage' }), { options: { endTurn: true, ride: null } }));
    expect(keys(spec)).not.toContain('ride');
  });
});

describe('Space / Enter shortcut', () => {
  const ev = (over = {}) => ({ key: ' ', target: null, ...over });

  it('fires Roll and End turn, which advertise a kbd', () => {
    expect(shortcutAction(buildActionSpec(mkSession(mkView(), { options: { roll: true } })), ev())).toEqual({ type: 'ROLL' });
    expect(shortcutAction(buildActionSpec(mkSession(mkView({ phase: 'manage' }), { options: { endTurn: true } })), ev({ key: 'Enter' }))).toEqual({ type: 'END_TURN' });
  });

  it('stands down for sheets, typing, modifiers, repeats and other keys', () => {
    const spec = buildActionSpec(mkSession(mkView(), { options: { roll: true } }));
    expect(shortcutAction(spec, ev(), true)).toBeNull();
    expect(shortcutAction(spec, ev({ target: { tagName: 'INPUT' } }))).toBeNull();
    expect(shortcutAction(spec, ev({ ctrlKey: true }))).toBeNull();
    expect(shortcutAction(spec, ev({ repeat: true }))).toBeNull();
    expect(shortcutAction(spec, ev({ key: 'a' }))).toBeNull();
  });
});

describe('landedInfo (Hustle squares)', () => {
  const T = [
    { id: 0, type: 'start', name: 'START' },
    { id: 1, type: 'property', name: 'Sultan Bazaar', price: 60000, group: 'bazaar' },
    { id: 2, type: 'card', deck: 'luck', name: 'Nawabi Luck' },
    { id: 3, type: 'transport', name: 'Auto Stand', fare: 25000 },
    { id: 4, type: 'traffic', name: 'Traffic Jam' },
    { id: 5, type: 'chai', name: 'Chai Adda' },
    { id: 6, type: 'municipal', name: 'Municipal Charges' },
    { id: 7, type: 'auction', name: 'Bazaar Auction' },
    { id: 8, type: 'card', deck: 'drama', name: 'City Drama' },
  ];
  const s = () => mkView();
  const at = (pos, extra = {}) => P('me', 'Nithin', { pos, ...extra });

  it('says what an unowned district costs, and who owns a taken one', () => {
    const v = s();
    expect(landedInfo(v, at(1), 'me', 4, T).detail).toBe('For sale ₹60,000');
    v.owners[1] = 'rav';
    expect(landedInfo(v, at(1), 'me', 4, T).detail).toMatch(/^Owned by Ravi · rent ₹/);
    v.mortgaged[1] = true;
    expect(landedInfo(v, at(1), 'me', 4, T).detail).toBe('Owned by Ravi · mortgaged, no rent');
    v.owners[1] = 'me';
    expect(landedInfo(v, at(1), 'me', 4, T).tone).toBe('mine');
  });

  it('describes cards, rides, traffic, chai, municipal charges, the auction and START', () => {
    const v = s();
    expect(landedInfo(v, at(2), 'me', 4, T).detail).toBe('Draw a Nawabi Luck card');
    expect(landedInfo(v, at(8), 'me', 4, T).detail).toBe('Draw a City Drama card');
    expect(landedInfo(v, at(3), 'me', 4, T).detail).toBe('Take the Auto to the next stop for ₹25,000');
    expect(landedInfo(v, at(4, { stuck: true }), 'me', 4, T).tone).toBe('warn');
    expect(landedInfo(v, at(4, { stuck: true }), 'me', 4, T).detail).toContain('₹25,000');
    expect(landedInfo(v, at(5), 'me', 4, T).detail).toBe('Chai Adda · free chai token');
    expect(landedInfo(v, at(5, { chai: 1 }), 'me', 4, T).detail).toContain('already');
    expect(landedInfo(v, at(6), 'me', 4, T).detail).toBe('Pay ₹40,000');
    v.owners[1] = 'me';
    v.levels[1] = 2;
    expect(landedInfo(v, at(6), 'me', 4, T).detail).toBe('Pay ₹60,000 (₹40,000 + ₹10,000 x 2 upgrades)');
    expect(landedInfo(v, at(7), 'me', 4, T).detail).toMatch(/Auction/);
    expect(landedInfo(v, at(0), 'me', 4, T).detail).toBe('Collect ₹2,00,000 when you pass');
  });
});

describe('<ControlPanel>', () => {
  it('renders Play / Manage / Trade, the log, the landed line, the Roll button and one die', () => {
    const session = mkSession(mkView(), { options: { roll: true }, log: [{ id: 1, text: 'Nithin rolled 4', tone: 'info' }] });
    const out = html(createElement(ControlPanel, { session, onOpenTile: () => {}, onOpenTrade: () => {} }));
    for (const t of TABS) expect(out).toContain(`>${t.label}<`);
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-selected="true"');
    expect(out).toContain('Nithin rolled 4');
    expect(out).toContain(TILES[0].name);
    expect(out).toContain('cp-primary is-roll');
    expect((out.match(/class="cp-cube"/g) || []).length).toBe(1);
    expect(out).not.toMatch(/snatch|shield|trap|bail|jail card/i);
  });

  it('shows the waiting state instead of a button when it is not my turn', () => {
    const out = html(createElement(ControlPanel, { session: mkSession(mkView(), { me: 'rav' }) }));
    expect(out).toContain('Waiting for Nithin');
    expect(out).toContain('is-wait');
  });

  it('docked (phones): no tabs and no action row in the board centre', () => {
    const out = html(createElement(ControlPanel, { session: mkSession(mkView(), { options: { roll: true } }), docked: true }));
    expect(out).not.toContain('role="tablist"');
    expect(out).not.toContain('cp-primary');
    expect(out).not.toContain('tt-bar'); // the dock carries the timer
    expect(out).toContain('cp-clog');
    expect(out).toContain('Your turn — roll!');
  });

  it('keeps the middle quiet: no cash, round or player card, just die + status + log', () => {
    const out = html(createElement(ControlPanel, { session: mkSession(mkView(), { options: { roll: true } }) }));
    expect(out).not.toContain('₹15,00,000');
    expect(out).not.toContain('cp-who');
    expect(out).not.toMatch(/Round 3/);
    expect(out).toContain('cp-status');
    expect(out).toContain('cp-clog');
    expect(out).toContain('--pc:#ff4d6d'); // the mat glows in the turn player's colour
  });

  it('shows a slim decision timer bar under the status line while the clock waits for me (the ring lives on the pod)', () => {
    const clock = { deadline: Date.now() + 30000, waitingFor: ['me'] };
    const out = html(createElement(ControlPanel, { session: mkSession(mkView(), { options: { roll: true }, clock }) }));
    expect(out).toContain('tt-bar is-mine');
    expect(out).toContain('Your move');
    expect(out.indexOf('cp-status')).toBeLessThan(out.indexOf('tt-bar'));
    expect(out).not.toContain('tt-ring');
    expect(out).not.toContain('is-warn');
  });

  it('warns only the local player in the last 10 seconds', () => {
    const mine = html(createElement(ControlPanel, { session: mkSession(mkView(), { clock: { deadline: Date.now() + 6000, waitingFor: ['me'] } }) }));
    expect(mine).toContain('tt-bar is-mine is-warn');
    const theirs = html(createElement(ControlPanel, { session: mkSession(mkView(), { me: 'rav', clock: { deadline: Date.now() + 6000, waitingFor: ['me'] } }) }));
    expect(theirs).toContain('Waiting for Nithin');
    expect(theirs).not.toContain('is-warn');
  });

  it('hides the timer without a deadline', () => {
    const out = html(createElement(ControlPanel, { session: mkSession(mkView(), { clock: { deadline: null, waitingFor: [] } }) }));
    expect(out).not.toContain('tt-bar');
    expect(out).not.toContain('tt-ring is-on');
  });

  it('shows the traffic way-outs of the player on turn (chai and the traffic tag live in the pods)', () => {
    const v = mkView({ players: [P('me', 'Nithin', { chai: 1, stuck: true }), P('rav', 'Ravi')] });
    const out = html(createElement(ControlPanel, { session: mkSession(v, { options: { roll: true, payTraffic: 25000, useChai: true } }) }));
    expect(out).toContain('Stuck in traffic — your move');
    expect(out).toContain('Stuck in Traffic Jam: pay the fine');
    expect(out).toContain('Use chai');
    expect(out).toContain('Wait it out');
  });

  it('keeps the log empty-state friendly', () => {
    expect(html(createElement(LogList, { log: [], variant: 'mono' }))).toContain('Your story starts with a roll.');
    expect(html(createElement(LogList, { log: [], variant: 'center' }))).toContain('Your story starts with a roll.');
  });

  it('segmented tabs: the thumb follows the selected tab and Manage / Trade keep their badges', () => {
    const v = mkView({ phase: 'manage', trade: { from: 'rav', to: 'me' } });
    const out = html(createElement(ControlPanel, { session: mkSession(v, { options: { endTurn: true, upgrade: [1, 3] } }) }));
    expect(out).toContain('cp-tabs__thumb');
    expect(out).toContain('--i:0');
    expect(out).toContain('aria-label="2 can be upgraded"');
    expect(out).toContain('aria-label="A trade offer is open"');
    expect(out).toContain('cp-tab is-on');
  });

  it('puts the tile being played in a chip that still opens the sheet', () => {
    const out = html(createElement(ControlPanel, { session: mkSession(mkView(), { options: { roll: true } }) }));
    expect(out).toMatch(/aria-label="[^"]+\. Open details"/);
    expect(out).toContain('cp-landed');
  });
});

describe('statusLine', () => {
  const mine = (spec, extra = {}, view = {}) => statusLine(mkSession(mkView(view), extra), spec);

  it('says "Your turn — roll!" on my turn at the roll phase, and the six case', () => {
    const roll = buildActionSpec(mkSession(mkView(), { options: { roll: true } }));
    expect(mine(roll, { options: { roll: true } })).toEqual({ tone: 'mine', text: 'Your turn — roll!', name: 'You' });
    const six = buildActionSpec(mkSession(mkView({ phase: 'manage', extraRoll: true }), { options: { roll: true } }));
    expect(mine(six, { options: { roll: true } }, { phase: 'manage', extraRoll: true }).text).toBe('Six! Roll again');
  });

  it('says "<Name> is playing…" for someone else, whatever I am offered', () => {
    const s = statusLine(mkSession(mkView(), { me: 'rav' }), null);
    expect(s).toEqual({ tone: 'other', text: 'Nithin is playing…', name: 'Nithin' });
    const bought = statusLine(mkSession(mkView({ phase: 'buy' }), { me: 'rav' }), { kind: 'busy' });
    expect(bought.text).toBe('Nithin is playing…');
  });

  it("follows my decision: traffic, buy, can't afford, end of turn, anything else", () => {
    expect(mine({ kind: 'traffic' }).text).toBe('Stuck in traffic — your move');
    expect(mine({ kind: 'buy' }).text).toBe('Your turn — buy it?');
    expect(mine({ kind: 'skip' }).text).toMatch(/afford/);
    expect(mine({ kind: 'end' }).text).toBe('Your turn — end it when ready');
    expect(mine({ kind: 'busy' }).text).toBe('You are playing…');
    expect(mine({ kind: 'busy' }, { rolling: true }).text).toBe('Rolling…');
  });

  it('says "Final" when the game is over, and handles auctions, debts and an empty table', () => {
    expect(statusLine(mkSession(mkView({ phase: 'over' })), null)).toMatchObject({ tone: 'final', text: 'Final' });
    expect(statusLine(mkSession(mkView(), { result: { winner: 'me' } }), null).text).toBe('Final');
    expect(statusLine(mkSession(mkView({ phase: 'auction' })), null).text).toBe('Auction in progress…');
    expect(statusLine(mkSession(mkView({ phase: 'auction' }), { options: { bid: true } }), null).text).toBe('Auction — place your bid');
    expect(statusLine(mkSession(mkView({ phase: 'debt', debt: { player: 'rav' } })), null).text).toBe('Ravi is settling a debt…');
    expect(statusLine(mkSession(mkView({ phase: 'debt', debt: { player: 'me' } })), null).text).toBe('Settle your debt');
    expect(statusLine({ view: { players: [], turn: 0, phase: 'roll' }, me: 'me' }, null).tone).toBe('idle');
  });

  it('renders under the die, with a colour dot for the player, and "Final" without one', () => {
    const live = html(createElement(ControlPanel, { session: mkSession(mkView(), { me: 'rav' }) }));
    expect(live).toContain('Nithin is playing…');
    expect(live).toContain('cp-status__dot');
    const over = html(createElement(ControlPanel, { session: mkSession(mkView({ phase: 'over' })) }));
    expect(over).toContain('>Final<');
    expect(over).not.toContain('cp-status__dot');
  });
});

describe('<LogList variant="center">', () => {
  const lines = (n, tone = 'info') => Array.from({ length: n }, (_, i) => ({ id: i + 1, text: `line ${i + 1}`, tone: i % 3 === 0 ? tone : 'good' }));

  it('keeps only the last few lines, oldest first, with the newest at age 0', () => {
    const c = centerLines(lines(10));
    expect(c).toHaveLength(CENTER_LINES);
    expect(c.map((l) => l.entry.text)).toEqual(['line 5', 'line 6', 'line 7', 'line 8', 'line 9', 'line 10']);
    expect(c.map((l) => l.age)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(centerLines(lines(2)).map((l) => l.age)).toEqual([1, 0]);
    expect(centerLines([])).toEqual([]);
    expect(centerLines(lines(10), 3)).toHaveLength(3);
  });

  it('renders centred, tone-coloured lines with their age for the CSS fade, and stays silent', () => {
    const log = [{ id: 1, text: 'Ravi got stuck', tone: 'bad' }, { id: 2, text: 'Sana bought Tolichowki', tone: 'good' }, { id: 3, text: 'Round 7 begins' }];
    const out = html(createElement(LogList, { log, variant: 'center' }));
    expect(out).toContain('class="cp-clog"');
    expect(out).toContain('role="log"');
    expect(out).toContain('aria-live="off"');
    expect(out).toContain('cp-clog__line is-bad" data-age="2"');
    expect(out).toContain('cp-clog__line is-good" data-age="1"');
    expect(out).toContain('cp-clog__line is-info" data-age="0"');
    expect(out).not.toContain('tabindex');
    expect(out).not.toContain('is-fresh'); // lines that were there at the first paint do not animate in
  });

  it('leaves the other variants alone', () => {
    const log = lines(3);
    expect(html(createElement(LogList, { log, variant: 'mono' }))).toContain('cp-log__line');
    expect(html(createElement(LogList, { log }))).toContain('hg-log-item');
    expect(html(createElement(LogList, { log }))).not.toContain('cp-clog');
  });
});

describe('<ActionBar>', () => {
  it('renders the traffic hint above the buttons and every secondary with its sub line', () => {
    const v = mkView({ players: [P('me', 'Nithin', { stuck: true })] });
    const spec = buildActionSpec(mkSession(v, { options: { roll: true, payTraffic: 25000 } }));
    const out = html(createElement(ActionBar, { spec, fire: () => () => {} }));
    expect(out.indexOf('cp-hint')).toBeLessThan(out.indexOf('cp-primary'));
    expect(out).toContain('No move this turn');
    expect(out).toContain('Pay ₹25,000');
  });
});

describe('<TradePane> and badges', () => {
  it('explains why trading is unavailable off-turn', () => {
    const out = html(createElement(TradePane, { session: mkSession(mkView(), { me: 'rav' }) }));
    expect(out).toContain('You can propose a trade on your own turn');
  });

  it('names the exact step that blocks my trade (never an animation) and enables the button otherwise', () => {
    const mine = (patch, opts) => html(createElement(TradePane, { session: mkSession(mkView(patch), { options: opts }) }));
    expect(mine({ phase: 'debt' })).toContain('Settle the debt before trading');
    expect(mine({ phase: 'snatch' })).toContain('Snatch window');
    expect(mine({ phase: 'manage' }, { trade: { canOffer: true } })).not.toMatch(/cp-trade__go"[^>]*disabled/);
    // my own turn, nothing in the way, but the options are blank while a request of mine is in flight: say so
    const waiting = mine({ phase: 'manage' }, { trade: { canOffer: false } });
    expect(waiting).toContain('One moment');
  });

  it('badges Manage with upgrade count and Trade with an open offer', () => {
    const v = mkView({ trade: { from: 'rav', to: 'me' } });
    const b = panelBadges({ upgrades: 2 }, mkSession(v));
    expect(b.manage.text).toBe(2);
    expect(b.trade.text).toBe('!');
  });
});

describe('<MoneyBar>', () => {
  const room = [{ id: 'me', connected: true }, { id: 'rav', connected: false, cosmetics: {} }];

  it('marks a disconnected player as reconnecting and anchors every avatar for fx', () => {
    const out = html(createElement(MoneyBar, { session: mkSession(mkView(), { roomPlayers: room }) }));
    expect(out).toContain('data-fx-player="me"');
    expect(out).toContain('data-fx-player="rav"');
    expect(out.split('</li>')[1]).toContain('Reconnecting');
    expect(out.split('</li>')[0]).not.toContain('Reconnecting');
  });

  it('shows chai and traffic, and no snatch tokens', () => {
    const v = mkView({ players: [P('me', 'Nithin', { chai: 1 }), P('rav', 'Ravi', { stuck: true })] });
    const out = html(createElement(MoneyBar, { session: mkSession(v) }));
    expect(out).toContain('hg-chai is-on');
    expect(out).toContain('Stuck in traffic');
    expect(out).not.toMatch(/snatch/i);
  });

  it('compact: a horizontal strip of chips with the player on turn marked', () => {
    const out = html(createElement(MoneyBar, { session: mkSession(mkView(), { roomPlayers: room }), compact: true }));
    expect(out).toContain('hg-strip__list');
    expect(out).toContain('hg-chip is-turn is-me');
    expect(out).toContain('Reconnecting');
  });

  it('ChaiToken hides at 0 only when asked', () => {
    expect(html(createElement(ChaiToken, { count: 0, hideEmpty: true }))).toBe('');
    expect(html(createElement(ChaiToken, { count: 0 }))).toContain('No chai token');
  });
});
