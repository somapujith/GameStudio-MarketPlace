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
  const fields = schemaFields(game && game.settings);
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
    if (v === undefined) out[f.key] = f.default;
    else if (f.type === 'toggle') out[f.key] = typeof v === 'boolean' ? v : f.default;
    else if (f.type === 'stepper') out[f.key] = typeof v === 'number' ? clampField(f, v) : f.default;
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

/** Text for a value: the matching option's label, else formatted by `field.format`. */
export function formatValue(field, value, { compact = false } = {}) {
  const opt = fieldOptions(field).find((o) => Object.is(o.value, value));
  if (opt && typeof opt.label === 'string') return opt.label;
  if (field.type === 'toggle') return value ? 'On' : 'Off';
  if (value === null || value === undefined) return 'None';
  if (field.format === 'inr') return compact ? compactINR(value) : formatINR(value);
  if (field.format === 'number' && num(Number(value))) return Number(value).toLocaleString('en-IN');
  return String(value);
}

/** Short read-only chips for non-hosts: ["Winning target ₹70k", "Rounds 50", "Auction skipped properties", ...]. */
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
