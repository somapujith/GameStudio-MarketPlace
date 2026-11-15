// MAPS: the skins of the one Hustle board (docs/GAME_RULES.md "Maps", docs/CONTRACT.md "cfg.map").
//
// A map changes names, lore, colours, level names, token words, card decks and city-event wording. It NEVER changes the
// board structure or the rules: 36 tiles, the same ids, types, positions, prices (the per-slot price ladder), rents, fares,
// group membership ('bazaar' = slots [1,3,4], ...) and the same engine. Group ids are slots, so on the Andhra map
// `GROUPS.oldcity` is "Andhra Crafts" (see shared/maps/andhra.js).
//
//   MAP_IDS, DEFAULT_MAP, MAPS            the registry ('hyderabad' | 'andhra'); MAPS.hyderabad is generated from board.js,
//                                          cards.js and events.js, so the default behaviour is exactly the old behaviour
//   mapOf(x) / mapIdOf(x)                 x = a map id, a cfg, a settings object or a game state: unknown or missing -> the
//                                          default map (a game or room stored before maps existed has no `cfg.map`)
//   isMapId(v), sanitizeMap(v)            validation of an untrusted value
//   applyMap(x)                           CLIENT ONLY: rewrites the DISPLAY fields of the shared TILES / GROUPS objects in
//                                          place so every module that imports them shows the active map. The Worker and the
//                                          engine never call it (one Durable Object serves many rooms with different maps).
//   tileName(x, id) ... deckCards(x, id)  per-map readers for the engine and the Worker (they take the map, cfg or state)
//
// `cfg.map` is only stored for a non-default map: `cfg.map` is 'andhra' on an Andhra game and ABSENT (= 'hyderabad') on a
// default one, so every settings object, room and saved game of the default map stays byte-identical. Always read it through
// `mapOf(...)` / `mapIdOf(...)`, never as `cfg.map` directly. The map is a lobby setting, but NOT a host "rule": it is not in
// RULE_FIELDS and `customRuleCount` does not count it.

import { TILES, GROUPS, MAX_LEVEL, LEVEL_NAMES } from './board.js';
import { LUCK_CARDS, DRAMA_CARDS, DECK_NAMES } from './cards.js';
import { CITY_EVENTS, RUSH_FLAVOUR, MONSOON_TEXT, FESTIVALS, EVENT_EVERY } from './events.js';
import { PIECES } from './pieces.js';
import {
  ANDHRA_INFO, ANDHRA_GROUPS, ANDHRA_TILES, ANDHRA_TERMS, ANDHRA_LUCK_CARDS, ANDHRA_DRAMA_CARDS, ANDHRA_EVENTS,
} from './maps/andhra.js';

export const MAP_IDS = Object.freeze(['hyderabad', 'andhra']);
export const DEFAULT_MAP = 'hyderabad';

// ---- Hyderabad: a snapshot of the board data as it is when this module loads (before any applyMap) ----
const HYD_TILES = {};
for (const t of TILES) {
  HYD_TILES[t.id] = { name: t.name, short: t.short, lore: t.lore, emoji: t.emoji, art: t.art };
}
// One line per collection on the deed sheet and the set celebration (the same words as the Charminar Chaos (ex Hyderabad Hustle) concept, section 3).
const HYD_IDENTITY = {
  bazaar: 'Affordable first investments: quick buys and early rent.',
  oldcity: 'Heritage, tourism, shopping and the best food in town.',
  everyday: 'Neighbourhood commerce, restaurants, practical mid-tier assets.',
  twin: 'Transit links and busy junction trade.',
  lake: 'Tourism, recreation and seasonal visitors.',
  luxury: 'Prestige addresses, cinema glamour, expensive upgrades.',
  cyber: 'Tech and office growth with volatile booms.',
  newcity: 'Highest entry cost, highest rents, premium potential.',
};
const HYD_GROUPS = {};
for (const [id, g] of Object.entries(GROUPS)) {
  HYD_GROUPS[id] = { name: g.name, color: g.color, ink: g.ink, levelNames: [...g.levelNames], theme: g.theme, identity: HYD_IDENTITY[id] };
}

