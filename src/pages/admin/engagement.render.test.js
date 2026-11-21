// Admin console: the engagement screens (docs/ENGAGEMENT.md "Admin console screens"). Server-side render with mocked
// data (effects do not run in SSR, so pages get `initial`), the moderator read-only gating, the prize-tier validation
// model (same messages as worker/seasons.js), the payout gate and the audit details of the new actions.
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
const { default: Events, EventList } = await import('./Events.jsx');
const { default: Seasons, SeasonForm } = await import('./Seasons.jsx');
const { default: SeasonDetail, SeasonDetailView } = await import('./SeasonDetail.jsx');
const { default: Achievements } = await import('./Achievements.jsx');
const { default: Referrals } = await import('./Referrals.jsx');
const { default: UserDetail } = await import('./UserDetail.jsx');
const { default: Audit } = await import('./Audit.jsx');
const { actionRules } = await import('@/components/admin/UserActions.jsx');
const { adminValue } = await import('@/components/admin/hooks.js');
const model = await import('@/components/admin/model.js');
const em = await import('@/components/admin/engagementModel.js');
const adminApi = await import('@/lib/adminApi.js');
const worker = await import('../../../worker/seasons.js');
const workerEvents = await import('../../../worker/events.js');

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
const ME_ADMIN = { role: 'admin', name: 'Pujith', permissions: ['view', 'moderate', 'announce', 'economy', 'bulk', 'roles'] };
const ME_MOD = { role: 'moderator', name: 'Meera', permissions: ['view', 'moderate', 'announce'] };
const RIO = 'b0000000-0000-4000-8000-000000000003';

const at = (path, el, user) =>
  renderToString(
    h(MemoryRouter, { initialEntries: [path] }, h(AuthContext.Provider, { value: { ...base, user } }, h(Routes, null, h(Route, { path: '/admin/*', element: el })))),
  );
const consoleAt = (path, route, el, { user = ADMIN, me = ME_ADMIN } = {}) =>
  at(path, h(AdminApp, { initialMe: me }, h(Routes, null, h(Route, { path: route, element: el }))), user);
const asMod = { user: MOD, me: ME_MOD };

const NOW = Date.now();
const iso = (hours) => new Date(NOW + hours * 3600_000).toISOString();

const EVENTS = {
  events: [
    { id: 'e1', kind: 'coin_boost', name: 'Double coins weekend', description: 'Every win pays double.', startsAt: iso(-5), endsAt: iso(40), active: true, createdAt: iso(-10), live: true, config: { multiplier: 2 } },
    { id: 'e2', kind: 'limited_shop', name: 'Diwali stall', description: null, startsAt: iso(24), endsAt: iso(96), active: true, createdAt: iso(-10), live: false, config: { itemIds: ['frame-diwali', 'dice-diwali'] } },
    { id: 'e3', kind: 'coin_boost', name: 'Launch boost', description: null, startsAt: iso(-200), endsAt: iso(-100), active: true, createdAt: iso(-300), live: false, config: { multiplier: 1.5 } },
    { id: 'e4', kind: 'coin_boost', name: 'Paused boost', description: null, startsAt: iso(-5), endsAt: iso(5), active: false, createdAt: iso(-10), live: false, config: { multiplier: 3 } },
  ],
};

