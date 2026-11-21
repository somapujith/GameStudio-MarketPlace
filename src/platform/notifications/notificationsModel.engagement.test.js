// Achievement, season-prize and referral notifications (docs/ENGAGEMENT.md): kept through normalisation, popped with
// gifts, and labelled for the popup.
import { describe, expect, it } from 'vitest';
import { KIND_META, giftContext, giftHeadline, giftRewards, giftTotals, giftsToPop, normalizeNotification } from './notificationsModel.js';

const iso = (ms) => new Date(Date.UTC(2026, 10, 22, 10, 0, 0) - ms).toISOString();
const ach = { id: 'a1', kind: 'achievement', title: 'Achievement unlocked: Champion', body: 'Win 10 matches.', data: { achievementId: 'champion', coins: 300, itemId: 'title-champion', itemName: 'Champion' }, createdAt: iso(1000), read: false };
const season = { id: 's1', kind: 'gift', title: 'Season prize: Monsoon Season', body: 'You finished #2 in Monsoon Season.', data: { coins: 2500, season: { id: 'se0', name: 'Monsoon Season', rank: 2 } }, createdAt: iso(3000), read: false };
const ref = (role) => ({ id: `r-${role}`, kind: 'gift', title: 'Referral reward', body: null, data: { coins: 250, referral: { name: 'Meera', role } }, createdAt: iso(2000), read: false });

describe('normalizeNotification (engagement kinds)', () => {
  it('keeps the achievement kind and its data', () => {
    expect(normalizeNotification(ach)).toEqual({ ...ach, data: { coins: 300, itemId: 'title-champion', itemName: 'Champion', achievementId: 'champion' } });
    expect(normalizeNotification({ id: 'x', kind: 'achievement' }).title).toBe('Achievement unlocked');
  });
  it('keeps season and referral details, drops junk', () => {
    expect(normalizeNotification(season).data.season).toEqual({ id: 'se0', name: 'Monsoon Season', rank: 2 });
    expect(normalizeNotification(ref('referrer')).data.referral).toEqual({ name: 'Meera', role: 'referrer' });
    expect(normalizeNotification({ ...ref('x'), data: { referral: { name: 'Meera', role: 'boss' } } }).data.referral).toEqual({ name: 'Meera' });
    expect(normalizeNotification({ id: 'y', kind: 'gift', data: { season: 'nope', referral: { name: '' } } }).data).toEqual({});
  });
});

describe('the popup', () => {
  it('pops achievements stacked with gifts, oldest first', () => {
    const list = [ach, season, ref('referrer'), { ...ach, id: 'a0', read: true }, { id: 'm', kind: 'message', title: 'Hi', createdAt: iso(0), read: false }].map(normalizeNotification);
    expect(giftsToPop(list).map((g) => g.id)).toEqual(['s1', 'r-referrer', 'a1']);
  });
  it('headline: badges only -> "Badge unlocked", mixed -> gifts', () => {
    const a = normalizeNotification(ach);
    expect(giftHeadline(1, [a])).toBe('Badge unlocked');
    expect(giftHeadline(2, [a, { ...a, id: 'a2' }])).toBe('2 badges unlocked');
    expect(giftHeadline(2, [a, normalizeNotification(season)])).toBe('2 gifts for you');
    expect(giftHeadline(1)).toBe('A gift for you');
  });
  it('giftContext labels badges, season placings and referrals', () => {
    expect(giftContext(normalizeNotification(ach))).toEqual({ kind: 'achievement', label: 'Badge unlocked' });
    expect(giftContext(normalizeNotification(season))).toEqual({ kind: 'season', label: 'Monsoon Season: rank 2' });
    expect(giftContext(normalizeNotification(ref('referrer')))).toEqual({ kind: 'referral', label: 'Meera joined with your link' });
    expect(giftContext(normalizeNotification(ref('invitee')))).toEqual({ kind: 'referral', label: 'Invited by Meera' });
    expect(giftContext({ kind: 'gift', data: { referral: { name: 'Meera' } } })).toEqual({ kind: 'referral', label: 'Referral: Meera' });
    expect(giftContext({ kind: 'gift', data: { coins: 5 } })).toBeNull();
  });
  it('rewards and totals count an achievement like a gift', () => {
    const a = normalizeNotification(ach);
    expect(giftRewards(a, 'Champion').map((r) => r.label)).toEqual(['+300 coins', 'Champion']);
    expect(giftTotals([a, normalizeNotification(season)])).toEqual({ coins: 2800, xp: 0, items: 1, count: 2 });
    expect(KIND_META.achievement).toEqual({ icon: 'medal', word: 'Badge' });
  });
});