const HYDERABAD = {
  id: 'hyderabad',
  name: 'Charminar Chaos',
  tagline: 'Where the chaos makes the fortune.',
  blurb: 'Pearls, biryani, film studios and tech campuses: buy fictional ventures across the old city, the lakefront and Cyberabad, and outplay the table.',
  palette: { primary: '#1c2340', secondary: '#e2725b', accent: '#f2b134', green: '#3fb68b', blue: '#3aa7e0', paper: '#fff3dc' },
  groups: HYD_GROUPS,
  tiles: HYD_TILES,
  terms: {
    chai: 'chai', chaiUse: 'chai', chaiToken: 'chai token', chaiTokens: 'chai tokens',
    chaiCorner: 'Chai Adda', trafficCorner: 'Traffic Jam', municipalCorner: 'Municipal Charges', auctionTile: 'Bazaar Auction',
    startCorner: 'Namma Hyderabad', transportStops: 'Auto, Metro or MMTS stop', place: 'Hyderabad',
  },
  decks: {
    luck: { id: 'luck', name: DECK_NAMES.luck, blurb: 'Mostly good fortune: windfalls, free chai, a lucky ride.', cards: LUCK_CARDS },
    drama: { id: 'drama', name: DECK_NAMES.drama, blurb: 'Bills, traffic and surprises. Hyderabad keeps getting in the way.', cards: DRAMA_CARDS },
  },
  events: { every: EVENT_EVERY, list: CITY_EVENTS, rush: RUSH_FLAVOUR, monsoon: MONSOON_TEXT('{group}'), festivals: FESTIVALS },
  pieceNames: Object.fromEntries(PIECES.map((p) => [p.id, p.name])),
};
HYDERABAD.tokenNames = PIECES.map((p) => p.name);

// ---- Andhra Aatalu ----
const ANDHRA = {
  id: ANDHRA_INFO.id,
  name: ANDHRA_INFO.name,
  te: ANDHRA_INFO.te,
  tagline: ANDHRA_INFO.tagline,
  blurb: ANDHRA_INFO.blurb,
  palette: ANDHRA_INFO.palette,
  groups: ANDHRA_GROUPS,
  tiles: ANDHRA_TILES,
  terms: ANDHRA_TERMS,
  decks: {
    luck: { id: 'luck', name: 'Mana Adrushtam', te: 'మన అదృష్టం', blurb: 'Mostly good fortune: windfalls, free festival tokens, a lucky trip.', cards: ANDHRA_LUCK_CARDS },
    drama: { id: 'drama', name: 'Oori Kaburlu', te: 'ఊరి కబుర్లు', blurb: 'Bills, traffic and surprises. The village gossip always has a twist.', cards: ANDHRA_DRAMA_CARDS },
  },
  events: { every: EVENT_EVERY, ...ANDHRA_EVENTS },
  pieceNames: ANDHRA_INFO.pieceNames,
  tokenNames: PIECES.map((p) => ANDHRA_INFO.pieceNames[p.id]),
};

export const MAPS = Object.freeze({ hyderabad: Object.freeze(HYDERABAD), andhra: Object.freeze(ANDHRA) });

/** The maps as an ordered list (default first), for a picker. */
export const MAP_LIST = Object.freeze(MAP_IDS.map((id) => MAPS[id]));

// ---------------------------------------------------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------------------------------------------------

export const isMapId = (v) => typeof v === 'string' && MAP_IDS.includes(v);

/** A legal map id for an untrusted value: anything unknown is the default map. */
export const sanitizeMap = (v) => (isMapId(v) ? v : DEFAULT_MAP);

/** The map id of a map id, a cfg / settings object (`.map`) or a game state (`.cfg.map`); the default map when there is none. */
export function mapIdOf(x) {
  if (typeof x === 'string') return sanitizeMap(x);
  if (x && typeof x === 'object' && !Array.isArray(x)) return sanitizeMap(typeof x.map === 'string' ? x.map : x.cfg && x.cfg.map);
  return DEFAULT_MAP;
}

/** The map of an id / cfg / settings / state (falls back to the default map). */
export const mapOf = (x) => MAPS[mapIdOf(x)];

/** The 'andhra' | 'hyderabad' id a state or cfg plays on. Alias of mapIdOf. */
export const mapIdOfState = mapIdOf;

// ---------------------------------------------------------------------------------------------------------------------
// Per-map readers (pure; for the engine, the Worker and anything that must not depend on the active client map)
// ---------------------------------------------------------------------------------------------------------------------

export const tileSkin = (x, tileId) => mapOf(x).tiles[tileId] || null;
export const tileName = (x, tileId) => (tileSkin(x, tileId) || {}).name || '';
export const tileShort = (x, tileId) => (tileSkin(x, tileId) || {}).short || tileName(x, tileId);
export const tileLore = (x, tileId) => (tileSkin(x, tileId) || {}).lore || '';

export const groupSkin = (x, groupId) => mapOf(x).groups[groupId] || null;
export const groupName = (x, groupId) => (groupSkin(x, groupId) || {}).name || '';

/** The themed business name of a district at `level` on the map ("Startup Office" / "Co-working Desk"); `tile` is a tile or a tile id. */
export function levelNameOf(x, tile, level = 0) {
  const t = typeof tile === 'number' ? TILES[tile] : tile;
  const g = t && groupSkin(x, t.group);
  const lv = Math.max(0, Math.min(MAX_LEVEL, level | 0));
  return (g && g.levelNames[lv]) || LEVEL_NAMES[lv];
}

