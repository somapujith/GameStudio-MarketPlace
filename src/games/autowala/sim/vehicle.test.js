import { describe, expect, it } from 'vitest';
import { createVehicle } from './vehicle.js';
import { createColliders } from '../world/colliders.js';

// Convention: north is -z, east is +x, heading 0 faces +z. A driver looking along +z has their RIGHT hand toward -x.
const run = (v, seconds, input, env = {}) => {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 60) events.push(...v.update(1 / 60, { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, ...input }, env));
  return events;
};

describe('vehicle steering', () => {
  it('steering right (D / arrow right) turns toward the driver\'s right: heading falls, x goes negative when facing +z', () => {
    const v = createVehicle({ x: 0, z: 0, heading: 0 });
    run(v, 1.5, { throttle: 1 });
    const before = v.state.heading;
    run(v, 1.2, { throttle: 1, steer: 1 });
    expect(v.state.heading).toBeLessThan(before);
    expect(v.state.x).toBeLessThan(0);
  });

  it('steering left is the mirror image', () => {
    const v = createVehicle({ x: 0, z: 0, heading: 0 });
    run(v, 1.5, { throttle: 1 });
    run(v, 1.2, { throttle: 1, steer: -1 });
    expect(v.state.heading).toBeGreaterThan(0);
    expect(v.state.x).toBeGreaterThan(0);
  });

  it('is the same relative to the heading: facing +x, right is +z... (screen-right is -z when looking along +x)', () => {
    const v = createVehicle({ x: 0, z: 0, heading: Math.PI / 2 }); // facing +x
    run(v, 1.5, { throttle: 1 });
    run(v, 1.2, { throttle: 1, steer: 1 });
    expect(v.state.z).toBeGreaterThan(0); // looking along +x, the driver's right hand points to +z
  });

  it('does not turn while standing still', () => {
    const v = createVehicle({ x: 0, z: 0, heading: 0 });
    run(v, 1, { steer: 1 });
    expect(v.state.heading).toBeCloseTo(0, 3);
  });
});

describe('vehicle driving', () => {
  it('accelerates toward its top speed and no further', () => {
    const v = createVehicle({ x: 0, z: 0, heading: 0 });
    run(v, 10, { throttle: 1 });
    expect(v.state.speed).toBeGreaterThan(18);
    expect(v.state.speed).toBeLessThanOrEqual(v.params({}).top + 0.5);
    expect(v.state.z).toBeGreaterThan(80); // moved along +z
  });

  it('brakes to a stop and then reverses', () => {
    const v = createVehicle({ x: 0, z: 0, heading: 0 });
    run(v, 4, { throttle: 1 });
    run(v, 3, { brake: 1 });
    expect(v.state.fwd).toBeLessThan(0.5);
    run(v, 2, { brake: 1 });
    expect(v.state.fwd).toBeLessThan(-1);
  });

  it('the handbrake in a turn makes a controllable slide that charges the boost (it does not spin the auto round)', () => {
    const v = createVehicle({ x: 0, z: 0, heading: 0 });
    run(v, 5, { throttle: 1 });
    const ev = run(v, 1.6, { throttle: 1, steer: 1, handbrake: true });
    expect(ev.some((e) => e.type === 'drift-start')).toBe(true);
    expect(v.state.driftCharge).toBeGreaterThan(0.2);
    expect(Math.abs(v.state.heading)).toBeLessThan(2.4); // well short of a half turn
    expect(v.state.speed).toBeGreaterThan(8); // still moving: it is a drift, not a stop
  });

  it('boost goes faster than the normal top speed while there is charge, then falls back', () => {
    const v = createVehicle({ x: 0, z: 0, heading: 0 });
    const top = v.params({}).top;
    run(v, 9, { throttle: 1 });
    v.state.driftCharge = 1;
    let max = 0;
    for (let i = 0; i < 360; i++) {
      v.update(1 / 60, { steer: 0, throttle: 1, brake: 0, handbrake: false, boost: true }, {});
      max = Math.max(max, v.state.speed);
    }
    expect(max).toBeGreaterThan(top + 2);
  });

  it('burns fuel with distance and stops pulling when the tank is empty', () => {
    const v = createVehicle({ x: 0, z: 0, heading: 0 });
    const f0 = v.state.fuel;
    run(v, 5, { throttle: 1 });
    expect(v.state.fuel).toBeLessThan(f0);
    v.state.fuel = 0;
    run(v, 12, { throttle: 1 });
    expect(v.state.speed).toBeLessThan(2);
  });
});

describe('vehicle collisions', () => {
  it('stops at a wall, slows down, and reports a crash with a strength', () => {
    const colliders = createColliders();
    colliders.add(-20, 40, 20, 60, 'building', 10);
    const v = createVehicle({ x: 0, z: 0, heading: 0 });
    const ev = run(v, 6, { throttle: 1 }, { colliders });
    expect(v.state.z).toBeLessThan(40 - 1.2); // never inside the wall
    const crash = ev.find((e) => e.type === 'crash');
    expect(crash).toBeTruthy();
    expect(crash.strength).toBeGreaterThan(0.3);
    expect(v.state.jolt).toBeGreaterThan(0);
  });
});

describe('vehicle.hold (a menu is open)', () => {
  it('brings a moving auto to rest without ever reversing', () => {
    const v = createVehicle({ x: 0, z: 0, heading: 0 });
    run(v, 4, { throttle: 1 });
    expect(v.state.speed).toBeGreaterThan(8);
    let minFwd = Infinity;
    for (let i = 0; i < 60 * 3; i++) {
      v.update(1 / 60, { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false }, {});
      v.hold(1 / 60);
      minFwd = Math.min(minFwd, v.state.fwd);
    }
    expect(v.state.speed).toBe(0);
    expect(minFwd).toBeGreaterThanOrEqual(-0.01);
  });

  it('keeps a parked auto parked for as long as the menu is open (no creep)', () => {
    const v = createVehicle({ x: 5, z: 5, heading: 1 });
    for (let i = 0; i < 60 * 20; i++) {
      v.update(1 / 60, { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false }, {});
      v.hold(1 / 60);
    }
    expect(Math.hypot(v.state.x - 5, v.state.z - 5)).toBeLessThan(0.01);
  });

  it('pressing the brake at a standstill does reverse (which is why a menu must not hold it with the brake)', () => {
    const v = createVehicle({ x: 0, z: 0, heading: 0 });
    run(v, 2, { brake: 1 });
    expect(v.state.fwd).toBeLessThan(-1);
  });
});
