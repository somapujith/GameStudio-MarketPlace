// OWNER: quests agent. The missions, as DATA + plan builders. PURE (no three.js, no DOM): `def.plan(env)` returns a plan the engine
// (quest-engine.js) runs, or null when the mission cannot be offered right now (e.g. no metro train in range).
//
//   env = { city, route(from, to) -> [{x,z}], rng (makeRng), player: {x,z}, metro?: { stations, trains: [{x,z,speed,vx,vz,line}] } }
//
// Every timed waypoint is ON A ROAD (see quest-places.js). Telugu next to English where it fits.
import { makePath, waypointsAlong, pathAt, dateKey, dailyPick, dailyRng } from './quest-math.js';
import { frontOf, junctionSpots, nearestOrder, pathBetween, placeLabel, rampSites, roadSpot, snapToRoad, timeFor, AVG_SPEED } from './quest-places.js';

const GARAGE_FALLBACK = { x: 0, z: 0 };
const stopStep = (p, label, te, extra = {}) => ({ type: 'reach', x: p.x, z: p.z, r: 11, stop: true, dwell: 1, label, te, ...extra });
const pt = (p) => ({ x: p.x, z: p.z });

/** The nearest of the given poi ids (that exist) to `from`, as a place; null when none exist. */
function nearestPoi(env, ids, from = env.player) {
  let best = null;
  for (const id of ids) {
    const f = frontOf(env.city, id);
    if (!f) continue;
    const d = Math.hypot(f.x - from.x, f.z - from.z);
    if (!best || d < best.d) best = { ...f, d };
  }
  return best;
}

/** A drop-off road spot whose route from `from` is in [minLen, maxLen]; null after a few tries. */
function dropSpot(env, from, minLen, maxLen, opts = {}) {
  for (let i = 0; i < 24; i++) {
    const s = roadSpot(env.city, env.rng, from, { minD: minLen * 0.45, maxD: maxLen * 0.8, minLen: 36, ...opts });
    if (!s) continue;
    const path = pathBetween(env.route, from, s);
    if (path.length >= minLen && path.length <= maxLen) return { spot: s, path };
  }
  return null;
}

const base = (def, over) => ({
  id: def.id,
  defId: def.id,
  title: def.title,
  te: def.te,
  blurb: def.blurb,
  kind: def.kind,
  diff: def.diff,
  reward: { ...def.reward },
  timeLimit: null,
  rules: {},
  props: {},
  mult: 1,
  ...over,
});

