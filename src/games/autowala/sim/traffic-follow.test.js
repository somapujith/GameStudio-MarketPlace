import { describe, expect, it } from 'vitest';
import { FOLLOW, followSpeed, idmAccel, safeSpeed } from './traffic-follow.js';

describe('car following', () => {
  it('accelerates on a free road and stops accelerating at the desired speed', () => {
    expect(idmAccel(0, 12, Infinity, 0, 3, 3.5)).toBeCloseTo(3);
    expect(idmAccel(12, 12, Infinity, 0, 3, 3.5)).toBeCloseTo(0);
  });

  it('brakes hard when closing on a stopped leader', () => {
    expect(idmAccel(12, 12, 10, 0, 3, 3.5)).toBeLessThan(-3);
  });

  it('a safe speed never lets the follower outrun the room it has', () => {
    expect(safeSpeed(0.5, 0)).toBe(0);
    expect(safeSpeed(30, 0)).toBeCloseTo(Math.sqrt(2 * FOLLOW.bMax * (30 - FOLLOW.minGap)), 5);
  });

  function run({ leaderBrake, gap0, v0, steps = 2400, dt = 1 / 60 }) {
    let xl = gap0 + 2; // leader's rear bumper position
    let vl = v0;
    let xf = 0;
    let vf = v0;
    const len = 4;
    let minGap = Infinity;
    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      vl = t > 3 ? Math.max(0, vl - leaderBrake * dt) : vl;
      xl += vl * dt;
      const gap = xl - (xf + len); // bumper to bumper
      vf = followSpeed(vf, dt, 14, gap, vl, 3, 3.5);
      xf += vf * dt;
      minGap = Math.min(minGap, xl - (xf + len));
    }
    return { minGap, vf, vl };
  }

  it('never overlaps a leader that brakes at 9 m/s^2 from full speed', () => {
    const r = run({ leaderBrake: 9, gap0: 14, v0: 14 });
    expect(r.minGap).toBeGreaterThanOrEqual(0.3);
    expect(r.vf).toBeLessThan(0.5);
  });

  it('never overlaps a leader that stops dead', () => {
    const r = run({ leaderBrake: 1e6, gap0: 25, v0: 14 });
    expect(r.minGap).toBeGreaterThanOrEqual(0);
  });

  it('settles a time-gap behind a slower leader without touching it', () => {
    let xl = 40;
    let xf = 0;
    let vf = 14;
    let minGap = Infinity;
    for (let i = 0; i < 60 * 40; i++) {
      xl += 8 / 60;
      const gap = xl - (xf + 4);
      vf = followSpeed(vf, 1 / 60, 14, gap, 8, 3, 3.5);
      xf += vf / 60;
      minGap = Math.min(minGap, xl - (xf + 4));
    }
    expect(minGap).toBeGreaterThan(1);
    expect(vf).toBeCloseTo(8, 0);
  });
});
