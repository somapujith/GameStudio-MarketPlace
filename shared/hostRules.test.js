// Host rules (shared/ruleSettings.js) really change the game: every non-Snatch key flows into state.cfg and is READ from it
// by the engine (docs/GAME_RULES.md section 2). Debug dice (`cfg.debug` + `ROLL {dice:[n]}`) make every move exact.
import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, getOptions, netWorth, previewRent, canUpgrade, normalizeSettings, nextBotMove, botSnatchAction, mulberry32,
  TILES, GROUP_TILES, GROUPS, rentFor, ruleDefaults, RULE_FIELDS, ROUND_CAP, MODES, resolveTarget, PASS_START, TRAFFIC_FINE,
  CHAI_CAP, CHAI_MIN_RENT, EVENT_EVERY, LUCK_CARDS, DRAMA_CARDS,
} from './index.js';

const ids = ['a', 'b', 'c'];
function game(settings = {}, { n = 3, seed = 7 } = {}) {
  return createGame({ players: ids.slice(0, n).map((id) => ({ id, name: id.toUpperCase() })), settings: { debug: true, snatches: 0, ...settings }, seed });
}
const P = (s, id) => s.players.find((p) => p.id === id);
function act(s, action) {
  const r = applyAction(s, action);
  if (r.error) throw new Error(`${action.type}: ${r.error}`);
  return r;
}
const roll = (s, who, d) => act(s, { type: 'ROLL', playerId: who, dice: [d] });
const cashOf = (events, player, reason) => events.filter((e) => e.type === 'cash' && e.player === player && e.reason === reason);
/** Put the next card of `deck` on top: the engine draws deck[deckPos]. */
function stackCard(s, deck, cardId) {
  const cards = deck === 'luck' ? LUCK_CARDS : DRAMA_CARDS;
  s.deck[deck] = [cards.findIndex((c) => c.id === cardId), ...s.deck[deck]];
  s.deckPos[deck] = 0;
}

/** Bots play a whole game (Snatch windows are closed by the room's timer, as on the server). */
function playOut(settings, { n = 3, seed = 11, max = 40000 } = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true }));
  let s = createGame({ players, settings, seed });
  const rnd = mulberry32(seed * 31 + 7);
  const events = [];
  for (let k = 0; k < max && s.phase !== 'over'; k++) {
    let a;
    if (s.phase === 'snatch') a = s.pending.eligible.map((id) => botSnatchAction(s, id)).find(Boolean) || { type: 'SNATCH_CLOSE' };
    else a = nextBotMove(s, rnd);
    const r = applyAction(s, a);
    if (r.error) throw new Error(`${JSON.stringify(a)} -> ${r.error}`);
    s = r.state;
    events.push(...r.events);
  }
  return { s, events };
}

describe('state.cfg carries every host rule', () => {
  it('has all the rule keys of the contract, defaults per mode, and the old constants as the stock values', () => {
    for (const mode of ['standard', 'quick', 'classic']) {
      const cfg = createGame({ players: [{ id: 'a' }, { id: 'b' }], settings: { mode }, seed: 1 }).cfg;
      expect(cfg).toEqual({ mode, ...ruleDefaults(mode) });
      for (const f of RULE_FIELDS) expect(cfg, f.key).toHaveProperty(f.key);
    }
    const d = ruleDefaults('standard');
    expect(d.passStart).toBe(PASS_START);
    expect(d.trafficFine).toBe(TRAFFIC_FINE);
    expect(d.chaiCap).toBe(CHAI_CAP);
    expect(d.eventEvery).toBe(EVENT_EVERY);
    expect(d).toMatchObject({ turnSeconds: 60, tradeSeconds: 45, rentPercent: 100, requireFullSet: true });
  });

  it('every legal option of every rule is accepted as it is, in every mode', () => {
    for (const mode of ['standard', 'quick', 'classic']) {
      for (const f of RULE_FIELDS) {
        const values = f.type === 'number' ? [f.min, f.max] : f.type === 'boolean' ? [true, false] : f.options.map((o) => o.value);
        for (const v of values) {
          const cfg = normalizeSettings({ mode, [f.key]: v });
          expect(cfg[f.key], `${mode} ${f.key}=${v}`).toBe(v);
        }
      }
    }
  });

  it('rules not mentioned keep the defaults of the mode; junk is ignored; numbers are clamped, never NaN', () => {
    expect(normalizeSettings({ mode: 'quick', rentPercent: 150 })).toEqual({ ...ruleDefaults('quick'), mode: 'quick', rentPercent: 150 });
    expect(normalizeSettings({ rentPercent: 'lots', startCash: NaN, chaiCap: -4, turnSeconds: 99999 })).toMatchObject({
      startCash: 1500000, chaiCap: 1, turnSeconds: 600,
    });
    expect(normalizeSettings({ rentPercent: 'lots' }).rentPercent).toBe(100);
    expect(normalizeSettings({ passStart: -5 }).passStart).toBe(0);
    expect(normalizeSettings({ requireFullSet: 'no' }).requireFullSet).toBe(true);
    expect(normalizeSettings({ junk: 1, seed: 2 })).not.toHaveProperty('junk');
  });
});

