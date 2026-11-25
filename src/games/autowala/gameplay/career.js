// OWNER: career agent. The job: a rented auto from Seth Ramulu's garage, a daily rent, damage and repairs at Mama's Garage,
// driver fatigue and chai, peak hours, the end-of-day Hisaab (accounts) and the ladder to owning your own auto.
// Pure maths: career-math.js. The books: career-ledger.js. The panel: ui/Hisaab.jsx (menu name 'hisaab').
//
// ctx.career = {
//   day (clock day), lifeDay (days worked ever), shiftActive, shiftHours,
//   rent { due, paid, perDay, debt, owner, ownerTe, owned },          due = what the Hisaab would take now, paid = what the last Hisaab took
//   damage 0..1, damageLevel 0..3, fatigue 0..1, fatigueLevel 0..3, fatigueMul (grip multiplier), speedMul (damage's top-speed multiplier),
//   dayStats { earned, tips, expenses { cng, rent, repair, challan, fine, chai, other } },
//   goal { id, en, te, progress 0..1, target, have }, ladder (see ladderView), hisaab (the last one, or null),
//   peak() -> { mult, level, label, te, peak }, demand(hour) -> multiplier (0.2..1.7, wraps),
//   repairCost() -> rupees, repair({ partial }) -> { ok, cost, repaired, reason }, repairPrices { base, perPoint },
//   drinkChai() -> { ok, cost, reason }, chai { price, cooldown (s left) },
//   endShift({ open }) -> hisaab | null, startShift(), buyAuto() -> { ok, reason }
// }
// Events: career:shift-start { day }, career:shift-end { hisaab }, career:damage { damage, delta, level }, career:repaired { cost, damage },
//   career:fatigue { level, fatigue, name }, career:tired { fatigue }, career:rested { fatigue }, career:chai { cost }, career:peak { peak },
//   career:own { downPayment }, career:emi { due, paid, left }, career:repo {}
// Listens to: crash (guard ones ignored), traffic:hit, wallet, expense { kind, amount, note? }, fare:dropoff, menu.
// Snapshot key `career`: see snapshotView() below.
import { DAY } from '../game/config.js';
import { clamp } from '../game/rng.js';
import {
  CAREER, FATIGUE_NAMES, addSavings, canBuyAuto, capDebt, createImpactGate, crashDamage, damageLevel, damageSpeedMul, demand, emiResult,
  emiTick, fatigueLevel, fatigueMul, fatigueStep, hitDamage, ladderView, normalizeLadder, partialRepair, peak, rattle, rentFor, repairCost, settle, startOwnership,
} from './career-math.js';
import { clearCredits, createLedger, netOf, normalizeHistory, noteDropoff, noteExpense, noteWallet, earnedOf, recordDay, summarize, expenseTotal } from './career-ledger.js';

/** What is kept in the profile. (settings.career mirrors data.career, because the profile's normaliser keeps `settings` keys it does not know.) */
export function normalizeStore(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    ladder: normalizeLadder(r.ladder),
    history: normalizeHistory(r.history),
    debt: capDebt(r.debt),
    damage: clamp(Number(r.damage) || 0, 0, 1),
  };
}

const absHours = (clock) => (clock.day - 1) * 24 + clock.hour;

