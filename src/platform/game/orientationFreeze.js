// Freezes every requestAnimationFrame loop of the page while the orientation gate covers a game that has been running.
//
// Why: a game stops ITS OWN loop with useGamePaused(), but a screen is full of other loops that nobody pauses (a minimap redrawing its
// canvas, a menu polling a gamepad, a count-up). Measured on Autowala, upright and "paused": 280 callbacks a second and a fifth of a core
// were still burning behind the screen. Freezing the page's frame callbacks stops all of them at once, without touching any game's code.
//
//   const f = frameFreezer(window);    // one per window; patches requestAnimationFrame / cancelAnimationFrame the first time, lazily
//   f.freeze();                        // from now on a requested callback is queued, not scheduled (ids are negative numbers)
//   f.thaw();                          // the queued callbacks go to the real requestAnimationFrame, in the order they were asked for
//
// Rules it keeps: a callback asked for while frozen runs exactly once after the thaw; cancelAnimationFrame works on a queued id, on an id
// that has been handed to the real scheduler since, and on ordinary ids; callbacks the browser already had scheduled run once more and are
// queued when they ask again. Nothing happens on a desktop: the patch is only installed by the first freeze, and desktop is never gated.
const KEY = '__jalebiFrameFreezer';

/** A game opened upright keeps loading behind the screen; its loops are only frozen after this long (a game that was already on screen: at once). */
export const FREEZE_GRACE_MS = 6000;
export const freezeDelayMs = (seenLive) => (seenLive ? 0 : FREEZE_GRACE_MS);

const NOOP = Object.freeze({ freeze() {}, thaw() {}, get frozen() { return false; }, get queued() { return 0; } });

export function frameFreezer(win = typeof window !== 'undefined' ? window : null) {
  if (!win || typeof win.requestAnimationFrame !== 'function' || typeof win.cancelAnimationFrame !== 'function') return NOOP;
  if (win[KEY]) return win[KEY];

  const realRaf = win.requestAnimationFrame.bind(win);
  const realCaf = win.cancelAnimationFrame.bind(win);
  let frozen = false;
  let next = 0;
  const queued = new Map(); // synthetic (negative) id -> callback
  const handed = new Map(); // synthetic id -> the real id it got on thaw, until it has run

  const raf = (cb) => {
    if (!frozen) return realRaf(cb);
    const id = --next;
    queued.set(id, cb);
    return id;
  };
  const caf = (id) => {
    if (typeof id === 'number' && id < 0) {
      queued.delete(id);
      if (handed.has(id)) {
        realCaf(handed.get(id));
        handed.delete(id);
      }
      return;
    }
    realCaf(id);
  };

  const api = {
    freeze() {
      if (frozen) return;
      frozen = true;
      win.requestAnimationFrame = raf;
      win.cancelAnimationFrame = caf;
    },
    thaw() {
      if (!frozen) return;
      frozen = false; // the wrappers stay installed for good: a stale negative id must still cancel what it stands for
      const pending = [...queued];
      queued.clear();
      for (const [id, cb] of pending) {
        handed.set(id, realRaf((t) => {
          handed.delete(id);
          cb(t);
        }));
      }
    },
    get frozen() {
      return frozen;
    },
    get queued() {
      return queued.size;
    },
  };
  Object.defineProperty(win, KEY, { value: api, configurable: true });
  return api;
}
