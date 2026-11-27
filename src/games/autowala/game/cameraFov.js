// Aspect-aware lens for the chase camera. three.js takes a VERTICAL field of view, so the same 60-75 degrees that frames a 16:9 desktop
// window (about 92-108 degrees across) turns into a 102-126 degree fisheye on a wide-and-short phone (844x390 is 2.16:1, a 21:9 monitor
// 2.39:1) and into a 30 degree tunnel on a portrait window. This keeps the HORIZONTAL field of view in a comfortable band and lets the
// vertical one follow, so the road and the horizon stay framed from 21:9 down to 4:3 and a portrait desktop window.
//
// Pure maths, no allocation: the camera calls it every frame.

const DEG = Math.PI / 180;

/** Horizontal fov (degrees) the lens may have before it is eased back (a speed boost on a very wide screen should not fisheye). */
export const H_MAX = 96;
/** Horizontal fov (degrees) below which the lens is opened up (4:3 tablets, portrait windows). */
export const H_MIN = 84;
/** How much of the excess / shortfall outside [H_MIN, H_MAX] is kept: 0 = hard clamp, 1 = no correction. Keeps the speed and boost widening alive. */
export const KNEE = 0.4;
/** Absolute vertical bounds (degrees): a portrait window would otherwise ask for a 110 degree lens that only looks at the ground. */
export const V_MIN = 40;
export const V_MAX = 90;

/** Horizontal fov (degrees) of a vertical fov (degrees) at an aspect ratio (width / height). */
export function horizontalFov(vfov, aspect) {
  return 2 * Math.atan(Math.tan(vfov * 0.5 * DEG) * aspect) / DEG;
}

/**
 * The vertical fov (degrees) to hand to the camera for a lens that was designed as `baseVfov` degrees on a 16:9 screen.
 * 16:9 and 3:2 pass through unchanged while the horizontal fov stays inside [H_MIN, H_MAX]; beyond it the correction is
 * (1 - KNEE) of the overshoot, so a faster auto still widens the picture but a 21:9 phone no longer shows 120 degrees.
 */
export function fovForAspect(baseVfov, aspect) {
  if (!(aspect > 0.05) || !(baseVfov > 1)) return baseVfov;
  const h = horizontalFov(baseVfov, aspect);
  let target = h;
  if (h > H_MAX) target = H_MAX + (h - H_MAX) * KNEE;
  else if (h < H_MIN) target = H_MIN - (H_MIN - h) * KNEE;
  const v = (2 * Math.atan(Math.tan(target * 0.5 * DEG) / aspect)) / DEG;
  return v < V_MIN ? V_MIN : v > V_MAX ? V_MAX : v;
}
