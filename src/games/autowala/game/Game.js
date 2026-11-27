// The game object: owns the renderer, the world, the player's auto and every system, runs the loop, and publishes a small
// snapshot for the React HUD ~10 times a second. Systems are plain modules with `install(ctx)`; see ../ARCHITECTURE.md for the
// ctx contract, the event bus and the snapshot shape.
import { createLoop, runStandaloneCalibration, watchDeviceHints } from '@/platform/gfx';
import { createRenderer } from '../render/renderer.js';
import { bloomThreshold } from '../render/post.js';
import { TIERS, fogFloorFor, prefOf } from '../render/quality.js';
import { worldSteps } from '../world/world.js';
import { drain, drainAsync } from './steps.js';
import { createSnapshotPublisher } from './snapshot.js';
import { buildAuto, randomLook } from '../sim/autoModel.js';
import { createVehicle } from '../sim/vehicle.js';
import { createInput } from './input.js';
import { createChaseCamera } from './camera.js';
import { DAY, GFX, QUALITY } from './config.js';
import { autoStartTier, createSwitchableTimer, guardMemoryWrites, memoryPlan, resolutionUseless, setupQuality, viewOf } from './gfx-control.js';
import { createTierSwitch } from './tier-switch.js';
import { abandonable, claimCanvas } from './claim.js';

