// The pure model behind the host's "Game rules" editor: value formatting per unit, stepper and slider maths, the patches
// the controls build, grouping and the "Custom rules" count. Run against the REAL Hyderabad Tycoon schema (which is built
// from shared/ruleSettings.js) so a new or changed rule is covered without editing this file.
import { describe, it, expect } from 'vitest';
import {
  changedFields,
  customCount,
  fieldDefault,
  fieldOptions,
  formatValue,
  groupFields,
  groupNote,
  isDefaultValue,
  lobbyFields,
  presetPatch,
  rangeText,
  resetPatch,
  resolveSettings,
  settingsMessage,
  sliderPos,
  sliderSteps,
  sliderValue,
  snapField,
  stepField,
  stepValue,
} from './settings.js';
import { LOBBY_SETTINGS, MODE_IDS, SETTINGS_GROUPS, SETTINGS_SCHEMA } from '@/games/hyderabad-tycoon/settings.js';
import { RULE_FIELDS, RULE_KEYS, customRuleCount, customRuleKeys, isRuleValue, ruleDefaults, ruleField, sanitizeRules } from '@shared/ruleSettings.js';
import * as server from '../../../worker/settings.js';

const GAME = { settings: SETTINGS_SCHEMA, lobbySettings: LOBBY_SETTINGS, settingsGroups: SETTINGS_GROUPS };
const field = (key) => SETTINGS_SCHEMA.find((f) => f.key === key);
const fields = lobbyFields(GAME);
const numbers = SETTINGS_SCHEMA.filter((f) => f.type === 'stepper');

describe('formatValue: every unit reads naturally', () => {
  it('rupees: the full amount, or compact; a crore is a crore', () => {
    const cash = field('startCash');
    expect(formatValue(cash, 1600000)).toBe('₹16,00,000');
    expect(formatValue(cash, 1600000, { compact: true })).toBe('₹16L');
    expect(formatValue(cash, 1500000)).toBe('₹15L'); // a quick pick keeps its own label
    expect(formatValue(cash, 1500000, { plain: true })).toBe('₹15,00,000'); // spoken in full, whatever the pick is called
    expect(formatValue(field('turnSeconds'), 60, { plain: true })).toBe('60 s');
    expect(formatValue(cash, 100000000, { compact: true })).toBe('₹10Cr');
    expect(formatValue(cash, 125000000, { compact: true })).toBe('₹12.5Cr');
    expect(formatValue(cash, 500000, { compact: true })).toBe('₹5L');
    expect(formatValue(field('passStart'), 0)).toBe('₹0');
    expect(formatValue(field('passStart'), 200000)).toBe('₹2,00,000');
    expect(formatValue(field('trafficFine'), 25000, { compact: true })).toBe('₹25k');
  });
  it('seconds: "60 s"; milliseconds are shown as seconds: "5 s", "3.5 s"', () => {
    expect(formatValue(field('turnSeconds'), 60)).toBe('60 s');
    expect(formatValue(field('tradeSeconds'), 45)).toBe('45 s');
    expect(formatValue(field('snatchMs'), 5000)).toBe('5 s');
    expect(formatValue(field('snatchMs'), 3000)).toBe('3 s');
    expect(formatValue(field('snatchMs'), 10000)).toBe('10 s');
    expect(formatValue({ ...field('snatchMs') }, 3500)).toBe('3.5 s');
  });
  it('choices use their own labels; a null is "No limit" / "Off"; switches are On / Off; plain counts are numbers', () => {
    expect(formatValue(field('rentPercent'), 125)).toBe('125%');
    expect(formatValue(field('maxRounds'), null)).toBe('No limit');
    expect(formatValue(field('maxRounds'), 30)).toBe('30 rounds');
    expect(formatValue(field('eventEvery'), 0)).toBe('Off');
    expect(formatValue(field('eventEvery'), 4)).toBe('Every 4 rounds');
    expect(formatValue(field('dice'), 'fair')).toBe('Fair');
    expect(formatValue(field('targetWorth'), null)).toBe('Off');
    expect(formatValue(field('auctionOnDecline'), true)).toBe('On');
    expect(formatValue(field('requireFullSet'), false)).toBe('Off');
    expect(formatValue(field('chaiCap'), 2)).toBe('2');
    expect(formatValue(field('snatches'), 0)).toBe('0');
  });
  it('the legal range of each number, in its own unit', () => {
    expect(rangeText(field('startCash'))).toBe('₹5L - ₹10Cr');
    expect(rangeText(field('passStart'))).toBe('₹0 - ₹10L');
    expect(rangeText(field('targetWorth'))).toBe('₹10L - ₹50Cr');
    expect(rangeText(field('turnSeconds'))).toBe('15 s - 180 s');
    expect(rangeText(field('snatchMs'))).toBe('3 s - 10 s');
    expect(rangeText(field('chaiCap'))).toBe('1 - 3');
    expect(rangeText(field('dice'))).toBe(''); // a choice has no range
    expect(rangeText(undefined)).toBe('');
  });
});

