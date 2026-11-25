// Tiny helpers shared by the food / cookware modules (pure, node-safe).
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Cheap smooth 3D hash noise in [-1, 1], used to deform meshes in JS. */
export function hashNoise(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const h = (a, b, c) => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const s = (t) => t * t * (3 - 2 * t);
  const sx = s(fx);
  const sy = s(fy);
  const sz = s(fz);
  const l = (a, b, t) => a + (b - a) * t;
  const v = l(
    l(l(h(ix, iy, iz), h(ix + 1, iy, iz), sx), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), sx), sy),
    l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), sx), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), sx), sy),
    sz,
  );
  return v * 2 - 1;
}
