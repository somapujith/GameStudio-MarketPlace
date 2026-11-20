// Pre-game room settings for Nawabi Raj (Hyderabad Hustle rules, docs/GAME_RULES.md section 2). Everything from
// a client is untrusted: the host may choose the mode and every host rule of shared/ruleSettings.js (money, timers,
// board rules, Snatch), plus the room's seat count. Pure functions - shared by POST /api/rooms and the GameRoom
// Durable Object.

import * as engine from '../shared/index.js';

export const MAX_PLAYERS_MIN = 2;
export const MAX_PLAYERS_MAX = 6;

/** The only modes accepted (engine MODES). */
export const MODE_IDS = Object.freeze([...engine.MODE_IDS]);
/** The only dice modes accepted. */
export const DICE_MODES = Object.freeze(['lucky', 'fair']);
/** The preset win targets the lobby offers (`null` = off). Any amount of engine TARGET_RANGE is accepted too. */
export const TARGET_OPTIONS = engine.TARGET_OPTIONS;

/** What a room starts with when the host picks nothing: the standard mode with every rule at its default. */
const D = engine.DEFAULT_SETTINGS;
export const ROOM_DEFAULTS = Object.freeze({ mode: D.mode, ...engine.ruleDefaults(D.mode) });

/** Rules that follow the mode: picking another mode resets them to that mode's defaults (see mergeSettingsPatch). */
export const MODE_BOUND_RULES = Object.freeze(['startCash', 'maxRounds', 'targetWorth']);

/** The maps a room may pick (shared/maps.js). The map is a lobby setting, not a host rule: it is stored only when it is not the default. */
export const MAP_OPTIONS = Object.freeze([...engine.MAP_IDS]);

/** Every key a room stores: `mode`, the rule keys and (for a non-default map) `map`. */
const SETTING_KEYS = ['mode', ...engine.RULE_KEYS, 'map'];

/** Room seats: integer 2..6, else null. */
export function parseMaxPlayers(v) {
  return Number.isInteger(v) && v >= MAX_PLAYERS_MIN && v <= MAX_PLAYERS_MAX ? v : null;
}

const UNIT_TEXT = { seconds: 'seconds', milliseconds: 'milliseconds' };

/** "Starting cash must be a whole amount from ₹5,00,000 to ₹10,00,00,000." - one clear message per bad rule. */
function ruleError(field) {
  const money = field.unit === 'rupees';
  const fmt = money ? engine.formatINR : (v) => String(v);
  if (field.type === 'boolean') return `${field.label} must be true or false.`;
  if (field.type === 'choice') {
    const opts = field.options.map((o) => (o.value === null ? 'null' : String(o.value))).join(', ');
    return `${field.label} must be one of ${opts}.`;
  }
  const unit = UNIT_TEXT[field.unit] ? ` ${UNIT_TEXT[field.unit]}` : '';
  const what = money ? 'a whole amount' : 'a whole number';
  const step = field.step > 1 ? ` in steps of ${fmt(field.step)}` : '';
  return `${field.label} must be ${what} from ${fmt(field.min)} to ${fmt(field.max)}${unit}${step}.`;
}

