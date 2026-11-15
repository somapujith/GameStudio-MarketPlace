import { describe, it, expect } from 'vitest';
import { sanitizeSettings, normalizeSettings, mergeSettingsPatch, ROOM_DEFAULTS, parseMaxPlayers, MODE_IDS, DICE_MODES, TARGET_OPTIONS, describeSettings } from './settings.js';

describe('sanitizeSettings (strict, untrusted input)', () => {
  it('missing / empty means "nothing chosen"', () => {
    expect(sanitizeSettings(undefined)).toEqual({ settings: {}, errors: [] });
    expect(sanitizeSettings(null)).toEqual({ settings: {}, errors: [] });
    expect(sanitizeSettings({}).settings).toEqual({});
    expect(sanitizeSettings({ mode: undefined }).errors).toEqual([]);
  });

  it('accepts valid values', () => {
    const r = sanitizeSettings({ mode: 'quick', dice: 'fair', auctionOnDecline: false, targetWorth: 4000000 });
    expect(r.errors).toEqual([]);
    expect(r.settings).toEqual({ mode: 'quick', dice: 'fair', auctionOnDecline: false, targetWorth: 4000000 });
    expect(MODE_IDS).toEqual(['standard', 'quick', 'classic']);
    expect(DICE_MODES).toEqual(['lucky', 'fair']);
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

  it('auctionOnDecline: strictly boolean', () => {
    expect(sanitizeSettings({ auctionOnDecline: false }).settings).toEqual({ auctionOnDecline: false });
    for (const bad of ['true', 'false', 0, 1, null, [], {}]) expect(sanitizeSettings({ auctionOnDecline: bad }).errors).toHaveLength(1);
  });

  it('targetWorth: null or a listed value; anything else is the default of the mode (never an error)', () => {
    expect(TARGET_OPTIONS).toEqual([null, 2500000, 3000000, 4000000, 5000000, 7500000, 10000000]);
    for (const ok of TARGET_OPTIONS) {
      const r = sanitizeSettings({ mode: 'quick', targetWorth: ok });
      expect(r.errors).toEqual([]);
      expect(r.settings.targetWorth).toBe(ok);
    }
    for (const bad of [0, 1, -3000000, 3000001, 1e12, '3000000', 'off', true, false, NaN, [], {}, [3000000]]) {
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

  it('reports every bad value and keeps the good ones', () => {
    const r = sanitizeSettings({ mode: 'x', dice: 'fair', auctionOnDecline: 'no' });
    expect(r.errors).toHaveLength(2);
    expect(r.settings).toEqual({ dice: 'fair' });
  });

  it('ignores unknown keys, including the retired goal / round / snatch settings', () => {
    const r = sanitizeSettings({ mode: 'classic', goal: 5, maxRounds: 999, startCash: 1, snatches: 9, debug: true, seed: 1 });
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
  it('fills the defaults: standard mode / lucky dice / auction on decline', () => {
    const defaults = { mode: 'standard', dice: 'lucky', auctionOnDecline: true, targetWorth: 5000000 };
    expect(ROOM_DEFAULTS).toEqual(defaults);
    expect(normalizeSettings(undefined)).toEqual(defaults);
    expect(normalizeSettings({ mode: 'nope', dice: 'x' })).toEqual(defaults);
    expect(normalizeSettings({ mode: 'quick' })).toEqual({ ...defaults, mode: 'quick' });
  });

  it('the win target follows the mode: a missing or unusable one is the mode default, classic is never unlimited', () => {
    expect(normalizeSettings({ mode: 'classic' }).targetWorth).toBe(3000000);
    expect(normalizeSettings({ mode: 'classic', targetWorth: null }).targetWorth).toBe(3000000);
    expect(normalizeSettings({ mode: 'classic', targetWorth: 99 }).targetWorth).toBe(3000000);
    expect(normalizeSettings({ mode: 'classic', targetWorth: 7500000 }).targetWorth).toBe(7500000);
    expect(normalizeSettings({ mode: 'quick', targetWorth: null }).targetWorth).toBeNull();
    expect(normalizeSettings({ targetWorth: 2500000 })).toEqual({ ...ROOM_DEFAULTS, targetWorth: 2500000 });
    // a record saved before the target existed (no key) gets the default of its mode
    expect(normalizeSettings({ mode: 'quick', dice: 'fair', auctionOnDecline: false })).toEqual({ mode: 'quick', dice: 'fair', auctionOnDecline: false, targetWorth: 5000000 });
    // normalising twice changes nothing
    for (const mode of MODE_IDS) for (const t of [...TARGET_OPTIONS, 'x']) {
      const once = normalizeSettings({ mode, targetWorth: t });
      expect(normalizeSettings(once)).toEqual(once);
    }
  });

  it('mergeSettingsPatch: a mode change resets the target unless the same message changes the target', () => {
    const cur = { ...ROOM_DEFAULTS, targetWorth: 4000000 };
    const out = (patch, current = cur) => normalizeSettings(mergeSettingsPatch(current, patch)).targetWorth;
    expect(out({ dice: 'fair' })).toBe(4000000);
    expect(out({ mode: 'standard' })).toBe(4000000); // same mode: nothing resets
    expect(out({ mode: 'quick' })).toBe(5000000);
    expect(out({ mode: 'classic' })).toBe(3000000);
    expect(out({ mode: 'classic', targetWorth: 4000000 })).toBe(3000000); // the client echoes the old value: still a reset
    expect(out({ mode: 'classic', targetWorth: 7500000 })).toBe(7500000); // a deliberate new target wins
    expect(out({ mode: 'classic', targetWorth: null })).toBe(3000000);
    expect(out({ targetWorth: null })).toBeNull();
    expect(out({ mode: 'standard' }, { ...ROOM_DEFAULTS, mode: 'classic', targetWorth: 2500000 })).toBe(5000000);
    expect(mergeSettingsPatch(undefined, undefined)).toEqual({});
    const same = { ...cur };
    mergeSettingsPatch(cur, { mode: 'classic' });
    expect(cur).toEqual(same); // never mutates
  });

  it('returns a fresh object and describes itself', () => {
    const a = normalizeSettings();
    a.mode = 'x';
    expect(normalizeSettings().mode).toBe('standard');
    expect(describeSettings({ mode: 'classic', dice: 'fair' })).toBe('classic / fair dice / auction on / target ₹30L');
    expect(describeSettings({ mode: 'quick', targetWorth: null })).toBe('quick / lucky dice / auction on / no target');
  });
});
