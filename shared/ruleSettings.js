// THE CONTRACT for host-customisable rules (one source of truth: the lobby UI renders these fields, the Worker
// validates a host's patch with `sanitizeRules`, the engine reads the result from `state.cfg`).
//
// Pure data + pure functions, no imports from the engine. Keys never change once shipped.
//
// A field: { key, group, label, help, type: 'number' | 'choice' | 'boolean', unit?, min?, max?, step?, options?,
//            default(mode) }
//   number   integer between min and max (inclusive) on `step`
//   choice   one of `options` ([{ value, label }]); `null` is a legal value when listed
//   boolean  true | false
// The default may depend on the game mode (standard / quick / classic) through `default(mode)`.
import { MODES, DEFAULT_MODE, ROUND_CAP } from './modes.js';

export const RULE_GROUPS = Object.freeze([
  { id: 'money', label: 'Money' },
  { id: 'timers', label: 'Timers' },
  { id: 'rules', label: 'Board rules' },
  { id: 'snatch', label: 'Snatch' },
]);

const modeOf = (mode) => MODES[mode] || MODES[DEFAULT_MODE];

const ROUND_CHOICES = [10, 12, 15, 20, 25, 30, 40, 50, 60].map((v) => ({ value: v, label: `${v} rounds` }));

/** Win-target choices a host may pick (custom amounts are allowed too: see `targetWorth` below). */
export const RULE_FIELDS = Object.freeze([
  // ---- money ----
  {
    key: 'startCash', group: 'money', label: 'Starting cash', type: 'number', unit: 'rupees',
    min: 500000, max: 100000000, step: 100000, help: 'Cash every player starts with (₹5L to ₹10Cr).',
    default: (mode) => modeOf(mode).startCash,
  },
  {
    key: 'passStart', group: 'money', label: 'Salary for passing START', type: 'number', unit: 'rupees',
    min: 0, max: 1000000, step: 25000, help: 'Paid every time a player passes or lands on START (₹0 to ₹10L).',
    default: () => 200000,
  },
  {
    key: 'targetWorth', group: 'money', label: 'Win target (net worth)', type: 'number', unit: 'rupees', nullable: true,
    min: 1000000, max: 500000000, step: 500000,
    help: 'First player to reach this net worth wins. Off = no target (Classic always keeps one).',
    default: (mode) => modeOf(mode).targetWorth,
  },
  {
    key: 'rentPercent', group: 'money', label: 'Rent level', type: 'choice', help: 'Scales every rent in the game.',
    options: [50, 75, 100, 125, 150, 200].map((v) => ({ value: v, label: `${v}%` })), default: () => 100,
  },
  {
    key: 'trafficFine', group: 'money', label: 'Traffic Jam fine', type: 'number', unit: 'rupees',
    min: 0, max: 100000, step: 5000, help: 'Paid to leave the Traffic Jam at once.', default: () => 25000,
  },
  // ---- timers ----
  {
    key: 'turnSeconds', group: 'timers', label: 'Decision timer', type: 'number', unit: 'seconds',
    min: 15, max: 180, step: 5, help: 'Time a player has to act before the game plays a move for them.',
    default: () => 60,
  },
  {
    key: 'tradeSeconds', group: 'timers', label: 'Trade offer timer', type: 'number', unit: 'seconds',
    min: 15, max: 120, step: 5, help: 'An unanswered trade offer is rejected after this.', default: () => 45,
  },
  {
    key: 'maxRounds', group: 'timers', label: 'Round limit', type: 'choice', nullable: true,
    help: `After the last round the richest player wins. No limit = play to the target (safety cap ${ROUND_CAP} rounds).`,
    options: [{ value: null, label: 'No limit' }, ...ROUND_CHOICES], default: (mode) => modeOf(mode).rounds,
  },
  // ---- board rules ----
  {
    key: 'dice', group: 'rules', label: 'Dice', type: 'choice', help: 'Lucky dice give a stuck player a small nudge; fair is uniform.',
    options: [{ value: 'lucky', label: 'Lucky' }, { value: 'fair', label: 'Fair' }], default: () => 'lucky',
  },
  {
    key: 'auctionOnDecline', group: 'rules', label: 'Auction when someone passes', type: 'boolean',
    help: 'A district a player does not buy goes to a sealed auction.', default: () => true,
  },
  {
    key: 'requireFullSet', group: 'rules', label: 'Full set needed to upgrade', type: 'boolean',
    help: 'A player must own every district of a collection before upgrading it.', default: () => true,
  },
  {
    key: 'eventEvery', group: 'rules', label: 'City events', type: 'choice', help: 'A city rush hour every N rounds.',
    options: [{ value: 0, label: 'Off' }, ...[2, 3, 4, 5, 6].map((v) => ({ value: v, label: `Every ${v} rounds` }))],
    default: () => 3,
  },
  {
    key: 'chaiCap', group: 'rules', label: 'Chai tokens a player can hold', type: 'number',
    min: 1, max: 3, step: 1, help: 'A chai token halves a big rent or skips a traffic jam.', default: () => 1,
  },
  // ---- snatch ----
  {
    key: 'snatches', group: 'snatch', label: 'Snatch buttons each player starts with', type: 'number',
    min: 0, max: 3, step: 1, help: '0 turns Snatch off completely.', default: () => 1,
  },
  {
    key: 'snatchMs', group: 'snatch', label: 'Snatch timer', type: 'number', unit: 'milliseconds',
    min: 3000, max: 10000, step: 1000,
    help: 'After someone buys a district, the others get this long to press Snatch.', default: () => 5000,
  },
  {
    key: 'snatchCardCap', group: 'snatch', label: 'Extra Snatch buttons from cards', type: 'number',
    min: 0, max: 2, step: 1, help: 'The most extra buttons one player can win from chance cards in a game.', default: () => 2,
  },
]);

