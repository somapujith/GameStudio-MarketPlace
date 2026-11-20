// Connection strength ("wifi bars"): turns a round-trip time into 1..4 bars. Pure and shared: the client measures
// its own RTT over the room socket, the Worker turns the reported number into the same level for everybody else.
//
//   level 4  <= 90 ms   Excellent        level 2  <= 350 ms  Fair
//   level 3  <= 180 ms  Good             level 1  > 350 ms   Poor
//   level 0  = offline (no live socket); `null` = nothing measured yet ("measuring")
//
// Presence data only: nothing in here touches the engine or the saved room record.

/** Upper bound (ms, inclusive) of each level, best first. Level 1 has no upper bound. */
export const SIGNAL_LEVELS = Object.freeze([
  Object.freeze({ level: 4, key: 'excellent', label: 'Excellent', maxRtt: 90, color: 'sg-4' }),
  Object.freeze({ level: 3, key: 'good', label: 'Good', maxRtt: 180, color: 'sg-3' }),
  Object.freeze({ level: 2, key: 'fair', label: 'Fair', maxRtt: 350, color: 'sg-2' }),
  Object.freeze({ level: 1, key: 'poor', label: 'Poor', maxRtt: Infinity, color: 'sg-1' }),
]);

export const MAX_RTT = 20000; // anything above this is not a measurement
export const SMOOTH_WINDOW = 3; // samples the median looks at: one slow packet is ignored, a lasting change shows after two more pings (~8 s at one ping per 4 s)
export const HYSTERESIS = 0.12; // a level is kept until the rtt is 12% past its edge (no flicker around 90 / 180 / 350 ms)

const BY_LEVEL = new Map(SIGNAL_LEVELS.map((l) => [l.level, l]));

const OFFLINE = Object.freeze({ level: 0, key: 'offline', label: 'Offline', maxRtt: null, color: 'sg-off' });
const UNKNOWN = Object.freeze({ level: null, key: 'measuring', label: 'Measuring', maxRtt: null, color: 'sg-none' });

/** A usable round-trip time: a finite number 0..MAX_RTT. */
export const isRtt = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_RTT;

/**
 * 1..4 bars for a round-trip time in ms, or null when `rtt` is not a measurement.
 * `prev` (the level shown right now) adds hysteresis: it is kept while the rtt stays within 12% of its band.
 */
export function rttToLevel(rtt, prev = null) {
  if (!isRtt(rtt)) return null;
  let raw = 1;
  for (const l of SIGNAL_LEVELS) {
    if (rtt <= l.maxRtt) {
      raw = l.level;
      break;
    }
  }
  const p = BY_LEVEL.get(prev);
  if (!p || p.level === raw) return raw;
  const hi = p.maxRtt * (1 + HYSTERESIS); // Infinity stays Infinity
  const upper = BY_LEVEL.get(p.level + 1); // the better level next to it: its edge is this band's lower bound
  const lo = upper ? upper.maxRtt * (1 - HYSTERESIS) : 0;
  return rtt > lo && rtt <= hi ? p.level : raw;
}

/** `{ level, key, label, maxRtt, color }` for 0 (offline), 1..4, or null / anything else (measuring). `color` is a CSS token name. */
export function levelInfo(level) {
  if (level === 0) return OFFLINE;
  return BY_LEVEL.get(level) || UNKNOWN;
}

/** Median of the last `window` (default 3) valid samples (robust against one slow packet), or null when there is none. */
export function smoothRtt(samples, window = SMOOTH_WINDOW) {
  if (!Array.isArray(samples)) return null;
  const good = samples.filter(isRtt).slice(-Math.max(1, window));
  if (!good.length) return null;
  const sorted = [...good].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m);
}

/** "about 120 ms" (rounded to 10 ms) or "under 10 ms". */
export function rttText(rtt) {
  if (!isRtt(rtt)) return '';
  if (rtt < 10) return 'under 10 ms';
  return `about ${Math.round(rtt / 10) * 10} ms`;
}

/** Words for a screen reader: "Connection: good, 3 of 4 bars, about 120 ms". */
export function signalSentence(level, rtt) {
  const info = levelInfo(level);
  if (level === 0) return 'Connection: offline';
  if (!info.level) return 'Connection: measuring';
  const t = rttText(rtt);
  return `Connection: ${info.label.toLowerCase()}, ${info.level} of 4 bars${t ? `, ${t}` : ''}`;
}
