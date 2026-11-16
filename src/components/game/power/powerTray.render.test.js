// SSR markup of the power-card hand: art, card faces, the tray (rule off / empty / two cards / played), targeting and the coach mark.
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PowerCardArt from './PowerCardArt.jsx';
import PowerCard from './PowerCard.jsx';
import PowerTray from './PowerTray.jsx';
import PowerCoach from './PowerCoach.jsx';
import TargetPicker from './TargetPicker.jsx';
import { COACH_KEY, COACH_TEXT, POWER_GUIDE_EVENT, POWER_TARGET_EVENT, targetsFor, buildPowerView } from './powerModel.js';
import { P, hand, sessionWith } from './powerFixtures.js';

const html = (node) => renderToString(node).replaceAll('<!-- -->', '');
const IDS = ['shield', 'double', 'steal', 'swap'];

describe('PowerCardArt', () => {
  it('draws every card as a root <svg> with the ink outline and no filters', () => {
    for (const id of IDS) {
      const out = html(h(PowerCardArt, { id, size: 64 }));
      expect(out.startsWith('<svg'), id).toBe(true);
      expect(out).toContain('width="64"');
      expect(out).toContain('aria-hidden="true"');
      expect(out).toContain('#1b1340');
      expect(out).not.toMatch(/<filter|filter=/);
      expect(out).toContain(`data-power-art="${id}"`);
    }
  });
  it('gradient ids are prefixed `pc` and unique across two instances on one page', () => {
    for (const id of IDS) {
      const out = html(h('div', null, h(PowerCardArt, { id }), h(PowerCardArt, { id }), h(PowerCardArt, { id: 'swap' })));
      const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
      expect(ids.length, id).toBeGreaterThan(0);
      expect(new Set(ids).size, id).toBe(ids.length);
      expect(ids.every((x) => x.startsWith('pc')), id).toBe(true);
      const refs = [...out.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
      expect(refs.every((r) => ids.includes(r)), id).toBe(true);
    }
  });
  it('an unknown id draws the shield', () => {
    expect(html(h(PowerCardArt, { id: 'nope' }))).toContain('data-power-art="shield"');
  });
});

describe('PowerCard', () => {
  it('every card renders a hand button with name, effect, art and a 3-pip meter; aria-label is "Name, N rounds left"', () => {
    for (const [id, name] of [['shield', 'Shield'], ['double', 'Double Rent'], ['steal', 'Steal a Roll'], ['swap', 'Swap Tiles']]) {
      const out = html(h(PowerCard, { id, left: 2 }));
      expect(out, id).toContain(`aria-label="${name}, 2 rounds left"`);
      expect(out).toContain('<button');
      expect(out).toContain('aria-pressed="false"');
      expect(out).toContain(`>${name}</span>`);
      expect(out).toContain('<svg');
      expect((out.match(/<i class="is-on">/g) || []).length).toBe(2);
      expect((out.match(/<i /g) || []).length).toBe(3);
      expect(out).toContain('pw-card pw-tone-');
    }
    expect(html(h(PowerCard, { id: 'shield', left: 2 }))).toContain('Block your next rent or tax.');
  });
  it('last round: warning state and the words "Last round"', () => {
    const out = html(h(PowerCard, { id: 'shield', left: 1 }));
    expect(out).toContain('is-last');
    expect(out).toContain('Last round');
    expect(out).toContain('aria-label="Shield, last round"');
  });
  it('face variant is static (no button), selected and dimmed are classes, no meter without `left`', () => {
    const face = html(h(PowerCard, { id: 'double', variant: 'face' }));
    expect(face).not.toContain('<button');
    expect(face).toContain('role="img"');
    expect(face).not.toContain('pw-card__meter');
    const sel = html(h(PowerCard, { id: 'steal', left: 3, selected: true, dimmed: true }));
    expect(sel).toContain('is-selected');
    expect(sel).toContain('is-dimmed');
    expect(sel).toContain('aria-pressed="true"');
  });
  it('tones: Shield blue, Double gold, Steal teal, Swap violet', () => {
    const tone = (id) => html(h(PowerCard, { id, left: 3 })).match(/pw-tone-(\w+)/)[1];
    expect([tone('shield'), tone('double'), tone('steal'), tone('swap')]).toEqual(['blue', 'gold', 'teal', 'violet']);
  });
});

describe('PowerTray', () => {
  const cardsOpt = (...c) => ({ canPlay: true, cards: c });
  it('rule off: renders nothing', () => {
    expect(html(h(PowerTray, { session: sessionWith({ cfgOn: false }) }))).toBe('');
    expect(html(h(PowerTray, { session: { me: 'me', view: { players: [] }, options: { roll: true } } }))).toBe('');
  });
  it('empty hand: a slim "No power cards" chip with the guide button', () => {
    const out = html(h(PowerTray, { session: sessionWith({ power: cardsOpt() }), placement: 'phone' }));
    expect(out).toContain('No power cards');
    expect(out).toContain('aria-label="About power cards"');
    expect(out).toContain('data-placement="phone"');
    expect(out).not.toContain('pw-fan');
  });
  it('two cards: a labelled group of two buttons, expiry in the label, the coach mark on first sight', () => {
    const s = sessionWith({
      hand: hand({ id: 'shield', exp: 8 }, { id: 'swap', exp: 7 }),
      power: cardsOpt({ uid: 'c1', id: 'shield', exp: 8, ok: true }, { uid: 'c2', id: 'swap', exp: 7, ok: true, targets: ['rav'] }),
    });
    const out = html(h(PowerTray, { session: s }));
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-label="Your power cards, 2 of 2"');
    expect(out).toContain('aria-label="Shield, 2 rounds left"');
    expect(out).toContain('aria-label="Swap Tiles, last round"');
    expect((out.match(/class="pw-card /g) || []).length).toBe(2);
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('tabindex="-1"');
    expect(out).not.toContain('is-dimmed');
    expect(out).not.toContain('pw-played');
    expect(out).not.toContain('pw-panel'); // nothing is selected, nothing is open
    expect(out).not.toContain('pw-ghost'); // no crumble / arrival replay on mount
    expect(out).not.toContain('data-new');
    expect(out).toContain('pw-coach');
  });
  it('played this turn: the cards are dimmed, each with its reason for screen readers, plus a "Played" note', () => {
    const s = sessionWith({
      hand: hand({ id: 'double' }), played: true,
      power: { canPlay: false, reason: 'Already played a card this turn', cards: [{ uid: 'c1', id: 'double', exp: 9, ok: false }] },
    });
    const out = html(h(PowerTray, { session: s }));
    expect(out).toContain('is-dimmed');
    expect(out).toContain('Played this turn');
    expect(out).toContain('Already played a card this turn');
    expect(out).toContain('aria-describedby=');
    expect(out).toContain('data-played="true"');
  });
  it('not my turn: dimmed with the reason', () => {
    const s = sessionWith({ hand: hand({ id: 'steal' }), turn: 1, power: { canPlay: false, reason: 'Not your turn', cards: [{ uid: 'c1', id: 'steal', exp: 9, ok: false }] } });
    const out = html(h(PowerTray, { session: s }));
    expect(out).toContain('Not your turn');
    expect(out).toContain('is-dimmed');
  });
  it('options blanked while the table animates: still there, dimmed', () => {
    const out = html(h(PowerTray, { session: sessionWith({ hand: hand({ id: 'shield' }), power: null }) }));
    expect(out).toContain('pw-fan');
    expect(out).toContain('is-dimmed');
  });
  it('exposes the stable presenter hooks: data-fx-power-tray on the root, data-fx-power-card per card', () => {
    const s = sessionWith({ hand: hand({ id: 'shield' }), power: { canPlay: true, cards: [{ uid: 'c1', id: 'shield', exp: 9, ok: true }] } });
    const out = html(h(PowerTray, { session: s }));
    expect(out).toContain('data-fx-power-tray=""');
    expect(out).toContain('data-fx-power-card="c1"');
    expect(html(h(PowerTray, { session: sessionWith({ power: { canPlay: true, cards: [] } }) }))).toContain('data-fx-power-tray');
  });
  it('documents the two DOM events', () => {
    expect(POWER_GUIDE_EVENT).toBe('hg:power-guide');
    expect(POWER_TARGET_EVENT).toBe('hg:power-target');
  });
});

describe('TargetPicker (Swap Tiles targeting)', () => {
  const view = buildPowerView(sessionWith({
    hand: hand({ id: 'swap' }),
    rivals: [P('rav', 'Ravi'), P('sana', 'Sana', { stuck: true }), P('arj', 'Arjun', { bankrupt: true })],
    power: { canPlay: true, cards: [{ uid: 'c1', id: 'swap', exp: 9, ok: true, targets: ['rav'] }] },
  }));
  const rivals = targetsFor(view, view.cards[0]);
  it('lists eligible rivals as buttons and the others disabled with their reason', () => {
    const out = html(h(TargetPicker, { rivals }));
    expect(out).toContain('Choose a rival to trade places with');
    expect((out.match(/class="pw-rival[ "]/g) || []).length).toBe(3);
    expect((out.match(/aria-disabled="true"/g) || []).length).toBe(2);
    expect(out).toContain('Stuck in the Traffic Jam');
    expect(out).toContain('Out of the game');
    expect(out.indexOf('Ravi')).toBeLessThan(out.indexOf('Sana'));
    expect(out).toContain('>Back<');
  });
  it('confirm line: "Trade places with Ravi?" with Back and Confirm', () => {
    const out = html(h(TargetPicker, { rivals, picked: 'rav' }));
    expect(out).toContain('Trade places with <b>Ravi</b>?');
    expect(out).toContain('aria-label="Trade places with Ravi?"');
    expect(out).toContain('Confirm');
    expect(out).toContain('>Back<');
  });
  it('pending shows the busy state', () => {
    const out = html(h(TargetPicker, { rivals, picked: 'rav', pending: true }));
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('Swapping');
  });
  it('no eligible rival: says so', () => {
    const none = rivals.map((r) => ({ ...r, ok: false, reason: 'x' }));
    expect(html(h(TargetPicker, { rivals: none }))).toContain('No rival can swap right now');
  });
});

describe('PowerCoach', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('shows the one-time hint while I hold a card', () => {
    const out = html(h(PowerCoach, { hasCards: true }));
    expect(out).toContain('pw-coach');
    expect(out).toContain(COACH_TEXT);
    expect(out).toContain('Got it');
    expect(html(h(PowerCoach, { hasCards: false }))).toBe('');
    expect(html(h(PowerCoach, { hasCards: true, hidden: true }))).toBe('');
  });
  it('is not shown again once seen (localStorage hg:power-coach)', () => {
    expect(COACH_KEY).toBe('hg:power-coach');
    vi.stubGlobal('localStorage', { getItem: (k) => (k === 'hg:power-coach' ? '1' : null), setItem() {} });
    expect(html(h(PowerCoach, { hasCards: true }))).toBe('');
  });
  it('a throwing storage never breaks it', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
    expect(html(h(PowerCoach, { hasCards: true }))).toContain('pw-coach');
  });
});
