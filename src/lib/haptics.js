// Short vibrations for phones (navigator.vibrate). Silently does nothing on desktops, iOS Safari,
// when the player turned haptics off in settings, or when reduced motion is on.
import { loadSettings } from './storage.js';

const PATTERNS = {
  tap: 10,
  turn: [30, 60, 30], // it is your turn
  pay: 40, // you paid rent / a fee
  earn: [15, 40, 15], // you collected money
  warn: [60, 80, 60], // timer about to run out
  win: [40, 60, 40, 60, 120],
};

/** `buzz('turn')` or `buzz([ms, pause, ms])`. */
export function buzz(kind = 'tap') {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const s = loadSettings();
    if (!s.haptics || s.reducedMotion) return;
    navigator.vibrate(Array.isArray(kind) ? kind : PATTERNS[kind] ?? PATTERNS.tap);
  } catch {
    /* ignore */
  }
}
