// Board camera math: pure functions, no DOM, no React. The camera is `{ s, cx, cy }`:
//   s       scale, 1 (the whole board) .. MAX_SCALE
//   cx, cy  the point of the board (fractions 0..1 of the board's own box) that sits in the middle of the viewport
// The viewport is the board's box, which is square, so one set of bounds serves both axes: at scale `s` the viewport
// shows a window of 1/s of the board, so the centre can only travel between 0.5/s and 1 - 0.5/s. That one clamp is
// what keeps the board's edge from ever leaving the frame.
//
// The wrapper applies it as `translate(tx, ty) scale(s)` with transform-origin 0 0 (see `toTransform`).
// Parametrising by the centre point (not by the translation) is what makes zoom-ins look right: the focused point stays
// put while the scale grows, instead of the translation and the scale fighting each other along a curve.

import { tilePosition } from '@shared/board.js';
import { TRACKS, tileCenter, trackSize, trackStart } from './geometry.js';

export const MIN_SCALE = 1;
export const MAX_SCALE = 3; // the most a finger / button can zoom
export const AUTO_MAX_SCALE = 2.4; // the most the automatic camera ever zooms
export const ZOOMED_AT = 1.05; // above this the board counts as zoomed: one finger pans, the HUD shows
export const DOUBLE_TAP_SCALE = 2.2;
export const ZOOM_STEPS = Object.freeze([1, 1.6, 2.2, 3]); // the HUD's + / - buttons and the keyboard
/** `.hb-frame` padding in board.css (`--hb-pad: 2.2cqw`): the ring sits inside it. Keep in sync with board.css. */
export const FRAME_PAD = 0.022;

export const FIT = Object.freeze({ s: 1, cx: 0.5, cy: 0.5 });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

export const clampScale = (s, max = MAX_SCALE) => clamp(num(s, 1), MIN_SCALE, max);

/** The nearest legal camera: scale in range and the window inside the board. */
export function clampCam(cam, max = MAX_SCALE) {
  const s = clampScale(cam?.s, max);
  const half = 0.5 / s;
  return { s, cx: clamp(num(cam?.cx, 0.5), half, 1 - half), cy: clamp(num(cam?.cy, 0.5), half, 1 - half) };
}

export const isZoomed = (cam) => !!cam && cam.s > ZOOMED_AT;

/** True when two cameras show (almost) the same thing. */
export const sameCam = (a, b, eps = 1e-3) =>
  !!a && !!b && Math.abs(a.s - b.s) < eps && Math.abs(a.cx - b.cx) < eps && Math.abs(a.cy - b.cy) < eps;

// ---- tiles in board coordinates ---------------------------------------------------------------------------------

/** Centre of a tile as fractions of the BOARD box (geometry.js speaks in fractions of the ring box inside the padding). */
export function boardPoint(tileId) {
  const c = tileCenter(tileId);
  const k = 1 - 2 * FRAME_PAD;
  return { x: FRAME_PAD + c.x * k, y: FRAME_PAD + c.y * k };
}

/** A tile's box as board fractions: { x0, y0, x1, y1 }. */
export function tileBox(tileId) {
  const { col, row } = tilePosition(tileId);
  const k = 1 - 2 * FRAME_PAD;
  const x0 = trackStart(col) / TRACKS;
  const y0 = trackStart(row) / TRACKS;
  return {
    x0: FRAME_PAD + x0 * k,
    y0: FRAME_PAD + y0 * k,
    x1: FRAME_PAD + (x0 + trackSize(col) / TRACKS) * k,
    y1: FRAME_PAD + (y0 + trackSize(row) / TRACKS) * k,
  };
}

/** The part of the board the camera shows: { x0, y0, x1, y1 } as board fractions. */
export function visibleBox(cam) {
  const half = 0.5 / cam.s;
  return { x0: cam.cx - half, y0: cam.cy - half, x1: cam.cx + half, y1: cam.cy + half };
}

/** Camera centred on a board point (clamped so the board's edge stays out of the frame). */
export const focusCam = (point, s, max = MAX_SCALE) => clampCam({ s, cx: point.x, cy: point.y }, max);

// ---- camera <-> CSS transform ------------------------------------------------------------------------------------

/** { s, tx, ty }: `transform: translate(tx px, ty px) scale(s)` with transform-origin 0 0, for a w x h viewport. */
export function toTransform(cam, w, h = w) {
  const c = clampCam(cam);
  return { s: c.s, tx: w / 2 - c.cx * c.s * w, ty: h / 2 - c.cy * c.s * h };
}

