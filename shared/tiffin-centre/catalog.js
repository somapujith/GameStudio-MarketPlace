// Tiffin Centre: the content catalogue. Pure data, no DOM, no Worker APIs. EVERY part of the game imports from here
// (engine, server adapter, 3D scene, HUD, tutorial), so names and shapes are the contract: add freely, never rename.
// Engine owners may retune NUMBERS in LEVELS / PACE (gaps, patience, star targets) after simulation; shapes stay.
//
// Units: time is in TICKS (1 tick = TICK_MS = 1 second of game time, driven by the room server's `deadlines`).
// Money is whole rupees. 3D units are metres, +x = the player's right, -z = towards the back wall (the kitchen),
// (first person: the cook looks towards -z; the customers and the street are at -z, the cook's back is +z). y is up.

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
  // The back counter (OPERATIONS LAYER, section 3b): wet grinder, chutney stone, sambar vessel, dough tray. It cooks no dish: its 2 slots are PREP JOBS.
  prep: { id: 'prep', name: 'Prep counter', te: 'వెనుక కౌంటర్', slots: 2 },
};

/** Fixed layout of the stall, FIRST PERSON: the cook stands on the cook line (z = LAYOUT.cookZ = 0) facing -z (so +x is the cook's RIGHT, the default three.js camera); the cooking row is in front of them on the counter
    (a station's front faces +z, towards the cook) and the customers stand beyond it. `slotOrder` of a station is slot 0, 1, 2... left to right as the cook sees them. */
export const STATIONS = {
  tawa1: { id: 'tawa1', kind: 'tawa', x: -2.6, z: -1.0 },
  steamer1: { id: 'steamer1', kind: 'steamer', x: -1.3, z: -1.0 },
  kadai1: { id: 'kadai1', kind: 'kadai', x: 0.0, z: -1.0 },
  tawa2: { id: 'tawa2', kind: 'tawa', x: 1.3, z: -1.0 },
  chai1: { id: 'chai1', kind: 'chai', x: 2.6, z: -1.0 },
  // The prep counter is BEHIND the cook (+z): the cook turns round to reach it. Only present on levels that track stock.
  prep1: { id: 'prep1', kind: 'prep', x: 0.65, z: 1.4 },
};
export const PREP_STATION = 'prep1';
/** The five cooking stations (the prep counter is not one of them: it is added to `cfg.stations` by levels that track stock). */
export const STATION_IDS = Object.keys(STATIONS).filter((id) => STATIONS[id].kind !== 'prep');

export const LAYOUT = {
  // First person: the cook's eyes are at (x along the line, EYE_HEIGHT, cookZ) looking -z (three.js default); yaw 0 faces the customers.
  eyeHeight: 1.55,
  cookZ: 0, // where a cook stands (the walking line); x is the station / customer they work at
  stationZ: -1.0, // the cooking row (centre of each station's counter block)
  counterZ: -1.65, // the serving counter's customer-side edge; customers stand beyond it
  spotZ: -2.5, // customers' feet
  spotX: (i) => -2.75 + i * 1.1, // customer spot i = 0..5, left to right as the cook sees them
  spots: 6,
  bin: { x: 3.7, z: -0.5 }, // burnt dishes and the discard bin, at the right end of the row
  prep: { x: 0.65, z: 1.4 }, // the back counter (grinder, chutney stone, sambar pot, dough tray): behind the cook, +z
  gas: { x: -3.55, z: 0.25 }, // the LPG cylinder stand at the left end of the line (stand target 'gas')
  view: { fov: 74, yawMax: 1.45, pitchMin: -0.75, pitchMax: 0.55 }, // first-person camera: field of view and how far the head can turn (radians)
};

