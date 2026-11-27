import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCoarsePointer } from '@/lib/mobile.js';
import { createTouchMode } from './touchMode.js';

// a fake window: which pointer media queries match, how many touch points, and a record of the listeners
const fakeWin = ({ coarse = false, fine = !coarse, anyCoarse = coarse, anyFine = fine, points = coarse ? 5 : 0, matchMedia = true } = {}) => {
  const listeners = new Map();
  const mqListeners = new Map();
  const state = { coarse, fine, anyCoarse, anyFine };
  const win = {
    navigator: { maxTouchPoints: points },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
    fire: (type, e = {}) => listeners.get(type)?.(e),
    listeners,
    state,
    mqListeners,
  };
  if (matchMedia) {
    win.matchMedia = (q) => ({
      matches: q === '(pointer: coarse)' ? state.coarse : q === '(pointer: fine)' ? state.fine : q === '(any-pointer: coarse)' ? state.anyCoarse : q === '(any-pointer: fine)' ? state.anyFine : false,
      addEventListener: (type, fn) => mqListeners.set(q, fn),
      removeEventListener: (type, fn) => {
        if (mqListeners.get(q) === fn) mqListeners.delete(q);
      },
    });
  }
  return win;
};

describe('createTouchMode: where the touch flag starts', () => {
  it('a phone or tablet (pointer: coarse) is touch from the first frame, so the touch wording shows at once', () => {
    expect(createTouchMode(fakeWin({ coarse: true })).get()).toBe(true);
  });
  it('a mouse machine starts as keyboard and mouse', () => {
    expect(createTouchMode(fakeWin({ coarse: false })).get()).toBe(false);
  });
  it('a screen whose only pointers are coarse counts, even when the primary query is silent', () => {
    expect(createTouchMode(fakeWin({ coarse: false, fine: false, anyCoarse: true, anyFine: false })).get()).toBe(true);
  });
  it('touch points with no media-query verdict at all (an old WebView) count as touch', () => {
    expect(createTouchMode(fakeWin({ points: 5, matchMedia: false })).get()).toBe(true);
    expect(createTouchMode(fakeWin({ points: 0, matchMedia: false })).get()).toBe(false);
  });
  it('a touch laptop (pointer: fine, touch points) is a desktop until it is touched: the shared rule, not a private one', () => {
    const w = fakeWin({ coarse: false, fine: true, points: 10 });
    expect(createTouchMode(w).get()).toBe(isCoarsePointer(w));
    expect(createTouchMode(w).get()).toBe(false);
  });
  it('no window (server render, tests): not touch', () => {
    expect(createTouchMode(null).get()).toBe(false);
  });
});

describe('createTouchMode: it asks the shared isCoarsePointer, so the app can change what "touch-first" means in one place', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/mobile.js');
    vi.resetModules();
  });
  it('follows the shared helper (the Android app makes a screen with touch points coarse even when the WebView says pointer: fine)', async () => {
    vi.resetModules();
    vi.doMock('@/lib/mobile.js', () => ({ isCoarsePointer: vi.fn(() => true) }));
    const mod = await import('./touchMode.js');
    const webViewLikeWindow = fakeWin({ coarse: false, fine: true, points: 5 });
    expect(mod.createTouchMode(webViewLikeWindow).get()).toBe(true);
    const mobile = await import('@/lib/mobile.js');
    expect(mobile.isCoarsePointer).toHaveBeenCalledWith(webViewLikeWindow);
  });
});

describe('createTouchMode: the first touch', () => {
  it('a touch pointer turns it on and tells the subscribers once; a mouse pointer does not', () => {
    const w = fakeWin({ coarse: false });
    const t = createTouchMode(w);
    const seen = vi.fn();
    t.subscribe(seen);
    const stop = t.watch();
    w.fire('pointerdown', { pointerType: 'mouse' });
    expect(t.get()).toBe(false);
    w.fire('pointerdown', { pointerType: 'touch' });
    expect(t.get()).toBe(true);
    w.fire('pointerdown', { pointerType: 'touch' });
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
  });
  it('a touchstart turns it on too (browsers without pointer events)', () => {
    const w = fakeWin({ coarse: false });
    const t = createTouchMode(w);
    t.watch();
    w.fire('touchstart');
    expect(t.get()).toBe(true);
  });
  it('it never switches back off, not even when a mouse is used afterwards', () => {
    const w = fakeWin({ coarse: false });
    const t = createTouchMode(w);
    t.watch();
    w.fire('touchstart');
    w.fire('pointerdown', { pointerType: 'mouse' });
    expect(t.get()).toBe(true);
    t.set(false); // only an explicit set can (nothing in the game does)
    expect(t.get()).toBe(false);
  });
  it('enabling it by hand (the touch controls setting) notifies once and is idempotent', () => {
    const t = createTouchMode(fakeWin({ coarse: false }));
    const seen = vi.fn();
    t.subscribe(seen);
    t.set(true);
    t.set(true);
    expect(seen).toHaveBeenCalledTimes(1);
  });
  it('an unsubscribed listener is not called', () => {
    const t = createTouchMode(fakeWin({ coarse: false }));
    const seen = vi.fn();
    const off = t.subscribe(seen);
    off();
    t.set(true);
    expect(seen).not.toHaveBeenCalled();
  });
  it('watching asks the shared rule again, and follows a pointer media query that flips later', () => {
    const w = fakeWin({ coarse: false });
    const t = createTouchMode(w);
    t.watch();
    expect(t.get()).toBe(false);
    w.state.coarse = true;
    w.state.fine = false;
    w.mqListeners.get('(pointer: coarse)')?.();
    expect(t.get()).toBe(true);
  });
  it('stopping removes every listener it added', () => {
    const w = fakeWin({ coarse: false });
    const t = createTouchMode(w);
    const stop = t.watch();
    expect(w.listeners.size).toBe(2);
    expect(w.mqListeners.size).toBe(1);
    stop();
    expect(w.listeners.size).toBe(0);
    expect(w.mqListeners.size).toBe(0);
  });
  it('a window without addEventListener is tolerated', () => {
    const t = createTouchMode({ navigator: { maxTouchPoints: 0 } });
    expect(() => t.watch()()).not.toThrow();
  });
});
