import { describe, expect, it } from 'vitest';
import {
  bellLabel,
  collectAnnouncement,
  collectLabel,
  giftFrom,
  giftHeadline,
  giftRewards,
  giftTotals,
  giftsToPop,
  growStack,
  insertNotification,
  markRead,
  normalizeList,
  normalizeNotification,
  relativeTime,
  unreadOf,
} from './notificationsModel.js';

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const n = (id, over = {}) => ({ id, kind: 'gift', title: `Gift ${id}`, body: null, data: { coins: 100 }, createdAt: iso(60_000), read: false, ...over });

describe('normalizeNotification', () => {
  it('keeps the contract fields and drops junk', () => {
    const v = normalizeNotification({ id: 'a', kind: 'gift', title: ' Diwali bonus ', body: '', data: { coins: '500', xp: -3, itemId: 'frame-nizam', from: 7 }, createdAt: iso(0), read: true });
    expect(v).toEqual({ id: 'a', kind: 'gift', title: 'Diwali bonus', body: null, data: { coins: 500, itemId: 'frame-nizam' }, createdAt: iso(0), read: true });
  });
  it('rejects rows without an id; unknown kinds become system; missing titles get a default', () => {
    expect(normalizeNotification({ kind: 'gift' })).toBeNull();
    expect(normalizeNotification(null)).toBeNull();
    expect(normalizeNotification({ id: 1, kind: 'weird' })).toMatchObject({ id: '1', kind: 'system', title: 'Notification', read: false, createdAt: null });
    expect(normalizeNotification({ id: 2, kind: 'gift' }).title).toBe('A gift for you');
  });
});

describe('lists', () => {
  it('normalizeList sorts newest first, dedupes and caps', () => {
    const list = normalizeList([n('old', { createdAt: iso(9e6) }), n('new', { createdAt: iso(1000) }), n('new'), { nope: 1 }], 30);
    expect(list.map((x) => x.id)).toEqual(['new', 'old']);
    expect(normalizeList(Array.from({ length: 40 }, (_, i) => n(`x${i}`)), 30)).toHaveLength(30);
    expect(normalizeList('nope')).toEqual([]);
  });
  it('insertNotification adds live ones on top and counts only new unread ones', () => {
    const base = normalizeList([n('a', { createdAt: iso(5000) })]);
    const r1 = insertNotification(base, n('b', { createdAt: iso(0) }));
    expect(r1.list.map((x) => x.id)).toEqual(['b', 'a']);
    expect(r1.added).toBe(true);
    const replay = insertNotification(r1.list, n('b', { createdAt: iso(0) }));
    expect(replay.added).toBe(false);
    expect(replay.list).toHaveLength(2);
    expect(insertNotification(base, n('c', { read: true })).added).toBe(false);
    expect(insertNotification(base, { bad: true })).toEqual({ list: base, added: false });
  });
  it('markRead flips ids or everything and reports how many changed', () => {
    const list = normalizeList([n('a'), n('b'), n('c', { read: true })]);
    const r = markRead(list, ['a', 'c', 'zzz']);
    expect(r.changed).toBe(1);
    expect(r.list.find((x) => x.id === 'a').read).toBe(true);
    expect(r.list.find((x) => x.id === 'b').read).toBe(false);
    const all = markRead(list, 'all');
    expect(all.changed).toBe(2);
    expect(all.list.every((x) => x.read)).toBe(true);
    const none = markRead(all.list, 'all');
    expect(none.changed).toBe(0);
    expect(none.list).toBe(all.list);
  });
  it('unreadOf prefers the server count (it sees past the latest 30)', () => {
    const list = normalizeList([n('a'), n('b', { read: true })]);
    expect(unreadOf(list, 42)).toBe(42);
    expect(unreadOf(list, 0)).toBe(0);
    expect(unreadOf(list, undefined)).toBe(1);
    expect(unreadOf(list, null)).toBe(1);
    expect(unreadOf(list, 'x')).toBe(1);
  });
});

