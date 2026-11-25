import { describe, it, expect } from 'vitest';
import { TRAIN, buildSchedule, carOffsets, legPos, legTime, trainLength, trainState } from './metro-trains.js';

describe('leg kinematics', () => {
  it('reaches the end exactly when the leg time is up, from rest to rest', () => {
    for (const d of [60, 200, 330, 700, 1500]) {
      const T = legTime(d);
      const end = legPos(d, T);
      expect(end.x).toBeCloseTo(d, 6);
      expect(end.v).toBe(0);
      expect(legPos(d, 0).x).toBe(0);
    }
  });
  it('is monotonic and never exceeds the cruise speed', () => {
    for (const d of [90, 400, 900]) {
      const T = legTime(d);
      let prev = -1;
      let vmax = 0;
      for (let i = 0; i <= 400; i++) {
        const p = legPos(d, (T * i) / 400);
        expect(p.x).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = p.x;
        vmax = Math.max(vmax, p.v);
      }
      expect(vmax).toBeLessThanOrEqual(TRAIN.cruise + 1e-9);
    }
  });
  it('cruises at ~16 m/s on a long leg and eases in and out', () => {
    const d = 700;
    const T = legTime(d);
    expect(legPos(d, T / 2).v).toBeCloseTo(TRAIN.cruise, 6);
    expect(legPos(d, 1).v).toBeLessThan(2);
    expect(legPos(d, T - 1).v).toBeLessThan(2);
    expect(d / T).toBeLessThan(TRAIN.cruise);
    expect(d / T).toBeGreaterThan(TRAIN.cruise * 0.7);
  });
  it('a short leg is a triangle profile that never reaches cruise', () => {
    const d = 100;
    const T = legTime(d);
    expect(legPos(d, T / 2).v).toBeLessThan(TRAIN.cruise);
  });
});

describe('timetable', () => {
  const stops = [50, 400, 800, 1250, 1600];
  const sched = buildSchedule(stops);
  const st = (t, phase = 0) => trainState(sched, t, phase, {});
  it('starts dwelling at the first station', () => {
    const s = st(0);
    expect(s.s).toBe(50);
    expect(s.v).toBe(0);
    expect(s.dir).toBe(1);
    expect(s.lane).toBe(0);
    expect(s.stop).toBe(0);
  });
  it('dwells 12 s at an interior station with the doors opening and closing', () => {
    const ev = sched.events.find((e) => e.dir === 1 && e.stop === 2);
    expect(ev.dwell).toBe(TRAIN.dwell);
    expect(ev.t1 - ev.t0).toBe(12);
    const mid = st((ev.t0 + ev.t1) / 2);
    expect(mid.s).toBe(800);
    expect(mid.v).toBe(0);
    expect(mid.dwelling).toBe(1);
    expect(st(ev.t0 + 0.2).dwelling).toBe(0);
    expect(st(ev.t1 - 0.2).dwelling).toBe(0);
    expect(st(ev.t1 + 3).s).toBeGreaterThan(800);
  });
  it('terminals dwell longer', () => {
    expect(sched.events[0].dwell).toBe(TRAIN.terminalDwell);
    expect(sched.events.find((e) => e.dir === 1 && e.stop === 4).dwell).toBe(TRAIN.terminalDwell);
  });
  it('runs forward on one track and back on the other', () => {
    const e2 = sched.events.find((e) => e.dir === -1 && e.stop === 4);
    const s2 = st(e2.t1 + 10);
    expect(s2.dir).toBe(-1);
    expect(s2.lane).toBe(1);
    expect(s2.s).toBeLessThan(1600);
    expect(st(5).lane).toBe(0);
  });
  it('visits every station once per direction, in order', () => {
    expect(sched.events.filter((e) => e.dir === 1).map((e) => e.stop)).toEqual([0, 1, 2, 3, 4]);
    expect(sched.events.filter((e) => e.dir === -1).map((e) => e.stop)).toEqual([4, 3, 2, 1, 0]);
  });
  it('wraps around: the state repeats every cycle', () => {
    for (const t of [0, 5, 77, 300.5, 641]) {
      const a = st(t);
      const b = st(t + sched.cycle);
      const c = st(t + 3 * sched.cycle);
      expect(b.s).toBeCloseTo(a.s, 6);
      expect(c.s).toBeCloseTo(a.s, 6);
      expect(b.dir).toBe(a.dir);
    }
    expect(st(-5).s).toBeCloseTo(st(sched.cycle - 5).s, 6);
  });
  it('moves smoothly (no jumps except the turn-around) and respects the speed limit', () => {
    let prev = st(0);
    let vmax = 0;
    for (let t = 0.25; t < sched.cycle * 1.2; t += 0.25) {
      const s = st(t);
      if (s.lane === prev.lane) expect(Math.abs(s.s - prev.s)).toBeLessThanOrEqual(TRAIN.cruise * 0.25 + 0.01);
      prev = s;
      vmax = Math.max(vmax, s.v);
    }
    expect(vmax).toBeLessThanOrEqual(TRAIN.cruise + 1e-9);
    expect(vmax).toBeGreaterThan(14);
  });
  it('phase offsets spread trains out', () => {
    const a = st(100, 0);
    const b = st(100, sched.cycle / 3);
    expect(Math.abs(a.s - b.s) + Math.abs(a.dir - b.dir)).toBeGreaterThan(0);
  });
});

describe('train geometry', () => {
  it('a 3-car set is about 60 m long and cars are centred on the train', () => {
    expect(trainLength()).toBeCloseTo(3 * 19.6 + 2 * 0.6, 6);
    const o = carOffsets();
    expect(o).toHaveLength(3);
    expect(o[1]).toBeCloseTo(0, 9);
    expect(o[0]).toBeCloseTo(-o[2], 9);
    expect(o[0] - o[1]).toBeCloseTo(TRAIN.carLen + TRAIN.carGap, 9);
  });
});