describe('startCash', () => {
  it('every player starts with the host amount', () => {
    for (const startCash of [500000, 2750000, 100000000]) {
      const s = game({ startCash });
      expect(s.players.map((p) => p.cash)).toEqual([startCash, startCash, startCash]);
      expect(netWorth(s, 'a')).toBe(startCash);
    }
    expect(game({ mode: 'quick' }).players[0].cash).toBe(MODES.quick.startCash);
  });
});

describe('passStart', () => {
  it('pays the host amount for passing or landing on START, once per move', () => {
    for (const passStart of [75000, 1000000]) {
      const s = game({ passStart });
      s.players[0].pos = 33;
      const r = roll(s, 'a', 3); // lands right on START
      expect(r.events.filter((e) => e.type === 'cash' && e.reason === 'salary')).toEqual([{ type: 'cash', player: 'a', delta: passStart, reason: 'salary' }]);
      expect(P(r.state, 'a').cash).toBe(1500000 + passStart);
      const p = game({ passStart });
      p.players[0].pos = 34;
      expect(cashOf(roll(p, 'a', 5).events, 'a', 'salary')).toEqual([{ type: 'cash', player: 'a', delta: passStart, reason: 'salary' }]); // passes START
    }
  });

  it('0 means no salary at all: no cash event, the lap is still counted', () => {
    const s = game({ passStart: 0 });
    s.players[0].pos = 34;
    const r = roll(s, 'a', 5);
    expect(r.events.some((e) => e.type === 'cash' && e.reason === 'salary')).toBe(false);
    expect(r.events.find((e) => e.type === 'move').passedStart).toBe(true);
    expect(P(r.state, 'a')).toMatchObject({ cash: 1500000, laps: 1 });
  });

  it('a move-to-START card and a ride that pass START pay the host amount too', () => {
    const w = game({ passStart: 50000 });
    w.players[0].pos = 19;
    stackCard(w, 'luck', 'go_start');
    const wr = roll(w, 'a', 2);
    expect(P(wr.state, 'a')).toMatchObject({ pos: 0, cash: 1550000 });
    const m = game({ passStart: 50000 });
    m.players[0].pos = 20;
    const landed = roll(m, 'a', 3); // 23 MMTS Express
    expect(landed.state.ride).toMatchObject({ from: 23, to: 5 });
    const ride = act(landed.state, { type: 'RIDE', playerId: 'a' }); // the ride to Auto Stand 5 passes START
    expect(cashOf(ride.events, 'a', 'salary')).toEqual([{ type: 'cash', player: 'a', delta: 50000, reason: 'salary' }]);
  });
});

