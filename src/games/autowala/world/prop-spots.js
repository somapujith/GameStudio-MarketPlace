// Where street furniture must NOT stand: on a carriageway. props.js places lamps, palms and shade trees from ONE road edge and the
// park blocks overlap Necklace Road, so trees and posts ended up in the middle of a road (51 of the 3,716 solid props in the seed-1
// city, 16 of them within 2 m of a centre line): a solid in a lane is a wall for the auto and for the quest waypoints placed there.
// Pure (no three.js); unit-tested in prop-spots.test.js.

/** A road lookup over the city's edges (a grid of 64 m cells, so a few thousand props cost a few milliseconds). */
export function createRoadProbe(city, cell = 64) {
  const cells = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const bx = a.x + e.dx * e.len;
    const bz = a.z + e.dz * e.len;
    const pad = e.w / 2 + 2;
    const x0 = Math.floor((Math.min(a.x, bx) - pad) / cell);
    const x1 = Math.floor((Math.max(a.x, bx) + pad) / cell);
    const z0 = Math.floor((Math.min(a.z, bz) - pad) / cell);
    const z1 = Math.floor((Math.max(a.z, bz) + pad) / cell);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = key(i, j);
        let c = cells.get(k);
        if (!c) cells.set(k, (c = []));
        c.push(e);
      }
    }
  }
  return {
    /** Metres from (x, z) to the nearest carriageway edge (negative inside one). Exact up to 2 m from a road; further out it may report a larger value or Infinity. */
    clearance(x, z) {
      const c = cells.get(key(Math.floor(x / cell), Math.floor(z / cell)));
      if (!c) return Infinity;
      let best = Infinity;
      for (const e of c) {
        const a = city.nodes[e.a];
        const t = Math.max(0, Math.min(1, ((x - a.x) * e.dx + (z - a.z) * e.dz) / e.len));
        const d = Math.hypot(x - (a.x + e.dx * e.len * t), z - (a.z + e.dz * e.len * t)) - e.w / 2;
        if (d < best) best = d;
      }
      return best;
    },
  };
}

/**
 * Remove, in place, every spot that stands on a road (closer than `pad` metres to a carriageway). Spots are { x, z }. The lists are
 * filtered AFTER they were generated, so the random sequence of the rest of the build does not change. Returns how many were dropped.
 */
export function dropSpotsOnRoads(probe, list, pad) {
  let kept = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (probe.clearance(s.x, s.z) >= pad) list[kept++] = s;
  }
  const dropped = list.length - kept;
  list.length = kept;
  return dropped;
}
