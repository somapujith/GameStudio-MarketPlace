import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let settings;
vi.mock('./storage.js', () => ({ loadSettings: () => settings }));

const { buzz, PATTERNS } = await import('./haptics.js');

describe('haptics', () => {
  let vibrate;
  beforeEach(() => {
    settings = { haptics: true, reducedMotion: false };
    vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('has a distinct pattern for every game moment', () => {
    for (const k of ['roll', 'six', 'land', 'buy', 'pay', 'earn', 'card', 'snatchOpen', 'snatchPress', 'snatchWin', 'turn', 'warn', 'win', 'error', 'tick', 'tap']) {
      expect(PATTERNS[k], k).toBeDefined();
    }
    const shapes = Object.values(PATTERNS).map((p) => JSON.stringify(p));
    expect(new Set(shapes).size).toBeGreaterThan(shapes.length - 4); // nearly every event feels different
  });

  it('keeps every pattern short and well-formed', () => {
    for (const [k, p] of Object.entries(PATTERNS)) {
      const list = Array.isArray(p) ? p : [p];
      expect(list.length, k).toBeLessThanOrEqual(16);
      expect(list.every((n) => Number.isFinite(n) && n >= 0 && n <= 400), k).toBe(true);
      expect(list.reduce((a, b) => a + b, 0), k).toBeLessThanOrEqual(700);
    }
  });

  it('vibrates with the named pattern, or a custom one', () => {
    expect(buzz('turn')).toBe(true);
    expect(vibrate).toHaveBeenLastCalledWith(PATTERNS.turn);
    buzz([5, 10, 5]);
    expect(vibrate).toHaveBeenLastCalledWith([5, 10, 5]);
    buzz('nonsense');
    expect(vibrate).toHaveBeenLastCalledWith(PATTERNS.tap);
    buzz();
    expect(vibrate).toHaveBeenLastCalledWith(PATTERNS.tap);
  });

  it('clamps absurd custom patterns', () => {
    buzz([9999, -5, 'x', ...Array(30).fill(10)]);
    const arg = vibrate.mock.calls.at(-1)[0];
    expect(arg.length).toBe(16);
    expect(arg[0]).toBe(400);
    expect(arg[1]).toBe(0);
    expect(arg[2]).toBe(0);
  });

  it('does nothing when haptics are off or reduced motion is on', () => {
    settings = { haptics: false, reducedMotion: false };
    expect(buzz('win')).toBe(false);
    settings = { haptics: true, reducedMotion: true };
    expect(buzz('win')).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('is a silent no-op without navigator.vibrate (iOS, desktop) and when vibrate throws', () => {
    vi.stubGlobal('navigator', {});
    expect(buzz('turn')).toBe(false);
    vi.stubGlobal('navigator', { vibrate: () => { throw new Error('blocked'); } });
    expect(() => buzz('turn')).not.toThrow();
    expect(() => buzz.cancel()).not.toThrow();
    vi.unstubAllGlobals();
    expect(buzz('turn')).toBe(false); // no navigator at all (node)
  });

  it('cancel() stops a running pattern', () => {
    buzz.cancel();
    expect(vibrate).toHaveBeenLastCalledWith(0);
  });
});
