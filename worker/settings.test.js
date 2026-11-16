import { describe, it, expect } from 'vitest';
import {
  sanitizeSettings, normalizeSettings, mergeSettingsPatch, ROOM_DEFAULTS, MODE_BOUND_RULES, parseMaxPlayers, MODE_IDS, DICE_MODES, TARGET_OPTIONS,
  describeSettings,
} from './settings.js';
import { RULE_FIELDS, RULE_KEYS, ruleDefaults } from '../shared/index.js';

/** A value one step outside the legal ones, for any field. */
const illegal = (f) => {
  if (f.type === 'boolean') return ['yes', 1, 0, null, 'true'];
  if (f.type === 'number') return [f.min - f.step, f.max + f.step, f.step > 1 ? f.min + 1 : f.min + 0.5, 1.5, '30', NaN, Infinity, null, true, [], {}];
  return ['loaded', 12345, '100', true, [], {}].concat(f.nullable ? [] : [null]);
};

describe('the rules a room stores', () => {
  it('are `mode` plus every rule of the contract, all at their defaults for a new room', () => {
    expect(Object.keys(ROOM_DEFAULTS)).toEqual(['mode', ...RULE_KEYS]);
    expect(ROOM_DEFAULTS).toEqual({ mode: 'standard', ...ruleDefaults('standard') });
    expect(ROOM_DEFAULTS).toMatchObject({
      mode: 'standard', startCash: 1500000, passStart: 200000, targetWorth: 5000000, rentPercent: 100, trafficFine: 25000, turnSeconds: 60,
      tradeSeconds: 45, maxRounds: 20, dice: 'lucky', requireFullSet: true, eventEvery: 3, chaiCap: 1,
      snatches: 1, snatchMs: 5000, snatchCardCap: 2,
    });
    expect(MODE_BOUND_RULES).toEqual(['startCash', 'maxRounds', 'targetWorth']);
  });
});

