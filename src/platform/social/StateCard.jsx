import { Link } from 'react-router-dom';
import SIcon from './SIcon.jsx';

/**
 * A designed empty / error / gate state: icon tile, display title, one honest line, actions.
 * `actions`: [{ label, to?, onClick?, primary?, icon? }]. `tone`: 'info' | 'warn' | 'bad'.
 */
export default function StateCard({ icon = 'info', tone = 'info', title, children, actions = [], role, className = '' }) {
  return (
    <div className={`sc-state sc-state--${tone} ${className}`.trim()} role={role || (tone === 'bad' ? 'alert' : 'status')}>
      <span className="sc-state__icon" aria-hidden="true">
        <SIcon name={icon} size={26} />
      </span>
      <p className="sc-state__title">{title}</p>
      {children && <div className="sc-state__text">{children}</div>}
      {actions.length > 0 && (
        <div className="sc-state__actions">
          {actions.map((a) => {
            const cls = `hub-btn ${a.primary ? 'hub-btn--primary' : 'hub-btn--ghost'}`;
            const inner = (
              <>
                {a.icon && <SIcon name={a.icon} size={17} />}
                {a.label}
              </>
            );
            return a.to ? (
              <Link key={a.label} to={a.to} className={cls}>
                {inner}
              </Link>
            ) : (
              <button key={a.label} type="button" className={cls} onClick={a.onClick}>
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
