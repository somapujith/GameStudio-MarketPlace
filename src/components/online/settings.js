// Host-settings model for the lobby, driven ENTIRELY by the game's `manifest.settings` schema
// (docs/MARKETPLACE.md section 4). Nothing here knows about a particular game. Pure and unit-tested.
//
// Field: { key, label, type: 'segmented'|'stepper'|'toggle', options?: [{value,label,hideIf?}], min?, max?, step?,
//          default, format?: 'inr'|'number'|'text', help?, dependsOn? }
//   - option.hideIf: `{ [otherKey]: [values] }` hides the option while that other setting has one of the values
//     (the Tycoon lobby hides "Off" for a win target while the mode is classic)
//   - dependsOn: `{ key, defaults: { [otherValue]: value } }`: when the host changes `key` the field jumps to the
//     default for the new value (unless the same change sets the field itself); the option equal to that default is
//     labelled "(default)". The server applies the same rule (adapter.mergeSettings), this keeps the UI in step.
// A game may list the keys its lobby shows in `manifest.lobbySettings` (the others keep their defaults and are
// never rendered); without that field the lobby shows every setting.
//   - segmented: pick one of `options` (a value may be null, e.g. "unlimited")
//   - stepper:   a number with -/+ buttons (`min`/`max`/`step`); optional `options` become quick-pick chips
//   - toggle:    on/off
// Rule editor extras (all optional, used by the host "Game rules" editor of a game that lists `settingsGroups`):
//   - group: 'money' ...   the rule group a field belongs to (a field without one is a plain setting, e.g. the mode)
//   - slider: true         a stepper that also has a slider; `scale: 'curve'` gives a wide range a finer low end
//   - nullable: true       a stepper that may be `null` (an explicit "Off" chip, `nullLabel` names it)
//   - format: 'inr' | 'number' | 'seconds' | 'ms' | 'text', unit: 'rupees' | 'seconds' | ... (range hints)
//   `fieldDefault` / `isDefaultValue` / `customCount` / `groupFields` / `presetPatch` / `resetPatch` below.
// The server (adapter.validateSettings) is the source of truth; the client only ever sends the FULL set of
// schema keys, so a partial echo from the server can never leave gaps.
import { compactINR, formatINR } from '@shared/format.js';

const TYPES = new Set(['segmented', 'stepper', 'toggle']);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** The usable fields of a schema (unknown types / keyless entries are skipped, never thrown on). */
export function schemaFields(schema) {
  return (Array.isArray(schema) ? schema : []).filter((f) => f && typeof f.key === 'string' && f.key && TYPES.has(f.type));
}

/** The fields the lobby renders: the schema narrowed to `game.lobbySettings` (all of it when the game sets none). */
export function lobbyFields(game) {
  // a `widget: 'map'` field is the map picker (cards, drawn by SettingsPanel): stored by the server, but neither a plain control nor a custom rule
  const fields = schemaFields(game && game.settings).filter((f) => f.widget !== 'map');
  const keys = game && game.lobbySettings;
  return Array.isArray(keys) ? fields.filter((f) => keys.includes(f.key)) : fields;
}

/**
 * The usable options of a field. With `values` (the settings as they are right now) options hidden by `hideIf` are
 * dropped and the option that is the default for the current `dependsOn` value gets " (default)" in its label.
 */
export function fieldOptions(field, values) {
  const all = Array.isArray(field && field.options) ? field.options.filter((o) => o && 'value' in o) : [];
  if (!values || typeof values !== 'object') return all;
  const dep = field.dependsOn;
  const def = dep && dep.defaults ? dep.defaults[values[dep.key]] : undefined;
  return all
    .filter((o) => !(o.hideIf && Object.entries(o.hideIf).some(([k, list]) => Array.isArray(list) && list.includes(values[k]))))
    .map((o) => (def !== undefined && Object.is(o.value, def) && typeof o.label === 'string' ? { ...o, label: `${o.label} (default)` } : o));
}

