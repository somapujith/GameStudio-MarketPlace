import { describe, expect, it } from 'vitest';
import { HYSTERESIS, MAX_RTT, SIGNAL_LEVELS, isRtt, levelInfo, rttText, rttToLevel, signalSentence, smoothRtt } from './signal.js';

describe('rttToLevel', () => {
  it('maps the documented thresholds (edges belong to the better level)', () => {
    expect(rttToLevel(0)).toBe(4);
    expect(rttToLevel(35)).toBe(4);
    expect(rttToLevel(90)).toBe(4);
    expect(rttToLevel(91)).toBe(3);
    expect(rttToLevel(180)).toBe(3);
    expect(rttToLevel(181)).toBe(2);
    expect(rttToLevel(350)).toBe(2);
    expect(rttToLevel(351)).toBe(1);
    expect(rttToLevel(MAX_RTT)).toBe(1);
  });

  it('returns null for anything that is not a measurement', () => {
    for (const bad of [-1, NaN, Infinity, MAX_RTT + 1, '90', null, undefined, {}, []]) expect(rttToLevel(bad)).toBeNull();
  });

  it('keeps the current level inside its hysteresis band, and only then', () => {
    expect(rttToLevel(95, 4)).toBe(4); // just past 90 ms but within 12%
    expect(rttToLevel(100, 4)).toBe(4);
    expect(rttToLevel(105, 4)).toBe(3);
    expect(rttToLevel(85, 3)).toBe(3); // just under 90 ms: a level-3 link does not jump up yet
    expect(rttToLevel(70, 3)).toBe(4);
    expect(rttToLevel(190, 3)).toBe(3);
    expect(rttToLevel(205, 3)).toBe(2);
    expect(rttToLevel(330, 1)).toBe(1); // a poor link recovers only once clearly under 350 ms
    expect(rttToLevel(300, 1)).toBe(2);
    expect(rttToLevel(5000, 4)).toBe(1); // big jumps are never held back
    expect(rttToLevel(20, 1)).toBe(4);
    expect(rttToLevel(120, 99)).toBe(3); // an unknown previous level is ignored
    expect(rttToLevel(120, null)).toBe(3);
    expect(HYSTERESIS).toBeGreaterThan(0);
  });
});

describe('levelInfo', () => {
  it('has a label and a colour token for every level', () => {
    expect(SIGNAL_LEVELS.map((l) => l.level)).toEqual([4, 3, 2, 1]);
    expect(levelInfo(4)).toMatchObject({ label: 'Excellent', color: 'sg-4' });
    expect(levelInfo(3)).toMatchObject({ label: 'Good', color: 'sg-3' });
    expect(levelInfo(2)).toMatchObject({ label: 'Fair', color: 'sg-2' });
    expect(levelInfo(1)).toMatchObject({ label: 'Poor', color: 'sg-1' });
    expect(levelInfo(0)).toMatchObject({ label: 'Offline', color: 'sg-off', level: 0 });
  });

  it('treats null / unknown as "measuring"', () => {
    for (const v of [null, undefined, 7, 'x']) expect(levelInfo(v)).toMatchObject({ key: 'measuring', level: null, color: 'sg-none' });
  });
});

describe('smoothRtt', () => {
  it('takes the median of the last three samples, so one slow packet does not move the bars', () => {
    expect(smoothRtt([80, 900, 81])).toBe(81);
    expect(smoothRtt([5000, 5000, 80, 900, 79])).toBe(80); // only the last three count: 80 900 79
    expect(smoothRtt([100])).toBe(100);
    expect(smoothRtt([100, 200])).toBe(150);
    expect(smoothRtt([80, 82, 900, 79, 81], 5)).toBe(81); // a wider window on request
  });

  it('follows a real change after two more samples', () => {
    expect(smoothRtt([40, 40, 40, 400])).toBe(40);
    expect(smoothRtt([40, 40, 40, 400, 400])).toBe(400);
  });

  it('ignores garbage and returns null without data', () => {
    expect(smoothRtt([])).toBeNull();
    expect(smoothRtt(null)).toBeNull();
    expect(smoothRtt([NaN, -3, 'x'])).toBeNull();
    expect(smoothRtt([NaN, 60, undefined])).toBe(60);
  });
});

describe('text', () => {
  it('isRtt', () => {
    expect(isRtt(0)).toBe(true);
    expect(isRtt(20000)).toBe(true);
    expect(isRtt(20001)).toBe(false);
    expect(isRtt(-0.1)).toBe(false);
  });

  it('rttText rounds to 10 ms', () => {
    expect(rttText(123)).toBe('about 120 ms');
    expect(rttText(4)).toBe('under 10 ms');
    expect(rttText(null)).toBe('');
  });

  it('signalSentence is what a screen reader hears', () => {
    expect(signalSentence(3, 120)).toBe('Connection: good, 3 of 4 bars, about 120 ms');
    expect(signalSentence(1, null)).toBe('Connection: poor, 1 of 4 bars');
    expect(signalSentence(0, 50)).toBe('Connection: offline');
    expect(signalSentence(null, null)).toBe('Connection: measuring');
  });
});