describe('rentPercent', () => {
  it('scales the rent a visitor pays: x0.5, x0.75, x1, x1.25, x1.5, x2', () => {
    for (const pct of [50, 75, 100, 125, 150, 200]) {
      const s = game({ rentPercent: pct });
      s.owners[3] = 'b'; // Monda Market, base rent 7,000
      const base = rentFor(TILES[3], 0, false);
      expect(base).toBe(7000);
      const want = Math.round((base * pct) / 100);
      expect(previewRent(s, 3), `preview ${pct}%`).toBe(want);
      const r = roll(s, 'a', 3);
      expect(cashOf(r.events, 'a', 'rent')).toEqual([{ type: 'cash', player: 'a', delta: -want, reason: 'rent', other: 'b' }]);
      expect(cashOf(r.events, 'b', 'rent')).toEqual([{ type: 'cash', player: 'b', delta: want, reason: 'rent', other: 'a' }]);
      expect(P(r.state, 'b').stats.rentEarned).toBe(want);
    }
  });

  it('applies after the set bonus, the city event and the Cricket-night boost; previewRent agrees', () => {
    for (const pct of [50, 125, 200]) {
      const s = game({ rentPercent: pct });
      for (const t of GROUP_TILES.cyber) s.owners[t] = 'b';
      s.event = { id: 'rush_hour', kind: 'rent', group: 'cyber', mult: 1.5, round: 3 };
      P(s, 'b').rentBoost = 2;
      const want = Math.round((rentFor(TILES[28], 0, true) * 1.5 * 2 * pct) / 100);
      expect(previewRent(s, 28)).toBe(want);
      s.players[0].pos = 25;
      const r = roll(s, 'a', 3); // 25 -> 28
      expect(cashOf(r.events, 'a', 'rent')[0].delta).toBe(-want);
    }
  });

  it('a mortgaged or free district still asks nothing', () => {
    const s = game({ rentPercent: 200 });
    expect(previewRent(s, 3)).toBe(0);
    s.owners[3] = 'b';
    s.mortgaged[3] = true;
    expect(previewRent(s, 3)).toBe(0);
  });

  it('the chai still halves a big rent: the threshold is checked on the scaled amount', () => {
    const s = game({ rentPercent: 200 });
    s.owners[6] = 'b';
    s.players[0].pos = 3;
    s.players[0].chai = 1;
    const r = roll(s, 'a', 3);
    expect(rentFor(TILES[6], 0, false) * 2).toBe(CHAI_MIN_RENT); // 10,000 x 2 = exactly the chai threshold
    expect(r.events).toContainEqual({ type: 'chai', player: 'a', chai: 0, change: -1, reason: 'rent', saved: CHAI_MIN_RENT / 2 });
    const low = game({ rentPercent: 50 });
    low.owners[6] = 'b';
    low.players[0].pos = 3;
    low.players[0].chai = 1;
    expect(roll(low, 'a', 3).events.some((e) => e.type === 'chai')).toBe(false); // 5,000: below the threshold, the chai stays
  });

  it('higher rents bite harder: the same bill opens a debt at 200% but not at 50%', () => {
    const play = (rentPercent) => {
      const s = game({ rentPercent });
      s.owners[35] = 'b';
      s.levels[35] = 1;
      s.players[0].pos = 32;
      s.players[0].cash = 160000;
      s.owners[1] = 'a'; // two districts to mortgage: 65,000 more
      s.owners[3] = 'a';
      return roll(s, 'a', 3).state;
    };
    expect(rentFor(TILES[35], 1, false)).toBe(108000);
    expect(play(200).phase).toBe('debt');
    expect(play(50).phase).not.toBe('debt');
  });
});

describe('trafficFine', () => {
  const stuckTurn = (settings) => {
    const s = game(settings);
    s.players[0].stuck = true;
    s.players[0].pos = 9;
    return s;
  };

  it('is what getOptions offers and what PAY_TRAFFIC charges', () => {
    for (const trafficFine of [5000, 60000, 100000]) {
      const s = stuckTurn({ trafficFine });
      expect(getOptions(s, 'a').payTraffic).toBe(trafficFine);
      const r = act(s, { type: 'PAY_TRAFFIC', playerId: 'a' });
      expect(r.events).toEqual([
        { type: 'cash', player: 'a', delta: -trafficFine, reason: 'traffic' },
        { type: 'traffic', player: 'a', stuck: false, reason: 'paid', amount: trafficFine },
      ]);
      expect(P(r.state, 'a').cash).toBe(1500000 - trafficFine);
    }
  });

  it('a player who cannot afford it can only wait or use chai; the refusal names the amount', () => {
    const s = stuckTurn({ trafficFine: 60000 });
    s.players[0].cash = 59999;
    expect(getOptions(s, 'a').payTraffic).toBe(false);
    expect(applyAction(s, { type: 'PAY_TRAFFIC', playerId: 'a' }).error).toMatch(/60,000/);
  });

  it('with the default fine a jammed player is still stuck when their turn comes', () => {
    const s = game();
    s.players[0].pos = 6;
    let r = roll(s, 'a', 3); // lands on the Traffic Jam
    expect(r.events).toContainEqual({ type: 'traffic', player: 'a', stuck: true, reason: 'tile' });
    r = turnsUntil(r.state, 'a');
    expect(P(r.state, 'a').stuck).toBe(true);
    expect(getOptions(r.state, 'a').payTraffic).toBe(25000);
  });

  it('0 makes the jam free: the jammed player is let out when their turn comes, with nothing to pay', () => {
    const s = game({ trafficFine: 0 });
    s.players[0].pos = 6;
    let r = roll(s, 'a', 3);
    expect(r.events).toContainEqual({ type: 'traffic', player: 'a', stuck: true, reason: 'tile' });
    expect(r.state.turn).toBe(1);
    expect(P(r.state, 'a').stuck).toBe(true); // still in the jam for the rest of this turn
    r = turnsUntil(r.state, 'a');
    expect(r.events.at(-1)).toEqual({ type: 'traffic', player: 'a', stuck: false, reason: 'free' });
    expect(P(r.state, 'a').stuck).toBe(false);
    expect(getOptions(r.state, 'a')).toMatchObject({ roll: true, payTraffic: false });
    expect(roll(r.state, 'a', 1).state.players[0].pos).toBe(10); // a normal roll
    expect(P(r.state, 'a').cash).toBe(1500000); // never charged
  });
});

