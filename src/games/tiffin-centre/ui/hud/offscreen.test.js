import { describe, it, expect } from 'vitest';
import { CHIP_H, CHIP_W, edgePlacement, fallbackSideFor, isOnScreen, layoutEdgeChips } from './offscreen.js';
import { createProjector } from './projector.js';

describe('on screen or not', () => {
  it('needs a visible, finite point inside the viewport', () => {
    expect(isOnScreen({ x: 100, y: 100, visible: true }, 400, 800)).toBe(true);
    expect(isOnScreen({ x: 100, y: 100, visible: false }, 400, 800)).toBe(false);
    expect(isOnScreen({ x: -80, y: 100, visible: true }, 400, 800)).toBe(false);
    expect(isOnScreen({ x: 100, y: 900, visible: true }, 400, 800)).toBe(false);
    expect(isOnScreen(null, 400, 800)).toBe(false);
    expect(isOnScreen({ x: NaN, y: 1, visible: true }, 400, 800)).toBe(false);
  });
});

describe('edge placement', () => {
  it('is null for a customer in view', () => {
    expect(edgePlacement({ x: 10, y: 10, visible: true }, 400, 800)).toBeNull();
  });
  it('uses the scene hint when there is one', () => {
    expect(edgePlacement({ visible: false, edge: { side: 'left', x: 0, y: 300 } }, 400, 800)).toEqual({ side: 'left', x: 0, y: 300 });
    expect(edgePlacement({ visible: false, edge: { side: 'behind', x: 200, y: 800 } }, 400, 800).side).toBe('behind');
  });
  it('works out the side itself from where the point fell, else from the fallback side', () => {
    expect(edgePlacement({ x: -200, y: 120, visible: true }, 400, 800)).toMatchObject({ side: 'left', x: 0, y: 120 });
    expect(edgePlacement({ x: 900, y: 120, visible: true }, 400, 800)).toMatchObject({ side: 'right', x: 400 });
    expect(edgePlacement({ visible: false }, 400, 800, 'left').side).toBe('left');
    expect(fallbackSideFor(-2, 0)).toBe('left');
    expect(fallbackSideFor(2, 0)).toBe('right');
  });
});

describe('layout of the arrow chips', () => {
  const bounds = { top: 120, bottom: 600, left: 0, right: 400 };
  it('keeps every chip inside the free area', () => {
    const out = layoutEdgeChips(
      [{ id: 1, side: 'left', x: 0, y: -50 }, { id: 2, side: 'right', x: 400, y: 5000 }, { id: 3, side: 'behind', x: -90, y: 800 }],
      bounds,
    );
    for (const c of out) {
      expect(c.x - CHIP_W / 2).toBeGreaterThanOrEqual(bounds.left);
      expect(c.x + CHIP_W / 2).toBeLessThanOrEqual(bounds.right);
      expect(c.y - CHIP_H / 2).toBeGreaterThanOrEqual(bounds.top);
      expect(c.y + CHIP_H / 2).toBeLessThanOrEqual(bounds.bottom);
    }
    expect(out.find((c) => c.id === 1).x).toBeLessThan(200);
    expect(out.find((c) => c.id === 2).x).toBeGreaterThan(200);
  });
  it('stacks chips on one edge without overlap, even when they all ask for the same spot, and shifts the stack up at the bottom', () => {
    const items = [1, 2, 3, 4, 5].map((id) => ({ id, side: 'right', x: 400, y: 590 }));
    const out = layoutEdgeChips(items, bounds).sort((a, b) => a.y - b.y);
    for (let i = 1; i < out.length; i += 1) expect(out[i].y - out[i - 1].y).toBeGreaterThanOrEqual(CHIP_H);
    expect(out[out.length - 1].y + CHIP_H / 2).toBeLessThanOrEqual(bounds.bottom);
  });
  it('lines the behind-you chips up in a row along the bottom', () => {
    const out = layoutEdgeChips([{ id: 7, side: 'behind', x: 100, y: 800 }, { id: 8, side: 'behind', x: 110, y: 800 }], bounds);
    const [a, b] = out.sort((p, q) => p.x - q.x);
    expect(b.x - a.x).toBeGreaterThanOrEqual(CHIP_W);
    expect(a.y).toBe(b.y);
  });
});

describe('the shared projector', () => {
  const customers = [{ id: 1, spot: 0 }, { id: 2, spot: 5 }];
  const scene = {
    calls: 0,
    project(target, out) {
      this.calls += 1;
      return target.id === 1 ? Object.assign(out, { x: 100, y: 200, visible: true }) : Object.assign(out, { x: 0, y: 0, visible: false, edge: { side: 'right', x: 400, y: 300 } });
    },
  };
  it('projects once per frame and splits in view from edge', () => {
    const p = createProjector();
    p.size.w = 400;
    p.size.h = 800;
    const m = p.frame(10, scene, customers);
    p.frame(10, scene, customers); // same frame: cached
    expect(scene.calls).toBe(2);
    expect(m.get(1).on).toBe(true);
    expect(p.inView.has(1)).toBe(true);
    expect(m.get(2)).toMatchObject({ on: false, edge: { side: 'right' } });
    p.frame(11, scene, customers);
    expect(scene.calls).toBe(4);
  });
  it('copes with a scene that has no project()', () => {
    const p = createProjector();
    expect(p.frame(1, {}, customers).size).toBe(0);
  });
});
