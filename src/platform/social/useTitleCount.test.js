import { describe, it, expect } from 'vitest';
import { stripTitleCount, titleWithCount } from './useTitleCount.js';

describe('title count prefix', () => {
  it('adds "(n) " while something waits', () => {
    expect(titleWithCount('Friends · Kingpin', 2)).toBe('(2) Friends · Kingpin');
    expect(titleWithCount('Friends · Kingpin', 150)).toBe('(99+) Friends · Kingpin');
  });
  it('never doubles the prefix and restores the plain title at 0', () => {
    expect(titleWithCount('(2) Friends · Kingpin', 3)).toBe('(3) Friends · Kingpin');
    expect(titleWithCount('(2) Friends · Kingpin', 0)).toBe('Friends · Kingpin');
    expect(titleWithCount('Friends', NaN)).toBe('Friends');
  });
  it('strips only a leading count', () => {
    expect(stripTitleCount('(99+) Home')).toBe('Home');
    expect(stripTitleCount('Top (3) list')).toBe('Top (3) list');
    expect(stripTitleCount(undefined)).toBe('');
  });
});
