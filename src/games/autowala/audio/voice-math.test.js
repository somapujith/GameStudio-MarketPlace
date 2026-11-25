import { describe, expect, it } from 'vitest';
import { MAX_HEARD_M, estimateMs, spatial, subtitleHold, subtitlePhase } from './voice-math.js';

// a camera at the origin looking along +z: its screen-right axis is -x (see ARCHITECTURE.md conventions)
const lis = { x: 0, z: 0, rx: -1, rz: 0 };

describe('positional voice maths', () => {
  it('pans toward the side the voice is on', () => {
    expect(spatial(lis, { x: -20, z: 5 }).pan).toBeGreaterThan(0.5); // -x is the screen's right
    expect(spatial(lis, { x: 20, z: 5 }).pan).toBeLessThan(-0.5);
    expect(Math.abs(spatial(lis, { x: 0, z: 30 }).pan)).toBeLessThan(0.05); // straight ahead
    expect(spatial(lis, { x: 0, z: 0 }).pan).toBe(0);
  });

  it('fades with distance and is silent beyond ~90 m', () => {
    const g = (d) => spatial(lis, { x: 0, z: d }).gain;
    expect(g(3)).toBe(1);
    expect(g(20)).toBeGreaterThan(g(50));
    expect(g(50)).toBeGreaterThan(g(85));
    expect(g(85)).toBeGreaterThan(0);
    expect(g(MAX_HEARD_M)).toBe(0);
    expect(g(300)).toBe(0);
    expect(spatial(lis, { x: 0, z: 120 }).audible).toBe(false);
    expect(spatial(lis, { x: 0, z: 40 }).audible).toBe(true);
    expect(MAX_HEARD_M).toBe(90);
  });

  it('muffles far voices', () => {
    expect(spatial(lis, { x: 0, z: 80 }).cutoff).toBeLessThan(spatial(lis, { x: 0, z: 10 }).cutoff);
  });

  it('works for any camera orientation', () => {
    const east = { x: 0, z: 0, rx: 0, rz: 1 }; // looking toward +x: right is +z
    expect(spatial(east, { x: 10, z: 20 }).pan).toBeGreaterThan(0);
    expect(spatial(east, { x: 10, z: -20 }).pan).toBeLessThan(0);
  });
});

describe('subtitle timing', () => {
  it('estimates a length from the text and clamps it', () => {
    expect(estimateMs('')).toBe(900);
    expect(estimateMs('x'.repeat(20))).toBe(1500);
    expect(estimateMs('x'.repeat(500))).toBe(4500);
  });

  it('holds a subtitle a little longer than the voice, within 1.8 s .. 7 s', () => {
    expect(subtitleHold(1000, 'hi')).toBe(1800);
    expect(subtitleHold(2500, 'a line')).toBe(3200);
    expect(subtitleHold(9000, 'long')).toBe(7000);
    expect(subtitleHold(1000, 'x'.repeat(100))).toBe(3800); // long text: reading time wins
  });

  it('moves through in / show / out / gone', () => {
    const hold = 2000;
    expect(subtitlePhase(-1, hold)).toBe('gone');
    expect(subtitlePhase(0, hold)).toBe('in');
    expect(subtitlePhase(500, hold)).toBe('show');
    expect(subtitlePhase(hold + 100, hold)).toBe('out');
    expect(subtitlePhase(hold + 400, hold)).toBe('gone');
  });
});
