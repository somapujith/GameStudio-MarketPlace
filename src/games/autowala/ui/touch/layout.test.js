import { describe, expect, it } from 'vitest';
import { MAIN_ACTIONS, computeLayout, mirrorX, orientationOf, place, regionsFromRects, sideFor } from './layout.js';

const PHONES_LAND = [[844, 390], [915, 412], [667, 375], [932, 430], [740, 360]];
const PHONES_PORT = [[390, 844], [360, 640], [412, 915], [375, 667]];

describe('sides and mirroring', () => {
  it('right-handed: wheel left, pedals right; left-handed swaps them', () => {
    expect(sideFor('right', 'wheel')).toBe('left');
    expect(sideFor('right', 'pedal')).toBe('right');
    expect(sideFor('left', 'wheel')).toBe('right');
    expect(sideFor('left', 'pedal')).toBe('left');
    expect(sideFor(undefined, 'wheel')).toBe('left');
  });
  it('mirrorX flips a box across the viewport', () => {
    expect(mirrorX(14, 100, 800)).toBe(686);
    expect(mirrorX(mirrorX(14, 100, 800), 100, 800)).toBe(14);
  });
  it('place() anchors to the chosen side inside the safe area', () => {
    const p = place('right', 14, 20);
    expect(p.right).toContain('safe-area-inset-right');
    expect(p.bottom).toContain('safe-area-inset-bottom');
    expect(p.left).toBeUndefined();
    expect(place('left', 1, 2).left).toContain('safe-area-inset-left');
  });
  it('orientationOf', () => {
    expect(orientationOf(844, 390)).toBe('land');
    expect(orientationOf(390, 844)).toBe('port');
    expect(orientationOf(500, 500)).toBe('port');
  });
});

describe('landscape layout (the road stays visible)', () => {
  for (const [w, h] of PHONES_LAND) {
    it(`${w}x${h}: wheel ~28% wide or fitted, nothing in the middle 40%, buttons 48-56 px, everything on screen`, () => {
      for (const size of ['S', 'M', 'L']) {
        const L = computeLayout({ w, h }, { size });
        expect(L.mode).toBe('land');
        expect(L.btn).toBeGreaterThanOrEqual(48);
        expect(L.btn).toBeLessThanOrEqual(56);
        // the two sides together leave the middle 38% or more free (the brief: about the central 40%)
        expect(L.leftW + L.rightW).toBeLessThanOrEqual(w * 0.62 + 2);
        expect(L.leftW).toBeLessThanOrEqual(w * 0.4);
        expect(L.rightW).toBeLessThanOrEqual(w * 0.4);
        expect(L.h).toBeLessThanOrEqual(h * 0.85);
        expect(L.wheel.size).toBeGreaterThanOrEqual(100);
        // every button fits inside its side
        for (const a of L.actions) {
          if (a.from !== 'wheel') expect(a.x + L.btn).toBeLessThanOrEqual(L.rightW);
          expect(a.y + L.btn).toBeLessThanOrEqual(L.h);
        }
        expect(L.gas.h).toBeGreaterThan(L.brake.h); // the gas is the big one
        expect(L.gas.w).toBeGreaterThan(L.brake.w);
        expect(L.wheel.size).toBeLessThanOrEqual(h * 0.62);
      }
    });
  }
  it('the wheel is about 28% of the width on a roomy landscape screen', () => {
    const L = computeLayout({ w: 1000, h: 800 }, { size: 'M' });
    expect(L.wheel.size).toBeGreaterThanOrEqual(220);
  });
  it('size L is bigger than S, same arrangement', () => {
    const S = computeLayout({ w: 844, h: 390 }, { size: 'S' });
    const L = computeLayout({ w: 844, h: 390 }, { size: 'L' });
    expect(L.btn).toBeGreaterThan(S.btn);
    expect(L.gas.h).toBeGreaterThan(S.gas.h);
    expect(L.actions.map((a) => a.id)).toEqual(S.actions.map((a) => a.id));
  });
  it('lists the five main actions and collapses the small ones into a tray on a short screen', () => {
    const L = computeLayout({ w: 844, h: 390 }, {});
    expect(L.actions.map((a) => a.id).sort()).toEqual(MAIN_ACTIONS.map((a) => a.id).sort());
    expect(L.tray.inline).toBe(false);
    expect(computeLayout({ w: 1180, h: 820 }, {}).tray.inline).toBe(true);
  });
  it('no two buttons overlap', () => {
    for (const [w, h] of PHONES_LAND) {
      const L = computeLayout({ w, h }, { size: 'L' });
      const boxes = [
        ...L.actions.filter((a) => a.from !== 'wheel').map((a) => ({ id: a.id, x: a.x, y: a.y, w: L.btn, h: L.btn })),
        { id: 'gas', x: L.gas.x, y: L.gas.y, w: L.gas.w, h: L.gas.h },
        { id: 'brake', x: L.brake.x, y: L.brake.y, w: L.brake.w, h: L.brake.h },
      ];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(hit, `${w}x${h}: ${a.id} overlaps ${b.id}`).toBe(false);
        }
      }
    }
  });
});