export function fromTransform({ s, tx, ty }, w, h = w) {
  return clampCam({ s, cx: (w / 2 - tx) / (s * w), cy: (h / 2 - ty) / (s * h) });
}

/** The board point under a viewport pixel. */
export const boardAt = (cam, px, py, w, h = w) => ({ x: cam.cx + (px / w - 0.5) / cam.s, y: cam.cy + (py / h - 0.5) / cam.s });

/** Where a board point lands in the viewport, in pixels. */
export const screenAt = (cam, point, w, h = w) => ({ x: (0.5 + (point.x - cam.cx) * cam.s) * w, y: (0.5 + (point.y - cam.cy) * cam.s) * h });

// ---- gestures ------------------------------------------------------------------------------------------------

/** Zoom to `s2` keeping the board point under viewport pixel (px, py) where it is (a wheel / trackpad pinch). */
export function zoomAbout(cam, s2, px, py, w, h = w) {
  const b = boardAt(cam, px, py, w, h);
  const s = clampScale(s2);
  return clampCam({ s, cx: b.x - (px / w - 0.5) / s, cy: b.y - (py / h - 0.5) / s });
}

/** Drag the content by (dx, dy) viewport pixels (a finger moving right moves the board right). */
export function panBy(cam, dx, dy, w, h = w) {
  return clampCam({ s: cam.s, cx: cam.cx - dx / (cam.s * w), cy: cam.cy - dy / (cam.s * h) });
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Two-finger pinch. `start` = { cam, a, b } (the camera and the two finger positions when the second finger went
 * down), `now` = { a, b } (where they are now), all in viewport pixels. The scale follows the finger distance and the
 * board point that was under the original midpoint follows the current midpoint: zoom about the pinch centre, and
 * dragging both fingers pans as well.
 */
export function pinchCam(start, now, w, h = w) {
  const d0 = Math.hypot(start.b.x - start.a.x, start.b.y - start.a.y) || 1;
  const d1 = Math.hypot(now.b.x - now.a.x, now.b.y - now.a.y);
  const s = clampScale(start.cam.s * (d1 / d0));
  const m0 = mid(start.a, start.b);
  const m1 = mid(now.a, now.b);
  const b = boardAt(start.cam, m0.x, m0.y, w, h);
  return clampCam({ s, cx: b.x - (m1.x / w - 0.5) / s, cy: b.y - (m1.y / h - 0.5) / s });
}

/** Double tap at a viewport pixel: back to the whole board when zoomed, else DOUBLE_TAP_SCALE centred on that point. */
export function doubleTapCam(cam, px, py, w, h = w) {
  if (isZoomed(cam)) return { ...FIT };
  return focusCam(boardAt(cam, px, py, w, h), DOUBLE_TAP_SCALE);
}

/** One step of the + / - buttons or keys about the centre of the view. dir > 0 in, < 0 out. */
export function zoomStep(cam, dir) {
  const eps = 0.04;
  let s = cam.s;
  if (dir > 0) s = ZOOM_STEPS.find((v) => v > cam.s + eps) ?? MAX_SCALE;
  else s = [...ZOOM_STEPS].reverse().find((v) => v < cam.s - eps) ?? MIN_SCALE;
  return clampCam({ s, cx: cam.cx, cy: cam.cy });
}

/** A keyboard pan: a quarter of the visible window per press. dx / dy are -1, 0 or 1. */
export function panStep(cam, dx, dy) {
  const k = 0.25 / cam.s;
  return clampCam({ s: cam.s, cx: cam.cx + dx * k, cy: cam.cy + dy * k });
}

// ---- following a pawn --------------------------------------------------------------------------------------------

/**
 * The camera to aim at while following `point` at scale `s`. A camera that is already at that scale and still has the
 * pawn inside the middle `band` of the view (default the middle third) stays put, so the view does not twitch at every
 * step; once the pawn leaves the band the camera re-centres on it. `prev` is the previous target (or null).
 */
export function followCam(prev, point, s, band = 1 / 3, max = AUTO_MAX_SCALE) {
  const next = focusCam(point, s, max);
  if (!prev || Math.abs(prev.s - next.s) > 1e-3) return next;
  const sx = 0.5 + (point.x - prev.cx) * prev.s;
  const sy = 0.5 + (point.y - prev.cy) * prev.s;
  const lo = 0.5 - band / 2;
  const hi = 0.5 + band / 2;
  return sx >= lo && sx <= hi && sy >= lo && sy <= hi ? prev : next;
}

/** Which half of the view a board point is in under `cam`: true when it is in the top 30% (the HUD docks to the bottom then). */
export const inTopBand = (cam, point, band = 0.3) => 0.5 + (point.y - cam.cy) * cam.s < band;
