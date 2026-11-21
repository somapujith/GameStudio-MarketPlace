// Render tests (server-side render, node env: effects and portals do not run) for the player-facing admin features:
// the gift popup's content, the inbox and its bell, the announcement strip and the suspended screen (also inside
// AppShell: the full page on member routes, the shell plus a strip on public pages).
import { describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/components/art/index.js', () => ({
  Avatar: ({ preset }) => h('span', { 'data-avatar': preset }),
  AVATAR_PRESETS: Array.from({ length: 12 }, (_, id) => ({ id, label: `Avatar ${id}` })),
  Logo: () => h('span', { 'data-logo': true }),
  Scene: () => h('span', { 'data-scene': true }),
}));

const { AuthContext } = await import('@/lib/auth.jsx');
const { NotificationsContext } = await import('./useNotifications.jsx');
const { default: GiftPopup, GiftCard } = await import('./GiftPopup.jsx');
const { default: NotificationBell, InboxPanel } = await import('./NotificationBell.jsx');
const { default: AnnouncementBar, AnnouncementView } = await import('./AnnouncementBar.jsx');
const { default: SuspendedScreen, SuspendedNotice, SuspendedStrip } = await import('./SuspendedScreen.jsx');
const { normalizeAnnouncement } = await import('./announcementModel.js');
const { normalizeList } = await import('./notificationsModel.js');
const { default: AppShell } = await import('@/components/shell/AppShell.jsx');

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const ago = (ms) => new Date(NOW - ms).toISOString();
const member = { id: 'u1', name: 'Ravi', avatar: 2, friendCode: 'HYD-7K2Q', isGuest: false, level: 3, xp: 10, coins: 500, role: 'user', stats: {} };
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

const wrap = (el, { path = '/', auth = {}, notes = null } = {}) => {
  let tree = el;
  if (notes) tree = h(NotificationsContext.Provider, { value: notes }, tree);
  return renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, h(AuthContext.Provider, { value: { ...authBase, ...auth } }, tree)));
};

const gifts = normalizeList([
  { id: 'g1', kind: 'gift', title: 'Diwali bonus', body: 'Happy Diwali from all of us!', data: { coins: 500 }, createdAt: ago(5000), read: false },
  { id: 'g2', kind: 'gift', title: 'Sorry for the outage', body: null, data: { coins: 1000, xp: 200 }, createdAt: ago(4000), read: false },
  { id: 'g3', kind: 'gift', title: 'A new frame', body: null, data: { itemId: 'frame-nizam', itemName: 'Nizam Gold' }, createdAt: ago(3000), read: false },
]).reverse();

describe('GiftCard', () => {
  it('one gift: who it is from, the gift, its reward and a focused Collect button', () => {
    const html = renderToStaticMarkup(h(GiftCard, { gifts: [gifts[0]] }));
    expect(html).toContain('Jalebi Games team');
    expect(html).toContain('Diwali bonus');
    expect(html).toContain('Happy Diwali from all of us!');
    expect(html).toContain('+500 coins');
    expect(html).toMatch(/<button[^>]*data-autofocus[^>]*>/);
    expect(html).toContain('Collect +500');
    expect(html).not.toContain('gp-stack--many');
    expect(html).toMatch(/<p class="sr-only" role="status" aria-live="polite"><\/p>/);
  });
  it('several gifts are one stacked card with totals, not a popup each', () => {
    const html = renderToStaticMarkup(h(GiftCard, { gifts }));
    expect(html).toContain('gp-stack gp-stack--many');
    expect((html.match(/class="gp-gift"/g) || []).length).toBe(3);
    expect(html).toContain('aria-label="3 gifts"');
    expect(html).toContain('×3');
    expect(html).toContain('Collect +1,500');
    expect(html).toContain('+200 XP');
    expect(html).toContain('1 item');
  });
  it('an item gift shows the item with the shop art, its name and kind', () => {
    const html = renderToStaticMarkup(h(GiftCard, { gifts: [gifts[2]], avatar: 4 }));
    expect(html).toContain('gp-art--item');
    expect(html).toContain('data-rarity="epic"');
    expect(html).toContain('data-avatar="4"');
    expect(html).toContain('Nizam Gold');
    expect(html).toContain('frame');
    expect(html).toMatch(/<button[^>]*gp-collect[^>]*>.*Collect<\/button>/s);
    expect(html).not.toContain('Collect +');
  });
  it('turns into Done after collecting and announces it', () => {
    const html = renderToStaticMarkup(h(GiftCard, { gifts, collected: true, live: '3 gifts collected: 1,500 coins.' }));
    expect(html).toContain('data-collected');
    expect(html).toContain('Done');
    expect(html).not.toContain('Collect +');
    expect(html).toContain('3 gifts collected: 1,500 coins.');
  });
  it('the popup itself stays out of the way on first render (it opens from the browser, after a delay)', () => {
    const notes = { enabled: true, items: gifts, unread: 3, status: 'ok', reload() {}, markRead: async () => {}, markAllRead: async () => {} };
    expect(wrap(h(GiftPopup), { auth: { user: member }, notes })).toBe('');
  });
});

