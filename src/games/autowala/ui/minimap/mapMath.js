// OWNER: minimap agent. Pure coordinate maths for the minimap and the big map (unit-tested in mapMath.test.js).
//
// World: metres, north is -z, east is +x, heading 0 faces +z, forward = (sin h, cos h), steering right makes the heading FALL.
// Map (screen) space: CSS pixels, y grows downward. A "view" is the 2x3 affine matrix world -> screen:
//     sx = a*wx + c*wz + e        sy = b*wx + d*wz + f
// The minimap is heading-up (the player's forward points to the top of the screen); the big map is north-up, which is
// simply the same maths with heading = Math.PI.

/** Build (or refill) the world -> screen matrix for a view centred on world point (x, z) shown at screen point (cx, cy). */
export function makeView(out, x, z, heading, scale, cx, cy) {
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  out.a = -scale * c;
  out.c = scale * s;
  out.b = -scale * s;
  out.d = -scale * c;
  out.e = cx - (out.a * x + out.c * z);
  out.f = cy - (out.b * x + out.d * z);
  out.scale = scale;
  out.heading = heading;
  return out;
}

export const newView = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, scale: 1, heading: Math.PI });

/** World point -> screen point (written into `out`). */
export function worldToScreen(view, wx, wz, out = { x: 0, y: 0 }) {
  out.x = view.a * wx + view.c * wz + view.e;
  out.y = view.b * wx + view.d * wz + view.f;
  return out;
}

/** Screen point -> world point (the exact inverse of worldToScreen). */
export function screenToWorld(view, sx, sy, out = { x: 0, z: 0 }) {
  const det = view.a * view.d - view.b * view.c; // = scale^2
  const px = sx - view.e;
  const py = sy - view.f;
  out.x = (view.d * px - view.c * py) / det;
  out.z = (-view.b * px + view.a * py) / det;
  return out;
}

/** Screen-space unit vector of a world direction (dx, dz), e.g. forward (sin h, cos h) or north (0, -1). */
export function screenDir(view, dx, dz, out = { x: 0, y: 0 }) {
  const x = view.a * dx + view.c * dz;
  const y = view.b * dx + view.d * dz;
  const l = Math.hypot(x, y) || 1;
  out.x = x / l;
  out.y = y / l;
  return out;
}

/** Angle (radians, 0 = up, clockwise positive) of a world heading as seen on the screen. */
export function screenAngleOfHeading(view, heading) {
  const x = view.a * Math.sin(heading) + view.c * Math.cos(heading);
  const y = view.b * Math.sin(heading) + view.d * Math.cos(heading);
  return Math.atan2(x, -y);
}

/**
 * Keep a screen point inside a circle (centre cx,cy radius r). Returns out = { x, y, angle, inside }: the clamped point on the rim
 * when it was outside, `angle` = direction from the centre (0 = up, clockwise) so an arrow can point outward.
 */
export function clampToCircle(sx, sy, cx, cy, r, out = { x: 0, y: 0, angle: 0, inside: true }) {
  const dx = sx - cx;
  const dy = sy - cy;
  const d = Math.hypot(dx, dy);
  out.angle = Math.atan2(dx, -dy);
  if (d <= r) {
    out.x = sx;
    out.y = sy;
    out.inside = true;
  } else {
    out.x = cx + (dx / d) * r;
    out.y = cy + (dy / d) * r;
    out.inside = false;
  }
  return out;
}

/** Same for a rectangle (the big map's edge arrows). */
export function clampToRect(sx, sy, x0, y0, x1, y1, out = { x: 0, y: 0, angle: 0, inside: true }) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  out.angle = Math.atan2(sx - cx, -(sy - cy));
  if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
    out.x = sx;
    out.y = sy;
    out.inside = true;
    return out;
  }
  const dx = sx - cx;
  const dy = sy - cy;
  const k = Math.min(dx !== 0 ? (cx - x0) / Math.abs(dx) : Infinity, dy !== 0 ? (cy - y0) / Math.abs(dy) : Infinity);
  out.x = cx + dx * k;
  out.y = cy + dy * k;
  out.inside = false;
  return out;
}

/** Pixels per metre of the minimap: a little wider view the faster you go (speed in m/s). */
export const MINI_SCALE = { slow: 1.0, fast: 0.62, topSpeed: 26 };
export function zoomForSpeed(speed) {
  const k = Math.max(0, Math.min(1, Math.abs(speed || 0) / MINI_SCALE.topSpeed));
  const e = k * k * (3 - 2 * k);
  return MINI_SCALE.slow + (MINI_SCALE.fast - MINI_SCALE.slow) * e;
}

/** Scale limits (px per metre) of the big map for a viewport and a city of half-size `half`. */
export function bigMapScaleRange(w, h, half) {
  const fit = Math.min(w, h) / (half * 2.05);
  return { min: fit * 0.8, max: 3.2, start: Math.max(fit * 1.5, Math.min(w, h) / 900) };
}

/** Zoom a north-up view about a screen point so the world point under the cursor stays put. Mutates and returns `st` = {x, z, scale}. */
export function zoomAbout(st, factor, sx, sy, cx, cy, min, max) {
  const next = Math.max(min, Math.min(max, st.scale * factor));
  // world point under the cursor before: wx = st.x + (sx - cx) / scale ; wz = st.z + (sy - cy) / scale (north-up)
  const wx = st.x + (sx - cx) / st.scale;
  const wz = st.z + (sy - cy) / st.scale;
  st.scale = next;
  st.x = wx - (sx - cx) / next;
  st.z = wz - (sy - cy) / next;
  return st;
}

/** "420 m", "1.2 km". */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 995) return `${Math.max(0, Math.round(m / 10) * 10 || Math.round(m))} m`;
  return `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`;
}

/** "40 s", "3 min". */
export function formatEta(s) {
  if (!Number.isFinite(s)) return '';
  if (s < 60) return `${Math.max(1, Math.round(s / 5) * 5)} s`;
  return `${Math.round(s / 60)} min`;
}

/** Arrow glyph for a nextTurn direction. */
export const TURN_GLYPH = { left: '↰', right: '↱', straight: '↑', uturn: '↶' };
