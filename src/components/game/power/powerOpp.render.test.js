// SSR render tests for the power-card pieces: the stack, the chips, the guide.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { POWER_CARDS } from '@shared/powerCards.js';

vi.mock('../ui/Sheet.jsx', () => ({
  default: ({ header, children, footer, title }) => h('div', { 'data-sheet': '' }, title ? h('h2', null, title) : null, header, children, footer),
  hasOpenSheet: () => false,
}));
// a STRICT art mock: no CardBack at all (reading it throws), the stack must still render
vi.mock('@/components/art/index.js', () => ({ Avatar: () => null }));

const { default: PowerStack } = await import('./PowerStack.jsx');
const { default: PowerChips } = await import('./PowerChips.jsx');
const { default: PowerGuide, PowerGuideHost, openPowerGuide } = await import('./PowerGuide.jsx');
const { GUIDE_RULES } = await import('./powerView.js');

const html = (el) => renderToStaticMarkup(el);
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('PowerStack', () => {
  it('renders nothing at all for 0 cards (no layout shift), also junk counts', () => {
    for (const count of [0, -1, undefined, NaN, null]) expect(html(h(PowerStack, { count, name: 'Ravi' }))).toBe('');
  });
  it('one card: a single back, the count and the accessible label', () => {
    const out = html(h(PowerStack, { count: 1, name: 'Ravi' }));
    expect(out).toContain('aria-label="Ravi holds 1 power card"');
    expect(out).toContain('title="Ravi holds 1 power card"');
    expect(out).toContain('data-count="1"');
    expect(out).not.toContain('pwo-card--under');
    expect(out.match(/pwo-card--top/g)).toHaveLength(1);
    expect(out).toContain('<b class="pwo-badge" aria-hidden="true">1</b>');
  });
  it('two cards: a fan of two backs and the count 2', () => {
    const out = html(h(PowerStack, { count: 2, name: 'Ravi' }));
    expect(out).toContain('aria-label="Ravi holds 2 power cards"');
    expect(out).toContain('pwo-card--under');
    expect(out).toContain('pwo-card--top');
    expect(out).toContain('>2</b>');
    expect(out).toContain('is-two');
  });
  it('counts above 2 still show 2 cards and the real number', () => {
    const out = html(h(PowerStack, { count: 3, name: 'Ravi' }));
    expect(out.match(/pwo-card--(under|top)/g)).toHaveLength(2);
    expect(out).toContain('>3</b>');
  });
  it('says "You hold" for the local player and takes an explicit label', () => {
    expect(html(h(PowerStack, { count: 2, name: 'Asha', isMe: true }))).toContain('aria-label="You hold 2 power cards"');
    expect(html(h(PowerStack, { count: 2, label: 'custom' }))).toContain('aria-label="custom"');
  });
  it('xs is only the glyph and the count (no card art); never ticked on the first render', () => {
    const out = html(h(PowerStack, { count: 2, size: 'xs', name: 'Ravi' }));
    expect(out).toContain('pwo-stack--xs');
    expect(out).toContain('pwo-mini');
    expect(out).not.toContain('pwo-card');
    expect(out).not.toContain('is-ticked');
    expect(html(h(PowerStack, { count: 2, name: 'Ravi' }))).not.toContain('is-ticked');
  });
  it('md is the sheet size', () => {
    expect(html(h(PowerStack, { count: 1, size: 'md', name: 'Ravi' }))).toContain('pwo-stack--md');
  });
});

describe('PowerChips', () => {
  it('renders nothing when no effect is armed', () => {
    expect(html(h(PowerChips, { player: { shield: 0, doubleRent: 0 }, round: 3 }))).toBe('');
    expect(html(h(PowerChips, { player: {}, round: 3 }))).toBe('');
    expect(html(h(PowerChips, { player: { shield: 2 }, round: 3 }))).toBe(''); // lapsed
  });
  it('shows an icon and text for each armed effect, with the rounds left', () => {
    const el = h(PowerChips, { player: { shield: 5, doubleRent: 3 }, round: 3 });
    const out = html(el);
    expect(out).toContain('aria-label="Shield armed, 3 rounds left"');
    expect(out).toContain('aria-label="Double rent armed, last round"');
    expect(out.match(/<svg/g)).toHaveLength(2);
    const t = text(el);
    expect(t).toContain('Shield');
    expect(t).toContain('3 rounds');
    expect(t).toContain('Double rent');
    expect(t).toContain('last round');
    expect(out).not.toContain('is-gone'); // nothing flashes on the first render
  });
  it('xs keeps the icon and the number, the label carries the words', () => {
    const out = html(h(PowerChips, { player: { shield: 4 }, round: 3, size: 'xs' }));
    expect(out).toContain('pwo-chip--xs');
    expect(out).toContain('pwo-chip__n');
    expect(out).toContain('aria-label="Shield armed, 2 rounds left"');
  });
  it('can take precomputed chips', () => {
    const out = html(h(PowerChips, { chips: [{ id: 'double', label: 'Double rent', rounds: 2, text: '2 rounds left', title: 'Double rent armed, 2 rounds left' }] }));
    expect(out).toContain('data-chip="double"');
  });
});

describe('PowerGuide', () => {
  const el = h(PowerGuide, { open: true, onClose() {} });
  const out = text(el);
  it('is titled "Power cards" and shows all four cards with their long text', () => {
    expect(out).toContain('Power cards');
    for (const c of POWER_CARDS) {
      expect(out, c.id).toContain(c.name);
      expect(out, c.id).toContain(c.long);
    }
    expect(html(el).match(/data-card="/g)).toHaveLength(4);
  });
  it('lists the rules in plain language', () => {
    for (const r of GUIDE_RULES) expect(out).toContain(r);
    for (const s of ['one card per turn', 'before you roll', '2 cards at most', '3 rounds', 'how many cards you hold, not which', 'Shield beats Double Rent']) expect(out, s).toContain(s);
  });
  it('the host renders nothing until the event arrives, and the opener is safe without a window', () => {
    expect(html(h(PowerGuideHost))).toBe('');
    expect(() => openPowerGuide()).not.toThrow();
  });
});
