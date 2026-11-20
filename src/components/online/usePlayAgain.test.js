// The play-again flow without React: createRoom, then ONE batch invite, then the lobby's toast and "who we wait for".
import { describe, expect, it, vi } from 'vitest';
import { rematchFlow } from './usePlayAgain.js';

const SCHEMA = [
  { key: 'mode', type: 'segmented', options: [{ value: 'a' }, { value: 'b' }], default: 'a' },
  { key: 'rounds', type: 'stepper', min: 5, max: 50, step: 5, default: 20 },
];
const game = { id: 'g1', settings: SCHEMA };
const room = {
  code: 'OLD234',
  maxPlayers: 4,
  settings: { mode: 'b', rounds: 30, junk: 1 },
  players: [{ id: 'me', name: 'Me' }, { id: 'a', name: 'Asha' }, { id: 'b', name: 'Ravi' }, { id: 'c', name: 'Dev', left: true }],
};
const base = { room, gameId: 'g1', game, gameLabel: 'Nawabi Raj', meId: 'me', member: true, friends: { friends: [{ id: 'a' }] } };

const deps = (over = {}) => ({
  createRoom: vi.fn(async () => ({ code: 'NEW567', gameId: 'g1' })),
  sendInvites: vi.fn(async (code, ids) => ({ results: ids.map((userId) => ({ userId, ok: true, delivered: true })) })),
  copyText: vi.fn(async () => true),
  loadFriends: vi.fn(async () => ({ friends: [{ id: 'a' }, { id: 'b' }] })),
  ...over,
});

describe('rematchFlow', () => {
  it('creates a private table with the same game and only the schema settings, then invites the friends once', async () => {
    const d = deps();
    const res = await rematchFlow(base, d);
    expect(d.createRoom).toHaveBeenCalledWith({ gameId: 'g1', settings: { mode: 'b', rounds: 30 }, maxPlayers: 4, visibility: 'private' });
    expect(d.sendInvites).toHaveBeenCalledTimes(1);
    expect(d.sendInvites).toHaveBeenCalledWith('NEW567', ['a']);
    expect(res).toEqual({
      ok: true,
      code: 'NEW567',
      toast: { text: 'Invited 1 friend. Share the code with the others.', tone: 'good' }, // Ravi is not a friend; Dev left
      state: { rematchFrom: { code: 'OLD234', ids: ['a', 'b'] } },
    });
    expect(d.copyText).not.toHaveBeenCalled(); // somebody was invited: no link on the clipboard
  });

  it('a guest invites nobody (no friend call at all) and gets the link copied', async () => {
    const d = deps();
    const res = await rematchFlow({ ...base, member: false, friends: null }, d);
    expect(d.loadFriends).not.toHaveBeenCalled();
    expect(d.sendInvites).not.toHaveBeenCalled();
    expect(d.copyText).toHaveBeenCalledTimes(1);
    expect(d.copyText.mock.calls[0][0]).toContain('NEW567');
    expect(res.toast).toEqual({ text: 'New table ready. Invite link copied: send it to the group.', tone: 'good' });
  });

  it('loads the friend list when it has not arrived yet', async () => {
    const d = deps();
    const res = await rematchFlow({ ...base, friends: null }, d);
    expect(d.loadFriends).toHaveBeenCalledTimes(1);
    expect(d.sendInvites).toHaveBeenCalledWith('NEW567', ['a', 'b']);
    expect(res.toast.text).toBe('Invited 2 friends');
  });

  it('a friend list that never loads falls back to the link', async () => {
    const d = deps({ loadFriends: vi.fn(async () => { throw new Error('offline'); }) });
    const res = await rematchFlow({ ...base, friends: null }, d);
    expect(res.ok).toBe(true);
    expect(d.sendInvites).not.toHaveBeenCalled();
    expect(d.copyText).toHaveBeenCalled();
  });

  it('createRoom failing creates nothing, invites nobody and reports the error for a retry', async () => {
    const d = deps({ createRoom: vi.fn(async () => { throw new Error('Too many rooms'); }) });
    const res = await rematchFlow(base, d);
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe('string');
    expect(res.error).not.toBe('');
    expect(d.sendInvites).not.toHaveBeenCalled();
    expect(d.copyText).not.toHaveBeenCalled();
    expect((await rematchFlow(base, deps({ createRoom: vi.fn(async () => ({})) }))).ok).toBe(false); // no code back
  });

  it('the batch call failing still opens the new table, with the link and an honest toast', async () => {
    const d = deps({ sendInvites: vi.fn(async () => { throw new Error('429'); }) });
    const res = await rematchFlow(base, d);
    expect(res.ok).toBe(true);
    expect(res.code).toBe('NEW567');
    expect(d.copyText).toHaveBeenCalled();
    expect(res.toast.text).toMatch(/^Invites did not go out, so the link is copied/);
  });

  it('partial failures are named; the clipboard failing is not an error', async () => {
    const d = deps({
      sendInvites: vi.fn(async () => ({ results: [{ userId: 'a', ok: true, delivered: false }, { userId: 'b', ok: false, error: 'You can only invite your friends.' }] })),
      copyText: vi.fn(async () => { throw new Error('denied'); }),
    });
    const res = await rematchFlow({ ...base, friends: { friends: [{ id: 'a' }, { id: 'b' }] } }, d);
    expect(res.toast).toEqual({ text: 'Invited 1 of 2 friends. Ravi could not be invited.', tone: 'info' });
    expect(d.copyText).not.toHaveBeenCalled();
    const none = await rematchFlow({ ...base, friends: { friends: [] } }, d);
    expect(none.toast.text).toBe('New table ready. Share the code NEW567 with the group.');
  });

  it('works for a game without a settings schema (the server fills in the defaults)', async () => {
    const d = deps();
    await rematchFlow({ ...base, game: null }, d);
    expect(d.createRoom.mock.calls[0][0]).toEqual({ gameId: 'g1', settings: undefined, maxPlayers: 4, visibility: 'private' });
  });
});
