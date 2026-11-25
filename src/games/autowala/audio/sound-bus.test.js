import { describe, expect, it } from 'vitest';
import { busLevels, dropBuses, getBuses, setBusLevels } from './sound-bus.js';

describe('sound buses', () => {
  it('keeps the saved levels clamped and never throws without Web Audio', () => {
    setBusLevels({ fx: 0.4, voice: 2, music: -1 });
    expect(busLevels()).toEqual({ fx: 0.4, voice: 1, music: 0 });
    setBusLevels({ fx: 'x', music: null });
    expect(busLevels().fx).toBe(0.4);
    setBusLevels(null);
    expect(getBuses()).toBeNull();
    expect(() => dropBuses()).not.toThrow();
  });
});
