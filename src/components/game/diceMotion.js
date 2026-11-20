// Pure maths and keyframes of the 3D die (Dice.jsx plays them with the Web Animations API).
//
// The cube: faces (opposites sum to 7) 1 front, 6 back, 2 top, 5 bottom, 3 right, 4 left. CSS rotations are
// replayed here in plain JS so the resting orientation (which face looks at the viewer, how each face is lit)
// can be proven in unit tests instead of by eye.
//
// A roll has three beats, all inside the presenter's pauses (shared/timing.js ANIM_MS):
//   1. tumble (ANIM_MS.dice): lift + wobble (anticipation) -> throw -> bounce -> bounce -> skid. The die does not
//      know its result yet (the presenter withholds it), so it spins freely and slows down.
//   2. settle (display.diceSettleMs, inside ANIM_MS.afterDice): tips onto the exact face with a small wobble and a
//      last little hop, the shadow tightening and loosening under it.
//   3. result pop (Dice.jsx): the number floats up in gold, the face glows, a six bursts.
// Heights and offsets are fractions of the die's own size (rendered as % in translate()), so the same keyframes
// work from a 56px phone die to a 180px desktop one.

// ---- orientation ----------------------------------------------------------------------------------------------

/** Rotation that brings face v in front of the viewer (a CSS transform list). */
export const ORIENT = Object.freeze({
  1: 'rotateX(0deg)',
  2: 'rotateX(-90deg)',
  3: 'rotateY(-90deg)',
  4: 'rotateY(90deg)',
  5: 'rotateX(90deg)',
  6: 'rotateY(180deg)',
});

const ORIENT_STEPS = Object.freeze({
  1: [],
  2: [['x', -90]],
  3: [['y', -90]],
  4: [['y', 90]],
  5: [['x', 90]],
  6: [['y', 180]],
});

/** Outward normal of each face in the cube's own frame (x right, y DOWN as in CSS, z towards the viewer). */
export const FACE_NORMALS = Object.freeze({
  1: [0, 0, 1],
  6: [0, 0, -1],
  2: [0, -1, 0],
  5: [0, 1, 0],
  3: [1, 0, 0],
  4: [-1, 0, 0],
});

const rad = (deg) => (deg * Math.PI) / 180;

/** One CSS rotateX / rotateY / rotateZ applied to a vector. */
function rotate([x, y, z], axis, deg) {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  if (axis === 'x') return [x, y * c - z * s, y * s + z * c];
  if (axis === 'y') return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}

/** A random resting pose: the tilt of the camera view plus a slight twist so no two rolls look the same. */
export function newSeed(rand = Math.random) {
  const j = (n) => (rand() * 2 - 1) * n;
  return { tz: j(11), dx: j(5), dy: j(6) };
}

const poseAngles = (seed) => ({ vx: -17 + seed.dx, vy: -21 + seed.dy, tz: seed.tz });

/** Resting pose: face `v` towards the viewer, tipped so the top and right faces show. 0 / unknown shows the 5. */
export function restTransform(v, seed) {
  const face = v >= 1 && v <= 6 ? v : 5;
  const { vx, vy, tz } = poseAngles(seed);
  return `rotateX(${vx.toFixed(1)}deg) rotateY(${vy.toFixed(1)}deg) rotateZ(${tz.toFixed(1)}deg) ${ORIENT[face]}`;
}

/** Where every face points (in the viewer's frame) once the die rests showing `v`. */
export function faceNormals(v, seed) {
  const face = v >= 1 && v <= 6 ? v : 5;
  const { vx, vy, tz } = poseAngles(seed);
  const out = {};
  for (let f = 1; f <= 6; f++) {
    let n = FACE_NORMALS[f];
    for (const [axis, deg] of ORIENT_STEPS[face]) n = rotate(n, axis, deg);
    n = rotate(n, 'z', tz);
    n = rotate(n, 'y', vy);
    n = rotate(n, 'x', vx);
    out[f] = n;
  }
  return out;
}

/** The face that looks at the viewer the most (must equal the rolled value). */
export function frontFace(v, seed) {
  const n = faceNormals(v, seed);
  let best = 1;
  for (let f = 2; f <= 6; f++) if (n[f][2] > n[best][2]) best = f;
  return best;
}

// light from the upper left, a little in front
const LIGHT = (() => {
  const l = [-0.34, -0.66, 0.67];
  const len = Math.hypot(...l);
  return l.map((v) => v / len);
})();