/** Let the other players take (and end) their turns until it is `playerId`'s turn again; returns the last action's result. */
function turnsUntil(s, playerId) {
  let r = { state: s, events: [] };
  for (let i = 0; i < 12 && r.state.players[r.state.turn].id !== playerId; i++) {
    const who = r.state.players[r.state.turn].id;
    const me = P(r.state, who);
    me.pos = 15; // Chai Adda is 3 ahead: nothing to buy, nothing to pay
    me.chai = 0;
    let t = roll(r.state, who, 3);
    if (t.state.extraRoll) t = act(t.state, { type: 'ROLL', playerId: who, dice: [1] });
    r = act(t.state, { type: 'END_TURN', playerId: who });
  }
  return r;
}

describe('chaiCap', () => {
  it('a player holds up to the host cap, and gets nothing at the cap', () => {
    for (const chaiCap of [1, 2, 3]) {
      let s = game({ chaiCap });
      for (let i = 0; i < chaiCap + 1; i++) {
        P(s, 'a').pos = 15;
        s.turn = 0;
        s.phase = 'roll';
        s.extraRoll = false;
        const r = roll(s, 'a', 3); // Chai Adda
        expect(r.events.some((e) => e.type === 'chai'), `${chaiCap}: visit ${i + 1}`).toBe(i < chaiCap);
        s = r.state;
        expect(P(s, 'a').chai).toBe(Math.min(i + 1, chaiCap));
      }
    }
  });

  it('a Free-chai card respects the cap too', () => {
    const s = game({ chaiCap: 2 });
    s.players[0].chai = 2;
    s.players[0].pos = 19;
    stackCard(s, 'luck', 'free_chai');
    const r = roll(s, 'a', 2);
    expect(P(r.state, 'a').chai).toBe(2);
  });
});

describe('dice', () => {
  it('is kept in cfg; fair dice never give a lucky-dice assist', () => {
    expect(game({ dice: 'fair' }).cfg.dice).toBe('fair');
    expect(game({ dice: 'lucky' }).cfg.dice).toBe('lucky');
    const assists = (dice) => {
      let n = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const { events } = playOut({ dice, snatches: 0 }, { n: 4, seed, max: 1500 });
        n += events.filter((e) => e.type === 'dice' && e.assist).length;
      }
      return n;
    };
    expect(assists('fair')).toBe(0);
    expect(assists('lucky')).toBeGreaterThan(0);
  });
});

describe('the retired auctionOnDecline rule', () => {
  it('is gone from the rules, and a stored true or false changes nothing: a pass never starts an auction', () => {
    expect(RULE_FIELDS.some((f) => f.key === 'auctionOnDecline')).toBe(false);
    for (const stored of [true, false, undefined]) {
      const g = game(stored === undefined ? {} : { auctionOnDecline: stored });
      expect(g.cfg).not.toHaveProperty('auctionOnDecline');
      const pass = act(roll(g, 'a', 1).state, { type: 'SKIP_BUY', playerId: 'a' });
      expect(pass.state.phase).toBe('manage');
      expect(pass.state.owners[1]).toBeNull();
      const poor = game(stored === undefined ? {} : { auctionOnDecline: stored });
      poor.players[0].cash = 1000;
      expect(roll(poor, 'a', 1).state.phase).toBe('manage'); // cannot afford: nothing offered, no auction either
    }
  });

  it('an old saved game whose cfg still carries auctionOnDecline: true behaves as no auction', () => {
    const g = game();
    g.cfg.auctionOnDecline = true; // what a game stored before the rule was retired holds
    const pass = act(roll(g, 'a', 1).state, { type: 'SKIP_BUY', playerId: 'a' });
    expect(pass.state.phase).toBe('manage');
    expect(pass.events.map((e) => e.type)).toEqual(['skip']);
    const poor = structuredClone(g);
    poor.players[0].cash = 1000;
    const r = roll(poor, 'a', 1);
    expect(r.state.phase).toBe('manage');
    expect(r.events.map((e) => e.type)).not.toContain('auction_start');
  });
});

