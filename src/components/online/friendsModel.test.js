import { describe, it, expect } from 'vitest';
import {
  emptyFriends,
  normalizeFriends,
  sortFriends,
  applyPresence,
  addFriend,
  acceptLocal,
  removeIncoming,
  removeOutgoing,
  removeFriend,
  addIncoming,
  countOnline,
  groupFriends,
  inviteExpiryLabel,
  inviteExpiresInMs,
} from './friendsModel.js';

const u = (id, name, extra = {}) => ({ id, name, avatar: 1, friendCode: `HYD-${id}`, online: false, level: 2, ...extra });

describe('normalizeFriends', () => {
  it('tolerates junk and sorts friends (online first, then name)', () => {
    expect(normalizeFriends(undefined)).toEqual(emptyFriends());
    expect(normalizeFriends({ friends: 'x', incoming: null })).toEqual(emptyFriends());
    const d = normalizeFriends({
      friends: [u('3', 'zed'), u('1', 'Bob', { online: true }), u('2', 'amy'), null, { name: 'no id' }],
      incoming: [u('9', 'In')],
    });
    expect(d.friends.map((f) => f.name)).toEqual(['Bob', 'amy', 'zed']);
    expect(d.incoming).toHaveLength(1);
  });
  it('fills missing fields', () => {
    const d = normalizeFriends({ friends: [{ id: 'a' }] });
    expect(d.friends[0]).toMatchObject({ name: 'Player', avatar: 0, level: 1, online: false });
  });
});

describe('presence', () => {
  it('updates one friend and re-sorts; ignores strangers', () => {
    const d = normalizeFriends({ friends: [u('1', 'Amy'), u('2', 'Bob')] });
    const on = applyPresence(d, '2', true);
    expect(on.friends.map((f) => f.id)).toEqual(['2', '1']);
    expect(applyPresence(d, 'zzz', true)).toBe(d);
    expect(countOnline(on)).toBe(1);
  });
});

describe('accept / decline / remove', () => {
  const base = () => normalizeFriends({ friends: [u('1', 'Amy')], incoming: [u('2', 'Bob'), u('3', 'Cy')], outgoing: [u('4', 'Di')] });

  it('acceptLocal moves the request into friends and does not mutate', () => {
    const d = base();
    const n = acceptLocal(d, '2');
    expect(n.incoming.map((x) => x.id)).toEqual(['3']);
    expect(n.friends.map((x) => x.id).sort()).toEqual(['1', '2']);
    expect(d.incoming).toHaveLength(2);
    expect(acceptLocal(d, 'nope')).toBe(d);
  });
  it('rollback is just restoring the snapshot', () => {
    const d = base();
    const n = acceptLocal(d, '2');
    expect(n).not.toBe(d);
    expect(d.friends.map((x) => x.id)).toEqual(['1']);
  });
  it('removes from each list', () => {
    const d = base();
    expect(removeIncoming(d, '2').incoming.map((x) => x.id)).toEqual(['3']);
    expect(removeOutgoing(d, '4').outgoing).toEqual([]);
    expect(removeFriend(d, '1').friends).toEqual([]);
  });
});

describe('live events', () => {
  it('friend_request adds once', () => {
    const d = emptyFriends();
    const a = addIncoming(d, { id: '5', name: 'Eve', avatar: 3 });
    expect(a.incoming).toHaveLength(1);
    expect(addIncoming(a, { id: '5', name: 'Eve' })).toBe(a);
    const withFriend = normalizeFriends({ friends: [u('6', 'Fay')] });
    expect(addIncoming(withFriend, { id: '6', name: 'Fay' })).toBe(withFriend);
    expect(addIncoming(d, null)).toBe(d);
  });
  it('friend_accepted adds a friend and clears the outgoing entry', () => {
    const d = normalizeFriends({ outgoing: [u('7', 'Gus')] });
    const n = addFriend(d, { id: '7', name: 'Gus', avatar: 4 });
    expect(n.friends.map((f) => f.id)).toEqual(['7']);
    expect(n.outgoing).toEqual([]);
    expect(addFriend(n, { id: '7', name: 'Gus' }).friends).toHaveLength(1);
  });
});

