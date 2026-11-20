// The win-target control of the Nawabi Raj lobby, rendered from the real schema (server-side render, node env).
// It is one rule of the host's "Game rules" editor now (the Money group); the editor itself is covered by rulesEditor.test.js.
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import SettingsPanel from './SettingsPanel.jsx';
import { LOBBY_SETTINGS, SETTINGS_GROUPS, SETTINGS_SCHEMA, TABLE_RULES, settingsSummary } from '@/games/hyderabad-tycoon/settings.js';
import { ruleField } from '@shared/ruleSettings.js';

const GAME = { settings: SETTINGS_SCHEMA, lobbySettings: LOBBY_SETTINGS, settingsGroups: SETTINGS_GROUPS, tableRules: TABLE_RULES, summarize: settingsSummary };
const host = (settings) => renderToString(h(SettingsPanel, { game: GAME, settings, isHost: true, onSend() {}, errorId: 0 }));
const guest = (settings) => renderToString(h(SettingsPanel, { game: GAME, settings, isHost: false, onSend() {}, errorId: 0 }));
const picks = (html) => html.slice(html.indexOf('aria-label="Win target (net worth) quick picks"'));

describe('lobby: win target control', () => {
  it('the host sees the win target with its helper line and the target options as radios', () => {
    const html = host({ mode: 'standard', targetWorth: 5000000 });
    expect(html).toContain('Win target (net worth)');
    expect(html).toContain(ruleField('targetWorth').help);
    for (const label of ['Off', '₹25L', '₹30L', '₹40L', '₹50L (default)', '₹75L', '₹1Cr']) expect(html, label).toContain(`>${label}<`);
    // exactly the chosen target is the selected radio of its group
    expect(picks(html)).toMatch(/aria-checked="true"[^>]*>₹50L \(default\)</);
    expect(html).toContain('Standard City Hustle · 20 rounds · richest wins · ₹50L target'); // the summary line, no custom tag
    expect(html).not.toContain('Custom rules');
  });

  it('Off is not offered in Classic, whose default is marked instead', () => {
    const html = host({ mode: 'classic', targetWorth: 3000000 });
    const group = picks(html).slice(0, picks(html).indexOf('</div>'));
    expect(group).not.toContain('>Off<');
    expect(group).toMatch(/aria-checked="true"[^>]*>₹30L \(default\)</);
    expect(group).toContain('>₹50L<');
    expect(html).toContain('Classic Long Game · first to ₹30L wins');
  });

  it('a chosen target shows in the summary, and counts as a custom rule; Off in a round-limited mode says so', () => {
    expect(host({ mode: 'quick', targetWorth: 4000000 })).toContain('Quick Chai Break · 12 rounds · richest wins · ₹40L target · Custom rules (1)');
    const off = host({ mode: 'quick', targetWorth: null });
    expect(off).toContain('Quick Chai Break · 12 rounds · richest wins · Custom rules (1)');
    expect(off).not.toContain('target · Custom');
    expect(picks(off)).toMatch(/aria-checked="true"[^>]*>Off</);
  });

  it('a room that predates the target shows the default; guests get the read-only list', () => {
    expect(host({ mode: 'standard' })).toContain('₹50L (default)');
    const html = guest({ mode: 'standard', targetWorth: 7500000 }).replace(/<!-- -->/g, '');
    expect(html).toContain('Standard City Hustle · 20 rounds · richest wins · ₹75L target · Custom rules (1)');
    expect(html).toMatch(/<dt>Win target \(net worth\)<\/dt><dd><b>₹75L<\/b><small>Default ₹50L<\/small><\/dd>/);
    expect(html).not.toContain('role="radio"');
  });
});
