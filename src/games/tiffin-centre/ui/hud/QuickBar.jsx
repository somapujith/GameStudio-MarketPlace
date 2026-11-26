// Small buttons under the left thumb: subtitle style, look straight ahead (only drawn while your head is turned) and the controls help. The customer voices
// switch lives in the pause menu (Customers talk), with the language and the robot voices: one fewer thing in the corner of the picture.
import HudIcon from './HudIcon.jsx';
import { KEY_HELP } from './look.js';
import { SUB_OPTIONS, nextOption } from './prefs.js';

export function QuickBar({ prefs, onPrefs, turned, onRecentre, helpOpen, onHelp }) {
  const subLabel = SUB_OPTIONS.find((o) => o.id === prefs.subs)?.label || 'Subtitles';
  return (
    <div className="tc-hud-quick" role="group" aria-label="View and speech">
      <button
        type="button"
        className="tc-hud-btn tc-hud-btn--sm"
        aria-label={`Subtitles: ${subLabel}. Press to change`}
        title={`Subtitles: ${subLabel}`}
        onClick={() => onPrefs({ subs: nextOption(SUB_OPTIONS, prefs.subs) })}
      >
        <HudIcon name="cc" size={20} />
      </button>
      <button
        type="button"
        className="tc-hud-btn tc-hud-btn--sm"
        aria-label="Look straight ahead (V)"
        title="Look straight ahead (V)"
        data-show={turned ? '1' : '0'}
        aria-keyshortcuts="V"
        onClick={onRecentre}
      >
        <HudIcon name="target" size={20} />
      </button>
      <button type="button" className="tc-hud-btn tc-hud-btn--sm" aria-label="Controls help (?)" aria-expanded={!!helpOpen} aria-keyshortcuts="?" title="Controls help (?)" onClick={onHelp}>
        <HudIcon name="help" size={20} />
      </button>
    </div>
  );
}

/** The printed controls (keyboard and touch), one scheme everywhere: the pause menu shows the same list. */
export function ControlsList({ touch = false }) {
  const rows = touch ? KEY_HELP.touch : KEY_HELP.keyboard;
  return (
    <dl className="tc-hud-keys">
      {rows.map((r) => (
        <div key={r.what}>
          <dt>
            {r.keys.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </dt>
          <dd>{r.what}</dd>
        </div>
      ))}
    </dl>
  );
}

export function HelpCard({ touch, onClose }) {
  return (
    <aside className="tc-hud-help" role="dialog" aria-label="Controls" aria-modal="false">
      <header>
        <b>How to play</b>
        <button type="button" className="tc-hud-btn tc-hud-btn--sm" onClick={onClose} aria-label="Close help (Esc)">
          <HudIcon name="close" size={18} />
        </button>
      </header>
      <ControlsList touch={touch} />
      {!touch && <p className="tc-hud-help-note">On a touch screen: tap to work, drag empty space to look around.</p>}
      {touch && <p className="tc-hud-help-note">With a keyboard: A / D walk, Space or E works, Z / X look around.</p>}
    </aside>
  );
}
