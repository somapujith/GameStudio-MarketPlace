// The map choice of a Kingpin table, as a pure model: the cards of the picker, the mini ring preview, the
// keyboard movement of the radio group and the "which map is this table on" lookups used by the lobby, the join page,
// the game menu and the store. No React, no DOM (tests run in node). The data lives in shared/maps.js (MAPS, MAP_IDS,
// DEFAULT_MAP, mapOf, isMapId) and the board structure in shared/board.js (the same 36 tiles on every map): this file only
// reads them, so a third map needs no change here.
import { TILES } from '@shared/board.js';
import { DEFAULT_MAP, MAPS, MAP_IDS, isMapId, mapIdOf as sharedMapIdOf, mapOf, pieceNameOf, termsOf } from '@shared/maps.js';

export { DEFAULT_MAP, MAP_IDS };

/** The settings key the host's choice is stored under (room.settings.map, state.cfg.map). It is not a "custom rule". */
export const MAP_KEY = 'map';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v : []);

/** A map id from a map id, a settings object or a game cfg (`{ map }`); anything unknown is the default map. */
export const mapIdOf = sharedMapIdOf;

/** The map definition for an id / settings / cfg (never undefined). */
export const mapDef = mapOf;

/** The id of every selectable map, in display order. */
export const mapIds = () => MAP_IDS.filter((id) => MAPS[id]);

/** What the UI calls a map: its name as it is ("Charminar Chaos", "Andhra Aatalu"). Kept as the one place that reads it. */
export const mapTitle = (name) => str(name);

/** The name, local-language title (Telugu, when the map has one), tagline and blurb of a map: what the UI prints. */
export function mapInfo(v) {
  const m = mapDef(v);
  return { id: m.id, name: mapTitle(m.name) || m.id, te: str(m.te), tagline: str(m.tagline), blurb: str(m.blurb) };
}

/** "Andhra Aatalu" / "Andhra Aatalu · ఆంధ్ర ఆటలు" (the Telugu title only when the map has one). */
export function mapLabel(v, { withTe = false } = {}) {
  const i = mapInfo(v);
  return withTe && i.te ? `${i.name} · ${i.te}` : i.name;
}

/** The map the room / game is on, from room settings, a cfg or an id. Alias with the name the callers read best. */
export const mapOfSettings = mapInfo;

// ---- the mini ring ---------------------------------------------------------------------------------------------

/** Cells per side of a ring of `n` tiles: 4 corners shared, so n = 4 * (side - 1) (36 tiles -> 10, the 10x10 board). */
export const ringSide = (n) => Math.max(2, Math.round(n / 4) + 1);

/**
 * Where tile `i` of an `n`-tile ring sits on the grid: START bottom-left, then up the left column, right along the top,
 * down the right column and left along the bottom (the real board's order). `{ col, row }`, 0-based from the top-left.
 */
export function ringCell(i, n) {
  const s = ringSide(n);
  const side = s - 1;
  const k = ((i % n) + n) % n;
  if (k < side) return { col: 0, row: side - k };
  if (k < 2 * side) return { col: k - side, row: 0 };
  if (k < 3 * side) return { col: side, row: k - 2 * side };
  return { col: side - (k - 3 * side), row: side };
}

const ACCENT = '#e9b44c';
const NEUTRALS = { corner: '#f2c14e', card: '#8b5e83', transport: '#c9d1d8', other: '#6b7a86' };

/** What a tile is for the preview: a group colour, or one of the neutral kinds (corner, card, transport, other). */
function cellKind(tile) {
  if (!tile) return 'other';
  if (tile.corner) return 'corner';
  if (tile.group) return 'group';
  if (tile.type === 'card') return 'card';
  if (tile.type === 'transport') return 'transport';
  return 'other';
}

/** The board structure every map shares: the tiles of shared/board.js (type, group, price, corner). Display names are the map's. */
const structure = (board) => (Array.isArray(board) && board.length ? board : TILES);

/**
 * The cells of a map's mini ring: `[{ i, col, row, kind, color }]`, one per tile, coloured from the map's own collections
 * (`map.groups[tile.group].color`: the group ids are board slots, the colours are the map's). Anything without a group
 * gets a neutral colour. `board` defaults to the real board.
 */
