// What a connection-strength indicator shows for one player. Pure and unit-tested; <SignalBars> only draws it.
//
//   kind 'none'          nothing to show (not a room member, or an older server that does not report strength)
//   kind 'measuring'     connected, but no number yet (the first seconds): dim bars, no colour
//   kind 'ok'            level 1..4 from the round trip time (`rtt` ms, `stale` = the report is old)
//   kind 'offline'       the server says the player is gone: grey bars with a slash + the red "Offline" pill
//   kind 'reconnecting'  YOUR socket dropped and is retrying: grey bars with a slash + the amber "Reconnecting…" pill
import { levelInfo, signalSentence } from '@shared/signal.js';

const NONE = Object.freeze({ kind: 'none', level: null, rtt: null, stale: false });

/**
 * `rp` = the player's entry of `session.roomPlayers` ({ id, connected, net? }) or null.
 * `local` = your own measurement (`useNetStats()`: { status, rtt, level }); only used for `isMe`, so your own bars
 * react at once instead of after the server's echo.
 */
export function signalOf(rp, { isMe = false, local = null } = {}) {
  if (isMe && local && local.status && local.status !== 'idle') {
    if (local.status === 'reconnecting') return { kind: 'reconnecting', level: 0, rtt: null, stale: false };
    if (local.status === 'closed') return { kind: 'offline', level: 0, rtt: null, stale: false };
    if (local.status === 'open' && local.level != null) return { kind: 'ok', level: local.level, rtt: local.rtt ?? null, stale: false };
    return { kind: 'measuring', level: null, rtt: null, stale: false };
  }
  if (!rp) return NONE;
  if (rp.connected === false) return { kind: 'offline', level: 0, rtt: null, stale: false };
  const net = rp.net;
  if (!net || typeof net !== 'object') return NONE; // a server that predates `net`: show nothing rather than a bar that never fills
  if (net.q === 0) return { kind: 'offline', level: 0, rtt: null, stale: false };
  if (!Number.isInteger(net.q) || net.q < 1 || net.q > 4) return { kind: 'measuring', level: null, rtt: null, stale: false };
  return { kind: 'ok', level: net.q, rtt: Number.isFinite(net.rtt) ? net.rtt : null, stale: net.stale === true };
}

/** The short text of the pill beside the bars ('' = no pill). */
export function pillText(sig) {
  if (!sig) return '';
  if (sig.kind === 'offline') return 'Offline';
  if (sig.kind === 'reconnecting') return 'Reconnecting…';
  return '';
}

/** "Connection: good, 3 of 4 bars, about 120 ms" / "Connection: offline" / "Connection: reconnecting" / "Connection: measuring". */
export function signalLabel(sig) {
  if (!sig || sig.kind === 'none') return '';
  if (sig.kind === 'reconnecting') return 'Connection: reconnecting';
  if (sig.kind === 'measuring') return 'Connection: measuring';
  const base = signalSentence(sig.level, sig.rtt);
  return sig.stale ? `${base}, not updated recently` : base;
}

/** Tooltip: "Good connection · about 120 ms", "Offline", "Reconnecting: your connection dropped". */
export function signalTitle(sig) {
  if (!sig || sig.kind === 'none') return '';
  if (sig.kind === 'offline') return 'Offline: lost connection';
  if (sig.kind === 'reconnecting') return 'Reconnecting: your connection dropped';
  if (sig.kind === 'measuring') return 'Measuring the connection…';
  const info = levelInfo(sig.level);
  const ms = Number.isFinite(sig.rtt) ? ` · ${Math.round(sig.rtt)} ms` : '';
  return `${info.label} connection${ms}${sig.stale ? ' (not updated recently)' : ''}`;
}

/** The words a card's own aria-label adds: ", connection good" / ", offline" / ", reconnecting" / "" (nothing worth saying). */
export function signalWords(sig) {
  if (!sig) return '';
  if (sig.kind === 'offline') return 'offline';
  if (sig.kind === 'reconnecting') return 'reconnecting';
  if (sig.kind === 'ok') return `connection ${levelInfo(sig.level).label.toLowerCase()}, ${sig.level} of 4 bars`;
  return '';
}
