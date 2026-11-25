import { describe, it, expect } from 'vitest';
import {
  normalizeToast, pushToast, expireToasts, nextExpiry, makeBurst, pushBurst, expireBursts,
  MAX_TOASTS, EXIT_MS, DEFAULT_MS, MAX_MS, MIN_MS, MAX_BURSTS, BURST_MS, MERGE_WINDOW_MS,
} from './toastQueue.js';

describe('normalizeToast', () => {
  it('cleans text, tone, icon and duration', () => {
    expect(normalizeToast({ text: '  Fare   collected  ', tone: 'good', icon: '$', ms: 3000 })).toEqual({ text: 'Fare collected', tone: 'good', icon: '$', ms: 3000 });
    expect(normalizeToast({ text: 'x', tone: 'weird' }).tone).toBe('info');
    expect(normalizeToast({ text: 'x' }).ms).toBe(DEFAULT_MS);
    expect(normalizeToast({ text: 'x', ms: 99999 }).ms).toBe(MAX_MS);
    expect(normalizeToast({ text: 'x', ms: 1 }).ms).toBe(MIN_MS);
    expect(normalizeToast({ text: 'x'.repeat(500) }).text.length).toBe(140);
  });
  it('rejects empty', () => {
    expect(normalizeToast({})).toBeNull();
    expect(normalizeToast(null)).toBeNull();
    expect(normalizeToast({ text: '   ' })).toBeNull();
  });
});

describe('toast stack', () => {
  it('caps at four visible toasts, the oldest leave first', () => {
    let list = [];
    for (let i = 0; i < 6; i++) list = pushToast(list, { text: `t${i}` }, 1000 + i * 5000 * 0 + i, i);
    const live = list.filter((x) => !x.leaving);
    expect(live.length).toBe(MAX_TOASTS);
    expect(live.map((x) => x.text)).toEqual(['t2', 't3', 't4', 't5']);
    expect(list.filter((x) => x.leaving).map((x) => x.text)).toEqual(['t0', 't1']);
  });
  it('merges an identical toast shown again quickly into a counter', () => {
    let list = pushToast([], { text: 'Honk!', tone: 'info' }, 0, 1);
    list = pushToast(list, { text: 'Honk!', tone: 'info' }, 300, 2);
    expect(list.length).toBe(1);
    expect(list[0].count).toBe(2);
    expect(list[0].until).toBe(300 + DEFAULT_MS);
    list = pushToast(list, { text: 'Honk!', tone: 'info' }, 300 + MERGE_WINDOW_MS + 5, 3);
    expect(list.length).toBe(2);
    list = pushToast(list, { text: 'Honk!', tone: 'bad' }, 300 + MERGE_WINDOW_MS + 6, 4);
    expect(list.length).toBe(3);
  });
  it('does not mutate the old list and ignores empty toasts', () => {
    const a = pushToast([], { text: 'a' }, 0, 1);
    const frozen = JSON.stringify(a);
    pushToast(a, { text: 'b' }, 10, 2);
    pushToast(a, { text: 'a' }, 20, 3);
    expect(JSON.stringify(a)).toBe(frozen);
    expect(pushToast(a, {}, 5, 9)).toBe(a);
  });
  it('expires: leaving first, then removed after the exit animation', () => {
    let list = pushToast([], { text: 'a', ms: 1000 }, 0, 1);
    expect(expireToasts(list, 999)).toBe(list);
    const leaving = expireToasts(list, 1000);
    expect(leaving[0].leaving).toBe(true);
    expect(expireToasts(leaving, 1000 + EXIT_MS - 1)).toBe(leaving);
    expect(expireToasts(leaving, 1000 + EXIT_MS)).toEqual([]);
    // a long gap goes straight to removed
    expect(expireToasts(list, 10000)).toEqual([]);
  });
  it('nextExpiry points at the next state change', () => {
    expect(nextExpiry([], 0)).toBeNull();
    let list = pushToast([], { text: 'a', ms: 1000 }, 0, 1);
    list = pushToast(list, { text: 'b', ms: 3000 }, 0, 2);
    expect(nextExpiry(list, 400)).toBe(600);
    list = expireToasts(list, 1000);
    expect(nextExpiry(list, 1000)).toBe(EXIT_MS);
  });
});

describe('wallet bursts', () => {
  it('formats gains in gold and losses in red', () => {
    expect(makeBurst({ delta: 120, reason: 'fare' }, 0, 1)).toMatchObject({ text: '+Rs 120', tone: 'gold', label: 'Fare', until: BURST_MS });
    expect(makeBurst({ delta: -260, reason: 'purchase' }, 0, 1)).toMatchObject({ text: '-Rs 260', tone: 'bad' });
    expect(makeBurst({ delta: 12500 }, 0, 1).text).toBe('+Rs 12,500');
  });
  it('ignores zero and junk', () => {
    expect(makeBurst({ delta: 0 }, 0, 1)).toBeNull();
    expect(makeBurst({ delta: 'x' }, 0, 1)).toBeNull();
    expect(makeBurst(null, 0, 1)).toBeNull();
    expect(pushBurst([], { delta: 0 }, 0, 1)).toEqual([]);
  });
  it('merges a quick tip onto the fare, keeps signs apart, and caps the pile', () => {
    let list = pushBurst([], { delta: 100, reason: 'fare' }, 0, 1);
    list = pushBurst(list, { delta: 20, reason: 'tip' }, 200, 2);
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ delta: 120, text: '+Rs 120', label: '' });
    list = pushBurst(list, { delta: -50 }, 250, 3);
    expect(list.length).toBe(2);
    for (let i = 0; i < 6; i++) list = pushBurst(list, { delta: 10 + i }, 1000 + i * 600, 10 + i);
    expect(list.length).toBeLessThanOrEqual(MAX_BURSTS);
  });
  it('expires', () => {
    const list = pushBurst([], { delta: 5 }, 0, 1);
    expect(expireBursts(list, BURST_MS - 1)).toBe(list);
    expect(expireBursts(list, BURST_MS)).toEqual([]);
  });
});
