import { describe, it, expect } from 'vitest';
import { sanitizeSettings, normalizeSettings, ROOM_DEFAULTS, parseMaxPlayers, MODE_IDS, DICE_MODES, describeSettings } from './settings.js';

describe('sanitizeSettings (strict, untrusted input)', () => {
  it('missing / empty means "nothing chosen"', () => {
    expect(sanitizeSettings(undefined)).toEqual({ settings: {}, errors: [] });
    expect(sanitizeSettings(null)).toEqual({ settings: {}, errors: [] });
    expect(sanitizeSettings({}).settings).toEqual({});
    expect(sanitizeSettings({ mode: undefined }).errors).toEqual([]);
  });

  it('accepts valid values', () => {
    const r = sanitizeSettings({ mode: 'quick', dice: 'fair', auctionOnDecline: false });
    expect(r.errors).toEqual([]);
    expect(r.settings).toEqual({ mode: 'quick', dice: 'fair', auctionOnDecline: false });
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
    const defaults = { mode: 'standard', dice: 'lucky', auctionOnDecline: true };
    expect(ROOM_DEFAULTS).toEqual(defaults);
    expect(normalizeSettings(undefined)).toEqual(defaults);
    expect(normalizeSettings({ mode: 'nope', dice: 'x' })).toEqual(defaults);
    expect(normalizeSettings({ mode: 'quick' })).toEqual({ ...defaults, mode: 'quick' });
  });

  it('returns a fresh object and describes itself', () => {
    const a = normalizeSettings();
    a.mode = 'x';
    expect(normalizeSettings().mode).toBe('standard');
    expect(describeSettings({ mode: 'classic', dice: 'fair' })).toBe('classic / fair dice / auction on');
  });
});
