// Markup of the simple phone table: the top bar, players, action row, buy popup, chat bar, tile faces and the whole table.
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TILES } from '@shared/board.js';
import { buildActionSpec } from '../ActionBar.jsx';
import { panelBadges } from '../ControlPanel.jsx';
import PhoneTopBar, { Objective } from './PhoneTopBar.jsx';
import PhonePlayers from './PhonePlayers.jsx';
import PhoneActions from './PhoneActions.jsx';
import PhoneChatBar from './PhoneChatBar.jsx';
import PhoneCentre from './PhoneCentre.jsx';
import BuyCard from './BuyCard.jsx';
import PhoneTable, { buyDecision } from './PhoneTable.jsx';
import PhoneTileFace from './PhoneTileFace.jsx';
import PhoneBoardContext from './PhoneBoardContext.js';
import Tile from '../Tile.jsx';
import { buyCardData } from './phoneModel.js';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');
const P = (id, name, extra = {}) => ({ id, name, color: '#ff4d6d', avatar: 0, piece: 'pearl', cash: 820000, pos: 0, stuck: false, chai: 0, bankrupt: false, ...extra });
const ALL = [P('me', 'Nithin', { cash: 11150000 }), P('rav', 'Ravi', { color: '#3ddc97' }), P('sana', 'Sana', { color: '#4cc9f0' }), P('arj', 'Arjun'), P('mee', 'Meera'), P('kir', 'Kiran')];

function sess({ n = 2, turn = 0, options = { roll: true }, extra = {}, view = {}, cfg = {} } = {}) {
  const players = ALL.slice(0, n);
  const v = {
    phase: 'roll', turn, round: 7, players, owners: Array(TILES.length).fill(null), levels: Array(TILES.length).fill(0), mortgaged: [], pending: null, trade: null, dice: [4],
    cfg: { mode: 'standard', maxRounds: 20, targetWorth: 5000000, auctionOnDecline: true, ...cfg }, ...view,
  };
  return { me: 'me', view: v, display: { ...v }, options, busy: false, rolling: false, log: [], chat: [], connection: 'open', sendChat() {}, dispatch() {}, ...extra };
}
const actionsOf = (s) => ({ spec: buildActionSpec(s), fire: () => () => {} });
/** The `<li>` cells of a rendered players list, in order; cellOf(out, id) the one whose avatar is `id`'s. */
const cellsOf = (out) => out.split('<li ').slice(1);
const cellOf = (out, id) => cellsOf(out).find((c) => c.includes(`data-fx-player="${id}"`));

describe('PhoneTopBar', () => {
  it('prints the objective with the target in its own element and a leave / menu button', () => {
    const out = html(h(PhoneTopBar, { session: sess(), spec: buildActionSpec(sess()) }));
    expect(out).toContain('aria-label="Leave game"');
    expect(out).toContain('aria-label="Menu"');
    expect(out).toContain('ph-obj__target">₹50L</b> net worth to win · Round 7 of 20');
    expect(out).not.toContain('HYDERABAD TYCOON');
    expect(out).not.toContain('ph-event');
    expect(out).not.toContain('ph-dot');
  });

  it('shows the event chip only while an event is on, and a dot on the menu when something needs me', () => {
    const s = sess({ view: { event: { id: 'rush_hour', title: 'Hyderabad Rush Hour', text: 'x1.5', round: 7 } }, options: { roll: true, upgrade: [{ tile: 1 }] } });
    const out = html(h(PhoneTopBar, { session: s, spec: buildActionSpec(s) }));
    expect(out).toContain('class="ph-event"');
    expect(out).toContain('Hyderabad Rush Hour');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('ph-dot');
    expect(out).toContain('aria-label="Menu, 1 district can be upgraded"');
  });

  it('the other objective lines have no green target', () => {
    expect(html(h(Objective, { session: sess({ cfg: { targetWorth: null } }) }))).toContain('Round 7 of 20 · richest wins');
    expect(html(h(Objective, { session: sess({ cfg: { targetWorth: null } }) }))).not.toContain('ph-obj__target');
  });
});

