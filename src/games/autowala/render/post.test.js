import { describe, expect, it } from 'vitest';
import { bloomGain, bloomSizes, bloomWeights, clampScale, scaleRect } from './post.js';
import { opaqueByProgram, shadowDue } from './renderer.js';
import { QUALITY } from '../game/config.js';

describe('render scale', () => {
  it('clamps to 0.5..1 and snaps to 1/32 steps', () => {
    expect(clampScale(0.2)).toBe(0.5);
    expect(clampScale(3)).toBe(1);
    expect(clampScale(NaN)).toBe(1);
    expect(clampScale(0.8)).toBe(Math.round(0.8 * 32) / 32);
    expect(clampScale(0.8) * 32).toBeCloseTo(Math.round(clampScale(0.8) * 32), 9);
  });

  it('maps a scale onto a sub-rectangle of the fixed target', () => {
    const r = scaleRect(1920, 1080, 0.5);
    expect(r).toMatchObject({ w: 960, h: 540 });
    expect(r.u).toBeCloseTo(0.5, 9);
    expect(r.v).toBeCloseTo(0.5, 9);
    const full = scaleRect(1920, 1080, 1);
    expect(full).toMatchObject({ w: 1920, h: 1080, u: 1, v: 1 });
    expect(scaleRect(4, 4, 0.1).w).toBeGreaterThanOrEqual(2);
  });
});

describe('bloom pyramid', () => {
  it('halves every level from 1/4 resolution and never goes below 2 px', () => {
    const s = bloomSizes(1920, 1080, 5);
    expect(s[0]).toEqual({ w: 480, h: 270 });
    expect(s[1]).toEqual({ w: 240, h: 135 });
    expect(s[4]).toEqual({ w: 30, h: 17 });
    expect(bloomSizes(8, 8, 4).every((l) => l.w >= 2 && l.h >= 2)).toBe(true);
    expect(bloomSizes(1920, 1080, 0)).toEqual([]);
  });

  it('weights fall slowly with depth (UnrealBloom factors blended with its radius)', () => {
    const w = bloomWeights(5);
    expect(w[0]).toBeCloseTo(0.664, 2);
    expect(w[4]).toBeCloseTo(0.536, 2);
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeLessThan(w[i - 1]);
  });

  it('carries the same energy for the same strength whatever the level count', () => {
    const w5 = bloomWeights(5);
    const w4 = bloomWeights(4);
    const sum = (w) => w.reduce((a, b) => a + b, 0);
    const energy = (levels) => bloomGain(0.3, levels) * (sum(bloomWeights(levels)) / bloomWeights(levels)[0]);
    expect(energy(5)).toBeCloseTo(0.3 * sum(w5), 6);
    expect(energy(4)).toBeCloseTo(0.3 * sum(w5), 6);
    expect(bloomGain(0.3, 0)).toBe(0);
    expect(sum(w4)).toBeLessThan(sum(w5));
  });
});

describe('shadow schedule', () => {
  it('re-renders every frame when the interval is 0, and honours dirty', () => {
    expect(shadowDue(0, 0)).toBe(true);
    expect(shadowDue(0.001, 0.024)).toBe(false);
    expect(shadowDue(0.001, 0.024, true)).toBe(true);
  });

  it('skips one frame at 60 fps for a 24 ms interval but never at 30 fps', () => {
    let since = 0;
    const due = [];
    for (let i = 0; i < 6; i++) {
      since += 1 / 60;
      const d = shadowDue(since, 0.024);
      due.push(d);
      if (d) since = 0;
    }
    expect(due).toEqual([false, true, false, true, false, true]);
    expect(shadowDue(1 / 30, 0.024)).toBe(true);
  });
});

describe('quality tiers are monotone', () => {
  const t = ['low', 'medium', 'high'].map((k) => QUALITY[k]);
  const up = (key) => t.every((q, i) => i === 0 || q[key] >= t[i - 1][key]);
  it('never gets cheaper or uglier going up', () => {
    for (const k of ['pixelRatio', 'shadow', 'bloomLevels', 'msaa', 'traffic', 'peds', 'drawDist']) expect(up(k)).toBe(true);
    // a SMALLER interval is better quality
    expect(t[1].shadowInterval).toBeLessThanOrEqual(t[0].shadowInterval);
    expect(t[2].shadowInterval).toBeLessThanOrEqual(t[1].shadowInterval);
    expect(t[0].bloom).toBe(false);
    expect(t[1].bloom && t[2].bloom).toBe(true);
  });
});

describe('opaque draw order', () => {
  const mats = { a1: { id: 1, p: 7 }, a2: { id: 4, p: 7 }, b1: { id: 2, p: 3 }, b2: { id: 5, p: 3 }, c1: { id: 3, p: 9 } };
  const item = (id, m, z = 0, extra = {}) => ({ id, material: mats[m], materialVariant: 0, groupOrder: 0, renderOrder: 0, z, ...extra });
  const programOf = (m) => m.p;

  it('puts every draw of one program next to each other, even when material ids interleave them', () => {
    const list = [item(1, 'a1'), item(2, 'b1'), item(3, 'c1'), item(4, 'a2'), item(5, 'b2')];
    list.sort(opaqueByProgram(programOf));
    const programs = list.map((i) => i.material.p);
    expect(programs).toEqual([3, 3, 7, 7, 9]);
    // the stock sort (material id only) would give 7,3,9,7,3: five program switches instead of three
    const stock = [...list].sort((x, y) => x.material.id - y.material.id).map((i) => i.material.p);
    const switches = (a) => a.filter((p, i) => i && p !== a[i - 1]).length;
    expect(switches(programs)).toBeLessThan(switches(stock));
  });

  it('keeps render order first (the sky stays last) and front-to-back inside one material', () => {
    const list = [item(1, 'a1', 50), item(2, 'a1', 10), item(3, 'b1', 5, { renderOrder: 10000 }), item(4, 'c1', 1, { groupOrder: 0 })];
    list.sort(opaqueByProgram(programOf));
    expect(list[list.length - 1].id).toBe(3);
    const a = list.filter((i) => i.material === mats.a1).map((i) => i.z);
    expect(a).toEqual([10, 50]);
  });
});