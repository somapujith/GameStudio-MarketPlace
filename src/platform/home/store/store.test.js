import { describe, expect, it } from 'vitest';
import { summarizeLive } from './liveModel.js';
import { categoryTiles } from './categoryModel.js';

const ok = (data) => ({ status: 'ok', data });

describe('summarizeLive', () => {
  it('knows nothing until the loads finish', () => {
    const s = summarizeLive({ gamesLive: { status: 'loading' }, open: { status: 'loading' }, mine: { status: 'off' }, friends: { status: 'idle' }, account: false });
    expect(s.tables).toBeNull();
    expect(s.friendsOnline).toBeNull();
    expect(s.resume).toBeNull();
  });

  it('sums open tables per game and counts friends online', () => {
    const s = summarizeLive({
      gamesLive: ok({ games: [{ id: 'a', openTables: 2 }, { id: 'b', openTables: 1 }, { id: 'c', openTables: 0 }] }),
      open: ok({ rooms: [] }),
      mine: ok({ rooms: [{ code: 'ABCD', status: 'lobby', gameId: 'a' }] }),
      friends: ok({ friends: [{ online: true }, { online: false }, { online: true }] }),
      account: true,
    });
    expect(s.tables).toBe(3);
    expect(s.perGame).toEqual({ a: 2, b: 1 });
    expect(s.friendsOnline).toBe(2);
    expect(s.resume.kind).toBe('lobby');
  });

  it('falls back to the open-room list and never reports friends for a guest', () => {
    const s = summarizeLive({
      gamesLive: { status: 'offline' },
      open: ok({ rooms: [{ code: 'X1', players: 1, maxPlayers: 4 }, { code: 'X2', players: 4, maxPlayers: 4 }] }),
      mine: { status: 'off' },
      friends: ok({ friends: [{ online: true }] }),
      account: false,
    });
    expect(s.tables).toBe(1);
    expect(s.friendsOnline).toBeNull();
  });
});

describe('categoryTiles', () => {
  const cats = [{ id: 'board', label: 'Board' }, { id: 'card', label: 'Card' }, { id: 'word', label: 'Word' }];
  const games = [
    { id: 'g1', category: 'board', status: 'live' },
    { id: 'g2', category: 'board', status: 'coming_soon' },
    { id: 'g3', category: 'word', status: 'coming_soon' },
  ];
  it('lists only categories that have games, with live and soon counts', () => {
    const t = categoryTiles(games, cats);
    expect(t.map((x) => x.id)).toEqual(['board', 'word']);
    expect(t[0]).toMatchObject({ live: 1, soon: 1 });
    expect(t[0].lead.id).toBe('g1');
    expect(t[1]).toMatchObject({ live: 0, soon: 1 });
  });
});
