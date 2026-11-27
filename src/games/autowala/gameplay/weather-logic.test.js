import { describe, expect, it } from 'vitest';
import {
  SEV, approach, dayKind, daySchedule, flashEnvelope, gripCompensation, gripFor, nextFlashDelay, puddleStep, rainFor, roadWetFor,
  scheduledWeather, sevForSky, skyFor, stateAt, stateFor, visibilityFor, wetStep,
} from './weather-logic.js';

describe('weather schedule', () => {
  it('day 1 is dry and day 2 showery', () => {
    expect(dayKind(1)).toBe('dry');
    expect(dayKind(2)).toBe('showers');
    expect(daySchedule(1).every((s) => s.state === 'clear')).toBe(true);
    expect(daySchedule(2).some((s) => s.state === 'rain')).toBe(true);
  });

  it('is deterministic and covers 0..24 without gaps or overlaps', () => {
    for (let day = 1; day <= 40; day++) {
      const a = daySchedule(day, 3);
      expect(JSON.stringify(a)).toBe(JSON.stringify(daySchedule(day, 3)));
      expect(a[0].from).toBe(0);
      expect(a[a.length - 1].to).toBe(24);
      for (let i = 1; i < a.length; i++) {
        expect(a[i].from).toBe(a[i - 1].to);
        expect(a[i].state).not.toBe(a[i - 1].state);
      }
    }
  });

  it('has all four kinds of day over a month, with monsoon days now and then', () => {
    const kinds = new Set();
    let monsoon = 0;
    for (let d = 3; d < 123; d++) {
      const k = dayKind(d, 1);
      kinds.add(k);
      if (k === 'monsoon') monsoon++;
    }
    expect([...kinds].sort()).toEqual(['cloudy', 'dry', 'monsoon', 'showers']);
    expect(monsoon).toBeGreaterThan(5);
    expect(monsoon).toBeLessThan(35);
  });

  it('a monsoon day contains a storm, rain is announced by cloud', () => {
    let d = 3;
    while (dayKind(d, 1) !== 'monsoon') d++;
    const s = daySchedule(d, 1);
    expect(s.some((x) => x.state === 'storm')).toBe(true);
    const i = s.findIndex((x) => x.state === 'rain');
    expect(s[i - 1].state).toBe('cloudy');
  });

  it('looks the state up by hour, wrapping past midnight', () => {
    const s = [{ from: 0, to: 10, state: 'clear' }, { from: 10, to: 24, state: 'rain' }];
    expect(stateAt(s, 3)).toBe('clear');
    expect(stateAt(s, 10)).toBe('rain');
    expect(stateAt(s, 25)).toBe('clear');
    expect(scheduledWeather(1, 12).target).toBe(SEV.clear);
  });
});

describe('transition curve', () => {
  it('moves linearly, never overshoots, rises faster than it falls', () => {
    let v = 0;
    for (let i = 0; i < 60; i++) v = approach(v, 1, 1);
    expect(v).toBe(1);
    expect(approach(0, 1, 7)).toBeCloseTo(0.5, 5);
    expect(approach(1, 0, 7)).toBeCloseTo(0.75, 5);
    expect(approach(0.5, 0.51, 100)).toBe(0.51);
  });

  it('maps severity to a monotone sky / rain / visibility curve', () => {
    let ps = -1;
    let pr = -1;
    let pv = 2;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      expect(skyFor(s)).toBeGreaterThanOrEqual(ps);
      expect(rainFor(s)).toBeGreaterThanOrEqual(pr);
      expect(visibilityFor(s)).toBeLessThanOrEqual(pv);
      ps = skyFor(s);
      pr = rainFor(s);
      pv = visibilityFor(s);
    }
    expect(skyFor(0)).toBe(0);
    expect(skyFor(SEV.cloudy)).toBeLessThan(0.2); // cloud does not wet the roads
    expect(skyFor(SEV.rain)).toBeGreaterThan(0.45); // rain reads as rain to the voices
    expect(skyFor(1)).toBe(1);
    expect(rainFor(SEV.cloudy)).toBe(0);
    expect(rainFor(SEV.storm)).toBe(1);
    expect(visibilityFor(0)).toBe(1);
    expect(visibilityFor(1)).toBeGreaterThan(0.4);
  });

  it('inverts the sky curve', () => {
    for (const sev of [0, 0.25, 0.4, 0.65, 0.9, 1]) expect(sevForSky(skyFor(sev))).toBeCloseTo(sev, 6);
    expect(sevForSky(0.7)).toBeCloseTo(SEV.rain, 6);
  });

  it('names the state with hysteresis', () => {
    expect(stateFor(0, 'clear')).toBe('clear');
    expect(stateFor(0.25, 'clear')).toBe('cloudy');
    expect(stateFor(0.65, 'cloudy')).toBe('rain');
    expect(stateFor(1, 'rain')).toBe('storm');
    expect(stateFor(0.44, 'rain')).toBe('rain'); // stays rain just under the edge
    expect(stateFor(0.44, 'cloudy')).toBe('cloudy');
  });
});

