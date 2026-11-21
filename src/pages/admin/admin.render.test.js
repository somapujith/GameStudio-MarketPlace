// Admin console render tests (server-side render, node env): the access guard, pages with mocked data, and the
// permission gating that hides economy actions from moderators. Effects do not run in SSR, so pages get `initial`.
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/components/art/Avatar.jsx', () => ({
  default: ({ preset }) => h('span', { 'data-avatar': preset }),
  Avatar: ({ preset }) => h('span', { 'data-avatar': preset }),
  AVATAR_PRESETS: [],
}));

const { AuthContext } = await import('@/lib/auth.jsx');
const { default: AdminApp } = await import('./AdminApp.jsx');
const { default: Dashboard, DashboardView } = await import('./Dashboard.jsx');
const { default: Users } = await import('./Users.jsx');
const { default: UserDetail } = await import('./UserDetail.jsx');
const { RoomsTable } = await import('./Rooms.jsx');
const { MatchesTable } = await import('./Matches.jsx');
const { default: Grants } = await import('./Grants.jsx');
const { default: Announcements, announcementErrors, announcementBody } = await import('./Announcements.jsx');
const { default: Audit } = await import('./Audit.jsx');
const { actionRules } = await import('@/components/admin/UserActions.jsx');
const { adminValue } = await import('@/components/admin/hooks.js');
const model = await import('@/components/admin/model.js');
const adminApi = await import('@/lib/adminApi.js');
const { withAdminAction } = await import('@/components/shell/nav/CommandPalette.jsx');
const { buildSections } = await import('@/components/shell/nav/paletteModel.js');

const base = {
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
};
const ADMIN = { id: 'a0000000-0000-4000-8000-000000000001', name: 'Pujith', avatar: 3, isGuest: false, role: 'admin', friendCode: 'HYD-ADMN' };
const MOD = { ...ADMIN, id: 'a0000000-0000-4000-8000-000000000002', name: 'Meera', role: 'moderator' };
const PLAYER = { ...ADMIN, id: 'u0000000-0000-4000-8000-000000000003', name: 'Rio', role: 'user' };
const ME_ADMIN = { role: 'admin', name: 'Pujith', permissions: ['view', 'moderate', 'announce', 'economy', 'bulk', 'roles'] };
const ME_MOD = { role: 'moderator', name: 'Meera', permissions: ['view', 'moderate', 'announce'] };

/** Render `el` under `/admin/*` at `path`, signed in as `user`. */
const at = (path, el, user) =>
  renderToString(
    h(MemoryRouter, { initialEntries: [path] }, h(AuthContext.Provider, { value: { ...base, user } }, h(Routes, null, h(Route, { path: '/admin/*', element: el })))),
  );
/** The console frame (AdminApp) around one section route. */
const consoleAt = (path, route, el, { user = ADMIN, me = ME_ADMIN } = {}) =>
  at(path, h(AdminApp, { initialMe: me }, h(Routes, null, h(Route, route ? { path: route, element: el } : { index: true, element: el }))), user);

const STATS = {
  users: { total: 1284, members: 902, guests: 382, banned: 3, staff: 2 },
  signups: { today: 14, week: 96 },
  active: { day: 211, week: 640 },
  matches: { today: 37, week: 260, total: 4120 },
  rooms: { live: 9, lobby: 4, playing: 5 },
  economy: { coinsInCirculation: 1843000, avgCoins: 2043.4, itemsOwned: 3110 },
  series: {
    days: Array.from({ length: 14 }, (_, i) => `2026-11-${String(8 + i).padStart(2, '0')}`),
    signups: [4, 6, 9, 3, 12, 8, 10, 7, 15, 11, 9, 13, 18, 14],
    active: [120, 140, 130, 160, 170, 150, 180, 175, 190, 200, 185, 205, 220, 211],
    matches: [20, 25, 22, 30, 28, 35, 31, 33, 40, 38, 36, 41, 39, 37],
  },
  topCoins: [{ id: 'u1', name: 'Kiran Rao', avatar: 7, coins: 48200 }],
};

