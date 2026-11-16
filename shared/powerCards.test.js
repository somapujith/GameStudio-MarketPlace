// Power cards (docs/POWER_CARDS.md): the rules in the engine. An optional rule, off by default: every player holds up to two
// short-lived cards (Shield, Double Rent, Steal a Roll, Swap Tiles), drawn from card tiles and as a turn-start bonus, played
// in the roll phase before the roll. They draw from their own stream (`state.prng`), so with the rule off every seeded game is
// byte-identical to the engine before the rule existed (pinned below with fingerprints taken from that engine).
import { describe, it, expect } from 'vitest';
import {
  createGame, applyAction, getOptions, previewRent, municipalDue, normalizeSettings, nextBotMove, botSnatchAction, mulberry32,
  netWorth, TILES, ruleField, ruleDefaults, LUCK_CARDS, DRAMA_CARDS,
} from './index.js';
import { POWER, POWER_IDS } from './powerCards.js';
import { pickPowerId } from './engine.js';
import { ANIM_MS } from './timing.js';

// ---------------------------------------------------------------- helpers
const ids = ['a', 'b', 'c', 'd'];
const mk = (n = 3, settings = {}, seed = 7) => createGame({
  players: ids.slice(0, n).map((id) => ({ id, name: id.toUpperCase() })), seed, settings: { debug: true, snatches: 0, powerCards: true, ...settings },
});
const edit = (s, fn) => {
  const c = structuredClone(s);
  fn(c);
  return c;
};
const P = (s, id) => s.players.find((p) => p.id === id);
const ok = (res) => {
  expect(res.error).toBeUndefined();
  return res;
};
const act = (s, playerId, action) => ok(applyAction(s, { playerId, ...action }));
const ofType = (events, type) => events.filter((e) => e.type === type);
let uidSeq = 0;
/** A hand entry; `exp` defaults to three rounds from `round`. */
const card = (id, exp = 99) => ({ uid: `t${++uidSeq}`, id, exp });
/** `who` is on turn (phase roll) standing on `pos`, holding `cards` (ids); everybody else's hand is empty. */
const setup = (s, who, cards = [], pos = 0) => edit(s, (c) => {
  c.turn = c.players.findIndex((p) => p.id === who);
  c.phase = 'roll';
  c.powerPlayed = false;
  c.players[c.turn].pos = pos;
  c.players[c.turn].hand = cards.map((id) => (typeof id === 'string' ? card(id) : id));
});
const play = (s, who, cardId, target) => {
  const c = P(s, who).hand.find((x) => x.id === cardId);
  return applyAction(s, { type: 'PLAY_POWER', playerId: who, card: c.uid, ...(target ? { target } : null) });
};
const roll = (s, who, d) => act(s, who, { type: 'ROLL', dice: [d] });
const noPower = (events) => events.filter((e) => !e.type.startsWith('power_'));

/** Bots play a whole game. */
function playOut(settings, { n = 3, seed = 11, max = 40000 } = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true }));
  let s = createGame({ players, settings, seed });
  const rnd = mulberry32(seed * 31 + 7);
  const events = [];
  const actions = [];
  for (let k = 0; k < max && s.phase !== 'over'; k++) {
    let a;
    if (s.phase === 'snatch') a = s.pending.eligible.map((id) => botSnatchAction(s, id)).find(Boolean) || { type: 'SNATCH_CLOSE' };
    else a = nextBotMove(s, rnd);
    const r = applyAction(s, a);
    if (r.error) throw new Error(`${JSON.stringify(a)} -> ${r.error}`);
    s = r.state;
    actions.push(a);
    events.push(...r.events);
  }
  return { s, events, actions };
}

const fnv = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
};

// A tile that asks rent from `b` once `a` owns it: Sultan Bazaar (1), a plain district.
const TILE = 1;
const MUNICIPAL = TILES.findIndex((t) => t.type === 'municipal');
const CARD_TILE = TILES.findIndex((t) => t.type === 'card');

// ---------------------------------------------------------------- the rule
describe('the powerCards rule', () => {
  it('is a normal lobby rule: boolean, off by default, in the board rules group, with the spec help text', () => {
    const f = ruleField('powerCards');
    expect(f).toMatchObject({ type: 'boolean', group: 'rules', label: 'Power cards' });
    expect(f.help).toBe('Short-lived cards: Shield, Double Rent, Steal a Roll, Swap Tiles. Held in secret, played before your roll.');
    expect(ruleDefaults('standard').powerCards).toBe(false);
  });

  it('is normalised: only a boolean counts, a stored game without it is off', () => {
    expect(normalizeSettings({ powerCards: true }).powerCards).toBe(true);
    expect(normalizeSettings({ powerCards: false }).powerCards).toBe(false);
    expect(normalizeSettings({ powerCards: 'yes' }).powerCards).toBe(false);
    expect(normalizeSettings({}).powerCards).toBe(false);
    const stored = createGame({ players: [{ id: 'a' }, { id: 'b' }], seed: 3 });
    delete stored.cfg.powerCards; // a game stored before the rule existed
    expect(getOptions(stored, 'a')).not.toHaveProperty('power');
    expect(applyAction(stored, { type: 'PLAY_POWER', playerId: 'a', card: 'x' }).error).toBe('Power cards are not enabled');
    expect(applyAction(stored, { type: 'ROLL', playerId: 'a' }).error).toBeUndefined();
  });

  it('adds the state only when on: a separate stream, powerPlayed, and per player a hand and the armed rounds', () => {
    const on = mk(3, { debug: false }, 5);
    expect(Number.isInteger(on.prng) && on.prng >= 0 && on.prng <= 0xffffffff).toBe(true);
    expect(on.prng).not.toBe(on.rng);
    expect(on.powerPlayed).toBe(false);
    for (const p of on.players) expect(p).toMatchObject({ hand: [], shield: 0, doubleRent: 0 });
    const off = createGame({ players: [{ id: 'a' }, { id: 'b' }], seed: 5 });
    expect(off).not.toHaveProperty('prng');
    expect(off).not.toHaveProperty('powerPlayed');
    for (const p of off.players) for (const k of ['hand', 'shield', 'doubleRent']) expect(p).not.toHaveProperty(k);
    // the board's stream and decks are not touched by the rule
    const same = createGame({ players: [{ id: 'a' }, { id: 'b' }], seed: 5, settings: { powerCards: true } });
    expect(same.rng).toBe(off.rng);
    expect(same.deck).toEqual(off.deck);
  });

  it('timing keys exist for the four power moments', () => {
    expect(ANIM_MS).toMatchObject({ powerDraw: 900, powerPlay: 1500, powerTrigger: 1400, powerExpire: 700 });
  });
});

