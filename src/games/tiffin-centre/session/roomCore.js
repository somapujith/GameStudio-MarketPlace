// Tiffin Centre: the room session WITHOUT React. `useRoomSession` (roomSession.js) feeds one of these from
// `useRoomConnection`; the tests feed it by hand. It turns what the socket delivers (room payloads, states, errors, link
// changes) into the SESSION INTERFACE of docs/TIFFIN_CENTRE_PLAN.md section 4, and keeps our sends under the server's
// 40 messages / 5 s / user limit.
import * as realEngine from '@shared/tiffin-centre/index.js';

const COALESCE = new Set(['move', 'emote']); // only the newest of these matters
/** Server refusals that are not worth a toast: a `move` to where the player already stands. */
const QUIET_ERRORS = new Set(['Already there.']);
const NEVER_FROM_CLIENT = new Set(['tick', 'spawn', 'tutorial-flags']);

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Keeps our traffic under the rate limit. `move` and `emote` are coalesced (the newest wins, and they are spaced out);
 * everything else is sent at once unless we are right at the limit, when it is refused (`false`).
 *   max      budget for ALL messages in `windowMs` that coalesced traffic may use (the rest is kept for real actions)
 *   hardMax  budget real actions may use (the server's limit is 40)
 */
export function createActionLimiter({ send, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, max = 25, hardMax = 36, windowMs = 5000, gaps = { move: 150, emote: 1500 } }) {
  const times = [];
  const lastSent = {};
  const lastTo = { value: undefined };
  const pending = new Map();
  let timer = null;

  const prune = (t) => {
    while (times.length && t - times[0] >= windowMs) times.shift();
  };
  const doSend = (action, t) => {
    const ok = send(action);
    if (ok !== false) {
      times.push(t);
      lastSent[action.type] = t;
      if (action.type === 'move') lastTo.value = action.to === undefined ? null : action.to;
    }
    return ok !== false;
  };

  function flush() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    const t = now();
    prune(t);
    let wait = Infinity;
    for (const [type, action] of [...pending]) {
      if (type === 'move' && (action.to === undefined ? null : action.to) === lastTo.value) {
        pending.delete(type); // already standing there
        continue;
      }
      const ready = (lastSent[type] ?? -Infinity) + (gaps[type] || 0);
      if (t < ready) {
        wait = Math.min(wait, ready - t);
        continue;
      }
      if (times.length >= max) {
        wait = Math.min(wait, Math.max(1, times[0] + windowMs - t));
        continue;
      }
      pending.delete(type);
      doSend(action, t);
    }
    if (pending.size && wait !== Infinity) timer = setTimer(flush, Math.max(1, Math.ceil(wait)));
  }

  return {
    /** Queue or send one action. false = refused (over the budget, or the socket would not take it). */
    push(action) {
      if (COALESCE.has(action.type)) {
        pending.set(action.type, action);
        flush();
        return true;
      }
      const t = now();
      prune(t);
      if (times.length >= hardMax) return false;
      return doSend(action, t);
    },
    flush,
    pendingCount: () => pending.size,
    sentInWindow: () => {
      prune(now());
      return times.length;
    },
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending.clear();
    },
  };
}

/**
 * The session status for a room: 'loading' | 'playing' | 'done' | 'closed' | 'disconnected' | 'error'.
 * A finished game keeps its result whatever happens to the link afterwards (unless the room went back to its lobby).
 */
export function roomStatus({ fatal, connection, room, state }) {
  if (room && room.status === 'lobby') return 'loading'; // back in the lobby (also hides a stale finished game)
  if (state && (state.status === 'done' || state.status === 'closed')) return state.status;
  // The room is over but the engine state never said so: the server called the shift off (everybody was away for too long, or a
  // stuck game was abandoned). Without this the screen would show a frozen stall that still reads `playing`.
  if (room && room.status === 'finished' && state) return 'closed';
  if (fatal) {
    // a link that cannot come back (removed by the host, left on purpose, refused, room closed): no Retry offered
    if (fatal.kind === 'left' || fatal.kind === 'kicked') return 'closed';
    if (fatal.kind === 'join' || fatal.kind === 'closed') return 'error';
    return 'disconnected';
  }
  if (!state) return connection === 'closed' ? 'disconnected' : 'loading';
  if (connection !== 'open') return 'disconnected';
  return 'playing';
}

/** `useRoomConnection` says connecting / open / closed; the session says reconnecting / open / closed. */
export const sessionConnection = (c) => (c === 'open' ? 'open' : c === 'closed' ? 'closed' : 'reconnecting');

/** players for the HUD: the room's seats (names, avatars, who is online), falling back to the game state. */
export function playersOf(room, state) {
  const list = room && Array.isArray(room.players) ? room.players : null;
  if (list) {
    return list.map((p) => ({ id: String(p.id), name: p.name || String(p.id), avatar: p.avatar ?? null, online: p.connected !== false, piece: p.piece, cosmetics: p.cosmetics }));
  }
  if (state && state.players && Array.isArray(state.order)) {
    return state.order.map((id) => ({ id, name: state.players[id].name, avatar: state.players[id].avatar ?? null, online: true }));
  }
  return [];
}