const TIERS = [
  { fromRank: 1, toRank: 1, coins: 6000, itemId: 'title-season-champ', itemName: 'Season Champion' },
  { fromRank: 2, toRank: 3, coins: 3000 },
  { fromRank: 4, toRank: 10, coins: 1000, itemId: 'frame-season', itemName: 'Season Laurel' },
];
const season = (over = {}) => ({ id: 's1', name: 'Diwali Season', startsAt: iso(-24 * 30), endsAt: iso(-2), status: 'ended', prizeTiers: TIERS, createdAt: iso(-24 * 31), paidAt: null, ...over });
const SEASONS = {
  seasons: [
    season(),
    season({ id: 's2', name: 'Winter Season', startsAt: iso(-24), endsAt: iso(24 * 20), status: 'active', prizeTiers: [] }),
    season({ id: 's3', name: 'Monsoon Season', startsAt: iso(-24 * 90), endsAt: iso(-24 * 60), status: 'paid', paidAt: iso(-24 * 59) }),
  ],
};
const STANDINGS = (over = {}) => ({
  season: season(over),
  standings: [
    { rank: 1, userId: RIO, name: 'Rio', avatar: 2, points: 61, wins: 14, games: 19, equipped: {}, isMe: false },
    { rank: 2, userId: 'u2', name: 'Gita', avatar: 1, points: 40, wins: 9, games: 13, equipped: {}, isMe: false },
    { rank: 11, userId: 'u11', name: 'Late Larry', avatar: 4, points: 5, wins: 1, games: 2, equipped: {}, isMe: false },
  ],
  prizesPreview: [
    { rank: 1, userId: RIO, name: 'Rio', coins: 6000, itemId: 'title-season-champ', itemName: 'Season Champion' },
    { rank: 2, userId: 'u2', name: 'Gita', coins: 3000 },
  ],
});

describe('sidebar', () => {
  it('every staff member sees Events, Seasons, Achievements and Referrals', () => {
    const html = at('/admin', h(AdminApp, { initialMe: ME_MOD }, h('p', null, 'x')), MOD);
    for (const label of ['Events', 'Seasons', 'Achievements', 'Referrals']) expect(html).toContain(`>${label}<`);
    for (const p of ['/admin/events', '/admin/seasons', '/admin/achievements', '/admin/referrals']) expect(html).toContain(`href="${p}"`);
  });
  it('admin-write is the admin-only permission set, false before /me loads', () => {
    expect(adminApi.canAdminWrite(ME_ADMIN)).toBe(true);
    expect(adminApi.canAdminWrite(ME_MOD)).toBe(false);
    expect(adminApi.canAdminWrite({ role: 'admin', permissions: [] })).toBe(false);
    expect(adminApi.canAdminWrite(null)).toBe(false);
    expect(adminValue(ME_ADMIN).adminWrite).toBe(true);
    expect(adminValue(ME_MOD).adminWrite).toBe(false);
  });
});

