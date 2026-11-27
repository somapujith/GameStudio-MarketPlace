import { describe, expect, it } from 'vitest';
import { ceilPow2, drawCell, shelfPack, uvRect } from './atlas-pack.js';

describe('shelfPack', () => {
  it('places cells on rows with a gutter and never overlaps', () => {
    const sizes = [{ w: 512, h: 128 }, { w: 512, h: 96 }, { w: 256, h: 256 }, { w: 128, h: 128 }];
    const { cells, height } = shelfPack(sizes, 1100, 8);
    expect(cells).toHaveLength(4);
    // the first two fit one row (528 + 528 = 1056 <= 1100), the third starts a new one
    expect(cells[0]).toEqual({ x: 8, y: 8, w: 512, h: 128 });
    expect(cells[1].y).toBe(8);
    expect(cells[2].y).toBeGreaterThan(cells[0].y + cells[0].h);
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i];
      expect(a.x - 8).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w + 8).toBeLessThanOrEqual(1100);
      expect(a.y + a.h + 8).toBeLessThanOrEqual(height);
      for (let j = i + 1; j < cells.length; j++) {
        const b = cells[j];
        const apart = a.x + a.w + 8 <= b.x - 8 || b.x + b.w + 8 <= a.x - 8 || a.y + a.h + 8 <= b.y - 8 || b.y + b.h + 8 <= a.y - 8;
        expect(apart).toBe(true);
      }
    }
  });

  it('rejects a cell wider than the atlas', () => {
    expect(() => shelfPack([{ w: 1024, h: 8 }], 1024, 8)).toThrow(/does not fit/);
  });
});

describe('uvRect / ceilPow2', () => {
  it('maps a cell to canvas-texture uv (v up)', () => {
    const r = uvRect({ x: 256, y: 0, w: 256, h: 128 }, 1024, 512);
    expect(r).toEqual([0.25, 0.75, 0.5, 1]);
  });
  it('rounds up to a power of two', () => {
    expect([1, 3, 512, 513, 700].map(ceilPow2)).toEqual([1, 4, 512, 1024, 1024]);
  });
});

describe('drawCell', () => {
  it('draws the image once and eight gutter strips', () => {
    const calls = [];
    const g = { drawImage: (...a) => calls.push(a) };
    drawCell(g, { width: 100, height: 40 }, { x: 8, y: 8, w: 50, h: 20 }, 8);
    expect(calls).toHaveLength(9);
    expect(calls[0].slice(1)).toEqual([8, 8, 50, 20]);
    // gutter strips never leave the 8 px ring around the cell
    for (const c of calls.slice(1)) {
      const [, , , , , dx, dy, dw, dh] = c;
      expect(dx).toBeGreaterThanOrEqual(0);
      expect(dy).toBeGreaterThanOrEqual(0);
      expect(dx + dw).toBeLessThanOrEqual(8 + 50 + 8);
      expect(dy + dh).toBeLessThanOrEqual(8 + 20 + 8);
    }
  });
});
