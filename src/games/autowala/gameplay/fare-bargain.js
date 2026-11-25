// Meter or bargain? Pure logic for the price talk at pickup. No DOM, no three.js, no randomness of its own (callers pass `roll` 0..1),
// so every outcome is unit-tested.
//
//   meter                  nothing to negotiate: honest, trusted, the meter decides
//   fixed price            the driver quotes a flat price; the customer accepts, counters or refuses (one answer)
//   bargain                the driver names an opening ask; the customer answers; the driver may accept the counter, meet in the middle or hold
//
// A persona describes how each kind of customer reacts:
//   max      the highest price/estimate ratio they accept at once
//   stretch  above `max` and up to this ratio they counter; above it they refuse
//   counter  the ratio they counter at
//   yield    0..1: when the driver holds a price in the counter band, how likely they concede (the ratio they will still accept is max + (stretch - max) * yield)
//   sens     mood lost per +100% over the estimate (and gained for a discount)
//   tipSens  tip lost per +100% over the estimate (negative: they tip MORE when they overpay, tourists)
//   quote    the ratio a "fixed price" quote is made at

export const HAGGLE = {
  regular: { max: 1.12, stretch: 1.5, counter: 1.0, yield: 0.25, sens: 0.5, tipSens: 0.8, rounds: 2, quote: 1.12 },
  rusher: { max: 1.6, stretch: 2.2, counter: 1.3, yield: 0.7, sens: 0.1, tipSens: 0.2, rounds: 1, quote: 1.3 },
  elder: { max: 1.1, stretch: 1.7, counter: 0.95, yield: 0.2, sens: 0.55, tipSens: 1.0, rounds: 2, quote: 1.05 },
  women: { max: 1.12, stretch: 1.4, counter: 1.0, yield: 0.3, sens: 0.5, tipSens: 0.9, rounds: 2, quote: 1.1 },
  tourist: { max: 1.9, stretch: 2.6, counter: 1.5, yield: 0.6, sens: 0.1, tipSens: -0.25, rounds: 2, quote: 1.55 },
  student: { max: 0.98, stretch: 1.25, counter: 0.82, yield: 0, sens: 0.9, tipSens: 1.2, rounds: 2, quote: 1.05 },
};

export const BARGAIN = {
  step: 5, // prices are rounded to Rs 5
  openHigh: 1.5,
  openFair: 1.2,
  openLow: 0.95,
  jitter: 0.12, // +-6% on the customer's thresholds, from `roll`
  meetLenience: 1.06, // meeting in the middle is accepted up to max * this
  meterMood: 0.05,
  meterTrustMood: 0.08, // elders and women feel safer on the meter
  meterTrustTip: 1.12,
  haggleMood: -0.02, // every round of haggling costs a little goodwill
  discountMood: 0.04,
  overpayRegret: 0.08, // an overpaid tourist later wonders: mood hit above this premium
  tipMax: 1.35,
};

const persona = (kind) => HAGGLE[kind] || HAGGLE.regular;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const roundTo = (n, step = BARGAIN.step) => Math.max(step, Math.round(n / step) * step);
const jit = (roll) => 1 + ((Number.isFinite(roll) ? roll : 0.5) - 0.5) * BARGAIN.jitter;

/** The flat price a driver quotes for "fixed price" on an estimate `ref`. */
export const quoteFor = (kind, ref) => roundTo(ref * persona(kind).quote);

/** The three opening asks for a bargain: [{ id: 'high'|'fair'|'low', price }]. */
export function openingAsks(ref) {
  return [
    { id: 'high', price: roundTo(ref * BARGAIN.openHigh) },
    { id: 'fair', price: roundTo(ref * BARGAIN.openFair) },
    { id: 'low', price: roundTo(ref * BARGAIN.openLow) },
  ];
}

/**
 * How the customer answers a price. ratio = ask / ref.
 * -> { verdict: 'accept' } | { verdict: 'counter', price } | { verdict: 'refuse' }
 */
export function evaluateOffer(kind, ask, ref, roll = 0.5, lenience = 1) {
  const p = persona(kind);
  const j = jit(roll);
  const ratio = ask / Math.max(1, ref);
  if (ratio <= p.max * j * lenience) return { verdict: 'accept' };
  if (ratio <= p.stretch * j) {
    let price = roundTo(ref * p.counter * (2 - j)); // a touch lower when the roll is high: they are in a haggling mood
    if (price >= ask) return { verdict: 'accept' };
    return { verdict: 'counter', price };
  }
  return { verdict: 'refuse' };
}

