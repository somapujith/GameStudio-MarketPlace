import { describe, expect, it } from 'vitest';
import { CAREER } from './career-math.js';
import { installCareer, normalizeStore } from './career.js';

/** A fake ctx with just what career.js touches: events, a wallet, a clock, a vehicle and a menu. */
function fake({ wallet = 1000, hour = 8, data = {} } = {}) {
  const listeners = new Set();
  const systems = [];
  const toasts = [];
  const events = [];
  const snaps = [];
  const profile = { data: { settings: {}, ...data }, save() {}, flush() {} };
  const ctx = {
    clock: { hour, day: 1, time: 0 },
    v: { speed: 0, jolt: 0 },
    state: { menu: null, speedMul: 1, gripMul: 1 },
    profile,
    game: { on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } },
    systems,
  };
  ctx.emit = (type, d = {}) => {
    const e = { type, ...d };
    events.push(e);
    for (const l of [...listeners]) l(e);
  };
  let w = wallet;
  ctx.economy = {
    get wallet() { return w; },
    add(n, reason = 'fare') { w += n; ctx.emit('wallet', { wallet: w, delta: n, reason }); },
    spend(n, reason) {
      if (n > w) return false;
      w -= n;
      if (n) ctx.emit('wallet', { wallet: w, delta: -n, reason });
      return true;
    },
  };
  ctx.toast = (t) => toasts.push(t);
  ctx.openMenu = (name) => { ctx.state.menu = name; ctx.emit('menu', { name }); };
  ctx.closeMenu = () => { ctx.state.menu = null; };
  ctx.addSystem = (s) => { systems.push(s); return s; };
  ctx.addSnapshot = (fn) => snaps.push(fn);
  const career = installCareer(ctx);
  // advance by `sec` real seconds of play (1 game hour = 60 s)
  const run = (sec, { speed = 0 } = {}) => {
    ctx.v.speed = speed;
    for (let t = 0; t < sec; t += 0.1) {
      ctx.clock.hour += 0.1 / 60;
      if (ctx.clock.hour >= 24) { ctx.clock.hour -= 24; ctx.clock.day++; }
      ctx.clock.time += 0.1;
      for (const s of systems) s.update(0.1, ctx);
    }
  };
  const fare = (n, rating = 5, tip = 0) => {
    ctx.economy.add(n, 'fare');
    if (tip) ctx.economy.add(tip, 'tip');
    ctx.emit('fare:dropoff', { fare: n, tip, rating });
  };
  return { ctx, career, run, fare, events, toasts, snap: () => snaps[0]().career, w: () => w, profile };
}

