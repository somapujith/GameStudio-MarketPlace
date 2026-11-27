import { describe, expect, it } from 'vitest';
import { advanceClock } from './clock.js';
import { DAY } from './config.js';

const fresh = (hour = 17.4) => ({ hour, time: 0, sim: 0, day: 1 });

describe('advanceClock', () => {
  it('runs the calendar and the world clock while playing: a game day is 24 minutes', () => {
    const c = fresh(0);
    for (let i = 0; i < 24 * 60 * 60; i++) advanceClock(c, 1 / 60, false, DAY.secondsPerHour);
    expect(c.day).toBe(2);
    expect(c.hour).toBeCloseTo(0, 3);
    expect(c.sim).toBeCloseTo(24 * 60, 3);
    expect(c.time).toBeCloseTo(24 * 60, 3);
  });

  it('a menu freezes the calendar and the world clock but not the play time', () => {
    const c = fresh();
    advanceClock(c, 10, true, DAY.secondsPerHour);
    expect(c).toMatchObject({ hour: 17.4, day: 1, sim: 0, time: 10 });
    advanceClock(c, 30, false, DAY.secondsPerHour);
    expect(c.hour).toBeCloseTo(17.4 + 0.5, 10);
    expect(c.sim).toBe(30);
    expect(c.time).toBe(40);
  });

  it('ten minutes on the Start screen cost no rent hours (the day did not move)', () => {
    const c = fresh();
    for (let i = 0; i < 10 * 60 * 60; i++) advanceClock(c, 1 / 60, true, DAY.secondsPerHour);
    expect(c.day).toBe(1);
    expect(c.hour).toBe(17.4);
  });

  it('a long frame cannot skip a midnight', () => {
    const c = fresh(23.9);
    advanceClock(c, 3 * 60, false, DAY.secondsPerHour); // three game hours at once
    expect(c.day).toBe(2);
    expect(c.hour).toBeCloseTo(2.9, 10);
    const d = fresh(23.5);
    advanceClock(d, 60 * 49, false, DAY.secondsPerHour);
    expect(d.day).toBe(4); // 23.5 h + 49 h = 72.5 h: three midnights
    expect(d.hour).toBeCloseTo(0.5, 10);
  });
});
