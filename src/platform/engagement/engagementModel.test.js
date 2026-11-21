// Pure rules behind the engagement screens: countdowns, the live-event chips, achievement grouping / progress,
// referral links, season countdowns and tiers, and how a shop card treats limited and reward items.
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '@shared/achievements.js';
import {
  REFERRAL_COINS,
  achievementProgress,
  achievementSummary,
  clockLabel,
  endsLabel,
  eventStripAllowed,
  formatCountdown,
  groupAchievements,
  isUnavailableError,
  liveEventChips,
  multiplierLabel,
  nextChipEnd,
  normalizeAchievement,
  normalizeReferrals,
  prizeTiers,
  referralShare,
  referralUrl,
  referralWhatsApp,
  rewardChips,
  seasonCountdown,
  seasonRowToBoard,
  seasonStanding,
  seasonStatusAt,
  shopItemMode,
  spokenCountdown,
  tierRanks,
  tierSpoken,
} from './engagementModel.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// local times, so the expectations hold in every time zone: Fri 20 Nov 2026, 10:00
const NOW = new Date(2026, 10, 20, 10, 0, 0).getTime();
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m, 0).toISOString();

describe('countdowns', () => {
  it('formatCountdown is minute-granular and empty when done', () => {
    expect(formatCountdown(3 * DAY + 4 * HOUR + 20 * MIN)).toBe('3d 4h');
    expect(formatCountdown(2 * DAY)).toBe('2d');
    expect(formatCountdown(4 * HOUR + 12 * MIN + 30_000)).toBe('4h 12m');
    expect(formatCountdown(5 * HOUR)).toBe('5h');
    expect(formatCountdown(12 * MIN)).toBe('12m');
    expect(formatCountdown(20_000)).toBe('under a minute');
    expect(formatCountdown(0)).toBe('');
    expect(formatCountdown(-5)).toBe('');
    expect(formatCountdown(NaN)).toBe('');
  });
  it('spokenCountdown spells it out', () => {
    expect(spokenCountdown(DAY + 2 * HOUR)).toBe('1 day 2 hours');
    expect(spokenCountdown(HOUR + MIN)).toBe('1 hour 1 minute');
    expect(spokenCountdown(3 * MIN)).toBe('3 minutes');
    expect(spokenCountdown(1000)).toBe('less than a minute');
    expect(spokenCountdown(0)).toBe('');
  });
  it('clockLabel / endsLabel speak local time', () => {
    expect(clockLabel(new Date(2026, 10, 22, 23, 0))).toBe('11 pm');
    expect(clockLabel(new Date(2026, 10, 22, 0, 30))).toBe('12:30 am');
    expect(clockLabel(new Date(2026, 10, 22, 12, 5))).toBe('12:05 pm');
    expect(endsLabel(at(20, 23), NOW)).toBe('11 pm'); // today
    expect(endsLabel(at(22, 23), NOW)).toBe('Sun 11 pm'); // this week
    expect(endsLabel(at(30, 9), NOW)).toBe('30 Nov'); // later
    expect(endsLabel('nope', NOW)).toBe('');
  });
  it('multiplierLabel', () => {
    expect(multiplierLabel(2)).toBe('2×');
    expect(multiplierLabel(1.5)).toBe('1.5×');
    expect(multiplierLabel(2.5)).toBe('2.5×');
  });
});

