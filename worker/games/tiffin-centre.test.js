// Tiffin Centre server adapter (worker/games/tiffin-centre.js): the interface, strict settings, the client-action allow-list, a fuzz of
// the adapter over the real engine, the server tick driven through a REAL GameRoom (fake storage / sockets), result() and canHost.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const persisted = [];
vi.mock('../match.js', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    persistMatch: vi.fn(async (env, rec) => {
      if (persisted.some((r) => r.id === rec.id)) return { inserted: false };
      persisted.push(rec);
      return { inserted: true };
    }),
  };
});

vi.mock('../roomsdb.js', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, hasDb: () => false, upsertRoomRow: vi.fn(async () => {}), deleteRoomRow: vi.fn(async () => {}) };
});

const queryMock = vi.fn(async () => []);
vi.mock('../db.js', async (importOriginal) => ({ ...(await importOriginal()), query: (...a) => queryMock(...a) }));

const { GameRoom } = await import('../GameRoom.js');
const { GAME_ADAPTERS, getAdapter, missingFromAdapter, listGames } = await import('./index.js');
const { persistMatch, buildMatchRecord } = await import('../match.js');
const { default: tiffin, sanitizeAction, CAN_HOST_ERROR } = await import('./tiffin-centre.js');
const engine = await import('../../shared/tiffin-centre/index.js');
const { mulberry32 } = await import('../../shared/rng.js');
const { parseRoomInit, parseSettingsPatch } = await import('../roomrules.js');

const { TICK_MS, DEFAULT_SETTINGS, MAX_LEVEL, DISH_IDS, STATION_IDS } = engine;

const players = (n = 2) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, avatar: i }));
const fresh = (settings = {}, n = 2, seed = 7) => tiffin.createGame({ players: players(n), settings: { ...DEFAULT_SETTINGS, ...settings }, seed });

// ------------------------------------------------------------------------------------------------------------------ interface

describe('registry and interface', () => {
  it('is registered, conformant and lists in GET /api/games', () => {
    expect(getAdapter('tiffin-centre')).toBe(tiffin);
    expect(GAME_ADAPTERS['tiffin-centre']).toBe(tiffin);
    expect(missingFromAdapter(tiffin)).toEqual([]);
    expect(listGames()).toContainEqual({ id: 'tiffin-centre', name: 'Tiffin Centre', minPlayers: 2, maxPlayers: 4 });
    expect(tiffin).toMatchObject({ id: 'tiffin-centre', name: 'Tiffin Centre', minPlayers: 2, maxPlayers: 4, defaultMaxPlayers: 4, startAnimMs: 0 });
    expect(tiffin.defaultSettings).toEqual(DEFAULT_SETTINGS);
    expect(tiffin.defaultSettings).not.toBe(DEFAULT_SETTINGS); // a copy: nobody can mutate the catalogue through the adapter
    expect(typeof tiffin.canHost).toBe('function');
    expect(tiffin.pieces).toBeUndefined();
    expect(tiffin.pauseWhenEmpty).toBe(true);
  });

  it('resignAction: a seat that leaves releases what it holds (engine leave); unknown, prototype and already-gone seats have nothing to resign', () => {
    const s = fresh();
    expect(tiffin.resignAction(s, 'p1')).toEqual({ type: 'leave', playerId: 'p1' });
    for (const id of ['zed', '__proto__', 'constructor', '', undefined, null, 7]) expect(tiffin.resignAction(s, id)).toBeNull();
    expect(tiffin.resignAction(null, 'p1')).toBeNull();
    const gone = tiffin.applyAction(s, tiffin.resignAction(s, 'p1')).state;
    expect(gone.players.p1.left).toBe(true);
    expect(tiffin.resignAction(gone, 'p1')).toBeNull();
    // a client can never send it
    expect(sanitizeAction({ type: 'leave', playerId: 'p1' }, 'p1')).toBeNull();
  });

  it('nobody is on turn: no turn player, nothing pending, no idle move', () => {
    const s = fresh();
    expect(tiffin.turnPlayerId(s)).toBeNull();
    expect(tiffin.pendingPlayerIds(s)).toEqual([]);
    expect(tiffin.idleAction(s, 'p1')).toBeNull();
    expect(tiffin.redact(s, 'p1')).toBe(s);
  });
});

// ------------------------------------------------------------------------------------------------------------------ settings

describe('settings', () => {
  const ok = (raw, settings) => expect(tiffin.validateSettings(raw), JSON.stringify(raw)).toEqual({ ok: true, settings });
  const bad = (raw, re) => {
    const v = tiffin.validateSettings(raw);
    expect(v.ok, JSON.stringify(raw)).toBe(false);
    expect(v.error).toMatch(re);
  };

  it('accepts legal input and fills the defaults', () => {
    ok(undefined, { level: 1, pace: 'normal' });
    ok(null, { level: 1, pace: 'normal' });
    ok({}, { level: 1, pace: 'normal' });
    ok({ level: 5 }, { level: 5, pace: 'normal' });
    ok({ pace: 'rush' }, { level: 1, pace: 'rush' });
    ok({ level: MAX_LEVEL, pace: 'relaxed' }, { level: MAX_LEVEL, pace: 'relaxed' });
    for (let level = 1; level <= MAX_LEVEL; level++) expect(tiffin.validateSettings({ level }).ok).toBe(true);
  });

  it('drops unknown keys (they never reach the room)', () => {
    ok({ level: 2, pace: 'rush', debug: true, tutorial: true, seed: 5, maxPlayers: 3, __proto__: { level: 9 } }, { level: 2, pace: 'rush' });
    ok(JSON.parse('{"__proto__":{"level":12},"constructor":1,"level":3}'), { level: 3, pace: 'normal' });
  });

  it('refuses anything that is not a whole level 1..12 or a known pace (no coercion of strings)', () => {
    for (const level of [0, -1, 13, 99, 1.5, '3', '1', NaN, Infinity, -Infinity, null, true, [], {}, [3], 1e9, Number.MAX_SAFE_INTEGER + 1]) {
      bad({ level }, /Level must be a whole number from 1 to 12/);
    }
    for (const pace of ['hard', 'Rush', 'RUSH', '', ' rush', 'rush ', 0, null, true, [], {}, ['rush'], '__proto__', 'constructor']) {
      bad({ pace }, /Pace must be one of relaxed, normal, rush/);
    }
    for (const raw of [[], 'level', 7, true]) bad(raw, /Settings must be an object/);
  });

  it('is what parseRoomInit and a host patch run through (room creation and the lobby editor)', () => {
    const init = parseRoomInit({ gameId: 'tiffin-centre', settings: { level: 4, pace: 'rush', maxPlayers: 3 } });
    expect(init).toMatchObject({ ok: true, gameId: 'tiffin-centre', settings: { level: 4, pace: 'rush' }, maxPlayers: 3, visibility: 'private' });
    expect(parseRoomInit({ gameId: 'tiffin-centre' })).toMatchObject({ ok: true, settings: { level: 1, pace: 'normal' }, maxPlayers: 4 });
    expect(parseRoomInit({ gameId: 'tiffin-centre', maxPlayers: 1 }).ok).toBe(false);
    expect(parseRoomInit({ gameId: 'tiffin-centre', maxPlayers: 5 }).ok).toBe(false);
    expect(parseRoomInit({ gameId: 'tiffin-centre', settings: { level: 99 } })).toEqual({ ok: false, error: expect.stringMatching(/Level must be/) });
    const cur = { level: 3, pace: 'rush' };
    expect(parseSettingsPatch(tiffin, cur, { level: 6 })).toEqual({ ok: true, settings: { level: 6, pace: 'rush' } });
    expect(parseSettingsPatch(tiffin, cur, { pace: 'relaxed', maxPlayers: 2 })).toEqual({ ok: true, settings: { level: 3, pace: 'relaxed' }, maxPlayers: 2 });
    expect(parseSettingsPatch(tiffin, cur, { level: 0 }).ok).toBe(false);
    expect(parseSettingsPatch(tiffin, cur, { evil: 1 })).toEqual({ ok: true, settings: cur });
  });

  it('mergeSettings only lets the two known keys change and heals junk in the stored settings', () => {
    expect(tiffin.mergeSettings({ level: 3, pace: 'rush' }, { level: 4, x: 1 })).toEqual({ level: 4, pace: 'rush' });
    expect(tiffin.mergeSettings({ level: 3, pace: 'rush' }, null)).toEqual({ level: 3, pace: 'rush' });
    expect(tiffin.mergeSettings({ level: 'x', pace: 7 }, {})).toEqual({ level: 1, pace: 'normal' });
    expect(tiffin.mergeSettings(undefined, { pace: 'rush' })).toEqual({ level: 1, pace: 'rush' });
  });

  it('lobbySettings is exactly what createGame runs with; summarize is one short line', () => {
    expect(tiffin.lobbySettings({ level: 3, pace: 'rush', extra: 1 })).toEqual({ level: 3, pace: 'rush' });
    expect(tiffin.lobbySettings(undefined)).toEqual({ level: 1, pace: 'normal' });
    for (const settings of [{ level: 1, pace: 'normal' }, { level: 7, pace: 'relaxed' }, { level: 12, pace: 'rush' }]) {
      const s = tiffin.createGame({ players: players(2), settings, seed: 3 });
      expect(s).toMatchObject({ level: settings.level, pace: settings.pace });
      expect(tiffin.lobbySettings(settings)).toEqual(settings);
    }
    expect(tiffin.summarize({ level: 3, pace: 'rush' })).toBe('Level 3 - Poori Morning, Rush hour pace');
    expect(tiffin.summarize({ level: 1, pace: 'normal' })).toBe('Level 1 - Sunrise Dosa, Normal pace');
    expect(tiffin.summarize({ level: 12, pace: 'relaxed' })).toBe('Level 12 - Festival Day, Relaxed pace');
    expect(tiffin.summarize(undefined)).toBe('Level 1 - Sunrise Dosa, Normal pace');
  });

  it('createGame builds a shared stall with every seat, in the order given', () => {
    const s = fresh({ level: 3 }, 3);
    expect(s.order).toEqual(['p1', 'p2', 'p3']);
    expect(s.players.p2).toMatchObject({ id: 'p2', name: 'Player 2', avatar: 1, hands: [], earned: 0 });
    expect(s.status).toBe('playing');
    expect(s.cfg.tutorial).toBe(false);
    expect(() => JSON.stringify(s)).not.toThrow();
  });
});

