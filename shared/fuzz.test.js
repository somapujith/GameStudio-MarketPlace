// Randomised stress test: seats pick random LEGAL actions straight from getOptions(). Every action the options offer
// must be accepted by applyAction, nothing may throw, and the structural invariants must hold after each one.
// Money is conserved where the rules say so (trades, rent, auctions only move cash between players and the bank).
import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, getOptions, netWorth, standings, liquidationValue, mulberry32,
  BOARD_SIZE, MAX_LEVEL, TILES, GROUP_TILES, isBuyable, canUpgrade, nextBotMove, chooseBotAction, botSnatchAction,
} from './index.js';

/** The Hustle upgrade rule, restated independently of canUpgrade: the actor owns EVERY district of the tile's collection. */
const ownsWholeCollection = (s, playerId, tileId) => GROUP_TILES[TILES[tileId].group].every((t) => s.owners[t] === playerId);

const actorOf = (s) => {
  if (s.phase === 'debt') return s.debt.player;
  if (s.trade) return s.trade.to;
  if (s.phase === 'auction') return s.players.find((p) => !p.bankrupt && !(p.id in s.pending.bids)).id;
  return s.players[s.turn].id;
};

/** The next move while a Snatch window is open: a random eligible player presses, or the room's timer closes it. */
function snatchMove(s, rnd) {
  const open = s.pending.eligible.filter((id) => !s.pending.claims.includes(id) && !s.players.find((p) => p.id === id).bankrupt);
  if (open.length && rnd() < 0.55) return { type: 'SNATCH', playerId: open[Math.floor(rnd() * open.length)] };
  return { type: 'SNATCH_CLOSE' };
}

/** The same for bots: those whose policy says so press, then the timer closes the window. */
function botSnatchMove(s) {
  for (const id of s.pending.eligible) {
    if (s.pending.claims.includes(id)) continue;
    const press = botSnatchAction(s, id);
    if (press) return press;
  }
  return { type: 'SNATCH_CLOSE' };
}

function randomAction(s, rnd) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const active = s.players.filter((p) => !p.bankrupt);
  if (rnd() < 0.003 && active.length > 2) return { type: 'RESIGN', playerId: pick(active).id };
  if (s.phase === 'snatch') return snatchMove(s, rnd);
  if (s.phase === 'auction' && rnd() < 0.2) return { type: 'AUCTION_CLOSE' }; // the room's timer: the non-bidders pass
  const who = actorOf(s);
  const o = getOptions(s, who);
  const c = [];
  const add = (w, a) => c.push({ w, a: { ...a, playerId: who } });
  if (s.trade && s.trade.to === who) {
    add(1, { type: 'TRADE_ACCEPT' });
    add(1, { type: 'TRADE_REJECT' });
  } else if (s.trade && s.trade.from === who) {
    add(1, { type: 'TRADE_CANCEL' });
  } else if (s.phase === 'debt') {
    if (o.payDebt) add(8, { type: 'PAY_DEBT' });
    for (const m of o.mortgage) add(2, { type: 'MORTGAGE', tile: m.tile });
    for (const m of o.sellBuilding) add(2, { type: 'SELL_BUILDING', tile: m.tile });
    if (!c.length) add(1, { type: 'RESIGN' });
  } else if (s.phase === 'auction') {
    add(2, { type: 'BID', amount: 0 });
    add(3, { type: 'BID', amount: Math.min(o.bid.max, o.bid.min + 1000 * Math.floor(rnd() * 200)) });
  } else {
    if (o.roll) add(10, { type: 'ROLL' });
    if (o.endTurn) add(6, { type: 'END_TURN' });
    if (o.buy) add(5, { type: 'BUY' });
    if (o.skipBuy) add(2, { type: 'SKIP_BUY' });
    if (o.ride) add(3, { type: 'RIDE' });
    if (o.payTraffic) add(3, { type: 'PAY_TRAFFIC' });
    if (o.useChai) add(3, { type: 'USE_CHAI' });
    for (const u of o.upgrade) add(2, { type: 'UPGRADE', tile: u.tile });
    for (const m of o.mortgage) add(1, { type: 'MORTGAGE', tile: m.tile });
    for (const m of o.unmortgage) add(1, { type: 'UNMORTGAGE', tile: m.tile });
    for (const m of o.sellBuilding) add(1, { type: 'SELL_BUILDING', tile: m.tile });
    if (o.trade.canOffer && rnd() < 0.3) {
      const me = s.players.find((p) => p.id === who);
      const to = pick(active.filter((p) => p.id !== who));
      const tilesOf = (pl) => s.owners.map((ow, i) => (ow === pl.id ? i : -1)).filter((i) => i >= 0);
      const some = (arr) => arr.filter(() => rnd() < 0.4).slice(0, 2);
      const give = { cash: Math.floor(rnd() * Math.min(me.cash, 150000)), tiles: some(tilesOf(me)) };
      const get = { cash: Math.floor(rnd() * Math.min(to.cash, 150000)), tiles: some(tilesOf(to)) };
      if (give.cash + get.cash + give.tiles.length + get.tiles.length > 0) add(3, { type: 'TRADE_OFFER', to: to.id, give, get });
    }
  }
  let t = rnd() * c.reduce((x, e) => x + e.w, 0);
  for (const e of c) {
    t -= e.w;
    if (t <= 0) return e.a;
  }
  return c.at(-1).a;
}