describe('liveEventChips', () => {
  const boost = (id, m, end) => ({ id, kind: 'coin_boost', name: `Boost ${id}`, startsAt: at(19, 0), endsAt: end, config: { multiplier: m } });
  const shop = (id, end) => ({ id, kind: 'limited_shop', name: 'Festival shop', startsAt: at(19, 0), endsAt: end, config: { itemIds: ['frame-diwali'] } });
  it('a coin chip only when the multiplier is above 1, ending with the boost that sets it', () => {
    const chips = liveEventChips({ events: [boost('a', 1.5, at(21, 9)), boost('b', 2, at(22, 23))], coinMultiplier: 2 }, NOW);
    expect(chips).toEqual([{ id: 'b', kind: 'coin_boost', name: 'Boost b', label: '2× coins till Sun 11 pm', endsAt: at(22, 23) }]);
    expect(liveEventChips({ events: [], coinMultiplier: 1 }, NOW)).toEqual([]);
    expect(liveEventChips(null, NOW)).toEqual([]);
  });
  it('a limited shop links to the shop; ended events and junk are dropped', () => {
    const chips = liveEventChips({ events: [shop('s1', at(21, 21)), shop('s2', at(20, 9)), { kind: 'weird' }, null], coinMultiplier: 1 }, NOW);
    expect(chips).toEqual([{ id: 's1', kind: 'limited_shop', name: 'Festival shop', label: 'Limited items till Sat 9 pm', endsAt: at(21, 21), to: '/shop' }]);
  });
  it('nextChipEnd is the soonest future end', () => {
    const chips = liveEventChips({ events: [boost('b', 2, at(22, 23)), shop('s1', at(21, 21))], coinMultiplier: 2 }, NOW);
    expect(nextChipEnd(chips, NOW)).toBe(Date.parse(at(21, 21)));
    expect(nextChipEnd([], NOW)).toBeNull();
  });
  it('the strip stays off the viewport-fit leaderboard, game screens and the lobby', () => {
    expect(eventStripAllowed('/')).toBe(true);
    expect(eventStripAllowed('/shop')).toBe(true);
    expect(eventStripAllowed('/leaderboard')).toBe(false);
    expect(eventStripAllowed('/play/nawabi-raj/online/ABC234')).toBe(false);
    expect(eventStripAllowed('/lobby/ABC234')).toBe(false);
    expect(eventStripAllowed(undefined)).toBe(false);
  });
});

const api = (id, over = {}) => {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  return { id, name: a.name, description: a.description, icon: a.icon, category: a.category, goal: a.goal, reward: { ...a.reward }, progress: 0, unlocked: false, unlockedAt: null, ...over };
};

