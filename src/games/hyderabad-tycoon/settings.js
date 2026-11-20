// Nawabi Raj host settings (Hyderabad Hustle rules): the lobby schema (docs/MARKETPLACE.md section 4), the
// fixed table rules line and the one-line summary. Pure (no React), so the manifest stays tiny and tests run in node.
//
// The server is the source of truth: values here MUST equal worker/settings.js (enforced by settings.test.js).
// The lobby shows the mode (a preset) and every host rule of shared/ruleSettings.js (`LOBBY_SETTINGS`), grouped
// (`SETTINGS_GROUPS`): the host's "Game rules" editor. Seats (`maxPlayers`) are a room setting handled by the lobby itself.
import { MODES, MODE_IDS, DEFAULT_MODE, TARGET_OPTIONS, targetLabel } from '@shared/modes.js';
import { RULE_FIELDS, RULE_GROUPS, RULE_KEYS, customRuleCount, ruleDefaults } from '@shared/ruleSettings.js';
import { DEFAULT_MAP, MAPS, MAP_IDS, isMapId } from '@shared/maps.js';
import { mapTitle } from '@/components/online/mapModel.js';

export { MODES, MODE_IDS, DEFAULT_MODE, TARGET_OPTIONS, MAP_IDS, DEFAULT_MAP };
export const DICE_MODES = ['lucky', 'fair'];
export const DEFAULT_DICE = 'lucky';
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
  // the map is not a rule: it leads the line only when it is not the home map (the lobby and the join page show the map on their own)
  const map = typeof src.map === 'string' && isMapId(src.map) && src.map !== DEFAULT_MAP ? `${mapTitle(MAPS[src.map].name)} · ` : '';
  return custom > 0 ? `${map}${line} · Custom rules (${custom})` : `${map}${line}`;
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
  requireFullSet: 'Full set to upgrade',
  chaiCap: 'Chai token limit',
  snatches: 'Snatch buttons',
  snatchMs: 'Snatch timer',
  snatchCardCap: 'Snatch from cards',
});

/** "2 maps: Charminar Chaos · Andhra Aatalu": the store listing and the hub card say which maps the game has. */
export const MAPS_LINE = `${MAP_IDS.length} maps: ${MAP_IDS.map((id) => mapTitle(MAPS[id].name)).join(' · ')}`;

/** The fixed table rules, one muted line under the mode picker (manifest `tableRules`). */
export const TABLE_RULES = 'One die · 3 business levels per district · Chai, Auto shortcuts and city rush hours';

/** The same line in the words of each map (manifest `tableRulesFor(mapId)`); a map without its own line uses `TABLE_RULES`. */
export const TABLE_RULES_BY_MAP = {
  hyderabad: TABLE_RULES,
  andhra: 'One die · 3 business levels per district · Festival tokens, Port, Junction and Airport shortcuts and regional events',
};
export const tableRulesFor = (mapId) => TABLE_RULES_BY_MAP[mapId] || TABLE_RULES;

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
 * The map the table plays on (`widget: 'map'`: the lobby draws it as picker cards, never as a plain field or a custom rule).
 * Same board, a different map (names, colours, places, cards and terms); the server stores it as `map`.
 */
export const MAP_FIELD = {
  key: 'map',
  label: 'Map',
  type: 'segmented',
  widget: 'map',
  options: MAP_IDS.map((value) => ({ value, label: mapTitle(MAPS[value].name) })),
  default: DEFAULT_MAP,
  help: 'Same board, different map: the places, colours and city words change; the rules do not.',
};

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
  MAP_FIELD, // right after the mode
  ...RULE_FIELDS.map(ruleToSchema),
];

/** The defaults of one mode: `{ key: value }` for the mode and every rule. */
export const modeDefaults = (mode) => ({ mode, ...ruleDefaults(mode) });
