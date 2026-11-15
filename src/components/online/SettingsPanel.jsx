import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createEditSession } from './editSession.js';
import {
  changedFields,
  customCount,
  fieldDefault,
  groupFields,
  groupNote,
  isDefaultValue,
  lobbyFields,
  presetPatch,
  resetPatch,
  resolveSettings,
  settingsChips,
  settingsKey,
  stepField,
  summarizeSettings,
} from './settings.js';
import { SettingField } from './SettingControls.jsx';
import MapPicker from './MapPicker.jsx';
import { MAP_KEY, mapFieldOf, mapIdOf, skinGame } from './mapModel.js';
import { ruleWarnings } from '@shared/ruleSettings.js';
import { compactINR } from '@shared/format.js';
import RulesTourButton from '@/components/tour/RulesTourButton.jsx';
import { CustomBadge, PresetPicker, RuleGroup, RulesReadOnly, isWide, useOpenGroups } from './RulesEditor.jsx';
import '@/styles/online.css';
import '@/styles/x-lobby.css';

export { SettingField };

const STEPPER_DELAY = 450; // ms: batch rapid +/- taps into one message
const SLIDER_DELAY = 250; // ms: a slider drag sends when it rests this long (or the moment it is let go)

/**
 * The room's game settings, rendered from the game's `manifest.settings` schema, narrowed to the keys in its optional
 * `manifest.lobbySettings` (the rest keep their defaults and are never shown; no field = every setting).
 *  - host: one control per shown field (segmented / stepper / toggle)
 *  - everyone else: `game.summarize(settings)` (read-only)
 * Both see the game's optional `tableRules` string as one small muted line.
 * A game that lists `settingsGroups` and puts fields in them (`field.group`) gets the full "Game rules" editor instead:
 * the plain fields (the mode) as preset cards, then the groups as collapsible sections with a slider / chips / switch
 * per rule, a reset per rule and for all of them, and a "Custom rules" badge. Everyone else sees the same list read-only.
 * Props: `game` (manifest or null), `settings` (= room.settings), `isHost`, `disabled`,
 * `onSend(msg)` sends the FULL `{t:'settings', settings}` (hidden fields included, at their current values),
 * `errorId` / `error` (rolls the optimistic UI back when the server rejects a change, and says why).
 * A panel with a single shown field has no heading of its own: the field's label is the title.
 */
