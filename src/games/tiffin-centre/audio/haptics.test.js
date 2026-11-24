import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let hub;
vi.mock('../../../lib/storage.js', () => ({ loadSettings: () => hub, subscribeSettings: () => () => {} }));

const { HAPTIC_PATTERNS, createTiffinHaptics, hapticFor } = await import('./haptics.js');

describe('hapticFor', () => {
  it('collect is a light tick, burnt heavy, angry double, pay-warning a pulse', () => {
    expect(hapticFor({ type: 'collect', by: 'a' }, { meId: 'a' })).toBe(HAPTIC_PATTERNS.collect);
    expect(HAPTIC_PATTERNS.collect).toBeLessThanOrEqual(10);
    const burnt = HAPTIC_PATTERNS.burnt;
    expect(burnt.reduce((a, b) => a + b, 0)).toBeGreaterThan(150);
    expect(HAPTIC_PATTERNS.angry.length).toBe(3); // buzz, rest, buzz
    expect(HAPTIC_PATTERNS.payWarning.length).toBeGreaterThanOrEqual(5); // several pulses
    expect(hapticFor({ type: 'burnt' })).toBe(HAPTIC_PATTERNS.burnt);
    expect(hapticFor({ type: 'customer-angry' })).toBe(HAPTIC_PATTERNS.angry);
    expect(hapticFor({ type: 'pay-warning' })).toBe(HAPTIC_PATTERNS.payWarning);
    expect(hapticFor({ type: 'life-lost' })).toBe(HAPTIC_PATTERNS.lifeLost);
    expect(hapticFor({ type: 'shift-end', status: 'done' })).toBe(HAPTIC_PATTERNS.shiftEnd);
  });
  it('does not buzz for other players\' collects or for quiet events', () => {
    expect(hapticFor({ type: 'collect', by: 'b' }, { meId: 'a' })).toBeNull();
    for (const type of ['tick', 'ready', 'take', 'serve', 'customer-arrive', 'emote', 'cook-start', 'nope']) expect(hapticFor({ type })).toBeNull();
    expect(hapticFor(null)).toBeNull();
  });
  it('patterns are short and well-formed like the hub\'s', () => {
    for (const [k, p] of Object.entries(HAPTIC_PATTERNS)) {
      const list = Array.isArray(p) ? p : [p];
      expect(list.length, k).toBeLessThanOrEqual(16);
      expect(list.every((n) => Number.isFinite(n) && n >= 0 && n <= 400), k).toBe(true);
      expect(list.reduce((a, b) => a + b, 0), k).toBeLessThanOrEqual(700);
    }
  });
});

describe('createTiffinHaptics', () => {
  it('buzzes once per batch with the strongest pattern, and rate-limits', () => {
    const buzz = vi.fn();
    let t = 0;
    const h = createTiffinHaptics({ buzz, meId: 'a', now: () => t });
    expect(h.handle([{ type: 'collect', by: 'a' }, { type: 'burnt' }, { type: 'combo', combo: 3 }])).toBe(1);
    expect(buzz).toHaveBeenCalledTimes(1);
    expect(buzz).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.burnt);
    t = 30;
    expect(h.handle([{ type: 'burnt' }])).toBe(0); // too soon
    t = 500;
    expect(h.handle([{ type: 'life-lost' }, { type: 'burnt' }])).toBe(1);
    expect(buzz).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.lifeLost);
    expect(h.handle([{ type: 'tick' }])).toBe(0);
    expect(h.handle([])).toBe(0);
    h.setMe('z');
    t = 1000;
    expect(h.handle([{ type: 'collect', by: 'a' }])).toBe(0);
  });
  it('survives a throwing buzz', () => {
    const h = createTiffinHaptics({ buzz: () => { throw new Error('x'); } });
    expect(h.handle([{ type: 'burnt' }])).toBe(0);
  });
});

describe('through the hub buzz: settings and reduced motion', () => {
  let vibrate;
  beforeEach(() => {
    hub = { haptics: true, reducedMotion: false };
    vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('vibrates when haptics are on', () => {
    const h = createTiffinHaptics();
    expect(h.handle([{ type: 'burnt' }])).toBe(1);
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.burnt);
  });
  it('is silent with haptics off or reduced motion on', () => {
    hub = { haptics: false, reducedMotion: false };
    createTiffinHaptics().handle([{ type: 'burnt' }]);
    hub = { haptics: true, reducedMotion: true };
    createTiffinHaptics().handle([{ type: 'burnt' }]);
    expect(vibrate).not.toHaveBeenCalled();
  });
});
