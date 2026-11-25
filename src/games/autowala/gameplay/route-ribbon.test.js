import { describe, it, expect } from 'vitest';
import { fillRibbon, RIBBON } from './route-ribbon.js';

const bufs = () => ({ pos: new Float32Array(RIBBON.maxPoints * 6), attr: new Float32Array(RIBBON.maxPoints * 4) });
const vtx = (pos, i) => ({ x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2] });

describe('fillRibbon', () => {
  it('draws nothing for fewer than two points', () => {
    const { pos, attr } = bufs();
    expect(fillRibbon([], pos, attr)).toBe(0);
    expect(fillRibbon([{ x: 0, z: 0 }], pos, attr)).toBe(0);
    expect(fillRibbon(null, pos, attr)).toBe(0);
  });

  it('a straight leg is a 2.2 m wide strip, 0.28 m up, with distance along it', () => {
    const { pos, attr } = bufs();
    const steps = fillRibbon([{ x: 10, z: 0 }, { x: 10, z: -100 }], pos, attr);
    expect(steps).toBe(2);
    const a = vtx(pos, 0);
    const b = vtx(pos, 1);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(RIBBON.width, 5);
    expect(a.y).toBeCloseTo(RIBBON.lift, 5);
    expect((a.x + b.x) / 2).toBeCloseTo(10, 5);
    expect(attr[1]).toBe(0);
    expect(attr[5]).toBeCloseTo(100, 4);
    expect(attr[0]).toBe(-1);
    expect(attr[2]).toBe(1);
  });

  it('is cut exactly at the reach (300 m)', () => {
    const { pos, attr } = bufs();
    const steps = fillRibbon([{ x: 0, z: 0 }, { x: 0, z: -200 }, { x: 400, z: -200 }], pos, attr);
    expect(steps).toBe(3);
    expect(attr[(steps - 1) * 4 + 1]).toBeCloseTo(RIBBON.reach, 4);
    const end = vtx(pos, (steps - 1) * 2);
    expect(end.x).toBeGreaterThan(95);
    expect(end.x).toBeLessThan(105 + 2);
  });

  it('keeps its width round a right-angle corner (mitre)', () => {
    const { pos, attr } = bufs();
    const steps = fillRibbon([{ x: 0, z: 0 }, { x: 0, z: -50 }, { x: 50, z: -50 }], pos, attr);
    expect(steps).toBe(3);
    const l = vtx(pos, 2);
    const r = vtx(pos, 3);
    const w = Math.hypot(l.x - r.x, l.z - r.z);
    expect(w).toBeGreaterThan(RIBBON.width);
    expect(w).toBeLessThan(RIBBON.width * 1.6);
    for (let i = 0; i < steps * 2 * 3; i++) expect(Number.isFinite(pos[i])).toBe(true);
  });

  it('skips repeated points and survives a U-turn without NaN', () => {
    const { pos, attr } = bufs();
    const steps = fillRibbon([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: -30 }, { x: 0, z: 0 }], pos, attr);
    expect(steps).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < steps * 6; i++) expect(Number.isFinite(pos[i])).toBe(true);
  });

  it('never writes past the buffers on a very long, dense route', () => {
    const { pos, attr } = bufs();
    const pts = [];
    for (let i = 0; i < 1000; i++) pts.push({ x: i * 0.5, z: Math.sin(i) * 3 });
    const steps = fillRibbon(pts, pos, attr);
    expect(steps).toBeLessThanOrEqual(RIBBON.maxPoints);
  });
});
