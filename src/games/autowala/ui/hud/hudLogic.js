// Pure helpers behind the Autowala HUD (clock, gauges, trip panel, speed effects). No React, no DOM: unit-tested in hudLogic.test.js.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, d = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

// ---- clock ---------------------------------------------------------------------------------------------------------------
/** Game hour (0..24, fractional) -> 12-hour clock parts. 0 -> 12:00 AM, 12 -> 12:00 PM, 23.99 -> 11:59 PM, 24 wraps to 12:00 AM. */
export function formatClock(hour) {
  let h = finite(hour, 0) % 24;
  if (h < 0) h += 24;
  const total = Math.min(24 * 60 - 1, Math.floor(h * 60 + 1e-6)); // never rounds up into the next hour
  const hh = Math.floor(total / 60);
  const minutes = total % 60;
  const ampm = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const mm = String(minutes).padStart(2, '0');
  return { h12, minutes, mm, ampm, time: `${h12}:${mm}`, label: `${h12}:${mm} ${ampm}` };
}

/** 'night' | 'dawn' | 'day' | 'dusk' for the clock icon (matches the sky: sunrise ~6, sunset ~18.5). */
export function dayPhase(hour) {
  let h = finite(hour, 12) % 24;
  if (h < 0) h += 24;
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 17) return 'day';
  if (h >= 17 && h < 19.5) return 'dusk';
  return 'night';
}

// ---- gauges --------------------------------------------------------------------------------------------------------------
export const GAUGE_MAX_KMH = 120;
/** 0..1 position of the needle on the dial. */
export const speedFraction = (kmh, max = GAUGE_MAX_KMH) => clamp(finite(kmh) / max, 0, 1);

/**
 * Fuel gauge colouring. frac = fuel / tank (0..1).
 *   empty  <= 2%        low  < 15% (pulses)       warn < 35%         ok otherwise
 */
export function fuelTone(frac) {
  const f = clamp(finite(frac, 1), 0, 1);
  if (f <= 0.02) return { tone: 'empty', color: '#ff4d5e', pulse: true, label: 'EMPTY' };
  if (f < 0.15) return { tone: 'low', color: '#ff4d5e', pulse: true, label: 'LOW CNG' };
  if (f < 0.35) return { tone: 'warn', color: '#ffc857', pulse: false, label: '' };
  return { tone: 'ok', color: '#a6ff3d', pulse: false, label: '' };
}

/** How many of `segments` fuel cells are lit (always at least 1 while there is any fuel left). */
export function fuelSegments(frac, segments = 10) {
  const f = clamp(finite(frac), 0, 1);
  if (f <= 0.005) return 0;
  return clamp(Math.ceil(f * segments - 1e-6), 1, segments);
}

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Strength 0..1 of the screen-edge speed effects. Vignette starts mid-speed, lines later; boosting adds a floor to both. */
export function speedFx(kmh, boosting = false) {
  const k = Math.max(0, finite(kmh));
  const vignette = clamp(smooth(25, 110, k) * 0.85 + (boosting ? 0.25 : 0), 0, 1);
  const lines = clamp(smooth(50, 115, k) * 0.9 + (boosting ? 0.35 : 0), 0, 1);
  return { vignette, lines };
}

// ---- numbers ---------------------------------------------------------------------------------------------------------------
/** 1234567 -> '12,34,567' (Indian grouping). Negative and non-finite are handled. */
export function groupIndian(n) {
  const v = Math.round(finite(n));
  const sign = v < 0 ? '-' : '';
  const s = String(Math.abs(v));
  if (s.length <= 3) return sign + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${rest},${last3}`;
}
export const formatRupees = (n) => `Rs ${groupIndian(n)}`;

/** 38 -> '40 m', 420 -> '420 m', 1480 -> '1.5 km', 12000 -> '12 km'. */
export function formatDistance(m) {
  const v = Math.max(0, finite(m));
  if (v < 100) return `${Math.round(v / 10) * 10 || (v > 0 ? 10 : 0)} m`;
  if (v < 1000) return `${Math.round(v / 10) * 10} m`;
  const km = v / 1000;
  return `${km >= 10 ? Math.round(km) : (Math.round(km * 10) / 10).toFixed(1)} km`;
}

/** Seconds -> '< 1 min', '4 min', '1 h 05'. */
export function formatEta(s) {
  const v = Math.max(0, finite(s));
  if (v < 45) return '< 1 min';
  const mins = Math.round(v / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}`;
}

