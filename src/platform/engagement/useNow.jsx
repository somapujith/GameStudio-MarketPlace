import { useEffect, useState } from 'react';
import { COUNTDOWN_TICK_MS } from './engagementModel.js';

/**
 * The current time, re-read once a minute (aligned to the minute) while the tab is visible, and right away when it
 * becomes visible again. Countdowns built on it change at most once a minute, so their aria-live regions stay quiet.
 */
export function useNow(tickMs = COUNTDOWN_TICK_MS) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let t = 0;
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const schedule = () => {
      clearTimeout(t);
      const wait = tickMs - (Date.now() % tickMs) + 50;
      t = setTimeout(() => {
        if (!hidden()) setNow(Date.now());
        schedule();
      }, wait);
    };
    const onVis = () => {
      if (!hidden()) setNow(Date.now());
    };
    schedule();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [tickMs]);
  return now;
}

/** "Ends in 3d 4h" as a polite live region; `text` changes at most once a minute. */
export function Countdown({ text, spoken, className = '' }) {
  return (
    <span className={className} aria-live="polite" aria-atomic="true">
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{spoken || text}</span>
    </span>
  );
}
