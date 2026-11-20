import { describe, expect, it } from 'vitest';
import { chooseFit, MAX_FIT } from './useTopbarFit.js';

describe('chooseFit', () => {
  it('takes the first level that fits', () => {
    expect(chooseFit(() => true)).toBe(0);
    expect(chooseFit((l) => l >= 1)).toBe(1);
    expect(chooseFit((l) => l >= 2)).toBe(2);
  });
  it('tries levels in order and stops at the first fit', () => {
    const tried = [];
    chooseFit((l) => {
      tried.push(l);
      return l >= 2;
    });
    expect(tried).toEqual([0, 1, 2]);
  });
  it('falls back to the tightest level when nothing fits', () => {
    expect(chooseFit(() => false)).toBe(MAX_FIT);
    expect(chooseFit(() => false, 2)).toBe(2);
  });
});
