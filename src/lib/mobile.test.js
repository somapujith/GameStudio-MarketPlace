import { describe, it, expect, vi } from 'vitest';
import {
  isCoarsePointer, hasTouch, viewportInfo, fullscreenSupported, isFullscreen, enterFullscreen, exitFullscreen,
  lockOrientation, unlockOrientation, keepAwake, lockGestures,
} from './mobile.js';

const mm = (map) => (q) => ({ matches: !!map[q], addEventListener() {}, removeEventListener() {} });

describe('touch detection', () => {
  it('a phone (pointer: coarse) is coarse; a desktop with a mouse is not', () => {
    expect(isCoarsePointer({ matchMedia: mm({ '(pointer: coarse)': true }), navigator: { maxTouchPoints: 5 } })).toBe(true);
    expect(isCoarsePointer({ matchMedia: mm({ '(pointer: fine)': true }), navigator: { maxTouchPoints: 0 } })).toBe(false);
    // a touch laptop whose primary pointer is the mouse is not 'coarse'
    expect(isCoarsePointer({ matchMedia: mm({ '(pointer: fine)': true, '(any-pointer: coarse)': true, '(any-pointer: fine)': true }), navigator: { maxTouchPoints: 10 } })).toBe(false);
  });
  it('never throws on a missing or broken window', () => {
    expect(isCoarsePointer(null)).toBe(false);
    expect(isCoarsePointer({ matchMedia() { throw new Error('x'); } })).toBe(false);
    expect(hasTouch(null)).toBe(false);
    expect(hasTouch({ navigator: { maxTouchPoints: 2 } })).toBe(true);
    expect(hasTouch({ ontouchstart: null, navigator: {} })).toBe(true);
  });
});

describe('viewportInfo', () => {
  it('classifies by the short side and uses the visual viewport', () => {
    const phone = viewportInfo({ innerWidth: 390, innerHeight: 844, visualViewport: { width: 390, height: 700 }, matchMedia: mm({}) });
    expect(phone).toMatchObject({ w: 390, h: 700, class: 'phone', phone: true, portrait: true, landscape: false, short: false });
    const sideways = viewportInfo({ innerWidth: 844, innerHeight: 390, matchMedia: mm({ '(pointer: coarse)': true }) });
    expect(sideways).toMatchObject({ class: 'phone', landscape: true, short: true, coarse: true });
    expect(viewportInfo({ innerWidth: 820, innerHeight: 1180, matchMedia: mm({ '(pointer: coarse)': true }) }).class).toBe('tablet');
    expect(viewportInfo({ innerWidth: 820, innerHeight: 1180, matchMedia: mm({ '(pointer: fine)': true }) }).class).toBe('desktop');
    expect(viewportInfo({ innerWidth: 1280, innerHeight: 800, matchMedia: mm({}) }).class).toBe('desktop');
    expect(viewportInfo(null)).toMatchObject({ w: 0, h: 0 });
  });
});

describe('fullscreen, orientation and wake lock', () => {
  it('enters fullscreen where supported and reports false where not (iPhone)', async () => {
    const req = vi.fn().mockResolvedValue();
    const el = { requestFullscreen: req };
    expect(await enterFullscreen(el, {})).toBe(true);
    expect(req).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(await enterFullscreen({}, {})).toBe(false);
    expect(await enterFullscreen({ requestFullscreen: () => Promise.reject(new Error('denied')) }, {})).toBe(false);
    expect(fullscreenSupported({ documentElement: { webkitRequestFullscreen() {} } })).toBe(true);
    expect(fullscreenSupported({ documentElement: {} })).toBe(false);
    expect(isFullscreen({ fullscreenElement: {} })).toBe(true);
    expect(isFullscreen(null)).toBe(false);
    const exit = vi.fn().mockResolvedValue();
    expect(await exitFullscreen({ fullscreenElement: {}, exitFullscreen: exit })).toBe(true);
    expect(await exitFullscreen({ exitFullscreen: exit })).toBe(false);
  });

  it('orientation lock is best effort', async () => {
    const lock = vi.fn().mockResolvedValue();
    expect(await lockOrientation('landscape', { screen: { orientation: { lock } } })).toBe(true);
    expect(lock).toHaveBeenCalledWith('landscape');
    expect(await lockOrientation('landscape', { screen: {} })).toBe(false);
    expect(await lockOrientation('landscape', { screen: { orientation: { lock: () => Promise.reject(new Error('x')) } } })).toBe(false);
    expect(() => unlockOrientation({ screen: {} })).not.toThrow();
  });

  it('keepAwake acquires, re-acquires on visible, and release is idempotent', async () => {
    const release = vi.fn();
    const request = vi.fn().mockResolvedValue({ release });
    const listeners = {};
    const doc = { visibilityState: 'visible', addEventListener: (n, f) => (listeners[n] = f), removeEventListener: vi.fn() };
    const stop = await keepAwake({ document: doc, navigator: { wakeLock: { request } } });
    expect(request).toHaveBeenCalledTimes(1);
    stop();
    expect(release).toHaveBeenCalledTimes(1);
    expect(() => stop()).not.toThrow();
    // unsupported browser: resolves a no-op release
    const noop = await keepAwake({ document: doc, navigator: {} });
    expect(() => noop()).not.toThrow();
  });
});

describe('lockGestures', () => {
  it('blocks pinch / context menu and restores styles', () => {
    const handlers = {};
    const el = { style: { touchAction: 'auto' }, addEventListener: (n, f) => (handlers[n] = f), removeEventListener: (n) => delete handlers[n] };
    const stop = lockGestures(el);
    expect(el.style.touchAction).toBe('none');
    const e = { cancelable: true, preventDefault: vi.fn(), touches: [1, 2] };
    handlers.touchmove(e);
    expect(e.preventDefault).toHaveBeenCalled();
    const one = { cancelable: true, preventDefault: vi.fn(), touches: [1] };
    handlers.touchmove(one);
    expect(one.preventDefault).not.toHaveBeenCalled();
    stop();
    expect(el.style.touchAction).toBe('auto');
    expect(Object.keys(handlers)).toHaveLength(0);
    expect(() => lockGestures(null)()).not.toThrow();
  });
});
