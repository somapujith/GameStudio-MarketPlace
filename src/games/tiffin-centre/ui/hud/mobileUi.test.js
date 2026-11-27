import { describe, expect, it } from 'vitest';
import { createPointerGuard } from './mobileUi.js';

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
