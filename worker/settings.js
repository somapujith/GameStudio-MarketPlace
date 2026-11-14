// Pre-game room settings for Hyderabad Tycoon (Hyderabad Hustle rules, docs/GAME_RULES.md section 2). Everything from
// a client is untrusted: the host may only choose the mode, the dice and whether a skipped district goes to auction
// (plus the room's seat count). Pure functions - shared by POST /api/rooms and the GameRoom Durable Object.

import * as engine from '../shared/index.js';

export const MAX_PLAYERS_MIN = 2;
export const MAX_PLAYERS_MAX = 6;

/** The only modes accepted (engine MODES). */
export const MODE_IDS = Object.freeze([...engine.MODE_IDS]);
/** The only dice modes accepted. */
export const DICE_MODES = Object.freeze(['lucky', 'fair']);

/** What a room starts with when the host picks nothing: the engine's own defaults. */
const D = engine.DEFAULT_SETTINGS;
export const ROOM_DEFAULTS = Object.freeze({
  mode: D.mode,
  dice: D.dice,
  auctionOnDecline: D.auctionOnDecline,
});

const SETTING_KEYS = Object.keys(ROOM_DEFAULTS);

/** Room seats: integer 2..6, else null. */
export function parseMaxPlayers(v) {
  return Number.isInteger(v) && v >= MAX_PLAYERS_MIN && v <= MAX_PLAYERS_MAX ? v : null;
}

/**
 * Validate a (partial) settings object from a client.
 *
 * Returns `{ settings, maxPlayers?, errors }`:
 *  - `settings` only contains keys that were present AND valid (`mode`, `dice`, `auctionOnDecline`);
 *  - unknown keys (e.g. `debug`, `seed`, `startCash`, the retired `goal` / `maxRounds` / `snatches`) are ignored;
 *  - `maxPlayers` (2..6) is accepted as a convenience for the room seats;
 *  - `errors` holds one clear message per bad value. A missing key / `undefined` means "leave it alone".
 */
export function sanitizeSettings(input) {
  const settings = {};
  const errors = [];
  let maxPlayers;
  if (input === undefined || input === null) return { settings, errors };
  if (typeof input !== 'object' || Array.isArray(input)) return { settings, errors: ['Settings must be an object.'] };
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;

  if (has('mode')) {
    const v = input.mode;
    if (typeof v === 'string' && MODE_IDS.includes(v)) settings.mode = v;
    else errors.push(`Mode must be one of ${MODE_IDS.map((m) => `'${m}'`).join(', ')}.`);
  }
  if (has('dice')) {
    const v = input.dice;
    if (typeof v === 'string' && DICE_MODES.includes(v)) settings.dice = v;
    else errors.push("Dice must be 'lucky' or 'fair'.");
  }
  if (has('auctionOnDecline')) {
    const v = input.auctionOnDecline;
    if (typeof v === 'boolean') settings.auctionOnDecline = v;
    else errors.push('Auction on decline must be true or false.');
  }
  if (has('maxPlayers')) {
    const mp = parseMaxPlayers(input.maxPlayers);
    if (mp == null) errors.push(`Players must be between ${MAX_PLAYERS_MIN} and ${MAX_PLAYERS_MAX}.`);
    else maxPlayers = mp;
  }
  return { settings, maxPlayers, errors };
}

/** Full, normalised settings: defaults filled in under any valid overrides. */
export function normalizeSettings(partial) {
  const out = { ...ROOM_DEFAULTS };
  if (partial && typeof partial === 'object') {
    // Re-validate defensively: only known keys with valid values can ever get through.
    const { settings } = sanitizeSettings(partial);
    for (const k of SETTING_KEYS) if (k in settings) out[k] = settings[k];
  }
  return out;
}

/** One-line summary for logs, e.g. "standard / lucky dice / auction on". */
export function describeSettings(s) {
  const n = normalizeSettings(s);
  return `${n.mode} / ${n.dice} dice / auction ${n.auctionOnDecline ? 'on' : 'off'}`;
}
