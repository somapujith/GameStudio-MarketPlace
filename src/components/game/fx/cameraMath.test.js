import { describe, expect, it } from 'vitest';
import { BOARD_SIZE } from '@shared/board.js';
import {
  AUTO_MAX_SCALE, DOUBLE_TAP_SCALE, FIT, FRAME_PAD, MAX_SCALE, ZOOMED_AT, ZOOM_STEPS,
  boardAt, boardPoint, clampCam, clampScale, doubleTapCam, focusCam, followCam, fromTransform, inTopBand, isZoomed,
  panBy, panStep, pinchCam, screenAt, tileBox, toTransform, visibleBox, zoomAbout, zoomStep,
} from './cameraMath.js';

const W = 390;
const near = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const START = 0;
const TRAFFIC = 9;
const CHAI = 18;
const MUNICIPAL = 27;
// the middle of each edge (an edge has 8 tiles: 4 and 5, 13 and 14, 22 and 23, 31 and 32 are the middle pairs)
const EDGE_MIDDLES = { left: [4, 5], top: [13, 14], right: [22, 23], bottom: [31, 32] };

describe('clamping', () => {
  it('keeps the scale in range and the window inside the board', () => {
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(9)).toBe(MAX_SCALE);
    expect(clampScale(NaN)).toBe(1);
    expect(clampScale(5, AUTO_MAX_SCALE)).toBe(AUTO_MAX_SCALE);
    expect(clampCam({ s: 1, cx: 0.9, cy: 0.1 })).toEqual({ s: 1, cx: 0.5, cy: 0.5 }); // nowhere to go at the whole board
    expect(clampCam({ s: 2, cx: 0, cy: 1 })).toEqual({ s: 2, cx: 0.25, cy: 0.75 });
    expect(clampCam({ s: 4, cx: 0.5, cy: 0.5 }).s).toBe(MAX_SCALE);
    expect(clampCam({})).toEqual(FIT);
  });

  it('knows when the board counts as zoomed', () => {
    expect(isZoomed(FIT)).toBe(false);
    expect(isZoomed({ s: ZOOMED_AT, cx: 0.5, cy: 0.5 })).toBe(false);
    expect(isZoomed({ s: 1.06, cx: 0.5, cy: 0.5 })).toBe(true);
    expect(isZoomed(null)).toBe(false);
  });
});

describe('camera <-> CSS transform', () => {
  it('is the identity at the whole board', () => {
    expect(toTransform(FIT, W)).toEqual({ s: 1, tx: 0, ty: 0 });
  });

  it('round-trips, and never lets the board edge into the frame', () => {
    for (const cam of [{ s: 2, cx: 0.3, cy: 0.6 }, { s: 2.2, cx: 0.2, cy: 0.9 }, { s: 3, cx: 0.5, cy: 0.5 }, { s: 1.4, cx: 0.99, cy: 0.01 }]) {
      const c = clampCam(cam);
      const t = toTransform(cam, W);
      expect(t.tx).toBeLessThanOrEqual(1e-9);
      expect(t.ty).toBeLessThanOrEqual(1e-9);
      expect(t.tx + t.s * W).toBeGreaterThanOrEqual(W - 1e-9);
      expect(t.ty + t.s * W).toBeGreaterThanOrEqual(W - 1e-9);
      const back = fromTransform(t, W);
      near(back.cx, c.cx);
      near(back.cy, c.cy);
    }
  });

  it('maps board points to the screen and back', () => {
    const cam = { s: 2, cx: 0.4, cy: 0.6 };
    const p = { x: 0.45, y: 0.55 };
    const px = screenAt(cam, p, W);
    const b = boardAt(cam, px.x, px.y, W);
    near(b.x, p.x);
    near(b.y, p.y);
    expect(screenAt(cam, { x: cam.cx, y: cam.cy }, W)).toEqual({ x: W / 2, y: W / 2 });
  });
});