export function ringCells(map, board) {
  const tiles = structure(board);
  const groups = (map && map.groups) || {};
  const n = tiles.length;
  return tiles.map((t, i) => {
    const kind = cellKind(t);
    const g = kind === 'group' ? groups[t.group] : null;
    const { col, row } = ringCell(i, n);
    return { i, col, row, kind, color: (g && str(g.color)) || NEUTRALS[kind === 'group' ? 'other' : kind] };
  });
}

/** The viewBox size of the ring preview: `side` cells of 10 units each. */
export const ringViewSize = (n) => ringSide(n) * 10;

/** The distinct collection colours of a map, in the order the collections first appear on the board (the swatch row). */
export function groupSwatches(map, board) {
  const seen = [];
  const groups = (map && map.groups) || {};
  for (const t of structure(board)) {
    const g = t && t.group ? groups[t.group] : null;
    if (g && g.color && !seen.some((x) => x.id === t.group)) seen.push({ id: t.group, name: str(g.name), color: g.color });
  }
  return seen;
}

/**
 * Three sample places of a map for its card: the map's own `samples` when it lists some, else the cheapest district, one
 * from the middle and the priciest (their short names on that map), so a card shows the range of the board.
 */
export function samplePlaces(map, count = 3, board) {
  const own = list(map && map.samples).map(str).filter(Boolean);
  if (own.length) return own.slice(0, count);
  const skins = (map && map.tiles) || {};
  const props = structure(board)
    .filter((t) => t && t.type === 'property')
    .sort((a, b) => (a.price || 0) - (b.price || 0));
  const k = Math.min(count, props.length);
  if (!k) return [];
  const at = k === 1 ? [0] : Array.from({ length: k }, (_, x) => Math.round((x * (props.length - 1)) / (k - 1)));
  const name = (t) => {
    const sk = skins[t.id] || {};
    return str(sk.short) || str(sk.name) || str(t.short) || str(t.name);
  };
  return [...new Set(at)].map((x) => name(props[x])).filter(Boolean);
}

/** The accent a card is tinted with: the map's palette accent when it has one, else its first collection colour. */
export function mapAccent(map, board) {
  const p = (map && map.palette) || {};
  const first = groupSwatches(map, board)[0];
  return str(p.accent) || str(p.gold) || str(p.primary) || (first && first.color) || ACCENT;
}

/** Everything one picker card prints and draws, for one map id. */
export function mapChoice(id, board) {
  const m = mapOf(id);
  const info = mapInfo(id);
  return {
    id: m.id,
    name: info.name,
    te: info.te,
    tagline: info.tagline,
    blurb: info.blurb,
    places: samplePlaces(m, 3, board),
    cells: ringCells(m, board),
    size: ringViewSize(structure(board).length),
    swatches: groupSwatches(m, board),
    accent: mapAccent(m, board),
  };
}

/** The picker's cards, in order. */
export const mapChoices = () => mapIds().map((id) => mapChoice(id));

/** The words of a map for the lobby copy (chai token, corners ...): see `terms` in shared/maps.js. */
export const mapTerms = (v) => termsOf(v);

// ---- selection ---------------------------------------------------------------------------------------------------

/** The settings patch for picking `id` while the table is on `current`: `null` when nothing would change or `id` is not a map. */
export function mapPatch(current, id) {
  if (typeof id !== 'string' || !isMapId(id) || !MAPS[id]) return null;
  return id === mapIdOf(current) ? null : { [MAP_KEY]: id };
}

/** The radio group's arrow keys: ids in order, wrapping; Home / End jump. Returns the id to move to, or null for a key it ignores. */
export function nextMapId(current, key, ids = mapIds()) {
  if (!ids.length) return null;
  const at = Math.max(0, ids.indexOf(mapIdOf(current)));
  if (key === 'ArrowRight' || key === 'ArrowDown') return ids[(at + 1) % ids.length];
  if (key === 'ArrowLeft' || key === 'ArrowUp') return ids[(at - 1 + ids.length) % ids.length];
  if (key === 'Home') return ids[0];
  if (key === 'End') return ids[ids.length - 1];
  return null;
}

