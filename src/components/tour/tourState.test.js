import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasSeen, markSeen, resetAllTours, resetTour, tourKey } from './tourState.js';

function fakeStorage() {
  const m = new Map();
  return {
    m,
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

describe('tourState', () => {
  let ls;
  beforeEach(() => {
    ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
    resetAllTours();
  });
  afterEach(() => { vi.unstubAllGlobals(); resetAllTours(); });

  it('keys are versioned per tour', () => {
    expect(tourKey('game')).toBe('tour:v1:game');
    expect(tourKey('game', 'v2')).toBe('tour:v2:game');
  });

  it('remembers a seen tour and can forget it', () => {
    expect(hasSeen('game')).toBe(false);
    markSeen('game');
    expect(hasSeen('game')).toBe(true);
    expect(ls.getItem('tour:v1:game')).toBe('1');
    expect(hasSeen('lobby')).toBe(false);
    resetTour('game');
    expect(hasSeen('game')).toBe(false);
    expect(ls.getItem('tour:v1:game')).toBe(null);
  });

  it('a new tour id (a revision) is shown again', () => {
    markSeen('game');
    expect(hasSeen('game@2')).toBe(false);
  });

  it('resetAllTours only removes tour keys', () => {
    markSeen('a');
    markSeen('b');
    ls.setItem('hyd.settings.v1', '{}');
    resetAllTours();
    expect(hasSeen('a')).toBe(false);
    expect(hasSeen('b')).toBe(false);
    expect(ls.getItem('hyd.settings.v1')).toBe('{}');
  });

  it('never throws when storage throws, and keeps the answer in memory for the visit', () => {
    const boom = () => { throw new Error('denied'); };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom, key: boom, get length() { return boom(); } });
    expect(() => hasSeen('x')).not.toThrow();
    expect(hasSeen('x')).toBe(false);
    expect(() => markSeen('x')).not.toThrow();
    expect(hasSeen('x')).toBe(true);
    expect(() => resetTour('x')).not.toThrow();
    expect(hasSeen('x')).toBe(false);
    markSeen('y');
    expect(() => resetAllTours()).not.toThrow();
    expect(hasSeen('y')).toBe(false);
  });

  it('works with no localStorage at all (SSR)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(hasSeen('z')).toBe(false);
    markSeen('z');
    expect(hasSeen('z')).toBe(true);
  });

  it('ignores an empty id', () => {
    expect(hasSeen('')).toBe(false);
    expect(() => markSeen('')).not.toThrow();
    expect(() => resetTour(undefined)).not.toThrow();
  });
});
