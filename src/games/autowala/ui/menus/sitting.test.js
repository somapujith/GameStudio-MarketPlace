import { describe, it, expect } from 'vitest';
import { createSitting, runStatsFrom, summaryDistance, summaryTime } from './sitting.js';

function fakeGame() {
  const listeners = new Set();
  const game = {
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    emit: (type, data = {}) => listeners.forEach((l) => l({ type, ...data })),
    listeners,
    ctx: {
      clock: { time: 100 },
      economy: { session: { earned: 50, tips: 5, fares: 40, spent: 0 } },
      profile: { data: { distance: 1000, rides: 7, wallet: 900 }, rating: () => 4.6 },
    },
  };
  return game;
}
const runs = () => { const r = { started: 0, start() { r.started++; return Promise.resolve({ ok: true }); } }; return r; };

describe('createSitting', () => {
  it('measures from begin(), not from the start of the game', () => {
    const g = fakeGame();
    let wall = 5000;
    const r = runs();
    const s = createSitting(g, r, { now: () => wall });
    s.begin();
    expect(r.started).toBe(1);
    g.ctx.clock.time = 190;
    wall += 90_000;
    g.ctx.economy.session.earned = 530;
    g.ctx.economy.session.tips = 25;
    g.ctx.profile.data.distance = 2850.6;
    g.emit('fare:dropoff', { fare: 180, tip: 20, rating: 5 });
    g.emit('fare:dropoff', { fare: 300, tip: 0, rating: 4 });
    g.emit('honk');
    const st = s.stats();
    expect(st).toMatchObject({ earned: 480, tips: 20, fares: 2, distance: 1851, seconds: 90, bestFare: 300, rides: 7, wallet: 900, lifetimeRating: 4.6 });
    expect(st.rating).toBeCloseTo(4.5, 5);
    for (const k of ['earned', 'tips', 'fares', 'distance', 'seconds', 'bestFare']) expect(Number.isInteger(st[k])).toBe(true);
  });

  it('seconds never exceed the real elapsed time (fast-forwarded sim) nor the server maximum', () => {
    const g = fakeGame();
    let wall = 0;
    const s = createSitting(g, runs(), { now: () => wall });
    s.begin();
    g.ctx.clock.time = 100 + 3000; // sim ran far ahead of the wall clock
    wall = 10_000;
    expect(s.stats().seconds).toBe(10);
    wall = 99_999_000;
    g.ctx.clock.time = 100 + 99_999;
    expect(s.stats().seconds).toBe(7200);
  });

  it('ignores drop-offs before begin() and starts over on the next begin()', () => {
    const g = fakeGame();
    const s = createSitting(g, runs(), { now: () => 0 });
    g.emit('fare:dropoff', { fare: 999 });
    s.begin();
    expect(s.stats().fares).toBe(0);
    g.emit('fare:dropoff', { fare: 120, rating: 3 });
    expect(s.stats()).toMatchObject({ fares: 1, bestFare: 120 });
    g.ctx.economy.session.earned = 200;
    s.begin();
    expect(s.stats()).toMatchObject({ fares: 0, bestFare: 0, earned: 0, rating: 0 });
  });

  it('copes with missing optional fields and junk events, and unsubscribes on dispose', () => {
    const g = fakeGame();
    const s = createSitting(g, runs(), { now: () => 0 });
    s.begin();
    g.emit('fare:dropoff', { fare: 'x', tip: -5, rating: NaN });
    expect(s.stats()).toMatchObject({ fares: 1, bestFare: 0, tips: 0, rating: 0 });
    s.dispose();
    expect(g.listeners.size).toBe(0);
  });

  it('works before begin() (all zero) and maps to the run API shape', () => {
    const g = fakeGame();
    const s = createSitting(g, runs(), { now: () => 0 });
    expect(s.started).toBe(false);
    expect(s.stats()).toMatchObject({ earned: 0, fares: 0, seconds: 0, distance: 0 });
    expect(runStatsFrom({ earned: 5, seconds: 40, distance: 90, fares: 1, tips: 2 })).toEqual({ earned: 5, seconds: 40, distance: 90, fares: 1, quests: 0, style: 0 });
  });
});

describe('summary formats', () => {
  it('distance and time', () => {
    expect(summaryDistance(420.4)).toBe('420 m');
    expect(summaryDistance(3456)).toBe('3.5 km');
    expect(summaryDistance(-4)).toBe('0 m');
    expect(summaryTime(5)).toBe('0:05');
    expect(summaryTime(725)).toBe('12:05');
    expect(summaryTime(3729)).toBe('1:02:09');
    expect(summaryTime(NaN)).toBe('0:00');
  });
});
