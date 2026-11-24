// First-person interaction, pure: how pointer gestures and keys become "act on the thing I touched" or "turn my head".
//
//   TAP   (a press that barely moves, released quickly)          -> act on whatever scene.pick finds at the pressed point
//   DRAG  (moves past SLOP px, from anywhere)                    -> look around: scene.lookBy(dYaw, dPitch), then a little inertia
//   EDGE  (a drag that starts within EDGE_PX of the left or right screen edge) -> the same look, EDGE_BOOST times faster (a flick turns the head a long way)
//
// Convention handed to the scene (documented in the HUD report): dYaw > 0 turns the head to the cook's RIGHT, dPitch > 0 looks UP,
// and dragging the finger / mouse right turns right (first-person game feel). `LOOK_SIGN` flips either axis in one place.
export const LOOK = {
  sens: 0.004, // radians per pixel of drag
  slop: 8, // px a press may wander and still be a tap (mouse); touch uses TOUCH_SLOP
  touchSlop: 12,
  tapMs: 500, // longer presses are not taps (they were holds that did not move: ignored)
  edgePx: 24,
  edgeBoost: 1.8,
  friction: 5.5, // inertia: velocity *= exp(-friction * dt)
  minSpeed: 0.06, // rad/s below which inertia stops
  maxSpeed: 6, // rad/s cap on a flick
  keyStep: 0.09, // radians per key press / key repeat
  pitchRatio: 0.7, // vertical look is a little slower than horizontal
  doubleMs: 380, // two taps on the same chit within this many ms = "look at them"
  centreEps: 0.12, // radians: the head counts as centred below this
};
export const LOOK_SIGN = { yaw: 1, pitch: 1 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The look delta of a drag of (dx, dy) pixels. */
export function dragToLook(dx, dy, { boost = 1 } = {}) {
  return { dYaw: LOOK_SIGN.yaw * dx * LOOK.sens * boost, dPitch: LOOK_SIGN.pitch * -dy * LOOK.sens * LOOK.pitchRatio * boost };
}

/**
 * A press-to-release classifier. Feed it down / move / up; it answers:
 *   move() -> null | { look: { dYaw, dPitch } }  (once the press became a drag; every later move too)
 *   up()   -> { type: 'tap', x, y } | { type: 'drag', vYaw, vPitch } (inertia start, rad/s) | null
 * `viewportWidth` decides the edge zones; `pointerType` picks the slop; `button` > 0 (right / middle mouse) is look-only.
 */
export function createGesture() {
  let g = null;
  const api = {
    get active() { return !!g; },
    get dragging() { return !!g && g.drag; },
    down({ x, y, t, pointerType = 'mouse', button = 0, viewportWidth = 0 }) {
      const edge = viewportWidth > 0 && (x <= LOOK.edgePx || x >= viewportWidth - LOOK.edgePx);
      g = {
        x0: x, y0: y, x, y, t0: t, t,
        slop: pointerType === 'touch' || pointerType === 'pen' ? LOOK.touchSlop : LOOK.slop,
        drag: button > 0, // a right / middle button press only ever looks
        edge, button, vx: 0, vy: 0,
      };
      return null;
    },
    move({ x, y, t }) {
      if (!g) return null;
      const dx = x - g.x;
      const dy = y - g.y;
      const dt = Math.max(1, t - g.t) / 1000;
      if (!g.drag && Math.hypot(x - g.x0, y - g.y0) > g.slop) {
        g.drag = true;
        // the slop distance itself is not thrown away: the view starts moving from the press point
        g.x = g.x0;
        g.y = g.y0;
        return api.move({ x, y, t });
      }
      if (!g.drag) return null;
      const look = dragToLook(dx, dy, { boost: g.edge ? LOOK.edgeBoost : 1 });
      // low-pass velocity (rad/s) for the release
      const k = 0.5;
      g.vx = g.vx * (1 - k) + (look.dYaw / dt) * k;
      g.vy = g.vy * (1 - k) + (look.dPitch / dt) * k;
      g.x = x;
      g.y = y;
      g.t = t;
      return { look };
    },
    up({ t }) {
      if (!g) return null;
      const s = g;
      g = null;
      if (!s.drag) return t - s.t0 <= LOOK.tapMs ? { type: 'tap', x: s.x0, y: s.y0 } : null;
      // a pause before release kills the flick
      if (t - s.t > 90) return { type: 'drag', vYaw: 0, vPitch: 0 };
      return { type: 'drag', vYaw: clamp(s.vx, -LOOK.maxSpeed, LOOK.maxSpeed), vPitch: clamp(s.vy, -LOOK.maxSpeed, LOOK.maxSpeed) };
    },
    cancel() { g = null; },
  };
  return api;
}

/** One inertia step: returns the look delta for this frame and the decayed velocity (zero once it is too slow). */
export function stepInertia(v, dt) {
  const f = Math.exp(-LOOK.friction * Math.max(0, dt));
  const next = { vYaw: v.vYaw * f, vPitch: v.vPitch * f };
  const slow = Math.hypot(next.vYaw, next.vPitch) < LOOK.minSpeed;
  return { dYaw: v.vYaw * dt, dPitch: v.vPitch * dt, v: slow ? { vYaw: 0, vPitch: 0 } : next, done: slow };
}

// ---- keyboard ---------------------------------------------------------------------------------------------------------------------------
/** Is a keydown aimed at one of the look keys? -> { dYaw, dPitch } | 'recentre' | null. See KEY_HELP for the printed scheme. */
export function lookKeyIntent(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const step = LOOK.keyStep;
  if (k === 'v' || k === 'Home') return 'recentre';
  if (k === 'z') return { dYaw: -step * LOOK_SIGN.yaw, dPitch: 0 };
  if (k === 'x') return { dYaw: step * LOOK_SIGN.yaw, dPitch: 0 };
  if (e.shiftKey) {
    if (k === 'ArrowLeft') return { dYaw: -step * LOOK_SIGN.yaw, dPitch: 0 };
    if (k === 'ArrowRight') return { dYaw: step * LOOK_SIGN.yaw, dPitch: 0 };
    if (k === 'ArrowUp') return { dYaw: 0, dPitch: step * LOOK.pitchRatio * LOOK_SIGN.pitch };
    if (k === 'ArrowDown') return { dYaw: 0, dPitch: -step * LOOK.pitchRatio * LOOK_SIGN.pitch };
  }
  return null;
}

/** The printed control scheme: the in-game help, the pause menu and the tutorial copy all read this one list. */
export const KEY_HELP = {
  keyboard: [
    { keys: ['A', 'D', '←', '→'], what: 'Walk along the counter' },
    { keys: ['Space', 'E'], what: 'Work with what is in front of you (cook, take, serve, collect)' },
    { keys: ['Z', 'X', 'Shift + arrows'], what: 'Turn your head left, right (and up, down)' },
    { keys: ['V'], what: 'Look straight ahead again' },
    { keys: ['C'], what: 'Collect from the customer about to leave' },
    { keys: ['1-9'], what: 'Choose a dish in the cook menu' },
    { keys: ['?'], what: 'Show or hide this help' },
    { keys: ['Esc'], what: 'Pause' },
  ],
  touch: [
    { keys: ['Tap'], what: 'Tap a station, a dish, a token or a customer to work there' },
    { keys: ['Drag'], what: 'Drag on empty space to look around' },
    { keys: ['Arrow chips'], what: 'Customers off screen: tap their arrow to turn towards them' },
    { keys: ['Double-tap'], what: 'Double-tap a token chit to look at that customer' },
    { keys: ['Look straight'], what: 'The target button puts your head back to centre' },
  ],
};

export const isTurned = (look) => !!look && (Math.abs(look.yaw || 0) > LOOK.centreEps || Math.abs(look.pitch || 0) > LOOK.centreEps);
