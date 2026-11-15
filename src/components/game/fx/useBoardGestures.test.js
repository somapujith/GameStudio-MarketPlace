import { describe, expect, it, vi } from 'vitest';
import { FIT, MAX_SCALE, boardAt, clampCam } from './cameraMath.js';
import { DOUBLE_TAP_DIST, DOUBLE_TAP_MS, TAP_MS, TAP_SLOP, createGestureMachine } from './useBoardGestures.js';

const W = 390;

/** A machine with a camera it moves itself, and a log of what it reported. */
function rig(start = FIT) {
  let cam = { ...start };
  const log = { begin: 0, end: [], double: [], scroll: [], cams: [] };
  const m = createGestureMachine({
    getCam: () => cam,
    getSize: () => ({ w: W, h: W }),
    onCam: (c) => {
      cam = clampCam(c);
      log.cams.push(cam);
    },
    onBegin: () => {
      log.begin += 1;
    },
    onEnd: (v) => log.end.push(v),
    onDoubleTap: (p) => log.double.push(p),
    onScroll: (dx, dy) => log.scroll.push([dx, dy]),
  });
  return { m, log, cam: () => cam, set: (c) => { cam = { ...c }; } };
}
const pt = (id, x, y, t, extra = {}) => ({ id, x, y, t, type: 'touch', button: 0, ...extra });

describe('a quick tap', () => {
  it('is not a gesture: it reports a tap and leaves the camera alone', () => {
    const { m, log, cam } = rig();
    m.down(pt(1, 100, 100, 0));
    m.move(pt(1, 103, 102, 40)); // inside the slop
    const r = m.up(pt(1, 103, 102, 120));
    expect(r).toEqual({ tap: true, double: false });
    expect(log.begin).toBe(0);
    expect(log.cams).toHaveLength(0);
    expect(cam()).toEqual(FIT);
  });

  it('is not a tap when the finger moved more than 8 px', () => {
    const { m } = rig();
    m.down(pt(1, 100, 100, 0));
    m.move(pt(1, 100 + TAP_SLOP + 2, 100, 40));
    expect(m.up(pt(1, 100 + TAP_SLOP + 2, 100, 80))).toEqual({});
  });

  it('is not a tap when the press is held for 300 ms or more', () => {
    const { m } = rig();
    m.down(pt(1, 100, 100, 0));
    expect(m.up(pt(1, 100, 100, TAP_MS))).toEqual({ tap: false });
  });

  it('a mouse right-click starts nothing', () => {
    const { m } = rig();
    expect(m.down(pt(1, 10, 10, 0, { type: 'mouse', button: 2 }))).toEqual({});
    expect(m.up(pt(1, 10, 10, 20))).toEqual({});
  });
});

describe('double tap', () => {
  it('two taps close in time and place zoom, and report the tapped point', () => {
    const { m, log } = rig();
    m.down(pt(1, 200, 150, 0));
    expect(m.up(pt(1, 200, 150, 60))).toEqual({ tap: true, double: false });
    expect(m.isDoubleCandidate(pt(2, 205, 152, 150))).toBe(true);
    m.down(pt(2, 205, 152, 150));
    const r = m.up(pt(2, 205, 152, 200));
    expect(r).toEqual({ tap: true, double: true });
    expect(log.double).toEqual([{ x: 205, y: 152 }]);
  });

  it('the third tap starts over: a double tap is a pair', () => {
    const { m, log } = rig();
    for (const t of [0, 100, 200]) {
      m.down(pt(1, 50, 50, t));
      m.up(pt(1, 50, 50, t + 30));
    }
    expect(log.double).toHaveLength(1);
  });

  it('two slow taps, or two taps far apart, are two taps', () => {
    const slow = rig();
    slow.m.down(pt(1, 50, 50, 0));
    slow.m.up(pt(1, 50, 50, 50));
    expect(slow.m.isDoubleCandidate(pt(1, 50, 50, 50 + DOUBLE_TAP_MS + 20))).toBe(false);
    slow.m.down(pt(1, 50, 50, 50 + DOUBLE_TAP_MS + 20));
    expect(slow.m.up(pt(1, 50, 50, 50 + DOUBLE_TAP_MS + 60)).double).toBe(false);
    const far = rig();
    far.m.down(pt(1, 50, 50, 0));
    far.m.up(pt(1, 50, 50, 50));
    far.m.down(pt(1, 50 + DOUBLE_TAP_DIST + 10, 50, 120));
    expect(far.m.up(pt(1, 50 + DOUBLE_TAP_DIST + 10, 50, 160)).double).toBe(false);
    expect(slow.log.double).toHaveLength(0);
    expect(far.log.double).toHaveLength(0);
  });

  it('a drag in between cancels the pair', () => {
    const { m, log } = rig({ s: 2, cx: 0.5, cy: 0.5 });
    m.down(pt(1, 50, 50, 0));
    m.up(pt(1, 50, 50, 40));
    m.down(pt(1, 50, 50, 90));
    m.move(pt(1, 90, 50, 120));
    m.up(pt(1, 90, 50, 150));
    expect(log.double).toHaveLength(0);
  });
});

