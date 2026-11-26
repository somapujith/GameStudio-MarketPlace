// OWNER: sound agent. The little radio widget: a round power button (also the R key), and while it plays: previous / next station,
// the station name in English + Telugu, and the "now playing" track with a tiny equaliser. Props: { game, snap }.
// Reads snap.radio { station, name, te, on, color, track, count }; talks to game.ctx.sound.radio (cycle/set/next/prev/toggle).
import { useHudLayout } from './hud/useHudLayout.js';
import './radio.css';

function RadioIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <rect x="2.5" y="8" width="19" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 8 L17 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8" cy="14" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13.5 12.2h5M13.5 15.8h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const Chevron = ({ dir }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path d={dir < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// The controls themselves. `inline` = inside the phone HUD's More sheet (no floating position); otherwise the floating desktop widget.
export function RadioControls({ game, snap, inline = false }) {
  const api = game?.ctx?.sound?.radio;
  const r = snap?.radio;
  if (!api || !r) return null;
  const on = !!r.on;
  return (
    <div className={`aw-radio${inline ? ' aw-radio--inline' : ''}${on ? ' is-on' : ''}`} style={{ '--aw-radio-c': r.color || '#ffc857' }} role="group" aria-label="Radio">
      <button type="button" className="aw-radio-pw" onClick={() => api.toggle()} aria-pressed={on} aria-label={on ? 'Turn the radio off' : 'Turn the radio on'} title="Radio (R)">
        <RadioIcon />
        <kbd className="aw-radio-key">R</kbd>
      </button>
      {on && (
        <>
          <button type="button" className="aw-radio-step" onClick={() => api.prev()} aria-label="Previous station">
            <Chevron dir={-1} />
          </button>
          <div className="aw-radio-info" role="status" aria-live="polite">
            <span className="aw-radio-name">
              {r.name} <span className="aw-radio-te" lang="te">{r.te}</span>
            </span>
            <span className="aw-radio-track">
              <span className="aw-radio-eq" aria-hidden="true"><i /><i /><i /><i /></span>
              <span className="aw-radio-title">{r.track}</span>
            </span>
          </div>
          <button type="button" className="aw-radio-step" onClick={() => api.next()} aria-label="Next station">
            <Chevron dir={1} />
          </button>
        </>
      )}
    </div>
  );
}

// The floating widget (desktop). On phones and tablets the radio lives in the HUD's More sheet instead (see hud/Compact.jsx).
export default function Radio({ game, snap }) {
  const layout = useHudLayout();
  if (layout.compact || snap?.menu) return null;
  return <RadioControls game={game} snap={snap} />;
}
