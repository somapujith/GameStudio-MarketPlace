// Tiffin Centre: the content catalogue. Pure data, no DOM, no Worker APIs. EVERY part of the game imports from here
// (engine, server adapter, 3D scene, HUD, tutorial), so names and shapes are the contract: add freely, never rename.
// Engine owners may retune NUMBERS in LEVELS / PACE (gaps, patience, star targets) after simulation; shapes stay.
//
// Units: time is in TICKS (1 tick = TICK_MS = 1 second of game time, driven by the room server's `deadlines`).
// Money is whole rupees. 3D units are metres, +x = the player's right, -z = towards the back wall (the kitchen),
// +z = towards the street (the customers). y is up.

export const GAME_ID = 'tiffin-centre';
export const TICK_MS = 1000;

export const MAX_LEVEL = 12; // levels 1..12 are the shifts; level 0 is the scripted tutorial
export const HANDS_MAX = 2; // dishes one player can carry
export const LIVES = 5; // hearts: an angry or unpaid customer costs one; at 0 the centre closes (not in the tutorial)

// Customer timing, in ticks.
export const PATIENCE_BASE = 38; // before kind / level / pace multipliers
export const PATIENCE_REFILL = 0.25; // fraction of max patience given back each time one of their dishes arrives
export const EAT_TICKS = 4; // eating after the last dish arrives, then they stand at the counter with money out
export const PAY_WINDOW = 9; // ticks the money stays out. Not collected in time: they walk away WITHOUT paying.
export const ARRIVAL_RETRY = 3; // a customer with no free spot waits this long, then is turned away (no penalty)

// Quality of a dish when taken from a station: age = ticks since it became ready.
export const PERFECT_AGE = 2; // age <= 2: 'perfect' (tip +5% of the dish price)
// age < dish.burn - 2: 'good'; otherwise 'ok'; age >= dish.burn: 'burnt' (cannot be served, only cleared)

export const PACE = {
  relaxed: { label: 'Relaxed', gap: 1.25, patience: 1.2, stars: 0.85 },
  normal: { label: 'Normal', gap: 1, patience: 1, stars: 1 },
  rush: { label: 'Rush hour', gap: 0.8, patience: 0.9, stars: 1.2 },
};

/** Co-op: arrivals speed up and star targets grow with the number of people at the stall. */
export const coopScale = (players) => 1 + 0.65 * (Math.max(1, Math.min(4, players)) - 1);

// ---------------------------------------------------------------------------------------------------------------------
// Stations. A station KIND says what it cooks; a station INSTANCE (id) is bolted to the stall at a fixed place.
export const STATION_KINDS = {
  tawa: { id: 'tawa', name: 'Dosa tawa', te: 'దోశ పెనం', slots: 3 },
  steamer: { id: 'steamer', name: 'Idly steamer', te: 'ఇడ్లీ పాత్ర', slots: 4 },
  kadai: { id: 'kadai', name: 'Fry kadai', te: 'కడాయి', slots: 3 },
  chai: { id: 'chai', name: 'Chai counter', te: 'చాయ్ కౌంటర్', slots: 2 },
};

/** Fixed layout of the stall. `slotOrder` of a station is slot 0, 1, 2... left to right. */
export const STATIONS = {
  tawa1: { id: 'tawa1', kind: 'tawa', x: -3.0, z: -2.2 },
  steamer1: { id: 'steamer1', kind: 'steamer', x: -1.5, z: -2.2 },
  kadai1: { id: 'kadai1', kind: 'kadai', x: 0.0, z: -2.2 },
  tawa2: { id: 'tawa2', kind: 'tawa', x: 1.5, z: -2.2 },
  chai1: { id: 'chai1', kind: 'chai', x: 3.0, z: -2.2 },
};
export const STATION_IDS = Object.keys(STATIONS);

export const LAYOUT = {
  counterZ: 0.3, // the serving counter's front edge; customers stand beyond it
  cookZ: -0.9, // where a cook stands (in front of the station they use)
  spotZ: 1.7, // customers' feet
  spotX: (i) => -3.75 + i * 1.5, // customer spot i = 0..5, left to right
  spots: 6,
  bin: { x: 4.4, z: -1.2 }, // burnt dishes and the discard bin
  camera: { pos: [0, 7.2, 6.8], target: [0, 0.4, -0.6], fov: 42 }, // a starting point; the scene may refine it
};

