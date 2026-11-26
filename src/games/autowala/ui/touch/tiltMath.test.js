import { describe, expect, it } from 'vitest';
import { angleDiff, createTilt, fullLockDegrees, lowPass, normaliseScreenAngle, screenAngleOf, tiltRoll, tiltSteer, tiltWheelAngle } from './tiltMath.js';

const RAD = Math.PI / 180;
/** The (beta, gamma) a device reports when it stands upright and is rolled `roll` degrees clockwise about its screen normal, in a screen angle. */
function reading(roll, angle) {
  // gravity ("up") in SCREEN coordinates for that roll, mapped back to device axes (the inverse of tiltRoll's table)
  const sx = -Math.sin(roll * RAD);
  const sy = Math.cos(roll * RAD);
  let ux;
  let uy;
  switch (angle) {
    case 90:
      ux = sy;
      uy = -sx;
      break;
    case 180:
      ux = -sx;
      uy = -sy;
      break;
    case 270:
      ux = -sy;
      uy = sx;
      break;
    default:
      ux = sx;
      uy = sy;
  }
  // the screen stands vertical (uz = 0): beta = asin(uy), and ux = -cos(beta) sin(gamma)
  const beta = Math.asin(uy) / RAD;
  const cb = Math.cos(beta * RAD);
  const gamma = cb === 0 ? 0 : Math.asin(Math.max(-1, Math.min(1, -ux / cb))) / RAD;
  return [beta, gamma];
}

describe('screen angle', () => {
  it('normalises negatives and odd values', () => {
    expect(normaliseScreenAngle(-90)).toBe(270);
    expect(normaliseScreenAngle(450)).toBe(90);
    expect(normaliseScreenAngle(89)).toBe(90);
    expect(normaliseScreenAngle(undefined)).toBe(0);
    expect(normaliseScreenAngle('x')).toBe(0);
  });
  it('reads screen.orientation.angle, then window.orientation, else 0', () => {
    expect(screenAngleOf({ screen: { orientation: { angle: 270 } } })).toBe(270);
    expect(screenAngleOf({ orientation: -90 })).toBe(270);
    expect(screenAngleOf({})).toBe(0);
    expect(screenAngleOf(null)).toBe(0);
  });
  it('angleDiff is the shortest signed difference', () => {
    expect(angleDiff(10, -10)).toBe(20);
    expect(angleDiff(-179, 179)).toBeCloseTo(2);
    expect(angleDiff(179, -179)).toBeCloseTo(-2);
  });
});

describe('tiltRoll', () => {
  it('level in every screen orientation reads 0', () => {
    for (const a of [0, 90, 180, 270]) {
      const [b, g] = reading(0, a);
      expect(tiltRoll(b, g, a)).toBeCloseTo(0, 3);
    }
  });
  it('rolling clockwise reads positive in all four orientations (same gesture, same sign)', () => {
    for (const a of [0, 90, 180, 270]) {
      for (const roll of [-60, -25, 10, 33, 70]) {
        const [b, g] = reading(roll, a);
        expect(tiltRoll(b, g, a)).toBeCloseTo(roll, 3);
      }
    }
  });
  it('the wrong screen angle is detectable (a quarter-turn off gives a different roll)', () => {
    const [b, g] = reading(30, 90);
    expect(Math.abs(tiltRoll(b, g, 0) - 30)).toBeGreaterThan(10);
  });
  it('null for missing data and for a phone lying flat', () => {
    expect(tiltRoll(null, 0, 0)).toBeNull();
    expect(tiltRoll(NaN, 0, 0)).toBeNull();
    expect(tiltRoll(0, 0, 90)).toBeNull(); // flat on a table
  });
});

