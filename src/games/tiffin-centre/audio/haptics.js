// Tiffin Centre audio: phone vibration for the game's events. The mapping is pure; the actual vibration goes through the hub's
// src/lib/haptics.js `buzz`, which already honours the haptics setting and reduced motion and never throws.
//
//   hapticFor(event, { meId }) -> number | number[] | null
//   createTiffinHaptics({ buzz, meId, now }) -> { handle(events) -> count, setMe(id), cancel() }

import { buzz as hubBuzz } from '../../../lib/haptics.js';

// Drum-part patterns (vibrate, rest, vibrate...). Short, and a distinct shape per feeling.
export const HAPTIC_PATTERNS = Object.freeze({
  collect: 8, // a light tick: money in the box
  combo: [10, 30, 10],
  burnt: [70, 40, 90], // heavy: you lost a dish
  angry: [35, 55, 35], // double: someone stormed off
  unpaid: [60, 50, 40],
  lifeLost: [95, 50, 55],
  payWarning: [14, 70, 14, 70, 14], // a pulse: the money is about to leave
  shiftEnd: [30, 50, 30, 50, 110],
  gasOut: [90, 40, 110], // heavy: the burners went cold
  inspector: [35, 60, 35], // double: the inspector's verdict
});

/** Events about YOU or about the whole stall. Other players' collects and the like do not buzz your pocket. */
export function hapticFor(ev, { meId = null } = {}) {
  if (!ev || typeof ev.type !== 'string') return null;
  const mine = ev.by == null || meId == null || ev.by === meId;
  switch (ev.type) {
    case 'collect':
      return mine ? HAPTIC_PATTERNS.collect : null;
    case 'combo':
      return HAPTIC_PATTERNS.combo;
    case 'burnt':
      return HAPTIC_PATTERNS.burnt;
    case 'customer-angry':
      return HAPTIC_PATTERNS.angry;
    case 'customer-unpaid':
      return HAPTIC_PATTERNS.unpaid;
    case 'life-lost':
      return HAPTIC_PATTERNS.lifeLost;
    case 'pay-warning':
      return HAPTIC_PATTERNS.payWarning;
    case 'shift-end':
      return HAPTIC_PATTERNS.shiftEnd;
    case 'gas-out':
      return HAPTIC_PATTERNS.gasOut;
    case 'inspector':
      return HAPTIC_PATTERNS.inspector;
    default:
      return null;
  }
}

const WEIGHT = { lifeLost: 3, shiftEnd: 3, gasOut: 2, inspector: 2, burnt: 2, angry: 2, unpaid: 2 };

export function createTiffinHaptics({ buzz = hubBuzz, meId = null, now = () => Date.now(), minGapMs = 90 } = {}) {
  let me = meId;
  let last = -Infinity;
  return {
    setMe(id) {
      me = id;
    },
    /** One buzz per call at most: of a burst of events the strongest wins. Returns how many vibrations were requested (0 or 1). */
    handle(events) {
      if (!Array.isArray(events) || !events.length) return 0;
      let best = null;
      let bestW = -1;
      for (const ev of events) {
        const p = hapticFor(ev, { meId: me });
        if (p == null) continue;
        const key = Object.keys(HAPTIC_PATTERNS).find((k) => HAPTIC_PATTERNS[k] === p);
        const w = WEIGHT[key] || 1;
        if (w > bestW) {
          best = p;
          bestW = w;
        }
      }
      if (best == null) return 0;
      const t = now();
      if (t - last < minGapMs) return 0;
      last = t;
      try {
        buzz(best);
      } catch {
        return 0;
      }
      return 1;
    },
    cancel() {
      try {
        buzz.cancel?.();
      } catch {
        /* ignore */
      }
    },
  };
}
