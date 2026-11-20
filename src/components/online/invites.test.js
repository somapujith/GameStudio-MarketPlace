// Invites inbox store (InviteBanner.jsx): stored invites (GET /api/invites) merged with realtime ones,
// dismiss goes to the server, and an unreachable API never throws.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';

const getInvites = vi.fn();
const dismissInvite = vi.fn();
vi.mock('@/lib/api.js', async (orig) => ({ ...(await orig()), getInvites: (...a) => getInvites(...a), dismissInvite: (...a) => dismissInvite(...a) }));
vi.mock('@/components/art/index.js', () => ({ Avatar: ({ preset }) => h('span', { 'data-avatar': preset }) }));

const mod = await import('./InviteBanner.jsx');
const { setInvitesUser, refreshInvites, addLiveInvite, dismissInviteEntry, subscribeInvites, useInvites, pendingSummary, quietPath } = mod;

const row = (id, code, fromId, extra = {}) => ({ id, code, gameId: 'hyderabad-tycoon', gameName: 'Nawabi Raj', from: { id: fromId, name: `P${fromId}`, avatar: 1 }, createdAt: new Date().toISOString(), ...extra });
let snap;
function Probe() {
  snap = useInvites();
  return null;
}

beforeEach(() => {
  getInvites.mockReset();
  dismissInvite.mockReset();
  dismissInvite.mockResolvedValue({ ok: true });
  setInvitesUser(null);
});

describe('invites store', () => {
  it('loads stored invites for the signed-in user and merges realtime ones (dedupe by code+from)', async () => {
    getInvites.mockResolvedValue({ invites: [row(1, 'AAA222', 'u1'), row(2, 'BBB333', 'u2')] });
    const seen = [];
    const off = subscribeInvites((s) => seen.push(s));
    setInvitesUser('me');
    await refreshInvites({ force: true });
    addLiveInvite({ t: 'invite', code: 'AAA222', from: { id: 'u1', name: 'P1' }, gameId: 'hyderabad-tycoon', gameName: 'Nawabi Raj' });
    addLiveInvite({ t: 'invite', code: 'CCC444', from: { id: 'u3', name: 'P3' } });
    const s = seen[seen.length - 1];
    expect(s.status).toBe('ready');
    expect(s.invites.map((i) => i.key).sort()).toEqual(['AAA222:u1', 'BBB333:u2', 'CCC444:u3']);
    expect(s.invites.find((i) => i.key === 'AAA222:u1').id).toBe('1');
    off();
  });

  it('dismiss removes at once and tells the server (also for a live one that gets its id later)', async () => {
    getInvites.mockResolvedValue({ invites: [row(5, 'AAA222', 'u1')] });
    const seen = [];
    const off = subscribeInvites((s) => seen.push(s));
    setInvitesUser('me');
    await refreshInvites({ force: true });
    dismissInviteEntry(seen[seen.length - 1].invites[0]);
    expect(seen[seen.length - 1].invites).toEqual([]);
    expect(dismissInvite).toHaveBeenCalledWith('5');

    // live invite without id, dismissed, then the stored copy arrives: hidden + dismissed on the server
    addLiveInvite({ t: 'invite', code: 'ZZZ999', from: { id: 'u9', name: 'P9' } });
    const liveInv = seen[seen.length - 1].invites[0];
    dismissInviteEntry(liveInv);
    getInvites.mockResolvedValue({ invites: [row(77, 'ZZZ999', 'u9', { createdAt: new Date(Date.now() - 1000).toISOString() })] });
    await refreshInvites({ force: true });
    expect(seen[seen.length - 1].invites).toEqual([]);
    expect(dismissInvite).toHaveBeenCalledWith('77');
    off();
  });

  it('offline / missing endpoint never throw', async () => {
    const seen = [];
    const off = subscribeInvites((s) => seen.push(s));
    getInvites.mockRejectedValue(Object.assign(new Error('Offline'), { status: 0 }));
    setInvitesUser('me');
    await refreshInvites({ force: true });
    expect(seen[seen.length - 1].status).toBe('offline');
    getInvites.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    await refreshInvites({ force: true });
    expect(seen[seen.length - 1]).toMatchObject({ status: 'ready', invites: [] });
    getInvites.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    await refreshInvites({ force: true });
    expect(seen[seen.length - 1].status).toBe('error');
    off();
  });

  it('signed out: nothing is fetched and live messages are ignored', async () => {
    setInvitesUser(null);
    await refreshInvites({ force: true });
    addLiveInvite({ t: 'invite', code: 'AAA222', from: { id: 'u1' } });
    expect(getInvites).not.toHaveBeenCalled();
    expect(renderToString(h(Probe))).toBe('');
    expect(snap.invites).toEqual([]);
  });
});

describe('compact banner copy', () => {
  const now = Date.now();
  const inv = (code, name, minsAgo, gameName = 'Nawabi Raj') => ({ key: `${code}:${name}`, code, gameName, from: { name }, createdAt: now - minsAgo * 60000 });
  it('one invite: who, which game, Join goes through the join page', () => {
    const s = pendingSummary([inv('ABC234', 'Ravi', 12)], now);
    expect(s).toMatchObject({ count: 1, title: 'Ravi invited you to Nawabi Raj', actionLabel: 'Join', target: '/join/ABC234' });
    expect(s.body).toBe('12 min ago · Room ABC234');
  });
  it('several: a count and a link to the inbox', () => {
    const s = pendingSummary([inv('A', 'Ravi', 1), inv('B', 'Mira', 9)], now);
    expect(s).toMatchObject({ count: 2, title: '2 game invites waiting', actionLabel: 'View', target: '/friends#invites' });
    expect(s.body).toContain('Latest: Ravi');
    expect(pendingSummary([], now)).toBeNull();
  });
  it('stays out of games, lobbies and the inbox itself', () => {
    expect(quietPath('/play/hyderabad-tycoon/online/ABC234')).toBe(true);
    expect(quietPath('/friends')).toBe(true);
    expect(quietPath('/lobby/ABC234')).toBe(true);
    expect(quietPath('/join/ABC234')).toBe(true);
    expect(quietPath('/')).toBe(false);
    expect(quietPath('/games/hyderabad-tycoon')).toBe(false);
  });
});