function invariants(s) {
  const ids = new Set(s.players.map((p) => p.id));
  expect(new Set(s.players.map((p) => p.piece)).size).toBe(s.players.length);
  for (const p of s.players) {
    expect(Number.isInteger(p.cash) && p.cash >= 0).toBe(true);
    expect(p.pos >= 0 && p.pos < BOARD_SIZE).toBe(true);
    expect(p.chai >= 0 && p.chai <= s.cfg.chaiCap).toBe(true);
    // Snatch buttons: never negative, never more than the start plus what cards may add; none at all when Snatch is off
    expect(Number.isInteger(p.snatches) && p.snatches >= 0).toBe(true);
    expect(p.snatches).toBeLessThanOrEqual(s.cfg.snatches + s.cfg.snatchCardCap);
    expect(p.snatchCards >= 0 && p.snatchCards <= s.cfg.snatchCardCap).toBe(true);
    if (s.cfg.snatches === 0) expect(p.snatches).toBe(0);
    if (p.bankrupt) {
      expect(p.snatches).toBe(0);
      expect(p.cash).toBe(0);
      expect(s.owners.includes(p.id)).toBe(false);
      expect(p.stuck).toBe(false);
    }
    expect(Number.isFinite(netWorth(s, p.id))).toBe(true);
  }
  for (let i = 0; i < BOARD_SIZE; i++) {
    const o = s.owners[i];
    if (o !== null) {
      expect(ids.has(o)).toBe(true);
      expect(isBuyable(TILES[i])).toBe(true);
    }
    expect(s.levels[i] >= 0 && s.levels[i] <= MAX_LEVEL).toBe(true);
    if (s.levels[i] > 0) expect(o).not.toBeNull();
    if (s.mortgaged[i]) expect(o !== null && s.levels[i] === 0).toBe(true);
  }
  if (s.phase === 'debt') expect(s.debt.amount).toBeLessThanOrEqual(s.players.find((p) => p.id === s.debt.player).cash + liquidationValue(s, s.debt.player));
  else expect(s.debt).toBeNull();
  if (s.phase !== 'buy' && s.phase !== 'auction' && s.phase !== 'snatch') expect(s.pending).toBeNull();
  if (s.phase === 'snatch') {
    expect(s.pending.type).toBe('snatch');
    expect([s.pending.buyer, null]).toContain(s.owners[s.pending.tile]); // the buyer's (or the bank's, after a resignation)
    expect(s.pending.eligible.length).toBeGreaterThan(0);
    expect(s.pending.eligible).not.toContain(s.pending.buyer);
    expect(s.pending.claims.every((id) => s.pending.eligible.includes(id))).toBe(true);
    expect(new Set(s.pending.claims).size).toBe(s.pending.claims.length);
  }
  if (s.ride) expect(s.ride.player).toBe(s.players[s.turn].id);
  const target = s.cfg.targetWorth;
  if (s.phase === 'over') {
    expect(['last_standing', 'target', 'rounds']).toContain(s.winReason);
    if (s.winner) expect(standings(s)[0].id).toBe(s.winner);
    if (s.winReason === 'target') expect(netWorth(s, s.winner)).toBeGreaterThanOrEqual(target);
    if (s.winReason === 'rounds' && target != null) {
      for (const p of s.players) if (!p.bankrupt) expect(netWorth(s, p.id)).toBeLessThan(target);
    }
  } else {
    expect(s.players.filter((p) => !p.bankrupt).length).toBeGreaterThanOrEqual(2);
    // nothing in flight and somebody at the target: the game must already be over
    if (target != null && s.phase !== 'debt' && s.phase !== 'auction' && !s.trade) {
      for (const p of s.players) if (!p.bankrupt) expect(netWorth(s, p.id)).toBeLessThan(target);
    }
  }
}

