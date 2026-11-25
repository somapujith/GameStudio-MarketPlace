// The keep-out rules of the city, as data on the collider set. The auto may drive on the road AND on the pavements; what it may not
// do is go through the buildings and apartments (solid footprints, added by buildings.js / landmarks.js / shops / metro pillars as
// 'building' / 'landmark' / 'pillar' / 'prop' colliders) or into the lake.
//  - the lake is a keep-out ellipse just inside Necklace Road;
//  - the map edge is clamped in sim/vehicle.js (env.limit);
//  - pavement slabs are NOT colliders any more (pass { kerbs: true } to bring the old "stay on the road" rule back).
// Placement checks (customers, pillars, forecourts) use colliders.inside(), which ignores 'kerb' boxes by default.
export function addBoundaries(colliders, city, { kerbs = false } = {}) {
  if (kerbs) for (const b of city.blocks) if (b.type !== 'water' && b.type !== 'park') colliders.add(b.x0, b.z0, b.x1, b.z1, 'kerb', 0.2);
  const L = city.lake;
  colliders.addEllipse(L.cx, L.cz, L.ringX - 7.2, L.ringZ - 7.2, 'lake');
}

/** Height of the pavement slab above the road (metres): the auto rides up onto it. Matches the slab mesh in roads.js. */
export const SLAB_HEIGHT = 0.2;

/** A fast "is (x,z) on a block's pavement slab?" lookup (a grid of blocks) for the ground height under the auto. */
export function createSlabIndex(city) {
  const CELL = 96;
  const cells = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  for (const b of city.blocks) {
    if (b.type === 'water' || b.type === 'park') continue; // the same blocks roads.js gives a slab
    for (let i = Math.floor(b.x0 / CELL); i <= Math.floor(b.x1 / CELL); i++) {
      for (let j = Math.floor(b.z0 / CELL); j <= Math.floor(b.z1 / CELL); j++) {
        const k = key(i, j);
        let c = cells.get(k);
        if (!c) cells.set(k, (c = []));
        c.push(b);
      }
    }
  }
  return (x, z) => {
    const c = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!c) return 0;
    for (const b of c) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return SLAB_HEIGHT;
    return 0;
  };
}
