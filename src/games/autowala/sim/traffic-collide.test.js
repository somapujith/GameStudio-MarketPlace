import { describe, expect, it } from 'vitest';
import { PLAYER_MASS, KINDS } from './traffic-net.js';
import { circleAt, exchangeImpulse, hitSeverity, separate } from './traffic-collide.js';

const o = {};

describe('collision maths', () => {
  it('conserves momentum along the normal', () => {
    exchangeImpulse(600, 10, 0, 1000, 0, 0, 1, 0, 0.3, o);
    const p0 = 600 * 10;
    const p1 = 600 * (10 + o.dax) + 1000 * o.dbx;
    expect(p1).toBeCloseTo(p0, 6);
    expect(o.closing).toBeCloseTo(10);
  });

  it('the heavier vehicle wins: a bus barely notices an auto, an auto bounces off', () => {
    exchangeImpulse(PLAYER_MASS, 10, 0, KINDS.bus.mass, 0, 0, 1, 0, 0.3, o);
    expect(Math.abs(o.dax)).toBeGreaterThan(Math.abs(o.dbx) * 10);
    expect(o.dax).toBeLessThan(-10); // the auto is thrown back
    exchangeImpulse(PLAYER_MASS, 10, 0, 70, 0, 0, 1, 0, 0.3, o); // a pedestrian
    expect(Math.abs(o.dax)).toBeLessThan(Math.abs(o.dbx));
  });

  it('does nothing when the bodies are already separating', () => {
    exchangeImpulse(600, 0, 0, 1000, 5, 0, 1, 0, 0.3, o);
    expect(o.dax).toBe(0);
    expect(o.dbx).toBe(0);
  });

  it('pushes the lighter body further apart', () => {
    separate(600, 9000, 1, 1, 0, o);
    expect(Math.abs(o.ax)).toBeGreaterThan(0.9);
    expect(Math.abs(o.bx)).toBeLessThan(0.1);
    expect(o.bx - o.ax).toBeCloseTo(1, 6);
  });

  it('places circles along the heading', () => {
    const c = circleAt(0, 0, Math.PI / 2, 2, {});
    expect(c.x).toBeCloseTo(2);
    expect(c.z).toBeCloseTo(0, 6);
  });

  it('severity grows with speed and mass, bikes are big for rage, nudges still count', () => {
    const slowBus = hitSeverity(2, 'bus', KINDS.bus.mass);
    const fastBus = hitSeverity(12, 'bus', KINDS.bus.mass);
    const fastCar = hitSeverity(12, 'car', KINDS.car.mass);
    const fastPed = hitSeverity(12, 'ped', 70);
    expect(fastBus).toBeGreaterThan(fastCar);
    expect(fastCar).toBeGreaterThan(fastPed);
    expect(fastBus).toBeGreaterThan(slowBus);
    expect(fastBus).toBeGreaterThan(0.85);
    expect(hitSeverity(6, 'bike', KINDS.bike.mass)).toBeGreaterThan(hitSeverity(6, 'ped', 70));
    expect(hitSeverity(0.5, 'ped', 70)).toBeGreaterThan(0);
    for (const s of [slowBus, fastBus, fastCar, fastPed]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
