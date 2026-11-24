import { describe, expect, it } from 'vitest';
import { PENTA_MAJOR, PENTA_MINOR, ROOT_HZ, TABLA_PATTERN, degreeSemis, fanfarePlan, semisToHz, tablaStepSeconds } from './score.js';

const inScale = (semis, scale) => scale.includes(((semis % 12) + 12) % 12);

describe('scale helpers', () => {
  it('maps degrees to semitones across octaves', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => degreeSemis(d))).toEqual([0, 2, 4, 7, 9, 12, 14]);
    expect(degreeSemis(-1)).toBe(-3);
    expect(degreeSemis(-5)).toBe(-12);
    expect(degreeSemis(2, PENTA_MINOR)).toBe(5);
  });
  it('converts semitones to Hz around Sa', () => {
    expect(semisToHz(0)).toBeCloseTo(ROOT_HZ, 6);
    expect(semisToHz(12)).toBeCloseTo(ROOT_HZ * 2, 6);
  });
});

describe('fanfarePlan', () => {
  it('is a major pentatonic phrase on tabla, longer and fuller with more stars', () => {
    const p = [1, 2, 3].map((stars) => fanfarePlan({ win: true, stars }));
    expect(p[1].notes.length).toBeGreaterThan(p[0].notes.length);
    expect(p[2].notes.length).toBeGreaterThan(p[1].notes.length);
    expect(p[2].length).toBeGreaterThan(p[0].length);
    for (const plan of p) {
      expect(plan.length).toBeLessThan(3.5); // short
      for (const n of plan.notes) {
        expect(inScale(n.semis, PENTA_MAJOR), `semis ${n.semis}`).toBe(true);
        expect(n.t).toBeGreaterThanOrEqual(0);
        expect(n.d).toBeGreaterThan(0);
        expect(n.v).toBeGreaterThan(0);
      }
      expect(plan.hits.length).toBeGreaterThanOrEqual(3);
      expect(plan.hits.some((h) => h.kind === 'dha')).toBe(true);
      for (const h of plan.hits) expect(h.t).toBeLessThanOrEqual(plan.length);
    }
  });
  it('closed: a minor falling sigh, softer, no bright dha', () => {
    const p = fanfarePlan({ win: false });
    const semis = p.notes.map((n) => n.semis);
    for (let i = 1; i < semis.length; i++) expect(semis[i]).toBeLessThan(semis[i - 1]);
    for (const n of p.notes) expect(inScale(n.semis, PENTA_MINOR)).toBe(true);
    expect(p.notes.at(-1).bend).toBeLessThan(0);
    expect(p.hits.every((h) => h.kind !== 'dha')).toBe(true);
  });
  it('clamps odd star values', () => {
    expect(fanfarePlan({ win: true, stars: 0 }).notes.length).toBe(fanfarePlan({ win: true, stars: 1 }).notes.length);
    expect(fanfarePlan({ win: true, stars: 7 }).notes.length).toBe(fanfarePlan({ win: true, stars: 3 }).notes.length);
  });
});

describe('tabla loop', () => {
  it('is an 8-step pattern with a steady, unhurried step', () => {
    expect(TABLA_PATTERN.length).toBe(8);
    expect(tablaStepSeconds()).toBeGreaterThan(0.25);
    expect(tablaStepSeconds()).toBeLessThan(0.5);
    expect(TABLA_PATTERN[0]).toBe('dha');
  });
});
