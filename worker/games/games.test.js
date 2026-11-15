import { describe, it, expect } from 'vitest';
import { GAME_ADAPTERS, getAdapter, listGames, missingFromAdapter, DEFAULT_GAME_ID } from './index.js';
import tycoon, { ID, TRADE_MS, pendingActors, estimateAnimMs, autoMove, isCurrentBoard } from './hyderabad-tycoon.js';
import { sanitizeSettings, normalizeSettings, ROOM_DEFAULTS } from '../settings.js';
import { maskStateFor } from '../mask.js';
import { ANIM_MS, MAX_ANIM_MS, LONG_TRIP } from '../../shared/timing.js';
import * as engine from '../../shared/index.js';

describe('registry', () => {
  it('knows Kingpin and nothing else by default', () => {
    expect(DEFAULT_GAME_ID).toBe('hyderabad-tycoon');
    expect(getAdapter('hyderabad-tycoon')).toBe(tycoon);
    expect(Object.keys(GAME_ADAPTERS)).toEqual(['hyderabad-tycoon']);
  });

  it('getAdapter returns null for anything unknown (no prototype leaks)', () => {
    for (const bad of ['', 'ludo', 'Hyderabad-Tycoon', '__proto__', 'constructor', 'toString', 'hasOwnProperty', null, undefined, 5, {}, []]) {
      expect(getAdapter(bad), String(bad)).toBeNull();
    }
  });

  it('listGames is the public, function-free description', () => {
    expect(listGames()).toEqual([{ id: 'hyderabad-tycoon', name: 'Kingpin', minPlayers: 2, maxPlayers: 6 }]);
  });

  it('the Tycoon adapter implements the required interface and lists the pieces', () => {
    expect(missingFromAdapter(tycoon)).toEqual([]);
    expect(tycoon.id).toBe(ID);
    expect(tycoon.pieces).toEqual(['pearl', 'auto', 'handi', 'chai', 'bat', 'camera']);
  });
});