// ---------------------------------------------------------------------------------------------------------------------------------
export const DEFS = [
  {
    id: 'biryani',
    title: 'Hot Biryani Run',
    te: 'వేడి బిర్యానీ డెలివరీ',
    blurb: 'Collect a biryani parcel from Paradise or Bawarchi and get it to the customer before it goes cold. Bumps cool it faster.',
    kind: 'delivery',
    diff: 2,
    reward: { cash: 320, rep: 40 },
    minRep: 0,
    plan(env) {
      const shop = nearestPoi(env, ['paradise_old', 'paradise', 'bawarchi_secbad', 'bawarchi_banjara']);
      if (!shop) return null;
      const d = dropSpot(env, shop, 380, 800);
      if (!d) return null;
      const toShop = pathBetween(env.route, env.player, shop).length;
      const limit = timeFor(toShop + d.path.length, 'medium', 1.12, 20);
      const legT = Math.max(30, limit - toShop / AVG_SPEED.medium);
      return base(this, {
        timeLimit: limit,
        rules: { meter: { id: 'heat', label: 'Heat', te: 'వేడి', start: 1, decay: 1 / (legT * 1.25), crash: 0.3, hit: 0.2, land: 0.08, jolt: 0.05, failAtZero: true, fromStep: 1 } },
        steps: [
          stopStep(shop, `Collect the biryani at ${shop.name}`, `${shop.te} లో బిర్యానీ తీసుకోండి`, { seat: false }),
          stopStep(d.spot, `Deliver it on ${placeLabel(env.city, d.spot)} before it goes cold`, 'చల్లారక ముందే డెలివరీ చేయండి', { r: 12, hint: 'Smooth driving keeps the parcel hot.' }),
        ],
      });
    },
  },
  {
    id: 'chai',
    title: 'Irani Chai Run',
    te: 'ఇరానీ చాయ్ రన్',
    blurb: 'Fill the flasks at Nimrah Irani Cafe and drop hot chai at three shops. Do not spill it.',
    kind: 'delivery',
    diff: 1,
    reward: { cash: 240, rep: 30 },
    minRep: 0,
    plan(env) {
      const cafe = frontOf(env.city, 'irani');
      if (!cafe) return null;
      const spots = junctionSpots(env.city, env.rng, cafe, 3, { minD: 90, maxD: 330, spacing: 90 });
      if (spots.length < 3) return null;
      const { order, length } = nearestOrder(cafe, spots);
      const toCafe = pathBetween(env.route, env.player, cafe).length;
      const limit = timeFor((toCafe + length) * 1.25, 'easy', 1.2, 25);
      return base(this, {
        timeLimit: limit,
        rules: { meter: { id: 'heat', label: 'Chai', te: 'చాయ్', start: 1, decay: 1 / (limit * 1.1), crash: 0.3, hit: 0.2, land: 0.08, jolt: 0.04, failAtZero: true, fromStep: 1 } },
        steps: [
          stopStep(cafe, 'Fill the flasks at Nimrah Irani Cafe', 'ఇరానీ కేఫ్ లో చాయ్ ఫ్లాస్కులు తీసుకోండి'),
          ...order.map((p, i) => stopStep(p, `Chai stop ${i + 1} of 3: ${placeLabel(env.city, snapToRoad(env.city, p.x, p.z))}`, `చాయ్ ${i + 1} / 3`, { r: 12, dwell: 0.8 })),
        ],
      });
    },
  },
  {
    id: 'baraat',
    title: 'Baraat Escort',
    te: 'బారాత్ ఎస్కార్ట్',
    blurb: 'A wedding procession walks to the venue. Crawl behind the dhol and the horse, do not overtake, do not lose it.',
    kind: 'escort',
    diff: 2,
    reward: { cash: 360, rep: 50 },
    minRep: 0,
    plan(env) {
      const mecca = frontOf(env.city, 'mecca') || frontOf(env.city, 'charminar') || env.player;
      for (let i = 0; i < 20; i++) {
        const start = roadSpot(env.city, env.rng, mecca, { minD: 20, maxD: 260, minLen: 30 });
        if (!start) continue;
        const d = dropSpot(env, start, 300, 460);
        if (!d) continue;
        const path = d.path;
        return base(this, {
          timeLimit: null,
          rules: { cleanBonus: true },
          props: { convoy: true },
          steps: [
            { type: 'reach', x: start.x, z: start.z, r: 18, maxSpeed: 9, label: `Join the baraat at the shaadi mahal on ${placeLabel(env.city, start)}`, te: 'పెళ్లి ఊరేగింపుతో చేరండి' },
            { type: 'escort', path, speed: 3.2, len: 12, pauses: [0.3, 0.64], pauseTime: 4.5, label: 'Follow the baraat to the venue, slowly', te: 'బారాత్ వెనకే నెమ్మదిగా వెళ్ళండి', hint: 'Stay behind. Honk along with the dhol.' },
          ],
          start: pt(start),
        });
      }
      return null;
    },
  },
  {
    id: 'airport',
    title: 'Airport Rush',
    te: 'ఎయిర్‌పోర్ట్ రష్',
    blurb: 'A passenger is about to miss a flight. Pick them up and race across the city to the airport.',
    kind: 'timed',
    diff: 3,
    reward: { cash: 720, rep: 90 },
    minRep: 100,
    plan(env) {
      const air = frontOf(env.city, 'airport');
      if (!air) return null;
      let best = null;
      for (const id of ['station', 'cyber', 'stadium', 'charminar', 'birla']) {
        const f = frontOf(env.city, id);
        if (!f) continue;
        const toPickup = pathBetween(env.route, env.player, f).length;
        const run = pathBetween(env.route, f, air);
        if (run.length < 800 || toPickup > 1800) continue;
        const score = Math.abs(run.length - 1200) + toPickup * 0.3;
        if (!best || score < best.score) best = { f, run, score, toPickup };
      }
      if (!best) return null;
      const legLimit = timeFor(best.run.length, 'hard', 1.0, 18);
      return base(this, {
        timeLimit: null,
        steps: [
          stopStep(best.f, `Pick up the passenger at ${best.f.name}`, `${best.f.te} లో ప్రయాణికుడిని ఎక్కించుకోండి`, { seat: true }),
          { type: 'reach', x: air.x, z: air.z, r: 20, label: 'Reach the airport before the gate closes', te: 'గేట్ మూసేలోపు ఎయిర్‌పోర్ట్ చేరండి', timeLimit: legLimit, hint: 'Hold boost on the straights.' },
        ],
      });
    },
  },
  {
    id: 'tourist',
    title: 'Tourist Trail',
    te: 'టూరిస్ట్ ట్రైల్',
    blurb: 'A visitor from Delhi wants Charminar, Mecca Masjid and Birla Mandir. Stop at each for a photo. A smooth ride earns a bigger tip.',
    kind: 'tour',
    diff: 1,
    reward: { cash: 420, rep: 45 },
    minRep: 0,
    plan(env) {
      const irani = frontOf(env.city, 'irani');
      const stops = ['charminar', 'mecca', 'birla'].map((id) => frontOf(env.city, id));
      if (!irani || stops.some((s) => !s)) return null;
      return base(this, {
        rules: { meter: { id: 'mood', label: 'Tourist mood', te: 'టూరిస్ట్ మూడ్', start: 1, decay: 0, crash: 0.3, hit: 0.2, land: 0.1, failAtZero: false } },
        steps: [
          stopStep(irani, 'Pick up the tourist at Nimrah Irani Cafe', 'ఇరానీ కేఫ్ లో టూరిస్ట్ ను ఎక్కించుకోండి', { seat: true }),
          ...stops.map((s, i) => stopStep(s, `Photo stop ${i + 1} of 3: ${s.name}`, `ఫోటో స్టాప్ ${i + 1} / 3: ${s.te}`, { r: 16, dwell: 3.5, hint: 'Stop and wait for the photo.' })),
        ],
      });
    },
  },
  {
    id: 'race',
    title: 'Street Race',
    te: 'స్ట్రీట్ రేస్',
    blurb: 'A rival auto challenges you at the start line. Hit every gate on the road and cross the finish first.',
    kind: 'race',
    diff: 3,
    reward: { cash: 520, rep: 70 },
    minRep: 40,
    plan(env) {
      for (let i = 0; i < 20; i++) {
        const start = roadSpot(env.city, env.rng, env.player, { minD: 40, maxD: 200, minLen: 30 });
        if (!start) continue;
        const d = dropSpot(env, start, 650, 1000, { minLen: 40 });
        if (!d) continue;
        const path = d.path;
        const cps = waypointsAlong(path, 5, { from: 0.2, to: 1 }).map((c, k, a) => ({ x: c.x, z: c.z, s: c.s, r: k === a.length - 1 ? 18 : 15 }));
        return base(this, {
          props: { rival: { color: '#37e6ff' } },
          steps: [
            { type: 'reach', x: start.x, z: start.z, r: 14, maxSpeed: 9, label: `Roll up to the start line on ${placeLabel(env.city, start)}`, te: 'స్టార్ట్ లైన్ దగ్గరకు రండి' },
            { type: 'race', path, cps, rivalSpeed: 12.6, countdown: 3.5, label: 'Beat the rival through every gate', te: 'ప్రతి గేట్ దాటి రైవల్ ను ఓడించండి', hint: 'Gates sit on the road. Drift the corners.' },
          ],
          start: pt(start),
        });
      }
      return null;
    },
  },
  {
    id: 'stunts',
    title: 'Stunt Show',
    te: 'స్టంట్ షో',
    blurb: 'Three kicker ramps are set up on the streets. Hit them fast and stay in the air. Longer air time pays more.',
    kind: 'stunt',
    diff: 2,
    reward: { cash: 380, rep: 55 },
    minRep: 20,
    plan(env) {
      const sites = rampSites(env.city, env.rng, env.player, 3);
      if (sites.length < 3) return null;
      const RAMP = { len: 16, w: 6, rise: 2.4 };
      const ramps = sites.map((s) => ({
        x: s.x, z: s.z, dx: s.dx, dz: s.dz, ...RAMP,
        runX: s.x - s.dx * (RAMP.len / 2 + 24), runZ: s.z - s.dz * (RAMP.len / 2 + 24),
      }));
      const { length } = nearestOrder(env.player, ramps.map((r) => ({ x: r.runX, z: r.runZ })));
      return base(this, {
        timeLimit: Math.round(Math.max(150, (length * 2) / AVG_SPEED.medium + 90) / 5) * 5,
        props: { ramps },
        steps: [{ type: 'jumps', count: 3, minAir: 0.35, marks: ramps.map((r) => ({ x: r.runX, z: r.runZ })), label: 'Land 3 stunt jumps', te: '3 స్టంట్ జంప్స్ చేయండి', hint: 'Line up at the glowing marker, then boost up the ramp.' }],
      });
    },
  },
  {
    id: 'cows',
    title: 'Cows on the Road',
    te: 'రోడ్డుపై ఆవులు',
    blurb: 'Take milk cans to four stops through a street where cows are standing. Weave around them. Touch one and the run is over.',
    kind: 'careful',
    diff: 2,
    reward: { cash: 300, rep: 40 },
    minRep: 0,
    plan(env) {
      const from = nearestPoi(env, ['garage'], env.player) || env.player;
      const d = dropSpot(env, from, 600, 950);
      if (!d) return null;
      const path = d.path;
      const cps = waypointsAlong(path, 4, { from: 0.25, to: 1 });
      const cows = [];
      const P = { x: 0, z: 0, tx: 0, tz: 1 };
      for (const f of [0.1, 0.17, 0.37, 0.43, 0.62, 0.68, 0.88]) {
        pathAt(path, path.length * f, P);
        const side = env.rng.sign();
        cows.push({ x: P.x - P.tz * side * 1.3, z: P.z + P.tx * side * 1.3, h: Math.atan2(P.tx, P.tz) + (env.rng() < 0.5 ? 0 : Math.PI) + 1.57 });
      }
      return base(this, {
        timeLimit: timeFor(path.length, 'easy', 1.3, 30),
        rules: { noHit: ['cow', 'ped'] },
        props: { cows },
        steps: [{ type: 'collect', points: cps.map(pt), r: 13, marker: 'ring', label: 'Drop the milk cans at all 4 stops, no cow touched', te: '4 చోట్ల పాల డబ్బాలు ఇవ్వండి, ఆవును తాకకండి', hint: 'Cows stand in the road. Slow down and go around.' }],
        start: pt(d.spot),
      });
    },
  },
  {
    id: 'kites',
    title: 'Kite Catcher',
    te: 'గాలిపటాల వేట',
    blurb: 'Sankranti kites are drifting down over the streets. Drive under all seven before the time is up.',
    kind: 'collect',
    diff: 1,
    reward: { cash: 280, rep: 35 },
    minRep: 0,
    plan(env) {
      const spots = junctionSpots(env.city, env.rng, env.player, 7, { minD: 50, maxD: 340, spacing: 62 });
      if (spots.length < 6) return null;
      const { order, length } = nearestOrder(env.player, spots);
      return base(this, {
        timeLimit: timeFor(length * 1.3, 'medium', 1.15, 20),
        steps: [{ type: 'collect', points: order.map(pt), r: 11, marker: 'kite', label: `Catch all ${order.length} kites`, te: `${order.length} గాలిపటాలను పట్టుకోండి`, hint: 'Drive right under a falling kite.' }],
      });
    },
  },
  {
    id: 'hospital',
    title: 'Hospital Emergency',
    te: 'హాస్పిటల్ ఎమర్జెన్సీ',
    blurb: 'Someone needs a doctor now. Pick up the patient and reach Care Hospital before time runs out.',
    kind: 'timed',
    diff: 3,
    reward: { cash: 520, rep: 75 },
    minRep: 40,
    plan(env) {
      const hosp = frontOf(env.city, 'hospital');
      if (!hosp) return null;
      for (let i = 0; i < 12; i++) {
        const patient = roadSpot(env.city, env.rng, hosp, { minD: 250, maxD: 520, minLen: 40 });
        if (!patient) continue;
        const run = pathBetween(env.route, patient, hosp);
        if (run.length < 300 || run.length > 760) continue;
        return base(this, {
          steps: [
            stopStep(patient, `Pick up the patient on ${placeLabel(env.city, patient)}`, 'పేషెంట్ ను ఎక్కించుకోండి', { seat: true, dwell: 0.8 }),
            { type: 'reach', x: hosp.x, z: hosp.z, r: 16, label: 'Get to Care Hospital. Every second counts', te: 'కేర్ హాస్పిటల్ కు త్వరగా చేరండి', timeLimit: timeFor(run.length, 'hard', 1.0, 10), hint: 'Honk. Cut through. Go.' },
          ],
        });
      }
      return null;
    },
  },
  {
    id: 'metro',
    title: 'Metro Rush',
    te: 'మెట్రో రష్',
    blurb: 'A commuter has to catch the next Metro. Beat the train to its station and get them on the platform.',
    kind: 'timed',
    diff: 3,
    reward: { cash: 480, rep: 60 },
    minRep: 60,
    plan(env) {
      const pick = pickTrainRace(env);
      if (!pick) return null;
      const { station, trainIdx, line } = pick;
      return base(this, {
        steps: [
          {
            type: 'trainRace', trainIdx, station: pt(station), x: station.front.x, z: station.front.z, r: 16, arriveR: 26,
            label: `Beat the ${line} Line train to ${station.name} station`, te: `${station.name} స్టేషన్ కు మెట్రో కన్నా ముందు చేరండి`, hint: 'Follow the viaduct. The train will not wait.', seat: false,
          },
        ],
      });
    },
  },
];

