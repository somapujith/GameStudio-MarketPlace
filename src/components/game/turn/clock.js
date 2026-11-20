// The decision clock (docs/HUSTLE_PLAN.md 3.9): `session.clock = { deadline: epochMs|null, waitingFor: playerId[] }`.
//   clockInfo(clock, me, now)   pure: what the timer shows right now (exported for tests)
//   useClock(session)           re-renders once per displayed second while a deadline is running
//   useTurnAlerts(session, onWarn)  one soft warning (sound + buzz + onWarn, e.g. a screen-reader line) per deadline
//                                   when MY time drops to the warning point (15 s, or half of a shorter room timer)
// The bar's full length follows the host rules in `session.view.cfg` (`turnSeconds`, `tradeSeconds`): see timerMs().
import { useEffect, useRef, useState } from 'react';
import { sfx } from '@/lib/sfx.js';
import { buzz } from '@/lib/haptics.js';
import { DECISION_MS, WARN_MS, turnMsOf, tradeMsOf, warnMsFor } from '@shared/timing.js';

export { DECISION_MS, WARN_MS }; // the server's decision timer (after the animation) and the "running out" warning (shared/timing.js)

/**
 * The length of the timer being counted, in ms: the room's host rule `turnSeconds` (`cfg`), or `tradeSeconds` while a trade
 * offer waits for its answer (`state.trade`). Without a config (an older game) the 60 s / 45 s defaults.
 */
export function timerMs(cfg, state = null) {
  return state && state.trade && state.phase !== 'over' ? tradeMsOf(cfg) : turnMsOf(cfg);
}

// deadline -> the full length the bar drains over (the first remaining time we saw, at least the timer's own length)
const totals = new Map();
function totalFor(deadline, now, minMs = DECISION_MS) {
  let t = totals.get(deadline);
  if (t == null) {
    t = Math.max(minMs, deadline - now);
    totals.set(deadline, t);
    if (totals.size > 24) totals.delete(totals.keys().next().value);
  }
  return t;
}

/**
 * -> null (no running clock) | { deadline, leftMs, secs, frac (1 -> 0), waitingFor, mine, warn }
 * `warn` is only ever true for the local player (nobody else needs to be hurried).
 */
/**
 * The server's `deadline` is in SERVER time. A phone whose own clock is minutes off would show a wrong countdown
 * (or "time's up" at once), so shift the deadline into local time using the server's `now` that came with it.
 * The one-way delay (tens of ms) is ignored. Pure; no-op without a usable `serverNow`.
 */
export function localClock(clock, serverNow, localNow = Date.now()) {
  if (!clock || !Number.isFinite(Number(clock.deadline)) || Number(clock.deadline) <= 0) return clock ?? null;
  const skew = Number(serverNow) - localNow;
  if (!Number.isFinite(skew) || Math.abs(skew) < 1500) return clock; // ordinary drift: leave it alone
  return { ...clock, deadline: Number(clock.deadline) - skew };
}

/**
 * `cfg` (the game's `state.cfg`) and `state` are optional: with them the bar's full length is the room's own timer
 * (`turnSeconds`, or `tradeSeconds` for a pending trade) and the warning starts at `warnMsFor(that)`, never more than
 * half of it. Without them the 60 s default and the 15 s warning apply.
 */
export function clockInfo(clock, me, now = Date.now(), cfg = null, state = null) {
  const deadline = Number(clock?.deadline);
  if (!Number.isFinite(deadline) || deadline <= 0) return null;
  const waitingFor = Array.isArray(clock?.waitingFor) ? clock.waitingFor.map(String) : [];
  const timer = timerMs(cfg, state);
  const total = totalFor(deadline, now, timer);
  const leftMs = Math.max(0, deadline - now);
  const mine = !!me && waitingFor.includes(String(me));
  return {
    deadline,
    leftMs,
    secs: Math.ceil(leftMs / 1000),
    frac: Math.max(0, Math.min(1, leftMs / total)),
    waitingFor,
    mine,
    warn: mine && leftMs <= warnMsFor(timer),
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

/** Delay until just after the next whole second of `leftMs` (so the displayed `secs` flips right after the boundary). Pure. */
export function nextSecondDelay(leftMs) {
  const left = Number(leftMs);
  if (!(left > 0)) return 0; // nothing left to count
  return (left % 1000) + SECOND_SLACK_MS;
}
const SECOND_SLACK_MS = 8;

/**
 * The current epoch ms, refreshed once per displayed SECOND of the countdown to `deadline` (not 4x a second), and when the
 * tab becomes visible again. The ring / bar CSS transitions glide between the steps; ticking 4x a second kept every
 * timer re-rendering and repainting a ring on every avatar for the whole turn.
 */
export function useSecondNow(deadline, on) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on || !(Number(deadline) > 0)) return undefined;
    let timer = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      clearTimeout(timer);
      const n = Date.now();
      setNow(n);
      const wait = nextSecondDelay(Number(deadline) - n);
      if (wait > 0) timer = setTimeout(tick, wait);
    };
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) tick();
    };
    tick();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [deadline, on]);
  return now;
}

