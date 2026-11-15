// Resigning is a bankruptcy by choice: the bankrupt event says so, so the log can say "resigned".
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from './engine.js';

const players = [
  { id: 'a', name: 'Asha', avatar: 0, piece: 'auto' },
  { id: 'b', name: 'Ravi', avatar: 1, piece: 'chai' },
  { id: 'c', name: 'Meera', avatar: 2, piece: 'handi' },
];

describe('RESIGN', () => {
  it('emits a bankrupt event tagged reason "resign" and takes the player out', () => {
    const s = createGame({ players, seed: 7 });
    const r = applyAction(s, { type: 'RESIGN', playerId: 'b' });
    expect(r.error).toBeUndefined();
    expect(r.events).toContainEqual({ type: 'bankrupt', player: 'b', reason: 'resign' });
    expect(r.state.players.find((p) => p.id === 'b').bankrupt).toBe(true);
  });

  it('works out of turn, and the last player standing wins', () => {
    let s = createGame({ players: players.slice(0, 2), seed: 3 });
    const loser = s.players[1].id; // not the player on turn
    const r = applyAction(s, { type: 'RESIGN', playerId: loser });
    expect(r.state.phase).toBe('over');
    expect(r.state.winReason).toBe('last_standing');
    expect(r.state.winner).toBe(s.players[0].id);
  });
});

describe('resigned flag', () => {
  it('marks only a player who resigned (not one who went bankrupt) so the UI can say "Forfeit"', () => {
    const s = createGame({ players, seed: 11 });
    const r = applyAction(s, { type: 'RESIGN', playerId: 'c' });
    expect(r.state.players.find((p) => p.id === 'c')).toMatchObject({ bankrupt: true, resigned: true });
    expect(r.state.players.find((p) => p.id === 'a').resigned).toBeUndefined();
  });
});
