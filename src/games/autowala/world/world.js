// Builds the whole city from a seed and returns one handle: `world.update(...)` each frame, `world.dispose()` on exit.
//
// The build is a GENERATOR that yields the name of each stage it is about to run: `buildWorld` drains it synchronously (tests,
// scripts), `buildWorldAsync` gives the browser a frame between stages so the page stays responsive and can show real progress.
import { generateCity, nearestRoad } from './layout.js';
import { createColliders } from './colliders.js';
import { addBoundaries, createSlabIndex } from './boundaries.js';
import { buildRoads } from './roads.js';
import { buildTerrain } from './terrain.js';
import { buildBuildings } from './buildings.js';
import { buildProps } from './props.js';
import { buildLandmarks } from './landmarks.js';
import { shopSteps } from './shops.js';
import { buildMetro } from './metro.js';
import { createShared } from '../render/materials.js';
import { createSky } from '../render/sky.js';
import { WORLD } from '../game/config.js';
import { drain, drainAsync, nextFrame, timedSteps } from '../game/steps.js';

/** The stages in order (what the loading bar shows). */
export const WORLD_STAGES = ['layout', 'roads', 'terrain', 'buildings', 'shops', 'props', 'landmarks', 'metro'];

export function* worldSteps(scene, seed) {
  // per-stage build times in ms (read them in the console: __autowala.world.timings) to keep boot time honest
  const timings = {};
  const timed = (name, fn) => {
    const t = performance.now();
    const r = fn();
    timings[name] = Math.round(performance.now() - t);
    return r;
  };
  yield 'layout';
  const city = timed('layout', () => generateCity(seed));
  const colliders = createColliders();
  addBoundaries(colliders, city); // the auto stays on the road: kerbs round every block, a keep-out ellipse over the lake
  const shared = createShared();
  const sky = createSky(scene);

  // every POI gets a "front": the nearest road point, where markers and pickups are drawn
  for (const p of city.pois) {
    const r = nearestRoad(city, p.x, p.z);
    p.front = r ? { x: r.x, z: r.z, edge: r.edge.id, t: r.t } : { x: p.x, z: p.z };
  }

  const H = WORLD.half;
  const heightAt = createSlabIndex(city); // 0 on the road, 0.2 on a pavement slab
  yield 'roads';
  const roads = timed('roads', () => buildRoads(scene, city, shared));
  yield 'terrain';
  const terrain = timed('terrain', () => buildTerrain(scene, city, sky));
  yield 'buildings';
  const buildings = timed('buildings', () => buildBuildings(scene, city, colliders, shared, seed));
  yield 'shops';
  // before props and the metro: they avoid its colliders. Built in slices (one shopfront at a time) so no single piece of work stalls the page.
  const shopTimes = {};
  const shops = yield* timedSteps(shopSteps(scene, city, colliders, shared, sky), shopTimes);
  timings.shops = Math.round(shopTimes.total);
  timings.shopsLongest = Math.round(shopTimes.longest);
  yield 'props';
  const props = timed('props', () => buildProps(scene, city, colliders, shared, seed));
  yield 'landmarks';
  const landmarks = timed('landmarks', () => buildLandmarks(scene, city, colliders, shared));
  yield 'metro';
  const metro = timed('metro', () => buildMetro(scene, city, colliders, shared, sky));

  function update(dt, time, hour, focus, weather = 0) {
    shared.uTime.value = time;
    shared.uWet.value += (weather - shared.uWet.value) * Math.min(1, dt * 0.6);
    const st = sky.update(hour, focus, dt, time, weather);
    shared.uNight.value = st.night;
    terrain.update(time, focus);
    props.update(focus, st.night);
    landmarks.update(st.night);
    shops.update(st.night, time);
    metro.update(dt, time, st.night, focus);
    return st;
  }

  function dispose() {
    roads.dispose();
    shops.dispose();
    metro.dispose();
  }

  return { timings, city, colliders, shared, sky, roads, terrain, buildings, props, landmarks, shops, metro, update, dispose, half: H, heightAt };
}

// the staging helpers live in game/steps.js (they are shared with the game's own setup); re-exported for the existing callers
export { drain, drainAsync, nextFrame };

export const buildWorld = (scene, seed) => drain(worldSteps(scene, seed));
export const buildWorldAsync = (scene, seed, onStep) => drainAsync(worldSteps(scene, seed), onStep);