/** Cash moved by the events of one action must explain the change of every player's cash exactly. */
function cashMatchesEvents(before, after, events) {
  const delta = Object.fromEntries(before.players.map((p) => [p.id, 0]));
  for (const e of events) if (e.type === 'cash') delta[e.player] += e.delta;
  for (const p of after.players) {
    const prev = before.players.find((q) => q.id === p.id);
    if (!p.bankrupt) expect(p.cash - prev.cash).toBe(delta[p.id]);
  }
  // Player-to-player transfers (rent, trades, collect/pay all) always come in balanced pairs.
  const pairs = events.filter((e) => e.type === 'cash' && e.other && (e.reason === 'rent' || e.reason === 'trade'));
  expect(pairs.reduce((n, e) => n + e.delta, 0)).toBe(0);
}

describe('fuzz: random legal actions', () => {
  for (const n of [2, 3, 4, 6]) {
    for (const mode of ['standard', 'quick', 'classic']) {
      it(`${n} players, ${mode}`, () => {
        for (let g = 0; g < 4; g++) {
          const seed = n * 1000 + g * 17 + mode.length;
          const rnd = mulberry32(seed);
          let s = createGame({ players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` })), settings: { mode }, seed });
          for (let step = 0; step < 2500 && s.phase !== 'over'; step++) {
            const a = randomAction(s, rnd);
            if (a.type === 'UPGRADE') expect(ownsWholeCollection(s, a.playerId, a.tile)).toBe(true);
            const r = applyAction(s, a);
            if (r.error) throw new Error(`step ${step} ${JSON.stringify(a)} -> ${r.error}`);
            cashMatchesEvents(s, r.state, r.events);
            s = r.state;
            invariants(s);
          }
        }
      }, 60_000); // 2500 steps x 4 games: slow on a busy machine
    }
  }

  it('bots and auto-played humans only ever UPGRADE a district whose whole collection they own', () => {
    let upgrades = 0;
    for (const asBots of [true, false]) {
      for (let g = 0; g < 12; g++) {
        const n = 2 + (g % 4);
        const seed = 500 + g * 31 + (asBots ? 1 : 0);
        const rnd = mulberry32(seed);
        let s = createGame({
          players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: asBots })),
          settings: { mode: 'quick' }, seed,
        });
        // Hand out whole collections to some seats and half-collections to others so upgrades happen AND get refused.
        s.owners[28] = 'p0'; s.owners[29] = 'p0'; s.owners[31] = 'p0'; // p0 holds Cyberabad
        s.owners[1] = 'p1'; s.owners[3] = 'p1'; // p1 has 2 of 3 Bazaar districts
        s.owners[33] = 'p1'; s.owners[34] = 'p1'; s.owners[35] = 'p1'; // and the whole New City
        for (let step = 0; step < 1500 && s.phase !== 'over'; step++) {
          let a;
          if (s.phase === 'snatch') a = botSnatchMove(s);
          else if (asBots) a = nextBotMove(s, rnd);
          else {
            const who = actorOf(s);
            a = chooseBotAction(s, who, rnd); // what the server auto-plays for an idle human seat
          }
          if (!a) break;
          if (a.type === 'UPGRADE') {
            upgrades++;
            expect(ownsWholeCollection(s, a.playerId, a.tile), `step ${step} ${JSON.stringify(a)}`).toBe(true);
            expect(canUpgrade(s, a.playerId, a.tile).ok).toBe(true);
          }
          const r = applyAction(s, a);
          if (r.error) throw new Error(`step ${step} ${JSON.stringify(a)} -> ${r.error}`);
          s = r.state;
          invariants(s);
        }
      }
    }
    expect(upgrades).toBeGreaterThan(0); // the bots do build once they own a collection
  });

  it('every mode and every win target always terminates, with a valid reason and the winner at rank 1', () => {
    const cap = { standard: 20, quick: 12, classic: 60 };
    const seen = new Set();
    for (const mode of ['standard', 'quick', 'classic']) {
      for (const targetWorth of [null, 2500000, 5000000]) {
        for (const n of [2, 5]) {
          const seed = n * 31 + mode.length + (targetWorth ? targetWorth / 100000 : 0);
          const rnd = mulberry32(seed);
          let s = createGame({ players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })), settings: { mode, targetWorth }, seed });
          let steps = 0;
          while (s.phase !== 'over') {
            const a = s.phase === 'snatch' ? botSnatchMove(s) : nextBotMove(s, rnd);
            expect(a, `${mode} ${targetWorth} n=${n} step ${steps}: no move in phase ${s.phase}`).toBeTruthy();
            const r = applyAction(s, a);
            if (r.error) throw new Error(`${mode} ${targetWorth}: ${JSON.stringify(a)} -> ${r.error}`);
            s = r.state;
            invariants(s);
            if (++steps > 60000) throw new Error(`${mode} ${targetWorth} n=${n}: did not terminate`);
          }
          expect(s.round, `${mode} ${targetWorth} n=${n}`).toBeLessThanOrEqual(cap[mode] + 1);
          if (targetWorth == null && mode !== 'classic') expect(s.winReason).toBe('rounds');
          seen.add(s.winReason);
        }
      }
    }
    expect(seen.has('target')).toBe(true); // the small targets are reached by the bots
    expect(seen.has('rounds')).toBe(true);
  }, 60000);

  it('never mutates the input state and refuses junk without throwing', () => {
    const s = createGame({ players: [{ id: 'a' }, { id: 'b' }], seed: 3 });
    const copy = structuredClone(s);
    for (const junk of [null, {}, { type: 5 }, { type: 'NOPE', playerId: 'a' }, { type: 'ROLL' }, { type: 'BID', playerId: 'a', amount: -1 },
      { type: 'UPGRADE', playerId: 'a', tile: 99 }, { type: 'RIDE', playerId: 'a' }, { type: 'PAY_TRAFFIC', playerId: 'a' },
      { type: 'SNATCH', playerId: 'a' }, { type: 'PLACE_TRAP', playerId: 'a', tile: 3 }, { type: 'PAY_BAIL', playerId: 'a' }]) {
      const r = applyAction(s, junk);
      expect(r.error).toBeTruthy();
      expect(r.state).toBe(s);
    }
    applyAction(s, { type: 'ROLL', playerId: 'a' });
    expect(s).toEqual(copy);
  });
});