export function clampField(field, v) {
  let n = Number(v);
  if (!Number.isFinite(n)) return field.default;
  if (num(field.min)) n = Math.max(field.min, n);
  if (num(field.max)) n = Math.min(field.max, n);
  return n;
}

/** Clamp AND snap to the grid that starts at `min` (what a slider or a typed value must become to be legal). */
export function snapField(field, v) {
  const n = clampField(field, v);
  if (!num(n) || !num(field.step) || field.step <= 0) return n;
  const base = num(field.min) ? field.min : 0;
  return clampField(field, base + Math.round((n - base) / field.step) * field.step);
}

/** The default of a field for the settings as they are now (a `dependsOn` field follows the mode it depends on). */
export function fieldDefault(field, values) {
  const dep = field && field.dependsOn;
  if (dep && dep.defaults && values && typeof values === 'object') {
    const d = dep.defaults[values[dep.key]];
    if (d !== undefined) return d;
  }
  return field ? field.default : undefined;
}

/** Is `value` the default of `field` right now? */
export const isDefaultValue = (field, value, values) => Object.is(value, fieldDefault(field, values));

/** `{ [key]: default }` for every field. */
export function defaultSettings(schema) {
  const out = {};
  for (const f of schemaFields(schema)) out[f.key] = f.default;
  return out;
}

/**
 * Server settings (possibly partial / missing / with extra keys) -> one value per schema field.
 * Missing keys get the default; a stepper is clamped; a segmented value is kept even when it is not one of the
 * options (the server may know more presets than the client), so nothing is silently rewritten.
 */
export function resolveSettings(schema, raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const f of schemaFields(schema)) {
    const v = s[f.key];
    // a missing value is the default of the mode the room is in (a rule that `dependsOn` the mode), not the first mode's
    const def = () => fieldDefault(f, { ...s, ...out });
    if (v === undefined) out[f.key] = def();
    else if (f.type === 'toggle') out[f.key] = typeof v === 'boolean' ? v : def();
    else if (f.type === 'stepper') out[f.key] = v === null && f.nullable ? null : typeof v === 'number' ? clampField(f, v) : def();
    else out[f.key] = v;
  }
  return out;
}

/** The exact message for a host change: always the full set with explicit values (`null` stays `null`). */
export function settingsMessage(schema, current, patch) {
  const cur = current || {};
  const p = patch || {};
  const merged = { ...cur, ...p };
  // a field that `dependsOn` another resets to that value's default when the other one changes (and it did not change itself)
  for (const f of schemaFields(schema)) {
    const dep = f.dependsOn;
    if (!dep || !(dep.key in p) || p[dep.key] === cur[dep.key]) continue;
    if (f.key in p && p[f.key] !== cur[f.key]) continue;
    const def = dep.defaults ? dep.defaults[p[dep.key]] : undefined;
    if (def !== undefined) merged[f.key] = def;
  }
  return { t: 'settings', settings: resolveSettings(schema, merged) };
}

/** A stable string of the resolved values (cheap change detection for effects). */
export function settingsKey(schema, raw) {
  return JSON.stringify(resolveSettings(schema, raw));
}

/**
 * One -/+ press on a stepper: moves by `step`, snapped to the grid that starts at `min`, clamped to [min, max].
 * With 70,000 and step 5,000 you get 75,000; from 12,000 (min 10,000) one press up is 15,000 and one down is 10,000.
 */
export function stepValue(field, value, dir) {
  const step = num(field.step) && field.step > 0 ? field.step : 1;
  const base = num(field.min) ? field.min : 0;
  const cur = clampField(field, value);
  const k = (cur - base) / step;
  const next = dir > 0 ? (Math.floor(k + 1e-9) + 1) * step + base : (Math.ceil(k - 1e-9) - 1) * step + base;
  return clampField(field, next);
}

/**
 * One -/+ press on a rule stepper: like `stepValue`, but a `null` (a nullable field that is "Off") first becomes the
 * field's default (or `min` when that is null too), whichever way it is pressed.
 */
