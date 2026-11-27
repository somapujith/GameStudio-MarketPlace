// The orientation gate's logic, against real device sizes: the pure policy, the controller (rotation races, keyboard, cleanup), the
// fullscreen + lock sequence, the copy and the manifest facts the game page prints.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEVICES, fakeWindow } from './orientation.fakes.js';
import { createOrientationController, LATE_MS, SETTLE_MS } from './orientationController.js';
import { FREEZE_GRACE_MS, frameFreezer, freezeDelayMs } from './orientationFreeze.js';
import { canLockOrientation, canPlayLandscape, createLandscapeLock } from './orientationLock.js';
import {
  deviceIsPortrait,
  detectKeyboard,
  isEditableElement,
  normalizePolicy,
  orientationDetail,
  orientationLabel,
  resolvePortrait,
  shouldGate,
  windowShape,
} from './orientationPolicy.js';
import { gateCopy } from './orientationText.js';
import { detailRows } from './detailModel.js';

const gateOf = (name, over = {}) => {
  const d = DEVICES[name];
  return shouldGate({ policy: 'landscape', coarse: d.coarse, viewport: { w: d.w, h: d.h }, portrait: d.device.startsWith('portrait'), ...over });
};

describe('shouldGate: real devices, policy landscape', () => {
  const table = [
    // [device, gated?]
    ['iPhone 14 portrait', true],
    ['iPhone 14 landscape', false],
    ['iPhone 14 landscape (Safari toolbar)', false],
    ['iPhone SE landscape', false],
    ['Pixel 7 portrait', true],
    ['Pixel 7 landscape', false],
    ['iPad portrait', true], // tablets are gated too
    ['iPad landscape', false],
    ['Galaxy Fold cover, portrait', true],
    ['Galaxy Fold inner, portrait', true],
    ['Galaxy Fold inner, landscape', false],
    ['desktop 1280x800', false],
    ['desktop narrow window 600x900', false], // a portrait desktop window: a mouse is the main pointer, never gated
    ['desktop phone-sized window 390x844', false],
  ];
  for (const [name, gated] of table) {
    it(`${name} -> ${gated ? 'gated' : 'plays'}`, () => {
      expect(gateOf(name)).toBe(gated);
    });
  }

  it('the default policy is landscape', () => {
    expect(shouldGate({ coarse: true, viewport: { w: 390, h: 844 } })).toBe(true);
  });

  it('policy any, an unknown policy and a missing policy value never block a game', () => {
    for (const policy of ['any', 'sideways', '', null, 42]) expect(shouldGate({ policy, coarse: true, viewport: { w: 390, h: 844 } }), String(policy)).toBe(false);
  });

  it('policy portrait is the mirror image (only a touch device in landscape is gated)', () => {
    expect(shouldGate({ policy: 'portrait', coarse: true, viewport: { w: 844, h: 390 } })).toBe(true);
    expect(shouldGate({ policy: 'portrait', coarse: true, viewport: { w: 390, h: 844 } })).toBe(false);
    expect(shouldGate({ policy: 'portrait', coarse: false, viewport: { w: 844, h: 390 } })).toBe(false);
  });
});

