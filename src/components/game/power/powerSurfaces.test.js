// The power-card pieces on the player surfaces (pods, scoreboard rows, phone cells, player sheet, rules sheet):
// rule off -> not a byte of it; rule on -> the face-down stack, the chips and the words in the button label.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TILES } from '@shared/board.js';

vi.mock('../ui/Sheet.jsx', () => ({
  default: ({ header, children, footer, title }) => h('div', { 'data-sheet': '' }, title ? h('h2', null, title) : null, header, children, footer),
  hasOpenSheet: () => false,
}));

const { default: PlayerPods } = await import('../PlayerPods.jsx');
const { default: MoneyBar } = await import('../MoneyBar.jsx');
const { default: PhonePlayers } = await import('../phone/PhonePlayers.jsx');
const { default: PlayerSheet } = await import('../PlayerSheet.jsx');
const { default: RulesSheet } = await import('../RulesSheet.jsx');

const html = (node) => renderToStaticMarkup(node);
const text = (node) => html(node).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const N = TILES.length;
const P = (id, name, extra = {}) => ({ id, name, avatar: 0, color: '#3ddc97', cash: 1500000, pos: 0, stuck: false, chai: 0, bankrupt: false, ...extra });

// Ravi holds two masked cards and a Shield armed until round 5 (round 4 now: 2 rounds left); you hold one real card and a Double Rent until round 4.
const players = () => [
  P('me', 'Asha', { hand: [{ uid: 'u1', id: 'swap', exp: 6 }], doubleRent: 4, shield: 0 }),
  P('rav', 'Ravi', { hand: [{ hidden: true }, { hidden: true }], shield: 5, doubleRent: 0 }),
  P('gita', 'Gita', { hand: [], shield: 0, doubleRent: 0 }),
];

function mkSession({ powerCards = true, list = players() } = {}) {
  const cfg = { mode: 'standard', maxRounds: 20, ...(powerCards ? { powerCards: true } : null) };
  const view = {
    phase: 'roll', turn: 0, round: 4, turnCount: 5, extraRoll: false, players: list,
    owners: Array(N).fill(null), levels: Array(N).fill(0), mortgaged: Array(N).fill(false),
    cfg, pending: null, trade: null, debt: null, event: null, dice: [],
  };
  // the presenter's display copy does not carry the power fields: the surfaces read them from the live view
  const display = {
    players: list.map(({ hand, shield, doubleRent, ...rest }) => rest),
    owners: view.owners, levels: view.levels, mortgaged: view.mortgaged, turn: 0, round: 4, dice: [], phase: 'roll', cfg,
  };
  return { mode: 'online', me: 'me', view, display, options: {}, log: [], dispatch: () => {}, clock: null, roomPlayers: [] };
}

const surfaces = {
  'wide pods': (s) => h(PlayerPods, { session: s, layout: 'wide' }),
  'compact pods': (s) => h(PlayerPods, { session: s, layout: 'phone', mode: 'others' }),
  'my compact pod': (s) => h(PlayerPods, { session: s, layout: 'phone', mode: 'me' }),
  'scoreboard rows': (s) => h(MoneyBar, { session: s }),
  'phone cells': (s) => h(PhonePlayers, { session: s }),
  'player sheet': (s) => h(PlayerSheet, { session: s, playerId: 'rav', onClose() {} }),
};

describe('rule off: nothing at all', () => {
  for (const [name, make] of Object.entries(surfaces)) {
    it(`${name}: no pwo- markup, no power words, even when the players carry the fields`, () => {
      const out = html(make(mkSession({ powerCards: false })));
      expect(out).not.toContain('pwo-');
      expect(out.toLowerCase()).not.toContain('power card');
      expect(out).not.toContain('Shield');
    });
    it(`${name}: identical to a table whose players carry no power fields`, () => {
      const bare = players().map(({ hand, shield, doubleRent, ...rest }) => rest);
      expect(html(make(mkSession({ powerCards: false })))).toBe(html(make(mkSession({ powerCards: false, list: bare }))));
    });
  }
  it('rules sheet: no Power cards section, no guide button', () => {
    const out = text(h(RulesSheet, { open: true, onClose() {}, session: mkSession({ powerCards: false }) }));
    expect(out).not.toContain('Power cards');
    expect(out).not.toContain('power cards guide');
  });
});

