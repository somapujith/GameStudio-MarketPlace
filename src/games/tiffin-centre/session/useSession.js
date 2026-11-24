// Tiffin Centre: `useSession(session)` for React screens. Works with a local session and with `useRoomSession`.
//
//   const { state, tickAt, now, status, connection, result, lastError, ... } = useSession(session);
//
// Re-renders on EVERY notification of the session (a tick, an action, a link change) and, while the game is playing, ~10 times
// a second more so that rings and bars follow the clock: `now` (performance.now() at render) minus `tickAt`, over TICK_MS,
// is how far into the current tick we are. The in-between renders are pure clock pulses and are throttled to PULSE_HZ.
import { useEffect, useReducer } from 'react';

export const PULSE_HZ = 10;

const defaultNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/** Everything a screen needs from a session at one moment. Pure: exported for tests. */
export function sessionSnapshot(session, now = defaultNow()) {
  if (!session) {
    return { state: null, tickAt: 0, now, status: 'loading', connection: 'open', result: null, lastError: null, lobby: false, fatal: null, room: null, players: [], tutorial: null, mode: null, meId: '' };
  }
  return {
    state: session.state,
    tickAt: session.tickAt,
    now,
    status: session.status,
    connection: session.connection,
    result: session.result,
    lastError: session.lastError,
    lobby: !!session.lobby,
    fatal: session.fatal || null,
    room: session.room || null,
    players: session.players || [],
    tutorial: session.tutorial || null,
    mode: session.mode,
    meId: session.meId,
  };
}

export function useSession(session, { hz = PULSE_HZ } = {}) {
  const [, bump] = useReducer((n) => (n + 1) % 1e9, 0);

  useEffect(() => {
    if (!session) return undefined;
    return session.subscribe(() => bump());
  }, [session]);

  const playing = !!session && session.status === 'playing';
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(bump, Math.round(1000 / Math.max(1, hz)));
    return () => clearInterval(id);
  }, [session, playing, hz]);

  return sessionSnapshot(session);
}

export default useSession;
