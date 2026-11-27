import { describe, expect, it } from 'vitest';
import { formatCountdown, formatDistance, formatEta, rageView, timerTone } from './hudLogic.js';
import { createSnapStore, createViewReader, shallowEqual } from './snapStore.js';
import { alertsSelector, countdownBucket, distanceBucket, etaBucket, rageViewOf, rulesViewOf, selClock, selDrift, selFx, selGauge, selShell, selTrip, selWallet, step, tripViewOf } from './views.js';
import { same } from '../../game/snapshot.js';

describe('the roundings leave every printed text exactly as it was', () => {
  it('distanceBucket: formatDistance(bucket(m)) === formatDistance(m) for 0..60 km (the 995 m and 9.95 km quirks included), and a bucket is stable', () => {
    for (let m = 0; m <= 60000; m += 0.5) {
      const b = distanceBucket(m);
      expect(formatDistance(b), `m=${m}`).toBe(formatDistance(m));
      expect(distanceBucket(b), `m=${m}`).toBe(b);
    }
    expect(distanceBucket(null)).toBeNull();
    expect(distanceBucket(undefined)).toBeUndefined();
  });
  it('etaBucket: the minute formatEta prints', () => {
    for (let s = 0; s <= 20000; s += 0.5) {
      const b = etaBucket(s);
      expect(formatEta(b), `s=${s}`).toBe(formatEta(s));
      expect(etaBucket(b)).toBe(b);
    }
    expect(etaBucket(null)).toBeNull();
  });
  it('countdownBucket: the second formatCountdown prints, and the tone (thresholds at 10 and 25 s) does not move', () => {
    for (let s = 0; s <= 400; s += 0.05) {
      const b = countdownBucket(s);
      expect(formatCountdown(b), `s=${s}`).toBe(formatCountdown(s));
      expect(timerTone(b), `s=${s}`).toBe(timerTone(s));
    }
    expect(countdownBucket(null)).toBeNull();
    expect(countdownBucket(-3)).toBe(0);
  });
  it('step rounds to a resolution', () => {
    expect(step(0.337, 0.01)).toBeCloseTo(0.34, 10);
    expect(step(0.337, 0.05)).toBeCloseTo(0.35, 10);
    expect(step('x', 0.1)).toBe(0);
  });
});

describe('a ride that ticks produces the same trip view until the printed text changes', () => {
  const trip = (o = {}) => ({ name: 'Salma', kind: 'foodie', pax: 1, status: 'riding', fareNow: 148, distanceLeft: 2310, timeLeft: 42.4, mood: 0.7012, dest: { name: 'Charminar', te: 'à°šà°¾à°°à±à°®à°¿à°¨à°¾à°°à±' }, ...o });
  const route = (o = {}) => ({ length: 2310, eta: 190, nextTurn: 'left', turnDistance: 83, ...o });
  it('10 m of road, a tenth of a second and a hair of mood are the same view', () => {
    const a = tripViewOf(trip(), route());
    const b = tripViewOf(trip({ timeLeft: 42.3, mood: 0.7022 }), route({ length: 2308, turnDistance: 81, eta: 189 }));
    expect(same(a, b)).toBe(true);
  });
  it('a whole second, a printed distance step or a fare change is a different view', () => {
    const a = tripViewOf(trip(), route());
    expect(same(a, tripViewOf(trip({ timeLeft: 40.9 }), route()))).toBe(false);
    expect(same(a, tripViewOf(trip(), route({ length: 2100 })))).toBe(false);
    expect(same(a, tripViewOf(trip({ fareNow: 150 }), route()))).toBe(false);
  });
  it('no trip, no view; the time fraction is dropped (nothing prints it)', () => {
    expect(tripViewOf(null, null)).toBeNull();
    expect(tripViewOf(trip({ timeTotal: 100 }), route()).timeFrac).toBeNull();
  });
  it('selTrip reads the snapshot', () => {
    expect(selTrip({ trip: trip(), route: route() }).name).toBe('Salma');
    expect(selTrip({})).toBeNull();
  });
});