describe('sanitizeSettings (strict, untrusted input)', () => {
  it('missing / empty means "nothing chosen"', () => {
    expect(sanitizeSettings(undefined)).toEqual({ settings: {}, errors: [] });
    expect(sanitizeSettings(null)).toEqual({ settings: {}, errors: [] });
    expect(sanitizeSettings({}).settings).toEqual({});
    expect(sanitizeSettings({ mode: undefined, startCash: undefined }).errors).toEqual([]);
  });

  it('accepts valid values', () => {
    const r = sanitizeSettings({ mode: 'quick', dice: 'fair', targetWorth: 4000000 });
    expect(r.errors).toEqual([]);
    expect(r.settings).toEqual({ mode: 'quick', dice: 'fair', targetWorth: 4000000 });
    expect(MODE_IDS).toEqual(['standard', 'quick', 'classic']);
    expect(DICE_MODES).toEqual(['lucky', 'fair']);
  });

  it('accepts every legal value of every rule (the bounds themselves included)', () => {
    for (const f of RULE_FIELDS) {
      const values = f.type === 'number' ? [f.min, f.max, f.min + f.step] : f.type === 'boolean' ? [true, false] : f.options.map((o) => o.value);
      for (const v of values) {
        const r = sanitizeSettings({ mode: 'standard', [f.key]: v });
        expect(r.errors, `${f.key}=${v}`).toEqual([]);
        expect(r.settings[f.key], `${f.key}=${v}`).toBe(v);
      }
    }
  });

  it('refuses every illegal value of every rule with one message that names the rule (never the win target)', () => {
    for (const f of RULE_FIELDS) {
      if (f.key === 'targetWorth' || f.key === 'dice') continue;
      for (const v of illegal(f)) {
        const r = sanitizeSettings({ [f.key]: v });
        expect(r.errors, `${f.key}=${String(v)}`).toHaveLength(1);
        expect(r.errors[0], f.key).toContain(f.label);
        expect(f.key in r.settings, `${f.key}=${String(v)}`).toBe(false);
      }
    }
  });

  it('error texts read like the old ones: the rule, then what is legal', () => {
    expect(sanitizeSettings({ startCash: 100 }).errors).toEqual(['Starting cash must be a whole amount from ₹5,00,000 to ₹10,00,00,000 in steps of ₹1,00,000.']);
    expect(sanitizeSettings({ turnSeconds: 5 }).errors).toEqual(['Decision timer must be a whole number from 15 to 180 seconds in steps of 5.']);
    expect(sanitizeSettings({ chaiCap: 4 }).errors).toEqual(['Chai tokens a player can hold must be a whole number from 1 to 3.']);
    expect(sanitizeSettings({ rentPercent: 33 }).errors).toEqual(['Rent level must be one of 50, 75, 100, 125, 150, 200.']);
    expect(sanitizeSettings({ requireFullSet: 'yes' }).errors).toEqual(['Full set needed to upgrade must be true or false.']);
    expect(sanitizeSettings({ eventEvery: 1 }).errors).toEqual(['City events must be one of 0, 2, 3, 4, 5, 6.']);
  });

  it("mode: only 'standard', 'quick' or 'classic'", () => {
    for (const ok of MODE_IDS) expect(sanitizeSettings({ mode: ok }).settings).toEqual({ mode: ok });
    for (const bad of ['Standard', 'turbo', '', 1, true, null, [], {}]) {
      const r = sanitizeSettings({ mode: bad });
      expect(r.errors, String(bad)).toHaveLength(1);
      expect('mode' in r.settings).toBe(false);
    }
  });

  it("dice: only 'lucky' or 'fair'", () => {
    for (const bad of ['Lucky', 'FAIR', 'loaded', '', 1, true, null, [], {}]) {
      expect(sanitizeSettings({ dice: bad }).errors, String(bad)).toHaveLength(1);
    }
  });

  it('the retired auctionOnDecline is tolerated and dropped: never stored, never an error, whatever its value', () => {
    for (const v of [true, false, 'true', 'yes', 0, 1, null, [], {}]) {
      expect(sanitizeSettings({ auctionOnDecline: v }), String(v)).toEqual({ settings: {}, errors: [], maxPlayers: undefined });
    }
    expect(sanitizeSettings({ mode: 'quick', auctionOnDecline: true, rentPercent: 150 }).settings).toEqual({ mode: 'quick', rentPercent: 150 });
    expect(RULE_KEYS).not.toContain('auctionOnDecline');
    expect(Object.keys(ROOM_DEFAULTS)).not.toContain('auctionOnDecline');
  });

  it('maxRounds: no limit (null) or one of the listed round counts', () => {
    for (const ok of [null, 10, 12, 15, 20, 25, 30, 40, 50, 60]) expect(sanitizeSettings({ maxRounds: ok }).settings).toEqual({ maxRounds: ok });
    for (const bad of [0, 1, 11, 61, 100, '20', true, NaN]) expect(sanitizeSettings({ maxRounds: bad }).errors, String(bad)).toHaveLength(1);
  });

  it('targetWorth: null or a legal amount (listed or custom); anything else is the default of the mode (never an error)', () => {
    expect(TARGET_OPTIONS).toEqual([null, 2500000, 3000000, 4000000, 5000000, 7500000, 10000000]);
    for (const ok of [...TARGET_OPTIONS, 1000000, 1500000, 12500000, 500000000]) {
      const r = sanitizeSettings({ mode: 'quick', targetWorth: ok });
      expect(r.errors).toEqual([]);
      expect(r.settings.targetWorth).toBe(ok);
    }
    for (const bad of [0, 1, -3000000, 3000001, 999999, 500500000, 1e12, '3000000', 'off', true, false, NaN, [], {}, [3000000]]) {
      const r = sanitizeSettings({ targetWorth: bad });
      expect(r.errors, String(bad)).toEqual([]);
      expect(r.settings.targetWorth, String(bad)).toBe(5000000);
      expect(sanitizeSettings({ mode: 'classic', targetWorth: bad }).settings.targetWorth, String(bad)).toBe(3000000);
    }
    // a mode without a round limit can never run "without a target"
    expect(sanitizeSettings({ mode: 'classic', targetWorth: null }).settings.targetWorth).toBe(3000000);
    expect(sanitizeSettings({ mode: 'standard', targetWorth: null }).settings.targetWorth).toBeNull();
    expect('targetWorth' in sanitizeSettings({}).settings).toBe(false);
    expect('targetWorth' in sanitizeSettings({ targetWorth: undefined }).settings).toBe(false);
  });

  it('the Snatch rules pass through validated', () => {
    expect(sanitizeSettings({ snatches: 0, snatchMs: 3000, snatchCardCap: 0 })).toEqual({ settings: { snatches: 0, snatchMs: 3000, snatchCardCap: 0 }, errors: [], maxPlayers: undefined });
    for (const bad of [{ snatches: 4 }, { snatchMs: 2000 }, { snatchMs: 5500 }, { snatchCardCap: 3 }, { snatches: -1 }]) {
      expect(sanitizeSettings(bad).errors, JSON.stringify(bad)).toHaveLength(1);
    }
  });

  it('reports every bad value and keeps the good ones', () => {
    const r = sanitizeSettings({ mode: 'x', dice: 'fair', auctionOnDecline: 'no', startCash: 1, rentPercent: 150 });
    expect(r.errors).toHaveLength(2); // the mode and the starting cash; the retired auctionOnDecline is ignored
    expect(r.settings).toEqual({ dice: 'fair', rentPercent: 150 });
  });

  it('ignores unknown keys (the retired goal / round settings, debug, seed ...)', () => {
    const r = sanitizeSettings({ mode: 'classic', goal: 5, rounds: 999, debug: true, seed: 1, hotels: 3 });
    expect(r.settings).toEqual({ mode: 'classic' });
    expect(r.errors).toEqual([]);
  });

  it('rejects non-object input', () => {
    for (const bad of ['x', 5, true, []]) expect(sanitizeSettings(bad).errors).toHaveLength(1);
  });

  it('maxPlayers convenience: 2..6 only', () => {
    expect(sanitizeSettings({ maxPlayers: 6 }).maxPlayers).toBe(6);
    for (const bad of [1, 7, 0, 3.5, '4', null]) expect(sanitizeSettings({ maxPlayers: bad }).errors).toHaveLength(1);
    expect(parseMaxPlayers(4)).toBe(4);
    expect(parseMaxPlayers(9)).toBeNull();
  });
});