describe('events', () => {
  it('admins get the list with status badges, effects and items, plus the form', () => {
    const html = consoleAt('/admin/events', 'events', h(Events, { initial: EVENTS }));
    for (const s of ['Double coins weekend', 'Diwali stall', 'Launch boost', 'Paused boost']) expect(html).toContain(s);
    for (const s of ['>Live<', '>Scheduled<', '>Ended<', '>Off<']) expect(html).toContain(s);
    expect(html).toContain('×2 coins');
    expect(html).toContain('2 limited items');
    expect(html).toContain('Diwali Diya');
    expect(html).toContain('Festive Diya');
    expect(html).toContain('New event');
    expect(html).toContain('Create event');
    for (const m of ['×1.5', '×2', '×2.5', '×3']) expect(html).toContain(`>${m}<`);
    expect(html).toContain('Delete Double coins weekend');
    expect(html).toContain('Edit Double coins weekend');
    expect(html).not.toContain('Read only');
    // tiles: one live boost, x2
    expect(html).toContain('Coin multiplier');
  });
  it('moderators see the list read only: no form, no edit or delete', () => {
    const html = consoleAt('/admin/events', 'events', h(Events, { initial: EVENTS }), asMod);
    expect(html).toContain('Double coins weekend');
    expect(html).toContain('Read only');
    expect(html).toContain('admin only');
    for (const s of ['New event', 'Create event', 'Edit Double', 'Delete Double', '>Edit<', '>Delete<']) expect(html).not.toContain(s);
  });
  it('the limited-shop picker offers only source: event cosmetics, with their art', () => {
    const items = em.eventItems();
    expect(items.map((c) => c.id)).toEqual(expect.arrayContaining(['frame-diwali', 'dice-diwali']));
    expect(items.every((c) => c.source === 'event')).toBe(true);
    const html = renderToString(h(MemoryRouter, null, h(EventList, { events: [EVENTS.events[1]], now: NOW })));
    expect(html).toContain('adm-itemart');
    expect(html).not.toContain('Edit'); // canEdit defaults to false
  });
  it('status follows the server rule (active and start <= now < end)', () => {
    expect(EVENTS.events.map((e) => em.eventStatus(e, NOW))).toEqual(['live', 'scheduled', 'ended', 'off']);
    expect(em.eventStatus({ active: true, startsAt: iso(0), endsAt: iso(1) }, NOW)).toBe('live');
    expect(em.eventStatus({ active: true, startsAt: iso(-1), endsAt: iso(0) }, NOW)).toBe('ended');
  });
  it('form validation uses the Worker messages', () => {
    const f = { ...em.emptyEventForm(NOW), name: 'Boost' };
    expect(em.eventErrors(f)).toEqual({});
    expect(em.eventErrors({ ...f, name: ' ' }).name).toBe('Name must be 1-60 characters.');
    expect(em.eventErrors({ ...f, name: 'x'.repeat(61) }).name).toBe('Name must be 1-60 characters.');
    expect(em.eventErrors({ ...f, description: 'x'.repeat(201) }).description).toBe('Description must be 1-200 characters.');
    expect(em.eventErrors({ ...f, startsAt: '' }).startsAt).toBe('Start must be a date and time.');
    expect(em.eventErrors({ ...f, startsAt: '2026-12-02T10:00', endsAt: '2026-12-01T10:00' }).endsAt).toBe('The end must be after the start.');
    expect(em.eventErrors({ ...f, startsAt: '2026-12-01T10:00', endsAt: '2027-01-01T10:01' }).endsAt).toBe('An event can last at most 31 days.');
    expect(em.eventErrors({ ...f, startsAt: '2026-12-01T10:00', endsAt: '2027-01-01T10:00' }).endsAt).toBeUndefined();
    expect(em.eventErrors({ ...f, multiplier: 4 }).multiplier).toBe('The multiplier must be 1.5, 2, 2.5 or 3.');
    const shop = { ...f, kind: 'limited_shop', itemIds: [] };
    expect(em.eventErrors(shop).items).toBe('Pick at least one limited item.');
    expect(em.eventErrors({ ...shop, itemIds: ['frame-aurora'] }).items).toBe('Only limited event items can be sold in a limited shop.');
    expect(em.eventErrors({ ...shop, itemIds: ['frame-diwali'] })).toEqual({});
    // the client messages are the server's
    expect(em.EVENT_ERRORS.multiplier).toBe(workerEvents.MULTIPLIER_ERROR);
    expect(em.EVENT_ERRORS.itemsEmpty).toBe(workerEvents.LIMITED_EMPTY_ERROR);
    expect(em.EVENT_ERRORS.itemsBad).toBe(workerEvents.LIMITED_ITEM_ERROR);
    expect(adminApi.MULTIPLIERS).toEqual([...workerEvents.MULTIPLIERS]);
  });
  it('request body keeps only the config of the kind; PATCH clears an empty description', () => {
    const f = { ...em.emptyEventForm(NOW), name: ' Boost ', multiplier: 2.5, itemIds: ['frame-diwali'] };
    const b = em.eventBody(f);
    expect(b.name).toBe('Boost');
    expect(b.config).toEqual({ multiplier: 2.5 });
    expect('description' in b).toBe(false);
    expect(em.eventBody(f, { patch: true }).description).toBe('');
    expect(em.eventBody({ ...f, kind: 'limited_shop', itemIds: ['frame-diwali', 'frame-diwali'] }).config).toEqual({ itemIds: ['frame-diwali'] });
    expect(em.eventToForm(EVENTS.events[1]).itemIds).toEqual(['frame-diwali', 'dice-diwali']);
  });
  it('server 400s are routed to their field', () => {
    expect(em.serverField('Name must be 1-60 characters.')).toBe('name');
    expect(em.serverField('An event can last at most 31 days.')).toBe('endsAt');
    expect(em.serverField('The end must be after the start.')).toBe('endsAt');
    expect(em.serverField('Start must be a date and time.')).toBe('startsAt');
    expect(em.serverField('The multiplier must be 1.5, 2, 2.5 or 3.')).toBe('multiplier');
    expect(em.serverField('Only limited event items can be sold in a limited shop.')).toBe('items');
    expect(em.serverField('Prize tiers must not overlap.')).toBe('tiers');
    expect(em.serverField('Too many requests, slow down.')).toBe('form');
  });
});