export function stepField(field, value, dir, values) {
  if (value === null || value === undefined) {
    const d = fieldDefault(field, values);
    return num(d) ? d : num(field.min) ? field.min : 0;
  }
  return stepValue(field, value, dir);
}

/** compactINR, but a crore is a crore (₹10Cr, ₹1.25Cr), not "₹100L". */
const compactRupees = (n) => {
  const v = Math.abs(Number(n) || 0);
  if (v < 10000000) return compactINR(n);
  return `${n < 0 ? '-' : ''}₹${String(Math.round((v / 10000000) * 100) / 100)}Cr`;
};

/** "5" / "3.5": whole seconds without a decimal, one decimal at most. */
const secs = (ms) => {
  const r = Math.round((Number(ms) / 1000) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/**
 * Text for a value: the matching option's label, else formatted by `field.format`:
 * 'inr' (₹15,00,000 / compact ₹15L), 'number' (en-IN grouping), 'seconds' ("60 s"), 'ms' (milliseconds shown as
 * seconds: 5000 -> "5 s"). `null` is "Off" on a nullable field (`nullLabel` renames it), "None" elsewhere.
 */
export function formatValue(field, value, { compact = false, plain = false } = {}) {
  // `plain`: a rupee amount in full ("₹15,00,000", for a screen reader) whatever label a quick pick gives it
  const opt = plain && field.format === 'inr' ? null : fieldOptions(field).find((o) => Object.is(o.value, value));
  if (opt && typeof opt.label === 'string') return opt.label;
  if (field.type === 'toggle') return value ? 'On' : 'Off';
  if (value === null || value === undefined) return field.nullable ? field.nullLabel || 'Off' : 'None';
  if (field.format === 'inr') return compact ? compactRupees(value) : formatINR(value);
  if (field.format === 'number' && num(Number(value))) return Number(value).toLocaleString('en-IN');
  if (field.format === 'seconds' && num(Number(value))) return `${Number(value)} s`;
  if (field.format === 'ms' && num(Number(value))) return `${secs(value)} s`;
  return String(value);
}

/** "₹5L - ₹10Cr" / "15 s - 180 s" / "1 - 3": the legal range of a stepper, for hints. '' without limits. */
export function rangeText(field) {
  if (!field || !num(field.min) || !num(field.max)) return '';
  return `${formatValue({ ...field, options: undefined }, field.min, { compact: true })} - ${formatValue({ ...field, options: undefined }, field.max, { compact: true })}`;
}

// ---- slider geometry ---------------------------------------------------------------------------------------------
// A slider moves over the legal values on the field's grid (position 0 = min, steps = max). A wide range (`scale:
// 'curve'`: max is 20x min or more) bends the track so the low end, where hosts mostly work, is not a few pixels wide.

/** Number of grid steps between min and max (0 when the field has no usable range). */
export function sliderSteps(field) {
  if (!field || !num(field.min) || !num(field.max) || !num(field.step) || field.step <= 0 || field.max <= field.min) return 0;
  return Math.round((field.max - field.min) / field.step);
}

/** Does this field's slider use the bent track? */
export const isCurved = (field) => field.scale === 'curve';

/** Slider position (0..steps) for a value. A null / junk value sits at the default (or the start). */
export function sliderPos(field, value, values) {
  const steps = sliderSteps(field);
  if (!steps) return 0;
  let v = value;
  if (!num(v)) v = fieldDefault(field, values);
  if (!num(v)) v = field.min;
  const idx = Math.max(0, Math.min(steps, Math.round((clampField(field, v) - field.min) / field.step)));
  return isCurved(field) ? Math.round(steps * Math.sqrt(idx / steps)) : idx;
}

/** The value (on the grid, in range) for a slider position: the inverse of `sliderPos`. */
export function sliderValue(field, pos) {
  const steps = sliderSteps(field);
  if (!steps) return field.min;
  const p = Math.max(0, Math.min(steps, Math.round(Number(pos) || 0)));
  const idx = isCurved(field) ? Math.round(steps * (p / steps) ** 2) : p;
  return clampField(field, field.min + idx * field.step);
}

// ---- rule groups, presets, resets ----------------------------------------------------------------------------------

/**
 * Split the lobby fields into the plain ones (no group: the mode) and the rule groups, in the game's group order
 * (`manifest.settingsGroups` = [{ id, label, note? }]). A field naming an unknown group is shown as a plain one; empty
 * groups are dropped. `note` (a string, or `(values) => string`) is the group's one-sentence explainer, see `groupNote`.
 * -> { plain: field[], groups: [{ id, label, note?, fields }] }
 */
export function groupFields(fields, groups) {
  const list = Array.isArray(groups) ? groups.filter((g) => g && typeof g.id === 'string') : [];
  const known = new Set(list.map((g) => g.id));
  const all = Array.isArray(fields) ? fields : [];
  return {
    plain: all.filter((f) => !f.group || !known.has(f.group)),
    groups: list
      .map((g) => ({ id: g.id, label: g.label || g.id, ...(g.note ? { note: g.note } : {}), fields: all.filter((f) => f.group === g.id) }))
      .filter((g) => g.fields.length > 0),
  };
}

/** The explainer line of a rule group for the settings as they are now ('' for none; a broken `note` never throws). */
export function groupNote(group, values) {
  const n = group && group.note;
  if (!n) return '';
  try {
    const text = typeof n === 'function' ? n(values && typeof values === 'object' ? values : {}) : n;
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}

/** The rule fields (the ones that belong to a group) whose value differs from their default for these settings. */
export function changedFields(fields, values) {
  const v = values && typeof values === 'object' ? values : {};
  return (Array.isArray(fields) ? fields : []).filter((f) => f.group && !isDefaultValue(f, v[f.key], v));
}

/** How many rules differ from the defaults: the number in the "Custom rules" badge. */
export const customCount = (fields, values) => changedFields(fields, values).length;

/**
 * The patch that applies a preset (`key` = value, e.g. the mode): the choice itself plus the default of every field
 * that `dependsOn` it. Sending it also on the preset that is already active resets those fields.
 */
export function presetPatch(schema, key, value) {
  const patch = { [key]: value };
  for (const f of schemaFields(schema)) {
    const dep = f.dependsOn;
    if (dep && dep.key === key && dep.defaults && dep.defaults[value] !== undefined) patch[f.key] = dep.defaults[value];
  }
  return patch;
}

/** The patch that puts rules back to their defaults: `keys` (one field) or every rule field when omitted. */
export function resetPatch(fields, values, keys) {
  const patch = {};
  for (const f of Array.isArray(fields) ? fields : []) {
    if (!f.group || (keys && !keys.includes(f.key))) continue;
    patch[f.key] = fieldDefault(f, values);
  }
  return patch;
}

/** Short read-only chips for non-hosts: ["Winning target ₹70k", "Rounds 50", "Dice Lucky", ...]. */
export function settingsChips(schema, raw) {
  const s = resolveSettings(schema, raw);
  return schemaFields(schema).map((f) => {
    if (f.type === 'toggle') return s[f.key] ? f.label : `${f.label}: Off`;
    return `${f.label} ${formatValue(f, s[f.key], { compact: true })}`;
  });
}

/** One line for the lobby: the game's own `summarize(settings)`, or the chips joined when it is missing or throws. */
export function summarizeSettings(game, raw) {
  const settings = raw && typeof raw === 'object' ? raw : {};
  if (game && typeof game.summarize === 'function') {
    try {
      const line = game.summarize(settings);
      if (typeof line === 'string' && line.trim()) return line;
    } catch {
      /* a broken summarize must never break the lobby */
    }
  }
  return settingsChips(lobbyFields(game), settings).join(' · ');
}
