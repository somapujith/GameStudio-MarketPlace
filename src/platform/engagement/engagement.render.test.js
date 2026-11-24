// Render tests (server-side render, node env: effects do not run) for the player-facing engagement screens:
// the achievements grid, the invite card, the season card and the Season tab, the live-event strip, the shop's limited
// and reward cards, and the gift popup's badge treatment.
import { describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/art/index.js', () => ({
  Avatar: ({ preset }) => h('span', { 'data-avatar': preset }),
  AVATAR_PRESETS: Array.from({ length: 12 }, (_, id) => ({ id, label: `Avatar ${id}` })),
  Logo: () => h('span', { 'data-logo': true }),
  Scene: () => h('span', { 'data-scene': true }),
}));

const { ACHIEVEMENTS } = await import('@shared/achievements.js');
const { COSMETICS, cosmeticById } = await import('@shared/cosmetics.js');
const { AuthContext } = await import('@/lib/auth.jsx');
const { AchievementsView } = await import('./AchievementsGrid.jsx');
const { ReferralView } = await import('./ReferralCard.jsx');
const { default: SeasonCard } = await import('./SeasonCard.jsx');
const { LiveEventView } = await import('./LiveEventBar.jsx');
const { liveEventChips } = await import('./engagementModel.js');
const { ItemCard, mergeItems } = await import('@/pages/Shop.jsx');
const { GiftCard } = await import('@/platform/notifications/GiftPopup.jsx');
const { normalizeList } = await import('@/platform/notifications/notificationsModel.js');
const { default: Leaderboard } = await import('@/pages/Leaderboard.jsx');

const NOW = new Date(2026, 10, 20, 10, 0, 0).getTime();
const at = (d, hr, m = 0) => new Date(2026, 10, d, hr, m, 0).toISOString();
const authBase = {
  user: null,
  loading: false,
  configured: false,
  googleClientId: null,
  reachable: true,
  authError: null,
  clearAuthError() {},
  signingIn: false,
  loginWithGoogle: async () => null,
  loginGuest: async () => null,
  logout: async () => {},
  refresh: async () => null,
  reloadConfig: async () => false,
  updateProfile: async () => null,
  subscribe: () => () => {},
  userSocketStatus: 'closed',
  suspended: null,
};
const member = { id: 'u1', name: 'Ravi', avatar: 2, friendCode: 'HYD-7K2Q', isGuest: false, level: 3, xp: 10, coins: 500, role: 'user', stats: {} };
const html = (el, { path = '/', auth = {} } = {}) =>
  renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, h(AuthContext.Provider, { value: { ...authBase, ...auth } }, el))).replaceAll('<!-- -->', '');

const achievements = ACHIEVEMENTS.map((a, i) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  icon: a.icon,
  category: a.category,
  goal: a.goal,
  reward: { ...a.reward },
  progress: i < 3 ? a.goal : Math.floor(a.goal / 2),
  unlocked: i < 3,
  unlockedAt: i < 3 ? at(12, 9) : null,
}));
const achData = { achievements, unlocked: 3, total: achievements.length };

