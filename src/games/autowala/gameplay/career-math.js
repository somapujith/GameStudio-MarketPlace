// Career maths: pure functions and tuning numbers for the driver's day (rent, damage, fatigue, demand, the ladder to owning an auto).
// No game objects in here, so all of it is unit-tested (career-math.test.js). career.js wires it to the game.
import { clamp } from '../game/rng.js';

export const CAREER = {
  owner: 'Seth Ramulu',
  ownerTe: 'సేఠ్ రాములు',
  rent: 400, // rupees for a full day on the rented auto
  rentFullHours: 16, // a shift of this many game hours (or more) pays the full day's rent
  rentMinFrac: 0.25, // ...and a very short shift still pays a quarter
  minShiftHours: 0.25, // a shift shorter than this (15 game minutes) leaves no Hisaab at all
  debtCapDays: 3, // unpaid rent carries over, up to this many days of rent
  fatigue: {
    drivePerHour: 0.12, // fatigue gained per game hour while the auto is moving
    idlePerHour: 0.04, // ...and while parked
    chaiPrice: 15, // Rs 10-20: the chai stall
    chaiCooldown: 20, // seconds before the next glass
    levels: [0.4, 0.7, 0.9], // 1 = getting tired, 2 = tired, 3 = exhausted
    maxGripLoss: 0.14, // grip multiplier falls to 1 - this at fatigue 1
  },
  damage: {
    minImpact: 0.06, // below this a bump is ignored
    crashK: 0.07, // damage per unit of crash strength (strength is 0..1.4)
    hitK: 0.055, // damage per unit of traffic:hit severity (0..1)
    window: 0.4, // a crash and a traffic:hit for the same bump count once (seconds)
    maxSpeedLoss: 0.28, // top speed falls by this much at damage 1
    rattleFrom: 0.3, // the auto starts to rattle past this much damage
    levels: [0.25, 0.55, 0.85], // career:damage level thresholds
  },
  repair: {
    base: 40, // the garage's minimum charge for any job
    perPoint: 9, // rupees per 1% of damage
  },
  ladder: {
    downPayment: 20000, // lifetime net savings (and the cash in hand) needed to buy your own auto
    emi: 1250, // rupees per instalment
    emiCount: 12, // instalments to clear the loan
    monthDays: 5, // game days per "month"
    lateFee: 100, // added to an instalment you could not pay
    repoAfter: 3, // missed instalments in a row before the bank takes the auto back
  },
  history: 7, // days kept in the profile
};

const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ---- rent ------------------------------------------------------------------------------------------------------------------

/** Rent for a shift of `hours` game hours: a full day's rent from `rentFullHours` up, never under a quarter. */
export function rentFor(hours, C = CAREER) {
  const f = clamp(num(hours) / C.rentFullHours, C.rentMinFrac, 1);
  return Math.round((C.rent * f) / 5) * 5;
}

/** Unpaid rent is carried over, but only up to `debtCapDays` days of rent. */
export function capDebt(debt, C = CAREER) {
  return clamp(Math.round(num(debt)), 0, C.rent * C.debtCapDays);
}

/** Pay what is owed from `wallet`: { paid, owed } (what could not be paid stays owed). */
export function settle(due, wallet) {
  const d = Math.max(0, Math.round(num(due)));
  const paid = Math.min(d, Math.max(0, Math.floor(num(wallet))));
  return { paid, owed: d - paid };
}

// ---- damage ----------------------------------------------------------------------------------------------------------------

/** Damage (0..1) added by a real crash of this strength (0..1.4). */
export const crashDamage = (strength, C = CAREER) => (num(strength) < C.damage.minImpact ? 0 : clamp(num(strength) * C.damage.crashK, 0, 0.14));
/** Damage added by a traffic:hit of this severity (0..1). */
export const hitDamage = (severity, C = CAREER) => (num(severity) < C.damage.minImpact ? 0 : clamp(num(severity) * C.damage.hitK, 0, 0.1));

/**
 * One bump can arrive as BOTH a `crash` and a `traffic:hit`. The tracker counts a bump once: inside the window only the part of a
 * later impact that exceeds the earlier one is added.
 */
export function createImpactGate(C = CAREER) {
  let at = -1e9;
  let peak = 0;
  return {
    /** -> the damage to apply for an impact worth `dmg` at time `t` (seconds). */
    take(dmg, t) {
      if (!(dmg > 0)) return 0;
      if (t - at > C.damage.window) {
        at = t;
        peak = dmg;
        return dmg;
      }
      if (dmg > peak) {
        const extra = dmg - peak;
        peak = dmg;
        return extra;
      }
      return 0;
    },
    reset() {
      at = -1e9;
      peak = 0;
    },
  };
}

/** Top speed multiplier of a damaged auto (1 = sound). */
export const damageSpeedMul = (damage, C = CAREER) => 1 - C.damage.maxSpeedLoss * clamp(num(damage), 0, 1);

