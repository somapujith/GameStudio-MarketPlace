// The simple phone table: every pure helper behind it (objective line, captions, player grid, action labels, buy card, tile faces).
import { describe, expect, it } from 'vitest';
import { TILES, GROUPS } from '@shared/board.js';
import { buildActionSpec } from '../ActionBar.jsx';
import { contrastRatio } from '../PropertySheet.jsx';
import {
  attentionOf, buyActions, buyCardData, captionFor, captionFromBubble, captionFromStatus, cashChars, cellSpans, chipFor, eventChipOf, faceKind,
  faceLabel, faceName, faceTones, gridFor, objectiveFor, orderPlayers, pillFor, primaryFor, roundPhrase, stopKind,
} from './phoneModel.js';

const P = (id, name, extra = {}) => ({ id, name, color: '#ff4d6d', avatar: 0, cash: 1500000, pos: 0, stuck: false, chai: 0, bankrupt: false, ...extra });
const players = [P('me', 'Nithin'), P('rav', 'Ravi', { color: '#3ddc97' }), P('sana', 'Sana', { color: '#4cc9f0' })];
const owners = Array(TILES.length).fill(null);
const levels = Array(TILES.length).fill(0);

function sess({ cfg = {}, round = 7, turn = 0, owner = {}, level = {}, options = {}, pending = null, bubble = null, extra = {}, trade = null, phase = 'roll', debt = null, event = null } = {}) {
  const view = {
    phase, turn, round, players, owners: owners.map((o, i) => owner[i] ?? o), levels: levels.map((l, i) => level[i] ?? l), mortgaged: [], pending, trade, debt, dice: [4], event,
    cfg: { mode: 'standard', maxRounds: 20, targetWorth: 5000000, auctionOnDecline: true, ...cfg },
  };
  return { me: 'me', view, display: { ...view }, options, bubble, busy: false, rolling: false, log: [], ...extra };
}

describe('objectiveFor', () => {
  it('names the net worth target in green (the target is a separate part) with the round', () => {
    const o = objectiveFor(sess());
    expect(o.kind).toBe('target');
    expect(o.target).toBe('₹50L');
    expect(o.tail).toBe(' net worth to win · Round 7 of 20');
    expect(o.text).toBe('₹50L net worth to win · Round 7 of 20');
  });

  it('formats other targets the way hosts pick them', () => {
    expect(objectiveFor(sess({ cfg: { targetWorth: 2500000 } })).target).toBe('₹25L');
    expect(objectiveFor(sess({ cfg: { targetWorth: 10000000 } })).target).toBe('₹1Cr');
  });

  it('classic with a target has no round limit: just the round', () => {
    const o = objectiveFor(sess({ cfg: { mode: 'classic', maxRounds: null, targetWorth: 3000000 }, round: 12 }));
    expect(o.text).toBe('₹30L net worth to win · Round 12');
  });

  it('a round-limited table without a target says the richest wins', () => {
    const o = objectiveFor(sess({ cfg: { targetWorth: null } }));
    expect(o.kind).toBe('rounds');
    expect(o.target).toBeNull();
    expect(o.text).toBe('Round 7 of 20 · richest wins');
  });

  it('no target and no round limit: last one standing', () => {
    const o = objectiveFor(sess({ cfg: { mode: 'classic', maxRounds: null, targetWorth: null }, round: 12 }));
    expect(o.kind).toBe('last');
    expect(o.text).toBe('Last one standing wins · Round 12');
  });

  it('says it when it is the final round, and never passes the limit', () => {
    expect(roundPhrase(sess({ round: 20 }))).toBe('Final round');
    expect(roundPhrase(sess({ round: 25 }))).toBe('Final round');
    expect(roundPhrase(sess({ round: 19 }))).toBe('Round 19 of 20');
  });

  it('classic ignores its safety cap', () => {
    expect(roundPhrase(sess({ cfg: { mode: 'classic', maxRounds: 60 }, round: 59 }))).toBe('Round 59');
  });
});