/**
 * Darkness (0..0.34) of the shade laid over each face at rest: faces turned to the light stay bright, faces turned
 * away fall into shadow. Faces that point away from the viewer get a flat dark value (they are not drawn anyway).
 */
export function faceShades(v, seed) {
  const n = faceNormals(v, seed);
  const out = {};
  for (let f = 1; f <= 6; f++) {
    const lit = Math.max(0, n[f][0] * LIGHT[0] + n[f][1] * LIGHT[1] + n[f][2] * LIGHT[2]);
    out[f] = n[f][2] <= 0 ? 0.34 : +(0.34 - 0.34 * lit).toFixed(3);
  }
  return out;
}

// ---- the tumble -------------------------------------------------------------------------------------------------

/**
 * Beats of the throw. `at` = fraction of the tumble, `y` = height above the floor (-1 = one die up; 0 = on the floor),
 * `x` = sideways travel (times the throw direction), `spin` = fraction of the total spin reached, `wob` = a z-wobble.
 * Floor contacts are the interior beats with y = 0: two bounces, then a short skid.
 */
export const TUMBLE_BEATS = Object.freeze([
  { at: 0, y: 0, x: 0, spin: 0, wob: 0 },
  { at: 0.04, y: -0.05, x: 0, spin: 0.005, wob: -7 }, // anticipation: the die crouches, lifts and wobbles
  { at: 0.1, y: -0.13, x: 0, spin: 0.02, wob: 6 },
  { at: 0.27, y: -0.58, x: 0.12, spin: 0.3, wob: 0 }, // the throw peaks
  { at: 0.44, y: 0, x: 0.2, spin: 0.58, wob: 0 }, // bounce 1
  { at: 0.58, y: -0.24, x: 0.14, spin: 0.76, wob: 0 },
  { at: 0.72, y: 0, x: 0.09, spin: 0.89, wob: 0 }, // bounce 2
  { at: 0.82, y: -0.06, x: 0.07, spin: 0.96, wob: 0 },
  { at: 0.92, y: 0, x: 0.055, spin: 1, wob: 0 }, // lands, then skids
  { at: 1, y: 0, x: 0.05, spin: 1, wob: 0 },
]);

/** Fractions of the tumble at which the die touches the floor (for sound / haptics that want to follow the bounces). */
export const BOUNCE_AT = Object.freeze(TUMBLE_BEATS.filter((b, i) => i > 0 && i < TUMBLE_BEATS.length - 1 && b.y === 0).map((b) => b.at));

const HIGHEST = Math.max(...TUMBLE_BEATS.map((b) => -b.y));
const EASE_UP = 'cubic-bezier(.22,.68,.4,1)'; // rising: decelerates (gravity)
const EASE_DOWN = 'cubic-bezier(.55,0,.85,.4)'; // falling: accelerates

const pct = (v) => `${(v * 100).toFixed(2)}%`;
const px = (v) => v.toFixed(3);

function segmentEase(a, b) {
  if (b.y < a.y) return EASE_UP;
  if (b.y > a.y) return EASE_DOWN;
  return 'linear';
}

/** Random spin axes and amounts for one roll (2 to 3 turns about x, 1.5 to 2.5 about y, up to 1.25 about z). */
export function tumblePlan(rand = Math.random) {
  const sign = () => (rand() < 0.5 ? -1 : 1);
  return {
    dir: sign(), // which way the die is thrown / skids
    wob: sign(),
    spin: {
      x: sign() * (720 + rand() * 360),
      y: sign() * (540 + rand() * 360),
      z: sign() * (120 + rand() * 330),
    },
  };
}

/**
 * Keyframes (Web Animations API) of the three layers during the tumble:
 *  - `air`: the toss (height + sideways travel), `shadow`: the contact shadow on the floor, `cube`: the spin.
 * `from` = the cube's transform now (a matrix string or transform list); `startY` = height the die already hangs at
 * (the "primed" lift), so the throw continues from there without a jump.
 */