describe('PhonePlayers', () => {
  it('one avatar anchor (data-fx-player) per player, a button each, cash with the net worth in brackets', () => {
    for (const n of [2, 4, 6]) {
      const out = html(h(PhonePlayers, { session: sess({ n }) }));
      expect((out.match(/data-fx-player=/g) || []).length, `n=${n}`).toBe(n);
      expect((out.match(/class="pp__btn"/g) || []).length).toBe(n);
      expect(out).toContain(`data-n="${n}"`);
    }
    const out = html(h(PhonePlayers, { session: sess({ n: 2 }) }));
    expect(out).toContain('₹8,20,000');
    expect(out).toContain('₹1,11,50,000');
    expect(out).toMatch(/pp__worth">\(₹/);
  });

  it('density follows the count and me comes last', () => {
    expect(html(h(PhonePlayers, { session: sess({ n: 2 }) }))).toContain('data-density="roomy"');
    expect(html(h(PhonePlayers, { session: sess({ n: 3 }) }))).toContain('data-density="row"');
    expect(html(h(PhonePlayers, { session: sess({ n: 6 }) }))).toContain('data-density="compact"');
    const out = html(h(PhonePlayers, { session: sess({ n: 3 }) }));
    expect(out.indexOf('Ravi')).toBeLessThan(out.indexOf('Sana'));
    expect(out.lastIndexOf('Nithin')).toBeGreaterThan(out.indexOf('Sana'));
    expect(out).toContain('data-span="6"');
  });

  it('labels every pod like the old pods (name, you, cash, net worth, turn) and puts the turn pill on whoever plays', () => {
    const out = html(h(PhonePlayers, { session: sess({ n: 2 }) }));
    expect(out).toContain('aria-label="Nithin (you), ₹1,11,50,000 cash');
    expect(out).toContain('current turn');
    expect(out).toContain('pp__turn" aria-hidden="true">Your turn<');
    const other = html(h(PhonePlayers, { session: sess({ n: 2, turn: 1 }) }));
    expect(other).toContain('pp__turn" aria-hidden="true">Turn<');
    expect((other.match(/pp__turn/g) || []).length).toBe(1);
    // the compact grids use the short pill
    expect(html(h(PhonePlayers, { session: sess({ n: 4 }) }))).toContain('pp__turn" aria-hidden="true">Turn<');
  });

  it('a net worth target gives every live player a very thin progress line under the money, and only then', () => {
    const out = html(h(PhonePlayers, { session: sess({ n: 3 }) }));
    expect((out.match(/class="pp__goal/g) || []).length).toBe(3);
    // decoration only (the numbers are in the button's label), after the money line, inside the same button
    expect(out).toMatch(/<span class="pp__goal[^"]*" style="--tp:[0-9.]+" aria-hidden="true" data-pct="\d+"><i><\/i><\/span>/);
    for (const cell of cellsOf(out)) expect(cell.indexOf('pp__cash')).toBeLessThan(cell.indexOf('pp__goal'));
    expect(out).toContain('% of the ₹50L net worth target'); // the spoken form of the line stays in the label
    const none = html(h(PhonePlayers, { session: sess({ n: 3, cfg: { targetWorth: null } }) }));
    expect(none).not.toContain('pp__goal');
    expect(none).not.toContain('net worth target');
    expect(none).not.toContain('has-goal');
  });

  it('the line is not drawn for a player who is out', () => {
    const s = sess({ n: 3 });
    s.display.players = s.display.players.map((p) => (p.id === 'rav' ? { ...p, bankrupt: true } : p));
    expect((html(h(PhonePlayers, { session: s })).match(/class="pp__goal/g) || []).length).toBe(2);
  });

  it('out and reconnecting states', () => {
    const s = sess({ n: 3 });
    s.display.players = s.display.players.map((p) => (p.id === 'rav' ? { ...p, bankrupt: true } : p));
    s.roomPlayers = [{ id: 'sana', connected: false }];
    const out = html(h(PhonePlayers, { session: s }));
    expect(out).toContain('is-out');
    expect(out).toContain('Bankrupt');
    expect(out).toContain('sg--offline'); // the connection indicator: grey bars beside the name ...
    expect(out).toContain('>Offline<'); // ... and the red pill under the avatar
    expect(out).toContain('is-offline');
  });

  it('a player who is out shows a bold red word in place of the money: Forfeit after resigning, Bankrupt otherwise', () => {
    const outOf = (n, patch) => {
      const s = sess({ n });
      s.display.players = s.display.players.map((p) => (patch[p.id] ? { ...p, bankrupt: true, ...patch[p.id] } : p));
      return s;
    };
    // resigned: the player's own flag
    const flag = html(h(PhonePlayers, { session: outOf(2, { rav: { resigned: true } }) }));
    expect(flag).toContain('<span class="pp__out">Forfeit</span>');
    expect(flag).not.toContain('Bankrupt');
    expect(cellOf(flag, 'rav')).not.toContain('pp__cash'); // the money line is replaced, not shown beside it
    expect(cellOf(flag, 'rav')).not.toContain('pp__goal');
    expect(cellOf(flag, 'rav')).toMatch(/aria-label="Ravi, forfeited"/);
    expect(cellOf(flag, 'me')).toContain('pp__cash'); // the player who is still in keeps the money line
    // resigned: my own resignation of this visit
    const mine = outOf(2, { me: {} });
    mine.resigned = true;
    expect(cellOf(html(h(PhonePlayers, { session: mine })), 'me')).toContain('>Forfeit<');
    // resigned: the log line of somebody else's resignation (the engine event is not kept on the player)
    const logged = outOf(3, { sana: {} });
    logged.log = [{ id: 1, text: 'Sana resigned', player: 'sana' }];
    expect(cellOf(html(h(PhonePlayers, { session: logged })), 'sana')).toContain('>Forfeit<');
    // out of money: Bankrupt, in red
    const broke = html(h(PhonePlayers, { session: outOf(2, { rav: {} }) }));
    expect(cellOf(broke, 'rav')).toContain('<span class="pp__out">Bankrupt</span>');
    expect(cellOf(broke, 'rav')).toMatch(/aria-label="Ravi, bankrupt"/);
    expect(broke).not.toContain('Forfeit');
    // the out word carries no presence bars, no pill and no goal
    for (const cell of [cellOf(flag, 'rav'), cellOf(broke, 'rav')]) {
      expect(cell).not.toContain('sg__bars');
      expect(cell).not.toContain('pp__turn');
    }
  });

  it('a spectator sees everybody', () => {
    const s = sess({ n: 3 });
    s.me = 'ghost';
    expect((html(h(PhonePlayers, { session: s })).match(/data-fx-player=/g) || []).length).toBe(3);
  });

  it('columns: 1 and 2 players side by side, 3-4 in two columns, 5-6 in three (the grid tokens the CSS reads)', () => {
    const want = { 1: [1, 'roomy'], 2: [2, 'roomy'], 3: [2, 'row'], 4: [2, 'row'], 5: [3, 'compact'], 6: [3, 'compact'] };
    for (const [n, [cols, density]] of Object.entries(want)) {
      const out = html(h(PhonePlayers, { session: sess({ n: Number(n) }) }));
      expect(out, `n=${n}`).toContain(`data-cols="${cols}"`);
      expect(out, `n=${n}`).toContain(`data-density="${density}"`);
      expect(cellsOf(out), `n=${n}`).toHaveLength(Number(n));
      for (const c of cellsOf(out)) expect(c).toContain(`pp--${density}`);
    }
    // the spans the three-column grid gives an incomplete last row: two equal cells
    expect(cellsOf(html(h(PhonePlayers, { session: sess({ n: 5 }) }))).map((c) => c.match(/data-span="(\d)"/)[1])).toEqual(['2', '2', '2', '3', '3']);
  });

  it('mirrors by slot: the piece token is on the OUTER side of the avatar (left column: before it; right column: after it)', () => {
    const order = (cell) => cell.indexOf('pp__piece') - cell.indexOf('data-fx-player=');
    const sidesOf = (n) => cellsOf(html(h(PhonePlayers, { session: sess({ n }) }))).map((c) => [c.match(/data-side="(\w+)"/)[1], order(c)]);
    // two players: the other on the left, you on the right
    expect(sidesOf(2)).toEqual([['left', expect.any(Number)], ['right', expect.any(Number)]]);
    const two = sidesOf(2);
    expect(two[0][1]).toBeLessThan(0); // piece first
    expect(two[1][1]).toBeGreaterThan(0); // avatar first
    // four players: left, right, left, right
    expect(sidesOf(4).map(([s]) => s)).toEqual(['left', 'right', 'left', 'right']);
    for (const [side, d] of sidesOf(4)) expect(side === 'left' ? d < 0 : d > 0).toBe(true);
    // three players: you are alone in the last row
    expect(sidesOf(3).map(([s]) => s)).toEqual(['left', 'right', 'right']);
    // five and six: three columns, the middle one hangs its token on the right
    expect(sidesOf(5).map(([s]) => s)).toEqual(['left', 'mid', 'right', 'left', 'right']);
    expect(sidesOf(6).map(([s]) => s)).toEqual(['left', 'mid', 'right', 'left', 'mid', 'right']);
    for (const [side, d] of sidesOf(6)) expect(side === 'left' ? d < 0 : d > 0).toBe(true);
    // the class the CSS keys the track on
    expect(html(h(PhonePlayers, { session: sess({ n: 2 }) }))).toMatch(/class="pp pp--roomy pp--left[^"]*"[\s\S]*class="pp pp--roomy pp--right is-me/);
  });

  it('the piece is a round disc with the piece art; the name row has the bars, then the name; the money has the net worth in brackets', () => {
    const s = sess({ n: 2 });
    s.roomPlayers = [{ id: 'me', connected: true, net: { q: 4, rtt: 40 } }, { id: 'rav', connected: true, net: { q: 4, rtt: 40 } }];
    const out = html(h(PhonePlayers, { session: s }));
    const rav = cellOf(out, 'rav');
    expect(rav).toMatch(/<span class="pp__piece"><span class="pp__disc"><span class="hb-piece/);
    expect(rav).toMatch(/<span class="pp__name"><span class="sg [^"]*pp__sig"[^>]*>[\s\S]*<\/span><b title="Ravi">Ravi<\/b><\/span>/);
    expect(rav).toMatch(/<span class="pp__cash" title="Net worth ₹[\d,]+"><span class="hg-money pp__amt">₹8,20,000<\/span><small class="pp__worth">\(₹[\d.]+L\)<\/small><\/span>/);
    // no box: the button is the only wrapper, and it carries no background class of its own
    expect(rav).not.toMatch(/pp__card|pp__box/);
  });

  it('the cash font follows its length (so ₹1,11,50,000 fits a 320px phone) and yours is gold', () => {
    const out = html(h(PhonePlayers, { session: sess({ n: 2 }) }));
    expect(cellOf(out, 'me')).toContain('--chars:12');
    expect(cellOf(out, 'rav')).toContain('--chars:9');
    expect(cellOf(out, 'me')).toContain('is-me');
    expect(cellOf(out, 'rav')).not.toContain('is-me');
    // yours has the bigger avatar, the others share the plain size
    const size = (cell) => Number(cell.match(/--sz:(\d+)px/)[1]);
    expect(size(cellOf(out, 'me'))).toBeGreaterThan(size(cellOf(out, 'rav')));
  });

  it('every avatar is the coin anchor and the whole column opens the player sheet', () => {
    const picks = [];
    const out = html(h(PhonePlayers, { session: sess({ n: 4 }), onSelect: (id) => picks.push(id) }));
    for (const id of ['me', 'rav', 'sana', 'arj']) expect(cellOf(out, id)).toContain(`data-fx-player="${id}"`);
    // the avatar sits inside the button (the tap target is the whole column)
    for (const c of cellsOf(out)) expect(c.indexOf('<button')).toBeLessThan(c.indexOf('data-fx-player='));
  });
});

describe('PhoneActions', () => {
  const render = (s, extra = {}) => {
    const a = actionsOf(s);
    return html(h(PhoneActions, { session: s, spec: a.spec, fire: a.fire, badges: panelBadges(a.spec, s), ...extra }));
  };

  it('one big ROLL with Manage and Trade on either side', () => {
    const out = render(sess());
    expect(out).toContain('class="pa-primary is-roll tone-gold"');
    expect(out).toContain('>ROLL<');
    expect(out).toContain('aria-label="Manage"');
    expect(out).toContain('aria-label="Trade"');
    expect(out).not.toContain('pa-pills');
  });

  it('badges: districts that can be upgraded, a trade offer waiting', () => {
    const s = sess({ options: { roll: true, upgrade: [{ tile: 1 }, { tile: 3 }] }, view: { trade: { from: 'rav', to: 'me' } } });
    const a = actionsOf(s);
    const out = html(h(PhoneActions, { session: s, spec: a.spec, fire: a.fire, badges: panelBadges({ ...a.spec, upgrades: 2 }, s) }));
    expect(out).toContain('aria-label="Manage, 2 can be upgraded"');
    expect(out).toContain('aria-label="Trade, A trade offer is open"');
    expect(out).toContain('pa-tool__badge');
  });

  it('secondary actions are small pills above the primary, only when they exist', () => {
    const t = render(sess({ options: { roll: true, payTraffic: 25000, useChai: true } }));
    expect(t).toContain('USE CHAI');
    expect(t).toContain('Pay ₹25,000');
    expect(t).toContain('Wait it out');
    expect(t.indexOf('pa-pills')).toBeLessThan(t.indexOf('pa-primary'));
    const ride = render(sess({ options: { roll: true, ride: { to: 14, fare: 25000 } } }));
    expect(ride).toContain('Ride ₹25,000');
  });

  it('BUY shows the price, PASS appears as a pill', () => {
    const out = render(sess({ options: { buy: true, skipBuy: true }, view: { pending: { type: 'buy', tile: 29, price: 320000 } } }));
    expect(out).toContain('BUY ₹3,20,000');
    expect(out).toContain('aria-label="Buy for ₹3,20,000"');
    expect(out).toContain('>Pass<');
  });

  it('waiting for somebody else is a disabled status, not a button', () => {
    const out = render(sess({ turn: 1, options: {} }));
    expect(out).toContain('pa-primary is-wait');
    expect(out).toContain('Waiting for Ravi…');
    expect(out).not.toMatch(/<button[^>]*pa-primary/);
    expect(out).toContain('aria-label="Manage"');
  });

  it('out of the game: no Manage / Trade, a calm line', () => {
    const s = sess({ options: {} });
    s.display.players = s.display.players.map((p) => (p.id === 'me' ? { ...p, bankrupt: true } : p));
    s.view.players = s.display.players;
    const out = render(s);
    expect(out).not.toContain('aria-label="Manage"');
    expect(out).toContain('pa-tool--gap');
  });
});

describe('BuyCard', () => {
  const data = (o = {}) => buyCardData(TILES[29], { cash: 1000000, price: 320000, ...o });

  it('is a labelled dialog with price, rent, mortgage value, three levels, the upgrade cost and PASS / BUY', () => {
    const out = html(h(BuyCard, { data: data() }));
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toMatch(/aria-labelledby="[^"]+"/);
    expect(out).toContain('>Madhapur<');
    expect(out).toContain('Cyberabad');
    expect(out).toContain('₹3,20,000');
    expect(out).toContain('₹32,000');
    expect(out).toContain('₹1,60,000');
    expect((out.match(/<li aria-label=/g) || []).length).toBe(3);
    expect(out).toContain('Each upgrade costs <b>₹1,60,000</b>');
    expect(out).toContain('Pass and it goes to a sealed auction');
    expect(out).toContain('>PASS<');
    expect(out).toMatch(/BUY<span> ₹3,20,000<\/span>/);
    expect(out).toContain('data-autofocus');
    expect(out).not.toMatch(/bcard-buy[^>]*disabled/);
  });

  it('BUY is disabled with the reason when cash is short, PASS stays available', () => {
    const out = html(h(BuyCard, { data: data({ cash: 20000 }) }));
    expect(out).toMatch(/class="bcard-btn bcard-buy"[^>]*disabled/);
    expect(out).toContain('Need ₹3,00,000 more to buy this');
    expect(out).not.toMatch(/bcard-pass[^>]*disabled/);
  });

  it('no auction rule: the pass line says so', () => {
    expect(html(h(BuyCard, { data: data({ auction: false }) }))).toContain('stays with the city');
  });

  it('renders nothing without data', () => {
    expect(html(h(BuyCard, { data: null }))).toBe('');
  });
});

describe('buyDecision', () => {
  it('only for my pending purchase', () => {
    const buy = sess({ options: { buy: true, skipBuy: true }, view: { pending: { type: 'buy', tile: 29, price: 320000 } } });
    expect(buyDecision(buy, buildActionSpec(buy)).tile.id).toBe(29);
    const poor = sess({ options: { skipBuy: true }, view: { pending: { type: 'buy', tile: 29, price: 320000 } } });
    expect(buyDecision(poor, buildActionSpec(poor)).tile.id).toBe(29);
    const other = sess({ turn: 1, options: {}, view: { pending: { type: 'buy', tile: 29, price: 320000 } } });
    expect(buyDecision(other, buildActionSpec(other))).toBeNull();
    expect(buyDecision(sess(), buildActionSpec(sess()))).toBeNull();
  });
});

describe('PhoneChatBar', () => {
  it('a plain bar: history, a 16px-friendly input with a send key hint, reactions, send', () => {
    const out = html(h(PhoneChatBar, { session: sess() }));
    expect(out).toContain('placeholder="Say hello…"');
    expect(out).toMatch(/enterkeyhint="send"/i);
    expect(out).toContain('aria-label="Chat message"');
    expect(out).toContain('aria-label="Chat messages"');
    expect(out).toContain('aria-label="Quick reactions"');
    expect(out).toContain('aria-label="Send message"');
    expect(out).toMatch(/disabled=""[^>]*aria-label="Send message"|aria-label="Send message"[^>]*disabled=""/);
    expect(out).not.toContain('pcb-pop');
  });

  it('says it is reconnecting and locks the input while the socket is down', () => {
    const out = html(h(PhoneChatBar, { session: sess({ extra: { connection: 'closed' } }) }));
    expect(out).toContain('placeholder="Reconnecting…"');
    expect(out).toMatch(/<input[^>]*disabled=""/);
  });
});

describe('PhoneTileFace / Tile in the phone table', () => {
  const faceOf = (id, props = {}) => {
    const tile = TILES[id];
    return html(h(PhoneTileFace, { tile, group: null, ...props }));
  };

  it('a district: price band + name in capitals; owned: the rent tag in the owner colour and pips', () => {
    const free = html(h(PhoneTileFace, { tile: TILES[29], group: { color: '#4f7cff' } }));
    expect(free).toContain('pt__price">₹3.2L<');
    expect(free).toContain('<span>MADHA-</span>');
    expect(free).not.toContain('pt__tag');
    const owned = html(h(PhoneTileFace, { tile: TILES[29], group: { color: '#4f7cff' }, owned: true, ownerColor: '#ff4d6d', level: 1, rent: 32000 }));
    expect(owned).toContain('pt__tag">₹32k<');
    expect(owned).toContain('--tag:#ff4d6d');
    expect((owned.match(/<i/g) || []).length).toBe(2);
    expect(owned).toContain('class="is-on"');
    const mort = html(h(PhoneTileFace, { tile: TILES[29], group: { color: '#4f7cff' }, owned: true, ownerColor: '#ff4d6d', mortgaged: true }));
    expect(mort).toContain('pt__m');
    expect(mort).toContain('pt__price');
    expect(mort).not.toContain('pt__tag');
  });

  it('stops, cards and corners are light tiles with a capital label', () => {
    expect(faceOf(5)).toContain('pt--stop');
    expect(faceOf(5)).toContain('>AUTO<');
    expect(faceOf(2)).toContain('pt--card');
    expect(faceOf(2)).toContain('>LUCK<');
    expect(faceOf(12)).toContain('>DRAMA<');
    for (const [id, word] of [[0, 'START'], [9, 'TRAFFIC'], [18, 'CHAI ADDA'], [27, 'MUNICIPAL'], [32, 'AUCTION']]) {
      const out = faceOf(id);
      expect(out, `tile ${id}`).toContain('pt--corner');
      expect(out, `tile ${id}`).toContain(`pt__pill">${word}<`);
    }
    expect(faceOf(0)).toContain('pt__arrow');
    expect(faceOf(9, { stuck: 2 })).toContain('hb-tile__stuck');
  });

  it('Tile swaps to the phone face only inside the phone context and keeps its accessible name', () => {
    const plain = html(h(Tile, { tile: TILES[29], onSelect() {} }));
    expect(plain).not.toContain('hb-tile--phone');
    expect(plain).not.toContain('class="pt ');
    const phone = html(h(PhoneBoardContext.Provider, { value: true }, h(Tile, { tile: TILES[29], onSelect() {} })));
    expect(phone).toContain('hb-tile--phone');
    expect(phone).toContain('class="pt pt--prop"');
    expect(phone).toContain('aria-label="Madhapur, Cyberabad, for sale, ₹3,20,000"');
    expect(phone).not.toContain('hb-tile__band');
  });
});

describe('PhoneCentre / PhoneTable', () => {
  it('the centre is a calm status caption, a hero and the die; no log, tabs, ribbon or landed row', () => {
    const s = sess();
    const out = html(h(PhoneCentre, { session: s, spec: buildActionSpec(s) }));
    expect(out).toContain('Your turn — roll!');
    expect(out).toContain('pc-die');
    expect(out).toContain('pc-hero');
    expect(out).not.toMatch(/cp-tabs|city-story-log|cp-landed|cp-event|hb-log/);
  });

  it('the whole table: top bar, board, players, action row, chat bar and the buy card for my decision', () => {
    const s = sess({ n: 3, options: { buy: true, skipBuy: true }, view: { pending: { type: 'buy', tile: 29, price: 320000 } } });
    const out = html(h(PhoneTable, { session: s, actions: actionsOf(s), badges: {} }));
    for (const c of ['ph-top', 'ph-stage', 'ph-board', 'hb-board', 'pp-list', 'class="pa"', 'class="pcb"', 'bcard-root']) expect(out, c).toContain(c);
    expect((out.match(/hb-tile--phone/g) || []).length).toBe(TILES.length);
    expect((out.match(/class="hb-pawn /g) || []).length).toBe(3);
    expect(out).toContain('hb-pawn__disc');
    expect(out).toContain('data-fx-bank');
  });

  it('no buy card for other players or without a decision; overlays are passed through', () => {
    const s = sess({ options: { roll: true } });
    const out = html(h(PhoneTable, { session: s, actions: actionsOf(s), overlays: h('i', { className: 'my-overlay' }) }));
    expect(out).not.toContain('bcard-root');
    expect(out).toContain('my-overlay');
    const other = sess({ turn: 1, options: {}, view: { pending: { type: 'buy', tile: 29, price: 320000 } } });
    expect(html(h(PhoneTable, { session: other, actions: actionsOf(other) }))).not.toContain('bcard-root');
  });
});
