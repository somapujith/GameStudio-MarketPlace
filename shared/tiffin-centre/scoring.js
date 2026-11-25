// Tiffin Centre: quality, tips, combo, stars and ranks. Pure helpers shared by the engine, the bot and the tests.
import { DISHES, LEVELS, MAX_LEVEL, PACE, PERFECT_AGE, coopScale } from './catalog.js';

export const PERFECT_TIP = 0.05; // of each perfect dish's price
export const COMBO_STEP = 0.02; // of the bill, per consecutive collect
export const COMBO_MAX = 0.2;

/** Quality of a dish that has been ready for `age` ticks: perfect | good | ok | burnt. */
export function qualityOf(age, dishId) {
  const burn = DISHES[dishId].burn;
  if (age >= burn) return 'burnt';
  if (age <= PERFECT_AGE) return 'perfect';
  if (age < burn - 2) return 'good';
  return 'ok';
}

/**
 * Quality after the flaws of the pan: a dish that stuck or came from sour batter is at best 'ok'; a torn one is 'broken' (half price).
 * `fl` is the slot's flaw bit mask (1 stuck, 2 torn, 4 sour batter); a burnt dish stays burnt.
 */
export function flawedQuality(q, fl) {
  if (!fl || q === 'burnt') return q;
  if (fl & 2) return 'broken';
  return q === 'perfect' || q === 'good' ? 'ok' : q;
}

export const BROKEN_SHARE = 0.5; // a broken dish is paid at this share of its price

/** What a customer pays for a dish of quality `q`. */
export const priceOf = (dishId, q) => (DISHES[dishId] ? (q === 'broken' ? Math.floor(DISHES[dishId].price * BROKEN_SHARE) : DISHES[dishId].price) : 0);

export const billOf = (dishes) => dishes.reduce((n, d) => n + (DISHES[d] ? DISHES[d].price : 0), 0);

/** tip = round(total * kindTip * (0.04 + 0.12 * patienceFrac) + 5% of every perfect dish's price). */
export function tipFor({ total, kindTip, patienceFrac, got, qs }) {
  const f = Math.max(0, Math.min(1, patienceFrac));
  let perfect = 0;
  for (let i = 0; i < got.length; i++) if (qs[i] === 'perfect' && DISHES[got[i]]) perfect += PERFECT_TIP * DISHES[got[i]].price;
  return Math.round(total * kindTip * (0.04 + 0.12 * f) + perfect);
}

/** Combo bonus on a collect: +2% of the bill per consecutive collect (this one included), at most +20%. */
export const comboBonus = (total, combo) => Math.round(total * Math.min(COMBO_MAX, COMBO_STEP * Math.max(0, combo)));

const lvl = (n) => LEVELS[Math.max(0, Math.min(MAX_LEVEL, Math.trunc(Number(n)) || 0))];

/** PROFIT (money in hand minus what the stall spent) needed for 1 / 2 / 3 stars at this level, pace and team size. */
export function starTargets(level, pace, players) {
  const k = (PACE[pace] || PACE.normal).stars * coopScale(players);
  return lvl(level).stars.map((n) => Math.round(n * k));
}

/** 0..3 from PROFIT (cash in hand - costs). Level 0 (the tutorial) has targets of 0: always 3. */
export function starsFor(level, pace, players, profit) {
  return starTargets(level, pace, players).reduce((n, t) => n + (profit >= t ? 1 : 0), 0);
}

/**
 * Standings of a team: everyone shares the rank (1 when the shift earned at least one star, the team size otherwise);
 * rows are ordered by money collected, ties by seat order. (Stars come from the team's PROFIT; a player's score is still what they collected.)
 */
export function standingsOf(players, order, stars) {
  const rank = stars >= 1 ? 1 : Math.max(1, order.length);
  return order
    .map((id, i) => ({ p: players[id], i }))
    .sort((a, b) => b.p.earned - a.p.earned || a.i - b.i)
    .map(({ p }) => ({
      id: p.id,
      rank,
      score: p.earned,
      stats: {
        served: p.served, collected: p.collected, earned: p.earned, tips: p.tips,
        prepped: p.ops ? p.ops[0] : 0, tended: p.ops ? p.ops[1] : 0, gasSwaps: p.ops ? p.ops[2] : 0, bought: p.ops ? p.ops[3] : 0,
      },
    }));
}