export const RULE_KEYS = Object.freeze(RULE_FIELDS.map((f) => f.key));
export const ruleField = (key) => RULE_FIELDS.find((f) => f.key === key) || null;

/** `{ key: default }` for a mode. */
export function ruleDefaults(mode = DEFAULT_MODE) {
  const out = {};
  for (const f of RULE_FIELDS) out[f.key] = f.default(mode);
  return out;
}

/** Is `value` legal for the field? (`null` only where `nullable`.) */
export function isRuleValue(field, value) {
  if (!field) return false;
  if (value === null) return !!field.nullable;
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (field.type === 'choice') return field.options.some((o) => o.value === value);
  if (field.type === 'number') {
    if (!Number.isInteger(value) || value < field.min || value > field.max) return false;
    return (value - field.min) % field.step === 0;
  }
  return false;
}

/**
 * The legal value for a requested one: a legal value stays, anything else (unknown, out of range, wrong type) becomes
 * the mode default. A mode without a round limit never runs without a win target: `targetWorth: null` becomes its
 * default there (the round cap stays as a safety net). Never throws.
 */
export function cleanRule(key, value, mode = DEFAULT_MODE) {
  const f = ruleField(key);
  if (!f) return undefined;
  const base = f.default(mode);
  let v = isRuleValue(f, value) ? value : base;
  if (key === 'targetWorth' && v === null && modeOf(mode).rounds == null) v = base;
  return v;
}

/** `{ ...ruleDefaults(mode), ...cleaned patch }`: every rule key, all legal. */
export function sanitizeRules(patch, mode = DEFAULT_MODE) {
  const src = patch && typeof patch === 'object' ? patch : {};
  const out = ruleDefaults(mode);
  for (const f of RULE_FIELDS) if (Object.prototype.hasOwnProperty.call(src, f.key)) out[f.key] = cleanRule(f.key, src[f.key], mode);
  return out;
}

/** The legal range text for a number field, e.g. "₹5L - ₹10Cr" or "15 - 180 seconds" (for hints/errors). */
export function ruleRangeText(field, fmt = (v) => String(v)) {
  if (!field || field.type !== 'number') return '';
  return `${fmt(field.min)} - ${fmt(field.max)}${field.unit && field.unit !== 'rupees' ? ` ${field.unit}` : ''}`;
}

/**
 * The rule keys whose value in `settings` differs from the defaults of `mode` (a key that is missing or illegal counts
 * as the default). `mode` falls back to `settings.mode`, then the standard mode. Pure; used for "Custom rules" labels.
 */
export function customRuleKeys(settings, mode) {
  const src = settings && typeof settings === 'object' ? settings : {};
  const m = typeof mode === 'string' ? mode : typeof src.mode === 'string' ? src.mode : DEFAULT_MODE;
  const base = ruleDefaults(m);
  const out = [];
  for (const f of RULE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(src, f.key) || src[f.key] === undefined) continue;
    if (cleanRule(f.key, src[f.key], m) !== base[f.key]) out.push(f.key);
  }
  return out;
}

/** How many rules differ from the mode defaults (0 = a stock game; 1 or more = "Custom rules"). */
export const customRuleCount = (settings, mode) => customRuleKeys(settings, mode).length;

/**
 * Hints for legal but odd combinations (the server accepts them, the lobby may show them): `[{ key, text }]`, `key` = the
 * rule to point at. `fmt` formats a rupee amount (pass `formatINR` / `compactINR`). Pure; illegal or missing values count as the
 * mode defaults, like everywhere in this file.
 *   - a win target not above the starting cash: net worth at the start IS the starting cash, so the first move ends the game;
 *   - no round limit and no win target: only the last player standing (or the 60-round safety cap) ends the game.
 */
export function ruleWarnings(settings, mode, fmt = (v) => String(v)) {
  const src = settings && typeof settings === 'object' ? settings : {};
  const m = typeof mode === 'string' ? mode : typeof src.mode === 'string' ? src.mode : DEFAULT_MODE;
  const r = sanitizeRules(src, m);
  const out = [];
  if (r.targetWorth != null && r.targetWorth <= r.startCash) {
    out.push({ key: 'targetWorth', text: `The win target (${fmt(r.targetWorth)}) is not above the starting cash (${fmt(r.startCash)}): the game ends on the first move.` });
  }
  if (r.maxRounds == null && r.targetWorth == null) {
    out.push({ key: 'maxRounds', text: `No round limit and no win target: only the last player standing, or round ${ROUND_CAP}, ends the game.` });
  }
  return out;
}