describe('rule OFF: the engine behaves exactly as before', () => {
  // Fingerprints (FNV-1a of the JSON of every action + event, and of the final state minus cfg.powerCards) taken from the
  // engine BEFORE this rule existed, for seeded bot games. They must never change.
  const GOLDEN = [
    [2, 11, 'standard', '989720b2', '1c7469bc', 21],
    [3, 23, 'quick', 'c3c6140a', '542126ce', 13],
    [4, 37, 'classic', 'da92cf18', '277766e5', 45],
    [6, 5, 'standard', '345adc70', 'e0eb56b', 21],
  ];
  for (const [n, seed, mode, logHash, stateHash, rounds] of GOLDEN) {
    it(`${n} bots, ${mode}, seed ${seed}: the same events and final state as the engine without power cards`, () => {
      const run = (settings) => {
        const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true }));
        let s = createGame({ players, settings, seed });
        const rnd = mulberry32(seed * 31 + 7);
        const log = [];
        for (let k = 0; k < 40000 && s.phase !== 'over'; k++) {
          const a = s.phase === 'snatch' ? (s.pending.eligible.map((id) => botSnatchAction(s, id)).find(Boolean) || { type: 'SNATCH_CLOSE' }) : nextBotMove(s, rnd);
          const r = applyAction(s, a);
          if (r.error) throw new Error(r.error);
          s = r.state;
          log.push(a, r.events);
        }
        return { s, log };
      };
      const none = run({ mode });
      const off = run({ mode, powerCards: false });
      expect(off.log).toEqual(none.log);
      expect(off.s).toEqual(none.s);
      const st = structuredClone(none.s);
      delete st.cfg.powerCards;
      expect(fnv(JSON.stringify(none.log))).toBe(logHash);
      expect(fnv(JSON.stringify(st))).toBe(stateHash);
      expect(none.s.round).toBe(rounds);
      expect(none.s).not.toHaveProperty('prng');
      expect(none.s).not.toHaveProperty('powerPlayed');
      for (const p of none.s.players) for (const k of ['hand', 'shield', 'doubleRent']) expect(p).not.toHaveProperty(k);
      expect(JSON.stringify(none.log)).not.toMatch(/"type":"power_/);
    });
  }

  it('PLAY_POWER is refused and getOptions has no power key', () => {
    const s = createGame({ players: [{ id: 'a' }, { id: 'b' }], seed: 1 });
    expect(applyAction(s, { type: 'PLAY_POWER', playerId: 'a', card: 'x' })).toMatchObject({ error: 'Power cards are not enabled', events: [] });
    expect('power' in getOptions(s, 'a')).toBe(false);
  });
});

describe('determinism with the rule on', () => {
  it('the same seed and the same actions give the same events and state', () => {
    for (const seed of [3, 11, 29]) {
      const a = playOut({ powerCards: true }, { n: 4, seed });
      const b = playOut({ powerCards: true }, { n: 4, seed });
      expect(b.events).toEqual(a.events);
      expect(b.s).toEqual(a.s);
      expect(a.events.some((e) => e.type === 'power_draw')).toBe(true);
    }
    // replaying the recorded actions on a fresh game reproduces it too (the server does exactly that)
    const run = playOut({ powerCards: true }, { n: 3, seed: 8 });
    let s = createGame({ players: Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isBot: true })), settings: { powerCards: true }, seed: 8 });
    const events = [];
    for (const a of run.actions) {
      const r = applyAction(s, a);
      s = r.state;
      events.push(...r.events);
    }
    expect(events).toEqual(run.events);
    expect(s).toEqual(run.s);
  });

  it('never draws from the board stream: rng, decks and every non-power event match the rule-off game', () => {
    const on = mk(3, {}, 9);
    const off = mk(3, { powerCards: false }, 9);
    // p a rolls onto the Nawabi Luck tile: a luck card is drawn, and with the rule on a power card too
    const a = roll(setup(on, 'a', []), 'a', CARD_TILE);
    const b = roll(edit(off, (c) => { c.turn = 0; c.phase = 'roll'; }), 'a', CARD_TILE);
    expect(ofType(a.events, 'power_draw')).toHaveLength(1);
    expect(noPower(a.events)).toEqual(b.events);
    expect(a.state.rng).toBe(b.state.rng);
    expect(a.state.deckPos).toEqual(b.state.deckPos);
    expect(a.state.prng).not.toBe(on.prng);
  });
});

