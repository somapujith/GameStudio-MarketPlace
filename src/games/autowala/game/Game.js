// The game object: owns the renderer, the world, the player's auto and every system, runs the loop, and publishes a small
// snapshot for the React HUD ~10 times a second. Systems are plain modules with `install(ctx)`; see ../ARCHITECTURE.md for the
// ctx contract, the event bus and the snapshot shape.
import { createRenderer, pickQuality } from '../render/renderer.js';
import { worldSteps, drain, drainAsync } from '../world/world.js';
import { buildAuto } from '../sim/autoModel.js';
import { createVehicle } from '../sim/vehicle.js';
import { createInput } from './input.js';
import { createChaseCamera } from './camera.js';
import { DAY, QUALITY } from './config.js';
import { clamp } from './rng.js';
import { advanceClock } from './clock.js';
import { createProfile } from '../gameplay/profile.js';
import { createEconomy } from '../gameplay/economy.js';
import { BODY_COLORS } from '../gameplay/catalog.js';
import { primeAudio, getAudio } from '../audio/ctx.js';
import { disposeTree } from '../render/dispose.js';
import { installCustomization } from '../sim/customize.js';
import { installFares } from '../gameplay/fares.js';
import { installRouteGuide } from '../gameplay/routeGuide.js';
import { installWorkshop } from '../gameplay/workshop.js';
import { installVoices } from '../audio/voices.js';
import { installTraffic } from '../sim/traffic.js';
import { installRoadRage } from '../gameplay/roadRage.js';
import { installCareer } from '../gameplay/career.js';
import { installQuests } from '../gameplay/quests.js';
import { installRules } from '../gameplay/rules.js';
import { installSound } from '../audio/sound.js';
import { installWeather } from '../gameplay/weather.js';

