// The lobby schema in the manifest must never drift from what the server accepts
// (worker/settings.js is the source of truth) or from the engine defaults (shared/engine.js).
import { describe, expect, it } from 'vitest';
import * as server from '../../../worker/settings.js';
import { DEFAULT_SETTINGS, MODES as ENGINE_MODES, RULE_FIELDS, RULE_GROUPS, RULE_KEYS, ruleDefaults, ruleField } from '@shared/index.js';
import {
  LOBBY_SETTINGS,
  MODE_IDS,
  SETTINGS_GROUPS,
  SETTINGS_SCHEMA,
  SHORT_LABELS,
  TABLE_RULES,
  MODES,
  TARGET_OPTIONS,
  DEFAULT_TARGET_WORTH,
  customRuleCount,
  settingsSummary,
  snatchNote,
} from './settings.js';
import { DEFAULT_MAP } from '@shared/maps.js';
import { fieldOptions, formatValue, resolveSettings, settingsMessage } from '@/components/online/settings.js';

const field = (key) => SETTINGS_SCHEMA.find((f) => f.key === key);

describe('settings schema vs worker/settings.js', () => {
  it('describes exactly the host settings the server accepts', () => {
    // the rooms store the mode and the rules; the map (a picker, not a rule) is stored only when it is not the home map
    expect(SETTINGS_SCHEMA.map((f) => f.key).sort()).toEqual([...Object.keys(server.ROOM_DEFAULTS), 'map'].sort());
  });

  it('uses the server defaults, which are the engine defaults', () => {
    for (const f of SETTINGS_SCHEMA) expect(f.default, f.key).toEqual(f.key === 'map' ? DEFAULT_MAP : server.ROOM_DEFAULTS[f.key]);
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
    expect(f.help).toBe(ruleField('targetWorth').help); // the one source of truth: shared/ruleSettings.js
    expect(f.help).toMatch(/^First player to reach this net worth wins\./);
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
    const cur = { mode: 'standard', dice: 'lucky', targetWorth: 4000000 };
    expect(msg(cur, { mode: 'classic' }).targetWorth).toBe(3000000);
    expect(msg(cur, { mode: 'quick' }).targetWorth).toBe(5000000);
    expect(msg(cur, { mode: 'standard' }).targetWorth).toBe(4000000); // the same mode again: no reset
    expect(msg(cur, { targetWorth: null }).targetWorth).toBeNull();
    expect(msg(cur, { mode: 'classic', targetWorth: 7500000 }).targetWorth).toBe(7500000);
    expect(msg({ ...cur, mode: 'classic', targetWorth: null }, { mode: 'standard' }).targetWorth).toBe(5000000);
    // the full set goes out: the mode and every rule the server stores
    expect(Object.keys(msg(cur, { mode: 'classic' })).sort()).toEqual([...Object.keys(server.ROOM_DEFAULTS), 'map'].sort());
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
    // a room from before a rule existed shows the default of ITS mode, exactly what the server stores for it
    const old = { mode: 'classic', dice: 'fair' };
    expect(resolveSettings(SETTINGS_SCHEMA, old).targetWorth).toBe(3000000);
    expect(resolveSettings(SETTINGS_SCHEMA, old)).toEqual({ ...server.normalizeSettings(old), map: DEFAULT_MAP });
  });

  it('every value the UI offers passes the server validation, as is', () => {
    for (const f of SETTINGS_SCHEMA) {
      const offered =
        f.type === 'toggle'
          ? [true, false]
          : f.type === 'stepper'
            ? [f.min, f.max, f.default, ...(f.options || []).map((o) => o.value)].filter((v) => v !== null)
            : f.options.map((o) => o.value);
      for (const value of offered) {
        const res = server.sanitizeSettings({ [f.key]: value });
        expect(res.errors, `${f.key}=${value}`).toEqual([]);
        expect(res.settings[f.key], `${f.key}=${value}`).toEqual(value);
      }
    }
  });

  it('every rule comes from shared/ruleSettings.js: same key, group, range, help and per-mode defaults', () => {
    for (const r of RULE_FIELDS) {
      const f = field(r.key);
      expect(f, r.key).toBeTruthy();
      expect(f.group).toBe(r.group);
      expect(f.help).toBe(r.help);
      expect(f.label).toBe(SHORT_LABELS[r.key] || r.label);
      if (r.type === 'number') expect([f.min, f.max, f.step]).toEqual([r.min, r.max, r.step]);
      for (const mode of MODE_IDS) expect(resolveSettings(SETTINGS_SCHEMA, { mode })[r.key], `${r.key} in ${mode}`).toEqual(r.default(mode));
    }
    for (const key of Object.keys(SHORT_LABELS)) expect(ruleField(key), `short label for an unknown rule ${key}`).toBeTruthy();
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

describe('auction timer in the lobby editor', () => {
  it('appears as a stepper in the Timers group, after the trade timer, with the shared range', () => {
    const f = field('auctionSeconds');
    expect(f).toMatchObject({ group: 'timers', type: 'stepper', unit: 'seconds', min: 10, max: 90, step: 5, default: 20, label: 'Auction timer' });
    const keys = SETTINGS_SCHEMA.map((x) => x.key);
    expect(keys.indexOf('auctionSeconds')).toBe(keys.indexOf('tradeSeconds') + 1);
    expect(LOBBY_SETTINGS).toContain('auctionSeconds');
  });
});

describe('lobby line and summary', () => {
  it('the lobby shows the mode and every host rule, grouped, with the table rules in one line', () => {
    expect(LOBBY_SETTINGS).toEqual(['mode', ...RULE_KEYS]);
    expect(SETTINGS_GROUPS.map((g) => g.id)).toEqual(RULE_GROUPS.map((g) => g.id));
    expect(TABLE_RULES).toBe('One die · 3 business levels per district · Chai, Auto shortcuts and city rush hours');
  });

  it('summarises each mode', () => {
    expect(settingsSummary({ mode: 'standard' })).toBe('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
    expect(settingsSummary({ mode: 'quick' })).toBe('Quick Chai Break · 12 rounds · richest wins · ₹50L target');
    expect(settingsSummary({ mode: 'classic' })).toBe('Classic Long Game · first to ₹30L wins');
    expect(settingsSummary()).toBe('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
    expect(settingsSummary({ mode: 'nope' })).toBe('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
    // the room's own limits, with "Custom rules (N)" whenever a rule differs from the mode's defaults
    expect(settingsSummary({ mode: 'standard', targetWorth: 3000000 })).toBe('Standard City Hustle · 20 rounds · richest wins · ₹30L target · Custom rules (1)');
    expect(settingsSummary({ mode: 'standard', targetWorth: null })).toBe('Standard City Hustle · 20 rounds · richest wins · Custom rules (1)');
    expect(settingsSummary({ mode: 'classic', targetWorth: 10000000 })).toBe('Classic Long Game · first to ₹1Cr wins · Custom rules (1)');
    expect(settingsSummary({ mode: 'quick', maxRounds: 30, startCash: 3000000 })).toBe('Quick Chai Break · 30 rounds · richest wins · ₹50L target · Custom rules (2)');
  });

  it('the mode defaults are not custom: a stock room of any mode carries no tag, a missing key is not a change', () => {
    for (const mode of MODE_IDS) {
      expect(customRuleCount({ mode, ...ruleDefaults(mode) }), mode).toBe(0);
      expect(settingsSummary({ mode, ...ruleDefaults(mode) }), mode).not.toContain('Custom rules');
    }
    expect(customRuleCount({ mode: 'standard' })).toBe(0);
    expect(customRuleCount(undefined)).toBe(0);
    expect(customRuleCount({ mode: 'standard', turnSeconds: 90, dice: 'fair', snatches: 0 })).toBe(3);
  });

  it('the Snatch explainer says what the numbers mean, with plurals and the off case', () => {
    expect(snatchNote({})).toBe('Everyone starts with 1 Snatch button; after someone buys a district the others get 5 seconds to press Snatch.');
    expect(snatchNote({ snatches: 2, snatchMs: 3000 })).toBe('Everyone starts with 2 Snatch buttons; after someone buys a district the others get 3 seconds to press Snatch.');
    expect(snatchNote({ snatches: 1, snatchMs: 1000 })).toContain('1 second to press Snatch');
    expect(snatchNote({ snatches: 0 })).toBe('Snatch is off: nobody gets a Snatch button this game.');
    const snatch = SETTINGS_GROUPS.find((g) => g.id === 'snatch');
    expect(typeof snatch.note).toBe('function');
    expect(SETTINGS_GROUPS.filter((g) => g.id !== 'snatch').every((g) => !g.note)).toBe(true);
  });
});