/** The schema field the lobby draws as the map picker (a settings field with `widget: 'map'`), or null. */
export function mapFieldOf(schema) {
  return list(schema).find((f) => f && f.key === MAP_KEY && f.widget === 'map') || null;
}

// ---- text for the places that print one line --------------------------------------------------------------------

/** "Map: Andhra Aatalu" (the scoreboard chip, a screen-reader line). */
export const mapLine = (v) => `Map: ${mapInfo(v).name}`;

/** `summary` ("Standard City Hustle · 20 rounds ...") with the map in front as its own " · " part. */
export const withMapLine = (summary, v) => `${mapLine(v)}${summary ? ` · ${summary}` : ''}`;

// ---- the map's words in the lobby's copy -----------------------------------------------------------------------------

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Re-word one line of lobby copy in the words of a map ("Chai tokens a player can hold" -> "Festival tokens a player can
 * hold"; "Chai Adda" -> "Sankranti Fair"). Only the words the map defines in `terms` are swapped, so the default map's
 * copy comes back unchanged. The case of the first letter is kept.
 */
export function skinText(text, v) {
  if (typeof text !== 'string' || !text) return text;
  const hyd = termsOf(DEFAULT_MAP);
  const t = termsOf(v);
  if (t === hyd) return text;
  const pairs = [
    [hyd.chaiTokens, t.chaiTokens],
    [hyd.chaiToken, t.chaiToken],
    [hyd.chaiCorner, t.chaiCorner],
    [hyd.trafficCorner, t.trafficCorner],
    [hyd.municipalCorner, t.municipalCorner],
    [hyd.auctionTile, t.auctionTile],
  ].filter(([from, to]) => from && to && from !== to);
  let out = text;
  for (const [from, to] of pairs) {
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc, 'gi'), (m) => (m.charAt(0) === m.charAt(0).toUpperCase() ? cap(to) : to));
  }
  return out;
}

/**
 * The game's lobby manifest with its field labels / helps / option hints re-worded for the map of the room: a new object
 * only when something changes (the default map returns `game` itself). `tableRulesFor(mapId)` replaces `tableRules`.
 */
export function skinGame(game, v) {
  if (!game || !Array.isArray(game.settings)) return game;
  const id = mapIdOf(v);
  const skinField = (f) => {
    const label = skinText(f.label, id);
    const help = skinText(f.help, id);
    const hints = Array.isArray(f.options) ? f.options.map((o) => (o && typeof o.hint === 'string' ? skinText(o.hint, id) : null)) : [];
    const hintChanged = hints.some((h, k) => h !== null && h !== f.options[k].hint);
    if (label === f.label && help === f.help && !hintChanged) return f;
    return { ...f, label, help, ...(hintChanged ? { options: f.options.map((o, k) => (hints[k] === null ? o : { ...o, hint: hints[k] })) } : {}) };
  };
  const settings = game.settings.map(skinField);
  const tableRules = typeof game.tableRulesFor === 'function' ? game.tableRulesFor(id) : game.tableRules;
  if (settings.every((f, k) => f === game.settings[k]) && tableRules === game.tableRules) return game;
  return { ...game, settings, tableRules };
}

// ---- the map's piece names ---------------------------------------------------------------------------------------------

/**
 * A manifest's `pieces` ([{ id, name }]) with the names of the map `v` (a map id, room settings or a cfg): the same six
 * piece ids, other names ("Pearl" -> "Mango"). The default map returns `pieces` itself, so nothing changes there.
 */
export function skinPieces(pieces, v) {
  if (!Array.isArray(pieces)) return pieces;
  const id = mapIdOf(v);
  if (id === DEFAULT_MAP) return pieces;
  return pieces.map((p) => {
    const pid = p && typeof p.id === 'string' ? p.id : typeof p === 'string' ? p : null;
    const name = pid ? pieceNameOf(id, pid) : '';
    return pid && name ? { ...(typeof p === 'object' ? p : {}), id: pid, name } : p;
  });
}
