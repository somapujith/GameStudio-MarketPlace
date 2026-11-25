// Customer kinds: who they are, what they like, how much they pay. Pure data + a few pure pickers (unit-tested).
// The kind ids are the contract with the voice agent: regular | rusher | elder | women | tourist | student.
import { ECON } from '../game/config.js';

/** Fare constants (rupees, metres). The core ECON gives the base and the waiting rate; the per-metre rate is raised so a
 *  typical 500-1000 m ride pays 100-300 rupees. */
export const FARE = {
  base: ECON.baseFare,
  perMeter: ECON.perMeter * 1.8,
  waitPerSecond: ECON.waitingPerSecond,
  routeFactor: 1.35, // straight line -> estimated road distance
  meterCapFactor: 1.8, // the meter never runs past 1.8x the estimate (no circling for money)
  min: 40,
  max: 520,
  boardSpeed: 3, // m/s: slower than this and within boardRange the pick-up prompt shows
  boardRange: 6,
  boardStopSeconds: 1, // brake to a stop beside them this long and they hop in
  dropRadius: 14,
  dropSpeed: 3,
};

/**
 * One entry per kind.
 *  weight: spawn odds. fareMult: multiplies the whole meter. tip: tip as a fraction of the fare at 5 stars.
 *  start: opening mood. calm: mood regained per second of a quiet ride.
 *  maxKmh: above this the ride is uncomfortable (speedPain per km/h over, per second). fastKmh: above this they enjoy it (speedJoy).
 *  drift: mood per second while drifting (negative = hates it). jolt: mood lost per second per unit of v.jolt.
 *  crash: mood lost per unit of crash strength. brake: mood lost per hard stop. scenic: mood gained per second near a landmark.
 *  patience: [min, max] seconds they wait. pax: chance of a second passenger.
 */
export const KINDS = {
  regular: { id: 'regular', weight: 26, fareMult: 1, tip: 0.15, start: 0.78, calm: 0.012, maxKmh: 70, speedPain: 0.002, fastKmh: 999, speedJoy: 0, drift: -0.035, jolt: 0.1, crash: 0.22, brake: 0.04, scenic: 0, patience: [50, 100], pax: 0.15 },
  rusher: { id: 'rusher', weight: 9, fareMult: 1.25, tip: 0.8, start: 0.7, calm: 0, maxKmh: 999, speedPain: 0, fastKmh: 40, speedJoy: 0.0015, drift: 0, jolt: 0.06, crash: 0.12, brake: 0.01, scenic: 0, patience: [45, 70], pax: 0.05 },
  elder: { id: 'elder', weight: 22, fareMult: 1, tip: 0.45, start: 0.85, calm: 0.012, maxKmh: 45, speedPain: 0.0028, fastKmh: 999, speedJoy: 0, drift: -0.3, jolt: 0.38, crash: 0.34, brake: 0.09, scenic: 0, patience: [60, 100], pax: 0.1 },
  women: { id: 'women', weight: 20, fareMult: 1.05, tip: 0.25, start: 0.82, calm: 0.02, maxKmh: 58, speedPain: 0.0022, fastKmh: 999, speedJoy: 0, drift: -0.14, jolt: 0.22, crash: 0.28, brake: 0.06, scenic: 0, patience: [55, 100], pax: 0.4 },
  tourist: { id: 'tourist', weight: 9, fareMult: 1.6, tip: 0.35, start: 0.74, calm: 0.006, maxKmh: 85, speedPain: 0.0015, fastKmh: 999, speedJoy: 0, drift: 0.02, jolt: 0.1, crash: 0.2, brake: 0.04, scenic: 0.05, patience: [55, 100], pax: 0.3 },
  student: { id: 'student', weight: 14, fareMult: 0.8, tip: 0.05, start: 0.66, calm: 0, maxKmh: 999, speedPain: 0, fastKmh: 38, speedJoy: 0.0022, drift: 0.16, jolt: 0.04, crash: 0.05, brake: 0, scenic: 0, patience: [45, 90], pax: 0.25 },
};
export const KIND_IDS = Object.keys(KINDS);