describe('grip, puddles, wet rider', () => {
  it('rain lowers grip, a storm more, dry is 1, standing water keeps it a bit low', () => {
    expect(gripFor(0, 0)).toBe(1);
    expect(gripFor(0.6, 0)).toBeLessThan(0.9);
    expect(gripFor(1, 1)).toBeLessThan(gripFor(0.6, 0));
    expect(gripFor(1, 1)).toBeGreaterThan(0.6);
    expect(gripFor(0, 1)).toBeLessThan(1);
    expect(gripFor(0, 1)).toBeGreaterThan(gripFor(1, 1));
  });

  it('compensates the engine`s own wet-road factor so the total is what we asked for', () => {
    const total = 0.7;
    const comp = gripCompensation(total, 1);
    expect(comp * (1 - 0.28)).toBeCloseTo(total, 5);
    expect(gripCompensation(1, 0)).toBe(1);
    expect(gripCompensation(0.1, 1)).toBe(0.4); // never an unplayable floor
  });

  it('puddles fill in rain and drain in sun, within 0..1', () => {
    let p = 0;
    for (let i = 0; i < 60; i++) p = puddleStep(p, 1, 1);
    expect(p).toBe(1);
    for (let i = 0; i < 30; i++) p = puddleStep(p, 0, 1);
    expect(p).toBeGreaterThan(0.4);
    for (let i = 0; i < 80; i++) p = puddleStep(p, 0, 1);
    expect(p).toBe(0);
    expect(roadWetFor(0, 1)).toBeCloseTo(0.4, 5);
    expect(roadWetFor(0.7, 0.2)).toBe(0.7);
  });

  it('the rider soaks faster at speed, dries slowly', () => {
    const slow = wetStep(0, 1, 0, 10);
    const fast = wetStep(0, 1, 20, 10);
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(0);
    expect(wetStep(0.5, 0, 0, 10)).toBeLessThan(0.5);
    expect(wetStep(0.5, 0, 20, 10)).toBeLessThan(wetStep(0.5, 0, 0, 10));
    expect(wetStep(0.5, 1, 20, 10, true)).toBeLessThan(0.5);
    expect(wetStep(1, 1, 24, 1000)).toBe(1);
    expect(wetStep(0, 0, 0, 1000)).toBe(0);
  });
});

describe('lightning', () => {
  it('only storms flash often, light rain never', () => {
    expect(nextFlashDelay(0.5, 0.5)).toBe(Infinity);
    expect(nextFlashDelay(1, 0)).toBe(4);
    expect(nextFlashDelay(1, 1)).toBe(12);
    expect(nextFlashDelay(0.8, 0.5)).toBeGreaterThan(20);
  });

  it('the flash is a hard strike, a dip and a second strike, then dark', () => {
    expect(flashEnvelope(-1)).toBe(0);
    expect(flashEnvelope(0)).toBe(1);
    expect(flashEnvelope(0.18)).toBeLessThan(0.1);
    expect(flashEnvelope(0.23)).toBeGreaterThan(0.4);
    expect(flashEnvelope(0.6)).toBe(0);
    for (let t = 0; t < 0.6; t += 0.01) {
      const e = flashEnvelope(t);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });
});

describe('scheduledWeather is memoised per day (it is asked every frame)', () => {
  it('gives exactly what building the day gives, across days, seeds and hours', () => {
    for (const seed of [1, 7]) {
      for (let day = 1; day <= 9; day++) {
        for (let h = 0; h < 24; h += 0.7) {
          const sched = daySchedule(day, seed);
          expect(scheduledWeather(day, h, seed).state, `${seed}/${day}/${h}`).toBe(stateAt(sched, h));
        }
      }
    }
  });
  it('does not rebuild the schedule for the same day (no allocation per frame)', () => {
    scheduledWeather(3, 1, 1);
    let rebuilt = 0;
    const real = Array.prototype.fill;
    Array.prototype.fill = function (...a) { rebuilt++; return real.apply(this, a); };
    try {
      for (let i = 0; i < 200; i++) scheduledWeather(3, (i * 0.1) % 24, 1);
    } finally {
      Array.prototype.fill = real;
    }
    expect(rebuilt).toBe(0);
  });
});
