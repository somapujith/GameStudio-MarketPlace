import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMock = vi.hoisted(() => ({ getBlocks: vi.fn(), blockUser: vi.fn(), unblockUser: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ ...apiMock, api: { get: vi.fn() } }));
vi.mock('@/lib/auth.jsx', () => ({ useAuth: () => ({ user: null, subscribe: () => () => {} }) }));

import {
  filterMuted,
  getBlockState,
  isBlocked,
  isMutedFrom,
  blockPlayer,
  loadBlocks,
  normalizeBlocks,
  normalizePerson,
  resetBlockStore,
  unblockPlayer,
} from './blockStore.js';
import { publishFriends, getFriendState, resetFriendStore } from './friendStore.js';
import { normalizeFriends } from '@/components/online/friendsModel.js';

beforeEach(() => {
  apiMock.getBlocks.mockReset();
  apiMock.blockUser.mockReset();
  apiMock.unblockUser.mockReset();
  resetBlockStore();
  resetFriendStore();
});

describe('pure mute filter', () => {
  const ids = new Set(['b1', '7']);

  it('isMutedFrom compares ids as strings and never mutes a missing sender', () => {
    expect(isMutedFrom('b1', ids)).toBe(true);
    expect(isMutedFrom(7, ids)).toBe(true);
    expect(isMutedFrom('x', ids)).toBe(false);
    expect(isMutedFrom(null, ids)).toBe(false);
    expect(isMutedFrom(undefined, ids)).toBe(false);
    expect(isMutedFrom('', ids)).toBe(false);
    expect(isMutedFrom('b1', new Set())).toBe(false);
    expect(isMutedFrom('b1', null)).toBe(false);
  });

  it('filterMuted drops chat lines and voice lines of blocked players, keeps everyone else and system lines', () => {
    const chat = [
      { id: 1, from: 'a', text: 'hi' },
      { id: 2, from: 'b1', text: 'spam' },
      { id: 3, from: 'b1', text: '', voice: 'tiger' },
      { id: 4, from: 7, text: '', emote: 'gg' },
      { id: 5, text: 'system line' },
      { id: 6, from: 'c', text: 'ok' },
    ];
    expect(filterMuted(chat, ids).map((e) => e.id)).toEqual([1, 5, 6]);
    expect(chat).toHaveLength(6); // never mutates
  });

  it('returns the very same array when nothing is hidden (no memo churn) and survives junk', () => {
    const chat = [{ id: 1, from: 'a', text: 'hi' }];
    expect(filterMuted(chat, ids)).toBe(chat);
    expect(filterMuted(chat, new Set())).toBe(chat);
    expect(filterMuted(chat, undefined)).toBe(chat);
    expect(filterMuted(undefined, ids)).toBeUndefined();
    expect(filterMuted([null, { id: 2, from: 'b1' }], ids)).toEqual([null]);
  });
});

describe('normalizing server data', () => {
  it('normalizePerson keeps id/name/avatar and fills safe defaults', () => {
    expect(normalizePerson({ id: 5, name: 'Bo', avatar: 4, secret: 'x' })).toEqual({ id: '5', name: 'Bo', avatar: 4 });
    expect(normalizePerson({ id: 'u' })).toEqual({ id: 'u', name: 'Player', avatar: 0 });
    expect(normalizePerson(null)).toBeNull();
    expect(normalizePerson({ name: 'no id' })).toBeNull();
  });

  it('normalizeBlocks drops junk and duplicates', () => {
    const { list, ids } = normalizeBlocks({ blocked: [{ id: 'a', name: 'A', avatar: 1 }, { id: 'a', name: 'dup' }, null, { name: 'x' }, { id: 'b' }] });
    expect(list.map((p) => p.id)).toEqual(['a', 'b']);
    expect([...ids]).toEqual(['a', 'b']);
    expect(normalizeBlocks(null).list).toEqual([]);
    expect(normalizeBlocks({ blocked: 'nope' }).ids.size).toBe(0);
  });
});