describe('stepper: -/+ by step, clamped to min and max, always on the grid', () => {
  it('moves one step and stops at the ends', () => {
    const t = field('turnSeconds'); // 15..180 step 5
    expect(stepValue(t, 60, 1)).toBe(65);
    expect(stepValue(t, 60, -1)).toBe(55);
    expect(stepValue(t, 15, -1)).toBe(15);
    expect(stepValue(t, 180, 1)).toBe(180);
    const cash = field('startCash'); // 5L..10Cr step 1L
    expect(stepValue(cash, 1500000, 1)).toBe(1600000);
    expect(stepValue(cash, 500000, -1)).toBe(500000);
    expect(stepValue(cash, 100000000, 1)).toBe(100000000);
    const snatch = field('snatchMs'); // 3000..10000 step 1000
    expect(stepValue(snatch, 5000, 1)).toBe(6000);
    expect(stepValue(snatch, 3000, -1)).toBe(3000);
  });
  it('a value off the grid snaps to the next legal one in the direction pressed', () => {
    const t = field('turnSeconds');
    expect(stepValue(t, 62, 1)).toBe(65);
    expect(stepValue(t, 62, -1)).toBe(60);
    expect(stepValue(t, 5, 1)).toBe(20); // below the minimum: clamped to it, then one step
    expect(stepValue(t, 5, -1)).toBe(15);
    expect(stepValue(t, 999, -1)).toBe(175); // above the maximum: clamped, then one step down
  });
  it('from "Off" (null) the first press lands on the default, whichever way it is pressed', () => {
    const target = field('targetWorth');
    expect(stepField(target, null, 1, { mode: 'standard' })).toBe(5000000);
    expect(stepField(target, null, -1, { mode: 'classic' })).toBe(3000000);
    expect(stepField(target, 5000000, 1, { mode: 'standard' })).toBe(5500000);
    expect(stepField(field('startCash'), undefined, 1, {})).toBe(1500000);
  });
  it('every press from every legal value lands on a legal value the server accepts', () => {
    for (const f of numbers) {
      const rule = ruleField(f.key);
      for (const v of [f.min, f.default, f.max, f.min + f.step, f.max - f.step]) {
        for (const dir of [1, -1]) {
          const next = stepValue(f, v, dir);
          expect(isRuleValue(rule, next), `${f.key} ${v} ${dir > 0 ? '+' : '-'} -> ${next}`).toBe(true);
        }
      }
    }
  });
  it('snapField clamps and snaps whatever it is given', () => {
    const t = field('turnSeconds');
    expect(snapField(t, 62)).toBe(60);
    expect(snapField(t, 63)).toBe(65);
    expect(snapField(t, 0)).toBe(15);
    expect(snapField(t, 1e9)).toBe(180);
    expect(snapField(t, 'abc')).toBe(t.default);
    expect(snapField(field('startCash'), 1234567)).toBe(1200000);
  });
});

