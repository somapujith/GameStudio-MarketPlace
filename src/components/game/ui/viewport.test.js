// Viewport helpers: which layout, and where the on-screen keyboard is (pure parts; the hooks only wire these up).
import { describe, expect, it } from 'vitest';
import { KEYBOARD_MIN, LAND_QUERY, PHONE_QUERY, keyboardInset, layoutMode } from './viewport.js';

describe('layoutMode', () => {
  it('uses the stacked phone layout in portrait and the side-column layout on its side', () => {
    expect(layoutMode({ phone: true, land: false })).toBe('phone');
    expect(layoutMode({ phone: false, land: true })).toBe('land');
    expect(layoutMode({ phone: false, land: false })).toBe('wide');
  });

  it('lets landscape win on a narrow screen that is also short (iPhone SE on its side)', () => {
    expect(layoutMode({ phone: true, land: true })).toBe('land');
  });

  it('keeps the breakpoints the CSS relies on', () => {
    expect(PHONE_QUERY).toBe('(max-width: 599px)');
    expect(LAND_QUERY).toBe('(orientation: landscape) and (max-height: 520px)');
  });
});

describe('keyboardInset', () => {
  it('is 0 while nothing covers the page', () => {
    expect(keyboardInset({ innerHeight: 844, vvHeight: 844, vvOffsetTop: 0 })).toBe(0);
  });

  it('is the height the keyboard covers at the bottom of the layout viewport', () => {
    expect(keyboardInset({ innerHeight: 844, vvHeight: 520, vvOffsetTop: 0 })).toBe(324);
  });

  it('accounts for iOS panning the visual viewport down while the keyboard is open', () => {
    // visual viewport is 400px tall and scrolled 120px down: the keyboard covers 844 - (120 + 400) = 324
    expect(keyboardInset({ innerHeight: 844, vvHeight: 400, vvOffsetTop: 120 })).toBe(324);
  });

  it('ignores URL-bar sized changes and pinch zoom', () => {
    expect(keyboardInset({ innerHeight: 844, vvHeight: 844 - (KEYBOARD_MIN - 1), vvOffsetTop: 0 })).toBe(0);
    expect(keyboardInset({ innerHeight: 844, vvHeight: 300, vvOffsetTop: 0, scale: 2 })).toBe(0);
  });

  it('is safe with missing numbers', () => {
    expect(keyboardInset({ innerHeight: 0, vvHeight: 0 })).toBe(0);
    expect(keyboardInset({ innerHeight: 800, vvHeight: undefined })).toBe(0);
  });
});
