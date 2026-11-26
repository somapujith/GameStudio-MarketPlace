// Reads the window, applies orientationPolicy.js and publishes a snapshot to subscribers (useSyncExternalStore in useOrientationPolicy.js).
// Plain JS over an injectable `win`, so the event races are tested in node with a fake window and fake timers.
//
// The rotation races it has to survive:
//   - orientationchange and resize both fire, in either order, and iOS can hand out the OLD innerWidth / innerHeight in the first one:
//     every event re-reads; the trailing re-read (SETTLE_MS) and a late one (LATE_MS) correct a stale first answer.
//   - un-gating (the player turned the phone) is applied AT ONCE, so the game resumes the moment the viewport is landscape;
//     gating waits for the next animation frame (the same frame as the resize event, so the screen is up before ResizeObserver callbacks
//     and the paint: the player never sees the game stretched to the new shape) and, without requestAnimationFrame, for SETTLE_MS.
//     Events of one rotation land in one frame and are read once, so a half-updated reading cannot flash the gate.
//   - the virtual keyboard: tracked with the visual viewport and focus (see orientationPolicy.detectKeyboard), never mistaken for a rotation.
import { isCoarsePointer } from '@/lib/mobile.js';
import { deviceIsPortrait, detectKeyboard, isEditableElement, normalizePolicy, resolvePortrait, shouldGate } from './orientationPolicy.js';

export const SETTLE_MS = 40;
export const LATE_MS = 320;

const NONE = Object.freeze({ policy: 'any', gated: false, portrait: false, coarse: false, keyboardOpen: false });

export function createOrientationController({ win = typeof window !== 'undefined' ? window : null, policy = 'landscape' } = {}) {
  let pol = normalizePolicy(policy);
  let snap = NONE;
  let baseH = 0; // the tallest layout height seen at the current width = the page without a keyboard
  let lastW = -1;
  const subs = new Set();
  let attached = null; // () => void
  let settleTimer = null;
  let lateTimer = null;
  let frame = 0;

  const read = () => {
    if (!win) return NONE;
    const doc = win.document;
    const w = Math.round(num(win.innerWidth));
    const h = Math.round(num(win.innerHeight));
    const vv = win.visualViewport;
    const visibleH = Math.min(h || Infinity, vv && vv.height ? Math.round(vv.height) : Infinity);
    if (w !== lastW) {
      lastW = w; // a real rotation / resize: the old baseline no longer applies
      baseH = h;
    } else baseH = Math.max(baseH, h);
    const keyboardOpen = detectKeyboard({ editableFocused: isEditableElement(doc && doc.activeElement), baseH, visibleH: Number.isFinite(visibleH) ? visibleH : h });
    const coarse = isCoarsePointer(win);
    const device = deviceIsPortrait(win);
    const viewport = { w, h };
    const prevPortrait = snap === NONE ? null : snap.portrait;
    const portrait = resolvePortrait({ viewport, portrait: device, keyboardOpen, prevPortrait });
    const gated = shouldGate({ policy: pol, coarse, viewport, portrait: device, keyboardOpen, prevPortrait });
    return { policy: pol, gated, portrait, coarse, keyboardOpen }; // no sizes: a desktop window being dragged must not re-render anything
  };

  const same = (a, b) => a.gated === b.gated && a.portrait === b.portrait && a.coarse === b.coarse && a.keyboardOpen === b.keyboardOpen && a.policy === b.policy;
  const apply = (next) => {
    if (same(snap, next)) return;
    snap = next;
    subs.forEach((fn) => fn());
  };

  /** Re-read now. A change that would START the gate waits for the debounce (`defer`); everything else shows at once. */
  const refresh = (defer = false) => {
    const next = read();
    if (defer && next.gated && !snap.gated) return;
    apply(next);
  };
  const cancelFrame = () => {
    if (frame && win && win.cancelAnimationFrame) win.cancelAnimationFrame(frame);
    frame = 0;
  };
  const schedule = () => {
    refresh(true);
    clearTimeout(settleTimer);
    clearTimeout(lateTimer);
    cancelFrame();
    if (win && typeof win.requestAnimationFrame === 'function') {
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        refresh(false);
      });
    }
    settleTimer = setTimeout(() => refresh(false), SETTLE_MS);
    lateTimer = setTimeout(() => refresh(false), LATE_MS);
  };

  const attach = () => {
    if (!win || !win.addEventListener) return () => {};
    const doc = win.document;
    const vv = win.visualViewport;
    const so = win.screen && win.screen.orientation;
    let mq = null;
    try {
      mq = win.matchMedia ? win.matchMedia('(orientation: portrait)') : null;
    } catch {
      mq = null;
    }
    const on = (t, type) => {
      if (t && t.addEventListener) t.addEventListener(type, schedule);
    };
    const off = (t, type) => {
      if (t && t.removeEventListener) t.removeEventListener(type, schedule);
    };
    on(win, 'resize');
    on(win, 'orientationchange');
    on(win, 'pageshow');
    on(vv, 'resize');
    on(so, 'change');
    on(mq, 'change');
    on(doc, 'focusin'); // the keyboard follows focus
    on(doc, 'focusout');
    return () => {
      off(win, 'resize');
      off(win, 'orientationchange');
      off(win, 'pageshow');
      off(vv, 'resize');
      off(so, 'change');
      off(mq, 'change');
      off(doc, 'focusin');
      off(doc, 'focusout');
      clearTimeout(settleTimer);
      clearTimeout(lateTimer);
      settleTimer = lateTimer = null;
      cancelFrame();
    };
  };

  snap = read(); // the first render already knows the answer
  return {
    getSnapshot: () => snap,
    /** useSyncExternalStore-style: listeners are attached with the first subscriber and removed with the last. */
    subscribe(fn) {
      subs.add(fn);
      if (!attached) {
        attached = attach();
        refresh(false); // it may have changed between the render and the subscription
      }
      return () => {
        subs.delete(fn);
        if (!subs.size && attached) {
          attached();
          attached = null;
        }
      };
    },
    setPolicy(p) {
      const next = normalizePolicy(p);
      if (next === pol) return;
      pol = next;
      refresh(false);
    },
    refresh: () => refresh(false),
    get listening() {
      return !!attached;
    },
  };
}

function num(v) {
  return Number.isFinite(v) ? v : 0;
}
