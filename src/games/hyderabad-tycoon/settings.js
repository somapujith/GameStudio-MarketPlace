// Hyderabad Tycoon host settings (Hyderabad Hustle rules): the lobby schema (docs/MARKETPLACE.md section 4), the
// fixed table rules line and the one-line summary. Pure (no React), so the manifest stays tiny and tests run in node.
//
// The server is the source of truth: values here MUST equal worker/settings.js (enforced by settings.test.js).
// The lobby shows the mode (a preset) and every host rule of shared/ruleSettings.js (`LOBBY_SETTINGS`), grouped
// (`SETTINGS_GROUPS`): the host's "Game rules" editor. Seats (`maxPlayers`) are a room setting handled by the lobby itself.
import { MODES, MODE_IDS, DEFAULT_MODE, TARGET_OPTIONS, targetLabel } from '@shared/modes.js';
import { RULE_FIELDS, RULE_GROUPS, RULE_KEYS, customRuleCount, ruleDefaults } from '@shared/ruleSettings.js';

export { MODES, MODE_IDS, DEFAULT_MODE, TARGET_OPTIONS };
export const DICE_MODES = ['lucky', 'fair'];
export const DEFAULT_DICE = 'lucky';
export const DEFAULT_AUCTION_ON_DECLINE = true;
export const DEFAULT_TARGET_WORTH = MODES[DEFAULT_MODE].targetWorth;

/**
 * How many rules the host changed from the defaults of the room's mode: the number in the "Custom rules" badge
 * (shared/ruleSettings.js; a key the room does not carry, or an illegal one, counts as "not changed").
 */
export { customRuleCount };

/**
 * "Standard City Hustle · 20 rounds · richest wins · ₹50L target" / "Classic Long Game · first to ₹30L wins", plus
 * "Custom rules (3)" when the host changed anything (a missing or unknown mode means the default; a missing round
 * limit or target the mode's default). The round limit and target shown are the room's own, not the preset's.
 */
export function settingsSummary(s = {}) {
  const src = s && typeof s === 'object' ? s : {};
  const m = MODES[src.mode] || MODES[DEFAULT_MODE];
  const rounds = src.maxRounds === undefined ? m.rounds : src.maxRounds;
  let target = src.targetWorth === undefined || (src.targetWorth !== null && typeof src.targetWorth !== 'number') ? m.targetWorth : src.targetWorth;
  if (target === null && m.rounds == null) target = m.targetWorth; // a mode without a round limit always plays to a target
  let line;
  if (rounds != null) line = `${m.label} · ${rounds} rounds · richest wins${target == null ? '' : ` · ${targetLabel(target)} target`}`;
  else if (target != null) line = `${m.label} · first to ${targetLabel(target)} wins`;
  else line = `${m.label} · no round limit`;
  const custom = customRuleCount(src);
  return custom > 0 ? `${line} · Custom rules (${custom})` : line;
}

/** The schema keys the lobby renders (manifest `lobbySettings`): the mode and every host rule (shared/ruleSettings.js). */
export const LOBBY_SETTINGS = ['mode', ...RULE_KEYS];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The Snatch explainer under the group title, for the numbers the host has set right now. */
export function snatchNote(s = {}) {
  const d = ruleDefaults(MODES[s && s.mode] ? s.mode : DEFAULT_MODE);
  const n = Number.isInteger(s && s.snatches) ? s.snatches : d.snatches;
  const ms = Number.isFinite(s && s.snatchMs) ? s.snatchMs : d.snatchMs;
  if (n === 0) return 'Snatch is off: nobody gets a Snatch button this game.';
  const secs = Math.round(ms / 100) / 10;
  return `Everyone starts with ${plural(n, 'Snatch button')}; after someone buys a district the others get ${plural(secs, 'second')} to press Snatch.`;
}

/** One sentence of explanation per group, shown under its title (a string, or a function of the current settings). */
const GROUP_NOTES = { snatch: snatchNote };