describe('tiles in board coordinates', () => {
  it('puts the ring inside the frame padding and every tile centre inside its own box', () => {
    for (let id = 0; id < BOARD_SIZE; id += 1) {
      const p = boardPoint(id);
      const b = tileBox(id);
      expect(b.x0).toBeGreaterThanOrEqual(FRAME_PAD - 1e-9);
      expect(b.x1).toBeLessThanOrEqual(1 - FRAME_PAD + 1e-9);
      expect(p.x).toBeGreaterThan(b.x0);
      expect(p.x).toBeLessThan(b.x1);
      expect(p.y).toBeGreaterThan(b.y0);
      expect(p.y).toBeLessThan(b.y1);
    }
  });

  it('runs clockwise from START in the bottom-left corner', () => {
    const s = boardPoint(START);
    const t = boardPoint(TRAFFIC);
    const c = boardPoint(CHAI);
    const m = boardPoint(MUNICIPAL);
    expect(s.x).toBeLessThan(0.2);
    expect(s.y).toBeGreaterThan(0.8);
    expect(t.x).toBeLessThan(0.2);
    expect(t.y).toBeLessThan(0.2);
    expect(c.x).toBeGreaterThan(0.8);
    expect(c.y).toBeLessThan(0.2);
    expect(m.x).toBeGreaterThan(0.8);
    expect(m.y).toBeGreaterThan(0.8);
  });

  it('makes a corner a 1.5x1.5 tile and an edge tile 1x1.5', () => {
    const corner = tileBox(START);
    const edge = tileBox(32); // on the bottom edge: 1 track wide, 1.5 deep
    near(corner.x1 - corner.x0, corner.y1 - corner.y0, 1e-6);
    near((corner.x1 - corner.x0) / (edge.x1 - edge.x0), 1.5, 1e-6);
    near((edge.y1 - edge.y0) / (edge.x1 - edge.x0), 1.5, 1e-6);
  });
});

