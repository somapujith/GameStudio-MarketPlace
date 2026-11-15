// The host's "Game rules" editor, rendered from the real Kingpin manifest data (server-side render, node env;
// effects do not run here, the timing is covered by editSession.test.js and the real browser runs).
import { afterEach, describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import SettingsPanel from './SettingsPanel.jsx';
import { SettingField } from './SettingControls.jsx';
import { CustomBadge, RuleGroup, RulesReadOnly } from './RulesEditor.jsx';
import { LOBBY_SETTINGS, SETTINGS_GROUPS, SETTINGS_SCHEMA, TABLE_RULES, settingsSummary } from '@/games/hyderabad-tycoon/settings.js';
import { RULE_FIELDS, ruleField } from '@shared/ruleSettings.js';
import { groupFields, lobbyFields, resolveSettings } from './settings.js';

const GAME = { settings: SETTINGS_SCHEMA, lobbySettings: LOBBY_SETTINGS, settingsGroups: SETTINGS_GROUPS, tableRules: TABLE_RULES, summarize: settingsSummary };
const strip = (html) => html.replace(/<!-- -->/g, '');
const panel = (props) => strip(renderToString(h(SettingsPanel, { game: GAME, settings: {}, isHost: true, onSend() {}, errorId: 0, ...props })));
const CUSTOM = { mode: 'standard', startCash: 3000000, turnSeconds: 90, requireFullSet: false, snatches: 2 }; // 4 rules changed
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'g')) || [];
/** The markup of one rule row (its `data-rule` div up to the next rule or the end of its group). */
const row = (html, key) => {
  const from = html.indexOf(`data-rule="${key}"`);
  expect(from, `row ${key}`).toBeGreaterThan(-1);
  const next = html.indexOf('data-rule="', from + 10);
  const end = html.indexOf('</section>', from);
  return html.slice(from, next === -1 || (end !== -1 && end < next) ? end : next);
};

afterEach(() => {
  delete globalThis.window;
});

