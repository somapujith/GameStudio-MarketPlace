// Input validation / sanitising. Pure functions, no Worker APIs: easy to unit-test.
import { BOARD_SIZE } from '../shared/board.js';
import { isVoiceId } from '../shared/cosmetics.js';

export const NAME_MAX = 24;
export const AVATAR_MAX = 11;
export const CHAT_MAX = 200;

// C0/C1 controls, zero-width + bidi override/isolate characters, BOM, line/paragraph separators.
// eslint-disable-next-line no-control-regex
const INVISIBLE = new RegExp('[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]', 'g');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

/**
 * Clean a display name: strips control/invisible characters, collapses whitespace, trims,
 * truncates to NAME_MAX code points. Returns '' when nothing usable is left.
 */
export function sanitizeName(input, max = NAME_MAX) {
  if (typeof input !== 'string') return '';
  const s = input.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join('').trim() : s;
}

/**
 * Strict name validation for user-submitted names. Returns `{ ok:true, value }` or
 * `{ ok:false, error }`. Names longer than NAME_MAX are rejected (not silently cut).
 */
export function validateName(input) {
  if (typeof input !== 'string') return { ok: false, error: 'Name must be text.' };
  const cleaned = input.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return { ok: false, error: 'Name cannot be empty.' };
  if ([...cleaned].length > NAME_MAX) return { ok: false, error: `Name must be at most ${NAME_MAX} characters.` };
  return { ok: true, value: cleaned };
}

/** Avatar preset id: integer 0..11. Returns the number or null. */
export function parseAvatar(v) {
  if (typeof v === 'string' && /^\d{1,2}$/.test(v)) v = Number(v);
  return Number.isInteger(v) && v >= 0 && v <= AVATAR_MAX ? v : null;
}

// Room/engine settings live in ./settings.js (strict, shared by the routes and GameRoom).
export { sanitizeSettings, parseMaxPlayers, MAX_PLAYERS_MIN, MAX_PLAYERS_MAX } from './settings.js';
// `{t:'net', rtt}` (connection strength report): rtt must be a finite number 0..20000 (see netpresence.js).
export { parseNetRtt } from './netpresence.js';

export const EMOTES = ['emote_mass', 'emote_cheer', 'emote_shock', 'emote_laugh', 'emote_thanks', 'emote_hurry', 'emote_taunt'];

/** Chat text: strip control chars, collapse whitespace, cap length. */
export function sanitizeChat(input) {
  if (typeof input !== 'string') return '';
  const s = input.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...s];
  return chars.length > CHAT_MAX ? chars.slice(0, CHAT_MAX).join('') : s;
}

/** Emote key if it is on the allow-list (default: the Tycoon soundboard keys), else ''. */
export const sanitizeEmote = (v, allowed = EMOTES) => (typeof v === 'string' && allowed.includes(v) ? v : '');

/** Voice line id from a `{t:'voice', id}` message if it is in the catalogue (shared/cosmetics.js), else ''. */
export const sanitizeVoiceId = (v) => (isVoiceId(v) ? v : '');

// Actions that carry no parameters besides the (server-forced) player id (docs/HUSTLE_PLAN.md 3.7).
const SIMPLE_ACTIONS = new Set([
  'ROLL',
  'PAY_TRAFFIC',
  'USE_CHAI',
  'BUY',
  'SKIP_BUY',
  'RIDE',
  'END_TURN',
  'RESIGN',
  'PAY_DEBT',
  'TRADE_ACCEPT',
  'TRADE_REJECT',
  'TRADE_CANCEL',
  'SNATCH', // sealed press during a Snatch window (SNATCH_CLOSE and AUCTION_CLOSE are server-only and never allowed from a client)
]);
// Actions that carry a single tile id.
const TILE_ACTIONS = new Set(['UPGRADE', 'MORTGAGE', 'UNMORTGAGE', 'SELL_BUILDING']);
const MAX_MONEY = 100_000_000;
// PLAY_POWER ids: a card uid / a player id (uuids, bot ids): letters, digits, underscore, hyphen.
const ID_RE = /^[A-Za-z0-9_-]+$/;
const POWER_CARD_MAX = 40;
const POWER_TARGET_MAX = 64;

const isTile = (t) => Number.isInteger(t) && t >= 0 && t < BOARD_SIZE;

/** One side of a trade: { cash:int>=0, tiles:int[] (unique, on-board) }, or null if malformed. */
function sanitizeTradeSide(side) {
  if (!side || typeof side !== 'object' || Array.isArray(side)) return null;
  const cash = side.cash === undefined ? 0 : side.cash;
  if (!Number.isInteger(cash) || cash < 0 || cash > MAX_MONEY) return null;
  const tiles = side.tiles === undefined ? [] : side.tiles;
  if (!Array.isArray(tiles) || tiles.length > BOARD_SIZE || !tiles.every(isTile)) return null;
  if (new Set(tiles).size !== tiles.length) return null;
  return { cash, tiles: [...tiles] };
}