const ROW = {
  id: PLAYER.id,
  name: 'Rio',
  handle: 'rio',
  avatar: 2,
  email: 'rio@example.com',
  friendCode: 'HYD-R10X',
  isGuest: false,
  role: 'user',
  banned: true,
  coins: 1500,
  xp: 900,
  level: 6,
  games: 41,
  wins: 12,
  createdAt: '2026-10-01T10:00:00Z',
  lastSeen: '2026-11-21T09:00:00Z',
};

const detail = (over = {}) => ({
  user: { ...ROW, banned: false, bannedAt: null, banReason: null, dailyStreak: 4, bestWorth: 9800, rentEarned: 4200, equipped: { frame: 'frame-aurora' }, online: true, ...over },
  items: [{ id: 'frame-aurora', name: 'Aurora', kind: 'frame', rarity: 'legendary', acquiredAt: '2026-11-02T10:00:00Z', pricePaid: 0 }],
  friends: { count: 8 },
  matches: [{ id: 'm1', gameId: 'hyderabad-tycoon', endedAt: '2026-11-20T10:00:00Z', rank: 1, playerCount: 4, finalWorth: 12000, won: true }],
  actions: [{ id: 7, action: 'coins', adminId: ADMIN.id, adminName: 'Pujith', targetId: PLAYER.id, targetName: 'Rio', details: { amount: 500, before: 1000, after: 1500, reason: 'Bug bounty' }, createdAt: '2026-11-21T08:00:00Z' }],
  notifications: [{ id: 'n1', kind: 'gift', title: 'You got 500 coins', body: null, data: { coins: 500, from: 'Pujith' }, createdAt: '2026-11-21T08:00:00Z', read: false }],
  rooms: [],
});

describe('access guard', () => {
  const notFound = 'This stall is closed';
  it('signed out, regular users and guests get the normal 404', () => {
    expect(at('/admin', h(AdminApp), null)).toContain(notFound);
    expect(at('/admin/users', h(AdminApp), PLAYER)).toContain(notFound);
    expect(at('/admin', h(AdminApp), { ...MOD, isGuest: true })).toContain(notFound);
    expect(at('/admin', h(AdminApp), PLAYER)).not.toContain('Admin console');
  });
  it('a custom not-found element is used when given', () => {
    expect(at('/admin', h(AdminApp, { notFound: h('p', null, 'shell 404') }), PLAYER)).toContain('shell 404');
  });
  it('waits for the session instead of flashing a 404', () => {
    const html = renderToString(h(MemoryRouter, { initialEntries: ['/admin'] }, h(AuthContext.Provider, { value: { ...base, loading: true } }, h(AdminApp))));
    expect(html).toContain('Checking your session');
    expect(html).not.toContain(notFound);
  });
  it('staff get the console: sidebar, sections, name and role chip, back link', () => {
    const html = at('/admin', h(AdminApp, { initialMe: ME_MOD }, h('p', null, 'section')), MOD);
    expect(html).toContain('Admin console');
    for (const label of ['Dashboard', 'Users', 'Live tables', 'Matches', 'Announcements', 'Audit log', 'Back to site']) expect(html).toContain(label);
    expect(html).toContain('Meera');
    expect(html).toContain('adm-chip--moderator');
    expect(html).not.toContain('>Grants<'); // bulk grants are admin only
    expect(html).not.toContain(notFound);
  });
  it('admins also see Grants', () => {
    expect(at('/admin', h(AdminApp, { initialMe: ME_ADMIN }, h('p', null, 'x')), ADMIN)).toContain('Grants');
  });
  it('isStaff / can', () => {
    expect(adminApi.isStaff(ADMIN)).toBe(true);
    expect(adminApi.isStaff(MOD)).toBe(true);
    expect(adminApi.isStaff(PLAYER)).toBe(false);
    expect(adminApi.isStaff({ ...ADMIN, isGuest: true })).toBe(false);
    expect(adminApi.isStaff(null)).toBe(false);
    expect(adminApi.can(ME_MOD, 'economy')).toBe(false);
    expect(adminApi.can(ME_ADMIN, 'economy')).toBe(true);
    expect(adminApi.can(null, 'view')).toBe(false);
  });
});