describe('AchievementsView', () => {
  it('summary, one group per category, unlocked badges with their date, locked ones with a progress bar', () => {
    const out = html(h(AchievementsView, { data: achData, status: 'ok', signedIn: true, avatar: 2 }));
    expect(out).toContain('id="achievements"');
    expect(out).toContain('3 / 11 unlocked');
    for (const label of ['Play', 'Streaks', 'Nawabi Raj', 'Friends']) expect(out).toContain(`>${label}`);
    expect((out.match(/cj-pro-ach is-unlocked/g) || []).length).toBe(3);
    expect(out).toContain('Unlocked <time dateTime=');
    expect(out).toContain('12 Nov 2026');
    const bars = out.match(/role="progressbar"[^>]*/g) || [];
    expect(bars.length).toBe(1 + achievements.length - 3); // the summary meter + one per locked badge
    expect(bars.every((b) => /aria-valuemin="0"/.test(b) && /aria-valuemax="\d+"/.test(b) && /aria-valuenow="\d+"/.test(b))).toBe(true);
  });
  it('reward chips: coins and the cosmetic drawn with the shop art', () => {
    const out = html(h(AchievementsView, { data: achData, status: 'ok', signedIn: true, avatar: 2 }));
    expect(out).toContain('cj-pro-reward--coins');
    expect(out).toContain('cj-pro-reward--item');
    expect(out).toContain('Streak Flame');
    expect(out).toContain('Champion title'); // spoken label of the title reward
  });
  it('signed out: a sign-in prompt and no progress', () => {
    const data = { ...achData, achievements: achievements.map((a) => ({ ...a, progress: null, unlocked: false, unlockedAt: null })), unlocked: 0 };
    const out = html(h(AchievementsView, { data, status: 'ok', signedIn: false }));
    expect(out).toContain('Sign in to track your progress');
    expect(out).not.toContain('cj-pro-ach__bar');
    expect(out).not.toContain('unlocked</b>');
  });
  it('loading and error states', () => {
    expect(html(h(AchievementsView, { status: 'loading' }))).toContain('cj-pro-ach--skel');
    const err = html(h(AchievementsView, { status: 'error', onRetry() {} }));
    expect(err).toContain('Could not load achievements');
    expect(err).toContain('Try again');
  });
});

describe('ReferralView', () => {
  const data = { code: 'HYD-7K2Q', link: '/?ref=HYD-7K2Q', invited: 4, rewarded: 2, coinsEarned: 500, recent: [{ name: 'Meera', avatar: 8, joinedAt: at(19, 9), rewarded: true }, { name: 'Kiran', avatar: 7, joinedAt: at(20, 9), rewarded: false }] };
  it('member: the link, copy / share / WhatsApp, the 250-coin promise, counts and recent invites', () => {
    const out = html(h(ReferralView, { mode: 'member', data, url: 'https://jalebi.games/?ref=HYD-7K2Q', shareable: true }));
    expect(out).toContain('id="invite"');
    expect(out).toContain('Both of you get 250 coins when they finish their first match.');
    expect(out).toMatch(/<label[^>]*for="jg-ref-link"[^>]*>Your invite link<\/label>/);
    expect(out).toContain('value="https://jalebi.games/?ref=HYD-7K2Q"');
    expect(out).toContain('Copy');
    expect(out).toContain('Share');
    expect(out).toContain('href="https://wa.me/?text=');
    expect(out).toContain('(opens in a new tab)');
    expect(out).toContain('Invited');
    expect(out).toContain('Coins earned');
    expect(out).toContain(' 500</dd>');
    expect(out).toContain('Meera');
    expect(out).toContain('Yet to play');
    expect(out).toContain('aria-live="polite"');
  });
  it('no native share: no Share button; no invites yet: a nudge', () => {
    const out = html(h(ReferralView, { mode: 'member', data: { ...data, recent: [], invited: 0 }, url: 'https://x/?ref=HYD-7K2Q', shareable: false }));
    expect(out).not.toContain('> Share');
    expect(out).toContain('Nobody has joined with your link yet');
  });
  it('signed out and guests get the "sign in to earn" prompt', () => {
    expect(html(h(ReferralView, { mode: 'gate' }))).toContain('Sign in to earn');
    expect(html(h(ReferralView, { mode: 'gate', guest: true }))).toContain('Guests cannot invite friends');
    expect(html(h(ReferralView, { mode: 'gate' }))).not.toContain('jg-ref-link');
  });
});