export const DEF_BY_ID = Object.fromEntries(DEFS.map((d) => [d.id, d]));

/** Ids that can be the "daily job". */
export const DAILY_POOL = ['biryani', 'chai', 'tourist', 'hospital', 'kites', 'cows', 'stunts', 'race', 'baraat'];

/**
 * Pick a train and a station it is approaching that the player can beat: the train is `dTrain` m away, the player's road route is
 * `len` m long. Both must fit: the player needs ~30..85 % of the train's time (about 14 m/s average with the stops).
 * `env.metro = { stations: [{id,name,line,x,z,front}], trains: [{x,z,speed,vx,vz,line}] }`.
 */
export function pickTrainRace(env, { minD = 300, maxD = 1100, ratioLo = 0.3, ratioHi = 0.85 } = {}) {
  const m = env.metro;
  if (!m?.trains?.length || !m.stations?.length) return null;
  let best = null;
  m.trains.forEach((t, trainIdx) => {
    const sp = Math.hypot(t.vx || 0, t.vz || 0);
    if (!(t.speed > 1) || sp < 0.5) return;
    for (const st of m.stations) {
      if (st.line !== t.line || !st.front) continue;
      const dx = st.x - t.x;
      const dz = st.z - t.z;
      const d = Math.hypot(dx, dz);
      if (d < minD || d > maxD) continue;
      if ((dx * t.vx + dz * t.vz) / (d * sp) < 0.55) continue; // not heading its way
      const len = pathBetween(env.route, env.player, st.front).length;
      const ratio = (len / 13) / (d / 14);
      if (ratio < ratioLo || ratio > ratioHi) continue;
      const score = Math.abs(ratio - 0.62);
      if (!best || score < best.score) best = { station: st, trainIdx, line: st.line[0].toUpperCase() + st.line.slice(1), score, len };
    }
  });
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------------------
/** "Mama's First Day": the tutorial. Six steps: drive, horn, pick up, drop off, pause, workshop. */
export function tutorialPlan(env) {
  const garage = frontOf(env.city, 'garage') || { ...GARAGE_FALLBACK, name: "Mama's Garage", te: 'మామా గ్యారేజ్' };
  const pick = roadSpot(env.city, env.rng, garage, { minD: 70, maxD: 150, minLen: 30 });
  if (!pick) return null;
  const drop = dropSpot(env, pick, 200, 420);
  if (!drop) return null;
  return {
    id: 'tutorial', defId: 'tutorial', title: "Mama's First Day", te: 'మామా మొదటి రోజు', blurb: 'Learn the job in six steps.', kind: 'tutorial', diff: 1,
    reward: { cash: 150, rep: 25 }, timeLimit: null, rules: { cleanBonus: false }, props: {}, mult: 1, tutorial: true,
    steps: [
      { type: 'drive', metres: 40, label: 'Drive. W or the up arrow to go, A and D to steer', te: 'నడపండి. W / పైకి బాణం, A / D తిప్పడానికి', key: 'W' },
      { type: 'event', event: 'honk', label: 'Honk the horn. Press H', te: 'హార్న్ కొట్టండి. H నొక్కండి', key: 'H' },
      stopStep(pick, 'Pick up the customer at the pink marker. Stop inside it', 'పింక్ మార్కర్ దగ్గర కస్టమర్ ను ఎక్కించుకోండి', { r: 12, seat: true, tutorialPax: true, key: 'E' }),
      stopStep(drop.spot, 'Drop them at the next marker to get paid', 'తర్వాతి మార్కర్ దగ్గర దించండి', { r: 12 }),
      { type: 'event', event: 'menu', match: { name: 'pause' }, label: 'Press Esc to pause, then Esc again to resume', te: 'Esc నొక్కి పాజ్ చేయండి, మళ్ళీ Esc తో కొనసాగండి', key: 'Esc' },
      { type: 'event', event: 'workshop:enter', at: { x: garage.x, z: garage.z, r: 10 }, label: "Drive to Mama's Garage and press E to open the workshop", te: 'మామా గ్యారేజ్ కు వెళ్లి E నొక్కండి', key: 'E' },
    ],
  };
}

/** The tutorial played again: same steps, no pay and no reputation (the first run paid them; replaying must not be a money farm). */
export function replayOf(plan) {
  return { ...plan, reward: { cash: 0, rep: 0 }, replay: true };
}

/** The daily job for a date: the same on every device that day. Returns { defId, plan } (plan may be null), or null. */
export function dailyJob(env, key = dateKey()) {
  const id = dailyPick(key, DAILY_POOL);
  const def = DEF_BY_ID[id];
  if (!def) return null;
  const plan = def.plan({ ...env, rng: dailyRng(key) });
  if (!plan) return { defId: id, plan: null };
  plan.id = 'daily';
  plan.defId = id;
  plan.daily = true;
  plan.dailyKey = key;
  plan.mult = 1.5;
  plan.title = `Daily: ${def.title}`;
  return { defId: id, plan };
}

export { makePath };
