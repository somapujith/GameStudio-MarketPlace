import { useCallback, useEffect, useRef, useState } from 'react';
import { openRoomSocket } from '@/lib/socket.js';
import { netStats } from '@/lib/netStats.js';
import { createNetReporter } from '@/lib/rtt.js';
import { api } from '@/lib/api.js';
import { useAuth } from '@/lib/auth.jsx';
import { isFatalRoomError, roomKey, toConnection } from './gameHelpers.js';
import { localClock } from '@/components/game/turn/clock.js';
import { voiceEntryFromMessage } from '@/components/voice/voiceModel.js';

// Socket + room state for ONE room code, with no game in it: the lobby, the generic online-game page and every
// game plugin build on this. (It lives here, not in lib/session/useOnlineGame.js, so the lobby does not pull
// the Tycoon engine and presenter into its chunk; useOnlineGame.js re-exports it for the plugins.)

const ERROR_TTL = 6000;
const LINK_IDLE = { attempt: 0, since: null, everOpen: false };

/**
 * Socket + room state for ONE room code. No game presentation: the lobby uses this directly.
 *
 * Returns { room, view, chat, connection, link, error, errorId, fatal, send, pickPiece, leave, retry }
 *  - room        the last `{t:'room'}` payload (null until it arrives)
 *  - view        the last `{t:'state'}` engine state (null until a game is running)
 *  - connection  'connecting' | 'open' | 'closed'   (reconnects show up as 'connecting')
 *  - error       transient server error text (auto-clears), `errorId` changes on every new one
 *  - fatal       null | { kind: 'kicked'|'join'|'auth'|'closed'|'left', message, reason? }  (the socket is closed;
 *                reason 'replaced' = the same account opened this room somewhere else)
 *  - link        { attempt, since, everOpen }: failed reconnect attempts in a row, when the link dropped (ms), and whether
 *                it was ever up (presentation only: see connection.js)
 *  - retry()     reconnect now instead of waiting for the backoff timer
 *  - send(msg, {queue})  JSON to the room; queued while connecting unless queue:false
 *  - pickPiece(piece)    lobby only: asks for a free game piece (`{t:'piece', piece}`); false when not connected.
 *                        A taken / unknown piece comes back as a normal `error` (so the caller can roll back).
 *  - leave()     sends {t:'leave'} and closes for good
 *
 * `onState({state, events, seq, fresh, clock})` fires for every state; `fresh` = first state after (re)connect,
 * i.e. the events must NOT be animated. `onChat(entry)` fires once per new chat message.
 */
