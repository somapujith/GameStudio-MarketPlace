import { describe, it, expect } from 'vitest';
import { stickValue, knobOffset, rawPosition, STICK_DEAD } from './touchMath.js';

const rect = { left: 100, width: 200 }; // centre at x = 200

describe('stickValue', () => {
  it('is 0 in the middle and inside the dead zone', () => {
    expect(stickValue(200, rect)).toBe(0);
    expect(stickValue(200 + 100 * STICK_DEAD * 0.5, rect)).toBe(0);
  });
  it('reaches full lock slightly before the end of the track', () => {
    expect(stickValue(300, rect)).toBe(1);
    expect(stickValue(100, rect)).toBe(-1);
    expect(stickValue(100 + 100 * (1 - 0.92), rect)).toBeCloseTo(-1, 5);
    expect(stickValue(9999, rect)).toBe(1);
    expect(stickValue(-9999, rect)).toBe(-1);
  });
  it('is symmetric, monotonic and gentle near the centre', () => {
    let prev = 0;
    for (let x = 201; x <= 300; x += 3) {
      const v = stickValue(x, rect);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(stickValue(400 - x, rect)).toBeCloseTo(-v, 10);
      prev = v;
    }
    expect(stickValue(250, rect)).toBeLessThan(0.5); // half travel gives less than half lock
    expect(stickValue(250, rect)).toBeGreaterThan(0);
  });
  it('right of centre steers right (+1) and left steers left (-1)', () => {
    expect(stickValue(260, rect)).toBeGreaterThan(0);
    expect(stickValue(140, rect)).toBeLessThan(0);
  });
  it('survives bad input', () => {
    expect(stickValue(NaN, rect)).toBe(0);
    expect(stickValue(150, null)).toBe(0);
    expect(stickValue(150, { left: 0, width: 0 })).toBe(0);
    expect(stickValue(undefined, rect)).toBe(0);
  });
});

describe('knob position', () => {
  it('rawPosition follows the finger and clamps', () => {
    expect(rawPosition(200, rect)).toBe(0);
    expect(rawPosition(300, rect)).toBe(1);
    expect(rawPosition(150, rect)).toBe(-0.5);
    expect(rawPosition(1000, rect)).toBe(1);
    expect(rawPosition(NaN, rect)).toBe(0);
  });
  it('knobOffset keeps the knob inside the track', () => {
    expect(knobOffset(1, rect, 60)).toBe(70);
    expect(knobOffset(-1, rect, 60)).toBe(-70);
    expect(knobOffset(0, rect, 60)).toBe(0);
    expect(knobOffset(5, rect, 60)).toBe(70);
    expect(knobOffset(1, null, 60)).toBe(0);
  });
});

