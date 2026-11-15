// The host's editing session for the lobby settings: optimistic UI, debounced sends and the server's answer. Pure (no
// React), so the timing is unit-tested with fake timers; SettingsPanel subscribes to it with useSyncExternalStore.
//
//   commit({ schema, server, patch, delay, key })  an edit: the draft shows at once, the FULL settings message goes out
//                                                  now (delay 0) or after `delay` ms of quiet (-/+ bursts, slider drags)
//   fire()                                         send the waiting message now (a slider let go, a field left)
//   echo()                                         the server's settings changed: it answered what we sent
//   reject(text)                                   the server refused: roll back to its settings, say why by the field
//   current(server)                                the settings to show and to build the next patch on: draft || server
//
// The server's `room.settings` is the truth: a draft only lives while a message is waiting or unanswered, and falls back
// to what the server says when it never answers (`settle`).
import { settingsMessage } from './settings.js';

export const SETTLE = 4000; // ms: if the server never echoes our change, fall back to what it says
export const ERROR_WINDOW = 5000; // ms: a server error this soon after we sent settings is the answer to that edit

export function createEditSession({ send, now = Date.now, settle = SETTLE, errorWindow = ERROR_WINDOW } = {}) {
  let state = { draft: null, inline: null }; // inline: { text, key } = why the server refused the last edit
  const listeners = new Set();
  let pending = null; // the message waiting for its debounce
  let outstanding = 0; // messages sent that the server has not answered yet
  let lastSent = 0;
  let lastKey = null;
  let timer = null;
  let settleTimer = null;

  const set = (next) => {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  };
  const clearTimers = () => {
    clearTimeout(timer);
    clearTimeout(settleTimer);
    timer = settleTimer = null;
  };

  function fire() {
    clearTimeout(timer);
    timer = null;
    const msg = pending;
    if (!msg) return;
    pending = null;
    send(msg);
    outstanding += 1;
    lastSent = now();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      outstanding = 0;
      if (state.draft) set({ draft: null });
    }, settle);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    current: (server) => state.draft || server,
    fire,

    commit({ schema, server, patch, delay = 0, key = null }) {
      const msg = settingsMessage(schema, state.draft || server, patch);
      pending = msg;
      lastKey = key || Object.keys(patch || {})[0] || null;
      set({ draft: msg.settings, inline: null });
      clearTimeout(timer);
      timer = null;
      if (delay) timer = setTimeout(fire, delay);
      else fire();
      return msg;
    },

    // Not while a burst of -/+ taps or a drag is still waiting to be sent: the draft is newer than this echo.
    echo() {
      if (timer) return;
      outstanding = Math.max(0, outstanding - 1);
      if (outstanding === 0 && state.draft) set({ draft: null });
    },

    // Only an edit that is still unanswered (and recent) can be what the server is complaining about.
    reject(text) {
      const mine = outstanding > 0 && now() - lastSent < errorWindow;
      clearTimers();
      pending = null;
      outstanding = 0;
      set({ draft: null, ...(mine && text ? { inline: { text, key: lastKey } } : {}) });
    },

    dismissError() {
      if (state.inline) set({ inline: null });
    },

    dispose: clearTimers,
  };
}
