import { describe, it, expect } from 'vitest';
import { LINE_NAMES, LINE_ORDER, LINE_COLORS, pickBetween, poolIndex, slug } from './metro-names.js';

const hasTelugu = (s) => /[ఀ-౿]/.test(s);

describe('metro station names', () => {
  it('has the three lines with their colours', () => {
    expect(LINE_ORDER).toEqual(['red', 'blue', 'green']);
    expect(LINE_COLORS).toEqual({ red: '#e0262f', blue: '#1f66d1', green: '#14a24b' });
  });
  for (const id of LINE_ORDER) {
    it(`${id}: unique English names, each with a Telugu name`, () => {
      const pool = LINE_NAMES[id].pool;
      expect(new Set(pool.map((p) => p.en)).size).toBe(pool.length);
      expect(new Set(pool.map((p) => slug(p.en))).size).toBe(pool.length);
      for (const p of pool) {
        expect(p.en.length).toBeGreaterThan(2);
        expect(hasTelugu(p.te)).toBe(true);
      }
      expect(pool[0].en).toBe(LINE_NAMES[id].from);
      expect(pool[pool.length - 1].en).toBe(LINE_NAMES[id].to);
    });
  }
  it('interchange names exist on every line that pins them', () => {
    for (const id of LINE_ORDER) {
      for (const key of Object.keys(LINE_NAMES[id].pins)) {
        if (!['start', 'end'].includes(key)) expect(poolIndex(id, key)).toBeGreaterThanOrEqual(0);
      }
    }
    expect(poolIndex('red', 'Ameerpet')).toBeGreaterThan(0);
    expect(poolIndex('blue', 'Ameerpet')).toBeGreaterThan(0);
  });
  it('slugs are url-safe', () => {
    expect(slug('Lakdi-ka-pul')).toBe('lakdi-ka-pul');
    expect(slug('MG Bus Station')).toBe('mg-bus-station');
  });
  it('pickBetween spreads picks in order inside the gap', () => {
    const pool = LINE_NAMES.red.pool;
    const picks = pickBetween(pool, 0, 10, 3);
    expect(picks).toHaveLength(3);
    const idx = picks.map((p) => pool.indexOf(p));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(idx.every((i) => i > 0 && i < 10)).toBe(true);
    expect(pickBetween(pool, 5, 7, 5)).toHaveLength(1);
    expect(pickBetween(pool, 5, 6, 2)).toHaveLength(0);
  });
});
