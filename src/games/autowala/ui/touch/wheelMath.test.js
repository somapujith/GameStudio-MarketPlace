import { describe, expect, it } from 'vitest';
import { WHEEL_LOCK, angleAround, createWheel, shortestDelta, smoothStep, smoothingRate, springBack, steerFromRotation } from './wheelMath.js';

describe('angles', () => {
  it('angleAround: 0 is up and clockwise is positive', () => {
    expect(angleAround(100, 0, 100, 100)).toBeCloseTo(0);
    expect(angleAround(200, 100, 100, 100)).toBeCloseTo(90);
    expect(angleAround(100, 200, 100, 100)).toBeCloseTo(180, 5);
    expect(angleAround(0, 100, 100, 100)).toBeCloseTo(-90);
    expect(angleAround(100, 100, 100, 100)).toBe(0);
  });
  it('shortestDelta wraps through the +-180 seam', () => {
    expect(shortestDelta(10, 350)).toBeCloseTo(20);
    expect(shortestDelta(350, 10)).toBeCloseTo(-20);
    expect(shortestDelta(-170, 170)).toBeCloseTo(20);
    expect(shortestDelta(90, 90)).toBe(0);
  });
});

describe('steerFromRotation', () => {
  it('is zero inside the dead zone and +-1 at full lock; clockwise = right (+)', () => {
    expect(steerFromRotation(0)).toBe(0);
    expect(steerFromRotation(2)).toBe(0);
    expect(steerFromRotation(-2.4)).toBe(0);
    expect(steerFromRotation(WHEEL_LOCK)).toBeCloseTo(1);
    expect(steerFromRotation(-WHEEL_LOCK)).toBeCloseTo(-1);
    expect(steerFromRotation(500)).toBeCloseTo(1); // beyond the lock is clamped
    expect(steerFromRotation(45)).toBeGreaterThan(0);
    expect(steerFromRotation(-45)).toBeLessThan(0);
  });
  it('is monotonic and gentle near the centre', () => {
    let prev = 0;
    for (let d = 3; d <= 135; d += 3) {
      const v = steerFromRotation(d);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(steerFromRotation(67.5)).toBeLessThan(0.5); // half the lock gives less than half the steering (curve > 1)
  });
  it('garbage in gives 0', () => {
    expect(steerFromRotation(NaN)).toBe(0);
    expect(steerFromRotation(undefined)).toBe(0);
  });
});

describe('springBack and smoothing', () => {
  it('returns to zero without overshooting, from either side', () => {
    for (const start of [135, -135, 20, -3]) {
      let r = start;
      let t = 0;
      while (r !== 0 && t < 3) {
        const next = springBack(r, 1 / 60);
        expect(Math.abs(next)).toBeLessThan(Math.abs(r));
        expect(Math.sign(next) * Math.sign(r)).toBeGreaterThanOrEqual(0);
        r = next;
        t += 1 / 60;
      }
      expect(r).toBe(0);
      expect(t).toBeLessThan(1.2);
    }
  });
  it('smoothing is quicker at a crawl than at speed, and converges', () => {
    expect(smoothingRate(0)).toBeGreaterThan(smoothingRate(60));
    const slow = smoothStep(0, 1, 1 / 60, 60);
    const fast = smoothStep(0, 1, 1 / 60, 0);
    expect(fast).toBeGreaterThan(slow);
    let v = 0;
    for (let i = 0; i < 120; i++) v = smoothStep(v, 1, 1 / 60, 40);
    expect(v).toBe(1);
  });
});

describe('createWheel', () => {
  it('turns with the finger around the centre and ignores where it was grabbed', () => {
    const w = createWheel();
    w.down(90); // grabbed at 3 o'clock
    w.move(120, 1);
    expect(w.rot).toBeCloseTo(30);
    w.move(90, 1);
    expect(w.rot).toBeCloseTo(0);
    w.move(30, 1);
    expect(w.rot).toBeCloseTo(-60);
  });
  it('clamps at the lock and unwinds as soon as the finger reverses', () => {
    const w = createWheel();
    w.down(0);
    for (let a = 10; a <= 200; a += 10) w.move(a, 1);
    expect(w.rot).toBe(WHEEL_LOCK);
    w.move(190, 1);
    expect(w.rot).toBe(WHEEL_LOCK - 10);
  });
  it('keeps turning through the +-180 seam', () => {
    const w = createWheel();
    w.down(170);
    w.move(-170, 1); // +20 clockwise across the bottom
    expect(w.rot).toBeCloseTo(20);
  });
  it('ignores a finger sitting on the centre (noisy angle)', () => {
    const w = createWheel();
    w.down(0);
    w.move(90, 0.05);
    expect(w.rot).toBe(0);
  });
  it('ignores moves before down() and after up()', () => {
    const w = createWheel();
    w.move(50, 1);
    expect(w.rot).toBe(0);
    w.down(0);
    w.up();
    w.move(50, 1);
    expect(w.rot).toBe(0);
  });
  it('springs back to centre after release and the steering follows to exactly 0', () => {
    const w = createWheel();
    w.down(0);
    w.move(100, 1);
    w.up();
    let out;
    for (let i = 0; i < 120; i++) out = w.tick(1 / 60, 0);
    expect(out.rot).toBe(0);
    expect(out.steer).toBe(0);
  });
  it('does not spring while held', () => {
    const w = createWheel();
    w.down(0);
    w.move(60, 1);
    for (let i = 0; i < 30; i++) w.tick(1 / 60, 0);
    expect(w.rot).toBeCloseTo(60);
  });
  it('emits a lock event once, re-arms after backing off, and one centre event when returning', () => {
    const w = createWheel();
    w.down(0);
    for (let a = 5; a <= 150; a += 5) w.move(a, 1);
    let ev = w.tick(1 / 60).events;
    expect(ev).toContain('lock');
    expect(w.tick(1 / 60).events).not.toContain('lock');
    w.up();
    const all = [];
    for (let i = 0; i < 120; i++) all.push(...w.tick(1 / 60).events);
    expect(all.filter((e) => e === 'centre').length).toBe(1);
    w.down(0); // the lock re-arms once the wheel has been well off the stop
    for (let a = 5; a <= 150; a += 5) w.move(a, 1);
    ev = w.tick(1 / 60).events;
    expect(ev).toContain('lock');
  });
  it('reset clears everything', () => {
    const w = createWheel();
    w.down(0);
    w.move(80, 1);
    w.tick(0.1, 0);
    w.reset();
    expect(w.rot).toBe(0);
    expect(w.steer).toBe(0);
    expect(w.held).toBe(false);
  });
});
