// The passive Snatch banner (docs/GAME_RULES.md section 14; owner brief: the Snatch window pops up for 5 seconds and goes off).
//
// The pressable SNATCH! button is NOT here: it lives in the main action slot where Roll / Buy sit (SnatchButton.jsx).
// This is the small banner everybody who may NOT press gets (the buyer, players without a button, spectators), with the same
// countdown: "Ravi bought Madhapur: Meera can snatch it!". It pops up with a spring (transform / opacity only) and goes off by itself
// (a ~180 ms fade) the moment the phase leaves 'snatch' or the countdown ends. Phone portrait: floats just above the action row
// (a zero-height slot, nothing moves); elsewhere: centred near the bottom of the board. Reads `session.view`, not the delayed display.
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './ui/helpers.js';
import { BoltIcon } from './ui/SnatchChip.jsx';
import { SNATCH_EXIT_MS, snatchAnnouncement, snatchBannerText, snatchInfo } from './snatch.js';
import { useSnatchWindow } from './SnatchButton.jsx';
import '@/styles/snatch.css';

/** 'in' while the pop-up is wanted, 'leaving' for `exitMs` after, then 'out' (unmounted). */
export function usePresence(open, exitMs) {
  const [state, setState] = useState(open ? 'in' : 'out');
  if (open && state !== 'in') setState('in');
  // wanted -> not wanted: start the exit (or vanish at once when there is no exit animation) ...
  useEffect(() => {
    if (!open && state === 'in') setState(exitMs > 0 ? 'leaving' : 'out');
  }, [open, state, exitMs]);
  // ... and unmount when the exit is over. (A separate effect: the first one re-runs when it changes `state`, and would cancel this timer.)
  useEffect(() => {
    if (state !== 'leaving') return undefined;
    const t = setTimeout(() => setState('out'), exitMs);
    return () => clearTimeout(t);
  }, [state, exitMs]);
  if (open) return 'in';
  return state === 'in' ? 'leaving' : state; // the frame before the effect below starts the exit already shows it
}

/** Says "Snatch window open for 5 seconds..." once per window through the table's shared polite live region. */
export function useSnatchAnnouncer(session, say) {
  const info = snatchInfo(session);
  const key = info ? info.key : null;
  const last = useRef(null);
  const sayRef = useRef(say);
  sayRef.current = say;
  const line = info ? snatchAnnouncement(info) : '';
  useEffect(() => {
    if (!key || last.current === key) return;
    last.current = key;
    sayRef.current?.(line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export default function SnatchPopup({ session, placement = 'board' }) {
  const reduced = useReducedMotion();
  const { live, shown, info } = useSnatchWindow(session);
  const phase = usePresence(live && !!info && !info.eligible, reduced ? 0 : SNATCH_EXIT_MS);

  // a player who may press has the SNATCH! button in the action slot (SnatchButton): no floating panel for them
  if (phase === 'out' || !shown || shown.info.eligible) return null;
  const { info: si, clock: sc } = shown;
  const leaving = phase === 'leaving';
  return (
    <div
      className="sn-pop"
      data-place={placement}
      data-state={leaving ? 'leaving' : 'in'}
      data-mode="watch"
      data-rm={reduced ? '' : undefined}
      role="status"
      aria-label="Snatch window"
      data-testid="snatch-popup"
    >
      <div className="sn-watch" ref={sc.bind} style={{ '--f': sc.fraction.toFixed(4) }}>
        <span className="sn-watch__bolt" aria-hidden="true"><BoltIcon size={20} /></span>
        <p className="sn-watch__txt">{snatchBannerText(si)}</p>
        <b className="sn-secs" aria-hidden="true">{sc.seconds}</b>
        <i className="sn-bar" aria-hidden="true"><i /></i>
      </div>
    </div>
  );
}