describe('maxRounds', () => {
  it('ends the game after the host round limit and names the rounds as the reason', () => {
    for (const maxRounds of [10, 25]) {
      const s = game({ maxRounds, targetWorth: null }, { n: 2 });
      s.round = maxRounds;
      s.turn = 1;
      s.phase = 'manage';
      s.owners[35] = 'b';
      const r = act(s, { type: 'END_TURN', playerId: 'b' });
      expect(r.state).toMatchObject({ phase: 'over', winner: 'b', winReason: 'rounds', round: maxRounds + 1 });
      const earlier = game({ maxRounds, targetWorth: null }, { n: 2 });
      earlier.round = maxRounds - 1;
      earlier.turn = 1;
      earlier.phase = 'manage';
      expect(act(earlier, { type: 'END_TURN', playerId: 'b' }).state.phase).toBe('roll');
    }
  });

  it('bot games never run past the limit; null plays on to the safety cap', () => {
    for (const seed of [1, 2, 3]) {
      const { s } = playOut({ maxRounds: 10, targetWorth: null, snatches: 0 }, { n: 2, seed });
      expect(s.phase).toBe('over');
      expect(s.round).toBeLessThanOrEqual(11);
      if (s.winReason === 'rounds') expect(s.round).toBe(11);
    }
    const free = game({ maxRounds: null, targetWorth: null }, { n: 2 });
    free.round = ROUND_CAP;
    free.turn = 1;
    free.phase = 'manage';
    const r = act(free, { type: 'END_TURN', playerId: 'b' });
    expect(r.state).toMatchObject({ phase: 'over', winReason: 'rounds' });
  });
});

describe('targetWorth', () => {
  it('accepts any legal custom amount, and the first player to reach it wins', () => {
    for (const targetWorth of [1000000, 1500000, 12500000, 500000000]) {
      expect(normalizeSettings({ targetWorth }).targetWorth).toBe(targetWorth);
      expect(resolveTarget('standard', targetWorth)).toBe(targetWorth);
      expect(resolveTarget('classic', targetWorth)).toBe(targetWorth);
    }
    const s = game({ targetWorth: 1500000, startCash: 1000000 }, { n: 2 });
    s.owners[34] = 'a'; // a: 10L cash + 3.8L + 4L of districts = 17.8L, over the 15L target
    s.owners[35] = 'a';
    s.turn = 0;
    s.phase = 'manage';
    const r = act(s, { type: 'END_TURN', playerId: 'a' });
    expect(r.state).toMatchObject({ phase: 'over', winner: 'a', winReason: 'target' });
  });

  it('rejects amounts off the grid or outside the bounds (the mode default), and null only where the mode allows', () => {
    for (const bad of [900000, 1250000, 500500000, -1, 2500001, '3000000', NaN]) {
      expect(resolveTarget('standard', bad), String(bad)).toBe(MODES.standard.targetWorth);
      expect(resolveTarget('classic', bad), String(bad)).toBe(MODES.classic.targetWorth);
    }
    expect(resolveTarget('standard', null)).toBeNull();
    expect(resolveTarget('classic', null)).toBe(MODES.classic.targetWorth);
  });
});