// ---------------------------------------------------------------------------------------------------------------------
// Dishes. cook / burn / ticks: ready after `cook` ticks; burns `burn` ticks after that (a burnt dish is lost).
export const DISHES = {
  idly: { id: 'idly', name: 'Idly (2 pc)', te: 'ఇడ్లీ', station: 'steamer', cook: 7, burn: 14, price: 30, tag: 'tiffin', uses: { batter_idly: 1, sambar: 0.5, coconut_chutney: 0.5 } },
  dosa: { id: 'dosa', name: 'Plain Dosa', te: 'దోశ', station: 'tawa', cook: 5, burn: 7, price: 40, tag: 'tiffin', uses: { batter_dosa: 1, coconut_chutney: 0.5, sambar: 0.5, oil: 0.25 } },
  masala_dosa: { id: 'masala_dosa', name: 'Masala Dosa', te: 'మసాలా దోశ', station: 'tawa', cook: 7, burn: 7, price: 60, tag: 'tiffin', uses: { batter_dosa: 1, potato_masala: 1, coconut_chutney: 0.5, sambar: 0.5, oil: 0.25 } },
  podi_dosa: { id: 'podi_dosa', name: 'Ghee Podi Dosa', te: 'నెయ్యి పొడి దోశ', station: 'tawa', cook: 6, burn: 7, price: 55, tag: 'tiffin', uses: { batter_dosa: 1, podi_ghee: 1, coconut_chutney: 0.5, oil: 0.25 } },
  set_dosa: { id: 'set_dosa', name: 'Set Dosa (3 pc)', te: 'సెట్ దోశ', station: 'tawa', cook: 6, burn: 8, price: 50, tag: 'tiffin', uses: { batter_dosa: 1.25, coconut_chutney: 0.5, sambar: 0.5, oil: 0.25 } },
  pesarattu: { id: 'pesarattu', name: 'Pesarattu', te: 'పెసరట్టు', station: 'tawa', cook: 7, burn: 7, price: 55, tag: 'tiffin', uses: { batter_pesarattu: 1, coconut_chutney: 0.5, oil: 0.25 } },
  poori: { id: 'poori', name: 'Poori Aloo', te: 'పూరీ', station: 'kadai', cook: 6, burn: 6, price: 50, tag: 'tiffin', uses: { poori_dough: 1, potato_masala: 1, oil: 0.5 } },
  vada: { id: 'vada', name: 'Medu Vada', te: 'మెదు వడ', station: 'kadai', cook: 7, burn: 7, price: 35, tag: 'snack', uses: { vada_batter: 1, coconut_chutney: 0.5, sambar: 0.25, oil: 0.25 } },
  mysore_bonda: { id: 'mysore_bonda', name: 'Mysore Bonda', te: 'మైసూర్ బోండా', station: 'kadai', cook: 7, burn: 7, price: 40, tag: 'snack', uses: { besan_batter: 1, coconut_chutney: 0.5, oil: 0.5 } },
  mirchi_bajji: { id: 'mirchi_bajji', name: 'Mirchi Bajji', te: 'మిర్చి బజ్జి', station: 'kadai', cook: 6, burn: 6, price: 30, tag: 'snack', uses: { mirchi: 1, besan_batter: 0.5, oil: 0.5 } },
  irani_chai: { id: 'irani_chai', name: 'Irani Chai', te: 'ఇరానీ చాయ్', station: 'chai', cook: 4, burn: 10, price: 15, tag: 'drink', uses: { tea_decoction_milk: 1 } },
  filter_coffee: { id: 'filter_coffee', name: 'Filter Coffee', te: 'ఫిల్టర్ కాఫీ', station: 'chai', cook: 4, burn: 10, price: 20, tag: 'drink', uses: { coffee_decoction: 1 } },
  osmania: { id: 'osmania', name: 'Osmania Biscuit', te: 'ఉస్మానియా బిస్కెట్', station: 'chai', cook: 2, burn: 20, price: 15, tag: 'snack', uses: { biscuits: 1 } },
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
// patience = multiplier; stars = PROFIT (money in hand - costs, see economy.js) for 1 / 2 / 3 stars (before pace and co-op scaling); orderMax caps dishes per customer.
const MORNING = ['dosa', 'masala_dosa', 'irani_chai'];
export const LEVELS = {
  0: { id: 0, name: 'Training Morning', te: 'శిక్షణ', hour: [7, 8], shiftTicks: 3600, spots: 3, stations: ['tawa1', 'steamer1', 'kadai1', 'chai1'], menu: DISH_IDS, gap: [14, 20], patience: 2, orderMax: 2, stars: [0, 0, 0], tutorial: true },
  1: { id: 1, name: 'Sunrise Dosa', te: 'సూర్యోదయ దోశ', hour: [6, 9], shiftTicks: 150, spots: 3, stations: ['tawa1', 'chai1'], menu: MORNING, gap: [12, 18], patience: 1.2, orderMax: 2, stars: [260, 440, 610] },
  2: { id: 2, name: 'Idly Sambar', te: 'ఇడ్లీ సాంబార్', hour: [6, 9.5], shiftTicks: 165, spots: 4, stations: ['tawa1', 'steamer1', 'chai1'], menu: [...MORNING, 'idly'], gap: [12, 18], patience: 1.1, orderMax: 2, stars: [300, 520, 740] },
  3: { id: 3, name: 'Poori Morning', te: 'పూరీ ఉదయం', hour: [7, 10], shiftTicks: 180, spots: 4, stations: ['tawa1', 'steamer1', 'kadai1', 'chai1'], menu: [...MORNING, 'idly', 'poori'], gap: [12, 18], patience: 1.05, orderMax: 2, stars: [330, 570, 820] },
  4: { id: 4, name: 'Breakfast Rush', te: 'బ్రేక్‌ఫాస్ట్ రష్', hour: [8, 11], shiftTicks: 180, spots: 5, stations: ['tawa1', 'steamer1', 'kadai1', 'chai1'], menu: [...MORNING, 'idly', 'poori', 'podi_dosa', 'vada'], gap: [10, 13], patience: 1, orderMax: 3, stars: [700, 1100, 1450] },
  5: { id: 5, name: 'Lunch Break', te: 'లంచ్ బ్రేక్', hour: [12, 14], shiftTicks: 180, spots: 5, stations: ['tawa1', 'tawa2', 'steamer1', 'kadai1', 'chai1'], menu: ['dosa', 'masala_dosa', 'set_dosa', 'pesarattu', 'poori', 'idly', 'irani_chai'], gap: [10, 14], patience: 1, orderMax: 3, stars: [760, 1150, 1550] },
  6: { id: 6, name: 'Office Crowd', te: 'ఆఫీస్ క్రౌడ్', hour: [13, 15.5], shiftTicks: 195, spots: 6, stations: ['tawa1', 'tawa2', 'steamer1', 'kadai1', 'chai1'], menu: ['dosa', 'masala_dosa', 'set_dosa', 'pesarattu', 'poori', 'idly', 'vada', 'irani_chai', 'filter_coffee'], gap: [12, 16], patience: 1, orderMax: 3, stars: [700, 1150, 1520] },
  7: { id: 7, name: 'Chai Time', te: 'చాయ్ టైమ్', hour: [16, 18], shiftTicks: 180, spots: 5, stations: ['tawa1', 'steamer1', 'kadai1', 'chai1'], menu: ['irani_chai', 'filter_coffee', 'osmania', 'mirchi_bajji', 'mysore_bonda', 'vada'], gap: [11, 15], patience: 1, orderMax: 3, stars: [430, 700, 980] },
  8: { id: 8, name: 'Bonda and Bajji', te: 'బోండా బజ్జి', hour: [17, 19.5], shiftTicks: 195, spots: 6, stations: ['tawa1', 'tawa2', 'kadai1', 'chai1'], menu: ['irani_chai', 'filter_coffee', 'osmania', 'mirchi_bajji', 'mysore_bonda', 'vada', 'dosa'], gap: [11, 15], patience: 0.95, orderMax: 3, stars: [500, 760, 1000] },
  9: { id: 9, name: 'Sunset Rush', te: 'సన్‌సెట్ రష్', hour: [18, 20], shiftTicks: 210, spots: 6, stations: ['tawa1', 'tawa2', 'steamer1', 'kadai1', 'chai1'], menu: ['irani_chai', 'filter_coffee', 'osmania', 'mirchi_bajji', 'mysore_bonda', 'vada', 'dosa', 'masala_dosa', 'poori'], gap: [7, 12], patience: 0.9, orderMax: 3, stars: [850, 1300, 1800] },
  10: { id: 10, name: 'Night Tiffins', te: 'నైట్ టిఫిన్స్', hour: [20, 22], shiftTicks: 210, spots: 6, stations: ['tawa1', 'tawa2', 'kadai1', 'chai1'], menu: ['dosa', 'masala_dosa', 'podi_dosa', 'set_dosa', 'pesarattu', 'poori', 'irani_chai'], gap: [8, 12], patience: 0.9, orderMax: 3, stars: [1100, 1700, 2400] },
  11: { id: 11, name: 'Late Night Hunger', te: 'లేట్ నైట్', hour: [22, 24], shiftTicks: 225, spots: 6, stations: ['tawa1', 'tawa2', 'steamer1', 'kadai1', 'chai1'], menu: ['dosa', 'masala_dosa', 'podi_dosa', 'set_dosa', 'pesarattu', 'poori', 'vada', 'irani_chai', 'filter_coffee'], gap: [7, 11], patience: 0.85, orderMax: 3, stars: [1100, 1700, 2450] },
  12: { id: 12, name: 'Festival Day', te: 'పండుగ రోజు', hour: [6, 24], shiftTicks: 300, spots: 6, stations: STATION_IDS, menu: DISH_IDS, gap: [7, 11], patience: 0.9, orderMax: 3, stars: [1400, 2200, 3000] },
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

// =====================================================================================================================
// OPERATIONS LAYER (docs/TIFFIN_CENTRE_PLAN.md section 3b): what a real Hyderabad tiffin centre has to look after besides cooking.
// Level 0 (the tutorial) has NONE of it: unlimited stock, no gas limit, no heat, no events, no requests.

// ---- Ingredients. One unit = one portion; `cost` = rupees per portion (a dish's food cost is ~25-40% of its price).
// `prep` = the back-counter job that makes `yield` portions in `ticks` (the ingredient price is paid up front); `needs` says what the job
// stops without: 'power' (wet grinder / mixie) or 'gas' (a pot on the stove); null = by hand. `ferments` = batter that goes sour.
export const INGREDIENTS = {
  batter_dosa: { id: 'batter_dosa', name: 'Dosa batter', te: 'దోశ పిండి', cost: 5, ferments: true, prep: { ticks: 12, yield: 12, needs: 'power', how: 'Grind rice and urad dal' } },
  batter_idly: { id: 'batter_idly', name: 'Idly batter', te: 'ఇడ్లీ పిండి', cost: 4, ferments: true, prep: { ticks: 12, yield: 12, needs: 'power', how: 'Grind idly rava and urad dal' } },
  batter_pesarattu: { id: 'batter_pesarattu', name: 'Pesarattu batter', te: 'పెసరట్టు పిండి', cost: 7, ferments: true, prep: { ticks: 10, yield: 8, needs: 'power', how: 'Soak and grind green moong' } },
  potato_masala: { id: 'potato_masala', name: 'Potato masala', te: 'బంగాళదుంప మసాలా', cost: 6, prep: { ticks: 8, yield: 10, needs: 'gas', how: 'Boil, mash and temper the aloo' } },
  coconut_chutney: { id: 'coconut_chutney', name: 'Coconut chutney', te: 'కొబ్బరి చట్నీ', cost: 4, prep: { ticks: 6, yield: 12, needs: null, how: 'Grind coconut and green chilli on the stone' } },
  sambar: { id: 'sambar', name: 'Sambar', te: 'సాంబార్', cost: 4, prep: { ticks: 10, yield: 14, needs: 'gas', how: 'Boil dal and vegetables with sambar powder' } },
  podi_ghee: { id: 'podi_ghee', name: 'Podi and ghee', te: 'పొడి నెయ్యి', cost: 8, prep: { ticks: 4, yield: 8, needs: null, how: 'Mix gunpowder podi with ghee' } },
  poori_dough: { id: 'poori_dough', name: 'Poori dough', te: 'పూరీ పిండి', cost: 6, prep: { ticks: 6, yield: 10, needs: null, how: 'Knead and rest the wheat dough' } },
  vada_batter: { id: 'vada_batter', name: 'Vada batter', te: 'వడ పిండి', cost: 6, ferments: true, prep: { ticks: 10, yield: 10, needs: 'power', how: 'Grind urad dal with green chilli and curry leaf' } },
  besan_batter: { id: 'besan_batter', name: 'Besan batter', te: 'సెనగపిండి', cost: 5, prep: { ticks: 6, yield: 10, needs: null, how: 'Whisk besan with ajwain and salt' } },
  mirchi: { id: 'mirchi', name: 'Bajji chillies', te: 'బజ్జీ మిర్చి', cost: 3, prep: { ticks: 5, yield: 10, needs: null, how: 'Wash, slit and stuff the green chillies' } },
  tea_decoction_milk: { id: 'tea_decoction_milk', name: 'Chai decoction and milk', te: 'టీ డికాషన్ పాలు', cost: 4, prep: { ticks: 6, yield: 14, needs: 'gas', how: 'Boil tea, milk and sugar' } },
  coffee_decoction: { id: 'coffee_decoction', name: 'Coffee decoction', te: 'కాఫీ డికాషన్', cost: 5, prep: { ticks: 6, yield: 10, needs: 'gas', how: 'Drip the filter decoction and boil the milk' } },
  biscuits: { id: 'biscuits', name: 'Osmania biscuits', te: 'ఉస్మానియా బిస్కెట్లు', cost: 3, prep: { ticks: 3, yield: 16, needs: null, how: 'Open the carton and fill the jar' } },
  oil: { id: 'oil', name: 'Cooking oil', te: 'నూనె', cost: 10, prep: { ticks: 3, yield: 12, needs: null, how: 'Decant the tin into the oil can' } },
};
export const INGREDIENT_IDS = Object.keys(INGREDIENTS);
export const STOCK_CAP = 48; // portions of one item (a prep job that would overflow is refused)
export const STOCK_LOW = 3; // `stock-low` fires when an item falls to this many portions or fewer
export const MARKET_MARKUP = 1.4; // `buy` (a runner to the market) costs 40% more than making it
export const MARKET_MAX = 10; // portions per `buy`
export const FERMENT = { sour: 30, spoil: 0, every: { morning: 3, noon: 2, evening: 3, night: 4 } }; // batter loses 1 freshness every N ticks; below `sour` dishes drop to 'ok'

// ---- LPG gas: units 0..cap. Each station with a dish cooking, and each gas prep job running, burns `drain` per tick.
export const GAS = { cap: 1000, drain: 2, lowFrac: 0.2, swapTicks: 6, swapCost: 90, swapMaxFrac: 0.7 };

// ---- Heat / seasoning / tending (tawa, kadai: `heat` + `gunk`; steamer: `water`). heat 0..100, the ideal band is [cold, hot].
export const HEAT = {
  start: 52, ideal: 52, cold: 30, hot: 72, // below `cold` cooking runs at half speed; above `hot` ready dishes burn 1.5x as fast
  pourCool: { tawa: 4, kadai: 5 }, // every cook-start chills the pan
  recover: 1, idleRise: 1, idleEvery: 3, // heat moves back towards ideal by `recover` per tick while cooking; an idle pan creeps hotter by `idleRise` every `idleEvery` ticks
  gunkPerCook: 2, stick: 40, torn: 70, // gunk >= stick: new dishes come out 'stuck' (ok); >= torn: they tear ('broken', half price)
  waterStart: 100, waterDrain: 1, waterDry: 30, // the steamer: -1 per tick while cooking; below dry it runs half speed (and sticks); 0: no steam
  tendMin: 0.15, // `tend` is refused below this need ("already clean")
  inspectorWindow: 30, // the food-safety inspector wants every dosa tawa tended within this many ticks
};

// ---- Customers' special requests and parcels
export const REQUEST = {
  extraChance: 0.18, spiceChance: 0.16, parcelChance: 0.12, officeParcelChance: 0.3,
  extraTip: 4, extraUse: 0.5, // extra chutney / sambar: 0.5 portion, +Rs 4 tip (and a happy customer)
  parcelFee: 5, parcelPatience: 0.8, packExtra: 2, // per packed dish; patience x0.8; packing takes EAT_TICKS + 2 instead of eating
  big: { min: 6, max: 10, patience: 2.6, bonus: 60, chance: 0.1, spacing: 60, from: 30 }, // an office parcel order: 6-10 dishes, long deadline
  delivery: { dishes: 5, patience: 48, bonus: 50 }, // the tiffin delivery boy: 5 parcels, in a hurry
  regularChance: 0.5, regularMult: 0.3, regularMax: 3, // a regular's tip x(1 + 0.3 * (loyalty + 1)) when served well
};

// ---- Events (events.js). at = fraction of the shift when it starts, dur = ticks (min, max).
export const EVENTS = {
  rain: { id: 'rain', name: 'Rain', te: 'వర్షం', at: [0.22, 0.6], dur: [36, 52], crowd: 0.6, dish: { irani_chai: 2, filter_coffee: 1.6, mirchi_bajji: 2, mysore_bonda: 2, vada: 1.5 } },
  cricket: { id: 'cricket', name: 'Cricket match night', te: 'క్రికెట్ మ్యాచ్', at: [0.3, 0.55], dur: [50, 70], crowd: 1.5, burst: true, kind: { student: 2, office: 1.3, autowala: 1.6, family: 0.5, uncle: 0.6 } },
  power: { id: 'power', name: 'Power cut', te: 'కరెంట్ కట్', at: [0.2, 0.7], dur: [22, 30], down: ['steamer', 'grinder', 'lights'] },
  festival: { id: 'festival', name: 'Festival rush', te: 'పండుగ రద్దీ', at: [0.3, 0.55], dur: [60, 90], crowd: 1.5, tip: 1.3, kind: { family: 1.6 } },
  inspector: { id: 'inspector', name: 'GHMC food-safety inspector', te: 'ఫుడ్ ఇన్‌స్పెక్టర్', at: [0.55, 0.65], dur: [14, 14], bonus: 60, fine: 50 },
  delivery: { id: 'delivery', name: 'Tiffin delivery boy', te: 'డెలివరీ బాయ్', at: [0.3, 0.5], dur: [5, 5] },
};
export const EVENT_IDS = Object.keys(EVENTS);

// ---- Demand realism. Arrival crowd by hour (piecewise linear), then kind and dish weights by daypart. All are RELATIVE multipliers:
// the schedule normalises the curve so a level's mean gap stays `level.gap` (the curve only decides WHEN the rushes come).
export const CROWD_CURVE = [
  [5, 0.2], [6, 0.5], [7, 1.0], [8.5, 1.65], [10, 1.1], [11, 0.65], [12, 0.8], [13, 0.9], [14.5, 0.5], [16, 0.7],
  [17, 1.3], [18, 1.7], [19.5, 1.2], [21, 1.45], [22.5, 0.9], [24, 0.55], [26, 0.3], [29, 0.2],
];
export const CROWD_SPREAD = 0.6; // how much of the curve's swing a level feels (1 = the full real-life bell, 0 = a flat crowd)
export const KIND_BY_DAYPART = {
  morning: { office: 1.7, student: 0.7, family: 0.6, uncle: 1.6, autowala: 1, techie: 1 },
  noon: { office: 1.5, student: 1, family: 0.9, uncle: 0.8, autowala: 1.2, techie: 1.4 },
  evening: { office: 1, student: 1.9, family: 1.1, uncle: 1.1, autowala: 1, techie: 0.8 },
  night: { office: 0.5, student: 1, family: 1.8, uncle: 0.5, autowala: 1.8, techie: 1.2 },
};
export const WEEKEND = { crowd: 1.1, kind: { family: 1.7, student: 0.8, office: 0.5 } }; // a seeded "Sunday" shift
export const DISH_BY_DAYPART = {
  morning: { idly: 2.2, dosa: 1.8, masala_dosa: 1.5, podi_dosa: 1.2, set_dosa: 1, pesarattu: 1.2, poori: 1.6, vada: 1.2, mysore_bonda: 0.4, mirchi_bajji: 0.3, irani_chai: 1.4, filter_coffee: 1.2, osmania: 0.6 },
  noon: { idly: 0.8, dosa: 1, masala_dosa: 1.2, podi_dosa: 0.9, set_dosa: 1.2, pesarattu: 1.3, poori: 1, vada: 0.9, mysore_bonda: 0.8, mirchi_bajji: 0.8, irani_chai: 1.2, filter_coffee: 1, osmania: 0.8 },
  evening: { idly: 0.3, dosa: 0.8, masala_dosa: 0.8, podi_dosa: 0.6, set_dosa: 0.6, pesarattu: 0.5, poori: 0.6, vada: 1.6, mysore_bonda: 2, mirchi_bajji: 2, irani_chai: 2.2, filter_coffee: 1.2, osmania: 1.4 },
  night: { idly: 0.4, dosa: 2, masala_dosa: 1.8, podi_dosa: 1.4, set_dosa: 1.5, pesarattu: 1, poori: 1.2, vada: 0.8, mysore_bonda: 0.5, mirchi_bajji: 0.7, irani_chai: 1.2, filter_coffee: 0.7, osmania: 0.4 },
};

// ---- What each level switches on. `stock` = the opening stock as a multiple of the level's expected demand (<1 = you must prep);
// `fresh` = opening batter freshness; `gas` = opening LPG units (0 = no cylinder to worry about); events = ids that WILL happen (seeded timing).
const OFF = Object.freeze({ stock: 0, fresh: 100, gas: 0, heat: false, market: false, events: Object.freeze([]), requests: false, regulars: 0, big: false });
export const LEVEL_OPS = {
  0: OFF,
  1: { stock: 1.7, fresh: 100, gas: 0, heat: false, market: false, events: [], requests: false, regulars: 0, big: false },
  2: { stock: 1.4, fresh: 96, gas: 0, heat: true, market: false, events: [], requests: true, regulars: 0, big: false },
  3: { stock: 1.1, fresh: 92, gas: 700, heat: true, market: false, events: ['rain'], requests: true, regulars: 0, big: false },
  4: { stock: 1.05, fresh: 90, gas: 500, heat: true, market: false, events: ['delivery'], requests: true, regulars: 2, big: false },
  5: { stock: 1, fresh: 85, gas: 420, heat: true, market: true, events: ['power', 'inspector'], requests: true, regulars: 2, big: false },
  6: { stock: 0.95, fresh: 82, gas: 420, heat: true, market: true, events: ['inspector'], requests: true, regulars: 3, big: true },
  7: { stock: 0.95, fresh: 82, gas: 420, heat: true, market: true, events: ['rain'], requests: true, regulars: 3, big: true },
  8: { stock: 0.9, fresh: 80, gas: 400, heat: true, market: true, events: ['rain', 'power'], requests: true, regulars: 3, big: true },
  9: { stock: 0.85, fresh: 80, gas: 400, heat: true, market: true, events: ['festival', 'inspector', 'delivery'], requests: true, regulars: 3, big: true },
  10: { stock: 0.8, fresh: 78, gas: 400, heat: true, market: true, events: ['cricket', 'inspector'], requests: true, regulars: 3, big: true },
  11: { stock: 0.8, fresh: 78, gas: 400, heat: true, market: true, events: ['cricket', 'power', 'delivery'], requests: true, regulars: 3, big: true },
  12: { stock: 0.7, fresh: 75, gas: 600, heat: true, market: true, events: ['rain', 'cricket', 'power', 'festival', 'inspector', 'delivery'], requests: true, regulars: 3, big: true },
};
export const levelOps = (n) => LEVEL_OPS[Math.max(0, Math.min(MAX_LEVEL, Math.trunc(Number(n)) || 0))];