describe('the store', () => {
  it('loads once (shared promise) and exposes a synchronous isBlocked for the socket handler', async () => {
    apiMock.getBlocks.mockResolvedValue({ blocked: [{ id: 'b1', name: 'Bo', avatar: 2 }] });
    expect(isBlocked('b1')).toBe(false);
    const p1 = loadBlocks();
    const p2 = loadBlocks();
    expect(p1).toBe(p2);
    await p1;
    expect(apiMock.getBlocks).toHaveBeenCalledTimes(1);
    expect(getBlockState().status).toBe('ready');
    expect(isBlocked('b1')).toBe(true);
    expect(isBlocked('zz')).toBe(false);
    await loadBlocks(); // cached
    expect(apiMock.getBlocks).toHaveBeenCalledTimes(1);
    await loadBlocks({ force: true });
    expect(apiMock.getBlocks).toHaveBeenCalledTimes(2);
  });

  it('a failed load mutes nothing and reports error; a later failure keeps the loaded list', async () => {
    apiMock.getBlocks.mockRejectedValueOnce(new Error('offline'));
    await loadBlocks();
    expect(getBlockState().status).toBe('error');
    expect(getBlockState().ids.size).toBe(0);
    apiMock.getBlocks.mockResolvedValueOnce({ blocked: [{ id: 'b1' }] });
    await loadBlocks({ force: true });
    apiMock.getBlocks.mockRejectedValueOnce(new Error('offline'));
    await loadBlocks({ force: true });
    expect(getBlockState().status).toBe('ready');
    expect(isBlocked('b1')).toBe(true);
  });

  it('blockPlayer mutes at once, confirms with the server and removes them from the friend list', async () => {
    resetFriendStore();
    publishFriends(normalizeFriends({ friends: [{ id: 'b1', name: 'Bo' }, { id: 'f2', name: 'Fay' }] }));
    let release;
    apiMock.blockUser.mockImplementation(() => new Promise((r) => (release = r)));
    const pending = blockPlayer({ id: 'b1', name: 'Bo', avatar: 2 });
    expect(isBlocked('b1')).toBe(true); // optimistic
    release({ ok: true, blocked: { id: 'b1', name: 'Bo', avatar: 2 } });
    await pending;
    expect(apiMock.blockUser).toHaveBeenCalledWith('b1');
    expect(getBlockState().list).toEqual([{ id: 'b1', name: 'Bo', avatar: 2 }]);
    expect(getFriendState().data.friends.map((f) => f.id)).toEqual(['f2']);
  });

  it('blockPlayer rolls back and rethrows when the server refuses', async () => {
    apiMock.blockUser.mockRejectedValue({ status: 500, message: 'nope' });
    await expect(blockPlayer({ id: 'b1', name: 'Bo' })).rejects.toMatchObject({ status: 500 });
    expect(isBlocked('b1')).toBe(false);
    expect(getBlockState().list).toEqual([]);
    await expect(blockPlayer(null)).rejects.toThrow();
  });

  it('blocking twice does not duplicate the entry', async () => {
    apiMock.blockUser.mockResolvedValue({ ok: true });
    await blockPlayer({ id: 'b1', name: 'Bo' });
    await blockPlayer({ id: 'b1', name: 'Bo' });
    expect(getBlockState().list).toHaveLength(1);
  });

  it('unblockPlayer unmutes at once, rolls back on error', async () => {
    apiMock.getBlocks.mockResolvedValue({ blocked: [{ id: 'b1', name: 'Bo' }, { id: 'b2', name: 'Cy' }] });
    await loadBlocks();
    apiMock.unblockUser.mockResolvedValueOnce({ ok: true });
    await unblockPlayer('b1');
    expect(apiMock.unblockUser).toHaveBeenCalledWith('b1');
    expect(isBlocked('b1')).toBe(false);
    expect(getBlockState().list.map((p) => p.id)).toEqual(['b2']);

    apiMock.unblockUser.mockRejectedValueOnce(new Error('down'));
    await expect(unblockPlayer('b2')).rejects.toThrow('down');
    expect(isBlocked('b2')).toBe(true);
    expect(getBlockState().list.map((p) => p.id)).toEqual(['b2']);
  });
});