describe('normalizeSettings', () => {
  it('fills the defaults: standard mode with every rule at its stock value', () => {
    expect(normalizeSettings(undefined)).toEqual(ROOM_DEFAULTS);
    expect(normalizeSettings({ mode: 'nope', dice: 'x', startCash: 1 })).toEqual(ROOM_DEFAULTS);
    expect(normalizeSettings({ mode: 'quick' })).toEqual({ mode: 'quick', ...ruleDefaults('quick') });
    expect(normalizeSettings({ mode: 'quick' })).toMatchObject({ startCash: 2000000, maxRounds: 12, targetWorth: 5000000 });
    expect(normalizeSettings({ mode: 'classic' })).toMatchObject({ startCash: 1500000, maxRounds: null, targetWorth: 3000000 });
  });

  it('keeps every legal custom rule and drops illegal ones back to the default', () => {
    const custom = {
      mode: 'quick', startCash: 3000000, passStart: 0, targetWorth: 12500000, rentPercent: 150, trafficFine: 0, turnSeconds: 15, tradeSeconds: 120, auctionSeconds: 45,
      maxRounds: null, dice: 'fair', requireFullSet: false, eventEvery: 0, chaiCap: 3, snatches: 0, snatchMs: 3000, snatchCardCap: 1, powerCards: false,
    };
    expect(normalizeSettings(custom)).toEqual(custom);
    expect(normalizeSettings({ ...custom, startCash: 7, rentPercent: 33, turnSeconds: 'fast' })).toEqual({
      ...custom, startCash: 2000000, rentPercent: 100, turnSeconds: 60,
    });
  });

  it('a room stored before the rules existed (old keys only, or no keys) gets every default, the mode default for the target', () => {
    expect(normalizeSettings({ mode: 'quick', dice: 'fair', auctionOnDecline: false })).toEqual({
      mode: 'quick', ...ruleDefaults('quick'), dice: 'fair', // a stored auctionOnDecline of an older room is dropped
    });
    expect(normalizeSettings({ mode: 'classic', dice: 'lucky', auctionOnDecline: true, targetWorth: 4000000 })).toEqual({
      mode: 'classic', ...ruleDefaults('classic'), targetWorth: 4000000,
    });
    expect(normalizeSettings({})).toEqual(ROOM_DEFAULTS);
  });

  it('the win target follows the mode: a missing or unusable one is the mode default, classic is never unlimited', () => {
    expect(normalizeSettings({ mode: 'classic' }).targetWorth).toBe(3000000);
    expect(normalizeSettings({ mode: 'classic', targetWorth: null }).targetWorth).toBe(3000000);
    expect(normalizeSettings({ mode: 'classic', targetWorth: 99 }).targetWorth).toBe(3000000);
    expect(normalizeSettings({ mode: 'classic', targetWorth: 7500000 }).targetWorth).toBe(7500000);
    expect(normalizeSettings({ mode: 'classic', targetWorth: 12000000 }).targetWorth).toBe(12000000);
    expect(normalizeSettings({ mode: 'quick', targetWorth: null }).targetWorth).toBeNull();
    expect(normalizeSettings({ targetWorth: 2500000 })).toEqual({ ...ROOM_DEFAULTS, targetWorth: 2500000 });
    // normalising twice changes nothing
    for (const mode of MODE_IDS) for (const t of [...TARGET_OPTIONS, 8000000, 'x']) {
      const once = normalizeSettings({ mode, targetWorth: t });
      expect(normalizeSettings(once)).toEqual(once);
    }
  });
});