describe('prize tiers (client copy of worker parseTiers)', () => {
  const row = (fromRank, toRank, coins = '', itemId = '') => ({ fromRank: String(fromRank), toRank: String(toRank), coins: String(coins), itemId });
  it('accepts valid, non-overlapping tiers (gaps are fine)', () => {
    const r = em.tierErrors([row(1, 1, 6000, 'title-season-champ'), row(2, 3, 3000), row(11, 20, '', 'frame-season')]);
    expect(r.ok).toBe(true);
    expect(r.list).toBe('');
    expect(em.tierErrors([]).ok).toBe(true);
  });
  it('rank bounds', () => {
    for (const bad of [row(0, 1, 5), row(1, 1001, 5), row(5, 2, 5), row('', 3, 5), row('1.5', 3, 5)]) {
      expect(em.tierErrors([bad]).rows[0].ranks).toBe(worker.TIER_RANK_ERROR);
    }
    expect(em.tierErrors([row(1, 1000, 5)]).ok).toBe(true);
  });
  it('overlap marks both rows and the list', () => {
    const r = em.tierErrors([row(1, 3, 100), row(4, 10, 50), row(3, 5, 10)]);
    expect(r.ok).toBe(false);
    expect(r.list).toBe(worker.TIER_OVERLAP_ERROR);
    expect(r.rows[0].overlap).toBe(worker.TIER_OVERLAP_ERROR);
    expect(r.rows[2].overlap).toBe(worker.TIER_OVERLAP_ERROR);
  });
  it('coins, items and empty tiers', () => {
    expect(em.tierErrors([row(1, 1, 0)]).rows[0].coins).toBe(worker.TIER_COINS_ERROR);
    expect(em.tierErrors([row(1, 1, 100001)]).rows[0].coins).toBe(worker.TIER_COINS_ERROR);
    expect(em.tierErrors([row(1, 1, 100000)]).ok).toBe(true);
    expect(em.tierErrors([row(1, 1)]).rows[0].empty).toBe(worker.TIER_EMPTY_ERROR);
    expect(em.tierErrors([row(1, 1, '', 'nope')]).rows[0].item).toBe(worker.TIER_ITEM_ERROR);
    expect(em.tierErrors([row(1, 1, '', 'dice-ivory')]).rows[0].item).toBe(worker.TIER_ITEM_ERROR); // free item
    expect(em.tierErrors([row(1, 1, '', 'frame-aurora')]).ok).toBe(true); // any non-free cosmetic
  });
  it('at most 20 tiers', () => {
    const rows = Array.from({ length: 21 }, (_, i) => row(i + 1, i + 1, 10));
    expect(em.tierErrors(rows).list).toBe('At most 20 prize tiers.');
    expect(em.tierErrors(rows.slice(0, 20)).ok).toBe(true);
  });
  it('the client body passes the Worker validator unchanged', () => {
    const rows = [row(4, 10, 1000, 'frame-season'), row(1, 1, 6000, 'title-season-champ'), row(2, 3, 3000)];
    const body = em.tiersBody(rows);
    expect(body).toEqual([
      { fromRank: 1, toRank: 1, coins: 6000, itemId: 'title-season-champ' },
      { fromRank: 2, toRank: 3, coins: 3000 },
      { fromRank: 4, toRank: 10, coins: 1000, itemId: 'frame-season' },
    ]);
    expect(worker.parseTiers(body)).toEqual(body);
  });
  it('readable summary', () => {
    expect(model.tierSummary(TIERS)).toEqual(['1st: 6,000 coins + Season Champion title', '2nd–3rd: 3,000 coins', '4th–10th: 1,000 coins + Season Laurel frame']);
    expect(model.ordinal(11)).toBe('11th');
    expect(model.ordinal(22)).toBe('22nd');
    expect(model.ordinal(103)).toBe('103rd');
    expect(em.nextTier([row(1, 1), row(2, 3)])).toEqual({ fromRank: '4', toRank: '4', coins: '', itemId: '' });
  });
  it('season items come first in the prize picker', () => {
    const groups = em.prizeItemGroups();
    expect(groups[0].items.map((c) => c.id)).toEqual(['title-season-champ', 'frame-season']);
    expect(groups.flatMap((g) => g.items).some((c) => c.id === 'dice-ivory')).toBe(false);
  });
});