// ---------------------------------------------------------------- draw sources
describe('drawing power cards', () => {
  it('a card tile draws one (always, when the hand has room): public event without the card, card in the hand', () => {
    const s = setup(mk(3), 'a', [], 0);
    const r = roll(s, 'a', CARD_TILE);
    const draws = ofType(r.events, 'power_draw');
    expect(draws).toEqual([{ type: 'power_draw', player: 'a', source: 'tile', tile: CARD_TILE }]);
    const hand = P(r.state, 'a').hand;
    expect(hand).toHaveLength(1);
    expect(hand[0]).toMatchObject({ exp: s.round + POWER.LIFE_ROUNDS });
    expect(POWER_IDS).toContain(hand[0].id);
    expect(typeof hand[0].uid).toBe('string');
    expect(JSON.stringify(r.events)).not.toContain(hand[0].uid);
    // the draw follows the Luck card of the tile
    const kinds = r.events.map((e) => e.type);
    expect(kinds.indexOf('card')).toBeLessThan(kinds.indexOf('power_draw'));
  });

  it('a full hand gets nothing: no event, no stream draw', () => {
    const s = setup(mk(3), 'a', ['shield', 'steal'], 0);
    const r = roll(s, 'a', CARD_TILE);
    expect(ofType(r.events, 'power_draw')).toHaveLength(0);
    expect(P(r.state, 'a').hand).toEqual(P(s, 'a').hand);
    expect(r.state.prng).toBe(s.prng);
  });

  it('the hand never exceeds two cards over a long game, uids are unique in a hand and every id is drawn', () => {
    const seen = new Set();
    for (const seed of [77, 78, 79]) {
      let s = createGame({ players: ids.map((id) => ({ id, name: id, isBot: true })), seed, settings: { powerCards: true } });
      const rnd = mulberry32(seed);
      for (let k = 0; k < 6000 && s.phase !== 'over'; k++) {
        const a = s.phase === 'snatch' ? { type: 'SNATCH_CLOSE' } : nextBotMove(s, rnd);
        s = ok(applyAction(s, a)).state;
        for (const p of s.players) {
          expect(p.hand.length).toBeLessThanOrEqual(POWER.HAND_MAX);
          expect(new Set(p.hand.map((c) => c.uid)).size).toBe(p.hand.length);
          for (const c of p.hand) seen.add(c.id);
        }
      }
    }
    expect([...seen].sort()).toEqual([...POWER_IDS].sort());
  });

  it('the turn-start bonus is drawn as the next turn begins, at the configured chance (higher when trailing)', () => {
    const base = mk(3, {}, 21);
    const trial = (trailing) => {
      let s = base;
      let draws = 0;
      const n = 600;
      for (let k = 0; k < n; k++) {
        // the turn player ends their turn (manage phase); the NEXT player's hand is emptied so a draw is always possible
        const cur = s.players[s.turn];
        const next = s.players[(s.turn + 1) % s.players.length];
        s = edit(s, (c) => {
          c.phase = 'manage';
          c.round = 2; // stay clear of the round limit: this looks at the bonus only
          for (const p of c.players) {
            p.hand = [];
            p.cash = trailing && p.id === next.id ? 100000 : 1500000;
          }
        });
        const r = act(s, cur.id, { type: 'END_TURN' });
        const d = ofType(r.events, 'power_draw');
        if (d.length) {
          draws++;
          expect(d[0]).toEqual({ type: 'power_draw', player: next.id, source: 'turn' });
          const kinds = r.events.map((e) => e.type);
          expect(kinds.indexOf('turn')).toBeLessThan(kinds.indexOf('power_draw')); // the turn begins, then the bonus
          expect(r.state.phase).toBe('roll');
          expect(r.state.players[r.state.turn].id).toBe(next.id);
          expect(P(r.state, next.id).hand).toHaveLength(1);
        }
        s = r.state;
      }
      return draws / n;
    };
    const normal = trial(false);
    const behind = trial(true);
    expect(normal).toBeGreaterThan(POWER.TURN_START_CHANCE * 0.5);
    expect(normal).toBeLessThan(POWER.TURN_START_CHANCE * 1.8);
    expect(behind).toBeGreaterThan(POWER.TRAILING_CHANCE * 0.6);
    expect(behind).toBeLessThan(POWER.TRAILING_CHANCE * 1.5);
    expect(behind).toBeGreaterThan(normal);
  });

  it('the first turn of the game has no turn-start draw (nothing has started yet to announce it)', () => {
    const s = mk(3);
    expect(s.players.every((p) => p.hand.length === 0)).toBe(true);
  });

  it('powerPlayed resets when a new turn starts', () => {
    const s = setup(mk(3), 'a', ['shield']);
    const played = ok(play(s, 'a', 'shield')).state;
    expect(played.powerPlayed).toBe(true);
    const rolled = roll(played, 'a', 1).state;
    expect(rolled.powerPlayed).toBe(true); // still this turn
    const next = act(edit(rolled, (c) => { c.phase = 'manage'; c.extraRoll = false; }), 'a', { type: 'END_TURN' }).state;
    expect(next.powerPlayed).toBe(false);
  });
});

