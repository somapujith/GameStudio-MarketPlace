// Static collision: axis-aligned boxes in a spatial hash, keep-out ellipses (the lake), and circle push-out. Cheap enough to run
// for the player, every traffic car and pedestrians each frame.
//
// Tags: 'building' / 'landmark' / 'pillar' / 'prop' (trees, lamp posts) are SOLID: the auto treats them as guardrails (stops and
// slides, reports `crash` with guard: true). Pavements are NOT obstacles: the auto drives on them (see boundaries.js: the 0.2 m step).
// 'kerb' boxes only exist when `addBoundaries(..., { kerbs: true })` brings back the old "stay on the road" rule; `inside()` /
// `blocked()` ignore them unless you ask. 'lake' is the keep-out ellipse over the water.
const CELL = 48;
const key = (i, j) => i * 73856093 ^ j * 19349663;

export function createColliders() {
  const boxes = [];
  const grid = new Map();
  const ellipses = [];

  function add(x0, z0, x1, z1, tag = 'building', height = 10) {
    const box = { x0, z0, x1, z1, tag, height, id: boxes.length };
    boxes.push(box);
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const k = key(i, j);
        let cell = grid.get(k);
        if (!cell) grid.set(k, (cell = []));
        cell.push(box);
      }
    }
    return box;
  }
  const addCentered = (cx, cz, w, d, tag, height) => add(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, tag, height);

  /** A keep-out ellipse (nothing may stand inside it). */
  function addEllipse(cx, cz, rx, rz, tag = 'lake') {
    const e = { cx, cz, rx, rz, tag, id: `e${ellipses.length}` };
    ellipses.push(e);
    return e;
  }

  const seen = new Set();
  /** Boxes whose cells overlap the circle's neighbourhood (every tag). */
  function near(x, z, r, out = []) {
    out.length = 0;
    seen.clear();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const cell = grid.get(key(i, j));
        if (!cell) continue;
        for (const b of cell) {
          if (seen.has(b.id)) continue;
          seen.add(b.id);
          out.push(b);
        }
      }
    }
    return out;
  }

  const tmp = [];
  /**
   * Push a circle out of every box / ellipse it overlaps. Mutates `p` ({x,z}); returns the strongest hit
   * { nx, nz, depth, box } or null (the normal points away from the obstacle; `box.tag` says what it was).
   * `opts.ignore`: a tag or array of tags to skip (the camera ignores 'kerb').
   */
  function resolve(p, r, opts) {
    const skip = opts && opts.ignore ? (Array.isArray(opts.ignore) ? opts.ignore : [opts.ignore]) : null;
    let hit = null;
    for (const b of near(p.x, p.z, r + 1, tmp)) {
      if (skip && skip.includes(b.tag)) continue;
      const cx = Math.max(b.x0, Math.min(p.x, b.x1));
      const cz = Math.max(b.z0, Math.min(p.z, b.z1));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2);
      let nx;
      let nz;
      if (d < 1e-4) {
        // centre inside the box: leave through the nearest face
        const l = p.x - b.x0;
        const rr = b.x1 - p.x;
        const t = p.z - b.z0;
        const bt = b.z1 - p.z;
        const m = Math.min(l, rr, t, bt);
        nx = m === l ? -1 : m === rr ? 1 : 0;
        nz = m === t ? -1 : m === bt ? 1 : 0;
        d = -m;
      } else {
        nx = dx / d;
        nz = dz / d;
      }
      const depth = r - d;
      p.x += nx * depth;
      p.z += nz * depth;
      if (!hit || depth > hit.depth) hit = { nx, nz, depth, box: b };
    }
    for (const e of ellipses) {
      if (skip && skip.includes(e.tag)) continue;
      // keep the circle outside the ellipse grown by r (a good approximation of the true offset curve)
      const ex = e.rx + r;
      const ez = e.rz + r;
      const ux = (p.x - e.cx) / ex;
      const uz = (p.z - e.cz) / ez;
      const q = ux * ux + uz * uz;
      if (q >= 1) continue;
      let gx = ux / ex;
      let gz = uz / ez; // gradient of the ellipse function: the outward normal
      let gl = Math.hypot(gx, gz);
      if (gl < 1e-9) { gx = 1; gz = 0; gl = 1; }
      const nx = gx / gl;
      const nz = gz / gl;
      // march out along the normal until outside (a few steps of a Newton-ish projection)
      const k = 1 / Math.sqrt(q || 1e-6);
      const tx = e.cx + (p.x - e.cx) * k;
      const tz = e.cz + (p.z - e.cz) * k;
      const depth = Math.hypot(tx - p.x, tz - p.z);
      p.x = tx;
      p.z = tz;
      if (!hit || depth > hit.depth) hit = { nx, nz, depth, box: { tag: e.tag, id: e.id } };
    }
    return hit;
  }

  /** True when a ray from (x0,z0) to (x1,z1) is blocked by a solid box (kerbs only count with `kerb: true`). */
  function blocked(x0, z0, x1, z1, opts) {
    const kerb = !!(opts && opts.kerb);
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 3);
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.max(1, steps);
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      for (const b of near(x, z, 0.5, tmp)) {
        if (b.tag === 'kerb' && !kerb) continue;
        if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return true;
      }
    }
    return false;
  }

  /** Is a point inside a solid box? (spawn / placement checks). Kerbs (pavements) do not count unless `kerb` is true. */
  function inside(x, z, pad = 0, kerb = false) {
    for (const b of near(x, z, pad + 1, tmp)) {
      if (b.tag === 'kerb' && !kerb) continue;
      if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) return b;
    }
    return null;
  }

  /** Can the auto be here? True on roads and pavements; false inside a solid (building, landmark, pillar, tree, lamp post) or the lake. */
  function drivable(x, z) {
    if (inside(x, z, 0, true)) return false;
    for (const e of ellipses) if (((x - e.cx) / e.rx) ** 2 + ((z - e.cz) / e.rz) ** 2 < 1) return false;
    return true;
  }

  return { add, addCentered, addEllipse, near, resolve, blocked, inside, drivable, boxes, ellipses };
}