describe('Tycoon adapter: settings', () => {
  const inputs = [
    undefined, null, {}, { mode: 'quick', dice: 'fair', auctionOnDecline: false }, { mode: 'classic' }, { mode: 'turbo' },
    { targetWorth: 3000000 }, { targetWorth: null }, { mode: 'classic', targetWorth: null }, { targetWorth: 'rich' }, { mode: 'quick', targetWorth: 10000000 },
    { mode: 5 }, { dice: 'loaded' }, { auctionOnDecline: 'yes' }, { goal: 70000, maxRounds: 50, snatches: 2 },
    { debug: true, seed: 5, startCash: 99999 }, { maxPlayers: 3, mode: 'quick' }, { maxPlayers: 9 }, [], 'mode', 42,
  ];

  it('same verdict, same first error, normalised settings on success', () => {
    for (const raw of inputs) {
      const legacy = sanitizeSettings(raw);
      const v = tycoon.validateSettings(raw);
      expect(v.ok, JSON.stringify(raw)).toBe(legacy.errors.length === 0);
      if (v.ok) expect(v.settings).toEqual(normalizeSettings(legacy.settings));
      else expect(v.error).toBe(legacy.errors[0]);
    }
  });

  it('fills defaults and drops unknown keys (the old goal key too); every host rule is part of the defaults', () => {
    expect(tycoon.validateSettings({ goal: 50000, debug: true, seed: 3 })).toEqual({ ok: true, settings: ROOM_DEFAULTS });
    expect(tycoon.defaultSettings).toEqual(ROOM_DEFAULTS);
    expect(tycoon.defaultSettings).toEqual({ mode: 'standard', ...engine.ruleDefaults('standard') });
    expect(Object.keys(tycoon.defaultSettings)).toHaveLength(17); // mode + the 16 rules of shared/ruleSettings.js
    expect(tycoon.validateSettings({ snatches: 3, rentPercent: 150 }).settings).toMatchObject({ snatches: 3, rentPercent: 150 });
    expect(tycoon.validateSettings({ rentPercent: 7 })).toEqual({ ok: false, error: 'Rent level must be one of 50, 75, 100, 125, 150, 200.' });
  });

  it('the lobby shows every rule exactly as the game will run it (also for rooms stored before the rules existed)', () => {
    const old = { mode: 'quick', dice: 'fair', auctionOnDecline: false, targetWorth: 4000000 };
    expect(tycoon.lobbySettings(old)).toEqual({ ...engine.ruleDefaults('quick'), mode: 'quick', dice: 'fair', targetWorth: 4000000 }); // the retired auctionOnDecline is dropped
    const custom = tycoon.validateSettings({ startCash: 3000000, turnSeconds: 15, requireFullSet: false, eventEvery: 0 }).settings;
    const state = tycoon.createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], settings: custom, seed: 2 });
    expect(state.cfg).toMatchObject({ startCash: 3000000, turnSeconds: 15, requireFullSet: false, eventEvery: 0 });
    expect(state.players[0].cash).toBe(3000000);
  });

  it('customRules counts the rules that differ from the stock rules of the mode (open tables say "Custom rules")', () => {
    expect(tycoon.customRules(ROOM_DEFAULTS)).toBe(0);
    expect(tycoon.customRules({})).toBe(0);
    expect(tycoon.customRules({ mode: 'quick' })).toBe(0);
    expect(tycoon.customRules({ mode: 'quick', startCash: 2000000, maxRounds: 12 })).toBe(0);
    expect(tycoon.customRules({ mode: 'standard', startCash: 2000000 })).toBe(1);
    expect(tycoon.customRules({ rentPercent: 150, turnSeconds: 30, requireFullSet: false, bogus: 1 })).toBe(3);
    expect(tycoon.customRules(null)).toBe(0);
  });

  it('the win target: validated against the list, never off without a round limit, and part of the summary', () => {
    const ok = (raw) => tycoon.validateSettings(raw).settings.targetWorth;
    expect(ok({})).toBe(5000000);
    expect(ok({ targetWorth: 2500000 })).toBe(2500000);
    expect(ok({ targetWorth: null })).toBeNull();
    expect(ok({ targetWorth: 99 })).toBe(5000000);
    expect(ok({ mode: 'classic' })).toBe(3000000);
    expect(ok({ mode: 'classic', targetWorth: null })).toBe(3000000);
    expect(ok({ mode: 'classic', targetWorth: 'x' })).toBe(3000000);
    expect(ok({ mode: 'classic', targetWorth: 7500000 })).toBe(7500000);
    expect(tycoon.validateSettings({ targetWorth: 99 }).ok).toBe(true); // sanitised, not an error
    // a patch: another mode resets the target unless the patch also changes it
    const cur = { mode: 'standard', dice: 'lucky', targetWorth: 4000000 };
    expect(tycoon.mergeSettings(cur, { mode: 'classic', targetWorth: 4000000 }).targetWorth).toBeUndefined();
    expect(tycoon.mergeSettings(cur, { mode: 'classic', targetWorth: 7500000 }).targetWorth).toBe(7500000);
    expect(tycoon.mergeSettings(cur, { dice: 'fair' }).targetWorth).toBe(4000000);
    expect(tycoon.mergeSettings(cur, { mode: 'standard', targetWorth: 4000000 }).targetWorth).toBe(4000000);
    // the lobby shows what the engine runs with, including cfg.targetWorth
    expect(tycoon.lobbySettings({ mode: 'classic' }).targetWorth).toBe(3000000);
    expect(tycoon.lobbySettings({ targetWorth: null }).targetWorth).toBeNull();
  });

  it('lobbySettings is exactly what createGame runs with', () => {
    for (const mode of ['standard', 'quick', 'classic']) {
      const settings = tycoon.validateSettings({ mode, dice: 'fair' }).settings;
      const state = tycoon.createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], settings, seed: 7 });
      expect(tycoon.lobbySettings(settings)).toEqual(state.cfg);
    }
  });

  it('summarize is one short line per mode', () => {
    expect(tycoon.summarize(ROOM_DEFAULTS)).toBe('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
    expect(tycoon.summarize({ mode: 'quick', targetWorth: null })).toBe('Quick Chai Break · 12 rounds · richest wins');
    expect(tycoon.summarize({ mode: 'quick' })).toBe('Quick Chai Break · 12 rounds · richest wins · ₹50L target');
    expect(tycoon.summarize({ mode: 'classic' })).toBe('Classic Long Game · first to ₹30L wins');
    expect(tycoon.summarize({ mode: 'classic', targetWorth: 2500000 })).toBe('Classic Long Game · first to ₹25L wins');
  });

  it('createGame passes the chosen pieces through', () => {
    const s = tycoon.createGame({ players: [{ id: 'a', piece: 'camera' }, { id: 'b' }, { id: 'c', piece: 'camera' }], settings: {}, seed: 1 });
    expect(s.players.map((p) => p.piece)).toEqual(['camera', 'pearl', 'auto']);
  });
});