export function useClock(session) {
  const clock = session?.clock;
  const running = Number(clock?.deadline) > 0 && !isOver(session);
  const now = useSecondNow(Number(clock?.deadline) || 0, running);
  const state = session?.view ?? session?.display ?? null;
  return running ? clockInfo(clock, session.me, now, state?.cfg ?? null, state) : null;
}

/** The screen-reader line for the warning (at the default 60 s timer; see `warnTextFor` for a room's own). */
export const WARN_TEXT = `${Math.round(WARN_MS / 1000)} seconds left`;

/** The same line for a room's own timer: the warning starts at `warnMsFor`, never more than half of the time. */
export const warnTextFor = (cfg, state = null) => `${Math.round(warnMsFor(timerMs(cfg, state)) / 1000)} seconds left`;

/**
 * One look at the clock for the alert loop (pure; exported for tests).
 * `mem` = { warned: deadline|0, tickKey: string }. -> { warn: bool, tick: { secs } | null, mem }
 * `warn`: the one soft warning per deadline when MY time drops to the warning point; `tick`: the soft tick-tock in the
 * last 10 seconds of MY decision (once per displayed second). Never during a Snatch window: its 5 seconds are the
 * pop-up's own countdown, not a decision running out.
 */
export function alertStep(info, snatching, mem = { warned: 0, tickKey: '' }) {
  const deadline = info?.deadline || 0;
  const warn = !!info?.warn && info.leftMs > 0 && !snatching;
  const secs = info?.mine && info.leftMs > 0 && !snatching ? info.secs : 0;
  const next = { ...mem };
  const out = { warn: false, tick: null, mem: next };
  if (warn && mem.warned !== deadline) {
    out.warn = true;
    next.warned = deadline;
  }
  const tickKey = secs ? `${deadline}:${secs}` : '';
  if (tickKey !== mem.tickKey) {
    next.tickKey = tickKey;
    if (secs && secs <= 10) out.tick = { secs };
  }
  return out;
}

/**
 * One `warn` sound + buzz (+ `onWarn()`) per deadline, when the clock waits for ME and 10 s are left, and the tick-tock
 * of the last 10 seconds. It runs on its own timer and holds NO React state: the table (GameView, the board, 36 tiles, the
 * pods) used to re-render 4x a second just to watch this clock, which is what made slow-rendering browsers stutter.
 */
export function useTurnAlerts(session, onWarn) {
  const latest = useRef(session);
  latest.current = session;
  const cb = useRef(onWarn);
  cb.current = onWarn;
  const mem = useRef({ warned: 0, tickKey: '' });
  const deadline = Number(session?.clock?.deadline) || 0;
  const over = isOver(session);
  useEffect(() => {
    if (!(deadline > 0) || over) return undefined;
    const look = () => {
      const s = latest.current;
      const state = s?.view ?? s?.display ?? null;
      const info = clockInfo(s?.clock, s?.me, Date.now(), state?.cfg ?? null, state);
      const r = alertStep(info, s?.view?.phase === 'snatch', mem.current);
      mem.current = r.mem;
      if (r.warn) {
        try { sfx.play('warn'); } catch { /* optional */ }
        buzz('warn');
        try { cb.current?.(warnTextFor(state?.cfg ?? null, state)); } catch { /* optional */ }
      }
      if (r.tick) {
        // a soft tick-tock that climbs as time runs out, a light buzz in the last 3
        try { sfx.play('tick', { tock: r.tick.secs % 2 === 0, urgency: 1 - r.tick.secs / 10 }); } catch { /* optional */ }
        if (r.tick.secs <= 3) buzz('tick');
      }
    };
    look();
    const id = setInterval(look, 250);
    return () => clearInterval(id);
  }, [deadline, over]);
}