describe('mergeSettingsPatch', () => {
  const cur = { ...ROOM_DEFAULTS, targetWorth: 4000000 };
  const out = (patch, current = cur) => normalizeSettings(mergeSettingsPatch(current, patch));

  it('a mode change resets the target unless the same message changes the target', () => {
    const target = (patch, current) => out(patch, current).targetWorth;
    expect(target({ dice: 'fair' })).toBe(4000000);
    expect(target({ mode: 'standard' })).toBe(4000000); // same mode: nothing resets
    expect(target({ mode: 'quick' })).toBe(5000000);
    expect(target({ mode: 'classic' })).toBe(3000000);
    expect(target({ mode: 'classic', targetWorth: 4000000 })).toBe(3000000); // the client echoes the old value: still a reset
    expect(target({ mode: 'classic', targetWorth: 7500000 })).toBe(7500000); // a deliberate new target wins
    expect(target({ mode: 'classic', targetWorth: null })).toBe(3000000);
    expect(target({ targetWorth: null })).toBeNull();
    expect(target({ mode: 'standard' }, { ...ROOM_DEFAULTS, mode: 'classic', targetWorth: 2500000 })).toBe(5000000);
  });

  it('a mode change resets ONLY the start cash, the round limit and the target; every other custom rule stays', () => {
    const custom = { ...ROOM_DEFAULTS, startCash: 3000000, maxRounds: 30, targetWorth: 4000000, passStart: 100000, rentPercent: 150, turnSeconds: 30, dice: 'fair', requireFullSet: false, chaiCap: 2, snatches: 2 };
    const quick = out({ mode: 'quick' }, custom);
    expect(quick).toMatchObject({ mode: 'quick', startCash: 2000000, maxRounds: 12, targetWorth: 5000000 });
    expect(quick).toMatchObject({ passStart: 100000, rentPercent: 150, turnSeconds: 30, dice: 'fair', requireFullSet: false, chaiCap: 2, snatches: 2 });
    const classic = out({ mode: 'classic' }, custom);
    expect(classic).toMatchObject({ mode: 'classic', startCash: 1500000, maxRounds: null, targetWorth: 3000000, rentPercent: 150, chaiCap: 2 });
  });

  it('...unless the same message changes that rule itself (an echo of the old value does not count as a change)', () => {
    const custom = { ...ROOM_DEFAULTS, startCash: 3000000, maxRounds: 30, targetWorth: 4000000 };
    expect(out({ mode: 'quick', startCash: 4000000 }, custom)).toMatchObject({ startCash: 4000000, maxRounds: 12, targetWorth: 5000000 });
    expect(out({ mode: 'quick', maxRounds: 15 }, custom)).toMatchObject({ startCash: 2000000, maxRounds: 15 });
    expect(out({ mode: 'quick', maxRounds: null }, custom)).toMatchObject({ maxRounds: null });
    expect(out({ mode: 'quick', startCash: 3000000, maxRounds: 30, targetWorth: 4000000 }, custom)).toMatchObject({ startCash: 2000000, maxRounds: 12, targetWorth: 5000000 });
    // the whole settings object echoed back with a new mode and one real change
    expect(out({ ...custom, mode: 'classic', rentPercent: 200 }, custom)).toMatchObject({ mode: 'classic', startCash: 1500000, maxRounds: null, rentPercent: 200 });
  });

  it('an old room without the new keys: a mode change leaves the old mode defaults behind, not stale values', () => {
    const old = { mode: 'quick', dice: 'fair' };
    expect(out({ mode: 'standard' }, old)).toMatchObject({ mode: 'standard', startCash: 1500000, maxRounds: 20, dice: 'fair' });
    // the client echoes the quick defaults it saw: they are not a change from what the old room ran with
    expect(out({ mode: 'standard', startCash: 2000000, maxRounds: 12 }, old)).toMatchObject({ startCash: 1500000, maxRounds: 20 });
  });

  it('a patch without a mode keeps everything else, and never mutates its input', () => {
    expect(out({ rentPercent: 200 }, cur)).toEqual({ ...cur, rentPercent: 200 });
    expect(mergeSettingsPatch(undefined, undefined)).toEqual({});
    const same = { ...cur };
    mergeSettingsPatch(cur, { mode: 'classic' });
    expect(cur).toEqual(same);
  });
});

