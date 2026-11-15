// Passing never starts an auction (docs/GAME_RULES.md sections 5 and 6). A player who landed on a free district and presses
// Pass (or cannot afford it) leaves it free and the turn goes on; the only ways to get a free district are a BUY, which opens
// the Snatch window, the Bazaar Auction corner (nobody can choose to land there) and the sealed bidding of two Snatch pressers.
// The guard rail: no way to acquire a district while skipping the Snatch window.
import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, nextBotMove, botSnatchAction, mulberry32, TILES, BOARD_SIZE, isBuyable, normalizeSettings,
} from './index.js';

const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const edit = (s, fn) => {
  const c = structuredClone(s);
  fn(c);
  return c;
};
const act = (s, action) => {
  const r = applyAction(s, action);
  if (r.error) throw new Error(`${action.type}: ${r.error}`);
  return r;
};
const game = (settings = {}, n = 3, seed = 7) =>
  createGame({ players: ids.slice(0, n).map((id) => ({ id, name: id.toUpperCase() })), settings: { debug: true, ...settings }, seed });
const roll = (s, who, d) => act(s, { type: 'ROLL', playerId: who, dice: [d] });

describe('a pass leaves the district free and the turn goes on', () => {
  it('SKIP_BUY: no auction, a `skip` event, phase manage on the same turn, the district unowned and buyable later', () => {
    let r = roll(game({ snatches: 1 }), 'a', 1); // Sultan Bazaar, free
    expect(r.state.phase).toBe('buy');
    r = act(r.state, { type: 'SKIP_BUY', playerId: 'a' });
    expect(r.events).toEqual([{ type: 'skip', player: 'a', tile: 1 }]);
    expect(r.state.phase).toBe('manage');
    expect(r.state.pending).toBeNull();
    expect(r.state.owners[1]).toBeNull();
    expect(r.state.auctionSeq || 0).toBe(0);
    expect(r.state.players[r.state.turn].id).toBe('a'); // still a's turn: End turn hands it on
    r = act(r.state, { type: 'END_TURN', playerId: 'a' });
    expect(r.state.phase).toBe('roll');
    expect(r.state.players[r.state.turn].id).toBe('b');
    // a later lander buys it as usual and the Snatch window opens for the others
    r = roll(r.state, 'b', 1);
    expect(r.state.pending).toMatchObject({ type: 'buy', tile: 1 });
    r = act(r.state, { type: 'BUY', playerId: 'b' });
    expect(r.state.phase).toBe('snatch');
    expect(r.state.pending).toMatchObject({ tile: 1, buyer: 'b', eligible: ['a', 'c'] });
  });

  it('a district you cannot afford is not offered and not auctioned: the step simply ends', () => {
    const poor = edit(game(), (c) => { c.players[0].cash = 50000; }); // Sultan Bazaar costs 60,000
    const r = roll(poor, 'a', 1);
    expect(r.state.phase).toBe('manage');
    expect(r.state.pending).toBeNull();
    expect(r.state.owners[1]).toBeNull();
    expect(r.events.map((e) => e.type)).not.toContain('auction_start');
    const next = act(r.state, { type: 'END_TURN', playerId: 'a' }).state;
    expect(next.players[next.turn].id).toBe('b');
  });

  it('after a six the extra roll survives a pass (and an unaffordable district); END_TURN stays refused until it is used', () => {
    let r = roll(game(), 'a', 6); // tile 6 is a free district
    expect(r.state.phase).toBe('buy');
    r = act(r.state, { type: 'SKIP_BUY', playerId: 'a' });
    expect(r.state).toMatchObject({ phase: 'manage', extraRoll: true });
    expect(applyAction(r.state, { type: 'END_TURN', playerId: 'a' }).error).toMatch(/six/);
    const again = roll(r.state, 'a', 2);
    expect(again.state.players[0].pos).toBe(8);

    const poor = edit(game(), (c) => { c.players[0].cash = 1000; });
    const u = roll(poor, 'a', 6);
    expect(u.state).toMatchObject({ phase: 'manage', extraRoll: true, pending: null });
    expect(u.events.map((e) => e.type)).not.toContain('auction_start');
    expect(applyAction(u.state, { type: 'ROLL', playerId: 'a', dice: [1] }).error).toBeUndefined();
  });

  it('Pass can be pressed only on your own pending decision', () => {
    const landed = roll(game(), 'a', 1);
    expect(applyAction(landed.state, { type: 'SKIP_BUY', playerId: 'b' }).error).toBe('Not your turn');
    const passed = act(landed.state, { type: 'SKIP_BUY', playerId: 'a' });
    expect(applyAction(passed.state, { type: 'SKIP_BUY', playerId: 'a' }).error).toBe('Nothing to skip right now');
  });
});

describe('the retired auctionOnDecline setting', () => {
  it('is dropped from the settings and from a stored cfg: true or false, a pass never opens an auction', () => {
    for (const stored of [true, false, 'yes', null]) {
      expect(normalizeSettings({ auctionOnDecline: stored })).not.toHaveProperty('auctionOnDecline');
      const g = game({ auctionOnDecline: stored });
      expect(g.cfg).not.toHaveProperty('auctionOnDecline');
    }
    // an in-flight game saved by the old build carries `cfg.auctionOnDecline: true`: still no auction
    const old = edit(game(), (c) => { c.cfg.auctionOnDecline = true; });
    const r = act(roll(old, 'a', 1).state, { type: 'SKIP_BUY', playerId: 'a' });
    expect(r.state.phase).toBe('manage');
    const poor = edit(old, (c) => { c.players[0].cash = 1000; });
    expect(roll(poor, 'a', 1).state.phase).toBe('manage');
  });
});