export function tumbleFrames(plan, { from = 'rotateX(0deg)', startY = 0 } = {}) {
  const beats = TUMBLE_BEATS.map((b, i) => (i === 0 ? { ...b, y: startY } : b));
  const air = [];
  const shadow = [];
  const cube = [];
  beats.forEach((b, i) => {
    const next = beats[i + 1];
    const ease = next ? segmentEase(b, next) : 'linear';
    const x = b.x * plan.dir;
    air.push({ offset: b.at, transform: `translate(${pct(x)}, ${pct(b.y)})`, easing: ease });
    const h = Math.min(1, -b.y / HIGHEST); // 0 = on the floor, 1 = at the top of the throw
    shadow.push({
      offset: b.at,
      transform: `translateX(${pct(x * 0.9)}) scale(${px(1 - 0.42 * h)})`,
      opacity: px(1 - 0.55 * h),
      easing: ease,
    });
    const { x: sx, y: sy, z: sz } = plan.spin;
    cube.push({
      offset: b.at,
      transform: `${from} rotateX(${px(sx * b.spin)}deg) rotateY(${px(sy * b.spin)}deg) rotateZ(${px(sz * b.spin + b.wob * plan.wob)}deg)`,
      easing: 'linear',
    });
  });
  return { air, shadow, cube };
}

/** The die x offset (fraction of its size) where the tumble leaves it; the settle slides it back to the middle. */
export const skidEnd = (plan) => TUMBLE_BEATS[TUMBLE_BEATS.length - 1].x * plan.dir;

/**
 * Keyframes of the landing: the cube tips onto its exact face (`from` -> `to`, with a wobble that dies out) while the
 * die hops twice more, small, and slides back to the middle; the shadow tightens and loosens under it.
 * `wobSign` flips the direction of the wobble.
 */
export function settleFrames({ from, to, skidX = 0, wobSign = 1 }) {
  const hops = [
    { at: 0, y: 0, x: skidX },
    { at: 0.26, y: -0.14, x: skidX * 0.45 },
    { at: 0.48, y: 0, x: 0 },
    { at: 0.68, y: -0.05, x: 0 },
    { at: 0.86, y: 0, x: 0 },
    { at: 1, y: 0, x: 0 },
  ];
  const air = [];
  const shadow = [];
  hops.forEach((b, i) => {
    const next = hops[i + 1];
    const ease = next ? segmentEase(b, next) : 'linear';
    air.push({ offset: b.at, transform: `translate(${pct(b.x)}, ${pct(b.y)})`, easing: ease });
    const h = Math.min(1, -b.y / 0.14);
    shadow.push({ offset: b.at, transform: `translateX(${pct(b.x * 0.9)}) scale(${px(1 - 0.3 * h)})`, opacity: px(1 - 0.45 * h), easing: ease });
  });
  const w = 6 * wobSign;
  const cube = [
    { offset: 0, transform: from, easing: 'cubic-bezier(.3,.7,.35,1)' },
    { offset: 0.5, transform: `rotateZ(${px(w)}deg) ${to}`, easing: 'ease-in-out' },
    { offset: 0.76, transform: `rotateZ(${px(-w * 0.45)}deg) ${to}`, easing: 'ease-in-out' },
    { offset: 1, transform: to, easing: 'linear' },
  ];
  return { air, shadow, cube };
}

/** Anticipation while the roll is on its way to the server: a small lift, then a slow wobble loop (cube, z). */
export const PRIME_LIFT = -0.11;
export const primeFrames = (wobSign = 1) => ({
  air: [
    { offset: 0, transform: 'translate(0%, 0%)', easing: EASE_UP },
    { offset: 1, transform: `translate(0%, ${pct(PRIME_LIFT)})` },
  ],
  shadow: [
    { offset: 0, transform: 'scale(1)', opacity: '1', easing: EASE_UP },
    { offset: 1, transform: 'scale(0.84)', opacity: '0.72' },
  ],
  wobble: (from) => [
    { offset: 0, transform: `${from} rotateZ(${5 * wobSign}deg)`, easing: 'ease-in-out' },
    { offset: 1, transform: `${from} rotateZ(${-5 * wobSign}deg)` },
  ],
});

// ---- the burst on a six -----------------------------------------------------------------------------------------

/**
 * Sparks thrown out of the die on a six: evenly spread angles with a little jitter, as offsets in die-sizes.
 * Pure (takes the random source) so the layout is testable.
 */
export function burstParticles(n = 6, rand = Math.random) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5 * rand()) / n) * Math.PI * 2 - Math.PI / 2;
    const d = 0.85 + rand() * 0.45;
    out.push({
      dx: +(Math.cos(a) * d).toFixed(3),
      dy: +(Math.sin(a) * d * 0.9 - 0.1).toFixed(3),
      size: +(0.1 + rand() * 0.07).toFixed(3),
      delay: Math.round(rand() * 70),
      tone: i % 3, // 0 gold, 1 warm white, 2 teal
    });
  }
  return out;
}
