// Chalk / tin notices for key moments. The visual stack is aria-hidden; one polite live region announces every notice once.
import HudIcon from './HudIcon.jsx';

export default function Toasts({ toasts, live }) {
  return (
    <>
      <ul className="tc-hud-toasts" aria-hidden="true">
        {toasts.map((t) => (
          <li key={t.id} className={`tc-hud-toast is-${t.tone}${t.pulse ? ' is-pulse' : ''}`}>
            <HudIcon name={t.icon || 'info'} size={18} />
            <span>{t.text}</span>
          </li>
        ))}
      </ul>
      <div className="tc-hud-sr" role="status" aria-live="polite" aria-relevant="additions">
        {live.map((l) => (
          <p key={l.id}>{l.text}</p>
        ))}
      </div>
    </>
  );
}