const three = () => engine.createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], seed: 3 });

describe('Tycoon adapter: turn, idle and deadlines', () => {
  it('turnPlayerId is the turn player, the debtor during debt, the trade recipient during a trade', () => {
    const base = three();
    expect(tycoon.turnPlayerId(base)).toBe('a');
    expect(tycoon.turnPlayerId({ ...base, phase: 'debt', debt: { player: 'b', amount: 100, creditor: null, reason: 'tax' } })).toBe('b');
    expect(tycoon.turnPlayerId({ ...base, trade: { id: 7, from: 'a', to: 'b', give: { cash: 1, tiles: [] }, get: { cash: 0, tiles: [] } } })).toBe('b');
    expect(tycoon.turnPlayerId({ ...base, phase: 'over' })).toBeNull();
    expect(pendingActors(base)).toEqual(['a']);
  });

  it('pendingPlayerIds adds the offerer to a trade, everyone who has not bid to an auction', () => {
    const base = three();
    expect(tycoon.pendingPlayerIds({ ...base, trade: { id: 7, from: 'a', to: 'b', give: { cash: 1, tiles: [] }, get: { cash: 0, tiles: [] } } })).toEqual(['b', 'a']);
    expect(tycoon.pendingPlayerIds({ ...base, phase: 'auction', pending: { type: 'auction', tile: 1, minBid: 6000, bids: { b: 0 } } })).toEqual(['a', 'c']);
    expect(tycoon.pendingPlayerIds({ ...base, phase: 'over' })).toEqual([]);
  });

  it('turnMs is the decision time of the room: turnSeconds of the game config, 60 s for a game without it', () => {
    const base = three();
    expect(tycoon.turnMs(base)).toBe(60_000);
    expect(tycoon.turnMs({ ...base, cfg: { ...base.cfg, turnSeconds: 15 } })).toBe(15_000);
    expect(tycoon.turnMs({ ...base, cfg: { ...base.cfg, turnSeconds: 180 } })).toBe(180_000);
    const old = { ...base, cfg: { ...base.cfg } };
    delete old.cfg.turnSeconds;
    expect(tycoon.turnMs(old)).toBe(60_000);
    expect(tycoon.turnMs(null)).toBe(60_000);
    const custom = tycoon.createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], settings: { turnSeconds: 25 }, seed: 1 });
    expect(tycoon.turnMs(custom)).toBe(25_000);
  });

  it('the trade auto-reject follows tradeSeconds of the game config', () => {
    const base = three();
    const offer = (cfg) => ({ ...base, cfg: { ...base.cfg, ...cfg }, trade: { id: 4, from: 'a', to: 'b', give: { cash: 1, tiles: [] }, get: { cash: 0, tiles: [] } } });
    expect(tycoon.deadlines(offer({ tradeSeconds: 15 }))[0]).toMatchObject({ key: 'trade:4', afterMs: 15_000, action: { type: 'TRADE_REJECT', playerId: 'b' } });
    expect(tycoon.deadlines(offer({ tradeSeconds: 120 }))[0].afterMs).toBe(120_000);
    const old = offer({});
    delete old.cfg.tradeSeconds;
    expect(tycoon.deadlines(old)[0].afterMs).toBe(TRADE_MS);
  });

  it('deadlines: only the 45 s trade auto-reject (no snatch timers any more)', () => {
    const base = three();
    const offer = (to) => ({ ...base, trade: { id: 9, from: 'a', to, give: { cash: 1, tiles: [] }, get: { cash: 0, tiles: [] } } });
    expect(tycoon.deadlines(base)).toEqual([]);
    expect(tycoon.deadlines(offer('b'))).toEqual([{ key: 'trade:9', afterMs: TRADE_MS, playerId: 'b', action: { type: 'TRADE_REJECT', playerId: 'b' } }]);
    expect(TRADE_MS).toBe(45_000);
    const gone = offer('b');
    gone.players = gone.players.map((p) => (p.id === 'b' ? { ...p, bankrupt: true } : p));
    expect(tycoon.deadlines(gone)[0]).toMatchObject({ playerId: 'a', action: { type: 'TRADE_CANCEL', playerId: 'a' } });
  });

  it('idleAction: a trade is rejected / cancelled; otherwise the chooser plays (roll first)', () => {
    const base = three();
    const trade = { ...base, trade: { id: 1, from: 'a', to: 'b', give: { cash: 1, tiles: [] }, get: { cash: 0, tiles: [] } } };
    expect(tycoon.idleAction(trade, 'b')).toEqual({ type: 'TRADE_REJECT', playerId: 'b' });
    expect(tycoon.idleAction(trade, 'a')).toEqual({ type: 'TRADE_CANCEL', playerId: 'a' });
    expect(tycoon.idleAction(trade, 'c')).toBeNull();
    expect(tycoon.idleAction(base, 'a')).toMatchObject({ type: 'ROLL', playerId: 'a' });
    expect(tycoon.idleAction(base, 'b')).toBeNull();
  });

  it('idleAction never rides, and pays traffic only with comfortable cash', () => {
    const s = engine.createGame({ players: [{ id: 'a' }, { id: 'b' }], settings: { debug: true }, seed: 2 });
    const r = engine.applyAction(s, { type: 'ROLL', playerId: 'a', dice: [5] });
    expect(engine.getOptions(r.state, 'a').ride).toBeTruthy();
    for (let i = 0; i < 20; i++) expect(tycoon.idleAction(r.state, 'a').type).not.toBe('RIDE');
    const stuck = structuredClone(s);
    stuck.players[0].stuck = true;
    expect(tycoon.idleAction(stuck, 'a')).toEqual({ type: 'PAY_TRAFFIC', playerId: 'a' });
    stuck.players[0].cash = 100000;
    expect(tycoon.idleAction(stuck, 'a')).toEqual({ type: 'ROLL', playerId: 'a' }); // wait it out
  });

  it('autoMove always has an answer for an absent debtor', () => {
    const debtor = { ...three(), phase: 'debt', debt: { player: 'c', amount: 99999999, creditor: null, reason: 'tax' } };
    expect(autoMove(debtor, 'c').playerId).toBe('c');
  });

  it('applyAction passes the engine result through (illegal -> same state + error)', () => {
    const s = three();
    const bad = tycoon.applyAction(s, { type: 'BUY', playerId: 'a' });
    expect(bad.error).toBeTruthy();
    expect(bad.state).toBe(s);
    const ok = tycoon.applyAction(s, { type: 'ROLL', playerId: 'a' });
    expect(ok.error).toBeUndefined();
    expect(tycoon.isOver(s)).toBe(false);
    expect(tycoon.isOver({ ...s, phase: 'over' })).toBe(true);
  });
});