describe('slider: every position is a legal value and the mapping round-trips', () => {
  it('walks the whole grid of every number rule, plain or curved', () => {
    for (const f of numbers) {
      const rule = ruleField(f.key);
      const steps = sliderSteps(f);
      expect(steps, f.key).toBe((f.max - f.min) / f.step);
      expect(sliderValue(f, 0), f.key).toBe(f.min);
      expect(sliderValue(f, steps), f.key).toBe(f.max);
      let last = -Infinity;
      for (let p = 0; p <= steps; p += Math.max(1, Math.floor(steps / 200))) {
        const v = sliderValue(f, p);
        expect(isRuleValue(rule, v), `${f.key}@${p}=${v}`).toBe(true);
        expect(v, `${f.key} is monotonic`).toBeGreaterThanOrEqual(last);
        last = v;
        // a position round-trips through its value (the bent track is the same, a bit coarser at the low end)
        expect(sliderValue(f, sliderPos(f, v)), `${f.key}@${p}`).toBe(v);
      }
    }
  });
  it('the wide rupee ranges bend the track so the low end is not a few pixels wide; narrow ones do not', () => {
    expect(field('startCash').scale).toBe('curve');
    expect(field('targetWorth').scale).toBe('curve');
    expect(field('turnSeconds').scale).toBeUndefined();
    expect(field('chaiCap').scale).toBeUndefined();
    const cash = field('startCash');
    // the first 10 percent of the track covers a few lakhs, not the first 10 crore
    expect(sliderValue(cash, Math.round(sliderSteps(cash) * 0.1))).toBeLessThan(5000000);
  });
  it('a null or junk value sits at the default; a value outside the range is clamped', () => {
    const t = field('turnSeconds');
    expect(sliderPos(t, null, {})).toBe(sliderPos(t, 60, {}));
    expect(sliderPos(t, 5, {})).toBe(0);
    expect(sliderPos(t, 9999, {})).toBe(sliderSteps(t));
    expect(sliderPos({ key: 'x', type: 'stepper', default: 3 }, 3, {})).toBe(0); // no range: no slider
  });
});

describe('patches the controls build', () => {
  it('a preset resets exactly the rules that follow the mode: start cash, round limit, win target', () => {
    expect(presetPatch(SETTINGS_SCHEMA, 'mode', 'quick')).toEqual({ mode: 'quick', startCash: 2000000, maxRounds: 12, targetWorth: 5000000 });
    expect(presetPatch(SETTINGS_SCHEMA, 'mode', 'classic')).toEqual({ mode: 'classic', startCash: 1500000, maxRounds: null, targetWorth: 3000000 });
    expect(presetPatch(SETTINGS_SCHEMA, 'mode', 'standard')).toEqual({ mode: 'standard', startCash: 1500000, maxRounds: 20, targetWorth: 5000000 });
  });
  it('a preset message keeps every other custom rule and goes out as the full set', () => {
    const current = resolveSettings(SETTINGS_SCHEMA, { mode: 'standard', turnSeconds: 90, dice: 'fair', snatches: 0, startCash: 3000000 });
    const sent = settingsMessage(SETTINGS_SCHEMA, current, presetPatch(SETTINGS_SCHEMA, 'mode', 'quick'));
    expect(sent.t).toBe('settings');
    expect(Object.keys(sent.settings).sort()).toEqual(['mode', ...RULE_KEYS].sort());
    expect(sent.settings).toMatchObject({ mode: 'quick', startCash: 2000000, maxRounds: 12, targetWorth: 5000000, turnSeconds: 90, dice: 'fair', snatches: 0 });
  });
  it('one control edit changes only its rule; the others go out at their current values', () => {
    const current = resolveSettings(SETTINGS_SCHEMA, { mode: 'quick' });
    const sent = settingsMessage(SETTINGS_SCHEMA, current, { turnSeconds: 75 }).settings;
    expect(sent).toEqual({ ...current, turnSeconds: 75 });
    expect(settingsMessage(SETTINGS_SCHEMA, current, { maxRounds: null }).settings.maxRounds).toBeNull(); // "No limit" is a value, not a gap
    expect(settingsMessage(SETTINGS_SCHEMA, current, { targetWorth: null }).settings.targetWorth).toBeNull();
  });
  it('resetPatch: every rule back to the default of the current mode (never the mode), or just the named rules', () => {
    const quick = resolveSettings(SETTINGS_SCHEMA, { mode: 'quick', turnSeconds: 90, startCash: 3000000, dice: 'fair' });
    const all = resetPatch(fields, quick);
    expect(Object.keys(all).sort()).toEqual([...RULE_KEYS].sort());
    expect(all).toEqual(ruleDefaults('quick'));
    expect('mode' in all).toBe(false);
    expect(resetPatch(fields, quick, ['turnSeconds'])).toEqual({ turnSeconds: 60 });
    expect(resetPatch(fields, quick, ['startCash'])).toEqual({ startCash: 2000000 }); // quick's own default
    expect(resetPatch(fields, quick, ['nope'])).toEqual({});
    expect(resetPatch(undefined, quick)).toEqual({});
    // applying it leaves nothing custom
    const after = settingsMessage(SETTINGS_SCHEMA, quick, all).settings;
    expect(customCount(fields, after)).toBe(0);
  });
  it('whatever the host does, the server accepts the message as sent and stores the same numbers', () => {
    let room = server.normalizeSettings({});
    const steps = [
      { startCash: 5000000 },
      { turnSeconds: 120, tradeSeconds: 30 },
      presetPatch(SETTINGS_SCHEMA, 'mode', 'classic'),
      { rentPercent: 150, eventEvery: 0, dice: 'fair', auctionOnDecline: false, requireFullSet: false, chaiCap: 3 },
      { snatches: 3, snatchMs: 3000, snatchCardCap: 0 },
      { passStart: 0, trafficFine: 100000 },
      resetPatch(fields, room),
      presetPatch(SETTINGS_SCHEMA, 'mode', 'quick'),
      { maxRounds: null, targetWorth: null }, // quick may run without a round limit, and without a target
    ];
    for (const patch of steps) {
      const sent = settingsMessage(SETTINGS_SCHEMA, resolveSettings(SETTINGS_SCHEMA, room), patch).settings;
      const parsed = server.sanitizeSettings(sent);
      expect(parsed.errors, JSON.stringify(patch)).toEqual([]);
      room = server.normalizeSettings(server.mergeSettingsPatch(room, parsed.settings));
      // what the room stores is what the lobby showed (the UI never lies about the server)
      expect(room, JSON.stringify(patch)).toEqual(sent);
    }
  });
});

