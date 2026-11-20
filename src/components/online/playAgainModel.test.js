import { describe, expect, it } from 'vitest';
import {
  INVITE_CAP,
  composeToast,
  friendIdSet,
  inviteOutcome,
  otherHumans,
  planRematch,
  planSummary,
  readRematchFrom,
  rematchFrom,
  rematchLinkText,
  rematchProgress,
  wantsLinkCopy,
} from './playAgainModel.js';

const P = (id, over = {}) => ({ id, name: `P${id}`, ...over });
const table = [P('me'), P('a'), P('b'), P('c'), P('d')];

describe('friendIdSet', () => {
  it('takes a Set, ids, people or the friend store data', () => {
    expect([...friendIdSet(new Set(['a', 2]))]).toEqual(['a', '2']);
    expect([...friendIdSet(['a', { id: 'b' }, null, '', { id: '' }])]).toEqual(['a', 'b']);
    expect([...friendIdSet({ friends: [{ id: 'x' }], incoming: [{ id: 'y' }] })]).toEqual(['x']);
    expect(friendIdSet(null).size).toBe(0);
  });
});

describe('planRematch: who to invite', () => {
  it('splits friends from the rest in table order and never counts me', () => {
    const plan = planRematch({ players: table, meId: 'me', friends: ['a', 'c'] });
    expect(plan.friends.map((p) => p.id)).toEqual(['a', 'c']);
    expect(plan.others.map((p) => p.id)).toEqual(['b', 'd']);
    expect(plan.expected.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(plan.total).toBe(4);
    expect(plan.left).toBe(0);
  });

  it('players who already left are neither invited nor expected', () => {
    const plan = planRematch({ players: [P('me'), P('a', { left: true }), P('b')], meId: 'me', friends: ['a', 'b'] });
    expect(plan.friends.map((p) => p.id)).toEqual(['b']);
    expect(plan.others).toEqual([]);
    expect(plan.left).toBe(1);
    expect(plan.total).toBe(1);
  });

  it('guests and strangers need the link, even when an id happens to be in the list', () => {
    const plan = planRematch({ players: [P('me'), P('g', { guest: true }), P('s')], meId: 'me', friends: ['g'] });
    expect(plan.friends).toEqual([]);
    expect(plan.others.map((p) => p.id)).toEqual(['g', 's']);
  });

  it('a guest viewer has no friends: everyone is "others"', () => {
    const plan = planRematch({ players: table, meId: 'me', friends: null });
    expect(plan.friends).toEqual([]);
    expect(plan.others).toHaveLength(4);
  });

  it('caps the friends at 7 (the batch limit); the overflow moves to the link list', () => {
    const many = [P('me'), ...Array.from({ length: 9 }, (_, i) => P(`f${i}`))];
    const plan = planRematch({ players: many, meId: 'me', friends: many.map((p) => p.id) });
    expect(INVITE_CAP).toBe(7);
    expect(plan.friends).toHaveLength(7);
    expect(plan.others.map((p) => p.id)).toEqual(['f7', 'f8']);
    expect(planRematch({ players: many, meId: 'me', friends: many.map((p) => p.id), cap: 2 }).friends).toHaveLength(2);
  });

  it('ids are compared as strings, duplicates and junk are dropped, a missing name gets a placeholder', () => {
    const plan = planRematch({ players: [P(1), { id: 2, name: '  ' }, P(2), null, {}, { id: '' }], meId: '1', friends: [2] });
    expect(plan.friends).toEqual([{ id: '2', name: 'A player' }]);
    expect(plan.total).toBe(1);
  });

  it('copes with no input at all', () => {
    expect(planRematch()).toMatchObject({ friends: [], others: [], expected: [], total: 0 });
  });
});

describe('inviteOutcome + composeToast', () => {
  const plan = planRematch({ players: table, meId: 'me', friends: ['a', 'b', 'c'] }); // friends a b c, other d
  const allOk = ['a', 'b', 'c'].map((userId) => ({ userId, ok: true, delivered: true }));

  it('counts who was invited and who failed', () => {
    expect(inviteOutcome(plan, allOk)).toEqual({ invited: 3, failed: [] });
    const mixed = [allOk[0], { userId: 'b', ok: false, error: 'You can only invite your friends.' }];
    const o = inviteOutcome(plan, mixed);
    expect(o.invited).toBe(1);
    expect(o.failed.map((f) => [f.id, f.error])).toEqual([
      ['b', 'You can only invite your friends.'],
      ['c', 'Not invited'],
    ]);
    expect(inviteOutcome(plan, null)).toMatchObject({ invited: 0 });
  });

  it('"Invited 3 friends" when all went out and nobody else is expected', () => {
    const only = planRematch({ players: table.slice(0, 4), meId: 'me', friends: ['a', 'b', 'c'] });
    expect(composeToast({ plan: only, outcome: inviteOutcome(only, allOk) })).toEqual({ text: 'Invited 3 friends', tone: 'good' });
    const one = planRematch({ players: table.slice(0, 2), meId: 'me', friends: ['a'] });
    expect(composeToast({ plan: one, outcome: { invited: 1, failed: [] } }).text).toBe('Invited 1 friend');
  });

  it('mentions the people who still need the code', () => {
    expect(composeToast({ plan, outcome: inviteOutcome(plan, allOk) })).toEqual({ text: 'Invited 3 friends. Share the code with the others.', tone: 'good' });
  });

  it('partial failure names the ones that did not get it', () => {
    const only = planRematch({ players: table.slice(0, 4), meId: 'me', friends: ['a', 'b', 'c'] });
    const t = composeToast({ plan: only, outcome: inviteOutcome(only, allOk.slice(0, 2)) });
    expect(t.tone).toBe('info');
    expect(t.text).toBe('Invited 2 of 3 friends. Pc could not be invited.');
  });

  it('nobody invited: the link was copied, or the code is named', () => {
    const none = planRematch({ players: table, meId: 'me', friends: [] });
    const out = inviteOutcome(none, null);
    expect(wantsLinkCopy(none, out)).toBe(true);
    expect(composeToast({ plan: none, outcome: out, copied: true, code: 'ABC234' })).toEqual({ text: 'New table ready. Invite link copied: send it to the group.', tone: 'good' });
    expect(composeToast({ plan: none, outcome: out, copied: false, code: 'ABC234' }).text).toBe('New table ready. Share the code ABC234 with the group.');
  });

  it('every invite failed: the new table is still there, the link is the way in', () => {
    const out = inviteOutcome(plan, null);
    expect(wantsLinkCopy(plan, out)).toBe(true);
    expect(composeToast({ plan, outcome: out, copied: true, code: 'ABC234' }).text).toMatch(/^Invites did not go out, so the link is copied/);
    expect(composeToast({ plan, outcome: out, copied: false, code: 'ABC234' })).toEqual({ text: 'Invites did not go out. Share the code ABC234 with the group.', tone: 'bad' });
  });

  it('does not copy the link when somebody was invited, or when nobody is expected', () => {
    expect(wantsLinkCopy(plan, inviteOutcome(plan, allOk))).toBe(false);
    const alone = planRematch({ players: [P('me')], meId: 'me', friends: [] });
    expect(wantsLinkCopy(alone, inviteOutcome(alone, null))).toBe(false);
    expect(composeToast({ plan: alone, outcome: inviteOutcome(alone, null), code: 'X' }).text).toBe('New table ready. Invite someone from the panel.');
  });

  it('the link text carries the code and the game name', () => {
    const t = rematchLinkText('ABC234', 'Nawabi Raj');
    expect(t).toContain('ABC234');
    expect(t).toContain('Nawabi Raj');
  });
});

describe('planSummary', () => {
  it('says who gets what', () => {
    expect(planSummary(planRematch({ players: table, meId: 'me', friends: [] }))).toBe('Pa and 3 others are not friends yet: we will copy the invite link for you.');
    expect(planSummary(planRematch({ players: [P('me'), P('a')], meId: 'me', friends: ['a'] }))).toBe('We will invite Pa.');
    expect(planSummary(planRematch({ players: [P('me'), P('a'), P('b')], meId: 'me', friends: ['a'] }))).toBe('We will invite Pa. Pb is not a friend yet: you can send them the code.');
    expect(planSummary(planRematch({ players: [P('me')], meId: 'me', friends: [] }))).toBe('');
  });
});

describe('rematchFrom / readRematchFrom / rematchProgress', () => {
  const plan = planRematch({ players: table, meId: 'me', friends: ['a'] });

  it('round-trips through the router state', () => {
    const from = rematchFrom('OLD123', plan);
    expect(from).toEqual({ code: 'OLD123', ids: ['a', 'b', 'c', 'd'] });
    expect(readRematchFrom(JSON.parse(JSON.stringify(from)))).toEqual(from);
  });

  it('never trusts history state', () => {
    expect(readRematchFrom(null)).toBeNull();
    expect(readRematchFrom('x')).toBeNull();
    expect(readRematchFrom({ ids: 'a' })).toBeNull();
    expect(readRematchFrom({ ids: [] })).toBeNull();
    expect(readRematchFrom({ ids: [1, {}, 'a', 'a', ''] })).toEqual({ code: '', ids: ['a'] });
    expect(readRematchFrom({ code: 7, ids: ['a'] }).code).toBe('');
  });

  it('counts who is already in the new lobby', () => {
    const from = rematchFrom('OLD123', plan);
    expect(rematchProgress(from, [P('me')], 'me')).toEqual({ total: 4, here: 0, waiting: 4 });
    expect(rematchProgress(from, [P('me'), P('b'), P('x')], 'me')).toEqual({ total: 4, here: 1, waiting: 3 });
    expect(rematchProgress(from, table, 'me')).toEqual({ total: 4, here: 4, waiting: 0 });
    expect(rematchProgress(null, table, 'me')).toEqual({ total: 0, here: 0, waiting: 0 });
  });
});

describe('otherHumans (the post-game add-friend list)', () => {
  it('everybody but me, once, without leavers and guests', () => {
    const list = otherHumans([P('me'), P('a', { avatar: 3 }), P('a'), P('b', { left: true }), P('g', { guest: true }), P('c')], 'me');
    expect(list).toEqual([
      { id: 'a', name: 'Pa', avatar: 3 },
      { id: 'c', name: 'Pc', avatar: undefined },
    ]);
    expect(otherHumans(undefined, 'me')).toEqual([]);
  });
});