/** The whole game setup as a staged generator: yields the name of each stage it is about to run. */
export function* gameSteps({ canvas, seed = 1, quality, hooks = {} }) {
  yield 'start';
  const profile = createProfile(hooks.userId);
  let applyQuality = () => {};
  const gfx = createRenderer(canvas, {
    quality: pickQuality(quality ?? profile.data.settings.quality),
    explicit: !!(quality ?? profile.data.settings.quality), // a quality the player chose beats the software-renderer guess
    onContext: (s) => {
      state.contextLost = s === 'lost';
      hooks.onContext?.(s);
    },
    onQuality: (q) => {
      applyQuality(q);
      hooks.onQuality?.(q);
    },
  });
  const { scene, camera } = gfx;
  const world = yield* worldSteps(scene, seed);
  // quality drives: shadows (size or off), real lamp lights, how far the camera sees. (The renderer handles pixel ratio, MSAA, bloom.)
  applyQuality = (q) => {
    const cfg = QUALITY[q];
    world.sky.setShadows(cfg.shadow, q !== 'low');
    world.props.setLightCount(q === 'low' ? 2 : q === 'medium' ? 5 : 8);
    camera.far = cfg.drawDist * 1.4;
    camera.updateProjectionMatrix();
  };
  applyQuality(gfx.quality);
  const input = createInput();
  const rig = createChaseCamera(camera, world.colliders);
  const stopAudioPrime = primeAudio();

  // the player's auto, parked in front of Mama's Garage and facing along the road
  const auto = buildAuto({ color: BODY_COLORS.find((c) => c.id === profile.data.loadout.paint.body)?.hex ?? '#ffc400', player: true });
  scene.add(auto);
  const garage = world.city.poiById.garage;
  const spawn = garage?.front || { x: 0, z: 0 };
  const edge = garage ? world.city.edges[garage.front.edge] : null;
  const vehicle = createVehicle({ x: spawn.x, z: spawn.z, heading: edge ? Math.atan2(edge.dx, edge.dz) : 0 });
  const v = vehicle.state;

  const clock = { hour: DAY.startHour, time: 0, sim: 0, day: 1 };
  const state = {
    paused: false, gameOver: false, weather: 0, speedMul: 1, gripMul: 1,
    upgrades: profile.data.upgrades, // the SAME object: buying an upgrade changes the physics at once
    debugCam: null, cameraMode: 0,
    menu: 'start', // the game begins on the start screen (the auto is held from frame 1). 'workshop' | 'pause' | 'start' | 'summary' | null: while set, the auto is held still and driving keys are ignored
    cameraOverride: null, // (camera, dt) => void: a system that owns the camera right now (the workshop's orbit)
  };
  v.fuel = vehicle.params({ upgrades: state.upgrades }).tank; // a full tank, whatever size the tank upgrade made it
  const systems = [];
  const listeners = new Set();
  const snapshotParts = [];
  const ctx = { gfx, scene, camera, world, input, vehicle, v, auto, clock, state, rig, systems, hooks, profile, events: [], game: null };

  const emit = (type, data = {}) => {
    const e = { type, ...data };
    ctx.events.push(e);
    if (ctx.events.length > 64) ctx.events.shift();
    for (const l of listeners) l(e);
  };
  ctx.emit = emit;
  ctx.economy = createEconomy(ctx);
  /** Register a function whose returned object is merged into every snapshot (the HUD's data). */
  ctx.addSnapshot = (fn) => snapshotParts.push(fn);
  /** Show a message: ctx.toast('Fare collected', { tone: 'good' | 'bad' | 'gold' | 'info', icon?, ms? }). */
  ctx.toast = (text, opts = {}) => emit('toast', { text, tone: 'info', ms: 2600, ...opts });
  ctx.openMenu = (name) => {
    state.menu = name;
    emit('menu', { name });
  };
  ctx.closeMenu = () => {
    const was = state.menu;
    state.menu = null;
    input.clearTaps();
    if (was) emit('menu', { name: null, was });
  };
  const prompts = new Map();
  /** Show / clear a bottom-centre hint: ctx.setPrompt('pickup', 'Pick up Salma Aapa', 'E') ... ctx.setPrompt('pickup', null). */
  ctx.setPrompt = (id, text, key = 'E') => {
    if (text) prompts.set(id, { text, key });
    else prompts.delete(id);
  };
  ctx.addSystem = (sys) => {
    systems.push(sys);
    return sys;
  };

  const syncAuto = () => {
    const ud = auto.userData;
    auto.position.set(v.x, v.y, v.z);
    auto.rotation.set(0, v.heading, 0);
    ud.body.rotation.set(v.pitch, 0, v.roll);
    ud.body.position.y = Math.abs(v.roll) * 0.1;
    ud.front.rotation.y = -v.steer * 0.55;
    for (const w of ud.wheels) w.rotation.x = v.wheelSpin;
    const night = world.sky.state.night;
    if (ud.headlight) ud.headlight.intensity = clamp((night - 0.12) * 1.3, 0, 1) * 34;
    ud.brakeM.color.setScalar(v.braking ? 2.6 : 0.0).multiply({ r: 1, g: 0.12, b: 0.16 });
    ud.tailM.color.setRGB(v.braking ? 2.4 : 0.9, v.braking ? 0.2 : 0.1, 0.15);
    // the driver leans with the auto
    if (ud.driver) ud.driver.rotation.z = -v.roll * 0.6;
  };

  const HOLD = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false }; // a menu: no input; vehicle.hold() then parks the auto

  /** Advance the game by dt seconds (physics, systems, clock). No drawing. */
  const simulate = (dt) => {
    advanceClock(clock, dt, !!state.menu, DAY.secondsPerHour);

    // pressed one-shots the core handles
    if (!state.menu && input.pressed('horn')) { vehicle.honk(); emit('honk'); }
    if (input.pressed('camera') && !state.menu) state.cameraMode = rig.cycle();

    const drive = state.menu
      ? HOLD
      : state.forceDrive || (state.debugCam ? { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false } : input.drive());
    const env = {
      colliders: state.menu ? null : world.colliders,
      heightAt: world.heightAt,
      gripMul: state.gripMul * (1 - world.shared.uWet.value * 0.28),
      speedMul: state.speedMul,
      upgrades: state.upgrades,
      boostFuel: 0,
    };
    // fixed sub-steps keep the physics stable on slow frames
    const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
    const before = v.distance;
    const fuelBefore = v.fuel;
    for (let i = 0; i < steps; i++) {
      const evs = vehicle.update(dt / steps, drive, env);
      for (const e of evs) {
        if (e.type === 'crash') rig.kick(e.strength * 0.9);
        emit(e.type, e);
      }
    }
    if (state.menu) {
      vehicle.hold(dt); // never creeps (or reverses) while a menu is open
      v.fuel = fuelBefore; // ...and the engine idling behind a menu burns no CNG
    }
    profile.data.distance += Math.max(0, v.distance - before);
    for (const s of systems) {
      if (s.broken) continue;
      try {
        s.update?.(dt, ctx);
        s.errors = 0;
      } catch (err) {
        // log it, keep every other system running, and switch this one off after a few failures in a row
        s.errors = (s.errors || 0) + 1;
        if (s.errors === 1 || s.errors === 5) console.error('[autowala] a system failed to update', err);
        if (s.errors >= 5) s.broken = true;
      }
    }
    syncAuto();
  };

  let raf = 0;
  let last = 0;
  let snapAcc = 1; // publish the first snapshot on the very first frame (the UI mounts on it)
  let running = false;
  const MAXDT = 1 / 20;

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const rawDt = Math.max(0, Math.min((now - last) / 1000, 0.25));
    last = now;
    const dt = Math.min(rawDt, MAXDT);

    if (!state.paused) simulate(dt);

    const focus = { x: v.x, y: 0, z: v.z };
    world.update(dt, clock.sim, clock.hour, state.debugCam ? { x: state.debugCam.x, y: 0, z: state.debugCam.z } : focus, state.weather);

    if (state.debugCam) {
      const d = state.debugCam;
      camera.position.set(d.x, d.y, d.z);
      camera.lookAt(d.x + Math.sin(d.yaw) * Math.cos(d.pitch), d.y + Math.sin(d.pitch), d.z + Math.cos(d.yaw) * Math.cos(d.pitch));
      if (d.fov && camera.fov !== d.fov) { camera.fov = d.fov; camera.updateProjectionMatrix(); }
    } else if (state.cameraOverride) {
      state.cameraOverride(camera, dt);
    } else {
      rig.update(dt, v, { cameraMode: state.cameraMode });
    }
    gfx.render(rawDt);

    snapAcc += dt;
    if (snapAcc > 0.1) {
      snapAcc = 0;
      hooks.onSnapshot?.(snapshot());
    }
  };

  const snapshot = () => {
    const P = vehicle.params({ upgrades: state.upgrades });
    const out = {
      kmh: Math.round(v.kmh), fuel: v.fuel / P.tank, fuelLitres: v.fuel, hour: clock.hour, day: clock.day,
      drifting: v.drifting, boosting: v.boosting, driftCharge: v.driftCharge, airborne: v.airborne,
      x: v.x, z: v.z, heading: v.heading, paused: state.paused, quality: gfx.quality, menu: state.menu,
      wallet: ctx.economy.wallet, rating: profile.rating(), rides: profile.data.rides, totalEarned: profile.data.totalEarned,
      session: { ...ctx.economy.session },
      prompt: [...prompts.values()][0] || null,
    };
    for (const part of snapshotParts) {
      try {
        Object.assign(out, part());
      } catch (err) {
        console.error('[autowala] snapshot part failed', err);
      }
    }
    return out;
  };

  // a hidden tab stops drawing by itself (rAF), but sound would play on: suspend it and resume when the tab returns
  const onVisibility = () => {
    const a = getAudio();
    if (!a) return;
    if (document.hidden) a.ac.suspend?.();
    else a.ac.resume?.();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const start = () => {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const resize = (w, h) => gfx.resize(w, h);
  const dispose = () => {
    stop();
    for (const s of systems) {
      try {
        s.dispose?.(ctx);
      } catch (err) {
        console.error('[autowala] system dispose failed', err);
      }
    }
    document.removeEventListener('visibilitychange', onVisibility);
    stopAudioPrime();
    profile.dispose();
    input.dispose();
    world.dispose();
    disposeTree(scene);
    gfx.dispose();
  };
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  // debugging / screenshot hooks (also handy in the console)
  const debug = {
    cam: (c) => { state.debugCam = c ? { x: 0, y: 30, z: 0, yaw: 0, pitch: -0.3, ...c } : null; },
    hour: (h) => { clock.hour = h; },
    teleport: (x, z, heading) => vehicle.teleport(x, z, heading),
    weather: (w) => { state.weather = w; },
    /** Force the driving input (e.g. { steer: 0, throttle: 1 }); pass null to give control back. */
    drive: (d) => { state.forceDrive = d ? { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, ...d } : null; },
    /** Fast-forward the simulation by `seconds` of game time without drawing. */
    step: (seconds) => { for (let t = 0; t < seconds; t += 1 / 60) simulate(1 / 60); },
  };

  const game = { ctx, systems, vehicle, input, world, state, clock, profile, start, stop, resize, dispose, snapshot, on, emit, debug, gfx, rig };
  ctx.game = game;

  // gameplay systems: a broken one is logged and skipped, it never takes the whole game down. Install times are kept in game.boot.
  const boot = { world: world.timings, systems: {} };
  for (const [name, install] of [
    ['customization', installCustomization],
    ['fares', installFares],
    ['routeGuide', installRouteGuide],
    ['workshop', installWorkshop],
    ['voices', installVoices],
    ['traffic', installTraffic],
    ['roadRage', installRoadRage],
    ['weather', installWeather],
    ['career', installCareer],
    ['rules', installRules],
    ['quests', installQuests],
    ['sound', installSound],
  ]) {
    yield `systems:${name}`;
    const t = performance.now();
    try {
      install(ctx);
    } catch (err) {
      console.error(`[autowala] ${name} failed to install`, err);
    }
    boot.systems[name] = Math.round(performance.now() - t);
  }
  // Compile every shader program now, off the main thread where the browser allows it. The first render otherwise compiles ~60
  // programs synchronously and freezes the page (no UI, no input) for seconds on slower GPUs and drivers.
  yield 'compile';
  const t = performance.now();
  yield gfx.renderer.compileAsync ? gfx.renderer.compileAsync(scene, camera).catch(() => {}) : null;
  boot.compile = Math.round(performance.now() - t);
  game.boot = boot;
  return game;
}

/** Synchronous setup (tests, scripts). */
export const createGame = (opts) => drain(gameSteps(opts));

/** Setup that gives the browser a frame between stages. `onStep(stage, doneCount)` drives a loading bar; TOTAL_STEPS is its length. */
export const createGameAsync = (opts, onStep) => drainAsync(gameSteps(opts), onStep);
export const TOTAL_STEPS = 1 + 8 + 12 + 1;