// ---------------------------------------------------------------- PLAY_POWER legality
describe('PLAY_POWER: every illegal play', () => {
  const err = (s, who, a) => applyAction(s, { playerId: who, type: 'PLAY_POWER', ...a });
  const base = () => edit(setup(mk(3), 'a', ['shield', 'swap']), (c) => { P(c, 'b').pos = 10; P(c, 'c').pos = 15; });
  const shieldUid = (s) => P(s, 'a').hand.find((c) => c.id === 'shield').uid;
  const swapUid = (s) => P(s, 'a').hand.find((c) => c.id === 'swap').uid;

  it('plays a card in phase roll: the card leaves the hand, powerPlayed is set, one public power_play event', () => {
    const s = base();
    const r = ok(err(s, 'a', { card: shieldUid(s) }));
    expect(r.events).toEqual([{ type: 'power_play', player: 'a', card: 'shield' }]);
    expect(P(r.state, 'a').hand.map((c) => c.id)).toEqual(['swap']);
    expect(r.state.powerPlayed).toBe(true);
    expect(s.powerPlayed).toBe(false); // the old state is untouched
  });

  it('refuses with a plain error and changes nothing', () => {
    const s = base();
    const bad = (state, who, a, msg) => {
      const r = err(state, who, a);
      expect(r.error).toBe(msg);
      expect(r.events).toEqual([]);
      expect(r.state).toBe(state);
    };
    bad(s, 'b', { card: shieldUid(s) }, 'Not your turn');
    bad(s, 'a', { card: 'nope' }, 'You do not hold that card');
    bad(s, 'a', { card: 42 }, 'Invalid card');
    bad(s, 'a', { card: shieldUid(s), target: 5 }, 'Invalid target');
    bad(s, 'a', { card: shieldUid(s), target: 'b' }, 'This card has no target');
    bad(s, 'a', { card: swapUid(s) }, 'Pick a rival to swap with');
    bad(s, 'a', {}, 'Invalid card');
    // already played this turn
    const after = ok(err(s, 'a', { card: shieldUid(s) })).state;
    bad(after, 'a', { card: swapUid(after), target: 'b' }, 'Already played a card this turn');
    // after the roll
    const rolled = roll(s, 'a', 1).state;
    expect(rolled.phase).not.toBe('roll');
    bad(rolled, 'a', { card: shieldUid(rolled) }, 'Play a card before you roll');
    // an expired card
    const old = edit(s, (c) => { c.round = 5; P(c, 'a').hand[0].exp = 4; });
    bad(old, 'a', { card: shieldUid(old) }, 'That card has expired');
    // a trade offer waiting / a debt
    const withTrade = edit(s, (c) => { c.trade = { id: 1, from: 'b', to: 'c', give: { cash: 1, tiles: [] }, get: { cash: 0, tiles: [] } }; });
    expect(err(withTrade, 'a', { card: shieldUid(withTrade) }).error).toBe('A trade offer is waiting for an answer');
    const inDebt = edit(s, (c) => { c.phase = 'debt'; c.debt = { player: 'a', amount: 1, creditor: null, reason: 'tax', returnPhase: 'roll', rest: [] }; });
    expect(err(inDebt, 'a', { card: shieldUid(inDebt) }).error).toBe('Raise cash and settle the debt first');
    // out of the game / over
    const out = edit(s, (c) => { P(c, 'a').bankrupt = true; });
    expect(err(out, 'a', { card: shieldUid(s) }).error).toBe('You are out of the game');
    const over = edit(s, (c) => { c.phase = 'over'; });
    expect(err(over, 'a', { card: shieldUid(s) }).error).toBe('The game is over');
    // a card of somebody else cannot be played
    const theirs = edit(s, (c) => { P(c, 'b').hand = [card('shield')]; });
    bad(theirs, 'a', { card: P(theirs, 'b').hand[0].uid }, 'You do not hold that card');
  });

  it('Swap Tiles: a target is required and must be an active, unstuck rival on another tile; your own pawn must be free', () => {
    const s = edit(base(), (c) => { P(c, 'b').pos = 10; P(c, 'c').pos = 15; });
    const sw = swapUid(s);
    expect(err(s, 'a', { card: sw, target: 'b' }).error).toBeUndefined();
    expect(err(s, 'a', { card: sw, target: 'a' }).error).toBe('Pick an active rival to swap with');
    expect(err(s, 'a', { card: sw, target: 'zz' }).error).toBe('Pick an active rival to swap with');
    const gone = edit(s, (c) => { P(c, 'b').bankrupt = true; });
    expect(err(gone, 'a', { card: sw, target: 'b' }).error).toBe('Pick an active rival to swap with');
    const jammed = edit(s, (c) => { P(c, 'b').stuck = true; });
    expect(err(jammed, 'a', { card: sw, target: 'b' }).error).toBe('B is stuck in traffic');
    expect(err(jammed, 'a', { card: sw, target: 'c' }).error).toBeUndefined();
    const meJammed = edit(s, (c) => { P(c, 'a').stuck = true; });
    expect(err(meJammed, 'a', { card: sw, target: 'b' }).error).toBe('You are stuck in traffic');
    const same = edit(s, (c) => { P(c, 'b').pos = 0; });
    expect(err(same, 'a', { card: sw, target: 'b' }).error).toBe('You are already on the same tile as B');
  });

  it('Steal a Roll cannot be played while stuck in traffic (the roll would only wait the jam out) or on top of an extra roll', () => {
    const s = setup(mk(3), 'a', ['steal']);
    const uid = P(s, 'a').hand[0].uid;
    expect(err(edit(s, (c) => { P(c, 'a').stuck = true; }), 'a', { card: uid }).error).toBe('Get out of the traffic jam first');
    expect(err(edit(s, (c) => { c.extraRoll = true; }), 'a', { card: uid }).error).toBe('You already have an extra roll');
  });
});

