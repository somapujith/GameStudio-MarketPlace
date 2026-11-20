// The words of a game follow the table's map: Hyderabad says what it always said, Andhra Aatalu says its own words
// (tile labels, collection blurbs, piece names, ride / token / corner wording, city events, the tour).
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { TILES, GROUPS } from '@shared/board.js';
import { applyMap, DEFAULT_MAP, MAPS, pieceNameOf, termsOf } from '@shared/maps.js';
import { wordsOf } from '@/lib/mapWords.js';
import { describeEvent } from '@/lib/messages.js';
import { ANDHRA_PIECE_NAMES } from '@/components/art/andhra/pieces.jsx';
import { PIECE_NAMES } from '@/components/art/PieceArt.jsx';
import { skinPieces } from '@/components/online/mapModel.js';
import { cleanPieces } from '@/components/online/lobbyModel.js';
import { labelLines } from './tileLabel.js';
import { faceKind, faceLabel, faceName } from './phone/phoneModel.js';
import { COLLECTIONS, DECKS, pieceName, tileTypeLabel } from './ui/helpers.js';
import { squareRule } from './PropertySheet.jsx';
import { buildGameSteps } from './gameTour.js';
import { decisionOf } from './decision/decisionModel.js';
import { tipModel } from './board/tipModel.js';
import { eventFlagFor, eventEmoji } from './board/eventFlag.js';
import { eventInfo } from './EventBanner.jsx';
import { eventMark } from './Tile.jsx';
import { reasonLabel } from './fx/fxModel.js';
import { kickerOf, reasonLine } from './auction/auctionModel.js';
import { ChaiToken, rowLabel } from './MoneyBar.jsx';

afterEach(() => applyMap(DEFAULT_MAP));

