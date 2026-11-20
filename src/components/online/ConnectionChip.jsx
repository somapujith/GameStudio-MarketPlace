import { useEffect, useState, useSyncExternalStore } from 'react';
import { linkCopy, linkState } from './connection.js';
import '@/styles/store-rooms.css';

const subscribe = (cb) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** `true` while the browser says it is online (always true on the server). */
export function useOnline() {
  return useSyncExternalStore(
    subscribe,
    () => (typeof navigator === 'undefined' || navigator.onLine !== false),
    () => true,
  );
}

/** Milliseconds since `since` (ticks once a second while `active`). */
function useElapsed(since, active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !since) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active, since]);
  return active && since ? Math.max(0, now - since) : 0;
}

/**
 * The room link, in words: connecting / connected / reconnecting (attempt, how long, "Try now") / offline.
 * Colour and a dot carry the state too, and a polite live region announces each CHANGE once (the ticking hint is
 * outside it, so a screen reader never reads the seconds go by).
 * Props: `connection` ('connecting'|'open'|'closed'), `link` ({ attempt, since, everOpen }) and `fatal` from
 * useRoomConnection, `onRetry`, `compact` (chip only, no hint line).
 */
export default function ConnectionChip({ connection, link = {}, fatal = null, onRetry, compact = false, className = '' }) {
  const online = useOnline();
  const state = linkState({ connection, everOpen: !!link.everOpen, offline: !online, fatal });
  const waiting = state === 'reconnecting' || state === 'connecting' || state === 'offline';
  const elapsedMs = useElapsed(link.since, waiting);
  const copy = linkCopy(state, { attempt: link.attempt || 0, elapsedMs });
  const showRetry = copy.retry && typeof onRetry === 'function' && online;

  return (
    <div className={`sr-conn sr-conn--${copy.tone}${compact ? ' is-compact' : ''} ${className}`.trim()} data-state={state}>
      <span className="sr-conn__pill">
        <span className="sr-conn__dot" aria-hidden="true" />
        <span className="sr-conn__label" key={state}>
          {copy.label}
        </span>
      </span>
      {!compact && copy.hint && <span className="sr-conn__hint">{copy.hint}</span>}
      {showRetry && (
        <button type="button" className="sr-conn__retry" onClick={onRetry}>
          Try now
        </button>
      )}
      <span className="ho-sr" role="status" aria-live="polite">
        {copy.announce}
      </span>
    </div>
  );
}
