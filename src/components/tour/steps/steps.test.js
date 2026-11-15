// The page tours point at the real screens through `data-tour="..."` attributes and a few classes. These tests keep the step lists
// honest: every step has copy, ids are unique, every target still exists in the source, every rule the host can set is explained.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULE_FIELDS, RULE_GROUPS } from '@shared/ruleSettings.js';
import { homeSteps } from './homeSteps.js';
import { gameSteps } from './gameSteps.js';
import { lobbyGuestSteps, lobbyHostSteps, lobbyRulesSteps } from './lobbySteps.js';
import { profileSteps } from './profileSteps.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every .jsx / .js source file under src/ that is not a test, the tour steps or the tour engine. */
function sourceFiles(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'steps' || e.name === 'node_modules') continue;
      sourceFiles(p, out);
    } else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const SOURCE = sourceFiles()
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

const LISTS = {
  home: homeSteps,
  game: gameSteps({ name: 'Test Game' }),
  'lobby-host': lobbyHostSteps,
  'lobby-guest': lobbyGuestSteps,
  'lobby-rules': lobbyRulesSteps,
  profile: profileSteps,
};

/** Every selector string a step can point at (its target and its phone target), split on commas. */
const selectorsOf = (step) =>
  [step.target, step.phone && step.phone.target]
    .map((x) => (typeof x === 'function' ? x.selector : x))
    .filter((x) => typeof x === 'string')
    .flatMap((s) => s.split(',').map((p) => p.trim()));

describe.each(Object.entries(LISTS))('%s tour', (name, steps) => {
  it('has unique ids and real copy', () => {
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of steps) {
      expect(typeof s.id).toBe('string');
      expect(s.title && s.title.length).toBeGreaterThan(2);
      expect(s.title.length).toBeLessThanOrEqual(40);
      expect(typeof s.body).toBe('string');
      expect(s.body.length).toBeGreaterThan(10);
      // short friendly copy: at most a few short sentences
      expect(s.body.length).toBeLessThanOrEqual(240);
      expect((s.body.match(/[.!?](\s|$)/g) || []).length).toBeLessThanOrEqual(3);
      if (s.phone && s.phone.body) expect(s.phone.body.length).toBeLessThanOrEqual(240);
    }
  });

  it('is a plain centred card or has a target', () => {
    for (const s of steps) {
      if (!s.target) expect(s.placement).toBe('center');
      else expect(selectorsOf(s).length, `${name}/${s.id}`).toBeGreaterThan(0);
    }
  });

  it('only points at data-tour names, rule rows and classes that exist in the source', () => {
    for (const s of steps) {
      for (const sel of selectorsOf(s)) {
        for (const m of sel.matchAll(/\[data-tour="([^"]+)"\]/g)) {
          const v = m[1];
          const group = /^lobby-group-(.+)$/.exec(v);
          if (group) {
            expect(RULE_GROUPS.map((g) => g.id), `${name}/${s.id}: ${v}`).toContain(group[1]);
            expect(SOURCE).toContain('data-tour={`lobby-group-${group.id}`}');
          } else {
            expect(SOURCE.includes(`data-tour="${v}"`), `${name}/${s.id}: data-tour="${v}" is not in the source`).toBe(true);
          }
        }
        for (const m of sel.matchAll(/\[data-rule="([^"]+)"\]/g)) {
          expect(RULE_FIELDS.map((f) => f.key), `${name}/${s.id}: ${m[0]}`).toContain(m[1]);
          expect(SOURCE).toContain('data-rule={rule ? field.key : undefined}');
        }
        for (const m of sel.matchAll(/#([\w-]+)/g)) {
          expect(SOURCE.includes(`id="${m[1]}"`), `${name}/${s.id}: id ${m[1]}`).toBe(true);
        }
        for (const m of sel.replace(/\[[^\]]*\]/g, ' ').matchAll(/\.([\w-]+)/g)) {
          expect(SOURCE.includes(m[1]), `${name}/${s.id}: class ${m[1]}`).toBe(true);
        }
      }
    }
  });
});

describe('the rules tour', () => {
  it('explains every rule the host can set, once, with the shared help text', () => {
    for (const f of RULE_FIELDS) {
      const step = lobbyRulesSteps.find((s) => s.id === `rule-${f.key}`);
      expect(step, f.key).toBeTruthy();
      expect(step.title).toBe(f.label);
      expect(step.target).toBe(`[data-rule="${f.key}"]`);
      expect(f.help.startsWith(step.body.slice(0, 20))).toBe(true);
    }
    expect(lobbyRulesSteps.filter((s) => s.id.startsWith('rule-')).length).toBe(RULE_FIELDS.length);
  });

  it('follows the editor order: money, timers, board rules, snatch', () => {
    const keys = lobbyRulesSteps.filter((s) => s.id.startsWith('rule-')).map((s) => s.id.slice(5));
    expect(keys).toEqual(RULE_FIELDS.map((f) => f.key));
  });
});

describe('the host tour', () => {
  it('covers invite, icon, seats, mode, every rule group, start and leave', () => {
    const ids = lobbyHostSteps.map((s) => s.id);
    for (const want of ['code', 'invite', 'pieces', 'seats', 'map', 'mode', 'money', 'timers', 'rules', 'snatch', 'explain', 'start', 'leave']) {
      expect(ids).toContain(want);
    }
  });

  it('names every rule of each group in its group step', () => {
    for (const g of RULE_GROUPS) {
      if (g.id === 'snatch') continue; // explained in prose
      const step = lobbyHostSteps.find((s) => s.id === g.id) || lobbyHostSteps.find((s) => s.title === g.label);
      expect(step, g.id).toBeTruthy();
      for (const f of RULE_FIELDS.filter((x) => x.group === g.id)) expect(step.body.toLowerCase()).toContain(f.label.toLowerCase());
    }
  });

  it('does not hard-code money or rent numbers', () => {
    const all = [...lobbyHostSteps, ...homeSteps, ...profileSteps].map((s) => s.body).join(' ');
    expect(all).not.toMatch(/₹\s*\d/);
  });
});