describe('Tycoon adapter: animation estimate (shared/timing.js)', () => {
  it('dice + steps, faster on long trips, capped', () => {
    expect(estimateAnimMs([{ type: 'dice' }, { type: 'move', path: [1, 2, 3] }])).toBe(ANIM_MS.dice + ANIM_MS.afterDice + 3 * ANIM_MS.step);
    const long = estimateAnimMs([{ type: 'move', path: new Array(24).fill(1) }]);
    expect(long).toBe(Math.round(ANIM_MS.step * LONG_TRIP));
    expect(estimateAnimMs(new Array(50).fill({ type: 'card' }))).toBe(MAX_ANIM_MS);
  });

  it('covers ride, chai, traffic, card, city event, auction, level, turn and win', () => {
    expect(estimateAnimMs([{ type: 'ride' }])).toBe(ANIM_MS.ride);
    expect(estimateAnimMs([{ type: 'chai' }])).toBe(ANIM_MS.chai);
    expect(estimateAnimMs([{ type: 'traffic', stuck: true }])).toBe(ANIM_MS.jail);
    expect(estimateAnimMs([{ type: 'traffic', stuck: false, reason: 'waited' }])).toBe(ANIM_MS.jailStay);
    expect(estimateAnimMs([{ type: 'traffic', stuck: false, reason: 'paid' }])).toBe(ANIM_MS.quiet);
    expect(estimateAnimMs([{ type: 'card' }])).toBe(ANIM_MS.card);
    expect(estimateAnimMs([{ type: 'city_event' }])).toBe(ANIM_MS.cityEvent);
    expect(estimateAnimMs([{ type: 'auction_start' }, { type: 'auction_end' }])).toBe(ANIM_MS.auctionStart + ANIM_MS.auctionEnd);
    expect(estimateAnimMs([{ type: 'level', reason: 'upgrade', level: 1 }])).toBe(ANIM_MS.level);
    expect(estimateAnimMs([{ type: 'win' }])).toBe(ANIM_MS.win);
    const s = three();
    expect(estimateAnimMs([{ type: 'turn', player: 'b', round: 1 }], s)).toBe(ANIM_MS.turn);
    expect(estimateAnimMs([{ type: 'turn', player: 'a', round: 2 }], s)).toBe(Math.max(ANIM_MS.round, ANIM_MS.turn));
    expect(estimateAnimMs([{ type: 'turn', player: 'a', round: 20 }], s)).toBe(ANIM_MS.finalRound);
    expect(estimateAnimMs([{ type: 'turn', player: 'b', round: 2 }])).toBe(Math.max(ANIM_MS.round, ANIM_MS.turn)); // no state: the longer pause
    expect(tycoon.moveDelayMs({ type: 'BID' })).toBeLessThan(tycoon.moveDelayMs({ type: 'ROLL' }));
  });
});