describe('grouping', () => {
  it('the mode is a plain field; every rule lands in exactly one of the four groups, in order', () => {
    const { plain, groups } = groupFields(fields, SETTINGS_GROUPS);
    expect(plain.map((f) => f.key)).toEqual(['mode']);
    expect(groups.map((g) => g.id)).toEqual(['money', 'timers', 'rules', 'snatch']);
    expect(groups.flatMap((g) => g.fields.map((f) => f.key))).toEqual(RULE_FIELDS.map((f) => f.key));
    for (const g of groups) for (const f of g.fields) expect(f.group).toBe(g.id);
  });
  it('unknown groups become plain fields, empty groups vanish, junk never throws', () => {
    const fs = [{ key: 'a', type: 'toggle', group: 'x' }, { key: 'b', type: 'toggle', group: 'ghost' }, { key: 'c', type: 'toggle' }];
    const out = groupFields(fs, [{ id: 'x', label: 'X' }, { id: 'empty', label: 'Empty' }, null, { nope: 1 }]);
    expect(out.plain.map((f) => f.key)).toEqual(['b', 'c']);
    expect(out.groups).toEqual([{ id: 'x', label: 'X', fields: [fs[0]] }]);
    expect(groupFields(undefined, undefined)).toEqual({ plain: [], groups: [] });
    expect(groupFields(fs, 'nope').groups).toEqual([]);
  });
  it('a group note is a string or a function of the settings; a broken one is just empty', () => {
    const snatch = groupFields(fields, SETTINGS_GROUPS).groups.find((g) => g.id === 'snatch');
    expect(snatch.note).toBeTypeOf('function');
    expect(groupNote(snatch, { snatches: 2, snatchMs: 4000 })).toBe('Everyone starts with 2 Snatch buttons; after someone buys a district the others get 4 seconds to press Snatch.');
    expect(groupNote({ note: 'Plain text' }, {})).toBe('Plain text');
    expect(groupNote({ note: () => { throw new Error('boom'); } }, {})).toBe('');
    expect(groupNote({ note: () => 42 }, {})).toBe('');
    expect(groupNote({}, {})).toBe('');
    expect(groupNote(null, null)).toBe('');
  });
});

