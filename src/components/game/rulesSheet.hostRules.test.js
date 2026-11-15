// The "How to play" sheet and the log follow the host rules of the table (shared/ruleSettings.js), not the stock numbers.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '@shared/index.js';

vi.mock('./ui/Sheet.jsx', () => ({
  default: ({ header, children, footer, title }) => createElement('div', null, title ? createElement('h2', null, title) : null, header, children, footer),
  hasOpenSheet: () => false,
}));
vi.mock('@/components/art/index.js', () => ({
  Avatar: () => null,
  TileIcon: () => null,
  BuildingArt: () => null,
  PieceArt: () => null,
  AvatarFrame: ({ children, size }) => (typeof children === 'function' ? children(size) : children),
  TitleChip: () => null,
}));

const { default: RulesSheet } = await import('./RulesSheet.jsx');
const { describeEvent } = await import('@/lib/messages.js');

const game = (settings = {}) => createGame({ players: [{ id: 'me', name: 'Asha' }, { id: 'b1', name: 'Ravi' }], settings, seed: 3 });
const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const rules = (settings) => text(createElement(RulesSheet, { open: true, onClose() {}, session: { view: game(settings) } }));

describe('RulesSheet follows the host rules', () => {
  it('city events: the host round count, or "switched off"', () => {
    expect(rules({ eventEvery: 5 })).toContain('Every 5 rounds');
    expect(rules({ eventEvery: 2 })).toContain('Every 2 rounds');
    const off = rules({ eventEvery: 0 });
    expect(off).toContain('City events are switched off at this table');
    expect(off).not.toContain('Every 3 rounds');
    expect(rules({})).toContain('Every 3 rounds');
  });

  it('upgrades: the whole collection by default, any owned district when the host dropped the rule', () => {
    expect(rules({})).toContain('every district of its collection');
    const lax = rules({ requireFullSet: false });
    expect(lax).not.toContain('every district of its collection');
    expect(lax).toContain('You can upgrade any district you own');
    expect(lax).toContain('Full set bonus'); // the 1.5x bonus rule is still there
  });

  it('rent level: said only when it is not 100 %', () => {
    expect(rules({ rentPercent: 150 })).toContain('Rents at this table are 150% of the usual amounts');
    expect(rules({ rentPercent: 50 })).toContain('50% of the usual amounts');
    expect(rules({})).not.toContain('of the usual amounts');
  });

  it('salary, fine and chai cap come from the config', () => {
    const t = rules({ passStart: 50000, trafficFine: 60000, chaiCap: 3 });
    expect(t).toContain('₹50,000');
    expect(t).toContain('₹60,000');
    expect(t).toContain('hold at most 3');
  });
});

describe('the log says what the fine really was', () => {
  const ctx = { me: 'me', players: [{ id: 'me', name: 'Asha' }, { id: 'b1', name: 'Ravi' }], owners: [], round: 1, maxRounds: 20 };
  it('paid: the amount of the event', () => {
    expect(describeEvent({ type: 'traffic', player: 'me', stuck: false, reason: 'paid', amount: 60000 }, ctx).text).toBe('You paid ₹60,000 and squeezed out of the jam');
    expect(describeEvent({ type: 'traffic', player: 'b1', stuck: false, reason: 'paid', amount: 5000 }, ctx).text).toBe('Ravi paid ₹5,000 and squeezed out of the jam');
  });

  it('free (a ₹0 jam): the player is simply out', () => {
    expect(describeEvent({ type: 'traffic', player: 'me', stuck: false, reason: 'free' }, ctx).text).toBe('You are out of the traffic jam, free of charge');
    expect(describeEvent({ type: 'traffic', player: 'b1', stuck: false, reason: 'free' }, ctx).text).toBe('Ravi is out of the traffic jam, free of charge');
  });
});