describe('damage', () => {
  it('real crashes and traffic hits damage the auto; guard crashes do not', () => {
    const f = fake();
    f.ctx.emit('crash', { strength: 1, tag: 'wall', guard: true });
    expect(f.career.damage).toBe(0);
    f.ctx.emit('crash', { strength: 1 });
    expect(f.career.damage).toBeCloseTo(0.07);
    f.ctx.clock.time = 5;
    f.ctx.emit('traffic:hit', { kind: 'car', severity: 1 });
    expect(f.career.damage).toBeCloseTo(0.125);
    expect(f.events.filter((e) => e.type === 'career:damage')).toHaveLength(2);
  });
  it('one bump that is both a crash and a traffic:hit counts once', () => {
    const f = fake();
    f.ctx.emit('crash', { strength: 0.8 });
    f.ctx.emit('traffic:hit', { kind: 'bike', severity: 0.4 });
    expect(f.career.damage).toBeCloseTo(0.8 * 0.07);
  });
  it('slows the auto and composes with another system writing speedMul', () => {
    const f = fake();
    for (let i = 0; i < 12; i++) {
      f.ctx.clock.time += 5;
      f.ctx.emit('crash', { strength: 1.2 });
    }
    expect(f.career.damage).toBeGreaterThan(0.9);
    const mul = f.career.speedMul;
    expect(mul).toBeLessThan(0.8);
    expect(f.ctx.state.speedMul).toBeCloseTo(mul);
    f.ctx.state.speedMul = 0.9; // the weather agent writes its own value
    expect(f.ctx.state.speedMul).toBeCloseTo(0.9 * mul);
  });
  it('rattles a badly damaged auto when it moves', () => {
    const f = fake();
    for (let i = 0; i < 10; i++) {
      f.ctx.clock.time += 5;
      f.ctx.emit('crash', { strength: 1.4 });
    }
    f.run(0.5, { speed: 15 });
    expect(f.ctx.v.jolt).toBeGreaterThan(0.05);
  });
  it('repairs for the quoted price and tells the books', () => {
    const f = fake({ wallet: 2000 });
    f.ctx.emit('crash', { strength: 1.2 });
    const cost = f.career.repairCost();
    expect(cost).toBeGreaterThan(0);
    const r = f.career.repair();
    expect(r).toMatchObject({ ok: true, cost });
    expect(f.w()).toBe(2000 - cost);
    expect(f.career.damage).toBe(0);
    expect(f.career.speedMul).toBe(1);
    expect(f.events.find((e) => e.type === 'expense')).toMatchObject({ kind: 'repair', amount: cost });
    expect(f.events.some((e) => e.type === 'career:repaired')).toBe(true);
    expect(f.career.dayStats.expenses.repair).toBe(cost);
    expect(f.career.repair().ok).toBe(false); // nothing left to fix
  });
  it('refuses a repair you cannot afford, but does a partial job on request', () => {
    const f = fake({ wallet: 100 });
    for (let i = 0; i < 8; i++) {
      f.ctx.clock.time += 5;
      f.ctx.emit('crash', { strength: 1.2 });
    }
    const before = f.career.damage;
    expect(f.career.repair().ok).toBe(false);
    expect(f.w()).toBe(100);
    const p = f.career.repair({ partial: true });
    expect(p.ok).toBe(true);
    expect(f.w()).toBeLessThan(100);
    expect(f.career.damage).toBeLessThan(before);
    expect(f.career.damage).toBeGreaterThan(0);
  });
});

describe('fatigue and chai', () => {
  it('tires a driver who keeps moving and announces the thresholds', () => {
    const f = fake();
    f.run(60, { speed: 12 });
    expect(f.career.fatigue).toBeGreaterThan(0.15);
    f.run(600, { speed: 12 });
    expect(f.career.fatigue).toBe(1);
    expect(f.career.fatigueMul).toBeCloseTo(1 - CAREER.fatigue.maxGripLoss);
    expect(f.ctx.state.gripMul).toBeCloseTo(f.career.fatigueMul);
    const levels = f.events.filter((e) => e.type === 'career:fatigue').map((e) => e.level);
    expect(levels).toEqual([1, 2, 3]);
    expect(f.events.some((e) => e.type === 'career:tired')).toBe(true);
  });
  it('tires a parked driver much more slowly', () => {
    const f = fake();
    f.run(60, { speed: 0 });
    expect(f.career.fatigue).toBeLessThan(0.1);
  });
  it('a chai resets it, costs rupees, and has a cooldown', () => {
    const f = fake({ wallet: 100 });
    f.run(400, { speed: 12 });
    expect(f.career.fatigueLevel).toBeGreaterThan(1);
    const r = f.career.drinkChai();
    expect(r.ok).toBe(true);
    expect(r.cost).toBeGreaterThanOrEqual(10);
    expect(r.cost).toBeLessThanOrEqual(20);
    expect(f.w()).toBe(100 - r.cost);
    expect(f.career.fatigue).toBe(0);
    expect(f.events.some((e) => e.type === 'career:rested')).toBe(true);
    expect(f.events.find((e) => e.type === 'expense')).toMatchObject({ kind: 'other', amount: r.cost, note: 'chai' });
    expect(f.career.drinkChai().ok).toBe(false); // cooling down
    f.run(CAREER.fatigue.chaiCooldown + 1);
    expect(f.career.drinkChai().ok).toBe(true);
  });
  it('cannot buy chai when broke', () => {
    const f = fake({ wallet: 3 });
    expect(f.career.drinkChai().ok).toBe(false);
    expect(f.w()).toBe(3);
  });
});