describe('tiltSteer', () => {
  it('dead zone, full lock at the sensitivity angle, symmetric', () => {
    expect(tiltSteer(0)).toBe(0);
    expect(tiltSteer(1.5)).toBe(0);
    expect(tiltSteer(fullLockDegrees(0.5))).toBeCloseTo(1);
    expect(tiltSteer(90)).toBe(1);
    expect(tiltSteer(-20)).toBeCloseTo(-tiltSteer(20));
    expect(tiltSteer(15)).toBeGreaterThan(0);
  });
  it('higher sensitivity needs less tilt', () => {
    expect(fullLockDegrees(1)).toBeLessThan(fullLockDegrees(0));
    expect(tiltSteer(20, { sens: 1 })).toBeGreaterThan(tiltSteer(20, { sens: 0 }));
  });
  it('calibration moves the neutral', () => {
    expect(tiltSteer(40, { neutral: 40 })).toBe(0);
    expect(tiltSteer(50, { neutral: 40 })).toBeGreaterThan(0);
    expect(tiltSteer(30, { neutral: 40 })).toBeLessThan(0);
  });
  it('invert flips the sign; the +-180 seam does not jump', () => {
    expect(tiltSteer(20, { invert: true })).toBeLessThan(0);
    expect(tiltSteer(-179, { neutral: 179 })).toBeCloseTo(tiltSteer(2, { neutral: 0 }), 5);
  });
});

describe('lowPass', () => {
  it('moves toward the target, never past it, and converges', () => {
    let v = 0;
    for (let i = 0; i < 10; i++) {
      const n = lowPass(v, 1, 1 / 60);
      expect(n).toBeGreaterThan(v);
      expect(n).toBeLessThanOrEqual(1);
      v = n;
    }
    for (let i = 0; i < 120; i++) v = lowPass(v, 1, 1 / 60);
    expect(v).toBeCloseTo(1, 3);
  });
  it('first sample passes through; tau 0 means no filtering', () => {
    expect(lowPass(NaN, 5, 0.016)).toBe(5);
    expect(lowPass(0, 5, 0.016, 0)).toBe(5);
  });
});

describe('createTilt', () => {
  it('calibrate makes the current pose straight', () => {
    const t = createTilt({ tau: 0 });
    const [b, g] = reading(25, 90);
    t.feed(b, g, 90);
    t.step(0.016);
    expect(t.steer).toBeGreaterThan(0);
    expect(t.calibrate()).toBeCloseTo(25, 0);
    t.step(0.016);
    expect(t.steer).toBe(0);
    const [b2, g2] = reading(45, 90);
    t.feed(b2, g2, 90);
    t.step(0.016);
    expect(t.steer).toBeGreaterThan(0);
  });
  it('filters a jolt (one noisy sample moves the steering only a little)', () => {
    const t = createTilt();
    const [b0, g0] = reading(0, 270);
    t.feed(b0, g0, 270);
    t.step(1 / 60);
    const [b1, g1] = reading(40, 270);
    t.feed(b1, g1, 270);
    t.step(1 / 60);
    expect(t.steer).toBeLessThan(0.5);
  });
  it('follows a flipped landscape (270 to 90) without a jump in steering', () => {
    const t = createTilt({ tau: 0 });
    const a = reading(20, 270);
    t.feed(a[0], a[1], 270);
    t.step(0.016);
    const s1 = t.steer;
    const b = reading(20, 90);
    t.feed(b[0], b[1], 90);
    t.step(0.016);
    expect(t.steer).toBeCloseTo(s1, 3);
  });
  it('has no steering before a reading and calibrate returns null', () => {
    const t = createTilt();
    expect(t.step(0.016)).toBe(0);
    expect(t.calibrate()).toBeNull();
    expect(t.feed(NaN, 0, 0)).toBe(false);
  });
  it('tiltWheelAngle mirrors the phone on the wheel, within the lock', () => {
    const t = createTilt({ tau: 0 });
    expect(tiltWheelAngle(t)).toBe(0);
    const [b, g] = reading(60, 0);
    t.feed(b, g, 0);
    t.step(0.016);
    expect(tiltWheelAngle(t)).toBe(135);
    t.invert = true;
    expect(tiltWheelAngle(t)).toBe(-135);
  });
});