/**
 * Action types a client may send (docs/GAME_RULES.md 8.5), and how to build the
 * clean engine action: `playerId` is forced, unknown fields are dropped, numbers are checked.
 * Whether the action is *legal right now* is the engine's job (applyAction validates).
 * Keep this list in sync with the contract when the engine gains actions.
 */
export function sanitizeAction(input, playerId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const type = input.type;
  if (typeof type !== 'string') return null;
  if (SIMPLE_ACTIONS.has(type)) return { type, playerId };
  if (TILE_ACTIONS.has(type)) return isTile(input.tile) ? { type, tile: input.tile, playerId } : null;
  switch (type) {
    case 'BID': {
      const amount = input.amount;
      if (!Number.isInteger(amount) || amount < 0 || amount > MAX_MONEY) return null;
      return { type, amount, playerId };
    }
    case 'TRADE_OFFER': {
      const to = input.to;
      if (typeof to !== 'string' || !to || to.length > 64 || to === playerId) return null;
      const give = sanitizeTradeSide(input.give);
      const get = sanitizeTradeSide(input.get);
      if (!give || !get) return null;
      if (!give.cash && !give.tiles.length && !get.cash && !get.tiles.length) return null; // empty deal
      return { type, to, give, get, playerId };
    }
    case 'TRADE_COUNTER': {
      // the recipient's changed deal: same shape as an offer without `to` (the proposer is implied); give leaves the sender
      const give = sanitizeTradeSide(input.give);
      const get = sanitizeTradeSide(input.get);
      if (!give || !get) return null;
      if (!give.cash && !give.tiles.length && !get.cash && !get.tiles.length) return null;
      return { type, give, get, playerId };
    }
    case 'PLAY_POWER': {
      // Power Cards (docs/POWER_CARDS.md section 2): `card` is the hand card's uid, `target` a rival's player id (swap
      // only). Whether the card, the target and the moment are legal is the engine's job.
      const card = typeof input.card === 'string' ? input.card.trim() : '';
      if (!card || card.length > POWER_CARD_MAX || !ID_RE.test(card)) return null;
      if (input.target === undefined) return { type, card, playerId };
      const target = input.target;
      if (typeof target !== 'string' || !target || target.length > POWER_TARGET_MAX || !ID_RE.test(target)) return null;
      return { type, card, target, playerId };
    }
    default:
      return null;
  }
}

// ---- Usernames ("@handles") ----
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;
export const HANDLE_RULES = `Usernames are ${HANDLE_MIN}-${HANDLE_MAX} characters: letters, numbers and single underscores, starting with a letter.`;

// Names nobody may claim (exact match, after lowercasing).
export const RESERVED_HANDLES = new Set([
  'admin',
  'administrator',
  'support',
  'gamehub',
  'kingpin',
  'system',
  'moderator',
  'mod',
  'help',
  'official',
  'staff',
  'root',
  'owner',
  'team',
  'security',
  'service',
  'null',
  'undefined',
  'anonymous',
  'guest',
  'everyone',
  'hyd',
  'hydtycoon',
]);

// Easily extended: a handle containing any of these (underscores dropped, common digit look-alikes
// folded to letters) is refused as reserved. Keep it to clear profanity / brand impersonation so
// innocent names are not caught by accident.
export const BLOCKED_HANDLE_WORDS = ['gamehub', 'kingpin', 'fuck', 'shit', 'cunt', 'nigg', 'faggot', 'rapist', 'nazi', 'hitler'];

const HANDLE_RE = /^[a-z][a-z0-9_]*$/;
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };

/** True when a (lowercase) handle is reserved or contains a blocked word. */
export function isReservedHandle(h) {
  if (RESERVED_HANDLES.has(h)) return true;
  const folded = h.replace(/_/g, '').replace(/[013457]/g, (d) => LEET[d]);
  return BLOCKED_HANDLE_WORDS.some((w) => folded.includes(w));
}

/**
 * Lenient lookup form of a handle typed by a user: trims, drops one leading "@", lowercases.
 * Returns '' unless the result has the shape of a handle (no reserved check: lookups just miss).
 */
export function normalizeHandle(input) {
  if (typeof input !== 'string') return '';
  const h = input.trim().replace(/^@/, '').toLowerCase();
  if (h.length < HANDLE_MIN || h.length > HANDLE_MAX || !HANDLE_RE.test(h) || h.includes('__')) return '';
  return h;
}

/**
 * Strict handle validation for claiming one. Accepts uppercase / a leading "@" and stores lowercase.
 * `{ ok:true, value }` or `{ ok:false, reason:'invalid'|'reserved', error }`.
 */
export function validateHandle(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'invalid', error: 'Username must be text.' };
  const h = input.trim().replace(/^@/, '').toLowerCase();
  if (h.length < HANDLE_MIN || h.length > HANDLE_MAX || !HANDLE_RE.test(h) || h.includes('__')) {
    return { ok: false, reason: 'invalid', error: HANDLE_RULES };
  }
  if (isReservedHandle(h)) return { ok: false, reason: 'reserved', error: 'That username is not available.' };
  return { ok: true, value: h };
}