describe('the day and the Hisaab', () => {
  it('publishes the demand curve and the snapshot', () => {
    const f = fake({ hour: 18.5 });
    expect(f.career.demand(9)).toBeGreaterThan(1.4);
    expect(f.career.peak().label).toBe('Evening rush');
    const s = f.snap();
    expect(s.demand.peak).toBe(true);
    expect(s.rent).toMatchObject({ perDay: CAREER.rent, owned: false });
    expect(s.ladder.downPayment).toBe(CAREER.ladder.downPayment);
  });
  it('closes the books at midnight: rent, expenses, rides, stars, net profit', () => {
    const f = fake({ wallet: 1000, hour: 8 });
    f.fare(120, 5, 20);
    f.fare(200, 4);
    f.ctx.economy.spend(60, 'fuel');
    f.ctx.emit('expense', { kind: 'cng', amount: 60 }); // fuel.js-style: both events
    f.run(16 * 60 + 5); // 8:00 -> past midnight
    expect(f.ctx.state.menu).toBe('hisaab');
    const h = f.career.hisaab;
    expect(h.reason).toBe('day');
    expect(h).toMatchObject({ earned: 340, tips: 20, rides: 2, bestFare: 200, stars: 4.5 });
    expect(h.expenses.cng).toBe(60);
    expect(h.expenses.rent).toBe(h.rent.paid);
    expect(h.rent.perDay).toBe(CAREER.rent); // 16 hours: the full day
    expect(h.net).toBe(340 - 60 - CAREER.rent);
    expect(f.w()).toBe(1000 + 340 - 60 - CAREER.rent);
    expect(h.ladder.savings).toBe(0); // a losing day banks nothing
    expect(f.events.filter((e) => e.type === 'career:shift-end')).toHaveLength(1);
    expect(f.profile.data.career.history.days).toHaveLength(1);
    expect(f.profile.data.settings.career.history.best.net).toBe(h.net);
    expect(h.newBest).toBe(true);
  });
  it('waits for a free menu, then starts the next shift when the Hisaab is dismissed', () => {
    const f = fake({ hour: 22 });
    f.fare(100);
    f.ctx.state.menu = 'summary';
    f.run(150);
    expect(f.career.hisaab).toBe(null); // the clock-out summary is open: not now
    f.ctx.state.menu = null;
    f.run(1);
    expect(f.ctx.state.menu).toBe('hisaab');
    expect(f.career.shiftActive).toBe(false);
    f.ctx.closeMenu();
    f.run(1);
    expect(f.career.shiftActive).toBe(true);
    expect(f.career.dayStats.earned).toBe(0);
    expect(f.events.some((e) => e.type === 'career:shift-start')).toBe(true);
  });
  it('carries unpaid rent as debt and takes it on the next day', () => {
    const f = fake({ wallet: 50, hour: 8 });
    f.run(16 * 60 + 5);
    const h1 = f.career.hisaab;
    expect(h1.rent.paid).toBe(50);
    expect(h1.rent.owed).toBe(CAREER.rent - 50);
    expect(f.career.rent.debt).toBe(CAREER.rent - 50);
    f.ctx.closeMenu();
    f.fare(900);
    f.run(24 * 60 + 5);
    const h2 = f.career.hisaab;
    expect(h2.rent.due).toBe(CAREER.rent + CAREER.rent - 50);
    expect(h2.rent.owed).toBe(0);
  });
  it('clock-out shows the Hisaab at once, with rent for the hours worked', () => {
    const f = fake({ hour: 9 });
    f.fare(150);
    f.run(4 * 60);
    const h = f.career.endShift();
    expect(h.reason).toBe('clock-out');
    expect(h.hours).toBeCloseTo(4, 0);
    expect(h.rent.perDay).toBe(100);
    expect(h.net).toBe(50);
    expect(h.ladder.savings).toBe(50);
    expect(f.ctx.state.menu).toBe('hisaab');
  });
  it('leaves no Hisaab for a shift that barely began', () => {
    const f = fake();
    f.run(3);
    expect(f.career.endShift()).toBe(null);
    expect(f.ctx.state.menu).toBe(null);
  });
  it('does not charge rent twice for one day: clock out, keep driving, midnight', () => {
    const f = fake({ wallet: 5000, hour: 9 });
    f.fare(200);
    f.run(4 * 60);
    const a = f.career.endShift({ open: false });
    f.run(1);
    f.fare(100);
    f.run(11 * 60);
    f.run(3 * 60);
    const b = f.career.hisaab;
    expect(b.reason).toBe('day');
    expect(a.rent.paid + b.rent.paid).toBeLessThanOrEqual(CAREER.rent + 5);
  });
});