describe('one finger drag', () => {
  it('pans a zoomed board, capturing the pointer, and reports begin / end', () => {
    const { m, log, cam } = rig({ s: 2, cx: 0.5, cy: 0.5 });
    m.down(pt(1, 200, 200, 0));
    const first = m.move(pt(1, 230, 200, 30)); // past the slop
    expect(first).toEqual({ capture: true, prevent: true });
    expect(log.begin).toBe(1);
    expect(cam().cx).toBeCloseTo(0.5 - 30 / (2 * W), 9); // the whole drag, slop included
    m.move(pt(1, 260, 200, 60));
    expect(cam().cx).toBeCloseTo(0.5 - 60 / (2 * W), 9);
    const r = m.up(pt(1, 260, 200, 90));
    expect(r).toEqual({});
    expect(log.end).toHaveLength(1);
    expect(log.end[0].vx).toBeGreaterThan(300); // a steady 1000 px/s drag
  });

  it('stops at the board edge', () => {
    const { m, cam } = rig({ s: 2, cx: 0.26, cy: 0.5 });
    m.down(pt(1, 100, 100, 0));
    m.move(pt(1, 300, 100, 30));
    expect(cam().cx).toBe(0.25);
  });

  it('measures the flick over the last stretch only', () => {
    const { m, log } = rig({ s: 2, cx: 0.5, cy: 0.5 });
    m.down(pt(1, 100, 100, 0));
    m.move(pt(1, 160, 100, 100)); // slow start
    m.move(pt(1, 160, 100, 400)); // a long rest
    m.move(pt(1, 164, 100, 440));
    m.up(pt(1, 164, 100, 480));
    expect(Math.abs(log.end[0].vx)).toBeLessThan(150);
  });

  it('hands a vertical drag on the whole board to the scrolling ancestor, and never moves the camera', () => {
    const { m, log, cam } = rig(FIT);
    m.down(pt(1, 100, 100, 0));
    const r = m.move(pt(1, 100, 130, 40));
    expect(r.capture).toBe(true);
    expect(log.scroll).toEqual([[0, 30]]);
    m.move(pt(1, 100, 150, 80));
    expect(log.scroll).toEqual([[0, 30], [0, 20]]);
    expect(m.up(pt(1, 100, 150, 120))).toEqual({});
    expect(log.begin).toBe(0); // the automatic camera is not paused by a scroll
    expect(log.cams).toHaveLength(0);
    expect(cam()).toEqual(FIT);
  });
});

describe('pinch', () => {
  it('zooms about the pinch midpoint when the second finger goes down', () => {
    const { m, log, cam } = rig({ s: 1.5, cx: 0.5, cy: 0.5 });
    m.down(pt(1, 150, 195, 0));
    const second = m.down(pt(2, 250, 195, 20));
    expect(second).toEqual({ capture: true, prevent: true });
    expect(log.begin).toBe(1);
    const before = boardAt(cam(), 200, 195, W);
    m.move(pt(1, 120, 195, 60)); // 100 -> 130
    m.move(pt(2, 250, 195, 80));
    expect(cam().s).toBeCloseTo(1.5 * 1.3, 6);
    const after = boardAt(cam(), 185, 195, W); // the original midpoint moved with the fingers
    expect(after.x).toBeCloseTo(before.x, 6);
  });

  it('clamps to 1x..3x', () => {
    const { m, cam } = rig({ s: 2, cx: 0.5, cy: 0.5 });
    m.down(pt(1, 190, 195, 0));
    m.down(pt(2, 200, 195, 5));
    m.move(pt(1, 0, 195, 30));
    m.move(pt(2, 390, 195, 40));
    expect(cam().s).toBe(MAX_SCALE);
    m.move(pt(1, 195, 195, 60));
    m.move(pt(2, 196, 195, 70));
    expect(cam().s).toBe(1);
  });

  it('carries on as a pan with the finger that stays down, and is never a tap', () => {
    const { m, log, cam } = rig({ s: 2, cx: 0.5, cy: 0.5 });
    m.down(pt(1, 150, 195, 0));
    m.down(pt(2, 250, 195, 20));
    m.move(pt(2, 270, 195, 40));
    expect(m.up(pt(1, 150, 195, 60))).toEqual({});
    expect(log.end).toHaveLength(0); // still in the gesture
    const x0 = cam().cx;
    m.move(pt(2, 300, 195, 80));
    expect(cam().cx).toBeLessThan(x0);
    const r = m.up(pt(2, 300, 195, 120));
    expect(r).toEqual({});
    expect(log.end).toHaveLength(1);
    expect(log.begin).toBe(1);
  });

  it('ignores a third finger and its lift', () => {
    const { m, log } = rig({ s: 1.5, cx: 0.5, cy: 0.5 });
    m.down(pt(1, 150, 195, 0));
    m.down(pt(2, 250, 195, 10));
    expect(m.down(pt(3, 200, 100, 20))).toEqual({});
    expect(m.move(pt(3, 200, 120, 30))).toEqual({});
    expect(m.up(pt(3, 200, 120, 40))).toEqual({});
    expect(log.end).toHaveLength(0);
    m.move(pt(1, 140, 195, 50));
    expect(log.cams.length).toBeGreaterThan(0);
  });
});