describe('Tycoon adapter: redact, results, stored rooms', () => {
  it('redact hides other players sealed bids and the server-only rng and decks', () => {
    const base = three();
    const view = tycoon.redact(base, 'a');
    expect(view.rng).toBe(0);
    expect(view.deck).toEqual([]);
    expect({ ...view, rng: base.rng, deck: base.deck }).toEqual(base);
    const auction = { ...base, phase: 'auction', pending: { type: 'auction', tile: 1, minBid: 6000, bids: { a: 30000, b: 12000 } } };
    expect(tycoon.redact(auction, 'a').pending.bids).toEqual({ a: 30000, b: 0 });
    expect(tycoon.redact(auction, 'a')).toEqual(maskStateFor(auction, 'a'));
  });

  it('track counts top-level upgrades; result ranks by net worth and the winner is rank 1', () => {
    const s = three();
    s.owners[1] = 'a';
    const meta = tycoon.track({}, [{ type: 'level', tile: 1, level: 2, reason: 'upgrade' }, { type: 'level', tile: 1, level: 1, reason: 'upgrade' }, { type: 'level', tile: 1, level: 2, reason: 'sell' }], s);
    expect(meta).toEqual({ hotels: { a: 1 } });
    const same = {};
    expect(tycoon.track(same, [{ type: 'cash' }], s)).toBe(same);

    s.players[1].stats.rentEarned = 123456;
    const over = { ...s, phase: 'over', winner: 'a', winReason: 'rounds', round: 21 };
    const res = tycoon.result(over, meta);
    expect(res).toMatchObject({ winnerId: 'a', reason: 'rounds', rounds: 20 });
    expect(res.standings[0]).toMatchObject({ id: 'a', rank: 1, score: 1560000, stats: { hotelsBuilt: 1 } });
    expect(res.standings.find((r) => r.id === 'b').stats.rentEarned).toBe(123456);
    expect(res.legacy).toEqual({ goal: null, maxRounds: 20, diceMode: 'lucky', mode: 'standard' });
    const classic = tycoon.result({ ...over, cfg: { ...over.cfg, maxRounds: null, mode: 'classic' }, round: 99 }, {});
    expect(classic.legacy.maxRounds).toBeNull();
    expect(classic.rounds).toBe(engine.ROUND_CAP);
  });

  it('result for a win by the net-worth target: reason target, the winner is rank 1, rounds are the round it ended in', () => {
    const s = three();
    s.cfg.targetWorth = 2500000;
    s.players[1].cash = 2600000; // b crosses the target during round 7
    s.round = 7;
    const r = engine.applyAction({ ...s, phase: 'manage', turn: 1 }, { type: 'END_TURN', playerId: 'b' });
    expect(r.state).toMatchObject({ phase: 'over', winner: 'b', winReason: 'target' });
    const res = tycoon.result(r.state, {});
    expect(res).toMatchObject({ winnerId: 'b', reason: 'target', rounds: 7 });
    expect(res.standings[0]).toMatchObject({ id: 'b', rank: 1 });
    expect(res.standings[0].score).toBeGreaterThanOrEqual(2500000);
    expect(res.standings.map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(res.legacy).toMatchObject({ maxRounds: 20, mode: 'standard' });
    expect(tycoon.isOver(r.state)).toBe(true);
    expect(tycoon.animationMs([{ type: 'win', player: 'b', reason: 'target', worth: 2600000 }])).toBeGreaterThan(0);
  });

  it('upgradeRecord moves old fields and calls off games stored with the old rules', () => {
    const old = { hotels: { a: 2 }, tradeId: 4, tradeAt: 12345, meta: {}, deadlines: {} };
    tycoon.upgradeRecord(old);
    expect(old).toEqual({ meta: { hotels: { a: 2 } }, deadlines: { 'trade:4': 12345 } });

    const live = three();
    expect(isCurrentBoard(live)).toBe(true);
    expect(isCurrentBoard({ owners: Array(40).fill(null), cfg: { goal: 70000 } })).toBe(false);
    expect(isCurrentBoard(null)).toBe(false);
    const keep = { status: 'playing', state: live, meta: {}, deadlines: {} };
    tycoon.upgradeRecord(keep);
    expect(keep).toMatchObject({ status: 'playing', state: live });

    const stale = { status: 'playing', state: { owners: Array(40).fill(null), cfg: { goal: 70000 } }, meta: {}, deadlines: { 'snatch:3:5': 1 } };
    tycoon.upgradeRecord(stale);
    expect(stale).toMatchObject({ status: 'finished', abandoned: true, state: null, deadlines: {} });
    const lobby = { status: 'lobby', state: null, meta: {}, deadlines: {}, settings: { goal: 70000, maxRounds: 50, dice: 'fair' } };
    tycoon.upgradeRecord(lobby);
    // the retired goal is dropped, a round limit from the list survives, everything else is the standard default
    expect(lobby).toMatchObject({ status: 'lobby', settings: { ...ROOM_DEFAULTS, maxRounds: 50, dice: 'fair' } });
    expect(lobby.settings).not.toHaveProperty('goal');
  });
});
