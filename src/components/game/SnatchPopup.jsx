// The Snatch pop-up (docs/GAME_RULES.md section 9; owner brief: "the Snatch button has a timer for 5 seconds for the players on
// the board; it pops up on the screen and then goes off").
//
// While the game is in phase 'snatch' this POPS UP over the table for everybody (spring pop-in, transform / opacity only):
//   - a player who may snatch gets a big pressable SNATCH! button, wrapped by a ring that drains over the window, with the
//     district, its price, the buttons they hold and the seconds left. Pressing sends SNATCH, plays a sound + buzz and locks
//     it ("Locked in — waiting…"); the window keeps running until the server closes it.
//   - everybody else (the buyer, players without a button, spectators) gets a small passive banner with the same countdown:
//     "Ravi bought Madhapur: Meera can snatch it!" (no button).
// It GOES OFF by itself: the moment the phase leaves 'snatch' (the server resolved it) or the countdown ends, it fades and
// scales out in ~180 ms and unmounts, never lingering. The outcome is told by the board-centre caption / log (snatch_end).
//
// Placement (CSS in styles/snatch.css): `placement="phone"` floats just above the action row of the simple phone table
// (a zero-height slot, so the board never moves); `placement="board"` sits centred near the bottom of the board
// (tablets, landscape phones, desktop). The countdown is local (see snatch.js useSnatchClock): no device clock is trusted.
// Reads `session.view` (the latest state), never the delayed `session.display`.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { formatINR } from '@shared/format.js';
import { sfx } from '@/lib/sfx.js';
import { buzz } from '@/lib/haptics.js';
import { hasOpenSheet } from './ui/Sheet.jsx';
import { useReducedMotion } from './ui/helpers.js';
import { BoltIcon } from './ui/SnatchChip.jsx';
import { SNATCH_EXIT_MS, SNATCH_MS_DEFAULT, snatchAnnouncement, snatchBannerText, snatchInfo, snatchLive, snatchWhoLabel, useSnatchClock } from './snatch.js';
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

const isTyping = (t) => {
  if (!t || (typeof document !== 'undefined' && (t === document.body || t === document.documentElement))) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
};

export default function SnatchPopup({ session, placement = 'board' }) {
  const info = snatchInfo(session);
  const clock = useSnatchClock(info);
  const reduced = useReducedMotion();
  const uid = useId();
  const btnRef = useRef(null);
  const [mine, setMine] = useState(null); // the window I pressed in (the press is sealed: lock at once, do not wait for the server)

  const live = snatchLive(info, clock);
  const phase = usePresence(live, reduced ? 0 : SNATCH_EXIT_MS);
  const held = useRef(null);
  if (info && clock) held.current = { info, clock };
  const shown = live && info && clock ? { info, clock } : held.current;

  const pressed = !!shown && (shown.info.pressed || mine === shown.info.key);
  const canPress = live && !!info && info.eligible && !pressed;

  const press = useCallback(() => {
    if (!canPress) return;
    setMine(info.key);
    try { sfx.play('snatchPress'); } catch { /* sound is optional */ }
    buzz('snatchPress');
    session.dispatch?.({ type: 'SNATCH' });
  }, [canPress, info, session]);

  // For a player who may press: the alarm, then a tick-tock that speeds up until the window closes. It stops the moment
  // they press, or the window is over (the cleanup runs when `canPress` turns false).
  const alarmKey = canPress ? info.key : null;
  const alarmFrom = useRef({ ms: SNATCH_MS_DEFAULT, elapsed: 0 });
  alarmFrom.current = { ms: info?.ms || SNATCH_MS_DEFAULT, elapsed: clock ? Math.max(0, clock.totalMs - clock.remainingMs) : 0 };
  useEffect(() => {
    if (!alarmKey) return undefined;
    buzz('snatchOpen');
    let stop = null;
    try { stop = sfx.snatchWindow(alarmFrom.current); } catch { /* sound is optional */ }
    return () => { try { stop?.(); } catch { /* ignore */ } };
  }, [alarmKey]);

  // Space / Enter / S press it too (not while typing or while a sheet is open)
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    if (!canPress) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 's' && e.key !== 'S') return;
      if (hasOpenSheet() || isTyping(e.target)) return;
      e.preventDefault();
      pressRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [canPress]);

  // keyboard / screen-reader users land on the button, unless they are typing something (touch screens do not need it)
  const key = canPress ? info.key : null;
  useEffect(() => {
    if (!key) return;
    const el = btnRef.current;
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    let fine = true;
    try { fine = !!window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch { /* assume a keyboard */ }
    if (el && fine && (!active || active === document.body)) {
      try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  }, [key]);

  if (phase === 'out' || !shown) return null;
  const { info: si, clock: sc } = shown;
  const leaving = phase === 'leaving';
  const eligible = si.eligible;
  const district = si.tile?.name || 'the district';
  const fraction = sc.fraction;
  const secs = sc.seconds;
  const titleId = `${uid}-t`;
  const descId = `${uid}-d`;
  const common = {
    className: 'sn-pop',
    'data-place': placement,
    'data-state': leaving ? 'leaving' : 'in',
    'data-mode': eligible ? (pressed ? 'locked' : 'press') : 'watch',
    'data-rm': reduced ? '' : undefined,
  };

  if (!eligible) {
    const text = snatchBannerText(si);
    return (
      <div {...common} role="status" aria-label="Snatch window" data-testid="snatch-popup">
        <div className="sn-watch" style={{ '--f': fraction.toFixed(4) }}>
          <span className="sn-watch__bolt" aria-hidden="true"><BoltIcon size={20} /></span>
          <p className="sn-watch__txt">{text}</p>
          <b className="sn-secs" aria-hidden="true">{secs}</b>
          <i className="sn-bar" aria-hidden="true"><i /></i>
        </div>
      </div>
    );
  }

  return (
    <div {...common} role="alertdialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={descId} data-testid="snatch-popup">
      <p className="sn-head" id={descId}>
        <b>{si.buyerName} bought it.</b> {pressed ? 'You pressed Snatch.' : 'Snatch it for free!'}
      </p>
      <div className="sn-ring" style={{ '--f': fraction.toFixed(4) }}>
        <button
          ref={btnRef}
          type="button"
          className="sn-btn"
          disabled={pressed || leaving}
          onClick={press}
          aria-label={pressed ? 'Snatch locked in, waiting for the window to close' : `Snatch ${district} for free, ${formatINR(si.price)}, ${secs} ${secs === 1 ? 'second' : 'seconds'} left`}
        >
          <span className="sn-btn__bolt" aria-hidden="true"><BoltIcon size={32} /></span>
          <span className="sn-btn__txt">
            <b className="sn-btn__title" id={titleId}>{pressed ? 'Locked in — waiting…' : 'SNATCH!'}</b>
            <small className="sn-btn__sub">{district} · {formatINR(si.price)}</small>
          </span>
          <span className="sn-btn__side" aria-hidden="true">
            <b className="sn-secs">{secs}</b>
            <i className="sn-tok"><BoltIcon size={11} /> x{si.tokens}</i>
          </span>
        </button>
      </div>
      <p className="hg-sr">{snatchWhoLabel(si)}</p>
    </div>
  );
}