/**
 * Validate a (partial) settings object from a client.
 *
 * Returns `{ settings, maxPlayers?, errors }`:
 *  - `settings` only contains keys that were present AND valid: `mode`, `map` ('hyderabad' | 'andhra', shared/maps.js; not a rule)
 *    and the rule keys of shared/ruleSettings.js
 *    (startCash passStart targetWorth rentPercent trafficFine turnSeconds tradeSeconds auctionSeconds maxRounds dice
 *    requireFullSet eventEvery chaiCap snatches snatchMs snatchCardCap);
 *  - `targetWorth` is never an error: anything but `null` or a legal amount (and `null` for the classic mode, which
 *    always keeps a target) becomes the default of the mode in this same input (the standard mode when it carries none);
 *  - every other rule outside its legal values is an error naming the rule and its range;
 *  - unknown keys (e.g. `debug`, `seed`, the retired `goal` and the retired `auctionOnDecline`, whatever its value) are ignored;
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
  if (has('map')) {
    const v = input.map;
    if (typeof v === 'string' && MAP_OPTIONS.includes(v)) settings.map = v;
    else errors.push(`Map must be one of ${MAP_OPTIONS.map((m) => `'${m}'`).join(', ')}.`);
  }
  if (has('dice')) {
    const v = input.dice;
    if (typeof v === 'string' && DICE_MODES.includes(v)) settings.dice = v;
    else errors.push("Dice must be 'lucky' or 'fair'.");
  }
  if (has('targetWorth')) settings.targetWorth = engine.resolveTarget(settings.mode ?? D.mode, input.targetWorth);
  for (const field of engine.RULE_FIELDS) {
    const key = field.key;
    if (key === 'dice' || key === 'targetWorth' || !has(key)) continue;
    if (engine.isRuleValue(field, input[key])) settings[key] = input[key];
    else errors.push(ruleError(field));
  }
  if (has('maxPlayers')) {
    const mp = parseMaxPlayers(input.maxPlayers);
    if (mp == null) errors.push(`Players must be between ${MAX_PLAYERS_MIN} and ${MAX_PLAYERS_MAX}.`);
    else maxPlayers = mp;
  }
  return { settings, maxPlayers, errors };
}

/**
 * Full, normalised settings: the mode's defaults filled in under any valid overrides, so every rule key is present
 * (a room stored before a rule existed gets its default). The win target always follows the final mode: a missing or
 * unusable one is that mode's default.
 */
export function normalizeSettings(partial) {
  const { settings } = partial && typeof partial === 'object' ? sanitizeSettings(partial) : { settings: {} };
  // Re-validated defensively: only known keys with valid values can ever get through.
  const mode = settings.mode ?? D.mode;
  const out = { mode, ...engine.ruleDefaults(mode) };
  for (const k of SETTING_KEYS) if (k in settings) out[k] = settings[k];
  out.targetWorth = engine.resolveTarget(mode, settings.targetWorth);
  if (out.map === undefined || out.map === engine.DEFAULT_MAP) delete out.map; // the default map is never stored (an absent map IS Hyderabad)
  return out;
}

/**
 * The settings a host's patch produces over the room's current ones (before validation): `{ ...current, ...patch }`,
 * except that picking another mode resets the mode-bound rules (startCash, maxRounds, targetWorth) to that mode's
 * defaults - each unless the same message also changes that rule itself. Every other customised rule is kept.
 * (The client may send every setting, so a mode change can arrive together with the unchanged old values: a value
 * equal to the current one does not count as a change.)
 */
export function mergeSettingsPatch(current, patch) {
  const cur = current && typeof current === 'object' ? current : {};
  const p = patch && typeof patch === 'object' ? patch : {};
  const merged = { ...cur, ...p };
  const modeChanged = p.mode !== undefined && p.mode !== (cur.mode ?? D.mode);
  if (modeChanged) {
    const was = engine.ruleDefaults(cur.mode ?? D.mode); // a stored room may lack the key: it then ran with the old mode's default
    for (const k of MODE_BOUND_RULES) {
      const changed = p[k] !== undefined && p[k] !== (k in cur ? cur[k] : was[k]);
      if (!changed) delete merged[k]; // normalize fills the new mode's default
    }
  }
  return merged;
}

/** One-line summary for logs, e.g. "standard / lucky dice / target ₹50L", plus "/ +N custom rules". */
export function describeSettings(s) {
  const n = normalizeSettings(s);
  const target = n.targetWorth == null ? 'no target' : `target ${engine.compactINR(n.targetWorth)}`;
  const shown = new Set(['dice', 'targetWorth']);
  const more = engine.customRuleKeys(n, n.mode).filter((k) => !shown.has(k)).length;
  const map = engine.mapOf(n).id === engine.DEFAULT_MAP ? '' : ` / ${engine.mapOf(n).name} map`;
  return `${n.mode}${map} / ${n.dice} dice / ${target}${more ? ` / +${more} custom rule${more === 1 ? '' : 's'}` : ''}`;
}