/** Display name of a deck ('luck' | 'drama') on the map: "Nawabi Luck" / "Mana Adrushtam". */
export const deckName = (x, deckId) => (mapOf(x).decks[deckId] || {}).name || '';
/** The deck record ({ id, name, blurb, cards }) of 'luck' | 'drama' on the map, or null. */
export const deckInfoOf = (x, deckId) => mapOf(x).decks[deckId] || null;
/** The cards of a deck on the map. */
export const deckCards = (x, deckId) => (mapOf(x).decks[deckId] || { cards: [] }).cards;

/** A card by id on the map (any map when the id is not on it: card ids are unique across maps), or null. */
export function cardOf(x, cardId) {
  const find = (m) => deckCards(m, 'luck').find((c) => c.id === cardId) || deckCards(m, 'drama').find((c) => c.id === cardId) || null;
  return find(x) || MAP_IDS.map((id) => find(id)).find(Boolean) || null;
}

/** The map's city-event definitions (same ids and mechanics on every map, other wording). */
export const cityEventsOf = (x) => mapOf(x).events.list;
/** The map's wording of a city-event definition id, or null. */
export const cityEventOf = (x, eventId) => cityEventsOf(x).find((e) => e.id === eventId) || null;
/** The per-collection "rush" wording of the map: { [groupId]: { title, text } }. */
export const rushFlavourOf = (x) => mapOf(x).events.rush;
/** The monsoon-slump line for a collection name on the map. */
export const monsoonTextOf = (x, collectionName) => mapOf(x).events.monsoon.replace('{group}', collectionName);
/** The festive-bonus wordings of the map. */
export const festivalsOf = (x) => mapOf(x).events.festivals;

/** The map's words for the chai token, the corners ... (see `terms` of each map). */
export const termsOf = (x) => mapOf(x).terms;

/** The piece (token) name of a piece id on the map, or ''. */
export const pieceNameOf = (x, pieceId) => (mapOf(x).pieceNames || {})[pieceId] || '';

// ---------------------------------------------------------------------------------------------------------------------
// applyMap: CLIENT ONLY. Rewrite the display fields of the shared TILES / GROUPS in place.
// ---------------------------------------------------------------------------------------------------------------------

let activeMap = DEFAULT_MAP;
let version = 0;
const listeners = new Set();

function writeTile(tile, skin) {
  if (!tile || !skin) return;
  for (const k of ['name', 'short', 'lore', 'emoji', 'art']) if (skin[k] !== undefined) tile[k] = skin[k];
  if (skin.te !== undefined) tile.te = skin.te;
  else delete tile.te;
  if (skin.lines !== undefined) tile.lines = [...skin.lines];
  else delete tile.lines;
}

// `identity` (the one-line blurb of a collection) is only written for a non-default map: the shared GROUPS of the default map
// stay exactly the board.js objects (the deed sheet falls back to its own copy of the Hyderabad lines, which equal HYD_IDENTITY).
function writeGroup(group, skin, withIdentity = false) {
  if (!group || !skin) return;
  for (const k of ['name', 'color', 'ink', 'theme']) if (skin[k] !== undefined) group[k] = skin[k];
  if (withIdentity && skin.identity !== undefined) group.identity = skin.identity;
  else delete group.identity;
  if (skin.te !== undefined) group.te = skin.te;
  else delete group.te;
  if (Array.isArray(skin.levelNames)) {
    group.levelNames.length = 0; // same array object: whoever holds it sees the new names
    group.levelNames.push(...skin.levelNames);
  }
}

/**
 * Make `x` (a map id, cfg, settings or state) the active map of this JavaScript realm: the display fields of TILES and GROUPS
 * (tile name / short / lore / te / emoji / art / lines, group name / te / colour / ink / theme / levelNames) are rewritten in place.
 * Structural fields (id, type, price, group, tiles, corner, fare, deck) are never touched. Idempotent: applying the active
 * map again changes nothing and keeps the version. Returns `{ id, mapId, version, mapVersion }`: the active map id and a
 * counter that grows by one every time the active map actually changes (use it as a React key / memo dependency).
 * NOT for the Worker or the engine.
 */
export function applyMap(x) {
  const id = mapIdOf(x);
  const map = MAPS[id];
  for (const t of TILES) writeTile(t, map.tiles[t.id]);
  for (const [gid, g] of Object.entries(GROUPS)) writeGroup(g, map.groups[gid], id !== DEFAULT_MAP);
  if (id !== activeMap) {
    activeMap = id;
    version += 1;
    for (const fn of [...listeners]) {
      try { fn(activeMap, version); } catch { /* a bad listener never breaks the game */ }
    }
  }
  return { id: activeMap, mapId: activeMap, version, mapVersion: version };
}

/** The map applied to TILES / GROUPS right now ('hyderabad' until applyMap is called). */
export const activeMapId = () => activeMap;
/** How many times the active map has changed (0 = never). */
export const getMapVersion = () => version;
/** Subscribe to active-map changes (useSyncExternalStore friendly: `subscribeMap(cb)` returns the unsubscribe function). */
export function subscribeMap(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
