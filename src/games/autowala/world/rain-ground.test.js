import { describe, expect, it } from 'vitest';
import { generateCity } from './layout.js';
import { onRoad } from './roads.js';
import { cellHash, puddleOfCell } from './rain-ground.js';
import { greyOut } from './rain-sky.js';

const city = generateCity(1);

describe('puddles', () => {
  it('cell hashes are deterministic and spread over 0..1', () => {
    expect(cellHash(3, -4)).toEqual(cellHash(3, -4));
    expect(cellHash(3, -4)).not.toEqual(cellHash(4, -4));
    let lo = 1;
    let hi = 0;
    for (let i = -20; i < 20; i++) for (let j = -20; j < 20; j++) for (const v of cellHash(i, j)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThan(1);
    expect(lo).toBeLessThan(0.05);
    expect(hi).toBeGreaterThan(0.95);
  });

  it('every puddle lies on a road, the same one every time, and there are plenty on a long street', () => {
    let found = 0;
    for (let i = -60; i < 60; i++) {
      for (let j = -60; j < 60; j++) {
        const p = puddleOfCell(city, i, j);
        if (!p) continue;
        found++;
        expect(onRoad(city, p.x, p.z, 0)).toBeTruthy();
        expect(puddleOfCell(city, i, j)).toEqual(p);
        expect(p.rx).toBeGreaterThan(1);
        expect(p.rz).toBeGreaterThanOrEqual(2.2); // long axis along the road
        expect(p.rx).toBeLessThanOrEqual(2.7);
      }
    }
    expect(found).toBeGreaterThan(150);
  });
});

describe('overcast sky', () => {
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  it('greying keeps the brightness (before darkening) and removes the colour', () => {
    const c = { r: 0.9, g: 0.3, b: 0.1 };
    const l = lum(c);
    greyOut(c, 1, 0);
    expect(c.r).toBeCloseTo(l, 6);
    expect(c.g).toBeCloseTo(l, 6);
    expect(c.b).toBeCloseTo(l, 6);
  });
  it('k = 0 and dark = 0 leave a colour alone, darkening scales it', () => {
    const c = { r: 0.5, g: 0.4, b: 0.3 };
    greyOut(c, 0, 0);
    expect(c).toEqual({ r: 0.5, g: 0.4, b: 0.3 });
    greyOut(c, 0, 0.5);
    expect(c.r).toBeCloseTo(0.25, 6);
  });
});