// ---------------------------------------------------------------------------------------------------------------------
// Dishes. cook / burn / ticks: ready after `cook` ticks; burns `burn` ticks after that (a burnt dish is lost).
export const DISHES = {
  idly: { id: 'idly', name: 'Idly (2 pc)', te: 'ఇడ్లీ', station: 'steamer', cook: 7, burn: 14, price: 30, tag: 'tiffin' },
  dosa: { id: 'dosa', name: 'Plain Dosa', te: 'దోశ', station: 'tawa', cook: 5, burn: 7, price: 40, tag: 'tiffin' },
  masala_dosa: { id: 'masala_dosa', name: 'Masala Dosa', te: 'మసాలా దోశ', station: 'tawa', cook: 7, burn: 7, price: 60, tag: 'tiffin' },
  podi_dosa: { id: 'podi_dosa', name: 'Ghee Podi Dosa', te: 'నెయ్యి పొడి దోశ', station: 'tawa', cook: 6, burn: 7, price: 55, tag: 'tiffin' },
  set_dosa: { id: 'set_dosa', name: 'Set Dosa (3 pc)', te: 'సెట్ దోశ', station: 'tawa', cook: 6, burn: 8, price: 50, tag: 'tiffin' },
  pesarattu: { id: 'pesarattu', name: 'Pesarattu', te: 'పెసరట్టు', station: 'tawa', cook: 7, burn: 7, price: 55, tag: 'tiffin' },
  poori: { id: 'poori', name: 'Poori Aloo', te: 'పూరీ', station: 'kadai', cook: 6, burn: 6, price: 50, tag: 'tiffin' },
  vada: { id: 'vada', name: 'Medu Vada', te: 'మెదు వడ', station: 'kadai', cook: 7, burn: 7, price: 35, tag: 'snack' },
  mysore_bonda: { id: 'mysore_bonda', name: 'Mysore Bonda', te: 'మైసూర్ బోండా', station: 'kadai', cook: 7, burn: 7, price: 40, tag: 'snack' },
  mirchi_bajji: { id: 'mirchi_bajji', name: 'Mirchi Bajji', te: 'మిర్చి బజ్జి', station: 'kadai', cook: 6, burn: 6, price: 30, tag: 'snack' },
  irani_chai: { id: 'irani_chai', name: 'Irani Chai', te: 'ఇరానీ చాయ్', station: 'chai', cook: 4, burn: 10, price: 15, tag: 'drink' },
  filter_coffee: { id: 'filter_coffee', name: 'Filter Coffee', te: 'ఫిల్టర్ కాఫీ', station: 'chai', cook: 4, burn: 10, price: 20, tag: 'drink' },
  osmania: { id: 'osmania', name: 'Osmania Biscuit', te: 'ఉస్మానియా బిస్కెట్', station: 'chai', cook: 2, burn: 20, price: 15, tag: 'snack' },
};
export const DISH_IDS = Object.keys(DISHES);

// ---------------------------------------------------------------------------------------------------------------------
// Customers. `look` is just a hint for the 3D models (build a distinct person per kind and per seed).
export const CUSTOMER_KINDS = {
  office: { id: 'office', label: 'Office-goer', patience: 0.75, tip: 1.6, order: [1, 3], weight: 3, look: 'shirt' },
  student: { id: 'student', label: 'Student', patience: 1.0, tip: 0.5, order: [1, 2], weight: 3, look: 'bag' },
  family: { id: 'family', label: 'Family', patience: 1.1, tip: 1.0, order: [2, 3], weight: 2, look: 'kids' },
  uncle: { id: 'uncle', label: 'Uncle garu', patience: 1.3, tip: 0.8, order: [1, 2], weight: 2, look: 'cap' },
  autowala: { id: 'autowala', label: 'Autowala', patience: 0.8, tip: 1.2, order: [1, 2], weight: 1, look: 'khaki' },
  techie: { id: 'techie', label: 'Hi-Tech techie', patience: 0.7, tip: 2.0, order: [1, 3], weight: 1, look: 'lanyard' },
};
export const CUSTOMER_NAMES = [
  'Ravi anna', 'Fatima aapa', 'Srinivas garu', 'Lakshmi akka', 'Imran bhai', 'Padma', 'Kiran', 'Naseer miyan', 'Swathi',
  'Venkat uncle', 'Zubeida bi', 'Raju', 'Anitha', 'Mahesh', 'Sana', 'Chandu', 'Pooja', 'Salman', 'Bhavani', 'Gopal garu',
];