describe('eventChipOf / attentionOf', () => {
  const ev = { id: 'rush_hour', title: 'Hyderabad Rush Hour', text: 'rents x1.5', round: 7 };
  it('shows the city event only while it applies to this round', () => {
    expect(eventChipOf(sess({ event: ev }))).toMatchObject({ title: 'Hyderabad Rush Hour', id: 'rush_hour' });
    expect(eventChipOf(sess({ event: { ...ev, round: 6 } }))).toBeNull();
    expect(eventChipOf(sess({ event: { ...ev, round: undefined } }))).not.toBeNull();
    expect(eventChipOf(sess())).toBeNull();
  });

  it('flags an upgrade, an offer waiting for me and a debt on the menu button', () => {
    expect(attentionOf(sess(), { upgrades: 0 }).any).toBe(false);
    expect(attentionOf(sess(), { upgrades: 2 })).toMatchObject({ any: true, upgrade: 2 });
    expect(attentionOf(sess({ trade: { from: 'rav', to: 'me' } }), { upgrades: 0 }).trade).toBe(true);
    expect(attentionOf(sess({ trade: { from: 'me', to: 'rav' } }), { upgrades: 0 }).trade).toBe(false);
    expect(attentionOf(sess({ phase: 'debt', debt: { player: 'me', amount: 5 } }), { upgrades: 0 }).debt).toBe(true);
    expect(attentionOf(sess({ phase: 'debt', debt: { player: 'rav', amount: 5 } }), { upgrades: 0 }).debt).toBe(false);
  });
});