describe('owning your own auto', () => {
  const rich = { ladder: { savings: CAREER.ladder.downPayment } };
  it('needs the savings, then takes the down payment and ends the rent', () => {
    const poor = fake({ wallet: 99999 });
    expect(poor.career.buyAuto().ok).toBe(false);
    const f = fake({ wallet: 30000, hour: 8, data: { career: rich } });
    expect(f.snap().ladder.canBuy).toBe(true);
    expect(f.career.buyAuto().ok).toBe(true);
    expect(f.w()).toBe(30000 - CAREER.ladder.downPayment);
    expect(f.career.rent.owned).toBe(true);
    expect(f.career.rent.perDay).toBe(0);
    expect(f.career.buyAuto().ok).toBe(false);
    f.run(16 * 60 + 5);
    const h = f.career.hisaab;
    expect(h.rent.perDay).toBe(0);
    expect(h.expenses.rent).toBe(0); // the first instalment is a month away
    expect(h.ladder.emi.daysToNext).toBe(CAREER.ladder.monthDays - 1);
  });
  it('takes the instalment when the month ends and keeps the books', () => {
    const f = fake({ wallet: 9000, hour: 8, data: { career: { ladder: { savings: 0, owned: true, emiLeft: 12, daysToEmi: 1 } } } });
    f.run(16 * 60 + 5);
    const h = f.career.hisaab;
    expect(h.emi).toMatchObject({ due: CAREER.ladder.emi, paid: CAREER.ladder.emi, left: 11 });
    expect(h.expenses.rent).toBe(CAREER.ladder.emi);
    expect(f.w()).toBe(9000 - CAREER.ladder.emi);
  });
  it('a missed instalment adds arrears', () => {
    const f = fake({ wallet: 100, hour: 8, data: { career: { ladder: { owned: true, emiLeft: 12, daysToEmi: 1 } } } });
    f.run(16 * 60 + 5);
    expect(f.career.hisaab.emi.paid).toBe(0);
    expect(f.career.ladder.emi.arrears).toBe(CAREER.ladder.emi + CAREER.ladder.lateFee);
  });
});

describe('persistence and cleanup', () => {
  it('normalises a hostile store', () => {
    const s = normalizeStore({ damage: 9, debt: -1, ladder: 'x', history: { days: 5 } });
    expect(s.damage).toBe(1);
    expect(s.debt).toBe(0);
    expect(s.ladder.owned).toBe(false);
    expect(s.history.days).toEqual([]);
  });
  it('restores damage from the profile and gives the speedMul property back on dispose', () => {
    const f = fake({ data: { career: { damage: 0.5 } } });
    expect(f.career.damage).toBe(0.5);
    expect(f.ctx.state.speedMul).toBeLessThan(1);
    f.ctx.systems[0].dispose();
    expect(f.ctx.state.speedMul).toBe(1);
    f.ctx.state.speedMul = 0.8;
    expect(f.ctx.state.speedMul).toBe(0.8);
    f.ctx.emit('crash', { strength: 1 });
    expect(f.career.damage).toBe(0.5); // no longer listening
  });
  it('never throws on a bare ctx without profile or toast', () => {
    const f = fake();
    f.ctx.toast = undefined;
    f.ctx.emit('fare:dropoff', {});
    f.ctx.emit('wallet', {});
    f.ctx.emit('expense', {});
    expect(() => f.run(2)).not.toThrow();
  });
});