describe('Snatch cannot be avoided by passing', () => {
  it('a passed district is acquired only through BUY (Snatch window), the Bazaar corner or Snatch bidding, in many bot games', () => {
    const modes = ['standard', 'quick', 'classic'];
    let passes = 0;
    let buys = 0;
    let bazaarWins = 0;
    let windows = 0;
    for (let seed = 1; seed <= 36; seed++) {
      const n = 2 + (seed % 5);
      const mode = modes[seed % 3];
      const rnd = mulberry32(seed * 977 + 13);
      const passRate = [1, 0.7, 0.4][seed % 3]; // always passes, mostly passes, passes now and then
      let s = createGame({
        players: ids.slice(0, n).map((id, i) => ({ id, name: id, isBot: true, bot: { reserve: 100000 + 20000 * i, greed: 1 } })),
        settings: { mode }, seed,
      });
      let steps = 0;
      while (s.phase !== 'over' && steps++ < 9000) {
        let a;
        if (s.phase === 'snatch') {
          a = s.pending.eligible.filter((id) => !s.pending.claims.includes(id)).map((id) => botSnatchAction(s, id)).find(Boolean) || { type: 'SNATCH_CLOSE' };
        } else if (s.phase === 'auction' && rnd() < 0.2) a = { type: 'AUCTION_CLOSE' };
        else a = nextBotMove(s, rnd);
        if (a.type === 'BUY' && rnd() < passRate) a = { type: 'SKIP_BUY', playerId: a.playerId };
        const r = act(s, a);
        const types = r.events.map((e) => e.type);
        // 1. an auction only ever opens at the Bazaar corner or for Snatch bidding
        for (const e of r.events) {
          if (e.type === 'auction_start') expect(['bazaar', 'snatch'], `auction reason, seed ${seed}`).toContain(e.reason);
          if (e.type === 'auction_start' && e.reason === 'bazaar') expect(TILES[r.state.players[r.state.turn].pos].type).toBe('auction');
        }
        // 2. a pass is a plain step: manage on the same turn, no auction, the tile still free
        if (a.type === 'SKIP_BUY') {
          passes++;
          expect(types, `seed ${seed}`).toEqual(['skip']);
          expect(r.state.phase).toBe('manage');
          expect(r.state.turn).toBe(s.turn);
          expect(r.state.owners[s.pending.tile]).toBeFalsy();
        }
        // 3. every purchase by BUY opens the Snatch window when any other active player holds a button
        if (a.type === 'BUY') {
          buys++;
          const others = s.players.filter((p) => !p.bankrupt && p.id !== a.playerId && (p.snatches || 0) > 0);
          expect(types.includes('snatch_open'), `BUY with ${others.length} button holders, seed ${seed}`).toBe(others.length > 0);
          if (others.length) windows++;
        }
        // 4. a district changes owner from the bank only by buy / bazaar or snatch bidding / snatch / bankruptcy back to the bank
        for (const e of r.events) {
          if (e.type !== 'own' || e.owner === null) continue;
          const from = s.owners[e.tile];
          if (from !== null && from !== undefined && e.reason !== 'trade' && e.reason !== 'snatch' && e.reason !== 'auction') throw new Error(`${e.reason} took a district from ${from}`);
          if (e.reason === 'auction') {
            const end = r.events.find((x) => x.type === 'auction_end');
            expect(['bazaar', 'snatch']).toContain(end.reason);
            if (end.reason === 'bazaar') bazaarWins++;
          }
          if (e.reason === 'buy') expect(a.type).toBe('BUY');
        }
        s = r.state;
      }
      expect(s.phase, `seed ${seed} finished`).toBe('over');
    }
    expect(passes).toBeGreaterThan(300);
    expect(buys).toBeGreaterThan(50);
    expect(windows).toBeGreaterThan(30);
    expect(bazaarWins + 1).toBeGreaterThan(0);
  });

  it('only the Bazaar Auction corner and Snatch bidding can open an auction, and the corner is reached by dice or cards, never by choice', () => {
    // every card effect that moves a pawn names a district / START / transport / municipal tile, never the auction corner
    const corner = TILES.findIndex((t) => t.type === 'auction');
    expect(corner).toBe(32);
    const free = (s) => { let n = 0; for (let i = 0; i < BOARD_SIZE; i++) if (isBuyable(TILES[i]) && !s.owners[i]) n++; return n; };
    const base = edit(game({ snatches: 1 }), (c) => { c.players[0].pos = 31; });
    expect(free(base)).toBeGreaterThan(3);
    const r = roll(base, 'a', 1);
    expect(r.events.some((e) => e.type === 'auction_start' && e.reason === 'bazaar')).toBe(true);
    // the winner of a Bazaar auction pays at least half the price to the bank and no Snatch window follows (open contest already)
    let s = r.state;
    const tile = s.pending.tile;
    for (const id of ['a', 'b', 'c']) s = act(s, { type: 'BID', playerId: id, amount: id === 'b' ? s.pending.minBid + 10000 : 0 }).state;
    expect(s.owners[tile]).toBe('b');
    expect(s.phase).toBe('manage');
  });
});