/** Seconds -> '0:42'. */
export function formatCountdown(s) {
  const v = Math.max(0, Math.ceil(finite(s)));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

/** One step of an exponential count-up toward `target` (frame-rate independent); snaps when close. */
export function easeCount(current, target, dt, rate = 9) {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return finite(target);
  const diff = target - current;
  if (Math.abs(diff) < 0.5) return target;
  return current + diff * (1 - Math.exp(-rate * Math.max(0, dt)));
}

// ---- trip panel ------------------------------------------------------------------------------------------------------------
const KIND_LABELS = {
  student: 'Student', office: 'Office goer', worker: 'Office goer', tourist: 'Tourist', family: 'Family', shopper: 'Shopper',
  elder: 'Senior', senior: 'Senior', pilgrim: 'Pilgrim', foodie: 'Foodie', commuter: 'Commuter', doctor: 'Doctor', patient: 'Patient',
  vip: 'VIP', airport: 'Airport run', night: 'Night owl', cricket: 'Cricket fan', techie: 'Techie', traveller: 'Traveller', traveler: 'Traveller',
};
/** A customer kind -> { key, label } (key picks the icon; unknown kinds get a generic one and a capitalised label). */
export function kindInfo(kind) {
  const raw = String(kind ?? '').trim().toLowerCase();
  if (!raw) return { key: 'generic', label: 'Passenger' };
  const label = KIND_LABELS[raw] || raw.charAt(0).toUpperCase() + raw.slice(1).replace(/[-_]+/g, ' ');
  return { key: KIND_LABELS[raw] ? raw : 'generic', label: label.slice(0, 22) };
}

/** 'left' | 'right' | 'straight' | 'uturn' | 'arrive' | null from whatever the route agent publishes (string, object or signed angle). */
export function turnDirection(t) {
  if (t == null) return null;
  if (typeof t === 'object') return turnDirection(t.dir ?? t.type ?? t.turn ?? t.direction ?? t.kind ?? null);
  if (typeof t === 'number') {
    if (!Number.isFinite(t)) return null;
    const a = Math.abs(t);
    if (a < 0.35) return 'straight';
    if (a > 2.6) return 'uturn';
    return t > 0 ? 'right' : 'left';
  }
  const s = String(t).toLowerCase();
  if (/arriv|destination|dest|end/.test(s)) return 'arrive';
  if (/u-?turn|around|back/.test(s)) return 'uturn';
  if (/left/.test(s)) return 'left';
  if (/right/.test(s)) return 'right';
  if (/straight|ahead|continue|forward|none/.test(s)) return 'straight';
  return null;
}

const TURN_TEXT = { left: 'Turn left', right: 'Turn right', straight: 'Straight on', uturn: 'U-turn', arrive: 'Arriving' };
export const turnText = (dir) => TURN_TEXT[dir] || '';

/**
 * Everything the trip panel prints, from the optional `snap.trip` and `snap.route`. Missing pieces stay null; never throws.
 * Returns null when there is no trip.
 */
export function normalizeTrip(trip, route) {
  if (!trip || typeof trip !== 'object') return null;
  const r = route && typeof route === 'object' ? route : {};
  const dest = trip.dest && typeof trip.dest === 'object' ? trip.dest : {};
  const cust = trip.customer && typeof trip.customer === 'object' ? trip.customer : {};
  const name = String(trip.name ?? cust.name ?? 'Passenger').slice(0, 40);
  const te = String(trip.te ?? trip.nameTe ?? cust.te ?? '').slice(0, 40);
  const routeLen = Number(r.length);
  const tripLeft = Number(trip.distanceLeft);
  const distance = Number.isFinite(routeLen) && routeLen >= 0 ? routeLen : Number.isFinite(tripLeft) ? Math.max(0, tripLeft) : null;
  const eta = Number.isFinite(Number(r.eta)) && r.eta !== null && Number(r.eta) >= 0 ? Number(r.eta) : null;
  const moodRaw = trip.mood ?? trip.patience ?? trip.happiness ?? trip.satisfaction;
  const timeLeft = trip.timeLeft == null || !Number.isFinite(Number(trip.timeLeft)) ? null : Math.max(0, Number(trip.timeLeft));
  const timeTotal = Number(trip.timeTotal ?? trip.timeLimit);
  const dir = turnDirection(r.nextTurn);
  const turnDist = Number(r.turnDistance);
  return {
    name,
    te,
    kind: kindInfo(trip.kind ?? cust.kind),
    destName: String(dest.name ?? trip.destName ?? 'Destination').slice(0, 44),
    destTe: String(dest.te ?? trip.destTe ?? '').slice(0, 44),
    fare: Math.max(0, Math.round(finite(trip.fareNow ?? trip.fare, finite(trip.fareEstimate)))),
    fareEstimate: Number.isFinite(Number(trip.fareEstimate)) ? Math.round(Number(trip.fareEstimate)) : null,
    distance,
    eta,
    mood: moodRaw == null || !Number.isFinite(Number(moodRaw)) ? null : clamp(Number(moodRaw), 0, 1),
    timeLeft,
    timeFrac: timeLeft != null && Number.isFinite(timeTotal) && timeTotal > 0 ? clamp(timeLeft / timeTotal, 0, 1) : null,
    arrived: trip.status === 'arrived',
    pax: clamp(Math.round(finite(trip.pax, 1)), 1, 2),
    turn: dir ? { dir, text: turnText(dir), distance: Number.isFinite(turnDist) && turnDist >= 0 ? turnDist : null } : null,
  };
}

/** Mood bar colour: green when happy, gold in the middle, red when about to bail. */
export function moodColor(m) {
  if (m == null) return '#a6ff3d';
  if (m < 0.25) return '#ff4d5e';
  if (m < 0.55) return '#ffc857';
  return '#a6ff3d';
}

/** Countdown urgency for `timeLeft`. */
export const timerTone = (s) => (s == null ? 'calm' : s <= 10 ? 'urgent' : s <= 25 ? 'warn' : 'calm');

// ---- road rage / crashes ---------------------------------------------------------------------------------------------------
/** snap.rage -> clean 0..1 numbers for the meter, or null while it is inactive / absent. `danger` = about to be caught. */
export function rageView(rage) {
  if (!rage || typeof rage !== 'object' || !rage.active) return null;
  const caught = clamp(finite(rage.caughtIn), 0, 1);
  return {
    heat: clamp(finite(rage.heat), 0, 1),
    escape: clamp(finite(rage.escape), 0, 1),
    caught,
    chasers: Math.max(0, Math.round(finite(rage.chasers))),
    danger: caught > 0.5,
  };
}

/** Crash tags that are only a scrape against the road edge: no red flash for them. */
const SOFT_TAGS = new Set(['kerb', 'curb', 'lake', 'water']);
/** A `crash` event -> { soft, strength 0.25..1 } for the screen flash. Real crashes (building, landmark, traffic...) flash red. */
export function crashFlash(e) {
  const tag = String((e && e.tag) || '').toLowerCase();
  const raw = Number(e && e.strength);
  const strength = clamp(Number.isFinite(raw) ? raw : 0.4, 0.25, 1);
  // `guard: true` = the auto brushed a guardrail (building wall, tree, lamp post, lake edge): never a wreck
  return { soft: SOFT_TAGS.has(tag) || !!(e && e.guard), strength };
}

// ---- prompt ----------------------------------------------------------------------------------------------------------------
const PROMPT_ACTION = { e: 'interact', t: 'talk', h: 'horn', q: 'quests' };
/** The input action a prompt's key triggers when tapped on a touch screen (null when it cannot be tapped). */
export const promptAction = (key) => PROMPT_ACTION[String(key ?? 'E').toLowerCase()] || null;

/** Drift flair: ring fill 0..1 and a combo tier label. */
export function driftTier(charge) {
  const c = clamp(finite(charge), 0, 1);
  if (c >= 0.99) return { c, tier: 3, label: 'MAX' };
  if (c >= 0.66) return { c, tier: 2, label: 'GREAT' };
  if (c >= 0.33) return { c, tier: 1, label: 'NICE' };
  return { c, tier: 0, label: '' };
}

// ---- rules: speed limit, signals, cameras, police checks (snap.rules) --------------------------------------------------------
const ZONE_LABEL = { school: { en: 'School zone', te: 'స్కూల్ జోన్' }, city: { en: 'City', te: 'నగరం' }, fast: { en: 'Fast road', te: 'హైవే' } };
const SIGNAL_TEXT = { red: { en: 'STOP', te: 'ఆగు' }, yellow: { en: 'SLOW', te: 'నెమ్మది' }, green: { en: 'GO', te: 'వెళ్ళు' } };
/** A signal further away than this (m) is not worth a HUD chip. */
export const SIGNAL_SHOW_M = 140;

/** snap.rules -> everything the rules widgets print. Pieces that are absent stay null; returns null without `rules`. Never throws. */
export function rulesView(rules, kmh = 0) {
  if (!rules || typeof rules !== 'object') return null;
  const limit = Math.round(finite(rules.limit, 0));
  const zone = ZONE_LABEL[rules.zone] ? rules.zone : 'city';
  const speed = Math.max(0, finite(kmh));
  const sa = rules.signalAhead && typeof rules.signalAhead === 'object' ? rules.signalAhead : null;
  const ca = rules.cameraAhead && typeof rules.cameraAhead === 'object' ? rules.cameraAhead : null;
  const cp = rules.checkpoint && typeof rules.checkpoint === 'object' ? rules.checkpoint : null;
  const sigDist = sa ? Math.max(0, Math.round(finite(sa.dist, 1e9))) : 0;
  const state = sa && SIGNAL_TEXT[sa.state] ? sa.state : null;
  const camLimit = ca ? Math.round(finite(ca.limit, limit)) : 0;
  const camDist = ca ? Math.max(0, Math.round(finite(ca.dist, 0))) : 0;
  return {
    sign: limit > 0 ? { limit, zone, zoneEn: ZONE_LABEL[zone].en, zoneTe: ZONE_LABEL[zone].te, speeding: !!rules.speeding } : null,
    signal: state && sigDist <= SIGNAL_SHOW_M
      ? { state, dist: sigDist, secs: Math.max(0, Math.ceil(finite(sa.left))), watched: !!sa.watched, en: SIGNAL_TEXT[state].en, te: SIGNAL_TEXT[state].te }
      : null,
    // the camera only matters while you are above its limit (plus the 5 km/h tolerance the rules agent uses)
    camera: ca ? { dist: camDist, limit: camLimit, over: camLimit > 0 && speed > camLimit + 5 } : null,
    checkpoint: cp && ['near', 'stopped', 'checking'].includes(cp.phase)
      ? {
        phase: cp.phase, dist: Math.max(0, Math.round(finite(cp.dist))),
        en: cp.phase === 'checking' ? 'Checking papers' : cp.phase === 'stopped' ? 'Hold still' : 'Police check ahead',
        te: cp.phase === 'checking' ? 'తనిఖీ జరుగుతోంది' : 'పోలీసు తనిఖీ',
      }
      : null,
    wanted: !!rules.wanted,
    heat: clamp(finite(rules.heat), 0, 1),
    fines: Math.max(0, Math.round(finite(rules.fines))),
  };
}

// ---- career: dents, tiredness, chai, today, rent, demand (snap.career) ------------------------------------------------------
/** Peak-hour demand -> the FARE multiplier the customers actually pay (same rule as gameplay/fare-modifiers.js): min(1.3, 1 + (d - 1) * 0.4). */
export function fareMultiplier(demand) {
  const d = typeof demand === 'number' ? demand : finite(demand && demand.mult, 1);
  return Math.min(1.3, 1 + (finite(d, 1) - 1) * 0.4);
}

const barTone = (f) => (f >= 0.85 ? 'bad' : f >= 0.55 ? 'warn' : 'ok');

/** snap.career -> the compact job chip's numbers (null without career). The fare multiplier is shown only from x1.05 up: a lull never discounts. */
export function careerView(c) {
  if (!c || typeof c !== 'object') return null;
  const fatigue = clamp(finite(c.fatigue), 0, 1);
  const damage = clamp(finite(c.damage), 0, 1);
  const d = c.demand && typeof c.demand === 'object' ? c.demand : {};
  const mult = fareMultiplier(d);
  const cooldown = Math.max(0, Math.ceil(finite(c.chai && c.chai.cooldown)));
  return {
    damage: { pct: Math.round(damage * 100), tone: barTone(damage * 1.2), repair: Math.max(0, Math.round(finite(c.repairCost))), show: damage >= 0.02 },
    fatigue: { pct: Math.round(fatigue * 100), tone: barTone(fatigue), name: (c.fatigueName && c.fatigueName.en) || '', te: (c.fatigueName && c.fatigueName.te) || '' },
    chai: { price: Math.round(finite(c.chai && c.chai.price)), cooldown, canBuy: !!(c.chai && c.chai.canBuy), urgent: fatigue >= 0.7 },
    demand: { label: String(d.label || ''), te: String(d.te || ''), mult: Math.round(mult * 100) / 100, show: mult >= 1.05, peak: !!d.peak },
    earned: Math.max(0, Math.round(finite(c.today && c.today.earned))),
    rent: { due: Math.max(0, Math.round(finite(c.rent && c.rent.due))), owned: !!(c.rent && c.rent.owned), debt: Math.max(0, Math.round(finite(c.rent && c.rent.debt))) },
  };
}

// ---- weather (snap.weather) ---------------------------------------------------------------------------------------------------
const WEATHER_LABEL = { rain: { en: 'Rain', te: 'వర్షం' }, storm: { en: 'Storm', te: 'తుఫాను' } };
/** snap.weather -> { state, en, te, wet 0..1, wetPct, rain } for the clock block, or null when it is not raining and the rider is dry (cloud alone is not worth a chip). */
export function weatherView(w) {
  if (!w || typeof w !== 'object') return null;
  const label = WEATHER_LABEL[w.state];
  const wet = clamp(finite(w.wet), 0, 1);
  if (!label && wet < 0.05) return null;
  const st = label ? w.state : 'clear';
  const l = label || { en: 'Drying off', te: 'ఆరుతోంది' };
  return { state: st, en: l.en, te: l.te, wet, wetPct: Math.round(wet * 100), rain: clamp(finite(w.rain), 0, 1), showName: st === 'rain' || st === 'storm' };
}