/** The rule groups of the lobby editor, in order (manifest `settingsGroups`). */
export const SETTINGS_GROUPS = RULE_GROUPS.map((g) => (GROUP_NOTES[g.id] ? { ...g, note: GROUP_NOTES[g.id] } : { ...g }));

/**
 * Short names for the lobby rows (a phone row has the name, the value and a reset button on one line). The server keeps
 * the long label for its error messages. A rule without an entry keeps its shared label.
 */
export const SHORT_LABELS = Object.freeze({
  passStart: 'START salary',
  auctionOnDecline: 'Auction on pass',
  requireFullSet: 'Full set to upgrade',
  chaiCap: 'Chai token limit',
  snatches: 'Snatch buttons',
  snatchMs: 'Snatch timer',
  snatchCardCap: 'Snatch from cards',
});

/** The fixed table rules, one muted line under the mode picker (manifest `tableRules`). */
export const TABLE_RULES = 'One die · 3 business levels per district · Chai, Auto shortcuts and city rush hours';

/** Quick picks next to a rupee slider (the slider and the -/+ stepper still reach every legal value). */
const QUICK_PICKS = {
  startCash: [1000000, 1500000, 2000000, 3000000, 5000000],
  // the classic win targets; "Off" only makes sense with a round limit: Classic always plays to a target (the server insists too)
  targetWorth: TARGET_OPTIONS,
};
const FORMATS = { rupees: 'inr', seconds: 'seconds', milliseconds: 'ms' };

/** One `RULE_FIELDS` entry as a lobby schema field (number -> slider stepper, choice -> segmented, boolean -> toggle). */
function ruleToSchema(f) {
  const standard = f.default(DEFAULT_MODE);
  const defaults = Object.fromEntries(MODE_IDS.map((m) => [m, f.default(m)]));
  const field = { key: f.key, label: SHORT_LABELS[f.key] || f.label, help: f.help, group: f.group, default: standard };
  // a rule whose default differs per mode follows the mode (a preset resets it; the server does the same)
  if (MODE_IDS.some((m) => defaults[m] !== standard)) field.dependsOn = { key: 'mode', defaults };
  if (f.type === 'boolean') return { ...field, type: 'toggle' };
  if (f.type === 'choice') return { ...field, type: 'segmented', options: f.options.map((o) => ({ ...o })) };
  const picks = QUICK_PICKS[f.key];
  return {
    ...field,
    type: 'stepper',
    slider: true,
    unit: f.unit,
    format: FORMATS[f.unit] || 'number',
    min: f.min,
    max: f.max,
    step: f.step,
    ...(f.min > 0 && f.max / f.min >= 20 ? { scale: 'curve' } : {}),
    ...(f.nullable ? { nullable: true } : {}),
    ...(picks
      ? {
          options: picks.map((value) => ({
            value,
            label: targetLabel(value),
            ...(value === null ? { hideIf: { mode: MODE_IDS.filter((m) => MODES[m].rounds == null) } } : {}),
          })),
        }
      : {}),
  };
}

/**
 * Host settings schema: the game mode (a preset: it resets the starting cash, the round limit and the win target) and
 * every host rule of shared/ruleSettings.js, grouped (`group`). The lobby renders `LOBBY_SETTINGS`; the full set is
 * what the server validates.
 */
export const SETTINGS_SCHEMA = [
  {
    key: 'mode',
    label: 'Game mode',
    type: 'segmented',
    options: MODE_IDS.map((value) => ({ value, label: MODES[value].label, hint: MODES[value].blurb })),
    default: DEFAULT_MODE,
    help: 'Standard: 20 rounds, richest wins. Quick: 12 rounds with ₹20 lakh each. Classic: no round limit, first to the win target.',
  },
  ...RULE_FIELDS.map(ruleToSchema),
];

/** The defaults of one mode: `{ key: value }` for the mode and every rule. */
export const modeDefaults = (mode) => ({ mode, ...ruleDefaults(mode) });