export function installCareer(ctx) {
  const { v, state, clock, profile } = ctx;
  const data = profile?.data;
  const store = normalizeStore(data?.career ?? data?.settings?.career);
  const saveStore = () => {
    if (!data) return;
    data.career = store;
    if (data.settings && typeof data.settings === 'object') data.settings.career = store;
    profile.save?.();
  };

  let ledger = createLedger();
  let shift = { day: clock.day, startAbs: absHours(clock), ended: false };
  let damage = store.damage;
  let fatigue = 0.05;
  let fLevel = 0;
  let tired = false;
  let chaiLeft = 0;
  let peakId = '';
  let bandHour = -99;
  let rentWarned = false;
  let pendingEnd = false;
  let lastHisaab = null;
  let lastRentPaid = 0;
  let mulSpeed = damageSpeedMul(damage);
  let mulGrip = 1;
  let hours = 0;
  const gate = createImpactGate();

  // ---- composing with the weather agent: they own state.speedMul / gripMul, we multiply our part on top ----------------------------
  const base = { speedMul: state.speedMul ?? 1, gripMul: state.gripMul ?? 1 };
  const hooked = [];
  const hook = (key, mine) => {
    const d = Object.getOwnPropertyDescriptor(state, key);
    if (d && !d.configurable) return;
    Object.defineProperty(state, key, {
      configurable: true,
      enumerable: true,
      get: () => base[key] * mine(),
      set: (x) => {
        base[key] = Number.isFinite(x) ? x : 1;
      },
    });
    hooked.push(key);
  };
  hook('speedMul', () => mulSpeed);
  hook('gripMul', () => mulGrip);

  const secPerHour = DAY?.secondsPerHour || 60;
  const rented = () => !store.ladder.owned;
  const rentNow = () => (rented() ? rentFor(hours) : 0) + store.debt;
  const emit = (type, d) => ctx.emit(type, d);
  const toast = (text, opts) => ctx.toast?.(text, opts);

  // ---- damage and repairs -------------------------------------------------------------------------------------------------------
  const setDamage = (d, delta = 0) => {
    const before = damageLevel(damage);
    damage = clamp(d, 0, 1);
    mulSpeed = damageSpeedMul(damage);
    store.damage = damage;
    if (delta > 0) {
      const level = damageLevel(damage);
      emit('career:damage', { damage, delta, level });
      if (level > before) {
        const words = ['', 'The auto has some dents', 'The auto is rattling badly: visit Mama’s Garage', 'The auto is falling apart! Repair it at Mama’s Garage'];
        toast(words[level], { tone: level >= 2 ? 'bad' : 'info', ms: 3200 });
      }
    }
  };

  const onImpact = (dmg) => {
    const add = gate.take(dmg, clock.time);
    if (add > 0) {
      setDamage(damage + add, add);
      saveStore();
    }
  };

  const quote = () => repairCost(damage);
  const repair = ({ partial = false } = {}) => {
    const full = quote();
    if (full <= 0) return { ok: false, cost: 0, repaired: 0, reason: 'Nothing to fix' };
    const wallet = ctx.economy.wallet;
    let cost = full;
    let repaired = damage;
    if (wallet < full) {
      if (!partial) return { ok: false, cost: full, repaired: 0, reason: `You need Rs ${full}` };
      const p = partialRepair(damage, wallet);
      if (p.cost <= 0) return { ok: false, cost: full, repaired: 0, reason: `You need at least Rs ${CAREER.repair.base + CAREER.repair.perPoint}` };
      cost = p.cost;
      repaired = p.repaired;
    }
    if (!ctx.economy.spend(cost, 'repair')) return { ok: false, cost, repaired: 0, reason: 'Not enough rupees' };
    ctx.emit('expense', { kind: 'repair', amount: cost });
    setDamage(damage - repaired);
    gate.reset();
    saveStore();
    emit('career:repaired', { cost, damage });
    toast(damage <= 0.005 ? `Auto as good as new: Rs ${cost}` : `Patched up: Rs ${cost}`, { tone: 'good', ms: 2800 });
    return { ok: true, cost, repaired, reason: '' };
  };

  // ---- chai ---------------------------------------------------------------------------------------------------------------------
  const drinkChai = () => {
    if (chaiLeft > 0) return { ok: false, cost: 0, reason: `The chai wallah is brewing (${Math.ceil(chaiLeft)} s)` };
    const cost = CAREER.fatigue.chaiPrice;
    if (!ctx.economy.spend(cost, 'chai')) return { ok: false, cost, reason: `Chai is Rs ${cost}` };
    ctx.emit('expense', { kind: 'other', amount: cost, note: 'chai' });
    chaiLeft = CAREER.fatigue.chaiCooldown;
    setFatigue(0);
    emit('career:chai', { cost });
    toast(`Chai break: Rs ${cost}. Fresh again!`, { tone: 'good', ms: 2400 });
    return { ok: true, cost, reason: '' };
  };

  const setFatigue = (f) => {
    fatigue = clamp(f, 0, 1);
    mulGrip = fatigueMul(fatigue);
    const level = fatigueLevel(fatigue);
    if (level !== fLevel) {
      const up = level > fLevel;
      fLevel = level;
      const name = FATIGUE_NAMES[level];
      emit('career:fatigue', { level, fatigue, name: name.id });
      if (up && level >= 2) toast(`${name.en}: stop for a chai (Y)`, { tone: 'gold', ms: 3000 });
    }
    if (!tired && fatigue >= CAREER.fatigue.levels[1]) {
      tired = true;
      emit('career:tired', { fatigue });
    } else if (tired && fatigue < CAREER.fatigue.levels[0]) {
      tired = false;
      emit('career:rested', { fatigue });
    }
  };

  // ---- the shift and the Hisaab -------------------------------------------------------------------------------------------------
  const startShift = () => {
    shift = { day: clock.day, startAbs: absHours(clock), ended: false };
    ledger = createLedger();
    hours = 0;
    rentWarned = false;
    pendingEnd = false;
    if (lastHisaab?.reason === 'day') setFatigue(Math.min(fatigue, 0.1)); // a night's sleep
    emit('career:shift-start', { day: clock.day });
  };

  /** Close the books. reason: 'day' (midnight) or 'clock-out'. Returns the Hisaab (or null for a shift too short to count). */
  const finalize = (reason, open) => {
    // a day ends at its midnight, even if the Hisaab had to wait for a menu to close
    const endAbs = reason === 'day' ? Math.min(absHours(clock), shift.day * 24) : absHours(clock);
    hours = Math.max(0, endAbs - shift.startAbs);
    if (hours < CAREER.minShiftHours && ledger.rides === 0 && earnedOf(ledger) === 0) {
      shift.ended = false;
      shift.startAbs = absHours(clock);
      shift.day = clock.day;
      pendingEnd = false;
      return null;
    }
    shift.ended = true;
    pendingEnd = false;

    // rent, or the EMI of your own auto
    const ownedBefore = store.ladder.owned;
    const perDay = ownedBefore ? 0 : rentFor(hours);
    const due = perDay + store.debt;
    const rentRes = settle(due, ctx.economy.wallet);
    if (rentRes.paid > 0 && ctx.economy.spend(rentRes.paid, 'rent')) ctx.emit('expense', { kind: 'rent', amount: rentRes.paid });
    else rentRes.paid = 0;
    store.debt = capDebt(due - rentRes.paid);
    lastRentPaid = rentRes.paid;
    let emi = null;
    if (reason === 'day' && ownedBefore) {
      const t = emiTick(store.ladder);
      store.ladder = t.ladder;
      if (t.emiDue > 0) {
        const paid = ctx.economy.wallet >= t.emiDue && ctx.economy.spend(t.emiDue, 'emi') ? t.emiDue : 0;
        if (paid) ctx.emit('expense', { kind: 'rent', amount: paid, note: 'emi' });
        const r = emiResult(store.ladder, t.emiDue, paid);
        store.ladder = r.ladder;
        emi = { due: t.emiDue, paid, left: store.ladder.emiLeft, missed: store.ladder.missed, repossessed: r.repossessed, cleared: r.cleared };
        emit('career:emi', { due: t.emiDue, paid, left: store.ladder.emiLeft });
        if (r.repossessed) emit('career:repo', {});
      }
    }

    const net = netOf(ledger);
    if (reason === 'day') store.ladder.lifeDays += 1;
    store.ladder = addSavings(store.ladder, net);
    const hisaab = summarize(ledger, {
      day: shift.day,
      lifeDay: store.ladder.lifeDays + (reason === 'day' ? 0 : 1),
      reason,
      hours: Math.round(hours * 10) / 10,
      rent: { perDay, due, paid: rentRes.paid, owed: store.debt, owner: CAREER.owner, ownerTe: CAREER.ownerTe, owned: ownedBefore },
      emi,
      repairCost: quote(),
      damage,
      ladder: ladderView(store.ladder, ctx.economy.wallet),
    });
    const rec = recordDay(store.history, hisaab);
    store.history = rec.history;
    hisaab.newBest = rec.newBest;
    hisaab.best = store.history.best;
    hisaab.history = store.history.days;
    hisaab.ladder = ladderView(store.ladder, ctx.economy.wallet);
    lastHisaab = hisaab;
    saveStore();
    profile?.flush?.();
    emit('career:shift-end', { hisaab });
    if (open && (!state.menu || state.menu === 'pause')) ctx.openMenu('hisaab');
    return hisaab;
  };

  const buyAuto = () => {
    const chk = canBuyAuto(store.ladder, ctx.economy.wallet);
    if (!chk.ok) return chk;
    const dp = CAREER.ladder.downPayment;
    if (!ctx.economy.spend(dp, 'down payment')) return { ok: false, reason: `You need Rs ${dp} in hand` };
    ctx.emit('expense', { kind: 'other', amount: dp, note: 'down-payment' });
    store.ladder = startOwnership(store.ladder);
    saveStore();
    emit('career:own', { downPayment: dp });
    toast('Your own auto! No more rent: the EMI starts', { tone: 'gold', ms: 4200 });
    return { ok: true, reason: '' };
  };

  // ---- events -------------------------------------------------------------------------------------------------------------------
  const off = ctx.game?.on?.((e) => {
    switch (e.type) {
      case 'crash':
        if (!e.guard) onImpact(crashDamage(e.strength));
        break;
      case 'traffic:hit':
        onImpact(hitDamage(e.severity));
        break;
      case 'wallet':
        noteWallet(ledger, e);
        break;
      case 'expense':
        noteExpense(ledger, e);
        break;
      case 'fare:dropoff':
        noteDropoff(ledger, e);
        break;
      default:
    }
  });

  // chai on the Y key (also a button on the job widget)
  const onKey = (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || state.menu) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (String(e.key).toLowerCase() === 'y') drinkChai();
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);

  // ---- the published object -----------------------------------------------------------------------------------------------------
  const emptyExp = { cng: 0, rent: 0, repair: 0, challan: 0, fine: 0, chai: 0, other: 0 };
  const career = {
    get day() { return clock.day; },
    get lifeDay() { return store.ladder.lifeDays + 1; },
    get shiftActive() { return !shift.ended; },
    get shiftHours() { return hours; },
    get rent() {
      return { due: rentNow(), paid: lastRentPaid, perDay: rented() ? CAREER.rent : 0, debt: store.debt, owner: CAREER.owner, ownerTe: CAREER.ownerTe, owned: !rented() };
    },
    get damage() { return damage; },
    get damageLevel() { return damageLevel(damage); },
    get fatigue() { return fatigue; },
    get fatigueLevel() { return fLevel; },
    get fatigueMul() { return mulGrip; },
    get speedMul() { return mulSpeed; },
    get dayStats() { return { earned: earnedOf(ledger), tips: ledger.tips, expenses: { ...emptyExp, ...ledger.expenses } }; },
    get goal() {
      const l = ladderView(store.ladder, ctx.economy.wallet);
      return { id: l.owned ? 'emi' : 'own-auto', en: l.owned ? 'Clear the auto loan' : 'Save for your own auto', te: l.owned ? 'ఆటో అప్పు తీర్చండి' : 'సొంత ఆటో కోసం పొదుపు', progress: l.owned ? 1 - (l.emi?.left ?? 0) / CAREER.ladder.emiCount : l.progress, target: l.downPayment, have: l.savings };
    },
    get ladder() { return ladderView(store.ladder, ctx.economy.wallet); },
    get hisaab() { return lastHisaab; },
    get chai() { return { price: CAREER.fatigue.chaiPrice, cooldown: Math.max(0, chaiLeft) }; },
    repairPrices: { base: CAREER.repair.base, perPoint: CAREER.repair.perPoint },
    peak: () => peak(clock.hour),
    demand,
    repairCost: quote,
    repair,
    drinkChai,
    buyAuto,
    startShift,
    endShift({ open = true } = {}) {
      return finalize('clock-out', open);
    },
  };
  ctx.career = career;

  ctx.addSnapshot(() => ({
    career: {
      day: clock.day,
      lifeDay: store.ladder.lifeDays + 1,
      hours,
      rent: { due: rentNow(), perDay: rented() ? CAREER.rent : 0, debt: store.debt, owned: !rented() },
      damage,
      damageLevel: damageLevel(damage),
      repairCost: quote(),
      fatigue,
      fatigueLevel: fLevel,
      fatigueName: FATIGUE_NAMES[fLevel],
      chai: { price: CAREER.fatigue.chaiPrice, cooldown: Math.max(0, chaiLeft), canBuy: chaiLeft <= 0 && ctx.economy.wallet >= CAREER.fatigue.chaiPrice },
      demand: peak(clock.hour),
      today: { earned: earnedOf(ledger), spent: expenseTotal(ledger), net: netOf(ledger), rides: ledger.rides },
      ladder: ladderView(store.ladder, ctx.economy.wallet),
      hisaab: state.menu === 'hisaab' ? lastHisaab : null,
    },
  }));

  setFatigue(fatigue);
  setDamage(damage);

  ctx.addSystem({
    update(dt) {
      clearCredits(ledger);
      chaiLeft = Math.max(0, chaiLeft - dt);
      const menu = state.menu;

      if (shift.ended) {
        // the books are closed: a new shift begins once the Hisaab is dismissed (or never opened)
        if (menu !== 'hisaab') startShift();
        return;
      }

      hours = Math.max(0, absHours(clock) - shift.startAbs);
      if (Math.abs(clock.hour - bandHour) > 0.02) {
        // the demand band only changes every game hour or so: look at it about once a second, not every frame
        bandHour = clock.hour;
        const band = peak(clock.hour);
        if (band.id !== peakId) {
          peakId = band.id;
          emit('career:peak', { peak: band });
          if (band.peak && !menu) toast(`${band.label}: more customers on the road`, { tone: 'gold', ms: 2600 });
        }
      }

      if (!menu) {
        setFatigue(fatigueStep(fatigue, dt, v.speed > 1.5, secPerHour));
        const r = rattle(damage, v.speed);
        if (r > v.jolt) v.jolt = r;
        if (!rentWarned && rented() && clock.hour >= 22 && clock.hour < 24) {
          rentWarned = true;
          toast(`${CAREER.owner}’s rent is due at midnight: Rs ${rentNow()}`, { tone: 'gold', ms: 3200 });
        }
      }

      if (clock.day > shift.day) pendingEnd = true;
      if (pendingEnd && (!menu || menu === 'pause')) finalize('day', true);
    },
    dispose() {
      off?.();
      if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
      for (const k of hooked) {
        Object.defineProperty(state, k, { configurable: true, enumerable: true, writable: true, value: base[k] });
      }
      saveStore();
    },
  });

  return career;
}