describe('host: the editor', () => {
  const html = panel({});

  it('is titled "Game rules" and says you are the host; the summary line and table rules are there', () => {
    expect(html).toContain('<h2 class="ho-h2">Game rules</h2>');
    expect(html).toContain('You are the host');
    expect(html).toContain('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
    expect(html).toContain('Table rules');
    expect(html).toContain('One die · 3 business levels per district');
  });

  it('presets: three cards, the room mode selected, a line says what a preset resets', () => {
    expect(tags(html, 'button').filter((t) => t.includes('xl-preset')).length).toBe(3);
    expect(html).toMatch(/aria-checked="true" class="xl-preset is-on"[^>]*><span class="xl-preset__name">Standard City Hustle</);
    for (const name of ['Quick Chai Break', 'Classic Long Game']) expect(html).toContain(name);
    expect(html).toContain('20 rounds, richest wins'); // the hint under the preset name
    expect(html).toMatch(/A preset sets starting cash, win target \(net worth\) and round limit to its own defaults; every other rule stays as you set it\./);
    expect(panel({ settings: { mode: 'quick' } })).toMatch(/aria-checked="true" class="xl-preset is-on"[^>]*><span class="xl-preset__name">Quick Chai Break</);
  });

  it('four groups in order as an accordion: the first open on a phone, every rule is in the page', () => {
    const buttons = tags(html, 'button').filter((t) => t.includes('xl-group__btn'));
    expect(buttons).toHaveLength(4);
    expect(buttons.map((t) => /aria-expanded="(true|false)"/.exec(t)[1])).toEqual(['true', 'false', 'false', 'false']);
    expect([...html.matchAll(/xl-group__title">([^<]+)</g)].map((m) => m[1])).toEqual(['Money', 'Timers', 'Board rules', 'Snatch']);
    for (const f of RULE_FIELDS) expect(html, f.key).toContain(`data-rule="${f.key}"`);
    expect(tags(html, 'div').filter((t) => t.includes('xl-group__body')).map((t) => t.includes('hidden=""'))).toEqual([false, true, true, true]);
  });

  it('a wide screen opens every group (and the guest list)', () => {
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    const wide = panel({});
    expect(tags(wide, 'button').filter((t) => t.includes('xl-group__btn')).every((t) => t.includes('aria-expanded="true"'))).toBe(true);
    expect(tags(wide, 'div').filter((t) => t.includes('xl-group__body')).some((t) => t.includes('hidden=""'))).toBe(false);
    const guest = panel({ isHost: false, settings: CUSTOM });
    expect(guest).toContain('aria-expanded="true"');
    expect(guest).not.toMatch(/<div id="[^"]*-ro" hidden/);
  });

  it('numbers: a slider with its value in words, -/+ buttons, the value formatted per unit', () => {
    const cash = row(html, 'startCash');
    expect(cash).toContain('type="range"');
    expect(cash).toContain('aria-label="Starting cash"');
    expect(cash).toContain('aria-valuetext="₹15,00,000"'); // a screen reader hears the whole amount
    expect(cash).toContain('aria-label="Decrease Starting cash"');
    expect(cash).toContain('aria-label="Increase Starting cash"');
    expect(cash).toContain('<span class="xl-rule__val">₹15L</span>');
    expect(row(html, 'passStart')).toContain('<span class="xl-rule__val">₹2L</span>');
    expect(row(html, 'turnSeconds')).toContain('<span class="xl-rule__val">60 s</span>');
    expect(row(html, 'tradeSeconds')).toContain('<span class="xl-rule__val">45 s</span>');
    expect(row(html, 'snatchMs')).toContain('<span class="xl-rule__val">5 s</span>'); // milliseconds read as seconds
    expect(row(html, 'snatchMs')).toContain('aria-valuetext="5 s"');
    expect(row(html, 'chaiCap')).toContain('<span class="xl-rule__val">1</span>');
    // the range slider is on the grid of the rule: positions, not rupees
    expect(cash).toMatch(/min="0" max="995" step="1"/);
    expect(row(html, 'turnSeconds')).toMatch(/min="0" max="33" step="1"/);
  });

  it('quick picks for the rupee rules, and an explicit Off for the nullable win target', () => {
    const cash = row(html, 'startCash');
    expect(cash).toContain('aria-label="Starting cash quick picks"');
    for (const l of ['₹10L', '₹15L (default)', '₹20L', '₹30L', '₹50L']) expect(cash, l).toContain(`>${l}<`);
    expect(cash).toMatch(/aria-checked="true" class="ho-chip is-on">₹15L \(default\)</);
    const target = row(html, 'targetWorth');
    expect(target).toMatch(/role="radio" aria-checked="false" class="ho-chip">Off</);
    expect(target).toMatch(/aria-checked="true" class="ho-chip is-on">₹50L \(default\)</);
    // a custom amount off the quick picks selects none of them but shows in the value
    const custom = row(panel({ settings: { targetWorth: 6000000 } }), 'targetWorth');
    expect(custom).not.toContain('is-on">');
    expect(custom).toContain('<span class="xl-rule__val">₹60L</span>');
  });

  it('choices: segmented pills when short, chips when many; a null option is a real chip ("No limit")', () => {
    const dice = row(html, 'dice');
    expect(dice).toContain('class="ho-seg"');
    expect(dice).toMatch(/aria-checked="true" class="ho-seg__opt is-on">Lucky</);
    expect(dice).toContain('>Fair<');
    const rent = row(html, 'rentPercent');
    expect(rent).toContain('class="ho-chips"');
    for (const l of ['50%', '75%', '100%', '125%', '150%', '200%']) expect(rent, l).toContain(`>${l}<`);
    const rounds = row(html, 'maxRounds');
    expect(rounds).toContain('>No limit<');
    expect(rounds).toMatch(/aria-checked="true" class="ho-chip is-on">20 rounds \(default\)</);
    expect(row(panel({ settings: { maxRounds: null } }), 'maxRounds')).toMatch(/aria-checked="true" class="ho-chip is-on">No limit</);
    expect(row(html, 'eventEvery')).toContain('>Off<');
  });

  it('switches: a labelled role=switch with its state', () => {
    const fullSet = row(html, 'requireFullSet');
    expect(fullSet).toMatch(/role="switch" aria-checked="true"/);
    expect(fullSet).toContain('Full set to upgrade');
    expect(row(panel({ settings: { requireFullSet: false } }), 'requireFullSet')).toMatch(/role="switch" aria-checked="false"/);
  });

  it('every rule shows its help, its legal range and its default', () => {
    for (const f of RULE_FIELDS) {
      const r = row(html, f.key);
      expect(r, `${f.key} help`).toContain(f.help.replace(/&/g, '&amp;'));
      expect(r, `${f.key} default`).toContain('Default ');
      if (f.type === 'number') expect(r, `${f.key} range`).toContain('Range ');
    }
    const cash = row(html, 'startCash');
    expect(cash).toContain('<span>Range ₹5L - ₹10Cr</span>');
    expect(cash).toContain('<span>Default ₹15L</span>');
    expect(row(html, 'turnSeconds')).toContain('<span>Range 15 s - 180 s</span>');
    expect(row(html, 'turnSeconds')).toContain('<span>Default 60 s</span>');
    expect(row(html, 'snatchMs')).toContain('<span>Range 3 s - 10 s</span>');
    expect(row(html, 'dice')).not.toContain('Range');
  });

  it('the Snatch group explains the numbers it holds, live', () => {
    expect(html).toContain('Everyone starts with 1 Snatch button; after someone buys a district the others get 5 seconds to press Snatch.');
    expect(panel({ settings: { snatches: 3, snatchMs: 8000 } })).toContain('Everyone starts with 3 Snatch buttons; after someone buys a district the others get 8 seconds to press Snatch.');
    expect(panel({ settings: { snatches: 0 } })).toContain('Snatch is off: nobody gets a Snatch button this game.');
  });

  it('short labels in the rows', () => {
    for (const label of ['Starting cash', 'START salary', 'Win target (net worth)', 'Decision timer', 'Snatch buttons', 'Chai token limit', 'Full set to upgrade']) expect(html, label).toContain(`>${label}<`);
    expect(html).not.toContain('Snatch buttons each player starts with');
  });

  it('no pass-auction rule: passing never starts an auction, so the host cannot switch it (nor read it)', () => {
    expect(html).not.toContain('data-rule="auctionOnDecline"');
    expect(html).not.toMatch(/Auction on pass|Auction when someone passes|auction on decline/i);
    const stored = panel({ settings: { auctionOnDecline: false } }); // a room stored by an older version
    expect(stored).not.toContain('auctionOnDecline');
    expect(stored).not.toContain('Custom rules');
    expect(panel({ isHost: false, settings: { auctionOnDecline: false } })).not.toMatch(/on pass|someone passes|on decline/i);
  });
});

describe('host: custom rules, resets', () => {
  it('a stock room: no badge, no per-rule reset, "Reset all" is off', () => {
    const html = panel({});
    expect(html).not.toContain('xl-custom');
    expect(html).not.toContain('Custom rules');
    expect(html).not.toContain('xl-rule__reset');
    expect(html).not.toContain('is-modified');
    expect(html).toContain('Nothing changed from the defaults');
    expect(html).toMatch(/<button type="button" class="xl-rules__reset" disabled="">Reset all to defaults</);
  });

  it('with rules changed: the badge counts them, each changed rule is marked and can be reset on its own', () => {
    const html = panel({ settings: CUSTOM });
    expect(html).toMatch(/<span class="xl-custom" role="status" aria-label="4 custom rules"><span aria-hidden="true">Custom rules<\/span><b aria-hidden="true">4<\/b>/);
    expect(html).toContain('Standard City Hustle · 20 rounds · richest wins · ₹50L target · Custom rules (4)');
    expect([...html.matchAll(/data-rule="(\w+)"/g)].map((m) => m[1]).filter((k) => new RegExp(`xl-rule is-modified" data-rule="${k}"`).test(html))).toEqual([
      'startCash',
      'turnSeconds',
      'requireFullSet',
      'snatches',
    ]);
    expect(row(html, 'startCash')).toContain('aria-label="Reset Starting cash to its default, ₹15L"');
    expect(row(html, 'turnSeconds')).toContain('aria-label="Reset Decision timer to its default, 60 s"');
    expect(row(html, 'requireFullSet')).toContain('aria-label="Reset Full set to upgrade to its default, On"');
    expect(row(html, 'passStart')).not.toContain('xl-rule__reset');
    expect(html).not.toMatch(/<button type="button" class="xl-rules__reset" disabled="">/); // Reset all is live
    expect(html).toContain('Reset all to defaults');
  });

  it('each group tells how many of its rules changed', () => {
    const html = panel({ settings: CUSTOM });
    expect([...html.matchAll(/xl-group__count">([^<]+)</g)].map((m) => m[1])).toEqual(['1 changed', '1 changed', '1 changed', '1 changed']);
    expect([...panel({ settings: { startCash: 3000000, passStart: 0 } }).matchAll(/xl-group__count">([^<]+)</g)].map((m) => m[1])).toEqual(['2 changed']);
  });

  it('a mode is the baseline of its own rules: quick with its own ₹20L and 12 rounds is not custom', () => {
    const html = panel({ settings: { mode: 'quick', startCash: 2000000, maxRounds: 12, targetWorth: 5000000 } });
    expect(html).not.toContain('Custom rules');
    expect(row(html, 'startCash')).toContain('<span>Default ₹20L</span>');
  });

  it('the badge: nothing at 0, singular and plural for a screen reader', () => {
    expect(renderToString(h(CustomBadge, { count: 0 }))).toBe('');
    expect(renderToString(h(CustomBadge, { count: 1 }))).toContain('aria-label="1 custom rule"');
    expect(renderToString(h(CustomBadge, { count: 5 }))).toContain('aria-label="5 custom rules"');
  });
});

describe('locked and disconnected', () => {
  const interactive = (html) =>
    [...tags(html, 'button'), ...tags(html, 'input')].filter((t) => !t.includes('xl-group__btn') && !t.includes('xl-rules__toggle'));

  it('while the game starts or the socket is down every control is disabled; only opening a group still works', () => {
    const html = panel({ settings: CUSTOM, disabled: true });
    const all = interactive(html);
    expect(all.length).toBeGreaterThan(40);
    expect(all.filter((t) => !t.includes('disabled=""'))).toEqual([]);
  });

  it('while connected, nothing in the editor is disabled except the controls at a limit', () => {
    const html = panel({ settings: CUSTOM });
    const off = interactive(html).filter((t) => t.includes('disabled=""'));
    // "-" at the minimum / "+" at the maximum (chaiCap 1..3, snatches 0..3 -> 2 is in range) and nothing else
    expect(off.every((t) => /aria-label="(Decrease|Increase) /.test(t) || t.includes('xl-rules__reset'))).toBe(true);
  });

  it('the controls at a limit are the ends of the range', () => {
    const html = panel({ settings: { chaiCap: 1, snatchCardCap: 2 } });
    expect(row(html, 'chaiCap')).toMatch(/disabled="" aria-label="Decrease Chai token limit"/);
    expect(row(html, 'chaiCap')).not.toMatch(/disabled="" aria-label="Increase Chai token limit"/);
    expect(row(html, 'snatchCardCap')).toMatch(/disabled="" aria-label="Increase Snatch from cards"/);
  });
});

describe('error state', () => {
  const field = ruleField('turnSeconds');
  const schemaField = SETTINGS_SCHEMA.find((f) => f.key === 'turnSeconds');
  const text = 'Decision timer must be a whole number from 15 to 180 seconds in steps of 5.';

  it('a refused edit shows its reason under the rule, as an alert', () => {
    const html = strip(renderToString(h(SettingField, { field: schemaField, rule: true, value: 60, values: {}, error: text, onChange() {}, onStep() {} })));
    expect(html).toMatch(/<p class="ho-inline-error xl-rule__err" id="[^"]+" role="alert">Decision timer must be a whole number/);
    expect(html).toContain(text);
    expect(field.min).toBe(15);
  });

  it('a switch points at its error with aria-describedby', () => {
    const f = SETTINGS_SCHEMA.find((x) => x.key === 'requireFullSet');
    const html = strip(renderToString(h(SettingField, { field: f, rule: true, value: true, values: {}, error: 'No.', onChange() {} })));
    const err = /id="([^"]+-err)"/.exec(html)[1];
    expect(html).toContain(`aria-describedby="${[...html.matchAll(/id="([^"]+-help)"/g)].map((m) => m[1])[0]} ${err}"`);
    expect(html).toContain('role="alert">No.<');
  });

  it('no error, no alert', () => {
    expect(strip(renderToString(h(SettingField, { field: schemaField, rule: true, value: 60, values: {}, onChange() {}, onStep() {} })))).not.toContain('role="alert"');
    expect(panel({ settings: CUSTOM })).not.toContain('role="alert"');
  });
});

describe('guest: the same list, read only', () => {
  const html = panel({ isHost: false, settings: CUSTOM });

  it('says the host sets the rules, the summary and the badge; no controls at all', () => {
    expect(html).toContain('Set by the host');
    expect(html).toContain('Standard City Hustle · 20 rounds · richest wins · ₹50L target · Custom rules (4)');
    expect(html).toContain('aria-label="4 custom rules"');
    for (const control of ['type="range"', 'role="switch"', 'role="radio"', 'xl-preset', 'xl-rule__reset', 'xl-rules__reset', 'xl-slider']) expect(html, control).not.toContain(control);
  });

  it('collapsed on a phone with a "Show all rules" button that points at the list', () => {
    const toggle = tags(html, 'button').find((t) => t.includes('xl-rules__toggle'));
    expect(toggle).toContain('aria-expanded="false"');
    const id = /aria-controls="([^"]+)"/.exec(toggle)[1];
    expect(html).toContain(`<div id="${id}" hidden="">`);
    expect(html).toContain('Show all rules');
  });

  it('lists every rule by group with its value in its unit, the changed ones highlighted with their default', () => {
    for (const f of RULE_FIELDS) expect(html, f.key).toContain(`<dt>${(SETTINGS_SCHEMA.find((x) => x.key === f.key).label).replace(/&/g, '&amp;')}</dt>`);
    expect(html).toContain('<h3 class="xl-ro__h">Money</h3>');
    expect(html).toContain('<div class="xl-ro__row is-changed"><dt>Starting cash</dt><dd><b>₹30L</b><small>Default ₹15L</small></dd></div>');
    expect(html).toContain('<div class="xl-ro__row is-changed"><dt>Decision timer</dt><dd><b>90 s</b><small>Default 60 s</small></dd></div>');
    expect(html).toContain('<div class="xl-ro__row is-changed"><dt>Full set to upgrade</dt><dd><b>Off</b><small>Default On</small></dd></div>');
    expect(html).toContain('<div class="xl-ro__row"><dt>Trade offer timer</dt><dd><b>45 s</b></dd></div>'); // unchanged: plain
    expect(html).toContain('<div class="xl-ro__row"><dt>Snatch timer</dt><dd><b>5 s</b></dd></div>');
    expect((html.match(/is-changed/g) || []).length).toBe(4);
  });

  it('the Snatch note is part of what a guest reads', () => {
    expect(html).toContain('Everyone starts with 2 Snatch buttons; after someone buys a district the others get 5 seconds to press Snatch.');
  });

  it('a stock room reads as "nothing changed" with no badge', () => {
    const stock = panel({ isHost: false, settings: {} });
    expect(stock).not.toContain('xl-custom');
    expect(stock).toContain('Nothing changed from the preset');
    expect(stock).not.toContain('is-changed');
    expect(stock).toContain('Standard City Hustle · 20 rounds · richest wins · ₹50L target');
  });

  it('a game with no settings still says so calmly', () => {
    expect(strip(renderToString(h(SettingsPanel, { game: null, settings: {}, isHost: false, onSend() {} })))).toContain('has not changed anything');
  });
});

describe('building blocks', () => {
  it('RuleGroup: a header button wired to its body, the note inside, closed bodies stay hidden in the page', () => {
    const open = strip(renderToString(h(RuleGroup, { group: { id: 'g', label: 'Money' }, count: 2, open: true, onToggle() {}, note: 'About money.' }, h('p', null, 'child'))));
    expect(open).toMatch(/aria-expanded="true" aria-controls="([^"]+)"/);
    expect(open).toContain('2 changed');
    expect(open).toContain('<p class="xl-group__note">About money.</p>');
    expect(open).toContain('<p>child</p>');
    const shut = renderToString(h(RuleGroup, { group: { id: 'g', label: 'Money' }, open: false, onToggle() {} }, h('p', null, 'child')));
    expect(shut).toContain('aria-expanded="false"');
    expect(shut).toContain('hidden=""');
    expect(shut).not.toContain('changed');
  });

  it('RulesReadOnly shows only fields the schema knows', () => {
    const layout = groupFields(lobbyFields(GAME), SETTINGS_GROUPS);
    const html = renderToString(h(RulesReadOnly, { groups: layout.groups, values: resolveSettings(SETTINGS_SCHEMA, {}), schema: SETTINGS_SCHEMA.filter((f) => f.key !== 'dice') }));
    expect(html).not.toContain('<dt>Dice</dt>');
    expect(html).toContain('<dt>Starting cash</dt>');
  });

  it('a nullable stepper without a slider gets its Off chip and a plain -/+ stepper', () => {
    const f = { key: 'cap', type: 'stepper', label: 'Cap', default: 5, min: 1, max: 9, step: 1, nullable: true, group: 'g' };
    const html = renderToString(h(SettingField, { field: f, rule: true, value: null, values: {}, onChange() {}, onStep() {} }));
    expect(html).toMatch(/aria-checked="true" class="ho-chip is-on">Off</);
    expect(html).toContain('class="ho-stepper"');
    expect(html).toContain('<output class="ho-stepper__val" aria-live="polite">Off</output>');
  });
});

describe('host: heads-up for odd rule combinations', () => {
  it('stays quiet for the defaults', () => {
    expect(panel({})).not.toContain('xl-warn');
  });

  it('warns (without blocking) when the win target is not above the starting cash', () => {
    const html = panel({ settings: { mode: 'standard', startCash: 100000000, targetWorth: 5000000 } });
    expect(html).toContain('class="xl-warn"');
    expect(html).toContain('the game ends on the first move');
  });

  it('warns when there is neither a round limit nor a win target', () => {
    const html = panel({ settings: { mode: 'quick', maxRounds: null, targetWorth: null } });
    expect(html).toContain('No round limit and no win target');
  });
});
