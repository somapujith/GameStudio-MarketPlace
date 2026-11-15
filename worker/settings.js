// Pre-game room settings for Hyderabad Tycoon (Hyderabad Hustle rules, docs/GAME_RULES.md section 2). Everything from
// a client is untrusted: the host may only choose the mode, the win target (net worth), the dice and whether a skipped
// district goes to auction (plus the room's seat count). Pure functions - shared by POST /api/rooms and the GameRoom
// Durable Object.

import * as engine from '../shared/index.js';

export const MAX_PLAYERS_MIN = 2;
export const MAX_PLAYERS_MAX = 6;

/** The only modes accepted (engine MODES). */
export const MODE_IDS = Object.freeze([...engine.MODE_IDS]);
/** The only dice modes accepted. */
export const DICE_MODES = Object.freeze(['lucky', 'fair']);
/** The only win targets accepted (`null` = off); a mode without a round limit never runs without one. */
export const TARGET_OPTIONS = engine.TARGET_OPTIONS;

/** What a room starts with when the host picks nothing: the engine's own defaults. */
const D = engine.DEFAULT_SETTINGS;
export const ROOM_DEFAULTS = Object.freeze({
  mode: D.mode,
  dice: D.dice,
  auctionOnDecline: D.auctionOnDecline,
  targetWorth: D.targetWorth,
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
 *  - `settings` only contains keys that were present AND valid (`mode`, `dice`, `auctionOnDecline`, `targetWorth`);
 *  - `targetWorth` is never an error: anything but `null` or a TARGET_OPTIONS value (and `null` for a mode without a
 *    round limit) becomes the default of the mode in this same input (the standard mode when it carries none);
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
  if (has('targetWorth')) settings.targetWorth = engine.resolveTarget(settings.mode ?? D.mode, input.targetWorth);
  if (has('maxPlayers')) {
    const mp = parseMaxPlayers(input.maxPlayers);
    if (mp == null) errors.push(`Players must be between ${MAX_PLAYERS_MIN} and ${MAX_PLAYERS_MAX}.`);
    else maxPlayers = mp;
  }
  return { settings, maxPlayers, errors };
}

/**
 * Full, normalised settings: defaults filled in under any valid overrides. The win target always follows the final
 * mode: a missing or unusable one is that mode's default (so a room saved before the target existed gets it).
 */
export function normalizeSettings(partial) {
  const out = { ...ROOM_DEFAULTS };
  let target;
  if (partial && typeof partial === 'object') {
    // Re-validate defensively: only known keys with valid values can ever get through.
    const { settings } = sanitizeSettings(partial);
    for (const k of SETTING_KEYS) if (k in settings) out[k] = settings[k];
    target = settings.targetWorth;
  }
  out.targetWorth = engine.resolveTarget(out.mode, target);
  return out;
}

/**
 * The settings a host's patch produces over the room's current ones (before validation): `{ ...current, ...patch }`,
 * except that picking another mode resets the win target to that mode's default - unless the same message also
 * changes the target itself. (The client always sends every setting, so a mode change arrives together with the
 * unchanged old target.)
 */
export function mergeSettingsPatch(current, patch) {
  const cur = current && typeof current === 'object' ? current : {};
  const p = patch && typeof patch === 'object' ? patch : {};
  const merged = { ...cur, ...p };
  const modeChanged = p.mode !== undefined && p.mode !== (cur.mode ?? D.mode);
  const targetChanged = p.targetWorth !== undefined && p.targetWorth !== cur.targetWorth;
  if (modeChanged && !targetChanged) delete merged.targetWorth; // normalize fills the new mode's default
  return merged;
}

/** One-line summary for logs, e.g. "standard / lucky dice / auction on". */
export function describeSettings(s) {
  const n = normalizeSettings(s);
  const target = n.targetWorth == null ? 'no target' : `target ${engine.compactINR(n.targetWorth)}`;
  return `${n.mode} / ${n.dice} dice / auction ${n.auctionOnDecline ? 'on' : 'off'} / ${target}`;
}