describe('achievements', () => {
  it('normalizeAchievement fills from the catalogue and names the reward item', () => {
    const a = normalizeAchievement({ id: 'champion', progress: 3 });
    expect(a).toMatchObject({ name: 'Champion', icon: 'podium', category: 'play', goal: 10, metric: 'wins', progress: 3, unlocked: false });
    expect(a.reward).toEqual({ coins: 300, itemId: 'title-champion', itemName: 'Champion' });
    expect(normalizeAchievement({ id: 'x', progress: null }).progress).toBeNull();
    expect(normalizeAchievement(null)).toBeNull();
  });
  it('achievementProgress: value / goal, capped; all-or-nothing match badges read "In one match"; null signed out', () => {
    expect(achievementProgress(normalizeAchievement(api('regular', { progress: 7 })))).toMatchObject({ value: 7, goal: 10, pct: 70, text: '7 / 10' });
    expect(achievementProgress(normalizeAchievement(api('regular', { progress: 70 })))).toMatchObject({ value: 10, pct: 100 });
    expect(achievementProgress(normalizeAchievement(api('tycoon', { progress: 0 })))).toMatchObject({ pct: 0, text: 'In one match' });
    expect(achievementProgress(normalizeAchievement(api('tycoon', { progress: 4_000_000, unlocked: true, unlockedAt: at(19, 9) })))).toMatchObject({ pct: 100, text: '40,00,000 / 40,00,000' });
    expect(achievementProgress(normalizeAchievement(api('regular', { progress: null })))).toBeNull();
  });
  it('groupAchievements: category order, unlocked first (newest), then closest to done', () => {
    const groups = groupAchievements([
      api('first-win', { progress: 1, unlocked: true, unlockedAt: at(10, 9) }),
      api('regular', { progress: 7 }),
      api('champion', { progress: 3 }),
      api('level-10', { progress: 9 }),
      api('adda-regular', { progress: 2 }),
      api('on-a-roll', { progress: 3, unlocked: true, unlockedAt: at(12, 9) }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(['play', 'streak', 'social']);
    expect(groups[0].items.map((a) => a.id)).toEqual(['first-win', 'level-10', 'regular', 'champion']);
    expect(groups[0]).toMatchObject({ label: 'Play', unlocked: 1 });
    expect(groupAchievements(null)).toEqual([]);
  });
  it('achievementSummary', () => {
    expect(achievementSummary({ achievements: [], unlocked: 7, total: 11 }).text).toBe('7 / 11 unlocked');
    expect(achievementSummary({ achievements: [{ unlocked: true }, { unlocked: false }] }).text).toBe('1 / 2 unlocked');
  });
  it('rewardChips: coins and the item', () => {
    expect(rewardChips({ coins: 300, itemId: 'title-champion' })).toMatchObject([
      { kind: 'coins', label: '+300', spoken: '300 coins' },
      { kind: 'item', itemId: 'title-champion', label: 'Champion', spoken: 'Champion title' },
    ]);
    expect(rewardChips({ itemId: 'frame-streak' })[0]).toMatchObject({ kind: 'item', label: 'Streak Flame' });
    expect(rewardChips({})).toEqual([]);
  });
});

describe('referrals', () => {
  it('referralUrl prefixes the origin to the API path', () => {
    expect(referralUrl('/?ref=HYD-7K2Q', 'https://jalebi.games')).toBe('https://jalebi.games/?ref=HYD-7K2Q');
    expect(referralUrl('https://x.dev/?ref=HYD-7K2Q', 'https://jalebi.games')).toBe('https://x.dev/?ref=HYD-7K2Q');
    expect(referralUrl('//evil.com', 'https://jalebi.games')).toBe('');
    expect(referralUrl(null)).toBe('');
  });
  it('share text and WhatsApp link mention both rewards', () => {
    const m = referralShare('https://j.g/?ref=HYD-7K2Q', 'Jalebi Games');
    expect(m.text).toContain(`${REFERRAL_COINS} coins`);
    expect(m.url).toBe('https://j.g/?ref=HYD-7K2Q');
    const wa = referralWhatsApp('https://j.g/?ref=HYD-7K2Q', 'Jalebi Games');
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(wa)).toContain('https://j.g/?ref=HYD-7K2Q');
  });
  it('normalizeReferrals cleans numbers and rows', () => {
    const r = normalizeReferrals({ code: 'HYD-7K2Q', link: '/?ref=HYD-7K2Q', invited: '4', rewarded: -1, coinsEarned: 500, recent: [{ name: 'Meera', avatar: '8', joinedAt: at(19, 9), rewarded: true }, { avatar: 1 }] });
    expect(r).toEqual({ code: 'HYD-7K2Q', link: '/?ref=HYD-7K2Q', invited: 4, rewarded: 0, coinsEarned: 500, recent: [{ name: 'Meera', avatar: 8, joinedAt: at(19, 9), rewarded: true }] });
    expect(normalizeReferrals(null).recent).toEqual([]);
  });
});

describe('seasons', () => {
  const season = { id: 's', name: 'Diwali Season', startsAt: at(10, 0), endsAt: at(24, 17, 30), status: 'active', prizeTiers: [{ fromRank: 4, toRank: 10, coins: 1000, itemId: 'frame-season' }, { fromRank: 1, toRank: 1, coins: 5000, itemId: 'title-season-champ' }, { fromRank: 2, toRank: 3, coins: 2500 }] };
  it('seasonCountdown follows the window', () => {
    expect(seasonCountdown(season, NOW)).toMatchObject({ label: 'Ends in', text: 'Ends in 4d 7h', spoken: 'Ends in 4 days 7 hours' });
    expect(seasonCountdown({ ...season, startsAt: at(22, 10), status: 'scheduled' }, NOW)).toMatchObject({ label: 'Starts in', text: 'Starts in 2d' });
    expect(seasonCountdown({ ...season, endsAt: at(19, 0) }, NOW).label).toBe('Ended');
    expect(seasonCountdown({ ...season, status: 'paid', endsAt: at(18, 0) }, NOW).text).toBe('Ended 18 Nov 2026');
    expect(seasonCountdown(null, NOW)).toBeNull();
  });
  it('seasonStatusAt re-derives the status from the window (paid stays paid)', () => {
    expect(seasonStatusAt(season, NOW)).toBe('active');
    expect(seasonStatusAt({ ...season, status: 'active', endsAt: at(19, 0) }, NOW)).toBe('ended');
    expect(seasonStatusAt({ ...season, startsAt: at(21, 0), status: 'scheduled' }, NOW)).toBe('scheduled');
    expect(seasonStatusAt({ ...season, status: 'paid' }, NOW)).toBe('paid');
  });
  it('prizeTiers sorts and labels; tierSpoken reads them out', () => {
    const t = prizeTiers(season);
    expect(t.map((x) => x.ranks)).toEqual(['#1', '#2–3', '#4–10']);
    expect(t[0]).toMatchObject({ coins: 5000, itemId: 'title-season-champ', itemName: 'Season Champion' });
    expect(tierRanks({ fromRank: 3, toRank: 3 })).toBe('#3');
    expect(tierSpoken(t[0])).toBe('Rank 1: 5,000 coins and Season Champion');
    expect(tierSpoken(t[1])).toBe('Ranks 2 to 3: 2,500 coins');
    expect(prizeTiers(null)).toEqual([]);
  });
  it('seasonRowToBoard flattens equipped; seasonStanding', () => {
    expect(seasonRowToBoard({ rank: 1, userId: 'u', name: 'Rio', avatar: 3, points: 60, wins: 12, games: 24, equipped: { frame: 'frame-aurora' }, isMe: false })).toEqual({ rank: 1, name: 'Rio', avatar: 3, frame: 'frame-aurora', title: undefined, points: 60, wins: 12, games: 24, isMe: false });
    expect(seasonRowToBoard({ rank: 2 })).toBeNull();
    expect(seasonStanding({ rank: 14, points: 8 })).toEqual({ rank: 14, points: 8 });
    expect(seasonStanding(null)).toBeNull();
  });
});

describe('shop', () => {
  it('shopItemMode', () => {
    expect(shopItemMode({ source: 'shop', available: true })).toEqual({ mode: 'shop' });
    expect(shopItemMode({ source: 'achievement', available: false, unlockHint: 'Unlock: Champion achievement' })).toEqual({ mode: 'locked', hint: 'Unlock: Champion achievement' });
    expect(shopItemMode({ source: 'season', available: false, unlockHint: null })).toEqual({ mode: 'locked', hint: 'Season prize' });
    expect(shopItemMode({ source: 'event', available: true, availableUntil: at(22, 23) })).toEqual({ mode: 'limited', until: at(22, 23) });
    expect(shopItemMode({ source: 'event', available: false })).toEqual({ mode: 'offsale', hint: 'On sale during events' });
    // owned items are equipped as usual, whatever their source
    expect(shopItemMode({ source: 'achievement', owned: true })).toEqual({ mode: 'shop' });
  });
  it('isUnavailableError tells the limited 409 from "already owned"', () => {
    expect(isUnavailableError({ status: 409, message: 'Not available right now.' })).toBe(true);
    expect(isUnavailableError({ status: 409, message: 'Already owned.' })).toBe(false);
    expect(isUnavailableError({ status: 402, message: 'Not available right now.' })).toBe(false);
    expect(isUnavailableError(null)).toBe(false);
  });
});
