// The fixed high 3/4 camera, framed responsively. `frameCamera` is pure: given the aspect it returns the position, target and fov
// so that every gameplay point (all spots, stations, bin, the roof / banner above them) lands inside the HUD-safe window.
import { LAYOUT } from '../../../../shared/tiffin-centre/catalog.js';

const D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** World points that must stay on screen: the six spots, the stations, the bin, the road edge and the banner / roof overhead. */
export const FIT_POINTS = (() => {
  const pts = [];
  for (const x of [-4.9, 4.9]) {
    pts.push([x, 0, 3.3]); // the footpath edge, in front of the customers
    pts.push([x, 1.9, 1.7]); // customers' heads at the outer spots
    pts.push([x, 0, -1.2]);
    pts.push([x, 3.8, -3.9]); // the roof at the back corners
    pts.push([x, 1.9, -2.2]);
  }
  pts.push([-2.5, 5.2, -3.9], [2.5, 5.2, -3.9], [0, 0, 3.3], [0, 1.9, 1.7]); // + the Charminar hoarding above the roof
  return pts;
})();

/** Default HUD-safe insets (fractions of the viewport height) by orientation. */
export const defaultInsets = (aspect) => (aspect < 0.9 ? { top: 0.1, bottom: 0.26 } : { top: 0.09, bottom: 0.12 });

const BASE_ELEV = (() => {
  const [px, py, pz] = LAYOUT.camera.pos;
  const [tx, ty, tz] = LAYOUT.camera.target;
  return Math.atan2(py - ty, Math.hypot(px - tx, pz - tz)) / D2R;
})();

/**
 * @param {{aspect:number, insets?:{top:number,bottom:number}, points?:number[][], margin?:number}} o
 * @returns {{pos:number[], target:number[], fov:number, distance:number, elevation:number, portrait:number}}
 */
export function frameCamera({ aspect, insets, points = FIT_POINTS, margin = 0.03 }) {
  const a = clamp(aspect || 1.6, 0.3, 4);
  const ins = insets || defaultInsets(a);
  const portrait = clamp((1.15 - a) / (1.15 - 0.55), 0, 1);
  const elev = (BASE_ELEV + portrait * 15) * D2R;
  const fov = LAYOUT.camera.fov + portrait * 6;
  const tanV = Math.tan((fov * D2R) / 2);
  const tanH = tanV * a;
  // camera basis: u = target -> camera (in the y-z plane), right = +x, up = perpendicular to u in the y-z plane
  const uy = Math.sin(elev);
  const uz = Math.cos(elev);
  const upy = uz;
  const upz = -uy;
  const winTop = 1 - 2 * ins.top - margin;
  const winBot = -1 + 2 * ins.bottom + margin;
  const lim = 1 - margin;
  const [bx, by, bz] = LAYOUT.camera.target;

  // project every point for camera distance D with the target shifted along `up` by s; fills extents in ndc
  const ext = { xmax: 0, ymin: 0, ymax: 0 };
  const project = (D, s) => {
    const ty = by + upy * s;
    const tz = bz + upz * s;
    ext.xmax = 0;
    ext.ymin = Infinity;
    ext.ymax = -Infinity;
    for (const p of points) {
      const rx = p[0] - bx;
      const ry = p[1] - ty;
      const rz = p[2] - tz;
      const depth = D - (uy * ry + uz * rz);
      if (depth < 0.1) return false;
      ext.xmax = Math.max(ext.xmax, Math.abs(rx / (depth * tanH)));
      const ny = (upy * ry + upz * rz) / (depth * tanV);
      ext.ymin = Math.min(ext.ymin, ny);
      ext.ymax = Math.max(ext.ymax, ny);
    }
    return true;
  };
  // returns the target shift that centres the points in the window when D is large enough, else null
  const fits = (D) => {
    let s = 0;
    const want = (winTop + winBot) / 2;
    for (let k = 0; k < 4; k++) {
      if (!project(D, s)) return null;
      s += (((ext.ymin + ext.ymax) / 2 - want) * D * tanV) * 0.9; // moving the camera up moves the picture down
    }
    if (!project(D, s)) return null;
    return ext.xmax <= lim && ext.ymax <= winTop + 1e-6 && ext.ymin >= winBot - 1e-6 ? s : null;
  };
  let lo = 4;
  let hi = 120;
  let best = { D: hi, s: 0 };
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const s = fits(mid);
    if (s === null) lo = mid;
    else {
      hi = mid;
      best = { D: mid, s };
    }
  }
  const D = best.D;
  const target = [bx, by + upy * best.s, bz + upz * best.s];
  const pos = [target[0], target[1] + uy * D, target[2] + uz * D];
  return { pos, target, fov, distance: D, elevation: elev / D2R, portrait };
}

/** Project a world point with a frameCamera result (tests, HUD placement without WebGL): ndc {x, y, depth}. */
export function projectWith(frame, aspect, p) {
  const e = frame.elevation * D2R;
  const uy = Math.sin(e);
  const uz = Math.cos(e);
  const rx = p[0] - frame.target[0];
  const ry = p[1] - frame.target[1];
  const rz = p[2] - frame.target[2];
  const depth = frame.distance - (uy * ry + uz * rz);
  const tanV = Math.tan((frame.fov * D2R) / 2);
  return { x: rx / (depth * tanV * aspect), y: (uz * ry - uy * rz) / (depth * tanV), depth };
}

/** Sway / shake offsets (pure, deterministic in t) in metres. `shake` is the current decaying amplitude. */
export function swayOffset(t, shake, reducedMotion, out = { x: 0, y: 0, tx: 0 }) {
  if (reducedMotion) {
    out.x = out.y = out.tx = 0;
    return out;
  }
  out.x = Math.sin(t * 0.31) * 0.07 + Math.sin(t * 47) * shake * 0.2;
  out.y = Math.sin(t * 0.43 + 1) * 0.035 + Math.sin(t * 61 + 2) * shake * 0.16;
  out.tx = Math.sin(t * 0.19) * 0.05;
  return out;
}
