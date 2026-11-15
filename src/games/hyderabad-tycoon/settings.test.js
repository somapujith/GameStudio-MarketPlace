// The lobby schema in the manifest must never drift from what the server accepts
// (worker/settings.js is the source of truth) or from the engine defaults (shared/engine.js).
import { describe, expect, it } from 'vitest';
import * as server from '../../../worker/settings.js';
import { DEFAULT_SETTINGS, MODES as ENGINE_MODES } from '@shared/index.js';
import { LOBBY_SETTINGS, SETTINGS_SCHEMA, TABLE_RULES, MODES, TARGET_OPTIONS, DEFAULT_TARGET_WORTH, settingsSummary } from './settings.js';
import { fieldOptions, formatValue, resolveSettings, settingsMessage } from '@/components/online/settings.js';

const field = (key) => SETTINGS_SCHEMA.find((f) => f.key === key);

describe('settings schema vs worker/settings.js', () => {
  it('describes exactly the host settings the server accepts', () => {
    expect(SETTINGS_SCHEMA.map((f) => f.key).sort()).toEqual(Object.keys(server.ROOM_DEFAULTS).sort());
  });

  it('uses the server defaults, which are the engine defaults', () => {
    for (const f of SETTINGS_SCHEMA) expect(f.default, f.key).toEqual(server.ROOM_DEFAULTS[f.key]);
    expect(server.ROOM_DEFAULTS).toEqual(DEFAULT_SETTINGS);
  });

  it('mode and dice options equal the server lists; the modes are the engine modes', () => {
    expect(field('mode').options.map((o) => o.value)).toEqual(server.MODE_IDS);
    expect(field('dice').options.map((o) => o.value)).toEqual(server.DICE_MODES);
    expect(MODES).toBe(ENGINE_MODES);
    expect(field('mode').options.map((o) => o.label)).toEqual(['Standard City Hustle', 'Quick Chai Break', 'Classic Long Game']);
  });

  it('the win target options are the server list, in order, with the contract labels', () => {
    const f = field('targetWorth');
    expect(f.options.map((o) => o.value)).toEqual([...server.TARGET_OPTIONS]);
    expect(f.options.map((o) => o.label)).toEqual(['Off', '₹25L', '₹30L', '₹40L', '₹50L', '₹75L', '₹1Cr']);
    expect(f.label).toBe('Win target (net worth)');
    expect(f.help).toBe('First player to reach this net worth wins. Net worth = cash + districts + half the upgrades.');
    expect(f.default).toBe(DEFAULT_TARGET_WORTH);
    expect(f.default).toBe(5000000);
    // the per-mode defaults the schema knows are the engine's (and so the server's)
    expect(f.dependsOn).toEqual({ key: 'mode', defaults: { standard: 5000000, quick: 5000000, classic: 3000000 } });
    for (const [mode, def] of Object.entries(f.dependsOn.defaults)) expect(server.normalizeSettings({ mode }).targetWorth).toBe(def);
    expect(TARGET_OPTIONS).toEqual(server.TARGET_OPTIONS);
  });

  it('"Off" is offered with a round limit, never for Classic; the default is marked per mode', () => {
    const f = field('targetWorth');
    const labels = (mode) => fieldOptions(f, { mode }).map((o) => o.label);
    expect(labels('standard')).toEqual(['Off', '₹25L', '₹30L', '₹40L', '₹50L (default)', '₹75L', '₹1Cr']);
    expect(labels('quick')).toEqual(['Off', '₹25L', '₹30L', '₹40L', '₹50L (default)', '₹75L', '₹1Cr']);
    expect(labels('classic')).toEqual(['₹25L', '₹30L (default)', '₹40L', '₹50L', '₹75L', '₹1Cr']);
    // what the UI offers for a mode is always accepted by the server as is (nothing is silently rewritten)
    for (const mode of ['standard', 'quick', 'classic']) {
      for (const o of fieldOptions(f, { mode })) expect(server.normalizeSettings({ mode, targetWorth: o.value }).targetWorth, `${mode} ${o.label}`).toBe(o.value);
    }
    expect(formatValue(f, null)).toBe('Off');
    expect(formatValue(f, 5000000, { compact: true })).toBe('₹50L');
  });

  it('picking another mode resets the target to its default, exactly like the server', () => {
    const msg = (current, patch) => settingsMessage(SETTINGS_SCHEMA, current, patch).settings;
    const cur = { mode: 'standard', dice: 'lucky', auctionOnDecline: true, targetWorth: 4000000 };
    expect(msg(cur, { mode: 'classic' }).targetWorth).toBe(3000000);
    expect(msg(cur, { mode: 'quick' }).targetWorth).toBe(5000000);
    expect(msg(cur, { mode: 'standard' }).targetWorth).toBe(4000000); // the same mode again: no reset
    expect(msg(cur, { targetWorth: null }).targetWorth).toBeNull();
    expect(msg(cur, { mode: 'classic', targetWorth: 7500000 }).targetWorth).toBe(7500000);
    expect(msg({ ...cur, mode: 'classic', targetWorth: null }, { mode: 'standard' }).targetWorth).toBe(5000000);
    // the full set goes out: mode, targetWorth, dice, auctionOnDecline
    expect(Object.keys(msg(cur, { mode: 'classic' })).sort()).toEqual(['auctionOnDecline', 'dice', 'mode', 'targetWorth']);
    // the server agrees with every combination the lobby can send
    for (const from of ['standard', 'quick', 'classic']) {
      for (const to of ['standard', 'quick', 'classic']) {
        const current = server.normalizeSettings({ mode: from, targetWorth: 4000000 });
        const sent = msg(current, { mode: to });
        const stored = server.normalizeSettings(server.mergeSettingsPatch(current, sent));
        expect(stored.targetWorth, `${from} -> ${to}`).toBe(from === to ? 4000000 : server.normalizeSettings({ mode: to }).targetWorth);
        expect(stored.targetWorth).toBe(sent.targetWorth);
      }
    }
    // a room from before the target existed shows the default
    expect(resolveSettings(SETTINGS_SCHEMA, { mode: 'classic', dice: 'fair' }).targetWorth).toBe(5000000);
  });

  it('every option the UI offers passes the server validation', () => {
    for (const f of SETTINGS_SCHEMA) {
      for (const o of f.options || [{ value: true }, { value: false }]) {
        const res = server.sanitizeSettings({ [f.key]: o.value });
        expect(res.errors, `${f.key}=${o.value}`).toEqual([]);
        expect(res.settings[f.key]).toEqual(o.value);
      }
    }
  });

  it('field shapes follow the contract', () => {
    for (const f of SETTINGS_SCHEMA) {
      expect(['segmented', 'stepper', 'toggle']).toContain(f.type);
      expect(typeof f.label).toBe('string');
      expect('default' in f).toBe(true);
      if (f.type === 'segmented') expect(f.options.length).toBeGreaterThan(1);
    }
  });
});

describe('lobby line and summary', () => {
  it('the lobby shows the mode and the win target, with the table rules in one line', () => {
    expect(LOBBY_SETTINGS).toEqual(['mode', 'targetWorth']);
    expect(TABLE_RULES).toBe('One die · 3 business levels per district · Chai, Auto shortcuts and city rush hours');
  });

  it('summarises each mode', () => {
    expect(settingsSummary({ mode: 'standard' })).toBe('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
    expect(settingsSummary({ mode: 'quick' })).toBe('Quick Chai Break · 12 rounds · richest wins · ₹50L target');
    expect(settingsSummary({ mode: 'classic' })).toBe('Classic Long Game · first to ₹30L wins');
    expect(settingsSummary()).toBe('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
    expect(settingsSummary({ mode: 'nope' })).toBe('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
    expect(settingsSummary({ mode: 'standard', targetWorth: 3000000 })).toBe('Standard City Hustle · 20 rounds · richest wins · ₹30L target');
    expect(settingsSummary({ mode: 'standard', targetWorth: null })).toBe('Standard City Hustle · 20 rounds · richest wins');
    expect(settingsSummary({ mode: 'classic', targetWorth: 10000000 })).toBe('Classic Long Game · first to ₹1Cr wins');
  });
});
