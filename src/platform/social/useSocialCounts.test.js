// useSocialCounts: requests (friend store) + waiting invites (invites store), members only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';

const auth = vi.hoisted(() => ({ user: null }));
vi.mock('@/lib/auth.jsx', () => ({
  useAuth: () => ({ user: auth.user, subscribe: () => () => {} }),
}));
// renderToString reads the server snapshot of the invites store (always empty), so feed the hook a fixed list
const inv = vi.hoisted(() => ({ list: [] }));
vi.mock('@/components/online/InviteBanner.jsx', () => ({ useInvites: () => ({ invites: inv.list }) }));

const { NO_COUNTS, socialCounts, socialLabel, socialTarget, useSocialCounts, withSocialBadge } = await import('./useSocialCounts.js');
const { publishFriends, resetFriendStore } = await import('./friendStore.js');
const { normalizeFriends } = await import('@/components/online/friendsModel.js');

const person = (id) => ({ id, name: `P${id}`, avatar: 1 });

describe('socialCounts (pure)', () => {
  it('counts incoming requests and waiting invites for a member', () => {
    expect(socialCounts({ member: true, friends: { incoming: [person('a'), person('b')] }, invites: [{ key: 'x' }] })).toEqual({ requests: 2, invites: 1, total: 3 });
  });
  it('is all zeros for guests, signed-out visitors and missing data', () => {
    expect(socialCounts({ member: false, friends: { incoming: [person('a')] }, invites: [{}] })).toBe(NO_COUNTS);
    expect(socialCounts({ member: true })).toEqual({ requests: 0, invites: 0, total: 0 });
    expect(socialCounts({ member: true, friends: { incoming: null }, invites: undefined }).total).toBe(0);
    expect(socialCounts()).toBe(NO_COUNTS);
  });
  it('outgoing requests and friends do not count', () => {
    expect(socialCounts({ member: true, friends: { friends: [person('f')], outgoing: [person('o')], incoming: [] } }).total).toBe(0);
  });
});

describe('socialLabel / socialTarget / withSocialBadge', () => {
  it('words the count for screen readers', () => {
    expect(socialLabel({ requests: 3 })).toBe('3 pending requests');
    expect(socialLabel({ requests: 1 })).toBe('1 pending request');
    expect(socialLabel({ invites: 2 })).toBe('2 game invites waiting');
    expect(socialLabel({ requests: 1, invites: 1 })).toBe('1 pending request, 1 game invite waiting');
    expect(socialLabel({})).toBe('');
  });
  it('links to the Requests card, or the invites inbox when only invites wait', () => {
    expect(socialTarget({ requests: 2, invites: 1 })).toBe('/friends#requests');
    expect(socialTarget({ requests: 0, invites: 1 })).toBe('/friends#invites');
  });
  it('overrides only the Friends count and label, keeping the online dot', () => {
    const out = withSocialBadge({ friends: { count: 9, online: 4 }, other: 1 }, { requests: 2, invites: 0, total: 2 });
    expect(out.friends).toEqual({ count: 2, online: 4, label: '2 pending requests' });
    expect(out.other).toBe(1);
    expect(withSocialBadge(null, NO_COUNTS).friends.count).toBe(0);
  });
});

function Probe() {
  const c = useSocialCounts();
  return h('i', { 'data-c': JSON.stringify(c) });
}
const read = () => JSON.parse(/data-c="([^"]*)"/.exec(renderToString(h(Probe)))[1].replace(/&quot;/g, '"'));

describe('useSocialCounts (rendered)', () => {
  beforeEach(() => {
    resetFriendStore();
    inv.list = [];
  });

  it('members see requests + invites; guests and signed-out see zeros', () => {
    auth.user = { id: 'me', isGuest: false };
    inv.list = [{ key: 'AAA222:u1' }];
    publishFriends(normalizeFriends({ incoming: [person('a'), person('b')] }));
    expect(read()).toEqual({ requests: 2, invites: 1, total: 3 });

    auth.user = { id: 'me', isGuest: true };
    expect(read()).toEqual({ requests: 0, invites: 0, total: 0 });
    auth.user = null;
    expect(read()).toEqual({ requests: 0, invites: 0, total: 0 });
  });

  it('follows the store: accepting a request drops the count', () => {
    auth.user = { id: 'me', isGuest: false };
    publishFriends(normalizeFriends({ incoming: [person('a')] }));
    expect(read().requests).toBe(1);
    publishFriends(normalizeFriends({ friends: [person('a')], incoming: [] }));
    expect(read().total).toBe(0);
  });
});

