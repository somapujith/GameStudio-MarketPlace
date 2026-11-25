import { describe, it, expect } from 'vitest';
import {
  makeView, newView, worldToScreen, screenToWorld, screenDir, screenAngleOfHeading, clampToCircle, clampToRect,
  zoomForSpeed, zoomAbout, formatDistance, formatEta, bigMapScaleRange, MINI_SCALE,
} from './mapMath.js';

const NORTH = Math.PI;
const view = (x, z, h, s = 1) => makeView(newView(), x, z, h, s, 100, 100);
const at = (v, x, z) => worldToScreen(v, x, z);

describe('heading-up minimap (up = ahead)', () => {
  it('puts the player at the centre', () => {
    for (const h of [0, 1, 2.5, NORTH, -1.3]) {
      const p = at(view(40, -70, h), 40, -70);
      expect(p.x).toBeCloseTo(100, 9);
      expect(p.y).toBeCloseTo(100, 9);
    }
  });
  it('a point ahead is above the centre, whatever the heading', () => {
    for (const h of [0, 0.7, NORTH, 4.1]) {
      const px = 10;
      const pz = 20;
      const p = at(view(px, pz, h, 2), px + Math.sin(h) * 30, pz + Math.cos(h) * 30);
      expect(p.x).toBeCloseTo(100, 6);
      expect(p.y).toBeCloseTo(100 - 60, 6);
    }
  });
  it('a point on the driver\'s right is on the right of the screen (facing north, east is right)', () => {
    const north = at(view(0, 0, NORTH), 25, 0); // east of a north-facing player
    expect(north.x).toBeCloseTo(125, 6);
    expect(north.y).toBeCloseTo(100, 6);
    const south = at(view(0, 0, 0), 25, 0); // facing +z (south): east is on the LEFT
    expect(south.x).toBeCloseTo(75, 6);
  });
  it('steering right (heading falls) turns the map the other way: north-facing then 90 degrees right faces east', () => {
    const east = view(0, 0, NORTH / 2); // heading pi/2 faces +x (east)
    const p = at(east, 30, 0);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(70, 6); // east is now ahead
    const n = at(east, 0, -30); // north is now on the LEFT of an east-facing driver
    expect(n.x).toBeCloseTo(70, 6);
  });
  it('north-up (heading = PI) draws east to the right and south down', () => {
    const v = view(0, 0, NORTH);
    expect(at(v, 10, 0).x).toBeGreaterThan(100);
    expect(at(v, 0, 10).y).toBeGreaterThan(100);
    expect(at(v, 0, -10).y).toBeLessThan(100);
  });
  it('scale is pixels per metre', () => {
    const p = at(view(0, 0, NORTH, 0.5), 100, 0);
    expect(p.x).toBeCloseTo(150, 6);
  });
});

describe('world <-> screen round trip', () => {
  it('inverts exactly', () => {
    for (const h of [0, 1.1, NORTH, 5]) {
      const v = view(123, -456, h, 0.8);
      const s = at(v, 200, -300);
      const w = screenToWorld(v, s.x, s.y);
      expect(w.x).toBeCloseTo(200, 6);
      expect(w.z).toBeCloseTo(-300, 6);
    }
  });
  it('is a proper rotation (no mirroring): lengths scale uniformly', () => {
    const v = view(0, 0, 2.2, 0.7);
    const a = at(v, 0, 0);
    const b = at(v, 30, 40);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(50 * 0.7, 6);
  });
});