describe('getOptions(...).power', () => {
  it('lists the viewer\'s hand with ok / reason / targets for the turn player', () => {
    const s = edit(setup(mk(3), 'a', ['shield', 'swap', 'steal']), (c) => { P(c, 'b').pos = 10; P(c, 'c').pos = 15; P(c, 'a').hand.pop(); });
    const o = getOptions(s, 'a').power;
    expect(o.canPlay).toBe(true);
    expect(o).not.toHaveProperty('reason');
    expect(o.cards).toEqual([
      { uid: P(s, 'a').hand[0].uid, id: 'shield', exp: 99, ok: true },
      { uid: P(s, 'a').hand[1].uid, id: 'swap', exp: 99, ok: true, targets: ['b', 'c'] },
    ]);
  });

  it('gives every blocked state its user-facing reason', () => {
    const s = setup(mk(3), 'a', ['shield']);
    const reason = (state, who) => getOptions(state, who).power;
    // not your turn: the viewer still sees their own cards, disabled
    const theirs = edit(s, (c) => { P(c, 'b').hand = [card('double')]; });
    expect(reason(theirs, 'b')).toMatchObject({ canPlay: false, reason: 'Not your turn', cards: [{ id: 'double', ok: false, reason: 'Not your turn' }] });
    // nothing in the hand
    expect(reason(s, 'c')).toEqual({ canPlay: false, reason: 'Not your turn', cards: [] });
    expect(reason(edit(s, (c) => { P(c, 'a').hand = []; }), 'a')).toEqual({ canPlay: false, reason: 'You hold no power cards', cards: [] });
    // already played, rolled, debt, trade
    const played = ok(play(s, 'a', 'shield')).state;
    expect(reason(edit(played, (c) => { P(c, 'a').hand = [card('double')]; }), 'a')).toMatchObject({ canPlay: false, reason: 'Already played a card this turn' });
    expect(reason(roll(s, 'a', 1).state, 'a')).toMatchObject({ canPlay: false, reason: 'Play a card before you roll' });
    expect(reason(edit(s, (c) => { c.phase = 'debt'; c.debt = { player: 'a', amount: 1, creditor: null, reason: 'tax', returnPhase: 'roll', rest: [] }; }), 'a').reason).toBe('Settle the debt first');
    expect(reason(edit(s, (c) => { c.trade = { id: 1, from: 'b', to: 'c', give: { cash: 1, tiles: [] }, get: { cash: 0, tiles: [] } }; }), 'a').reason).toBe('Answer the trade offer first');
    // a swap with nobody to swap with
    const lone = edit(setup(mk(3), 'a', ['swap'], 0), (c) => { P(c, 'b').stuck = true; P(c, 'c').bankrupt = true; });
    expect(reason(lone, 'a')).toEqual({
      canPlay: false, reason: 'No rival can swap right now', cards: [{ uid: P(lone, 'a').hand[0].uid, id: 'swap', exp: 99, ok: false, targets: [], reason: 'No rival can swap right now' }],
    });
  });

  it('is absent with the rule off', () => {
    expect(getOptions(createGame({ players: [{ id: 'a' }, { id: 'b' }], seed: 1 }), 'a')).not.toHaveProperty('power');
  });
});

// ---------------------------------------------------------------- the four cards
describe('Shield', () => {
  const owned = (s) => edit(s, (c) => { c.owners[TILE] = 'a'; });
  it('arms for three rounds; the next rent is waived in full and the shield is consumed', () => {
    let s = setup(owned(mk(3)), 'b', ['shield']);
    s = ok(play(s, 'b', 'shield')).state;
    expect(P(s, 'b').shield).toBe(s.round + POWER.ARMED_ROUNDS);
    const bill = previewRent(s, TILE);
    expect(bill).toBeGreaterThan(0);
    const r = roll(s, 'b', TILE);
    expect(ofType(r.events, 'power_trigger')).toEqual([{ type: 'power_trigger', player: 'b', card: 'shield', amount: bill, other: 'a' }]);
    expect(ofType(r.events, 'cash')).toHaveLength(0);
    expect(P(r.state, 'b').cash).toBe(P(s, 'b').cash);
    expect(P(r.state, 'a').cash).toBe(P(s, 'a').cash);
    expect(P(r.state, 'b').shield).toBe(0);
    expect(P(r.state, 'b').stats.rentPaid).toBe(0);
    // the next rent is paid normally
    const again = roll(edit(r.state, (c) => { c.phase = 'roll'; c.extraRoll = false; c.players[1].pos = 0; }), 'b', TILE);
    expect(ofType(again.events, 'power_trigger')).toHaveLength(0);
    expect(P(again.state, 'b').cash).toBe(P(s, 'b').cash - bill);
  });

  it('waives the municipal tax too (no counterparty), and is spent before chai: the chai stays', () => {
    const s = edit(setup(mk(3), 'b', [], MUNICIPAL - 1), (c) => { c.players[1].shield = c.round + 1; c.players[1].chai = 1; });
    const due = municipalDue(s, 'b');
    const r = roll(s, 'b', 1);
    expect(ofType(r.events, 'power_trigger')).toEqual([{ type: 'power_trigger', player: 'b', card: 'shield', amount: due }]);
    expect(P(r.state, 'b').cash).toBe(P(s, 'b').cash);
    expect(P(r.state, 'b').stats.taxPaid).toBe(0);
    const rent = edit(owned(s), (c) => { c.players[1].pos = 0; c.owners[TILE] = 'a'; c.levels[TILE] = 3; });
    const big = roll(rent, 'b', TILE);
    expect(P(big.state, 'b').chai).toBe(1); // waived rent: the chai was not needed
    expect(ofType(big.events, 'chai')).toHaveLength(0);
  });

  it('never blocks card cash or the city-event payment', () => {
    const idx = DRAMA_CARDS.findIndex((c) => c.id === 'shaadi_season'); // Pay Rs 50,000 to the bank
    const tile = TILES.findIndex((t) => t.type === 'card' && t.deck === 'drama');
    const s = edit(setup(mk(3), 'b', [], tile - 1), (c) => { c.players[1].shield = c.round + 1; c.deck.drama = [idx]; c.deckPos.drama = 0; });
    const r = roll(s, 'b', 1);
    expect(ofType(r.events, 'cash').some((e) => e.reason === 'card' && e.delta === -50000)).toBe(true);
    expect(ofType(r.events, 'power_trigger')).toHaveLength(0);
    expect(P(r.state, 'b').shield).toBeGreaterThan(0);
    expect(P(r.state, 'b').cash).toBeLessThan(P(s, 'b').cash);
  });

  it('lapses silently once its round has passed', () => {
    let s = edit(mk(3), (c) => { c.players[1].shield = c.round + 1; c.players[0].doubleRent = c.round + 1; });
    const events = [];
    for (let k = 0; k < 9; k++) {
      const cur = s.players[s.turn];
      const r = act(edit(s, (c) => { c.phase = 'manage'; }), cur.id, { type: 'END_TURN' });
      events.push(...r.events);
      s = r.state;
    }
    expect(s.round).toBeGreaterThan(3);
    expect(P(s, 'b').shield).toBe(0);
    expect(P(s, 'a').doubleRent).toBe(0);
    expect(ofType(events, 'power_expire')).toHaveLength(0); // armed effects lapse without an event
  });
});