/** How hard the damaged auto rattles at this speed (0..~0.12): added to `v.jolt` as a floor. */
export function rattle(damage, speed, C = CAREER) {
  const d = clamp((num(damage) - C.damage.rattleFrom) / (1 - C.damage.rattleFrom), 0, 1);
  return d * 0.13 * clamp(num(speed) / 12, 0, 1);
}

/** 0..3: how bad the damage is (for toasts and the HUD colour). */
export const damageLevel = (damage, C = CAREER) => C.damage.levels.filter((t) => num(damage) >= t).length;

/** Mama's Garage bill for fixing `damage` (0..1). 0 when the auto is sound. */
export function repairCost(damage, C = CAREER) {
  const pts = Math.round(clamp(num(damage), 0, 1) * 100);
  if (pts < 1) return 0;
  return Math.round((C.repair.base + C.repair.perPoint * pts) / 5) * 5;
}

/** What `wallet` buys: { cost, repaired (damage fixed, 0..1) }. A partial job fixes damage in proportion to the money (base charge first). */
export function partialRepair(damage, wallet, C = CAREER) {
  const full = repairCost(damage, C);
  const w = Math.max(0, Math.floor(num(wallet)));
  if (full <= 0) return { cost: 0, repaired: 0, full: 0 };
  if (w >= full) return { cost: full, repaired: clamp(num(damage), 0, 1), full };
  if (w <= C.repair.base) return { cost: 0, repaired: 0, full };
  const pts = Math.floor((w - C.repair.base) / C.repair.perPoint);
  const cost = Math.min(w, C.repair.base + pts * C.repair.perPoint);
  return { cost, repaired: Math.min(clamp(num(damage), 0, 1), pts / 100), full };
}

// ---- fatigue ---------------------------------------------------------------------------------------------------------------

/** Fatigue after `dt` real seconds (one game hour = `secPerHour` seconds). Moving tires you faster than waiting. */
export function fatigueStep(f, dt, moving, secPerHour = 60, C = CAREER) {
  const rate = (moving ? C.fatigue.drivePerHour : C.fatigue.idlePerHour) / secPerHour;
  return clamp(num(f) + rate * Math.max(0, dt), 0, 1);
}

/** Grip multiplier of a tired driver: 1 when fresh, down to 1 - maxGripLoss when worn out. */
export const fatigueMul = (f, C = CAREER) => 1 - C.fatigue.maxGripLoss * smooth((num(f) - 0.35) / 0.65);

/** 0..3 (fresh, getting tired, tired, exhausted). */
export const fatigueLevel = (f, C = CAREER) => C.fatigue.levels.filter((t) => num(f) >= t).length;
export const FATIGUE_NAMES = [
  { id: 'fresh', en: 'Fresh', te: 'ఉత్సాహంగా' },
  { id: 'getting-tired', en: 'Getting tired', te: 'అలసట మొదలైంది' },
  { id: 'tired', en: 'Tired', te: 'అలసిపోయారు' },
  { id: 'exhausted', en: 'Exhausted', te: 'చాలా అలసట' },
];

// ---- demand (peak hours) ---------------------------------------------------------------------------------------------------

// [hour, demand multiplier]: 1 is an ordinary hour. Office rush 8-10 and 17-20, lunch, a night lull.
const CURVE = [
  [0, 0.35], [3, 0.2], [5, 0.4], [6.5, 0.8], [8, 1.45], [9, 1.6], [10.2, 1.1], [11.5, 0.9], [12.5, 1.25], [13.8, 0.9],
  [15.5, 0.85], [17, 1.4], [18.5, 1.7], [20, 1.3], [21.5, 0.9], [23, 0.55], [24, 0.35],
];

/** Demand multiplier for an hour of the day (0..24, wraps). Roughly 0.2 (dead of night) to 1.7 (evening rush). */
export function demand(hour) {
  const h = ((num(hour) % 24) + 24) % 24;
  for (let i = 1; i < CURVE.length; i++) {
    if (h <= CURVE[i][0]) {
      const [h0, d0] = CURVE[i - 1];
      const [h1, d1] = CURVE[i];
      const t = (h - h0) / (h1 - h0 || 1);
      return d0 + (d1 - d0) * t;
    }
  }
  return CURVE[CURVE.length - 1][1];
}

const BANDS = [
  { from: 5.5, to: 8, id: 'morning', en: 'Early morning', te: 'ఉదయం' },
  { from: 8, to: 10.5, id: 'office-am', en: 'Office rush', te: 'ఆఫీస్ రష్', peak: true },
  { from: 10.5, to: 12, id: 'day', en: 'Daytime', te: 'పగలు' },
  { from: 12, to: 13.8, id: 'lunch', en: 'Lunch hour', te: 'భోజనం వేళ', peak: true },
  { from: 13.8, to: 16.5, id: 'afternoon', en: 'Afternoon lull', te: 'మధ్యాహ్నం' },
  { from: 16.5, to: 20.5, id: 'office-pm', en: 'Evening rush', te: 'సాయంత్రం రష్', peak: true },
  { from: 20.5, to: 22, id: 'evening', en: 'Evening', te: 'సాయంత్రం' },
  { from: 22, to: 24, id: 'night', en: 'Late night', te: 'రాత్రి' },
];