describe('landscape budget: the controls leave the rest of the screen to the HUD', () => {
  for (const [w, h] of PHONES_LAND) {
    it(`${w}x${h}: the controls take at most ~half the height, the wheel at most 42% of it, buttons 48 px`, () => {
      const L = computeLayout({ w, h }, { size: 'M', tray: false });
      expect(L.h).toBeLessThanOrEqual(h * 0.56);
      expect(L.wheel.size).toBeLessThanOrEqual(h * 0.42);
      expect(L.btn).toBe(48);
      expect(L.hasTray).toBe(false);
      expect(L.minor).toBeNull();
    });
  }
  it('the right-hand column (horn, interact, camera) sits beside the pedals, not above them', () => {
    const L = computeLayout({ w: 640, h: 360 }, { tray: false });
    const by = Object.fromEntries(L.actions.map((a) => [a.id, a]));
    expect(by.horn.x).toBe(by.interact.x);
    expect(by.horn.x).toBe(by.camera.x);
    expect(by.horn.x).toBeGreaterThan(L.brake.x + L.brake.w - 1);
    expect(by.boost.y).toBeGreaterThan(L.gas.y + L.gas.h - 1);
  });
  it('with the tray (a desktop-width touch screen without the More sheet) the wheel side is taller by the tray row', () => {
    const a = computeLayout({ w: 844, h: 390 }, { tray: true });
    const b = computeLayout({ w: 844, h: 390 }, { tray: false });
    expect(a.h).toBeGreaterThan(b.h);
    expect(a.hasTray).toBe(true);
  });
});

describe('portrait layout (reflowed)', () => {
  for (const [w, h] of PHONES_PORT) {
    it(`${w}x${h}: smaller wheel left, pedals right, one row of actions above, all inside the width`, () => {
      const L = computeLayout({ w, h }, { size: 'M' });
      expect(L.mode).toBe('port');
      expect(L.wheel.size).toBeLessThan(w * 0.45);
      expect(L.leftW + L.rightW).toBeLessThanOrEqual(w + 2);
      const ys = new Set(L.actions.map((a) => a.y));
      expect(ys.size).toBe(1); // one row
      for (const a of L.actions) expect(a.x + L.btn).toBeLessThanOrEqual(w);
      expect(L.tray.x + L.btn).toBeLessThanOrEqual(w + 6);
      expect(L.h).toBeLessThan(h * 0.45);
      expect(L.btn).toBeGreaterThanOrEqual(48 - 0);
    });
  }
  it('a small portrait phone gets the tray, a tablet the inline row', () => {
    expect(computeLayout({ w: 360, h: 640 }, {}).tray.inline).toBe(false);
    expect(computeLayout({ w: 768, h: 1024 }, {}).tray.inline).toBe(true);
  });
});

describe('regionsFromRects (what the HUD reads)', () => {
  const vw = 844;
  const vh = 390;
  const r = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left });
  const items = [
    { zone: 'wheel', rect: r(14, 200, 190, 376) },
    { zone: 'pedal', rect: r(640, 220, 830, 376) },
    { zone: 'pedal', rect: r(590, 150, 642, 202) },
  ];
  it('right-handed: wheel zone is the left width, pedal zone the right width, h is the tallest', () => {
    expect(regionsFromRects(items, vw, vh, 'right')).toEqual({ left: 190, right: 844 - 590, h: 390 - 150 });
  });
  it('left-handed: the same boxes swap sides', () => {
    const mirrored = items.map((it) => ({ zone: it.zone, rect: r(vw - it.rect.right, it.rect.top, vw - it.rect.left, it.rect.bottom) }));
    expect(regionsFromRects(mirrored, vw, vh, 'left')).toEqual({ left: 844 - 590, right: 190, h: 390 - 150 });
  });
  it('a full-width row only counts toward the height', () => {
    const withRow = [...items, { zone: 'row', rect: r(12, 100, 400, 150) }];
    const out = regionsFromRects(withRow, vw, vh, 'right');
    expect(out.left).toBe(190);
    expect(out.h).toBe(290);
  });
  it('nothing measured is all zero', () => {
    expect(regionsFromRects([], vw, vh)).toEqual({ left: 0, right: 0, h: 0 });
    expect(regionsFromRects([{ zone: 'wheel', rect: r(0, 0, 0, 0) }], vw, vh)).toEqual({ left: 0, right: 0, h: 0 });
  });
});
