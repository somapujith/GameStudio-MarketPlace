// Things that change what a ride is worth: night charge, luggage, rain, peak demand, and an urgent passenger (a hospital, a train).
// Pure. Callers pass the hour, the weather and the career's demand; nothing here reads ctx.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const MOD = {
  nightFrom: 22, // after 22:00 ...
  nightTo: 5, // ... until 05:00
  night: 1.25,
  rain: 1.15,
  rainLevel: 0.35, // ctx.weather.rain above this counts as raining when `raining` is not given
  luggageFlat: 20, // rupees
  peakShare: 0.4, // the career's demand (0.2..1.7 customers) only moves the fare this far: fare mult = 1 + (demand - 1) * peakShare
  peakMin: 1.04, // below this effective multiplier there is no peak charge
  peakMax: 1.3,
  totalMax: 2.0, // multipliers never stack past this
  urgentBase: 0.15, // bonus on an on-time urgent ride: this + urgentSpare * (fraction of the time left)
  urgentSpare: 0.25,
};

export const isNight = (hour) => Number.isFinite(hour) && (hour >= MOD.nightFrom || hour < MOD.nightTo);

/**
 * A career `demand(hour)` / `peak()` result -> { mult (the FARE multiplier), label, te } or null. Accepts a bare number or an object with
 * `mult` (the demand, 1 = an ordinary hour). A lull never discounts: only demand above 1 raises fares, and only part of the way.
 */
export function normalizeDemand(d) {
  if (d == null) return null;
  if (typeof d === 'object' && d.peak === false) return null; // the career says this band is not a peak: no surcharge chip named "Early morning"
  const demand = typeof d === 'number' ? d : Number(d.mult ?? d.multiplier ?? d.mul);
  if (!Number.isFinite(demand)) return null;
  const mult = 1 + (demand - 1) * MOD.peakShare;
  if (mult < MOD.peakMin) return null;
  const label = typeof d === 'object' && d.label ? String(d.label) : 'Peak demand';
  const te = typeof d === 'object' && d.te ? String(d.te) : 'రద్దీ సమయం';
  return { mult: clamp(mult, MOD.peakMin, MOD.peakMax), label, te };
}

/** Read the career's demand, tolerating its absence and either API (`peak()` has a label; `demand(hour)` is a bare number). Never throws. */
export function readDemand(career, hour) {
  try {
    const d = typeof career?.peak === 'function' ? career.peak() : typeof career?.demand === 'function' ? career.demand(hour) : null;
    return normalizeDemand(d);
  } catch {
    return null;
  }
}

/** Is it raining for fare purposes? Accepts ctx.weather = { raining } or { rain: 0..1 }. */
export function isRaining(weather) {
  if (!weather) return false;
  if (weather.raining === true) return true;
  return Number.isFinite(weather.rain) && weather.rain > MOD.rainLevel;
}

/**
 * -> { mul, flat, list: [{ id, label, te, mul? , flat? }] }
 * in: { hour, raining, demand (normalised or raw), luggage, urgent }
 * The fare is `base * mul + flat`.
 */
export function computeModifiers({ hour, raining = false, demand = null, luggage = false } = {}) {
  const list = [];
  let mul = 1;
  let flat = 0;
  const peak = demand && demand.mult ? demand : normalizeDemand(demand);
  const peakIsNight = !!peak && /night/i.test(peak.label);
  if (isNight(hour) && !peakIsNight) {
    mul *= MOD.night;
    list.push({ id: 'night', label: 'Night charge', te: 'రాత్రి ఛార్జ్', mul: MOD.night });
  }
  if (raining) {
    mul *= MOD.rain;
    list.push({ id: 'rain', label: 'Rain', te: 'వర్షం', mul: MOD.rain });
  }
  if (peak) {
    mul *= peak.mult;
    list.push({ id: 'peak', label: peak.label, te: peak.te, mul: peak.mult });
  }
  if (luggage) {
    flat += MOD.luggageFlat;
    list.push({ id: 'luggage', label: 'Luggage', te: 'సామాను', flat: MOD.luggageFlat });
  }
  return { mul: Math.min(mul, MOD.totalMax), flat, list };
}

/** base * mul + flat, rounded. */
export const applyMods = (base, mods) => Math.round(base * (mods?.mul ?? 1) + (mods?.flat ?? 0));

/** "Night charge x1.25 · Luggage +Rs 20", for a toast. */
export function describeMods(mods) {
  return (mods?.list || []).map((m) => (m.mul ? `${m.label} x${m.mul.toFixed(2).replace(/0$/, '')}` : `${m.label} +Rs ${m.flat}`)).join(' · ');
}

/** Why a passenger is in a hurry. Telugu next to English; `ids` are the keys of URGENT. */
export const URGENT = {
  train: { id: 'train', en: 'Train in 10 minutes', te: '10 నిమిషాల్లో రైలు' },
  flight: { id: 'flight', en: 'Flight to catch', te: 'విమానం అందుకోవాలి' },
  hospital: { id: 'hospital', en: 'Hospital emergency', te: 'ఆసుపత్రి అత్యవసరం' },
  exam: { id: 'exam', en: 'Exam in 10 minutes', te: '10 నిమిషాల్లో పరీక్ష' },
  meeting: { id: 'meeting', en: 'Late for a meeting', te: 'మీటింగ్‌కి లేట్' },
};

/** A metro station id: the real ones are `<line>-<name>` ('red-miyapur', 'blue-ameerpet'); 'metro...' covers older ids and test fixtures. */
export const isMetroId = (id) => /^(metro|red|blue|green)([-_]|$)/i.test(String(id ?? ''));

/**
 * Is this customer in a hurry? A rusher always is (the reason follows the destination); others rarely.
 * `roll` 0..1. Returns a URGENT entry or null.
 */
export function urgentFor(kind, destPoiId, roll = 0.5) {
  const byDest = destPoiId === 'station' ? URGENT.train : destPoiId === 'airport' ? URGENT.flight : destPoiId === 'hospital' ? URGENT.hospital : null;
  if (kind === 'rusher') return byDest || (isMetroId(destPoiId) ? URGENT.train : URGENT.meeting);
  if (destPoiId === 'hospital' && (kind === 'elder' || kind === 'women' || kind === 'regular') && roll < 0.35) return URGENT.hospital;
  if (destPoiId === 'station' && kind !== 'tourist' && roll < 0.12) return URGENT.train;
  if (kind === 'student' && roll < 0.05) return URGENT.exam;
  return null;
}

/**
 * Settle the urgent part of a ride. in: { fare (after settleRide), timeLeft, timeLimit (seconds) }
 * -> { fare, bonus, late }. On time: a bonus of 15..40% (more if you were early); late: no bonus (settleRide already cut the fare).
 */
export function urgentSettle({ fare, timeLeft, timeLimit }) {
  if (!Number.isFinite(timeLimit) || !Number.isFinite(timeLeft)) return { fare, bonus: 0, late: false };
  if (timeLeft < 0) return { fare, bonus: 0, late: true };
  const spare = clamp(timeLeft / Math.max(1, timeLimit), 0, 1);
  const bonus = Math.round(fare * (MOD.urgentBase + MOD.urgentSpare * spare));
  return { fare: fare + bonus, bonus, late: false };
}
