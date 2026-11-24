// The lobby schema must never drift from shared/tiffin-centre/catalog.js (SETTINGS_SPEC) or from what the server
// accepts (worker/games/tiffin-centre.js, checked as soon as that adapter exists).
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LEVELS, MAX_LEVEL, PACE, SETTINGS_SPEC } from '@shared/tiffin-centre/catalog.js';
import { LOBBY_SETTINGS, PACE_IDS, SETTINGS_SCHEMA, settingsSummary } from './settings.js';

const field = (key) => SETTINGS_SCHEMA.find((f) => f.key === key);

// `import.meta.glob` finds nothing (instead of failing) while the server adapter has not landed yet.
const adapterFiles = import.meta.glob('../../../worker/games/tiffin-centre.js');
const loadAdapter = Object.values(adapterFiles)[0];

describe('settings schema vs SETTINGS_SPEC', () => {
  it('describes exactly the host settings of the spec', () => {
    expect(SETTINGS_SCHEMA.map((f) => f.key)).toEqual(Object.keys(SETTINGS_SPEC));
    expect(LOBBY_SETTINGS).toEqual(['level', 'pace']);
    for (const k of LOBBY_SETTINGS) expect(field(k)).toBeTruthy();
  });

  it('level is a stepper with the spec limits and default', () => {
    expect(field('level')).toMatchObject({ type: 'stepper', min: SETTINGS_SPEC.level.min, max: SETTINGS_SPEC.level.max, step: 1, default: SETTINGS_SPEC.level.default });
    expect(field('level').min).toBe(1);
    expect(field('level').max).toBe(MAX_LEVEL);
    expect(MAX_LEVEL).toBe(12);
  });

  it('pace is a segmented control over exactly the spec options, labelled from PACE', () => {
    const f = field('pace');
    expect(f.type).toBe('segmented');
    expect(f.options.map((o) => o.value)).toEqual(SETTINGS_SPEC.pace.options);
    expect(PACE_IDS).toEqual(SETTINGS_SPEC.pace.options);
    expect(f.options.map((o) => o.label)).toEqual(SETTINGS_SPEC.pace.options.map((p) => PACE[p].label));
    expect(f.default).toBe(SETTINGS_SPEC.pace.default);
    expect(f.options.map((o) => o.value)).toContain(f.default);
  });

  it('defaults equal DEFAULT_SETTINGS', () => {
    expect(Object.fromEntries(SETTINGS_SCHEMA.map((f) => [f.key, f.default]))).toEqual(DEFAULT_SETTINGS);
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

describe('summary', () => {
  it('names the level and the pace', () => {
    expect(settingsSummary({ level: 3, pace: 'rush' })).toBe('Level 3: Poori Morning, Rush hour pace');
    expect(settingsSummary({ level: 12, pace: 'relaxed' })).toBe('Level 12: Festival Day, Relaxed pace');
    expect(settingsSummary(DEFAULT_SETTINGS)).toBe('Level 1: Sunrise Dosa, Normal pace');
  });

  it('falls back to the defaults for a missing or illegal value', () => {
    for (const bad of [undefined, null, {}, 'x', { level: 0, pace: 'nope' }, { level: 13 }, { level: 2.5 }, { level: '3' }]) {
      expect(settingsSummary(bad), JSON.stringify(bad)).toMatch(/^Level \d+: .+, (Relaxed|Normal|Rush hour) pace$/);
    }
    expect(settingsSummary({ level: 99, pace: 'rush' })).toBe('Level 1: Sunrise Dosa, Rush hour pace');
  });

  it('every legal combination has a level name', () => {
    for (let n = SETTINGS_SPEC.level.min; n <= SETTINGS_SPEC.level.max; n++) {
      for (const pace of PACE_IDS) expect(settingsSummary({ level: n, pace })).toBe(`Level ${n}: ${LEVELS[n].name}, ${PACE[pace].label} pace`);
    }
  });
});

describe.skipIf(!loadAdapter)('settings schema vs worker/games/tiffin-centre.js', () => {
  it('the adapter accepts every value the lobby offers, as is, and has the same defaults', async () => {
    const adapter = (await loadAdapter()).default;
    expect(adapter.defaultSettings).toEqual(DEFAULT_SETTINGS);
    for (const f of SETTINGS_SCHEMA) {
      const offered = f.type === 'stepper' ? [f.min, f.max, f.default] : f.options.map((o) => o.value);
      for (const value of offered) {
        const res = adapter.validateSettings({ ...DEFAULT_SETTINGS, [f.key]: value });
        expect(res.ok, `${f.key}=${value}`).toBe(true);
        expect(res.settings[f.key], `${f.key}=${value}`).toEqual(value);
      }
    }
  });

  it('the adapter fills defaults and refuses values outside the schema', async () => {
    const adapter = (await loadAdapter()).default;
    expect(adapter.validateSettings({}).settings).toEqual(DEFAULT_SETTINGS);
    expect(adapter.validateSettings({ level: SETTINGS_SPEC.level.max + 1 }).ok).toBe(false);
    expect(adapter.validateSettings({ level: 0 }).ok).toBe(false);
    expect(adapter.validateSettings({ pace: 'turbo' }).ok).toBe(false);
  });
});