describe('cancel', () => {
  it('aborts a pan without coasting and lets the next touch start clean', () => {
    const { m, log } = rig({ s: 2, cx: 0.5, cy: 0.5 });
    m.down(pt(1, 100, 100, 0));
    m.move(pt(1, 160, 100, 30));
    m.cancel();
    expect(log.end).toEqual([null]);
    expect(m.phase()).toBe('idle');
    m.down(pt(2, 10, 10, 200));
    expect(m.up(pt(2, 10, 10, 240))).toEqual({ tap: true, double: false });
  });

  it('aborts a pinch too', () => {
    const { m, log } = rig({ s: 1.5, cx: 0.5, cy: 0.5 });
    m.down(pt(1, 150, 195, 0));
    m.down(pt(2, 250, 195, 10));
    m.cancel();
    expect(log.end).toEqual([null]);
    expect(m.active()).toBe(false);
  });
});

describe('wheel / trackpad pinch', () => {
  it('ctrl + wheel zooms about the cursor and counts as a (very short) gesture', () => {
    const { m, log, cam } = rig({ s: 1.5, cx: 0.5, cy: 0.5 });
    const before = boardAt(cam(), 300, 120, W);
    const r = m.wheel({ x: 300, y: 120, deltaX: 0, deltaY: -40, ctrlKey: true });
    expect(r).toEqual({ handled: true });
    expect(cam().s).toBeGreaterThan(1.5);
    const after = boardAt(cam(), 300, 120, W);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(log.begin).toBe(1);
    expect(log.end).toEqual([null]);
  });

  it('zooms out with a positive delta and clamps to 1x', () => {
    const { m, cam } = rig({ s: 1.1, cx: 0.5, cy: 0.5 });
    m.wheel({ x: 100, y: 100, deltaY: 400, ctrlKey: true });
    expect(cam().s).toBe(1);
  });

  it('a plain wheel pans a zoomed board and leaves the page alone otherwise', () => {
    const zoomed = rig({ s: 2, cx: 0.5, cy: 0.5 });
    expect(zoomed.m.wheel({ x: 100, y: 100, deltaX: 0, deltaY: 100, ctrlKey: false })).toEqual({ handled: true });
    expect(zoomed.cam().cy).toBeGreaterThan(0.5);
    const whole = rig(FIT);
    expect(whole.m.wheel({ x: 100, y: 100, deltaX: 0, deltaY: 100, ctrlKey: false })).toEqual({ handled: false });
    expect(whole.log.cams).toHaveLength(0);
  });
});

describe('robustness', () => {
  it('ignores events for pointers it never saw', () => {
    const { m } = rig();
    expect(m.move(pt(9, 1, 1, 1))).toEqual({});
    expect(m.up(pt(9, 1, 1, 2))).toEqual({});
  });
  it('a duplicate pointerdown for the same id changes nothing', () => {
    const { m } = rig();
    m.down(pt(1, 10, 10, 0));
    expect(m.down(pt(1, 10, 10, 1))).toEqual({});
    expect(m.up(pt(1, 10, 10, 30)).tap).toBe(true);
  });
  it('is safe without callbacks', () => {
    const m = createGestureMachine({ getCam: () => FIT, getSize: () => ({ w: W, h: W }) });
    m.down(pt(1, 10, 10, 0));
    m.down(pt(2, 60, 10, 5));
    m.move(pt(1, 5, 10, 10));
    m.up(pt(1, 5, 10, 20));
    m.up(pt(2, 60, 10, 25));
    expect(vi.isMockFunction(m.up)).toBe(false);
  });
});