describe('Double Rent', () => {
  const owned = (s) => edit(s, (c) => { c.owners[TILE] = 'a'; c.owners[3] = 'a'; });
  it('doubles the next rent the owner collects INSIDE the rent computation (preview, payment and trigger agree), then is spent', () => {
    let s = setup(owned(mk(3)), 'a', ['double']);
    const normal = previewRent(s, TILE);
    s = ok(play(s, 'a', 'double')).state;
    expect(P(s, 'a').doubleRent).toBe(s.round + POWER.ARMED_ROUNDS);
    expect(previewRent(s, TILE)).toBe(2 * normal);
    expect(previewRent(s, 3)).toBe(2 * previewRent(edit(s, (c) => { P(c, 'a').doubleRent = 0; }), 3));
    // the owner passes the turn (END_TURN); b lands on the district
    const b = edit(s, (c) => { c.turn = 1; c.phase = 'roll'; c.players[1].pos = 0; c.powerPlayed = false; });
    const r = roll(b, 'b', TILE);
    expect(ofType(r.events, 'cash').filter((e) => e.reason === 'rent' && e.player === 'b')).toEqual([{ type: 'cash', player: 'b', delta: -2 * normal, reason: 'rent', other: 'a' }]);
    expect(ofType(r.events, 'power_trigger')).toEqual([{ type: 'power_trigger', player: 'a', card: 'double', amount: normal, other: 'b' }]);
    expect(P(r.state, 'a').doubleRent).toBe(0);
    expect(previewRent(r.state, TILE)).toBe(normal);
    // spent: the next rent is the normal one
    const c2 = edit(r.state, (c) => { c.turn = 2; c.phase = 'roll'; c.players[2].pos = 0; });
    const r2 = roll(c2, 'c', TILE);
    expect(P(r2.state, 'c').cash).toBe(P(c2, 'c').cash - normal);
    expect(ofType(r2.events, 'power_trigger')).toHaveLength(0);
  });

  it('is not spent by a rent that is waived by a Shield: the Shield wins and the Double Rent stays armed', () => {
    let s = setup(owned(mk(3)), 'a', ['double']);
    s = ok(play(s, 'a', 'double')).state;
    const b = edit(s, (c) => { c.turn = 1; c.phase = 'roll'; c.players[1].pos = 0; c.players[1].shield = c.round + 2; c.powerPlayed = false; });
    const bill = previewRent(b, TILE);
    const r = roll(b, 'b', TILE);
    expect(ofType(r.events, 'power_trigger')).toEqual([{ type: 'power_trigger', player: 'b', card: 'shield', amount: bill, other: 'a' }]);
    expect(P(r.state, 'b').shield).toBe(0);
    expect(P(r.state, 'a').doubleRent).toBe(P(b, 'a').doubleRent); // still armed
    expect(P(r.state, 'b').cash).toBe(P(b, 'b').cash);
  });

  it('with a chai the doubled rent is halved as any rent, and the card is still spent', () => {
    let s = setup(owned(mk(3)), 'a', ['double']);
    s = ok(play(s, 'a', 'double')).state;
    const b = edit(s, (c) => { c.turn = 1; c.phase = 'roll'; c.players[1].pos = 0; c.players[1].chai = 1; c.powerPlayed = false; c.levels[TILE] = 3; });
    const bill = previewRent(b, TILE);
    const r = roll(b, 'b', TILE);
    expect(P(r.state, 'b').cash).toBe(P(b, 'b').cash - (bill - Math.floor(bill / 2)));
    expect(P(r.state, 'a').doubleRent).toBe(0);
    expect(ofType(r.events, 'power_trigger')[0]).toMatchObject({ card: 'double', player: 'a' });
  });

  it('a doubled rent that sends the payer into debt is still spent and the debt is the doubled amount', () => {
    let s = setup(owned(mk(3)), 'a', ['double']);
    s = ok(play(s, 'a', 'double')).state;
    const b = edit(s, (c) => { c.turn = 1; c.phase = 'roll'; c.players[1].pos = 0; c.players[1].cash = 1000; c.owners[10] = 'b'; c.powerPlayed = false; });
    const bill = previewRent(b, TILE);
    const r = roll(b, 'b', TILE);
    expect(r.state.phase).toBe('debt');
    expect(r.state.debt.amount).toBe(bill);
    expect(P(r.state, 'a').doubleRent).toBe(0);
  });
});

