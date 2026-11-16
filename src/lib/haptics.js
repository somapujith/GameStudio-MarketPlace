// Short vibrations for phones (navigator.vibrate). Silently does nothing on desktops, iOS Safari (no vibrate API), when the
// player turned haptics off in settings, or when reduced motion is on.
//
//   buzz('turn')            a named pattern (see PATTERNS)         buzz([ms, pause, ms])   a custom one
//   buzz.cancel()           stop a running pattern (e.g. when a Snatch window closes early)
//
// Patterns are written like a tiny drum part: odd entries vibrate, even entries rest (ms). Keep them short: a phone in a
// pocket should feel a distinct "shape" per event, never a long buzz.
import { loadSettings } from './storage.js';

export const PATTERNS = {
  tap: 10,
  select: 8,
  tick: 6, // the decision timer's last seconds (very light)
  roll: [10, 30, 8, 30, 10], // the shake in the cup (the bounces follow as `bounce`)
  bounce: 16, // the die hits the floor
  land: 24, // dice / pawn landing: one firm knock
  six: [28, 40, 18, 30, 60], // a six: knock, then a little flourish
  step: 5,
  buy: [20, 40, 35], // cha-ching: two quick taps
  sold: [30, 60, 30, 60, 50],
  pay: 40, // you paid rent / a fee
  earn: [15, 40, 15], // you collected money
  card: [14, 40, 22], // a card flips
  powerDraw: [12, 40, 18], // you drew a power card
  powerPlay: [34, 50, 20], // you played one: a firm slam
  powerShield: [22, 30, 22, 30, 50], // your Shield blocked a payment
  powerDouble: [14, 36, 14, 36, 14, 36, 44], // your Double Rent paid out: a run of coins
  powerSwap: [18, 40, 18, 40, 28], // you traded places
  powerSteal: [12, 30, 10, 30, 10, 30, 30], // an extra roll: the rattle
  powerExpire: 12, // one of your cards crumbled
  turn: [30, 60, 30], // it is your turn
  warn: [60, 80, 60], // timer about to run out
  snatchOpen: [40, 50, 40, 50, 40], // the Snatch window opened for you: urgent
  snatchPress: [50], // you pressed it
  snatchWin: [30, 40, 30, 40, 30, 40, 90], // you snatched it
  snatchLost: [70, 80, 40], // it was snatched from you
  bankrupt: [90, 60, 60, 60, 160],
  win: [40, 60, 40, 60, 120],
  error: [50, 60, 50], // a refused action
};

const clampPattern = (p) => {
  if (Array.isArray(p)) return p.slice(0, 16).map((n) => Math.max(0, Math.min(400, Number(n) || 0)));
  return Math.max(0, Math.min(400, Number(p) || 0));
};

function allowed() {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  const s = loadSettings();
  return !!s.haptics && !s.reducedMotion;
}

/** `buzz('turn')` or `buzz([ms, pause, ms])`. Returns true when a vibration was requested. */
export function buzz(kind = 'tap') {
  try {
    if (!allowed()) return false;
    const pattern = Array.isArray(kind) ? kind : PATTERNS[kind] ?? PATTERNS.tap;
    return !!navigator.vibrate(clampPattern(pattern));
  } catch {
    return false;
  }
}

/** Stops whatever is vibrating. */
buzz.cancel = () => {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(0);
  } catch {
    /* ignore */
  }
};
