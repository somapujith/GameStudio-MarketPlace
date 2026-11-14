// Board geometry shared by the board, the pawns and the camera: where a tile sits on the GRID x GRID ring,
// in fractions of the ring's own box. Everything derives from `tilePosition` and `GRID` in @shared/board.js,
// so the layout follows the engine's board (Hustle: 36 tiles on a 10x10 ring, START bottom-left, clockwise).
//
// Track sizes mirror `.hb-grid` in board.css: the two corner tracks are CORNER_W edge tracks wide, the
// GRID - 2 tracks between them are 1. (The hairline gaps between tiles are ignored: < 0.5% of the board.)

import { GRID, tilePosition } from '@shared/board.js';

export const CORNER_W = 1.5;
const LAST = GRID - 1;
/** Ring width in edge-tile units. */
export const TRACKS = CORNER_W * 2 + (GRID - 2);

export const trackSize = (i) => (i === 0 || i === LAST ? CORNER_W : 1);
export const trackStart = (i) => (i === 0 ? 0 : CORNER_W + (i - 1));

/** 'bl' | 'tl' | 'tr' | 'br' for a corner tile, else null. */
export function cornerOf(id) {
  const { col, row } = tilePosition(id);
  if (col === 0 && row === LAST) return 'bl';
  if (col === 0 && row === 0) return 'tl';
  if (col === LAST && row === 0) return 'tr';
  if (col === LAST && row === LAST) return 'br';
  return null;
}

export const isCorner = (id) => cornerOf(id) !== null;

/** Which edge an edge tile sits on: 'left' | 'top' | 'right' | 'bottom'. Corners report the edge they end. */
export function sideOf(id) {
  const { col, row } = tilePosition(id);
  if (col === 0 && row > 0) return 'left';
  if (row === 0 && col < LAST) return 'top';
  if (col === LAST && row < LAST) return 'right';
  return 'bottom';
}

/** Centre of a tile as fractions (0..1) of the ring box. */
export function tileCenter(id) {
  const { col, row } = tilePosition(id);
  return {
    x: (trackStart(col) + trackSize(col) / 2) / TRACKS,
    y: (trackStart(row) + trackSize(row) / 2) / TRACKS,
  };
}

// Offsets (fraction of the tile's width/height from its centre) so up to 6 pawns fan out without overlapping.
const FAN = {
  1: [[0, 0]],
  2: [[-0.22, 0.02], [0.22, 0.02]],
  3: [[-0.2, -0.16], [0.2, -0.16], [0, 0.19]],
  4: [[-0.21, -0.19], [0.21, -0.19], [-0.21, 0.2], [0.21, 0.2]],
  5: [[-0.27, -0.2], [0, -0.2], [0.27, -0.2], [-0.14, 0.2], [0.14, 0.2]],
  6: [[-0.27, -0.2], [0, -0.2], [0.27, -0.2], [-0.27, 0.2], [0, 0.2], [0.27, 0.2]],
};
// Pawn size in edge-tile units (--hb-u) by crowd size.
const DIAMETER = { 1: 0.56, 2: 0.44, 3: 0.38, 4: 0.34, 5: 0.29, 6: 0.29 };
// Corners keep their label in the lower part, so the fan sits a little higher; they are larger tiles.
const CORNER_FAN = {
  1: [[0, -0.1]],
  2: [[-0.2, -0.12], [0.2, -0.12]],
  3: [[-0.2, -0.22], [0.2, -0.22], [0, 0]],
  4: [[-0.2, -0.24], [0.2, -0.24], [-0.2, 0.02], [0.2, 0.02]],
  5: [[-0.3, -0.25], [0, -0.25], [0.3, -0.25], [-0.15, 0.02], [0.15, 0.02]],
  6: [[-0.3, -0.25], [0, -0.25], [0.3, -0.25], [-0.3, 0.02], [0, 0.02], [0.3, 0.02]],
};
const CORNER_DIAMETER = { 1: 0.72, 2: 0.56, 3: 0.48, 4: 0.44, 5: 0.36, 6: 0.36 };

// Edge tiles keep their colour band on the inner side, so the pawn rests a little towards the outer edge.
const OUTWARD = 0.1;
const PUSH = { bottom: [0, 1], top: [0, -1], left: [-1, 0], right: [1, 0] };

/**
 * Where a pawn sits: x / y as percentages of the ring box, `d` its size in edge-tile units.
 * `slot` / `count` = its place in the crowd on that tile (up to 6 fan out).
 */
export function pawnPlacement(pos, slot = 0, count = 1) {
  const { col, row } = tilePosition(pos);
  const n = Math.min(6, Math.max(1, count | 0));
  const corner = isCorner(pos);
  const fan = corner ? CORNER_FAN : FAN;
  let [ox, oy] = fan[n][Math.min(Math.max(0, slot | 0), n - 1)];
  if (!corner) {
    const [px, py] = PUSH[sideOf(pos)];
    ox += px * OUTWARD;
    oy += py * OUTWARD;
  }
  return {
    x: ((trackStart(col) + trackSize(col) * (0.5 + ox)) / TRACKS) * 100,
    y: ((trackStart(row) + trackSize(row) * (0.5 + oy)) / TRACKS) * 100,
    d: (corner ? CORNER_DIAMETER : DIAMETER)[n],
  };
}
