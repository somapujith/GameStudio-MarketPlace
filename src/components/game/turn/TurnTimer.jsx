// The decision timer, drawn two ways from `session.clock`:
//   <TimerRing session playerId size>{avatar}</TimerRing>  a ring that drains around a waiting player's avatar
//   <TimerBar session />                                    a slim bar with "Your move · 32s" for the panel / dock
// Both render nothing (just the children) when no deadline is running or the player is not waited for.
// The <= 10 s warning colour + pulse only ever shows to the local player.
import { nameOf } from '../ui/helpers.js';
import { useClock } from './clock.js';
import '@/styles/turn.css';

export function TimerRing({ session, playerId, size = 36, children }) {
  const info = useClock(session);
  const on = !!info && info.waitingFor.includes(String(playerId));
  const warn = on && info.warn && String(playerId) === String(session.me);
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <span className={`tt-ring${on ? ' is-on' : ''}${warn ? ' is-warn' : ''}`} style={{ '--tt-size': `${size}px` }}>
      {children}
      {on ? (
        <svg className="tt-ring__svg" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false">
          <circle className="tt-ring__track" cx={size / 2} cy={size / 2} r={r} />
          <circle
            className="tt-ring__run"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - info.frac)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
      ) : null}
    </span>
  );
}

/** Who the clock waits for, in words. */
export function waitLabel(session, info) {
  if (!info) return '';
  if (info.mine) return info.waitingFor.length > 1 ? 'Your move (and others)' : 'Your move';
  const names = info.waitingFor.map((id) => nameOf(session, id));
  if (names.length === 0) return 'Auto-play in';
  if (names.length > 2) return `Waiting for ${names.length} players`;
  return `Waiting for ${names.join(' & ')}`;
}

/** The timer's fixed accessible name (the seconds are in its text, not rewritten into the label 4x a second). */
export const TIMER_LABEL = 'Decision timer';

export function TimerBar({ session, className = '' }) {
  const info = useClock(session);
  if (!info) return null;
  // the Snatch window is its own countdown (the pop-up's ring and seconds); a second "Your move 6s" bar would only disagree with it
  if (session?.view?.phase === 'snatch' && session.view.pending?.type === 'snatch') return null;
  const label = waitLabel(session, info);
  return (
    <div
      className={`tt-bar${info.mine ? ' is-mine' : ''}${info.warn ? ' is-warn' : ''} ${className}`.trim()}
      role="timer"
      aria-label={TIMER_LABEL}
    >
      {/* readable on demand; never announced (role=timer is not live) and the label stays fixed while it ticks.
          The one "10 seconds left" line comes from the table's live region (GameView). */}
      <span className="tt-bar__txt">
        <span className="tt-bar__who">{label}</span>
        <b className="tt-bar__secs">{info.secs}s</b>
      </span>
      <span className="tt-bar__track" aria-hidden="true">
        <i className="tt-bar__fill" style={{ transform: `scaleX(${info.frac})` }} />
      </span>
    </div>
  );
}

export default TimerBar;
