// Fuzz: random LEGAL host rules (every field of shared/ruleSettings.js, the extremes included) must give games that
// always terminate and keep the structural invariants, whoever plays (bots, or seats picking random legal options).
import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, getOptions, netWorth, previewRent, nextBotMove, botSnatchAction, mulberry32, standings,
  BOARD_SIZE, MAX_LEVEL, TILES, GROUP_TILES, GROUPS, isBuyable, canUpgrade, rentFor, setMultiplier,
  RULE_FIELDS, MODE_IDS, ROUND_CAP, sanitizeRules, liquidationValue, CITY_EVENTS,
} from './index.js';

/** One random legal value for a field: often an extreme, sometimes anything on the grid. */
function pickValue(f, rnd) {
  const r = rnd();
  if (f.type === 'boolean') return r < 0.5;
  if (f.type === 'choice') return f.options[Math.floor(rnd() * f.options.length)].value;
  const steps = Math.floor((f.max - f.min) / f.step);
  const k = r < 0.25 ? 0 : r < 0.5 ? steps : Math.floor(rnd() * (steps + 1));
  return f.min + k * f.step;
}

function randomRules(rnd) {
  const mode = MODE_IDS[Math.floor(rnd() * MODE_IDS.length)];
  const patch = {};
  for (const f of RULE_FIELDS) if (rnd() < 0.7) patch[f.key] = pickValue(f, rnd);
  const rules = sanitizeRules(patch, mode);
  return { mode, ...rules };
}

const actorOf = (s) => {
  if (s.phase === 'debt') return s.debt.player;
  if (s.trade) return s.trade.to;
  if (s.phase === 'auction') return s.players.find((p) => !p.bankrupt && !(p.id in s.pending.bids)).id;
  return s.players[s.turn].id;
};

function randomAction(s, rnd) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const active = s.players.filter((p) => !p.bankrupt);
  if (rnd() < 0.003 && active.length > 2) return { type: 'RESIGN', playerId: pick(active).id };
  if (s.phase === 'snatch') {
    const open = s.pending.eligible.filter((id) => !s.pending.claims.includes(id) && !s.players.find((p) => p.id === id).bankrupt);
    if (open.length && rnd() < 0.55) return { type: 'SNATCH', playerId: pick(open) };
    return { type: 'SNATCH_CLOSE' };
  }
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
    for (const u of o.upgrade) add(4, { type: 'UPGRADE', tile: u.tile });
    for (const m of o.mortgage) add(1, { type: 'MORTGAGE', tile: m.tile });
    for (const m of o.unmortgage) add(1, { type: 'UNMORTGAGE', tile: m.tile });
    for (const m of o.sellBuilding) add(1, { type: 'SELL_BUILDING', tile: m.tile });
  }
  let t = rnd() * c.reduce((x, e) => x + e.w, 0);
  for (const e of c) {
    t -= e.w;
    if (t <= 0) return e.a;
  }
  return c.at(-1).a;
}

/** A cheap assertion: these run on every action of thousands of actions (vitest's expect would be far too slow). */
const ok = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** Everything the host rules promise, restated from state.cfg alone. */
function invariants(s) {
  const cfg = s.cfg;
  const ids = new Set(s.players.map((p) => p.id));
  for (const p of s.players) {
    ok(Number.isInteger(p.cash) && p.cash >= 0, `${p.id} cash ${p.cash}`);
    ok(p.pos >= 0 && p.pos < BOARD_SIZE, `${p.id} pos ${p.pos}`);
    ok(p.chai >= 0 && p.chai <= cfg.chaiCap, `chai ${p.chai} cap ${cfg.chaiCap}`);
    ok(Number.isFinite(netWorth(s, p.id)), 'net worth');
    if (p.bankrupt) ok(!p.stuck, 'a bankrupt player is not stuck');
    if (cfg.trafficFine === 0 && s.phase !== 'over' && !p.bankrupt && s.players[s.turn].id === p.id) ok(!p.stuck, 'a free jam never holds a turn');
  }
  for (let i = 0; i < BOARD_SIZE; i++) {
    const o = s.owners[i];
    if (o !== null) ok(ids.has(o) && isBuyable(TILES[i]), `tile ${i} owner ${o}`);
    ok(s.levels[i] >= 0 && s.levels[i] <= MAX_LEVEL, `tile ${i} level ${s.levels[i]}`);
    if (s.levels[i] > 0) ok(o !== null, `tile ${i} has a level but no owner`);
  }
  if (s.phase === 'debt') ok(s.debt.amount <= s.players.find((p) => p.id === s.debt.player).cash + liquidationValue(s, s.debt.player), 'uncoverable debt');
  // city events: only with the rule on, only in its rounds
  if (s.event) {
    ok(cfg.eventEvery > 0, 'event although events are off');
    ok(s.event.round % cfg.eventEvery === 0, `event in round ${s.event.round} (every ${cfg.eventEvery})`);
    ok(CITY_EVENTS.some((d) => d.id === s.event.id), 'unknown event');
  }
  // round limit
  const limit = cfg.maxRounds ?? ROUND_CAP;
  ok(s.round <= limit + 1, `round ${s.round} past the limit ${limit}`);
  if (s.phase !== 'over') ok(s.round <= limit, `round ${s.round} past the limit ${limit} but the game goes on`);
  else {
    ok(['last_standing', 'target', 'rounds'].includes(s.winReason), `winReason ${s.winReason}`);
    if (s.winner) ok(standings(s)[0].id === s.winner, 'the winner is rank 1');
    if (s.winReason === 'rounds') ok(s.round === limit + 1, 'a rounds win comes after the last round');
    if (s.winReason === 'target') ok(netWorth(s, s.winner) >= cfg.targetWorth, 'a target win is at the target');
  }
}

