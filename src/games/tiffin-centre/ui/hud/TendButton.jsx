// The Tend button of a pan or steamer: a tiny thermometer (heat band cold / ok / hot, or the steamer's water), a gunk strip, the verb
// (Wipe / Skim / Top up) and one word of state ("Cold pan", "Needs wiping", "Dry!"). It pulses while the need is above 0.6. 44 px target.
// `view` is tendView(state, id); `onTend(view)` does the walking and the work (HudLayer). Used by StationsDock `renderExtra` and by the action sheet.
import HudIcon from './HudIcon.jsx';

const ICON = { Wipe: 'wipe', Skim: 'wipe', 'Top up': 'drop' };

export function Gauge({ view }) {
  const g = view.gauge;
  return (
    <span className="tc-hud-gauge" data-kind={view.kind} aria-hidden="true" style={{ '--at': g.at.toFixed(3), '--lo': g.lo.toFixed(3), '--hi': g.hi.toFixed(3), '--gunk': view.gunk.toFixed(3) }}>
      <i className="tc-hud-gauge-band" />
      <i className="tc-hud-gauge-at" />
      <i className="tc-hud-gauge-gunk" />
    </span>
  );
}

export default function TendButton({ view, onTend, spotOn = false, walkOn = false, variant = 'dock' }) {
  if (!view) return null;
  return (
    <button
      type="button"
      className={`tc-hud-tendbtn is-tend is-${variant}${view.pulse ? ' is-pulse' : ''}${spotOn ? ' is-spot' : ''}${walkOn ? ' is-walking' : ''}`}
      data-tone={view.tone}
      data-band={view.band}
      data-spot={`tend:${view.id}`}
      data-station={view.id}
      aria-label={view.aria}
      aria-disabled={view.canTend ? undefined : 'true'}
      aria-keyshortcuts="T"
      title={`${view.verb}: ${view.text}`}
      onClick={() => onTend(view)}
    >
      <Gauge view={view} />
      <HudIcon name={ICON[view.verb] || 'wipe'} size={18} />
      <span className="tc-hud-tend-txt">
        <b>{view.verb}</b>
        <small>{view.text}</small>
      </span>
    </button>
  );
}