/** Hyderabadi names, Latin + Telugu script. `f`: the customer is a woman (look and voice). */
export const NAMES = {
  regular: [
    { name: 'Ravi Anna', te: 'రవి అన్న' }, { name: 'Suresh Bhai', te: 'సురేష్ భాయ్' }, { name: 'Kiran Garu', te: 'కిరణ్ గారు' },
    { name: 'Venkat Anna', te: 'వెంకట్ అన్న' }, { name: 'Imran Bhai', te: 'ఇమ్రాన్ భాయ్' }, { name: 'Narsimha Garu', te: 'నరసింహ గారు' },
    { name: 'Jyothi Akka', te: 'జ్యోతి అక్క', f: true }, { name: 'Mohsin Bhai', te: 'మొహసిన్ భాయ్' },
  ],
  rusher: [
    { name: 'Anil Sir', te: 'అనిల్ సర్' }, { name: 'Rakesh Bhai', te: 'రాకేష్ భాయ్' }, { name: 'Harish Garu', te: 'హరీష్ గారు' },
    { name: 'Deepa Madam', te: 'దీపా మేడం', f: true }, { name: 'Prasad Garu', te: 'ప్రసాద్ గారు' },
  ],
  elder: [
    { name: 'Lakshmi Amma', te: 'లక్ష్మి అమ్మ', f: true }, { name: 'Subbarao Thatha', te: 'సుబ్బారావు తాత' }, { name: 'Parvathi Ammamma', te: 'పార్వతి అమ్మమ్మ', f: true },
    { name: 'Khadir Chacha', te: 'ఖదీర్ చాచా' }, { name: 'Hanumanthu Thatha', te: 'హనుమంతు తాత' }, { name: 'Rangamma', te: 'రంగమ్మ', f: true },
  ],
  women: [
    { name: 'Salma Aapa', te: 'సల్మా ఆపా', f: true }, { name: 'Sunitha Akka', te: 'సునీత అక్క', f: true }, { name: 'Fatima Bi', te: 'ఫాతిమా బీ', f: true },
    { name: 'Radha Garu', te: 'రాధ గారు', f: true }, { name: 'Anitha Madam', te: 'అనిత మేడం', f: true }, { name: 'Shabana Aapa', te: 'షబానా ఆపా', f: true },
  ],
  tourist: [
    { name: 'Mr. Walker', te: 'మిస్టర్ వాకర్' }, { name: 'Emily Madam', te: 'ఎమిలీ మేడం', f: true }, { name: 'Dr. Fernandes', te: 'డాక్టర్ ఫెర్నాండెజ్' },
    { name: 'Mr. Kapoor', te: 'మిస్టర్ కపూర్' }, { name: 'Sophie Madam', te: 'సోఫీ మేడం', f: true },
  ],
  student: [
    { name: 'Charan', te: 'చరణ్' }, { name: 'Tejaswi', te: 'తేజస్వి', f: true }, { name: 'Arjun Bro', te: 'అర్జున్ బ్రో' },
    { name: 'Pavan', te: 'పవన్' }, { name: 'Meghana', te: 'మేఘన', f: true }, { name: 'Sai Teja', te: 'సాయి తేజ' },
  ],
};

/** Where a customer of each kind may be heading (poi ids). Others: any poi except the garage and the pumps, or a road spot. */
export const TOURIST_DEST = ['charminar', 'mecca', 'golconda', 'cyber', 'birla', 'paradise', 'stadium', 'airport'];
export const RUSHER_DEST = ['station', 'airport', 'hospital'];
/** Famous places a customer may be waiting at, and the kinds that favour each. */
export const FAMOUS_SPOTS = {
  station: ['rusher', 'regular', 'women', 'elder'],
  airport: ['tourist', 'rusher', 'regular'],
  hospital: ['elder', 'women', 'regular'],
  charminar: ['tourist', 'student', 'women', 'regular'],
  cyber: ['student', 'rusher', 'regular', 'women'],
  paradise: ['student', 'regular', 'women', 'tourist'],
  birla: ['tourist', 'elder', 'women'],
  mecca: ['tourist', 'elder', 'regular'],
  golconda: ['tourist', 'student'],
  stadium: ['student', 'regular'],
  irani: ['elder', 'regular', 'student'],
};
export const NEVER_DEST = ['garage', 'cng_old', 'cng_north', 'cng_west', 'cng_south'];

/** Weighted kind pick (rng is a game/rng.js generator). */
export function pickKind(rng) {
  let total = 0;
  for (const id of KIND_IDS) total += KINDS[id].weight;
  let r = rng() * total;
  for (const id of KIND_IDS) {
    r -= KINDS[id].weight;
    if (r <= 0) return id;
  }
  return 'regular';
}

/** A person for a kind: name (Latin + Telugu), gender, how many riders, how long they will wait. */
export function makeIdentity(rng, kind, pairOdds = null) {
  const k = KINDS[kind];
  const n = rng.pick(NAMES[kind]);
  const female = !!n.f;
  let pax = rng.chance(pairOdds ?? k.pax) ? 2 : 1;
  if (kind === 'women' && pax === 1 && rng.chance(0.2)) pax = 2;
  return { name: n.name, te: n.te, female, pax, patienceSeconds: rng.range(k.patience[0], k.patience[1]) };
}

/** Who waits outside which kind of shop (weights), and the odds of a pair there. Metro stations: commuters. */
export const PLACE_KINDS = {
  restaurant: { women: 3, regular: 3, student: 2, elder: 1, tourist: 1 },
  hotel: { tourist: 6, rusher: 1, regular: 1 },
  sweets: { women: 4, elder: 4, regular: 1 },
  stall: { student: 4, women: 3, regular: 1 },
  metro: { regular: 4, rusher: 2, student: 3, women: 1 },
};
export const PLACE_PAIR = { restaurant: 0.55, hotel: 0.5, sweets: 0.3, stall: 0.35, metro: 0.1 };

/** A weighted pick from { kind: weight }. */
export function pickWeighted(rng, table) {
  const keys = Object.keys(table);
  let total = 0;
  for (const k of keys) total += table[k];
  let r = rng() * total;
  for (const k of keys) {
    r -= table[k];
    if (r <= 0) return k;
  }
  return keys[0];
}
