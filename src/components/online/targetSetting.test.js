// The win-target control of the Hyderabad Tycoon lobby, rendered from the real schema (server-side render, node env).
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import SettingsPanel from './SettingsPanel.jsx';
import { LOBBY_SETTINGS, SETTINGS_SCHEMA, TABLE_RULES, settingsSummary } from '@/games/hyderabad-tycoon/settings.js';

const GAME = { settings: SETTINGS_SCHEMA, lobbySettings: LOBBY_SETTINGS, tableRules: TABLE_RULES, summarize: settingsSummary };
const host = (settings) => renderToString(h(SettingsPanel, { game: GAME, settings, isHost: true, onSend() {}, errorId: 0 }));
const guest = (settings) => renderToString(h(SettingsPanel, { game: GAME, settings, isHost: false, onSend() {}, errorId: 0 }));

describe('lobby: win target control', () => {
  it('the host sees the mode and the win target with its helper line, the target options as radios', () => {
    const html = host({ mode: 'standard', targetWorth: 5000000 });
    expect(html).toContain('Win target (net worth)');
    expect(html).toContain('First player to reach this net worth wins. Net worth = cash + districts + half the upgrades.');
    for (const label of ['Off', '₹25L', '₹30L', '₹40L', '₹50L (default)', '₹75L', '₹1Cr']) expect(html, label).toContain(`>${label}<`);
    expect(html).toContain('aria-checked="true"');
    // exactly the chosen target is the selected radio of its group
    const group = html.slice(html.indexOf('aria-label="Win target (net worth)"'));
    expect(group).toMatch(/aria-checked="true"[^>]*>₹50L \(default\)</);
    expect(html).toContain('Standard City Hustle · 20 rounds · richest wins · ₹50L target'); // the summary line
  });

  it('Off is not offered in Classic, whose default is marked instead', () => {
    const html = host({ mode: 'classic', targetWorth: 3000000 });
    const group = html.slice(html.indexOf('aria-label="Win target (net worth)"'));
    expect(group).not.toContain('>Off<');
    expect(group).toMatch(/aria-checked="true"[^>]*>₹30L \(default\)</);
    expect(group).toContain('>₹50L<');
    expect(html).toContain('Classic Long Game · first to ₹30L wins');
  });

  it('a chosen target shows in the summary; Off in a round-limited mode says so', () => {
    expect(host({ mode: 'quick', targetWorth: 4000000 })).toContain('Quick Chai Break · 12 rounds · richest wins · ₹40L target');
    expect(host({ mode: 'quick', targetWorth: null })).toContain('Quick Chai Break · 12 rounds · richest wins');
    expect(host({ mode: 'quick', targetWorth: null })).not.toContain('target</p>');
  });

  it('a room that predates the target shows the default; guests get the read-only summary and chips', () => {
    expect(host({ mode: 'standard' })).toContain('₹50L (default)');
    const html = guest({ mode: 'standard', targetWorth: 7500000 });
    expect(html).toContain('Standard City Hustle · 20 rounds · richest wins · ₹75L target');
    expect(html).toContain('Win target (net worth) ₹75L');
    expect(html).not.toContain('role="radio"');
  });
});
