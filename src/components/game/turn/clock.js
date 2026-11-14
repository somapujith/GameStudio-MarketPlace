// The decision clock (docs/HUSTLE_PLAN.md 3.9): `session.clock = { deadline: epochMs|null, waitingFor: playerId[] }`.
//   clockInfo(clock, me, now)   pure: what the timer shows right now (exported for tests)
//   useClock(session)           re-renders 4x a second while a deadline is running
//   useTurnAlerts(session, onWarn)  one soft warning (sound + buzz + onWarn, e.g. a screen-reader line) per deadline
//                                   when MY time drops to 10 s
import { useEffect, useRef, useState } from 'react';
import { sfx } from '@/lib/sfx.js';
import { buzz } from '@/lib/haptics.js';

export const DECISION_MS = 45_000; // the server's decision timer (after the animation)
export const WARN_MS = 10_000;

// deadline -> the full length the bar drains over (the first remaining time we saw, at least DECISION_MS)
const totals = new Map();
function totalFor(deadline, now) {
  let t = totals.get(deadline);
  if (t == null) {
    t = Math.max(DECISION_MS, deadline - now);
    totals.set(deadline, t);
    if (totals.size > 24) totals.delete(totals.keys().next().value);
  }
  return t;
}

/**
 * -> null (no running clock) | { deadline, leftMs, secs, frac (1 -> 0), waitingFor, mine, warn }
 * `warn` is only ever true for the local player (nobody else needs to be hurried).
 */
export function clockInfo(clock, me, now = Date.now()) {
  const deadline = Number(clock?.deadline);
  if (!Number.isFinite(deadline) || deadline <= 0) return null;
  const waitingFor = Array.isArray(clock?.waitingFor) ? clock.waitingFor.map(String) : [];
  const total = totalFor(deadline, now);
  const leftMs = Math.max(0, deadline - now);
  const mine = !!me && waitingFor.includes(String(me));
  return {
    deadline,
    leftMs,
    secs: Math.ceil(leftMs / 1000),
    frac: Math.max(0, Math.min(1, leftMs / total)),
    waitingFor,
    mine,
    warn: mine && leftMs <= WARN_MS,
  };
}

/** The current epoch ms, refreshed every `ms` while `on`. */
export function useNow(on, ms = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [on, ms]);
  return now;
}

const isOver = (session) => (session?.display?.phase ?? session?.view?.phase) === 'over' || !!session?.result;

export function useClock(session) {
  const clock = session?.clock;
  const running = Number(clock?.deadline) > 0 && !isOver(session);
  const now = useNow(running);
  return running ? clockInfo(clock, session.me, now) : null;
}

/** The screen-reader line for the warning. */
export const WARN_TEXT = '10 seconds left';

/** One `warn` sound + buzz (+ `onWarn()`) per deadline, when the clock waits for ME and 10 s are left. */
export function useTurnAlerts(session, onWarn) {
  const info = useClock(session);
  const warned = useRef(0);
  const cb = useRef(onWarn);
  cb.current = onWarn;
  const deadline = info?.deadline || 0;
  const warn = !!info?.warn && info.leftMs > 0;
  useEffect(() => {
    if (!warn || warned.current === deadline) return;
    warned.current = deadline;
    try { sfx.play('warn'); } catch { /* optional */ }
    buzz('warn');
    try { cb.current?.(WARN_TEXT); } catch { /* optional */ }
  }, [warn, deadline]);
  return info;
}
