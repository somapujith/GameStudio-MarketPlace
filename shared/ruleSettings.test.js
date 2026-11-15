// The host-rules contract (shared/ruleSettings.js): fields, defaults per mode, validation, and the "Custom rules" counter.
import { describe, expect, it } from 'vitest';
import {
  RULE_FIELDS, RULE_KEYS, RULE_GROUPS, ruleField, ruleDefaults, isRuleValue, cleanRule, sanitizeRules, ruleRangeText,
  customRuleKeys, customRuleCount, ruleWarnings,
} from './ruleSettings.js';
import { MODES, MODE_IDS, ROUND_CAP } from './modes.js';

describe('RULE_FIELDS', () => {
  it('lists every key once, each in a known group, with a default that is itself legal in every mode', () => {
    expect(RULE_KEYS).toEqual([
      'startCash', 'passStart', 'targetWorth', 'rentPercent', 'trafficFine', 'turnSeconds', 'tradeSeconds', 'maxRounds',
      'dice', 'auctionOnDecline', 'requireFullSet', 'eventEvery', 'chaiCap', 'snatches', 'snatchMs', 'snatchCardCap',
    ]);
    expect(new Set(RULE_KEYS).size).toBe(RULE_KEYS.length);
    const groups = RULE_GROUPS.map((g) => g.id);
    for (const f of RULE_FIELDS) {
      expect(groups, f.key).toContain(f.group);
      for (const m of MODE_IDS) expect(isRuleValue(f, f.default(m)), `${f.key} default in ${m}`).toBe(true);
    }
  });

  it('defaults follow the mode only for startCash, maxRounds and targetWorth', () => {
    for (const m of MODE_IDS) {
      const d = ruleDefaults(m);
      expect(d.startCash).toBe(MODES[m].startCash);
      expect(d.maxRounds).toBe(MODES[m].rounds);
      expect(d.targetWorth).toBe(MODES[m].targetWorth);
      expect({ ...d, startCash: 0, maxRounds: 0, targetWorth: 0 }).toEqual({ ...ruleDefaults('standard'), startCash: 0, maxRounds: 0, targetWorth: 0 });
    }
    expect(ruleDefaults('nope')).toEqual(ruleDefaults('standard')); // an unknown mode is the standard one
  });

  it('the stock rules are the ones the game always had', () => {
    expect(ruleDefaults('standard')).toMatchObject({
      startCash: 1500000, passStart: 200000, targetWorth: 5000000, rentPercent: 100, trafficFine: 25000, turnSeconds: 60,
      tradeSeconds: 45, maxRounds: 20, dice: 'lucky', auctionOnDecline: true, requireFullSet: true, eventEvery: 3, chaiCap: 1,
      snatches: 1, snatchMs: 5000, snatchCardCap: 2,
    });
  });
});

describe('isRuleValue / cleanRule / sanitizeRules', () => {
  it('numbers must be whole, in range and on the step; choices must be listed; null only where nullable', () => {
    const cash = ruleField('startCash');
    expect(isRuleValue(cash, 500000)).toBe(true);
    expect(isRuleValue(cash, 100000000)).toBe(true);
    expect(isRuleValue(cash, 400000)).toBe(false);
    expect(isRuleValue(cash, 1550000)).toBe(false); // off the step
    expect(isRuleValue(cash, '1500000')).toBe(false);
    expect(isRuleValue(cash, null)).toBe(false);
    expect(isRuleValue(ruleField('maxRounds'), null)).toBe(true);
    expect(isRuleValue(ruleField('maxRounds'), 21)).toBe(false);
    expect(isRuleValue(ruleField('dice'), 'fair')).toBe(true);
    expect(isRuleValue(ruleField('dice'), 'loaded')).toBe(false);
    expect(isRuleValue(ruleField('requireFullSet'), 0)).toBe(false);
    expect(isRuleValue(null, 1)).toBe(false);
  });

  it('cleanRule keeps a legal value and falls back to the mode default otherwise', () => {
    expect(cleanRule('startCash', 3000000, 'standard')).toBe(3000000);
    expect(cleanRule('startCash', 7, 'quick')).toBe(MODES.quick.startCash);
    expect(cleanRule('nope', 1)).toBeUndefined();
    expect(cleanRule('targetWorth', null, 'standard')).toBeNull();
    expect(cleanRule('targetWorth', null, 'classic')).toBe(MODES.classic.targetWorth); // classic never runs without a target
    expect(cleanRule('targetWorth', 12500000, 'classic')).toBe(12500000); // a custom amount on the grid
  });

  it('sanitizeRules returns every key, all legal', () => {
    const out = sanitizeRules({ startCash: 5000000, rentPercent: 33, dice: 'fair', junk: 1 }, 'standard');
    expect(Object.keys(out)).toEqual(RULE_KEYS);
    expect(out).toMatchObject({ startCash: 5000000, rentPercent: 100, dice: 'fair' });
    expect(out).not.toHaveProperty('junk');
    expect(sanitizeRules(null, 'quick')).toEqual(ruleDefaults('quick'));
  });

  it('ruleRangeText prints the legal range', () => {
    expect(ruleRangeText(ruleField('turnSeconds'))).toBe('15 - 180 seconds');
    expect(ruleRangeText(ruleField('startCash'), (v) => `R${v}`)).toBe('R500000 - R100000000');
    expect(ruleRangeText(ruleField('dice'))).toBe('');
  });
});