describe('Steal a Roll', () => {
  it('sets the extra roll like a six without a dice event, keeps it through a non-six roll and spends it exactly once', () => {
    let s = setup(mk(3), 'a', ['steal']);
    const played = ok(play(s, 'a', 'steal'));
    expect(played.events.map((e) => e.type)).toEqual(['power_play']);
    s = played.state;
    expect(s.extraRoll).toBe(true);
    expect(s.phase).toBe('roll');
    expect(getOptions(s, 'a').roll).toBe(true);
    const first = roll(s, 'a', 2);
    expect(first.state.extraRoll).toBe(true); // the first roll did not clear it
    expect(first.state.phase).toBe('manage');
    expect(getOptions(first.state, 'a')).toMatchObject({ roll: true, endTurn: false });
    expect(applyAction(first.state, { type: 'END_TURN', playerId: 'a' }).error).toBe('You rolled a six. Roll again');
    const second = roll(edit(first.state, (c) => { c.phase = 'manage'; c.pending = null; }), 'a', 1);
    expect(second.state.extraRoll).toBe(false); // spent
    const done = edit(second.state, (c) => { c.phase = 'manage'; c.pending = null; });
    expect(applyAction(done, { type: 'ROLL', playerId: 'a' }).error).toBe('You already rolled. End your turn');
    expect(applyAction(done, { type: 'END_TURN', playerId: 'a' }).error).toBeUndefined();
    expect(ofType([...first.events, ...second.events], 'dice')).toHaveLength(2); // exactly two rolls, not three
  });

  it('together with a six on the first roll there is still just the one extra roll (the six and the card coincide)', () => {
    let s = setup(mk(3), 'a', ['steal']);
    s = ok(play(s, 'a', 'steal')).state;
    const first = roll(s, 'a', 6);
    expect(first.state.extraRoll).toBe(true);
    const second = roll(edit(first.state, (c) => { c.phase = 'manage'; c.pending = null; }), 'a', 1);
    expect(second.state.extraRoll).toBe(false);
  });

  it('is lost like a six when the first roll lands in the Traffic Jam, and ends with the turn', () => {
    const jam = TILES.findIndex((t) => t.type === 'traffic');
    let s = setup(mk(3), 'a', ['steal'], jam - 1);
    s = ok(play(s, 'a', 'steal')).state;
    const r = roll(s, 'a', 1);
    expect(P(r.state, 'a').stuck).toBe(true);
    expect(r.state.extraRoll).toBe(false);
    expect(r.state.turn).toBe(1);
  });

  it('does not leak into the next turn if the turn ends some other way', () => {
    let s = setup(mk(3), 'a', ['steal']);
    s = ok(play(s, 'a', 'steal')).state;
    const out = act(s, 'a', { type: 'RESIGN' }).state; // leaving the game ends the turn
    expect(out.extraRoll).toBe(false);
  });
});

describe('Swap Tiles', () => {
  it('exchanges the two pawns with two teleports: no landing, no salary, no passedStart; the swapper still rolls', () => {
    let s = edit(setup(mk(3), 'a', ['swap'], 30), (c) => { P(c, 'b').pos = 4; });
    const r = ok(play(s, 'a', 'swap', 'b'));
    expect(r.events).toEqual([
      { type: 'power_play', player: 'a', card: 'swap', target: 'b' },
      { type: 'move', player: 'a', from: 30, to: 4, path: [4], passedStart: false, teleport: true },
      { type: 'move', player: 'b', from: 4, to: 30, path: [30], passedStart: false, teleport: true },
    ]);
    expect(P(r.state, 'a').pos).toBe(4);
    expect(P(r.state, 'b').pos).toBe(30);
    expect(ofType(r.events, 'land')).toHaveLength(0);
    expect(ofType(r.events, 'cash')).toHaveLength(0);
    expect(P(r.state, 'a').laps).toBe(P(s, 'a').laps);
    expect(r.state.phase).toBe('roll');
    expect(getOptions(r.state, 'a').roll).toBe(true);
    s = roll(r.state, 'a', 1).state;
    expect(P(s, 'a').pos).toBe(5);
  });
});

// ---------------------------------------------------------------- expiry, bankruptcy, privacy
describe('expiry', () => {
  it('removes expired cards at the start of the round (count only), keeps the live ones', () => {
    let s = edit(mk(3), (c) => {
      c.players[1].hand = [card('shield', 1), card('double', 1)];
      c.players[2].hand = [card('swap', 1), card('steal', 2)];
      c.players[0].hand = [card('swap', 5)];
    });
    expect(s.round).toBe(1);
    const events = [];
    while (s.round < 2) {
      const cur = s.players[s.turn];
      const r = act(edit(s, (c) => { c.phase = 'manage'; }), cur.id, { type: 'END_TURN' });
      events.push(...r.events);
      s = r.state;
    }
    // round 2 began: cards with exp 1 are gone, exp 2 stays
    expect(P(s, 'b').hand).toEqual([]);
    expect(P(s, 'c').hand.map((c) => c.id)).toEqual(['steal']);
    expect(P(s, 'a').hand.map((c) => c.id)).toEqual(['swap']);
    expect(ofType(events, 'power_expire')).toEqual([
      { type: 'power_expire', player: 'b', count: 2 },
      { type: 'power_expire', player: 'c', count: 1 },
    ]);
    // a card is playable through its last round and gone the round after (exp = drawn round + 3)
    const drawn = roll(setup(mk(3), 'a', []), 'a', CARD_TILE).state;
    expect(P(drawn, 'a').hand[0].exp).toBe(1 + POWER.LIFE_ROUNDS);
  });

  it('a card drawn in round r lives through round r + 3 and expires when round r + 4 begins', () => {
    const mine = card('shield', 1 + POWER.LIFE_ROUNDS);
    let s = edit(mk(2), (c) => { c.players[0].hand = [mine]; });
    const seen = {};
    for (let k = 0; k < 40 && s.round < 6; k++) {
      const cur = s.players[s.turn];
      s = edit(s, (c) => { c.phase = 'manage'; });
      const r = act(s, cur.id, { type: 'END_TURN' });
      s = r.state;
      seen[s.round] = P(s, 'a').hand.filter((c) => c.uid === mine.uid).length;
    }
    expect(seen[4]).toBe(1); // still there in round 4 (= 1 + 3)
    expect(seen[5]).toBe(0); // gone when round 5 begins
  });
});

