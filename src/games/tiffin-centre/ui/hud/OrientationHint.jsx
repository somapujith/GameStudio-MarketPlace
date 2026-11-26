// A gentle, one-time tip on a phone held upright: landscape shows a wider stall. It never blocks play and never repeats once dismissed.
import HudIcon from './HudIcon.jsx';

export default function OrientationHint({ onDismiss }) {
  return (
    <div className="tc-hud-hint" role="note" aria-label="Tip">
      <HudIcon name="rotate" size={22} />
      <p>Tip: turn your phone sideways for a wider view of the stall. Playing upright works too.</p>
      <button type="button" className="tc-hud-hint-x" onClick={onDismiss}>
        Got it
      </button>
    </div>
  );
}
