import { describe, expect, it } from 'vitest';
import { cleanPieces, customRulesSpoken, joinedLabel, joinedPercent, pieceChoices, pieceOf, rosterChanges, seatColor, seatLimits, startState, waitingText } from './lobbyModel.js';

describe('startState', () => {
  const base = { maxPlayers: 4, minToStart: 2 };
  it('cannot start alone and says how many are missing', () => {
    const s = startState({ ...base, players: 1, joined: 1 });
    expect(s).toMatchObject({ enough: false, full: false, emptySeats: 3, need: 1, label: 'Waiting for 1 more player' });
    expect(s.help).toContain('at least 2 players');
    expect(startState({ maxPlayers: 6, minToStart: 3, players: 1, joined: 1 }).label).toBe('Waiting for 2 more players');
  });
  it('starts with whoever is there once the minimum is met', () => {
    const s = startState({ ...base, players: 3, joined: 3 });
    expect(s).toMatchObject({ enough: true, full: false, emptySeats: 1, need: 0, label: 'Start with 3 players' });
    expect(s.help).toBe('1 seat is still open. Start now, or wait for more.');
    expect(startState({ ...base, players: 2, joined: 2 }).help).toBe('2 seats are still open. Start now, or wait for more.');
  });
  it('celebrates a full table', () => {
    expect(startState({ ...base, players: 4, joined: 4 })).toMatchObject({ enough: true, full: true, emptySeats: 0, label: 'Table full - start!', help: 'Everyone is here.' });
  });
  it('says Starting... once Start was pressed, Reconnecting... while the socket is down', () => {
    expect(startState({ ...base, players: 4, joined: 4, starting: true }).label).toBe('Starting...');
    const s = startState({ ...base, players: 4, joined: 4, open: false });
    expect(s.label).toBe('Reconnecting...');
    expect(s.help).toMatch(/getting you back/);
  });
  it('a game that needs 3 players waits for 3', () => {
    expect(startState({ maxPlayers: 6, minToStart: 3, players: 2, joined: 2 }).enough).toBe(false);
  });
});

describe('waitingText', () => {
  it('names the missing players first, then the host', () => {
    expect(waitingText({ need: 1, hostName: 'Ravi' })).toBe('Waiting for 1 more player...');
    expect(waitingText({ need: 0, hostName: 'Ravi' })).toBe('Waiting for Ravi to start...');
    expect(waitingText()).toBe('Waiting for the host to start...');
  });
});

describe('seat progress', () => {
  it('labels and sizes the bar', () => {
    expect(joinedLabel(2, 4)).toBe('2 of 4 joined');
    expect(joinedPercent(2, 4)).toBe(50);
    expect(joinedPercent(5, 4)).toBe(100);
    expect(joinedPercent(0, 0)).toBe(0);
  });
});

describe('pieces', () => {
  const PIECES = [
    { id: 'pearl', name: 'Pearl' },
    { id: 'auto', name: 'Auto-rickshaw' },
    { id: 'chai', name: 'Chai' },
  ];
  const players = [
    { id: 'me', name: 'Me', piece: 'pearl' },
    { id: 'b', name: 'Bela', piece: 'auto' },
    { id: 'c', name: 'Chandu', piece: null },
  ];

  it('cleans a manifest list and tolerates junk', () => {
    expect(cleanPieces(undefined)).toEqual([]);
    expect(cleanPieces([{ id: 'x' }, null, 'y', { id: 'x', name: 'dup' }, { name: 'no id' }])).toEqual([
      { id: 'x', name: 'x' },
      { id: 'y', name: 'y' },
    ]);
  });
  it('marks my piece and who took the others', () => {
    const { mine, choices } = pieceChoices(PIECES, players, 'me');
    expect(mine).toBe('pearl');
    expect(choices.map((c) => [c.id, c.mine, c.takenBy && c.takenBy.name])).toEqual([
      ['pearl', true, null],
      ['auto', false, 'Bela'],
      ['chai', false, null],
    ]);
  });
  it('shows an optimistic pick at once, and drops it when someone else already has that piece', () => {
    expect(pieceChoices(PIECES, players, 'me', 'chai').mine).toBe('chai');
    const after = pieceChoices(PIECES, players, 'me', 'chai').choices;
    expect(after.find((c) => c.id === 'pearl')).toMatchObject({ mine: false, takenBy: null }); // still mine on the server: not "taken"
    expect(pieceChoices(PIECES, players, 'me', 'auto').mine).toBe('pearl'); // rollback: Bela has it
    expect(pieceChoices(PIECES, players, 'me', 'nope').mine).toBe('pearl'); // unknown piece
  });
  it('no pieces in the manifest = nothing to pick', () => {
    expect(pieceChoices(undefined, players, 'me')).toEqual({ mine: null, choices: [] });
  });
  it('pieceOf finds a player piece by id', () => {
    expect(pieceOf(players[1], PIECES)).toEqual({ id: 'auto', name: 'Auto-rickshaw' });
    expect(pieceOf(players[2], PIECES)).toBeNull();
    expect(pieceOf({ piece: 'gone' }, PIECES)).toBeNull();
  });
});