describe('seasons', () => {
  it('admins: list with status, payout state, edit and new season', () => {
    const html = consoleAt('/admin/seasons', 'seasons', h(Seasons, { initial: SEASONS }));
    for (const s of ['Diwali Season', 'Winter Season', 'Monsoon Season']) expect(html).toContain(s);
    expect(html).toContain('Awaiting payout');
    expect(html).toContain('>Paid<');
    expect(html).toContain('New season');
    expect(html).toContain('Edit Diwali Season');
    expect(html).not.toContain('Edit Monsoon Season'); // paid: never edited
    expect(html).toContain('1st: 6,000 coins + Season Champion title');
    expect(html).toContain('/admin/seasons/s1');
    expect(html).toContain('waiting for the payout');
  });
  it('moderators: read only', () => {
    const html = consoleAt('/admin/seasons', 'seasons', h(Seasons, { initial: SEASONS }), asMod);
    expect(html).toContain('Diwali Season');
    expect(html).toContain('Read only');
    expect(html).not.toContain('New season');
    expect(html).not.toContain('Edit Diwali');
  });
  it('the form renders the tier editor with rows, add / remove and the summary', () => {
    const html = renderToString(h(MemoryRouter, null, h(SeasonForm, { push: () => {}, now: NOW, onSaved() {}, onCancel() {} })));
    expect(html).toContain('Prize tiers');
    expect(html).toContain('Add tier');
    expect(html).toContain('Remove tier 1');
    expect(html).toContain('1st: 6,000 coins + Season Champion title');
    expect(html).toContain('4th–10th: 1,000 coins + Season Laurel frame');
    const edit = renderToString(h(MemoryRouter, null, h(SeasonForm, { editing: SEASONS.seasons[0], push: () => {}, now: NOW, onSaved() {}, onCancel() {} })));
    expect(edit).toContain('value="Diwali Season"');
    expect(edit).toContain('Save changes');
  });
  it('season form errors', () => {
    const f = { ...em.emptySeasonForm(NOW), name: 'S1' };
    expect(em.seasonErrors(f)).toEqual({});
    expect(em.seasonErrors({ ...f, name: '' }).name).toBe('Name must be 1-60 characters.');
    expect(em.seasonErrors({ ...f, endsAt: f.startsAt }).endsAt).toBe('The end must be after the start.');
    expect(worker.parseTiers(em.seasonBody(f).prizeTiers)).toHaveLength(3);
  });
});

