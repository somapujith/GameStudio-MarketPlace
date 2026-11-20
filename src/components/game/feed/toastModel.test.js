import { describe, expect, it } from 'vitest';
import { MAX_TOASTS, ROLL_WAIT_MS, expireToasts, feedToToast, nextExpiry, pushToast, toastMs, toastWorthy } from './toastModel.js';

const item = (id, text, extra) => ({ id, text, tone: 'info', icon: '*', kind: 'rent', player: 'a', tile: null, ...extra });

describe('toast stack', () => {
  it('keeps at most two live lines, newest last', () => {
    let list = [];
    list = pushToast(list, item(1, 'one'), 0);
    list = pushToast(list, item(2, 'two'), 10);
    list = pushToast(list, item(3, 'three'), 20);
    expect(MAX_TOASTS).toBe(2);
    expect(list.map((t) => t.text)).toEqual(['two', 'three']);
  });
  it('lines expire on their own and the same list comes back when none did', () => {
    let list = pushToast([], item(1, 'one'), 0);
    list = pushToast(list, item(2, 'two'), 2000);
    const at = list[0].expires;
    expect(expireToasts(list, 100)).toBe(list);
    expect(expireToasts(list, at + 1).map((t) => t.text)).toEqual(['two']);
    expect(nextExpiry(list, 100)).toBe(at - 100);
    expect(nextExpiry([], 0)).toBeNull();
  });
  it('long lines stay longer; fast playback shortens them', () => {
    expect(toastMs('hi')).toBeGreaterThanOrEqual(3000);
    expect(toastMs('x'.repeat(200))).toBe(5400);
    expect(toastMs('x'.repeat(40), 2)).toBeLessThan(toastMs('x'.repeat(40), 1));
    expect(toastMs('x', 0.1)).toBe(toastMs('x', 0.75));
  });
  it('the round banner already says it, so a new round never toasts', () => {
    expect(toastWorthy(item(1, 'Round 8 begins', { kind: 'round' }))).toBe(false);
    expect(toastWorthy(item(1, 'Sana paid rent', { kind: 'rent' }))).toBe(true);
    expect(toastWorthy(null)).toBe(false);
  });
});

describe('feedToToast: a roll and its landing are one line', () => {
  const roll = item(1, 'Sana rolled 5', { kind: 'roll', player: 'sana' });
  const land = (player = 'sana') => item(2, 'Sana landed on Madhapur', { kind: 'move', player, tile: 4 });
  it('holds the roll, then shows both joined', () => {
    const a = feedToToast(null, roll, 0);
    expect(a.show).toBeNull();
    expect(a.pending.item.text).toBe('Sana rolled 5');
    const b = feedToToast(a.pending, land(), 500);
    expect(b.show.text).toBe('Sana rolled 5 and landed on Madhapur');
    expect(b.show.tile).toBe(4);
    expect(b.pending).toBeNull();
  });
  it('a landing by someone else, or long after, stands alone', () => {
    const held = feedToToast(null, roll, 0).pending;
    expect(feedToToast(held, land('rav'), 500).show.text).toBe('Sana landed on Madhapur');
    expect(feedToToast(held, land(), ROLL_WAIT_MS + 1).show.text).toBe('Sana landed on Madhapur');
  });
  it('a six (roll again) is not joinable, so it shows at once', () => {
    const six = item(3, 'Sana rolled 6: six, roll again!', { kind: 'roll', player: 'sana' });
    expect(feedToToast(null, six, 0).show.text).toBe('Sana rolled 6: six, roll again!');
  });
  it('other lines pass through and keep a fresh held roll', () => {
    const held = feedToToast(null, roll, 0).pending;
    const r = feedToToast(held, item(4, 'Sana paid rent', { kind: 'rent' }), 100);
    expect(r.show.text).toBe('Sana paid rent');
    expect(r.pending).toBe(held);
    expect(feedToToast(held, item(5, 'Round 2', { kind: 'round' }), 100).show).toBeNull();
  });
});
