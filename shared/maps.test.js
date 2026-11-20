// Maps: two skins of one Hustle board (shared/maps.js, shared/maps/andhra.js). Structure and rules never change between maps.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MAP_IDS, DEFAULT_MAP, MAPS, MAP_LIST, mapOf, mapIdOf, isMapId, sanitizeMap, applyMap, activeMapId, getMapVersion, subscribeMap,
  tileName, tileShort, groupName, levelNameOf, deckName, deckCards, cardOf, cityEventsOf, termsOf, pieceNameOf,
  TILES, GROUPS, GROUP_TILES, BOARD_SIZE, MAX_LEVEL, TRANSPORT_TILES, isBuyable, rentTable, upgradeCost,
  LUCK_CARDS, DRAMA_CARDS, DECK_NAMES, cardById, CITY_EVENTS, RUSH_FLAVOUR, FESTIVALS, PIECES, SNATCH_CAP_PAYOUT,
  createGame, applyAction, getOptions, canUpgrade, normalizeSettings, DEFAULT_SETTINGS, customRuleCount, customRuleKeys, sanitizeRules,
  RULE_KEYS, mulberry32, nextBotMove, previewRent, ruleDefaults,
} from './index.js';
import { labelLines } from '../src/components/game/tileLabel.js';
import { sanitizeSettings, normalizeSettings as roomNormalize, mergeSettingsPatch, ROOM_DEFAULTS, describeSettings, MAP_OPTIONS } from '../worker/settings.js';
import tycoon from '../worker/games/hyderabad-tycoon.js';
import { rowToOpenRoom } from '../worker/roomsdb.js';

vi.setConfig({ testTimeout: 60000 }); // the bot-game tests play whole games; a loaded machine needs more than 5 s

// ---- helpers ----
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** Everything the board data holds (structure AND display), as plain JSON. */
const boardJson = () => JSON.stringify({ TILES, GROUPS });
/** Only the structural fields: these may never differ between maps. */
const structure = () => JSON.stringify({
  tiles: TILES.map((t) => [t.id, t.type, t.price ?? null, t.group ?? null, !!t.corner, t.fare ?? null, t.deck ?? null]),
  groups: Object.entries(GROUPS).map(([id, g]) => [id, g.id, g.tiles]),
  groupTiles: GROUP_TILES,
});

const HYD_JSON = boardJson();
const HYD_STRUCTURE = structure();
afterEach(() => { applyMap('hyderabad'); });

const KNOWN_EFFECTS = ['cash', 'moveTo', 'moveBy', 'nextTransport', 'stuck', 'rentBoost', 'chai', 'snatch', 'collectFromAll', 'payAll', 'perLevel', 'perProperty'];
const CARD_TILES = TILES.filter((t) => t.type === 'card').map((t) => t.id);

describe('the registry', () => {
  it('has the two maps, Hyderabad first and by default', () => {
    expect(MAP_IDS).toEqual(['hyderabad', 'andhra']);
    expect(DEFAULT_MAP).toBe('hyderabad');
    expect(Object.keys(MAPS)).toEqual(MAP_IDS);
    expect(MAP_LIST.map((m) => m.id)).toEqual(MAP_IDS);
    for (const id of MAP_IDS) {
      const m = MAPS[id];
      expect(m.id).toBe(id);
      for (const k of ['name', 'tagline', 'blurb']) expect(typeof m[k], `${id}.${k}`).toBe('string');
      expect(m.palette && typeof m.palette).toBe('object');
      for (const c of Object.values(m.palette)) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      for (const k of ['groups', 'tiles', 'terms', 'decks', 'events']) expect(m[k], `${id}.${k}`).toBeTruthy();
      expect(Object.keys(m.decks)).toEqual(['luck', 'drama']);
    }
    expect(MAPS.andhra.name).toBe('Andhra Aatalu');
    expect(MAPS.andhra.te).toBe('ఆంధ్ర ఆటలు');
  });

  it('looks a map up by id, cfg, settings or state, and falls back to the default', () => {
    expect(mapOf('andhra').id).toBe('andhra');
    expect(mapOf({ map: 'andhra' }).id).toBe('andhra');
    expect(mapOf({ cfg: { map: 'andhra' } }).id).toBe('andhra');
    for (const bad of [undefined, null, 0, 'mars', {}, { map: 'mars' }, { cfg: {} }, [], () => 1, { map: 7 }]) expect(mapOf(bad).id, String(bad)).toBe('hyderabad');
    expect(mapIdOf('andhra')).toBe('andhra');
    expect(isMapId('andhra')).toBe(true);
    expect(isMapId('mars')).toBe(false);
    expect(isMapId(undefined)).toBe(false);
    expect(sanitizeMap('andhra')).toBe('andhra');
    expect(sanitizeMap('toString')).toBe('hyderabad');
    expect(sanitizeMap(5)).toBe('hyderabad');
  });

  it('MAPS.hyderabad is generated from the board data, so the default behaviour is exactly the old one', () => {
    const m = MAPS.hyderabad;
    for (const t of TILES) expect(m.tiles[t.id]).toMatchObject({ name: t.name, short: t.short, lore: t.lore, emoji: t.emoji, art: t.art });
    for (const [id, g] of Object.entries(GROUPS)) expect(m.groups[id]).toMatchObject({ name: g.name, color: g.color, ink: g.ink, levelNames: g.levelNames, theme: g.theme });
    expect(m.decks.luck.cards).toBe(LUCK_CARDS);
    expect(m.decks.drama.cards).toBe(DRAMA_CARDS);
    expect([m.decks.luck.name, m.decks.drama.name]).toEqual([DECK_NAMES.luck, DECK_NAMES.drama]);
    expect(m.events.list).toBe(CITY_EVENTS);
    expect(m.events.rush).toBe(RUSH_FLAVOUR);
    expect(m.events.festivals).toBe(FESTIVALS);
    expect(m.terms).toMatchObject({ chaiCorner: 'Chai Adda', municipalCorner: 'Municipal Charges', auctionTile: 'Bazaar Auction' });
  });
});