describe('rosterChanges', () => {
  const a = { id: 'a', name: 'Anil' };
  const b = { id: 'b', name: 'Bela' };
  const me = { id: 'me', name: 'Me' };
  it('nobody "joins" on the first payload', () => {
    expect(rosterChanges(null, [a, b, me], 'me')).toEqual({ joined: [], left: [] });
  });
  it('reports arrivals and departures, never myself', () => {
    expect(rosterChanges([me, a], [me, a, b], 'me')).toEqual({ joined: [b], left: [] });
    expect(rosterChanges([me, a, b], [me, b], 'me')).toEqual({ joined: [], left: [a] });
    expect(rosterChanges([a], [a, me], 'me').joined).toEqual([]);
  });
});

describe('seatColor', () => {
  it('uses the game colours when it has them, the default ring otherwise', () => {
    expect(seatColor(null, 0)).toBe('#ff4d6d');
    expect(seatColor(null, 6)).toBe('#ff4d6d');
    expect(seatColor({ playerColors: ['#111', '#222'] }, 3)).toBe('#222');
  });
});

describe('customRulesSpoken', () => {
  it('says how many rules the host changed, in the singular too, and nothing for none', () => {
    expect(customRulesSpoken(1)).toBe('1 custom rule');
    expect(customRulesSpoken(4)).toBe('4 custom rules');
    expect(customRulesSpoken(0)).toBe('');
    expect(customRulesSpoken(-1)).toBe('');
    expect(customRulesSpoken(undefined)).toBe('');
  });
});

describe('seatLimits (the host seat stepper)', () => {
  it('lets the host go down to the players already seated, and up to the game maximum', () => {
    expect(seatLimits({ joined: 1, current: 4, min: 2, max: 6 })).toEqual({ low: 2, high: 6, canLess: true, canMore: true, adjustable: true });
    expect(seatLimits({ joined: 3, current: 3, min: 2, max: 6 })).toMatchObject({ low: 3, canLess: false, canMore: true });
    expect(seatLimits({ joined: 2, current: 6, min: 2, max: 6 })).toMatchObject({ canLess: true, canMore: false });
  });
  it('never goes below the game minimum, even with an empty room', () => {
    expect(seatLimits({ joined: 0, current: 2, min: 2, max: 6 })).toMatchObject({ low: 2, canLess: false });
  });
  it('is not adjustable when the game has a single table size', () => {
    expect(seatLimits({ joined: 1, current: 1, min: 1, max: 1 }).adjustable).toBe(false);
    expect(seatLimits({ joined: 2, current: 2, min: 2, max: 2 }).adjustable).toBe(false);
  });
  it('survives junk', () => {
    expect(() => seatLimits({})).not.toThrow();
    expect(() => seatLimits({ joined: NaN, current: undefined, min: undefined, max: undefined })).not.toThrow();
  });
});