/**
 * Start a negotiation: the driver asks `ask`.
 * -> neg { kind, ref, ask, counter, round, rounds, status: 'agreed'|'countered'|'refused', price (when agreed), opening }
 */
export function startNegotiation(kind, ref, ask, roll = 0.5) {
  const neg = { kind, ref, ask, opening: ask, counter: null, round: 1, rounds: persona(kind).rounds, status: 'refused', price: null };
  applyVerdict(neg, evaluateOffer(kind, ask, ref, roll));
  return neg;
}

function applyVerdict(neg, r) {
  if (r.verdict === 'accept') {
    neg.status = 'agreed';
    neg.price = neg.ask;
    neg.counter = null;
  } else if (r.verdict === 'counter') {
    neg.status = 'countered';
    neg.counter = r.price;
  } else {
    neg.status = 'refused';
    neg.counter = null;
  }
}

/** The price halfway between the driver's ask and the customer's counter. */
export const meetPrice = (neg) => roundTo((neg.ask + neg.counter) / 2);

/**
 * The driver answers a counter. move: 'accept' (take the counter) | 'meet' (split the difference) | 'hold' (insist on the ask).
 * Mutates and returns neg. Only valid while neg.status === 'countered'.
 */
export function respond(neg, move, roll = 0.5) {
  if (neg.status !== 'countered') return neg;
  const p = persona(neg.kind);
  if (move === 'accept') {
    neg.status = 'agreed';
    neg.price = neg.counter;
    return neg;
  }
  if (move === 'meet') {
    const mid = meetPrice(neg);
    neg.round++;
    if (mid <= neg.counter || mid / neg.ref <= p.max * jit(roll) * BARGAIN.meetLenience) {
      neg.status = 'agreed';
      neg.price = Math.max(mid, neg.counter);
      neg.ask = neg.price;
    } else if (neg.round <= neg.rounds && mid / neg.ref <= p.stretch) {
      // not yet: they move a little towards you
      const next = roundTo(neg.counter + (mid - neg.counter) * 0.5);
      neg.ask = mid;
      if (next >= mid) {
        neg.status = 'agreed';
        neg.price = mid;
      } else {
        neg.counter = next;
      }
    } else {
      neg.status = 'refused';
    }
    return neg;
  }
  // hold
  neg.round++;
  const give = p.max + (p.stretch - p.max) * p.yield;
  if (neg.ask / neg.ref <= give * jit(roll)) {
    neg.status = 'agreed';
    neg.price = neg.ask;
    neg.conceded = true;
  } else {
    neg.status = 'refused';
  }
  return neg;
}

/** Can the driver still meet in the middle (a further round exists)? */
export const canMeet = (neg) => neg.status === 'countered' && neg.round <= neg.rounds;

/**
 * What agreed terms do to the ride.
 * terms: { mode: 'meter' } | { mode: 'fixed', fixedFare, rounds (rounds of haggling), opening }
 * -> { mood (added to the passenger's mood now), tipMul (multiplies the tip at drop-off), premium (price / ref - 1, 0 for the meter), note }
 */
export function termsOutcome(kind, terms, ref) {
  const p = persona(kind);
  if (!terms || terms.mode !== 'fixed') {
    const trusting = kind === 'elder' || kind === 'women';
    return {
      mood: trusting ? BARGAIN.meterTrustMood : BARGAIN.meterMood,
      tipMul: trusting ? BARGAIN.meterTrustTip : 1,
      premium: 0,
      note: 'meter',
    };
  }
  const premium = terms.fixedFare / Math.max(1, ref) - 1;
  let mood = -premium * p.sens + (premium < -0.02 ? BARGAIN.discountMood : 0) + BARGAIN.haggleMood * Math.max(0, (terms.rounds || 1) - 1);
  if (kind === 'tourist' && premium > 0.35) mood -= BARGAIN.overpayRegret * clamp((premium - 0.35) / 0.5, 0, 1);
  const tipMul = clamp(1 - Math.max(0, premium) * p.tipSens + Math.max(0, -premium) * 0.3, 0, BARGAIN.tipMax);
  return { mood: clamp(mood, -0.4, 0.2), tipMul, premium, note: premium > 0.3 ? 'dear' : premium < -0.02 ? 'cheap' : 'fair' };
}

/** The label the review pools use for a price: did they feel they paid too much? */
export const overcharged = (kind, premium) => premium > (kind === 'tourist' ? 0.6 : 0.3);

/** A price the customer certainly accepts when the driver backs down after a refusal. */
export const dropPrice = (kind, ref) => roundTo(ref * Math.min(1, persona(kind).max * 0.95));