describe('eventEvery', () => {
  const eventRounds = (events) => events.filter((e) => e.type === 'city_event').map((e) => e.round);
  const multiples = (n, upTo) => Array.from({ length: Math.floor(upTo / n) }, (_, i) => (i + 1) * n);

  it('0 means no city event at all, in a game that plays out', () => {
    for (const seed of [1, 2, 3]) {
      const { s, events } = playOut({ eventEvery: 0, snatches: 0, maxRounds: 20, targetWorth: null }, { n: 3, seed });
      expect(s.round).toBeGreaterThan(5);
      expect(events.some((e) => e.type === 'city_event')).toBe(false);
      expect(s.event).toBeNull();
    }
  });

  it('N means one event in every N-th round (never round 1), and the stock rule is every 3rd', () => {
    for (const every of [2, 3, 5, 6]) {
      const { s, events } = playOut({ eventEvery: every, snatches: 0, maxRounds: 20, targetWorth: null }, { n: 3, seed: 5 });
      const last = Math.min(s.round, 20);
      expect(eventRounds(events), `every ${every}`).toEqual(multiples(every, last));
    }
    const stock = playOut({ snatches: 0, maxRounds: 20, targetWorth: null }, { n: 3, seed: 5 });
    expect(eventRounds(stock.events)).toEqual(multiples(3, Math.min(stock.s.round, 20)));
  });

  it('a game without the key (stored before the rule existed) still has an event every 3rd round', () => {
    const s = game({ maxRounds: 20 }, { n: 2 });
    delete s.cfg.eventEvery;
    s.round = 2; // the last turn of round 2 starts round 3
    s.turn = 1;
    s.phase = 'manage';
    const r = act(s, { type: 'END_TURN', playerId: 'b' });
    expect(r.events.some((e) => e.type === 'city_event')).toBe(true);
  });
});

describe('requireFullSet', () => {
  const lone = (settings) => {
    const s = game(settings);
    s.owners[28] = 'a'; // one of the three Cyberabad districts
    return s;
  };

  it('on (stock): a single district of a collection cannot be upgraded, with the exact reason', () => {
    for (const settings of [{}, { requireFullSet: true }]) {
      const s = lone(settings);
      expect(canUpgrade(s, 'a', 28)).toEqual({ ok: false, reason: `Own all 3 districts of ${GROUPS.cyber.name} first (you have 1)`, cost: 120000 });
      expect(getOptions(s, 'a').upgrade).toEqual([]);
      expect(applyAction(s, { type: 'UPGRADE', playerId: 'a', tile: 28 }).error).toBe(`Own all 3 districts of ${GROUPS.cyber.name} first (you have 1)`);
    }
  });

  it('off: owning the district is enough; the other checks (turn, cash, mortgage, max level) still apply', () => {
    const s = lone({ requireFullSet: false });
    expect(canUpgrade(s, 'a', 28)).toMatchObject({ ok: true, cost: 120000 });
    expect(getOptions(s, 'a').upgrade).toEqual([{ tile: 28, cost: 120000, level: 0 }]);
    const r = act(s, { type: 'UPGRADE', playerId: 'a', tile: 28 });
    expect(r.state.levels[28]).toBe(1);
    expect(P(r.state, 'a').cash).toBe(1500000 - 120000);
    expect(canUpgrade(s, 'b', 28)).toMatchObject({ ok: false, reason: 'You do not own this district' });
    const poor = lone({ requireFullSet: false });
    poor.players[0].cash = 1000;
    expect(canUpgrade(poor, 'a', 28).ok).toBe(false);
    const mort = lone({ requireFullSet: false });
    mort.mortgaged[28] = true;
    expect(canUpgrade(mort, 'a', 28).reason).toBe('Unmortgage this district first');
    const top = lone({ requireFullSet: false });
    top.levels[28] = 2;
    expect(canUpgrade(top, 'a', 28).ok).toBe(false);
  });

  it('the set bonus on rent still needs the whole collection either way', () => {
    for (const requireFullSet of [true, false]) {
      const s = game({ requireFullSet });
      s.owners[28] = 'b';
      expect(previewRent(s, 28)).toBe(rentFor(TILES[28], 0, false));
      for (const t of GROUP_TILES.cyber) s.owners[t] = 'b';
      expect(previewRent(s, 28)).toBe(rentFor(TILES[28], 0, true));
    }
  });
});

describe('turnSeconds / tradeSeconds', () => {
  it('are carried in cfg for the room to read (the engine itself has no clock)', () => {
    expect(game({ turnSeconds: 15, tradeSeconds: 120 }).cfg).toMatchObject({ turnSeconds: 15, tradeSeconds: 120 });
    expect(game().cfg).toMatchObject({ turnSeconds: 60, tradeSeconds: 45 });
  });
});