describe('describeSettings / fresh objects', () => {
  it('returns a fresh object and describes itself', () => {
    const a = normalizeSettings();
    a.mode = 'x';
    expect(normalizeSettings().mode).toBe('standard');
    expect(describeSettings({ mode: 'classic', dice: 'fair' })).toBe('classic / fair dice / target ₹30L');
    expect(describeSettings({ mode: 'quick', targetWorth: null })).toBe('quick / lucky dice / no target');
  });

  it('says how many other rules are customised', () => {
    expect(describeSettings({ rentPercent: 150 })).toBe('standard / lucky dice / target ₹50L / +1 custom rule');
    expect(describeSettings({ rentPercent: 150, turnSeconds: 30, startCash: 3000000 })).toBe('standard / lucky dice / target ₹50L / +3 custom rules');
  });
});

describe('auctionSeconds (the auction timer)', () => {
  it('is a timers rule, 10-90 s in steps of 5, default 20, not mode-bound', () => {
    const f = RULE_FIELDS.find((x) => x.key === 'auctionSeconds');
    expect(f).toMatchObject({ group: 'timers', label: 'Auction timer', type: 'number', unit: 'seconds', min: 10, max: 90, step: 5 });
    expect(f.help).toBe('Time to place a bid before the auction closes; players who have not bid pass.');
    for (const mode of MODE_IDS) expect(ruleDefaults(mode).auctionSeconds).toBe(20);
    expect(MODE_BOUND_RULES).not.toContain('auctionSeconds');
  });

  it('accepts every legal value and refuses everything else with one clear message', () => {
    for (let v = 10; v <= 90; v += 5) {
      expect(sanitizeSettings({ auctionSeconds: v })).toMatchObject({ settings: { auctionSeconds: v }, errors: [] });
    }
    for (const bad of [0, 5, 9, 11, 95, 100, 20.5, '20', null, NaN, true, {}]) {
      expect(sanitizeSettings({ auctionSeconds: bad }).errors, String(bad)).toEqual(['Auction timer must be a whole number from 10 to 90 seconds in steps of 5.']);
    }
  });

  it('defaults to 20 for a room stored before the rule; a mode change keeps a customised value', () => {
    expect(normalizeSettings({ mode: 'quick' }).auctionSeconds).toBe(20);
    expect(normalizeSettings({}).auctionSeconds).toBe(20);
    const merged = mergeSettingsPatch({ mode: 'standard', auctionSeconds: 45 }, { mode: 'classic' });
    expect(normalizeSettings(merged)).toMatchObject({ mode: 'classic', auctionSeconds: 45 });
  });
});
