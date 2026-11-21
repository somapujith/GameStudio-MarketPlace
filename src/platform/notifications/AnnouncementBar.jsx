import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getAnnouncements } from '@/lib/api.js';
import { Icon } from '@/components/shell/icons.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { useApiReady } from '@/platform/home/useApi.js';
import { ANNOUNCEMENT_REFRESH_MS, bannerRouteAllowed, dismissAnnouncement, msUntilEnd, pickAnnouncement, readDismissed } from './announcementModel.js';
import '@/styles/notifications.css';

const TONE_ICON = { info: 'info', event: 'sparkle' };
const TONE_WORD = { info: 'Announcement', event: 'Event', warning: 'Heads up' };

/** A warning triangle (the shell icon set has none). */
function WarnIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5 21.5 20h-19z" />
      <path d="M12 10v4.5M12 17.2h.01" />
    </svg>
  );
}

/** The link: internal paths through the router, https links in a new tab with rel="noopener noreferrer". */
function AnnouncementLink({ link }) {
  if (!link) return null;
  if (link.kind === 'internal') {
    return (
      <Link to={link.to} className="nt-ann__link">
        {link.label}
        <HubIcon name="arrowR" size={14} strokeWidth={2.4} />
      </Link>
    );
  }
  return (
    <a href={link.href} className="nt-ann__link" target="_blank" rel="noopener noreferrer">
      {link.label}
      <HubIcon name="arrowR" size={14} strokeWidth={2.4} />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** One announcement as a slim strip, presentational (renders on the server). `a` comes from normalizeAnnouncement. */
export function AnnouncementView({ a, onDismiss }) {
  if (!a) return null;
  return (
    <aside className={`nt-ann nt-ann--${a.tone}`} aria-label={TONE_WORD[a.tone] || 'Announcement'} data-announcement={a.id}>
      <div className="nt-ann__inner">
        <span className="nt-ann__tag" aria-hidden="true">
          {a.tone === 'warning' ? <WarnIcon size={15} /> : <Icon name={TONE_ICON[a.tone] || 'info'} size={15} strokeWidth={2.4} />}
          <span className="nt-ann__word">{TONE_WORD[a.tone]}</span>
        </span>
        <p className="nt-ann__msg">{a.message}</p>
        <AnnouncementLink link={a.link} />
        {onDismiss && (
          <button type="button" className="nt-ann__close" onClick={() => onDismiss(a.id)} aria-label="Dismiss announcement">
            <HubIcon name="close" size={16} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </aside>
  );
}

/**
 * The newest live announcement as a strip under the top bar, on hub pages (never on the leaderboard, whose layout is
 * fitted to the viewport, nor on game screens / the lobby, which are outside the shell). GET /api/announcements when
 * the shell mounts and every 5 minutes while the tab is visible; closing one remembers its id (localStorage).
 */
export default function AnnouncementBar() {
  const { pathname } = useLocation();
  const ready = useApiReady();
  const [list, setList] = useState([]);
  const [dismissed, setDismissed] = useState(() => readDismissed());
  const [now, setNow] = useState(() => Date.now());
  const last = useRef(0);

  const load = useCallback(async () => {
    last.current = Date.now();
    try {
      const r = await getAnnouncements({ timeout: 10_000 });
      setList(Array.isArray(r?.announcements) ? r.announcements : []);
      setNow(Date.now());
    } catch {
      /* offline / no Worker: keep what we had (usually nothing) */
    }
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    load();
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (Date.now() - last.current >= ANNOUNCEMENT_REFRESH_MS - 1000) load();
    };
    const t = setInterval(tick, ANNOUNCEMENT_REFRESH_MS);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ready, load]);

  const shown = pickAnnouncement(list, { now, dismissed });

  // drop it the moment its window ends, even between fetches
  const endsIn = shown ? msUntilEnd(shown, now) : null;
  useEffect(() => {
    if (endsIn == null || endsIn > 2 ** 31 - 1) return undefined;
    const t = setTimeout(() => setNow(Date.now()), endsIn + 50);
    return () => clearTimeout(t);
  }, [endsIn]);

  const onDismiss = useCallback((id) => {
    setDismissed(dismissAnnouncement(id));
    // the close button goes away with the strip: keep keyboard focus on the page instead of <body>
    if (typeof document !== 'undefined') document.getElementById('main')?.focus({ preventScroll: true });
  }, []);

  if (!shown || !bannerRouteAllowed(pathname)) return null;
  return <AnnouncementView a={shown} onDismiss={onDismiss} />;
}
