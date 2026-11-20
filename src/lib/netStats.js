// Your OWN connection strength, as measured over the room socket (the others' come from the room message).
// A tiny store (`useNetStats()` for React) so your own pod, the top bar and the lobby seat can show it the moment it
// is measured, without waiting for the server to echo it back.
//
//   status  'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'   (the room socket's status)
//   rtt     median round trip in ms, null until the first pong of this connection
//   level   0..4 for `rtt` (hysteresis); null = not measured yet
//
// useRoomConnection() feeds it; it is reset when the room hook unmounts.
import { useSyncExternalStore } from 'react';
import { rttToLevel, isRtt } from '@shared/signal.js';

const IDLE = Object.freeze({ status: 'idle', rtt: null, level: null });

export function createNetStats() {
  let snap = IDLE;
  const subs = new Set();
  const set = (next) => {
    if (next.status === snap.status && next.rtt === snap.rtt && next.level === snap.level) return;
    snap = Object.freeze(next);
    for (const fn of [...subs]) fn();
  };
  return {
    getSnapshot: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** The socket's status. Anything but 'open' forgets the number: a new connection measures from scratch. */
    setStatus(status) {
      const s = typeof status === 'string' ? status : 'idle';
      if (s === 'open') set({ ...snap, status: s });
      else set({ status: s, rtt: null, level: null });
    },
    /** A new smoothed round trip (ms) from the socket. */
    setRtt(rtt) {
      if (!isRtt(rtt)) return;
      set({ ...snap, rtt, level: rttToLevel(rtt, snap.level) });
    },
    reset() {
      set(IDLE);
    },
  };
}

export const netStats = createNetStats();

/** `{ status, rtt, level }` of the room socket you are connected through. Re-renders when it changes. */
export function useNetStats() {
  return useSyncExternalStore(netStats.subscribe, netStats.getSnapshot, netStats.getSnapshot);
}