const ORDER_IDX = (q) => TIERS.indexOf(q);
import { clamp, makeRng } from './rng.js';
import { advanceClock } from './clock.js';
import { createRig } from '../gameplay/customers.js';
import { PHASE, createFramePerf } from './perf.js';
import { createWarmer, idleBreak, passMaterials, recipeOf } from './warm.js';
import { POOL_LIGHTS, lightSet } from './light-sets.js';
import { createProfile } from '../gameplay/profile.js';
import { createEconomy } from '../gameplay/economy.js';
import { BODY_COLORS } from '../gameplay/catalog.js';
import { primeAudio, getAudio } from '../audio/ctx.js';
import { disposeTree } from '../render/dispose.js';
import { installCustomization, prepareEnvironment } from '../sim/customize.js';
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
export function* gameSteps({ canvas, seed = 1, quality, hooks = {}, claim = null }) {
  yield 'start';
  const profile = createProfile(hooks.userId);
  let applyQuality = () => {};
  let contextRestored = () => {};
  // the start tier and render scale: the player's choice, else what this machine did last time, else a ~250 ms calibration (behind the loading
  // bar), else the GPU class; the shared governor (platform/gfx) keeps the frame rate from there. Its decisions reach the game through
  // `handlers`, which is filled in once the renderer and the warm-up exist.
  const chosen = quality ?? profile.data.settings.quality ?? null;
  const handlers = {};
  const { aq, gpu, calibration, floors } = yield* setupQuality({ pref: prefOf(chosen), view: viewOf(canvas), handlers });
  const gov = aq.governor;
  guardMemoryWrites(aq, () => !state.menu); // (not from the start screen: see gfx-control.js)
  const gfx = createRenderer(canvas, {
    quality: aq.initial.tier,
    maxQuality: aq.initial.maxTier,
    scale: aq.initial.scale,
    explicit: aq.initial.source === 'pref', // a quality the player chose beats the software-renderer guess
    onContext: (s) => {
      state.contextLost = s === 'lost';
      if (s === 'restored') contextRestored();
      hooks.onContext?.(s);
    },
  });
  if (claim) claim.cleanup = () => gfx.dispose({ loseContext: false }); // a stale build that is dropped at a stage boundary hands the canvas on as it is
  const { scene, camera } = gfx;
  // three.js reads a program's compile / link log with synchronous calls the first time it is drawn: each is a round trip to the GPU process
  // behind the frames already queued. Production builds skip them (a shader error then just draws nothing instead of logging).
  gfx.renderer.debug.checkShaderErrors = !!import.meta.env?.DEV || (typeof location !== 'undefined' && /[?&]shaderdebug\b/.test(location.search)); // ?shaderdebug turns the logs back on
  // the auto's reflection room compiles its shaders in the background while the city builds (sim/customize.js attaches it later)
  const envPrep = prepareEnvironment(gfx.renderer);
  const world = yield* worldSteps(scene, seed);
  // quality drives: shadows (size or off), real lamp lights, how far the camera sees. (The renderer handles pixel ratio, MSAA, bloom.)
  applyQuality = (q) => {
    const cfg = QUALITY[q];
    world.sky.setShadows(cfg.shadow, q !== 'low');
    world.props.setLightCount(POOL_LIGHTS[q]);
    camera.far = cfg.far;
    camera.updateProjectionMatrix();
    world.sky.setFogFloor(fogFloorFor(cfg.far)); // the fog hides the far plane: towers fade out instead of being cut
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
  const ctx = { gfx, scene, camera, world, input, vehicle, v, auto, clock, state, rig, systems, hooks, profile, events: [], game: null, envPrep };

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
    if (was === 'start') perf.markPlay(); // the hitch counters (perf.report().hitches) start with the shift, after a grace of 3 s
    if (was) emit('menu', { name: null, was });
  };
  const prompts = new Map();
  /** Show / clear a bottom-centre hint: ctx.setPrompt('pickup', 'Pick up Salma Aapa', 'E') ... ctx.setPrompt('pickup', null). */
  ctx.setPrompt = (id, text, key = 'E') => {
    if (text) prompts.set(id, { text, key });
    else prompts.delete(id);
  };
  // per-system frame timings (game.perf.report().systems): a system is named after the install that registered it
  const perf = createFramePerf();
  let installing = 'core';
  ctx.addSystem = (sys) => {
    const n = systems.filter((s) => s.perfName?.split('+')[0] === installing).length;
    sys.perfName = n ? `${installing}+${n}` : installing;
    sys.perfIndex = perf.nameSystem(sys.perfName);
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
      const t0 = performance.now();
      try {
        s.update?.(dt, ctx);
        s.errors = 0;
        if (s.perfIndex !== undefined) perf.sys(s.perfIndex, performance.now() - t0); // (a system pushed to ctx.systems directly has no slot)
      } catch (err) {
        // log it, keep every other system running, and switch this one off after a few failures in a row
        s.errors = (s.errors || 0) + 1;
        if (s.errors === 1 || s.errors === 5) console.error('[autowala] a system failed to update', err);
        if (s.errors >= 5) s.broken = true;
      }
    }
    syncAuto();
  };

  let snapAcc = 1; // publish the first snapshot on the very first frame (the UI mounts on it)
  let running = false;
  let disposed = false;
  let bgTimer = 0;
  const MAXDT = 1 / 20;

  // The frame body, called by the shared loop (platform/gfx/loop.js: rAF, tab-hidden pause, no giant dt after it, and it feeds the governor
  // this frame's time, the CPU time of the body, the draw calls and the GPU time of the frame).
  let sunNight = -1;
  let renderMs = 0; // the last frame's time inside gfx.render (GL submission and every wait on the GPU in it)
  let frameT0 = 0;
  const frame = (rawDt) => {
    const dt = Math.min(rawDt, MAXDT);
    frameT0 = performance.now();

    perf.begin(rawDt * 1000);
    switcher.frame(); // a finished tier swap lands on a frame boundary, before anything of this frame is drawn
    if (!state.paused) simulate(dt);
    perf.lap(PHASE.sim);

    const focus = { x: v.x, y: 0, z: v.z };
    world.update(dt, clock.sim, clock.hour, state.debugCam ? { x: state.debugCam.x, y: 0, z: state.debugCam.z } : focus, state.weather);
    perf.lap(PHASE.world);

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
    perf.lap(PHASE.camera);
    // the bloom's threshold follows the time of day: neon and lamps glow at night, sunlit paint and chrome must not at noon
    const night = world.sky.state.night;
    if (Math.abs(night - sunNight) > 0.01) {
      sunNight = night;
      gfx.setBloomThreshold(bloomThreshold(night));
    }
    const tRender = performance.now();
    gfx.render(rawDt);
    renderMs = performance.now() - tRender;
    perf.lap(PHASE.render);
    if (gov.fpsCap !== loop.maxFps) loop.setMaxFps(gov.fpsCap); // battery / data saver: 30 fps
    if (tierFailedAt && performance.now() - tierFailedAt > GFX.tierRetryMs) {
      tierFailedAt = 0;
      gov.notifyLoadChange(); // the scene (and the machine) may be different now: a tier that failed may be tried again
    }

    snapAcc += dt;
    if (snapAcc > 0.1) {
      snapAcc = 0;
      publisher.push(uiSnapshot());
    }
    perf.lap(PHASE.snap);
    const info = gfx.renderer.info;
    const programs = info.programs ? info.programs.length : 0;
    perf.end({ programs, textures: info.memory.textures, geometries: info.memory.geometries });
    jsMs = performance.now() - frameT0 - renderMs;
  };
  // What the governor reads as "the main thread's time": the game's own JS (simulation, world, camera, HUD), NOT the time inside gfx.render. A
  // frame is CPU-bound for the governor when that JS is the limit (a tier cuts JS); the render call is a mix of GL submission and waiting for the
  // GPU that the loop cannot tell apart, so the render scale is tried first and the governor's no-gain check moves the tier when pixels were not
  // the cost (a draw-call-bound GPU). Fed to the governor through this thin wrapper instead of the loop's own cpu figure.
  let jsMs = 0;
  const loopGovernor = {
    frame: (dtMs, _cpuMs, calls, gpuMs) => gov.frame(dtMs, jsMs, calls, gpuMs),
    discontinuity: (ms) => gov.discontinuity(ms),
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

  // what React gets: the snapshot at the resolution the HUD shows (the clock to the minute, the fuel to a pixel, the drift charge to 2 %), and only
  // when something visible changed (game/snapshot.js). Unchanged parts keep their identity, so memoised components skip their render.
  const publisher = createSnapshotPublisher((s) => hooks.onSnapshot?.(s));
  const uiSnapshot = () => {
    const s = snapshot();
    s.hour = Math.floor(s.hour * 60) / 60;
    s.fuel = Math.round(s.fuel * 500) / 500;
    s.fuelLitres = Math.round(s.fuelLitres * 20) / 20;
    s.driftCharge = Math.round(s.driftCharge * 50) / 50;
    return s;
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
    gov.hold(GFX.startHoldMs); // the first seconds are first uploads and background compiles, not evidence about the load
    loop.start();
    game.startBackground?.();
  };
  const stop = () => {
    running = false;
    loop.stop();
  };
  // a window drag fires dozens of resizes: the pipeline is re-allocated once, when it settles (the canvas is stretched by CSS meanwhile)
  let resizeTimer = 0;
  let sized = false;
  const resize = (w, h) => {
    if (!sized) {
      sized = true;
      gfx.resize(w, h);
      return;
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      gov.discontinuity(800); // the renderer reallocates: that frame says nothing about the load
      gfx.resize(w, h);
    }, 120);
  };
  const dispose = () => {
    disposed = true;
    clearInterval(bgTimer);
    clearTimeout(resizeTimer);
    switcher.cancel();
    loop.dispose();
    stopHints();
    removeMemoryListener();
    gpuTimer.dispose();
    game.warm?.dispose();
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
    teleport: (x, z, heading) => vehicle.teleport(x, z, heading), // (vehicle.teleport is wrapped below: it holds the governor and refreshes the shadows)
    weather: (w) => { state.weather = w; },
    /** Force the driving input (e.g. { steer: 0, throttle: 1 }); pass null to give control back. */
    drive: (d) => { state.forceDrive = d ? { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, ...d } : null; },
    /** Fast-forward the simulation by `seconds` of game time without drawing. */
    step: (seconds) => { for (let t = 0; t < seconds; t += 1 / 60) simulate(1 / 60); },
  };

  const gpuTimer = createSwitchableTimer(gfx.renderer.getContext());
  const loop = createLoop({ render: (alpha, dt) => frame(dt), governor: loopGovernor, info: gfx.renderer.info, gpuTimer, maxDelta: 0.25 });
  const stopHints = watchDeviceHints(gov);
  // a teleport (the workshop, a fast travel, the probes): new surroundings, a new shadow box, a frame that is not evidence about the load
  const teleport0 = vehicle.teleport.bind(vehicle);
  vehicle.teleport = (...a) => {
    teleport0(...a);
    gfx.invalidateShadows();
    gov.hold(GFX.teleportHoldMs);
  };

  const game = {
    ctx, systems, vehicle, input, world, state, clock, profile, start, stop, resize, dispose, snapshot, on, emit, debug, gfx, rig, perf,
    // the governor, its start decision and the tier-swap controller (read by probes and the settings menu): game.adaptive.describe() is one line
    adaptive: {
      aq, gpu, calibration, governor: gov, loop, timer: gpuTimer, describe: () => aq.describe(),
      get switcher() { return switcher; }, // (created further down, once the warm-up exists)
      /** Run the start-up calibration again on a throw-away context (probes: validate the tier cost models against measured frame times). */
      recalibrate: (models = GFX.models) => runStandaloneCalibration({ width: canvas.clientWidth, height: canvas.clientHeight, dpr: window.devicePixelRatio || 1, gpu, tiers: models }),
    },
  };
  ctx.game = game;

  // ---- shader warm-up (game/warm.js). A shader program is linked the first time it is drawn, and that draw blocks until the driver is done:
  // ~100 ms per program on an integrated GPU, 150-250 of them here. So every program the game will draw with is built before the first frame,
  // off the main thread (KHR_parallel_shader_compile), for the state the game really draws in: into the composer's render target, with the
  // light set of the first frame. It starts now, while the systems install (the driver compiles in the background while the main thread
  // builds the rest of the game); what the systems add is compiled by a second, incremental call. The other light sets (night, the
  // workshop) are built in the background once the game runs, and a quality change builds its own before it is applied.
  const bootStart = performance.now();
  // Objects that only appear during play have programs of their own: a waiting customer (people: lit, shadow-receiving, not instanced) is
  // the first of them, a minute into the first ride. One hidden person with luggage stands in the scene for the whole game so the warm-up
  // builds those programs too (it is never drawn: invisible objects are compiled but not rendered).
  const probeRng = makeRng(0x51ee);
  const probeRig = createRig({ pax: 2, look: randomLook(probeRng), look2: randomLook(probeRng), kind: 'regular', female: false, luggage: true });
  probeRig.visible = false;
  probeRig.name = 'aw-warm-probe';
  scene.add(probeRig);
  const baseSpots = recipeOf(scene).spots; // the auto's headlight
  const warmer = createWarmer({ renderer: gfx.renderer, scene, camera, getTarget: () => gfx.target });
  const prepareFirstFrame = () => {
    world.update(0, clock.sim, clock.hour, { x: v.x, y: 0, z: v.z }, state.weather);
    rig.update(1 / 60, v, { cameraMode: state.cameraMode });
    syncAuto();
  };
  const warnWarm = (err) => console.warn('[autowala] shader warm-up skipped', err);
  // size the pipeline now (the screen's own resize afterwards is a no-op) so the composer's passes are built and compiled with the scene
  gfx.resize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);
  prepareFirstFrame();
  // The lamp pool is lit when the scene has point lights visible: that is "night" for the light set.
  const nightNow = () => recipeOf(scene).points > 0;
  // the light set the game is in and the other time of day, for a tier
  const phases = (q, { night = nightNow(), ...rest } = {}) => [lightSet(q, { night, baseSpots, ...rest }), lightSet(q, { night: !night, baseSpots, ...rest })];
  // Both times of day are built while loading, overlapped with the systems installing: dusk comes 48 s into a game, and building a light set
  // during play costs frames (each program has to be finished by the GPU process in between them), while behind the loading bar it is free.
  const warmBothPhases = (q) => Promise.all(phases(q).map((set) => warmer.warm(set, { budgetMs: 8 }))).catch(warnWarm);
  const earlyWarm = warmBothPhases(gfx.quality);

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
    installing = name;
    try {
      install(ctx);
    } catch (err) {
      console.error(`[autowala] ${name} failed to install`, err);
    }
    boot.systems[name] = Math.round(performance.now() - t);
  }
  installing = 'core';

  yield 'compile';
  const t = performance.now();
  yield earlyWarm;
  prepareFirstFrame(); // the systems moved things (the auto's environment map, lights): the first frame is what is compiled now
  yield warmBothPhases(gfx.quality); // what the systems added
  yield warmer.warmMaterials(passMaterials(gfx.composer)).catch(warnWarm);
  gfx.render(0); // one real frame into the pipeline: uploads the first view's geometry and textures and builds the shadow pass's depth programs
  boot.compile = Math.round(performance.now() - t);
  boot.warmStarted = Math.round(t - bootStart);
  boot.programs = gfx.renderer.info.programs ? gfx.renderer.info.programs.length : 0;
  boot.warm = { ...warmer.stats };

  // While the game runs the warm-up must not disturb it. Every program is a round trip to the GPU process (which first catches up with the
  // frames already queued), so: a few programs at a time, only while frames are healthy (or every ~1.2 s regardless, so a slow machine
  // still gets there), and only when the driver can compile in the background. Without KHR_parallel_shader_compile a compile blocks:
  // there only the loading screen warms.
  let lastSlice = 0;
  const calm = () => {
    const t = performance.now();
    if (perf.last < 40 || t - lastSlice > 1200) {
      lastSlice = t;
      return true;
    }
    return false;
  };
  // while the start menu is up nobody is playing: use the time at full speed; once the game is played, only while frames are healthy
  const idleOrTrickle = {
    budgetMs: 4,
    maxPending: 6,
    batch: 8,
    pause: () => idleBreak(state.menu === 'start' ? 8 : 24),
    ready: () => state.menu === 'start' || calm(),
  };

  // Building programs while the game runs is not free (each one has to be finished by the GPU process in between the frames), so it is done
  // once, for the tier the game settles on: nothing is built for a tier until it has been in force for STABLE_MS (the frame sampler steps
  // down within the first seconds on a slow GPU, and everything built for the tier it just left would be wasted).
  const STABLE_MS = 8000;
  let stableSince = performance.now();
  const stable = () => performance.now() - stableSince > STABLE_MS;
  const otherDone = new Set(); // tiers whose other time of day is built (the boot tier has both)
  let texturesDone = false;
  let bgBusy = false;

  /** After a quality change: the other time of day for the tier that has settled. Once: the textures that were not in the first view. */
  const background = async () => {
    if (!running || disposed || bgBusy || !warmer.parallel || !stable()) return;
    const q = gfx.quality;
    if (otherDone.has(q) && texturesDone) return;
    bgBusy = true;
    try {
      if (!otherDone.has(q)) {
        if ((await warmer.warm(phases(q)[1], idleOrTrickle)) === 'cancelled') return;
        otherDone.add(q);
      }
      if (!texturesDone) {
        if ((await warmer.warmTextures({ budgetMs: 3, pause: idleOrTrickle.pause, ready: idleOrTrickle.ready })) === 'cancelled') return;
        texturesDone = true;
      }
    } catch (err) {
      warnWarm(err);
    } finally {
      bgBusy = false;
    }
  };
  const startBackground = () => {
    clearInterval(bgTimer);
    bgTimer = setInterval(background, 1000);
  };

  // The tier below this one, built while the start menu is up (nobody is playing: the compile is free), so that a step down finds its programs
  // ready and swaps on the next frame instead of waiting for them while the game is slow. Both times of day; once.
  let belowWarmed = false;
  ctx.addSystem({
    update() {
      if (belowWarmed || !warmer.parallel || !running || state.menu !== 'start' || performance.now() - bootEnd < 2500) return;
      belowWarmed = true;
      const below = TIERS[Math.max(0, TIERS.indexOf(gfx.quality) - 1)];
      if (below === gfx.quality) return;
      Promise.all(phases(below).map((set) => warmer.warm(set, idleOrTrickle))).catch(warnWarm);
    },
  });

  // the workshop adds a spot light and two point lights to the scene: another light set. It is built when the player is about to use it: while
  // the start menu is up (the auto starts parked at the garage, nobody is playing), or when they stop at the garage for 3 s (not in the first
  // 20 s of a session, and never while driving past), for the time of day they are in.
  const garageFront = garage?.front;
  const bootEnd = performance.now();
  let workshopWarming = false;
  let garageClock = 0;
  let parked = 0;
  ctx.addSystem({
    update(dt) {
      if (!garageFront || !warmer.parallel || workshopWarming || !running) return;
      garageClock -= dt;
      if (garageClock > 0) return;
      const step = 0.5 - garageClock; // time since the last check
      garageClock = 0.5;
      const atGarage = Math.hypot(v.x - garageFront.x, v.z - garageFront.z) < 40 && v.speed < 1;
      parked = atGarage ? parked + step : 0;
      const menuTime = state.menu === 'start' && performance.now() - bootEnd > 2000;
      if (!menuTime && !(stable() && clock.time > 20 && parked >= 3)) return;
      const set = lightSet(gfx.quality, { night: nightNow(), workshop: true, baseSpots });
      if (warmer.has(set)) return;
      workshopWarming = true;
      warmer
        .warm(set, idleOrTrickle)
        .catch(warnWarm)
        .then(() => { workshopWarming = false; });
    },
  });

  // ---- tier steps. The governor decides; a step never stalls: the new tier's light set (lamp count, shadows: a whole set of programs) is
  // built in the background first and the swap (renderer tier, world quality, draw distance) happens on a frame boundary, all at once.
  const warmTier = (q) => {
    stableSince = performance.now();
    warmer.cancel();
    const workshop = state.menu === 'workshop';
    const [first] = phases(q, { night: recipeOf(scene).points > (workshop ? 2 : 0), workshop });
    // a trickle, like the other in-play warm-ups (a few programs at a time, only while frames are healthy): the swap waits a little longer and
    // no frame takes the compile storm of building ~90 programs at once (frames of 250-520 ms when that was done in a burst)
    return warmer.warm(first, { ...idleOrTrickle, maxPending: 10 }).catch((err) => {
      warnWarm(err);
      return 'failed';
    });
  };
  const switcher = createTierSwitch({
    warm: warmTier,
    getTier: () => gfx.quality,
    hold: (ms) => gov.hold(ms),
    apply: (q, scale) => {
      if (disposed) return;
      const grew = ORDER_IDX(q) > ORDER_IDX(gfx.maxQuality);
      applyQuality(q);
      gfx.setTier(q);
      gfx.setScale(scale);
      stableSince = performance.now();
      if (grew) gfx.invalidateShadows();
      if (releasePending) release();
      hooks.onQuality?.(q);
    },
  });
  // critical memory pressure: hand back the shadow map and every target allocated for the tiers above this one
  let releasePending = false;
  const release = () => {
    releasePending = false;
    if (gfx.quality === 'low') world.sky.setShadows(QUALITY.low.shadow, false);
    gfx.shrinkTo(gfx.quality);
  };
  // the governor's decisions. `gfx.autoTier = false` (probes, tests) means: ignore them.
  handlers.onScale = (s, info) => {
    if (resolutionUseless(info.reason)) floors.pin(gov.tier); // this machine is bound by draw calls: no more soft / sharp cycling at this tier or below
    if (gfx.autoTier && !disposed) gfx.setScale(s);
  };
  // A tier the governor LEFT because it could not hold the frame budget (draw calls, the resolution did not help, the scale floor was not enough)
  // is not tried again for GFX.tierRetryMs: its tier-up prediction reads the GPU timer, which cannot see a draw-call-bound frame, and would
  // otherwise climb back every 25 s, miss the budget and step down again.
  let tierFailedAt = 0;
  handlers.onTier = (t, info) => {
    if (resolutionUseless(info.reason)) floors.pin(info.from);
    if (info.kind === 'down') {
      gov.markTierFailed(info.from);
      tierFailedAt = performance.now();
    }
    if (gfx.autoTier && !disposed) switcher.request(t, info.scale);
  };
  handlers.onTierFailed = (t) => console.info('[autowala] tier', t, 'did not hold the frame rate here; it will not be tried again for a while');

  /**
   * The Graphics setting, live (ui/menus/settings.js calls this): a tier pins the game there (only the render scale adapts), null / 'auto'
   * goes back to the governor, starting from what this GPU allows. A tier above the allocation reallocates once (a player asked for it).
   */
  gfx.setQuality = (choice) => {
    const pin = ['low', 'medium', 'high'].includes(choice) ? choice : null;
    aq.forget();
    const target = pin || autoStartTier(gpu);
    gov.setTier(target, { scale: 1, lock: !!pin });
    gov.setMaxTier(pin || gpu.tierCap); // (gpu.tierCap is already a tier of this game: quality.js gpuForTiers)
    gfx.autoTier = true;
    switcher.request(target, 1);
    return target;
  };
  /** Memory pressure (the Android bridge fires 'jalebi:memory' { level: 'low' | 'critical' }): a step down and a hold, or the floor and the optional GPU memory released. */
  const onMemory = (e) => {
    const plan = memoryPlan(e?.detail?.level, { tier: gfx.quality, scale: gfx.scale, ladder: gov.ladder, floor: GFX.scaleMin[gfx.quality] ?? 0.6 });
    if (!plan || disposed) return;
    gov.setTier(plan.tier, { scale: plan.scale, lock: gov.locked });
    gov.hold(GFX.memoryHoldMs);
    releasePending = plan.release;
    if (plan.tier !== gfx.quality) switcher.request(plan.tier, plan.scale);
    else {
      gfx.setScale(plan.scale);
      if (releasePending) release();
    }
  };
  const memoryTarget = typeof window !== 'undefined' ? window : null;
  memoryTarget?.addEventListener('jalebi:memory', onMemory);
  const removeMemoryListener = () => memoryTarget?.removeEventListener('jalebi:memory', onMemory);
  // the GPU context came back: every program and texture is gone, so build the first frame's again (the renderer re-creates them on first use
  // otherwise, which is the long freeze this module exists to avoid), then the rest
  contextRestored = () => {
    if (disposed) return;
    gpuTimer.rebuild(gfx.renderer.getContext());
    gov.hold(3000);
    warmer.reset();
    otherDone.clear();
    texturesDone = false;
    stableSince = performance.now();
    warmer.warm(phases(gfx.quality)[0], { budgetMs: 8 }).catch(warnWarm);
  };
  otherDone.add(gfx.quality); // built above
  game.boot = boot;
  game.warm = warmer;
  game.startBackground = startBackground;
  return game;
}

/** Synchronous setup (tests, scripts). */
export const createGame = (opts) => drain(gameSteps(opts));

/** Setup that gives the browser a frame between stages. `onStep(stage, doneCount)` drives a loading bar; TOTAL_STEPS is its length. */
export function createGameAsync(opts, onStep) {
  const claim = claimCanvas(opts.canvas); // (an older build on the same canvas, StrictMode's first, stops at its next stage: game/claim.js)
  return drainAsync(abandonable(gameSteps({ ...opts, claim }), claim), onStep);
}
export const TOTAL_STEPS = 1 + 8 + 12 + 1;