describe('sortFriends', () => {
  it('does not mutate its input', () => {
    const list = [u('2', 'b'), u('1', 'a', { online: true })];
    const sorted = sortFriends(list);
    expect(list[0].id).toBe('2');
    expect(sorted[0].id).toBe('1');
  });
});

// ---------------------------------------------------------------- cosmetics + invites inbox (H-SOCIAL)
import {
  cosmeticsOf,
  normalizeInvite,
  mergeInvites,
  inviteKey,
  dropInvite,
  relativeTime,
  inviteFeedback,
  withLeaving,
  INVITE_TTL_MS,
} from './friendsModel.js';

describe('equipped cosmetics on friend rows', () => {
  it('keeps known frame/title ids and drops junk', () => {
    const d = normalizeFriends({ friends: [{ id: 'a', equipped: { frame: 'frame-nizam', title: 'title-chai', dice: 'nope' } }, { id: 'b', equipped: 'x' }] });
    const a = d.friends.find((f) => f.id === 'a');
    expect(a.equipped).toEqual({ frame: 'frame-nizam', title: 'title-chai' });
    expect(d.friends.find((f) => f.id === 'b').equipped).toEqual({});
    expect(cosmeticsOf(a).frame.name).toBe('Nizam Gold');
    expect(cosmeticsOf(a).title.name).toBe('Chai Connoisseur');
    expect(cosmeticsOf(null)).toEqual({ frame: null, title: null });
  });
  it('a live friend_accepted without equipped keeps the known cosmetics', () => {
    const d = normalizeFriends({ friends: [{ id: '1', name: 'Amy', equipped: { frame: 'frame-lake' } }] });
    const n = addFriend(d, { id: '1', name: 'Amy', online: true });
    expect(n.friends[0].equipped).toEqual({ frame: 'frame-lake' });
  });
});

describe('invites inbox model', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const stored = (id, code, fromId, minsAgo, extra = {}) =>
    normalizeInvite({ id, code, gameId: 'hyderabad-tycoon', gameName: 'Kingpin', from: { id: fromId, name: `P${fromId}`, avatar: 2 }, createdAt: new Date(now - minsAgo * 60000).toISOString(), ...extra }, now);
  const live = (code, fromId) => normalizeInvite({ t: 'invite', code, gameId: 'hyderabad-tycoon', gameName: 'Kingpin', from: { id: fromId, name: `P${fromId}` } }, now);

  it('normalizes stored rows and realtime messages; rejects junk', () => {
    const s = stored(7, 'ABC234', 'u1', 5);
    expect(s).toMatchObject({ id: '7', code: 'ABC234', live: false, key: 'ABC234:u1', gameName: 'Kingpin' });
    expect(s.createdAt).toBe(now - 5 * 60000);
    const l = live('ABC234', 'u1');
    expect(l).toMatchObject({ id: null, live: true, createdAt: now, key: 'ABC234:u1' });
    expect(normalizeInvite(null)).toBeNull();
    expect(normalizeInvite({ code: '' })).toBeNull();
    expect(normalizeInvite({ code: 'X', from: null }, now).from).toEqual({ id: null, name: 'A friend', avatar: 0 });
    expect(normalizeInvite({ code: 'X', createdAt: 1763208000 }, now).createdAt).toBe(1763208000000); // seconds -> ms
    expect(inviteKey({ code: 'R', from: { id: 3 } })).toBe('R:3');
  });

  it('merges stored + live: dedupe by code+from, stored id wins, newest first, stale dropped', () => {
    const a = stored('1', 'AAA222', 'u1', 30);
    const b = stored('2', 'BBB333', 'u2', 3);
    const old = stored('3', 'CCC444', 'u3', INVITE_TTL_MS / 60000 + 1);
    const dupLive = live('AAA222', 'u1');
    const merged = mergeInvites([a, b, old], [dupLive], now);
    expect(merged.map((i) => i.key)).toEqual(['AAA222:u1', 'BBB333:u2']); // the re-invite is the newest
    expect(merged[0]).toMatchObject({ id: '1', live: false, createdAt: now });
    expect(mergeInvites([dupLive], [a], now)[0].id).toBe('1'); // order of the lists does not matter
    expect(mergeInvites(null, undefined, now)).toEqual([]);
    expect(dropInvite(merged, 'AAA222:u1').map((i) => i.key)).toEqual(['BBB333:u2']);
  });

  it('relative time reads naturally', () => {
    expect(relativeTime(now - 10000, now)).toBe('just now');
    expect(relativeTime(now - 4 * 60000, now)).toBe('4 min ago');
    expect(relativeTime(now - 2 * 3600000, now)).toBe('2 h ago');
    expect(relativeTime(now - 26 * 3600000, now)).toBe('yesterday');
    expect(relativeTime(now - 5 * 86400000, now)).toBe('5 d ago');
    expect(relativeTime(now + 5000, now)).toBe('just now');
    expect(relativeTime(null, now)).toBe('');
  });
});