describe('rules and rage', () => {
  const rules = (d) => ({ limit: 40, zone: 'city', speeding: false, signalAhead: { state: 'red', dist: d, left: 6.2, watched: true }, cameraAhead: { dist: d + 30, limit: 40 }, checkpoint: { phase: 'near', dist: d - 20 } });
  it('distances move in steps of what the chips print', () => {
    expect(same(rulesViewOf(rules(52), 20), rulesViewOf(rules(54), 20))).toBe(true);
    expect(same(rulesViewOf(rules(52), 20), rulesViewOf(rules(65), 20))).toBe(false);
    expect(rulesViewOf(null, 0)).toBeNull();
  });
  it('speeding past a camera is exact (not rounded away)', () => {
    expect(rulesViewOf(rules(55), 50).camera.over).toBe(true);
    expect(rulesViewOf(rules(55), 30).camera.over).toBe(false);
  });
  it('rageViewOf keeps what rageView needs and is null while the chase is off', () => {
    expect(rageViewOf({ active: false })).toBeNull();
    const r = rageViewOf({ active: true, heat: 0.503, escape: 0.2, caughtIn: 0.104, chasers: 2 });
    expect(rageView(r)).toMatchObject({ heat: 0.5, escape: 0.2, chasers: 2 });
    expect(rageView(r).caught).toBeCloseTo(0.1, 5);
  });
  it('alertsSelector: which chips (capped), their data and the mission; stable while only distances tick inside a bucket', () => {
    const sel = alertsSelector(2);
    const snap = { kmh: 20, rules: rules(52), rage: { active: true, heat: 0.5, escape: 0.2, caughtIn: 0.1, chasers: 1 }, quest: { active: { title: 'Biryani run', timeLeft: 94.8 } } };
    const v = sel(snap);
    expect(v.kinds).toHaveLength(2);
    expect(v.mission).toEqual({ title: 'Biryani run', left: 95 });
    expect(same(v, sel({ ...snap, rules: rules(54), quest: { active: { title: 'Biryani run', timeLeft: 94.2 } } }))).toBe(true);
    expect(sel({ kmh: 0 })).toMatchObject({ kinds: [], rules: null, rage: null, mission: null });
    expect(alertsSelector(0)(snap).kinds).toEqual([]);
  });
});

describe('small views', () => {
  it('the shell view only carries the three facts the layout attributes need', () => {
    expect(selShell({ menu: 'pause', trip: { fare: 1 }, fareChoice: null })).toEqual({ menu: 'pause', tripOn: true, fareOn: false });
    expect(selShell({})).toEqual({ menu: null, tripOn: false, fareOn: false });
  });
  it('wallet, clock and drift pick their own keys', () => {
    expect(selWallet({ wallet: 5, rating: 4, rides: 2, kmh: 9 })).toEqual({ wallet: 5, rating: 4, rides: 2 });
    expect(selClock({ hour: 12.5, day: 3, kmh: 9 })).toEqual({ hour: 12.5, day: 3 });
    expect(selDrift({ drifting: 1, driftCharge: 0.337 })).toEqual({ drifting: true, charge: expect.closeTo(0.34, 5) });
  });
  it('the gauge view has no speed in it: the speed ticking does not change it', () => {
    const a = { kmh: 20, fuel: 0.7, fuelLitres: 8.4, driftCharge: 0.1, boosting: false, drifting: false, rules: { limit: 40, zone: 'city' } };
    const store = createSnapStore(a);
    const r = createViewReader(store, selGauge);
    const v = r.read();
    store.set({ ...a, kmh: 21 });
    expect(r.read()).toBe(v);
    store.set({ ...a, kmh: 21, fuel: 0.69 });
    expect(r.read()).not.toBe(v);
  });
  it('the effects view moves in percents and changes with boost', () => {
    const calm = selFx({ kmh: 0, fuel: 1 });
    expect(calm.vignette).toBe(0);
    expect(selFx({ kmh: 100, fuel: 1, boosting: true }).boosting).toBe(true);
    expect(selFx({ kmh: 60, fuel: 0.1 }).fuelPulse).toBe(true);
    expect(selFx({ kmh: 60, fuel: 1, rage: { active: true, heat: 0.5 } }).rage).toBe(true);
    expect(shallowEqual(selFx({ kmh: 60, fuel: 1 }), selFx({ kmh: 60.02, fuel: 1 }))).toBe(true);
  });
});