export function createRoomSessionCore({ meId = '', send, leave, engine = realEngine, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), setTimer, clearTimer, validate = true } = {}) {
  let me = String(meId || '');
  let room = null;
  let state = null;
  let tickAt = 0;
  let connection = 'connecting';
  let fatal = null;
  let lastError = null;
  let lastSeq = -1;
  let result = null;
  let disposed = false;
  const subs = new Set();
  const sendMsg = (action) => (typeof send === 'function' ? send({ t: 'action', action }, { queue: false }) : false);
  const limiter = createActionLimiter({ send: sendMsg, now, setTimer, clearTimer });

  const notify = (events = [], extra) => {
    const payload = { state, events, tickAt, ...(extra || {}) };
    for (const fn of [...subs]) {
      try {
        fn(payload);
      } catch {
        /* a bad subscriber must not break the others */
      }
    }
  };

  const status = () => roomStatus({ fatal, connection, room, state });
  // A finished engine state has its own result; a room the server ended without finishing the shift (abandoned) is a closed centre.
  const resultOf = () => {
    if (!state) return null;
    if (engine.isOver(state)) return engine.result(state);
    if (room && room.status === 'finished') return engine.result({ ...state, status: 'closed', stars: 0 });
    return null;
  };

  const session = {
    mode: 'online',
    get meId() { return me; },
    get players() { return playersOf(room, state); },
    get room() { return room; },
    get state() { return state; },
    get tickAt() { return tickAt; },
    get status() { return status(); },
    /** The room is (back) in its lobby: the game screen should navigate to the lobby page. */
    get lobby() { return !!room && room.status === 'lobby'; },
    get connection() { return sessionConnection(connection); },
    get fatal() { return fatal; },
    get lastError() { return lastError; },
    get result() { return result; },
    get tutorial() { return null; },
    dispatch(action) {
      if (!action || typeof action !== 'object' || typeof action.type !== 'string' || NEVER_FROM_CLIENT.has(action.type)) {
        lastError = 'That is not something you can do.';
        return false;
      }
      if (status() !== 'playing') {
        lastError = connection !== 'open' ? 'Reconnecting, hold on.' : 'The game is not running.';
        return false;
      }
      const full = { ...action, playerId: me };
      if (validate && state && !COALESCE.has(action.type)) {
        const r = engine.applyAction(state, full);
        if (r.error) {
          lastError = r.error;
          notify([], { error: r.error });
          return false;
        }
      }
      if (!limiter.push(full)) {
        lastError = 'Easy, easy! Too many taps at once.';
        notify([], { error: lastError });
        return false;
      }
      lastError = null;
      return true;
    },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subs.add(fn);
      return () => subs.delete(fn);
    },
    pause: () => false, // a table runs in real time on the server: nobody can pause it
    resume: () => false,
    restart: () => false,
    quit() {
      limiter.dispose();
      if (typeof leave === 'function') leave();
    },
  };

  return {
    session,
    setMe(id) {
      me = String(id || '');
    },
    setRoom(next) {
      room = next || null;
      result = resultOf();
      notify([]);
    },
    setConnection(next) {
      if (connection === next) return;
      connection = next;
      notify([]);
    },
    setFatal(next) {
      fatal = next || null;
      notify([]);
    },
    /** A rejected action or other server error text (a toast). */
    setError(message) {
      if (message && QUIET_ERRORS.has(String(message))) return;
      lastError = message ? String(message) : null;
      notify([], { error: lastError });
    },
    /** `onState` of useRoomConnection: `{ state, events, seq, fresh }`. */
    handleState({ state: next, events, seq, fresh }) {
      if (disposed || !next) return;
      if (!fresh && typeof seq === 'number' && seq <= lastSeq) return; // duplicate / out of order
      if (typeof seq === 'number') lastSeq = seq;
      if (fresh && typeof seq !== 'number') lastSeq = -1;
      const prevTick = state ? num(state.tick, -1) : -1;
      const first = state === null;
      state = next;
      // the tick clock only moves on a NEW tick (an action echo arrives mid-tick and must not reset the bars)
      if (first || fresh || num(next.tick, -1) !== prevTick) tickAt = now();
      result = resultOf();
      notify(fresh || first ? [] : Array.isArray(events) ? events : [], { fresh: !!fresh });
    },
    /** Undo `dispose()`: React StrictMode (dev) runs mount -> cleanup -> mount on the same hook state, so a disposed core must come back. */
    revive() {
      disposed = false;
    },
    dispose() {
      disposed = true;
      limiter.dispose();
      subs.clear();
    },
    limiter,
  };
}