describe('honest invite feedback', () => {
  it('delivered -> sent; not delivered -> saved for later', () => {
    expect(inviteFeedback({ ok: true, delivered: true }, 'Mira')).toEqual({ text: 'Invite sent to Mira', tone: 'good', state: 'sent' });
    expect(inviteFeedback({ ok: true, delivered: false }, 'Mira')).toEqual({ text: "Invite saved — they'll see it when they're back", tone: 'info', state: 'saved' });
    // an older server answers { ok: true } only: it did push it
    expect(inviteFeedback({ ok: true }, 'Mira').state).toBe('sent');
    expect(inviteFeedback(undefined).text).toBe('Invite sent to your friend');
  });
});

describe('withLeaving (list exit animation)', () => {
  const k = (x) => x.id;
  it('re-inserts leaving items near their old place', () => {
    const items = [{ id: 'a' }, { id: 'c' }];
    const gone = new Map([['b', { item: { id: 'b' }, index: 1 }]]);
    const out = withLeaving(items, gone, k);
    expect(out.map((x) => `${x.key}${x.leaving ? '!' : ''}`)).toEqual(['a', 'b!', 'c']);
  });
  it('ignores a leaving key that is back in the list; empty gone is a plain map', () => {
    const items = [{ id: 'a' }];
    expect(withLeaving(items, new Map([['a', { item: { id: 'a' }, index: 0 }]]), k)).toEqual([{ key: 'a', item: items[0], leaving: false }]);
    expect(withLeaving(items, new Map(), k)).toHaveLength(1);
    expect(withLeaving(undefined, null, k)).toEqual([]);
    expect(withLeaving([], new Map([['z', { item: { id: 'z' }, index: 9 }]]), k).map((x) => x.key)).toEqual(['z']);
  });
});

describe('groupFriends / invite expiry', () => {
  it('splits online and offline, keeping order', () => {
    const g = groupFriends([u('1', 'A', { online: true }), u('2', 'B'), u('3', 'C', { online: true })]);
    expect(g.online.map((f) => f.id)).toEqual(['1', '3']);
    expect(g.offline.map((f) => f.id)).toEqual(['2']);
    expect(groupFriends(undefined)).toEqual({ online: [], offline: [] });
  });
  it('words the time an invite has left', () => {
    const now = 1_700_000_000_000;
    expect(inviteExpiryLabel(now - 5 * 60000, now)).toBe('expires in 1 h 55 min');
    expect(inviteExpiryLabel(now - 60 * 60000, now)).toBe('expires in 1 h');
    expect(inviteExpiryLabel(now - 100 * 60000, now)).toBe('expires in 20 min');
    expect(inviteExpiryLabel(now - 2 * 3600000 + 20000, now)).toBe('expiring now');
    expect(inviteExpiryLabel('nope', now)).toBe('');
    expect(inviteExpiresInMs(now, now)).toBe(2 * 60 * 60 * 1000);
  });
});