describe('both maps are the same board', () => {
  it.each(MAP_IDS)('%s: 36 tiles, every one with a name, a short name and one line of lore', (id) => {
    const m = MAPS[id];
    expect(Object.keys(m.tiles).map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: BOARD_SIZE }, (_, i) => i));
    for (const t of TILES) {
      const s = m.tiles[t.id];
      expect(s.name, `${id} ${t.id}`).toBeTruthy();
      expect(s.short, `${id} ${t.id}`).toBeTruthy();
      expect(s.short.length, `${id} ${s.name}`).toBeLessThanOrEqual(14);
      expect(s.lore.length, s.name).toBeGreaterThan(10);
      expect(s.lore).not.toMatch(/\n/);
      expect(s.te === undefined || /[ఀ-౿]/.test(s.te), `${s.name} te`).toBe(true);
    }
  });

  it.each(MAP_IDS)('%s: 8 collections of 3 districts on the same slots, names unique, 3 level names each', (id) => {
    const m = MAPS[id];
    expect(Object.keys(m.groups)).toEqual(Object.keys(GROUPS));
    const districts = TILES.filter(isBuyable);
    expect(districts).toHaveLength(24);
    for (const [g, tiles] of Object.entries(GROUP_TILES)) expect(tiles, g).toHaveLength(3);
    const names = districts.map((t) => m.tiles[t.id].name);
    const shorts = districts.map((t) => m.tiles[t.id].short);
    expect(new Set(names).size).toBe(24);
    expect(new Set(shorts).size).toBe(24);
    const groupNames = Object.values(m.groups).map((g) => g.name);
    expect(new Set(groupNames).size).toBe(8);
    for (const g of Object.values(m.groups)) {
      expect(g.levelNames).toHaveLength(MAX_LEVEL + 1);
      expect(new Set(g.levelNames).size).toBe(MAX_LEVEL + 1);
      expect(g.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(g.ink).toMatch(/^#[0-9a-f]{6}$/i);
      expect(g.te === undefined || /[ఀ-౿]/.test(g.te)).toBe(true);
    }
    expect(new Set(Object.values(m.groups).map((g) => g.color)).size).toBe(8);
    // the non-district tiles have distinct names too, except the two tiles of one deck, which share the deck's name
    const others = TILES.filter((t) => !isBuyable(t) && t.type !== 'card').map((t) => m.tiles[t.id].name);
    expect(new Set([...names, ...others]).size).toBe(names.length + others.length);
    for (const t of TILES.filter((x) => x.type === 'card')) expect(m.tiles[t.id].name).toBe(m.decks[t.deck].name);
  });

  it('every Andhra group colour carries its ink at AA contrast (4.5:1)', () => {
    for (const [g, v] of Object.entries(MAPS.andhra.groups)) expect(contrast(v.color, v.ink), `${g} ${v.name}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MAP_IDS)('%s: every tile fits a phone tile (two lines of at most 9 characters)', (id) => {
    applyMap(id);
    for (const t of TILES) {
      const lines = t.lines || labelLines(t);
      expect(lines.length, `${id} ${t.name}`).toBeGreaterThanOrEqual(1);
      expect(lines.length, `${id} ${t.name}`).toBeLessThanOrEqual(2);
      for (const l of lines) expect(l.length, `${t.name} "${l}"`).toBeLessThanOrEqual(9);
      if (t.lines) expect(t.lines.join('').replace(/-/g, '').replace(/\s/g, '')).toBe(t.short.replace(/\s/g, ''));
    }
  });

  it('applying a map never changes the structure: ids, types, prices, groups, corners, fares, decks, rents, upgrade costs', () => {
    const rents = () => JSON.stringify(TILES.map((t) => [rentTable(t), upgradeCost(t)]));
    const before = rents();
    for (const id of [...MAP_IDS, ...MAP_IDS.slice().reverse()]) {
      applyMap(id);
      expect(structure(), id).toBe(HYD_STRUCTURE);
      expect(rents(), id).toBe(before);
    }
    expect(TRANSPORT_TILES).toEqual([5, 14, 23]);
    expect(TILES.filter(isBuyable).map((t) => t.price)).toEqual([60000, 70000, 80000, 100000, 110000, 120000, 140000, 150000, 160000, 180000, 190000, 200000, 220000, 230000, 240000, 260000, 270000, 280000, 300000, 320000, 340000, 360000, 380000, 400000]);
  });
});

describe('the Andhra Aatalu map', () => {
  // The concept's collections table (Andhra_Empire_Game_Concept.md section 3), on the group slots in ascending price order.
  const TABLE = {
    bazaar: ['Towns & Markets', ['Chirala', 'Ongole', 'Nellore']],
    oldcity: ['Andhra Crafts', ['Kondapalli', 'Machilipatnam', 'Mangalagiri']],
    everyday: ['Godavari Gold', ['Amalapuram', 'Kakinada', 'Rajamahendravaram']],
    twin: ['Uttarandhra', ['Srikakulam', 'Vizianagaram', 'Visakhapatnam']],
    lake: ['Nature & Heritage', ['Araku Valley', 'Lepakshi', 'Gandikota']],
    luxury: ['Rayalaseema', ['Kadapa', 'Anantapur', 'Kurnool']],
    cyber: ['Spiritual Andhra', ['Srikalahasti', 'Srisailam', 'Tirupati']],
    newcity: ['Capital & Commerce', ['Guntur', 'Vijayawada', 'Amaravati']],
  };

  it('puts the 24 destinations of the concept into its 8 collections, on the same slots as the Hyderabad groups', () => {
    for (const [g, [name, towns]] of Object.entries(TABLE)) {
      expect(MAPS.andhra.groups[g].name).toBe(name);
      expect(GROUP_TILES[g].map((t) => MAPS.andhra.tiles[t].name), g).toEqual(towns);
    }
    expect(Object.values(GROUP_TILES).flat()).toEqual([1, 3, 4, 6, 7, 8, 10, 11, 13, 15, 16, 17, 19, 20, 22, 24, 25, 26, 28, 29, 31, 33, 34, 35]);
  });

  it('skins the specials: hubs, Sankranti Fair, Road Toll, Mirchi Market Auction, the two Andhra decks', () => {
    const t = MAPS.andhra.tiles;
    expect([5, 14, 23].map((i) => t[i].name)).toEqual(['Visakhapatnam Port', 'Vijayawada Junction', 'Tirupati Airport']);
    expect(t[9].name).toBe('Traffic Jam');
    expect(t[18].name).toBe('Sankranti Fair');
    expect(t[27].name).toBe('Road Toll');
    expect(t[32].name).toBe('Mirchi Market Auction');
    expect([2, 21].map((i) => t[i].name)).toEqual(['Mana Adrushtam', 'Mana Adrushtam']);
    expect([12, 30].map((i) => t[i].name)).toEqual(['Oori Kaburlu', 'Oori Kaburlu']);
    expect(MAPS.andhra.decks.luck).toMatchObject({ name: 'Mana Adrushtam', te: 'మన అదృష్టం' });
    expect(MAPS.andhra.decks.drama).toMatchObject({ name: 'Oori Kaburlu', te: 'ఊరి కబుర్లు' });
    expect(MAPS.andhra.terms).toMatchObject({ chaiToken: 'festival token', chaiCorner: 'Sankranti Fair', municipalCorner: 'Road Toll' });
  });

  it('keeps the heritage rule: the lore of temple, fort and monument districts says the place itself is not for sale', () => {
    for (const id of [20, 22, 28, 29, 31]) expect(MAPS.andhra.tiles[id].lore, MAPS.andhra.tiles[id].name).toMatch(/fictional/);
    for (const id of [20, 22, 28, 29, 31]) expect(MAPS.andhra.tiles[id].lore, MAPS.andhra.tiles[id].name).toMatch(/belong|stays sacred/);
    for (const t of TILES.filter(isBuyable)) expect(MAPS.andhra.tiles[t.id].lore, MAPS.andhra.tiles[t.id].name).toMatch(/fictional/);
  });

  it('names the six tokens after the concept (one per piece)', () => {
    expect(MAPS.andhra.tokenNames).toHaveLength(PIECES.length);
    for (const p of PIECES) expect(pieceNameOf('andhra', p.id)).toBeTruthy();
    expect(pieceNameOf('hyderabad', 'chai')).toBe('Irani chai glass');
    expect(new Set(MAPS.andhra.tokenNames).size).toBe(PIECES.length);
  });
});

describe('applyMap (client only)', () => {
  it('rewrites the display fields in place and a round trip restores everything', () => {
    expect(boardJson()).toBe(HYD_JSON);
    const tile = TILES[31];
    const group = GROUPS.cyber;
    const levels = group.levelNames;
    const v0 = getMapVersion();
    const r = applyMap('andhra');
    expect(r).toMatchObject({ id: 'andhra', mapId: 'andhra' });
    expect(r.version).toBe(v0 + 1);
    expect(r.mapVersion).toBe(r.version);
    expect(activeMapId()).toBe('andhra');
    expect(TILES[31]).toBe(tile); // the same object, mutated
    expect(tile.name).toBe('Tirupati');
    expect(tile.te).toBe('తిరుపతి');
    expect(group.name).toBe('Spiritual Andhra');
    expect(group.levelNames).toBe(levels);
    expect(group.levelNames).toEqual(['Prasadam Stall', 'Pilgrim Lodge', 'Pilgrim Hospitality Hub']);
    expect(TILES[0].name).toBe('START — Andhra Yatra');
    expect(TILES[18].name).toBe('Sankranti Fair');
    expect(TILES[7].lines).toEqual(['Machili-', 'patnam']);
    expect(structure()).toBe(HYD_STRUCTURE);
    expect(boardJson()).not.toBe(HYD_JSON);
    expect(applyMap('hyderabad').version).toBe(v0 + 2);
    expect(boardJson()).toBe(HYD_JSON); // fields that only Andhra has (te, lines) are removed again
    expect('te' in tile).toBe(false);
    expect('lines' in TILES[7]).toBe(false);
  });

  it('is idempotent: applying the active map again changes nothing and keeps the version', () => {
    applyMap('andhra');
    const v = getMapVersion();
    const once = boardJson();
    expect(applyMap('andhra').version).toBe(v);
    expect(applyMap({ map: 'andhra' }).version).toBe(v);
    expect(applyMap({ cfg: { map: 'andhra' } }).version).toBe(v);
    expect(boardJson()).toBe(once);
    expect(applyMap(undefined).id).toBe('hyderabad'); // unknown = the default map
    expect(getMapVersion()).toBe(v + 1);
  });

  it('tells subscribers when the map changes, and only then', () => {
    const seen = [];
    const off = subscribeMap((id, v) => seen.push([id, v]));
    applyMap('andhra');
    applyMap('andhra');
    applyMap('hyderabad');
    off();
    applyMap('andhra');
    expect(seen.map((x) => x[0])).toEqual(['andhra', 'hyderabad']);
    expect(seen[1][1]).toBe(seen[0][1] + 1);
  });

  it('leaves the per-map readers alone: the engine reads names through the map, not through the mutated TILES', () => {
    applyMap('andhra');
    expect(TILES[31].name).toBe('Tirupati');
    expect(tileName('hyderabad', 31)).toBe('HITEC City');
    expect(tileName({ map: 'andhra' }, 31)).toBe('Tirupati');
    expect(tileShort('andhra', 17)).toBe('Vizag');
    expect(groupName('hyderabad', 'cyber')).toBe('Cyberabad');
    expect(groupName('andhra', 'cyber')).toBe('Spiritual Andhra');
    expect(levelNameOf('hyderabad', 28, 2)).toBe('Tech Campus');
    expect(levelNameOf('andhra', TILES[28], 2)).toBe('Pilgrim Hospitality Hub');
    expect(levelNameOf('andhra', TILES[5], 1)).toBe('Expanded'); // not a district: the generic names
    expect(deckName('andhra', 'drama')).toBe('Oori Kaburlu');
    expect(termsOf('andhra').chaiToken).toBe('festival token');
  });
});

describe('the decks', () => {
  const decks = (id) => [...MAPS[id].decks.luck.cards, ...MAPS[id].decks.drama.cards];

  it('every card has an id, title, text, a legal kind and a known effect; ids are unique across both maps', () => {
    const ids = [];
    for (const id of MAP_IDS) {
      for (const c of decks(id)) {
        ids.push(c.id);
        expect(c.title && c.text, `${id} ${c.id}`).toBeTruthy();
        expect(['good', 'bad', 'neutral']).toContain(c.kind);
        expect(KNOWN_EFFECTS, `${id} ${c.id}`).toContain(c.effect.type);
        if (c.effect.type === 'cash') expect(Number.isInteger(c.effect.amount) && c.effect.amount % 1000 === 0 && c.effect.amount !== 0, c.id).toBe(true);
        if (c.effect.type === 'moveTo') expect(CARD_TILES, `${id} ${c.id} must not point at a card tile`).not.toContain(c.effect.tile);
        if (c.effect.type === 'moveTo') expect(c.effect.tile).toBeGreaterThanOrEqual(0);
        if (c.effect.type === 'moveTo') expect(c.effect.tile).toBeLessThan(BOARD_SIZE);
        if (c.effect.type === 'snatch') expect(c.capText, c.id).toBeTruthy();
        if (c.te) expect(c.te).toMatch(/[ఀ-౿]/);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the Andhra decks have the size, the Snatch cards and the balance of the Hyderabad decks', () => {
    for (const d of ['luck', 'drama']) {
      const h = MAPS.hyderabad.decks[d].cards;
      const a = MAPS.andhra.decks[d].cards;
      expect(a.length, d).toBe(h.length);
      expect(a.filter((c) => c.effect.type === 'snatch').length, d).toBe(h.filter((c) => c.effect.type === 'snatch').length);
      expect(a.filter((c) => c.kind === 'bad').length, d).toBe(h.filter((c) => c.kind === 'bad').length);
      expect(a.filter((c) => c.kind === 'good').length, d).toBe(h.filter((c) => c.kind === 'good').length);
      const sum = (cards) => cards.filter((c) => c.effect.type === 'cash').reduce((n, c) => n + c.effect.amount, 0) / cards.length;
      expect(Math.abs(sum(a)) / Math.abs(sum(h)), d).toBeGreaterThan(0.7); // the average cash of a card: within 30% of the Hyderabad deck
      expect(Math.abs(sum(a)) / Math.abs(sum(h)), d).toBeLessThan(1.3);
      expect(Math.sign(sum(a)), d).toBe(Math.sign(sum(h)));
    }
    expect(MAPS.andhra.decks.luck.cards.filter((c) => c.effect.type === 'snatch')).toHaveLength(3);
    for (const c of MAPS.andhra.decks.luck.cards.filter((x) => x.effect.type === 'snatch')) expect(c.capText).toMatch(/₹50,000/);
    expect(SNATCH_CAP_PAYOUT).toBe(50000);
    expect(MAPS.andhra.decks.drama.cards.some((c) => c.effect.type === 'cash' && c.effect.amount > 0)).toBe(true); // not all bad
    expect(MAPS.andhra.decks.drama.cards.filter((c) => c.kind === 'bad').length).toBeGreaterThan(MAPS.andhra.decks.drama.cards.length / 2);
  });

  it("carries the concept's cards and flavour text", () => {
    const t = (d) => MAPS.andhra.decks[d].cards.map((c) => c.title);
    for (const title of ['Sankranti Bonus', 'Mirchi Rates Up!', 'Cinema Blockbuster', 'Konaseema Tourism', 'Business Expansion', 'Export Success', 'Bommala Bazaar', 'Sankranti Homecoming', 'Fast Highway', 'Smart Investment']) expect(t('luck')).toContain(title);
    for (const title of ['Traffic, Baboi!', 'Pelliki Pilicharu!', 'Mirchi Rates Down', 'Power Cut!', 'Unexpected Repairs', 'Rainy Day', 'Last-Minute Booking', 'Extra Family Guests', 'Movie Shoot!', 'Land Deal Gone Wrong']) expect(t('drama')).toContain(title);
    expect(MAPS.andhra.decks.luck.cards[0].te).toBe('సంక్రాంతి బోనస్');
    const by = (title) => MAPS.andhra.decks.luck.cards.concat(MAPS.andhra.decks.drama.cards).find((c) => c.title === title);
    expect(by('Cinema Blockbuster').effect).toEqual({ type: 'cash', amount: 100000 });
    expect(by('Fast Highway').effect).toEqual({ type: 'nextTransport' });
    expect(by('Rainy Day').effect).toEqual({ type: 'moveBy', n: -3 });
    expect(by('Traffic, Baboi!').effect).toEqual({ type: 'stuck' });
    expect(by('Pelliki Pilicharu!').effect).toEqual({ type: 'cash', amount: -40000 });
  });

  it('card lookup finds the cards of every map', () => {
    expect(cardById('an_rainy_day')).toBe(cardOf('andhra', 'an_rainy_day'));
    expect(cardById('biryani_viral')).toBeTruthy();
    expect(cardOf('hyderabad', 'an_rainy_day')).toBeTruthy(); // ids are unique across maps, so a lookup may cross over
    expect(cardOf('andhra', 'nope')).toBeNull();
    expect(deckCards('andhra', 'luck')).toBe(MAPS.andhra.decks.luck.cards);
    expect(deckCards(undefined, 'luck')).toBe(LUCK_CARDS);
  });
});

describe('the city events', () => {
  it('are the same five events with the same mechanics, in Andhra wording', () => {
    const h = MAPS.hyderabad.events;
    const a = MAPS.andhra.events;
    expect(a.list.map((e) => e.id)).toEqual(h.list.map((e) => e.id));
    for (const [i, e] of a.list.entries()) {
      const { title: _t, text: _x, ...mech } = e;
      const { title: _t2, text: _x2, ...hmech } = h.list[i];
      expect(mech, e.id).toEqual(hmech);
      expect(e.title && e.text).toBeTruthy();
      expect(e.text).not.toBe(h.list[i].text);
    }
    expect(Object.keys(a.rush)).toEqual(Object.keys(GROUPS));
    for (const [g, r] of Object.entries(a.rush)) {
      expect(r.text, g).toContain(MAPS.andhra.groups[g].name);
      expect(r.text).toContain('1.5x');
    }
    expect(a.festivals).toHaveLength(h.festivals.length);
    expect(a.monsoon).toContain('{group}');
    expect(h.monsoon).toContain('{group}');
    expect(a.every).toBe(h.every);
    expect(cityEventsOf('andhra')).toBe(a.list);
    const names = a.list.map((e) => e.title);
    expect(names).toEqual(expect.arrayContaining(['Sankranti Boom', 'Tourism Season', 'Mirchi Market Swing']));
    const words = [...a.list, ...Object.values(a.rush), ...a.festivals].flatMap((e) => [e.title, e.text]).join(' ') + a.monsoon; // ids such as biryani_boom stay: the engine keys on them
    expect(words).not.toMatch(/Hyderabad|biryani|Bonalu|Bathukamma|Charminar/i);
  });
});

// ---- settings ----

describe('the map setting', () => {
  it('is a lobby setting, not a host rule: not a rule field, never a custom rule', () => {
    expect(RULE_KEYS).not.toContain('map');
    expect(customRuleCount({ map: 'andhra' })).toBe(0);
    expect(customRuleKeys({ mode: 'standard', map: 'andhra', rentPercent: 150 })).toEqual(['rentPercent']);
    expect(sanitizeRules({ map: 'andhra' })).not.toHaveProperty('map');
    expect(tycoon.customRules({ map: 'andhra' })).toBe(0);
    expect(tycoon.customRules({ map: 'andhra', rentPercent: 150 })).toBe(1);
  });

  it('is stored only when it is not the default map (an absent map is Hyderabad)', () => {
    expect(normalizeSettings({}).map).toBeUndefined();
    expect(normalizeSettings({ map: 'hyderabad' })).not.toHaveProperty('map');
    expect(normalizeSettings({ map: 'andhra' }).map).toBe('andhra');
    expect(normalizeSettings({ map: 'mars' })).not.toHaveProperty('map');
    expect(normalizeSettings({ map: 7 })).not.toHaveProperty('map');
    expect(DEFAULT_SETTINGS).not.toHaveProperty('map');
    expect(ROOM_DEFAULTS).not.toHaveProperty('map');
  });

  it('is validated, persisted and normalised by the room settings', () => {
    expect(MAP_OPTIONS).toEqual(['hyderabad', 'andhra']);
    expect(sanitizeSettings({ map: 'andhra' })).toEqual({ settings: { map: 'andhra' }, errors: [], maxPlayers: undefined });
    expect(sanitizeSettings({ map: 'hyderabad' }).settings).toEqual({ map: 'hyderabad' });
    for (const bad of ['mars', 7, null, true, {}, '', ['andhra']]) {
      const r = sanitizeSettings({ map: bad });
      expect(r.errors, String(bad)).toEqual(["Map must be one of 'hyderabad', 'andhra'."]);
      expect(r.settings).not.toHaveProperty('map');
    }
    expect(roomNormalize({ map: 'andhra' })).toEqual({ ...ROOM_DEFAULTS, map: 'andhra' });
    expect(roomNormalize({ map: 'hyderabad' })).toEqual(ROOM_DEFAULTS);
    expect(roomNormalize({ map: 'andhra', mode: 'quick' })).toMatchObject({ map: 'andhra', mode: 'quick' });
    expect(describeSettings({ map: 'andhra' })).toBe('standard / Andhra Aatalu map / lucky dice / target ₹50L');
    expect(describeSettings({})).toBe('standard / lucky dice / target ₹50L');
  });

  it('survives a host patch: picking a map keeps the rules, changing the mode keeps the map, picking Hyderabad drops it', () => {
    const cur = roomNormalize({ rentPercent: 150 });
    const picked = roomNormalize(mergeSettingsPatch(cur, { map: 'andhra' }));
    expect(picked).toEqual({ ...cur, map: 'andhra' });
    const quick = roomNormalize(mergeSettingsPatch(picked, { mode: 'quick' }));
    expect(quick).toMatchObject({ mode: 'quick', map: 'andhra', rentPercent: 150 });
    const back = roomNormalize(mergeSettingsPatch(quick, { map: 'hyderabad' }));
    expect(back).not.toHaveProperty('map');
    expect(back.rentPercent).toBe(150);
  });

  it('goes through the game adapter: validate, lobby view, summary, createGame', () => {
    expect(tycoon.validateSettings({ map: 'andhra' })).toEqual({ ok: true, settings: { ...ROOM_DEFAULTS, map: 'andhra' } });
    expect(tycoon.validateSettings({ map: 'mars' })).toEqual({ ok: false, error: "Map must be one of 'hyderabad', 'andhra'." });
    expect(tycoon.validateSettings({})).toEqual({ ok: true, settings: ROOM_DEFAULTS });
    expect(tycoon.lobbySettings({ map: 'andhra' }).map).toBe('andhra');
    expect(tycoon.lobbySettings({})).not.toHaveProperty('map');
    expect(tycoon.summarize(ROOM_DEFAULTS)).toBe('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
    expect(tycoon.summarize({ map: 'andhra' })).toBe('Standard City Hustle · 20 rounds · richest wins · ₹50L target · Andhra Aatalu map');
    const state = tycoon.createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], settings: { map: 'andhra' }, seed: 5 });
    expect(state.cfg.map).toBe('andhra');
    expect(tycoon.lobbySettings({ map: 'andhra' })).toEqual(state.cfg);
    const hyd = tycoon.createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], settings: {}, seed: 5 });
    expect(hyd.cfg).not.toHaveProperty('map');
    expect(hyd.cfg).toEqual(DEFAULT_SETTINGS);
  });

  it('shows the map on an open-table listing, only for a non-default map', () => {
    const row = (settings) => ({ code: 'ABCD', game_id: 'hyderabad-tycoon', host_name: 'H', player_count: 1, max_players: 4, created_at: new Date(0), settings });
    expect(rowToOpenRoom(row({ ...ROOM_DEFAULTS, map: 'andhra' })).map).toBe('andhra');
    expect(rowToOpenRoom(row(ROOM_DEFAULTS))).not.toHaveProperty('map');
    expect(rowToOpenRoom(row({ ...ROOM_DEFAULTS, map: 'andhra' })).customRules).toBe(0);
  });
});

// ---- the engine on a map ----

const PLAYERS = [{ id: 'a', name: 'Asha', isBot: true }, { id: 'b', name: 'Bala', isBot: true }, { id: 'c', name: 'Chitra', isBot: true }];
/** One bot step the way scripts/simulate.js plays: bots act, a Snatch window is closed by the room's timer. */
const botStep = (s, rnd) => {
  const a = s.phase === 'snatch' ? { type: 'SNATCH_CLOSE' } : nextBotMove(s, rnd);
  if (!a) return null;
  const r = applyAction(s, a);
  if (r.error) throw new Error(`${a.type}: ${r.error}`);
  return r;
};

describe('createGame', () => {
  it('stores cfg.map for Andhra and nothing for the default map', () => {
    expect(createGame({ players: PLAYERS, settings: { map: 'andhra' }, seed: 1 }).cfg.map).toBe('andhra');
    expect(createGame({ players: PLAYERS, settings: { map: 'hyderabad' }, seed: 1 }).cfg).not.toHaveProperty('map');
    expect(createGame({ players: PLAYERS, settings: { map: 'mars' }, seed: 1 }).cfg).not.toHaveProperty('map');
    expect(createGame({ players: PLAYERS, seed: 1 }).cfg).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ map: 'andhra', mode: 'quick' })).toMatchObject({ map: 'andhra', mode: 'quick' });
  });

  it('same seed and settings: the same game, apart from the words (the board and rules are identical)', () => {
    const run = (map) => {
      let s = createGame({ players: PLAYERS, settings: { map, eventEvery: 0, snatches: 0 }, seed: 11 });
      const rnd = mulberry32(3);
      const trace = [];
      for (let i = 0; i < 120 && s.phase !== 'over'; i++) {
        const r = botStep(s, rnd);
        if (!r) break;
        s = r.state;
        // card draws differ between maps (other decks); keep the trace to the dice, positions and the board state up to the first card
        trace.push(s.players.map((p) => p.pos).join(','));
        if (r.events.some((e) => e.type === 'card')) break;
      }
      return trace;
    };
    expect(run('andhra')).toEqual(run('hyderabad'));
  });

  it('shuffles the Andhra decks: every card drawn belongs to the map, with its title and text', () => {
    let s = createGame({ players: PLAYERS, settings: { map: 'andhra' }, seed: 2 });
    expect(s.deck.luck).toHaveLength(21);
    expect(s.deck.drama).toHaveLength(18);
    expect(new Set(s.deck.luck).size).toBe(21);
    const luckIds = new Set(MAPS.andhra.decks.luck.cards.map((c) => c.id));
    const dramaIds = new Set(MAPS.andhra.decks.drama.cards.map((c) => c.id));
    const rnd = mulberry32(9);
    const drawn = new Set();
    for (let g = 0; g < 40; g++) {
      s = createGame({ players: PLAYERS, settings: { map: 'andhra', snatches: g % 2 }, seed: 100 + g });
      for (let i = 0; i < 600 && s.phase !== 'over'; i++) {
        const r = botStep(s, rnd);
        if (!r) break;
        s = r.state;
        for (const e of r.events) {
          if (e.type !== 'card') continue;
          drawn.add(e.cardId);
          expect((e.deck === 'luck' ? luckIds : dramaIds).has(e.cardId), e.cardId).toBe(true);
          const c = cardOf('andhra', e.cardId);
          expect(e.title).toBe(c.title);
          expect(e.text === c.text || e.text === c.capText).toBe(true);
        }
      }
    }
    expect(drawn.size).toBeGreaterThan(20);
    // without Snatch the Snatch cards are not in the deck, on either map
    const off = createGame({ players: PLAYERS, settings: { map: 'andhra', snatches: 0 }, seed: 1 });
    expect(off.deck.luck).toHaveLength(18);
  });

  it('draws city events in Andhra words (same ids and effects)', () => {
    const rnd = mulberry32(4);
    const titles = new Set();
    for (let g = 0; g < 30; g++) {
      let s = createGame({ players: PLAYERS, settings: { map: 'andhra', eventEvery: 2, maxRounds: 12 }, seed: 300 + g });
      for (let i = 0; i < 800 && s.phase !== 'over'; i++) {
        const r = botStep(s, rnd);
        if (!r) break;
        s = r.state;
        for (const e of r.events) {
          if (e.type !== 'city_event') continue;
          titles.add(e.title);
          expect(`${e.title} ${e.text}`).not.toMatch(/Hyderabad|biryani|Bonalu|Bathukamma|Eid /i);
          expect(MAPS.andhra.events.list.some((d) => d.id === e.id)).toBe(true);
          if (e.id === 'monsoon') expect(e.text).toContain(MAPS.andhra.groups[e.group].name);
          if (e.id === 'rush_hour') expect(e.title).toBe(MAPS.andhra.events.rush[e.group].title);
        }
      }
    }
    expect(titles.size).toBeGreaterThan(5);
  });
});

describe('engine strings come from the map', () => {
  const owned = (map, tiles, who = 'a') => {
    const s = createGame({ players: PLAYERS, settings: { map }, seed: 1 });
    for (const t of tiles) s.owners[t] = who;
    return s;
  };

  it('upgrade refusals name the collection and the level on the map', () => {
    expect(canUpgrade(owned('hyderabad', [28]), 'a', 28).reason).toBe('Own all 3 districts of Cyberabad first (you have 1)');
    expect(canUpgrade(owned('andhra', [28]), 'a', 28).reason).toBe('Own all 3 districts of Spiritual Andhra first (you have 1)');
    const full = owned('andhra', [28, 29, 31]);
    full.levels[28] = 2;
    expect(canUpgrade(full, 'a', 28).reason).toBe('Already a Pilgrim Hospitality Hub');
    const hyd = owned('hyderabad', [28, 29, 31]);
    hyd.levels[28] = 2;
    expect(canUpgrade(hyd, 'a', 28).reason).toBe('Already a Tech Campus');
    // the active client map does not leak into the engine
    applyMap('andhra');
    expect(canUpgrade(owned('hyderabad', [28]), 'a', 28).reason).toBe('Own all 3 districts of Cyberabad first (you have 1)');
  });

  it('trade refusals name the tile on the map', () => {
    for (const [map, name] of [['hyderabad', 'HITEC City'], ['andhra', 'Tirupati']]) {
      const s = owned(map, [31], 'b');
      const r = applyAction(s, { type: 'TRADE_OFFER', playerId: 'a', to: 'b', give: { cash: 0, tiles: [31] }, get: { cash: 0, tiles: [] } });
      expect(r.error, map).toBe(`You do not own ${name}`);
    }
  });

  it('the chai token has the map word', () => {
    for (const [map, use, token] of [['hyderabad', 'chai', 'chai token'], ['andhra', 'a festival token', 'festival token']]) {
      const s = createGame({ players: PLAYERS, settings: { map }, seed: 1 });
      s.players[0].stuck = true;
      expect(applyAction(s, { type: 'USE_CHAI', playerId: 'a' }).error, map).toBe(`You have no ${token}`);
      s.phase = 'manage';
      expect(applyAction(s, { type: 'USE_CHAI', playerId: 'a' }).error, map).toBe(`You can only use ${use} before rolling`);
    }
  });
});

describe('a game stored before maps existed', () => {
  it('has no cfg.map, is the Hyderabad map and plays on', () => {
    let s = createGame({ players: PLAYERS, seed: 21 });
    delete s.cfg.map; // an old state: no such key
    expect(mapOf(s).id).toBe('hyderabad');
    expect(mapIdOf(s.cfg)).toBe('hyderabad');
    const rnd = mulberry32(5);
    for (let i = 0; i < 400 && s.phase !== 'over'; i++) {
      const r = botStep(s, rnd);
      if (!r) break;
      s = r.state;
    }
    expect(s.turnCount).toBeGreaterThan(10);
    expect(getOptions(s, 'a')).toBeTruthy();
    expect(previewRent(s, 1)).toBeGreaterThanOrEqual(0);
    expect(tycoon.isOver(s) || s.phase !== 'over').toBe(true);
    // the worker adapter treats a stored state without cfg.map as current
    expect(tycoon.validateSettings({}).settings).not.toHaveProperty('map');
  });

  it('the default map is the old game: same cards, events and names as before', () => {
    const s = createGame({ players: PLAYERS, seed: 3 });
    expect(s.deck.luck.map((i) => LUCK_CARDS[i].id)).toHaveLength(21);
    expect(deckCards(s, 'drama')).toBe(DRAMA_CARDS);
    expect(cityEventsOf(s)).toBe(CITY_EVENTS);
    expect(tileName(s, 18)).toBe('Chai Adda');
    expect(ruleDefaults('standard')).not.toHaveProperty('map');
  });
});

describe('bot games on the Andhra map (scripts/simulate.js invariants)', () => {
  it('360 bot games on the Andhra map hold every invariant', () => {
    const script = fileURLToPath(new URL('../scripts/simulate.js', import.meta.url));
    const out = execFileSync(process.execPath, [script, '--map', 'andhra', '--games', '40', '--players', '2,4,6', '--modes', 'standard,quick,classic', '--quiet'], { encoding: 'utf8', timeout: 170000 });
    expect(out).toContain('ALL INVARIANTS HELD (andhra)');
    expect(out).not.toMatch(/FAIL/);
    expect(out.match(/^andhra /gm)).toHaveLength(9);
  }, 180000);

  it('extreme host rules on the Andhra map hold the invariants too', () => {
    const script = fileURLToPath(new URL('../scripts/simulate.js', import.meta.url));
    const out = execFileSync(process.execPath, [script, '--map', 'andhra', '--games', '6', '--players', '3', '--modes', 'standard', '--extremes', 'everything-hard,everything-soft,snatch-off,chai-3,fine-0', '--quiet'], { encoding: 'utf8', timeout: 120000 });
    expect(out).toContain('ALL INVARIANTS HELD (andhra)');
  }, 130000);
});
