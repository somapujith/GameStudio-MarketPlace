import { describe, expect, it, vi } from 'vitest';

const room = { id: 'room-game', name: 'Room', status: 'live', loaders: { onlineGame() {} } };
const gated = { id: 'gated', name: 'Gated', status: 'live', solo: true, tutorial: { requiredForRooms: true }, loaders: { onlineGame() {}, soloGame() {} } };

vi.mock('@/games/registry.js', () => ({
  getGame: (id) => [room, gated].find((g) => g.id === id) || null,
  liveGames: () => [room, gated],
}));

const { inviteGames } = await import('./games.js');

describe('inviteGames and a required tutorial', () => {
  it('without a user nothing is filtered (the old behaviour)', () => {
    expect(inviteGames().map((g) => g.id)).toEqual(['room-game', 'gated']);
  });
  it('leaves out a game whose tutorial the player has not finished', () => {
    expect(inviteGames({ id: 'u1', gameStats: {} }).map((g) => g.id)).toEqual(['room-game']);
    expect(inviteGames(null).map((g) => g.id)).toEqual(['room-game']);
  });
  it('offers it once the server says the tutorial is done', () => {
    expect(inviteGames({ id: 'u1', gameStats: { gated: { tutorialDone: true } } }).map((g) => g.id)).toEqual(['room-game', 'gated']);
  });
});
