// Round-trip-time bookkeeping for the room socket (plain JS, no React; socket.js uses it).
//
//   RttTracker      pairs every ping we send with the pong that answers it (a WebSocket delivers in order, so the
//                   oldest unanswered ping is the one a pong belongs to), keeps the last samples and hands out their median.
//   createNetReporter  decides WHEN to tell the room about our connection: when our bars changed, or every 10 s, never
//                   more often than every 2 s (the Worker ignores faster reports anyway).
import { SMOOTH_WINDOW, isRtt, rttToLevel, smoothRtt } from '@shared/signal.js';

export const PROBE_MS = 4000; // one ping every 4 s while the socket is open
export const REPORT_KEEPALIVE_MS = 10000; // ... and a report at least this often, so the others know we are still here
export const REPORT_MIN_GAP_MS = 2000;
const MAX_PENDING = 8;
const MAX_SAMPLES = 12;

export class RttTracker {
  constructor({ window = SMOOTH_WINDOW } = {}) {
    this.window = window;
    this.reset();
  }

  /** A fresh connection starts from nothing: no old samples, no pings still waiting for an answer. */
  reset() {
    this.pending = []; // timestamps of pings that have not been answered yet
    this.samples = [];
  }

  /** A ping just went out. */
  sent(now = Date.now()) {
    if (this.pending.length >= MAX_PENDING) this.pending.shift();
    this.pending.push(now);
  }

  /** A pong came in: the sample (ms) for the oldest waiting ping, or null if we were not waiting for one. */
  received(now = Date.now()) {
    const at = this.pending.shift();
    if (at == null) return null;
    return this.add(Math.max(0, now - at));
  }

  /**
   * The oldest ping has been waiting for at least `after` ms (a pong is late or lost): count the wait itself as a
   * sample (a lower bound of the real RTT), so a link that stops answering sinks to "poor" instead of showing its
   * last good number. Returns that sample, or null.
   */
  late(now = Date.now(), after = PROBE_MS) {
    if (!this.pending.length) return null;
    const age = now - this.pending[0];
    return age >= after ? this.add(age) : null;
  }

  add(sample) {
    if (!isRtt(sample)) return null;
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    return sample;
  }

  /** Median of the last few samples (ms), or null before the first one. */
  get rtt() {
    return smoothRtt(this.samples, this.window);
  }
}

/**
 * `{ rtt(value) -> boolean, reset() }`. `send(msg)` puts `{t:'net', rtt}` on the socket (return false when it could not).
 * Reports go out when the level changed since the last one (with hysteresis) or `keepAliveMs` passed, and never
 * closer together than `minGapMs`.
 */
export function createNetReporter({ send, now = Date.now, minGapMs = REPORT_MIN_GAP_MS, keepAliveMs = REPORT_KEEPALIVE_MS } = {}) {
  let lastAt = -Infinity;
  let lastLevel = null;
  return {
    rtt(value) {
      const level = rttToLevel(value, lastLevel);
      if (level == null || typeof send !== 'function') return false;
      const t = now();
      const since = t - lastAt;
      if (since < minGapMs) return false;
      if (level === lastLevel && since < keepAliveMs) return false;
      if (send({ t: 'net', rtt: Math.round(value) }) === false) return false;
      lastAt = t;
      lastLevel = level;
      return true;
    },
    reset() {
      lastAt = -Infinity;
      lastLevel = null;
    },
  };
}
