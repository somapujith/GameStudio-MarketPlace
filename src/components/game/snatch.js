// Snatch (docs/GAME_RULES.md section 9) as the game screen sees it.
//
//   snatchInfo(session)            pure: the open window from the LATEST state (`session.view`), or null
//   snatchSeconds / snatchFraction pure: the countdown numbers (seconds left, 1 -> 0 of the window)
//   snatchWhoLabel(info)           pure: "Meera and Ravi can snatch it!"
//   snatchBannerText(info)         pure: "Ravi bought Madhapur: Meera can snatch it!"  (the passive pop-up line)
//   snatchEligibilityText(info)    pure: what the pop-up tells YOU (why you can, or cannot, press)
//   snatchAnnouncement(info)       pure: the screen-reader line, "Snatch window open for 5 seconds"
//   snatchCount(player) / snatchChipsOn(session)   the token chip next to a piece: its number, and whether to draw chips at all
//   useSnatchClock(info)           the countdown, started when the window first shows up on THIS device
//
// The window is REAL TIME: it is read from `session.view` (the newest authoritative state), never from the presenter's
// delayed `session.display`, so an animation can never eat it. Eligibility comes from `pending.eligible` /
// `pending.claims` (the server redacts claims to [] or [me]); `options.snatch` / `options.snatched` agree with it but are
// blanked while the presenter is busy, so they are honoured, not required.
//
// The clock never reads a device date: it counts `pending.ms` down on the monotonic performance clock from the moment the
// state that opened the window reached this device (so a phone whose own clock is minutes off still shows five seconds).
// A reload in the middle of a window can pass `pending.remainingMs` to resume where the server is.
import { useCallback, useEffect, useRef, useState } from 'react';
import { TILES } from '@shared/board.js';
import { formatINR } from '@shared/format.js';
import { ANIM_MS } from '@shared/timing.js';
import { joinNames } from '@/lib/messages.js';
import { useReducedMotion } from './ui/helpers.js';

export const SNATCH_MS_DEFAULT = 5000;
/** How long the pop-up takes to leave (fade + scale out) once the window is over. */
export const SNATCH_EXIT_MS = 180;
/** The presenter's pauses for the two events (agent A adds the keys to ANIM_MS; the fallbacks keep this working before). */
export const snatchOpenMs = () => ANIM_MS.snatchOpen ?? 300;
export const snatchEndMs = () => ANIM_MS.snatchEnd ?? 1800;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const nameOf = (players, id) => players?.find((p) => p.id === id)?.name || 'Someone';

/** Whole seconds left, rounded UP (so "1" shows until the very end and never "0"). */
export const snatchSeconds = (remainingMs) => Math.max(0, Math.ceil((Number(remainingMs) || 0) / 1000));

/** 1 at the start of the window, 0 at its end. */
export const snatchFraction = (remainingMs, totalMs) => (Number(totalMs) > 0 ? clamp01((Number(remainingMs) || 0) / Number(totalMs)) : 0);

/** The window length: `options.snatch.ms`, else `pending.ms`, else the 5 seconds the rules promise. */
export const snatchLength = (ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? Number(ms) : SNATCH_MS_DEFAULT);

/**
 * The open snatch window, or null. Pure; exported for testing.
 * -> { key, tileId, tile, price, ms, remainingMs, buyerId, buyerName, eligibleIds, eligibleNames,
 *      eligible, pressed, canPress, tokens, meBought }
 *   eligible   I may snatch (I am in `pending.eligible`, not bankrupt)       pressed   I already pressed (sealed)
 *   canPress   eligible and not pressed                                      tokens    my Snatch buttons (the count I hold)
 */
export function snatchInfo(session) {
  const view = session?.view;
  const pend = view?.pending;
  if (!view || view.phase !== 'snatch' || pend?.type !== 'snatch') return null;
  const me = session.me;
  const o = session.options || {};
  const players = view.players || [];
  const mine = players.find((p) => p.id === me);
  const claims = Array.isArray(pend.claims) ? pend.claims : [];
  const ids = Array.isArray(pend.eligible) ? pend.eligible : [];
  const eligible = ids.includes(me) && !mine?.bankrupt;
  const pressed = eligible && (!!o.snatched || claims.includes(me));
  const buyer = players.find((p) => p.id === pend.buyer) || null;
  const meBought = pend.buyer === me;
  const eligibleIds = ids.filter((id) => !players.find((p) => p.id === id)?.bankrupt);
  return {
    key: `${view.turnCount ?? 0}:${pend.tile}:${pend.buyer}`, // one window per tile per turn, like the server's deadline key
    tileId: pend.tile,
    tile: TILES[pend.tile] || null,
    price: pend.price ?? TILES[pend.tile]?.price ?? 0,
    ms: snatchLength(o.snatch?.ms ?? pend.ms),
    remainingMs: Number.isFinite(pend.remainingMs) ? pend.remainingMs : null,
    buyerId: pend.buyer,
    buyerName: meBought ? 'You' : buyer?.name || 'Someone',
    meBought,
    eligibleIds,
    eligibleNames: eligibleIds.map((id) => (id === me ? 'You' : nameOf(players, id))),
    eligible,
    pressed,
    canPress: eligible && !pressed,
    tokens: Number.isFinite(mine?.snatches) ? mine.snatches : 0,
  };
}

/** "Meera can snatch it!" / "Meera and Ravi can snatch it!" / "Nobody can snatch it". The viewer is "You". */
export function snatchWhoLabel(info) {
  if (!info) return '';
  const names = info.eligibleNames;
  if (!names.length) return 'Nobody can snatch it';
  return `${joinNames(names)} can snatch it!`;
}

