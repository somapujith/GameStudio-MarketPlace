// OWNER: shops agent. Branded Hyderabad shopfronts (Paradise, Bawarchi, Delhi Mithai Wala, OYO, panipuri stalls, ...) built on the
// blocks layout.js reserved (world.city.pois with a `brand`), and the registry customers hail from. See ARCHITECTURE.md.
// The plans (where each building stands, which way it faces, the hail spot) are pure and live in shop-brands.js.
import { createKit } from './shop-kit.js';
import { planShops, planStalls, STALL_FOOT } from './shop-brands.js';
import { buildStalls } from './shop-stalls.js';
import { nearestRoad } from './layout.js';
import { buildParadise } from './shop-paradise.js';
import { buildBawarchi } from './shop-bawarchi.js';
import { buildDelhi } from './shop-delhi.js';
import { buildOyo } from './shop-oyo.js';
import { SLICE, drain } from '../game/steps.js';

const BUILDERS = { paradise: buildParadise, bawarchi: buildBawarchi, delhi: buildDelhi, oyo: buildOyo };

/** The same build as `buildShops`, as a staged generator: it yields SLICE after every shopfront, so the game can give the browser a break. */
export function* shopSteps(scene, city, colliders, shared, sky) {
  const kit = createKit(scene);
  const shops = [];
  const timings = {};
  for (const plan of planShops(city)) {
    const build = BUILDERS[plan.brand];
    if (!build) continue;
    const t0 = performance.now();
    kit.setScope(plan.brand); // branches of a brand share their drawn textures
    build(kit, plan, kit.root);
    kit.setScope(null);
    timings[plan.id] = Math.round(performance.now() - t0);
    const f = plan.footprint;
    colliders.addCentered(f.cx, f.cz, f.w, f.d, 'building', 16);
    shops.push({ id: plan.id, brand: plan.brand, name: plan.name, te: plan.te, kind: plan.kind, x: plan.x, z: plan.z, front: plan.front, hail: plan.hail });
    yield SLICE;
  }
  // pavement stalls: ~25 carts, instanced into a few merged meshes
  const stalls = planStalls(city, { count: 25, blocked: (x, z, pad) => !!colliders.inside(x, z, pad), avoid: shops.map((s) => s.hail) });
  if (stalls.length) {
    buildStalls(kit, stalls, kit.root);
    for (const st of stalls) {
      const sideways = Math.abs(Math.sin(st.theta)) > 0.5; // customers to the east/west: the road runs north-south
      colliders.addCentered(st.x, st.z, sideways ? STALL_FOOT.deep : STALL_FOOT.along, sideways ? STALL_FOOT.along : STALL_FOOT.deep, 'building', 2.6);
      const r = nearestRoad(city, st.hail.x, st.hail.z);
      shops.push({ id: st.id, brand: 'stall', name: st.name, te: st.te, kind: 'stall', x: st.x, z: st.z, front: r ? { x: r.x, z: r.z, edge: r.edge.id, t: r.t } : { x: st.x, z: st.z }, hail: st.hail });
    }
  }
  yield SLICE;
  kit.loadFonts();
  kit.update(0, 0);
  return {
    shops,
    timings,
    update(night, time) {
      kit.update(night, time);
    },
    dispose() {
      kit.dispose();
    },
  };
}

/** -> { shops: [{ id, brand, name, te, kind, x, z, front:{x,z,edge,t}, hail:{x,z} }], update(night, time), dispose() } */
export function buildShops(scene, city, colliders, shared, sky) {
  return drain(shopSteps(scene, city, colliders, shared, sky));
}