export function useRoomConnection(code, { onState, onChat } = {}) {
  const { user, loading } = useAuth();
  const uid = user ? String(user.id) : null;
  const [room, setRoom] = useState(null);
  const [view, setView] = useState(null);
  const [chat, setChat] = useState([]);
  const [connection, setConnection] = useState('connecting');
  const [error, setError] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [link, setLink] = useState(LINK_IDLE);
  const sockRef = useRef(null);
  const handlers = useRef({});
  const errorSeq = useRef(0);

  useEffect(() => {
    handlers.current = { onState, onChat };
  });

  useEffect(() => {
    if (!code || !uid) return undefined;
    setRoom(null);
    setView(null);
    setChat([]);
    setError(null);
    setFatal(null);
    setConnection('connecting');
    setLink(LINK_IDLE);

    let alive = true;
    const sock = openRoomSocket(code);
    sockRef.current = sock;
    // Connection strength: the socket measures its round trips; the store feeds your own bars, the reporter tells the room.
    netStats.reset();
    netStats.setStatus(sock.status);
    const reporter = createNetReporter({ send: (msg) => sock.send(msg, { queue: false }) });
    const st = { fresh: true, gotRoom: false, lastSeq: -1, diagnosing: false, seen: new Set(), roomKey: null };

    const fail = (kind, message, reason) => {
      if (!alive) return;
      setFatal((cur) => cur || (reason ? { kind, message, reason } : { kind, message })); // keep the first (most specific) reason
      setConnection('closed');
      sock.close();
    };

    // The server closes with its own codes when it refuses us: 4001 sign in, 4003/4004 not allowed / not found,
    // 4009 replaced by another tab. Turn them into a clear message instead of reconnecting forever.
    const failFromClose = (info) => {
      const reason = info && info.closeReason ? String(info.closeReason) : '';
      switch (info && info.code) {
        case 4001:
          return fail('auth', 'Your session expired. Please sign in again.');
        case 4003:
          return fail('join', reason || 'You cannot join this room.');
        case 4004:
          return fail('join', reason || 'That room does not exist.');
        case 4009:
          return fail('closed', 'This room was opened in another tab or device.', 'replaced');
        default:
          return fail('closed', 'The connection to the room was closed.');
      }
    };

    // After a few failed connection attempts, find out WHY (signed out? room gone?) instead of spinning forever.
    const diagnose = async () => {
      if (st.diagnosing || !alive) return;
      st.diagnosing = true;
      try {
        const me = await api.get('/api/me');
        if (!alive) return;
        if (!me || !me.user) {
          fail('auth', 'Your session expired. Please sign in again.');
          return;
        }
        const info = await api.get(`/api/rooms/${encodeURIComponent(code)}`);
        if (!alive) return;
        if (info && info.exists === false) fail('join', 'That room no longer exists.');
      } catch {
        /* offline / Worker down: keep retrying quietly */
      } finally {
        st.diagnosing = false;
      }
    };

    const onMessage = (msg) => {
      switch (msg.t) {
        case 'room': {
          if (!msg.room) break;
          st.gotRoom = true;
          if (msg.room.status === 'lobby') st.lastSeq = -1;
          const key = roomKey(msg.room);
          if (key === null || key !== st.roomKey) {
            st.roomKey = key;
            setRoom(msg.room);
          }
          break;
        }
        case 'state': {
          const { state, events, seq } = msg;
          const clock = localClock(msg.clock, msg.now); // countdown in this device's time, whatever its clock says
          if (!state) break;
          const list = Array.isArray(events) ? events : [];
          // only the first state after (re)connect is a snapshot; an applied action without events (a sealed bid) is not
          const fresh = st.fresh;
          if (!fresh && typeof seq === 'number' && seq <= st.lastSeq) break; // duplicate / out-of-order
          st.fresh = false;
          if (typeof seq === 'number') st.lastSeq = seq;
          // presenter first, then `view`: the board must never render a state its display has not got yet
          handlers.current.onState?.({ state, events: list, seq, fresh, clock: clock ?? null });
          setView(state);
          break;
        }
        case 'chat': {
          const id = msg.id ?? `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
          if (st.seen.has(id)) break;
          st.seen.add(id);
          const entry = { id, from: msg.from, text: typeof msg.text === 'string' ? msg.text : '' };
          if (msg.emote) entry.emote = msg.emote;
          if (typeof msg.name === 'string') entry.name = msg.name;
          if (typeof msg.ts === 'number') entry.ts = msg.ts;
          setChat((cur) => [...cur, entry].slice(-100));
          handlers.current.onChat?.(entry);
          break;
        }
        case 'voice': {
          // A voice line someone played (soundboard). Looked up in the catalogue; an unknown id or a replay is dropped.
          // It shows up in the history like an emote and VoiceHost (components/voice) plays it. Never touches game state.
          const entry = voiceEntryFromMessage(msg);
          if (!entry || st.seen.has(entry.id)) break;
          st.seen.add(entry.id);
          setChat((cur) => [...cur, entry].slice(-100));
          break;
        }
        case 'error': {
          const message = String(msg.message || 'Something went wrong');
          // Before the first {t:'room'} an error always means the server refused us (it follows with a close).
          // Afterwards errors are rejected actions ("Not your turn", "The room is full.") = toasts, except
          // the room expiring under us.
          if (!st.gotRoom) fail('join', message);
          else if (isFatalRoomError(message)) fail('closed', message);
          else {
            errorSeq.current += 1;
            setError({ id: errorSeq.current, message });
          }
          break;
        }
        case 'kicked':
          fail('kicked', 'The host removed you from this room.');
          break;
        default:
      }
    };

    const offs = [
      sock.on('open', () => {
        st.fresh = true; // the next state is a snapshot, not a live update
        reporter.reset(); // a new connection reports as soon as it has measured something
        setConnection('open');
        setLink({ attempt: 0, since: null, everOpen: true });
      }),
      sock.on('rtt', (rtt) => {
        netStats.setRtt(rtt);
        reporter.rtt(rtt);
      }),
      sock.on('status', (s, info) => {
        netStats.setStatus(s);
        setConnection(toConnection(s));
        if (s === 'reconnecting' && info) setLink((l) => ({ ...l, attempt: info.attempt || l.attempt + 1, since: l.since ?? Date.now() }));
        if (s === 'closed' && info && info.reason && info.reason !== 'client') {
          failFromClose(info);
        } else if (s === 'reconnecting' && !st.gotRoom && info && info.attempt % 3 === 0) {
          diagnose();
        }
      }),
      sock.on('message', onMessage),
    ];

    return () => {
      alive = false;
      offs.forEach((off) => off());
      netStats.reset();
      sock.close();
      if (sockRef.current === sock) sockRef.current = null;
    };
  }, [code, uid]);

  // transient errors clear themselves
  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(null), ERROR_TTL);
    return () => clearTimeout(t);
  }, [error]);

  const send = useCallback((msg, opts) => (sockRef.current ? sockRef.current.send(msg, opts) : false), []);

  const pickPiece = useCallback((piece) => (typeof piece === 'string' && piece && sockRef.current ? sockRef.current.send({ t: 'piece', piece }, { queue: false }) : false), []);

  // "Try now": skip the rest of the backoff wait (the socket also does this by itself when the network returns)
  const retry = useCallback(() => {
    const sock = sockRef.current;
    if (sock && typeof sock._kick === 'function') sock._kick();
  }, []);

  const leave = useCallback(() => {
    const sock = sockRef.current;
    if (sock) {
      sock.send({ t: 'leave' }, { queue: false });
      sock.close();
    }
    setConnection('closed');
    setFatal((cur) => cur || { kind: 'left', message: 'You left the room.' });
  }, []);

  const authFatal = !loading && !uid ? { kind: 'auth', message: 'Sign in to join a room.' } : null;

  return {
    room,
    view,
    chat,
    connection: authFatal ? 'closed' : connection,
    link,
    error: error ? error.message : null,
    errorId: error ? error.id : 0,
    fatal: fatal || authFatal,
    send,
    pickPiece,
    leave,
    retry,
  };
}

export default useRoomConnection;
