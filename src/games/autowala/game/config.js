// Every tuning number of Autowala in one place. Units: metres, seconds, rupees. North is -z, east is +x.

/** The city is the same for everyone (muscle memory matters in a driving game); only quest rolls use the per-run seed. */
export const CITY_SEED = 1;

export const WORLD = {
  half: 700, // the playable square is [-half, half] on x and z (1,400 m a side)
  roadHalfMin: 4,
  lakeCenter: [40, -170],
  lakeRadii: [215, 150],
};

/** 1 game hour in real seconds: a full day is 24 minutes. */
export const DAY = { secondsPerHour: 60, startHour: 17.4 };

export const CAR = {
  topSpeed: 24, // m/s (about 86 km/h) before upgrades
  boostSpeed: 33,
  accel: 14,
  brake: 30,
  reverseMax: 7,
  drag: 0.32, // rolling resistance (1/s)
  steerLow: 2.2, // rad/s at low speed
  steerHigh: 0.85, // rad/s at top speed
  grip: 7.5, // how fast sideways slip dies (1/s); the handbrake lowers it
  gripDrift: 1.15,
  radius: 1.35,
  length: 3.0,
  fuelTank: 12, // litres of CNG-equivalent
  fuelUse: 0.0012, // litres per metre at full load (idle burn is separate)
  idleUse: 0.002, // litres per second
};

export const LIMITS = {
  cityKmh: 60, // posted limit; going over near a speed camera is a challan
  bazaarKmh: 35,
};

export const ECON = {
  baseFare: 30,
  perMeter: 0.085,
  waitingPerSecond: 0.5,
  fuelPrice: 22, // rupees per litre
  challanSpeed: 300,
  challanSignal: 200,
  challanCow: 250,
  jugaadBonus: 60,
};

/**
 * Quality tiers, monotone: every number that costs more or looks better only goes up from low to high.
 *  pixelRatio      cap on the drawing-buffer density (the device ratio may be lower); pixelBudget  megapixels the scene pass may shade at render
 *                  scale 1 (a 4K window gets a lower ratio instead of an 8 MP frame); the pipeline is allocated for the highest tier a session may reach
 *  shadow          shadow-map size; shadows are OFF on low (Game.applyQuality)
 *  shadowInterval  seconds between shadow-map re-renders (0 = every frame): the sun's box follows the player on a texel grid, so a stale map
 *                  only lags moving casters by a frame or two
 *  chunk          map-tile size (m) of the culled instance sets: bigger = fewer draw calls, more off-screen triangles (render/chunks.js)
 *  bloom / bloomLevels  the neon glow: levels of the dual-Kawase pyramid (1/4 resolution and below)
 *  fxaa            edge anti-aliasing in the composite; msaa  samples on the scene target (0: off, the composite's FXAA does the work)
 *  traffic / peds  live vehicles / pedestrians;  far  the camera's far plane in metres (the fog hides it: sky.setFogFloor)
 */
export const QUALITY = {
  low: { pixelRatio: 1, pixelBudget: 2.1, shadow: 1024, shadowInterval: 0.05, chunk: 512, bloom: false, bloomLevels: 0, fxaa: true, msaa: 0, traffic: 22, peds: 90, far: 1000 },
  medium: { pixelRatio: 1.25, pixelBudget: 2.6, shadow: 2048, shadowInterval: 0.024, chunk: 1024, bloom: true, bloomLevels: 4, fxaa: true, msaa: 0, traffic: 36, peds: 170, far: 1300 },
  high: { pixelRatio: 1.75, pixelBudget: 5, shadow: 2048, shadowInterval: 0, chunk: 1024, bloom: true, bloomLevels: 5, fxaa: true, msaa: 0, traffic: 52, peds: 260, far: 1600 },
};

/**
 * What the shared governor (platform/gfx) is told about this game.
 *  scaleMin   the lowest render scale per tier (below ~0.6 the picture is visibly soft: the tier drops instead). A LIVE floor of 1 replaces it for
 *             a tier that is bound by draw calls (game/gfx-control.js createScaleFloors): resolution buys nothing there
 *  tierCost   relative frame cost per tier, for the tier-up prediction: measured on the dev laptop's integrated GPU, charminar at dusk, 1536x864 @ 1.25:
 *             busy machine: low 16.2-18.0 ms, medium 22.9, high 22.0-25.6; quiet moment (11:07): low 12.8, medium 14.4, high 15.6 (at that device ratio
 *             high draws the same pixels as medium). The ratio moves with the load (the shadow pass and the lamps are the fixed part): 1 / 1.15 / 1.25
 *  callBudget draw calls a frame (camera + shadow + post) a tier is designed for; over it while missing the frame budget = a tier down
 *  models     the start-up calibration's cost model per tier (platform/gfx/calibrate.js: ms = max(cpu, gpu) * 1.1, cpu = calls * callUs, gpu = layers *
 *             Mpix * fillNs + mtris * mtriMs + post * Mpix * postNs). FITTED to measured frame times (docs/perf/aw-int.md, "Validating the tier models"):
 *             `calls` is in the benchmark's simple-draw equivalents, so a real Autowala draw (program switches, ~30 uniform uploads, lights, fog) counts
 *             for ~5-6 of them: low ~190 draws a frame = 1100, medium ~230 = 1500, high ~240 = 1560. `layers` is small because the game is call-bound:
 *             the frame time of every tier moved by 4 % when the resolution went 1 -> 0.7.
 */
export const GFX = {
  startScaleMin: 0.85, // a calibration may not start the game softer than this unless the estimate is pixel-bound (the governor lowers it later if it must)
  startHoldMs: 4000, // the governor ignores the first seconds of play (first uploads, background compiles)
  teleportHoldMs: 1500,
  memoryHoldMs: 6000,
  tierRetryMs: 300000, // a tier the governor left because it could not hold the frame budget is not tried again for this long
  pinnedScaleMin: 0.8, // a tier the player chose may be softened only down to this render scale (the tier itself never changes)
  scaleMin: { low: 0.6, medium: 0.6, high: 0.7 },
  tierCost: { low: 1, medium: 1.15, high: 1.25 },
  hopelessFactor: 2.5, // a calibrated start tier is the highest (up to the GPU class cap) whose estimated frame is within this multiple of the budget
  callBudget: { low: 150, medium: 250, high: 300 },
  models: {
    low: { pixelRatio: 1, layers: 1.6, calls: 1100, mtris: 0.25, post: 1.0, scaleMin: 0.6 },
    medium: { pixelRatio: 1.25, layers: 1.6, calls: 1500, mtris: 0.35, post: 1.4, scaleMin: 0.6 },
    high: { pixelRatio: 1.75, layers: 1.8, calls: 1560, mtris: 0.45, post: 1.45, scaleMin: 0.7 },
  },
};