describe('bankruptcy, resigning and winning', () => {
  it('a player who goes out loses their cards and armed effects; the game can still be won', () => {
    let s = edit(mk(2), (c) => {
      c.players[1].hand = [card('shield'), card('swap')];
      c.players[1].shield = 9;
      c.players[1].doubleRent = 9;
    });
    const r = act(s, 'b', { type: 'RESIGN' });
    expect(P(r.state, 'b')).toMatchObject({ bankrupt: true, hand: [], shield: 0, doubleRent: 0 });
    expect(r.state.phase).toBe('over'); // nothing blocks checkWin
    expect(r.state.winner).toBe('a');
    // a bankruptcy by rent
    s = edit(setup(mk(3), 'b', [], 0), (c) => {
      c.owners[TILE] = 'a';
      c.levels[TILE] = 3;
      P(c, 'b').cash = 0;
      P(c, 'b').hand = [card('double')];
    });
    const broke = roll(s, 'b', TILE);
    expect(P(broke.state, 'b').bankrupt).toBe(true);
    expect(P(broke.state, 'b').hand).toEqual([]);
  });

  it('adds no phase and no pending type', () => {
    const s = setup(mk(3), 'a', ['shield', 'swap']);
    const r = ok(play(s, 'a', 'shield'));
    expect(r.state.phase).toBe('roll');
    expect(r.state.pending).toBeNull();
  });
});

describe('privacy of the public event stream', () => {
  it('power_draw and power_expire never name a card; no event carries an unplayed card\'s uid', () => {
    for (const seed of [2, 5, 13]) {
      const { events, s } = playOut({ powerCards: true }, { n: 4, seed });
      const draws = ofType(events, 'power_draw');
      const expires = ofType(events, 'power_expire');
      expect(draws.length).toBeGreaterThan(5);
      for (const d of draws) expect(Object.keys(d).sort()).toEqual(d.source === 'tile' ? ['player', 'source', 'tile', 'type'] : ['player', 'source', 'type']);
      for (const e of expires) expect(Object.keys(e).sort()).toEqual(['count', 'player', 'type']);
      const text = JSON.stringify(events);
      for (const p of s.players) for (const c of p.hand) expect(text).not.toContain(c.uid);
      // a played card is public by design: power_play names the card id, never the uid
      for (const e of ofType(events, 'power_play')) expect(Object.keys(e).sort()).toEqual(e.card === 'swap' ? ['card', 'player', 'target', 'type'] : ['card', 'player', 'type']);
    }
  });

  it('bots play cards and every trigger is consistent with the money that moved', () => {
    let triggers = 0;
    for (const seed of [4, 9, 17, 31]) {
      const { events } = playOut({ powerCards: true }, { n: 4, seed });
      const plays = ofType(events, 'power_play');
      expect(plays.length).toBeGreaterThan(0);
      for (const t of ofType(events, 'power_trigger')) {
        triggers++;
        expect(['shield', 'double']).toContain(t.card);
        expect(t.amount).toBeGreaterThan(0);
      }
    }
    expect(triggers).toBeGreaterThan(0);
    // power cards do not change net worth by themselves
    const s = mk(3);
    expect(netWorth(edit(s, (c) => { P(c, 'a').hand = [card('shield')]; }), 'a')).toBe(netWorth(s, 'a'));
  });
});

describe('variety: the table is not dealt the same card', () => {
  // pickPowerId(state, player) is a weighted pick with one draw on the Power stream; holdings only reweight it.
  const share = (s, p, id, n = 4000) => {
    let hit = 0;
    for (let i = 0; i < n; i++) {
      const c = structuredClone(s);
      c.prng = (i * 2654435761 + 12345) >>> 0;
      if (pickPowerId(c, p === 'none' ? undefined : P(c, p)) === id) hit++;
    }
    return hit / n;
  };

  it('with nothing held, shield comes up at about its weight (30%)', () => {
    const s = mk(3);
    expect(share(s, 'a', 'shield')).toBeGreaterThan(0.26);
    expect(share(s, 'a', 'shield')).toBeLessThan(0.34);
  });

  it('a type a rival already holds is dealt less often', () => {
    const base = mk(3);
    const s = edit(base, (c) => { P(c, 'b').hand = [card('shield')]; });
    expect(share(s, 'a', 'shield')).toBeLessThan(0.2); // 30% -> about 16%
    expect(share(s, 'a', 'double')).toBeGreaterThan(share(base, 'a', 'double')); // the others gain
  });

  it('a type you already hold is dealt much less often, but never made impossible', () => {
    const s = edit(mk(3), (c) => { P(c, 'a').hand = [card('shield')]; });
    const f = share(s, 'a', 'shield');
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(0.12);
  });

  it('bankrupt players do not count, and the pick stays deterministic', () => {
    const s = edit(mk(3), (c) => { P(c, 'b').hand = [card('shield')]; P(c, 'b').bankrupt = true; });
    expect(share(s, 'a', 'shield')).toBeGreaterThan(0.26);
    const a = edit(mk(3), (c) => { c.prng = 5; });
    const b = edit(mk(3), (c) => { c.prng = 5; });
    expect(pickPowerId(a, P(a, 'a'))).toBe(pickPowerId(b, P(b, 'a')));
  });

  it('over whole bot games two players rarely hold the same card at once', () => {
    let both = 0;
    let same = 0;
    for (let g = 0; g < 16; g++) {
      const players = ['p0', 'p1', 'p2', 'p3'].map((id) => ({ id, name: id, isBot: true, bot: {} }));
      let s = createGame({ players, settings: { powerCards: true }, seed: 9000 + g });
      const rnd = mulberry32(g * 31 + 7);
      for (let i = 0; i < 20000 && s.phase !== 'over'; i++) {
        const a = s.phase === 'snatch' ? { type: 'SNATCH_CLOSE' } : nextBotMove(s, rnd);
        const r = applyAction(s, a);
        expect(r.error).toBeUndefined();
        s = r.state;
        if (!r.events.some((e) => e.type === 'power_draw')) continue;
        const held = s.players.filter((p) => !p.bankrupt && p.hand && p.hand.length).map((p) => p.hand.map((c) => c.id));
        if (held.length < 2) continue;
        both++;
        const flat = held.flat();
        if (new Set(flat).size < flat.length) same++;
      }
    }
    expect(both).toBeGreaterThan(60);
    expect(same / both).toBeLessThan(0.5); // before the variety weights this was well above that
  });
});