describe('SeasonCard', () => {
  const season = { id: 's', name: 'Diwali Season', startsAt: at(10, 0), endsAt: at(24, 17, 30), status: 'active', prizeTiers: [{ fromRank: 1, toRank: 1, coins: 5000, itemId: 'title-season-champ', itemName: 'Season Champion' }, { fromRank: 2, toRank: 3, coins: 2500 }, { fromRank: 4, toRank: 10, coins: 1000, itemId: 'frame-season', itemName: 'Season Laurel' }] };
  it('active: status, a polite countdown, the name and the prize tiers with art', () => {
    const out = html(h(SeasonCard, { season, now: NOW, avatar: 2 }));
    expect(out).toContain('cj-lb-season');
    expect(out).toContain('Live');
    expect(out).toMatch(/aria-live="polite"[^>]*>.*Ends in 4d 7h/);
    expect(out).toContain('Ends in 4 days 7 hours');
    expect(out).toContain('Diwali Season');
    expect(out).toContain('#2–3');
    expect(out).toContain('Rank 1: 5,000 coins and Season Champion');
    expect(out).toContain('data-frame="frame-season"');
  });
  it('scheduled counts down to the start; no season explains seasons', () => {
    expect(html(h(SeasonCard, { season: { ...season, startsAt: at(22, 10), status: 'scheduled' }, now: NOW }))).toContain('Starts in 2d');
    expect(html(h(SeasonCard, { season: null }))).toContain('3 points a win, 1 a game');
  });
});

describe('Leaderboard: Season tab', () => {
  it('the tab list has Season, selected on ?tab=season, and the panel is labelled by it', () => {
    const out = html(h(Leaderboard), { path: '/leaderboard?tab=season', auth: { user: member } });
    expect(out).toMatch(/<button[^>]*role="tab"[^>]*id="hh2-tab-season"[^>]*aria-selected="true"/);
    expect(out).toMatch(/role="tabpanel"[^>]*aria-labelledby="hh2-tab-season"/);
    expect(out).toContain('cj-lb--season');
  });
  it('the Overall tab is unchanged and Season is not selected there', () => {
    const out = html(h(Leaderboard), { path: '/leaderboard', auth: { user: member } });
    expect(out).toMatch(/id="hh2-tab-overall"[^>]*aria-selected="true"/);
    expect(out).toMatch(/id="hh2-tab-season"[^>]*aria-selected="false"/);
    expect(out).toContain('Your record');
  });
});

describe('LiveEventView', () => {
  it('a coin chip and a shop link, or nothing', () => {
    const chips = liveEventChips(
      {
        events: [
          { id: 'e1', kind: 'coin_boost', name: 'Double', startsAt: at(19, 0), endsAt: at(22, 23), config: { multiplier: 2 } },
          { id: 'e2', kind: 'limited_shop', name: 'Festival', startsAt: at(19, 0), endsAt: at(21, 21), config: { itemIds: ['frame-diwali'] } },
        ],
        coinMultiplier: 2,
      },
      NOW,
    );
    const out = html(h(LiveEventView, { chips }));
    expect(out).toContain('aria-label="Live events"');
    expect(out).toContain('2× coins till Sun 11 pm');
    expect(out).toMatch(/<a[^>]*href="\/shop"[^>]*>.*Limited items till Sat 9 pm/);
    expect(html(h(LiveEventView, { chips: [] }))).toBe('');
  });
});