describe('players grid', () => {
  it('picks columns and density by player count', () => {
    expect(gridFor(1)).toMatchObject({ cols: 1, density: 'roomy' });
    expect(gridFor(2)).toMatchObject({ cols: 2, density: 'roomy' });
    expect(gridFor(3)).toMatchObject({ cols: 2, density: 'row' });
    expect(gridFor(4)).toMatchObject({ cols: 2, density: 'row' });
    expect(gridFor(5)).toMatchObject({ cols: 3, density: 'compact' });
    expect(gridFor(6)).toMatchObject({ cols: 3, density: 'compact' });
    expect(gridFor(9).cols).toBe(3);
  });

  it('spans: full rows share the width, a short last row stretches (6-column grid)', () => {
    expect(cellSpans(1)).toEqual([6]);
    expect(cellSpans(2)).toEqual([3, 3]);
    expect(cellSpans(3)).toEqual([3, 3, 6]);
    expect(cellSpans(4)).toEqual([3, 3, 3, 3]);
    expect(cellSpans(5)).toEqual([2, 2, 2, 3, 3]);
    expect(cellSpans(6)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('puts the others in turn order after me and me last', () => {
    const four = [P('a', 'A'), P('b', 'B'), P('c', 'C'), P('d', 'D')];
    expect(orderPlayers(four, 'b').map((p) => p.id)).toEqual(['c', 'd', 'a', 'b']);
    expect(orderPlayers(four, 'a').map((p) => p.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(orderPlayers(four, 'zzz').map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(orderPlayers(null, 'a')).toEqual([]);
  });

  it('counts the characters of a cash figure (the font shrinks with it)', () => {
    expect(cashChars(820000)).toBe('₹8,20,000'.length);
    expect(cashChars(11150000)).toBe('₹1,11,50,000'.length);
  });
});

describe('captionFromBubble / captionFor', () => {
  const b = (o) => ({ id: 5, tone: 'info', ...o });
  it('says who bought: "You bought" / "Sana bought", with the tile', () => {
    const mine = captionFromBubble(sess({ owner: { 11: 'me' }, bubble: b({ type: 'own', reason: 'buy', tile: 11, player: 'me' }) }));
    expect(mine).toMatchObject({ text: 'You bought', tile: 11, who: 'me' });
    const theirs = captionFromBubble(sess({ owner: { 13: 'sana' }, bubble: b({ type: 'own', reason: 'buy', tile: 13, player: 'sana' }) }));
    expect(theirs).toMatchObject({ text: 'Sana bought', tile: 13 });
  });

  it('says what an upgrade and an auction win were', () => {
    expect(captionFromBubble(sess({ owner: { 11: 'rav' }, bubble: b({ type: 'level', reason: 'upgrade', tile: 11 }) })).text).toBe('Ravi upgraded');
    expect(captionFromBubble(sess({ owner: { 11: 'me' }, bubble: b({ type: 'own', reason: 'auction', tile: 11 }) })).text).toBe('You won the auction');
  });

  it('rent: "Paid ₹34,000 rent to Sana" for me, the full sentence for others', () => {
    const mine = sess({ owner: { 11: 'sana' }, bubble: b({ type: 'cash' }), extra: { lastCash: { id: 1, player: 'me', delta: -34000, reason: 'rent' }, stageTile: 11 } });
    expect(captionFromBubble(mine).text).toBe('Paid ₹34,000 rent to Sana');
    const other = sess({ owner: { 11: 'me' }, bubble: b({ type: 'cash', player: 'rav' }), extra: { lastCash: { id: 1, player: 'rav', delta: -34000, reason: 'rent' }, stageTile: 11 } });
    expect(captionFromBubble(other).text).toBe('Ravi paid ₹34,000 rent to You');
  });

  it('the receiving leg of the same rent reads the same way', () => {
    const s = sess({ turn: 1, owner: { 11: 'sana' }, bubble: b({ type: 'cash' }), extra: { lastCash: { id: 2, player: 'sana', delta: 34000, reason: 'rent' }, stageTile: 11 } });
    expect(captionFromBubble(s).text).toBe('Ravi paid ₹34,000 rent to Sana');
  });

  it('cards, traffic, chai, rides and landing', () => {
    expect(captionFromBubble(sess({ bubble: b({ type: 'card', player: 'rav' }) })).text).toBe('Ravi drew a card');
    expect(captionFromBubble(sess({ bubble: b({ type: 'card', player: 'me' }) })).text).toBe('You drew a card');
    const stuck = sess({ bubble: b({ type: 'traffic', player: 'me' }) });
    stuck.display.players = [{ ...players[0], stuck: true }, ...players.slice(1)];
    expect(captionFromBubble(stuck).text).toBe('Stuck in traffic');
    expect(captionFromBubble(sess({ bubble: b({ type: 'ride', player: 'rav' }) })).text).toBe('Ravi took a ride');
    expect(captionFromBubble(sess({ bubble: b({ type: 'land', tile: 11, player: 'me' }) }))).toMatchObject({ text: 'You landed on Mehdipatnam', tile: 11 });
    expect(captionFromBubble(sess({ bubble: b({ type: 'chai', text: '+1 chai', player: 'me' }) })).text).toBe('+1 chai');
  });

  it('turn / win / trade bubbles leave the status line alone, long free text too', () => {
    expect(captionFromBubble(sess({ bubble: b({ type: 'turn', text: 'Round 8' }) }))).toBeNull();
    expect(captionFromBubble(sess({ bubble: b({ type: 'win', text: 'Ravi wins!' }) }))).toBeNull();
    expect(captionFromBubble(sess({ bubble: b({ type: 'whatever', text: 'x'.repeat(80) }) }))).toBeNull();
    expect(captionFromBubble(sess())).toBeNull();
  });

  it('falls back to the status line: my roll, a decision, another player playing', () => {
    const roll = sess({ options: { roll: true } });
    expect(captionFor(roll, buildActionSpec(roll), { fresh: false }).text).toBe('Your turn — roll!');
    const other = sess({ turn: 1 });
    expect(captionFor(other, buildActionSpec(other)).text).toBe('Ravi is playing…');
    const buy = sess({ options: { buy: true, skipBuy: true }, pending: { type: 'buy', tile: 29, price: 320000 } });
    const c = captionFor(buy, buildActionSpec(buy), { fresh: false });
    expect(c.text).toBe('Your turn — buy it?');
    expect(c.tile).toBe(29);
  });

  it('a fresh event caption wins over the status line, a stale one does not', () => {
    const s = sess({ options: { roll: true }, owner: { 11: 'me' }, bubble: b({ type: 'own', reason: 'buy', tile: 11, player: 'me' }) });
    const spec = buildActionSpec(s);
    expect(captionFor(s, spec, { fresh: true }).text).toBe('You bought');
    expect(captionFor(s, spec, { fresh: false }).text).toBe('Your turn — roll!');
    expect(captionFromStatus(s, spec).key).toMatch(/^s:/);
  });
});

describe('chipFor', () => {
  it('shows the price of a free district and the owner with the rent of a sold one', () => {
    const free = chipFor(sess(), 29);
    expect(free).toMatchObject({ name: 'Madhapur', amount: 320000, owner: null });
    expect(free.amountLabel).toMatch(/for sale ₹3,20,000/);
    const owned = chipFor(sess({ owner: { 29: 'sana' } }), 29);
    expect(owned.owner).toMatchObject({ id: 'sana', color: '#4cc9f0' });
    expect(owned.amount).toBe(32000);
    expect(owned.amountLabel).toMatch(/rent ₹32,000/);
    const upgraded = chipFor(sess({ owner: { 29: 'sana' }, level: { 29: 2 } }), 29);
    expect(upgraded.amount).toBeGreaterThan(owned.amount);
  });

  it('has no amount for special squares and nothing for a bad id', () => {
    expect(chipFor(sess(), 0).amount).toBeNull();
    expect(chipFor(sess(), null)).toBeNull();
    expect(chipFor(sess(), 99)).toBeNull();
  });
});

describe('primaryFor / pillFor / buyActions (plain words from the shared action spec)', () => {
  const spec = (o) => buildActionSpec(sess(o));
  it('ROLL, ROLL AGAIN, END TURN', () => {
    expect(primaryFor(spec({ options: { roll: true } }))).toMatchObject({ text: 'ROLL', disabled: false, key: 'roll' });
    expect(primaryFor(buildActionSpec({ ...sess({ options: { roll: true } }), view: { ...sess().view, extraRoll: true } })).text).toBe('ROLL AGAIN');
    expect(primaryFor(spec({ options: { endTurn: true } })).text).toBe('END TURN');
  });

  it('BUY with the price in rupees; PASS when I cannot afford it', () => {
    const buy = spec({ options: { buy: true, skipBuy: true }, pending: { type: 'buy', tile: 29, price: 320000 } });
    expect(primaryFor(buy).text).toBe('BUY ₹3,20,000');
    expect(primaryFor(buy).aria).toBe('Buy for ₹3,20,000');
    const poor = spec({ options: { skipBuy: true }, pending: { type: 'buy', tile: 29, price: 320000 } });
    expect(poor.kind).toBe('skip');
    expect(primaryFor(poor)).toMatchObject({ text: 'PASS', key: 'skip' });
    expect(primaryFor(poor).sub).toMatch(/Need ₹/);
  });

  it('traffic: the first choice is the big button, the others are pills', () => {
    const t = spec({ options: { roll: true, payTraffic: 25000, useChai: true } });
    expect(t.kind).toBe('traffic');
    expect(primaryFor(t).text).toBe('USE CHAI');
    expect(t.secondaries.map((s) => pillFor(s, sess()).text)).toEqual(['Pay ₹25,000', 'Wait it out']);
  });

  it('ride and end-turn pills, pass for the auction choice', () => {
    const s = sess({ options: { roll: true, ride: { to: 14, fare: 35000 } } });
    const r = buildActionSpec(s).secondaries.map((x) => pillFor(x, s));
    expect(r).toEqual([expect.objectContaining({ key: 'ride', text: 'Ride ₹35,000', action: { type: 'RIDE' } })]);
    const buy = spec({ options: { buy: true, skipBuy: true }, pending: { type: 'buy', tile: 29, price: 320000 } });
    expect(buy.secondaries.map((x) => pillFor(x, sess()).text)).toEqual(['Pass']);
  });

  it('waiting on someone else is a calm disabled state with the name', () => {
    const w = primaryFor(spec({ turn: 1 }));
    expect(w).toMatchObject({ disabled: true, text: 'Waiting for Ravi…', key: 'wait' });
    expect(w.waitFor.id).toBe('rav');
    expect(primaryFor(spec({ trade: { from: 'rav', to: 'sana' }, turn: 0 })).disabled).toBe(true);
    expect(primaryFor({ kind: 'busy', primary: null, secondaries: [] }).disabled).toBe(true);
  });

  it('buy / pass actions come straight from the spec', () => {
    const buy = spec({ options: { buy: true, skipBuy: true }, pending: { type: 'buy', tile: 29, price: 320000 } });
    expect(buyActions(buy)).toEqual({ buy: { type: 'BUY' }, skip: { type: 'SKIP_BUY' } });
    const poor = spec({ options: { skipBuy: true }, pending: { type: 'buy', tile: 29, price: 320000 } });
    expect(buyActions(poor)).toEqual({ buy: null, skip: { type: 'SKIP_BUY' } });
    expect(buyActions(spec({ options: { roll: true } }))).toEqual({ buy: null, skip: null });
  });
});

describe('buyCardData', () => {
  const madhapur = TILES[29];
  it('prints price, base rent, mortgage value, three levels and the upgrade cost', () => {
    const d = buyCardData(madhapur, { cash: 1000000 });
    expect(d).toMatchObject({ name: 'Madhapur', price: 320000, rent: 32000, mortgage: 160000, upgradeCost: 160000, canBuy: true, short: 0, reason: '' });
    expect(d.collection).toBe(GROUPS.cyber.name);
    expect(d.levels).toHaveLength(3);
    expect(d.levels.map((l) => l.name)).toEqual(['Startup Office', 'Business Centre', 'Tech Campus']);
    expect(d.levels[0].rent).toBe(32000);
    expect(d.levels[2].rent).toBeGreaterThan(d.levels[1].rent);
    expect(d.tones.ink).toMatch(/^#/);
  });

  it('disables buying with the shortfall when cash is short', () => {
    const d = buyCardData(madhapur, { cash: 20000 });
    expect(d).toMatchObject({ canBuy: false, short: 300000, reason: 'Need ₹3,00,000 more' });
    expect(buyCardData(madhapur, { cash: 20000, canBuy: true }).canBuy).toBe(true);
  });

  it('says where a pass goes: a sealed auction when the table plays it, else the city', () => {
    expect(buyCardData(madhapur, { auction: true }).passNote).toMatch(/sealed auction/);
    expect(buyCardData(madhapur, { auction: false }).passNote).toMatch(/city/);
    expect(buyCardData(null)).toBeNull();
  });

  it('uses the pending price when it differs from the list price', () => {
    expect(buyCardData(madhapur, { price: 100000, cash: 120000 })).toMatchObject({ price: 100000, canBuy: true });
  });
});

describe('tile faces', () => {
  it('every collection gets a flat body and a lighter band that keep AA with the ink', () => {
    for (const g of Object.values(GROUPS)) {
      const t = faceTones(g.color);
      expect(contrastRatio(t.body, t.ink), `${g.id} body`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.band, t.ink), `${g.id} band`).toBeGreaterThanOrEqual(4.5);
      expect(t.band, `${g.id} band differs`).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(faceTones('#c98b4a')).toBe(faceTones('#c98b4a')); // cached
  });

  it('classifies every tile and prints a label for each non-district tile', () => {
    for (const tile of TILES) {
      const k = faceKind(tile);
      expect(['prop', 'transport', 'card', 'corner']).toContain(k);
      if (k !== 'prop') expect(faceLabel(tile).length, tile.name).toBeGreaterThan(0);
    }
    expect(TILES.filter((t) => faceKind(t) === 'corner').map((t) => faceLabel(t))).toEqual(['START', 'TRAFFIC', 'CHAI ADDA', 'MUNICIPAL', 'AUCTION']);
    expect(TILES.filter((t) => faceKind(t) === 'transport').map((t) => faceLabel(t))).toEqual(['AUTO', 'METRO', 'MMTS']);
    expect(TILES.filter((t) => t.type === 'card').map((t) => faceLabel(t))).toEqual(['LUCK', 'DRAMA', 'LUCK', 'DRAMA']);
    expect(stopKind({ name: 'Metro Interchange' })).toBe('metro');
  });

  it('district names are capitals on one or two lines with the longest line counted', () => {
    for (const tile of TILES.filter((t) => t.type === 'property')) {
      const { lines, chars } = faceName(tile);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(2);
      lines.forEach((l) => expect(l).toBe(l.toUpperCase()));
      expect(chars).toBe(Math.max(...lines.map((l) => l.length)));
      expect(chars, tile.name).toBeLessThanOrEqual(9);
    }
    expect(faceName({ short: 'Tolichowki' })).toEqual({ lines: ['TOLI-', 'CHOWKI'], chars: 6 });
  });
});
