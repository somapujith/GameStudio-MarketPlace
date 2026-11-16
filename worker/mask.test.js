import { describe, it, expect } from 'vitest';
import { maskStateFor, hasSealedBids } from './mask.js';

const auctionState = () => ({
  phase: 'auction',
  round: 3,
  pending: { type: 'auction', tile: 5, minBid: 50, bids: { a: 300, b: 0, c: 120 } },
  players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
});

describe('sealed-bid masking', () => {
  it('shows a player only their own amount; keeps every key (so "has bid" stays visible)', () => {
    const s = auctionState();
    expect(maskStateFor(s, 'a').pending.bids).toEqual({ a: 300, b: 0, c: 0 });
    expect(maskStateFor(s, 'c').pending.bids).toEqual({ a: 0, b: 0, c: 120 });
    expect(Object.keys(maskStateFor(s, 'b').pending.bids).sort()).toEqual(['a', 'b', 'c']);
    // spectators / unknown users see no amounts at all
    expect(maskStateFor(s, 'zzz').pending.bids).toEqual({ a: 0, b: 0, c: 0 });
    expect(maskStateFor(s, undefined).pending.bids).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('never mutates the authoritative state and leaves everything else untouched', () => {
    const s = auctionState();
    const copy = structuredClone(s);
    const masked = maskStateFor(s, 'a');
    expect(s).toEqual(copy);
    expect(masked).not.toBe(s);
    expect(masked.pending).not.toBe(s.pending);
    expect({ ...masked, pending: null }).toEqual({ ...s, pending: null });
    expect(masked.pending).toMatchObject({ type: 'auction', tile: 5, minBid: 50 });
  });

  it('is a no-op (same object) when no auction is pending', () => {
    const buy = { phase: 'buy', pending: { type: 'buy', tile: 3, price: 700 } };
    expect(maskStateFor(buy, 'a')).toBe(buy);
    const none = { phase: 'roll', pending: null };
    expect(maskStateFor(none, 'a')).toBe(none);
    expect(maskStateFor(null, 'a')).toBeNull();
    expect(hasSealedBids(buy)).toBe(false);
    expect(hasSealedBids(auctionState())).toBe(true);
  });

  it('survives an auction with no bids yet and malformed bids', () => {
    expect(maskStateFor({ pending: { type: 'auction', bids: {} } }, 'a').pending.bids).toEqual({});
    const odd = { pending: { type: 'auction' } };
    expect(maskStateFor(odd, 'a')).toBe(odd);
  });
});

const powerState = (over = {}) => ({
  phase: 'roll',
  round: 4,
  rng: 12345,
  prng: 987654,
  deck: [1, 2, 3],
  powerPlayed: true,
  players: [
    { id: 'a', hand: [{ uid: 'u1', id: 'shield', exp: 6 }, { uid: 'u2', id: 'swap', exp: 5 }], shield: 5, doubleRent: 0 },
    { id: 'b', hand: [{ uid: 'u3', id: 'double', exp: 7 }], shield: 0, doubleRent: 6 },
    { id: 'c', hand: [] },
  ],
  ...over,
});

describe('Power Cards masking', () => {
  it('zeroes prng like rng for every viewer, including at game over', () => {
    for (const viewer of ['a', 'b', 'zzz', undefined]) {
      const m = maskStateFor(powerState(), viewer);
      expect(m.prng).toBe(0);
      expect(m.rng).toBe(0);
      expect(m.deck).toEqual([]);
    }
    expect(maskStateFor(powerState({ phase: 'over' }), 'a').prng).toBe(0);
  });

  it('hides rivals hands as same-length { hidden: true } stubs and keeps the owner hand', () => {
    const s = powerState();
    const forA = maskStateFor(s, 'a');
    expect(forA.players[0].hand).toEqual(s.players[0].hand);
    expect(forA.players[1].hand).toEqual([{ hidden: true }]);
    expect(forA.players[2].hand).toEqual([]);
    const forB = maskStateFor(s, 'b');
    expect(forB.players[0].hand).toEqual([{ hidden: true }, { hidden: true }]);
    expect(forB.players[1].hand).toEqual(s.players[1].hand);
    expect(JSON.stringify(forB.players[0].hand)).toBe('[{"hidden":true},{"hidden":true}]');
    expect(Object.keys(forB.players[0].hand[0])).toEqual(['hidden']);
  });

  it('shows a spectator or unknown viewer every hand hidden', () => {
    const s = powerState();
    for (const viewer of ['spectator', undefined, null]) {
      const m = maskStateFor(s, viewer);
      expect(m.players.map((p) => p.hand)).toEqual([[{ hidden: true }, { hidden: true }], [{ hidden: true }], []]);
      expect(JSON.stringify(m)).not.toMatch(/"uid"|u1|u3/);
    }
  });

  it('keeps shield, doubleRent, powerPlayed and the other fields public', () => {
    const m = maskStateFor(powerState(), 'b');
    expect(m.players[0].shield).toBe(5);
    expect(m.players[1].doubleRent).toBe(6);
    expect(m.powerPlayed).toBe(true);
    expect(m.round).toBe(4);
  });

  it('reveals every hand to everybody when the game is over', () => {
    const s = powerState({ phase: 'over' });
    for (const viewer of ['a', 'b', 'zzz', undefined]) {
      expect(maskStateFor(s, viewer).players.map((p) => p.hand)).toEqual(s.players.map((p) => p.hand));
    }
  });

  it('never mutates the authoritative state, and does not share hand arrays with the hidden copy', () => {
    const s = powerState();
    const copy = structuredClone(s);
    const m = maskStateFor(s, 'b');
    maskStateFor(s, 'a');
    maskStateFor(s, 'spectator');
    expect(s).toEqual(copy);
    expect(m.players).not.toBe(s.players);
    expect(m.players[1]).toBe(s.players[1]); // the owner row is the original object
    expect(s.players[0].hand[0]).toEqual({ uid: 'u1', id: 'shield', exp: 6 });
  });

  it('does not leak when the player list is masked together with a sealed auction', () => {
    const s = powerState({ phase: 'auction', pending: { type: 'auction', tile: 5, minBid: 50, bids: { a: 300, b: 10 } } });
    const m = maskStateFor(s, 'b');
    expect(m.pending.bids).toEqual({ a: 0, b: 10 });
    expect(m.players[0].hand).toEqual([{ hidden: true }, { hidden: true }]);
    expect(m.players[1].hand).toEqual(s.players[1].hand);
  });

  it('treats a malformed hand as empty for other viewers and leaves rows without a hand alone', () => {
    const s = { phase: 'roll', players: [{ id: 'a', hand: 'oops' }, { id: 'b' }, { id: 'c', hand: null }] };
    const m = maskStateFor(s, 'b');
    expect(m.players[0].hand).toEqual([]);
    expect(m.players[1]).toBe(s.players[1]);
    expect(m.players[2].hand).toEqual([]);
  });

  it('rule-off games (no hand, no prng) keep the same payload as before', () => {
    const off = { phase: 'roll', rng: 5, deck: [1], players: [{ id: 'a', cash: 10 }, { id: 'b', cash: 20 }] };
    const m = maskStateFor(off, 'a');
    expect(m).toEqual({ phase: 'roll', rng: 0, deck: [], players: [{ id: 'a', cash: 10 }, { id: 'b', cash: 20 }] });
    expect('prng' in m).toBe(false);
    expect(m.players).toBe(off.players); // no player copy
    expect(maskStateFor(off, 'a')).toBe(maskStateFor(off, 'b')); // one cached stripped copy per state
    const bare = { phase: 'roll', players: [{ id: 'a' }] };
    expect(maskStateFor(bare, 'a')).toBe(bare);
  });
});
