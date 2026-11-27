// The decal atlas: cell layout (inside the canvas, gutters never overlap), uv mapping (flipY), gutter painting and the change-driven sync.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ATLAS, ATLAS_CELLS, ATLAS_GUTTER, ATLAS_UV, cellUv, drawCell, layoutAtlas, remapUvs } from './auto-atlas.js';

/** A 2d context that records the calls made on it. */
function recorder() {
  const calls = [];
  const g = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => calls.push([k, ...a])),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });
  return { g, calls };
}

let ctxs = [];
beforeAll(() => {
  ctxs = [];
  globalThis.document = {
    createElement: () => {
      const r = recorder();
      ctxs.push(r);
      return { width: 0, height: 0, getContext: () => r.g };
    },
  };
});
afterAll(() => {
  delete globalThis.document;
});

describe('layoutAtlas', () => {
  it('places every cell at its own size, inside the canvas, with gutters that never overlap', () => {
    const { width, height, rects } = ATLAS;
    expect(height % 32).toBe(0);
    expect(Object.keys(rects)).toEqual(Object.keys(ATLAS_CELLS));
    const G = ATLAS_GUTTER;
    const outer = Object.entries(rects).map(([k, r]) => {
      expect([r.w, r.h], k).toEqual(ATLAS_CELLS[k]);
      expect(r.x - G, k).toBeGreaterThanOrEqual(0);
      expect(r.y - G, k).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w + G, k).toBeLessThanOrEqual(width);
      expect(r.y + r.h + G, k).toBeLessThanOrEqual(height);
      return { k, x0: r.x - G, y0: r.y - G, x1: r.x + r.w + G, y1: r.y + r.h + G };
    });
    for (let i = 0; i < outer.length; i++) {
      for (let j = i + 1; j < outer.length; j++) {
        const a = outer[i];
        const b = outer[j];
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlap, `${a.k} / ${b.k}`).toBe(false);
      }
    }
  });

  it('starts a new shelf when a row is full and refuses a cell wider than the atlas', () => {
    const l = layoutAtlas({ a: [100, 20], b: [100, 40], c: [100, 10] }, 240, 4);
    expect(l.rects.a).toEqual({ x: 4, y: 4, w: 100, h: 20 });
    expect(l.rects.b).toEqual({ x: 112, y: 4, w: 100, h: 40 });
    expect(l.rects.c).toEqual({ x: 4, y: 52, w: 100, h: 10 }); // below the tallest cell of the first row (40 + 2 x 4)
    expect(l.height).toBe(96);
    expect(() => layoutAtlas({ wide: [300, 10] }, 240, 4)).toThrow();
  });
});

describe('uv mapping', () => {
  it('maps a cell to its uv rectangle with v = 0 at the bottom of the canvas (flipY)', () => {
    const uv = cellUv({ x: 8, y: 8, w: 100, h: 50 }, 200, 100);
    expect(uv.u0).toBeCloseTo(0.04);
    expect(uv.u1).toBeCloseTo(0.54);
    expect(uv.v1).toBeCloseTo(0.92); // the top row of the cell
    expect(uv.v0).toBeCloseTo(0.42);
  });

  it('remaps 0..1 uvs into a cell, or puts every uv on the white cell centre', () => {
    const cell = ATLAS_UV.plate;
    const a = remapUvs(new Float32Array([0, 0, 1, 1, 0.5, 0.25]), cell, ATLAS_UV.white);
    expect(a[0]).toBeCloseTo(cell.u0);
    expect(a[1]).toBeCloseTo(cell.v0);
    expect(a[2]).toBeCloseTo(cell.u1);
    expect(a[3]).toBeCloseTo(cell.v1);
    expect(a[4]).toBeCloseTo((cell.u0 + cell.u1) / 2);
    const w = remapUvs(new Float32Array([0, 0, 1, 1]), null, ATLAS_UV.white);
    const wu = (ATLAS_UV.white.u0 + ATLAS_UV.white.u1) / 2;
    expect([w[0], w[2]].map((x) => +x.toFixed(5))).toEqual([+wu.toFixed(5), +wu.toFixed(5)]);
    expect(w[1]).toBeCloseTo(w[3]);
  });
});

describe('drawCell', () => {
  it('draws the picture 1:1 into the cell and stretches its edges over the gutter', () => {
    const { g, calls } = recorder();
    const rect = { x: 20, y: 30, w: 64, h: 16 };
    drawCell(g, rect, { width: 64, height: 16 }, 4);
    expect(calls[0]).toEqual(['clearRect', 16, 26, 72, 24]);
    const draws = calls.filter((c) => c[0] === 'drawImage').map((c) => c.slice(2));
    expect(draws).toHaveLength(9);
    expect(draws[0]).toEqual([0, 0, 64, 16, 20, 30, 64, 16]); // the picture
    // every gutter pixel is covered: the four strips and the four corners tile the ring around the cell
    let area = 0;
    for (const d of draws.slice(1)) area += d[6] * d[7];
    expect(area).toBe(72 * 24 - 64 * 16);
  });

  it('paints a blank (white) cell when there is no picture', () => {
    const { g, calls } = recorder();
    drawCell(g, { x: 8, y: 8, w: 16, h: 16 }, null, 8);
    expect(calls.map((c) => c[0])).toEqual(['clearRect', 'fillRect']);
    expect(g.fillStyle).toBe('#ffffff');
  });
});

describe('createAtlas', () => {
  it('repaints a cell only when its material map (or the map version) changes, and flags one upload', async () => {
    const { createAtlas } = await import('./auto-atlas.js');
    const tex = (w, h) => ({ image: { width: w, height: h }, version: 1 });
    const plate = { map: tex(256, 64) };
    const badge = { map: null };
    ctxs.length = 0;
    const atlas = createAtlas([{ cell: 'plate', material: plate }, { cell: 'badge', material: badge }]);
    const rec = ctxs[0];
    const draws = () => rec.calls.filter((c) => c[0] === 'drawImage' || c[0] === 'fillRect').length;
    const v0 = atlas.texture.version;
    expect(atlas.sync()).toBe(true);
    expect(atlas.texture.version).toBe(v0 + 1);
    const n1 = draws();
    expect(atlas.sync()).toBe(false); // nothing changed: no repaint, no upload
    expect(draws()).toBe(n1);
    expect(atlas.texture.version).toBe(v0 + 1);
    plate.map.version++; // a late font-load redraw of the plate texture
    expect(atlas.sync()).toBe(true);
    expect(draws()).toBe(n1 + 9);
    badge.map = tex(256, 108);
    expect(atlas.sync()).toBe(true);
    expect(atlas.texture.version).toBe(v0 + 3);
  });
});