describe('customRuleKeys / customRuleCount', () => {
  it('a stock table has no custom rules, whatever the mode', () => {
    for (const m of MODE_IDS) {
      expect(customRuleCount(ruleDefaults(m), m)).toBe(0);
      expect(customRuleCount({ mode: m, ...ruleDefaults(m) })).toBe(0);
    }
    expect(customRuleCount({ mode: 'standard' })).toBe(0);
    expect(customRuleCount({})).toBe(0);
    expect(customRuleCount()).toBe(0);
  });

  it('counts every rule that differs from the defaults of the mode', () => {
    expect(customRuleKeys({ mode: 'standard', startCash: 3000000 })).toEqual(['startCash']);
    expect(customRuleCount({ mode: 'standard', startCash: 3000000, rentPercent: 150, turnSeconds: 30, requireFullSet: false })).toBe(4);
    expect(customRuleKeys({ ...ruleDefaults('standard'), maxRounds: null, eventEvery: 0, chaiCap: 3 })).toEqual(['maxRounds', 'eventEvery', 'chaiCap']);
    expect(customRuleKeys({ targetWorth: null })).toEqual(['targetWorth']);
    expect(customRuleCount({ snatches: 0, snatchMs: 3000, snatchCardCap: 0 })).toBe(3);
  });

  it('defaults are judged against the mode: quick cash is stock in quick but custom in standard', () => {
    const quick = { mode: 'quick', startCash: MODES.quick.startCash, maxRounds: MODES.quick.rounds };
    expect(customRuleCount(quick)).toBe(0);
    expect(customRuleCount(quick, 'standard')).toBe(2); // the same numbers measured against the standard defaults
    expect(customRuleCount({ mode: 'classic', maxRounds: null, targetWorth: 3000000 })).toBe(0);
    expect(customRuleCount({ mode: 'classic', maxRounds: 20 })).toBe(1); // classic has no round limit by default
  });

  it('the explicit mode argument wins over settings.mode, an unknown mode is the standard one', () => {
    expect(customRuleCount({ mode: 'standard', startCash: MODES.quick.startCash }, 'quick')).toBe(0);
    expect(customRuleCount({ mode: 'nope', startCash: MODES.standard.startCash })).toBe(0);
  });

  it('a missing, undefined or illegal value counts as the default (the server would replace it)', () => {
    expect(customRuleCount({ startCash: undefined, rentPercent: 33, dice: 'loaded', turnSeconds: '30', unknown: 1 })).toBe(0);
  });

  it('is pure: it never changes its input', () => {
    const s = Object.freeze({ mode: 'standard', startCash: 2000000 });
    expect(customRuleCount(s)).toBe(1);
    expect(s).toEqual({ mode: 'standard', startCash: 2000000 });
  });
});

describe('ruleWarnings', () => {
  it('a stock table has none', () => {
    for (const m of MODE_IDS) expect(ruleWarnings(ruleDefaults(m), m)).toEqual([]);
    expect(ruleWarnings()).toEqual([]);
    expect(ruleWarnings({})).toEqual([]);
  });

  it('warns when the win target is not above the starting cash (the first move would end the game)', () => {
    const w = ruleWarnings({ startCash: 10000000, targetWorth: 5000000 }, 'standard', (v) => `R${v}`);
    expect(w).toEqual([{ key: 'targetWorth', text: 'The win target (R5000000) is not above the starting cash (R10000000): the game ends on the first move.' }]);
    expect(ruleWarnings({ startCash: 5000000, targetWorth: 5000000 })).toHaveLength(1); // equal counts: the net worth already is the target
    expect(ruleWarnings({ startCash: 4500000, targetWorth: 5000000 })).toEqual([]);
    expect(ruleWarnings({ startCash: 100000000, targetWorth: null })).toEqual([]); // no target, no problem
    expect(ruleWarnings({ mode: 'quick', startCash: 5000000 })).toHaveLength(1); // the target is the mode default 50L
  });

  it('warns about a game with neither a round limit nor a target', () => {
    const w = ruleWarnings({ maxRounds: null, targetWorth: null });
    expect(w).toEqual([{ key: 'maxRounds', text: 'No round limit and no win target: only the last player standing, or round 60, ends the game.' }]);
    expect(ruleWarnings({ maxRounds: null })).toEqual([]);
    expect(ruleWarnings({ mode: 'classic', maxRounds: null, targetWorth: null })).toEqual([]); // classic keeps its target
  });

  it('illegal values count as the defaults', () => {
    expect(ruleWarnings({ startCash: 'lots', targetWorth: 'soon' })).toEqual([]);
  });
});

describe('the round cap', () => {
  it('stays a safety net for a game without a round limit', () => {
    expect(ROUND_CAP).toBe(60);
    expect(ruleField('maxRounds').options.some((o) => o.value === null)).toBe(true);
    expect(Math.max(...ruleField('maxRounds').options.map((o) => o.value ?? 0))).toBeLessThanOrEqual(ROUND_CAP);
  });
});
