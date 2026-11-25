import { describe, expect, it } from 'vitest';
import { makeRng } from '../game/rng.js';
import { FARE, KINDS, KIND_IDS, NAMES, makeIdentity, pickKind } from './fare-kinds.js';
import { brakeHit, complaintReason, crashHit, estimateFare, meterNow, moodStep, patienceStep, rushTimeLimit, settleRide, starsFromScore } from './fare-math.js';

const ride = (kind, kmh, seconds, extra = {}, mood0) => {
  let mood = mood0 ?? KINDS[kind].start;
  let sum = 0;
  let n = 0;
  for (let t = 0; t < seconds; t += 0.1) {
    mood = moodStep(kind, mood, { kmh, jolt: 0, drifting: false, ...extra }, 0.1);
    sum += mood;
    n++;
  }
  return { mood, avg: sum / n };
};

describe('fare kinds', () => {
  it('has exactly the six voice-contract ids, each with Telugu names', () => {
    expect(KIND_IDS.sort()).toEqual(['elder', 'regular', 'rusher', 'student', 'tourist', 'women']);
    for (const k of KIND_IDS) {
      expect(NAMES[k].length).toBeGreaterThanOrEqual(4);
      for (const n of NAMES[k]) {
        expect(n.name.length).toBeGreaterThan(2);
        expect(/[ఀ-౿]/.test(n.te)).toBe(true);
      }
    }
  });

  it('spawns elder and women often, rusher and tourist rarely', () => {
    const rng = makeRng(7);
    const c = Object.fromEntries(KIND_IDS.map((k) => [k, 0]));
    for (let i = 0; i < 4000; i++) c[pickKind(rng)]++;
    expect(c.elder).toBeGreaterThan(c.rusher * 1.8);
    expect(c.women).toBeGreaterThan(c.tourist * 1.8);
    for (const k of KIND_IDS) expect(c[k]).toBeGreaterThan(100);
  });

  it('makes identities with a gender, 1-2 riders and a 45-100 s patience', () => {
    const rng = makeRng(3);
    for (let i = 0; i < 200; i++) {
      const kind = pickKind(rng);
      const id = makeIdentity(rng, kind);
      expect([1, 2]).toContain(id.pax);
      expect(id.patienceSeconds).toBeGreaterThanOrEqual(45);
      expect(id.patienceSeconds).toBeLessThanOrEqual(100);
      expect(typeof id.female).toBe('boolean');
    }
  });
});

