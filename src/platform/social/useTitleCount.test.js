import { describe, it, expect } from 'vitest';
import { stripTitleCount, titleWithCount } from './useTitleCount.js';

describe('title count prefix', () => {
  it('adds "(n) " while something waits', () => {
    expect(titleWithCount('Friends · Nawabi Raj', 2)).toBe('(2) Friends · Nawabi Raj');
    expect(titleWithCount('Friends · Nawabi Raj', 150)).toBe('(99+) Friends · Nawabi Raj');
  });
  it('never doubles the prefix and restores the plain title at 0', () => {
    expect(titleWithCount('(2) Friends · Nawabi Raj', 3)).toBe('(3) Friends · Nawabi Raj');
    expect(titleWithCount('(2) Friends · Nawabi Raj', 0)).toBe('Friends · Nawabi Raj');
    expect(titleWithCount('Friends', NaN)).toBe('Friends');
  });
  it('strips only a leading count', () => {
    expect(stripTitleCount('(99+) Home')).toBe('Home');
    expect(stripTitleCount('Top (3) list')).toBe('Top (3) list');
    expect(stripTitleCount(undefined)).toBe('');
  });
});
