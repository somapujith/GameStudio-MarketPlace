// Shared hooks + pure helpers for the game sheets and panels (G-SHEETS owns this file).
//
// Rules compatibility layer: every board / engine value is read through the `Board` / `Engine` namespaces and probed,
// never assumed, so the UI keeps rendering while shared/** moves to the Hyderabad Hustle rules (docs/HUSTLE_PLAN.md
// section 3). New names first (`rentTable`, `levelName`, `GROUPS[id].tiles|levelNames|theme`, `PIECES`, `MODES`),
// then the old board's equivalents, then the plan's numbers.
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import * as Board from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import * as Engine from '@shared/index.js'; // namespace import: engine additions are probed, never assumed
import { useSettings } from '@/lib/storage.js';

const TILES = Board.TILES || [];
const GROUPS = Board.GROUPS || {};

/* ------------------------------------------------------------------ media / motion */

export function useMedia(query, fallback = false) {
  const subscribe = useCallback(
    (cb) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const m = window.matchMedia(query);
      m.addEventListener?.('change', cb);
      return () => m.removeEventListener?.('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}

/**
 * A motion token from tokens.css (`--dur-1..4` -> ms, `--ease-*` -> the easing string) for timers and WAAPI.
 * Falls back when there is no DOM (tests, SSR) or the token is missing.
 */
export function motionToken(name, fallback) {
  try {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/** `--dur-*` in ms (e.g. motionMs('--dur-3', 360)). */
export function motionMs(name, fallback) {
  const v = motionToken(name, '');
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return /ms\s*$/.test(v) ? n : /s\s*$/.test(v) ? n * 1000 : n;
}

/** True at >= 900px: board left, sidebar right. */
export const useIsWide = () => useMedia('(min-width: 900px)');

/** OS preference OR the in-game "reduce motion" switch OR `:root[data-motion='reduced']`. */
export function useReducedMotion() {
  const sys = useMedia('(prefers-reduced-motion: reduce)');
  const [settings] = useSettings();
  const root = typeof document !== 'undefined' && document.documentElement?.dataset?.motion === 'reduced';
  return !!(sys || settings?.reducedMotion || root);
}

/** Keeps showing the last non-null value (so a sheet can finish its exit animation). */
export function useHeld(value) {
  const [held, setHeld] = useState(value);
  if (value != null && value !== held) setHeld(value);
  return value != null ? value : held;
}

/* ------------------------------------------------------------------ rules numbers (probed) */

const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);
const round1000 = (v) => Math.round(v / 1000) * 1000;

/** True once shared/board.js carries the Hustle board (36 squares with a Chai Adda). */
export const HUSTLE = TILES.length === 36 || TILES.some((t) => t.type === 'chai');

/** Highest business level (Hustle: 2 = three businesses per district). */
export const MAX_LEVEL = Number.isInteger(Board.MAX_LEVEL) ? Board.MAX_LEVEL : 2;

/** The full-set bonus on level-0 tiles (Hustle 1.5x). */
export const SET_BONUS_MULT = (() => {
  const b = Board.SET_BONUS;
  if (Number.isFinite(b)) return b;
  if (b && Number.isFinite(b.full)) return b.full;
  return HUSTLE ? 1.5 : 2;
})();

export const PASS_START_AMOUNT = num(Board.PASS_START, 200000);
export const START_CASH_AMOUNT = num(Board.START_CASH, 1500000);
export const TRAFFIC_FINE = num(Board.TRAFFIC_FINE, 25000);
export const CHAI_CAP = num(Board.CHAI_CAP, 1);
export const CHAI_MIN_RENT = num(Board.CHAI_MIN_RENT, 20000);
export const MUNICIPAL_BASE = num(Board.MUNICIPAL_BASE, 40000);
export const MUNICIPAL_PER_LEVEL = num(Board.MUNICIPAL_PER_LEVEL, 10000);
export const EVENT_EVERY = num(Engine.EVENT_EVERY, 3);
const FARE_FALLBACK = { 5: 25000, 14: 35000, 23: 45000 };

/** Hustle: only districts are bought. The old board also sold stations and utilities. */
export function isBuyableTile(tile) {
  if (!tile) return false;
  if (typeof Board.isBuyable === 'function') {
    try { return !!Board.isBuyable(tile); } catch { /* fall through */ }
  }
  return tile.type === 'property';
}

export function groupTiles(gid) {
  const g = GROUPS[gid];
  if (Array.isArray(g?.tiles)) return g.tiles;
  if (Board.GROUP_TILES?.[gid]) return Board.GROUP_TILES[gid];
  return TILES.filter((t) => t.group === gid).map((t) => t.id);
}

/** Readable ink on a colour: dark navy on light colours, white on dark ones. */
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#1b1d33' : '#ffffff';
}

// Collection identities (Hyderabad_Hustle_Game_Concept.md section 3) + the plan's level names / themes, used when
// the engine does not carry them yet.
const COLLECTION_INFO = {
  bazaar: { identity: 'Affordable first investments: quick buys and early rent.', theme: 'bazaar', levelNames: ['Stall', 'Shop', 'Trading Hub'] },
  oldcity: { identity: 'Heritage, tourism, shopping and the best food in town.', theme: 'food', levelNames: ['Irani Cafe', 'Biryani House', 'Food Franchise'] },
  everyday: { identity: 'Neighbourhood commerce, restaurants, practical mid-tier assets.', theme: 'food', levelNames: ['Tiffin Centre', 'Restaurant', 'Food Court'] },
  twin: { identity: 'Transit links and busy junction trade.', theme: 'transit', levelNames: ['Kiosk', 'Showroom', 'Transit Mall'] },
  lake: { identity: 'Tourism, recreation and seasonal visitors.', theme: 'venue', levelNames: ['Snack Kiosk', 'Boathouse Cafe', 'Lakeside Resort'] },
  luxury: { identity: 'Prestige addresses, cinema glamour, expensive upgrades.', theme: 'venue', levelNames: ['Studio', 'Entertainment Venue', 'Premium Complex'] },
  cyber: { identity: 'Tech and office growth with volatile booms.', theme: 'tech', levelNames: ['Startup Office', 'Business Centre', 'Tech Campus'] },
  newcity: { identity: 'Highest entry cost, highest rents, premium potential.', theme: 'tech', levelNames: ['Co-working Floor', 'Corporate Tower', 'Skyline Campus'] },
};

/** The colour collections in board order: { id, kind:'property', name, color, ink, tiles, levelNames, theme, identity }. */
export const COLLECTIONS = Object.keys(GROUPS)
  .map((id) => {
    const g = GROUPS[id] || {};
    const info = COLLECTION_INFO[id] || {};
    return {
      id,
      kind: 'property',
      name: g.name || id,
      color: g.color || '#7b6dff',
      ink: g.ink || inkOn(g.color),
      tiles: groupTiles(id),
      levelNames: Array.isArray(g.levelNames) ? g.levelNames : info.levelNames || null,
      theme: g.theme || info.theme || 'bazaar',
      identity: g.identity || info.identity || '',
    };
  })
  .sort((a, b) => Math.min(...a.tiles) - Math.min(...b.tiles));

export const collectionOf = (tileOrGroup) => {
  const gid = typeof tileOrGroup === 'string' ? tileOrGroup : tileOrGroup?.group;
  return COLLECTIONS.find((c) => c.id === gid) || null;
};

/** Themed business name of `level` on a tile ("Startup Office" ...). */
export function levelNameOf(tile, level = 0) {
  if (!tile) return '';
  if (typeof Board.levelName === 'function') {
    try {
      const n = Board.levelName(tile, level);
      if (n) return n;
    } catch { /* fall through */ }
  }
  const c = collectionOf(tile);
  if (c?.levelNames?.[level]) return c.levelNames[level];
  if (Array.isArray(Board.LEVEL_NAMES) && Board.LEVEL_NAMES[level]) return Board.LEVEL_NAMES[level];
  return `Level ${level + 1}`;
}

/** Rent for every level [L0 .. MAX_LEVEL] (no set bonus, no events). */
export function rentLadder(tile) {
  if (!tile) return [];
  if (typeof Board.rentTable === 'function') {
    try {
      const r = Board.rentTable(tile);
      if (Array.isArray(r) && r.length) return r.slice(0, MAX_LEVEL + 1);
    } catch { /* fall through */ }
  }
  if (Array.isArray(tile.rent)) return tile.rent.slice(0, MAX_LEVEL + 1);
  const base = Math.round((tile.price || 0) * 0.1);
  return [base, round1000(base * 1.9), round1000(base * 3.5)].slice(0, MAX_LEVEL + 1);
}

export function upgradeCostOf(tile) {
  if (!tile) return 0;
  try {
    const c = Board.upgradeCost?.(tile);
    if (Number.isFinite(c)) return c;
  } catch { /* fall through */ }
  return Math.round((tile.price || 0) * 0.5);
}

export function mortgageOf(tile) {
  if (!tile) return 0;
  try {
    const v = Board.mortgageValue?.(tile);
    if (Number.isFinite(v) && v > 0) return v;
  } catch { /* fall through */ }
  return Math.round((tile.price || 0) * 0.5);
}

export function unmortgageOf(tile) {
  if (!tile) return 0;
  try {
    const v = Board.unmortgageCost?.(tile);
    if (Number.isFinite(v) && v > 0) return v;
  } catch { /* fall through */ }
  return Math.round(mortgageOf(tile) * 1.1);
}

/** Fare of a transport stop. */
export const fareOf = (tile) => num(tile?.fare, FARE_FALLBACK[tile?.id] ?? 25000);

/** The next transport stop after `tile` going forward round the board. */
export function nextStop(tile) {
  if (!tile) return null;
  const n = TILES.length;
  for (let k = 1; k < n; k++) {
    const t = TILES[(tile.id + k) % n];
    if (t.type === 'transport') return t;
  }
  return null;
}

/* ------------------------------------------------------------------ pieces + modes */

const PIECES_FALLBACK = [
  { id: 'pearl', name: 'Pearl' }, { id: 'auto', name: 'Auto-rickshaw' }, { id: 'handi', name: 'Biryani handi' },
  { id: 'chai', name: 'Irani chai glass' }, { id: 'bat', name: 'Cricket bat' }, { id: 'camera', name: 'Film camera' },
];
export const PIECES = Array.isArray(Board.PIECES) && Board.PIECES.length ? Board.PIECES : PIECES_FALLBACK;
export const pieceName = (id) => PIECES.find((p) => p.id === id)?.name || '';

const MODES_FALLBACK = {
  standard: { id: 'standard', label: 'Standard City Hustle', rounds: 20, startCash: 1500000 },
  quick: { id: 'quick', label: 'Quick Chai Break', rounds: 12, startCash: 2000000 },
  classic: { id: 'classic', label: 'Classic Long Game', rounds: null, startCash: 1500000 },
};
/** { standard|quick|classic: { id, label, rounds|null, startCash } } whatever shape the engine exports. */
export const MODES = (() => {
  const src = Engine.MODES;
  const out = { ...MODES_FALLBACK };
  const add = (id, m) => {
    if (!id || !m) return;
    out[id] = {
      ...(out[id] || { id }),
      id,
      label: m.label || m.name || out[id]?.label || id,
      rounds: m.rounds !== undefined ? m.rounds : m.maxRounds !== undefined ? m.maxRounds : out[id]?.rounds ?? null,
      startCash: m.startCash ?? out[id]?.startCash ?? START_CASH_AMOUNT,
    };
  };
  if (Array.isArray(src)) src.forEach((m) => add(m?.id, m));
  else if (src && typeof src === 'object') Object.entries(src).forEach(([id, m]) => add(m?.id || id, m));
  return out;
})();
export const modeOf = (cfg) => MODES[cfg?.mode] || null;

/* ------------------------------------------------------------------ decks + city events */

export const DECKS = {
  luck: { id: 'luck', name: 'Nawabi Luck', color: '#2fbf71', blurb: 'Mostly good fortune: windfalls, free chai, a lucky ride.' },
  drama: { id: 'drama', name: 'City Drama', color: '#d6336c', blurb: 'Bills, traffic and surprises. Hyderabad keeps getting in the way.' },
};
export const deckOf = (tile) => DECKS[tile?.deck] || null;

/** Old-board deck names (kept for callers that still read them). */
const deckInfo = (deck, fallback) => {
  const t = TILES.find((x) => x.type === 'kismet' && x.deck === deck);
  return t ? { name: t.name, short: t.short } : fallback;
};
export const KISMET_DECKS = {
  chance: deckInfo('chance', { name: 'Nawabi Luck', short: 'Luck' }),
  chest: deckInfo('chest', { name: 'City Drama', short: 'Drama' }),
};

const EVENT_DEFAULT_MULT = { rush_hour: 1.5, monsoon: 0.5, biryani_boom: 2 };

/**
 * The city event's rent modifier on one tile right now, or null.
 * -> { mult, title, text, upgradedOnly }   (biryani_boom only lifts upgraded tiles)
 */
export function eventModifier(state, tile) {
  const ev = state?.event;
  if (!ev || !tile?.group) return null;
  if (ev.round != null && state.round != null && ev.round !== state.round) return null;
  const groups = Array.isArray(ev.groups) ? ev.groups : ev.group ? [ev.group] : [];
  if (!groups.includes(tile.group)) return null;
  const id = ev.id || ev.type;
  if (ev.kind && ev.kind !== 'rent') return null; // wedding season / festival move cash, not rent
  const mult = num(ev.mult, EVENT_DEFAULT_MULT[id] ?? 1);
  if (mult === 1) return null;
  return { mult, title: ev.title || 'City event', text: ev.text || '', upgradedOnly: !!ev.upgradedOnly || id === 'biryani_boom' };
}

/* ------------------------------------------------------------------ tile / group metadata */

const transportIds = TILES.filter((t) => t.type === 'transport').map((t) => t.id);
const utilityIds = TILES.filter((t) => t.type === 'utility').map((t) => t.id);
const firstOf = (type) => TILES.find((t) => t.type === type);

/** Every "set" a player can own tiles in: the colour collections (+ stations / utilities on the old board). */
export const SET_GROUPS = [
  ...COLLECTIONS,
  ...(transportIds.length && isBuyableTile(firstOf('transport'))
    ? [{ id: 'transport', kind: 'transport', name: 'Stations', color: '#14b8a6', ink: '#04201d', tiles: transportIds }] : []),
  ...(utilityIds.length && isBuyableTile(firstOf('utility'))
    ? [{ id: 'utility', kind: 'utility', name: 'Utilities', color: '#eab308', ink: '#251c00', tiles: utilityIds }] : []),
];

export const setOfTile = (tile) =>
  (tile ? SET_GROUPS.find((g) => (tile.group ? g.id === tile.group : g.id === tile.type)) || null : null);

// Accent for the squares that are not in a collection.
const SQUARE_COLORS = {
  start: '#6a5cff', transport: '#f2c230', traffic: '#e5484d', chai: '#b9773d', municipal: '#64748b', auction: '#ff8a3d',
  'card:luck': DECKS.luck.color, 'card:drama': DECKS.drama.color,
  // old board
  jail: '#4b5563', parking: '#0e7490', gotojail: '#b91c1c', tax: '#b45309', kismet: '#be185d', 'kismet:chest': '#0f766e', utility: '#eab308',
};

/** Header colour + readable ink for a tile. */
export function tileAccent(tile) {
  const set = setOfTile(tile);
  if (set) return { color: set.color, ink: set.ink };
  const key = tile?.deck ? `${tile.type}:${tile.deck}` : tile?.type;
  const color = SQUARE_COLORS[key] || SQUARE_COLORS[tile?.type] || '#3b2d8f';
  return { color, ink: inkOn(color) };
}

/** Short kind label for a tile: its collection, "Transport", the card deck, "Traffic Jam", ... */
export function tileTypeLabel(tile) {
  if (!tile) return '';
  if (tile.group && GROUPS[tile.group]) return GROUPS[tile.group].name;
  switch (tile.type) {
    case 'start': return 'Start';
    case 'transport': return 'Transport';
    case 'card': return deckOf(tile)?.name || 'Card';
    case 'traffic': return 'Traffic Jam';
    case 'chai': return 'Chai Adda';
    case 'municipal': return 'Municipal';
    case 'auction': return 'Bazaar Auction';
    // old board
    case 'utility': return 'Utility';
    case 'kismet': return (KISMET_DECKS[tile.deck] || KISMET_DECKS.chance).name;
    case 'tax': return 'Tax';
    case 'jail': return 'Jail';
    case 'parking': return 'Rest stop';
    case 'gotojail': return 'Go to Jail';
    default: return 'Square';
  }
}

/** Per-set progress for a player: [{ set, owned:[ids], total, full, missing:[ids] }] (sets with >= 1 owned tile only). */
export function setProgress(owners, playerId) {
  const rows = [];
  for (const set of SET_GROUPS) {
    const owned = set.tiles.filter((t) => owners?.[t] === playerId);
    if (!owned.length) continue;
    rows.push({
      set, owned, total: set.tiles.length, full: owned.length === set.tiles.length,
      missing: set.tiles.filter((t) => owners?.[t] !== playerId),
    });
  }
  return rows;
}

/** Collections `playerId` would own completely after receiving `receive` and handing over `hand` (tile ids). */
export function completedGroups(owners, playerId, receive = [], hand = []) {
  const out = [];
  const groups = new Set(receive.map((t) => TILES[t]?.group).filter(Boolean));
  for (const g of groups) {
    const full = groupTiles(g).every((t) => (receive.includes(t) ? true : hand.includes(t) ? false : owners?.[t] === playerId));
    if (full) out.push(g);
  }
  return out;
}

/* ------------------------------------------------------------------ session helpers */

/** An engine-state-like object that reflects what the board shows (display lags view while animating). */
export function useStateLike(session) {
  const { view, display } = session;
  return useMemo(
    () => ({
      ...view,
      players: display?.players ?? view?.players ?? [],
      owners: display?.owners ?? view?.owners ?? [],
      levels: display?.levels ?? view?.levels ?? [],
      mortgaged: display?.mortgaged ?? view?.mortgaged ?? [],
      event: display?.event !== undefined ? display.event : view?.event,
      round: display?.round ?? view?.round,
    }),
    [view, display],
  );
}

/**
 * Net worth split the Hustle way (section 3.2): cash + price of unmortgaged districts + (price - loan) of mortgaged
 * ones + 50% of the upgrade costs paid - unpaid debt. `total` is the engine's `netWorth` when it answers.
 * -> { cash, districts, upgrades, debt, total, count }
 */
export function worthParts(state, id) {
  const p = state?.players?.find((x) => x.id === id);
  if (!p) return { cash: 0, districts: 0, upgrades: 0, debt: 0, total: 0, count: 0 };
  let districts = 0;
  let upgrades = 0;
  let count = 0;
  for (let i = 0; i < TILES.length; i++) {
    if (state.owners?.[i] !== id) continue;
    const t = TILES[i];
    count += 1;
    districts += state.mortgaged?.[i] ? (t.price || 0) - mortgageOf(t) : t.price || 0;
    upgrades += Math.round((state.levels?.[i] || 0) * upgradeCostOf(t) * 0.5);
  }
  const debt = state.debt && state.debt.player === id ? Math.max(0, (state.debt.amount || 0)) : 0;
  const cash = p.cash || 0;
  const sum = cash + districts + upgrades - debt;
  let total = sum;
  try {
    const w = Engine.netWorth?.(state, id);
    if (Number.isFinite(w)) total = w;
  } catch { /* keep the sum */ }
  return { cash, districts, upgrades, debt, total, count };
}

/* ---- guarded engine calls (the UI must never crash because the engine moved) ---- */
export const DEFAULT_CFG = Engine.DEFAULT_SETTINGS || {};

export function canUpgradeSafe(state, playerId, tileId) {
  try { return Engine.canUpgrade(state, playerId, tileId); } catch { return null; }
}

export function previewRentSafe(state, tileId, sum = 7) {
  try { return Engine.previewRent(state, tileId, sum) || 0; } catch { return 0; }
}

/** number[BOARD_SIZE] landing probabilities for my next roll, or null when the engine can't say. */
export function landingOddsSafe(view, playerId) {
  try {
    if (typeof Engine.landingOdds !== 'function') return null;
    const odds = Engine.landingOdds(view, playerId, { previewRent: Engine.previewRent });
    return Array.isArray(odds) ? odds : null;
  } catch {
    return null;
  }
}

/** "🍀 Lucky dice" / "⚖️ Fair dice" from cfg.dice (default lucky). */
export const diceLabel = (cfg) => ((cfg?.dice ?? 'lucky') === 'fair' ? '⚖️ Fair dice' : '🍀 Lucky dice');

export const LUCKY_DICE_TEXT =
  'Lucky dice gently help whoever is behind: slightly better odds of landing on useful squares, a little protection after big rent bills, and fewer long dry spells without a bonus roll. Nothing is guaranteed.';
export const FAIR_DICE_TEXT = 'Fair dice: every roll is pure chance, with no help for anyone.';

export function worthOf(state, id) {
  return worthParts(state, id).total;
}

/** { worths:{[id]:n}, leaderId|null } — leader only when strictly ahead of every other active player. */
export function useWorths(session) {
  const state = useStateLike(session);
  return useMemo(() => {
    const worths = {};
    for (const p of state.players) worths[p.id] = worthOf(state, p.id);
    const alive = state.players.filter((p) => !p.bankrupt).sort((a, b) => worths[b.id] - worths[a.id]);
    const leaderId = alive.length > 1 && worths[alive[0].id] > worths[alive[1].id] ? alive[0].id : null;
    return { worths, leaderId, state };
  }, [state]);
}

export const getPlayer = (session, id) =>
  session.display?.players?.find((p) => p.id === id) || session.view?.players?.find((p) => p.id === id) || null;

export const nameOf = (session, id) => (id === session.me ? 'You' : getPlayer(session, id)?.name || 'Someone');

/** The player whose turn it is (from the animated display; falls back to view). */
export function activePlayer(session) {
  const d = session.display;
  if (d?.players?.length && Number.isInteger(d.turn)) return d.players[d.turn] || null;
  const v = session.view;
  return v?.players?.[v.turn] || null;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export const ROUND_RULE_TEXT =
  'One round = every player plays once (bonus rolls do not count). When the last round ends, the highest net worth wins. Last player standing wins early.';

/** Round progress for the top bar: { round, max|null, left|null, final, soon, pct }. */
export function roundInfo(session) {
  const cfg = session.display?.cfg || session.view?.cfg || {};
  const max = Number.isFinite(cfg.maxRounds) ? cfg.maxRounds : null;
  const rawRound = session.display?.round ?? session.view?.round ?? 1;
  const round = max != null ? Math.min(rawRound, max) : rawRound; // the round counter passes the limit when the game ends
  const left = max == null ? null : Math.max(0, max - round);
  return {
    round,
    max,
    left,
    final: max != null && round >= max,
    soon: left != null && left >= 1 && left <= 3,
    pct: max != null ? Math.min(1, Math.max(0, round / max)) : 0,
  };
}

/** "Standard City Hustle · 20 rounds · Start ₹15,00,000 · 🍀 Lucky dice" (maxRounds null = until one is left). */
export function settingsSummary(cfg, goal) {
  const c = cfg || {};
  const target = goal ?? c.goal;
  const parts = [];
  const mode = modeOf(c);
  if (mode) parts.push(mode.label);
  if (target != null) parts.push(`Target ${formatINR(target)}`);
  parts.push(Number.isFinite(c.maxRounds) ? `${c.maxRounds} rounds` : 'Until one player is left');
  if (c.startCash != null) parts.push(`Start ${formatINR(c.startCash)}`);
  parts.push(diceLabel(c));
  return parts.join(' · ');
}

/** The die on the table (the game has one die). Before the first roll: 4. */
export const diceSum = (session) => {
  const d = session.display?.dice || session.view?.dice || [];
  return d.reduce((sum, value) => sum + (Number(value) || 0), 0) || 4;
};