describe('fare calculation', () => {
  it('quotes base + per-metre on the estimated road distance, scaled by kind', () => {
    const reg = estimateFare('regular', 600);
    expect(reg).toBe(Math.round(FARE.base + FARE.perMeter * 600 * FARE.routeFactor));
    expect(estimateFare('tourist', 600)).toBeGreaterThan(reg * 1.4);
    expect(estimateFare('student', 600)).toBeLessThan(reg);
  });

  it('typical rides pay 80-350 rupees, and never leave the clamp', () => {
    for (const kind of KIND_IDS) {
      for (const d of [250, 500, 800, 1100]) {
        const f = estimateFare(kind, d);
        expect(f).toBeGreaterThanOrEqual(FARE.min);
        expect(f).toBeLessThanOrEqual(FARE.max);
      }
    }
    for (const d of [400, 600, 800]) expect(estimateFare('regular', d)).toBeGreaterThanOrEqual(80);
    expect(estimateFare('regular', 1100)).toBeLessThanOrEqual(350);
    expect(estimateFare('tourist', 250)).toBeGreaterThan(80);
  });

  it('is monotonic in distance', () => {
    let last = 0;
    for (let d = 100; d <= 1200; d += 50) {
      const f = estimateFare('elder', d);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
  });

  it('meter ticks with distance driven and waiting seconds, and is capped near the estimate', () => {
    const est = estimateFare('regular', 600);
    const a = meterNow('regular', 0, 0, est);
    const b = meterNow('regular', 400, 0, est);
    const c = meterNow('regular', 400, 20, est);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(meterNow('regular', 20000, 0, est)).toBeLessThanOrEqual(Math.round(est * FARE.meterCapFactor));
    expect(meterNow('regular', 600 * FARE.routeFactor, 0, est)).toBeCloseTo(est, -1);
  });

  it('gives a rusher a deadline that grows with the trip', () => {
    expect(rushTimeLimit(900)).toBeGreaterThan(rushTimeLimit(300));
    expect(rushTimeLimit(300)).toBeGreaterThan(40);
  });
});

describe('passenger mood', () => {
  it('an elder is happy on a gentle ride and hates speed', () => {
    const calm = ride('elder', 35, 60);
    expect(calm.mood).toBeGreaterThan(0.9);
    const fast = ride('elder', 70, 25);
    expect(fast.mood).toBeLessThan(0.3);
  });

  it('a student loves speed and drifting, a woman dislikes drifting', () => {
    expect(ride('student', 80, 20).mood).toBeGreaterThan(KINDS.student.start);
    expect(ride('student', 50, 3, { drifting: true }).mood).toBeGreaterThan(ride('student', 50, 3).mood);
    expect(ride('women', 40, 20, { drifting: true }).mood).toBeLessThan(KINDS.women.start - 0.1);
    expect(ride('tourist', 40, 20, { drifting: true }).mood).toBeGreaterThanOrEqual(KINDS.tourist.start - 0.05);
  });

  it('a tourist enjoys scenery; jolts and crashes cost mood, more so for an elder', () => {
    expect(ride('tourist', 30, 15, { scenic: true }).mood).toBeGreaterThan(ride('tourist', 30, 15).mood);
    const rough = (k) => ride(k, 30, 5, { jolt: 0.8 }).mood;
    expect(rough('elder')).toBeLessThan(KINDS.elder.start - 0.1);
    expect(KINDS.elder.start - rough('elder')).toBeGreaterThan(KINDS.student.start - rough('student'));
    expect(crashHit('elder', 0.9, 0.8)).toBeLessThan(crashHit('student', 0.9, 0.8));
    expect(brakeHit('elder', 0.5)).toBeLessThan(0.5);
    expect(crashHit('elder', 0.05, 1)).toBe(0);
  });

  it('stays inside 0..1', () => {
    let m = 0.5;
    for (let i = 0; i < 2000; i++) m = moodStep('elder', m, { kmh: 200, jolt: 1, drifting: true }, 0.1);
    expect(m).toBe(0);
    for (let i = 0; i < 2000; i++) m = moodStep('student', m, { kmh: 120, jolt: 0, drifting: true }, 0.1);
    expect(m).toBe(1);
  });

  it('reports what to complain about', () => {
    expect(complaintReason('elder', { kmh: 30, jolt: 0.7 })).toBe('jolt');
    expect(complaintReason('elder', { kmh: 70, jolt: 0 })).toBe('speed');
    expect(complaintReason('women', { kmh: 30, jolt: 0, drifting: true })).toBe('drift');
    expect(complaintReason('student', { kmh: 100, jolt: 0, drifting: true })).toBe(null);
    expect(complaintReason('elder', { kmh: 30, jolt: 0 })).toBe(null);
  });
});

describe('stars, tips and settlement', () => {
  it('maps a score to 1-5 stars', () => {
    expect(starsFromScore(1)).toBe(5);
    expect(starsFromScore(0.9)).toBe(5);
    expect(starsFromScore(0.7)).toBe(4);
    expect(starsFromScore(0.5)).toBe(3);
    expect(starsFromScore(0.3)).toBe(2);
    expect(starsFromScore(0.05)).toBe(1);
  });

  it('a smooth ride earns an elder 5 stars and a big tip; a rough one earns none', () => {
    const good = settleRide({ kind: 'elder', fareNow: 200, mood: 0.95, avgMood: 0.92, timeLimit: null, timeLeft: null });
    expect(good.stars).toBe(5);
    expect(good.tip).toBeGreaterThanOrEqual(80);
    const bad = settleRide({ kind: 'elder', fareNow: 200, mood: 0.2, avgMood: 0.4, timeLimit: null, timeLeft: null });
    expect(bad.stars).toBeLessThanOrEqual(2);
    expect(bad.tip).toBe(0);
    expect(bad.fare).toBe(200);
  });

  it('tips follow the kind: student lowest, tourist and elder generous, women fair', () => {
    const tip = (kind) => settleRide({ kind, fareNow: 200, mood: 1, avgMood: 1 }).tip;
    expect(tip('student')).toBeLessThan(tip('regular'));
    expect(tip('regular')).toBeLessThan(tip('women'));
    expect(tip('women')).toBeLessThan(tip('tourist'));
    expect(tip('tourist')).toBeLessThanOrEqual(tip('elder'));
  });

  it('a rusher tips big for speed, nothing and a cut fare when late', () => {
    const limit = rushTimeLimit(800);
    const early = settleRide({ kind: 'rusher', fareNow: 250, mood: 0.8, avgMood: 0.8, timeLimit: limit, timeLeft: limit * 0.5 });
    const justIn = settleRide({ kind: 'rusher', fareNow: 250, mood: 0.8, avgMood: 0.8, timeLimit: limit, timeLeft: 2 });
    const late = settleRide({ kind: 'rusher', fareNow: 250, mood: 0.8, avgMood: 0.8, timeLimit: limit, timeLeft: -30 });
    expect(early.tip).toBeGreaterThan(justIn.tip);
    expect(early.tip).toBeGreaterThan(100);
    expect(late.tip).toBe(0);
    expect(late.late).toBe(true);
    expect(late.fare).toBeLessThan(250);
    expect(late.stars).toBeLessThan(early.stars);
  });
});

describe('patience', () => {
  it('runs from 1 to 0 in the customer\'s waiting time and stops at 0', () => {
    let p = 1;
    for (let t = 0; t < 60; t += 0.5) p = patienceStep(p, 60, 0.5);
    expect(p).toBeCloseTo(0, 5);
    expect(patienceStep(0, 60, 1)).toBe(0);
    expect(patienceStep(1, 50, 5)).toBeCloseTo(0.9, 5);
  });

  it('can be slowed (a ride in progress)', () => {
    expect(patienceStep(1, 50, 10, 0.5)).toBeGreaterThan(patienceStep(1, 50, 10, 1));
    expect(patienceStep(1, 50, 0, 1)).toBe(1);
  });
});