describe('season detail and the payout gate', () => {
  const route = 'seasons/:id';
  const path = '/admin/seasons/s1';
  const payBtn = (html) => (html.match(/<button[^>]*>(?:(?!<\/button>).)*Pay out<\/button>/s) || [''])[0];

  it('renders standings, the payout preview and tier summary', () => {
    const html = consoleAt(path, route, h(SeasonDetail, { initial: STANDINGS() }));
    expect(html).toContain('Diwali Season');
    expect(html).toContain('Live standings');
    expect(html).toContain('Payout preview');
    expect(html).toContain('Late Larry');
    expect(html).toContain(`/admin/users/${RIO}`);
    expect(html).toContain('6,000 coins + Season Champion title');
    expect(html).toContain('9,000'); // total prize coins
    expect(html).toContain('2nd–3rd: 3,000 coins');
  });
  it('ended and unpaid: admins can press Pay out', () => {
    const btn = payBtn(consoleAt(path, route, h(SeasonDetail, { initial: STANDINGS() })));
    expect(btn).toContain('Pay out');
    expect(btn).not.toContain('disabled');
  });
  it('still running, already paid, or a moderator: locked with the reason', () => {
    const running = consoleAt(path, route, h(SeasonDetail, { initial: STANDINGS({ endsAt: iso(48), status: 'active' }) }));
    expect(payBtn(running)).toContain('disabled');
    expect(running).toContain('Opens when the season ends');
    const paid = consoleAt(path, route, h(SeasonDetail, { initial: STANDINGS({ paidAt: iso(-1), status: 'paid' }) }));
    expect(payBtn(paid)).toContain('disabled');
    expect(paid).toContain('Paid out');
    expect(paid).toContain('Final standings');
    const mod = consoleAt(path, route, h(SeasonDetail, { initial: STANDINGS() }), asMod);
    expect(payBtn(mod)).toContain('disabled');
    expect(mod).toContain('Only admins can pay out a season.');
  });
  it('payoutGate', () => {
    const s = season();
    expect(em.payoutGate({ season: s, adminWrite: true, now: NOW })).toEqual({ enabled: true, reason: '' });
    expect(em.payoutGate({ season: s, adminWrite: false, now: NOW }).enabled).toBe(false);
    expect(em.payoutGate({ season: { ...s, endsAt: iso(1) }, adminWrite: true, now: NOW }).enabled).toBe(false);
    expect(em.payoutGate({ season: { ...s, startsAt: iso(5), endsAt: iso(10) }, adminWrite: true, now: NOW }).reason).toMatch(/not started/);
    expect(em.payoutGate({ season: { ...s, paidAt: iso(-1) }, adminWrite: true, now: NOW }).enabled).toBe(false);
    expect(em.payoutGate({ season: null, adminWrite: true }).enabled).toBe(false);
  });
  it('the strong confirmation restates winners, coins and items (and asks to type PAY)', () => {
    const totals = em.payoutTotals(STANDINGS().prizesPreview);
    expect(totals).toEqual({ winners: 2, coins: 9000, items: [{ itemId: 'title-season-champ', name: 'Season Champion', kind: 'title', count: 1 }] });
    const copy = em.payoutConfirmCopy(season(), totals);
    expect(copy.title).toBe('Pay out Diwali Season?');
    expect(copy.body).toContain('2 winners get 9,000 coins and 1 × Season Champion title in total');
    expect(copy.body).toContain('cannot be undone');
    expect(em.payoutConfirmCopy(season(), em.payoutTotals([])).body).toContain('pays nothing');
    const view = renderToString(h(MemoryRouter, null, h(SeasonDetailView, { data: STANDINGS(), adminWrite: true, now: NOW, onPayout() {}, result: 2 })));
    expect(view).toContain('winners were');
    expect(view).toContain('type PAY');
  });
});

