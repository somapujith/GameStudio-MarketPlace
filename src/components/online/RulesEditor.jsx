import { useId, useState } from 'react';
import { fieldDefault, formatValue, isDefaultValue, schemaFields } from './settings.js';
import { customRulesSpoken } from './lobbyModel.js';
import '@/styles/online.css';
import '@/styles/x-lobby.css';

// The pieces of the lobby "Game rules" editor around the schema fields: the preset cards, the collapsible rule groups,
// the "Custom rules" badge and the read-only list everybody else sees. Pure presentation: SettingsPanel owns the state.

/** Phones get one open group at a time-ish (the first), a wide screen shows every group. SSR / tests: the phone layout. */
export function isWide() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 720px)').matches;
}

/** "Custom rules 3": nothing at 0. `quiet` = a plain inline mention instead of the filled badge. */
export function CustomBadge({ count, quiet = false }) {
  if (!(count > 0)) return null;
  return (
    <span className={`xl-custom${quiet ? ' is-quiet' : ''}`} role="status" aria-label={customRulesSpoken(count)}>
      <span aria-hidden="true">Custom rules</span>
      <b aria-hidden="true">{count}</b>
    </span>
  );
}

/**
 * The game's presets (a segmented field whose options carry a `hint`) as cards. Picking one sends the preset patch,
 * also for the one already chosen: that resets the fields that follow the preset. `resets` names those fields.
 */
export function PresetPicker({ field, value, onPick, disabled, resets = [] }) {
  const id = useId();
  const options = Array.isArray(field.options) ? field.options : [];
  return (
    <div className="ho-field xl-presets">
      <div className="ho-field__label" id={`${id}-l`}>
        {field.label}
      </div>
      <div role="radiogroup" aria-labelledby={`${id}-l`} className="xl-presets__row">
        {options.map((o) => {
          const on = Object.is(o.value, value);
          return (
            <button key={String(o.value)} type="button" role="radio" aria-checked={on} className={`xl-preset${on ? ' is-on' : ''}`} onClick={() => onPick(o.value)} disabled={disabled}>
              <span className="xl-preset__name">{o.label}</span>
              {o.hint && <span className="xl-preset__hint">{o.hint}</span>}
            </button>
          );
        })}
      </div>
      {resets.length > 0 && <p className="ho-help">A preset sets {resets.join(', ').replace(/, ([^,]*)$/, ' and $1').toLowerCase()} to its own defaults; every other rule stays as you set it.</p>}
    </div>
  );
}

/**
 * One collapsible group of rules: a header button (aria-expanded) and a body that stays in the page, hidden when closed.
 * `note` is the group's one-sentence explainer (e.g. what the Snatch numbers mean), shown above its rules.
 */
export function RuleGroup({ group, count = 0, open, onToggle, note = '', children }) {
  const id = useId();
  return (
    <section className={`xl-group${open ? ' is-open' : ''}`} aria-labelledby={`${id}-h`}>
      <h3 className="xl-group__h" id={`${id}-h`}>
        <button type="button" className="xl-group__btn" aria-expanded={open} aria-controls={`${id}-b`} onClick={onToggle}>
          <span className="xl-group__title">{group.label}</span>
          {count > 0 && <span className="xl-group__count">{count} changed</span>}
          <svg className="xl-group__chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h3>
      <div className="xl-group__body" id={`${id}-b`} hidden={!open}>
        {note && <p className="xl-group__note">{note}</p>}
        {children}
      </div>
    </section>
  );
}

/** What everybody but the host sees: every rule as a row, the changed ones highlighted with their default beside them. */
export function RulesReadOnly({ groups, values, schema, notes = {} }) {
  const known = new Set(schemaFields(schema).map((f) => f.key));
  return (
    <div className="xl-ro">
      {groups.map((g) => (
        <section key={g.id} className="xl-ro__group" aria-label={g.label}>
          <h3 className="xl-ro__h">{g.label}</h3>
          {notes[g.id] && <p className="xl-ro__note">{notes[g.id]}</p>}
          <dl className="xl-ro__list">
            {g.fields
              .filter((f) => known.has(f.key))
              .map((f) => {
                const changed = !isDefaultValue(f, values[f.key], values);
                return (
                  <div key={f.key} className={`xl-ro__row${changed ? ' is-changed' : ''}`}>
                    <dt>{f.label}</dt>
                    <dd>
                      <b>{formatValue(f, values[f.key], { compact: true })}</b>
                      {changed && <small>Default {formatValue(f, fieldDefault(f, values), { compact: true })}</small>}
                    </dd>
                  </div>
                );
              })}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** Open / closed per group id. `all` opens every group (a wide screen), else only the first. */
export function useOpenGroups(groups) {
  const [open, setOpen] = useState(() => {
    const wide = isWide();
    return Object.fromEntries(groups.map((g, i) => [g.id, wide || i === 0]));
  });
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  return [open, toggle, setOpen];
}
