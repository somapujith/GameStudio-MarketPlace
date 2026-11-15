// Connection-strength bookkeeping for one room: what each member's client last reported about its own round-trip
// time (`{t:'net', rtt}`), and the `net` field the `{t:'room'}` message shows for everybody else.
//
// PRESENCE DATA ONLY: it lives in memory, is never written to Durable Object storage, never enters the saved room
// record and never reaches the engine. After a hibernation / eviction it is simply empty again and refills within
// ~10 s because every client reports on its own.
//
//   net: { q: 0..4 | null, rtt: ms | null, stale?: true }
//     q 0     the member is gone: no live socket, or the socket is open but has been silent for NET_LOST_MS (a link that
//             died without a close, e.g. a phone that lost its signal: the client itself gives up on such a socket)
//     q null  connected, nothing reported yet ("measuring")
//     q 1..4  rttToLevel() of the last report, with hysteresis; `stale` when that report is older than NET_STALE_MS
import { isRtt, rttToLevel } from '../shared/signal.js';

export const NET_MIN_GAP_MS = 2_000; // reports closer together than this (per member) are ignored
export const NET_STALE_MS = 15_000; // a socket that is open but silent for this long: the number is shown as stale
export const NET_LOST_MS = 30_000; // ... and for this long: the member counts as gone (3 missed 10 s reports; the reconnect grace)
export const NET_BROADCAST_GAP_MS = 1_000; // at most one `room` broadcast per second because of net changes

/** `rtt` as a whole number of ms when it is a finite number in 0..20000, else null (strings, NaN, negatives, huge values). */
export function parseNetRtt(v) {
  return isRtt(v) ? Math.round(v) : null;
}

export class NetPresence {
  constructor() {
    this.map = new Map(); // userId -> { rtt, q, at }
  }

  /** Store a report. False when it came less than NET_MIN_GAP_MS after the member's previous accepted one. */
  report(id, rtt, now = Date.now()) {
    const prev = this.map.get(id);
    if (prev && now - prev.at < NET_MIN_GAP_MS) return false;
    const q = rttToLevel(rtt, prev ? prev.q : null);
    if (q == null) return false;
    this.map.set(id, { rtt, q, at: now });
    return true;
  }

  forget(id) {
    this.map.delete(id);
  }

  /** Drop everybody who has no live socket any more (`live` = Set of user ids). */
  prune(live) {
    for (const id of [...this.map.keys()]) if (!live.has(id)) this.map.delete(id);
  }

  /** The `net` field of one member. `isLive` = they have an open socket. */
  view(id, isLive, now = Date.now()) {
    if (!isLive) return { q: 0, rtt: null };
    const e = this.map.get(id);
    if (!e) return { q: null, rtt: null };
    const age = now - e.at;
    if (age > NET_LOST_MS) return { q: 0, rtt: null };
    return age > NET_STALE_MS ? { q: e.q, rtt: e.rtt, stale: true } : { q: e.q, rtt: e.rtt };
  }

  /** What a viewer would see change: ids, levels and staleness (rtt alone does not count). */
  static signature(players) {
    return JSON.stringify((players || []).map((p) => [p.id, p.net ? p.net.q : null, p.net && p.net.stale ? 1 : 0]));
  }

  /** The moment (epoch ms) the next live report turns stale, or its member counts as gone; null when nothing will. */
  nextChangeAt(live, now = Date.now()) {
    let next = null;
    for (const [id, e] of this.map) {
      if (!live.has(id)) continue;
      for (const at of [e.at + NET_STALE_MS + 1, e.at + NET_LOST_MS + 1]) {
        if (at > now && (next == null || at < next)) next = at;
      }
    }
    return next;
  }
}
