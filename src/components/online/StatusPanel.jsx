import { Link } from 'react-router-dom';
import { HubMark } from '@/components/art/hub/HubMark.jsx';
import '@/styles/online.css';

function LoadingMark() {
  return <span className="jalebi-loader jalebi-loader--small" aria-hidden="true"><HubMark size={48} /></span>;
}

/**
 * Centered card for terminal / gating states (signed out, kicked, room gone, error, loading).
 * `actions`: [{ label, to?, onClick?, primary? }]
 */
export default function StatusPanel({ icon = 'i', tone = 'info', title, body, actions = [], busy = false, children }) {
  return (
    <div className="ho-status" role={tone === 'bad' ? 'alert' : 'status'} aria-busy={busy || undefined}>
      <div className={`ho-status__icon ho-status__icon--${tone}`} aria-hidden="true">
        {busy ? <LoadingMark /> : icon}
      </div>
      <h1 className="ho-status__title">{title}</h1>
      {body && <p className="ho-status__body">{body}</p>}
      {children}
      {actions.length > 0 && (
        <div className="ho-status__actions">
          {actions.map((a) =>
            a.to ? (
              <Link key={a.label} to={a.to} className={`ho-btn ${a.primary ? 'ho-btn--primary' : 'ho-btn--ghost'}`}>
                {a.label}
              </Link>
            ) : (
              <button key={a.label} type="button" className={`ho-btn ${a.primary ? 'ho-btn--primary' : 'ho-btn--ghost'}`} onClick={a.onClick}>
                {a.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Branded spiral + caption used while something loads. */
export function Loading({ text = 'Loading...' }) {
  return (
    <div className="ho-loading" role="status" aria-live="polite">
      <LoadingMark />
      <span>{text}</span>
    </div>
  );
}
