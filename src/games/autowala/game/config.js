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
 * What the shared governor (platform/gfx) is told about this game. Filled from measurements on the integrated-GPU dev laptop
 * (docs/perf/aw-int.md): `models` are the calibration's cost model per tier, validated against measured frame times.
 *  scaleMin   the lowest render scale per tier (below ~0.6 the picture is visibly soft: the tier drops instead)
 *  tierCost   relative frame cost per tier (the tier-up prediction)
 *  callBudget draw calls a frame (camera + shadow pass) a tier is designed for; over it while missing the frame budget = a tier down
 */
export const GFX = {
  startScaleMin: 0.85, // a calibration may not start the game softer than this (the governor lowers it later if it must)
  startHoldMs: 4000, // the governor ignores the first seconds of play (first uploads, background compiles)
  teleportHoldMs: 1500,
  memoryHoldMs: 6000,
  scaleMin: { low: 0.6, medium: 0.6, high: 0.7 },
  tierCost: { low: 1, medium: 1.8, high: 2.6 },
  callBudget: { low: 150, medium: 250, high: 300 },
  models: {
    low: { pixelRatio: 1, layers: 2.5, calls: 450, mtris: 0.25, post: 0.4, scaleMin: 0.6 },
    medium: { pixelRatio: 1.25, layers: 3.5, calls: 800, mtris: 0.35, post: 1.4, scaleMin: 0.6 },
    high: { pixelRatio: 1.75, layers: 4.5, calls: 1000, mtris: 0.45, post: 2.2, scaleMin: 0.7 },
  },
};
