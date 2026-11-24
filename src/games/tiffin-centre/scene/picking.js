// Finger-friendly picking. Instead of raycasting thin geometry we keep a list of invisible "proxies" (a point or a short vertical
// segment with a world radius) and pick the one whose projected disc contains the pointer, where the disc is never smaller than
// MIN_PX across (44 px: a fingertip). Nearest-to-centre wins, with a bias so a slot beats its station and a customer beats the floor.
// The maths takes a `projector` so it is unit-testable without WebGL.
import { Vector3, Raycaster, Box3 } from 'three';

export const MIN_PX = 44; // minimum hit-disc diameter in CSS px
export const PRIORITY = { slot: 0.8, customer: 0.9, bin: 1.0, station: 1.3 };

/** Metres -> CSS px at a view depth, for a vertical fov (deg) and viewport height. */
export const pxPerMetre = (depth, fovDeg, viewH) => (viewH / 2) / (Math.tan((fovDeg * Math.PI) / 360) * Math.max(0.01, depth));

/** World radius needed for a hit disc of `minPx` diameter at `depth`. */
export const worldRadiusForPx = (minPx, depth, fovDeg, viewH) => minPx / 2 / pxPerMetre(depth, fovDeg, viewH);

const _a = { x: 0, y: 0, depth: 0 };
const _b = { x: 0, y: 0, depth: 0 };

/** Distance from point (px,py) to segment a-b (b may equal a). */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * proxies: [{ target, kind, a:{x,y,z}, b?:{x,y,z}, radius }]  (world metres)
 * projector: { project(p, out) -> out{x,y,depth} (CSS px; depth<=0 = behind the camera), pxPerM(depth) }
 * Returns the best proxy's `target` or null.
 */
export function pickFromProxies(proxies, px, py, projector, minPx = MIN_PX) {
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < proxies.length; i++) {
    const p = proxies[i];
    projector.project(p.a, _a);
    if (_a.depth <= 0) continue;
    let d;
    let depth = _a.depth;
    if (p.b) {
      projector.project(p.b, _b);
      if (_b.depth <= 0) continue;
      d = distToSegment(px, py, _a.x, _a.y, _b.x, _b.y);
      depth = Math.min(depth, _b.depth);
    } else {
      d = Math.hypot(px - _a.x, py - _a.y);
    }
    const r = Math.max(minPx / 2, p.radius * projector.pxPerM(depth));
    if (d > r) continue;
    const score = (d / r) * (PRIORITY[p.kind] ?? 1);
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best ? best.target : null;
}

/** A projector over a three PerspectiveCamera + the canvas size (CSS px). Allocation-free after construction. */
export function cameraProjector(camera, getSize) {
  const v = new Vector3();
  return {
    project(p, out) {
      v.set(p.x, p.y, p.z).applyMatrix4(camera.matrixWorldInverse);
      const depth = -v.z;
      out.depth = depth;
      out.vx = v.x; // camera space (the edge hint of an off-screen target uses its direction)
      out.vy = v.y;
      if (depth <= 0) {
        out.x = out.y = 0;
        return out;
      }
      v.applyMatrix4(camera.projectionMatrix); // view -> NDC (applyMatrix4 divides by w)
      const { w, h } = getSize();
      out.x = (v.x * 0.5 + 0.5) * w;
      out.y = (-v.y * 0.5 + 0.5) * h;
      return out;
    },
    pxPerM(depth) {
      const { h } = getSize();
      return (h / 2) * camera.projectionMatrix.elements[5] / Math.max(0.01, depth);
    },
  };
}

/** Is a projected point inside the canvas (with a small slack)? */
export const onScreen = (x, y, w, h, slack = 8) => x >= -slack && y >= -slack && x <= w + slack && y <= h + slack;

// --- cheap raycast fallback for the big things (a station's whole counter block, a customer's body, the bin) ------------------------------
const _ray = new Raycaster();
const _hit = new Vector3();

/** boxes: [{ target, box: Box3 }] in world space. The camera ray through NDC (ndcX, ndcY); returns the nearest box's target or null. */
export function pickBoxes(boxes, camera, ndcX, ndcY) {
  _ray.setFromCamera({ x: ndcX, y: ndcY }, camera);
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const hit = _ray.ray.intersectBox(boxes[i].box, _hit);
    if (!hit) continue;
    const d = hit.distanceToSquared(_ray.ray.origin);
    if (d < bestD) {
      bestD = d;
      best = boxes[i].target;
    }
  }
  return best;
}

/** A world box from a centre and half extents. */
export const boxAt = (cx, cy, cz, hx, hy, hz) => new Box3().set(new Vector3(cx - hx, cy - hy, cz - hz), new Vector3(cx + hx, cy + hy, cz + hz));