describe('focusing a tile: the edge of the board never leaves the frame', () => {
  const visibleHasTile = (cam, id) => {
    const v = visibleBox(cam);
    const b = tileBox(id);
    return b.x0 >= v.x0 - 1e-9 && b.x1 <= v.x1 + 1e-9 && b.y0 >= v.y0 - 1e-9 && b.y1 <= v.y1 + 1e-9;
  };

  it('clamps the four corner tiles into the corners of the view', () => {
    const s = 2.2;
    const half = 0.5 / s;
    const at = (id) => focusCam(boardPoint(id), s);
    expect(at(START)).toEqual({ s, cx: half, cy: 1 - half }); // bottom-left
    expect(at(TRAFFIC)).toEqual({ s, cx: half, cy: half }); // top-left
    expect(at(CHAI)).toEqual({ s, cx: 1 - half, cy: half }); // top-right
    expect(at(MUNICIPAL)).toEqual({ s, cx: 1 - half, cy: 1 - half }); // bottom-right
    for (const id of [START, TRAFFIC, CHAI, MUNICIPAL]) {
      expect(visibleHasTile(at(id), id)).toBe(true);
      const t = toTransform(at(id), W);
      expect(t.tx).toBeLessThanOrEqual(1e-9);
      expect(t.tx + t.s * W).toBeGreaterThanOrEqual(W - 1e-9);
    }
  });

  it('follows an edge tile along the cross axis and clamps against the edge it sits on', () => {
    const s = 2.2;
    const half = 0.5 / s;
    for (const id of EDGE_MIDDLES.left) {
      const cam = focusCam(boardPoint(id), s);
      expect(cam.cx).toBe(half); // against the left edge
      near(cam.cy, boardPoint(id).y); // vertically centred on the tile: the middle of the left edge
      expect(visibleHasTile(cam, id)).toBe(true);
    }
    for (const id of EDGE_MIDDLES.right) {
      const cam = focusCam(boardPoint(id), s);
      expect(cam.cx).toBe(1 - half);
      near(cam.cy, boardPoint(id).y);
      expect(visibleHasTile(cam, id)).toBe(true);
    }
    for (const id of EDGE_MIDDLES.top) {
      const cam = focusCam(boardPoint(id), s);
      expect(cam.cy).toBe(half);
      near(cam.cx, boardPoint(id).x);
      expect(visibleHasTile(cam, id)).toBe(true);
    }
    for (const id of EDGE_MIDDLES.bottom) {
      const cam = focusCam(boardPoint(id), s);
      expect(cam.cy).toBe(1 - half);
      near(cam.cx, boardPoint(id).x);
      expect(visibleHasTile(cam, id)).toBe(true);
    }
  });

  it('keeps every tile fully in view at every scale the automatic camera uses', () => {
    for (const s of [1.4, 1.8, 2.0, 2.2, AUTO_MAX_SCALE]) {
      for (let id = 0; id < BOARD_SIZE; id += 1) {
        const cam = focusCam(boardPoint(id), s, AUTO_MAX_SCALE);
        expect(cam.s).toBe(s);
        expect(visibleHasTile(cam, id)).toBe(true);
        const v = visibleBox(cam);
        expect(v.x0).toBeGreaterThanOrEqual(-1e-9);
        expect(v.y0).toBeGreaterThanOrEqual(-1e-9);
        expect(v.x1).toBeLessThanOrEqual(1 + 1e-9);
        expect(v.y1).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('centres a point that is far enough from the edges', () => {
    expect(focusCam({ x: 0.5, y: 0.5 }, 2)).toEqual({ s: 2, cx: 0.5, cy: 0.5 });
    expect(focusCam({ x: 0.4, y: 0.55 }, 1.8)).toEqual({ s: 1.8, cx: 0.4, cy: 0.55 });
  });

  it('knows when the action is in the top of the view (the HUD then docks to the bottom)', () => {
    const cam = focusCam(boardPoint(TRAFFIC), 2.2);
    expect(inTopBand(cam, boardPoint(TRAFFIC))).toBe(true);
    const low = focusCam(boardPoint(START), 2.2);
    expect(inTopBand(low, boardPoint(START))).toBe(false);
  });
});

describe('zoom about a point', () => {
  it('keeps the board point under the cursor where it was', () => {
    const cam = { s: 1.5, cx: 0.5, cy: 0.5 };
    const px = 300;
    const py = 120;
    const before = boardAt(cam, px, py, W);
    const next = zoomAbout(cam, 2.4, px, py, W);
    expect(next.s).toBe(2.4);
    const after = boardAt(next, px, py, W);
    near(after.x, before.x);
    near(after.y, before.y);
  });

  it('clamps the scale and the window', () => {
    const cam = zoomAbout(FIT, 9, 0, 0, W);
    expect(cam.s).toBe(MAX_SCALE);
    expect(cam.cx).toBeCloseTo(0.5 / MAX_SCALE, 9); // zooming into the top-left corner stays against the corner
    expect(zoomAbout({ s: 2, cx: 0.5, cy: 0.5 }, 0.3, 100, 100, W)).toEqual(FIT);
  });
});

describe('panning', () => {
  it('drags the content with the finger and stops at the board edge', () => {
    const cam = { s: 2, cx: 0.5, cy: 0.5 };
    const right = panBy(cam, 100, 0, W); // finger right: the view moves left over the board
    expect(right.cx).toBeLessThan(0.5);
    near(right.cx, 0.5 - 100 / (2 * W));
    expect(right.cy).toBe(0.5);
    const far = panBy(cam, 5000, -5000, W);
    expect(far).toEqual({ s: 2, cx: 0.25, cy: 0.75 });
    expect(panBy(FIT, 80, 80, W)).toEqual(FIT); // nothing to pan at the whole board
  });

  it('steps by a quarter of the window for the keyboard', () => {
    const cam = { s: 2, cx: 0.5, cy: 0.5 };
    near(panStep(cam, 1, 0).cx, 0.5 + 0.125);
    near(panStep(cam, 0, -1).cy, 0.5 - 0.125);
    expect(panStep(FIT, 1, 1)).toEqual(FIT);
  });
});

describe('pinch', () => {
  const start = { cam: { s: 1.5, cx: 0.5, cy: 0.5 }, a: { x: 150, y: 195 }, b: { x: 250, y: 195 } };

  it('zooms with the finger distance', () => {
    const out = pinchCam(start, { a: { x: 100, y: 195 }, b: { x: 300, y: 195 } }, W); // twice as far apart
    near(out.s, 3);
    const inn = pinchCam(start, { a: { x: 175, y: 195 }, b: { x: 225, y: 195 } }, W); // half as far: 0.75x, clamped to the whole board
    expect(inn.s).toBe(1);
  });

  it('zooms about the pinch midpoint: the board point under it follows it', () => {
    const m0 = { x: 200, y: 195 };
    const b0 = boardAt(start.cam, m0.x, m0.y, W);
    const next = pinchCam(start, { a: { x: 160, y: 195 }, b: { x: 240, y: 195 } }, W); // narrower: 0.8x
    near(next.s, 1.2);
    const after = boardAt(next, m0.x, m0.y, W);
    near(after.x, b0.x, 1e-9);
    near(after.y, b0.y, 1e-9);
  });

  it('pans as well when both fingers move together', () => {
    const next = pinchCam(start, { a: { x: 190, y: 195 }, b: { x: 290, y: 195 } }, W); // same distance, 40 px right
    near(next.s, 1.5);
    near(next.cx, 0.5 - 40 / (1.5 * W));
  });

  it('clamps the scale to 1x..3x', () => {
    expect(pinchCam(start, { a: { x: 0, y: 195 }, b: { x: 390, y: 195 } }, W).s).toBe(MAX_SCALE);
    expect(pinchCam(start, { a: { x: 199, y: 195 }, b: { x: 201, y: 195 } }, W).s).toBe(1);
  });
});

describe('double tap', () => {
  it('zooms to 2.2x centred on the tapped point', () => {
    const cam = doubleTapCam(FIT, W / 2, W / 2, W);
    expect(cam).toEqual({ s: DOUBLE_TAP_SCALE, cx: 0.5, cy: 0.5 });
    const right = doubleTapCam(FIT, 0.7 * W, 0.4 * W, W);
    expect(right.s).toBe(DOUBLE_TAP_SCALE);
    near(right.cx, 0.7);
    near(right.cy, 0.4);
  });

  it('clamps a tap near the board edge so the edge stays out of the frame', () => {
    const c = doubleTapCam(FIT, 4, 386, W);
    expect(c).toEqual({ s: DOUBLE_TAP_SCALE, cx: 0.5 / DOUBLE_TAP_SCALE, cy: 1 - 0.5 / DOUBLE_TAP_SCALE });
  });

  it('goes back to the whole board from any zoom', () => {
    expect(doubleTapCam({ s: 2.2, cx: 0.3, cy: 0.3 }, 100, 100, W)).toEqual(FIT);
    expect(doubleTapCam({ s: 1.2, cx: 0.5, cy: 0.5 }, 100, 100, W)).toEqual(FIT);
    expect(doubleTapCam({ s: ZOOMED_AT, cx: 0.5, cy: 0.5 }, 100, 100, W).s).toBe(DOUBLE_TAP_SCALE); // not yet "zoomed"
  });
});

describe('zoom steps (HUD buttons and keys)', () => {
  it('walks 1 -> 1.6 -> 2.2 -> 3 and back, about the centre of the view', () => {
    expect(ZOOM_STEPS).toEqual([1, 1.6, 2.2, 3]);
    let cam = { ...FIT };
    const seen = [];
    for (let i = 0; i < 5; i += 1) {
      cam = zoomStep(cam, 1);
      seen.push(cam.s);
    }
    expect(seen).toEqual([1.6, 2.2, 3, 3, 3]);
    for (let i = 0; i < 5; i += 1) {
      cam = zoomStep(cam, -1);
      seen.push(cam.s);
    }
    expect(seen.slice(5)).toEqual([2.2, 1.6, 1, 1, 1]);
    const off = zoomStep({ s: 1.6, cx: 0.4, cy: 0.6 }, 1);
    expect([off.cx, off.cy]).toEqual([0.4, 0.6]);
  });

  it('snaps in-between zooms to the next step', () => {
    expect(zoomStep({ s: 1.2, cx: 0.5, cy: 0.5 }, 1).s).toBe(1.6);
    expect(zoomStep({ s: 1.2, cx: 0.5, cy: 0.5 }, -1).s).toBe(1);
    expect(zoomStep({ s: 2.6, cx: 0.5, cy: 0.5 }, 1).s).toBe(3);
    expect(zoomStep({ s: 2.6, cx: 0.5, cy: 0.5 }, -1).s).toBe(2.2);
  });
});

describe('following a pawn', () => {
  const p0 = { x: 0.5, y: 0.5 };

  it('centres on the pawn to start with and when the scale changes', () => {
    expect(followCam(null, p0, 1.8)).toEqual({ s: 1.8, cx: 0.5, cy: 0.5 });
    const prev = followCam(null, p0, 1.8);
    const next = followCam(prev, p0, 1.4);
    expect(next.s).toBe(1.4);
  });

  it('keeps the camera still while the pawn stays in the middle third', () => {
    const prev = followCam(null, p0, 1.8);
    const stillIn = { x: 0.5 + 0.04, y: 0.5 }; // 0.04 * 1.8 = 7% of the view
    expect(followCam(prev, stillIn, 1.8)).toBe(prev);
  });

  it('re-centres once the pawn leaves the middle third, and the board edge still stays out', () => {
    const prev = followCam(null, p0, 1.8);
    const out = { x: 0.5 + 0.12, y: 0.5 }; // 0.12 * 1.8 = 22% of the view from the centre: past the 16.7% band
    const next = followCam(prev, out, 1.8);
    expect(next).not.toBe(prev);
    near(next.cx, 0.62);
    const edge = followCam(prev, boardPoint(START), 1.8);
    const v = visibleBox(edge);
    expect(v.x0).toBeGreaterThanOrEqual(-1e-9);
    expect(v.y1).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('never goes above the automatic zoom limit', () => {
    expect(followCam(null, p0, 3).s).toBe(AUTO_MAX_SCALE);
  });
});
