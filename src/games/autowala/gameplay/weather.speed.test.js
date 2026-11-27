// The weather and the career (damage) both shape state.speedMul. career.js hooks the property so a READ returns weather's value x
// damage's value; weather.js therefore has to keep its own value instead of easing "what it last read". This installs both real
// systems (the rain / sky / event visuals are stubbed: they need WebGL) and checks the auto ends at exactly the damage factor.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../world/rain.js', () => ({
  RAIN_STREAKS: { low: 1, medium: 1, high: 1 },
  createRain: () => ({ setFlash() {}, setCount() {}, update() {}, dispose() {} }),
}));
vi.mock('../world/rain-ground.js', () => ({
  createRainGround: () => ({ shown: 0, sparks: 0, setQuality() {}, update() {}, dispose() {} }),
}));
vi.mock('../world/rain-sky.js', () => ({ installOvercast: () => () => {} }));
vi.mock('./events.js', () => ({
  installEvents: () => ({ sys: { update() {}, dispose() {} }, out: { drag: 0 }, active: [] }),
}));

const { installWeather } = await import('./weather.js');
const { installCareer } = await import('./career.js');
const { damageSpeedMul } = await import('./career-math.js');

function rig(damage) {
  const systems = [];
  const listeners = new Set();
  const ctx = {
    scene: {}, camera: {},
    world: { city: { seed: 1 }, sky: { palette: { hor: {} }, state: { night: 0 } }, shared: { uWet: { value: 0 } } },
    clock: { hour: 12, day: 1, time: 0 },
    v: { speed: 10, jolt: 0, x: 0, z: 0, heading: 0, vx: 0, vz: 0 },
    state: { menu: null, weather: 0, speedMul: 1, gripMul: 1 },
    profile: { data: { settings: {}, career: { damage } }, save() {}, flush() {} },
    game: { on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } },
    gfx: { quality: 'medium' },
    systems,
  };
  ctx.emit = (type, d = {}) => { for (const l of [...listeners]) l({ type, ...d }); };
  let w = 1000;
  ctx.economy = { get wallet() { return w; }, add(n) { w += n; }, spend(n) { if (n > w) return false; w -= n; return true; } };
  ctx.toast = () => {};
  ctx.openMenu = () => {};
  ctx.closeMenu = () => {};
  ctx.addSystem = (s) => { systems.push(s); return s; };
  ctx.addSnapshot = () => {};
  installWeather(ctx); // the same order as Game.js: weather first, then career
  installCareer(ctx);
  const run = (sec, dt = 1 / 60) => {
    for (let t = 0; t < sec; t += dt) {
      ctx.clock.time += dt;
      ctx.clock.hour += dt / 60 / 60; // slow day: stays in the dry noon band
      for (const s of systems) s.update(dt, ctx);
    }
  };
  return { ctx, run };
}

describe('state.speedMul with weather and damage together', () => {
  it.each([0.05, 0.3, 0.7, 1])('settles at the damage factor, not at its power (damage %s)', (damage) => {
    const { ctx, run } = rig(damage);
    ctx.state.weather = 0;
    run(20);
    // dry weather asks for 1.0 (clear sky), so the whole product is the damage factor
    expect(ctx.state.speedMul).toBeCloseTo(damageSpeedMul(damage), 2);
  });

  it('does not depend on the frame rate', () => {
    const a = rig(0.5);
    const b = rig(0.5);
    a.run(20, 1 / 30);
    b.run(20, 1 / 144);
    expect(a.ctx.state.speedMul).toBeCloseTo(b.ctx.state.speedMul, 2);
    expect(a.ctx.state.speedMul).toBeCloseTo(damageSpeedMul(0.5), 2);
  });
});