export default function SettingsPanel({ game: baseGame, settings, isHost, disabled, onSend, errorId, error }) {
  // the copy speaks the words of the room's map ("Festival tokens" on Andhra Aatalu); the default map keeps the manifest as it is
  const mapId = mapIdOf(settings);
  const game = useMemo(() => skinGame(baseGame, mapId), [baseGame, mapId]);
  const schema = game && game.settings;
  const fields = useMemo(() => lobbyFields(game), [game]);
  const layout = useMemo(() => groupFields(fields, game && game.settingsGroups), [fields, game]);
  const ruled = layout.groups.length > 0;
  const mapField = useMemo(() => mapFieldOf(schema), [schema]); // the map is its own picker (cards), never a plain field or a rule
  const solo = fields.length === 1;
  const server = useMemo(() => resolveSettings(schema, settings), [schema, settings]);
  const serverKey = settingsKey(schema, settings);
  const sendRef = useRef(onSend);
  sendRef.current = onSend;
  const errorRef = useRef(error);
  errorRef.current = error;
  const serverRef = useRef(server);
  serverRef.current = server;

  // the optimistic draft, the debounced sends and the server's refusal live in one small session (editSession.js)
  const [session] = useState(() => createEditSession({ send: (msg) => sendRef.current(msg) }));
  const { draft, inline } = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  useEffect(() => session.dispose, [session]);
  // the server answered: the draft is dropped once every message we sent has been answered
  useEffect(() => {
    session.echo();
  }, [serverKey, session]);
  // the server refused something: roll back to what it says, and say why next to the field we touched
  useEffect(() => {
    if (errorId) session.reject(errorRef.current);
  }, [errorId, session]);

  const fire = session.fire; // the waiting message goes out now (a slider let go)
  const cur = () => session.current(serverRef.current); // the settings as the host sees them right now
  const commit = useCallback((patch, delay = 0, key = null) => session.commit({ schema, server: serverRef.current, patch, delay, key }), [session, schema]);

  const eff = draft || server;
  const rules = game && typeof game.tableRules === 'string' && game.tableRules ? (
    <p className="ho-rules">
      <span>Table rules</span> {game.tableRules}
    </p>
  ) : null;

  const mapPicker = mapField ? (
    <MapPicker value={eff[MAP_KEY]} isHost={isHost} disabled={disabled} onPick={(patch) => commit(patch, 0, MAP_KEY)} helpText={isHost ? mapField.help : undefined} />
  ) : null;

  const [open, toggle, setOpen] = useOpenGroups(layout.groups);
  const [showAll, setShowAll] = useState(isWide);
  const listId = useId();

  if (ruled) {
    const count = customCount(fields, eff);
    const summary = summarizeSettings(game, eff);

    if (!isHost) {
      return (
        <section className="ho-card ho-settings xl-rules" aria-label="Game settings">
          <div className="ho-card__head">
            <h2 className="ho-h2">Game rules</h2>
            <span className="ho-muted">Set by the host</span>
          </div>
          {mapPicker}
          <p className="ho-summary" aria-live="polite">
            {summary || 'The host has not changed anything yet.'}
          </p>
          <div className="xl-rules__bar">
            <CustomBadge count={count} />
            {count === 0 && <span className="ho-muted">Nothing changed from the preset</span>}
            <button type="button" className="xl-rules__toggle" aria-expanded={showAll} aria-controls={`${listId}-ro`} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Hide all rules' : 'Show all rules'}
            </button>
          </div>
          <div id={`${listId}-ro`} hidden={!showAll}>
            <RulesReadOnly groups={layout.groups} values={eff} schema={schema} notes={Object.fromEntries(layout.groups.map((g) => [g.id, groupNote(g, eff)]))} />
          </div>
          {rules}
        </section>
      );
    }

    const modeField = layout.plain.find((f) => f.type === 'segmented' && Array.isArray(f.options) && f.options.some((o) => o && o.hint));
    const resets = modeField ? fields.filter((f) => f.dependsOn && f.dependsOn.key === modeField.key).map((f) => f.label) : [];
    const rulesChanged = changedFields(fields, eff).length > 0;
    const allOpen = layout.groups.every((g) => open[g.id]);
    const ruleKeys = new Set(layout.groups.flatMap((g) => g.fields.map((f) => f.key)));

    return (
      <section className="ho-card ho-settings xl-rules is-host" aria-label="Game settings" data-tour="lobby-rules-host">
        <div className="ho-card__head">
          <h2 className="ho-h2">Game rules</h2>
          <span className="ho-muted">You are the host</span>
        </div>

        {mapPicker}

        {layout.plain.map((f) =>
          f === modeField ? (
            <PresetPicker
              key={f.key}
              field={f}
              value={eff[f.key]}
              disabled={disabled}
              resets={resets}
              onPick={(v) => commit(presetPatch(schema, f.key, v), 0, f.key)}
            />
          ) : (
            <SettingField key={f.key} field={f} value={eff[f.key]} values={eff} disabled={disabled} onChange={(v) => commit({ [f.key]: v }, 0, f.key)} onStep={(dir) => commit({ [f.key]: stepField(f, cur()[f.key], dir, cur()) }, STEPPER_DELAY, f.key)} />
          ),
        )}

        <div className="xl-rules__bar" data-tour="lobby-rules-bar">
          <CustomBadge count={count} />
          {count === 0 && <span className="ho-muted">Nothing changed from the defaults</span>}
          <button type="button" className="xl-rules__reset" onClick={() => commit(resetPatch(fields, cur()), 0, null)} disabled={disabled || !rulesChanged}>
            Reset all to defaults
          </button>
          <button type="button" className="xl-rules__toggle" onClick={() => setOpen(Object.fromEntries(layout.groups.map((g) => [g.id, !allOpen])))}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
          <RulesTourButton />
        </div>

        <p className="ho-summary" aria-live="polite">
          {summary}
        </p>
        {ruleWarnings(eff, eff.mode, compactINR).map((w) => (
          <p key={w.key} className="xl-warn" role="status">
            <span aria-hidden="true">!</span> {w.text}
          </p>
        ))}
        {inline && !ruleKeys.has(inline.key) && (
          <p className="ho-inline-error" role="alert">
            {inline.text}
          </p>
        )}

        <div className="xl-groups">
          {layout.groups.map((g) => (
            <RuleGroup key={g.id} group={g} note={groupNote(g, eff)} count={changedFields(g.fields, eff).length} open={!!open[g.id]} onToggle={() => toggle(g.id)}>
              {g.fields.map((f) => (
                <SettingField
                  key={f.key}
                  field={f}
                  rule
                  value={eff[f.key]}
                  values={eff}
                  disabled={disabled}
                  modified={!isDefaultValue(f, eff[f.key], eff)}
                  error={inline && inline.key === f.key ? inline.text : undefined}
                  onChange={(v, opts) => commit({ [f.key]: v }, opts && opts.drag ? SLIDER_DELAY : 0, f.key)}
                  onStep={(dir) => commit({ [f.key]: stepField(f, cur()[f.key], dir, cur()) }, STEPPER_DELAY, f.key)}
                  onRelease={fire}
                  onReset={() => commit({ [f.key]: fieldDefault(f, cur()) }, 0, f.key)}
                />
              ))}
            </RuleGroup>
          ))}
        </div>
        {rules}
      </section>
    );
  }

  if (!isHost) {
    const chips = solo ? [] : settingsChips(fields, settings);
    return (
      <section className="ho-card ho-settings" aria-label="Game settings">
        {solo ? (
          <div className="ho-card__head">
            <div className="ho-field__label">{fields[0].label}</div>
            <span className="ho-muted">Set by the host</span>
          </div>
        ) : (
          <div className="ho-card__head">
            <h2 className="ho-h2">Game settings</h2>
            <span className="ho-muted">Set by the host</span>
          </div>
        )}
        {mapPicker}
        <p className="ho-summary" aria-live="polite">
          {summarizeSettings(game, settings) || 'The host has not changed anything yet.'}
        </p>
        {chips.length > 0 && (
          <ul className="ho-chiprow" aria-label="Settings summary">
            {chips.map((c) => (
              <li key={c} className="ho-chip ho-chip--static">
                {c}
              </li>
            ))}
          </ul>
        )}
        {rules}
      </section>
    );
  }

  return (
    <section className="ho-card ho-settings" aria-label="Game settings">
      {!solo && (
        <div className="ho-card__head">
          <h2 className="ho-h2">Game settings</h2>
          <span className="ho-muted">You are the host</span>
        </div>
      )}

      {mapPicker}

      {fields.map((f) => (
        <SettingField
          key={f.key}
          field={f}
          value={eff[f.key]}
          values={eff}
          disabled={disabled}
          hideHelp={solo} // the summary line below already says it
          onChange={(v) => commit({ [f.key]: v }, 0, f.key)}
          onStep={(dir) => commit({ [f.key]: stepField(f, cur()[f.key], dir, cur()) }, STEPPER_DELAY, f.key)}
        />
      ))}

      {fields.length > 0 && (
        <p className="ho-summary" aria-live="polite">
          {summarizeSettings(game, eff)}
        </p>
      )}
      {inline && (
        <p className="ho-inline-error" role="alert">
          {inline.text}
        </p>
      )}
      {rules}
    </section>
  );
}