describe('dashboard', () => {
  it('renders tiles, 14-day charts (active labelled approximate) and top holders', () => {
    const html = renderToString(h(MemoryRouter, null, h(DashboardView, { stats: STATS })));
    expect(html).toContain('1,284'); // < 10k stays exact
    expect(html).toContain('902 members');
    expect(html).toContain('382 guests');
    expect(html).toContain('Coins in circulation');
    expect(html).toContain('1.8M');
    expect(html).toContain('Live rooms');
    expect(html).toContain('Banned');
    expect(html).toContain('approx.');
    expect(html).toContain('(approximate)');
    expect((html.match(/<svg[^>]*adm-chart__svg/g) || []).length).toBe(3);
    expect((html.match(/class="adm-chart__bar/g) || []).length).toBe(42);
    expect(html).toContain('Kiran Rao');
    expect(html).toContain('48,200');
    expect(html).toContain('/admin/users/u1');
  });
  it('inside the console with mocked stats: refresh button and heading', () => {
    const html = consoleAt('/admin', '', h(Dashboard, { initial: STATS }));
    expect(html).toContain('Dashboard');
    expect(html).toContain('Refresh');
    expect(html).toContain('Top coin holders');
  });
});

describe('users', () => {
  it('renders the table from mocked data with links, chips and the banned badge', () => {
    const html = consoleAt('/admin/users?filter=banned&q=rio', 'users', h(Users, { initial: { users: [ROW], total: 1, page: 1, pageSize: 25 } }));
    expect(html).toContain('<th scope="col">User</th>');
    expect(html).toContain('Rio');
    expect(html).toContain('@rio');
    expect(html).toContain('rio@example.com');
    expect(html).toContain('1,500');
    expect(html).toContain('Banned');
    expect(html).toContain(`/admin/users/${PLAYER.id}`);
    expect(html).toContain('aria-pressed="true"'); // the banned chip from the URL
    expect(html).toContain('value="rio"'); // search box from the URL
    expect(html).toContain('1–1 of 1');
  });
  it('empty state', () => {
    const html = consoleAt('/admin/users?q=zzz', 'users', h(Users, { initial: { users: [], total: 0, page: 1, pageSize: 25 } }));
    expect(html).toContain('No users match');
  });
  it('URL state round trip', () => {
    const q = model.readUserQuery(new URLSearchParams('q=rio&filter=staff&sort=coins&page=3'));
    expect(q).toEqual({ q: 'rio', filter: 'staff', sort: 'coins', page: 3 });
    expect(model.readUserQuery(new URLSearchParams('filter=nope&sort=bad&page=-2'))).toEqual({ q: '', filter: 'all', sort: 'newest', page: 1 });
    expect(model.writeUserQuery({ q: ' rio ', filter: 'all', sort: 'newest', page: 1 })).toEqual({ q: 'rio' });
  });
});

describe('user detail and permission gating', () => {
  const route = 'users/:id';
  const path = `/admin/users/${PLAYER.id}`;

  it('admin sees economy, moderation and role actions', () => {
    const html = consoleAt(path, route, h(UserDetail, { initial: detail() }));
    expect(html).toContain('Rio');
    expect(html).toContain('Online');
    expect(html).toContain('HYD-R10X');
    for (const s of ['Give coins', 'Give XP', 'Grant item', 'Revoke', 'Send message', 'Rename', 'Reset @rio', 'Ban user', 'Change role']) expect(html).toContain(s);
    expect(html).toContain('Aurora');
    expect(html).toContain('legendary');
    expect(html).toContain('1,000 → 1,500');
    expect(html).toContain('Bug bounty');
    expect(html).toContain('You got 500 coins');
    expect(html).toContain(`/admin/audit?targetId=${PLAYER.id}`);
    // owned + free items are disabled in the grant select
    expect(html).toMatch(/<option value="frame-aurora" disabled="">/);
    expect(html).toMatch(/<option value="dice-ivory" disabled="">/);
  });

  it('moderators never see economy actions', () => {
    const html = consoleAt(path, route, h(UserDetail, { initial: detail() }), { user: MOD, me: ME_MOD });
    for (const s of ['Give coins', 'Give XP', 'Grant item', 'Revoke', 'Change role', 'Economy']) expect(html).not.toContain(s);
    expect(html).toContain('Send message');
    expect(html).toContain('Ban user');
  });

  it('moderators cannot act on staff; admins not on themselves', () => {
    const can = (me) => adminValue(me).can;
    expect(actionRules({ can: can(ME_MOD), selfId: MOD.id, target: { ...PLAYER, role: 'admin' } }).moderateBlocked).toMatch(/staff/);
    expect(actionRules({ can: can(ME_MOD), selfId: MOD.id, target: PLAYER }).moderateBlocked).toBe('');
    expect(actionRules({ can: can(ME_ADMIN), selfId: ADMIN.id, target: { ...ADMIN } }).moderateBlocked).toMatch(/own/);
    expect(actionRules({ can: can(ME_ADMIN), selfId: ADMIN.id, target: { ...ADMIN } }).roleBlocked).toMatch(/own role/);
    expect(actionRules({ can: can(ME_ADMIN), selfId: ADMIN.id, target: { ...PLAYER, isGuest: true } }).roleBlocked).toMatch(/Guests/);
    expect(actionRules({ can: can(ME_ADMIN), selfId: ADMIN.id, target: { ...MOD } }).moderateBlocked).toBe('');
  });

  it('a banned user shows the reason and an unban form', () => {
    const html = consoleAt(path, route, h(UserDetail, { initial: detail({ banned: true, bannedAt: '2026-11-20T10:00:00Z', banReason: 'Cheating' }) }));
    expect(html).toContain('Cheating');
    expect(html).toContain('Unban user');
  });

  it('before me loads, nothing is actionable', () => {
    const html = consoleAt(path, route, h(UserDetail, { initial: detail() }), { me: { role: 'admin', name: 'x', permissions: [] } });
    expect(html).not.toContain('Give coins');
    expect(html).not.toContain('Ban user');
  });
});

describe('rooms, matches, audit', () => {
  it('rooms table with member links', () => {
    const rooms = [{ code: 'ABC234', gameId: 'hyderabad-tycoon', hostName: 'Rio', status: 'playing', visibility: 'public', playerCount: 2, maxPlayers: 4, members: [{ id: 'u9', name: 'Gita', avatar: 1 }], createdAt: '2026-11-21T08:00:00Z', updatedAt: '2026-11-21T09:00:00Z' }];
    const html = renderToString(h(MemoryRouter, null, h(RoomsTable, { rooms })));
    expect(html).toContain('ABC234');
    expect(html).toContain('2/4');
    expect(html).toContain('/admin/users/u9');
    expect(html).toContain('Nawabi Raj');
  });
  it('matches expand to standings with the winner linked', () => {
    const matches = [{ id: 'm1', gameId: 'hyderabad-tycoon', roomCode: 'ABC234', startedAt: '2026-11-21T08:00:00Z', endedAt: '2026-11-21T08:40:00Z', rounds: 22, playerCount: 3, winner: { id: 'u9', name: 'Gita' }, players: [{ userId: 'u9', name: 'Gita', rank: 1, isBot: false, finalWorth: 15000 }, { userId: null, name: 'Bot Bhai', rank: 2, isBot: true, finalWorth: 9000 }] }];
    const closed = renderToString(h(MemoryRouter, null, h(MatchesTable, { matches })));
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('/admin/users/u9');
    expect(closed).toContain('40 min');
    const open = renderToString(h(MemoryRouter, null, h(MatchesTable, { matches, initiallyOpen: ['m1'] })));
    expect(open).toContain('Final standings');
    expect(open).toContain('15,000');
    expect(open).toContain('Bot Bhai');
  });
  it('audit log filters from the URL, readable details', () => {
    const html = consoleAt(`/admin/audit?targetId=${PLAYER.id}&action=coins`, 'audit', h(Audit, { initial: { actions: detail().actions, total: 1, page: 1, pageSize: 50 } }));
    expect(html).toContain('Coins');
    expect(html).toContain('+500');
    expect(html).toContain('1,000 → 1,500');
    expect(html).toContain(`value="${PLAYER.id}"`);
    expect(html).toContain('Clear filters');
  });
  it('detail parts', () => {
    expect(model.detailParts({ action: 'role', details: { before: 'user', after: 'moderator' } })).toEqual([{ k: 'Change', v: 'user → moderator' }]);
    const bulk = model.detailParts({ action: 'grant.bulk', details: { audience: 'members', coins: 200, itemId: 'frame-aurora', count: 900, reason: 'Diwali' } });
    expect(bulk.map((p) => p.v)).toEqual(['Aurora', '200', 'all members', '900', 'Diwali']);
  });
});

describe('grants', () => {
  it('moderators get the access message', () => {
    expect(consoleAt('/admin/grants', 'grants', h(Grants), { user: MOD, me: ME_MOD })).toContain('No admin access');
  });
  it('admins get the form with the audience radios and a preview', () => {
    const html = consoleAt('/admin/grants', 'grants', h(Grants));
    expect(html).toContain('Specific users');
    expect(html).toContain('All members');
    expect(html).toContain('Active in the last 7 days');
    expect(html).toContain('Review and grant');
    expect(html).toContain('Pick coins, an item or both.');
  });
  it('preview sentence', () => {
    expect(model.grantPreview({ audience: 'members', coins: 200, itemId: 'frame-aurora' })).toBe('Give 200 coins and the Aurora frame to all members');
    expect(model.grantPreview({ audience: 'ids', count: 3, coins: 50 })).toBe('Give 50 coins to 3 selected users');
    expect(model.grantPreview({ audience: 'active7d', itemId: 'title-chai' })).toBe('Give the Chai Connoisseur title to every member active in the last 7 days');
  });
  it('parses pasted ids', () => {
    const a = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    expect(adminApi.parseIds(`${a}, ${a.toUpperCase()}\nnope`)).toEqual({ ids: [a], bad: ['nope'] });
  });
});

describe('announcements', () => {
  it('renders the list with live previews and the form', () => {
    const initial = {
      announcements: [
        { id: 'a1', message: 'Diwali week: double coins!', tone: 'event', linkUrl: '/shop', linkLabel: 'Open shop', startsAt: '2026-11-01T00:00:00Z', endsAt: null, active: true, createdAt: '2026-11-01T00:00:00Z' },
        { id: 'a2', message: 'Maintenance tonight', tone: 'warning', linkUrl: null, linkLabel: null, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-02T00:00:00Z', active: true, createdAt: '2026-11-01T00:00:00Z' },
      ],
    };
    const html = consoleAt('/admin/announcements', 'announcements', h(Announcements, { initial }));
    expect(html).toContain('adm-banner--event');
    expect(html).toContain('adm-banner--warning');
    expect(html).toContain('Open shop');
    expect(html).toContain('Live');
    expect(html).toContain('Ended');
    expect(html).toContain('New announcement');
    expect(html).toContain('Live preview');
  });
  it('validates the contract limits and linkUrl', () => {
    const f = { message: '', tone: 'info', linkUrl: '', linkLabel: '', startsAt: '', endsAt: '', active: true };
    expect(announcementErrors(f).message).toBeTruthy();
    expect(announcementErrors({ ...f, message: 'x'.repeat(201) }).message).toMatch(/200/);
    expect(announcementErrors({ ...f, message: 'ok', linkUrl: '//evil.com' }).linkUrl).toBeTruthy();
    expect(announcementErrors({ ...f, message: 'ok', linkUrl: 'http://x.com' }).linkUrl).toBeTruthy();
    expect(announcementErrors({ ...f, message: 'ok', linkUrl: 'javascript:alert(1)' }).linkUrl).toBeTruthy();
    expect(announcementErrors({ ...f, message: 'ok', linkUrl: '/shop' })).toEqual({});
    expect(announcementErrors({ ...f, message: 'ok', linkUrl: 'https://example.com/x' })).toEqual({});
    expect(announcementErrors({ ...f, message: 'ok', linkUrl: '/shop', linkLabel: 'x'.repeat(41) }).linkLabel).toMatch(/40/);
    expect(announcementErrors({ ...f, message: 'ok', startsAt: '2026-11-21T10:00', endsAt: '2026-11-21T09:00' }).endsAt).toMatch(/after/);
  });
  it('request bodies: POST omits empty fields, PATCH clears them', () => {
    const f = { message: ' hi ', tone: 'info', linkUrl: '', linkLabel: '', startsAt: '', endsAt: '', active: false };
    expect(announcementBody(f)).toEqual({ message: 'hi', tone: 'info', active: false });
    expect(announcementBody(f, { patch: true })).toEqual({ message: 'hi', tone: 'info', active: false, linkUrl: null, linkLabel: null, endsAt: null });
  });
});

describe('validators match the contract', () => {
  it('amounts', () => {
    expect(adminApi.amountError('0')).toBeTruthy();
    expect(adminApi.amountError('1000001')).toBeTruthy();
    expect(adminApi.amountError('1000000')).toBe('');
    expect(adminApi.amountError('-500')).toBe('');
    expect(adminApi.amountError('1.5')).toBeTruthy();
    expect(adminApi.bulkCoinsError('100001')).toBeTruthy();
    expect(adminApi.bulkCoinsError('100000')).toBe('');
    expect(adminApi.bulkCoinsError('')).toBe('');
  });
  it('reasons, names, titles', () => {
    expect(adminApi.reasonError('ab')).toBeTruthy();
    expect(adminApi.reasonError('abc')).toBe('');
    expect(adminApi.reasonError('x'.repeat(201))).toBeTruthy();
    expect(adminApi.reasonError('', { optional: true })).toBe('');
    expect(adminApi.nameError('x'.repeat(25))).toBeTruthy();
    expect(adminApi.nameError('  ')).toBeTruthy();
    expect(adminApi.maxLenError('x'.repeat(81), 80)).toBeTruthy();
  });
  it('item groups disable owned and free items', () => {
    const groups = model.itemGroups(['frame-aurora']);
    const all = groups.flatMap((g) => g.items);
    expect(all.find((i) => i.id === 'frame-aurora').disabled).toBe(true);
    expect(all.find((i) => i.id === 'dice-ivory').note).toBe('free');
    expect(all.find((i) => i.id === 'frame-pearl').disabled).toBe(false);
    expect(groups.map((g) => g.kind)).toContain('voice');
  });
  it('relative time', () => {
    const now = Date.parse('2026-11-21T12:00:00Z');
    expect(model.relTime('2026-11-21T11:59:50Z', now)).toBe('just now');
    expect(model.relTime('2026-11-21T11:55:00Z', now)).toBe('5 min ago');
    expect(model.relTime('2026-11-21T09:00:00Z', now)).toBe('3 h ago');
    expect(model.relTime('2026-11-19T12:00:00Z', now)).toBe('2 d ago');
    expect(model.relTime(null, now)).toBe('–');
  });
});

describe('command palette entry', () => {
  it('adds "Admin console" to the quick actions and to matching searches only', () => {
    const empty = withAdminAction(buildSections({ query: '', games: [] }), '');
    expect(empty.find((s) => s.id === 'actions').items.at(-1).to).toBe('/admin');
    const hit = withAdminAction(buildSections({ query: 'admin', games: [] }), 'admin');
    expect(hit.flatMap((s) => s.items).some((i) => i.id === 'a-admin')).toBe(true);
    expect(hit.at(-1).id).toBe('search');
    const miss = withAdminAction(buildSections({ query: 'ludo', games: [] }), 'ludo');
    expect(miss.flatMap((s) => s.items).some((i) => i.id === 'a-admin')).toBe(false);
  });
});