// ------------------------------------------------------------------------------------------------------------------ sanitizeAction

describe('sanitizeAction (the client allow-list)', () => {
  const ME = 'player-1';
  const good = [
    [{ type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' }, { type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa', playerId: ME }],
    [{ type: 'take', station: 'steamer1', slot: 3 }, { type: 'take', station: 'steamer1', slot: 3, playerId: ME }],
    [{ type: 'serve', customer: 4, hand: 1 }, { type: 'serve', customer: 4, hand: 1, playerId: ME }],
    [{ type: 'collect', customer: 12 }, { type: 'collect', customer: 12, playerId: ME }],
    [{ type: 'discard', hand: 0 }, { type: 'discard', hand: 0, playerId: ME }],
    [{ type: 'move', to: 'kadai1' }, { type: 'move', to: 'kadai1', playerId: ME }],
    [{ type: 'move', to: 'spot:3' }, { type: 'move', to: 'spot:3', playerId: ME }],
    [{ type: 'move', to: 'bin' }, { type: 'move', to: 'bin', playerId: ME }],
    [{ type: 'move', to: null }, { type: 'move', to: null, playerId: ME }],
    [{ type: 'move' }, { type: 'move', to: null, playerId: ME }],
    [{ type: 'emote', e: 'fire' }, { type: 'emote', e: 'fire', playerId: ME }],
  ];

  it('passes the seven player actions, drops extra fields and forces playerId', () => {
    for (const [raw, clean] of good) expect(sanitizeAction(raw, ME), JSON.stringify(raw)).toEqual(clean);
    expect(sanitizeAction({ type: 'cook', station: 'tawa1', slot: 1, dish: 'dosa', playerId: 'victim', money: 9e9, extra: {} }, ME)).toEqual({
      type: 'cook', station: 'tawa1', slot: 1, dish: 'dosa', playerId: ME,
    });
    expect(tiffin.sanitizeAction).toBe(sanitizeAction);
    for (const e of engine.EMOTES) expect(sanitizeAction({ type: 'emote', e }, ME)).toMatchObject({ e });
    for (const station of STATION_IDS) expect(sanitizeAction({ type: 'move', to: station }, ME)).toMatchObject({ to: station });
    for (const dish of DISH_IDS) expect(sanitizeAction({ type: 'cook', station: 'tawa1', slot: 0, dish }, ME)).not.toBeNull();
  });

  it('refuses tick, spawn, tutorial flags and every unknown or malformed type', () => {
    const types = [
      'tick', 'spawn', 'tutorial-flags', 'tutorialFlags', 'TICK', 'Cook', 'COOK', ' cook', 'cook ', '', 'start', 'restart', 'resign', 'skip',
      '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype', 7, null, undefined, true, [], {}, ['cook'], Symbol.iterator.toString(),
    ];
    for (const type of types) {
      expect(sanitizeAction({ type, station: 'tawa1', slot: 0, dish: 'dosa', customer: 1, hand: 0, e: 'fire', patience: true, pay: true }, ME), String(type)).toBeNull();
    }
    expect(sanitizeAction({ type: 'tick', tick: 3 }, ME)).toBeNull();
    expect(sanitizeAction({ type: 'spawn', customer: { kind: 'student', order: ['dosa'] } }, ME)).toBeNull();
    expect(sanitizeAction({ type: 'tutorial-flags', patience: false, pay: false }, ME)).toBeNull();
  });

  it('refuses malformed, huge, negative, NaN and prototype-key fields', () => {
    const cases = [
      { type: 'cook', station: 'nope', slot: 0, dish: 'dosa' },
      { type: 'cook', station: '__proto__', slot: 0, dish: 'dosa' },
      { type: 'cook', station: 'constructor', slot: 0, dish: 'dosa' },
      { type: 'cook', station: 'toString', slot: 0, dish: 'dosa' },
      { type: 'cook', station: 'TAWA1', slot: 0, dish: 'dosa' },
      { type: 'cook', station: ['tawa1'], slot: 0, dish: 'dosa' },
      { type: 'cook', station: { toString: () => 'tawa1' }, slot: 0, dish: 'dosa' },
      { type: 'cook', station: 'tawa1', slot: -1, dish: 'dosa' },
      { type: 'cook', station: 'tawa1', slot: 10, dish: 'dosa' },
      { type: 'cook', station: 'tawa1', slot: 1e9, dish: 'dosa' },
      { type: 'cook', station: 'tawa1', slot: 0.5, dish: 'dosa' },
      { type: 'cook', station: 'tawa1', slot: NaN, dish: 'dosa' },
      { type: 'cook', station: 'tawa1', slot: Infinity, dish: 'dosa' },
      { type: 'cook', station: 'tawa1', slot: '0', dish: 'dosa' },
      { type: 'cook', station: 'tawa1', slot: null, dish: 'dosa' },
      { type: 'cook', station: 'tawa1', dish: 'dosa' },
      { type: 'cook', station: 'tawa1', slot: 0, dish: 'pizza' },
      { type: 'cook', station: 'tawa1', slot: 0, dish: '__proto__' },
      { type: 'cook', station: 'tawa1', slot: 0, dish: 'hasOwnProperty' },
      { type: 'cook', station: 'tawa1', slot: 0, dish: 'x'.repeat(100000) },
      { type: 'cook', station: 'tawa1', slot: 0 },
      { type: 'take', station: 'tawa1', slot: -1 },
      { type: 'take', station: 'tawa1', slot: 99 },
      { type: 'take', station: 7, slot: 0 },
      { type: 'take', slot: 0 },
      { type: 'serve', customer: -1, hand: 0 },
      { type: 'serve', customer: 1.5, hand: 0 },
      { type: 'serve', customer: '1', hand: 0 },
      { type: 'serve', customer: NaN, hand: 0 },
      { type: 'serve', customer: 1e12, hand: 0 },
      { type: 'serve', customer: 1, hand: 10 },
      { type: 'serve', customer: 1, hand: -1 },
      { type: 'serve', customer: 1 },
      { type: 'serve', hand: 0 },
      { type: 'collect', customer: -5 },
      { type: 'collect', customer: 'c1' },
      { type: 'collect', customer: null },
      { type: 'collect', customer: {} },
      { type: 'collect' },
      { type: 'discard', hand: -1 },
      { type: 'discard', hand: 1e9 },
      { type: 'discard', hand: '0' },
      { type: 'discard' },
      { type: 'move', to: 'nowhere' },
      { type: 'move', to: '__proto__' },
      { type: 'move', to: 'spot:6' },
      { type: 'move', to: 'spot:-1' },
      { type: 'move', to: 'spot:10' },
      { type: 'move', to: 'spot:' },
      { type: 'move', to: 'BIN' },
      { type: 'move', to: 'constructor' },
      { type: 'move', to: 3 },
      { type: 'move', to: [] },
      { type: 'emote', e: 'rage' },
      { type: 'emote', e: '__proto__' },
      { type: 'emote', e: 'FIRE' },
      { type: 'emote', e: ['fire'] },
      { type: 'emote' },
    ];
    for (const raw of cases) expect(sanitizeAction(raw, ME), JSON.stringify(raw)).toBeNull();
  });

  it('ignores prototype pollution carried by a JSON body and refuses non-objects', () => {
    // JSON.parse makes `__proto__` an OWN key; fields read through it must not count
    const sneaky = JSON.parse('{"type":"cook","__proto__":{"station":"tawa1","slot":0,"dish":"dosa"}}');
    expect(sanitizeAction(sneaky, ME)).toBeNull();
    const typeViaProto = Object.create({ type: 'emote', e: 'fire' });
    expect(sanitizeAction(typeViaProto, ME)).toBeNull();
    const slotViaProto = Object.assign(Object.create({ slot: 0 }), { type: 'take', station: 'tawa1' });
    expect(sanitizeAction(slotViaProto, ME)).toBeNull();
    for (const raw of [null, undefined, 'cook', 42, true, [], [{ type: 'emote', e: 'fire' }], () => ({ type: 'move' })]) expect(sanitizeAction(raw, ME)).toBeNull();
    expect(sanitizeAction({ type: 'move' }, '')).toBeNull();
    expect(sanitizeAction({ type: 'move' }, undefined)).toBeNull();
    expect(Object.prototype.polluted).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------------------------ operations actions

describe('sanitizeAction: the operations-layer actions (prep collectPrep tend swapGas board buy, move to prep1 / gas)', () => {
  const ME = 'player-1';
  const INGREDIENT_IDS = Object.keys(engine.INGREDIENTS);
  const FOLLOW = { playerId: 'victim', money: 9e9, extra: {}, __proto__x: 1 };

  it('passes every well-formed one, forces playerId and drops extra fields', () => {
    for (const item of INGREDIENT_IDS) {
      for (const slot of [0, 1]) {
        expect(sanitizeAction({ type: 'prep', station: 'prep1', slot, item, ...FOLLOW }, ME)).toEqual({ type: 'prep', station: 'prep1', slot, item, playerId: ME });
      }
      for (const n of [1, 2, 5, 10]) expect(sanitizeAction({ type: 'buy', item, n, ...FOLLOW }, ME)).toEqual({ type: 'buy', item, n, playerId: ME });
    }
    for (const slot of [0, 1]) expect(sanitizeAction({ type: 'collectPrep', station: 'prep1', slot, ...FOLLOW }, ME)).toEqual({ type: 'collectPrep', station: 'prep1', slot, playerId: ME });
    for (const station of Object.keys(engine.STATIONS)) expect(sanitizeAction({ type: 'tend', station, ...FOLLOW }, ME)).toEqual({ type: 'tend', station, playerId: ME });
    expect(sanitizeAction({ type: 'swapGas' }, ME)).toEqual({ type: 'swapGas', playerId: ME });
    expect(sanitizeAction({ type: 'swapGas', station: 'tawa1', n: 4, playerId: 'victim' }, ME)).toEqual({ type: 'swapGas', playerId: ME }); // no fields at all
    for (const dish of DISH_IDS) {
      for (const on of [true, false]) expect(sanitizeAction({ type: 'board', dish, on, ...FOLLOW }, ME)).toEqual({ type: 'board', dish, on, playerId: ME });
    }
    for (const to of ['prep1', 'gas']) expect(sanitizeAction({ type: 'move', to }, ME)).toEqual({ type: 'move', to, playerId: ME });
  });

  it('refuses malformed prep / collectPrep (wrong station, slot out of 0|1, unknown or prototype item, floats, NaN, huge)', () => {
    const slots = [-1, 2, 3, 9, 1e9, 0.5, 1.0000001, NaN, Infinity, -Infinity, '0', '1', null, undefined, true, [], [0], {}];
    for (const slot of slots) {
      expect(sanitizeAction({ type: 'prep', station: 'prep1', slot, item: 'oil' }, ME), `prep slot ${String(slot)}`).toBeNull();
      expect(sanitizeAction({ type: 'collectPrep', station: 'prep1', slot }, ME), `collectPrep slot ${String(slot)}`).toBeNull();
    }
    const stations = ['tawa1', 'steamer1', 'kadai1', 'tawa2', 'chai1', 'PREP1', 'prep2', 'prep1 ', ' prep1', '', '__proto__', 'constructor', 'toString', null, undefined, 7, ['prep1'], { toString: () => 'prep1' }];
    for (const station of stations) {
      expect(sanitizeAction({ type: 'prep', station, slot: 0, item: 'oil' }, ME), `prep station ${String(station)}`).toBeNull();
      expect(sanitizeAction({ type: 'collectPrep', station, slot: 0 }, ME), `collectPrep station ${String(station)}`).toBeNull();
    }
    const items = ['pizza', '', 'OIL', ' oil', 'oil ', '__proto__', 'constructor', 'hasOwnProperty', 'toString', 'valueOf', 'x'.repeat(100000), 'dosa', 'tawa1', null, undefined, 3, ['oil'], { id: 'oil' }];
    for (const item of items) {
      expect(sanitizeAction({ type: 'prep', station: 'prep1', slot: 0, item }, ME), `prep item ${String(item).slice(0, 12)}`).toBeNull();
      expect(sanitizeAction({ type: 'buy', item, n: 1 }, ME), `buy item ${String(item).slice(0, 12)}`).toBeNull();
    }
    for (const raw of [{ type: 'prep', station: 'prep1', slot: 0 }, { type: 'prep', station: 'prep1', item: 'oil' }, { type: 'prep', slot: 0, item: 'oil' }, { type: 'collectPrep', station: 'prep1' }, { type: 'collectPrep', slot: 0 }]) {
      expect(sanitizeAction(raw, ME), JSON.stringify(raw)).toBeNull();
    }
  });

  it('refuses malformed tend (unknown / prototype / non-string station)', () => {
    for (const station of ['nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'TAWA1', 'tawa1 ', '', null, undefined, 4, ['tawa1'], { toString: () => 'tawa1' }, 'spot:1', 'bin', 'gas']) {
      expect(sanitizeAction({ type: 'tend', station }, ME), String(station)).toBeNull();
    }
    expect(sanitizeAction({ type: 'tend' }, ME)).toBeNull();
  });

  it('refuses malformed board (unknown / prototype dish, on that is not a real boolean)', () => {
    for (const dish of ['pizza', '', 'DOSA', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'x'.repeat(100000), 'oil', null, undefined, 5, ['dosa'], { id: 'dosa' }]) {
      expect(sanitizeAction({ type: 'board', dish, on: true }, ME), String(dish).slice(0, 12)).toBeNull();
    }
    for (const on of [0, 1, 'true', 'false', 'on', null, undefined, NaN, [], {}, [true], new Boolean(true)]) {
      expect(sanitizeAction({ type: 'board', dish: 'dosa', on }, ME), String(on)).toBeNull();
    }
    expect(sanitizeAction({ type: 'board', dish: 'dosa' }, ME)).toBeNull();
    expect(sanitizeAction({ type: 'board', on: true }, ME)).toBeNull();
  });

  it('refuses malformed buy (n must be a whole number 1..10; no strings, floats, NaN, Infinity, huge, missing)', () => {
    for (const n of [0, -1, 11, 99, 1e9, Number.MAX_SAFE_INTEGER, 1.5, 0.1, 9.999999, NaN, Infinity, -Infinity, '1', '5', '', null, undefined, true, [], [3], {}, new Number(3)]) {
      expect(sanitizeAction({ type: 'buy', item: 'oil', n }, ME), `n=${String(n)}`).toBeNull();
    }
    expect(sanitizeAction({ type: 'buy', item: 'oil' }, ME)).toBeNull();
    expect(sanitizeAction({ type: 'buy', n: 2 }, ME)).toBeNull();
    expect(sanitizeAction({ type: 'buy' }, ME)).toBeNull();
  });

  it('move to prep1 / gas passes, near misses do not (the engine decides whether the level has them)', () => {
    for (const to of ['PREP1', 'Gas', 'GAS', 'gas ', 'prep2', 'prep', 'gas1', 'spot:6', 'constructor', '__proto__', 5, false, ['gas'], {}]) {
      expect(sanitizeAction({ type: 'move', to }, ME), String(to)).toBeNull();
    }
    const s = fresh({ level: 1 }, 2);
    expect(tiffin.applyAction(s, { type: 'move', to: 'gas', playerId: 'p1' }).error).toBeTruthy(); // level 1 has no cylinder
    const s3 = fresh({ level: 3 }, 2);
    expect(tiffin.applyAction(s3, { type: 'move', to: 'gas', playerId: 'p1' }).error).toBeUndefined();
    expect(tiffin.applyAction(s3, { type: 'move', to: 'prep1', playerId: 'p2' }).state.players.p2.at).toBe('prep1');
  });

  it('still refuses tick / spawn / tutorial flags and prototype tricks next to the new types', () => {
    const body = { station: 'prep1', slot: 0, item: 'oil', dish: 'dosa', on: true, n: 2 };
    for (const type of ['tick', 'spawn', 'tutorial-flags', 'Prep', 'PREP', 'collectprep', 'collect_prep', 'swapgas', 'SwapGas', 'swap-gas', 'Buy', 'Board', 'Tend', 'prep ', '__proto__', 'constructor']) {
      expect(sanitizeAction({ type, ...body }, ME), type).toBeNull();
    }
    // fields read through a JSON `__proto__` key or an inherited property do not count
    expect(sanitizeAction(JSON.parse('{"type":"buy","__proto__":{"item":"oil","n":2}}'), ME)).toBeNull();
    expect(sanitizeAction(JSON.parse('{"type":"board","dish":"dosa","__proto__":{"on":true}}'), ME)).toBeNull();
    expect(sanitizeAction(Object.assign(Object.create({ slot: 0 }), { type: 'prep', station: 'prep1', item: 'oil' }), ME)).toBeNull();
    expect(sanitizeAction(Object.assign(Object.create({ n: 2 }), { type: 'buy', item: 'oil' }), ME)).toBeNull();
    expect(sanitizeAction(Object.create({ type: 'swapGas' }), ME)).toBeNull();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it('the engine, not the sanitizer, says when a clean action is not allowed now: the training shift, the level, the stock', () => {
    // level 1: stock and prep exist, no cylinder, no heat, no market
    const s1 = fresh({ level: 1 }, 2);
    const ok = (s, raw, who = 'p1') => tiffin.applyAction(s, sanitizeAction(raw, who));
    const stockItem = Object.keys(s1.stock)[0];
    const prepped = ok(s1, { type: 'prep', station: 'prep1', slot: 0, item: stockItem });
    expect(prepped.error).toBeUndefined();
    expect(prepped.events.map((e) => e.type)).toEqual(['prep-start']);
    expect(ok(s1, { type: 'swapGas' }).error).toBeTruthy();
    expect(ok(s1, { type: 'tend', station: 'tawa1' }).error).toBeTruthy();
    expect(ok(s1, { type: 'buy', item: stockItem, n: 2 }).error).toBeTruthy();
    // the engine refuses an item the level does not use, with the sanitizer happy about it
    const unused = INGREDIENT_IDS.find((id) => !(id in s1.stock));
    expect(unused).toBeDefined();
    expect(sanitizeAction({ type: 'prep', station: 'prep1', slot: 0, item: unused }, ME)).not.toBeNull();
    expect(ok(s1, { type: 'prep', station: 'prep1', slot: 0, item: unused }).error).toBeTruthy();
    // the training shift (level 0) has none of it
    const tut = engine.createGame({ players: players(2), settings: { level: 0, pace: 'normal' }, seed: 1 });
    for (const raw of [
      { type: 'prep', station: 'prep1', slot: 0, item: 'oil' }, { type: 'collectPrep', station: 'prep1', slot: 0 }, { type: 'tend', station: 'tawa1' },
      { type: 'swapGas' }, { type: 'board', dish: 'dosa', on: false }, { type: 'buy', item: 'oil', n: 1 },
    ]) {
      const r = ok(tut, raw);
      expect(r.error, JSON.stringify(raw)).toBeTruthy();
      expect(r.state).toBe(tut);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------ fuzz

describe('fuzz of the operations actions through the adapter (real engine)', () => {
  function rawOps(rnd, s) {
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const items = Object.keys(s.stock || {});
    const junk = [undefined, null, -1, 2, 11, 1.5, 'x', '__proto__', NaN, {}, [], 'prep2'];
    const f = (good, p = 0.15) => (rnd() < p ? pick(junk) : good);
    const item = () => f(items.length ? pick(items) : 'oil');
    switch (Math.floor(rnd() * 10)) {
      case 0:
      case 1:
        return { type: 'prep', station: f('prep1'), slot: f(Math.floor(rnd() * 2)), item: item() };
      case 2:
      case 3:
        return { type: 'collectPrep', station: f('prep1'), slot: f(Math.floor(rnd() * 2)) };
      case 4:
        return { type: 'tend', station: f(pick(Object.keys(s.stations))) };
      case 5:
        return { type: 'swapGas', extra: f(1) };
      case 6:
        return { type: 'board', dish: f(pick(s.cfg.menu)), on: f(rnd() < 0.5) };
      case 7:
        return { type: 'buy', item: item(), n: f(1 + Math.floor(rnd() * 10)) };
      case 8:
        return { type: 'move', to: f(pick(['prep1', 'gas', 'tawa1', null])) };
      default:
        return { type: 'cook', station: pick(Object.keys(s.stations)), slot: Math.floor(rnd() * 3), dish: pick(s.cfg.menu) };
    }
  }

  it('random clean ops actions plus bot play and ticks never throw, never mutate on a refusal and keep the books sane', () => {
    let opsApplied = 0;
    for (const [level, n, seed] of [[3, 2, 21], [5, 3, 22], [8, 4, 23], [12, 2, 24], [12, 4, 25]]) {
      const rnd = mulberry32(seed * 104729 + 7);
      let s = tiffin.createGame({ players: players(n), settings: { level, pace: 'normal' }, seed });
      let guard = 0;
      while (!tiffin.isOver(s) && guard++ < 3000) {
        for (let i = 0; i < Math.floor(rnd() * 5); i++) {
          const who = `p${1 + Math.floor(rnd() * n)}`;
          const raw = rnd() < 0.7 ? rawOps(rnd, s) : engine.chooseAutoAction(s, who);
          const clean = raw && sanitizeAction(raw, who);
          if (!clean) continue;
          const before = JSON.stringify(s);
          const res = tiffin.applyAction(s, clean);
          if (res.error) {
            expect(res.state).toBe(s);
            expect(JSON.stringify(s)).toBe(before);
          } else if (['prep', 'collectPrep', 'tend', 'swapGas', 'board', 'buy'].includes(clean.type)) opsApplied += 1;
          s = res.state;
        }
        s = tiffin.applyAction(s, tiffin.deadlines(s)[0].action).state;
        expect(() => JSON.stringify(s)).not.toThrow();
        for (const v of Object.values(s.stock || {})) expect(v).toBeGreaterThanOrEqual(0);
      }
      expect(tiffin.isOver(s), `level ${level}`).toBe(true);
      const r = tiffin.result(s);
      expect(Number.isInteger(r.profit)).toBe(true);
      expect(r.profit).toBe(r.money - r.cost);
    }
    expect(opsApplied).toBeGreaterThan(40);
  });
});

describe('fuzz through the adapter (real engine)', () => {
  /** A raw client message: mostly nearly-valid, sometimes hostile junk. Everything goes through sanitizeAction like a room does. */
  function rawAction(rnd, s) {
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const live = (s.customers || []).map((c) => c.id);
    const junk = [undefined, null, -1, 99, 1.5, 'x', '__proto__', NaN, {}, []];
    const f = (good, p = 0.12) => (rnd() < p ? pick(junk) : good);
    switch (Math.floor(rnd() * 11)) {
      case 0:
      case 1:
      case 2: {
        const station = pick(Object.keys(s.stations));
        const kind = s.stations[station].kind;
        const dishes = DISH_IDS.filter((d) => engine.DISHES[d].station === kind);
        return { type: 'cook', station: f(station), slot: f(Math.floor(rnd() * 4)), dish: f(pick(dishes)) };
      }
      case 3:
      case 4:
        return { type: 'take', station: f(pick(Object.keys(s.stations))), slot: f(Math.floor(rnd() * 4)) };
      case 5:
      case 6:
        return { type: 'serve', customer: f(live.length ? pick(live) : 0), hand: f(Math.floor(rnd() * 2)) };
      case 7:
      case 8:
        return { type: 'collect', customer: f(live.length ? pick(live) : 0) };
      case 9:
        return rnd() < 0.5 ? { type: 'discard', hand: f(Math.floor(rnd() * 2)) } : { type: 'move', to: f(rnd() < 0.2 ? null : pick([...Object.keys(s.stations), 'bin', `spot:${Math.floor(rnd() * 7)}`])) };
      default:
        return rnd() < 0.5 ? { type: 'emote', e: f(pick(engine.EMOTES)) } : pick([{ type: 'tick' }, { type: 'spawn', customer: {} }, { type: 'tutorial-flags', patience: false }, { type: 'hack' }]);
    }
  }

  const run = (settings, seed, nPlayers) => {
    const rnd = mulberry32(seed * 7919 + 13);
    let s = tiffin.createGame({ players: players(nPlayers), settings, seed });
    let applied = 0;
    let refused = 0;
    let guard = 0;
    while (!tiffin.isOver(s) && guard++ < 4000) {
      const burst = Math.floor(rnd() * 8);
      for (let i = 0; i < burst; i++) {
        const who = `p${1 + Math.floor(rnd() * nPlayers)}`;
        const clean = sanitizeAction(rawAction(rnd, s), who);
        if (!clean) {
          refused += 1;
          continue;
        }
        expect(clean.playerId).toBe(who);
        const before = JSON.stringify(s);
        const res = tiffin.applyAction(s, clean);
        expect(res.events).toBeInstanceOf(Array);
        if (res.error) {
          expect(typeof res.error).toBe('string');
          expect(res.state).toBe(s);
          expect(JSON.stringify(s)).toBe(before); // a refusal never mutates
        } else applied += 1;
        s = res.state;
      }
      // the server tick, as GameRoom applies a deadline action
      const d = tiffin.deadlines(s);
      expect(d).toHaveLength(1);
      const t = tiffin.applyAction(s, d[0].action);
      expect(t.error).toBeUndefined();
      expect(t.state.tick).toBe(s.tick + 1);
      s = t.state;
      expect(() => JSON.stringify(s)).not.toThrow();
      expect(s.lives).toBeGreaterThanOrEqual(0);
      expect(s.money).toBeGreaterThanOrEqual(0);
    }
    return { s, applied, refused };
  };

  it('random sanitized actions plus server ticks always run to a finished shift (never throws, never corrupts)', () => {
    let applied = 0;
    let closed = 0;
    let done = 0;
    for (const [level, pace, n, seed] of [[1, 'normal', 2, 1], [1, 'relaxed', 2, 2], [3, 'rush', 3, 3], [6, 'normal', 4, 4], [9, 'rush', 4, 5], [12, 'relaxed', 2, 6], [12, 'rush', 4, 7], [5, 'normal', 2, 8]]) {
      const { s, applied: a } = run({ level, pace }, seed, n);
      applied += a;
      expect(tiffin.isOver(s), `level ${level} ${pace}`).toBe(true);
      expect(['done', 'closed']).toContain(s.status);
      if (s.status === 'closed') closed += 1;
      else done += 1;
      const r = tiffin.result(s);
      expect(r.standings).toHaveLength(n);
      expect(tiffin.deadlines(s)).toEqual([]);
    }
    expect(applied).toBeGreaterThan(50); // the fuzz really played, it did not only bounce off refusals
    expect(closed + done).toBe(8);
  });

  it('never throws on a hostile state or action handed straight to applyAction', () => {
    const s = fresh();
    const actions = [null, undefined, 5, 'tick', [], {}, { type: 5 }, { type: 'nope' }, { type: '__proto__' }, { type: 'tick', tick: 'x' }, { type: 'cook' }, { type: 'serve', playerId: 'p1', customer: {} }];
    for (const a of actions) {
      const r = tiffin.applyAction(s, a);
      expect(r.state).toBe(s);
      expect(r.events).toEqual([]);
      expect(typeof r.error).toBe('string');
    }
    for (const bad of [null, undefined, {}, [], 5, { v: 1 }, { v: 1, status: 'playing', stations: null, players: null }]) {
      const r = tiffin.applyAction(bad, { type: 'tick' });
      expect(r.events).toEqual([]);
      expect(typeof r.error).toBe('string');
    }
    // a player who is not at the stall cannot act
    expect(tiffin.applyAction(s, { type: 'move', to: 'tawa1', playerId: 'stranger' }).error).toBeTruthy();
    // an engine that throws is turned into a refusal
    const boom = { v: 1, status: 'playing', get stations() { throw new Error('boom'); }, players: {}, cfg: { menu: [] } };
    const r = tiffin.applyAction(boom, { type: 'cook', playerId: 'x', station: 'tawa1', slot: 0, dish: 'dosa' });
    expect(r).toMatchObject({ events: [], error: expect.any(String) });
    expect(r.state).toBe(boom);
  });
});

// ------------------------------------------------------------------------------------------------------------------ deadlines

describe('a no-op action never reaches the room as a state change', () => {
  it('a move to where the player already is is a refusal (same state, no events), so the room does not bump seq, save or broadcast', () => {
    const s = fresh();
    const moved = tiffin.applyAction(s, { type: 'move', to: 'tawa1', playerId: 'p1' });
    expect(moved.error).toBeUndefined();
    const again = tiffin.applyAction(moved.state, { type: 'move', to: 'tawa1', playerId: 'p1' });
    expect(again).toEqual({ state: moved.state, events: [], error: 'Already there.' });
    expect(again.state).toBe(moved.state);
  });
  it('the tick the server schedules carries the tick number, so a duplicate is the engine stale-tick refusal', () => {
    const s = fresh();
    const d = tiffin.deadlines(s)[0];
    const next = tiffin.applyAction(s, d.action).state;
    expect(next.tick).toBe(1);
    const dup = tiffin.applyAction(next, d.action);
    expect(dup.error).toBe('Stale tick');
    expect(dup.state).toBe(next);
  });
});

describe('deadlines (the server tick)', () => {
  it('is exactly one tick timer while the shift runs, keyed by the tick number', () => {
    const s = fresh();
    expect(tiffin.deadlines(s)).toEqual([{ key: 'tick-0', afterMs: TICK_MS, anchor: 'apply', playerId: null, action: { type: 'tick', tick: 0 } }]);
    const next = tiffin.applyAction(s, { type: 'tick' }).state;
    expect(tiffin.deadlines(next)).toEqual([{ key: 'tick-1', afterMs: 1000, anchor: 'apply', playerId: null, action: { type: 'tick', tick: 1 } }]);
    // a player action does not change the key (the timer keeps running)
    const acted = tiffin.applyAction(next, { type: 'cook', playerId: 'p1', station: 'tawa1', slot: 0, dish: 'dosa' });
    expect(acted.error).toBeUndefined();
    expect(tiffin.deadlines(acted.state)[0].key).toBe('tick-1');
  });

  it('is empty when the shift is over (done or closed), and for no state at all', () => {
    expect(tiffin.deadlines({ status: 'done', tick: 150 })).toEqual([]);
    expect(tiffin.deadlines({ status: 'closed', tick: 9 })).toEqual([]);
    expect(tiffin.deadlines(null)).toEqual([]);
    expect(tiffin.deadlines(undefined)).toEqual([]);
    expect(tiffin.isOver({ status: 'done' })).toBe(true);
    expect(tiffin.isOver({ status: 'playing' })).toBe(false);
    expect(tiffin.isOver(null)).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------------------------ a real GameRoom

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.sent = [];
    this.att = null;
    this.tags = [];
  }
  send(m) {
    this.sent.push(JSON.parse(m));
  }
  close() {
    this.readyState = 3;
  }
  serializeAttachment(v) {
    this.att = structuredClone(v);
  }
  deserializeAttachment() {
    return this.att;
  }
  of(type) {
    return this.sent.filter((m) => m.t === type);
  }
  last(type) {
    return this.of(type).at(-1);
  }
}

class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.webSocket = init.webSocket;
  }
  async json() {
    return JSON.parse(this.body);
  }
}

function makeCtx() {
  const store = new Map();
  const sockets = [];
  const ctx = {
    alarmAt: null,
    store,
    sockets,
    storage: {
      get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
      put: async (k, v) => void store.set(k, structuredClone(v)),
      setAlarm: async (t) => void (ctx.alarmAt = t),
      deleteAlarm: async () => void (ctx.alarmAt = null),
      deleteAll: async () => store.clear(),
    },
    blockConcurrencyWhile: async (fn) => fn(),
    setWebSocketAutoResponse() {},
    acceptWebSocket(ws, tags = []) {
      ws.tags = tags;
      sockets.push(ws);
    },
    getWebSockets(tag) {
      return tag ? sockets.filter((s) => s.tags.includes(tag)) : [...sockets];
    },
  };
  return ctx;
}

const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const user = (n) => ({ id: U(n), name: `P${n}`, avatar: n % 12 });

class Harness {
  constructor() {
    this.ctx = makeCtx();
    this.room = new GameRoom(this.ctx, {});
  }
  init(body = {}, host = user(1)) {
    return this.room.fetch({ url: 'https://x/init', method: 'POST', headers: new Headers(), json: async () => ({ code: 'TIFF22', host, ...body }) });
  }
  async connect(u) {
    const headers = new Headers({
      Upgrade: 'websocket',
      'X-User-Id': u.id,
      'X-User-Name': encodeURIComponent(u.name),
      'X-User-Avatar': String(u.avatar),
      'X-User-Guest': '0',
    });
    const before = this.ctx.sockets.length;
    const res = await this.room.fetch({ url: 'https://x/ws', method: 'GET', headers });
    expect(res.status).toBe(101);
    return this.ctx.sockets[before] || this.ctx.sockets.at(-1);
  }
  say(ws, msg) {
    return this.room.webSocketMessage(ws, JSON.stringify(msg));
  }
  async tick() {
    const at = this.ctx.alarmAt;
    if (at == null) return false;
    vi.setSystemTime(Math.max(Date.now(), at));
    await this.room.alarm();
    return true;
  }
  get r() {
    return this.room.room;
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocketPair', class {
    constructor() {
      this[0] = new FakeSocket();
      this[1] = new FakeSocket();
    }
  });
  vi.stubGlobal('Response', FakeResponse);
  vi.stubGlobal('WebSocketRequestResponsePair', class {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T10:00:00Z').getTime());
  persisted.length = 0;
  persistMatch.mockClear();
  queryMock.mockReset();
  queryMock.mockImplementation(async () => []);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const started = async (settings = { level: 1, pace: 'normal' }) => {
  const h = new Harness();
  expect((await h.init({ gameId: 'tiffin-centre', settings })).status).toBe(201);
  h.host = await h.connect(user(1));
  h.guest = await h.connect(user(2));
  await h.say(h.host, { t: 'start' });
  expect(h.r.status).toBe('playing');
  return h;
};

describe('driven through a real GameRoom', () => {
  it('creates the room with the adapter defaults and starts a stall for both players', async () => {
    const h = new Harness();
    expect((await h.init({ gameId: 'tiffin-centre' })).status).toBe(201);
    expect(h.r).toMatchObject({ gameId: 'tiffin-centre', visibility: 'private', maxPlayers: 4, settings: { level: 1, pace: 'normal' } });
    expect((await new Harness().init({ gameId: 'tiffin-centre', settings: { level: 99 } })).status).toBe(400); // the room validates again
    const g = await started({ level: 3, pace: 'rush' });
    expect(g.r.state).toMatchObject({ level: 3, pace: 'rush', tick: 0, status: 'playing', order: expect.arrayContaining([U(1), U(2)]) });
    expect(g.host.last('state').state.players[U(2)].name).toBe('P2'); // redact: everybody sees the whole stall
    expect(g.r.animMs).toBe(0);
  });

  it('ticks once a second: seq advances per tick, the tick timer is not reset by a player action, a client tick is refused', async () => {
    const h = await started();
    const start = Date.now();
    expect(h.r.seq).toBe(1);
    expect(Object.keys(h.r.deadlines)).toEqual(['tick-0']);
    const plan = h.room.plan();
    expect(plan.action).toEqual({ type: 'tick', tick: 0 });
    expect(plan.id).toBeNull();
    expect(plan.timeout).toBe(false);
    expect(plan.at).toBe(h.r.lastApplyAt + TICK_MS);
    expect(plan.at).toBe(start + TICK_MS);
    expect(h.host.last('state').clock.waitingFor).toEqual([]); // nobody is waited for
    expect(h.host.last('state').clock.deadline).toBe(plan.at);

    // nothing happens early
    vi.setSystemTime(plan.at - 200);
    await h.room.alarm();
    expect(h.r.seq).toBe(1);
    expect(h.r.state.tick).toBe(0);

    // a player acts 400 ms in: the state changes (seq + 1) but tick-0 keeps its start, so the tick is still due at start + 1000
    vi.setSystemTime(start + 400);
    await h.say(h.host, { t: 'action', action: { type: 'cook', station: 'tawa1', slot: 0, dish: 'dosa' } });
    expect(h.host.of('error')).toHaveLength(0);
    expect(h.r.seq).toBe(2);
    expect(h.r.state.tick).toBe(0);
    expect(h.r.state.stations.tawa1.slots[0]).toMatchObject({ st: 'cooking', dish: 'dosa', by: U(1) });
    expect(Object.keys(h.r.deadlines)).toEqual(['tick-0']);
    expect(h.r.deadlines['tick-0']).toBe(start);
    const after = h.room.plan();
    expect(after.at).toBe(start + TICK_MS);
    expect(h.ctx.alarmAt).toBe(start + TICK_MS);

    // the tick lands on time: seq + 1, tick 1, a new key
    await h.tick();
    expect(Date.now()).toBe(start + TICK_MS);
    expect(h.r.seq).toBe(3);
    expect(h.r.state.tick).toBe(1);
    expect(Object.keys(h.r.deadlines)).toEqual(['tick-1']);
    expect(h.guest.last('state').events).toEqual([{ type: 'tick', tick: 1 }]);
    expect(h.room.plan().at).toBe(start + 2 * TICK_MS);

    // several more ticks: one seq and one engine tick each
    for (let i = 2; i <= 6; i++) {
      await h.tick();
      expect(h.r.state.tick).toBe(i);
      expect(h.r.seq).toBe(i + 2);
      expect(Object.keys(h.r.deadlines)).toEqual([`tick-${i}`]);
    }
    expect(h.r.afk).toEqual({}); // the server clock never flags a player idle

    // a client cannot send the server's actions
    const seq = h.r.seq;
    for (const action of [{ type: 'tick' }, { type: 'tick', tick: h.r.state.tick }, { type: 'spawn', customer: { order: ['dosa'] } }, { type: 'tutorial-flags', patience: false, pay: false }, { type: 'bogus' }]) {
      await h.say(h.guest, { t: 'action', action });
      expect(h.guest.last('error').message).toBe('Invalid action.');
    }
    expect(h.r.seq).toBe(seq);
    expect(h.r.state.tick).toBe(6);

    // a legal-looking but impossible action is an ordinary refusal from the engine
    await h.say(h.guest, { t: 'action', action: { type: 'collect', customer: 9999 } });
    expect(h.guest.last('error').message).toBe('They are not paying right now');
    expect(h.r.seq).toBe(seq);
  });

  it('playerId is forced to the sender: a spoofed id acts as the sender', async () => {
    const h = await started();
    await h.say(h.guest, { t: 'action', action: { type: 'move', to: 'chai1', playerId: U(1) } });
    expect(h.r.state.players[U(2)].at).toBe('chai1');
    expect(h.r.state.players[U(1)].at).toBeNull();
  });

  it('runs a whole shift on the server clock alone, finishes, and saves one co-op result', async () => {
    const h = await started({ level: 1, pace: 'normal' });
    let n = 0;
    while (h.r.status === 'playing' && n < 2000) {
      await h.tick();
      n += 1;
    }
    expect(h.r.status).toBe('finished');
    expect(tiffin.isOver(h.r.state)).toBe(true);
    expect(tiffin.deadlines(h.r.state)).toEqual([]);
    expect(h.room.plan()).toBeNull();
    for (let i = 0; i < 5 && !h.r.persisted; i += 1) await h.tick();
    expect(h.r.persisted).toBe(true);
    expect(persistMatch).toHaveBeenCalledTimes(1);
    const rec = persisted[0];
    // nobody cooked: the centre closed (angry customers), the team shares the last rank, nobody wins
    expect(rec).toMatchObject({ gameId: 'tiffin-centre', roomCode: 'TIFF22', playerCount: 2, winnerId: null, winReason: 'closed', goal: null, maxRounds: null, diceMode: null });
    expect(rec.players.map((p) => p.rank)).toEqual([2, 2]);
    expect(rec.players.every((p) => p.is_bot === false && [U(1), U(2)].includes(p.user_id))).toBe(true);
    for (const u of rec.users) expect(u).toMatchObject({ won: 0, lg: 0, lw: 0, lworth: 0, lrent: 0 });
  });
});

// ------------------------------------------------------------------------------------------------------------------ result()

describe('result()', () => {
  /** Play a level with the engine's own competent bot for every player (a stand-in for humans). */
  function playWithBots(settings, nPlayers, seed) {
    let s = tiffin.createGame({ players: players(nPlayers), settings, seed });
    let guard = 0;
    while (!tiffin.isOver(s) && guard++ < 5000) {
      for (const id of s.order) {
        for (let k = 0; k < 4; k++) {
          const a = engine.chooseAutoAction(s, id);
          if (!a) break;
          const r = tiffin.applyAction(s, { ...a, playerId: id });
          if (r.error) break;
          s = r.state;
        }
      }
      s = tiffin.applyAction(s, { type: 'tick' }).state;
    }
    return s;
  }

  it('a cleared shift: everybody shares rank 1, the top earner is the winner, score = money collected', () => {
    const s = playWithBots({ level: 1, pace: 'relaxed' }, 3, 11);
    expect(s.status).toBe('done');
    const res = tiffin.result(s);
    expect(res.reason).toBe('cleared');
    expect(res.stars).toBeGreaterThanOrEqual(1);
    expect(res.winnerId).toBe(res.standings[0].id);
    expect(res.standings).toHaveLength(3);
    for (const row of res.standings) {
      expect(row).toMatchObject({ rank: 1, score: s.players[row.id].earned });
      expect(Number.isInteger(row.score)).toBe(true);
      expect(row.stats).toMatchObject({ served: s.players[row.id].served, collected: s.players[row.id].collected, earned: s.players[row.id].earned, tips: s.players[row.id].tips, finished: true });
    }
    const scores = res.standings.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a)); // ordered by money collected
    expect(res.standings.reduce((n, r) => n + r.score, 0)).toBe(s.money);
    expect(res.money).toBe(s.money);
    expect(res.level).toBe(1);
    expect(res.rounds).toBe(s.tick);
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });

  it('carries the books (profit, cost, waste, revenue, tips, fines) and the operations counters; rank and stars follow PROFIT', () => {
    for (const [level, n, seed] of [[1, 2, 3], [5, 3, 4], [12, 4, 5]]) {
      const s = playWithBots({ level, pace: 'normal' }, n, seed);
      const res = tiffin.result(s);
      const eng = engine.result(s);
      expect(res).toMatchObject({ level, stars: eng.stars, money: s.money, reason: eng.reason, winnerId: eng.winnerId ?? null });
      for (const k of ['revenue', 'tips', 'cost', 'waste', 'fines', 'profit', 'served', 'lost', 'unpaid', 'bestCombo']) {
        expect(Number.isInteger(res[k]), `${k} at level ${level}`).toBe(true);
        expect(res[k]).toBe(Math.round(eng[k]));
      }
      expect(res.profit).toBe(s.money - res.cost);
      expect(res.waste).toBeLessThanOrEqual(res.cost);
      expect(res.revenue + res.tips).toBe(s.money);
      expect(res.team).toEqual({ ...Object.fromEntries(['revenue', 'tips', 'cost', 'waste', 'fines', 'profit', 'served', 'lost', 'unpaid', 'bestCombo'].map((k) => [k, res[k]])), prepped: eng.team.prepped, tended: eng.team.tended, gasSwaps: eng.team.gasSwaps, bought: eng.team.bought });
      expect(res.standings).toHaveLength(n);
      let prepped = 0;
      for (const row of res.standings) {
        const p = s.players[row.id];
        expect(row.rank).toBe(res.stars >= 1 ? 1 : n); // stars are decided by profit, not by money
        expect(row.score).toBe(p.earned);
        expect(row.stats).toMatchObject({
          served: p.served, collected: p.collected, earned: p.earned, tips: p.tips, finished: true,
          prepped: p.ops ? p.ops[0] : 0, tended: p.ops ? p.ops[1] : 0, gasSwaps: p.ops ? p.ops[2] : 0, bought: p.ops ? p.ops[3] : 0,
          revenue: res.revenue, cost: res.cost, waste: res.waste, fines: res.fines, profit: res.profit, lost: res.lost, unpaid: res.unpaid, bestCombo: res.bestCombo,
        });
        for (const v of Object.values(row.stats)) expect(typeof v === 'number' || v === true).toBe(true); // flat and small
        prepped += row.stats.prepped;
      }
      expect(prepped).toBe(res.team.prepped);
      if (level >= 5) expect(res.team.prepped + res.team.tended + res.team.bought + res.team.gasSwaps).toBeGreaterThan(0); // the bot really ran the stall
      const json = JSON.stringify(res);
      expect(JSON.parse(json)).toEqual(res);
      expect(json.length).toBeLessThan(1800 + 520 * n);
    }
  });

  it('a negative profit (a shift run at a loss) is kept as is; money collected stays a non-negative score', () => {
    let s = fresh({ level: 5 }, 2, 9);
    s = { ...s, status: 'closed', stars: 0, money: 10, cost: 90, players: { ...s.players, p1: { ...s.players.p1, earned: 10 } } };
    const res = tiffin.result(s);
    expect(res.profit).toBe(-80);
    expect(res.standings.every((r) => r.rank === 2 && r.score >= 0)).toBe(true);
    expect(res.standings[0].stats.profit).toBe(-80);
  });

  it('feeds the generic match record (worker/match.js): a team win pays everyone as rank 1, the winner is the top earner', () => {
    const s = playWithBots({ level: 1, pace: 'relaxed' }, 2, 5);
    const res = tiffin.result(s);
    const room = {
      matchId: '11111111-1111-4111-8111-111111111111', code: 'TIFF22', startedAt: 1000, endedAt: 2000, state: s, meta: {},
      players: s.order.map((id) => ({ id, name: s.players[id].name })),
    };
    const rec = buildMatchRecord(room, tiffin);
    expect(rec).toMatchObject({ gameId: 'tiffin-centre', winnerId: res.winnerId, winReason: 'cleared', playerCount: 2 });
    expect(rec.players.map((p) => p.rank)).toEqual([1, 1]);
    expect(rec.players.map((p) => p.final_worth).sort()).toEqual(res.standings.map((r) => r.score).sort());
    // CO-OP WIN CREDIT: the win belongs to the whole team that worked, not only to the top earner (the match row still names that one)
    expect(res.winners.length).toBeGreaterThan(0);
    expect(res.winners).toContain(res.winnerId);
    expect(rec.users.filter((u) => u.won === 1).map((u) => u.user_id).sort()).toEqual([...res.winners].sort());
    for (const u of rec.users) expect(u.won === 1 ? [u.xp, u.coins] : [0, 0]).toEqual(res.winners.includes(u.user_id) ? [100, 200] : [0, 0]); // a winner is paid as one, a seat that stood by nothing
    expect(rec.facts).toEqual({}); // no Tycoon-only achievement facts
  });

  it('a closed (failed) shift: no winner, everybody shares the last rank', () => {
    let s = fresh({ level: 1 }, 3, 2);
    let guard = 0;
    while (!tiffin.isOver(s) && guard++ < 1000) s = tiffin.applyAction(s, { type: 'tick' }).state;
    expect(s.status).toBe('closed');
    const res = tiffin.result(s);
    expect(res).toMatchObject({ winnerId: null, reason: 'closed', stars: 0, money: 0 });
    expect(res.standings.map((r) => r.rank)).toEqual([3, 3, 3]);
    expect(res.standings.map((r) => r.score)).toEqual([0, 0, 0]);
    expect(res.standings.map((r) => r.id).sort()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('result(): the idle guard (stats.idle) and what match.js pays for it', () => {
  /** The shift played to the end by the bot for the seats in `acting` only; everybody else stands by. */
  function playSome(acting, nPlayers = 3, seed = 11, settings = { level: 1, pace: 'relaxed' }) {
    let s = tiffin.createGame({ players: players(nPlayers), settings, seed });
    let guard = 0;
    while (!tiffin.isOver(s) && guard++ < 5000) {
      for (const id of acting) {
        for (let k = 0; k < 4; k++) {
          const a = engine.chooseAutoAction(s, id);
          if (!a) break;
          const r = tiffin.applyAction(s, { ...a, playerId: id });
          if (r.error) break;
          s = r.state;
        }
      }
      s = tiffin.applyAction(s, { type: 'tick' }).state;
    }
    return s;
  }
  const record = (s) =>
    buildMatchRecord({ matchId: '11111111-1111-4111-8111-111111111111', code: 'TIFF22', startedAt: 1000, endedAt: 2000, state: s, meta: {}, players: s.order.map((id) => ({ id, name: id })) }, tiffin);

  it('a table where nobody does anything: every seat is idle and nothing is paid', () => {
    const s = playSome([]);
    const res = tiffin.result(s);
    expect(res.reason).toBe('closed');
    expect(res.standings.every((r) => r.stats.idle === true)).toBe(true);
    const rec = record(s);
    expect(rec.users.map((u) => [u.xp, u.coins, u.won])).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    expect(rec.seats.every((x) => x.idle === true)).toBe(true);
  });

  it('a team with paid customers is paid normally, a seat that only stood by is idle, a seat that did one real action is not', () => {
    const s = playSome(['p1']); // p1 runs the stall alone; p2 and p3 never act
    const eng = engine.result(s);
    expect(eng.team.paid).toBeGreaterThan(0);
    const res = tiffin.result(s);
    const row = (id) => res.standings.find((r) => r.id === id);
    expect(row('p1').stats.idle).toBeUndefined();
    expect(row('p2').stats.idle).toBe(true);
    expect(row('p3').stats.idle).toBe(true);
    const rec = record(s);
    const user = (id) => rec.users.find((u) => u.user_id === id);
    expect(user('p1').xp).toBeGreaterThanOrEqual(30);
    expect(user('p1').coins).toBeGreaterThanOrEqual(40);
    expect(user('p2')).toMatchObject({ xp: 0, coins: 0, won: 0 });
    expect(user('p3')).toMatchObject({ xp: 0, coins: 0, won: 0 });
    expect(rec.seats.filter((x) => x.idle).map((x) => x.id).sort()).toEqual(['p2', 'p3']);
    // the winner stays the top earner (never changed by the guard)
    expect(rec.winnerId).toBe(res.winnerId);
    // everyone acting: a seat is idle exactly when it did none of the counted work
    const all = playSome(['p1', 'p2', 'p3']);
    for (const r of tiffin.result(all).standings) {
      const work = ['served', 'collected', 'cooked', 'prepped', 'tended', 'gasSwaps', 'bought'].reduce((n, k) => n + r.stats[k], 0);
      expect(r.stats.idle === true).toBe(work === 0);
    }
  });

  it('the work that counts is served + collected + cooked + prepped + tended + gasSwaps + bought; moving, emoting and a cooked dish nobody took are not work', () => {
    let s = fresh({ level: 1 }, 2, 3);
    s = { ...s, status: 'done', stars: 1, paid: 5, money: 100, players: { ...s.players, p1: { ...s.players.p1, earned: 100, collected: 1 }, p2: { ...s.players.p2, ops: [0, 0, 0, 1] } } };
    const rows = tiffin.result(s).standings;
    expect(rows.find((r) => r.id === 'p1').stats.idle).toBeUndefined(); // collected 1
    expect(rows.find((r) => r.id === 'p2').stats.idle).toBeUndefined(); // bought 1
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, ops: [0, 0, 0, 0] } } };
    expect(tiffin.result(s).standings.find((r) => r.id === 'p2').stats.idle).toBe(true);
    // a dedicated cook: a dish of theirs that reached somebody's hands is real work, even if they never served or collected
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, cooked: 4 } } };
    expect(tiffin.result(s).standings.find((r) => r.id === 'p2').stats.idle).toBeUndefined();
    expect(tiffin.result(s).winners.sort()).toEqual(['p1', 'p2']);
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, cooked: 0 } } };
    // a team whose customers never paid: everybody is idle however busy they were
    s = { ...s, paid: 0 };
    expect(tiffin.result(s).standings.every((r) => r.stats.idle === true)).toBe(true);
  });

  it('opts in to coalesced storage writes and to the daily limit of rewarded matches', () => {
    expect(tiffin.persistEveryMs()).toBe(5000);
    expect(tiffin.persistEveryMs(fresh())).toBe(5000);
    expect(tiffin.dailyRewardedMatches).toBeGreaterThan(0);
    expect(buildMatchRecord({ matchId: 'x', code: 'C', startedAt: 1, endedAt: 2, state: playSome(['p1', 'p2']), meta: {}, players: [{ id: 'p1', name: 'a' }, { id: 'p2', name: 'b' }] }, tiffin).dailyRewardedMatches).toBe(tiffin.dailyRewardedMatches);
  });
});

// ------------------------------------------------------------------------------------------------------------------ canHost

describe('canHost', () => {
  it('allows a host whose tutorial flag is stored, with a parameterised query for exactly that user and game', async () => {
    queryMock.mockResolvedValueOnce([{ ok: 1 }]);
    const env = { DATABASE_URL: 'postgres://fake' };
    await expect(tiffin.canHost({ env, user: { id: U(1) } })).resolves.toEqual({ ok: true });
    const [passedEnv, text, params] = queryMock.mock.calls[0];
    expect(passedEnv).toBe(env);
    expect(text).toMatch(/FROM user_game_stats/);
    expect(text).toContain("extra ->> 'tutorial' = 'true'");
    expect(text).toMatch(/user_id = \$1/);
    expect(text).toMatch(/game_id = \$2/);
    expect(text).not.toContain(U(1)); // values are bound, never spliced into the SQL
    expect(params).toEqual([U(1), 'tiffin-centre']);
  });

  it('refuses a host without the flag (no row, or no flag) with the tutorial message', async () => {
    queryMock.mockResolvedValue([]);
    const refusal = { ok: false, error: 'Finish the Tiffin Centre tutorial first to open a table.' };
    expect(CAN_HOST_ERROR).toBe(refusal.error);
    await expect(tiffin.canHost({ env: {}, user: { id: U(1) } })).resolves.toEqual(refusal);
    await expect(tiffin.canHost({ env: {}, user: null })).resolves.toEqual(refusal);
    await expect(tiffin.canHost({ env: {}, user: {} })).resolves.toEqual(refusal);
    expect(queryMock).toHaveBeenCalledTimes(1); // a missing user never reaches the database
  });

  it('lets a database failure surface (a 500), instead of telling the player to redo the tutorial', async () => {
    queryMock.mockRejectedValueOnce(new Error('neon down'));
    await expect(tiffin.canHost({ env: {}, user: { id: U(1) } })).rejects.toThrow('neon down');
  });
});