describe('Shop cards for limited and reward items', () => {
  const items = mergeItems(
    COSMETICS.map((c) => ({
      id: c.id,
      price: c.price,
      source: c.source,
      available: c.source === 'shop' || c.id === 'frame-diwali',
      availableUntil: c.id === 'frame-diwali' ? at(22, 23) : null,
      unlockHint: c.source === 'achievement' ? 'Unlock: Ten Day Streak achievement' : c.source === 'season' ? "Season prize: finish in a season's top 10" : c.source === 'event' && c.id !== 'frame-diwali' ? 'Limited: on sale during special events' : null,
    })),
    new Set(['dice-ivory']),
  );
  const byId = (id) => items.find((x) => x.id === id);
  const card = (item, over = {}) => html(h('ul', null, h(ItemCard, { item, i: 0, equipped: {}, selected: false, coins: 99999, signedIn: true, offline: false, busy: false, buying: false, fresh: false, avatar: 2, preview: null, now: NOW, onSelect() {}, onBuy() {}, onEquip() {}, ...over })));
  it('a live limited item: ribbon, countdown, a Buy button', () => {
    const out = card(byId('frame-diwali'));
    expect(out).toContain('cj-shop-limited');
    expect(out).toContain('Limited');
    expect(out).toContain('Ends in 2d 13h');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('Buy Diwali Diya for 2,400 coins');
  });
  it('an off-sale limited item is disabled with "On sale during events"', () => {
    const out = card(byId('dice-diwali'));
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>On sale during events<\/button>/);
    expect(out).not.toContain('>Buy<');
  });
  it('achievement and season items show a lock and their hint, never Buy', () => {
    const a = card(byId('frame-streak'));
    expect(a).toContain('Unlock: Ten Day Streak achievement');
    expect(a).toContain('Achievement reward');
    expect(a).not.toContain('>Buy<');
    expect(a).not.toContain('Need ');
    const s = card(byId('frame-season'));
    expect(s).toContain("Season prize: finish in a season&#x27;s top 10");
    expect(s).not.toContain('>Buy<');
  });
  it('an owned reward item equips like any other', () => {
    expect(card({ ...byId('frame-streak'), owned: true })).toContain('Equip');
  });
  it('mergeItems without the server: reward items locked, limited ones off sale', () => {
    const local = mergeItems([], new Set());
    expect(local.find((x) => x.id === 'frame-diwali')).toMatchObject({ source: 'event', available: false, unlockHint: 'Limited: on sale during special events' });
    expect(local.find((x) => x.id === 'title-champion')).toMatchObject({ source: 'achievement', available: false, unlockHint: 'Unlock: Champion achievement', owned: false });
    expect(local.find((x) => x.id === 'frame-nizam')).toMatchObject({ source: 'shop', available: true, unlockHint: null });
    expect(local.find((x) => x.id === 'dice-ivory').owned).toBe(true);
    expect(cosmeticById('frame-diwali')).toBeTruthy();
  });
});

describe('GiftCard: badge unlocked', () => {
  const ago = (ms) => new Date(NOW - ms).toISOString();
  const stack = normalizeList([
    { id: 's1', kind: 'gift', title: 'Season prize: Monsoon Season', body: 'You finished #2 in Monsoon Season.', data: { coins: 2500, season: { id: 'x', name: 'Monsoon Season', rank: 2 } }, createdAt: ago(3000), read: false },
    { id: 'r1', kind: 'gift', title: 'Referral reward', body: null, data: { coins: 250, referral: { name: 'Meera', role: 'referrer' } }, createdAt: ago(2000), read: false },
    { id: 'a1', kind: 'achievement', title: 'Achievement unlocked: Champion', body: 'Win 10 matches.', data: { achievementId: 'champion', coins: 300, itemId: 'title-champion', itemName: 'Champion' }, createdAt: ago(1000), read: false },
  ]).reverse();
  it('a badge with the catalogue icon, the season placing and who joined, stacked with the totals', () => {
    const out = html(h(GiftCard, { gifts: stack, avatar: 2 }));
    expect(out).toContain('gp-art--badge');
    expect(out).toContain('Badge unlocked');
    expect(out).toContain('Monsoon Season: rank 2');
    expect(out).toContain('Meera joined with your link');
    expect(out).toContain('Collect +3,050');
    expect(out).toContain('3 gifts');
  });
  it('a single badge', () => {
    const out = html(h(GiftCard, { gifts: stack.filter((g) => g.kind === 'achievement'), avatar: 2 }));
    expect(out).toContain('gp-art--badge');
    expect(out).toContain('Collect +300');
  });
});