const ctx = { me: 'a', players: [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Ravi' }], round: 1 };
const say = (ev) => describeEvent(ev, ctx)?.text;

describe('phone tile labels', () => {
  it('Hyderabad keeps AUTO / METRO / MMTS, LUCK / DRAMA and its corner words', () => {
    expect(TILES.filter((t) => faceKind(t) === 'transport').map((t) => faceLabel(t))).toEqual(['AUTO', 'METRO', 'MMTS']);
    expect(TILES.filter((t) => t.type === 'card').map((t) => faceLabel(t))).toEqual(['LUCK', 'DRAMA', 'LUCK', 'DRAMA']);
    expect(TILES.filter((t) => faceKind(t) === 'corner').map((t) => faceLabel(t))).toEqual(['START', 'TRAFFIC', 'CHAI ADDA', 'MUNICIPAL', 'AUCTION']);
  });

  it('Andhra prints its own tile names, short enough for a 320px board', () => {
    applyMap('andhra');
    expect(faceLabel(TILES[5])).toBe('VIZAG PORT');
    expect(faceLabel(TILES[14])).toBe('JUNCTION'); // "Rail Junction" is shortened to its longest word
    expect(faceLabel(TILES[23])).toBe('AIRPORT');
    expect(faceLabel(TILES[18])).toBe('SANKRANTI'); // Sankranti Fair
    expect(faceLabel(TILES[27])).toBe('ROAD TOLL');
    expect(faceLabel(TILES[9])).toBe('TRAFFIC');
    expect(faceLabel(TILES[0])).toBe('START');
    expect(faceLabel(TILES[32])).toBe('AUCTION');
    expect(faceLabel(TILES[2])).toBe('ADRUSHTAM');
    expect(faceLabel(TILES[12])).toBe('KABURLU');
    const words = TILES.filter((t) => t.type !== 'property').map((t) => faceLabel(t)).join(' ');
    for (const old of ['AUTO', 'METRO', 'MMTS', 'LUCK', 'DRAMA', 'CHAI', 'MUNICIPAL']) expect(words).not.toContain(old);
    for (const t of TILES.filter((x) => x.type !== 'property')) expect(faceLabel(t).length, t.name).toBeLessThanOrEqual(10);
  });

  it('an explicit map id wins over the active one', () => {
    applyMap('andhra');
    expect(faceLabel(TILES[5], 'hyderabad')).toBe('AUTO');
  });

  it("Andhra districts print on at most two lines of nine characters, honouring the skin's own `lines`", () => {
    applyMap('andhra');
    expect(labelLines(TILES[7])).toEqual(['Machili-', 'patnam']);
    expect(faceName(TILES[13]).lines).toEqual(['Rajah-', 'mundry']);
    for (const t of TILES) {
      const lines = labelLines(t);
      expect(lines.length, t.name).toBeGreaterThanOrEqual(1);
      expect(lines.length, t.name).toBeLessThanOrEqual(2);
      for (const l of lines) expect(l.length, `${t.name}: ${l}`).toBeLessThanOrEqual(9);
    }
    applyMap(DEFAULT_MAP);
    expect(labelLines(TILES[7])).toEqual(['Char-', 'minar']); // the default map has no `lines`: its own table
  });
});

describe('collection identity blurbs', () => {
  it("every collection of both maps has one; the Hyderabad lines are the ones the deed sheet always showed", () => {
    expect(COLLECTIONS.map((c) => c.identity).every(Boolean)).toBe(true);
    expect(MAPS.hyderabad.groups.oldcity.identity).toBe('Heritage, tourism, shopping and the best food in town.');
    for (const c of COLLECTIONS) expect(MAPS.hyderabad.groups[c.id].identity).toBe(c.identity);
    for (const id of Object.keys(GROUPS)) expect(MAPS.andhra.groups[id].identity, id).toBeTruthy();
  });

  it('follow the active map and come back', () => {
    const before = COLLECTIONS.map((c) => c.identity);
    applyMap('andhra');
    const and = COLLECTIONS.map((c) => c.identity);
    expect(and).toEqual(Object.keys(GROUPS).map((id) => MAPS.andhra.groups[id].identity));
    expect(and.join(' ')).not.toMatch(/Hyderabad|biryani|Cyber|film|cinema glamour/i);
    applyMap(DEFAULT_MAP);
    expect(COLLECTIONS.map((c) => c.identity)).toEqual(before);
    expect(GROUPS.bazaar.identity).toBeUndefined(); // the shared board objects stay as board.js has them
  });
});

describe('piece names', () => {
  it('the map data and the art agree on what the six Andhra tokens are', () => {
    expect(MAPS.andhra.pieceNames).toEqual(ANDHRA_PIECE_NAMES);
    expect(Object.values(ANDHRA_PIECE_NAMES)).toEqual(['Mango', 'Fishing boat', 'Red chilli', 'Kondapalli elephant', 'Veena', 'Sankranti kite']);
    expect(MAPS.hyderabad.pieceNames).toEqual(PIECE_NAMES);
  });

  it('the lobby picker, seats and sheets name the pieces of the map', () => {
    const manifest = [{ id: 'pearl', name: 'Pearl' }, { id: 'auto', name: 'Auto-rickshaw' }, { id: 'chai', name: 'Irani chai glass' }];
    expect(skinPieces(manifest, 'hyderabad')).toBe(manifest);
    expect(skinPieces(manifest, null)).toBe(manifest);
    expect(cleanPieces(skinPieces(manifest, { map: 'andhra' }))).toEqual([
      { id: 'pearl', name: 'Mango' }, { id: 'auto', name: 'Fishing boat' }, { id: 'chai', name: 'Kondapalli elephant' },
    ]);
    expect(pieceName('pearl')).toBe('Pearl');
    applyMap('andhra');
    expect(pieceName('pearl')).toBe('Mango');
    expect(pieceName('camera')).toBe('Sankranti kite');
    expect(pieceNameOf('andhra', 'bat')).toBe('Veena');
  });
});

describe('words in sentences', () => {
  it('wordsOf reads the active map', () => {
    expect(wordsOf().chaiToken).toBe('chai token');
    expect(wordsOf().luck).toBe('Nawabi Luck');
    expect(wordsOf().place).toBe('Hyderabad');
    applyMap('andhra');
    expect(wordsOf()).toMatchObject({
      isDefault: false, chaiToken: 'festival token', ChaiToken: 'Festival token', chaiCorner: 'Sankranti Fair', municipalCorner: 'Road Toll',
      auctionTile: 'Mirchi Market Auction', luck: 'Mana Adrushtam', drama: 'Oori Kaburlu', place: 'Andhra',
    });
    expect(wordsOf('hyderabad').chaiCorner).toBe('Chai Adda');
    expect(termsOf('andhra').place).toBe('Andhra');
  });

  it("the log lines say the same on Hyderabad and name the map's things on Andhra", () => {
    const lines = () => ({
      tax: say({ type: 'cash', reason: 'tax', player: 'b', delta: -40000 }),
      auction: say({ type: 'land', player: 'b', tile: 32 }),
      auctionStart: say({ type: 'auction_start', reason: 'bazaar', tile: 1, minBid: 30000 }),
      chai: say({ type: 'chai', player: 'b', change: 1, reason: 'tile' }),
      chaiCard: say({ type: 'chai', player: 'b', change: 1, reason: 'card' }),
      saved: say({ type: 'chai', player: 'b', change: -1, reason: 'rent', saved: 20000 }),
      traffic: say({ type: 'traffic', player: 'b', reason: 'chai' }),
      win: say({ type: 'win', player: 'b', reason: 'rounds', worth: 3000000 }),
      ride: say({ type: 'ride', player: 'b', from: 5, to: 14, fare: 25000 }),
      card: say({ type: 'card', player: 'b', deck: 'luck', title: 'T', text: 'x' }),
    });
    const hyd = lines();
    expect(hyd.tax).toContain('Municipal Charges');
    expect(hyd.auction).toContain('Bazaar Auction');
    expect(hyd.chai).toBe('Ravi picked up a chai token at the Chai Adda');
    expect(hyd.chaiCard).toBe('Ravi got a free chai token');
    expect(hyd.saved).toBe('Chai break! Ravi saved ₹20,000 on rent');
    expect(hyd.traffic).toBe('Ravi sipped a chai and the traffic melted away');
    expect(hyd.win).toContain('richest in Hyderabad');
    expect(hyd.ride).toContain('Meter kharab hai');
    expect(hyd.card).toContain('drew Nawabi Luck');
    applyMap('andhra');
    const and = lines();
    expect(and.tax).toContain('Road Toll');
    expect(and.auction).toContain('Mirchi Market Auction');
    expect(and.auctionStart).toContain('Mirchi Market Auction!');
    expect(and.chai).toBe('Ravi picked up a festival token at the Sankranti Fair');
    expect(and.chaiCard).toBe('Ravi got a free festival token');
    expect(and.saved).toContain('Festival token!');
    expect(and.traffic).toContain('festival token');
    expect(and.win).toContain('richest in Andhra');
    expect(and.ride).not.toContain('Meter kharab');
    expect(and.card).toContain('drew Mana Adrushtam');
    for (const t of Object.values(and)) expect(t).not.toMatch(/\bchai\b|Hyderabad|Bazaar Auction|Municipal|Nawabi/i);
  });

  it("city events: the log, the banner, the flags and the tile marks use the map's own wording", () => {
    applyMap('andhra');
    const def = MAPS.andhra.events.list.find((e) => e.id === 'biryani_boom');
    const ev = { id: def.id, title: def.title, text: def.text, kind: def.kind, round: 3, groups: ['oldcity', 'everyday'], mult: 2, upgradedOnly: true };
    expect(say({ type: 'city_event', ...ev })).toBe('Sankranti Boom: Sankranti shopping! Upgraded Andhra Crafts and Godavari Gold businesses pay double rent this round.');
    expect(eventInfo(ev)).toMatchObject({ title: 'Sankranti Boom', emoji: '🪁' });
    expect(eventInfo(ev).chips.map((c) => c.name)).toEqual(['Andhra Crafts', 'Godavari Gold']);
    const craft = TILES.find((t) => t.group === 'oldcity');
    expect(eventFlagFor(ev, craft).note).toMatch(/^sankranti boom, upgraded businesses ×2/);
    expect(eventMark(ev, craft).note).toMatch(/^sankranti boom, upgraded businesses pay double/);
    expect(eventEmoji('rush_hour')).toBe('🚦');
    applyMap(DEFAULT_MAP);
    expect(eventInfo({ ...ev, title: 'Biryani Business Boom' }).emoji).toBe('🍛');
    expect(eventFlagFor({ id: 'biryani_boom', round: 3 }, craft).note).toMatch(/^biryani boom/);
    expect(eventMark({ id: 'biryani_boom', groups: ['oldcity'] }, craft).note).toMatch(/^biryani boom,/);
  });
});

describe('the sheets and panels', () => {
  const rule = (id) => squareRule(TILES[id], { cfg: {} });

  it('deed sheet rules for the special squares', () => {
    expect(rule(18).rule).toBe('Grab a chai token (you can hold 1).');
    expect(rule(32).rule).toBe('Bazaar Auction: a random unowned district goes under the hammer.');
    expect(rule(5).note).toContain('Meter kharab hai');
    expect(rule(9).note).toContain('spend a chai token');
    applyMap('andhra');
    expect(rule(18).rule).toBe('Grab a festival token (you can hold 1).');
    expect(rule(32).rule).toBe('Mirchi Market Auction: a random unowned district goes under the hammer.');
    expect(rule(5).note).not.toContain('Meter');
    expect(rule(9).note).toContain('spend a festival token');
    expect(rule(2).rule).toBe('Draw a Mana Adrushtam card.');
    expect(tileTypeLabel(TILES[27])).toBe('Road Toll');
    expect(tileTypeLabel(TILES[32])).toBe('Mirchi Market Auction');
    expect(DECKS.drama.name).toBe('Oori Kaburlu');
  });

  it('the tooltips, the token badge and the auction words', () => {
    expect(tipModel(TILES[18], {}).status).toBe('Collect a chai token');
    expect(renderToStaticMarkup(h(ChaiToken, { count: 1 }))).toContain('>Chai<');
    expect(rowLabel({ player: { name: 'Asha', chai: 1, cash: 1, bankrupt: false }, worth: 1 })).toContain('holds a chai token');
    expect(reasonLabel('chai')).toBe('CHAI');
    expect(kickerOf('bazaar')).toBe('Bazaar Auction');
    applyMap('andhra');
    expect(tipModel(TILES[18], {}).status).toBe('Collect a festival token');
    expect(tipModel(TILES[12], {}).rows[0].value).toBe('Oori Kaburlu');
    const badge = renderToStaticMarkup(h(ChaiToken, { count: 2 }));
    expect(badge).toContain('Token x2');
    expect(badge).toContain('Festival tokens: 2');
    expect(badge.replace(/hg-chai/g, '')).not.toMatch(/chai/i);
    expect(rowLabel({ player: { name: 'Asha', chai: 1, cash: 1, bankrupt: false }, worth: 1 })).toContain('holds a festival token');
    expect(reasonLabel('chai')).toBe('TOKEN');
    expect(kickerOf('bazaar')).toBe('Mirchi Market Auction');
    expect(reasonLine('bazaar')).toContain('Mirchi Market Auction: a free district');
  });

  it('the ride card reads "Ride to Tirupati Airport" on Andhra and keeps the Hyderabad vehicle words', () => {
    const sess = (from, to) => ({
      me: 'a',
      view: { cfg: {}, phase: 'manage', turn: 0, round: 2, turnCount: 3, players: [{ id: 'a', name: 'Asha', pos: from, cash: 900000 }], ride: { player: 'a', from, to, fare: 25000 } },
      options: { ride: { to, fare: 25000 }, endTurn: true },
    });
    const spec = { kind: 'end', upgrades: 0 };
    expect(decisionOf(sess(14, 23), spec).body).toBe('Ride the Metro to MMTS Express for ₹25,000?');
    expect(decisionOf(sess(5, 14), spec).body).toBe('Take the auto to Metro Interchange for ₹25,000?');
    applyMap('andhra');
    const d = decisionOf(sess(14, 23), spec);
    expect(d.body).toBe('Ride to Tirupati Airport for ₹25,000?');
    expect(d.sr).toContain('Ride to Tirupati Airport for ₹25,000');
    expect(d.title).toBe('You landed on Vijayawada Junction');
    expect(decisionOf(sess(5, 14), spec).body).toBe('Ride to Vijayawada Junction for ₹25,000?');
  });
});

describe('the in-game tour', () => {
  const all = (steps) => steps.map((s) => `${s.title} ${s.body}`).join('\n');

  it('Hyderabad: the same words as ever', () => {
    const steps = buildGameSteps({ cfg: {} });
    expect(steps.find((s) => s.id === 'chai').title).toBe('Chai Adda');
    expect(steps.find((s) => s.id === 'transport').title).toBe('Auto, Metro and MMTS');
    expect(all(steps)).toContain('Nawabi Luck and City Drama tiles');
  });

  it("Andhra: the corners, the token and the decks are the map's", () => {
    const steps = buildGameSteps({ cfg: { map: 'andhra' } });
    const byId = (id) => steps.find((s) => s.id === id);
    expect(byId('chai')).toMatchObject({ title: 'Sankranti Fair' });
    expect(byId('chai').body).toContain('festival token');
    expect(byId('transport').title).toBe('Port, Junction and Airport');
    expect(byId('traffic').body).toContain('spend a festival token');
    expect(byId('cards').body).toContain('Mana Adrushtam and Oori Kaburlu');
    expect(byId('municipal').title).toBe('Road Toll');
    expect(byId('bazaar').title).toBe('Mirchi Market Auction');
    expect(byId('welcome').title).toBe(buildGameSteps({ cfg: {} }).find((s) => s.id === 'welcome').title); // the game keeps its name on every map
    // 'Nawabi Raj' is the game's own name and stays on every map; the Hyderabad deck 'Nawabi Luck' must not
    expect(all(steps)).not.toMatch(/\bchai\b|Nawabi Luck|Municipal|Bazaar Auction|Metro|MMTS/i);
  });
});
