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
import { MAP_KEY, mapFieldOf, mapIdOf, mapInfo, skinGame } from './mapModel.js';
import { ruleWarnings } from '@shared/ruleSettings.js';
import { compactINR } from '@shared/format.js';
import RulesTourButton from '@/components/tour/RulesTourButton.jsx';
import { onStartTour } from '@/components/tour/tourEvents.js';
import { LOBBY_GUEST_TOUR_ID, LOBBY_HOST_TOUR_ID, LOBBY_RULES_TOUR_ID } from '@/components/tour/steps/lobbySteps.js';
import { CustomBadge, PresetPicker, RuleGroup, RulesReadOnly, useOpenGroups } from './RulesEditor.jsx';
import '@/styles/online.css';
import '@/styles/x-lobby.css';
import '@/styles/lobby-rules.css';

export { SettingField };

const STEPPER_DELAY = 450; // ms: batch rapid +/- taps into one message
const SLIDER_DELAY = 250; // ms: a slider drag sends when it rests this long (or the moment it is let go)

function Chevron() {
  return (
    <svg className="lr-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * A region that opens and closes smoothly. The content stays in the page (a grid row going 0fr -> 1fr, plus a fade and a
 * little slide) and is `inert` while shut, so nothing in it can be tabbed to or heard.
 */
function Fold({ id, open, children }) {
  return (
    <div id={id} className={`lr-fold${open ? ' is-open' : ''}`} inert={!open}>
      <div className="lr-fold__in">
        <div className="lr-fold__pad">{children}</div>
      </div>
    </div>
  );
}

/** The one-line summary as chips: the map, then the game's own `summarize()` line split at its " · " (derived, not hardcoded). */
function ruleChips(game, values, mapField) {
  const chips = [];
  const mapName = mapField ? mapInfo(values).name : '';
  const parts = summarizeSettings(game, values)
    .split(' · ')
    .map((p) => p.trim())
    .filter(Boolean);
  // the game's own line may already lead with the map (a map that is not the home one): never show it twice
  if (mapName && parts[0] !== mapName) chips.push({ key: 'map', text: mapName, kind: 'map' });
  for (const [i, text] of parts.entries()) {
    const kind = text === mapName ? 'map' : /^custom rules/i.test(text) ? 'custom' : '';
    chips.push({ key: `${i}:${text}`, text, kind });
  }
  if (chips.length === 0) chips.push({ key: 'default', text: 'Default rules', kind: '' });
  return chips;
}

/**
 * The room's game settings, rendered from the game's `manifest.settings` schema, narrowed to the keys in its optional
 * `manifest.lobbySettings` (the rest keep their defaults and are never shown; no field = every setting).
 *  - host: one control per shown field (segmented / stepper / toggle)
 *  - everyone else: `game.summarize(settings)` (read-only)
 * Both see the game's optional `tableRules` string as one small muted line.
 * A game that lists `settingsGroups` and puts fields in them (`field.group`) gets the "Game rules" card: one calm card
 * that is collapsed by default to a line of chips (map, mode, the headline numbers) and an "Edit rules" (host) /
 * "View rules" (everyone else) button. Opened, it shows the map and the presets first; the long list of rules sits
 * behind a second "More rules" button (a slider / chips / switch per rule, a reset per rule and for all of them, and a
 * "Custom rules" badge). Everyone else sees the same list read-only.
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
  const [expanded, setExpanded] = useState(false); // the card: chips only (false) or the map + presets (true)
  const [more, setMore] = useState(false); // the long list of rules
  const [instant, setInstant] = useState(false); // a tour is pointing at things in here: open without the slide
  const listId = useId();
  const groupIds = layout.groups.map((g) => g.id).join('|');
  const ruleKeys = new Set(layout.groups.flatMap((g) => g.fields.map((f) => f.key)));

  // a lobby tour needs what it points at on screen: open the card (and the rules, for the host) the moment it starts
  useEffect(() => {
    if (!ruled) return undefined;
    const reveal = (all) => {
      setInstant(true);
      setExpanded(true);
      if (all) {
        setMore(true);
        setOpen(Object.fromEntries(groupIds.split('|').map((id) => [id, true])));
      }
    };
    const offs = [onStartTour(LOBBY_HOST_TOUR_ID, () => reveal(true)), onStartTour(LOBBY_RULES_TOUR_ID, () => reveal(true)), onStartTour(LOBBY_GUEST_TOUR_ID, () => reveal(false))];
    let watch = null;
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      // a first-visit tour starts by itself: its layer is added straight to <body>
      watch = new MutationObserver((records) => {
        for (const r of records)
          for (const n of r.addedNodes) {
            const id = n.nodeType === 1 && n.getAttribute ? n.getAttribute('data-tour-id') : null;
            if (id === LOBBY_HOST_TOUR_ID || id === LOBBY_RULES_TOUR_ID) reveal(true);
            else if (id === LOBBY_GUEST_TOUR_ID) reveal(false);
          }
      });
      watch.observe(document.body, { childList: true });
    }
    return () => {
      offs.forEach((off) => off());
      if (watch) watch.disconnect();
    };
  }, [ruled, groupIds, setOpen]);

  // a refused edit must be seen: open what it belongs to
  useEffect(() => {
    if (!inline) return;
    setExpanded(true);
    if (ruleKeys.has(inline.key)) setMore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline]);

  if (ruled) {
    const count = customCount(fields, eff);
    const summary = summarizeSettings(game, eff);
    const chips = ruleChips(game, eff, mapField);
    const rootClass = `ho-card ho-settings xl-rules lr lr-rules${isHost ? ' is-host' : ''}${expanded ? ' is-expanded' : ''}${instant ? ' is-instant' : ''}`;
    const head = (
      <>
        <div className="ho-card__head lr-head">
          <div className="lr-head__titles">
            <span className="st-eyebrow">{isHost ? 'You are the host' : 'Set by the host'}</span>
            <h2 className="ho-h2">Game rules</h2>
          </div>
          <button type="button" className="lr-toggle" aria-expanded={expanded} aria-controls={`${listId}-card`} onClick={() => setExpanded((v) => !v)}>
            <span>{isHost ? 'Edit rules' : 'View rules'}</span>
            <Chevron />
          </button>
        </div>
        <ul className="lr-chips" aria-hidden="true">
          {chips.map((c) => (
            <li key={c.key} className={`lr-chip${c.kind ? ` lr-chip--${c.kind}` : ''}`}>
              {c.text}
            </li>
          ))}
        </ul>
        <p className="lr-sr" aria-live="polite">
          {summary || 'The host has not changed anything yet.'}
        </p>
      </>
    );

    if (!isHost) {
      return (
        <section className={rootClass} aria-label="Game settings">
          {head}
          <Fold id={`${listId}-card`} open={expanded}>
            <div className="lr-body">
              {mapPicker}
              <div className="xl-rules__bar">
                <CustomBadge count={count} />
                {count === 0 && <span className="ho-muted">Nothing changed from the preset</span>}
              </div>
              <button type="button" className={`lr-more${more ? ' is-open' : ''}`} aria-expanded={more} aria-controls={`${listId}-ro`} onClick={() => setMore((v) => !v)}>
                <span className="lr-more__title">{more ? 'Hide all rules' : 'Show all rules'}</span>
                <Chevron />
              </button>
              <Fold id={`${listId}-ro`} open={more}>
                <RulesReadOnly groups={layout.groups} values={eff} schema={schema} notes={Object.fromEntries(layout.groups.map((g) => [g.id, groupNote(g, eff)]))} />
              </Fold>
              {rules}
            </div>
          </Fold>
        </section>
      );
    }

    const modeField = layout.plain.find((f) => f.type === 'segmented' && Array.isArray(f.options) && f.options.some((o) => o && o.hint));
    const resets = modeField ? fields.filter((f) => f.dependsOn && f.dependsOn.key === modeField.key).map((f) => f.label) : [];
    const rulesChanged = changedFields(fields, eff).length > 0;
    const allOpen = layout.groups.every((g) => open[g.id]);

    return (
      <section className={rootClass} aria-label="Game settings" data-tour="lobby-rules-host">
        {head}
        <Fold id={`${listId}-card`} open={expanded}>
          <div className="lr-body">
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
              <RulesTourButton />
            </div>

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

            <button type="button" className={`lr-more${more ? ' is-open' : ''}`} aria-expanded={more} aria-controls={`${listId}-more`} onClick={() => setMore((v) => !v)}>
              <span className="lr-more__title">More rules</span>
              {rulesChanged && <span className="lr-more__count">{changedFields(fields, eff).length} changed</span>}
              <Chevron />
            </button>
            <Fold id={`${listId}-more`} open={more}>
              <div className="lr-more__bar">
                <button type="button" className="xl-rules__toggle" onClick={() => setOpen(Object.fromEntries(layout.groups.map((g) => [g.id, !allOpen])))}>
                  {allOpen ? 'Collapse all' : 'Expand all'}
                </button>
              </div>
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
            </Fold>
            {rules}
          </div>
        </Fold>
      </section>
    );
  }

  if (!isHost) {
    const chips = solo ? [] : settingsChips(fields, settings);
    return (
      <section className="ho-card ho-settings lr lr-simple" aria-label="Game settings">
        {solo ? (
          <div className="ho-card__head lr-head">
            <div className="ho-field__label">{fields[0].label}</div>
            <span className="ho-muted">Set by the host</span>
          </div>
        ) : (
          <div className="ho-card__head lr-head">
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
    <section className="ho-card ho-settings lr lr-simple" aria-label="Game settings">
      {!solo && (
        <div className="ho-card__head lr-head">
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