/** { mult, level (0 dead..3 rush), label, te, id, peak } for an hour of the day. */
export function peak(hour) {
  const h = ((num(hour) % 24) + 24) % 24;
  const mult = demand(h);
  const band = BANDS.find((b) => h >= b.from && h < b.to) || { id: 'lull', en: 'Night lull', te: 'రాత్రి నిశ్శబ్దం' };
  const level = mult >= 1.4 ? 3 : mult >= 1.05 ? 2 : mult >= 0.6 ? 1 : 0;
  return { mult: Math.round(mult * 100) / 100, level, label: band.en, te: band.te, id: band.id, peak: !!band.peak };
}

// ---- ladder: owning your own auto -----------------------------------------------------------------------------------------

export function defaultLadder() {
  return { savings: 0, owned: false, emiLeft: 0, daysToEmi: 0, missed: 0, arrears: 0, lifeDays: 0, repossessed: 0 };
}

export function normalizeLadder(raw) {
  const d = defaultLadder();
  if (!raw || typeof raw !== 'object') return d;
  const n = (v, max) => clamp(Math.floor(num(v)), 0, max);
  const owned = raw.owned === true;
  return {
    savings: n(raw.savings, 1e9),
    owned,
    emiLeft: owned ? n(raw.emiLeft, 120) : 0,
    daysToEmi: owned ? n(raw.daysToEmi, 60) : 0,
    missed: owned ? n(raw.missed, 20) : 0,
    arrears: owned ? n(raw.arrears, 1e7) : 0,
    lifeDays: n(raw.lifeDays, 1e6),
    repossessed: n(raw.repossessed, 100),
  };
}

/** Bank a day's net profit into the lifetime savings (they never fall below 0). */
export const addSavings = (l, net) => ({ ...l, savings: Math.max(0, Math.round(l.savings + num(net))) });

/** Can the player buy the auto right now? { ok, reason }. */
export function canBuyAuto(l, wallet, C = CAREER) {
  if (l.owned) return { ok: false, reason: 'You already own your auto' };
  if (l.savings < C.ladder.downPayment) return { ok: false, reason: `Save Rs ${C.ladder.downPayment - l.savings} more` };
  if (num(wallet) < C.ladder.downPayment) return { ok: false, reason: `You need Rs ${C.ladder.downPayment} in hand` };
  return { ok: true, reason: '' };
}

/** After the down payment: the loan starts. */
export const startOwnership = (l, C = CAREER) => ({ ...l, owned: true, emiLeft: C.ladder.emiCount, daysToEmi: C.ladder.monthDays, missed: 0, arrears: 0 });

/**
 * One finished day on an owned auto: counts down to the next instalment. -> { ladder, emiDue (rupees owed now, 0 = none) }.
 * The instalment is paid (or not) by the caller, who then calls `emiResult`.
 */
export function emiTick(l, C = CAREER) {
  if (!l.owned || l.emiLeft <= 0) return { ladder: l, emiDue: 0 };
  const daysToEmi = l.daysToEmi - 1;
  if (daysToEmi > 0) return { ladder: { ...l, daysToEmi }, emiDue: 0 };
  return { ladder: { ...l, daysToEmi: C.ladder.monthDays }, emiDue: C.ladder.emi + l.arrears };
}

/** The bank's answer after the instalment was due: `paid` rupees were taken. -> { ladder, repossessed, cleared }. */
export function emiResult(l, due, paid, C = CAREER) {
  if (due <= 0) return { ladder: l, repossessed: false, cleared: false };
  if (paid >= due) {
    const emiLeft = Math.max(0, l.emiLeft - 1 - l.missed); // a late payment also clears the missed ones
    return { ladder: { ...l, emiLeft, missed: 0, arrears: 0 }, repossessed: false, cleared: emiLeft <= 0 };
  }
  const missed = l.missed + 1;
  if (missed >= C.ladder.repoAfter) {
    return { ladder: { ...defaultLadder(), savings: Math.floor(l.savings / 2), lifeDays: l.lifeDays, repossessed: l.repossessed + 1 }, repossessed: true, cleared: false };
  }
  return { ladder: { ...l, missed, arrears: Math.min(1e7, due - paid + C.ladder.lateFee) }, repossessed: false, cleared: false };
}

/** Progress for the HUD and the Hisaab: 0..1 towards the down payment, and where the player stands. */
export function ladderView(l, wallet, C = CAREER) {
  const dp = C.ladder.downPayment;
  const buy = canBuyAuto(l, wallet, C);
  return {
    owned: l.owned,
    savings: l.savings,
    downPayment: dp,
    progress: l.owned ? 1 : clamp(l.savings / dp, 0, 1),
    canBuy: buy.ok,
    reason: buy.reason,
    emi: l.owned && l.emiLeft > 0 ? { amount: C.ladder.emi, left: l.emiLeft, daysToNext: l.daysToEmi, missed: l.missed, arrears: l.arrears } : null,
    cleared: l.owned && l.emiLeft <= 0,
  };
}