describe('achievements and referrals', () => {
  const STATS = { achievements: [{ id: 'first-win', name: 'First Win', unlocked: 250 }, { id: 'champion', name: 'Champion', unlocked: 3 }], members: 1000 };
  it('rates over members with a bar', () => {
    const rows = em.achievementRows(STATS);
    expect(rows).toHaveLength(11);
    expect(rows.find((r) => r.id === 'first-win')).toMatchObject({ unlocked: 250, rate: 25, rateLabel: '25%' });
    expect(rows.find((r) => r.id === 'champion').rateLabel).toBe('0.3%');
    expect(rows.find((r) => r.id === 'tycoon').rateLabel).toBe('0%');
    expect(em.rateText(0.04)).toBe('<0.1%');
    expect(em.achievementRows({ achievements: [], members: 0 })[0].rate).toBe(0);
    const html = consoleAt('/admin/achievements', 'achievements', h(Achievements, { initial: STATS }), asMod);
    expect(html).toContain('First Win');
    expect(html).toContain('300 coins + Champion title');
    expect(html).toContain('25%');
    expect(html).toContain('width:25%');
    expect(html).toContain('1,000');
  });
  it('referrals: totals, top referrers linked, recent with the rewarded badge', () => {
    const data = {
      top: [{ id: RIO, name: 'Rio', avatar: 2, invited: 7, rewarded: 5 }],
      recent: [
        { referrer: { id: RIO, name: 'Rio' }, invitee: { id: 'u5', name: 'Sana' }, joinedAt: iso(-3), rewarded: true },
        { referrer: { id: RIO, name: 'Rio' }, invitee: { id: 'u6', name: 'Zoya' }, joinedAt: iso(-1), rewarded: false },
      ],
      totals: { invited: 40, rewarded: 22, coinsPaid: 11000 },
    };
    const html = consoleAt('/admin/referrals', 'referrals', h(Referrals, { initial: data }), asMod);
    expect(html).toContain('11,000');
    expect(html).toContain('55%');
    expect(html).toContain(`/admin/users/${RIO}`);
    expect(html).toContain('/admin/users/u5');
    expect(html).toContain('Rewarded');
    expect(html).toContain('No match yet');
    expect(html).toContain('Sana');
  });
});

describe('user detail: achievements, referral and the grant action', () => {
  const route = 'users/:id';
  const path = `/admin/users/${RIO}`;
  const detail = {
    user: { id: RIO, name: 'Rio', handle: 'rio', avatar: 2, email: null, friendCode: 'HYD-R10X', isGuest: false, role: 'user', banned: false, bannedAt: null, banReason: null, coins: 100, xp: 10, level: 1, games: 3, wins: 1, dailyStreak: 1, bestWorth: 0, rentEarned: 0, equipped: {}, online: false, createdAt: iso(-100), lastSeen: iso(-1) },
    items: [],
    friends: { count: 2 },
    matches: [],
    actions: [],
    notifications: [],
    rooms: [],
    achievements: [{ id: 'first-win', name: 'First Win', unlockedAt: iso(-20) }],
    referral: {
      referrer: { id: 'r0000000-0000-4000-8000-000000000009', name: 'Kiran Rao' },
      invitedCount: 2,
      invited: [
        { id: 'u5', name: 'Sana', joinedAt: iso(-30), rewarded: true },
        { id: 'u6', name: 'Zoya', joinedAt: iso(-3), rewarded: false },
      ],
    },
  };
  it('admins see the sections and the grant form (unlocked ones left out)', () => {
    const html = consoleAt(path, route, h(UserDetail, { initial: detail }));
    expect(html).toContain('1 of 11 unlocked');
    expect(html).toContain('First Win');
    expect(html).toContain('Kiran Rao');
    expect(html).toContain('/admin/users/r0000000-0000-4000-8000-000000000009');
    expect(html).toContain('Sana');
    expect(html).toContain('Rewarded');
    expect(html).toContain('Grant achievement');
    expect(html).toContain('<option value="champion">');
    expect(html).not.toContain('<option value="first-win">');
  });
  it('moderators see the sections but not the grant', () => {
    const html = consoleAt(path, route, h(UserDetail, { initial: detail }), asMod);
    expect(html).toContain('First Win');
    expect(html).toContain('Kiran Rao');
    expect(html).not.toContain('Grant achievement');
    expect(actionRules({ can: adminValue(ME_MOD).can, selfId: MOD.id, target: detail.user }).grantAchievement).toBe(false);
    expect(actionRules({ can: adminValue(ME_ADMIN).can, selfId: ADMIN.id, target: detail.user }).grantAchievement).toBe(true);
  });
  it('an old answer without the new blocks still renders', () => {
    const { achievements, referral, ...old } = detail; // eslint-disable-line no-unused-vars
    const html = consoleAt(path, route, h(UserDetail, { initial: old }));
    expect(html).toContain('0 of 11 unlocked');
    expect(html).toContain('Has not invited anyone yet');
  });
  it('the grant confirmation restates the reward', () => {
    expect(em.grantAchievementCopy('champion', 'Rio')).toEqual({ title: 'Unlock Champion for Rio?', body: 'This also pays its reward (title + 300 coins).' });
    expect(em.grantAchievementCopy('first-win', 'Rio').body).toBe('This also pays its reward (200 coins).');
    expect(em.grantAchievementCopy('set-collector', 'Rio').body).toBe('This also pays its reward (title).');
    expect(em.grantableAchievements([{ id: 'first-win' }, 'champion']).map((a) => a.id)).not.toContain('champion');
  });
});

