// The day's books (the Hisaab): everything earned and spent in one shift, plus the history kept in the profile.
// Pure data in, pure data out (career-ledger.test.js). career.js feeds it the game's events.
import { CAREER } from './career-math.js';

export const EXPENSE_KINDS = ['cng', 'rent', 'repair', 'challan', 'fine', 'chai', 'other'];

export function createLedger() {
  return {
    fares: 0, // rupees of metered fares
    tips: 0,
    bonus: 0, // quests, events: anything else that paid
    rides: 0,
    bestFare: 0, // the best single fare (without the tip)
    starSum: 0,
    starN: 0,
    expenses: { cng: 0, rent: 0, repair: 0, challan: 0, fine: 0, chai: 0, other: 0 },
    credit: {}, // expenses already counted from a wallet event this frame: kind -> rupees (see noteWallet / noteExpense)
  };
}

const whole = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : 0);

/** A `wallet` event. Income is counted here (fares, tips, bonuses); fuel and fines are counted too in case nobody emits `expense` for them. */
export function noteWallet(l, e) {
  const d = Number(e?.delta) || 0;
  if (d > 0) {
    const reason = String(e.reason || '');
    if (reason === 'fare') l.fares += d;
    else if (reason === 'tip') l.tips += d;
    else if (!/refund/i.test(reason)) l.bonus += d;
  } else if (d < 0) {
    const reason = String(e?.reason || '');
    const kind = /^fuel/.test(reason) ? 'cng' : /fine|challan/i.test(reason) ? 'fine' : null;
    if (!kind) return;
    l.expenses[kind] += -d;
    l.credit[kind] = (l.credit[kind] || 0) + -d; // the matching `expense` event, if it comes, must not count twice
  }
}

/** An `expense { kind, amount, note? }` event. */
export function noteExpense(l, e) {
  const amount = whole(e?.amount);
  if (!amount || e?.note === 'down-payment') return; // buying the auto is an investment, not a running cost
  let kind = EXPENSE_KINDS.includes(e?.kind) ? e.kind : 'other';
  if (kind === 'other' && e?.note === 'chai') kind = 'chai';
  const group = kind === 'challan' ? 'fine' : kind; // a wallet event cannot tell a fine from a challan
  if (l.credit[group] >= amount) {
    l.credit[group] -= amount;
    return;
  }
  l.expenses[kind] += amount;
}

/** Forget wallet-event credits (called every frame: the matching `expense` always comes in the same tick). */
export function clearCredits(l) {
  for (const k in l.credit) delete l.credit[k];
}

/** A `fare:dropoff`. */
export function noteDropoff(l, e) {
  l.rides += 1;
  l.bestFare = Math.max(l.bestFare, whole(e?.fare));
  const r = Number(e?.rating);
  if (Number.isFinite(r) && r > 0) {
    l.starSum += r;
    l.starN += 1;
  }
}

export const earnedOf = (l) => l.fares + l.tips + l.bonus;
export const expenseTotal = (l) => EXPENSE_KINDS.reduce((s, k) => s + (l.expenses[k] || 0), 0);
export const netOf = (l) => earnedOf(l) - expenseTotal(l);
export const starsOf = (l) => (l.starN ? Math.round((l.starSum / l.starN) * 10) / 10 : 0);

/** The numbers shown on the Hisaab screen (a plain, serialisable object). */
export function summarize(l, extra = {}) {
  const expenses = { ...l.expenses };
  return {
    ...extra,
    earned: earnedOf(l),
    fares: l.fares,
    tips: l.tips,
    bonus: l.bonus,
    expenses,
    expenseTotal: expenseTotal(l),
    net: netOf(l),
    rides: l.rides,
    bestFare: l.bestFare,
    stars: starsOf(l),
  };
}

// ---- history in the profile ------------------------------------------------------------------------------------------------

export function defaultHistory() {
  return { days: [], best: null };
}

const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

/** A day as it is stored: only small numbers. */
export function compactDay(h) {
  return { day: n(h.lifeDay), earned: n(h.earned), expenses: n(h.expenseTotal), net: n(h.net), rides: n(h.rides), bestFare: n(h.bestFare), stars: Math.round((Number(h.stars) || 0) * 10) / 10 };
}

export function normalizeHistory(raw) {
  const d = defaultHistory();
  if (!raw || typeof raw !== 'object') return d;
  const clean = (x) => (x && typeof x === 'object' ? compactDay({ lifeDay: x.day, earned: x.earned, expenseTotal: x.expenses, net: x.net, rides: x.rides, bestFare: x.bestFare, stars: x.stars }) : null);
  const days = Array.isArray(raw.days) ? raw.days.map(clean).filter(Boolean).slice(-CAREER.history) : [];
  return { days, best: clean(raw.best) };
}

/** Add a finished day: returns { history, newBest }. The best day is the one with the highest net profit. */
export function recordDay(history, h) {
  const day = compactDay(h);
  const days = [...history.days, day].slice(-CAREER.history);
  const newBest = day.rides > 0 && (!history.best || day.net > history.best.net);
  return { history: { days, best: newBest ? day : history.best }, newBest };
}
