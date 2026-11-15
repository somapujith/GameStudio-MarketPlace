import { describe, it, expect } from 'vitest';
import {
  parseRoomInit,
  parseSettingsPatch,
  parseVisibility,
  parseSeats,
  defaultSeats,
  defaultSanitizeAction,
  gameIdOf,
} from './roomrules.js';
import { getAdapter } from './games/index.js';
import { ROOM_DEFAULTS } from './settings.js';
import { ruleDefaults } from '../shared/index.js';

const tycoon = getAdapter('hyderabad-tycoon');

describe('visibility', () => {
  it("is exactly 'private' or 'public'", () => {
    expect(parseVisibility('private')).toBe('private');
    expect(parseVisibility('public')).toBe('public');
    for (const bad of ['Public', 'PRIVATE', '', 'friends', null, undefined, true, 1, {}, []]) expect(parseVisibility(bad), String(bad)).toBeNull();
  });
});

describe('seats', () => {
  it('follow the adapter range; new rooms default to 4 (never above the adapter maximum)', () => {
    expect(parseSeats(tycoon, 2)).toBe(2);
    expect(parseSeats(tycoon, 6)).toBe(6);
    for (const bad of [1, 7, 2.5, '3', null, undefined, NaN]) expect(parseSeats(tycoon, bad), String(bad)).toBeNull();
    expect(defaultSeats(tycoon)).toBe(4);
    expect(defaultSeats({ minPlayers: 2, maxPlayers: 3 })).toBe(3);
    expect(defaultSeats({ minPlayers: 2, maxPlayers: 8, defaultMaxPlayers: 5 })).toBe(5);
  });
});

describe('parseRoomInit (POST /api/rooms and the room /init)', () => {
  it('an empty body creates a private Tycoon room with the defaults (old clients)', () => {
    const r = parseRoomInit({});
    expect(r).toMatchObject({ ok: true, gameId: 'hyderabad-tycoon', visibility: 'private', maxPlayers: 4, settings: ROOM_DEFAULTS });
    expect(parseRoomInit(undefined).ok).toBe(true);
    expect(parseRoomInit(null).ok).toBe(true);
    expect(gameIdOf(undefined)).toBe('hyderabad-tycoon');
    expect(gameIdOf(null)).toBe('hyderabad-tycoon');
  });

  it("rejects unknown games with the message 'unknown game'", () => {
    for (const gameId of ['ludo', '', 'HYDERABAD-TYCOON', '__proto__', 7, {}, [], false]) {
      expect(parseRoomInit({ gameId }), JSON.stringify(gameId)).toEqual({ ok: false, error: 'unknown game' });
    }
  });

  it('visibility is validated; public rooms are accepted', () => {
    expect(parseRoomInit({ visibility: 'public' })).toMatchObject({ ok: true, visibility: 'public' });
    expect(parseRoomInit({ visibility: 'secret' })).toMatchObject({ ok: false });
    expect(parseRoomInit({ visibility: 3 })).toMatchObject({ ok: false });
  });

  it('settings go through the adapter; seats may ride along in settings or in the body', () => {
    expect(parseRoomInit({ settings: { mode: 'classic', dice: 'fair' } })).toMatchObject({ ok: true, settings: { ...ROOM_DEFAULTS, ...ruleDefaults('classic'), mode: 'classic', dice: 'fair', targetWorth: 3000000 } });
    // the retired keys (end-cash goal, hotels) are dropped, never stored
    expect(parseRoomInit({ settings: { goal: 40000, hotels: 2, seed: 9 } }).settings).toEqual(ROOM_DEFAULTS);
    // every host rule is accepted and stored, the full set of keys always present
    const custom = { startCash: 3000000, passStart: 0, rentPercent: 150, trafficFine: 0, turnSeconds: 15, tradeSeconds: 90, maxRounds: null, requireFullSet: false, eventEvery: 0, chaiCap: 3, snatches: 2 };
    expect(parseRoomInit({ settings: custom }).settings).toEqual({ ...ROOM_DEFAULTS, ...custom });
    expect(parseRoomInit({ settings: { turnSeconds: 7 } })).toMatchObject({ ok: false, error: expect.stringMatching(/Decision timer must be/) });
    expect(parseRoomInit({ settings: { startCash: 1 } })).toMatchObject({ ok: false, error: expect.stringMatching(/Starting cash must be/) });
    expect(parseRoomInit({ settings: { maxPlayers: 5 } })).toMatchObject({ ok: true, maxPlayers: 5 });
    expect(parseRoomInit({ maxPlayers: 3, settings: { maxPlayers: 5 } })).toMatchObject({ maxPlayers: 3 });
    expect(parseRoomInit({ maxPlayers: 3 })).toMatchObject({ maxPlayers: 3 });
    expect(parseRoomInit({ maxPlayers: 9 })).toEqual({ ok: false, error: 'Players must be between 2 and 6.' });
    expect(parseRoomInit({ settings: { mode: 'marathon' } })).toMatchObject({ ok: false, error: expect.stringMatching(/Mode must be one of/) });
    expect(parseRoomInit({ settings: 'goal' })).toEqual({ ok: false, error: 'Settings must be an object.' });
    expect(parseRoomInit({ settings: [1] })).toEqual({ ok: false, error: 'Settings must be an object.' });
  });

  it('works for any registered adapter (lookup is injectable)', () => {
    const fake = { id: 'fake', name: 'Fake', minPlayers: 2, maxPlayers: 3, validateSettings: (raw) => ({ ok: true, settings: { ...raw } }) };
    const lookup = (id) => (id === 'fake' ? fake : null);
    expect(parseRoomInit({ gameId: 'fake', settings: { x: 1 }, visibility: 'public' }, lookup)).toMatchObject({
      ok: true,
      gameId: 'fake',
      maxPlayers: 3,
      visibility: 'public',
      settings: { x: 1 },
    });
    expect(parseRoomInit({ gameId: 'fake', maxPlayers: 4 }, lookup)).toEqual({ ok: false, error: 'Players must be between 2 and 3.' });
    expect(parseRoomInit({}, lookup)).toEqual({ ok: false, error: 'unknown game' }); // default game is not registered there
  });
});