describe('audit log: the new actions', () => {
  it('appear in the action filter with readable labels', () => {
    for (const a of ['event.create', 'event.update', 'event.delete', 'season.create', 'season.update', 'season.payout', 'achievement.grant']) {
      expect(adminApi.AUDIT_ACTIONS).toContain(a);
      expect(model.ACTION_LABEL[a]).toBeTruthy();
    }
    const html = consoleAt('/admin/audit', 'audit', h(Audit, { initial: { actions: [], total: 0, page: 1, pageSize: 50 } }));
    expect(html).toContain('value="season.payout"');
    expect(html).toContain('Season payout');
    expect(html).toContain('Achievement');
  });
  it('match the worker list', async () => {
    const { AUDIT_ACTIONS } = await import('../../../worker/admin.js');
    expect([...adminApi.AUDIT_ACTIONS].sort()).toEqual([...AUDIT_ACTIONS].sort());
  });
  it('details read as sentences, not JSON', () => {
    const v = (entry) => model.detailParts(entry).map((p) => `${p.k}: ${p.v}`);
    const ev = { name: 'Double coins', kind: 'coin_boost', startsAt: '2026-11-21T10:00:00Z', endsAt: '2026-11-23T10:00:00Z', active: true, config: { multiplier: 2 } };
    expect(v({ action: 'event.create', details: { id: 'e1', ...ev } })).toEqual(expect.arrayContaining(['Event: Double coins', 'Effect: ×2 coins']));
    const upd = v({ action: 'event.update', details: { id: 'e1', changed: ['config', 'name'], before: ev, after: { ...ev, name: 'Triple coins', config: { multiplier: 3 } } } });
    expect(upd).toEqual(['Event: Triple coins', 'Effect: ×2 coins → ×3 coins', 'Name: Double coins → Triple coins']);
    expect(upd.join(' ')).not.toContain('[object');
    expect(v({ action: 'event.delete', details: { id: 'e2', ...ev, kind: 'limited_shop', config: { itemIds: ['frame-diwali'] } } })).toContain('Effect: Limited shop: Diwali Diya');
    expect(v({ action: 'season.create', details: { id: 's1', name: 'Diwali Season', startsAt: ev.startsAt, endsAt: ev.endsAt, prizeTiers: [{ fromRank: 1, toRank: 1, coins: 6000, itemId: 'title-season-champ' }] } })).toContain(
      'Prizes: 1st: 6,000 coins + Season Champion title',
    );
    const su = v({ action: 'season.update', details: { id: 's1', changed: ['prizeTiers'], before: { name: 'S', prizeTiers: [] }, after: { name: 'S', prizeTiers: [{ fromRank: 1, toRank: 3, coins: 50 }] } } });
    expect(su).toEqual(['Season: S', 'Prizes: none → 1st–3rd: 50 coins']);
    expect(v({ action: 'season.payout', details: { id: 's1', name: 'Diwali Season', paid: 12, ranked: 340, prizeTiers: [] } })).toEqual(['Season: Diwali Season', 'Winners paid: 12', 'Ranked: 340', 'Prizes: none']);
    const g = model.detailParts({ action: 'achievement.grant', details: { reason: 'Lost progress', achievementId: 'champion', achievementName: 'Champion', coins: 300, itemId: 'title-champion', itemName: 'Champion' } });
    expect(g.map((p) => p.v)).toEqual(['Champion', 'Champion', '300', 'Lost progress']);
    expect(g[0].k).toBe('Achievement');
    expect(model.actionTone('season.payout')).toBe('gold');
    expect(model.actionTone('event.delete')).toBe('bad');
  });
});
