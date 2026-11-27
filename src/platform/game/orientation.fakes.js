// Test double for `window`: just enough surface for orientationController / orientationLock / the gate (sizes, media queries, visual viewport,
// screen.orientation, focus, fullscreen). Used by the orientation tests only; nothing in the app imports it.

/** A named real device: CSS pixels of the layout viewport and the device's own orientation. */
export const DEVICES = {
  'iPhone 14 portrait': { w: 390, h: 844, coarse: true, device: 'portrait-primary' },
  'iPhone 14 landscape': { w: 844, h: 390, coarse: true, device: 'landscape-primary' },
  'iPhone 14 landscape (Safari toolbar)': { w: 844, h: 340, coarse: true, device: 'landscape-primary' },
  'iPhone SE landscape': { w: 667, h: 375, coarse: true, device: 'landscape-primary' },
  'Pixel 7 portrait': { w: 412, h: 915, coarse: true, device: 'portrait-primary' },
  'Pixel 7 landscape': { w: 915, h: 412, coarse: true, device: 'landscape-primary' },
  'iPad portrait': { w: 820, h: 1180, coarse: true, device: 'portrait-primary' },
  'iPad landscape': { w: 1180, h: 820, coarse: true, device: 'landscape-primary' },
  'Galaxy Fold cover, portrait': { w: 344, h: 754, coarse: true, device: 'portrait-primary' },
  'Galaxy Fold inner, portrait': { w: 690, h: 829, coarse: true, device: 'portrait-primary' },
  'Galaxy Fold inner, landscape': { w: 829, h: 690, coarse: true, device: 'landscape-primary' },
  'desktop 1280x800': { w: 1280, h: 800, coarse: false, device: 'landscape-primary' },
  'desktop narrow window 600x900': { w: 600, h: 900, coarse: false, device: 'landscape-primary' },
  'desktop phone-sized window 390x844': { w: 390, h: 844, coarse: false, device: 'landscape-primary' },
};

/**
 * `spec`: { w, h, coarse, device ('portrait-primary' | ...), vvH (visual viewport height), active (the focused element) }.
 * The returned object has `set(patch)` to change facts and `fire(target, type)` to emit an event, plus `listeners()` (how many are attached).
 */
export function fakeWindow(spec = {}) {
  const facts = { w: 390, h: 844, coarse: true, device: null, vvH: null, active: null, fullscreen: null, ...spec };
  const handlers = new Map(); // `${id}:${type}` -> Set<fn>
  const targetId = new Map();
  let nextId = 0;
  const idOf = (t) => {
    if (!targetId.has(t)) targetId.set(t, ++nextId);
    return targetId.get(t);
  };
  const evt = () => {
    const add = function (type, fn) {
      const k = `${idOf(this)}:${type}`;
      if (!handlers.has(k)) handlers.set(k, new Set());
      handlers.get(k).add(fn);
    };
    const remove = function (type, fn) {
      const s = handlers.get(`${idOf(this)}:${type}`);
      if (s) s.delete(fn);
    };
    return { addEventListener: add, removeEventListener: remove };
  };

  const calls = [];
  const orientation = {
    ...evt(),
    get type() {
      return facts.device || (facts.h >= facts.w ? 'portrait-primary' : 'landscape-primary');
    },
    lock: facts.noLock ? undefined : async (t) => {
      calls.push(`lock:${t}`);
      if (facts.lockRejects) throw new Error('NotSupportedError');
      facts.locked = t;
    },
    unlock: () => {
      calls.push('unlock');
      facts.locked = null;
    },
  };
  if (facts.noLock) delete orientation.lock;
  if (facts.noOrientationApi) delete orientation.type;

  const visualViewport = {
    ...evt(),
    get height() {
      return facts.vvH ?? facts.h;
    },
    get width() {
      return facts.w;
    },
  };
  const documentElement = {
    style: {},
    requestFullscreen: facts.noFullscreen
      ? undefined
      : async () => {
          calls.push('fullscreen:enter');
          if (facts.fullscreenRejects) throw new Error('denied');
          doc.fullscreenElement = documentElement;
        },
  };
  if (facts.noFullscreen) delete documentElement.requestFullscreen;
  const doc = {
    ...evt(),
    documentElement,
    fullscreenElement: facts.fullscreen ? documentElement : null,
    get activeElement() {
      return facts.active;
    },
    exitFullscreen: async () => {
      calls.push('fullscreen:exit');
      doc.fullscreenElement = null;
    },
    visibilityState: 'visible',
  };

  const win = {
    ...evt(),
    document: doc,
    get innerWidth() {
      return facts.w;
    },
    get innerHeight() {
      return facts.h;
    },
    visualViewport,
    screen: facts.noScreenOrientation ? {} : { orientation },
    navigator: { maxTouchPoints: facts.coarse ? 5 : 0 },
    matchMedia(q) {
      const m = {
        '(pointer: coarse)': facts.coarse,
        '(any-pointer: coarse)': facts.coarse,
        '(pointer: fine)': !facts.coarse,
        '(any-pointer: fine)': !facts.coarse,
        '(orientation: portrait)': facts.h >= facts.w,
      }[q];
      return { matches: !!m, media: q, ...evt() };
    },
    calls,
    set(patch) {
      Object.assign(facts, patch);
    },
    fire(target, type, extra) {
      const t = target === 'win' ? win : target === 'doc' ? doc : target === 'vv' ? visualViewport : target === 'so' ? orientation : target;
      const s = handlers.get(`${idOf(t)}:${type}`);
      if (s) [...s].forEach((fn) => fn({ type, ...extra }));
    },
    /** how many listeners are attached right now (all targets) */
    listeners: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
  };
  // matchMedia's per-call objects register against fresh ids; count only the long-lived targets for `listeners()`
  return win;
}
