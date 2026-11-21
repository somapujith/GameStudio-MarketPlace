// Admin console primitives (cards, tiles, chips, states, pager, fields). Every class is `adm-` prefixed.
import { Children, cloneElement, isValidElement, useId } from 'react';
import { Link } from 'react-router-dom';
import Avatar from '@/components/art/Avatar.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { paths } from '@/platform/paths.js';
import { errorMessage } from '@/lib/api.js';
import { ROLE_LABEL, fmtNum, pageCount } from './model.js';

export { HubIcon as AdmIcon };

const cx = (...xs) => xs.filter(Boolean).join(' ');

/** Page heading: kicker, poster title, optional lead and actions on the right. */
export function PageHead({ kicker = 'Admin', title, lead, children }) {
  return (
    <header className="adm-head">
      <div className="adm-head__text">
        <p className="adm-kicker">{kicker}</p>
        <h1 className="adm-h1">{title}</h1>
        {lead ? <p className="adm-lead">{lead}</p> : null}
      </div>
      {children ? <div className="adm-head__actions">{children}</div> : null}
    </header>
  );
}

/** A card with a header bar (poster title + optional meta / actions). */
export function Card({ title, meta, actions, children, className, flush = false, id, as: Tag = 'section' }) {
  const hid = useId();
  return (
    <Tag className={cx('adm-card', flush && 'adm-card--flush', className)} aria-labelledby={title ? hid : undefined} id={id}>
      {title ? (
        <div className="adm-card__head">
          <h2 className="adm-card__title" id={hid}>
            {title}
          </h2>
          {meta ? <span className="adm-card__meta">{meta}</span> : null}
          {actions ? <div className="adm-card__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="adm-card__body">{children}</div>
    </Tag>
  );
}

export function StatTile({ label, value, sub, tone, icon }) {
  return (
    <div className={cx('adm-tile', tone && `adm-tile--${tone}`)}>
      <span className="adm-tile__label">
        {icon ? <HubIcon name={icon} size={14} /> : null}
        {label}
      </span>
      <b className="adm-tile__value">{value}</b>
      {sub ? <span className="adm-tile__sub">{sub}</span> : null}
    </div>
  );
}

export function RoleChip({ role }) {
  const r = role === 'admin' || role === 'moderator' ? role : 'user';
  return <span className={`adm-chip adm-chip--role adm-chip--${r}`}>{ROLE_LABEL[r]}</span>;
}

/** Small status label. tone: plain | good | bad | gold | info | warn */
export function Badge({ tone = 'plain', children, title }) {
  return (
    <span className={`adm-badge adm-badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

export function UserAvatar({ preset = 0, size = 32 }) {
  return (
    <span className="adm-avatar" style={{ width: size, height: size }} aria-hidden="true">
      <Avatar preset={Number(preset) || 0} size={size} />
    </span>
  );
}

/** Avatar + name + @handle, linking to the user page when `id` is given. */
export function UserCell({ id, name, handle, avatar, sub, size = 32 }) {
  const body = (
    <>
      <UserAvatar preset={avatar} size={size} />
      <span className="adm-user__text">
        <span className="adm-user__name">{name || 'Unnamed'}</span>
        {handle ? <span className="adm-user__handle">{`@${handle}`}</span> : sub ? <span className="adm-user__handle">{sub}</span> : null}
      </span>
    </>
  );
  return id ? (
    <Link className="adm-user adm-user--link" to={paths.admin(`users/${id}`)}>
      {body}
    </Link>
  ) : (
    <span className="adm-user">{body}</span>
  );
}

export function Skel({ w = '100%', h = 14, className }) {
  return <span className={cx('adm-skel', className)} style={{ width: w, height: h }} aria-hidden="true" />;
}

/** A loading region: an sr-only status plus visual placeholder rows. */
export function Loading({ label = 'Loading', rows = 6, kind = 'rows' }) {
  return (
    <div className={`adm-loading adm-loading--${kind}`} role="status" aria-busy="true">
      <span className="adm-sr">{label}...</span>
      {kind === 'tiles'
        ? Array.from({ length: rows }, (_, i) => <Skel key={i} h={88} className="adm-skel--tile" />)
        : Array.from({ length: rows }, (_, i) => (
            <span key={i} className="adm-skel-row">
              <Skel w={32} h={32} className="adm-skel--round" />
              <Skel w={`${40 + ((i * 17) % 35)}%`} />
              <Skel w="18%" />
            </span>
          ))}
    </div>
  );
}

export function Empty({ icon = 'search', title, children }) {
  return (
    <div className="adm-empty">
      <span className="adm-empty__icon" aria-hidden="true">
        <HubIcon name={icon} size={26} />
      </span>
      <p className="adm-empty__title">{title}</p>
      {children ? <p className="adm-empty__text">{children}</p> : null}
    </div>
  );
}

/** The session is signed in but the server says it is not (or no longer) staff. */
export function Forbidden({ status = 403 }) {
  return (
    <div className="adm-state adm-state--forbidden" role="alert">
      <span className="adm-state__icon" aria-hidden="true">
        <HubIcon name="lock" size={28} />
      </span>
      <h2 className="adm-state__title">{status === 401 ? 'Signed out' : 'No admin access'}</h2>
      <p className="adm-state__text">
        {status === 401
          ? 'Your session ended. Sign in again to use the console.'
          : 'This session no longer has a staff role, or this action needs a higher one. Reload after your role is restored.'}
      </p>
      <div className="adm-state__actions">
        {status === 401 ? (
          <Link className="adm-btn adm-btn--primary" to={paths.login(paths.admin())}>
            Sign in
          </Link>
        ) : null}
        <Link className="adm-btn adm-btn--ghost" to={paths.hub()}>
          <HubIcon name="arrowL" size={16} /> Back to site
        </Link>
      </div>
    </div>
  );
}

/** An error with a retry; 401/403 become the access message. */
export function ErrorState({ error, onRetry, what = 'this' }) {
  if (error && (error.status === 401 || error.status === 403)) return <Forbidden status={error.status} />;
  return (
    <div className="adm-state adm-state--error" role="alert">
      <span className="adm-state__icon" aria-hidden="true">
        <HubIcon name="wifiOff" size={28} />
      </span>
      <h2 className="adm-state__title">{error?.status === 404 ? 'Not found' : `Could not load ${what}`}</h2>
      <p className="adm-state__text">{errorMessage(error)}</p>
      {onRetry && error?.status !== 404 ? (
        <div className="adm-state__actions">
          <button type="button" className="adm-btn adm-btn--primary" onClick={onRetry}>
            <HubIcon name="refresh" size={16} /> Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Previous / page x of y / next. */
export function Pager({ page, total, pageSize, onPage, label = 'Pages' }) {
  const pages = pageCount(total, pageSize);
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="adm-pager" aria-label={label}>
      <span className="adm-pager__count">
        {`${fmtNum(from)}–${fmtNum(to)} of ${fmtNum(total)}`}
      </span>
      <div className="adm-pager__btns">
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <HubIcon name="chevL" size={14} /> Prev
        </button>
        <span className="adm-pager__page" aria-current="page">
          {`${page} / ${pages}`}
        </span>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next <HubIcon name="chevR" size={14} />
        </button>
      </div>
    </nav>
  );
}

/** Toggle chips (one value). */
export function ChipGroup({ label, options, value, onChange }) {
  return (
    <div className="adm-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={cx('adm-chipbtn', value === o.value && 'is-on')} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null ? <span className="adm-chipbtn__n">{fmtNum(o.count)}</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * A labelled field: injects id / aria-invalid / aria-describedby into its single control child.
 * `count` + `max` show a live character counter.
 */
export function Field({ label, hint, error, count, max, children, className, inline = false }) {
  const id = useId();
  const hintId = `${id}-h`;
  const errId = `${id}-e`;
  const child = Children.only(children);
  const describedBy = [hint && hintId, error && errId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(child) ? cloneElement(child, { id: child.props.id || id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy }) : child;
  const over = max != null && count != null && count > max;
  return (
    <div className={cx('adm-field', inline && 'adm-field--inline', error && 'is-bad', className)}>
      <span className="adm-field__top">
        <label className="adm-label" htmlFor={child.props.id || id}>
          {label}
        </label>
        {max != null && count != null ? (
          <span className={cx('adm-field__count', over && 'is-over')} aria-hidden="true">
            {count}/{max}
          </span>
        ) : null}
      </span>
      {control}
      {hint && !error ? (
        <span className="adm-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="adm-error" id={errId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Dot + label for online state. */
export function OnlineDot({ online }) {
  return (
    <span className={cx('adm-dot', online && 'is-on')}>
      <span className="adm-dot__mark" aria-hidden="true" />
      {online ? 'Online' : 'Offline'}
    </span>
  );
}

export function RefreshButton({ onClick, busy, label = 'Refresh' }) {
  return (
    <button type="button" className={cx('adm-btn adm-btn--ghost', busy && 'is-busy')} onClick={onClick} disabled={busy} aria-label={busy ? `${label} (loading)` : label}>
      <HubIcon name="refresh" size={16} className="adm-spin" /> {label}
    </button>
  );
}

/** A "read only" line for staff whose role cannot use a screen's writes: says what is locked and why. */
export function ReadOnlyNote({ children }) {
  return (
    <p className="adm-readonly" role="note">
      <HubIcon name="lock" size={15} />
      <span>{children}</span>
    </p>
  );
}

/** A small horizontal meter (0-100), e.g. an unlock rate. The number is shown next to it, so the bar is decorative. */
export function Meter({ value, tone }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <span className={cx('adm-meter', tone && `adm-meter--${tone}`)} aria-hidden="true">
      <span className="adm-meter__fill" style={{ width: `${v > 0 ? Math.max(v, 1.5) : 0}%` }} />
    </span>
  );
}
