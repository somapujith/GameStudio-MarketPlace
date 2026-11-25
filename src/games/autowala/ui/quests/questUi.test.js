import { describe, expect, it } from 'vitest';
import { blockedReason, clockTone, limitText, pct, pickSelected, rankProgress, whyFailed } from './questUi.js';

describe('quest ui helpers', () => {
  it('formats limits and tones', () => {
    expect(limitText(125)).toBe('2:05');
    expect(limitText(null)).toBe('No limit');
    expect(clockTone(null, null)).toBe('calm');
    expect(clockTone(8, 100)).toBe('urgent');
    expect(clockTone(20, 100)).toBe('warn');
    expect(clockTone(80, 100)).toBe('calm');
    expect(clockTone(14, 40)).toBe('warn');
  });
  it('clamps bars', () => {
    expect(pct(0.256)).toBe('26%');
    expect(pct(-1)).toBe('0%');
    expect(pct(9)).toBe('100%');
    expect(pct(NaN)).toBe('0%');
  });
  it('measures rank progress', () => {
    expect(rankProgress({ floor: 100, next: 300 }, 200)).toBe(0.5);
    expect(rankProgress({ floor: 1600, next: null }, 5000)).toBe(1);
    expect(rankProgress(null, 0)).toBe(1);
  });
  it('explains failures', () => {
    expect(whyFailed('time')).toMatch(/time/);
    expect(whyFailed('hit:cow')).toMatch(/cow/);
    expect(whyFailed('???')).toBe('Mission failed.');
  });
  it('selects an offer', () => {
    const offers = [{ id: 'a', locked: true }, { id: 'b' }, { id: 'c' }];
    expect(pickSelected(offers, 'c').id).toBe('c');
    expect(pickSelected(offers, 'zzz').id).toBe('b');
    expect(pickSelected([], 'a')).toBe(null);
  });
  it('says why a job cannot be taken', () => {
    expect(blockedReason({ id: 'a' })).toBe('');
    expect(blockedReason({ unavailable: true })).toMatch(/available/);
    expect(blockedReason({ locked: true, minRep: 40 })).toMatch(/40 reputation/);
    expect(blockedReason({ doneToday: true })).toMatch(/tomorrow/);
    expect(blockedReason({ id: 'a' }, { canAccept: false })).toMatch(/current/);
  });
});
