// A headless stand-in for the game context, so the traffic and road-rage systems can be driven in unit tests and scripts without
// WebGL: a real city graph, the real player physics (sim/vehicle.js), a real economy, and the same fixed-step loop as Game.js.
import { PerspectiveCamera, Scene } from 'three';
import { generateCity } from '../world/layout.js';
import { createColliders } from '../world/colliders.js';
import { createVehicle } from './vehicle.js';
import { createEconomy } from '../gameplay/economy.js';
import { installTraffic } from './traffic.js';
import { installRoadRage } from '../gameplay/roadRage.js';

// the city is deterministic and read-only: build it once per seed for the whole test file
const cities = new Map();
const cityFor = (seed) => {
  if (!cities.has(seed)) cities.set(seed, generateCity(seed));
  return cities.get(seed);
};

export function makeFakeCtx({ seed = 1, wallet = 500, start = null, quality = 'medium', traffic = true, rage = true } = {}) {
  const city = cityFor(seed);
  const colliders = createColliders();
  const inner = (e) => [e.a, e.b].every((id) => Math.abs(city.nodes[id].x) < 520 && Math.abs(city.nodes[id].z) < 520);
  const e0 = city.edges.filter((e) => e.w >= 15 && inner(e)).sort((p, q) => q.len - p.len)[0] || city.edges[0];
  const a = city.nodes[e0.a];
  const s = start || { x: a.x + e0.dx * 30 + e0.dz * 2, z: a.z + e0.dz * 30 - e0.dx * 2, heading: Math.atan2(e0.dx, e0.dz) };
  const vehicle = createVehicle(s);
  const profile = { data: { wallet, totalEarned: 0, bestFare: 0, settings: {} }, save() {}, flush() {} };
  const listeners = new Set();
  const events = [];
  const toasts = [];
  const systems = [];
  const snaps = [];
  const camera = new PerspectiveCamera(62, 1.6, 0.3, 1800);
  camera.position.set(s.x - Math.sin(s.heading) * 8, 4, s.z - Math.cos(s.heading) * 8);
  camera.lookAt(s.x, 1, s.z);
  camera.updateMatrixWorld(true);
  const ctx = {
    scene: new Scene(),
    camera,
    gfx: { cfg: { traffic: quality === 'low' ? 22 : quality === 'high' ? 52 : 36, peds: quality === 'low' ? 90 : 170 } },
    world: { city, colliders, sky: { state: { night: 0 } }, heightAt: () => 0 },
    vehicle,
    v: vehicle.state,
    clock: { hour: 12, time: 0, day: 1 },
    state: { paused: false, menu: null, upgrades: {}, speedMul: 1, gripMul: 1 },
    profile,
    rig: { kicks: [], kick(a) { this.kicks.push(a); } },
    events,
    systems,
    game: { on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } },
    toast: (text, o = {}) => { toasts.push({ text, ...o }); },
    addSystem: (sys) => { systems.push(sys); return sys; },
    addSnapshot: (fn) => snaps.push(fn),
    fares: { penalties: [], penalize(p) { this.penalties.push(p); } },
  };
  ctx.emit = (type, data = {}) => {
    const e = { type, ...data };
    events.push(e);
    for (const l of listeners) l(e);
  };
  ctx.economy = createEconomy(ctx);
  if (traffic) installTraffic(ctx);
  if (rage) installRoadRage(ctx);
  const env = { colliders, heightAt: () => 0, gripMul: 1, speedMul: 1, upgrades: {}, boostFuel: 0 };
  const idle = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
  const camFollow = () => {
    const v = vehicle.state;
    camera.position.set(v.x - Math.sin(v.heading) * 8, 4, v.z - Math.cos(v.heading) * 8);
    camera.lookAt(v.x + Math.sin(v.heading) * 6, 1, v.z + Math.cos(v.heading) * 6);
    camera.updateMatrixWorld(true);
  };
  /** Advance `seconds` of game time at 60 Hz with the given player input ({ steer, throttle, brake, boost } or a function of t). */
  const run = (seconds, input = idle) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      ctx.clock.time += 1 / 60;
      const drive = typeof input === 'function' ? { ...idle, ...input(ctx.clock.time) } : { ...idle, ...input };
      for (const ev of vehicle.update(1 / 60, ctx.state.menu ? { ...idle, brake: 1 } : drive, env)) ctx.emit(ev.type, ev);
      for (const sys of systems) sys.update?.(1 / 60, ctx);
      camFollow();
    }
  };
  return { ctx, city, run, events, toasts, listeners, dispose: () => systems.forEach((s2) => s2.dispose?.(ctx)) };
}
