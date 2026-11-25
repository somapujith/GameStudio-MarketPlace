// OWNER: metro agent. A tiny geometry builder for the metro: boxes, extrusions and quads with flat normals, vertex colours, a
// "tint" flag (this vertex takes the instance colour: the line colour) and a "glow" flag (this vertex is lit at night).
// Parts are authored in a local frame (x = left of travel, y up, z = forward) which `frame()` places in the world.
import { BufferAttribute, BufferGeometry } from 'three';

const hex = (c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** 0xRRGGBB (sRGB) -> linear float triple, as vertex colours are used unconverted by the shader. */
export const lin = (c) => hex(c).map(srgbToLinear);

export class Mesher {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.tint = [];
    this.glow = [];
    this.uv = [];
    this.idx = [];
    this.f = { ox: 0, oy: 0, oz: 0, c: 1, s: 0 }; // frame: origin + yaw
  }

  /** Place subsequent parts: origin (ox, oy, oz) and yaw (heading, radians: local +z -> (sin yaw, cos yaw)). */
  frame(ox = 0, oy = 0, oz = 0, yaw = 0) {
    this.f = { ox, oy, oz, c: Math.cos(yaw), s: Math.sin(yaw) };
    return this;
  }

  // local -> world (rotation about Y by yaw: x' = x c + z s, z' = -x s + z c)
  _p(x, y, z) {
    const f = this.f;
    return [f.ox + x * f.c + z * f.s, f.oy + y, f.oz - x * f.s + z * f.c];
  }

  _n(x, y, z) {
    const f = this.f;
    return [x * f.c + z * f.s, y, -x * f.s + z * f.c];
  }

  /** A quad from four local points (counter-clockwise seen from the front). */
  quad(p0, p1, p2, p3, color, { tint = 0, glow = 0, uv = null } = {}) {
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p3[0] - p0[0];
    const vy = p3[1] - p0[1];
    const vz = p3[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const base = this.pos.length / 3;
    const n = this._n(nx, ny, nz);
    for (const p of [p0, p1, p2, p3]) {
      const w = this._p(p[0], p[1], p[2]);
      this.pos.push(w[0], w[1], w[2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.col.push(color[0], color[1], color[2]);
      this.tint.push(tint);
      this.glow.push(glow);
    }
    const u = uv || [0, 0, 1, 1];
    this.uv.push(u[0], u[1], u[2], u[1], u[2], u[3], u[0], u[3]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A triangle (counter-clockwise from the front). */
  tri(p0, p1, p2, color, { tint = 0, glow = 0 } = {}) {
    this.quad(p0, p1, p2, p2, color, { tint, glow });
  }

  /**
   * A box centred at (cx, cy, cz) with size (sx, sy, sz), optionally pitched (about local x, positive = +z end up) and yawed
   * (about y, in local space) about its own centre. `colors` = one colour or per face {top, bottom, side, front}. `faces`
   * restricts which faces are made, as a string of letters from "+x -x +y -y +z -z".
   */
  box(cx, cy, cz, sx, sy, sz, color, opts = {}) {
    const { pitch = 0, yaw = 0, faces = 'xXyYzZ', tint = 0, glow = 0, top = null, bottom = null, uvs = null } = opts;
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cyw = Math.cos(yaw);
    const syw = Math.sin(yaw);
    const T = (x, y, z) => {
      // pitch about x (z axis rises for +pitch), then yaw about y, then translate
      const y1 = y * cp + z * sp;
      const z1 = -y * sp + z * cp;
      return [cx + x * cyw + z1 * syw, cy + y1, cz - x * syw + z1 * cyw];
    };
    const c = (x, y, z) => T(x * hx, y * hy, z * hz);
    const o = { tint, glow };
    // +x (left), -x (right), +y, -y, +z (front), -z (back); the corner order gives outward normals
    if (faces.includes('x')) this.quad(c(1, -1, 1), c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), color, { ...o, uv: uvs && uvs.x });
    if (faces.includes('X')) this.quad(c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1), color, { ...o, uv: uvs && uvs.X });
    if (faces.includes('y')) this.quad(c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1), c(-1, 1, -1), top || color, { ...o, uv: uvs && uvs.y });
    if (faces.includes('Y')) this.quad(c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1), bottom || color, { ...o, uv: uvs && uvs.Y });
    if (faces.includes('z')) this.quad(c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1), color, { ...o, uv: uvs && uvs.z });
    if (faces.includes('Z')) this.quad(c(1, -1, -1), c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), color, { ...o, uv: uvs && uvs.Z });
  }

  /**
   * Extrude a closed profile of [x, y] points (counter-clockwise seen from +z) along local z from z0 to z1.
   * `colors[i]` / `tints[i]` colour the side quad from point i to i+1. No end caps (the pieces overlap).
   */
  extrude(profile, z0, z1, colors, tints = null) {
    const n = profile.length;
    for (let i = 0; i < n; i++) {
      const a = profile[i];
      const b = profile[(i + 1) % n];
      this.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], colors[i % colors.length], { tint: tints ? tints[i % tints.length] : 0 });
    }
  }

  /** Smooth-ish cylinder along y from y0 to y1 with `seg` sides; radii r0 (bottom) .. r1 (top). */
  cylinder(cx, cz, y0, y1, r0, r1, seg, color) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      this.quad(
        [cx + c1 * r0, y0, cz + s1 * r0],
        [cx + c0 * r0, y0, cz + s0 * r0],
        [cx + c0 * r1, y1, cz + s0 * r1],
        [cx + c1 * r1, y1, cz + s1 * r1],
        color,
      );
    }
  }

  get triangles() {
    return this.idx.length / 3;
  }

  build({ withUv = false } = {}) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aTint', new BufferAttribute(new Float32Array(this.tint), 1));
    g.setAttribute('aGlow', new BufferAttribute(new Float32Array(this.glow), 1));
    if (withUv) g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    const vc = this.pos.length / 3;
    g.setIndex(new BufferAttribute(vc > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