describe('gift popup rules', () => {
  const list = normalizeList([
    n('g2', { createdAt: iso(1000) }),
    n('g1', { createdAt: iso(5000) }),
    n('m1', { kind: 'message', data: {} }),
    n('g0', { read: true }),
  ]);
  it('pops unread gifts only, oldest first, skipping the waved-away ones', () => {
    expect(giftsToPop(list).map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(giftsToPop(list, new Set(['g1'])).map((g) => g.id)).toEqual(['g2']);
    expect(giftsToPop([])).toEqual([]);
    expect(giftsToPop(null)).toEqual([]);
  });
  it('growStack appends new gifts to an open stack without duplicates', () => {
    const stack = giftsToPop(list);
    expect(growStack(stack, stack)).toBe(stack);
    const more = growStack(stack, [...stack, normalizeNotification(n('g3'))]);
    expect(more.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
  });
  it('totals, rewards and labels', () => {
    const gifts = [
      normalizeNotification(n('a', { data: { coins: 500, xp: 50 } })),
      normalizeNotification(n('b', { data: { coins: 1000, itemId: 'frame-nizam', itemName: 'Nizam Gold' } })),
    ];
    const t = giftTotals(gifts);
    expect(t).toEqual({ coins: 1500, xp: 50, items: 1, count: 2 });
    expect(collectLabel(t)).toBe('Collect +1,500');
    expect(collectLabel({ coins: 0, xp: 10, items: 0, count: 1 })).toBe('Collect');
    expect(collectLabel({ coins: 0, xp: 0, items: 2, count: 2 })).toBe('Collect all');
    expect(giftRewards(gifts[0]).map((r) => r.label)).toEqual(['+500 coins', '+50 XP']);
    expect(giftRewards(gifts[1], 'Nizam Gold (shop name)').map((r) => r.label)).toEqual(['+1,000 coins', 'Nizam Gold (shop name)']);
    expect(giftRewards(normalizeNotification(n('c', { data: { itemId: 'mystery' } }))).map((r) => r.label)).toEqual(['A new item']);
    expect(giftHeadline(1)).toBe('A gift for you');
    expect(giftHeadline(3)).toBe('3 gifts for you');
    expect(giftFrom(gifts[0])).toBe('Jalebi Games team');
    expect(giftFrom(normalizeNotification(n('d', { data: { from: 'Ravi (moderator)' } })))).toBe('Ravi (moderator)');
    expect(collectAnnouncement(t)).toBe('2 gifts collected: 1,500 coins, 50 XP, 1 item.');
    expect(collectAnnouncement({ coins: 0, xp: 0, items: 0, count: 1 })).toBe('Gift collected.');
    expect(collectAnnouncement(null)).toBe('');
  });
  it('bell label', () => {
    expect(bellLabel(0)).toBe('Notifications');
    expect(bellLabel(3)).toBe('Notifications, 3 unread');
    expect(bellLabel(250)).toBe('Notifications, 99+ unread');
  });
});

describe('relativeTime', () => {
  it('reads like a person would say it', () => {
    expect(relativeTime(iso(10_000), NOW)).toBe('Just now');
    expect(relativeTime(iso(-60_000), NOW)).toBe('Just now'); // clock skew
    expect(relativeTime(iso(60_000), NOW)).toBe('1 min ago');
    expect(relativeTime(iso(45 * 60_000), NOW)).toBe('45 min ago');
    expect(relativeTime(iso(3 * 3600_000), NOW)).toBe('3 h ago');
    expect(relativeTime(iso(30 * 3600_000), NOW)).toBe('Yesterday');
    expect(relativeTime(iso(4 * 86400_000), NOW)).toBe('4 days ago');
    expect(relativeTime(Date.UTC(2026, 9, 2, 12), NOW)).toBe('2 Oct');
    expect(relativeTime(Date.UTC(2025, 9, 2, 12), NOW)).toBe('2 Oct 2025');
    expect(relativeTime('nope', NOW)).toBe('');
    expect(relativeTime(null, NOW)).toBe('');
  });
});
