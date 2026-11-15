// The ONE pressable Snatch control (owner brief: "I want it at the place of the Buy button").
// While a snatch window is open and I may press, the main action slot (phone: the big primary between Manage and Trade; panel /
// dock: ActionBar's primary) turns into this SNATCH! button, the same size and position as Roll / Buy, framed by a ring that
// drains over the window. It shows the district, its price, the seconds left and the buttons I hold; after the press it is
// "Locked in — waiting…". When the window ends the slot simply returns to its normal state (no animation, so nothing jumps).
// Everybody who may NOT press gets the small passive banner of <SnatchPopup>, never a button.
//
//   const ctl = useSnatchControl(session);      // the window + the press + sound / buzz / Space-Enter-S / focus / alarm
//   <SnatchButton ctl={ctl} variant="phone" />   // renders null unless ctl.show (an eligible player, window running)
//
// Call useSnatchControl in exactly ONE place per screen (it owns the keyboard shortcut and the alarm).
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { formatINR } from '@shared/format.js';
import { sfx } from '@/lib/sfx.js';
import { buzz } from '@/lib/haptics.js';
import { hasOpenSheet } from './ui/Sheet.jsx';
import { BoltIcon } from './ui/SnatchChip.jsx';
import { SNATCH_MS_DEFAULT, snatchInfo, snatchLive, snatchWhoLabel, useSnatchClock } from './snatch.js';
import '@/styles/snatch.css';

/** The window as this device sees it: { info, clock, live, shown, pressed, mine, setMine }. No side effects. */
export function useSnatchWindow(session) {
  const info = snatchInfo(session);
  const clock = useSnatchClock(info);
  const [mine, setMine] = useState(null); // the window I pressed in (the press is sealed: lock at once, do not wait for the server)
  const live = snatchLive(info, clock);
  const held = useRef(null);
  if (info && clock) held.current = { info, clock };
  const shown = live && info && clock ? { info, clock } : held.current;
  const pressed = !!shown && (shown.info.pressed || mine === shown.info.key);
  return { info, clock, live, shown, pressed, mine, setMine };
}

const isTyping = (t) => {
  if (!t || (typeof document !== 'undefined' && (t === document.body || t === document.documentElement))) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
};

/** The window plus everything that happens when I may press: the press, its sound + buzz, the alarm, Space / Enter / S, focus. */
export function useSnatchControl(session) {
  const w = useSnatchWindow(session);
  const { info, clock, live, pressed, setMine } = w;
  const btnRef = useRef(null);
  const canPress = live && !!info && info.eligible && !pressed;
  const show = live && !!info && info.eligible;

  const press = useCallback(() => {
    if (!canPress) return;
    setMine(info.key);
    try { sfx.play('snatchPress'); } catch { /* sound is optional */ }
    buzz('snatchPress');
    session.dispatch?.({ type: 'SNATCH' });
  }, [canPress, info, session, setMine]);

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
      e.stopImmediatePropagation(); // the action row's own Space / Enter shortcut must not also fire
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

  return { ...w, show, canPress, press, btnRef };
}

/** variant: 'phone' (the phone table's primary slot) | 'panel' (ActionBar's primary: board centre and dock). */
export default function SnatchButton({ ctl, variant = 'phone', className = '' }) {
  const uid = useId();
  if (!ctl || !ctl.show || !ctl.shown) return null;
  const { info: si, clock: sc } = ctl.shown;
  const { pressed, press, btnRef } = ctl;
  const district = si.tile?.name || 'the district';
  const secs = sc.seconds;
  const titleId = `${uid}-t`;
  const descId = `${uid}-d`;
  return (
    <div
      className={`sn-ring sn-ring--${variant}${className ? ` ${className}` : ''}`}
      ref={sc.bind}
      style={{ '--f': sc.fraction.toFixed(4) }}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-mode={pressed ? 'locked' : 'press'}
      data-testid="snatch-button"
    >
      <button
        ref={btnRef}
        type="button"
        className="sn-btn"
        disabled={pressed}
        onClick={press}
        aria-label={pressed ? 'Snatch locked in, waiting for the window to close' : `Snatch ${district} for free, ${formatINR(si.price)}, ${secs} ${secs === 1 ? 'second' : 'seconds'} left`}
      >
        <span className="sn-btn__txt">
          <b className="sn-btn__title" id={titleId}>{pressed ? 'Locked in — waiting…' : 'SNATCH!'}</b>
          <small className="sn-btn__sub">{district} · {formatINR(si.price)}</small>
        </span>
        <span className="sn-btn__side" aria-hidden="true">
          <b className="sn-secs">{secs}</b>
          <i className="sn-tok"><BoltIcon size={11} /> x{si.tokens}</i>
        </span>
      </button>
      <p className="hg-sr" id={descId}>{`${si.buyerName} bought it. ${pressed ? 'You pressed Snatch.' : 'Snatch it for free!'} ${snatchWhoLabel(si)}`}</p>
    </div>
  );
}