describe('InboxPanel', () => {
  const items = normalizeList([
    { id: 'm1', kind: 'message', title: 'Welcome to the season', body: 'New maps this weekend.', data: {}, createdAt: ago(2 * 60_000), read: false },
    { id: 'g1', kind: 'gift', title: 'Diwali bonus', body: null, data: { coins: 500 }, createdAt: ago(3 * 3600_000), read: true },
    { id: 's1', kind: 'system', title: 'Your handle was reset', body: null, data: {}, createdAt: ago(3 * 86400_000), read: true },
  ]);
  it('lists the latest with icon per kind, the team label on messages, times and unread dots', () => {
    const html = renderToStaticMarkup(h(InboxPanel, { items, unread: 1, now: NOW, headingId: 'h' }));
    expect(html).toContain('<h2 id="h" class="nt-panel__title">Notifications</h2>');
    expect(html).toContain('nt-item nt-item--message is-unread');
    expect(html).toContain('nt-item nt-item--gift"');
    expect(html).toContain('nt-item nt-item--system"');
    expect(html).toContain('<span class="nt-team">Jalebi Games team</span>');
    expect((html.match(/nt-team/g) || []).length).toBe(1);
    expect(html).toContain('<span class="sr-only">Unread. </span>');
    expect((html.match(/nt-item__dot/g) || []).length).toBe(1);
    expect(html).toContain('2 min ago');
    expect(html).toContain('3 h ago');
    expect(html).toContain('3 days ago');
    expect(html).toContain('+500 coins');
    expect(html).toMatch(/<button type="button" class="nt-markall">/);
  });
  it('Mark all read stays focusable but says it is disabled when nothing is unread', () => {
    const html = renderToStaticMarkup(h(InboxPanel, { items, unread: 0, now: NOW }));
    expect(html).toMatch(/class="nt-markall" aria-disabled="true"/);
    expect(html).not.toMatch(/nt-markall"[^>]*\sdisabled/);
  });
  it('empty, loading and error states', () => {
    expect(renderToStaticMarkup(h(InboxPanel, { items: [], unread: 0 }))).toContain('Nothing here yet.');
    expect(renderToStaticMarkup(h(InboxPanel, { items: [], status: 'loading' }))).toContain('aria-busy="true"');
    const err = renderToStaticMarkup(h(InboxPanel, { items: [], status: 'error', onRetry() {} }));
    expect(err).toContain('role="alert"');
    expect(err).toContain('Try again');
  });
  it('in the phone sheet the Modal title is the heading', () => {
    const html = renderToStaticMarkup(h(InboxPanel, { items, unread: 1, heading: false }));
    expect(html).not.toContain('<h2');
    expect(html).toContain('1 unread');
  });
});

describe('NotificationBell', () => {
  const notes = (over = {}) => ({ enabled: true, items: [], unread: 2, status: 'ok', reload() {}, markRead: async () => {}, markAllRead: async () => {}, ...over });
  it('a closed button with the unread count for members', () => {
    const html = wrap(h(NotificationBell), { notes: notes() });
    expect(html).toMatch(/<button[^>]*class="nt-bell has-unread"[^>]*>/);
    expect(html).toContain('aria-label="Notifications, 2 unread"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('bd-badge');
    expect(html).not.toContain('nt-pop');
  });
  it('no badge at zero, nothing at all for guests and visitors', () => {
    const zero = wrap(h(NotificationBell), { notes: notes({ unread: 0 }) });
    expect(zero).toContain('aria-label="Notifications"');
    expect(zero).not.toContain('bd-badge');
    expect(wrap(h(NotificationBell), { notes: notes({ enabled: false }) })).toBe('');
    expect(wrap(h(NotificationBell))).toBe('');
  });
});

describe('AnnouncementView', () => {
  const view = (raw) => renderToStaticMarkup(h(MemoryRouter, null, h(AnnouncementView, { a: normalizeAnnouncement(raw), onDismiss() {} })));
  const base = { id: 'a1', message: 'Diwali double coins all weekend!', startsAt: ago(1000), endsAt: null, active: true };
  it('one strip per tone, with the message, a tag and a dismiss button', () => {
    for (const tone of ['info', 'event', 'warning']) {
      const html = view({ ...base, tone });
      expect(html).toContain(`nt-ann nt-ann--${tone}`);
      expect(html).toContain('Diwali double coins all weekend!');
      expect(html).toContain('aria-label="Dismiss announcement"');
      expect(html).toContain('data-announcement="a1"');
    }
    expect(view({ ...base, tone: 'warning' })).toContain('aria-label="Heads up"');
  });
  it('internal links go through the router; https links open safely in a new tab', () => {
    const internal = view({ ...base, linkUrl: '/shop', linkLabel: 'Open the shop' });
    expect(internal).toMatch(/<a[^>]*href="\/shop"[^>]*>Open the shop/);
    expect(internal).toContain('nt-ann__link');
    expect(internal).not.toContain('target=');
    const external = view({ ...base, linkUrl: 'https://example.com/event', linkLabel: 'Event rules' });
    expect(external).toContain('href="https://example.com/event"');
    expect(external).toContain('target="_blank"');
    expect(external).toContain('rel="noopener noreferrer"');
    expect(external).toContain('(opens in a new tab)');
    expect(view({ ...base, linkUrl: 'javascript:alert(1)', linkLabel: 'x' })).not.toContain('nt-ann__link');
  });
  it('the bar renders nothing before its first answer', () => {
    expect(wrap(h(AnnouncementBar))).toBe('');
  });
});

describe('Suspended', () => {
  it('the notice: headline, the reason, Sign out and Help', () => {
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(SuspendedNotice, { reason: 'Repeated abuse in chat', onSignOut() {} })));
    expect(html).toContain('Your account has been suspended');
    expect(html).toContain('Reason from the moderators');
    expect(html).toContain('Repeated abuse in chat');
    expect(html).toMatch(/<button[^>]*>.*Sign out<\/button>/s);
    expect(html).toContain('href="/help"');
    expect(html).toContain('href="/terms"');
  });
  it('no reason given', () => {
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(SuspendedNotice, { reason: '' })));
    expect(html).toContain('No reason was given.');
  });
  it('the full page has its own main landmark and the public links', () => {
    const html = wrap(h(SuspendedScreen, { reason: 'Spam' }), { auth: { suspended: { reason: 'Spam' } } });
    expect(html).toContain('<main id="main"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('hub-app nt-susp');
  });
  it('the strip for public pages', () => {
    const html = wrap(h(SuspendedStrip), { auth: { suspended: { reason: '' } } });
    expect(html).toContain('Your account is suspended');
    expect(html).toContain('Sign out');
  });
});

describe('AppShell with a suspended account', () => {
  const shell = (path, auth) =>
    wrap(
      h(Routes, null, h(Route, { element: h(AppShell) }, h(Route, { path: '*', element: h('p', { id: 'page' }, 'PAGE') }))),
      { path, auth },
    );
  it('member routes show only the suspended screen', () => {
    const html = shell('/profile', { suspended: { reason: 'Cheating' } });
    expect(html).toContain('Your account has been suspended');
    expect(html).toContain('Cheating');
    expect(html).not.toContain('PAGE');
    expect(html).not.toContain('hub-topbar');
  });
  it('public pages keep the shell, with the suspended strip instead of announcements', () => {
    const html = shell('/help', { suspended: { reason: 'Cheating' } });
    expect(html).toContain('PAGE');
    expect(html).toContain('hub-topbar');
    expect(html).toContain('nt-ann--susp');
    expect(html).not.toContain('Your account has been suspended');
  });
  it('not suspended: the normal shell, and the bell for a member', () => {
    const html = shell('/', { user: member });
    expect(html).toContain('PAGE');
    expect(html).toContain('nt-bell');
    expect(html).not.toContain('nt-ann--susp');
  });
});