describe('directions on the screen', () => {
  it('forward is up on the minimap', () => {
    const v = view(0, 0, 1.3);
    const d = screenDir(v, Math.sin(1.3), Math.cos(1.3));
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.y).toBeCloseTo(-1, 9);
    expect(screenAngleOfHeading(v, 1.3)).toBeCloseTo(0, 9);
  });
  it('north sits where the compass N goes: up when facing north, to the left when facing east', () => {
    const facingNorth = screenDir(view(0, 0, NORTH), 0, -1);
    expect(facingNorth.y).toBeCloseTo(-1, 9);
    const facingEast = screenDir(view(0, 0, NORTH / 2), 0, -1);
    expect(facingEast.x).toBeCloseTo(-1, 9);
    expect(facingEast.y).toBeCloseTo(0, 9);
  });
  it('on the north-up big map a heading shows as its compass bearing', () => {
    const v = view(0, 0, NORTH);
    expect(screenAngleOfHeading(v, NORTH)).toBeCloseTo(0, 9); // facing north: arrow up
    expect(screenAngleOfHeading(v, NORTH / 2)).toBeCloseTo(Math.PI / 2, 9); // facing east: arrow right
    expect(Math.abs(screenAngleOfHeading(v, 0))).toBeCloseTo(Math.PI, 9); // facing south: arrow down
  });
});

describe('clamping to the rim', () => {
  it('leaves inside points alone', () => {
    const o = clampToCircle(110, 90, 100, 100, 50);
    expect(o.inside).toBe(true);
    expect(o.x).toBe(110);
  });
  it('pulls outside points onto the circle, keeping the direction', () => {
    const o = clampToCircle(300, 100, 100, 100, 50);
    expect(o.inside).toBe(false);
    expect(o.x).toBeCloseTo(150, 9);
    expect(o.y).toBeCloseTo(100, 9);
    expect(o.angle).toBeCloseTo(Math.PI / 2, 9); // pointing right
    const up = clampToCircle(100, -500, 100, 100, 50);
    expect(up.angle).toBeCloseTo(0, 9);
    expect(up.y).toBeCloseTo(50, 9);
  });
  it('rectangle clamp keeps points on the border along the line to the centre', () => {
    const o = clampToRect(1000, 300, 0, 0, 400, 200);
    expect(o.inside).toBe(false);
    expect(o.x).toBeCloseTo(400, 6);
    expect(o.y).toBeGreaterThan(100);
    expect(o.y).toBeLessThanOrEqual(200);
    expect(clampToRect(50, 50, 0, 0, 400, 200).inside).toBe(true);
  });
});

describe('zoom', () => {
  it('zooms out a little with speed, smoothly and within limits', () => {
    expect(zoomForSpeed(0)).toBe(MINI_SCALE.slow);
    expect(zoomForSpeed(MINI_SCALE.topSpeed)).toBeCloseTo(MINI_SCALE.fast, 9);
    expect(zoomForSpeed(100)).toBeCloseTo(MINI_SCALE.fast, 9);
    expect(zoomForSpeed(-13)).toBe(zoomForSpeed(13));
    let prev = Infinity;
    for (let s = 0; s <= 26; s += 2) {
      const z = zoomForSpeed(s);
      expect(z).toBeLessThanOrEqual(prev);
      prev = z;
    }
  });
  it('zoomAbout keeps the point under the cursor fixed and respects the limits', () => {
    const st = { x: 100, z: -50, scale: 1 };
    const before = { x: st.x + (300 - 400) / st.scale, z: st.z + (500 - 300) / st.scale };
    zoomAbout(st, 2, 300, 500, 400, 300, 0.1, 5);
    expect(st.scale).toBe(2);
    expect(st.x + (300 - 400) / st.scale).toBeCloseTo(before.x, 9);
    expect(st.z + (500 - 300) / st.scale).toBeCloseTo(before.z, 9);
    zoomAbout(st, 100, 300, 500, 400, 300, 0.1, 5);
    expect(st.scale).toBe(5);
    zoomAbout(st, 1e-6, 300, 500, 400, 300, 0.1, 5);
    expect(st.scale).toBe(0.1);
  });
  it('the big map can always show the whole city', () => {
    const r = bigMapScaleRange(1280, 720, 700);
    expect(r.min * 1400).toBeLessThan(720);
    expect(r.start).toBeGreaterThan(r.min);
    expect(r.max).toBeGreaterThan(r.start);
  });
});

describe('labels', () => {
  it('formats distances and times', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(423)).toBe('420 m');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(12500)).toBe('13 km');
    expect(formatDistance(NaN)).toBe('');
    expect(formatEta(12)).toBe('10 s');
    expect(formatEta(95)).toBe('2 min');
    expect(formatEta(undefined)).toBe('');
  });
});
