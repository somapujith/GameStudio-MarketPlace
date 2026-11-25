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

export const QUALITY = {
  low: { pixelRatio: 1, shadow: 1024, bloom: false, traffic: 22, peds: 90, drawDist: 300 },
  medium: { pixelRatio: 1.25, shadow: 2048, bloom: true, traffic: 36, peds: 170, drawDist: 420 },
  high: { pixelRatio: 1.75, shadow: 2048, bloom: true, traffic: 52, peds: 260, drawDist: 560 },
};
