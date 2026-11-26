import { describe, expect, it } from 'vitest';
import { PEDAL_STEPS, applyAutoThrottle, createBrakeGate, pedalValue, stepIndex } from './pedalMath.js';

const rect = { top: 100, height: 200 }; // spans y 100..300

describe('pedalValue', () => {
  it('higher in the pedal means more throttle', () => {
    expect(pedalValue(300, rect)).toBeCloseTo(0.22, 1); // the very bottom: the floor, a tap always does something
    expect(pedalValue(100, rect)).toBe(1);
    expect(pedalValue(110, rect)).toBe(1); // the top 14% is full
    const mid = pedalValue(200, rect);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.8);
    let prev = 0;
    for (let y = 300; y >= 100; y -= 10) {
      const v = pedalValue(y, rect);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it('clamps outside the pedal (a thumb that slides off keeps the limits)', () => {
    expect(pedalValue(900, rect)).toBeCloseTo(0.22, 1);
    expect(pedalValue(-50, rect)).toBe(1);
  });
  it('bad input is 0', () => {
    expect(pedalValue(NaN, rect)).toBe(0);
    expect(pedalValue(10, null)).toBe(0);
    expect(pedalValue(10, { top: 0, height: 0 })).toBe(0);
  });
  it('pressure steps count crossings', () => {
    expect(stepIndex(0.1)).toBe(0);
    expect(stepIndex(PEDAL_STEPS[0])).toBe(1);
    expect(stepIndex(0.8)).toBe(2);
    expect(stepIndex(1)).toBe(3);
  });
});

describe('brake gate: stop first, reverse on a new press', () => {
  it('a press while rolling brakes, goes quiet at a standstill, and reverses only on the next press', () => {
    const g = createBrakeGate();
    g.press(8); // rolling forward
    expect(g.output(0.9, 8)).toBe(0.9);
    expect(g.output(0.9, 3)).toBe(0.9);
    expect(g.output(0.9, 0.5)).toBe(0); // stopped: do not roll into reverse while the pedal is still down
    expect(g.output(0.9, 0)).toBe(0);
    g.release();
    expect(g.output(0.9, 0)).toBe(0);
    g.press(0); // a fresh press at a standstill
    expect(g.output(0.6, 0)).toBe(0.6); // the sim treats this as reverse
    expect(g.output(0.6, -2)).toBe(0.6);
  });
  it('a press that starts at a crawl (under 1.2 m/s) is a reverse press', () => {
    const g = createBrakeGate();
    g.press(0.9);
    expect(g.output(1, 0.9)).toBe(1);
  });
  it('is 0 when not pressed', () => {
    const g = createBrakeGate();
    expect(g.output(1, 10)).toBe(0);
  });
});

describe('auto-throttle', () => {
  it('is off by default (gas passes through)', () => {
    expect(applyAutoThrottle(0, 0, false)).toBe(0);
    expect(applyAutoThrottle(0.4, 0, false)).toBe(0.4);
  });
  it('keeps the gas on while the brake is not pressed, but never lowers a harder press', () => {
    expect(applyAutoThrottle(0, 0, true)).toBeGreaterThan(0.5);
    expect(applyAutoThrottle(1, 0, true)).toBe(1);
  });
  it('cuts the gas while braking', () => {
    expect(applyAutoThrottle(0, 0.5, true)).toBe(0);
    expect(applyAutoThrottle(1, 0.5, true)).toBe(0);
  });
});