/** The passive banner line: "Ravi bought Madhapur: Meera can snatch it!". */
export function snatchBannerText(info) {
  if (!info) return '';
  const district = info.tile?.name || 'a district';
  const who = info.buyerName;
  return `${who} bought ${district}: ${snatchWhoLabel(info)}`;
}

/** What the eligible player is told: the district, its price and that it costs them nothing. */
export function snatchEligibilityText(info) {
  if (!info) return '';
  const district = info.tile?.name || 'the district';
  if (info.pressed) return `Locked in. ${district} is yours if nobody else is faster to the bidding`;
  if (info.canPress) return `${district} for free: ${info.buyerName} already paid ${formatINR(info.price)}`;
  if (info.meBought) return `You bought ${district}. Others may snatch it`;
  return `${info.buyerName} bought ${district}. You have no Snatch button`;
}

/** Screen readers: said once when the window opens. */
export function snatchAnnouncement(info) {
  if (!info) return '';
  const secs = Math.max(1, Math.round(info.ms / 1000));
  const open = `Snatch window open for ${secs} ${secs === 1 ? 'second' : 'seconds'}`;
  if (info.canPress) return `${open}. Press Snatch to take ${info.tile?.name || 'the district'} for free`;
  if (info.pressed) return `${open}. Snatch locked in`;
  return `${open}. ${snatchBannerText(info)}`;
}

/** A player's Snatch button count, or null when the game does not carry the rule (no `snatches` on the player). */
export const snatchCount = (player) => (Number.isFinite(player?.snatches) ? Math.max(0, player.snatches) : null);

/** Draw the token chips at all? Hidden when the host turned Snatch off (`cfg.snatches === 0`) and nobody holds a button. */
export function snatchChipsOn(session) {
  const d = session?.display ?? session?.view;
  const players = d?.players || [];
  if (!players.some((p) => snatchCount(p) !== null)) return false;
  const cfg = d?.cfg || session?.view?.cfg || {};
  if (Number(cfg.snatches) === 0) return players.some((p) => (snatchCount(p) || 0) > 0);
  return true;
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * The countdown of `info`'s window: { totalMs, remainingMs, fraction, seconds, done, bind }, or null without a window.
 * Starts when the window first appears on this device.
 *
 * It re-renders its component only when the displayed SECOND changes (6 times per 5 s window), never per frame: the old
 * per-frame setState re-rendered the whole action bar / pop-up 60 times a second, which froze slow browsers during every
 * Snatch. The smooth drain (the ring / bar `--f` custom property) is written straight to the DOM instead: put
 * `ref={clock.bind}` on every element that reads `--f` (at most 20 writes a second, 4 under reduced motion).
 */
export function useSnatchClock(info) {
  const reduced = useReducedMotion();
  const key = info ? info.key : null;
  // the window starts counting when it first shows up on this device, or from where the server already is (a reload mid-window)
  const [boot] = useState(() => now()); // ONE reading for the first render: its countdown is exactly the full window, whatever the load
  const [t0, setT0] = useState({ key, at: boot - snatchUsedMs(info) });
  if (t0.key !== key) setT0({ key, at: now() - snatchUsedMs(info) });
  const [tick, setTick] = useState(boot); // the time of the last whole-second change: what a render shows (the drain between is written to the DOM)
  const els = useRef(new Set());
  const bind = useCallback((el) => {
    if (!el) return undefined;
    els.current.add(el);
    return () => { els.current.delete(el); };
  }, []);
  const latest = useRef({ info, at: boot });
  const at = t0.key === key ? t0.at : now();
  latest.current = { info, at };

  useEffect(() => {
    if (!key) return undefined;
    let raf = 0;
    let timer = 0;
    let stopped = false;
    let lastSecond = null;
    let lastWrite = 0;
    const step = () => {
      if (stopped) return;
      const { info: cur, at: start } = latest.current;
      const t = now();
      if (cur) {
        const c = snatchClockFrom(cur, Math.max(t, start) - start);
        if (c.seconds !== lastSecond) {
          lastSecond = c.seconds;
          setTick(t); // a render only when the number on screen changes
        }
        if (t - lastWrite >= (reduced ? 250 : FRACTION_FRAME_MS) || c.done) {
          lastWrite = t;
          const f = c.fraction.toFixed(4);
          els.current.forEach((el) => el.style.setProperty('--f', f));
        }
      }
      if (reduced) timer = setTimeout(step, 250);
      else raf = requestAnimationFrame(step);
    };
    step();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [key, reduced]);

  if (!info) return null;
  return { ...snatchClockFrom(info, Math.max(tick, at) - at), bind };
}

/** Smallest gap between two direct writes of the drain fraction (20 a second: smooth enough for a 5 s ring, a third of the paints). */
const FRACTION_FRAME_MS = 50;

/** How much of the window the server says is already gone when this device first sees it (a reload mid-window), else 0. Pure. */
export const snatchUsedMs = (info) => (info && info.remainingMs != null ? Math.min(info.ms, Math.max(0, info.ms - info.remainingMs)) : 0);

/** The countdown numbers of `info`'s window after it has been running `elapsedMs`. Pure. */
export function snatchClockFrom(info, elapsedMs) {
  const remainingMs = Math.max(0, info.ms - Math.max(0, Number(elapsedMs) || 0));
  return {
    totalMs: info.ms,
    remainingMs,
    fraction: snatchFraction(remainingMs, info.ms),
    seconds: snatchSeconds(remainingMs),
    done: remainingMs <= 0,
  };
}

/** Is the pop-up wanted? Only while the window is open in the latest state AND the local countdown has not run out. Pure. */
export const snatchLive = (info, clock) => !!info && !(clock && clock.done);

/** Kept for older callers: the key of a window is derived from the state itself now, nothing to record. */
export function recordSnatch() {}