/** The facts one action's events must respect, checked against the state before it. */
function eventRules(before, action, events, after) {
  const cfg = before.cfg;
  for (const e of events) {
    if (e.type === 'cash' && e.reason === 'salary') ok(e.delta === cfg.passStart, `salary ${e.delta} passStart ${cfg.passStart}`);
    if (e.type === 'cash' && e.reason === 'traffic') ok(e.delta === -cfg.trafficFine, `fine ${e.delta} trafficFine ${cfg.trafficFine}`);
    if (e.type === 'city_event') ok(cfg.eventEvery > 0, 'city event although events are off');
  }
  // a plain landing on someone's district: the rent paid is the preview (or its chai-halved half)
  if (action.type === 'ROLL' && events.filter((e) => e.type === 'land').length === 1) {
    const land = events.find((e) => e.type === 'land');
    const owner = before.owners[land.tile];
    if (isBuyable(TILES[land.tile]) && owner && owner !== action.playerId && !before.players.find((p) => p.id === owner).bankrupt) {
      const paid = events.filter((e) => e.type === 'cash' && e.reason === 'rent' && e.delta < 0 && e.player === action.playerId).reduce((n, e) => n - e.delta, 0);
      const bill = previewRent(before, land.tile);
      const halved = bill - Math.floor(bill / 2);
      const debt = after.phase === 'debt' || events.some((e) => e.type === 'bankrupt' || e.type === 'debt');
      if (!debt) ok(paid === bill || paid === halved, `rent on ${land.tile} (${cfg.rentPercent}%): paid ${paid}, preview ${bill}`);
    }
  }
  if (action.type === 'UPGRADE' && cfg.requireFullSet) {
    ok(GROUP_TILES[TILES[action.tile].group].every((t) => before.owners[t] === action.playerId), `tile ${action.tile} upgraded without the full collection`);
  }
}

describe('fuzz: random legal host rules', () => {
  it('bots finish every game: it always terminates and every invariant holds', () => {
    const outer = mulberry32(2024);
    const reasons = new Set();
    for (let g = 0; g < 36; g++) {
      const rules = randomRules(outer);
      const n = 2 + (g % 5);
      const seed = 9000 + g * 13;
      const rnd = mulberry32(seed);
      let s = createGame({ players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })), settings: rules, seed });
      expect(s.cfg).toMatchObject(Object.fromEntries(RULE_FIELDS.map((f) => [f.key, rules[f.key]])));
      let steps = 0;
      while (s.phase !== 'over') {
        if (++steps > 60000) throw new Error(`game ${g} (${JSON.stringify(rules)}) did not finish`);
        let a;
        if (s.phase === 'snatch') a = s.pending.eligible.map((id) => botSnatchAction(s, id)).find(Boolean) || { type: 'SNATCH_CLOSE' };
        else a = nextBotMove(s, rnd);
        const r = applyAction(s, a);
        if (r.error) throw new Error(`game ${g} step ${steps} ${JSON.stringify(a)} -> ${r.error} (${JSON.stringify(rules)})`);
        eventRules(s, a, r.events, r.state);
        s = r.state;
        invariants(s);
      }
      reasons.add(s.winReason);
    }
    expect(reasons.size).toBeGreaterThanOrEqual(2); // not every game ends the same way
  }, 120_000);

  it('seats picking random legal options never get an error, whatever the rules', () => {
    const outer = mulberry32(77);
    for (let g = 0; g < 24; g++) {
      const rules = randomRules(outer);
      const n = 2 + (g % 5);
      const seed = 4000 + g * 29;
      const rnd = mulberry32(seed);
      let s = createGame({ players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` })), settings: rules, seed });
      for (let step = 0; step < 2500 && s.phase !== 'over'; step++) {
        const a = randomAction(s, rnd);
        const r = applyAction(s, a);
        if (r.error) throw new Error(`game ${g} step ${step} ${JSON.stringify(a)} -> ${r.error} (${JSON.stringify(rules)})`);
        eventRules(s, a, r.events, r.state);
        s = r.state;
        invariants(s);
      }
    }
  }, 120_000);

  it('requireFullSet off: any owned, unmortgaged district below the top level can be upgraded when the cash is there', () => {
    const outer = mulberry32(5);
    for (let g = 0; g < 10; g++) {
      const rules = { ...randomRules(outer), requireFullSet: false, snatches: 0 };
      const s = createGame({ players: [{ id: 'a' }, { id: 'b' }], settings: rules, seed: g + 1 });
      s.players[0].cash = 50000000;
      const mine = [1, 6, 10, 15, 19, 24, 28, 33];
      for (const t of mine) s.owners[t] = 'a';
      for (const t of mine) expect(canUpgrade(s, 'a', t).ok, `tile ${t}: ${canUpgrade(s, 'a', t).reason}`).toBe(true);
      expect(getOptions(s, 'a').upgrade.map((u) => u.tile).sort((x, y) => x - y)).toEqual(mine);
    }
    // sanity of the restated rent: a full set is the only thing that raises level-0 rent
    expect(setMultiplier(1, 3)).toBe(1);
    expect(rentFor(TILES[1], 0, true)).toBeGreaterThan(rentFor(TILES[1], 0, false));
    expect(Object.keys(GROUPS).length).toBe(8);
  });
});
