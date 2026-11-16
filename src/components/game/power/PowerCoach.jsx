import { useCallback, useEffect, useState } from 'react';
import { COACH_KEY, COACH_TEXT } from './powerModel.js';
import '@/styles/power.css';

/** Has the coach mark been seen? (localStorage can throw or be absent: then it is simply shown once per page load.) */
export function coachSeen() {
  try { return globalThis.localStorage?.getItem(COACH_KEY) === '1'; } catch { return false; }
}
export function markCoachSeen() {
  try { globalThis.localStorage?.setItem(COACH_KEY, '1'); } catch { /* private mode: shown again next time, harmless */ }
}

/**
 * One-time coach mark, the first time the local player holds a power card (storage key `hg:power-coach`).
 *   hasCards   mount it only while I hold a card; it does nothing otherwise
 *   hidden     keep it away while the card panel is open (the panel says the same thing in more detail)
 * A small speech bubble above the tray: tap it or press Esc to dismiss (also dismissed when a card is selected, via `hidden`
 * + the parent calling `dismiss`). It never takes focus and only its own bubble takes pointer events, so it can never block the
 * Roll control; it is a polite status for screen readers.
 */
export default function PowerCoach({ hasCards = false, hidden = false, onDismiss, className = '' }) {
  const [seen, setSeen] = useState(() => coachSeen());
  const dismiss = useCallback(() => {
    markCoachSeen();
    setSeen(true);
    onDismiss?.();
  }, [onDismiss]);
  const show = hasCards && !seen && !hidden;

  useEffect(() => {
    if (!show) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, dismiss]);

  // opening a card's panel counts as having understood it
  useEffect(() => {
    if (hasCards && hidden && !seen) dismiss();
  }, [hasCards, hidden, seen, dismiss]);

  if (!show) return null;
  return (
    <div className={`pw-coach ${className}`.trim()} role="status">
      <button type="button" className="pw-coach__btn" onClick={dismiss} aria-label={`${COACH_TEXT} Tap to dismiss.`}>
        <span className="pw-coach__txt" aria-hidden="true">{COACH_TEXT}</span>
        <span className="pw-coach__ok" aria-hidden="true">Got it</span>
      </button>
    </div>
  );
}
