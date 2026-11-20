import { describe, expect, it } from 'vitest';
import { SEAT_W, ringAspect, ringBoxes, ringSlots, seatHeight } from './seatLayout.js';

describe('ringSlots', () => {
  it('returns n slots on the unit circle, in order', () => {
    for (let n = 2; n <= 8; n++) {
      const s = ringSlots(n);
      expect(s).toHaveLength(n);
      s.forEach((p, i) => {
        expect(p.i).toBe(i);
        expect(Math.hypot(p.cx, p.cy)).toBeCloseTo(1, 2);
      });
    }
  });
  it('2 seats face each other left and right, odd counts start at the top', () => {
    const two = ringSlots(2);
    expect(two[0].cx).toBe(-1);
    expect(two[1].cx).toBe(1);
    expect(ringSlots(3)[0]).toEqual({ i: 0, cx: 0, cy: -1 });
    expect(ringSlots(5)[0].cy).toBe(-1);
  });
  it('even counts are mirrored left/right', () => {
    const six = ringSlots(6);
    expect(six[0].cx).toBeCloseTo(-six[1].cx, 2);
    expect(six[0].cy).toBeCloseTo(six[1].cy, 2);
  });
  it('clamps a tiny count to 2', () => {
    expect(ringSlots(0)).toHaveLength(2);
  });
});

describe('the table never overlaps its seats at 480-760px', () => {
  const tol = 4; // px of corner overlap we accept (the seat boxes have empty corners)
  for (const width of [480, 540, 640, 720, 760]) {
    for (let n = 2; n <= 8; n++) {
      it(`${n} seats, ${width}px wide`, () => {
        const boxes = ringBoxes(n, width);
        const height = width / ringAspect(n);
        boxes.forEach((b) => {
          expect(b.x - b.w / 2).toBeGreaterThanOrEqual(-0.5);
          expect(b.x + b.w / 2).toBeLessThanOrEqual(width + 0.5);
          expect(b.y - b.h / 2).toBeGreaterThanOrEqual(-0.5);
          expect(b.y + b.h / 2).toBeLessThanOrEqual(height + 0.5);
        });
        for (let a = 0; a < boxes.length; a++) {
          for (let b = a + 1; b < boxes.length; b++) {
            const ox = SEAT_W - Math.abs(boxes[a].x - boxes[b].x);
            const oy = seatHeight(n) - Math.abs(boxes[a].y - boxes[b].y);
            expect(Math.min(ox, oy)).toBeLessThanOrEqual(tol);
          }
        }
      });
    }
  }
});
