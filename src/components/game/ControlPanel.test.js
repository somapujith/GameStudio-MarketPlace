// Control panel + action row under the Hustle rules (docs/HUSTLE_PLAN.md 3.7). The engine is not under test:
// views and options are built by hand, so these tests hold for the old and the new board alike.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import ControlPanel, { TABS, TradePane, landedInfo, panelBadges } from './ControlPanel.jsx';
import ActionBar, { buildActionSpec, rideLabel, rideVehicle, shortcutAction } from './ActionBar.jsx';
import MoneyBar, { ChaiToken } from './MoneyBar.jsx';
import { LogList } from './LogPanel.jsx';

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
    cfg: { mode: 'standard', maxRounds: 20, startCash: 1500000, passStart: 200000, dice: 'lucky', auctionOnDecline: true, trafficFine: 25000, chaiCap: 1 },
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

  it('offers Buy with the name and price, and "Put up for auction" on its own row', () => {
    const spec = buildActionSpec(mkSession(buyView(), { options: { buy: true, skipBuy: true } }));
    expect(spec.kind).toBe('buy');
    expect(spec.primary.label).toBe(`Buy ${PROP.short ?? PROP.name}`);
    expect(spec.primary.action).toEqual({ type: 'BUY' });
    const skip = spec.secondaries.find((x) => x.key === 'skip');
    expect(skip.label).toBe('Put up for auction');
    expect(skip.wide).toBe(true);
    expect(skip.action).toEqual({ type: 'SKIP_BUY' });
  });

  it('says "Skip" when declining does not start an auction', () => {
    const v = buyView();
    v.cfg.auctionOnDecline = false;
    const spec = buildActionSpec(mkSession(v, { options: { buy: true, skipBuy: true } }));
    expect(spec.secondaries.find((x) => x.key === 'skip').label).toBe('Skip');
  });

  it('makes the auction the primary when the buyer cannot afford the district', () => {
    const v = buyView();
    v.players[0].cash = 10;
    const spec = buildActionSpec(mkSession(v, { options: { skipBuy: true } }));
    expect(spec.kind).toBe('skip');
    expect(spec.primary.label).toBe('Put up for auction');
    expect(spec.primary.sub).toMatch(/^Need ₹/);
  });

  it('never fires Buy or the auction from Space / Enter', () => {
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
    expect(out).toContain('cp-log');
  });

  it('shows the decision timer bar and the ring while the clock waits for me', () => {
    const clock = { deadline: Date.now() + 30000, waitingFor: ['me'] };
    const out = html(createElement(ControlPanel, { session: mkSession(mkView(), { options: { roll: true }, clock }) }));
    expect(out).toContain('tt-bar is-mine');
    expect(out).toContain('Your move');
    expect(out).toContain('tt-ring is-on');
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

  it('shows the chai token and the traffic tag of the player on turn', () => {
    const v = mkView({ players: [P('me', 'Nithin', { chai: 1, stuck: true }), P('rav', 'Ravi')] });
    const out = html(createElement(ControlPanel, { session: mkSession(v, { options: { roll: true, payTraffic: 25000, useChai: true } }) }));
    expect(out).toContain('hg-chai is-on');
    expect(out).toContain('Stuck in traffic');
    expect(out).toContain('Use chai');
    expect(out).toContain('Wait it out');
  });

  it('keeps the log empty-state friendly', () => {
    expect(html(createElement(LogList, { log: [], variant: 'mono' }))).toContain('Your story starts with a roll.');
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
    expect(out).toContain('You can propose a trade on your own turn.');
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
