// OWNER: quests agent. Stunt ramps: a pure height profile the runtime adds on top of `world.heightAt` while the Stunt Show is active.
// A ramp is { x, z (centre), dx, dz (unit direction of travel), len, w, rise }. The deck climbs linearly, stays flat for LIP metres and
// then falls steeply over DROP metres. The vehicle launches when the ground falls away faster than its body can follow (see
// sim/vehicle.js: a drop of more than 0.35 m under a fast auto with lower ground ahead), so air time comes from the height of the lip.
export const LIP = 2; // flat metres at the top
export const DROP = 2.5; // metres of steep descent after it (the ground "falls away" under the auto, which launches it)

/** Height of one ramp's deck at (x, z); 0 off the ramp. */
export function rampHeight(r, x, z) {
  const px = x - r.x;
  const pz = z - r.z;
  const u = px * r.dx + pz * r.dz + r.len / 2; // 0 at the low end, len at the lip
  if (u < 0 || u > r.len) return 0;
  const v = Math.abs(px * -r.dz + pz * r.dx);
  if (v > r.w / 2) return 0;
  const climb = r.len - LIP - DROP;
  if (u < climb) return (u / climb) * r.rise;
  if (u < climb + LIP) return r.rise;
  return r.rise * (1 - (u - climb - LIP) / DROP);
}

/** The tallest deck over (x, z) among `ramps` (cheap reject first: this runs several times a physics step). */
export function rampsHeight(ramps, x, z) {
  let h = 0;
  for (let i = 0; i < ramps.length; i++) {
    const r = ramps[i];
    const dx = x - r.x;
    const dz = z - r.z;
    if (dx * dx + dz * dz > r.reach2) continue;
    const t = rampHeight(r, x, z);
    if (t > h) h = t;
  }
  return h;
}

/** Add the cheap-reject radius to ramp descriptors (mutates, returns the same array). */
export function prepareRamps(ramps) {
  for (const r of ramps) r.reach2 = (r.len / 2 + r.w / 2 + 1) ** 2;
  return ramps;
}

/** Triangle data for a ramp's wedge in local space (x across, y up, z along the travel direction, centred): positions only. */
export function rampMesh(r) {
  const hw = r.w / 2;
  const z0 = -r.len / 2;
  const zc = r.len / 2 - LIP - DROP; // end of the climb
  const ze = r.len / 2 - DROP; // end of the flat top
  const z1 = r.len / 2; // foot of the steep front
  const h = r.rise;
  const P = {
    a: [-hw, 0, z0], b: [hw, 0, z0],
    c: [-hw, h, zc], d: [hw, h, zc],
    e: [-hw, h, ze], f: [hw, h, ze],
    g: [-hw, 0, z1], i: [hw, 0, z1],
  };
  const tri = (a, b, c) => [...P[a], ...P[b], ...P[c]];
  return new Float32Array([
    ...tri('a', 'c', 'b'), ...tri('b', 'c', 'd'), // the slope
    ...tri('c', 'e', 'd'), ...tri('d', 'e', 'f'), // the flat top
    ...tri('e', 'g', 'f'), ...tri('f', 'g', 'i'), // the steep front
    ...tri('a', 'g', 'c'), ...tri('c', 'g', 'e'), // left flank
    ...tri('b', 'd', 'i'), ...tri('d', 'f', 'i'), // right flank
  ]);
}