describe('rule on', () => {
  it('wide pods: Ravi shows a 2-card stack and a Shield chip, you show your real count and your Double rent; Gita nothing', () => {
    const out = html(h(PlayerPods, { session: mkSession(), layout: 'wide' }));
    const pod = (id) => out.split('<li ').slice(1).find((c) => c.includes(`data-fx-player="${id}"`));
    expect(pod('rav')).toContain('aria-label="Ravi holds 2 power cards"');
    expect(pod('rav')).toContain('data-chip="shield"');
    expect(pod('rav')).toContain('Shield armed, 2 rounds left');
    expect(pod('me')).toContain('aria-label="You hold 1 power card"');
    expect(pod('me')).toContain('data-chip="double"');
    expect(pod('gita')).not.toContain('pwo-');
    // the pod button says it in words too
    expect(pod('rav')).toContain('holds 2 power cards, Shield armed, 2 rounds left');
  });

  it('compact pods keep only the count badge and icon-only chips, on the avatar corner', () => {
    const out = html(h(PlayerPods, { session: mkSession(), layout: 'phone', mode: 'others' }));
    const pod = out.split('<li ').slice(1).find((c) => c.includes('data-fx-player="rav"'));
    expect(pod).toContain('pwo-corner');
    expect(pod).toContain('pwo-stack--xs');
    expect(pod).not.toContain('pwo-card');
    expect(pod).toContain('pwo-chip--xs');
    expect(pod).not.toContain('pwo-chip__t');
    expect(pod).toContain('holds 2 power cards, Shield armed, 2 rounds left');
  });

  it('a player with nothing shows no stack and no chips (and no extra text)', () => {
    const out = html(h(PlayerPods, { session: mkSession(), layout: 'wide' }));
    const gita = out.split('<li ').slice(1).find((c) => c.includes('data-fx-player="gita"'));
    expect(gita).not.toContain('pwo-stack');
    expect(gita).not.toContain('power card');
  });

  it('scoreboard rows', () => {
    const out = html(h(MoneyBar, { session: mkSession() }));
    expect(out).toContain('aria-label="Ravi holds 2 power cards"');
    expect(out).toContain('Shield armed, 2 rounds left');
    expect(out).toContain('holds 2 power cards, Shield armed, 2 rounds left');
  });

  it('phone cells', () => {
    const out = html(h(PhonePlayers, { session: mkSession() }));
    const cell = out.split('<li ').slice(1).find((c) => c.includes('data-fx-player="rav"'));
    expect(cell).toContain('pwo-corner');
    expect(cell).toContain('Ravi holds 2 power cards');
    expect(cell).toContain('Shield armed, 2 rounds left');
  });

  it('player sheet: stack, chips and the one-line explainer', () => {
    const rival = text(h(PlayerSheet, { session: mkSession(), playerId: 'rav', onClose() {} }));
    expect(rival).toContain('Power cards');
    expect(rival).toContain('2 cards held');
    expect(rival).toContain('Shield');
    expect(rival).toContain('2 rounds');
    expect(rival).toContain('You can see how many cards Ravi holds, not which.');
    const own = text(h(PlayerSheet, { session: mkSession(), playerId: 'me', onClose() {} }));
    expect(own).toContain('Others can see how many cards you hold, not which.');
    expect(own).toContain('1 card held');
    const none = text(h(PlayerSheet, { session: mkSession(), playerId: 'gita', onClose() {} }));
    expect(none).toContain('No power cards right now.');
  });

  it('a bankrupt player shows nothing', () => {
    const list = players();
    list[1] = { ...list[1], bankrupt: true };
    const out = html(h(PlayerPods, { session: mkSession({ list }), layout: 'wide' }));
    const pod = out.split('<li ').slice(1).find((c) => c.includes('data-fx-player="rav"'));
    expect(pod).not.toContain('pwo-');
  });

  it('rules sheet: a short Power cards section with the guide button', () => {
    const el = h(RulesSheet, { open: true, onClose() {}, session: mkSession() });
    const out = text(el);
    expect(out).toContain('Power cards');
    expect(out).toContain('Shield, Double Rent, Steal a Roll, Swap Tiles');
    expect(out).toContain('once per turn');
    expect(out).toContain('See the power cards guide');
    expect(html(el)).toContain('pwo-rule-link');
  });
});
