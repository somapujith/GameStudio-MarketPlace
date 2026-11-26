import { describe, expect, it } from 'vitest';
import { HINT_KEY, createPointerGuard, hintSeen, markHintSeen, shouldShowLandscapeHint } from './mobileUi.js';

const mem = (init = {}) => {
  const m = { ...init };
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m };
};
const phoneUp = { phone: true, portrait: true, landscape: false };

describe('landscape hint', () => {
  it('shows once, on an upright phone with a touch screen, while playing', () => {
    expect(shouldShowLandscapeHint({ viewport: phoneUp, playing: true, seen: false, touch: true })).toBe(true);
  });
  it('never on desktop, tablets, landscape, paused shifts, mouse devices or after it was seen', () => {
    const base = { viewport: phoneUp, playing: true, seen: false, touch: true };
    expect(shouldShowLandscapeHint({ ...base, viewport: { phone: false, portrait: true, landscape: false } })).toBe(false);
    expect(shouldShowLandscapeHint({ ...base, viewport: { phone: true, portrait: false, landscape: true } })).toBe(false);
    expect(shouldShowLandscapeHint({ ...base, playing: false })).toBe(false);
    expect(shouldShowLandscapeHint({ ...base, touch: false })).toBe(false);
    expect(shouldShowLandscapeHint({ ...base, seen: true })).toBe(false);
    expect(shouldShowLandscapeHint({ ...base, viewport: null })).toBe(false);
  });
  it('remembers that it was seen, and treats blocked storage as seen (never nags)', () => {
    const s = mem();
    expect(hintSeen(s)).toBe(false);
    markHintSeen(s);
    expect(s.m[HINT_KEY]).toBe('1');
    expect(hintSeen(s)).toBe(true);
    expect(hintSeen(null)).toBe(true);
    const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    expect(hintSeen(boom)).toBe(true);
    expect(() => markHintSeen(boom)).not.toThrow();
  });
});

describe('pointer guard (two-finger gestures are ignored)', () => {
  it('a single finger is fine', () => {
    const g = createPointerGuard();
    expect(g.add(1)).toBe('ok');
    expect(g.blocked).toBe(false);
    expect(g.remove(1)).toBe(false);
  });
  it('a second finger blocks the gesture until every finger is up, and the releases do not act', () => {
    const g = createPointerGuard();
    g.add(1);
    expect(g.add(2)).toBe('multi');
    expect(g.blocked).toBe(true);
    expect(g.remove(1)).toBe(true); // still blocked: finger 2 is down
    expect(g.blocked).toBe(true);
    expect(g.add(3)).toBe('multi'); // a new finger during the tail of the pinch is part of it
    expect(g.remove(2)).toBe(true);
    expect(g.remove(3)).toBe(true);
    expect(g.blocked).toBe(false); // all up: the next touch is a normal one
    expect(g.add(4)).toBe('ok');
  });
  it('reset forgets everything (a cancelled touch)', () => {
    const g = createPointerGuard();
    g.add(1);
    g.add(2);
    g.reset();
    expect(g.size).toBe(0);
    expect(g.add(9)).toBe('ok');
  });
});
