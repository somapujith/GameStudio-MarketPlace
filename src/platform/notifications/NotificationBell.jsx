import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { cosmeticById } from '@shared/cosmetics.js';
import Modal from '@/components/shell/Modal.jsx';
import { CoinIcon, Icon } from '@/components/shell/icons.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import Badge from '@/platform/social/Badge.jsx';
import { BRAND } from '@/platform/brand.js';
import { useNotifications } from './useNotifications.jsx';
import { KIND_META, bellLabel, giftRewards, relativeTime } from './notificationsModel.js';
import '@/styles/notifications.css';

const TEAM = `${BRAND.name} team`;
const PHONE_MQ = '(max-width: 599px)';

/** A speech bubble: the "message from the team" kind (the shell icon set has no envelope). */
function MessageIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5z" />
      <path d="M8.5 9.5h7M8.5 12.5h4.5" />
    </svg>
  );
}

function KindIcon({ kind }) {
  if (kind === 'message') return <MessageIcon size={18} />;
  return <Icon name={KIND_META[kind]?.icon || 'info'} size={18} />;
}

/** One notification row: kind icon, team label (messages), title, body, gift rewards, relative time, unread dot. */
export function InboxItem({ n, now = Date.now() }) {
  const item = n.data?.itemId ? cosmeticById(n.data.itemId) : null;
  const rewards = n.kind === 'gift' || n.kind === 'achievement' ? giftRewards(n, item?.name || '') : [];
  const when = relativeTime(n.createdAt, now);
  return (
    <li className={`nt-item nt-item--${n.kind}${n.read ? '' : ' is-unread'}`}>
      <span className="nt-item__icon" aria-hidden="true">
        <KindIcon kind={n.kind} />
      </span>
      <div className="nt-item__text">
        {!n.read && <span className="sr-only">Unread. </span>}
        {n.kind === 'message' && <span className="nt-team">{TEAM}</span>}
        <b className="nt-item__title">{n.title}</b>
        {n.body && <p className="nt-item__body">{n.body}</p>}
        {rewards.length > 0 && (
          <span className="nt-item__rewards">
            {rewards.map((r) => (
              <span key={r.kind} className={`nt-chip nt-chip--${r.kind}`}>
                {r.kind === 'coins' && <CoinIcon size={12} />}
                {r.label}
              </span>
            ))}
          </span>
        )}
        {when && (
          <time className="nt-item__time" dateTime={n.createdAt || undefined}>
            {when}
          </time>
        )}
      </div>
      {!n.read && <i className="nt-item__dot" aria-hidden="true" />}
    </li>
  );
}

/**
 * The inbox content, presentational (renders on the server): heading row with "Mark all read", then the list, a
 * skeleton while loading, an empty state or an error with a retry. `heading` false = the sheet's own title is used.
 */
export function InboxPanel({ items = [], unread = 0, status = 'ok', now = Date.now(), headingId, heading = true, onMarkAll, onRetry }) {
  const none = unread <= 0;
  return (
    <div className="nt-panel">
      <div className="nt-panel__head">
        {heading ? (
          <h2 id={headingId} className="nt-panel__title">
            Notifications
          </h2>
        ) : (
          <span className="nt-panel__sub">{unread > 0 ? `${unread} unread` : 'All caught up'}</span>
        )}
        <button type="button" className="nt-markall" onClick={none ? undefined : onMarkAll} aria-disabled={none || undefined}>
          <HubIcon name="check" size={15} strokeWidth={2.4} /> Mark all read
        </button>
      </div>
      {status === 'loading' && !items.length ? (
        <ul className="nt-list" aria-busy="true" aria-label="Loading notifications">
          {[0, 1, 2].map((i) => (
            <li key={i} className="nt-item nt-item--skel" aria-hidden="true">
              <span className="nt-item__icon hh-skel" />
              <span className="nt-skel-lines">
                <i className="hh-skel" />
                <i className="hh-skel" />
              </span>
            </li>
          ))}
        </ul>
      ) : (status === 'error' || status === 'offline') && !items.length ? (
        <div className="nt-empty" role="alert">
          <p>{status === 'offline' ? "You're offline. Notifications will load when you reconnect." : "Couldn't load your notifications."}</p>
          {onRetry && (
            <button type="button" className="hub-btn hub-btn--soft hub-btn--sm" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      ) : items.length ? (
        <ul className="nt-list" aria-label="Latest notifications">
          {items.map((n) => (
            <InboxItem key={n.id} n={n} now={now} />
          ))}
        </ul>
      ) : (
        <div className="nt-empty">
          <span className="nt-empty__icon" aria-hidden="true">
            <Icon name="gift" size={26} />
          </span>
          <p>
            <b>Nothing here yet.</b> Gifts and messages from the {TEAM} show up here.
          </p>
        </div>
      )}
    </div>
  );
}

function useMatch(query) {
  const [on, setOn] = useState(() => (typeof matchMedia === 'function' ? matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, [query]);
  return on;
}

/** Re-render once a minute while open, so "Just now" becomes "1 min ago". */
function useMinute(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/**
 * Top-bar notifications bell (members only; separate from the social bell): the unread count as a Badge, and a
 * dropdown panel on wide screens or the shared bottom sheet on phones with the latest notifications and "Mark all
 * read". A button with aria-expanded; Escape, a click outside or a route change close it and focus returns to the bell.
 */
export default function NotificationBell() {
  const { enabled, items, unread, status, reload, markAllRead } = useNotifications();
  const phone = useMatch(PHONE_MQ);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const btnRef = useRef(null);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();
  const headingId = useId();
  const now = useMinute(open);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  }, []);

  // a route change closes it (no refocus: the page takes focus)
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // desktop dropdown: focus moves in, Escape / outside click / focus leaving closes
  useEffect(() => {
    if (!open || phone) return undefined;
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close(true);
    };
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, phone, close]);

  // opening re-reads the list when the last answer was a failure
  const retry = useRef(null);
  retry.current = status === 'error' || status === 'offline' ? reload : null;
  useEffect(() => {
    if (open) retry.current?.();
  }, [open]);

  if (!enabled) return null;

  const onBlur = (e) => {
    if (phone || !open) return;
    const next = e.relatedTarget;
    if (next && wrapRef.current && !wrapRef.current.contains(next)) close(false);
  };

  const panel = (heading) => (
    <InboxPanel items={items} unread={unread} status={status} now={now} headingId={headingId} heading={heading} onMarkAll={markAllRead} onRetry={reload} />
  );

  return (
    <div className="nt-wrap" ref={wrapRef} onBlur={onBlur}>
      <button
        ref={btnRef}
        type="button"
        className={`nt-bell${open ? ' is-open' : ''}${unread > 0 ? ' has-unread' : ''}`}
        aria-label={bellLabel(unread)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open && !phone ? panelId : undefined}
        data-tour="nav-notifications"
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <HubIcon name="bell" size={20} />
        <Badge count={unread} label={`${unread} unread`} className="bd-badge--bell nt-bell__badge" />
      </button>
      {open && !phone && (
        <div ref={panelRef} id={panelId} className="nt-pop" role="dialog" aria-modal="false" aria-labelledby={headingId} tabIndex={-1}>
          {panel(true)}
        </div>
      )}
      {phone && (
        <Modal open={open} onClose={() => setOpen(false)} title="Notifications" className="hub-sheet nt-sheet">
          {panel(false)}
        </Modal>
      )}
    </div>
  );
}
