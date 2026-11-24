import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createEditSession } from './editSession.js';
import {
  changedFields,
  customCount,
  fieldDefault,
  formatValue,
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
import Modal from '@/components/shell/Modal.jsx';
import '@/styles/online.css';
import '@/styles/x-lobby.css';
import '@/styles/lobby-rules.css';
import '@/styles/cine/rules-dialog.css';

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

function PenIcon() {
  return (
    <svg className="lr-pen" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg className="lr-pen" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * What is selected, at a glance, for the card (the dialog holds the full editor): the rules that differ from the
 * defaults first (marked), then the first rules of the list, six in all. Derived from the schema, nothing hardcoded.
 */
export function rulePreview(groups, values, max = 6) {
  const all = groups.flatMap((g) => g.fields.map((f) => ({ f, custom: !isDefaultValue(f, values[f.key], values) })));
  const picked = [...all.filter((r) => r.custom), ...all.filter((r) => !r.custom)].slice(0, max);
  return {
    items: picked.map(({ f, custom }) => ({ key: f.key, label: f.label, value: formatValue(f, values[f.key], { compact: true }), custom })),
    total: all.length,
    custom: all.filter((r) => r.custom).length,
  };
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
    const preview = rulePreview(layout.groups, eff);
    const rootClass = `ho-card ho-settings xl-rules lr lr-rules${isHost ? ' is-host' : ''}${expanded ? ' is-expanded' : ''}${instant ? ' is-instant' : ''}`;
    const head = (
      <>
        <div className="ho-card__head lr-head">
          <div className="lr-head__titles">
            <span className="st-eyebrow">{isHost ? 'You are the host' : 'Set by the host'}</span>
            <h2 className="ho-h2">Game rules</h2>
          </div>
          <button type="button" className="lr-toggle" aria-haspopup="dialog" aria-expanded={expanded} onClick={() => setExpanded(true)}>
            {isHost ? <PenIcon /> : <EyeIcon />}
            <span>{isHost ? 'Edit rules' : 'View rules'}</span>
          </button>
        </div>
        <ul className="lr-chips" aria-hidden="true">
          {chips.map((c) => (
            <li key={c.key} className={`lr-chip${c.kind ? ` lr-chip--${c.kind}` : ''}`}>
              {c.text}
            </li>
          ))}
        </ul>
        {preview.items.length > 0 && (
          <div className="lr-preview">
            <dl className="lr-preview__grid" aria-label="Selected rules">
              {preview.items.map((r) => (
                <div key={r.key} className={`lr-preview__row${r.custom ? ' is-custom' : ''}`}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className="lr-preview__foot">
              {preview.custom > 0 ? `${preview.custom} custom ${preview.custom === 1 ? 'rule' : 'rules'}` : 'Standard rules'}
              {preview.total > preview.items.length ? ` · ${preview.total - preview.items.length} more inside` : ''}
            </p>
          </div>
        )}
        <p className="lr-sr" aria-live="polite">
          {summary || 'The host has not changed anything yet.'}
        </p>
      </>
    );

    // The editor lives in a dialog: the shared glass Modal (portal, focus trap, Esc, scroll lock). It is wrapped in the
    // lobby's own scope so the controls keep the lobby skin. A server render (tests) has no document to portal into:
    // the content then stays in the page, hidden, so it can still be read.
    const closeDialog = () => setExpanded(false);
    const dialog = (body) =>
      typeof document === 'undefined' ? (
        <div className="cj-rules-dialog" role="group" aria-label="Game rules" hidden>
          <div className="cj-lobby-main cj-lobby-main--dialog">{body}</div>
        </div>
      ) : (
        <Modal
          open={expanded}
          onClose={closeDialog}
          title={isHost ? 'Edit game rules' : 'Game rules'}
          className="cj-rules-modal"
          actions={
            <button type="button" className="hub-btn hub-btn--primary" onClick={closeDialog}>
              Done
            </button>
          }
        >
          <div className="cj-rules-dialog">
            <div className="cj-lobby-main cj-lobby-main--dialog">{body}</div>
          </div>
        </Modal>
      );

    if (!isHost) {
      return (
        <section className={rootClass} aria-label="Game settings">
          {head}
          {dialog(
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
            </div>,
          )}
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
        {dialog(
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
          </div>,
        )}
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