describe('custom rules count', () => {
  it('a stock room of any mode has none, so the badge and the "Custom rules" tag stay away', () => {
    for (const mode of MODE_IDS) {
      const s = resolveSettings(SETTINGS_SCHEMA, { mode });
      expect(customCount(fields, s), mode).toBe(0);
      expect(changedFields(fields, s), mode).toEqual([]);
      for (const f of fields.filter((x) => x.group)) expect(isDefaultValue(f, s[f.key], s), `${mode} ${f.key}`).toBe(true);
    }
  });
  it('picking another mode alone is not custom: its own defaults are the baseline', () => {
    const s = settingsMessage(SETTINGS_SCHEMA, resolveSettings(SETTINGS_SCHEMA, {}), presetPatch(SETTINGS_SCHEMA, 'mode', 'classic')).settings;
    expect(s.maxRounds).toBeNull();
    expect(customCount(fields, s)).toBe(0);
  });
  it('counts each rule that differs from the mode default, and the same rule is custom in one mode but not another', () => {
    const s = resolveSettings(SETTINGS_SCHEMA, { mode: 'standard', turnSeconds: 90, dice: 'fair', startCash: 2000000 });
    expect(changedFields(fields, s).map((f) => f.key)).toEqual(['startCash', 'turnSeconds', 'dice']);
    expect(customCount(fields, s)).toBe(3);
    const quick = resolveSettings(SETTINGS_SCHEMA, { mode: 'quick', turnSeconds: 90, dice: 'fair', startCash: 2000000 });
    expect(customCount(fields, quick)).toBe(2); // ₹20L is quick's own start cash
  });
  it('the editor and the summary line always agree (client count == shared customRuleCount)', () => {
    const rooms = [
      {},
      { mode: 'quick' },
      { mode: 'classic', maxRounds: 30 },
      { mode: 'standard', maxRounds: null, targetWorth: null },
      { mode: 'quick', startCash: 2000000, passStart: 0, rentPercent: 200 },
      { mode: 'standard', eventEvery: 0, snatches: 0, snatchMs: 10000, snatchCardCap: 0, chaiCap: 3 },
      { mode: 'classic', turnSeconds: 15, tradeSeconds: 120, trafficFine: 0, auctionOnDecline: false, requireFullSet: false },
    ];
    for (const room of rooms) {
      const full = resolveSettings(SETTINGS_SCHEMA, room);
      expect(customCount(fields, full), JSON.stringify(room)).toBe(customRuleCount(full));
      expect(customCount(fields, full)).toBe(customRuleKeys(full).length);
    }
  });
  it('shared customRuleCount: a missing or illegal key is the default, an unknown key is ignored', () => {
    expect(customRuleCount({})).toBe(0);
    expect(customRuleCount(undefined)).toBe(0);
    expect(customRuleCount({ mode: 'standard', turnSeconds: 61, dice: 'nope', ghost: 1 })).toBe(0);
    expect(customRuleCount({ turnSeconds: 90 })).toBe(1);
    expect(customRuleCount({ mode: 'quick', startCash: 2000000 })).toBe(0);
    expect(customRuleCount({ mode: 'quick', startCash: 3000000 })).toBe(1);
    expect(customRuleCount(sanitizeRules({ turnSeconds: 90 }))).toBe(1);
  });
});

describe('options of a rule follow the mode', () => {
  it('the default of a mode-bound rule is marked per mode; other rules are not', () => {
    expect(fieldOptions(field('maxRounds'), { mode: 'standard' }).find((o) => /default/.test(o.label)).value).toBe(20);
    expect(fieldOptions(field('maxRounds'), { mode: 'quick' }).find((o) => /default/.test(o.label)).value).toBe(12);
    expect(fieldOptions(field('maxRounds'), { mode: 'classic' }).find((o) => /default/.test(o.label)).label).toBe('No limit (default)');
    expect(fieldOptions(field('dice'), { mode: 'quick' }).some((o) => /default/.test(o.label))).toBe(false);
    expect(fieldDefault(field('startCash'), { mode: 'quick' })).toBe(2000000);
    expect(fieldDefault(field('turnSeconds'), { mode: 'quick' })).toBe(60);
  });
});
