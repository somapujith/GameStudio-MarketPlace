// Where the seats sit on the lobby's oval table. Pure (no DOM): the CSS places seat i at
//   centre + (cx * rx, cy * ry)      rx = half the table width - half a seat, ry = half its height - half a seat
// so (cx, cy) = (cos, sin) of the seat's angle on a unit circle. The table stretches that circle into an ellipse.

/** Seat box (px) the layout reserves; the CSS reads them back as --lt-w / --lt-h. */
export const SEAT_W = 104;
export const seatHeight = (n) => (n >= 7 ? 96 : 112); // 7-8 seats drop the piece-name line, so the box is shorter

/** Table width / height: tall enough that neighbours never touch, wide enough to read as a table. */
export function ringAspect(n) {
  if (n <= 2) return 2.6;
  if (n === 3) return 2;
  if (n === 4) return 1.8;
  if (n <= 6) return 1.3;
  return 1.2;
}

const round = (x) => {
  const r = Math.round(x * 1000) / 1000;
  return r === 0 ? 0 : r; // no "-0"
};

/**
 * Seat `i` of `n`, clockwise in join order: -> { i, cx, cy }.
 * Odd counts start at the top; even counts start half a step earlier so the table is mirrored left/right
 * (2 = left and right, 4 = the four corners, 6 = top pair, sides, bottom pair).
 */
export function ringSlots(count) {
  const n = Math.max(2, Math.floor(count) || 0);
  const start = n % 2 === 0 ? -90 - 180 / n : -90;
  return Array.from({ length: n }, (_, i) => {
    const a = ((start + (360 / n) * i) * Math.PI) / 180;
    return { i, cx: round(Math.cos(a)), cy: round(Math.sin(a)) };
  });
}

/** Seat centres in px for a table `width` px wide (what the CSS does), for tests and sanity checks. */
export function ringBoxes(count, width) {
  const n = Math.max(2, Math.floor(count) || 0);
  const h = seatHeight(n);
  const height = width / ringAspect(n);
  const rx = width / 2 - SEAT_W / 2;
  const ry = height / 2 - h / 2;
  return ringSlots(n).map((s) => ({ x: width / 2 + s.cx * rx, y: height / 2 + s.cy * ry, w: SEAT_W, h }));
}
