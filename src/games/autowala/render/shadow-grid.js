// The sun's shadow box follows the player. If its centre moved smoothly, every static edge in the shadow map would be re-sampled at a
// new sub-texel offset each update and the shadows would crawl and shimmer. Snapping the centre to the shadow map's texel grid (measured
// in the light's own right / up axes) makes a re-render of a static scene produce the SAME texels, and lets the map be re-rendered
// on a schedule instead of every frame.

/**
 * Snap `focus` (the point the box is centred on) to the texel grid of a shadow camera looking along -`dir` (`dir` points TO the sun,
 * as in sky.js). Writes the result into `out` ({x,y,z}) and returns it. `texel` = box width / map size, in metres.
 * Axes follow three's lookAt for the light: z = dir, x = normalize(up(0,1,0) x z), y = z x x.
 */
export function snapToShadowGrid(focus, dir, texel, out = { x: 0, y: 0, z: 0 }) {
  // x = up x dir = (dir.z, 0, -dir.x)
  let rx = dir.z;
  let rz = -dir.x;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-6 || !(texel > 0)) {
    out.x = focus.x;
    out.y = focus.y;
    out.z = focus.z;
    return out;
  }
  rx /= rl;
  rz /= rl;
  // y = dir x x
  const ux = dir.y * rz;
  const uy = dir.z * rx - dir.x * rz;
  const uz = -dir.y * rx;
  const a = focus.x * rx + focus.z * rz;
  const b = focus.x * ux + focus.y * uy + focus.z * uz;
  const da = Math.round(a / texel) * texel - a;
  const db = Math.round(b / texel) * texel - b;
  out.x = focus.x + da * rx + db * ux;
  out.y = focus.y + db * uy;
  out.z = focus.z + da * rz + db * uz;
  return out;
}