// ---------------------------------------------------------------------------------------------------------------------
// Time of day. A shift runs from hour[0] to hour[1] (24h clock, decimal) across its ticks, so light and traffic change during it.
export const DAYPARTS = {
  morning: { id: 'morning', label: 'Morning', te: 'ఉదయం', from: 5, to: 11 },
  noon: { id: 'noon', label: 'Afternoon', te: 'మధ్యాహ్నం', from: 11, to: 16 },
  evening: { id: 'evening', label: 'Evening', te: 'సాయంత్రం', from: 16, to: 19.5 },
  night: { id: 'night', label: 'Night', te: 'రాత్రి', from: 19.5, to: 29 }, // 29 = 5 am next day
};
export function daypartOf(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 16) return 'noon';
  if (h >= 16 && h < 19.5) return 'evening';
  return 'night';
}

// ---------------------------------------------------------------------------------------------------------------------
// Levels. gap = [min, max] ticks between arrivals (before pace and co-op scaling); spots = counter places in use;
// patience = multiplier; stars = money for 1 / 2 / 3 stars (before pace and co-op scaling); orderMax caps dishes per customer.
const MORNING = ['dosa', 'masala_dosa', 'irani_chai'];
export const LEVELS = {
  0: { id: 0, name: 'Training Morning', te: 'శిక్షణ', hour: [7, 8], shiftTicks: 600, spots: 3, stations: ['tawa1', 'chai1'], menu: MORNING, gap: [14, 20], patience: 2, orderMax: 2, stars: [0, 0, 0], tutorial: true },
  1: { id: 1, name: 'Sunrise Dosa', te: 'సూర్యోదయ దోశ', hour: [6, 9], shiftTicks: 150, spots: 3, stations: ['tawa1', 'chai1'], menu: MORNING, gap: [12, 18], patience: 1.2, orderMax: 2, stars: [200, 320, 440] },
  2: { id: 2, name: 'Idly Sambar', te: 'ఇడ్లీ సాంబార్', hour: [6, 9.5], shiftTicks: 165, spots: 4, stations: ['tawa1', 'steamer1', 'chai1'], menu: [...MORNING, 'idly'], gap: [11, 16], patience: 1.1, orderMax: 2, stars: [260, 400, 540] },
  3: { id: 3, name: 'Poori Morning', te: 'పూరీ ఉదయం', hour: [7, 10], shiftTicks: 180, spots: 4, stations: ['tawa1', 'steamer1', 'kadai1', 'chai1'], menu: [...MORNING, 'idly', 'poori'], gap: [10, 15], patience: 1.05, orderMax: 2, stars: [320, 480, 640] },
  4: { id: 4, name: 'Breakfast Rush', te: 'బ్రేక్‌ఫాస్ట్ రష్', hour: [8, 11], shiftTicks: 180, spots: 5, stations: ['tawa1', 'steamer1', 'kadai1', 'chai1'], menu: [...MORNING, 'idly', 'poori', 'podi_dosa', 'vada'], gap: [8, 12], patience: 1, orderMax: 3, stars: [450, 650, 850] },
  5: { id: 5, name: 'Lunch Break', te: 'లంచ్ బ్రేక్', hour: [12, 14], shiftTicks: 180, spots: 5, stations: ['tawa1', 'tawa2', 'steamer1', 'kadai1', 'chai1'], menu: ['dosa', 'masala_dosa', 'set_dosa', 'pesarattu', 'poori', 'idly', 'irani_chai'], gap: [8, 12], patience: 1, orderMax: 3, stars: [520, 740, 960] },
  6: { id: 6, name: 'Office Crowd', te: 'ఆఫీస్ క్రౌడ్', hour: [13, 15.5], shiftTicks: 195, spots: 6, stations: ['tawa1', 'tawa2', 'steamer1', 'kadai1', 'chai1'], menu: ['dosa', 'masala_dosa', 'set_dosa', 'pesarattu', 'poori', 'idly', 'vada', 'irani_chai', 'filter_coffee'], gap: [7, 11], patience: 0.95, orderMax: 3, stars: [650, 900, 1150] },
  7: { id: 7, name: 'Chai Time', te: 'చాయ్ టైమ్', hour: [16, 18], shiftTicks: 180, spots: 5, stations: ['tawa1', 'steamer1', 'kadai1', 'chai1'], menu: ['irani_chai', 'filter_coffee', 'osmania', 'mirchi_bajji', 'mysore_bonda', 'vada'], gap: [8, 12], patience: 1, orderMax: 3, stars: [500, 720, 940] },
  8: { id: 8, name: 'Bonda and Bajji', te: 'బోండా బజ్జి', hour: [17, 19.5], shiftTicks: 195, spots: 6, stations: ['tawa1', 'tawa2', 'kadai1', 'chai1'], menu: ['irani_chai', 'filter_coffee', 'osmania', 'mirchi_bajji', 'mysore_bonda', 'vada', 'dosa'], gap: [7, 11], patience: 0.95, orderMax: 3, stars: [600, 850, 1100] },
  9: { id: 9, name: 'Sunset Rush', te: 'సన్‌సెట్ రష్', hour: [18, 20], shiftTicks: 210, spots: 6, stations: ['tawa1', 'tawa2', 'steamer1', 'kadai1', 'chai1'], menu: ['irani_chai', 'filter_coffee', 'osmania', 'mirchi_bajji', 'mysore_bonda', 'vada', 'dosa', 'masala_dosa', 'poori'], gap: [6, 10], patience: 0.9, orderMax: 3, stars: [800, 1100, 1400] },
  10: { id: 10, name: 'Night Tiffins', te: 'నైట్ టిఫిన్స్', hour: [20, 22], shiftTicks: 210, spots: 6, stations: ['tawa1', 'tawa2', 'kadai1', 'chai1'], menu: ['dosa', 'masala_dosa', 'podi_dosa', 'set_dosa', 'pesarattu', 'poori', 'irani_chai'], gap: [7, 10], patience: 0.9, orderMax: 3, stars: [800, 1100, 1400] },
  11: { id: 11, name: 'Late Night Hunger', te: 'లేట్ నైట్', hour: [22, 24], shiftTicks: 225, spots: 6, stations: ['tawa1', 'tawa2', 'steamer1', 'kadai1', 'chai1'], menu: ['dosa', 'masala_dosa', 'podi_dosa', 'set_dosa', 'pesarattu', 'poori', 'vada', 'irani_chai', 'filter_coffee'], gap: [6, 9], patience: 0.85, orderMax: 3, stars: [1000, 1350, 1700] },
  12: { id: 12, name: 'Festival Day', te: 'పండుగ రోజు', hour: [6, 24], shiftTicks: 300, spots: 6, stations: STATION_IDS, menu: DISH_IDS, gap: [6, 9], patience: 0.9, orderMax: 3, stars: [1800, 2500, 3200] },
};

export const levelDef = (n) => LEVELS[Math.max(0, Math.min(MAX_LEVEL, Math.trunc(Number(n)) || 0))];

// ---------------------------------------------------------------------------------------------------------------------
// Host settings of a table. The lobby schema (src/games/tiffin-centre/settings.js) and the server's validateSettings
// (worker/games/tiffin-centre.js) BOTH derive from this, so they cannot drift.
export const SETTINGS_SPEC = {
  level: { min: 1, max: MAX_LEVEL, default: 1 },
  pace: { options: ['relaxed', 'normal', 'rush'], default: 'normal' },
};
export const DEFAULT_SETTINGS = { level: SETTINGS_SPEC.level.default, pace: SETTINGS_SPEC.pace.default };

// Where the tutorial flag is mirrored on the client (the account's copy is `user.gameStats[GAME_ID].tutorialDone`).
export const TUTORIAL_LOCAL_KEY = `jalebi.tutorial.v1.${GAME_ID}`;
// Local solo progress (highest level cleared, stars per level): localStorage only, JSON `{ best: {1: {stars, earned}}, unlocked: n }`.
export const PROGRESS_LOCAL_KEY = `jalebi.progress.v1.${GAME_ID}`;
