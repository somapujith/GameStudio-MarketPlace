// Phone toasts: the newest one or two lines of the story as small pills that float above the action row and expire on
// their own. A fixed, pointer-events-none overlay: it takes no layout space (nothing moves when a toast comes or goes) and
// never blocks a button. The lines come from the activity log (the words are messages.js's). Silent for screen readers
// (the table's live region speaks), skipped while the tab is hidden, never replays what was there when the table opened.
//
//   <FeedToasts session={session} />      (shown below 960px wide; the desktop gets the ActivityFeed card instead)
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSettings } from '@/lib/storage.js';
import { freshEntries } from '../fx/fxModel.js';
import { feedEntry } from './feedModel.js';
import { Chips } from './ActivityFeed.jsx';
import { expireToasts, feedToToast, nextExpiry, pushToast } from './toastModel.js';
import '@/styles/feed.css';

const NONE = [];

/**
 * px between the bottom of the screen and the toasts. On the simple phone table they sit on the bottom edge of the board (so they
 * never cover the players' cash, which is what changes when money moves); elsewhere above the dock / the action row.
 */
function measureBottom() {
  if (typeof document === 'undefined') return 120;
  const vh = window.innerHeight;
  const board = document.querySelector('.ph-board');
  const br = board ? board.getBoundingClientRect() : null;
  if (br && br.height > 0 && br.bottom < vh) return Math.round(vh - br.bottom + 8);
  const el = document.querySelector('.pa') || document.querySelector('.hg-bottom') || document.querySelector('.ad');
  const r = el ? el.getBoundingClientRect() : null;
  return r && r.height > 0 && r.top < vh ? Math.round(vh - r.top + 8) : 16;
}

export default function FeedToasts({ session }) {
  const [settings] = useSettings();
  const speed = Number(settings?.playbackSpeed) > 0 ? Number(settings.playbackSpeed) : 1;
  const log = session?.log;
  const players = session?.display?.players || session?.view?.players || NONE;
  const me = session?.me;
  const [toasts, setToasts] = useState([]);
  const [bottom, setBottom] = useState(120);
  const seen = useRef(null);
  const pending = useRef(null); // a roll waiting for its landing
  const timer = useRef(0);

  // new log entries -> toasts (what was there on mount is not replayed)
  useEffect(() => {
    const { fresh, newest } = freshEntries(log, seen.current);
    seen.current = newest ?? 0;
    if (!fresh.length || (typeof document !== 'undefined' && document.hidden)) return;
    const now = Date.now();
    // a burst (the presenter catching up) shows only the last couple of lines
    const batch = fresh.slice(-4);
    const shows = [];
    for (const entry of batch) {
      const r = feedToToast(pending.current, feedEntry(entry), now);
      pending.current = r.pending;
      if (r.show) shows.push(r.show);
    }
    if (!shows.length) return;
    setToasts((cur) => shows.reduce((list, it) => pushToast(list, it, now, { speed }), cur));
  }, [log, speed]);

  // expiry: one timer for the soonest line
  useEffect(() => {
    clearTimeout(timer.current);
    const wait = nextExpiry(toasts, Date.now());
    if (wait === null) return undefined;
    timer.current = setTimeout(() => setToasts((cur) => expireToasts(cur, Date.now())), wait + 20);
    return () => clearTimeout(timer.current);
  }, [toasts]);

  const place = useCallback(() => setBottom(measureBottom()), []);
  useLayoutEffect(() => {
    if (!toasts.length) return undefined;
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [toasts.length, place]);

  if (!toasts.length) return null;
  return (
    <div className="af-toasts" style={{ '--af-bottom': `${bottom}px` }} aria-hidden="true">
      {toasts.map((t) => {
        const color = t.player != null ? players.find((p) => p.id === t.player)?.color : null;
        return (
          <div
            key={t.key}
            className={`af-toast is-${t.tone || 'info'}`}
            style={{ '--pc': color || undefined, '--life': `${Math.max(1200, t.expires - Date.now())}ms` }}
          >
            <span className="af-toast__ico">{t.icon}</span>
            <span className="af-toast__text"><Chips text={t.text} players={players} me={me} /></span>
          </div>
        );
      })}
    </div>
  );
}
