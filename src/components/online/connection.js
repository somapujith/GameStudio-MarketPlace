// What the room's connection looks like to a person (pure, unit-tested). The socket layer reports
// 'connecting' | 'open' | 'closed' plus how many reconnect attempts failed in a row; the browser reports
// navigator.onLine. This turns those into ONE state, its words and its tone.

/** 'connecting' | 'open' | 'reconnecting' | 'offline' | 'closed' */
export function linkState({ connection, everOpen = false, offline = false, fatal = null } = {}) {
  if (fatal) return 'closed';
  if (offline) return 'offline';
  if (connection === 'open') return 'open';
  if (connection === 'closed') return 'closed';
  return everOpen ? 'reconnecting' : 'connecting';
}

/** 12000 -> "12s", 65000 -> "1m 05s". */
export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * -> { label, hint, tone: 'good'|'info'|'warn'|'bad', announce, retry }
 * `label` is the chip, `hint` the one quiet line under it, `announce` the screen-reader sentence (only read on a change of
 * state, never every second), `retry` whether a manual "Try now" makes sense.
 */
export function linkCopy(state, { attempt = 0, elapsedMs = 0 } = {}) {
  switch (state) {
    case 'open':
      return { label: 'Connected', hint: '', tone: 'good', announce: 'Connected to the room.', retry: false };
    case 'reconnecting': {
      const bits = [];
      if (attempt > 0) bits.push(`attempt ${attempt}`);
      if (elapsedMs >= 1000) bits.push(formatElapsed(elapsedMs));
      return {
        label: 'Reconnecting',
        hint: `${bits.length ? `${bits.join(' · ')}. ` : ''}Your seat is kept while we retry.`,
        tone: 'warn',
        announce: 'Connection lost. Reconnecting to the room.',
        retry: true,
      };
    }
    case 'offline':
      return {
        label: 'You are offline',
        hint: 'We reconnect the moment your network is back.',
        tone: 'bad',
        announce: 'You are offline. We will reconnect when your network is back.',
        retry: true,
      };
    case 'closed':
      return { label: 'Disconnected', hint: '', tone: 'bad', announce: 'Disconnected from the room.', retry: false };
    default:
      return {
        label: 'Connecting',
        hint: attempt > 1 ? `Still trying (attempt ${attempt}).` : '',
        tone: 'info',
        announce: 'Connecting to the room.',
        retry: attempt > 1,
      };
  }
}
