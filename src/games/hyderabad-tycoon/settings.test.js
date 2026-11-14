// The lobby schema in the manifest must never drift from what the server accepts
// (worker/settings.js is the source of truth) or from the engine defaults (shared/engine.js).
import { describe, expect, it } from 'vitest';
import * as server from '../../../worker/settings.js';
import { DEFAULT_SETTINGS, MODES as ENGINE_MODES } from '@shared/index.js';
import { LOBBY_SETTINGS, SETTINGS_SCHEMA, TABLE_RULES, MODES, settingsSummary } from './settings.js';

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
  it('the lobby shows only the mode, with the table rules in one line', () => {
    expect(LOBBY_SETTINGS).toEqual(['mode']);
    expect(TABLE_RULES).toBe('One die · 3 business levels per district · Chai, Auto shortcuts and city rush hours');
  });

  it('summarises each mode', () => {
    expect(settingsSummary({ mode: 'standard' })).toBe('Standard City Hustle · 20 rounds · richest wins');
    expect(settingsSummary({ mode: 'quick' })).toBe('Quick Chai Break · 12 rounds · richest wins');
    expect(settingsSummary({ mode: 'classic' })).toBe('Classic Long Game · last one standing wins');
    expect(settingsSummary()).toBe('Standard City Hustle · 20 rounds · richest wins');
    expect(settingsSummary({ mode: 'nope' })).toBe('Standard City Hustle · 20 rounds · richest wins');
  });
});
