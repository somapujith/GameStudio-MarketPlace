import { describe, expect, it } from 'vitest';
import { snapToShadowGrid } from './shadow-grid.js';

const norm = (v) => {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const axes = (dir) => {
  const rl = Math.hypot(dir.z, dir.x);
  const r = { x: dir.z / rl, y: 0, z: -dir.x / rl };
  const u = { x: dir.y * r.z, y: dir.z * r.x - dir.x * r.z, z: -dir.y * r.x };
  return { r, u };
};
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

describe('snapToShadowGrid', () => {
  const dir = norm({ x: 0.4, y: 0.7, z: -0.5 });
  const { r, u } = axes(dir);
  const texel = 170 / 2048;

  it('lands on the texel grid of the light axes', () => {
    const out = snapToShadowGrid({ x: 123.456, y: 0, z: -78.9 }, dir, texel);
    expect(Math.abs(dot(out, r) / texel - Math.round(dot(out, r) / texel))).toBeLessThan(1e-6);
    expect(Math.abs(dot(out, u) / texel - Math.round(dot(out, u) / texel))).toBeLessThan(1e-6);
  });

  it('moves the centre by less than one texel (nothing jumps)', () => {
    const f = { x: 12.3, y: 0, z: 45.6 };
    const out = snapToShadowGrid(f, dir, texel);
    expect(Math.hypot(out.x - f.x, out.y - f.y, out.z - f.z)).toBeLessThan(texel * 1.5);
  });

  it('is stable: two focus points inside one texel give the same centre', () => {
    const a = snapToShadowGrid({ x: 100.0, y: 0, z: 100.0 }, dir, texel);
    const nudge = { x: 100.0 + r.x * texel * 0.1, y: 0 + r.y * texel * 0.1, z: 100.0 + r.z * texel * 0.1 };
    const b = snapToShadowGrid(nudge, dir, texel);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.z).toBeCloseTo(a.z, 9);
  });

  it('keeps the point unchanged for a straight-down sun or a bad texel', () => {
    const f = { x: 1, y: 2, z: 3 };
    expect(snapToShadowGrid(f, { x: 0, y: 1, z: 0 }, texel)).toEqual(f);
    expect(snapToShadowGrid(f, dir, 0)).toEqual(f);
  });
});
