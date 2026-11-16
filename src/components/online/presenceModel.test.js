// Rich presence in friendsModel: presenceOf, applyPresence with status/code/gameId, statusLine, invite answers.
import { describe, it, expect } from 'vitest';
import { normalizeFriends, applyPresence, presenceOf, statusLine, inviteEventResult } from './friendsModel.js';

const u = (id, name, extra = {}) => ({ id, name, avatar: 1, friendCode: `HYD-${id}`, online: false, level: 2, ...extra });

describe('presenceOf', () => {
  it('old servers (only `online`) map to online / offline', () => {
    expect(presenceOf({ online: true })).toEqual({ online: true, status: 'online' });
    expect(presenceOf({ online: false })).toEqual({ online: false, status: 'offline' });
    expect(presenceOf(undefined)).toEqual({ online: false, status: 'offline' });
  });
  it('keeps lobby (+code, gameId) and playing (+gameId, never a code)', () => {
    expect(presenceOf({ online: true, status: 'lobby', code: 'ABCD23', gameId: 'hyderabad-tycoon' })).toEqual({
      online: true,
      status: 'lobby',
      code: 'ABCD23',
      gameId: 'hyderabad-tycoon',
    });
    expect(presenceOf({ online: true, status: 'playing', code: 'ABCD23', gameId: 'g' })).toEqual({ online: true, status: 'playing', gameId: 'g' });
  });
  it('offline wins, unknown statuses and junk codes degrade to plain online', () => {
    expect(presenceOf({ online: false, status: 'lobby', code: 'ABCD23' })).toEqual({ online: false, status: 'offline' });
    expect(presenceOf({ online: true, status: 'weird' })).toEqual({ online: true, status: 'online' });
    expect(presenceOf({ online: true, status: 'lobby', code: '<b>' })).toEqual({ online: true, status: 'online' });
    expect(presenceOf({ online: true, status: 'lobby' })).toEqual({ online: true, status: 'online' });
  });
});

describe('normalizeFriends with presence', () => {
  it('carries status, code and gameId for friends and defaults old rows', () => {
    const d = normalizeFriends({
      friends: [u('1', 'Ann', { online: true, status: 'lobby', code: 'ABCD23', gameId: 'g' }), u('2', 'Bo', { online: true }), u('3', 'Cy')],
    });
    const by = Object.fromEntries(d.friends.map((f) => [f.id, f]));
    expect(by['1']).toMatchObject({ online: true, status: 'lobby', code: 'ABCD23', gameId: 'g' });
    expect(by['2']).toMatchObject({ status: 'online' });
    expect(by['2'].code).toBeUndefined();
    expect(by['3']).toMatchObject({ online: false, status: 'offline' });
  });
});

describe('applyPresence with status', () => {
  const base = () => normalizeFriends({ friends: [u('1', 'Ann', { online: true }), u('2', 'Bo')] });
  const find = (d, id) => d.friends.find((f) => f.id === id);
  it('old two-field pushes still work', () => {
    expect(find(applyPresence(base(), '2', true), '2')).toMatchObject({ online: true, status: 'online' });
  });
  it('a lobby push sets status, code and gameId; the next push replaces them', () => {
    const d1 = applyPresence(base(), '2', true, { status: 'lobby', code: 'ABCD23', gameId: 'g' });
    expect(find(d1, '2')).toMatchObject({ online: true, status: 'lobby', code: 'ABCD23', gameId: 'g' });
    const d2 = applyPresence(d1, '2', true, { status: 'playing', code: 'ABCD23', gameId: 'g' });
    expect(find(d2, '2')).toMatchObject({ status: 'playing', gameId: 'g' });
    expect(find(d2, '2').code).toBeUndefined();
    const d3 = applyPresence(d2, '2', true, { status: 'online' });
    expect(find(d3, '2')).toMatchObject({ status: 'online' });
    expect(find(d3, '2').gameId).toBeUndefined();
  });
  it('going offline clears the room, extras on an offline push are ignored', () => {
    const d1 = applyPresence(base(), '1', true, { status: 'lobby', code: 'ABCD23' });
    const d2 = applyPresence(d1, '1', false, { status: 'lobby', code: 'ABCD23' });
    expect(find(d2, '1')).toMatchObject({ online: false, status: 'offline' });
    expect(find(d2, '1').code).toBeUndefined();
  });
  it('returns the same object when nothing changed, and for strangers', () => {
    const d = base();
    expect(applyPresence(d, '1', true, { status: 'online' })).toBe(d);
    expect(applyPresence(d, 'zzz', true, { status: 'lobby', code: 'ABCD23' })).toBe(d);
  });
});

describe('statusLine', () => {
  const name = (id) => (id === 'hyderabad-tycoon' ? 'Kingpin' : id);
  it('words for every status', () => {
    expect(statusLine({ online: false }, name)).toEqual({ text: 'Offline', tone: 'off', code: null });
    expect(statusLine({ online: true }, name)).toEqual({ text: 'Online', tone: 'on', code: null });
    expect(statusLine({ online: true, status: 'lobby', code: 'ABCD23' }, name)).toEqual({ text: 'In a lobby', tone: 'lobby', code: 'ABCD23' });
    expect(statusLine({ online: true, status: 'playing', gameId: 'hyderabad-tycoon' }, name)).toEqual({ text: 'Playing Kingpin', tone: 'play', code: null });
    expect(statusLine({ online: true, status: 'playing' }, name).text).toBe('Playing');
  });
  it('a join code only exists for an open lobby', () => {
    expect(statusLine({ online: true, status: 'playing', code: 'ABCD23' }).code).toBeNull();
    expect(statusLine({ online: true, status: 'online', code: 'ABCD23' }).code).toBeNull();
  });
});

describe('inviteEventResult', () => {
  const by = { id: 'f1', name: 'Fay', avatar: 2 };
  it('maps joined / declined for the same room', () => {
    expect(inviteEventResult({ t: 'invite_joined', by, code: 'ABCD23' }, 'ABCD23')).toMatchObject({ id: 'f1', state: 'joined', text: 'Fay joined your table', tone: 'good' });
    expect(inviteEventResult({ t: 'invite_declined', by, code: 'ABCD23' }, 'ABCD23')).toMatchObject({ id: 'f1', state: 'declined', text: 'Fay declined your invite', tone: 'info' });
  });
  it('ignores other rooms, other types and junk', () => {
    expect(inviteEventResult({ t: 'invite_joined', by, code: 'ZZZZ99' }, 'ABCD23')).toBeNull();
    expect(inviteEventResult({ t: 'presence', by, code: 'ABCD23' }, 'ABCD23')).toBeNull();
    expect(inviteEventResult({ t: 'invite_joined', code: 'ABCD23' }, 'ABCD23')).toBeNull();
    expect(inviteEventResult(null, 'ABCD23')).toBeNull();
    expect(inviteEventResult({ t: 'invite_joined', by: { id: 'f1' }, code: 'ABCD23' }, 'ABCD23').text).toBe('Your friend joined your table');
  });
});
