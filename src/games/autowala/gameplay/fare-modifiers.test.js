import { describe, expect, it } from 'vitest';
import { MOD, URGENT, applyMods, computeModifiers, describeMods, isNight, isRaining, normalizeDemand, readDemand, urgentFor, urgentSettle } from './fare-modifiers.js';

describe('night, rain, luggage', () => {
  it('night is after 22:00 and before 05:00', () => {
    expect(isNight(21.9)).toBe(false);
    expect(isNight(22)).toBe(true);
    expect(isNight(23.5)).toBe(true);
    expect(isNight(2)).toBe(true);
    expect(isNight(4.99)).toBe(true);
    expect(isNight(5)).toBe(false);
    expect(isNight(NaN)).toBe(false);
  });

  it('plain daytime has no surcharge', () => {
    const m = computeModifiers({ hour: 12 });
    expect(m).toEqual({ mul: 1, flat: 0, list: [] });
    expect(applyMods(100, m)).toBe(100);
  });

  it('stacks night, rain and luggage', () => {
    const m = computeModifiers({ hour: 23, raining: true, luggage: true });
    expect(m.list.map((x) => x.id)).toEqual(['night', 'rain', 'luggage']);
    expect(m.mul).toBeCloseTo(MOD.night * MOD.rain, 5);
    expect(m.flat).toBe(MOD.luggageFlat);
    expect(applyMods(100, m)).toBe(Math.round(100 * MOD.night * MOD.rain + MOD.luggageFlat));
    expect(describeMods(m)).toContain('Night charge');
    expect(describeMods(m)).toContain('+Rs 20');
  });

  it('reads rain from `raining` or a rain level', () => {
    expect(isRaining(null)).toBe(false);
    expect(isRaining({ raining: true })).toBe(true);
    expect(isRaining({ rain: 0.2 })).toBe(false);
    expect(isRaining({ rain: 0.6 })).toBe(true);
  });
});

describe('peak demand from the career', () => {
  it('accepts a number, an object, or a missing career', () => {
    expect(normalizeDemand(1.5).mult).toBeCloseTo(1.2, 5);
    expect(normalizeDemand({ mult: 1.5, label: 'Office rush', te: 'ఆఫీస్ రష్' })).toMatchObject({ label: 'Office rush' });
    expect(normalizeDemand(1)).toBeNull();
    expect(normalizeDemand(0.3)).toBeNull(); // a lull never discounts
    expect(normalizeDemand(1.05)).toBeNull(); // too small to charge for
    expect(normalizeDemand(null)).toBeNull();
    expect(normalizeDemand({})).toBeNull();
    expect(readDemand(undefined, 9)).toBeNull();
    expect(readDemand({}, 9)).toBeNull();
  });

  it('prefers peak() (it has a label), falls back to demand(hour), and never throws', () => {
    expect(readDemand({ demand: (h) => (h === 9 ? 1.5 : 1) }, 9).mult).toBeCloseTo(1.2, 5);
    expect(readDemand({ demand: (h) => (h === 9 ? 1.5 : 1) }, 14)).toBeNull();
    expect(readDemand({ peak: () => ({ mult: 1.7, label: 'Evening rush' }) }, 18).label).toBe('Evening rush');
    expect(readDemand({ peak: () => ({ mult: 1.7, label: 'Evening rush' }), demand: () => 1 }, 18).label).toBe('Evening rush');
    expect(readDemand({ demand: () => { throw new Error('x'); } }, 9)).toBeNull();
  });

  it('caps the multiplier and the stack', () => {
    expect(normalizeDemand(9).mult).toBe(MOD.peakMax);
    const m = computeModifiers({ hour: 23, raining: true, demand: 1.5, luggage: false });
    expect(m.mul).toBeCloseTo(MOD.night * MOD.rain * 1.2, 5);
    expect(m.mul).toBeLessThanOrEqual(MOD.totalMax);
    expect(m.list.map((x) => x.id)).toEqual(['night', 'rain', 'peak']);
  });

  it('does not charge night twice when the career already calls it a night premium', () => {
    const m = computeModifiers({ hour: 23, demand: { mult: 1.9, label: 'Night premium' } });
    expect(m.list.map((x) => x.id)).toEqual(['peak']);
  });
});

describe('urgent rides', () => {
  it('a rusher is always urgent, with a reason from the destination', () => {
    expect(urgentFor('rusher', 'station', 0.99)).toBe(URGENT.train);
    expect(urgentFor('rusher', 'airport', 0.99)).toBe(URGENT.flight);
    expect(urgentFor('rusher', 'hospital', 0.99)).toBe(URGENT.hospital);
    expect(urgentFor('rusher', 'cyber', 0.99)).toBe(URGENT.meeting);
  });

  it('others are urgent only sometimes (hospital emergencies, a late student)', () => {
    expect(urgentFor('elder', 'hospital', 0.1)).toBe(URGENT.hospital);
    expect(urgentFor('elder', 'hospital', 0.9)).toBeNull();
    expect(urgentFor('tourist', 'hospital', 0.1)).toBeNull();
    expect(urgentFor('student', 'cyber', 0.01)).toBe(URGENT.exam);
    expect(urgentFor('regular', 'charminar', 0.01)).toBeNull();
  });

  it('on time pays a bonus that grows with the time to spare; late pays none', () => {
    const slow = urgentSettle({ fare: 200, timeLeft: 1, timeLimit: 100 });
    const quick = urgentSettle({ fare: 200, timeLeft: 80, timeLimit: 100 });
    expect(slow.bonus).toBeGreaterThanOrEqual(Math.round(200 * MOD.urgentBase));
    expect(quick.bonus).toBeGreaterThan(slow.bonus);
    expect(quick.fare).toBe(200 + quick.bonus);
    const late = urgentSettle({ fare: 130, timeLeft: -5, timeLimit: 100 });
    expect(late).toEqual({ fare: 130, bonus: 0, late: true });
    expect(urgentSettle({ fare: 100, timeLeft: NaN, timeLimit: null })).toEqual({ fare: 100, bonus: 0, late: false });
  });
});