describe('parseSettingsPatch (host settings message)', () => {
  const current = { ...ROOM_DEFAULTS };

  it('merges a partial patch over the current settings', () => {
    const quick = { ...ROOM_DEFAULTS, ...ruleDefaults('quick'), mode: 'quick' };
    expect(parseSettingsPatch(tycoon, current, { mode: 'quick' })).toEqual({ ok: true, settings: quick });
    expect(parseSettingsPatch(tycoon, quick, { dice: 'fair' }).settings).toEqual({ ...quick, dice: 'fair' }); // earlier choices are kept
    expect(parseSettingsPatch(tycoon, current, undefined)).toEqual({ ok: true, settings: ROOM_DEFAULTS });
  });

  it('a mode change resets the win target (the client echoes the old one), a deliberate target is kept', () => {
    const picked = { ...ROOM_DEFAULTS, targetWorth: 4000000 };
    expect(parseSettingsPatch(tycoon, picked, { mode: 'classic', targetWorth: 4000000 }).settings).toEqual({ ...ROOM_DEFAULTS, ...ruleDefaults('classic'), mode: 'classic', targetWorth: 3000000 });
    expect(parseSettingsPatch(tycoon, picked, { mode: 'quick' }).settings).toEqual({ ...ROOM_DEFAULTS, ...ruleDefaults('quick'), mode: 'quick', targetWorth: 5000000 });
    expect(parseSettingsPatch(tycoon, picked, { mode: 'classic', targetWorth: 7500000 }).settings.targetWorth).toBe(7500000);
    expect(parseSettingsPatch(tycoon, picked, { dice: 'fair' }).settings.targetWorth).toBe(4000000);
    expect(parseSettingsPatch(tycoon, picked, { targetWorth: null }).settings.targetWorth).toBeNull();
    expect(parseSettingsPatch(tycoon, { ...ROOM_DEFAULTS, mode: 'classic', targetWorth: 3000000 }, { targetWorth: null }).settings.targetWorth).toBe(3000000);
    // an adapter without mergeSettings keeps the plain merge
    const plain = { ...tycoon, mergeSettings: undefined };
    expect(parseSettingsPatch(plain, picked, { mode: 'classic', targetWorth: 4000000 }).settings.targetWorth).toBe(4000000);
  });

  it('a mode change resets only startCash / maxRounds / targetWorth; every other customised rule survives it', () => {
    const custom = { ...ROOM_DEFAULTS, startCash: 3000000, maxRounds: 30, targetWorth: 4000000, passStart: 0, rentPercent: 200, turnSeconds: 20, requireFullSet: false, chaiCap: 3 };
    const r = parseSettingsPatch(tycoon, custom, { mode: 'quick' });
    expect(r.settings).toEqual({ ...custom, mode: 'quick', startCash: 2000000, maxRounds: 12, targetWorth: 5000000 });
    // the same message may also set them: that wins
    expect(parseSettingsPatch(tycoon, custom, { mode: 'quick', startCash: 2500000, maxRounds: 15 }).settings).toMatchObject({ startCash: 2500000, maxRounds: 15, targetWorth: 5000000, rentPercent: 200 });
  });

  it('every rule can be patched on its own, validated like a new room', () => {
    expect(parseSettingsPatch(tycoon, current, { startCash: 4000000, turnSeconds: 90 }).settings).toEqual({ ...ROOM_DEFAULTS, startCash: 4000000, turnSeconds: 90 });
    expect(parseSettingsPatch(tycoon, current, { rentPercent: 33 })).toMatchObject({ ok: false, error: expect.stringMatching(/Rent level must be one of/) });
    expect(parseSettingsPatch(tycoon, current, { eventEvery: 0, requireFullSet: false }).settings).toMatchObject({ eventEvery: 0, requireFullSet: false });
    // a stored room that predates the rules is completed with the defaults the moment the host changes something
    expect(parseSettingsPatch(tycoon, { mode: 'quick', dice: 'fair', auctionOnDecline: true }, { rentPercent: 125 }).settings).toEqual({
      ...ruleDefaults('quick'), mode: 'quick', dice: 'fair', rentPercent: 125,
    });
  });

  it('maxPlayers is a shared setting handled outside the adapter', () => {
    expect(parseSettingsPatch(tycoon, current, { maxPlayers: 3 })).toEqual({ ok: true, settings: ROOM_DEFAULTS, maxPlayers: 3 });
    expect(parseSettingsPatch(tycoon, current, { maxPlayers: 9 })).toEqual({ ok: false, error: 'Players must be between 2 and 6.' });
  });

  it('rejects bad values and non-objects; unknown keys are ignored', () => {
    for (const bad of [{ mode: 'marathon' }, { mode: 3 }, { dice: 'loaded' }, { auctionOnDecline: 'yes' }]) {
      expect(parseSettingsPatch(tycoon, current, bad).ok, JSON.stringify(bad)).toBe(false);
    }
    // a win target that is not on the list is sanitised to the mode default, not refused
    expect(parseSettingsPatch(tycoon, current, { targetWorth: 42 })).toEqual({ ok: true, settings: ROOM_DEFAULTS });
    for (const bad of ['x', 5, [1], true]) expect(parseSettingsPatch(tycoon, current, bad)).toEqual({ ok: false, error: 'Settings must be an object.' });
    expect(parseSettingsPatch(tycoon, current, { debug: true })).toEqual({ ok: true, settings: ROOM_DEFAULTS });
    expect(parseSettingsPatch(tycoon, current, { goal: 5, hotels: 3 })).toEqual({ ok: true, settings: ROOM_DEFAULTS }); // retired keys
    expect(parseSettingsPatch(tycoon, current, { maxRounds: 120 }).ok).toBe(false); // a limit that is not on the list
  });
});

describe('defaultSanitizeAction', () => {
  it('forces the player id and refuses anything that is not a typed object', () => {
    expect(defaultSanitizeAction({ type: 'INC', n: 2, playerId: 'evil' }, 'me')).toEqual({ type: 'INC', n: 2, playerId: 'me' });
    for (const bad of [null, undefined, 'INC', 5, [], {}, { type: 5 }, { type: '' }, { type: 'x'.repeat(41) }]) {
      expect(defaultSanitizeAction(bad, 'me'), JSON.stringify(bad)).toBeNull();
    }
  });
});