describe('shouldGate: the virtual keyboard is not a rotation', () => {
  it('Android portrait, keyboard open, layout shrank to 412x400 (taller than wide no more): still gated', () => {
    // resizes-content browsers shrink the layout viewport; the shape now says "landscape", the device says portrait
    expect(shouldGate({ coarse: true, viewport: { w: 412, h: 400 }, portrait: true, keyboardOpen: true })).toBe(true);
    // the same numbers with no keyboard are a real landscape window
    expect(shouldGate({ coarse: true, viewport: { w: 412, h: 400 }, portrait: false, keyboardOpen: false })).toBe(false);
  });

  it('Android landscape, keyboard open (915x180): not gated', () => {
    expect(shouldGate({ coarse: true, viewport: { w: 915, h: 180 }, portrait: false, keyboardOpen: true })).toBe(false);
  });

  it('keyboard open and no device reading: the previous decision stands', () => {
    const v = { w: 412, h: 400 };
    expect(shouldGate({ coarse: true, viewport: v, portrait: null, keyboardOpen: true, prevPortrait: true })).toBe(true);
    expect(shouldGate({ coarse: true, viewport: v, portrait: null, keyboardOpen: true, prevPortrait: false })).toBe(false);
  });

  it('detectKeyboard needs a focused text field AND a big loss of height', () => {
    expect(detectKeyboard({ editableFocused: true, baseH: 915, visibleH: 560 })).toBe(true);
    expect(detectKeyboard({ editableFocused: false, baseH: 915, visibleH: 560 })).toBe(false); // a collapsing toolbar, not a keyboard
    expect(detectKeyboard({ editableFocused: true, baseH: 915, visibleH: 850 })).toBe(false); // 65 px: a toolbar
    expect(detectKeyboard({ editableFocused: true, baseH: 390, visibleH: 200 })).toBe(true); // landscape phone, keyboard takes half
    expect(detectKeyboard({ editableFocused: true, baseH: 0, visibleH: 0 })).toBe(false);
  });

  it('isEditableElement: text fields yes; buttons, checkboxes and plain elements no', () => {
    expect(isEditableElement({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isEditableElement({ tagName: 'INPUT', type: '' })).toBe(true);
    expect(isEditableElement({ tagName: 'INPUT', type: 'email' })).toBe(true);
    expect(isEditableElement({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableElement({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableElement({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isEditableElement({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isEditableElement({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableElement(null)).toBe(false);
  });
});

describe('hysteresis: a nearly square window does not flicker', () => {
  it('keeps the previous decision inside the 8% band, decides outside it', () => {
    expect(windowShape({ w: 760, h: 780 }, true)).toBe(true);
    expect(windowShape({ w: 760, h: 780 }, false)).toBe(false);
    expect(windowShape({ w: 700, h: 800 }, false)).toBe(true); // 12.5% taller: portrait whatever it was
    expect(windowShape({ w: 800, h: 700 }, true)).toBe(false);
    expect(windowShape({ w: 700, h: 700 }, null)).toBe(true); // CSS says a square window is portrait
    expect(windowShape({ w: 0, h: 0 }, true)).toBeNull();
  });

  it('a split-screen divider dragged through the square never toggles the gate', () => {
    let prev = true; // started portrait (gated)
    const seen = [];
    for (const w of [600, 640, 700, 740, 780, 800, 820, 860, 900]) {
      prev = resolvePortrait({ viewport: { w, h: 800 }, prevPortrait: prev });
      seen.push(prev);
    }
    // portrait up to 8% past square (860 wide against 800 tall); one change only, at the far edge of the band
    expect(seen).toEqual([true, true, true, true, true, true, true, true, false]);
  });

  it('falls back to the device reading, then to "not portrait", when the size is unusable', () => {
    expect(resolvePortrait({ viewport: { w: 0, h: 0 }, portrait: true })).toBe(true);
    expect(resolvePortrait({ viewport: undefined })).toBe(false);
    expect(shouldGate({ coarse: true, viewport: { w: 0, h: 0 } })).toBe(false);
  });
});

describe('small pieces', () => {
  it('normalizePolicy', () => {
    expect(['landscape', 'portrait', 'any', undefined, 'x'].map(normalizePolicy)).toEqual(['landscape', 'portrait', 'any', 'any', 'any']);
  });
  it('deviceIsPortrait reads screen.orientation, then window.orientation, else null', () => {
    expect(deviceIsPortrait(fakeWindow({ device: 'portrait-secondary' }))).toBe(true);
    expect(deviceIsPortrait(fakeWindow({ device: 'landscape-primary' }))).toBe(false);
    expect(deviceIsPortrait({ screen: {}, orientation: 90 })).toBe(false); // old iOS
    expect(deviceIsPortrait({ screen: {}, orientation: 0 })).toBe(true);
    expect(deviceIsPortrait({})).toBeNull();
    expect(deviceIsPortrait(null)).toBeNull();
  });
  it('the game page facts come from the manifest only', () => {
    expect(orientationLabel({ orientation: 'landscape' })).toBe('Best played in landscape');
    expect(orientationLabel({ orientation: 'portrait' })).toBe('Best played upright');
    expect(orientationLabel({})).toBe('');
    expect(orientationLabel({ orientation: 'any' })).toBe('');
    expect(orientationLabel(null)).toBe('');
    expect(orientationDetail({ orientation: 'landscape' })).toBe('Landscape on phones and tablets');
    expect(orientationDetail({})).toBe('');
    const rows = Object.fromEntries(detailRows({ status: 'live', orientation: 'landscape' }).map((r) => [r.label, r.value]));
    expect(rows.Orientation).toBe('Landscape on phones and tablets');
    expect(detailRows({ status: 'live' }).map((r) => r.label)).not.toContain('Orientation');
  });
  it('the screen says everything in English and in Telugu', () => {
    const c = gateCopy('landscape', 'Autowala');
    expect(c.en.title).toBe('Turn your phone sideways');
    expect(c.en.body).toContain('Autowala');
    expect(c.en.back).toBe('Back to the game page');
    for (const k of ['title', 'body', 'hint', 'play', 'back']) {
      expect(c.en[k].length, `en ${k}`).toBeGreaterThan(3);
      expect(c.te[k], `te ${k}`).toMatch(/[ఀ-౿]/); // Telugu script
    }
    expect(gateCopy('portrait').en.title).toMatch(/upright/);
    expect(gateCopy('whatever').en.title).toBe(c.en.title); // unknown -> the landscape copy
  });
});

describe('createOrientationController: the rotation races', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (name, over) => {
    const win = fakeWindow({ ...DEVICES[name], ...over });
    return { win, ctl: createOrientationController({ win, policy: 'landscape' }) };
  };

  it('knows the answer before anything subscribes (the first render is right)', () => {
    expect(make('iPhone 14 portrait').ctl.getSnapshot()).toMatchObject({ gated: true, portrait: true, coarse: true, keyboardOpen: false });
    expect(make('iPhone 14 landscape').ctl.getSnapshot().gated).toBe(false);
    expect(make('desktop 1280x800').ctl.getSnapshot()).toMatchObject({ gated: false, coarse: false });
    expect(make('desktop narrow window 600x900').ctl.getSnapshot().gated).toBe(false);
  });

  it('turning the phone to landscape resumes AT ONCE (no timer needed) and notifies once', () => {
    const { win, ctl } = make('iPhone 14 portrait');
    const fn = vi.fn();
    ctl.subscribe(fn);
    win.set({ w: 844, h: 390, device: 'landscape-primary' });
    win.fire('win', 'resize');
    expect(ctl.getSnapshot().gated).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(LATE_MS + 50); // the trailing re-reads find nothing new: no second notification
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('turning it upright gates after the debounce, not before (no flash on a transient reading)', () => {
    const { win, ctl } = make('iPhone 14 landscape');
    ctl.subscribe(() => {});
    win.set({ w: 390, h: 844, device: 'portrait-primary' });
    win.fire('win', 'resize');
    expect(ctl.getSnapshot().gated).toBe(false);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(ctl.getSnapshot().gated).toBe(false);
    vi.advanceTimersByTime(2);
    expect(ctl.getSnapshot().gated).toBe(true);
  });

  describe('with requestAnimationFrame (a browser): gating lands in the frame of the resize event, before the paint', () => {
    const withFrames = (name) => {
      const frames = [];
      const win = fakeWindow({ ...DEVICES[name] });
      win.requestAnimationFrame = (cb) => frames.push(cb);
      win.cancelAnimationFrame = (i) => {
        frames[i - 1] = null;
      };
      return { win, frames, ctl: createOrientationController({ win, policy: 'landscape' }), run: () => frames.splice(0).forEach((cb) => cb && cb(16)) };
    };

    it('turning it upright gates on the next frame, not 40 ms later', () => {
      const { win, ctl, run } = withFrames('iPhone 14 landscape');
      ctl.subscribe(() => {});
      win.set({ w: 390, h: 844, device: 'portrait-primary' });
      win.fire('win', 'resize');
      expect(ctl.getSnapshot().gated).toBe(false); // not inside the event itself: one frame of grace
      run(); // the frame: before ResizeObserver callbacks and before the paint
      expect(ctl.getSnapshot().gated).toBe(true);
      vi.advanceTimersByTime(0); // no timer was needed
    });

    it('the events of one rotation (orientationchange then resize) are read once, in that frame', () => {
      const { win, ctl, run } = withFrames('iPhone 14 landscape');
      const fn = vi.fn();
      ctl.subscribe(fn);
      win.fire('win', 'orientationchange'); // stale sizes
      win.set({ w: 390, h: 844, device: 'portrait-primary' });
      win.fire('win', 'resize');
      run();
      expect(ctl.getSnapshot().gated).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('a reading that corrects itself before the frame never gates', () => {
      const { win, ctl, run } = withFrames('iPhone 14 landscape');
      const fn = vi.fn();
      ctl.subscribe(fn);
      win.set({ w: 390, h: 844 });
      win.fire('win', 'resize');
      win.set({ w: 844, h: 390 });
      win.fire('win', 'resize');
      run();
      vi.advanceTimersByTime(LATE_MS + 50);
      expect(ctl.getSnapshot().gated).toBe(false);
      expect(fn).not.toHaveBeenCalled();
    });

    it('turning it sideways still resumes inside the event, and the last unsubscribe cancels a waiting frame', () => {
      const { win, ctl, frames } = withFrames('iPhone 14 portrait');
      const off = ctl.subscribe(() => {});
      win.set({ w: 844, h: 390, device: 'landscape-primary' });
      win.fire('win', 'resize');
      expect(ctl.getSnapshot().gated).toBe(false);
      expect(frames.filter(Boolean).length).toBe(1);
      off();
      expect(frames.filter(Boolean).length).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('a transient portrait-looking reading that corrects itself inside the debounce never gates', () => {
    const { win, ctl } = make('iPhone 14 landscape');
    const fn = vi.fn();
    ctl.subscribe(fn);
    win.set({ w: 390, h: 844 }); // mid-resize glitch
    win.fire('win', 'resize');
    vi.advanceTimersByTime(10);
    win.set({ w: 844, h: 390 });
    win.fire('win', 'resize');
    vi.advanceTimersByTime(LATE_MS + 50);
    expect(ctl.getSnapshot().gated).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('iOS hands out stale sizes in orientationchange: the resize that follows fixes it, with no flicker', () => {
    const { win, ctl } = make('iPhone 14 portrait');
    const states = [];
    ctl.subscribe(() => states.push(ctl.getSnapshot().gated));
    win.fire('win', 'orientationchange'); // sizes still portrait
    expect(ctl.getSnapshot().gated).toBe(true);
    win.set({ w: 844, h: 390, device: 'landscape-primary' });
    win.fire('win', 'resize');
    expect(ctl.getSnapshot().gated).toBe(false);
    vi.advanceTimersByTime(LATE_MS + 50);
    expect(states).toEqual([false]);
  });

  it('the late re-read catches a rotation whose events all arrived early', () => {
    const { win, ctl } = make('iPhone 14 portrait');
    ctl.subscribe(() => {});
    win.fire('win', 'orientationchange'); // fired, but nothing has changed yet
    win.set({ w: 844, h: 390, device: 'landscape-primary' }); // the browser catches up with no further event
    vi.advanceTimersByTime(SETTLE_MS + 1);
    expect(ctl.getSnapshot().gated).toBe(false);
  });

  it('the virtual keyboard on a portrait phone does not un-gate it (layout viewport shrinks to 412x400)', () => {
    const input = { tagName: 'INPUT', type: 'text' };
    const { win, ctl } = make('Pixel 7 portrait');
    ctl.subscribe(() => {});
    expect(ctl.getSnapshot().gated).toBe(true);
    win.set({ active: input, h: 400, vvH: 400 }); // the keyboard took 515 px; the shape alone would now say landscape
    win.fire('win', 'resize');
    win.fire('doc', 'focusin');
    vi.advanceTimersByTime(LATE_MS + 50);
    expect(ctl.getSnapshot()).toMatchObject({ keyboardOpen: true, portrait: true, gated: true });
    win.set({ active: null, h: 915, vvH: 915 }); // closed again
    win.fire('doc', 'focusout');
    win.fire('win', 'resize');
    vi.advanceTimersByTime(LATE_MS + 50);
    expect(ctl.getSnapshot()).toMatchObject({ keyboardOpen: false, gated: true });
  });

  it('the keyboard on a landscape phone keeps it in landscape', () => {
    const { win, ctl } = make('Pixel 7 landscape');
    ctl.subscribe(() => {});
    win.set({ active: { tagName: 'TEXTAREA' }, h: 190, vvH: 190 });
    win.fire('win', 'resize');
    vi.advanceTimersByTime(LATE_MS + 50);
    expect(ctl.getSnapshot()).toMatchObject({ keyboardOpen: true, gated: false });
  });

  it('a collapsing browser toolbar (height -70 px, nothing focused) is not a keyboard', () => {
    const { win, ctl } = make('Pixel 7 landscape');
    ctl.subscribe(() => {});
    win.set({ h: 342 });
    win.fire('win', 'resize');
    expect(ctl.getSnapshot()).toMatchObject({ keyboardOpen: false, gated: false });
  });

  it('a desktop window dragged narrow and tall is never gated, and re-renders nothing', () => {
    const { win, ctl } = make('desktop 1280x800');
    const fn = vi.fn();
    ctl.subscribe(fn);
    for (const [w, h] of [[900, 800], [600, 900], [390, 844], [300, 900]]) {
      win.set({ w, h });
      win.fire('win', 'resize');
      vi.advanceTimersByTime(LATE_MS + 50);
      expect(ctl.getSnapshot().gated).toBe(false);
    }
    // portrait flipped once (800 -> 900 tall), nothing else: sizes are not part of the snapshot
    expect(fn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('split-screen: the WINDOW decides, not the device (a landscape device with a tall, narrow window is gated)', () => {
    const { ctl } = make('Pixel 7 landscape', { w: 450, h: 800, device: 'landscape-primary' });
    expect(ctl.getSnapshot().gated).toBe(true);
    const wide = make('Pixel 7 portrait', { w: 412, h: 300, device: 'portrait-primary' }); // a short, wide strip of a portrait device
    expect(wide.ctl.getSnapshot().gated).toBe(false);
  });

  it('a policy change re-evaluates (landscape -> any ungates, -> portrait mirrors)', () => {
    const { ctl } = make('iPhone 14 portrait');
    ctl.subscribe(() => {});
    ctl.setPolicy('any');
    expect(ctl.getSnapshot().gated).toBe(false);
    ctl.setPolicy('portrait');
    expect(ctl.getSnapshot()).toMatchObject({ policy: 'portrait', gated: false });
    ctl.setPolicy('landscape');
    expect(ctl.getSnapshot().gated).toBe(true);
  });

  it('attaches its listeners with the first subscriber and removes EVERY one with the last (and cancels its timers)', () => {
    const { win, ctl } = make('iPhone 14 portrait');
    expect(win.listeners()).toBe(0);
    const off1 = ctl.subscribe(() => {});
    const off2 = ctl.subscribe(() => {});
    expect(win.listeners()).toBeGreaterThanOrEqual(7); // resize, orientationchange, pageshow, visualViewport, screen.orientation, mediaQuery, focusin, focusout
    win.fire('win', 'resize'); // arms the debounce timers
    off1();
    expect(win.listeners()).toBeGreaterThan(0);
    off2();
    expect(win.listeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(ctl.listening).toBe(false);
  });

  it('no window (SSR, a worker): never gated, nothing throws', () => {
    const ctl = createOrientationController({ win: null });
    expect(ctl.getSnapshot().gated).toBe(false);
    const off = ctl.subscribe(() => {});
    off();
  });
});

describe('createLandscapeLock: fullscreen + screen.orientation.lock', () => {
  it('Android Chrome: enters fullscreen, THEN locks landscape; release unlocks and leaves the fullscreen it entered', async () => {
    const win = fakeWindow({ w: 390, h: 844 });
    const lock = createLandscapeLock({ win, doc: win.document });
    expect(lock.supported()).toBe(true);
    expect(await lock.request()).toBe(true);
    expect(win.calls).toEqual(['fullscreen:enter', 'lock:landscape']);
    expect(lock.locked).toBe(true);
    lock.release();
    expect(win.calls).toEqual(['fullscreen:enter', 'lock:landscape', 'unlock', 'fullscreen:exit']);
    lock.release(); // twice is fine
    expect(win.calls.length).toBe(4);
  });

  it('already fullscreen (the game\'s own toggle): locks, and on release leaves the fullscreen alone', async () => {
    const win = fakeWindow({ fullscreen: true });
    const lock = createLandscapeLock({ win, doc: win.document });
    expect(await lock.request()).toBe(true);
    lock.release();
    expect(win.calls).toEqual(['lock:landscape', 'unlock']);
  });

  it('iPhone Safari: no lock API, no fullscreen: unsupported, nothing is attempted, no listeners are added', async () => {
    const win = fakeWindow({ noLock: true, noFullscreen: true });
    const lock = createLandscapeLock({ win, doc: win.document });
    expect(canLockOrientation(win)).toBe(false);
    expect(canPlayLandscape(win)).toBe(false);
    expect(lock.supported()).toBe(false);
    expect(await lock.request()).toBe(false);
    lock.armFirstGesture();
    expect(win.listeners()).toBe(0);
    expect(win.calls).toEqual([]);
  });

  it('iPad Safari (fullscreen yes, lock no): still unsupported, so no button and no pointless fullscreen', async () => {
    const win = fakeWindow({ noLock: true });
    const lock = createLandscapeLock({ win, doc: win.document });
    expect(lock.supported()).toBe(false);
    expect(await lock.request()).toBe(false);
    expect(win.calls).toEqual([]);
  });

  it('a refused lock: false, and release exits only the fullscreen that was entered', async () => {
    const win = fakeWindow({ lockRejects: true });
    const lock = createLandscapeLock({ win, doc: win.document });
    expect(await lock.request()).toBe(false);
    expect(lock.locked).toBe(false);
    lock.release();
    expect(win.calls).toEqual(['fullscreen:enter', 'lock:landscape', 'fullscreen:exit']); // no unlock: nothing was locked
  });

  it('a refused fullscreen still tries the lock (an installed app may allow it) and reports the outcome', async () => {
    const win = fakeWindow({ fullscreenRejects: true, lockRejects: true });
    const lock = createLandscapeLock({ win, doc: win.document });
    expect(await lock.request()).toBe(false);
  });

  it('the first user gesture asks once; later ones do nothing; cancel and release both remove the listeners', async () => {
    const win = fakeWindow({});
    const lock = createLandscapeLock({ win, doc: win.document });
    const done = vi.fn();
    lock.armFirstGesture(done);
    expect(win.listeners()).toBe(4); // pointerup, touchend, click, keydown
    expect(win.calls).toEqual([]);
    win.fire('doc', 'touchend');
    await Promise.resolve();
    await Promise.resolve();
    win.fire('doc', 'click');
    await new Promise((r) => setTimeout(r, 0));
    expect(win.calls).toEqual(['fullscreen:enter', 'lock:landscape']); // once
    expect(done).toHaveBeenCalledWith(true);
    expect(win.listeners()).toBe(0);

    const w2 = fakeWindow({});
    const l2 = createLandscapeLock({ win: w2, doc: w2.document });
    l2.armFirstGesture()();
    expect(w2.listeners()).toBe(0);
    const w3 = fakeWindow({});
    const l3 = createLandscapeLock({ win: w3, doc: w3.document });
    l3.armFirstGesture();
    l3.release(); // leaving the game before any tap
    expect(w3.listeners()).toBe(0);
    expect(w3.calls).toEqual([]);
  });

  it('only a real gesture of the player arms the lock: not a synthetic key, not Escape, not a tap on the gate\'s own Back link', async () => {
    const win = fakeWindow({});
    const lock = createLandscapeLock({ win, doc: win.document });
    const done = vi.fn();
    lock.armFirstGesture(done);
    const back = { closest: (sel) => (sel === '[data-og-back]' ? {} : null) }; // an element inside the Back link
    const other = { closest: () => null };
    win.fire('doc', 'keydown', { key: 'Escape', isTrusted: false }); // the Android Back-button bridge dispatches this
    win.fire('doc', 'keydown', { key: 'Escape', isTrusted: true }); // Escape dismisses, it does not ask for landscape
    win.fire('doc', 'click', { target: back, isTrusted: true }); // "Back to the game page" just leaves
    win.fire('doc', 'touchend', { target: back, isTrusted: true });
    win.fire('doc', 'keydown', { key: 'a', isTrusted: false }); // assistive tech / tests
    await new Promise((r) => setTimeout(r, 0));
    expect(win.calls).toEqual([]);
    expect(win.listeners()).toBe(4); // still waiting for a real gesture
    win.fire('doc', 'pointerup', { target: other, isTrusted: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(win.calls).toEqual(['fullscreen:enter', 'lock:landscape']);
    expect(done).toHaveBeenCalledWith(true);
  });

  it('leaving while the browser is still asking does not leave a lock behind', async () => {
    const win = fakeWindow({});
    const lock = createLandscapeLock({ win, doc: win.document });
    const pending = lock.request();
    lock.release();
    expect(await pending).toBe(false);
    expect(win.calls).not.toContain('lock:landscape');
  });
});

describe('frameFreezer: every animation-frame loop of the page stops while the gate is up', () => {
  // a window with a manual frame clock: `tick()` runs what the "browser" has scheduled
  const rafWindow = () => {
    let id = 0;
    const scheduled = new Map();
    const win = {
      requestAnimationFrame: (cb) => (scheduled.set(++id, cb), id),
      cancelAnimationFrame: (i) => scheduled.delete(i),
    };
    return {
      win,
      scheduled,
      tick(t = 16) {
        const run = [...scheduled];
        scheduled.clear();
        run.forEach(([, cb]) => cb(t));
      },
    };
  };
  // a loop like a minimap's: draws, asks for the next frame
  const loop = (win) => {
    const o = { runs: 0, id: 0 };
    const step = () => {
      o.runs++;
      o.id = win.requestAnimationFrame(step);
    };
    o.id = win.requestAnimationFrame(step);
    return o;
  };

  it('a desktop window never gets patched: nothing happens until the first freeze', () => {
    const { win } = rafWindow();
    const raf = win.requestAnimationFrame;
    frameFreezer(win);
    expect(win.requestAnimationFrame).toBe(raf);
  });

  it('frozen: the loops stop after the frame the browser already had scheduled, and nothing runs until the thaw', () => {
    const r = rafWindow();
    const a = loop(r.win);
    const b = loop(r.win);
    r.tick();
    expect([a.runs, b.runs]).toEqual([1, 1]);
    const f = frameFreezer(r.win);
    f.freeze();
    r.tick(); // the frame that was already scheduled: runs once, asks again, and is queued
    r.tick();
    r.tick();
    expect([a.runs, b.runs]).toEqual([2, 2]);
    expect(f.frozen).toBe(true);
    expect(f.queued).toBe(2);
    expect(r.scheduled.size).toBe(0); // nothing is waiting for a frame: the browser has nothing to wake up for
    f.thaw();
    expect(r.scheduled.size).toBe(2);
    r.tick();
    expect([a.runs, b.runs]).toEqual([3, 3]); // resumed, and still looping
    r.tick();
    expect([a.runs, b.runs]).toEqual([4, 4]);
  });

  it('a callback asked for while frozen runs exactly once after the thaw, in order, with the new frame time', () => {
    const r = rafWindow();
    const f = frameFreezer(r.win);
    f.freeze();
    const seen = [];
    const i1 = r.win.requestAnimationFrame((t) => seen.push(['a', t]));
    const i2 = r.win.requestAnimationFrame((t) => seen.push(['b', t]));
    expect(i1).toBeLessThan(0); // synthetic ids are negative (and truthy, for `if (!raf)` guards)
    expect(i2).not.toBe(i1);
    f.thaw();
    r.tick(99);
    r.tick(115);
    expect(seen).toEqual([['a', 99], ['b', 99]]);
  });

  it('cancelAnimationFrame works on a queued id, on an id already handed to the browser, and on ordinary ids', () => {
    const r = rafWindow();
    const f = frameFreezer(r.win);
    const real = r.win.requestAnimationFrame(() => {}); // before the freeze: a real id
    f.freeze();
    const ran = [];
    const queuedId = r.win.requestAnimationFrame(() => ran.push('queued'));
    const keepId = r.win.requestAnimationFrame(() => ran.push('kept'));
    const lateId = r.win.requestAnimationFrame(() => ran.push('late'));
    r.win.cancelAnimationFrame(queuedId); // cancelled while queued
    r.win.cancelAnimationFrame(real);
    expect(r.scheduled.size).toBe(0);
    f.thaw();
    r.win.cancelAnimationFrame(lateId); // cancelled AFTER the thaw, through its stale negative id
    r.tick();
    expect(ran).toEqual(['kept']);
    expect(keepId).toBeLessThan(0);
  });

  it('freeze and thaw are idempotent, there is one freezer per window, and a window with no rAF gets a harmless one', () => {
    const r = rafWindow();
    const f = frameFreezer(r.win);
    expect(frameFreezer(r.win)).toBe(f);
    f.freeze();
    f.freeze();
    f.thaw();
    f.thaw();
    expect(f.frozen).toBe(false);
    const none = frameFreezer({});
    none.freeze();
    none.thaw();
    expect(none.frozen).toBe(false);
    expect(frameFreezer(null).queued).toBe(0);
  });

  it('a game that was on screen is frozen at once; one opened upright keeps loading for a grace period first', () => {
    expect(freezeDelayMs(true)).toBe(0);
    expect(freezeDelayMs(false)).toBe(FREEZE_GRACE_MS);
    expect(FREEZE_GRACE_MS).toBeGreaterThanOrEqual(4000); // a game's start-up target is 6 s
    expect(FREEZE_GRACE_MS).toBeLessThanOrEqual(10000); // but a phone resting on the screen must not burn for long
  });

  it('after the thaw a plain request goes straight to the browser again', () => {
    const r = rafWindow();
    const f = frameFreezer(r.win);
    f.freeze();
    f.thaw();
    const id = r.win.requestAnimationFrame(() => {});
    expect(id).toBeGreaterThan(0);
    expect(r.scheduled.has(id)).toBe(true);
  });
});
